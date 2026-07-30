/**
 * ScoutEntryComposer — the popup that captures ONE dated entry: a date, an
 * optional projection tier, a roomy write-up, and (when a template is passed)
 * the grade grid. Shared by the mobile recruiting board, the desktop card's "+"
 * flow, and the desktop Add/Edit dialog — so a coach composes a scouting report
 * or a contact note the exact same way everywhere. Grades come AFTER the write-up.
 */
import { useEffect, useState } from "react";
import { RECRUIT_TIERS, type RecruitTier, type RecruitType } from "@/gm/hooks/useGmRecruits";
import { type ScoutTemplate, type ScoutGrades } from "@/gm/lib/scoutTemplate";
import { ScoutGraderFields, cleanGrades } from "@/gm/components/ScoutGraderFields";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays } from "lucide-react";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;

export const today = () => new Date().toISOString().slice(0, 10);
export const toYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// App-consistent date picker (Popover + Calendar) — replaces the native
// <input type="date"> so there's no Chrome-specific dropdown. Caps at today.
export function DatePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(value + "T00:00:00") : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-2 text-[13px] text-foreground transition-colors hover:bg-muted/40">
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
          {selected ? selected.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Pick date"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={selected} defaultMonth={selected}
          onSelect={(d) => { if (d) { onChange(toYmd(d)); setOpen(false); } }}
          disabled={(d) => d > new Date()} initialFocus />
      </PopoverContent>
    </Popover>
  );
}

export function ScoutEntryComposer({ open, onOpenChange, title, withTier, rows, placeholder, initial, template, playerType, onSave }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; withTier?: boolean; rows: number; placeholder: string;
  initial?: { date?: string; body?: string; tier?: string; grades?: ScoutGrades };
  template?: ScoutTemplate;
  playerType?: RecruitType;
  onSave: (date: string, body: string, tier?: string, grades?: ScoutGrades) => void;
}) {
  const [date, setDate] = useState(today()); const [body, setBody] = useState(""); const [tier, setTier] = useState("");
  const [grades, setGrades] = useState<ScoutGrades>({});
  // Seed fresh (or from the entry being edited / carried-forward) each open.
  useEffect(() => { if (open) { setDate(initial?.date ?? today()); setBody(initial?.body ?? ""); setTier(initial?.tier ?? ""); setGrades(initial?.grades ?? {}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => {
    if (!body.trim()) return;
    onSave(date, body.trim(), tier || undefined, template ? cleanGrades(grades) : undefined);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle style={OSWALD} className="text-lg">{title}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          <div className="flex items-center gap-2">
            <DatePicker value={date} onChange={setDate} />
            {withTier && (
              <Select value={tier} onValueChange={setTier}>
                <SelectTrigger className="h-10 flex-1 text-sm"><SelectValue placeholder="Tier" /></SelectTrigger>
                <SelectContent>{RECRUIT_TIERS.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={rows} placeholder={placeholder} className="bg-card text-[15px] leading-relaxed" autoComplete="off" autoFocus />

          {template && <ScoutGraderFields template={template} grades={grades} onChange={setGrades} playerType={playerType ?? "hitter"} />}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!body.trim()} style={OSWALD} className="uppercase tracking-wide">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
