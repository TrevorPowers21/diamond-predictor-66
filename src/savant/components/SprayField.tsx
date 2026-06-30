import { useMemo } from "react";

/**
 * Baseball field for batted-ball spray visualization.
 *
 * The field geometry itself is rendered by baseball-field-viz (Python) at
 * build time and saved as a static asset at /public/baseball-field.svg.
 * This component:
 *   1. Loads that SVG as the card background (proper field geometry —
 *      foul lines, outfield arc, infield dirt, bases, mound)
 *   2. Overlays data points on top using the coordinate metadata from
 *      /public/baseball-field-meta.json (home plate fraction + ft per
 *      fractional unit)
 *
 * To regenerate the field SVG (e.g. tweak foul/outfield distances):
 *   python3 scripts/python/generate_field_svg.py
 *
 * Two modes:
 *   - "zones": field divided into sectors, colored by hit density
 *   - "dots":  each batted ball plotted at (spray_ang, distance),
 *              colored by exit velocity
 */

// ── Field coordinate metadata ────────────────────────────────────────
// Sourced from /public/baseball-field-meta.json. Inlined here so we
// don't need a runtime fetch — the SVG is a build-time asset and the
// numbers only change when we regenerate it.
const FIELD_META = {
  homeFracX: 0.5,
  homeFracY: 0.9587155963302753,
  ftPerFractionX: 502.6904755831213,
  ftPerFractionY: 436,
  foulDistanceFt: 330,
  outfieldDistanceFt: 400,
};

const FOUL_RAD = Math.PI / 4;

interface SprayPitch {
  uniq_pitch_id: string;
  spray_ang: number | null;
  distance: number | null;
  exit_velocity: number | null;
  is_batted_ball_in_play: boolean | null;
  pitch_result_category: string | null;
}

interface SprayFieldProps {
  pitches: readonly SprayPitch[];
  title: string;
  mode: "zones" | "dots";
  width?: number;
  height?: number;
}

// ── Zone bands ────────────────────────────────────────────────────────
const ZONE_BANDS_FT = [0, 95, 220, 330, FIELD_META.outfieldDistanceFt];
const ZONE_BAND_NAMES = ["IF", "SHALLOW", "MID", "DEEP"];
const ZONE_SECTORS_RAD = [-FOUL_RAD, -FOUL_RAD / 2, 0, FOUL_RAD / 2, FOUL_RAD];
const ZONE_SECTOR_NAMES = ["L", "LC", "RC", "R"];

function densityColor(density: number, max: number): string {
  if (max <= 0) return "rgba(255,255,255,0.0)";
  const t = Math.min(1, density / max);
  if (t < 0.05) return "rgba(255,255,255,0.0)";
  if (t < 0.35) return `rgba(250,204,21,${0.25 + t * 0.45})`;
  if (t < 0.7) return `rgba(249,115,22,${0.4 + t * 0.35})`;
  return `rgba(220,38,38,${0.55 + t * 0.3})`;
}

function evColor(ev: number | null): string {
  if (ev == null) return "#94a3b8";
  if (ev < 75) return "#0EA5E9";
  if (ev < 85) return "#2563EB";
  if (ev < 90) return "#10B981";
  if (ev < 95) return "#FACC15";
  if (ev < 100) return "#F97316";
  if (ev < 105) return "#EF4444";
  return "#991B1B";
}

/**
 * Project a batted ball from (spray_ang in degrees, distance in feet)
 * to a pixel coordinate within the field-area box. Uses the metadata
 * from the Python field generator so the projection matches the SVG.
 */
function projectBallToPx(
  sprayAngDeg: number,
  distanceFt: number,
  areaWidth: number,
  areaHeight: number,
): { x: number; y: number } {
  const rad = sprayAngDeg * (Math.PI / 180);
  const xFt = distanceFt * Math.sin(rad);
  const yFt = distanceFt * Math.cos(rad);
  const xFrac = FIELD_META.homeFracX + xFt / FIELD_META.ftPerFractionX;
  const yFrac = FIELD_META.homeFracY - yFt / FIELD_META.ftPerFractionY;
  return { x: xFrac * areaWidth, y: yFrac * areaHeight };
}

