import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// Program-owned player info that layers over the scraped `players` record.
export interface GmPlayerInfo {
  dob: string | null;
  hometown: string | null;
  high_school: string | null;
  bats: string | null;
  throws: string | null;
  height_inches: number | null;
  weight_lbs: number | null;
  jersey_number: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  eligibility_remaining: number | null;
  draft_eligible_year: number | null;
  gpa: number | null;
  academic_note: string | null;
}

/** Read + edit a program's own info for one player (team-scoped, layered over players). */
export function useGmPlayerInfo(playerId: string | null | undefined) {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();
  const key = ["gm-player-info", effectiveTeamId ?? null, playerId ?? null];

  const { data: info = null, isLoading } = useQuery({
    queryKey: key,
    enabled: !!user?.id && !!effectiveTeamId && !!playerId,
    queryFn: async (): Promise<GmPlayerInfo | null> => {
      const { data } = await (supabase as any).from("gm_player_info").select("*")
        .eq("customer_team_id", effectiveTeamId).eq("player_id", playerId).maybeSingle();
      return (data ?? null) as GmPlayerInfo | null;
    },
  });

  const save = useMutation({
    mutationFn: async (patch: Partial<GmPlayerInfo>) => {
      if (!effectiveTeamId || !playerId) throw new Error("No team/player in scope");
      const { error } = await (supabase as any).from("gm_player_info").upsert(
        { customer_team_id: effectiveTeamId, player_id: playerId, ...patch, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "customer_team_id,player_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success("Player info saved"); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  return {
    info,
    isLoading,
    save: (patch: Partial<GmPlayerInfo>, onDone?: () => void) => save.mutate(patch, onDone ? { onSuccess: () => onDone() } : undefined),
    isSaving: save.isPending,
  };
}
