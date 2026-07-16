import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";

export type FundingMode = "new_money" | "from_base";

// ── Contract → funding sync (GM layer ONLY — never touches team_build_players) ──
// A contract behaves like a vendor allocation on the Funding Sources page:
//   new_money → the vendor's source pool auto-sums its allocations (funds the
//     NIL/Other cap); the player's total + the cap grow together.
//   from_base (carve) → same allocation, but the source pool stays null (doesn't
//     fund the cap) and the player's unassigned amount drops by the same amount,
//     so their total is unchanged (details existing budget).
// Both mirror operations the funding page already supports, so no new cap math.
// Writes gm_allocation_source / gm_allocation / gm_player_finance — the coach
// sees nothing until a per-row finalize pushes Actual Pay to the team build.
async function syncContractFunding(
  teamId: string,
  userId: string | null,
  p: { player_id: string; bucket: ContractBucket; vendor_id: string | null; vendor_name: string | null; funding_mode: FundingMode },
): Promise<string | null> {
  if ((p.bucket !== "nil" && p.bucket !== "other") || !p.vendor_id) return null;
  // Resolve the active/live build the same way useGmRoster's liveBuildId does:
  // flagged active → else most-recently-updated non-default → else default.
  const { data: ab } = await (supabase as any).from("team_builds")
    .select("id, is_active, is_default, archived, updated_at").eq("customer_team_id", teamId).order("updated_at", { ascending: false });
  const bl = (ab ?? []).filter((b: any) => !b.archived);
  const buildId = (bl.find((b: any) => b.is_active) ?? bl.find((b: any) => !b.is_default) ?? bl.find((b: any) => b.is_default) ?? bl[0])?.id as string | undefined;
  if (!buildId) return null;
  // Find-or-create the vendor's funding source in the active build. The SOURCE's
  // mode (set at creation) governs — a vendor is new-money or carve as a whole.
  const { data: exist } = await (supabase as any).from("gm_allocation_source")
    .select("id, funding_mode").eq("team_build_id", buildId).eq("vendor_id", p.vendor_id).eq("bucket", p.bucket).limit(1);
  let sourceId: string; let mode: FundingMode;
  if (exist?.[0]) { sourceId = exist[0].id; mode = exist[0].funding_mode; }
  else {
    const { data: ins, error } = await (supabase as any).from("gm_allocation_source").insert({
      customer_team_id: teamId, team_build_id: buildId, vendor_id: p.vendor_id, name: p.vendor_name?.trim() || "Vendor",
      bucket: p.bucket, total: null, funding_mode: p.funding_mode, base_offset: 0, sort_order: 9999, created_by_user_id: userId,
    }).select("id, funding_mode").single();
    if (error || !ins) return null;
    sourceId = ins.id; mode = ins.funding_mode;
  }
  // The player's allocation = Σ their deals with this vendor+bucket.
  const { data: cs } = await (supabase as any).from("gm_contract")
    .select("total_value").eq("customer_team_id", teamId).eq("player_id", p.player_id).eq("vendor_id", p.vendor_id).eq("bucket", p.bucket);
  const newAmount = (cs ?? []).reduce((s: number, c: any) => s + (Number(c.total_value) || 0), 0);
  const { data: al } = await (supabase as any).from("gm_allocation").select("id, amount").eq("source_id", sourceId).eq("player_id", p.player_id).limit(1);
  const oldAmount = al?.[0] ? Number(al[0].amount) || 0 : 0;
  let allocationId: string | null = al?.[0]?.id ?? null;
  if (newAmount > 0) {
    const { data: up } = await (supabase as any).from("gm_allocation").upsert(
      { customer_team_id: teamId, source_id: sourceId, player_id: p.player_id, amount: newAmount, updated_by_user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: "source_id,player_id" }).select("id").single();
    allocationId = up?.id ?? allocationId;
  } else if (al?.[0]) {
    await (supabase as any).from("gm_allocation").delete().eq("id", al[0].id);
    allocationId = null;
  }
  if (mode === "new_money") {
    // Auto-sum the pool so the vendor's money funds the cap.
    const { data: allAl } = await (supabase as any).from("gm_allocation").select("amount").eq("source_id", sourceId);
    const pool = (allAl ?? []).reduce((s: number, a: any) => s + (Number(a.amount) || 0), 0);
    await (supabase as any).from("gm_allocation_source").update({ total: pool }).eq("id", sourceId);
  } else {
    // Carve: keep the player's total constant by absorbing the delta out of their
    // unassigned amount (mirrors the funding page's "Total" edit). Only if rostered.
    const delta = newAmount - oldAmount;
    if (delta !== 0) {
      const { data: bp } = await (supabase as any).from("team_build_players").select("id").eq("build_id", buildId).eq("player_id", p.player_id).limit(1);
      const bpid = bp?.[0]?.id as string | undefined;
      if (bpid) {
        const field = p.bucket === "nil" ? "nil_amount" : "other_amount";
        const { data: fin } = await (supabase as any).from("gm_player_finance").select(field).eq("build_player_id", bpid).limit(1);
        const cur = fin?.[0]?.[field] != null ? Number(fin[0][field]) : 0;
        await (supabase as any).from("gm_player_finance").upsert(
          { build_player_id: bpid, customer_team_id: teamId, player_id: p.player_id, season: PROJECTION_SEASON, [field]: Math.max(0, cur - delta), updated_by_user_id: userId, updated_at: new Date().toISOString() },
          { onConflict: "build_player_id" });
      }
    }
  }
  return allocationId;
}

