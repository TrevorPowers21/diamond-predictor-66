import { useEffect, useState } from "react";
import type { GmRow, RowMoney, ScholarshipMode } from "@/gm/hooks/useGmRoster";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const OSWALD = { fontFamily: "Oswald, sans-serif" } as const;
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[^0-9.]/g, "")) || null);

// Edit a rostered player's compensation from the Financials tab — the same
// write the roster-management page uses. "Save" persists to the roster store;
// "Finalize" also syncs Actual Pay to the coach's Team Builder build.
export default function PlayerCompensationDialog({
  open, onOpenChange, row, schMode, finalized, onSubmit, isSaving,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  row: GmRow;
  schMode: ScholarshipMode;
  finalized: boolean;
  onSubmit: (money: RowMoney, finalize: boolean, onDone: () => void) => void;
  isSaving: boolean;
}) {
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    const s = (v: number | null | undefined) => (v == null ? "" : String(v));
    setF({
      rev_share: s(row.rev_share),
      nil_amount: s(row.nil_amount),
      other_amount: s(row.other_amount),
      scholarship_amount: s(row.scholarship_amount),
    });
  }, [open, row]);

  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  const money = (): RowMoney => ({
    rev_share: numOrNull(f.rev_share),
    nil_amount: numOrNull(f.nil_amount),
    other_amount: numOrNull(f.other_amount),
    scholarship_amount: numOrNull(f.scholarship_amount),
  });

  const field = (label: string, node: React.ReactNode, hint?: string) => (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</label>
      {node}
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
  const dollar = (k: string) => <Input value={f[k] ?? ""} onChange={(e) => set(k, e.target.value)} inputMode="decimal" placeholder="$0" className="h-9 text-sm" />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle style={OSWALD}>Edit Compensation — {row.name}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {field("Revenue Share", dollar("rev_share"))}
          {field("NIL", dollar("nil_amount"), "Player amount; contract/vendor NIL adds on top.")}
          {field("Other", dollar("other_amount"))}
          {field(
            schMode === "dollar" ? "Scholarship ($)" : "Scholarship (%)",
            <div className="relative">
              <Input value={f.scholarship_amount ?? ""} onChange={(e) => set("scholarship_amount", e.target.value)} inputMode="decimal" placeholder={schMode === "dollar" ? "$0" : "e.g. 35"} className="h-9 pr-6 text-sm" />
              {schMode !== "dollar" && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>}
            </div>,
            "Aid — not part of Total Pay.",
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Save writes to roster management. Finalize also locks Actual Pay (Rev + NIL + Other) and syncs it to the coach's Team Builder.
          {finalized && <span className="text-[#D4AF37]"> Currently finalized.</span>}
        </p>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="secondary" size="sm" disabled={isSaving} onClick={() => onSubmit(money(), false, () => onOpenChange(false))}>{isSaving ? "Saving…" : "Save"}</Button>
          <Button size="sm" disabled={isSaving} onClick={() => onSubmit(money(), true, () => onOpenChange(false))}>Finalize &amp; Sync</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
