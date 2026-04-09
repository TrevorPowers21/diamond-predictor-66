/**
 * pRV+ for pitchers — composite "wRC+ equivalent" that scores a pitcher
 * relative to NCAA average (100 = average, higher = better).
 *
 * Weighted blend of the per-stat power ratings from Pitching Master:
 *   pRV+ = 0.30*FIP+ + 0.25*ERA+ + 0.15*WHIP+ + 0.15*K9+ + 0.10*BB9+ + 0.05*HR9+
 *
 * Weights mirror the model_config pitcher_value entries. If the user
 * adjusts those, update here too.
 */
export const PRV_WEIGHTS = {
  fip: 0.30,
  era: 0.25,
  whip: 0.15,
  k9: 0.15,
  bb9: 0.10,
  hr9: 0.05,
} as const;

export function computePrvPlus(
  eraPrPlus: number | null,
  fipPrPlus: number | null,
  whipPrPlus: number | null,
  k9PrPlus: number | null,
  bb9PrPlus: number | null,
  hr9PrPlus: number | null,
): number | null {
  // All six components must be present for the full composite.
  // If any are missing, fall back to the average of whatever IS present
  // (renormalizing weights so the value still scales to ~100 = NCAA avg).
  const parts: Array<{ v: number; w: number }> = [];
  if (fipPrPlus != null) parts.push({ v: fipPrPlus, w: PRV_WEIGHTS.fip });
  if (eraPrPlus != null) parts.push({ v: eraPrPlus, w: PRV_WEIGHTS.era });
  if (whipPrPlus != null) parts.push({ v: whipPrPlus, w: PRV_WEIGHTS.whip });
  if (k9PrPlus != null) parts.push({ v: k9PrPlus, w: PRV_WEIGHTS.k9 });
  if (bb9PrPlus != null) parts.push({ v: bb9PrPlus, w: PRV_WEIGHTS.bb9 });
  if (hr9PrPlus != null) parts.push({ v: hr9PrPlus, w: PRV_WEIGHTS.hr9 });
  if (parts.length === 0) return null;
  const sumW = parts.reduce((s, p) => s + p.w, 0);
  if (sumW <= 0) return null;
  const sumWV = parts.reduce((s, p) => s + p.v * p.w, 0);
  return sumWV / sumW;
}
