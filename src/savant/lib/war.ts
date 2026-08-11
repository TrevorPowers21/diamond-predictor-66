import { computeWrcPlus } from "./wrcPlus";

// ── WAR scale constants — D1-derived, LOCKED 2026-08-10 ───────────────────────
// Shared run environment for the two-number WAR system. Descriptive WAR (on the Masters)
// and the projection BOTH divide by RUNS_PER_WIN so the desc−proj gap is a real
// disagreement, not a scale artifact. Derived from D1 (fixtures: output/descriptive_constants.json
// + output/woba_weights.json): lgRA9 6.915, ΣR/ΣPA, replacement 2.0 wins/600.
// NOTE: the MAIN-APP pitcher-WAR path runs on the pwar_* equation weights in
// src/lib/pitchingEquations.ts. The war.ts computePWar below is the SAME formula and is kept
// in lockstep with those pwar_* values (13.1 / 6.915 / 1.92); it is used by the Savant
// TeamProfilePage for live per-pitcher pWAR. Eventually TeamProfilePage should read the stored
// desc_pwar (display pass 2) and this helper can retire.
export const RUNS_PER_WIN = 13.1;               // Pythagorean 2R (lgRA9 6.915)
export const RUNS_PER_PA = 0.3994;              // = lgwOBA/wOBAscale (0.3782/0.947) — the run value of a
                                                // wRC+ point (C1). NOT ΣR/ΣPA 0.163 (that was the league's
                                                // raw scoring rate, the wrong quantity). See ncaa_league_averages_2026.json.
export const REPLACEMENT_RUNS_PER_600PA = 26.2; // 2.0 wins/600 × RPW — fixed-WINS (scales with rpw)
export const PITCHER_R_PER_9 = 6.915;            // D1 lgRA9 — mirrors pitchingEquations pwar_r_per_9
export const PITCHER_REPLACEMENT_PER_9IP = 1.92; // replRA9 8.83 − lgRA9 — mirrors pwar_replacement_runs_per_9

/**
 * oWAR from wRC+ + PA — OFFENSE ONLY. Baserunning and defense are their own buckets now
 * (computeBsrWar / computeDWar), no longer folded in here. Carries the whole-player
 * replacement so it reads as a standalone WAR; dWAR/bsrWAR are above-average for now (a later
 * refinement splits the replacement share so an average defender reads slightly > 0).
 */
export function computeOWar(wrcPlus: number | null, pa?: number | null): number | null {
  if (wrcPlus == null) return null;
  const actualPa = pa ?? 260;
  const replacementRuns = (actualPa / 600) * REPLACEMENT_RUNS_PER_600PA;
  const offValue = (wrcPlus - 100) / 100;
  const raa = offValue * actualPa * RUNS_PER_PA;
  return (raa + replacementRuns) / RUNS_PER_WIN;
}

/** oWAR from a raw slash line — computes wRC+ first, then oWAR. */
export function computeOWarFromStats(
  avg: number | null,
  obp: number | null,
  slg: number | null,
  iso: number | null,
  pa: number | null,
): number | null {
  return computeOWar(computeWrcPlus(avg, obp, slg, iso), pa);
}

/**
 * pWAR from pitcher power rating (pRV+) + innings. Same formula as the pwar_* equation-weight
 * path; defaults are the D1 constants (kept in lockstep with pitchingEquations pwar_*). Used by
 * the Savant TeamProfilePage. The MAIN-APP projection pitcher WAR flows through pitchingEquations.
 */
export function computePWar(
  prvPlus: number | null,
  ip: number | null,
  rPer9: number = PITCHER_R_PER_9,
  replacementRunsPer9: number = PITCHER_REPLACEMENT_PER_9IP,
  runsPerWin: number = RUNS_PER_WIN,
): number | null {
  if (prvPlus == null || ip == null || ip === 0) return null;
  const pitcherValue = (prvPlus - 100) / 100;
  const rpa = pitcherValue * (ip / 9) * rPer9;
  const replacementRuns = (ip / 9) * replacementRunsPer9;
  return (rpa + replacementRuns) / runsPerWin;
}

/**
 * dWAR = defensive runs (from the dRS engine, player_season_defense) ÷ runs-per-win.
 * NO internal positional adjustment — the opportunity-neutral catch-surface metric already
 * handles fielding spread (avg SS and avg 1B both ~0 DRS; opportunity lives in the spread,
 * not the mean). Positional SCARCITY is a separate, settable combine term
 * (computePositionalValue), NOT baked in here.
 */
export function computeDWar(drsRuns: number | null, runsPerWin: number = RUNS_PER_WIN): number {
  return (drsRuns ?? 0) / runsPerWin;
}

/** bsrWAR = baserunning runs (wSB, player_season_baserunning.wsb_runs) ÷ runs-per-win. */
export function computeBsrWar(wsbRuns: number | null, runsPerWin: number = RUNS_PER_WIN): number {
  return (wsbRuns ?? 0) / runsPerWin;
}

/**
 * Positional SCARCITY value in WINS — the value of playing a hard-to-fill position (an average
 * SS does a job almost nobody can; average 1B are abundant). NOT a fielding-spread correction
 * (that's in dWAR); it prices scarcity, invisible to any fielding metric. SETTABLE, eventually
 * derivable from cross-position offensive gaps. Empty for now → 0; populate before total WAR ships.
 */
export const POSITIONAL_VALUE_WINS: Record<string, number> = {
  // TODO(§8): derive from cross-position offensive gaps. Shape (placeholder, not applied):
  // C: 0.7, SS: 0.7, CF: 0.3, "2B": 0.2, "3B": 0.2, LF: -0.2, RF: -0.2, "1B": -0.5, DH: -0.9,
};
export function computePositionalValue(position: string | null | undefined): number {
  return position ? (POSITIONAL_VALUE_WINS[position] ?? 0) : 0;
}

/**
 * Total WAR = oWAR + pWAR + dWAR + bsrWAR + positional-scarcity. Replacement is applied exactly
 * once (inside oWAR/pWAR); dWAR/bsrWAR/positional are above-average contributions. A two-way
 * player passes both oWar and pWar.
 */
export function computeTotalWar(parts: {
  oWar?: number | null;
  pWar?: number | null;
  dWar?: number;
  bsrWar?: number;
  positionalValue?: number;
}): number {
  return (
    (parts.oWar ?? 0) +
    (parts.pWar ?? 0) +
    (parts.dWar ?? 0) +
    (parts.bsrWar ?? 0) +
    (parts.positionalValue ?? 0)
  );
}
