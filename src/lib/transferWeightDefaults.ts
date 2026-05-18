/**
 * Single source of truth for transfer equation weight defaults.
 *
 * EVERY file that references these weights must import from here.
 * Never hardcode fallback values for these keys anywhere else.
 *
 * If you need to change a default, change it HERE and nowhere else.
 */
export const TRANSFER_WEIGHT_DEFAULTS = {
  // Conference weights — lowered 2026-05-04 from 0.5/0.5/0.25 to reduce
  // the conference's compounding effect on harsh moves (Big 12 → SEC was
  // double-counting the pitching strength via low conference offense).
  t_ba_conference_weight: 0.30,
  t_obp_conference_weight: 0.30,
  t_iso_conference_weight: 0.15,

  // Pitching / competition weights — restored 2026-05-04 to ~3x Conference
  // ratio (the original "Stuff+ should be 3x conference" hypothesis) after
  // archetype validation showed elite mid-major hitters (Gomez NEC → Big 12,
  // 13-point Stuff+ delta) weren't dropping enough at the lighter values.
  // Stuff+ is the regression-for-weak-competition mechanism — it needs
  // enough impact for big deltas to actually swamp the move. Linear scaling
  // means small deltas (Hairston Big 12 → SEC, +3.8 Stuff+) barely move at
  // either weight; large deltas need the heavier multiplier to register.
  // History: original 2.0 → 1.5 (apr-27) → 1.0 (may-01) → 1.25 (may-01) →
  //   0.75/0.65/0.55 (may-04 morning) → these values (may-04 afternoon) once
  //   we saw Gomez at .332 vs gut's expected ~.300.
  t_ba_pitching_weight: 1.00,
  t_obp_pitching_weight: 0.85,
  t_iso_pitching_weight: 0.75,

  // Park factor weights — raised 2026-05-04 to ~1:1 with conference impact.
  // Rationale: half of games are at the home park, so park's per-SD effect
  // should be comparable to overall conference context. Previously at ~1/3
  // of conference, which underweighted park.
  t_ba_park_weight: 0.24,
  t_obp_park_weight: 0.26,
  t_iso_park_weight: 0.11,

  // Power-rating blend weights — 0.70 means projected slash = 70% PR-derived
  // scaled rate + 30% last-year actual rate, then env multiplier on top.
  // Included here (mirroring config keys used in TP) so transferWeightsForSource()
  // returns a complete set; JUCO override sets these to 0.
  t_ba_power_weight: 0.70,
  t_obp_power_weight: 0.70,
  t_iso_power_weight: 0.70,
} as const;

/** Convenience accessor — returns the default for a known transfer weight key. */
export function transferWeightDefault(key: keyof typeof TRANSFER_WEIGHT_DEFAULTS): number {
  return TRANSFER_WEIGHT_DEFAULTS[key];
}

/**
 * JUCO-specific transfer weight overrides.
 *
 * Rationale: JUCO has no park-factor data (no public source, TruMedia team
 * stats unreliable). Park weights set to 0; the lost environmental signal
 * (BA 0.24 / OBP 0.26 / ISO 0.11) is split evenly between conference and
 * pitching weights. Net total environmental influence stays ~equal to D1
 * but routes entirely through conf + Stuff+ deltas.
 *
 * Used when source player is JUCO (division='NJCAA_D1'). Destination D1
 * conference still uses its own conference / Stuff+ values normally.
 *
 * Calibrated 2026-05-16 via 4 hand-calc projections (Pantier/Eagar/Mouton/
 * Woodward to SEC). All four land at .888-.984 OPS — realistic top-of-SEC
 * outcomes for top JUCO bats per coach gut-check.
 */
export const JUCO_TRANSFER_WEIGHTS = {
  t_ba_conference_weight: 0.42,   // +0.12 (half of lost BA park 0.24)
  t_obp_conference_weight: 0.43,  // +0.13 (half of lost OBP park 0.26)
  t_iso_conference_weight: 0.20,  // +0.05 (half of lost ISO park 0.11)
  t_ba_pitching_weight: 1.12,     // +0.12
  t_obp_pitching_weight: 0.98,    // +0.13
  t_iso_pitching_weight: 0.80,    // +0.05
  t_ba_park_weight: 0,            // no JUCO park data
  t_obp_park_weight: 0,
  t_iso_park_weight: 0,
  // Power weights zeroed for go-to-market — JUCO projections use raw 2026
  // stats only, no PR blending. JUCO Hitter Master has ba/obp/iso PRs
  // computed for ~50% of players, kept in DB as future add-on once
  // validated via examples vs actual transfer outcomes. Until then,
  // baBlended = lastAvg × 1 = pure raw stat → env multiplier.
  t_ba_power_weight: 0,
  t_obp_power_weight: 0,
  t_iso_power_weight: 0,
} as const;

