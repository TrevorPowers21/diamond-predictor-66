import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTeamRoster } from "@/savant/hooks/useTeamRoster";
import { useParkFactors } from "@/hooks/useParkFactors";
import { useSortable, SortHeader, tierColor } from "@/savant/components/SortableTable";
import { NAVY_CARD, NAVY_BORDER, GOLD } from "@/savant/lib/theme";
import { computeOWarFromStats, computePWar } from "@/savant/lib/war";
import { computePrvPlus } from "@/savant/lib/prvPlus";
import { computeWrcPlus } from "@/savant/lib/wrcPlus";

const fmt3 = (v: number | null) => (v == null ? "—" : v.toFixed(3));
const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const fmtInt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);

/** Normalize park factor to 100-based scale */
function parkNormalize(v: number | null): number | null {
  if (v == null) return null;
  // If stored as decimal (0.95, 1.05), convert to 100-based
  return Math.abs(v) <= 3 ? v * 100 : v;
}

/** Hitting park factors (AVG, OBP, ISO): >100 = green (boosts hitters), <100 = red (suppresses hitters) */
function parkColorHitting(v: number | null): string {
  const n = parkNormalize(v);
  if (n == null) return "";
  const diff = n - 100;
  if (Math.abs(diff) < 0.5) return "#ffffff";
  return diff > 0 ? "#22c55e" : "#ef4444";
}

/** Pitching park factors (ERA, WHIP, HR/9): >100 = red (inflates runs), <100 = green (suppresses runs) */
function parkColorPitching(v: number | null): string {
  const n = parkNormalize(v);
  if (n == null) return "";
  const diff = n - 100;
  if (Math.abs(diff) < 0.5) return "#ffffff";
  return diff > 0 ? "#ef4444" : "#22c55e";
}

