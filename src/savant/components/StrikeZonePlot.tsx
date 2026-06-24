/**
 * Strike Zone scatter plot (catcher's view) — one dot per pitch.
 *
 * Used on the Pitcher Profile Stats tab. Each pitch is colored by
 * pitch_type_reclassified using the standard MLB Statcast palette.
 * Hovering a dot surfaces the per-pitch movement: IVB / HB / Vel / Spin
 * / pitch type / result.
 *
 * The standard strike zone (PXNorm ∈ [-1, 1], PZNorm ∈ [-1, 1]) is drawn
 * as a thin gold rectangle. Dots that fall outside the zone are still
 * plotted in the surrounding "chase" area for context.
 *
 * Implementation note: SVG over Canvas — pointer interactions on
 * individual dots are simpler with SVG and we typically have only ~500-
 * 2,000 pitches per player, well within SVG's comfort zone.
 */
import { useMemo, useState } from "react";
import type { PitchLocationRow } from "@/savant/hooks/usePitchLogPitchLocation";
import {
  PITCH_TYPE_COLOR,
  VIEW_PXNORM_MAX,
  VIEW_PXNORM_MIN,
  VIEW_PZNORM_MAX,
  VIEW_PZNORM_MIN,
  ZONE_PXNORM_MAX,
  ZONE_PXNORM_MIN,
  ZONE_PZNORM_MAX,
  ZONE_PZNORM_MIN,
} from "@/savant/lib/pitchLocationHelpers";

interface StrikeZonePlotProps {
  /** Per-pitch rows. Plot ignores rows where px_norm or pz_norm is null. */
  pitches: PitchLocationRow[];
  /** SVG width in CSS pixels — height is computed from canvas aspect. */
  width?: number;
  /** Optional title shown above the plot. */
  title?: string;
  /** Optional sub-title (e.g. filter context). */
  subtitle?: string;
}

interface ScreenPitch {
  row: PitchLocationRow;
  cx: number;
  cy: number;
  color: string;
}

