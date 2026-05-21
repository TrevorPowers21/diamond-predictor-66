// process-precompute-jobs — worker for the eager pre-compute queue
//
// HOW IT'S TRIGGERED:
//   1. AFTER INSERT trigger on customer_teams inserts a precompute_jobs row
//      and `pg_net.http_post`s this endpoint with { jobId }.
//   2. Admin "Re-run" button can call directly with { customerTeamId, scope }.
//   3. Manual POST: { jobId } to process one specific pending job.
//
// WHAT IT DOES:
//   1. Claim the job (UPDATE status='pending' → 'running' WHERE id=:jobId).
//   2. Load all lookups (equation values, conference stats, park factors,
//      Teams Table, players, predictions, internals).
//   3. For each in-scope hitter, compute the transfer projection.
//   4. UPSERT rows into player_predictions (variant='precomputed').
//   5. Mark job 'completed' with rows_written.
//
// IMPORTANT — math duplication:
//   The math (computeTransferProjection, computeHitterPowerRatings, JUCO
//   regression, weight defaults) is duplicated from src/lib/. Supabase Edge
//   Functions run on Deno and can't `import` from the Vite src tree.
//   If you change math in src/lib/transferProjection.ts, src/lib/powerRatings.ts,
//   src/lib/transferWeightDefaults.ts, or src/lib/buildTransferProjectionInputs.ts,
//   YOU MUST ALSO UPDATE THIS FILE. Keep them in lockstep.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─────────────────────────────────────────────────────────────────────────
// MATH: ports of src/lib/transferWeightDefaults.ts
// ─────────────────────────────────────────────────────────────────────────

const TRANSFER_WEIGHT_DEFAULTS = {
  t_ba_conference_weight: 0.30,
  t_obp_conference_weight: 0.30,
  t_iso_conference_weight: 0.15,
  t_ba_pitching_weight: 1.00,
  t_obp_pitching_weight: 0.85,
  t_iso_pitching_weight: 0.75,
  t_ba_park_weight: 0.24,
  t_obp_park_weight: 0.26,
  t_iso_park_weight: 0.11,
  t_ba_power_weight: 0.70,
  t_obp_power_weight: 0.70,
  t_iso_power_weight: 0.70,
} as const;

const JUCO_TRANSFER_WEIGHTS = {
  t_ba_conference_weight: 0.42,
  t_obp_conference_weight: 0.43,
  t_iso_conference_weight: 0.20,
  t_ba_pitching_weight: 1.30,
  t_obp_pitching_weight: 1.13,
  t_iso_pitching_weight: 0.92,
  t_ba_park_weight: 0,
  t_obp_park_weight: 0,
  t_iso_park_weight: 0,
  t_ba_power_weight: 0,
  t_obp_power_weight: 0,
  t_iso_power_weight: 0,
} as const;

const JUCO_REGRESSION_CONFIG = {
  avg: { mean: 0.280, threshold: 0.350, slope: 1.12, maxR: 0.10 },
  obp: { mean: 0.385, threshold: 0.450, slope: 0.85, maxR: 0.10 },
  iso: { mean: 0.162, threshold: 0.280, slope: 1.50, maxR: 0.15 },
} as const;

function transferWeightsForSource(division: string | null | undefined) {
  return division === "NJCAA_D1" ? JUCO_TRANSFER_WEIGHTS : TRANSFER_WEIGHT_DEFAULTS;
}

function applyJucoOutlierRegression(
  rawStat: number, ncaaMean: number, threshold: number, slope: number, maxR: number,
): number {
  if (!Number.isFinite(rawStat) || rawStat <= threshold) return rawStat;
  const r = Math.min(maxR, (rawStat - threshold) * slope);
  return rawStat * (1 - r) + ncaaMean * r;
}

// ─────────────────────────────────────────────────────────────────────────
// MATH: port of src/lib/powerRatings.ts (just computeHitterPowerRatings)
// ─────────────────────────────────────────────────────────────────────────

const erf = (x: number) => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
};

const scoreFromNormal = (x: number | null, mean: number, sd: number, invert = false): number | null => {
  if (x == null || sd <= 0) return null;
  const cdf = 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
  const pct = cdf * 100;
  return invert ? 100 - pct : pct;
};

