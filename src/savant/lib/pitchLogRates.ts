import type {
  PitchLogHitterTotalsRow,
  PitchLogPitcherTotalsRow,
} from "@/savant/hooks/usePitchLogTotals";
import type { PitchLogByPitchTypeRow } from "@/savant/hooks/usePitchLogByPitchType";
import type { PitchLogHitterByPitchTypeRow } from "@/savant/hooks/usePitchLogHitterByPitchType";
import type {
  HitterMasterHistoricalRow,
  PitcherMasterHistoricalRow,
} from "@/savant/hooks/usePlayerHistoricalMaster";

export type PitchLogDimensionKey =
  | "all"
  | "vs_lhp"
  | "vs_rhp"
  | "vs_92plus"
  | "vs_fastball"
  | "vs_breaking_ball"
  | "vs_offspeed"
  | "vs_top_hitters"
  | "vs_stuff_100plus"
  | "vs_stuff_105plus";

export interface DimensionOption {
  key: PitchLogDimensionKey;
  label: string;
}

// Pitcher-only dimensions (no vs_92plus — meaningless for pitchers since
// most never throw 92+; we use vs_top_hitters instead to gauge them
// against elite bats).
export const PITCHER_DIMENSIONS: readonly DimensionOption[] = [
  { key: "all", label: "All Pitches" },
  { key: "vs_lhp", label: "vs LHH" },
  { key: "vs_rhp", label: "vs RHH" },
  { key: "vs_fastball", label: "Fastballs" },
  { key: "vs_breaking_ball", label: "Breaking Balls" },
  { key: "vs_offspeed", label: "Offspeed" },
  { key: "vs_top_hitters", label: "vs Top Hitters" },
];

// Hitter-only dimensions (no vs_top_hitters — that's about which hitters
// a pitcher faces; meaningless for the hitter's own row).
export const HITTER_DIMENSIONS: readonly DimensionOption[] = [
  { key: "all", label: "All Pitches" },
  { key: "vs_lhp", label: "vs LHP" },
  { key: "vs_rhp", label: "vs RHP" },
  { key: "vs_92plus", label: "vs 92+ mph" },
  { key: "vs_stuff_100plus", label: "vs Stuff+ 100" },
  { key: "vs_stuff_105plus", label: "vs Stuff+ 105" },
  { key: "vs_fastball", label: "vs Fastballs" },
  { key: "vs_breaking_ball", label: "vs Breaking Balls" },
  { key: "vs_offspeed", label: "vs Offspeed" },
];

export const safeDiv = (n: number | null | undefined, d: number | null | undefined) => {
  const num = n ?? 0;
  const den = d ?? 0;
  return den > 0 ? num / den : null;
};

/**
 * Same as safeDiv but returns null if the denominator is below `floor`.
 * Used to suppress noisy small-sample rates (e.g., Barrel% from 3 tracked
 * batted balls). Without a floor, a hitter with 5 tracked BIP and 1
 * barrel shows up as 20% Barrel and gets ranked against players with
 * 200+ tracked BIP — a misleading p80+ display.
 */
export const safeDivFloor = (
  n: number | null | undefined,
  d: number | null | undefined,
  floor: number,
) => {
  const num = n ?? 0;
  const den = d ?? 0;
  return den >= floor && den > 0 ? num / den : null;
};

/** Minimum total_pitches in a dimension before a pitcher is "qualified" for percentile ranking. */
export const PITCHER_QUALIFIED_PITCHES = 100;

/** Minimum PA in a dimension before a hitter is "qualified" for percentile ranking. */
export const HITTER_QUALIFIED_PA = 30;

/** Min tracked batted balls before Barrel%/HardHit%/EV-derived rates display. */
export const MIN_TRACKED_BIP = 5;
/** Min AB before xStats display. */
export const MIN_AB_FOR_XSTATS = 15;
/** Min swings before plate-discipline rates (Whiff%, Contact%) display. */
export const MIN_SWINGS_FOR_RATES = 15;
/** Min OOZ pitches before Chase% displays. */
export const MIN_OOZ_FOR_CHASE = 20;

export interface PitcherRates {
  // Production-against
  avgAgainst: number | null;
  obpAgainst: number | null;
  slgAgainst: number | null;
  opsAgainst: number | null;
  isoAgainst: number | null;
  babipAgainst: number | null;
  // Plate discipline
  kPct: number | null;
  bbPct: number | null;
  strikePct: number | null;
  zonePct: number | null;
  whiffPct: number | null;
  chasePct: number | null;
  contactPct: number | null;
  izWhiffPct: number | null;
  calledStrikePct: number | null;
  // Stuff+ rolled up
  stuffPlus: number | null;
  // Sample sizes
  totalPitches: number;
  totalDataPitches: number;
  dataReliabilityPct: number | null;
  totalBf: number;
}

