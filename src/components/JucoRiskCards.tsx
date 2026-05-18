/**
 * JUCO-specific risk cards (pitcher + hitter).
 *
 * Same philosophy: a slimmed factor set that translates cleanly across the
 * JUCO→D1 jump. We drop the factors that misread for cross-level transfers
 * (trajectory, sample size, workload, durability) and add Data Reliability
 * to flag sparse TrackMan capture.
 *
 * Pitcher factors (5):
 *   Projection · Skillset · Data Reliability · Competition (source HTP) · Stuff+
 *
 * Hitter factors (4):
 *   Projection · Skillset · Data Reliability · Competition (source Stuff+)
 *
 * Skillset uses TrackMan metrics when present, else falls back to peripheral
 * peripherals: K/9 + BB/9 + HR/9 for pitchers, AVG + ISO + (OBP-AVG) for hitters.
 */
import {
  assessPitcherProjection,
  assessPitcherTypeRisk,
  assessPitcherCompetitionRisk,
  assessHitterProjection,
  assessHitterTypeRisk,
  assessHitterCompetitionRisk,
} from "@/lib/playerRisk";
import type { RiskFactor, RiskAssessment, RiskGrade } from "@/lib/playerRisk";
import { computeDataReliability } from "@/lib/jucoDataReliability";
import { RiskAssessmentCardRSTR } from "@/components/RiskAssessmentCard";

const TIER_TO_SCORE = { verified: 5, partial: 40, "stats-only": 70, none: 95 } as const;
const TIER_TO_GRADE: Record<"verified" | "partial" | "stats-only" | "none", RiskGrade> = {
  verified: "Low", partial: "Moderate", "stats-only": "Elevated", none: "High",
};

const overallToGrade = (overall: number): RiskGrade =>
  overall <= 25 ? "Low" : overall <= 50 ? "Moderate" : overall <= 75 ? "Elevated" : "High";

function buildComposite(factors: RiskFactor[], weights: number[]): { overall: number; grade: RiskGrade } {
  let weighted = 0;
  let active = 0;
  factors.forEach((f, i) => {
    if (f.score != null && Number.isFinite(f.score)) {
      weighted += f.score * weights[i];
      active += weights[i];
    }
  });
  const overall = active > 0 ? Math.round(weighted / active) : 50;
  return { overall, grade: overallToGrade(overall) };
}

// ── Pitcher ─────────────────────────────────────────────────────────────────

export type JucoPitcherRiskInput = {
  // Projection
  projectedPrvPlus: number | null;
  // Skillset (TrackMan first, peripherals as fallback)
  stuffPlus: number | null;
  missPct: number | null;
  bbPct: number | null;
  chasePct: number | null;
  barrelPct: number | null;
  hardHitPct: number | null;
  groundPct: number | null;
  inZoneWhiffPct: number | null;
  k9: number | null;
  bb9: number | null;
  hr9: number | null;
  // Data Reliability
  trackmanPitches: number | null;
  bf: number | null;
  // Competition — SOURCE conference (the inflation question)
  sourceConference: string | null;
  sourceHitterTalentPlus: number | null;
};

export function JucoPitcherRiskCard({ input }: { input: JucoPitcherRiskInput }) {
  const factors: RiskFactor[] = [];

  factors.push(assessPitcherProjection(input.projectedPrvPlus));

  factors.push(assessPitcherTypeRisk({
    stuffPlus: input.stuffPlus,
    whiffPct: input.missPct,
    bbPct: input.bbPct,
    chase: input.chasePct,
    barrel: input.barrelPct,
    hardHit: input.hardHitPct,
    gb: input.groundPct,
    izWhiff: input.inZoneWhiffPct,
    k9: input.k9,
    bb9: input.bb9,
    hr9: input.hr9,
  }));

  const reliability = computeDataReliability(input.trackmanPitches ?? 0, input.bf);
  factors.push({
    label: "Data Reliability",
    score: TIER_TO_SCORE[reliability.tier],
    grade: TIER_TO_GRADE[reliability.tier],
    detail: `${reliability.label} — ${reliability.trackmanPitches} TrackMan pitches${input.bf != null ? ` / ${input.bf} BF` : ""}`,
  });

  factors.push(assessPitcherCompetitionRisk(input.sourceConference, input.sourceHitterTalentPlus));

  // Stuff+ — quality tier when present, N/A when not. Min-floor 8 keeps elite
  // arms (Stuff+ 119) visible against the muted-grey N/A stub.
  const sp = input.stuffPlus;
  if (sp != null) {
    const score = Math.max(8, Math.min(95, Math.round((108 - sp) * 5)));
    const grade: RiskGrade = sp >= 105 ? "Low" : sp >= 98 ? "Moderate" : sp >= 92 ? "Elevated" : "High";
    factors.push({ label: "Stuff+", score, grade, detail: `Arsenal quality: ${sp.toFixed(1)}` });
  } else {
    factors.push({ label: "Stuff+", score: null, grade: "Unknown", detail: "No TrackMan data — Stuff+ unavailable" });
  }

  const weights = [0.35, 0.25, 0.15, 0.15, 0.10]; // projection, skillset, dataRel, competition, stuff
  const { overall, grade } = buildComposite(factors, weights);

  const summary = (() => {
    const parts: string[] = [];
    if (grade === "Low") parts.push("Low-risk profile with a stable floor.");
    else if (grade === "Moderate") parts.push("Moderate risk — solid but with some variance factors.");
    else if (grade === "Elevated") parts.push("Elevated risk — multiple concerns present.");
    else parts.push("High-risk profile — significant concerns across multiple factors.");
    const proj = factors[0]; if (proj.detail && proj.score != null) parts.push(proj.detail.charAt(0).toUpperCase() + proj.detail.slice(1) + ".");
    const dr = factors[2]; if (dr.score != null && dr.score >= 55) parts.push("Sparse TrackMan capture — confidence in metrics is limited.");
    const comp = factors[3]; if (comp.score != null && comp.score >= 55) parts.push("Soft source-conference competition — stats may be inflated.");
    return parts.join(" ");
  })();

  const risk: RiskAssessment = { overall, grade, trajectory: "Unknown", factors, summary };
  return <RiskAssessmentCardRSTR risk={risk} />;
}