export type ContractBucket = "rev" | "nil" | "other";
export type ContractStatus = "active" | "pending" | "expired" | "terminated";

export interface ContractObligation {
  id: string;
  contract_id: string;
  description: string;
  due_date: string | null;
  fulfilled: boolean;
  sort_order: number;
}
export interface GmContract {
  id: string;
  player_id: string;
  title: string | null;
  bucket: ContractBucket;
  vendor_name: string | null;
  vendor_id: string | null;
  funding_mode: FundingMode;
  allocation_id: string | null;
  total_value: number | null;
  start_date: string | null;
  end_date: string | null;
  status: ContractStatus;
  pdf_path: string | null;
  pdf_name: string | null;
  summary: string | null;
  notes: string | null;
  created_at: string;
  obligations: ContractObligation[];
}

// Shape returned by the parse-contract edge function (all optional — a review step follows).
export interface ParsedContract {
  title?: string;
  bucket?: ContractBucket;
  vendor_name?: string;
  total_value?: number;
  start_date?: string;
  end_date?: string;
  summary?: string;
  obligations?: { description: string; due_date?: string }[];
}

export interface NewContractInput {
  player_id: string;
  title: string | null;
  bucket: ContractBucket;
  vendor_name: string | null;
  vendor_id: string | null; // → gm_vendor (the program directory); Rev = null
  funding_mode: FundingMode; // new money on top of the bucket, or carved from the player's budget
  total_value: number | null;
  start_date: string | null;
  end_date: string | null;
  status: ContractStatus;
  summary: string | null;
  notes: string | null;
  parsed: ParsedContract | null;
  // id present → an existing obligation to keep (preserves its fulfilled state);
  // absent → a new one to insert.
  obligations: { id?: string; description: string; due_date: string | null }[];
  file: File | null;
}

