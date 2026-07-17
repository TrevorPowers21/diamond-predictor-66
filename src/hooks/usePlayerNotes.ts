import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { DatedNote } from "@/components/PlayerNotesDialog";

/**
 * The shared, authored + dated per-player note log (gm_player_notes), keyed by
 * build_player_id. Used by the coach Team Builder so its notes are the SAME log
 * the GM sees on Roster Management — one team-shared history per roster row.
 * (The GM Roster page already batch-loads these via useGmRoster; this hook is
 * for surfaces that need a single row's notes on demand.)
 */
export function usePlayerNotes(buildPlayerId: string | null | undefined) {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();
  const key = ["player-notes", buildPlayerId ?? null];

  const { data: notes = [], isLoading } = useQuery({
    queryKey: key,
    enabled: !!buildPlayerId && !!effectiveTeamId,
    queryFn: async (): Promise<DatedNote[]> => {
      const { data, error } = await (supabase as any)
        .from("gm_player_notes")
        .select("id, author, note_date, body")
        .eq("build_player_id", buildPlayerId)
        .order("note_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as DatedNote[];
    },
  });

  const addNote = useMutation({
    mutationFn: async (body: string) => {
      if (!buildPlayerId || !effectiveTeamId) throw new Error("No player/team in scope");
      const { error } = await (supabase as any).from("gm_player_notes").insert({
        build_player_id: buildPlayerId,
        customer_team_id: effectiveTeamId,
        author: user?.email ?? null,
        body: body.trim(),
        created_by_user_id: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(`Add note failed: ${e.message}`),
  });

  const removeNote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("gm_player_notes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(`Delete note failed: ${e.message}`),
  });

  return {
    notes,
    isLoading,
    busy: addNote.isPending || removeNote.isPending,
    addNote: (body: string) => addNote.mutate(body),
    removeNote: (id: string) => removeNote.mutate(id),
  };
}
