/**
 * Effective (toggle-adjusted) WAR + market value from a build snapshot.
 *
 * A build snapshot stores the NEUTRAL baseline (rate + WAR at the stored role,
 * dev_aggressiveness = 0). The coach's session toggles — depth role and dev
 * aggressiveness — live in `production_notes`. Team Builder applies them as an
 * overlay on READ to produce what the coach actually sees.
 *
 * This helper reproduces that overlay so surfaces that read the snapshot
 * directly (the GM / Front Office roster) show the SAME number the coach sees,
 * not the un-adjusted baseline. It mirrors the math in
 * useTeamBuilderSimulation:
 *   - pitcher WAR = f(pRV+, depth-role IP), dev_agg applied to the rate
 *   - hitter  WAR = storedOwar × (sessionPA / storedPA) × devAggScale
 *   - market  = storedMarket × (effectiveWAR / storedWAR)   (keeps tier baked in)
 *
 * v1 note: the pitcher path does NOT apply the SP↔RP rate regression (the
 * applyRoleTransitionAdjustment step) — it applies the depth-role innings + dev
 * agg, which are the dominant drivers. Cross-bucket role changes are therefore
 * approximate here; same-bucket depth changes and dev-agg are exact.
 */
import { paForHitterDepthRole } from "@/lib/depthRoles";
import { computePrvPlus } from "@/lib/pitcherQuality";
import type { PitchingEquationWeights } from "@/lib/pitchingEquations";
import { applyRoleTransitionAdjustment, calcPitchingPlus } from "@/lib/transferPitcherProjection";
import { computeOWarFromWrcPlus } from "@/lib/playerCalcs";

const STARTER_DEPTH_ROLES = new Set(["weekend_starter", "weekday_starter", "swing_starter"]);

/** The SP/RP bucket a pitcher depth role resolves to — the SAME bucket that
 *  drives the role-transition regression below. Surfaces so the GM view can
 *  label the position from the coach's chosen role, guaranteeing the displayed
 *  role and the (role-specific) WAR/market can never disagree. */
export function pitcherSessionRole(sessionDepthRole: string | null | undefined): "SP" | "RP" {
  return STARTER_DEPTH_ROLES.has(String(sessionDepthRole)) ? "SP" : "RP";
}

const classAdjHitter = (ct: string | null | undefined) => {
  const c = String(ct || "SJ").toUpperCase();
  return c === "FS" ? 0.03 : c === "GR" ? 0.01 : 0.02;
};
const classAdjPitcher = (ct: string | null | undefined) => {
  const c = String(ct || "SJ").toUpperCase();
  return c === "FS" ? 0.03 : c === "JS" ? 0.015 : c === "GR" ? 0.01 : 0.02;
};

/** Ratio that moves a projection from stored dev_agg (0 in a snapshot) to the
 *  coach's session dev_agg. When session = stored the ratio is 1 (no change). */
const devAggScale = (sessionDevAgg: number, storedDevAgg: number, classAdj: number) => {
  const storedMult = 1 + classAdj + storedDevAgg * 0.06;
  const sessionMult = 1 + classAdj + sessionDevAgg * 0.06;
  return storedMult > 0 ? sessionMult / storedMult : 1;
};

/** Projected innings for a pitcher depth role — mirrors useTeamBuilderSimulation. */
export function pitcherIpForDepthRole(depthRole: string | null | undefined, eq: PitchingEquationWeights): number {
  switch (depthRole) {
    case "weekend_starter":        return eq.pwar_ip_sp;
    case "weekday_starter":        return eq.pwar_ip_sm;
    case "swing_starter":          return 30;
    case "workhorse_reliever":     return 50;
    case "high_leverage_reliever": return 33;
    case "mid_leverage_reliever":  return 20;
    case "low_impact_reliever":    return 12;
    case "specialist_reliever":    return 6;
    default:                       return eq.pwar_ip_rp;
  }
}

/** Snapshot fields the pitcher overlay reads (the frozen neutral rates). */
export interface PitcherSnapshotRates {
  p_era?: number | null; p_fip?: number | null; p_whip?: number | null;
  p_k9?: number | null; p_bb9?: number | null; p_hr9?: number | null;
  p_rv_plus?: number | null;
  pitcher_role?: string | null;
}

