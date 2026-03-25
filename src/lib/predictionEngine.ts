import { supabase } from "@/integrations/supabase/client";

type PredictionRow = {
  id: string;
  model_type: "returner" | "transfer" | string;
  status: string | null;
  class_transition?: string | null;
  dev_aggressiveness?: number | null;
  from_avg?: number | null;
  from_obp?: number | null;
  from_slg?: number | null;
  power_rating_plus?: number | null;
  from_avg_plus?: number | null;
  to_avg_plus?: number | null;
  from_obp_plus?: number | null;
  to_obp_plus?: number | null;
  from_slg_plus?: number | null;
  to_slg_plus?: number | null;
  from_stuff_plus?: number | null;
  to_stuff_plus?: number | null;
  from_park_factor?: number | null;
  to_park_factor?: number | null;
};

type UpdateFields = {
  class_transition?: string;
  dev_aggressiveness?: number;
};

const DEFAULT_CLASS_BASES: Record<string, { avg: number; obp: number; slg: number }> = {
  FS: { avg: 0.03, obp: 0.045, slg: 0.06 },
  SJ: { avg: 0.02, obp: 0.03, slg: 0.035 },
  JS: { avg: 0.015, obp: 0.02, slg: 0.02 },
  GR: { avg: 0.01, obp: 0.01, slg: 0.01 },
};
const DEFAULT_DEV_COEFFS = { avg: 0.06, obp: 0.08, slg: 0.1 };
const DEFAULT_DAMPENING_DIVISORS = { avg: 0.1, obp: 0.085, slg: 0.3 };
const DEFAULT_WRC_WEIGHTS = { obp: 0.45, slg: 0.3, avg: 0.15, iso: 0.1 };

interface ReturnerConfig {
  ncaaAvg: number;
  ncaaObp: number;
  ncaaIso: number;
  baStdPower: number;
  baStdNcaa: number;
  obpStdPower: number;
  obpStdNcaa: number;
  ncaaPR: number;
  powerWeight: number;
  ncaaWrc: number;
  classBases: Record<string, { avg: number; obp: number; iso: number }>;
  devCoeffs: { avg: number; obp: number; iso: number };
  isoStdNcaa: number;
  isoStdPower: number;
  wrcWeights: { obp: number; slg: number; avg: number; iso: number };
  defaultDevAgg: number;
  baDampTier1Max: number;
  baDampTier2Max: number;
  baDampTier3Max: number;
  baDampTier1Impact: number;
  baDampTier2Impact: number;
  baDampTier3Impact: number;
  baDampTier4Impact: number;
  obpDampTier1Max: number;
  obpDampTier2Max: number;
  obpDampTier3Max: number;
  obpDampTier1Impact: number;
  obpDampTier2Impact: number;
  obpDampTier3Impact: number;
  obpDampTier4Impact: number;
}

interface TransferConfig {
  baNcaaAvg: number;
  obpNcaaAvg: number;
  isoNcaaAvg: number;
  baStdPower: number;
  baStdNcaa: number;
  obpStdPower: number;
  obpStdNcaa: number;
  baPowerWeight: number;
  obpPowerWeight: number;
  baConferenceWeight: number;
  obpConferenceWeight: number;
  isoConferenceWeight: number;
  baPitchingWeight: number;
  obpPitchingWeight: number;
  isoPitchingWeight: number;
  baParkWeight: number;
  obpParkWeight: number;
  isoParkWeight: number;
  isoStdNcaa: number;
  isoStdPower: number;
  wrcWeights: { obp: number; slg: number; avg: number; iso: number };
  ncaaWrc: number;
}

interface EngineConfig {
  returner: ReturnerConfig;
  transfer: TransferConfig;
}

interface ReturnerPowerContext {
  baPlus: number | null;
  obpPlus: number | null;
  isoPlus: number | null;
}

// Temporary manual internal-rating overrides when DB write access is unavailable.
// Remove once Supabase owner access is restored and values are stored in player_prediction_internals.
const MANUAL_INTERNAL_OVERRIDES: Record<string, ReturnerPowerContext> = {
  "ff4b0520-0976-4224-9337-0d8a00333168": {
    baPlus: 142.20265884131427,
    obpPlus: 141.30015642620685,
    isoPlus: 173.78654320156954,
  },
};


