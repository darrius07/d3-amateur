import { describe, expect, it } from "vitest";
import {
  computeCoverage,
  computePlayerStats,
  formatCoverageSentence,
  formatDocumentedAppearances,
  formatDocumentedAssists,
  formatDocumentedCards,
  formatDocumentedGoals,
  hasAnyDocumentedData,
  isSubstituteAppearance,
  type AppearanceFact,
  type EventFact,
} from "./stats";

const A = "player-a", B = "player-b", C = "player-c";
const TS_A = "ts-a", TS_A2 = "ts-a2", TS_B_OPPONENT = "ts-opponent";
const M1 = "match-1", M2 = "match-2", M3 = "match-3";

describe("isSubstituteAppearance", () => {
  it("a STARTER row is never a substitute appearance", () => {
    expect(isSubstituteAppearance({ playerId: A, matchId: M1, teamSeasonId: TS_A, lineupRole: "STARTER" }, [])).toBe(false);
  });
  it("BENCH alone, with no substitution event, does not count", () => {
    expect(isSubstituteAppearance({ playerId: C, matchId: M1, teamSeasonId: TS_A, lineupRole: "BENCH" }, [])).toBe(false);
  });
  it("BENCH + a SUBSTITUTION event bringing this exact player on for this match+team counts", () => {
    const events: EventFact[] = [{ matchId: M1, teamSeasonId: TS_A, eventType: "SUBSTITUTION", primaryPlayerId: B, secondaryPlayerId: C }];
    expect(isSubstituteAppearance({ playerId: C, matchId: M1, teamSeasonId: TS_A, lineupRole: "BENCH" }, events)).toBe(true);
  });
  it("a substitution for a different match does not count", () => {
    const events: EventFact[] = [{ matchId: M2, teamSeasonId: TS_A, eventType: "SUBSTITUTION", primaryPlayerId: B, secondaryPlayerId: C }];
    expect(isSubstituteAppearance({ playerId: C, matchId: M1, teamSeasonId: TS_A, lineupRole: "BENCH" }, events)).toBe(false);
  });
  it("a substitution for a different team_season does not count (two clubs, same match id never happens, but defensive)", () => {
    const events: EventFact[] = [{ matchId: M1, teamSeasonId: TS_B_OPPONENT, eventType: "SUBSTITUTION", primaryPlayerId: B, secondaryPlayerId: C }];
    expect(isSubstituteAppearance({ playerId: C, matchId: M1, teamSeasonId: TS_A, lineupRole: "BENCH" }, events)).toBe(false);
  });
});

