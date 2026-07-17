import { useMemo, useState } from "react";
import { useGmAllocations, type AllocationBucket, type GmAllocationSource } from "@/gm/hooks/useGmAllocations";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { useGmContracts } from "@/gm/hooks/useGmContracts";
import { PlayerLink } from "@/gm/components/PlayerLink";
import { CurrencyInput } from "@/components/CurrencyInput";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const BUCKET_LABEL: Record<AllocationBucket, string> = { nil: "NIL Vendors", other: "Other" };

/** Live-formatting currency input, saves the raw number on blur. */
function MoneyInput({ value, onSave, placeholder = "—", className }: { value: number | null; onSave: (n: number | null) => void; placeholder?: string; className?: string }) {
  return <CurrencyInput value={value} onSave={onSave} placeholder={placeholder} className={cn("h-8 text-right text-xs font-mono tabular-nums", className)} />;
}

function AddCategoryDialog({ open, onOpenChange, onAdd, baseFor }: { open: boolean; onOpenChange: (o: boolean) => void; onAdd: (name: string, bucket: AllocationBucket, total: number | null, reallocate: boolean) => void; baseFor: (bucket: AllocationBucket) => number }) {
  const [name, setName] = useState("");
  const [bucket, setBucket] = useState<AllocationBucket>("nil");
  const [total, setTotal] = useState<number | null>(null);
  // "add" = new money on top of the current total; "reallocate" = move it out of
  // the general (Edit Budget) base so the overall total stays the same.
  const [mode, setMode] = useState<"add" | "reallocate">("add");
  const reset = () => { setName(""); setBucket("nil"); setTotal(null); setMode("add"); };
  const base = baseFor(bucket);
  const bucketWord = bucket === "nil" ? "NIL" : "Other";
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle style={OSWALD}>Add {bucket === "nil" ? "Vendor" : "Source"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Opendorse, Summer Camp" className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Bucket</label>
            <Select value={bucket} onValueChange={(v) => setBucket(v as AllocationBucket)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nil">NIL Vendor</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total pool</label>
            <MoneyInput value={total} onSave={setTotal} placeholder="$0" className="w-full text-left" />
          </div>
          {/* New money vs. reallocate from the general base, so the GM doesn't
              accidentally double-count money already sitting in Edit Budget. */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">This money is</label>
            <div className="grid gap-1.5">
              {([
                { v: "add" as const, t: `New money — adds on top of ${bucketWord}` },
                { v: "reallocate" as const, t: `From the general ${bucketWord} budget${base > 0 ? ` (${money(base)})` : ""} — keeps the total the same` },
              ]).map((o) => (
                <button key={o.v} type="button" onClick={() => setMode(o.v)} disabled={o.v === "reallocate" && base <= 0}
                  className={cn("flex items-start gap-2 rounded-md border p-2 text-left text-xs transition-colors disabled:opacity-40",
                    mode === o.v ? "border-[#D4AF37] bg-[#D4AF37]/[0.07]" : "border-border/60 hover:border-border")}>
                  <span className={cn("mt-0.5 h-3 w-3 shrink-0 rounded-full border", mode === o.v ? "border-[#D4AF37] bg-[#D4AF37]" : "border-muted-foreground/50")} />
                  <span>{o.t}</span>
                </button>
              ))}
            </div>
            {mode === "reallocate" && total != null && total > base && (
              <p className="text-[10px] text-rose-500">Only {money(base)} in the general {bucketWord} budget — it'll drop to $0 and {money(total - base)} will be new money.</p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" disabled={!name.trim()} onClick={() => { onAdd(name.trim(), bucket, total, mode === "reallocate"); reset(); onOpenChange(false); }}>Add {bucket === "nil" ? "Vendor" : "Source"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourceCard({ source, players, alloc, allocated, bucketName, onRename, onTotal, onDelete, onSet, totalFor, onSetTotal }: {
  source: GmAllocationSource;
  players: { player_id: string; name: string }[];
  alloc: Map<string, number> | undefined;
  allocated: number;
  bucketName: string; // "NIL" | "Other"
  onRename: (name: string) => void;
  onTotal: (n: number | null) => void;
  onDelete: () => void;
  onSet: (playerId: string, amount: number | null) => void;
  // Player's whole-bucket total (Unassigned + all vendors), editable → adjusts
  // their Unassigned and wires to Roster Management.
  totalFor: (playerId: string) => number | null;
  onSetTotal: (playerId: string, total: number | null) => void;
}) {
  const [nameDraft, setNameDraft] = useState(source.name);
  const [addOpen, setAddOpen] = useState(false);
  const allocatedIds = new Set(alloc ? [...alloc.keys()] : []);
  const allocatedPlayers = players.filter((p) => allocatedIds.has(p.player_id));
  const unallocated = players.filter((p) => !allocatedIds.has(p.player_id));
  const remaining = source.total != null ? source.total - allocated : null;
  const over = remaining != null && remaining < 0;

  return (
    <Card className="overflow-hidden border-border/60">
      <div className="flex items-center gap-2 px-4 pb-2 pt-3">
        <Input
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => { const n = nameDraft.trim(); if (n && n !== source.name) onRename(n); else setNameDraft(source.name); }}
          className="h-7 flex-1 border-transparent bg-transparent px-1 text-sm font-semibold hover:border-border focus:border-border"
        />
        <button onClick={onDelete} className="text-muted-foreground/50 hover:text-rose-400 transition" title="Delete category"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border/50 border-y border-border/40 bg-muted/20">
        <div className="flex flex-col items-center gap-1 px-3 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Total</span>
          <MoneyInput value={source.total} onSave={onTotal} placeholder="$0" className="h-9 w-full max-w-[150px] border-transparent bg-transparent text-center text-xl md:text-xl font-bold font-[Oswald] text-[#D4AF37] shadow-none focus-visible:border-border" />
        </div>
        <div className="flex flex-col items-center gap-1 px-3 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Allocated</span>
          <span className="font-mono text-xl font-bold tabular-nums" style={OSWALD}>{money(allocated)}</span>
        </div>
        <div className="flex flex-col items-center gap-1 px-3 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Remaining</span>
          <span className={cn("font-mono text-xl font-bold tabular-nums", over ? "text-rose-500" : "text-emerald-400")} style={OSWALD}>{remaining == null ? "—" : money(Math.abs(remaining))}</span>
        </div>
      </div>
      <CardContent className="p-0">
        {allocatedPlayers.length === 0 ? (
          <p className="px-4 py-3 text-center text-xs text-muted-foreground">No allocations yet.</p>
        ) : (
          <>
            <div className="flex items-center gap-2 px-4 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              <span className="flex-1" />
              <span className="w-24 text-right">This Vendor</span>
              <span className="w-24 text-right">Total {bucketName}</span>
              <span className="w-[18px]" />
            </div>
            <div className="divide-y divide-border/40">
              {allocatedPlayers.map((p) => (
                <div key={p.player_id} className="flex items-center gap-2 px-4 py-1.5">
                  <PlayerLink playerId={p.player_id} name={p.name} className="flex-1 truncate text-sm" />
                  <MoneyInput value={alloc?.get(p.player_id) ?? null} onSave={(n) => onSet(p.player_id, n)} className="w-24" />
                  {/* Whole-bucket total — additive by default, edit down to absorb into Unassigned. */}
                  <MoneyInput value={totalFor(p.player_id)} onSave={(n) => onSetTotal(p.player_id, n)} placeholder="—" className="w-24 font-semibold text-[#D4AF37]" />
                  <button onClick={() => onSet(p.player_id, null)} className="text-muted-foreground/40 hover:text-destructive transition" title="Remove allocation"><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="px-4 py-2 border-t border-border/40">
          {addOpen ? (
            <Select value="" onValueChange={(pid) => { onSet(pid, 0); setAddOpen(false); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick a player…" /></SelectTrigger>
              <SelectContent>
                {unallocated.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">All rostered players allocated</div>
                  : unallocated.map((p) => <SelectItem key={p.player_id} value={p.player_id} className="text-xs">{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add player
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type RevRow = { bpid: string; pid: string; name: string; rev: number | null };

/** One column (Hitters or Pitchers) of the Rev Share card: add a player, type
 *  their amount; only allocated players show, like a vendor card. */
function RevAllocColumn({ title, rows, onSet }: { title: string; rows: RevRow[]; onSet: (bpid: string, pid: string, amount: number | null) => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const allocated = rows.filter((r) => r.rev != null);
  const unallocated = rows.filter((r) => r.rev == null);
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      {allocated.length === 0 ? (
        <p className="py-1 text-xs text-muted-foreground">No allocations yet.</p>
      ) : (
        <div className="divide-y divide-border/40">
          {allocated.map((r) => (
            <div key={r.bpid} className="flex items-center gap-2 py-1.5">
              <PlayerLink playerId={r.pid} name={r.name} className="flex-1 truncate text-sm" />
              <MoneyInput value={r.rev} onSave={(n) => onSet(r.bpid, r.pid, n)} className="w-24" />
              <button onClick={() => onSet(r.bpid, r.pid, null)} className="text-muted-foreground/40 hover:text-destructive transition" title="Remove"><X className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </div>
      )}
      <div className="pt-2">
        {addOpen ? (
          <Select value="" onValueChange={(bpid) => { const r = unallocated.find((x) => x.bpid === bpid); if (r) onSet(r.bpid, r.pid, 0); setAddOpen(false); }}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick a player…" /></SelectTrigger>
            <SelectContent>
              {unallocated.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">All allocated</div>
                : unallocated.map((r) => <SelectItem key={r.bpid} value={r.bpid} className="text-xs">{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        ) : (
          <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"><Plus className="h-3.5 w-3.5" /> Add player</button>
        )}
      </div>
    </div>
  );
}

/** Full-width Rev Share box — Total / Allocated / Remaining like a vendor card,
 *  with Hitters + Pitchers as two add-player columns. */
function RevShareCard({ hitters, pitchers, total, allocated, onTotal, onSet }: {
  hitters: RevRow[]; pitchers: RevRow[]; total: number | null; allocated: number;
  onTotal: (n: number | null) => void; onSet: (bpid: string, pid: string, amount: number | null) => void;
}) {
  const remaining = total != null ? total - allocated : null;
  const over = remaining != null && remaining < 0;
  return (
    <Card className="overflow-hidden border-border/60">
      <div className="grid grid-cols-3 divide-x divide-border/50 border-b border-border/40 bg-muted/20">
        <div className="flex flex-col items-center gap-1 px-4 py-4">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Total Pool</span>
          <MoneyInput value={total} onSave={onTotal} placeholder="$0" className="h-10 w-full max-w-[180px] border-transparent bg-transparent text-center text-2xl md:text-2xl font-bold font-[Oswald] text-[#D4AF37] shadow-none focus-visible:border-border" />
        </div>
        <div className="flex flex-col items-center gap-1 px-4 py-4">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Allocated</span>
          <span className="font-mono text-2xl font-bold tabular-nums" style={OSWALD}>{money(allocated)}</span>
        </div>
        <div className="flex flex-col items-center gap-1 px-4 py-4">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Remaining</span>
          <span className={cn("font-mono text-2xl font-bold tabular-nums", over ? "text-rose-500" : "text-emerald-400")} style={OSWALD}>{remaining == null ? "—" : money(Math.abs(remaining))}</span>
        </div>
      </div>
      <CardContent className="grid gap-x-8 gap-y-4 p-5 md:grid-cols-2">
        <RevAllocColumn title="Hitters" rows={hitters} onSet={onSet} />
        <RevAllocColumn title="Pitchers" rows={pitchers} onSet={onSet} />
      </CardContent>
    </Card>
  );
}

// A vendor whose money comes from CONTRACTS (no manually-created funding source
// in this build). Read-only here — edit the deals on the Contracts / Financials
// pages. Budget-cap integration (new-money vs carve) lands in slice 4.
function ContractVendorCard({ vendorName, rows }: { vendorName: string; rows: { player_id: string; name: string; amount: number }[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <Card className="border-border/60">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold" style={OSWALD}>{vendorName}</span>
            <span className="shrink-0 rounded border border-border/50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Contracts</span>
          </div>
          <span className="shrink-0 font-mono text-sm font-semibold text-[#D4AF37]">{money(total)}</span>
        </div>
        <div className="divide-y divide-border/40">
          {rows.map((r) => (
            <div key={r.player_id} className="flex items-center justify-between gap-2 py-1.5">
              <PlayerLink playerId={r.player_id} name={r.name} className="flex-1 truncate text-sm" />
              <span className="shrink-0 font-mono text-sm tabular-nums text-muted-foreground">{money(r.amount)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function GMAllocations() {
  const gm = useGmRoster();
  const { sources, isLoading, allocBySource, allocatedTotal, addSource, updateSource, removeSource, setAllocation } = useGmAllocations(gm.selectedBuildId);
  const { contracts } = useGmContracts();
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<GmAllocationSource | null>(null);

  // Roster players (real DB players only — allocations key on player_id).
  const players = useMemo(
    () => [...gm.hitters, ...gm.pitchers].filter((r) => r.player_id).map((r) => ({ player_id: r.player_id as string, name: r.name })),
    [gm.hitters, gm.pitchers],
  );
  const nameById = useMemo(() => new Map(players.map((p) => [p.player_id, p.name])), [players]);

  // Contracts grouped by vendor → the money that trickles onto this page. Keyed
  // by vendor_id (falls back to the vendor name for any pre-link contract), and
  // amounts summed per player (a player may have several deals with one vendor).
  const contractVendorsByBucket = useMemo(() => {
    const byBucket = new Map<"nil" | "other", Map<string, { name: string; vendorId: string | null; rows: Map<string, number> }>>();
    for (const c of contracts) {
      if (c.bucket !== "nil" && c.bucket !== "other") continue;
      if (!c.vendor_id && !c.vendor_name?.trim()) continue;
      const key = c.vendor_id ?? `n:${(c.vendor_name ?? "").trim().toLowerCase()}`;
      if (!byBucket.has(c.bucket)) byBucket.set(c.bucket, new Map());
      const m = byBucket.get(c.bucket)!;
      if (!m.has(key)) m.set(key, { name: c.vendor_name?.trim() || "Vendor", vendorId: c.vendor_id, rows: new Map() });
      const g = m.get(key)!;
      g.rows.set(c.player_id, (g.rows.get(c.player_id) ?? 0) + (c.total_value ?? 0));
    }
    return byBucket;
  }, [contracts]);
  // Rev Share is flat (no categories): a per-player amount stored on the roster
  // (gm_player_finance.rev_share). Edited here, it syncs to Roster Management.
  // Split hitters / pitchers into two columns of one full-width card.
  const revHitters = useMemo(() => gm.hitters.filter((r) => r.player_id).map((r) => ({ bpid: r.build_player_id, pid: r.player_id as string, name: r.name, rev: r.rev_share })), [gm.hitters]);
  const revPitchers = useMemo(() => gm.pitchers.filter((r) => r.player_id).map((r) => ({ bpid: r.build_player_id, pid: r.player_id as string, name: r.name, rev: r.rev_share })), [gm.pitchers]);
  const revAllocated = [...revHitters, ...revPitchers].reduce((s, r) => s + (r.rev ?? 0), 0);

  // Per-player bucket totals (Unassigned + vendors) + build_player_id, for the
  // grayed editable total on the vendor cards. Comes straight off the roster
  // rows so it stays consistent with Roster Management.
  const finByPlayer = useMemo(() => {
    const m = new Map<string, { bpid: string; nilTotal: number | null; otherTotal: number | null; nilVendor: number; otherVendor: number }>();
    for (const r of [...gm.hitters, ...gm.pitchers]) {
      if (!r.player_id) continue;
      const nilTotal = r.nil_amount == null && r.nil_vendor === 0 ? null : (r.nil_amount ?? 0) + r.nil_vendor;
      const otherTotal = r.other_amount == null && r.other_vendor === 0 ? null : (r.other_amount ?? 0) + r.other_vendor;
      m.set(r.player_id, { bpid: r.build_player_id, nilTotal, otherTotal, nilVendor: r.nil_vendor, otherVendor: r.other_vendor });
    }
    return m;
  }, [gm.hitters, gm.pitchers]);

  // Program-budget summary — computed the SAME way as Roster Management's budget
  // boxes so both pages agree. Used = money assigned to players; cap = the sum of
  // this build's Funding Sources categories (derived, single source of truth).
  const bucketUsed = useMemo(() => {
    let nil = 0, other = 0;
    for (const r of [...gm.hitters, ...gm.pitchers]) { nil += (r.nil_amount ?? 0) + r.nil_vendor; other += (r.other_amount ?? 0) + r.other_vendor; }
    return { nil, other };
  }, [gm.hitters, gm.pitchers]);
  // NIL/Other cap = editable base (Edit Budget) + this build's categories.
  const revCap = gm.budget?.rev_share_total ?? null;
  const nilCap = (gm.budget?.nil_total ?? 0) + gm.derivedCaps.nil;
  const otherCap = (gm.budget?.other_total ?? 0) + gm.derivedCaps.other;
  const totalUsed = revAllocated + bucketUsed.nil + bucketUsed.other;
  const totalCap = ((revCap ?? 0) + (nilCap ?? 0) + (otherCap ?? 0)) || null;
  const hasRoster = gm.hitters.length + gm.pitchers.length > 0;

  const buckets: AllocationBucket[] = ["nil", "other"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-[#D4AF37]" />
          <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>Funding Sources</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Build</span>
          <Select value={gm.selectedBuildId ?? undefined} onValueChange={(v) => gm.setSelectedBuildId(v)}>
            <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue placeholder="Select build" /></SelectTrigger>
            <SelectContent>{gm.builds.map((b) => <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add Vendor</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">Name a vendor, set its pool, then allocate to players. Each vendor adds on top of the general NIL/Other you type in Edit Budget — or reallocate from it to keep the total the same.</p>

      {hasRoster && (() => {
        const tile = (label: string, used: number, cap: number | null, accent?: boolean) => (
          <div className="flex flex-col gap-0.5 px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
            <span className="text-xl font-bold tabular-nums" style={OSWALD}>
              <span className={cn(accent && "text-[#D4AF37]", cap != null && used > cap && "text-rose-500")}>{money(used)}</span>
              {cap != null && <span className="text-xs font-normal text-muted-foreground"> / {money(cap)}</span>}
            </span>
          </div>
        );
        return (
          <div className="grid grid-cols-2 divide-x divide-y divide-border/50 rounded-lg border border-border/60 bg-muted/20 sm:grid-cols-4 sm:divide-y-0">
            {tile("Revenue Share", revAllocated, revCap)}
            {tile("NIL", bucketUsed.nil, nilCap)}
            {tile("Other", bucketUsed.other, otherCap)}
            {tile("Total", totalUsed, totalCap, true)}
          </div>
        );
      })()}

      {/* Revenue Share — one full-width box, hitters + pitchers in two columns,
          synced with Roster Management. */}
      {(revHitters.length + revPitchers.length) > 0 && (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Revenue Share</h3>
            <span className="text-[11px] text-muted-foreground">flat per player · synced with Roster Management</span>
          </div>
          <RevShareCard
            hitters={revHitters}
            pitchers={revPitchers}
            total={gm.budget?.rev_share_total ?? null}
            allocated={revAllocated}
            onTotal={(n) => gm.saveBudget({ rev_share_total: n })}
            onSet={(bpid, pid, amt) => gm.setFinanceField(bpid, pid, "rev_share", amt)}
          />
        </div>
      )}

      {isLoading ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : sources.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">No categories yet. Add one to start tracking vendor / other allocations.</CardContent></Card>
      ) : (
        buckets.map((bucket) => {
          const list = sources.filter((s) => s.bucket === bucket);
          // Vendors whose money comes only from contracts (no manual source here).
          const sourceVendorIds = new Set(list.map((s) => s.vendor_id).filter(Boolean) as string[]);
          const cVendors = [...(contractVendorsByBucket.get(bucket)?.values() ?? [])]
            .filter((g) => !(g.vendorId && sourceVendorIds.has(g.vendorId)))
            .map((g) => ({ name: g.name, rows: [...g.rows].map(([pid, amt]) => ({ player_id: pid, name: nameById.get(pid) ?? "Player", amount: amt })) }))
            .filter((g) => g.rows.length > 0)
            .sort((a, b) => a.name.localeCompare(b.name));
          if (list.length === 0 && cVendors.length === 0) return null;
          const poolTotal = list.reduce((s, x) => s + (x.total ?? 0), 0);
          const poolAllocated = list.reduce((s, x) => s + allocatedTotal(x.id), 0);
          const catCount = list.length + cVendors.length;
          return (
            <div key={bucket} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>{BUCKET_LABEL[bucket]}</h3>
                <span className="text-[11px] text-muted-foreground">{money(poolAllocated)} allocated{poolTotal > 0 && ` of ${money(poolTotal)}`} · {catCount} categor{catCount === 1 ? "y" : "ies"}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {cVendors.map((g) => <ContractVendorCard key={`c:${g.name}`} vendorName={g.name} rows={g.rows} />)}
                {list.map((s) => (
                  <SourceCard
                    key={s.id}
                    source={s}
                    players={players}
                    alloc={allocBySource.get(s.id)}
                    allocated={allocatedTotal(s.id)}
                    bucketName={bucket === "nil" ? "NIL" : "Other"}
                    onRename={(name) => updateSource(s.id, { name })}
                    onTotal={(n) => updateSource(s.id, { total: n })}
                    onDelete={() => setConfirmDelete(s)}
                    onSet={(pid, amt) => setAllocation(s.id, pid, amt)}
                    totalFor={(pid) => (bucket === "nil" ? finByPlayer.get(pid)?.nilTotal : finByPlayer.get(pid)?.otherTotal) ?? null}
                    onSetTotal={(pid, total) => {
                      const f = finByPlayer.get(pid); if (!f) return;
                      const vendor = bucket === "nil" ? f.nilVendor : f.otherVendor;
                      gm.setFinanceField(f.bpid, pid, bucket === "nil" ? "nil_amount" : "other_amount", total == null ? null : Math.max(0, total - vendor));
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}

      <AddCategoryDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        baseFor={(b) => (b === "nil" ? gm.budget?.nil_total : gm.budget?.other_total) ?? 0}
        onAdd={(name, bucket, total, reallocate) => {
          // Carve = pull this amount out of the general base so the overall total
          // stays the same. base_offset records the exact dollars pulled, so delete
          // can offer to return them. (If the pool exceeds the base, only the base
          // portion is carved — the rest is new money.)
          const base = (bucket === "nil" ? gm.budget?.nil_total : gm.budget?.other_total) ?? 0;
          const offset = reallocate && total ? Math.min(total, base) : 0;
          addSource(name, bucket, total, offset > 0 ? "from_base" : "new_money", offset);
          if (offset > 0) gm.saveBudget(bucket === "nil" ? { nil_total: base - offset } : { other_total: base - offset });
        }}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          {(() => {
            const del = confirmDelete;
            const offset = del?.base_offset ?? 0;
            const bWord = del?.bucket === "nil" ? "NIL" : "Other";
            const removeIt = () => { if (del) removeSource(del.id); setConfirmDelete(null); };
            const returnToBase = () => {
              if (!del) return;
              const base = (del.bucket === "nil" ? gm.budget?.nil_total : gm.budget?.other_total) ?? 0;
              gm.saveBudget(del.bucket === "nil" ? { nil_total: base + offset } : { other_total: base + offset });
              removeIt();
            };
            // Carved-from-base vendor → ask whether the carve returns to the base or
            // leaves the budget. New-money vendor → plain delete (its pool just drops).
            return offset > 0 ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{del?.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>{money(offset)} of this vendor was taken from the general {bWord} budget. Deleting removes the vendor and its allocations — should that {money(offset)} go back to the general {bWord} budget, or leave the budget entirely?</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={returnToBase}>Return {money(offset)} to {bWord}</AlertDialogAction>
                  <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={removeIt}>Remove entirely</AlertDialogAction>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{del?.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>This removes the vendor and all of its player allocations, and subtracts its pool from the {bWord} total. This can't be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={removeIt}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
