// Single source of truth for `snapshot = f(neutral, toggles)` — the exact recompute
// the Team Builder toggle uses, extracted so a validation/re-bake script and a
// future self-heal guard can never diverge from the sim. Given the immutable
// dev_agg=0 neutral and the saved toggle state, produces the displayed WAR.
//
// Mirrors useTeamBuilderSimulation: hitter 676-693, pitcher 1354-1464.
// The pitcher path now models the SP↔RP role transition (rate regression +
// pRV+ rebuild) the sim applies when the session role (from the slot, NOT the
// depth) differs from the neutral's pitcher_role — pass `sessionRole` for it to
// fire. Without a sessionRole the transition is skipped (backward compatible).
import { computeOWarFromWrcPlus } from "./playerCalcs";
import { computePrvPlus } from "@/lib/pitcherQuality";
import { computePitcherWar, paForHitterDepthRole, pitcherExpectedIp } from "./depthRoles";
import { DEFAULT_PITCHING_WEIGHTS, type PitchingEquationWeights } from "./pitchingEquations";
import { applyRoleTransitionAdjustment, calcPitchingPlus } from "./transferPitcherProjection";

export type NeutralLine = {
  p_wrc_plus?: number | null; o_war?: number | null; hitter_depth_role?: string | null;
  p_avg?: number | null; p_obp?: number | null; p_slg?: number | null; p_iso?: number | null;
  p_rv_plus?: number | null; p_war?: number | null; pitcher_role?: string | null; pitcher_depth_role?: string | null; projected_ip?: number | null;
  p_era?: number | null; p_fip?: number | null; p_whip?: number | null; p_k9?: number | null; p_bb9?: number | null; p_hr9?: number | null;
  class_transition?: string | null; dev_aggressiveness?: number | null;
};
export type ToggleNotes = { depthRole?: string | null; devAggressiveness?: number | null; classTransition?: string | null } | null | undefined;
export type SessionRole = "SP" | "RP" | null | undefined;
export type PitcherRates = { p_era: number | null; p_fip: number | null; p_whip: number | null; p_k9: number | null; p_bb9: number | null; p_hr9: number | null; p_rv_plus: number | null };

const num = (v: unknown) => (v == null ? null : Number(v));

// dev-agg scale from the neutral (dev_agg=0) to the session toggle. classAdj differs
// by side (pitcher has a JS tier; hitter does not) — matches the sim exactly.
function devScale(devAgg: number, ct: string, side: "H" | "P") {
  const classAdj = side === "P"
    ? (ct === "FS" ? 0.03 : ct === "JS" ? 0.015 : ct === "GR" ? 0.01 : 0.02)
    : (ct === "FS" ? 0.03 : ct === "GR" ? 0.01 : 0.02);
  const storedMult = 1 + classAdj + 0 * 0.06; // neutral dev_agg is 0
  const sessionMult = 1 + classAdj + devAgg * 0.06;
  return storedMult > 0 ? sessionMult / storedMult : 1;
}

const storedRoleOf = (r: unknown): "SP" | "RP" | "SM" | null =>
  r === "SP" ? "SP" : r === "RP" ? "RP" : r === "SM" ? "SM" : null;

const KNOWN_PIT_DEPTHS = new Set(["weekend_starter", "weekday_starter", "swing_starter", "workhorse_reliever", "high_leverage_reliever", "mid_leverage_reliever", "low_impact_reliever", "specialist_reliever"]);

// The SP↔RP role-transition rate regression + pRV+ rebuild — exact mirror of the
// sim (useTeamBuilderSimulation 1402-1428). Operates on the (already dev-scaled)
// rates; returns the role-adjusted rates and the rebuilt whole pRV+.
function applyRoleTransition(devSource: PitcherRates, from: "SP" | "RP" | "SM", to: "SP" | "RP", eq: PitchingEquationWeights): PitcherRates {
  const curve = {
    tier1Max: eq.rp_to_sp_low_better_tier1_max, tier2Max: eq.rp_to_sp_low_better_tier2_max, tier3Max: eq.rp_to_sp_low_better_tier3_max,
    tier1Mult: eq.rp_to_sp_low_better_tier1_mult, tier2Mult: eq.rp_to_sp_low_better_tier2_mult, tier3Mult: eq.rp_to_sp_low_better_tier3_mult,
  };
  const rtEra = applyRoleTransitionAdjustment(devSource.p_era, eq.sp_to_rp_reg_era_pct, from, to, true, curve);
  const rtFip = applyRoleTransitionAdjustment(devSource.p_fip, eq.sp_to_rp_reg_fip_pct, from, to, true, curve);
  const rtWhip = applyRoleTransitionAdjustment(devSource.p_whip, eq.sp_to_rp_reg_whip_pct, from, to, true, curve);
  const rtK9 = applyRoleTransitionAdjustment(devSource.p_k9, eq.sp_to_rp_reg_k9_pct, from, to, false, curve);
  const rtBb9 = applyRoleTransitionAdjustment(devSource.p_bb9, eq.sp_to_rp_reg_bb9_pct, from, to, true, curve);
  const rtHr9 = applyRoleTransitionAdjustment(devSource.p_hr9, eq.sp_to_rp_reg_hr9_pct, from, to, true, curve);
  const eraP = calcPitchingPlus(rtEra, eq.era_plus_ncaa_avg, eq.era_plus_ncaa_sd, eq.era_plus_scale, false);
  const fipP = calcPitchingPlus(rtFip, eq.fip_plus_ncaa_avg, eq.fip_plus_ncaa_sd, eq.fip_plus_scale, false);
  const whipP = calcPitchingPlus(rtWhip, eq.whip_plus_ncaa_avg, eq.whip_plus_ncaa_sd, eq.whip_plus_scale, false);
  const k9P = calcPitchingPlus(rtK9, eq.k9_plus_ncaa_avg, eq.k9_plus_ncaa_sd, eq.k9_plus_scale, true);
  const bb9P = calcPitchingPlus(rtBb9, eq.bb9_plus_ncaa_avg, eq.bb9_plus_ncaa_sd, eq.bb9_plus_scale, false);
  const hr9P = calcPitchingPlus(rtHr9, eq.hr9_plus_ncaa_avg, eq.hr9_plus_ncaa_sd, eq.hr9_plus_scale, false);
  // pRV+ = D1-FIP index from role-adjusted K9/BB9/HR9 (canonical src/lib/pitcherQuality.ts).
  const rtRvRaw = computePrvPlus(rtK9, rtBb9, rtHr9);
  const rtRv = rtRvRaw == null ? devSource.p_rv_plus : Math.round(rtRvRaw);
  return { p_era: rtEra, p_fip: rtFip, p_whip: rtWhip, p_k9: rtK9, p_bb9: rtBb9, p_hr9: rtHr9, p_rv_plus: rtRv };
}

