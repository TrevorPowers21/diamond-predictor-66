export type PitchingEquationWeights = {
  fip_plus_weight: number;
  era_plus_weight: number;
  whip_plus_weight: number;
  k9_plus_weight: number;
  bb9_plus_weight: number;
  hr9_plus_weight: number;
  era_plus_ncaa_avg: number;
  era_plus_ncaa_sd: number;
  era_plus_scale: number;
  fip_plus_ncaa_avg: number;
  fip_plus_ncaa_sd: number;
  fip_plus_scale: number;
  whip_plus_ncaa_avg: number;
  whip_plus_ncaa_sd: number;
  whip_plus_scale: number;
  k9_plus_ncaa_avg: number;
  k9_plus_ncaa_sd: number;
  k9_plus_scale: number;
  bb9_plus_ncaa_avg: number;
  bb9_plus_ncaa_sd: number;
  bb9_plus_scale: number;
  hr9_plus_ncaa_avg: number;
  hr9_plus_ncaa_sd: number;
  hr9_plus_scale: number;
};

export const PITCHING_EQUATIONS_STORAGE_KEY = "admin_pitching_equations_v1";

export const DEFAULT_PITCHING_WEIGHTS: PitchingEquationWeights = {
  fip_plus_weight: 0.3,
  era_plus_weight: 0.25,
  whip_plus_weight: 0.15,
  k9_plus_weight: 0.15,
  bb9_plus_weight: 0.1,
  hr9_plus_weight: 0.05,
  era_plus_ncaa_avg: 6.21,
  era_plus_ncaa_sd: 1.587898316,
  era_plus_scale: 20,
  fip_plus_ncaa_avg: 5.08,
  fip_plus_ncaa_sd: 1.000197585,
  fip_plus_scale: 20,
  whip_plus_ncaa_avg: 1.64,
  whip_plus_ncaa_sd: 0.2521159606,
  whip_plus_scale: 20,
  k9_plus_ncaa_avg: 8.22,
  k9_plus_ncaa_sd: 1.990147058,
  k9_plus_scale: 20,
  bb9_plus_ncaa_avg: 4.82,
  bb9_plus_ncaa_sd: 1.340745984,
  bb9_plus_scale: 20,
  hr9_plus_ncaa_avg: 1.12,
  hr9_plus_ncaa_sd: 0.4677282102,
  hr9_plus_scale: 20,
};

export const readPitchingWeights = (): PitchingEquationWeights => {
  try {
    const raw = localStorage.getItem(PITCHING_EQUATIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_PITCHING_WEIGHTS;
    const parsed = JSON.parse(raw) as Partial<PitchingEquationWeights>;
    return {
      fip_plus_weight: Number.isFinite(parsed.fip_plus_weight) ? Number(parsed.fip_plus_weight) : DEFAULT_PITCHING_WEIGHTS.fip_plus_weight,
      era_plus_weight: Number.isFinite(parsed.era_plus_weight) ? Number(parsed.era_plus_weight) : DEFAULT_PITCHING_WEIGHTS.era_plus_weight,
      whip_plus_weight: Number.isFinite(parsed.whip_plus_weight) ? Number(parsed.whip_plus_weight) : DEFAULT_PITCHING_WEIGHTS.whip_plus_weight,
      k9_plus_weight: Number.isFinite(parsed.k9_plus_weight) ? Number(parsed.k9_plus_weight) : DEFAULT_PITCHING_WEIGHTS.k9_plus_weight,
      bb9_plus_weight: Number.isFinite(parsed.bb9_plus_weight) ? Number(parsed.bb9_plus_weight) : DEFAULT_PITCHING_WEIGHTS.bb9_plus_weight,
      hr9_plus_weight: Number.isFinite(parsed.hr9_plus_weight) ? Number(parsed.hr9_plus_weight) : DEFAULT_PITCHING_WEIGHTS.hr9_plus_weight,
      era_plus_ncaa_avg: Number.isFinite(parsed.era_plus_ncaa_avg) ? Number(parsed.era_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.era_plus_ncaa_avg,
      era_plus_ncaa_sd: Number.isFinite(parsed.era_plus_ncaa_sd) ? Number(parsed.era_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.era_plus_ncaa_sd,
      era_plus_scale: Number.isFinite(parsed.era_plus_scale) ? Number(parsed.era_plus_scale) : DEFAULT_PITCHING_WEIGHTS.era_plus_scale,
      fip_plus_ncaa_avg: Number.isFinite(parsed.fip_plus_ncaa_avg) ? Number(parsed.fip_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.fip_plus_ncaa_avg,
      fip_plus_ncaa_sd: Number.isFinite(parsed.fip_plus_ncaa_sd) ? Number(parsed.fip_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.fip_plus_ncaa_sd,
      fip_plus_scale: Number.isFinite(parsed.fip_plus_scale) ? Number(parsed.fip_plus_scale) : DEFAULT_PITCHING_WEIGHTS.fip_plus_scale,
      whip_plus_ncaa_avg: Number.isFinite(parsed.whip_plus_ncaa_avg) ? Number(parsed.whip_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.whip_plus_ncaa_avg,
      whip_plus_ncaa_sd: Number.isFinite(parsed.whip_plus_ncaa_sd) ? Number(parsed.whip_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.whip_plus_ncaa_sd,
      whip_plus_scale: Number.isFinite(parsed.whip_plus_scale) ? Number(parsed.whip_plus_scale) : DEFAULT_PITCHING_WEIGHTS.whip_plus_scale,
      k9_plus_ncaa_avg: Number.isFinite(parsed.k9_plus_ncaa_avg) ? Number(parsed.k9_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.k9_plus_ncaa_avg,
      k9_plus_ncaa_sd: Number.isFinite(parsed.k9_plus_ncaa_sd) ? Number(parsed.k9_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.k9_plus_ncaa_sd,
      k9_plus_scale: Number.isFinite(parsed.k9_plus_scale) ? Number(parsed.k9_plus_scale) : DEFAULT_PITCHING_WEIGHTS.k9_plus_scale,
      bb9_plus_ncaa_avg: Number.isFinite(parsed.bb9_plus_ncaa_avg) ? Number(parsed.bb9_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.bb9_plus_ncaa_avg,
      bb9_plus_ncaa_sd: Number.isFinite(parsed.bb9_plus_ncaa_sd) ? Number(parsed.bb9_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.bb9_plus_ncaa_sd,
      bb9_plus_scale: Number.isFinite(parsed.bb9_plus_scale) ? Number(parsed.bb9_plus_scale) : DEFAULT_PITCHING_WEIGHTS.bb9_plus_scale,
      hr9_plus_ncaa_avg: Number.isFinite(parsed.hr9_plus_ncaa_avg) ? Number(parsed.hr9_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.hr9_plus_ncaa_avg,
      hr9_plus_ncaa_sd: Number.isFinite(parsed.hr9_plus_ncaa_sd) ? Number(parsed.hr9_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.hr9_plus_ncaa_sd,
      hr9_plus_scale: Number.isFinite(parsed.hr9_plus_scale) ? Number(parsed.hr9_plus_scale) : DEFAULT_PITCHING_WEIGHTS.hr9_plus_scale,
    };
  } catch {
    return DEFAULT_PITCHING_WEIGHTS;
  }
};
