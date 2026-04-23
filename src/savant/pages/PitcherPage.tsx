import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PercentileBar from "@/savant/components/PercentileBar";
import PitcherCareerStatsTable from "@/savant/components/PitcherCareerStatsTable";
import PitcherStuffPlusTable from "@/savant/components/PitcherStuffPlusTable";
import PitcherCareerScoutingTable from "@/savant/components/PitcherCareerScoutingTable";
import {
  SAVANT_MIN_IP,
  useSavantPitchers,
  type SavantPitcherRow,
} from "@/savant/hooks/useSavantPitchers";
import { usePitcherCareer } from "@/savant/hooks/usePitcherCareer";
import { usePitcherStuffPlus } from "@/savant/hooks/usePitcherStuffPlus";
import { percentileRank } from "@/savant/lib/percentile";
import { computePrvPlus } from "@/savant/lib/prvPlus";
import { assessPitcherRisk } from "@/lib/playerRisk";
import { RiskAssessmentCardSavant } from "@/components/RiskAssessmentCard";
import { useConferenceStats } from "@/hooks/useConferenceStats";
import { generatePitcherReport } from "@/lib/scoutingReportGenerator";

const fmt2 = (v: number) => v.toFixed(2);
const fmt1 = (v: number) => v.toFixed(1);
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const fmtInt = (v: number) => `${Math.round(v)}`;

const NAVY_BG = "#040810";
const NAVY_CARD = "#0a1428";
const NAVY_BORDER = "#1f2d52";
const GOLD = "#D4AF37";

interface BarConfig {
  label: string;
  value: number | null;
  pop: Array<number | null>;
  format: (v: number) => string;
  /** Lower-is-better metrics get inverted percentile */
  invert?: boolean;
}

