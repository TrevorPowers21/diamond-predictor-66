/**
 * 13-Zone Whiff% heat — same 13-zone shape as PitchZoneXwoba (9 inner +
 * 4 L-shaped corners), colored by Whiff% per zone.
 *
 * Pitcher view: how often the pitcher gets a swing-and-miss in each zone.
 * Higher Whiff% = better for the pitcher → red. Lower = blue.
 *
 * Hover tooltip shows the zone's overall Whiff% + a per-pitch-type
 * breakdown (each pitch's whiff/swing rate in that zone), sorted by
 * Whiff% descending.
 */
import { useMemo, useState } from "react";
import type { PitchLocationRow } from "@/savant/hooks/usePitchLogPitchLocation";

const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

type Zone13 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | "UL" | "UR" | "LL" | "LR";

interface ZoneStats {
  zone: Zone13;
  swings: number;
  whiffs: number;
  byPitchType: Map<string, { swings: number; whiffs: number }>;
}

interface PitchZoneWhiffProps {
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
 * Map Whiff% → PITCHER percentile rank. Anchored to D1 distribution
 * (rough — refine with empirical anchors later if needed):
 *   10% → 0 (poor whiff rate)
 *   25% → 50 (league neutral)
 *   50%+ → 100 (elite whiff rate)
 */
function whiffToPercentile(whiff: number): number {
  const pct = whiff * 100;
  if (pct <= 10) return 0;
  if (pct >= 50) return 100;
  if (pct < 25) {
    return (50 * (pct - 10)) / (25 - 10);
  }
  return 50 + (50 * (pct - 25)) / (50 - 25);
}

function whiffToColor(whiff: number | null): string {
  if (whiff == null) return "#F3F4F6";
  const pct = whiffToPercentile(whiff);
  const dist = Math.abs(pct - 50) / 50;
  const alpha = Math.max(0.55, dist);
  if (pct >= 50) return `rgba(200, 52, 30, ${alpha.toFixed(2)})`;
  return `rgba(30, 79, 216, ${alpha.toFixed(2)})`;
}

function cornerWhiffColor(whiff: number | null): string {
  if (whiff == null) return "#F3F4F6";
  const pct = whiffToPercentile(whiff);
  const dist = Math.abs(pct - 50) / 50;
  const alpha = Math.max(0.3, dist * 0.7);
  if (pct >= 50) return `rgba(200, 52, 30, ${alpha.toFixed(2)})`;
  return `rgba(30, 79, 216, ${alpha.toFixed(2)})`;
}

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

export function PitchZoneWhiff({
  pitches,
  width = 360,
  height = 462,
  title,
}: PitchZoneWhiffProps) {
  // Aggregate per zone — total swings/whiffs + per pitch type swings/whiffs
  const zoneStats = useMemo(() => {
    const map = new Map<Zone13, ZoneStats>();
    for (const p of pitches) {
      const z = zoneForPitch(p.px_norm, p.pz_norm);
      if (z == null) continue;
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
      if (!isSwing) continue;

      if (!map.has(z)) map.set(z, { zone: z, swings: 0, whiffs: 0, byPitchType: new Map() });
      const s = map.get(z)!;
      s.swings++;
      if (isWhiff) s.whiffs++;

      const pt = p.pitch_type_reclassified ?? "—";
      let pp = s.byPitchType.get(pt);
      if (!pp) {
        pp = { swings: 0, whiffs: 0 };
        s.byPitchType.set(pt, pp);
      }
      pp.swings++;
      if (isWhiff) pp.whiffs++;
    }
    return map;
  }, [pitches]);

  const cellFor = (z: Zone13) => zoneStats.get(z);

  // Layout — identical to PitchZoneXwoba / PitchZoneUsage so the
  // three zone charts visually line up
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
      path: `M ${leftEdge} ${topEdge} H ${cx} V ${zMinY} H ${zMinX} V ${cy} H ${leftEdge} Z`,
      labelX: leftEdge + (zMinX - leftEdge) / 2,
      labelY: topEdge + (zMinY - topEdge) / 2 + 4,
    },
    {
      zone: "UR",
      path: `M ${cx} ${topEdge} H ${rightEdge} V ${cy} H ${zMaxX} V ${zMinY} H ${cx} Z`,
      labelX: zMaxX + (rightEdge - zMaxX) / 2,
      labelY: topEdge + (zMinY - topEdge) / 2 + 4,
    },
    {
      zone: "LL",
      path: `M ${leftEdge} ${cy} H ${zMinX} V ${zMaxY} H ${cx} V ${bottomEdge} H ${leftEdge} Z`,
      labelX: leftEdge + (zMinX - leftEdge) / 2,
      labelY: zMaxY + (bottomEdge - zMaxY) / 2 + 4,
    },
    {
      zone: "LR",
      path: `M ${zMaxX} ${cy} H ${rightEdge} V ${bottomEdge} H ${cx} V ${zMaxY} H ${zMaxX} Z`,
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
  const platePath = `M ${cx - plateHalfW} ${plateTopY} L ${cx + plateHalfW} ${plateTopY} L ${cx + plateHalfW} ${plateMidY} L ${cx} ${plateBotY} L ${cx - plateHalfW} ${plateMidY} Z`;

  const [hoverZone, setHoverZone] = useState<Zone13 | null>(null);
  const hoverStats = hoverZone != null ? cellFor(hoverZone) : null;
  const hoverWhiff = hoverStats && hoverStats.swings > 0 ? hoverStats.whiffs / hoverStats.swings : null;

  // Per-pitch-type rows for the tooltip — sorted by whiff% desc, only
  // pitch types with ≥ 2 swings in this zone (filter noise)
  const hoverPitchTypes = useMemo(() => {
    if (!hoverStats) return [];
    return [...hoverStats.byPitchType.entries()]
      .filter(([, v]) => v.swings >= 2)
      .map(([pt, v]) => ({ pt, swings: v.swings, whiffs: v.whiffs, whiffPct: (v.whiffs / v.swings) * 100 }))
      .sort((a, b) => b.whiffPct - a.whiffPct);
  }, [hoverStats]);

  const renderInnerCell = (zone: Zone13, x: number, y: number, w: number, h: number) => {
    const s = cellFor(zone);
    const whiff = s && s.swings > 0 ? s.whiffs / s.swings : null;
    const color = whiffToColor(whiff);
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
          {whiff != null ? `${(whiff * 100).toFixed(0)}%` : "—"}
        </text>
      </g>
    );
  };

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
            WHIFF% BY ZONE
          </text>

