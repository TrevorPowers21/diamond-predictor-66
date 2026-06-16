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

// JUCO pitcher transfer overrides — mirrors src/lib/transferWeightDefaults.ts
// 2026-05-24 calibration: era/fip competition 0.706 → 1.0, bb9 0.45 → 0.30
const JUCO_PITCHING_TRANSFER_WEIGHTS = {
  transfer_era_power_weight: 0, transfer_fip_power_weight: 0, transfer_whip_power_weight: 0,
  transfer_k9_power_weight: 0, transfer_bb9_power_weight: 0, transfer_hr9_power_weight: 0,
  transfer_era_conference_weight: 0.235, transfer_fip_conference_weight: 0.155,
  transfer_whip_conference_weight: 0.133, transfer_k9_conference_weight: 0.198,
  transfer_bb9_conference_weight: 0.215, transfer_hr9_conference_weight: 0.433,
  transfer_era_competition_weight: 1.0, transfer_fip_competition_weight: 1.0,
  transfer_whip_competition_weight: 0.706, transfer_k9_competition_weight: 0.40,
  transfer_bb9_competition_weight: 0.30, transfer_hr9_competition_weight: 0.40,
  transfer_era_park_weight: 0, transfer_fip_park_weight: 0,
  transfer_whip_park_weight: 0, transfer_hr9_park_weight: 0,
} as const;

// JUCO district → Conference Stats UUID. Player records store "NJCAA D1 <District>"
// but Conference Stats key by "NJCAA D1 <District> District" — use this map to
// bridge. Same UUIDs as src/lib/transferWeightDefaults.ts.
const JUCO_DISTRICT_CONFERENCE_ID: Record<string, string> = {
  "Appalachian": "c4e84625-014b-4043-ad18-ef6d633cb7ba",
  "East": "2981eac4-b979-42a5-abba-9520bd5b34ff",
  "Mid-South": "9b3228bc-1ebf-4b83-a626-d11b192912b3",
  "Midwest": "95f8d637-dfc3-4dca-a6c4-dd23ec925fca",
  "Plains": "53edabac-5a3f-44ef-a877-04d2eb99ef19",
  "South": "0afebb9f-39a5-48ae-ae04-85a8e5212e7e",
  "South Atlantic": "0ff9293a-1df2-41b3-ad9c-736b49cdd289",
  "South Central": "e0e70823-79c5-4362-a33d-a80bfa82b97e",
  "Southwest": "05f74671-1341-4ec6-aa2a-e7ae0f9c5e3f",
  "West": "1516195f-ca3d-4e61-af05-354a1fd256a6",
};

// HTP override per district — replaces inflated raw JUCO HTP with realistic
// D1-tier-equivalents (NEC to MWC range). Calibrated 2026-05-17, kept as-is.
const JUCO_DISTRICT_HTP_OVERRIDE: Record<string, number> = {
  "South Atlantic": 94, "Mid-South": 88, "Southwest": 85, "Plains": 82,
  "Appalachian": 78, "Midwest": 75, "South": 73, "West": 71,
  "South Central": 68, "East": 65,
  // D2 conferences routed through this map via detectJucoPitcherSource D2 branch
  "Gulf South Conference": 66,
};

function jucoDistrictNameFromConference(conference: string | null | undefined): string | null {
  if (!conference) return null;
  const stripped = String(conference).replace(/^NJCAA D1 /i, "").replace(/ District$/i, "").trim();
  return stripped || null;
}

function transferWeightsForSource(division: string | null | undefined) {
  // D2 routed through JUCO weights (zero power, zero park) — D2 hitters have
  // slash lines but no TruMedia power-rating data. Mirrors src/lib edit.
  if (division === "NJCAA_D1" || division === "D2") return JUCO_TRANSFER_WEIGHTS;
  return TRANSFER_WEIGHT_DEFAULTS;
}

function pitcherTransferWeightsForSource(division: string | null | undefined) {
  // D2 routed through the JUCO pitching engine — same zero-power / zero-park
  // path. Conference HTP comes from JUCO_DISTRICT_HTP_OVERRIDE keyed by full
  // conference name (e.g. "Gulf South Conference"). Mirrors src/lib edit.
  if (division === "NJCAA_D1" || division === "D2") return JUCO_PITCHING_TRANSFER_WEIGHTS;
  return null;
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

  // D2 routed through the JUCO hitter path — same outlier regression + JUCO
  // weights. Matches src/lib/buildTransferProjectionInputs.ts.
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
  // Prefer pred's class_transition. Derive from class_year (FR→FS / SO→SJ /
  // JR→JS / SR→GR) when class_transition is null. Default-to-SJ on the bare
  // string fallback mislabels freshmen as sophomores and produces wrong
  // class adjustment + bad p_wrc_plus on their first precompute.
  const classFromYear = (cy: string | null | undefined) => {
    if (!cy) return "SJ";
    const c = String(cy).toUpperCase();
    if (c === "FR") return "FS";
    if (c === "SO") return "SJ";
    if (c === "JR") return "JS";
    if (c === "SR") return "GR";
    return "SJ";
  };
  const classKey = String(player.class_transition || classFromYear(player.class_year)).toUpperCase();
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
// MATH: ports of src/lib/pitchingEquations.ts (DEFAULT_PITCHING_WEIGHTS)
// + src/lib/transferPitcherProjection.ts + src/lib/buildTransferPitcherInputs.ts
// + src/lib/depthRoles.ts (computePitcherWar / computePitcherMarketValue)
// MUST stay in lockstep with src/lib changes — see header note.
// ─────────────────────────────────────────────────────────────────────────

const PITCHING_EQ_DEFAULTS = {
  fip_plus_weight: 0.30, era_plus_weight: 0.25, whip_plus_weight: 0.15,
  k9_plus_weight: 0.15, bb9_plus_weight: 0.10, hr9_plus_weight: 0.05,
  era_plus_ncaa_avg: 6.21, era_plus_ncaa_sd: 1.587898316, era_pr_sd: 29.48780404, era_plus_scale: 20,
  fip_plus_ncaa_avg: 5.08, fip_plus_ncaa_sd: 1.000197585, fip_pr_sd: 22.20492306, fip_plus_scale: 20,
  whip_plus_ncaa_avg: 1.64, whip_plus_ncaa_sd: 0.2521159606, whip_pr_sd: 24.58561805, whip_plus_scale: 20,
  k9_plus_ncaa_avg: 8.21, k9_plus_ncaa_sd: 1.990147058, k9_pr_sd: 43.76562188, k9_plus_scale: 20,
  bb9_plus_ncaa_avg: 4.82, bb9_plus_ncaa_sd: 1.340745984, bb9_pr_sd: 42.89490618, bb9_plus_scale: 20,
  hr9_plus_ncaa_avg: 1.12, hr9_plus_ncaa_sd: 0.4677282102, hr9_pr_sd: 34.13833398, hr9_plus_scale: 20,
  pwar_ip_sp: 85, pwar_ip_rp: 35, pwar_ip_sm: 50,
  pwar_r_per_9: 7.11, pwar_replacement_runs_per_9: 1.5, pwar_runs_per_win: 10,
  sp_to_rp_reg_era_pct: 6, sp_to_rp_reg_fip_pct: 8, sp_to_rp_reg_whip_pct: 5,
  sp_to_rp_reg_k9_pct: -8, sp_to_rp_reg_bb9_pct: 4, sp_to_rp_reg_hr9_pct: 8,
  rp_to_sp_low_better_tier1_max: 2.1, rp_to_sp_low_better_tier2_max: 2.6, rp_to_sp_low_better_tier3_max: 3.25,
  rp_to_sp_low_better_tier1_mult: 4.0, rp_to_sp_low_better_tier2_mult: 3.0, rp_to_sp_low_better_tier3_mult: 2.0,
  market_tier_sec: 1.5, market_tier_acc_big12: 1.2, market_tier_big_ten: 1.0, market_tier_strong_mid: 0.8, market_tier_low_major: 0.5,
  market_dollars_per_war: 25000,
  market_pvf_weekend_sp: 1.2, market_pvf_weekday_sp: 1.0, market_pvf_reliever: 1.0,
  class_era_fs: 3.0, class_era_sj: 2.0, class_era_js: 1.5, class_era_gr: 1.0,
  class_fip_fs: 3.0, class_fip_sj: 2.5, class_fip_js: 1.5, class_fip_gr: 1.0,
  class_whip_fs: 2.5, class_whip_sj: 2.0, class_whip_js: 1.5, class_whip_gr: 0.5,
  class_k9_fs: 3.5, class_k9_sj: 2.5, class_k9_js: 1.5, class_k9_gr: 1.0,
  class_bb9_fs: 4.5, class_bb9_sj: 3.5, class_bb9_js: 2.5, class_bb9_gr: 1.5,
  class_hr9_fs: 2.5, class_hr9_sj: 2.0, class_hr9_js: 1.5, class_hr9_gr: 1.0,
  transfer_era_power_weight: 0.7, transfer_era_conference_weight: 0.3, transfer_era_competition_weight: 0.5, transfer_era_park_weight: 0.075,
  transfer_fip_power_weight: 0.7, transfer_fip_conference_weight: 0.3, transfer_fip_competition_weight: 0.5, transfer_fip_park_weight: 0.075,
  transfer_whip_power_weight: 0.7, transfer_whip_conference_weight: 0.3, transfer_whip_competition_weight: 0.5, transfer_whip_park_weight: 0.15,
  transfer_k9_power_weight: 0.7, transfer_k9_conference_weight: 0.4, transfer_k9_competition_weight: 0.5,
  transfer_bb9_power_weight: 0.7, transfer_bb9_conference_weight: 0.3, transfer_bb9_competition_weight: 0.5,
  transfer_hr9_power_weight: 0.7, transfer_hr9_conference_weight: 0.3, transfer_hr9_competition_weight: 0.5, transfer_hr9_park_weight: 0.05,
} as const;

type PitchingEq = typeof PITCHING_EQ_DEFAULTS;

const parkToIndex = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return 100;
  return Math.abs(v) <= 3 ? v * 100 : v;
};

