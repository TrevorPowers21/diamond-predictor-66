import { describe, it, expect } from "vitest";
import {
  projectPitchingRate,
  dampFactorForProjected,
  PITCHING_POWER_RATING_WEIGHT,
  PITCHING_DEV_FACTOR,
} from "./pitcherProjection";
import { computePWar } from "@/savant/lib/war";

// Shared helpers for building projectPitchingRate args
const eraBase = {
  ncaaAvg: 4.50,
  ncaaSd: 1.20,
  prSd: 15,
  classAdjustment: 0,
  devAggressiveness: 0,
  thresholds: [],
  impacts: [],
  lowerIsBetter: true,
} as const;

const k9Base = {
  ncaaAvg: 9.0,
  ncaaSd: 2.0,
  prSd: 15,
  classAdjustment: 0,
  devAggressiveness: 0,
  thresholds: [],
  impacts: [],
  lowerIsBetter: false,
} as const;

// ── dampFactorForProjected ────────────────────────────────────────────────────
// NOTE: damping is disabled in the live engine (2026-05-05) but the pure
// function remains and should still behave correctly if re-enabled.

describe("dampFactorForProjected", () => {
  it("returns first impact when projected is below first threshold", () => {
    expect(dampFactorForProjected(1.5, [2.0, 3.5], [0.7, 0.85, 1.0])).toBe(0.7);
  });

  it("returns middle impact when projected is between thresholds", () => {
    expect(dampFactorForProjected(3.0, [2.0, 3.5], [0.7, 0.85, 1.0])).toBe(0.85);
  });

  it("returns last impact when projected exceeds all thresholds", () => {
    expect(dampFactorForProjected(5.0, [2.0, 3.5], [0.7, 0.85, 1.0])).toBe(1.0);
  });

  it("empty thresholds → falls back to last impact", () => {
    expect(dampFactorForProjected(3.0, [], [0.9])).toBe(0.9);
  });
});

// ── projectPitchingRate ───────────────────────────────────────────────────────

describe("projectPitchingRate — null guards", () => {
  it("returns null when lastStat is null", () => {
    expect(projectPitchingRate({ ...eraBase, lastStat: null, prPlus: 100 })).toBeNull();
  });

  it("returns null when prPlus is null and fallbackToLastStat is false (default)", () => {
    expect(projectPitchingRate({ ...eraBase, lastStat: 3.50, prPlus: null })).toBeNull();
  });

  it("returns lastStat when prPlus is null and fallbackToLastStat=true", () => {
    expect(
      projectPitchingRate({ ...eraBase, lastStat: 3.50, prPlus: null, fallbackToLastStat: true }),
    ).toBe(3.50);
  });

  it("returns null when prSd is 0 (guard against divide-by-zero)", () => {
    expect(projectPitchingRate({ ...eraBase, lastStat: 3.50, prPlus: 100, prSd: 0 })).toBeNull();
  });
});

describe("projectPitchingRate — ERA (lowerIsBetter=true)", () => {
  it("league-average pitcher (prPlus=100) blends toward ncaaAvg", () => {
    // zShift = ((100-100)/15)*1.20 = 0 → powerAdjusted = 4.50
    // blended = 3.50*0.30 + 4.50*0.70 = 1.05 + 3.15 = 4.20
    // mult = 1.0 → projected = 4.20
    const result = projectPitchingRate({ ...eraBase, lastStat: 3.50, prPlus: 100 });
    expect(result).toBeCloseTo(4.20, 6);
  });

  it("above-average pitcher (prPlus=110) projects lower ERA", () => {
    // zShift = (10/15)*1.20 = 0.80 → powerAdjusted = 4.50 - 0.80 = 3.70
    // blended = 3.50*0.30 + 3.70*0.70 = 1.05 + 2.59 = 3.64
    const result = projectPitchingRate({ ...eraBase, lastStat: 3.50, prPlus: 110 });
    expect(result).toBeCloseTo(3.64, 6);
  });

  it("below-average pitcher (prPlus=85) projects higher ERA", () => {
    // zShift = (-15/15)*1.20 = -1.20 → powerAdjusted = 4.50 - (-1.20) = 5.70
    // blended = 3.50*0.30 + 5.70*0.70 = 1.05 + 3.99 = 5.04
    const result = projectPitchingRate({ ...eraBase, lastStat: 3.50, prPlus: 85 });
    expect(result).toBeCloseTo(5.04, 6);
  });

  it("devAggressiveness lowers ERA projection (lowerIsBetter — better when lower)", () => {
    // mult = 1 - 0 - (0.5 * 0.06) = 0.97
    const baseline = projectPitchingRate({ ...eraBase, lastStat: 3.50, prPlus: 110 })!;
    const aggressive = projectPitchingRate({
      ...eraBase, lastStat: 3.50, prPlus: 110, devAggressiveness: 0.5,
    })!;
    expect(aggressive).toBeLessThan(baseline);
    expect(aggressive).toBeCloseTo(baseline * (1 - 0.5 * PITCHING_DEV_FACTOR), 6);
  });

  it("positive classAdjustment lowers ERA (improving player)", () => {
    const baseline = projectPitchingRate({ ...eraBase, lastStat: 4.0, prPlus: 100 })!;
    const adjusted = projectPitchingRate({
      ...eraBase, lastStat: 4.0, prPlus: 100, classAdjustment: 0.05,
    })!;
    expect(adjusted).toBeLessThan(baseline);
  });
});

