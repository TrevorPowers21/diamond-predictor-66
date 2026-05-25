/**
 * Empirical scouting metric percentiles — D1 2026, qualified-only cohort.
 *
 * Replaces hand-set thresholds in scoutingReportGenerator + playerRisk.
 * Source: actual NCAA D1 distribution computed from Hitter Master + Pitching
 * Master (Season=2026, PA≥75 hitter / IP≥20 pitcher). Captured 2026-05-25.
 *
 * Direction matters: for higherBetter metrics, P90 = elite; for lowerBetter,
 * P10 = elite. Use `tierFor(value, dist)` helper to map a raw value to a tier
 * label that respects direction.
 *
 * Recompute annually at season lock to keep thresholds calibrated to real
 * NCAA distribution drift.
 */
export type Direction = "higherBetter" | "lowerBetter";

export interface MetricDistribution {
  metric: string;
  direction: Direction;
  n: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

// ── Hitter scouting metrics (D1 2026, PA ≥ 75, n ≈ 3,359) ────────────────
export const HITTER_PERCENTILES: Record<string, MetricDistribution> = {
  contact:       { metric: "contact",       direction: "higherBetter", n: 3359, p10: 67.5, p25: 72.3, p50: 77.3,  p75: 82.0,  p90: 85.8,  p95: 87.7   },
  chase:         { metric: "chase",         direction: "lowerBetter",  n: 3359, p10: 16.5, p25: 19.3, p50: 23.0,  p75: 27.0,  p90: 31.0,  p95: 33.51  },
  avg_exit_velo: { metric: "avg_exit_velo", direction: "higherBetter", n: 3356, p10: 80.0, p25: 83.1, p50: 86.0,  p75: 88.8,  p90: 90.9,  p95: 92.325 },
  ev90:          { metric: "ev90",          direction: "higherBetter", n: 3356, p10: 96.6, p25: 99.0, p50: 101.6, p75: 104.0, p90: 106.1, p95: 107.5  },
  barrel:        { metric: "barrel",        direction: "higherBetter", n: 3356, p10: 6.6,  p25: 11.5, p50: 16.8,  p75: 21.9,  p90: 26.5,  p95: 28.9   },
  line_drive:    { metric: "line_drive",    direction: "higherBetter", n: 3359, p10: 16.1, p25: 18.9, p50: 21.8,  p75: 25.0,  p90: 27.8,  p95: 29.4   },
  gb:            { metric: "gb",            direction: "lowerBetter",  n: 3359, p10: 31.4, p25: 36.2, p50: 41.9,  p75: 47.8,  p90: 53.4,  p95: 57.0   },
  pull:          { metric: "pull",          direction: "higherBetter", n: 3359, p10: 27.3, p25: 31.9, p50: 37.1,  p75: 42.3,  p90: 47.3,  p95: 50.5   },
  la_10_30:      { metric: "la_10_30",      direction: "higherBetter", n: 3356, p10: 21.1, p25: 24.7, p50: 28.8,  p75: 32.8,  p90: 36.6,  p95: 38.9   },
  pop_up:        { metric: "pop_up",        direction: "lowerBetter",  n: 3359, p10: 3.5,  p25: 5.35, p50: 7.8,   p75: 10.4,  p90: 13.0,  p95: 14.5   },
  bb:            { metric: "bb",            direction: "higherBetter", n: 3359, p10: 6.4,  p25: 8.5,  p50: 10.8,  p75: 13.5,  p90: 16.1,  p95: 17.9   },
};

// ── Pitcher scouting metrics (D1 2026, IP ≥ 20, n ≈ 2,772) ───────────────
export const PITCHER_PERCENTILES: Record<string, MetricDistribution> = {
  stuff_plus:        { metric: "stuff_plus",        direction: "higherBetter", n: 2752, p10: 94.07, p25: 97.51, p50: 101.36, p75: 105.42, p90: 109.32, p95: 111.42 },
  miss_pct:          { metric: "miss_pct",          direction: "higherBetter", n: 2772, p10: 16.7,  p25: 19.5,  p50: 22.9,   p75: 26.8,   p90: 31.1,   p95: 33.6   },
  in_zone_whiff_pct: { metric: "in_zone_whiff_pct", direction: "higherBetter", n: 2772, p10: 10.9,  p25: 13.3,  p50: 16.1,   p75: 19.2,   p90: 22.6,   p95: 24.9   },
  chase_pct:         { metric: "chase_pct",         direction: "higherBetter", n: 2772, p10: 17.9,  p25: 20.78, p50: 23.7,   p75: 26.6,   p90: 29.1,   p95: 30.5   },
  bb_pct:            { metric: "bb_pct",            direction: "lowerBetter",  n: 2772, p10: 6.0,   p25: 8.0,   p50: 10.2,   p75: 12.8,   p90: 15.5,   p95: 17.245 },
  hard_hit_pct:      { metric: "hard_hit_pct",      direction: "lowerBetter",  n: 2751, p10: 26.0,  p25: 30.0,  p50: 35.0,   p75: 40.0,   p90: 44.0,   p95: 47.0   },
  barrel_pct:        { metric: "barrel_pct",        direction: "lowerBetter",  n: 2751, p10: 10.9,  p25: 14.0,  p50: 17.0,   p75: 20.0,   p90: 23.2,   p95: 25.55  },
  exit_vel:          { metric: "exit_vel",          direction: "lowerBetter",  n: 2751, p10: 82.7,  p25: 84.6,  p50: 86.3,   p75: 87.9,   p90: 89.2,   p95: 90.1   },
  ground_pct:        { metric: "ground_pct",        direction: "higherBetter", n: 2772, p10: 32.7,  p25: 37.0,  p50: 41.9,   p75: 47.2,   p90: 52.09,  p95: 55.3   },
  line_pct:          { metric: "line_pct",          direction: "lowerBetter",  n: 2772, p10: 16.4,  p25: 19.0,  p50: 21.8,   p75: 24.5,   p90: 27.1,   p95: 28.7   },
  h_pull_pct:        { metric: "h_pull_pct",        direction: "lowerBetter",  n: 2772, p10: 29.3,  p25: 32.6,  p50: 36.7,   p75: 40.9,   p90: 44.7,   p95: 47.0   },
  la_10_30_pct:      { metric: "la_10_30_pct",      direction: "lowerBetter",  n: 2772, p10: 21.8,  p25: 25.3,  p50: 28.8,   p75: 32.35,  p90: 36.0,   p95: 38.1   },
};

// ── Tier mapping ─────────────────────────────────────────────────────────
export type Tier =
  | "elite"      // P95+ (or P5- for lowerBetter)
  | "plus"       // P75-P95 (or P5-P25 for lowerBetter)
  | "aboveAvg"   // P60-P75 (or P25-P40)
  | "average"    // P40-P60
  | "belowAvg"   // P25-P40 (or P60-P75)
  | "poor"       // P10-P25 (or P75-P90)
  | "bottom";    // P10- (or P90+)

/**
 * Map a raw value to a tier label, respecting metric direction.
 * Returns null when value is missing.
 */
export function tierFor(value: number | null | undefined, dist: MetricDistribution): Tier | null {
  if (value == null || !Number.isFinite(value)) return null;
  const v = Number(value);
  if (dist.direction === "higherBetter") {
    if (v >= dist.p95) return "elite";
    if (v >= dist.p75) return "plus";
    if (v >= dist.p50 + (dist.p75 - dist.p50) * 0.4) return "aboveAvg";
    if (v >= dist.p25 + (dist.p50 - dist.p25) * 0.6) return "average";
    if (v >= dist.p25) return "belowAvg";
    if (v >= dist.p10) return "poor";
    return "bottom";
  }
  // lowerBetter — invert
  if (v <= dist.p10) return "elite";
  if (v <= dist.p25) return "plus";
  if (v <= dist.p50 - (dist.p50 - dist.p25) * 0.4) return "aboveAvg";
  if (v <= dist.p75 - (dist.p75 - dist.p50) * 0.6) return "average";
  if (v <= dist.p75) return "belowAvg";
  if (v <= dist.p90) return "poor";
  return "bottom";
}

/**
 * Estimate an approximate percentile rank (0-100) for a value within a
 * distribution. Uses linear interpolation between captured P10/P25/P50/P75/P90/P95
 * anchors. Useful when the player record doesn't have a pre-computed percentile.
 *
 * For lowerBetter metrics, returns an inverted percentile so 100 = best.
 */
export function approxPercentile(value: number | null | undefined, dist: MetricDistribution): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const v = Number(value);
  const anchors: [number, number][] = dist.direction === "higherBetter"
    ? [[0, 0], [10, dist.p10], [25, dist.p25], [50, dist.p50], [75, dist.p75], [90, dist.p90], [95, dist.p95], [100, dist.p95 * 1.1]]
    : [[100, 0], [90, dist.p10], [75, dist.p25], [50, dist.p50], [25, dist.p75], [10, dist.p90], [5, dist.p95], [0, dist.p95 * 1.1]];

  const sorted = [...anchors].sort((a, b) => a[1] - b[1]);
  for (let i = 0; i < sorted.length - 1; i++) {
    const [lo_pct, lo_v] = sorted[i];
    const [hi_pct, hi_v] = sorted[i + 1];
    if (v >= lo_v && v <= hi_v) {
      const frac = hi_v === lo_v ? 0 : (v - lo_v) / (hi_v - lo_v);
      return Math.round(lo_pct + frac * (hi_pct - lo_pct));
    }
  }
  return v < sorted[0][1] ? sorted[0][0] : sorted[sorted.length - 1][0];
}

/**
 * Convenience: get tier from raw value when caller has a metric name string.
 * Returns null if metric isn't in the distribution table.
 */
export function hitterTier(metric: string, value: number | null | undefined): Tier | null {
  const dist = HITTER_PERCENTILES[metric];
  return dist ? tierFor(value, dist) : null;
}

export function pitcherTier(metric: string, value: number | null | undefined): Tier | null {
  const dist = PITCHER_PERCENTILES[metric];
  return dist ? tierFor(value, dist) : null;
}
