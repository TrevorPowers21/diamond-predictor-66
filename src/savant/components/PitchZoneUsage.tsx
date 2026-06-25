/**
 * 13-Zone Usage heat — same 13-zone shape as PitchZoneXwoba (9 inner +
 * 4 L-shaped corners), colored by USAGE FREQUENCY using the same
 * diverging red-blue percentile scale as the xwOBA chart.
 *
 * High usage = red; low usage = blue. Percentages shown inside each
 * cell. Hover tooltip mirrors the xwOBA chart (absolute-positioned box
 * with Stitch-styled stat blocks).
 *
 * Filtering is controlled by the parent (lifted to PitcherLocationSection
 * so the filter is page-wide across all Visuals charts).
 */
import { useMemo, useState } from "react";
import type { PitchLocationRow } from "@/savant/hooks/usePitchLogPitchLocation";

const NAVY_BORDER = "#1f2d52";

type Zone13 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | "UL" | "UR" | "LL" | "LR";

interface ZoneStats {
  zone: Zone13;
  count: number;
  byPitchType: Map<string, number>;
}

interface PitchZoneUsageProps {
  pitches: PitchLocationRow[];
  width?: number;
  height?: number;
  title?: string;
}

const ZONE_MIN = -1;
const ZONE_MAX = 1;
const OUTLIER_THRESHOLD = 4;

function zoneForPitch(px: number | null, pz: number | null): Zone13 | null {
  if (px == null || pz == null) return null;
  if (Math.abs(px) > OUTLIER_THRESHOLD || Math.abs(pz) > OUTLIER_THRESHOLD) return null;
  if (px >= ZONE_MIN && px <= ZONE_MAX && pz >= ZONE_MIN && pz <= ZONE_MAX) {
    const col = px < -1 / 3 ? 0 : px < 1 / 3 ? 1 : 2;
    const row = pz > 1 / 3 ? 0 : pz > -1 / 3 ? 1 : 2;
    return ((row * 3 + col + 1) as Zone13);
  }
  if (px <= 0 && pz >= 0) return "UL";
  if (px >= 0 && pz >= 0) return "UR";
  if (px <= 0 && pz <= 0) return "LL";
  if (px >= 0 && pz <= 0) return "LR";
  return null;
}

/**
 * Usage % → percentile rank within this chart. The cell with the highest
 * usage maps to 100; the cell with the lowest non-zero usage maps to 0.
 * Symmetric around 50 so the diverging red-blue scale reads correctly.
 */
function usagePctToPercentile(pct: number, maxPct: number): number {
  if (maxPct <= 0) return 50;
  return Math.min(100, Math.max(0, (pct / maxPct) * 100));
}

/**
 * Inner-cell color — same family as PitchZoneXwoba's strikeZoneCellColor.
 * Red for high percentile (high usage = concentrated), blue for low. Alpha
 * scales with distance from 50.
 */
function strikeZoneCellColor(pct: number | null): string {
  if (pct == null) return "#F3F4F6";
  const dist = Math.abs(pct - 50) / 50;
  const alpha = Math.max(0.55, dist);
  if (pct >= 50) return `rgba(200, 52, 30, ${alpha.toFixed(2)})`;
  return `rgba(30, 79, 216, ${alpha.toFixed(2)})`;
}

/**
 * Corner-cell color — uses lower base opacity (0.6) like xwOBA corners
 * so the visualization de-emphasizes outside-the-zone cells.
 */
function cornerCellColor(pct: number | null): string {
  if (pct == null) return "#F3F4F6";
  const dist = Math.abs(pct - 50) / 50;
  const alpha = Math.max(0.3, dist * 0.7);
  if (pct >= 50) return `rgba(200, 52, 30, ${alpha.toFixed(2)})`;
  return `rgba(30, 79, 216, ${alpha.toFixed(2)})`;
}

const GOLD = "#D4AF37";

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

