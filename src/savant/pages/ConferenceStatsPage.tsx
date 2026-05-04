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
  // Traditional output rates (SLG / OPS derived in flatten)
  AVG: number | null;
  OBP: number | null;
  ISO: number | null;
  ERA: number | null;
  FIP: number | null;
  WHIP: number | null;
  K9: number | null;
  BB9: number | null;
  HR9: number | null;
  Overall_Power_Rating: number | null;
  // Hitter raw scouting rates
  hitter_contact_pct: number | null;
  hitter_line_drive_pct: number | null;
  hitter_avg_ev: number | null;
  hitter_pop_up_pct: number | null;
  hitter_bb_pct: number | null;
  hitter_chase_pct: number | null;
  hitter_barrel_pct: number | null;
  hitter_ev90: number | null;
  hitter_pull_pct: number | null;
  hitter_la_10_30_pct: number | null;
  hitter_gb_pct: number | null;
  // Pitcher raw scouting rates
  pitcher_whiff_pct: number | null;
  pitcher_bb_pct: number | null;
  pitcher_hard_hit_pct: number | null;
  pitcher_iz_whiff_pct: number | null;
  pitcher_chase_pct: number | null;
  pitcher_barrel_pct: number | null;
  pitcher_line_drive_pct: number | null;
  pitcher_exit_velo: number | null;
  pitcher_ground_pct: number | null;
  pitcher_in_zone_pct: number | null;
  pitcher_ev90: number | null;
  pitcher_pull_pct: number | null;
  pitcher_la_10_30_pct: number | null;
  // Power Ratings
  ba_plus: number | null;
  obp_plus: number | null;
  iso_plus: number | null;
  offensive_power_rating: number | null;
  Stuff_plus: number | null;
  WRC_plus: number | null;
}

// wRC formula matches engine: 0.45·OBP + 0.30·SLG + 0.15·AVG + 0.10·ISO
function calcWrc(avg: number | null, obp: number | null, iso: number | null): number | null {
  if (avg == null || obp == null || iso == null) return null;
  const slg = avg + iso;
  return 0.45 * obp + 0.30 * slg + 0.15 * avg + 0.10 * iso;
}

// Pitching + : z-score against NCAA mean/sd, scaled by 20, anchored at 100.
// `higherIsBetter=false` for ERA/FIP/WHIP/BB9/HR9, true for K9.
function calcPitchingPlus(
  value: number | null,
  ncaaMean: number | null | undefined,
  ncaaSd: number | null | undefined,
  higherIsBetter: boolean,
): number | null {
  if (value == null || ncaaMean == null || ncaaSd == null || ncaaSd === 0) return null;
  const z = (value - ncaaMean) / ncaaSd;
  const scaled = z * 20;
  return higherIsBetter ? 100 + scaled : 100 - scaled;
}

