import { describe, expect, it } from "vitest";
import {
  baseSlugFor,
  classifyDuplicateReviewState,
  isTerminalStatus,
  isValidStatusTransition,
  projectForRequester,
  slugCandidateFor,
  stringSimilarity,
  validateClubCreationRequest,
  type ClubCreationRequestRow,
} from "./creation-request";

const validInput = {
  clubName: "AS Nouvelle Jeunesse",
  city: "Villeurbanne",
  representativeConfirmation: true,
};

describe("validateClubCreationRequest", () => {
  it("accepts a minimal valid request", () => {
    expect(validateClubCreationRequest(validInput).valid).toBe(true);
  });
  it("rejects a club name that is too short", () => {
    expect(validateClubCreationRequest({ ...validInput, clubName: "A" }).valid).toBe(false);
  });
  it("rejects a club name over 120 characters", () => {
    expect(validateClubCreationRequest({ ...validInput, clubName: "x".repeat(121) }).valid).toBe(false);
  });
  it("rejects a missing city", () => {
    expect(validateClubCreationRequest({ ...validInput, city: "P" }).valid).toBe(false);
  });
  it("rejects representative_confirmation=false", () => {
    expect(validateClubCreationRequest({ ...validInput, representativeConfirmation: false }).valid).toBe(false);
  });
  it("rejects an oversized short_name", () => {
    expect(validateClubCreationRequest({ ...validInput, shortName: "x".repeat(41) }).valid).toBe(false);
  });
  it("accepts a valid optional postal code", () => {
    expect(validateClubCreationRequest({ ...validInput, postalCode: "69100" }).valid).toBe(true);
  });
  it("rejects an invalid postal code", () => {
    expect(validateClubCreationRequest({ ...validInput, postalCode: "abc" }).valid).toBe(false);
  });
  it("rejects an http:// website (https-only, reused from Step 6A/6C)", () => {
    expect(validateClubCreationRequest({ ...validInput, websiteUrl: "http://example.com" }).valid).toBe(false);
  });
  it("accepts a valid https:// website", () => {
    expect(validateClubCreationRequest({ ...validInput, websiteUrl: "https://example.com" }).valid).toBe(true);
  });
  it("rejects an http:// social link", () => {
    expect(validateClubCreationRequest({ ...validInput, socialUrl: "http://facebook.com/example" }).valid).toBe(false);
  });
});

describe("stringSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(stringSimilarity("fc exemple", "fc exemple")).toBe(1);
  });
  it("returns a high score for near-identical strings", () => {
    expect(stringSimilarity("fc bellevue", "fc belevue")).toBeGreaterThan(0.7);
  });
  it("returns a low score for unrelated strings", () => {
    expect(stringSimilarity("fc bellevue", "racing club metz")).toBeLessThan(0.3);
  });
});

describe("classifyDuplicateReviewState", () => {
  it("classifies exact name + same postal code as LIKELY_DUPLICATE", () => {
    const state = classifyDuplicateReviewState(
      { displayName: "FC Bellevue", city: "Lyon", postalCode: "69000" },
      { clubName: "FC Bellevue", city: "Lyon", postalCode: "69000" },
    );
    expect(state).toBe("LIKELY_DUPLICATE");
  });
  it("classifies exact name + same city (no postal) as LIKELY_DUPLICATE", () => {
    const state = classifyDuplicateReviewState(
      { displayName: "FC Bellevue", city: "Lyon", postalCode: null },
      { clubName: "fc   bellevue", city: "Lyon", postalCode: null },
    );
    expect(state).toBe("LIKELY_DUPLICATE");
  });
  it("classifies exact name but different city/postal as POSSIBLE", () => {
    const state = classifyDuplicateReviewState(
      { displayName: "FC Bellevue", city: "Lyon", postalCode: "69000" },
      { clubName: "FC Bellevue", city: "Marseille", postalCode: "13000" },
    );
    expect(state).toBe("POSSIBLE");
  });
  it("classifies a highly similar name as POSSIBLE", () => {
    const state = classifyDuplicateReviewState(
      { displayName: "FC Bellevue", city: "Lyon", postalCode: null },
      { clubName: "FC Belevue", city: "Nantes", postalCode: null },
    );
    expect(state).toBe("POSSIBLE");
  });
  it("classifies an unrelated club name as NONE", () => {
    const state = classifyDuplicateReviewState(
      { displayName: "FC Bellevue", city: "Lyon", postalCode: null },
      { clubName: "Racing Club de Metz", city: "Metz", postalCode: null },
    );
    expect(state).toBe("NONE");
  });
});

