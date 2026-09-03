import { describe, expect, it } from "vitest";
import {
  defaultSortOrderForTier,
  groupSponsorsByTier,
  sponsorInitials,
  tierDisplayLabel,
  validateCustomTierLabel,
  validateShortMessage,
  validateSponsorName,
  validateSponsorWebsite,
  type SponsorEntry,
} from "./sponsors";
import { sponsorLogoPath } from "./sponsor-logo";

describe("validateSponsorName", () => {
  it("rejects empty", () => expect(validateSponsorName("").valid).toBe(false));
  it("rejects whitespace-only", () => expect(validateSponsorName("   ").valid).toBe(false));
  it("accepts a normal name", () => expect(validateSponsorName("Boulangerie Martin").valid).toBe(true));
  it("rejects an oversized name", () => expect(validateSponsorName("x".repeat(121)).valid).toBe(false));
  it("accepts the max length", () => expect(validateSponsorName("x".repeat(120)).valid).toBe(true));
});

describe("validateShortMessage (short_message limit)", () => {
  it("accepts empty (optional)", () => expect(validateShortMessage("").valid).toBe(true));
  it("accepts up to 160 chars", () => expect(validateShortMessage("x".repeat(160)).valid).toBe(true));
  it("rejects 161 chars", () => expect(validateShortMessage("x".repeat(161)).valid).toBe(false));
  it("accepts a realistic message", () => expect(validateShortMessage("Partenaire historique du club depuis 2019.").valid).toBe(true));
});

describe("validateCustomTierLabel (OTHER/custom_tier_label)", () => {
  it("requires custom_tier_label when tier is OTHER", () => expect(validateCustomTierLabel("OTHER", null).valid).toBe(false));
  it("requires non-blank custom_tier_label when tier is OTHER", () => expect(validateCustomTierLabel("OTHER", "  ").valid).toBe(false));
  it("accepts OTHER with a custom_tier_label", () => expect(validateCustomTierLabel("OTHER", "Fournisseur officiel").valid).toBe(true));
  it("does not require custom_tier_label for a normal tier", () => expect(validateCustomTierLabel("MAIN", null).valid).toBe(true));
});

describe("validateSponsorWebsite (https-only, same rule as Step 6A)", () => {
  it("accepts https", () => expect(validateSponsorWebsite("https://boulangerie-martin.example.com").valid).toBe(true));
  it("rejects http", () => expect(validateSponsorWebsite("http://example.com").valid).toBe(false));
  it("rejects javascript:", () => expect(validateSponsorWebsite("javascript:alert(1)").valid).toBe(false));
  it("rejects data:", () => expect(validateSponsorWebsite("data:text/html,test").valid).toBe(false));
  it("rejects file:", () => expect(validateSponsorWebsite("file:///tmp/test").valid).toBe(false));
  it("rejects ftp:", () => expect(validateSponsorWebsite("ftp://example.com").valid).toBe(false));
  it("rejects protocol-relative", () => expect(validateSponsorWebsite("//example.com").valid).toBe(false));
  it("accepts empty (nullable)", () => expect(validateSponsorWebsite("").valid).toBe(true));
});

describe("tier labels", () => {
  it("returns the French label for a fixed tier", () => expect(tierDisplayLabel("MAIN", null)).toBe("Partenaire principal"));
  it("returns the custom label for OTHER", () => expect(tierDisplayLabel("OTHER", "Fournisseur officiel")).toBe("Fournisseur officiel"));
  it("falls back to 'Autre' if OTHER somehow has no custom label", () => expect(tierDisplayLabel("OTHER", null)).toBe("Autre"));
  it("never renders a label implying D3 certification or a paid product", () => {
    for (const tier of ["MAIN", "PREMIUM", "PARTNER", "SUPPORTER"] as const) {
      expect(tierDisplayLabel(tier, null).toLowerCase()).not.toContain("d3");
      expect(tierDisplayLabel(tier, null).toLowerCase()).not.toMatch(/gold|silver|bronze|certifi/);
    }
  });
});

