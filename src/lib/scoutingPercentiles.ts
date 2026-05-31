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
  // pull_air — modern power valuation translator. % of contact pulled in the
  // air (LA + pull side). Above-avg raw tools + plus pull_air = above-avg
  // production. Drives the Bregman archetype detection.
  pull_air:      { metric: "pull_air",      direction: "higherBetter", n: 3359, p10: 2.4,  p25: 5.1,  p50: 8.4,   p75: 11.9,  p90: 15.0,  p95: 16.9   },
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

// ── Per-pitch-shape distributions (D1 2026, ≥20 pitches thrown) ──────────
//
// Empirical thresholds per pitch type + handedness. Data-driven tier
// classification — tierFor + the shared MetricDistribution shape map raw
// values to elite/plus/aboveAvg/average/belowAvg/poor/bottom labels.
//
// Captured 2026-05-27 from pitcher_stuff_plus_inputs (Trevor confirmed
// "trust the data, go pitch by pitch"). Recompute annually at season lock.
//
// Stuff+ tiers retained for completeness but classifier tagging noise
// means individual breaking-ball Stuff+ is less reliable than the OVERALL
// pitcher Stuff+ in PITCHER_PERCENTILES — use these for context, not as
// the sole signal for "elite slider" calls.
//
// Splitter LHP (n=19) too small to tier separately — uses RHP percentiles.

export type PitchHand = "R" | "L";
export type PitchType =
  | "Slider" | "Sweeper" | "Curveball" | "Gyro Slider"
  | "Cutter" | "Change-up" | "Splitter";

export interface PitchShapeDistribution {
  velocity: MetricDistribution;
  whiff_pct: MetricDistribution;
  stuff_plus: MetricDistribution;
  /** Shape descriptors — used to classify pitch SHAPE, not quality. */
  shape: {
    ivb_p10: number;
    ivb_p50: number;
    ivb_p90: number;
    hb_abs_p50: number;
    hb_abs_p90: number;
  };
  n: number;
}

const makeDist = (
  metric: string,
  direction: Direction,
  n: number,
  p10: number, p25: number, p50: number, p75: number, p90: number, p95: number,
): MetricDistribution => ({ metric, direction, n, p10, p25, p50, p75, p90, p95 });

