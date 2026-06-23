import { useEffect, useMemo, useRef, useState } from "react";
import PercentileBar from "@/savant/components/PercentileBar";
import {
  usePitchLogHitterTotals,
  usePitchLogPitcherTotals,
} from "@/savant/hooks/usePitchLogTotals";
import { usePitchLogByPitchType } from "@/savant/hooks/usePitchLogByPitchType";
import { usePitchLogHitterByPitchType } from "@/savant/hooks/usePitchLogHitterByPitchType";
import { usePitcherMaster } from "@/savant/hooks/usePitcherMaster";
import {
  usePitchLogHitterPopulation,
  usePitchLogPitcherPopulation,
} from "@/savant/hooks/usePitchLogPopulation";
import { percentileRank } from "@/savant/lib/percentile";
import {
  type DimensionOption,
  type HitterPitchTypeBreakdown,
  type MetricDef,
  type PitchLogDimensionKey,
  type PitchTypeBreakdown,
  deriveHitterPitchTypeBreakdowns,
  derivePitchTypeBreakdowns,
  HITTER_DIMENSIONS,
  HITTER_METRICS_CONTACT,
  HITTER_METRICS_CONTACT_BARS,
  HITTER_METRICS_DISCIPLINE,
  HITTER_METRICS_DISCIPLINE_BARS,
  HITTER_METRICS_SLASH,
  HITTER_QUALIFIED_PA,
  PITCHER_DIMENSIONS,
  PITCHER_METRICS_BATTED_BALL,
  PITCHER_METRICS_DISCIPLINE,
  PITCHER_METRICS_SLASH_AGAINST,
  PITCHER_QUALIFIED_PITCHES,
  safeDiv,
} from "@/savant/lib/pitchLogRates";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";
/** Shared accent color for the header→rows divider in left-column data tables. */
const TABLE_HEADER_BORDER = "rgba(212,175,55,0.30)";

const fmt1 = (v: number | null) => (v === null ? "—" : v.toFixed(1));
const fmtInt = (v: number | null) => (v === null ? "—" : `${Math.round(v)}`);
const fmtPct = (v: number | null) =>
  v === null ? "—" : `${(v * 100).toFixed(1)}%`;
const fmtSlash = (v: number | null) =>
  v === null ? "—" : v.toFixed(3).replace(/^0+/, "");

// ────────────────────────────────────────────────────────────────────
// Dimension picker (shared by hitter + pitcher)
// ────────────────────────────────────────────────────────────────────
interface DimensionPickerProps {
  options: readonly DimensionOption[];
  value: PitchLogDimensionKey;
  onChange: (next: PitchLogDimensionKey) => void;
}

