import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePitchingEquationWeights } from "@/hooks/usePitchingEquationWeights";
import { pickPreferredPrediction } from "@/lib/teamScopedPredictions";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";

// Standard-normal CDF (erf approximation) — same one the scouting pages use to
// turn a metric z-score into a 0-100 percentile.
const normalCdf = (x: number) => {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * ax);
  const erf = sign * (1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax));
  return 0.5 * (1 + erf);
};

// Slim previews for the player-hub Overview cards: the projected line
// (player_predictions, team-scoped preference) and the current-season line
// (season_stats). Both keyed by players.id.
export interface HubProjection {
  p_avg: number | null; p_obp: number | null; p_slg: number | null; p_ops: number | null; p_wrc_plus: number | null;
  p_era: number | null; p_fip: number | null; p_whip: number | null; p_k9: number | null; p_bb9: number | null;
  dev_aggressiveness: number | null; // dev-agg the row was computed with (scale from this to the build's)
  class_transition: string | null;   // drives the dev-agg class adjustment
}
// Advanced pitcher grades from "Pitching Master" (parallels the hitter card):
// Stuff+ / Whiff% / BB% / Barrel%, each with its 0–100 percentile score.
export interface HubPitcherAdvanced {
  stuff_plus: number | null; stuff_score: number | null;
  whiff: number | null; whiff_score: number | null;
  bb_pct: number | null; bb_score: number | null;
  barrel_pct: number | null; barrel_score: number | null;
}
// Advanced hitter line (Hitter Master + inferred bat speed) — batted-ball &
// plate discipline. Keyed by players.source_player_id (numeric TrackMan id), NOT
// the UUID. Blended values used when the master row is a combined sample.
export interface HubHitterAdvanced {
  barrel: number | null; avg_exit_velo: number | null; contact: number | null; chase: number | null;
  barrel_score: number | null; avg_ev_score: number | null; contact_score: number | null; chase_score: number | null;
}

export function usePlayerHubPreview(
  playerId: string | null | undefined,
  sourcePlayerId: string | null | undefined,
): { projection: HubProjection | null; hitterAdvanced: HubHitterAdvanced | null; pitcherAdvanced: HubPitcherAdvanced | null } {
  const { effectiveTeamId } = useAuth();

  const { data: projection = null } = useQuery({
    queryKey: ["hub-projection", playerId, effectiveTeamId ?? null],
    enabled: !!playerId,
    queryFn: async (): Promise<HubProjection | null> => {
      const { data } = await (supabase as any).from("player_predictions")
        .select("p_avg, p_obp, p_slg, p_ops, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, dev_aggressiveness, class_transition, variant, customer_team_id, pitcher_role")
        .eq("player_id", playerId).eq("season", PROJECTION_SEASON).eq("status", "active");
      return (pickPreferredPrediction((data ?? []) as any[], effectiveTeamId ?? null) ?? null) as HubProjection | null;
    },
  });

  // Stuff+ / Whiff% / BB% / Barrel% from the STORED pitch-log rollup
  // (pitch_log_pitcher_totals) — the same source the pitcher profile uses. Stuff+
  // = stuff_plus_sum/data_pitches (arsenal-weighted); Whiff = whiffs/swings (not
  // in-zone). Scores are z-scores off the pitching-equation NCAA avg/SD, so the
  // tiles match the profile page — NOT the Pitching-Master columns.
  const pitchingEq = usePitchingEquationWeights();
  const { data: plTotals = null } = useQuery({
    queryKey: ["hub-pitcher-plog", sourcePlayerId ?? null],
    enabled: !!sourcePlayerId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("pitch_log_pitcher_totals")
        .select("total_swings, total_whiffs, total_pa, total_bb, stuff_plus_sum, stuff_plus_data_pitches, batted_barrels_allowed, batted_balls_allowed_with_ev")
        .eq("pitcher_id", sourcePlayerId).eq("season", CURRENT_SEASON).eq("dimension_key", "all").maybeSingle();
      return (data ?? null) as any;
    },
  });
  const pitcherAdvanced: HubPitcherAdvanced | null = useMemo(() => {
    const r = plTotals;
    if (!r) return null;
    const div = (n: number | null, d: number | null) => (d != null && d > 0 ? (n ?? 0) / d : null);
    const pct = (n: number | null, d: number | null) => { const v = div(n, d); return v == null ? null : v * 100; };
    const score = (v: number | null, avg: number, sd: number, lower = false) => {
      if (v == null || !Number.isFinite(sd) || sd <= 0) return null;
      const p = normalCdf((v - avg) / sd) * 100;
      return lower ? 100 - p : p;
    };
    const stuff = div(r.stuff_plus_sum, r.stuff_plus_data_pitches);
    const whiff = pct(r.total_whiffs, r.total_swings);
    const bb = pct(r.total_bb, r.total_pa);
    const barrel = pct(r.batted_barrels_allowed, r.batted_balls_allowed_with_ev);
    const stuffAvg = Number.isFinite(pitchingEq.p_ncaa_avg_stuff_plus) ? pitchingEq.p_ncaa_avg_stuff_plus : 100;
    const stuffSd = Number.isFinite(pitchingEq.p_sd_stuff_plus) && pitchingEq.p_sd_stuff_plus > 0 ? pitchingEq.p_sd_stuff_plus : 3.97;
    return {
      stuff_plus: stuff, stuff_score: score(stuff, stuffAvg, stuffSd),
      whiff, whiff_score: score(whiff, pitchingEq.p_ncaa_avg_whiff_pct, pitchingEq.p_sd_whiff_pct),
      bb_pct: bb, bb_score: score(bb, pitchingEq.p_ncaa_avg_bb_pct, pitchingEq.p_sd_bb_pct, true),
      barrel_pct: barrel, barrel_score: score(barrel, pitchingEq.p_ncaa_avg_barrel_pct, pitchingEq.p_sd_barrel_pct, true),
    };
  }, [plTotals, pitchingEq]);

  // Barrel% / Exit Velo / Contact% / Chase% from Hitter Master (blended-aware).
  const { data: hitterAdvanced = null } = useQuery({
    queryKey: ["hub-hitter-adv", sourcePlayerId ?? null],
    enabled: !!sourcePlayerId,
    queryFn: async (): Promise<HubHitterAdvanced | null> => {
      const { data } = await (supabase as any).from("Hitter Master")
        .select("barrel, avg_exit_velo, contact, chase, barrel_score, avg_ev_score, contact_score, chase_score, blended_barrel, blended_avg_exit_velo, blended_contact, blended_chase, combined_used")
        .eq("source_player_id", sourcePlayerId).eq("Season", CURRENT_SEASON).limit(1);
      const r = data?.[0];
      if (!r) return null;
      const cu = !!r.combined_used;
      return {
        barrel: cu ? (r.blended_barrel ?? r.barrel) : r.barrel,
        avg_exit_velo: cu ? (r.blended_avg_exit_velo ?? r.avg_exit_velo) : r.avg_exit_velo,
        contact: cu ? (r.blended_contact ?? r.contact) : r.contact,
        chase: cu ? (r.blended_chase ?? r.chase) : r.chase,
        barrel_score: r.barrel_score ?? null,
        avg_ev_score: r.avg_ev_score ?? null,
        contact_score: r.contact_score ?? null,
        chase_score: r.chase_score ?? null,
      };
    },
  });

  return { projection, hitterAdvanced, pitcherAdvanced };
}