const HITTER_DEFAULTS = {
  contact: { mean: 77.1, sd: 6.6 },
  lineDrive: { mean: 20.9, sd: 4.31 },
  avgExitVelo: { mean: 86.2, sd: 4.28 },
  popUp: { mean: 7.9, sd: 3.37, invert: true },
  bb: { mean: 11.4, sd: 3.57 },
  chase: { mean: 23.1, sd: 5.58, invert: true },
  barrel: { mean: 17.3, sd: 7.89 },
  ev90: { mean: 103.1, sd: 3.97 },
  pull: { mean: 36.5, sd: 8.03 },
  la10_30: { mean: 29, sd: 6.81 },
  gb: { mean: 43.2, sd: 8.0, invert: true },
} as const;

function computeHitterPowerRatings(raw: any): { baPlus: number | null; obpPlus: number | null; isoPlus: number | null } {
  const s = (key: keyof typeof HITTER_DEFAULTS, val: any) => {
    const d = HITTER_DEFAULTS[key] as any;
    return scoreFromNormal(val, d.mean, d.sd, d.invert ?? false);
  };
  const contactScore = s("contact", raw.contact);
  const lineDriveScore = s("lineDrive", raw.lineDrive);
  const avgEVScore = s("avgExitVelo", raw.avgExitVelo);
  const popUpScore = s("popUp", raw.popUp);
  const bbScore = s("bb", raw.bb);
  const chaseScore = s("chase", raw.chase);
  const barrelScore = s("barrel", raw.barrel);
  const ev90Score = s("ev90", raw.ev90);
  const pullScore = s("pull", raw.pull);
  const laScore = s("la10_30", raw.la10_30);
  const gbScore = s("gb", raw.gb);

  const baPower = (contactScore == null || lineDriveScore == null || avgEVScore == null || popUpScore == null)
    ? null : (0.4 * contactScore) + (0.25 * lineDriveScore) + (0.2 * avgEVScore) + (0.15 * popUpScore);
  const obpPower = (contactScore == null || lineDriveScore == null || avgEVScore == null || popUpScore == null || bbScore == null || chaseScore == null)
    ? null : (0.35 * contactScore) + (0.2 * lineDriveScore) + (0.15 * avgEVScore) + (0.1 * popUpScore) + (0.15 * bbScore) + (0.05 * chaseScore);
  const isoPower = (barrelScore == null || ev90Score == null || pullScore == null || laScore == null || gbScore == null)
    ? null : (0.45 * barrelScore) + (0.3 * ev90Score) + (0.15 * pullScore) + (0.05 * laScore) + (0.05 * gbScore);

  const toPlus = (v: number | null) => (v == null ? null : (v / 50) * 100);
  return { baPlus: toPlus(baPower), obpPlus: toPlus(obpPower), isoPlus: toPlus(isoPower) };
}

// ─────────────────────────────────────────────────────────────────────────
// MATH: port of src/lib/transferProjection.ts (computeTransferProjection)
// ─────────────────────────────────────────────────────────────────────────

