import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TeamWarSnapshot = {
  id: string;
  season: number;
  source_team_id: string;
  team_name: string;
  conference: string | null;
  is_national_champ: boolean;
  is_conference_champ: boolean;
  /**
   * NCAA tournament seed rank. 1-8 = National seed, 9-16 = Regional host,
   * NULL = unseeded. Drives the Program Analytics National Seed range row.
   */
  national_seed_rank: number | null;
  raw_total_owar: number;
  raw_total_pwar: number;
  raw_starting_lineup_owar: number;
  raw_rotation_pwar: number;
  raw_bullpen_pwar: number;
  prorated_total_owar: number;
  prorated_total_pwar: number;
  prorated_starting_lineup_owar: number;
  prorated_rotation_pwar: number;
  prorated_bullpen_pwar: number;
  games_played_est: number | null;
  proration_factor: number | null;
  n_hitters: number | null;
  n_pitchers: number | null;
};

/** Aggregated stat range across a band of teams (e.g., top-8 national seeds). */
export type WarStatRange = {
  min: number;
  max: number;
  median: number;
  n: number;
};

export type NationalSeedBenchmark = {
  season: number;
  /** Bands present in the data — typically [{ band: "1-8", ... }, { band: "9-16", ... }]. */
  totalWar: WarStatRange | null;
  lineupOwar: WarStatRange | null;
  rotationPwar: WarStatRange | null;
  bullpenPwar: WarStatRange | null;
  teams: TeamWarSnapshot[];
};

/**
 * Single team's WAR snapshot for a given season.
 * Used by Year-over-Year compare card in TB Analytics tab.
 *
 * Resolution order — tries every reasonable identifier because the snapshot
 * was keyed on Hitter Master."TeamID" (a UUID) while the Teams Table uses
 * a different source_id format for some teams (e.g. Georgia: short numeric
 * "226" in teams, UUID "f6dce..." in Hitter Master). We try:
 *   1. Exact source_team_id match
 *   2. Exact team_name match (any of the candidates passed in)
 *   3. Strip "University of " prefix and retry (covers "University of Georgia" → "Georgia")
 */
