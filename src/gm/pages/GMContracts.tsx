import { useEffect, useMemo, useState } from "react";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { useGmContracts, type ContractBucket, type ContractStatus, type FundingMode, type GmContract, type ParsedContract } from "@/gm/hooks/useGmContracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { PlayerLink } from "@/gm/components/PlayerLink";
import { useGmVendors } from "@/gm/hooks/useGmVendors";
import { VendorPicker } from "@/gm/components/VendorPicker";
import { CurrencyInput } from "@/components/CurrencyInput";
import { FileText, Plus, Upload, X, ExternalLink, Trash2, Check, Search, Pencil } from "lucide-react";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

export const BUCKET_LABEL: Record<ContractBucket, string> = { rev: "Rev Share", nil: "NIL", other: "Other" };
const BUCKET_COLOR: Record<ContractBucket, string> = {
  rev: "bg-sky-500/12 text-sky-400 border-sky-500/30",
  nil: "bg-[#D4AF37]/12 text-[#D4AF37] border-[#D4AF37]/30",
  other: "bg-violet-500/12 text-violet-400 border-violet-500/30",
};
const STATUS_COLOR: Record<ContractStatus, string> = {
  active: "text-emerald-400", pending: "text-amber-400", expired: "text-muted-foreground", terminated: "text-rose-400",
};

type ObDraft = { id?: string; description: string; due_date: string | null };