export function derivePitcherRates(row: PitchLogPitcherTotalsRow | null): PitcherRates | null {
  if (!row) return null;
  // Pitcher totals don't store hits-against directly — derived from BF - (K + BB + HBP + outs).
  // We DON'T have outs in pitcher_totals, so AVG/OBP/SLG against would need pitch-by-pitch.
  // For v1, leave them null for pitchers (handled on hitter side from the matching at-bat).
  // The plate-discipline + Stuff+ rates ARE all derivable here.
  return {
    avgAgainst: null,
    obpAgainst: null,
    slgAgainst: null,
    opsAgainst: null,
    isoAgainst: null,
    babipAgainst: null,
    kPct: safeDiv(row.total_k, row.total_pa),
    bbPct: safeDiv(row.total_bb, row.total_pa),
    strikePct: safeDiv(row.total_strikes, row.total_pitches),
    // Zone% (tracked-only): definite in-zone / (in-zone + out-of-zone).
// Old denom (total_pitches) included ~17% NULL/untracked pitches as
// "not in zone", crashing league Zone% to 38% vs the real ~50%.
zonePct: safeDiv(row.total_in_zone, row.total_in_zone + row.total_out_of_zone),
    whiffPct: safeDiv(row.total_whiffs, row.total_swings),
    // O-Swing% / Chase%: swings on OOZ pitches / total OOZ pitches.
    // Both restricted to is_in_zone IS FALSE (definite OOZ) via the
    // total_out_of_zone aggregation column. Old denominator used
    // total_swings which gave a different metric.
    chasePct: safeDiv(row.total_chases, row.total_out_of_zone),
    contactPct:
      row.total_swings > 0
        ? (row.total_swings - row.total_whiffs) / row.total_swings
        : null,
    izWhiffPct: safeDiv(row.total_in_zone_whiffs, row.total_in_zone_swings),
    calledStrikePct: safeDiv(row.total_called_strikes, row.total_pitches),
    stuffPlus: safeDiv(row.stuff_plus_sum, row.stuff_plus_data_pitches),
    totalPitches: row.total_pitches,
    totalDataPitches: row.total_data_pitches,
    dataReliabilityPct: safeDiv(row.total_data_pitches, row.total_pitches),
    totalBf: row.total_bf,
  };
}

export interface HitterRates {
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  iso: number | null;
  babip: number | null;
  kPct: number | null;
  bbPct: number | null;
  hrRate: number | null;
  whiffPct: number | null;
  chasePct: number | null;
  contactPct: number | null;
  izWhiffPct: number | null;
  zonePct: number | null;
  groundBallPct: number | null;
  lineDrivePct: number | null;
  flyBallPct: number | null;
  popUpPct: number | null;
  hardHitPct: number | null;
  barrelPct: number | null;
  la1030Pct: number | null;
  avgEv: number | null;
  totalPitches: number;
  pa: number;
  dataReliabilityPct: number | null;
  /** Counts for the panel-level "Batted Ball tracking" reliability badge. */
  bipTotal: number;
  bipTracked: number;
  bipTrackingPct: number | null;
}

export function deriveHitterRates(row: PitchLogHitterTotalsRow | null): HitterRates | null {
  if (!row) return null;
  const hits = row.hits_single + row.hits_double + row.hits_triple + row.hits_hr;
  const tb =
    row.hits_single +
    2 * row.hits_double +
    3 * row.hits_triple +
    4 * row.hits_hr;
  const onBaseNumer = hits + row.bb + row.hbp;
  const onBaseDenom = row.ab + row.bb + row.hbp + row.sac;
  const avg = safeDiv(hits, row.ab);
  const obp = safeDiv(onBaseNumer, onBaseDenom);
  const slg = safeDiv(tb, row.ab);
  const ops = obp !== null && slg !== null ? obp + slg : null;
  const iso = avg !== null && slg !== null ? slg - avg : null;
  // BABIP = (H - HR) / (AB - K - HR + SF). We don't separate SF from SAC
  // in our aggregations — close enough for v1 to use SAC in place of SF.
  const babipNumer = hits - row.hits_hr;
  const babipDenom = row.ab - row.k - row.hits_hr + row.sac;
  return {
    avg,
    obp,
    slg,
    ops,
    iso,
    babip: safeDiv(babipNumer, babipDenom),
    kPct: safeDiv(row.k, row.pa),
    bbPct: safeDiv(row.bb, row.pa),
    hrRate: safeDiv(row.hits_hr, row.pa),
    whiffPct: safeDiv(row.total_whiffs, row.total_swings),
    // O-Swing% / Chase%: swings on OOZ pitches / total OOZ pitches.
    // Both restricted to is_in_zone IS FALSE (definite OOZ) via the
    // total_out_of_zone aggregation column. Old denominator used
    // total_swings which gave a different metric.
    chasePct: safeDiv(row.total_chases, row.total_out_of_zone),
    contactPct:
      row.total_swings > 0
        ? (row.total_swings - row.total_whiffs) / row.total_swings
        : null,
    izWhiffPct: safeDiv(row.total_in_zone_whiffs, row.total_in_zone_swings),
    // Zone% (tracked-only): definite in-zone / (in-zone + out-of-zone).
// Old denom (total_pitches) included ~17% NULL/untracked pitches as
// "not in zone", crashing league Zone% to 38% vs the real ~50%.
zonePct: safeDiv(row.total_in_zone, row.total_in_zone + row.total_out_of_zone),
    // All EV/LA-derived numerators (GB/LD/FB/PU/HH/Barrel/LA10-30/hard
    // hit) have implicit "EV or LA NOT NULL" filters in the aggregation
    // SQL — they only count tracked balls. Denominator must match:
    // batted_balls_with_ev, NOT batted_balls_in_play. Using BIP divides
    // tracked numerators by untracked-inclusive denominators and
    // crashes the rates to ~33-50% of true value for partially-tracked
    // hitters. HM rate columns (from TruMedia CSV) use tracked-only
    // denominators by convention; matching that keeps Overview grades
    // and Stats percentile bars on the same scale.
    groundBallPct: safeDivFloor(row.batted_ground_balls, row.batted_balls_with_ev, MIN_TRACKED_BIP),
    lineDrivePct: safeDivFloor(row.batted_line_drives, row.batted_balls_with_ev, MIN_TRACKED_BIP),
    flyBallPct: safeDivFloor(row.batted_fly_balls, row.batted_balls_with_ev, MIN_TRACKED_BIP),
    popUpPct: safeDivFloor(row.batted_pop_ups, row.batted_balls_with_ev, MIN_TRACKED_BIP),
    hardHitPct: safeDivFloor(row.batted_hard_hit, row.batted_balls_with_ev, MIN_TRACKED_BIP),
    barrelPct: safeDivFloor(row.batted_barrels, row.batted_balls_with_ev, MIN_TRACKED_BIP),
    la1030Pct: safeDivFloor(row.batted_la_10_to_30, row.batted_balls_with_ev, MIN_TRACKED_BIP),
    avgEv: safeDivFloor(row.ev_sum, row.batted_balls_with_ev, MIN_TRACKED_BIP),
    totalPitches: row.total_pitches,
    pa: row.pa,
    dataReliabilityPct: safeDiv(row.total_data_pitches, row.total_pitches),
    bipTotal: row.batted_balls_in_play ?? 0,
    bipTracked: row.batted_balls_with_ev ?? 0,
    bipTrackingPct: safeDiv(row.batted_balls_with_ev, row.batted_balls_in_play),
  };
}

