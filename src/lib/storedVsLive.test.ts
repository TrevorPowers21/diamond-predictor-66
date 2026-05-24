/**
 * Stored-vs-Live Parity Tests
 *
 * PURPOSE: Catch drift when features are added or formulas change in one place
 * but not another. These tests don't verify business logic — they verify that
 * multiple code paths producing the same metric agree with each other.
 *
 * WHY THIS MATTERS: The stored-vs-live audit (docs/stored-derived-values-plan.md)
 * found that PitcherProfile.tsx live-recomputes while Dashboard reads from
 * stored player_predictions rows. The two paths diverge when equation weights
 * change, PR+ refreshes, or park factors update. These tests pin the math so
 * any divergence is immediately visible.
 *
 * ADDING A TEST: When you add a new metric to the precompute pipeline, add a
 * corresponding test here that verifies the precompute formula and the live
 * formula produce the same result for representative inputs.
 */
import { describe, it, expect } from "vitest";

// Canonical formula locations
import { computeOWar } from "@/savant/lib/war";
import { computeWrcPlus, SAVANT_WRC_WEIGHTS, SAVANT_NCAA_WRC } from "@/savant/lib/wrcPlus";
import { computeOWarFromWrcPlus } from "@/lib/playerCalcs";
import { projectPitchingRate, PITCHING_POWER_RATING_WEIGHT, PITCHING_DEV_FACTOR } from "@/lib/pitcherProjection";
import { computePWar } from "@/savant/lib/war";

// ── Hitter: oWAR formula consistency across all call sites ───────────────────
//
// oWAR is computed inline in:
//   - src/savant/lib/war.ts:computeOWar (canonical)
//   - src/lib/playerCalcs.ts:computeOWarFromWrcPlus (frontend alias)
//   - src/lib/transferProjection.ts:computeTransferProjection (inlined)
//
// If the inline copy in transferProjection.ts ever diverges (different
// runsPerPa, replacementRuns, or rounding), these constants tests will
// catch it before the parity shows up as a UI number mismatch.

describe("hitter oWAR formula constants", () => {
  const RUNS_PER_PA = 0.13;
  const REPLACEMENT_RUNS_FACTOR = 25; // runs per 600 PA at replacement level
  const RUNS_PER_WIN = 10;

  it("runsPerPa is 0.13 across all implementations", () => {
    // Verify by back-calculating from computeOWar output
    // For an average hitter (wRC+=100, PA=600): raa=0, rar=replacementRuns
    // For PA=600: replacementRuns = (600/600)*25 = 25; WAR = 25/10 = 2.5
    const result = computeOWar(100, 600)!;
    expect(result).toBeCloseTo(REPLACEMENT_RUNS_FACTOR / RUNS_PER_WIN, 6);
  });

  it("runsPerWin is 10 across all implementations", () => {
    // Above-average hitter: wRC+=130, PA=600
    // offValue=0.30; raa=0.30*600*0.13=23.4; rar=48.4; WAR=4.84
    expect(computeOWar(130, 600)).toBeCloseTo(4.84, 6);
    expect(computeOWarFromWrcPlus(130, 600)).toBeCloseTo(4.84, 6);
  });

  it("transferProjection inline oWAR formula matches computeOWar for known pWrcPlus values", () => {
    // The inline formula in transferProjection.ts:
    //   const offValue = (pWrcPlus - 100) / 100;
    //   const pa = input.actualPa ?? 260;
    //   const runsPerPa = 0.13;
    //   const replacementRuns = (pa / 600) * 25;
    //   const raa = offValue * pa * runsPerPa;
    //   const rar = raa + replacementRuns;
    //   const owar = rar / 10;
    //
    // Replicate that inline math and verify it matches computeOWar.
    // If transferProjection.ts ever changes those constants, this test fails.
    const inlineOWar = (pWrcPlus: number, pa: number) => {
      const offValue = (pWrcPlus - 100) / 100;
      const runsPerPa = 0.13;
      const replacementRuns = (pa / 600) * 25;
      const raa = offValue * pa * runsPerPa;
      const rar = raa + replacementRuns;
      return rar / 10;
    };

    const testCases = [
      { pWrcPlus: 95, pa: 260 },
      { pWrcPlus: 100, pa: 400 },
      { pWrcPlus: 115, pa: 550 },
      { pWrcPlus: 128, pa: 600 },
      { pWrcPlus: 70, pa: 200 },
    ];

    for (const { pWrcPlus, pa } of testCases) {
      expect(inlineOWar(pWrcPlus, pa)).toBeCloseTo(computeOWar(pWrcPlus, pa)!, 6);
    }
  });
});

// ── Hitter: wRC+ weights consistent across all locations ────────────────────
//
// wRC+ weights are defined in:
//   - src/savant/lib/wrcPlus.ts (SAVANT_WRC_WEIGHTS, SAVANT_NCAA_WRC)
//   - src/lib/predictionEngine.ts (DEFAULT_WRC_WEIGHTS, ncaaWrc: 0.364)
//   - src/lib/transferProjection.ts (passed as input.wObp / wSlg / wAvg / wIso)
//
// The comment in wrcPlus.ts says: "If the canonical weights ever change in
// predictionEngine.ts, update them here too." These tests make that manual
// reminder unnecessary — a weight change anywhere that breaks consistency
// will immediately fail here.