export function useTeamWarSnapshot(
  sourceTeamId: string | null | undefined,
  season: number,
  nameCandidates: Array<string | null | undefined> = [],
) {
  const cleanCandidates = nameCandidates
    .map((n) => (n ?? "").trim())
    .filter((n) => n.length > 0)
    .flatMap((n) => {
      const variants = new Set<string>();
      variants.add(n);
      // Strip common prefixes
      variants.add(n.replace(/^university of\s+/i, "").trim());
      variants.add(n.replace(/^the\s+/i, "").trim());
      // Strip common suffixes (e.g. "Georgia State University" → "Georgia State")
      variants.add(n.replace(/\s+university$/i, "").trim());
      return Array.from(variants).filter((v) => v.length > 0);
    });
  const uniqueNames = Array.from(new Set(cleanCandidates));

  return useQuery({
    queryKey: ["team-war-snapshot", sourceTeamId, season, uniqueNames.join("|")],
    enabled: !!sourceTeamId || uniqueNames.length > 0,
    queryFn: async (): Promise<TeamWarSnapshot | null> => {
      // Step 1: source_team_id
      if (sourceTeamId) {
        const { data, error } = await (supabase as any)
          .from("team_war_snapshots")
          .select("*")
          .eq("source_team_id", sourceTeamId)
          .eq("season", season)
          .maybeSingle();
        if (error) {
          console.warn("useTeamWarSnapshot source_team_id lookup error", error);
        }
        if (data) return data as TeamWarSnapshot;
      }
      // Step 2: try every name variant in one OR query (case-insensitive)
      if (uniqueNames.length > 0) {
        // PostgREST OR with ilike: team_name.ilike.Georgia,team_name.ilike.University of Georgia
        const orClause = uniqueNames
          .map((n) => `team_name.ilike.${n.replace(/,/g, "")}`)
          .join(",");
        const { data, error } = await (supabase as any)
          .from("team_war_snapshots")
          .select("*")
          .or(orClause)
          .eq("season", season)
          .limit(1);
        if (error) {
          console.warn("useTeamWarSnapshot team_name fallback error", error);
        }
        if (data && data.length > 0) return data[0] as TeamWarSnapshot;
      }
      return null;
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * All championship benchmarks (national champ + conference champs) for a season.
 * Used by Championship Benchmark compare card in TB Analytics tab.
 *
 * Returns champions sorted by prorated_war (national first, then by conference).
 */
export function useWarBenchmarks(season: number) {
  return useQuery({
    queryKey: ["war-benchmarks", season],
    queryFn: async (): Promise<TeamWarSnapshot[]> => {
      const { data, error } = await (supabase as any)
        .from("team_war_snapshots")
        .select("*")
        .eq("season", season)
        .or("is_national_champ.eq.true,is_conference_champ.eq.true")
        .order("is_national_champ", { ascending: false })
        .order("conference", { ascending: true })
        .order("prorated_total_owar", { ascending: false });
      if (error) {
        console.warn("useWarBenchmarks fetch error", error);
        return [];
      }
      return (data ?? []) as TeamWarSnapshot[];
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * Aggregate the top-8 national seeds for a season into per-metric ranges
 * (min / max / median). Backs the Program Analytics "National Seed (1-8)"
 * row — a regular-season-driven benchmark answering "what does it take to
 * host a Super Regional?"
 *
 * Postseason results (National Champion) are intentionally NOT shown as the
 * default benchmark — too dependent on bracket variance to be a roster-build
 * target. Use the team-picker dropdown to compare against a specific team.
 */
export function useNationalSeedBenchmark(season: number, range: "1-8" | "9-16" = "1-8") {
  return useQuery({
    queryKey: ["national-seed-benchmark", season, range],
    queryFn: async (): Promise<NationalSeedBenchmark> => {
      const [lo, hi] = range === "1-8" ? [1, 8] : [9, 16];
      const { data, error } = await (supabase as any)
        .from("team_war_snapshots")
        .select("*")
        .eq("season", season)
        .gte("national_seed_rank", lo)
        .lte("national_seed_rank", hi)
        .order("national_seed_rank", { ascending: true });
      if (error) {
        console.warn("useNationalSeedBenchmark fetch error", error);
        return { season, totalWar: null, lineupOwar: null, rotationPwar: null, bullpenPwar: null, teams: [] };
      }
      const teams = (data ?? []) as TeamWarSnapshot[];
      const aggregate = (values: number[]): WarStatRange | null => {
        if (values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
        return {
          min: sorted[0],
          max: sorted[sorted.length - 1],
          median,
          n: sorted.length,
        };
      };
      const totals = teams.map((t) => Number(t.prorated_total_owar) + Number(t.prorated_total_pwar));
      return {
        season,
        totalWar: aggregate(totals),
        lineupOwar: aggregate(teams.map((t) => Number(t.prorated_starting_lineup_owar))),
        rotationPwar: aggregate(teams.map((t) => Number(t.prorated_rotation_pwar))),
        bullpenPwar: aggregate(teams.map((t) => Number(t.prorated_bullpen_pwar))),
        teams,
      };
    },
    staleTime: 30 * 60 * 1000,
  });
}

/**
 * All team snapshots for a season — backs the "team you want to emulate"
 * dropdown picker. Returns lean shape (id + name + conference + WAR totals)
 * sorted by total prorated WAR descending.
 */
export function useAllTeamSnapshots(season: number) {
  return useQuery({
    queryKey: ["all-team-snapshots", season],
    queryFn: async (): Promise<TeamWarSnapshot[]> => {
      const { data, error } = await (supabase as any)
        .from("team_war_snapshots")
        .select("*")
        .eq("season", season);
      if (error) {
        console.warn("useAllTeamSnapshots fetch error", error);
        return [];
      }
      // Drop JUCO / CC programs — emulate dropdown is D1-only. JUCO snapshots
      // live in the same table and would otherwise clutter the picker with
      // non-comparable rows. Conference strings: "NJCAA D1 <District>" / etc.
      const rows = ((data ?? []) as TeamWarSnapshot[]).filter((t) => {
        const conf = (t.conference || "").toLowerCase();
        if (!conf) return true; // keep unknown-conference D1 rows
        if (conf.startsWith("njcaa")) return false;
        if (conf.includes("junior college")) return false;
        if (conf.includes("community college")) return false;
        return true;
      });
      // Sort by total prorated WAR (offense + pitching). DB can't ORDER BY a
      // computed sum cleanly without a generated column, so client-side here.
      return rows.sort((a, b) => {
        const aTotal = Number(a.prorated_total_owar) + Number(a.prorated_total_pwar);
        const bTotal = Number(b.prorated_total_owar) + Number(b.prorated_total_pwar);
        return bTotal - aTotal;
      });
    },
    staleTime: 30 * 60 * 1000,
  });
}
