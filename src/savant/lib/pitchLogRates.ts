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

/** Minimum total_pitches in a dimension before a pitcher is "qualified" for percentile ranking. */
export const PITCHER_QUALIFIED_PITCHES = 100;

/** Minimum PA in a dimension before a hitter is "qualified" for percentile ranking. */
export const HITTER_QUALIFIED_PA = 30;

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
    zonePct: safeDiv(row.total_in_zone, row.total_pitches),
    whiffPct: safeDiv(row.total_whiffs, row.total_swings),
    chasePct: safeDiv(row.total_chases, row.total_swings),
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
    chasePct: safeDiv(row.total_chases, row.total_swings),
    contactPct:
      row.total_swings > 0
        ? (row.total_swings - row.total_whiffs) / row.total_swings
        : null,
    izWhiffPct: safeDiv(row.total_in_zone_whiffs, row.total_in_zone_swings),
    zonePct: safeDiv(row.total_in_zone, row.total_pitches),
    // All EV/LA-derived numerators (GB/LD/FB/PU/HH/Barrel/LA10-30/hard
    // hit) have implicit "EV or LA NOT NULL" filters in the aggregation
    // SQL — they only count tracked balls. Denominator must match:
    // batted_balls_with_ev, NOT batted_balls_in_play. Using BIP divides
    // tracked numerators by untracked-inclusive denominators and
    // crashes the rates to ~33-50% of true value for partially-tracked
    // hitters. HM rate columns (from TruMedia CSV) use tracked-only
    // denominators by convention; matching that keeps Overview grades
    // and Stats percentile bars on the same scale.
    groundBallPct: safeDiv(row.batted_ground_balls, row.batted_balls_with_ev),
    lineDrivePct: safeDiv(row.batted_line_drives, row.batted_balls_with_ev),
    flyBallPct: safeDiv(row.batted_fly_balls, row.batted_balls_with_ev),
    popUpPct: safeDiv(row.batted_pop_ups, row.batted_balls_with_ev),
    hardHitPct: safeDiv(row.batted_hard_hit, row.batted_balls_with_ev),
    barrelPct: safeDiv(row.batted_barrels, row.batted_balls_with_ev),
    la1030Pct: safeDiv(row.batted_la_10_to_30, row.batted_balls_with_ev),
    avgEv: safeDiv(row.ev_sum, row.batted_balls_with_ev),
    totalPitches: row.total_pitches,
    pa: row.pa,
    dataReliabilityPct: safeDiv(row.total_data_pitches, row.total_pitches),
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

const HITTER_XBA_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.0020, 0.0750], [0.0441, 0.1583], [0.0657, 0.1772], [0.0878, 0.1923],
  [0.1056, 0.2000], [0.1253, 0.2079], [0.1405, 0.2135], [0.1560, 0.2179],
  [0.1742, 0.2222], [0.1910, 0.2268], [0.2068, 0.2308], [0.2218, 0.2339],
  [0.2365, 0.2381], [0.2496, 0.2414], [0.2593, 0.2446], [0.2696, 0.2479],
  [0.2781, 0.2500], [0.2861, 0.2539], [0.2937, 0.2568], [0.3009, 0.2597],
  [0.3070, 0.2623], [0.3130, 0.2651], [0.3183, 0.2678], [0.3238, 0.2704],
  [0.3296, 0.2731], [0.3344, 0.2754], [0.3389, 0.2786], [0.3430, 0.2810],
  [0.3476, 0.2833], [0.3512, 0.2865], [0.3556, 0.2888], [0.3605, 0.2915],
  [0.3642, 0.2935], [0.3687, 0.2953], [0.3729, 0.2977], [0.3789, 0.3009],
  [0.3840, 0.3035], [0.3879, 0.3065], [0.3927, 0.3100], [0.3966, 0.3133],
  [0.4017, 0.3164], [0.4060, 0.3191], [0.4119, 0.3220], [0.4176, 0.3265],
  [0.4249, 0.3306], [0.4330, 0.3371], [0.4429, 0.3429], [0.4523, 0.3495],
  [0.4660, 0.3582], [0.4850, 0.3729], [0.5730, 0.4485],
];

