import { describe, expect, it } from "vitest";
import {
  canEditSchedule,
  canEnterResult,
  canTransition,
  formatKickoffParis,
  isProbableDuplicate,
  normalizeOpponentName,
  parisLocalToUtcIso,
  utcIsoToParisLocalInput,
  validateOpponentShape,
  validateScore,
} from "./identity";

describe("validateOpponentShape", () => {
  it("accepts a D3 team at home vs a free-text opponent away", () => {
    expect(validateOpponentShape({ homeTeamSeasonId: "a", awayTeamSeasonId: null, externalOpponentName: "FC Externe" }).valid).toBe(true);
  });
  it("accepts a free-text opponent at home vs our D3 team away (home/away inverted)", () => {
    expect(validateOpponentShape({ homeTeamSeasonId: null, awayTeamSeasonId: "a", externalOpponentName: "FC Externe" }).valid).toBe(true);
  });
  it("accepts D3 vs D3", () => {
    expect(validateOpponentShape({ homeTeamSeasonId: "a", awayTeamSeasonId: "b", externalOpponentName: null }).valid).toBe(true);
  });
  it("rejects a team playing itself", () => {
    expect(validateOpponentShape({ homeTeamSeasonId: "a", awayTeamSeasonId: "a", externalOpponentName: null }).valid).toBe(false);
  });
  it("rejects both a D3 opponent and a free-text name at once", () => {
    expect(validateOpponentShape({ homeTeamSeasonId: "a", awayTeamSeasonId: "b", externalOpponentName: "FC X" }).valid).toBe(false);
  });
  it("rejects no opponent at all", () => {
    expect(validateOpponentShape({ homeTeamSeasonId: "a", awayTeamSeasonId: null, externalOpponentName: "" }).valid).toBe(false);
  });
  it("rejects neither side being a D3 team", () => {
    expect(validateOpponentShape({ homeTeamSeasonId: null, awayTeamSeasonId: null, externalOpponentName: "FC X" }).valid).toBe(false);
  });
});

describe("validateScore", () => {
  it("accepts zero-zero", () => expect(validateScore(0, 0).valid).toBe(true));
  it("accepts a real result", () => expect(validateScore(3, 1).valid).toBe(true));
  it("rejects a missing score", () => expect(validateScore(null, 1).valid).toBe(false));
  it("rejects a negative score", () => expect(validateScore(-1, 0).valid).toBe(false));
  it("rejects a non-integer score", () => expect(validateScore(1.5, 0).valid).toBe(false));
});

describe("status transitions", () => {
  it("SCHEDULED can become PLAYED, POSTPONED or CANCELLED", () => {
    expect(canTransition("SCHEDULED", "PLAYED")).toBe(true);
    expect(canTransition("SCHEDULED", "POSTPONED")).toBe(true);
    expect(canTransition("SCHEDULED", "CANCELLED")).toBe(true);
  });
  it("CANCELLED is terminal", () => {
    expect(canTransition("CANCELLED", "SCHEDULED")).toBe(false);
    expect(canTransition("CANCELLED", "PLAYED")).toBe(false);
  });
  it("schedule can be edited while SCHEDULED or POSTPONED, never once PLAYED or CANCELLED", () => {
    expect(canEditSchedule("SCHEDULED")).toBe(true);
    expect(canEditSchedule("POSTPONED")).toBe(true);
    expect(canEditSchedule("PLAYED")).toBe(false);
    expect(canEditSchedule("CANCELLED")).toBe(false);
  });
  it("a result can be entered while SCHEDULED (first entry) or PLAYED (correction), never once cancelled/postponed", () => {
    expect(canEnterResult("SCHEDULED")).toBe(true);
    expect(canEnterResult("PLAYED")).toBe(true);
    expect(canEnterResult("POSTPONED")).toBe(false);
    expect(canEnterResult("CANCELLED")).toBe(false);
  });
});

describe("Europe/Paris <-> UTC", () => {
  it("converts a summer (CEST, UTC+2) kickoff correctly", () => {
    expect(parisLocalToUtcIso("2026-07-15T18:30")).toBe("2026-07-15T16:30:00.000Z");
  });
  it("converts a winter (CET, UTC+1) kickoff correctly", () => {
    expect(parisLocalToUtcIso("2026-01-15T18:30")).toBe("2026-01-15T17:30:00.000Z");
  });
  it("crosses the UTC day boundary for a late-evening/past-midnight Paris kickoff", () => {
    // 00:30 Paris in winter (UTC+1) is still the previous day in UTC.
    expect(parisLocalToUtcIso("2026-01-15T00:30")).toBe("2026-01-14T23:30:00.000Z");
  });
  it("round-trips UTC -> Paris local input -> UTC without drift, in both seasons", () => {
    for (const iso of ["2026-07-15T16:30:00.000Z", "2026-01-15T17:30:00.000Z"]) {
      const local = utcIsoToParisLocalInput(iso);
      expect(parisLocalToUtcIso(local)).toBe(iso);
    }
  });
  it("formats a kickoff in French, Paris time, regardless of a UTC-day-shifted instant", () => {
    const formatted = formatKickoffParis("2026-01-14T23:30:00.000Z"); // = Jan 15th, 00:30 Paris
    expect(formatted).toMatch(/15 janvier 2026/);
  });
});

describe("normalizeOpponentName", () => {
  it("strips accents, case and punctuation", () => {
    expect(normalizeOpponentName("Étoile Sportive, FC")).toBe("etoile sportive fc");
  });
});

describe("isProbableDuplicate", () => {
  const base = { id: "m1", kickoffAt: "2026-09-12T18:00:00.000Z", opponentTeamSeasonId: "opp-1", externalOpponentName: null };

  it("flags the same opponent team on a nearby date as a probable duplicate", () => {
    expect(isProbableDuplicate(base, { opponentTeamSeasonId: "opp-1", externalOpponentName: null, kickoffAt: "2026-09-13T15:00:00.000Z" })).toBe(true);
  });
  it("does not flag the same opponent far in the future as a season decider rematch", () => {
    expect(isProbableDuplicate(base, { opponentTeamSeasonId: "opp-1", externalOpponentName: null, kickoffAt: "2027-03-01T15:00:00.000Z" })).toBe(false);
  });
  it("does not flag a different opponent on the exact same date", () => {
    expect(isProbableDuplicate(base, { opponentTeamSeasonId: "opp-2", externalOpponentName: null, kickoffAt: base.kickoffAt })).toBe(false);
  });
  it("catches a home/away-inverted resubmission of the same fixture (opponent identity, not literal columns)", () => {
    // The data layer is expected to resolve `candidate.opponentTeamSeasonId`
    // as "whichever side isn't our team_season", so this function itself
    // never needs to know which literal column held which side.
    expect(isProbableDuplicate(base, { opponentTeamSeasonId: "opp-1", externalOpponentName: null, kickoffAt: "2026-09-12T18:00:00.000Z" })).toBe(true);
  });
  it("treats a homonym free-text opponent name as related, not blindly identical when normalization differs", () => {
    const external = { id: "m2", kickoffAt: "2026-09-12T18:00:00.000Z", opponentTeamSeasonId: null, externalOpponentName: "FC Étoile" };
    expect(isProbableDuplicate(external, { opponentTeamSeasonId: null, externalOpponentName: "FC Etoile", kickoffAt: "2026-09-13T10:00:00.000Z" })).toBe(true);
    expect(isProbableDuplicate(external, { opponentTeamSeasonId: null, externalOpponentName: "FC Autre Club", kickoffAt: "2026-09-13T10:00:00.000Z" })).toBe(false);
  });
});
