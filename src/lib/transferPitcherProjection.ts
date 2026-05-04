import { readPitchingWeights } from "@/lib/pitchingEquations";
import { getProgramTierMultiplierByConference } from "@/lib/nilProgramSpecific";

// Canonical transfer-pitcher projection — answers "given a pitcher's stats at
// from-school, how do they project at to-school?" Used by:
//   - TeamBuilder add-target snapshot
//   - simulateTransferProjection live recompute (target board display)
//   - TransferPortal portal-page projection
//   - PlayerComparison side-by-side
//   - Engine recalcTransferPitcher for persisted transfer pitcher predictions
//
// Math layered on top of the base projection (computePitcherProjection):
//   project rate via PR+ blend → conference delta + competition delta + park delta
//   → role-transition adjust → calcPitchingPlus per rate → weighted pRvPlus
//   → pWar from pRvPlus + projected role IP → market value from pWar.
//
// The lib accepts pre-resolved conference stats + park factors so callers can
// own their own lookup logic (TeamBuilder uses pitchingConfLookup keyed by
// conference name, TransferPortal looks it up differently — both pass resolved
// values in here).

const round3 = (n: number) => Math.round(n * 1000) / 1000;

const parkToIndex = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return 100;
  return Math.abs(v) <= 3 ? v * 100 : v;
};

const toPitchingRole = (raw: string | null | undefined): "SP" | "RP" | "SM" | null => {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "SP" || v === "RP" || v === "SM") return v;
  return null;
};

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

type RateWork = {
  last: number;
  powerAdj: number;
  blended: number;
  mult: number;
  projected: number;
  confTerm: number;
  compTerm: number;
  parkTerm: number;
  powerRatingPlus: number;
  powerRatingStdDev: number;
  ncaaStatStdDev: number;
  ncaaAvg: number;
};

// Lower-is-better rate (ERA, FIP, WHIP, BB9, HR9): apply confTerm subtracted,
// compTerm added, parkTerm added, optionally damped.
const projectLower = (
  last: number,
  prPlus: number,
  ncaaAvg: number,
  prSd: number,
  ncaaSd: number,
  powerWeight: number,
  confWeight: number,
  fromPlus: number,
  toPlus: number,
  compWeight: number,
  fromTalent: number,
  toTalent: number,
  parkWeight: number | null,
  fromPark: number | null,
  toPark: number | null,
  dampFactor = 1,
): RateWork => {
  const safePrSd = prSd === 0 ? 1 : prSd;
  const powerAdj = ncaaAvg - (((prPlus - 100) / safePrSd) * ncaaSd);
  const blended = (last * (1 - powerWeight)) + (powerAdj * powerWeight);
  const confTerm = confWeight * ((toPlus - fromPlus) / 100);
  const compTerm = compWeight * ((toTalent - fromTalent) / 100);
  const parkTerm = parkWeight != null && fromPark != null && toPark != null ? parkWeight * ((toPark - fromPark) / 100) : 0;
  const mult = 1 - confTerm + compTerm + parkTerm;
  const adjustedMult = 1 + ((mult - 1) * dampFactor);
  return {
    last,
    powerAdj: round3(powerAdj),
    blended: round3(blended),
    mult: round3(adjustedMult),
    projected: round3(blended * adjustedMult),
    confTerm: round3(confTerm),
    compTerm: round3(compTerm),
    parkTerm: round3(parkTerm),
    powerRatingPlus: prPlus,
    powerRatingStdDev: prSd,
    ncaaStatStdDev: ncaaSd,
    ncaaAvg,
  };
};

