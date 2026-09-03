import { describe, expect, it } from "vitest";
import { buildScorers, formatMinute, isOnMatchSheet, sortTimeline, validateMatchEvent, validateMinute, type GoalLikeEvent, type MatchEventInput } from "./events";

describe("validateMinute", () => {
  it("accepts a NULL minute (amateur football often has no precise minute)", () => {
    expect(validateMinute(null, null).valid).toBe(true);
  });
  it("accepts a valid minute", () => expect(validateMinute(23, null).valid).toBe(true));
  it("accepts added time with a minute (45+2)", () => expect(validateMinute(45, 2).valid).toBe(true));
  it("rejects a negative minute", () => expect(validateMinute(-1, null).valid).toBe(false));
  it("rejects an absurd minute", () => expect(validateMinute(9999, null).valid).toBe(false));
  it("accepts the extra-time boundary (130)", () => expect(validateMinute(130, null).valid).toBe(true));
  it("rejects an out-of-range added time", () => expect(validateMinute(90, 99).valid).toBe(false));
});

describe("formatMinute", () => {
  it("shows a discreet fallback for an undocumented minute, never '0'", () => {
    expect(formatMinute(null, null)).toBe("Minute non renseignée");
  });
  it("formats a plain minute", () => expect(formatMinute(23, null)).toBe("23'"));
  it("formats minute + added time as 45+2", () => expect(formatMinute(45, 2)).toBe("45+2'"));
  it("formats minute + added time as 90+4", () => expect(formatMinute(90, 4)).toBe("90+4'"));
});

describe("validateMatchEvent — GOAL", () => {
  const goal = (overrides: Partial<MatchEventInput> = {}): MatchEventInput => ({ eventType: "GOAL", primaryPlayerId: "scorer", ...overrides });
  it("requires a scorer", () => expect(validateMatchEvent({ ...goal(), primaryPlayerId: "" }).valid).toBe(false));
  it("accepts a goal with no assist (optional, absence != no assist ever)", () => expect(validateMatchEvent(goal()).valid).toBe(true));
  it("accepts a goal with an assist", () => expect(validateMatchEvent(goal({ secondaryPlayerId: "assist" })).valid).toBe(true));
  it("rejects scorer === assist", () => expect(validateMatchEvent(goal({ secondaryPlayerId: "scorer" })).valid).toBe(false));
  it("rejects a card_kind on a goal", () => expect(validateMatchEvent(goal({ cardKind: "DIRECT" })).valid).toBe(false));
});

describe("validateMatchEvent — OWN_GOAL", () => {
  it("accepts a bare own goal", () => expect(validateMatchEvent({ eventType: "OWN_GOAL", primaryPlayerId: "p1" }).valid).toBe(true));
  it("rejects an assist on an own goal", () => expect(validateMatchEvent({ eventType: "OWN_GOAL", primaryPlayerId: "p1", secondaryPlayerId: "p2" }).valid).toBe(false));
  it("rejects a goal_kind on an own goal", () => expect(validateMatchEvent({ eventType: "OWN_GOAL", primaryPlayerId: "p1", goalKind: "NORMAL" }).valid).toBe(false));
});

describe("validateMatchEvent — cards", () => {
  it("accepts a yellow card", () => expect(validateMatchEvent({ eventType: "YELLOW_CARD", primaryPlayerId: "p1" }).valid).toBe(true));
  it("rejects a card_kind on a yellow card", () => expect(validateMatchEvent({ eventType: "YELLOW_CARD", primaryPlayerId: "p1", cardKind: "DIRECT" }).valid).toBe(false));
  it("accepts a plain red card", () => expect(validateMatchEvent({ eventType: "RED_CARD", primaryPlayerId: "p1" }).valid).toBe(true));
  it("accepts a red card with a sub-type (second yellow)", () => expect(validateMatchEvent({ eventType: "RED_CARD", primaryPlayerId: "p1", cardKind: "SECOND_YELLOW" }).valid).toBe(true));
});