/**
 * Effective pitcher pWAR = f(effective pRV+, depth-role IP), reproducing
 * useTeamBuilderSimulation exactly:
 *   1. dev_agg → the six rates (inverse for low-better, direct for K9 + pRV+)
 *   2. SP↔RP role-transition regression on the dev-adjusted rates (the tiered
 *      rp_to_sp curve), then re-derive pRV+ from the six +stats
 *   3. WAR from the effective pRV+ and the depth role's innings
 * Falls back to a dev-agg-only pRV+ if the individual rates aren't stored.
 */
/** The full toggle-adjusted pitcher line — rates, pRV+, WAR, and the depth IP.
 *  Every surface reads the SAME fields so displayed pRV+, WAR, and rates agree. */
export interface EffectivePitcherLine {
  pEra: number | null; pFip: number | null; pWhip: number | null;
  pK9: number | null; pBb9: number | null; pHr9: number | null;
  pRvPlus: number | null; pWar: number | null; projectedIp: number;
}

/**
 * Canonical toggle-adjusted pitcher projection — the SINGLE method Team Builder,
 * Pitcher Profile, and GM all use so their pRV+ / WAR / rates can never disagree.
 * dev_agg + SP↔RP role change both flow into the pRV+ (dev scales the rate, role
 * change re-derives it from the regressed rates); WAR is then computePitcherWar
 * of that whole-number pRV+ at the depth-role IP — exactly the hitter pattern
 * (dev → wRC+ → oWAR). NO PVF in WAR; PVF is dropped from the market too.
 */