const HITTER_XSLG_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.0026, 0.0980], [0.0582, 0.2154], [0.0863, 0.2500], [0.1206, 0.2649],
  [0.1454, 0.2771], [0.1698, 0.2898], [0.1905, 0.2993], [0.2168, 0.3072],
  [0.2405, 0.3155], [0.2642, 0.3228], [0.2857, 0.3301], [0.3069, 0.3370],
  [0.3286, 0.3431], [0.3451, 0.3500], [0.3600, 0.3563], [0.3735, 0.3627],
  [0.3871, 0.3690], [0.3994, 0.3757], [0.4111, 0.3806], [0.4226, 0.3860],
  [0.4320, 0.3919], [0.4420, 0.3971], [0.4484, 0.4026], [0.4569, 0.4070],
  [0.4656, 0.4123], [0.4734, 0.4188], [0.4823, 0.4246], [0.4906, 0.4318],
  [0.4988, 0.4368], [0.5070, 0.4422], [0.5158, 0.4472], [0.5246, 0.4526],
  [0.5341, 0.4596], [0.5425, 0.4667], [0.5521, 0.4739], [0.5604, 0.4800],
  [0.5706, 0.4867], [0.5812, 0.4925], [0.5926, 0.5000], [0.6012, 0.5058],
  [0.6103, 0.5153], [0.6234, 0.5263], [0.6369, 0.5357], [0.6508, 0.5469],
  [0.6660, 0.5590], [0.6853, 0.5704], [0.7075, 0.5845], [0.7367, 0.6045],
  [0.7678, 0.6311], [0.8241, 0.6723], [1.0967, 1.1569],
];

const HITTER_XWOBA_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.0427, 0.1291], [0.1331, 0.2289], [0.1615, 0.2482], [0.1778, 0.2605],
  [0.1940, 0.2681], [0.2104, 0.2775], [0.2241, 0.2833], [0.2351, 0.2892],
  [0.2487, 0.2944], [0.2648, 0.2993], [0.2789, 0.3031], [0.2908, 0.3066],
  [0.3014, 0.3103], [0.3121, 0.3138], [0.3205, 0.3169], [0.3309, 0.3204],
  [0.3372, 0.3243], [0.3460, 0.3276], [0.3525, 0.3307], [0.3597, 0.3339],
  [0.3661, 0.3371], [0.3708, 0.3400], [0.3762, 0.3431], [0.3816, 0.3459],
  [0.3858, 0.3480], [0.3920, 0.3510], [0.3970, 0.3538], [0.4012, 0.3564],
  [0.4065, 0.3599], [0.4109, 0.3629], [0.4153, 0.3655], [0.4197, 0.3683],
  [0.4246, 0.3714], [0.4289, 0.3742], [0.4335, 0.3777], [0.4381, 0.3812],
  [0.4432, 0.3842], [0.4483, 0.3878], [0.4543, 0.3915], [0.4598, 0.3954],
  [0.4654, 0.3993], [0.4709, 0.4042], [0.4769, 0.4080], [0.4852, 0.4123],
  [0.4914, 0.4168], [0.5017, 0.4226], [0.5142, 0.4298], [0.5265, 0.4400],
  [0.5426, 0.4530], [0.5620, 0.4719], [0.6755, 0.6706],
];

const PITCHER_XBA_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.0031, 0.1091], [0.0553, 0.1789], [0.0872, 0.1923], [0.1080, 0.2022],
  [0.1268, 0.2090], [0.1440, 0.2156], [0.1619, 0.2212], [0.1799, 0.2259],
  [0.1965, 0.2299], [0.2168, 0.2333], [0.2353, 0.2368], [0.2492, 0.2400],
  [0.2626, 0.2436], [0.2727, 0.2464], [0.2828, 0.2492], [0.2906, 0.2519],
  [0.2976, 0.2551], [0.3042, 0.2578], [0.3097, 0.2601], [0.3149, 0.2623],
  [0.3198, 0.2646], [0.3241, 0.2671], [0.3281, 0.2706], [0.3325, 0.2727],
  [0.3362, 0.2760], [0.3404, 0.2788], [0.3446, 0.2813], [0.3488, 0.2842],
  [0.3529, 0.2866], [0.3565, 0.2887], [0.3605, 0.2913], [0.3638, 0.2938],
  [0.3673, 0.2963], [0.3708, 0.2990], [0.3741, 0.3021], [0.3782, 0.3053],
  [0.3830, 0.3088], [0.3876, 0.3120], [0.3920, 0.3146], [0.3959, 0.3187],
  [0.4005, 0.3226], [0.4066, 0.3258], [0.4116, 0.3303], [0.4179, 0.3354],
  [0.4241, 0.3418], [0.4314, 0.3492], [0.4412, 0.3562], [0.4501, 0.3647],
  [0.4612, 0.3793], [0.4823, 0.4000], [0.6103, 0.4918],
];

