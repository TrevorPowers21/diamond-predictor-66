import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PercentileBar from "@/savant/components/PercentileBar";
import CareerStatsTable from "@/savant/components/CareerStatsTable";
import CareerScoutingTable from "@/savant/components/CareerScoutingTable";
import CareerPowerRatingsTable from "@/savant/components/CareerPowerRatingsTable";
import PowerRatingsCard from "@/savant/components/PowerRatingsCard";
import PredictionCard from "@/savant/components/PredictionCard";
import { usePlayerPrediction } from "@/savant/hooks/usePlayerPrediction";
import {
  SAVANT_MIN_AB,
  useSavantHitters,
  type SavantHitterRow,
} from "@/savant/hooks/useSavantHitters";
import { usePlayerCareer } from "@/savant/hooks/usePlayerCareer";
import { percentileRank } from "@/savant/lib/percentile";
import { computeWrcPlus } from "@/savant/lib/wrcPlus";
import { assessHitterRisk } from "@/lib/playerRisk";
import { RiskAssessmentCardSavant } from "@/components/RiskAssessmentCard";
import { useConferenceStats } from "@/hooks/useConferenceStats";

const fmt3 = (v: number) => v.toFixed(3);
const fmt1 = (v: number) => v.toFixed(1);
const fmtInt = (v: number) => `${Math.round(v)}`;
const fmtPct = (v: number) => `${v.toFixed(1)}%`;

const opsOf = (r: { OBP: number | null; SLG: number | null }): number | null =>
  r.OBP != null && r.SLG != null ? r.OBP + r.SLG : null;

const wrcPlusOf = (r: {
  AVG: number | null;
  OBP: number | null;
  SLG: number | null;
  ISO: number | null;
}): number | null => computeWrcPlus(r.AVG, r.OBP, r.SLG, r.ISO);

const GOLD = "#D4AF37";
const NAVY_BG = "#040810";
const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";

interface BarConfig {
  label: string;
  value: number | null;
  pop: Array<number | null>;
  format: (v: number) => string;
  invert?: boolean;
}

function buildBars(player: SavantHitterRow, pop: SavantHitterRow[]) {
  const qualified = pop.filter((p) => (p.ab ?? 0) >= SAVANT_MIN_AB);
  const col = <K extends keyof SavantHitterRow>(k: K) =>
    qualified.map((r) => r[k] as number | null);

  const production: BarConfig[] = [
    { label: "AVG", value: player.AVG, pop: col("AVG"), format: fmt3 },
    { label: "OBP", value: player.OBP, pop: col("OBP"), format: fmt3 },
    { label: "SLG", value: player.SLG, pop: col("SLG"), format: fmt3 },
    { label: "OPS", value: opsOf(player), pop: qualified.map(opsOf), format: fmt3 },
    { label: "ISO", value: player.ISO, pop: col("ISO"), format: fmt3 },
    { label: "WRC+", value: wrcPlusOf(player), pop: qualified.map(wrcPlusOf), format: fmtInt },
  ];
  const contact: BarConfig[] = [
    { label: "EXIT VELO", value: player.avg_exit_velo, pop: col("avg_exit_velo"), format: fmt1 },
    { label: "EV90", value: player.ev90, pop: col("ev90"), format: fmt1 },
    { label: "BARREL%", value: player.barrel, pop: col("barrel"), format: fmtPct },
    { label: "LA SWEET SPOT %", value: player.la_10_30, pop: col("la_10_30"), format: fmtPct },
  ];
  const discipline: BarConfig[] = [
    { label: "BB%", value: player.bb, pop: col("bb"), format: fmtPct },
    { label: "CHASE%", value: player.chase, pop: col("chase"), format: fmtPct, invert: true },
    { label: "CONTACT%", value: player.contact, pop: col("contact"), format: fmtPct },
  ];
  return { production, contact, discipline };
}

function MetaDot() {
  return <span className="mx-2 inline-block h-1 w-1 rounded-full bg-[#D4AF37]/70 align-middle" />;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-2 first:mt-0">
      <span className="h-px flex-1 bg-[#D4AF37]/20" />
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]">
        {children}
      </span>
      <span className="h-px flex-1 bg-[#D4AF37]/20" />
    </div>
  );
}

function BarGroup({ bars }: { bars: BarConfig[] }) {
  return (
    <div className="divide-y divide-white/5">
      {bars.map((b) => (
        <PercentileBar
          key={b.label}
          label={b.label}
          value={b.value}
          percentile={percentileRank(b.value, b.pop, { invert: b.invert })}
          format={b.format}
        />
      ))}
    </div>
  );
}