export const PITCH_SHAPE_PERCENTILES: Record<PitchType, Partial<Record<PitchHand, PitchShapeDistribution>>> = {
  "Slider": {
    R: {
      n: 1354,
      velocity:   makeDist("velocity",   "higherBetter", 1354, 75.3, 77.1, 79.0, 81.0, 82.7, 83.5),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 1354, 14.3, 21.2, 28.7, 37.5, 46.2, 52.4),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 1354, 89,   94,   99,   105,  111,  116),
      shape: { ivb_p10: -7.0, ivb_p50: -3.9, ivb_p90: 1.6, hb_abs_p50: 8.5, hb_abs_p90: 13.0 },
    },
    L: {
      n: 434,
      velocity:   makeDist("velocity",   "higherBetter", 434, 73.1, 75.0, 77.1, 79.2, 80.5, 81.3),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 434, 13.5, 21.4, 30.0, 39.0, 49.6, 55.8),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 434, 87,   94,   99,   106,  112,  117),
      shape: { ivb_p10: -6.8, ivb_p50: -4.1, ivb_p90: 1.1, hb_abs_p50: 8.7, hb_abs_p90: 12.9 },
    },
  },
  "Sweeper": {
    R: {
      n: 481,
      velocity:   makeDist("velocity",   "higherBetter", 481, 75.2, 76.9, 78.7, 80.7, 82.2, 83.3),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 481, 15.4, 22.6, 30.8, 38.6, 47.0, 51.2),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 481, 88,   93,   100,  108,  115,  118),
      shape: { ivb_p10: -3.2, ivb_p50: -0.7, ivb_p90: 1.9, hb_abs_p50: 13.7, hb_abs_p90: 16.9 },
    },
    L: {
      n: 141,
      velocity:   makeDist("velocity",   "higherBetter", 141, 73.9, 75.4, 77.3, 78.9, 80.5, 81.2),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 141, 17.6, 25.2, 33.3, 42.5, 53.6, 59.6),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 141, 89,   93,   99,   106,  114,  119),
      shape: { ivb_p10: -3.5, ivb_p50: -1.1, ivb_p90: 1.6, hb_abs_p50: 13.3, hb_abs_p90: 16.8 },
    },
  },
  "Curveball": {
    R: {
      n: 875,
      velocity:   makeDist("velocity",   "higherBetter", 875, 73.6, 75.4, 77.2, 79.0, 80.5, 81.7),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 875, 14.3, 23.1, 30.3, 39.7, 50.0, 54.5),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 875, 91,   95,   100,  105,  111,  115),
      shape: { ivb_p10: -15.0, ivb_p50: -10.9, ivb_p90: -8.5, hb_abs_p50: 10.0, hb_abs_p90: 14.7 },
    },
    L: {
      n: 229,
      velocity:   makeDist("velocity",   "higherBetter", 229, 71.9, 73.6, 75.6, 77.2, 79.0, 80.3),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 229, 14.3, 20.9, 30.4, 40.9, 50.0, 54.1),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 229, 90,   94,   101,  106,  111,  115),
      shape: { ivb_p10: -15.3, ivb_p50: -11.3, ivb_p90: -8.4, hb_abs_p50: 10.1, hb_abs_p90: 15.2 },
    },
  },
  "Gyro Slider": {
    R: {
      n: 1758,
      velocity:   makeDist("velocity",   "higherBetter", 1758, 76.7, 78.7, 81.0, 83.1, 84.8, 86.1),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 1758, 12.5, 20.5, 28.6, 37.8, 46.7, 52.2),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 1758, 92,   95,   100,  104,  109,  111),
      shape: { ivb_p10: -1.8, ivb_p50: 1.0, ivb_p90: 3.7, hb_abs_p50: 3.9, hb_abs_p90: 6.3 },
    },
    L: {
      n: 567,
      velocity:   makeDist("velocity",   "higherBetter", 567, 74.8, 77.0, 78.9, 80.9, 82.8, 84.3),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 567, 15.8, 22.2, 30.4, 39.0, 50.0, 55.0),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 567, 93,   96,   99,   104,  108,  111),
      shape: { ivb_p10: -2.0, ivb_p50: 0.9, ivb_p90: 2.9, hb_abs_p50: 3.6, hb_abs_p90: 6.3 },
    },
  },
  "Cutter": {
    R: {
      n: 1372,
      velocity:   makeDist("velocity",   "higherBetter", 1372, 78.0, 80.5, 83.3, 85.6, 87.3, 88.4),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 1372, 13.4, 20.0, 26.2, 33.3, 41.2, 49.2),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 1372, 93,   96,   101,  105,  109,  111),
      shape: { ivb_p10: 3.6, ivb_p50: 6.2, ivb_p90: 9.8, hb_abs_p50: 2.6, hb_abs_p90: 9.9 },
    },
    L: {
      n: 340,
      velocity:   makeDist("velocity",   "higherBetter", 340, 75.5, 77.9, 80.9, 83.7, 85.6, 86.7),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 340, 12.5, 18.9, 25.9, 33.3, 40.0, 44.4),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 340, 92,   96,   101,  105,  109,  111),
      shape: { ivb_p10: 3.5, ivb_p50: 5.6, ivb_p90: 8.8, hb_abs_p50: 2.8, hb_abs_p90: 10.0 },
    },
  },
  "Change-up": {
    R: {
      n: 2055,
      velocity:   makeDist("velocity",   "higherBetter", 2055, 78.6, 80.2, 82.1, 83.9, 85.3, 86.3),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 2055, 14.3, 21.9, 31.3, 40.3, 50.0, 55.6),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 2055, 91,   96,   102,  107,  112,  115),
      shape: { ivb_p10: 1.5, ivb_p50: 6.4, ivb_p90: 11.1, hb_abs_p50: 13.4, hb_abs_p90: 17.3 },
    },
    L: {
      n: 772,
      velocity:   makeDist("velocity",   "higherBetter", 772, 76.9, 78.8, 80.6, 82.4, 83.9, 84.8),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 772, 15.4, 22.6, 31.0, 40.0, 49.9, 54.2),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 772, 90,   96,   101,  108,  112,  115),
      shape: { ivb_p10: 2.3, ivb_p50: 7.2, ivb_p90: 11.7, hb_abs_p50: 13.2, hb_abs_p90: 17.0 },
    },
  },
  "Splitter": {
    // RHP only — LHP n=19 too small. LHP lookups fall back to R.
    R: {
      n: 159,
      velocity:   makeDist("velocity",   "higherBetter", 159, 78.0, 79.5, 81.4, 83.3, 84.4, 85.7),
      whiff_pct:  makeDist("whiff_pct",  "higherBetter", 159, 16.7, 25.7, 36.4, 47.3, 54.6, 62.5),
      stuff_plus: makeDist("stuff_plus", "higherBetter", 159, 91,   97,   101,  106,  110,  113),
      shape: { ivb_p10: 0.1, ivb_p50: 5.1, ivb_p90: 9.3, hb_abs_p50: 9.0, hb_abs_p90: 13.7 },
    },
  },
};

/**
 * Tier a per-pitch metric value (velocity, whiff_pct, stuff_plus) against
 * its empirical per-pitch+hand D1 2026 distribution. Falls back to RHP when
 * LHP is unavailable (currently only Splitter L).
 */
export function pitchShapeTier(
  pitchType: PitchType,
  hand: PitchHand,
  metric: "velocity" | "whiff_pct" | "stuff_plus",
  value: number | null | undefined,
): Tier | null {
  const pitch = PITCH_SHAPE_PERCENTILES[pitchType];
  if (!pitch) return null;
  const handDists = pitch[hand] ?? pitch.R ?? pitch.L;
  if (!handDists) return null;
  return tierFor(value, handDists[metric]);
}

/**
 * Get the raw shape descriptors for a pitch+hand. Used by pitch classifier
 * (e.g., "is this a sweeper or a slider?") and by the report generator to
 * describe pitch profile in scout-friendly language.
 */
export function pitchShapeFor(pitchType: PitchType, hand: PitchHand) {
  const pitch = PITCH_SHAPE_PERCENTILES[pitchType];
  if (!pitch) return null;
  return pitch[hand] ?? pitch.R ?? pitch.L ?? null;
}
