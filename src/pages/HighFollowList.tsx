import { useState, useMemo, useCallback } from "react";
import { Link } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, X, ArrowUpDown, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHighFollow, type HighFollowRow } from "@/hooks/useHighFollow";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { profileRouteFor } from "@/lib/profileRoutes";
import {
  ScoutingReportProvider,
  PlayerSelectCheckbox,
  DownloadReportBar,
  type ReportPlayer,
} from "@/components/ScoutingReport";

// ── Helpers ─────────────────────────────────────────────────────────

const statFmt = (v: number | null | undefined, d = 3) => {
  if (v == null) return "—";
  return Number(v).toFixed(d);
};
const pctFmt = (v: number | null | undefined) => (v == null ? "—" : String(Math.round(Number(v))));
const moneyFmt = (v: number | null | undefined) => {
  if (v == null) return "—";
  return `$${Math.round(Number(v)).toLocaleString()}`;
};

type SortKey = "name" | "position" | "team" | "type" | "added_at" |
  "p_avg" | "p_obp" | "p_slg" | "p_ops" | "p_iso" | "p_wrc_plus" | "owar" | "nil" |
  "p_era" | "p_fip" | "p_whip" | "p_k9" | "p_bb9" | "p_hr9" | "p_rv_plus" | "p_war";
type SortDir = "asc" | "desc";

interface MergedRow {
  hf: HighFollowRow;
  hitter: any | null;
  pitcher: any | null;
  pred: any | null;
}

// ── Scouting mini box ───────────────────────────────────────────────

