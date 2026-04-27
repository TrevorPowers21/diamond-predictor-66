import { useMemo, useState } from "react";
import { useSavantHitters } from "@/savant/hooks/useSavantHitters";
import { useSavantPitchers } from "@/savant/hooks/useSavantPitchers";
import LeaderboardCard, { type LeaderboardEntry } from "@/savant/components/LeaderboardCard";
import ReclassificationRunner from "@/savant/components/ReclassificationRunner";
import NonBreakingBallPopRunner from "@/savant/components/NonBreakingBallPopRunner";
import VeloDiffRunner from "@/savant/components/VeloDiffRunner";
import StuffPlusRunner from "@/savant/components/StuffPlusRunner";
import ConferenceStuffPlusRunner from "@/savant/components/ConferenceStuffPlusRunner";
import ConferenceStuffPlusV2Runner from "@/savant/components/ConferenceStuffPlusV2Runner";
import { GOLD, NAVY_BORDER } from "@/savant/lib/theme";

const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmt1 = (v: number) => v.toFixed(1);
const fmtInt = (v: number) => `${Math.round(v)}`;

export default function SavantHome() {
  const { data: hitters = [], isLoading: hLoading } = useSavantHitters();
  const { data: pitchers = [], isLoading: pLoading } = useSavantPitchers();
  const [showPipeline, setShowPipeline] = useState(false);

  const BATTING_TITLE_PA = 150;
  const MIN_IP = 30;

  const qualifiedHitters = useMemo(
    () => hitters.filter((h) => (h.pa ?? 0) >= BATTING_TITLE_PA),
    [hitters],
  );
  const qualifiedPitchers = useMemo(
    () => pitchers.filter((p) => (p.IP ?? 0) >= MIN_IP),
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

  const barrelEntries = useMemo(() => qualifiedHitters.map((h) => toHitterEntry(h, h.barrel)), [qualifiedHitters]);
  const exitVeloEntries = useMemo(() => qualifiedHitters.map((h) => toHitterEntry(h, h.avg_exit_velo)), [qualifiedHitters]);
  const ev90Entries = useMemo(() => qualifiedHitters.map((h) => toHitterEntry(h, h.ev90)), [qualifiedHitters]);
  const chaseEntries = useMemo(() => qualifiedHitters.map((h) => toHitterEntry(h, h.chase)), [qualifiedHitters]);
  const bbPctEntries = useMemo(() => qualifiedHitters.map((h) => toHitterEntry(h, h.bb)), [qualifiedHitters]);
  const stuffEntries = useMemo(() => qualifiedPitchers.map((p) => toPitcherEntry(p, p.stuff_plus)), [qualifiedPitchers]);
  const whiffEntries = useMemo(() => qualifiedPitchers.map((p) => toPitcherEntry(p, p.miss_pct)), [qualifiedPitchers]);
  const izWhiffEntries = useMemo(() => qualifiedPitchers.map((p) => toPitcherEntry(p, p.in_zone_whiff_pct)), [qualifiedPitchers]);
  const pitcherBbEntries = useMemo(() => qualifiedPitchers.map((p) => toPitcherEntry(p, p.bb_pct)), [qualifiedPitchers]);

  const isLoading = hLoading || pLoading;

  return (
    <>
      {/* Hitting Leaderboards */}
      <div className="mb-3 flex items-center gap-3">
        <span className="h-px flex-1 bg-[#D4AF37]/20" />
        <span className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>
          Hitting Leaderboards
        </span>
        <span className="h-px flex-1 bg-[#D4AF37]/20" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <LeaderboardCard title="Barrel %" subtitle={`Min ${BATTING_TITLE_PA} PA`} entries={barrelEntries} format={fmtPct} />
        <LeaderboardCard title="Avg Exit Velo" subtitle={`Min ${BATTING_TITLE_PA} PA`} unit="MPH" entries={exitVeloEntries} format={fmt1} />
        <LeaderboardCard title="90th % EV" subtitle={`Min ${BATTING_TITLE_PA} PA`} unit="MPH" entries={ev90Entries} format={fmt1} />
        <LeaderboardCard title="Chase %" subtitle={`Min ${BATTING_TITLE_PA} PA · Lower is Better`} entries={chaseEntries} format={fmtPct} invert />
      </div>

      {/* Pitching Leaderboards */}
      <div className="mb-3 mt-10 flex items-center gap-3">
        <span className="h-px flex-1 bg-[#D4AF37]/20" />
        <span className="text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>
          Pitching Leaderboards
        </span>
        <span className="h-px flex-1 bg-[#D4AF37]/20" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <LeaderboardCard title="Stuff+" subtitle={`Min ${MIN_IP} IP`} entries={stuffEntries} format={fmtInt} emptyMessage="Stuff+ data being filled in" />
        <LeaderboardCard title="Whiff %" subtitle={`Min ${MIN_IP} IP`} entries={whiffEntries} format={fmtPct} />
        <LeaderboardCard title="IZ Whiff %" subtitle={`Min ${MIN_IP} IP`} entries={izWhiffEntries} format={fmtPct} />
        <LeaderboardCard title="BB %" subtitle={`Min ${MIN_IP} IP · Lower is Better`} entries={pitcherBbEntries} format={fmtPct} invert />
      </div>

      {isLoading && <div className="mt-8 text-center text-xs text-white/40">Loading data…</div>}

      {/* Pipeline Tools — hidden behind gear toggle */}
      <div className="mt-10 flex items-center gap-3">
        <span className="h-px flex-1 bg-[#D4AF37]/20" />
        <button
          onClick={() => setShowPipeline((v) => !v)}
          className="flex cursor-pointer items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] transition-colors hover:text-[#E8C24E]"
          style={{ color: showPipeline ? GOLD : "rgba(255,255,255,0.3)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Pipeline Tools
        </button>
        <span className="h-px flex-1 bg-[#D4AF37]/20" />
      </div>

      {showPipeline && (
        <div className="mt-4 space-y-4">
          <ReclassificationRunner />
          <NonBreakingBallPopRunner />
          <VeloDiffRunner />
          <StuffPlusRunner />
          <ConferenceStuffPlusRunner />
          <ConferenceStuffPlusV2Runner />
        </div>
      )}
    </>
  );
}
