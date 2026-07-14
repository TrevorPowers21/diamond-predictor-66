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
export interface HubSeason {
  batting_avg: number | null; on_base_pct: number | null; slugging_pct: number | null;
  hits: number | null; home_runs: number | null; rbi: number | null;
  era: number | null; innings_pitched: number | null; pitch_strikeouts: number | null; pitch_walks: number | null; whip: number | null;
}

export function usePlayerHubPreview(playerId: string | null | undefined): { projection: HubProjection | null; season: HubSeason | null } {
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

  const { data: season = null } = useQuery({
    queryKey: ["hub-season", playerId],
    enabled: !!playerId,
    queryFn: async (): Promise<HubSeason | null> => {
      const { data } = await (supabase as any).from("season_stats")
        .select("batting_avg, on_base_pct, slugging_pct, hits, home_runs, rbi, era, innings_pitched, pitch_strikeouts, pitch_walks, whip")
        .eq("player_id", playerId).eq("season", CURRENT_SEASON).maybeSingle();
      return (data ?? null) as HubSeason | null;
    },
  });

  return { projection, season };
}