describe("slug generation", () => {
  it("produces a deterministic base slug", () => {
    expect(baseSlugFor("FC Bellevue")).toBe("fc-bellevue");
  });
  it("attempt 0 returns the base slug itself", () => {
    expect(slugCandidateFor("FC Bellevue", 0)).toBe("fc-bellevue");
  });
  it("collision handling appends a numeric suffix", () => {
    expect(slugCandidateFor("FC Bellevue", 1)).toBe("fc-bellevue-1");
    expect(slugCandidateFor("FC Bellevue", 2)).toBe("fc-bellevue-2");
  });
  it("never produces an empty slug for a name with no ASCII letters", () => {
    expect(baseSlugFor("!!!")).toBe("club");
  });
});

describe("status transitions", () => {
  it("allows PENDING_REVIEW -> APPROVED", () => {
    expect(isValidStatusTransition("PENDING_REVIEW", "APPROVED")).toBe(true);
  });
  it("allows PENDING_REVIEW -> NEEDS_INFO", () => {
    expect(isValidStatusTransition("PENDING_REVIEW", "NEEDS_INFO")).toBe(true);
  });
  it("allows NEEDS_INFO -> DUPLICATE", () => {
    expect(isValidStatusTransition("NEEDS_INFO", "DUPLICATE")).toBe(true);
  });
  it("refuses re-resolving an already-APPROVED request", () => {
    expect(isValidStatusTransition("APPROVED", "REJECTED")).toBe(false);
  });
  it("refuses re-resolving an already-DUPLICATE request", () => {
    expect(isValidStatusTransition("DUPLICATE", "APPROVED")).toBe(false);
  });
  it("refuses moving anything back to PENDING_REVIEW", () => {
    expect(isValidStatusTransition("NEEDS_INFO", "PENDING_REVIEW")).toBe(false);
  });
  it("flags APPROVED/REJECTED/DUPLICATE as terminal", () => {
    expect(isTerminalStatus("APPROVED")).toBe(true);
    expect(isTerminalStatus("REJECTED")).toBe(true);
    expect(isTerminalStatus("DUPLICATE")).toBe(true);
    expect(isTerminalStatus("PENDING_REVIEW")).toBe(false);
    expect(isTerminalStatus("NEEDS_INFO")).toBe(false);
  });
});

describe("projectForRequester (safe user projection)", () => {
  const row: ClubCreationRequestRow = {
    id: "req-1",
    status: "REJECTED",
    clubName: "Club Refuse",
    city: "Toulon",
    publicMessage: "Merci de fournir plus de précisions.",
    adminNote: "Suspicion de canular -- ne jamais montrer ceci à l'utilisateur",
    createdClubId: null,
    duplicateCandidateClubId: null,
    createdAt: "2026-09-03T00:00:00.000Z",
  };
  it("never includes adminNote in the safe projection", () => {
    const safe = projectForRequester(row);
    expect("adminNote" in safe).toBe(false);
  });
  it("keeps the public_message and every other requester-relevant field", () => {
    const safe = projectForRequester(row);
    expect(safe.publicMessage).toBe(row.publicMessage);
    expect(safe.status).toBe(row.status);
    expect(safe.clubName).toBe(row.clubName);
  });
});
