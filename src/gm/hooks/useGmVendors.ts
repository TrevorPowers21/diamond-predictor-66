import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type VendorBucket = "nil" | "other";
export interface GmVendor {
  id: string;
  name: string;
  bucket: VendorBucket;
}

/**
 * The program's canonical vendor directory (gm_vendor) — team-scoped, shared
 * across builds. Contracts + funding sources both point at it. `ensureVendor`
 * is find-or-create by (name, bucket), so typing a vendor into a contract
 * "recognizes" an existing one or stores a new one.
 */
export function useGmVendors() {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();
  const key = ["gm-vendors", effectiveTeamId ?? null];

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: key,
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async (): Promise<GmVendor[]> => {
      const { data, error } = await (supabase as any).from("gm_vendor")
        .select("id, name, bucket").eq("customer_team_id", effectiveTeamId)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as GmVendor[];
    },
  });

  // Find-or-create by (name, bucket), case-insensitive. Returns the vendor id.
  // The DB unique index (team, lower(name), bucket) is the source of truth — if
  // a concurrent insert wins, we re-read and return the existing row.
  const ensureVendor = async (name: string, bucket: VendorBucket): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed || !effectiveTeamId) return null;
    const hit = vendors.find((v) => v.bucket === bucket && v.name.toLowerCase() === trimmed.toLowerCase());
    if (hit) return hit.id;
    const { data, error } = await (supabase as any).from("gm_vendor")
      .insert({ customer_team_id: effectiveTeamId, name: trimmed, bucket, created_by_user_id: user?.id ?? null })
      .select("id").single();
    if (error) {
      const { data: again } = await (supabase as any).from("gm_vendor")
        .select("id, name").eq("customer_team_id", effectiveTeamId).eq("bucket", bucket);
      const found = (again ?? []).find((v: any) => (v.name as string).toLowerCase() === trimmed.toLowerCase());
      if (found) { qc.invalidateQueries({ queryKey: key }); return found.id as string; }
      toast.error(`Vendor save failed: ${error.message}`);
      return null;
    }
    qc.invalidateQueries({ queryKey: key });
    return data.id as string;
  };

  return { vendors, isLoading, ensureVendor };
}
