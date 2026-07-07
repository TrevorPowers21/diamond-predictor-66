import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useGmRoster, type GmRow } from "@/gm/hooks/useGmRoster";
import { useWarBenchmarks, useTeamWarSnapshot, useNationalSeedBenchmark, type TeamWarSnapshot, type WarStatRange } from "@/hooks/useTeamWarSnapshots";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, Gauge, Percent, Users, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const money0 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d));

/** Roster position → spend group. Pitchers carry SP/RP; hitters their slot. */
function payGroup(pos: string | null | undefined): string {
  const p = (pos || "").toUpperCase();
  if (p === "C") return "Catcher";
  if (["1B", "3B"].includes(p)) return "Corner Infield";
  if (["2B", "SS"].includes(p)) return "Middle Infield";
  if (["LF", "CF", "RF", "OF"].includes(p)) return "Outfield";
  if (["DH", "UTL", "UT", "UTIL"].includes(p)) return "DH / Utility";
  if (p === "SP") return "Starters";
  if (["RP", "CL", "RHP", "LHP", "P"].includes(p)) return "Relievers";
  return "Other";
}
const GROUP_ORDER = ["Catcher", "Corner Infield", "Middle Infield", "Outfield", "DH / Utility", "Starters", "Relievers", "Other"];

function Tile({ label, value, sub, icon, accent }: { label: string; value: string; sub?: string; icon: React.ReactNode; accent?: "gold" | "blue" | "emerald" | "red" }) {
  const color = accent === "gold" ? "text-[#D4AF37]" : accent === "blue" ? "text-blue-400" : accent === "emerald" ? "text-emerald-400" : accent === "red" ? "text-red-400" : "text-white";
  return (
    <div className="px-4 py-3 flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <span className="text-slate-500">{icon}</span>{label}
      </span>
      <span className={cn("text-xl font-bold tabular-nums", color)} style={OSWALD}>{value}</span>
      {sub && <span className="text-[10px] text-slate-500">{sub}</span>}
    </div>
  );
}

