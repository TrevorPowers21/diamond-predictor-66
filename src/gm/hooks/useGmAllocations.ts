import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type AllocationBucket = "nil" | "other";

export interface GmAllocationSource {
  id: string;
  name: string;
  bucket: AllocationBucket;
  total: number | null;
  sort_order: number;
  vendor_id: string | null; // → gm_vendor (links this source to the program vendor)
  funding_mode: "new_money" | "from_base"; // new money on top of the bucket, or carved from the base
  base_offset: number; // dollars pulled from the general base at creation (0 for new money)
}
export interface GmAllocation {
  id: string;
  source_id: string;
  player_id: string;
  amount: number | null;
}

/**
 * GM funding categories + per-player allocations, scoped to a single build so
 * each build carries its own funding plan (scenario planning). A "source" is a
 * named category in a bucket (NIL vendor or Other) with a total pool.
 * Allocations assign part of that pool to a player; remaining = total -
 * SUM(allocations). Team-scoped RLS, shared across the staff.
 */
export function useGmAllocations(buildId: string | null | undefined) {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();

  const srcKey = ["gm-allocation-sources", effectiveTeamId ?? null, buildId ?? null];
  const { data: sources = [], isLoading: srcLoading } = useQuery({
    queryKey: srcKey,
    enabled: !!user?.id && !!effectiveTeamId && !!buildId,
    queryFn: async (): Promise<GmAllocationSource[]> => {
      const { data, error } = await (supabase as any)
        .from("gm_allocation_source")
        .select("id, name, bucket, total, sort_order, vendor_id, funding_mode, base_offset")
        .eq("customer_team_id", effectiveTeamId)
        .eq("team_build_id", buildId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as GmAllocationSource[];
    },
  });

  const allocKey = ["gm-allocations", effectiveTeamId ?? null];
  const { data: allocations = [], isLoading: allocLoading } = useQuery({
    queryKey: allocKey,
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async (): Promise<GmAllocation[]> => {
      const { data, error } = await (supabase as any)
        .from("gm_allocation")
        .select("id, source_id, player_id, amount")
        .eq("customer_team_id", effectiveTeamId);
      if (error) throw error;
      return (data || []) as GmAllocation[];
    },
  });

  // source_id -> { player_id -> amount } and source_id -> allocated total
  const allocBySource = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const a of allocations) {
      if (!m.has(a.source_id)) m.set(a.source_id, new Map());
      m.get(a.source_id)!.set(a.player_id, Number(a.amount ?? 0));
    }
    return m;
  }, [allocations]);
  const allocatedTotal = (sourceId: string) => {
    let sum = 0;
    for (const v of allocBySource.get(sourceId)?.values() ?? []) sum += v;
    return sum;
  };

  const addSource = useMutation({
    mutationFn: async ({ name, bucket, total, funding_mode, base_offset, vendor_id }: { name: string; bucket: AllocationBucket; total: number | null; funding_mode: "new_money" | "from_base"; base_offset: number; vendor_id?: string | null }) => {
      if (!effectiveTeamId || !buildId) throw new Error("No team/build in scope");
      const nextOrder = sources.length ? Math.max(...sources.map((s) => s.sort_order)) + 1 : 0;
      const { error } = await (supabase as any).from("gm_allocation_source").insert({
        customer_team_id: effectiveTeamId, team_build_id: buildId, name: name.trim(), bucket, total, sort_order: nextOrder,
        funding_mode, base_offset, vendor_id: vendor_id ?? null, created_by_user_id: user?.id ?? null,
      });
      if (error) throw error;
    },
    // Adding a category changes the build's derived NIL/Other cap (roster query).
    onSuccess: () => { qc.invalidateQueries({ queryKey: srcKey }); qc.invalidateQueries({ queryKey: ["gm-roster"] }); toast.success("Category added"); },
    onError: (e: any) => toast.error(`Add category failed: ${e.message}`),
  });

  const updateSource = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<GmAllocationSource, "name" | "total">> }) => {
      const { error } = await (supabase as any).from("gm_allocation_source").update(patch).eq("id", id);
      if (error) throw error;
    },
    // Editing a category's pool changes the build's derived NIL/Other cap.
    onSuccess: () => { qc.invalidateQueries({ queryKey: srcKey }); qc.invalidateQueries({ queryKey: ["gm-roster"] }); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const removeSource = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("gm_allocation_source").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: srcKey }); qc.invalidateQueries({ queryKey: allocKey }); qc.invalidateQueries({ queryKey: ["gm-roster"] }); toast.success("Category removed"); },
    onError: (e: any) => toast.error(`Delete failed: ${e.message}`),
  });

  // Set (upsert) or clear a player's allocation from a source.
  const setAllocation = useMutation({
    mutationFn: async ({ sourceId, playerId, amount }: { sourceId: string; playerId: string; amount: number | null }) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      if (amount == null) {
        const { error } = await (supabase as any).from("gm_allocation").delete().eq("source_id", sourceId).eq("player_id", playerId);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any).from("gm_allocation").upsert(
        { customer_team_id: effectiveTeamId, source_id: sourceId, player_id: playerId, amount, updated_by_user_id: user?.id ?? null, updated_at: new Date().toISOString() },
        { onConflict: "source_id,player_id" },
      );
      if (error) throw error;
    },
    // Also refresh the roster so the per-player bucket totals (nil_vendor /
    // other_vendor) recompute — that's what the grayed total on the cards reads.
    onSuccess: () => { qc.invalidateQueries({ queryKey: allocKey }); qc.invalidateQueries({ queryKey: ["gm-roster"] }); },
    onError: (e: any) => toast.error(`Save allocation failed: ${e.message}`),
  });

  return {
    sources,
    isLoading: srcLoading || allocLoading,
    allocBySource,
    allocatedTotal,
    addSource: (name: string, bucket: AllocationBucket, total: number | null, funding_mode: "new_money" | "from_base", base_offset: number, vendor_id?: string | null) => addSource.mutate({ name, bucket, total, funding_mode, base_offset, vendor_id }),
    updateSource: (id: string, patch: Partial<Pick<GmAllocationSource, "name" | "total">>) => updateSource.mutate({ id, patch }),
    removeSource: (id: string) => removeSource.mutate(id),
    setAllocation: (sourceId: string, playerId: string, amount: number | null) => setAllocation.mutate({ sourceId, playerId, amount }),
  };
}
