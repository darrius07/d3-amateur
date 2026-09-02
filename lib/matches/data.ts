import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isProbableDuplicate, type MatchCandidate, type MatchStatus } from "./identity";

function publicClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
}

// The admin client (lib/supabase/admin.ts) has no generated Database
// generic, so Postgrest-js infers every embedded to-one relation as an
// array regardless of real cardinality -- see lib/players/data.ts for the
// full writeup. Same fix here: collapse right where the raw response lands.
function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export interface OpponentTeamSeasonOption {
  teamSeasonId: string;
  displayName: string;
  teamRank: number | null;
}

export interface OpponentClubOption {
  clubId: string;
  clubDisplayName: string;
  clubSlug: string;
  teamSeasons: OpponentTeamSeasonOption[];
}

async function getClubSeniorTeamSeasons(admin: ReturnType<typeof createAdminClient>, clubId: string): Promise<OpponentTeamSeasonOption[]> {
  const { data: teams, error } = await admin
    .from("teams")
    .select("id,display_name,team_rank")
    .eq("club_id", clubId)
    .eq("active", true)
    .eq("gender", "male")
    .eq("category", "senior")
    .eq("football_format", "11")
    .order("team_rank");
  if (error) throw error;
  const result: OpponentTeamSeasonOption[] = [];
  for (const team of teams ?? []) {
    const { data: season } = await admin.from("team_seasons").select("id").eq("team_id", team.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (season) result.push({ teamSeasonId: season.id, displayName: team.display_name, teamRank: team.team_rank });
  }
  return result;
}

/** Own club's Seniors A/B/C team_seasons -- what the OWNER picks "our team" from in the match form. */
export async function getOwnTeamSeasons(clubId: string): Promise<OpponentTeamSeasonOption[]> {
  return getClubSeniorTeamSeasons(createAdminClient(), clubId);
}

/** Search D3 clubs for an opponent, returning only clubs that actually have a senior team_season to link to. Never creates anything. */
export async function searchOpponentClubs(query: string): Promise<OpponentClubOption[]> {
  if (query.trim().length < 2) return [];
  const { data: clubs, error } = await publicClient().rpc("search_clubs", { query: query.trim(), result_limit: 8 });
  if (error) throw error;
  const admin = createAdminClient();
  const results: OpponentClubOption[] = [];
  for (const club of clubs ?? []) {
    const teamSeasons = await getClubSeniorTeamSeasons(admin, club.id);
    if (teamSeasons.length) results.push({ clubId: club.id, clubDisplayName: club.display_name, clubSlug: club.slug, teamSeasons });
  }
  return results;
}

export interface MatchRow {
  id: string;
  kickoffAt: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  ourTeamSeasonId: string;
  teamDisplayName: string;
  isHome: boolean;
  opponentTeamSeasonId: string | null;
  opponentDisplayName: string;
  opponentSlug: string | null;
  externalOpponentName: string | null;
  venueName: string | null;
}

async function resolveOpponentNames(admin: ReturnType<typeof createAdminClient>, teamSeasonIds: string[]) {
  const names = new Map<string, { name: string; slug: string; logoPath: string | null }>();
  if (!teamSeasonIds.length) return names;
  const { data: rows } = await admin.from("team_seasons").select("id, teams(display_name, clubs(display_name, slug, logo_path))").in("id", teamSeasonIds);
  for (const row of rows ?? []) {
    const team = one(row.teams) as { display_name: string; clubs: unknown } | null;
    const club = team ? (one(team.clubs) as { display_name: string; slug: string; logo_path: string | null } | null) : null;
    if (club) names.set(row.id, { name: club.display_name, slug: club.slug, logoPath: club.logo_path });
  }
  return names;
}

/** Upcoming fixtures and recent results for every senior team of a club, for Club Studio and the public Club page. */
export async function getClubMatches(clubId: string): Promise<{ upcoming: MatchRow[]; results: MatchRow[] }> {
  const admin = createAdminClient();
  const teamSeasons = await getClubSeniorTeamSeasons(admin, clubId);
  const ourIds = teamSeasons.map((t) => t.teamSeasonId);
  if (!ourIds.length) return { upcoming: [], results: [] };
  const ourNames = new Map(teamSeasons.map((t) => [t.teamSeasonId, t.displayName]));

  const { data: matches, error } = await admin
    .from("matches")
    .select("id,kickoff_at,status,home_score,away_score,home_team_season_id,away_team_season_id,external_opponent_name,venue_id,venue_name")
    .or(`home_team_season_id.in.(${ourIds.join(",")}),away_team_season_id.in.(${ourIds.join(",")})`)
    .order("kickoff_at", { ascending: true });
  if (error) throw error;

  const opponentIds = [...new Set((matches ?? []).flatMap((m) => [m.home_team_season_id, m.away_team_season_id]).filter((id): id is string => Boolean(id) && !ourIds.includes(id)))];
  const venueIds = [...new Set((matches ?? []).map((m) => m.venue_id).filter((id): id is string => Boolean(id)))];
  const opponentNames = await resolveOpponentNames(admin, opponentIds);
  const venueNames = new Map<string, string>();
  if (venueIds.length) {
    const { data: venues } = await admin.from("venues").select("id,name").in("id", venueIds);
    for (const v of venues ?? []) venueNames.set(v.id, v.name);
  }

  const rows: MatchRow[] = (matches ?? []).map((m) => {
    const isHome = ourIds.includes(m.home_team_season_id ?? "__none__");
    const ourTeamSeasonId = isHome ? m.home_team_season_id! : (m.away_team_season_id ?? m.home_team_season_id!);
    const opponentTeamSeasonId = isHome ? m.away_team_season_id : m.home_team_season_id;
    const opponent = opponentTeamSeasonId ? opponentNames.get(opponentTeamSeasonId) : null;
    return {
      id: m.id,
      kickoffAt: m.kickoff_at,
      status: m.status,
      homeScore: m.home_score,
      awayScore: m.away_score,
      ourTeamSeasonId,
      teamDisplayName: ourNames.get(ourTeamSeasonId) ?? "",
      isHome,
      opponentTeamSeasonId,
      opponentDisplayName: opponent?.name ?? m.external_opponent_name ?? "Adversaire",
      opponentSlug: opponent?.slug ?? null,
      externalOpponentName: m.external_opponent_name,
      venueName: m.venue_name ?? (m.venue_id ? (venueNames.get(m.venue_id) ?? null) : null),
    };
  });

  const upcoming = rows.filter((r) => r.status === "SCHEDULED" || r.status === "POSTPONED").sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
  const results = rows.filter((r) => r.status === "PLAYED").sort((a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime());
  return { upcoming, results };
}

export interface MatchDetail {
  id: string;
  kickoffAt: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  homeDisplayName: string;
  homeSlug: string | null;
  homeLogoUrl: string | null;
  awayDisplayName: string;
  awaySlug: string | null;
  awayLogoUrl: string | null;
  venueName: string | null;
  competitionName: string | null;
  seasonLabel: string | null;
  verificationStatus: string;
}

/** Full detail for the public /matches/[id] page. */
export async function getMatch(id: string): Promise<MatchDetail | null> {
  const admin = createAdminClient();
  const { data: match, error } = await admin.from("matches").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!match) return null;

  const teamSeasonIds = [match.home_team_season_id, match.away_team_season_id].filter((x): x is string => Boolean(x));
  const names = await resolveOpponentNames(admin, teamSeasonIds);
  const home = match.home_team_season_id ? names.get(match.home_team_season_id) : null;
  const away = match.away_team_season_id ? names.get(match.away_team_season_id) : null;

  const [venue, season, competitionSeason, homeLogoUrl, awayLogoUrl] = await Promise.all([
    match.venue_id ? admin.from("venues").select("name").eq("id", match.venue_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("seasons").select("label").eq("id", match.season_id).maybeSingle(),
    match.competition_season_id ? admin.from("competition_seasons").select("competitions(name)").eq("id", match.competition_season_id).maybeSingle() : Promise.resolve({ data: null }),
    home?.logoPath ? admin.storage.from("club-assets").createSignedUrl(home.logoPath, 3600).then((r) => r.data?.signedUrl ?? null) : Promise.resolve(null),
    away?.logoPath ? admin.storage.from("club-assets").createSignedUrl(away.logoPath, 3600).then((r) => r.data?.signedUrl ?? null) : Promise.resolve(null),
  ]);

  return {
    id: match.id,
    kickoffAt: match.kickoff_at,
    status: match.status,
    homeScore: match.home_score,
    awayScore: match.away_score,
    homeDisplayName: home?.name ?? match.external_opponent_name ?? "Adversaire",
    homeSlug: home?.slug ?? null,
    homeLogoUrl,
    awayDisplayName: away?.name ?? match.external_opponent_name ?? "Adversaire",
    awaySlug: away?.slug ?? null,
    awayLogoUrl,
    venueName: match.venue_name ?? venue?.data?.name ?? null,
    competitionName: competitionSeason?.data ? ((one(competitionSeason.data.competitions) as { name: string } | null)?.name ?? null) : null,
    seasonLabel: season?.data?.label ?? null,
    verificationStatus: match.verification_status,
  };
}

/** Server-side, warn-not-block duplicate check ahead of match creation. */
export async function findMatchCandidates(
  ourTeamSeasonId: string,
  opponentTeamSeasonId: string | null,
  externalOpponentName: string | null,
  kickoffAtIso: string
): Promise<MatchCandidate[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("matches")
    .select("id,kickoff_at,home_team_season_id,away_team_season_id,external_opponent_name")
    .or(`home_team_season_id.eq.${ourTeamSeasonId},away_team_season_id.eq.${ourTeamSeasonId}`)
    .neq("status", "CANCELLED");
  if (error) throw error;
  const candidates: MatchCandidate[] = (data ?? []).map((m) => ({
    id: m.id,
    kickoffAt: m.kickoff_at,
    opponentTeamSeasonId: m.home_team_season_id === ourTeamSeasonId ? m.away_team_season_id : m.home_team_season_id,
    externalOpponentName: m.external_opponent_name,
  }));
  return candidates.filter((c) => isProbableDuplicate(c, { opponentTeamSeasonId, externalOpponentName, kickoffAt: kickoffAtIso }));
}
