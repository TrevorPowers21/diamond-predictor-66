import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

export interface CoachNote {
  id: string;
  player_id: string;
  user_id: string;
  team_id: string | null;
  content: string;
  tag: string | null;
  created_at: string;
  updated_at: string;
  author_email?: string | null;
}

const cn = () => supabase.from("coach_notes" as any);

export function useCoachNotes(playerId: string | null | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = ["coach-notes", playerId];

  const { data: notes = [], isLoading } = useQuery({
    queryKey,
    enabled: !!playerId && !!user?.id,
    queryFn: async () => {
      if (!playerId) return [];
      const { data, error } = await cn()
        .select("*")
        .eq("player_id", playerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as CoachNote[];
    },
  });

  const addNote = useMutation({
    mutationFn: async ({ content, tag }: { content: string; tag?: string | null }) => {
      if (!user?.id || !playerId) throw new Error("Not signed in");
      const { data, error } = await cn()
        .insert({
          player_id: playerId,
          user_id: user.id,
          content: content.trim(),
          tag: tag ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as CoachNote;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Note added");
    },
    onError: (e: any) => toast.error(`Could not add note: ${e.message}`),
  });

  const updateNote = useMutation({
    mutationFn: async ({ id, content, tag }: { id: string; content?: string; tag?: string | null }) => {
      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (content !== undefined) patch.content = content.trim();
      if (tag !== undefined) patch.tag = tag;
      const { error } = await cn().update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Note updated");
    },
    onError: (e: any) => toast.error(`Could not update note: ${e.message}`),
  });

  const deleteNote = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await cn().delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success("Note deleted");
    },
    onError: (e: any) => toast.error(`Could not delete note: ${e.message}`),
  });

  return {
    notes,
    isLoading,
    addNote: addNote.mutate,
    updateNote: updateNote.mutate,
    deleteNote: deleteNote.mutate,
    isAdding: addNote.isPending,
    isUpdating: updateNote.isPending,
    isDeleting: deleteNote.isPending,
  };
}
