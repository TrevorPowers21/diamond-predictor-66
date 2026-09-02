import { describe, it, expect } from "vitest";
import { computeWrcRaw, computeWrcPlus, SAVANT_WRC_WEIGHTS, SAVANT_NCAA_WRC, SAVANT_WRC_INTERCEPT } from "./wrcPlus";
import {
  computeOWar, computeOWarFromStats,
  computeDWar, computeBsrWar, computeTotalWar, computePositionalValue,
  RUNS_PER_WIN, RUNS_PER_PA, REPLACEMENT_RUNS_PER_600PA,
} from "./war";

// ── wRC+ ─────────────────────────────────────────────────────────────────────

describe("computeWrcRaw", () => {
  it("returns null only when OBP or SLG is null (AVG/ISO redundant in C1)", () => {
    expect(computeWrcRaw(0.300, null, 0.480, 0.180)).toBeNull();
    expect(computeWrcRaw(0.300, 0.380, null, 0.180)).toBeNull();
    // AVG/ISO carry weight 0 in C1, so a null there is fine:
    expect(computeWrcRaw(null, 0.380, 0.480, null)).not.toBeNull();
  });

  it("computes the C1 est_wOBA: intercept + weighted OBP/SLG", () => {
    // est_wOBA = 0.011 + 0.691*OBP + 0.235*SLG (AVG/ISO weight 0)
    const result = computeWrcRaw(0.300, 0.380, 0.480, 0.180);
    const expected =
      SAVANT_WRC_INTERCEPT +
      SAVANT_WRC_WEIGHTS.obp * 0.380 +
      SAVANT_WRC_WEIGHTS.slg * 0.480 +
      SAVANT_WRC_WEIGHTS.avg * 0.300 +
      SAVANT_WRC_WEIGHTS.iso * 0.180;
    expect(result).toBeCloseTo(expected, 6);
  });

  it("zero stats produce the intercept", () => {
    expect(computeWrcRaw(0, 0, 0, 0)).toBeCloseTo(SAVANT_WRC_INTERCEPT, 6);
  });
});

describe("computeWrcPlus", () => {
  it("returns null when OBP or SLG is null", () => {
    expect(computeWrcPlus(0.300, null, 0.480, 0.180)).toBeNull();
  });

  it("league-average slash line produces wRC+ ~100", () => {
    // all-D1 average slash → est_wOBA ≈ lgwOBA 0.3782 (SAVANT_NCAA_WRC) → wRC+ ~100
    const result = computeWrcPlus(0.278, 0.382, 0.437, 0.159);
    expect(result).toBeGreaterThanOrEqual(99);
    expect(result).toBeLessThanOrEqual(101);
  });

  it("above-average hitter produces wRC+ > 100", () => {
    const result = computeWrcPlus(0.310, 0.400, 0.520, 0.210);
    expect(result).toBeGreaterThan(100);
  });

  it("below-average hitter produces wRC+ < 100", () => {
    const result = computeWrcPlus(0.230, 0.290, 0.330, 0.100);
    expect(result).toBeLessThan(100);
  });

  it("produces integer (Math.round applied)", () => {
    const result = computeWrcPlus(0.300, 0.380, 0.480, 0.180);
    expect(result).toBe(Math.round(result as number));
  });

  it("known value: .300/.380/.480/.180 → 102 (C1)", () => {
    // est_wOBA = 0.011 + 0.691*0.380 + 0.235*0.480 = 0.38638
    // wRC+ = round(0.38638 / 0.3782 * 100) = round(102.16) = 102
    expect(computeWrcPlus(0.300, 0.380, 0.480, 0.180)).toBe(102);
  });
});

// ── oWAR ─────────────────────────────────────────────────────────────────────

