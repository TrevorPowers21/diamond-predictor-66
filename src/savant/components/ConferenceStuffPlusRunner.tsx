import { useState } from "react";
import { calculateConferenceStuffPlus, type ConferenceStuffPlusReport } from "@/savant/lib/conferenceStuffPlus";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

export default function ConferenceStuffPlusRunner() {
  const [season] = useState(2026);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ConferenceStuffPlusReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleRun() {
    console.log("[ConfStuff+] Starting...");
    setRunning(true);
    setReport(null);
    setErrors([]);
    try {
      const result = await calculateConferenceStuffPlus(season);
      console.log("[ConfStuff+] Complete:", result);
      setReport(result.report);
      setErrors(result.errors);
    } catch (err: any) {
      console.error("[ConfStuff+] Error:", err);
      setErrors([err.message || String(err)]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4 border px-6 py-5" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
        <button
          onClick={handleRun}
          disabled={running}
          className="cursor-pointer border px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150 hover:bg-[#D4AF37]/10 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: GOLD, color: GOLD }}
        >
          {running ? "Calculating…" : "Run Conference Stuff+"}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
              Written: {report.written} conferences
            </div>
          </div>

          <div className="overflow-x-auto border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <table className="w-full text-sm text-white">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-white/50">
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Conference</th>
                  <th className="px-3 py-2 text-right">Stuff+</th>
                  <th className="px-3 py-2 text-right">Pitchers</th>
                  <th className="px-3 py-2 text-right">Total Pitches</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {report.results.map((r, i) => (
                  <tr key={r.conference} className="border-t border-white/5">
                    <td className="px-3 py-1.5 tabular-nums text-white/50">{i + 1}</td>
                    <td className="px-3 py-1.5 font-medium">{r.conference}</td>
                    <td
                      className="px-3 py-1.5 text-right font-bold tabular-nums"
                      style={{ color: r.stuffPlus >= 101 ? "#22c55e" : r.stuffPlus >= 99 ? "#D4AF37" : "#ef4444" }}
                    >
                      {r.stuffPlus}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-white/60">{r.pitcherCount}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-white/60">{r.totalPitches.toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-xs text-white/40">{r.thinSample ? "thin sample" : ""}</td>
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
