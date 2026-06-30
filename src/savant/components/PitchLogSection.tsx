import { useEffect, useMemo, useRef, useState } from "react";
import PercentileBar from "@/savant/components/PercentileBar";
import { StrikeZonePlot } from "@/savant/components/StrikeZonePlot";
import SprayFieldPanel from "@/savant/components/SprayFieldPanel";
import { PitchMovementPlot } from "@/savant/components/PitchMovementPlot";
import { PitchZoneXwoba } from "@/savant/components/PitchZoneXwoba";
import { PitchZoneUsage } from "@/savant/components/PitchZoneUsage";
import { PitchZoneWhiff } from "@/savant/components/PitchZoneWhiff";
import { PitchUsagePie } from "@/savant/components/PitchUsagePie";
import { PerPitchSuccessTable } from "@/savant/components/PerPitchSuccessTable";
import { usePitchLogPitchLocation } from "@/savant/hooks/usePitchLogPitchLocation";
import {
  usePitchLogHitterTotals,
  usePitchLogPitcherTotals,
} from "@/savant/hooks/usePitchLogTotals";
import { usePitchLogByPitchType } from "@/savant/hooks/usePitchLogByPitchType";
import { usePitchLogHitterByPitchType } from "@/savant/hooks/usePitchLogHitterByPitchType";
import { usePitcherMaster } from "@/savant/hooks/usePitcherMaster";
import {
  usePitchLogHitterPopulation,
  usePitchLogByPitchTypePopulation,
  usePitchLogPitcherPopulation,
} from "@/savant/hooks/usePitchLogPopulation";
import { percentileColor, percentileRank } from "@/savant/lib/percentile";
import {
  type DimensionOption,
  type HitterPitchTypeBreakdown,
  type MetricDef,
  type PitchLogDimensionKey,
  type PitchTypeBreakdown,
  deriveHitterPitchTypeBreakdowns,
  derivePitchTypeBreakdowns,
  HITTER_DIMENSIONS,
  HITTER_METRICS_BALL_FLIGHT,
  HITTER_METRICS_BALL_FLIGHT_BARS,
  HITTER_METRICS_BALL_FLIGHT_FULL,
  HITTER_METRICS_CONTACT,
  HITTER_METRICS_CONTACT_BARS,
  HITTER_METRICS_DISCIPLINE,
  HITTER_METRICS_DISCIPLINE_BARS,
  HITTER_METRICS_SLASH,
  HITTER_QUALIFIED_PA,
  PITCHER_DIMENSIONS,
  PITCHER_METRICS_BATTED_BALL,
  PITCHER_METRICS_DISCIPLINE,
  PITCHER_METRICS_SLASH_AGAINST,
  PITCHER_QUALIFIED_PITCHES,
  safeDiv,
} from "@/savant/lib/pitchLogRates";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";
/** Shared accent color for the header→rows divider in left-column data tables. */
const TABLE_HEADER_BORDER = "rgba(212,175,55,0.30)";

const fmt1 = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const fmtInt = (v: number | null) => (v === null ? "—" : `${Math.round(v)}`);
const fmtPct = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;
const fmtSlash = (v: number | null) =>
  v === null ? "—" : v.toFixed(3).replace(/^0+/, "");

// ────────────────────────────────────────────────────────────────────
// Dimension picker (shared by hitter + pitcher)
// ────────────────────────────────────────────────────────────────────
interface DimensionPickerProps {
  options: readonly DimensionOption[];
  value: PitchLogDimensionKey;
  onChange: (next: PitchLogDimensionKey) => void;
}

// ────────────────────────────────────────────────────────────────────
// Pitch-type picker (Visuals tab — page-wide filter).
// Mirrors DimensionPicker styling: Oswald label, gold dot, navy chrome.
// Default state shows just "PITCH TYPE"; once a type is chosen it
// shows that pitch's name. "ALL" resets to no filter.
// ────────────────────────────────────────────────────────────────────
interface PitchTypePickerProps {
  pitchTypes: readonly string[];
  value: string | null; // null = all
  onChange: (next: string | null) => void;
}

