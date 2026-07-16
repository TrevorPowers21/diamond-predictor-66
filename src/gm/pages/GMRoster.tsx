import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useGmRoster, DEPARTURE_REASONS, type GmBudget, type GmOtherLine, type GmRow, type LocalProjectionTier, type RowMoney, type ScholarshipMode } from "@/gm/hooks/useGmRoster";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, Pencil, Plus, Save, SlidersHorizontal, StickyNote, Trash2 } from "lucide-react";
import PlayerNotesDialog from "@/components/PlayerNotesDialog";
import { getPositionValueMultiplier } from "@/lib/nilProgramSpecific";
import { cn } from "@/lib/utils";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const money = (n: number | null | undefined) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n: number | null | undefined, d = 1) => (n == null ? "—" : n.toFixed(d));
const REASON_LABEL: Record<string, string> = { draft: "Draft Pick", graduation: "Graduation", transfer: "Transfer", other: "Other" };

/** A label with an on-hover tooltip (falls back to a plain span when no hint). */
function HintLabel({ hint, className, style, children }: { hint?: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  if (!hint) return <span className={className} style={style}>{children}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(className, "cursor-help")} style={style}>{children}</span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}
// Matches Team Builder's Add Incoming Freshman position list exactly.
const ADD_POSITIONS = ["C", "1B", "2B", "SS", "3B", "LF", "CF", "RF", "DH", "TWP", "RHP", "LHP"] as const;
const TIER_OPTIONS: { value: LocalProjectionTier; label: string }[] = [
  { value: "developmental", label: "Developmental" },
  { value: "role_player", label: "Role Player" },
  { value: "contributor", label: "Contributor" },
  { value: "immediate_impact", label: "Immediate Impact" },
];

