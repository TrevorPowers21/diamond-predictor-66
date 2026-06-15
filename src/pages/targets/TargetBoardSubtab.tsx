import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Target as TargetIcon,
  Search,
  Trash2,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import { useTargetBoard, type TargetBoardRow } from "@/hooks/useTargetBoard";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { applyTeamScopeFilter, pickPreferredPrediction } from "@/lib/teamScopedPredictions";
import { profileRouteFor } from "@/lib/profileRoutes";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ScoutMiniBox — same component used on Returning Players + Historical
// tables. Color-coded 20-80 score with a small label.
const ScoutMiniBox = ({ label, value }: { label: string; value: number | null }) => {
  if (value == null) return null;
  const tier =
    value >= 80
      ? "bg-[hsl(var(--success)/0.15)] text-[hsl(var(--success))]"
      : value >= 50
      ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))]"
      : "bg-destructive/15 text-destructive";
  return (
    <div
      className={`inline-flex min-w-[34px] flex-col items-center rounded px-1 py-0.5 leading-tight ${tier}`}
      title={`${label}: ${value}`}
    >
      <span className="text-[9px] font-semibold">{label}</span>
      <span className="text-[10px] font-bold">{Math.round(value)}</span>
    </div>
  );
};

// Target Board subtab — individual player evaluation, mirrors High Follow
// design. Hitter/Pitcher top toggle + Overall/By Position secondary for
// hitters. Reorder via drag-and-drop on the grip handle.
//
// PERSISTENCE NOTE (2026-06-14): drag order is saved to localStorage
// today as a DEMO ONLY shim so coaches can see the UX. Tomorrow's
// architecture pass converts target_board_picks from per-coach to
// team-shared and stores `priority int` on the row so the order persists
// per team across all coaches. The drag-and-drop component layer doesn't
// change — only the load + save callbacks swap from localStorage to
// supabase mutations.

type GroupKey = "C" | "IF" | "OF";
const POSITION_GROUPS: GroupKey[] = ["C", "IF", "OF"];

const GROUP_LABELS: Record<GroupKey, string> = {
  C: "C Board",
  IF: "IF Board",
  OF: "OF Board",
};

const groupForHitter = (pos: string | null | undefined): GroupKey | null => {
  const p = String(pos || "").toUpperCase().trim();
  if (!p) return null;
  if (p === "C") return "C";
  if (/^(1B|2B|3B|SS|IF|UTL)$/.test(p)) return "IF";
  if (/^(OF|LF|CF|RF|DH)$/.test(p)) return "OF";
  return "IF";
};

const isPitcherTarget = (row: TargetBoardRow) =>
  /^(SP|RP|CL|LHP|RHP|P)$/i.test(String(row.position || "").trim());

type ViewType = "hitter" | "pitcher";
type HitterMode = "overall" | "by-position";

interface ProjectionRow {
  player_id: string;
  variant: string;
  customer_team_id: string | null;
  p_avg: number | null;
  p_obp: number | null;
  p_slg: number | null;
  p_ops: number | null;
  p_wrc_plus: number | null;
  o_war: number | null;
  market_value: number | null;
  p_era: number | null;
  p_fip: number | null;
  p_whip: number | null;
  p_k9: number | null;
  p_bb9: number | null;
  p_rv_plus: number | null;
  p_war: number | null;
  twp_hitter_market_value: number | null;
  twp_pitcher_market_value: number | null;
  pitcher_role: string | null;
  // 20-80 scouting scores — same shape Returning Players renders into
  // ScoutMiniBox tiles. Hitter side uses the first four; pitcher side
  // uses stuff_score / whiff_score / bb_score / barrel_score.
  barrel_score: number | null;
  hitter_barrel_score: number | null;
  pitcher_barrel_score: number | null;
  ev_score: number | null;
  contact_score: number | null;
  chase_score: number | null;
  stuff_score: number | null;
  whiff_score: number | null;
  bb_score: number | null;
}

type HitterSortKey =
  | "manual"
  | "name"
  | "position"
  | "p_avg" | "p_obp" | "p_slg" | "p_ops" | "p_wrc_plus" | "o_war"
  | "market_value";
type PitcherSortKey =
  | "manual"
  | "name"
  | "p_era" | "p_fip" | "p_whip" | "p_k9" | "p_bb9" | "p_rv_plus" | "p_war"
  | "market_value";
