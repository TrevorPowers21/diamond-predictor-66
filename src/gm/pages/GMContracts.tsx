import { useMemo, useState } from "react";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { useGmContracts, type ContractBucket, type ContractStatus, type GmContract, type ParsedContract } from "@/gm/hooks/useGmContracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FileText, Plus, Sparkles, Upload, X, ExternalLink, Trash2, Check } from "lucide-react";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const fmtDate = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null);

const BUCKET_LABEL: Record<ContractBucket, string> = { rev: "Rev Share", nil: "NIL", other: "Other" };
const BUCKET_COLOR: Record<ContractBucket, string> = {
  rev: "bg-sky-500/12 text-sky-400 border-sky-500/30",
  nil: "bg-[#D4AF37]/12 text-[#D4AF37] border-[#D4AF37]/30",
  other: "bg-violet-500/12 text-violet-400 border-violet-500/30",
};
const STATUS_COLOR: Record<ContractStatus, string> = {
  active: "text-emerald-400", pending: "text-amber-400", expired: "text-muted-foreground", terminated: "text-rose-400",
};

type ObDraft = { description: string; due_date: string | null };

function AddContractDialog({ open, onOpenChange, players }: {
  open: boolean; onOpenChange: (o: boolean) => void; players: { id: string; name: string }[];
}) {
  const { parse, isParsing, addContract, isSaving } = useGmContracts();
  const [file, setFile] = useState<File | null>(null);
  const [playerId, setPlayerId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [bucket, setBucket] = useState<ContractBucket>("nil");
  const [vendor, setVendor] = useState("");
  const [value, setValue] = useState<number | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [status, setStatus] = useState<ContractStatus>("active");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [obs, setObs] = useState<ObDraft[]>([]);
  const [parsedRaw, setParsedRaw] = useState<ParsedContract | null>(null);
  const [aiDone, setAiDone] = useState(false);

  const reset = () => {
    setFile(null); setPlayerId(""); setTitle(""); setBucket("nil"); setVendor(""); setValue(null);
    setStart(""); setEnd(""); setStatus("active"); setSummary(""); setNotes(""); setObs([]); setParsedRaw(null); setAiDone(false);
  };

  const runParse = async () => {
    if (!file) return;
    const p = await parse(file);
    setParsedRaw(p);
    if (p.title) setTitle(p.title);
    if (p.bucket) setBucket(p.bucket);
    if (p.vendor_name) setVendor(p.vendor_name);
    if (p.total_value != null) setValue(p.total_value);
    if (p.start_date) setStart(p.start_date);
    if (p.end_date) setEnd(p.end_date);
    if (p.summary) setSummary(p.summary);
    if (p.obligations?.length) setObs(p.obligations.map((o) => ({ description: o.description, due_date: o.due_date || null })));
    setAiDone(true);
  };

  const save = () => {
    if (!playerId) return;
    addContract({
      player_id: playerId, title: title.trim() || null, bucket, vendor_name: vendor.trim() || null,
      total_value: value, start_date: start || null, end_date: end || null, status,
      summary: summary.trim() || null, notes: notes.trim() || null, parsed: parsedRaw,
      obligations: obs, file,
    }, () => { reset(); onOpenChange(false); });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle style={OSWALD}>Add Contract</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {/* PDF + AI read */}
          <div className="rounded-lg border border-dashed border-border/70 p-3">
            <div className="flex items-center gap-2">
              <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                <Upload className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{file ? file.name : "Choose contract PDF…"}</span>
                <input type="file" accept="application/pdf" className="hidden"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setAiDone(false); }} />
              </label>
              {file && (
                <Button size="sm" variant="secondary" className="h-8 gap-1.5" disabled={isParsing} onClick={runParse}>
                  <Sparkles className="h-3.5 w-3.5" /> {isParsing ? "Reading…" : aiDone ? "Re-read" : "Read with AI"}
                </Button>
              )}
            </div>
            {aiDone && <p className="mt-2 text-[11px] text-emerald-400">Fields pre-filled from the PDF — review and correct below.</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Player" full>
              <Select value={playerId} onValueChange={setPlayerId}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select player" /></SelectTrigger>
                <SelectContent className="max-h-64">{players.map((p) => <SelectItem key={p.id} value={p.id} className="text-sm">{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Title" full><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Opendorse NIL Agreement" className="h-9 text-sm" /></Field>
            <Field label="Bucket">
              <Select value={bucket} onValueChange={(v) => setBucket(v as ContractBucket)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{(["rev", "nil", "other"] as ContractBucket[]).map((b) => <SelectItem key={b} value={b} className="text-sm">{BUCKET_LABEL[b]}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label={bucket === "rev" ? "Source" : "Vendor"}><Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder={bucket === "rev" ? "School" : "e.g. Opendorse"} className="h-9 text-sm" /></Field>
            <Field label="Total value"><Input value={value ?? ""} onChange={(e) => { const t = e.target.value.replace(/[^0-9.]/g, ""); setValue(t === "" ? null : Number(t)); }} inputMode="decimal" placeholder="$0" className="h-9 text-sm" /></Field>
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
        </div>
        <DialogFooter>
          <Button size="sm" disabled={!playerId || isSaving} onClick={save}>{isSaving ? "Saving…" : "Save Contract"}</Button>
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

function ContractCard({ c, playerName }: { c: GmContract; playerName: string }) {
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

export default function GMContracts() {
  const gm = useGmRoster();
  const { contracts, isLoading } = useGmContracts();
  const [addOpen, setAddOpen] = useState(false);

  const players = useMemo(() => {
    const rows = [...gm.hitters, ...gm.pitchers].filter((r) => r.player_id);
    const seen = new Set<string>();
    return rows.filter((r) => { if (seen.has(r.player_id!)) return false; seen.add(r.player_id!); return true; })
      .map((r) => ({ id: r.player_id!, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [gm.hitters, gm.pitchers]);
  const nameById = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);

  const totalValue = contracts.reduce((s, c) => s + (c.total_value ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#D4AF37]" />
          <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>Contracts</h2>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add Contract</Button>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">Upload a signed contract PDF, read it with AI, and track its bucket, vendor, value, and obligations. {contracts.length > 0 && <span className="font-medium text-foreground/80">{contracts.length} on file · {money(totalValue)} total.</span>}</p>

      {isLoading ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : contracts.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">No contracts yet. Add one to start tracking signed deals.</CardContent></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {contracts.map((c) => <ContractCard key={c.id} c={c} playerName={nameById.get(c.player_id) ?? "Unknown player"} />)}
        </div>
      )}

      <AddContractDialog open={addOpen} onOpenChange={setAddOpen} players={players} />
    </div>
  );
}
