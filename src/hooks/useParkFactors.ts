import { useState, useEffect } from "react";
import { fetchParkFactorsMap, type ParkFactorsMap } from "@/lib/parkFactors";

const EMPTY_MAP: ParkFactorsMap = { byName: {}, byTeamId: {}, bySourceTeamId: {} };
let _cache: ParkFactorsMap | null = null;
let _cachePromise: Promise<ParkFactorsMap> | null = null;

function getCached(season?: number): Promise<ParkFactorsMap> {
  if (_cache) return Promise.resolve(_cache);
  if (_cachePromise) return _cachePromise;
  _cachePromise = fetchParkFactorsMap(season).then((m) => { _cache = m; return m; });
  return _cachePromise;
}

export function useParkFactors(season?: number) {
  const [parkMap, setParkMap] = useState<ParkFactorsMap>(_cache ?? EMPTY_MAP);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) { setParkMap(_cache); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getCached(season)
      .then((m) => { if (!cancelled) setParkMap(m); })
      .catch(() => { if (!cancelled) setParkMap(EMPTY_MAP); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [season]);

  return { parkMap, loading };
}
