/**
 * Single source of truth for transfer equation weight defaults.
 *
 * EVERY file that references these weights must import from here.
 * Never hardcode fallback values for these keys anywhere else.
 *
 * If you need to change a default, change it HERE and nowhere else.
 */
export const TRANSFER_WEIGHT_DEFAULTS = {
  // Conference weights
  t_ba_conference_weight: 0.5,
  t_obp_conference_weight: 0.5,
  t_iso_conference_weight: 0.25,

  // Pitching / competition weights
  // Tuned 2026-04-27: dropped from 2.0 → 1.5 after Stuff+ recalibration widened SD.
  // Tuned 2026-05-01: dropped 1.5 → 1.0 — Big 12 → SEC moves were producing ~.060 AVG drops.
  // Re-tuned 2026-05-01: settled at 1.25 as a middle ground; can drop further to 1.0
  //   if archetype validation shows it's still over-aggressive. Supabase model_config
  //   season=2026 entries also set to 1.25 to match.
  t_ba_pitching_weight: 1.25,
  t_obp_pitching_weight: 1.25,
  t_iso_pitching_weight: 1.25,

  // Park factor weights
  t_ba_park_weight: 0.15,
  t_obp_park_weight: 0.15,
  t_iso_park_weight: 0.05,
} as const;

/** Convenience accessor — returns the default for a known transfer weight key. */
export function transferWeightDefault(key: keyof typeof TRANSFER_WEIGHT_DEFAULTS): number {
  return TRANSFER_WEIGHT_DEFAULTS[key];
}
