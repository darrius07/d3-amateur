import { createAdminClient } from "@/lib/supabase/admin";
import { CAREER_LABEL, formatCoverageSentence, type CoverageStats, type DerivedStats } from "./stats";

// Every function here reads one of the Step 5C derived-stats VIEWs
// (supabase/migrations/20260908100000_derived_player_stats.sql) --  there is
// no other source of these numbers, and no write path exists for any of
// them (mission section 21: "Derived signifie derived"). Batched by
// player_id/team_season_id wherever a roster is involved, never one query
// per player (mission section 30).

function mapDerived(row: Record<string, number>): DerivedStats {
  return {
    appearances: row.appearances,
    starts: row.starts,
    substituteAppearances: row.substitute_appearances,
    documentedGoals: row.documented_goals,
    documentedAssists: row.documented_assists,
    documentedOwnGoals: row.documented_own_goals,
    yellowCards: row.yellow_cards,
    redCards: row.red_cards,
  };
}

const ZERO: DerivedStats = { appearances: 0, starts: 0, substituteAppearances: 0, documentedGoals: 0, documentedAssists: 0, documentedOwnGoals: 0, yellowCards: 0, redCards: 0 };

/** Roster-wide stats for one team_season, one query for every player -- Club roster (public) and Club Studio roster both use this. */
export async function getTeamSeasonStatsForPlayers(teamSeasonId: string, playerIds: string[]): Promise<Map<string, DerivedStats>> {
  const map = new Map<string, DerivedStats>();
  if (!playerIds.length) return map;
  const admin = createAdminClient();
  const { data, error } = await admin.from("player_team_season_stats").select("player_id,appearances,starts,substitute_appearances,documented_goals,documented_assists,documented_own_goals,yellow_cards,red_cards").eq("team_season_id", teamSeasonId).in("player_id", playerIds);
  if (error) throw error;
  for (const row of data ?? []) map.set(row.player_id, mapDerived(row));
  return map;
}

/** One player's stats for a single team_season -- falls back to all-zero (not absent) so callers never need a special "no row" branch for a player who is simply on the sheet with no facts yet. */
export async function getPlayerTeamSeasonStats(playerId: string, teamSeasonId: string): Promise<DerivedStats> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("player_team_season_stats").select("appearances,starts,substitute_appearances,documented_goals,documented_assists,documented_own_goals,yellow_cards,red_cards").eq("player_id", playerId).eq("team_season_id", teamSeasonId).maybeSingle();
  if (error) throw error;
  return data ? mapDerived(data) : ZERO;
}

/** One player's season total across every club/team they appeared for that season (player_season_stats -- already summed, never re-summed client-side). */
export async function getPlayerSeasonStats(playerId: string, seasonId: string): Promise<DerivedStats> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("player_season_stats").select("appearances,starts,substitute_appearances,documented_goals,documented_assists,documented_own_goals,yellow_cards,red_cards").eq("player_id", playerId).eq("season_id", seasonId).maybeSingle();
  if (error) throw error;
  return data ? mapDerived(data) : ZERO;
}

export interface CareerStats extends DerivedStats {
  documentedSeasons: number;
  documentedClubs: number;
}

/** "Carrière documentée dans D3" (mission section 19) -- across every documented season, whatever the current club. */
export async function getPlayerCareerStats(playerId: string): Promise<CareerStats> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("player_career_stats").select("*").eq("player_id", playerId).maybeSingle();
  if (error) throw error;
  if (!data) return { ...ZERO, documentedSeasons: 0, documentedClubs: 0 };
  return { ...mapDerived(data), documentedSeasons: data.documented_seasons, documentedClubs: data.documented_clubs };
}

export interface ClubSeasonBreakdown extends DerivedStats {
  clubId: string;
  clubName: string;
}

export interface SeasonHistoryEntry {
  seasonId: string;
  seasonLabel: string;
  clubs: ClubSeasonBreakdown[];
  total: DerivedStats;
}

/**
 * Season-by-season history for the Player page, oldest constraints aside --
 * ordered by season start date, most recent first. A player transferred
 * mid-season shows one row per club they actually appeared for that season
 * (mission section 12/18) plus the season total, never a single merged row.
 */
export async function getPlayerSeasonHistory(playerId: string): Promise<SeasonHistoryEntry[]> {
  const admin = createAdminClient();
  const { data: clubRows, error } = await admin.from("player_club_season_stats").select("*").eq("player_id", playerId);
  if (error) throw error;
  if (!clubRows?.length) return [];

  const seasonIds = [...new Set(clubRows.map((r) => r.season_id))];
  const clubIds = [...new Set(clubRows.map((r) => r.club_id))];
  const [{ data: seasons }, { data: clubs }] = await Promise.all([
    admin.from("seasons").select("id,label,start_date").in("id", seasonIds),
    admin.from("clubs").select("id,display_name").in("id", clubIds),
  ]);
  const seasonLabel = new Map((seasons ?? []).map((s) => [s.id, s.label as string]));
  const seasonStart = new Map((seasons ?? []).map((s) => [s.id, s.start_date as string]));
  const clubName = new Map((clubs ?? []).map((c) => [c.id, c.display_name as string]));

  const bySeason = new Map<string, ClubSeasonBreakdown[]>();
  for (const row of clubRows) {
    const entry: ClubSeasonBreakdown = { clubId: row.club_id, clubName: clubName.get(row.club_id) ?? "Club inconnu", ...mapDerived(row) };
    const list = bySeason.get(row.season_id) ?? [];
    list.push(entry);
    bySeason.set(row.season_id, list);
  }

  const entries: SeasonHistoryEntry[] = [...bySeason.entries()].map(([seasonId, clubs]) => ({
    seasonId,
    seasonLabel: seasonLabel.get(seasonId) ?? "Saison inconnue",
    clubs: clubs.sort((a, b) => a.clubName.localeCompare(b.clubName)),
    total: clubs.reduce<DerivedStats>(
      (acc, c) => ({
        appearances: acc.appearances + c.appearances,
        starts: acc.starts + c.starts,
        substituteAppearances: acc.substituteAppearances + c.substituteAppearances,
        documentedGoals: acc.documentedGoals + c.documentedGoals,
        documentedAssists: acc.documentedAssists + c.documentedAssists,
        documentedOwnGoals: acc.documentedOwnGoals + c.documentedOwnGoals,
        yellowCards: acc.yellowCards + c.yellowCards,
        redCards: acc.redCards + c.redCards,
      }),
      ZERO,
    ),
  }));
  return entries.sort((a, b) => (seasonStart.get(b.seasonId) ?? "").localeCompare(seasonStart.get(a.seasonId) ?? ""));
}

/** team_season_data_coverage for one team_season -- the "absence ≠ zero" sentence (mission section 13/17). */
export async function getTeamSeasonCoverage(teamSeasonId: string): Promise<CoverageStats> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("team_season_data_coverage").select("played_matches,matches_with_any_lineup_data,matches_with_complete_starting_lineup,matches_with_any_event_data").eq("team_season_id", teamSeasonId).maybeSingle();
  if (error) throw error;
  if (!data) return { playedMatches: 0, matchesWithAnyLineupData: 0, matchesWithCompleteStartingLineup: 0, matchesWithAnyEventData: 0 };
  return {
    playedMatches: data.played_matches,
    matchesWithAnyLineupData: data.matches_with_any_lineup_data,
    matchesWithCompleteStartingLineup: data.matches_with_complete_starting_lineup,
    matchesWithAnyEventData: data.matches_with_any_event_data,
  };
}

export { CAREER_LABEL, formatCoverageSentence };
