// Pure, unit-testable mirror of the Step 5C derived-stats SQL layer
// (supabase/migrations/20260908100000_derived_player_stats.sql +
// 20260908110000_derived_stats_played_only.sql). The views ARE the real
// authority (every number shown to a user comes from them, live) -- this
// file exists so the exact same aggregation rules (dedup by match_id,
// BENCH-needs-a-substitution-event, own goals never folded into goals,
// NULL assist semantics, coverage) can be unit tested without a database,
// and so every page renders the same "documented, not official" wording
// from one place (mission sections 5-15, 38).

export type LineupRole = "STARTER" | "BENCH";
export type StatsEventType = "GOAL" | "OWN_GOAL" | "YELLOW_CARD" | "RED_CARD" | "SUBSTITUTION";

export interface AppearanceFact {
  playerId: string;
  matchId: string;
  teamSeasonId: string;
  lineupRole: LineupRole;
}

export interface EventFact {
  matchId: string;
  teamSeasonId: string;
  eventType: StatsEventType;
  primaryPlayerId: string;
  secondaryPlayerId: string | null;
}

/** A BENCH row only becomes a documented appearance if a SUBSTITUTION event actually brings that player on, for that match+team specifically (mission section 5). Sitting on the bench alone counts for nothing. */
export function isSubstituteAppearance(appearance: AppearanceFact, events: EventFact[]): boolean {
  if (appearance.lineupRole !== "BENCH") return false;
  return events.some(
    (e) => e.matchId === appearance.matchId && e.teamSeasonId === appearance.teamSeasonId && e.eventType === "SUBSTITUTION" && e.secondaryPlayerId === appearance.playerId,
  );
}

export interface DerivedStats {
  appearances: number;
  starts: number;
  substituteAppearances: number;
  documentedGoals: number;
  documentedAssists: number;
  documentedOwnGoals: number;
  yellowCards: number;
  redCards: number;
}

/**
 * Computes one player's derived stats from a set of appearance/event facts
 * already scoped to the desired grain by the caller (one team_season, one
 * season across teams, or a whole career) -- the aggregation rule itself is
 * identical at every grain, only the input scope differs, exactly like the
 * SQL views. Appearance counts are deduped by match_id (mission sections
 * 11, 22-28): a starter with an extra, contradictory SUBSTITUTION event
 * referencing them still counts as exactly one appearance for that match,
 * and a player who appears in the same match via two different
 * team_season rows (should never happen, but is not relied upon) is still
 * counted once per match.
 */
export function computePlayerStats(playerId: string, appearances: AppearanceFact[], events: EventFact[]): DerivedStats {
  const own = appearances.filter((a) => a.playerId === playerId);
  const startMatches = new Set(own.filter((a) => a.lineupRole === "STARTER").map((a) => a.matchId));
  const subMatches = new Set(own.filter((a) => isSubstituteAppearance(a, events)).map((a) => a.matchId));
  const appearedMatches = new Set([...startMatches, ...subMatches]);

  let documentedGoals = 0, documentedAssists = 0, documentedOwnGoals = 0, yellowCards = 0, redCards = 0;
  for (const e of events) {
    if (e.eventType === "GOAL" && e.primaryPlayerId === playerId) documentedGoals++;
    if (e.eventType === "GOAL" && e.secondaryPlayerId === playerId) documentedAssists++;
    if (e.eventType === "OWN_GOAL" && e.primaryPlayerId === playerId) documentedOwnGoals++;
    if (e.eventType === "YELLOW_CARD" && e.primaryPlayerId === playerId) yellowCards++;
    if (e.eventType === "RED_CARD" && e.primaryPlayerId === playerId) redCards++; // SECOND_YELLOW counts too -- card_kind is never filtered on (mission section 10)
  }

  return {
    appearances: appearedMatches.size,
    starts: startMatches.size,
    substituteAppearances: subMatches.size,
    documentedGoals,
    documentedAssists,
    documentedOwnGoals,
    yellowCards,
    redCards,
  };
}