function flatten(r: ConfRow, ncaaWrc: number | null, ncaa: any) {
  const wrc = calcWrc(r.AVG, r.OBP, r.ISO);
  const wrcPlus = wrc != null && ncaaWrc != null && ncaaWrc > 0
    ? Math.round((wrc / ncaaWrc) * 100)
    : null;

  const eraPlus = calcPitchingPlus(r.ERA, ncaa?.era, ncaa?.era_sd, false);
  const fipPlus = calcPitchingPlus(r.FIP, ncaa?.fip, ncaa?.fip_sd, false);
  const whipPlus = calcPitchingPlus(r.WHIP, ncaa?.whip, ncaa?.whip_sd, false);
  const k9Plus = calcPitchingPlus(r.K9, ncaa?.k9, ncaa?.k9_sd, true);
  const bb9Plus = calcPitchingPlus(r.BB9, ncaa?.bb9, ncaa?.bb9_sd, false);
  const hr9Plus = calcPitchingPlus(r.HR9, ncaa?.hr9, ncaa?.hr9_sd, false);

  // pRV+ = (0.3·ERA+ + 0.3·FIP+ + 0.3·WHIP+ + 0.4·K9+ + 0.3·BB9+ + 0.3·HR9+) / 1.9
  const prvPlus =
    eraPlus != null && fipPlus != null && whipPlus != null &&
    k9Plus != null && bb9Plus != null && hr9Plus != null
      ? Math.round(
          ((0.3 * eraPlus + 0.3 * fipPlus + 0.3 * whipPlus +
            0.4 * k9Plus + 0.3 * bb9Plus + 0.3 * hr9Plus) / 1.9) * 10,
        ) / 10
      : null;

  return {
    conference: r["conference abbreviation"],
    // Traditional output rates (SLG / OPS / wRC / wRC+ derived)
    avg: r.AVG,
    obp: r.OBP,
    slg: r.AVG != null && r.ISO != null ? Math.round((r.AVG + r.ISO) * 1000) / 1000 : null,
    ops: r.AVG != null && r.OBP != null && r.ISO != null
      ? Math.round((r.OBP + r.AVG + r.ISO) * 1000) / 1000
      : null,
    iso: r.ISO,
    wrc: wrc != null ? Math.round(wrc * 1000) / 1000 : null,
    era: r.ERA,
    fip: r.FIP,
    whip: r.WHIP,
    k9: r.K9,
    bb9: r.BB9,
    hr9: r.HR9,
    overall_pr: r.Overall_Power_Rating,
    // Hitter raw rates
    contact: r.hitter_contact_pct,
    ld: r.hitter_line_drive_pct,
    ev: r.hitter_avg_ev,
    popup: r.hitter_pop_up_pct,
    bb: r.hitter_bb_pct,
    chase: r.hitter_chase_pct,
    barrel: r.hitter_barrel_pct,
    ev90: r.hitter_ev90,
    pull: r.hitter_pull_pct,
    la: r.hitter_la_10_30_pct,
    gb: r.hitter_gb_pct,
    // Pitcher raw rates
    p_whiff: r.pitcher_whiff_pct,
    p_bb: r.pitcher_bb_pct,
    p_hh: r.pitcher_hard_hit_pct,
    p_iz_whiff: r.pitcher_iz_whiff_pct,
    p_chase: r.pitcher_chase_pct,
    p_barrel: r.pitcher_barrel_pct,
    p_ld: r.pitcher_line_drive_pct,
    p_ev: r.pitcher_exit_velo,
    p_gb: r.pitcher_ground_pct,
    p_iz: r.pitcher_in_zone_pct,
    p_ev90: r.pitcher_ev90,
    p_pull: r.pitcher_pull_pct,
    p_la: r.pitcher_la_10_30_pct,
    // Power Ratings
    ba_plus: r.ba_plus,
    obp_plus: r.obp_plus,
    iso_plus: r.iso_plus,
    opr: r.offensive_power_rating,
    stuff_plus: r.Stuff_plus,
    wrc_plus: wrcPlus,
    // Hitter Talent+ = OPR + 1.25·(Stuff+ − 100) + 0.75·(100 − wRC+)
    // Requires all three inputs; null if any missing.
    hitter_talent_plus:
      r.offensive_power_rating != null && r.Stuff_plus != null && wrcPlus != null
        ? Math.round(
            (r.offensive_power_rating + 1.25 * (r.Stuff_plus - 100) + 0.75 * (100 - wrcPlus)) * 10,
          ) / 10
        : null,
    // Pitching +s and pRV+ (auto-derived against NCAA mean/sd)
    era_plus: eraPlus != null ? Math.round(eraPlus) : null,
    fip_plus: fipPlus != null ? Math.round(fipPlus) : null,
    whip_plus: whipPlus != null ? Math.round(whipPlus) : null,
    k9_plus: k9Plus != null ? Math.round(k9Plus) : null,
    bb9_plus: bb9Plus != null ? Math.round(bb9Plus) : null,
    hr9_plus: hr9Plus != null ? Math.round(hr9Plus) : null,
    prv_plus: prvPlus,
  };
}

type FlatRow = ReturnType<typeof flatten>;

