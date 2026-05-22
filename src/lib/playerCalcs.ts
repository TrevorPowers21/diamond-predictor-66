/**
 * Shared player calculation utilities used across TeamBuilder, PlayerProfile,
 * ReturningPlayers, and useTeamBuilderSimulation.
 *
 * POLICY: When you need a new shared calc, add it here. Do NOT inline it in a page.
 */

/**
 * Estimate oWAR from wRC+.
 * PA defaults to 260 when not provided (standard half-season baseline for a
 * fringe starter). Carries prior-season PA forward for returning players so
 * WAR scales with actual playing-time history rather than always projecting
 * a full season.
 */
export const computeOWarFromWrcPlus = (
  wrcPlus: number | null | undefined,
  actualPa?: number | null,
): number | null => {
  if (wrcPlus == null) return null;
  const pa = actualPa ?? 260;
  const runsPerPa = 0.13;
  const replacementRuns = (pa / 600) * 25;
  const offValue = (wrcPlus - 100) / 100;
  const raa = offValue * pa * runsPerPa;
  const rar = raa + replacementRuns;
  return rar / 10;
};