export function PitchZoneUsage({
  pitches,
  width = 360,
  height = 462,
  title,
}: PitchZoneUsageProps) {
  // Aggregate zone counts. Pitches are already filtered upstream by the
  // section-level pitch-type filter, so we don't filter here.
  const { zoneStats, totalCount } = useMemo(() => {
    const map = new Map<Zone13, ZoneStats>();
    let total = 0;
    for (const p of pitches) {
      const z = zoneForPitch(p.px_norm, p.pz_norm);
      if (z == null) continue;
      if (!map.has(z)) map.set(z, { zone: z, count: 0, byPitchType: new Map() });
      const s = map.get(z)!;
      s.count++;
      total++;
      const pt = p.pitch_type_reclassified ?? "—";
      s.byPitchType.set(pt, (s.byPitchType.get(pt) ?? 0) + 1);
    }
    return { zoneStats: map, totalCount: total };
  }, [pitches]);

  // Max usage % across all 13 cells, for percentile normalization
  const maxUsagePct = useMemo(() => {
    if (totalCount === 0) return 0;
    let m = 0;
    for (const s of zoneStats.values()) m = Math.max(m, s.count / totalCount);
    return m;
  }, [zoneStats, totalCount]);

  const cellFor = (z: Zone13) => zoneStats.get(z);
  const cellPercentile = (z: Zone13): number | null => {
    const s = cellFor(z);
    if (!s || totalCount === 0) return null;
    const pct = s.count / totalCount;
    return usagePctToPercentile(pct, maxUsagePct);
  };

  // ── Layout (mirrors PitchZoneXwoba exactly) ──────────────────────────
  const padTop = 36;
  const padBottom = 90;
  const padSides = 12;
  const padInnerTop = 12;
  const usableW = width - padSides * 2;
  const usableH = height - padTop - padBottom - padInnerTop;
  const innerSize = Math.min(usableW, usableH) * 0.55;
  const cellSize = innerSize / 3;
  const cx = width / 2;
  const cy = padTop + padInnerTop + usableH / 2;
  const zMinX = cx - innerSize / 2;
  const zMinY = cy - innerSize / 2;
  const zMaxX = zMinX + innerSize;
  const zMaxY = zMinY + innerSize;

  const innerCells: Array<{ zone: Zone13; x: number; y: number; w: number; h: number }> = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      innerCells.push({
        zone: ((row * 3 + col + 1) as Zone13),
        x: zMinX + col * cellSize,
        y: zMinY + row * cellSize,
        w: cellSize,
        h: cellSize,
      });
    }
  }

  const topEdge = padTop + padInnerTop;
  const bottomEdge = height - padBottom;
  const leftEdge = padSides;
  const rightEdge = width - padSides;
  const cornerCells: Array<{ zone: Zone13; path: string; labelX: number; labelY: number }> = [
    {
      zone: "UL",
      path: [
        `M ${leftEdge} ${topEdge}`,
        `H ${cx}`,
        `V ${zMinY}`,
        `H ${zMinX}`,
        `V ${cy}`,
        `H ${leftEdge}`,
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
        `H ${zMaxX}`,
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
        `H ${zMinX}`,
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
        `V ${zMaxY}`,
        `H ${zMaxX}`,
        `Z`,
      ].join(" "),
      labelX: zMaxX + (rightEdge - zMaxX) / 2,
      labelY: zMaxY + (bottomEdge - zMaxY) / 2 + 4,
    },
  ];

  // Home plate
  const plateHalfW = innerSize / 2;
  const plateSideH = innerSize * 0.12;
  const plateTriH = innerSize * 0.22;
  const plateBotY = height - 14;
  const plateMidY = plateBotY - plateTriH;
  const plateTopY = plateMidY - plateSideH;
  const platePath = [
    `M ${cx - plateHalfW} ${plateTopY}`,
    `L ${cx + plateHalfW} ${plateTopY}`,
    `L ${cx + plateHalfW} ${plateMidY}`,
    `L ${cx} ${plateBotY}`,
    `L ${cx - plateHalfW} ${plateMidY}`,
    `Z`,
  ].join(" ");

  const [hoverZone, setHoverZone] = useState<Zone13 | null>(null);

  const renderCell = (zone: Zone13, x: number, y: number, w: number, h: number) => {
    const stats = cellFor(zone);
    const pct = cellPercentile(zone);
    const color = strikeZoneCellColor(pct);
    const fontSize = Math.min(w, h) > 70 ? 14 : 11;
    const usagePct = stats && totalCount > 0 ? (stats.count / totalCount) * 100 : null;
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
          {usagePct != null ? `${usagePct.toFixed(0)}%` : "—"}
        </text>
      </g>
    );
  };

  const hoverStats = hoverZone != null ? cellFor(hoverZone) : null;
  const hoverUsagePct =
    hoverStats && totalCount > 0 ? (hoverStats.count / totalCount) * 100 : null;
  // Per-pitch-type breakdown for the hovered zone — sorted by count desc.
  // Each entry's percent is OF THE ZONE (not of total), so a zone that only
  // got Sliders reads "Slider: 100%" regardless of how often that zone was
  // hit overall.
  const hoverPitchTypes =
    hoverStats != null && hoverStats.count > 0
      ? [...hoverStats.byPitchType.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([pt, n]) => ({ pt, n, pct: (n / hoverStats.count) * 100 }))
      : [];

  return (
    <div className="flex flex-col items-stretch">
      {title && (
        <div className="mb-2 flex items-baseline justify-between">
          <h4
            className="font-[Oswald] text-[12px] font-bold uppercase tracking-[0.22em]"
            style={{ color: "#D4AF37" }}
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
            USAGE BY ZONE
          </text>

          {/* Corner L-shaped cells */}
          {cornerCells.map((c) => {
            const stats = cellFor(c.zone);
            const pct = cellPercentile(c.zone);
            const color = cornerCellColor(pct);
            const usagePct = stats && totalCount > 0 ? (stats.count / totalCount) * 100 : null;
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
                  {usagePct != null ? `${usagePct.toFixed(0)}%` : "—"}
                </text>
              </g>
            );
          })}
          {innerCells.map((c) => renderCell(c.zone, c.x, c.y, c.w, c.h))}

          {/* Strike zone outline */}
          <rect
            x={zMinX}
            y={zMinY}
            width={innerSize}
            height={innerSize}
            fill="none"
            stroke="#0F172A"
            strokeWidth={2.5}
          />

          {/* Home plate */}
          <path d={platePath} fill="none" stroke="#0F172A" strokeWidth={1.5} />
        </svg>

        {/* Hover tooltip — dark navy backdrop with gold accents, matching
            the Movement Profile style. Header in zone-gold, body in white
            with muted dividers, per-pitch breakdown below. */}
        {hoverZone != null && hoverStats && hoverStats.count > 0 && (
          <div
            className="pointer-events-none absolute z-10 border p-3 shadow-xl tabular-nums"
            style={{
              left: 10,
              bottom: 10,
              backgroundColor: "#040810",
              borderColor: GOLD,
              width: 220,
            }}
          >
            <h4
              className="mb-2 border-b pb-1 font-[Oswald] text-[10px] font-bold uppercase tracking-wider"
              style={{ color: GOLD, borderColor: "rgba(255,255,255,0.08)" }}
            >
              ZONE {hoverZone}
            </h4>
            <div className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1">
              <StatBlock
                label="Usage%"
                value={hoverUsagePct != null ? `${hoverUsagePct.toFixed(1)}%` : "—"}
              />
              <StatBlock label="Pitches" value={hoverStats.count.toString()} />
            </div>
            <div
              className="border-t pt-2"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <div className="mb-1 font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">
                By Pitch
              </div>
              <div className="space-y-0.5">
                {hoverPitchTypes.map((row) => (
                  <div key={row.pt} className="flex items-baseline justify-between">
                    <span className="font-[Archivo_Narrow] text-[11px] font-medium text-white/80">
                      {row.pt}
                    </span>
                    <span className="font-mono text-[11px] font-semibold tabular-nums" style={{ color: GOLD }}>
                      {row.pct.toFixed(0)}%
                      <span className="ml-1 font-normal text-[9px] text-white/40">
                        ({row.n})
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
