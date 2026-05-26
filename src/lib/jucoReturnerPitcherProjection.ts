/**
 * JUCO returner pitcher projection — completely isolated from the D1 pitcher
 * equation (computePitcherProjection / recalcReturner pitcher path).
 *
 * Mirror of src/lib/jucoReturnerProjection.ts for hitters. For JUCO pitchers
 * the cross-team (variant='regular', customer_team_id=NULL) row passes 2026
 * actuals through verbatim. JUCO Pitching Master has no usable power-rating
 * internals, no park factors, no Stuff+ for most, and conference adjustments
 * that apply to D1 don't make sense across JUCO districts. So projected rates
 * literally equal last-season rates.
 *
 * Per-team transfer projections (variant='precomputed') are NOT handled here —
 * those go through the JUCO-aware transfer pitcher equation in
 * `precompute-pitchers.ts`.
 *
 * Locked 2026-05-26 — this file must never call into computePitcherProjection
 * / power-rating math / role-transition curves. If you add anything that does,
 * you're in the wrong file.
 */
import {
  computePitcherWar,
  computePitcherMarketValue,
  pitcherExpectedIp,
  type PitcherDepthRole,
  type ProjectedPitcherRole,
} from "@/lib/depthRoles";
import type { PitchingEquationWeights } from "@/lib/pitchingEquations";

export type JucoReturnerPitcherResult = {
  p_era: number | null;
  p_fip: number | null;
  p_whip: number | null;
  p_k9: number | null;
  p_bb9: number | null;
  p_hr9: number | null;
  p_rv_plus: number | null;
  p_war: number | null;
  market_value: number | null;
  projected_ip: number | null;
  pitcher_role: ProjectedPitcherRole | null;
  pitcher_depth_role: PitcherDepthRole | null;
};

const NULL_RESULT: JucoReturnerPitcherResult = {
  p_era: null, p_fip: null, p_whip: null, p_k9: null, p_bb9: null, p_hr9: null,
  p_rv_plus: null, p_war: null, market_value: null,
  projected_ip: null, pitcher_role: null, pitcher_depth_role: null,
};

/**
 * Centered "+stat" from a raw rate. Mirror of the local calcPitchingPlus in
 * pitcherProjection.ts. Lives here so this lib has no dep on D1 engine code.
 */
function calcPlus(value: number | null, ncaaAvg: number, ncaaSd: number, scale: number, higherIsBetter = false): number | null {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(ncaaAvg) || !Number.isFinite(ncaaSd) || ncaaSd === 0) return null;
  const core = higherIsBetter ? ((value - ncaaAvg) / ncaaSd) : ((ncaaAvg - value) / ncaaSd);
  const raw = 100 + (core * scale);
  return Number.isFinite(raw) ? raw : null;
}

/**
 * Project a JUCO returner pitcher (cross-team regular variant).
 *
 * Passes through 2026 JUCO actuals as p_era/p_fip/p_whip/p_k9/p_bb9/p_hr9.
 * Computes p_rv_plus by normalizing those rates against NCAA D1 averages
 * (pulled from eq weights). This will lean optimistic for JUCO arms because
 * they faced weaker hitters, but the JUCO market tier (0.35) on the dollar
 * side keeps the displayed value modest.
 *
 * Inputs:
 *   from_era / from_fip / from_whip / from_k9 / from_bb9 / from_hr9  - 2026
 *     JUCO actuals (already on the returner regular row via the initial JUCO
 *     pitcher backfill + the JUCO PM refresh).
 *   actualIp        — 2026 actual IP, used to bucket the depth tier.
 *   inferredRole    — "SP" / "RP" hint; if null, derived from IP threshold.
 *   conference      — district name; feeds the JUCO market tier multiplier.
 *   team            — for the pitching market eligibility check.
 *   eq              — full pitching equation weights (for NCAA averages,
 *                     pwar constants, market $/WAR + PVF).
 */