// Higher-is-better rate (K9): no park term — strikeouts aren't park-affected.
const projectHigher = (
  last: number,
  prPlus: number,
  ncaaAvg: number,
  prSd: number,
  ncaaSd: number,
  powerWeight: number,
  confWeight: number,
  fromPlus: number,
  toPlus: number,
  compWeight: number,
  fromTalent: number,
  toTalent: number,
): RateWork => {
  const safePrSd = prSd === 0 ? 1 : prSd;
  const powerAdj = ncaaAvg + (((prPlus - 100) / safePrSd) * ncaaSd);
  const blended = (last * (1 - powerWeight)) + (powerAdj * powerWeight);
  const confTerm = confWeight * ((toPlus - fromPlus) / 100);
  const compTerm = compWeight * ((toTalent - fromTalent) / 100);
  const mult = 1 + confTerm - compTerm;
  return {
    last,
    powerAdj: round3(powerAdj),
    blended: round3(blended),
    mult: round3(mult),
    projected: round3(blended * mult),
    confTerm: round3(confTerm),
    compTerm: round3(compTerm),
    parkTerm: 0,
    powerRatingPlus: prPlus,
    powerRatingStdDev: prSd,
    ncaaStatStdDev: ncaaSd,
    ncaaAvg,
  };
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

// ── Public API ─────────────────────────────────────────────────────────────

export type TransferPitcherInput = {
  // Pitcher's last-season stats (at from-school)
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  // Pre-computed PR+ values (from Pitching Master era_pr_plus etc., or internals)
  storedPrPlus: {
    era: number | null;
    fip: number | null;
    whip: number | null;
    k9: number | null;
    bb9: number | null;
    hr9: number | null;
  };
  // Base role (from PM Role column, or G/GS-derived). Used for role-transition.
  baseRole: "SP" | "RP" | "SM" | null;
  // Pre-resolved conference + plus stats for from + to schools
  fromEraPlus: number | null;
  toEraPlus: number | null;
  fromFipPlus: number | null;
  toFipPlus: number | null;
  fromWhipPlus: number | null;
  toWhipPlus: number | null;
  fromK9Plus: number | null;
  toK9Plus: number | null;
  fromBb9Plus: number | null;
  toBb9Plus: number | null;
  fromHr9Plus: number | null;
  toHr9Plus: number | null;
  fromHitterTalent: number | null;
  toHitterTalent: number | null;
  // Pre-resolved park factors (raw — function applies parkToIndex internally)
  fromEraParkRaw: number | null;
  toEraParkRaw: number | null;
  fromWhipParkRaw: number | null;
  toWhipParkRaw: number | null;
  fromHr9ParkRaw: number | null;
  toHr9ParkRaw: number | null;
  // Destination school context — needed for market value eligibility + tier
  toTeam: string | null;
  toConference: string | null;
};

export type TransferPitcherContext = {
  eq: ReturnType<typeof readPitchingWeights>;
  // Coach role override (SP/RP/SM). When null, base role is used.
  roleOverride?: "SP" | "RP" | "SM" | null;
};

export type TransferPitcherShowWorkRate = RateWork & {
  // The role-adjusted projection (post-role transition). Null means role
  // transition couldn't apply (missing input or invalid role pair).
  roleAdjusted: number | null;
};

export type TransferPitcherShowWork = {
  era: TransferPitcherShowWorkRate;
  fip: TransferPitcherShowWorkRate;
  whip: TransferPitcherShowWorkRate;
  k9: TransferPitcherShowWorkRate;
  bb9: TransferPitcherShowWorkRate;
  hr9: TransferPitcherShowWorkRate;
};

export type TransferPitcherResult = {
  // True if a required input is missing; downstream surfaces should fall back
  // to base projection or render a "missing data" state.
  blocked: boolean;
  missingInputs: string[];
  // Final outputs (role-adjusted, conference + park + competition adjusted)
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
  // Per-rate intermediate values for surfaces that show their work
  // (TransferPortal "show your work" UI). Null when blocked=true.
  showWork: TransferPitcherShowWork | null;
};

const requireNum = (label: string, v: number | null | undefined, missing: string[]) => {
  if (v == null || !Number.isFinite(Number(v))) {
    missing.push(label);
    return null;
  }
  return Number(v);
};

const blockedResult = (
  missingInputs: string[],
  baseRole: "SP" | "RP" | "SM" | null,
  projectedRole: "SP" | "RP" | "SM",
): TransferPitcherResult => ({
  blocked: true,
  missingInputs,
  p_era: null,
  p_fip: null,
  p_whip: null,
  p_k9: null,
  p_bb9: null,
  p_hr9: null,
  p_rv_plus: null,
  p_war: null,
  market_value: null,
  projected_role: projectedRole,
  base_role: baseRole,
  showWork: null,
});

export function computeTransferPitcherProjection(
  input: TransferPitcherInput,
  ctx: TransferPitcherContext,
): TransferPitcherResult {
  const { eq } = ctx;
  const baseRole = toPitchingRole(input.baseRole);
  const projectedRole: "SP" | "RP" | "SM" = ctx.roleOverride || baseRole || "SM";
  const projectedIp = projectedRole === "SP" ? eq.pwar_ip_sp : projectedRole === "RP" ? eq.pwar_ip_rp : eq.pwar_ip_sm;

  // Validate every required input. If any missing, return blocked result so
  // callers can fall back to base projection or surface the gap explicitly.
  const missing: string[] = [];
  const era = requireNum("ERA", input.era, missing);
  const fip = requireNum("FIP", input.fip, missing);
  const whip = requireNum("WHIP", input.whip, missing);
  const k9 = requireNum("K9", input.k9, missing);
  const bb9 = requireNum("BB9", input.bb9, missing);
  const hr9 = requireNum("HR9", input.hr9, missing);
  const eraPr = requireNum("ERA Power Rating+", input.storedPrPlus.era, missing);
  const fipPr = requireNum("FIP Power Rating+", input.storedPrPlus.fip, missing);
  const whipPr = requireNum("WHIP Power Rating+", input.storedPrPlus.whip, missing);
  const k9Pr = requireNum("K/9 Power Rating+", input.storedPrPlus.k9, missing);
  const bb9Pr = requireNum("BB/9 Power Rating+", input.storedPrPlus.bb9, missing);
  const hr9Pr = requireNum("HR/9 Power Rating+", input.storedPrPlus.hr9, missing);
  const fromEraPlus = requireNum("from ERA+", input.fromEraPlus, missing);
  const toEraPlus = requireNum("to ERA+", input.toEraPlus, missing);
  const fromFipPlus = requireNum("from FIP+", input.fromFipPlus, missing);
  const toFipPlus = requireNum("to FIP+", input.toFipPlus, missing);
  const fromWhipPlus = requireNum("from WHIP+", input.fromWhipPlus, missing);
  const toWhipPlus = requireNum("to WHIP+", input.toWhipPlus, missing);
  const fromK9Plus = requireNum("from K9+", input.fromK9Plus, missing);
  const toK9Plus = requireNum("to K9+", input.toK9Plus, missing);
  const fromBb9Plus = requireNum("from BB9+", input.fromBb9Plus, missing);
  const toBb9Plus = requireNum("to BB9+", input.toBb9Plus, missing);
  const fromHr9Plus = requireNum("from HR9+", input.fromHr9Plus, missing);
  const toHr9Plus = requireNum("to HR9+", input.toHr9Plus, missing);
  const fromHitterTalent = requireNum("from Hitter Talent+", input.fromHitterTalent, missing);
  const toHitterTalent = requireNum("to Hitter Talent+", input.toHitterTalent, missing);

  if (missing.length > 0) return blockedResult(missing, baseRole, projectedRole);

  // Park factors are optional — many teams lack rate-specific park factors in
  // the park_factors table. When either side is null, projectLower zeroes out
  // the park term (no park adjustment). Mirrors the original inline behavior.
  const numOrNull = (v: number | null | undefined): number | null =>
    v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  const fromRg = numOrNull(input.fromEraParkRaw) != null ? parkToIndex(input.fromEraParkRaw) : null;
  const toRg = numOrNull(input.toEraParkRaw) != null ? parkToIndex(input.toEraParkRaw) : null;
  const fromWhipPf = numOrNull(input.fromWhipParkRaw) != null ? parkToIndex(input.fromWhipParkRaw) : null;
  const toWhipPf = numOrNull(input.toWhipParkRaw) != null ? parkToIndex(input.toWhipParkRaw) : null;
  const fromHr9Pf = numOrNull(input.fromHr9ParkRaw) != null ? parkToIndex(input.fromHr9ParkRaw) : null;
  const toHr9Pf = numOrNull(input.toHr9ParkRaw) != null ? parkToIndex(input.toHr9ParkRaw) : null;

  // Project each rate at the to-school. WHIP uses damp 0.75 (matches existing
  // TransferPortal behavior); BB9 has no park term.
  const eraWork = projectLower(era!, eraPr!, eq.era_plus_ncaa_avg, eq.era_pr_sd, eq.era_plus_ncaa_sd, eq.transfer_era_power_weight, eq.transfer_era_conference_weight, fromEraPlus!, toEraPlus!, eq.transfer_era_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_era_park_weight, fromRg, toRg);
  const fipWork = projectLower(fip!, fipPr!, eq.fip_plus_ncaa_avg, eq.fip_pr_sd, eq.fip_plus_ncaa_sd, eq.transfer_fip_power_weight, eq.transfer_fip_conference_weight, fromFipPlus!, toFipPlus!, eq.transfer_fip_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_fip_park_weight, fromRg, toRg);
  const whipWork = projectLower(whip!, whipPr!, eq.whip_plus_ncaa_avg, eq.whip_pr_sd, eq.whip_plus_ncaa_sd, eq.transfer_whip_power_weight, eq.transfer_whip_conference_weight, fromWhipPlus!, toWhipPlus!, eq.transfer_whip_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_whip_park_weight, fromWhipPf, toWhipPf, 0.75);
  const k9Work = projectHigher(k9!, k9Pr!, eq.k9_plus_ncaa_avg, eq.k9_pr_sd, eq.k9_plus_ncaa_sd, eq.transfer_k9_power_weight, eq.transfer_k9_conference_weight, fromK9Plus!, toK9Plus!, eq.transfer_k9_competition_weight, fromHitterTalent!, toHitterTalent!);
  const bb9Work = projectLower(bb9!, bb9Pr!, eq.bb9_plus_ncaa_avg, eq.bb9_pr_sd, eq.bb9_plus_ncaa_sd, eq.transfer_bb9_power_weight, eq.transfer_bb9_conference_weight, fromBb9Plus!, toBb9Plus!, eq.transfer_bb9_competition_weight, fromHitterTalent!, toHitterTalent!, null, null, null);
  const hr9Work = projectLower(hr9!, hr9Pr!, eq.hr9_plus_ncaa_avg, eq.hr9_pr_sd, eq.hr9_plus_ncaa_sd, eq.transfer_hr9_power_weight, eq.transfer_hr9_conference_weight, fromHr9Plus!, toHr9Plus!, eq.transfer_hr9_competition_weight, fromHitterTalent!, toHitterTalent!, eq.transfer_hr9_park_weight, fromHr9Pf, toHr9Pf);
  const pEra = eraWork.projected;
  const pFip = fipWork.projected;
  const pWhip = whipWork.projected;
  const pK9 = k9Work.projected;
  const pBb9 = bb9Work.projected;
  const pHr9 = hr9Work.projected;

  // Role-transition: same curve + percentages as base projection.
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

  // Compute per-rate +stats and weighted pRvPlus (same formula as base projection).
  const eraPlus = calcPitchingPlus(roleAdjustedEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
  const fipPlus = calcPitchingPlus(roleAdjustedFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
  const whipPlus = calcPitchingPlus(roleAdjustedWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
  const k9Plus = calcPitchingPlus(roleAdjustedK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
  const bb9Plus = calcPitchingPlus(roleAdjustedBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
  const hr9Plus = calcPitchingPlus(roleAdjustedHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
  const pRvPlus = [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
    ? round3(
        (eq.era_plus_weight * Number(eraPlus)) +
        (eq.fip_plus_weight * Number(fipPlus)) +
        (eq.whip_plus_weight * Number(whipPlus)) +
        (eq.k9_plus_weight * Number(k9Plus)) +
        (eq.bb9_plus_weight * Number(bb9Plus)) +
        (eq.hr9_plus_weight * Number(hr9Plus))
      )
    : null;

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
  const ptm = getProgramTierMultiplierByConference(input.toConference, pitchingTierMultipliers);
  const pvm = getPitchingPvfForRole(projectedRole, eq);
  const marketEligible = canShowPitchingMarketValue(input.toTeam, input.toConference);
  const marketValue = !marketEligible || pWar == null ? null : pWar * eq.market_dollars_per_war * ptm * pvm;

  const showWork: TransferPitcherShowWork = {
    era: { ...eraWork, roleAdjusted: roleAdjustedEra },
    fip: { ...fipWork, roleAdjusted: roleAdjustedFip },
    whip: { ...whipWork, roleAdjusted: roleAdjustedWhip },
    k9: { ...k9Work, roleAdjusted: roleAdjustedK9 },
    bb9: { ...bb9Work, roleAdjusted: roleAdjustedBb9 },
    hr9: { ...hr9Work, roleAdjusted: roleAdjustedHr9 },
  };

  return {
    blocked: false,
    missingInputs: [],
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
    showWork,
  };
}
