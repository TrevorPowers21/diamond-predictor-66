import { readPitchingWeights } from "@/lib/pitchingEquations";
import { resolveMetricParkFactor, type ParkFactorsMap } from "@/lib/parkFactors";
import { getProgramTierMultiplierByConference } from "@/lib/nilProgramSpecific";

// Mirrors the inline pitcher projection pipeline from ReturningPlayers so other
// pages (High Follow, etc.) can produce the same projected ERA / FIP / WHIP /
// K/9 / BB/9 / HR/9 / pRV+ / pWAR / market value without duplicating the math.
// Keep this file in sync with the inline version until the DB-backed
// player_predictions mirror (hitter pattern) lands for pitchers.

const PITCHING_POWER_RATING_WEIGHT = 0.7;
const PITCHING_DEV_FACTOR = 0.06;

export type PitcherProjectionInput = {
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  stuffPlus: number | null;
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
  role: string | null;
  g: number | null;
  gs: number | null;
  team: string | null;
  teamId: string | null;
  conference: string | null;
};

export type PitcherProjectionContext = {
  eq: ReturnType<typeof readPitchingWeights>;
  powerEq: Record<string, number>;
  parkMap: ParkFactorsMap;
  teamMatch?: { id?: string | null; name?: string | null; park_factor?: number | null } | null;
  roleOverride?: "SP" | "RP" | "SM" | null;
  classTransition?: "FS" | "SJ" | "JS" | "GR";
  devAggressiveness?: number;
};

export type PitcherProjectionResult = {
  p_era: number | null;
  p_fip: number | null;
  p_whip: number | null;
  p_k9: number | null;
  p_bb9: number | null;
  p_hr9: number | null;
  p_rv_plus: number | null;
  p_war: number | null;
  market_value: number | null;
  projected_role: "SP" | "RP" | "SM";
  scores: {
    stuff: number | null;
    whiff: number | null;
    bb: number | null;
    barrel: number | null;
  };
};

// ── Helpers (mirror of the ReturningPlayers module-local versions) ─────────

const parkToIndex = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return 100;
  return Math.abs(v) <= 3 ? v * 100 : v;
};

const toPitchingClassAdj = (
  classTransition: "FS" | "SJ" | "JS" | "GR",
  fs: number,
  sj: number,
  js: number,
  gr: number,
) => {
  const pct = classTransition === "FS" ? fs : classTransition === "SJ" ? sj : classTransition === "JS" ? js : gr;
  return Number.isFinite(pct) ? pct / 100 : 0;
};

const dampFactorForProjected = (projected: number, thresholds: number[], impacts: number[]) => {
  for (let i = 0; i < thresholds.length; i++) {
    if (projected < thresholds[i]) return impacts[i] ?? 1;
  }
  return impacts[thresholds.length] ?? impacts[impacts.length - 1] ?? 1;
};

const projectPitchingRate = ({
  lastStat,
  prPlus,
  ncaaAvg,
  ncaaSd,
  prSd,
  classAdjustment,
  devAggressiveness,
  thresholds,
  impacts,
  lowerIsBetter,
}: {
  lastStat: number | null;
  prPlus: number | null;
  ncaaAvg: number;
  ncaaSd: number;
  prSd: number;
  classAdjustment: number;
  devAggressiveness: number;
  thresholds: number[];
  impacts: number[];
  lowerIsBetter: boolean;
}) => {
  if (
    lastStat == null ||
    prPlus == null ||
    !Number.isFinite(lastStat) ||
    !Number.isFinite(prPlus) ||
    !Number.isFinite(ncaaAvg) ||
    !Number.isFinite(ncaaSd) ||
    !Number.isFinite(prSd) ||
    prSd === 0
  ) {
    return null;
  }

  const zShift = ((prPlus - 100) / prSd) * ncaaSd;
  const powerAdjusted = lowerIsBetter ? (ncaaAvg - zShift) : (ncaaAvg + zShift);
  const blended = (lastStat * (1 - PITCHING_POWER_RATING_WEIGHT)) + (powerAdjusted * PITCHING_POWER_RATING_WEIGHT);
  const mult = lowerIsBetter
    ? (1 - classAdjustment - (devAggressiveness * PITCHING_DEV_FACTOR))
    : (1 + classAdjustment + (devAggressiveness * PITCHING_DEV_FACTOR));
  const projected = blended * mult;
  const delta = projected - lastStat;
  const dampFactor = dampFactorForProjected(projected, thresholds, impacts);
  return lastStat + (delta * dampFactor);
};

