import type { PlayerCareerRow } from "@/savant/hooks/usePlayerCareer";

const fmt3 = (v: number | null) => (v == null ? "—" : v.toFixed(3));
const fmtInt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);

const opsOf = (r: { OBP: number | null; SLG: number | null }) =>
  r.OBP != null && r.SLG != null ? r.OBP + r.SLG : null;

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#162241";
const GOLD = "#D4AF37";

interface CareerStatsTableProps {
  rows: PlayerCareerRow[];
}

/**
 * Savant-style career stats table — one row per season, newest first, plus a
 * career totals row at the bottom. Shows the slash line and counting columns
 * a coach scans first.
 */
export default function CareerStatsTable({ rows }: CareerStatsTableProps) {
  if (!rows || rows.length === 0) return null;

  // Career totals: PA-weighted slash, summed counting stats
  const totalPa = rows.reduce((s, r) => s + (r.pa ?? 0), 0);
  const totalAb = rows.reduce((s, r) => s + (r.ab ?? 0), 0);
  const wAvg = (key: "AVG" | "OBP" | "SLG" | "ISO") => {
    let sum = 0;
    let weight = 0;
    for (const r of rows) {
      const v = r[key];
      const w = r.pa ?? 0;
      if (v != null && w > 0) {
        sum += v * w;
        weight += w;
      }
    }
    return weight > 0 ? sum / weight : null;
  };
  const careerAvg = wAvg("AVG");
  const careerObp = wAvg("OBP");
  const careerSlg = wAvg("SLG");
  const careerIso = wAvg("ISO");
  const careerOps = careerObp != null && careerSlg != null ? careerObp + careerSlg : null;

  return (
    <section
      className="mt-6 border"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="border-b px-6 py-3" style={{ borderColor: NAVY_BORDER }}>
        <div className="text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: GOLD }}>
          Career Stats
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-white/55">
              <th className="px-4 py-2">Season</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2 text-right">PA</th>
              <th className="px-3 py-2 text-right">AB</th>
              <th className="px-3 py-2 text-right">AVG</th>
              <th className="px-3 py-2 text-right">OBP</th>
              <th className="px-3 py-2 text-right">SLG</th>
              <th className="px-3 py-2 text-right">OPS</th>
              <th className="px-3 py-2 pr-4 text-right">ISO</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.Season}-${r.Team}-${i}`}
                className="border-t text-white/85 transition-colors hover:bg-white/[0.025]"
                style={{ borderColor: NAVY_BORDER }}
              >
                <td className="px-4 py-2 font-mono tabular-nums text-white">{r.Season ?? "—"}</td>
                <td className="px-3 py-2">{r.Team ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtInt(r.pa)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtInt(r.ab)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt3(r.AVG)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt3(r.OBP)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt3(r.SLG)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt3(opsOf(r))}</td>
                <td className="px-3 py-2 pr-4 text-right font-mono tabular-nums">{fmt3(r.ISO)}</td>
              </tr>
            ))}
            {rows.length > 1 && (
              <tr
                className="border-t-2 font-semibold text-white"
                style={{ borderColor: GOLD, backgroundColor: "rgba(212,175,55,0.04)" }}
              >
                <td className="px-4 py-2 text-[11px] uppercase tracking-wider" style={{ color: GOLD }}>
                  {rows.length} Seasons
                </td>
                <td className="px-3 py-2 text-white/55">—</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtInt(totalPa)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtInt(totalAb)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt3(careerAvg)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt3(careerObp)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt3(careerSlg)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt3(careerOps)}</td>
                <td className="px-3 py-2 pr-4 text-right font-mono tabular-nums">{fmt3(careerIso)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
