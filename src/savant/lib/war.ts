import { computeWrcPlus } from "./wrcPlus";

// ── WAR scale constants ──────────────────────────────────────────────────────
// CURRENT (pre-recalibration) values — deliberately kept at the existing MLB-ish numbers
// so oWAR/pWAR values and every STORED precompute DO NOT MOVE while we add the dWAR/bsrWAR
// buckets. The dWAR/bsrWAR buckets share RUNS_PER_WIN so they rescale in the SAME pass when
// the D1 recalibration lands. The recalibration is a separate coordinated rollout — see
// WAR_RECALIBRATION_TODO below.
export const RUNS_PER_WIN = 10;
export const RUNS_PER_PA = 0.13;
export const RUNS_PER_9 = 5.5;
export const REPLACEMENT_RUNS_PER_600PA = 25;
export const PITCHER_REPLACEMENT_PER_9IP = 2.5;

/*
 * ⚠️ WAR_RECALIBRATION_TODO — D1 calibration audit (2026-08-05). Do on a DEDICATED branch,
 * AFTER dWAR/bsrWAR are confirmed working on staging. The constants above are transplanted
 * MLB rules of thumb with no D1 provenance. Derived D1 values (from the 2.58M-pitch season;
 * docs/drs-reference/CONSTANTS_D1_2026.md + AGENT_LEARNINGS + memory project_composite_war):
 *   RUNS_PER_WIN            10   → 13.1    (Pythagorean 2R, R = 6.54 R/team/game)
 *   RUNS_PER_PA             0.13 → 0.174   (105,473 runs ÷ 605,727 PA)
 *   RUNS_PER_9             5.5   → 6.76    (D1 R/9)
 *   REPLACEMENT_RUNS_600PA  25   → 2.0 WINS/600 PA (= 2.0*RUNS_PER_WIN → 26.2; fixed-WIN so it
 *                                          scales with rpw). PITCHER repl ≈ 2.48/9IP.
 * Net: every WAR shrinks ~23%; hitting ~flat vs pitching (pitching shrinks a bit more, the
 * o-vs-p gap closes but pitchers stay higher). COORDINATED rollout, NOT a one-file change:
 *   1. CENTRALIZE — the oWAR formula is copy-pasted in 7 places; make them all import the
 *      constants above instead of re-inlining 0.13/25/10. Copies: src/lib/{playerCalcs,
 *      transferProjection, buildTransferProjectionInputs, depthRoles}.ts, src/pages/
 *      TeamBuilder.tsx, src/pages/team-builder/hooks/useTeamBuilderSimulation.ts, AND
 *      supabase/functions/process-precompute-jobs/index.ts. (pWAR: pitchingEquations.ts,
 *      pitchLogRates.ts.) The parity tests (playerCalcs.test / storedVsLive.test) enforce sync.
 *   2. Update + redeploy the precompute EDGE FUNCTION (staging first).
 *   3. RE-PRECOMPUTE all stored oWAR/pWAR (human-run) — combine with the dWAR/bsrWAR add.
 *   4. Reseed team_war_snapshots on the new totals.
 *   5. Repoint market value + projected budget at TOTAL WAR; load TeamBuilder/simulation pages.
 */

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

/** pWAR from pitcher power rating + innings. */
export function computePWar(
  prvPlus: number | null,
  ip: number | null,
  rPer9: number = RUNS_PER_9,
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
