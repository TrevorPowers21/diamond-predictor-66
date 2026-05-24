import { describe, it, expect } from "vitest";
import {
  getProgramTierMultiplierByConference,
  getPositionValueMultiplier,
  calcPlayerScore,
  calcProgramSpecificAllocation,
  DEFAULT_NIL_TIER_MULTIPLIERS,
  DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE,
} from "./nilProgramSpecific";

describe("getProgramTierMultiplierByConference", () => {
  describe("SEC tier (1.5)", () => {
    it.each([
      "SEC",
      "sec",
      "Southeastern Conference",
      "southeastern conference",
    ])('returns 1.5 for "%s"', (conf) => {
      expect(getProgramTierMultiplierByConference(conf)).toBe(DEFAULT_NIL_TIER_MULTIPLIERS.sec);
    });
  });

  describe("Big Ten tier (1.0)", () => {
    it.each(["Big Ten", "big ten", "BigTen"])('returns 1.0 for "%s"', (conf) => {
      expect(getProgramTierMultiplierByConference(conf)).toBe(DEFAULT_NIL_TIER_MULTIPLIERS.bigTen);
    });
  });

  describe("P4 tier (1.2) — ACC and Big 12", () => {
    it.each([
      "ACC",
      "Atlantic Coast Conference",
      "Big 12",
      "big12",
      "Big12Conference",
    ])('returns 1.2 for "%s"', (conf) => {
      expect(getProgramTierMultiplierByConference(conf)).toBe(DEFAULT_NIL_TIER_MULTIPLIERS.p4);
    });
  });

  describe("Strong Mid-Major tier (0.8)", () => {
    it.each([
      "American Athletic Conference",
      "AAC",
      "Sun Belt Conference",
      "Sunbelt",
      "Big West Conference",
      "BigWest",
      "Mountain West Conference",
      "MountainWest",
    ])('returns 0.8 for "%s"', (conf) => {
      expect(getProgramTierMultiplierByConference(conf)).toBe(DEFAULT_NIL_TIER_MULTIPLIERS.strongMid);
    });
  });

  describe("Low Major tier (0.5) — default", () => {
    it.each([
      "Southern Conference",
      "SOCON",
      "America East",
      "NEC",
      "SWAC",
      "",
      null,
      undefined,
    ])('returns 0.5 for "%s"', (conf) => {
      expect(getProgramTierMultiplierByConference(conf)).toBe(DEFAULT_NIL_TIER_MULTIPLIERS.lowMajor);
    });
  });

  it("respects custom multiplier overrides", () => {
    const custom = { ...DEFAULT_NIL_TIER_MULTIPLIERS, sec: 2.0, p4: 1.8 };
    expect(getProgramTierMultiplierByConference("SEC", custom)).toBe(2.0);
    expect(getProgramTierMultiplierByConference("ACC", custom)).toBe(1.8);
  });
});

describe("getPositionValueMultiplier", () => {
  describe("premium positions → 1.3", () => {
    it.each(["C", "Catcher", "SS", "Shortstop", "CF", "Center Field", "Centerfield"])(
      'returns 1.3 for "%s"',
      (pos) => expect(getPositionValueMultiplier(pos)).toBe(1.3),
    );
  });

  describe("above-average positions → 1.1", () => {
    it.each(["2B", "Second Base", "3B", "Third Base", "LF", "RF", "Corner Outfield", "COF", "OF", "Outfield"])(
      'returns 1.1 for "%s"',
      (pos) => expect(getPositionValueMultiplier(pos)).toBe(1.1),
    );
  });

  describe("neutral positions → 1.0", () => {
    it.each(["1B", "First Base", "DH", "Designated Hitter", "UT", "UTL", "UTIL", "Utility"])(
      'returns 1.0 for "%s"',
      (pos) => expect(getPositionValueMultiplier(pos)).toBe(1.0),
    );
  });

  describe("bench → 0.8", () => {
    it.each(["Bench", "Bench Utility"])(
      'returns 0.8 for "%s"',
      (pos) => expect(getPositionValueMultiplier(pos)).toBe(0.8),
    );
  });

  describe("unknown → 1.0 (neutral fallback)", () => {
    it.each([null, undefined, "", "TWP", "SP", "RP", "P"])(
      'returns 1.0 for "%s"',
      (pos) => expect(getPositionValueMultiplier(pos)).toBe(1.0),
    );
  });
});

