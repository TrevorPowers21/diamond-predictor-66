import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PlayerPredictionRow {
  id: string;
  player_id: string;
  season: number;
  class_transition: string | null;
  from_avg: number | null;
  from_obp: number | null;
  from_slg: number | null;
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_ops: number | null;
  p_iso: number | null;
  p_wrc_plus: number | null;
  power_rating_plus: number | null;
}

/**
 * Fetches the 2025 returner prediction for a player by source_player_id.
 * Used to render the "2026 projection" card on the savant hitter profile.
 */
export function usePlayerPrediction(sourcePlayerId: string | null | undefined) {
  return useQuery({
    queryKey: ["savant_player_prediction", sourcePlayerId],
    enabled: !!sourcePlayerId,
    queryFn: async () => {
      // First resolve players.id from source_player_id
      const { data: playerRow, error: pErr } = await supabase
        .from("players")
        .select("id")
        .eq("source_player_id", sourcePlayerId!)
        .maybeSingle();
      if (pErr || !playerRow) return null;

      const { data, error } = await supabase
        .from("player_predictions")
        .select(
          "id, player_id, season, class_transition, from_avg, from_obp, from_slg, p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, power_rating_plus",
        )
        .eq("player_id", (playerRow as any).id)
        .eq("season", 2025)
        .eq("model_type", "returner")
        .eq("variant", "regular")
        .maybeSingle();
      if (error) return null;
      return (data as unknown as PlayerPredictionRow) || null;
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
