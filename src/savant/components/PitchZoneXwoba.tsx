/**
 * 13-Zone xwOBA heat — 9 inner zones (3×3 grid inside the strike zone)
 * + 4 corner shadows (UL / UR / LL / LR just outside the zone). Each
 * zone colored by xwOBA + shows xwOBA / Whiff% / EV / Barrel% on hover.
 *
 * Pitcher view: pitches the pitcher THREW → xwOBA ALLOWED per zone.
 * Hitter view: pitches the hitter SAW → xwOBA per zone.
 */
import { useMemo, useState } from "react";
import type { PitchLocationRow } from "@/savant/hooks/usePitchLogPitchLocation";
import { percentileColor } from "@/savant/lib/percentile";

const GOLD = "#D4AF37";
const NAVY_BORDER = "#1f2d52";

type Zone13 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | "UL" | "UR" | "LL" | "LR";

interface ZoneStats {
  zone: Zone13;
  pitches: number;
  swings: number;
  whiffs: number;
  battedBalls: number;
  /** xwOBA sum across PA-ending pitches — uses TruMedia x_woba for
   *  batted balls, linear-weight outcome value for walks/HBP/out, and 0
   *  for strikeouts. */
  xWobaSum: number;
  /** PA count = denominator for xwOBA. Only counts PA-ending pitches. */
  pa: number;
  evSum: number;
  evCount: number;
  barrels: number;
}

interface PitchZoneXwobaProps {
  pitches: PitchLocationRow[];
  width?: number;
  height?: number;
  title?: string;
  /** Hitter perspective — flip the color scale (high xwOBA = good). */
  invert?: boolean;
  /** Color + label by avg EV per zone instead of xwOBA. */
  metric?: "xwoba" | "ev";
}

// Strike zone bounds in PXNorm/PZNorm — unit square.
const ZONE_MIN = -1;
const ZONE_MAX = 1;

// Outlier threshold — pitches with |PXNorm| > 4 or |PZNorm| > 4 are
// tracking noise. Drop them so the corner-cell averages aren't skewed.
const OUTLIER_THRESHOLD = 4;

function zoneForPitch(px: number | null, pz: number | null): Zone13 | null {
  if (px == null || pz == null) return null;
  if (Math.abs(px) > OUTLIER_THRESHOLD || Math.abs(pz) > OUTLIER_THRESHOLD) return null;

  // Inside the strike zone → 3×3 grid (zones 1..9, row-major top-left).
  if (px >= ZONE_MIN && px <= ZONE_MAX && pz >= ZONE_MIN && pz <= ZONE_MAX) {
    const col = px < -1 / 3 ? 0 : px < 1 / 3 ? 1 : 2;
    // Row 0 = top (higher PZ), row 2 = bottom
    const row = pz > 1 / 3 ? 0 : pz > -1 / 3 ? 1 : 2;
    return ((row * 3 + col + 1) as Zone13);
  }

  // Outside zone — classify by quadrant (use sign of px / pz).
  // UL = upper-left (px < 0, pz > 0); UR = upper-right; etc.
  if (px <= 0 && pz >= 0) return "UL";
  if (px >= 0 && pz >= 0) return "UR";
  if (px <= 0 && pz <= 0) return "LL";
  if (px >= 0 && pz <= 0) return "LR";
  return null;
}

// Map xwOBA → PITCHER percentile rank (low xwOBA = high percentile =
// good for the pitcher). The ramp uses the standard PercentileBar
// convention: red for ≥ 50 (good performance), blue for < 50 (bad
// performance). So a pitcher's low-xwOBA zone reads red (good) and a
// high-xwOBA zone reads blue (bad).
//
// Anchors derived from D1 distribution:
//   xwOBA  .200 → percentile 100 (elite pitcher result)
//   xwOBA  .335 → percentile 50  (league neutral)
//   xwOBA  .500 → percentile 0   (worst pitcher result)
function xwobaToPercentile(xwoba: number): number {
  if (xwoba <= 0.2) return 100;
  if (xwoba >= 0.5) return 0;
  if (xwoba < 0.335) {
    return 100 - (50 * (xwoba - 0.2)) / (0.335 - 0.2);
  }
  return 50 - (50 * (xwoba - 0.335)) / (0.5 - 0.335);
}

