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
}

const QUERY_KEY = ["target-board"];

export function useTargetBoard() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: board = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await tb()
        .select("id, player_id, notes, added_at, players!inner(first_name, last_name, team, conference, position, class_year, portal_status)")
        .eq("user_id", user!.id)
        .order("added_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        player_id: row.player_id,
        notes: row.notes,
        added_at: row.added_at,
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
    mutationFn: async ({ playerId }: { playerId: string }) => {
      if (!user?.id) throw new Error("Not logged in");
      const { error } = await tb()
        .insert({ user_id: user.id, player_id: playerId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
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
      const { error } = await tb()
        .delete()
        .eq("user_id", user.id)
        .eq("player_id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
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
