import { useState } from "react";
import { runVeloDiffPipeline, type VeloDiffReport } from "@/savant/lib/veloDiffPipeline";

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

export default function VeloDiffRunner() {
  const [season] = useState(2025);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<VeloDiffReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleRun() {
    console.log("[VeloDiff] Starting pipeline...");
    setRunning(true);
    setReport(null);
    setErrors([]);
    try {
      const result = await runVeloDiffPipeline(season);
      console.log("[VeloDiff] Complete:", result);
      setReport(result.report);
      setErrors(result.errors);
    } catch (err: any) {
      console.error("[VeloDiff] Error:", err);
      setErrors([err.message || String(err) || "Unknown error"]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="flex items-end gap-4 border px-6 py-5"
        style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
      >
        <button
          onClick={handleRun}
          disabled={running}
          className="cursor-pointer border px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150 hover:bg-[#D4AF37]/10 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: GOLD, color: GOLD }}
        >
          {running ? "Calculating…" : "Run FB/CH Velo Diff"}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBox label="Changeup Rows" value={report.totalChangeupRows} />
            <StatBox label="FB from 4S+SI" value={report.fbFromBoth} />
            <StatBox label="FB from 4S Only" value={report.fbFrom4SOnly} />
            <StatBox label="FB from SI Only" value={report.fbFromSinkerOnly} />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBox label="No FB Found" value={report.noFastballFound} />
            <StatBox label="Negative Diff (flagged)" value={report.negativeVeloDiff} />
            <StatBox label="Rows Written" value={report.written} />
            <StatBox label="—" value="—" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatBox label="RHP Mean Diff" value={report.rhpMean != null ? `${report.rhpMean} mph` : "—"} />
            <StatBox label="RHP SD" value={report.rhpSd != null ? `${report.rhpSd}` : "—"} />
            <StatBox label="LHP Mean Diff" value={report.lhpMean != null ? `${report.lhpMean} mph` : "—"} />
            <StatBox label="LHP SD" value={report.lhpSd != null ? `${report.lhpSd}` : "—"} />
          </div>
        </div>
      )}
    </div>
  );
}
