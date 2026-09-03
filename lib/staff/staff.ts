// Pure, unit-testable Step 6B club-staff logic: role labels/ordering,
// validation mirroring the DB (add_club_staff/update_club_staff RPCs +
// club_staff CHECK constraints), and the display grouping used by both the
// Club Studio module and the public club page.

export type StaffRole =
  | "PRESIDENT" | "HEAD_COACH" | "ASSISTANT_COACH" | "SPORTING_DIRECTOR"
  | "GOALKEEPER_COACH" | "TEAM_MANAGER" | "PHYSIO" | "COMMUNICATION" | "OTHER";

export const STAFF_ROLES: StaffRole[] = [
  "PRESIDENT", "SPORTING_DIRECTOR", "COMMUNICATION", "HEAD_COACH",
  "ASSISTANT_COACH", "GOALKEEPER_COACH", "TEAM_MANAGER", "PHYSIO", "OTHER",
];

/** French UI labels (mission section 6) -- never the raw enum value in a rendered page. */
export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  PRESIDENT: "Président",
  HEAD_COACH: "Entraîneur",
  ASSISTANT_COACH: "Entraîneur adjoint",
  SPORTING_DIRECTOR: "Directeur sportif",
  GOALKEEPER_COACH: "Entraîneur des gardiens",
  TEAM_MANAGER: "Responsable d'équipe",
  PHYSIO: "Kiné / Physiothérapeute",
  COMMUNICATION: "Communication",
  OTHER: "Autre",
};

/** The role's own label for OTHER, else the custom_role a club typed in for a normally-fixed role -- what a card actually displays. */
export function roleDisplayLabel(role: StaffRole, customRole: string | null): string {
  if (role === "OTHER") return customRole?.trim() || STAFF_ROLE_LABELS.OTHER;
  return STAFF_ROLE_LABELS[role];
}

/** Deterministic default rank when a new member is added (mission section 15) -- mirrors add_club_staff's CASE exactly, so a freshly-added row's suggested sort_order matches the DB's own default without a round-trip. */
export function defaultSortOrderForRole(role: StaffRole): number {
  switch (role) {
    case "PRESIDENT": return 10;
    case "SPORTING_DIRECTOR": return 20;
    case "COMMUNICATION": return 25;
    case "HEAD_COACH": return 30;
    case "ASSISTANT_COACH": return 40;
    case "GOALKEEPER_COACH": return 45;
    case "TEAM_MANAGER": return 50;
    case "PHYSIO": return 60;
    default: return 90;
  }
}

export interface ValidationResult { valid: boolean; error?: string }

const DISPLAY_NAME_MAX = 120;
export const SHORT_BIO_MAX = 280;

/** Mirrors the club_staff display_name CHECK: required, whitespace normalized, reasonable length. */
export function validateStaffDisplayName(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (!value) return { valid: false, error: "Le nom affiché est requis" };
  if (value.length > DISPLAY_NAME_MAX) return { valid: false, error: `${DISPLAY_NAME_MAX} caractères maximum` };
  return { valid: true };
}

/** Mirrors the club_staff short_bio CHECK. Plain text only -- rendered as text (React auto-escapes), never dangerouslySetInnerHTML, so HTML/markdown a club types is never interpreted (mission section 10). */
export function validateShortBio(raw: string | null | undefined): ValidationResult {
  const value = (raw ?? "").trim();
  if (value.length > SHORT_BIO_MAX) return { valid: false, error: `${SHORT_BIO_MAX} caractères maximum` };
  return { valid: true };
}

/** Mirrors the OTHER/custom_role CHECK constraint exactly. */
export function validateCustomRole(role: StaffRole, customRole: string | null | undefined): ValidationResult {
  const value = (customRole ?? "").trim();
  if (role === "OTHER" && !value) return { valid: false, error: 'Précisez la fonction pour "Autre"' };
  return { valid: true };
}

/** Mirrors validate_club_staff_team(): a team_season may only be attached to staff of the club it actually belongs to. Pure helper for instant client-side feedback -- the DB trigger is the real authority. */
export function validateStaffTeamOwnership(teamSeasonClubId: string | null, staffClubId: string): ValidationResult {
  if (teamSeasonClubId === null) return { valid: true };
  if (teamSeasonClubId !== staffClubId) return { valid: false, error: "Cette équipe n'appartient pas à ce club" };
  return { valid: true };
}

export interface StaffMember {
  id: string;
  teamSeasonId: string | null;
  displayName: string;
  role: StaffRole;
  customRole: string | null;
  shortBio: string | null;
  publicVisible: boolean;
  sortOrder: number;
}

/** Sort key: role rank first (President/direction before coaches before others -- mission section 15), then explicit sort_order, then name, so ties are never arbitrary/unstable. */
function staffSortKey(member: StaffMember): [number, number, string] {
  return [defaultSortOrderForRole(member.role), member.sortOrder, member.displayName.toLocaleLowerCase("fr")];
}

export interface GroupedStaff<TeamInfo> {
  clubWide: StaffMember[];
  byTeam: { team: TeamInfo; members: StaffMember[] }[];
}

/** Splits a flat staff list into club-wide (Direction) and per-team (Encadrement sportif) groups, each internally sorted -- the exact shape both the Studio module and the public page render (mission sections 12, 17). teams: id -> display info, in the desired team order. */
export function groupStaffForDisplay<TeamInfo extends { id: string }>(members: StaffMember[], teams: TeamInfo[]): GroupedStaff<TeamInfo> {
  const sorted = [...members].sort((a, b) => {
    const ka = staffSortKey(a), kb = staffSortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
  const clubWide = sorted.filter((m) => m.teamSeasonId === null);
  const byTeam = teams
    .map((team) => ({ team, members: sorted.filter((m) => m.teamSeasonId === team.id) }))
    .filter((group) => group.members.length > 0);
  return { clubWide, byTeam };
}

export const NO_STAFF_STUDIO_MESSAGE = "Ajoutez les personnes qui font vivre votre club.";

/** "Jean Dupont" -> "JD" -- the avatar placeholder for a real person, same visual language as the club's own "D3" initials mark (mission section 11: initials avatar, no photo upload this step). */
export function staffInitials(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
