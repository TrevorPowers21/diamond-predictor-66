import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useGmRoster, type GmBudget, type GmRow } from "@/gm/hooks/useGmRoster";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Check, SlidersHorizontal } from "lucide-react";
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

/** Controlled dollar input for the budget popup — formats as $ while typing. */
function DollarInput({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  const [text, setText] = useState<string | null>(null);
  const display = text != null ? text : value == null ? "" : "$" + Math.round(value).toLocaleString("en-US");
  return (
    <Input
      value={display}
      inputMode="numeric"
      placeholder="$0"
      className="h-8 w-36 text-right text-sm font-mono tabular-nums"
      onChange={(e) => {
        const d = e.target.value.replace(/[^0-9]/g, "");
        setText(d === "" ? "" : "$" + Number(d).toLocaleString("en-US"));
        onChange(d === "" ? null : Number(d));
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** Budget-setup popup: the GM edits the four allotments here (nowhere else),
 *  then Finalize sums them and pushes the total into the coach's Team Builder.
 *  The roster boxes stay read-only whole numbers. */
type BudgetCaps = { rev_share_total: number | null; nil_total: number | null; scholarship_total: number | null; other_total: number | null };
function BudgetDialog({ budget, onSave, onFinalize, pending }: { budget: GmBudget | null; onSave: (caps: BudgetCaps) => void; onFinalize: (caps: BudgetCaps) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [rev, setRev] = useState<number | null>(null);
  const [nil, setNil] = useState<number | null>(null);
  const [sch, setSch] = useState<number | null>(null);
  const [other, setOther] = useState<number | null>(null);
  useEffect(() => {
    if (open) {
      setRev(budget?.rev_share_total ?? null);
      setNil(budget?.nil_total ?? null);
      setSch(budget?.scholarship_total ?? null);
      setOther(budget?.other_total ?? null);
    }
  }, [open, budget]);
  const total = (rev ?? 0) + (nil ?? 0) + (sch ?? 0) + (other ?? 0);
  const caps = (): BudgetCaps => ({ rev_share_total: rev, nil_total: nil, scholarship_total: sch, other_total: other });
  const field = (label: string, val: number | null, set: (n: number | null) => void) => (
    <label className="flex items-center justify-between gap-4">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground" style={OSWALD}>{label}</span>
      <DollarInput value={val} onChange={set} />
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <SlidersHorizontal className="h-3.5 w-3.5" /> Manage Budget
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle style={OSWALD}>Season Budget</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {field("Revenue Share", rev, setRev)}
          {field("NIL", nil, setNil)}
          {field("Scholarship", sch, setSch)}
          {field("Other", other, setOther)}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-xs font-bold uppercase tracking-wider" style={OSWALD}>Total</span>
            <span className="text-base font-bold font-mono tabular-nums">{money(total)}</span>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {/* Save = GM-only draft (does NOT touch the coach's build). */}
          <Button variant="outline" size="sm" disabled={pending} onClick={() => { onSave(caps()); setOpen(false); }}>Save</Button>
          {/* Finalize = save + push the total into the coach's Team Builder. */}
          <Button size="sm" disabled={pending} onClick={() => { onFinalize(caps()); setOpen(false); }}>Finalize &amp; Push</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function GMRoster() {
  const gm = useGmRoster();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  // Season selector is display-only for now — data still reads gm.season.
  const [seasonSel, setSeasonSel] = useState<number>(gm.season);

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
          <Table className="min-w-[1120px]">
            <TableHeader>
              <TableRow style={OSWALD} className="[&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-[11px] [&_th]:text-muted-foreground">

                <TableHead className="sticky left-0 z-20 bg-muted/95 backdrop-blur-sm shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] min-w-[180px]">Player</TableHead>
                <TableHead>Eligibility</TableHead>
                <TableHead className="text-center">Position</TableHead>
                <TableHead className="text-center">WAR</TableHead>
                <TableHead className="text-center">Market Value</TableHead>
                <TableHead className="text-right">Scholarship</TableHead>
                <TableHead className="text-right">Rev Share</TableHead>
                <TableHead className="text-right">NIL</TableHead>
                <TableHead className="text-right">Other</TableHead>
                <TableHead className="text-right">Actual Pay</TableHead>
                <TableHead className="text-center w-14">Final</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.build_player_id} className={cn(r.finalized && "bg-emerald-500/[0.04]")}>
                  <TableCell className="sticky left-0 z-10 bg-background py-1.5">
                    {r.player_id ? (
                      <Link to={profileRouteFor(r.player_id, r.position)} state={{ returnTo }} className="text-sm font-medium hover:text-primary hover:underline">
                        {r.name}
                      </Link>
                    ) : (
                      // Coach-added recruit — no DB player record, so no profile to link.
                      <span className="text-sm font-medium">{r.name}</span>
                    )}
                  </TableCell>
                  <TableCell className="py-1.5">
                    {/* Read-only here; editing lives on the future player profile. */}
                    <span className="text-xs font-semibold text-foreground">{r.eligibility_class || "—"}</span>
                  </TableCell>
                  <TableCell className="py-1.5 text-center">
                    <span className="text-xs font-semibold text-foreground">{r.position || "—"}</span>
                  </TableCell>
                  {/* WAR + Market Value are read-only projections — styled as stats
                      (mono, no input affordance) to match Team Builder, distinct
                      from the editable money cells. */}
                  <TableCell className="py-1.5 text-center font-mono text-sm font-semibold tabular-nums text-foreground">{num(r.war)}</TableCell>
                  <TableCell className="py-1.5 text-center font-mono text-sm font-semibold tabular-nums text-foreground">{money(r.market_value)}</TableCell>
                  <TableCell className="py-1.5"><MoneyCell value={r.scholarship_amount} onSave={(n) => gm.savePlayer(r.player_id, { scholarship_amount: n })} /></TableCell>
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
                <TableRow><TableCell colSpan={11} className="py-8 text-center text-muted-foreground">No players.</TableCell></TableRow>
              ) : (
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell className="sticky left-0 z-10 bg-muted/40 text-right py-2 pr-3 font-semibold">Totals</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-center font-mono text-sm py-2">{num(sum((r) => r.war), 1)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono text-sm py-2 pr-3">{money(sum((r) => r.scholarship_amount))}</TableCell>
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
  const totalAllot = (b?.rev_share_total ?? 0) + (b?.nil_total ?? 0) + (b?.other_total ?? 0) + (b?.scholarship_total ?? 0);

  // One budget box — read-only. Shows used / allotment as whole dollars; caps
  // are edited only in the Manage Budget popup. Over-cap turns the used red.
  // `accent` gives the Total box a standing gold highlight.
  const box = (label: string, used: number, total: number | null, accent?: boolean) => (
    <Card className={cn("flex flex-col items-center px-4 py-3.5 text-center", accent && "border-[#D4AF37]/55 bg-[#D4AF37]/[0.07]")}>
      <div className={cn("text-[11px] font-bold uppercase tracking-[0.14em]", accent ? "text-[#D4AF37]" : "text-muted-foreground")} style={OSWALD}>{label}</div>
      <div className="mt-2 flex items-baseline justify-center gap-1.5">
        <span className={cn("font-mono font-bold tabular-nums leading-none", accent ? "text-3xl text-[#D4AF37]" : "text-2xl text-foreground", total != null && used > total && "text-red-500")}>{money(used)}</span>
        {total != null && (
          <span className={cn("text-xs font-mono tabular-nums", used > total ? "text-red-500 font-semibold" : "text-muted-foreground")}>/ {money(total)}</span>
        )}
      </div>
    </Card>
  );

  return (
    <div className="space-y-4">
      {/* Header: team + season (left) · build filter (right) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-bold" style={OSWALD}>{gm.teamName ?? "Front Office"}</h2>
            <p className="text-xs text-muted-foreground">{gm.teamName ? "Front Office" : "Pick a team above."}</p>
          </div>
          {/* Season selector — display only for now; season switching is wired later. */}
          <Select value={String(seasonSel)} onValueChange={(v) => setSeasonSel(Number(v))}>
            <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[gm.season - 1, gm.season, gm.season + 1].map((y) => (
                <SelectItem key={y} value={String(y)} className="text-xs">{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      {/* Budget — each bucket in its own box: Scholarship · NIL · Other on top,
          Revenue Share · Total on the second row. */}
      <div className="space-y-3">
        <div className="flex items-center justify-end gap-2">
          {b?.finalized && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-500" style={OSWALD}>
              <Check className="h-3.5 w-3.5" /> Finalized
            </span>
          )}
          <BudgetDialog
            budget={b}
            onSave={(caps) => gm.saveBudget({ ...caps, finalized: false })}
            onFinalize={(caps) => gm.commitBudget(caps)}
            pending={gm.isFinalizing}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {box("Scholarship", gm.totals.schUsed, b?.scholarship_total ?? null)}
          {box("NIL", gm.totals.nilUsed, b?.nil_total ?? null)}
          {box("Other", gm.totals.otherUsed, b?.other_total ?? null)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {box("Revenue Share", gm.totals.revUsed, b?.rev_share_total ?? null)}
          {box("Total", gm.totals.actualUsed, totalAllot || null, true)}
        </div>
      </div>

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
