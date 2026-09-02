import { describe, expect, it } from "vitest";
import { computeCompleteness, isEligible, validateLineupEntries, type LineupEntry } from "./lineup";

const starter = (playerId: string): LineupEntry => ({ playerId, lineupRole: "STARTER" });
const bench = (playerId: string): LineupEntry => ({ playerId, lineupRole: "BENCH" });

describe("validateLineupEntries", () => {
  it("accepts an empty lineup", () => {
    expect(validateLineupEntries([]).valid).toBe(true);
  });
  it("accepts a partial lineup (8 starters documented out of 11)", () => {
    const entries = Array.from({ length: 8 }, (_, i) => starter(`p${i}`));
    expect(validateLineupEntries(entries).valid).toBe(true);
  });
  it("accepts exactly 11 starters", () => {
    const entries = Array.from({ length: 11 }, (_, i) => starter(`p${i}`));
    expect(validateLineupEntries(entries).valid).toBe(true);
  });
  it("rejects 12 starters", () => {
    const entries = Array.from({ length: 12 }, (_, i) => starter(`p${i}`));
    const result = validateLineupEntries(entries);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/11/);
  });
  it("rejects the same player listed twice (starter and bench)", () => {
    expect(validateLineupEntries([starter("p1"), bench("p1")]).valid).toBe(false);
  });
  it("rejects an invalid lineup role", () => {
    expect(validateLineupEntries([{ playerId: "p1", lineupRole: "CAPTAIN" as LineupEntry["lineupRole"] }]).valid).toBe(false);
  });
  it("rejects an out-of-range squad number", () => {
    expect(validateLineupEntries([{ ...starter("p1"), squadNumber: 0 }]).valid).toBe(false);
    expect(validateLineupEntries([{ ...starter("p1"), squadNumber: 100 }]).valid).toBe(false);
  });
  it("accepts a valid squad number and a null one", () => {
    expect(validateLineupEntries([{ ...starter("p1"), squadNumber: 9 }]).valid).toBe(true);
    expect(validateLineupEntries([{ ...starter("p1"), squadNumber: null }]).valid).toBe(true);
  });
  it("is a pure function: the same input always yields the same result (idempotent validation)", () => {
    const entries = [starter("p1"), bench("p2")];
    expect(validateLineupEntries(entries)).toEqual(validateLineupEntries(entries));
  });
});

describe("computeCompleteness", () => {
  it("is EMPTY when nothing is documented", () => {
    expect(computeCompleteness([])).toBe("EMPTY");
  });
  it("is PARTIAL with fewer than 11 starters, even bench-only", () => {
    expect(computeCompleteness([bench("p1")])).toBe("PARTIAL");
    expect(computeCompleteness(Array.from({ length: 8 }, (_, i) => starter(`p${i}`)))).toBe("PARTIAL");
  });
  it("is COMPLETE at 11 starters regardless of bench size", () => {
    const entries = [...Array.from({ length: 11 }, (_, i) => starter(`p${i}`)), bench("sub1")];
    expect(computeCompleteness(entries)).toBe("COMPLETE");
    expect(computeCompleteness(Array.from({ length: 11 }, (_, i) => starter(`p${i}`)))).toBe("COMPLETE");
  });
});

describe("isEligible", () => {
  const activeAtClubA = { clubId: "club-a", seasonId: "season-1", status: "ACTIVE" };
  it("is eligible with an active registration at the same club and season", () => {
    expect(isEligible([activeAtClubA], "club-a", "season-1")).toBe(true);
  });
  it("is not eligible for a different club", () => {
    expect(isEligible([activeAtClubA], "club-b", "season-1")).toBe(false);
  });
  it("is not eligible for a different season", () => {
    expect(isEligible([activeAtClubA], "club-a", "season-2")).toBe(false);
  });
  it("is not eligible when the only registration at that club is not ACTIVE", () => {
    expect(isEligible([{ clubId: "club-a", seasonId: "season-1", status: "REVIEW" }], "club-a", "season-1")).toBe(false);
  });
  it("is not eligible with no registrations at all (existing in `players` is not enough)", () => {
    expect(isEligible([], "club-a", "season-1")).toBe(false);
  });
});
