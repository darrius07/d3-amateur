// Pure, unit-testable Step 6D logic: club-creation-request validation, the
// same duplicate-classification rule the DB trigger/RPC apply (mirrored
// here for instant client-side feedback -- the DB is always the real
// authority), slug generation, status-transition rules, and safe
// projections that keep admin-only fields away from the requester.
import { normalizeClubName } from "./registry";
import { normalizeOptionalText, validateExternalUrl, validatePostalCode } from "./profile";

export type { ValidationResult } from "./profile";
import type { ValidationResult } from "./profile";

export type ClubCreationRequestStatus = "PENDING_REVIEW" | "NEEDS_INFO" | "APPROVED" | "REJECTED" | "DUPLICATE";
export type DuplicateReviewState = "NONE" | "POSSIBLE" | "LIKELY_DUPLICATE";

export interface ClubCreationRequestInput {
  clubName: string;
  shortName?: string | null;
  city: string;
  postalCode?: string | null;
  department?: string | null;
  websiteUrl?: string | null;
  socialUrl?: string | null;
  requestedLevel?: string | null;
  requestedTeamLabel?: string | null;
  representativeConfirmation: boolean;
}

const CLUB_NAME_MAX = 120;
const CITY_MAX = 80;
const SHORT_NAME_MAX = 40;
const DEPARTMENT_MAX = 80;
const LEVEL_MAX = 80;

/** Mirrors club_creation_requests' CHECK constraints exactly -- the DB has the final word, this is only for instant form feedback. */
export function validateClubCreationRequest(input: ClubCreationRequestInput): ValidationResult {
  const name = (input.clubName ?? "").trim();
  if (name.length < 2 || name.length > CLUB_NAME_MAX) return { valid: false, error: `Le nom du club doit contenir entre 2 et ${CLUB_NAME_MAX} caractères` };

  const city = (input.city ?? "").trim();
  if (city.length < 2 || city.length > CITY_MAX) return { valid: false, error: `La ville doit contenir entre 2 et ${CITY_MAX} caractères` };

  const shortName = normalizeOptionalText(input.shortName);
  if (shortName && shortName.length > SHORT_NAME_MAX) return { valid: false, error: `Le sigle doit faire ${SHORT_NAME_MAX} caractères maximum` };

  const department = normalizeOptionalText(input.department);
  if (department && department.length > DEPARTMENT_MAX) return { valid: false, error: "Département invalide" };

  const level = normalizeOptionalText(input.requestedLevel);
  if (level && level.length > LEVEL_MAX) return { valid: false, error: "Niveau invalide" };

  const teamLabel = normalizeOptionalText(input.requestedTeamLabel);
  if (teamLabel && teamLabel.length > LEVEL_MAX) return { valid: false, error: "Équipe concernée invalide" };

  const postal = validatePostalCode(input.postalCode);
  if (!postal.valid) return postal;

  const website = validateExternalUrl(input.websiteUrl);
  if (!website.valid) return { valid: false, error: `Site officiel : ${website.error}` };

  const social = validateExternalUrl(input.socialUrl);
  if (!social.valid) return { valid: false, error: `Réseau social : ${social.error}` };

  if (!input.representativeConfirmation) {
    return { valid: false, error: "Vous devez confirmer représenter ce club ou agir avec son autorisation" };
  }

  return { valid: true };
}

// ----------------------------------------------------------------------------
// Duplicate classification -- mirrors find_duplicate_club_candidates()'s
// CASE exactly for the two deterministic tiers (exact normalized name +
// same city/postal -> LIKELY_DUPLICATE; exact normalized name alone ->
// POSSIBLE). The DB's third tier additionally catches near-matches via
// pg_trgm similarity() with no exact JS equivalent -- approximated here by
// a simple bigram (Dice coefficient) similarity, good enough for unit
// tests of the classification boundary but never authoritative: the real
// duplicate check always goes through find_duplicate_club_candidates().
// ----------------------------------------------------------------------------

export interface DuplicateCandidateInput {
  displayName: string;
  city?: string | null;
  postalCode?: string | null;
}

function bigrams(value: string): string[] {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length < 2) return clean.length ? [clean] : [];
  const grams: string[] = [];
  for (let i = 0; i < clean.length - 1; i++) grams.push(clean.slice(i, i + 2));
  return grams;
}

/** Dice coefficient over character bigrams -- a pure-JS approximation of pg_trgm similarity(), used only client-side/in tests. */
export function stringSimilarity(a: string, b: string): number {
  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  if (!gramsA.length || !gramsB.length) return gramsA.length === gramsB.length ? 1 : 0;
  const bag = new Map<string, number>();
  for (const g of gramsA) bag.set(g, (bag.get(g) ?? 0) + 1);
  let matches = 0;
  for (const g of gramsB) {
    const count = bag.get(g) ?? 0;
    if (count > 0) { matches++; bag.set(g, count - 1); }
  }
  return (2 * matches) / (gramsA.length + gramsB.length);
}

