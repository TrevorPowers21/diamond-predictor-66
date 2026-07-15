import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { pickPreferredPrediction } from "@/lib/teamScopedPredictions";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";

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

  // Stuff+ / Whiff% / BB% / Barrel% from "Pitching Master" (source_player_id).
  const { data: pitcherAdvanced = null } = useQuery({
    queryKey: ["hub-pitcher-adv", sourcePlayerId ?? null],
    enabled: !!sourcePlayerId,
    queryFn: async (): Promise<HubPitcherAdvanced | null> => {
      const { data } = await (supabase as any).from("Pitching Master")
        .select("stuff_plus, stuff_score, in_zone_whiff_pct, iz_whiff_score, bb_pct, bb_score, barrel_pct, barrel_score")
        .eq("source_player_id", sourcePlayerId).eq("Season", CURRENT_SEASON).limit(1);
      const r = data?.[0];
      if (!r) return null;
      return {
        stuff_plus: r.stuff_plus ?? null, stuff_score: r.stuff_score ?? null,
        whiff: r.in_zone_whiff_pct ?? null, whiff_score: r.iz_whiff_score ?? null,
        bb_pct: r.bb_pct ?? null, bb_score: r.bb_score ?? null,
        barrel_pct: r.barrel_pct ?? null, barrel_score: r.barrel_score ?? null,
      };
    },
  });

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
