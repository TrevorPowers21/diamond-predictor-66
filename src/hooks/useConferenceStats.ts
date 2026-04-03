import { useState, useEffect, useMemo } from "react";
import { fetchConferenceStats, type ConferenceStatsRow } from "@/lib/supabaseQueries";

/** Normalized conference stats row — unified hitting + pitching from "Conference Stats" table */
export type NormalizedConferenceStats = {
  conference: string;
  conference_id: string | null;
  season: number;
  // Hitting raw stats
  avg: number | null;
  obp: number | null;
  iso: number | null;
  // Pitching raw stats
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  // Unified plus stats & ratings
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

export function useConferenceStats(season?: number) {
  const [rows, setRows] = useState<NormalizedConferenceStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchConferenceStats(season)
      .then((data) => {
        if (!cancelled) setRows(data.map(rowToNormalized));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [season]);

  /** Map keyed by normalized conference abbreviation */
  const byKey = useMemo(() => {
    const map = new Map<string, NormalizedConferenceStats>();
    for (const row of rows) {
      const key = normalize(row.conference);
      if (key) map.set(key, row);
    }
    return map;
  }, [rows]);

  return { conferenceStats: rows, conferenceStatsByKey: byKey, loading };
}