describe("calcPlayerScore", () => {
  it("computes oWAR × PTM × PVM correctly (SS + SEC + 2.0 oWAR)", () => {
    // SS → PVM 1.3, SEC → PTM 1.5, oWAR = 2.0
    const result = calcPlayerScore({ owar: 2.0, programTierMultiplier: 1.5, position: "SS" });
    expect(result).toBeCloseTo(2.0 * 1.5 * 1.3);
  });

  it("computes 1B + Big Ten + 3.0 oWAR", () => {
    // 1B → PVM 1.0, Big Ten → PTM 1.0, oWAR = 3.0
    expect(calcPlayerScore({ owar: 3.0, programTierMultiplier: 1.0, position: "1B" })).toBeCloseTo(3.0);
  });

  it("returns 0 when oWAR is null", () => {
    expect(calcPlayerScore({ owar: null, programTierMultiplier: 1.5, position: "SS" })).toBe(0);
  });

  it("returns 0 when oWAR is undefined", () => {
    expect(calcPlayerScore({ owar: undefined, programTierMultiplier: 1.5, position: "SS" })).toBe(0);
  });

  it("returns 0 when programTierMultiplier is 0", () => {
    expect(calcPlayerScore({ owar: 2.0, programTierMultiplier: 0, position: "SS" })).toBe(0);
  });

  it("handles negative oWAR (bench/replacement-level player)", () => {
    const result = calcPlayerScore({ owar: -0.5, programTierMultiplier: 1.2, position: "DH" });
    expect(result).toBeCloseTo(-0.5 * 1.2 * 1.0);
  });
});

describe("calcProgramSpecificAllocation", () => {
  it("uses fallback denominator (68) when roster total is below it", () => {
    // rosterTotal=30 < 68, so denominator = 68
    const result = calcProgramSpecificAllocation({
      playerScore: 5,
      rosterTotalPlayerScore: 30,
      nilBudget: 1_000_000,
    });
    expect(result).toBeCloseTo((5 / DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE) * 1_000_000);
  });

  it("uses roster total when it exceeds fallback", () => {
    // rosterTotal=100 > 68, so denominator = 100
    const result = calcProgramSpecificAllocation({
      playerScore: 5,
      rosterTotalPlayerScore: 100,
      nilBudget: 1_000_000,
    });
    expect(result).toBeCloseTo(50_000);
  });

  it("uses exact fallback as denominator when roster equals fallback exactly", () => {
    const result = calcProgramSpecificAllocation({
      playerScore: 10,
      rosterTotalPlayerScore: DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE,
      nilBudget: 680_000,
    });
    // 10 / 68 * 680_000 = 100_000
    expect(result).toBeCloseTo(100_000);
  });

  it("returns 0 for zero budget", () => {
    expect(
      calcProgramSpecificAllocation({ playerScore: 5, rosterTotalPlayerScore: 100, nilBudget: 0 }),
    ).toBe(0);
  });

  it("returns 0 for negative budget", () => {
    expect(
      calcProgramSpecificAllocation({ playerScore: 5, rosterTotalPlayerScore: 100, nilBudget: -500 }),
    ).toBe(0);
  });

  it("respects custom fallbackTotalPlayerScore", () => {
    // rosterTotal=20 < customFallback=100, so denominator=100
    const result = calcProgramSpecificAllocation({
      playerScore: 10,
      rosterTotalPlayerScore: 20,
      nilBudget: 100_000,
      fallbackTotalPlayerScore: 100,
    });
    expect(result).toBeCloseTo(10_000);
  });

  it("star player (high score) gets proportionally more budget", () => {
    const star = calcProgramSpecificAllocation({
      playerScore: 20,
      rosterTotalPlayerScore: 100,
      nilBudget: 2_000_000,
    });
    const bench = calcProgramSpecificAllocation({
      playerScore: 2,
      rosterTotalPlayerScore: 100,
      nilBudget: 2_000_000,
    });
    expect(star).toBeGreaterThan(bench);
    expect(star / bench).toBeCloseTo(10); // linear proportion
  });
});
