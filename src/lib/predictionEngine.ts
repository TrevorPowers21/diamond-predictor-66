import { supabase } from "@/integrations/supabase/client";
import { loadEquationWeightsMap } from "@/hooks/useEquationWeights";
import { TRANSFER_WEIGHT_DEFAULTS } from "@/lib/transferWeightDefaults";
import { readPitchingWeights } from "@/lib/pitchingEquations";
import { fetchParkFactorsMap, type ParkFactorsMap } from "@/lib/parkFactors";
import { projectJucoReturnerPitcher } from "@/lib/jucoReturnerPitcherProjection";
import { CURRENT_SEASON, PRIOR_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import { computePitcherProjection, type PitcherProjectionInput } from "@/lib/pitcherProjection";
import { PITCHING_EQ_DEFAULTS } from "@/hooks/usePitchingEquationWeights";
import {
  computePitcherWar,
  computePitcherMarketValue,
  computeHitterOWar,
  computeHitterMarketValue,
  defaultHitterDepthRoleFromActualPa,
  paForHitterDepthRole,
  pitcherExpectedIp,
  derivePitcherDepthRole,
} from "@/lib/depthRoles";

// Fetch player meta needed to derive stored p_war / o_war / market_value
// after a recalc. Returns nulls when player_id missing.
async function fetchPlayerMetaForDerived(playerId: string | null | undefined) {
  if (!playerId) return { conference: null, team: null, position: null, pa: null, ip: null, is_twp: false };
  const { data } = await supabase
    .from("players")
    .select("conference, team, position, pa, ip, is_twp")
    .eq("id", playerId)
    .maybeSingle();
  return {
    conference: (data as any)?.conference ?? null,
    team: (data as any)?.team ?? null,
    position: (data as any)?.position ?? null,
    pa: (data as any)?.pa ?? null,
    ip: (data as any)?.ip ?? null,
    is_twp: !!(data as any)?.is_twp,
  };
}

// derivePitcherDepthRole now lives in src/lib/depthRoles.ts (shared with the live
// projection paths so precompute + overlay agree on depth → projected IP).

// Compute pitcher derived columns from a freshly-recalculated row.
// Exported so the precompute scripts derive projected_ip / p_war / depth role
// through the SAME path as the recalc engine (no coarse-role IP fork).
export function derivePitcherStored(
  pRvPlus: number | null | undefined,
  role: "SP" | "RP" | "SM",
  meta: { conference: string | null; team: string | null; is_twp?: boolean; ip?: number | null },
  eq: ReturnType<typeof readPitchingWeights>,
) {
  // Derive granular depth role from real IP, then use depth-role-specific
  // projected IP for the pWAR formula. Previously used coarse role IP
  // (pwar_ip_sp / rp / sm) which produced wrong WAR for weekday_starter,
  // swing_starter, low_impact_reliever, etc.
  const pitcherDepthRole = derivePitcherDepthRole(meta.ip, role);
  const projectedIp = pitcherExpectedIp(pitcherDepthRole as any, eq);
  const pWar = computePitcherWar(pRvPlus, projectedIp, eq);
  const marketValue = computePitcherMarketValue(pWar, { conference: meta.conference, role, team: meta.team }, { dollarsPerWar: eq.market_dollars_per_war });
  // For TWPs: route MV to twp_pitcher_market_value and NULL out the shared
  // market_value column so the hitter loop's market_value write doesn't get
  // stomped (and so any unconverted read fails loud).
  if (meta.is_twp) {
    return { p_war: pWar, market_value: null, twp_pitcher_market_value: marketValue, projected_ip: projectedIp, pitcher_depth_role: pitcherDepthRole };
  }
  return { p_war: pWar, market_value: marketValue, projected_ip: projectedIp, pitcher_depth_role: pitcherDepthRole };
}

function deriveHitterStored(
  pWrcPlus: number | null | undefined,
  meta: { conference: string | null; position: string | null; pa: number | null; is_twp?: boolean },
) {
  // Derive depth role from raw PA → tier PA, matching per-team precompute math.
  // Without this, oWAR is computed against raw PA which produces values that
  // differ from what TB/PlayerProfile display via the depth-role overlay.
  const hitterDepthRole = defaultHitterDepthRoleFromActualPa(meta.pa);
  const projectedPa = paForHitterDepthRole(hitterDepthRole);
  const oWar = computeHitterOWar(pWrcPlus, projectedPa, hitterDepthRole);
  const marketValue = computeHitterMarketValue(oWar, { conference: meta.conference, position: meta.position });
  // For TWPs: route MV to twp_hitter_market_value and NULL the shared
  // market_value column. Pitcher loop's derive does the same on its side.
  if (meta.is_twp) {
    return { o_war: oWar, market_value: null, twp_hitter_market_value: marketValue, projected_pa: projectedPa, hitter_depth_role: hitterDepthRole };
  }
  return { o_war: oWar, market_value: marketValue, projected_pa: projectedPa, hitter_depth_role: hitterDepthRole };
}

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
// C1 (2026-08-10): est_wOBA = 0.011 + 0.691·OBP + 0.235·SLG (÷ ncaaWrc 0.3782). AVG/ISO redundant → 0.
// The `intercept` centers league-avg at 100 on the true-wOBA denom; see ncaa_league_averages_2026.json.
const DEFAULT_WRC_WEIGHTS = { intercept: 0.011, obp: 0.691, slg: 0.235, avg: 0, iso: 0 };

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
  wrcWeights: { intercept: number; obp: number; slg: number; avg: number; iso: number };
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
  wrcWeights: { intercept: number; obp: number; slg: number; avg: number; iso: number };
  ncaaWrc: number;
}

