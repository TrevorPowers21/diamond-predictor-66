import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PitchingMasterSeedRow = {
  id: string;
  source_player_id: string | null;
  playerName: string;
  team: string | null;
  teamId: string | null;
  conference: string | null;
  conferenceId: string | null;
  throwHand: string | null;
  role: string | null;
  ip: number | null;
  g: number | null;
  gs: number | null;
  // era/fip/whip/k9/bb9/hr9 are the "use this value" rates: when the pipeline
  // flagged this pitcher as a small-sample pullback (combined_used = true),
  // these resolve to the blended (current + prior season) values; otherwise
  // they're the raw current-season values. Centralizing the blend here so TB,
  // ReturningPlayers, and PlayerComparison all match PitcherProfile's display
  // and projection inputs without per-callsite branching.
  era: number | null;
  fip: number | null;
  whip: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  // Pullback flag + raw blended values, preserved so downstream consumers
  // can render a "*combined" footnote or distinguish raw current-season
  // from the blended fallback.
  combined_used: boolean;
  blended_era: number | null;
  blended_fip: number | null;
  blended_whip: number | null;
  blended_k9: number | null;
  blended_bb9: number | null;
  blended_hr9: number | null;
  miss_pct: number | null;
  bb_pct: number | null;
  hard_hit_pct: number | null;
  in_zone_whiff_pct: number | null;
  chase_pct: number | null;
  barrel_pct: number | null;
  line_pct: number | null;
  exit_vel: number | null;
  ground_pct: number | null;
  in_zone_pct: number | null;
  vel_90th: number | null;
  h_pull_pct: number | null;
  la_10_30_pct: number | null;
  stuffPlus: number | null;
  // Pre-computed PR+ values written by the projection pipeline. PitcherProfile
  // reads these as the canonical PR+ source; surfacing them here lets Team
  // Builder do the same instead of recomputing live with stale hardcoded
  // weights, which used to produce returners-table values that didn't match
  // the player profile's 2027 projection.
  era_pr_plus: number | null;
  fip_pr_plus: number | null;
  whip_pr_plus: number | null;
  k9_pr_plus: number | null;
  bb9_pr_plus: number | null;
  hr9_pr_plus: number | null;
  overall_pr_plus: number | null;
  p_rv_plus: number | null;
  // JUCO data-reliability inputs (per-pitch TrackMan capture + batters faced).
  // null = field absent; 0 = explicitly no capture.
  trackman_pitches: number | null;
  bf: number | null;
};

/**
 * Returns pitching seed data from the unified "Pitching Master" Supabase table.
 * Combines what was previously split across pitching_stats_storage and pitching_power_ratings_storage.
 */
export function usePitchingSeedData(season = 2026, enabled = true) {
  const { data: dbRows = [], isLoading } = useQuery({
    queryKey: ["pitching_master", season, "ip10"],
    enabled,
    queryFn: async () => {
      const all: any[] = [];
      let from = 0;
      const pageSize = 1000;
      // select("*") kept — 90th_vel column name breaks narrow selects.
      const t0 = performance.now();
      while (true) {
        const { data, error } = await supabase
          .from("Pitching Master")
          .select("*")
          .eq("Season", season)
          .gte("IP", 10)
          .not("Role", "in", "(C,1B,2B,3B,SS,OF,LF,CF,RF,DH,IF,UT)")
          .order("source_player_id", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < pageSize) break;
        from += pageSize;
      }
      console.log(`[PitchingMaster] loaded ${all.length} rows in ${Math.round(performance.now() - t0)}ms`);
      return all;
    },
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const pitchers: PitchingMasterSeedRow[] = dbRows.map((r: any) => {
    const combinedUsed = !!r.combined_used;
    return ({
    id: r.source_player_id || `pm-${r.playerFullName}-${r.Team ?? ""}`,
    source_player_id: r.source_player_id ?? null,
    playerName: r.playerFullName,
    team: r.Team ?? null,
    teamId: r.TeamID ?? null,
    conference: r.Conference ?? null,
    conferenceId: r.conference_id ?? null,
    throwHand: r.ThrowHand ?? null,
    role: r.Role ?? null,
    // Prefer regular_season_ip when the season has been locked — keeps tier
    // classification (workhorse / high-lev / etc.) frozen at regular-season
    // volume so playoff-team pitchers don't get tier-inflated by postseason
    // innings. Falls through to live IP during the regular season.
    ip: r.regular_season_ip ?? r.IP ?? null,
    g: r.G ?? null,
    gs: r.GS ?? null,
    // Blended-when-pullback resolution mirrors PitcherProfile.tsx:694-699 so
    // the "current rate" surfaced here matches whatever PitcherProfile shows.
    era: combinedUsed ? (r.blended_era ?? r.ERA) ?? null : (r.ERA ?? null),
    fip: combinedUsed ? (r.blended_fip ?? r.FIP) ?? null : (r.FIP ?? null),
    whip: combinedUsed ? (r.blended_whip ?? r.WHIP) ?? null : (r.WHIP ?? null),
    k9: combinedUsed ? (r.blended_k9 ?? r.K9) ?? null : (r.K9 ?? null),
    bb9: combinedUsed ? (r.blended_bb9 ?? r.BB9) ?? null : (r.BB9 ?? null),
    hr9: combinedUsed ? (r.blended_hr9 ?? r.HR9) ?? null : (r.HR9 ?? null),
    combined_used: combinedUsed,
    blended_era: r.blended_era ?? null,
    blended_fip: r.blended_fip ?? null,
    blended_whip: r.blended_whip ?? null,
    blended_k9: r.blended_k9 ?? null,
    blended_bb9: r.blended_bb9 ?? null,
    blended_hr9: r.blended_hr9 ?? null,
    miss_pct: r.miss_pct ?? null,
    bb_pct: r.bb_pct ?? null,
    hard_hit_pct: r.hard_hit_pct ?? null,
    in_zone_whiff_pct: r.in_zone_whiff_pct ?? null,
    chase_pct: r.chase_pct ?? null,
    barrel_pct: r.barrel_pct ?? null,
    line_pct: r.line_pct ?? null,
    exit_vel: r.exit_vel ?? null,
    ground_pct: r.ground_pct ?? null,
    in_zone_pct: r.in_zone_pct ?? null,
    vel_90th: r["90th_vel"] ?? null,
    h_pull_pct: r.h_pull_pct ?? null,
    la_10_30_pct: r.la_10_30_pct ?? null,
    stuffPlus: r.stuff_plus ?? null,
    division: r.division ?? null,
    era_pr_plus: r.era_pr_plus ?? null,
    fip_pr_plus: r.fip_pr_plus ?? null,
    whip_pr_plus: r.whip_pr_plus ?? null,
    k9_pr_plus: r.k9_pr_plus ?? null,
    bb9_pr_plus: r.bb9_pr_plus ?? null,
    hr9_pr_plus: r.hr9_pr_plus ?? null,
    overall_pr_plus: r.overall_pr_plus ?? null,
    p_rv_plus: r.p_rv_plus ?? null,
    trackman_pitches: r.trackman_pitches ?? null,
    bf: r.bf ?? null,
  });
  });

  return { pitchers, loading: isLoading };
}