describe("computePlayerStats", () => {
  it("starter appearance: 1 STARTER row -> appearances=1, starts=1, subs=0", () => {
    const appearances: AppearanceFact[] = [{ playerId: A, matchId: M1, teamSeasonId: TS_A, lineupRole: "STARTER" }];
    const s = computePlayerStats(A, appearances, []);
    expect(s).toMatchObject({ appearances: 1, starts: 1, substituteAppearances: 0 });
  });

  it("bench without a substitution: 0 appearances", () => {
    const appearances: AppearanceFact[] = [{ playerId: C, matchId: M1, teamSeasonId: TS_A, lineupRole: "BENCH" }];
    const s = computePlayerStats(C, appearances, []);
    expect(s.appearances).toBe(0);
  });

  it("bench enters via substitution: 1 appearance, 0 starts, 1 substitute appearance", () => {
    const appearances: AppearanceFact[] = [{ playerId: C, matchId: M1, teamSeasonId: TS_A, lineupRole: "BENCH" }];
    const events: EventFact[] = [{ matchId: M1, teamSeasonId: TS_A, eventType: "SUBSTITUTION", primaryPlayerId: B, secondaryPlayerId: C }];
    const s = computePlayerStats(C, appearances, events);
    expect(s).toMatchObject({ appearances: 1, starts: 0, substituteAppearances: 1 });
  });

  it("substitution removed: the substitute appearance disappears immediately", () => {
    const appearances: AppearanceFact[] = [{ playerId: C, matchId: M1, teamSeasonId: TS_A, lineupRole: "BENCH" }];
    const s = computePlayerStats(C, appearances, []); // event no longer present, e.g. deleted
    expect(s.appearances).toBe(0);
  });

  it("distinct match appearance: a STARTER with a contradictory SUBSTITUTION event for the same match is still exactly 1 appearance", () => {
    const appearances: AppearanceFact[] = [{ playerId: A, matchId: M1, teamSeasonId: TS_A, lineupRole: "STARTER" }];
    const events: EventFact[] = [{ matchId: M1, teamSeasonId: TS_A, eventType: "SUBSTITUTION", primaryPlayerId: B, secondaryPlayerId: A }];
    const s = computePlayerStats(A, appearances, events);
    expect(s.appearances).toBe(1);
  });

  it("goals: counts GOAL events where this player is the primary (scorer)", () => {
    const events: EventFact[] = [
      { matchId: M1, teamSeasonId: TS_A, eventType: "GOAL", primaryPlayerId: A, secondaryPlayerId: null },
      { matchId: M1, teamSeasonId: TS_A, eventType: "GOAL", primaryPlayerId: A, secondaryPlayerId: B },
    ];
    expect(computePlayerStats(A, [], events).documentedGoals).toBe(2);
  });

  it("assists: counts GOAL events where this player is the secondary (assist)", () => {
    const events: EventFact[] = [{ matchId: M1, teamSeasonId: TS_A, eventType: "GOAL", primaryPlayerId: A, secondaryPlayerId: B }];
    expect(computePlayerStats(B, [], events).documentedAssists).toBe(1);
  });

  it("assist NULL semantics: a goal with no secondary_player_id credits no one, but is not itself a stat error", () => {
    const events: EventFact[] = [{ matchId: M1, teamSeasonId: TS_A, eventType: "GOAL", primaryPlayerId: A, secondaryPlayerId: null }];
    expect(computePlayerStats(B, [], events).documentedAssists).toBe(0);
    expect(computePlayerStats(A, [], events).documentedGoals).toBe(1);
  });

  it("own goals: counted separately, never added to documentedGoals", () => {
    const events: EventFact[] = [
      { matchId: M1, teamSeasonId: TS_A, eventType: "GOAL", primaryPlayerId: A, secondaryPlayerId: null },
      { matchId: M1, teamSeasonId: TS_A, eventType: "OWN_GOAL", primaryPlayerId: A, secondaryPlayerId: null },
    ];
    const s = computePlayerStats(A, [], events);
    expect(s.documentedGoals).toBe(1);
    expect(s.documentedOwnGoals).toBe(1);
  });

  it("yellow cards: counted directly", () => {
    const events: EventFact[] = [{ matchId: M1, teamSeasonId: TS_A, eventType: "YELLOW_CARD", primaryPlayerId: A, secondaryPlayerId: null }];
    expect(computePlayerStats(A, [], events).yellowCards).toBe(1);
  });

  it("red cards: counted directly, including a second-yellow red (card_kind is never filtered on)", () => {
    const events: EventFact[] = [{ matchId: M1, teamSeasonId: TS_A, eventType: "RED_CARD", primaryPlayerId: A, secondaryPlayerId: null }];
    expect(computePlayerStats(A, [], events).redCards).toBe(1);
  });

  it("multi-team: appearances in two different team_seasons (same club, different rank teams) are both counted, once each", () => {
    const appearances: AppearanceFact[] = [
      { playerId: A, matchId: M1, teamSeasonId: TS_A, lineupRole: "STARTER" },
      { playerId: A, matchId: M3, teamSeasonId: TS_A2, lineupRole: "STARTER" },
    ];
    const s = computePlayerStats(A, appearances, []);
    expect(s.appearances).toBe(2);
  });

  it("multi-club (season total): summing per-club breakdowns preserves the total instead of merging matches", () => {
    // Club A: 2 matches, Club B (transfer mid-season): 1 match -- season total = 3, never deduped across clubs.
    const appearances: AppearanceFact[] = [
      { playerId: A, matchId: M1, teamSeasonId: TS_A, lineupRole: "STARTER" },
      { playerId: A, matchId: M2, teamSeasonId: TS_A, lineupRole: "STARTER" },
      { playerId: A, matchId: M3, teamSeasonId: TS_A2, lineupRole: "STARTER" },
    ];
    const s = computePlayerStats(A, appearances, []);
    expect(s.appearances).toBe(3);
  });

  it("season aggregation: goals/assists/cards sum correctly across several matches for the same player", () => {
    const events: EventFact[] = [
      { matchId: M1, teamSeasonId: TS_A, eventType: "GOAL", primaryPlayerId: A, secondaryPlayerId: null },
      { matchId: M2, teamSeasonId: TS_A, eventType: "GOAL", primaryPlayerId: A, secondaryPlayerId: null },
      { matchId: M2, teamSeasonId: TS_A, eventType: "YELLOW_CARD", primaryPlayerId: A, secondaryPlayerId: null },
    ];
    const s = computePlayerStats(A, [], events);
    expect(s).toMatchObject({ documentedGoals: 2, yellowCards: 1 });
  });

  it("career aggregation: appearances/goals sum across seasons/clubs exactly like season aggregation, given the full career fact set", () => {
    const appearances: AppearanceFact[] = [
      { playerId: A, matchId: M1, teamSeasonId: TS_A, lineupRole: "STARTER" },
      { playerId: A, matchId: M3, teamSeasonId: TS_A2, lineupRole: "STARTER" },
    ];
    const events: EventFact[] = [{ matchId: M1, teamSeasonId: TS_A, eventType: "GOAL", primaryPlayerId: A, secondaryPlayerId: null }];
    const s = computePlayerStats(A, appearances, events);
    expect(s).toMatchObject({ appearances: 2, documentedGoals: 1 });
  });
});

