/**
 * CANONICAL pitcher quality — D1-FIP → projected RA9 → pRV+ index. The ONE source for the app (`src/`).
 *
 * C1 (2026-08-11): replaces the old z-averaged 6-component pRV+ blend (which double-counted K/BB/HR — they
 * live in FIP AND stood alone — and compressed the ace tail via z-averaging). Regression-derived on D1:
 *
 *   projFIP = 3.847 − 0.231·K9 + 0.509·BB9 + 1.486·HR9      (intercept 3.10 + 0.509·lgHBP9 1.467 folded in —
 *                                                            there is no projected HBP9 rate; a projection
 *                                                            regresses HBP to the league mean anyway)
 *   projRA9 = projFIP × E2T(1.137)                          (earned → total; the WAR currency)
 *   pRV+    = 100 + 100·(lgRA9 6.913 − projRA9)/lgRA9       (LINEAR display index — the ratio form blows up
 *                                                            to 290+ in a 6.9-run env; do NOT use it)
 *
 * pWAR is unchanged: it consumes pRV+ via the pwar_* formula (pwar_r_per_9 6.915 ≈ lgRA9 converts the pRV+
 * deviation back to runs, so feeding it a D1-FIP-derived pRV+ yields correct WAR with no double-count).
 *
 * Do NOT re-inline this formula. The Deno edge fn cannot import `src/` — it keeps a LOCAL mirror,
 * grep-linked `// canonical: src/lib/pitcherQuality.ts`. A change here means changing that in lockstep.
 * NOTE: the projected K9/BB9/HR9 RATES (and the per-rate +stats used for display/storage) are produced
 * upstream and are UNCHANGED — this module only assembles them into the quality index.
 */

/** C1 pitcher-FIP coefficients + run-environment constants. Single place the numbers live. */
export const PITCHER_FIP_C1 = {
  intercept: 3.847, // 3.10 + 0.509·lgHBP9(1.467)
  k9: -0.231,
  bb9: 0.509,
  hr9: 1.486,
  e2t: 1.137, // earned → total (RA9)
  lgRA9: 6.913, // D1 total-run environment; pRV+ centering
} as const;

/** Projected D1-FIP (earned-run scale) from projected K9/BB9/HR9. */
export function computeProjFip(k9: number | null, bb9: number | null, hr9: number | null): number | null {
  if (k9 == null || bb9 == null || hr9 == null) return null;
  const C = PITCHER_FIP_C1;
  return C.intercept + C.k9 * k9 + C.bb9 * bb9 + C.hr9 * hr9;
}

/** Projected total-run RA9 = projFIP × E2T. */
export function computeProjRA9(k9: number | null, bb9: number | null, hr9: number | null): number | null {
  const fip = computeProjFip(k9, bb9, hr9);
  return fip == null ? null : fip * PITCHER_FIP_C1.e2t;
}

/** pRV+ index (100 = league average). Linear in run prevention — never blows up. */
export function computePrvPlus(k9: number | null, bb9: number | null, hr9: number | null): number | null {
  const ra9 = computeProjRA9(k9, bb9, hr9);
  if (ra9 == null) return null;
  return 100 + 100 * (PITCHER_FIP_C1.lgRA9 - ra9) / PITCHER_FIP_C1.lgRA9;
}
