import type { PlayerCareerRow } from "@/savant/hooks/usePlayerCareer";

const NAVY_CARD = "#0D1B3E";
const NAVY_BORDER = "#1a2950";
const GOLD = "#D4AF37";

const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));

interface CareerScoutingTableProps {
  rows: PlayerCareerRow[];
}

/**
 * Year-over-year scouting metrics table for the player profile.
 * One row per season the player has data for. Statcast-style data view —
 * shows the underlying contact / batted-ball / discipline numbers from
 * Hitter Master, NOT the slash line (that lives in CareerStatsTable).
 *
 * Designed to mirror the visual rhythm of the screenshot 2 reference table.
 */
export default function CareerScoutingTable({ rows }: CareerScoutingTableProps) {
  if (!rows || rows.length === 0) return null;

  return (
    <section
      className="mt-6 border"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="border-b px-6 py-3" style={{ borderColor: NAVY_BORDER }}>
        <div className="text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: GOLD }}>
          Scouting Metrics
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-white/55">
              <th className="px-4 py-2">Season</th>
              <th className="px-3 py-2 text-right">Contact</th>
              <th className="px-3 py-2 text-right">LD%</th>
              <th className="px-3 py-2 text-right">EV</th>
              <th className="px-3 py-2 text-right">EV90</th>
              <th className="px-3 py-2 text-right">Barrel%</th>
              <th className="px-3 py-2 text-right">LA 10-30</th>
              <th className="px-3 py-2 text-right">BB%</th>
              <th className="px-3 py-2 text-right">Chase%</th>
              <th className="px-3 py-2 text-right">GB%</th>
              <th className="px-3 py-2 pr-4 text-right">Pull%</th>
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
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(r.contact)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(r.line_drive)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt1(r.avg_exit_velo)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt1(r.ev90)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(r.barrel)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(r.la_10_30)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(r.bb)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(r.chase)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(r.gb)}</td>
                <td className="px-3 py-2 pr-4 text-right font-mono tabular-nums">{fmtPct(r.pull)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
