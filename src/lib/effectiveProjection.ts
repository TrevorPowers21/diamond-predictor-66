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
import type { PitchingEquationWeights } from "@/lib/pitchingEquations";

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

/** Effective pitcher pWAR = f(dev-agg-adjusted pRV+, depth-role IP). */
export function effectivePitcherWar(
  pRvPlus: number | null | undefined,
  sessionDepthRole: string | null | undefined,
  sessionDevAgg: number,
  classTransition: string | null | undefined,
  eq: PitchingEquationWeights,
): number | null {
  if (pRvPlus == null || !Number.isFinite(Number(pRvPlus))) return null;
  const adjRv = Number(pRvPlus) * devAggScale(sessionDevAgg, 0, classAdjPitcher(classTransition));
  const ip = pitcherIpForDepthRole(sessionDepthRole, eq);
  return (
    (((adjRv - 100) / 100) * (ip / 9) * eq.pwar_r_per_9 + (ip / 9) * eq.pwar_replacement_runs_per_9) /
    eq.pwar_runs_per_win
  );
}

/** Effective hitter oWAR = storedOwar × depthScale × devAggScale. */
export function effectiveHitterWar(
  storedOwar: number | null | undefined,
  storedHitterDepthRole: string | null | undefined,
  sessionDepthRole: string | null | undefined,
  sessionDevAgg: number,
  classTransition: string | null | undefined,
): number | null {
  if (storedOwar == null || !Number.isFinite(Number(storedOwar))) return null;
  const storedPa = paForHitterDepthRole((storedHitterDepthRole as any) ?? "everyday_starter");
  const sessionPa = paForHitterDepthRole((sessionDepthRole as any) ?? "everyday_starter");
  const depthScale = storedPa > 0 ? sessionPa / storedPa : 1;
  return Number(storedOwar) * depthScale * devAggScale(sessionDevAgg, 0, classAdjHitter(classTransition));
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
