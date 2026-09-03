import { describe, expect, it } from "vitest";
import {
  defaultSortOrderForRole,
  groupStaffForDisplay,
  roleDisplayLabel,
  staffInitials,
  validateCustomRole,
  validateShortBio,
  validateStaffDisplayName,
  validateStaffTeamOwnership,
  type StaffMember,
} from "./staff";

describe("staffInitials", () => {
  it("takes first+last name initials", () => expect(staffInitials("Jean Dupont")).toBe("JD"));
  it("handles a long name with a middle name", () => expect(staffInitials("Jean-Baptiste de la Fontaine")).toBe("JF"));
  it("handles a single-word name", () => expect(staffInitials("Madonna")).toBe("MA"));
  it("handles empty input without throwing", () => expect(staffInitials("   ")).toBe("?"));
});

describe("validateStaffDisplayName", () => {
  it("rejects empty", () => expect(validateStaffDisplayName("").valid).toBe(false));
  it("rejects whitespace-only", () => expect(validateStaffDisplayName("   ").valid).toBe(false));
  it("accepts a normal name", () => expect(validateStaffDisplayName("Jean Dupont").valid).toBe(true));
  it("accepts a long realistic name", () => expect(validateStaffDisplayName("Jean-Baptiste de la Fontaine-Rousseau").valid).toBe(true));
  it("rejects an oversized name", () => expect(validateStaffDisplayName("x".repeat(121)).valid).toBe(false));
  it("accepts the max length", () => expect(validateStaffDisplayName("x".repeat(120)).valid).toBe(true));
});

describe("validateShortBio (short bio limit)", () => {
  it("accepts empty (optional)", () => expect(validateShortBio("").valid).toBe(true));
  it("accepts up to 280 chars", () => expect(validateShortBio("x".repeat(280)).valid).toBe(true));
  it("rejects 281 chars", () => expect(validateShortBio("x".repeat(281)).valid).toBe(false));
  it("accepts a bio near the limit with real content", () => {
    const bio = "Entraîneur de l'équipe Seniors A depuis 2024. ".repeat(5).slice(0, 279);
    expect(validateShortBio(bio).valid).toBe(true);
  });
});

describe("validateCustomRole (OTHER/custom_role)", () => {
  it("requires custom_role when role is OTHER", () => expect(validateCustomRole("OTHER", null).valid).toBe(false));
  it("requires non-blank custom_role when role is OTHER", () => expect(validateCustomRole("OTHER", "   ").valid).toBe(false));
  it("accepts OTHER with a custom_role", () => expect(validateCustomRole("OTHER", "Responsable buvette").valid).toBe(true));
  it("accepts a long but valid custom_role", () => expect(validateCustomRole("OTHER", "Responsable des relations avec les partenaires et sponsors locaux").valid).toBe(true));
  it("does not require custom_role for a normal role", () => expect(validateCustomRole("HEAD_COACH", null).valid).toBe(true));
});

describe("validateStaffTeamOwnership (team-club integrity helper)", () => {
  it("accepts club-wide staff (no team)", () => expect(validateStaffTeamOwnership(null, "club-a").valid).toBe(true));
  it("accepts a team belonging to the same club", () => expect(validateStaffTeamOwnership("club-a", "club-a").valid).toBe(true));
  it("rejects a team belonging to a different club", () => expect(validateStaffTeamOwnership("club-b", "club-a").valid).toBe(false));
});

describe("role labels", () => {
  it("returns the French label for a fixed role", () => expect(roleDisplayLabel("PRESIDENT", null)).toBe("Président"));
  it("returns the custom_role text for OTHER", () => expect(roleDisplayLabel("OTHER", "Responsable buvette")).toBe("Responsable buvette"));
  it("falls back to 'Autre' if OTHER somehow has no custom_role", () => expect(roleDisplayLabel("OTHER", null)).toBe("Autre"));
});