export default function ConferenceStatsPage() {
  const [outerTab, setOuterTab] = useState<"traditional" | "scouting">("scouting");
  const [tab, setTab] = useState<"hitting" | "pitching">("hitting");
  const [season, setSeason] = useState<number>(2026);

  const { data: rawRows = [], isLoading } = useQuery({
    queryKey: ["savant-conference-stats-raw", season],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("Conference Stats")
        .select("*")
        .eq("season", season)
        .order("conference abbreviation");
      if (error) throw error;
      return (data || []) as ConfRow[];
    },
  });

  const { data: ncaaRow } = useQuery({
    queryKey: ["savant-ncaa-averages", season],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ncaa_averages" as any)
        .select("*")
        .eq("season", season)
        .maybeSingle();
      if (error) return null;
      return data as any;
    },
  });

  const ncaaWrc = useMemo(() => {
    if (!ncaaRow) return null;
    return calcWrc(ncaaRow.avg, ncaaRow.obp, ncaaRow.iso);
  }, [ncaaRow]);

  const ncaaFlat = useMemo<FlatRow | null>(() => {
    if (!ncaaRow) return null;
    return {
      conference: "NCAA Avg",
      // Traditional outputs (SLG / OPS / wRC derived)
      avg: ncaaRow.avg,
      obp: ncaaRow.obp,
      slg: ncaaRow.avg != null && ncaaRow.iso != null
        ? Math.round((ncaaRow.avg + ncaaRow.iso) * 1000) / 1000
        : null,
      ops: ncaaRow.avg != null && ncaaRow.obp != null && ncaaRow.iso != null
        ? Math.round((ncaaRow.obp + ncaaRow.avg + ncaaRow.iso) * 1000) / 1000
        : null,
      iso: ncaaRow.iso,
      wrc: ncaaWrc != null ? Math.round(ncaaWrc * 1000) / 1000 : null,
      era: ncaaRow.era,
      fip: ncaaRow.fip,
      whip: ncaaRow.whip,
      k9: ncaaRow.k9,
      bb9: ncaaRow.bb9,
      hr9: ncaaRow.hr9,
      overall_pr: 100,
      // Hitter raw rates
      contact: ncaaRow.contact_pct,
      ld: ncaaRow.line_drive_pct,
      ev: ncaaRow.exit_velo,
      popup: ncaaRow.pop_up_pct,
      bb: ncaaRow.bb_pct,
      chase: ncaaRow.chase_pct,
      barrel: ncaaRow.barrel_pct,
      ev90: ncaaRow.ev90,
      pull: ncaaRow.pull_pct,
      la: ncaaRow.la_10_30_pct,
      gb: ncaaRow.ground_pct,
      p_whiff: ncaaRow.pitcher_whiff_pct,
      p_bb: ncaaRow.pitcher_bb_pct,
      p_hh: ncaaRow.pitcher_hard_hit_pct,
      p_iz_whiff: ncaaRow.pitcher_iz_whiff_pct,
      p_chase: ncaaRow.pitcher_chase_pct,
      p_barrel: ncaaRow.pitcher_barrel_pct,
      p_ld: ncaaRow.pitcher_line_drive_pct,
      p_ev: ncaaRow.pitcher_exit_velo,
      p_gb: ncaaRow.pitcher_ground_pct,
      p_iz: ncaaRow.pitcher_in_zone_pct,
      p_ev90: ncaaRow.pitcher_ev90,
      p_pull: ncaaRow.pitcher_pull_pct,
      p_la: ncaaRow.pitcher_la_10_30_pct,
      ba_plus: 100,
      obp_plus: 100,
      iso_plus: 100,
      opr: 100,
      stuff_plus: 100,
      wrc_plus: 100,
      hitter_talent_plus: 100, // by definition (OPR=100, Stuff+=100, wRC+=100)
      era_plus: 100,
      fip_plus: 100,
      whip_plus: 100,
      k9_plus: 100,
      bb9_plus: 100,
      hr9_plus: 100,
      prv_plus: 100, // by definition
    };
  }, [ncaaRow, ncaaWrc]);

  const flatRows = useMemo(
    () => rawRows.map((r) => flatten(r, ncaaWrc, ncaaRow)),
    [rawRows, ncaaWrc, ncaaRow],
  );
  const hittingSort = useSortable(flatRows, "wrc_plus", "desc");
  const pitchingSort = useSortable(flatRows, "stuff_plus", "desc");

  return (
    <>
      {/* Outer tabs: Traditional | Scouting */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(["traditional", "scouting"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOuterTab(t)}
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
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">Season</span>
          <select
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            className="cursor-pointer border bg-transparent px-3 py-2 text-sm text-white focus:outline-none"
            style={{ borderColor: NAVY_BORDER }}
          >
            {[2026, 2025, 2024, 2023, 2022].map((y) => (
              <option key={y} value={y} className="bg-[#0a1428]">{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Inner tabs: Hitting | Pitching */}
      <div className="mb-6 flex gap-1">
        {(["hitting", "pitching"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="cursor-pointer border px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] transition-colors duration-150"
            style={{
              borderColor: tab === t ? "rgba(212,175,55,0.5)" : NAVY_BORDER,
              color: tab === t ? "rgba(212,175,55,0.9)" : "rgba(255,255,255,0.4)",
              backgroundColor: tab === t ? "rgba(212,175,55,0.04)" : "transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-white/40">Loading…</div>
      ) : outerTab === "traditional" && tab === "hitting" ? (
        <TraditionalHittingTable rows={hittingSort.sorted} ncaaRow={ncaaFlat} sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
      ) : outerTab === "traditional" && tab === "pitching" ? (
        <TraditionalPitchingTable rows={pitchingSort.sorted} ncaaRow={ncaaFlat} sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
      ) : tab === "hitting" ? (
        <HittingTable rows={hittingSort.sorted} ncaaRow={ncaaFlat} sortKey={hittingSort.sortKey} sortDir={hittingSort.sortDir} onSort={hittingSort.toggleSort} />
      ) : (
        <PitchingTable rows={pitchingSort.sorted} ncaaRow={ncaaFlat} sortKey={pitchingSort.sortKey} sortDir={pitchingSort.sortDir} onSort={pitchingSort.toggleSort} />
      )}
    </>
  );
}

function TraditionalHittingTable({ rows, ncaaRow, sortKey, sortDir, onSort }: { rows: FlatRow[]; ncaaRow: FlatRow | null; sortKey: string; sortDir: string; onSort: (f: string) => void }) {
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
            <SortHeader label="wRC+" field="wrc_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
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
              <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tierColor(r.wrc_plus, 100, 8) }}>{fmtInt(r.wrc_plus)}</td>
            </tr>
          ))}
          {ncaaRow && (
            <tr className="border-t-2 bg-[#D4AF37]/[0.06]" style={{ borderColor: GOLD }}>
              <td className="px-4 py-2 font-bold" style={{ color: GOLD }}>{ncaaRow.conference}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt3(ncaaRow.avg)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt3(ncaaRow.obp)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt3(ncaaRow.slg)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt3(ncaaRow.ops)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt3(ncaaRow.iso)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function TraditionalPitchingTable({ rows, ncaaRow, sortKey, sortDir, onSort }: { rows: FlatRow[]; ncaaRow: FlatRow | null; sortKey: string; sortDir: string; onSort: (f: string) => void }) {
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
            <SortHeader label="ERA+" field="era_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="FIP+" field="fip_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="WHIP+" field="whip_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="K/9+" field="k9_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="BB/9+" field="bb9_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="HR/9+" field="hr9_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Stuff+" field="stuff_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="pRV+" field="prv_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
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
              <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: tierColor(r.era_plus, 100, 5) }}>{fmtInt(r.era_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: tierColor(r.fip_plus, 100, 5) }}>{fmtInt(r.fip_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: tierColor(r.whip_plus, 100, 5) }}>{fmtInt(r.whip_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: tierColor(r.k9_plus, 100, 5) }}>{fmtInt(r.k9_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: tierColor(r.bb9_plus, 100, 5) }}>{fmtInt(r.bb9_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: tierColor(r.hr9_plus, 100, 5) }}>{fmtInt(r.hr9_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tierColor(r.stuff_plus, 100, 2) }}>{fmt1(r.stuff_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tierColor(r.prv_plus, 100, 4) }}>{fmt1(r.prv_plus)}</td>
            </tr>
          ))}
          {ncaaRow && (
            <tr className="border-t-2 bg-[#D4AF37]/[0.06]" style={{ borderColor: GOLD }}>
              <td className="px-4 py-2 font-bold" style={{ color: GOLD }}>{ncaaRow.conference}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt2(ncaaRow.era)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt2(ncaaRow.fip)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt2(ncaaRow.whip)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.k9)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.bb9)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt2(ncaaRow.hr9)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function HittingTable({ rows, ncaaRow, sortKey, sortDir, onSort }: { rows: FlatRow[]; ncaaRow: FlatRow | null; sortKey: string; sortDir: string; onSort: (f: string) => void }) {
  return (
    <div className="overflow-x-auto border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
      <table className="w-full text-sm text-white">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-white/50">
            <th className="cursor-pointer select-none px-4 py-2 text-left" onClick={() => onSort("conference")}>
              <span className={sortKey === "conference" ? "text-[#D4AF37]" : ""}>Conference</span>
            </th>
            <SortHeader label="Contact%" field="contact" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="LD%" field="ld" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="EV" field="ev" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Popup%" field="popup" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="BB%" field="bb" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Chase%" field="chase" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Barrel%" field="barrel" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="EV90" field="ev90" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Pull%" field="pull" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="LA10-30%" field="la" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="GB%" field="gb" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="BA+" field="ba_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="OBP+" field="obp_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="ISO+" field="iso_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Overall PR" field="opr" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Hitter Talent+" field="hitter_talent_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.conference} className="border-t border-white/5 transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-2 font-semibold">{r.conference}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.contact)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.ld)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.ev)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.popup)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.bb)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.chase)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.barrel)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.ev90)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.pull)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.la)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.gb)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: tierColor(r.ba_plus, 100, 8) }}>{fmtInt(r.ba_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: tierColor(r.obp_plus, 100, 8) }}>{fmtInt(r.obp_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: tierColor(r.iso_plus, 100, 8) }}>{fmtInt(r.iso_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: tierColor(r.opr, 100, 8) }}>{fmtInt(r.opr)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tierColor(r.hitter_talent_plus, 100, 8) }}>{fmtInt(r.hitter_talent_plus)}</td>
            </tr>
          ))}
          {ncaaRow && (
            <tr className="border-t-2 bg-[#D4AF37]/[0.06]" style={{ borderColor: GOLD }}>
              <td className="px-4 py-2 font-bold" style={{ color: GOLD }}>{ncaaRow.conference}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.contact)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.ld)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.ev)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.popup)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.bb)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.chase)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.barrel)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.ev90)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.pull)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.la)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.gb)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function PitchingTable({ rows, ncaaRow, sortKey, sortDir, onSort }: { rows: FlatRow[]; ncaaRow: FlatRow | null; sortKey: string; sortDir: string; onSort: (f: string) => void }) {
  return (
    <div className="overflow-x-auto border" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
      <table className="w-full text-sm text-white">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-white/50">
            <th className="cursor-pointer select-none px-4 py-2 text-left" onClick={() => onSort("conference")}>
              <span className={sortKey === "conference" ? "text-[#D4AF37]" : ""}>Conference</span>
            </th>
            <SortHeader label="Whiff%" field="p_whiff" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="BB%" field="p_bb" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="HH%" field="p_hh" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="IZ Whiff%" field="p_iz_whiff" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Chase%" field="p_chase" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Barrel%" field="p_barrel" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="LD%" field="p_ld" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="EV" field="p_ev" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="GB%" field="p_gb" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="IZ%" field="p_iz" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="EV90" field="p_ev90" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Pull%" field="p_pull" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="LA10-30%" field="p_la" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="Stuff+" field="stuff_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.conference} className="border-t border-white/5 transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-2 font-semibold">{r.conference}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_whiff)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_bb)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_hh)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_iz_whiff)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_chase)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_barrel)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_ld)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_ev)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_gb)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_iz)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_ev90)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_pull)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmt1(r.p_la)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tierColor(r.stuff_plus, 100, 2) }}>{fmt1(r.stuff_plus)}</td>
            </tr>
          ))}
          {ncaaRow && (
            <tr className="border-t-2 bg-[#D4AF37]/[0.06]" style={{ borderColor: GOLD }}>
              <td className="px-4 py-2 font-bold" style={{ color: GOLD }}>{ncaaRow.conference}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_whiff)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_bb)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_hh)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_iz_whiff)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_chase)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_barrel)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_ld)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_ev)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_gb)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_iz)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_ev90)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_pull)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-white/80">{fmt1(ncaaRow.p_la)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold text-white/80">100</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