export interface PitchTypeBreakdown {
  pitchType: string;
  pitches: number;
  usagePct: number | null;
  velo: number | null;
  ivb: number | null;
  hb: number | null;
  extension: number | null;
  spin: number | null;
  relHeight: number | null;
  relSide: number | null;
  stuffPlus: number | null;
  whiffPct: number | null;
  chasePct: number | null;
  izWhiffPct: number | null;
  calledStrikePct: number | null;
  /** CSW% = (called strikes + whiffs) / pitches. Coach standard for "missed bats and stolen strikes." */
  cswPct: number | null;
  /** Hard Hit% allowed: (95+ EV balls in play) / balls in play, this pitch type only. */
  hardHitPct: number | null;
  /** Avg EV against (all balls in play with EV tracking). */
  avgEv: number | null;
}

// ───────────────────────────────────────────────────────────────────
// Metric definitions for percentile-bar rendering
// ───────────────────────────────────────────────────────────────────

export interface MetricDef<TRow> {
  /** Label displayed on the percentile bar. */
  label: string;
  /** Compute the rate from one aggregation row. */
  derive: (row: TRow) => number | null;
  /** Lower is better (e.g., BB%, whiff% for hitters, AVG-against for pitchers). */
  invert?: boolean;
  /** Formatter for the raw value display on the right of the bar. */
  format: (v: number) => string;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const slash = (v: number) => v.toFixed(3).replace(/^0+/, "");
const one = (v: number) => v.toFixed(1);
const two = (v: number) => v.toFixed(2);

// Pitcher Batted Ball Metrics — display order locked 2026-06-23.
// xERA (xwOBA on ERA scale) replaces xwOBA in the display (same info, more readable).
// xOPS / xwOBA / WHIP / HR/9 / LD% / FB% computed elsewhere but NOT displayed
// here per coach preference — keep panel focused.
// xERA quantile-mapped lookup.
//
// Built empirically: for every qualified 2026 D1 pitcher (BF >= 30), we
// computed xwOBA-against from pitch_log + paired with actual ERA from
// Pitching Master. Both were rank-sorted; rank i in xwOBA list maps to
// rank i in ERA list. The resulting lookup table maps xwOBA → xERA via
// percentile correspondence.
//
// To derive a pitcher's xERA: find the bracket their xwOBA falls into,
// then linearly interpolate between the two anchor ERA values.
//
// Refresh by running `npm run calibrate-xera-quantile` and replacing the
// array below. Recompute after each season ingest.
const XERA_QUANTILE_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.0667, 0.00],
  [0.1704, 2.00],
  [0.1970, 2.52],
  [0.2191, 2.87],
  [0.2373, 3.16],
  [0.2543, 3.38],
  [0.2714, 3.58],
  [0.2879, 3.78],
  [0.3041, 3.94],
  [0.3164, 4.07],
  [0.3284, 4.22],
  [0.3416, 4.34],
  [0.3503, 4.47],
  [0.3582, 4.61],
  [0.3640, 4.73],
  [0.3696, 4.87],
  [0.3764, 5.00],
  [0.3822, 5.13],
  [0.3866, 5.28],
  [0.3920, 5.40],
  [0.3968, 5.52],
  [0.4014, 5.66],
  [0.4057, 5.79],
  [0.4099, 5.90],
  [0.4139, 6.00],
  [0.4175, 6.19],
  [0.4219, 6.35],
  [0.4258, 6.52],
  [0.4296, 6.69],
  [0.4336, 6.83],
  [0.4376, 7.01],
  [0.4409, 7.23],
  [0.4451, 7.41],
  [0.4491, 7.60],
  [0.4536, 7.80],
  [0.4586, 8.03],
  [0.4635, 8.22],
  [0.4673, 8.49],
  [0.4722, 8.71],
  [0.4768, 9.00],
  [0.4817, 9.39],
  [0.4866, 9.82],
  [0.4929, 10.13],
  [0.5010, 10.73],
  [0.5074, 11.25],
  [0.5163, 11.77],
  [0.5246, 12.71],
  [0.5353, 13.71],
  [0.5539, 15.43],
  [0.5777, 18.90],
  [0.8129, 45.90],
];

