import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

/**
 * High Follow List — coach watchlist separate from Team Builder's target board.
 *
 * Supabase table: `high_follow`
 *   id           uuid PK default gen_random_uuid()
 *   user_id      uuid NOT NULL references auth.users(id)
 *   player_id    uuid NOT NULL references players(id)
 *   player_type  text NOT NULL default 'hitter'  -- 'hitter' | 'pitcher'
 *   notes        text
 *   added_at     timestamptz default now()
 *   UNIQUE(user_id, player_id)
 *
 * RLS: users can only read/write their own rows.
 */

const hf = () => supabase.from("high_follow" as any);

export interface HighFollowRow {
  id: string;
  player_id: string;
  player_type: "hitter" | "pitcher";
  notes: string | null;
  added_at: string;
  // joined from players
  first_name: string;
  last_name: string;
  team: string | null;
  conference: string | null;
  position: string | null;
  class_year: string | null;
  source_player_id: string | null;
}

const QUERY_KEY = ["high-follow"];

export function useHighFollow() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: list = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await hf()
        .select(
          "id, player_id, player_type, notes, added_at, players!inner(first_name, last_name, team, conference, position, class_year, source_player_id)"
        )
        .eq("user_id", user!.id)
        .order("added_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        id: row.id,
        player_id: row.player_id,
        player_type: row.player_type || "hitter",
        notes: row.notes,
        added_at: row.added_at,
        first_name: row.players.first_name,
        last_name: row.players.last_name,
        team: row.players.team,
        conference: row.players.conference,
        position: row.players.position,
        class_year: row.players.class_year,
        source_player_id: row.players.source_player_id,
      })) as HighFollowRow[];
    },
  });

  const playerIds = new Set(list.map((r) => r.player_id));

  const addPlayer = useMutation({
    mutationFn: async ({
      playerId,
      playerType = "hitter",
    }: {
      playerId: string;
      playerType?: "hitter" | "pitcher";
    }) => {
      if (!user?.id) throw new Error("Not logged in");
      const { error } = await hf().insert({
        user_id: user.id,
        player_id: playerId,
        player_type: playerType,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Added to High Follow list");
    },
    onError: (e: any) => {
      if (e?.message?.includes("duplicate") || e?.code === "23505") {
        toast.info("Already on High Follow list");
      } else {
        toast.error(`Failed to add: ${e.message}`);
      }
    },
  });

  const addPlayers = useMutation({
    mutationFn: async (
      players: { playerId: string; playerType?: "hitter" | "pitcher" }[]
    ) => {
      if (!user?.id) throw new Error("Not logged in");
      const rows = players.map((p) => ({
        user_id: user.id,
        player_id: p.playerId,
        player_type: p.playerType || "hitter",
      }));
      const { error } = await hf().upsert(rows, {
        onConflict: "user_id,player_id",
        ignoreDuplicates: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Added to High Follow list");
    },
    onError: (e: any) => toast.error(`Failed to add: ${e.message}`),
  });

  const removePlayer = useMutation({
    mutationFn: async (playerId: string) => {
      if (!user?.id) throw new Error("Not logged in");
      const { error } = await hf()
        .delete()
        .eq("user_id", user.id)
        .eq("player_id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success("Removed from High Follow list");
    },
    onError: (e: any) => toast.error(`Failed to remove: ${e.message}`),
  });

  const updateNotes = useMutation({
    mutationFn: async ({
      playerId,
      notes,
    }: {
      playerId: string;
      notes: string;
    }) => {
      if (!user?.id) throw new Error("Not logged in");
      const { error } = await hf()
        .update({ notes })
        .eq("user_id", user.id)
        .eq("player_id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e: any) => toast.error(`Failed to update notes: ${e.message}`),
  });

  return {
    list,
    isLoading,
    playerIds,
    isOnList: (playerId: string) => playerIds.has(playerId),
    addPlayer: addPlayer.mutate,
    addPlayers: addPlayers.mutate,
    removePlayer: removePlayer.mutate,
    updateNotes: updateNotes.mutate,
  };
}