export function projectEffectivePitcher(
  snap: PitcherSnapshotRates,
  sessionDepthRole: string | null | undefined,
  sessionDevAgg: number,
  classTransition: string | null | undefined,
  eq: PitchingEquationWeights,
): EffectivePitcherLine {
  const ip = pitcherIpForDepthRole(sessionDepthRole, eq);
  const basePRv = snap.p_rv_plus;
  if (basePRv == null || !Number.isFinite(Number(basePRv))) {
    return { pEra: null, pFip: null, pWhip: null, pK9: null, pBb9: null, pHr9: null, pRvPlus: null, pWar: null, projectedIp: ip };
  }

  const classAdj = classAdjPitcher(classTransition);
  const dev = devAggScale(sessionDevAgg, 0, classAdj);
  const inv = dev > 0 ? 1 / dev : 1;

  // Step 1 — dev_agg applied to the rates + pRV+ (inverse for low-better, direct for K9).
  const n = (v: number | null | undefined) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
  let effEra = n(snap.p_era) != null ? n(snap.p_era)! * inv : null;
  let effFip = n(snap.p_fip) != null ? n(snap.p_fip)! * inv : null;
  let effWhip = n(snap.p_whip) != null ? n(snap.p_whip)! * inv : null;
  let effK9 = n(snap.p_k9) != null ? n(snap.p_k9)! * dev : null;
  let effBb9 = n(snap.p_bb9) != null ? n(snap.p_bb9)! * inv : null;
  let effHr9 = n(snap.p_hr9) != null ? n(snap.p_hr9)! * inv : null;
  let adjRv = Number(basePRv) * dev;

  // Step 2 — SP↔RP role transition, only when the role bucket actually changes.
  const storedRole: "SP" | "RP" | "SM" | null =
    snap.pitcher_role === "SP" ? "SP" : snap.pitcher_role === "SM" ? "SM" : snap.pitcher_role === "RP" ? "RP" : null;
  const sessionRole: "SP" | "RP" = pitcherSessionRole(sessionDepthRole);
  const ratesPresent = [effEra, effFip, effWhip, effK9, effBb9, effHr9].every((v) => v != null);
  if (storedRole != null && storedRole !== sessionRole && ratesPresent) {
    const curve = {
      tier1Max: eq.rp_to_sp_low_better_tier1_max, tier2Max: eq.rp_to_sp_low_better_tier2_max, tier3Max: eq.rp_to_sp_low_better_tier3_max,
      tier1Mult: eq.rp_to_sp_low_better_tier1_mult, tier2Mult: eq.rp_to_sp_low_better_tier2_mult, tier3Mult: eq.rp_to_sp_low_better_tier3_mult,
    };
    const rtEra = applyRoleTransitionAdjustment(effEra, eq.sp_to_rp_reg_era_pct, storedRole, sessionRole, true, curve);
    const rtFip = applyRoleTransitionAdjustment(effFip, eq.sp_to_rp_reg_fip_pct, storedRole, sessionRole, true, curve);
    const rtWhip = applyRoleTransitionAdjustment(effWhip, eq.sp_to_rp_reg_whip_pct, storedRole, sessionRole, true, curve);
    const rtK9 = applyRoleTransitionAdjustment(effK9, eq.sp_to_rp_reg_k9_pct, storedRole, sessionRole, false, curve);
    const rtBb9 = applyRoleTransitionAdjustment(effBb9, eq.sp_to_rp_reg_bb9_pct, storedRole, sessionRole, true, curve);
    const rtHr9 = applyRoleTransitionAdjustment(effHr9, eq.sp_to_rp_reg_hr9_pct, storedRole, sessionRole, true, curve);
    const eraP = calcPitchingPlus(rtEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
    const fipP = calcPitchingPlus(rtFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
    const whipP = calcPitchingPlus(rtWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
    const k9P = calcPitchingPlus(rtK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
    const bb9P = calcPitchingPlus(rtBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
    const hr9P = calcPitchingPlus(rtHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
    // Displayed rates follow the role change too.
    effEra = rtEra; effFip = rtFip; effWhip = rtWhip; effK9 = rtK9; effBb9 = rtBb9; effHr9 = rtHr9;
    // pRV+ = D1-FIP index from role-adjusted K9/BB9/HR9 (canonical src/lib/pitcherQuality.ts).
    const rvRaw = computePrvPlus(rtK9, rtBb9, rtHr9);
    if (rvRaw != null) adjRv = rvRaw;
  }

  // Step 3 — pRV+ is a whole number everywhere (mirrors wRC+); WAR from it at the depth IP.
  const pRvPlus = Math.round(adjRv);
  const pWar = (((pRvPlus - 100) / 100) * (ip / 9) * eq.pwar_r_per_9 + (ip / 9) * eq.pwar_replacement_runs_per_9) / eq.pwar_runs_per_win;
  return { pEra: effEra, pFip: effFip, pWhip: effWhip, pK9: effK9, pBb9: effBb9, pHr9: effHr9, pRvPlus, pWar, projectedIp: ip };
}

export function effectivePitcherWar(
  snap: PitcherSnapshotRates,
  sessionDepthRole: string | null | undefined,
  sessionDevAgg: number,
  classTransition: string | null | undefined,
  eq: PitchingEquationWeights,
): number | null {
  return projectEffectivePitcher(snap, sessionDepthRole, sessionDevAgg, classTransition, eq).pWar;
}

/**
 * Effective hitter oWAR — REBUILT from the toggle-adjusted wRC+ over the session
 * depth role's PA, via the same computeOWar the precompute uses. NOT scaled from
 * stored oWAR.
 *
 * Why: oWAR is affine in wRC+ (it has a constant replacement term), so
 * multiplying stored oWAR by the dev ratio double-scaled that constant and broke
 * ordering — a higher-wRC+ hitter could show a LOWER oWAR than a lower-wRC+ one
 * (the Souza/Traeger inversion). Depth (PA) was already exact because oWAR IS
 * linear in PA; this preserves that (session PA) and fixes dev (wRC+ × devScale).
 *
 * NOTE: param 1 is now the stored **wRC+**, not stored oWAR. Snapshots are the
 * neutral baseline (stored dev = 0), so devScale is taken from session vs 0.
 */
export function effectiveHitterWar(
  storedWrcPlus: number | null | undefined,
  _storedHitterDepthRole: string | null | undefined, // unused (signature kept stable)
  sessionDepthRole: string | null | undefined,
  sessionDevAgg: number,
  classTransition: string | null | undefined,
): number | null {
  if (storedWrcPlus == null || !Number.isFinite(Number(storedWrcPlus))) return null;
  const dev = devAggScale(sessionDevAgg, 0, classAdjHitter(classTransition));
  const adjWrc = Math.round(Number(storedWrcPlus) * dev);
  const sessionPa = paForHitterDepthRole((sessionDepthRole as any) ?? "everyday_starter");
  return computeOWarFromWrcPlus(adjWrc, sessionPa);
}

/** Effective market = stored market scaled by the WAR change. The stored value
 *  already carries $/WAR × conference tier, so scaling by the WAR ratio yields
 *  the toggle-adjusted market without re-deriving the tier. */
export function effectiveMarket(
  storedMarket: number | null | undefined,
  storedWar: number | null | undefined,
  effectiveWar: number | null | undefined,
): number | null {
  if (storedMarket == null || !Number.isFinite(Number(storedMarket))) return null;
  if (storedWar == null || Number(storedWar) === 0 || effectiveWar == null || !Number.isFinite(Number(effectiveWar))) {
    return Number(storedMarket);
  }
  return Math.max(0, Number(storedMarket) * (Number(effectiveWar) / Number(storedWar)));
}