export function AddContractDialog({ open, onOpenChange, players, defaultPlayerId, editing, prefill }: {
  open: boolean; onOpenChange: (o: boolean) => void; players: { id: string; name: string }[]; defaultPlayerId?: string; editing?: GmContract | null;
  prefill?: { bucket?: ContractBucket; vendor?: string; value?: number | null };
}) {
  const { addContract, isSaving, updateContract, isUpdating } = useGmContracts();
  const { vendors, ensureVendor } = useGmVendors();
  const [file, setFile] = useState<File | null>(null);
  const [playerId, setPlayerId] = useState<string>(defaultPlayerId ?? "");
  const [title, setTitle] = useState("");
  const [bucket, setBucket] = useState<ContractBucket>("nil");
  const [vendor, setVendor] = useState("");
  const [value, setValue] = useState<number | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [status, setStatus] = useState<ContractStatus>("active");
  const [fundingMode, setFundingMode] = useState<FundingMode>("new_money");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [obs, setObs] = useState<ObDraft[]>([]);
  const [parsedRaw, setParsedRaw] = useState<ParsedContract | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false); // a PDF pre-filled fields → review required
  const [reviewed, setReviewed] = useState(false);

  const reset = () => {
    setFile(null); setPlayerId(defaultPlayerId ?? ""); setTitle(""); setBucket("nil"); setVendor(""); setValue(null);
    setStart(""); setEnd(""); setStatus("active"); setFundingMode("new_money"); setSummary(""); setNotes(""); setObs([]); setParsedRaw(null);
    setExtracting(false); setAutoFilled(false); setReviewed(false);
  };

  // Editing: hydrate the form from the existing contract when the dialog opens.
  // Obligations keep their id so their fulfilled state survives the save.
  useEffect(() => {
    if (!open || !editing) return;
    setPlayerId(editing.player_id); setTitle(editing.title ?? ""); setBucket(editing.bucket);
    setVendor(editing.vendor_name ?? ""); setValue(editing.total_value);
    setStart(editing.start_date ?? ""); setEnd(editing.end_date ?? ""); setStatus(editing.status);
    setFundingMode(editing.funding_mode ?? "new_money");
    setSummary(editing.summary ?? ""); setNotes(editing.notes ?? "");
    setObs(editing.obligations.map((o) => ({ id: o.id, description: o.description, due_date: o.due_date })));
    setFile(null); setParsedRaw(editing.parsed ?? null); setAutoFilled(false); setReviewed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  // Finalizing a draft (a vendor allocation with no contract yet): seed the
  // vendor + amount so the coach only fills in the remaining details. Money is
  // unchanged — syncContractFunding reconciles onto the existing allocation.
  useEffect(() => {
    if (!open || editing || !prefill) return;
    if (prefill.bucket) setBucket(prefill.bucket);
    if (prefill.vendor != null) setVendor(prefill.vendor);
    if (prefill.value !== undefined) setValue(prefill.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, prefill?.bucket, prefill?.vendor, prefill?.value]);

  // Read the PDF entirely in the browser (no AI/key) and pre-fill the reliable
  // bits: dollar value + start/end dates. The coach must review before saving.
  const onFile = async (f: File | null) => {
    setFile(f); setAutoFilled(false); setReviewed(false);
    if (!f) return;
    setExtracting(true);
    try {
      const { extractContractPdf } = await import("@/gm/lib/extractContractPdf");
      const x = await extractContractPdf(f);
      if (x.total_value != null) setValue(x.total_value);
      if (x.start_date) setStart(x.start_date);
      if (x.end_date) setEnd(x.end_date);
      setTitle((t) => t.trim() || f.name.replace(/\.pdf$/i, ""));
      setAutoFilled(true);
    } catch { /* best-effort — leave fields for manual entry on failure */ }
    finally { setExtracting(false); }
  };

  const save = async () => {
    if (!playerId || (autoFilled && !reviewed)) return;
    // Recognize/create the vendor in the program directory and capture its id
    // (NIL/Other only; Rev "Source" is the school, not a vendor).
    const vendor_id = bucket !== "rev" && vendor.trim() ? await ensureVendor(vendor.trim(), bucket) : null;
    const payload = {
      player_id: playerId, title: title.trim() || null, bucket, vendor_name: vendor.trim() || null, vendor_id,
      funding_mode: (bucket !== "rev" ? fundingMode : "new_money") as FundingMode,
      total_value: value, start_date: start || null, end_date: end || null, status,
      summary: summary.trim() || null, notes: notes.trim() || null, parsed: parsedRaw,
      obligations: obs, file,
    };
    const done = () => { reset(); onOpenChange(false); };
    if (editing) updateContract({ id: editing.id, existing: editing, ...payload }, done);
    else addContract(payload, done);
  };
  const busy = isSaving || isUpdating;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle style={OSWALD}>{editing ? "Edit Contract" : "Add Contract"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {/* PDF + AI read */}
          <div className="rounded-lg border border-dashed border-border/70 p-3">
            <div className="flex items-center gap-2">
              <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{file ? file.name : editing?.pdf_name ? `${editing.pdf_name} — choose to replace` : "Choose contract PDF…"}</span>
                <input type="file" accept="application/pdf" className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            {extracting && <p className="mt-2 text-[11px] text-muted-foreground">Reading the PDF…</p>}
            {autoFilled && !extracting && <p className="mt-2 text-[11px] text-emerald-400">Value + dates pre-filled from the PDF. Review every field below before saving — auto-fill can be wrong.</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {!defaultPlayerId && (
              <Field label="Player" full>
                <Select value={playerId} onValueChange={setPlayerId}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select player" /></SelectTrigger>
                  <SelectContent className="max-h-64">{players.map((p) => <SelectItem key={p.id} value={p.id} className="text-sm">{p.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Title" full><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Opendorse NIL Agreement" className="h-9 text-sm" /></Field>
            <Field label="Bucket">
              <Select value={bucket} onValueChange={(v) => setBucket(v as ContractBucket)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{(["rev", "nil", "other"] as ContractBucket[]).map((b) => <SelectItem key={b} value={b} className="text-sm">{BUCKET_LABEL[b]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={bucket === "rev" ? "Source" : "Vendor"}>
              {bucket === "rev"
                ? <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="School" className="h-9 text-sm" />
                : <VendorPicker key={bucket} vendors={vendors} bucket={bucket} value={vendor} onChange={setVendor} />}
            </Field>
            <Field label="Total value"><CurrencyInput value={value} onChange={setValue} placeholder="$0" className="h-9 text-sm" /></Field>
            <Field label="Status">
              <Select value={status} onValueChange={(v) => setStatus(v as ContractStatus)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{(["active", "pending", "expired", "terminated"] as ContractStatus[]).map((s) => <SelectItem key={s} value={s} className="text-sm capitalize">{s}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Start date"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 text-sm" /></Field>
            <Field label="End date"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9 text-sm" /></Field>
          </div>

          <Field label="Summary" full><Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One-line description" className="h-9 text-sm" /></Field>

          {/* Funding: new money on top of the bucket, or carved from the player's
              existing budget (keeps their total the same). NIL/Other only. */}
          {bucket !== "rev" && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">This money is</label>
              <div className="grid gap-1.5">
                {([
                  { v: "new_money" as const, t: `New money — adds to ${bucket === "nil" ? "NIL" : "Other"}` },
                  { v: "from_base" as const, t: `From the player's ${bucket === "nil" ? "NIL" : "Other"} budget — details money they already have` },
                ]).map((o) => (
                  <button key={o.v} type="button" onClick={() => setFundingMode(o.v)}
                    className={cn("flex items-start gap-2 rounded-md border p-2 text-left text-xs transition-colors",
                      fundingMode === o.v ? "border-[#D4AF37] bg-[#D4AF37]/[0.07]" : "border-border/60 hover:border-border")}>
                    <span className={cn("mt-0.5 h-3 w-3 shrink-0 rounded-full border", fundingMode === o.v ? "border-[#D4AF37] bg-[#D4AF37]" : "border-muted-foreground/50")} />
                    <span>{o.t}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Obligations */}
          <div className="space-y-2 rounded-lg border border-border/60 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>Obligations</span>
              <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setObs((p) => [...p, { description: "", due_date: null }])}><Plus className="h-3.5 w-3.5" /> Add</Button>
            </div>
            {obs.length === 0 && <p className="text-[11px] text-muted-foreground">No obligations — add any deliverables (posts, appearances, exclusivity…).</p>}
            {obs.map((o, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input value={o.description} placeholder="e.g. 2 Instagram posts / month" className="h-8 flex-1 text-xs"
                  onChange={(e) => setObs((p) => p.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <Input type="date" value={o.due_date ?? ""} className="h-8 w-36 text-xs"
                  onChange={(e) => setObs((p) => p.map((x, j) => (j === i ? { ...x, due_date: e.target.value || null } : x)))} />
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setObs((p) => p.filter((_, j) => j !== i))}><X className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>

          <Field label="Internal notes" full><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="min-h-[60px] text-sm" /></Field>

          {/* When a PDF pre-filled fields, the coach must confirm they've reviewed them. */}
          {autoFilled && (
            <label className="flex items-start gap-2 rounded-md border border-[#D4AF37]/40 bg-[#D4AF37]/[0.06] p-2.5 text-xs">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#D4AF37]" />
              <span>I've read through every field above and confirmed it matches the contract PDF.</span>
            </label>
          )}
        </div>
        <DialogFooter>
          <Button size="sm" disabled={!playerId || busy || (autoFilled && !reviewed)} onClick={save}>{busy ? "Saving…" : editing ? "Save Changes" : "Save Contract"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn("space-y-1", full && "col-span-2")}>
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function ContractCard({ c, playerName }: { c: GmContract; playerName: string }) {
  const { viewPdf, removeContract, toggleObligation } = useGmContracts();
  const dates = [fmtDate(c.start_date), fmtDate(c.end_date)].filter(Boolean).join(" – ");
  return (
    <Card className="border-border/60">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", BUCKET_COLOR[c.bucket])}>{BUCKET_LABEL[c.bucket]}</span>
              <span className="truncate text-sm font-semibold" style={OSWALD}>{c.title || c.vendor_name || "Contract"}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">{playerName}</span>
              {c.vendor_name && ` · ${c.vendor_name}`}
              {dates && ` · ${dates}`}
              <span className={cn("ml-1.5 capitalize", STATUS_COLOR[c.status])}>· {c.status}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-sm font-bold tabular-nums text-[#D4AF37]">{money(c.total_value)}</span>
            {c.pdf_path && <Button size="icon" variant="ghost" className="h-7 w-7" title="Open PDF" onClick={() => viewPdf(c.pdf_path!)}><ExternalLink className="h-3.5 w-3.5" /></Button>}
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-rose-400" title="Remove" onClick={() => removeContract(c)}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
        {c.summary && <p className="text-xs text-muted-foreground">{c.summary}</p>}
        {c.obligations.length > 0 && (
          <div className="space-y-1 border-t border-border/50 pt-2">
            {c.obligations.map((o) => (
              <button key={o.id} onClick={() => toggleObligation(o.id, !o.fulfilled)}
                className="flex w-full items-center gap-2 text-left text-xs transition-colors hover:text-foreground">
                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", o.fulfilled ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-muted-foreground/40 text-transparent")}><Check className="h-3 w-3" /></span>
                <span className={cn("flex-1", o.fulfilled && "text-muted-foreground line-through")}>{o.description}</span>
                {o.due_date && <span className="shrink-0 text-[10px] text-muted-foreground">{fmtDate(o.due_date)}</span>}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Compact contract tile (laid out in a multi-column grid): player name headline
// + vendor · date subtitle, bucket chip on the right. Click to expand the
// amount, obligations, and notes.
function ContractRow({ c, playerName }: { c: GmContract; playerName: string }) {
  const { viewPdf, removeContract, toggleObligation } = useGmContracts();
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const dates = [fmtDate(c.start_date), fmtDate(c.end_date)].filter(Boolean).join(" – ");
  const sub = [c.vendor_name, c.start_date ? fmtDate(c.start_date) : null].filter(Boolean).join(" · ");
  return (
    <>
    <div className="overflow-hidden rounded-lg border border-border/60">
      <div onClick={() => setOpen((o) => !o)} className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/20">
        <div className="min-w-0">
          <PlayerLink playerId={c.player_id} name={playerName} className="block truncate text-sm font-semibold" style={OSWALD} />
          <div className="truncate text-xs text-muted-foreground">{sub || "—"}</div>
        </div>
        <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", BUCKET_COLOR[c.bucket])}>{BUCKET_LABEL[c.bucket]}</span>
      </div>
      {open && (
        <div className="space-y-2.5 border-t border-border/50 px-3 pb-3 pt-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm font-bold tabular-nums text-[#D4AF37]">{money(c.total_value)}</span>
              {dates && <span className="text-xs text-muted-foreground">{dates}</span>}
              <span className={cn("text-xs capitalize", STATUS_COLOR[c.status])}>{c.status}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {c.pdf_path && <Button size="icon" variant="ghost" className="h-7 w-7" title="Open PDF" onClick={() => viewPdf(c.pdf_path!)}><ExternalLink className="h-3.5 w-3.5" /></Button>}
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Edit" onClick={() => setEditOpen(true)}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-rose-400" title="Remove" onClick={() => removeContract(c)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          {c.summary && <p className="text-xs text-muted-foreground">{c.summary}</p>}
          {c.obligations.length > 0 && (
            <div className="space-y-1 border-t border-border/50 pt-2">
              {c.obligations.map((o) => (
                <button key={o.id} onClick={() => toggleObligation(o.id, !o.fulfilled)}
                  className="flex w-full items-center gap-2 text-left text-xs transition-colors hover:text-foreground">
                  <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", o.fulfilled ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-muted-foreground/40 text-transparent")}><Check className="h-3 w-3" /></span>
                  <span className={cn("flex-1", o.fulfilled && "text-muted-foreground line-through")}>{o.description}</span>
                  {o.due_date && <span className="shrink-0 text-[10px] text-muted-foreground">{fmtDate(o.due_date)}</span>}
                </button>
              ))}
            </div>
          )}
          {c.notes && <div className="border-t border-border/50 pt-2 text-xs text-muted-foreground"><span className="font-semibold text-foreground/70">Notes: </span>{c.notes}</div>}
        </div>
      )}
    </div>
    <AddContractDialog open={editOpen} onOpenChange={setEditOpen} players={[{ id: c.player_id, name: playerName }]} defaultPlayerId={c.player_id} editing={c} />
    </>
  );
}

export default function GMContracts() {
  const gm = useGmRoster();
  const { contracts, isLoading } = useGmContracts();
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");

  const players = useMemo(() => {
    const rows = [...gm.hitters, ...gm.pitchers].filter((r) => r.player_id);
    const seen = new Set<string>();
    return rows.filter((r) => { if (seen.has(r.player_id!)) return false; seen.add(r.player_id!); return true; })
      .map((r) => ({ id: r.player_id!, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [gm.hitters, gm.pitchers]);
  const nameById = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);

  const totalValue = contracts.reduce((s, c) => s + (c.total_value ?? 0), 0);
  // Alphabetical by player name (same-player deals grouped, newest first within).
  const sortedContracts = useMemo(() =>
    [...contracts].sort((a, b) =>
      (nameById.get(a.player_id) ?? "").localeCompare(nameById.get(b.player_id) ?? "") || (a.created_at < b.created_at ? 1 : -1),
    ), [contracts, nameById]);
  // Search filters on player name OR vendor.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedContracts;
    return sortedContracts.filter((c) =>
      (nameById.get(c.player_id) ?? "").toLowerCase().includes(q) || (c.vendor_name ?? "").toLowerCase().includes(q),
    );
  }, [sortedContracts, query, nameById]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#D4AF37]" />
          <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>Contracts</h2>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add Contract</Button>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">Upload a signed contract PDF — value and dates auto-fill for you to review — and track its bucket, vendor, value, and obligations. {contracts.length > 0 && <span className="font-medium text-foreground/80">{contracts.length} on file · {money(totalValue)} total.</span>}</p>

      {contracts.length > 0 && (
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search player or vendor…" className="h-8 pl-8 text-sm" />
        </div>
      )}

      {isLoading ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : contracts.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">No contracts yet. Add one to start tracking signed deals.</CardContent></Card>
      ) : filtered.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">No contracts match "{query}".</CardContent></Card>
      ) : (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {filtered.map((c) => <ContractRow key={c.id} c={c} playerName={nameById.get(c.player_id) ?? "Unknown player"} />)}
        </div>
      )}

      <AddContractDialog open={addOpen} onOpenChange={setAddOpen} players={players} />
    </div>
  );
}
