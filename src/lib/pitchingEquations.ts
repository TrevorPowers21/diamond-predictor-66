export type PitchingEquationWeights = {
  fip_plus_weight: number;
  era_plus_weight: number;
  whip_plus_weight: number;
  k9_plus_weight: number;
  bb9_plus_weight: number;
  hr9_plus_weight: number;
  era_plus_ncaa_avg: number;
  era_plus_ncaa_sd: number;
  era_pr_sd: number;
  era_plus_scale: number;
  fip_plus_ncaa_avg: number;
  fip_plus_ncaa_sd: number;
  fip_pr_sd: number;
  fip_plus_scale: number;
  whip_plus_ncaa_avg: number;
  whip_plus_ncaa_sd: number;
  whip_pr_sd: number;
  whip_plus_scale: number;
  k9_plus_ncaa_avg: number;
  k9_plus_ncaa_sd: number;
  k9_pr_sd: number;
  k9_plus_scale: number;
  bb9_plus_ncaa_avg: number;
  bb9_plus_ncaa_sd: number;
  bb9_pr_sd: number;
  bb9_plus_scale: number;
  hr9_plus_ncaa_avg: number;
  hr9_plus_ncaa_sd: number;
  hr9_pr_sd: number;
  hr9_plus_scale: number;
  era_damp_thresholds: number[];
  era_damp_impacts: number[];
  fip_damp_thresholds: number[];
  fip_damp_impacts: number[];
  whip_damp_thresholds: number[];
  whip_damp_impacts: number[];
  k9_damp_thresholds: number[];
  k9_damp_impacts: number[];
  bb9_damp_thresholds: number[];
  bb9_damp_impacts: number[];
  hr9_damp_thresholds: number[];
  hr9_damp_impacts: number[];
  pwar_ip_sp: number;
  pwar_ip_rp: number;
  pwar_ip_sm: number;
  pwar_r_per_9: number;
  pwar_replacement_runs_per_9: number;
  pwar_runs_per_win: number;
  sp_to_rp_reg_era_pct: number;
  sp_to_rp_reg_fip_pct: number;
  sp_to_rp_reg_whip_pct: number;
  sp_to_rp_reg_k9_pct: number;
  sp_to_rp_reg_bb9_pct: number;
  sp_to_rp_reg_hr9_pct: number;
  rp_to_sp_low_better_tier1_max: number;
  rp_to_sp_low_better_tier2_max: number;
  rp_to_sp_low_better_tier3_max: number;
  rp_to_sp_low_better_tier1_mult: number;
  rp_to_sp_low_better_tier2_mult: number;
  rp_to_sp_low_better_tier3_mult: number;
  market_tier_sec: number;
  market_tier_acc_big12: number;
  market_tier_big_ten: number;
  market_tier_strong_mid: number;
  market_tier_low_major: number;
  market_dollars_per_war: number;
  market_pvf_weekend_sp: number;
  market_pvf_weekday_sp: number;
  market_pvf_reliever: number;
  class_era_fs: number;
  class_era_sj: number;
  class_era_js: number;
  class_era_gr: number;
  class_fip_fs: number;
  class_fip_sj: number;
  class_fip_js: number;
  class_fip_gr: number;
  class_whip_fs: number;
  class_whip_sj: number;
  class_whip_js: number;
  class_whip_gr: number;
  class_k9_fs: number;
  class_k9_sj: number;
  class_k9_js: number;
  class_k9_gr: number;
  class_bb9_fs: number;
  class_bb9_sj: number;
  class_bb9_js: number;
  class_bb9_gr: number;
  class_hr9_fs: number;
  class_hr9_sj: number;
  class_hr9_js: number;
  class_hr9_gr: number;
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
  era_pr_sd: 29.48780404,
  era_plus_scale: 20,
  fip_plus_ncaa_avg: 5.08,
  fip_plus_ncaa_sd: 1.000197585,
  fip_pr_sd: 22.20492306,
  fip_plus_scale: 20,
  whip_plus_ncaa_avg: 1.64,
  whip_plus_ncaa_sd: 0.2521159606,
  whip_pr_sd: 24.58561805,
  whip_plus_scale: 20,
  k9_plus_ncaa_avg: 8.21,
  k9_plus_ncaa_sd: 1.990147058,
  k9_pr_sd: 43.76562188,
  k9_plus_scale: 20,
  bb9_plus_ncaa_avg: 4.82,
  bb9_plus_ncaa_sd: 1.340745984,
  bb9_pr_sd: 42.89490618,
  bb9_plus_scale: 20,
  hr9_plus_ncaa_avg: 1.12,
  hr9_plus_ncaa_sd: 0.4677282102,
  hr9_pr_sd: 34.13833398,
  hr9_plus_scale: 20,
  era_damp_thresholds: [2.5, 3.5, 4.5, 5.5, 7.0, 8.0, 9.0],
  era_damp_impacts: [0.45, 0.65, 0.8, 0.9, 1.0, 0.9, 0.75, 0.6],
  fip_damp_thresholds: [2.25, 3.0, 4.0, 4.5, 6.0, 6.75, 7.75],
  fip_damp_impacts: [0.45, 0.65, 0.8, 0.9, 1.0, 0.9, 0.75, 0.6],
  whip_damp_thresholds: [0.95, 1.15, 1.3, 1.45, 1.95, 2.15, 2.4],
  whip_damp_impacts: [0.45, 0.65, 0.8, 0.9, 1.0, 0.9, 0.75, 0.6],
  k9_damp_thresholds: [4.5, 6.0, 7.25, 10.25, 11.75, 13.25],
  k9_damp_impacts: [0.6, 0.75, 0.9, 1.0, 0.9, 0.75, 0.6],
  bb9_damp_thresholds: [1.75, 2.5, 3.5, 4.25, 5.75, 6.5, 7.5],
  bb9_damp_impacts: [0.45, 0.65, 0.8, 0.9, 1.0, 0.9, 0.75, 0.6],
  hr9_damp_thresholds: [0.35, 0.55, 0.8, 0.95, 1.35, 1.6, 2.0],
  hr9_damp_impacts: [0.45, 0.65, 0.8, 0.9, 1.0, 0.9, 0.75, 0.6],
  pwar_ip_sp: 85,
  pwar_ip_rp: 35,
  pwar_ip_sm: 50,
  pwar_r_per_9: 7.11,
  pwar_replacement_runs_per_9: 1.5,
  pwar_runs_per_win: 10,
  sp_to_rp_reg_era_pct: 6,
  sp_to_rp_reg_fip_pct: 8,
  sp_to_rp_reg_whip_pct: 5,
  sp_to_rp_reg_k9_pct: -8,
  sp_to_rp_reg_bb9_pct: 4,
  sp_to_rp_reg_hr9_pct: 8,
  rp_to_sp_low_better_tier1_max: 2.1,
  rp_to_sp_low_better_tier2_max: 2.6,
  rp_to_sp_low_better_tier3_max: 3.25,
  rp_to_sp_low_better_tier1_mult: 4.0,
  rp_to_sp_low_better_tier2_mult: 3.0,
  rp_to_sp_low_better_tier3_mult: 2.0,
  market_tier_sec: 1.5,
  market_tier_acc_big12: 1.2,
  market_tier_big_ten: 1.0,
  market_tier_strong_mid: 0.8,
  market_tier_low_major: 0.5,
  market_dollars_per_war: 25000,
  market_pvf_weekend_sp: 1.2,
  market_pvf_weekday_sp: 1.0,
  market_pvf_reliever: 1.0,
  class_era_fs: 3.0,
  class_era_sj: 2.0,
  class_era_js: 1.5,
  class_era_gr: 1.0,
  class_fip_fs: 3.0,
  class_fip_sj: 2.5,
  class_fip_js: 1.5,
  class_fip_gr: 1.0,
  class_whip_fs: 2.5,
  class_whip_sj: 2.0,
  class_whip_js: 1.5,
  class_whip_gr: 0.5,
  class_k9_fs: 3.5,
  class_k9_sj: 2.5,
  class_k9_js: 1.5,
  class_k9_gr: 1.0,
  class_bb9_fs: 4.5,
  class_bb9_sj: 3.5,
  class_bb9_js: 2.5,
  class_bb9_gr: 1.5,
  class_hr9_fs: 2.5,
  class_hr9_sj: 2.0,
  class_hr9_js: 1.5,
  class_hr9_gr: 1.0,
};

