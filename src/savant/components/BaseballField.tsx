/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";

/*
  BaseballField — RSTR IQ
  A self-contained SVG field with 5 infield + 5 outfield zones, each colored
  on a heat ramp and labeled with a value. No external chart library.

  Coordinate model (feet, home plate at origin, +y toward center field):
    pt(d, deg): point d feet from home along angle deg (0 = straight CF,
    negative = left/LF side, positive = right/RF side).
  The outfield wall is generated from 5 fence distances.
  The infield boundary is the grass-line arc: radius 95 ft from the mound
  (the rubber sits 60.5 ft up the center line), swept foul line to foul line.
*/

// ---- internal coordinate space (matches the design) ----
const VB_W = 680;
const VB_H = 500;
const HOME_X = 340;
const HOME_Y = 452;
const SCALE = 0.9; // px per foot

// angular column boundaries: LF, LC, CF, RC, RF
// Matches the stored hit_location cutoffs (pitch_log): far_left -45..-30,
// left_center -30..-15, center -15..15, right_center 15..30, far_right 30..45.
const COL_BOUNDS = [-45, -30, -15, 15, 30, 45];
const COL_NAMES = ["LF", "LC", "CF", "RC", "RF"];
// Band-specific zone names for the hover tooltip. Outfield reads as field
// regions; infield reads as the position the ball is hit toward (positioning).
const OUTFIELD_NAMES = ["Left Field", "Left Center", "Center", "Right Center", "Right Field"];
const INFIELD_NAMES = ["Third Base", "Shortstop", "Up the Middle", "Second Base", "First Base"];