function evToPercentile(ev: number): number {
  // Empirical hitter avg EV: P50 ~88, P95 ~95. 80 -> 0, 96 -> 100.
  return Math.max(0, Math.min(100, ((ev - 80) / 16) * 100));
}
function metricToPercentile(value: number, metric: "xwoba" | "ev"): number {
  return metric === "ev" ? evToPercentile(value) : xwobaToPercentile(value);
}
function xwobaToColor(value: number | null, metric: "xwoba" | "ev", invert = false): string {
  if (value == null) return "#F3F4F6";
  let pct = metricToPercentile(value, metric);
  if (invert) pct = 100 - pct;
  return percentileColor(pct);
}

// Same palette but with a higher minimum alpha so the strike-zone cells
// read as the visual anchor (always at least half-opaque even at the
// neutral .335 xwOBA mark). Corner cells keep the more transparent
// fade-to-white for visual hierarchy.
function strikeZoneCellColor(value: number | null, metric: "xwoba" | "ev", invert = false): string {
  if (value == null) return "#F3F4F6";
  let pct = metricToPercentile(value, metric);
  if (invert) pct = 100 - pct;
  const distance = Math.abs(pct - 50) / 50;
  const alpha = Math.max(0.55, distance);
  if (pct >= 50) return `rgba(200, 52, 30, ${alpha.toFixed(2)})`;
  return `rgba(30, 79, 216, ${alpha.toFixed(2)})`;
}