export const readPitchingWeights = (): PitchingEquationWeights => {
  try {
    const raw = localStorage.getItem(PITCHING_EQUATIONS_STORAGE_KEY);
    if (!raw) return DEFAULT_PITCHING_WEIGHTS;
    const parsed = JSON.parse(raw) as Partial<PitchingEquationWeights>;
    const asNumArray = (v: unknown) => Array.isArray(v) ? v.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
    const withFallbackArray = (arr: number[], fallback: number[], expectedLength: number) =>
      arr.length === expectedLength ? arr : fallback;
    const merged = {
      fip_plus_weight: Number.isFinite(parsed.fip_plus_weight) ? Number(parsed.fip_plus_weight) : DEFAULT_PITCHING_WEIGHTS.fip_plus_weight,
      era_plus_weight: Number.isFinite(parsed.era_plus_weight) ? Number(parsed.era_plus_weight) : DEFAULT_PITCHING_WEIGHTS.era_plus_weight,
      whip_plus_weight: Number.isFinite(parsed.whip_plus_weight) ? Number(parsed.whip_plus_weight) : DEFAULT_PITCHING_WEIGHTS.whip_plus_weight,
      k9_plus_weight: Number.isFinite(parsed.k9_plus_weight) ? Number(parsed.k9_plus_weight) : DEFAULT_PITCHING_WEIGHTS.k9_plus_weight,
      bb9_plus_weight: Number.isFinite(parsed.bb9_plus_weight) ? Number(parsed.bb9_plus_weight) : DEFAULT_PITCHING_WEIGHTS.bb9_plus_weight,
      hr9_plus_weight: Number.isFinite(parsed.hr9_plus_weight) ? Number(parsed.hr9_plus_weight) : DEFAULT_PITCHING_WEIGHTS.hr9_plus_weight,
      era_plus_ncaa_avg: Number.isFinite(parsed.era_plus_ncaa_avg) ? Number(parsed.era_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.era_plus_ncaa_avg,
      era_plus_ncaa_sd: Number.isFinite(parsed.era_plus_ncaa_sd) ? Number(parsed.era_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.era_plus_ncaa_sd,
      era_pr_sd: Number.isFinite(parsed.era_pr_sd) ? Number(parsed.era_pr_sd) : DEFAULT_PITCHING_WEIGHTS.era_pr_sd,
      era_plus_scale: Number.isFinite(parsed.era_plus_scale) ? Number(parsed.era_plus_scale) : DEFAULT_PITCHING_WEIGHTS.era_plus_scale,
      fip_plus_ncaa_avg: Number.isFinite(parsed.fip_plus_ncaa_avg) ? Number(parsed.fip_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.fip_plus_ncaa_avg,
      fip_plus_ncaa_sd: Number.isFinite(parsed.fip_plus_ncaa_sd) ? Number(parsed.fip_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.fip_plus_ncaa_sd,
      fip_pr_sd: Number.isFinite(parsed.fip_pr_sd) ? Number(parsed.fip_pr_sd) : DEFAULT_PITCHING_WEIGHTS.fip_pr_sd,
      fip_plus_scale: Number.isFinite(parsed.fip_plus_scale) ? Number(parsed.fip_plus_scale) : DEFAULT_PITCHING_WEIGHTS.fip_plus_scale,
      whip_plus_ncaa_avg: Number.isFinite(parsed.whip_plus_ncaa_avg) ? Number(parsed.whip_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.whip_plus_ncaa_avg,
      whip_plus_ncaa_sd: Number.isFinite(parsed.whip_plus_ncaa_sd) ? Number(parsed.whip_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.whip_plus_ncaa_sd,
      whip_pr_sd: Number.isFinite(parsed.whip_pr_sd) ? Number(parsed.whip_pr_sd) : DEFAULT_PITCHING_WEIGHTS.whip_pr_sd,
      whip_plus_scale: Number.isFinite(parsed.whip_plus_scale) ? Number(parsed.whip_plus_scale) : DEFAULT_PITCHING_WEIGHTS.whip_plus_scale,
      k9_plus_ncaa_avg: Number.isFinite(parsed.k9_plus_ncaa_avg) ? Number(parsed.k9_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.k9_plus_ncaa_avg,
      k9_plus_ncaa_sd: Number.isFinite(parsed.k9_plus_ncaa_sd) ? Number(parsed.k9_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.k9_plus_ncaa_sd,
      k9_pr_sd: Number.isFinite(parsed.k9_pr_sd) ? Number(parsed.k9_pr_sd) : DEFAULT_PITCHING_WEIGHTS.k9_pr_sd,
      k9_plus_scale: Number.isFinite(parsed.k9_plus_scale) ? Number(parsed.k9_plus_scale) : DEFAULT_PITCHING_WEIGHTS.k9_plus_scale,
      bb9_plus_ncaa_avg: Number.isFinite(parsed.bb9_plus_ncaa_avg) ? Number(parsed.bb9_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.bb9_plus_ncaa_avg,
      bb9_plus_ncaa_sd: Number.isFinite(parsed.bb9_plus_ncaa_sd) ? Number(parsed.bb9_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.bb9_plus_ncaa_sd,
      bb9_pr_sd: Number.isFinite(parsed.bb9_pr_sd) ? Number(parsed.bb9_pr_sd) : DEFAULT_PITCHING_WEIGHTS.bb9_pr_sd,
      bb9_plus_scale: Number.isFinite(parsed.bb9_plus_scale) ? Number(parsed.bb9_plus_scale) : DEFAULT_PITCHING_WEIGHTS.bb9_plus_scale,
      hr9_plus_ncaa_avg: Number.isFinite(parsed.hr9_plus_ncaa_avg) ? Number(parsed.hr9_plus_ncaa_avg) : DEFAULT_PITCHING_WEIGHTS.hr9_plus_ncaa_avg,
      hr9_plus_ncaa_sd: Number.isFinite(parsed.hr9_plus_ncaa_sd) ? Number(parsed.hr9_plus_ncaa_sd) : DEFAULT_PITCHING_WEIGHTS.hr9_plus_ncaa_sd,
      hr9_pr_sd: Number.isFinite(parsed.hr9_pr_sd) ? Number(parsed.hr9_pr_sd) : DEFAULT_PITCHING_WEIGHTS.hr9_pr_sd,
      hr9_plus_scale: Number.isFinite(parsed.hr9_plus_scale) ? Number(parsed.hr9_plus_scale) : DEFAULT_PITCHING_WEIGHTS.hr9_plus_scale,
      era_damp_thresholds: withFallbackArray(asNumArray(parsed.era_damp_thresholds), DEFAULT_PITCHING_WEIGHTS.era_damp_thresholds, DEFAULT_PITCHING_WEIGHTS.era_damp_thresholds.length),
      era_damp_impacts: withFallbackArray(asNumArray(parsed.era_damp_impacts), DEFAULT_PITCHING_WEIGHTS.era_damp_impacts, DEFAULT_PITCHING_WEIGHTS.era_damp_impacts.length),
      fip_damp_thresholds: withFallbackArray(asNumArray(parsed.fip_damp_thresholds), DEFAULT_PITCHING_WEIGHTS.fip_damp_thresholds, DEFAULT_PITCHING_WEIGHTS.fip_damp_thresholds.length),
      fip_damp_impacts: withFallbackArray(asNumArray(parsed.fip_damp_impacts), DEFAULT_PITCHING_WEIGHTS.fip_damp_impacts, DEFAULT_PITCHING_WEIGHTS.fip_damp_impacts.length),
      whip_damp_thresholds: withFallbackArray(asNumArray(parsed.whip_damp_thresholds), DEFAULT_PITCHING_WEIGHTS.whip_damp_thresholds, DEFAULT_PITCHING_WEIGHTS.whip_damp_thresholds.length),
      whip_damp_impacts: withFallbackArray(asNumArray(parsed.whip_damp_impacts), DEFAULT_PITCHING_WEIGHTS.whip_damp_impacts, DEFAULT_PITCHING_WEIGHTS.whip_damp_impacts.length),
      k9_damp_thresholds: withFallbackArray(asNumArray(parsed.k9_damp_thresholds), DEFAULT_PITCHING_WEIGHTS.k9_damp_thresholds, DEFAULT_PITCHING_WEIGHTS.k9_damp_thresholds.length),
      k9_damp_impacts: withFallbackArray(asNumArray(parsed.k9_damp_impacts), DEFAULT_PITCHING_WEIGHTS.k9_damp_impacts, DEFAULT_PITCHING_WEIGHTS.k9_damp_impacts.length),
      bb9_damp_thresholds: withFallbackArray(asNumArray(parsed.bb9_damp_thresholds), DEFAULT_PITCHING_WEIGHTS.bb9_damp_thresholds, DEFAULT_PITCHING_WEIGHTS.bb9_damp_thresholds.length),
      bb9_damp_impacts: withFallbackArray(asNumArray(parsed.bb9_damp_impacts), DEFAULT_PITCHING_WEIGHTS.bb9_damp_impacts, DEFAULT_PITCHING_WEIGHTS.bb9_damp_impacts.length),
      hr9_damp_thresholds: withFallbackArray(asNumArray(parsed.hr9_damp_thresholds), DEFAULT_PITCHING_WEIGHTS.hr9_damp_thresholds, DEFAULT_PITCHING_WEIGHTS.hr9_damp_thresholds.length),
      hr9_damp_impacts: withFallbackArray(asNumArray(parsed.hr9_damp_impacts), DEFAULT_PITCHING_WEIGHTS.hr9_damp_impacts, DEFAULT_PITCHING_WEIGHTS.hr9_damp_impacts.length),
      pwar_ip_sp: Number.isFinite(parsed.pwar_ip_sp) ? Number(parsed.pwar_ip_sp) : DEFAULT_PITCHING_WEIGHTS.pwar_ip_sp,
      pwar_ip_rp: Number.isFinite(parsed.pwar_ip_rp) ? Number(parsed.pwar_ip_rp) : DEFAULT_PITCHING_WEIGHTS.pwar_ip_rp,
      pwar_ip_sm: Number.isFinite(parsed.pwar_ip_sm) ? Number(parsed.pwar_ip_sm) : DEFAULT_PITCHING_WEIGHTS.pwar_ip_sm,
      pwar_r_per_9: Number.isFinite(parsed.pwar_r_per_9) ? Number(parsed.pwar_r_per_9) : DEFAULT_PITCHING_WEIGHTS.pwar_r_per_9,
      pwar_replacement_runs_per_9: Number.isFinite(parsed.pwar_replacement_runs_per_9) ? Number(parsed.pwar_replacement_runs_per_9) : DEFAULT_PITCHING_WEIGHTS.pwar_replacement_runs_per_9,
      pwar_runs_per_win: Number.isFinite(parsed.pwar_runs_per_win) ? Number(parsed.pwar_runs_per_win) : DEFAULT_PITCHING_WEIGHTS.pwar_runs_per_win,
      sp_to_rp_reg_era_pct: Number.isFinite(parsed.sp_to_rp_reg_era_pct) ? Number(parsed.sp_to_rp_reg_era_pct) : DEFAULT_PITCHING_WEIGHTS.sp_to_rp_reg_era_pct,
      sp_to_rp_reg_fip_pct: Number.isFinite(parsed.sp_to_rp_reg_fip_pct) ? Number(parsed.sp_to_rp_reg_fip_pct) : DEFAULT_PITCHING_WEIGHTS.sp_to_rp_reg_fip_pct,
      sp_to_rp_reg_whip_pct: Number.isFinite(parsed.sp_to_rp_reg_whip_pct) ? Number(parsed.sp_to_rp_reg_whip_pct) : DEFAULT_PITCHING_WEIGHTS.sp_to_rp_reg_whip_pct,
      sp_to_rp_reg_k9_pct: Number.isFinite(parsed.sp_to_rp_reg_k9_pct) ? Number(parsed.sp_to_rp_reg_k9_pct) : DEFAULT_PITCHING_WEIGHTS.sp_to_rp_reg_k9_pct,
      sp_to_rp_reg_bb9_pct: Number.isFinite(parsed.sp_to_rp_reg_bb9_pct) ? Number(parsed.sp_to_rp_reg_bb9_pct) : DEFAULT_PITCHING_WEIGHTS.sp_to_rp_reg_bb9_pct,
      sp_to_rp_reg_hr9_pct: Number.isFinite(parsed.sp_to_rp_reg_hr9_pct) ? Number(parsed.sp_to_rp_reg_hr9_pct) : DEFAULT_PITCHING_WEIGHTS.sp_to_rp_reg_hr9_pct,
      rp_to_sp_low_better_tier1_max: Number.isFinite(parsed.rp_to_sp_low_better_tier1_max) ? Number(parsed.rp_to_sp_low_better_tier1_max) : DEFAULT_PITCHING_WEIGHTS.rp_to_sp_low_better_tier1_max,
      rp_to_sp_low_better_tier2_max: Number.isFinite(parsed.rp_to_sp_low_better_tier2_max) ? Number(parsed.rp_to_sp_low_better_tier2_max) : DEFAULT_PITCHING_WEIGHTS.rp_to_sp_low_better_tier2_max,
      rp_to_sp_low_better_tier3_max: Number.isFinite(parsed.rp_to_sp_low_better_tier3_max) ? Number(parsed.rp_to_sp_low_better_tier3_max) : DEFAULT_PITCHING_WEIGHTS.rp_to_sp_low_better_tier3_max,
      rp_to_sp_low_better_tier1_mult: Number.isFinite(parsed.rp_to_sp_low_better_tier1_mult) ? Number(parsed.rp_to_sp_low_better_tier1_mult) : DEFAULT_PITCHING_WEIGHTS.rp_to_sp_low_better_tier1_mult,
      rp_to_sp_low_better_tier2_mult: Number.isFinite(parsed.rp_to_sp_low_better_tier2_mult) ? Number(parsed.rp_to_sp_low_better_tier2_mult) : DEFAULT_PITCHING_WEIGHTS.rp_to_sp_low_better_tier2_mult,
      rp_to_sp_low_better_tier3_mult: Number.isFinite(parsed.rp_to_sp_low_better_tier3_mult) ? Number(parsed.rp_to_sp_low_better_tier3_mult) : DEFAULT_PITCHING_WEIGHTS.rp_to_sp_low_better_tier3_mult,
      market_tier_sec: Number.isFinite(parsed.market_tier_sec) ? Number(parsed.market_tier_sec) : DEFAULT_PITCHING_WEIGHTS.market_tier_sec,
      market_tier_acc_big12: Number.isFinite(parsed.market_tier_acc_big12) ? Number(parsed.market_tier_acc_big12) : DEFAULT_PITCHING_WEIGHTS.market_tier_acc_big12,
      market_tier_big_ten: Number.isFinite(parsed.market_tier_big_ten) ? Number(parsed.market_tier_big_ten) : DEFAULT_PITCHING_WEIGHTS.market_tier_big_ten,
      market_tier_strong_mid: Number.isFinite(parsed.market_tier_strong_mid) ? Number(parsed.market_tier_strong_mid) : DEFAULT_PITCHING_WEIGHTS.market_tier_strong_mid,
      market_tier_low_major: Number.isFinite(parsed.market_tier_low_major) ? Number(parsed.market_tier_low_major) : DEFAULT_PITCHING_WEIGHTS.market_tier_low_major,
      market_dollars_per_war: Number.isFinite((parsed as any).market_dollars_per_war)
        ? Number((parsed as any).market_dollars_per_war)
        : DEFAULT_PITCHING_WEIGHTS.market_dollars_per_war,
      market_pvf_weekend_sp: Number.isFinite(parsed.market_pvf_weekend_sp) ? Number(parsed.market_pvf_weekend_sp) : DEFAULT_PITCHING_WEIGHTS.market_pvf_weekend_sp,
      market_pvf_weekday_sp: Number.isFinite(parsed.market_pvf_weekday_sp) ? Number(parsed.market_pvf_weekday_sp) : DEFAULT_PITCHING_WEIGHTS.market_pvf_weekday_sp,
      market_pvf_reliever: Number.isFinite((parsed as any).market_pvf_reliever)
        ? Number((parsed as any).market_pvf_reliever)
        : (
          Number.isFinite((parsed as any).market_pvf_high_impact_rp)
            ? Number((parsed as any).market_pvf_high_impact_rp)
            : (
              Number.isFinite((parsed as any).market_pvf_low_impact_rp)
                ? Number((parsed as any).market_pvf_low_impact_rp)
                : DEFAULT_PITCHING_WEIGHTS.market_pvf_reliever
            )
        ),
      class_era_fs: Number.isFinite(parsed.class_era_fs) ? Number(parsed.class_era_fs) : DEFAULT_PITCHING_WEIGHTS.class_era_fs,
      class_era_sj: Number.isFinite(parsed.class_era_sj) ? Number(parsed.class_era_sj) : DEFAULT_PITCHING_WEIGHTS.class_era_sj,
      class_era_js: Number.isFinite(parsed.class_era_js) ? Number(parsed.class_era_js) : DEFAULT_PITCHING_WEIGHTS.class_era_js,
      class_era_gr: Number.isFinite(parsed.class_era_gr) ? Number(parsed.class_era_gr) : DEFAULT_PITCHING_WEIGHTS.class_era_gr,
      class_fip_fs: Number.isFinite(parsed.class_fip_fs) ? Number(parsed.class_fip_fs) : DEFAULT_PITCHING_WEIGHTS.class_fip_fs,
      class_fip_sj: Number.isFinite(parsed.class_fip_sj) ? Number(parsed.class_fip_sj) : DEFAULT_PITCHING_WEIGHTS.class_fip_sj,
      class_fip_js: Number.isFinite(parsed.class_fip_js) ? Number(parsed.class_fip_js) : DEFAULT_PITCHING_WEIGHTS.class_fip_js,
      class_fip_gr: Number.isFinite(parsed.class_fip_gr) ? Number(parsed.class_fip_gr) : DEFAULT_PITCHING_WEIGHTS.class_fip_gr,
      class_whip_fs: Number.isFinite(parsed.class_whip_fs) ? Number(parsed.class_whip_fs) : DEFAULT_PITCHING_WEIGHTS.class_whip_fs,
      class_whip_sj: Number.isFinite(parsed.class_whip_sj) ? Number(parsed.class_whip_sj) : DEFAULT_PITCHING_WEIGHTS.class_whip_sj,
      class_whip_js: Number.isFinite(parsed.class_whip_js) ? Number(parsed.class_whip_js) : DEFAULT_PITCHING_WEIGHTS.class_whip_js,
      class_whip_gr: Number.isFinite(parsed.class_whip_gr) ? Number(parsed.class_whip_gr) : DEFAULT_PITCHING_WEIGHTS.class_whip_gr,
      class_k9_fs: Number.isFinite(parsed.class_k9_fs) ? Number(parsed.class_k9_fs) : DEFAULT_PITCHING_WEIGHTS.class_k9_fs,
      class_k9_sj: Number.isFinite(parsed.class_k9_sj) ? Number(parsed.class_k9_sj) : DEFAULT_PITCHING_WEIGHTS.class_k9_sj,
      class_k9_js: Number.isFinite(parsed.class_k9_js) ? Number(parsed.class_k9_js) : DEFAULT_PITCHING_WEIGHTS.class_k9_js,
      class_k9_gr: Number.isFinite(parsed.class_k9_gr) ? Number(parsed.class_k9_gr) : DEFAULT_PITCHING_WEIGHTS.class_k9_gr,
      class_bb9_fs: Number.isFinite(parsed.class_bb9_fs) ? Number(parsed.class_bb9_fs) : DEFAULT_PITCHING_WEIGHTS.class_bb9_fs,
      class_bb9_sj: Number.isFinite(parsed.class_bb9_sj) ? Number(parsed.class_bb9_sj) : DEFAULT_PITCHING_WEIGHTS.class_bb9_sj,
      class_bb9_js: Number.isFinite(parsed.class_bb9_js) ? Number(parsed.class_bb9_js) : DEFAULT_PITCHING_WEIGHTS.class_bb9_js,
      class_bb9_gr: Number.isFinite(parsed.class_bb9_gr) ? Number(parsed.class_bb9_gr) : DEFAULT_PITCHING_WEIGHTS.class_bb9_gr,
      class_hr9_fs: Number.isFinite(parsed.class_hr9_fs) ? Number(parsed.class_hr9_fs) : DEFAULT_PITCHING_WEIGHTS.class_hr9_fs,
      class_hr9_sj: Number.isFinite(parsed.class_hr9_sj) ? Number(parsed.class_hr9_sj) : DEFAULT_PITCHING_WEIGHTS.class_hr9_sj,
      class_hr9_js: Number.isFinite(parsed.class_hr9_js) ? Number(parsed.class_hr9_js) : DEFAULT_PITCHING_WEIGHTS.class_hr9_js,
      class_hr9_gr: Number.isFinite(parsed.class_hr9_gr) ? Number(parsed.class_hr9_gr) : DEFAULT_PITCHING_WEIGHTS.class_hr9_gr,
    };
    // QA lock-in: keep K/9, BB/9, and HR/9 role-impact constants fixed to agreed model values.
    // This prevents stale local edits from drifting projected pK/9, pBB/9, and pHR/9 role transitions.
    merged.k9_plus_ncaa_avg = 8.21;
    merged.k9_plus_ncaa_sd = 1.990147058;
    merged.k9_pr_sd = 43.76562188;
    merged.bb9_plus_ncaa_avg = 4.82;
    merged.bb9_plus_ncaa_sd = 1.340745984;
    merged.bb9_pr_sd = 42.89490618;
    merged.sp_to_rp_reg_hr9_pct = 8;
    return merged;
  } catch {
    return DEFAULT_PITCHING_WEIGHTS;
  }
};