describe("defaultSortOrderForTier (deterministic ranking, MAIN first)", () => {
  it("ranks MAIN before PREMIUM", () => expect(defaultSortOrderForTier("MAIN")).toBeLessThan(defaultSortOrderForTier("PREMIUM")));
  it("ranks PREMIUM before PARTNER", () => expect(defaultSortOrderForTier("PREMIUM")).toBeLessThan(defaultSortOrderForTier("PARTNER")));
  it("ranks PARTNER before SUPPORTER", () => expect(defaultSortOrderForTier("PARTNER")).toBeLessThan(defaultSortOrderForTier("SUPPORTER")));
  it("ranks every fixed tier before OTHER", () => {
    for (const tier of ["MAIN", "PREMIUM", "PARTNER", "SUPPORTER"] as const) {
      expect(defaultSortOrderForTier(tier)).toBeLessThan(defaultSortOrderForTier("OTHER"));
    }
  });
});

describe("groupSponsorsByTier (sorting/grouping/safe public projection shape)", () => {
  const sponsor = (over: Partial<SponsorEntry>): SponsorEntry => ({
    id: over.id ?? "id", name: over.name ?? "Sponsor", tier: over.tier ?? "PARTNER", customTierLabel: over.customTierLabel ?? null,
    logoPath: over.logoPath ?? null, websiteUrl: over.websiteUrl ?? null, shortMessage: over.shortMessage ?? null, sortOrder: over.sortOrder ?? 0,
  });

  it("groups MAIN before PARTNER", () => {
    const sponsors = [sponsor({ id: "p", name: "Garage Dupont", tier: "PARTNER" }), sponsor({ id: "m", name: "Boulangerie Martin", tier: "MAIN" })];
    const groups = groupSponsorsByTier(sponsors);
    expect(groups.map((g) => g.tier)).toEqual(["MAIN", "PARTNER"]);
  });

  it("orders same-tier sponsors by explicit sort_order", () => {
    const sponsors = [sponsor({ id: "second", name: "B Corp", tier: "PARTNER", sortOrder: 2 }), sponsor({ id: "first", name: "A Corp", tier: "PARTNER", sortOrder: 1 })];
    const groups = groupSponsorsByTier(sponsors);
    expect(groups[0].sponsors.map((s) => s.id)).toEqual(["first", "second"]);
  });

  it("omits a tier group entirely when it has no sponsors", () => {
    const groups = groupSponsorsByTier([sponsor({ tier: "MAIN" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tier).toBe("MAIN");
  });

  it("returns an empty array for no sponsors, never a placeholder group", () => {
    expect(groupSponsorsByTier([])).toEqual([]);
  });
});

describe("sponsorInitials", () => {
  it("takes first+last word initials", () => expect(sponsorInitials("Boulangerie Martin")).toBe("BM"));
  it("handles a single-word business name", () => expect(sponsorInitials("Decathlon")).toBe("DE"));
  it("handles empty input without throwing", () => expect(sponsorInitials("   ")).toBe("?"));
});

describe("sponsorLogoPath (storage path safety)", () => {
  const clubId = "11111111-1111-1111-1111-111111111111";
  const sponsorId = "22222222-2222-2222-2222-222222222222";
  const fileId = "33333333-3333-3333-3333-333333333333";

  it("builds the documented path shape sponsors/{club_id}/{club_sponsor_id}/{filename}", () => {
    expect(sponsorLogoPath(clubId, sponsorId, fileId, "png")).toBe(`sponsors/${clubId}/${sponsorId}/${fileId}.png`);
  });
  it("rejects a non-UUID club_id (defends against path traversal / raw user input)", () => {
    expect(() => sponsorLogoPath("../../etc/passwd", sponsorId, fileId, "png")).toThrow();
  });
  it("rejects a non-UUID club_sponsor_id", () => {
    expect(() => sponsorLogoPath(clubId, "not-a-uuid", fileId, "png")).toThrow();
  });
  it("rejects an extension outside the allow-list", () => {
    expect(() => sponsorLogoPath(clubId, sponsorId, fileId, "svg")).toThrow();
    expect(() => sponsorLogoPath(clubId, sponsorId, fileId, "exe")).toThrow();
  });
});
