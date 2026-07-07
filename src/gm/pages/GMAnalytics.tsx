import { useMemo } from "react";
import { useGmRoster, type GmRow } from "@/gm/hooks/useGmRoster";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DollarSign, TrendingUp, Gauge, Wallet } from "lucide-react";
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

  const roster = useMemo(() => [...gm.hitters, ...gm.pitchers], [gm.hitters, gm.pitchers]);
  const totalPay = roster.reduce((s, r) => s + (r.nil_value ?? 0), 0);
  const totalWar = roster.reduce((s, r) => s + (r.war ?? 0), 0);
  const payPerWin = totalWar > 0 ? totalPay / totalWar : null;
  const remaining = (gm.coachTotalBudget ?? 0) - totalPay;

  // Pay by position group.
  const byGroup = useMemo(() => {
    const map = new Map<string, { pay: number; war: number; count: number }>();
    for (const r of roster) {
      const g = payGroup(r.position);
      const e = map.get(g) ?? { pay: 0, war: 0, count: 0 };
      e.pay += r.nil_value ?? 0;
      e.war += r.war ?? 0;
      e.count += 1;
      map.set(g, e);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({ group: g, ...map.get(g)! }));
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

      {/* Pay by position group */}
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
                <TableHead className="text-right pr-4">$ / Win</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byGroup.map((g) => (
                <TableRow key={g.group}>
                  <TableCell className="py-1.5 text-sm font-medium">{g.group}</TableCell>
                  <TableCell className="py-1.5 text-center font-mono text-sm tabular-nums">{g.count}</TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-sm tabular-nums pr-3">{money(g.pay)}</TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-sm tabular-nums text-muted-foreground">{totalPay > 0 ? `${Math.round((g.pay / totalPay) * 100)}%` : "—"}</TableCell>
                  <TableCell className="py-1.5 text-center font-mono text-sm tabular-nums">{num(g.war)}</TableCell>
                  <TableCell className="py-1.5 text-right font-mono text-sm font-semibold tabular-nums pr-4">{money0(g.war > 0 ? g.pay / g.war : null)}</TableCell>
                </TableRow>
              ))}
              {byGroup.length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No committed pay yet.</TableCell></TableRow>
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
