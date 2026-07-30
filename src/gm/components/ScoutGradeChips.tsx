/**
 * Renders a saved report's grades as colored chips (instead of a plain text line)
 * — grade fields tint along the scale (low = red → avg = neutral → above = blue →
 * plus = gold → elite = green); velo / free-text show neutral. Keyed by stable
 * field key + the team template's current labels, so renames never break old
 * reports. Shared by the mobile report card + the web GM report.
 */
import { type ReactNode } from "react";
import { type RecruitType } from "@/gm/hooks/useGmRecruits";
import { type ScoutTemplate, type ScoutGrades, type VeloValue, type CustomGrade, customFieldsIn, gradeFilled, scaleLabel } from "@/gm/lib/scoutTemplate";
import { cn } from "@/lib/utils";

const NEUTRAL = "bg-muted text-muted-foreground";
const OSWALD = { fontFamily: "'Oswald', sans-serif" } as const;

// Compact preview = just the headline grades for the player type, one clean row.
const HEADLINE: Record<RecruitType, string[]> = {
  hitter: ["hit", "power", "field"],
  pitcher: ["fb", "breaking", "command"],
  twp: ["hit", "power", "fb"],
};

/** Tint a grade by its position along the (possibly custom-length) scale. */
const gradeTone = (ord: number, scaleLen: number): string => {
  const r = scaleLen > 1 ? (ord - 1) / (scaleLen - 1) : 0.5;
  if (r < 0.2) return "bg-red-500/15 text-red-400";
  if (r < 0.45) return "bg-muted text-muted-foreground";
  if (r < 0.7) return "bg-blue-500/15 text-blue-400";
  if (r < 0.9) return "bg-[#D4AF37]/15 text-[#D4AF37]";
  return "bg-emerald-500/15 text-emerald-500";
};

function Chip({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold", tone)}>
      <span className="font-normal opacity-70">{label}</span>
      <span>{value}</span>
    </span>
  );
}

export function ScoutGradeChips({ grades, template, playerType, compact, className }: { grades: ScoutGrades | null | undefined; template: ScoutTemplate; playerType?: RecruitType; compact?: boolean; className?: string }) {
  if (!grades) return null;
  const scaleLen = template.scale.length;
  const chips: ReactNode[] = [];

  if (compact && playerType) {
    // Just the headline grades for this player type — a clean single row.
    for (const key of HEADLINE[playerType]) {
      const f = template.fields.find((x) => x.key === key);
      if (!f || f.type !== "grade" || !gradeFilled(grades[key])) continue;
      chips.push(<Chip key={key} label={f.label} value={scaleLabel(template.scale, Number(grades[key]))} tone={gradeTone(Number(grades[key]), scaleLen)} />);
    }
  } else {
    // Full: every filled grade (velo + free-text neutral; custom pitches/metrics too).
    for (const f of template.fields) {
      if (!gradeFilled(grades[f.key])) continue;
      const val = grades[f.key];
      if (f.type === "velo") { const vv = (val ?? {}) as VeloValue; chips.push(<Chip key={f.key} label={f.label} value={[vv.range, vv.max ? `${vv.max} max` : ""].filter(Boolean).join(" / ")} tone={NEUTRAL} />); }
      else if (f.type === "text") chips.push(<Chip key={f.key} label={f.label} value={String(val)} tone={NEUTRAL} />);
      else chips.push(<Chip key={f.key} label={f.label} value={scaleLabel(template.scale, Number(val))} tone={gradeTone(Number(val), scaleLen)} />);
    }
    for (const cf of customFieldsIn(grades, template)) {
      const cg = grades[cf.key] as CustomGrade;
      if (cg?.ord != null) chips.push(<Chip key={cf.key} label={cf.label || "Pitch"} value={scaleLabel(template.scale, cg.ord)} tone={gradeTone(cg.ord, scaleLen)} />);
    }
  }
  if (!chips.length) return null;
  // Compact = always one line (nowrap, clip if ever too wide); full = wraps.
  return <div className={cn("flex gap-1", compact ? "items-center overflow-hidden [&>span]:shrink-0" : "flex-wrap", className)}>{chips}</div>;
}

/**
 * Read-only vertical grade readout — mirrors the template grader's layout (one row
 * per field: label left, value right) so viewing a saved report reads like the form
 * it was typed in. Grade values render as tinted pills; velo / free-text as plain text.
 */
export function ScoutGradesReadout({ grades, template, className }: { grades: ScoutGrades | null | undefined; template: ScoutTemplate; className?: string }) {
  if (!grades) return null;
  const scaleLen = template.scale.length;
  const rows: ReactNode[] = [];
  const row = (key: string, label: string, value: ReactNode) => (
    <div key={key} className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-1.5 last:border-0 last:pb-0">
      <span className="text-[12px] uppercase tracking-wider text-white" style={OSWALD}>{label}</span>
      {value}
    </div>
  );
  // Field labels are white (readable on navy); the grade value keeps its scale tint.
  const pill = (ord: number) => <span className={cn("rounded px-2 py-0.5 text-[12px] font-semibold", gradeTone(ord, scaleLen))}>{scaleLabel(template.scale, ord)}</span>;
  for (const f of template.fields) {
    if (!gradeFilled(grades[f.key])) continue;
    const val = grades[f.key];
    if (f.type === "velo") { const vv = (val ?? {}) as VeloValue; rows.push(row(f.key, f.label, <span className="text-[14px] font-semibold tabular-nums text-white">{[vv.range, vv.max ? `${vv.max} max` : ""].filter(Boolean).join(" / ")}</span>)); }
    else if (f.type === "text") rows.push(row(f.key, f.label, <span className="text-[14px] font-semibold text-white">{String(val)}</span>));
    else rows.push(row(f.key, f.label, pill(Number(val))));
  }
  for (const cf of customFieldsIn(grades, template)) {
    const cg = grades[cf.key] as CustomGrade;
    if (cg?.ord != null) rows.push(row(cf.key, cf.label || "Pitch", pill(cg.ord)));
  }
  if (!rows.length) return null;
  return (
    <div className={cn("rounded-md border border-[#1f2d52] bg-[#0a1428] p-3", className)}>
      <div className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]" style={OSWALD}>Grades</div>
      <div className="flex flex-col gap-2">{rows}</div>
    </div>
  );
}