// Hover card matching the movement-profile / zone tooltip design: #040810
// card, accent-colored border + Oswald header, muted body, divider. Positioned
// as an HTML overlay (percent of the viewBox) above the hovered point.
function FieldTooltip({
  x,
  y,
  header,
  body,
  accent,
}: {
  x: number;
  y: number;
  header: string;
  body: string[];
  accent: string;
}) {
  const xf = x / VB_W;
  const ax = xf < 0.2 ? "0%" : xf > 0.8 ? "-100%" : "-50%";
  return (
    <div
      className="pointer-events-none absolute z-20 whitespace-nowrap border px-2.5 py-2 text-[11px] leading-tight text-white shadow-xl tabular-nums"
      style={{
        left: `${xf * 100}%`,
        top: `${(y / VB_H) * 100}%`,
        transform: `translate(${ax}, calc(-100% - 10px))`,
        backgroundColor: "#040810",
        borderColor: accent,
      }}
    >
      <div
        className="font-[Oswald] text-[11px] font-bold uppercase tracking-wider"
        style={{ color: accent }}
      >
        {header}
      </div>
      {body.length > 0 && (
        <div
          className="mt-1 space-y-0.5 border-t pt-1 text-white/80"
          style={{ borderColor: "rgba(255,255,255,0.08)" }}
        >
          {body.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// wall control angles, matched to the 5 fence inputs
const WALL_ANGLES = [-45, -20, 0, 20, 45];

// infield arc geometry
const MOUND_FT = 60.5;
const ARC_FT = 95;

export interface FieldDimensions {
  lfLine: number;
  lcGap: number;
  cf: number;
  rcGap: number;
  rfLine: number;
}

export interface FieldTheme {
  bg: string;
  grass: string;
  dirt: string;
  foulLine: string;
  wall: string;
  bone: string;
  ink: string;
  divider: string;
  labelStroke: string;
}

const DEFAULT_DIMENSIONS: FieldDimensions = {
  lfLine: 330,
  lcGap: 370,
  cf: 400,
  rcGap: 370,
  rfLine: 330,
};

const DEFAULT_THEME: FieldTheme = {
  bg: "#26292e",
  grass: "#363a3f",
  dirt: "#43403b",
  foulLine: "#6c7177",
  wall: "#a7adb4",
  bone: "#cdd1d6",
  ink: "#f4f1e8",
  divider: "#23262b",
  labelStroke: "#1c1e22",
};

// low -> high heat ramp
const DEFAULT_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [47, 75, 110]],
  [0.4, [47, 143, 125]],
  [0.7, [210, 165, 47]],
  [1.0, [193, 74, 42]],
];

// ---------- math helpers ----------
function pt(d: number, deg: number) {
  const r = (deg * Math.PI) / 180;
  return { x: HOME_X + d * Math.sin(r) * SCALE, y: HOME_Y - d * Math.cos(r) * SCALE };
}

function segs(p: Array<{ x: number; y: number }>) {
  const out: string[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] || p[i + 1];
    out.push(
      `C ${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ` +
        `${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`,
    );
  }
  return out;
}

function sampleRay(fn: (a: number) => number, a1: number, a2: number, n: number) {
  const p: Array<{ x: number; y: number }> = [];
  for (let k = 0; k <= n; k++) {
    const th = a1 + ((a2 - a1) * k) / n;
    p.push(pt(fn(th), th));
  }
  return p;
}

// radial distance (ft) from home to the grass-line arc at angle th
export function arcDistance(th: number) {
  const c = Math.cos((th * Math.PI) / 180);
  return (121 * c + Math.sqrt(121 * c * 121 * c + 21459)) / 2;
}

// fence distance (ft) at angle th, Catmull-Rom over the 5 fence values
function makeWallD(dims: FieldDimensions) {
  const Y = [dims.lfLine, dims.lcGap, dims.cf, dims.rcGap, dims.rfLine];
  return (th: number) => {
    const X = WALL_ANGLES;
    if (th <= X[0]) return Y[0];
    if (th >= X[4]) return Y[4];
    let i = 0;
    while (th > X[i + 1]) i++;
    const t = (th - X[i]) / (X[i + 1] - X[i]);
    const p0 = Y[Math.max(0, i - 1)];
    const p1 = Y[i];
    const p2 = Y[i + 1];
    const p3 = Y[Math.min(4, i + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
    );
  };
}

function makeHeat(stops: Array<[number, [number, number, number]]>) {
  return (v: number) => {
    if (v <= 0) return `rgb(${stops[0][1].join(",")})`;
    if (v >= 1) return `rgb(${stops[stops.length - 1][1].join(",")})`;
    for (let i = 0; i < stops.length - 1; i++) {
      if (v >= stops[i][0] && v <= stops[i + 1][0]) {
        const t = (v - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
        const a = stops[i][1];
        const b = stops[i + 1][1];
        return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(
          a[1] + (b[1] - a[1]) * t,
        )},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
      }
    }
    return `rgb(${stops[2][1].join(",")})`;
  };
}

/*
  bucketBattedBalls — turn raw pitch_events rows into the 10 zone values.
  Accepts rows with either { sprayAngle, distance } (preferred if you have it)
  or Statcast-style { hc_x, hc_y }. Returns counts per zone; pass to toPercent
  if you want shares. DISTANCE_SCALE may need calibration to your data source.
*/
export function bucketBattedBalls(
  rows: Array<{ sprayAngle?: number; distance?: number; hc_x?: number; hc_y?: number }>,
  { distanceScale = 2.0 }: { distanceScale?: number } = {},
) {
  const infield = [0, 0, 0, 0, 0];
  const outfield = [0, 0, 0, 0, 0];
  for (const row of rows) {
    let angle: number;
    let distFt: number | null;
    if (row.sprayAngle != null) {
      angle = row.sprayAngle;
      distFt = row.distance != null ? row.distance : null;
    } else if (row.hc_x != null && row.hc_y != null) {
      const x = row.hc_x - 125.42;
      const y = 198.27 - row.hc_y;
      angle = (Math.atan2(x, y) * 180) / Math.PI;
      distFt = Math.sqrt(x * x + y * y) * distanceScale;
    } else {
      continue;
    }
    if (angle < -45 || angle > 45) continue; // foul
    let col = 0;
    while (col < 4 && angle > COL_BOUNDS[col + 1]) col++;
    const inInfield = distFt == null ? false : distFt <= arcDistance(angle);
    (inInfield ? infield : outfield)[col] += 1;
  }
  return { infield, outfield };
}

export function toPercent(
  { infield, outfield }: { infield: number[]; outfield: number[] },
  digits = 0,
) {
  const total = [...infield, ...outfield].reduce((a, b) => a + b, 0) || 1;
  const f = (n: number) => Number(((n / total) * 100).toFixed(digits));
  return { infield: infield.map(f), outfield: outfield.map(f) };
}

interface BaseballFieldProps {
  dimensions?: FieldDimensions;
  infield?: number[];
  outfield?: number[];
  /** optional separate metric arrays that drive COLOR (defaults to the values) */
  colorInfield?: number[];
  colorOutfield?: number[];
  /** pre-computed per-zone fill colors (5 each). When provided, override the
   *  internal stops/normalize coloring entirely — used to drive the percentile
   *  red↔blue ramp, normalized per band. */
  fillInfield?: string[];
  fillOutfield?: string[];
  /** Individual batted balls plotted at their landing spot (defensive
   *  positioning view). Distance in feet, sprayAngle in degrees. tooltipLines
   *  render in a hover box (e.g. EV / LA / Result / xwOBA). */
  dots?: Array<{
    sprayAngle: number;
    distance: number | null;
    color?: string;
    tooltipLines?: string[];
  }>;
  /** Rich per-zone hover lines for heatmap fields, keyed `${band}-${col}`
   *  (e.g. "infield-2"). When present the zone tooltip renders these lines
   *  under the zone name instead of the single value. */
  zoneTooltips?: Record<string, string[]>;
  /** "band" = each band on its own scale, "global" = shared */
  normalize?: "band" | "global";
  formatValue?: (v: number) => string | number;
  showFenceLabels?: boolean;
  showTotals?: boolean;
  theme?: Partial<FieldTheme>;
  stops?: Array<[number, [number, number, number]]>;
  onZoneSelect?: (z: { band: string; col: number; name: string; value: number }) => void;
  /** When false, zone hover/tooltip is disabled (e.g. the dots spray chart,
   *  where only the dots should respond). Default true. */
  interactiveZones?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export default function BaseballField({
  dimensions = DEFAULT_DIMENSIONS,
  infield = [6, 5, 4, 3, 2],
  outfield = [22, 20, 16, 12, 10],
  colorInfield,
  colorOutfield,
  fillInfield,
  fillOutfield,
  dots,
  zoneTooltips,
  normalize = "band",
  formatValue = (v) => Math.round(v),
  showFenceLabels = true,
  showTotals = true,
  theme = DEFAULT_THEME,
  stops = DEFAULT_STOPS,
  onZoneSelect,
  interactiveZones = true,
  style,
  className,
}: BaseballFieldProps) {
  const T: FieldTheme = { ...DEFAULT_THEME, ...theme };
  const [hovered, setHovered] = useState<{ band: string; col: number } | null>(null);
  const [hoveredDot, setHoveredDot] = useState<{ x: number; y: number; lines: string[]; color?: string } | null>(null);
  const heat = useMemo(() => makeHeat(stops), [stops]);
  const wallD = useMemo(() => makeWallD(dimensions), [dimensions]);

  const cInf = colorInfield || infield;
  const cOff = colorOutfield || outfield;

  const norm = (x: number, arr: number[]) => {
    let lo: number;
    let hi: number;
    if (normalize === "global") {
      const all = [...cInf, ...cOff];
      lo = Math.min(...all);
      hi = Math.max(...all);
    } else {
      lo = Math.min(...arr);
      hi = Math.max(...arr);
    }
    return hi > lo ? (x - lo) / (hi - lo) : 0.5;
  };

  const geo = useMemo(() => {
    const pLF = pt(dimensions.lfLine, -45);
    const pRF = pt(dimensions.rfLine, 45);
    const wseg = segs([
      pLF,
      pt(dimensions.lcGap, -20),
      pt(dimensions.cf, 0),
      pt(dimensions.rcGap, 20),
      pRF,
    ]);
    const fairFill = `M ${HOME_X},${HOME_Y} L ${pLF.x},${pLF.y} ${wseg.join(
      " ",
    )} L ${HOME_X},${HOME_Y} Z`;
    const wallLine = `M ${pLF.x},${pLF.y} ${wseg.join(" ")}`;

    const fan = sampleRay(arcDistance, -45, 45, 16);
    const dirtFan = `M ${HOME_X},${HOME_Y} L ${fan[0].x},${fan[0].y} ${segs(fan).join(
      " ",
    )} L ${HOME_X},${HOME_Y} Z`;
    const grassLine = `M ${fan[0].x},${fan[0].y} ${segs(fan).join(" ")}`;

    const zones: Array<{ col: number; band: string; name: string; path: string }> = [];
    const labels: Array<{ band: string; col: number; x: number; y: number; fs: number }> = [];
    for (let c = 0; c < 5; c++) {
      const a1 = COL_BOUNDS[c];
      const a2 = COL_BOUNDS[c + 1];
      const mid = (a1 + a2) / 2;

      const ar = sampleRay(arcDistance, a1, a2, 8);
      const ifPath = `M ${HOME_X},${HOME_Y} L ${ar[0].x},${ar[0].y} ${segs(ar).join(
        " ",
      )} L ${HOME_X},${HOME_Y} Z`;

      const ow = sampleRay(wallD, a1, a2, 8);
      const arR = ar.slice().reverse();
      const ofPath =
        `M ${ar[0].x},${ar[0].y} L ${ow[0].x},${ow[0].y} ${segs(ow).join(" ")} ` +
        `L ${arR[0].x},${arR[0].y} ${segs(arR).join(" ")} Z`;

      zones.push({ col: c, band: "infield", name: COL_NAMES[c], path: ifPath });
      zones.push({ col: c, band: "outfield", name: COL_NAMES[c], path: ofPath });

      const ip = pt(arcDistance(mid) * 0.78, mid);
      const orad = (arcDistance(mid) + wallD(mid)) / 2;
      const op = pt(orad, mid);
      labels.push({ band: "infield", col: c, x: ip.x, y: ip.y, fs: 13 });
      labels.push({ band: "outfield", col: c, x: op.x, y: op.y, fs: 17 });
    }

    const dividers: Array<{ x: number; y: number }> = [];
    for (let j = 1; j < 5; j++) {
      const bp = pt(wallD(COL_BOUNDS[j]), COL_BOUNDS[j]);
      dividers.push({ x: bp.x, y: bp.y });
    }

    const fenceLabels = [
      { p: pt(dimensions.lfLine, -45), v: dimensions.lfLine, anchor: "start" as const },
      { p: pt(dimensions.lcGap, -20), v: dimensions.lcGap, anchor: "middle" as const },
      { p: pt(dimensions.cf, 0), v: dimensions.cf, anchor: "middle" as const },
      { p: pt(dimensions.rcGap, 20), v: dimensions.rcGap, anchor: "middle" as const },
      { p: pt(dimensions.rfLine, 45), v: dimensions.rfLine, anchor: "end" as const },
    ];

    const b1 = pt(90, 45);
    const b2 = pt(127.28, 0);
    const b3 = pt(90, -45);
    const mound = pt(MOUND_FT, 0);

    return {
      fairFill,
      wallLine,
      dirtFan,
      grassLine,
      zones,
      labels,
      dividers,
      fenceLabels,
      pLF,
      pRF,
      b1,
      b2,
      b3,
      mound,
    };
  }, [dimensions, wallD]);

  const valueFor = (z: { band: string; col: number }) =>
    z.band === "infield" ? infield[z.col] : outfield[z.col];
  const colorFor = (z: { band: string; col: number }) => {
    if (z.band === "infield" && fillInfield) return fillInfield[z.col];
    if (z.band === "outfield" && fillOutfield) return fillOutfield[z.col];
    return z.band === "infield" ? heat(norm(cInf[z.col], cInf)) : heat(norm(cOff[z.col], cOff));
  };

  const ifTotal = infield.reduce((a, b) => a + b, 0);
  const ofTotal = outfield.reduce((a, b) => a + b, 0);

  const baseSq = (b: { x: number; y: number }, key: string) => (
    <rect
      key={key}
      x={b.x - 4}
      y={b.y - 4}
      width={8}
      height={8}
      fill={T.bone}
      transform={`rotate(45 ${b.x} ${b.y})`}
    />
  );

  return (
    <div className={className} style={{ width: "100%", position: "relative", ...style }}>
      <svg
        width="100%"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        style={{ display: "block" }}
        onMouseLeave={() => {
          setHovered(null);
          setHoveredDot(null);
        }}
      >
        <title>Batted-ball distribution by field zone</title>
        <desc>Five infield and five outfield zones colored by share of batted balls.</desc>

        <rect x={30} y={54} width={620} height={418} rx={14} fill={T.bg} />
        <path d={geo.fairFill} fill={T.grass} />
        <path d={geo.dirtFan} fill={T.dirt} />

        {geo.zones.map((z: any, i: number) => {
          const isHover = hovered != null && hovered.band === z.band && hovered.col === z.col;
          return (
            <path
              key={`z${i}`}
              d={z.path}
              fill={colorFor(z)}
              fillOpacity={isHover ? 0.95 : 0.82}
              stroke={isHover ? T.wall : "none"}
              strokeWidth={isHover ? 1.5 : 0}
              style={{ cursor: onZoneSelect ? "pointer" : "default" }}
              onMouseEnter={interactiveZones ? () => setHovered({ band: z.band, col: z.col }) : undefined}
              onMouseLeave={interactiveZones ? () => setHovered(null) : undefined}
              onClick={
                onZoneSelect
                  ? () => onZoneSelect({ ...z, value: valueFor(z) })
                  : undefined
              }
            />
          );
        })}

        {geo.dividers.map((d, i) => (
          <line
            key={`d${i}`}
            x1={HOME_X}
            y1={HOME_Y}
            x2={d.x}
            y2={d.y}
            stroke={T.divider}
            strokeWidth={1}
            strokeOpacity={0.6}
          />
        ))}
        <path d={geo.grassLine} fill="none" stroke="#9c8862" strokeWidth={2} strokeOpacity={0.85} />

        <line
          x1={HOME_X}
          y1={HOME_Y}
          x2={geo.pLF.x}
          y2={geo.pLF.y}
          stroke={T.foulLine}
          strokeWidth={1.5}
        />
        <line
          x1={HOME_X}
          y1={HOME_Y}
          x2={geo.pRF.x}
          y2={geo.pRF.y}
          stroke={T.foulLine}
          strokeWidth={1.5}
        />
        <path d={geo.wallLine} fill="none" stroke={T.wall} strokeWidth={3} strokeLinecap="round" />

        {dots && (
          <path
            d={`M ${HOME_X},${HOME_Y} L ${geo.b1.x},${geo.b1.y} L ${geo.b2.x},${geo.b2.y} L ${geo.b3.x},${geo.b3.y} Z`}
            fill={T.grass}
            stroke="#C9A06B"
            strokeWidth={2.5}
          />
        )}
        {baseSq(geo.b1, "b1")}
        {baseSq(geo.b2, "b2")}
        {baseSq(geo.b3, "b3")}
        <rect
          x={HOME_X - 4}
          y={HOME_Y - 4}
          width={8}
          height={8}
          fill={T.bone}
          transform={`rotate(45 ${HOME_X} ${HOME_Y})`}
        />
        <rect x={geo.mound.x - 5} y={geo.mound.y - 2} width={10} height={3} fill={T.bone} />

        {dots &&
          dots.map((d, i) => {
            if (d.distance == null || d.sprayAngle < -45 || d.sprayAngle > 45) return null;
            const dist = Math.min(d.distance, dimensions.cf + 15); // clamp past the fence
            const p = pt(dist, d.sprayAngle);
            const isHover =
              hoveredDot != null && Math.abs(hoveredDot.x - p.x) < 0.1 && Math.abs(hoveredDot.y - p.y) < 0.1;
            return (
              <circle
                key={`dot${i}`}
                cx={p.x}
                cy={p.y}
                r={isHover ? 6 : 4.5}
                fill={d.color || T.ink}
                fillOpacity={1}
                stroke={isHover ? "#FFFFFF" : "#04081066"}
                strokeWidth={isHover ? 1.5 : 0.75}
                style={{ cursor: d.tooltipLines ? "pointer" : "default" }}
                onMouseEnter={() =>
                  d.tooltipLines && setHoveredDot({ x: p.x, y: p.y, lines: d.tooltipLines, color: d.color })
                }
                onMouseLeave={() => setHoveredDot(null)}
              />
            );
          })}

        {showFenceLabels &&
          geo.fenceLabels.map((f, i) => (
            <text
              key={`f${i}`}
              x={f.p.x}
              y={f.p.y - 7}
              fill={T.bone}
              fontSize={12}
              textAnchor={f.anchor}
            >
              {Math.round(f.v)}
            </text>
          ))}

        {geo.labels.map((L, i) => {
          const z = geo.zones.find((zz: any) => zz.band === L.band && zz.col === L.col);
          if (!z) return null;
          return (
            <text
              key={`l${i}`}
              x={L.x}
              y={L.y + L.fs * 0.35}
              fill={T.ink}
              fontSize={L.fs}
              fontWeight={500}
              textAnchor="middle"
              stroke={T.labelStroke}
              strokeWidth={2.5}
              paintOrder="stroke"
              strokeLinejoin="round"
            >
              {formatValue(valueFor(z))}
            </text>
          );
        })}

      </svg>

      {interactiveZones && hovered && (() => {
        const L = geo.labels.find((l) => l.band === hovered.band && l.col === hovered.col);
        if (!L) return null;
        const name =
          hovered.band === "infield" ? INFIELD_NAMES[hovered.col] : OUTFIELD_NAMES[hovered.col];
        const rich = zoneTooltips?.[`${hovered.band}-${hovered.col}`];
        const body =
          rich && rich.length
            ? rich
            : [formatValue(valueFor({ band: hovered.band, col: hovered.col }))];
        return <FieldTooltip x={L.x} y={L.y} header={name} body={body} accent={T.wall} />;
      })()}

      {hoveredDot && (
        <FieldTooltip
          x={hoveredDot.x}
          y={hoveredDot.y}
          header={hoveredDot.lines[0] ?? ""}
          body={hoveredDot.lines.slice(1)}
          accent={hoveredDot.color ?? T.wall}
        />
      )}

      {showTotals && (
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 500, color: T.ink }}>
          Infield {formatValue(ifTotal)} · Outfield {formatValue(ofTotal)}
        </div>
      )}
    </div>
  );
}
