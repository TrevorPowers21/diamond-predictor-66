import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Qualified 2026 D1 hitter population for percentile-rank scoring.
 *
 * Fetched ONCE per session (30-min staleTime). Returns the raw rates
 * for every qualified hitter (PA >= 30) so that PlayerProfile and other
 * Overview surfaces can compute percentile-rank scouting grades that
 * match the Season Stats page's percentile bars exactly.
 *
 * Without this, Overview's `computePowerRatings`-based grades use the
 * HM-calibrated baselines (`HITTER_DEFAULTS`) which don't reflect the
 * current pitch_log population — Hudson Brown gets a different grade
 * on Overview vs his Stats page rank, even though both are derived
 * from the same metric. Using percentile-rank here makes the two
 * surfaces consistent.
 */
export interface PitchLogHitterPopRow {
  sourcePlayerId: string;
  contact: number | null;
  lineDrive: number | null;
  avgExitVelo: number | null;
  popUp: number | null;
  bb: number | null;
  chase: number | null;
  barrel: number | null;
  hardHit: number | null;
  la1030: number | null;
  gb: number | null;
}

const MIN_PA = 30;
const MIN_TRACKED_BIP = 5;

export function usePitchLog2026HitterPop() {
  return useQuery({
    queryKey: ["pitch-log-2026-hitter-pop"],
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<PitchLogHitterPopRow[]> => {
      const out: PitchLogHitterPopRow[] = [];
      let from = 0;
      const cols =
        "batter_id, pa, total_pitches, total_swings, total_whiffs, total_in_zone, total_out_of_zone, total_chases, bb, batted_balls_in_play, batted_balls_with_ev, batted_barrels, batted_hard_hit, ev_sum, batted_ground_balls, batted_line_drives, batted_pop_ups, batted_la_10_to_30";

      while (true) {
        const { data, error } = await (supabase as any)
          .from("pitch_log_hitter_totals")
          .select(cols)
          .eq("season", 2026)
          .eq("dimension_key", "all")
          .gte("pa", MIN_PA)
          .range(from, from + 999);
        if (error || !data || data.length === 0) break;

        for (const r of data as any[]) {
          const evN = r.batted_balls_with_ev ?? 0;
          const denomEV = evN >= MIN_TRACKED_BIP ? evN : null;
          const outOfZone = r.total_out_of_zone ?? 0;
          const pct = (n: number | null, d: number | null) =>
            n != null && d != null && d > 0 ? (n / d) * 100 : null;

          out.push({
            sourcePlayerId: String(r.batter_id),
            contact: r.total_swings > 0
              ? ((r.total_swings - r.total_whiffs) / r.total_swings) * 100
              : null,
            lineDrive: pct(r.batted_line_drives, denomEV),
            avgExitVelo: denomEV != null ? r.ev_sum / denomEV : null,
            popUp: pct(r.batted_pop_ups, denomEV),
            bb: pct(r.bb, r.pa),
            chase: pct(r.total_chases, outOfZone),
            barrel: pct(r.batted_barrels, denomEV),
            hardHit: pct(r.batted_hard_hit, denomEV),
            la1030: pct(r.batted_la_10_to_30, denomEV),
            gb: pct(r.batted_ground_balls, denomEV),
          });
        }
        if (data.length < 1000) break;
        from += 1000;
      }
      return out;
    },
  });
}
