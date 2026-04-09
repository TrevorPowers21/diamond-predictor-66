import type { PitcherCareerRow } from "@/savant/hooks/usePitcherCareer";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmtInt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);

interface PitcherCareerStatsTableProps {
  rows: PitcherCareerRow[];
}

/**
 * Year-over-year career stats table for the savant pitcher profile.
 * One row per season, oldest first. IP-weighted career totals on the bottom.
 */
export default function PitcherCareerStatsTable({ rows }: PitcherCareerStatsTableProps) {
  if (!rows || rows.length === 0) return null;

  const totalIp = rows.reduce((s, r) => s + (r.IP ?? 0), 0);
  const totalG = rows.reduce((s, r) => s + (r.G ?? 0), 0);
  const totalGs = rows.reduce((s, r) => s + (r.GS ?? 0), 0);
  const wAvg = (key: "ERA" | "FIP" | "WHIP" | "K9" | "BB9" | "HR9") => {
    let sum = 0;
    let weight = 0;
    for (const r of rows) {
      const v = r[key];
      const w = r.IP ?? 0;
      if (v != null && w > 0) {
        sum += v * w;
        weight += w;
      }
    }
    return weight > 0 ? sum / weight : null;
  };

  return (
    <section
      className="border"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="flex items-center gap-2 border-b px-6 py-3" style={{ borderColor: NAVY_BORDER }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: GOLD }} />
        <h2 className="text-xs font-bold uppercase tracking-[0.22em]" style={{ color: GOLD, fontFamily: "'Oswald', sans-serif" }}>
          Career Stats
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-white">
              <th className="px-4 py-2">Season</th>
              <th className="px-3 py-2">Team</th>
              <th className="px-3 py-2 text-right">IP</th>
              <th className="px-3 py-2 text-right">G</th>
              <th className="px-3 py-2 text-right">GS</th>
              <th className="px-3 py-2 text-right">ERA</th>
              <th className="px-3 py-2 text-right">FIP</th>
              <th className="px-3 py-2 text-right">WHIP</th>
              <th className="px-3 py-2 text-right">K/9</th>
              <th className="px-3 py-2 text-right">BB/9</th>
              <th className="px-3 py-2 pr-4 text-right">HR/9</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.Season}-${r.Team}-${i}`}
                className="border-t text-white transition-colors hover:bg-white/[0.025]"
                style={{ borderColor: NAVY_BORDER }}
              >
                <td className="px-4 py-2 tabular-nums text-white">{r.Season ?? "—"}</td>
                <td className="px-3 py-2">{r.Team ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.IP)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.G)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.GS)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt2(r.ERA)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt2(r.FIP)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt2(r.WHIP)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt2(r.K9)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt2(r.BB9)}</td>
                <td className="px-3 py-2 pr-4 text-right tabular-nums">{fmt2(r.HR9)}</td>
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
                <td className="px-3 py-2 text-right tabular-nums">{fmt1(totalIp)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(totalG)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(totalGs)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt2(wAvg("ERA"))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt2(wAvg("FIP"))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt2(wAvg("WHIP"))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt2(wAvg("K9"))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt2(wAvg("BB9"))}</td>
                <td className="px-3 py-2 pr-4 text-right tabular-nums">{fmt2(wAvg("HR9"))}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
