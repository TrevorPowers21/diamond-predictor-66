// Shared hitter-transfer input builder.
//
// Used by both TransferPortal.tsx (interactive simulator) and
// scripts/precompute-transfer-projections.ts (batch eager pre-compute) so
// the two never drift on equation inputs, JUCO regression, park handedness,
// conference resolution, weight defaults, or class-transition multiplier.
//
// Pure: no React, no Supabase, no localStorage. Caller supplies resolver
// callbacks + the already-loaded equation values map.

import {
  TRANSFER_WEIGHT_DEFAULTS,
  transferWeightsForSource,
  applyJucoOutlierRegression,
  JUCO_REGRESSION_CONFIG,
} from "@/lib/transferWeightDefaults";
import { computeHitterPowerRatings } from "@/lib/powerRatings";
import { batsHandToHandedness } from "@/lib/parkFactors";
import type { TransferProjectionInputs, TransferProjectionOutput } from "@/lib/transferProjection";

// ---------- helpers (kept local so the precompute script doesn't need to
// import them from the page) ----------

const toRate = (n: number) => (Math.abs(n) > 1 ? n / 100 : n);
const toWeight = (n: number) => (Math.abs(n) >= 10 ? n / 100 : n);

export function readEquationValue(
  key: string,
  fallback: number,
  remoteValues?: Record<string, number> | null,
): number {
  const remote = remoteValues?.[key];
  if (Number.isFinite(remote)) return Number(remote);
  const canonical = (TRANSFER_WEIGHT_DEFAULTS as Record<string, number>)[key];
  if (canonical !== undefined) return canonical;
  return fallback;
}

export function normalizeParkToIndex(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 100;
  return Math.abs(n) <= 2 ? n * 100 : n;
}

// ---------- caller-facing input shapes ----------

export type HitterTransferPlayer = {
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  bats_hand?: string | null;
  division?: string | null;
  class_transition?: string | null;
  dev_aggressiveness?: number | null;
  from_avg: number | null;
  from_obp: number | null;
  from_slg: number | null;
};

export type ConferenceHittingStats = {
  avg_plus?: number | null;
  obp_plus?: number | null;
  iso_plus?: number | null;
  stuff_plus?: number | null;
} | null;

export type SeedPowerInputs = {
  contact?: number | null;
  lineDrive?: number | null;
  avgExitVelo?: number | null;
  popUp?: number | null;
  bb?: number | null;
  chase?: number | null;
  barrel?: number | null;
  ev90?: number | null;
  pull?: number | null;
  la10_30?: number | null;
  gb?: number | null;
} | null;

export type BuildHitterTransferInputsArgs = {
  player: HitterTransferPlayer;

  fromTeam: { id?: string | null; name?: string | null } | null;
  toTeam: { id?: string | null; name?: string | null } | null;
  fromConference: string | null;
  fromConferenceId?: string | null;
  toConference: string | null;
  toConferenceId?: string | null;

  // Stat-specific PR+ values already resolved upstream when available.
  internals?: {
    avg_power_rating?: number | null;
    obp_power_rating?: number | null;
    slg_power_rating?: number | null;
  } | null;
  // Optional seed power fallback used to compute PR+ when internals are missing.
  seedPower?: SeedPowerInputs;

  // Resolvers (caller wires these to its data source)
  resolveConferenceHitting: (
    conference: string | null,
    conferenceId?: string | null,
  ) => ConferenceHittingStats;
  // metric: "avg" | "obp" | "iso"; handedness: "LHB" | "RHB" | "SWITCH" | null
  resolveParkFactor: (
    teamId: string | null | undefined,
    teamName: string | null | undefined,
    metric: "avg" | "obp" | "iso",
    handedness: string | null,
  ) => number | null;

  // Equation values from Supabase (model_config + equation_weights, already
  // layered with any per-team override). Caller is responsible for the layering.
  remoteEquationValues: Record<string, number>;
};

