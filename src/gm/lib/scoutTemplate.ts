/**
 * Scouting grade template — the fully-customizable, per-team field set + word
 * scale a staff grades recruits on (design: RECRUIT_IDENTITY_AND_MOBILE_ADD_SPEC).
 *
 * Grades are stored on each report by STABLE field `key` + scale ORDINAL (1..5),
 * never the visible label — so a staff renaming a field or relabeling the scale
 * never breaks prior graded reports. These are the in-code DEFAULTS; a team's
 * `gm_scout_template` row (once they customize) overrides them per player_type.
 */
import type { RecruitType } from "@/gm/hooks/useGmRecruits";

export type ScoutFieldType = "grade" | "text" | "velo";
export interface ScoutField { key: string; label: string; type: ScoutFieldType; order: number }
export interface ScoutScaleLevel { ordinal: number; label: string }
export interface ScoutTemplate { fields: ScoutField[]; scale: ScoutScaleLevel[] }

// A velocity field stores a range + a single max number.
export interface VeloValue { range?: string; max?: string }
// A per-report ad-hoc pitch a coach named on the fly. Its name travels WITH the
// value because the field isn't in the team template (label + a scale ordinal).
export interface CustomGrade { label: string; ord: number | null }
// A recruit's stored grades: field key → ordinal (grade), raw string (text),
// velo range+max, or a per-report custom pitch.
export type ScoutGrades = Record<string, number | string | VeloValue | CustomGrade | null>;

export const DEFAULT_SCALE: ScoutScaleLevel[] = [
  { ordinal: 1, label: "Below Avg" },
  { ordinal: 2, label: "Average" },
  { ordinal: 3, label: "Above Average" },
  { ordinal: 4, label: "Plus" },
  { ordinal: 5, label: "Elite" },
];

const g = (key: string, label: string, order: number): ScoutField => ({ key, label, type: "grade", order });
const v = (key: string, label: string, order: number): ScoutField => ({ key, label, type: "velo", order });

// Hitter tools; pitcher = FB Velocity (range + max) + 4 pitch/command grades;
// TWP = hitter ∪ pitcher fields with a SINGLE shared Athleticism (Trevor 2026-07-29).
const HITTER: ScoutField[] = [g("hit", "Hit", 0), g("power", "Power", 1), g("run", "Run", 2), g("field", "Defense", 3), g("arm", "Arm Strength", 4), g("athleticism", "Athleticism", 5)];
const PITCHER: ScoutField[] = [v("velocity", "FB Velocity", 0), g("fb", "Fastball", 1), g("breaking", "Breaking Ball", 2), g("change", "Change-up", 3), g("command", "Command", 4), g("athleticism", "Athleticism", 5)];
const TWP: ScoutField[] = [g("hit", "Hit", 0), g("power", "Power", 1), g("run", "Run", 2), g("field", "Defense", 3), g("arm", "Arm Strength", 4), v("velocity", "FB Velocity", 5), g("fb", "Fastball", 6), g("breaking", "Breaking Ball", 7), g("change", "Change-up", 8), g("command", "Command", 9), g("athleticism", "Athleticism", 10)];

export const DEFAULT_TEMPLATES: Record<RecruitType, ScoutTemplate> = {
  hitter: { fields: HITTER, scale: DEFAULT_SCALE },
  pitcher: { fields: PITCHER, scale: DEFAULT_SCALE },
  twp: { fields: TWP, scale: DEFAULT_SCALE },
};

/** Word label for a stored grade ordinal, per the (team or default) scale. */
export const scaleLabel = (scale: ScoutScaleLevel[], ordinal: number | null | undefined): string =>
  ordinal == null ? "" : (scale.find((s) => s.ordinal === ordinal)?.label ?? "");

/** Is a single grade value "filled"? (handles velo + custom-pitch objects.) */
export const gradeFilled = (val: number | string | VeloValue | CustomGrade | null | undefined): boolean => {
  if (val == null || val === "") return false;
  if (typeof val === "object") return "ord" in val ? val.ord != null : !!(val.range || val.max);
  return true;
};
/** Are there any non-empty grades in this blob? */
export const hasGrades = (grades: ScoutGrades | null | undefined): boolean =>
  !!grades && Object.values(grades).some(gradeFilled);

/** Per-report ad-hoc pitch fields present in a grades blob (keys not in the team template). */
export const customFieldsIn = (grades: ScoutGrades | null | undefined, template: ScoutTemplate): { key: string; label: string }[] => {
  if (!grades) return [];
  const tk = new Set(template.fields.map((f) => f.key));
  return Object.entries(grades)
    .filter(([k, v]) => !tk.has(k) && !!v && typeof v === "object" && "ord" in (v as object))
    .map(([k, v]) => ({ key: k, label: (v as CustomGrade).label }));
};

/**
 * Compact "Field: value" line summarizing a saved report's grades — maps stable
 * keys → the team template's current labels + scale words, so renaming a field
 * or relabeling the scale never breaks how old reports read. Shared by the
 * mobile composer + the web GM report.
 */
export const gradesSummary = (grades: ScoutGrades | null | undefined, template: ScoutTemplate): string => {
  if (!grades) return "";
  const parts: string[] = [];
  for (const f of template.fields) {
    if (!gradeFilled(grades[f.key])) continue;
    const val = grades[f.key];
    if (f.type === "velo") { const vv = (val ?? {}) as VeloValue; parts.push(`${f.label}: ${[vv.range, vv.max ? `${vv.max} max` : ""].filter(Boolean).join(" / ")}`); }
    else if (f.type === "text") parts.push(`${f.label}: ${val}`);
    else parts.push(`${f.label}: ${scaleLabel(template.scale, Number(val))}`);
  }
  for (const cf of customFieldsIn(grades, template)) {
    const cg = grades[cf.key] as CustomGrade;
    if (cg?.ord != null) parts.push(`${cf.label || "Pitch"}: ${scaleLabel(template.scale, cg.ord)}`);
  }
  return parts.join("  ·  ");
};