type SortDir = "asc" | "desc";

// Local-storage helpers for drag order — keyed per (team, scope) so each
// section (Overall / C / IF / OF / Pitcher) keeps its own manual rank.
// Wholly replaced tomorrow when target_board_picks.priority lands.
const LS_PREFIX = "target-board-order:";
const loadManualOrder = (teamId: string | null, scope: string): string[] => {
  if (!teamId) return [];
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${teamId}:${scope}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
};
const saveManualOrder = (teamId: string | null, scope: string, order: string[]) => {
  if (!teamId) return;
  try {
    localStorage.setItem(`${LS_PREFIX}${teamId}:${scope}`, JSON.stringify(order));
  } catch {
    // localStorage full or blocked — silently skip
  }
};

// Apply a saved order to a list. Players in the saved order come first
// in that order; players not yet ranked land at the end (by original
// position, so newly added rows show up at the bottom by default).
const applyManualOrder = (rows: TargetBoardRow[], order: string[]): TargetBoardRow[] => {
  if (order.length === 0) return rows;
  const indexOf = new Map<string, number>();
  order.forEach((id, i) => indexOf.set(id, i));
  return [...rows].sort((a, b) => {
    const ia = indexOf.has(a.player_id) ? indexOf.get(a.player_id)! : Infinity;
    const ib = indexOf.has(b.player_id) ? indexOf.get(b.player_id)! : Infinity;
    if (ia !== ib) return ia - ib;
    // both unranked → preserve incoming order
    return 0;
  });
};

// ── Sortable row wrapper ──────────────────────────────────────────────
// Renders a single table row that can be picked up by the drag handle.
// dnd-kit drives transform/transition via inline style.

interface SortableRowProps {
  id: string;
  children: (handleProps: { listeners: any; attributes: any; isDragging: boolean }) => React.ReactNode;
}

function SortableRow({ id, children }: SortableRowProps) {
  const { setNodeRef, listeners, attributes, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    position: "relative",
    zIndex: isDragging ? 10 : "auto",
  };
  return (
    <tr ref={setNodeRef} style={style} className="border-b border-[#162241] hover:bg-[#0d1a30]/60">
      {children({ listeners, attributes, isDragging })}
    </tr>
  );
}

// ──────────────────────────────────────────────────────────────────────

