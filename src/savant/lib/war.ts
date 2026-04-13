import { computeWrcPlus } from "./wrcPlus";

/**
 * Compute oWAR from wRC+ and plate appearances.
 * Mirrors the canonical formula in ReturningPlayers.tsx.
 */
export function computeOWar(wrcPlus: number | null, pa?: number | null): number | null {
  if (wrcPlus == null) return null;
  const actualPa = pa ?? 260;
  const runsPerPa = 0.13;
  const replacementRuns = (actualPa / 600) * 25;
  const offValue = (wrcPlus - 100) / 100;
  const raa = offValue * actualPa * runsPerPa;
  const rar = raa + replacementRuns;
  return rar / 10;
}

/**
 * Compute oWAR from raw slash line stats (AVG/OBP/SLG/ISO + PA).
 * Computes wRC+ first, then feeds into oWAR formula.
 */
export function computeOWarFromStats(
  avg: number | null,
  obp: number | null,
  slg: number | null,
  iso: number | null,
  pa: number | null,
): number | null {
  const wrcPlus = computeWrcPlus(avg, obp, slg, iso);
  return computeOWar(wrcPlus, pa);
}

/**
 * Compute pWAR from pitcher power rating and innings pitched.
 * Uses the standard RSTR IQ pitcher WAR formula.
 */
export function computePWar(
  prvPlus: number | null,
  ip: number | null,
  rPer9: number = 5.5,
  replacementRunsPer9: number = 2.5,
  runsPerWin: number = 10,
): number | null {
  if (prvPlus == null || ip == null || ip === 0) return null;
  const pitcherValue = (prvPlus - 100) / 100;
  const rpa = pitcherValue * (ip / 9) * rPer9;
  const replacementRuns = (ip / 9) * replacementRunsPer9;
  const rar = rpa + replacementRuns;
  return rar / runsPerWin;
}
