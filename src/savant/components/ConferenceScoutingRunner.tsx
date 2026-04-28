import { useState } from "react";
import { computeConferenceScoutingAverages, type ConferenceScoutingReport } from "@/savant/lib/conferenceScoutingAverages";
import { supabase } from "@/integrations/supabase/client";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

function plusColor(v: number | null): string {
  if (v == null) return "";
  if (v >= 110) return "#22c55e";
  if (v >= 105) return "#D4AF37";
  if (v >= 95) return "#ffffff";
  if (v >= 90) return "#eab308";
  return "#ef4444";
}

export default function ConferenceScoutingRunner() {
  const season = 2026;
  const [running, setRunning] = useState(false);
  const [allSeasonsRunning, setAllSeasonsRunning] = useState(false);
  const [allSeasonsLog, setAllSeasonsLog] = useState<string[]>([]);
  const [report, setReport] = useState<ConferenceScoutingReport | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  async function handleRun() {
    setRunning(true);
    setReport(null);
    setErrors([]);
    try {
      const result = await computeConferenceScoutingAverages(season);
      setReport(result.report);
      setErrors(result.errors);
    } catch (err: any) {
      setErrors([err.message || String(err)]);
    } finally {
      setRunning(false);
    }
  }

  async function handleRunAllSeasons() {
    if (!confirm(
      "Compute Conference Scouting Averages for ALL historical seasons?\n\n" +
      "This will overwrite the conference-level Power Rating + scouting score columns " +
      "for every season in the Hitter/Pitching Master tables.",
    )) return;

    setAllSeasonsRunning(true);
    setAllSeasonsLog([]);
    const log: string[] = [];
    const append = (msg: string) => {
      log.push(msg);
      setAllSeasonsLog([...log]);
    };

    try {
      const { data: sData, error: sErr } = await supabase
        .from("Hitter Master")
        .select("Season")
        .not("Season", "is", null);
      if (sErr) throw sErr;
      const seasons = [...new Set((sData || []).map((r: any) => r.Season))].sort((a, b) => b - a);
      append(`Found seasons: ${seasons.join(", ")}`);

      for (const s of seasons) {
        append(`\n[${s}] Conference Scouting Averages…`);
        const result = await computeConferenceScoutingAverages(s);
        append(`[${s}] written=${result.report.written}${result.errors.length ? ` errors=${result.errors.length}` : ""}`);
      }
      append("\n✓ Done.");
    } catch (err: any) {
      append(`✗ Error: ${err.message || String(err)}`);
    } finally {
      setAllSeasonsRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4 border px-6 py-5" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
        <button
          onClick={handleRun}
          disabled={running || allSeasonsRunning}
          className="cursor-pointer border px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150 hover:bg-[#D4AF37]/10 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: GOLD, color: GOLD }}
        >
          {running ? "Computing…" : `Compute ${season} Conference Scouting Averages`}
        </button>
        <button
          onClick={handleRunAllSeasons}
          disabled={running || allSeasonsRunning}
          className="cursor-pointer border px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          style={{ borderColor: "#ef4444", color: "#ef4444" }}
          title="Recomputes for every season in Hitter Master."
        >
          {allSeasonsRunning ? "Computing All Seasons…" : "↻ ALL Seasons"}
        </button>
      </div>

      {allSeasonsLog.length > 0 && (
        <div className="border px-4 py-3 font-mono text-xs text-white/80 whitespace-pre-line" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
          {allSeasonsLog.join("\n")}
        </div>
      )}

      {errors.length > 0 && (
        <div className="border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {errors.map((e, i) => <p key={i}>{e}</p>)}
        </div>
      )}

      {report && (
        <div className="space-y-3">
          <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
              Conference Offensive Power Rating — Written: {report.written}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-white/50">
                    <th className="py-1 pr-3">#</th>
                    <th className="py-1 pr-3">Conference</th>
                    <th className="py-1 pr-3 text-right">Hitters</th>
                    <th className="py-1 pr-3 text-right">Off PR</th>
                    <th className="py-1 pr-3 text-right">BA+</th>
                    <th className="py-1 pr-3 text-right">OBP+</th>
                    <th className="py-1 pr-3 text-right">ISO+</th>
                    <th className="py-1 pr-3 text-right">Barrel</th>
                    <th className="py-1 pr-3 text-right">Chase</th>
                    <th className="py-1 pr-3 text-right">EV</th>
                    <th className="py-1 text-right">Whiff (P)</th>
                  </tr>
                </thead>
                <tbody>
                  {report.results.map((r, i) => (
                    <tr key={r.conference} className="border-t border-white/5">
                      <td className="py-1 pr-3 text-white/40">{i + 1}</td>
                      <td className="py-1 pr-3 font-medium">{r.conference}</td>
                      <td className="py-1 pr-3 text-right tabular-nums text-white/70">{r.hitterCount}</td>
                      <td className="py-1 pr-3 text-right tabular-nums font-semibold" style={{ color: plusColor(r.offensive_power_rating) }}>
                        {r.offensive_power_rating ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums" style={{ color: plusColor(r.ba_plus) }}>
                        {r.ba_plus ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums" style={{ color: plusColor(r.obp_plus) }}>
                        {r.obp_plus ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums" style={{ color: plusColor(r.iso_plus) }}>
                        {r.iso_plus ?? "—"}
                      </td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.hitter_barrel_score ?? "—"}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.hitter_chase_score ?? "—"}</td>
                      <td className="py-1 pr-3 text-right tabular-nums">{r.hitter_avg_ev_score ?? "—"}</td>
                      <td className="py-1 text-right tabular-nums">{r.pitcher_whiff_score ?? "—"}</td>
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
