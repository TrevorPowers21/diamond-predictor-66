import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSavantHitters, SAVANT_MIN_AB } from "@/savant/hooks/useSavantHitters";
import { useSavantPitchers, SAVANT_MIN_IP } from "@/savant/hooks/useSavantPitchers";
import LeaderboardCard, { type LeaderboardEntry } from "@/savant/components/LeaderboardCard";
import ReclassificationRunner from "@/savant/components/ReclassificationRunner";
import VeloDiffRunner from "@/savant/components/VeloDiffRunner";
import StuffPlusRunner from "@/savant/components/StuffPlusRunner";
import ConferenceStuffPlusRunner from "@/savant/components/ConferenceStuffPlusRunner";

const NAVY_BG = "#040810";
const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#162241";
const GOLD = "#D4AF37";

const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmt1 = (v: number) => v.toFixed(1);
const fmtInt = (v: number) => `${Math.round(v)}`;

export default function SavantIndex() {
  const { data: hitters = [], isLoading: hLoading } = useSavantHitters();
  const { data: pitchers = [], isLoading: pLoading } = useSavantPitchers();
  const [query, setQuery] = useState("");

  // ─── Build leaderboard entries ───
  const qualifiedHitters = useMemo(
    () => hitters.filter((h) => (h.ab ?? 0) >= SAVANT_MIN_AB),
    [hitters],
  );
  const qualifiedPitchers = useMemo(
    () => pitchers.filter((p) => (p.IP ?? 0) >= SAVANT_MIN_IP),
    [pitchers],
  );

  const toHitterEntry = (h: typeof qualifiedHitters[number], value: number | null): LeaderboardEntry => ({
    id: h.source_player_id,
    name: h.playerFullName,
    team: h.Team,
    value,
    href: h.source_player_id ? `/savant/hitter/${h.source_player_id}` : null,
  });

  const toPitcherEntry = (p: typeof qualifiedPitchers[number], value: number | null): LeaderboardEntry => ({
    id: p.source_player_id,
    name: p.playerFullName,
    team: p.Team,
    value,
    href: p.source_player_id ? `/savant/pitcher/${p.source_player_id}` : null,
  });

  const barrelEntries = useMemo(
    () => qualifiedHitters.map((h) => toHitterEntry(h, h.barrel)),
    [qualifiedHitters],
  );
  const exitVeloEntries = useMemo(
    () => qualifiedHitters.map((h) => toHitterEntry(h, h.avg_exit_velo)),
    [qualifiedHitters],
  );
  const ev90Entries = useMemo(
    () => qualifiedHitters.map((h) => toHitterEntry(h, h.ev90)),
    [qualifiedHitters],
  );
  const chaseEntries = useMemo(
    () => qualifiedHitters.map((h) => toHitterEntry(h, h.chase)),
    [qualifiedHitters],
  );
  const stuffEntries = useMemo(
    () => qualifiedPitchers.map((p) => toPitcherEntry(p, p.stuff_plus)),
    [qualifiedPitchers],
  );
  const whiffEntries = useMemo(
    () => qualifiedPitchers.map((p) => toPitcherEntry(p, p.miss_pct)),
    [qualifiedPitchers],
  );

  // ─── Search ───
  const filteredSearch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const hh = hitters
      .filter(
        (h) =>
          h.playerFullName.toLowerCase().includes(q) ||
          (h.Team ?? "").toLowerCase().includes(q),
      )
      .slice(0, 20)
      .map((h) => ({
        id: h.source_player_id,
        name: h.playerFullName,
        team: h.Team,
        meta: `${h.Pos ?? "—"} · ${h.pa ?? 0} PA`,
      }));
    return hh;
  }, [hitters, query]);

  const isLoading = hLoading || pLoading;

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: NAVY_BG }}>
      {/* Hero header — full-bleed gradient banner */}
      <div
        className="border-b"
        style={{
          borderColor: NAVY_BORDER,
          background: "linear-gradient(180deg, #0a1428 0%, #040810 100%)",
        }}
      >
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <div
                className="text-[10px] font-bold uppercase tracking-[0.3em]"
                style={{ color: GOLD }}
              >
                Internal · College Baseball Data Hub
              </div>
              <h1
                className="mt-3 font-[Oswald] text-6xl font-bold leading-none tracking-tight"
                style={{ color: "#FFFFFF", textShadow: "0 0 24px rgba(212,175,55,0.15)" }}
              >
                Savant
              </h1>
              <p className="mt-3 max-w-xl text-sm text-white/55">
                Leaderboards, scouting metrics, and player profiles. Click any name to open their page.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Search bar */}
        <div className="mb-10">
          <div
            className="group flex items-center gap-3 border px-4 py-3.5 transition-colors duration-200 focus-within:border-[#D4AF37]/60"
            style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#D4AF37"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="opacity-70"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder="Search any player or team…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-transparent text-base text-white placeholder:text-white/35 focus:outline-none"
            />
          </div>
          {filteredSearch && filteredSearch.length > 0 && (
            <div
              className="mt-1 max-h-80 overflow-y-auto border"
              style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
            >
              {filteredSearch.map((r) =>
                r.id ? (
                  <Link
                    key={r.id}
                    to={`/savant/hitter/${r.id}`}
                    className="flex items-center justify-between border-b px-4 py-2.5 transition-colors last:border-b-0 hover:bg-white/[0.03]"
                    style={{ borderColor: NAVY_BORDER }}
                  >
                    <div>
                      <div className="text-sm font-semibold text-white">{r.name}</div>
                      <div className="text-[10px] uppercase tracking-wider text-white/45">
                        {r.team ?? "—"} · {r.meta}
                      </div>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-[#D4AF37]/70">View →</span>
                  </Link>
                ) : null,
              )}
            </div>
          )}
          {filteredSearch && filteredSearch.length === 0 && (
            <div className="mt-1 px-4 py-3 text-xs text-white/40">No players match.</div>
          )}
        </div>

        {/* Quick links */}
        <div className="mb-8 flex gap-3">
          <Link
            to="/savant/conferences"
            className="cursor-pointer border px-5 py-2.5 text-xs font-bold uppercase tracking-[0.15em] transition-colors duration-150 hover:bg-[#D4AF37]/10"
            style={{ borderColor: NAVY_BORDER, color: GOLD }}
          >
            Conference Stats →
          </Link>
        </div>

        {/* Section: Hitting Leaderboards */}
        <div className="mb-3 mt-10 flex items-center gap-3">
          <span className="h-px flex-1 bg-[#D4AF37]/20" />
          <span className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>
            Hitting Leaderboards
          </span>
          <span className="h-px flex-1 bg-[#D4AF37]/20" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <LeaderboardCard
            title="Barrel %"
            subtitle={`Min ${SAVANT_MIN_AB} AB`}
            entries={barrelEntries}
            format={fmtPct}
          />
          <LeaderboardCard
            title="Avg Exit Velo"
            subtitle={`Min ${SAVANT_MIN_AB} AB`}
            unit="MPH"
            entries={exitVeloEntries}
            format={fmt1}
          />
          <LeaderboardCard
            title="90th % EV"
            subtitle={`Min ${SAVANT_MIN_AB} AB`}
            unit="MPH"
            entries={ev90Entries}
            format={fmt1}
          />
          <LeaderboardCard
            title="Chase %"
            subtitle={`Min ${SAVANT_MIN_AB} AB · Lower is Better`}
            entries={chaseEntries}
            format={fmtPct}
            invert
          />
        </div>

        {/* Section: Pitching Leaderboards */}
        <div className="mb-3 mt-10 flex items-center gap-3">
          <span className="h-px flex-1 bg-[#D4AF37]/20" />
          <span className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>
            Pitching Leaderboards
          </span>
          <span className="h-px flex-1 bg-[#D4AF37]/20" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <LeaderboardCard
            title="Stuff+"
            subtitle={`Min ${SAVANT_MIN_IP} IP · Hand-built coverage`}
            entries={stuffEntries}
            format={fmtInt}
            emptyMessage="Stuff+ data being filled in"
          />
          <LeaderboardCard
            title="Whiff %"
            subtitle={`Min ${SAVANT_MIN_IP} IP`}
            entries={whiffEntries}
            format={fmtPct}
          />
        </div>

        {isLoading && (
          <div className="mt-8 text-center text-xs text-white/40">Loading data…</div>
        )}

        {/* Section: Pipeline Tools */}
        <div className="mb-3 mt-10 flex items-center gap-3">
          <span className="h-px flex-1 bg-[#D4AF37]/20" />
          <span className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>
            Pipeline Tools
          </span>
          <span className="h-px flex-1 bg-[#D4AF37]/20" />
        </div>
        <ReclassificationRunner />
        <VeloDiffRunner />
        <StuffPlusRunner />
        <ConferenceStuffPlusRunner />

        <div className="mt-12 border-t pt-4 text-center text-[10px] uppercase tracking-wider text-white/30" style={{ borderColor: NAVY_BORDER }}>
          RSTR IQ Savant · Internal Data Hub
        </div>
      </div>
    </div>
  );
}