// Editing an existing contract: same fields, plus its id and the current row
// (needed to diff obligations + swap the PDF).
export interface UpdateContractInput extends NewContractInput {
  id: string;
  existing: GmContract;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      resolve(res.includes(",") ? res.split(",")[1] : res); // strip data: prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * GM contract storage: the signed-contract records + their PDFs + obligations,
 * team-scoped. `parse` reads a PDF with Claude (edge function) to pre-fill the
 * Add Contract form; nothing is saved until `addContract`. PDFs live in the
 * private `gm-contracts` bucket at `<teamId>/<uuid>.pdf`.
 */
export function useGmContracts(playerId?: string | null) {
  const { user, effectiveTeamId } = useAuth();
  const qc = useQueryClient();

  const key = ["gm-contracts", effectiveTeamId ?? null];
  const { data: contracts = [], isLoading } = useQuery({
    queryKey: key,
    enabled: !!user?.id && !!effectiveTeamId,
    queryFn: async (): Promise<GmContract[]> => {
      const { data: rows, error } = await (supabase as any)
        .from("gm_contract").select("*")
        .eq("customer_team_id", effectiveTeamId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (rows || []).map((r: any) => r.id);
      let obs: any[] = [];
      if (ids.length) {
        const { data: o } = await (supabase as any)
          .from("gm_contract_obligation").select("*")
          .in("contract_id", ids)
          .order("sort_order", { ascending: true });
        obs = o || [];
      }
      const byContract = new Map<string, ContractObligation[]>();
      for (const o of obs) {
        if (!byContract.has(o.contract_id)) byContract.set(o.contract_id, []);
        byContract.get(o.contract_id)!.push(o);
      }
      return (rows || []).map((r: any) => ({ ...r, obligations: byContract.get(r.id) ?? [] }));
    },
  });

  const forPlayer = playerId ? contracts.filter((c) => c.player_id === playerId) : contracts;

  // Read a PDF with Claude — returns suggested fields for the review form.
  const parse = useMutation({
    mutationFn: async (file: File): Promise<ParsedContract> => {
      const fileBase64 = await fileToBase64(file);
      const { data, error } = await supabase.functions.invoke("parse-contract", {
        body: { fileBase64, mimeType: file.type || "application/pdf", fileName: file.name },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return (data?.contract ?? {}) as ParsedContract;
    },
    onError: (e: any) => toast.error(`Couldn't read contract: ${e.message}`),
  });

  const addContract = useMutation({
    mutationFn: async (input: NewContractInput) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      let pdf_path: string | null = null;
      let pdf_name: string | null = null;
      if (input.file) {
        pdf_path = `${effectiveTeamId}/${crypto.randomUUID()}.pdf`;
        pdf_name = input.file.name;
        const { error: upErr } = await supabase.storage.from("gm-contracts")
          .upload(pdf_path, input.file, { contentType: input.file.type || "application/pdf", upsert: false });
        if (upErr) throw upErr;
      }
      const { data: inserted, error } = await (supabase as any).from("gm_contract").insert({
        customer_team_id: effectiveTeamId,
        player_id: input.player_id,
        title: input.title,
        bucket: input.bucket,
        vendor_name: input.vendor_name,
        vendor_id: input.vendor_id,
        funding_mode: input.funding_mode,
        total_value: input.total_value,
        start_date: input.start_date,
        end_date: input.end_date,
        status: input.status,
        summary: input.summary,
        notes: input.notes,
        parsed: input.parsed,
        pdf_path,
        pdf_name,
        created_by_user_id: user?.id ?? null,
      }).select("id").single();
      if (error) throw error;
      const obs = input.obligations.filter((o) => o.description.trim());
      if (obs.length) {
        const { error: oErr } = await (supabase as any).from("gm_contract_obligation").insert(
          obs.map((o, i) => ({
            customer_team_id: effectiveTeamId, contract_id: inserted.id,
            description: o.description.trim(), due_date: o.due_date, sort_order: i,
          })),
        );
        if (oErr) throw oErr;
      }
      // Sync into the GM funding layer (source + allocation + carve). Never the team build.
      const allocationId = await syncContractFunding(effectiveTeamId, user?.id ?? null, {
        player_id: input.player_id, bucket: input.bucket, vendor_id: input.vendor_id, vendor_name: input.vendor_name, funding_mode: input.funding_mode,
      });
      if (allocationId) await (supabase as any).from("gm_contract").update({ allocation_id: allocationId }).eq("id", inserted.id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["gm-allocation-sources"] }); qc.invalidateQueries({ queryKey: ["gm-allocations"] }); qc.invalidateQueries({ queryKey: ["gm-roster"] }); toast.success("Contract saved"); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const updateContract = useMutation({
    mutationFn: async ({ id, existing, ...input }: UpdateContractInput) => {
      if (!effectiveTeamId) throw new Error("No team in scope");
      // Swap the PDF only if a new one was chosen; otherwise keep the stored one.
      let pdf_path = existing.pdf_path;
      let pdf_name = existing.pdf_name;
      if (input.file) {
        const newPath = `${effectiveTeamId}/${crypto.randomUUID()}.pdf`;
        const { error: upErr } = await supabase.storage.from("gm-contracts")
          .upload(newPath, input.file, { contentType: input.file.type || "application/pdf", upsert: false });
        if (upErr) throw upErr;
        if (existing.pdf_path) await supabase.storage.from("gm-contracts").remove([existing.pdf_path]);
        pdf_path = newPath; pdf_name = input.file.name;
      }
      const { error } = await (supabase as any).from("gm_contract").update({
        title: input.title, bucket: input.bucket, vendor_name: input.vendor_name, vendor_id: input.vendor_id, funding_mode: input.funding_mode,
        total_value: input.total_value, start_date: input.start_date, end_date: input.end_date,
        status: input.status, summary: input.summary, notes: input.notes, parsed: input.parsed,
        pdf_path, pdf_name,
      }).eq("id", id);
      if (error) throw error;
      // Reconcile obligations: keep+update those that carry an id (preserving
      // their fulfilled state), insert the new ones, delete the removed ones.
      const clean = input.obligations.filter((o) => o.description.trim());
      const keptIds = new Set(clean.filter((o) => o.id).map((o) => o.id));
      const toDelete = existing.obligations.filter((o) => !keptIds.has(o.id)).map((o) => o.id);
      if (toDelete.length) await (supabase as any).from("gm_contract_obligation").delete().in("id", toDelete);
      for (let i = 0; i < clean.length; i++) {
        const o = clean[i];
        if (o.id) {
          const { error: e } = await (supabase as any).from("gm_contract_obligation")
            .update({ description: o.description.trim(), due_date: o.due_date, sort_order: i }).eq("id", o.id);
          if (e) throw e;
        } else {
          const { error: e } = await (supabase as any).from("gm_contract_obligation")
            .insert({ customer_team_id: effectiveTeamId, contract_id: id, description: o.description.trim(), due_date: o.due_date, sort_order: i });
          if (e) throw e;
        }
      }
      // Re-sync the funding layer to the new amount/vendor/mode.
      const allocationId = await syncContractFunding(effectiveTeamId, user?.id ?? null, {
        player_id: input.player_id, bucket: input.bucket, vendor_id: input.vendor_id, vendor_name: input.vendor_name, funding_mode: input.funding_mode,
      });
      await (supabase as any).from("gm_contract").update({ allocation_id: allocationId }).eq("id", id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["gm-allocation-sources"] }); qc.invalidateQueries({ queryKey: ["gm-allocations"] }); qc.invalidateQueries({ queryKey: ["gm-roster"] }); toast.success("Contract updated"); },
    onError: (e: any) => toast.error(`Update failed: ${e.message}`),
  });

  const removeContract = useMutation({
    mutationFn: async (c: GmContract) => {
      if (c.pdf_path) await supabase.storage.from("gm-contracts").remove([c.pdf_path]);
      const { error } = await (supabase as any).from("gm_contract").delete().eq("id", c.id);
      if (error) throw error;
      // Re-sync after removal: the allocation shrinks to the remaining deals (or
      // clears), and a carve returns the amount to the player's unassigned budget.
      if (effectiveTeamId) await syncContractFunding(effectiveTeamId, user?.id ?? null, {
        player_id: c.player_id, bucket: c.bucket, vendor_id: c.vendor_id, vendor_name: c.vendor_name, funding_mode: c.funding_mode,
      });
    },
    onSuccess: (_data, c) => {
      // Drop it from the cache immediately so the list updates without waiting on
      // the refetch (which can lag a just-committed delete).
      qc.setQueryData<GmContract[]>(key, (old) => (old ?? []).filter((x) => x.id !== c.id));
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["gm-allocation-sources"] });
      qc.invalidateQueries({ queryKey: ["gm-allocations"] });
      qc.invalidateQueries({ queryKey: ["gm-roster"] });
      toast.success("Contract removed");
    },
    onError: (e: any) => toast.error(`Delete failed: ${e.message}`),
  });

  const toggleObligation = useMutation({
    mutationFn: async ({ id, fulfilled }: { id: string; fulfilled: boolean }) => {
      const { error } = await (supabase as any).from("gm_contract_obligation")
        .update({ fulfilled, fulfilled_at: fulfilled ? new Date().toISOString() : null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e: any) => toast.error(`Update failed: ${e.message}`),
  });

  // Short-lived signed URL to view/download a stored PDF (private bucket).
  const viewPdf = async (path: string) => {
    const { data, error } = await supabase.storage.from("gm-contracts").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) { toast.error("Couldn't open PDF"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  return {
    contracts: forPlayer,
    allContracts: contracts,
    isLoading,
    parse: (file: File) => parse.mutateAsync(file),
    isParsing: parse.isPending,
    addContract: (input: NewContractInput, onDone?: () => void) =>
      addContract.mutate(input, onDone ? { onSuccess: () => onDone() } : undefined),
    isSaving: addContract.isPending,
    updateContract: (input: UpdateContractInput, onDone?: () => void) =>
      updateContract.mutate(input, onDone ? { onSuccess: () => onDone() } : undefined),
    isUpdating: updateContract.isPending,
    removeContract: (c: GmContract) => removeContract.mutate(c),
    toggleObligation: (id: string, fulfilled: boolean) => toggleObligation.mutate({ id, fulfilled }),
    viewPdf,
  };
}
