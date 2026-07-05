import { useState } from "react";
import { Link } from "react-router-dom";
import { useGmRoster, type GmRow } from "@/gm/hooks/useGmRoster";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Pencil } from "lucide-react";
import { profileRouteFor } from "@/lib/profileRoutes";
import { cn } from "@/lib/utils";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d));

/** Currency input: type 8000 → $8,000, no negatives, saves on blur. */
function MoneyCell({ value, onSave }: { value: number | null; onSave: (n: number | null) => void }) {
  const [local, setLocal] = useState<string | null>(null);
  const display = local != null ? local : value == null ? "" : "$" + Math.round(value).toLocaleString("en-US");
  return (
    <Input
      value={display}
      inputMode="numeric"
      placeholder="—"
      className="h-8 w-24 text-right text-xs font-mono tabular-nums ml-auto"
      onChange={(e) => {
        const d = e.target.value.replace(/[^0-9]/g, "");
        setLocal(d === "" ? "" : "$" + Number(d).toLocaleString("en-US"));
      }}
      onBlur={() => {
        if (local != null) {
          const d = local.replace(/[^0-9]/g, "");
          onSave(d === "" ? null : Number(d));
          setLocal(null);
        }
      }}
    />
  );
}

function FinalizeCheck({ finalized, onClick, title }: { finalized: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded border transition-colors cursor-pointer",
        finalized ? "border-emerald-500 bg-emerald-500/15 text-emerald-500" : "border-border text-muted-foreground/30 hover:text-muted-foreground/70",
      )}
    >
      <Check className="h-3.5 w-3.5" />
    </button>
  );
}

