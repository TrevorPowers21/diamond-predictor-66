import { useMemo, useState } from "react";
import BaseballField, { arcDistance } from "@/savant/components/BaseballField";
import { percentileColor } from "@/savant/lib/percentile";
import type { PitchLocationRow } from "@/savant/hooks/usePitchLogPitchLocation";

// Navy beyond the field, WHITE playing surface so the red↔blue zone colors and
// the dots read clearly. Labels go dark with a white halo for legibility.
const FIELD_THEME = {
  bg: "#0A1428", // beyond the field (navy)
  grass: "#FFFFFF", // fair territory (white)
  dirt: "#ECE4D6", // infield dirt (light tan)
  foulLine: "#9aa3b2",
  wall: "#D4AF37", // gold fence
  bone: "#b8a98c", // bases + grass-line arc
  ink: "#0A1428", // labels (dark on white)
  divider: "#cbd5e1",
  labelStroke: "#FFFFFF",
};

// Matches BaseballField COL_BOUNDS (LF/LC/CF/RC/RF). Locked at ±15/±30.
const COL_BOUNDS = [-45, -30, -15, 15, 30, 45];
const NEUTRAL_FILL = "rgba(255,255,255,0.05)";

// Result groups for the dots spray chart. Hits keep their result (1B/2B/3B/HR);
// every other batted ball is split by trajectory (launch angle) into
// Ground / Liner / Fly — same buckets as the Contact filter.
const RESULT_GROUPS: Array<{ key: string; label: string; color: string }> = [
  { key: "1B", label: "1B", color: "#22C55E" },
  { key: "2B", label: "2B", color: "#3B82F6" },
  { key: "3B", label: "3B", color: "#A855F7" },
  { key: "HR", label: "HR", color: "#FBBF24" },
  { key: "GB", label: "GB", color: "#8B6F47" },
  { key: "LD", label: "LD", color: "#64748B" },
  { key: "FB", label: "FB", color: "#AEBBD0" },
  { key: "PU", label: "PU", color: "#88AFA8" },
];
const HIT_GROUP: Record<string, string> = { Single: "1B", Double: "2B", Triple: "3B", HR: "HR" };
function groupFor(cat: string | null, launchAngle: number | null): { key: string; color: string } {
  // Trajectory thresholds match the platform's GB%/LD%/FB%/PU% aggregation
  // (aggregate_pitch_log_dimensions.ts): GB < 5°, LD 5–20°, FB 20–50°, PU ≥ 50°.
  let key = cat ? HIT_GROUP[cat] : undefined;
  if (!key) {
    if (launchAngle != null && launchAngle < 5) key = "GB";
    else if (launchAngle != null && launchAngle < 20) key = "LD";
    else if (launchAngle != null && launchAngle < 50) key = "FB";
    else if (launchAngle != null) key = "PU";
    else key = "GB"; // no launch angle — bucket with grounders
  }
  const g = RESULT_GROUPS.find((r) => r.key === key) ?? RESULT_GROUPS[4];
  return { key: g.key, color: g.color };
}

export type SprayMetric = "freq" | "ev" | "dots";

function bucketField(
  rows: PitchLocationRow[],
  getVal: ((r: PitchLocationRow) => number | null) | null,
) {
  const sum = [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ];
  const cnt = [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ];
  for (const r of rows) {
    const a = r.spray_ang;
    if (a == null || a < -45 || a > 45) continue;
    let col = 0;
    while (col < 4 && a > COL_BOUNDS[col + 1]) col++;
    const band = r.distance != null && r.distance <= arcDistance(a) ? 0 : 1;
    cnt[band][col] += 1;
    if (getVal) {
      const v = getVal(r);
      if (v != null) sum[band][col] += v;
    }
  }
  return { sum, cnt };
}