const toPitchingRole = (raw: string | null | undefined): "SP" | "RP" | "SM" | null => {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "SP" || v === "RP" || v === "SM") return v;
  return null;
};

const applyRoleTransitionAdjustment = (
  value: number | null,
  pct: number,
  fromRole: "SP" | "RP" | "SM" | null,
  toRole: "SP" | "RP" | "SM" | null,
  lowerIsBetter: boolean,
  rpToSpLowBetterCurve?: {
    tier1Max: number;
    tier2Max: number;
    tier3Max: number;
    tier1Mult: number;
    tier2Mult: number;
    tier3Mult: number;
  },
) => {
  if (value == null || !Number.isFinite(value)) return null;
  if (!fromRole || !toRole || fromRole === toRole) return value;
  const rank: Record<"SP" | "SM" | "RP", number> = { SP: 0, SM: 1, RP: 2 };
  const step = rank[toRole] - rank[fromRole];
  if (step === 0) return value;
  const movingTowardStarter = rank[toRole] < rank[fromRole];

  const starterRegressionBoost = (() => {
    if (!movingTowardStarter) return 1;
    if (lowerIsBetter) {
      const c = rpToSpLowBetterCurve;
      if (!c) return 1;
      if (value <= c.tier1Max) return c.tier1Mult;
      if (value <= c.tier2Max) return c.tier2Mult;
      if (value <= c.tier3Max) return c.tier3Mult;
      return 1.0;
    }
    return 1.0;
  })();

  const pctMagnitude = Math.abs(pct);
  const factor = 1 + ((pctMagnitude / 100) * (Math.abs(step) / 2) * starterRegressionBoost);
  if (!Number.isFinite(factor) || factor <= 0) return value;
  if (lowerIsBetter) {
    return step > 0 ? value / factor : value * factor;
  }
  return step > 0 ? value * factor : value / factor;
};

const normalizedWeightedSum = (items: Array<{ value: number; weight: number }>) => {
  const weighted = items.reduce((sum, item) => sum + (item.value * item.weight), 0);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  return weighted / totalWeight;
};

const normalCdf = (x: number) => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax));
  return 0.5 * (1 + erf);
};

const calcScore = (value: number | null, avg: number, sd: number, lowerIsBetter = false) => {
  if (value == null || !Number.isFinite(sd) || sd <= 0) return null;
  const pct = normalCdf((value - avg) / sd) * 100;
  return lowerIsBetter ? 100 - pct : pct;
};

