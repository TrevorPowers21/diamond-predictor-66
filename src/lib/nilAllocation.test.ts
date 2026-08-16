import { describe, it, expect } from "vitest";
import {
  allocateNil,
  nilAlphaForBudget,
  nilFloorFracForBudget,
  NIL_CURVE,
} from "./nilAllocation";

// Georgia roster projection WARs — the exact set validated in chat (2026-08-16).
// Scores are WAR × PTM, but PTM is a constant per roster and cancels in the
// allocation, so ranking on WAR directly reproduces the same dollars.
const GEORGIA = [
  5.14, 3.18, 2.85, 2.44, 2.33, 2.23, 2.04, 1.95, 1.82, 1.58, 1.55, 1.52, 1.31,
  1.2, 1.0, 0.91, 0.88, 0.79, 0.63, 0.53, 0.48, 0.34, 0.33, 0.29, 0.25, 0.14,
  0.05, -0.07,
];

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const paidCount = (a: number[]) => a.filter((x) => x > 0).length;
const top1 = (a: number[]) => Math.max(...a);

describe("nilAllocation budget-flex curve", () => {
  it("budget-flex helpers match the locked formulas", () => {
    // alpha: 1.1 at $5M (clamped endpoint), 1.45 at $1M, ≥ base above $5M
    expect(nilAlphaForBudget(5_000_000)).toBeCloseTo(1.1, 3);
    expect(nilAlphaForBudget(1_000_000)).toBeCloseTo(1.1 + 0.5 * (Math.log(5) / Math.LN10), 3);
    expect(nilAlphaForBudget(10_000_000)).toBe(NIL_CURVE.alphaBase); // clamped
    // floor_frac: drains linearly (balanced), 0 (top-heavy)
    expect(nilFloorFracForBudget(5_000_000, "balanced")).toBeCloseTo(0.1, 5);
    expect(nilFloorFracForBudget(1_000_000, "balanced")).toBeCloseTo(0.02, 5);
    expect(nilFloorFracForBudget(1_000_000, "top_heavy")).toBe(0);
  });

  it("conserves the budget exactly at every budget and mode", () => {
    for (const B of [5_000_000, 3_000_000, 1_000_000, 500_000, 150_000]) {
      for (const mode of ["balanced", "top_heavy"] as const) {
        expect(sum(allocateNil(GEORGIA, B, mode))).toBeCloseTo(B, 2);
      }
    }
  });

  it("reproduces the verified Georgia $5M default (pre-flex-identical endpoint)", () => {
    const a = allocateNil(GEORGIA, 5_000_000, "balanced");
    expect(paidCount(a)).toBe(27); // only the negative-WAR player unpaid
    expect(top1(a)).toBeCloseTo(693_613, -2); // Blair ~$693.6K (13.9%)
  });

  it("reproduces the verified Georgia $1M default (floor drained, top held)", () => {
    const a = allocateNil(GEORGIA, 1_000_000, "balanced");
    expect(paidCount(a)).toBe(19); // floor drained: bottom of roster off the payroll
    expect(top1(a)).toBeCloseTo(206_860, -2); // Blair ~$206.9K (20.7%) — holds value, not linear $139K
  });

  it("top holds MORE than linear as the budget drops", () => {
    const full = top1(allocateNil(GEORGIA, 5_000_000, "balanced"));
    const heldAt1M = top1(allocateNil(GEORGIA, 1_000_000, "balanced")) / full;
    // pure-linear would hold exactly budget ratio (0.20); the ramp holds more
    expect(heldAt1M).toBeGreaterThan(0.2);
  });

  it("floor drains: fewer players paid as the budget shrinks", () => {
    const p5 = paidCount(allocateNil(GEORGIA, 5_000_000, "balanced"));
    const p1 = paidCount(allocateNil(GEORGIA, 1_000_000, "balanced"));
    const p05 = paidCount(allocateNil(GEORGIA, 500_000, "balanced"));
    expect(p5).toBeGreaterThan(p1);
    expect(p1).toBeGreaterThan(p05);
  });

  it("top-heavy toggle concentrates up and pays fewer, still conserving", () => {
    for (const B of [5_000_000, 1_000_000]) {
      const bal = allocateNil(GEORGIA, B, "balanced");
      const th = allocateNil(GEORGIA, B, "top_heavy");
      expect(top1(th)).toBeGreaterThan(top1(bal)); // pushes the top up
      expect(paidCount(th)).toBeLessThanOrEqual(paidCount(bal)); // drops the floor
      expect(sum(th)).toBeCloseTo(B, 2);
    }
  });

  it("allocation is monotonic in score", () => {
    const a = allocateNil(GEORGIA, 2_000_000, "balanced");
    // GEORGIA is sorted descending; paid dollars must be non-increasing too
    const paid = a.filter((x) => x > 0);
    for (let i = 1; i < paid.length; i++) {
      expect(paid[i]).toBeLessThanOrEqual(paid[i - 1] + 1e-6);
    }
  });

  it("degenerate inputs allocate nothing", () => {
    expect(sum(allocateNil(GEORGIA, 0, "balanced"))).toBe(0);
    expect(sum(allocateNil([-1, -2, 0], 1_000_000, "balanced"))).toBe(0);
    expect(allocateNil([], 1_000_000, "balanced")).toEqual([]);
  });

  it("a single positive-score player takes the whole budget", () => {
    const a = allocateNil([3.0, 0, -1], 1_000_000, "balanced");
    expect(a[0]).toBeCloseTo(1_000_000, 2);
    expect(a[1]).toBe(0);
    expect(a[2]).toBe(0);
  });
});
