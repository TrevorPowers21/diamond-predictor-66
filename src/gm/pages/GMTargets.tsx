import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useGmTargetBoard, type GmTarget } from "@/gm/hooks/useGmTargetBoard";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import PlayerNotesDialog from "@/components/PlayerNotesDialog";
import { ArrowUpDown, Check, ChevronDown, ChevronRight, GripVertical, Plus, Search, StickyNote, Target as TargetIcon, Trash2 } from "lucide-react";
import { portalStatusMeta } from "@/components/PortalStatus";
import { cn } from "@/lib/utils";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d));

type GroupKey = "C" | "IF" | "OF";
const POSITION_GROUPS: GroupKey[] = ["C", "IF", "OF"];
const GROUP_LABELS: Record<GroupKey, string> = { C: "Catchers", IF: "Infielders", OF: "Outfielders / DH" };
const groupForHitter = (pos: string | null | undefined): GroupKey => {
  const p = String(pos || "").toUpperCase().trim();
  if (p === "C") return "C";
  if (/^(OF|LF|CF|RF|DH)$/.test(p)) return "OF";
  return "IF";
};
type ViewType = "hitter" | "pitcher";
type HitterMode = "overall" | "by-position";
type ScopeKey = "hitter-overall" | "hitter-C" | "hitter-IF" | "hitter-OF" | "pitcher";
type SortKey = "manual" | "name" | "war" | "market_value" | "asking" | "offer";
type SortDir = "asc" | "desc";

// ── manual drag order, persisted per (team, scope) in localStorage ──────
// Mirrors the Player-Evaluation Target Board's ordering model (team-shared
// persistence lands with the shared priority column later).
const LS_PREFIX = "gm-target-board-order:";
const loadOrder = (teamId: string | null, scope: string): string[] => {
  if (!teamId) return [];
  try { const raw = localStorage.getItem(`${LS_PREFIX}${teamId}:${scope}`); const p = raw ? JSON.parse(raw) : []; return Array.isArray(p) ? p.filter((v) => typeof v === "string") : []; } catch { return []; }
};
const saveOrder = (teamId: string | null, scope: string, order: string[]) => {
  if (!teamId) return;
  try { localStorage.setItem(`${LS_PREFIX}${teamId}:${scope}`, JSON.stringify(order)); } catch { /* ignore */ }
};
const applyOrder = (rows: GmTarget[], order: string[]): GmTarget[] => {
  if (order.length === 0) return rows;
  const idx = new Map<string, number>(); order.forEach((id, i) => idx.set(id, i));
  return [...rows].sort((a, b) => (idx.has(a.player_id) ? idx.get(a.player_id)! : Infinity) - (idx.has(b.player_id) ? idx.get(b.player_id)! : Infinity));
};

/** Live-formatting currency input; saves the raw number on blur. */
function MoneyInput({ value, onSave }: { value: number | null; onSave: (n: number | null) => void }) {
  const [local, setLocal] = useState<string | null>(null);
  const display = local != null ? local : value == null ? "" : "$" + Math.round(value).toLocaleString("en-US");
  return (
    <Input
      value={display}
      inputMode="numeric"
      placeholder="—"
      className="h-8 w-24 text-right text-xs font-mono tabular-nums ml-auto"
      onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ""); setLocal(d === "" ? "" : "$" + Number(d).toLocaleString("en-US")); }}
      onBlur={() => { if (local != null) { const d = local.replace(/[^0-9]/g, ""); onSave(d === "" ? null : Number(d)); setLocal(null); } }}
    />
  );
}

function SortBtn({ label, sk, active, dir, onClick, align = "left" }: { label: string; sk: SortKey; active: boolean; dir: SortDir; onClick: (sk: SortKey) => void; align?: "left" | "right" }) {
  return (
    <button onClick={() => onClick(sk)} className={cn("inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors", align === "right" && "ml-auto")}>
      {label}<ArrowUpDown className={cn("h-3 w-3 transition-opacity", active ? "opacity-100 text-[#D4AF37]" : "opacity-40")} />
    </button>
  );
}

function SortableRow({ id, children }: { id: string; children: (h: { listeners: any; attributes: any; isDragging: boolean }) => React.ReactNode }) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.55 : 1, position: "relative", zIndex: isDragging ? 10 : "auto" };
  return <TableRow ref={setNodeRef} style={style}>{children({ listeners, attributes, isDragging })}</TableRow>;
}

