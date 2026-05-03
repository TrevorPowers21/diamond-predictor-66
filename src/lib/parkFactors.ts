import { fetchParkFactors, type ParkFactorsRow } from "@/lib/supabaseQueries";

export type ParkMetric = "avg" | "obp" | "iso" | "era" | "whip" | "hr9";

export type TeamParkFactorComponents = {
  avg: number | null;
  obp: number | null;
  iso: number | null;
  era?: number | null;
  whip?: number | null;
  hr9?: number | null;
};

const normalize = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const normalizeCompact = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
const normalizeShort = (v: string | null | undefined) =>
  normalize(v).replace(/\buniversity\b/g, "").replace(/\bof\b/g, "").replace(/\s+/g, " ").trim();

const toNum = (v: unknown) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Map a Supabase "Park Factors" row → TeamParkFactorComponents */
const rowToComponents = (row: ParkFactorsRow): TeamParkFactorComponents => ({
  avg: toNum(row.avg_factor),
  obp: toNum(row.obp_factor),
  iso: toNum(row.iso_factor),
  era: toNum(row.rg_factor),
  whip: toNum(row.whip_factor),
  hr9: toNum(row.hr9_factor),
});

export type ParkFactorsMap = {
  byName: Record<string, TeamParkFactorComponents>;
  byTeamId: Record<string, TeamParkFactorComponents>;
  // bySourceTeamId is the stable program-level lookup. Parks live with the
  // program; the per-season team_id UUID changes annually but source_team_id
  // does not. When this lookup hits, no name normalization or season-specific
  // UUID matching is needed.
  bySourceTeamId: Record<string, TeamParkFactorComponents>;
};

/** Fetch park factors from Supabase and build lookup maps keyed by team name,
 *  per-season team UUID, AND program-level source_team_id. When a current-season
 *  factor is missing, falls back to the prior season's value via source_team_id
 *  (preferred — fully stable) or team name (legacy fallback). */
export async function fetchParkFactorsMap(season?: number): Promise<ParkFactorsMap> {
  const byName: Record<string, TeamParkFactorComponents> = {};
  const byTeamId: Record<string, TeamParkFactorComponents> = {};
  const bySourceTeamId: Record<string, TeamParkFactorComponents> = {};

  const ingest = (row: ParkFactorsRow, preferExisting: boolean) => {
    const components = rowToComponents(row);
    const key = normalize(row.team_name);
    const compact = normalizeCompact(row.team_name);
    const short = normalizeShort(row.team_name);
    if (key && (!preferExisting || !byName[key])) byName[key] = components;
    if (compact && (!preferExisting || !byName[compact])) byName[compact] = components;
    if (short && !byName[short]) byName[short] = components;
    // byTeamId only carries current-season UUIDs (per-season identifiers).
    if (!preferExisting && row.team_id) byTeamId[row.team_id] = components;
    // bySourceTeamId is stable across seasons — current season wins, prior
    // season fills any gaps. The 2026-05-03 schema added source_team_id to
    // Park Factors and backfilled it via Teams Table.id → Teams Table.source_id.
    const srcId = (row as any).source_team_id;
    if (srcId && (!preferExisting || !bySourceTeamId[srcId])) {
      bySourceTeamId[srcId] = components;
    }
  };

  const rows = await fetchParkFactors(season);
  for (const row of rows) ingest(row, false);

  if (season != null && season > 0) {
    try {
      const priorRows = await fetchParkFactors(season - 1);
      for (const row of priorRows) ingest(row, true);
    } catch {
      // If the prior-season fetch fails, the current-season map still works.
    }
  }

  return { byName, byTeamId, bySourceTeamId };
}

/** Resolve a single metric's park factor.
 *  Resolution order: source_team_id (most stable) → per-season team_id UUID → team name → fallback.
 *  Pass `sourceTeamId` whenever it's available — it's the only lookup key that
 *  doesn't drift with season transitions. */
export const resolveMetricParkFactor = (
  teamId: string | null | undefined,
  metric: ParkMetric,
  map?: ParkFactorsMap,
  teamName?: string | null,
  fallbackParkFactor?: number | null,
  sourceTeamId?: string | null,
) => {
  if (!map) return toNum(fallbackParkFactor);

  // 1. source_team_id (stable program identifier) — preferred
  if (sourceTeamId && map.bySourceTeamId[sourceTeamId]) {
    const resolved = toNum(map.bySourceTeamId[sourceTeamId][metric]);
    if (resolved != null) return resolved;
  }

  // 2. Per-season team UUID
  if (teamId && map.byTeamId[teamId]) {
    const resolved = toNum(map.byTeamId[teamId][metric]);
    if (resolved != null) return resolved;
  }

  // 3. Name-based fallback (catches prior-season fills + legacy callers)
  const key = normalize(teamName);
  const compact = normalizeCompact(teamName);
  const short = normalizeShort(teamName);
  const fromMap = key ? map.byName[key]?.[metric] : null;
  const fromCompact = fromMap == null && compact ? map.byName[compact]?.[metric] : fromMap;
  const fromShort = fromCompact == null && short ? map.byName[short]?.[metric] : fromCompact;
  const resolved = toNum(fromShort);
  if (resolved != null) return resolved;
  return toNum(fallbackParkFactor);
};
