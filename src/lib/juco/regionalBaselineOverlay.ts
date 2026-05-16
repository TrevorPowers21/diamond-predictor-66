/**
 * JUCO regional Stuff+ baseline overlay.
 *
 * Each NJCAA D1 region has a "baseline" Stuff+ value used when projecting
 * JUCO transfers to D1. The baseline comes from one of three places:
 *
 *   1. COMPUTED — region has sufficient TrackMan data; use the computed
 *      regional mean from pitcher_stuff_plus_inputs directly. Trustworthy.
 *
 *   2. OVERLAY UP — region has thin/no Stuff+ data but historically strong
 *      (NJCAA top-25 5-yr signal). Apply tier-based default upward.
 *      Example: R1 Arizona has 0 scored pitchers but historically STRONG —
 *      we know they produce real D1 talent.
 *
 *   3. OVERLAY DOWN — region has Stuff+ data but historically weak.
 *      Likely single-program TrackMan inflation. Pull baseline DOWN.
 *      Example: R2 has 23 pitchers at mean 98.74 but only 24 historical
 *      points — Seminole State's TM-equipped staff is inflating.
 *
 * Source for tier classification: 5-year (2021-2025) NJCAA D1 top-20 polls.
 * See reference_juco_regional_strength_2021_2025.md memory for the data.
 *
 * Baselines locked 2026-05-16. Refresh annually with new top-25 poll data.
 */

export type JucoRegion =
  | 1 | 2 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 14 | 16 | 17 | 18 | 20 | 22 | 23 | 24;

export type BaselineSource = "computed" | "overlay_up" | "overlay_down" | "weak_default";

export interface RegionalBaseline {
  region: JucoRegion;
  district: string;
  histScore5yr: number;       // 5-year top-20 strength sum (2021-2025)
  tier: "ELITE" | "STRONG" | "MID" | "WEAK" | "NO_SIGNAL";
  stuffPlusN: number | null;  // pitchers with computed stuff_plus (post-fix snapshot 2026-05-16)
  stuffPlusMean: number | null; // computed regional Stuff+ mean
  baseline: number;           // value to use for transfer projection
  source: BaselineSource;
  notes: string;
}