interface EngineConfig {
  returner: ReturnerConfig;
  transfer: TransferConfig;
}

export interface ReturnerPowerContext {
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

export function readSpecificPlus(v: number | null | undefined): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}


function normalizeClassTransition(raw?: string | null): string {
  let value = (raw || "").trim().toUpperCase();
  if (!value) return "SJ";
  if (["FS", "SJ", "JS", "GR"].includes(value)) return value;
  // Strip redshirt prefix (R-, RS-, R ) — R-FR is a freshman for development math.
  value = value.replace(/^(RS?-?\s*)+/, "").trim();
  if (value === "FR" || value === "FRESHMAN" || value === "FRESH") return "FS";
  if (value === "SO" || value === "SOPHOMORE" || value === "SOPH") return "SJ";
  if (value === "JR" || value === "JUNIOR") return "JS";
  if (value === "SR" || value === "SENIOR") return "GR";
  if (value === "GS" || value === "GRAD" || value === "GRADUATE") return "GR";
  if (value.includes("FRESHMAN")) return "FS";
  if (value.includes("SOPHOMORE")) return "SJ";
  if (value.includes("JUNIOR")) return "JS";
  if (value.includes("SENIOR") || value.includes("GRAD")) return "GR";
  return "SJ";
}

export async function loadEngineConfig(customerTeamId?: string | null): Promise<EngineConfig> {
  // Load from "Equation Weights" table (primary), fall back to "model_config" (legacy)
  let eqWeights: Map<string, number>;
  try {
    eqWeights = await loadEquationWeightsMap(2025);
  } catch {
    eqWeights = new Map();
  }
  // Per-team overrides on equation_weights keys win over globals when provided.
  if (customerTeamId) {
    const { data: ovRows } = await (supabase as any)
      .from("customer_team_equation_overrides")
      .select("config_key, config_value")
      .eq("customer_team_id", customerTeamId);
    for (const r of (ovRows || []) as Array<{ config_key: string; config_value: number }>) {
      eqWeights.set(r.config_key, Number(r.config_value));
    }
  }
  const eq = (key: string) => eqWeights.get(key) ?? eqWeights.get(key.toLowerCase());

  const { data, error } = await supabase
    .from("model_config")
    .select("model_type, config_key, config_value");

  if (error && eqWeights.size === 0) throw error;

  let returnerRows = ((data || []) as any[]).filter((row) => row.model_type === "returner");
  let transferRows = ((data || []) as any[]).filter((row) => row.model_type === "transfer");

  // Layer model_type-scoped overrides on top of the legacy model_config rows
  if (customerTeamId) {
    const { data: ovTypedRows } = await (supabase as any)
      .from("customer_team_equation_overrides")
      .select("model_type, config_key, config_value")
      .eq("customer_team_id", customerTeamId);
    const overlay = (rows: any[], modelType: string) => {
      const overrides = ((ovTypedRows || []) as any[]).filter((o) => o.model_type === modelType);
      if (overrides.length === 0) return rows;
      const byKey = new Map<string, any>();
      for (const r of rows) byKey.set(r.config_key, r);
      for (const o of overrides) {
        byKey.set(o.config_key, { model_type: modelType, config_key: o.config_key, config_value: Number(o.config_value) });
      }
      return Array.from(byKey.values());
    };
    returnerRows = overlay(returnerRows, "returner");
    transferRows = overlay(transferRows, "transfer");
  }

  const returner: ReturnerConfig = {
    ncaaAvg: 0.28,
    ncaaObp: 0.385,
    ncaaIso: 0.162,
    baStdPower: 29.99699,   // std_pr on 2026 pitch-log ratings (PA≥60); was 31.297
    baStdNcaa: 0.043455,
    obpStdPower: 31.89504,  // std_pr on 2026 pitch-log ratings (PA≥60); was 28.889
    obpStdNcaa: 0.046781,
    ncaaPR: 100,
    powerWeight: 0.7,
    ncaaWrc: 0.3782,
    classBases: {
      FS: { avg: 0.03, obp: 0.03, iso: 0.045 },
      SJ: { avg: 0.02, obp: 0.02, iso: 0.03 },
      JS: { avg: 0.015, obp: 0.015, iso: 0.02 },
      GR: { avg: 0.01, obp: 0.01, iso: 0.01 },
    },
    devCoeffs: { avg: 0.06, obp: 0.06, iso: 0.08 },
    isoStdNcaa: 0.07849797197,
    isoStdPower: 44.91252,  // std_pr on 2026 pitch-log ratings (PA≥60); was 45.423
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
    applyEq("w_intercept", (v) => { returner.wrcWeights.intercept = toWeight(v); });
    applyEq("w_obp", (v) => { returner.wrcWeights.obp = toWeight(v); });
    applyEq("w_slg", (v) => { returner.wrcWeights.slg = toWeight(v); });
    applyEq("w_avg", (v) => { returner.wrcWeights.avg = toWeight(v); });
    applyEq("w_iso", (v) => { returner.wrcWeights.iso = toWeight(v); });
  }


  const transfer: TransferConfig = {
    baNcaaAvg: 0.28,
    obpNcaaAvg: 0.385,
    isoNcaaAvg: 0.162,
    baStdPower: 29.99699,   // std_pr on 2026 pitch-log ratings (PA≥60); was 31.297
    baStdNcaa: 0.043455,
    obpStdPower: 31.89504,  // std_pr on 2026 pitch-log ratings (PA≥60); was 28.889
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
    isoStdPower: 44.91252,  // std_pr on 2026 pitch-log ratings (PA≥60); was 45.423
    wrcWeights: { ...DEFAULT_WRC_WEIGHTS },
    ncaaWrc: 0.3782,
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
    else if (k === "wrc_weight_intercept" || k === "w_intercept") transfer.wrcWeights.intercept = v;
    else if (k.startsWith("wrc_weight_")) {
      const stat = k.replace("wrc_weight_", "") as "obp" | "slg" | "avg" | "iso";
      if (["obp", "slg", "avg", "iso"].includes(stat)) transfer.wrcWeights[stat] = v;
    }
  }

  return { returner, transfer };
}

