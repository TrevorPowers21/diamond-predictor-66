import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useGmPlayerInfo } from "@/gm/hooks/useGmPlayerInfo";
import { useGmProgramMarketability } from "@/gm/hooks/useGmProgramMarketability";
import { computeMarketability, type ConnectionTier, type MarketabilityBreakdown } from "@/gm/lib/marketability";

/**
 * Gathers every marketability input for a player and returns the scored
 * breakdown. Shared by the hub Overview (score only) and the Financials tab
 * (full scorecard). Inputs: entered social counts + university connection
 * (gm_player_info), the program's community tier (gm_program_marketability),
 * and the player's draft rank (player_slot_values).
 */
export function useMarketability(playerId: string | null | undefined): {
  breakdown: MarketabilityBreakdown;
  totalFollowers: number;
  programTier: number | null;
  draftRank: number | null;
} {
  const { info } = useGmPlayerInfo(playerId);
  const { tier: programTier } = useGmProgramMarketability();

  const { data: draftRank = null } = useQuery({
    queryKey: ["gm-marketability-draft-rank", playerId],
    enabled: !!playerId,
    queryFn: async (): Promise<number | null> => {
      const { data } = await (supabase as any).from("player_slot_values")
        .select("rank").eq("player_id", playerId)
        .order("draft_year", { ascending: false }).limit(1).maybeSingle();
      return (data?.rank ?? null) as number | null;
    },
  });

  const totalFollowers = (info?.instagram_followers ?? 0) + (info?.twitter_followers ?? 0) + (info?.tiktok_followers ?? 0) + (info?.youtube_followers ?? 0);
  const breakdown = computeMarketability({
    totalFollowers,
    programTier,
    draftRank,
    connectionTier: (info?.university_connection_tier ?? null) as ConnectionTier,
  });

  return { breakdown, totalFollowers, programTier, draftRank };
}
