/**
 * Per-pitch success table — pitch-type breakdown for the Visuals tab.
 *
 * Reads from the SAME pre-aggregated source as the Stats tab
 * (PitcherPitchTypeTable): `PitchTypeBreakdown[]` derived from
 * `pitch_log_pitcher_by_pitch_type`. Guarantees the numbers in both
 * tables match exactly — no client-side per-pitch loop here.
 *
 * Styled to match the existing dark-navy + Oswald + gold-accent table
 * pattern.
 */
import { useMemo } from "react";
import { derivePitchTypeBreakdowns, type PitchTypeBreakdown } from "@/savant/lib/pitchLogRates";
import type { PitchLogByPitchTypeRow } from "@/savant/hooks/usePitchLogByPitchType";
import { percentileColor, percentileRank } from "@/savant/lib/percentile";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";
const TABLE_HEADER_BORDER = "rgba(212,175,55,0.30)";
const ROW_BORDER = "rgba(255,255,255,0.05)";

interface PerPitchSuccessTableProps {
  breakdowns: PitchTypeBreakdown[];
  /**
   * NCAA-wide (pitcher × pitch_type) population rows for the same season
   * + dimension as the active player. Used to compute percentile rank of
   * RV/100 within the same pitch type (so a 4-Seam is compared against
   * other 4-Seams). When omitted, RV/100 falls back to fixed-threshold
   * gold highlighting.
   */
  population?: PitchLogByPitchTypeRow[];
  /**
   * Minimum sample (per pitch type) for a population row to count toward
   * the percentile. Default 100 pitches — filters out tiny-sample noise.
   */
  populationMinPitches?: number;
  title?: string;
  /**
   * Active page-wide pitch-type filter. When null we hide rows with
   * usage% below `minUsagePct` (noise reduction); when set to a specific
   * pitch type we show only that row regardless of usage.
   */
  filterPitchType?: string | null;
  /** Threshold below which a pitch type is hidden by default. Default 3%. */
  minUsagePct?: number;
}

const fmtPct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const fmtVel = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmtInt = (v: number) => v.toLocaleString();
const fmtXwoba = (v: number | null) =>
  v == null ? "—" : v.toFixed(3).replace(/^0+/, "");

