import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Raw pitcher row used by Savant. Mirrors Pitching Master columns we need
 * for percentile calculations and the pitcher leaderboards.
 *
 * READ ONLY — Savant never writes to Pitching Master.
 */
export interface SavantPitcherRow {
  source_player_id: string | null;
  playerFullName: string;
  Team: string | null;
  TeamID: string | null;
  Conference: string | null;
  ThrowHand: string | null;
  Role: string | null;
  Season: number | null;
  IP: number | null;
  G: number | null;
  GS: number | null;
  ERA: number | null;
  FIP: number | null;
  WHIP: number | null;
  K9: number | null;
  BB9: number | null;
  HR9: number | null;
  miss_pct: number | null;
  bb_pct: number | null;
  hard_hit_pct: number | null;
  in_zone_whiff_pct: number | null;
  chase_pct: number | null;
  barrel_pct: number | null;
  exit_vel: number | null;
  ground_pct: number | null;
  vel_90th: number | null;
  stuff_plus: number | null;
  era_pr_plus: number | null;
  fip_pr_plus: number | null;
  whip_pr_plus: number | null;
  k9_pr_plus: number | null;
  bb9_pr_plus: number | null;
  hr9_pr_plus: number | null;
}

const SELECT_COLS = `source_player_id, playerFullName, Team, TeamID, Conference, ThrowHand, Role, Season, IP, G, GS, ERA, FIP, WHIP, K9, BB9, HR9, miss_pct, bb_pct, hard_hit_pct, in_zone_whiff_pct, chase_pct, barrel_pct, exit_vel, ground_pct, "90th_vel", stuff_plus, era_pr_plus, fip_pr_plus, whip_pr_plus, k9_pr_plus, bb9_pr_plus, hr9_pr_plus`;

/**
 * Minimum IP to be included in the Savant pitcher leaderboard population.
 * Lower than the dashboard threshold (20) so high-Stuff+ relievers with
 * smaller samples still surface in the data hub.
 */
export const SAVANT_MIN_IP = 10;

export function useSavantPitchers(season = 2026) {
  return useQuery({
    queryKey: ["savant_pitchers", season, "v1"],
    queryFn: async () => {
      const all: SavantPitcherRow[] = [];
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("Pitching Master")
          .select(SELECT_COLS)
          .eq("Season", season)
          .gt("IP", 0)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data || []).map((r: any) => ({ ...r, vel_90th: r["90th_vel"] ?? null })) as SavantPitcherRow[];
        all.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