function buildBars(player: SavantPitcherRow, pop: SavantPitcherRow[]) {
  const qualified = pop.filter((p) => (p.IP ?? 0) >= SAVANT_MIN_IP);
  const col = <K extends keyof SavantPitcherRow>(k: K) =>
    qualified.map((r) => r[k] as number | null);

  // Compute pRV+ for the player AND the population so percentile ranks correctly
  const playerPrv = computePrvPlus(
    player.era_pr_plus, player.fip_pr_plus, player.whip_pr_plus,
    player.k9_pr_plus, player.bb9_pr_plus, player.hr9_pr_plus,
  );
  const popPrv = qualified.map((r) =>
    computePrvPlus(r.era_pr_plus, r.fip_pr_plus, r.whip_pr_plus, r.k9_pr_plus, r.bb9_pr_plus, r.hr9_pr_plus),
  );

  const production: BarConfig[] = [
    { label: "ERA", value: player.ERA, pop: col("ERA"), format: fmt2, invert: true },
    { label: "FIP", value: player.FIP, pop: col("FIP"), format: fmt2, invert: true },
    { label: "WHIP", value: player.WHIP, pop: col("WHIP"), format: fmt2, invert: true },
    { label: "K/9", value: player.K9, pop: col("K9"), format: fmt2 },
    { label: "BB/9", value: player.BB9, pop: col("BB9"), format: fmt2, invert: true },
    { label: "HR/9", value: player.HR9, pop: col("HR9"), format: fmt2, invert: true },
    { label: "pRV+", value: playerPrv, pop: popPrv, format: fmtInt },
  ];
  const stuff: BarConfig[] = [
    { label: "STUFF+", value: player.stuff_plus, pop: col("stuff_plus"), format: fmtInt },
    { label: "WHIFF %", value: player.miss_pct, pop: col("miss_pct"), format: fmtPct },
    { label: "IZ WHIFF %", value: player.in_zone_whiff_pct, pop: col("in_zone_whiff_pct"), format: fmtPct },
    { label: "CHASE %", value: player.chase_pct, pop: col("chase_pct"), format: fmtPct },
    { label: "BB %", value: player.bb_pct, pop: col("bb_pct"), format: fmtPct, invert: true },
  ];
  const contact: BarConfig[] = [
    { label: "HARD HIT %", value: player.hard_hit_pct, pop: col("hard_hit_pct"), format: fmtPct, invert: true },
    { label: "BARREL %", value: player.barrel_pct, pop: col("barrel_pct"), format: fmtPct, invert: true },
    { label: "EXIT VELO", value: player.exit_vel, pop: col("exit_vel"), format: fmt1, invert: true },
    { label: "GROUND %", value: player.ground_pct, pop: col("ground_pct"), format: fmtPct },
  ];
  return { production, stuff, contact };
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

export default function PitcherPage() {
  const { id } = useParams<{ id: string }>();
  const [selectedSeason, setSelectedSeason] = useState<number>(2025);
  const [seasonOpen, setSeasonOpen] = useState(false);
  const seasonRef = useRef<HTMLDivElement>(null);

  // Close percentile-rankings dropdown on outside click
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

  const { data: pitchers = [], isLoading } = useSavantPitchers(selectedSeason);
  const { data: careerRows = [] } = usePitcherCareer(id);
  const { conferenceStatsByKey } = useConferenceStats(2025);

  // Stuff+ table has its own season state since the dropdown only includes
  // seasons that have Stuff+ data (forward only, no historical backfill).
  const [stuffSeason, setStuffSeason] = useState<number>(2025);
  const { data: stuffRows = [] } = usePitcherStuffPlus(id, stuffSeason);

  const availableSeasons = useMemo(() => {
    const set = new Set<number>();
    for (const r of careerRows) if (r.Season != null) set.add(Number(r.Season));
    return [...set].sort((a, b) => b - a);
  }, [careerRows]);

  const player = useMemo(
    () => pitchers.find((p) => p.source_player_id === id),
    [pitchers, id],
  );

  const groups = useMemo(
    () => (player ? buildBars(player, pitchers) : null),
    [player, pitchers],
  );

  if (isLoading) {
    return <div className="py-10 text-sm text-white/50">Loading…</div>;
  }

  if (!player || !groups) {
    return (
      <div className="py-10 text-sm text-white/60">
        Pitcher not found in {selectedSeason} Pitching Master.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr]">
          {/* ─── LEFT COLUMN ─── */}
          <div className="space-y-6">
            {/* Header card */}
            <header
              className="border-l-[3px] px-7 py-6 shadow-[0_1px_0_0_rgba(212,175,55,0.08)_inset]"
              style={{ borderColor: GOLD, backgroundColor: NAVY_CARD }}
            >
              <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#D4AF37]">
                Internal · Savant · Pitcher Profile · {player.Season ?? "—"}
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
                <span>{player.Role ?? "—"}</span>
                <MetaDot />
                <span>{player.ThrowHand === "L" ? "LHP" : player.ThrowHand === "R" ? "RHP" : player.ThrowHand ?? "?"}</span>
              </div>
            </header>

            <PitcherCareerStatsTable rows={careerRows} />

            <PitcherStuffPlusTable
              rows={stuffRows}
              selectedSeason={stuffSeason}
              availableSeasons={[2025, 2024, 2023]}
              onSeasonChange={setStuffSeason}
              overallStuffPlus={player.stuff_plus}
            />

            <PitcherCareerScoutingTable rows={careerRows} />

            {/* Scouting Report */}
            {(() => {
              const qualified = pitchers.filter((pp) => (pp.IP ?? 0) >= SAVANT_MIN_IP);
              const col = <K extends keyof SavantPitcherRow>(k: K) => qualified.map((r) => r[k] as number | null);
              const pr = (v: number | null | undefined, pop: Array<number | null>, opts?: { invert?: boolean }) =>
                v != null ? percentileRank(v, pop, opts) ?? undefined : undefined;

              const pitchArsenal = stuffRows.filter((r) => (r.pitches ?? 0) >= 5).map((r) => ({
                name: r.rstr_pitch_class ?? r.pitch_type,
                count: r.pitches,
                velocity: r.velocity,
                ivb: r.ivb,
                hb: r.hb,
                whiffPct: r.whiff_pct,
                stuffPlus: r.stuff_plus,
                relHeight: r.rel_height,
                extension: r.extension,
                vaa: r.vaa,
              }));

              const report = generatePitcherReport({
                throwHand: player.ThrowHand,
                role: player.Role,
                conference: player.Conference,
                era: player.ERA, fip: player.FIP, whip: player.WHIP,
                k9: player.K9, bb9: player.BB9, hr9: player.HR9, ip: player.IP,
                stuffPlus: player.stuff_plus,
                whiffPct: player.miss_pct, izWhiffPct: player.in_zone_whiff_pct,
                chasePct: player.chase_pct, bbPct: player.bb_pct,
                hardHitPct: player.hard_hit_pct, barrelPct: player.barrel_pct,
                exitVel: player.exit_vel, gbPct: player.ground_pct,
                pitches: pitchArsenal,
                pct: {
                  era: pr(player.ERA, col("ERA"), { invert: true }),
                  fip: pr(player.FIP, col("FIP"), { invert: true }),
                  whip: pr(player.WHIP, col("WHIP"), { invert: true }),
                  k9: pr(player.K9, col("K9")),
                  bb9: pr(player.BB9, col("BB9"), { invert: true }),
                  hr9: pr(player.HR9, col("HR9"), { invert: true }),
                  stuffPlus: pr(player.stuff_plus, col("stuff_plus")),
                  whiffPct: pr(player.miss_pct, col("miss_pct")),
                  izWhiffPct: pr(player.in_zone_whiff_pct, col("in_zone_whiff_pct")),
                  chasePct: pr(player.chase_pct, col("chase_pct")),
                  bbPct: pr(player.bb_pct, col("bb_pct"), { invert: true }),
                  hardHitPct: pr(player.hard_hit_pct, col("hard_hit_pct"), { invert: true }),
                  barrelPct: pr(player.barrel_pct, col("barrel_pct"), { invert: true }),
                  exitVel: pr(player.exit_vel, col("exit_vel"), { invert: true }),
                  gbPct: pr(player.ground_pct, col("ground_pct")),
                },
              }, "savant", "short");

              return (
                <section className="border px-5 py-4" style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
                  <h2 className="text-xs font-bold uppercase tracking-[0.22em] text-[#D4AF37] mb-3" style={{ fontFamily: "'Oswald', sans-serif" }}>
                    Scouting Report
                  </h2>
                  <p className="text-[11px] text-[#8a94a6] leading-relaxed whitespace-pre-line">{report}</p>
                </section>
              );
            })()}
          </div>

          {/* ─── RIGHT COLUMN ─── */}
          <div className="space-y-6">

            {/* Risk Assessment */}
            {(() => {
              const confRow = player.Conference ? conferenceStatsByKey.get(player.Conference.toLowerCase().trim()) : undefined;
              const playerPrv = computePrvPlus(
                player.era_pr_plus, player.fip_pr_plus, player.whip_pr_plus,
                player.k9_pr_plus, player.bb9_pr_plus, player.hr9_pr_plus,
              );
              const risk = assessPitcherRisk({
                conference: player.Conference,
                projectedPrvPlus: playerPrv,
                confHitterTalentPlus: confRow?.overall_power_rating != null && confRow?.stuff_plus != null && confRow?.wrc_plus != null
                  ? confRow.overall_power_rating + (1.25 * (confRow.stuff_plus - 100)) + (0.75 * (100 - confRow.wrc_plus))
                  : null,
                careerSeasons: careerRows,
                ip: player.IP, classYear: undefined,
                stuffPlus: player.stuff_plus,
                whiffPct: player.miss_pct, bbPct: player.bb_pct,
                chase: player.chase_pct, barrel: player.barrel_pct,
                hardHit: player.hard_hit_pct, gb: player.ground_pct,
                izWhiff: player.in_zone_whiff_pct,
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
                  <h2
                    className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em] text-[#D4AF37]"
                    style={{ fontFamily: "'Oswald', sans-serif" }}
                  >
                    <div ref={seasonRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setSeasonOpen((v) => !v)}
                        className="inline-flex cursor-pointer items-center gap-1 bg-transparent text-xs font-bold uppercase tracking-[0.22em] text-[#D4AF37] transition-colors duration-150 hover:text-[#E8C24E] focus:outline-none"
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
                          <path
                            d="M2 4l4 4 4-4"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
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
                  vs. NCAA · min {SAVANT_MIN_IP} IP
                </div>
              </div>

              <SectionHeader>Production</SectionHeader>
              <BarGroup bars={groups.production} />

              <SectionHeader>Stuff & Discipline</SectionHeader>
              <BarGroup bars={groups.stuff} />

              <SectionHeader>Quality of Contact</SectionHeader>
              <BarGroup bars={groups.contact} />
            </section>
          </div>
        </div>
    </>
  );
}