export default function GMAnalytics() {
  const gm = useGmRoster();
  const { effectiveTeamId, availableTeams } = useAuth();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (g: string) => setExpanded((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });

  const roster = useMemo(() => [...gm.hitters, ...gm.pitchers], [gm.hitters, gm.pitchers]);
  const totalPay = roster.reduce((s, r) => s + (r.nil_value ?? 0), 0);
  const totalWar = roster.reduce((s, r) => s + (r.war ?? 0), 0);
  const payPerWin = totalWar > 0 ? totalPay / totalWar : null;
  // Top-5 pay concentration: share of committed pay in the 5 highest-paid.
  const top5Pay = [...roster].sort((a, b) => (b.nil_value ?? 0) - (a.nil_value ?? 0)).slice(0, 5).reduce((s, r) => s + (r.nil_value ?? 0), 0);
  const concentration = totalPay > 0 ? Math.round((top5Pay / totalPay) * 100) : null;
  // Average committed pay per roster spot.
  const paidCount = roster.filter((r) => (r.nil_value ?? 0) > 0).length;
  const avgPay = paidCount > 0 ? totalPay / paidCount : null;

  // Build WAR split for the benchmark comparison (top-9 lineup / SP / RP).
  const rotationPwar = gm.pitchers.filter((p) => (p.position || "").toUpperCase() === "SP").reduce((s, r) => s + (r.war ?? 0), 0);
  const bullpenPwar = gm.pitchers.filter((p) => (p.position || "").toUpperCase() !== "SP").reduce((s, r) => s + (r.war ?? 0), 0);
  const lineupOwar = gm.hitters.slice(0, 9).reduce((s, r) => s + (r.war ?? 0), 0); // gm.hitters is sorted by WAR desc

  // Team's source_team_id + conference (Teams Table) to key the WAR benchmarks.
  const schoolTeamId = availableTeams.find((t) => t.id === effectiveTeamId)?.school_team_id ?? null;
  const { data: teamMeta } = useQuery({
    queryKey: ["gm-team-meta", schoolTeamId],
    enabled: !!schoolTeamId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("Teams Table").select("source_id, conference").eq("id", schoolTeamId).maybeSingle();
      return { sourceTeamId: data?.source_id != null ? String(data.source_id) : null, conference: (data?.conference as string | null) ?? null };
    },
  });
  const { data: priorYearSnapshot } = useTeamWarSnapshot(teamMeta?.sourceTeamId ?? null, CURRENT_SEASON);
  const { data: warBenchmarks = [] } = useWarBenchmarks(CURRENT_SEASON);
  const { data: nationalSeedBenchmark } = useNationalSeedBenchmark(CURRENT_SEASON, "1-8");
  const conferenceChampBenchmarks = useMemo(
    () => (teamMeta?.conference ? warBenchmarks.filter((b) => b.is_conference_champ && b.conference === teamMeta.conference) : []),
    [warBenchmarks, teamMeta?.conference],
  );

  // Pay by position group — with the players in each group for the dropdown.
  const byGroup = useMemo(() => {
    const map = new Map<string, { pay: number; war: number; players: GmRow[] }>();
    for (const r of roster) {
      const g = payGroup(r.position);
      const e = map.get(g) ?? { pay: 0, war: 0, players: [] };
      e.pay += r.nil_value ?? 0;
      e.war += r.war ?? 0;
      e.players.push(r);
      map.set(g, e);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => {
      const e = map.get(g)!;
      return { group: g, pay: e.pay, war: e.war, count: e.players.length, players: [...e.players].sort((a, b) => (b.war ?? 0) - (a.war ?? 0)) };
    });
  }, [roster]);

  // Cost efficiency per player ($/projected win). Players with no WAR can't be
  // priced per win — sorted to the bottom.
  const efficiency = useMemo(() => {
    return roster
      .map((r) => ({ row: r, perWin: (r.war ?? 0) > 0 && (r.nil_value ?? 0) > 0 ? (r.nil_value as number) / (r.war as number) : null }))
      .filter((x) => (x.row.nil_value ?? 0) > 0)
      .sort((a, b) => (a.perWin ?? Infinity) - (b.perWin ?? Infinity));
  }, [roster]);

  const bestValue = efficiency.filter((x) => x.perWin != null).slice(0, 5);
  const priciest = efficiency.filter((x) => x.perWin != null).slice(-5).reverse();

  const rowLine = (x: { row: GmRow; perWin: number | null }) => (
    <TableRow key={x.row.build_player_id}>
      <TableCell className="py-1.5 text-sm font-medium">{x.row.name}</TableCell>
      <TableCell className="py-1.5 text-center text-xs text-muted-foreground">{x.row.position || "—"}</TableCell>
      <TableCell className="py-1.5 text-center font-mono text-sm tabular-nums">{num(x.row.war)}</TableCell>
      <TableCell className="py-1.5 text-right font-mono text-sm tabular-nums pr-3">{money(x.row.nil_value)}</TableCell>
      <TableCell className="py-1.5 text-right font-mono text-sm font-semibold tabular-nums pr-4">{money0(x.perWin)}</TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>Program Analytics</h2>
        <p className="text-sm text-muted-foreground">{gm.teamName ?? "Front Office"} · Season {gm.season} · pay &amp; budget analysis</p>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 rounded-lg border border-[#162241] bg-[#0a1428] divide-x divide-[#162241]">
        <Tile label="Committed Pay" value={money(totalPay)} icon={<DollarSign className="h-3.5 w-3.5" />} accent="blue" />
        <Tile label="$ / Projected Win" value={money0(payPerWin)} sub="pay per WAR" icon={<Gauge className="h-3.5 w-3.5" />} accent="gold" />
        <Tile label="Top-5 Pay Share" value={concentration == null ? "—" : `${concentration}%`} sub="of committed pay" icon={<Percent className="h-3.5 w-3.5" />} />
        <Tile label="Avg $ / Player" value={money0(avgPay)} sub="paid players" icon={<Users className="h-3.5 w-3.5" />} />
      </div>

      {/* WAR Comparison — same design as Team Builder: hero + benchmark table
          (vs last season · conference champion · national seed range). */}
      {(() => {
        type BenchRow =
          | { kind: "team"; label: string; sublabel?: string; bench: TeamWarSnapshot }
          | { kind: "range"; label: string; sublabel?: string; range: { total: WarStatRange | null; lineup: WarStatRange | null; rotation: WarStatRange | null; bullpen: WarStatRange | null } };
        const rows: BenchRow[] = [];
        if (priorYearSnapshot) rows.push({ kind: "team", label: `${CURRENT_SEASON} Actual — ${priorYearSnapshot.team_name}`, sublabel: "your program last season", bench: priorYearSnapshot });
        for (const c of conferenceChampBenchmarks) rows.push({ kind: "team", label: `${CURRENT_SEASON} ${c.conference} Champion — ${c.team_name}`, sublabel: conferenceChampBenchmarks.length > 1 ? "split regular-season champ" : undefined, bench: c });
        if (nationalSeedBenchmark?.totalWar) rows.push({ kind: "range", label: `${CURRENT_SEASON} National Seed Range (1-8)`, sublabel: "min – max across the top 8 seeds", range: { total: nationalSeedBenchmark.totalWar, lineup: nationalSeedBenchmark.lineupOwar, rotation: nationalSeedBenchmark.rotationPwar, bullpen: nationalSeedBenchmark.bullpenPwar } });

        const priorTotal = priorYearSnapshot ? Number(priorYearSnapshot.prorated_total_owar) + Number(priorYearSnapshot.prorated_total_pwar) : null;
        const yoyDelta = priorTotal != null ? totalWar - priorTotal : null;
        const deltaCell = (build: number, bench: number) => {
          const diff = build - bench, abs = Math.abs(diff);
          const color = abs < 0.05 ? "text-muted-foreground" : diff > 0 ? "text-emerald-500" : "text-red-500";
          return <span className={cn("tabular-nums font-semibold", color)}>{diff > 0 ? "+" : diff < 0 ? "−" : ""}{abs.toFixed(2)}</span>;
        };
        const rangeText = (r: WarStatRange | null) => (!r ? <span className="text-muted-foreground">—</span> : (
          <div className="leading-tight"><div className="tabular-nums font-medium">{r.min.toFixed(2)}–{r.max.toFixed(2)}</div><div className="text-[10px] text-muted-foreground tabular-nums">med {r.median.toFixed(2)}</div></div>
        ));
        const rangeDelta = (build: number, r: WarStatRange | null) => {
          if (!r) return <span className="text-muted-foreground">—</span>;
          if (build >= r.min && build <= r.max) return <span className="tabular-nums font-semibold text-emerald-500">in range</span>;
          const diff = build - r.median, abs = Math.abs(diff);
          return <div className="leading-tight"><div className={cn("tabular-nums font-semibold", diff > 0 ? "text-muted-foreground" : "text-red-500")}>{diff > 0 ? "+" : "−"}{abs.toFixed(2)}</div><div className="text-[10px] text-muted-foreground">vs med</div></div>;
        };

        return (
          <Card className="border-l-[3px] border-l-[#D4AF37]">
            <CardHeader className="pb-3">
              <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>WAR Comparison — {gm.teamName ?? "Front Office"} {PROJECTION_SEASON} Build</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-5 px-4 py-3 rounded-md bg-card/40 border-l-[3px] border-l-[#D4AF37]">
                <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Total WAR</div>
                <div className="flex items-baseline gap-3 mt-1 flex-wrap">
                  <span className="text-4xl font-bold tabular-nums text-[#D4AF37]" style={OSWALD}>{totalWar.toFixed(2)}</span>
                  {yoyDelta != null && (
                    <span className={cn("text-sm font-semibold tabular-nums", Math.abs(yoyDelta) < 0.05 ? "text-muted-foreground" : yoyDelta > 0 ? "text-emerald-500" : "text-red-500")}>{yoyDelta > 0 ? "+" : yoyDelta < 0 ? "−" : ""}{Math.abs(yoyDelta).toFixed(2)} vs {CURRENT_SEASON}</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[{ l: "Lineup oWAR", v: lineupOwar }, { l: "Rotation pWAR", v: rotationPwar }, { l: "Bullpen pWAR", v: bullpenPwar }].map((x) => (
                  <div key={x.l} className="rounded-md border border-border/40 border-l-[3px] border-l-[#D4AF37]/60 bg-card/40 px-4 py-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{x.l}</div>
                    <div className="text-2xl font-bold tabular-nums mt-1" style={OSWALD}>{x.v.toFixed(2)}</div>
                  </div>
                ))}
              </div>
              {rows.length === 0 ? (
                <div className="text-sm text-muted-foreground">No benchmarks on file for {gm.teamName ?? "this team"} yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="text-left py-2 pr-4">Compare vs</th>
                        <th className="text-center py-2 px-4 w-[140px] whitespace-nowrap">Goal Total</th>
                        <th className="text-center py-2 px-4 w-[110px] whitespace-nowrap">Δ Total</th>
                        <th className="text-center py-2 px-4 w-[110px] whitespace-nowrap">Δ Lineup</th>
                        <th className="text-center py-2 px-4 w-[110px] whitespace-nowrap">Δ Rotation</th>
                        <th className="text-center py-2 px-4 w-[110px] whitespace-nowrap">Δ Bullpen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) =>
                        row.kind === "team" ? (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2 pr-4"><div className="font-medium">{row.label}</div>{row.sublabel && <div className="text-[10px] text-muted-foreground italic">{row.sublabel}</div>}</td>
                            <td className="text-center py-2 px-4 font-mono tabular-nums text-muted-foreground">{(Number(row.bench.prorated_total_owar) + Number(row.bench.prorated_total_pwar)).toFixed(2)}</td>
                            <td className="text-center py-2 px-4 font-mono">{deltaCell(totalWar, Number(row.bench.prorated_total_owar) + Number(row.bench.prorated_total_pwar))}</td>
                            <td className="text-center py-2 px-4 font-mono">{deltaCell(lineupOwar, Number(row.bench.prorated_starting_lineup_owar))}</td>
                            <td className="text-center py-2 px-4 font-mono">{deltaCell(rotationPwar, Number(row.bench.prorated_rotation_pwar))}</td>
                            <td className="text-center py-2 px-4 font-mono">{deltaCell(bullpenPwar, Number(row.bench.prorated_bullpen_pwar))}</td>
                          </tr>
                        ) : (
                          <tr key={i} className="border-b last:border-0 bg-[#D4AF37]/[0.04]">
                            <td className="py-2 pr-4"><div className="font-medium">{row.label}</div>{row.sublabel && <div className="text-[10px] text-muted-foreground italic">{row.sublabel}</div>}</td>
                            <td className="text-center py-2 px-4 font-mono">{rangeText(row.range.total)}</td>
                            <td className="text-center py-2 px-4 font-mono">{rangeDelta(totalWar, row.range.total)}</td>
                            <td className="text-center py-2 px-4 font-mono">{rangeDelta(lineupOwar, row.range.lineup)}</td>
                            <td className="text-center py-2 px-4 font-mono">{rangeDelta(rotationPwar, row.range.rotation)}</td>
                            <td className="text-center py-2 px-4 font-mono">{rangeDelta(bullpenPwar, row.range.bullpen)}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                  <div className="text-[10px] text-muted-foreground mt-2 italic">Your projected build vs prorated 56-game actuals.</div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Pay by position group — click a row to see the players in it */}
      <Card className="border-border/60">
        <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Pay by Position</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow style={OSWALD} className="[&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-[11px] [&_th]:text-muted-foreground">
                <TableHead>Group</TableHead>
                <TableHead className="text-center">Players</TableHead>
                <TableHead className="text-right">Pay</TableHead>
                <TableHead className="text-right">% of Pay</TableHead>
                <TableHead className="text-center">WAR</TableHead>
                <TableHead className="text-right">WAR %</TableHead>
                <TableHead className="text-right pr-4">$ / Win</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byGroup.map((g) => {
                const open = expanded.has(g.group);
                return (
                  <Fragment key={g.group}>
                    <TableRow className="cursor-pointer hover:bg-muted/40" onClick={() => toggle(g.group)}>
                      <TableCell className="py-1.5 text-sm font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <ChevronRight className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-90")} />
                          {g.group}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5 text-center font-mono text-sm tabular-nums">{g.count}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-sm tabular-nums pr-3">{money(g.pay)}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-sm tabular-nums text-muted-foreground">{totalPay > 0 ? `${Math.round((g.pay / totalPay) * 100)}%` : "—"}</TableCell>
                      <TableCell className="py-1.5 text-center font-mono text-sm tabular-nums">{num(g.war)}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-sm tabular-nums text-muted-foreground">{totalWar > 0 ? `${Math.round((g.war / totalWar) * 100)}%` : "—"}</TableCell>
                      <TableCell className="py-1.5 text-right font-mono text-sm font-semibold tabular-nums pr-4">{money0(g.war > 0 ? g.pay / g.war : null)}</TableCell>
                    </TableRow>
                    {open && g.players.map((p) => (
                      <TableRow key={p.build_player_id} className="bg-muted/20">
                        <TableCell className="py-1 pl-9 text-xs text-muted-foreground">{p.name} <span className="text-muted-foreground/60">· {p.position || "—"}</span></TableCell>
                        <TableCell />
                        <TableCell className="py-1 text-right font-mono text-xs tabular-nums pr-3">{money(p.nil_value)}</TableCell>
                        <TableCell />
                        <TableCell className="py-1 text-center font-mono text-xs tabular-nums">{num(p.war)}</TableCell>
                        <TableCell />
                        <TableCell className="py-1 text-right font-mono text-xs tabular-nums pr-4">{money0((p.war ?? 0) > 0 && (p.nil_value ?? 0) > 0 ? (p.nil_value as number) / (p.war as number) : null)}</TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                );
              })}
              {byGroup.length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No committed pay yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Cost efficiency — best value / priciest per win */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {[{ title: "Best Value ($ / Win)", rows: bestValue }, { title: "Priciest per Win", rows: priciest }].map((panel) => (
          <Card key={panel.title} className="border-border/60">
            <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
              <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>{panel.title}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow style={OSWALD} className="[&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-[11px] [&_th]:text-muted-foreground">
                    <TableHead>Player</TableHead>
                    <TableHead className="text-center">Pos</TableHead>
                    <TableHead className="text-center">WAR</TableHead>
                    <TableHead className="text-right pr-3">Pay</TableHead>
                    <TableHead className="text-right pr-4">$ / Win</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {panel.rows.map(rowLine)}
                  {panel.rows.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Not enough paid players with WAR.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Historical pay-per-win (last season's spend vs actual WAR) is a planned add — it needs last year's committed pay stored alongside the WAR snapshots.
      </p>
    </div>
  );
}