export function PerPitchSuccessTable({
  breakdowns,
  population,
  populationMinPitches = 100,
  title,
  filterPitchType = null,
  minUsagePct = 0.03,
}: PerPitchSuccessTableProps) {
  // Build a per-pitch-type RV/100 population for percentile coloring.
  // Filter to rows with ≥ populationMinPitches of that pitch type so
  // tiny samples don't skew the distribution.
  const rvPopByType = useMemo(() => {
    if (!population) return null;
    const qualified = population.filter((r) => r.pitches >= populationMinPitches);
    const populationBreakdowns = derivePitchTypeBreakdowns(qualified);
    const map = new Map<string, number[]>();
    for (const b of populationBreakdowns) {
      if (b.rv100 == null) continue;
      if (!map.has(b.pitchType)) map.set(b.pitchType, []);
      map.get(b.pitchType)!.push(b.rv100);
    }
    return map;
  }, [population, populationMinPitches]);
  // Sort by usage descending so the most-used pitch type lands at the top
  const sorted = [...breakdowns].sort((a, b) => b.pitches - a.pitches);
  const totalPitches = sorted.reduce((sum, r) => sum + r.pitches, 0);

  // When filtered to a specific pitch type, show ONLY that row.
  // When unfiltered, hide rows below the usage threshold to reduce noise.
  const visibleRows = filterPitchType
    ? sorted.filter((r) => r.pitchType === filterPitchType)
    : sorted.filter((r) => (r.usagePct ?? 0) >= minUsagePct);
  const hiddenCount = sorted.length - visibleRows.length;
  const rows = visibleRows;

  return (
    <section
      className="border px-5 py-5"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="h-3 w-0.5" style={{ backgroundColor: GOLD }} />
          <h3 className="font-[Oswald] text-[14px] font-bold uppercase tracking-[0.18em] text-white">
            {title ?? "Per-Pitch Success"}
          </h3>
        </div>
        <span className="font-[Archivo_Narrow] text-[10px] uppercase tracking-wider text-white/40">
          {fmtInt(totalPitches)} pitches · {rows.length} types
          {hiddenCount > 0 && !filterPitchType && (
            <span className="ml-2 text-white/30">
              · {hiddenCount} below {(minUsagePct * 100).toFixed(0)}% usage hidden
            </span>
          )}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="py-4 text-sm text-white/40">No per-pitch data for this filter.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr
                className="border-b text-left font-[Oswald] text-[11px] uppercase tracking-wider text-white/55"
                style={{ borderColor: TABLE_HEADER_BORDER }}
              >
                <th className="py-2 pr-3">Pitch</th>
                <th className="py-2 pr-3 text-right">RV/100</th>
                <th className="py-2 pr-3 text-right">RV</th>
                <th className="py-2 pr-3 text-right">#</th>
                <th className="py-2 pr-3 text-right">Usage%</th>
                <th className="py-2 pr-3 text-right">Velo</th>
                <th className="py-2 pr-3 text-right">Stuff+</th>
                <th className="py-2 pr-3 text-right">Whiff%</th>
                <th className="py-2 pr-3 text-right">Chase%</th>
                <th className="py-2 pr-3 text-right">EV</th>
                <th className="py-2 pr-3 text-right">Hard Hit</th>
                <th className="py-2 pr-3 text-right">Barrel</th>
                <th className="py-2 pr-3 text-right">xwOBA</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.pitchType}
                  className="border-b font-[Oswald] text-sm text-white transition-colors duration-150 hover:bg-white/[0.03]"
                  style={{ borderColor: ROW_BORDER }}
                >
                  <td className="py-2 pr-3 font-bold">{r.pitchType}</td>
                  {(() => {
                    const rvPop = rvPopByType?.get(r.pitchType);
                    // Internal rv100 is pitcher perspective (positive = good).
                    const rvPct =
                      rvPop && rvPop.length > 0
                        ? percentileRank(r.rv100, rvPop)
                        : null;
                    const bg =
                      rvPct != null ? percentileColor(rvPct) : "transparent";

                    // RV/100 — pitcher perspective, positive = good (no flip)
                    const per100Fmt =
                      r.rv100 != null
                        ? (r.rv100 > 0 ? "+" : "") + r.rv100.toFixed(1)
                        : "—";

                    // RV total — pitcher perspective, positive = good
                    const totalFmt =
                      r.rvTotal != null
                        ? (r.rvTotal > 0 ? "+" : "") + r.rvTotal.toFixed(0)
                        : "—";
                    const titleText =
                      rvPct != null
                        ? `${rvPct}th pitcher percentile vs NCAA ${r.pitchType}s`
                        : undefined;
                    return (
                      <>
                        <td className="py-2 pr-3 text-right tabular-nums text-white">
                          {per100Fmt}
                        </td>
                        <td
                          className="py-2 pr-3 text-right tabular-nums font-bold"
                          style={{
                            backgroundColor: bg,
                            color:
                              rvPct == null && r.rvTotal != null && r.rvTotal >= 5
                                ? GOLD
                                : "#FFFFFF",
                          }}
                          title={titleText}
                        >
                          {totalFmt}
                        </td>
                      </>
                    );
                  })()}
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {fmtInt(r.pitches)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {fmtPct(r.usagePct)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {fmtVel(r.velo)}
                  </td>
                  <td
                    className="py-2 pr-3 text-right tabular-nums font-bold"
                    style={{
                      color: r.stuffPlus != null && r.stuffPlus >= 105 ? GOLD : undefined,
                    }}
                  >
                    {fmtVel(r.stuffPlus)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {fmtPct(r.whiffPct)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {fmtPct(r.chasePct)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {fmtVel(r.avgEv)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {fmtPct(r.hardHitPct)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {fmtPct(r.barrelPct)}
                  </td>
                  <td
                    className="py-2 pr-3 text-right tabular-nums font-bold"
                    style={{
                      color: r.xWoba != null && r.xWoba <= 0.3 ? GOLD : undefined,
                    }}
                  >
                    {fmtXwoba(r.xWoba)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