export function projectJucoReturnerPitcher(args: {
  from_era: number | null | undefined;
  from_fip: number | null | undefined;
  from_whip: number | null | undefined;
  from_k9: number | null | undefined;
  from_bb9: number | null | undefined;
  from_hr9: number | null | undefined;
  actualIp: number | null | undefined;
  /** Optional PM-supplied role override ("SP"/"RP"). Wins over GS/G + IP heuristics. */
  inferredRole: ProjectedPitcherRole | null;
  /** Games + games started for GS/G ratio role inference. Pass when available. */
  games?: number | null;
  gamesStarted?: number | null;
  conference: string | null | undefined;
  team: string | null | undefined;
  eq: PitchingEquationWeights;
}): JucoReturnerPitcherResult {
  const era = args.from_era == null ? null : Number(args.from_era);
  const fip = args.from_fip == null ? null : Number(args.from_fip);
  const whip = args.from_whip == null ? null : Number(args.from_whip);
  const k9 = args.from_k9 == null ? null : Number(args.from_k9);
  const bb9 = args.from_bb9 == null ? null : Number(args.from_bb9);
  const hr9 = args.from_hr9 == null ? null : Number(args.from_hr9);
  // Pitcher needs at least the core rate-prevention stats. If both ERA and FIP
  // are missing the row is effectively a stub; passthrough makes no sense.
  if (era == null && fip == null) return NULL_RESULT;

  const { eq } = args;

  // Step 1: +stats from raw rates (against NCAA D1 averages).
  const eraPlus  = calcPlus(era,  eq.era_plus_ncaa_avg,  eq.era_plus_ncaa_sd,  eq.era_plus_scale);
  const fipPlus  = calcPlus(fip,  eq.fip_plus_ncaa_avg,  eq.fip_plus_ncaa_sd,  eq.fip_plus_scale);
  const whipPlus = calcPlus(whip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale);
  const k9Plus   = calcPlus(k9,   eq.k9_plus_ncaa_avg,   eq.k9_plus_ncaa_sd,   eq.k9_plus_scale, true);
  const bb9Plus  = calcPlus(bb9,  eq.bb9_plus_ncaa_avg,  eq.bb9_plus_ncaa_sd,  eq.bb9_plus_scale);
  const hr9Plus  = calcPlus(hr9,  eq.hr9_plus_ncaa_avg,  eq.hr9_plus_ncaa_sd,  eq.hr9_plus_scale);

  // Step 2: weighted pRV+. Same composition as D1 engine, but applied to raw
  // JUCO rates with no role/park/conf transform.
  const pRvPlus =
    [eraPlus, fipPlus, whipPlus, k9Plus, bb9Plus, hr9Plus].every((v) => v != null)
      ? (Number(eraPlus) * eq.era_plus_weight) +
        (Number(fipPlus) * eq.fip_plus_weight) +
        (Number(whipPlus) * eq.whip_plus_weight) +
        (Number(k9Plus) * eq.k9_plus_weight) +
        (Number(bb9Plus) * eq.bb9_plus_weight) +
        (Number(hr9Plus) * eq.hr9_plus_weight)
      : null;

  // Step 3: depth role + projected IP.
  // Role hint priority:
  //   1. explicit inferredRole (caller passed it in — e.g. PM Role column)
  //   2. GS/G ratio (>= 0.5 = SP) — most reliable when both are populated
  //   3. IP threshold (>= 35 = SP) — fallback for missing GS/G
  //   4. RP default
  // Note: a JUCO arm with 40+ IP across 18 relief appearances (1 start) is
  // a reliever, not a starter. Sole-IP heuristic was tagging those as SP
  // and skewing both the cross-team dashboard and the profile default.
  const ipNum = Number.isFinite(Number(args.actualIp)) ? Number(args.actualIp) : 0;
  const role: ProjectedPitcherRole = (() => {
    if (args.inferredRole === "SP" || args.inferredRole === "RP") return args.inferredRole;
    const g = Number(args.games) || 0;
    const gs = Number(args.gamesStarted) || 0;
    if (g > 0) return (gs / g) >= 0.5 ? "SP" : "RP";
    return ipNum >= 35 ? "SP" : "RP";
  })();
  const depthRole: PitcherDepthRole = (() => {
    if (role === "SP") {
      if (ipNum >= 65) return "weekend_starter";
      if (ipNum >= 35) return "weekday_starter";
      return "swing_starter";
    }
    if (ipNum >= 40) return "workhorse_reliever";
    if (ipNum >= 25) return "high_leverage_reliever";
    if (ipNum >= 12) return "mid_leverage_reliever";
    if (ipNum >= 6)  return "low_impact_reliever";
    return "specialist_reliever";
  })();
  const projectedIp = pitcherExpectedIp(depthRole, eq);

  // Step 4: pWAR + market value.
  const pWar = computePitcherWar(pRvPlus, projectedIp, eq);
  const marketValue = computePitcherMarketValue(
    pWar,
    { conference: args.conference ?? null, role, team: args.team ?? null },
    eq,
  );

  return {
    p_era: era,
    p_fip: fip,
    p_whip: whip,
    p_k9: k9,
    p_bb9: bb9,
    p_hr9: hr9,
    p_rv_plus: pRvPlus,
    p_war: pWar,
    market_value: marketValue,
    projected_ip: projectedIp,
    pitcher_role: role,
    pitcher_depth_role: depthRole,
  };
}