function xeraFromXwoba(xwoba: number): number {
  return lookupInterp(XERA_QUANTILE_LOOKUP, xwoba);
}

/** Generic linear-interpolation lookup against a sorted 2-tuple table. */
function lookupInterp(
  table: ReadonlyArray<readonly [number, number]>,
  x: number,
): number {
  if (x <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < table.length - 1; i++) {
    const [x0, y0] = table[i];
    const [x1, y1] = table[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

// ── Quantile-mapped lookups for xBA / xSLG / xwOBA ──────────────────
// Built via scripts/calibrate_xstats_quantile.ts against the qualified
// 2026 D1 population. Refresh after each season-end ingest.

// Refreshed 2026-06-23 after: foul-gate fix, OOZ denominator fix,
// Sac handling fix (xAB = AB + SAC denominator). Re-run
// `npm run calibrate-xstats-quantile` after each season-end ingest.

const HITTER_XBA_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.1018, 0.0750], [0.1687, 0.1583], [0.1869, 0.1772], [0.1961, 0.1914],
  [0.2042, 0.2000], [0.2103, 0.2079], [0.2155, 0.2135], [0.2203, 0.2178],
  [0.2242, 0.2222], [0.2280, 0.2268], [0.2317, 0.2308], [0.2347, 0.2339],
  [0.2373, 0.2381], [0.2408, 0.2414], [0.2435, 0.2446], [0.2460, 0.2478],
  [0.2486, 0.2500], [0.2508, 0.2537], [0.2537, 0.2568], [0.2556, 0.2597],
  [0.2578, 0.2623], [0.2595, 0.2651], [0.2616, 0.2676], [0.2636, 0.2703],
  [0.2657, 0.2727], [0.2683, 0.2754], [0.2702, 0.2785], [0.2726, 0.2810],
  [0.2748, 0.2833], [0.2771, 0.2865], [0.2791, 0.2887], [0.2812, 0.2914],
  [0.2831, 0.2935], [0.2853, 0.2952], [0.2876, 0.2976], [0.2899, 0.3008],
  [0.2918, 0.3034], [0.2945, 0.3065], [0.2974, 0.3099], [0.3005, 0.3133],
  [0.3035, 0.3163], [0.3061, 0.3191], [0.3094, 0.3220], [0.3125, 0.3265],
  [0.3157, 0.3306], [0.3203, 0.3371], [0.3254, 0.3429], [0.3312, 0.3495],
  [0.3393, 0.3581], [0.3524, 0.3729], [0.4145, 0.4485],
];

const HITTER_XSLG_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.1236, 0.0980], [0.2354, 0.2154], [0.2569, 0.2500], [0.2727, 0.2647],
  [0.2846, 0.2771], [0.2937, 0.2892], [0.3019, 0.2991], [0.3090, 0.3071],
  [0.3163, 0.3154], [0.3234, 0.3224], [0.3300, 0.3299], [0.3355, 0.3367],
  [0.3411, 0.3429], [0.3473, 0.3497], [0.3522, 0.3562], [0.3572, 0.3626],
  [0.3630, 0.3689], [0.3686, 0.3756], [0.3728, 0.3805], [0.3777, 0.3860],
  [0.3820, 0.3919], [0.3862, 0.3968], [0.3917, 0.4023], [0.3965, 0.4066],
  [0.4006, 0.4123], [0.4057, 0.4186], [0.4103, 0.4244], [0.4149, 0.4316],
  [0.4196, 0.4366], [0.4249, 0.4422], [0.4300, 0.4471], [0.4351, 0.4525],
  [0.4416, 0.4593], [0.4486, 0.4667], [0.4546, 0.4739], [0.4602, 0.4798],
  [0.4655, 0.4866], [0.4713, 0.4925], [0.4780, 0.5000], [0.4841, 0.5057],
  [0.4932, 0.5152], [0.5018, 0.5263], [0.5110, 0.5357], [0.5218, 0.5469],
  [0.5339, 0.5588], [0.5490, 0.5704], [0.5645, 0.5844], [0.5867, 0.6045],
  [0.6117, 0.6310], [0.6560, 0.6723], [0.9084, 1.1569],
];