export default function HitterPage() {
  const { id } = useParams<{ id: string }>();
  const [selectedSeason, setSelectedSeason] = useState<number>(2025);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const seasonRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!seasonOpen) return;
    const handler = (e: MouseEvent) => {
      if (seasonRef.current && !seasonRef.current.contains(e.target as Node)) {
        setSeasonOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [seasonOpen]);

  const { data: hitters = [], isLoading } = useSavantHitters(selectedSeason);
  const { data: careerRows = [] } = usePlayerCareer(id);
  const { data: prediction = null } = usePlayerPrediction(id);
  const { conferenceStatsByKey } = useConferenceStats(2025);

  // Years this player actually has data for — drives the season dropdown
  const availableSeasons = useMemo(() => {
    const set = new Set<number>();
    for (const r of careerRows) if (r.Season != null) set.add(Number(r.Season));
    return [...set].sort((a, b) => b - a);
  }, [careerRows]);

  const player = useMemo(
    () => hitters.find((h) => h.source_player_id === id),
    [hitters, id],
  );

  const groups = useMemo(
    () => (player ? buildBars(player, hitters) : null),
    [player, hitters],
  );

  if (isLoading) {
    return <div className="py-10 text-sm text-white/50">Loading…</div>;
  }

  if (!player || !groups) {
    return (
      <div className="py-10 text-sm text-white/60">
        Hitter not found in {selectedSeason} Hitter Master.
      </div>
    );
  }

  return (
    <>
      {/* Two-column layout: identity + tables on the left, percentile viz on the right */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr]">
          {/* ─── LEFT COLUMN ─── */}
          <div className="space-y-6">
            {/* Header card */}
            <header
              className="border-l-[3px] px-7 py-6 shadow-[0_1px_0_0_rgba(212,175,55,0.08)_inset]"
              style={{ borderColor: GOLD, backgroundColor: NAVY_CARD }}
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#D4AF37]">
                Internal · Savant · Hitter Profile · {player.Season ?? "—"}
              </div>
              <h1
                className="mt-2 font-[Oswald] text-4xl font-bold leading-none tracking-tight text-white"
                style={{ textShadow: "0 0 16px rgba(212,175,55,0.08)" }}
              >
                {player.playerFullName}
              </h1>
              <div className="mt-3 text-sm text-white/75">
                <span className="font-semibold text-white">{player.Team ?? "—"}</span>
                <MetaDot />
                <span>{player.Conference ?? "—"}</span>
                <MetaDot />
                <span>{player.Pos ?? "—"}</span>
                <MetaDot />
                <span>{player.BatHand ?? "?"}/{player.ThrowHand ?? "?"}</span>
              </div>
            </header>

            {/* Career stats table */}
            <CareerStatsTable rows={careerRows} />

            {/* Year-over-year scouting metrics */}
            <CareerScoutingTable rows={careerRows} />

            {/* 2025 Power Ratings tile strip */}
            <PowerRatingsCard player={player} />
          </div>

          {/* ─── RIGHT COLUMN ─── */}
          <div className="space-y-6">
            <PredictionCard prediction={prediction} targetSeason={2026} />

            {/* Risk Assessment */}
            {(() => {
              const confRow = player.Conference ? conferenceStatsByKey.get(player.Conference.toLowerCase().trim()) : undefined;
              const risk = assessHitterRisk({
                conference: player.Conference,
                projectedWrcPlus: prediction?.p_wrc_plus ?? null,
                confStuffPlus: confRow?.stuff_plus,
                careerSeasons: careerRows,
                pa: player.pa ?? player.ab,
                chase: player.chase, contact: player.contact,
                barrel: player.barrel, lineDrive: player.line_drive,
                avgEv: player.avg_exit_velo, ev90: player.ev90,
                pull: player.pull, gb: player.gb, bb: player.bb,
              });
              return <RiskAssessmentCardSavant risk={risk} navyCard={NAVY_CARD} navyBorder={NAVY_BORDER} />;
            })()}

            <section
              className="border px-6 py-5"
              style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
            >
              <div className="mb-3 flex items-baseline justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: GOLD }} />
                  <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-[#D4AF37]" style={{ fontFamily: "'Oswald', sans-serif" }}>
                    {/* Inline season picker — looks like part of the heading */}
                    <div ref={seasonRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setSeasonOpen((v) => !v)}
                        className="group inline-flex cursor-pointer items-center gap-1 bg-transparent text-xs font-bold uppercase tracking-[0.22em] text-[#D4AF37] transition-colors duration-150 hover:text-[#E8C24E] focus:outline-none"
                        style={{ fontFamily: "'Oswald', sans-serif" }}
                      >
                        <span>{selectedSeason}</span>
                        <svg
                          width="8"
                          height="8"
                          viewBox="0 0 12 12"
                          fill="none"
                          className={`transition-transform duration-200 ${seasonOpen ? "rotate-180" : ""}`}
                          style={{ color: GOLD }}
                        >
                          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      {seasonOpen && (
                        <div
                          className="absolute left-0 top-full z-20 mt-1 min-w-full overflow-hidden border shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]"
                          style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
                        >
                          {(availableSeasons.length > 0 ? availableSeasons : [2025]).map((s) => {
                            const isActive = s === selectedSeason;
                            return (
                              <button
                                key={s}
                                type="button"
                                onClick={() => {
                                  setSelectedSeason(s);
                                  setSeasonOpen(false);
                                }}
                                className="block w-full cursor-pointer px-4 py-2 text-left font-[Oswald] text-sm font-bold leading-none transition-colors duration-150 hover:bg-[#D4AF37]/[0.1]"
                                style={{
                                  color: isActive ? GOLD : "#FFFFFF",
                                  backgroundColor: isActive ? "rgba(212,175,55,0.06)" : "transparent",
                                }}
                              >
                                {s}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    Percentile Rankings
                  </h2>
                </div>
                <div className="text-[11px] uppercase tracking-wider text-white/55">
                  vs. NCAA · min {SAVANT_MIN_AB} AB
                </div>
              </div>

              <SectionHeader>Production</SectionHeader>
              <BarGroup bars={groups.production} />

              <SectionHeader>Quality of Contact</SectionHeader>
              <BarGroup bars={groups.contact} />

              <SectionHeader>Plate Discipline</SectionHeader>
              <BarGroup bars={groups.discipline} />
            </section>
          </div>
        </div>
    </>
  );
}