const SIMILARITY_POSSIBLE_THRESHOLD = 0.5;

/** Mirrors the SQL CASE in find_duplicate_club_candidates() exactly -- classification only, never a merge decision. The DB call is always the authoritative check; this exists for unit tests and any client-side preview. */
export function classifyDuplicateReviewState(
  candidate: DuplicateCandidateInput,
  input: { clubName: string; city?: string | null; postalCode?: string | null },
): DuplicateReviewState {
  const sameName = normalizeClubName(candidate.displayName) === normalizeClubName(input.clubName);
  if (sameName) {
    const samePostal = Boolean(input.postalCode) && input.postalCode === candidate.postalCode;
    const sameCity = Boolean(input.city) && Boolean(candidate.city) && normalizeClubName(candidate.city ?? "") === normalizeClubName(input.city ?? "");
    if (samePostal || sameCity) return "LIKELY_DUPLICATE";
    return "POSSIBLE";
  }
  if (stringSimilarity(normalizeClubName(candidate.displayName), normalizeClubName(input.clubName)) >= SIMILARITY_POSSIBLE_THRESHOLD) return "POSSIBLE";
  return "NONE";
}

// ----------------------------------------------------------------------------
// Slug generation -- mirrors approve_club_creation_request()'s deterministic
// base-slug + collision-suffix loop. The DB is authoritative (it checks
// against the live table); this is only for preview/testing.
// ----------------------------------------------------------------------------

const SLUG_MAX = 60;

export function baseSlugFor(clubName: string): string {
  const normalized = normalizeClubName(clubName).replace(/\s+/g, "-");
  return (normalized || "club").slice(0, SLUG_MAX).replace(/-+$/, "") || "club";
}

/** attempt 0 -> the base slug itself; attempt N (N>=1) -> base-N, truncated to stay within SLUG_MAX. Mirrors the SQL loop's v_suffix behavior. */
export function slugCandidateFor(clubName: string, attempt: number): string {
  const base = baseSlugFor(clubName);
  if (attempt <= 0) return base;
  return `${base.slice(0, SLUG_MAX - 3)}-${attempt}`;
}

// ----------------------------------------------------------------------------
// Status transitions -- mirrors what approve_club_creation_request() /
// resolve_club_creation_request() actually accept: only PENDING_REVIEW or
// NEEDS_INFO can move anywhere; APPROVED/REJECTED/DUPLICATE are terminal.
// ----------------------------------------------------------------------------

const RESOLVABLE_STATUSES: ClubCreationRequestStatus[] = ["PENDING_REVIEW", "NEEDS_INFO"];
const TERMINAL_DECISIONS: ClubCreationRequestStatus[] = ["APPROVED", "REJECTED", "DUPLICATE"];

export function isValidStatusTransition(from: ClubCreationRequestStatus, to: ClubCreationRequestStatus): boolean {
  if (!RESOLVABLE_STATUSES.includes(from)) return false;
  if (to === "PENDING_REVIEW") return false;
  return true;
}

export function isTerminalStatus(status: ClubCreationRequestStatus): boolean {
  return TERMINAL_DECISIONS.includes(status);
}

export const STATUS_LABEL_FR: Record<ClubCreationRequestStatus, string> = {
  PENDING_REVIEW: "En attente de revue",
  NEEDS_INFO: "Informations demandées",
  APPROVED: "Approuvée",
  REJECTED: "Refusée",
  DUPLICATE: "Doublon",
};

// ----------------------------------------------------------------------------
// Safe projections (mission sections 26, 28, 40): the requester must never
// see admin_note or any review-internal metadata beyond what they need to
// track their own request. The admin side sees everything -- no projection
// needed there beyond what the query itself selects.
// ----------------------------------------------------------------------------

export interface ClubCreationRequestRow {
  id: string;
  status: ClubCreationRequestStatus;
  clubName: string;
  city: string;
  publicMessage: string | null;
  adminNote: string | null;
  createdClubId: string | null;
  duplicateCandidateClubId: string | null;
  createdAt: string;
}

export type SafeRequesterView = Omit<ClubCreationRequestRow, "adminNote">;

/** Strips admin_note -- the one field that must never reach the requester (mission section 26). Everything else the owner is allowed to see, they already see via RLS. */
export function projectForRequester(row: ClubCreationRequestRow): SafeRequesterView {
  return {
    id: row.id,
    status: row.status,
    clubName: row.clubName,
    city: row.city,
    publicMessage: row.publicMessage,
    createdClubId: row.createdClubId,
    duplicateCandidateClubId: row.duplicateCandidateClubId,
    createdAt: row.createdAt,
  };
}
