import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pulls a pitcher's 2026 pitch_log totals row and returns rates in the
 * shape the PitcherProfile scouting grades / risk card need.
 *
 * Mirrors usePitchLog2026HitterRates on the pitcher side. Used to
 * compute live percentile-rank scouting grades that match the Pitcher
 * Stats page percentile bars.
 *
 * Stored data untouched — display-time read only.
 *
 * MIN_TRACKED_BIP floor (5): below that, Barrel% / HardHit% return null
 * because tracked-batted-balls denominator is too small to trust.
 * Fallback chain in the consumer hits PM stored values for low-track
 * pitchers.
 */
const MIN_TRACKED_BIP = 5;

export interface PitchLogPitcherRates2026 {
  stuffPlus: number | null;
  whiff: number | null;       // 0-100 percent
  bb: number | null;
  chase: number | null;
  barrel: number | null;       // allowed
  hardHit: number | null;      // allowed
  izWhiff: number | null;
  gb: number | null;           // allowed, lower better
  avgEv: number | null;        // allowed
  /** True when a pitch_log row was found with non-zero pitches. */
  hasData: boolean;
  totalPitches: number | null;
  totalPa: number | null;
}

export function usePitchLog2026PitcherRates(sourcePlayerId: string | null) {
  return useQuery({
    queryKey: ["pitch-log-2026-pitcher-rates", sourcePlayerId],
    enabled: !!sourcePlayerId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<PitchLogPitcherRates2026> => {
      const empty: PitchLogPitcherRates2026 = {
        stuffPlus: null, whiff: null, bb: null, chase: null, barrel: null,
        hardHit: null, izWhiff: null, gb: null, avgEv: null,
        hasData: false, totalPitches: null, totalPa: null,
      };
      if (!sourcePlayerId) return empty;

      const { data } = await (supabase as any)
        .from("pitch_log_pitcher_totals")
        .select(
          "total_pitches, total_swings, total_whiffs, total_in_zone, total_in_zone_swings, total_in_zone_whiffs, total_out_of_zone, total_chases, total_pa, total_bb, stuff_plus_sum, stuff_plus_data_pitches, batted_balls_allowed_in_play, batted_balls_allowed_with_ev, batted_barrels_allowed, batted_hard_hit_allowed, batted_ground_balls_allowed, ev_sum_allowed",
        )
        .eq("pitcher_id", sourcePlayerId)
        .eq("season", 2026)
        .eq("dimension_key", "all")
        .maybeSingle();

      if (!data) return empty;

      const r = data as any;
      const evN = r.batted_balls_allowed_with_ev ?? 0;
      const trackedDen = evN >= MIN_TRACKED_BIP ? evN : null;

      const pct = (n: number | null, d: number | null) =>
        n != null && d != null && d > 0 ? (n / d) * 100 : null;

      return {
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
        hasData: (r.total_pitches ?? 0) > 0,
        totalPitches: r.total_pitches ?? null,
        totalPa: r.total_pa ?? null,
      };
    },
  });
}
