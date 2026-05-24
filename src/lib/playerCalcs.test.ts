import { describe, it, expect } from "vitest";
import { computeOWarFromWrcPlus } from "./playerCalcs";
import { computeOWar } from "@/savant/lib/war";

// ── computeOWarFromWrcPlus ────────────────────────────────────────────────────

describe("computeOWarFromWrcPlus", () => {
  it("returns null for null wrcPlus", () => {
    expect(computeOWarFromWrcPlus(null)).toBeNull();
    expect(computeOWarFromWrcPlus(null, 400)).toBeNull();
  });

  it("returns null for undefined wrcPlus", () => {
    expect(computeOWarFromWrcPlus(undefined)).toBeNull();
  });

  it("defaults PA to 260 when not provided", () => {
    const result = computeOWarFromWrcPlus(100);
    const expected = ((260 / 600) * 25) / 10;
    expect(result).toBeCloseTo(expected, 6);
  });

  it("defaults PA to 260 when null", () => {
    expect(computeOWarFromWrcPlus(100, null)).toBeCloseTo(
      computeOWarFromWrcPlus(100) as number,
      6,
    );
  });

  it("league-average hitter (100 wRC+, 600 PA) → 2.5 WAR", () => {
    expect(computeOWarFromWrcPlus(100, 600)).toBeCloseTo(2.5, 6);
  });

  it("above-average hitter (130 wRC+, 600 PA) → 4.84 WAR", () => {
    expect(computeOWarFromWrcPlus(130, 600)).toBeCloseTo(4.84, 6);
  });
});

// ── Parity: computeOWarFromWrcPlus must equal computeOWar ────────────────────
//
// Both functions implement the same formula. If one gets updated without the
// other, these tests catch the drift. When this test fails it means either:
//   (a) a formula change was intentional and the other copy needs updating, OR
//   (b) a copy-paste diverged — fix whichever is wrong.
//
// The canonical home is src/savant/lib/war.ts (computeOWar).
// src/lib/playerCalcs.ts (computeOWarFromWrcPlus) is the shared alias used
// across the frontend. They MUST produce identical output.

describe("parity: computeOWarFromWrcPlus === computeOWar", () => {
  const cases: Array<{ wrcPlus: number; pa: number }> = [
    { wrcPlus: 70, pa: 200 },
    { wrcPlus: 85, pa: 260 },
    { wrcPlus: 100, pa: 260 },
    { wrcPlus: 100, pa: 400 },
    { wrcPlus: 100, pa: 600 },
    { wrcPlus: 115, pa: 450 },
    { wrcPlus: 130, pa: 600 },
    { wrcPlus: 150, pa: 550 },
    { wrcPlus: 160, pa: 600 },
  ];

  for (const { wrcPlus, pa } of cases) {
    it(`wrcPlus=${wrcPlus}, pa=${pa}`, () => {
      const fromCalcs = computeOWarFromWrcPlus(wrcPlus, pa);
      const fromWar = computeOWar(wrcPlus, pa);
      expect(fromCalcs).not.toBeNull();
      expect(fromCalcs).toBeCloseTo(fromWar as number, 8);
    });
  }

  it("both return null for null wrcPlus", () => {
    expect(computeOWarFromWrcPlus(null)).toBeNull();
    expect(computeOWar(null)).toBeNull();
  });

  it("both use same default PA (260) when PA is omitted", () => {
    const withDefault = computeOWarFromWrcPlus(110);
    const withExplicit = computeOWar(110, 260);
    expect(withDefault).toBeCloseTo(withExplicit as number, 8);
  });
});