const HITTER_XWOBA_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.1466, 0.1291], [0.2386, 0.2289], [0.2580, 0.2482], [0.2705, 0.2605],
  [0.2787, 0.2681], [0.2854, 0.2773], [0.2902, 0.2833], [0.2950, 0.2892],
  [0.3000, 0.2944], [0.3033, 0.2992], [0.3069, 0.3029], [0.3106, 0.3064],
  [0.3137, 0.3102], [0.3175, 0.3137], [0.3208, 0.3169], [0.3239, 0.3203],
  [0.3271, 0.3241], [0.3299, 0.3276], [0.3325, 0.3307], [0.3357, 0.3337],
  [0.3382, 0.3369], [0.3410, 0.3398], [0.3434, 0.3430], [0.3455, 0.3457],
  [0.3480, 0.3479], [0.3502, 0.3509], [0.3528, 0.3537], [0.3553, 0.3564],
  [0.3572, 0.3599], [0.3595, 0.3628], [0.3619, 0.3655], [0.3641, 0.3683],
  [0.3673, 0.3713], [0.3703, 0.3742], [0.3735, 0.3776], [0.3768, 0.3812],
  [0.3795, 0.3842], [0.3826, 0.3877], [0.3861, 0.3914], [0.3890, 0.3953],
  [0.3933, 0.3992], [0.3972, 0.4041], [0.4009, 0.4079], [0.4047, 0.4123],
  [0.4096, 0.4167], [0.4170, 0.4226], [0.4227, 0.4296], [0.4338, 0.4400],
  [0.4469, 0.4527], [0.4640, 0.4719], [0.5881, 0.6706],
];

const PITCHER_XBA_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.1263, 0.1091], [0.1916, 0.1789], [0.2045, 0.1923], [0.2146, 0.2025],
  [0.2209, 0.2090], [0.2258, 0.2158], [0.2305, 0.2213], [0.2351, 0.2261],
  [0.2386, 0.2300], [0.2421, 0.2335], [0.2447, 0.2370], [0.2473, 0.2403],
  [0.2497, 0.2436], [0.2528, 0.2464], [0.2553, 0.2492], [0.2580, 0.2519],
  [0.2605, 0.2551], [0.2631, 0.2578], [0.2649, 0.2601], [0.2667, 0.2624],
  [0.2686, 0.2646], [0.2704, 0.2671], [0.2724, 0.2706], [0.2745, 0.2727],
  [0.2768, 0.2759], [0.2788, 0.2788], [0.2811, 0.2813], [0.2826, 0.2841],
  [0.2846, 0.2866], [0.2862, 0.2886], [0.2880, 0.2913], [0.2900, 0.2937],
  [0.2920, 0.2963], [0.2938, 0.2990], [0.2958, 0.3021], [0.2982, 0.3053],
  [0.3009, 0.3087], [0.3033, 0.3118], [0.3056, 0.3146], [0.3086, 0.3187],
  [0.3116, 0.3226], [0.3148, 0.3258], [0.3179, 0.3303], [0.3212, 0.3354],
  [0.3260, 0.3418], [0.3304, 0.3491], [0.3356, 0.3562], [0.3447, 0.3647],
  [0.3535, 0.3793], [0.3677, 0.4000], [0.5231, 0.5231],
];

const PITCHER_XSLG_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.1537, 0.1455], [0.2859, 0.2540], [0.3061, 0.2857], [0.3193, 0.3032],
  [0.3308, 0.3146], [0.3407, 0.3255], [0.3485, 0.3333], [0.3562, 0.3404],
  [0.3618, 0.3473], [0.3674, 0.3543], [0.3729, 0.3608], [0.3781, 0.3656],
  [0.3825, 0.3714], [0.3873, 0.3774], [0.3915, 0.3811], [0.3953, 0.3860],
  [0.3996, 0.3913], [0.4046, 0.3966], [0.4088, 0.4018], [0.4127, 0.4063],
  [0.4165, 0.4110], [0.4198, 0.4151], [0.4232, 0.4196], [0.4270, 0.4239],
  [0.4299, 0.4276], [0.4339, 0.4323], [0.4371, 0.4366], [0.4404, 0.4417],
  [0.4435, 0.4464], [0.4477, 0.4519], [0.4518, 0.4576], [0.4556, 0.4626],
  [0.4597, 0.4667], [0.4635, 0.4712], [0.4681, 0.4766], [0.4721, 0.4831],
  [0.4762, 0.4896], [0.4821, 0.4944], [0.4884, 0.5000], [0.4929, 0.5094],
  [0.4993, 0.5167], [0.5048, 0.5246], [0.5116, 0.5345], [0.5184, 0.5439],
  [0.5269, 0.5563], [0.5365, 0.5695], [0.5473, 0.5849], [0.5612, 0.6080],
  [0.5839, 0.6341], [0.6168, 0.6818], [0.9106, 0.9333],
];

export const PITCHER_METRICS_SLASH_AGAINST: MetricDef<PitchLogPitcherTotalsRow>[] = [
  {
    label: "xERA",
    derive: (r) => {
      if (r.x_woba_sum_allowed === null) return null;
      const W_BB = 0.696;
      const W_HBP = 0.726;
      const xwobaNum = r.x_woba_sum_allowed + W_BB * r.total_bb + W_HBP * r.total_hbp;
      const xwobaDen = r.total_ab + r.total_bb + r.total_hbp;
      const xwoba = xwobaDen > 0 ? xwobaNum / xwobaDen : null;
      if (xwoba === null) return null;
      return xeraFromXwoba(xwoba);
    },
    invert: true,
    format: two,
  },
  {
    label: "xBA",
    derive: (r) => {
      const raw = safeDivFloor(r.x_hits_sum_allowed, r.total_ab, MIN_AB_FOR_XSTATS);
      return raw === null ? null : lookupInterp(PITCHER_XBA_LOOKUP, raw);
    },
    invert: true,
    format: slash,
  },
  {
    label: "xSLG",
    derive: (r) => {
      const raw = safeDivFloor(r.x_bases_sum_allowed, r.total_ab, MIN_AB_FOR_XSTATS);
      return raw === null ? null : lookupInterp(PITCHER_XSLG_LOOKUP, raw);
    },
    invert: true,
    format: slash,
  },
];

