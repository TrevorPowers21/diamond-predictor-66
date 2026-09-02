/**
 * Shared player calculation utilities used across TeamBuilder, PlayerProfile,
 * ReturningPlayers, and useTeamBuilderSimulation.
 *
 * POLICY: When you need a new shared calc, add it here. Do NOT inline it in a page.
 */
import { RUNS_PER_PA, REPLACEMENT_RUNS_PER_600PA, RUNS_PER_WIN } from "../savant/lib/war";

/**
 * Estimate oWAR from wRC+.
 * PA defaults to 260 when not provided (standard half-season baseline for a
 * fringe starter). Carries prior-season PA forward for returning players so
 * WAR scales with actual playing-time history rather than always projecting
 * a full season.
 *
 * Constants imported from war.ts (single source) — the D1 recalibration flips them there once.
 */
export const computeOWarFromWrcPlus = (
  wrcPlus: number | null | undefined,
  actualPa?: number | null,
): number | null => {
  if (wrcPlus == null) return null;
  const pa = actualPa ?? 260;
  const replacementRuns = (pa / 600) * REPLACEMENT_RUNS_PER_600PA;
  const offValue = (wrcPlus - 100) / 100;
  const raa = offValue * pa * RUNS_PER_PA;
  const rar = raa + replacementRuns;
  return rar / RUNS_PER_WIN;
};
