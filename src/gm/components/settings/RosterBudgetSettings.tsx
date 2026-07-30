/**
 * Roster Season Budget — the inline editor on the central GM Settings → Roster
 * Management tab. Renders the SAME shared SeasonBudgetFields the Roster page's
 * "Edit Budget" dialog uses, but with a plain Save (persist the caps); the
 * Finalize & Push-to-coach flow stays on the Roster page (a destructive one-shot,
 * kept off the settings page). Self-contained via useGmRoster.
 */
import { useEffect, useRef, useState } from "react";
import { useGmRoster } from "@/gm/hooks/useGmRoster";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";
import { Button } from "@/components/ui/button";
import { SeasonBudgetFields, seedValues, valuesToCaps, type SeasonBudgetValues } from "@/gm/components/settings/SeasonBudgetFields";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const GOLD = "#D4AF37";

export function RosterBudgetSettings() {
  const gm = useGmRoster(PROJECTION_SEASON);
  const [vals, setVals] = useState<SeasonBudgetValues>(() => seedValues(gm.budget));
  // Seed once, when the saved budget first loads. NOT on every budget change:
  // the scholarship-unit toggle saves + refetches, and re-seeding would wipe
  // unsaved rev/nil/other edits (same reasoning as the dialog's open-seed).
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && gm.budget) { setVals(seedValues(gm.budget)); seeded.current = true; }
  }, [gm.budget]);
  const schMode = gm.budget?.scholarship_mode ?? "pct";

  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-card/40 p-4">
      <SeasonBudgetFields
        values={vals}
        onChange={(patch) => setVals((v) => ({ ...v, ...patch }))}
        schMode={schMode}
        onSetScholarshipMode={(m) => gm.saveBudget({ scholarship_mode: m })}
        derivedCaps={gm.derivedCaps}
        coachTotal={gm.coachTotalBudget}
      />
      <div className="flex justify-end">
        <Button onClick={() => gm.saveBudget(valuesToCaps(vals))} size="sm" style={{ backgroundColor: GOLD, color: "#070e1f", ...OSWALD }} className="uppercase tracking-wide">Save Budget</Button>
      </div>
    </div>
  );
}
