import { useState, useEffect } from "react";
import { fetchParkFactorsMap, type ParkFactorsMap } from "@/lib/parkFactors";

const EMPTY_MAP: ParkFactorsMap = { byName: {}, byTeamId: {} };

export function useParkFactors(season?: number) {
  const [parkMap, setParkMap] = useState<ParkFactorsMap>(EMPTY_MAP);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchParkFactorsMap(season)
      .then((m) => { if (!cancelled) setParkMap(m); })
      .catch(() => { if (!cancelled) setParkMap(EMPTY_MAP); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [season]);

  return { parkMap, loading };
}
