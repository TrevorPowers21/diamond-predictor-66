/**
 * Percentile math for Savant percentile bars.
 *
 * percentileRank: returns 0-100 where 100 = best in population.
 * Pass `invert: true` for stats where lower is better (e.g. chase%, K%).
 * Nulls in the population are ignored. Returns null if value is null or population is empty.
 */
export function percentileRank(
  value: number | null | undefined,
  population: Array<number | null | undefined>,
  opts: { invert?: boolean } = {},
): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const clean = population.filter((v): v is number => v != null && !Number.isNaN(v));
  if (clean.length === 0) return null;
  const belowOrEqual = clean.filter((v) => (opts.invert ? v >= value : v <= value)).length;
  return Math.round((belowOrEqual / clean.length) * 100);
}

/**
 * Map a 0-100 percentile to a color.
 *
 * Convention: red = above average (elite), blue = below average. Saturation
 * scales with distance from 50 — at 50 the color washes out toward neutral,
 * at 0 or 100 it's fully saturated. Above 50 = redder as pct rises; below 50
 * = darker blue as pct drops.
 */
export function percentileColor(pct: number): string {
  const distance = Math.abs(pct - 50) / 50; // 0 at avg, 1 at extremes
  const alpha = Math.max(0.18, distance);
  if (pct >= 50) {
    return `rgba(200, 52, 30, ${alpha.toFixed(2)})`; // red = above average
  }
  return `rgba(30, 79, 216, ${alpha.toFixed(2)})`; // blue = below average
}

/**
 * Solid (fully opaque) color for the percentile marker circle. Used for the
 * end-cap so the percentile number inside stays readable even at mid-range
 * percentiles where the bar fill is faded.
 */
export function percentileMarkerColor(pct: number): string {
  return pct >= 50 ? "rgb(200, 52, 30)" : "rgb(30, 79, 216)";
}
