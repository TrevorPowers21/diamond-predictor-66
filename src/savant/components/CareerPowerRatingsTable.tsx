import type { PlayerCareerRow } from "@/savant/hooks/usePlayerCareer";

const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#162241";
const GOLD = "#D4AF37";

const fmtInt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);

interface CareerPowerRatingsTableProps {
  rows: PlayerCareerRow[];
}

/**
 * Year-over-year internal power ratings table for the player profile.
 * Displays BA+, OBP+, ISO+, Overall+ — computed by the scoring engine and
 * stored on Hitter Master. 100 = NCAA average. >100 above average.
 */
export default function CareerPowerRatingsTable({ rows }: CareerPowerRatingsTableProps) {
  if (!rows || rows.length === 0) return null;

  return (
    <section
      className="border"
      style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
    >
      <div className="border-b px-6 py-3" style={{ borderColor: NAVY_BORDER }}>
        <div className="text-[11px] font-bold uppercase tracking-[0.25em]" style={{ color: GOLD }}>
          Internal Power Ratings
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wider text-white/55">
              <th className="px-4 py-2">Season</th>
              <th className="px-3 py-2 text-right">BA+</th>
              <th className="px-3 py-2 text-right">OBP+</th>
              <th className="px-3 py-2 text-right">ISO+</th>
              <th className="px-3 py-2 pr-4 text-right">Overall+</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.Season}-${r.Team}-${i}`}
                className="border-t text-white/85 transition-colors hover:bg-white/[0.025]"
                style={{ borderColor: NAVY_BORDER }}
              >
                <td className="px-4 py-2 tabular-nums text-white">{r.Season ?? "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.ba_plus)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.obp_plus)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.iso_plus)}</td>
                <td
                  className="px-3 py-2 pr-4 text-right tabular-nums font-bold"
                  style={{ color: GOLD }}
                >
                  {fmtInt(r.overall_plus)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
