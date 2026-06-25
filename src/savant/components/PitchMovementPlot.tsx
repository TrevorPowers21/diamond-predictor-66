/**
 * Pitch Movement Profile (Induced Break) — IVB × HB scatter with NCAA
 * reference overlays.
 *
 * X axis: HB (horizontal break, inches). From pitcher's view, positive →
 *   3B side, negative → 1B side. Matches the reference plot.
 * Y axis: IVB (induced vertical break, inches). Positive → more rise,
 *   negative → more drop.
 *
 * For each pitch type the pitcher throws, dots are colored per
 * pitch_type_reclassified. NCAA 2026 D1 averages render as semi-
 * transparent hatched ellipses (mean ± 1 std dev) so the coach can read
 * the gap between this pitcher's movement and league baseline at a
 * glance.
 *
 * Bottom strip: per-pitch-type usage % and whiff %.
 */
import { useMemo, useState } from "react";
import type { PitchLocationRow } from "@/savant/hooks/usePitchLogPitchLocation";
import { NCAA_MOVEMENT_AVERAGES, PITCH_TYPE_COLOR } from "@/savant/lib/pitchLocationHelpers";

const GOLD = "#D4AF37";
const NAVY_BORDER = "#1f2d52";

interface PitchMovementPlotProps {
  pitches: PitchLocationRow[];
  /** SVG width in CSS pixels — height adds room for axis labels + legend. */
  width?: number;
  title?: string;
}

// Movement window — symmetric ±30" so the concentric reference rings
// render as actual circles. Roblez's elite-rise FB at 28.9" sits
// comfortably inside the canvas.
const VIEW_MAX_IN = 30;

