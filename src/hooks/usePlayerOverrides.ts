import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ClassTransition = "FS" | "SJ" | "JS" | "GR";

export interface PlayerOverride {
  position: string | null;
  class_transition: ClassTransition | null;
  dev_aggressiveness: number | null;
}

interface OverrideRow {
  player_id: string;
  position: string | null;
  class_transition: ClassTransition | null;
  dev_aggressiveness: number | null;
}

const EMPTY_OVERRIDE: PlayerOverride = {
  position: null,
  class_transition: null,
  dev_aggressiveness: null,
};

/**
 * Reads hitter-side player overrides from Supabase `player_overrides` table.
 * Replaces the localStorage system at src/lib/playerOverrides.ts.
 *
 * Returns a Map of player_id → override for instant lookups, plus a
 * setOverride mutation that upserts changed fields and deletes the row when
 * every field becomes null.
 *
 * Pitcher role overrides remain in `pitcher_role_overrides`; pitcher
 * class_transition + dev_aggressiveness remain in `player_predictions`.
 * This split intentionally mirrors the broader hitter/pitcher separation
 * across the codebase.
 *
 * When Phase 5 adds RLS, this will automatically scope to the current team
 * without any code changes.
 */
export function usePlayerOverrides() {
  const queryClient = useQueryClient();

  const { data: overrideMap = new Map<string, PlayerOverride>() } = useQuery({
    queryKey: ["player_overrides"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_overrides")
        .select("player_id, position, class_transition, dev_aggressiveness");
      if (error) throw error;
      const map = new Map<string, PlayerOverride>();
      for (const row of (data || []) as OverrideRow[]) {
        map.set(row.player_id, {
          position: row.position,
          class_transition: row.class_transition,
          dev_aggressiveness:
            row.dev_aggressiveness == null ? null : Number(row.dev_aggressiveness),
        });
      }
      return map;
    },
    staleTime: 10 * 60 * 1000,
  });

  const upsert = useMutation({
    mutationFn: async ({
      playerId,
      override,
    }: {
      playerId: string;
      override: PlayerOverride;
    }) => {
      // If every field is null, delete the row entirely so we don't leave
      // empty override rows lying around.
      const allEmpty =
        override.position == null &&
        override.class_transition == null &&
        override.dev_aggressiveness == null;
      if (allEmpty) {
        const { error } = await supabase
          .from("player_overrides")
          .delete()
          .eq("player_id", playerId);
        if (error) throw error;
        return;
      }
      const { error } = await supabase
        .from("player_overrides")
        .upsert(
          {
            player_id: playerId,
            position: override.position,
            class_transition: override.class_transition,
            dev_aggressiveness: override.dev_aggressiveness,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "player_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["player_overrides"] });
    },
  });

  return {
    /** Map of player_id → full override row */
    overrides: overrideMap,
    /** Get a specific player's override (returns empty override if none) */
    getOverride: (playerId: string | null | undefined): PlayerOverride => {
      if (!playerId) return EMPTY_OVERRIDE;
      return overrideMap.get(playerId) ?? EMPTY_OVERRIDE;
    },
    /**
     * Merge an update onto a player's existing override row. Pass `null` for
     * any field to clear that specific field. Row is deleted when every
     * field becomes null.
     */
    updateOverride: (playerId: string, updates: Partial<PlayerOverride>) => {
      if (!playerId) return;
      const current = overrideMap.get(playerId) ?? EMPTY_OVERRIDE;
      const merged: PlayerOverride = {
        position: updates.position !== undefined ? updates.position : current.position,
        class_transition:
          updates.class_transition !== undefined ? updates.class_transition : current.class_transition,
        dev_aggressiveness:
          updates.dev_aggressiveness !== undefined ? updates.dev_aggressiveness : current.dev_aggressiveness,
      };
      upsert.mutate({ playerId, override: merged });
    },
    isLoading: upsert.isPending,
  };
}
