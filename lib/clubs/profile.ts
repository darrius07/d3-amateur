// Pure, unit-testable Step 6A club-profile logic: the same validation rules
// enforced by update_club_profile()/club_profiles CHECK constraints (the
// real authority), mirrored here for instant client-side feedback, plus the
// completeness model and the contrast-safe color helpers used across the
// Club Studio profile editor, the live preview, and the public club page.

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Every optional text field is normalized the same way server-side (trim, empty string -> NULL) -- mirrored here so the UI can preview exactly what will be saved. */
export function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length ? trimmed : null;
}

const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Mirrors the club_profiles primary_color/secondary_color CHECK constraint. Empty is valid (nullable) -- only a non-empty, malformed value is rejected. */
export function validateHexColor(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (!value) return { valid: true };
  if (!HEX_COLOR_PATTERN.test(value)) return { valid: false, error: "Couleur invalide — format attendu #RRGGBB" };
  return { valid: true };
}

// https:// ONLY (mission requirement) -- no http://, no javascript:/data:/
// file:/ftp:/arbitrary scheme, no protocol-relative "//host", no whitespace
// or characters that could break out of an HTML attribute. Mirrors
// is_safe_external_url() exactly.
const SAFE_URL_PATTERN = /^https:\/\/[^\s<>"']+$/i;

/** Mirrors is_safe_external_url(). Empty is valid (nullable). */
export function validateExternalUrl(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (!value) return { valid: true };
  if (value.length > 2048) return { valid: false, error: "Lien trop long" };
  if (!SAFE_URL_PATTERN.test(value)) return { valid: false, error: "Lien invalide — doit commencer par https://" };
  return { valid: true };
}

export const SHORT_DESCRIPTION_MAX = 200;
export const LONG_DESCRIPTION_MAX = 2000;

export function validateShortDescription(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (value.length > SHORT_DESCRIPTION_MAX) return { valid: false, error: `${SHORT_DESCRIPTION_MAX} caractères maximum` };
  return { valid: true };
}

export function validateLongDescription(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (value.length > LONG_DESCRIPTION_MAX) return { valid: false, error: `${LONG_DESCRIPTION_MAX} caractères maximum` };
  return { valid: true };
}

const EARLIEST_FOUNDED_YEAR = 1850;

/** Mirrors the founded_year CHECK constraint (1850..current year). Empty is valid. */
export function validateFoundedYear(raw: string | number | null | undefined): ValidationResult {
  if (raw === null || raw === undefined || raw === "") return { valid: true };
  const year = typeof raw === "number" ? raw : Number(raw);
  const currentYear = new Date().getFullYear();
  if (!Number.isInteger(year) || year < EARLIEST_FOUNDED_YEAR || year > currentYear) {
    return { valid: false, error: `Année invalide (entre ${EARLIEST_FOUNDED_YEAR} et ${currentYear})` };
  }
  return { valid: true };
}

const DISPLAY_NAME_MAX = 120;

/** Mirrors update_club_profile()'s display_name checks: required, reasonable max length. Never touches official_name (mission section 8). */
export function validateDisplayName(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (!value) return { valid: false, error: "Le nom affiché est requis" };
  if (value.length > DISPLAY_NAME_MAX) return { valid: false, error: `${DISPLAY_NAME_MAX} caractères maximum` };
  return { valid: true };
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Mirrors the public_email CHECK constraint -- a light shape check, not full RFC 5322. Empty is valid. */
export function validateEmail(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (!value) return { valid: true };
  if (!EMAIL_PATTERN.test(value)) return { valid: false, error: "Adresse email invalide" };
  return { valid: true };
}

/** Deliberately permissive (mission section 34: "Ne sur-valide pas les téléphones internationaux") -- just digits, spaces, and the usual separators, a plausible length. */
export function validatePhone(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (!value) return { valid: true };
  const digitCount = (value.match(/\d/g) ?? []).length;
  if (digitCount < 6 || digitCount > 15) return { valid: false, error: "Numéro de téléphone invalide" };
  if (!/^[+0-9()\-.\s]+$/.test(value)) return { valid: false, error: "Numéro de téléphone invalide" };
  return { valid: true };
}

const POSTAL_CODE_PATTERN = /^[0-9]{4,10}$/;

/** Mirrors the venue_postal_code CHECK constraint. Empty is valid. */
export function validatePostalCode(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (!value) return { valid: true };
  if (!POSTAL_CODE_PATTERN.test(value)) return { valid: false, error: "Code postal invalide" };
  return { valid: true };
}

// ----------------------------------------------------------------------------
// Contrast-safe color helpers (mission section 15): a club's own color is
// welcome as an accent/background, but text placed on it always goes
// through this to pick black or white, whichever has better WCAG contrast
// -- a user's color choice can never make a label unreadable.
// ----------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** WCAG contrast ratio between two hex colors, from 1 (identical) to 21 (black on white). */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Whichever of pure black/white reads better on this background -- never a fixed assumption. */
export function pickReadableTextColor(backgroundHex: string): "#000000" | "#FFFFFF" {
  return contrastRatio(backgroundHex, "#FFFFFF") >= contrastRatio(backgroundHex, "#000000") ? "#FFFFFF" : "#000000";
}

// ----------------------------------------------------------------------------
// Completeness (mission sections 10, 27): 8 explicit, deterministic
// criteria. No hidden formula, no points, no XP -- just what is documented
// vs. what is missing.
// ----------------------------------------------------------------------------

export interface ClubCompletenessInput {
  hasLogo: boolean;
  hasShortDescription: boolean;
  hasColors: boolean;
  hasWebOrSocial: boolean;
  hasPublicContact: boolean;
  hasVenue: boolean;
  hasActiveTeam: boolean;
  hasRosterOrMatch: boolean;
}

export interface CompletenessItem {
  key: keyof ClubCompletenessInput;
  label: string;
  done: boolean;
}

export interface ClubCompleteness {
  completed: number;
  total: number;
  percent: number;
  items: CompletenessItem[];
}

const COMPLETENESS_CRITERIA: { key: keyof ClubCompletenessInput; label: string }[] = [
  { key: "hasLogo", label: "Logo" },
  { key: "hasShortDescription", label: "Présentation" },
  { key: "hasColors", label: "Couleurs" },
  { key: "hasWebOrSocial", label: "Réseaux ou site" },
  { key: "hasPublicContact", label: "Contact public" },
  { key: "hasVenue", label: "Stade" },
  { key: "hasActiveTeam", label: "Équipe active" },
  { key: "hasRosterOrMatch", label: "Effectif ou match" },
];

export function computeClubCompleteness(input: ClubCompletenessInput): ClubCompleteness {
  const items = COMPLETENESS_CRITERIA.map(({ key, label }) => ({ key, label, done: Boolean(input[key]) }));
  const completed = items.filter((i) => i.done).length;
  return { completed, total: items.length, percent: Math.round((completed / items.length) * 100), items };
}