export default function GMTargets() {
  const { targets, isLoading, saveOffer, saveAsking, addNote, removeNote, removeFromBoard } = useGmTargetBoard();
  const gm = useGmRoster();
  const { effectiveTeamId } = useAuth();

  const [viewType, setViewType] = useState<ViewType>("hitter");
  const [hitterMode, setHitterMode] = useState<HitterMode>("overall");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("manual");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [notesFor, setNotesFor] = useState<GmTarget | null>(null);
  const [confirmAdd, setConfirmAdd] = useState<GmTarget | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<GmTarget | null>(null);

  const [orders, setOrders] = useState<Record<ScopeKey, string[]>>({ "hitter-overall": [], "hitter-C": [], "hitter-IF": [], "hitter-OF": [], pitcher: [] });
  useEffect(() => {
    setOrders({
      "hitter-overall": loadOrder(effectiveTeamId, "hitter-overall"),
      "hitter-C": loadOrder(effectiveTeamId, "hitter-C"),
      "hitter-IF": loadOrder(effectiveTeamId, "hitter-IF"),
      "hitter-OF": loadOrder(effectiveTeamId, "hitter-OF"),
      pitcher: loadOrder(effectiveTeamId, "pitcher"),
    });
  }, [effectiveTeamId]);

  const activeBuildName = gm.builds.find((b) => b.id === gm.selectedBuildId)?.name ?? "—";
  const liveNotesTarget = notesFor ? (targets.find((t) => t.player_id === notesFor.player_id) ?? notesFor) : null;

  const matches = (t: GmTarget) => { const q = search.trim().toLowerCase(); return !q || `${t.name} ${t.team || ""}`.toLowerCase().includes(q); };
  const allHitters = useMemo(() => targets.filter((t) => !t.is_pitcher && matches(t)), [targets, search]);
  const allPitchers = useMemo(() => targets.filter((t) => t.is_pitcher && matches(t)), [targets, search]);
  const hittersByGroup = useMemo(() => {
    const out = new Map<GroupKey, GmTarget[]>();
    for (const t of allHitters) { const g = groupForHitter(t.position); const l = out.get(g) || []; l.push(t); out.set(g, l); }
    return out;
  }, [allHitters]);
  const hitterCount = allHitters.length, pitcherCount = allPitchers.length;

  const toggleSort = (sk: SortKey) => {
    if (sortKey === sk) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(sk); setSortDir(sk === "name" ? "asc" : "desc"); }
  };
  const sortRows = (rows: GmTarget[], scope: ScopeKey): GmTarget[] => {
    if (sortKey === "manual") return applyOrder(rows, orders[scope]);
    const mul = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "name") return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`) * mul;
      const va = Number((a as any)[sortKey] ?? -Infinity), vb = Number((b as any)[sortKey] ?? -Infinity);
      return (va - vb) * mul;
    });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (sorted: GmTarget[], scope: ScopeKey) => (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = sorted.findIndex((r) => r.player_id === active.id), newI = sorted.findIndex((r) => r.player_id === over.id);
    if (oldI === -1 || newI === -1) return;
    const next = arrayMove(sorted, oldI, newI).map((r) => r.player_id);
    setOrders((prev) => ({ ...prev, [scope]: next }));
    saveOrder(effectiveTeamId, scope, next);
    setSortKey("manual");
  };

  const doAdd = (t: GmTarget) => gm.addTargetToRoster(
    { playerId: t.player_id, name: t.name, position: t.position, isPitcher: t.is_pitcher, snapshot: t.snapshot, offer: t.offer ?? 0, buildName: `${activeBuildName} + ${t.name}` },
    () => setConfirmAdd(null),
  );

  const statBadge = (t: GmTarget) => { const c = portalStatusMeta(t.portal_status); return <Badge variant="outline" className={`text-[10px] ${c.bg} ${c.text} border-current/30`}>{c.label}</Badge>; };

  const renderTable = (rows: GmTarget[], scope: ScopeKey) => {
    const sorted = sortRows(rows, scope);
    const warLabel = viewType === "pitcher" ? "Proj pWAR" : "Proj oWAR";
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(sorted, scope)}>
        <SortableContext items={sorted.map((r) => r.player_id)} strategy={verticalListSortingStrategy}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28px] p-0" />
                <TableHead className="w-[48px] text-center text-[11px]">Rank</TableHead>
                <TableHead className="min-w-[200px]"><SortBtn label="Player" sk="name" active={sortKey === "name"} dir={sortDir} onClick={toggleSort} /></TableHead>
                <TableHead className="text-[11px]">Status</TableHead>
                <TableHead className="text-right"><SortBtn label={warLabel} sk="war" active={sortKey === "war"} dir={sortDir} onClick={toggleSort} align="right" /></TableHead>
                <TableHead className="text-right"><SortBtn label="Market Value" sk="market_value" active={sortKey === "market_value"} dir={sortDir} onClick={toggleSort} align="right" /></TableHead>
                <TableHead className="text-right"><SortBtn label="Asking" sk="asking" active={sortKey === "asking"} dir={sortDir} onClick={toggleSort} align="right" /></TableHead>
                <TableHead className="text-right"><SortBtn label="Willing to Pay" sk="offer" active={sortKey === "offer"} dir={sortDir} onClick={toggleSort} align="right" /></TableHead>
                <TableHead className="text-center text-[11px]">Notes</TableHead>
                <TableHead className="text-right text-[11px]">Action</TableHead>
                <TableHead className="w-[36px] p-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((t, i) => {
                const onRoster = gm.onBuildPlayerIds.has(t.player_id);
                return (
                  <SortableRow key={t.player_id} id={t.player_id}>
                    {({ listeners, attributes, isDragging }) => (
                      <>
                        <TableCell className="w-[28px] p-0 text-center align-middle">
                          <button type="button" {...listeners} {...attributes} className={cn("p-1 cursor-grab touch-none transition-colors", isDragging ? "cursor-grabbing text-[#D4AF37]" : "text-muted-foreground/50 hover:text-foreground")} aria-label="Drag to reorder">
                            <GripVertical className="h-4 w-4" />
                          </button>
                        </TableCell>
                        <TableCell className="w-[48px] text-center align-middle">
                          <span className="inline-flex items-center justify-center min-w-[26px] h-6 px-1.5 rounded-md text-[12px] font-bold tabular-nums text-[#D4AF37] bg-[#D4AF37]/10 ring-1 ring-[#D4AF37]/20">{i + 1}</span>
                        </TableCell>
                        <TableCell className="min-w-[200px] py-1.5">
                          <Link to={`/gm/player/${t.player_id}`} className="font-medium text-sm hover:text-primary hover:underline">{t.name}</Link>
                          <div className="text-[11px] text-muted-foreground">{[t.position, t.team, t.class_year].filter(Boolean).join(" · ") || "—"}</div>
                        </TableCell>
                        <TableCell className="py-1.5">{statBadge(t)}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-sm tabular-nums">{num(t.war, 2)}</TableCell>
                        <TableCell className="py-1.5 text-right font-mono text-sm tabular-nums text-muted-foreground">{money(t.market_value)}</TableCell>
                        <TableCell className="py-1.5 text-right"><MoneyInput value={t.asking} onSave={(n) => saveAsking(t.player_id, n)} /></TableCell>
                        <TableCell className="py-1.5 text-right"><MoneyInput value={t.offer} onSave={(n) => saveOffer(t.player_id, n)} /></TableCell>
                        <TableCell className="py-1.5 text-center">
                          <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition" onClick={() => setNotesFor(t)}>
                            <StickyNote className="h-3.5 w-3.5" />{t.notes.length > 0 && <span className="tabular-nums">{t.notes.length}</span>}
                          </button>
                        </TableCell>
                        <TableCell className="py-1.5 text-right">
                          {onRoster ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400"><Check className="h-3 w-3" /> On Roster</span>
                          ) : (
                            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={gm.isAddingTarget} onClick={() => setConfirmAdd(t)}><Plus className="h-3.5 w-3.5" /> Add to Roster</Button>
                          )}
                        </TableCell>
                        <TableCell className="w-[36px] p-0 text-center">
                          <button onClick={() => setConfirmRemove(t)} className="text-muted-foreground/50 hover:text-rose-400 transition-colors p-1" title="Remove from target board"><Trash2 className="h-3.5 w-3.5" /></button>
                        </TableCell>
                      </>
                    )}
                  </SortableRow>
                );
              })}
            </TableBody>
          </Table>
        </SortableContext>
      </DndContext>
    );
  };

  const activeSet = viewType === "hitter" ? allHitters : allPitchers;

  return (
    <div className="space-y-4">
      {/* Header + toggles */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <TargetIcon className="h-5 w-5 text-[#D4AF37]" />
          <div>
            <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>Target Board</h2>
            <p className="text-xs text-muted-foreground">{targets.length} player{targets.length !== 1 ? "s" : ""}{hitterCount > 0 && pitcherCount > 0 && ` · ${hitterCount} hitter${hitterCount !== 1 ? "s" : ""}, ${pitcherCount} pitcher${pitcherCount !== 1 ? "s" : ""}`} · drag to set priority</p>
          </div>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Add to build</span>
            <Select value={gm.selectedBuildId ?? undefined} onValueChange={(v) => gm.setSelectedBuildId(v)}>
              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Select build" /></SelectTrigger>
              <SelectContent>{gm.builds.map((b) => <SelectItem key={b.id} value={b.id} className="text-xs">{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex gap-1.5">
            <div className="flex gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5">
              {(["hitter", "pitcher"] as const).map((t) => (
                <button key={t} className={cn("px-3 py-1.5 text-xs rounded-md font-medium transition-colors", viewType === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")} onClick={() => setViewType(t)}>
                  {t === "hitter" ? "Hitting" : "Pitching"}
                </button>
              ))}
            </div>
            {viewType === "hitter" && (
              <div className="flex gap-0.5 rounded-lg border border-border/60 bg-muted/30 p-0.5">
                {(["overall", "by-position"] as const).map((m) => (
                  <button key={m} className={cn("px-3 py-1.5 text-xs rounded-md font-medium transition-colors", hitterMode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")} onClick={() => setHitterMode(m)}>
                    {m === "overall" ? "Overall" : "By Position"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or team…" className="pl-9 h-9 text-sm" />
      </div>

      {isLoading ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">Loading targets…</CardContent></Card>
      ) : activeSet.length === 0 ? (
        <Card className="border-border/60"><CardContent className="py-16 text-center text-sm text-muted-foreground">
          {targets.length === 0 ? "No targets yet — add players to the target board from Player Evaluation and they'll show up here." : `No ${viewType === "hitter" ? "hitters" : "pitchers"} match your search.`}
        </CardContent></Card>
      ) : viewType === "pitcher" ? (
        <Card className="border-border/60 overflow-hidden"><CardContent className="p-0"><div className="overflow-x-auto">{renderTable(allPitchers, "pitcher")}</div></CardContent></Card>
      ) : hitterMode === "overall" ? (
        <Card className="border-border/60 overflow-hidden"><CardContent className="p-0"><div className="overflow-x-auto">{renderTable(allHitters, "hitter-overall")}</div></CardContent></Card>
      ) : (
        POSITION_GROUPS.map((g) => {
          const rows = hittersByGroup.get(g) || [];
          if (rows.length === 0) return null;
          const isCollapsed = collapsed.has(g);
          return (
            <Card key={g} className="border-border/60 overflow-hidden">
              <button type="button" onClick={() => setCollapsed((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; })} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors border-b border-border/40">
                {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                <span className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>{GROUP_LABELS[g]}</span>
                <span className="text-[11px] text-muted-foreground ml-1">({rows.length})</span>
              </button>
              {!isCollapsed && <CardContent className="p-0"><div className="overflow-x-auto">{renderTable(rows, `hitter-${g}` as ScopeKey)}</div></CardContent>}
            </Card>
          );
        })
      )}

      <PlayerNotesDialog
        open={!!liveNotesTarget}
        onOpenChange={(o) => { if (!o) setNotesFor(null); }}
        playerName={liveNotesTarget?.name ?? "Player"}
        notes={liveNotesTarget?.notes ?? []}
        onAdd={(body) => { if (liveNotesTarget) addNote(liveNotesTarget.player_id, body); }}
        onRemove={(id) => removeNote(id)}
        subtitle="Scouting or negotiation context. Each note is stamped with the date and who wrote it. Shared with your staff."
      />

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

      <AlertDialog open={!!confirmRemove} onOpenChange={(o) => { if (!o) setConfirmRemove(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirmRemove?.name} from the target board?</AlertDialogTitle>
            <AlertDialogDescription>This removes them from the shared target board for the whole staff — use it when a target commits elsewhere.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-rose-600 hover:bg-rose-700" onClick={() => { if (confirmRemove) removeFromBoard(confirmRemove.player_id); setConfirmRemove(null); }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