export function recalcReturner(
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

  // Hitter damping disabled — the original formula
  //   final = fromStat + (delta × dampFactor)
  // applied dampFactor as a weight on the delta. For extreme actual seasons
  // (high fromAvg with regressed projected) it pulled the result BACK toward
  // the outlier season — anti-regression. For unrealistic projections it did
  // partially correct, but the blend (POWER_RATING_WEIGHT) plus tightened
  // PR+ SDs already do enough regression-to-mean. Predates SD calibration.
  // Kept tier-damp helpers on the signature for a future Path B (pull
  // extreme PROJECTED values toward NCAA mean regardless of delta direction).
  void avgProjectedTierDamp; void obpProjectedTierDamp;

  const pAvg = baPlus == null
    ? null
    : (() => {
      const safeBaStdPower = config.baStdPower === 0 ? 1 : config.baStdPower;
      const scaledBa = config.ncaaAvg + (((baPlus - config.ncaaPR) / safeBaStdPower) * config.baStdNcaa);
      const baBlended = (fromAvg * (1 - effectivePowerWeight)) + (scaledBa * effectivePowerWeight);
      const baProjected = baBlended * (1 + bases.avg + (devAgg * config.devCoeffs.avg));
      return round3(normalizeProjectedRate(baProjected));
    })();

  const pObp = obpPlus == null
    ? null
    : (() => {
      const safeObpStdPower = config.obpStdPower === 0 ? 1 : config.obpStdPower;
      const scaledObp = config.ncaaObp + (((obpPlus - config.ncaaPR) / safeObpStdPower) * config.obpStdNcaa);
      const obpBlended = (fromObp * (1 - effectivePowerWeight)) + (scaledObp * effectivePowerWeight);
      const obpProjected = obpBlended * (1 + bases.obp + (devAgg * config.devCoeffs.obp));
      return round3(normalizeProjectedRate(obpProjected));
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
    : round3(config.wrcWeights.intercept + (config.wrcWeights.obp * pObp) + (config.wrcWeights.slg * pSlg) + (config.wrcWeights.avg * pAvg) + (config.wrcWeights.iso * pIso));
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
  const pWrc = round3(config.wrcWeights.intercept + (config.wrcWeights.obp * pObp) + (config.wrcWeights.slg * pSlg) + (config.wrcWeights.avg * pAvg) + (config.wrcWeights.iso * pIso));
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

// ⚠ REFERENCE, NOT RUNTIME (2026-08-20): `recalcReturner` is no longer called by
// the app runtime — `bulkRecalculatePredictionsLocal` is a stub that invokes the
// `recalculate-prediction` edge fn, and PlayerProfile / TeamBuilder retired the
// live per-row recompute (they read stored predictions). It is kept as (a) the
// canonical SD-blend reference — the edge fn's `recalc()` is a verbatim port — and
// (b) a live dependency of scripts/backfill-2027-hitter-returners.ts, which calls
// it directly to seed 2027 returner rows. So it is NOT dead and is retained.
// Its hardcoded config defaults were refreshed to the 2026 pitch-log std_pr above.
//
// The former `calculatePrediction(pred, config, overrides)` wrapper was DELETED
// (2026-08-20): it had no callers (dead), only routed transfer→recalcTransfer /
// returner→recalcReturner. Call those directly if a router is ever needed again.

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
async function loadPitchingPowerEq(season = 2026): Promise<Record<string, number>> {
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
    ip: (scouting as any)?.IP ?? null,
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

// bulkRecalculatePredictionsLocal — RETIRED (Step 4). The returner-hitter
// recompute now lives in the Deno edge fn supabase/functions/recalculate-prediction
// (the SD-blend, reading model_config admin_ui r_* keys). This local copy was dead:
// it referenced the deleted fetchAllPredictionsForReturnerMode (ReferenceError /
// TS2304) and carried a stale pitcher-bulk path. Kept as a thin wrapper so the two
// call sites (AdminDashboard bulk button + runDataCascade) keep working by routing
// to the edge fn's bulk_recalculate action.
//
// NOTE: the edge fn bulk path recomputes returner + transfer hitters. Pitcher bulk
// recompute is NOT covered here (it was already broken in the old local path); track
// pitcher bulk recompute separately if/when needed.
export async function bulkRecalculatePredictionsLocal(_season: number = PROJECTION_SEASON) {
  void _season;
  const { data, error } = await supabase.functions.invoke("recalculate-prediction", {
    body: { action: "bulk_recalculate" },
  });
  if (error) throw error;
  const result = (data ?? {}) as {
    success?: boolean;
    updated?: number;
    updated_returner?: number;
    updated_transfer?: number;
    errors?: number;
    total?: number;
    error?: string;
  };
  if (result.success === false || result.error) {
    throw new Error(result.error ?? "Bulk recalculation failed");
  }
  return {
    success: true,
    updated: result.updated ?? 0,
    updated_returner: result.updated_returner ?? 0,
    updated_transfer: result.updated_transfer ?? 0,
    errors: result.errors ?? 0,
    total: result.total ?? 0,
  };
}