export type BuildHitterTransferInputsResult =
  | { blocked: true; missingInputs: string[] }
  | {
      blocked: false;
      inputs: TransferProjectionInputs;
      // Transfer-only multiplier applied to projected.pAvg/pObp/pIso. The
      // caller multiplies projected stats by this before deriving SLG/OPS/wRC.
      transferMultiplier: number;
      classAdj: number;
      isJucoSource: boolean;
    };

// Uses canonical batsHandToHandedness (lowercase "lhb"/"rhb"/"switch") from
// parkFactors so casing matches what resolveMetricParkFactor expects.

// ---------- main entry ----------

export function buildHitterTransferInputs(
  args: BuildHitterTransferInputsArgs,
): BuildHitterTransferInputsResult {
  const {
    player,
    fromTeam,
    toTeam,
    fromConference,
    fromConferenceId,
    toConference,
    toConferenceId,
    internals,
    seedPower,
    resolveConferenceHitting,
    resolveParkFactor,
    remoteEquationValues,
  } = args;

  const missingInputs: string[] = [];
  const rawLastAvg = player.from_avg;
  const rawLastObp = player.from_obp;
  const rawLastSlg = player.from_slg;
  if (rawLastAvg == null) missingInputs.push("Last AVG");
  if (rawLastObp == null) missingInputs.push("Last OBP");
  if (rawLastSlg == null) missingInputs.push("Last SLG");

  // JUCO/D2 outlier regression (only pulls down stats above outlier threshold).
  // D2 routed through the same path — power_weight=0 (no Hitter Master power
  // ratings needed), outlier regression applies, JUCO conference + park weights.
  // Matches the pitcher-side D2 routing in buildTransferPitcherInputs.ts.
  const isJucoSource = player.division === "NJCAA_D1" || player.division === "D2";
  const lastAvg = isJucoSource && rawLastAvg != null
    ? applyJucoOutlierRegression(rawLastAvg, JUCO_REGRESSION_CONFIG.avg.mean, JUCO_REGRESSION_CONFIG.avg.threshold, JUCO_REGRESSION_CONFIG.avg.slope, JUCO_REGRESSION_CONFIG.avg.maxR)
    : rawLastAvg;
  const lastObp = isJucoSource && rawLastObp != null
    ? applyJucoOutlierRegression(rawLastObp, JUCO_REGRESSION_CONFIG.obp.mean, JUCO_REGRESSION_CONFIG.obp.threshold, JUCO_REGRESSION_CONFIG.obp.slope, JUCO_REGRESSION_CONFIG.obp.maxR)
    : rawLastObp;
  const lastSlg = (() => {
    if (!isJucoSource || rawLastAvg == null || rawLastSlg == null) return rawLastSlg;
    const rawIso = rawLastSlg - rawLastAvg;
    const adjIso = applyJucoOutlierRegression(rawIso, JUCO_REGRESSION_CONFIG.iso.mean, JUCO_REGRESSION_CONFIG.iso.threshold, JUCO_REGRESSION_CONFIG.iso.slope, JUCO_REGRESSION_CONFIG.iso.maxR);
    return (lastAvg ?? rawLastAvg) + adjIso;
  })();

  // PR+ resolution: internals first, then compute from seed power data
  let baPR = internals?.avg_power_rating ?? null;
  let obpPR = internals?.obp_power_rating ?? null;
  let isoPR = internals?.slg_power_rating ?? null;

  if ((baPR == null || obpPR == null || isoPR == null) && seedPower) {
    const computed = computeHitterPowerRatings({
      contact: seedPower.contact ?? null,
      lineDrive: seedPower.lineDrive ?? null,
      avgExitVelo: seedPower.avgExitVelo ?? null,
      popUp: seedPower.popUp ?? null,
      bb: seedPower.bb ?? null,
      chase: seedPower.chase ?? null,
      barrel: seedPower.barrel ?? null,
      ev90: seedPower.ev90 ?? null,
      pull: seedPower.pull ?? null,
      la10_30: seedPower.la10_30 ?? null,
      gb: seedPower.gb ?? null,
    } as any);
    if (baPR == null) baPR = computed.baPlus;
    if (obpPR == null) obpPR = computed.obpPlus;
    if (isoPR == null) isoPR = computed.isoPlus;
  }

  if (!isJucoSource) {
    if (baPR == null) missingInputs.push("BA Power Rating+");
    if (obpPR == null) missingInputs.push("OBP Power Rating+");
    if (isoPR == null) missingInputs.push("ISO Power Rating+");
  }

  const fromConfStats = resolveConferenceHitting(fromConference, fromConferenceId);
  const toConfStats = resolveConferenceHitting(toConference, toConferenceId);

  const fromAvgPlus = fromConfStats?.avg_plus ?? null;
  const toAvgPlus = toConfStats?.avg_plus ?? null;
  const fromObpPlus = fromConfStats?.obp_plus ?? null;
  const toObpPlus = toConfStats?.obp_plus ?? null;
  const fromIsoPlus = fromConfStats?.iso_plus ?? null;
  const toIsoPlus = toConfStats?.iso_plus ?? null;
  const fromStuff = fromConfStats?.stuff_plus ?? null;
  const toStuff = toConfStats?.stuff_plus ?? null;

  const playerHand = batsHandToHandedness(player.bats_hand);
  const fromParkAvgRaw = resolveParkFactor(fromTeam?.id, fromTeam?.name, "avg", playerHand);
  const toParkAvgRaw = resolveParkFactor(toTeam?.id, toTeam?.name, "avg", playerHand);
  const fromParkObpRaw = resolveParkFactor(fromTeam?.id, fromTeam?.name, "obp", playerHand);
  const toParkObpRaw = resolveParkFactor(toTeam?.id, toTeam?.name, "obp", playerHand);
  const fromParkIsoRaw = resolveParkFactor(fromTeam?.id, fromTeam?.name, "iso", playerHand);
  const toParkIsoRaw = resolveParkFactor(toTeam?.id, toTeam?.name, "iso", playerHand);

  if (fromAvgPlus == null) missingInputs.push("From AVG+");
  if (toAvgPlus == null) missingInputs.push("To AVG+");
  if (fromObpPlus == null) missingInputs.push("From OBP+");
  if (toObpPlus == null) missingInputs.push("To OBP+");
  if (fromIsoPlus == null) missingInputs.push("From ISO+");
  if (toIsoPlus == null) missingInputs.push("To ISO+");
  if (fromStuff == null) missingInputs.push("From Stuff+");
  if (toStuff == null) missingInputs.push("To Stuff+");
  if (!isJucoSource) {
    if (fromParkAvgRaw == null) missingInputs.push("From AVG Park Factor");
    if (toParkAvgRaw == null) missingInputs.push("To AVG Park Factor");
    if (fromParkObpRaw == null) missingInputs.push("From OBP Park Factor");
    if (toParkObpRaw == null) missingInputs.push("To OBP Park Factor");
    if (fromParkIsoRaw == null) missingInputs.push("From ISO Park Factor");
    if (toParkIsoRaw == null) missingInputs.push("To ISO Park Factor");
  }

  if (missingInputs.length > 0) {
    return { blocked: true, missingInputs };
  }

  const fromBaPark = normalizeParkToIndex(fromParkAvgRaw);
  const toBaPark = normalizeParkToIndex(toParkAvgRaw);
  const fromObpPark = normalizeParkToIndex(fromParkObpRaw);
  const toObpPark = normalizeParkToIndex(toParkObpRaw);
  const fromIsoPark = normalizeParkToIndex(fromParkIsoRaw);
  const toIsoPark = normalizeParkToIndex(toParkIsoRaw);

  const ncaaAvgBA = toRate(readEquationValue("t_ba_ncaa_avg", 0.280, remoteEquationValues));
  const ncaaAvgOBP = toRate(readEquationValue("t_obp_ncaa_avg", 0.385, remoteEquationValues));
  const ncaaAvgISO = toRate(readEquationValue("t_iso_ncaa_avg", 0.162, remoteEquationValues));
  const ncaaAvgWrc = toRate(readEquationValue("t_wrc_ncaa_avg", 0.364, remoteEquationValues));
  const baStdPower = readEquationValue("t_ba_std_pr", 31.297, remoteEquationValues);
  const baStdNcaa = toRate(readEquationValue("t_ba_std_ncaa", 0.043455, remoteEquationValues));
  const obpStdPower = readEquationValue("t_obp_std_pr", 28.889, remoteEquationValues);
  const obpStdNcaa = toRate(readEquationValue("t_obp_std_ncaa", 0.046781, remoteEquationValues));

  const srcW = transferWeightsForSource(player.division || undefined);
  const jucoWeight = (k: keyof typeof srcW, d1: number) => (isJucoSource ? srcW[k] : d1);
  const baPowerWeight = toRate(jucoWeight("t_ba_power_weight", readEquationValue("t_ba_power_weight", 0.70, remoteEquationValues)));
  const obpPowerWeight = toRate(jucoWeight("t_obp_power_weight", readEquationValue("t_obp_power_weight", 0.70, remoteEquationValues)));
  const baConferenceWeight = toWeight(jucoWeight("t_ba_conference_weight", readEquationValue("t_ba_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_conference_weight, remoteEquationValues)));
  const obpConferenceWeight = toWeight(jucoWeight("t_obp_conference_weight", readEquationValue("t_obp_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_conference_weight, remoteEquationValues)));
  const isoConferenceWeight = toWeight(jucoWeight("t_iso_conference_weight", readEquationValue("t_iso_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_conference_weight, remoteEquationValues)));
  const baPitchingWeight = toWeight(jucoWeight("t_ba_pitching_weight", readEquationValue("t_ba_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_pitching_weight, remoteEquationValues)));
  const obpPitchingWeight = toWeight(jucoWeight("t_obp_pitching_weight", readEquationValue("t_obp_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_pitching_weight, remoteEquationValues)));
  const isoPitchingWeight = toWeight(jucoWeight("t_iso_pitching_weight", readEquationValue("t_iso_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_pitching_weight, remoteEquationValues)));
  const baParkWeight = toWeight(jucoWeight("t_ba_park_weight", readEquationValue("t_ba_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_park_weight, remoteEquationValues)));
  const obpParkWeight = toWeight(jucoWeight("t_obp_park_weight", readEquationValue("t_obp_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_park_weight, remoteEquationValues)));
  const isoParkWeight = toWeight(jucoWeight("t_iso_park_weight", readEquationValue("t_iso_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_park_weight, remoteEquationValues)));

  const isoStdPower = readEquationValue("t_iso_std_power", 45.423, remoteEquationValues);
  const isoStdNcaa = toRate(readEquationValue("t_iso_std_ncaa", 0.07849797197, remoteEquationValues));

  const wObp = toRate(readEquationValue("r_w_obp", 0.45, remoteEquationValues));
  const wSlg = toRate(readEquationValue("r_w_slg", 0.30, remoteEquationValues));
  const wAvg = toRate(readEquationValue("r_w_avg", 0.15, remoteEquationValues));
  const wIso = toRate(readEquationValue("r_w_iso", 0.10, remoteEquationValues));

  // JUCO sources: PRs aren't used (power weight=0). Coerce nulls to 100 (NCAA
  // avg) so the math doesn't NaN out — gets multiplied by 0 anyway.
  const safePR = (v: number | null) => v ?? 100;

  const inputs: TransferProjectionInputs = {
    lastAvg: lastAvg as number,
    lastObp: lastObp as number,
    lastSlg: lastSlg as number,
    baPR: safePR(baPR),
    obpPR: safePR(obpPR),
    isoPR: safePR(isoPR),
    fromAvgPlus: fromAvgPlus as number,
    toAvgPlus: toAvgPlus as number,
    fromObpPlus: fromObpPlus as number,
    toObpPlus: toObpPlus as number,
    fromIsoPlus: fromIsoPlus as number,
    toIsoPlus: toIsoPlus as number,
    fromStuff: fromStuff as number,
    toStuff: toStuff as number,
    fromPark: fromBaPark,
    toPark: toBaPark,
    fromBaPark,
    toBaPark,
    fromObpPark,
    toObpPark,
    fromIsoPark,
    toIsoPark,
    ncaaAvgBA,
    ncaaAvgOBP,
    ncaaAvgISO,
    ncaaAvgWrc,
    baStdPower,
    baStdNcaa,
    obpStdPower,
    obpStdNcaa,
    baPowerWeight,
    obpPowerWeight,
    baConferenceWeight,
    obpConferenceWeight,
    isoConferenceWeight,
    baPitchingWeight,
    obpPitchingWeight,
    isoPitchingWeight,
    baParkWeight,
    obpParkWeight,
    isoParkWeight,
    isoStdPower,
    isoStdNcaa,
    wObp,
    wSlg,
    wAvg,
    wIso,
  };

  // Class-transition multiplier (D1→D1 only — JUCO sources use 2026 stats verbatim)
  const classKey = String(player.class_transition || "SJ").toUpperCase();
  const classAdj = isJucoSource ? 0 :
    classKey === "FS" ? 0.03 :
    classKey === "SJ" ? 0.02 :
    classKey === "JS" ? 0.015 :
    classKey === "GR" ? 0.01 : 0.02;
  const devAgg = Number.isFinite(Number(player.dev_aggressiveness))
    ? Number(player.dev_aggressiveness)
    : 0;
  const transferMultiplier = 1 + classAdj + (devAgg * 0.06);

  return {
    blocked: false,
    inputs,
    transferMultiplier,
    classAdj,
    isJucoSource,
  };
}

// ---------- postprocess: apply transferMultiplier + derive composite stats ----------
//
// Mirrors the post-`computeTransferProjection` math in TransferPortal.tsx
// (lines ~1468-1481). Kept here so script + page derive identical values.

export type TransferProjectionFinal = {
  pAvg: number;
  pObp: number;
  pSlg: number;
  pOps: number;
  pIso: number;
  pWrc: number;
  pWrcPlus: number | null;
  owar: number | null;
};

export function applyTransferPostprocess(
  projected: TransferProjectionOutput,
  inputs: TransferProjectionInputs,
  transferMultiplier: number,
  opts?: { plateAppearances?: number; runsPerPa?: number },
): TransferProjectionFinal {
  const pAvg = projected.pAvg * transferMultiplier;
  const pObp = projected.pObp * transferMultiplier;
  const pIso = projected.pIso * transferMultiplier;
  const pSlg = pAvg + pIso;
  const pOps = pObp + pSlg;
  const { wObp, wSlg, wAvg, wIso, ncaaAvgWrc } = inputs;
  const pWrc = (wObp * pObp) + (wSlg * pSlg) + (wAvg * pAvg) + (wIso * pIso);
  const pWrcPlus = ncaaAvgWrc === 0 ? null : Math.round((pWrc / ncaaAvgWrc) * 100);
  const offValue = pWrcPlus == null ? null : (pWrcPlus - 100) / 100;
  const pa = opts?.plateAppearances ?? 260;
  const runsPerPa = opts?.runsPerPa ?? 0.13;
  const replacementRuns = (pa / 600) * 25;
  const raa = offValue == null ? null : offValue * pa * runsPerPa;
  const rar = raa == null ? null : raa + replacementRuns;
  const owar = rar == null ? null : rar / 10;
  return { pAvg, pObp, pSlg, pOps, pIso, pWrc, pWrcPlus, owar };
}
