import { useState, useEffect, useMemo } from "react";
import { fetchConferenceStats, type ConferenceStatsRow } from "@/lib/supabaseQueries";

/** Normalized conference stats row — unified hitting + pitching from "Conference Stats" table */
export type NormalizedConferenceStats = {
  conference: string;
  conference_id: string | null;
  season: number;
  avg: number | null;
  obp: number | null;
  iso: number | null;
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  stuff_plus: number | null;
  wrc_plus: number | null;
  overall_power_rating: number | null;
};

const normalize = (v: string | null | undefined) =>
  (v || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

function rowToNormalized(row: ConferenceStatsRow): NormalizedConferenceStats {
  return {
    conference: row["conference abbreviation"],
    conference_id: row.conference_id,
    season: row.season,
    avg: row.AVG,
    obp: row.OBP,
    iso: row.ISO,
    era: row.ERA,
    fip: row.FIP,
    whip: row.WHIP,
    k9: row.K9,
    bb9: row.BB9,
    hr9: row.HR9,
    stuff_plus: row.Stuff_plus,
    wrc_plus: row.WRC_plus,
    overall_power_rating: row.Overall_Power_Rating,
  };
}

export type ConferenceStatsMap = Map<string, NormalizedConferenceStats>;

let _cache: NormalizedConferenceStats[] | null = null;
let _cachePromise: Promise<NormalizedConferenceStats[]> | null = null;

function getCached(season?: number): Promise<NormalizedConferenceStats[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_cachePromise) return _cachePromise;
  _cachePromise = fetchConferenceStats(season).then((data) => {
    _cache = data.map(rowToNormalized);
    return _cache;
  });
  return _cachePromise;
}

export function useConferenceStats(season?: number) {
  const [rows, setRows] = useState<NormalizedConferenceStats[]>(_cache ?? []);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    if (_cache) { setRows(_cache); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    getCached(season)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [season]);

  const byKey = useMemo(() => {
    const map = new Map<string, NormalizedConferenceStats>();
    // Conference name aliases: full name → abbreviation used in Conference Stats table
    const ALIASES: Record<string, string[]> = {
      "american": ["american athletic conference", "american athletic", "aac"],
      "a-10": ["atlantic 10", "atlantic 10 conference", "a10"],
      "caa": ["coastal athletic association", "coastal athletic conference", "coastal athletic"],
      "horizon": ["horizon league"],
      "mwc": ["mountain west", "mountain west conference"],
      "patriot": ["patriot league"],
      "the summit": ["summit league", "summit"],
      "sbc": ["sun belt", "sun belt conference"],
      "acc": ["atlantic coast conference"],
      "sec": ["southeastern conference"],
      "big east": ["big east conference"],
      "big south": ["big south conference"],
      "socon": ["southern conference"],
      "maac": ["metro atlantic athletic conference"],
      "mac": ["mid american conference", "mid-american conference"],
      "mvc": ["missouri valley conference"],
      "nec": ["northeast conference"],
      "ovc": ["ohio valley conference"],
      "cusa": ["conference usa"],
      "swac": ["southwestern athletic conference"],
      "wcc": ["west coast conference"],
      "wac": ["western athletic conference"],
      "asun": ["atlantic sun conference"],
      "southland": ["southland conference"],
    };
    for (const row of rows) {
      const key = normalize(row.conference);
      if (key) map.set(key, row);
      // Index by conference_id UUID for direct lookups
      if (row.conference_id) map.set(row.conference_id, row);
    }
    // Add aliases so full conference names resolve
    for (const [abbr, aliases] of Object.entries(ALIASES)) {
      const row = map.get(normalize(abbr));
      if (!row) continue;
      for (const alias of aliases) {
        const ak = normalize(alias);
        if (ak && !map.has(ak)) map.set(ak, row);
      }
    }
    return map;
  }, [rows]);

  return { conferenceStats: rows, conferenceStatsByKey: byKey, loading };
}
