import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSavantHitters, SAVANT_MIN_AB } from "@/savant/hooks/useSavantHitters";
import { useSavantPitchers, SAVANT_MIN_IP } from "@/savant/hooks/useSavantPitchers";
import { useSortable, SortHeader, tierColor } from "@/savant/components/SortableTable";
import { NAVY_CARD, NAVY_BORDER, GOLD } from "@/savant/lib/theme";

const fmt3 = (v: number | null) => (v == null ? "—" : v.toFixed(3));
const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtInt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);

export default function LeaderboardsPage() {
  const [tab, setTab] = useState<"hitting" | "pitching">("hitting");
  const { data: hitters = [] } = useSavantHitters();
  const { data: pitchers = [] } = useSavantPitchers();

  const qualifiedHitters = useMemo(
    () => hitters.filter((h) => (h.ab ?? 0) >= SAVANT_MIN_AB),
    [hitters],
  );
  const qualifiedPitchers = useMemo(
    () => pitchers.filter((p) => (p.IP ?? 0) >= SAVANT_MIN_IP),
    [pitchers],
  );

  const hittingSort = useSortable(qualifiedHitters, "barrel", "desc");
  const pitchingSort = useSortable(qualifiedPitchers, "stuff_plus", "desc");

  return (
    <>
      <div className="mb-6 flex gap-1">
        {(["hitting", "pitching"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="cursor-pointer border px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150"
            style={{
              borderColor: tab === t ? GOLD : NAVY_BORDER,
              color: tab === t ? GOLD : "rgba(255,255,255,0.45)",
              backgroundColor: tab === t ? "rgba(212,175,55,0.06)" : "transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "hitting" ? (
        <div className="overflow-x-auto border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
          <table className="w-full text-sm text-white">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-white/50">
                <SortHeader label="Player" field="playerFullName" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} align="left" />
                <SortHeader label="PA" field="pa" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="AVG" field="AVG" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="OBP" field="OBP" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="SLG" field="SLG" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="ISO" field="ISO" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="EV" field="avg_exit_velo" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="EV90" field="ev90" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="Barrel%" field="barrel" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="BB%" field="bb" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="Chase%" field="chase" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="Contact%" field="contact" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="LD%" field="line_drive" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="GB%" field="gb" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
                <SortHeader label="Pull%" field="pull" sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {hittingSort.sorted.map((h) => (
                <tr key={h.source_player_id} className="border-t border-white/5 transition-colors hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <Link to={`/savant/hitter/${h.source_player_id}`} className="font-semibold text-white transition-colors hover:text-[#D4AF37]">
                      {h.playerFullName}
                    </Link>
                    <div className="text-[10px] text-white/40">{[h.Pos, h.Team].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-white/60">{fmtInt(h.pa)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt3(h.AVG)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt3(h.OBP)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt3(h.SLG)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt3(h.ISO)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt1(h.avg_exit_velo)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt1(h.ev90)}</td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(h.barrel, 8, 4) }}>{fmtPct(h.barrel)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(h.bb)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(h.chase)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(h.contact)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(h.line_drive)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(h.gb)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(h.pull)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
          <table className="w-full text-sm text-white">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-white/50">
                <SortHeader label="Player" field="playerFullName" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} align="left" />
                <SortHeader label="IP" field="IP" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
                <SortHeader label="Whiff%" field="miss_pct" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
                <SortHeader label="IZ Whiff%" field="in_zone_whiff_pct" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
                <SortHeader label="Chase%" field="chase_pct" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
                <SortHeader label="BB%" field="bb_pct" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
                <SortHeader label="HH%" field="hard_hit_pct" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
                <SortHeader label="Barrel%" field="barrel_pct" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
                <SortHeader label="Exit Velo" field="exit_vel" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
                <SortHeader label="GB%" field="ground_pct" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
                <SortHeader label="Stuff+" field="stuff_plus" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
                <SortHeader label="90th Velo" field="vel_90th" sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {pitchingSort.sorted.map((p) => (
                <tr key={p.source_player_id} className="border-t border-white/5 transition-colors hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <Link to={`/savant/pitcher/${p.source_player_id}`} className="font-semibold text-white transition-colors hover:text-[#D4AF37]">
                      {p.playerFullName}
                    </Link>
                    <div className="text-[10px] text-white/40">{[p.Role, p.Team].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-white/60">{fmt1(p.IP)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(p.miss_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(p.in_zone_whiff_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(p.chase_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(p.bb_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(p.hard_hit_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(p.barrel_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt1(p.exit_vel)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtPct(p.ground_pct)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tierColor(p.stuff_plus, 100, 10) }}>{fmtInt(p.stuff_plus)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt1(p.vel_90th)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
