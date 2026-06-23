import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Qualified 2026 D1 pitcher population for percentile-rank scoring on
 * PitcherProfile. Mirrors usePitchLog2026HitterPop on the pitcher side.
 *
 * Qualifier: total_pitches >= 100 (matches PITCHER_QUALIFIED_PITCHES
 * used by the Pitcher Stats page percentile bars — so PitcherProfile
 * scouting grades land at the same percentile rank coaches see on Stats).
 *
 * Paginated — Supabase's default response cap is 1000 rows and the 2026
 * pitcher pop is ~5,400.
 */
export interface PitchLogPitcherPopRow {
  stuffPlus: number | null;
  whiff: number | null;
  bb: number | null;
  chase: number | null;
  barrel: number | null;
  hardHit: number | null;
  izWhiff: number | null;
  gb: number | null;
  avgEv: number | null;
}

const MIN_PITCHES = 100;
const MIN_TRACKED_BIP = 5;

export function usePitchLog2026PitcherPop() {
  return useQuery({
    queryKey: ["pitch-log-2026-pitcher-pop"],
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<PitchLogPitcherPopRow[]> => {
      const out: PitchLogPitcherPopRow[] = [];
      let from = 0;
      const cols =
        "total_pitches, total_swings, total_whiffs, total_in_zone, total_in_zone_swings, total_in_zone_whiffs, total_out_of_zone, total_chases, total_pa, total_bb, stuff_plus_sum, stuff_plus_data_pitches, batted_balls_allowed_in_play, batted_balls_allowed_with_ev, batted_barrels_allowed, batted_hard_hit_allowed, batted_ground_balls_allowed, ev_sum_allowed";

      while (true) {
        const { data, error } = await (supabase as any)
          .from("pitch_log_pitcher_totals")
          .select(cols)
          .eq("season", 2026)
          .eq("dimension_key", "all")
          .gte("total_pitches", MIN_PITCHES)
          .range(from, from + 999);
        if (error || !data || data.length === 0) break;

        for (const r of data as any[]) {
          const evN = r.batted_balls_allowed_with_ev ?? 0;
          const trackedDen = evN >= MIN_TRACKED_BIP ? evN : null;
          const pct = (n: number | null, d: number | null) =>
            n != null && d != null && d > 0 ? (n / d) * 100 : null;

          out.push({
            stuffPlus: r.stuff_plus_data_pitches > 0
              ? r.stuff_plus_sum / r.stuff_plus_data_pitches
              : null,
            whiff: pct(r.total_whiffs, r.total_swings),
            bb: pct(r.total_bb, r.total_pa),
            chase: pct(r.total_chases, r.total_out_of_zone),
            barrel: pct(r.batted_barrels_allowed, trackedDen),
            hardHit: pct(r.batted_hard_hit_allowed, trackedDen),
            izWhiff: pct(r.total_in_zone_whiffs, r.total_in_zone_swings),
            gb: pct(r.batted_ground_balls_allowed, trackedDen),
            avgEv: trackedDen != null ? r.ev_sum_allowed / trackedDen : null,
          });
        }
        if (data.length < 1000) break;
        from += 1000;
      }
      return out;
    },
  });
}