// ── Hitter ──────────────────────────────────────────────────────────────────

export type JucoHitterRiskInput = {
  // Projection
  projectedWrcPlus: number | null;
  // Skillset (TrackMan first, slash-line as fallback)
  chase: number | null;
  contact: number | null;
  whiff: number | null;
  barrel: number | null;
  lineDrive: number | null;
  avgEv: number | null;
  ev90: number | null;
  pull: number | null;
  gb: number | null;
  bb: number | null;
  // Slash-line peripheral fallback
  avg: number | null;
  obp: number | null;
  iso: number | null;
  // Data Reliability
  trackmanPitches: number | null;
  pa: number | null;
  // Competition — SOURCE conf Stuff+ faced (the inflation question)
  sourceConference: string | null;
  sourceConfStuffPlus: number | null;
};

export function JucoHitterRiskCard({ input }: { input: JucoHitterRiskInput }) {
  const factors: RiskFactor[] = [];

  factors.push(assessHitterProjection(input.projectedWrcPlus));

  factors.push(assessHitterTypeRisk({
    chase: input.chase, contact: input.contact, whiff: input.whiff,
    barrel: input.barrel, lineDrive: input.lineDrive, avgEv: input.avgEv,
    ev90: input.ev90, pull: input.pull, gb: input.gb, bb: input.bb,
    avg: input.avg, obp: input.obp, iso: input.iso,
  }));

  const reliability = computeDataReliability(input.trackmanPitches ?? 0, input.pa);
  factors.push({
    label: "Data Reliability",
    score: TIER_TO_SCORE[reliability.tier],
    grade: TIER_TO_GRADE[reliability.tier],
    detail: `${reliability.label} — ${reliability.trackmanPitches} TrackMan pitches${input.pa != null ? ` / ${input.pa} PA` : ""}`,
  });

  factors.push(assessHitterCompetitionRisk(input.sourceConference, input.sourceConfStuffPlus));

  // Heavier weight on Projection + Skillset; Data Reliability + Competition
  // act as confidence modifiers, same pattern as pitcher card.
  const weights = [0.40, 0.30, 0.15, 0.15]; // projection, skillset, dataRel, competition
  const { overall, grade } = buildComposite(factors, weights);

  const summary = (() => {
    const parts: string[] = [];
    if (grade === "Low") parts.push("Low-risk profile with a stable floor.");
    else if (grade === "Moderate") parts.push("Moderate risk — solid but with some variance factors.");
    else if (grade === "Elevated") parts.push("Elevated risk — multiple concerns present.");
    else parts.push("High-risk profile — significant concerns across multiple factors.");
    const proj = factors[0]; if (proj.detail && proj.score != null) parts.push(proj.detail.charAt(0).toUpperCase() + proj.detail.slice(1) + ".");
    const dr = factors[2]; if (dr.score != null && dr.score >= 55) parts.push("Sparse TrackMan capture — confidence in metrics is limited.");
    const comp = factors[3]; if (comp.score != null && comp.score >= 55) parts.push("Soft source-conference pitching — stats may be inflated.");
    return parts.join(" ");
  })();

  const risk: RiskAssessment = { overall, grade, trajectory: "Unknown", factors, summary };
  return <RiskAssessmentCardRSTR risk={risk} />;
}