function ScoutMini({ label, value }: { label: string; value: number | null | undefined }) {
  if (value == null) return null;
  const v = Number(value);
  const tier =
    v >= 80
      ? "bg-[hsl(142,71%,45%,0.12)] text-[hsl(142,71%,35%)] border-[hsl(142,71%,45%,0.25)]"
      : v >= 50
        ? "bg-[hsl(var(--warning)/0.15)] text-[hsl(var(--warning))] border-[hsl(var(--warning)/0.3)]"
        : "bg-[hsl(0,72%,51%,0.12)] text-[hsl(0,72%,41%)] border-[hsl(0,72%,51%,0.25)]";
  return (
    <div className={`inline-flex min-w-[32px] flex-col items-center rounded border px-1 py-0.5 leading-tight ${tier}`} title={`${label}: ${Math.round(v)}`}>
      <span className="text-[8px] font-semibold uppercase tracking-wider">{label}</span>
      <span className="text-[10px] font-bold tabular-nums">{Math.round(v)}</span>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────

export default function HighFollowList() {
  const { list, isLoading, removePlayer } = useHighFollow();
  const [search, setSearch] = useState("");
  const [positionFilters, setPositionFilters] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<"hitter" | "pitcher">("hitter");
  const [sortKey, setSortKey] = useState<SortKey>("added_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const togglePosition = useCallback((pos: string) => {
    setPositionFilters((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  }, []);

  const playerIds = useMemo(() => list.map((r) => r.player_id), [list]);
  const sourceIds = useMemo(() => list.map((r) => r.source_player_id).filter(Boolean) as string[], [list]);

  const { data: hitterRows = [] } = useQuery({
    queryKey: ["hf-hitter-master", sourceIds],
    enabled: sourceIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("Hitter Master").select("*").in("source_player_id", sourceIds).eq("Season", 2025);
      return data || [];
    },
  });

  const { data: pitcherRows = [] } = useQuery({
    queryKey: ["hf-pitcher-master", sourceIds],
    enabled: sourceIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("Pitching Master").select("*").in("source_player_id", sourceIds).eq("Season", 2025);
      return data || [];
    },
  });

  const { data: predictions = [] } = useQuery({
    queryKey: ["hf-predictions", playerIds],
    enabled: playerIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("player_predictions").select("*").in("player_id", playerIds).eq("status", "active");
      return data || [];
    },
  });

  const hitterMap = useMemo(() => { const m = new Map<string, any>(); for (const r of hitterRows) m.set(r.source_player_id, r); return m; }, [hitterRows]);
  const pitcherMap = useMemo(() => { const m = new Map<string, any>(); for (const r of pitcherRows) m.set(r.source_player_id, r); return m; }, [pitcherRows]);
  const predMap = useMemo(() => { const m = new Map<string, any>(); for (const r of predictions) m.set(r.player_id, r); return m; }, [predictions]);

  const merged: MergedRow[] = useMemo(() => list.map((hf) => ({
    hf,
    hitter: hf.source_player_id ? hitterMap.get(hf.source_player_id) || null : null,
    pitcher: hf.source_player_id ? pitcherMap.get(hf.source_player_id) || null : null,
    pred: predMap.get(hf.player_id) || null,
  })), [list, hitterMap, pitcherMap, predMap]);

  const filtered = useMemo(() => {
    let rows = merged;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) => `${r.hf.first_name} ${r.hf.last_name}`.toLowerCase().includes(q) || (r.hf.team || "").toLowerCase().includes(q));
    }
    if (typeFilter !== "all") rows = rows.filter((r) => r.hf.player_type === typeFilter);
    if (positionFilters.size > 0) {
      rows = rows.filter((r) => {
        const p = (r.hf.position || "").toUpperCase();
        return positionFilters.has(p);
      });
    }
    return rows;
  }, [merged, search, typeFilter, positionFilters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: any, bv: any;
      switch (sortKey) {
        case "name": av = `${a.hf.first_name} ${a.hf.last_name}`; bv = `${b.hf.first_name} ${b.hf.last_name}`; break;
        case "position": av = a.hf.position || ""; bv = b.hf.position || ""; break;
        case "team": av = a.hf.team || ""; bv = b.hf.team || ""; break;
        case "type": av = a.hf.player_type; bv = b.hf.player_type; break;
        case "added_at": av = a.hf.added_at; bv = b.hf.added_at; break;
        case "p_avg": av = a.pred?.p_avg ?? -999; bv = b.pred?.p_avg ?? -999; break;
        case "p_obp": av = a.pred?.p_obp ?? -999; bv = b.pred?.p_obp ?? -999; break;
        case "p_slg": av = a.pred?.p_slg ?? -999; bv = b.pred?.p_slg ?? -999; break;
        case "p_ops": av = (a.pred?.p_obp ?? 0) + (a.pred?.p_slg ?? 0); bv = (b.pred?.p_obp ?? 0) + (b.pred?.p_slg ?? 0); break;
        case "p_iso": av = (a.pred?.p_slg ?? 0) - (a.pred?.p_avg ?? 0); bv = (b.pred?.p_slg ?? 0) - (b.pred?.p_avg ?? 0); break;
        case "p_wrc_plus": av = a.pred?.p_wrc_plus ?? -999; bv = b.pred?.p_wrc_plus ?? -999; break;
        case "owar": av = a.pred?.p_wrc_plus ?? -999; bv = b.pred?.p_wrc_plus ?? -999; break;
        case "nil": av = a.pred?.nil_value ?? -999; bv = b.pred?.nil_value ?? -999; break;
        case "p_era": av = a.pitcher?.ERA ?? 999; bv = b.pitcher?.ERA ?? 999; break;
        case "p_fip": av = a.pitcher?.FIP ?? 999; bv = b.pitcher?.FIP ?? 999; break;
        case "p_whip": av = a.pitcher?.WHIP ?? 999; bv = b.pitcher?.WHIP ?? 999; break;
        case "p_k9": av = a.pitcher?.K9 ?? -999; bv = b.pitcher?.K9 ?? -999; break;
        case "p_bb9": av = a.pitcher?.BB9 ?? 999; bv = b.pitcher?.BB9 ?? 999; break;
        case "p_hr9": av = a.pitcher?.HR9 ?? 999; bv = b.pitcher?.HR9 ?? 999; break;
        case "p_rv_plus": av = a.pitcher?.overall_pr_plus ?? -999; bv = b.pitcher?.overall_pr_plus ?? -999; break;
        case "p_war": av = a.pred?.p_war ?? -999; bv = b.pred?.p_war ?? -999; break;
        default: av = a.hf.added_at; bv = b.hf.added_at;
      }
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortBtn = ({ label, sk }: { label: string; sk: SortKey }) => (
    <button onClick={() => toggleSort(sk)} className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold uppercase tracking-wider cursor-pointer transition-colors", sortKey === sk ? "text-[#D4AF37]" : "text-[#8a94a6] hover:text-slate-200")}>
      {label}<ArrowUpDown className="h-2.5 w-2.5" />
    </button>
  );

  // All unique positions across both types
  const positions = useMemo(() => {
    const s = new Set<string>();
    for (const r of merged) {
      const p = (r.hf.position || "").toUpperCase();
      if (p) s.add(p);
    }
    return Array.from(s).sort();
  }, [merged]);

  const toReportPlayer = (r: MergedRow): ReportPlayer => {
    const isP = r.hf.player_type === "pitcher";
    return {
      id: r.hf.player_id, player_type: r.hf.player_type,
      name: `${r.hf.first_name} ${r.hf.last_name}`, school: r.hf.team,
      position: r.hf.position, class_year: r.hf.class_year,
      ...(!isP && r.pred ? { p_avg: r.pred.p_avg, p_obp: r.pred.p_obp, p_slg: r.pred.p_slg, p_ops: r.pred.p_ops, p_iso: r.pred.p_iso, p_wrc_plus: r.pred.p_wrc_plus, barrel_score: r.pred.barrel_score, ev_score: r.pred.ev_score, contact_score: r.pred.contact_score, chase_score: r.pred.chase_score } : {}),
      ...(isP && r.pitcher ? { p_era: r.pitcher.ERA, p_fip: r.pitcher.FIP, p_whip: r.pitcher.WHIP, p_k9: r.pitcher.K9, p_bb9: r.pitcher.BB9, p_hr9: r.pitcher.HR9, stuff_score: r.pitcher.stuff_plus, whiff_score: r.pitcher.whiff_score, bb_score: r.pitcher.bb_score, barrel_score: r.pitcher.barrel_score } : {}),
    };
  };

  const hitterCount = list.filter((r) => r.player_type === "hitter").length;
  const pitcherCount = list.filter((r) => r.player_type === "pitcher").length;

  return (
    <DashboardLayout>
      <ScoutingReportProvider>
        <div className="space-y-4 max-w-[1600px] mx-auto pb-20">
          {/* Header */}
          <div className="rounded-lg border border-[#162241] bg-[#0a1428] px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold tracking-wide uppercase text-[#D4AF37] flex items-center gap-2" style={{ fontFamily: "Oswald, sans-serif" }}>
                <Star className="h-5 w-5" />
                High Follow List
              </h2>
              <p className="text-[#8a94a6] text-sm mt-0.5">
                {list.length} player{list.length !== 1 ? "s" : ""}
                {hitterCount > 0 && pitcherCount > 0 && (
                  <span className="ml-1">({hitterCount} hitter{hitterCount !== 1 ? "s" : ""}, {pitcherCount} pitcher{pitcherCount !== 1 ? "s" : ""})</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5 rounded-lg border border-[#162241] bg-[#0d1a30] p-0.5">
                {(["hitter", "pitcher"] as const).map((t) => (
                  <button
                    key={t}
                    className={cn("px-3 py-1.5 text-xs rounded-md font-medium transition-colors duration-150 cursor-pointer", typeFilter === t ? "bg-[#162241] text-white shadow-sm" : "text-[#8a94a6] hover:text-slate-200")}
                    onClick={() => setTypeFilter(t)}
                  >
                    {t === "hitter" ? "Hitting" : "Pitching"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Search + Position Filters */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5a6478]" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or team..."
                className="pl-9 h-9 text-sm border-[#162241] bg-[#0a1428] text-slate-200 placeholder:text-[#5a6478]"
              />
            </div>
            {positions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 items-center">
                <button
                  onClick={() => setPositionFilters(new Set())}
                  className={cn(
                    "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                    positionFilters.size === 0
                      ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/30"
                      : "bg-[#0d1a30] text-[#8a94a6] hover:text-slate-200"
                  )}
                >
                  All
                </button>
                {positions.map((pos) => (
                  <button
                    key={pos}
                    onClick={() => togglePosition(pos)}
                    className={cn(
                      "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                      positionFilters.has(pos)
                        ? "bg-[#D4AF37]/15 text-[#D4AF37] ring-1 ring-[#D4AF37]/30"
                        : "bg-[#0d1a30] text-[#8a94a6] hover:text-slate-200"
                    )}
                  >
                    {pos}
                  </button>
                ))}
                {positionFilters.size > 1 && (
                  <span className="text-[10px] text-[#5a6478] ml-1">{positionFilters.size} selected</span>
                )}
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-[#8a94a6]">Loading...</div>
          ) : sorted.length === 0 ? (
            <Card className="border-[#162241] bg-[#0a1428]">
              <CardContent className="py-16 text-center text-[#8a94a6]">
                {list.length === 0
                  ? "No players on your High Follow list yet. Select players from the Player Dashboard and click \"High Follow\"."
                  : "No players match your filters."}
              </CardContent>
            </Card>
          ) : (
            <Card className="border-[#162241] bg-[#0a1428] overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-b border-[#162241] hover:bg-transparent">
                        <TableHead className="w-[32px] p-1"></TableHead>
                        <TableHead className="min-w-[160px] sticky left-0 z-10 bg-[#0a1428]"><SortBtn label="Player" sk="name" /></TableHead>
                        <TableHead className="text-right"><SortBtn label="AVG" sk="p_avg" /></TableHead>
                        <TableHead className="text-right"><SortBtn label="OBP" sk="p_obp" /></TableHead>
                        <TableHead className="text-right"><SortBtn label="SLG" sk="p_slg" /></TableHead>
                        <TableHead className="text-right"><SortBtn label="OPS" sk="p_ops" /></TableHead>
                        <TableHead className="text-right"><SortBtn label="wRC+" sk="p_wrc_plus" /></TableHead>
                        <TableHead className="text-center min-w-[140px]"><span className="text-[11px] font-semibold uppercase tracking-wider text-[#8a94a6]">Scouting</span></TableHead>
                        <TableHead className="w-[36px] p-0"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sorted.map((r, i) => {
                        const isP = r.hf.player_type === "pitcher";
                        const pred = r.pred;
                        const pm = r.pitcher;
                        const hm = r.hitter;
                        const profileRoute = isP
                          ? `/dashboard/pitcher/storage__${encodeURIComponent(r.hf.first_name + " " + r.hf.last_name)}__${encodeURIComponent(r.hf.team || "")}`
                          : profileRouteFor(r.hf.player_id, r.hf.position);

                        // Resolve stats: projected first, then actual from master tables
                        const avg = isP ? pm?.ERA : (pred?.p_avg ?? hm?.AVG);
                        const obp = isP ? pm?.FIP : (pred?.p_obp ?? hm?.OBP);
                        const slg = isP ? pm?.WHIP : (pred?.p_slg ?? hm?.SLG);
                        const ops = isP ? pm?.K9 : ((pred?.p_obp ?? hm?.OBP ?? 0) + (pred?.p_slg ?? hm?.SLG ?? 0)) || null;
                        const wrc = isP ? (pm?.overall_pr_plus) : (pred?.p_wrc_plus ?? hm?.wrc_plus);

                        // Labels change for pitchers in all mode
                        const fmtD = isP ? 2 : 3;
                        const fmtK = isP ? 1 : 3;

                        return (
                          <TableRow
                            key={r.hf.id}
                            className={cn("border-b border-[#162241]/60 transition-colors duration-150 hover:bg-[#162241]/40", i % 2 === 1 ? "bg-[#0d1a30]" : "")}
                          >
                            <TableCell className="p-1 text-center">
                              <PlayerSelectCheckbox player={toReportPlayer(r)} />
                            </TableCell>
                            <TableCell className="sticky left-0 z-10" style={{ backgroundColor: i % 2 === 1 ? "#0d1a30" : "#0a1428" }}>
                              <Link to={profileRoute} className="font-semibold text-slate-100 hover:text-[#D4AF37] transition-colors duration-150">
                                {r.hf.first_name} {r.hf.last_name}
                              </Link>
                              <div className="text-[11px] text-[#8a94a6]">
                                {[r.hf.position, r.hf.team].filter(Boolean).join(" · ")}
                              </div>
                            </TableCell>

                            {/* Stat cells — hitters: AVG/OBP/SLG/OPS/wRC+, pitchers: ERA/FIP/WHIP/K9/pRV+ */}
                            {isP ? (
                              <>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{pm ? statFmt(pm.ERA, 2) : "—"}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{pm ? statFmt(pm.FIP, 2) : "—"}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{pm ? statFmt(pm.WHIP, 2) : "—"}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{pm ? statFmt(pm.K9, 1) : "—"}</TableCell>
                                <TableCell className="text-right tabular-nums text-white text-sm font-semibold">{pm?.overall_pr_plus != null ? pctFmt(pm.overall_pr_plus) : "—"}</TableCell>
                              </>
                            ) : (
                              <>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{statFmt(pred?.p_avg ?? hm?.AVG)}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{statFmt(pred?.p_obp ?? hm?.OBP)}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">{statFmt(pred?.p_slg ?? hm?.SLG)}</TableCell>
                                <TableCell className="text-right tabular-nums text-slate-200 text-sm">
                                  {(() => {
                                    const o = pred?.p_obp ?? hm?.OBP;
                                    const s = pred?.p_slg ?? hm?.SLG;
                                    return o != null && s != null ? statFmt(Number(o) + Number(s)) : "—";
                                  })()}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-white text-sm font-semibold">{pctFmt(pred?.p_wrc_plus ?? hm?.wrc_plus)}</TableCell>
                              </>
                            )}

                            {/* Scouting */}
                            <TableCell className="text-center">
                              <div className="flex gap-0.5 justify-center flex-wrap">
                                {isP ? (
                                  <>
                                    <ScoutMini label="Stf+" value={pm?.stuff_plus} />
                                    <ScoutMini label="Whf" value={pm?.whiff_score} />
                                    <ScoutMini label="BB" value={pm?.bb_score} />
                                    <ScoutMini label="Brl" value={pm?.barrel_score} />
                                  </>
                                ) : (
                                  <>
                                    <ScoutMini label="Brl" value={pred?.barrel_score ?? hm?.barrel_score} />
                                    <ScoutMini label="EV" value={pred?.ev_score ?? hm?.avg_ev_score} />
                                    <ScoutMini label="Con" value={pred?.contact_score ?? hm?.contact_score} />
                                    <ScoutMini label="Chs" value={pred?.chase_score ?? hm?.chase_score} />
                                  </>
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="p-1 text-center">
                              <button
                                onClick={() => removePlayer(r.hf.player_id)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[#8a94a6] hover:bg-red-500/10 hover:text-red-400 transition-colors duration-150 cursor-pointer"
                                title="Remove from High Follow"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {sorted.length > 0 && (
            <div className="text-xs text-[#5a6478] text-right">
              Showing {sorted.length} of {list.length} player{list.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
        <DownloadReportBar />
      </ScoutingReportProvider>
    </DashboardLayout>
  );
}
