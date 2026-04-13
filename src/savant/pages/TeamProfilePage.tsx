import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTeamRoster } from "@/savant/hooks/useTeamRoster";
import { useParkFactors } from "@/hooks/useParkFactors";
import { useSortable, SortHeader, tierColor } from "@/savant/components/SortableTable";
import { NAVY_CARD, NAVY_BORDER, GOLD } from "@/savant/lib/theme";

const fmt3 = (v: number | null) => (v == null ? "—" : v.toFixed(3));
const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtInt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);

function parkColor(v: number | null, neutral = 1.0): string {
  if (v == null) return "";
  const diff = v - neutral;
  if (Math.abs(diff) < 0.02) return "#ffffff";
  if (diff > 0.05) return "#ef4444"; // hitter friendly
  if (diff > 0) return "#eab308";
  if (diff < -0.05) return "#22c55e"; // pitcher friendly
  return "#3b82f6";
}

export default function TeamProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { team, hitters, pitchers, isLoading } = useTeamRoster(id);
  const { parkMap } = useParkFactors(2025);

  const [outerTab, setOuterTab] = useState<"hitting" | "pitching">("hitting");
  const [innerTab, setInnerTab] = useState<"traditional" | "advanced">("traditional");

  // Park factors lookup
  const pf = useMemo(() => {
    if (!team) return null;
    return parkMap.byTeamId[team.id] ?? parkMap.byName[team.fullName?.toLowerCase().trim() ?? ""] ?? null;
  }, [team, parkMap]);

  const hittingTradSort = useSortable(hitters, "pa", "desc");
  const hittingAdvSort = useSortable(hitters, "avg_exit_velo", "desc");
  const pitchingTradSort = useSortable(pitchers, "IP", "desc");
  const pitchingAdvSort = useSortable(pitchers, "stuff_plus", "desc");

  if (isLoading) return <div className="py-10 text-center text-sm text-white/40">Loading…</div>;
  if (!team) return <div className="py-10 text-center text-sm text-white/40">Team not found.</div>;

  return (
    <>
      {/* Team header */}
      <div className="border-l-[3px] px-6 py-5 mb-6" style={{ borderColor: GOLD, backgroundColor: NAVY_CARD }}>
        <div className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>
          {team.conference ?? "—"}
        </div>
        <h2 className="mt-1 font-[Oswald] text-3xl font-bold tracking-tight text-white">
          {team.fullName}
        </h2>
      </div>

      {/* Park Factors */}
      {pf && (
        <div className="mb-6">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Park Factors</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {([
              ["AVG", pf.avg],
              ["OBP", pf.obp],
              ["ISO", pf.iso],
              ["ERA (R/G)", pf.era],
              ["WHIP", pf.whip],
              ["HR/9", pf.hr9],
            ] as [string, number | null | undefined][]).map(([label, val]) => (
              <div key={label} className="border px-3 py-2" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
                <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">{label}</div>
                <div className="mt-0.5 font-[Oswald] text-lg font-bold tabular-nums" style={{ color: parkColor(val ?? null) }}>
                  {val != null ? val.toFixed(3) : "—"}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 text-[9px] text-white/30">
            &gt;1.000 = hitter friendly · &lt;1.000 = pitcher friendly
          </div>
        </div>
      )}

      {/* Outer tabs: Hitting / Pitching */}
      <div className="mb-4 flex gap-1">
        {(["hitting", "pitching"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setOuterTab(t); setInnerTab("traditional"); }}
            className="cursor-pointer border px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150"
            style={{
              borderColor: outerTab === t ? GOLD : NAVY_BORDER,
              color: outerTab === t ? GOLD : "rgba(255,255,255,0.45)",
              backgroundColor: outerTab === t ? "rgba(212,175,55,0.06)" : "transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Inner tabs: Traditional / Advanced */}
      <div className="mb-4 flex gap-1">
        {(["traditional", "advanced"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setInnerTab(t)}
            className="cursor-pointer border px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors duration-150"
            style={{
              borderColor: innerTab === t ? "rgba(212,175,55,0.4)" : NAVY_BORDER,
              color: innerTab === t ? GOLD : "rgba(255,255,255,0.35)",
              backgroundColor: innerTab === t ? "rgba(212,175,55,0.04)" : "transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tables */}
      {outerTab === "hitting" && innerTab === "traditional" && (
        <RosterTable
          rows={hittingTradSort.sorted}
          sortKey={hittingTradSort.sortKey}
          sortDir={hittingTradSort.sortDir}
          onSort={hittingTradSort.toggleSort}
          columns={[
            { field: "playerFullName", label: "Player", align: "left" as const, render: (r: any) => (
              <td key="name" className="px-3 py-2">
                <Link to={`/savant/hitter/${r.source_player_id}`} className="font-semibold text-white hover:text-[#D4AF37]">{r.playerFullName}</Link>
                <div className="text-[10px] text-white/40">{r.Pos ?? "—"}</div>
              </td>
            )},
            { field: "pa", label: "PA", fmt: fmtInt },
            { field: "AVG", label: "AVG", fmt: fmt3 },
            { field: "OBP", label: "OBP", fmt: fmt3 },
            { field: "SLG", label: "SLG", fmt: fmt3 },
            { field: "OPS", label: "OPS", fmt: fmt3 },
            { field: "ISO", label: "ISO", fmt: fmt3 },
          ]}
        />
      )}
      {outerTab === "hitting" && innerTab === "advanced" && (
        <RosterTable
          rows={hittingAdvSort.sorted}
          sortKey={hittingAdvSort.sortKey}
          sortDir={hittingAdvSort.sortDir}
          onSort={hittingAdvSort.toggleSort}
          columns={[
            { field: "playerFullName", label: "Player", align: "left" as const, render: (r: any) => (
              <td key="name" className="px-3 py-2">
                <Link to={`/savant/hitter/${r.source_player_id}`} className="font-semibold text-white hover:text-[#D4AF37]">{r.playerFullName}</Link>
                <div className="text-[10px] text-white/40">{r.Pos ?? "—"}</div>
              </td>
            )},
            { field: "avg_exit_velo", label: "EV", fmt: fmt1 },
            { field: "ev90", label: "EV90", fmt: fmt1 },
            { field: "barrel", label: "Barrel%", fmt: fmtPct },
            { field: "bb", label: "BB%", fmt: fmtPct },
            { field: "chase", label: "Chase%", fmt: fmtPct },
            { field: "contact", label: "Contact%", fmt: fmtPct },
            { field: "line_drive", label: "LD%", fmt: fmtPct },
            { field: "gb", label: "GB%", fmt: fmtPct },
            { field: "pull", label: "Pull%", fmt: fmtPct },
          ]}
        />
      )}
      {outerTab === "pitching" && innerTab === "traditional" && (
        <RosterTable
          rows={pitchingTradSort.sorted}
          sortKey={pitchingTradSort.sortKey}
          sortDir={pitchingTradSort.sortDir}
          onSort={pitchingTradSort.toggleSort}
          columns={[
            { field: "playerFullName", label: "Player", align: "left" as const, render: (r: any) => (
              <td key="name" className="px-3 py-2">
                <Link to={`/savant/pitcher/${r.source_player_id}`} className="font-semibold text-white hover:text-[#D4AF37]">{r.playerFullName}</Link>
                <div className="text-[10px] text-white/40">{r.Role ?? "P"}</div>
              </td>
            )},
            { field: "IP", label: "IP", fmt: fmt1 },
            { field: "ERA", label: "ERA", fmt: fmt2 },
            { field: "FIP", label: "FIP", fmt: fmt2 },
            { field: "WHIP", label: "WHIP", fmt: fmt2 },
            { field: "K9", label: "K/9", fmt: fmt1 },
            { field: "BB9", label: "BB/9", fmt: fmt1 },
            { field: "HR9", label: "HR/9", fmt: fmt2 },
          ]}
        />
      )}
      {outerTab === "pitching" && innerTab === "advanced" && (
        <RosterTable
          rows={pitchingAdvSort.sorted}
          sortKey={pitchingAdvSort.sortKey}
          sortDir={pitchingAdvSort.sortDir}
          onSort={pitchingAdvSort.toggleSort}
          columns={[
            { field: "playerFullName", label: "Player", align: "left" as const, render: (r: any) => (
              <td key="name" className="px-3 py-2">
                <Link to={`/savant/pitcher/${r.source_player_id}`} className="font-semibold text-white hover:text-[#D4AF37]">{r.playerFullName}</Link>
                <div className="text-[10px] text-white/40">{r.Role ?? "P"}</div>
              </td>
            )},
            { field: "miss_pct", label: "Whiff%", fmt: fmtPct },
            { field: "in_zone_whiff_pct", label: "IZ Whiff%", fmt: fmtPct },
            { field: "chase_pct", label: "Chase%", fmt: fmtPct },
            { field: "bb_pct", label: "BB%", fmt: fmtPct },
            { field: "hard_hit_pct", label: "HH%", fmt: fmtPct },
            { field: "barrel_pct", label: "Barrel%", fmt: fmtPct },
            { field: "exit_vel", label: "Exit Velo", fmt: fmt1 },
            { field: "ground_pct", label: "GB%", fmt: fmtPct },
            { field: "stuff_plus", label: "Stuff+", fmt: fmtInt },
          ]}
        />
      )}
    </>
  );
}

// ─── Generic roster table ───────────────────────────────────────────────────

interface ColDef {
  field: string;
  label: string;
  align?: "left" | "right";
  fmt?: (v: any) => string;
  render?: (row: any) => React.ReactNode;
}

function RosterTable({ rows, sortKey, sortDir, onSort, columns }: {
  rows: any[];
  sortKey: string;
  sortDir: string;
  onSort: (f: string) => void;
  columns: ColDef[];
}) {
  return (
    <div className="overflow-x-auto border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
      <table className="w-full text-sm text-white">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-white/50">
            {columns.map((col) => (
              <SortHeader
                key={col.field}
                label={col.label}
                field={col.field}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                align={col.align ?? "right"}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.source_player_id ?? i} className="border-t border-white/5 transition-colors hover:bg-white/[0.02]">
              {columns.map((col) =>
                col.render ? (
                  col.render(r)
                ) : (
                  <td key={col.field} className="px-3 py-2 text-right tabular-nums">
                    {col.fmt ? col.fmt(r[col.field]) : (r[col.field] ?? "—")}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-white/40">No players found for this team.</div>
      )}
    </div>
  );
}
