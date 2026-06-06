import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useNilValuation(playerId: string | null | undefined) {
  return useQuery({
    queryKey: ["nil-valuation", playerId],
    enabled: !!playerId,
    staleTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nil_valuations")
        .select("player_id, season, estimated_value, war, updated_at")
        .eq("player_id", playerId!)
        .order("season", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
