import { readPitchingWeights } from "@/lib/pitchingEquations";
import { computePrvPlus } from "@/lib/pitcherQuality";
import { resolveMetricParkFactor, type ParkFactorsMap } from "@/lib/parkFactors";
import { getProgramTierMultiplierByConference } from "@/lib/nilProgramSpecific";
import { projectedIpFromRealIp } from "@/lib/depthRoles";

// Canonical pitcher projection pipeline — mirrors PitcherProfile's
// projectedPitching useMemo exactly. The sequence is:
//   scores → PR+ (live from scores) → projectPitchingRate (6 rates)
//     → park adjust (ERA/WHIP/HR9)
//     → role-transition adjust (all 6)
//     → calcPitchingPlus per rate (era+/fip+/whip+/k9+/bb9+/hr9+)
//     → pRvPlus = weighted composite of the six +-stats
//     → pWar from pRvPlus + projected IP
//     → market value from pWar + conf tier + PVF + eligibility
// Every weight and NCAA constant flows through readPitchingWeights(); this file
// introduces none of its own weights.

export const PITCHING_POWER_RATING_WEIGHT = 0.7;
export const PITCHING_DEV_FACTOR = 0.06;

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
  ip: number | null;
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
  // Pipeline-stored PR+ values from player_prediction_internals. Used as the
  // primary source (mirrors PitcherProfile.tsx:1205) — live compute from
  // scouting scores is a fallback when stored is null. This lets pitchers with
  // missing Stuff+ / scouting gaps still get projections from the pipeline's
  // precomputed PR+ values.
  storedPrPlus?: {
    era?: number | null;
    fip?: number | null;
    whip?: number | null;
    k9?: number | null;
    bb9?: number | null;
    hr9?: number | null;
  };
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
  base_role: "SP" | "RP" | "SM" | null;
  scores: {
    stuff: number | null;
    whiff: number | null;
    bb: number | null;
    barrel: number | null;
  };
  pr_plus: {
    era: number | null;
    fip: number | null;
    whip: number | null;
    k9: number | null;
    bb9: number | null;
    hr9: number | null;
  };
};

// ── Helpers (mirror of PitcherProfile's module-local versions) ─────────────

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

// ★ 2026-08-31 — `readonly number[]`: these arrays are only READ. Accepting readonly lets callers pass
//   `as const` fixtures (and any frozen config array) without a cast. Widening the INPUT type is correct;
//   casting at 16 call sites to satisfy a needlessly-mutable signature would not be.
export const dampFactorForProjected = (projected: number, thresholds: readonly number[], impacts: readonly number[]) => {
  for (let i = 0; i < thresholds.length; i++) {
    if (projected < thresholds[i]) return impacts[i] ?? 1;
  }
  return impacts[thresholds.length] ?? impacts[impacts.length - 1] ?? 1;
};

