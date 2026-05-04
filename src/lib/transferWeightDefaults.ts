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

  // Pitching / competition weights — lowered 2026-05-04. Calibration
  // anchored on Conference Stuff+ SD ≈ 4.0 (after 2026-04-26 recalibration
  // widened the underlying scale) to preserve a ~2.5x Stuff+:Conference
  // per-SD impact ratio. ISO is intentionally lighter (~1.2x) since ISO
  // is more conference-driven than BA/OBP.
  // History: original 2.0 → 1.5 (apr-27) → 1.0 (may-01) → 1.25 (may-01)
  //   → these values (may-04) after archetype validation against
  //   Hairston (Big 12 → SEC) and Primrose (A-10 → Big 12).
  t_ba_pitching_weight: 0.75,
  t_obp_pitching_weight: 0.65,
  t_iso_pitching_weight: 0.55,

  // Park factor weights — raised 2026-05-04 to ~1:1 with conference impact.
  // Rationale: half of games are at the home park, so park's per-SD effect
  // should be comparable to overall conference context. Previously at ~1/3
  // of conference, which underweighted park.
  t_ba_park_weight: 0.24,
  t_obp_park_weight: 0.26,
  t_iso_park_weight: 0.11,
} as const;

/** Convenience accessor — returns the default for a known transfer weight key. */
export function transferWeightDefault(key: keyof typeof TRANSFER_WEIGHT_DEFAULTS): number {
  return TRANSFER_WEIGHT_DEFAULTS[key];
}
