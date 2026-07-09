import { useState } from "react";
import { Link } from "react-router-dom";
import { useGmTargetBoard, type GmTarget } from "@/gm/hooks/useGmTargetBoard";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Check, Plus, StickyNote, Target, Trash2 } from "lucide-react";
import { profileRouteFor } from "@/lib/profileRoutes";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d));

/** Live-formatting currency input ($ + commas), saves the raw number on blur. */
function MoneyInput({ value, onSave, placeholder = "—" }: { value: number | null; onSave: (n: number | null) => void; placeholder?: string }) {
  const [local, setLocal] = useState<string | null>(null);
  const display = local != null ? local : value == null ? "" : "$" + Math.round(value).toLocaleString("en-US");
  return (
    <Input
      value={display}
      inputMode="numeric"
      placeholder={placeholder}
      className="h-8 w-28 text-right text-xs font-mono tabular-nums ml-auto"
      onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ""); setLocal(d === "" ? "" : "$" + Number(d).toLocaleString("en-US")); }}
      onBlur={() => { if (local != null) { const d = local.replace(/[^0-9]/g, ""); onSave(d === "" ? null : Number(d)); setLocal(null); } }}
    />
  );
}

/** Authored/dated note log for one target. */
function NotesDialog({ target, onClose, onAdd, onRemove }: { target: GmTarget | null; onClose: () => void; onAdd: (playerId: string, body: string) => void; onRemove: (id: string) => void }) {
  const [draft, setDraft] = useState("");
  if (!target) return null;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) { setDraft(""); onClose(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle style={OSWALD}>Notes — {target.name}</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {target.notes.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No notes yet.</p>
          ) : target.notes.map((n) => (
            <div key={n.id} className="group rounded-md border border-border/50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {(n.author || "—").split("@")[0]} · {new Date(n.note_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition" onClick={() => onRemove(n.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1 text-sm text-foreground/90 whitespace-pre-wrap">{n.body}</p>
            </div>
          ))}
        </div>
        <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note…" className="text-sm" rows={3} />
        <DialogFooter>
          <Button size="sm" disabled={!draft.trim()} onClick={() => { onAdd(target.player_id, draft); setDraft(""); }}>Add Note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function GMTargets() {
  const { targets, isLoading, saveOffer, addNote, removeNote } = useGmTargetBoard();
  const gm = useGmRoster();
  const [notesFor, setNotesFor] = useState<GmTarget | null>(null);
  const [confirmAdd, setConfirmAdd] = useState<GmTarget | null>(null);

  const activeBuildName = gm.builds.find((b) => b.id === gm.selectedBuildId)?.name ?? "—";
  // Notes objects are re-derived each render, so re-resolve the open target by id.
  const liveNotesTarget = notesFor ? (targets.find((t) => t.player_id === notesFor.player_id) ?? notesFor) : null;

  const doAdd = (t: GmTarget) => {
    gm.addTargetToRoster(
      { playerId: t.player_id, name: t.name, position: t.position, isPitcher: t.is_pitcher, snapshot: t.snapshot, offer: t.offer ?? 0, buildName: `${activeBuildName} + ${t.name}` },
      () => setConfirmAdd(null),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-[#D4AF37]" />
          <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>Target Board</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Add to build</span>
          <Select value={gm.selectedBuildId ?? undefined} onValueChange={(v) => gm.setSelectedBuildId(v)}>
            <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue placeholder="Select build" /></SelectTrigger>
            <SelectContent>{gm.builds.map((b) => <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>
            Shared Targets{targets.length > 0 && <span className="ml-2 text-muted-foreground font-normal normal-case tracking-normal">{targets.length}</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading targets…</p>
          ) : targets.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">No targets yet — add players to the target board from Player Evaluation and they'll show up here.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Player</TableHead>
                  <TableHead className="text-xs">Pos</TableHead>
                  <TableHead className="text-xs">School</TableHead>
                  <TableHead className="text-xs text-right">Proj WAR</TableHead>
                  <TableHead className="text-xs text-right">Market Value</TableHead>
                  <TableHead className="text-xs text-right">Willing to Pay</TableHead>
                  <TableHead className="text-xs text-center">Notes</TableHead>
                  <TableHead className="text-xs text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {targets.map((t) => {
                  const onRoster = gm.onBuildPlayerIds.has(t.player_id);
                  return (
                    <TableRow key={t.player_id} className={onRoster ? "bg-emerald-500/[0.04]" : undefined}>
                      <TableCell className="py-1.5">
                        <Link to={profileRouteFor(t.player_id, t.position)} className="font-medium text-sm hover:text-primary hover:underline">{t.name}</Link>
                      </TableCell>
                      <TableCell className="py-1.5 text-xs text-muted-foreground">{t.position ?? "—"}</TableCell>
                      <TableCell className="py-1.5 text-xs text-muted-foreground">{t.team ?? "—"}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-sm tabular-nums">{num(t.war)}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-sm tabular-nums">{money(t.market_value)}</TableCell>
                      <TableCell className="py-1.5 text-right">
                        <MoneyInput value={t.offer} onSave={(n) => saveOffer(t.player_id, n)} />
                      </TableCell>
                      <TableCell className="py-1.5 text-center">
                        <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition" onClick={() => setNotesFor(t)}>
                          <StickyNote className="h-3.5 w-3.5" />
                          {t.notes.length > 0 && <span className="tabular-nums">{t.notes.length}</span>}
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5 text-right">
                        {onRoster ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                            <Check className="h-3 w-3" /> On Roster
                          </span>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={gm.isAddingTarget} onClick={() => setConfirmAdd(t)}>
                            <Plus className="h-3.5 w-3.5" /> Add to Roster
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NotesDialog target={liveNotesTarget} onClose={() => setNotesFor(null)} onAdd={addNote} onRemove={removeNote} />

      <AlertDialog open={!!confirmAdd} onOpenChange={(o) => { if (!o) setConfirmAdd(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add {confirmAdd?.name} to the roster?</AlertDialogTitle>
            <AlertDialogDescription>
              This adds {confirmAdd?.name} to <span className="font-semibold text-foreground">{activeBuildName}</span> at {money(confirmAdd?.offer ?? 0)} and makes them visible on the coach's build.
              {gm.activeBuildIsDefault && " A working copy of the default roster is created so the default stays untouched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmAdd && doAdd(confirmAdd)}>Add to Roster</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
