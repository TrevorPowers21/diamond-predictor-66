/**
 * Reads the team's scouting template for a player_type, falling back to the
 * in-code DEFAULTS when the team hasn't customized (no gm_scout_template row).
 * Both the mobile grader and the web GM report render dynamically from this.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { DEFAULT_TEMPLATES, type ScoutTemplate } from "@/gm/lib/scoutTemplate";
import type { RecruitType } from "@/gm/hooks/useGmRecruits";

export function useScoutTemplate(playerType: RecruitType): ScoutTemplate {
  const { effectiveTeamId } = useAuth();
  const { data } = useQuery({
    queryKey: ["gm-scout-template", effectiveTeamId ?? null, playerType],
    enabled: !!effectiveTeamId,
    queryFn: async (): Promise<{ fields: any; scale: any } | null> => {
      const { data } = await (supabase as any)
        .from("gm_scout_template").select("fields, scale")
        .eq("customer_team_id", effectiveTeamId).eq("player_type", playerType).maybeSingle();
      return data ?? null;
    },
  });
  return data?.fields && data?.scale ? { fields: data.fields, scale: data.scale } : DEFAULT_TEMPLATES[playerType];
}
