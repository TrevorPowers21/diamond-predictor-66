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
            <tr className="text-[10px] font-semibold uppercase tracking-wider text-white/55">
              <th className="px-4 py-2 text-left">Metric</th>
              {rows.map((r, i) => (
                <th
                  key={`hdr-${r.Season}-${i}`}
                  className="px-3 py-2 text-right font-mono tabular-nums text-white"
                >
                  {r.Season ?? "—"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { label: "Contact", key: "contact", fmt: fmtPct },
              { label: "Line Drive", key: "line_drive", fmt: fmtPct },
              { label: "Exit Velo", key: "avg_exit_velo", fmt: fmt1 },
              { label: "EV90", key: "ev90", fmt: fmt1 },
              { label: "Barrel", key: "barrel", fmt: fmtPct },
              { label: "LA 10-30", key: "la_10_30", fmt: fmtPct },
              { label: "BB%", key: "bb", fmt: fmtPct },
              { label: "Chase", key: "chase", fmt: fmtPct },
              { label: "GB%", key: "gb", fmt: fmtPct },
              { label: "Pull", key: "pull", fmt: fmtPct },
            ].map((metric) => (
              <tr
                key={metric.key}
                className="border-t text-white/85 transition-colors hover:bg-white/[0.025]"
                style={{ borderColor: NAVY_BORDER }}
              >
                <td
                  className="px-4 py-2 text-left text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: GOLD }}
                >
                  {metric.label}
                </td>
                {rows.map((r, i) => (
                  <td
                    key={`${metric.key}-${r.Season}-${i}`}
                    className="px-3 py-2 text-right font-mono tabular-nums text-white"
                  >
                    {metric.fmt((r as any)[metric.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
