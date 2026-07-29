/**
 * Reads the team's scouting template for a player_type, falling back to the
 * in-code DEFAULTS when the team hasn't customized (no gm_scout_template row).
 * Both the mobile grader and the web GM report render dynamically from this.
 * Save/reset mutations back the web GM Settings → Scouting Template editor.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { DEFAULT_TEMPLATES, type ScoutTemplate, type ScoutField, type ScoutScaleLevel } from "@/gm/lib/scoutTemplate";
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

export function useSaveScoutTemplate() {
  const { effectiveTeamId, user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ playerType, fields, scale }: { playerType: RecruitType; fields: ScoutField[]; scale: ScoutScaleLevel[] }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await (supabase as any).from("gm_scout_template").upsert(
        { customer_team_id: effectiveTeamId, player_type: playerType, fields, scale, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "customer_team_id,player_type" },
      );
      if (error) throw error;
    },
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ["gm-scout-template", effectiveTeamId ?? null, v.playerType] }); toast.success("Scouting template saved"); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });
}

export function useResetScoutTemplate() {
  const { effectiveTeamId } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (playerType: RecruitType) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      const { error } = await (supabase as any).from("gm_scout_template").delete()
        .eq("customer_team_id", effectiveTeamId).eq("player_type", playerType);
      if (error) throw error;
    },
    onSuccess: (_d, playerType) => { qc.invalidateQueries({ queryKey: ["gm-scout-template", effectiveTeamId ?? null, playerType] }); toast.success("Reset to defaults"); },
    onError: (e: any) => toast.error(`Reset failed: ${e.message}`),
  });
}
