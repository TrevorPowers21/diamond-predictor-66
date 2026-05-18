/**
 * JUCO regional Stuff+ baseline overlay.
 *
 * Each NJCAA D1 region has a "baseline" Stuff+ value used when projecting
 * JUCO transfers to D1. Baselines are validated against TWO signals:
 *
 *   1. NJCAA top-20 poll strength (2021-2025) — TEAM success signal
 *   2. MLB Draft outcomes (2021-2025) — INDIVIDUAL pro prospect signal
 *
 * Where the two signals agree, computed mean is trusted. Where they
 * disagree, we use draft data as the tiebreaker for projection purposes
 * since draft picks reflect actual pro evaluation of player quality (the
 * thing we're trying to project), not just team wins.
 *
 * Baseline sources:
 *
 *   COMPUTED — region has sufficient TrackMan data + draft validation;
 *     use the computed regional mean as-is.
 *
 *   OVERLAY UP — region has thin/no Stuff+ data but real draft history;
 *     bias baseline upward. Example: R1 Arizona has 0 scored pitchers but
 *     9 draft picks 2021-2025 — proven pro talent we can't measure.
 *
 *   OVERLAY DOWN — region has computed mean but no draft validation;
 *     single TM-equipped program inflating. Less aggressive than first
 *     pass — draft outcomes refuted several initial WEAK-tier overlays.
 *
 *   WEAK_DEFAULT — real D1 region but no draft picks + no TM data; use
 *     conservative baseline.
 *
 * Source data: reference_juco_regional_strength_2021_2025.md (polls)
 *              reference_njcaa_d1_top25_polls_raw.md (raw poll data)
 *              5-yr MLB Draft NJCAA D1 picks (computed 2026-05-17)
 *
 * Baselines refined 2026-05-17 after MLB Draft cross-validation.
 * Refresh annually with new poll + draft data.
 */

export type JucoRegion =
  | 1 | 2 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 14 | 16 | 17 | 18 | 20 | 22 | 23 | 24;

export type BaselineSource = "computed" | "overlay_up" | "overlay_down" | "weak_default";

export interface RegionalBaseline {
  region: JucoRegion;
  district: string;
  geography: string;          // descriptive area + known park/weather effect
  histScore5yr: number;       // 5-year top-20 strength sum (2021-2025)
  tier: "ELITE" | "STRONG" | "MID" | "WEAK" | "NO_SIGNAL";
  stuffPlusN: number | null;  // pitchers with computed stuff_plus (post-fix snapshot 2026-05-16)
  stuffPlusMean: number | null; // computed regional Stuff+ mean
  baseline: number;           // value to use for transfer projection
  d1Comp: string;             // closest D1 conference FR/SO Stuff+ equivalent
  source: BaselineSource;
  notes: string;
}

