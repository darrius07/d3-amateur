import { describe, expect, it } from "vitest";
import {
  computeClubCompleteness,
  contrastRatio,
  normalizeOptionalText,
  pickReadableTextColor,
  validateDisplayName,
  validateEmail,
  validateExternalUrl,
  validateFoundedYear,
  validateHexColor,
  validateLongDescription,
  validatePhone,
  validatePostalCode,
  validateShortDescription,
} from "./profile";

describe("normalizeOptionalText (null normalization)", () => {
  it("turns an empty string into null", () => expect(normalizeOptionalText("")).toBeNull());
  it("turns whitespace-only into null", () => expect(normalizeOptionalText("   ")).toBeNull());
  it("trims surrounding whitespace", () => expect(normalizeOptionalText("  Nantes  ")).toBe("Nantes"));
  it("passes through null/undefined as null", () => {
    expect(normalizeOptionalText(null)).toBeNull();
    expect(normalizeOptionalText(undefined)).toBeNull();
  });
});

describe("validateHexColor (color validation)", () => {
  it("accepts empty (nullable)", () => expect(validateHexColor("").valid).toBe(true));
  it("accepts a valid uppercase hex", () => expect(validateHexColor("#0057B8").valid).toBe(true));
  it("accepts a valid lowercase hex", () => expect(validateHexColor("#0057b8").valid).toBe(true));
  it("rejects a named color", () => expect(validateHexColor("blue").valid).toBe(false));
  it("rejects a 3-digit shorthand hex", () => expect(validateHexColor("#0057B8AA").valid).toBe(false));
  it("rejects a short hex", () => expect(validateHexColor("#FFF").valid).toBe(false));
  it("rejects a css function", () => expect(validateHexColor("rgb(0,87,184)").valid).toBe(false));
  it("rejects a missing #", () => expect(validateHexColor("0057B8").valid).toBe(false));
});

describe("validateExternalUrl (URL validation / security -- https:// only)", () => {
  it("accepts empty (nullable)", () => expect(validateExternalUrl("").valid).toBe(true));
  it("accepts https", () => expect(validateExternalUrl("https://instagram.com/asmontex").valid).toBe(true));
  it("accepts an uppercase HTTPS scheme", () => expect(validateExternalUrl("HTTPS://example.com").valid).toBe(true));
  it("rejects http (https-only per mission requirement)", () => expect(validateExternalUrl("http://example.com").valid).toBe(false));
  it("rejects javascript: URLs", () => expect(validateExternalUrl("javascript:alert(1)").valid).toBe(false));
  it("rejects data: URLs", () => expect(validateExternalUrl("data:text/html;base64,x").valid).toBe(false));
  it("rejects file: URLs", () => expect(validateExternalUrl("file:///etc/passwd").valid).toBe(false));
  it("rejects an arbitrary scheme", () => expect(validateExternalUrl("ftp://x.com").valid).toBe(false));
  it("rejects a protocol-relative URL", () => expect(validateExternalUrl("//example.com").valid).toBe(false));
  it("rejects a URL containing a space", () => expect(validateExternalUrl("https://example.com/a b").valid).toBe(false));
  it("rejects a URL breaking out of an HTML attribute", () => expect(validateExternalUrl(`https://x.com"onmouseover=alert(1)`).valid).toBe(false));
  it("rejects an oversized URL", () => expect(validateExternalUrl("https://x.com/" + "a".repeat(2050)).valid).toBe(false));
});

describe("description limits", () => {
  it("short description accepts up to 200 chars", () => expect(validateShortDescription("x".repeat(200)).valid).toBe(true));
  it("short description rejects 201 chars", () => expect(validateShortDescription("x".repeat(201)).valid).toBe(false));
  it("long description accepts up to 2000 chars", () => expect(validateLongDescription("x".repeat(2000)).valid).toBe(true));
  it("long description rejects 2001 chars", () => expect(validateLongDescription("x".repeat(2001)).valid).toBe(false));
});

describe("validateFoundedYear", () => {
  it("accepts empty (nullable)", () => expect(validateFoundedYear("").valid).toBe(true));
  it("accepts a plausible year", () => expect(validateFoundedYear(1962).valid).toBe(true));
  it("accepts the earliest allowed year", () => expect(validateFoundedYear(1850).valid).toBe(true));
  it("rejects a year before 1850", () => expect(validateFoundedYear(1849).valid).toBe(false));
  it("rejects a year in the future", () => expect(validateFoundedYear(new Date().getFullYear() + 1).valid).toBe(false));
  it("rejects a non-integer", () => expect(validateFoundedYear(1962.5).valid).toBe(false));
});

