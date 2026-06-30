/**
 * Pitch Usage pie chart — overall % usage per pitch type. Lives in the
 * Pitch Location section as the third tile alongside Strike Zone
 * Density + 13-Zone Usage.
 *
 * Colors reuse the shared PITCH_TYPE_COLOR map so the pie reads in sync
 * with the Movement Profile legend (same pitch → same hue everywhere).
 */
import { useMemo, useState } from "react";
import { PITCH_TYPE_COLOR } from "@/savant/lib/pitchLocationHelpers";
import type { PitchTypeBreakdown } from "@/savant/lib/pitchLogRates";

const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

interface PitchUsagePieProps {
  breakdowns: PitchTypeBreakdown[];
  width?: number;
  height?: number;
  title?: string;
}

interface Slice {
  pitchType: string;
  pitches: number;
  usagePct: number;
  stuffPlus: number | null;
  startAngle: number;
  endAngle: number;
  color: string;
  pathD: string;
  labelX: number;
  labelY: number;
  showLabel: boolean;
}

/** Polar → Cartesian point on the SVG canvas (0 = top, clockwise). */
function polar(cx: number, cy: number, r: number, angleRad: number): { x: number; y: number } {
  return {
    x: cx + r * Math.sin(angleRad),
    y: cy - r * Math.cos(angleRad),
  };
}


export function PitchUsagePie({
  breakdowns,
  width = 360,
  height = 462,
  title,
}: PitchUsagePieProps) {
  const [hoverType, setHoverType] = useState<string | null>(null);

  // Sort by usage descending so the largest slice anchors at 12 o'clock.
  const sorted = useMemo(
    () => [...breakdowns].filter((b) => b.pitches > 0).sort((a, b) => b.pitches - a.pitches),
    [breakdowns],
  );
  const totalPitches = sorted.reduce((sum, b) => sum + b.pitches, 0);

  // Pie geometry
  const HEADER_H = 36;
  const FOOTER_H = 28;
  const usableH = height - HEADER_H - FOOTER_H;
  const cx = width / 2;
  const cy = HEADER_H + usableH / 2;
  const radius = Math.min(width / 2 - 18, usableH / 2 - 18);

  // Solid-pie geometry. Small angular gap between slices (1.5° padding)
  // keeps segments visually distinct without needing a stroke border.
  const PAD = (1.5 * Math.PI) / 180;

  // Build slices
  const slices = useMemo<Slice[]>(() => {
    if (totalPitches === 0) return [];
    const out: Slice[] = [];
    let cursor = 0;
    for (const b of sorted) {
      const pct = b.pitches / totalPitches;
      const sweep = pct * 2 * Math.PI;
      const half = sweep / 2;
      const startAngle = cursor + Math.min(PAD / 2, half * 0.45);
      const endAngle = cursor + sweep - Math.min(PAD / 2, half * 0.45);
      cursor += sweep;

      // Solid wedge: center → outer arc start → outer arc → center
      const startPt = polar(cx, cy, radius, startAngle);
      const endPt = polar(cx, cy, radius, endAngle);
      const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
      const pathD = [
        `M ${cx} ${cy}`,
        `L ${startPt.x} ${startPt.y}`,
        `A ${radius} ${radius} 0 ${largeArc} 1 ${endPt.x} ${endPt.y}`,
        `Z`,
      ].join(" ");

      // Label position at the slice centroid (62% out from center)
      const midAngle = (startAngle + endAngle) / 2;
      const labelR = radius * 0.62;
      const labelPos = polar(cx, cy, labelR, midAngle);

      out.push({
        pitchType: b.pitchType,
        pitches: b.pitches,
        usagePct: pct,
        stuffPlus: b.stuffPlus,
        startAngle,
        endAngle,
        color: PITCH_TYPE_COLOR[b.pitchType] ?? "#9CA3AF",
        pathD,
        labelX: labelPos.x,
        labelY: labelPos.y,
        showLabel: pct >= 0.1, // inline label only on slices ≥ 10%
      });
    }
    return out;
  }, [sorted, totalPitches, cx, cy, radius]);

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
            PITCH USAGE
          </text>

          {/* Slices */}
          {slices.length === 0 ? (
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              fontFamily="Archivo Narrow, sans-serif"
              fontSize={12}
              fill="#9CA3AF"
            >
              No pitches
            </text>
          ) : (
            <g>
              {slices.map((s) => {
                const isHover = hoverType === s.pitchType;
                const dim = hoverType !== null && !isHover;
                return (
                  <g
                    key={s.pitchType}
                    onMouseEnter={() => setHoverType(s.pitchType)}
                    onMouseLeave={() => setHoverType(null)}
                    style={{
                      cursor: "crosshair",
                      transformOrigin: `${cx}px ${cy}px`,
                      transform: isHover ? "scale(1.03)" : "scale(1)",
                      filter: isHover
                        ? `drop-shadow(0 0 8px ${s.color}80) brightness(1.06)`
                        : "none",
                      transition: "transform 180ms ease, filter 180ms ease, opacity 180ms ease",
                      opacity: dim ? 0.55 : 1,
                    }}
                  >
                    <path d={s.pathD} fill={s.color} stroke="none" />
                    {s.showLabel && (
                      <text
                        x={s.labelX}
                        y={s.labelY + 4}
                        textAnchor="middle"
                        pointerEvents="none"
                        fontFamily="Oswald, sans-serif"
                        fontWeight={700}
                        fontSize={11}
                        fill="#FFFFFF"
                        style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))" }}
                      >
                        {`${(s.usagePct * 100).toFixed(0)}%`}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}
        </svg>

        {/* Hover tooltip — dark navy + gold accent, matches the other zones */}
        {hoverType && (
          <div
            className="pointer-events-none absolute z-10 border p-3 shadow-xl tabular-nums"
            style={{
              left: 10,
              bottom: 10,
              backgroundColor: "#040810",
              borderColor: GOLD,
              width: 180,
            }}
          >
            {(() => {
              const s = slices.find((x) => x.pitchType === hoverType);
              if (!s) return null;
              return (
                <>
                  <div className="mb-1.5 flex items-center gap-2 border-b pb-1" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ backgroundColor: s.color }}
                    />
                    <span
                      className="font-[Oswald] text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: GOLD }}
                    >
                      {s.pitchType}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3">
                    <div className="flex flex-col">
                      <span className="font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">
                        Usage
                      </span>
                      <span className="font-mono text-[12px] font-semibold leading-tight text-white tabular-nums">
                        {(s.usagePct * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">
                        Stuff+
                      </span>
                      <span
                        className="font-mono text-[12px] font-semibold leading-tight tabular-nums"
                        style={{
                          color:
                            s.stuffPlus != null && s.stuffPlus >= 105
                              ? GOLD
                              : "#FFFFFF",
                        }}
                      >
                        {s.stuffPlus != null ? s.stuffPlus.toFixed(1) : "—"}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
