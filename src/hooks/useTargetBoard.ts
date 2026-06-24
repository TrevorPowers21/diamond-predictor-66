import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

// Cast to bypass generated types until supabase types are regenerated
const tb = () => supabase.from("target_board" as any);

export type PortalStatus = "NOT IN PORTAL" | "WATCHING" | "IN PORTAL" | "COMMITTED";

export interface TargetBoardRow {
  id: string;
  player_id: string;
  source_player_id: string | null;
  notes: string | null;
  added_at: string;
  // joined from players
  first_name: string;
  last_name: string;
  team: string | null;
  conference: string | null;
  position: string | null;
  class_year: string | null;
  portal_status: PortalStatus;
  bats_hand: string | null;
  division: string | null;
}

/**
 * Team-wide recruiting watchlist. Scoped on customer_team_id only so every
 * coach on the same team sees the same shared board — Coach A's add shows
 * up for Coach B and vice versa. user_id stays on insert as audit ("who
 * added it") but does NOT filter reads or deletes.
 *
 * Migration 2026-06-17: changed scoping from (user, customer_team_id) to
 * customer_team_id only. Requires DB-side unique-constraint swap from
 * (user_id, customer_team_id, player_id) → (customer_team_id, player_id)
 * plus a one-time dedupe of duplicate (team, player) rows that the old
 * constraint had allowed. SQL lives in commit message of this change.
 *
 * No team in scope (superadmin not impersonating) → returns an empty
 * board. Surfaces should prompt the user to pick a team rather than
 * mixing legacy unscoped rows back in.
 */
export function useTargetBoard() {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();

  const { data: board = [], isLoading } = useQuery({
    queryKey: ["target-board", effectiveTeamId ?? null],
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async () => {
      const { data, error } = await tb()
        .select("id, player_id, notes, added_at, players!inner(first_name, last_name, team, conference, position, class_year, portal_status, bats_hand, division, source_player_id)")
        // Team-scoped only — every coach on the team sees the same board.
        .eq("customer_team_id", effectiveTeamId!)
        .order("added_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        player_id: row.player_id,
        source_player_id: row.players.source_player_id ?? null,
        notes: row.notes,
        added_at: row.added_at,
        first_name: row.players.first_name,
        last_name: row.players.last_name,
        team: row.players.team,
        conference: row.players.conference,
        position: row.players.position,
        class_year: row.players.class_year,
        portal_status: row.players.portal_status || "NOT IN PORTAL",
        bats_hand: row.players.bats_hand ?? null,
        division: row.players.division ?? null,
      })) as TargetBoardRow[];
    },
    // Refetch when the user re-focuses TB / Targets / any surface using the
    // hook. Profile add in another tab/route → target_board mutation runs in
    // that context → this query may be cached as fresh on the other surface.
    // refetchOnWindowFocus guarantees the latest server state on focus.
    refetchOnWindowFocus: true,
    // Treat data as immediately stale so any refetch trigger (focus,
    // remount, invalidation) actually re-runs the network call instead of
    // serving cached.
    staleTime: 0,
  });

  const playerIds = new Set(board.map((r) => r.player_id));

  const addPlayer = useMutation({
    mutationFn: async ({ playerId, silent: _silent }: { playerId: string; silent?: boolean }) => {
      if (!user?.id) throw new Error("Not logged in");
      if (!effectiveTeamId) throw new Error("No team in scope — impersonate or join a team first");
      const { error } = await tb()
        .insert({
          user_id: user.id,
          player_id: playerId,
          customer_team_id: effectiveTeamId,
        });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["target-board", effectiveTeamId ?? null] });
      // silent=true suppresses the toast. Used by the TB roster→supabase sync
      // effect, which can fire on every remount; the user-facing add path
      // (PlayerProfile / Dashboard "Add to board" buttons) leaves silent
      // undefined so they keep their visible confirmation.
      if (!variables?.silent) toast.success("Added to Target Board");
    },
    onError: (e: any, variables) => {
      if (e?.message?.includes("duplicate") || e?.code === "23505") {
        if (!variables?.silent) toast.info("Already on Target Board");
      } else {
        toast.error(`Failed to add: ${e.message}`);
      }
    },
  });

  const removePlayer = useMutation({
    mutationFn: async (playerId: string) => {
      if (!user?.id) throw new Error("Not logged in");
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await tb()
        .delete()
        // Team-scoped delete — any coach on the team can remove any entry.
        .eq("customer_team_id", effectiveTeamId)
        .eq("player_id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["target-board", effectiveTeamId ?? null] });
      toast.success("Removed from Target Board");
    },
    onError: (e: any) => toast.error(`Failed to remove: ${e.message}`),
  });

  return {
    board,
    isLoading,
    playerIds,
    isOnBoard: (playerId: string) => playerIds.has(playerId),
    addPlayer: addPlayer.mutate,
    removePlayer: removePlayer.mutate,
  };
}