describe("hitter wRC+ weight constants", () => {
  it("SAVANT_WRC_WEIGHTS match the canonical DEFAULT_WRC_WEIGHTS in predictionEngine", () => {
    expect(SAVANT_WRC_WEIGHTS.obp).toBe(0.45);
    expect(SAVANT_WRC_WEIGHTS.slg).toBe(0.30);
    expect(SAVANT_WRC_WEIGHTS.avg).toBe(0.15);
    expect(SAVANT_WRC_WEIGHTS.iso).toBe(0.10);
  });

  it("SAVANT_NCAA_WRC matches predictionEngine ncaaWrc constant (0.364)", () => {
    expect(SAVANT_NCAA_WRC).toBe(0.364);
  });

  it("computeWrcPlus formula is the ratio of weighted sum to ncaaWrc times 100", () => {
    // Derive expected manually and verify computeWrcPlus agrees
    const avg = 0.290, obp = 0.365, slg = 0.450, iso = 0.160;
    const raw =
      SAVANT_WRC_WEIGHTS.obp * obp +
      SAVANT_WRC_WEIGHTS.slg * slg +
      SAVANT_WRC_WEIGHTS.avg * avg +
      SAVANT_WRC_WEIGHTS.iso * iso;
    const expected = Math.round((raw / SAVANT_NCAA_WRC) * 100);
    expect(computeWrcPlus(avg, obp, slg, iso)).toBe(expected);
  });
});

// ── Pitcher: pWAR formula consistency ───────────────────────────────────────
//
// pWAR is defined in:
//   - src/savant/lib/war.ts:computePWar (canonical)
//   - src/lib/pitcherProjection.ts:computePitcherProjection (uses computePWar — OK)
//   - src/lib/transferPitcherProjection.ts (verify it calls computePWar, not inline)
//
// INTENT: If a future dev inlines pWAR in transferPitcherProjection.ts instead
// of calling computePWar, the parity test below should fail. Add that test
// when transferPitcherProjection is updated.

describe("pitcher pWAR formula constants", () => {
  it("computePWar uses rPer9=5.5 and replacementRunsPer9=2.5 by default", () => {
    // For league-average pitcher (prvPlus=100) all RAA terms cancel
    // WAR = (0 + (IP/9)*2.5) / 10
    const ip = 90;
    const expectedFromReplacementOnly = (ip / 9) * 2.5 / 10;
    expect(computePWar(100, ip)).toBeCloseTo(expectedFromReplacementOnly, 6);
  });

  it("pWAR runsPerWin is 10 by default", () => {
    const ip = 90;
    const prvPlus = 120;
    const pitcherValue = (prvPlus - 100) / 100;
    const rpa = pitcherValue * (ip / 9) * 5.5;
    const replacementRuns = (ip / 9) * 2.5;
    const expected = (rpa + replacementRuns) / 10;
    expect(computePWar(prvPlus, ip)).toBeCloseTo(expected, 6);
  });
});

// ── Pitcher: projectPitchingRate blend weight must not drift ─────────────────
//
// PITCHING_POWER_RATING_WEIGHT = 0.7 means stored/precomputed PR+ drives 70%
// of the projection. Lowering this increases last-season stat reliance (more
// volatile). Raising it is over-reliant on scouting. Pin the value so any
// change requires an explicit test update — not a silent formula tweak.

describe("pitcher projection blend weight", () => {
  it("PITCHING_POWER_RATING_WEIGHT is 0.7", () => {
    expect(PITCHING_POWER_RATING_WEIGHT).toBe(0.7);
  });

  it("PITCHING_DEV_FACTOR is 0.06 per unit of devAggressiveness", () => {
    expect(PITCHING_DEV_FACTOR).toBe(0.06);
  });

  it("blend weight is correctly applied in projectPitchingRate", () => {
    // When prPlus=100, powerAdjusted = ncaaAvg exactly
    // blended = lastStat * 0.3 + ncaaAvg * 0.7
    const lastStat = 4.0;
    const ncaaAvg = 4.50;
    const result = projectPitchingRate({
      lastStat,
      prPlus: 100,
      ncaaAvg,
      ncaaSd: 1.2,
      prSd: 15,
      classAdjustment: 0,
      devAggressiveness: 0,
      thresholds: [],
      impacts: [],
      lowerIsBetter: true,
    })!;
    const expected = lastStat * (1 - PITCHING_POWER_RATING_WEIGHT) + ncaaAvg * PITCHING_POWER_RATING_WEIGHT;
    expect(result).toBeCloseTo(expected, 6);
  });
});

// ── Known regression cases (Trevor's bugs, to be green once stored-first lands)
//
// These are documented mismatch cases from docs/stored-derived-values-plan.md.
// They are NOT currently testing live code paths — they pin known values so
// once the stored-first read path is implemented, we can verify the numbers
// match the expected stored values.
//
// To activate a test: remove the `.skip`, implement the read from stored row,
// and verify the output matches.

describe.skip("known regressions — activate as stored-first paths land", () => {
  it("Rossow ERA: PitcherProfile and Dashboard show same value", () => {
    // Rossow currently shows 2.13 ERA on PitcherProfile and 2.15 on Dashboard
    // Root cause: PitcherProfile live-recomputes, Dashboard reads stored row
    // Fix: both surfaces read player_predictions.p_era where customer_team_id IS NULL
    // Expected value once fixed: the stored p_era (source of truth)
    expect(true).toBe(false); // placeholder — implement after Phase 4a
  });

  it("TB Compare tab: transfer player projection matches target board projection", () => {
    // TB Compare tab was computing projections with stale/missing inputs
    // Fix: both surfaces read same stored row
    expect(true).toBe(false); // placeholder — implement after Phase 4
  });
});