          {/* Corner cells */}
          {cornerCells.map((c) => {
            const s = cellFor(c.zone);
            const whiff = s && s.swings > 0 ? s.whiffs / s.swings : null;
            const color = cornerWhiffColor(whiff);
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
                  {whiff != null ? `${(whiff * 100).toFixed(0)}%` : "—"}
                </text>
              </g>
            );
          })}
          {innerCells.map((c) => renderInnerCell(c.zone, c.x, c.y, c.w, c.h))}

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

          {/* Home plate */}
          <path d={platePath} fill="none" stroke="#0F172A" strokeWidth={1.5} />
        </svg>

        {/* Dark-navy + gold tooltip — matches the other zone charts */}
        {hoverZone != null && hoverStats && hoverStats.swings > 0 && (
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
                label="Whiff%"
                value={hoverWhiff != null ? `${(hoverWhiff * 100).toFixed(0)}%` : "—"}
              />
              <StatBlock
                label="Swings"
                value={hoverStats.swings.toString()}
              />
            </div>
            <div
              className="border-t pt-2"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <div className="mb-1 font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">
                By Pitch (Whiff / Swing)
              </div>
              {hoverPitchTypes.length === 0 ? (
                <div className="font-[Archivo_Narrow] text-[10px] uppercase tracking-wider text-white/30">
                  Not enough swings
                </div>
              ) : (
                <div className="space-y-0.5">
                  {hoverPitchTypes.map((row) => (
                    <div key={row.pt} className="flex items-baseline justify-between">
                      <span className="font-[Archivo_Narrow] text-[11px] font-medium text-white/80">
                        {row.pt}
                      </span>
                      <span
                        className="font-mono text-[11px] font-semibold tabular-nums"
                        style={{ color: GOLD }}
                      >
                        {row.whiffPct.toFixed(0)}%
                        <span className="ml-1 font-normal text-[9px] text-white/40">
                          ({row.whiffs}/{row.swings})
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
