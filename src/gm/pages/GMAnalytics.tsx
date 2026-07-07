import { Fragment, useMemo, useState } from "react";
import { useGmRoster, type GmRow } from "@/gm/hooks/useGmRoster";
import { useWarBenchmarks } from "@/hooks/useTeamWarSnapshots";
import { CURRENT_SEASON } from "@/lib/seasonConstants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DollarSign, TrendingUp, Gauge, Wallet, ChevronRight } from "lucide-react";
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

/** Build value vs a benchmark team, with a colored delta. */
function CompareCell({ label, mine, theirs }: { label: string; mine: number; theirs: number | null }) {
  const delta = theirs != null ? mine - theirs : null;
  const color = delta == null || Math.abs(delta) < 0.1 ? "text-muted-foreground" : delta > 0 ? "text-emerald-500" : "text-red-500";
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/60" style={OSWALD}>{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-mono text-xl font-bold tabular-nums">{mine.toFixed(1)}</span>
        {theirs != null && <span className="text-[11px] text-muted-foreground">vs {theirs.toFixed(1)}</span>}
      </div>
      {delta != null && <div className={cn("text-[11px] font-semibold tabular-nums", color)}>{delta > 0 ? "+" : ""}{delta.toFixed(1)}</div>}
    </div>
  );
}

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (g: string) => setExpanded((prev) => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });

  const roster = useMemo(() => [...gm.hitters, ...gm.pitchers], [gm.hitters, gm.pitchers]);
  const totalPay = roster.reduce((s, r) => s + (r.nil_value ?? 0), 0);
  const totalWar = roster.reduce((s, r) => s + (r.war ?? 0), 0);
  const payPerWin = totalWar > 0 ? totalPay / totalWar : null;
  const remaining = (gm.coachTotalBudget ?? 0) - totalPay;

  // WAR breakdown (offense vs rotation vs bullpen) + roster-wide efficiency.
  const hitOwar = gm.hitters.reduce((s, r) => s + (r.war ?? 0), 0);
  const rotationPwar = gm.pitchers.filter((p) => (p.position || "").toUpperCase() === "SP").reduce((s, r) => s + (r.war ?? 0), 0);
  const bullpenPwar = gm.pitchers.filter((p) => (p.position || "").toUpperCase() !== "SP").reduce((s, r) => s + (r.war ?? 0), 0);
  const lineupOwar = gm.hitters.slice(0, 9).reduce((s, r) => s + (r.war ?? 0), 0); // gm.hitters is sorted by WAR desc

  // Benchmark vs last completed season's champions (national + conference).
  const { data: benchmarks = [] } = useWarBenchmarks(CURRENT_SEASON);
  const [benchId, setBenchId] = useState<string | null>(null);
  const bench = benchmarks.find((b) => b.source_team_id === benchId) ?? benchmarks[0] ?? null;

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
        <Tile label="Projected WAR" value={num(totalWar, 1)} icon={<TrendingUp className="h-3.5 w-3.5" />} />
        <Tile label="$ / Projected Win" value={money0(payPerWin)} sub="pay per WAR" icon={<Gauge className="h-3.5 w-3.5" />} accent="gold" />
        <Tile label="Remaining" value={money(remaining)} icon={<Wallet className="h-3.5 w-3.5" />} accent={remaining < 0 ? "red" : "emerald"} />
      </div>

      {/* WAR breakdown */}
      <Card className="border-border/60">
        <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>WAR Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-3 divide-x divide-border/40 p-0">
          {[
            { label: "Hitting oWAR", value: hitOwar },
            { label: "Rotation pWAR", value: rotationPwar },
            { label: "Bullpen pWAR", value: bullpenPwar },
          ].map((x) => (
            <div key={x.label} className="px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/60" style={OSWALD}>{x.label}</div>
              <div className="mt-1 font-mono text-xl font-bold tabular-nums">{num(x.value, 1)}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* WAR vs top teams — this build's projected WAR against champions */}
      <Card className="border-border/60">
        <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40 flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>WAR vs Top Teams</CardTitle>
          {benchmarks.length > 0 && (
            <Select value={bench?.source_team_id ?? undefined} onValueChange={setBenchId}>
              <SelectTrigger className="h-8 w-[240px] text-xs"><SelectValue placeholder="Pick a benchmark" /></SelectTrigger>
              <SelectContent>
                {benchmarks.map((b) => (
                  <SelectItem key={b.source_team_id} value={b.source_team_id} className="text-xs">
                    {b.team_name}{b.is_national_champ ? " — National Champ" : b.conference ? ` — ${b.conference}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {bench ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border/40">
                <CompareCell label="Total WAR" mine={totalWar} theirs={Number(bench.prorated_total_owar) + Number(bench.prorated_total_pwar)} />
                <CompareCell label="Lineup oWAR" mine={lineupOwar} theirs={Number(bench.prorated_starting_lineup_owar)} />
                <CompareCell label="Rotation pWAR" mine={rotationPwar} theirs={Number(bench.prorated_rotation_pwar)} />
                <CompareCell label="Bullpen pWAR" mine={bullpenPwar} theirs={Number(bench.prorated_bullpen_pwar)} />
              </div>
              <p className="px-4 py-2 text-[10px] text-muted-foreground border-t border-border/40">Your projected build vs {bench.team_name}'s prorated (56-game) actual WAR. Green = ahead.</p>
            </>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No benchmark data available for this season.</p>
          )}
        </CardContent>
      </Card>

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
