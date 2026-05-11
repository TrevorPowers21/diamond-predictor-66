import { useState } from "react";
import { rollupStuffPlusToMaster, type StuffPlusRollupReport } from "@/savant/lib/rollupStuffPlusToMaster";

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

export default function StuffPlusRollupRunner() {
  const season = 2026;
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<StuffPlusRollupReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleRun() {
    setRunning(true);
    setReport(null);
    setErrors([]);
    try {
      const result = await rollupStuffPlusToMaster(season);
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
        <div className="flex-1">
          <button
            onClick={handleRun}
            disabled={running}
            className="cursor-pointer border px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150 hover:bg-[#D4AF37]/10 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: GOLD, color: GOLD }}
          >
            {running ? "Rolling up…" : `Roll Up ${season} Per-Pitch Stuff+ → Pitching Master`}
          </button>
          <p className="mt-2 text-[11px] text-white/50">
            Pitch-weighted average of <span className="text-white/70">pitcher_stuff_plus_inputs.stuff_plus</span> →
            written to <span className="text-white/70">Pitching Master.stuff_plus</span>. Run after Reclassification +
            Stuff+ Recompute, before Compute Scores.
          </p>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errors.slice(0, 10).map((e, i) => <p key={i}>{e}</p>)}
          {errors.length > 10 && <p className="mt-1 text-white/40">…and {errors.length - 10} more</p>}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <StatBox label="Pitchers Processed" value={report.pitchersProcessed} />
            <StatBox label="Pitchers Updated" value={report.pitchersUpdated} />
            <StatBox label="Pitchers Skipped" value={report.pitchersSkipped} />
            <StatBox label="Total Pitches" value={report.totalPitches.toLocaleString()} />
          </div>
          {report.results.length > 0 && (
            <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
                Top 20 by pitch count
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-white">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-white/50">
                      <th className="py-1 pr-3">Source Player ID</th>
                      <th className="py-1 pr-3 text-right">Pitches</th>
                      <th className="py-1 text-right">Stuff+</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.results.slice(0, 20).map((r, i) => (
                      <tr key={i} className="border-t border-white/5">
                        <td className="py-1 pr-3 font-mono text-white/70">{r.source_player_id}</td>
                        <td className="py-1 pr-3 text-right tabular-nums text-white/70">{r.pitches}</td>
                        <td className="py-1 text-right tabular-nums">{r.stuff_plus.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
