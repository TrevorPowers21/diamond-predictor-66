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
};

/** Fetch park factors from Supabase and build lookup maps keyed by team name and team UUID */
export async function fetchParkFactorsMap(season?: number): Promise<ParkFactorsMap> {
  const rows = await fetchParkFactors(season);
  const byName: Record<string, TeamParkFactorComponents> = {};
  const byTeamId: Record<string, TeamParkFactorComponents> = {};

  for (const row of rows) {
    const components = rowToComponents(row);
    const key = normalize(row.team_name);
    const compact = normalizeCompact(row.team_name);
    const short = normalizeShort(row.team_name);
    if (key) byName[key] = components;
    if (compact) byName[compact] = components;
    if (short && !byName[short]) byName[short] = components;
    if (row.team_id) byTeamId[row.team_id] = components;
  }

  return { byName, byTeamId };
}

/** Resolve a single metric's park factor — UUID first, name fallback */
export const resolveMetricParkFactor = (
  teamId: string | null | undefined,
  metric: ParkMetric,
  map?: ParkFactorsMap,
  teamName?: string | null,
  fallbackParkFactor?: number | null,
) => {
  if (!map) return toNum(fallbackParkFactor);

  // UUID lookup first
  if (teamId && map.byTeamId[teamId]) {
    const resolved = toNum(map.byTeamId[teamId][metric]);
    if (resolved != null) return resolved;
  }

  // Name-based fallback
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
