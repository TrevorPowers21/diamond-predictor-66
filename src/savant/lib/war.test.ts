import { describe, it, expect } from "vitest";
import { computeWrcRaw, computeWrcPlus, SAVANT_WRC_WEIGHTS, SAVANT_NCAA_WRC } from "./wrcPlus";
import { computeOWar, computeOWarFromStats, computePWar } from "./war";

// ── wRC+ ─────────────────────────────────────────────────────────────────────

describe("computeWrcRaw", () => {
  it("returns null if any input is null", () => {
    expect(computeWrcRaw(null, 0.380, 0.480, 0.180)).toBeNull();
    expect(computeWrcRaw(0.300, null, 0.480, 0.180)).toBeNull();
    expect(computeWrcRaw(0.300, 0.380, null, 0.180)).toBeNull();
    expect(computeWrcRaw(0.300, 0.380, 0.480, null)).toBeNull();
  });

  it("computes weighted sum of slash stats", () => {
    // raw = 0.45*OBP + 0.30*SLG + 0.15*AVG + 0.10*ISO
    const result = computeWrcRaw(0.300, 0.380, 0.480, 0.180);
    const expected =
      SAVANT_WRC_WEIGHTS.obp * 0.380 +
      SAVANT_WRC_WEIGHTS.slg * 0.480 +
      SAVANT_WRC_WEIGHTS.avg * 0.300 +
      SAVANT_WRC_WEIGHTS.iso * 0.180;
    expect(result).toBeCloseTo(expected, 6);
  });

  it("zero stats produce zero raw", () => {
    expect(computeWrcRaw(0, 0, 0, 0)).toBe(0);
  });
});

