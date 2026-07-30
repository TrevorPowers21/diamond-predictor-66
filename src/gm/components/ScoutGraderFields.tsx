/**
 * The dated-report grade grid — rendered from the team's Scouting Grades
 * template. A controlled component (owner holds the `grades` blob) shared by the
 * mobile report composer AND the web GM recruit report, so a coach grades a
 * recruit the same way on either surface. Each field stores a stable key →
 * ordinal (grade) / raw string (velo·text); ad-hoc "+ Add Pitch" fields carry
 * their own label. The write-up comes first; these grades come after.
 */
import { type RecruitType } from "@/gm/hooks/useGmRecruits";
import { type ScoutTemplate, type ScoutGrades, type VeloValue, type CustomGrade, customFieldsIn } from "@/gm/lib/scoutTemplate";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";

const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;

export function ScoutGraderFields({ template, grades, onChange, playerType }: { template: ScoutTemplate; grades: ScoutGrades; onChange: (g: ScoutGrades) => void; playerType: RecruitType }) {
  // Pitchers & TWPs add ad-hoc PITCHES (2nd breaking ball, splitter…); position
  // players add a generic METRIC (a custom tool), not a pitch.
  const isPitcherSide = playerType === "pitcher" || playerType === "twp";
  const addLabel = isPitcherSide ? "Add Pitch" : "Add Metric";
  const customPlaceholder = isPitcherSide ? "Pitch name" : "Metric name";
  const setG = (key: string, val: number | string | VeloValue | CustomGrade | null) => onChange({ ...grades, [key]: val });
  const addPitch = () => onChange({ ...grades, [`c${Math.random().toString(36).slice(2, 9)}`]: { label: "", ord: null } });
  const removeField = (key: string) => { const n = { ...grades }; delete n[key]; onChange(n); };

  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-3">
      <div className="mb-2.5 text-[12px] uppercase tracking-[0.15em] text-[#D4AF37]" style={OSWALD}>Grades</div>
      <div className="flex flex-col gap-2">
        {template.fields.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-2">
            <span className="text-[13px] text-foreground">{f.label}</span>
            {f.type === "velo" ? (
              <div className="flex items-center gap-1.5">
                <Input value={(grades[f.key] as VeloValue | undefined)?.range ?? ""} onChange={(e) => setG(f.key, { ...(grades[f.key] as VeloValue), range: e.target.value })} placeholder="90-93" autoComplete="new-password" className="h-9 w-[4.5rem] text-sm" />
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">max</span>
                <Input value={(grades[f.key] as VeloValue | undefined)?.max ?? ""} onChange={(e) => setG(f.key, { ...(grades[f.key] as VeloValue), max: e.target.value })} inputMode="numeric" placeholder="95" autoComplete="new-password" className="h-9 w-14 text-sm" />
              </div>
            ) : f.type === "text" ? (
              <Input value={String(grades[f.key] ?? "")} onChange={(e) => setG(f.key, e.target.value)} placeholder="e.g. 90-93" autoComplete="new-password" className="h-9 w-28 text-sm" />
            ) : (
              <Select value={grades[f.key] != null ? String(grades[f.key]) : ""} onValueChange={(val) => setG(f.key, Number(val))}>
                <SelectTrigger className="h-9 w-40 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{template.scale.map((s) => <SelectItem key={s.ordinal} value={String(s.ordinal)} className="text-xs">{s.label}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
        ))}
        {customFieldsIn(grades, template).map((cf) => {
          const cg = (grades[cf.key] ?? { label: "", ord: null }) as CustomGrade;
          return (
            <div key={cf.key} className="flex items-center gap-2">
              <Input value={cg.label ?? ""} onChange={(e) => setG(cf.key, { ...cg, label: e.target.value })} placeholder={customPlaceholder} autoComplete="new-password" className="h-9 flex-1 text-sm" />
              <Select value={cg.ord != null ? String(cg.ord) : ""} onValueChange={(val) => setG(cf.key, { ...cg, ord: Number(val) })}>
                <SelectTrigger className="h-9 w-32 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{template.scale.map((s) => <SelectItem key={s.ordinal} value={String(s.ordinal)} className="text-xs">{s.label}</SelectItem>)}</SelectContent>
              </Select>
              <button type="button" onClick={() => removeField(cf.key)} className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground" aria-label="Remove pitch"><X className="h-3.5 w-3.5" /></button>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={addPitch} className="mt-2 inline-flex w-fit items-center gap-1.5 rounded border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-2.5 py-1 text-[11px] font-semibold text-[#D4AF37] transition-opacity hover:opacity-80" style={OSWALD}>
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </button>
    </div>
  );
}

/** Drop ad-hoc pitch fields that were added but never named, before saving. */
export const cleanGrades = (grades: ScoutGrades): ScoutGrades => {
  const clean: ScoutGrades = {};
  for (const [k, val] of Object.entries(grades)) {
    if (val && typeof val === "object" && "ord" in val && !((val as CustomGrade).label || "").trim()) continue;
    clean[k] = val;
  }
  return clean;
};