// Rich per-zone hover stats for the heatmap fields: share of contact, avg EV,
// trajectory split (GB/LD/FB by launch angle), and xwOBA/xBA. Keyed
// `${band}-${col}` to match BaseballField's zone tooltip lookup.
function zoneTooltipLines(rows: PitchLocationRow[]): Record<string, string[]> {
  const total = rows.length || 1;
  type Acc = {
    n: number; evSum: number; evN: number;
    gb: number; ld: number; fb: number; laN: number;
    xwSum: number; xwN: number; xbSum: number; xbN: number;
  };
  const acc: Record<string, Acc> = {};
  for (const r of rows) {
    const a = r.spray_ang;
    if (a == null || a < -45 || a > 45) continue;
    let col = 0;
    while (col < 4 && a > COL_BOUNDS[col + 1]) col++;
    const band = r.distance != null && r.distance <= arcDistance(a) ? "infield" : "outfield";
    const k = `${band}-${col}`;
    const z = (acc[k] ??= { n: 0, evSum: 0, evN: 0, gb: 0, ld: 0, fb: 0, laN: 0, xwSum: 0, xwN: 0, xbSum: 0, xbN: 0 });
    z.n += 1;
    if (r.exit_velocity != null) { z.evSum += r.exit_velocity; z.evN += 1; }
    if (r.launch_angle != null) {
      z.laN += 1;
      if (r.launch_angle < 5) z.gb += 1;
      else if (r.launch_angle < 20) z.ld += 1;
      else z.fb += 1;
    }
    if (r.x_woba != null) { z.xwSum += r.x_woba; z.xwN += 1; }
    if (r.x_avg != null) { z.xbSum += r.x_avg; z.xbN += 1; }
  }
  const slash = (v: number) => v.toFixed(3).replace(/^0/, "");
  const out: Record<string, string[]> = {};
  for (const [k, z] of Object.entries(acc)) {
    const lines: string[] = [`${Math.round((z.n / total) * 100)}% of balls (${z.n})`];
    if (z.evN) lines.push(`Avg EV ${Math.round(z.evSum / z.evN)}`);
    if (z.laN)
      lines.push(
        `GB ${Math.round((z.gb / z.laN) * 100)}%  LD ${Math.round((z.ld / z.laN) * 100)}%  FB ${Math.round((z.fb / z.laN) * 100)}%`,
      );
    const xw = z.xwN ? `xwOBA ${slash(z.xwSum / z.xwN)}` : null;
    const xb = z.xbN ? `xBA ${slash(z.xbSum / z.xbN)}` : null;
    if (xw || xb) lines.push([xw, xb].filter(Boolean).join("  "));
    out[k] = lines;
  }
  return out;
}

function fillsFor(vals: number[], cnts: number[], mean: number, spread: number): string[] {
  return vals.map((v, i) => {
    if (cnts[i] === 0) return NEUTRAL_FILL;
    const pct = Math.max(0, Math.min(100, 50 + (50 * (v - mean)) / spread));
    return percentileColor(pct);
  });
}
function meanSpread(vals: number[], cnts: number[]) {
  const present = vals.filter((_, i) => cnts[i] > 0);
  if (present.length === 0) return null;
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  const spread = Math.max(...present.map((v) => Math.abs(v - mean)), 1e-9);
  return { mean, spread };
}
function bandScaleFills(vInf: number[], vOff: number[], cInf: number[], cOff: number[]) {
  const mi = meanSpread(vInf, cInf);
  const mo = meanSpread(vOff, cOff);
  return {
    infield: mi ? fillsFor(vInf, cInf, mi.mean, mi.spread) : vInf.map(() => NEUTRAL_FILL),
    outfield: mo ? fillsFor(vOff, cOff, mo.mean, mo.spread) : vOff.map(() => NEUTRAL_FILL),
  };
}
function globalScaleFills(vInf: number[], vOff: number[], cInf: number[], cOff: number[]) {
  const m = meanSpread([...vInf, ...vOff], [...cInf, ...cOff]);
  if (!m) return { infield: vInf.map(() => NEUTRAL_FILL), outfield: vOff.map(() => NEUTRAL_FILL) };
  return {
    infield: fillsFor(vInf, cInf, m.mean, m.spread),
    outfield: fillsFor(vOff, cOff, m.mean, m.spread),
  };
}

interface SprayFieldPanelProps {
  pitches: PitchLocationRow[];
  metric?: SprayMetric;
}