function readLocalEquationValues(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem("admin_dashboard_equation_values_v1");
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

function toRate(v: number): number {
  return Math.abs(v) > 1 ? v / 100 : v;
}

function toWeight(v: number): number {
  return toRate(v);
}

function toStatRate(v: number): number {
  return toRate(v);
}

function normalizeRateInput(v: number): number {
  if (!Number.isFinite(v)) return 0;
  // Guardrail: some imported rows store rates as whole-number percent (e.g., 34.4 instead of 0.344)
  if (Math.abs(v) > 1) return v / 100;
  return v;
}

function normalizeProjectedRate(v: number): number {
  if (!Number.isFinite(v)) return 0;
  // Defensive post-calc guardrail to prevent writing scaled percentages as raw rates.
  if (Math.abs(v) > 2) return v / 100;
  return v;
}

function readSpecificPlus(v: number | null | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}


function normalizeClassTransition(raw?: string | null): string {
  const value = (raw || "").trim().toUpperCase();
  if (!value) return "SJ";
  if (["FS", "SJ", "JS", "GR"].includes(value)) return value;
  if (value.includes("FRESHMAN") || value.includes("FS")) return "FS";
  if (value.includes("SOPHOMORE") || value.includes("SJ")) return "SJ";
  if (value.includes("JUNIOR") || value.includes("JS")) return "JS";
  if (value.includes("GRAD") || value.includes("GR")) return "GR";
  return "SJ";
}

async function loadEngineConfig(): Promise<EngineConfig> {
  const { data, error } = await supabase
    .from("model_config")
    .select("model_type, config_key, config_value");

  if (error) throw error;

  const returnerRows = (data || []).filter((row) => row.model_type === "returner");
  const transferRows = (data || []).filter((row) => row.model_type === "transfer");

  const returner: ReturnerConfig = {
    ncaaAvg: 0.28,
    ncaaObp: 0.385,
    ncaaIso: 0.162,
    baStdPower: 31.297,
    baStdNcaa: 0.043455,
    obpStdPower: 28.889,
    obpStdNcaa: 0.046781,
    ncaaPR: 100,
    powerWeight: 0.7,
    ncaaWrc: 0.364,
    classBases: {
      FS: { avg: 0.03, obp: 0.03, iso: 0.045 },
      SJ: { avg: 0.02, obp: 0.02, iso: 0.03 },
      JS: { avg: 0.015, obp: 0.015, iso: 0.02 },
      GR: { avg: 0.01, obp: 0.01, iso: 0.01 },
    },
    devCoeffs: { avg: 0.06, obp: 0.06, iso: 0.08 },
    isoStdNcaa: 0.07849797197,
    isoStdPower: 45.423,
    wrcWeights: { ...DEFAULT_WRC_WEIGHTS },
    defaultDevAgg: 0,
    baDampTier1Max: 0.35,
    baDampTier2Max: 0.38,
    baDampTier3Max: 0.42,
    baDampTier1Impact: 1.0,
    baDampTier2Impact: 0.9,
    baDampTier3Impact: 0.7,
    baDampTier4Impact: 0.4,
    obpDampTier1Max: 0.455,
    obpDampTier2Max: 0.485,
    obpDampTier3Max: 0.525,
    obpDampTier1Impact: 1.0,
    obpDampTier2Impact: 0.9,
    obpDampTier3Impact: 0.7,
    obpDampTier4Impact: 0.4,
  };

  for (const row of returnerRows) {
    const k = row.config_key;
    const v = Number(row.config_value);
    if (k === "ncaa_avg") returner.ncaaAvg = toStatRate(v);
    else if (k === "ncaa_obp") returner.ncaaObp = toStatRate(v);
    else if (k === "ncaa_iso") returner.ncaaIso = toStatRate(v);
    else if (k === "ba_std_power") returner.baStdPower = v;
    else if (k === "ba_std_ncaa") returner.baStdNcaa = toStatRate(v);
    else if (k === "obp_std_power") returner.obpStdPower = v;
    else if (k === "obp_std_ncaa") returner.obpStdNcaa = toStatRate(v);
    // Keep returner constants locked to Admin equation spec for this phase.
    else if (k === "ncaa_power_rating") { /* locked at 100 */ }
    else if (k === "power_rating_weight") { /* locked at 0.7 */ }
    else if (k === "ncaa_wrc" || k === "wrc_plus_ncaa_avg") returner.ncaaWrc = toStatRate(v);
    else if (k === "iso_std_ncaa") returner.isoStdNcaa = toStatRate(v);
    else if (k === "iso_std_power") returner.isoStdPower = v;
    else if (k === "dev_aggressiveness_expected") returner.defaultDevAgg = v;
    else if (k.startsWith("class_base_")) {
      const parts = k.replace("class_base_", "").split("_");
      const cls = parts[0]?.toUpperCase();
      const rawStat = parts[1];
      const stat = (rawStat === "slg" ? "iso" : rawStat) as "avg" | "obp" | "iso";
      if (!cls || !["avg", "obp", "iso"].includes(stat)) continue;
      if (!returner.classBases[cls]) returner.classBases[cls] = { avg: 0.01, obp: 0.01, iso: 0.01 };
      returner.classBases[cls][stat] = toRate(v);
    } else if (k.startsWith("dev_coeff_")) {
      const rawStat = k.replace("dev_coeff_", "");
      const stat = (rawStat === "slg" ? "iso" : rawStat) as "avg" | "obp" | "iso";
      if (["avg", "obp", "iso"].includes(stat)) returner.devCoeffs[stat] = toRate(v);
    } else if (k.startsWith("wrc_weight_")) {
      const stat = k.replace("wrc_weight_", "") as "obp" | "slg" | "avg" | "iso";
      if (["obp", "slg", "avg", "iso"].includes(stat)) returner.wrcWeights[stat] = toWeight(v);
    }
  }

  // Prefer equation values saved in Admin UI local storage (current source of truth for testing phase).
  const local = readLocalEquationValues();
  const n = (key: string) => Number(local[key]);
  const applyIfFinite = (value: number, apply: (v: number) => void) => {
    if (Number.isFinite(value)) apply(value);
  };
  applyIfFinite(n("r_ncaa_avg_ba"), (v) => { returner.ncaaAvg = toStatRate(v); });
  applyIfFinite(n("r_ba_std_pr"), (v) => { returner.baStdPower = v; });
  applyIfFinite(n("r_ba_std_ncaa"), (v) => { returner.baStdNcaa = toStatRate(v); });
  applyIfFinite(n("r_obp_std_pr"), (v) => { returner.obpStdPower = v; });
  applyIfFinite(n("r_obp_std_ncaa"), (v) => { returner.obpStdNcaa = toStatRate(v); });
  applyIfFinite(n("r_ncaa_avg_obp"), (v) => { returner.ncaaObp = toStatRate(v); });
  applyIfFinite(n("r_ncaa_avg_iso"), (v) => { returner.ncaaIso = toStatRate(v); });
  applyIfFinite(n("r_ncaa_avg_wrc"), (v) => {
    const normalized = toStatRate(v);
    // Guardrail: NCAA wRC baseline is a rate (~0.364), not an index (1.000).
    // Ignore out-of-range values that would destabilize wRC+ and oWAR.
    if (normalized > 0 && normalized < 0.8) returner.ncaaWrc = normalized;
  });
  applyIfFinite(n("r_w_obp"), (v) => { returner.wrcWeights.obp = toWeight(v); });
  applyIfFinite(n("r_w_slg"), (v) => { returner.wrcWeights.slg = toWeight(v); });
  applyIfFinite(n("r_w_avg"), (v) => { returner.wrcWeights.avg = toWeight(v); });
  applyIfFinite(n("r_w_iso"), (v) => { returner.wrcWeights.iso = toWeight(v); });
  applyIfFinite(n("r_ba_class_fs"), (v) => { returner.classBases.FS.avg = toRate(v); });
  applyIfFinite(n("r_ba_class_sj"), (v) => { returner.classBases.SJ.avg = toRate(v); });
  applyIfFinite(n("r_ba_class_js"), (v) => { returner.classBases.JS.avg = toRate(v); });
  applyIfFinite(n("r_ba_class_gr"), (v) => { returner.classBases.GR.avg = toRate(v); });
  applyIfFinite(n("r_obp_class_fs"), (v) => { returner.classBases.FS.obp = toRate(v); });
  applyIfFinite(n("r_obp_class_sj"), (v) => { returner.classBases.SJ.obp = toRate(v); });
  applyIfFinite(n("r_obp_class_js"), (v) => { returner.classBases.JS.obp = toRate(v); });
  applyIfFinite(n("r_obp_class_gr"), (v) => { returner.classBases.GR.obp = toRate(v); });
  applyIfFinite(n("r_iso_class_fs"), (v) => { returner.classBases.FS.iso = toRate(v); });
  applyIfFinite(n("r_iso_class_sj"), (v) => { returner.classBases.SJ.iso = toRate(v); });
  applyIfFinite(n("r_iso_class_js"), (v) => { returner.classBases.JS.iso = toRate(v); });
  applyIfFinite(n("r_iso_class_gr"), (v) => { returner.classBases.GR.iso = toRate(v); });
  applyIfFinite(n("r_ba_damp_tier1_max"), (v) => { returner.baDampTier1Max = toStatRate(v); });
  applyIfFinite(n("r_ba_damp_tier2_max"), (v) => { returner.baDampTier2Max = toStatRate(v); });
  applyIfFinite(n("r_ba_damp_tier3_max"), (v) => { returner.baDampTier3Max = toStatRate(v); });
  applyIfFinite(n("r_ba_damp_tier1_impact"), (v) => { returner.baDampTier1Impact = toWeight(v); });
  applyIfFinite(n("r_ba_damp_tier2_impact"), (v) => { returner.baDampTier2Impact = toWeight(v); });
  applyIfFinite(n("r_ba_damp_tier3_impact"), (v) => { returner.baDampTier3Impact = toWeight(v); });
  applyIfFinite(n("r_ba_damp_tier4_impact"), (v) => { returner.baDampTier4Impact = toWeight(v); });
  applyIfFinite(n("r_obp_damp_tier1_max"), (v) => { returner.obpDampTier1Max = toStatRate(v); });
  applyIfFinite(n("r_obp_damp_tier2_max"), (v) => { returner.obpDampTier2Max = toStatRate(v); });
  applyIfFinite(n("r_obp_damp_tier3_max"), (v) => { returner.obpDampTier3Max = toStatRate(v); });
  applyIfFinite(n("r_obp_damp_tier1_impact"), (v) => { returner.obpDampTier1Impact = toWeight(v); });
  applyIfFinite(n("r_obp_damp_tier2_impact"), (v) => { returner.obpDampTier2Impact = toWeight(v); });
  applyIfFinite(n("r_obp_damp_tier3_impact"), (v) => { returner.obpDampTier3Impact = toWeight(v); });
  applyIfFinite(n("r_obp_damp_tier4_impact"), (v) => { returner.obpDampTier4Impact = toWeight(v); });

  const transfer: TransferConfig = {
    baNcaaAvg: 0.28,
    obpNcaaAvg: 0.385,
    isoNcaaAvg: 0.162,
    baStdPower: 31.297,
    baStdNcaa: 0.043455,
    obpStdPower: 28.889,
    obpStdNcaa: 0.046781,
    baPowerWeight: 0.7,
    obpPowerWeight: 0.7,
    baConferenceWeight: 1,
    obpConferenceWeight: 1,
    isoConferenceWeight: 0.25,
    baPitchingWeight: 1,
    obpPitchingWeight: 1,
    isoPitchingWeight: 1,
    baParkWeight: 1,
    obpParkWeight: 1,
    isoParkWeight: 0.05,
    isoStdNcaa: 0.07849797197,
    isoStdPower: 45.423,
    wrcWeights: { ...DEFAULT_WRC_WEIGHTS },
    ncaaWrc: 0.364,
  };

  for (const row of transferRows) {
    const k = row.config_key;
    const v = Number(row.config_value);
    if (k === "ncaa_avg") transfer.baNcaaAvg = toStatRate(v);
    else if (k === "ncaa_obp") transfer.obpNcaaAvg = toStatRate(v);
    else if (k === "ncaa_iso") transfer.isoNcaaAvg = toStatRate(v);
    else if (k === "ba_std_power") transfer.baStdPower = v;
    else if (k === "ba_std_ncaa") transfer.baStdNcaa = toStatRate(v);
    else if (k === "obp_std_power") transfer.obpStdPower = v;
    else if (k === "obp_std_ncaa") transfer.obpStdNcaa = toStatRate(v);
    else if (k === "ncaa_wrc" || k === "wrc_plus_ncaa_avg") transfer.ncaaWrc = toStatRate(v);
    else if (k === "ba_power_weight" || k === "power_rating_weight") transfer.baPowerWeight = v;
    else if (k === "obp_power_weight") transfer.obpPowerWeight = v;
    else if (k === "ba_conference_weight" || k === "conference_weight") transfer.baConferenceWeight = v;
    else if (k === "obp_conference_weight") transfer.obpConferenceWeight = v;
    else if (k === "iso_conference_weight") transfer.isoConferenceWeight = v;
    else if (k === "ba_pitching_weight" || k === "pitching_weight") transfer.baPitchingWeight = v;
    else if (k === "obp_pitching_weight") transfer.obpPitchingWeight = v;
    else if (k === "iso_pitching_weight") transfer.isoPitchingWeight = v;
    else if (k === "ba_park_weight" || k === "park_weight") transfer.baParkWeight = v;
    else if (k === "obp_park_weight") transfer.obpParkWeight = v;
    else if (k === "iso_park_weight") transfer.isoParkWeight = v;
    else if (k === "iso_std_ncaa") transfer.isoStdNcaa = v;
    else if (k === "iso_std_power") transfer.isoStdPower = v;
    else if (k.startsWith("wrc_weight_")) {
      const stat = k.replace("wrc_weight_", "") as "obp" | "slg" | "avg" | "iso";
      if (["obp", "slg", "avg", "iso"].includes(stat)) transfer.wrcWeights[stat] = v;
    }
  }

  applyIfFinite(n("t_ba_ncaa_avg"), (v) => { transfer.baNcaaAvg = toStatRate(v); });
  applyIfFinite(n("t_obp_ncaa_avg"), (v) => { transfer.obpNcaaAvg = toStatRate(v); });
  applyIfFinite(n("t_iso_ncaa_avg"), (v) => { transfer.isoNcaaAvg = toStatRate(v); });
  applyIfFinite(n("t_ba_std_pr"), (v) => { transfer.baStdPower = v; });
  applyIfFinite(n("t_ba_std_ncaa"), (v) => { transfer.baStdNcaa = toStatRate(v); });
  applyIfFinite(n("t_obp_std_pr"), (v) => { transfer.obpStdPower = v; });
  applyIfFinite(n("t_obp_std_ncaa"), (v) => { transfer.obpStdNcaa = toStatRate(v); });
  applyIfFinite(n("t_ba_power_weight"), (v) => { transfer.baPowerWeight = toRate(v); });
  applyIfFinite(n("t_obp_power_weight"), (v) => { transfer.obpPowerWeight = toRate(v); });
  applyIfFinite(n("t_ba_conference_weight"), (v) => { transfer.baConferenceWeight = v; });
  applyIfFinite(n("t_obp_conference_weight"), (v) => { transfer.obpConferenceWeight = v; });
  applyIfFinite(n("t_iso_conference_weight"), (v) => { transfer.isoConferenceWeight = v; });
  applyIfFinite(n("t_ba_pitching_weight"), (v) => { transfer.baPitchingWeight = v; });
  applyIfFinite(n("t_obp_pitching_weight"), (v) => { transfer.obpPitchingWeight = v; });
  applyIfFinite(n("t_iso_pitching_weight"), (v) => { transfer.isoPitchingWeight = v; });
  applyIfFinite(n("t_ba_park_weight"), (v) => { transfer.baParkWeight = v; });
  applyIfFinite(n("t_obp_park_weight"), (v) => { transfer.obpParkWeight = v; });
  applyIfFinite(n("t_iso_park_weight"), (v) => { transfer.isoParkWeight = v; });
  applyIfFinite(n("t_iso_std_ncaa"), (v) => { transfer.isoStdNcaa = toStatRate(v); });
  applyIfFinite(n("t_iso_std_power"), (v) => { transfer.isoStdPower = v; });
  applyIfFinite(n("t_w_obp"), (v) => { transfer.wrcWeights.obp = toWeight(v); });
  applyIfFinite(n("t_w_slg"), (v) => { transfer.wrcWeights.slg = toWeight(v); });
  applyIfFinite(n("t_w_avg"), (v) => { transfer.wrcWeights.avg = toWeight(v); });
  applyIfFinite(n("t_w_iso"), (v) => { transfer.wrcWeights.iso = toWeight(v); });
  applyIfFinite(n("t_wrc_plus_ncaa_avg"), (v) => {
    const normalized = toStatRate(v);
    if (normalized > 0 && normalized < 0.8) transfer.ncaaWrc = normalized;
  });

  return { returner, transfer };
}

function recalcReturner(
  pred: PredictionRow,
  config: ReturnerConfig,
  powerContext?: ReturnerPowerContext,
  overrides?: UpdateFields,
) {
  const ct = normalizeClassTransition(overrides?.class_transition || pred.class_transition || "SJ");
  const rawDevAgg = overrides?.dev_aggressiveness ?? pred.dev_aggressiveness ?? config.defaultDevAgg;
  const devAgg = Number.isFinite(Number(rawDevAgg)) ? Number(rawDevAgg) : config.defaultDevAgg;
  const bases = config.classBases[ct] || config.classBases.GR || { avg: 0.01, obp: 0.01, iso: 0.01 };
  const fromAvg = normalizeRateInput(Number(pred.from_avg));
  const fromObp = normalizeRateInput(Number(pred.from_obp));
  const fromSlg = normalizeRateInput(Number(pred.from_slg));
  const baPlus = powerContext?.baPlus ?? null;
  const obpPlus = powerContext?.obpPlus ?? null;
  const isoPlus = powerContext?.isoPlus ?? null;
  const avgProjectedTierDamp = (projectedAvg: number) => {
    if (projectedAvg <= config.baDampTier1Max) return config.baDampTier1Impact;
    if (projectedAvg <= config.baDampTier2Max) return config.baDampTier2Impact;
    if (projectedAvg <= config.baDampTier3Max) return config.baDampTier3Impact;
    return config.baDampTier4Impact;
  };
  const obpProjectedTierDamp = (projectedObp: number) => {
    if (projectedObp <= config.obpDampTier1Max) return config.obpDampTier1Impact;
    if (projectedObp <= config.obpDampTier2Max) return config.obpDampTier2Impact;
    if (projectedObp <= config.obpDampTier3Max) return config.obpDampTier3Impact;
    return config.obpDampTier4Impact;
  };

  const pAvg = baPlus == null
    ? null
    : (() => {
      const safeBaStdPower = config.baStdPower === 0 ? 1 : config.baStdPower;
      const scaledBa = config.ncaaAvg + (((baPlus - config.ncaaPR) / safeBaStdPower) * config.baStdNcaa);
      const baBlended = (fromAvg * (1 - config.powerWeight)) + (scaledBa * config.powerWeight);
      const baProjected = baBlended * (1 + bases.avg + (devAgg * config.devCoeffs.avg));
      const baDelta = baProjected - fromAvg;
      return round3(normalizeProjectedRate(fromAvg + (baDelta * avgProjectedTierDamp(baProjected))));
    })();

  const pObp = obpPlus == null
    ? null
    : (() => {
      const safeObpStdPower = config.obpStdPower === 0 ? 1 : config.obpStdPower;
      const scaledObp = config.ncaaObp + (((obpPlus - config.ncaaPR) / safeObpStdPower) * config.obpStdNcaa);
      const obpBlended = (fromObp * (1 - config.powerWeight)) + (scaledObp * config.powerWeight);
      const obpProjected = obpBlended * (1 + bases.obp + (devAgg * config.devCoeffs.obp));
      const obpDelta = obpProjected - fromObp;
      return round3(normalizeProjectedRate(fromObp + (obpDelta * obpProjectedTierDamp(obpProjected))));
    })();

  const pIso = isoPlus == null
    ? null
    : (() => {
      const lastIso = fromSlg - fromAvg;
      const scaledIso = config.ncaaIso + (((isoPlus - config.ncaaPR) / config.isoStdPower) * config.isoStdNcaa);
      const blendedIso = (lastIso * (1 - config.powerWeight)) + (scaledIso * config.powerWeight);
      return round3(normalizeProjectedRate(blendedIso * (1 + bases.iso + (devAgg * config.devCoeffs.iso))));
    })();

  const pSlg = pAvg == null || pIso == null ? null : round3(normalizeProjectedRate(pAvg + pIso));
  const pOps = pObp == null || pSlg == null ? null : round3(normalizeProjectedRate(pObp + pSlg));
  const pWrc = pObp == null || pSlg == null || pAvg == null || pIso == null
    ? null
    : round3((config.wrcWeights.obp * pObp) + (config.wrcWeights.slg * pSlg) + (config.wrcWeights.avg * pAvg) + (config.wrcWeights.iso * pIso));
  const pWrcPlus = pWrc == null ? null : Math.round((pWrc / config.ncaaWrc) * 100);

  return {
    p_avg: pAvg,
    p_obp: pObp,
    p_slg: pSlg,
    p_ops: pOps,
    p_iso: pIso,
    p_wrc: pWrc,
    p_wrc_plus: pWrcPlus,
    class_transition: ct,
    dev_aggressiveness: devAgg,
  };
}

function recalcTransfer(pred: PredictionRow, config: TransferConfig) {
  const fromAvgRaw = normalizeRateInput(Number(pred.from_avg));
  const fromObpRaw = normalizeRateInput(Number(pred.from_obp));
  const fromSlgRaw = normalizeRateInput(Number(pred.from_slg));
  const prPlusRaw = Number(pred.power_rating_plus);
  const fromAvgPlusRaw = Number(pred.from_avg_plus);
  const toAvgPlusRaw = Number(pred.to_avg_plus);
  const fromObpPlusRaw = Number(pred.from_obp_plus);
  const toObpPlusRaw = Number(pred.to_obp_plus);
  const fromSlgPlusRaw = Number(pred.from_slg_plus);
  const toSlgPlusRaw = Number(pred.to_slg_plus);
  const fromStuffRaw = Number(pred.from_stuff_plus);
  const toStuffRaw = Number(pred.to_stuff_plus);
  const fromParkRaw = Number(pred.from_park_factor);
  const toParkRaw = Number(pred.to_park_factor);

  if (!Number.isFinite(fromAvgRaw) || !Number.isFinite(fromObpRaw) || !Number.isFinite(fromSlgRaw)) {
    return { p_avg: null, p_obp: null, p_slg: null, p_ops: null, p_iso: null, p_wrc: null, p_wrc_plus: null };
  }

  const fromAvg = fromAvgRaw;
  const fromObp = fromObpRaw;
  const fromSlg = fromSlgRaw;
  const prPlus = Number.isFinite(prPlusRaw) ? prPlusRaw : 100;
  const fromAvgPlus = Number.isFinite(fromAvgPlusRaw) ? fromAvgPlusRaw : 100;
  const toAvgPlus = Number.isFinite(toAvgPlusRaw) ? toAvgPlusRaw : fromAvgPlus;
  const fromObpPlus = Number.isFinite(fromObpPlusRaw) ? fromObpPlusRaw : 100;
  const toObpPlus = Number.isFinite(toObpPlusRaw) ? toObpPlusRaw : fromObpPlus;
  const fromSlgPlus = Number.isFinite(fromSlgPlusRaw) ? fromSlgPlusRaw : 100;
  const toSlgPlus = Number.isFinite(toSlgPlusRaw) ? toSlgPlusRaw : fromSlgPlus;
  const fromStuff = Number.isFinite(fromStuffRaw) ? fromStuffRaw : 100;
  const toStuff = Number.isFinite(toStuffRaw) ? toStuffRaw : fromStuff;
  const fromPark = Number.isFinite(fromParkRaw) ? fromParkRaw : 100;
  const toPark = Number.isFinite(toParkRaw) ? toParkRaw : fromPark;

  const safeBaStdPower = config.baStdPower === 0 ? 1 : config.baStdPower;
  const baPowerAdj = config.baNcaaAvg + (((prPlus - 100) / safeBaStdPower) * config.baStdNcaa);
  const baBlended = fromAvg * (1 - config.baPowerWeight) + baPowerAdj * config.baPowerWeight;
  const baMultiplier =
    1 +
    (config.baConferenceWeight * ((toAvgPlus - fromAvgPlus) / 100)) -
    (config.baPitchingWeight * ((toStuff - fromStuff) / 100)) +
    (config.baParkWeight * ((toPark - fromPark) / 100));
  const pAvg = round3(normalizeProjectedRate(baBlended * baMultiplier));

  const safeObpStdPower = config.obpStdPower === 0 ? 1 : config.obpStdPower;
  const obpPowerAdj = config.obpNcaaAvg + (((prPlus - 100) / safeObpStdPower) * config.obpStdNcaa);
  const obpBlended = fromObp * (1 - config.obpPowerWeight) + obpPowerAdj * config.obpPowerWeight;
  const obpMultiplier =
    1 +
    (config.obpConferenceWeight * ((toObpPlus - fromObpPlus) / 100)) -
    (config.obpPitchingWeight * ((toStuff - fromStuff) / 100)) +
    (config.obpParkWeight * ((toPark - fromPark) / 100));
  const pObp = round3(normalizeProjectedRate(obpBlended * obpMultiplier));

  const lastIso = fromSlg - fromAvg;
  const ratingZ = config.isoStdPower > 0 ? (prPlus - 100) / config.isoStdPower : 0;
  const scaledIso = config.isoNcaaAvg + (ratingZ * config.isoStdNcaa);
  const isoBlended = (lastIso * (1 - 0.3)) + (scaledIso * 0.3);
  const isoMultiplier =
    1 +
    (config.isoConferenceWeight * ((toSlgPlus - fromSlgPlus) / 100)) -
    (config.isoPitchingWeight * ((toStuff - fromStuff) / 100)) +
    (config.isoParkWeight * ((toPark - fromPark) / 100));
  const pIso = round3(normalizeProjectedRate(isoBlended * isoMultiplier));

  const pSlg = round3(normalizeProjectedRate(pAvg + pIso));
  const pOps = round3(normalizeProjectedRate(pObp + pSlg));
  const pWrc = round3((config.wrcWeights.obp * pObp) + (config.wrcWeights.slg * pSlg) + (config.wrcWeights.avg * pAvg) + (config.wrcWeights.iso * pIso));
  const pWrcPlus = config.ncaaWrc === 0 ? null : Math.round((pWrc / config.ncaaWrc) * 100);

  return {
    p_avg: pAvg,
    p_obp: pObp,
    p_slg: pSlg,
    p_ops: pOps,
    p_iso: pIso,
    p_wrc: pWrc,
    p_wrc_plus: pWrcPlus,
  };
}

function calculatePrediction(pred: PredictionRow, config: EngineConfig, overrides?: UpdateFields) {
  if (pred.model_type === "transfer") return recalcTransfer(pred, config.transfer);
  return recalcReturner(pred, config.returner, undefined, overrides);
}

async function fetchAllPredictionsForReturnerMode(): Promise<PredictionRow[]> {
  const out: PredictionRow[] = [];
  const pageSize = 1000;

  for (let page = 0; ; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from("player_predictions")
      .select("*")
      .in("model_type", ["returner", "transfer"])
      .in("status", ["active", "departed"])
      .range(from, to);

    if (error) throw error;
    const rows = (data || []) as PredictionRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out;
}

export async function recalculatePredictionById(predictionId: string, updates: UpdateFields = {}) {
  const config = await loadEngineConfig();

  const { data: pred, error: predErr } = await supabase
    .from("player_predictions")
    .select("*")
    .eq("id", predictionId)
    .single();
  if (predErr || !pred) throw predErr || new Error("Prediction not found");

  const merged = { ...(pred as PredictionRow), ...updates };
  let powerContext: ReturnerPowerContext | undefined;
  if (merged.model_type === "returner") {
    const { data: internal } = await supabase
      .from("player_prediction_internals")
      .select("avg_power_rating, obp_power_rating, slg_power_rating")
      .eq("prediction_id", predictionId)
      .maybeSingle();
    const manual = MANUAL_INTERNAL_OVERRIDES[predictionId];
    powerContext = {
      baPlus: readSpecificPlus(internal?.avg_power_rating) ?? manual?.baPlus ?? null,
      obpPlus: readSpecificPlus(internal?.obp_power_rating) ?? manual?.obpPlus ?? null,
      isoPlus: readSpecificPlus(internal?.slg_power_rating) ?? manual?.isoPlus ?? null,
    };
  }
  const result = merged.model_type === "returner"
    ? recalcReturner(merged, config.returner, powerContext, updates)
    : recalcTransfer(merged, config.transfer);

  const { error: unlockErr } = await supabase
    .from("player_predictions")
    .update({ locked: false })
    .eq("id", predictionId);
  if (unlockErr) throw unlockErr;

  const { error: updateErr } = await supabase
    .from("player_predictions")
    .update({ ...updates, ...result, locked: true })
    .eq("id", predictionId);
  if (updateErr) throw updateErr;

  return { success: true, prediction: result };
}

export async function bulkRecalculatePredictionsLocal() {
  const config = await loadEngineConfig();
  const preds = await fetchAllPredictionsForReturnerMode();

  let updated = 0;
  let errors = 0;
  let updatedReturner = 0;
  let updatedTransfer = 0;
  const BATCH = 40;

  for (let i = 0; i < preds.length; i += BATCH) {
    const batch = preds.slice(i, i + BATCH);
    const batchIds = batch.map((p) => p.id);
    const { data: internals } = await supabase
      .from("player_prediction_internals")
      .select("prediction_id, avg_power_rating, obp_power_rating, slg_power_rating")
      .in("prediction_id", batchIds);
    const internalByPredictionId = new Map<string, { avg_power_rating: number | null; obp_power_rating: number | null; slg_power_rating: number | null }>();
    for (const row of (internals || [])) {
      internalByPredictionId.set(row.prediction_id, row as { avg_power_rating: number | null; obp_power_rating: number | null; slg_power_rating: number | null });
    }

    await Promise.all(
      batch.map(async (pred) => {
        try {
          let result: ReturnType<typeof recalcReturner> | ReturnType<typeof recalcTransfer>;
          if (pred.model_type === "transfer") {
            result = recalcTransfer(pred, config.transfer);
          } else {
            const internal = internalByPredictionId.get(pred.id);
            const manual = MANUAL_INTERNAL_OVERRIDES[pred.id];
            const powerContext: ReturnerPowerContext = {
              baPlus: readSpecificPlus(internal?.avg_power_rating) ?? manual?.baPlus ?? null,
              obpPlus: readSpecificPlus(internal?.obp_power_rating) ?? manual?.obpPlus ?? null,
              isoPlus: readSpecificPlus(internal?.slg_power_rating) ?? manual?.isoPlus ?? null,
            };
            result = recalcReturner(pred, config.returner, powerContext);
          }
          await supabase.from("player_predictions").update({ locked: false }).eq("id", pred.id);
          const { error } = await supabase
            .from("player_predictions")
            .update({ ...result, locked: true })
            .eq("id", pred.id);

          if (error) {
            errors += 1;
            return;
          }

          updated += 1;
          if (pred.model_type === "transfer") updatedTransfer += 1;
          else updatedReturner += 1;
        } catch {
          errors += 1;
        }
      }),
    );
  }

  return { success: true, updated, updated_returner: updatedReturner, updated_transfer: updatedTransfer, errors, total: preds.length };
}
