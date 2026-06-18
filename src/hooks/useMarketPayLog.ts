import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { toast } from "sonner";

const tbl = () => supabase.from("team_market_pay_log" as any);

export type MarketPayLogRow = {
  id: string;
  customer_team_id: string;
  player_id: string;
  season: number;
  market_pay_amount: number | null;
  notes: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Per-team coach-logged market pay observations for a single player.
 *
 * Scoping: RLS gates reads + writes to (effective team is a member) AND
 * (effective team has market_pay_enabled = true), with superadmin
 * override. The hook trusts RLS — no client-side filtering by team_id is
 * needed; whatever rows come back are what the user is allowed to see.
 *
 * Storage model: one row per (customer_team_id, player_id, season). Upsert
 * on the unique constraint to overwrite a coach's prior entry for the
 * same season.
 */
export function useMarketPayLog(playerId: string | null | undefined) {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();

  // Read whether the current effective team has the feature enabled. The
  // button on Player Profile only renders when this is true (or the user
  // is a superadmin — but superadmin status isn't gated here; the button
  // also renders for them).
  const { data: featureEnabled = false } = useQuery({
    queryKey: ["customer-team-market-pay-flag", effectiveTeamId ?? null],
    enabled: !!effectiveTeamId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_teams")
        .select("market_pay_enabled")
        .eq("id", effectiveTeamId!)
        .maybeSingle();
      if (error) throw error;
      return !!(data as any)?.market_pay_enabled;
    },
    staleTime: 60 * 1000,
  });

  // Read the logged entries for THIS player. RLS handles team scoping;
  // typically returns 1 row per season for the user's team. Superadmin
  // sees all teams' rows for the player.
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["market-pay-log", playerId ?? null, effectiveTeamId ?? null],
    enabled: !!playerId && !!user?.id && !!effectiveTeamId,
    queryFn: async () => {
      const { data, error } = await tbl()
        .select("id, customer_team_id, player_id, season, market_pay_amount, notes, updated_by_user_id, created_at, updated_at")
        .eq("player_id", playerId!)
        .order("season", { ascending: false })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data as any[]) as MarketPayLogRow[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (input: {
      season: number;
      amount: number | null;
      notes: string | null;
    }) => {
      if (!user?.id) throw new Error("Not logged in");
      if (!effectiveTeamId) throw new Error("No team in scope");
      if (!playerId) throw new Error("No player");
      const { error } = await tbl().upsert(
        {
          customer_team_id: effectiveTeamId,
          player_id: playerId,
          season: input.season,
          market_pay_amount: input.amount,
          notes: input.notes,
          updated_by_user_id: user.id,
        },
        { onConflict: "customer_team_id,player_id,season" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["market-pay-log", playerId ?? null] });
      toast.success("Market pay logged");
    },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tbl().delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["market-pay-log", playerId ?? null] });
      toast.success("Entry removed");
    },
    onError: (e: any) => toast.error(`Delete failed: ${e.message}`),
  });

  return {
    featureEnabled,
    entries,
    isLoading,
    upsert: upsert.mutateAsync,
    isSaving: upsert.isPending,
    remove: remove.mutateAsync,
    isRemoving: remove.isPending,
  };
}