function PitchTypePicker({ pitchTypes, value, onChange }: PitchTypePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);
  const label = value ?? "Pitch Type";
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 border px-3 py-1.5 font-[Oswald] text-sm font-bold uppercase tracking-wider transition-colors duration-150 hover:bg-[#D4AF37]/[0.08]"
        style={{ backgroundColor: "transparent", borderColor: NAVY_BORDER, color: "#FFFFFF" }}
      >
        <span style={{ color: GOLD }}>●</span>
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          style={{ color: GOLD }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden border shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]"
          style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
        >
          <button
            type="button"
            onClick={() => { onChange(null); setOpen(false); }}
            className="block w-full cursor-pointer px-4 py-2 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
            style={{
              color: value == null ? GOLD : "#FFFFFF",
              backgroundColor: value == null ? "rgba(212,175,55,0.06)" : "transparent",
            }}
          >
            All
          </button>
          {pitchTypes.map((pt) => {
            const isActive = pt === value;
            return (
              <button
                key={pt}
                type="button"
                onClick={() => { onChange(pt); setOpen(false); }}
                className="block w-full cursor-pointer px-4 py-2 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
                style={{
                  color: isActive ? GOLD : "#FFFFFF",
                  backgroundColor: isActive ? "rgba(212,175,55,0.06)" : "transparent",
                }}
              >
                {pt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Zone-height picker (Visuals tab — page-wide filter).
// In-zone slices only: upper / middle / lower thirds of the strike zone.
// Above/below the zone could be added later if there's a use case;
// for now we keep it focused on in-zone filtering.
// Uses pz_norm: > 1/3 = upper, |pz_norm| ≤ 1/3 = middle, < −1/3 = lower.
// ────────────────────────────────────────────────────────────────────
type ZoneHeightKey = "all" | "upper" | "middle" | "lower";

const ZONE_HEIGHT_OPTIONS: Array<{ key: ZoneHeightKey; label: string }> = [
  { key: "all", label: "Vertical" },
  { key: "upper", label: "Upper" },
  { key: "middle", label: "Middle" },
  { key: "lower", label: "Lower" },
];

interface ZoneHeightPickerProps {
  value: ZoneHeightKey;
  onChange: (next: ZoneHeightKey) => void;
}

function ZoneHeightPicker({ value, onChange }: ZoneHeightPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);
  const label = value === "all" ? "Vertical" : ZONE_HEIGHT_OPTIONS.find((o) => o.key === value)?.label ?? "Vertical";
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 border px-3 py-1.5 font-[Oswald] text-sm font-bold uppercase tracking-wider transition-colors duration-150 hover:bg-[#D4AF37]/[0.08]"
        style={{ backgroundColor: "transparent", borderColor: NAVY_BORDER, color: "#FFFFFF" }}
      >
        <span style={{ color: GOLD }}>●</span>
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          style={{ color: GOLD }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden border shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]"
          style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
        >
          {ZONE_HEIGHT_OPTIONS.map((o) => {
            const isActive = o.key === value;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => { onChange(o.key); setOpen(false); }}
                className="block w-full cursor-pointer px-4 py-2 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
                style={{
                  color: isActive ? GOLD : "#FFFFFF",
                  backgroundColor: isActive ? "rgba(212,175,55,0.06)" : "transparent",
                }}
              >
                {o.key === "all" ? "All Vertical" : o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function passesZoneHeight(pzNorm: number | null, height: ZoneHeightKey): boolean {
  if (height === "all") return true;
  if (pzNorm == null) return false;
  if (height === "upper") return pzNorm > 1 / 3 && pzNorm <= 1;
  if (height === "middle") return pzNorm >= -1 / 3 && pzNorm <= 1 / 3;
  if (height === "lower") return pzNorm < -1 / 3 && pzNorm >= -1;
  return true;
}

// ────────────────────────────────────────────────────────────────────
// Zone-side picker — horizontal companion to ZoneHeightPicker.
// In-zone slices only: left / middle / right thirds (catcher view).
// Uses px_norm: < −1/3 = left, |px_norm| ≤ 1/3 = middle, > 1/3 = right.
// ────────────────────────────────────────────────────────────────────
type ZoneSideKey = "all" | "left" | "middle" | "right";

const ZONE_SIDE_OPTIONS: Array<{ key: ZoneSideKey; label: string }> = [
  { key: "all", label: "Horizontal" },
  { key: "left", label: "Left" },
  { key: "middle", label: "Middle" },
  { key: "right", label: "Right" },
];

interface ZoneSidePickerProps {
  value: ZoneSideKey;
  onChange: (next: ZoneSideKey) => void;
}

function ZoneSidePicker({ value, onChange }: ZoneSidePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);
  const label = value === "all" ? "Horizontal" : ZONE_SIDE_OPTIONS.find((o) => o.key === value)?.label ?? "Horizontal";
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 border px-3 py-1.5 font-[Oswald] text-sm font-bold uppercase tracking-wider transition-colors duration-150 hover:bg-[#D4AF37]/[0.08]"
        style={{ backgroundColor: "transparent", borderColor: NAVY_BORDER, color: "#FFFFFF" }}
      >
        <span style={{ color: GOLD }}>●</span>
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          style={{ color: GOLD }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden border shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]"
          style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
        >
          {ZONE_SIDE_OPTIONS.map((o) => {
            const isActive = o.key === value;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => { onChange(o.key); setOpen(false); }}
                className="block w-full cursor-pointer px-4 py-2 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
                style={{
                  color: isActive ? GOLD : "#FFFFFF",
                  backgroundColor: isActive ? "rgba(212,175,55,0.06)" : "transparent",
                }}
              >
                {o.key === "all" ? "All Horizontal" : o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function passesZoneSide(pxNorm: number | null, side: ZoneSideKey): boolean {
  if (side === "all") return true;
  if (pxNorm == null) return false;
  if (side === "left") return pxNorm < -1 / 3 && pxNorm >= -1;
  if (side === "middle") return pxNorm >= -1 / 3 && pxNorm <= 1 / 3;
  if (side === "right") return pxNorm > 1 / 3 && pxNorm <= 1;
  return true;
}

// ─────────────────────────────────────────────────────────────────
// ──────────────────────────────────
// Generic multi-select dropdown — checkbox rows, OR semantics, Clear button.
// Empty selection = no filter. Used for Pitch Type + Batted Ball Type.
// ──────────────────────────────────
function MultiSelectPicker<T extends string>({
  label: baseLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ key: T; label: string }>;
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);
  const label = selected.length === 0 ? baseLabel : `${baseLabel} (${selected.length})`;
  const toggle = (k: T) =>
    onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 border px-3 py-1.5 font-[Oswald] text-sm font-bold uppercase tracking-wider transition-colors duration-150 hover:bg-[#D4AF37]/[0.08]"
        style={{ backgroundColor: "transparent", borderColor: NAVY_BORDER, color: "#FFFFFF" }}
      >
        <span style={{ color: GOLD }}>●</span>
        {label}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} style={{ color: GOLD }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[180px] overflow-hidden border py-1 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
          {selected.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mb-1 w-full cursor-pointer px-4 py-1 text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/45 transition-colors hover:text-white/80">
              Clear
            </button>
          )}
          {options.map((o) => {
            const active = selected.includes(o.key);
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => toggle(o.key)}
                className="flex w-full cursor-pointer items-center gap-2 px-4 py-1.5 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
                style={{ color: active ? GOLD : "#FFFFFF" }}
              >
                <span className="flex h-3 w-3 shrink-0 items-center justify-center border" style={{ borderColor: active ? GOLD : NAVY_BORDER, backgroundColor: active ? GOLD : "transparent" }}>
                  {active && (
                    <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-6" stroke="#040810" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────
// Location picker — combined zone filter. Vertical thirds + horizontal
// thirds, MULTI-select. Within an axis selections are OR'd; the two axes are
// AND'd (e.g. Upper 3rd + Left = upper-left). Empty arrays = no filter.
// ──────────────────────────────────
const VERTICAL_OPTS: Array<{ key: ZoneHeightKey; label: string }> = [
  { key: "upper", label: "Upper 3rd" },
  { key: "middle", label: "Middle 3rd" },
  { key: "lower", label: "Lower 3rd" },
];
const HORIZONTAL_OPTS: Array<{ key: ZoneSideKey; label: string }> = [
  { key: "left", label: "Left" },
  { key: "middle", label: "Middle" },
  { key: "right", label: "Right" },
];

function passesLocation(
  pzNorm: number | null,
  pxNorm: number | null,
  vertical: ZoneHeightKey[],
  horizontal: ZoneSideKey[],
): boolean {
  const v = vertical.length === 0 || vertical.some((k) => passesZoneHeight(pzNorm, k));
  const h = horizontal.length === 0 || horizontal.some((k) => passesZoneSide(pxNorm, k));
  return v && h;
}

interface LocationPickerProps {
  vertical: ZoneHeightKey[];
  horizontal: ZoneSideKey[];
  onChange: (next: { vertical: ZoneHeightKey[]; horizontal: ZoneSideKey[] }) => void;
}

function LocationPicker({ vertical, horizontal, onChange }: LocationPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);
  const count = vertical.length + horizontal.length;
  const label = count === 0 ? "Location" : `Location (${count})`;
  const toggleV = (k: ZoneHeightKey) =>
    onChange({
      vertical: vertical.includes(k) ? vertical.filter((x) => x !== k) : [...vertical, k],
      horizontal,
    });
  const toggleH = (k: ZoneSideKey) =>
    onChange({
      vertical,
      horizontal: horizontal.includes(k) ? horizontal.filter((x) => x !== k) : [...horizontal, k],
    });
  const Row = ({ active, label: l, onClick }: { active: boolean; label: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 px-4 py-1.5 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
      style={{ color: active ? GOLD : "#FFFFFF" }}
    >
      <span
        className="flex h-3 w-3 shrink-0 items-center justify-center border"
        style={{ borderColor: active ? GOLD : NAVY_BORDER, backgroundColor: active ? GOLD : "transparent" }}
      >
        {active && (
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
            <path d="M2 6l3 3 5-6" stroke="#040810" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {l}
    </button>
  );
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 border px-3 py-1.5 font-[Oswald] text-sm font-bold uppercase tracking-wider transition-colors duration-150 hover:bg-[#D4AF37]/[0.08]"
        style={{ backgroundColor: "transparent", borderColor: NAVY_BORDER, color: "#FFFFFF" }}
      >
        <span style={{ color: GOLD }}>●</span>
        {label}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} style={{ color: GOLD }}>
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 min-w-[170px] overflow-hidden border py-1 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
          {count > 0 && (
            <button type="button" onClick={() => onChange({ vertical: [], horizontal: [] })} className="mb-1 w-full cursor-pointer px-4 py-1 text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/45 transition-colors hover:text-white/80">
              Clear
            </button>
          )}
          <div className="px-4 py-1 font-[Oswald] text-[10px] font-bold uppercase tracking-wider text-white/40">Vertical</div>
          {VERTICAL_OPTS.map((o) => (
            <Row key={`v-${o.key}`} active={vertical.includes(o.key)} label={o.label} onClick={() => toggleV(o.key)} />
          ))}
          <div className="mt-1 px-4 py-1 font-[Oswald] text-[10px] font-bold uppercase tracking-wider text-white/40">Horizontal</div>
          {HORIZONTAL_OPTS.map((o) => (
            <Row key={`h-${o.key}`} active={horizontal.includes(o.key)} label={o.label} onClick={() => toggleH(o.key)} />
          ))}
        </div>
      )}
    </div>
  );
}

// Batted-ball-type picker — filters by trajectory (derived from launch
// angle). Only batted balls in play carry a launch angle, so picking any
// type other than "all" implicitly limits to contact.
//   GB < 5°, LD 5–20°, FB 20–50°, PU ≥ 50°  (matches the GB%/LD%/FB%
//   thresholds in aggregate_pitch_log_dimensions.ts).
// ─────────────────────────────────────────────────────────────────
type BattedBallKey = "all" | "gb" | "ld" | "fb" | "pu";

const BATTED_BALL_OPTIONS: Array<{ key: BattedBallKey; label: string; full: string }> = [
  { key: "all", label: "Batted Ball Type", full: "All Types" },
  { key: "gb", label: "Ground", full: "Ground Balls" },
  { key: "ld", label: "Liner", full: "Line Drives" },
  { key: "fb", label: "Fly", full: "Fly Balls" },
  { key: "pu", label: "Pop Up", full: "Pop Ups" },
];

function passesBattedBall(launchAngle: number | null, key: BattedBallKey): boolean {
  if (key === "all") return true;
  if (launchAngle == null) return false;
  if (key === "gb") return launchAngle < 5;
  if (key === "ld") return launchAngle >= 5 && launchAngle < 20;
  if (key === "fb") return launchAngle >= 20 && launchAngle < 50;
  if (key === "pu") return launchAngle >= 50;
  return true;
}

interface BattedBallTypePickerProps {
  value: BattedBallKey;
  onChange: (next: BattedBallKey) => void;
}

function BattedBallTypePicker({ value, onChange }: BattedBallTypePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);
  const label = value === "all" ? "Batted Ball Type" : BATTED_BALL_OPTIONS.find((o) => o.key === value)?.label ?? "Batted Ball Type";
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 border px-3 py-1.5 font-[Oswald] text-sm font-bold uppercase tracking-wider transition-colors duration-150 hover:bg-[#D4AF37]/[0.08]"
        style={{ backgroundColor: "transparent", borderColor: NAVY_BORDER, color: "#FFFFFF" }}
      >
        <span style={{ color: GOLD }}>●</span>
        {label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          style={{ color: GOLD }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 min-w-[160px] overflow-hidden border shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]"
          style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
        >
          {BATTED_BALL_OPTIONS.map((o) => {
            const isActive = o.key === value;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => { onChange(o.key); setOpen(false); }}
                className="block w-full cursor-pointer px-4 py-2 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
                style={{
                  color: isActive ? GOLD : "#FFFFFF",
                  backgroundColor: isActive ? "rgba(212,175,55,0.06)" : "transparent",
                }}
              >
                {o.full}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DimensionPicker({ options, value, onChange }: DimensionPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);
  const active = options.find((o) => o.key === value) ?? options[0];
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 border px-3 py-1.5 font-[Oswald] text-sm font-bold uppercase tracking-wider transition-colors duration-150 hover:bg-[#D4AF37]/[0.08]"
        style={{ backgroundColor: "transparent", borderColor: NAVY_BORDER, color: "#FFFFFF" }}
      >
        <span style={{ color: GOLD }}>●</span>
        {active.label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          style={{ color: GOLD }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden border shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]"
          style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
        >
          {options.map((o) => {
            const isActive = o.key === value;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => { onChange(o.key); setOpen(false); }}
                className="block w-full cursor-pointer px-4 py-2 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
                style={{
                  color: isActive ? GOLD : "#FFFFFF",
                  backgroundColor: isActive ? "rgba(212,175,55,0.06)" : "transparent",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Top stats line (full width above both columns)
// ────────────────────────────────────────────────────────────────────
interface StatChipProps {
  label: string;
  value: string;
  emphasize?: boolean;
  /** Optional small footnote under the value — used to flag stats like
   *  IP/ERA/FIP that come from season-final Pitching Master and don't
   *  respond to Visuals filters. */
  note?: string;
  /** Narrower chip — same height/font as default, just less width + padding.
   *  Used by the hitter stat line (10 chips) so it fits one row instead of
   *  wrapping, while staying visually consistent with the pitcher's chips. */
  compact?: boolean;
}
function StatChip({ label, value, emphasize, note, compact }: StatChipProps) {
  return (
    <div
      className={`relative flex flex-col items-center gap-2 border py-3.5 transition-colors duration-150 ${
        compact ? "min-w-[86px] px-3" : "min-w-[108px] px-4"
      }`}
      style={{
        borderColor: emphasize ? "rgba(212,175,55,0.35)" : NAVY_BORDER,
        backgroundColor: NAVY_CARD,
      }}
    >
      <div className="font-[Oswald] text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
        {label}
      </div>
      <div
        className="font-[Oswald] text-[28px] font-bold leading-none tabular-nums"
        style={{ color: emphasize ? GOLD : "#FFFFFF" }}
      >
        {value}
      </div>
      {note && (
        <div className="pointer-events-none absolute bottom-0.5 left-0 right-0 text-center font-[Archivo_Narrow] text-[7px] font-semibold uppercase tracking-[0.08em] text-white/35">
          {note}
        </div>
      )}
    </div>
  );
}

function HitterStatsLine({ row }: { row: import("@/savant/hooks/usePitchLogTotals").PitchLogHitterTotalsRow }) {
  const hits = row.hits_single + row.hits_double + row.hits_triple + row.hits_hr;
  const tb = row.hits_single + 2 * row.hits_double + 3 * row.hits_triple + 4 * row.hits_hr;
  const avg = safeDiv(hits, row.ab);
  const obp = safeDiv(hits + row.bb + row.hbp, row.ab + row.bb + row.hbp + row.sac);
  const slg = safeDiv(tb, row.ab);
  const ops = avg !== null && slg !== null && obp !== null ? obp + slg : null;
  const iso = avg !== null && slg !== null ? slg - avg : null;
  const kPct = safeDiv(row.k, row.pa);
  const bbPct = safeDiv(row.bb, row.pa);
  return (
    <div className="flex flex-wrap gap-1.5">
      <StatChip label="AVG" value={fmtSlash(avg)} emphasize compact />
      <StatChip label="OBP" value={fmtSlash(obp)} emphasize compact />
      <StatChip label="SLG" value={fmtSlash(slg)} emphasize compact />
      <StatChip label="OPS" value={fmtSlash(ops)} emphasize compact />
      <StatChip label="ISO" value={fmtSlash(iso)} compact />
      <StatChip label="HR" value={`${row.hits_hr}`} compact />
      <StatChip label="BB" value={`${row.bb}`} compact />
      <StatChip label="K" value={`${row.k}`} compact />
      <StatChip label="BB%" value={fmtPct(bbPct)} compact />
      <StatChip label="K%" value={fmtPct(kPct)} compact />
    </div>
  );
}

function PitcherStatsLine({
  row,
  pm,
}: {
  row: import("@/savant/hooks/usePitchLogTotals").PitchLogPitcherTotalsRow;
  pm: import("@/savant/hooks/usePitcherMaster").PitcherMasterRow | null | undefined;
}) {
  const kPct = safeDiv(row.total_k, row.total_pa);
  const bbPct = safeDiv(row.total_bb, row.total_pa);
  const stuff = safeDiv(row.stuff_plus_sum, row.stuff_plus_data_pitches);

  const hitsAllowed =
    row.hits_single_allowed +
    row.hits_double_allowed +
    row.hits_triple_allowed +
    row.hits_hr_allowed;
  const ipEst = row.total_bf / 4.3;
  const whip = ipEst > 0 ? (hitsAllowed + row.total_bb) / ipEst : null;

  return (
    <div className="flex flex-wrap gap-2">
      {/* Season aggregates (static — from Pitching Master, NOT filter-aware) */}
      <StatChip label="IP" value={pm?.IP != null ? pm.IP.toFixed(1) : "—"} emphasize note="*full season" />
      <StatChip label="ERA" value={pm?.ERA != null ? pm.ERA.toFixed(2) : "—"} emphasize note="*full season" />
      <StatChip label="FIP" value={pm?.FIP != null ? pm.FIP.toFixed(2) : "—"} emphasize note="*full season" />
      {/* Filter-aware (recomputes from pitch_log per active dimension) */}
      <StatChip label="WHIP" value={whip != null ? whip.toFixed(2) : "—"} />
      <StatChip label="K" value={`${row.total_k}`} />
      <StatChip label="BB" value={`${row.total_bb}`} />
      <StatChip label="K%" value={fmtPct(kPct)} />
      <StatChip label="BB%" value={fmtPct(bbPct)} />
      <StatChip label="Stuff+" value={fmt1(stuff)} emphasize />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Per-pitch tables (left column)
// ────────────────────────────────────────────────────────────────────
function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-4 font-[Oswald] text-[12px] font-bold uppercase tracking-[0.22em] text-[#D4AF37] first:mt-0">
      {children}
    </div>
  );
}

function PitcherPitchTypeTable({
  breakdowns,
  filterPitchType = null,
  minUsagePct = 0.03,
}: {
  breakdowns: PitchTypeBreakdown[];
  filterPitchType?: string | null;
  minUsagePct?: number;
}) {
  if (breakdowns.length === 0) {
    return <div className="py-4 text-sm text-white/40">No per-pitch data for this filter.</div>;
  }
  // Same filter rules as PerPitchSuccessTable: when a specific pitch
  // type is filtered, show only that one; otherwise hide rows below the
  // usage threshold.
  const visibleBreakdowns = filterPitchType
    ? breakdowns.filter((b) => b.pitchType === filterPitchType)
    : breakdowns.filter((b) => (b.usagePct ?? 0) >= minUsagePct);
  const hiddenCount = breakdowns.length - visibleBreakdowns.length;

  return (
    <div className="overflow-x-auto">
      {hiddenCount > 0 && !filterPitchType && (
        <div className="mb-2 font-[Archivo_Narrow] text-[10px] uppercase tracking-wider text-white/30">
          {hiddenCount} below {(minUsagePct * 100).toFixed(0)}% usage hidden
        </div>
      )}
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/55" style={{ borderColor: TABLE_HEADER_BORDER }}>
            <th className="py-2 pr-3">Pitch</th>
            <th className="py-2 pr-3 text-right">#</th>
            <th className="py-2 pr-3 text-right">Usage</th>
            <th className="py-2 pr-3 text-right">Velo</th>
            <th className="py-2 pr-3 text-right">IVB</th>
            <th className="py-2 pr-3 text-right">HB</th>
            <th className="py-2 pr-3 text-right">Spin</th>
            <th className="py-2 pr-3 text-right">Stuff+</th>
            <th className="py-2 pr-3 text-right">Whiff%</th>
            <th className="py-2 pr-3 text-right">Chase%</th>
            <th className="py-2 pr-3 text-right">CSW%</th>
            <th className="py-2 pr-3 text-right">Hard Hit%</th>
            <th className="py-2 pr-3 text-right">EV</th>
          </tr>
        </thead>
        <tbody>
          {visibleBreakdowns.map((b) => (
            <tr key={b.pitchType} className="border-b font-[Oswald] text-sm text-white transition-colors duration-150 hover:bg-white/[0.03]" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <td className="py-2 pr-3 font-bold">{b.pitchType}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{b.pitches.toLocaleString()}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(b.usagePct)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmt1(b.velo)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmt1(b.ivb)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmt1(b.hb)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(b.spin)}</td>
              <td
                className="py-2 pr-3 text-right tabular-nums font-bold"
                style={{ color: b.stuffPlus !== null && b.stuffPlus >= 105 ? GOLD : undefined }}
              >
                {fmt1(b.stuffPlus)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(b.whiffPct)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(b.chasePct)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(b.cswPct)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(b.hardHitPct)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmt1(b.avgEv)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Comprehensive Ball Flight table for the Visuals tab — full trajectory +
// direction + cross-tabs as columns (one row = the player, dimension-level).
function HitterBallFlightTable({
  row,
  population,
  season,
}: {
  row: import("@/savant/hooks/usePitchLogTotals").PitchLogHitterTotalsRow;
  population: import("@/savant/hooks/usePitchLogTotals").PitchLogHitterTotalsRow[];
  season: number;
}) {
  type BFMetric = (typeof HITTER_METRICS_BALL_FLIGHT_FULL)[number];
  // NCAA average = mean of each metric across the qualified population.
  const ncaaAvg = (m: BFMetric): number | null => {
    const vals = population.map((p) => m.derive(p)).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const tableRows: Array<{ label: string; getVal: (m: BFMetric) => number | null; faded: boolean }> = [
    { label: String(season), getVal: (m) => m.derive(row), faded: false },
    { label: "NCAA Avg", getVal: ncaaAvg, faded: true },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[960px] text-sm">
        <thead>
          <tr className="border-b text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/55" style={{ borderColor: TABLE_HEADER_BORDER }}>
            <th className="py-2 pr-3">Year</th>
            {HITTER_METRICS_BALL_FLIGHT_FULL.map((m) => (
              <th key={m.label} className="px-2 py-2 text-center">
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.map((tr) => (
            <tr
              key={tr.label}
              className={`border-b font-[Oswald] ${tr.faded ? "text-[13px] text-white/40" : "text-[15px] text-white"}`}
              style={{ borderColor: "rgba(255,255,255,0.05)" }}
            >
              <td className="py-2 pr-3 font-bold" style={{ color: tr.faded ? undefined : GOLD }}>
                {tr.label}
              </td>
              {HITTER_METRICS_BALL_FLIGHT_FULL.map((m) => {
                const v = tr.getVal(m);
                return (
                  <td key={m.label} className="px-2 py-2 text-center tabular-nums">
                    {v == null ? "—" : m.format(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Advanced vs-pitch-type table for the Visuals tab (RV, xStats, …). Wider, so
// it lives full-width in Visuals — NOT in the Stats grid, where its min-width
// would push the percentile column off to the side.
// Hitter RV/100 → red/blue heat. Offense perspective: positive = good for the
// hitter = red (no flip). Fixed ±3.0 RV/100 scale (provisional) — there's no
// by-pitch-type hitter population to percentile against yet (the pitcher does;
// swap to percentileRank when that hook lands). Mirrors the same color ramp.
function rv100ColorHitter(rv100: number | null): string {
  if (rv100 == null) return "transparent";
  const pct = Math.max(0, Math.min(100, 50 + (rv100 / 3.0) * 50));
  return percentileColor(pct);
}

function HitterVsPitchTable({ breakdowns }: { breakdowns: HitterPitchTypeBreakdown[] }) {
  if (breakdowns.length === 0) {
    return <div className="py-4 text-sm text-white/40">No per-pitch data for this filter.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-sm">
        <thead>
          <tr className="border-b text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/55" style={{ borderColor: TABLE_HEADER_BORDER }}>
            <th className="py-2 pr-3">Pitch</th>
            <th className="py-2 pr-3 text-center">RV/100</th>
            <th className="py-2 pr-3 text-center">Run Value</th>
            <th className="py-2 pr-3 text-center">%</th>
            <th className="py-2 pr-3 text-center">BA</th>
            <th className="py-2 pr-3 text-center">SLG</th>
            <th className="py-2 pr-3 text-center">ISO</th>
            <th className="py-2 pr-3 text-center">wOBA</th>
            <th className="py-2 pr-3 text-center">xBA</th>
            <th className="py-2 pr-3 text-center">xSLG</th>
            <th className="py-2 pr-3 text-center">xwOBA</th>
            <th className="py-2 pr-3 text-center">Whiff%</th>
            <th className="py-2 pr-3 text-center">Chase%</th>
            <th className="py-2 pr-3 text-center">EV</th>
            <th className="py-2 pr-3 text-center">Hard Hit%</th>
            <th className="py-2 pr-3 text-center">Barrel%</th>
          </tr>
        </thead>
        <tbody>
          {breakdowns.map((b) => (
            <tr key={b.pitchType} className="border-b font-[Oswald] text-sm text-white transition-colors duration-150 hover:bg-white/[0.03]" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <td className="py-2 pr-3 font-bold">{b.pitchType}</td>
              <td className="py-2 pr-3 text-center tabular-nums">
                {b.rv100 == null ? "—" : `${b.rv100 > 0 ? "+" : ""}${b.rv100.toFixed(1)}`}
              </td>
              <td
                className="py-2 pr-3 text-center font-bold tabular-nums"
                style={{ backgroundColor: rv100ColorHitter(b.rv100) }}
                title={b.rv100 != null ? `${b.rv100 > 0 ? "+" : ""}${b.rv100.toFixed(1)} RV/100` : undefined}
              >
                {b.rv == null ? "—" : `${b.rv > 0 ? "+" : ""}${Math.round(b.rv)}`}
              </td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.usagePct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.avg)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.slg)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.iso)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.woba)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.xba)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.xslg)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.xwoba)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.whiffPct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.chasePct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmt1(b.avgEv)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.hardHitPct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.barrelPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HitterPitchTypeTable({ breakdowns }: { breakdowns: HitterPitchTypeBreakdown[] }) {
  if (breakdowns.length === 0) {
    return <div className="py-4 text-sm text-white/40">No per-pitch data for this filter.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/55" style={{ borderColor: TABLE_HEADER_BORDER }}>
            <th className="py-2 pr-3">Pitch</th>
            <th className="py-2 pr-3 text-center">EV</th>
            <th className="py-2 pr-3 text-center">Whiff%</th>
            <th className="py-2 pr-3 text-center">Chase%</th>
            <th className="py-2 pr-3 text-center">Hard Hit%</th>
            <th className="py-2 pr-3 text-center">Barrel%</th>
            <th className="py-2 pr-3 text-center">K%</th>
            <th className="py-2 pr-3 text-center">HR%</th>
          </tr>
        </thead>
        <tbody>
          {breakdowns.map((b) => (
            <tr key={b.pitchType} className="border-b font-[Oswald] text-sm text-white transition-colors duration-150 hover:bg-white/[0.03]" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <td className="py-2 pr-3 font-bold">{b.pitchType}</td>
              <td
                className="py-2 pr-3 text-center tabular-nums font-bold"
                style={{ color: b.avgEv != null && b.avgEv >= 95 ? GOLD : undefined }}
              >
                {fmt1(b.avgEv)}
              </td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.whiffPct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.chasePct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.hardHitPct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.barrelPct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.kPct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.hrPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Rates table (player value vs NCAA median, Savant Statcast-style)
// ────────────────────────────────────────────────────────────────────
interface HistoricalRowSpec {
  /** Row label (e.g. "2025", "2024"). */
  label: string;
  /** Per-metric value lookup; return null if this source doesn't have that metric. */
  getValue: (metricLabel: string) => number | null;
}

interface RateTableProps<TRow> {
  metrics: readonly MetricDef<TRow>[];
  playerRow: TRow;
  qualifiedPop: TRow[];
  /**
   * Per-row sample-size weight for computing the league reference as a
   * weighted mean instead of median. Typically PA (hitter) or
   * total_pitches (pitcher). When omitted, falls back to the median.
   */
  weightOf?: (row: TRow) => number | null;
  /** Extra rows shown below NCAA Avg — typically prior-season rows from Hitter/Pitching Master. */
  historicalRows?: HistoricalRowSpec[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Weighted league mean: Σ(value × weight) / Σ(weight). Used for the
 * "NCAA average" reference on percentile bars so the label matches how
 * coaches actually think of league AVG (hits / total AB, not the median
 * player's AVG). Median was off by 8-10 pts on right-skewed distributions
 * like xBA (.275 median vs .283 weighted = league actual AVG).
 *
 * Returns null when the weighted denominator is 0 (rare — would mean
 * no player has any sample for the weight metric).
 */
function weightedMean(pairs: Array<{ value: number; weight: number }>): number | null {
  if (pairs.length === 0) return null;
  let sumValue = 0, sumWeight = 0;
  for (const p of pairs) {
    if (p.weight > 0 && Number.isFinite(p.value)) {
      sumValue += p.value * p.weight;
      sumWeight += p.weight;
    }
  }
  return sumWeight > 0 ? sumValue / sumWeight : null;
}

function RateTable<TRow>({ metrics, playerRow, qualifiedPop, weightOf, historicalRows }: RateTableProps<TRow>) {
  // Pre-compute player + NCAA reference values for each metric column.
  // When weightOf is provided, use weighted mean (matches "league AVG"
  // convention: hits / total AB across all players). Otherwise median.
  const cols = metrics.map((m) => {
    const value = m.derive(playerRow);
    const ncaa = weightOf
      ? weightedMean(
          qualifiedPop
            .map((r) => ({ value: m.derive(r), weight: weightOf(r) }))
            .filter((p): p is { value: number; weight: number } =>
              p.value != null && !Number.isNaN(p.value) && p.weight != null && p.weight > 0,
            ),
        )
      : median(
          qualifiedPop
            .map((r) => m.derive(r))
            .filter((v): v is number => v != null && !Number.isNaN(v)),
        );
    return { label: m.label, value, ncaa, format: m.format };
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr
            className="border-b text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/55"
            style={{ borderColor: TABLE_HEADER_BORDER }}
          >
            <th className="py-2 pr-3 sticky left-0 z-10" style={{ backgroundColor: NAVY_CARD }}>
              &nbsp;
            </th>
            {cols.map((c) => (
              <th key={c.label} className="py-2 px-3 text-center whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Historical seasons first, ascending (oldest → newest) so
              2025 sits directly above the 2026 row. */}
          {historicalRows?.map((hr) => (
            <tr key={hr.label} className="font-[Oswald] text-sm">
              <td
                className="py-2 pr-3 font-bold uppercase tracking-wider text-[11px] text-white/45 sticky left-0 z-10 whitespace-nowrap"
                style={{ backgroundColor: NAVY_CARD }}
              >
                {hr.label}
              </td>
              {cols.map((c) => {
                const v = hr.getValue(c.label);
                return (
                  <td key={c.label} className="py-2 px-3 text-center tabular-nums text-white/45">
                    {v === null ? "—" : c.format(v)}
                  </td>
                );
              })}
            </tr>
          ))}
          {/* Current season (2026) — highlighted in gold. */}
          <tr className="border-b font-[Oswald] text-sm text-white" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
            <td
              className="py-2 pr-3 font-bold uppercase tracking-wider text-[11px] text-[#D4AF37] sticky left-0 z-10 whitespace-nowrap"
              style={{ backgroundColor: NAVY_CARD }}
            >
              2026
            </td>
            {cols.map((c) => (
              <td key={c.label} className="py-2 px-3 text-center tabular-nums font-bold">
                {c.value === null ? "—" : c.format(c.value)}
              </td>
            ))}
          </tr>
          {/* NCAA Avg directly under the current-season row. */}
          <tr className="font-[Oswald] text-sm">
            <td
              className="py-2 pr-3 font-bold uppercase tracking-wider text-[11px] text-white/55 sticky left-0 z-10 whitespace-nowrap"
              style={{ backgroundColor: NAVY_CARD }}
            >
              NCAA Avg
            </td>
            {cols.map((c) => (
              <td key={c.label} className="py-2 px-3 text-center tabular-nums text-white/60">
                {c.ncaa === null ? "—" : c.format(c.ncaa)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Percentile bar group (right column)
// ────────────────────────────────────────────────────────────────────
interface BarGroupProps<TRow> {
  metrics: readonly MetricDef<TRow>[];
  playerRow: TRow;
  qualifiedPop: TRow[];
}
function BarGroup<TRow>({ metrics, playerRow, qualifiedPop }: BarGroupProps<TRow>) {
  return (
    <div className="divide-y divide-white/5">
      {metrics.map((m) => {
        const value = m.derive(playerRow);
        const popValues = qualifiedPop.map((r) => m.derive(r));
        const pct = percentileRank(value, popValues, { invert: m.invert });
        return (
          <PercentileBar
            key={m.label}
            label={m.label}
            value={value}
            percentile={pct}
            format={m.format}
          />
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Page-level shells (filter top, two-column body)
// ────────────────────────────────────────────────────────────────────
interface PageShellProps {
  picker: React.ReactNode;
  sampleCount: number;
  sampleLabel: string;
  topStats: React.ReactNode;
  left: React.ReactNode;
  right: React.ReactNode;
  /**
   * Optional Visuals tab content (charts, heatmaps, spray fields).
   * When provided, the page renders a Stats/Visuals tab strip below
   * the top stats row. Stats tab = the two-column body; Visuals tab
   * = this content.
   */
  visuals?: React.ReactNode;
  /**
   * Optional element rendered inline with the tab strip on the right
   * (e.g. the Visuals pitch-type picker). Only shown when the tab strip
   * is active (visuals is provided).
   */
  tabExtra?: React.ReactNode;
}
type PitchLogTab = "stats" | "visuals";

function PageShell({
  picker,
  sampleCount,
  sampleLabel,
  topStats,
  left,
  right,
  visuals,
  tabExtra,
}: PageShellProps) {
  const [tab, setTab] = useState<PitchLogTab>("stats");

  const statsBody = (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.7fr_1fr]">
      <div className="space-y-6">{left}</div>
      <div className="space-y-6">{right}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Filter + counts row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: NAVY_BORDER }}>
        <div className="flex items-center gap-3">
          {picker}
          <div className="text-[11px] uppercase tracking-wider text-white/55">
            {sampleCount.toLocaleString()} {sampleLabel}
            <span className="ml-2 text-white/40">· *includes postseason</span>
          </div>
        </div>
      </div>

      {/* Top stats line */}
      <div>{topStats}</div>

      {visuals ? (
        <>
          {/* Stats / Visuals tab strip + inline filter slot (right side) */}
          <div
            className="flex items-end justify-between gap-3 border-b"
            style={{ borderColor: NAVY_BORDER }}
          >
            <div className="flex items-end gap-1">
              {([
                { key: "stats" as const, label: "Stats" },
                { key: "visuals" as const, label: "Visuals" },
              ]).map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className="cursor-pointer px-5 py-2 font-[Oswald] text-[13px] font-semibold uppercase tracking-[0.14em] transition-colors duration-150"
                    style={{
                      color: active ? GOLD : "rgba(255,255,255,0.55)",
                      borderBottom: active ? `2px solid ${GOLD}` : "2px solid transparent",
                      marginBottom: "-1px",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {tab === "visuals" && tabExtra && (
              <div className="pb-1.5">{tabExtra}</div>
            )}
          </div>

          {tab === "stats" ? statsBody : <div className="space-y-6">{visuals}</div>}
        </>
      ) : (
        statsBody
      )}
    </div>
  );
}

// Reusable bordered panel used for each labeled section.
function Panel({
  title,
  children,
  headerBadge,
}: {
  title: string;
  children: React.ReactNode;
  headerBadge?: React.ReactNode;
}) {
  return (
    <section
      className="border px-5 py-5"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-3 w-0.5" style={{ backgroundColor: GOLD }} />
          <h3 className="font-[Oswald] text-[14px] font-bold uppercase tracking-[0.18em] text-white">
            {title}
          </h3>
        </div>
        {headerBadge}
      </div>
      {children}
    </section>
  );
}

/**
 * Tracking-reliability badge for the Batted Ball Data panel. Shows the
 * % of BIP that have EV/LA tracking. xBA / xSLG / xwOBA fall back to
 * actual outcomes for untracked BIP — so coaches need to know when a
 * player's xStats are mostly fallback. Thresholds: ≥80% green ("FULL"),
 * 50-80% amber ("PARTIAL"), <50% red ("LOW").
 */
function TrackingReliabilityBadge({
  trackedBip,
  totalBip,
}: {
  trackedBip: number;
  totalBip: number;
}) {
  if (totalBip === 0) return null;
  const pct = (trackedBip / totalBip) * 100;
  const tier =
    pct >= 80
      ? { label: "FULL TRACKING", color: "rgb(34 197 94)", bg: "rgba(34,197,94,0.12)", border: "rgba(34,197,94,0.35)" }
      : pct >= 50
        ? { label: "PARTIAL TRACKING", color: "rgb(234 179 8)", bg: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.35)" }
        : { label: "LOW TRACKING", color: "rgb(239 68 68)", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.35)" };
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-sm border"
      style={{ color: tier.color, backgroundColor: tier.bg, borderColor: tier.border }}
      title={`${trackedBip} of ${totalBip} batted balls in play have EV/LA tracking (${pct.toFixed(0)}%). xBA / xSLG / xwOBA fall back to actual outcomes for untracked balls.`}
    >
      {tier.label} · {pct.toFixed(0)}%
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────
// Pitcher Location section — Strike Zone + 13-zone xwOBA + Spray field
// ────────────────────────────────────────────────────────────────────

interface PitcherLocationSectionProps {
  pitcherId: string;
  season: number;
  dimension: PitchLogDimensionKey;
  /** Active page-wide pitch-type filter; null = all pitch types. */
  filterPitchTypes: string[];
  /** Active vertical-third filters (OR). Empty = all heights. */
  filterVertical: ZoneHeightKey[];
  /** Active horizontal-third filters (OR). Empty = all sides. */
  filterHorizontal: ZoneSideKey[];
  /** Active batted-ball-type filter (ground/line/fly/pop, by launch angle) */
  filterBattedTypes: BattedBallKey[];
  /** Pre-aggregated per-pitch-type breakdowns (same source as the Stats
   *  tab table) — passed straight to the Per-Pitch Success table. */
  breakdowns: PitchTypeBreakdown[];
  /** Full NCAA population of by-pitch-type rows for percentile coloring. */
  byTypePopulation: import("@/savant/hooks/usePitchLogByPitchType").PitchLogByPitchTypeRow[];
}

/**
 * Wraps a Visuals section with an Oswald-uppercase header bar (per
 * DESIGN.md "Roster Intelligence System" — Oswald section headers,
 * sharp corners, 1px navy borders). Each section hosts a row of
 * chart cards on white canvas.
 */
function VisualsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2" style={{ borderColor: NAVY_BORDER }}>
        <span className="h-3 w-0.5" style={{ backgroundColor: GOLD }} />
        <h3 className="font-[Oswald] text-[13px] font-bold uppercase tracking-[0.18em] text-white">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

/**
 * Placeholder card for charts not yet built. Uses the same white-canvas
 * shape as built charts so the page composition reads correctly during
 * development.
 */
function VisualsPlaceholder({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      className="flex h-[462px] flex-col border bg-white"
      style={{ borderColor: "#E5E5E5" }}
    >
      <div className="border-b px-3 py-2" style={{ borderColor: "#E5E5E5" }}>
        <h4 className="font-[Oswald] text-[14px] font-semibold uppercase tracking-wider text-slate-900">
          {title}
        </h4>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 text-center">
        <p className="font-[Archivo_Narrow] text-[12px] uppercase tracking-wider text-slate-400">
          {hint}
        </p>
      </div>
    </div>
  );
}

function PitcherLocationSection({
  pitcherId,
  season,
  dimension,
  filterPitchTypes,
  filterVertical,
  filterHorizontal,
  filterBattedTypes,
  breakdowns,
  byTypePopulation,
}: PitcherLocationSectionProps) {
  const { data: pitches = [], isLoading } = usePitchLogPitchLocation({
    playerId: pitcherId,
    role: "pitcher",
    season,
    dimension,
  });

  const filteredPitches = useMemo(() => {
    let out = pitches;
    if (filterPitchTypes.length) {
      out = out.filter((p) => filterPitchTypes.includes(p.pitch_type_reclassified ?? ""));
    }
    if (filterVertical.length || filterHorizontal.length) {
      out = out.filter((p) => passesLocation(p.pz_norm, p.px_norm, filterVertical, filterHorizontal));
    }
    if (filterBattedTypes.length) {
      out = out.filter((p) => filterBattedTypes.some((k) => passesBattedBall(p.launch_angle, k)));
    }
    return out;
  }, [pitches, filterPitchTypes, filterVertical, filterHorizontal, filterBattedTypes]);

  if (isLoading) {
    return <div className="py-6 text-sm text-white/40">Loading pitches…</div>;
  }
  if (pitches.length === 0) {
    return <div className="py-6 text-sm text-white/40">No pitches for this filter.</div>;
  }

  return (
    <div className="space-y-6">
      {/* ── Pitch Location ───────────────────────────────────────────── */}
      <VisualsSection title="Pitch Location">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StrikeZonePlot pitches={filteredPitches} title="Strike Zone Density" width={360} height={462} />
          <PitchZoneUsage pitches={filteredPitches} title="13-Zone Usage" />
          <PitchUsagePie breakdowns={breakdowns} title="Pitch Usage" />
        </div>
      </VisualsSection>

      {/* ── Pitch Quality ────────────────────────────────────────────── */}
      <VisualsSection title="Pitch Quality">
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <PitchMovementPlot pitches={filteredPitches} title="Movement Profile" />
            <PitchZoneWhiff pitches={filteredPitches} title="13-Zone Whiff%" />
            <PitchZoneXwoba pitches={filteredPitches} title="13-Zone xwOBA" />
          </div>
          <PerPitchSuccessTable
            breakdowns={breakdowns}
            population={byTypePopulation}
            title="Per-Pitch Success"
            filterPitchType={filterPitchTypes.length === 1 ? filterPitchTypes[0] : null}
          />
        </div>
      </VisualsSection>

      {/* ── Batted Ball ──────────────────────────────────────────────── */}
      <VisualsSection title="Batted Ball">
        {/* 2-across to match the bottom-section layout. Avg Exit Velo is folded
            into the Contact Allowed hover for now; it returns as its own
            selectable panel with the add/change-data toggle. */}
        <div className="grid grid-cols-1 gap-10 px-2 pt-2 md:grid-cols-2">
          <div>
            <p className="mb-5 text-center font-[Oswald] text-[12px] font-bold uppercase tracking-[0.22em] text-white/70">
              Spray Chart
            </p>
            <SprayFieldPanel pitches={filteredPitches} metric="dots" />
          </div>
          <div>
            <p className="mb-5 text-center font-[Oswald] text-[12px] font-bold uppercase tracking-[0.22em] text-white/70">
              % of Balls in Play
            </p>
            <SprayFieldPanel pitches={filteredPitches} metric="freq" />
          </div>
        </div>
      </VisualsSection>

      {/* ── Trends (hidden for now) ──────────────────────────────────────
          Rolling xwOBA, Baseball-Savant style: order all PAs chronologically
          (pitch_log.date), plot a TRAILING 50-PA rolling-window average — not
          per-game. Per-PA xwOBA value: BIP → x_woba, BB → 0.696, HBP → 0.726,
          K → 0 (matches the season xwOBA formula in pitchLogRates.ts). Dates as
          x-axis labels; season-avg + league reference lines. Window adjustable.
          Single line (xwOBA) to start; expected-vs-actual / driver overlays later.
      <VisualsSection title="Trends">
        <VisualsPlaceholder title="Rolling xwOBA" hint="50-PA rolling window · coming next" />
      </VisualsSection>
      */}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Pitcher entry
// ────────────────────────────────────────────────────────────────────
interface PitcherPitchLogProps {
  pitcherId: string;
  season: number;
}

export function PitcherPitchLog({ pitcherId, season }: PitcherPitchLogProps) {
  const [dimension, setDimension] = useState<PitchLogDimensionKey>("all");
  const [filterPitchTypes, setFilterPitchTypes] = useState<string[]>([]);
  const [filterVertical, setFilterVertical] = useState<ZoneHeightKey[]>([]);
  const [filterHorizontal, setFilterHorizontal] = useState<ZoneSideKey[]>([]);
  const [filterBattedTypes, setFilterBattedTypes] = useState<BattedBallKey[]>([]);
  const { data: totalsRow } = usePitchLogPitcherTotals(pitcherId, season, dimension);
  const { data: byTypeRows = [] } = usePitchLogByPitchType(pitcherId, season, dimension);
  const { data: population = [] } = usePitchLogPitcherPopulation(season, dimension);
  const { data: byTypePopulation = [] } = usePitchLogByPitchTypePopulation(season, dimension);
  const { data: pmRow } = usePitcherMaster(pitcherId, season);

  const qualifiedPop = useMemo(
    () => population.filter((r) => r.total_pitches >= PITCHER_QUALIFIED_PITCHES),
    [population],
  );
  const breakdowns = derivePitchTypeBreakdowns(byTypeRows);

  // Pitch types available to filter — derived from breakdowns (already
  // sorted by usage descending) so the most-used pitches appear at the top.
  const pitchTypes = useMemo(
    () => breakdowns.map((b) => b.pitchType).filter((pt): pt is string => Boolean(pt)),
    [breakdowns],
  );

  const picker = (
    <DimensionPicker options={PITCHER_DIMENSIONS} value={dimension} onChange={setDimension} />
  );

  const pitchTypePicker = (
    <div className="flex items-center gap-2">
      <MultiSelectPicker
        label="Pitch Type"
        options={pitchTypes.map((pt) => ({ key: pt, label: pt }))}
        selected={filterPitchTypes}
        onChange={setFilterPitchTypes}
      />
      <LocationPicker
        vertical={filterVertical}
        horizontal={filterHorizontal}
        onChange={({ vertical, horizontal }) => {
          setFilterVertical(vertical);
          setFilterHorizontal(horizontal);
        }}
      />
      <MultiSelectPicker
        label="Batted Ball Type"
        options={BATTED_BALL_OPTIONS.filter((o) => o.key !== "all").map((o) => ({ key: o.key, label: o.full }))}
        selected={filterBattedTypes}
        onChange={setFilterBattedTypes}
      />
    </div>
  );

  if (!totalsRow) {
    return (
      <PageShell
        picker={picker}
        sampleCount={0}
        sampleLabel="pitches"
        topStats={null}
        left={<div className="py-6 text-sm text-white/40">No pitch-log data for this filter.</div>}
        right={null}
      />
    );
  }

  const reliability =
    totalsRow.total_pitches > 0 ? totalsRow.total_data_pitches / totalsRow.total_pitches : null;

  return (
    <PageShell
      picker={picker}
      sampleCount={totalsRow.total_pitches}
      sampleLabel="pitches"
      topStats={<PitcherStatsLine row={totalsRow} pm={pmRow ?? null} />}
      left={
        <>
          <Panel
            title="Quality of Stuff"
            headerBadge={
              <TrackingReliabilityBadge
                trackedBip={totalsRow.batted_balls_allowed_with_ev ?? 0}
                totalBip={totalsRow.batted_balls_allowed_in_play ?? 0}
              />
            }
          >
            <RateTable
              metrics={PITCHER_METRICS_DISCIPLINE}
              playerRow={totalsRow}
              qualifiedPop={qualifiedPop}
              weightOf={(r) => r.total_pitches}
            />
          </Panel>
          <Panel title="Batted Ball Metrics">
            <RateTable
              metrics={[...PITCHER_METRICS_SLASH_AGAINST, ...PITCHER_METRICS_BATTED_BALL]}
              playerRow={totalsRow}
              qualifiedPop={qualifiedPop}
              weightOf={(r) => r.total_ab}
            />
          </Panel>
          <Panel title="Per-Pitch Breakdown">
            <PitcherPitchTypeTable
              breakdowns={breakdowns}
              filterPitchType={filterPitchTypes.length === 1 ? filterPitchTypes[0] : null}
            />
          </Panel>
        </>
      }
      right={
        <>
          <Panel title="Quality of Stuff">
            <BarGroup
              metrics={PITCHER_METRICS_DISCIPLINE}
              playerRow={totalsRow}
              qualifiedPop={qualifiedPop}
            />
          </Panel>
          <Panel title="Batted Ball Metrics">
            <BarGroup
              metrics={[...PITCHER_METRICS_SLASH_AGAINST, ...PITCHER_METRICS_BATTED_BALL]}
              playerRow={totalsRow}
              qualifiedPop={qualifiedPop}
            />
          </Panel>
        </>
      }
      visuals={
        <PitcherLocationSection
          pitcherId={pitcherId}
          season={season}
          dimension={dimension}
          filterPitchTypes={filterPitchTypes}
          filterVertical={filterVertical}
          filterHorizontal={filterHorizontal}
          filterBattedTypes={filterBattedTypes}
          breakdowns={breakdowns}
          byTypePopulation={byTypePopulation}
        />
      }
      tabExtra={pitchTypePicker}
    />
  );
}

// ────────────────────────────────────────────────────────────────────
// Hitter Visuals tab — mirrors PitcherLocationSection, hitter-tilted:
// Spray Chart on top (where HE hits it), Plate Coverage (13-zone xwOBA /
// Whiff / Usage — no strike-zone density heatmap), then vs Pitch Type.
// ────────────────────────────────────────────────────────────────────
interface HitterLocationSectionProps {
  batterId: string;
  season: number;
  dimension: PitchLogDimensionKey;
  filterPitchTypes: string[];
  filterVertical: ZoneHeightKey[];
  filterHorizontal: ZoneSideKey[];
  filterBattedTypes: BattedBallKey[];
  breakdowns: HitterPitchTypeBreakdown[];
  totalsRow: import("@/savant/hooks/usePitchLogTotals").PitchLogHitterTotalsRow;
  population: import("@/savant/hooks/usePitchLogTotals").PitchLogHitterTotalsRow[];
}

function HitterLocationSection({
  batterId,
  season,
  dimension,
  filterPitchTypes,
  filterVertical,
  filterHorizontal,
  filterBattedTypes,
  breakdowns,
  totalsRow,
  population,
}: HitterLocationSectionProps) {
  const { data: pitches = [], isLoading } = usePitchLogPitchLocation({
    playerId: batterId,
    role: "hitter",
    season,
    dimension,
  });

  const filteredPitches = useMemo(() => {
    let out = pitches;
    if (filterPitchTypes.length) {
      out = out.filter((p) => filterPitchTypes.includes(p.pitch_type_reclassified ?? ""));
    }
    if (filterVertical.length || filterHorizontal.length) {
      out = out.filter((p) => passesLocation(p.pz_norm, p.px_norm, filterVertical, filterHorizontal));
    }
    if (filterBattedTypes.length) {
      out = out.filter((p) => filterBattedTypes.some((k) => passesBattedBall(p.launch_angle, k)));
    }
    return out;
  }, [pitches, filterPitchTypes, filterVertical, filterHorizontal, filterBattedTypes]);

  if (isLoading) {
    return <div className="py-6 text-sm text-white/40">Loading pitches…</div>;
  }
  if (pitches.length === 0) {
    return <div className="py-6 text-sm text-white/40">No pitches for this filter.</div>;
  }

  const sectionLabel = "mb-5 text-center font-[Oswald] text-[12px] font-bold uppercase tracking-[0.22em] text-white/70";

  return (
    <div className="space-y-6">
      {/* ── Batted Ball (top — the hitter's spray) ───────────────────── */}
      <VisualsSection title="Batted Ball">
        <div className="grid grid-cols-1 gap-10 px-2 pt-2 md:grid-cols-2">
          <div>
            <p className={sectionLabel}>Spray Chart</p>
            <SprayFieldPanel pitches={filteredPitches} metric="dots" />
          </div>
          <div>
            <p className={sectionLabel}>% of Balls in Play</p>
            <SprayFieldPanel pitches={filteredPitches} metric="freq" />
          </div>
        </div>
      </VisualsSection>

      {/* ── Ball Flight (comprehensive — full profile + cross-tabs) ──── */}
      <Panel title="Ball Flight">
        <HitterBallFlightTable row={totalsRow} population={population} season={season} />
      </Panel>

      {/* ── vs Pitch Type ────────────────────────────────────────────── */}
      <Panel title="vs Pitch Type">
        <HitterVsPitchTable breakdowns={breakdowns} />
      </Panel>

      {/* ── Plate Coverage (13-zone, hitter perspective: colors flipped so
          red = good; Usage → avg EV per zone) ────────────────────────── */}
      <VisualsSection title="Plate Coverage">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <PitchZoneXwoba pitches={filteredPitches} title="13-Zone xwOBA" invert />
          <PitchZoneWhiff pitches={filteredPitches} title="13-Zone Whiff%" invert />
          <PitchZoneXwoba pitches={filteredPitches} title="13-Zone EV" metric="ev" />
        </div>
      </VisualsSection>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Hitter entry
// ────────────────────────────────────────────────────────────────────
interface HitterPitchLogProps {
  batterId: string;
  season: number;
}

export function HitterPitchLog({ batterId, season }: HitterPitchLogProps) {
  const [dimension, setDimension] = useState<PitchLogDimensionKey>("all");
  const [filterPitchTypes, setFilterPitchTypes] = useState<string[]>([]);
  const [filterVertical, setFilterVertical] = useState<ZoneHeightKey[]>([]);
  const [filterHorizontal, setFilterHorizontal] = useState<ZoneSideKey[]>([]);
  const [filterBattedTypes, setFilterBattedTypes] = useState<BattedBallKey[]>([]);
  const { data: row } = usePitchLogHitterTotals(batterId, season, dimension);
  const { data: byTypeRows = [] } = usePitchLogHitterByPitchType(batterId, season, dimension);
  const { data: population = [] } = usePitchLogHitterPopulation(season, dimension);

  const qualifiedPop = useMemo(
    () => population.filter((r) => r.pa >= HITTER_QUALIFIED_PA),
    [population],
  );
  const breakdowns = deriveHitterPitchTypeBreakdowns(byTypeRows);
  const pitchTypes = useMemo(
    () => breakdowns.map((b) => b.pitchType).filter((pt): pt is string => Boolean(pt)),
    [breakdowns],
  );

  const picker = (
    <DimensionPicker options={HITTER_DIMENSIONS} value={dimension} onChange={setDimension} />
  );

  const filterBar = (
    <div className="flex items-center gap-2">
      <MultiSelectPicker
        label="Pitch Type"
        options={pitchTypes.map((pt) => ({ key: pt, label: pt }))}
        selected={filterPitchTypes}
        onChange={setFilterPitchTypes}
      />
      <LocationPicker
        vertical={filterVertical}
        horizontal={filterHorizontal}
        onChange={({ vertical, horizontal }) => {
          setFilterVertical(vertical);
          setFilterHorizontal(horizontal);
        }}
      />
      <MultiSelectPicker
        label="Batted Ball Type"
        options={BATTED_BALL_OPTIONS.filter((o) => o.key !== "all").map((o) => ({ key: o.key, label: o.full }))}
        selected={filterBattedTypes}
        onChange={setFilterBattedTypes}
      />
    </div>
  );

  if (!row) {
    return (
      <PageShell
        picker={picker}
        sampleCount={0}
        sampleLabel="PA"
        topStats={null}
        left={<div className="py-6 text-sm text-white/40">No pitch-log data for this filter.</div>}
        right={null}
      />
    );
  }

  const reliability =
    row.total_pitches > 0 ? row.total_data_pitches / row.total_pitches : null;

  return (
    <PageShell
      picker={picker}
      sampleCount={row.pa}
      sampleLabel="PA"
      topStats={<HitterStatsLine row={row} />}
      left={
        <>
          <Panel
            title="Batted Ball Data"
            headerBadge={
              <TrackingReliabilityBadge
                trackedBip={row.batted_balls_with_ev ?? 0}
                totalBip={row.batted_balls_in_play ?? 0}
              />
            }
          >
            <RateTable
              metrics={[...HITTER_METRICS_SLASH, ...HITTER_METRICS_CONTACT]}
              playerRow={row}
              qualifiedPop={qualifiedPop}
              weightOf={(r) => r.ab + (r.sac ?? 0)}
            />
          </Panel>
          <Panel title="Plate Discipline">
            <RateTable
              metrics={HITTER_METRICS_DISCIPLINE}
              playerRow={row}
              qualifiedPop={qualifiedPop}
              weightOf={(r) => r.pa}
            />
          </Panel>
          <Panel title="Ball Flight">
            <RateTable
              metrics={HITTER_METRICS_BALL_FLIGHT}
              playerRow={row}
              qualifiedPop={qualifiedPop}
              weightOf={(r) => r.batted_balls_with_ev}
            />
          </Panel>
          <Panel title="Per-Pitch Success">
            <HitterPitchTypeTable breakdowns={breakdowns} />
          </Panel>
        </>
      }
      right={
        <>
          <Panel title="Batted Ball Data">
            <BarGroup
              metrics={[...HITTER_METRICS_SLASH, ...HITTER_METRICS_CONTACT_BARS]}
              playerRow={row}
              qualifiedPop={qualifiedPop}
            />
          </Panel>
          <Panel title="Plate Discipline">
            <BarGroup metrics={HITTER_METRICS_DISCIPLINE_BARS} playerRow={row} qualifiedPop={qualifiedPop} />
          </Panel>
          <Panel title="Ball Flight">
            <BarGroup metrics={HITTER_METRICS_BALL_FLIGHT} playerRow={row} qualifiedPop={qualifiedPop} />
          </Panel>
        </>
      }
      visuals={
        <HitterLocationSection
          batterId={batterId}
          season={season}
          dimension={dimension}
          filterPitchTypes={filterPitchTypes}
          filterVertical={filterVertical}
          filterHorizontal={filterHorizontal}
          filterBattedTypes={filterBattedTypes}
          breakdowns={breakdowns}
          totalsRow={row}
          population={qualifiedPop}
        />
      }
      tabExtra={filterBar}
    />
  );
}
