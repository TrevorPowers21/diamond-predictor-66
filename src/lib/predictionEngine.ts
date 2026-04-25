import { supabase } from "@/integrations/supabase/client";
import { loadEquationWeightsMap } from "@/hooks/useEquationWeights";
import { TRANSFER_WEIGHT_DEFAULTS } from "@/lib/transferWeightDefaults";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { fetchParkFactorsMap, type ParkFactorsMap } from "@/lib/parkFactors";
import { computePitcherProjection, type PitcherProjectionInput } from "@/lib/pitcherProjection";
import { PITCHING_EQ_DEFAULTS } from "@/hooks/usePitchingEquationWeights";

type PredictionRow = {
  id: string;
  player_id?: string | null;
  model_type: "returner" | "transfer" | string;
  status: string | null;
  class_transition?: string | null;
  dev_aggressiveness?: number | null;
  from_avg?: number | null;
  from_obp?: number | null;
  from_slg?: number | null;
  // Pitcher inputs (present when prediction is for a pitcher)
  from_era?: number | null;
  from_fip?: number | null;
  from_whip?: number | null;
  from_k9?: number | null;
  from_bb9?: number | null;
  from_hr9?: number | null;
  pitcher_role?: string | null;
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

const isPitcherPred = (pred: PredictionRow) =>
  pred.from_era != null && Number.isFinite(Number(pred.from_era));

type UpdateFields = {
  class_transition?: string;
  dev_aggressiveness?: number;
  pitcher_role?: "SP" | "RP" | "SM" | null;
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
  // Load from "Equation Weights" table (primary), fall back to "model_config" (legacy)
  let eqWeights: Map<string, number>;
  try {
    eqWeights = await loadEquationWeightsMap(2025);
  } catch {
    eqWeights = new Map();
  }
  const eq = (key: string) => eqWeights.get(key) ?? eqWeights.get(key.toLowerCase());

  const { data, error } = await supabase
    .from("model_config")
    .select("model_type, config_key, config_value");

  if (error && eqWeights.size === 0) throw error;

  const returnerRows = ((data || []) as any[]).filter((row) => row.model_type === "returner");
  const transferRows = ((data || []) as any[]).filter((row) => row.model_type === "transfer");

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

  // Override with "Equation Weights" table values (Supabase, primary source)
  if (eqWeights.size > 0) {
    const eqn = (key: string) => eq(key);
    const applyEq = (key: string, apply: (v: number) => void) => {
      const v = eqn(key);
      if (v != null && Number.isFinite(v)) apply(v);
    };
    applyEq("ncaa_avg_ba", (v) => { returner.ncaaAvg = toStatRate(v); });
    applyEq("ba_std_power", (v) => { returner.baStdPower = v; });
    applyEq("ba_std_ncaa", (v) => { returner.baStdNcaa = toStatRate(v); });
    applyEq("obp_std_power", (v) => { returner.obpStdPower = v; });
    applyEq("obp_std_ncaa", (v) => { returner.obpStdNcaa = toStatRate(v); });
    applyEq("ncaa_avg_obp", (v) => { returner.ncaaObp = toStatRate(v); });
    applyEq("ncaa_avg_iso", (v) => { returner.ncaaIso = toStatRate(v); });
    applyEq("ncaa_avg_wrc", (v) => {
      const normalized = toStatRate(v);
      if (normalized > 0 && normalized < 0.8) returner.ncaaWrc = normalized;
    });
    applyEq("iso_std_ncaa", (v) => { returner.isoStdNcaa = toStatRate(v); });
    applyEq("iso_std_power", (v) => { returner.isoStdPower = v; });
    applyEq("w_obp", (v) => { returner.wrcWeights.obp = toWeight(v); });
    applyEq("w_slg", (v) => { returner.wrcWeights.slg = toWeight(v); });
    applyEq("w_avg", (v) => { returner.wrcWeights.avg = toWeight(v); });
    applyEq("w_iso", (v) => { returner.wrcWeights.iso = toWeight(v); });
  }


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
    baConferenceWeight: TRANSFER_WEIGHT_DEFAULTS.t_ba_conference_weight,
    obpConferenceWeight: TRANSFER_WEIGHT_DEFAULTS.t_obp_conference_weight,
    isoConferenceWeight: TRANSFER_WEIGHT_DEFAULTS.t_iso_conference_weight,
    baPitchingWeight: TRANSFER_WEIGHT_DEFAULTS.t_ba_pitching_weight,
    obpPitchingWeight: TRANSFER_WEIGHT_DEFAULTS.t_obp_pitching_weight,
    isoPitchingWeight: TRANSFER_WEIGHT_DEFAULTS.t_iso_pitching_weight,
    baParkWeight: TRANSFER_WEIGHT_DEFAULTS.t_ba_park_weight,
    obpParkWeight: TRANSFER_WEIGHT_DEFAULTS.t_obp_park_weight,
    isoParkWeight: TRANSFER_WEIGHT_DEFAULTS.t_iso_park_weight,
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

  return { returner, transfer };
}

function recalcReturner(
  pred: PredictionRow,
  config: ReturnerConfig,
  powerContext?: ReturnerPowerContext,
  overrides?: UpdateFields,
  combinedUsed?: boolean,
) {
  const ct = normalizeClassTransition(overrides?.class_transition || pred.class_transition || "SJ");
  const rawDevAgg = overrides?.dev_aggressiveness ?? pred.dev_aggressiveness ?? config.defaultDevAgg;
  const devAgg = Number.isFinite(Number(rawDevAgg)) ? Number(rawDevAgg) : config.defaultDevAgg;
  const bases = config.classBases[ct] || config.classBases.GR || { avg: 0.01, obp: 0.01, iso: 0.01 };
  // Low-sample players: bump power weight from 0.7 → 0.9 to lean harder on
  // their (more stable) scouting ratings rather than their noisy actuals.
  const effectivePowerWeight = combinedUsed ? 0.9 : config.powerWeight;
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
      const baBlended = (fromAvg * (1 - effectivePowerWeight)) + (scaledBa * effectivePowerWeight);
      const baProjected = baBlended * (1 + bases.avg + (devAgg * config.devCoeffs.avg));
      const baDelta = baProjected - fromAvg;
      const result = round3(normalizeProjectedRate(fromAvg + (baDelta * avgProjectedTierDamp(baProjected))));
      return result;
    })();

  const pObp = obpPlus == null
    ? null
    : (() => {
      const safeObpStdPower = config.obpStdPower === 0 ? 1 : config.obpStdPower;
      const scaledObp = config.ncaaObp + (((obpPlus - config.ncaaPR) / safeObpStdPower) * config.obpStdNcaa);
      const obpBlended = (fromObp * (1 - effectivePowerWeight)) + (scaledObp * effectivePowerWeight);
      const obpProjected = obpBlended * (1 + bases.obp + (devAgg * config.devCoeffs.obp));
      const obpDelta = obpProjected - fromObp;
      return round3(normalizeProjectedRate(fromObp + (obpDelta * obpProjectedTierDamp(obpProjected))));
    })();

  const pIso = isoPlus == null
    ? null
    : (() => {
      const lastIso = fromSlg - fromAvg;
      const scaledIso = config.ncaaIso + (((isoPlus - config.ncaaPR) / config.isoStdPower) * config.isoStdNcaa);
      const blendedIso = (lastIso * (1 - effectivePowerWeight)) + (scaledIso * effectivePowerWeight);
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

// ── Pitcher path ───────────────────────────────────────────────────────────

type PitcherScoutingRow = {
  source_player_id: string;
  stuff_plus: number | null;
  miss_pct: number | null;
  bb_pct: number | null;
  hard_hit_pct: number | null;
  in_zone_whiff_pct: number | null;
  chase_pct: number | null;
  barrel_pct: number | null;
  line_pct: number | null;
  exit_vel: number | null;
  ground_pct: number | null;
  in_zone_pct: number | null;
  vel_90th: number | null;
  h_pull_pct: number | null;
  la_10_30_pct: number | null;
  G: number | null;
  GS: number | null;
  Role: string | null;
  Team: string | null;
  TeamID: string | null;
  Conference: string | null;
  // Pipeline-precomputed PR+ values from Pitching Master. These are the primary
  // source for projections (matches PitcherProfile). Only era/fip/whip are
  // pipeline-computed today; k9/bb9/hr9 fall back to live compute from scores.
  era_pr_plus: number | null;
  fip_pr_plus: number | null;
  whip_pr_plus: number | null;
};

type PitcherPlayerContext = {
  team: string | null;
  teamId: string | null;
  conference: string | null;
};

// Pitcher power-rating equation weights (NCAA avgs/SDs + weight constants used
// by computePitchingPrPlusFromScores). Mirrors usePitchingEquationWeights query.
async function loadPitchingPowerEq(season = 2025): Promise<Record<string, number>> {
  const merged: Record<string, number> = { ...PITCHING_EQ_DEFAULTS };
  try {
    const { data } = await supabase
      .from("model_config")
      .select("config_key, config_value")
      .eq("model_type", "admin_ui")
      .eq("season", season);
    for (const row of (data || []) as Array<{ config_key: string | null; config_value: any }>) {
      const key = row.config_key;
      if (key?.startsWith("p_")) {
        const n = Number(row.config_value);
        if (Number.isFinite(n)) merged[key] = n;
      }
    }
  } catch {
    // Fall back to defaults when model_config read fails.
  }
  // Locked constant — keep in sync with usePitchingEquationWeights.
  merged.p_whip_chase_pct_weight = 0.05;
  return merged;
}

const PITCHER_SCOUTING_SELECT =
  "source_player_id, stuff_plus, miss_pct, bb_pct, hard_hit_pct, in_zone_whiff_pct, chase_pct, barrel_pct, line_pct, exit_vel, ground_pct, in_zone_pct, \"90th_vel\", h_pull_pct, la_10_30_pct, G, GS, Role, Team, TeamID, Conference, era_pr_plus, fip_pr_plus, whip_pr_plus";

const mapPitchingMasterRow = (row: any): PitcherScoutingRow => ({
  source_player_id: row.source_player_id,
  stuff_plus: row.stuff_plus ?? null,
  miss_pct: row.miss_pct ?? null,
  bb_pct: row.bb_pct ?? null,
  hard_hit_pct: row.hard_hit_pct ?? null,
  in_zone_whiff_pct: row.in_zone_whiff_pct ?? null,
  chase_pct: row.chase_pct ?? null,
  barrel_pct: row.barrel_pct ?? null,
  line_pct: row.line_pct ?? null,
  exit_vel: row.exit_vel ?? null,
  ground_pct: row.ground_pct ?? null,
  in_zone_pct: row.in_zone_pct ?? null,
  vel_90th: row["90th_vel"] ?? null,
  h_pull_pct: row.h_pull_pct ?? null,
  la_10_30_pct: row.la_10_30_pct ?? null,
  G: row.G ?? null,
  GS: row.GS ?? null,
  Role: row.Role ?? null,
  Team: row.Team ?? null,
  TeamID: row.TeamID ?? null,
  Conference: row.Conference ?? null,
  era_pr_plus: row.era_pr_plus ?? null,
  fip_pr_plus: row.fip_pr_plus ?? null,
  whip_pr_plus: row.whip_pr_plus ?? null,
});

const normalizeRole = (raw: string | null | undefined): "SP" | "RP" | "SM" | null => {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "SP" || v === "RP" || v === "SM") return v;
  return null;
};

type StoredPitcherPrPlus = {
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
};

// Run the shared computePitcherProjection against a prediction row. The engine
// passes the coach-overridden pitcher_role (when present) as roleOverride so
// the projection respects staff decisions. Weight source is readPitchingWeights()
// + loadPitchingPowerEq() — the same sources every surface uses today.
// Stored PR+ values from player_prediction_internals are the primary source
// (mirrors PitcherProfile); live compute is fallback.
function recalcPitcher(
  pred: PredictionRow,
  eq: ReturnType<typeof readPitchingWeights>,
  powerEq: Record<string, number>,
  parkMap: ParkFactorsMap,
  scouting: PitcherScoutingRow | null,
  player: PitcherPlayerContext,
  storedPrPlus: StoredPitcherPrPlus | null,
  coachRoleOverride: "SP" | "RP" | "SM" | null,
  overrides?: UpdateFields,
) {
  const rawClass = overrides?.class_transition ?? pred.class_transition ?? "SJ";
  const ct = normalizeClassTransition(rawClass) as "FS" | "SJ" | "JS" | "GR";
  const rawDev = overrides?.dev_aggressiveness ?? pred.dev_aggressiveness ?? 0;
  const devAggressiveness = Number.isFinite(Number(rawDev)) ? Number(rawDev) : 0;
  // Role override sources, in priority order:
  //   1. Explicit updates from recalculatePredictionById (coach just saved)
  //   2. Coach's persisted override from pitcher_role_overrides table
  //   3. No override — use the detected base role (PitcherProfile's behavior)
  // We do NOT read pred.pitcher_role — that's the engine's own output from the
  // previous run. Reading it back as an override creates a feedback loop where
  // the engine's default ("SM" when base role undetected) gets persisted, then
  // triggers a phantom SP→SM role transition on next recalc.
  const roleOverride = overrides?.pitcher_role !== undefined
    ? normalizeRole(overrides.pitcher_role)
    : normalizeRole(coachRoleOverride ?? null);

  const input: PitcherProjectionInput = {
    era: Number.isFinite(Number(pred.from_era)) ? Number(pred.from_era) : null,
    fip: Number.isFinite(Number(pred.from_fip)) ? Number(pred.from_fip) : null,
    whip: Number.isFinite(Number(pred.from_whip)) ? Number(pred.from_whip) : null,
    k9: Number.isFinite(Number(pred.from_k9)) ? Number(pred.from_k9) : null,
    bb9: Number.isFinite(Number(pred.from_bb9)) ? Number(pred.from_bb9) : null,
    hr9: Number.isFinite(Number(pred.from_hr9)) ? Number(pred.from_hr9) : null,
    stuffPlus: scouting?.stuff_plus ?? null,
    miss_pct: scouting?.miss_pct ?? null,
    bb_pct: scouting?.bb_pct ?? null,
    hard_hit_pct: scouting?.hard_hit_pct ?? null,
    in_zone_whiff_pct: scouting?.in_zone_whiff_pct ?? null,
    chase_pct: scouting?.chase_pct ?? null,
    barrel_pct: scouting?.barrel_pct ?? null,
    line_pct: scouting?.line_pct ?? null,
    exit_vel: scouting?.exit_vel ?? null,
    ground_pct: scouting?.ground_pct ?? null,
    in_zone_pct: scouting?.in_zone_pct ?? null,
    vel_90th: scouting?.vel_90th ?? null,
    h_pull_pct: scouting?.h_pull_pct ?? null,
    la_10_30_pct: scouting?.la_10_30_pct ?? null,
    role: scouting?.Role ?? null,
    g: scouting?.G ?? null,
    gs: scouting?.GS ?? null,
    team: player.team ?? scouting?.Team ?? null,
    teamId: player.teamId ?? scouting?.TeamID ?? null,
    conference: player.conference ?? scouting?.Conference ?? null,
  };

  const result = computePitcherProjection(input, {
    eq,
    powerEq,
    parkMap,
    teamMatch: {
      id: input.teamId,
      name: input.team,
      park_factor: null,
    },
    roleOverride,
    classTransition: ct,
    devAggressiveness,
    storedPrPlus: storedPrPlus ?? undefined,
  });

  return {
    predictionUpdate: {
      p_era: result.p_era,
      p_fip: result.p_fip,
      p_whip: result.p_whip,
      p_k9: result.p_k9,
      p_bb9: result.p_bb9,
      p_hr9: result.p_hr9,
      p_rv_plus: result.p_rv_plus,
      pitcher_role: result.projected_role,
      class_transition: ct,
      dev_aggressiveness: devAggressiveness,
    },
    internalsUpdate: {
      era_power_rating: result.pr_plus.era,
      fip_power_rating: result.pr_plus.fip,
      whip_power_rating: result.pr_plus.whip,
      k9_power_rating: result.pr_plus.k9,
      bb9_power_rating: result.pr_plus.bb9,
      hr9_power_rating: result.pr_plus.hr9,
    },
  };
}

async function fetchPitcherContext(
  predictionId: string,
  pred: PredictionRow,
): Promise<{
  eq: ReturnType<typeof readPitchingWeights>;
  powerEq: Record<string, number>;
  parkMap: ParkFactorsMap;
  scouting: PitcherScoutingRow | null;
  player: PitcherPlayerContext;
  storedPrPlus: StoredPitcherPrPlus | null;
  coachRoleOverride: "SP" | "RP" | "SM" | null;
}> {
  const eq = readPitchingWeights();
  const [powerEq, parkMap, internalsResp] = await Promise.all([
    loadPitchingPowerEq(),
    fetchParkFactorsMap(2025),
    supabase
      .from("player_prediction_internals")
      .select("era_power_rating, fip_power_rating, whip_power_rating, k9_power_rating, bb9_power_rating, hr9_power_rating")
      .eq("prediction_id", predictionId)
      .maybeSingle(),
  ]);

  const internal = internalsResp.data as any;
  const internalsPr = internal
    ? {
        era: internal.era_power_rating ?? null,
        fip: internal.fip_power_rating ?? null,
        whip: internal.whip_power_rating ?? null,
        k9: internal.k9_power_rating ?? null,
        bb9: internal.bb9_power_rating ?? null,
        hr9: internal.hr9_power_rating ?? null,
      }
    : null;

  let scouting: PitcherScoutingRow | null = null;
  let player: PitcherPlayerContext = { team: null, teamId: null, conference: null };
  let coachRoleOverride: "SP" | "RP" | "SM" | null = null;

  if (pred.player_id) {
    const { data: playerRow } = await supabase
      .from("players")
      .select("source_player_id, team, team_id, conference")
      .eq("id", pred.player_id)
      .maybeSingle();
    if (playerRow) {
      player = {
        team: (playerRow as any).team ?? null,
        teamId: (playerRow as any).team_id ?? null,
        conference: (playerRow as any).conference ?? null,
      };
      const sourceId = (playerRow as any).source_player_id;
      if (sourceId) {
        const { data: pm } = await supabase
          .from("Pitching Master")
          .select(PITCHER_SCOUTING_SELECT)
          .eq("source_player_id", sourceId)
          .eq("Season", 2025)
          .maybeSingle();
        if (pm) scouting = mapPitchingMasterRow(pm);
      }
    }

    // Coach role override lives in a separate table, NOT in pred.pitcher_role
    // (which is the engine's own previous output).
    const { data: roleRow } = await supabase
      .from("pitcher_role_overrides")
      .select("role")
      .eq("player_id", pred.player_id)
      .maybeSingle();
    if (roleRow) coachRoleOverride = normalizeRole((roleRow as any).role);
  }

  // Merge stored PR+ sources: Pitching Master first (matches PitcherProfile's
  // primary source), internals second (sparse), live compute third (inside lib).
  const storedPrPlus: StoredPitcherPrPlus = {
    era: scouting?.era_pr_plus ?? internalsPr?.era ?? null,
    fip: scouting?.fip_pr_plus ?? internalsPr?.fip ?? null,
    whip: scouting?.whip_pr_plus ?? internalsPr?.whip ?? null,
    k9: internalsPr?.k9 ?? null,
    bb9: internalsPr?.bb9 ?? null,
    hr9: internalsPr?.hr9 ?? null,
  };

  return { eq, powerEq, parkMap, scouting, player, storedPrPlus, coachRoleOverride };
}

async function fetchAllPredictionsForReturnerMode(): Promise<PredictionRow[]> {
  const out: PredictionRow[] = [];
  const pageSize = 1000;

  for (let page = 0; ; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    // Include hitter rows (from_avg set) AND pitcher rows (from_era set).
    // Stub rows with neither populated are still skipped.
    const { data, error } = await supabase
      .from("player_predictions")
      .select("*")
      .in("model_type", ["returner", "transfer"])
      .in("status", ["active", "departed"])
      .or("from_avg.not.is.null,from_era.not.is.null")
      .range(from, to);

    if (error) throw error;
    const rows = (data || []) as PredictionRow[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out;
}

export async function recalculatePredictionById(predictionId: string, updates: UpdateFields = {}) {
  const { data: pred, error: predErr } = await supabase
    .from("player_predictions")
    .select("*")
    .eq("id", predictionId)
    .single();
  if (predErr || !pred) throw predErr || new Error("Prediction not found");

  const merged = { ...(pred as PredictionRow), ...updates };

  // ─── Pitcher path ───────────────────────────────────────────────────
  if (isPitcherPred(merged)) {
    const { eq, powerEq, parkMap, scouting, player, storedPrPlus, coachRoleOverride } = await fetchPitcherContext(predictionId, merged);
    const { predictionUpdate, internalsUpdate } = recalcPitcher(merged, eq, powerEq, parkMap, scouting, player, storedPrPlus, coachRoleOverride, updates);

    const { error: unlockErr } = await supabase
      .from("player_predictions")
      .update({ locked: false })
      .eq("id", predictionId);
    if (unlockErr) throw unlockErr;

    const extraFields: Record<string, any> = {};
    if (updates.class_transition !== undefined) {
      extraFields.class_transition_overridden = true;
    }
    const { error: updateErr } = await supabase
      .from("player_predictions")
      .update({ ...predictionUpdate, ...extraFields, locked: true })
      .eq("id", predictionId);
    if (updateErr) throw updateErr;

    // Upsert internals (pitcher power ratings) — keyed by prediction_id.
    const { error: internalsErr } = await supabase
      .from("player_prediction_internals")
      .upsert({ prediction_id: predictionId, ...internalsUpdate }, { onConflict: "prediction_id" });
    if (internalsErr) {
      // Non-fatal: predictions succeeded, internals are admin-only visibility.
      console.warn("[recalcPitcher] internals upsert failed:", internalsErr.message);
    }

    return { success: true, prediction: predictionUpdate };
  }

  // ─── Hitter path (unchanged) ────────────────────────────────────────
  const config = await loadEngineConfig();
  let powerContext: ReturnerPowerContext | undefined;
  let combinedUsed = false;
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
    // Look up the player's current-season Hitter Master row to check if
    // combined stats were applied (low-PA player). If yes, the projection
    // engine will bump power weight 0.7 → 0.9 to lean harder on scouting.
    if (merged.player_id) {
      const { data: playerRow } = await supabase
        .from("players")
        .select("source_player_id")
        .eq("id", merged.player_id)
        .maybeSingle();
      const sourceId = (playerRow as any)?.source_player_id;
      if (sourceId) {
        const { data: hm } = await supabase
          .from("Hitter Master")
          .select("combined_used")
          .eq("source_player_id", sourceId)
          .eq("Season", 2025)
          .maybeSingle();
        combinedUsed = !!(hm as any)?.combined_used;
      }
    }
  }
  const result = merged.model_type === "returner"
    ? recalcReturner(merged, config.returner, powerContext, updates, combinedUsed)
    : recalcTransfer(merged, config.transfer);

  const { error: unlockErr } = await supabase
    .from("player_predictions")
    .update({ locked: false })
    .eq("id", predictionId);
  if (unlockErr) throw unlockErr;

  // If the coach explicitly updated class_transition, mark it as manually
  // overridden so the auto-infer batch job won't reset it later.
  const extraFields: Record<string, any> = {};
  if (updates.class_transition !== undefined) {
    extraFields.class_transition_overridden = true;
  }
  const { error: updateErr } = await supabase
    .from("player_predictions")
    .update({ ...updates, ...result, ...extraFields, locked: true })
    .eq("id", predictionId);
  if (updateErr) throw updateErr;

  return { success: true, prediction: result };
}

export async function bulkRecalculatePredictionsLocal() {
  const config = await loadEngineConfig();
  const allPreds = await fetchAllPredictionsForReturnerMode();
  const hitterPreds = allPreds.filter((p) => !isPitcherPred(p));
  const pitcherPreds = allPreds.filter((p) => isPitcherPred(p));
  const preds = hitterPreds; // keep original var name for the existing hitter loop below

  // Pre-fetch power ratings keyed by players.id (the FK predictions use), so the
  // fallback lookup actually finds anything. We resolve the join via Hitter Master
  // -> source_player_id -> players.id.
  const powerByPlayerId = new Map<string, { contact: number | null; lineDrive: number | null; avgExitVelo: number | null; popUp: number | null; bb: number | null; chase: number | null; barrel: number | null; ev90: number | null; pull: number | null; la10_30: number | null; gb: number | null }>();
  // 1) source_player_id -> players.id
  const sourceToPlayerId = new Map<string, string>();
  let plFrom = 0;
  while (true) {
    const { data } = await supabase.from("players").select("id, source_player_id").not("source_player_id", "is", null).range(plFrom, plFrom + 999);
    for (const r of data || []) {
      if ((r as any).source_player_id) sourceToPlayerId.set((r as any).source_player_id, (r as any).id);
    }
    if (!data || data.length < 1000) break;
    plFrom += 1000;
  }
  // 2) Hitter Master scouting -> bucket under players.id
  let pfrom = 0;
  while (true) {
    const { data } = await supabase.from("Hitter Master").select("source_player_id, contact, line_drive, avg_exit_velo, pop_up, bb, chase, barrel, ev90, pull, la_10_30, gb").eq("Season", 2025).not("source_player_id", "is", null).range(pfrom, pfrom + 999);
    for (const r of data || []) {
      const playerId = r.source_player_id ? sourceToPlayerId.get(r.source_player_id) : null;
      if (!playerId) continue;
      powerByPlayerId.set(playerId, { contact: r.contact, lineDrive: r.line_drive, avgExitVelo: r.avg_exit_velo, popUp: r.pop_up, bb: r.bb, chase: r.chase, barrel: r.barrel, ev90: r.ev90, pull: r.pull, la10_30: r.la_10_30, gb: r.gb });
    }
    if (!data || data.length < 1000) break;
    pfrom += 1000;
  }

  // Inline power derivation for fallback
  const normalCdf = (x: number) => { const sign = x < 0 ? -1 : 1; const ax = Math.abs(x) / Math.sqrt(2); const t = 1 / (1 + 0.3275911 * ax); const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax)); return 0.5 * (1 + erf); };
  const scoreN = (v: number | null, avg: number, sd: number, lib = false) => { if (v == null || sd <= 0) return null; const p = normalCdf((v - avg) / sd) * 100; return lib ? 100 - p : p; };
  const derivePower = (r: typeof powerByPlayerId extends Map<string, infer V> ? V : never) => {
    const cs = scoreN(r.contact, 77.1, 6.6);
    const ld = scoreN(r.lineDrive, 20.9, 4.31);
    const ev = scoreN(r.avgExitVelo, 86.2, 4.28);
    const pu = scoreN(r.popUp, 7.9, 3.37, true);
    const bb = scoreN(r.bb, 11.4, 3.57);
    const ch = scoreN(r.chase, 23.1, 5.58, true);
    const ba = scoreN(r.barrel, 17.3, 7.89);
    const e9 = scoreN(r.ev90, 103.1, 3.97);
    const pl = scoreN(r.pull, 36.5, 8.03);
    const la = scoreN(r.la10_30, 29, 6.81);
    const gb = scoreN(r.gb, 43.2, 8.0, true);
    const baPower = cs != null && ld != null && ev != null && pu != null ? (0.4*cs + 0.25*ld + 0.2*ev + 0.15*pu) : null;
    const obpPower = cs != null && ld != null && ev != null && pu != null && bb != null && ch != null ? (0.35*cs + 0.2*ld + 0.15*ev + 0.1*pu + 0.15*bb + 0.05*ch) : null;
    const isoPower = ba != null && e9 != null && pl != null && la != null && gb != null ? (0.3*ba + 0.25*e9 + 0.2*pl + 0.15*la + 0.1*gb) : null;
    const baPR = baPower != null ? baPower / 50 * 100 : null;
    const obpPR = obpPower != null ? obpPower / 50 * 100 : null;
    const isoPR = isoPower != null ? isoPower / 50 * 100 : null;
    return { baPlus: baPR, obpPlus: obpPR, isoPlus: isoPR };
  };

  let updated = 0;
  let errors = 0;
  let updatedReturner = 0;
  let updatedTransfer = 0;
  const BATCH = 25;

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
            // No fallback: if internals are missing, we leave projections null
            // rather than computing from hardcoded baselines which drift from
            // the canonical Hitter Master scores. The 80-some players with
            // missing internals need their internals backfilled properly.
            const powerContext: ReturnerPowerContext = {
              baPlus: readSpecificPlus(internal?.avg_power_rating) ?? manual?.baPlus ?? null,
              obpPlus: readSpecificPlus(internal?.obp_power_rating) ?? manual?.obpPlus ?? null,
              isoPlus: readSpecificPlus(internal?.slg_power_rating) ?? manual?.isoPlus ?? null,
            };
            result = recalcReturner(pred, config.returner, powerContext);
          }
          // The protect_locked_predictions trigger blocks updates when locked=true,
          // so we MUST unlock before writing the recalculated fields, then re-lock.
          let lastErr: any = null;
          let success = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const { error: unlockErr } = await supabase
                .from("player_predictions")
                .update({ locked: false })
                .eq("id", pred.id);
              if (unlockErr) { lastErr = unlockErr; throw unlockErr; }
              const { error: e } = await supabase
                .from("player_predictions")
                .update({ ...result, locked: true })
                .eq("id", pred.id);
              if (!e) { success = true; break; }
              lastErr = e;
            } catch (e) {
              lastErr = e;
            }
            await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          }
          const error = success ? null : lastErr;

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

  // ─── Pitcher bulk path ─────────────────────────────────────────────
  // Preload everything we need so each batch is DB-round-trip-light.
  let updatedPitcher = 0;
  if (pitcherPreds.length > 0) {
    const pitchingEq = readPitchingWeights();
    const [pitchingPowerEq, parkMap] = await Promise.all([
      loadPitchingPowerEq(),
      fetchParkFactorsMap(2025),
    ]);

    // player_id -> { team, teamId, conference, source_player_id }
    // NOTE: chunk size capped at 100 to avoid Supabase .in() URL-length
    // overflow — 1000 UUIDs per .in() silently truncates results at ~8KB.
    const playerCtxById = new Map<string, { team: string | null; teamId: string | null; conference: string | null; sourceId: string | null }>();
    const pitcherPlayerIds = Array.from(new Set(pitcherPreds.map((p) => p.player_id).filter((v): v is string => !!v)));
    for (let i = 0; i < pitcherPlayerIds.length; i += 100) {
      const chunk = pitcherPlayerIds.slice(i, i + 100);
      const { data } = await supabase
        .from("players")
        .select("id, source_player_id, team, team_id, conference")
        .in("id", chunk);
      for (const r of (data || []) as any[]) {
        playerCtxById.set(r.id, {
          team: r.team ?? null,
          teamId: r.team_id ?? null,
          conference: r.conference ?? null,
          sourceId: r.source_player_id ?? null,
        });
      }
    }

    // Coach role overrides from pitcher_role_overrides table, keyed by player_id.
    // Deliberately NOT using pred.pitcher_role (which is the engine's own
    // previous output — treating it as an override creates a feedback loop).
    const coachRoleByPlayerId = new Map<string, "SP" | "RP" | "SM">();
    if (pitcherPlayerIds.length > 0) {
      for (let i = 0; i < pitcherPlayerIds.length; i += 100) {
        const chunk = pitcherPlayerIds.slice(i, i + 100);
        const { data } = await supabase
          .from("pitcher_role_overrides")
          .select("player_id, role")
          .in("player_id", chunk);
        for (const r of (data || []) as any[]) {
          const normalized = normalizeRole(r.role);
          if (normalized && r.player_id) coachRoleByPlayerId.set(r.player_id, normalized);
        }
      }
    }

    // source_player_id -> Pitching Master scouting row (Season 2025)
    const scoutingBySourceId = new Map<string, PitcherScoutingRow>();
    const pitcherSourceIds = Array.from(
      new Set(
        Array.from(playerCtxById.values())
          .map((v) => v.sourceId)
          .filter((v): v is string => !!v),
      ),
    );
    for (let i = 0; i < pitcherSourceIds.length; i += 100) {
      const chunk = pitcherSourceIds.slice(i, i + 100);
      const { data } = await supabase
        .from("Pitching Master")
        .select(PITCHER_SCOUTING_SELECT)
        .eq("Season", 2025)
        .in("source_player_id", chunk);
      for (const r of (data || []) as any[]) {
        if (r.source_player_id) scoutingBySourceId.set(r.source_player_id, mapPitchingMasterRow(r));
      }
    }

    const PITCHER_BATCH = 25;
    for (let i = 0; i < pitcherPreds.length; i += PITCHER_BATCH) {
      const batch = pitcherPreds.slice(i, i + PITCHER_BATCH);
      const batchIds = batch.map((p) => p.id);

      // Preload stored PR+ from internals for this batch.
      const { data: pitcherInternals } = await supabase
        .from("player_prediction_internals")
        .select("prediction_id, era_power_rating, fip_power_rating, whip_power_rating, k9_power_rating, bb9_power_rating, hr9_power_rating")
        .in("prediction_id", batchIds);
      const storedByPredId = new Map<string, StoredPitcherPrPlus>();
      for (const row of (pitcherInternals || []) as any[]) {
        storedByPredId.set(row.prediction_id, {
          era: row.era_power_rating ?? null,
          fip: row.fip_power_rating ?? null,
          whip: row.whip_power_rating ?? null,
          k9: row.k9_power_rating ?? null,
          bb9: row.bb9_power_rating ?? null,
          hr9: row.hr9_power_rating ?? null,
        });
      }

      await Promise.all(
        batch.map(async (pred) => {
          try {
            const ctx = pred.player_id ? playerCtxById.get(pred.player_id) : null;
            const scouting = ctx?.sourceId ? scoutingBySourceId.get(ctx.sourceId) ?? null : null;
            const player = {
              team: ctx?.team ?? null,
              teamId: ctx?.teamId ?? null,
              conference: ctx?.conference ?? null,
            };
            const internalsPr = storedByPredId.get(pred.id) ?? null;
            // Pitching Master's precomputed PR+ takes precedence over internals
            // (matches PitcherProfile). internals is sparse; PM is dense.
            const storedPrPlus: StoredPitcherPrPlus = {
              era: scouting?.era_pr_plus ?? internalsPr?.era ?? null,
              fip: scouting?.fip_pr_plus ?? internalsPr?.fip ?? null,
              whip: scouting?.whip_pr_plus ?? internalsPr?.whip ?? null,
              k9: internalsPr?.k9 ?? null,
              bb9: internalsPr?.bb9 ?? null,
              hr9: internalsPr?.hr9 ?? null,
            };
            const coachRoleOverride = pred.player_id ? coachRoleByPlayerId.get(pred.player_id) ?? null : null;
            const { predictionUpdate, internalsUpdate } = recalcPitcher(pred, pitchingEq, pitchingPowerEq, parkMap, scouting, player, storedPrPlus, coachRoleOverride);

            // Unlock → update → re-lock (same pattern as hitter loop).
            let lastErr: any = null;
            let success = false;
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const { error: unlockErr } = await supabase
                  .from("player_predictions")
                  .update({ locked: false })
                  .eq("id", pred.id);
                if (unlockErr) { lastErr = unlockErr; throw unlockErr; }
                const { error: e } = await supabase
                  .from("player_predictions")
                  .update({ ...predictionUpdate, locked: true })
                  .eq("id", pred.id);
                if (!e) { success = true; break; }
                lastErr = e;
              } catch (e) {
                lastErr = e;
              }
              await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
            }
            if (!success) {
              errors += 1;
              return;
            }

            // Non-fatal internals upsert.
            await supabase
              .from("player_prediction_internals")
              .upsert({ prediction_id: pred.id, ...internalsUpdate }, { onConflict: "prediction_id" });

            updated += 1;
            updatedPitcher += 1;
          } catch {
            errors += 1;
          }
        }),
      );
    }

  }

  return {
    success: true,
    updated,
    updated_returner: updatedReturner,
    updated_transfer: updatedTransfer,
    updated_pitcher: updatedPitcher,
    errors,
    total: allPreds.length,
  };
}
