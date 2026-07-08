import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface GmActivity {
  id: string;
  actor: string | null;
  action: string;
  created_at: string;
}

/** The team's recent front-office activity, newest first. */
export function useGmActivity(limit = 12) {
  const { user, effectiveTeamId } = useAuth();
  const { data: activity = [], isLoading } = useQuery({
    queryKey: ["gm-activity", effectiveTeamId ?? null, limit],
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async (): Promise<GmActivity[]> => {
      const { data } = await (supabase as any)
        .from("gm_activity").select("id, actor, action, created_at")
        .eq("customer_team_id", effectiveTeamId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return (data || []) as GmActivity[];
    },
  });
  return { activity, isLoading };
}