const computePitchingPrPlusFromScores = (
  scores: {
    stuff: number | null;
    whiff: number | null;
    bb: number | null;
    hh: number | null;
    izWhiff: number | null;
    chase: number | null;
    barrel: number | null;
    ld: number | null;
    avgEv: number | null;
    gb: number | null;
    iz: number | null;
    ev90: number | null;
    pull: number | null;
    la1030: number | null;
  },
  eq: Record<string, number>,
) => {
  const eraPower =
    [scores.stuff, scores.whiff, scores.bb, scores.hh, scores.izWhiff, scores.chase, scores.barrel].every((v) => v != null)
      ? (Number(scores.stuff) * eq.p_era_stuff_plus_weight) +
        (Number(scores.whiff) * eq.p_era_whiff_pct_weight) +
        (Number(scores.bb) * eq.p_era_bb_pct_weight) +
        (Number(scores.hh) * eq.p_era_hh_pct_weight) +
        (Number(scores.izWhiff) * eq.p_era_in_zone_whiff_pct_weight) +
        (Number(scores.chase) * eq.p_era_chase_pct_weight) +
        (Number(scores.barrel) * eq.p_era_barrel_pct_weight)
      : null;
  const whipPower =
    [scores.bb, scores.ld, scores.avgEv, scores.whiff, scores.gb, scores.chase].every((v) => v != null)
      ? normalizedWeightedSum([
          { value: Number(scores.bb), weight: eq.p_whip_bb_pct_weight },
          { value: Number(scores.ld), weight: eq.p_whip_ld_pct_weight },
          { value: Number(scores.avgEv), weight: eq.p_whip_avg_ev_weight },
          { value: Number(scores.whiff), weight: eq.p_whip_whiff_pct_weight },
          { value: Number(scores.gb), weight: eq.p_whip_gb_pct_weight },
          { value: Number(scores.chase), weight: eq.p_whip_chase_pct_weight },
        ])
      : null;
  const k9Power =
    [scores.whiff, scores.stuff, scores.izWhiff, scores.chase].every((v) => v != null)
      ? (Number(scores.whiff) * eq.p_k9_whiff_pct_weight) +
        (Number(scores.stuff) * eq.p_k9_stuff_plus_weight) +
        (Number(scores.izWhiff) * eq.p_k9_in_zone_whiff_pct_weight) +
        (Number(scores.chase) * eq.p_k9_chase_pct_weight)
      : null;
  const bb9Power =
    [scores.bb, scores.iz, scores.chase].every((v) => v != null)
      ? (Number(scores.bb) * eq.p_bb9_bb_pct_weight) +
        (Number(scores.iz) * eq.p_bb9_in_zone_pct_weight) +
        (Number(scores.chase) * eq.p_bb9_chase_pct_weight)
      : null;
  const hr9Power =
    [scores.barrel, scores.ev90, scores.gb, scores.pull, scores.la1030].every((v) => v != null)
      ? (Number(scores.barrel) * eq.p_hr9_barrel_pct_weight) +
        (Number(scores.ev90) * eq.p_hr9_ev90_weight) +
        (Number(scores.gb) * eq.p_hr9_gb_pct_weight) +
        (Number(scores.pull) * eq.p_hr9_pull_pct_weight) +
        (Number(scores.la1030) * eq.p_hr9_la_10_30_pct_weight)
      : null;

  const eraPrPlus = eraPower == null ? null : (eraPower / eq.p_era_ncaa_avg_power_rating) * 100;
  const whipPrPlus = whipPower == null ? null : (whipPower / eq.p_ncaa_avg_whip_power_rating) * 100;
  const k9PrPlus = k9Power == null ? null : (k9Power / eq.p_ncaa_avg_k9_power_rating) * 100;
  const bb9PrPlus = bb9Power == null ? null : (bb9Power / eq.p_ncaa_avg_bb9_power_rating) * 100;
  const hr9PrPlus = hr9Power == null ? null : (hr9Power / eq.p_ncaa_avg_hr9_power_rating) * 100;
  const fipPrPlus =
    hr9PrPlus == null || bb9PrPlus == null || k9PrPlus == null
      ? null
      : (hr9PrPlus * eq.p_fip_hr9_power_rating_plus_weight) +
        (bb9PrPlus * eq.p_fip_bb9_power_rating_plus_weight) +
        (k9PrPlus * eq.p_fip_k9_power_rating_plus_weight);

  return { eraPrPlus, fipPrPlus, whipPrPlus, k9PrPlus, hr9PrPlus, bb9PrPlus };
};

const getPitchingPvfForRole = (
  role: "SP" | "RP" | "SM",
  eq: ReturnType<typeof readPitchingWeights>,
) => (role === "RP" ? eq.market_pvf_reliever : role === "SM" ? eq.market_pvf_weekday_sp : eq.market_pvf_weekend_sp);

const canShowPitchingMarketValue = (team: string | null | undefined, conference: string | null | undefined) => {
  const conf = String(conference || "").trim().toLowerCase();
  const tm = String(team || "").trim().toLowerCase();
  if (!conf) return false;
  const isIndependent = conf === "independent" || conf.includes("independent");
  if (!isIndependent) return true;
  return tm === "oregon state" || tm.includes("oregon state");
};

// ── Entry point ────────────────────────────────────────────────────────────