function DimensionPicker({ options, value, onChange }: DimensionPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);
  const active = options.find((o) => o.key === value) ?? options[0];
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 border px-3 py-1.5 font-[Oswald] text-sm font-bold uppercase tracking-wider transition-colors duration-150 hover:bg-[#D4AF37]/[0.08]"
        style={{ backgroundColor: "transparent", borderColor: NAVY_BORDER, color: "#FFFFFF" }}
      >
        <span style={{ color: GOLD }}>●</span>
        {active.label}
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          style={{ color: GOLD }}
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden border shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]"
          style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
        >
          {options.map((o) => {
            const isActive = o.key === value;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => { onChange(o.key); setOpen(false); }}
                className="block w-full cursor-pointer px-4 py-2 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
                style={{
                  color: isActive ? GOLD : "#FFFFFF",
                  backgroundColor: isActive ? "rgba(212,175,55,0.06)" : "transparent",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Top stats line (full width above both columns)
// ────────────────────────────────────────────────────────────────────
interface StatChipProps {
  label: string;
  value: string;
  emphasize?: boolean;
}
function StatChip({ label, value, emphasize }: StatChipProps) {
  return (
    <div
      className="flex min-w-[108px] flex-col items-center gap-2 border px-4 py-3.5 transition-colors duration-150"
      style={{
        borderColor: emphasize ? "rgba(212,175,55,0.35)" : NAVY_BORDER,
        backgroundColor: NAVY_CARD,
      }}
    >
      <div className="font-[Oswald] text-[11px] font-bold uppercase tracking-[0.22em] text-white/55">
        {label}
      </div>
      <div
        className="font-[Oswald] text-[28px] font-bold leading-none tabular-nums"
        style={{ color: emphasize ? GOLD : "#FFFFFF" }}
      >
        {value}
      </div>
    </div>
  );
}

function HitterStatsLine({ row }: { row: import("@/savant/hooks/usePitchLogTotals").PitchLogHitterTotalsRow }) {
  const hits = row.hits_single + row.hits_double + row.hits_triple + row.hits_hr;
  const tb = row.hits_single + 2 * row.hits_double + 3 * row.hits_triple + 4 * row.hits_hr;
  const avg = safeDiv(hits, row.ab);
  const obp = safeDiv(hits + row.bb + row.hbp, row.ab + row.bb + row.hbp + row.sac);
  const slg = safeDiv(tb, row.ab);
  const ops = avg !== null && slg !== null && obp !== null ? obp + slg : null;
  const iso = avg !== null && slg !== null ? slg - avg : null;
  const kPct = safeDiv(row.k, row.pa);
  const bbPct = safeDiv(row.bb, row.pa);
  return (
    <div className="flex flex-wrap gap-2">
      <StatChip label="AVG" value={fmtSlash(avg)} emphasize />
      <StatChip label="OBP" value={fmtSlash(obp)} emphasize />
      <StatChip label="SLG" value={fmtSlash(slg)} emphasize />
      <StatChip label="OPS" value={fmtSlash(ops)} emphasize />
      <StatChip label="ISO" value={fmtSlash(iso)} />
      <StatChip label="HR" value={`${row.hits_hr}`} />
      <StatChip label="BB" value={`${row.bb}`} />
      <StatChip label="K" value={`${row.k}`} />
      <StatChip label="BB%" value={fmtPct(bbPct)} />
      <StatChip label="K%" value={fmtPct(kPct)} />
    </div>
  );
}

function PitcherStatsLine({
  row,
  pm,
}: {
  row: import("@/savant/hooks/usePitchLogTotals").PitchLogPitcherTotalsRow;
  pm: import("@/savant/hooks/usePitcherMaster").PitcherMasterRow | null | undefined;
}) {
  const kPct = safeDiv(row.total_k, row.total_pa);
  const bbPct = safeDiv(row.total_bb, row.total_pa);
  const stuff = safeDiv(row.stuff_plus_sum, row.stuff_plus_data_pitches);

  const hitsAllowed =
    row.hits_single_allowed +
    row.hits_double_allowed +
    row.hits_triple_allowed +
    row.hits_hr_allowed;
  const ipEst = row.total_bf / 4.3;
  const whip = ipEst > 0 ? (hitsAllowed + row.total_bb) / ipEst : null;

  return (
    <div className="flex flex-wrap gap-2">
      {/* Season aggregates (static — from Pitching Master, NOT filter-aware) */}
      <StatChip label="IP" value={pm?.IP != null ? pm.IP.toFixed(1) : "—"} emphasize />
      <StatChip label="ERA" value={pm?.ERA != null ? pm.ERA.toFixed(2) : "—"} emphasize />
      <StatChip label="FIP" value={pm?.FIP != null ? pm.FIP.toFixed(2) : "—"} emphasize />
      {/* Filter-aware (recomputes from pitch_log per active dimension) */}
      <StatChip label="WHIP" value={whip != null ? whip.toFixed(2) : "—"} />
      <StatChip label="K" value={`${row.total_k}`} />
      <StatChip label="BB" value={`${row.total_bb}`} />
      <StatChip label="K%" value={fmtPct(kPct)} />
      <StatChip label="BB%" value={fmtPct(bbPct)} />
      <StatChip label="Stuff+" value={fmt1(stuff)} emphasize />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Per-pitch tables (left column)
// ────────────────────────────────────────────────────────────────────
function GroupHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-4 font-[Oswald] text-[12px] font-bold uppercase tracking-[0.22em] text-[#D4AF37] first:mt-0">
      {children}
    </div>
  );
}

function PitcherPitchTypeTable({ breakdowns }: { breakdowns: PitchTypeBreakdown[] }) {
  if (breakdowns.length === 0) {
    return <div className="py-4 text-sm text-white/40">No per-pitch data for this filter.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/55" style={{ borderColor: TABLE_HEADER_BORDER }}>
            <th className="py-2 pr-3">Pitch</th>
            <th className="py-2 pr-3 text-right">#</th>
            <th className="py-2 pr-3 text-right">Usage</th>
            <th className="py-2 pr-3 text-right">Velo</th>
            <th className="py-2 pr-3 text-right">IVB</th>
            <th className="py-2 pr-3 text-right">HB</th>
            <th className="py-2 pr-3 text-right">Spin</th>
            <th className="py-2 pr-3 text-right">Stuff+</th>
            <th className="py-2 pr-3 text-right">Whiff%</th>
            <th className="py-2 pr-3 text-right">Chase%</th>
            <th className="py-2 pr-3 text-right">CSW%</th>
            <th className="py-2 pr-3 text-right">Hard Hit%</th>
            <th className="py-2 pr-3 text-right">EV</th>
          </tr>
        </thead>
        <tbody>
          {breakdowns.map((b) => (
            <tr key={b.pitchType} className="border-b font-[Oswald] text-sm text-white transition-colors duration-150 hover:bg-white/[0.03]" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <td className="py-2 pr-3 font-bold">{b.pitchType}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{b.pitches.toLocaleString()}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(b.usagePct)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmt1(b.velo)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmt1(b.ivb)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmt1(b.hb)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(b.spin)}</td>
              <td
                className="py-2 pr-3 text-right tabular-nums font-bold"
                style={{ color: b.stuffPlus !== null && b.stuffPlus >= 105 ? GOLD : undefined }}
              >
                {fmt1(b.stuffPlus)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(b.whiffPct)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(b.chasePct)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(b.cswPct)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmtPct(b.hardHitPct)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{fmt1(b.avgEv)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HitterPitchTypeTable({ breakdowns }: { breakdowns: HitterPitchTypeBreakdown[] }) {
  if (breakdowns.length === 0) {
    return <div className="py-4 text-sm text-white/40">No per-pitch data for this filter.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/55" style={{ borderColor: TABLE_HEADER_BORDER }}>
            <th className="py-2 pr-3">Pitch</th>
            <th className="py-2 pr-3 text-center">P</th>
            <th className="py-2 pr-3 text-center">AVG</th>
            <th className="py-2 pr-3 text-center">OBP</th>
            <th className="py-2 pr-3 text-center">SLG</th>
            <th className="py-2 pr-3 text-center">OPS</th>
            <th className="py-2 pr-3 text-center">ISO</th>
            <th className="py-2 pr-3 text-center">Whiff%</th>
            <th className="py-2 pr-3 text-center">Chase%</th>
            <th className="py-2 pr-3 text-center">Hard Hit%</th>
            <th className="py-2 pr-3 text-center">EV</th>
          </tr>
        </thead>
        <tbody>
          {breakdowns.map((b) => (
            <tr key={b.pitchType} className="border-b font-[Oswald] text-sm text-white transition-colors duration-150 hover:bg-white/[0.03]" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
              <td className="py-2 pr-3 font-bold">{b.pitchType}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{b.pitches.toLocaleString()}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.avg)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.obp)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.slg)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.ops)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtSlash(b.iso)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.whiffPct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.chasePct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmtPct(b.hardHitPct)}</td>
              <td className="py-2 pr-3 text-center tabular-nums">{fmt1(b.avgEv)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Rates table (player value vs NCAA median, Savant Statcast-style)
// ────────────────────────────────────────────────────────────────────
interface HistoricalRowSpec {
  /** Row label (e.g. "2025", "2024"). */
  label: string;
  /** Per-metric value lookup; return null if this source doesn't have that metric. */
  getValue: (metricLabel: string) => number | null;
}

interface RateTableProps<TRow> {
  metrics: readonly MetricDef<TRow>[];
  playerRow: TRow;
  qualifiedPop: TRow[];
  /** Extra rows shown below NCAA Avg — typically prior-season rows from Hitter/Pitching Master. */
  historicalRows?: HistoricalRowSpec[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function RateTable<TRow>({ metrics, playerRow, qualifiedPop, historicalRows }: RateTableProps<TRow>) {
  // Pre-compute player + NCAA-median values for each metric column.
  const cols = metrics.map((m) => {
    const value = m.derive(playerRow);
    const popValues = qualifiedPop
      .map((r) => m.derive(r))
      .filter((v): v is number => v != null && !Number.isNaN(v));
    const ncaa = median(popValues);
    return { label: m.label, value, ncaa, format: m.format };
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr
            className="border-b text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/55"
            style={{ borderColor: TABLE_HEADER_BORDER }}
          >
            <th className="py-2 pr-3 sticky left-0 z-10" style={{ backgroundColor: NAVY_CARD }}>
              &nbsp;
            </th>
            {cols.map((c) => (
              <th key={c.label} className="py-2 px-3 text-center whitespace-nowrap">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Historical seasons first, ascending (oldest → newest) so
              2025 sits directly above the 2026 row. */}
          {historicalRows?.map((hr) => (
            <tr key={hr.label} className="font-[Oswald] text-sm">
              <td
                className="py-2 pr-3 font-bold uppercase tracking-wider text-[11px] text-white/45 sticky left-0 z-10 whitespace-nowrap"
                style={{ backgroundColor: NAVY_CARD }}
              >
                {hr.label}
              </td>
              {cols.map((c) => {
                const v = hr.getValue(c.label);
                return (
                  <td key={c.label} className="py-2 px-3 text-center tabular-nums text-white/45">
                    {v === null ? "—" : c.format(v)}
                  </td>
                );
              })}
            </tr>
          ))}
          {/* Current season (2026) — highlighted in gold. */}
          <tr className="border-b font-[Oswald] text-sm text-white" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
            <td
              className="py-2 pr-3 font-bold uppercase tracking-wider text-[11px] text-[#D4AF37] sticky left-0 z-10 whitespace-nowrap"
              style={{ backgroundColor: NAVY_CARD }}
            >
              2026
            </td>
            {cols.map((c) => (
              <td key={c.label} className="py-2 px-3 text-center tabular-nums font-bold">
                {c.value === null ? "—" : c.format(c.value)}
              </td>
            ))}
          </tr>
          {/* NCAA Avg directly under the current-season row. */}
          <tr className="font-[Oswald] text-sm">
            <td
              className="py-2 pr-3 font-bold uppercase tracking-wider text-[11px] text-white/55 sticky left-0 z-10 whitespace-nowrap"
              style={{ backgroundColor: NAVY_CARD }}
            >
              NCAA Avg
            </td>
            {cols.map((c) => (
              <td key={c.label} className="py-2 px-3 text-center tabular-nums text-white/60">
                {c.ncaa === null ? "—" : c.format(c.ncaa)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Percentile bar group (right column)
// ────────────────────────────────────────────────────────────────────
interface BarGroupProps<TRow> {
  metrics: readonly MetricDef<TRow>[];
  playerRow: TRow;
  qualifiedPop: TRow[];
}
function BarGroup<TRow>({ metrics, playerRow, qualifiedPop }: BarGroupProps<TRow>) {
  return (
    <div className="divide-y divide-white/5">
      {metrics.map((m) => {
        const value = m.derive(playerRow);
        const popValues = qualifiedPop.map((r) => m.derive(r));
        const pct = percentileRank(value, popValues, { invert: m.invert });
        return (
          <PercentileBar
            key={m.label}
            label={m.label}
            value={value}
            percentile={pct}
            format={m.format}
          />
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Page-level shells (filter top, two-column body)
// ────────────────────────────────────────────────────────────────────
interface PageShellProps {
  picker: React.ReactNode;
  sampleCount: number;
  sampleLabel: string;
  topStats: React.ReactNode;
  left: React.ReactNode;
  right: React.ReactNode;
  /** Optional full-width section rendered below the two-column body (e.g. per-pitch table). */
  bottom?: React.ReactNode;
}
function PageShell({
  picker,
  sampleCount,
  sampleLabel,
  topStats,
  left,
  right,
  bottom,
}: PageShellProps) {
  return (
    <div className="space-y-5">
      {/* Filter + counts row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: NAVY_BORDER }}>
        <div className="flex items-center gap-3">
          {picker}
          <div className="text-[11px] uppercase tracking-wider text-white/55">
            {sampleCount.toLocaleString()} {sampleLabel}
            <span className="ml-2 text-white/40">· *includes postseason</span>
          </div>
        </div>
      </div>

      {/* Top stats line */}
      <div>{topStats}</div>

      {/* Two-column body — children render their OWN cards so multiple stacked
          panels stay visually separated. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">{left}</div>
        <div className="space-y-6">{right}</div>
      </div>

      {bottom && <div className="space-y-6">{bottom}</div>}
    </div>
  );
}

// Reusable bordered panel used for each labeled section.
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="border px-5 py-5"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="mb-4 flex items-center gap-2">
        <span className="h-3 w-0.5" style={{ backgroundColor: GOLD }} />
        <h3 className="font-[Oswald] text-[14px] font-bold uppercase tracking-[0.18em] text-white">
          {title}
        </h3>
      </div>
      {children}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Pitcher entry
// ────────────────────────────────────────────────────────────────────
interface PitcherPitchLogProps {
  pitcherId: string;
  season: number;
}

export function PitcherPitchLog({ pitcherId, season }: PitcherPitchLogProps) {
  const [dimension, setDimension] = useState<PitchLogDimensionKey>("all");
  const { data: totalsRow } = usePitchLogPitcherTotals(pitcherId, season, dimension);
  const { data: byTypeRows = [] } = usePitchLogByPitchType(pitcherId, season, dimension);
  const { data: population = [] } = usePitchLogPitcherPopulation(season, dimension);
  const { data: pmRow } = usePitcherMaster(pitcherId, season);

  const qualifiedPop = useMemo(
    () => population.filter((r) => r.total_pitches >= PITCHER_QUALIFIED_PITCHES),
    [population],
  );
  const breakdowns = derivePitchTypeBreakdowns(byTypeRows);

  const picker = (
    <DimensionPicker options={PITCHER_DIMENSIONS} value={dimension} onChange={setDimension} />
  );

  if (!totalsRow) {
    return (
      <PageShell
        picker={picker}
        sampleCount={0}
        sampleLabel="pitches"
        topStats={null}
        left={<div className="py-6 text-sm text-white/40">No pitch-log data for this filter.</div>}
        right={null}
      />
    );
  }

  const reliability =
    totalsRow.total_pitches > 0 ? totalsRow.total_data_pitches / totalsRow.total_pitches : null;

  return (
    <PageShell
      picker={picker}
      sampleCount={totalsRow.total_pitches}
      sampleLabel="pitches"
      topStats={<PitcherStatsLine row={totalsRow} pm={pmRow ?? null} />}
      left={
        <>
          <Panel title="Quality of Stuff">
            <RateTable
              metrics={PITCHER_METRICS_DISCIPLINE}
              playerRow={totalsRow}
              qualifiedPop={qualifiedPop}
            />
          </Panel>
          <Panel title="Batted Ball Metrics">
            <RateTable
              metrics={[...PITCHER_METRICS_SLASH_AGAINST, ...PITCHER_METRICS_BATTED_BALL]}
              playerRow={totalsRow}
              qualifiedPop={qualifiedPop}
            />
          </Panel>
          <Panel title="Per-Pitch Breakdown">
            <PitcherPitchTypeTable breakdowns={breakdowns} />
          </Panel>
        </>
      }
      right={
        <>
          <Panel title="Quality of Stuff">
            <BarGroup
              metrics={PITCHER_METRICS_DISCIPLINE}
              playerRow={totalsRow}
              qualifiedPop={qualifiedPop}
            />
          </Panel>
          <Panel title="Batted Ball Metrics">
            <BarGroup
              metrics={[...PITCHER_METRICS_SLASH_AGAINST, ...PITCHER_METRICS_BATTED_BALL]}
              playerRow={totalsRow}
              qualifiedPop={qualifiedPop}
            />
          </Panel>
        </>
      }
    />
  );
}

// ────────────────────────────────────────────────────────────────────
// Hitter entry
// ────────────────────────────────────────────────────────────────────
interface HitterPitchLogProps {
  batterId: string;
  season: number;
}

export function HitterPitchLog({ batterId, season }: HitterPitchLogProps) {
  const [dimension, setDimension] = useState<PitchLogDimensionKey>("all");
  const { data: row } = usePitchLogHitterTotals(batterId, season, dimension);
  const { data: byTypeRows = [] } = usePitchLogHitterByPitchType(batterId, season, dimension);
  const { data: population = [] } = usePitchLogHitterPopulation(season, dimension);

  const qualifiedPop = useMemo(
    () => population.filter((r) => r.pa >= HITTER_QUALIFIED_PA),
    [population],
  );
  const breakdowns = deriveHitterPitchTypeBreakdowns(byTypeRows);

  const picker = (
    <DimensionPicker options={HITTER_DIMENSIONS} value={dimension} onChange={setDimension} />
  );

  if (!row) {
    return (
      <PageShell
        picker={picker}
        sampleCount={0}
        sampleLabel="PA"
        topStats={null}
        left={<div className="py-6 text-sm text-white/40">No pitch-log data for this filter.</div>}
        right={null}
      />
    );
  }

  const reliability =
    row.total_pitches > 0 ? row.total_data_pitches / row.total_pitches : null;

  return (
    <PageShell
      picker={picker}
      sampleCount={row.pa}
      sampleLabel="PA"
      topStats={<HitterStatsLine row={row} />}
      left={
        <>
          <Panel title="Batted Ball Data">
            <RateTable
              metrics={[...HITTER_METRICS_SLASH, ...HITTER_METRICS_CONTACT]}
              playerRow={row}
              qualifiedPop={qualifiedPop}
            />
          </Panel>
          <Panel title="Plate Discipline">
            <RateTable
              metrics={HITTER_METRICS_DISCIPLINE}
              playerRow={row}
              qualifiedPop={qualifiedPop}
            />
          </Panel>
          <Panel title="vs Pitch Type">
            <HitterPitchTypeTable breakdowns={breakdowns} />
          </Panel>
        </>
      }
      right={
        <>
          <Panel title="Batted Ball Data">
            <BarGroup
              metrics={[...HITTER_METRICS_SLASH, ...HITTER_METRICS_CONTACT_BARS]}
              playerRow={row}
              qualifiedPop={qualifiedPop}
            />
          </Panel>
          <Panel title="Plate Discipline">
            <BarGroup metrics={HITTER_METRICS_DISCIPLINE_BARS} playerRow={row} qualifiedPop={qualifiedPop} />
          </Panel>
        </>
      }
    />
  );
}
