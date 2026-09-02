/**
 * Season Budget fields — the shared presentation for the GM's four allotments
 * (Revenue Share, NIL, Scholarships, Other) + the live Total. Rendered BOTH in
 * the Roster page's "Edit Budget" dialog (with Save / Finalize & Push) AND inline
 * on the central GM Settings → Roster Management tab (Save only). State lives in
 * the parent, so each surface owns its own seeding + footer behavior; only the
 * markup is shared, so the two can't drift.
 */
import { type GmBudget, type ScholarshipMode } from "@/gm/hooks/useGmRoster";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { money, HintLabel, DollarInput } from "@/gm/components/budgetPrimitives";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;

export interface SeasonBudgetValues { rev: number | null; nil: number | null; other: number | null; sch: number | null; schText: string }

export function SeasonBudgetFields({ values, onChange, schMode, onSetScholarshipMode, derivedCaps, coachTotal }: {
  values: SeasonBudgetValues;
  onChange: (patch: Partial<SeasonBudgetValues>) => void;
  schMode: ScholarshipMode;
  onSetScholarshipMode: (m: ScholarshipMode) => void;
  derivedCaps: { nil: number; other: number };
  coachTotal: number | null;
}) {
  const { rev, nil, other, sch, schText } = values;
  // NIL/Other here is the editable BASE pool; the full cap = base + this build's
  // Funding Sources categories (derivedCaps). Both add up.
  const nilCombined = (nil ?? 0) + derivedCaps.nil;
  const otherCombined = (other ?? 0) + derivedCaps.other;
  // Scholarship is aid, NOT part of the comp budget — excluded from the total.
  const total = (rev ?? 0) + nilCombined + otherCombined;

  return (
    <div className="space-y-3 py-1">
      <label className="flex items-center justify-between gap-4">
        <HintLabel style={OSWALD} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Revenue Share</HintLabel>
        <DollarInput value={rev} onChange={(n) => onChange({ rev: n })} />
      </label>

      {/* NIL base — general/uncategorized. Funding Sources vendors add on top. */}
      <div>
        <label className="flex items-center justify-between gap-4">
          <HintLabel hint="General NIL pool. Funding Sources vendor categories add on top of this." style={OSWALD} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">NIL</HintLabel>
          <DollarInput value={nil} onChange={(n) => onChange({ nil: n })} />
        </label>
        {derivedCaps.nil > 0 && (
          <p className="mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground">+ {money(derivedCaps.nil)} vendors = <span className="font-semibold text-[#D4AF37]">{money(nilCombined)}</span></p>
        )}
      </div>

      {/* Scholarships: a COUNT of equivalencies (11.7) in % mode, or a dollar pool in $ mode. */}
      <label className="flex items-center justify-between gap-3">
        <HintLabel hint={schMode === "dollar" ? "Total scholarship dollars available" : "Total scholarships available (equivalencies) — not part of the comp budget"} style={OSWALD} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scholarships</HintLabel>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5">
            {(["pct", "dollar"] as const).map((m) => (
              <button key={m} type="button" onClick={() => onSetScholarshipMode(m)}
                className={cn("rounded px-2 py-0.5 text-xs font-semibold transition-colors", schMode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                title={m === "pct" ? "Percent of one scholarship (equivalencies)" : "Flat dollar amount per player"}>
                {m === "pct" ? "%" : "$"}
              </button>
            ))}
          </div>
          {schMode === "dollar"
            ? <DollarInput value={sch} onChange={(n) => onChange({ sch: n })} />
            : <Input value={schText} onChange={(e) => { const t = e.target.value.replace(/[^0-9.]/g, ""); onChange({ schText: t, sch: t === "" ? null : Number(t) }); }} inputMode="decimal" placeholder="e.g. 11.7 or 35" className="h-8 w-24 text-right text-xs font-mono tabular-nums" />}
        </div>
      </label>

      {/* Other base — general/uncategorized. Funding Sources add on top. */}
      <div>
        <label className="flex items-center justify-between gap-4">
          <HintLabel hint="General Other pool. Funding Sources Other categories add on top of this." style={OSWALD} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Other</HintLabel>
          <DollarInput value={other} onChange={(n) => onChange({ other: n })} />
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
  );
}

/** Build the BudgetCaps payload from the editor's current values. */
export const valuesToCaps = (v: SeasonBudgetValues): { rev_share_total: number | null; nil_total: number | null; scholarship_total: number | null; other_total: number | null; other_breakdown: [] } => ({
  rev_share_total: v.rev, nil_total: v.nil, scholarship_total: v.sch, other_total: v.other, other_breakdown: [],
});

/** Seed editor values from a saved/derived budget. */
export const seedValues = (budget: GmBudget | null): SeasonBudgetValues => ({
  rev: budget?.rev_share_total ?? null,
  nil: budget?.nil_total ?? null,
  other: budget?.other_total ?? null,
  sch: budget?.scholarship_total ?? null,
  schText: budget?.scholarship_total != null ? String(budget.scholarship_total) : "",
});
