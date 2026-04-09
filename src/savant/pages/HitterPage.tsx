import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import PercentileBar from "@/savant/components/PercentileBar";
import CareerStatsTable from "@/savant/components/CareerStatsTable";
import CareerScoutingTable from "@/savant/components/CareerScoutingTable";
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
const NAVY_BG = "#070e1f";
const NAVY_CARD = "#0D1B3E";
const NAVY_BORDER = "#1a2950";

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
    { label: "LA 10-30%", value: player.la_10_30, pop: col("la_10_30"), format: fmtPct },
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
  const { data: hitters = [], isLoading } = useSavantHitters();
  const { data: careerRows = [] } = usePlayerCareer(id);
  const { data: prediction = null } = usePlayerPrediction(id);

  const player = useMemo(
    () => hitters.find((h) => h.source_player_id === id),
    [hitters, id],
  );

  const groups = useMemo(
    () => (player ? buildBars(player, hitters) : null),
    [player, hitters],
  );

  if (isLoading) {
    return (
      <div className="min-h-screen p-10 text-sm text-white/50" style={{ backgroundColor: NAVY_BG }}>
        Loading…
      </div>
    );
  }

  if (!player || !groups) {
    return (
      <div className="min-h-screen p-10" style={{ backgroundColor: NAVY_BG }}>
        <div className="mx-auto max-w-3xl">
          <Link
            to="/savant"
            className="cursor-pointer text-xs font-bold uppercase tracking-[0.2em] text-[#D4AF37] transition-colors hover:text-[#E8C24E]"
          >
            ← Savant
          </Link>
          <div className="mt-6 text-sm text-white/60">
            Hitter not found in 2025 Hitter Master.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-white" style={{ backgroundColor: NAVY_BG }}>
      <div className="mx-auto max-w-7xl px-6 py-8">
        <Link
          to="/savant"
          className="cursor-pointer text-[10px] font-bold uppercase tracking-[0.25em] text-[#D4AF37] transition-colors hover:text-[#E8C24E]"
        >
          ← Savant
        </Link>

        {/* Two-column layout: identity + tables on the left, percentile viz on the right */}
        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr]">
          {/* ─── LEFT COLUMN ─── */}
          <div className="space-y-6">
            {/* Header card */}
            <header
              className="border-l-[3px] px-7 py-6 shadow-[0_1px_0_0_rgba(212,175,55,0.08)_inset]"
              style={{ borderColor: GOLD, backgroundColor: NAVY_CARD }}
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#D4AF37]">
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
                <MetaDot />
                <span className="font-mono tabular-nums">{player.pa ?? 0} PA</span>
                <MetaDot />
                <span className="font-mono tabular-nums">{player.ab ?? 0} AB</span>
              </div>
            </header>

            {/* Slash line — 6 tiles, fits inside left column */}
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {[
                ["AVG", player.AVG, fmt3],
                ["OBP", player.OBP, fmt3],
                ["SLG", player.SLG, fmt3],
                ["OPS", opsOf(player), fmt3],
                ["ISO", player.ISO, fmt3],
                ["WRC+", wrcPlusOf(player), fmtInt],
              ].map(([label, val, f]) => (
                <div
                  key={label as string}
                  className="group cursor-default border px-3 py-3 transition-colors duration-200 hover:border-[#D4AF37]/40"
                  style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
                >
                  <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#D4AF37]/80">
                    {label as string}
                  </div>
                  <div
                    className="mt-1 font-[Oswald] text-2xl font-bold tabular-nums text-white"
                    style={{ textShadow: "0 0 12px rgba(212,175,55,0.15)" }}
                  >
                    {val != null ? (f as (n: number) => string)(val as number) : "—"}
                  </div>
                </div>
              ))}
            </div>

            {/* Career stats table */}
            <CareerStatsTable rows={careerRows} />

            {/* Year-over-year scouting metrics */}
            <CareerScoutingTable rows={careerRows} />
          </div>

          {/* ─── RIGHT COLUMN ─── */}
          <div className="space-y-6">
            <PredictionCard prediction={prediction} targetSeason={2026} />

            <section
              className="border px-6 py-5"
              style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}
            >
              <div className="mb-3 flex items-baseline justify-between">
                <div className="text-xs font-bold uppercase tracking-[0.25em] text-[#D4AF37]">
                  {player.Season ?? ""} Percentile Rankings
                </div>
                <div className="text-[10px] uppercase tracking-wider text-white/45">
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
      </div>
    </div>
  );
}
