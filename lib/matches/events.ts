// Pure, unit-testable match-event logic. The real authorization/eligibility
// enforcement lives in create_match_event()/update_match_event() (SQL, the
// actual authority) -- these mirror the same shape/range rules client-side.

export type MatchEventType = "GOAL" | "OWN_GOAL" | "YELLOW_CARD" | "RED_CARD" | "SUBSTITUTION";
export type GoalKind = "NORMAL" | "PENALTY" | "FREE_KICK" | "UNKNOWN";
export type CardKind = "DIRECT" | "SECOND_YELLOW" | "UNKNOWN";

export interface MatchEventInput {
  eventType: MatchEventType;
  primaryPlayerId: string;
  secondaryPlayerId?: string | null;
  minute?: number | null;
  addedTime?: number | null;
  goalKind?: GoalKind | null;
  cardKind?: CardKind | null;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Mirrors the `match_events` minute/added_time CHECK constraints. Both stay optional -- amateur football often has no precise minute (mission section 7). */
export function validateMinute(minute: number | null | undefined, addedTime: number | null | undefined): ValidationResult {
  if (minute != null && (!Number.isInteger(minute) || minute < 0 || minute > 130)) {
    return { valid: false, error: "Minute invalide (0 à 130)" };
  }
  if (addedTime != null && (!Number.isInteger(addedTime) || addedTime < 0 || addedTime > 15)) {
    return { valid: false, error: "Temps additionnel invalide (0 à 15)" };
  }
  return { valid: true };
}

/** "23'", "45+2'", or the discreet fallback when nothing was documented -- absence of a minute is never rendered as minute 0. */
export function formatMinute(minute: number | null | undefined, addedTime: number | null | undefined): string {
  if (minute == null) return "Minute non renseignée";
  return addedTime ? `${minute}+${addedTime}'` : `${minute}'`;
}

/** Mirrors the `match_events` per-type shape CHECK constraint (mission sections 4-6, 10, 11, 13, 14). Does not check eligibility (needs the match sheet, a server/data concern) -- see isOnMatchSheet. */
export function validateMatchEvent(input: MatchEventInput): ValidationResult {
  const minuteCheck = validateMinute(input.minute, input.addedTime);
  if (!minuteCheck.valid) return minuteCheck;
  if (!input.primaryPlayerId) return { valid: false, error: "Un joueur est requis" };

  switch (input.eventType) {
    case "GOAL":
      if (input.cardKind) return { valid: false, error: "Un but n'a pas de type de carton" };
      if (input.secondaryPlayerId && input.secondaryPlayerId === input.primaryPlayerId) {
        return { valid: false, error: "Le buteur et le passeur ne peuvent pas être la même personne" };
      }
      return { valid: true };
    case "OWN_GOAL":
      if (input.secondaryPlayerId) return { valid: false, error: "Un but contre son camp n'a pas de passeur" };
      if (input.goalKind) return { valid: false, error: "Un but contre son camp n'a pas de type de but" };
      return { valid: true };
    case "YELLOW_CARD":
      if (input.secondaryPlayerId) return { valid: false, error: "Un carton n'implique qu'un seul joueur" };
      if (input.cardKind) return { valid: false, error: "Un carton jaune n'a pas de sous-type" };
      return { valid: true };
    case "RED_CARD":
      if (input.secondaryPlayerId) return { valid: false, error: "Un carton n'implique qu'un seul joueur" };
      return { valid: true };
    case "SUBSTITUTION":
      if (!input.secondaryPlayerId) return { valid: false, error: "Un joueur entrant est requis" };
      if (input.secondaryPlayerId === input.primaryPlayerId) return { valid: false, error: "Le sortant et l'entrant doivent être différents" };
      return { valid: true };
    default:
      return { valid: false, error: "Type d'événement invalide" };
  }
}

/** A player used in any role (scorer, assist, sanctioned, sub in/out) must be on *that team's* match sheet for *that match* -- stricter than club/season registration (mission section 9). */
export function isOnMatchSheet(sheetPlayerIds: ReadonlySet<string> | string[], playerId: string): boolean {
  const set = sheetPlayerIds instanceof Set ? sheetPlayerIds : new Set(sheetPlayerIds);
  return set.has(playerId);
}

export interface TimelineEvent {
  id: string;
  minute: number | null;
  addedTime: number | null;
}

/** Known-minute events first (by minute, then added_time), unknown-minute events after -- mission section 17. Never treats a missing minute as minute 0. */
export function sortTimeline<T extends TimelineEvent>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    if (a.minute == null && b.minute == null) return 0;
    if (a.minute == null) return 1;
    if (b.minute == null) return -1;
    if (a.minute !== b.minute) return a.minute - b.minute;
    return (a.addedTime ?? 0) - (b.addedTime ?? 0);
  });
}

export interface GoalLikeEvent {
  eventType: MatchEventType;
  primaryPlayerId: string;
  primaryPlayerName: string;
  primaryPlayerSlug: string | null;
  minute: number | null;
  addedTime: number | null;
}

export interface ScorerSummary {
  playerId: string;
  playerName: string;
  playerSlug: string | null;
  goals: { minute: number | null; addedTime: number | null; ownGoal: boolean }[];
}

/**
 * Match-level scorer summary derived directly from this match's own GOAL/
 * OWN_GOAL events -- never a season/career aggregate (that's Step 5C).
 * Own goals are kept clearly distinguished (mission section 21), never
 * folded into a player's real goal tally.
 */
export function buildScorers(events: GoalLikeEvent[]): ScorerSummary[] {
  const summaries = new Map<string, ScorerSummary>();
  for (const event of events) {
    if (event.eventType !== "GOAL" && event.eventType !== "OWN_GOAL") continue;
    if (!summaries.has(event.primaryPlayerId)) {
      summaries.set(event.primaryPlayerId, { playerId: event.primaryPlayerId, playerName: event.primaryPlayerName, playerSlug: event.primaryPlayerSlug, goals: [] });
    }
    summaries.get(event.primaryPlayerId)!.goals.push({ minute: event.minute, addedTime: event.addedTime, ownGoal: event.eventType === "OWN_GOAL" });
  }
  return Array.from(summaries.values());
}