export default function TeamProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { team, hitters, pitchers, isLoading } = useTeamRoster(id);
  const { parkMap } = useParkFactors(2026);

  const [outerTab, setOuterTab] = useState<"hitting" | "pitching">("hitting");
  const [innerTab, setInnerTab] = useState<"traditional" | "advanced">("traditional");

  // Park factors lookup
  const pf = useMemo(() => {
    if (!team) return null;
    return parkMap.byTeamId[team.id] ?? parkMap.byName[team.fullName?.toLowerCase().trim() ?? ""] ?? null;
  }, [team, parkMap]);

  // Enrich hitters with computed OPS, wRC+, oWAR
  const enrichedHitters = useMemo(() => hitters.map((h: any) => {
    const ops = (h.OBP != null && h.SLG != null) ? h.OBP + h.SLG : null;
    const wrcPlus = computeWrcPlus(h.AVG, h.OBP, h.SLG, h.ISO);
    return {
      ...h,
      OPS: ops,
      wrc_plus: wrcPlus,
      owar: computeOWarFromStats(h.AVG, h.OBP, h.SLG, h.ISO, h.pa),
    };
  }), [hitters]);

  // Enrich pitchers with computed pWAR
  const enrichedPitchers = useMemo(() => pitchers.map((p: any) => {
    const prvPlus = computePrvPlus(
      p.era_pr_plus, p.fip_pr_plus, p.whip_pr_plus,
      p.k9_pr_plus, p.bb9_pr_plus, p.hr9_pr_plus,
    );
    return { ...p, pwar: computePWar(prvPlus, p.IP), prv_plus: prvPlus };
  }), [pitchers]);

  const hittingTradSort = useSortable(enrichedHitters, "pa", "desc");
  const hittingAdvSort = useSortable(enrichedHitters, "avg_exit_velo", "desc");
  const pitchingTradSort = useSortable(enrichedPitchers, "IP", "desc");
  const pitchingAdvSort = useSortable(enrichedPitchers, "stuff_plus", "desc");

  // Team totals
  const totalOWar = useMemo(() => {
    const valid = enrichedHitters.filter((h: any) => h.owar != null);
    return valid.length > 0 ? valid.reduce((s: number, h: any) => s + h.owar, 0) : null;
  }, [enrichedHitters]);

  const totalPWar = useMemo(() => {
    const valid = enrichedPitchers.filter((p: any) => p.pwar != null);
    return valid.length > 0 ? valid.reduce((s: number, p: any) => s + p.pwar, 0) : null;
  }, [enrichedPitchers]);

  const totalWar = (totalOWar ?? 0) + (totalPWar ?? 0);

  // PA-weighted hitting aggregates
  const teamHitting = useMemo(() => {
    const rows = enrichedHitters.filter((h: any) => (h.pa ?? 0) > 0);
    if (rows.length === 0) return null;
    const totalPa = rows.reduce((s: number, h: any) => s + (h.pa ?? 0), 0);
    const wAvg = (field: string) => {
      let sv = 0, sw = 0;
      for (const h of rows) { const v = Number(h[field]); const w = h.pa ?? 0; if (Number.isFinite(v) && w > 0) { sv += v * w; sw += w; } }
      return sw > 0 ? sv / sw : null;
    };
    return {
      avg: wAvg("AVG"), obp: wAvg("OBP"), slg: wAvg("SLG"),
      ops: wAvg("OPS"), wrc_plus: wAvg("wrc_plus"),
      ev: wAvg("avg_exit_velo"), barrel: wAvg("barrel"),
      totalPa,
    };
  }, [enrichedHitters]);

  // IP-weighted pitching aggregates
  const teamPitching = useMemo(() => {
    const rows = enrichedPitchers.filter((p: any) => (p.IP ?? 0) > 0);
    if (rows.length === 0) return null;
    const totalIp = rows.reduce((s: number, p: any) => s + (p.IP ?? 0), 0);
    const wAvg = (field: string) => {
      let sv = 0, sw = 0;
      for (const p of rows) { const v = Number(p[field]); const w = p.IP ?? 0; if (Number.isFinite(v) && w > 0) { sv += v * w; sw += w; } }
      return sw > 0 ? sv / sw : null;
    };
    return {
      era: wAvg("ERA"), fip: wAvg("FIP"), whip: wAvg("WHIP"),
      k9: wAvg("K9"), bb9: wAvg("BB9"), stuff_plus: wAvg("stuff_plus"),
      totalIp,
    };
  }, [enrichedPitchers]);

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

      {/* Team Information */}
      <div className="mb-6">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Team Information</div>

        {/* WAR row */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">Total oWAR</div>
            <div className="mt-1 font-[Oswald] text-2xl font-bold tabular-nums" style={{ color: GOLD }}>
              {totalOWar != null ? totalOWar.toFixed(1) : "—"}
            </div>
          </div>
          <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">Total pWAR</div>
            <div className="mt-1 font-[Oswald] text-2xl font-bold tabular-nums" style={{ color: GOLD }}>
              {totalPWar != null ? totalPWar.toFixed(1) : "—"}
            </div>
          </div>
          <div className="border px-4 py-3" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
            <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">Total WAR</div>
            <div className="mt-1 font-[Oswald] text-2xl font-bold tabular-nums" style={{ color: GOLD }}>
              {totalWar.toFixed(1)}
            </div>
          </div>
        </div>

        {/* Hitting aggregates */}
        {teamHitting && (
          <div className="mb-3">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-white/30">Hitting</div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {([
                ["AVG", teamHitting.avg, fmt3],
                ["OBP", teamHitting.obp, fmt3],
                ["SLG", teamHitting.slg, fmt3],
                ["OPS", teamHitting.ops, fmt3],
                ["wRC+", teamHitting.wrc_plus, fmtInt],
                ["Avg EV", teamHitting.ev, fmt1],
                ["Barrel%", teamHitting.barrel, fmtPct],
              ] as [string, number | null, (v: number | null) => string][]).map(([label, val, formatter]) => (
                <div key={label} className="border px-3 py-2" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">{label}</div>
                  <div className="mt-0.5 font-[Oswald] text-lg font-bold tabular-nums text-white">{formatter(val)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pitching aggregates */}
        {teamPitching && (
          <div className="mb-3">
            <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-white/30">Pitching</div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {([
                ["ERA", teamPitching.era, fmt2],
                ["FIP", teamPitching.fip, fmt2],
                ["WHIP", teamPitching.whip, fmt2],
                ["K/9", teamPitching.k9, fmt1],
                ["BB/9", teamPitching.bb9, fmt1],
                ["Stuff+", teamPitching.stuff_plus, fmtInt],
              ] as [string, number | null, (v: number | null) => string][]).map(([label, val, formatter]) => (
                <div key={label} className="border px-3 py-2" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">{label}</div>
                  <div className="mt-0.5 font-[Oswald] text-lg font-bold tabular-nums text-white">{formatter(val)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Park Factors */}
      {pf && (
        <div className="mb-6">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Park Factors</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {([
              ["AVG", pf.avg, "hit"],
              ["OBP", pf.obp, "hit"],
              ["ISO", pf.iso, "hit"],
              ["ERA (R/G)", pf.era, "pitch"],
              ["WHIP", pf.whip, "pitch"],
              ["HR/9", pf.hr9, "pitch"],
            ] as [string, number | null | undefined, string][]).map(([label, val, type]) => (
              <div key={label} className="border px-3 py-2" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
                <div className="text-[9px] font-bold uppercase tracking-wider text-white/40">{label}</div>
                <div className="mt-0.5 font-[Oswald] text-lg font-bold tabular-nums" style={{ color: type === "hit" ? parkColorHitting(val ?? null) : parkColorPitching(val ?? null) }}>
                  {val != null ? (parkNormalize(val) ?? val).toFixed(1) : "—"}
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
            { field: "wrc_plus", label: "wRC+", fmt: fmtInt },
            { field: "owar", label: "oWAR", fmt: fmt1 },
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
          weightField="IP"
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
            { field: "prv_plus", label: "pRV+", fmt: fmtInt },
            { field: "pwar", label: "pWAR", fmt: fmt1 },
          ]}
        />
      )}
      {outerTab === "pitching" && innerTab === "advanced" && (
        <RosterTable
          rows={pitchingAdvSort.sorted}
          sortKey={pitchingAdvSort.sortKey}
          sortDir={pitchingAdvSort.sortDir}
          onSort={pitchingAdvSort.toggleSort}
          weightField="IP"
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

function RosterTable({ rows, sortKey, sortDir, onSort, columns, weightField = "pa" }: {
  rows: any[];
  sortKey: string;
  sortDir: string;
  onSort: (f: string) => void;
  columns: ColDef[];
  weightField?: string;
}) {
  // Compute usage-weighted team averages
  const teamAvg = useMemo(() => {
    if (rows.length === 0) return null;
    const totalWeight = rows.reduce((s, r) => s + (Number(r[weightField]) || 0), 0);
    if (totalWeight === 0) return null;

    const avg: Record<string, number | null> = {};
    for (const col of columns) {
      if (col.render || col.field === "playerFullName") {
        avg[col.field] = null;
        continue;
      }
      // Sum weighted values
      let sumWV = 0;
      let sumW = 0;
      for (const r of rows) {
        const v = Number(r[col.field]);
        const w = Number(r[weightField]) || 0;
        if (!Number.isFinite(v) || w === 0) continue;
        sumWV += v * w;
        sumW += w;
      }
      avg[col.field] = sumW > 0 ? sumWV / sumW : null;
    }
    // Special: weight field itself is a sum not average
    avg[weightField] = totalWeight;
    return avg;
  }, [rows, columns, weightField]);

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
          {/* Team average row — bottom */}
          {teamAvg && (
            <tr className="border-t-2" style={{ borderColor: GOLD, backgroundColor: "rgba(212,175,55,0.04)" }}>
              {columns.map((col) =>
                col.render ? (
                  <td key={col.field} className="px-3 py-2 font-bold" style={{ color: GOLD }}>
                    Team Avg
                  </td>
                ) : (
                  <td key={col.field} className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: GOLD }}>
                    {teamAvg[col.field] != null && col.fmt ? col.fmt(teamAvg[col.field]) : "—"}
                  </td>
                ),
              )}
            </tr>
          )}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="px-4 py-6 text-center text-xs text-white/40">No players found for this team.</div>
      )}
    </div>
  );
}
