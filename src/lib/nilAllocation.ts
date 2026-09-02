// ─────────────────────────────────────────────────────────────────────────────
// NIL Allocation — rank-based decay curve with budget-flex downscaling.
//
// Source of truth: docs/RSTR_IQ_NIL_Allocation_Spec.md §2 (locked + verified
// 2026-08-16). Replaces the old proportional share
// (score / max(Σscore, RAW_WAR_BENCHMARK×tier) × budget), which overshot the top
// because near-zero/negative-WAR players priced ~$0 and dropped out of the
// denominator, letting a star eat too large a share.
//
// The curve distributes a real budget across a roster ranked by player score,
// summing to the budget by construction. Two budget-flexed knobs are baked in so
// the curve does NOT scale linearly with budget:
//   • concentration ramp — the top HOLDS value as the budget shrinks
//   • floor drain        — the guaranteed floor trends to $0 as the budget shrinks
// $5M is the fixed calibration endpoint (alpha clamped ≥ base); every smaller
// budget concentrates from there.
// ─────────────────────────────────────────────────────────────────────────────

export type NilAllocationMode = "balanced" | "top_heavy";

/** Stamped curve constants. The ONLY home for these values — no inline copies. */
export const NIL_CURVE = {
  alphaBase: 1.1, //     concentration exponent at the reference budget (locked elasticity)
  rampK: 0.5, //         concentration ramp strength: alpha rises by rampK per decade of budget drop
  floorFracBase: 0.1, // share of budget spread as a flat floor at the reference budget (balanced)
  refBudget: 5_000_000, // B* — fixed calibration endpoint
  minPayment: 10_000, // below-line cleanup: an allocation under this becomes $0, redistributed up
} as const;

const log10 = (x: number) => Math.log(x) / Math.LN10;

/**
 * Concentration exponent for a budget. Rises as the budget drops (top holds
 * value); clamped at the base so budgets ≥ B* behave as the locked endpoint.
 */
export const nilAlphaForBudget = (budget: number): number => {
  const b = Number(budget) || 0;
  if (b <= 0) return NIL_CURVE.alphaBase;
  return Math.max(NIL_CURVE.alphaBase, NIL_CURVE.alphaBase + NIL_CURVE.rampK * log10(NIL_CURVE.refBudget / b));
};

/**
 * Flat-floor fraction for a budget + mode. Balanced drains the floor linearly as
 * the budget drops (full at B*, → 0 as B → 0). Top-heavy removes the floor
 * entirely at any budget, redistributing it upward.
 */
export const nilFloorFracForBudget = (budget: number, mode: NilAllocationMode): number => {
  if (mode === "top_heavy") return 0;
  const b = Number(budget) || 0;
  return NIL_CURVE.floorFracBase * Math.min(1, Math.max(0, b) / NIL_CURVE.refBudget);
};

type PaidEntry = { s: number; i: number; nil: number };

/**
 * Allocate `budget` across `scores` (index-aligned player scores). Returns an
 * index-aligned array of dollars that sums to `budget`.
 *
 *   floor     = floorFrac(B) × B / n_paid
 *   surplus_i = max(score_i, 0) ^ alpha(B)
 *   rate      = (B − floor × n_paid) / Σ surplus_i
 *   NIL_i     = floor + rate × surplus_i
 *
 * The paid set starts as every positive-score player, then iteratively drops any
 * whose allocation would fall below `minPayment` (redistributing to those above)
 * until all survivors clear the line — this is what makes the floor drain faster
 * at low budgets. A roster with no positive score, or a non-positive budget,
 * allocates nothing.
 */
export function allocateNil(
  scores: number[],
  budget: number,
  mode: NilAllocationMode = "balanced",
): number[] {
  const n = scores.length;
  const out = new Array<number>(n).fill(0);
  const B = Number(budget) || 0;
  if (B <= 0) return out;

  const alpha = nilAlphaForBudget(B);
  const floorFrac = nilFloorFracForBudget(B, mode);

  let paid: PaidEntry[] = scores
    .map((s, i) => ({ s: Math.max(0, Number(s) || 0), i, nil: 0 }))
    .filter((o) => o.s > 0);
  if (paid.length === 0) return out;

  // ≤ n removal rounds; +2 guard for the single-player convergence tail.
  for (let guard = 0; guard < n + 2; guard++) {
    const k = paid.length;
    const floor = (floorFrac * B) / k;
    const surplusSum = paid.reduce((a, o) => a + Math.pow(o.s, alpha), 0);
    const rate = surplusSum > 0 ? (B - floor * k) / surplusSum : 0;
    for (const o of paid) o.nil = floor + rate * Math.pow(o.s, alpha);

    if (k === 1) break; // single survivor takes the whole budget by construction (Σ = B)

    const above = paid.filter((o) => o.nil >= NIL_CURVE.minPayment);
    if (above.length === paid.length) break; // everyone clears the line
    if (above.length === 0) {
      // Budget too small for even the top to clear the line → top scorer takes all.
      paid = [paid.reduce((best, o) => (o.s > best.s ? o : best), paid[0])];
      continue;
    }
    paid = above;
  }

  for (const o of paid) out[o.i] = Math.max(0, o.nil);
  return out;
}