describe("validateMatchEvent — SUBSTITUTION", () => {
  it("requires an incoming player", () => expect(validateMatchEvent({ eventType: "SUBSTITUTION", primaryPlayerId: "out" }).valid).toBe(false));
  it("rejects out === in", () => expect(validateMatchEvent({ eventType: "SUBSTITUTION", primaryPlayerId: "p1", secondaryPlayerId: "p1" }).valid).toBe(false));
  it("accepts a normal substitution", () => expect(validateMatchEvent({ eventType: "SUBSTITUTION", primaryPlayerId: "out", secondaryPlayerId: "in" }).valid).toBe(true));
});

describe("isOnMatchSheet", () => {
  it("is true for a player on the sheet", () => expect(isOnMatchSheet(["p1", "p2"], "p1")).toBe(true));
  it("is false for a player not on the sheet", () => expect(isOnMatchSheet(["p1", "p2"], "p3")).toBe(false));
  it("accepts a Set directly", () => expect(isOnMatchSheet(new Set(["p1"]), "p1")).toBe(true));
});

describe("sortTimeline", () => {
  it("orders known-minute events before unknown-minute ones", () => {
    const events = [
      { id: "a", minute: null, addedTime: null },
      { id: "b", minute: 10, addedTime: null },
    ];
    expect(sortTimeline(events).map((e) => e.id)).toEqual(["b", "a"]);
  });
  it("orders known-minute events by minute then added_time", () => {
    const events = [
      { id: "late", minute: 45, addedTime: 2 },
      { id: "early", minute: 10, addedTime: null },
      { id: "mid", minute: 45, addedTime: null },
    ];
    expect(sortTimeline(events).map((e) => e.id)).toEqual(["early", "mid", "late"]);
  });
  it("never treats a missing minute as minute 0 (would otherwise sort first)", () => {
    const events = [
      { id: "unknown", minute: null, addedTime: null },
      { id: "minute-1", minute: 1, addedTime: null },
    ];
    expect(sortTimeline(events).map((e) => e.id)).toEqual(["minute-1", "unknown"]);
  });
  it("is a pure function (does not mutate the input array)", () => {
    const events = [{ id: "b", minute: 20, addedTime: null }, { id: "a", minute: 10, addedTime: null }];
    const original = [...events];
    sortTimeline(events);
    expect(events).toEqual(original);
  });
});

describe("buildScorers", () => {
  const goalEvent = (overrides: Partial<GoalLikeEvent> = {}): GoalLikeEvent => ({
    eventType: "GOAL", primaryPlayerId: "p1", primaryPlayerName: "Jean Dupont", primaryPlayerSlug: "jean-dupont", minute: 23, addedTime: null, ...overrides,
  });

  it("groups multiple goals from the same player under one entry (match-level summary, not a season stat)", () => {
    const scorers = buildScorers([goalEvent({ minute: 23 }), goalEvent({ minute: 71 })]);
    expect(scorers).toHaveLength(1);
    expect(scorers[0].goals.map((g) => g.minute)).toEqual([23, 71]);
  });
  it("ignores non-goal events entirely", () => {
    expect(buildScorers([{ ...goalEvent(), eventType: "YELLOW_CARD" }])).toHaveLength(0);
    expect(buildScorers([{ ...goalEvent(), eventType: "SUBSTITUTION" }])).toHaveLength(0);
  });
  it("keeps an own goal clearly distinguished, never merged into the real-goal tally silently", () => {
    const scorers = buildScorers([goalEvent({ minute: 10 }), goalEvent({ eventType: "OWN_GOAL", minute: 40 })]);
    expect(scorers[0].goals).toEqual([
      { minute: 10, addedTime: null, ownGoal: false },
      { minute: 40, addedTime: null, ownGoal: true },
    ]);
  });
  it("keeps different scorers as separate entries", () => {
    const scorers = buildScorers([goalEvent(), goalEvent({ primaryPlayerId: "p2", primaryPlayerName: "Marc Martin", primaryPlayerSlug: "marc-martin", minute: 55 })]);
    expect(scorers).toHaveLength(2);
  });
});
