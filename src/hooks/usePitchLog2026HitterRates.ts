import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pulls a hitter's 2026 pitch_log totals row and returns rates in the
 * shape expected by `computeHitterPowerRatings`.
 *
 * Use case: Overview displays (PlayerProfile scouting grades) prefer
 * these rates over Hitter Master because pitch_log is the comprehensive
 * 2026 source. HM is fallback when pitch_log row is missing (D2 / non-
 * tracked players have no row at all — fallback enters the existing
 * stored-score path).
 *
 * NOT a recompute of stored data — this is a display-time read. The
 * stored Hitter Master.X_score values remain untouched.
 *
 * Fields NOT yet derivable from pitch_log (require future work):
 *   - ev90 (90th-percentile EV — needs per-pitcher quantile)
 *   - pull (needs spray-angle data, deferred)
 * These return null and the caller falls back to HM's stored score.
 */
export interface PitchLogHitterRates2026 {
  contact: number | null;
  lineDrive: number | null;
  avgExitVelo: number | null;
  popUp: number | null;
  bb: number | null;
  chase: number | null;
  barrel: number | null;
  ev90: number | null;
  pull: number | null;
  la10_30: number | null;
  gb: number | null;
  /** True when a pitch_log row was found — caller can decide whether to switch sources. */
  hasData: boolean;
  /** 2026 PA from pitch_log (sanity check — small PA → low confidence). */
  pa: number | null;
  /**
   * 2026 traditional slash line derived from pitch_log raw counts.
   * Used by PlayerProfile career stats table (Switch #6) to show the
   * truer 2026 line including postseason games that HM doesn't have.
   * null when pa is 0.
   */
  ab: number | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
}

export function usePitchLog2026HitterRates(sourcePlayerId: string | null) {
  return useQuery({
    queryKey: ["pitch-log-2026-hitter-rates", sourcePlayerId],
    enabled: !!sourcePlayerId,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<PitchLogHitterRates2026> => {
      const empty: PitchLogHitterRates2026 = {
        contact: null, lineDrive: null, avgExitVelo: null, popUp: null,
        bb: null, chase: null, barrel: null, ev90: null, pull: null,
        la10_30: null, gb: null, hasData: false, pa: null,
        ab: null, avg: null, obp: null, slg: null,
      };
      if (!sourcePlayerId) return empty;

      const { data } = await (supabase as any)
        .from("pitch_log_hitter_totals")
        .select(
          "pa, ab, sac, hits_single, hits_double, hits_triple, hits_hr, bb, hbp, total_pitches, total_swings, total_whiffs, total_in_zone, total_out_of_zone, total_chases, batted_balls_in_play, batted_barrels, ev_sum, batted_balls_with_ev, batted_ground_balls, batted_line_drives, batted_fly_balls, batted_pop_ups, batted_la_10_to_30, ev_90, batted_pull, batted_center, batted_oppo",
        )
        .eq("batter_id", sourcePlayerId)
        .eq("season", 2026)
        .eq("dimension_key", "all")
        .maybeSingle();

      if (!data) return empty;

      const r = data as any;
      // Chase% denominator: definite-OOZ pitches only (is_in_zone IS
      // FALSE). The old formula (total_pitches - total_in_zone)
      // included untracked pitches in the denominator, crashing rates
      // to ~70% of true value — see Hudson Brown audit 2026-06-23.
      const outOfZone = r.total_out_of_zone ?? 0;
      const bip = r.batted_balls_in_play ?? 0;
      const evN = r.batted_balls_with_ev ?? 0;

      // Convert ratios to 0-100 percentages — the baselines that
      // computePowerRatings uses expect the HM-style scale.
      const pct = (num: number | null, den: number | null) =>
        num != null && den != null && den > 0 ? (num / den) * 100 : null;

      // CRITICAL: batted_barrels / batted_line_drives / batted_ground_balls
      // / batted_pop_ups / batted_la_10_to_30 all have implicit "EV/LA
      // NOT NULL" filters in the aggregation SQL — they only count
      // tracked balls. So the denominator must be tracked-balls
      // (batted_balls_with_ev), NOT batted_balls_in_play. Using BIP
      // as the denominator divides tracked-only events by an
      // untracked-inclusive denominator, crashing the rates to ~33-50%
      // of true value for players with partial-game tracking. That
      // misalignment matched the Overview-vs-Stats grade drift coaches
      // were seeing — Stats percentiles use the right denominator,
      // Overview scouting grades were on the wrong one until this fix.
      const trackedBipFloor = 5; // min tracked balls before we trust the rate
      const evDen = evN >= trackedBipFloor ? evN : null;

      // Traditional slash from pitch_log raw counts (Switch #6).
      const hits = (r.hits_single ?? 0) + (r.hits_double ?? 0)
        + (r.hits_triple ?? 0) + (r.hits_hr ?? 0);
      const tb = (r.hits_single ?? 0) + 2 * (r.hits_double ?? 0)
        + 3 * (r.hits_triple ?? 0) + 4 * (r.hits_hr ?? 0);
      const obpDen = (r.ab ?? 0) + (r.bb ?? 0) + (r.hbp ?? 0) + (r.sac ?? 0);
      const onBaseNum = hits + (r.bb ?? 0) + (r.hbp ?? 0);

      return {
        contact: r.total_swings > 0
          ? ((r.total_swings - r.total_whiffs) / r.total_swings) * 100
          : null,
        lineDrive: pct(r.batted_line_drives, evDen),
        avgExitVelo: evN >= trackedBipFloor ? r.ev_sum / evN : null,
        popUp: pct(r.batted_pop_ups, evDen),
        bb: pct(r.bb, r.pa),
        chase: pct(r.total_chases, outOfZone),
        barrel: pct(r.batted_barrels, evDen),
        // EV90: own 90th-pct EV (percentile_cont from pitch_log). Gated on
        // the tracked-BIP floor so a p90 off a tiny sample isn't trusted.
        ev90: evN >= trackedBipFloor && r.ev_90 != null ? Number(r.ev_90) : null,
        // Directional pull% = pull / (pull+center+oppo), to match HM `pull`
        // baseline (36.5), NOT pull-air. Hand-resolved per row upstream.
        pull: (() => {
          const dir = (r.batted_pull ?? 0) + (r.batted_center ?? 0) + (r.batted_oppo ?? 0);
          return dir > 0 ? ((r.batted_pull ?? 0) / dir) * 100 : null;
        })(),
        la10_30: pct(r.batted_la_10_to_30, evDen),
        gb: pct(r.batted_ground_balls, evDen),
        hasData: (r.pa ?? 0) > 0 || bip > 0,
        pa: r.pa ?? null,
        ab: r.ab ?? null,
        avg: (r.ab ?? 0) > 0 ? hits / r.ab : null,
        obp: obpDen > 0 ? onBaseNum / obpDen : null,
        slg: (r.ab ?? 0) > 0 ? tb / r.ab : null,
      };
    },
  });
}
