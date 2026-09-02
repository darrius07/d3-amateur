// Pure, unit-testable lineup logic. The real eligibility/duplicate/11-max
// enforcement lives in save_match_lineup() (SQL, the actual authority) --
// these mirror the same rules client-side so the UI can validate and show
// completeness before ever hitting the server.

export type LineupRole = "STARTER" | "BENCH";
export type ParticipationStatus = "SELECTED" | "DID_NOT_PLAY" | "UNKNOWN";

export interface LineupEntry {
  playerId: string;
  lineupRole: LineupRole;
  position?: string | null;
  squadNumber?: number | null;
  participationStatus?: ParticipationStatus;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const MAX_STARTERS = 11;

/** Mirrors save_match_lineup()'s shape checks: no duplicate player, valid role, max 11 starters, squad number in range. */
export function validateLineupEntries(entries: LineupEntry[]): ValidationResult {
  const seen = new Set<string>();
  let starters = 0;
  for (const entry of entries) {
    if (seen.has(entry.playerId)) return { valid: false, error: "Ce joueur est déjà dans la feuille de match" };
    seen.add(entry.playerId);
    if (entry.lineupRole !== "STARTER" && entry.lineupRole !== "BENCH") return { valid: false, error: "Rôle de composition invalide" };
    if (entry.lineupRole === "STARTER") starters += 1;
    if (entry.squadNumber != null && (entry.squadNumber < 1 || entry.squadNumber > 99)) return { valid: false, error: "Numéro de maillot invalide (1 à 99)" };
  }
  if (starters > MAX_STARTERS) return { valid: false, error: `Impossible de dépasser ${MAX_STARTERS} titulaires (actuellement ${starters})` };
  return { valid: true };
}

export type LineupCompleteness = "EMPTY" | "PARTIAL" | "COMPLETE";

/**
 * EMPTY: nothing documented at all. PARTIAL: some data exists (even bench
 * only) but fewer than 11 starters -- a real, acceptable historical state,
 * never treated as an error. COMPLETE: 11 starters are documented; the
 * bench count is never a condition for completeness (mission section 8).
 */
export function computeCompleteness(entries: LineupEntry[]): LineupCompleteness {
  if (entries.length === 0) return "EMPTY";
  const starters = entries.filter((e) => e.lineupRole === "STARTER").length;
  return starters >= MAX_STARTERS ? "COMPLETE" : "PARTIAL";
}

export interface RegistrationForEligibility {
  clubId: string;
  seasonId: string;
  status: string;
}

/** A player is eligible for a team's matchday squad iff they have an ACTIVE registration with that team's club, for that team's season -- existing in `players` is not enough (mission section 18). */
export function isEligible(registrations: RegistrationForEligibility[], clubId: string, seasonId: string): boolean {
  return registrations.some((r) => r.clubId === clubId && r.seasonId === seasonId && r.status === "ACTIVE");
}