export const PITCHER_METRICS_BATTED_BALL: MetricDef<PitchLogPitcherTotalsRow>[] = [
  { label: "Avg EV", derive: (r) => safeDivFloor(r.ev_sum_allowed, r.batted_balls_allowed_with_ev, MIN_TRACKED_BIP), invert: true, format: one },
  {
    label: "BABIP",
    derive: (r) => {
      const hits = r.hits_single_allowed + r.hits_double_allowed + r.hits_triple_allowed + r.hits_hr_allowed;
      return safeDiv(hits - r.hits_hr_allowed, r.total_ab - r.total_k - r.hits_hr_allowed);
    },
    invert: true,
    format: slash,
  },
  { label: "Hard Hit%", derive: (r) => safeDivFloor(r.batted_hard_hit_allowed, r.batted_balls_allowed_with_ev, MIN_TRACKED_BIP), invert: true, format: pct },
  { label: "Barrel%", derive: (r) => safeDivFloor(r.batted_barrels_allowed, r.batted_balls_allowed_with_ev, MIN_TRACKED_BIP), invert: true, format: pct },
  { label: "GB%", derive: (r) => safeDivFloor(r.batted_ground_balls_allowed, r.batted_balls_allowed_with_ev, MIN_TRACKED_BIP), format: pct },
  { label: "HR%", derive: (r) => safeDiv(r.hits_hr_allowed, r.total_pa), invert: true, format: pct },
];

// Quality of Stuff — how nasty is the arm? K%/BB% moved to top stats line.
// Quality of Stuff — how nasty is the arm? K%/BB% live in the top stats
// line. CSW% = (called strikes + whiffs) / pitches (industry standard).
// FB Velo placeholder pending fb_velo_sum schema addition.
export const PITCHER_METRICS_DISCIPLINE: MetricDef<PitchLogPitcherTotalsRow>[] = [
  {
    label: "Stuff+",
    derive: (r) => safeDiv(r.stuff_plus_sum, r.stuff_plus_data_pitches),
    format: one,
  },
  {
    label: "FB Velo",
    derive: (r) => safeDiv(r.fb_velo_sum, r.fb_velo_pitches),
    format: one,
  },
  { label: "Whiff%", derive: (r) => safeDiv(r.total_whiffs, r.total_swings), format: pct },
  { label: "IZ Whiff%", derive: (r) => safeDiv(r.total_in_zone_whiffs, r.total_in_zone_swings), format: pct },
  { label: "Chase%", derive: (r) => safeDiv(r.total_chases, r.total_out_of_zone), format: pct },
  {
    label: "CSW%",
    derive: (r) => safeDiv(r.total_called_strikes + r.total_whiffs, r.total_pitches),
    format: pct,
  },
  { label: "BB%", derive: (r) => safeDiv(r.total_bb, r.total_pa), invert: true, format: pct },
  { label: "Strike%", derive: (r) => safeDiv(r.total_strikes, r.total_pitches), format: pct },
  { label: "Zone%", derive: (r) => safeDiv(r.total_in_zone, r.total_in_zone + r.total_out_of_zone), format: pct },
];

// Hitter Slash Line — xStats + BABIP only. Raw AVG/OBP/SLG/OPS/ISO live
// in the top stats line so they don't double up here.
export const HITTER_METRICS_SLASH: MetricDef<PitchLogHitterTotalsRow>[] = [
  {
    label: "xBA",
    derive: (r) => {
      // Denominator AB + SAC: Sacs are batted-ball events that COULD
      // have been hits, so they contribute to x_hits_sum on the
      // numerator side. Including them in the denominator keeps xBA
      // bounded by 1.0 (without it, AB=10 + 2 Sac hits-on-contact gives
      // xBA > 1.0). MLB Statcast convention.
      const xAb = r.ab + (r.sac ?? 0);
      const raw = safeDivFloor(r.x_hits_sum, xAb, MIN_AB_FOR_XSTATS);
      return raw === null ? null : lookupInterp(HITTER_XBA_LOOKUP, raw);
    },
    format: slash,
  },
  {
    label: "xSLG",
    derive: (r) => {
      const xAb = r.ab + (r.sac ?? 0);
      const raw = safeDivFloor(r.x_bases_sum, xAb, MIN_AB_FOR_XSTATS);
      return raw === null ? null : lookupInterp(HITTER_XSLG_LOOKUP, raw);
    },
    format: slash,
  },
  {
    label: "xwOBA",
    derive: (r) => {
      if (r.x_woba_sum === null || (r.ab ?? 0) < MIN_AB_FOR_XSTATS) return null;
      const W_BB = 0.696;
      const W_HBP = 0.726;
      const xwobaNum = r.x_woba_sum + W_BB * r.bb + W_HBP * r.hbp;
      const xwobaDen = r.ab + r.bb + r.hbp + r.sac;
      const raw = xwobaDen > 0 ? xwobaNum / xwobaDen : null;
      return raw === null ? null : lookupInterp(HITTER_XWOBA_LOOKUP, raw);
    },
    format: slash,
  },
  {
    label: "BABIP",
    derive: (r) => {
      const h = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
      return safeDiv(h - r.hits_hr, r.ab - r.k - r.hits_hr + r.sac);
    },
    format: slash,
  },
];