describe("validateDisplayName (display name rules)", () => {
  it("rejects an empty name", () => expect(validateDisplayName("").valid).toBe(false));
  it("rejects a whitespace-only name", () => expect(validateDisplayName("   ").valid).toBe(false));
  it("accepts a normal name", () => expect(validateDisplayName("AS Montex").valid).toBe(true));
  it("rejects an oversized name", () => expect(validateDisplayName("x".repeat(121)).valid).toBe(false));
  it("accepts the max length", () => expect(validateDisplayName("x".repeat(120)).valid).toBe(true));
});

describe("validateEmail (malformed email)", () => {
  it("accepts empty (nullable)", () => expect(validateEmail("").valid).toBe(true));
  it("accepts a normal address", () => expect(validateEmail("contact@asmontex.fr").valid).toBe(true));
  it("rejects a missing @", () => expect(validateEmail("contact-asmontex.fr").valid).toBe(false));
  it("rejects a missing domain dot", () => expect(validateEmail("contact@asmontex").valid).toBe(false));
});

describe("validatePhone (malformed phone, reasonably)", () => {
  it("accepts empty (nullable)", () => expect(validatePhone("").valid).toBe(true));
  it("accepts a French local format", () => expect(validatePhone("02 40 00 00 00").valid).toBe(true));
  it("accepts an international format", () => expect(validatePhone("+33 2 40 00 00 00").valid).toBe(true));
  it("rejects letters", () => expect(validatePhone("call-us-now").valid).toBe(false));
  it("rejects too few digits", () => expect(validatePhone("123").valid).toBe(false));
  it("does not over-validate a longer international number", () => expect(validatePhone("+1 (415) 555-0100").valid).toBe(true));
});

describe("validatePostalCode", () => {
  it("accepts empty (nullable)", () => expect(validatePostalCode("").valid).toBe(true));
  it("accepts a French postal code", () => expect(validatePostalCode("44000").valid).toBe(true));
  it("rejects letters", () => expect(validatePostalCode("ABCDE").valid).toBe(false));
});

describe("contrastRatio / pickReadableTextColor", () => {
  it("black on white has the maximum contrast ratio (21)", () => expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 0));
  it("identical colors have a contrast ratio of 1", () => expect(contrastRatio("#0057B8", "#0057B8")).toBeCloseTo(1, 5));
  it("picks white text on a dark club color", () => expect(pickReadableTextColor("#0B1F3A")).toBe("#FFFFFF"));
  it("picks black text on a light club color", () => expect(pickReadableTextColor("#F5E642")).toBe("#000000"));
  it("never returns anything but pure black or white", () => {
    for (const bg of ["#0057B8", "#D9FF57", "#7A1F1F", "#00FF00", "#808080"]) {
      expect(["#000000", "#FFFFFF"]).toContain(pickReadableTextColor(bg));
    }
  });
});

describe("computeClubCompleteness (completeness calculation)", () => {
  const empty = { hasLogo: false, hasShortDescription: false, hasColors: false, hasWebOrSocial: false, hasPublicContact: false, hasVenue: false, hasActiveTeam: false, hasRosterOrMatch: false };

  it("an empty profile is 0/8, 0%", () => {
    const result = computeClubCompleteness(empty);
    expect(result.completed).toBe(0);
    expect(result.total).toBe(8);
    expect(result.percent).toBe(0);
  });

  it("a fully complete profile is 8/8, 100%", () => {
    const full = Object.fromEntries(Object.keys(empty).map((k) => [k, true])) as typeof empty;
    const result = computeClubCompleteness(full);
    expect(result.completed).toBe(8);
    expect(result.percent).toBe(100);
  });

  it("6 of 8 criteria met rounds to 75%", () => {
    const result = computeClubCompleteness({ ...empty, hasLogo: true, hasShortDescription: true, hasColors: true, hasWebOrSocial: true, hasPublicContact: true, hasVenue: true });
    expect(result.completed).toBe(6);
    expect(result.percent).toBe(75);
  });

  it("lists all 8 items in the documented, deterministic order", () => {
    const result = computeClubCompleteness(empty);
    expect(result.items.map((i) => i.label)).toEqual(["Logo", "Présentation", "Couleurs", "Réseaux ou site", "Contact public", "Stade", "Équipe active", "Effectif ou match"]);
  });

  it("each item's done flag matches its input exactly", () => {
    const result = computeClubCompleteness({ ...empty, hasVenue: true });
    const venueItem = result.items.find((i) => i.key === "hasVenue")!;
    expect(venueItem.done).toBe(true);
    expect(result.items.filter((i) => i.done)).toHaveLength(1);
  });
});
