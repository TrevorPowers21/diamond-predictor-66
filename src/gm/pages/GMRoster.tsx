import { useState } from "react";
import { Link } from "react-router-dom";
import { useGmRoster, type GmRow } from "@/gm/hooks/useGmRoster";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, Pencil } from "lucide-react";
import { profileRouteFor } from "@/lib/profileRoutes";
import { cn } from "@/lib/utils";

const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d));

/** Currency input: type 8000 → $8,000, no negatives, saves on blur. */
function MoneyCell({ value, onSave, disabled }: { value: number | null; onSave: (n: number | null) => void; disabled?: boolean }) {
  const [local, setLocal] = useState<string | null>(null);
  const display = local != null ? local : value == null ? "" : "$" + Math.round(value).toLocaleString("en-US");
  return (
    <Input
      value={display}
      disabled={disabled}
      inputMode="numeric"
      placeholder="—"
      className="h-8 w-24 text-right text-xs tabular-nums"
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

/** Small integer input (eligibility years / draft year). */
function IntCell({ value, onSave, width = "w-14", placeholder }: { value: number | null; onSave: (n: number | null) => void; width?: string; placeholder?: string }) {
  const [local, setLocal] = useState<string | null>(null);
  const display = local != null ? local : value == null ? "" : String(value);
  return (
    <Input
      value={display}
      inputMode="numeric"
      placeholder={placeholder}
      className={cn("h-8 text-center text-xs tabular-nums", width)}
      onChange={(e) => setLocal(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={() => {
        if (local != null) {
          onSave(local === "" ? null : Number(local));
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

const HEADERS = ["Name", "Eligibility", "WAR", "Market Value", "Rev Share", "NIL", "Other", "Actual Pay", ""];

export default function GMRoster() {
  const gm = useGmRoster();
  const [editBudget, setEditBudget] = useState(false);

  const section = (title: string, rows: GmRow[]) => (
    <Card className="overflow-hidden">
      <div className="border-b bg-muted/30 px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
        {title} <span className="ml-1 text-muted-foreground/60">({rows.length})</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {HEADERS.map((h, i) => (
                <TableHead key={i} className={cn("text-[10px] uppercase tracking-wider", i >= 2 && i <= 7 && "text-right", i === 8 && "text-center")}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.player_id} className={cn(r.finalized && "bg-emerald-500/[0.04]")}>
                <TableCell className="py-1.5">
                  <Link to={profileRouteFor(r.player_id, r.position)} className="text-sm font-medium hover:text-primary hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-[10px] text-muted-foreground">{[r.position, r.class_year].filter(Boolean).join(" · ") || "—"}</div>
                </TableCell>
                <TableCell className="py-1.5">
                  <div className="flex items-center gap-1">
                    <IntCell value={r.eligibility_years_remaining} onSave={(n) => gm.savePlayer(r.player_id, { eligibility_years_remaining: n })} width="w-12" placeholder="yrs" />
                    <IntCell value={r.draft_year} onSave={(n) => gm.savePlayer(r.player_id, { draft_year: n })} width="w-16" placeholder="draft" />
                  </div>
                </TableCell>
                <TableCell className="py-1.5 text-right text-xs tabular-nums">{num(r.war)}</TableCell>
                <TableCell className="py-1.5 text-right text-xs tabular-nums">{money(r.market_value)}</TableCell>
                <TableCell className="py-1.5 text-right"><MoneyCell value={r.rev_share} onSave={(n) => gm.savePlayer(r.player_id, { rev_share: n })} /></TableCell>
                <TableCell className="py-1.5 text-right"><MoneyCell value={r.nil_amount} onSave={(n) => gm.savePlayer(r.player_id, { nil_amount: n })} /></TableCell>
                <TableCell className="py-1.5 text-right"><MoneyCell value={r.other_amount} onSave={(n) => gm.savePlayer(r.player_id, { other_amount: n })} /></TableCell>
                <TableCell className="py-1.5 text-right"><MoneyCell value={r.actual_pay} onSave={(n) => gm.savePlayer(r.player_id, { actual_pay: n })} /></TableCell>
                <TableCell className="py-1.5 text-center">
                  <FinalizeCheck finalized={r.finalized} onClick={() => gm.finalizePlayer(r)} title={r.finalized ? "Finalized pay — click to unlock" : "Finalize pay & sync to Team Builder"} />
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={HEADERS.length} className="py-6 text-center text-xs text-muted-foreground">No players.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );

  const b = gm.budget;
  const totalAllot = (b?.rev_share_total ?? 0) + (b?.nil_total ?? 0) + (b?.other_total ?? 0);
  const bucket = (label: string, used: number, total: number | null, save: (n: number | null) => void) => (
    <div className="flex-1 min-w-[150px] px-4 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-sm font-bold tabular-nums text-foreground">{money(used)}</span>
        <span className="text-xs text-muted-foreground">/</span>
        {editBudget ? (
          <MoneyCell value={total} onSave={save} />
        ) : (
          <span className={cn("text-xs tabular-nums", total != null && used > total ? "text-red-500 font-semibold" : "text-muted-foreground")}>{money(total)}</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Roster</h2>
          <p className="text-sm text-muted-foreground">{gm.teamName ? `${gm.teamName} · ${gm.season}` : "Pick a team above."}</p>
        </div>
      </div>

      {/* Budget header */}
      <Card className="flex flex-wrap items-center">
        {bucket("Revenue Share", gm.totals.revUsed, b?.rev_share_total ?? null, (n) => gm.saveBudget({ rev_share_total: n }))}
        {bucket("NIL", gm.totals.nilUsed, b?.nil_total ?? null, (n) => gm.saveBudget({ nil_total: n }))}
        {bucket("Other", gm.totals.otherUsed, b?.other_total ?? null, (n) => gm.saveBudget({ other_total: n }))}
        {bucket("Total Actual Pay", gm.totals.actualUsed, totalAllot || null, () => {})}
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
          {section("Hitters", gm.hitters)}
          {section("Pitchers", gm.pitchers)}
        </>
      )}
    </div>
  );
}
