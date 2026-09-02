import { createAdminClient } from "@/lib/supabase/admin";
import type { LineupRole, ParticipationStatus } from "./lineup";

// Same untyped-admin-client caveat as lib/players/data.ts and
// lib/matches/data.ts: embedded to-one relations infer as arrays.
function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export interface OwnedMatchSide {
  teamSeasonId: string;
  clubId: string;
  seasonId: string;
  teamDisplayName: string;
  clubDisplayName: string;
  opponentLabel: string;
  kickoffAt: string;
  status: string;
}

type TeamSeasonRow = { id: string; season_id: string; teams: unknown };

/** Which side of a match (if any) the given user's OWNER membership controls -- null if neither side belongs to them. Never assumes home===ours. */
export async function resolveOwnedMatchSide(matchId: string, userId: string): Promise<OwnedMatchSide | null> {
  const admin = createAdminClient();
  const { data: match } = await admin.from("matches").select("home_team_season_id,away_team_season_id,external_opponent_name,kickoff_at,status").eq("id", matchId).maybeSingle();
  if (!match) return null;
  const sides = [match.home_team_season_id, match.away_team_season_id].filter((x): x is string => Boolean(x));
  if (!sides.length) return null;

  const { data: memberships } = await admin.from("club_memberships").select("club_id").eq("user_id", userId).eq("role", "OWNER").eq("active", true);
  const ownedClubIds = new Set((memberships ?? []).map((m) => m.club_id));

  const { data: teamSeasonRows } = await admin.from("team_seasons").select("id,season_id,teams(display_name,club_id,clubs(display_name))").in("id", sides);
  const rows = (teamSeasonRows ?? []) as TeamSeasonRow[];

  for (const row of rows) {
    const team = one(row.teams) as { display_name: string; club_id: string; clubs: unknown } | null;
    if (!team || !ownedClubIds.has(team.club_id)) continue;
    const club = one(team.clubs) as { display_name: string } | null;
    const opponentTeamSeasonId = sides.find((id) => id !== row.id) ?? null;
    let opponentLabel = match.external_opponent_name ?? "Adversaire";
    if (opponentTeamSeasonId) {
      const opp = rows.find((r) => r.id === opponentTeamSeasonId);
      const oppTeam = opp ? (one(opp.teams) as { clubs: unknown } | null) : null;
      const oppClub = oppTeam ? (one(oppTeam.clubs) as { display_name: string } | null) : null;
      opponentLabel = oppClub?.display_name ?? opponentLabel;
    }
    return {
      teamSeasonId: row.id,
      clubId: team.club_id,
      seasonId: row.season_id,
      teamDisplayName: team.display_name,
      clubDisplayName: club?.display_name ?? "",
      opponentLabel,
      kickoffAt: match.kickoff_at,
      status: match.status,
    };
  }
  return null;
}

export interface EligiblePlayerOption {
  playerId: string;
  displayName: string;
  primaryPosition: string | null;
  rosterTeamDisplayName: string | null;
  onOwnRoster: boolean;
}

/** Players actively registered with this club+season -- own-team roster first, then other teams' registrations (mission section 21). Never a source for creating a new player. */
export async function getEligiblePlayers(clubId: string, seasonId: string, teamSeasonId: string): Promise<EligiblePlayerOption[]> {
  const admin = createAdminClient();
  const { data: registrations, error } = await admin
    .from("player_registrations")
    .select("player_id, players(id,display_name,primary_position)")
    .eq("club_id", clubId)
    .eq("season_id", seasonId)
    .eq("status", "ACTIVE");
  if (error) throw error;
  const playerIds = (registrations ?? []).map((r) => r.player_id);
  if (!playerIds.length) return [];

  const { data: rosterRows } = await admin
    .from("team_roster_members")
    .select("player_id, team_season_id, team_seasons(teams(display_name))")
    .in("player_id", playerIds)
    .eq("active", true);
  const rosterMap = new Map<string, { teamDisplayName: string | null; onOwnRoster: boolean }>();
  for (const row of rosterRows ?? []) {
    const ts = one(row.team_seasons) as { teams: unknown } | null;
    const team = ts ? (one(ts.teams) as { display_name: string } | null) : null;
    const existing = rosterMap.get(row.player_id);
    const onOwn = row.team_season_id === teamSeasonId;
    if (!existing || onOwn) rosterMap.set(row.player_id, { teamDisplayName: team?.display_name ?? null, onOwnRoster: onOwn });
  }

  const options: EligiblePlayerOption[] = (registrations ?? []).map((r) => {
    const player = one(r.players) as { id: string; display_name: string; primary_position: string | null } | null;
    const roster = rosterMap.get(r.player_id);
    return {
      playerId: r.player_id,
      displayName: player?.display_name ?? "",
      primaryPosition: player?.primary_position ?? null,
      rosterTeamDisplayName: roster?.teamDisplayName ?? null,
      onOwnRoster: roster?.onOwnRoster ?? false,
    };
  });
  return options.sort((a, b) => Number(b.onOwnRoster) - Number(a.onOwnRoster) || a.displayName.localeCompare(b.displayName));
}

