import { useState } from "react";
import { runStuffPlusPipeline, type StuffPlusReport } from "@/savant/lib/stuffPlusEngine";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

function StatBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">{label}</div>
      <div className="mt-1 font-[Oswald] text-xl font-bold tabular-nums text-white">{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-4 pb-2">
      <span className="h-px flex-1 bg-[#D4AF37]/20" />
      <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: GOLD }}>{children}</span>
      <span className="h-px flex-1 bg-[#D4AF37]/20" />
    </div>
  );
}

export default function StuffPlusRunner() {
  const [season, setSeason] = useState(2025);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<StuffPlusReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleRun() {
    console.log("[Stuff+] Starting pipeline...");
    setRunning(true);
    setReport(null);
    setErrors([]);
    try {
      const result = await runStuffPlusPipeline(season);
      console.log("[Stuff+] Complete:", result);
      setReport(result.report);
      setErrors(result.errors);
    } catch (err: any) {
      console.error("[Stuff+] Error:", err);
      setErrors([err.message || String(err) || "Unknown error"]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4 border px-6 py-5" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Season</label>
          <select
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            className="cursor-pointer border bg-transparent px-3 py-2 text-sm text-white focus:outline-none"
            style={{ borderColor: NAVY_BORDER }}
          >
            <option value={2025}>2025</option>
            <option value={2024}>2024</option>
            <option value={2023}>2023</option>
          </select>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          className="cursor-pointer border px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150 hover:bg-[#D4AF37]/10 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: GOLD, color: GOLD }}
        >
          {running ? "Calculating Stuff+…" : `Run Stuff+ Equations (${season})`}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          {/* Totals */}
          <SectionTitle>Processing Summary</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBox label="Rows Scored" value={report.totalProcessed} />
            <StatBox label="Rows Written" value={report.written} />
            <StatBox label="Overall Scores" value={report.overallCount} />
            <StatBox label="Single-Pitch" value={report.singlePitchCount} />
          </div>

          {/* Dropped */}
          {report.dropped.length > 0 && (
            <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Dropped Rows</div>
              {report.dropped.map((d, i) => (
                <div key={i} className="flex justify-between text-sm text-white">
                  <span>{d.reason}</span>
                  <span className="tabular-nums text-white/70">{d.count}</span>
                </div>
              ))}
            </div>
          )}

          {/* Calibration warnings */}
          {report.calibrationWarnings.length > 0 && (
            <div className="border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-400">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em]">Calibration Warnings</div>
              {report.calibrationWarnings.map((w, i) => <p key={i}>{w}</p>)}
            </div>
          )}

          {/* By Pitch Type */}
          <SectionTitle>Distribution by Pitch Type</SectionTitle>
          <div className="overflow-x-auto border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <table className="w-full text-sm text-white">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-white/50">
                  <th className="px-3 py-2">Pitch</th>
                  <th className="px-3 py-2">Hand</th>
                  <th className="px-3 py-2 text-right">N</th>
                  <th className="px-3 py-2 text-right">Mean</th>
                  <th className="px-3 py-2 text-right">SD</th>
                  <th className="px-3 py-2 text-right">Min</th>
                  <th className="px-3 py-2 text-right">Max</th>
                  <th className="px-3 py-2 text-right">&gt;110</th>
                  <th className="px-3 py-2 text-right">&gt;120</th>
                  <th className="px-3 py-2 text-right">&lt;90</th>
                  <th className="px-3 py-2 text-right">&lt;80</th>
                  <th className="px-3 py-2 text-right">Flagged</th>
                </tr>
              </thead>
              <tbody>
                {report.byPitchType
                  .sort((a, b) => a.pitch_type.localeCompare(b.pitch_type) || a.hand.localeCompare(b.hand))
                  .map((pt, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-3 py-1.5 font-medium">{pt.pitch_type}</td>
                      <td className="px-3 py-1.5">{pt.hand === "R" ? "RHP" : "LHP"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{pt.count}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: Math.abs(pt.mean - 100) > 2 ? "#facc15" : undefined }}>{pt.mean}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-white/60">{pt.sd}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-white/60">{pt.min}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-white/60">{pt.max}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{pt.above110}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{pt.above120}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{pt.below90}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{pt.below80}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-white/60">{pt.flagged}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Top 20 */}
          <SectionTitle>Top 20 Overall Stuff+</SectionTitle>
          <div className="overflow-x-auto border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <table className="w-full text-sm text-white">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-white/50">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Player</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">Hand</th>
                  <th className="px-3 py-2 text-right">Overall</th>
                  <th className="px-3 py-2">Pitch Scores</th>
                </tr>
              </thead>
              <tbody>
                {report.top20.map((p, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-3 py-1.5 tabular-nums text-white/50">{i + 1}</td>
                    <td className="px-3 py-1.5 font-medium">{p.name}</td>
                    <td className="px-3 py-1.5 text-white/60">{p.team}</td>
                    <td className="px-3 py-1.5">{p.hand === "R" ? "RHP" : "LHP"}</td>
                    <td className="px-3 py-1.5 text-right font-bold tabular-nums" style={{ color: GOLD }}>{p.overall}</td>
                    <td className="px-3 py-1.5 text-xs text-white/50">
                      {p.pitchScores.map((ps) => `${ps.pitch_type}: ${ps.stuff_plus}`).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