export default function GMRoster() {
  const gm = useGmRoster();
  const [editBudget, setEditBudget] = useState(false);

  const section = (title: string, rows: GmRow[]) => {
    const sum = (f: (r: GmRow) => number | null) => rows.reduce((s, r) => s + (f(r) ?? 0), 0);
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px] font-bold uppercase tracking-[0.12em] text-[#D4AF37]" style={OSWALD}>
            {title} ({rows.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-muted/95 backdrop-blur-sm shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] min-w-[190px]">Player</TableHead>
                <TableHead>Eligibility</TableHead>
                <TableHead className="text-center">WAR</TableHead>
                <TableHead className="text-center">Market Value ($)</TableHead>
                <TableHead className="text-right">Rev Share</TableHead>
                <TableHead className="text-right">NIL</TableHead>
                <TableHead className="text-right">Other</TableHead>
                <TableHead className="text-right">Actual Pay</TableHead>
                <TableHead className="text-center w-14">Final</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.player_id} className={cn(r.finalized && "bg-emerald-500/[0.04]")}>
                  <TableCell className="sticky left-0 z-10 bg-background py-1.5">
                    <Link to={profileRouteFor(r.player_id, r.position)} className="text-sm font-medium hover:text-primary hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-[10px] text-muted-foreground">{r.position || "—"}</div>
                  </TableCell>
                  <TableCell className="py-1.5">
                    {/* Read-only here; editing lives on the future player profile. */}
                    <span className="text-xs font-semibold text-foreground">{r.eligibility_class || "—"}</span>
                  </TableCell>
                  <TableCell className="py-1.5 text-center font-mono text-xs tabular-nums">{num(r.war)}</TableCell>
                  <TableCell className="py-1.5 text-center font-mono text-xs tabular-nums">{money(r.market_value)}</TableCell>
                  <TableCell className="py-1.5"><MoneyCell value={r.rev_share} onSave={(n) => gm.savePlayer(r.player_id, { rev_share: n })} /></TableCell>
                  <TableCell className="py-1.5"><MoneyCell value={r.nil_amount} onSave={(n) => gm.savePlayer(r.player_id, { nil_amount: n })} /></TableCell>
                  <TableCell className="py-1.5"><MoneyCell value={r.other_amount} onSave={(n) => gm.savePlayer(r.player_id, { other_amount: n })} /></TableCell>
                  <TableCell className="py-1.5"><MoneyCell value={r.actual_pay} onSave={(n) => gm.savePlayer(r.player_id, { actual_pay: n })} /></TableCell>
                  <TableCell className="py-1.5 text-center">
                    <FinalizeCheck finalized={r.finalized} onClick={() => gm.finalizePlayer(r)} title={r.finalized ? "Finalized pay — click to unlock" : "Finalize pay & sync to Team Builder"} />
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No players.</TableCell></TableRow>
              ) : (
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell className="sticky left-0 z-10 bg-muted/40 text-right py-2 pr-3 font-semibold">Totals</TableCell>
                  <TableCell />
                  <TableCell className="text-center font-mono text-sm py-2">{num(sum((r) => r.war), 1)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono text-sm py-2 pr-3">{money(sum((r) => r.rev_share))}</TableCell>
                  <TableCell className="text-right font-mono text-sm py-2 pr-3">{money(sum((r) => r.nil_amount))}</TableCell>
                  <TableCell className="text-right font-mono text-sm py-2 pr-3">{money(sum((r) => r.other_amount))}</TableCell>
                  <TableCell className="text-right font-mono text-sm py-2 pr-3">{money(sum((r) => r.actual_pay))}</TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

  const b = gm.budget;
  const totalAllot = (b?.rev_share_total ?? 0) + (b?.nil_total ?? 0) + (b?.other_total ?? 0);
  const bucket = (label: string, used: number, total: number | null, save: ((n: number | null) => void) | null) => (
    <div className="flex-1 min-w-[150px] px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-sm font-bold font-mono tabular-nums text-foreground">{money(used)}</span>
        <span className="text-xs text-muted-foreground">/</span>
        {editBudget && save ? (
          <MoneyCell value={total} onSave={save} />
        ) : (
          <span className={cn("text-xs font-mono tabular-nums", total != null && used > total ? "text-red-500 font-semibold" : "text-muted-foreground")}>{money(total)}</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header: team + build filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-lg font-bold" style={OSWALD}>{gm.teamName ?? "Front Office"}</h2>
          <p className="text-xs text-muted-foreground">{gm.teamName ? `Season ${gm.season}` : "Pick a team above."}</p>
        </div>
        {gm.builds.length > 0 && (
          <Select value={gm.selectedBuildId ?? undefined} onValueChange={(v) => gm.setSelectedBuildId(v)}>
            <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="Select build" /></SelectTrigger>
            <SelectContent>
              {gm.builds.map((bd) => (
                <SelectItem key={bd.id} value={bd.id} className="text-xs">{bd.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Budget header */}
      <Card className="flex flex-wrap items-center">
        {bucket("Revenue Share", gm.totals.revUsed, b?.rev_share_total ?? null, (n) => gm.saveBudget({ rev_share_total: n }))}
        {bucket("NIL", gm.totals.nilUsed, b?.nil_total ?? null, (n) => gm.saveBudget({ nil_total: n }))}
        {bucket("Other", gm.totals.otherUsed, b?.other_total ?? null, (n) => gm.saveBudget({ other_total: n }))}
        {bucket("Total Actual Pay", gm.totals.actualUsed, totalAllot || null, null)}
        <div className="ml-auto flex items-center gap-2 px-4">
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setEditBudget((v) => !v)}>
            <Pencil className="h-3.5 w-3.5" /> {editBudget ? "Done" : "Edit totals"}
          </Button>
          <FinalizeCheck finalized={!!b?.finalized} onClick={() => gm.finalizeBudget(!b?.finalized)} title={b?.finalized ? "Budget finalized — click to unlock" : "Finalize budget"} />
        </div>
      </Card>

      {gm.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading roster…</p>
      ) : (
        <>
          {section("Position Players", gm.hitters)}
          {section("Pitchers", gm.pitchers)}
        </>
      )}
    </div>
  );
}
