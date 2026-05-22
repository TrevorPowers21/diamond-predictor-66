/**
 * Platform-wide tunable constants.
 *
 * These are the DEFAULTS used when no database override is present.
 * Every value here is intentionally adjustable — none should be
 * scattered as inline literals in calculation functions.
 *
 * Runtime adjustability:
 *   - Admins can override any key in the `platform_config` Supabase table.
 *   - The `usePlatformConfig()` hook merges DB values on top of these defaults.
 *   - Calculation functions accept config as a parameter so they never read
 *     globals directly — they operate on whatever config the caller provides.
 *
 * Change log lives in git history; each tuning decision should be committed
 * with a message explaining the calibration rationale.
 */

// ── NIL Valuation ─────────────────────────────────────────────────────────────

/** Conference-tier multipliers applied to oWAR-based player scores. */
export const NIL_CONFERENCE_TIER_MULTIPLIERS = {
  sec: 1.5,
  p4: 1.2,       // ACC + Big 12
  bigTen: 1.0,
  strongMid: 0.8,
  lowMajor: 0.5,
} as const;

export type NilConferenceTierMultipliers = typeof NIL_CONFERENCE_TIER_MULTIPLIERS;

/** Position scarcity multipliers for player score computation. */
export const POSITION_VALUE_MULTIPLIERS = {
  premium: 1.3,     // C, SS, CF
  aboveAvg: 1.1,    // 2B, 3B, LF, RF
  neutral: 1.0,     // 1B, DH
  utility: 0.8,     // UT, Bench
} as const;

/**
 * Baseline total player score for a full roster.
 * Used as the denominator in NIL allocation when actual roster score
 * is below this threshold (prevents inflated allocations for partial rosters).
 */
export const DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE = 68;

// ── Transfer Projection Weights ───────────────────────────────────────────────

/**
 * Weights for D1→D1 transfer projections.
 * Three environmental signals — conference strength delta, pitching quality
 * delta (Stuff+), and park factor delta — each contribute to the projection.
 * Power-rating blend governs how much of the final output comes from the
 * player's projected skill level vs last-year's actual production.
 */
export const D1_TRANSFER_WEIGHTS = {
  // Conference quality adjustment weights
  conference: { avg: 0.30, obp: 0.30, iso: 0.15 },
  // Pitching difficulty adjustment weights
  pitching:   { avg: 1.00, obp: 0.85, iso: 0.75 },
  // Park factor adjustment weights
  park:       { avg: 0.24, obp: 0.26, iso: 0.11 },
  // Power-rating blend (how much PR-derived rate vs raw last-year stat)
  powerBlend: { avg: 0.70, obp: 0.70, iso: 0.70 },
} as const;

/**
 * Weights for JUCO (NJCAA D1) → D1 transfer projections.
 * Park weights are zeroed (no JUCO park factor data); the lost environmental
 * signal is split between conference and pitching weights. Power-rating blend
 * is also zeroed — JUCO projections use raw 2026 stats without PR blending
 * until JUCO PR validation is complete.
 */
export const JUCO_TRANSFER_WEIGHTS = {
  conference: { avg: 0.42, obp: 0.43, iso: 0.20 },
  pitching:   { avg: 1.30, obp: 1.13, iso: 0.92 },
  park:       { avg: 0,    obp: 0,    iso: 0    },   // no JUCO park data
  powerBlend: { avg: 0,    obp: 0,    iso: 0    },   // no PR blend for JUCO
} as const;

// ── JUCO Outlier Regression ───────────────────────────────────────────────────

/**
 * Nonlinear regression parameters for JUCO raw stats above the outlier
 * threshold. Mirrors D1's natural regression via the power-rating blend
 * (disabled for JUCO), pulling extreme outliers toward the NCAA D1 mean.
 *
 * Formula: r = min(maxR, (rawStat - threshold) × slope)
 *          result = rawStat × (1 - r) + ncaaMean × r
 *
 * Locked 2026-05-18. Lighter touch than original version: Pantier (.484 AVG)
 * pulls to ~.336 pAVG, average JUCO regulars (.300 AVG) pass through unchanged.
 */
export const JUCO_OUTLIER_REGRESSION = {
  avg: { mean: 0.280, threshold: 0.350, slope: 1.12, maxR: 0.10 },
  obp: { mean: 0.385, threshold: 0.450, slope: 0.85, maxR: 0.10 },
  iso: { mean: 0.162, threshold: 0.280, slope: 1.50, maxR: 0.15 },
} as const;

// ── JUCO District Hitter Talent Plus Overrides ────────────────────────────────

/**
 * Per-district adjusted Hitter Talent Plus values.
 * Raw JUCO Conference Stats BA+ are inflated (107–123) because JUCO hitters
 * mash each other in soft environments. These values replace the raw conference
 * HTP in the pitcher projection formula with realistic competition equivalents
 * (calibrated against SWAC/NEC/Horizon D1 tiers).
 */
export const JUCO_DISTRICT_HTP_OVERRIDES: Record<string, number> = {
  "South Atlantic": 94,   // FL — Stuff+ 100.7, ≈ MWC tier
  "Mid-South":      88,   // TN
  "Southwest":      85,   // TX/NM
  "Plains":         82,   // KS/NE
  "Appalachian":    78,   // TN mtns / GA / SC
  "Midwest":        75,   // MI/WI/IL
  "South":          73,   // LA/AL/MS
  "West":           71,   // AZ/UT/Pacific NW
  "South Central":  68,   // OK/MO/AR
  "East":           65,   // NY/NJ/MD — NEC tier
};

// ── WAR Formula Coefficients ──────────────────────────────────────────────────

/**
 * Coefficients for the wRC+ composite formula.
 * wRC+ = ((w_obp × OBP + w_slg × SLG + w_avg × AVG + w_iso × ISO) / divisor) × 100
 */
export const WRC_PLUS_COEFFICIENTS = {
  w_obp: 0.45,
  w_slg: 0.30,
  w_avg: 0.15,
  w_iso: 0.10,
  divisor: 0.364,
} as const;

/**
 * Coefficients for oWAR from wRC+.
 * oWAR = (((wRC+ − 100) / 100) × PA × pa_rate + (PA / pa_full_season × baseline)) / scale
 */
export const OWAR_COEFFICIENTS = {
  pa_rate: 0.13,
  pa_full_season: 600,
  baseline: 25,
  scale: 10,
} as const;

/**
 * Coefficients for pRV+ composite formula.
 * pRV+ = w_fip×FIP+ + w_era×ERA+ + w_whip×WHIP+ + w_k9×K9+ + w_bb9×BB9+ + w_hr9×HR9+
 */
export const PRV_PLUS_COEFFICIENTS = {
  w_fip:  0.30,
  w_era:  0.25,
  w_whip: 0.15,
  w_k9:   0.15,
  w_bb9:  0.10,
  w_hr9:  0.05,
} as const;

/**
 * Coefficients for pWAR from pRV+.
 * pWAR = (((pRV+ − 100) / 100) × (IP/9) × leverage + (IP/9 × baseline)) / scale
 */
export const PWAR_COEFFICIENTS = {
  leverage: 5.5,
  baseline: 2.5,
  scale: 10,
} as const;

// ── Proration ─────────────────────────────────────────────────────────────────

/**
 * 56-game proration for cross-conference fairness.
 * games_played_est ≈ team total IP / 9
 * proration_factor = target_games / games_played_est, clamped to [min, max]
 */
export const PRORATION = {
  target_games: 56,
  factor_min: 0.7,
  factor_max: 1.5,
} as const;
