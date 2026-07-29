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

export type ScoutFieldType = "grade" | "text";
export interface ScoutField { key: string; label: string; type: ScoutFieldType; order: number }
export interface ScoutScaleLevel { ordinal: number; label: string }
export interface ScoutTemplate { fields: ScoutField[]; scale: ScoutScaleLevel[] }

// A recruit's stored grades: field key → ordinal (grade) or raw string (text).
export type ScoutGrades = Record<string, number | string | null>;

export const DEFAULT_SCALE: ScoutScaleLevel[] = [
  { ordinal: 1, label: "Below Avg" },
  { ordinal: 2, label: "Average" },
  { ordinal: 3, label: "Above Average" },
  { ordinal: 4, label: "Plus" },
  { ordinal: 5, label: "Elite" },
];

const g = (key: string, label: string, order: number): ScoutField => ({ key, label, type: "grade", order });
const t = (key: string, label: string, order: number): ScoutField => ({ key, label, type: "text", order });

// Hitter tools, pitcher (velo free-text + 4 pitch/command grades), and TWP =
// hitter ∪ pitcher fields with a SINGLE shared Athleticism (Trevor 2026-07-29).
const HITTER: ScoutField[] = [g("hit", "Hit", 0), g("power", "Power", 1), g("run", "Run", 2), g("field", "Field", 3), g("arm", "Arm", 4), g("athleticism", "Athleticism", 5)];
const PITCHER: ScoutField[] = [t("velocity", "Velocity", 0), g("fb", "FB", 1), g("breaking", "Breaking", 2), g("change", "Change", 3), g("command", "Command", 4), g("athleticism", "Athleticism", 5)];
const TWP: ScoutField[] = [g("hit", "Hit", 0), g("power", "Power", 1), g("run", "Run", 2), g("field", "Field", 3), g("arm", "Arm", 4), t("velocity", "Velocity", 5), g("fb", "FB", 6), g("breaking", "Breaking", 7), g("change", "Change", 8), g("command", "Command", 9), g("athleticism", "Athleticism", 10)];

export const DEFAULT_TEMPLATES: Record<RecruitType, ScoutTemplate> = {
  hitter: { fields: HITTER, scale: DEFAULT_SCALE },
  pitcher: { fields: PITCHER, scale: DEFAULT_SCALE },
  twp: { fields: TWP, scale: DEFAULT_SCALE },
};

/** Word label for a stored grade ordinal, per the (team or default) scale. */
export const scaleLabel = (scale: ScoutScaleLevel[], ordinal: number | null | undefined): string =>
  ordinal == null ? "" : (scale.find((s) => s.ordinal === ordinal)?.label ?? "");

/** Are there any non-empty grades in this blob? */
export const hasGrades = (grades: ScoutGrades | null | undefined): boolean =>
  !!grades && Object.values(grades).some((v) => v != null && v !== "");
