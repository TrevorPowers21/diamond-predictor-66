import { useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useSavantHitters } from "@/savant/hooks/useSavantHitters";
import { useSavantPitchers } from "@/savant/hooks/useSavantPitchers";
import { NAVY_BG, NAVY_CARD, NAVY_BORDER, GOLD } from "@/savant/lib/theme";

const TABS = [
  { label: "Home", path: "/savant", exact: true },
  { label: "Leaderboards", path: "/savant/leaderboards" },
  { label: "Conference Stats", path: "/savant/conferences" },
  { label: "Teams", path: "/savant/teams", matchPrefix: "/savant/team" },
] as const;

export default function SavantLayout() {
  const location = useLocation();
  const [query, setQuery] = useState("");

  const { data: hitters = [] } = useSavantHitters();
  const { data: pitchers = [] } = useSavantPitchers();

  // ─── Search: hitters + pitchers ────────────────────────────────────────
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;

    const hitterResults = hitters
      .filter((h) => h.playerFullName.toLowerCase().includes(q) || (h.Team ?? "").toLowerCase().includes(q))
      .slice(0, 12)
      .map((h) => ({
        id: h.source_player_id,
        name: h.playerFullName,
        team: h.Team,
        meta: `${h.Pos ?? "—"} · ${h.pa ?? 0} PA`,
        type: "hitter" as const,
        href: `/savant/hitter/${h.source_player_id}`,
      }));

    const pitcherResults = pitchers
      .filter((p) => p.playerFullName.toLowerCase().includes(q) || (p.Team ?? "").toLowerCase().includes(q))
      .slice(0, 12)
      .map((p) => ({
        id: p.source_player_id,
        name: p.playerFullName,
        team: p.Team,
        meta: `${p.Role ?? "P"} · ${p.IP ?? 0} IP`,
        type: "pitcher" as const,
        href: `/savant/pitcher/${p.source_player_id}`,
      }));

    // Merge and dedupe by id, interleave hitters first
    const seen = new Set<string>();
    const merged: typeof hitterResults = [];
    for (const r of [...hitterResults, ...pitcherResults]) {
      if (r.id && !seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
    return merged.slice(0, 20);
  }, [hitters, pitchers, query]);

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: NAVY_BG }}>
      {/* Hero header */}
      <div
        style={{ background: "linear-gradient(180deg, #0a1428 0%, #040810 100%)" }}
      >
        <div className="mx-auto max-w-7xl px-6 pt-8 pb-4">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.3em]"
            style={{ color: GOLD }}
          >
            Internal · College Baseball Data Hub
          </div>
          <h1
            className="mt-2 font-[Oswald] text-5xl font-bold leading-none tracking-tight"
            style={{ color: "#FFFFFF", textShadow: "0 0 24px rgba(212,175,55,0.15)" }}
          >
            <Link to="/savant" className="transition-colors hover:text-[#E8C24E]">Savant</Link>
          </h1>

          {/* Search bar */}
          <div className="relative mt-5 max-w-2xl">
            <div
              className="group flex items-center gap-3 border px-4 py-3 transition-colors duration-200 focus-within:border-[#D4AF37]/60"
              style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search any player or team…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="cursor-pointer text-white/30 transition-colors hover:text-white/60"
                >
                  ✕
                </button>
              )}
            </div>
            {searchResults && searchResults.length > 0 && (
              <div
                className="absolute left-0 right-0 z-30 mt-1 max-h-80 overflow-y-auto border shadow-[0_12px_40px_-12px_rgba(0,0,0,0.7)]"
                style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
              >
                {searchResults.map((r) => (
                  <Link
                    key={r.id}
                    to={r.href}
                    onClick={() => setQuery("")}
                    className="flex items-center justify-between border-b px-4 py-2.5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
                    style={{ borderColor: NAVY_BORDER }}
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">{r.name}</div>
                      <div className="text-[10px] uppercase tracking-wider text-white/45">
                        {r.team ?? "—"} · {r.meta}
                      </div>
                    </div>
                    <span
                      className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                      style={{
                        color: r.type === "hitter" ? "#3b82f6" : "#22c55e",
                        backgroundColor: r.type === "hitter" ? "rgba(59,130,246,0.1)" : "rgba(34,197,94,0.1)",
                      }}
                    >
                      {r.type === "hitter" ? "HIT" : "PIT"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
            {searchResults && searchResults.length === 0 && (
              <div
                className="absolute left-0 right-0 z-30 mt-1 border px-4 py-3 text-xs text-white/40"
                style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
              >
                No players match.
              </div>
            )}
          </div>
        </div>

        {/* Tab bar */}
        <div className="border-b" style={{ borderColor: NAVY_BORDER }}>
          <div className="mx-auto max-w-7xl px-6">
            <nav className="flex gap-0">
              {TABS.map((tab) => {
                const isActive = tab.exact
                  ? location.pathname === tab.path
                  : location.pathname.startsWith(tab.path) ||
                    (tab.matchPrefix ? location.pathname.startsWith(tab.matchPrefix) : false);

                return (
                  <Link
                    key={tab.path}
                    to={tab.path}
                    className="relative cursor-pointer px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] transition-colors duration-150 hover:text-[#E8C24E]"
                    style={{
                      color: isActive ? GOLD : "rgba(255,255,255,0.45)",
                      fontFamily: "'Oswald', sans-serif",
                    }}
                  >
                    {tab.label}
                    {isActive && (
                      <span
                        className="absolute bottom-0 left-0 right-0 h-[2px]"
                        style={{ backgroundColor: GOLD }}
                      />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </div>

      {/* Page content */}
      <div className="mx-auto max-w-7xl px-6 py-6">
        <Outlet />
      </div>
    </div>
  );
}