/** Departure-reason dropdown (GM-only). */
function ReasonSelect({ value, onChange }: { value: string | null; onChange: (r: string) => void }) {
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Set reason" /></SelectTrigger>
      <SelectContent>
        {DEPARTURE_REASONS.map((r) => (
          <SelectItem key={r} value={r} className="text-xs">{REASON_LABEL[r]}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

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

// Scholarship is an equivalency: a % of one scholarship (0–100). The % sign is
// pinned inside the box at all times (muted) — you only type the number.
function PctCell({ value, onSave }: { value: number | null; onSave: (n: number | null) => void }) {
  const [local, setLocal] = useState<string | null>(null);
  const display = local != null ? local : value == null ? "" : String(Math.round(value));
  return (
    <div className="relative ml-auto w-20">
      <Input
        value={display}
        inputMode="numeric"
        placeholder="0"
        className="h-8 w-20 pr-5 text-right text-xs font-mono tabular-nums"
        onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ""); setLocal(d === "" ? "" : String(Math.min(100, Number(d)))); }}
        onBlur={() => {
          if (local != null) {
            const d = local.replace(/[^0-9]/g, "");
            onSave(d === "" ? null : Math.min(100, Number(d)));
            setLocal(null);
          }
        }}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
    </div>
  );
}
const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);
const equiv = (usedPct: number) => (usedPct / 100).toFixed(1); // sum of % → scholarship equivalencies


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
type BudgetCaps = { rev_share_total: number | null; nil_total: number | null; scholarship_total: number | null; other_total: number | null; other_breakdown: GmOtherLine[] };
function BudgetDialog({ open, onOpenChange, budget, coachTotal, derivedCaps, onSave, onFinalize, onSetScholarshipMode }: { open: boolean; onOpenChange: (o: boolean) => void; budget: GmBudget | null; coachTotal: number | null; derivedCaps: { nil: number; other: number }; onSave: (caps: BudgetCaps) => void; onFinalize: (caps: BudgetCaps) => void; onSetScholarshipMode: (m: ScholarshipMode) => void }) {
  const [rev, setRev] = useState<number | null>(null);
  const [nil, setNil] = useState<number | null>(null);
  const [other, setOther] = useState<number | null>(null);
  const [sch, setSch] = useState<number | null>(null);
  const [schText, setSchText] = useState(""); // text buffer so "11.7" is typeable
  const schMode = budget?.scholarship_mode ?? "pct";
  // Seed only on the open→ transition so toggling the scholarship unit (which
  // saves + refetches budget) doesn't wipe an unsaved edit.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setRev(budget?.rev_share_total ?? null);
      setNil(budget?.nil_total ?? null);
      setOther(budget?.other_total ?? null);
      setSch(budget?.scholarship_total ?? null);
      setSchText(budget?.scholarship_total != null ? String(budget.scholarship_total) : "");
    }
    wasOpen.current = open;
  }, [open, budget]);
  // NIL/Other here is the editable BASE (general, uncategorized) pool. The full
  // cap = base + this build's Funding Sources categories (derivedCaps). Both
  // add up, so the dialog shows base and the combined total side by side.
  const nilCombined = (nil ?? 0) + derivedCaps.nil;
  const otherCombined = (other ?? 0) + derivedCaps.other;
  // Scholarship is aid, NOT part of the comp budget — excluded from the total.
  const total = (rev ?? 0) + nilCombined + otherCombined;
  const caps = (): BudgetCaps => ({
    rev_share_total: rev,
    nil_total: nil,
    scholarship_total: sch,
    other_total: other,
    other_breakdown: [],
  });
  const field = (label: string, val: number | null, set: (n: number | null) => void, hint?: string) => (
    <label className="flex items-center justify-between gap-4">
      <HintLabel hint={hint} style={OSWALD} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</HintLabel>
      <DollarInput value={val} onChange={set} />
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle style={OSWALD}>Season Budget</DialogTitle></DialogHeader>
        <div className="space-y-3 py-1">
          {field("Revenue Share", rev, setRev)}
          {/* NIL base — general/uncategorized. Funding Sources vendors add on top. */}
          <div>
            <label className="flex items-center justify-between gap-4">
              <HintLabel hint="General NIL pool. Funding Sources vendor categories add on top of this." style={OSWALD} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">NIL</HintLabel>
              <DollarInput value={nil} onChange={setNil} />
            </label>
            {derivedCaps.nil > 0 && (
              <p className="mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">+ {money(derivedCaps.nil)} vendors = <span className="font-semibold text-[#D4AF37]">{money(nilCombined)}</span></p>
            )}
          </div>
          {/* Scholarships: a COUNT of equivalencies (11.7) in % mode, or a dollar pool in $ mode.
              The unit toggle lives here so the season budget owns it; the per-player
              Scholarship column reflects whichever unit is chosen. */}
          <label className="flex items-center justify-between gap-3">
            <HintLabel hint={schMode === "dollar" ? "Total scholarship dollars available" : "Total scholarships available (equivalencies) — not part of the comp budget"} style={OSWALD} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scholarships</HintLabel>
            <div className="flex items-center gap-2">
              <div className="flex gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5">
                {(["pct", "dollar"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onSetScholarshipMode(m)}
                    className={cn("rounded px-2 py-0.5 text-xs font-semibold transition-colors", schMode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                    title={m === "pct" ? "Percent of one scholarship (equivalencies)" : "Flat dollar amount per player"}
                  >
                    {m === "pct" ? "%" : "$"}
                  </button>
                ))}
              </div>
              {schMode === "dollar"
                ? <DollarInput value={sch} onChange={setSch} />
                : <Input value={schText} onChange={(e) => { const t = e.target.value.replace(/[^0-9.]/g, ""); setSchText(t); setSch(t === "" ? null : Number(t)); }} inputMode="decimal" placeholder="e.g. 11.7 or 35" className="h-8 w-24 text-right text-xs font-mono tabular-nums" />}
            </div>
          </label>

          {/* Other base — general/uncategorized. Funding Sources add on top. */}
          <div>
            <label className="flex items-center justify-between gap-4">
              <HintLabel hint="General Other pool. Funding Sources Other categories add on top of this." style={OSWALD} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Other</HintLabel>
              <DollarInput value={other} onChange={setOther} />
            </label>
            {derivedCaps.other > 0 && (
              <p className="mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">+ {money(derivedCaps.other)} sources = <span className="font-semibold text-[#D4AF37]">{money(otherCombined)}</span></p>
            )}
          </div>
          <p className="text-[10px] leading-tight text-muted-foreground">NIL &amp; Other are typable here <span className="font-semibold text-foreground">and</span> on the Funding Sources tab — the two add together into each cap.</p>

          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-xs font-bold uppercase tracking-wider" style={OSWALD}>Total</span>
            <span className={cn("text-base font-bold font-mono tabular-nums", coachTotal != null && Math.round(total) === Math.round(coachTotal) ? "text-emerald-500" : coachTotal != null && total > 0 ? "text-amber-500" : "text-foreground")}>{money(total)}</span>
          </div>
          {coachTotal != null && (
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="uppercase tracking-wider" style={OSWALD}>Coach's Budget</span>
              <span className="font-mono tabular-nums">{money(coachTotal)}</span>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          {/* Save = GM-only draft (this local session). Finalize & Push
              communicates the total to the coach — routed through a confirm. */}
          <Button variant="outline" size="sm" onClick={() => { onSave(caps()); onOpenChange(false); }}>Save</Button>
          <Button size="sm" onClick={() => { onFinalize(caps()); onOpenChange(false); }}>Finalize &amp; Push</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function GMRoster() {
  // Season selector drives a derived, multi-year forward projection. The base
  // season (PROJECTION_SEASON) is the live editable roster; later seasons age
  // eligibility, drop exhausted players, and add committed recruits (read-only).
  const [seasonSel, setSeasonSel] = useState<number>(PROJECTION_SEASON);
  const gm = useGmRoster(seasonSel);
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;
  // Caps staged for the Finalize & Push confirmation (from popup or checkmark).
  const [confirmCaps, setConfirmCaps] = useState<BudgetCaps | null>(null);
  // Local, unsaved edits — money buckets per row and the budget caps. Typing
  // stays here (shown live) and is only written to the DB / pushed to the coach
  // by the row checkmark (rows) or Finalize & Push (budget).
  const [rowDrafts, setRowDrafts] = useState<Record<string, Partial<RowMoney>>>({});
  const [budgetDraft, setBudgetDraft] = useState<BudgetCaps | null>(null);
  // Remove-player flow + build management dialogs.
  const [removeRow, setRemoveRow] = useState<GmRow | null>(null);
  const [removeBuildName, setRemoveBuildName] = useState("");
  const [buildDialog, setBuildDialog] = useState<null | "new" | "rename">(null);
  const [buildName, setBuildName] = useState("");
  const [newBuildOpen, setNewBuildOpen] = useState(false);
  // Departures: batch reason modal (auto-opens once when reasons are pending) + list.
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [departuresOpen, setDeparturesOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [activeRosterOpen, setActiveRosterOpen] = useState(false);
  const [pendingLiveBuild, setPendingLiveBuild] = useState<string>("");
  // Per-player notes — authored + dated log (multiple per player).
  const [noteRow, setNoteRow] = useState<GmRow | null>(null);
  const openNote = (r: GmRow) => { setNoteRow(r); };
  // Deep-link from Recent Activity: ?note=<build_player_id> opens that player's notes.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const noteBp = searchParams.get("note");
    if (!noteBp) return;
    const r = [...gm.hitters, ...gm.pitchers].find((x) => x.player_id === noteBp || x.build_player_id === noteBp);
    if (r) { openNote(r); setSearchParams((p) => { const n = new URLSearchParams(p); n.delete("note"); return n; }, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, gm.hitters, gm.pitchers]);
  const [finalizeRosterOpen, setFinalizeRosterOpen] = useState(false);
  const [finalizePayOpen, setFinalizePayOpen] = useState(false);
  const [addPlayerOpen, setAddPlayerOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPosition, setAddPosition] = useState("");
  const [addTier, setAddTier] = useState<LocalProjectionTier>("");
  const [addNil, setAddNil] = useState<number | null>(null);
  const [addBuildName, setAddBuildName] = useState("");
  const reasonPrompted = useRef(false);
  useEffect(() => {
    if (gm.pendingReasonCount > 0 && !reasonPrompted.current) {
      reasonPrompted.current = true;
      setReasonModalOpen(true);
    }
  }, [gm.pendingReasonCount]);

  const moneyFromDraft = (r: GmRow, d: Partial<RowMoney>): RowMoney => {
    const pick = (k: keyof RowMoney) => (k in d ? d[k] ?? null : ((r[k] as number | null) ?? null));
    return { scholarship_amount: pick("scholarship_amount"), rev_share: pick("rev_share"), nil_amount: pick("nil_amount"), other_amount: pick("other_amount") };
  };
  const effMoney = (r: GmRow): RowMoney => moneyFromDraft(r, rowDrafts[r.build_player_id] ?? {});
  // Every edit auto-saves for this local session (silent draft upsert). No manual
  // Save needed — it stays until Finalize pushes it to the coach.
  const setRowField = (r: GmRow, field: keyof RowMoney, val: number | null) => {
    const nextDraft = { ...(rowDrafts[r.build_player_id] ?? {}), [field]: val };
    setRowDrafts((prev) => ({ ...prev, [r.build_player_id]: nextDraft }));
    gm.saveRosterDraft([{ row: r, money: moneyFromDraft(r, nextDraft) }], undefined, true);
  };
  const rowDirty = (r: GmRow) => !!rowDrafts[r.build_player_id];
  const hasDrafts = Object.keys(rowDrafts).length > 0;
  // Actual Pay defaults to the coach's Team-Builder number (nil_value). Once any
  // pay bucket (Rev / NIL / Other) is entered it becomes their live sum; clear
  // them all and it falls back to the coach number again.
  // NIL/Other totals = Unassigned (nil_amount/other_amount) + funding-vendor
  // allocations (nil_vendor/other_vendor, read-only). Actual Pay sums them all.
  const rowActual = (r: GmRow): number | null => {
    const m = effMoney(r);
    const hasBuckets = m.rev_share != null || m.nil_amount != null || m.other_amount != null || r.nil_vendor > 0 || r.other_vendor > 0;
    return hasBuckets ? (m.rev_share ?? 0) + (m.nil_amount ?? 0) + r.nil_vendor + (m.other_amount ?? 0) + r.other_vendor : (r.nil_value ?? null);
  };
  // Displayed NIL/Other = Unassigned + vendor (null only when both empty).
  const nilTotal = (r: GmRow, m: RowMoney) => (m.nil_amount == null && r.nil_vendor === 0 ? null : (m.nil_amount ?? 0) + r.nil_vendor);
  const otherTotal = (r: GmRow, m: RowMoney) => (m.other_amount == null && r.other_vendor === 0 ? null : (m.other_amount ?? 0) + r.other_vendor);

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
          <Table className="min-w-[1280px]">
            <TableHeader>
              <TableRow style={OSWALD} className="[&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-[11px] [&_th]:text-muted-foreground">

                <TableHead className="sticky left-0 z-20 bg-muted/95 backdrop-blur-sm shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] min-w-[180px]">Player</TableHead>
                <TableHead>Eligibility</TableHead>
                <TableHead className="text-center">Position</TableHead>
                <TableHead className="text-center">WAR</TableHead>
                <TableHead className="text-center">Market Value</TableHead>
                {/* Budget-share projection; falls back to Market Value when no budget. */}
                <TableHead className="text-center">Projected Value</TableHead>
                <TableHead className="text-right" title="% of one scholarship">Scholarship</TableHead>
                <TableHead className="text-right">Rev Share</TableHead>
                <TableHead className="text-right">NIL</TableHead>
                <TableHead className="text-right">Other</TableHead>
                <TableHead className="text-right">Actual Pay</TableHead>
                <TableHead className="text-center w-14" title="Pushed to the coach">Pushed</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const m = effMoney(r);
                const dirty = rowDirty(r);
                const shownFinalized = r.finalized && !dirty; // unsaved edits read as not-finalized
                return (
                <TableRow key={r.build_player_id} className={cn(shownFinalized && "bg-emerald-500/[0.04]", dirty && "bg-amber-500/[0.05]")}>
                  <TableCell className="sticky left-0 z-10 bg-background py-1.5">
                    <span className="inline-flex items-center gap-1.5">
                      {r.player_id ? (
                        <Link to={`/gm/player/${r.player_id}`} state={{ returnTo }} className="text-sm font-medium hover:text-primary hover:underline">
                          {r.name}
                        </Link>
                      ) : (
                        // Coach-added local / injected recruit — no DB player record.
                        <span className="text-sm font-medium">{r.name}</span>
                      )}
                      {r.is_recruit && <span className="shrink-0 rounded bg-[#D4AF37]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#D4AF37]" style={OSWALD}>Commit</span>}
                      {!r.is_recruit && (() => {
                        const nc = gm.notesByBuildPlayer.get(r.build_player_id)?.length ?? 0;
                        return (
                          <button
                            onClick={() => openNote(r)}
                            title={nc > 0 ? `${nc} note${nc === 1 ? "" : "s"}` : "Add note"}
                            className={cn("inline-flex h-5 shrink-0 items-center justify-center gap-0.5 rounded px-0.5 transition-colors cursor-pointer", nc > 0 ? "text-[#D4AF37] hover:bg-[#D4AF37]/10" : "w-5 text-muted-foreground/30 hover:bg-muted hover:text-muted-foreground")}
                          >
                            <StickyNote className="h-3.5 w-3.5" />
                            {nc > 0 && <span className="text-[10px] font-bold tabular-nums">{nc}</span>}
                          </button>
                        );
                      })()}
                    </span>
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
                  {/* Projected off the budget; Market Value when no budget is set. */}
                  <TableCell className="py-1.5 text-center font-mono text-sm font-semibold tabular-nums text-foreground">{money(projectedValue(r) ?? r.market_value)}</TableCell>
                  {/* Money edits stay LOCAL (setRowField) until the checkmark writes them.
                      In a forward projection the money is read-only — you don't negotiate
                      a hypothetical future roster's pay. */}
                  {gm.isProjection ? (
                    <>
                      <TableCell className="py-1.5 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">{schMode === "dollar" ? money(m.scholarship_amount) : pct(m.scholarship_amount)}</TableCell>
                      <TableCell className="py-1.5 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">{money(m.rev_share)}</TableCell>
                      <TableCell className="py-1.5 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">{money(nilTotal(r, m))}</TableCell>
                      <TableCell className="py-1.5 pr-3 text-right font-mono text-sm tabular-nums text-muted-foreground">{money(otherTotal(r, m))}</TableCell>
                      <TableCell className="py-1.5 pr-3 text-right font-mono text-sm font-semibold tabular-nums text-foreground">{money(rowActual(r))}</TableCell>
                      <TableCell />
                      <TableCell />
                    </>
                  ) : (
                    <>
                      <TableCell className="py-1.5">{schMode === "dollar"
                        ? <MoneyCell value={m.scholarship_amount} onSave={(n) => setRowField(r, "scholarship_amount", n)} />
                        : <PctCell value={m.scholarship_amount} onSave={(n) => setRowField(r, "scholarship_amount", n)} />}</TableCell>
                      <TableCell className="py-1.5"><MoneyCell value={m.rev_share} onSave={(n) => setRowField(r, "rev_share", n)} /></TableCell>
                      <TableCell className="py-1.5" title={r.nil_vendor > 0 ? `${money(m.nil_amount ?? 0)} unassigned + ${money(r.nil_vendor)} from vendors` : undefined}>
                        <MoneyCell value={nilTotal(r, m)} onSave={(n) => setRowField(r, "nil_amount", n == null ? null : Math.max(0, n - r.nil_vendor))} />
                      </TableCell>
                      <TableCell className="py-1.5" title={r.other_vendor > 0 ? `${money(m.other_amount ?? 0)} unassigned + ${money(r.other_vendor)} from vendors` : undefined}>
                        <MoneyCell value={otherTotal(r, m)} onSave={(n) => setRowField(r, "other_amount", n == null ? null : Math.max(0, n - r.other_vendor))} />
                      </TableCell>
                      {/* Actual Pay is the coach's agreed number; it ONLY changes when the
                          GM finalizes (checkmark writes the bucket sum back here + to the
                          coach). So it reads the authoritative nil_value, not the live buckets. */}
                      <TableCell className="py-1.5 pr-3 text-right font-mono text-sm font-semibold tabular-nums text-foreground">{money(rowActual(r))}</TableCell>
                      {/* Per-row finalize: the ONLY per-player push to the coach's
                          Team Builder. Click writes this row's Actual Pay to
                          team_build_players.nil_value (finalizePlayer, finalize=true);
                          everything else stays in the GM layer until this is clicked. */}
                      <TableCell className="py-1.5 text-center">
                        <button
                          onClick={() => gm.finalizePlayer(r, effMoney(r), true, () => setRowDrafts((d) => { const n = { ...d }; delete n[r.build_player_id]; return n; }))}
                          disabled={gm.isProjection}
                          title={shownFinalized ? "Finalized — Actual Pay pushed to the coach. Click to re-push the current numbers." : "Finalize & push this player's Actual Pay to the coach's Team Builder"}
                          className={cn("mx-auto inline-flex h-6 w-6 items-center justify-center rounded transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
                            shownFinalized ? "text-emerald-500 hover:bg-emerald-500/10"
                              : dirty ? "text-amber-500 hover:bg-emerald-500/10 hover:text-emerald-500"
                              : "text-muted-foreground/40 hover:bg-emerald-500/10 hover:text-emerald-500")}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      </TableCell>
                      <TableCell className="py-1.5 text-center">
                        <button
                          onClick={() => { setRemoveRow(r); setRemoveBuildName(""); }}
                          title="Remove from roster"
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </>
                  )}
                </TableRow>
                );
              })}
              {rows.length === 0 ? (
                <TableRow><TableCell colSpan={13} className="py-8 text-center text-muted-foreground">No players.</TableCell></TableRow>
              ) : (
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell className="sticky left-0 z-10 bg-muted/40 text-right py-2 pr-3 font-semibold">Totals</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-center font-mono text-sm py-2">{num(sum((r) => r.war), 1)}</TableCell>
                  <TableCell />
                  <TableCell className="text-center font-mono text-sm py-2">{money(sum((r) => projectedValue(r) ?? r.market_value))}</TableCell>
                  <TableCell className="text-right font-mono text-sm py-2 pr-3">{schMode === "dollar" ? money(sum((r) => effMoney(r).scholarship_amount)) : equiv(sum((r) => effMoney(r).scholarship_amount))}</TableCell>
                  <TableCell className="text-right font-mono text-sm py-2 pr-3">{money(sum((r) => effMoney(r).rev_share))}</TableCell>
                  <TableCell className="text-right font-mono text-sm py-2 pr-3">{money(sum((r) => (effMoney(r).nil_amount ?? 0) + r.nil_vendor))}</TableCell>
                  <TableCell className="text-right font-mono text-sm py-2 pr-3">{money(sum((r) => (effMoney(r).other_amount ?? 0) + r.other_vendor))}</TableCell>
                  <TableCell className="text-right font-mono text-sm py-2 pr-3">{money(sum((r) => rowActual(r)))}</TableCell>
                  <TableCell />
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
  // Effective caps: local budget draft (unsaved Save) overrides the DB budget.
  const dbCaps: BudgetCaps = { rev_share_total: b?.rev_share_total ?? null, nil_total: b?.nil_total ?? null, scholarship_total: b?.scholarship_total ?? null, other_total: b?.other_total ?? null, other_breakdown: b?.other_breakdown ?? null };
  const effCaps: BudgetCaps = budgetDraft ?? dbCaps;
  // The Total the GM works against is the coach's number (total_budget), which
  // only changes when the GM Finalizes — exactly like a player's Actual Pay.
  const coachTotalBudget = gm.coachTotalBudget;
  // Used figures reflect the local row drafts, not just the saved DB values.
  const allRows = [...gm.hitters, ...gm.pitchers];

  // Projected Value = Team Builder's budget-share: a player's position-weighted
  // WAR as a share of the roster's total, times the total budget. (The program-
  // tier multiplier cancels in numerator/denominator, so it's omitted; the 33
  // floor matches TB's RAW_WAR_BENCHMARK.) Null when no budget → fall back to
  // Market Value.
  const posWeightedWar = (r: GmRow) => Number(r.war ?? 0) * getPositionValueMultiplier(r.position);
  const rosterScore = allRows.reduce((s, r) => s + posWeightedWar(r), 0);
  const projectedValue = (r: GmRow): number | null => {
    const budget = coachTotalBudget ?? 0;
    if (budget <= 0) return null;
    const denom = Math.max(rosterScore, 33);
    return denom > 0 ? Math.max(0, (posWeightedWar(r) / denom) * budget) : null;
  };
  const usedSum = (f: (m: RowMoney) => number | null) => allRows.reduce((s, r) => s + (f(effMoney(r)) ?? 0), 0);
  const revUsed = usedSum((m) => m.rev_share);
  // NIL/Other used = Unassigned draft + funding-vendor allocations (this build).
  const nilUsed = allRows.reduce((s, r) => s + (effMoney(r).nil_amount ?? 0) + r.nil_vendor, 0);
  const otherUsed = allRows.reduce((s, r) => s + (effMoney(r).other_amount ?? 0) + r.other_vendor, 0);
  const schUsed = usedSum((m) => m.scholarship_amount);
  // Actual Pay = the authoritative coach number (nil_value); only finalize changes it.
  const actualUsed = allRows.reduce((s, r) => s + (rowActual(r) ?? 0), 0);
  // Total budget = the GM's planned allotment (Rev + NIL + Other), which updates
  // on Save like the other boxes. (Scholarships are aid, excluded.)
  // NIL/Other cap = editable base (Edit Budget) + this build's Funding Sources
  // categories (additive). Both surfaces can raise the pool.
  const nilCapTotal = (effCaps.nil_total ?? 0) + gm.derivedCaps.nil;
  const otherCapTotal = (effCaps.other_total ?? 0) + gm.derivedCaps.other;
  const plannedTotal = ((effCaps.rev_share_total ?? 0) + nilCapTotal + otherCapTotal) || null;
  // Scholarship unit: % of one scholarship (equivalencies) or flat $. The GM
  // picks; scholarship_amount holds the raw number in that unit.
  const schMode: ScholarshipMode = gm.budget?.scholarship_mode ?? "pct";
  const popupBudget = { ...effCaps, scholarship_mode: schMode, finalized: !!b?.finalized } as GmBudget;

  // One budget box — read-only. Shows used / allotment as whole dollars; caps
  // are edited only in the Manage Budget popup. Over-cap turns the used red.
  // `accent` gives the Total box a standing gold highlight.
  const box = (label: string, used: number, total: number | null, accent?: boolean, hint?: string, fmt: (n: number) => string = money) => (
    <Card className={cn("flex flex-col items-center px-4 py-3.5 text-center", accent && "border-[#D4AF37]/55 bg-[#D4AF37]/[0.07]")}>
      <HintLabel hint={hint} style={OSWALD} className={cn("text-[11px] font-bold uppercase tracking-[0.14em]", accent ? "text-[#D4AF37]" : "text-foreground/75")}>{label}</HintLabel>
      <div className="mt-2 flex items-baseline justify-center gap-1.5">
        <span className={cn("font-mono font-bold tabular-nums leading-none", accent ? "text-3xl text-[#D4AF37]" : "text-2xl text-foreground", total != null && used > total && "text-red-500")}>{fmt(used)}</span>
        {total != null && (
          <span className={cn("text-xs font-mono tabular-nums", used > total ? "text-red-500 font-semibold" : "text-muted-foreground")}>/ {fmt(total)}</span>
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
            <h2 className="text-2xl font-bold leading-tight" style={OSWALD}>{gm.teamName ?? "Front Office"}</h2>
            <p className="text-sm text-muted-foreground">{gm.teamName ? "Front Office" : "Pick a team above."}</p>
          </div>
          {/* Season selector — base season is editable; later seasons are a derived
              read-only projection (eligibility aged, graduates dropped, commits added). */}
          <Select value={String(seasonSel)} onValueChange={(v) => setSeasonSel(Number(v))}>
            <SelectTrigger className="h-8 w-[100px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[PROJECTION_SEASON, PROJECTION_SEASON + 1, PROJECTION_SEASON + 2, PROJECTION_SEASON + 3].map((y) => (
                <SelectItem key={y} value={String(y)} className="text-xs">{y}{y === PROJECTION_SEASON ? "" : " (proj)"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {gm.builds.length > 0 && (
            <Select value={gm.selectedBuildId ?? undefined} onValueChange={(v) => gm.setSelectedBuildId(v)}>
              <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Select build" /></SelectTrigger>
              <SelectContent>
                {gm.builds.map((bd) => (
                  <SelectItem key={bd.id} value={bd.id} className="text-xs">{bd.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {/* New build (matches Team Builder's dialog) + rename current. */}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setNewBuildOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New Build
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8" title="Rename current build" disabled={gm.activeBuildIsDefault} onClick={() => { setBuildName(gm.builds.find((b) => b.id === gm.selectedBuildId)?.name ?? ""); setBuildDialog("rename"); }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" disabled={gm.isProjection} title={gm.isProjection ? "Switch to the base season to edit the roster" : undefined} onClick={() => { setAddName(""); setAddPosition(""); setAddTier(""); setAddNil(null); setAddBuildName(""); setAddPlayerOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> Add Player
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs" disabled={gm.isProjection || gm.isSavingDraft || !hasDrafts} title="Save your edits privately (not pushed to the coach)" onClick={() => gm.saveRosterDraft(allRows.map((r) => ({ row: r, money: effMoney(r) })), () => setRowDrafts({}))}>
            <Save className="h-3.5 w-3.5" /> {gm.isSavingDraft ? "Saving…" : "Save"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="relative h-8 gap-1.5 text-xs">
                <SlidersHorizontal className="h-3.5 w-3.5" /> GM Settings
                {gm.pendingReasonCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{gm.pendingReasonCount}</span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setBudgetOpen(true)}>Edit Budget</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setPendingLiveBuild(gm.liveBuildId ?? ""); setActiveRosterOpen(true); }}>Change Active Roster</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDeparturesOpen(true)}>
                Departures
                {gm.pendingReasonCount > 0 && (
                  <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{gm.pendingReasonCount}</span>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={gm.isProjection} onClick={() => setFinalizePayOpen(true)}>Finalize Roster Pay → Coach</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setFinalizeRosterOpen(true)}>Finalize {gm.season} Roster</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <BudgetDialog
            open={budgetOpen}
            onOpenChange={setBudgetOpen}
            budget={popupBudget}
            coachTotal={coachTotalBudget}
            derivedCaps={gm.derivedCaps}
            onSetScholarshipMode={(m) => gm.saveBudget({ scholarship_mode: m })}
            onSave={(caps) => { setBudgetDraft(caps); gm.saveBudget(caps); }}
            onFinalize={(caps) => setConfirmCaps(caps)}
          />
          {/* Change Active Roster — pick which build is LIVE (drives every
              player's profile, projected value, and pay). Tucked in GM Settings. */}
          <Dialog open={activeRosterOpen} onOpenChange={setActiveRosterOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle style={OSWALD}>Change Active Roster</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">The <span className="font-semibold text-foreground">active roster</span> is the one build that drives every player's profile, projected WAR / market value, and pay across the whole app. Changing it updates what everyone sees.</p>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live build</label>
                  <Select value={pendingLiveBuild} onValueChange={setPendingLiveBuild}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select build" /></SelectTrigger>
                    <SelectContent>
                      {gm.builds.map((b) => (
                        <SelectItem key={b.id} value={b.id} className="text-sm">{b.name}{b.id === gm.liveBuildId ? " · current" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setActiveRosterOpen(false)}>Cancel</Button>
                <Button size="sm" disabled={!pendingLiveBuild || pendingLiveBuild === gm.liveBuildId || gm.isChangingLiveBuild}
                  onClick={() => { gm.setLiveBuild(pendingLiveBuild); setActiveRosterOpen(false); }}>
                  {gm.isChangingLiveBuild ? "Changing…" : "Change & apply"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {/* Per-player notes — authored + dated log, team-shared with the coach's
              Team Builder (same gm_player_notes rows keyed by build_player_id). */}
          <PlayerNotesDialog
            open={!!noteRow}
            onOpenChange={(o) => { if (!o) setNoteRow(null); }}
            playerName={noteRow?.name ?? "Player"}
            notes={gm.notesByBuildPlayer.get(noteRow?.build_player_id ?? "") ?? []}
            onAdd={(body) => { if (noteRow) gm.addNote(noteRow, body); }}
            onRemove={(id) => gm.removeNote(id)}
            subtitle="Scouting or negotiation context. Each note is stamped with the date and who wrote it. Shared with your staff and the coach's Team Builder."
          />
        </div>
      </div>

      {/* Budget — each bucket in its own box: Scholarship · NIL · Other on top,
          Revenue Share · Total on the second row. The scholarship $/% unit lives
          in the Season Budget dialog. */}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {schMode === "dollar"
            ? box("Scholarships", schUsed, effCaps.scholarship_total, false, "Scholarship dollars used vs. available")
            : box("Scholarships", schUsed / 100, effCaps.scholarship_total, false, "Equivalencies used vs. available — not part of the comp budget", (n) => n.toFixed(1))}
          {box("NIL", nilUsed, nilCapTotal)}
          {box("Other", otherUsed, otherCapTotal)}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {box("Revenue Share", revUsed, effCaps.rev_share_total)}
          {box("Total", actualUsed, plannedTotal, true)}
        </div>
      </div>

      {gm.isProjection && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border-l-2 border-[#D4AF37] bg-[#D4AF37]/[0.06] px-3 py-2 text-xs">
          <span className="font-semibold uppercase tracking-wider text-[#D4AF37]" style={OSWALD}>Projected {seasonSel}</span>
          <span className="text-muted-foreground">
            Derived from the {PROJECTION_SEASON} build — eligibility advanced {seasonSel - PROJECTION_SEASON} {seasonSel - PROJECTION_SEASON === 1 ? "year" : "years"}, exhausted players removed
            {gm.injectedCommitCount > 0 ? `, ${gm.injectedCommitCount} committed ${gm.injectedCommitCount === 1 ? "recruit" : "recruits"} added` : ""}. Read-only.
          </span>
        </div>
      )}

      {gm.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading roster…</p>
      ) : (
        <>
          {section("Position Players", gm.hitters)}
          {section("Pitchers", gm.pitchers)}
        </>
      )}

      {/* Shared Finalize & Push confirmation (from the popup or the checkmark). */}
      <AlertDialog open={!!confirmCaps} onOpenChange={(o) => { if (!o) setConfirmCaps(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle style={OSWALD}>Push budget to Team Builder?</AlertDialogTitle>
            <AlertDialogDescription>
              This writes the budget total into the coach's Team Builder and changes the roster budget they build against — they'll see it immediately. Save keeps changes GM-side; this communicates them to the coach.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={gm.isFinalizing} onClick={() => { if (confirmCaps) gm.commitBudget(confirmCaps); setConfirmCaps(null); setBudgetDraft(null); }}>Confirm &amp; Push</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove player — copy-on-write off the default (named) then mark leaving. */}
      <AlertDialog open={!!removeRow} onOpenChange={(o) => { if (!o) setRemoveRow(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle style={OSWALD}>Remove {removeRow?.name} from roster?</AlertDialogTitle>
            <AlertDialogDescription>
              {gm.activeBuildIsDefault
                ? "You're on the default roster — this starts a new working build off the default (name it below) and marks the player leaving. You'll set the departure reason later."
                : "The player is marked leaving on this build. You'll set the departure reason later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {gm.activeBuildIsDefault && (
            <Input value={removeBuildName} onChange={(e) => setRemoveBuildName(e.target.value)} placeholder="New build name (e.g. 2027 Roster)" className="h-9 text-sm" />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={gm.activeBuildIsDefault && !removeBuildName.trim()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (removeRow) gm.removePlayer(removeRow, removeBuildName); setRemoveRow(null); }}
            >Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename build. */}
      <Dialog open={buildDialog === "rename"} onOpenChange={(o) => { if (!o) setBuildDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle style={OSWALD}>Rename Build</DialogTitle></DialogHeader>
          <div className="py-1">
            <Input value={buildName} onChange={(e) => setBuildName(e.target.value)} placeholder="Build name (e.g. 2027 Final Build)" className="h-9 text-sm" />
          </div>
          <DialogFooter>
            <Button size="sm" disabled={!buildName.trim()} onClick={() => { if (gm.selectedBuildId) gm.renameBuild(gm.selectedBuildId, buildName); setBuildDialog(null); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Build — matches the Team Builder dialog (start from default / clone). */}
      {newBuildOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setNewBuildOpen(false)}>
          <div
            className="w-full max-w-md overflow-hidden rounded-lg border border-l-[3px] shadow-2xl"
            style={{ backgroundColor: "#0a1428", borderColor: "#1f2d52", borderLeftColor: "#D4AF37" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 border-b px-5 pb-4 pt-5" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <div className="flex h-8 w-8 items-center justify-center rounded-md border" style={{ backgroundColor: "rgba(212,175,55,0.10)", borderColor: "rgba(212,175,55,0.30)" }}>
                <Plus className="h-4 w-4" style={{ color: "#D4AF37" }} />
              </div>
              <div>
                <h3 className="font-[Oswald] text-[16px] font-bold uppercase leading-none tracking-[0.08em]" style={{ color: "#D4AF37" }}>Start a New Build</h3>
                <p className="mt-1 text-[12px] text-slate-400">Begin fresh, or branch off an existing roster</p>
              </div>
            </div>
            <div className="px-5 py-4">
              <button
                type="button"
                onClick={() => { const dId = gm.builds.find((b) => b.is_default)?.id; if (dId) gm.createBuild("New Build", dId); setNewBuildOpen(false); }}
                className="flex w-full items-center justify-between gap-3 rounded-md border px-3.5 py-3 text-left transition-colors duration-150 hover:bg-[#D4AF37]/[0.08]"
                style={{ borderColor: "#1f2d52" }}
              >
                <span>
                  <span className="block text-sm font-semibold text-slate-100">Start from default roster</span>
                  <span className="block text-[12px] text-slate-500">Your returners, fresh slate</span>
                </span>
                <span className="shrink-0 font-[Oswald] text-[11px] font-bold uppercase tracking-[0.18em] text-[#D4AF37]">New</span>
              </button>
              {gm.builds.filter((b) => !b.is_default).length > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 font-[Oswald] text-[11px] font-bold uppercase tracking-[0.22em] text-[#D4AF37]">Or clone an existing build</div>
                  <div className="max-h-[200px] overflow-y-auto rounded-md border" style={{ backgroundColor: "#040810", borderColor: "#1f2d52" }}>
                    {gm.builds.filter((b) => !b.is_default).map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => { gm.createBuild(`${b.name} (copy)`, b.id); setNewBuildOpen(false); }}
                        className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm text-slate-100 transition-colors duration-150 hover:bg-[#D4AF37]/[0.08]"
                        style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                      >
                        <span className="truncate">{b.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end border-t px-5 py-3" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <Button variant="ghost" size="sm" onClick={() => setNewBuildOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Incoming Freshman — mirrors Team Builder's fields + stored shape. */}
      <Dialog open={addPlayerOpen} onOpenChange={setAddPlayerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle style={OSWALD}>Add Incoming Freshman</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-[12px] text-muted-foreground">Add a player with no projected stats. Value can still be tracked. (Transfers with data are added in Team Builder.)</p>
            <div>
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Player Name</span>
              <Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="First Last" className="h-9 text-sm" />
            </div>
            <div>
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Position</span>
              <Select value={addPosition} onValueChange={setAddPosition}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select position" /></SelectTrigger>
                <SelectContent>{ADD_POSITIONS.map((p) => <SelectItem key={p} value={p} className="text-xs">{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Projection Tier</span>
              <Select value={addTier || undefined} onValueChange={(v) => setAddTier(v as LocalProjectionTier)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select tier" /></SelectTrigger>
                <SelectContent>{TIER_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>Initial Value ($)</span>
              <DollarInput value={addNil} onChange={setAddNil} />
            </div>
            {gm.activeBuildIsDefault && (
              <div>
                <span className="mb-1 block text-[11px] uppercase tracking-wider text-muted-foreground" style={OSWALD}>New build name</span>
                <Input value={addBuildName} onChange={(e) => setAddBuildName(e.target.value)} placeholder="e.g. 2027 Roster" className="h-9 text-sm" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              size="sm"
              disabled={!addName.trim() || !addPosition || (gm.activeBuildIsDefault && !addBuildName.trim())}
              onClick={() => { gm.addLocalPlayer(addName, addPosition, addTier, addNil ?? 0, addBuildName); setAddPlayerOpen(false); }}
            >Add To Roster</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finalize Roster — lock the active build as next year's default, archive rest. */}
      <AlertDialog open={finalizeRosterOpen} onOpenChange={setFinalizeRosterOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle style={OSWALD}>Finalize {gm.season} roster?</AlertDialogTitle>
            <AlertDialogDescription>
              Locks <span className="font-semibold text-foreground">{gm.builds.find((b) => b.id === gm.selectedBuildId)?.name ?? "this build"}</span> as the {gm.season + 1} default — next year's "everyone returns" baseline. Every other {gm.season} build is archived (recoverable, not deleted). This closes {gm.season} planning.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (gm.selectedBuildId) gm.finalizeRoster(gm.selectedBuildId); setFinalizeRosterOpen(false); }}>Finalize Roster</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Finalize Roster Pay — push every player's Actual Pay + the budget to the coach. */}
      <AlertDialog open={finalizePayOpen} onOpenChange={setFinalizePayOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle style={OSWALD}>Push roster pay to the coach's view?</AlertDialogTitle>
            <AlertDialogDescription>
              This writes <span className="font-semibold text-foreground">every player's Actual Pay</span> and the <span className="font-semibold text-foreground">budget totals</span> to the coach's Team Builder — the numbers they see and plan against. It overwrites what's there now. You can keep editing after; this is just what's currently pushed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={gm.isFinalizingRoster}
              onClick={() => gm.finalizeRosterPay(allRows.map((r) => ({ row: r, money: effMoney(r) })), effCaps, () => { setRowDrafts({}); setFinalizePayOpen(false); })}
            >
              Finalize &amp; Push
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reason batch modal — auto-opens when departures are missing a reason. */}
      <Dialog open={reasonModalOpen} onOpenChange={setReasonModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle style={OSWALD}>Roster decisions need a reason</DialogTitle></DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto py-1">
            {gm.departures.filter((d) => !d.departure_reason).map((d) => (
              <div key={d.build_player_id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">{d.position || "—"}</div>
                </div>
                <ReasonSelect value={null} onChange={(r) => gm.setDepartureReason(d.build_player_id, d.player_id, r)} />
              </div>
            ))}
            {gm.pendingReasonCount === 0 && <p className="py-4 text-center text-sm text-muted-foreground">All departures have a reason.</p>}
          </div>
          <DialogFooter><Button size="sm" onClick={() => setReasonModalOpen(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Departures list — set/change reason, restore to roster. */}
      <Dialog open={departuresOpen} onOpenChange={setDeparturesOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle style={OSWALD}>Departures</DialogTitle></DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto py-1">
            {gm.departures.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No departures on this build.</p>
            ) : (
              gm.departures.map((d) => (
                <div key={d.build_player_id} className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.position || "—"}</div>
                  </div>
                  <ReasonSelect value={d.departure_reason} onChange={(r) => gm.setDepartureReason(d.build_player_id, d.player_id, r)} />
                  <Button variant="ghost" size="sm" className="text-xs" onClick={() => gm.restorePlayer(d.build_player_id)}>Restore</Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
