export type ParkMetric = "avg" | "obp" | "iso";

export type TeamParkFactorComponents = {
  avg: number | null;
  obp: number | null;
  iso: number | null;
};

export const TEAM_PARK_FACTOR_COMPONENTS_KEY = "team_park_factor_components_v1";

const normalize = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
const normalizeCompact = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

const toNum = (v: unknown) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const readTeamParkFactorComponents = () => {
  if (typeof window === "undefined") return {} as Record<string, TeamParkFactorComponents>;
  try {
    const raw = window.localStorage.getItem(TEAM_PARK_FACTOR_COMPONENTS_KEY);
    if (!raw) return {} as Record<string, TeamParkFactorComponents>;
    const parsed = JSON.parse(raw) as Record<string, Partial<TeamParkFactorComponents>>;
    const out: Record<string, TeamParkFactorComponents> = {};
    for (const [k, v] of Object.entries(parsed || {})) {
      const row = {
        avg: toNum(v?.avg),
        obp: toNum(v?.obp),
        iso: toNum(v?.iso),
      };
      const key = normalize(k);
      const compact = normalizeCompact(k);
      if (key) out[key] = row;
      if (compact) out[compact] = row;
    }
    return out;
  } catch {
    return {} as Record<string, TeamParkFactorComponents>;
  }
};

export const writeTeamParkFactorComponents = (map: Record<string, TeamParkFactorComponents>) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TEAM_PARK_FACTOR_COMPONENTS_KEY, JSON.stringify(map));
  } catch {
    // ignore storage errors
  }
};

export const resolveMetricParkFactor = (
  teamName: string | null | undefined,
  fallbackParkFactor: number | null | undefined,
  metric: ParkMetric,
  map?: Record<string, TeamParkFactorComponents>,
) => {
  const keyed = map || readTeamParkFactorComponents();
  const key = normalize(teamName);
  const compact = normalizeCompact(teamName);
  const fromMap = key
    ? keyed[key]?.[metric]
    : (compact ? keyed[compact]?.[metric] : null);
  const fallbackFromCompact = fromMap == null && compact ? keyed[compact]?.[metric] : fromMap;
  const resolved = toNum(fallbackFromCompact);
  if (resolved != null) return resolved;
  return toNum(fallbackParkFactor);
};
