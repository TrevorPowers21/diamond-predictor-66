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

// Design tokens — see design-system/rstr-iq/MASTER.md
const GOLD = "#D4AF37";
const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";

interface StrikeZonePlotProps {
  /** Per-pitch rows. Plot ignores rows where px_norm or pz_norm is null. */
  pitches: PitchLocationRow[];
  /** SVG width in CSS pixels — height is computed from canvas aspect. */
  width?: number;
  /** Optional title shown above the plot. */
  title?: string;
  /** Optional sub-title (e.g. filter context). */
  subtitle?: string;
  /** Optional explicit container height. When set, the view bounds
   *  extend vertically to fill the height so the strike zone stays
   *  centered. Used to match neighboring panels in the grid. */
  height?: number;
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
  height: explicitHeight,
}: StrikeZonePlotProps) {
  // Visible canvas aspect ratio comes from view bounds (Δpx-norm) :
  // (Δpz-norm). When the parent supplies an explicit height, we extend
  // the vertical view range proportionally so the strike zone stays
  // centered + properly sized, but the canvas grows to match.
  const xRange = VIEW_PXNORM_MAX - VIEW_PXNORM_MIN;
  const baseYRange = VIEW_PZNORM_MAX - VIEW_PZNORM_MIN;
  const height = explicitHeight ?? Math.round(width * (baseYRange / xRange));
  // Effective Y range scales with the explicit height — extra height
  // gives more vertical breathing room without distorting the strike
  // zone box itself.
  const yRange = (height / width) * xRange;
  const yMin = -(yRange / 2);
  const yMax = yRange / 2;

  // Map normalized coords → SVG pixel coords. PZNorm increases UP in the
  // strike zone but SVG y increases DOWN, so we flip.
  const xToPx = (pxNorm: number) =>
    ((pxNorm - VIEW_PXNORM_MIN) / xRange) * width;
  const yToPx = (pzNorm: number) =>
    height - ((pzNorm - yMin) / yRange) * height;

  // Outlier filter — drop pitches with tracking values 6x or more outside
  // the standard zone. Allows wild pitches + extreme chase but cuts the
  // egregious tracking errors that would explode the canvas scale.
  const OUTLIER_THRESHOLD = 6;
  const validPitches = useMemo(
    () =>
      pitches.filter(
        (p) =>
          p.px_norm != null &&
          p.pz_norm != null &&
          Math.abs(p.px_norm) <= OUTLIER_THRESHOLD &&
          Math.abs(p.pz_norm) <= OUTLIER_THRESHOLD,
      ),
    [pitches],
  );
  const droppedOutliers = pitches.filter((p) => p.px_norm != null && p.pz_norm != null).length - validPitches.length;

  // Pre-project the dots once per render so hover lookups are O(1).
  const screenPitches = useMemo<ScreenPitch[]>(
    () =>
      validPitches.map((p) => ({
        row: p,
        cx: xToPx(p.px_norm!),
        cy: yToPx(p.pz_norm!),
        color: PITCH_TYPE_COLOR[p.pitch_type_reclassified ?? ""] ?? "#9CA3AF",
      })),
    // xToPx / yToPx are derived from width / height which are stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [validPitches, width, height],
  );

  // Density heatmap — proper 2D Kernel Density Estimation. Each grid
  // cell sums gaussian contributions from every pitch within a 3-sigma
  // radius, producing one continuous smooth surface (matching the
  // TruMedia "pitch frequency" look) rather than a sparse field of
  // isolated cells. Performance: ~grid×pitches with a distance cutoff
  // → still under 50ms for typical pitcher samples (~600-2000 pitches).
  const heatmapCells = useMemo(() => {
    const GRID = 64;
    const cellW = width / GRID;
    const cellH = height / GRID;
    const density = new Float32Array(GRID * GRID);

    // Bandwidth controls the smoothness of the kernel. ~8% of the canvas
    // dimension gives a TruMedia-style blob — broad enough that any
    // single cell averages over ~25-50 pitches, eliminating speckle.
    const bandwidth = Math.min(width, height) * 0.08;
    const bw2 = 2 * bandwidth * bandwidth;
    const maxDist2 = bw2 * 4.5; // 3-sigma cutoff (kernels beyond this contribute ~negligibly)

    for (let iy = 0; iy < GRID; iy++) {
      const cellCy = (iy + 0.5) * cellH;
      for (let ix = 0; ix < GRID; ix++) {
        const cellCx = (ix + 0.5) * cellW;
        let d = 0;
        for (const p of screenPitches) {
          const dx = cellCx - p.cx;
          const dy = cellCy - p.cy;
          const dist2 = dx * dx + dy * dy;
          if (dist2 < maxDist2) {
            d += Math.exp(-dist2 / bw2);
          }
        }
        density[iy * GRID + ix] = d;
      }
    }

    // Normalize and emit cells. Skip rendering zero-density cells so SVG
    // stays light.
    let max = 0;
    for (let i = 0; i < density.length; i++) if (density[i] > max) max = density[i];
    const cells: Array<{ x: number; y: number; w: number; h: number; density: number }> = [];
    if (max <= 0) return cells;
    for (let iy = 0; iy < GRID; iy++) {
      for (let ix = 0; ix < GRID; ix++) {
        const d = density[iy * GRID + ix] / max;
        if (d <= 0.001) continue;
        cells.push({ x: ix * cellW, y: iy * cellH, w: cellW + 0.6, h: cellH + 0.6, density: d });
      }
    }
    return cells;
  }, [screenPitches, width, height]);

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

  // Extended (shadow / chase) zone — dashed box at PXNorm ±1.5, PZNorm ±1.5.
  // Visual reference for "what's reasonable to swing at" without committing
  // to the literal Statcast shadow band cutoffs.
  const SHADOW = 1.5;
  const shadowRect = {
    x: xToPx(-SHADOW),
    y: yToPx(SHADOW),
    width: xToPx(SHADOW) - xToPx(-SHADOW),
    height: yToPx(-SHADOW) - yToPx(SHADOW),
  };

  // Home plate — a pentagon at the bottom-center of the canvas. Sized
  // proportional to the canvas so it scales with width.
  const plate = {
    cx: width / 2,
    cy: height - 18,
    halfW: Math.max(18, width * 0.07),
    pointDip: 8,
  };
  const platePath = [
    `M ${plate.cx - plate.halfW} ${plate.cy - 6}`,
    `L ${plate.cx + plate.halfW} ${plate.cy - 6}`,
    `L ${plate.cx + plate.halfW * 0.85} ${plate.cy + 2}`,
    `L ${plate.cx} ${plate.cy + plate.pointDip}`,
    `L ${plate.cx - plate.halfW * 0.85} ${plate.cy + 2}`,
    `Z`,
  ].join(" ");

  return (
    <div className="flex flex-col items-stretch">
      {title && (
        <div className="mb-2 flex items-baseline justify-between">
          <h4
            className="font-[Oswald] text-[12px] font-bold uppercase tracking-[0.22em]"
            style={{ color: GOLD }}
          >
            {title}
          </h4>
          {subtitle && (
            <span className="text-[11px] text-white/55 tabular-nums">
              {subtitle}
              {droppedOutliers > 0 && (
                <span
                  className="ml-2 text-white/35"
                  title={`${droppedOutliers} tracking-outlier pitch${droppedOutliers === 1 ? "" : "es"} excluded from the plot`}
                >
                  · {droppedOutliers} outlier{droppedOutliers === 1 ? "" : "s"} hidden
                </span>
              )}
            </span>
          )}
        </div>
      )}
      <div
        className="relative border"
        style={{ width, height, backgroundColor: "#FFFFFF", borderColor: NAVY_BORDER }}
      >
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Strike zone scatter plot of pitches"
        >
          {/* Density heatmap — the primary visualization. The colormap
              itself handles the white → blue → red transition, so cells
              render at full opacity and the perimeter shows blue color
              (matching the TruMedia "pitch frequency" gradient look). */}
          {heatmapCells.map((c, i) => (
            <rect
              key={i}
              x={c.x}
              y={c.y}
              width={c.w}
              height={c.h}
              fill={densityToColor(c.density)}
              fillOpacity={c.density > 0 ? 1 : 0}
            />
          ))}

          {/* Extended chase / shadow zone (dashed) — visual reference. */}
          <rect
            x={shadowRect.x}
            y={shadowRect.y}
            width={shadowRect.width}
            height={shadowRect.height}
            fill="none"
            stroke="#0F172A"
            strokeWidth={1.75}
            strokeDasharray="7 5"
            opacity={0.85}
          />

          {/* Strike zone box — black so it pops on the heatmap. */}
          <rect
            x={zoneRect.x}
            y={zoneRect.y}
            width={zoneRect.width}
            height={zoneRect.height}
            fill="none"
            stroke="#0F172A"
            strokeWidth={3}
          />

          {/* Home plate at the bottom */}
          <path d={platePath} fill="#0F172A" stroke="#0F172A" strokeWidth={1} opacity={0.85} />
        </svg>

        {/* Tooltip */}
        {hoverPitch && (
          <div
            className="pointer-events-none absolute z-10 border px-2.5 py-2 text-[11px] leading-tight text-white shadow-xl tabular-nums"
            style={{
              left: Math.min(hoverPitch.cx + 10, width - 170),
              top: Math.max(hoverPitch.cy - 80, 6),
              backgroundColor: "rgba(4, 8, 16, 0.95)",
              borderColor: hoverPitch.color,
              width: 170,
            }}
          >
            <div
              className="font-[Oswald] text-[11px] font-bold uppercase tracking-wider"
              style={{ color: hoverPitch.color }}
            >
              {hoverPitch.row.pitch_type_reclassified ?? hoverPitch.row.pitch_type ?? "—"}
            </div>
            <div className="mt-0.5 text-white">
              <span className="font-semibold">
                {hoverPitch.row.release_velocity != null
                  ? `${hoverPitch.row.release_velocity.toFixed(1)}`
                  : "—"}
              </span>
              <span className="text-white/50"> mph</span>
              {hoverPitch.row.spin != null && (
                <span className="text-white/55"> · {Math.round(hoverPitch.row.spin)} rpm</span>
              )}
            </div>
            <div className="mt-0.5 text-white/75">
              IVB{" "}
              <span className="text-white">
                {hoverPitch.row.ivb != null ? hoverPitch.row.ivb.toFixed(1) : "—"}
              </span>
              <span className="px-1.5 text-white/35">·</span>
              HB{" "}
              <span className="text-white">
                {hoverPitch.row.hb != null ? hoverPitch.row.hb.toFixed(1) : "—"}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 border-t pt-1.5" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <span className="text-white/70">{hoverPitch.row.pitch_result ?? "—"}</span>
              {hoverPitch.row.stuff_plus != null && (
                <span className="text-white/85">
                  Stuff+ <span className="font-semibold" style={{ color: GOLD }}>{hoverPitch.row.stuff_plus.toFixed(0)}</span>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Density colormap — vivid Stitch palette (variant 2)
// ────────────────────────────────────────────────────────────────────
//
// Derived from Stitch design pass project 17717741894289957208 / screen
// ca5731ced01c44d2. Replaces the previous pastel ramp with fully saturated
// thermal-scan colors that pop off the white canvas. Smooth interpolation
// between stops so the gradient flows but each band has a clear identity.
//
// Color stops (density → color):
//   0.00 — white                  #FFFFFF
//   0.04 — vivid sky blue         #0EA5E9
//   0.18 — vivid blue             #2563EB
//   0.32 — emerald green          #10B981
//   0.48 — bright yellow          #FACC15
//   0.65 — vivid orange           #F97316
//   0.82 — pure red               #EF4444
//   1.00 — deep crimson           #991B1B
function densityToColor(density: number): string {
  const d = Math.max(0, Math.min(1, density));
  const stops: Array<[number, [number, number, number]]> = [
    [0.0, [255, 255, 255]],
    [0.04, [14, 165, 233]],
    [0.18, [37, 99, 235]],
    [0.32, [16, 185, 129]],
    [0.48, [250, 204, 21]],
    [0.65, [249, 115, 22]],
    [0.82, [239, 68, 68]],
    [1.0, [153, 27, 27]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (d <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const tNorm = (d - t0) / (t1 - t0);
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * tNorm);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * tNorm);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * tNorm);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  return "rgb(153, 27, 27)";
}
