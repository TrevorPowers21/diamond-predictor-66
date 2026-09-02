import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import type { NilAllocationMode } from "@/lib/nilAllocation";

/**
 * The team's NIL allocation philosophy — "balanced" (floor-based, default) or
 * "top_heavy" — read from the SINGLE source of truth, gm_budget. Every surface
 * that shows a projected budget reads the same value, so the GM's Balanced/
 * Top-Heavy toggle changes all of them at once (GM pages read it via useGmRoster;
 * Team Builder + GM Scenarios read it here). This is ONLY the allocation mode —
 * actual pay + overall budget still flow GM → coach via the save/push path,
 * unchanged. Defaults "balanced" when the team has no gm_budget row yet.
 */
export function useNilAllocationMode(
  teamId: string | null | undefined,
  season: number = PROJECTION_SEASON,
): NilAllocationMode {
  const { data } = useQuery({
    queryKey: ["nil-allocation-mode", teamId ?? null, season],
    enabled: !!teamId,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<NilAllocationMode> => {
      const { data } = await (supabase as any)
        .from("gm_budget")
        .select("nil_allocation_mode")
        .eq("customer_team_id", teamId)
        .eq("season", season)
        .maybeSingle();
      return (data?.nil_allocation_mode as NilAllocationMode) ?? "balanced";
    },
  });
  return data ?? "balanced";
}