const toPitchingRole = (raw: string | null | undefined): "SP" | "RP" | "SM" | null => {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "SP" || v === "RP" || v === "SM") return v;
  return null;
};

const calcPitchingPlus = (value: number | null, ncaaAvg: number, ncaaSd: number, scale: number, higherIsBetter = false) => {
  if (value == null || !Number.isFinite(value) || ncaaSd === 0) return null;
  const core = higherIsBetter ? ((value - ncaaAvg) / ncaaSd) : ((ncaaAvg - value) / ncaaSd);
  const raw = 100 + (core * scale);
  return Number.isFinite(raw) ? raw : null;
};

const applyRoleTransitionAdjustment = (
  value: number | null, pct: number,
  fromRole: "SP" | "RP" | "SM" | null, toRole: "SP" | "RP" | "SM" | null,
  lowerIsBetter: boolean,
  curve?: { tier1Max: number; tier2Max: number; tier3Max: number; tier1Mult: number; tier2Mult: number; tier3Mult: number },
) => {
  if (value == null || !Number.isFinite(value)) return null;
  if (!fromRole || !toRole || fromRole === toRole) return value;
  const rank: Record<"SP" | "SM" | "RP", number> = { SP: 0, SM: 1, RP: 2 };
  const step = rank[toRole] - rank[fromRole];
  if (step === 0) return value;
  const movingTowardStarter = rank[toRole] < rank[fromRole];
  const boost = (() => {
    if (!movingTowardStarter || !lowerIsBetter || !curve) return 1;
    if (value <= curve.tier1Max) return curve.tier1Mult;
    if (value <= curve.tier2Max) return curve.tier2Mult;
    if (value <= curve.tier3Max) return curve.tier3Mult;
    return 1;
  })();
  const factor = 1 + ((Math.abs(pct) / 100) * (Math.abs(step) / 2) * boost);
  if (!Number.isFinite(factor) || factor <= 0) return value;
  if (lowerIsBetter) return step > 0 ? value / factor : value * factor;
  return step > 0 ? value * factor : value / factor;
};

const projectLowerP = (
  last: number, prPlus: number, ncaaAvg: number, prSd: number, ncaaSd: number,
  powerWeight: number, confWeight: number, fromPlus: number, toPlus: number,
  compWeight: number, fromTalent: number, toTalent: number,
  parkWeight: number | null, fromPark: number | null, toPark: number | null,
  dampFactor = 1,
) => {
  const safePrSd = prSd === 0 ? 1 : prSd;
  const powerAdj = ncaaAvg - (((prPlus - 100) / safePrSd) * ncaaSd);
  const blended = (last * (1 - powerWeight)) + (powerAdj * powerWeight);
  const confTerm = confWeight * ((toPlus - fromPlus) / 100);
  const compTerm = compWeight * ((toTalent - fromTalent) / 100);
  const parkTerm = parkWeight != null && fromPark != null && toPark != null ? parkWeight * ((toPark - fromPark) / 100) : 0;
  const mult = 1 - confTerm + compTerm + parkTerm;
  const adjustedMult = 1 + ((mult - 1) * dampFactor);
  return blended * adjustedMult;
};

const projectHigherP = (
  last: number, prPlus: number, ncaaAvg: number, prSd: number, ncaaSd: number,
  powerWeight: number, confWeight: number, fromPlus: number, toPlus: number,
  compWeight: number, fromTalent: number, toTalent: number,
) => {
  const safePrSd = prSd === 0 ? 1 : prSd;
  const powerAdj = ncaaAvg + (((prPlus - 100) / safePrSd) * ncaaSd);
  const blended = (last * (1 - powerWeight)) + (powerAdj * powerWeight);
  const confTerm = confWeight * ((toPlus - fromPlus) / 100);
  const compTerm = compWeight * ((toTalent - fromTalent) / 100);
  const mult = 1 + confTerm - compTerm;
  return blended * mult;
};