export function computePitcherProjection(
  input: PitcherProjectionInput,
  ctx: PitcherProjectionContext,
): PitcherProjectionResult {
  const { eq, powerEq, parkMap, teamMatch } = ctx;
  const classTransition = ctx.classTransition ?? "SJ";
  const devAggressiveness = ctx.devAggressiveness ?? 0;

  const games = input.g != null ? Number(input.g) : null;
  const starts = input.gs != null ? Number(input.gs) : null;
  const baseRole = toPitchingRole(input.role) || (games != null && games > 0 && starts != null
    ? ((starts / games) < 0.5 ? "RP" : "SP")
    : null);
  const projectedRole: "SP" | "RP" | "SM" = ctx.roleOverride || baseRole || "SM";
  const projectedIp = projectedRole === "SP" ? eq.pwar_ip_sp : projectedRole === "RP" ? eq.pwar_ip_rp : eq.pwar_ip_sm;

  const scoreObj = {
    stuff: input.stuffPlus != null ? calcScore(input.stuffPlus, powerEq.p_ncaa_avg_stuff_plus, powerEq.p_sd_stuff_plus) : null,
    whiff: calcScore(input.miss_pct, powerEq.p_ncaa_avg_whiff_pct, powerEq.p_sd_whiff_pct),
    bb: calcScore(input.bb_pct, powerEq.p_ncaa_avg_bb_pct, powerEq.p_sd_bb_pct, true),
    hh: calcScore(input.hard_hit_pct, powerEq.p_ncaa_avg_hh_pct, powerEq.p_sd_hh_pct, true),
    izWhiff: calcScore(input.in_zone_whiff_pct, powerEq.p_ncaa_avg_in_zone_whiff_pct, powerEq.p_sd_in_zone_whiff_pct),
    chase: calcScore(input.chase_pct, powerEq.p_ncaa_avg_chase_pct, powerEq.p_sd_chase_pct),
    barrel: calcScore(input.barrel_pct, powerEq.p_ncaa_avg_barrel_pct, powerEq.p_sd_barrel_pct, true),
    ld: calcScore(input.line_pct, powerEq.p_ncaa_avg_ld_pct, powerEq.p_sd_ld_pct, true),
    avgEv: calcScore(input.exit_vel, powerEq.p_ncaa_avg_avg_ev, powerEq.p_sd_avg_ev, true),
    gb: calcScore(input.ground_pct, powerEq.p_ncaa_avg_gb_pct, powerEq.p_sd_gb_pct),
    iz: calcScore(input.in_zone_pct, powerEq.p_ncaa_avg_in_zone_pct, powerEq.p_sd_in_zone_pct),
    ev90: calcScore(input.vel_90th, powerEq.p_ncaa_avg_ev90, powerEq.p_sd_ev90, true),
    pull: calcScore(input.h_pull_pct, powerEq.p_ncaa_avg_pull_pct, powerEq.p_sd_pull_pct, true),
    la1030: calcScore(input.la_10_30_pct, powerEq.p_ncaa_avg_la_10_30_pct, powerEq.p_sd_la_10_30_pct, true),
  };

  const prPlus = computePitchingPrPlusFromScores(scoreObj, powerEq);

  const classEraAdj = toPitchingClassAdj(classTransition, eq.class_era_fs, eq.class_era_sj, eq.class_era_js, eq.class_era_gr);
  const classFipAdj = toPitchingClassAdj(classTransition, eq.class_fip_fs, eq.class_fip_sj, eq.class_fip_js, eq.class_fip_gr);
  const classWhipAdj = toPitchingClassAdj(classTransition, eq.class_whip_fs, eq.class_whip_sj, eq.class_whip_js, eq.class_whip_gr);
  const classK9Adj = toPitchingClassAdj(classTransition, eq.class_k9_fs, eq.class_k9_sj, eq.class_k9_js, eq.class_k9_gr);
  const classBb9Adj = toPitchingClassAdj(classTransition, eq.class_bb9_fs, eq.class_bb9_sj, eq.class_bb9_js, eq.class_bb9_gr);
  const classHr9Adj = toPitchingClassAdj(classTransition, eq.class_hr9_fs, eq.class_hr9_sj, eq.class_hr9_js, eq.class_hr9_gr);

  const pEra = projectPitchingRate({ lastStat: input.era, prPlus: prPlus.eraPrPlus, ncaaAvg: eq.era_plus_ncaa_avg, ncaaSd: eq.era_plus_ncaa_sd, prSd: eq.era_pr_sd, classAdjustment: classEraAdj, devAggressiveness, thresholds: eq.era_damp_thresholds, impacts: eq.era_damp_impacts, lowerIsBetter: true });
  const pFip = projectPitchingRate({ lastStat: input.fip, prPlus: prPlus.fipPrPlus, ncaaAvg: eq.fip_plus_ncaa_avg, ncaaSd: eq.fip_plus_ncaa_sd, prSd: eq.fip_pr_sd, classAdjustment: classFipAdj, devAggressiveness, thresholds: eq.fip_damp_thresholds, impacts: eq.fip_damp_impacts, lowerIsBetter: true });
  const pWhip = projectPitchingRate({ lastStat: input.whip, prPlus: prPlus.whipPrPlus, ncaaAvg: eq.whip_plus_ncaa_avg, ncaaSd: eq.whip_plus_ncaa_sd, prSd: eq.whip_pr_sd, classAdjustment: classWhipAdj, devAggressiveness, thresholds: eq.whip_damp_thresholds, impacts: eq.whip_damp_impacts, lowerIsBetter: true });
  const pK9 = projectPitchingRate({ lastStat: input.k9, prPlus: prPlus.k9PrPlus, ncaaAvg: eq.k9_plus_ncaa_avg, ncaaSd: eq.k9_plus_ncaa_sd, prSd: eq.k9_pr_sd, classAdjustment: classK9Adj, devAggressiveness, thresholds: eq.k9_damp_thresholds, impacts: eq.k9_damp_impacts, lowerIsBetter: false });
  const pBb9 = projectPitchingRate({ lastStat: input.bb9, prPlus: prPlus.bb9PrPlus, ncaaAvg: eq.bb9_plus_ncaa_avg, ncaaSd: eq.bb9_plus_ncaa_sd, prSd: eq.bb9_pr_sd, classAdjustment: classBb9Adj, devAggressiveness, thresholds: eq.bb9_damp_thresholds, impacts: eq.bb9_damp_impacts, lowerIsBetter: true });
  const pHr9 = projectPitchingRate({ lastStat: input.hr9, prPlus: prPlus.hr9PrPlus, ncaaAvg: eq.hr9_plus_ncaa_avg, ncaaSd: eq.hr9_plus_ncaa_sd, prSd: eq.hr9_pr_sd, classAdjustment: classHr9Adj, devAggressiveness, thresholds: eq.hr9_damp_thresholds, impacts: eq.hr9_damp_impacts, lowerIsBetter: true });

  const teamNameForPark = teamMatch?.name || input.team || null;
  const fallbackPark = teamMatch?.park_factor ?? null;
  const avgPark = parkToIndex(resolveMetricParkFactor(teamMatch?.id ?? null, "avg", parkMap, teamNameForPark, fallbackPark));
  const obpPark = parkToIndex(resolveMetricParkFactor(teamMatch?.id ?? null, "obp", parkMap, teamNameForPark, fallbackPark));
  const isoPark = parkToIndex(resolveMetricParkFactor(teamMatch?.id ?? null, "iso", parkMap, teamNameForPark, fallbackPark));
  const eraParkRaw = resolveMetricParkFactor(teamMatch?.id ?? null, "era", parkMap, teamNameForPark);
  const whipParkRaw = resolveMetricParkFactor(teamMatch?.id ?? null, "whip", parkMap, teamNameForPark);
  const hr9ParkRaw = resolveMetricParkFactor(teamMatch?.id ?? null, "hr9", parkMap, teamNameForPark);
  const eraParkFactor = parkToIndex(eraParkRaw ?? avgPark) / 100;
  const whipParkFactor = parkToIndex(whipParkRaw ?? ((0.7 * avgPark) + (0.3 * obpPark))) / 100;
  const hr9ParkFactor = parkToIndex(hr9ParkRaw ?? isoPark) / 100;
  const parkAdjustedEra = pEra == null ? null : pEra * eraParkFactor;
  const parkAdjustedWhip = pWhip == null ? null : pWhip * whipParkFactor;
  const parkAdjustedHr9 = pHr9 == null ? null : pHr9 * hr9ParkFactor;

  const pRvPlus = prPlus.eraPrPlus;
  const pitcherValue = pRvPlus == null ? null : ((pRvPlus - 100) / 100);
  const pWar = pitcherValue == null || eq.pwar_runs_per_win === 0
    ? null
    : ((((pitcherValue * (projectedIp / 9) * eq.pwar_r_per_9) + ((projectedIp / 9) * eq.pwar_replacement_runs_per_9)) / eq.pwar_runs_per_win));

  const pitchingTierMultipliers = {
    sec: eq.market_tier_sec,
    p4: eq.market_tier_acc_big12,
    bigTen: eq.market_tier_big_ten,
    strongMid: eq.market_tier_strong_mid,
    lowMajor: eq.market_tier_low_major,
  };
  const conferenceForMarket = teamMatch?.name ? (input.conference ?? null) : input.conference;
  const ptm = getProgramTierMultiplierByConference(conferenceForMarket, pitchingTierMultipliers);
  const pvm = getPitchingPvfForRole(projectedRole, eq);
  const marketEligible = canShowPitchingMarketValue(input.team, conferenceForMarket);
  const marketValue = !marketEligible || pWar == null ? null : pWar * eq.market_dollars_per_war * ptm * pvm;

  return {
    p_era: parkAdjustedEra,
    p_fip: pFip,
    p_whip: parkAdjustedWhip,
    p_k9: pK9,
    p_bb9: pBb9,
    p_hr9: parkAdjustedHr9,
    p_rv_plus: pRvPlus,
    p_war: pWar,
    market_value: marketValue,
    projected_role: projectedRole,
    scores: {
      stuff: scoreObj.stuff,
      whiff: scoreObj.whiff,
      bb: scoreObj.bb,
      barrel: scoreObj.barrel,
    },
  };
}