describe("defaultSortOrderForRole (deterministic ranking)", () => {
  it("ranks Président before Directeur sportif", () => expect(defaultSortOrderForRole("PRESIDENT")).toBeLessThan(defaultSortOrderForRole("SPORTING_DIRECTOR")));
  it("ranks Directeur sportif before Entraîneur", () => expect(defaultSortOrderForRole("SPORTING_DIRECTOR")).toBeLessThan(defaultSortOrderForRole("HEAD_COACH")));
  it("ranks Entraîneur before Entraîneur adjoint", () => expect(defaultSortOrderForRole("HEAD_COACH")).toBeLessThan(defaultSortOrderForRole("ASSISTANT_COACH")));
  it("ranks every fixed role before Autre", () => {
    for (const role of ["PRESIDENT", "HEAD_COACH", "ASSISTANT_COACH", "SPORTING_DIRECTOR", "GOALKEEPER_COACH", "TEAM_MANAGER", "PHYSIO", "COMMUNICATION"] as const) {
      expect(defaultSortOrderForRole(role)).toBeLessThan(defaultSortOrderForRole("OTHER"));
    }
  });
});

describe("groupStaffForDisplay (sorting/grouping/safe public projection shape)", () => {
  const member = (over: Partial<StaffMember>): StaffMember => ({
    id: over.id ?? "id", teamSeasonId: over.teamSeasonId ?? null, displayName: over.displayName ?? "Name",
    role: over.role ?? "OTHER", customRole: over.customRole ?? null, shortBio: over.shortBio ?? null,
    publicVisible: over.publicVisible ?? true, sortOrder: over.sortOrder ?? 0,
  });

  it("splits club-wide staff from team-specific staff", () => {
    const staff = [
      member({ id: "1", displayName: "Jean Dupont", role: "PRESIDENT" }),
      member({ id: "2", displayName: "Marc Martin", role: "HEAD_COACH", teamSeasonId: "team-a" }),
    ];
    const result = groupStaffForDisplay(staff, [{ id: "team-a", label: "Seniors A" }]);
    expect(result.clubWide.map((m) => m.id)).toEqual(["1"]);
    expect(result.byTeam).toHaveLength(1);
    expect(result.byTeam[0].members.map((m) => m.id)).toEqual(["2"]);
  });

  it("orders club-wide staff by role rank (Président before Communication)", () => {
    const staff = [
      member({ id: "comm", displayName: "Alice", role: "COMMUNICATION" }),
      member({ id: "pres", displayName: "Bob", role: "PRESIDENT" }),
    ];
    const result = groupStaffForDisplay(staff, []);
    expect(result.clubWide.map((m) => m.id)).toEqual(["pres", "comm"]);
  });

  it("orders same-role members by explicit sort_order", () => {
    const staff = [
      member({ id: "second", displayName: "B Coach", role: "HEAD_COACH", teamSeasonId: "t", sortOrder: 2 }),
      member({ id: "first", displayName: "A Coach", role: "HEAD_COACH", teamSeasonId: "t", sortOrder: 1 }),
    ];
    const result = groupStaffForDisplay(staff, [{ id: "t", label: "Seniors A" }]);
    expect(result.byTeam[0].members.map((m) => m.id)).toEqual(["first", "second"]);
  });

  it("omits a team group entirely when it has no staff", () => {
    const result = groupStaffForDisplay([], [{ id: "team-a", label: "Seniors A" }, { id: "team-b", label: "Seniors B" }]);
    expect(result.byTeam).toEqual([]);
  });

  it("a person can appear in multiple entries (club-wide and team) without merging", () => {
    const staff = [
      member({ id: "1", displayName: "Jean Dupont", role: "PRESIDENT" }),
      member({ id: "2", displayName: "Jean Dupont", role: "HEAD_COACH", teamSeasonId: "t" }),
    ];
    const result = groupStaffForDisplay(staff, [{ id: "t", label: "Seniors A" }]);
    expect(result.clubWide).toHaveLength(1);
    expect(result.byTeam[0].members).toHaveLength(1);
  });
});