const programTierMultiplier = (conference: string | null | undefined, tiers: { sec: number; p4: number; bigTen: number; strongMid: number; lowMajor: number }) => {
  const c = String(conference || "").toLowerCase();
  if (!c) return tiers.lowMajor;
  if (c.includes("southeastern") || c === "sec") return tiers.sec;
  if (c.includes("atlantic coast") || c === "acc" || c.includes("big 12")) return tiers.p4;
  if (c.includes("big ten")) return tiers.bigTen;
  if (/(american|sun belt|big west|mountain west|mwc|aac)/.test(c)) return tiers.strongMid;
  return tiers.lowMajor;
};

const pvfForRole = (role: "SP" | "RP" | "SM", eq: PitchingEq) =>
  role === "RP" ? eq.market_pvf_reliever : role === "SM" ? eq.market_pvf_weekday_sp : eq.market_pvf_weekend_sp;

const canShowPitcherMarket = (team: string | null | undefined, conf: string | null | undefined) => {
  const c = String(conf || "").trim().toLowerCase();
  const t = String(team || "").trim().toLowerCase();
  if (!c) return false;
  const indep = c === "independent" || c.includes("independent");
  if (!indep) return true;
  return t === "oregon state" || t.includes("oregon state");
};

const computePitcherWar = (pRvPlus: number | null, projectedIp: number, eq: PitchingEq) => {
  if (pRvPlus == null || !Number.isFinite(pRvPlus) || projectedIp <= 0 || eq.pwar_runs_per_win === 0) return null;
  const pitcherValue = (pRvPlus - 100) / 100;
  const innings = projectedIp / 9;
  return ((pitcherValue * innings * eq.pwar_r_per_9) + (innings * eq.pwar_replacement_runs_per_9)) / eq.pwar_runs_per_win;
};

const computePitcherMarketValue = (
  pWar: number | null, ctx: { conference: string | null; role: "SP" | "RP" | "SM"; team: string | null }, eq: PitchingEq,
) => {
  if (pWar == null || !Number.isFinite(pWar)) return null;
  if (!canShowPitcherMarket(ctx.team, ctx.conference)) return null;
  const tiers = { sec: eq.market_tier_sec, p4: eq.market_tier_acc_big12, bigTen: eq.market_tier_big_ten, strongMid: eq.market_tier_strong_mid, lowMajor: eq.market_tier_low_major };
  const ptm = programTierMultiplier(ctx.conference, tiers);
  const pvm = pvfForRole(ctx.role, eq);
  return Math.max(0, pWar * eq.market_dollars_per_war * ptm * pvm);
};

type TransferPitcherInputDeno = {
  era: number; fip: number; whip: number; k9: number; bb9: number; hr9: number;
  storedPrPlus: { era: number; fip: number; whip: number; k9: number; bb9: number; hr9: number };
  baseRole: "SP" | "RP" | "SM" | null;
  fromEraPlus: number; toEraPlus: number; fromFipPlus: number; toFipPlus: number;
  fromWhipPlus: number; toWhipPlus: number; fromK9Plus: number; toK9Plus: number;
  fromBb9Plus: number; toBb9Plus: number; fromHr9Plus: number; toHr9Plus: number;
  fromHitterTalent: number; toHitterTalent: number;
  fromEraParkRaw: number | null; toEraParkRaw: number | null;
  fromWhipParkRaw: number | null; toWhipParkRaw: number | null;
  fromHr9ParkRaw: number | null; toHr9ParkRaw: number | null;
  toTeam: string | null; toConference: string | null;
};