export const REGIONAL_BASELINE_OVERLAY: Record<JucoRegion, RegionalBaseline> = {
  // ── ELITE tier — all data-rich, math matches reality ───────────────────
  8:  { region: 8,  district: "South Atlantic", histScore5yr: 138, tier: "ELITE",  stuffPlusN: 65,  stuffPlusMean: 100.69, baseline: 100.69, source: "computed",     notes: "Chipola, Gulf Coast, Indian River — elite Florida programs" },
  6:  { region: 6,  district: "Plains",         histScore5yr: 133, tier: "ELITE",  stuffPlusN: 119, stuffPlusMean: 96.83,  baseline: 96.83,  source: "computed",     notes: "Johnson Co, Cloud Co, Cowley — Kansas/Oklahoma elite" },
  5:  { region: 5,  district: "Southwest",      histScore5yr: 113, tier: "ELITE",  stuffPlusN: 148, stuffPlusMean: 98.09,  baseline: 98.09,  source: "computed",     notes: "Midland, McLennan, Weatherford — Texas elite" },

  // ── STRONG tier — mostly trust computed, two need overlay UP ───────────
  7:  { region: 7,  district: "Appalachian",    histScore5yr: 97,  tier: "STRONG", stuffPlusN: 54,  stuffPlusMean: 95.54,  baseline: 95.54,  source: "computed",     notes: "Walters State the perennial top-25 program" },
  1:  { region: 1,  district: "West",           histScore5yr: 87,  tier: "STRONG", stuffPlusN: 0,   stuffPlusMean: null,   baseline: 98.0,   source: "overlay_up",   notes: "Arizona JUCOs (Yavapai, Pima, Central AZ, Cochise, Southern Nevada). Data gap — TruMedia exposes velo only, no movement. Historically strong region. Pull UP to ~98." },
  14: { region: 14, district: "Mid-South",      histScore5yr: 79,  tier: "STRONG", stuffPlusN: 150, stuffPlusMean: 97.89,  baseline: 97.89,  source: "computed",     notes: "Blinn, Navarro, San Jacinto, Tyler JC — Texas core" },
  10: { region: 10, district: "East",           histScore5yr: 78,  tier: "STRONG", stuffPlusN: 1,   stuffPlusMean: 88.63,  baseline: 97.0,   source: "overlay_up",   notes: "Gaston was #1 in 2024. Florence-Darlington consistent top-10. Massive data gap (only 1 pitcher scored). Pull UP to ~97." },
  24: { region: 24, district: "Midwest",        histScore5yr: 76,  tier: "STRONG", stuffPlusN: 69,  stuffPlusMean: 96.14,  baseline: 96.14,  source: "computed",     notes: "Wabash Valley, John A. Logan — Illinois midwest core" },
  16: { region: 16, district: "South Central",  histScore5yr: 68,  tier: "STRONG", stuffPlusN: 5,   stuffPlusMean: 87.49,  baseline: 96.0,   source: "overlay_up",   notes: "Crowder elite year after year, but only 5 pitchers with TM data — small-sample drag. Pull UP to ~96." },

  // ── MID tier — mostly trust computed, one needs overlay DOWN ───────────
  11: { region: 11, district: "Midwest",        histScore5yr: 45,  tier: "MID",    stuffPlusN: 10,  stuffPlusMean: 100.92, baseline: 97.0,   source: "overlay_down", notes: "Iowa Western alone — TM-equipped, inflating MID-tier region. Pull DOWN to ~97." },
  17: { region: 17, district: "Appalachian",    histScore5yr: 31,  tier: "MID",    stuffPlusN: 16,  stuffPlusMean: 96.60,  baseline: 96.60,  source: "computed",     notes: "Georgia Highlands the consistent program" },
  23: { region: 23, district: "South",          histScore5yr: 29,  tier: "MID",    stuffPlusN: 19,  stuffPlusMean: 96.74,  baseline: 96.74,  source: "computed",     notes: "LSU Eunice carries the region — national contender" },
  22: { region: 22, district: "South",          histScore5yr: 26,  tier: "MID",    stuffPlusN: 1,   stuffPlusMean: 82.10,  baseline: 94.0,   source: "overlay_up",   notes: "Shelton State legit program. Single scored pitcher unreliable. Pull UP to MID-tier ~94." },

  // ── WEAK tier — over-rated by single TM programs, pull DOWN ────────────
  2:  { region: 2,  district: "South Central",  histScore5yr: 24,  tier: "WEAK",   stuffPlusN: 23,  stuffPlusMean: 98.74,  baseline: 94.0,   source: "overlay_down", notes: "Seminole State's TM-equipped staff inflating. Historically weak region (only 24 pts over 5 years). Pull DOWN to ~94." },
  18: { region: 18, district: "West",           histScore5yr: 21,  tier: "WEAK",   stuffPlusN: 49,  stuffPlusMean: 95.67,  baseline: 94.0,   source: "overlay_down", notes: "Salt Lake's TM-equipped roster inflating. Pull DOWN to ~94." },
  20: { region: 20, district: "East",           histScore5yr: 6,   tier: "WEAK",   stuffPlusN: 0,   stuffPlusMean: null,   baseline: 92.0,   source: "weak_default", notes: "Harford + Potomac State — real D1 (Harford won 2026 Region 20 tournament) but historically weak. No TM data. Use weak-tier default ~92." },

  // ── NO SIGNAL — no historical top-25 presence, modest data ─────────────
  9:  { region: 9,  district: "West",           histScore5yr: 0,   tier: "NO_SIGNAL", stuffPlusN: 18, stuffPlusMean: 91.42, baseline: 91.42, source: "computed", notes: "Never in top-25 over 5 years. Computed mean already conservative." },
  4:  { region: 4,  district: "Midwest",        histScore5yr: 0,   tier: "NO_SIGNAL", stuffPlusN: 8,  stuffPlusMean: 92.26, baseline: 92.26, source: "computed", notes: "Never in top-25 over 5 years. Computed mean already conservative." },
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
