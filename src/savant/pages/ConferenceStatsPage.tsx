import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSortable, SortHeader, tierColor } from "@/savant/components/SortableTable";
import { NAVY_CARD, NAVY_BORDER, GOLD } from "@/savant/lib/theme";

const fmt3 = (v: number | null) => (v == null ? "—" : v.toFixed(3));
const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmtInt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);

interface ConfRow {
  "conference abbreviation": string;
  conference_id: string | null;
  season: number;
  AVG: number | null;
  OBP: number | null;
  SLG: number | null;
  OPS: number | null;
  ISO: number | null;
  avg_plus: number | null;
  obp_plus: number | null;
  slg_plus: number | null;
  ops_plus: number | null;
  iso_plus: number | null;
  wrc: number | null;
  WRC_plus: number | null;
  offensive_power_rating: number | null;
  power_rating_plus: number | null;
  barrel_score: number | null;
  chase_score: number | null;
  ev_score: number | null;
  whiff_score: number | null;
  ERA: number | null;
  FIP: number | null;
  WHIP: number | null;
  K9: number | null;
  BB9: number | null;
  HR9: number | null;
  Stuff_plus: number | null;
  Overall_Power_Rating: number | null;
}

// Flatten for sorting
function flatten(r: ConfRow) {
  return {
    conference: r["conference abbreviation"],
    avg: r.AVG, obp: r.OBP, slg: r.SLG, ops: r.OPS, iso: r.ISO,
    avg_plus: r.avg_plus, obp_plus: r.obp_plus, slg_plus: r.slg_plus, ops_plus: r.ops_plus, iso_plus: r.iso_plus,
    wrc: r.wrc, wrc_plus: r.WRC_plus,
    opr: r.offensive_power_rating, pr_plus: r.power_rating_plus,
    barrel: r.barrel_score, chase: r.chase_score, ev: r.ev_score, whiff: r.whiff_score,
    era: r.ERA, fip: r.FIP, whip: r.WHIP, k9: r.K9, bb9: r.BB9, hr9: r.HR9,
    stuff_plus: r.Stuff_plus, overall_pr: r.Overall_Power_Rating,
  };
}

type FlatRow = ReturnType<typeof flatten>;

export default function ConferenceStatsPage() {
  const [tab, setTab] = useState<"hitting" | "pitching">("hitting");

  const { data: rawRows = [], isLoading } = useQuery({
    queryKey: ["savant-conference-stats-raw", 2025],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Conference Stats")
        .select("*")
        .eq("season", 2025)
        .order("conference abbreviation");
      if (error) throw error;
      return (data || []) as ConfRow[];
    },
  });

  const flatRows = useMemo(() => rawRows.map(flatten), [rawRows]);
  const hittingSort = useSortable(flatRows, "wrc_plus", "desc");
  const pitchingSort = useSortable(flatRows, "stuff_plus", "desc");

  return (
    <>
      {/* Subtab toggle */}
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

      {isLoading ? (
        <div className="py-10 text-center text-sm text-white/40">Loading…</div>
      ) : tab === "hitting" ? (
        <HittingTable rows={hittingSort.sorted} sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
      ) : (
        <PitchingTable rows={pitchingSort.sorted} sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
      )}
    </>
  );
}

function HittingTable({ rows, sortKey, sortDir, onSort }: { rows: FlatRow[]; sortKey: string; sortDir: string; onSort: (f: string) => void }) {
  return (
    <div className="overflow-x-auto border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
      <table className="w-full text-sm text-white">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-white/50">
            <th className="cursor-pointer select-none px-4 py-2 text-left" onClick={() => onSort("conference")}>
              <span className={sortKey === "conference" ? "text-[#D4AF37]" : ""}>Conference</span>
            </th>
            <SortHeader label="AVG" field="avg" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="OBP" field="obp" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="SLG" field="slg" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="OPS" field="ops" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="ISO" field="iso" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="AVG+" field="avg_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="OBP+" field="obp_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="SLG+" field="slg_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="ISO+" field="iso_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="wRC+" field="wrc_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="OPR" field="opr" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="PR+" field="pr_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Barrel" field="barrel" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Chase" field="chase" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="EV" field="ev" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Whiff" field="whiff" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.conference} className="border-t border-white/5 transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-2 font-semibold">{r.conference}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt3(r.avg)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt3(r.obp)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt3(r.slg)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt3(r.ops)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt3(r.iso)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.avg_plus, 100, 8) }}>{fmtInt(r.avg_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.obp_plus, 100, 8) }}>{fmtInt(r.obp_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.slg_plus, 100, 8) }}>{fmtInt(r.slg_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.iso_plus, 100, 8) }}>{fmtInt(r.iso_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tierColor(r.wrc_plus, 100, 8) }}>{fmtInt(r.wrc_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.opr, 100, 8) }}>{fmtInt(r.opr)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.pr_plus, 100, 8) }}>{fmtInt(r.pr_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.barrel)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.chase)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.ev)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtInt(r.whiff)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PitchingTable({ rows, sortKey, sortDir, onSort }: { rows: FlatRow[]; sortKey: string; sortDir: string; onSort: (f: string) => void }) {
  return (
    <div className="overflow-x-auto border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
      <table className="w-full text-sm text-white">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-white/50">
            <th className="cursor-pointer select-none px-4 py-2 text-left" onClick={() => onSort("conference")}>
              <span className={sortKey === "conference" ? "text-[#D4AF37]" : ""}>Conference</span>
            </th>
            <SortHeader label="ERA" field="era" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="FIP" field="fip" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="WHIP" field="whip" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="K/9" field="k9" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="BB/9" field="bb9" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="HR/9" field="hr9" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Stuff+" field="stuff_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Overall PR" field="overall_pr" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.conference} className="border-t border-white/5 transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-2 font-semibold">{r.conference}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.era, 5.5, 1.0, true) }}>{fmt2(r.era)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.fip, 5.2, 0.8, true) }}>{fmt2(r.fip)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.whip, 1.45, 0.12, true) }}>{fmt2(r.whip)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.k9, 9.0, 1.0) }}>{fmt1(r.k9)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.bb9, 4.5, 0.6, true) }}>{fmt1(r.bb9)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.hr9, 0.8, 0.2, true) }}>{fmt2(r.hr9)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tierColor(r.stuff_plus, 100, 2) }}>{fmt1(r.stuff_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.overall_pr, 100, 8) }}>{fmtInt(r.overall_pr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
