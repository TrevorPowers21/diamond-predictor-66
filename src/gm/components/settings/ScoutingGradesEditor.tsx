/**
 * Scouting Grades template editor — the fully-customizable per-team field set +
 * word scale a staff grades recruits on (rename/add/remove/reorder fields,
 * relabel the scale, separate per hitter/pitcher/TWP). Shared component rendered
 * BOTH inline on the central GM Settings page AND inside the Recruiting Board's
 * "GM Settings → Scouting Grades" popup, so the two surfaces never drift. The
 * mobile grader + web report read whatever's saved here.
 */
import { useEffect, useState } from "react";
import { type RecruitType } from "@/gm/hooks/useGmRecruits";
import { useScoutTemplate, useSaveScoutTemplate, useResetScoutTemplate } from "@/gm/hooks/useScoutTemplate";
import { type ScoutField, type ScoutFieldType, type ScoutScaleLevel } from "@/gm/lib/scoutTemplate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Plus, Trash2, ChevronUp, ChevronDown, RotateCcw, Save } from "lucide-react";
import { GOLD } from "@/savant/lib/theme";


const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;
const TYPES = [{ key: "hitter", label: "Hitters" }, { key: "pitcher", label: "Pitchers" }, { key: "twp", label: "Two-Way" }] as const;
const FIELD_TYPES: { value: ScoutFieldType; label: string }[] = [
  { value: "grade", label: "Grade" }, { value: "text", label: "Free Text" }, { value: "velo", label: "Velocity" },
];
const newKey = () => `f${Math.random().toString(36).slice(2, 8)}`;

export function ScoutingGradesEditor() {
  const [type, setType] = useState<RecruitType>("hitter");
  return (
    <div>
      <div className="mb-4 flex overflow-hidden rounded-md border border-border/60 w-fit">
        {TYPES.map((t) => (
          <button key={t.key} onClick={() => setType(t.key)}
            className={cn("cursor-pointer px-4 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors", type === t.key ? "bg-[#D4AF37]/15 text-[#D4AF37]" : "text-muted-foreground hover:bg-muted/60")}
            style={OSWALD}>{t.label}</button>
        ))}
      </div>
      <TemplateEditor key={type} playerType={type} />
    </div>
  );
}

function TemplateEditor({ playerType }: { playerType: RecruitType }) {
  const tpl = useScoutTemplate(playerType);
  const save = useSaveScoutTemplate();
  const reset = useResetScoutTemplate();
  const [fields, setFields] = useState<ScoutField[]>([]);
  const [scale, setScale] = useState<ScoutScaleLevel[]>([]);
  // Seed (and re-seed) from whatever's saved / defaults when it loads.
  useEffect(() => { setFields(tpl.fields.map((f) => ({ ...f }))); setScale(tpl.scale.map((s) => ({ ...s }))); }, [JSON.stringify(tpl)]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (i: number, dir: -1 | 1) => setFields((fs) => {
    const j = i + dir; if (j < 0 || j >= fs.length) return fs;
    const n = [...fs];[n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const setField = (i: number, patch: Partial<ScoutField>) => setFields((fs) => fs.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const addField = () => setFields((fs) => [...fs, { key: newKey(), label: "", type: "grade", order: fs.length }]);
  const removeField = (i: number) => setFields((fs) => fs.filter((_, k) => k !== i));

  const onSave = () => save.mutate({
    playerType,
    fields: fields.filter((f) => f.label.trim()).map((f, i) => ({ ...f, label: f.label.trim(), order: i })),
    scale: scale.filter((s) => s.label.trim()).map((s) => ({ ...s, label: s.label.trim() })),
  });

  return (
    <div className="space-y-4 rounded-md border border-border/60 bg-card/40 p-4">
      {/* fields */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground" style={OSWALD}>Fields</div>
        {fields.map((f, i) => (
          <div key={f.key} className="flex items-center gap-2">
            <div className="flex flex-col">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="text-muted-foreground disabled:opacity-30 hover:text-foreground"><ChevronUp className="h-3.5 w-3.5" /></button>
              <button onClick={() => move(i, 1)} disabled={i === fields.length - 1} className="text-muted-foreground disabled:opacity-30 hover:text-foreground"><ChevronDown className="h-3.5 w-3.5" /></button>
            </div>
            <Input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Field name" className="h-9 flex-1 text-sm" />
            <Select value={f.type} onValueChange={(v) => setField(i, { type: v as ScoutFieldType })}>
              <SelectTrigger className="h-9 w-28 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>)}</SelectContent>
            </Select>
            <button onClick={() => removeField(i)} className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:text-red-400" aria-label="Remove field"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button onClick={addField} className="inline-flex items-center gap-1.5 rounded border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-2.5 py-1 text-[11px] font-semibold text-[#D4AF37] transition-opacity hover:opacity-80" style={OSWALD}>
          <Plus className="h-3.5 w-3.5" /> Add Field
        </button>
      </div>

      {/* scale */}
      <div className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground" style={OSWALD}>Grade Scale (low → high)</div>
        <div className="flex flex-wrap gap-2">
          {scale.map((s, i) => (
            <div key={s.ordinal} className="flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1">
              <span className="text-[10px] tabular-nums text-muted-foreground">{s.ordinal}</span>
              <Input value={s.label} onChange={(e) => setScale((sc) => sc.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} className="h-7 w-28 border-0 bg-transparent px-1 text-sm" />
              <button onClick={() => setScale((sc) => sc.filter((_, k) => k !== i))} className="text-muted-foreground hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
          <button onClick={() => setScale((sc) => [...sc, { ordinal: (sc.reduce((m, x) => Math.max(m, x.ordinal), 0)) + 1, label: "" }])}
            className="inline-flex items-center gap-1.5 rounded border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3 py-1.5 text-[11px] font-semibold text-[#D4AF37] hover:opacity-80" style={OSWALD}>
            <Plus className="h-3 w-3" /> Level
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button onClick={onSave} disabled={save.isPending} size="sm" style={{ backgroundColor: GOLD, color: "#070e1f", ...OSWALD }} className="uppercase tracking-wide">
          <Save className="mr-1.5 h-3.5 w-3.5" /> Save Template
        </Button>
        <Button onClick={() => reset.mutate(playerType)} disabled={reset.isPending} variant="ghost" size="sm" className="text-muted-foreground">
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset to defaults
        </Button>
      </div>
    </div>
  );
}