export const REGIONAL_BASELINE_OVERLAY: Record<JucoRegion, RegionalBaseline> = {
  // ── ELITE — high polls AND high draft production ──────────────────────
  8:  { region: 8,  district: "South Atlantic", geography: "Florida — humid coastal, big parks, suppresses offense slightly", histScore5yr: 138, tier: "ELITE",  stuffPlusN: 65,  stuffPlusMean: 100.69, baseline: 100.69, d1Comp: "Mountain West (~100.08 FR/SO)", source: "computed", notes: "Chipola, Gulf Coast, Indian River, Northwest FL, FL Southwestern, Miami Dade — 49 draftees 2021-2025 (the absolute draft factory)" },
  5:  { region: 5,  district: "Southwest",      geography: "West Texas + New Mexico — altitude (Midland ~2800ft), hot/dry, inflates offense", histScore5yr: 113, tier: "ELITE",  stuffPlusN: 148, stuffPlusMean: 98.09,  baseline: 98.09,  d1Comp: "MAAC (~99.12 FR/SO)", source: "computed", notes: "Midland, McLennan, Weatherford, Odessa, Grayson, NMJC — 15 draftees 2021-2025, trending up" },
  6:  { region: 6,  district: "Plains",         geography: "Kansas/Nebraska — plains wind + summer heat, inflates offense", histScore5yr: 133, tier: "ELITE",  stuffPlusN: 119, stuffPlusMean: 96.83,  baseline: 96.83,  d1Comp: "Horizon (~96.69 FR/SO)", source: "computed", notes: "Johnson Co, Cloud Co, Cowley County — 7 draftees 2021-2025. Polls love them more than draft does but math matches" },

  // ── STRONG — solid all-around signal ──────────────────────────────────
  14: { region: 14, district: "Mid-South",      geography: "East/Central Texas — Houston/Brenham humidity, dead air, suppresses offense", histScore5yr: 79,  tier: "STRONG", stuffPlusN: 150, stuffPlusMean: 97.89,  baseline: 97.89,  d1Comp: "Horizon (~96.69 FR/SO)", source: "computed", notes: "Blinn, Navarro, San Jacinto, Tyler JC — 11 draftees 2021-2025" },
  1:  { region: 1,  district: "West",           geography: "Arizona + S. Nevada — desert dry air, neutral parks despite altitude", histScore5yr: 87,  tier: "STRONG", stuffPlusN: 0,   stuffPlusMean: null,   baseline: 98.0,   d1Comp: "Big South / A-10 (~99.4-99.8 FR/SO)", source: "overlay_up", notes: "Arizona JUCOs (Yavapai, Pima, Central AZ, Cochise, Southern Nevada). 9 draftees 2021-2025 validates STRONG tier despite zero TrackMan visibility. TruMedia exposes velo only for this region. Pull UP to ~98." },
  24: { region: 24, district: "Midwest",        geography: "Illinois — Midwest neutral parks/weather", histScore5yr: 76,  tier: "STRONG", stuffPlusN: 69,  stuffPlusMean: 96.14,  baseline: 96.14,  d1Comp: "Horizon (~96.69 FR/SO)", source: "computed", notes: "Wabash Valley, John A. Logan, Southwestern Illinois — 3 draftees 2021-2025" },
  7:  { region: 7,  district: "Appalachian",    geography: "Tennessee + NC mountains — slight hitter lean", histScore5yr: 97,  tier: "STRONG", stuffPlusN: 54,  stuffPlusMean: 95.54,  baseline: 95.54,  d1Comp: "Horizon (~96.69 FR/SO)", source: "computed", notes: "Walters State the perennial — 5 draftees 2021-2025" },

  // ── MID/MIXED — computed means, varied tier mapping ─────────────────
  2:  { region: 2,  district: "South Central",  geography: "Oklahoma — plains wind", histScore5yr: 24,  tier: "WEAK",   stuffPlusN: 23,  stuffPlusMean: 98.74,  baseline: 98.74, d1Comp: "MAAC (~99.12 FR/SO)", source: "computed", notes: "6 draftees 2021-2025 (Seminole State, Eastern OK, Connors State, Northern OK) refutes WEAK label. Use computed mean as-is. TM selection bias caveat noted but no manual cap." },
  17: { region: 17, district: "Appalachian",    geography: "Georgia + SC — southern, MID pitching", histScore5yr: 31,  tier: "MID",    stuffPlusN: 16,  stuffPlusMean: 96.60,  baseline: 96.60, d1Comp: "Horizon (~96.69 FR/SO)", source: "computed", notes: "Georgia Highlands the consistent program. 0 draftees 2021-2025 but computed mean reasonable." },
  23: { region: 23, district: "South",          geography: "Louisiana + S. Mississippi — humid gulf parks suppress", histScore5yr: 29,  tier: "MID",    stuffPlusN: 19,  stuffPlusMean: 96.74,  baseline: 96.74, d1Comp: "Horizon (~96.69 FR/SO)", source: "computed", notes: "LSU Eunice national contender — only 1 draftee 2021-2025 but recent dominance growing." },
  18: { region: 18, district: "West",           geography: "Utah + Idaho — Salt Lake altitude inflates offense", histScore5yr: 21,  tier: "WEAK",   stuffPlusN: 49,  stuffPlusMean: 95.67,  baseline: 95.67, d1Comp: "Horizon (~96.69 FR/SO)", source: "computed", notes: "Salt Lake/S. Idaho — 3 draftees 2021-2025 refutes WEAK pulldown. Use computed mean as-is." },
  11: { region: 11, district: "Midwest",        geography: "Iowa — Midwest neutral", histScore5yr: 45,  tier: "MID",    stuffPlusN: 10,  stuffPlusMean: 100.92, baseline: 97.0,  d1Comp: "Horizon (~96.69 FR/SO)", source: "overlay_down", notes: "Iowa Western alone — TM-equipped, inflating MID-tier. Only 1 draftee 2021-2025 confirms not elite. Pulled DOWN to ~97." },
  22: { region: 22, district: "South",          geography: "Alabama + Mississippi — humid southern profile", histScore5yr: 26,  tier: "MID",    stuffPlusN: 1,   stuffPlusMean: 82.10,  baseline: 94.0,   d1Comp: "NEC (~93.39 FR/SO)", source: "overlay_up", notes: "Shelton State legit program (1 draftee 2021-2025). Single scored pitcher unreliable at 82.10. Pull UP to MID-tier ~94." },

  // ── WEAK / SWAC tier (D1 lowest-major equivalent) ─────────────────────
  4:  { region: 4,  district: "Midwest",        geography: "Michigan + Wisconsin — cold-weather, weak programs", histScore5yr: 0,   tier: "NO_SIGNAL", stuffPlusN: 8,  stuffPlusMean: 92.26, baseline: 92.26, d1Comp: "SWAC (~92.23 FR/SO)", source: "computed", notes: "Never in top-25 over 5 years AND 0 draftees. Computed mean essentially matches SWAC tier exactly." },
  10: { region: 10, district: "East",           geography: "North Carolina — hitter-friendly East Coast parks", histScore5yr: 78,  tier: "STRONG", stuffPlusN: 1,   stuffPlusMean: 88.63,  baseline: 92.0,   d1Comp: "SWAC (~92.23 FR/SO)", source: "weak_default", notes: "Gaston wins games (#1 in 2024) but only 2 draftees 2021-2025. Team success doesn't translate to pro prospects." },
  20: { region: 20, district: "East",           geography: "Maryland + WV — small East Coast JUCO parks, nuclear offense observed", histScore5yr: 6,   tier: "WEAK",   stuffPlusN: 0,   stuffPlusMean: null,   baseline: 92.0,   d1Comp: "SWAC (~92.23 FR/SO)", source: "weak_default", notes: "Harford + Potomac State — only 2 NJCAA D1 programs, 0 draftees 2021-2025. Observed JUCO hitter SLG .660 nuclear, but conservative weak_default 92." },
  16: { region: 16, district: "South Central",  geography: "Missouri + Arkansas — Ozark-area JUCOs", histScore5yr: 68,  tier: "STRONG", stuffPlusN: 5,   stuffPlusMean: 87.49,  baseline: 91.0,   d1Comp: "Below SWAC", source: "overlay_down", notes: "Crowder wins games (68 poll points) but only 2 draftees 2021-2025. TM-equipped inflation suspect. Locked sub-SWAC tier." },
  9:  { region: 9,  district: "West",           geography: "Pacific Northwest (OR/WA/ID area)", histScore5yr: 0,   tier: "NO_SIGNAL", stuffPlusN: 18, stuffPlusMean: 91.42, baseline: 91.42, d1Comp: "Below SWAC", source: "computed", notes: "Never in top-25 over 5 years AND 0 draftees. Computed mean conservative — use as-is." },
};

/** Look up baseline for a region; throws if unknown. */
export function baselineForRegion(region: number): RegionalBaseline {
  const b = REGIONAL_BASELINE_OVERLAY[region as JucoRegion];
  if (!b) throw new Error(`Unknown JUCO region: ${region}`);
  return b;
}

/**
 * Convenience: just the baseline Stuff+ value for projection math.
 * Used downstream in the transfer projection equation when projecting
 * a JUCO pitcher's expected D1 Stuff+ contribution.
 */
export function baselineStuffPlus(region: number): number {
  return baselineForRegion(region).baseline;
}