describe("computeCoverage", () => {
  it("4 PLAYED matches: complete / partial / none / complete -> played=4, anyLineup=3, completeLineup=2", () => {
    const coverage = computeCoverage([
      { hasAnyLineupData: true, starterCount: 11, hasAnyEventData: true },
      { hasAnyLineupData: true, starterCount: 6, hasAnyEventData: false },
      { hasAnyLineupData: false, starterCount: 0, hasAnyEventData: false },
      { hasAnyLineupData: true, starterCount: 11, hasAnyEventData: true },
    ]);
    expect(coverage).toEqual({ playedMatches: 4, matchesWithAnyLineupData: 3, matchesWithCompleteStartingLineup: 2, matchesWithAnyEventData: 2 });
  });

  it("no played matches at all: everything is zero, never undefined", () => {
    expect(computeCoverage([])).toEqual({ playedMatches: 0, matchesWithAnyLineupData: 0, matchesWithCompleteStartingLineup: 0, matchesWithAnyEventData: 0 });
  });
});

describe("zero vs unknown display helpers", () => {
  it("formatDocumentedGoals never renders a bare zero", () => {
    expect(formatDocumentedGoals(0)).toBe("0 but documenté");
  });
  it("formatDocumentedGoals pluralizes for 2+", () => {
    expect(formatDocumentedGoals(2)).toBe("2 buts documentés");
  });
  it("formatDocumentedGoals singular for exactly 1", () => {
    expect(formatDocumentedGoals(1)).toBe("1 but documenté");
  });
  it("formatDocumentedAssists follows the same qualified pattern", () => {
    expect(formatDocumentedAssists(0)).toBe("0 passe décisive renseignée");
    expect(formatDocumentedAssists(1)).toBe("1 passe décisive renseignée");
    expect(formatDocumentedAssists(3)).toBe("3 passes décisives renseignées");
  });
  it("formatDocumentedAppearances follows the same qualified pattern", () => {
    expect(formatDocumentedAppearances(0)).toBe("0 apparition documentée");
    expect(formatDocumentedAppearances(1)).toBe("1 apparition documentée");
    expect(formatDocumentedAppearances(2)).toBe("2 apparitions documentées");
  });
  it("formatDocumentedCards handles zero of both kinds without a bare '0'", () => {
    expect(formatDocumentedCards(0, 0)).toBe("Aucun carton renseigné");
  });
  it("formatDocumentedCards handles a mix", () => {
    expect(formatDocumentedCards(2, 1)).toBe("2 jaunes, 1 rouge renseignés");
  });
  it("hasAnyDocumentedData is false for a player with zero rows anywhere", () => {
    expect(hasAnyDocumentedData({ appearances: 0, starts: 0, substituteAppearances: 0, documentedGoals: 0, documentedAssists: 0, documentedOwnGoals: 0, yellowCards: 0, redCards: 0 })).toBe(false);
  });
  it("hasAnyDocumentedData is true as soon as any single field is non-zero", () => {
    expect(hasAnyDocumentedData({ appearances: 0, starts: 0, substituteAppearances: 0, documentedGoals: 0, documentedAssists: 1, documentedOwnGoals: 0, yellowCards: 0, redCards: 0 })).toBe(true);
  });
});

describe("formatCoverageSentence", () => {
  it("renders the exact 'documented, not exhaustive' sentence shape", () => {
    expect(formatCoverageSentence({ playedMatches: 12, matchesWithAnyLineupData: 8, matchesWithCompleteStartingLineup: 5, matchesWithAnyEventData: 6 })).toBe(
      "Feuilles de match disponibles sur 8 des 12 matchs joués par l'équipe.",
    );
  });
  it("renders a dedicated sentence when the team has no documented played match at all", () => {
    expect(formatCoverageSentence({ playedMatches: 0, matchesWithAnyLineupData: 0, matchesWithCompleteStartingLineup: 0, matchesWithAnyEventData: 0 })).toBe(
      "Aucun match joué documenté pour cette équipe pour le moment.",
    );
  });
});
