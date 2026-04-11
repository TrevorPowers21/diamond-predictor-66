import { useState } from "react";
import {
  runBreakingBallReclassification,
  type ReclassificationReport,
} from "@/savant/lib/breakingBallReclassification";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="border px-4 py-3"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">{label}</div>
      <div className="mt-1 font-[Oswald] text-xl font-bold tabular-nums text-white">{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-4 pb-2">
      <span className="h-px flex-1 bg-[#D4AF37]/20" />
      <span
        className="text-[10px] font-bold uppercase tracking-[0.2em]"
        style={{ color: GOLD }}
      >
        {children}
      </span>
      <span className="h-px flex-1 bg-[#D4AF37]/20" />
    </div>
  );
}

export default function ReclassificationRunner() {
  const [season, setSeason] = useState(2025);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ReclassificationReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleRun() {
    console.log("[Reclassification] Starting pipeline...");
    setRunning(true);
    setReport(null);
    setErrors([]);
    try {
      const result = await runBreakingBallReclassification(season);
      console.log("[Reclassification] Complete:", result);
      setReport(result.report);
      setErrors(result.errors);
    } catch (err: any) {
      console.error("[Reclassification] Error:", err);
      setErrors([err.message || String(err) || "Unknown error"]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div
        className="flex items-end gap-4 border px-6 py-5"
        style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
      >
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
            Season
          </label>
          <select
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            className="cursor-pointer border bg-transparent px-3 py-2 text-sm text-white focus:outline-none"
            style={{ borderColor: NAVY_BORDER }}
          >
            <option value={2025}>2025</option>
            <option value={2024}>2024</option>
            <option value={2026}>2026</option>
          </select>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="cursor-pointer border px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150 hover:bg-[#D4AF37]/10 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: GOLD, color: GOLD }}
        >
          {running ? "Running Pipeline…" : "Run Breaking Ball Reclassification"}
        </button>
      </div>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      )}

      {/* Report */}
      {report && (
        <div className="space-y-3">
          {/* ── All Pitch Types in Table (Diagnostic) ── */}
          {(report.allPitchTypes ?? []).length > 0 && (
            <>
              <SectionTitle>All Pitch Types in Table (Diagnostic)</SectionTitle>
              <div
                className="border px-4 py-3"
                style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
              >
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                  Every distinct pitch_type + hand in pitcher_stuff_plus_inputs for {season}
                </div>
                {(report.allPitchTypes ?? []).map((pt, i) => (
                  <div key={i} className="flex justify-between text-sm text-white">
                    <span>
                      <span className="text-white/50">{pt.hand === "R" ? "RHP" : "LHP"}</span>{" "}
                      <span className={
                        ["Slider", "Sweeper", "Curveball"].includes(pt.pitch_type)
                          ? "font-semibold text-[#D4AF37]"
                          : ""
                      }>
                        {pt.pitch_type}
                      </span>
                    </span>
                    <span className="tabular-nums text-white/70">{pt.count}</span>
                  </div>
                ))}
                <div className="mt-2 text-[10px] text-white/40">
                  Gold = matched by pipeline filter (Slider, Sweeper, Curveball)
                </div>
              </div>
            </>
          )}

          {/* ── Processing Totals ── */}
          <SectionTitle>Processing Totals</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBox label="Total Pulled" value={report.totalPulled} />
            <StatBox label="Filter 1 Dropped" value={report.filter1Dropped.length} />
            <StatBox label="Filter 2 Dropped" value={report.filter2Dropped.length} />
            <StatBox label="Into Reclassification" value={report.survivingIntoReclassification} />
          </div>

          {/* ── Reclassification Results ── */}
          <SectionTitle>Reclassification Results</SectionTitle>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Object.entries(report.reclassificationCounts).map(([hand, classes]) => (
              <div
                key={hand}
                className="border px-4 py-3"
                style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
              >
                <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                  {hand === "R" ? "RHP" : "LHP"} Breakdown
                </div>
                {Object.entries(classes)
                  .sort(([, a], [, b]) => b - a)
                  .map(([cls, count]) => (
                    <div key={cls} className="flex justify-between text-sm text-white">
                      <span>{cls}</span>
                      <span className="tabular-nums text-white/70">{count}</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>

          {/* Tag movements */}
          {(report.tagMovements ?? []).filter((m) => m.from !== m.to).length > 0 && (
            <div
              className="border px-4 py-3"
              style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
            >
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                Reclassification Movements
              </div>
              {report.tagMovements
                .filter((m) => m.from !== m.to)
                .slice(0, 15)
                .map((m, i) => (
                  <div key={i} className="flex justify-between text-sm text-white">
                    <span>
                      {m.hand === "R" ? "RHP" : "LHP"} {m.from} → {m.to}
                    </span>
                    <span className="tabular-nums text-white/70">{m.count}</span>
                  </div>
                ))}
            </div>
          )}

          {/* ── Consolidation Results ── */}
          <SectionTitle>Consolidation</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBox label="Players Consolidated" value={report.consolidationCount} />
            <StatBox label="Source Rows Merged" value={report.sourceRowsMerged} />
            <StatBox label="Rows Produced" value={report.consolidatedRowsProduced} />
            <StatBox label="Sub-Threshold Dropped" value={report.subThresholdDropped} />
          </div>

          {/* Two-pitch players */}
          {(report.twoPitchPlayers ?? []).length > 0 && (
            <div
              className="border px-4 py-3"
              style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
            >
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                Legitimate Two-Pitch Players ({report.twoPitchPlayers.length})
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-white">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-white/50">
                      <th className="py-1 pr-3">Player</th>
                      <th className="py-1 pr-3">Hand</th>
                      <th className="py-1 pr-3">Classes</th>
                      <th className="py-1 pr-3 text-right">IVB / HB</th>
                      <th className="py-1 text-right">P</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.twoPitchPlayers.map((p, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="py-1 pr-3 font-medium">{p.name}</td>
                        <td className="py-1 pr-3">{p.hand === "R" ? "RHP" : "LHP"}</td>
                        <td className="py-1 pr-3 text-xs text-white/70">
                          {p.classes.join(", ")}
                        </td>
                        <td className="py-1 pr-3 text-right tabular-nums text-xs text-white/70">
                          {p.movements
                            .map((m) => `${m.ivb?.toFixed(1)}/${m.hb?.toFixed(1)}`)
                            .join(" · ")}
                        </td>
                        <td className="py-1 text-right tabular-nums">{p.pitchCounts.join(" / ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Needs Review ── */}
          {(report.needsReview ?? []).length > 0 && (
            <>
              <SectionTitle>Needs Review ({report.needsReview.length})</SectionTitle>
              <div
                className="border px-4 py-3"
                style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-white">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-white/50">
                        <th className="py-1 pr-3">Player</th>
                        <th className="py-1 pr-3">Hand</th>
                        <th className="py-1 pr-3">Class</th>
                        <th className="py-1 pr-3 text-right">P</th>
                        <th className="py-1 pr-3 text-right">IVB</th>
                        <th className="py-1 pr-3 text-right">HB</th>
                        <th className="py-1 pr-3 text-right">Velo</th>
                        <th className="py-1 pr-3 text-right">Spin</th>
                        <th className="py-1">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.needsReview.slice(0, 50).map((r, i) => (
                        <tr key={i} className="border-t border-white/5">
                          <td className="py-1 pr-3 font-medium">
                            {r._playerName ?? r.source_player_id}
                          </td>
                          <td className="py-1 pr-3">{r.hand === "R" ? "RHP" : "LHP"}</td>
                          <td className="py-1 pr-3 text-xs">{r.rstr_pitch_class}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">{r.pitches ?? "—"}</td>
                          <td className="py-1 pr-3 text-right tabular-nums">
                            {r.ivb?.toFixed(1) ?? "—"}
                          </td>
                          <td className="py-1 pr-3 text-right tabular-nums">
                            {r.hb?.toFixed(1) ?? "—"}
                          </td>
                          <td className="py-1 pr-3 text-right tabular-nums">
                            {r.velocity?.toFixed(1) ?? "—"}
                          </td>
                          <td className="py-1 pr-3 text-right tabular-nums">{r.spin ?? "—"}</td>
                          <td className="py-1 text-xs text-white/50">{r.review_note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {report.needsReview.length > 50 && (
                    <p className="mt-2 text-xs text-white/40">
                      Showing first 50 of {report.needsReview.length} flagged rows.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── Write Summary ── */}
          <SectionTitle>Write Summary</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Rows Written" value={report.totalWritten} />
            <StatBox label="Log Entries" value={report.logRowsWritten} />
          </div>

          {/* Dropped rows detail (collapsible) */}
          {((report.filter1Dropped ?? []).length > 0 || (report.filter2Dropped ?? []).length > 0) && (
            <details className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
              <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                Dropped Rows Detail ({report.filter1Dropped.length + report.filter2Dropped.length})
              </summary>
              <div className="mt-2 max-h-64 overflow-auto text-xs text-white/60">
                {[...report.filter1Dropped, ...report.filter2Dropped].slice(0, 100).map((d, i) => (
                  <div key={i} className="border-t border-white/5 py-1">
                    <span className="font-medium text-white/80">{d.name}</span>
                    <span className="ml-2 text-white/40">{d.pitch_type}</span>
                    <span className="ml-2">{d.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
