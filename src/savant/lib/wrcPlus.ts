/**
 * wRC+ calculation for Savant.
 *
 * Mirrors the canonical RSTR IQ formula in src/lib/predictionEngine.ts
 * (DEFAULT_WRC_WEIGHTS, ncaaWrc 0.364). Kept as a local copy here so Savant
 * does not import from predictionEngine — that would drag the projection
 * engine into the Savant bundle and break isolation.
 *
 * If the canonical weights ever change in predictionEngine.ts, update them
 * here too.
 */
export const SAVANT_WRC_WEIGHTS = {
  obp: 0.45,
  slg: 0.3,
  avg: 0.15,
  iso: 0.1,
} as const;

export const SAVANT_NCAA_WRC = 0.364;

export function computeWrcRaw(
  avg: number | null,
  obp: number | null,
  slg: number | null,
  iso: number | null,
): number | null {
  if (avg == null || obp == null || slg == null || iso == null) return null;
  return (
    SAVANT_WRC_WEIGHTS.obp * obp +
    SAVANT_WRC_WEIGHTS.slg * slg +
    SAVANT_WRC_WEIGHTS.avg * avg +
    SAVANT_WRC_WEIGHTS.iso * iso
  );
}

export function computeWrcPlus(
  avg: number | null,
  obp: number | null,
  slg: number | null,
  iso: number | null,
): number | null {
  const raw = computeWrcRaw(avg, obp, slg, iso);
  if (raw == null) return null;
  return Math.round((raw / SAVANT_NCAA_WRC) * 100);
}
