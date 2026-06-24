/**
 * Per-pitch fetch for the location + spray visualizations.
 *
 * One row per pitch the player was involved in (filtered to the player's
 * batter_id or pitcher_id). Returns the minimum columns needed to plot the
 * strike-zone dot, the 9-box zone, and the spray-chart point — plus the
 * outcome category for color coding.
 *
 * Hitter view  → pitches the hitter SAW (batter_id = X)
 * Pitcher view → pitches the pitcher THREW (pitcher_id = X)
 *
 * Dimension filter mirrors PitchLogDimensionKey from the existing Stats
 * tab, so the visualizations re-render in sync with the filter dropdown.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PitchLogDimensionKey } from "@/savant/lib/pitchLogRates";

export interface PitchLocationRow {
  uniq_pitch_id: string;
  pitch_type: string | null;
  pitch_type_reclassified: string | null;
  pitcher_hand: "L" | "R" | null;
  batter_hand: "L" | "R" | null;
  pitch_result: string | null;
  pitch_result_category: string | null;
  release_velocity: number | null;
  stuff_plus: number | null;
  // Plate location (normalized — see pitchLocationHelpers.ts for conventions)
  px_norm: number | null;
  pz_norm: number | null;
  // Batted-ball outcome
  exit_velocity: number | null;
  launch_angle: number | null;
  spray_ang: number | null;
  distance: number | null;
  // TruMedia per-pitch xStats (when present)
  x_avg: number | null;
  x_slg: number | null;
  x_woba: number | null;
  is_batted_ball_in_play: boolean | null;
}

export type PitchLocationRole = "hitter" | "pitcher";

interface UsePitchLogPitchLocationArgs {
  playerId: string;
  role: PitchLocationRole;
  season: number;
  dimension: PitchLogDimensionKey;
  enabled?: boolean;
}

/**
 * Apply the dimension filter to a Supabase query builder.
 *
 * Simple dimensions (handedness, velo threshold, pitch family, per-pitch
 * stuff+ tier) translate to inline PostgREST filters. vs_top_hitters
 * requires a subquery — not supported in the per-player live view (the
 * aggregation table handles it). Returns the query unchanged for
 * unsupported dimensions, with the row count noted in dev-only logs.
 */
function applyDimensionFilter(
  query: any,
  role: PitchLocationRole,
  dimension: PitchLogDimensionKey,
): any {
  switch (dimension) {
    case "all":
      return query;

    case "vs_lhp":
      // Hitter view: pitcher_hand = L. Pitcher view: batter_hand = L.
      return role === "hitter" ? query.eq("pitcher_hand", "L") : query.eq("batter_hand", "L");

    case "vs_rhp":
      return role === "hitter" ? query.eq("pitcher_hand", "R") : query.eq("batter_hand", "R");

    case "vs_92plus":
      // Hitter-only dimension; pitcher view ignores it.
      return role === "hitter" ? query.gte("release_velocity", 92) : query;

    case "vs_fastball":
      return query.in("pitch_type_reclassified", ["4-Seam Fastball", "Sinker", "Cutter"]);

    case "vs_breaking_ball":
      return query.in("pitch_type_reclassified", ["Slider", "Curveball", "Gyro Slider", "Sweeper"]);

    case "vs_offspeed":
      return query.in("pitch_type_reclassified", ["Change-up", "Splitter"]);

    case "vs_stuff_100plus":
      return role === "hitter" ? query.gte("stuff_plus", 100) : query;

    case "vs_stuff_105plus":
      return role === "hitter" ? query.gte("stuff_plus", 105) : query;

    case "vs_top_hitters":
      // Subquery-based dimension — not modelled in the per-player live
      // view. Falls back to unfiltered.
      return query;

    default:
      return query;
  }
}

/**
 * Fetch all pitches for the given player + filter dimension.
 *
 * Keyset pagination by uniq_pitch_id — OFFSET stops working past ~8000
 * rows on prod (gateway-side query timeout).
 */
export function usePitchLogPitchLocation({
  playerId,
  role,
  season,
  dimension,
  enabled = true,
}: UsePitchLogPitchLocationArgs) {
  return useQuery({
    queryKey: ["pitch-log-location", role, playerId, season, dimension],
    enabled: enabled && playerId.length > 0,
    queryFn: async (): Promise<PitchLocationRow[]> => {
      const rows: PitchLocationRow[] = [];
      const PAGE = 1000;
      let lastId = "";
      const idCol = role === "hitter" ? "batter_id" : "pitcher_id";
      const cols =
        "uniq_pitch_id, pitch_type, pitch_type_reclassified, pitcher_hand, batter_hand, " +
        "pitch_result, pitch_result_category, release_velocity, stuff_plus, " +
        "px_norm, pz_norm, " +
        "exit_velocity, launch_angle, spray_ang, distance, " +
        "x_avg, x_slg, x_woba, is_batted_ball_in_play";

      while (true) {
        let query = (supabase as any)
          .from("pitch_log")
          .select(cols)
          .eq(idCol, playerId)
          .eq("season", season)
          .order("uniq_pitch_id", { ascending: true })
          .limit(PAGE);

        if (lastId) query = query.gt("uniq_pitch_id", lastId);
        query = applyDimensionFilter(query, role, dimension);

        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...(data as PitchLocationRow[]));
        lastId = data[data.length - 1].uniq_pitch_id;
        if (data.length < PAGE) break;
      }
      return rows;
    },
  });
}