export default function SprayFieldPanel({ pitches, metric = "freq" }: SprayFieldPanelProps) {
  const [resultFilter, setResultFilter] = useState<string | null>(null);

  const bip = useMemo(
    () => pitches.filter((p) => p.is_batted_ball_in_play && p.spray_ang != null),
    [pitches],
  );

  // All dots (result-grouped) — for the dots view + legend.
  const dotsAll = useMemo(() => {
    if (metric !== "dots") return [];
    return bip.map((p) => {
      const g = groupFor(p.pitch_result_category, p.launch_angle);
      const lines: string[] = [];
      // Line 0 is the tooltip header (colored by the dot's result color).
      lines.push(
        p.pitch_result_category
          ? p.pitch_result_category.replace(/([a-z])([A-Z])/g, "$1 $2")
          : g.key,
      );
      if (p.exit_velocity != null) lines.push(`EV ${Math.round(p.exit_velocity)}`);
      if (p.launch_angle != null) lines.push(`LA ${Math.round(p.launch_angle)}°`);
      if (p.distance != null) lines.push(`Dist ${Math.round(p.distance)} ft`);
      if (p.x_woba != null) lines.push(`xwOBA ${p.x_woba.toFixed(3).replace(/^0/, "")}`);
      return { sprayAngle: p.spray_ang as number, distance: p.distance, color: g.color, group: g.key, tooltipLines: lines };
    });
  }, [bip, metric]);

  const legend = useMemo(() => {
    if (metric !== "dots") return [];
    return RESULT_GROUPS.map((g) => ({
      ...g,
      count: dotsAll.filter((d) => d.group === g.key).length,
    })).filter((g) => g.count > 0);
  }, [dotsAll, metric]);

  const view = useMemo(() => {
    if (metric === "dots") {
      const dots = resultFilter ? dotsAll.filter((d) => d.group === resultFilter) : dotsAll;
      const neutral = [NEUTRAL_FILL, NEUTRAL_FILL, NEUTRAL_FILL, NEUTRAL_FILL, NEUTRAL_FILL];
      return {
        dots,
        infield: [0, 0, 0, 0, 0],
        outfield: [0, 0, 0, 0, 0],
        fillInfield: neutral,
        fillOutfield: neutral,
        zoneTooltips: undefined as Record<string, string[]> | undefined,
        fmt: () => "",
      };
    }
    const { sum, cnt } = bucketField(bip, metric === "ev" ? (r) => r.exit_velocity : null);
    const total = cnt[0].reduce((a, b) => a + b, 0) + cnt[1].reduce((a, b) => a + b, 0) || 1;
    const value = (band: number) =>
      metric === "ev"
        ? sum[band].map((s, i) => (cnt[band][i] > 0 ? s / cnt[band][i] : 0))
        : cnt[band].map((c) => (c / total) * 100);
    const vInf = value(0);
    const vOff = value(1);
    const fills =
      metric === "ev"
        ? bandScaleFills(vInf, vOff, cnt[0], cnt[1])
        : globalScaleFills(vInf, vOff, cnt[0], cnt[1]);
    return {
      dots: undefined as undefined | typeof dotsAll,
      infield: vInf,
      outfield: vOff,
      fillInfield: fills.infield,
      fillOutfield: fills.outfield,
      zoneTooltips: zoneTooltipLines(bip),
      fmt:
        metric === "ev"
          ? (v: number) => (v ? Math.round(v) : "")
          : (v: number) => (v ? `${Math.round(v)}%` : ""),
    };
  }, [bip, metric, dotsAll, resultFilter]);

  if (bip.length === 0) {
    return <div className="p-6 text-center text-xs text-white/40">No batted-ball data for this filter.</div>;
  }

  const field = (
    <BaseballField
      infield={view.infield}
      outfield={view.outfield}
      fillInfield={view.fillInfield}
      fillOutfield={view.fillOutfield}
      dots={view.dots}
      zoneTooltips={view.zoneTooltips}
      theme={metric === "dots" ? { ...FIELD_THEME, dirt: FIELD_THEME.grass } : FIELD_THEME}
      formatValue={view.fmt}
      showTotals={metric !== "dots"}
      interactiveZones={metric !== "dots"}
    />
  );

  if (metric !== "dots") return field;

  return (
    <div className="relative">
      {field}
      <div className="absolute bottom-[7%] left-[5.5%] flex flex-col gap-1">
        {legend.map((g) => {
          const active = resultFilter === g.key;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setResultFilter(active ? null : g.key)}
              className={`flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors ${
                active ? "bg-white/20 ring-1 ring-white/40" : "bg-black/30 hover:bg-white/15"
              } ${resultFilter && !active ? "opacity-40" : ""}`}
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
              <span className="text-white/90">{g.label}</span>
              <span className="ml-auto text-white/55">{g.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
