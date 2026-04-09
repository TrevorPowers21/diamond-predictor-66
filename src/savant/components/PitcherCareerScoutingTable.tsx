import type { PitcherCareerRow } from "@/savant/hooks/usePitcherCareer";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));

interface PitcherCareerScoutingTableProps {
  rows: PitcherCareerRow[];
}

/**
 * Year-over-year contact-quality scouting table for the savant pitcher
 * profile. One row per season, oldest first. Pulls from Pitching Master.
 *
 * NOT to be confused with PitcherStuffPlusTable, which is the per-pitch
 * Stuff+ inputs (velo / IVB / HB / etc.) keyed by pitch type and handedness.
 */
export default function PitcherCareerScoutingTable({ rows }: PitcherCareerScoutingTableProps) {
  if (!rows || rows.length === 0) return null;

  return (
    <section className="border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
      <div className="flex items-center gap-2 border-b px-6 py-3" style={{ borderColor: NAVY_BORDER }}>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: GOLD }} />
        <h2
          className="text-xs font-bold uppercase tracking-[0.22em]"
          style={{ color: GOLD, fontFamily: "'Oswald', sans-serif" }}
        >
          Scouting Metrics
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-white">
              <th className="px-4 py-2">Season</th>
              <th className="px-3 py-2 text-right">Whiff</th>
              <th className="px-3 py-2 text-right">IZ Whiff</th>
              <th className="px-3 py-2 text-right">Chase</th>
              <th className="px-3 py-2 text-right">BB%</th>
              <th className="px-3 py-2 text-right">Hard Hit</th>
              <th className="px-3 py-2 text-right">Barrel</th>
              <th className="px-3 py-2 text-right">EV</th>
              <th className="px-3 py-2 text-right">90th EV</th>
              <th className="px-3 py-2 pr-4 text-right">GB%</th>
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
                <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.miss_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.in_zone_whiff_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.chase_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.bb_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.hard_hit_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.barrel_pct)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.exit_vel)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.vel_90th)}</td>
                <td className="px-3 py-2 pr-4 text-right tabular-nums">{fmtPct(r.ground_pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