describe("projectPitchingRate — K/9 (lowerIsBetter=false)", () => {
  it("above-average pitcher (prPlus=115) projects higher K/9", () => {
    // zShift = (15/15)*2.0 = 2.0 → powerAdjusted = 9.0 + 2.0 = 11.0
    // blended = 8.5*0.30 + 11.0*0.70 = 2.55 + 7.70 = 10.25
    const result = projectPitchingRate({ ...k9Base, lastStat: 8.5, prPlus: 115 });
    expect(result).toBeCloseTo(10.25, 6);
  });

  it("devAggressiveness raises K/9 projection (!lowerIsBetter — better when higher)", () => {
    const baseline = projectPitchingRate({ ...k9Base, lastStat: 8.5, prPlus: 115 })!;
    const aggressive = projectPitchingRate({
      ...k9Base, lastStat: 8.5, prPlus: 115, devAggressiveness: 1,
    })!;
    expect(aggressive).toBeGreaterThan(baseline);
    expect(aggressive).toBeCloseTo(baseline * (1 + 1 * PITCHING_DEV_FACTOR), 6);
  });
});

describe("projectPitchingRate — PITCHING_POWER_RATING_WEIGHT", () => {
  it("blend weight constant is 0.7 (stored value drives 70% of projection)", () => {
    expect(PITCHING_POWER_RATING_WEIGHT).toBe(0.7);
  });

  it("with prPlus=100, result is pure weighted average of lastStat and ncaaAvg", () => {
    // When prPlus = 100, powerAdjusted = ncaaAvg exactly
    // blended = lastStat*(1-0.7) + ncaaAvg*0.7
    const lastStat = 3.0;
    const ncaaAvg = 4.50;
    const expected = lastStat * (1 - PITCHING_POWER_RATING_WEIGHT) + ncaaAvg * PITCHING_POWER_RATING_WEIGHT;
    expect(projectPitchingRate({ ...eraBase, lastStat, prPlus: 100 })).toBeCloseTo(expected, 6);
  });
});

// ── pWAR via computePWar (same formula used by pitcherProjection pipeline) ───
//
// These tests pin the pWAR formula independently so that if pitcherProjection.ts
// ever starts inlining its own pWAR instead of using src/savant/lib/war.ts,
// the formula-consistency tests in storedVsLive.test.ts will catch the drift.

describe("pWAR formula pins (via computePWar)", () => {
  it("role-level IP ranges produce expected WAR bands", () => {
    // Typical starter (100-130 IP), average pitcher
    const starterWar = computePWar(100, 115)!;
    expect(starterWar).toBeGreaterThan(2.0);
    expect(starterWar).toBeLessThan(4.0);

    // Typical reliever (30-50 IP), above-average pitcher
    const relieverwWar = computePWar(120, 45)!;
    expect(relieverwWar).toBeGreaterThan(0.8);
    expect(relieverwWar).toBeLessThan(2.5);
  });
});