export const HITTER_METRICS_DISCIPLINE: MetricDef<PitchLogHitterTotalsRow>[] = [
  {
    label: "Contact%",
    derive: (r) =>
      r.total_swings > 0 ? (r.total_swings - r.total_whiffs) / r.total_swings : null,
    format: pct,
  },
  // O-Swing%: chase swings / out-of-zone pitches. Matches Hitter Master's
  // `chase` definition; was previously (chases / swings) which inflated.
  { label: "Chase%", derive: (r) => safeDiv(r.total_chases, r.total_out_of_zone), invert: true, format: pct },
  { label: "IZ Whiff%", derive: (r) => safeDiv(r.total_in_zone_whiffs, r.total_in_zone_swings), invert: true, format: pct },
  { label: "Zone%", derive: (r) => safeDiv(r.total_in_zone, r.total_in_zone + r.total_out_of_zone), format: pct },
  { label: "K%", derive: (r) => safeDiv(r.k, r.pa), invert: true, format: pct },
  { label: "BB%", derive: (r) => safeDiv(r.bb, r.pa), format: pct },
  { label: "HR%", derive: (r) => safeDiv(r.hits_hr, r.pa), format: pct },
];

// Percentile-bar subset — drops Zone% (more about pitch selection seen
// than hitter skill; doesn't read cleanly on a bar).
export const HITTER_METRICS_DISCIPLINE_BARS: MetricDef<PitchLogHitterTotalsRow>[] = [
  {
    label: "Contact%",
    derive: (r) =>
      r.total_swings > 0 ? (r.total_swings - r.total_whiffs) / r.total_swings : null,
    format: pct,
  },
  { label: "Chase%", derive: (r) => safeDiv(r.total_chases, r.total_out_of_zone), invert: true, format: pct },
  { label: "IZ Whiff%", derive: (r) => safeDiv(r.total_in_zone_whiffs, r.total_in_zone_swings), invert: true, format: pct },
  { label: "K%", derive: (r) => safeDiv(r.k, r.pa), invert: true, format: pct },
  { label: "BB%", derive: (r) => safeDiv(r.bb, r.pa), format: pct },
  { label: "HR%", derive: (r) => safeDiv(r.hits_hr, r.pa), format: pct },
];

// Full batted-ball metric list for the rate table (left column).
// All EV/LA-derived numerators use batted_balls_with_ev as denominator
// (matches HM's tracked-only convention) AND require MIN_TRACKED_BIP
// before they display — below that the rate is too noisy to trust.
export const HITTER_METRICS_CONTACT: MetricDef<PitchLogHitterTotalsRow>[] = [
  { label: "Avg EV", derive: (r) => safeDivFloor(r.ev_sum, r.batted_balls_with_ev, MIN_TRACKED_BIP), format: one },
  { label: "Max EV", derive: (r) => (r.batted_balls_with_ev ?? 0) >= MIN_TRACKED_BIP ? r.max_ev : null, format: one },
  { label: "Hard Hit%", derive: (r) => safeDivFloor(r.batted_hard_hit, r.batted_balls_with_ev, MIN_TRACKED_BIP), format: pct },
  { label: "Barrel%", derive: (r) => safeDivFloor(r.batted_barrels, r.batted_balls_with_ev, MIN_TRACKED_BIP), format: pct },
  { label: "LA 10-30%", derive: (r) => safeDivFloor(r.batted_la_10_to_30, r.batted_balls_with_ev, MIN_TRACKED_BIP), format: pct },
  { label: "GB%", derive: (r) => safeDivFloor(r.batted_ground_balls, r.batted_balls_with_ev, MIN_TRACKED_BIP), invert: true, format: pct },
  { label: "LD%", derive: (r) => safeDivFloor(r.batted_line_drives, r.batted_balls_with_ev, MIN_TRACKED_BIP), format: pct },
  { label: "FB%", derive: (r) => safeDivFloor(r.batted_fly_balls, r.batted_balls_with_ev, MIN_TRACKED_BIP), format: pct },
];

// Percentile-bar subset — drops GB / LD / FB which read better as raw
// values in the table than as bars (no clear "better is higher").
export const HITTER_METRICS_CONTACT_BARS: MetricDef<PitchLogHitterTotalsRow>[] = [
  { label: "Avg EV", derive: (r) => safeDivFloor(r.ev_sum, r.batted_balls_with_ev, MIN_TRACKED_BIP), format: one },
  { label: "Max EV", derive: (r) => (r.batted_balls_with_ev ?? 0) >= MIN_TRACKED_BIP ? r.max_ev : null, format: one },
  { label: "Hard Hit%", derive: (r) => safeDivFloor(r.batted_hard_hit, r.batted_balls_with_ev, MIN_TRACKED_BIP), format: pct },
  { label: "Barrel%", derive: (r) => safeDivFloor(r.batted_barrels, r.batted_balls_with_ev, MIN_TRACKED_BIP), format: pct },
  { label: "LA 10-30%", derive: (r) => safeDivFloor(r.batted_la_10_to_30, r.batted_balls_with_ev, MIN_TRACKED_BIP), format: pct },
];

void two; // (reserved for future metrics that need 2-decimal formatting)