export interface SavedLineupEntry {
  playerId: string;
  displayName: string;
  lineupRole: LineupRole;
  position: string | null;
  squadNumber: number | null;
  participationStatus: ParticipationStatus;
}

/** Existing saved appearances for (match, team) -- pre-fills the Club Studio editor. */
export async function getMatchLineupEntries(matchId: string, teamSeasonId: string): Promise<SavedLineupEntry[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("match_appearances")
    .select("player_id,lineup_role,position,squad_number,participation_status,players(display_name)")
    .eq("match_id", matchId)
    .eq("team_season_id", teamSeasonId);
  if (error) throw error;
  return (data ?? []).map((row) => {
    const player = one(row.players) as { display_name: string } | null;
    return {
      playerId: row.player_id,
      displayName: player?.display_name ?? "",
      lineupRole: row.lineup_role as LineupRole,
      position: row.position,
      squadNumber: row.squad_number,
      participationStatus: row.participation_status as ParticipationStatus,
    };
  });
}

export interface PublicLineupEntry {
  playerId: string;
  slug: string;
  displayName: string;
  position: string | null;
  squadNumber: number | null;
}

/** Public /matches/[id] page: starters/bench for each side that has a documented sheet. A side with zero rows means "not documented" -- never rendered as an empty sheet. */
export async function getPublicMatchLineups(
  matchId: string,
  homeTeamSeasonId: string | null,
  awayTeamSeasonId: string | null
): Promise<{ home: { starters: PublicLineupEntry[]; bench: PublicLineupEntry[] }; away: { starters: PublicLineupEntry[]; bench: PublicLineupEntry[] } }> {
  const admin = createAdminClient();
  const teamSeasonIds = [homeTeamSeasonId, awayTeamSeasonId].filter((x): x is string => Boolean(x));
  const empty = { starters: [] as PublicLineupEntry[], bench: [] as PublicLineupEntry[] };
  if (!teamSeasonIds.length) return { home: empty, away: empty };

  const { data, error } = await admin
    .from("match_appearances")
    .select("team_season_id,player_id,lineup_role,position,squad_number,players(slug,display_name)")
    .eq("match_id", matchId)
    .in("team_season_id", teamSeasonIds)
    .order("squad_number", { ascending: true, nullsFirst: false });
  if (error) throw error;

  const toEntry = (row: (typeof data)[number]): PublicLineupEntry => {
    const player = one(row.players) as { slug: string; display_name: string } | null;
    return { playerId: row.player_id, slug: player?.slug ?? "", displayName: player?.display_name ?? "", position: row.position, squadNumber: row.squad_number };
  };
  const split = (teamSeasonId: string | null) => {
    if (!teamSeasonId) return empty;
    const rows = (data ?? []).filter((r) => r.team_season_id === teamSeasonId);
    return {
      starters: rows.filter((r) => r.lineup_role === "STARTER").map(toEntry),
      bench: rows.filter((r) => r.lineup_role === "BENCH").map(toEntry),
    };
  };
  return { home: split(homeTeamSeasonId), away: split(awayTeamSeasonId) };
}