export const projectPitchingRate = ({
  lastStat,
  prPlus,
  ncaaAvg,
  ncaaSd,
  ncaaSdBad,
  prSd,
  prCenter,
  classAdjustment,
  devAggressiveness,
  thresholds,
  impacts,
  lowerIsBetter,
  fallbackToLastStat = false,
  floorAtZero = false,
}: {
  lastStat: number | null;
  prPlus: number | null;
  ncaaAvg: number;
  ncaaSd: number;
  /** Bad-side (worse-than-mean) SD for the two-sided/split calibration. Defaults to ncaaSd
   *  (symmetric) when absent. Stage 5.5 (compute-projection-calibration) supplies both. */
  ncaaSdBad?: number;
  prSd: number;
  /**
   * 🛑 The population mean of THIS stat's PR+ — NOT 100. Read from model_config
   *    `<stat>_pr_center`, emitted by compute-projection-calibration.ts on the SAME population as
   *    ncaaAvg/ncaaSd (D1, IP >= 40).
   *
   * ★ WHY THIS EXISTS. `rawZ` used to be `(prPlus - 100) / prSd`, which assumes the rating is
   *   centered where the anchor is. It is not: PR+ was fit on the ALL-DIVISION, IP>=20 population
   *   (centers 96.3-104.0 there, i.e. ~100) but is APPLIED to D1/IP>=40, where the true centers are
   *   era 109.73 · fip 108.29 · whip 108.40 · k9 101.69 · bb9 123.16 · hr9 102.04.
   *   Every qualified D1 pitcher therefore carried a free head start — for ERA,
   *   ((109.73-100)/27.90) x 1.425 = +0.44 ERA of phantom improvement. That is the "ERAs run ~4% low
   *   at every percentile, in every class bucket" symptom, and BB9 was the extreme at 123.16.
   *
   * ⚠ Defaults to 100 so an un-migrated caller behaves exactly as before rather than silently
   *   shifting. Once model_config carries the key, PASS IT — leaving the default in place keeps the
   *   bias.
   */
  prCenter?: number;
  classAdjustment: number;
  devAggressiveness: number;
  /** read-only: accepts `as const` / frozen arrays. See dampFactorForProjected. */
  thresholds: readonly number[];
  impacts: readonly number[];
  lowerIsBetter: boolean;
  // When true, returns lastStat instead of null if PR+ inputs are missing
  // (TeamBuilder's previous behavior — carry the season's actual rate
  // forward as the projection rather than dropping the row entirely).
  fallbackToLastStat?: boolean;
  // When true, clamp the projected rate at 0. HR9 ONLY (Trevor 2026-08-25):
  // HR9 is the one luck-dominated stat where a thin-sample blend can still dip
  // a hair below 0 even after the two-sided SD — a physical-floor clamp there is
  // realistic (like market value at $0). Every OTHER rate is left UNfloored on
  // purpose: the two-sided SD makes their math correct, so a negative would be a
  // real bug we want VISIBLE, not silently masked (audit doctrine 2026-08-24).
  floorAtZero?: boolean;
}) => {
  // Strict guard on lastStat — without a season number, there's nothing to
  // project even with the fallback flag.
  if (lastStat == null || !Number.isFinite(lastStat)) return null;
  if (
    prPlus == null ||
    !Number.isFinite(prPlus) ||
    !Number.isFinite(ncaaAvg) ||
    !Number.isFinite(ncaaSd) ||
    !Number.isFinite(prSd) ||
    prSd === 0
  ) {
    return fallbackToLastStat ? lastStat : null;
  }

  // Two-sided (split) SD: pitching rates are right-skewed — the good side is compressed, the bad
  // side runs wild. A single symmetric SD (inflated by the bad tail) over-projects the good side
  // through the physical floor (impossible negative HR9). PR+ higher = better talent for every stat,
  // so a positive rating-z projects toward the GOOD side (use sd_good = ncaaSd); negative toward the
  // BAD side (use ncaaSdBad). Falls back to symmetric (ncaaSd) when ncaaSdBad is absent.
  const rawZ = (prPlus - (Number.isFinite(prCenter as number) ? (prCenter as number) : 100)) / prSd;
  const dirSd = rawZ >= 0 ? ncaaSd : (Number.isFinite(ncaaSdBad as number) ? (ncaaSdBad as number) : ncaaSd);
  const zShift = rawZ * dirSd;
  const powerAdjusted = lowerIsBetter ? (ncaaAvg - zShift) : (ncaaAvg + zShift);
  const blended = (lastStat * (1 - PITCHING_POWER_RATING_WEIGHT)) + (powerAdjusted * PITCHING_POWER_RATING_WEIGHT);
  const mult = lowerIsBetter
    ? (1 - classAdjustment - (devAggressiveness * PITCHING_DEV_FACTOR))
    : (1 + classAdjustment + (devAggressiveness * PITCHING_DEV_FACTOR));
  const projected = blended * mult;
  // Damping disabled (2026-05-05). The previous implementation applied the
  // dampFactor as the WEIGHT on the projected value — meaning extreme
  // projections trusted lastStat MORE, not less. That preserved outlier
  // seasons (Flora's 0.78 ERA at UCSB stayed near 1.16 instead of regressing
  // toward his stuff-implied 1.78). The blend itself already does
  // regression-to-mean via PITCHING_POWER_RATING_WEIGHT (0.7); the extra
  // step was anti-regression.
  //
  // The thresholds/impacts inputs are kept on the signature so a future
  // Path B re-introduction (per project_pitcher_damping_path_b.md) can
  // restore damping with the correct semantic: pull elite projections UP
  // toward NCAA average, pull weak projections DOWN toward NCAA average —
  // i.e. damping fights outliers instead of preserving them.
  void thresholds; void impacts; void dampFactorForProjected;
  // HR9-only physical floor (floorAtZero): clamps the thin-sample edge case (≈1-IP arms whose last-year
  // 0.00 + a class/dev multiplier drive the blend a hair below 0). Applied to HR9 ONLY — every other rate
  // stays unfloored so a negative (which the two-sided SD should prevent) surfaces as a real bug rather
  // than being silently masked. See the floorAtZero param doc + audit doctrine (2026-08-24).
  return floorAtZero ? Math.max(0, projected) : projected;
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

// Mirror of PitcherProfile's calcPitchingPlus (PitcherProfile.tsx:274).
// Given a projected rate, produces a 100-centered +stat scaled by scale.
const calcPitchingPlus = (
  value: number | null,
  ncaaAvg: number,
  ncaaSd: number,
  scale: number,
  higherIsBetter = false,
) => {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(ncaaAvg) || !Number.isFinite(ncaaSd) || ncaaSd === 0) return null;
  const core = higherIsBetter ? ((value - ncaaAvg) / ncaaSd) : ((ncaaAvg - value) / ncaaSd);
  const raw = 100 + (core * scale);
  return Number.isFinite(raw) ? raw : null;
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

  // Role detection: baseRole from input (G/GS if role string missing).
  // projectedRole = override → baseRole → "SM".
  const games = input.g != null ? Number(input.g) : null;
  const starts = input.gs != null ? Number(input.gs) : null;
  const baseRole = toPitchingRole(input.role) || (games != null && games > 0 && starts != null
    ? ((starts / games) < 0.5 ? "RP" : "SP")
    : null);
  const projectedRole: "SP" | "RP" | "SM" = ctx.roleOverride || baseRole || "SM";
  // Projected IP from real IP via the DEPTH ROLE (not the coarse SP/RP/SM role) —
  // falls back to coarse role IP only when real IP is missing. Keeps live overlay
  // pWAR consistent with the precompute's derivePitcherStored.
  const projectedIp = projectedIpFromRealIp(input.ip, projectedRole, eq);

  // Score each scouting metric against NCAA avg/sd.
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

  const livePrPlus = computePitchingPrPlusFromScores(scoreObj, powerEq);

  // Stored PR+ from pipeline takes precedence; live compute is fallback.
  // This matches PitcherProfile.tsx's selection logic exactly.
  const readStored = (v: number | null | undefined) =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  const prPlus = {
    eraPrPlus: readStored(ctx.storedPrPlus?.era) ?? livePrPlus.eraPrPlus,
    fipPrPlus: readStored(ctx.storedPrPlus?.fip) ?? livePrPlus.fipPrPlus,
    whipPrPlus: readStored(ctx.storedPrPlus?.whip) ?? livePrPlus.whipPrPlus,
    k9PrPlus: readStored(ctx.storedPrPlus?.k9) ?? livePrPlus.k9PrPlus,
    bb9PrPlus: readStored(ctx.storedPrPlus?.bb9) ?? livePrPlus.bb9PrPlus,
    hr9PrPlus: readStored(ctx.storedPrPlus?.hr9) ?? livePrPlus.hr9PrPlus,
  };

  // Class-adjustment percentages for each rate.
  const classEraAdj = toPitchingClassAdj(classTransition, eq.class_era_fs, eq.class_era_sj, eq.class_era_js, eq.class_era_gr);
  const classFipAdj = toPitchingClassAdj(classTransition, eq.class_fip_fs, eq.class_fip_sj, eq.class_fip_js, eq.class_fip_gr);
  const classWhipAdj = toPitchingClassAdj(classTransition, eq.class_whip_fs, eq.class_whip_sj, eq.class_whip_js, eq.class_whip_gr);
  const classK9Adj = toPitchingClassAdj(classTransition, eq.class_k9_fs, eq.class_k9_sj, eq.class_k9_js, eq.class_k9_gr);
  const classBb9Adj = toPitchingClassAdj(classTransition, eq.class_bb9_fs, eq.class_bb9_sj, eq.class_bb9_js, eq.class_bb9_gr);
  const classHr9Adj = toPitchingClassAdj(classTransition, eq.class_hr9_fs, eq.class_hr9_sj, eq.class_hr9_js, eq.class_hr9_gr);

  // Step 1: raw projected rates from last-stat + PR+ + class/dev.
  const pEra = projectPitchingRate({ lastStat: input.era, prPlus: prPlus.eraPrPlus, ncaaAvg: eq.era_plus_ncaa_avg, ncaaSd: eq.era_plus_ncaa_sd, ncaaSdBad: eq.era_plus_ncaa_sd_bad, prSd: eq.era_pr_sd, prCenter: eq.era_pr_center, classAdjustment: classEraAdj, devAggressiveness, thresholds: eq.era_damp_thresholds, impacts: eq.era_damp_impacts, lowerIsBetter: true });
  const pFip = projectPitchingRate({ lastStat: input.fip, prPlus: prPlus.fipPrPlus, ncaaAvg: eq.fip_plus_ncaa_avg, ncaaSd: eq.fip_plus_ncaa_sd, ncaaSdBad: eq.fip_plus_ncaa_sd_bad, prSd: eq.fip_pr_sd, prCenter: eq.fip_pr_center, classAdjustment: classFipAdj, devAggressiveness, thresholds: eq.fip_damp_thresholds, impacts: eq.fip_damp_impacts, lowerIsBetter: true });
  const pWhip = projectPitchingRate({ lastStat: input.whip, prPlus: prPlus.whipPrPlus, ncaaAvg: eq.whip_plus_ncaa_avg, ncaaSd: eq.whip_plus_ncaa_sd, ncaaSdBad: eq.whip_plus_ncaa_sd_bad, prSd: eq.whip_pr_sd, prCenter: eq.whip_pr_center, classAdjustment: classWhipAdj, devAggressiveness, thresholds: eq.whip_damp_thresholds, impacts: eq.whip_damp_impacts, lowerIsBetter: true });
  const pK9 = projectPitchingRate({ lastStat: input.k9, prPlus: prPlus.k9PrPlus, ncaaAvg: eq.k9_plus_ncaa_avg, ncaaSd: eq.k9_plus_ncaa_sd, ncaaSdBad: eq.k9_plus_ncaa_sd_bad, prSd: eq.k9_pr_sd, prCenter: eq.k9_pr_center, classAdjustment: classK9Adj, devAggressiveness, thresholds: eq.k9_damp_thresholds, impacts: eq.k9_damp_impacts, lowerIsBetter: false });
  const pBb9 = projectPitchingRate({ lastStat: input.bb9, prPlus: prPlus.bb9PrPlus, ncaaAvg: eq.bb9_plus_ncaa_avg, ncaaSd: eq.bb9_plus_ncaa_sd, ncaaSdBad: eq.bb9_plus_ncaa_sd_bad, prSd: eq.bb9_pr_sd, prCenter: eq.bb9_pr_center, classAdjustment: classBb9Adj, devAggressiveness, thresholds: eq.bb9_damp_thresholds, impacts: eq.bb9_damp_impacts, lowerIsBetter: true });
  const pHr9 = projectPitchingRate({ lastStat: input.hr9, prPlus: prPlus.hr9PrPlus, ncaaAvg: eq.hr9_plus_ncaa_avg, ncaaSd: eq.hr9_plus_ncaa_sd, ncaaSdBad: eq.hr9_plus_ncaa_sd_bad, prSd: eq.hr9_pr_sd, prCenter: eq.hr9_pr_center, classAdjustment: classHr9Adj, devAggressiveness, thresholds: eq.hr9_damp_thresholds, impacts: eq.hr9_damp_impacts, lowerIsBetter: true, floorAtZero: true });

  // Park factor is intentionally NOT applied to returner projections — the
  // pitcher's lastStat already reflects their home park, and they're staying
  // at the same school next season, so park is invariant. Park-adjustment is
  // applied only on the transfer path (transferPitcherProjection.ts) where
  // the pitcher moves between parks.
  void parkMap;

  // Step 2: role-transition adjust all six rates. No-op when baseRole === projectedRole.
  const roleCurve = {
    tier1Max: eq.rp_to_sp_low_better_tier1_max,
    tier2Max: eq.rp_to_sp_low_better_tier2_max,
    tier3Max: eq.rp_to_sp_low_better_tier3_max,
    tier1Mult: eq.rp_to_sp_low_better_tier1_mult,
    tier2Mult: eq.rp_to_sp_low_better_tier2_mult,
    tier3Mult: eq.rp_to_sp_low_better_tier3_mult,
  };
  const roleAdjustedEra = applyRoleTransitionAdjustment(pEra, eq.sp_to_rp_reg_era_pct, baseRole, projectedRole, true, roleCurve);
  const roleAdjustedFip = applyRoleTransitionAdjustment(pFip, eq.sp_to_rp_reg_fip_pct, baseRole, projectedRole, true, roleCurve);
  const roleAdjustedWhip = applyRoleTransitionAdjustment(pWhip, eq.sp_to_rp_reg_whip_pct, baseRole, projectedRole, true, roleCurve);
  const roleAdjustedK9 = applyRoleTransitionAdjustment(pK9, eq.sp_to_rp_reg_k9_pct, baseRole, projectedRole, false, roleCurve);
  const roleAdjustedBb9 = applyRoleTransitionAdjustment(pBb9, eq.sp_to_rp_reg_bb9_pct, baseRole, projectedRole, true, roleCurve);
  const roleAdjustedHr9 = applyRoleTransitionAdjustment(pHr9, eq.sp_to_rp_reg_hr9_pct, baseRole, projectedRole, true, roleCurve);

  // Step 4: convert role-adjusted rates into per-rate +stats.
  const eraPlus = calcPitchingPlus(roleAdjustedEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale);
  const fipPlus = calcPitchingPlus(roleAdjustedFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale);
  const whipPlus = calcPitchingPlus(roleAdjustedWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale);
  const k9Plus = calcPitchingPlus(roleAdjustedK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
  const bb9Plus = calcPitchingPlus(roleAdjustedBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale);
  const hr9Plus = calcPitchingPlus(roleAdjustedHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale);

  // Step 5: pRV+ = D1-FIP index from projected K9/BB9/HR9 (canonical src/lib/pitcherQuality.ts).
  // Rounded to a whole number so the displayed pRV+ and the p_war below run off the same integer.
  // (+stats above are kept — they are stored/displayed; they no longer feed pRV+.)
  const prvRaw = computePrvPlus(roleAdjustedK9, roleAdjustedBb9, roleAdjustedHr9);
  const pRvPlus = prvRaw == null ? null : Math.round(prvRaw);

  // Step 6: pWar from pRvPlus + projected IP.
  const pitcherValue = pRvPlus == null ? null : ((pRvPlus - 100) / 100);
  const pWar = pitcherValue == null || eq.pwar_runs_per_win === 0
    ? null
    : ((((pitcherValue * (projectedIp / 9) * eq.pwar_r_per_9) + ((projectedIp / 9) * eq.pwar_replacement_runs_per_9)) / eq.pwar_runs_per_win));

  // Step 7: market value from pWar + conf tier + eligibility.
  // 2026-08-21 UNIFICATION: PTM comes from the SINGLE source (DEFAULT_NIL_TIER_MULTIPLIERS /
  // model_config nil_tier_*), NOT eq.market_tier_* — same source as the hitter + the canonical
  // computePitcherMarketValue. Omitting the 2nd arg uses the shared defaults.
  const conferenceForMarket = teamMatch?.name ? (input.conference ?? null) : input.conference;
  const ptm = getProgramTierMultiplierByConference(conferenceForMarket);
  const marketEligible = canShowPitchingMarketValue(input.team, conferenceForMarket);
  // Market value floors at $0 — negative WAR shouldn't produce a negative
  // dollar projection. Null stays null (unknown vs zero are different signals).
  // PVF (the weekend-starter premium) is intentionally removed from the pitching
  // market model: it double-counts innings already captured in WAR. Reruns
  // regenerate stored market values without it, and the Team Builder read path
  // computes market the same way (pWAR × $/WAR × tier).
  const marketValueRaw = !marketEligible || pWar == null ? null : pWar * eq.market_dollars_per_war * ptm;
  const marketValue = marketValueRaw == null ? null : Math.max(0, marketValueRaw);

  return {
    p_era: roleAdjustedEra,
    p_fip: roleAdjustedFip,
    p_whip: roleAdjustedWhip,
    p_k9: roleAdjustedK9,
    p_bb9: roleAdjustedBb9,
    p_hr9: roleAdjustedHr9,
    p_rv_plus: pRvPlus,
    p_war: pWar,
    market_value: marketValue,
    projected_role: projectedRole,
    base_role: baseRole,
    scores: {
      stuff: scoreObj.stuff,
      whiff: scoreObj.whiff,
      bb: scoreObj.bb,
      barrel: scoreObj.barrel,
    },
    pr_plus: {
      era: prPlus.eraPrPlus,
      fip: prPlus.fipPrPlus,
      whip: prPlus.whipPrPlus,
      k9: prPlus.k9PrPlus,
      bb9: prPlus.bb9PrPlus,
      hr9: prPlus.hr9PrPlus,
    },
  };
}
