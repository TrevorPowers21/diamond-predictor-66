import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
  total_value: number | null;
  start_date: string | null;
  end_date: string | null;
  status: ContractStatus;
  summary: string | null;
  notes: string | null;
  parsed: ParsedContract | null;
  obligations: { description: string; due_date: string | null }[];
  file: File | null;
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
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success("Contract saved"); },
    onError: (e: any) => toast.error(`Save failed: ${e.message}`),
  });

  const removeContract = useMutation({
    mutationFn: async (c: GmContract) => {
      if (c.pdf_path) await supabase.storage.from("gm-contracts").remove([c.pdf_path]);
      const { error } = await (supabase as any).from("gm_contract").delete().eq("id", c.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success("Contract removed"); },
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
    removeContract: (c: GmContract) => removeContract.mutate(c),
    toggleObligation: (id: string, fulfilled: boolean) => toggleObligation.mutate({ id, fulfilled }),
    viewPdf,
  };
}