export function SprayField({
  pitches,
  title,
  mode,
  width = 360,
  height = 462,
}: SprayFieldProps) {
  const TITLE_BAR_H = 36;
  const FOOTER_H = 28;
  const fieldAreaH = height - TITLE_BAR_H - FOOTER_H;
  const fieldAreaW = width;

  // Filter to batted balls in play with valid spray + distance
  const balls = useMemo(
    () =>
      pitches.filter(
        (p) =>
          p.is_batted_ball_in_play === true &&
          p.spray_ang != null &&
          p.distance != null &&
          Math.abs((p.spray_ang as number) * (Math.PI / 180)) <= FOUL_RAD,
      ),
    [pitches],
  );

  // Zone aggregation — pre-compute polygon outlines in PX using the same
  // projection as the data points, so cells line up with field geometry.
  const zoneCells = useMemo(() => {
    if (mode !== "zones") return null;
    type Cell = {
      bandIdx: number;
      sectorIdx: number;
      count: number;
      points: { x: number; y: number }[];
    };
    const cells: Cell[] = [];
    for (let bi = 0; bi < ZONE_BANDS_FT.length - 1; bi++) {
      for (let si = 0; si < ZONE_SECTORS_RAD.length - 1; si++) {
        const rIn = ZONE_BANDS_FT[bi];
        const rOut = ZONE_BANDS_FT[bi + 1];
        const aL = ZONE_SECTORS_RAD[si];
        const aR = ZONE_SECTORS_RAD[si + 1];

        const count = balls.filter((b) => {
          const r = b.distance as number;
          const a = (b.spray_ang as number) * (Math.PI / 180);
          return r >= rIn && r < rOut && a >= aL && a < aR;
        }).length;

        const p1 = projectBallToPx(((aL * 180) / Math.PI), rIn, fieldAreaW, fieldAreaH);
        const p2 = projectBallToPx(((aL * 180) / Math.PI), rOut, fieldAreaW, fieldAreaH);
        const p3 = projectBallToPx(((aR * 180) / Math.PI), rOut, fieldAreaW, fieldAreaH);
        const p4 = projectBallToPx(((aR * 180) / Math.PI), rIn, fieldAreaW, fieldAreaH);
        cells.push({ bandIdx: bi, sectorIdx: si, count, points: [p1, p2, p3, p4] });
      }
    }
    return cells;
  }, [mode, balls, fieldAreaW, fieldAreaH]);

  const maxZoneCount = useMemo(
    () => (zoneCells ? zoneCells.reduce((m, c) => Math.max(m, c.count), 0) : 0),
    [zoneCells],
  );

  return (
    <div className="flex flex-col border bg-white" style={{ borderColor: "#E5E5E5" }}>
      {/* Title bar */}
      <div className="border-b px-3 py-2" style={{ borderColor: "#E5E5E5" }}>
        <h4 className="font-[Oswald] text-[14px] font-semibold uppercase tracking-wider text-slate-900">
          {title}
        </h4>
      </div>

      {/* Field area: SVG background + overlay */}
      <div
        className="relative"
        style={{ width: fieldAreaW, height: fieldAreaH, overflow: "hidden" }}
      >
        {/* Field SVG background (rendered by baseball-field-viz) */}
        <img
          src="/baseball-field.svg"
          alt="Baseball field"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "fill",
            pointerEvents: "none",
          }}
        />

        {/* Data overlay */}
        <svg
          width={fieldAreaW}
          height={fieldAreaH}
          viewBox={`0 0 ${fieldAreaW} ${fieldAreaH}`}
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          {/* Zone overlay */}
          {mode === "zones" && zoneCells && (
            <g>
              {zoneCells.map((cell) => {
                const d = `M ${cell.points[0].x},${cell.points[0].y} ` +
                  `L ${cell.points[1].x},${cell.points[1].y} ` +
                  `L ${cell.points[2].x},${cell.points[2].y} ` +
                  `L ${cell.points[3].x},${cell.points[3].y} Z`;
                return (
                  <path
                    key={`zone-${cell.bandIdx}-${cell.sectorIdx}`}
                    d={d}
                    fill={densityColor(cell.count, maxZoneCount)}
                    stroke="none"
                  >
                    <title>
                      {`${ZONE_BAND_NAMES[cell.bandIdx]} · ${ZONE_SECTOR_NAMES[cell.sectorIdx]} — ${cell.count} BB`}
                    </title>
                  </path>
                );
              })}
            </g>
          )}

          {/* Dots overlay */}
          {mode === "dots" &&
            balls.map((b) => {
              const p = projectBallToPx(
                b.spray_ang as number,
                b.distance as number,
                fieldAreaW,
                fieldAreaH,
              );
              return (
                <circle
                  key={b.uniq_pitch_id}
                  cx={p.x}
                  cy={p.y}
                  r={3.5}
                  fill={evColor(b.exit_velocity)}
                  fillOpacity={0.85}
                  stroke="#475569"
                  strokeWidth={0.5}
                >
                  <title>
                    {`${b.pitch_result_category ?? "—"} · ${b.exit_velocity?.toFixed(1) ?? "—"} mph · ${(b.distance as number).toFixed(0)} ft`}
                  </title>
                </circle>
              );
            })}
        </svg>
      </div>

      {/* Footer */}
      <div className="border-t px-3 py-1.5" style={{ borderColor: "#E5E5E5", height: FOOTER_H }}>
        <div className="font-[JetBrains_Mono] text-[10px] uppercase tracking-wider text-slate-500">
          {balls.length} batted balls in play
        </div>
      </div>
    </div>
  );
}