export function StrikeZonePlot({
  pitches,
  width = 320,
  title,
  subtitle,
}: StrikeZonePlotProps) {
  // Aspect ratio: visible canvas is roughly (Δpx-norm) : (Δpz-norm). Add a
  // little vertical headroom for the title row.
  const xRange = VIEW_PXNORM_MAX - VIEW_PXNORM_MIN;
  const yRange = VIEW_PZNORM_MAX - VIEW_PZNORM_MIN;
  const height = Math.round(width * (yRange / xRange));

  // Map normalized coords → SVG pixel coords. PZNorm increases UP in the
  // strike zone but SVG y increases DOWN, so we flip.
  const xToPx = (pxNorm: number) =>
    ((pxNorm - VIEW_PXNORM_MIN) / xRange) * width;
  const yToPx = (pzNorm: number) =>
    height - ((pzNorm - VIEW_PZNORM_MIN) / yRange) * height;

  // Pre-project the dots once per render so hover lookups are O(1).
  const screenPitches = useMemo<ScreenPitch[]>(
    () =>
      pitches
        .filter((p) => p.px_norm != null && p.pz_norm != null)
        .map((p) => ({
          row: p,
          cx: xToPx(p.px_norm!),
          cy: yToPx(p.pz_norm!),
          color: PITCH_TYPE_COLOR[p.pitch_type_reclassified ?? ""] ?? "#9CA3AF",
        })),
    // xToPx / yToPx are derived from width / height which are stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pitches, width, height],
  );

  // Hover state — track which dot is active so we can render a tooltip + a
  // ring around it. uniq_pitch_id is the stable key.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const hoverPitch = hoverIdx != null ? screenPitches[hoverIdx] : null;

  // Zone box pixel rect.
  const zoneRect = {
    x: xToPx(ZONE_PXNORM_MIN),
    y: yToPx(ZONE_PZNORM_MAX),
    width: xToPx(ZONE_PXNORM_MAX) - xToPx(ZONE_PXNORM_MIN),
    height: yToPx(ZONE_PZNORM_MIN) - yToPx(ZONE_PZNORM_MAX),
  };

  return (
    <div className="flex flex-col items-stretch">
      {title && (
        <div className="mb-2 flex items-baseline justify-between">
          <h4 className="text-sm font-semibold text-white tracking-wide">{title}</h4>
          {subtitle && <span className="text-[11px] text-white/55">{subtitle}</span>}
        </div>
      )}
      <div className="relative" style={{ width, height }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ background: "rgba(7, 14, 31, 0.5)", borderRadius: 6 }}
          role="img"
          aria-label="Strike zone scatter plot of pitches"
        >
          {/* Strike zone box */}
          <rect
            x={zoneRect.x}
            y={zoneRect.y}
            width={zoneRect.width}
            height={zoneRect.height}
            fill="none"
            stroke="#D4AF37"
            strokeWidth={1.5}
            opacity={0.85}
          />
          {/* 9-box subdivision (thin lines) */}
          {[1 / 3, 2 / 3].map((t) => {
            const x = zoneRect.x + zoneRect.width * t;
            return (
              <line
                key={`v-${t}`}
                x1={x}
                y1={zoneRect.y}
                x2={x}
                y2={zoneRect.y + zoneRect.height}
                stroke="#D4AF37"
                strokeWidth={0.5}
                opacity={0.35}
              />
            );
          })}
          {[1 / 3, 2 / 3].map((t) => {
            const y = zoneRect.y + zoneRect.height * t;
            return (
              <line
                key={`h-${t}`}
                x1={zoneRect.x}
                y1={y}
                x2={zoneRect.x + zoneRect.width}
                y2={y}
                stroke="#D4AF37"
                strokeWidth={0.5}
                opacity={0.35}
              />
            );
          })}

          {/* Pitch dots */}
          {screenPitches.map((p, i) => (
            <circle
              key={p.row.uniq_pitch_id}
              cx={p.cx}
              cy={p.cy}
              r={hoverIdx === i ? 6 : 4}
              fill={p.color}
              fillOpacity={hoverIdx === i ? 1 : 0.75}
              stroke={hoverIdx === i ? "#FFFFFF" : "rgba(255,255,255,0.3)"}
              strokeWidth={hoverIdx === i ? 1.5 : 0.5}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ cursor: "pointer" }}
            />
          ))}
        </svg>

        {/* Tooltip */}
        {hoverPitch && (
          <div
            className="pointer-events-none absolute z-10 rounded border bg-black/85 px-2 py-1.5 text-[11px] leading-tight text-white shadow-lg"
            style={{
              left: Math.min(hoverPitch.cx + 10, width - 160),
              top: Math.max(hoverPitch.cy - 70, 0),
              borderColor: hoverPitch.color,
              width: 160,
            }}
          >
            <div className="font-semibold" style={{ color: hoverPitch.color }}>
              {hoverPitch.row.pitch_type_reclassified ?? hoverPitch.row.pitch_type ?? "—"}
            </div>
            <div className="text-white/80">
              {hoverPitch.row.release_velocity != null
                ? `${hoverPitch.row.release_velocity.toFixed(1)} mph`
                : "—"}
              {hoverPitch.row.spin != null && (
                <span className="text-white/55"> · {Math.round(hoverPitch.row.spin)} rpm</span>
              )}
            </div>
            <div className="mt-0.5 text-white/70">
              IVB{" "}
              {hoverPitch.row.ivb != null ? hoverPitch.row.ivb.toFixed(1) : "—"}
              {" · "}
              HB{" "}
              {hoverPitch.row.hb != null ? hoverPitch.row.hb.toFixed(1) : "—"}
            </div>
            <div className="mt-1 text-white/60">
              {hoverPitch.row.pitch_result ?? "—"}
              {hoverPitch.row.stuff_plus != null && (
                <span className="ml-2">Stuff+ {hoverPitch.row.stuff_plus.toFixed(0)}</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
