import { useMemo, useState } from "react";
import { useGmAllocations, type AllocationBucket, type GmAllocationSource } from "@/gm/hooks/useGmAllocations";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
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
  const [local, setLocal] = useState<string | null>(null);
  const display = local != null ? local : value == null ? "" : "$" + Math.round(value).toLocaleString("en-US");
  return (
    <Input
      value={display}
      inputMode="numeric"
      placeholder={placeholder}
      className={cn("h-8 text-right text-xs font-mono tabular-nums", className)}
      onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ""); setLocal(d === "" ? "" : "$" + Number(d).toLocaleString("en-US")); }}
      onBlur={() => { if (local != null) { const d = local.replace(/[^0-9]/g, ""); onSave(d === "" ? null : Number(d)); setLocal(null); } }}
    />
  );
}

function AddCategoryDialog({ open, onOpenChange, onAdd }: { open: boolean; onOpenChange: (o: boolean) => void; onAdd: (name: string, bucket: AllocationBucket, total: number | null) => void }) {
  const [name, setName] = useState("");
  const [bucket, setBucket] = useState<AllocationBucket>("nil");
  const [total, setTotal] = useState<number | null>(null);
  const reset = () => { setName(""); setBucket("nil"); setTotal(null); };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle style={OSWALD}>Add Category</DialogTitle></DialogHeader>
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
        </div>
        <DialogFooter>
          <Button size="sm" disabled={!name.trim()} onClick={() => { onAdd(name.trim(), bucket, total); reset(); onOpenChange(false); }}>Add Category</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SourceCard({ source, players, alloc, allocated, onRename, onTotal, onDelete, onSet }: {
  source: GmAllocationSource;
  players: { player_id: string; name: string }[];
  alloc: Map<string, number> | undefined;
  allocated: number;
  onRename: (name: string) => void;
  onTotal: (n: number | null) => void;
  onDelete: () => void;
  onSet: (playerId: string, amount: number | null) => void;
}) {
  const [nameDraft, setNameDraft] = useState(source.name);
  const [addOpen, setAddOpen] = useState(false);
  const allocatedIds = new Set(alloc ? [...alloc.keys()] : []);
  const allocatedPlayers = players.filter((p) => allocatedIds.has(p.player_id));
  const unallocated = players.filter((p) => !allocatedIds.has(p.player_id));
  const remaining = source.total != null ? source.total - allocated : null;
  const over = remaining != null && remaining < 0;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40 space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => { const n = nameDraft.trim(); if (n && n !== source.name) onRename(n); else setNameDraft(source.name); }}
            className="h-7 flex-1 border-transparent bg-transparent px-1 text-sm font-semibold hover:border-border focus:border-border"
          />
          <button onClick={onDelete} className="text-muted-foreground/50 hover:text-rose-400 transition" title="Delete category"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Total</div>
            <MoneyInput value={source.total} onSave={onTotal} placeholder="$0" className="w-full text-center" />
          </div>
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Allocated</div>
            <div className="pt-1.5 font-mono text-sm font-semibold tabular-nums">{money(allocated)}</div>
          </div>
          <div>
            <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Remaining</div>
            <div className={cn("pt-1.5 font-mono text-sm font-semibold tabular-nums", over ? "text-rose-500" : "text-emerald-400")}>
              {remaining == null ? "—" : money(Math.abs(remaining))}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {allocatedPlayers.length === 0 ? (
          <p className="px-4 py-3 text-center text-xs text-muted-foreground">No allocations yet.</p>
        ) : (
          <div className="divide-y divide-border/40">
            {allocatedPlayers.map((p) => (
              <div key={p.player_id} className="flex items-center gap-2 px-4 py-1.5">
                <span className="flex-1 truncate text-sm">{p.name}</span>
                <MoneyInput value={alloc?.get(p.player_id) ?? null} onSave={(n) => onSet(p.player_id, n)} className="w-24" />
                <button onClick={() => onSet(p.player_id, null)} className="text-muted-foreground/40 hover:text-destructive transition" title="Remove allocation"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
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
            <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <Plus className="h-3.5 w-3.5" /> Allocate to player
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function GMAllocations() {
  const { sources, isLoading, allocBySource, allocatedTotal, addSource, updateSource, removeSource, setAllocation } = useGmAllocations();
  const gm = useGmRoster();
  const [addOpen, setAddOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<GmAllocationSource | null>(null);

  // Roster players (real DB players only — allocations key on player_id).
  const players = useMemo(
    () => [...gm.hitters, ...gm.pitchers].filter((r) => r.player_id).map((r) => ({ player_id: r.player_id as string, name: r.name })),
    [gm.hitters, gm.pitchers],
  );

  const buckets: AllocationBucket[] = ["nil", "other"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-[#D4AF37]" />
          <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>Funding Sources</h2>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add Category</Button>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">Name a funding category, drop it in a bucket (NIL vendor or Other), set its total, then allocate to players. Remaining tracks against each category's pool.</p>

      {sources.length > 0 && (() => {
        const pool = sources.reduce((s, x) => s + (x.total ?? 0), 0);
        const alloc = sources.reduce((s, x) => s + allocatedTotal(x.id), 0);
        const remaining = pool - alloc;
        const tile = (label: string, val: string, accent?: string) => (
          <div className="px-4 py-3 flex flex-col gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
            <span className={cn("text-xl font-bold tabular-nums", accent)} style={OSWALD}>{val}</span>
          </div>
        );
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-border/60 bg-muted/20 divide-x divide-border/50">
            {tile("Total Pool", money(pool), "text-[#D4AF37]")}
            {tile("Allocated", money(alloc))}
            {tile("Remaining", money(Math.abs(remaining)), remaining < 0 ? "text-rose-500" : "text-emerald-400")}
            {tile("Categories", String(sources.length))}
          </div>
        );
      })()}

      {isLoading ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>
      ) : sources.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">No categories yet. Add one to start tracking vendor / other allocations.</CardContent></Card>
      ) : (
        buckets.map((bucket) => {
          const list = sources.filter((s) => s.bucket === bucket);
          if (list.length === 0) return null;
          const poolTotal = list.reduce((s, x) => s + (x.total ?? 0), 0);
          const poolAllocated = list.reduce((s, x) => s + allocatedTotal(x.id), 0);
          return (
            <div key={bucket} className="space-y-2">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>{BUCKET_LABEL[bucket]}</h3>
                <span className="text-[11px] text-muted-foreground">{money(poolAllocated)} allocated{poolTotal > 0 && ` of ${money(poolTotal)}`} · {list.length} categor{list.length === 1 ? "y" : "ies"}</span>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {list.map((s) => (
                  <SourceCard
                    key={s.id}
                    source={s}
                    players={players}
                    alloc={allocBySource.get(s.id)}
                    allocated={allocatedTotal(s.id)}
                    onRename={(name) => updateSource(s.id, { name })}
                    onTotal={(n) => updateSource(s.id, { total: n })}
                    onDelete={() => setConfirmDelete(s)}
                    onSet={(pid, amt) => setAllocation(s.id, pid, amt)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}

      <AddCategoryDialog open={addOpen} onOpenChange={setAddOpen} onAdd={addSource} />

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{confirmDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This removes the category and all of its player allocations. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => { if (confirmDelete) removeSource(confirmDelete.id); setConfirmDelete(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
