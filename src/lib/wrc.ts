/**
 * CANONICAL wRC+ — the ONE source of truth for the app (`src/`).
 *
 * C1 (2026-08-10): est_wOBA = 0.011 + 0.691·OBP + 0.235·SLG, ÷ lgwOBA 0.3782 × 100.
 * Regression-derived on D1 (wOBA corr 0.996). AVG/ISO are redundant (ISO=SLG−AVG; power enters via SLG)
 * so their weights are 0. The `intercept` is required so a league-average hitter centers at exactly 100
 * on the true-wOBA denominator (0.3782). Provenance: output/ncaa_league_averages_2026.json.
 *
 * Do NOT re-inline this formula anywhere — import from here. The Deno edge functions cannot import `src/`,
 * so each keeps a LOCAL copy that must mirror these constants; they are grep-linked via
 * `// canonical: src/lib/wrc.ts`. A change here means changing those in lockstep.
 */

export type WrcWeights = { intercept: number; obp: number; slg: number; avg: number; iso: number };

/** The C1 weight set + denominator. Single place the numbers live. */
export const WRC_C1 = { intercept: 0.011, obp: 0.691, slg: 0.235, avg: 0, iso: 0, denom: 0.3782 } as const;

export const DEFAULT_WRC_WEIGHTS: WrcWeights = {
  intercept: WRC_C1.intercept,
  obp: WRC_C1.obp,
  slg: WRC_C1.slg,
  avg: WRC_C1.avg,
  iso: WRC_C1.iso,
};

/** League-average wRC baseline (the wRC+ denominator). */
export const NCAA_WRC_DENOM = WRC_C1.denom;

/** est_wOBA from rates + an explicit (possibly config-overridden) weight set. Intercept-aware. */
export function computeWrcRawFromWeights(
  w: WrcWeights,
  obp: number,
  slg: number,
  avg = 0,
  iso = 0,
): number {
  return (w.intercept ?? 0) + w.obp * obp + w.slg * slg + w.avg * avg + w.iso * iso;
}

/** est_wOBA (the wRC numerator) from a slash line using the canonical C1 weights. */
export function computeWrcRaw(
  avg: number | null,
  obp: number | null,
  slg: number | null,
  iso: number | null,
): number | null {
  // Only OBP + SLG carry weight in C1; AVG/ISO may be null.
  if (obp == null || slg == null) return null;
  return computeWrcRawFromWeights(DEFAULT_WRC_WEIGHTS, obp, slg, avg ?? 0, iso ?? 0);
}

/** wRC+ index (100 = league average) from a slash line. `denom` overridable for conference-specific bases. */
export function computeWrcPlus(
  avg: number | null,
  obp: number | null,
  slg: number | null,
  iso: number | null,
  denom: number = NCAA_WRC_DENOM,
): number | null {
  const raw = computeWrcRaw(avg, obp, slg, iso);
  if (raw == null || !(denom > 0)) return null;
  return Math.round((raw / denom) * 100);
}
