// Single source of truth for `snapshot = f(neutral, toggles)` — the exact recompute
// the Team Builder toggle uses, extracted so a validation/re-bake script and a
// future self-heal guard can never diverge from the sim. Given the immutable
// dev_agg=0 neutral and the saved toggle state, produces the displayed WAR.
//
// Mirrors useTeamBuilderSimulation: hitter 676-693, pitcher 1363-1381 (no-role-change
// path). Role-transition (SP↔RP) rates are NOT modeled here yet — callers should flag
// role-changed rows separately rather than trust this for them.
import { computeOWarFromWrcPlus } from "./playerCalcs";
import { computePitcherWar, paForHitterDepthRole, pitcherExpectedIp, type PitchingEquationWeights } from "./depthRoles";
import { DEFAULT_PITCHING_WEIGHTS } from "./pitchingEquations";

export type NeutralLine = {
  p_wrc_plus?: number | null; o_war?: number | null; hitter_depth_role?: string | null;
  p_rv_plus?: number | null; p_war?: number | null; pitcher_role?: string | null; pitcher_depth_role?: string | null;
  class_transition?: string | null; dev_aggressiveness?: number | null;
};
export type ToggleNotes = { depthRole?: string | null; devAggressiveness?: number | null; classTransition?: string | null } | null | undefined;

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

export function projectEffectiveWar(
  neutral: NeutralLine | null | undefined,
  notes: ToggleNotes,
  eq: PitchingEquationWeights = DEFAULT_PITCHING_WEIGHTS,
): { owar: number | null; pwar: number | null; roleChanged: boolean } {
  if (!neutral) return { owar: null, pwar: null, roleChanged: false };
  const devAgg = Number.isFinite(Number(notes?.devAggressiveness)) ? Number(notes?.devAggressiveness) : 0;
  const ct = String(notes?.classTransition ?? neutral.class_transition ?? "SJ").toUpperCase();
  const isPitcher = num(neutral.p_rv_plus) != null || num(neutral.p_war) != null;

  if (isPitcher) {
    const depth = notes?.depthRole ?? neutral.pitcher_depth_role ?? null;
    const scale = devScale(devAgg, ct, "P");
    const adjRv = num(neutral.p_rv_plus) != null ? Math.round(Number(neutral.p_rv_plus) * scale) : null;
    const ip = pitcherExpectedIp(depth as any, eq);
    const pwar = adjRv != null ? computePitcherWar(adjRv, ip, eq) : null;
    // role change vs the neutral's pitcher_role would alter rates → flag for the caller
    const notesRole = (notes as any)?.role ?? (notes as any)?.pitcherRole ?? null;
    const roleChanged = notesRole != null && String(notesRole) !== String(neutral.pitcher_role ?? "");
    return { owar: null, pwar, roleChanged };
  }

  const depth = notes?.depthRole ?? neutral.hitter_depth_role ?? null;
  const scale = devScale(devAgg, ct, "H");
  const adjWrc = num(neutral.p_wrc_plus) != null ? Math.round(Number(neutral.p_wrc_plus) * scale) : null;
  const owar = adjWrc != null ? computeOWarFromWrcPlus(adjWrc, paForHitterDepthRole(depth as any)) : null;
  return { owar, pwar: null, roleChanged: false };
}
