import { Link } from "react-router-dom";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, DollarSign, ClipboardList, Wallet, Users, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));

/** Briefing metric tile — mirrors the Player Evaluation Overview tiles. */
function Tile({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: "emerald" | "blue" | "gold" | "red" }) {
  const accentColor =
    accent === "emerald" ? "text-emerald-400" : accent === "blue" ? "text-blue-400" : accent === "gold" ? "text-[#D4AF37]" : accent === "red" ? "text-red-400" : "text-white";
  return (
    <div className="px-4 py-3 flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <span className="text-slate-500">{icon}</span>
        {label}
      </span>
      <span className={cn("text-xl font-bold tabular-nums", accentColor)} style={OSWALD}>{value}</span>
    </div>
  );
}

/** One used/allotment line in the budget-breakdown card. */
function BudgetLine({ label, used, total }: { label: string; used: number; total: number | null }) {
  const over = total != null && used > total;
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/75" style={OSWALD}>{label}</span>
      <span className="font-mono text-sm tabular-nums">
        <span className={cn("font-semibold", over ? "text-red-500" : "text-foreground")}>{money(used)}</span>
        {total != null && <span className="text-muted-foreground"> / {money(total)}</span>}
      </span>
    </div>
  );
}

export default function GMHome() {
  const gm = useGmRoster();
  const roster = [...gm.hitters, ...gm.pitchers];
  const committed = roster.reduce((s, r) => s + (r.nil_value ?? 0), 0);
  const totalBudget = gm.coachTotalBudget ?? 0;
  const remaining = totalBudget - committed;
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const b = gm.budget;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>{gm.teamName ?? "Front Office"}</h2>
        <p className="text-sm text-muted-foreground">Front Office · Season {gm.season}</p>
      </div>

      {/* Briefing + tiles — same treatment as the Overview page */}
      <div className="space-y-0">
        <div className="rounded-t-lg border-l-[3px] border-l-[#D4AF37] bg-[#0D1B3E] px-4 py-3 flex items-center flex-wrap gap-x-4 gap-y-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]" style={OSWALD}>Front Office Briefing</span>
          <span className="flex items-center gap-1.5 text-xs text-slate-300"><Calendar className="h-3 w-3" />{dateStr}</span>
          <span className="text-slate-500">·</span>
          <span className="text-xs text-slate-300">{gm.builds.length} build{gm.builds.length === 1 ? "" : "s"}</span>
          {gm.pendingReasonCount > 0 && (
            <>
              <span className="text-slate-500">·</span>
              <span className="text-xs font-medium text-amber-400">{gm.pendingReasonCount} departure{gm.pendingReasonCount === 1 ? "" : "s"} need a reason</span>
            </>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 rounded-b-lg border border-t-0 border-[#162241] bg-[#0a1428] divide-x divide-[#162241]">
          <Tile label="Total Budget" value={money(totalBudget)} icon={<DollarSign className="h-3.5 w-3.5" />} accent="gold" />
          <Tile label="Committed" value={money(committed)} icon={<ClipboardList className="h-3.5 w-3.5" />} accent="blue" />
          <Tile label="Remaining" value={money(remaining)} icon={<Wallet className="h-3.5 w-3.5" />} accent={remaining < 0 ? "red" : "emerald"} />
          <Tile label="Roster" value={String(roster.length)} icon={<Users className="h-3.5 w-3.5" />} />
        </div>
      </div>

      {/* Two-column card grid */}
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* Budget breakdown */}
        <Card className="border-border/60">
          <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40">
            <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Budget Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/40">
            <BudgetLine label="Revenue Share" used={gm.totals.revUsed} total={b?.rev_share_total ?? null} />
            <BudgetLine label="NIL" used={gm.totals.nilUsed} total={b?.nil_total ?? null} />
            <BudgetLine label="Other" used={gm.totals.otherUsed} total={b?.other_total ?? null} />
            <BudgetLine label="Scholarship" used={gm.totals.schUsed} total={b?.scholarship_total ?? null} />
          </CardContent>
        </Card>

        {/* Roster snapshot */}
        <Card className="border-border/60">
          <CardHeader className="pb-2 pt-3 px-4 border-b border-border/40 flex flex-row items-center justify-between">
            <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>Roster</CardTitle>
            <Link to="/gm/roster" className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-primary">
              Manage <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0 divide-y divide-border/40">
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/75" style={OSWALD}>Position Players</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{gm.hitters.length}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/75" style={OSWALD}>Pitchers</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{gm.pitchers.length}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/75" style={OSWALD}>Departures</span>
              <span className="font-mono text-sm font-semibold tabular-nums">
                {gm.departures.length}
                {gm.pendingReasonCount > 0 && <span className="ml-2 text-amber-500">({gm.pendingReasonCount} pending)</span>}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
