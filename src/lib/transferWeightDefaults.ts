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