type TransferProjectionInputs = any;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function computeTransferProjection(input: TransferProjectionInputs) {
  const fromBaPark = input.fromBaPark ?? input.fromPark;
  const toBaPark = input.toBaPark ?? input.toPark;
  const fromObpPark = input.fromObpPark ?? input.fromPark;
  const toObpPark = input.toObpPark ?? input.toPark;
  const fromIsoPark = input.fromIsoPark ?? input.fromPark;
  const toIsoPark = input.toIsoPark ?? input.toPark;

  const safeBaStdPower = input.baStdPower === 0 ? 1 : input.baStdPower;
  const baScaled = input.ncaaAvgBA + (((input.baPR - 100) / safeBaStdPower) * input.baStdNcaa);
  const baBlended = input.lastAvg * (1 - input.baPowerWeight) + baScaled * input.baPowerWeight;
  const baMultiplier = 1
    + (input.baConferenceWeight * ((input.toAvgPlus - input.fromAvgPlus) / 100))
    - (input.baPitchingWeight * ((input.toStuff - input.fromStuff) / 100))
    + (input.baParkWeight * ((toBaPark - fromBaPark) / 100));
  const pAvgRaw = baBlended * baMultiplier;

  const safeObpStdPower = input.obpStdPower === 0 ? 1 : input.obpStdPower;
  const obpScaled = input.ncaaAvgOBP + (((input.obpPR - 100) / safeObpStdPower) * input.obpStdNcaa);
  const obpBlended = input.lastObp * (1 - input.obpPowerWeight) + obpScaled * input.obpPowerWeight;
  const obpMultiplier = 1
    + (input.obpConferenceWeight * ((input.toObpPlus - input.fromObpPlus) / 100))
    - (input.obpPitchingWeight * ((input.toStuff - input.fromStuff) / 100))
    + (input.obpParkWeight * ((toObpPark - fromObpPark) / 100));
  const pObpRaw = obpBlended * obpMultiplier;

  const lastIso = input.lastSlg - input.lastAvg;
  const ratingZ = input.isoStdPower > 0 ? (input.isoPR - 100) / input.isoStdPower : 0;
  const scaledIso = input.ncaaAvgISO + (ratingZ * input.isoStdNcaa);
  const isoPowerWeight = input.isoPowerWeight ?? 0.7;
  const isoBlended = (lastIso * (1 - isoPowerWeight)) + (scaledIso * isoPowerWeight);
  const isoMultiplier = 1
    + (input.isoConferenceWeight * ((input.toIsoPlus - input.fromIsoPlus) / 100))
    - (input.isoPitchingWeight * ((input.toStuff - input.fromStuff) / 100))
    + (input.isoParkWeight * ((toIsoPark - fromIsoPark) / 100));
  const pIsoRaw = isoBlended * isoMultiplier;

  const pSlgRaw = pAvgRaw + pIsoRaw;
  const pOpsRaw = pObpRaw + pSlgRaw;
  const pWrcRaw = (input.wObp * pObpRaw) + (input.wSlg * pSlgRaw) + (input.wAvg * pAvgRaw) + (input.wIso * pIsoRaw);
  const pWrcPlus = input.ncaaAvgWrc === 0 ? null : Math.round((pWrcRaw / input.ncaaAvgWrc) * 100);

  return {
    pAvg: round3(pAvgRaw),
    pObp: round3(pObpRaw),
    pIso: round3(pIsoRaw),
    pSlg: round3(pSlgRaw),
    pOps: round3(pOpsRaw),
    pWrc: round3(pWrcRaw),
    pWrcPlus,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// MATH: port of src/lib/parkFactors.ts (handedness + resolver)
// ─────────────────────────────────────────────────────────────────────────

function batsHandToHandedness(bats: string | null | undefined): "lhb" | "rhb" | "switch" | null {
  if (!bats) return null;
  const x = String(bats).trim().toUpperCase();
  if (x === "L") return "lhb";
  if (x === "R") return "rhb";
  if (x === "S" || x === "B") return "switch";
  return null;
}

function handednessKey(metric: "avg" | "obp" | "iso", hand: "lhb" | "rhb" | "switch" | null | undefined): string {
  // Switch hitters use combined factor; lhb/rhb get split fields when present.
  if (hand === "lhb") return `lhb_${metric}`;
  if (hand === "rhb") return `rhb_${metric}`;
  return metric; // switch or null → combined
}

function pickParkFactor(components: any, metric: "avg" | "obp" | "iso", hand: "lhb" | "rhb" | "switch" | null) {
  if (!components) return null;
  const splitKey = handednessKey(metric, hand);
  const splitVal = components[splitKey];
  if (splitVal != null && Number.isFinite(Number(splitVal))) return Number(splitVal);
  const combined = components[metric];
  if (combined != null && Number.isFinite(Number(combined))) return Number(combined);
  return null;
}

function normalizeParkToIndex(n: number | null): number {
  if (n == null || !Number.isFinite(n)) return 100;
  return Math.abs(n) <= 2 ? n * 100 : n;
}

// ─────────────────────────────────────────────────────────────────────────
// MATH: port of src/lib/buildTransferProjectionInputs.ts (the main builder)
// ─────────────────────────────────────────────────────────────────────────

const toRate = (n: number) => (Math.abs(n) > 1 ? n / 100 : n);
const toWeight = (n: number) => (Math.abs(n) >= 10 ? n / 100 : n);

function readEquationValue(key: string, fallback: number, remoteValues: Record<string, number>): number {
  const remote = remoteValues[key];
  if (Number.isFinite(remote)) return Number(remote);
  const canonical = (TRANSFER_WEIGHT_DEFAULTS as Record<string, number>)[key];
  if (canonical !== undefined) return canonical;
  return fallback;
}

function buildHitterTransferInputs(args: {
  player: any;
  fromTeam: { id: string | null; name: string | null; conference: string | null; conference_id: string | null } | null;
  toTeam: { id: string; name: string };
  toConference: string | null;
  toConferenceId: string | null;
  internals: { avg_power_rating: number | null; obp_power_rating: number | null; slg_power_rating: number | null } | null;
  seedPower?: any;
  resolveConferenceHitting: (name: string | null, id: string | null) => any;
  resolveParkFactor: (teamId: string | null, teamName: string | null, metric: "avg" | "obp" | "iso", hand: any) => number | null;
  remoteEquationValues: Record<string, number>;
}) {
  const { player, fromTeam, toTeam, toConference, toConferenceId, internals, seedPower,
    resolveConferenceHitting, resolveParkFactor, remoteEquationValues } = args;

  const missingInputs: string[] = [];
  const rawLastAvg = player.from_avg;
  const rawLastObp = player.from_obp;
  const rawLastSlg = player.from_slg;
  if (rawLastAvg == null) missingInputs.push("Last AVG");
  if (rawLastObp == null) missingInputs.push("Last OBP");
  if (rawLastSlg == null) missingInputs.push("Last SLG");

  const isJucoSource = player.division === "NJCAA_D1";
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

  let baPR = internals?.avg_power_rating ?? null;
  let obpPR = internals?.obp_power_rating ?? null;
  let isoPR = internals?.slg_power_rating ?? null;
  if ((baPR == null || obpPR == null || isoPR == null) && seedPower) {
    const c = computeHitterPowerRatings(seedPower);
    if (baPR == null) baPR = c.baPlus;
    if (obpPR == null) obpPR = c.obpPlus;
    if (isoPR == null) isoPR = c.isoPlus;
  }

  if (!isJucoSource) {
    if (baPR == null) missingInputs.push("BA Power Rating+");
    if (obpPR == null) missingInputs.push("OBP Power Rating+");
    if (isoPR == null) missingInputs.push("ISO Power Rating+");
  }

  const fromConfStats = resolveConferenceHitting(fromTeam?.conference ?? null, fromTeam?.conference_id ?? null);
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
  const fromParkAvgRaw = resolveParkFactor(fromTeam?.id ?? null, fromTeam?.name ?? null, "avg", playerHand);
  const toParkAvgRaw = resolveParkFactor(toTeam.id, toTeam.name, "avg", playerHand);
  const fromParkObpRaw = resolveParkFactor(fromTeam?.id ?? null, fromTeam?.name ?? null, "obp", playerHand);
  const toParkObpRaw = resolveParkFactor(toTeam.id, toTeam.name, "obp", playerHand);
  const fromParkIsoRaw = resolveParkFactor(fromTeam?.id ?? null, fromTeam?.name ?? null, "iso", playerHand);
  const toParkIsoRaw = resolveParkFactor(toTeam.id, toTeam.name, "iso", playerHand);

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

  if (missingInputs.length > 0) return { blocked: true as const, missingInputs };

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

  const srcW = transferWeightsForSource(player.division);
  const jw = (k: keyof typeof srcW, d1: number) => isJucoSource ? srcW[k] : d1;
  const baPowerWeight = toRate(jw("t_ba_power_weight", readEquationValue("t_ba_power_weight", 0.70, remoteEquationValues)));
  const obpPowerWeight = toRate(jw("t_obp_power_weight", readEquationValue("t_obp_power_weight", 0.70, remoteEquationValues)));
  const baConferenceWeight = toWeight(jw("t_ba_conference_weight", readEquationValue("t_ba_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_conference_weight, remoteEquationValues)));
  const obpConferenceWeight = toWeight(jw("t_obp_conference_weight", readEquationValue("t_obp_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_conference_weight, remoteEquationValues)));
  const isoConferenceWeight = toWeight(jw("t_iso_conference_weight", readEquationValue("t_iso_conference_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_conference_weight, remoteEquationValues)));
  const baPitchingWeight = toWeight(jw("t_ba_pitching_weight", readEquationValue("t_ba_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_pitching_weight, remoteEquationValues)));
  const obpPitchingWeight = toWeight(jw("t_obp_pitching_weight", readEquationValue("t_obp_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_pitching_weight, remoteEquationValues)));
  const isoPitchingWeight = toWeight(jw("t_iso_pitching_weight", readEquationValue("t_iso_pitching_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_pitching_weight, remoteEquationValues)));
  const baParkWeight = toWeight(jw("t_ba_park_weight", readEquationValue("t_ba_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_ba_park_weight, remoteEquationValues)));
  const obpParkWeight = toWeight(jw("t_obp_park_weight", readEquationValue("t_obp_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_obp_park_weight, remoteEquationValues)));
  const isoParkWeight = toWeight(jw("t_iso_park_weight", readEquationValue("t_iso_park_weight", TRANSFER_WEIGHT_DEFAULTS.t_iso_park_weight, remoteEquationValues)));

  const isoStdPower = readEquationValue("t_iso_std_power", 45.423, remoteEquationValues);
  const isoStdNcaa = toRate(readEquationValue("t_iso_std_ncaa", 0.07849797197, remoteEquationValues));
  const wObp = toRate(readEquationValue("r_w_obp", 0.45, remoteEquationValues));
  const wSlg = toRate(readEquationValue("r_w_slg", 0.30, remoteEquationValues));
  const wAvg = toRate(readEquationValue("r_w_avg", 0.15, remoteEquationValues));
  const wIso = toRate(readEquationValue("r_w_iso", 0.10, remoteEquationValues));

  const safePR = (v: number | null) => v ?? 100;
  const inputs = {
    lastAvg: lastAvg as number, lastObp: lastObp as number, lastSlg: lastSlg as number,
    baPR: safePR(baPR), obpPR: safePR(obpPR), isoPR: safePR(isoPR),
    fromAvgPlus, toAvgPlus, fromObpPlus, toObpPlus, fromIsoPlus, toIsoPlus,
    fromStuff, toStuff,
    fromPark: fromBaPark, toPark: toBaPark,
    fromBaPark, toBaPark, fromObpPark, toObpPark, fromIsoPark, toIsoPark,
    ncaaAvgBA, ncaaAvgOBP, ncaaAvgISO, ncaaAvgWrc,
    baStdPower, baStdNcaa, obpStdPower, obpStdNcaa,
    baPowerWeight, obpPowerWeight,
    baConferenceWeight, obpConferenceWeight, isoConferenceWeight,
    baPitchingWeight, obpPitchingWeight, isoPitchingWeight,
    baParkWeight, obpParkWeight, isoParkWeight,
    isoStdPower, isoStdNcaa, wObp, wSlg, wAvg, wIso,
  };

  // class-transition + dev_aggressiveness multiplier (D1 → D1 only)
  const classKey = String(player.class_transition || "SJ").toUpperCase();
  const classAdj = isJucoSource ? 0
    : classKey === "FS" ? 0.03
    : classKey === "SJ" ? 0.02
    : classKey === "JS" ? 0.015
    : classKey === "GR" ? 0.01 : 0.02;
  const devAgg = Number.isFinite(Number(player.dev_aggressiveness)) ? Number(player.dev_aggressiveness) : 0;
  const transferMultiplier = 1 + classAdj + (devAgg * 0.06);

  return { blocked: false as const, inputs, transferMultiplier, isJucoSource };
}

function applyTransferPostprocess(projected: any, inputs: any, transferMultiplier: number) {
  const pAvg = projected.pAvg * transferMultiplier;
  const pObp = projected.pObp * transferMultiplier;
  const pIso = projected.pIso * transferMultiplier;
  const pSlg = pAvg + pIso;
  const pOps = pObp + pSlg;
  const pWrc = (inputs.wObp * pObp) + (inputs.wSlg * pSlg) + (inputs.wAvg * pAvg) + (inputs.wIso * pIso);
  const pWrcPlus = inputs.ncaaAvgWrc === 0 ? null : Math.round((pWrc / inputs.ncaaAvgWrc) * 100);
  return { pAvg, pObp, pSlg, pOps, pIso, pWrc, pWrcPlus };
}

// ─────────────────────────────────────────────────────────────────────────
// WORKER: run one precompute job
// ─────────────────────────────────────────────────────────────────────────

function normalizeKey(s: string | null | undefined): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function loadAllPaged(builderFn: () => any): Promise<any[]> {
  const PAGE = 1000;
  let out: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await builderFn().range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

const CURRENT_SEASON = 2026;
const PROJECTION_SEASON = 2027;
const PRED_ID_BATCH = 200;
const UPSERT_BATCH = 500;

async function runPrecomputeForTeam(supabase: any, customerTeamId: string, scope: string) {
  // Resolve customer team → destination team
  const { data: ct, error: ctErr } = await supabase
    .from("customer_teams")
    .select("id, name, school_team_id")
    .eq("id", customerTeamId)
    .maybeSingle();
  if (ctErr) throw ctErr;
  if (!ct || !ct.school_team_id) throw new Error(`customer_team ${customerTeamId} has no school_team_id`);

  const { data: toTeamRow, error: ttErr } = await supabase
    .from("Teams Table")
    .select("id, full_name, abbreviation, source_id, conference, conference_id, Season")
    .eq("id", ct.school_team_id)
    .maybeSingle();
  if (ttErr) throw ttErr;
  if (!toTeamRow) throw new Error(`no Teams Table row for school_team_id ${ct.school_team_id}`);

  const toTeam = { id: toTeamRow.id, name: toTeamRow.full_name || toTeamRow.abbreviation };
  const toConference = toTeamRow.conference;
  const toConferenceId = toTeamRow.conference_id;
  const toSourceId = toTeamRow.source_id;

  // Equation values: global model_config + per-team overrides overlay
  const { data: globalEq } = await supabase
    .from("model_config")
    .select("config_key, config_value")
    .eq("model_type", "admin_ui")
    .eq("season", CURRENT_SEASON);
  const remoteEquationValues: Record<string, number> = {};
  for (const r of globalEq || []) remoteEquationValues[r.config_key] = Number(r.config_value);
  const { data: overrides } = await supabase
    .from("customer_team_equation_overrides")
    .select("config_key, config_value")
    .eq("customer_team_id", customerTeamId)
    .in("model_type", ["transfer", "global", "admin_ui"]);
  for (const r of overrides || []) remoteEquationValues[r.config_key] = Number(r.config_value);

  // Conference Stats (quoted table)
  const { data: confRows } = await supabase
    .from("Conference Stats")
    .select("*")
    .eq("season", CURRENT_SEASON);
  const confByKey = new Map<string, any>();
  const confById = new Map<string, any>();
  for (const r of confRows || []) {
    const row = {
      avg_plus: r.AVG != null ? Math.round((Number(r.AVG) / 0.280) * 100) : null,
      obp_plus: r.OBP != null ? Math.round((Number(r.OBP) / 0.385) * 100) : null,
      iso_plus: r.ISO != null ? Math.round((Number(r.ISO) / 0.162) * 100) : null,
      stuff_plus: r.Stuff_plus != null ? Number(r.Stuff_plus) : null,
    };
    const confName = r["conference abbreviation"];
    const k = normalizeKey(confName);
    if (k) confByKey.set(k, row);
    if (r.conference_id) confById.set(r.conference_id, row);
  }
  const resolveConferenceHitting = (name: string | null, id: string | null) => {
    if (id && confById.has(id)) return confById.get(id);
    const k = normalizeKey(name);
    return k ? confByKey.get(k) ?? null : null;
  };

  // Park Factors — map raw `avg_factor`/`lhb_avg_factor` → `avg`/`lhb_avg`
  // shape that pickParkFactor expects (mirrors src/lib/parkFactors.ts).
  // ID-only lookup: team_id (per-season) preferred, source_team_id as
  // stable secondary. No name fallback (per Trevor's direction 2026-05-21).
  const { data: parkRows } = await supabase
    .from("Park Factors")
    .select("*")
    .eq("season", CURRENT_SEASON);
  const rowToParkComponents = (r: any) => ({
    avg: r.avg_factor != null ? Number(r.avg_factor) : null,
    obp: r.obp_factor != null ? Number(r.obp_factor) : null,
    iso: r.iso_factor != null ? Number(r.iso_factor) : null,
    lhb_avg: r.lhb_avg_factor != null ? Number(r.lhb_avg_factor) : null,
    lhb_obp: r.lhb_obp_factor != null ? Number(r.lhb_obp_factor) : null,
    lhb_iso: r.lhb_iso_factor != null ? Number(r.lhb_iso_factor) : null,
    rhb_avg: r.rhb_avg_factor != null ? Number(r.rhb_avg_factor) : null,
    rhb_obp: r.rhb_obp_factor != null ? Number(r.rhb_obp_factor) : null,
    rhb_iso: r.rhb_iso_factor != null ? Number(r.rhb_iso_factor) : null,
  });
  const parkByTeamId = new Map<string, any>();
  const parkBySourceId = new Map<string, any>();
  for (const r of parkRows || []) {
    const comp = rowToParkComponents(r);
    if (r.team_id) parkByTeamId.set(r.team_id, comp);
    if (r.source_team_id) parkBySourceId.set(String(r.source_team_id), comp);
  }
  const resolveParkFactor = (teamId: string | null, _teamName: string | null, metric: "avg" | "obp" | "iso", hand: any) => {
    if (!teamId) return null;
    const row = parkByTeamId.get(teamId);
    if (!row) return null;
    return pickParkFactor(row, metric, hand);
  };

  // Teams Table — for from-team resolution
  const allTeams = await loadAllPaged(() =>
    supabase.from("Teams Table").select("id, full_name, abbreviation, source_id, conference, conference_id, Season").eq("Season", CURRENT_SEASON),
  );
  const teamByName = new Map<string, any>();
  for (const t of allTeams) {
    const row = {
      id: t.id, name: (t.full_name || t.abbreviation || "") as string,
      conference: t.conference ?? null, conference_id: t.conference_id ?? null,
    };
    for (const k of [t.full_name, t.abbreviation, t.source_id]) {
      const nk = normalizeKey(k);
      if (nk) teamByName.set(nk, row);
    }
  }

  // Players — D1 hitters only, exclude own roster
  const allPlayers = await loadAllPaged(() =>
    supabase.from("players").select("id, first_name, last_name, position, team, from_team, conference, division, bats_hand, source_team_id"),
  );
  const isPitcher = (p: string | null) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(p || ""));
  const matchesDivision = (d: string | null) => {
    if (scope === "juco") return d === "NJCAA_D1";
    return d !== "NJCAA_D1"; // hitters_d1 / default
  };
  const hitters = allPlayers.filter((p: any) =>
    !isPitcher(p.position)
    && (!toSourceId || p.source_team_id !== toSourceId)
    && matchesDivision(p.division));

  // Latest active predictions for each hitter
  const playerIds = hitters.map((p: any) => p.id);
  const predRows: any[] = [];
  for (let i = 0; i < playerIds.length; i += PRED_ID_BATCH) {
    const chunk = playerIds.slice(i, i + PRED_ID_BATCH);
    const r = await loadAllPaged(() =>
      supabase.from("player_predictions")
        .select("id, player_id, model_type, variant, status, updated_at, from_avg, from_obp, from_slg, class_transition, dev_aggressiveness")
        .in("player_id", chunk)
        .in("model_type", ["returner", "transfer"])
        .is("customer_team_id", null));
    predRows.push(...r);
  }
  const rank = (row: any) => {
    const hasFrom = row.from_avg != null || row.from_obp != null || row.from_slg != null;
    const statusBoost = row.status === "active" ? 2 : row.status === "departed" ? 1 : 0;
    const variantBoost = row.variant === "regular" ? 3 : 0;
    return (row.model_type === "transfer" ? 3 : 1) + variantBoost + statusBoost + (hasFrom ? 2 : 0);
  };
  const bestPredByPlayer = new Map<string, any>();
  for (const row of predRows) {
    const k = row.player_id as string;
    const existing = bestPredByPlayer.get(k);
    if (!existing || rank(row) > rank(existing)) bestPredByPlayer.set(k, row);
  }

  // Internals (PR+)
  const predIds = Array.from(bestPredByPlayer.values()).map((r: any) => r.id);
  const internalsRows: any[] = [];
  for (let i = 0; i < predIds.length; i += PRED_ID_BATCH) {
    const chunk = predIds.slice(i, i + PRED_ID_BATCH);
    const r = await loadAllPaged(() =>
      supabase.from("player_prediction_internals")
        .select("prediction_id, avg_power_rating, obp_power_rating, slg_power_rating")
        .in("prediction_id", chunk));
    internalsRows.push(...r);
  }
  const internalsByPredId = new Map<string, any>();
  for (const r of internalsRows) internalsByPredId.set(r.prediction_id, r);

  // Diagnostic: counts to surface in response
  const blockReasons = new Map<string, number>();
  const diagCounts = {
    confRows: confRows?.length ?? 0,
    parkRows: parkRows?.length ?? 0,
    teamsRows: allTeams.length,
    hittersInScope: hitters.length,
    predRows: predRows.length,
    internalsRows: internalsRows.length,
    bestPredsForPlayers: bestPredByPlayer.size,
    sampleConfHitting: resolveConferenceHitting(toConference, toConferenceId),
    sampleParkForToTeam: resolveParkFactor(toTeam.id, toTeam.name, "avg", "lhb"),
  };

  // Compute + accumulate UPSERTs
  const upserts: any[] = [];
  let blocked = 0;
  for (const p of hitters) {
    const pred = bestPredByPlayer.get(p.id);
    const internals = pred ? internalsByPredId.get(pred.id) : null;
    const fromTeamName = (p.from_team || p.team || "") as string;
    const fromTeamRow = teamByName.get(normalizeKey(fromTeamName)) || null;

    const result = buildHitterTransferInputs({
      player: {
        first_name: p.first_name, last_name: p.last_name,
        position: p.position, bats_hand: p.bats_hand, division: p.division,
        class_transition: pred?.class_transition ?? null,
        dev_aggressiveness: Number.isFinite(Number(pred?.dev_aggressiveness)) ? Number(pred?.dev_aggressiveness) : null,
        from_avg: pred?.from_avg ?? null, from_obp: pred?.from_obp ?? null, from_slg: pred?.from_slg ?? null,
      },
      fromTeam: fromTeamRow ? { id: fromTeamRow.id, name: fromTeamRow.name, conference: fromTeamRow.conference, conference_id: fromTeamRow.conference_id } : { id: null, name: fromTeamName, conference: p.conference ?? null, conference_id: null },
      toTeam, toConference, toConferenceId,
      internals,
      resolveConferenceHitting, resolveParkFactor,
      remoteEquationValues,
    });
    if (result.blocked) {
      blocked++;
      for (const m of result.missingInputs) blockReasons.set(m, (blockReasons.get(m) || 0) + 1);
      continue;
    }

    const projected = computeTransferProjection(result.inputs);
    const final = applyTransferPostprocess(projected, result.inputs, result.transferMultiplier);

    upserts.push({
      player_id: p.id,
      customer_team_id: customerTeamId,
      model_type: "transfer",
      variant: "precomputed",
      season: PROJECTION_SEASON,
      status: "active",
      from_avg: pred?.from_avg ?? null,
      from_obp: pred?.from_obp ?? null,
      from_slg: pred?.from_slg ?? null,
      class_transition: pred?.class_transition ?? null,
      dev_aggressiveness: pred?.dev_aggressiveness ?? null,
      p_avg: final.pAvg,
      p_obp: final.pObp,
      p_slg: final.pSlg,
      p_ops: final.pOps,
      p_iso: final.pIso,
      p_wrc: final.pWrc,
      p_wrc_plus: final.pWrcPlus,
      updated_at: new Date().toISOString(),
    });
  }

  // UPSERT in batches
  for (let i = 0; i < upserts.length; i += UPSERT_BATCH) {
    const slice = upserts.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from("player_predictions").upsert(slice, {
      onConflict: "player_id,customer_team_id,model_type,variant,season",
    });
    if (error) throw new Error(`batch ${i / UPSERT_BATCH + 1} failed: ${error.message}`);
  }

  const topBlockReasons: Record<string, number> = {};
  for (const [k, v] of [...blockReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    topBlockReasons[k] = v;
  }
  return {
    computed: upserts.length,
    blocked,
    total: hitters.length,
    diag: { ...diagCounts, topBlockReasons },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// HTTP handler
// ─────────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { jobId, customerTeamId: directTeamId, scope: directScope } = body || {};

  try {
    // Claim job (or accept direct customer_team_id for ad-hoc runs)
    let job: any = null;
    if (jobId) {
      const { data, error } = await supabase
        .from("precompute_jobs")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        return new Response(JSON.stringify({ ok: false, reason: "job not pending or not found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409,
        });
      }
      job = data;
    } else if (directTeamId) {
      // ad-hoc: create + claim in one step
      const { data, error } = await supabase
        .from("precompute_jobs")
        .insert({
          customer_team_id: directTeamId,
          scope: directScope || "hitters_d1",
          trigger_source: "manual",
          status: "running",
          started_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      job = data;
    } else {
      return new Response(JSON.stringify({ ok: false, reason: "missing jobId or customerTeamId" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    const result = await runPrecomputeForTeam(supabase, job.customer_team_id, job.scope);

    await supabase
      .from("precompute_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        rows_written: result.computed,
      })
      .eq("id", job.id);

    return new Response(JSON.stringify({ ok: true, jobId: job.id, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (jobId) {
      await supabase.from("precompute_jobs").update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: errMsg,
      }).eq("id", jobId);
    }
    return new Response(JSON.stringify({ ok: false, error: errMsg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