const PITCHER_XSLG_LOOKUP: ReadonlyArray<readonly [number, number]> = [
  [0.0031, 0.1455], [0.0820, 0.2540], [0.1237, 0.2857], [0.1595, 0.3026],
  [0.1904, 0.3143], [0.2145, 0.3253], [0.2415, 0.3333], [0.2655, 0.3403],
  [0.2918, 0.3469], [0.3173, 0.3540], [0.3429, 0.3605], [0.3620, 0.3656],
  [0.3774, 0.3714], [0.3924, 0.3770], [0.4083, 0.3810], [0.4209, 0.3858],
  [0.4307, 0.3913], [0.4405, 0.3966], [0.4508, 0.4020], [0.4614, 0.4064],
  [0.4688, 0.4112], [0.4766, 0.4153], [0.4833, 0.4200], [0.4896, 0.4240],
  [0.4973, 0.4277], [0.5036, 0.4324], [0.5099, 0.4367], [0.5162, 0.4417],
  [0.5221, 0.4469], [0.5277, 0.4521], [0.5350, 0.4577], [0.5402, 0.4628],
  [0.5475, 0.4667], [0.5528, 0.4714], [0.5579, 0.4770], [0.5651, 0.4833],
  [0.5712, 0.4897], [0.5796, 0.4945], [0.5872, 0.5000], [0.5962, 0.5095],
  [0.6050, 0.5172], [0.6141, 0.5249], [0.6237, 0.5347], [0.6348, 0.5440],
  [0.6483, 0.5567], [0.6608, 0.5699], [0.6745, 0.5851], [0.6911, 0.6080],
  [0.7129, 0.6341], [0.7457, 0.6812], [0.8911, 0.9333],
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
      const raw = safeDiv(r.x_hits_sum_allowed, r.total_ab);
      return raw === null ? null : lookupInterp(PITCHER_XBA_LOOKUP, raw);
    },
    invert: true,
    format: slash,
  },
  {
    label: "xSLG",
    derive: (r) => {
      const raw = safeDiv(r.x_bases_sum_allowed, r.total_ab);
      return raw === null ? null : lookupInterp(PITCHER_XSLG_LOOKUP, raw);
    },
    invert: true,
    format: slash,
  },
];

export const PITCHER_METRICS_BATTED_BALL: MetricDef<PitchLogPitcherTotalsRow>[] = [
  { label: "Avg EV", derive: (r) => safeDiv(r.ev_sum_allowed, r.batted_balls_allowed_with_ev), invert: true, format: one },
  {
    label: "BABIP",
    derive: (r) => {
      const hits = r.hits_single_allowed + r.hits_double_allowed + r.hits_triple_allowed + r.hits_hr_allowed;
      return safeDiv(hits - r.hits_hr_allowed, r.total_ab - r.total_k - r.hits_hr_allowed);
    },
    invert: true,
    format: slash,
  },
  { label: "Hard Hit%", derive: (r) => safeDiv(r.batted_hard_hit_allowed, r.batted_balls_allowed_with_ev), invert: true, format: pct },
  { label: "Barrel%", derive: (r) => safeDiv(r.batted_barrels_allowed, r.batted_balls_allowed_with_ev), invert: true, format: pct },
  { label: "GB%", derive: (r) => safeDiv(r.batted_ground_balls_allowed, r.batted_balls_allowed_with_ev), format: pct },
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
  { label: "Chase%", derive: (r) => safeDiv(r.total_chases, r.total_pitches - r.total_in_zone), format: pct },
  {
    label: "CSW%",
    derive: (r) => safeDiv(r.total_called_strikes + r.total_whiffs, r.total_pitches),
    format: pct,
  },
  { label: "Strike%", derive: (r) => safeDiv(r.total_strikes, r.total_pitches), format: pct },
  { label: "Zone%", derive: (r) => safeDiv(r.total_in_zone, r.total_pitches), format: pct },
];