// ───────────────────────────────────────────────────────────────────
// Historical-season mappers (Hitter Master / Pitching Master)
// ───────────────────────────────────────────────────────────────────
// These map a stored Hitter/Pitching Master row → the same metric value
// our pitch_log MetricDef.derive returns. Used for the year-over-year
// rows in the Stats page rate tables (2025/2024/2023/2022 alongside
// 2026 pitch_log row).
//
// A metric label that isn't in the map = no historical data → "—" in
// the table. That's expected for pitch-log-only metrics like
// IZ Whiff% / Zone% on the hitter side, or Strike% / Zone% on the
// pitcher side, which Hitter/Pitching Master don't store.

// Hitter Master / Pitching Master store rates as 0-100 percentages
// (e.g. `75` = 75%), but our pct() formatter expects 0-1 decimals (and
// multiplies by 100 itself). Divide by 100 here to normalize. Non-rate
// fields (Avg EV, Stuff+) pass through unchanged.
const fromPct = (v: number | null) => (v == null ? null : v / 100);

export const HISTORICAL_HITTER_VALUES: Record<
  string,
  (r: HitterMasterHistoricalRow) => number | null
> = {
  "Contact%": (r) => fromPct(r.contact),
  "Chase%": (r) => fromPct(r.chase),
  "K%": (r) => fromPct(r.k_pct),
  "BB%": (r) => fromPct(r.bb),
  "Avg EV": (r) => r.avg_exit_velo,
  "Barrel%": (r) => fromPct(r.barrel),
  "LA 10-30%": (r) => fromPct(r.la_10_30),
  "GB%": (r) => fromPct(r.gb),
  "LD%": (r) => fromPct(r.line_drive),
};

export const HISTORICAL_PITCHER_VALUES: Record<
  string,
  (r: PitcherMasterHistoricalRow) => number | null
> = {
  "BB%": (r) => fromPct(r.bb_pct),
  "Whiff%": (r) => fromPct(r.miss_pct),
  "Chase%": (r) => fromPct(r.chase_pct),
  "IZ Whiff%": (r) => fromPct(r.in_zone_whiff_pct),
  "Stuff+": (r) => r.stuff_plus,
  "Contact% Allowed": (r) =>
    r.miss_pct != null ? 1 - r.miss_pct / 100 : null,
};


// ───────────────────────────────────────────────────────────────────
// Hitter per-pitch-type batting line (Savant "vs FB / vs SL" panel)
// ───────────────────────────────────────────────────────────────────

export interface HitterPitchTypeBreakdown {
  pitchType: string;
  pitches: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
  iso: number | null;
  whiffPct: number | null;
  chasePct: number | null;
  hardHitPct: number | null;
  avgEv: number | null;
}

export function deriveHitterPitchTypeBreakdowns(
  rows: PitchLogHitterByPitchTypeRow[],
): HitterPitchTypeBreakdown[] {
  return rows.map((r) => {
    const hits = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
    const tb = r.hits_single + 2 * r.hits_double + 3 * r.hits_triple + 4 * r.hits_hr;
    const avg = safeDiv(hits, r.ab);
    const obp = safeDiv(hits + r.bb + r.hbp, r.ab + r.bb + r.hbp);
    const slg = safeDiv(tb, r.ab);
    return {
      pitchType: r.pitch_type_reclassified,
      pitches: r.pitches,
      avg,
      obp,
      slg,
      ops: obp !== null && slg !== null ? obp + slg : null,
      iso: avg !== null && slg !== null ? slg - avg : null,
      whiffPct: safeDiv(r.whiffs, r.swings),
      chasePct: safeDiv(r.chases, r.out_of_zone),
      hardHitPct: safeDiv(r.batted_hard_hit, r.batted_balls_with_ev),
      avgEv: safeDiv(r.ev_sum, r.batted_balls_with_ev),
    };
  });
}

export function derivePitchTypeBreakdowns(
  rows: PitchLogByPitchTypeRow[],
): PitchTypeBreakdown[] {
  const totalPitches = rows.reduce((sum, r) => sum + r.pitches, 0);
  return rows.map((r) => ({
    pitchType: r.pitch_type_reclassified,
    pitches: r.pitches,
    usagePct: safeDiv(r.pitches, totalPitches),
    velo: safeDiv(r.velo_sum, r.velo_pitches),
    ivb: safeDiv(r.ivb_sum, r.data_pitches),
    hb: safeDiv(r.hb_sum, r.data_pitches),
    extension: safeDiv(r.extension_sum, r.data_pitches),
    spin: safeDiv(r.spin_sum, r.data_pitches),
    relHeight: safeDiv(r.rel_height_sum, r.data_pitches),
    relSide: safeDiv(r.rel_side_sum, r.data_pitches),
    stuffPlus: safeDiv(r.stuff_plus_sum, r.data_pitches),
    whiffPct: safeDiv(r.whiffs, r.swings),
    chasePct: safeDiv(r.chases, r.out_of_zone),
    izWhiffPct: safeDiv(r.in_zone_whiffs, r.in_zone_swings),
    calledStrikePct: safeDiv(r.called_strikes, r.pitches),
    cswPct: safeDiv(r.called_strikes + r.whiffs, r.pitches),
    hardHitPct: safeDiv(r.batted_hard_hit_allowed, r.batted_balls_allowed_with_ev),
    avgEv: safeDiv(r.ev_sum_allowed, r.batted_balls_allowed_with_ev),
  }));
}