export function PitchZoneXwoba({
  pitches,
  width = 360,
  height = 462,
  title,
  invert = false,
  metric = "xwoba",
}: PitchZoneXwobaProps) {
  // Aggregate pitches into the 13 zones.
  //
  // xwOBA per zone is computed PROPERLY — over plate appearances, with
  // linear-weight values for each outcome:
  //   Walk      → 0.696
  //   HBP       → 0.726
  //   Strikeout → 0
  //   Batted ball in play → TruMedia x_woba (when present), else fall
  //                        back to the outcome's actual linear weight
  //                        (1B = 0.882, 2B = 1.254, 3B = 1.586, HR =
  //                        2.041, out = 0).
  // Denominator = PA count (pitches that ENDED a plate appearance).
  const zoneStats = useMemo(() => {
    const all = new Map<Zone13, ZoneStats>();
    const init = (z: Zone13): ZoneStats => ({
      zone: z,
      pitches: 0,
      swings: 0,
      whiffs: 0,
      battedBalls: 0,
      xWobaSum: 0,
      pa: 0,
      evSum: 0,
      evCount: 0,
      barrels: 0,
    });

    // Linear-weight contributions per PA outcome.
    function paContribution(p: PitchLocationRow): number | null {
      const cat = p.pitch_result_category;
      if (cat === "Walk") return 0.696;
      if (cat === "HBP") return 0.726;
      if (cat === "Strikeout") return 0;
      if (p.is_batted_ball_in_play) {
        if (p.x_woba != null) return p.x_woba;
        if (cat === "Single") return 0.882;
        if (cat === "Double") return 1.254;
        if (cat === "Triple") return 1.586;
        if (cat === "HR") return 2.041;
        return 0; // out
      }
      return null; // not a PA-ending pitch (Ball, Foul, Strike, etc.)
    }

    for (const p of pitches) {
      const z = zoneForPitch(p.px_norm, p.pz_norm);
      if (z == null) continue;
      if (!all.has(z)) all.set(z, init(z));
      const s = all.get(z)!;
      s.pitches++;
      const r = p.pitch_result ?? "";
      const isWhiff = r === "Strike Swinging" || r === "Strikeout (Swinging)";
      const isSwing =
        isWhiff ||
        r === "Foul" ||
        r.startsWith("Single") ||
        r.startsWith("Double") ||
        r.startsWith("Triple") ||
        r.startsWith("Home Run") ||
        r === "Ground Out" ||
        r === "Fly Out" ||
        r === "Line Out" ||
        r === "Pop Out" ||
        r === "Sac Bunt" ||
        r === "Sac Fly" ||
        r.startsWith("Reached on Error") ||
        r === "Fielder's Choice";
      if (isSwing) s.swings++;
      if (isWhiff) s.whiffs++;

      // PA-ending pitches contribute to xwOBA.
      const contribution = paContribution(p);
      if (contribution !== null) {
        s.xWobaSum += contribution;
        s.pa++;
      }

      // Batted ball stats (EV / barrel rates) — keep separate from PA
      // aggregates since they're per-batted-ball not per-PA.
      if (p.is_batted_ball_in_play) {
        s.battedBalls++;
        if (p.exit_velocity != null) {
          s.evSum += p.exit_velocity;
          s.evCount++;
        }
        if (
          p.exit_velocity != null &&
          p.exit_velocity >= 95 &&
          p.launch_angle != null &&
          p.launch_angle >= 10 &&
          p.launch_angle < 35
        ) {
          s.barrels++;
        }
      }
    }
    return all;
  }, [pitches]);

  const cellFor = (z: Zone13) => zoneStats.get(z);

  // SVG layout — corners fill the 4 quadrants outside the strike zone.
  // Strike zone sits in the middle as a 3×3 grid. Plate visible at the
  // bottom for orientation. padSides leaves white margin around the
  // cells so they don't bleed against the container border.
  const padTop = 36;
  const padBottom = 90; // room for the home plate (matches strike-zone width)
  const padSides = 12;  // white margin against the container border
  const padInnerTop = 12;
  const usableW = width - padSides * 2;
  const usableH = height - padTop - padBottom - padInnerTop;
  // Strike zone box — about 55% of the smaller usable dimension, centered.
  const innerSize = Math.min(usableW, usableH) * 0.55;
  const cellSize = innerSize / 3;
  const cx = width / 2;
  const cy = padTop + padInnerTop + usableH / 2;
  const zMinX = cx - innerSize / 2;
  const zMinY = cy - innerSize / 2;
  const zMaxX = zMinX + innerSize;
  const zMaxY = zMinY + innerSize;

  // 9-inner cell positions
  const innerCells: Array<{ zone: Zone13; x: number; y: number; w: number; h: number }> = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const zoneNum = (row * 3 + col + 1) as Zone13;
      innerCells.push({
        zone: zoneNum,
        x: zMinX + col * cellSize,
        y: zMinY + row * cellSize,
        w: cellSize,
        h: cellSize,
      });
    }
  }

  // Corner cells — L-shapes that wrap each diagonal corner of the
  // strike zone. The horizontal arm extends along the canvas top/bottom
  // edge and meets the adjacent corner at the canvas centerline. The
  // vertical arm extends along the canvas side edge and meets the other
  // adjacent corner at the canvas centerline. Each pair of adjacent
  // corners shares an edge at x=cx (above/below zone) or y=cy (left/right
  // of zone).
  const topEdge = padTop + padInnerTop;
  const bottomEdge = height - padBottom;
  const leftEdge = padSides;
  const rightEdge = width - padSides;
  // Text anchor for each corner's label — center of the diagonal corner
  // region outside the zone, where the L is thickest.
  const cornerCells: Array<{
    zone: Zone13;
    path: string;
    labelX: number;
    labelY: number;
  }> = [
    {
      zone: "UL",
      path: [
        `M ${leftEdge} ${topEdge}`,
        `H ${cx}`,         // top-right meeting point with UR
        `V ${zMinY}`,
        `H ${zMinX}`,      // top-left corner of strike zone
        `V ${cy}`,
        `H ${leftEdge}`,   // bottom-left meeting point with LL
        `Z`,
      ].join(" "),
      labelX: leftEdge + (zMinX - leftEdge) / 2,
      labelY: topEdge + (zMinY - topEdge) / 2 + 4,
    },
    {
      zone: "UR",
      path: [
        `M ${cx} ${topEdge}`,
        `H ${rightEdge}`,
        `V ${cy}`,
        `H ${zMaxX}`,      // top-right corner of strike zone
        `V ${zMinY}`,
        `H ${cx}`,
        `Z`,
      ].join(" "),
      labelX: zMaxX + (rightEdge - zMaxX) / 2,
      labelY: topEdge + (zMinY - topEdge) / 2 + 4,
    },
    {
      zone: "LL",
      path: [
        `M ${leftEdge} ${cy}`,
        `H ${zMinX}`,      // bottom-left corner of strike zone
        `V ${zMaxY}`,
        `H ${cx}`,
        `V ${bottomEdge}`,
        `H ${leftEdge}`,
        `Z`,
      ].join(" "),
      labelX: leftEdge + (zMinX - leftEdge) / 2,
      labelY: zMaxY + (bottomEdge - zMaxY) / 2 + 4,
    },
    {
      zone: "LR",
      path: [
        `M ${zMaxX} ${cy}`,
        `H ${rightEdge}`,
        `V ${bottomEdge}`,
        `H ${cx}`,
        `V ${zMaxY}`,      // bottom-right corner of strike zone
        `H ${zMaxX}`,
        `Z`,
      ].join(" "),
      labelX: zMaxX + (rightEdge - zMaxX) / 2,
      labelY: zMaxY + (bottomEdge - zMaxY) / 2 + 4,
    },
  ];

  // Home plate at the bottom — pentagon centered on the canvas, matching
  // the strike-zone WIDTH. Flat top, vertical sides, triangular bottom
  // converging to a point. Anchored to the bottom of the canvas (down in
  // the white area below the strike zone) instead of just below the zone.
  const plateHalfW = innerSize / 2;
  const plateCx = cx;
  const plateSideH = innerSize * 0.12; // short vertical sides
  const plateTriH = innerSize * 0.22;  // triangular pointed bottom
  const plateBotY = height - 14;       // point near the canvas bottom
  const plateMidY = plateBotY - plateTriH;
  const plateTopY = plateMidY - plateSideH;
  const platePath = [
    `M ${plateCx - plateHalfW} ${plateTopY}`,
    `L ${plateCx + plateHalfW} ${plateTopY}`,
    `L ${plateCx + plateHalfW} ${plateMidY}`,
    `L ${plateCx} ${plateBotY}`,
    `L ${plateCx - plateHalfW} ${plateMidY}`,
    `Z`,
  ].join(" ");

  // Hover state
  const [hoverZone, setHoverZone] = useState<Zone13 | null>(null);

  // Renders one inner cell rect + xwOBA label inside. Stitch-pass:
  // smooth opacity/stroke transitions on hover, cursor crosshair.
  const renderCell = (zone: Zone13, x: number, y: number, w: number, h: number) => {
    const stats = cellFor(zone);
    const value = metric === "ev" ? (stats && stats.evCount > 0 ? stats.evSum / stats.evCount : null) : (stats && stats.pa > 0 ? stats.xWobaSum / stats.pa : null);
    const color = strikeZoneCellColor(value, metric, invert);
    const fontSize = Math.min(w, h) > 70 ? 14 : 11;
    return (
      <g
        key={`zone-${zone}`}
        onMouseEnter={() => setHoverZone(zone)}
        onMouseLeave={() => setHoverZone(null)}
        style={{ cursor: "crosshair" }}
      >
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={color}
          stroke={hoverZone === zone ? "#0F172A" : "rgba(15, 23, 42, 0.18)"}
          strokeWidth={hoverZone === zone ? 2 : 0.5}
          fillOpacity={hoverZone === zone ? 1 : 0.95}
          style={{ transition: "stroke-width 150ms ease, fill-opacity 150ms ease" }}
        />
        <text
          x={x + w / 2}
          y={y + h / 2 + 4}
          textAnchor="middle"
          fontFamily="Oswald, sans-serif"
          fontWeight={700}
          fontSize={fontSize}
          fill="#0F172A"
        >
          {value == null ? "—" : metric === "ev" ? Math.round(value) : value.toFixed(3).replace(/^0/, "")}
        </text>
      </g>
    );
  };

  // Tooltip
  const hoverStats = hoverZone != null ? cellFor(hoverZone) : null;
  const tooltipXwoba =
    hoverStats && hoverStats.pa > 0 ? hoverStats.xWobaSum / hoverStats.pa : null;
  const tooltipWhiff =
    hoverStats && hoverStats.swings > 0 ? hoverStats.whiffs / hoverStats.swings : null;
  const tooltipEv =
    hoverStats && hoverStats.evCount > 0 ? hoverStats.evSum / hoverStats.evCount : null;
  const tooltipBarrel =
    hoverStats && hoverStats.battedBalls > 0
      ? hoverStats.barrels / hoverStats.battedBalls
      : null;

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
        </div>
      )}
      <div
        className="relative border"
        style={{ width, height, backgroundColor: "#FFFFFF", borderColor: NAVY_BORDER }}
      >
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
          {/* Header label */}
          <text
            x={width / 2}
            y={20}
            textAnchor="middle"
            fontFamily="Oswald, sans-serif"
            fontSize={11}
            fontWeight={700}
            letterSpacing="0.15em"
            fill="#475569"
          >
            {metric === "ev" ? "EV BY ZONE" : "xwOBA BY ZONE"}
          </text>

          {/* L-shaped corner cells — each wraps a zone corner and meets
              adjacent corners along the canvas centerlines. Stitch pass:
              start at 60% opacity to visually de-emphasize vs the strike
              zone; hover bumps to 100% with smooth transition. */}
          {cornerCells.map((c) => {
            const stats = cellFor(c.zone);
            const value = metric === "ev" ? (stats && stats.evCount > 0 ? stats.evSum / stats.evCount : null) : (stats && stats.pa > 0 ? stats.xWobaSum / stats.pa : null);
            const color = xwobaToColor(value, metric, invert);
            return (
              <g
                key={`zone-${c.zone}`}
                onMouseEnter={() => setHoverZone(c.zone)}
                onMouseLeave={() => setHoverZone(null)}
                style={{ cursor: "crosshair" }}
              >
                <path
                  d={c.path}
                  fill={color}
                  stroke={hoverZone === c.zone ? "#0F172A" : "rgba(15, 23, 42, 0.18)"}
                  strokeWidth={hoverZone === c.zone ? 2 : 0.5}
                  fillOpacity={hoverZone === c.zone ? 1 : 0.6}
                  style={{ transition: "stroke-width 150ms ease, fill-opacity 150ms ease" }}
                />
                <text
                  x={c.labelX}
                  y={c.labelY}
                  textAnchor="middle"
                  fontFamily="Oswald, sans-serif"
                  fontWeight={700}
                  fontSize={13}
                  fill="#0F172A"
                >
                  {value == null ? "—" : metric === "ev" ? Math.round(value) : value.toFixed(3).replace(/^0/, "")}
                </text>
              </g>
            );
          })}
          {innerCells.map((c) => renderCell(c.zone, c.x, c.y, c.w, c.h))}

          {/* Strike zone outer outline */}
          <rect
            x={zMinX}
            y={zMinY}
            width={innerSize}
            height={innerSize}
            fill="none"
            stroke="#0F172A"
            strokeWidth={2.5}
          />

          {/* Home plate at the bottom — orientation cue. */}
          <path d={platePath} fill="none" stroke="#0F172A" strokeWidth={1.5} />
        </svg>

        {/* Tooltip — dark navy backdrop with gold accents, matching
            the Movement Profile style. */}
        {hoverZone != null && hoverStats && hoverStats.pitches > 0 && (
          <div
            className="pointer-events-none absolute z-10 border p-3 shadow-xl tabular-nums"
            style={{
              left: 10,
              bottom: 10,
              backgroundColor: "#040810",
              borderColor: GOLD,
              width: 200,
            }}
          >
            <h4
              className="mb-2 border-b pb-1 font-[Oswald] text-[10px] font-bold uppercase tracking-wider"
              style={{ color: GOLD, borderColor: "rgba(255,255,255,0.08)" }}
            >
              ZONE {hoverZone}
            </h4>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <StatBlock
                label="xwOBA"
                value={tooltipXwoba != null ? tooltipXwoba.toFixed(3).replace(/^0/, "") : "—"}
              />
              <StatBlock
                label="Whiff%"
                value={tooltipWhiff != null ? `${(tooltipWhiff * 100).toFixed(0)}%` : "—"}
              />
              <StatBlock
                label="Avg EV"
                value={tooltipEv != null ? tooltipEv.toFixed(1) : "—"}
              />
              <StatBlock
                label="Barrel%"
                value={tooltipBarrel != null ? `${(tooltipBarrel * 100).toFixed(0)}%` : "—"}
              />
              <StatBlock label="Pitches" value={hoverStats.pitches.toString()} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Vertical stat block: tiny muted uppercase label on top, tabular-num
// value below in a heavier weight. Used inside the dark tooltip's
// 2-column grid.
function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">
        {label}
      </span>
      <span className="font-mono text-[12px] font-semibold leading-tight text-white tabular-nums">
        {value}
      </span>
    </div>
  );
}
