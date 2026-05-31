import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * One AI-generated scouting report for a (player, side). Reports are bulk-
 * generated and stable; there is no in-app regeneration. Read-only.
 */
export interface AiScoutingReportRow {
  player_id: string;
  side: "hitter" | "pitcher";
  archetype_id: string;
  body: string;
  model: string;
  generated_at: string;
}

export function useScoutingReport(
  playerId: string | null | undefined,
  side: "hitter" | "pitcher",
) {
  return useQuery({
    queryKey: ["ai-scouting-report", playerId, side],
    enabled: !!playerId,
    staleTime: 60 * 60 * 1000,
    queryFn: async (): Promise<AiScoutingReportRow | null> => {
      const { data, error } = await supabase
        .from("ai_scouting_reports")
        .select("player_id, side, archetype_id, body, model, generated_at")
        .eq("player_id", playerId!)
        .eq("side", side)
        .maybeSingle();
      if (error) throw error;
      return (data as AiScoutingReportRow | null) ?? null;
    },
  });
}