// Hitter Slash Line — xStats + BABIP only. Raw AVG/OBP/SLG/OPS/ISO live
// in the top stats line so they don't double up here.
export const HITTER_METRICS_SLASH: MetricDef<PitchLogHitterTotalsRow>[] = [
  {
    label: "xBA",
    derive: (r) => {
      const raw = safeDiv(r.x_hits_sum, r.ab);
      return raw === null ? null : lookupInterp(HITTER_XBA_LOOKUP, raw);
    },
    format: slash,
  },
  {
    label: "xSLG",
    derive: (r) => {
      const raw = safeDiv(r.x_bases_sum, r.ab);
      return raw === null ? null : lookupInterp(HITTER_XSLG_LOOKUP, raw);
    },
    format: slash,
  },
  {
    label: "xwOBA",
    derive: (r) => {
      if (r.x_woba_sum === null) return null;
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
  { label: "Chase%", derive: (r) => safeDiv(r.total_chases, r.total_pitches - r.total_in_zone), invert: true, format: pct },
  { label: "IZ Whiff%", derive: (r) => safeDiv(r.total_in_zone_whiffs, r.total_in_zone_swings), invert: true, format: pct },
  { label: "Zone%", derive: (r) => safeDiv(r.total_in_zone, r.total_pitches), format: pct },
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
  { label: "Chase%", derive: (r) => safeDiv(r.total_chases, r.total_pitches - r.total_in_zone), invert: true, format: pct },
  { label: "IZ Whiff%", derive: (r) => safeDiv(r.total_in_zone_whiffs, r.total_in_zone_swings), invert: true, format: pct },
  { label: "K%", derive: (r) => safeDiv(r.k, r.pa), invert: true, format: pct },
  { label: "BB%", derive: (r) => safeDiv(r.bb, r.pa), format: pct },
  { label: "HR%", derive: (r) => safeDiv(r.hits_hr, r.pa), format: pct },
];

// Full batted-ball metric list for the rate table (left column).
// All EV/LA-derived numerators use batted_balls_with_ev as denominator
// (matches HM's tracked-only convention). Using BIP would crash rates
// to 33-50% of true value for partially-tracked hitters.
export const HITTER_METRICS_CONTACT: MetricDef<PitchLogHitterTotalsRow>[] = [
  { label: "Avg EV", derive: (r) => safeDiv(r.ev_sum, r.batted_balls_with_ev), format: one },
  { label: "Max EV", derive: (r) => r.max_ev, format: one },
  { label: "Hard Hit%", derive: (r) => safeDiv(r.batted_hard_hit, r.batted_balls_with_ev), format: pct },
  { label: "Barrel%", derive: (r) => safeDiv(r.batted_barrels, r.batted_balls_with_ev), format: pct },
  { label: "LA 10-30%", derive: (r) => safeDiv(r.batted_la_10_to_30, r.batted_balls_with_ev), format: pct },
  { label: "GB%", derive: (r) => safeDiv(r.batted_ground_balls, r.batted_balls_with_ev), invert: true, format: pct },
  { label: "LD%", derive: (r) => safeDiv(r.batted_line_drives, r.batted_balls_with_ev), format: pct },
  { label: "FB%", derive: (r) => safeDiv(r.batted_fly_balls, r.batted_balls_with_ev), format: pct },
];

// Percentile-bar subset — drops GB / LD / FB which read better as raw
// values in the table than as bars (no clear "better is higher").
export const HITTER_METRICS_CONTACT_BARS: MetricDef<PitchLogHitterTotalsRow>[] = [
  { label: "Avg EV", derive: (r) => safeDiv(r.ev_sum, r.batted_balls_with_ev), format: one },
  { label: "Max EV", derive: (r) => r.max_ev, format: one },
  { label: "Hard Hit%", derive: (r) => safeDiv(r.batted_hard_hit, r.batted_balls_with_ev), format: pct },
  { label: "Barrel%", derive: (r) => safeDiv(r.batted_barrels, r.batted_balls_with_ev), format: pct },
  { label: "LA 10-30%", derive: (r) => safeDiv(r.batted_la_10_to_30, r.batted_balls_with_ev), format: pct },
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
      chasePct: safeDiv(r.chases, r.pitches - r.in_zone),
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
    chasePct: safeDiv(r.chases, r.pitches - r.in_zone),
    izWhiffPct: safeDiv(r.in_zone_whiffs, r.in_zone_swings),
    calledStrikePct: safeDiv(r.called_strikes, r.pitches),
    cswPct: safeDiv(r.called_strikes + r.whiffs, r.pitches),
    hardHitPct: safeDiv(r.batted_hard_hit_allowed, r.batted_balls_allowed_with_ev),
    avgEv: safeDiv(r.ev_sum_allowed, r.batted_balls_allowed_with_ev),
  }));
}
