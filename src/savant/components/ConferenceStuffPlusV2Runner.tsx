import { useState } from "react";
import { calculateConferenceStuffPlusV2, type ConferenceStuffPlusV2Report } from "@/savant/lib/conferenceStuffPlusV2";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

const PITCH_ORDER = ["4S FB", "Sinker", "Cutter", "Gyro Slider", "Slider", "Sweeper", "Curveball", "Change-up", "Splitter"];
const PITCH_SHORT: Record<string, string> = {
  "4S FB": "4S",
  Sinker: "SI",
  Cutter: "CT",
  "Gyro Slider": "GS",
  Slider: "SL",
  Sweeper: "SW",
  Curveball: "CB",
  "Change-up": "CH",
  Splitter: "SP",
};

function stuffColor(v: number | null): string {
  if (v == null) return "";
  if (v >= 102) return "#22c55e";
  if (v >= 100) return "#D4AF37";
  if (v >= 98) return "#ffffff";
  if (v >= 96) return "#eab308";
  return "#ef4444";
}

export default function ConferenceStuffPlusV2Runner() {
  const [season] = useState(2025);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ConferenceStuffPlusV2Report | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleRun() {
    console.log("[ConfStuff+V2] Starting...");
    setRunning(true);
    setReport(null);
    setErrors([]);
    try {
      const result = await calculateConferenceStuffPlusV2(season);
      console.log("[ConfStuff+V2] Complete:", result);
      setReport(result.report);
      setErrors(result.errors);
    } catch (err: any) {
      console.error("[ConfStuff+V2] Error:", err);
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
          {running ? "Calculating…" : "Run Conference Stuff+ V2 (Pitch-Level)"}
        </button>
      </div>

      {errors.length > 0 && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {/* Overall rankings */}
          <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
              Overall Conference Stuff+ V2 — Written: {report.written}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-white/50">
                    <th className="px-2 py-1 text-left">#</th>
                    <th className="px-2 py-1 text-left">Conference</th>
                    <th className="px-2 py-1 text-right">Stuff+</th>
                    <th className="px-2 py-1 text-right">Pitchers</th>
                    <th className="px-2 py-1 text-right">Pitches</th>
                  </tr>
                </thead>
                <tbody>
                  {report.overall.map((r, i) => (
                    <tr key={r.conference} className="border-t border-white/5">
                      <td className="px-2 py-1 tabular-nums text-white/40">{i + 1}</td>
                      <td className="px-2 py-1 font-medium">{r.conference}</td>
                      <td className="px-2 py-1 text-right font-bold tabular-nums" style={{ color: stuffColor(r.overall) }}>{r.overall}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-white/60">{r.pitcherCount}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-white/60">{r.totalPitches.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* By pitch type */}
          <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
              Conference Stuff+ by Pitch Type
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-white/50">
                    <th className="px-2 py-1 text-left">Conference</th>
                    {PITCH_ORDER.map((pt) => (
                      <th key={pt} className="px-2 py-1 text-right">{PITCH_SHORT[pt]}</th>
                    ))}
                    <th className="px-2 py-1 text-right">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {report.overall.map((r) => (
                    <tr key={r.conference} className="border-t border-white/5">
                      <td className="px-2 py-1 font-medium">{r.conference}</td>
                      {PITCH_ORDER.map((pt) => {
                        const d = r.byPitch[pt];
                        return (
                          <td key={pt} className="px-2 py-1 text-right tabular-nums" style={{ color: stuffColor(d?.stuff_plus ?? null) }}>
                            {d ? d.stuff_plus.toFixed(1) : "—"}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 text-right font-bold tabular-nums" style={{ color: stuffColor(r.overall) }}>{r.overall}</td>
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
