import { useMemo } from "react";
import { normalizeName, nameTeamKey } from "@/lib/nameUtils";

type SeedRow = { playerName: string; team?: string | null; player_id?: string | null; [k: string]: any };

/**
 * Builds lookup maps for hitter stat rows and power rating rows:
 *   byName      → all rows for a normalized full name
 *   byNameTeam  → single row keyed by normalized "name|team"
 *   byPlayerId  → single row keyed by source_player_id
 *
 * Replaces three duplicate useMemo blocks inside PlayerProfile.
 */
function buildMaps(rows: SeedRow[]) {
  const byName = new Map<string, SeedRow[]>();
  const byNameTeam = new Map<string, SeedRow>();
  const byPlayerId = new Map<string, SeedRow>();
  for (const row of rows) {
    const key = normalizeName(row.playerName);
    const arr = byName.get(key) || [];
    arr.push(row);
    byName.set(key, arr);
    const ntKey = nameTeamKey(row.playerName, row.team);
    if (!byNameTeam.has(ntKey)) byNameTeam.set(ntKey, row);
    if (row.player_id) byPlayerId.set(row.player_id, row);
  }
  return { byName, byNameTeam, byPlayerId };
}

export function useSeedDataMaps(hitterStats: SeedRow[], powerRatings: SeedRow[]) {
  const statMaps = useMemo(() => buildMaps(hitterStats), [hitterStats]);
  const powerMaps = useMemo(() => buildMaps(powerRatings), [powerRatings]);
  return {
    storageByName: statMaps.byName,
    storageByNameTeam: statMaps.byNameTeam,
    storageByPlayerId: statMaps.byPlayerId,
    powerByName: powerMaps.byName,
    powerByNameTeam: powerMaps.byNameTeam,
    powerByPlayerId: powerMaps.byPlayerId,
  };
}
