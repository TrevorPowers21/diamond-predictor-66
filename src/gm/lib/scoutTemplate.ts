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
// A recruit's stored grades: field key → ordinal (grade), raw string (text), or velo.
export type ScoutGrades = Record<string, number | string | VeloValue | null>;

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

/** Is a single grade value "filled"? (handles velo objects.) */
export const gradeFilled = (val: number | string | VeloValue | null | undefined): boolean => {
  if (val == null || val === "") return false;
  if (typeof val === "object") return !!(val.range || val.max);
  return true;
};
/** Are there any non-empty grades in this blob? */
export const hasGrades = (grades: ScoutGrades | null | undefined): boolean =>
  !!grades && Object.values(grades).some(gradeFilled);
