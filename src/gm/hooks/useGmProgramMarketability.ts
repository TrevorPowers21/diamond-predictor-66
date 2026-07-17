import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/** The program's hand-set community tier (1-5) — shared by every player's
 * marketability score. One row per customer team. */
export function useGmProgramMarketability() {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();
  const key = ["gm-program-marketability", effectiveTeamId ?? null];

  const { data: tier = null } = useQuery({
    queryKey: key,
    enabled: !!effectiveTeamId,
    queryFn: async (): Promise<number | null> => {
      const { data } = await (supabase as any).from("gm_program_marketability")
        .select("community_tier").eq("customer_team_id", effectiveTeamId).maybeSingle();
      return (data?.community_tier ?? null) as number | null;
    },
  });

  const save = useMutation({
    mutationFn: async (community_tier: number | null) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await (supabase as any).from("gm_program_marketability").upsert(
        { customer_team_id: effectiveTeamId, community_tier, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "customer_team_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); },
    onError: (e: any) => toast.error(`Program tier save failed: ${e.message}`),
  });

  return { tier, save: (t: number | null) => save.mutateAsync(t), isSaving: save.isPending };
}