function computeTransferPitcherProjection(input: TransferPitcherInputDeno, eq: PitchingEq) {
  const baseRole = input.baseRole;
  const projectedRole: "SP" | "RP" | "SM" = baseRole || "SM";
  const projectedIp = projectedRole === "SP" ? eq.pwar_ip_sp : projectedRole === "RP" ? eq.pwar_ip_rp : eq.pwar_ip_sm;

  const fromRg = input.fromEraParkRaw != null ? parkToIndex(input.fromEraParkRaw) : null;
  const toRg = input.toEraParkRaw != null ? parkToIndex(input.toEraParkRaw) : null;
  const fromWhipPf = input.fromWhipParkRaw != null ? parkToIndex(input.fromWhipParkRaw) : null;
  const toWhipPf = input.toWhipParkRaw != null ? parkToIndex(input.toWhipParkRaw) : null;
  const fromHr9Pf = input.fromHr9ParkRaw != null ? parkToIndex(input.fromHr9ParkRaw) : null;
  const toHr9Pf = input.toHr9ParkRaw != null ? parkToIndex(input.toHr9ParkRaw) : null;

  const pEra = projectLowerP(input.era, input.storedPrPlus.era, eq.era_plus_ncaa_avg, eq.era_pr_sd, eq.era_plus_ncaa_sd, eq.transfer_era_power_weight, eq.transfer_era_conference_weight, input.fromEraPlus, input.toEraPlus, eq.transfer_era_competition_weight, input.fromHitterTalent, input.toHitterTalent, eq.transfer_era_park_weight, fromRg, toRg);
  const pFip = projectLowerP(input.fip, input.storedPrPlus.fip, eq.fip_plus_ncaa_avg, eq.fip_pr_sd, eq.fip_plus_ncaa_sd, eq.transfer_fip_power_weight, eq.transfer_fip_conference_weight, input.fromFipPlus, input.toFipPlus, eq.transfer_fip_competition_weight, input.fromHitterTalent, input.toHitterTalent, eq.transfer_fip_park_weight, fromRg, toRg);
  const pWhip = projectLowerP(input.whip, input.storedPrPlus.whip, eq.whip_plus_ncaa_avg, eq.whip_pr_sd, eq.whip_plus_ncaa_sd, eq.transfer_whip_power_weight, eq.transfer_whip_conference_weight, input.fromWhipPlus, input.toWhipPlus, eq.transfer_whip_competition_weight, input.fromHitterTalent, input.toHitterTalent, eq.transfer_whip_park_weight, fromWhipPf, toWhipPf, 0.75);
  const pK9 = projectHigherP(input.k9, input.storedPrPlus.k9, eq.k9_plus_ncaa_avg, eq.k9_pr_sd, eq.k9_plus_ncaa_sd, eq.transfer_k9_power_weight, eq.transfer_k9_conference_weight, input.fromK9Plus, input.toK9Plus, eq.transfer_k9_competition_weight, input.fromHitterTalent, input.toHitterTalent);
  const pBb9 = projectLowerP(input.bb9, input.storedPrPlus.bb9, eq.bb9_plus_ncaa_avg, eq.bb9_pr_sd, eq.bb9_plus_ncaa_sd, eq.transfer_bb9_power_weight, eq.transfer_bb9_conference_weight, input.fromBb9Plus, input.toBb9Plus, eq.transfer_bb9_competition_weight, input.fromHitterTalent, input.toHitterTalent, null, null, null);
  const pHr9 = projectLowerP(input.hr9, input.storedPrPlus.hr9, eq.hr9_plus_ncaa_avg, eq.hr9_pr_sd, eq.hr9_plus_ncaa_sd, eq.transfer_hr9_power_weight, eq.transfer_hr9_conference_weight, input.fromHr9Plus, input.toHr9Plus, eq.transfer_hr9_competition_weight, input.fromHitterTalent, input.toHitterTalent, eq.transfer_hr9_park_weight, fromHr9Pf, toHr9Pf);

  const roleCurve = {
    tier1Max: eq.rp_to_sp_low_better_tier1_max, tier2Max: eq.rp_to_sp_low_better_tier2_max, tier3Max: eq.rp_to_sp_low_better_tier3_max,
    tier1Mult: eq.rp_to_sp_low_better_tier1_mult, tier2Mult: eq.rp_to_sp_low_better_tier2_mult, tier3Mult: eq.rp_to_sp_low_better_tier3_mult,
  };
  const rEra = applyRoleTransitionAdjustment(pEra, eq.sp_to_rp_reg_era_pct, baseRole, projectedRole, true, roleCurve);
  const rFip = applyRoleTransitionAdjustment(pFip, eq.sp_to_rp_reg_fip_pct, baseRole, projectedRole, true, roleCurve);
  const rWhip = applyRoleTransitionAdjustment(pWhip, eq.sp_to_rp_reg_whip_pct, baseRole, projectedRole, true, roleCurve);
  const rK9 = applyRoleTransitionAdjustment(pK9, eq.sp_to_rp_reg_k9_pct, baseRole, projectedRole, false, roleCurve);
  const rBb9 = applyRoleTransitionAdjustment(pBb9, eq.sp_to_rp_reg_bb9_pct, baseRole, projectedRole, true, roleCurve);
  const rHr9 = applyRoleTransitionAdjustment(pHr9, eq.sp_to_rp_reg_hr9_pct, baseRole, projectedRole, true, roleCurve);

  const eraPlus = calcPitchingPlus(rEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
  const fipPlus = calcPitchingPlus(rFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
  const whipPlus = calcPitchingPlus(rWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
  const k9Plus = calcPitchingPlus(rK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
  const bb9Plus = calcPitchingPlus(rBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
  const hr9Plus = calcPitchingPlus(rHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);

  const pRvPlus = [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
    ? (eq.era_plus_weight * Number(eraPlus)) + (eq.fip_plus_weight * Number(fipPlus)) + (eq.whip_plus_weight * Number(whipPlus))
      + (eq.k9_plus_weight * Number(k9Plus)) + (eq.bb9_plus_weight * Number(bb9Plus)) + (eq.hr9_plus_weight * Number(hr9Plus))
    : null;

  const pWar = computePitcherWar(pRvPlus, projectedIp, eq);
  const marketValue = computePitcherMarketValue(pWar, { conference: input.toConference, role: projectedRole, team: input.toTeam }, eq);
  return { p_era: rEra, p_fip: rFip, p_whip: rWhip, p_k9: rK9, p_bb9: rBb9, p_hr9: rHr9, p_rv_plus: pRvPlus, p_war: pWar, market_value: marketValue, projected_role: projectedRole };
}

function applyPitcherPostprocess(
  result: ReturnType<typeof computeTransferPitcherProjection>,
  args: { classTransition: string | null; classYear: string | null; devAggressiveness: number | null; isJucoSource: boolean; eq: PitchingEq; toConference: string | null; toTeam: string | null },
) {
  const eq = args.eq;
  // Prefer pred's class_transition. Derive from class_year (FR→FS / SO→SJ /
  // JR→JS / SR→GR) when class_transition is null. Default-to-SJ on the bare
  // string fallback mislabels freshmen and produces wrong adjustment.
  const classFromYear = (cy: string | null | undefined) => {
    if (!cy) return "SJ";
    const c = String(cy).toUpperCase();
    if (c === "FR") return "FS";
    if (c === "SO") return "SJ";
    if (c === "JR") return "JS";
    if (c === "SR") return "GR";
    return "SJ";
  };
  const classKey = String(args.classTransition || classFromYear(args.classYear)).toUpperCase();
  const ct = (args.isJucoSource ? "SJ" : ((["FS", "SJ", "JS", "GR"].includes(classKey) ? classKey : "SJ") as "FS" | "SJ" | "JS" | "GR"));
  const devAgg = args.isJucoSource ? 0 : (Number.isFinite(Number(args.devAggressiveness)) ? Number(args.devAggressiveness) : 0);
  const cAdj = (fs: number, sj: number, js: number, gr: number) => {
    const v = ct === "FS" ? fs : ct === "SJ" ? sj : ct === "JS" ? js : gr;
    return Number.isFinite(v) ? v / 100 : 0;
  };
  const lowMult = (a: number) => 1 - a - (devAgg * 0.06);
  const highMult = (a: number) => 1 + a + (devAgg * 0.06);

  const ceA = args.isJucoSource ? 0 : cAdj(eq.class_era_fs, eq.class_era_sj, eq.class_era_js, eq.class_era_gr);
  const cfA = args.isJucoSource ? 0 : cAdj(eq.class_fip_fs, eq.class_fip_sj, eq.class_fip_js, eq.class_fip_gr);
  const cwA = args.isJucoSource ? 0 : cAdj(eq.class_whip_fs, eq.class_whip_sj, eq.class_whip_js, eq.class_whip_gr);
  const ckA = args.isJucoSource ? 0 : cAdj(eq.class_k9_fs, eq.class_k9_sj, eq.class_k9_js, eq.class_k9_gr);
  const cbA = args.isJucoSource ? 0 : cAdj(eq.class_bb9_fs, eq.class_bb9_sj, eq.class_bb9_js, eq.class_bb9_gr);
  const chA = args.isJucoSource ? 0 : cAdj(eq.class_hr9_fs, eq.class_hr9_sj, eq.class_hr9_js, eq.class_hr9_gr);

  const aE = result.p_era == null ? null : result.p_era * lowMult(ceA);
  const aF = result.p_fip == null ? null : result.p_fip * lowMult(cfA);
  const aW = result.p_whip == null ? null : result.p_whip * lowMult(cwA);
  const aK = result.p_k9 == null ? null : result.p_k9 * highMult(ckA);
  const aB = result.p_bb9 == null ? null : result.p_bb9 * lowMult(cbA);
  const aH = result.p_hr9 == null ? null : result.p_hr9 * lowMult(chA);

  const eP = calcPitchingPlus(aE, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale);
  const fP = calcPitchingPlus(aF, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale);
  const wP = calcPitchingPlus(aW, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale);
  const kP = calcPitchingPlus(aK, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
  const bP = calcPitchingPlus(aB, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale);
  const hP = calcPitchingPlus(aH, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale);

  const pRvPlusAdj = [eP, fP, wP, kP, bP, hP].every((v) => v != null)
    ? (Number(eP) * eq.era_plus_weight) + (Number(fP) * eq.fip_plus_weight) + (Number(wP) * eq.whip_plus_weight)
      + (Number(kP) * eq.k9_plus_weight) + (Number(bP) * eq.bb9_plus_weight) + (Number(hP) * eq.hr9_plus_weight)
    : result.p_rv_plus;

  const ipForRole = result.projected_role === "SP" ? eq.pwar_ip_sp : result.projected_role === "RP" ? eq.pwar_ip_rp : eq.pwar_ip_sm;
  const recomputedPWar = pRvPlusAdj != null ? computePitcherWar(pRvPlusAdj, ipForRole, eq) : result.p_war;
  const recomputedMarketValue = recomputedPWar != null
    ? computePitcherMarketValue(recomputedPWar, { conference: args.toConference, role: result.projected_role, team: args.toTeam }, eq)
    : result.market_value;

  return { p_era: aE, p_fip: aF, p_whip: aW, p_k9: aK, p_bb9: aB, p_hr9: aH, p_rv_plus: pRvPlusAdj, p_war: recomputedPWar, market_value: recomputedMarketValue, pitcher_role: result.projected_role, projected_ip: ipForRole };
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

// ── Hitter oWAR + market value (mirrors src/lib/depthRoles.ts + nilProgramSpecific.ts) ──
const HITTER_DOLLARS_PER_WAR = 25000;
const NIL_TIER_MULTIPLIERS = { sec: 1.5, p4: 1.2, bigTen: 1.0, strongMid: 0.8, lowMajor: 0.5 };
const STRONG_MID_KEYS = new Set([
  "americanathleticconference","aac","sunbeltconference","sunbelt",
  "bigwestconference","bigwest","mountainwestconference","mountainwest",
]);
function normalizeConferenceKey(c: string | null | undefined): string {
  return (c || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function getProgramTierMultiplierByConference(c: string | null | undefined): number {
  const key = normalizeConferenceKey(c);
  if (!key) return NIL_TIER_MULTIPLIERS.lowMajor;
  if (key.includes("southeasternconference") || key === "sec") return NIL_TIER_MULTIPLIERS.sec;
  if (key.includes("bigten")) return NIL_TIER_MULTIPLIERS.bigTen;
  if (key.includes("atlanticcoastconference") || key === "acc" || key.includes("big12")) return NIL_TIER_MULTIPLIERS.p4;
  if (STRONG_MID_KEYS.has(key)) return NIL_TIER_MULTIPLIERS.strongMid;
  return NIL_TIER_MULTIPLIERS.lowMajor;
}
function getPositionValueMultiplier(position: string | null | undefined): number {
  const pos = (position || "").trim().toUpperCase();
  if (["C","CATCHER","SS","SHORTSTOP","CF","CENTER FIELD","CENTERFIELD"].includes(pos)) return 1.3;
  if (["2B","SECOND BASE","SECONDBASE","3B","THIRD BASE","THIRDBASE","LF","RF","CORNER OUTFIELD","COF","OF","OUTFIELD"].includes(pos)) return 1.1;
  if (["1B","FIRST BASE","FIRSTBASE","DH","DESIGNATED HITTER","DESIGNATEDHITTER","UT","UTL","UTIL","UTILITY"].includes(pos)) return 1.0;
  if (["BENCH","BENCH UTILITY","BENCHUTILITY"].includes(pos)) return 0.8;
  return 1.0;
}
// Auto-assign depth role from last-season PA (mirrors defaultHitterDepthRoleFromActualPa in src/lib/depthRoles.ts)
type HitterDepthRoleAuto = "cornerstone" | "everyday_starter" | "platoon_starter" | "utility" | "bench";
function defaultHitterDepthRoleFromActualPa(pa: number | null | undefined): HitterDepthRoleAuto {
  const safePa = Number.isFinite(Number(pa)) ? Number(pa) : 0;
  if (safePa >= 220) return "cornerstone";
  if (safePa >= 130) return "everyday_starter";
  if (safePa >= 50)  return "platoon_starter";
  if (safePa >= 15)  return "utility";
  return "bench";
}
// Canonical PA-per-depth-role (mirrors paForHitterDepthRole in src/lib/depthRoles.ts)
function paForHitterDepthRole(role: HitterDepthRoleAuto): number {
  switch (role) {
    case "cornerstone":      return 245;
    case "everyday_starter": return 215;
    case "platoon_starter":  return 145;
    case "utility":          return 85;
    case "bench":            return 25;
  }
}
// Auto-assign pitcher depth role from last-season IP + role (mirrors
// defaultPitcherDepthRoleFromIp in src/pages/team-builder/helpers.ts).
type PitcherDepthRoleAuto =
  | "weekend_starter" | "weekday_starter" | "swing_starter"
  | "workhorse_reliever" | "high_leverage_reliever" | "mid_leverage_reliever"
  | "low_impact_reliever" | "specialist_reliever";
function defaultPitcherDepthRoleFromIp(ip: number | null | undefined, role: "SP" | "RP" | "SM"): PitcherDepthRoleAuto {
  const r: "SP" | "RP" = role === "SP" ? "SP" : "RP";  // SM treated as RP variant
  const ipNum = Number(ip);
  if (!Number.isFinite(ipNum) || ipNum <= 0) {
    return r === "SP" ? "weekend_starter" : "high_leverage_reliever";
  }
  if (r === "SP") {
    if (ipNum >= 65) return "weekend_starter";
    if (ipNum >= 35) return "weekday_starter";
    return "swing_starter";
  }
  if (ipNum >= 40) return "workhorse_reliever";
  if (ipNum >= 25) return "high_leverage_reliever";
  if (ipNum >= 15) return "mid_leverage_reliever";
  if (ipNum >= 8) return "low_impact_reliever";
  return "specialist_reliever";
}
// Projected IP per granular pitcher depth role (mirrors pitcherExpectedIp in
// src/lib/depthRoles.ts). Drives the IP term inside the pWAR formula.
function ipForPitcherDepthRole(
  depthRole: PitcherDepthRoleAuto,
  eq: { pwar_ip_sp: number; pwar_ip_sm: number; pwar_ip_rp: number },
): number {
  switch (depthRole) {
    case "weekend_starter":        return eq.pwar_ip_sp;  // ~80 IP
    case "weekday_starter":        return eq.pwar_ip_sm;  // ~50 IP
    case "swing_starter":          return 30;
    case "workhorse_reliever":     return 50;
    case "high_leverage_reliever": return 33;
    case "mid_leverage_reliever":  return 20;
    case "low_impact_reliever":    return 12;
    case "specialist_reliever":    return 6;
    default:                       return eq.pwar_ip_rp;
  }
}
function computeHitterOWar(wrcPlus: number | null | undefined, depthRole: HitterDepthRoleAuto): number | null {
  if (wrcPlus == null || !Number.isFinite(wrcPlus)) return null;
  const pa = paForHitterDepthRole(depthRole);
  const replacementRuns = (pa / 600) * 25;
  const raa = ((wrcPlus - 100) / 100) * pa * 0.13;
  return (raa + replacementRuns) / 10;
}
function computeHitterMarketValue(oWar: number | null, conference: string | null | undefined, position: string | null | undefined): number | null {
  if (oWar == null || !Number.isFinite(oWar)) return null;
  const ptm = getProgramTierMultiplierByConference(conference);
  const pvm = getPositionValueMultiplier(position);
  return Math.max(0, oWar * HITTER_DOLLARS_PER_WAR * ptm * pvm);
}

async function runPrecomputeForTeam(supabase: any, customerTeamId: string, scope: string) {
  if (scope === "pitchers_d1" || scope === "pitchers_juco") return runPitcherPrecompute(supabase, customerTeamId, scope);
  return runHitterPrecompute(supabase, customerTeamId, scope);
}

async function runHitterPrecompute(supabase: any, customerTeamId: string, scope: string) {
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
    const direct = k ? (confByKey.get(k) ?? null) : null;
    if (direct) return direct;
    // JUCO district fallback — players.conference stores "NJCAA D1 <District>"
    // but Conference Stats keys by "NJCAA D1 <District> District". Mirrors the
    // pitcher resolver + scripts/precompute-transfer-projections.ts.
    const jucoName = jucoDistrictNameFromConference(name);
    if (jucoName) {
      const jucoId = JUCO_DISTRICT_CONFERENCE_ID[jucoName];
      if (jucoId && confById.has(jucoId)) return confById.get(jucoId);
    }
    return null;
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
    supabase.from("players").select("id, first_name, last_name, position, team, from_team, conference, division, bats_hand, source_team_id, pa, is_twp, class_year"),
  );
  const isPitcher = (p: string | null) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(p || ""));
  const matchesDivision = (d: string | null) => {
    if (scope === "juco") return d === "NJCAA_D1";
    return d !== "NJCAA_D1"; // hitters_d1 / default
  };
  const hitters = allPlayers.filter((p: any) =>
    (!isPitcher(p.position) || p.is_twp)
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
        class_year: (p as any).class_year ?? null,
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

    // Auto-assign depth role from raw PA; projected_pa is the tier value.
    const hitterDepthRole = defaultHitterDepthRoleFromActualPa((p as any).pa ?? null);
    const projectedPa = paForHitterDepthRole(hitterDepthRole);
    const oWar = computeHitterOWar(final.pWrcPlus, hitterDepthRole);
    const marketValue = computeHitterMarketValue(oWar, toConference, p.position);
    // TWP routing: hitter side MV goes to twp_hitter_market_value, raw
    // market_value is NULL'd. Pitcher loop will populate twp_pitcher_market_value
    // separately. Avoids the previous stomp where the pitcher loop's MV
    // overwrote the hitter loop's MV on the shared column.
    const isTwpRow = !!(p as any).is_twp;

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
      o_war: oWar,
      market_value: isTwpRow ? null : marketValue,
      twp_hitter_market_value: isTwpRow ? marketValue : null,
      projected_pa: projectedPa,
      hitter_depth_role: hitterDepthRole,
      locked: false,
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

  // Forward hitter scouting scores (barrel/ev/contact/chase) onto the newly
  // upserted precomputed rows so Player Dashboard chip rendering matches the
  // global regular variant. Without this, a freshly precomputed customer team
  // ships with NULL chip fields on every row.
  const { error: propErr } = await supabase.rpc(
    "propagate_hitter_scores_to_predictions",
    { target_season: CURRENT_SEASON },
  );
  if (propErr) console.error("hitter score propagation failed:", propErr);

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
// WORKER: pitcher precompute for one customer team
// Mirrors scripts/precompute-pitchers.ts logic.
// ─────────────────────────────────────────────────────────────────────────

async function runPitcherPrecompute(supabase: any, customerTeamId: string, scope: string = "pitchers_d1") {
  const isJucoScope = scope === "pitchers_juco";
  const JUCO_IP_THRESHOLD = 20;
  // JUCO scope uses the dedicated JUCO weight overrides — zeroes power
  // weights and park weights, swaps in JUCO conference/competition weights.
  // Mirrors src/lib/buildTransferPitcherInputs.ts line 190.
  const eq: typeof PITCHING_EQ_DEFAULTS = isJucoScope
    ? { ...PITCHING_EQ_DEFAULTS, ...JUCO_PITCHING_TRANSFER_WEIGHTS }
    : PITCHING_EQ_DEFAULTS;

  // Resolve customer team → destination
  const { data: ct, error: ctErr } = await supabase
    .from("customer_teams").select("id, name, school_team_id")
    .eq("id", customerTeamId).maybeSingle();
  if (ctErr) throw ctErr;
  if (!ct || !ct.school_team_id) throw new Error(`customer_team ${customerTeamId} has no school_team_id`);

  const { data: toTeamRow } = await supabase
    .from("Teams Table").select("id, full_name, abbreviation, source_id, conference, conference_id")
    .eq("id", ct.school_team_id).maybeSingle();
  if (!toTeamRow) throw new Error(`no Teams Table row for school_team_id ${ct.school_team_id}`);

  const toTeam = { id: toTeamRow.id as string, name: (toTeamRow.full_name || toTeamRow.abbreviation) as string };
  const toConference: string | null = toTeamRow.conference;
  const toConferenceId: string | null = toTeamRow.conference_id;
  const toSourceId: string | null = toTeamRow.source_id;

  // Conference Stats — pitching plus values + hitter talent plus
  const { data: confRows } = await supabase
    .from("Conference Stats").select("*").eq("season", CURRENT_SEASON);
  const confByKey = new Map<string, any>();
  const confById = new Map<string, any>();
  for (const r of confRows || []) {
    const row = {
      era_plus: r.era_plus != null ? Number(r.era_plus) : null,
      fip_plus: r.fip_plus != null ? Number(r.fip_plus) : null,
      whip_plus: r.whip_plus != null ? Number(r.whip_plus) : null,
      k9_plus: r.k9_plus != null ? Number(r.k9_plus) : null,
      bb9_plus: r.bb9_plus != null ? Number(r.bb9_plus) : null,
      hr9_plus: r.hr9_plus != null ? Number(r.hr9_plus) : null,
      hitter_talent_plus: r.Overall_Power_Rating != null ? Number(r.Overall_Power_Rating) : null,
    };
    const k = normalizeKey(r["conference abbreviation"]);
    if (k) confByKey.set(k, row);
    if (r.conference_id) confById.set(r.conference_id, row);
  }
  const resolvePitchingConfStats = (name: string | null, id: string | null) => {
    if (id && confById.has(id)) return confById.get(id);
    const k = normalizeKey(name);
    const direct = k ? (confByKey.get(k) ?? null) : null;
    if (direct) return direct;
    // JUCO district fallback — players.conference stores "NJCAA D1 <District>"
    // but Conference Stats keys by "NJCAA D1 <District> District". Mirrors the
    // resolution in scripts/precompute-pitchers.ts.
    const jucoName = jucoDistrictNameFromConference(name);
    if (jucoName) {
      const jucoId = JUCO_DISTRICT_CONFERENCE_ID[jucoName];
      if (jucoId && confById.has(jucoId)) return confById.get(jucoId);
    }
    return null;
  };

  // Park Factors — pitcher uses rg_factor (era), whip_factor, hr9_factor
  const { data: parkRows } = await supabase
    .from("Park Factors").select("*").eq("season", CURRENT_SEASON);
  const parkByTeamId = new Map<string, any>();
  const parkBySourceId = new Map<string, any>();
  for (const r of parkRows || []) {
    const comp = {
      era: r.rg_factor != null ? Number(r.rg_factor) : null,
      whip: r.whip_factor != null ? Number(r.whip_factor) : null,
      hr9: r.hr9_factor != null ? Number(r.hr9_factor) : null,
    };
    if (r.team_id) parkByTeamId.set(r.team_id, comp);
    if (r.source_team_id) parkBySourceId.set(String(r.source_team_id), comp);
  }
  const resolveParkFactor = (teamId: string | null | undefined, _names: any, metric: "era" | "whip" | "hr9") => {
    if (!teamId) return null;
    const row = parkByTeamId.get(teamId);
    if (!row) return null;
    const v = row[metric];
    return v != null && Number.isFinite(v) ? v : null;
  };

  // Teams Table for from-team resolution
  const allTeams = await loadAllPaged(() =>
    supabase.from("Teams Table").select("id, full_name, abbreviation, source_id, conference, conference_id").eq("Season", CURRENT_SEASON),
  );
  const teamByName = new Map<string, any>();
  for (const t of allTeams) {
    const row = { id: t.id as string, name: (t.full_name || t.abbreviation) as string, conference: t.conference ?? null, conference_id: t.conference_id ?? null };
    for (const k of [t.full_name, t.abbreviation, t.source_id]) {
      const nk = normalizeKey(k);
      if (nk) teamByName.set(nk, row);
    }
  }

  // Players — pitcher-primary OR is_twp, exclude own roster, division-scoped
  const allPlayers = await loadAllPaged(() =>
    supabase.from("players").select("id, first_name, last_name, position, team, from_team, conference, division, source_player_id, source_team_id, is_twp, class_year, ip"),
  );
  const pitcherTest = (p: string | null) => /^(SP|RP|CL|P|LHP|RHP|SM)/i.test(String(p || ""));
  const matchesDivision = (d: string | null) => isJucoScope ? d === "NJCAA_D1" : d !== "NJCAA_D1";
  const pitchers = allPlayers.filter((p: any) => {
    if (!(pitcherTest(p.position) || p.is_twp)) return false;
    if (toSourceId && p.source_team_id === toSourceId) return false;
    if (!matchesDivision(p.division)) return false;
    // JUCO IP floor — mirrors scripts/precompute-pitchers.ts to drop tiny-sample noise
    if (isJucoScope && p.division === "NJCAA_D1" && (Number(p.ip) || 0) < JUCO_IP_THRESHOLD) return false;
    return true;
  });

  // Pitching Master — for each pitcher's last-season stats + PR+
  const sourceIds = pitchers.map((p: any) => p.source_player_id).filter(Boolean) as string[];
  const pmRows: any[] = [];
  for (let i = 0; i < sourceIds.length; i += PRED_ID_BATCH) {
    const chunk = sourceIds.slice(i, i + PRED_ID_BATCH);
    const r = await loadAllPaged(() =>
      supabase.from("Pitching Master").select("source_player_id, Role, G, GS, ERA, FIP, WHIP, K9, BB9, HR9, era_pr_plus, fip_pr_plus, whip_pr_plus, k9_pr_plus, bb9_pr_plus, hr9_pr_plus, TeamID")
        .eq("Season", CURRENT_SEASON).in("source_player_id", chunk),
    );
    pmRows.push(...r);
  }
  const pmBySourceId = new Map<string, any>();
  for (const r of pmRows) pmBySourceId.set(String(r.source_player_id), r);

  // Latest active predictions per pitcher (for class_transition + dev_aggressiveness carry)
  const playerIds = pitchers.map((p: any) => p.id);
  const predRows: any[] = [];
  for (let i = 0; i < playerIds.length; i += PRED_ID_BATCH) {
    const chunk = playerIds.slice(i, i + PRED_ID_BATCH);
    const r = await loadAllPaged(() =>
      supabase.from("player_predictions")
        .select("player_id, model_type, variant, status, class_transition, dev_aggressiveness")
        .in("player_id", chunk).in("model_type", ["returner", "transfer"])
        .is("customer_team_id", null).eq("season", PROJECTION_SEASON),
    );
    predRows.push(...r);
  }
  const predByPlayer = new Map<string, any>();
  for (const row of predRows) {
    const k = row.player_id;
    const existing = predByPlayer.get(k);
    if (!existing || (row.variant === "regular" && existing.variant !== "regular")) predByPlayer.set(k, row);
  }

  const blockReasons = new Map<string, number>();
  const diag = {
    confRows: confRows?.length ?? 0,
    parkRows: parkRows?.length ?? 0,
    teamsRows: allTeams.length,
    pitchersInScope: pitchers.length,
    pmRows: pmRows.length,
    predRows: predRows.length,
  };

  const upserts: any[] = [];
  let blocked = 0;
  for (const p of pitchers) {
    const pm = p.source_player_id ? pmBySourceId.get(String(p.source_player_id)) : null;
    if (!pm) { blocked++; blockReasons.set("no_pm_row", (blockReasons.get("no_pm_row") || 0) + 1); continue; }

    const pred = predByPlayer.get(p.id);
    const fromTeamName = (p.from_team || p.team || "") as string;
    const fromTeamRow = teamByName.get(normalizeKey(fromTeamName)) || null;
    const fromConference = fromTeamRow?.conference || p.conference || null;
    const fromConferenceId = fromTeamRow?.conference_id || null;

    const fromPC = resolvePitchingConfStats(fromConference, fromConferenceId);
    const toPC = resolvePitchingConfStats(toConference, toConferenceId);
    if (!fromPC) { blocked++; blockReasons.set("no_from_conf", (blockReasons.get("no_from_conf") || 0) + 1); continue; }
    if (!toPC) { blocked++; blockReasons.set("no_to_conf", (blockReasons.get("no_to_conf") || 0) + 1); continue; }

    // Validate raw stats + PR+
    const required = [pm.ERA, pm.FIP, pm.WHIP, pm.K9, pm.BB9, pm.HR9, pm.era_pr_plus, pm.fip_pr_plus, pm.whip_pr_plus, pm.k9_pr_plus, pm.bb9_pr_plus, pm.hr9_pr_plus];
    if (required.some((v) => v == null)) { blocked++; blockReasons.set("missing_stats_or_pr", (blockReasons.get("missing_stats_or_pr") || 0) + 1); continue; }

    // Derive base role
    const roleRaw = toPitchingRole(pm.Role);
    const baseRole: "SP" | "RP" | "SM" | null = roleRaw ?? (
      pm.G && pm.GS != null ? ((Number(pm.GS) / Number(pm.G)) < 0.5 ? "RP" : "SP") : null
    );

    const input: TransferPitcherInputDeno = {
      era: Number(pm.ERA), fip: Number(pm.FIP), whip: Number(pm.WHIP),
      k9: Number(pm.K9), bb9: Number(pm.BB9), hr9: Number(pm.HR9),
      storedPrPlus: {
        era: Number(pm.era_pr_plus), fip: Number(pm.fip_pr_plus), whip: Number(pm.whip_pr_plus),
        k9: Number(pm.k9_pr_plus), bb9: Number(pm.bb9_pr_plus), hr9: Number(pm.hr9_pr_plus),
      },
      baseRole,
      fromEraPlus: Number(fromPC.era_plus ?? 100), toEraPlus: Number(toPC.era_plus ?? 100),
      fromFipPlus: Number(fromPC.fip_plus ?? 100), toFipPlus: Number(toPC.fip_plus ?? 100),
      fromWhipPlus: Number(fromPC.whip_plus ?? 100), toWhipPlus: Number(toPC.whip_plus ?? 100),
      fromK9Plus: Number(fromPC.k9_plus ?? 100), toK9Plus: Number(toPC.k9_plus ?? 100),
      fromBb9Plus: Number(fromPC.bb9_plus ?? 100), toBb9Plus: Number(toPC.bb9_plus ?? 100),
      fromHr9Plus: Number(fromPC.hr9_plus ?? 100), toHr9Plus: Number(toPC.hr9_plus ?? 100),
      // JUCO source: replace raw district Overall_Power_Rating with the
      // calibrated HTP override (Mountain West / Horizon equivalents per
      // district). Without this, each JUCO district uses its inflated raw
      // value and pitchers get inconsistent regressions across districts.
      // Mirrors src/lib/buildTransferPitcherInputs.ts line 196-198.
      fromHitterTalent: (() => {
        if (p.division === "NJCAA_D1") {
          const district = jucoDistrictNameFromConference(p.conference);
          const override = district ? JUCO_DISTRICT_HTP_OVERRIDE[district] : undefined;
          if (override != null) return override;
        }
        if (p.division === "D2") {
          // D2 conferences key directly by full conference name (no NJCAA prefix
          // to strip). Match src/lib path.
          const confKey = String(p.conference || "").trim();
          const override = confKey ? JUCO_DISTRICT_HTP_OVERRIDE[confKey] : undefined;
          if (override != null) return override;
        }
        return Number(fromPC.hitter_talent_plus ?? 100);
      })(),
      toHitterTalent: Number(toPC.hitter_talent_plus ?? 100),
      fromEraParkRaw: resolveParkFactor(fromTeamRow?.id ?? null, null, "era"),
      toEraParkRaw: resolveParkFactor(toTeam.id, null, "era"),
      fromWhipParkRaw: resolveParkFactor(fromTeamRow?.id ?? null, null, "whip"),
      toWhipParkRaw: resolveParkFactor(toTeam.id, null, "whip"),
      fromHr9ParkRaw: resolveParkFactor(fromTeamRow?.id ?? null, null, "hr9"),
      toHr9ParkRaw: resolveParkFactor(toTeam.id, null, "hr9"),
      toTeam: toTeam.name, toConference,
    };

    const projected = computeTransferPitcherProjection(input, eq);
    const final = applyPitcherPostprocess(projected, {
      classTransition: pred?.class_transition ?? null,
      classYear: (p as any).class_year ?? null,
      devAggressiveness: pred?.dev_aggressiveness ?? null,
      // For JUCO scope, mark source as JUCO so postprocess zeroes class
      // transitions and dev aggressiveness adjustments (which D1-only).
      // D2 routed through same path — same zero-power / zero-park behavior.
      isJucoSource: p.division === "NJCAA_D1" || p.division === "D2",
      eq,
      toConference,
      toTeam: toTeam.name,
    });

    // TWP routing: pitcher side MV goes to twp_pitcher_market_value, raw
    // market_value is left untouched (NULL'd by the hitter loop for TWPs).
    // Non-TWP pitcher-only rows write to market_value normally.
    const isTwpRow = !!(p as any).is_twp;
    // Auto-derive granular depth role from player's actual IP + coarse role
    // (mirrors hitter_depth_role's storage pattern).
    const pitcherDepthRole = defaultPitcherDepthRoleFromIp((p as any).ip ?? null, final.pitcher_role);
    // Recompute pWAR + market value using the granular depth role's projected IP.
    // Without this, a weekday_starter would get pWAR off the coarse SP/RP/SM IP
    // (e.g. 85 IP instead of 50), inflating both pWAR and MV.
    const depthIp = ipForPitcherDepthRole(pitcherDepthRole, eq);
    const recomputedPWar = final.p_rv_plus != null ? computePitcherWar(final.p_rv_plus, depthIp, eq) : final.p_war;
    const recomputedMarketValue = recomputedPWar != null
      ? computePitcherMarketValue(recomputedPWar, { conference: toConference, role: final.pitcher_role, team: toTeam.name }, eq)
      : final.market_value;
    upserts.push({
      player_id: p.id,
      customer_team_id: customerTeamId,
      model_type: "transfer",
      variant: "precomputed",
      season: PROJECTION_SEASON,
      status: "active",
      class_transition: pred?.class_transition ?? null,
      dev_aggressiveness: pred?.dev_aggressiveness ?? null,
      p_era: final.p_era,
      p_fip: final.p_fip,
      p_whip: final.p_whip,
      p_k9: final.p_k9,
      p_bb9: final.p_bb9,
      p_hr9: final.p_hr9,
      p_rv_plus: final.p_rv_plus,
      p_war: recomputedPWar,
      market_value: isTwpRow ? null : recomputedMarketValue,
      twp_pitcher_market_value: isTwpRow ? recomputedMarketValue : null,
      projected_ip: depthIp,
      pitcher_role: final.pitcher_role,
      pitcher_depth_role: pitcherDepthRole,
      locked: false,
      updated_at: new Date().toISOString(),
    });
  }

  for (let i = 0; i < upserts.length; i += UPSERT_BATCH) {
    const slice = upserts.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from("player_predictions").upsert(slice, {
      onConflict: "player_id,customer_team_id,model_type,variant,season",
    });
    if (error) throw new Error(`pitcher batch ${i / UPSERT_BATCH + 1} failed: ${error.message}`);
  }

  // Forward pitcher scouting scores (whiff/iz_whiff/barrel/chase/ev/bb) onto
  // the newly upserted precomputed pitcher rows. Same rationale as the hitter
  // propagate above — without this, a fresh customer team has NULL pitcher
  // chip fields.
  const { error: propErr } = await supabase.rpc(
    "propagate_pitcher_scores_to_predictions",
    { target_season: CURRENT_SEASON },
  );
  if (propErr) console.error("pitcher score propagation failed:", propErr);

  const topBlockReasons: Record<string, number> = {};
  for (const [k, v] of [...blockReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) topBlockReasons[k] = v;
  return { computed: upserts.length, blocked, total: pitchers.length, diag: { ...diag, topBlockReasons } };
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
