import { useState } from "react";
import { computeNonBreakingBallPopConstants, type NonBbPopReport } from "@/savant/lib/nonBreakingBallPopConstants";

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

export default function NonBreakingBallPopRunner() {
  const season = 2026;
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<NonBbPopReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleRun() {
    setRunning(true);
    setReport(null);
    setErrors([]);
    try {
      const result = await computeNonBreakingBallPopConstants(season);
      setReport(result.report);
      setErrors(result.errors);
    } catch (err: any) {
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
          {running ? "Computing…" : `Compute ${season} FB/SI/CT/CH/SP Pop Constants`}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Pitch Types Processed" value={report.pitchTypesProcessed} />
            <StatBox label="Rows Written" value={report.rowsWritten} />
          </div>
          <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-white/50">
                    <th className="py-1 pr-3">Pitch</th>
                    <th className="py-1 pr-3">Hand</th>
                    <th className="py-1 pr-3 text-right">N Pitchers</th>
                    <th className="py-1 pr-3 text-right">Pitches</th>
                    <th className="py-1 pr-3 text-right">Vel</th>
                    <th className="py-1 pr-3 text-right">IVB</th>
                    <th className="py-1 text-right">HB</th>
                  </tr>
                </thead>
                <tbody>
                  {report.results.map((r, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="py-1 pr-3 font-medium">{r.pitch_type}</td>
                      <td className="py-1 pr-3 text-white/50">{r.hand === "R" ? "RHP" : "LHP"}</td>
                      <td className="py-1 pr-3 text-right tabular-nums text-white/70">{r.n_pitchers}</td>
                      <td className="py-1 pr-3 text-right tabular-nums text-white/70">{r.pitches}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.velocity?.toFixed(1) ?? "—"}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.ivb?.toFixed(1) ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums">{r.hb?.toFixed(1) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
