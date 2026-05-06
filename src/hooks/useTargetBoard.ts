import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

// Cast to bypass generated types until supabase types are regenerated
const tb = () => supabase.from("target_board" as any);

export type PortalStatus = "NOT IN PORTAL" | "WATCHING" | "IN PORTAL" | "COMMITTED";

/**
 * Snapshot of the simulated transfer projection at the time the player was
 * added to the board. Persisted so TB / Dashboard / PDFs all show what the
 * coach saw in the simulator instead of recomputing live with hardcoded
 * defaults. Optional — players added from PlayerProfile or Dashboard
 * without going through the simulator have no snapshot, and downstream
 * surfaces fall back to live recompute.
 */
export interface TransferSnapshot {
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_wrc_plus: number | null;
  p_era: number | null;
  p_fip: number | null;
  p_whip: number | null;
  p_k9: number | null;
  p_bb9: number | null;
  p_hr9: number | null;
  p_rv_plus: number | null;
  p_war: number | null;
  owar: number | null;
  nil_valuation: number | null;
  from_team: string | null;
  from_team_id: string | null;
  destination_team: string | null;
  destination_team_id: string | null;
  class_transition: string | null;
  dev_aggressiveness: number | null;
  captured_at: string;
}

export interface TargetBoardRow {
  id: string;
  player_id: string;
  notes: string | null;
  added_at: string;
  destination_team: string | null;
  destination_team_id: string | null;
  transfer_snapshot: TransferSnapshot | null;
  // joined from players
  first_name: string;
  last_name: string;
  team: string | null;
  conference: string | null;
  position: string | null;
  class_year: string | null;
  portal_status: PortalStatus;
}

/**
 * Per-team recruiting watchlist. Scoped on (user, customer_team_id) so
 * impersonating a different team flips to that team's separate list.
 *
 * No team in scope (superadmin not impersonating) → returns an empty
 * board. Surfaces should prompt the user to pick a team rather than
 * mixing legacy unscoped rows back in.
 *
 * Adding a player from TransferPortal also persists a transfer_snapshot
 * + destination team so downstream consumers (TB, PDFs, Dashboard) can
 * lock in the simulated numbers instead of recomputing.
 */
export function useTargetBoard() {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();

  const { data: board = [], isLoading } = useQuery({
    queryKey: ["target-board", effectiveTeamId ?? null],
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async () => {
      const { data, error } = await tb()
        .select("id, player_id, notes, added_at, destination_team, destination_team_id, transfer_snapshot, players!inner(first_name, last_name, team, conference, position, class_year, portal_status)")
        .eq("user_id", user!.id)
        .eq("customer_team_id", effectiveTeamId!)
        .order("added_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        player_id: row.player_id,
        notes: row.notes,
        added_at: row.added_at,
        destination_team: row.destination_team ?? null,
        destination_team_id: row.destination_team_id ?? null,
        transfer_snapshot: (row.transfer_snapshot ?? null) as TransferSnapshot | null,
        first_name: row.players.first_name,
        last_name: row.players.last_name,
        team: row.players.team,
        conference: row.players.conference,
        position: row.players.position,
        class_year: row.players.class_year,
        portal_status: row.players.portal_status || "NOT IN PORTAL",
      })) as TargetBoardRow[];
    },
  });

  const playerIds = new Set(board.map((r) => r.player_id));

  const addPlayer = useMutation({
    mutationFn: async ({
      playerId,
      snapshot,
      destinationTeam,
      destinationTeamId,
    }: {
      playerId: string;
      snapshot?: TransferSnapshot | null;
      destinationTeam?: string | null;
      destinationTeamId?: string | null;
    }) => {
      if (!user?.id) throw new Error("Not logged in");
      if (!effectiveTeamId) throw new Error("No team in scope — impersonate or join a team first");
      const { error } = await tb()
        .insert({
          user_id: user.id,
          player_id: playerId,
          customer_team_id: effectiveTeamId,
          transfer_snapshot: snapshot ?? null,
          destination_team: destinationTeam ?? null,
          destination_team_id: destinationTeamId ?? null,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["target-board", effectiveTeamId ?? null] });
      toast.success("Added to Target Board");
    },
    onError: (e: any) => {
      if (e?.message?.includes("duplicate") || e?.code === "23505") {
        toast.info("Already on Target Board");
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
        .eq("user_id", user.id)
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
