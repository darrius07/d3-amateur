// Pure, unit-testable Step 6C club-sponsor logic: tier labels/ordering,
// validation mirroring the DB (add_club_sponsor/update_club_sponsor RPCs +
// CHECK constraints), and the display grouping used by both the Club
// Studio module and the public club page. website validation is the exact
// same https-only rule as Step 6A (lib/clubs/profile.ts) -- re-exported
// here rather than duplicated, so both features can never drift apart.
import { validateExternalUrl } from "../clubs/profile";

export type SponsorTier = "MAIN" | "PREMIUM" | "PARTNER" | "SUPPORTER" | "OTHER";

export const SPONSOR_TIERS: SponsorTier[] = ["MAIN", "PREMIUM", "PARTNER", "SUPPORTER", "OTHER"];

/** French UI labels (mission section 5) -- "Partenaire", never a paid-tier name like "Gold/Silver". */
export const SPONSOR_TIER_LABELS: Record<SponsorTier, string> = {
  MAIN: "Partenaire principal",
  PREMIUM: "Partenaire premium",
  PARTNER: "Partenaire",
  SUPPORTER: "Soutien",
  OTHER: "Autre",
};

/** The tier's own label for OTHER, else the custom label a club typed for a normally-fixed tier -- what a card actually displays. Never "D3 Sponsor" or anything implying certification (mission section 6). */
export function tierDisplayLabel(tier: SponsorTier, customLabel: string | null): string {
  if (tier === "OTHER") return customLabel?.trim() || SPONSOR_TIER_LABELS.OTHER;
  return SPONSOR_TIER_LABELS[tier];
}

/** Deterministic default rank at creation (mirrors add_club_sponsor's CASE exactly) -- MAIN gets visual weight first, mission section 19. */
export function defaultSortOrderForTier(tier: SponsorTier): number {
  switch (tier) {
    case "MAIN": return 10;
    case "PREMIUM": return 20;
    case "PARTNER": return 30;
    case "SUPPORTER": return 40;
    default: return 90;
  }
}

export interface ValidationResult { valid: boolean; error?: string }

const SPONSOR_NAME_MAX = 120;
export const SHORT_MESSAGE_MAX = 160;

/** Mirrors the sponsors.name CHECK: required, whitespace normalized, reasonable length. */
export function validateSponsorName(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (!value) return { valid: false, error: "Le nom du partenaire est requis" };
  if (value.length > SPONSOR_NAME_MAX) return { valid: false, error: `${SPONSOR_NAME_MAX} caractères maximum` };
  return { valid: true };
}

/** Mirrors the club_sponsors.short_message CHECK. Plain text only -- rendered as text, never interpreted as HTML/markdown. */
export function validateShortMessage(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (value.length > SHORT_MESSAGE_MAX) return { valid: false, error: `${SHORT_MESSAGE_MAX} caractères maximum` };
  return { valid: true };
}

/** Mirrors the OTHER/custom_tier_label CHECK constraint exactly. */
export function validateCustomTierLabel(tier: SponsorTier, customLabel: string | null | undefined): ValidationResult {
  const value = (customLabel ?? "").trim();
  if (tier === "OTHER" && !value) return { valid: false, error: 'Précisez le niveau pour "Autre"' };
  return { valid: true };
}

/** https:// only, same rule as Step 6A -- re-exported so callers need one import for both sponsor and club-profile URL fields. */
export const validateSponsorWebsite = validateExternalUrl;

export interface SponsorEntry {
  id: string;
  name: string;
  tier: SponsorTier;
  customTierLabel: string | null;
  logoPath: string | null;
  websiteUrl: string | null;
  shortMessage: string | null;
  sortOrder: number;
}

function sponsorSortKey(sponsor: SponsorEntry): [number, number, string] {
  return [defaultSortOrderForTier(sponsor.tier), sponsor.sortOrder, sponsor.name.toLocaleLowerCase("fr")];
}

export interface SponsorTierGroup {
  tier: SponsorTier;
  label: string;
  sponsors: SponsorEntry[];
}

/** Groups sponsors by tier (MAIN first, mission section 19), each internally sorted -- the exact shape both the Studio module and the public page render. Empty tiers are omitted, never rendered as an empty group. */
export function groupSponsorsByTier(sponsors: SponsorEntry[]): SponsorTierGroup[] {
  const sorted = [...sponsors].sort((a, b) => {
    const ka = sponsorSortKey(a), kb = sponsorSortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
  const groups: SponsorTierGroup[] = [];
  for (const tier of SPONSOR_TIERS) {
    const inTier = sorted.filter((s) => s.tier === tier);
    if (inTier.length) groups.push({ tier, label: SPONSOR_TIER_LABELS[tier], sponsors: inTier });
  }
  return groups;
}

export const NO_SPONSORS_STUDIO_MESSAGE = "Mettez en avant les partenaires qui soutiennent votre club.";

/** "Boulangerie Martin" -> "BM" -- same initials placeholder language as staff/club (mission section 20: no photo/logo, clean initials). */
export function sponsorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