// ----------------------------------------------------------------------------
// Coverage (mission section 13): absence ≠ zero. Mirrors
// team_season_data_coverage exactly, at the granularity of one PLAYED match.
// ----------------------------------------------------------------------------

export interface MatchCoverageFact {
  hasAnyLineupData: boolean;
  starterCount: number;
  hasAnyEventData: boolean;
}

export interface CoverageStats {
  playedMatches: number;
  matchesWithAnyLineupData: number;
  matchesWithCompleteStartingLineup: number;
  matchesWithAnyEventData: number;
}

/** playedMatches is the only implicit denominator anywhere in this module -- every other number here is `<= playedMatches` and must never be presented as if it summed to the team's full real schedule. */
export function computeCoverage(matches: MatchCoverageFact[]): CoverageStats {
  return {
    playedMatches: matches.length,
    matchesWithAnyLineupData: matches.filter((m) => m.hasAnyLineupData).length,
    matchesWithCompleteStartingLineup: matches.filter((m) => m.starterCount >= 11).length,
    matchesWithAnyEventData: matches.filter((m) => m.hasAnyEventData).length,
  };
}

// ----------------------------------------------------------------------------
// Wording (mission sections 14, 15, 19, 38): "documented", never "official";
// zero is only ever shown as an explicit, qualified zero, never a bare
// number, and total absence of data gets its own sentence rather than a
// zero-filled grid.
// ----------------------------------------------------------------------------

// Mission section 15 gives "0 but documenté" as the exact required zero
// wording -- singular, like "1", plural only starts at 2 -- so these
// deliberately do not follow the usual French rule of treating 0 as plural.

export function formatDocumentedGoals(n: number): string {
  return n <= 1 ? `${n} but documenté` : `${n} buts documentés`;
}

export function formatDocumentedAssists(n: number): string {
  return n <= 1 ? `${n} passe décisive renseignée` : `${n} passes décisives renseignées`;
}

export function formatDocumentedAppearances(n: number): string {
  return n <= 1 ? `${n} apparition documentée` : `${n} apparitions documentées`;
}

export function formatDocumentedCards(yellow: number, red: number): string {
  if (yellow === 0 && red === 0) return "Aucun carton renseigné";
  const parts: string[] = [];
  if (yellow > 0) parts.push(`${yellow} jaune${yellow > 1 ? "s" : ""}`);
  if (red > 0) parts.push(`${red} rouge${red > 1 ? "s" : ""}`);
  return `${parts.join(", ")} renseigné${yellow + red > 1 ? "s" : ""}`;
}

/** A NULL assist secondary_player_id means "passeur non renseigné" -- it must never read as "no assist happened" (mission section 8). Use next to a goal's own detail line, not as a standalone stat. */
export const ASSIST_UNKNOWN_LABEL = "Passeur non renseigné";

/** Shown when a player has zero rows anywhere in match_appearances/match_events -- a zero-filled stat grid would misleadingly imply exhaustive, checked-and-confirmed-zero data (mission section 15). */
export const NO_DATA_LABEL = "Aucune statistique documentée pour le moment";

export function hasAnyDocumentedData(stats: DerivedStats): boolean {
  return stats.appearances > 0 || stats.documentedGoals > 0 || stats.documentedAssists > 0 || stats.documentedOwnGoals > 0 || stats.yellowCards > 0 || stats.redCards > 0;
}

/** e.g. "Feuilles de match disponibles sur 8 des 12 matchs joués par l'équipe." (mission section 17). */
export function formatCoverageSentence(coverage: CoverageStats): string {
  if (coverage.playedMatches === 0) return "Aucun match joué documenté pour cette équipe pour le moment.";
  return `Feuilles de match disponibles sur ${coverage.matchesWithAnyLineupData} des ${coverage.playedMatches} matchs joués par l'équipe.`;
}

/** Never bare "Carrière" (mission section 19). */
export const CAREER_LABEL = "Carrière documentée dans D3";
