import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTeamsTable } from "@/hooks/useTeamsTable";
import { NAVY_CARD, NAVY_BORDER, GOLD } from "@/savant/lib/theme";

export default function TeamsListPage() {
  const { teams, loading } = useTeamsTable();
  const [query, setQuery] = useState("");
  const [confFilter, setConfFilter] = useState("");

  const conferences = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) if (t.conference) set.add(t.conference);
    return [...set].sort();
  }, [teams]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return teams.filter((t) => {
      if (confFilter && t.conference !== confFilter) return false;
      if (q && !t.fullName.toLowerCase().includes(q) && !(t.abbreviation ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [teams, query, confFilter]);

  if (loading) return <div className="py-10 text-center text-sm text-white/40">Loading teams…</div>;

  return (
    <>
      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div
          className="flex items-center gap-2 border px-3 py-2"
          style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search teams…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-48 bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
          />
        </div>
        <select
          value={confFilter}
          onChange={(e) => setConfFilter(e.target.value)}
          className="cursor-pointer border bg-transparent px-3 py-2 text-sm text-white focus:outline-none"
          style={{ borderColor: NAVY_BORDER }}
        >
          <option value="">All Conferences</option>
          {conferences.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="text-xs text-white/40">{filtered.length} teams</span>
      </div>

      {/* Team grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((t) => (
          <Link
            key={t.id}
            to={`/savant/team/${t.id}`}
            className="group cursor-pointer border px-5 py-4 transition-all duration-150 hover:border-[#D4AF37]/40"
            style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
          >
            <div className="font-semibold text-white transition-colors group-hover:text-[#D4AF37]">
              {t.fullName}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-wider text-white/40">
              {t.conference ?? "—"}{t.abbreviation ? ` · ${t.abbreviation}` : ""}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