/** Returns the appropriate weight set based on source player division. */
export function transferWeightsForSource(division: string | null | undefined) {
  return division === "NJCAA_D1" ? JUCO_TRANSFER_WEIGHTS : TRANSFER_WEIGHT_DEFAULTS;
}

/**
 * JUCO-specific pitcher transfer overrides.
 *
 * Methodology mirrors the hitter approach (2026 stats verbatim, no PR blend,
 * no park, env-only translation) but the WEIGHTS differ because pitcher math
 * has a different shape:
 *
 *   - Pitcher's own Stuff+ is the dominant cross-context signal (when present).
 *     For the 38% of JUCO pitchers with individual Stuff+, use heavier
 *     Stuff+ delta weights. For the 62% without, skip Stuff+ entirely in the
 *     callsite (set delta to 0) — Data Reliability surfaces this.
 *   - The conference "hitter_talent_plus" input gets a per-district override:
 *     raw JUCO Conference Stats BA+ are inflated 107-123 because JUCO hitters
 *     mash each other in soft environments. For the pitcher math we want
 *     "what was the REAL quality of hitters faced" — locked at SWAC/NEC/
 *     Horizon equivalents per district (72-95). See JUCO_DISTRICT_HTP_OVERRIDE.
 *   - Park weights zeroed (no JUCO park data).
 */
export const JUCO_PITCHING_TRANSFER_WEIGHTS = {
  // Conference (hitter_talent_plus) weights — moderate. Stuff+ is the heavier
  // signal for pitchers because it scales cleanly across talent levels.
  t_era_conference_weight: 0.40,
  t_fip_conference_weight: 0.40,
  t_whip_conference_weight: 0.40,
  t_k9_conference_weight: 0.30,
  t_bb9_conference_weight: 0.30,
  t_hr9_conference_weight: 0.35,

  // Stuff+ delta weights — heavier than D1 to reward arms whose individual
  // Stuff+ travels. Callsite zeroes these for pitchers without individual
  // Stuff+ data (no district-average fallback per user direction).
  t_era_stuff_weight: 1.30,
  t_fip_stuff_weight: 1.40,
  t_whip_stuff_weight: 1.10,
  t_k9_stuff_weight: 1.20,
  t_bb9_stuff_weight: 0.80,
  t_hr9_stuff_weight: 1.10,

  // Park weights = 0 (JUCO has no park data)
  t_era_park_weight: 0,
  t_whip_park_weight: 0,
  t_hr9_park_weight: 0,

  // Power weights = 0 (use raw 2026 rates verbatim, same as hitter approach)
  t_era_power_weight: 0,
  t_fip_power_weight: 0,
  t_whip_power_weight: 0,
  t_k9_power_weight: 0,
  t_bb9_power_weight: 0,
  t_hr9_power_weight: 0,
} as const;

/**
 * Per-district JUCO hitter_talent_plus override.
 *
 * Replaces the inflated Conference Stats BA+ values (107-123) with values
 * reflecting the TRUE talent of hitters a JUCO pitcher faced — anchored at
 * NEC/Horizon/SWAC tier per user framework (2026-05-17). Keyed by the
 * district name as it appears on Teams Table / wired conference_id.
 *
 * Calibration: South Atlantic (FL) at ~95 (ASUN/Big East tier) — Florida
 * is the JUCO outlier with 49 draftees 2021-2025. East district at 72
 * (below NEC) — weakest, mostly NY/NJ programs. Everything between scales
 * by district Stuff+ baseline + 5-yr poll strength.
 *
 * NOT calibrated against actual draft per-region data (not in DB).
 * Recalibrate as we see real projections vs gut.
 */
export const JUCO_DISTRICT_HTP_OVERRIDE: Record<string, number> = {
  "South Atlantic": 95,   // FL — Stuff+ 100.7, mid-major D1 tier
  "Mid-South": 92,        // TN — Stuff+ 97.9, Big West/CAA tier
  "Southwest": 88,        // TX/NM — Stuff+ 98.1, Patriot/MAAC tier
  "Plains": 85,           // KS/NE — Stuff+ 96.8, MAAC tier
  "Appalachian": 82,      // TN mtns / GA / SC — Stuff+ 95.9, below MAAC
  "Midwest": 80,          // MI/WI/IL — Stuff+ 95.3, NEC/SWAC range
  "South": 80,            // LA / AL / MS — Stuff+ 94.8, NEC/SWAC
  "West": 78,             // AZ / UT / Pacific NW — Stuff+ 94.7, NEC tier
  "South Central": 75,    // OK / MO / AR — Stuff+ 93.8, below NEC
  "East": 72,             // NY / NJ / MD — Stuff+ 92.0, weakest (below SWAC)
};
