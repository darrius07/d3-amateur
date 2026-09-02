// Pure, unit-testable Match logic -- no Supabase client here. Mirrors the
// DB-level invariants (opponent shape CHECK, score/status CHECK) so the UI
// can validate before ever hitting the server, and centralizes the
// Europe/Paris <-> UTC conversion so no Match logic ever depends on the
// server's own timezone (see 20260905100000_match_foundation.sql).

export type MatchStatus = "SCHEDULED" | "PLAYED" | "POSTPONED" | "CANCELLED";

// Built from char codes (not a literal regex) to avoid any risk of raw
// combining-mark bytes ending up in the source file itself -- this matches
// U+0300 to U+036F, the Unicode combining diacritical marks block that NFD
// normalization splits accents into.
const DIACRITICS = new RegExp(String.fromCharCode(91, 92, 117, 48, 51, 48, 48, 45, 92, 117, 48, 51, 54, 102, 93), "g");


export interface OpponentShape {
  homeTeamSeasonId: string | null;
  awayTeamSeasonId: string | null;
  externalOpponentName: string | null;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Client-side mirror of the `matches` opponent-shape CHECK constraint. */
export function validateOpponentShape(shape: OpponentShape): ValidationResult {
  const home = shape.homeTeamSeasonId;
  const away = shape.awayTeamSeasonId;
  const external = shape.externalOpponentName?.trim() || null;

  if (home !== null && home === away) return { valid: false, error: "Une équipe ne peut pas jouer contre elle-même" };
  if (home && away && external) return { valid: false, error: "Choisissez un adversaire D3 OU un nom libre, pas les deux" };
  if (!home && !away) return { valid: false, error: "Au moins une équipe D3 est requise" };
  const exactlyOneD3 = (home !== null) !== (away !== null);
  if (exactlyOneD3 && !external) return { valid: false, error: "Adversaire requis : choisissez une équipe D3 ou saisissez un nom" };
  return { valid: true };
}

/** Client-side mirror of the `matches` score/status CHECK constraint. */
export function validateScore(homeScore: number | null, awayScore: number | null): ValidationResult {
  if (homeScore === null || awayScore === null) return { valid: false, error: "Les deux scores sont requis" };
  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore)) return { valid: false, error: "Le score doit être un nombre entier" };
  if (homeScore < 0 || awayScore < 0) return { valid: false, error: "Le score ne peut pas être négatif" };
  return { valid: true };
}

const ALLOWED_TRANSITIONS: Record<MatchStatus, MatchStatus[]> = {
  SCHEDULED: ["PLAYED", "POSTPONED", "CANCELLED"],
  PLAYED: ["PLAYED"], // a correction re-enters PLAYED; the schedule itself is frozen
  POSTPONED: ["SCHEDULED", "PLAYED", "CANCELLED"],
  CANCELLED: [],
};

export function canTransition(from: MatchStatus, to: MatchStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function canEditSchedule(status: MatchStatus): boolean {
  return status === "SCHEDULED" || status === "POSTPONED";
}

export function canEnterResult(status: MatchStatus): boolean {
  return status === "SCHEDULED" || status === "PLAYED";
}

// ----------------------------------------------------------------------------
// Europe/Paris <-> UTC. France is CET (UTC+1) in winter and CEST (UTC+2) in
// summer; a <input type="datetime-local"> always gives wall-clock numbers
// with no timezone attached, and Supabase/Postgres always want UTC. Doing
// this with Intl (no date library) by asking "what offset applies at this
// approximate instant" and correcting once -- exact except inside the ~1h
// DST-transition gap/overlap itself, which no real match kickoff falls in.
// ----------------------------------------------------------------------------

function parisOffsetMinutesAt(utcMillis: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMillis));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asIfUtc - utcMillis) / 60000);
}

/** "2026-07-15T18:30" (Paris wall-clock, from a datetime-local input) -> UTC ISO string. */
export function parisLocalToUtcIso(localDateTimeValue: string): string {
  const [datePart, timePart] = localDateTimeValue.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = (timePart ?? "00:00").split(":").map(Number);
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMinutes = parisOffsetMinutesAt(naiveUtc);
  return new Date(naiveUtc - offsetMinutes * 60000).toISOString();
}

/** UTC ISO string -> "2026-07-15T18:30" for pre-filling a datetime-local input in Paris time. */
export function utcIsoToParisLocalInput(isoUtc: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(isoUtc));
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** Human-readable French display, always in Paris local time regardless of server/viewer timezone. */
export function formatKickoffParis(isoUtc: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" }).format(new Date(isoUtc));
}

// ----------------------------------------------------------------------------
// Duplicate detection: warn, never auto-merge. `candidate` is always
// expressed from "our team"'s point of view -- the data layer resolves
// which side of each existing match is the opponent before calling this,
// so home/away inversion between two submissions of the same fixture is
// transparent here.
// ----------------------------------------------------------------------------

export interface MatchCandidate {
  id: string;
  kickoffAt: string;
  opponentTeamSeasonId: string | null;
  externalOpponentName: string | null;
}

export function normalizeOpponentName(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isProbableDuplicate(
  candidate: MatchCandidate,
  input: { opponentTeamSeasonId: string | null; externalOpponentName: string | null; kickoffAt: string },
  toleranceDays = 3
): boolean {
  const daysApart = Math.abs(new Date(candidate.kickoffAt).getTime() - new Date(input.kickoffAt).getTime()) / 86400000;
  if (daysApart > toleranceDays) return false;
  if (input.opponentTeamSeasonId) return candidate.opponentTeamSeasonId === input.opponentTeamSeasonId;
  if (input.externalOpponentName && candidate.externalOpponentName) {
    return normalizeOpponentName(candidate.externalOpponentName) === normalizeOpponentName(input.externalOpponentName);
  }
  return false;
}
