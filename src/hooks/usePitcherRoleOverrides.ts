import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type PitcherRole = "SP" | "RP" | "SM";

interface RoleOverrideRow {
  id: string;
  player_id: string;
  role: PitcherRole;
}

/**
 * Reads pitcher role overrides from Supabase `pitcher_role_overrides` table.
 * Returns a Map of player_id → role for instant lookups.
 *
 * When Phase 5 adds RLS, this will automatically scope to the current team
 * without any code changes.
 */
export function usePitcherRoleOverrides() {
  const queryClient = useQueryClient();

  const { data: overrideMap = new Map<string, PitcherRole>() } = useQuery({
    queryKey: ["pitcher_role_overrides"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pitcher_role_overrides")
        .select("player_id, role");
      if (error) throw error;
      const map = new Map<string, PitcherRole>();
      for (const row of (data || []) as RoleOverrideRow[]) {
        map.set(row.player_id, row.role as PitcherRole);
      }
      return map;
    },
    staleTime: 10 * 60 * 1000,
  });

  const setRole = useMutation({
    mutationFn: async ({ playerId, role }: { playerId: string; role: PitcherRole | null }) => {
      if (role == null) {
        // Delete override
        const { error } = await supabase
          .from("pitcher_role_overrides")
          .delete()
          .eq("player_id", playerId);
        if (error) throw error;
      } else {
        // Upsert override
        const { error } = await supabase
          .from("pitcher_role_overrides")
          .upsert(
            { player_id: playerId, role, updated_at: new Date().toISOString() },
            { onConflict: "player_id" },
          );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pitcher_role_overrides"] });
    },
  });

  return {
    /** Map of player_id → role override */
    overrides: overrideMap,
    /** Get a specific player's role override (or null if none) */
    getRole: (playerId: string | null | undefined): PitcherRole | null => {
      if (!playerId) return null;
      return overrideMap.get(playerId) ?? null;
    },
    /** Set or clear a player's role override */
    setRole: (playerId: string, role: PitcherRole | null) => {
      setRole.mutate({ playerId, role });
    },
    isLoading: setRole.isPending,
  };
}