export function projectEffectiveWar(
  neutral: NeutralLine | null | undefined,
  notes: ToggleNotes,
  eq: PitchingEquationWeights = DEFAULT_PITCHING_WEIGHTS,
  sessionRole?: SessionRole,
): { owar: number | null; pwar: number | null; roleChanged: boolean; rates?: PitcherRates; hitterRates?: { p_avg: number | null; p_obp: number | null; p_slg: number | null; p_iso: number | null; p_wrc_plus: number | null } } {
  if (!neutral) return { owar: null, pwar: null, roleChanged: false };
  const devAgg = Number.isFinite(Number(notes?.devAggressiveness)) ? Number(notes?.devAggressiveness) : 0;
  const ct = String(notes?.classTransition ?? neutral.class_transition ?? "SJ").toUpperCase();
  const isPitcher = num(neutral.p_rv_plus) != null || num(neutral.p_war) != null;

  if (isPitcher) {
    const depth = notes?.depthRole ?? neutral.pitcher_depth_role ?? null;
    const scale = devScale(devAgg, ct, "P");
    const inv = scale > 0 ? 1 / scale : 1;
    // dev-scale the rates + rv+ first (mirrors sim devSource 1371-1381)
    const devSource: PitcherRates = {
      p_era: num(neutral.p_era) != null ? Number(neutral.p_era) * inv : null,
      p_fip: num(neutral.p_fip) != null ? Number(neutral.p_fip) * inv : null,
      p_whip: num(neutral.p_whip) != null ? Number(neutral.p_whip) * inv : null,
      p_k9: num(neutral.p_k9) != null ? Number(neutral.p_k9) * scale : null,
      p_bb9: num(neutral.p_bb9) != null ? Number(neutral.p_bb9) * inv : null,
      p_hr9: num(neutral.p_hr9) != null ? Number(neutral.p_hr9) * inv : null,
      p_rv_plus: num(neutral.p_rv_plus) != null ? Math.round(Number(neutral.p_rv_plus) * scale) : null,
    };
    const from = storedRoleOf(neutral.pitcher_role);
    const to = sessionRole === "SP" || sessionRole === "RP" ? sessionRole : null;
    const roleChanged = from != null && to != null && from !== to;
    const rates = roleChanged ? applyRoleTransition(devSource, from, to, eq) : devSource;
    const adjRv = rates.p_rv_plus != null ? Math.round(Number(rates.p_rv_plus)) : null;
    // Innings from the depth toggle; when the depth is missing/unknown fall back to
    // the neutral's own stored projected_ip (not the RP default) so a null-depth
    // starter isn't mis-valued as a reliever.
    const ip = depth != null && KNOWN_PIT_DEPTHS.has(String(depth))
      ? pitcherExpectedIp(depth as any, eq)
      : (num(neutral.projected_ip) ?? pitcherExpectedIp(depth as any, eq));
    const pwar = adjRv != null ? computePitcherWar(adjRv, ip, eq) : null;
    return { owar: null, pwar, roleChanged, rates };
  }

  const depth = notes?.depthRole ?? neutral.hitter_depth_role ?? null;
  const scale = devScale(devAgg, ct, "H");
  const adjWrc = num(neutral.p_wrc_plus) != null ? Math.round(Number(neutral.p_wrc_plus) * scale) : null;
  const owar = adjWrc != null ? computeOWarFromWrcPlus(adjWrc, paForHitterDepthRole(depth as any)) : null;
  // Adjusted slash + wRC+ (dev-agg scaled) — the DISPLAYED line, so the snapshot's
  // wRC+/slash stay consistent with its (adjusted) oWAR. Was storing the neutral wRC+
  // against an adjusted oWAR, which read as an oWAR≠recompute(wRC+) inconsistency.
  const hitterRates = adjWrc != null ? {
    p_avg: num(neutral.p_avg) != null ? Number(neutral.p_avg) * scale : null,
    p_obp: num(neutral.p_obp) != null ? Number(neutral.p_obp) * scale : null,
    p_slg: num(neutral.p_slg) != null ? Number(neutral.p_slg) * scale : null,
    p_iso: num(neutral.p_iso) != null ? Number(neutral.p_iso) * scale : null,
    p_wrc_plus: adjWrc,
  } : undefined;
  return { owar, pwar: null, roleChanged: false, hitterRates };
}