export default function TargetBoardSubtab() {
  const { board, isLoading, removePlayer } = useTargetBoard();
  const { effectiveTeamId } = useAuth();
  const [viewType, setViewType] = useState<ViewType>("hitter");
  const [hitterMode, setHitterMode] = useState<HitterMode>("overall");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());

  // Defaults to manual order — so coaches see their drag-ranked board
  // first thing on load. Clicking a stat header overrides to that sort.
  const [hitterSortKey, setHitterSortKey] = useState<HitterSortKey>("manual");
  const [hitterSortDir, setHitterSortDir] = useState<SortDir>("desc");
  const [pitcherSortKey, setPitcherSortKey] = useState<PitcherSortKey>("manual");
  const [pitcherSortDir, setPitcherSortDir] = useState<SortDir>("desc");

  // Manual order state, keyed per scope. Loaded from localStorage on
  // mount + when team changes. DEMO ONLY storage — see top-of-file note.
  type ScopeKey = "hitter-overall" | "hitter-C" | "hitter-IF" | "hitter-OF" | "pitcher";
  const [manualOrders, setManualOrders] = useState<Record<ScopeKey, string[]>>({
    "hitter-overall": [],
    "hitter-C": [],
    "hitter-IF": [],
    "hitter-OF": [],
    "pitcher": [],
  });
  useEffect(() => {
    setManualOrders({
      "hitter-overall": loadManualOrder(effectiveTeamId, "hitter-overall"),
      "hitter-C": loadManualOrder(effectiveTeamId, "hitter-C"),
      "hitter-IF": loadManualOrder(effectiveTeamId, "hitter-IF"),
      "hitter-OF": loadManualOrder(effectiveTeamId, "hitter-OF"),
      "pitcher": loadManualOrder(effectiveTeamId, "pitcher"),
    });
  }, [effectiveTeamId]);

  const playerIds = useMemo(() => board.map((r) => r.player_id), [board]);

  const { data: predictionByPlayerId = new Map<string, ProjectionRow>() } = useQuery({
    queryKey: ["target-board-predictions", playerIds, effectiveTeamId],
    enabled: playerIds.length > 0,
    queryFn: async () => {
      let q = supabase
        .from("player_predictions")
        .select(
          "player_id, variant, customer_team_id, p_avg, p_obp, p_slg, p_ops, p_wrc_plus, o_war, market_value, p_era, p_fip, p_whip, p_k9, p_bb9, p_rv_plus, p_war, twp_hitter_market_value, twp_pitcher_market_value, pitcher_role, barrel_score, hitter_barrel_score, pitcher_barrel_score, ev_score, contact_score, chase_score, stuff_score, whiff_score, bb_score",
        )
        .in("player_id", playerIds)
        .eq("season", PROJECTION_SEASON)
        .in("status", ["active", "departed"])
        .in("variant", ["regular", "precomputed"]);
      q = applyTeamScopeFilter(q as any, effectiveTeamId);
      const { data, error } = await q;
      if (error) throw error;
      const grouped = new Map<string, ProjectionRow[]>();
      for (const row of (data || []) as ProjectionRow[]) {
        const list = grouped.get(row.player_id) || [];
        list.push(row);
        grouped.set(row.player_id, list);
      }
      const out = new Map<string, ProjectionRow>();
      for (const [pid, rows] of grouped.entries()) {
        const picked = pickPreferredPrediction(rows as any[], effectiveTeamId) as ProjectionRow | null;
        if (picked) out.set(pid, picked);
      }
      return out;
    },
  });

  const hitterCount = useMemo(() => board.filter((r) => !isPitcherTarget(r)).length, [board]);
  const pitcherCount = useMemo(() => board.filter(isPitcherTarget).length, [board]);

  const matches = (r: TargetBoardRow) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return `${r.first_name} ${r.last_name} ${r.team || ""}`.toLowerCase().includes(q);
  };

  const allHitters = useMemo(
    () => board.filter((r) => !isPitcherTarget(r) && matches(r)),
    [board, search],
  );
  const allPitchers = useMemo(
    () => board.filter((r) => isPitcherTarget(r) && matches(r)),
    [board, search],
  );
  const hittersByGroup = useMemo(() => {
    const out = new Map<GroupKey, TargetBoardRow[]>();
    for (const row of allHitters) {
      const g = groupForHitter(row.position);
      if (!g) continue;
      const list = out.get(g) || [];
      list.push(row);
      out.set(g, list);
    }
    return out;
  }, [allHitters]);

  const toggleCollapsed = (g: GroupKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  // Sort + manual-order application
  const sortRows = (rows: TargetBoardRow[], side: "hitter" | "pitcher", scope: ScopeKey) => {
    const sk = side === "hitter" ? hitterSortKey : pitcherSortKey;
    const dir = side === "hitter" ? hitterSortDir : pitcherSortDir;
    if (sk === "manual") {
      return applyManualOrder(rows, manualOrders[scope]);
    }
    const mul = dir === "asc" ? 1 : -1;
    const arr = [...rows];
    arr.sort((a, b) => {
      const pa = predictionByPlayerId.get(a.player_id);
      const pb = predictionByPlayerId.get(b.player_id);
      if (sk === "name") {
        return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`) * mul;
      }
      if (sk === "position") {
        return String(a.position || "").localeCompare(String(b.position || "")) * mul;
      }
      if (sk === "market_value") {
        const va = Number(
          (side === "pitcher"
            ? (pa?.twp_pitcher_market_value ?? pa?.market_value)
            : (pa?.twp_hitter_market_value ?? pa?.market_value)) ?? -Infinity,
        );
        const vb = Number(
          (side === "pitcher"
            ? (pb?.twp_pitcher_market_value ?? pb?.market_value)
            : (pb?.twp_hitter_market_value ?? pb?.market_value)) ?? -Infinity,
        );
        return (va - vb) * mul;
      }
      const va = Number((pa as any)?.[sk] ?? -Infinity);
      const vb = Number((pb as any)?.[sk] ?? -Infinity);
      return (va - vb) * mul;
    });
    return arr;
  };

  const toggleHitterSort = (sk: HitterSortKey) => {
    if (hitterSortKey === sk) setHitterSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setHitterSortKey(sk);
      setHitterSortDir(sk === "name" || sk === "position" ? "asc" : "desc");
    }
  };
  const togglePitcherSort = (sk: PitcherSortKey) => {
    if (pitcherSortKey === sk) setPitcherSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setPitcherSortKey(sk);
      setPitcherSortDir(sk === "name" ? "asc" : "desc");
    }
  };

  const HitterSortBtn = ({ label, sk }: { label: string; sk: HitterSortKey }) => (
    <button
      onClick={() => toggleHitterSort(sk)}
      className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6] hover:text-slate-200 transition-colors cursor-pointer"
    >
      {label}
      <ArrowUpDown
        className={cn("h-3 w-3 transition-opacity", hitterSortKey === sk ? "opacity-100 text-[#D4AF37]" : "opacity-40")}
      />
    </button>
  );
  const PitcherSortBtn = ({ label, sk }: { label: string; sk: PitcherSortKey }) => (
    <button
      onClick={() => togglePitcherSort(sk)}
      className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6] hover:text-slate-200 transition-colors cursor-pointer"
    >
      {label}
      <ArrowUpDown
        className={cn("h-3 w-3 transition-opacity", pitcherSortKey === sk ? "opacity-100 text-[#D4AF37]" : "opacity-40")}
      />
    </button>
  );

  // dnd sensors — pointer for mouse, keyboard for accessibility
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (sortedRows: TargetBoardRow[], scope: ScopeKey, side: "hitter" | "pitcher") =>
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = sortedRows.findIndex((r) => r.player_id === active.id);
      const newIndex = sortedRows.findIndex((r) => r.player_id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      const next = arrayMove(sortedRows, oldIndex, newIndex);
      const newOrder = next.map((r) => r.player_id);
      setManualOrders((prev) => ({ ...prev, [scope]: newOrder }));
      saveManualOrder(effectiveTeamId, scope, newOrder);
      // Drag implies "I want manual order" — flip the sort selector to
      // manual so coaches see their drag effect immediately.
      if (side === "hitter") setHitterSortKey("manual");
      else setPitcherSortKey("manual");
    };

  const fmt3 = (n: number | null | undefined) =>
    n == null ? "—" : Number(n).toFixed(3).replace(/^0\./, ".");
  const fmt2 = (n: number | null | undefined) =>
    n == null ? "—" : Number(n).toFixed(2);
  const fmt0 = (n: number | null | undefined) =>
    n == null ? "—" : Math.round(Number(n)).toString();
  const fmtMv = (n: number | null | undefined) =>
    n == null ? "—" : `$${Math.round(Number(n)).toLocaleString()}`;

  const portalBadge = (r: TargetBoardRow) => {
    const label =
      r.portal_status === "IN PORTAL" ? "In Portal" : r.portal_status === "COMMITTED" ? "Committed" : "Watching";
    const color =
      r.portal_status === "IN PORTAL"
        ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/30"
        : r.portal_status === "COMMITTED"
        ? "text-blue-400 bg-blue-500/10 border-blue-500/30"
        : "text-[#D4AF37] bg-[#D4AF37]/10 border-[#D4AF37]/30";
    return (
      <Badge variant="outline" className={`text-[10px] ${color}`}>
        {label}
      </Badge>
    );
  };

  const renderHitterTable = (
    rows: TargetBoardRow[],
    scope: ScopeKey,
  ) => {
    const sorted = sortRows(rows, "hitter", scope);
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(sorted, scope, "hitter")}>
        <SortableContext items={sorted.map((r) => r.player_id)} strategy={verticalListSortingStrategy}>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-[#162241] hover:bg-transparent">
                <TableHead className="w-[28px] p-0"></TableHead>
                <TableHead className="w-[56px] text-center p-0">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Rank</span>
                </TableHead>
                <TableHead className="min-w-[220px] sticky left-[84px] z-10 bg-[#0a1428]">
                  <HitterSortBtn label="Player" sk="name" />
                </TableHead>
                <TableHead>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Status</span>
                </TableHead>
                <TableHead className="text-right"><HitterSortBtn label="AVG" sk="p_avg" /></TableHead>
                <TableHead className="text-right"><HitterSortBtn label="OBP" sk="p_obp" /></TableHead>
                <TableHead className="text-right"><HitterSortBtn label="SLG" sk="p_slg" /></TableHead>
                <TableHead className="text-right"><HitterSortBtn label="OPS" sk="p_ops" /></TableHead>
                <TableHead className="text-right"><HitterSortBtn label="wRC+" sk="p_wrc_plus" /></TableHead>
                <TableHead className="text-right"><HitterSortBtn label="oWAR" sk="o_war" /></TableHead>
                <TableHead className="text-right"><HitterSortBtn label="Market Value" sk="market_value" /></TableHead>
                <TableHead className="text-center min-w-[180px]">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Scouting</span>
                </TableHead>
                <TableHead className="w-[36px] p-0"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r, i) => {
                const pred = predictionByPlayerId.get(r.player_id);
                return (
                  <SortableRow key={r.player_id} id={r.player_id}>
                    {({ listeners, attributes, isDragging }) => (
                      <>
                        <TableCell className="w-[28px] p-0 text-center align-middle">
                          <button
                            type="button"
                            {...listeners}
                            {...attributes}
                            className={cn(
                              "p-1 cursor-grab touch-none transition-colors",
                              isDragging ? "cursor-grabbing text-[#D4AF37]" : "text-[#5a6478] hover:text-slate-300",
                            )}
                            aria-label="Drag to reorder"
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                        </TableCell>
                        <TableCell className="w-[56px] p-0 text-center align-middle">
                          <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-md text-[12px] font-bold tabular-nums text-[#D4AF37] bg-[#D4AF37]/10 ring-1 ring-[#D4AF37]/20">
                            {i + 1}
                          </span>
                        </TableCell>
                        <TableCell className="sticky left-[84px] z-10 bg-[#0a1428] min-w-[220px]">
                          <Link
                            to={profileRouteFor(r.player_id, r.position, r.position)}
                            className="font-medium text-slate-200 hover:text-[#D4AF37] hover:underline transition-colors"
                          >
                            {r.first_name} {r.last_name}
                          </Link>
                          <div className="text-[11px] text-[#8a94a6]">
                            {r.position || "—"} · {r.team || "—"}
                            {r.class_year ? ` · ${r.class_year}` : ""}
                          </div>
                        </TableCell>
                        <TableCell>{portalBadge(r)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt3(pred?.p_avg)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt3(pred?.p_obp)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt3(pred?.p_slg)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt3(pred?.p_ops)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt0(pred?.p_wrc_plus)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt2(pred?.o_war)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">
                          {fmtMv(pred?.twp_hitter_market_value ?? pred?.market_value)}
                        </TableCell>
                        <TableCell className="text-center p-1">
                          <div className="flex gap-0.5 justify-center flex-wrap">
                            {(pred?.hitter_barrel_score ?? pred?.barrel_score) != null && <ScoutMiniBox label="Brl" value={pred?.hitter_barrel_score ?? pred?.barrel_score ?? null} />}
                            {pred?.ev_score != null && <ScoutMiniBox label="EV" value={pred.ev_score} />}
                            {pred?.contact_score != null && <ScoutMiniBox label="Con" value={pred.contact_score} />}
                            {pred?.chase_score != null && <ScoutMiniBox label="Chs" value={pred.chase_score} />}
                          </div>
                        </TableCell>
                        <TableCell className="text-center p-0">
                          <button
                            onClick={() => removePlayer.mutate(r.player_id)}
                            className="text-[#5a6478] hover:text-rose-400 transition-colors p-1 cursor-pointer"
                            title="Remove from target board"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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

  const renderPitcherTable = (rows: TargetBoardRow[]) => {
    const sorted = sortRows(rows, "pitcher", "pitcher");
    return (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd(sorted, "pitcher", "pitcher")}>
        <SortableContext items={sorted.map((r) => r.player_id)} strategy={verticalListSortingStrategy}>
          <Table>
            <TableHeader>
              <TableRow className="border-b border-[#162241] hover:bg-transparent">
                <TableHead className="w-[28px] p-0"></TableHead>
                <TableHead className="w-[56px] text-center p-0">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Rank</span>
                </TableHead>
                <TableHead className="min-w-[220px] sticky left-[84px] z-10 bg-[#0a1428]">
                  <PitcherSortBtn label="Player" sk="name" />
                </TableHead>
                <TableHead>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Status</span>
                </TableHead>
                <TableHead className="text-right"><PitcherSortBtn label="ERA" sk="p_era" /></TableHead>
                <TableHead className="text-right"><PitcherSortBtn label="FIP" sk="p_fip" /></TableHead>
                <TableHead className="text-right"><PitcherSortBtn label="WHIP" sk="p_whip" /></TableHead>
                <TableHead className="text-right"><PitcherSortBtn label="K/9" sk="p_k9" /></TableHead>
                <TableHead className="text-right"><PitcherSortBtn label="BB/9" sk="p_bb9" /></TableHead>
                <TableHead className="text-right"><PitcherSortBtn label="pRV+" sk="p_rv_plus" /></TableHead>
                <TableHead className="text-right"><PitcherSortBtn label="pWAR" sk="p_war" /></TableHead>
                <TableHead className="text-right"><PitcherSortBtn label="Market Value" sk="market_value" /></TableHead>
                <TableHead className="text-center min-w-[180px]">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Scouting</span>
                </TableHead>
                <TableHead className="w-[36px] p-0"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r, i) => {
                const pred = predictionByPlayerId.get(r.player_id);
                return (
                  <SortableRow key={r.player_id} id={r.player_id}>
                    {({ listeners, attributes, isDragging }) => (
                      <>
                        <TableCell className="w-[28px] p-0 text-center align-middle">
                          <button
                            type="button"
                            {...listeners}
                            {...attributes}
                            className={cn(
                              "p-1 cursor-grab touch-none transition-colors",
                              isDragging ? "cursor-grabbing text-[#D4AF37]" : "text-[#5a6478] hover:text-slate-300",
                            )}
                            aria-label="Drag to reorder"
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                        </TableCell>
                        <TableCell className="w-[56px] p-0 text-center align-middle">
                          <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded-md text-[12px] font-bold tabular-nums text-[#D4AF37] bg-[#D4AF37]/10 ring-1 ring-[#D4AF37]/20">
                            {i + 1}
                          </span>
                        </TableCell>
                        <TableCell className="sticky left-[84px] z-10 bg-[#0a1428] min-w-[220px]">
                          <Link
                            to={profileRouteFor(r.player_id, r.position, r.position)}
                            className="font-medium text-slate-200 hover:text-[#D4AF37] hover:underline transition-colors"
                          >
                            {r.first_name} {r.last_name}
                          </Link>
                          <div className="text-[11px] text-[#8a94a6]">
                            {r.position || "—"} · {r.team || "—"}
                            {r.class_year ? ` · ${r.class_year}` : ""}
                          </div>
                        </TableCell>
                        <TableCell>{portalBadge(r)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt2(pred?.p_era)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt2(pred?.p_fip)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt2(pred?.p_whip)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt2(pred?.p_k9)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt2(pred?.p_bb9)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt0(pred?.p_rv_plus)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">{fmt2(pred?.p_war)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-slate-200">
                          {fmtMv(pred?.twp_pitcher_market_value ?? pred?.market_value)}
                        </TableCell>
                        <TableCell className="text-center p-1">
                          <div className="flex gap-0.5 justify-center flex-wrap">
                            {pred?.stuff_score != null && <ScoutMiniBox label="Stf+" value={pred.stuff_score} />}
                            {pred?.whiff_score != null && <ScoutMiniBox label="Whf" value={pred.whiff_score} />}
                            {pred?.bb_score != null && <ScoutMiniBox label="BB%" value={pred.bb_score} />}
                            {(pred?.pitcher_barrel_score ?? pred?.barrel_score) != null && <ScoutMiniBox label="Brl" value={pred?.pitcher_barrel_score ?? pred?.barrel_score ?? null} />}
                          </div>
                        </TableCell>
                        <TableCell className="text-center p-0">
                          <button
                            onClick={() => removePlayer.mutate(r.player_id)}
                            className="text-[#5a6478] hover:text-rose-400 transition-colors p-1 cursor-pointer"
                            title="Remove from target board"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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

  if (isLoading) {
    return <div className="flex items-center justify-center py-16 text-[#8a94a6]">Loading…</div>;
  }

  const activeSet = viewType === "hitter" ? allHitters : allPitchers;
  const isEmpty = activeSet.length === 0;

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto pb-20">
      {/* Header */}
      <div className="rounded-lg border border-[#162241] bg-[#0a1428] px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className="text-xl font-bold tracking-wide uppercase text-[#D4AF37] flex items-center gap-2"
            style={{ fontFamily: "Oswald, sans-serif" }}
          >
            <TargetIcon className="h-5 w-5" />
            Target Board
          </h2>
          <p className="text-[#8a94a6] text-sm mt-0.5">
            {board.length} player{board.length !== 1 ? "s" : ""}
            {hitterCount > 0 && pitcherCount > 0 && (
              <span className="ml-1">
                ({hitterCount} hitter{hitterCount !== 1 ? "s" : ""}, {pitcherCount} pitcher{pitcherCount !== 1 ? "s" : ""})
              </span>
            )}
            <span className="ml-2 text-[10px] text-[#5a6478]">· drag rows to reorder</span>
          </p>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2">
          <div className="flex gap-0.5 rounded-lg border border-[#162241] bg-[#0d1a30] p-0.5">
            {(["hitter", "pitcher"] as const).map((t) => (
              <button
                key={t}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-md font-medium transition-colors duration-150 cursor-pointer",
                  viewType === t ? "bg-[#162241] text-white shadow-sm" : "text-[#8a94a6] hover:text-slate-200",
                )}
                onClick={() => setViewType(t)}
              >
                {t === "hitter" ? "Hitting" : "Pitching"}
              </button>
            ))}
          </div>
          {viewType === "hitter" && (
            <div className="flex gap-0.5 rounded-lg border border-[#162241] bg-[#0d1a30] p-0.5">
              {(["overall", "by-position"] as const).map((m) => (
                <button
                  key={m}
                  className={cn(
                    "px-3 py-1.5 text-xs rounded-md font-medium transition-colors duration-150 cursor-pointer",
                    hitterMode === m ? "bg-[#162241] text-white shadow-sm" : "text-[#8a94a6] hover:text-slate-200",
                  )}
                  onClick={() => setHitterMode(m)}
                >
                  {m === "overall" ? "Overall" : "By Position"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5a6478]" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or team..."
          className="pl-9 h-9 text-sm border-[#162241] bg-[#0a1428] text-slate-200 placeholder:text-[#5a6478]"
        />
      </div>

      {isEmpty ? (
        <Card className="border-[#162241] bg-[#0a1428]">
          <CardContent className="py-16 text-center text-[#8a94a6]">
            {board.length === 0
              ? "No players on your target board yet. Add players from the Player Dashboard, the Player Profile, or the Team Builder target search."
              : `No ${viewType === "hitter" ? "hitters" : "pitchers"} match your search.`}
          </CardContent>
        </Card>
      ) : viewType === "pitcher" ? (
        <Card className="border-[#162241] bg-[#0a1428] overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
              {renderPitcherTable(allPitchers)}
            </div>
          </CardContent>
        </Card>
      ) : hitterMode === "overall" ? (
        <Card className="border-[#162241] bg-[#0a1428] overflow-hidden">
          <CardContent className="p-0">
            <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
              {renderHitterTable(allHitters, "hitter-overall")}
            </div>
          </CardContent>
        </Card>
      ) : (
        POSITION_GROUPS.map((g) => {
          const rows = hittersByGroup.get(g) || [];
          if (rows.length === 0) return null;
          const isCollapsed = collapsed.has(g);
          const scopeKey: ScopeKey = `hitter-${g}` as ScopeKey;
          return (
            <Card key={g} className="border-[#162241] bg-[#0a1428] overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCollapsed(g)}
                className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-[#0d1a30]/40 transition-colors border-b border-[#162241]"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4 text-[#8a94a6]" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-[#8a94a6]" />
                )}
                <span
                  className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]"
                  style={{ fontFamily: "'Oswald', sans-serif" }}
                >
                  {GROUP_LABELS[g]}
                </span>
                <span className="text-[11px] text-[#8a94a6] ml-1">
                  ({rows.length})
                </span>
              </button>
              {!isCollapsed && (
                <CardContent className="p-0">
                  <div
                    className="overflow-x-auto [&::-webkit-scrollbar]:hidden"
                    style={{ scrollbarWidth: "none" }}
                  >
                    {renderHitterTable(rows, scopeKey)}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
