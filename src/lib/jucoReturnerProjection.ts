/**
 * JUCO returner projection — completely isolated from the D1 returner equation.
 *
 * For JUCO hitters, the cross-team (variant='regular', customer_team_id=NULL)
 * row passes 2026 actuals through verbatim. JUCO Hitter Master has no usable
 * power-rating internals, no park factors, and conference adjustments that
 * apply to D1 don't make sense across JUCO districts. So projected rates
 * literally equal last-season rates.
 *
 * Per-team transfer projections (variant='precomputed') are NOT handled here —
 * those go through the JUCO-aware transfer equation in
 * `precompute-transfer-projections.ts` + the process-precompute-jobs worker.
 *
 * Locked 2026-05-26 — this file must never call into recalcReturner / engine
 * config / power-rating math. If you add anything that does, you're in the
 * wrong file.
 */
import {
  computeHitterOWar,
  computeHitterMarketValue,
  defaultHitterDepthRoleFromActualPa,
  paForHitterDepthRole,
  type HitterDepthRole,
} from "@/lib/depthRoles";

export type JucoReturnerResult = {
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_ops: number | null;
  p_iso: number | null;
  p_wrc: number | null;
  p_wrc_plus: number | null;
  o_war: number | null;
  market_value: number | null;
  projected_pa: number | null;
  hitter_depth_role: HitterDepthRole | null;
};

const NULL_RESULT: JucoReturnerResult = {
  p_avg: null,
  p_obp: null,
  p_slg: null,
  p_ops: null,
  p_iso: null,
  p_wrc: null,
  p_wrc_plus: null,
  o_war: null,
  market_value: null,
  projected_pa: null,
  hitter_depth_role: null,
};

/**
 * Standard wRC+ formula applied to raw rate stats. No park, no env, no conf
 * adjustment — JUCO does not have the inputs to do those correctly.
 */
function wrcPlusFromRates(avg: number, obp: number, slg: number): number {
  const iso = slg - avg;
  return ((0.45 * obp + 0.30 * slg + 0.15 * avg + 0.10 * iso) / 0.364) * 100;
}

/**
 * Project a JUCO returner (cross-team regular variant).
 *
 * Inputs:
 *   from_avg / from_obp / from_slg  — 2026 JUCO actuals from Hitter Master
 *   actualPa                        — 2026 actual PA, used to assign depth tier
 *   conference                      — district name (e.g. "NJCAA D1 Plains"); feeds
 *                                     the JUCO market tier multiplier
 *   position                        — for position value multiplier
 */
export function projectJucoReturner(args: {
  from_avg: number | null | undefined;
  from_obp: number | null | undefined;
  from_slg: number | null | undefined;
  actualPa: number | null | undefined;
  conference: string | null | undefined;
  position: string | null | undefined;
}): JucoReturnerResult {
  const avg = args.from_avg == null ? null : Number(args.from_avg);
  const obp = args.from_obp == null ? null : Number(args.from_obp);
  const slg = args.from_slg == null ? null : Number(args.from_slg);
  if (avg == null || obp == null || slg == null
      || !Number.isFinite(avg) || !Number.isFinite(obp) || !Number.isFinite(slg)) {
    return NULL_RESULT;
  }

  const iso = slg - avg;
  const ops = obp + slg;
  const wrcPlus = wrcPlusFromRates(avg, obp, slg);

  const depthRole = defaultHitterDepthRoleFromActualPa(args.actualPa ?? null);
  const projectedPa = paForHitterDepthRole(depthRole);
  const oWar = computeHitterOWar(wrcPlus, null, depthRole);
  const marketValue = computeHitterMarketValue(oWar, {
    conference: args.conference ?? null,
    position: args.position ?? null,
  });

  return {
    p_avg: avg,
    p_obp: obp,
    p_slg: slg,
    p_iso: iso,
    p_ops: ops,
    p_wrc: null,
    p_wrc_plus: wrcPlus,
    o_war: oWar,
    market_value: marketValue,
    projected_pa: projectedPa,
    hitter_depth_role: depthRole,
  };
}