export function PitchMovementPlot({ pitches, width = 360, title }: PitchMovementPlotProps) {
  // Reserve room above the plot for the "1B ← MOVES TOWARD → 3B" header
  // and below for the compact 2-row legend (header + USAGE). Whiff%
  // moved out to the per-type averages popup + the standalone 13-Zone
  // Whiff% card, so it's no longer in this legend.
  const HEADER_H = 34;
  const LEGEND_H = 50;
  const plotSize = width;
  const totalH = HEADER_H + plotSize + LEGEND_H;

  // Coordinate mapping — origin at the geometric center, same pixel
  // scale on both axes so rings render as actual circles.
  const cx = plotSize / 2;
  const cy = HEADER_H + plotSize / 2;
  const inchToPx = (plotSize / 2) / VIEW_MAX_IN;
  const xToPx = (hbIn: number) => cx + hbIn * inchToPx;
  const yToPx = (ivbIn: number) => cy - ivbIn * inchToPx; // SVG y flipped

  // Determine pitcher hand from the first valid pitch — pitch movement
  // averages are hand-specific.
  const pitcherHand: "L" | "R" = useMemo(() => {
    for (const p of pitches) {
      if (p.pitcher_hand === "L" || p.pitcher_hand === "R") return p.pitcher_hand;
    }
    return "R";
  }, [pitches]);

  // Per-pitch-type aggregates — used by both the legend (Usage / Whiff)
  // and the on-hover-overlay cursor popup (Velo / IVB / HB / Spin / Stuff+).
  const typeStats = useMemo(() => {
    type Agg = {
      count: number;
      swings: number;
      whiffs: number;
      veloSum: number; veloN: number;
      ivbSum: number; ivbN: number;
      hbSum: number; hbN: number;
      spinSum: number; spinN: number;
      stuffSum: number; stuffN: number;
    };
    const stats: Record<string, Agg> = {};
    let total = 0;
    for (const p of pitches) {
      const t = p.pitch_type_reclassified;
      if (!t) continue;
      if (!stats[t]) {
        stats[t] = {
          count: 0, swings: 0, whiffs: 0,
          veloSum: 0, veloN: 0,
          ivbSum: 0, ivbN: 0,
          hbSum: 0, hbN: 0,
          spinSum: 0, spinN: 0,
          stuffSum: 0, stuffN: 0,
        };
      }
      const s = stats[t];
      s.count++;
      const r = p.pitch_result ?? "";
      if (r === "Strike Swinging" || r === "Strikeout (Swinging)") {
        s.swings++;
        s.whiffs++;
      } else if (
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
        r === "Fielder's Choice"
      ) {
        s.swings++;
      }
      if (p.release_velocity != null) { s.veloSum += p.release_velocity; s.veloN++; }
      if (p.ivb != null) { s.ivbSum += p.ivb; s.ivbN++; }
      if (p.hb != null) { s.hbSum += p.hb; s.hbN++; }
      if (p.spin != null) { s.spinSum += p.spin; s.spinN++; }
      if (p.stuff_plus != null) { s.stuffSum += p.stuff_plus; s.stuffN++; }
      total++;
    }
    return Object.entries(stats)
      .map(([type, s]) => ({
        type,
        count: s.count,
        usagePct: total > 0 ? s.count / total : 0,
        whiffPct: s.swings > 0 ? s.whiffs / s.swings : 0,
        velo: s.veloN > 0 ? s.veloSum / s.veloN : null,
        ivb: s.ivbN > 0 ? s.ivbSum / s.ivbN : null,
        hb: s.hbN > 0 ? s.hbSum / s.hbN : null,
        spin: s.spinN > 0 ? s.spinSum / s.spinN : null,
        stuffPlus: s.stuffN > 0 ? s.stuffSum / s.stuffN : null,
      }))
      .sort((a, b) => b.count - a.count);
  }, [pitches]);

  // Render dots for tracked pitches (need both IVB + HB present). Keep
  // the underlying PitchLocationRow attached to each dot so the hover
  // tooltip can read velo / Stuff+ / result / IVB / HB / pitch type
  // without re-resolving from the index.
  const dots = useMemo(
    () =>
      pitches
        .filter((p) => p.ivb != null && p.hb != null && p.pitch_type_reclassified != null)
        .map((p) => ({
          uniq: p.uniq_pitch_id,
          row: p,
          x: xToPx(p.hb!),
          y: yToPx(p.ivb!),
          color: PITCH_TYPE_COLOR[p.pitch_type_reclassified!] ?? "#9CA3AF",
        })),
    // xToPx / yToPx derived from stable layout constants
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pitches, plotSize],
  );

  // Hover state — track active dot index for tooltip + visual highlight.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const hoverDot = hoverIdx != null ? dots[hoverIdx] : null;

  // Click-to-filter: when a legend column is clicked, isolate that
  // pitch type. Clicking the same column again clears the filter.
  const [selectedType, setSelectedType] = useState<string | null>(null);

  // Hover-on-overlay popup state: hovering an average ellipse (or its
  // legend column) shows per-pitch-type averages including Stuff+.
  const [hoverType, setHoverType] = useState<string | null>(null);
  const activeStatsType = hoverType ?? selectedType;
  const activeStats = activeStatsType
    ? typeStats.find((s) => s.type === activeStatsType) ?? null
    : null;

  // Visible dots — filtered to selected type when active
  const visibleDots = useMemo(
    () => (selectedType ? dots.filter((d) => d.row.pitch_type_reclassified === selectedType) : dots),
    [dots, selectedType],
  );

  // Hatched overlay ellipses for league averages — show only pitches
  // that are a real part of this pitcher's arsenal (≥ 3% usage). One-off
  // misclassifications and rare-pitch sample noise get filtered out so
  // the plot stays clean.
  const MIN_USAGE_FOR_OVERLAY = 0.03;
  const arsenal = new Set(
    typeStats.filter((s) => s.usagePct >= MIN_USAGE_FOR_OVERLAY).map((s) => s.type),
  );
  const overlays = useMemo(() => {
    const out: Array<{ type: string; cx: number; cy: number; rx: number; ry: number; color: string }> = [];
    for (const [type, byHand] of Object.entries(NCAA_MOVEMENT_AVERAGES)) {
      if (!arsenal.has(type)) continue;
      const avg = byHand[pitcherHand];
      out.push({
        type,
        cx: xToPx(avg.hb),
        cy: yToPx(avg.ivb),
        rx: avg.hbStd * inchToPx,
        ry: avg.ivbStd * inchToPx,
        color: PITCH_TYPE_COLOR[type] ?? "#9CA3AF",
      });
    }
    return out;
    // Dependencies: pitcherHand + arsenal is derived from typeStats which
    // recomputes when `pitches` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitches, pitcherHand, plotSize]);

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
        style={{ width, height: totalH, backgroundColor: "#FFFFFF", borderColor: NAVY_BORDER }}
      >
        <svg
          width={width}
          height={totalH}
          viewBox={`0 0 ${width} ${totalH}`}
          role="img"
          aria-label="Pitch movement profile — IVB vs HB"
        >
          {/* Define hatch pattern once per render. We'll fill the league-avg
              ellipses with this so they read as "reference overlay" rather
              than data. */}
          <defs>
            <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="#0F172A" strokeWidth={0.6} strokeOpacity={0.45} />
            </pattern>
          </defs>

          {/* Header — "1B ← MOVES TOWARD → 3B" */}
          <text
            x={width / 2}
            y={18}
            textAnchor="middle"
            fontFamily="Oswald, sans-serif"
            fontSize={11}
            fontWeight={700}
            letterSpacing="0.15em"
            fill="#475569"
          >
            1B ◀ MOVES TOWARD ▶ 3B
          </text>

          {/* Concentric reference rings every 6" out to 30" — elite-rise
              fastballs at 28-30" IVB land inside the outermost ring. */}
          {[6, 12, 18, 24, 30].map((r) => (
            <circle
              key={r}
              cx={cx}
              cy={cy}
              r={r * inchToPx}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth={0.75}
            />
          ))}

          {/* Axes (vertical = HB=0, horizontal = IVB=0) */}
          <line x1={cx} y1={HEADER_H + 2} x2={cx} y2={HEADER_H + plotSize - 2} stroke="#94A3B8" strokeWidth={0.75} />
          <line x1={2} y1={cy} x2={plotSize - 2} y2={cy} stroke="#94A3B8" strokeWidth={0.75} />

          {/* Distance tick labels — 12", 24", 30" on each side. */}
          {[12, 24, 30].map((r) => (
            <g key={`tick-${r}`}>
              <text x={xToPx(r) - 2} y={cy - 4} fontSize={9} fontFamily="Oswald, sans-serif" fill="#94A3B8" textAnchor="end">{r}"</text>
              <text x={xToPx(-r) + 2} y={cy - 4} fontSize={9} fontFamily="Oswald, sans-serif" fill="#94A3B8" textAnchor="start">{r}"</text>
              <text x={cx + 4} y={yToPx(r) + 3} fontSize={9} fontFamily="Oswald, sans-serif" fill="#94A3B8">{r}"</text>
              <text x={cx + 4} y={yToPx(-r) + 3} fontSize={9} fontFamily="Oswald, sans-serif" fill="#94A3B8">{r}"</text>
            </g>
          ))}

          {/* Y axis labels — MORE RISE up, MORE DROP down */}
          <g transform={`translate(${4}, ${HEADER_H + 14})`}>
            <text fontSize={9} fontFamily="Oswald, sans-serif" fontWeight={600} letterSpacing="0.1em" fill="#475569">
              MORE
            </text>
            <text x={0} y={11} fontSize={9} fontFamily="Oswald, sans-serif" fontWeight={600} letterSpacing="0.1em" fill="#475569">
              RISE ▲
            </text>
          </g>
          <g transform={`translate(${4}, ${HEADER_H + plotSize - 12})`}>
            <text fontSize={9} fontFamily="Oswald, sans-serif" fontWeight={600} letterSpacing="0.1em" fill="#475569">
              MORE
            </text>
            <text x={0} y={11} fontSize={9} fontFamily="Oswald, sans-serif" fontWeight={600} letterSpacing="0.1em" fill="#475569">
              DROP ▼
            </text>
          </g>

          {/* NCAA average overlays — hatched ellipses per pitch type.
              Dim when another pitch is isolated; hoverable to surface
              the per-type averages popup. */}
          {overlays.map((o) => {
            const dim = selectedType != null && o.type !== selectedType;
            const isHover = hoverType === o.type;
            return (
              <ellipse
                key={`avg-${o.type}`}
                cx={o.cx}
                cy={o.cy}
                rx={o.rx}
                ry={o.ry}
                fill="url(#hatch)"
                stroke={o.color}
                strokeWidth={isHover ? 2 : 1}
                strokeDasharray="3 2"
                opacity={dim ? 0.15 : isHover ? 0.95 : 0.65}
                style={{ cursor: "pointer", transition: "opacity 150ms ease, stroke-width 150ms ease" }}
                onMouseEnter={() => setHoverType(o.type)}
                onMouseLeave={() => setHoverType(null)}
              />
            );
          })}

          {/* Individual pitch dots — filtered to selectedType when set. */}
          {visibleDots.map((d) => {
            const i = dots.indexOf(d);
            return (
              <circle
                key={d.uniq}
                cx={d.x}
                cy={d.y}
                r={hoverIdx === i ? 6 : 4}
                fill={d.color}
                fillOpacity={hoverIdx === i ? 1 : 0.88}
                stroke={hoverIdx === i ? "#FFFFFF" : "#0F172A"}
                strokeWidth={hoverIdx === i ? 1.75 : 0.5}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                style={{ cursor: "pointer" }}
              />
            );
          })}
        </svg>

        {/* Per-type averages popup — shows when an overlay ellipse is
            hovered OR a pitch type is click-selected. Sits in the top-
            right of the plot area so it doesn't overlap the single-pitch
            hover tooltip. */}
        {activeStats && (
          <div
            className="pointer-events-none absolute z-20 border px-3 py-2 text-[11px] leading-tight text-white shadow-xl tabular-nums"
            style={{
              top: HEADER_H + 6,
              right: 6,
              backgroundColor: "#040810",
              borderColor: PITCH_TYPE_COLOR[activeStats.type] ?? GOLD,
              width: 160,
            }}
          >
            <div className="mb-1 flex items-center gap-1.5 border-b pb-1" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
              <span
                className="inline-block h-2 w-2"
                style={{ backgroundColor: PITCH_TYPE_COLOR[activeStats.type] ?? "#9CA3AF" }}
              />
              <span
                className="font-[Oswald] text-[11px] font-bold uppercase tracking-wider"
                style={{ color: PITCH_TYPE_COLOR[activeStats.type] ?? GOLD }}
              >
                {activeStats.type}
              </span>
              {selectedType === activeStats.type && (
                <span className="ml-auto font-[Archivo_Narrow] text-[8px] uppercase tracking-wider text-white/35">
                  filtered
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <div className="flex flex-col">
                <span className="font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">Velo</span>
                <span className="font-mono text-[12px] font-semibold leading-tight text-white tabular-nums">
                  {activeStats.velo != null ? activeStats.velo.toFixed(1) : "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">Spin</span>
                <span className="font-mono text-[12px] font-semibold leading-tight text-white tabular-nums">
                  {activeStats.spin != null ? Math.round(activeStats.spin).toString() : "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">IVB</span>
                <span className="font-mono text-[12px] font-semibold leading-tight text-white tabular-nums">
                  {activeStats.ivb != null ? activeStats.ivb.toFixed(1) : "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">HB</span>
                <span className="font-mono text-[12px] font-semibold leading-tight text-white tabular-nums">
                  {activeStats.hb != null ? activeStats.hb.toFixed(1) : "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">Stuff+</span>
                <span
                  className="font-mono text-[12px] font-semibold leading-tight tabular-nums"
                  style={{
                    color: activeStats.stuffPlus != null && activeStats.stuffPlus >= 105 ? GOLD : "#FFFFFF",
                  }}
                >
                  {activeStats.stuffPlus != null ? activeStats.stuffPlus.toFixed(1) : "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">Whiff%</span>
                <span className="font-mono text-[12px] font-semibold leading-tight text-white tabular-nums">
                  {(activeStats.whiffPct * 100).toFixed(0)}%
                </span>
              </div>
              <div className="col-span-2 mt-0.5 flex items-baseline justify-between border-t pt-1" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
                <span className="font-[Archivo_Narrow] text-[8px] font-semibold uppercase tracking-wider text-white/45">Usage</span>
                <span className="font-mono text-[11px] font-semibold tabular-nums text-white">
                  {(activeStats.usagePct * 100).toFixed(0)}%
                  <span className="ml-1 font-normal text-[9px] text-white/40">({activeStats.count})</span>
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Hover tooltip — pitch type, velo / spin, IVB / HB, result, Stuff+ */}
        {hoverDot && (
          <div
            className="pointer-events-none absolute z-10 border px-2.5 py-2 text-[11px] leading-tight text-white shadow-xl tabular-nums"
            style={{
              left: Math.min(hoverDot.x + 10, width - 180),
              top: Math.max(hoverDot.y - 90, 6),
              backgroundColor: "#040810",
              borderColor: hoverDot.color,
              width: 180,
            }}
          >
            <div
              className="font-[Oswald] text-[11px] font-bold uppercase tracking-wider"
              style={{ color: hoverDot.color }}
            >
              {hoverDot.row.pitch_type_reclassified ?? hoverDot.row.pitch_type ?? "—"}
            </div>
            <div className="mt-0.5 text-white">
              <span className="font-semibold">
                {hoverDot.row.release_velocity != null
                  ? hoverDot.row.release_velocity.toFixed(1)
                  : "—"}
              </span>
              <span className="text-white/50"> mph</span>
              {hoverDot.row.spin != null && (
                <span className="text-white/55"> · {Math.round(hoverDot.row.spin)} rpm</span>
              )}
            </div>
            <div className="mt-0.5 text-white/75">
              IVB{" "}
              <span className="text-white">
                {hoverDot.row.ivb != null ? hoverDot.row.ivb.toFixed(1) : "—"}
              </span>
              <span className="px-1.5 text-white/35">·</span>
              HB{" "}
              <span className="text-white">
                {hoverDot.row.hb != null ? hoverDot.row.hb.toFixed(1) : "—"}
              </span>
            </div>
            <div
              className="mt-1.5 flex items-center justify-between gap-2 border-t pt-1.5"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <span className="text-white/70">{hoverDot.row.pitch_result ?? "—"}</span>
              {hoverDot.row.stuff_plus != null && (
                <span className="text-white/85">
                  Stuff+{" "}
                  <span className="font-semibold" style={{ color: GOLD }}>
                    {hoverDot.row.stuff_plus.toFixed(0)}
                  </span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Legend table — Stitch-cleaned layout. Proper <table> with
            border-collapse. Header column shows a small color swatch
            stacked above the pitch-type abbreviation. USAGE / WHIFF
            labels sit on the left, bold; values right-align in
            tabular-num columns below each pitch type. */}
        <div
          className="absolute left-0 right-0 bg-white px-2"
          style={{ top: HEADER_H + plotSize + 4 }}
        >
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-16" />
                {typeStats.slice(0, 5).map((s) => {
                  const isSelected = selectedType === s.type;
                  const dim = selectedType != null && !isSelected;
                  return (
                    <th
                      key={`hdr-${s.type}`}
                      className="px-1 py-1 cursor-pointer select-none"
                      style={{
                        opacity: dim ? 0.35 : 1,
                        borderBottom: isSelected
                          ? `2px solid ${PITCH_TYPE_COLOR[s.type] ?? "#9CA3AF"}`
                          : "2px solid transparent",
                        transition: "opacity 150ms ease, border-color 150ms ease",
                      }}
                      onClick={() =>
                        setSelectedType((curr) => (curr === s.type ? null : s.type))
                      }
                      onMouseEnter={() => setHoverType(s.type)}
                      onMouseLeave={() => setHoverType(null)}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span
                          className="inline-block"
                          style={{
                            width: 8,
                            height: 8,
                            backgroundColor: PITCH_TYPE_COLOR[s.type] ?? "#9CA3AF",
                          }}
                        />
                        <span className="font-[Oswald] text-[10px] font-bold uppercase tracking-wider text-slate-900">
                          {abbreviateType(s.type)}
                        </span>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100">
                <td className="py-0.5 text-left">
                  <span className="font-[Oswald] text-[10px] font-bold uppercase tracking-wider text-slate-700">
                    USAGE
                  </span>
                </td>
                {typeStats.slice(0, 5).map((s) => (
                  <td
                    key={`use-${s.type}`}
                    className="px-1 text-center text-[11px] font-semibold text-slate-900 tabular-nums"
                  >
                    {(s.usagePct * 100).toFixed(0)}%
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function abbreviateType(t: string): string {
  switch (t) {
    case "4-Seam Fastball": return "4S";
    case "Sinker": return "SI";
    case "Cutter": return "FC";
    case "Slider": return "SL";
    case "Sweeper": return "SW";
    case "Gyro Slider": return "GY";
    case "Curveball": return "CB";
    case "Change-up": return "CH";
    case "Splitter": return "FS";
    default: return t.slice(0, 2).toUpperCase();
  }
}
