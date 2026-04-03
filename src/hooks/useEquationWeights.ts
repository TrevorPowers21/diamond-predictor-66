import { useState, useEffect, useMemo } from "react";
import { fetchEquationWeights, type EquationWeightsRow } from "@/lib/supabaseQueries";

export type EquationWeightsMap = Map<string, number>;

/** Fetch all equation weights for a season and build a name→value map */
export function useEquationWeights(season?: number) {
  const [rows, setRows] = useState<EquationWeightsRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEquationWeights(undefined, season)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [season]);

  /** All weights keyed by Name (lowercase) */
  const byName = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.Name && row.Value != null) {
        map.set(row.Name.toLowerCase(), row.Value);
        map.set(row.Name, row.Value);
      }
    }
    return map;
  }, [rows]);

  /** Weights filtered by category */
  const byCategory = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const row of rows) {
      if (!row.Category || row.Value == null) continue;
      const catKey = row.Category.toLowerCase();
      if (!map.has(catKey)) map.set(catKey, new Map());
      map.get(catKey)!.set(row.Name, row.Value);
      map.get(catKey)!.set(row.Name.toLowerCase(), row.Value);
    }
    return map;
  }, [rows]);

  return { weights: byName, byCategory, rows, loading };
}

/** Non-hook async version for use outside React components */
export async function loadEquationWeightsMap(season?: number): Promise<Map<string, number>> {
  const rows = await fetchEquationWeights(undefined, season);
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.Name && row.Value != null) {
      map.set(row.Name.toLowerCase(), row.Value);
      map.set(row.Name, row.Value);
    }
  }
  return map;
}
