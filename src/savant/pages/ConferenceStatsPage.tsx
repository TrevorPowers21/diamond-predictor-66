import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useConferenceStats } from "@/hooks/useConferenceStats";

const NAVY_BG = "#040810";
const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

const fmt2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));
const fmt1 = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const fmtInt = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);

type SortKey = string;
type SortDir = "asc" | "desc";

function tierColor(value: number | null, avg: number, sd: number, invert = false): string {
  if (value == null) return "";
  const z = (value - avg) / sd;
  const adj = invert ? -z : z;
  if (adj >= 1.5) return "#22c55e";
  if (adj >= 0.75) return "#3b82f6";
  if (adj >= -0.75) return "#ffffff";
  if (adj >= -1.5) return "#eab308";
  return "#ef4444";
}

function useSortable<T>(data: T[], defaultKey: SortKey, defaultDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<SortKey>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = (a as any)[sortKey];
      const bv = (b as any)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggleSort };
}

function SortHeader({ label, field, sortKey, sortDir, onSort }: {
  label: string; field: string; sortKey: string; sortDir: string; onSort: (f: string) => void;
}) {
  const active = sortKey === field;
  return (
    <th
      className="cursor-pointer select-none px-3 py-2 text-right transition-colors hover:text-[#D4AF37]"
      onClick={() => onSort(field)}
    >
      <span className={active ? "text-[#D4AF37]" : ""}>{label}</span>
      {active && <span className="ml-0.5 text-[9px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

// ─── Stat averages/SDs for tier coloring (approximate NCAA D1) ──────────

const HITTING_TIERS = {
  avg: { avg: 0.275, sd: 0.015 },
  obp: { avg: 0.370, sd: 0.020 },
  iso: { avg: 0.130, sd: 0.025 },
  wrc_plus: { avg: 100, sd: 8 },
};

const PITCHING_TIERS = {
  era: { avg: 5.50, sd: 1.0, invert: true },
  fip: { avg: 5.20, sd: 0.8, invert: true },
  whip: { avg: 1.45, sd: 0.12, invert: true },
  k9: { avg: 9.0, sd: 1.0 },
  bb9: { avg: 4.5, sd: 0.6, invert: true },
  hr9: { avg: 0.80, sd: 0.20, invert: true },
  stuff_plus: { avg: 100, sd: 2 },
};

export default function ConferenceStatsPage() {
  const [tab, setTab] = useState<"hitting" | "pitching">("hitting");
  const { conferenceStats, loading } = useConferenceStats(2025);

  const hittingSort = useSortable(conferenceStats, "wrc_plus", "desc");
  const pitchingSort = useSortable(conferenceStats, "stuff_plus", "desc");

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: NAVY_BG }}>
      {/* Header */}
      <div
        className="border-b"
        style={{ borderColor: NAVY_BORDER, background: "linear-gradient(180deg, #0a1428 0%, #040810 100%)" }}
      >
        <div className="mx-auto max-w-7xl px-6 py-10">
          <Link
            to="/savant"
            className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.25em] text-[#D4AF37] transition-colors hover:text-[#E8C24E]"
          >
            ← Savant
          </Link>
          <h1
            className="mt-3 font-[Oswald] text-4xl font-bold leading-none tracking-tight"
            style={{ color: "#FFFFFF", textShadow: "0 0 16px rgba(212,175,55,0.08)" }}
          >
            Conference Stats
          </h1>
          <p className="mt-2 text-sm text-white/55">2025 NCAA D1 conference averages — color-coded by tier</p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Tab toggle */}
        <div className="mb-6 flex gap-1">
          {(["hitting", "pitching"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="cursor-pointer border px-5 py-2 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150"
              style={{
                borderColor: tab === t ? GOLD : NAVY_BORDER,
                color: tab === t ? GOLD : "rgba(255,255,255,0.5)",
                backgroundColor: tab === t ? "rgba(212,175,55,0.06)" : "transparent",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-white/40">Loading…</div>
        ) : tab === "hitting" ? (
          <HittingTable
            rows={hittingSort.sorted}
            sortKey={hittingSort.sortKey}
            sortDir={hittingSort.sortDir}
            onSort={hittingSort.toggleSort}
          />
        ) : (
          <PitchingTable
            rows={pitchingSort.sorted}
            sortKey={pitchingSort.sortKey}
            sortDir={pitchingSort.sortDir}
            onSort={pitchingSort.toggleSort}
          />
        )}
      </div>
    </div>
  );
}

// ─── Hitting Table ──────────────────────────────────────────────────────────

function HittingTable({ rows, sortKey, sortDir, onSort }: {
  rows: ReturnType<typeof useConferenceStats>["conferenceStats"];
  sortKey: string; sortDir: string; onSort: (f: string) => void;
}) {
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
            <SortHeader label="ISO" field="iso" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="wRC+" field="wrc_plus" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortHeader label="PR+" field="overall_power_rating" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.conference} className="border-t border-white/5 transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-2 font-semibold">{r.conference}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.avg, HITTING_TIERS.avg.avg, HITTING_TIERS.avg.sd) }}>{r.avg != null ? r.avg.toFixed(3) : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.obp, HITTING_TIERS.obp.avg, HITTING_TIERS.obp.sd) }}>{r.obp != null ? r.obp.toFixed(3) : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.iso, HITTING_TIERS.iso.avg, HITTING_TIERS.iso.sd) }}>{r.iso != null ? r.iso.toFixed(3) : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tierColor(r.wrc_plus, HITTING_TIERS.wrc_plus.avg, HITTING_TIERS.wrc_plus.sd) }}>{fmtInt(r.wrc_plus)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.overall_power_rating, 100, 8) }}>{fmtInt(r.overall_power_rating)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pitching Table ─────────────────────────────────────────────────────────

function PitchingTable({ rows, sortKey, sortDir, onSort }: {
  rows: ReturnType<typeof useConferenceStats>["conferenceStats"];
  sortKey: string; sortDir: string; onSort: (f: string) => void;
}) {
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.conference} className="border-t border-white/5 transition-colors hover:bg-white/[0.02]">
              <td className="px-4 py-2 font-semibold">{r.conference}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.era, PITCHING_TIERS.era.avg, PITCHING_TIERS.era.sd, true) }}>{fmt2(r.era)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.fip, PITCHING_TIERS.fip.avg, PITCHING_TIERS.fip.sd, true) }}>{fmt2(r.fip)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.whip, PITCHING_TIERS.whip.avg, PITCHING_TIERS.whip.sd, true) }}>{fmt2(r.whip)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.k9, PITCHING_TIERS.k9.avg, PITCHING_TIERS.k9.sd) }}>{fmt1(r.k9)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.bb9, PITCHING_TIERS.bb9.avg, PITCHING_TIERS.bb9.sd, true) }}>{fmt1(r.bb9)}</td>
              <td className="px-3 py-2 text-right tabular-nums" style={{ color: tierColor(r.hr9, PITCHING_TIERS.hr9.avg, PITCHING_TIERS.hr9.sd, true) }}>{fmt2(r.hr9)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold" style={{ color: tierColor(r.stuff_plus, PITCHING_TIERS.stuff_plus.avg, PITCHING_TIERS.stuff_plus.sd) }}>{fmt1(r.stuff_plus)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