describe("computeWrcPlus", () => {
  it("returns null if any stat is null", () => {
    expect(computeWrcPlus(null, 0.380, 0.480, 0.180)).toBeNull();
  });

  it("league-average slash line produces wRC+ near 100", () => {
    // Construct a slash line whose raw equals the NCAA average (0.364)
    // using average-ish values — the result should round to 100
    // avg=0.280, obp=0.360, slg=0.430, iso=0.150
    // raw = 0.45*0.360 + 0.30*0.430 + 0.15*0.280 + 0.10*0.150
    //     = 0.162 + 0.129 + 0.042 + 0.015 = 0.348  (slightly below 100)
    // Use exact inverse: any combo where raw = 0.364 should give 100
    // Simplest: all weights to one slot → obp-only: obp = 0.364/0.45 is messy
    // Instead use the definition directly:
    const obp = SAVANT_NCAA_WRC / SAVANT_WRC_WEIGHTS.obp; // 0.364 / 0.45 ≈ 0.809 — unrealistic but math-correct
    const result = computeWrcPlus(0, obp, 0, 0);
    expect(result).toBe(100);
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

  it("known value: .300/.380/.480/.180 → 104", () => {
    // raw = 0.45*0.380 + 0.30*0.480 + 0.15*0.300 + 0.10*0.180
    //     = 0.171 + 0.144 + 0.045 + 0.018 = 0.378
    // wRC+ = round(0.378 / 0.364 * 100) = round(103.85) = 104
    expect(computeWrcPlus(0.300, 0.380, 0.480, 0.180)).toBe(104);
  });
});

// ── oWAR ─────────────────────────────────────────────────────────────────────

describe("computeOWar", () => {
  it("returns null for null wrcPlus", () => {
    expect(computeOWar(null)).toBeNull();
    expect(computeOWar(null, 400)).toBeNull();
  });

  it("league-average wRC+ (100) at 600 PA → 2.5 WAR (replacement baseline)", () => {
    // offValue = 0 → raa = 0; replacementRuns = (600/600)*25 = 25; WAR = 25/10 = 2.5
    expect(computeOWar(100, 600)).toBeCloseTo(2.5, 6);
  });

  it("above-average hitter (130 wRC+, 600 PA) → 4.84 WAR", () => {
    // offValue = 0.30; raa = 0.30*600*0.13 = 23.4; rar = 48.4; WAR = 4.84
    expect(computeOWar(130, 600)).toBeCloseTo(4.84, 6);
  });

  it("below-replacement hitter (70 wRC+, 600 PA) → positive WAR (replacement floor not enforced)", () => {
    // offValue = -0.30; raa = -23.4; rar = 1.6; WAR = 0.16
    expect(computeOWar(70, 600)).toBeCloseTo(0.16, 6);
  });

  it("defaults PA to 260 when not provided", () => {
    // replacementRuns = (260/600)*25 ≈ 10.833; raa = 0; oWAR ≈ 1.083
    const result = computeOWar(100);
    expect(result).toBeCloseTo((260 / 600) * 25 / 10, 4);
  });

  it("defaults PA to 260 when null", () => {
    expect(computeOWar(100, null)).toBeCloseTo(computeOWar(100) as number, 6);
  });

  it("star hitter (160 wRC+, 550 PA)", () => {
    const offValue = 0.60;
    const pa = 550;
    const raa = offValue * pa * 0.13;
    const replacementRuns = (pa / 600) * 25;
    const expected = (raa + replacementRuns) / 10;
    expect(computeOWar(160, 550)).toBeCloseTo(expected, 6);
  });
});

describe("computeOWarFromStats", () => {
  it("returns null if any stat is null", () => {
    expect(computeOWarFromStats(null, 0.380, 0.480, 0.180, 500)).toBeNull();
    expect(computeOWarFromStats(0.300, null, 0.480, 0.180, 500)).toBeNull();
  });

  it("computes wRC+ first then oWAR — consistent with computeWrcPlus + computeOWar chain", () => {
    const avg = 0.300, obp = 0.380, slg = 0.480, iso = 0.180, pa = 550;
    const wrcPlus = computeWrcPlus(avg, obp, slg, iso)!;
    const expected = computeOWar(wrcPlus, pa);
    expect(computeOWarFromStats(avg, obp, slg, iso, pa)).toBeCloseTo(expected as number, 6);
  });
});

// ── pWAR ─────────────────────────────────────────────────────────────────────

describe("computePWar", () => {
  it("returns null for null prvPlus", () => {
    expect(computePWar(null, 100)).toBeNull();
  });

  it("returns null for null ip", () => {
    expect(computePWar(110, null)).toBeNull();
  });

  it("returns null for ip = 0 (avoid divide-by-zero edge)", () => {
    expect(computePWar(110, 0)).toBeNull();
  });

  it("league-average pitcher (100 pRV+, 90 IP) → 2.5 WAR", () => {
    // pitcherValue=0; rpa=0; replacementRuns=(90/9)*2.5=25; pWAR=25/10=2.5
    expect(computePWar(100, 90)).toBeCloseTo(2.5, 6);
  });

  it("above-average pitcher (120 pRV+, 90 IP) → 3.6 WAR", () => {
    // pitcherValue=0.20; rpa=0.20*(90/9)*5.5=11; replacementRuns=25; rar=36; pWAR=3.6
    expect(computePWar(120, 90)).toBeCloseTo(3.6, 6);
  });

  it("elite starter (140 pRV+, 120 IP)", () => {
    const pitcherValue = 0.40;
    const rpa = pitcherValue * (120 / 9) * 5.5;
    const replacementRuns = (120 / 9) * 2.5;
    const expected = (rpa + replacementRuns) / 10;
    expect(computePWar(140, 120)).toBeCloseTo(expected, 6);
  });

  it("below-replacement pitcher (70 pRV+, 60 IP) still positive (replacement floor)", () => {
    const pitcherValue = -0.30;
    const rpa = pitcherValue * (60 / 9) * 5.5;
    const replacementRuns = (60 / 9) * 2.5;
    const expected = (rpa + replacementRuns) / 10;
    expect(computePWar(70, 60)).toBeCloseTo(expected, 6);
  });

  it("accepts custom rPer9, replacementRunsPer9, runsPerWin", () => {
    // With rPer9=4.5, replacementRunsPer9=2.0, runsPerWin=9
    const pitcherValue = 0.20;
    const ip = 90;
    const rpa = pitcherValue * (ip / 9) * 4.5;
    const replacementRuns = (ip / 9) * 2.0;
    const expected = (rpa + replacementRuns) / 9;
    expect(computePWar(120, ip, 4.5, 2.0, 9)).toBeCloseTo(expected, 6);
  });
});