describe("computeOWar", () => {
  it("returns null for null wrcPlus", () => {
    expect(computeOWar(null)).toBeNull();
    expect(computeOWar(null, 400)).toBeNull();
  });

  it("league-average wRC+ (100) at 600 PA → replacement baseline", () => {
    // offValue = 0 → raa = 0; WAR = replacement / rpw (= 2.0 wins/600 at D1 scale)
    expect(computeOWar(100, 600)).toBeCloseTo(REPLACEMENT_RUNS_PER_600PA / RUNS_PER_WIN, 6);
  });

  it("above-average hitter (130 wRC+, 600 PA) matches the formula", () => {
    const raa = 0.30 * 600 * RUNS_PER_PA;
    const repl = REPLACEMENT_RUNS_PER_600PA;
    expect(computeOWar(130, 600)).toBeCloseTo((raa + repl) / RUNS_PER_WIN, 6);
  });

  it("defaults PA to 260 when not provided", () => {
    const repl = REPLACEMENT_RUNS_PER_600PA * (260 / 600);
    expect(computeOWar(100)).toBeCloseTo(repl / RUNS_PER_WIN, 6);
  });

  it("defaults PA to 260 when null", () => {
    expect(computeOWar(100, null)).toBeCloseTo(computeOWar(100) as number, 6);
  });

  it("star hitter (160 wRC+, 550 PA) matches the formula", () => {
    const raa = 0.60 * 550 * RUNS_PER_PA;
    const repl = REPLACEMENT_RUNS_PER_600PA * (550 / 600);
    expect(computeOWar(160, 550)).toBeCloseTo((raa + repl) / RUNS_PER_WIN, 6);
  });

  it("playing-time scales: a 250-PA hitter reads lower than a 600-PA equivalent", () => {
    expect(computeOWar(100, 250)!).toBeLessThan(computeOWar(100, 600)!);
  });
});

// ── composite buckets: dWAR / bsrWAR / positional scarcity / total ──────────────
describe("WAR buckets (composite)", () => {
  it("dWAR = defensive runs ÷ runs-per-win, null → 0", () => {
    expect(computeDWar(6.55)).toBeCloseTo(6.55 / RUNS_PER_WIN, 9);
    expect(computeDWar(null)).toBe(0);
  });

  it("bsrWAR = baserunning runs ÷ runs-per-win, null → 0", () => {
    expect(computeBsrWar(5.72)).toBeCloseTo(5.72 / RUNS_PER_WIN, 9);
    expect(computeBsrWar(null)).toBe(0);
  });

  it("positional scarcity is 0 until baselines are set", () => {
    expect(computePositionalValue("SS")).toBe(0);
    expect(computePositionalValue(null)).toBe(0);
  });

  it("total WAR sums the buckets; replacement lives once in oWAR/pWAR", () => {
    const oWar = computeOWar(120, 250);
    const dWar = computeDWar(6.55);
    const bsrWar = computeBsrWar(3.0);
    expect(computeTotalWar({ oWar, dWar, bsrWar })).toBeCloseTo(
      (oWar as number) + dWar + bsrWar, 9);
  });

  it("a league-average all-around player's total WAR = oWAR replacement, applied once", () => {
    // avg hitter (0 dWAR, 0 bsrWAR, 0 positional) → total = oWAR alone, no double replacement
    const oWar = computeOWar(100, 600);
    expect(computeTotalWar({ oWar, dWar: computeDWar(0), bsrWar: computeBsrWar(0) }))
      .toBeCloseTo(REPLACEMENT_RUNS_PER_600PA / RUNS_PER_WIN, 6);
  });

  it("two-way player sums both offensive and pitching sides", () => {
    const oWar = computeOWar(130, 150);
    const pWar = 1.5; // pitcher WAR comes from the pwar_* path (pitchingEquations), not war.ts
    expect(computeTotalWar({ oWar, pWar })).toBeCloseTo((oWar as number) + pWar, 9);
  });
});

describe("computeOWarFromStats", () => {
  it("returns null if any stat is null", () => {
    // C1 needs OBP + SLG (AVG/ISO redundant → optional)
    expect(computeOWarFromStats(0.300, null, 0.480, 0.180, 500)).toBeNull();
    expect(computeOWarFromStats(0.300, 0.380, null, 0.180, 500)).toBeNull();
  });

  it("computes wRC+ first then oWAR — consistent with computeWrcPlus + computeOWar chain", () => {
    const avg = 0.300, obp = 0.380, slg = 0.480, iso = 0.180, pa = 550;
    const wrcPlus = computeWrcPlus(avg, obp, slg, iso)!;
    const expected = computeOWar(wrcPlus, pa);
    expect(computeOWarFromStats(avg, obp, slg, iso, pa)).toBeCloseTo(expected as number, 6);
  });
});

// computePWar formula pins live in pitcherProjection.test.ts ("pWAR formula pins"). The
// main-app projection pitcher WAR runs on the pwar_* equation weights (src/lib/pitchingEquations.ts,
// D1: 13.1 / 6.915 / 1.92), kept in lockstep with war.ts computePWar (used by TeamProfilePage).
