/**
 * Recruiting Budget by Class — the shared editor rendered BOTH inline on the
 * central GM Settings page AND inside the Recruiting Board's "GM Settings →
 * Edit Budget" popup. One component so the two surfaces can never drift.
 * Self-contained: owns its own draft + save via useGmRecruits.
 */
import { useEffect, useState } from "react";
import { useGmRecruits } from "@/gm/hooks/useGmRecruits";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput, parseMoney } from "@/gm/components/MoneyInput";
import { GOLD } from "@/savant/lib/theme";


const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const YEARS = [PROJECTION_SEASON, PROJECTION_SEASON + 1, PROJECTION_SEASON + 2, PROJECTION_SEASON + 3];

/** onSaved lets a popup host close itself after Save Budgets. */
export function RecruitingBudgetEditor({ onSaved }: { onSaved?: () => void }) {
  const gm = useGmRecruits();
  const [draft, setDraft] = useState<Record<number, { budget: string; scholarships: string }>>({});
  useEffect(() => {
    const d: Record<number, { budget: string; scholarships: string }> = {};
    for (const y of YEARS) {
      const c = gm.configByYear.get(y);
      d[y] = { budget: c?.budget != null ? String(c.budget) : "", scholarships: c?.scholarships != null ? String(c.scholarships) : "" };
    }
    setDraft(d);
  }, [gm.configByYear]);

  const saveAll = () => {
    for (const y of YEARS) {
      const d = draft[y];
      gm.saveClassConfig({ class_year: y, budget: parseMoney(d?.budget ?? ""), scholarships: parseMoney(d?.scholarships ?? "") });
    }
    onSaved?.();
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground" style={OSWALD}>
        <span>Class</span><span>Budget ($)</span><span>Scholarships</span>
      </div>
      {YEARS.map((y) => (
        <div key={y} className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2">
          <span className="text-sm font-semibold tabular-nums">{y}</span>
          <MoneyInput value={draft[y]?.budget ?? ""} onChange={(v) => setDraft((d) => ({ ...d, [y]: { ...d[y], budget: v } }))} placeholder="$1,500,000" className="h-9 text-sm" />
          <Input value={draft[y]?.scholarships ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [y]: { ...d[y], scholarships: e.target.value } }))} placeholder="e.g. 11.7" inputMode="decimal" className="h-9 text-sm" />
        </div>
      ))}
      <div className="pt-1">
        <Button onClick={saveAll} size="sm" style={{ backgroundColor: GOLD, color: "#070e1f", ...OSWALD }} className="uppercase tracking-wide">Save Budgets</Button>
      </div>
    </div>
  );
}
