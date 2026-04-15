/**
 * RSTR IQ — Player Risk Assessment Engine
 *
 * Produces a risk profile for any hitter or pitcher based on 5 factors:
 *  1. Player Type Risk (primary) — swing profile, contact quality, approach
 *  2. Competition Factor — conference strength adjustment
 *  3. Performance Trajectory — progressing / plateau / regressing
 *  4. Sample Size Risk — PA or IP volume
 *  5. Workload Risk (pitchers) — IP for class year
 *
 * Each factor produces a 0–100 risk score (higher = riskier).
 * Overall risk = weighted composite → grade (Low / Moderate / Elevated / High).
 */

// ── Types ───────────────────────────────────────────────────────────

export type RiskGrade = "Low" | "Moderate" | "Elevated" | "High";
export type Trajectory = "Progressing" | "Plateau" | "Regressing" | "Unknown";

export interface RiskFactor {
  label: string;
  score: number;       // 0–100
  grade: RiskGrade;
  detail: string;      // one-line explanation
}

export interface RiskAssessment {
  overall: number;     // 0–100
  grade: RiskGrade;
  trajectory: Trajectory;
  factors: RiskFactor[];
  summary: string;     // 2-3 sentence narrative
}

// ── Helpers ─────────────────────────────────────────────────────────

function toGrade(score: number): RiskGrade {
  if (score <= 25) return "Low";
  if (score <= 50) return "Moderate";
  if (score <= 75) return "Elevated";
  return "High";
}

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function avg(...vals: (number | null | undefined)[]): number | null {
  const valid = vals.filter((v) => v != null && Number.isFinite(v)) as number[];
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

// ── Conference Strength Tiers ───────────────────────────────────────
// Conferences ranked by overall competition level.
// Higher tier = stronger competition = lower risk discount.
// This is a baseline — can be refined with actual conference stats data.

const CONF_TIER: Record<string, number> = {
  // Power conferences — low competition risk
  "SEC": 1, "ACC": 1, "Big 12": 1, "Big Ten": 1, "Pac-12": 1,
  // Strong mid-majors
  "AAC": 2, "Big East": 2, "Mountain West": 2, "WCC": 2, "Colonial": 2,
  "Sun Belt": 2, "Conference USA": 2, "Missouri Valley": 2, "A-10": 2,
  // Mid-tier
  "MAC": 3, "WAC": 3, "ASUN": 3, "SoCon": 3, "CAA": 3, "Horizon": 3,
  "Big West": 3, "Ivy": 3, "Patriot": 3, "America East": 3,
  // Lower division / small conference
  "OVC": 4, "Big South": 4, "Summit": 4, "Southland": 4, "NEC": 4,
  "MAAC": 4, "MEAC": 4, "SWAC": 4,
};

function getConfTier(conference: string | null | undefined): number {
  if (!conference) return 3; // default mid-tier if unknown
  // Try exact match first
  if (CONF_TIER[conference]) return CONF_TIER[conference];
  // Fuzzy match
  const norm = conference.toLowerCase().trim();
  for (const [key, tier] of Object.entries(CONF_TIER)) {
    if (norm.includes(key.toLowerCase()) || key.toLowerCase().includes(norm)) return tier;
  }
  return 3;
}

// ── Factor 1: Player Type Risk (PRIMARY) ────────────────────────────

function assessHitterTypeRisk(metrics: {
  chase?: number | null;
  contact?: number | null;
  whiff?: number | null;
  barrel?: number | null;
  lineDrive?: number | null;
  avgEv?: number | null;
  ev90?: number | null;
  pull?: number | null;
  gb?: number | null;
  bb?: number | null;
}): RiskFactor {
  let risk = 50; // start neutral
  let reasons: string[] = [];

  // High chase + high whiff = volatile approach, higher risk
  const chase = metrics.chase;
  const contact = metrics.contact;
  const whiff = metrics.whiff;
  const barrel = metrics.barrel;
  const ld = metrics.lineDrive;
  const ev = metrics.avgEv;

  if (chase != null) {
    if (chase > 32) { risk += 15; reasons.push("high chase rate"); }
    else if (chase > 28) { risk += 7; }
    else if (chase < 22) { risk -= 10; reasons.push("disciplined approach"); }
  }

  if (contact != null) {
    if (contact > 82) { risk -= 15; reasons.push("elite contact"); }
    else if (contact > 75) { risk -= 8; }
    else if (contact < 65) { risk += 15; reasons.push("swing-and-miss concerns"); }
    else if (contact < 70) { risk += 8; }
  }

  if (whiff != null) {
    if (whiff > 30) { risk += 12; reasons.push("high whiff rate"); }
    else if (whiff < 18) { risk -= 8; }
  }

  // High contact + high LD + moderate EV = safer floor profile
  if (ld != null && ld > 22 && contact != null && contact > 75) {
    risk -= 10;
    reasons.push("high line drive, contact-oriented");
  }

  // Low EV but high contact = safe floor
  if (ev != null && ev < 85 && contact != null && contact > 78) {
    risk -= 5;
    reasons.push("contact-over-power profile");
  }

  // High barrel + high EV = premium bat, lower risk
  if (barrel != null && barrel > 10 && ev != null && ev > 88) {
    risk -= 12;
    reasons.push("premium hard-hit profile");
  }

  // High barrel but high chase = boom-or-bust
  if (barrel != null && barrel > 8 && chase != null && chase > 30) {
    risk += 10;
    reasons.push("boom-or-bust profile");
  }

  // Walk rate as indicator of approach quality
  if (metrics.bb != null) {
    if (metrics.bb > 12) { risk -= 8; reasons.push("strong walk rate"); }
    else if (metrics.bb < 5) { risk += 8; reasons.push("low walk rate"); }
  }

  risk = clamp(risk);
  const detail = reasons.length > 0 ? reasons.slice(0, 3).join("; ") : "Standard profile";
  return { label: "Player Type", score: risk, grade: toGrade(risk), detail };
}

function assessPitcherTypeRisk(metrics: {
  stuffPlus?: number | null;
  whiffPct?: number | null;
  bbPct?: number | null;
  chase?: number | null;
  barrel?: number | null;
  hardHit?: number | null;
  gb?: number | null;
  izWhiff?: number | null;
}): RiskFactor {
  let risk = 50;
  let reasons: string[] = [];

  const stuff = metrics.stuffPlus;
  const whiff = metrics.whiffPct;
  const bb = metrics.bbPct;
  const barrel = metrics.barrel;
  const hh = metrics.hardHit;
  const gb = metrics.gb;

  // Stuff+ driven assessment
  if (stuff != null) {
    if (stuff >= 110) { risk -= 15; reasons.push("elite Stuff+"); }
    else if (stuff >= 100) { risk -= 5; }
    else if (stuff < 90) { risk += 15; reasons.push("below-avg Stuff+"); }
    else if (stuff < 95) { risk += 8; }
  }

  // Whiff rate
  if (whiff != null) {
    if (whiff >= 28) { risk -= 10; reasons.push("elite swing-and-miss"); }
    else if (whiff < 18) { risk += 12; reasons.push("low whiff rate"); }
  }

  // Walk rate — control risk
  if (bb != null) {
    if (bb > 12) { risk += 15; reasons.push("high walk rate"); }
    else if (bb > 9) { risk += 7; }
    else if (bb < 5) { risk -= 10; reasons.push("excellent control"); }
  }

  // Hard hit / barrel against — contact quality allowed
  if (hh != null) {
    if (hh > 40) { risk += 12; reasons.push("high hard-hit allowed"); }
    else if (hh < 28) { risk -= 8; reasons.push("limits hard contact"); }
  }
  if (barrel != null) {
    if (barrel > 8) { risk += 10; reasons.push("barrel-prone"); }
    else if (barrel < 4) { risk -= 8; }
  }

  // Ground ball rate — high GB = safer
  if (gb != null) {
    if (gb > 50) { risk -= 8; reasons.push("ground ball pitcher"); }
    else if (gb < 35) { risk += 8; reasons.push("fly ball heavy"); }
  }

  risk = clamp(risk);
  const detail = reasons.length > 0 ? reasons.slice(0, 3).join("; ") : "Standard profile";
  return { label: "Player Type", score: risk, grade: toGrade(risk), detail };
}

// ── Factor 2: Competition Factor ────────────────────────────────────

function assessCompetitionRisk(conference: string | null | undefined, confStuffPlus?: number | null, confHitterTalentPlus?: number | null): RiskFactor {
  const tier = getConfTier(conference);
  let risk: number;
  let detailParts: string[] = [];

  if (tier === 1) {
    risk = 10;
    detailParts.push("Power conference — elite competition");
  } else if (tier === 2) {
    risk = 30;
    detailParts.push("Strong conference — quality competition");
  } else if (tier === 3) {
    risk = 55;
    detailParts.push("Mid-tier conference — stats may be inflated");
  } else {
    risk = 75;
    detailParts.push("Lower conference — significant inflation risk");
  }

  // Adjust with actual conference metrics
  if (confStuffPlus != null) {
    if (confStuffPlus > 102) { risk = Math.max(risk - 10, 0); detailParts.push(`Conf Stuff+ ${Math.round(confStuffPlus)}`); }
    else if (confStuffPlus < 96) { risk = Math.min(risk + 10, 100); detailParts.push(`Conf Stuff+ ${Math.round(confStuffPlus)}`); }
    else { detailParts.push(`Conf Stuff+ ${Math.round(confStuffPlus)}`); }
  }

  if (confHitterTalentPlus != null) {
    if (confHitterTalentPlus > 105) { risk = Math.max(risk - 5, 0); detailParts.push(`Conf Hitter Talent+ ${Math.round(confHitterTalentPlus)}`); }
    else if (confHitterTalentPlus < 95) { risk = Math.min(risk + 5, 100); detailParts.push(`Conf Hitter Talent+ ${Math.round(confHitterTalentPlus)}`); }
    else { detailParts.push(`Conf Hitter Talent+ ${Math.round(confHitterTalentPlus)}`); }
  }

  return { label: "Competition", score: clamp(risk), grade: toGrade(clamp(risk)), detail: detailParts.join("; ") };
}

// ── Factor 3: Performance Trajectory ────────────────────────────────

function assessTrajectory(seasons: any[], playerType: "hitter" | "pitcher"): { factor: RiskFactor; trajectory: Trajectory } {
  if (!seasons || seasons.length < 2) {
    return {
      factor: { label: "Trajectory", score: 40, grade: "Moderate", detail: "Insufficient multi-year data" },
      trajectory: "Unknown",
    };
  }

  // Sort ascending by season
  const sorted = [...seasons].sort((a, b) => Number(a.Season) - Number(b.Season));
  const recent = sorted[sorted.length - 1];
  const prior = sorted[sorted.length - 2];

  let trajectory: Trajectory;
  let risk: number;
  let detail: string;

  if (playerType === "hitter") {
    const recentOps = (Number(recent.OBP || 0) + Number(recent.SLG || 0)) || null;
    const priorOps = (Number(prior.OBP || 0) + Number(prior.SLG || 0)) || null;

    if (recentOps == null || priorOps == null) {
      trajectory = "Unknown";
      risk = 40;
      detail = "Cannot compare seasons";
    } else {
      const delta = recentOps - priorOps;
      if (delta > 0.040) { trajectory = "Progressing"; risk = 15; detail = `OPS improved ${delta > 0 ? "+" : ""}${delta.toFixed(3)} year-over-year`; }
      else if (delta > -0.020) { trajectory = "Plateau"; risk = 35; detail = `OPS steady (${delta >= 0 ? "+" : ""}${delta.toFixed(3)} YoY)`; }
      else { trajectory = "Regressing"; risk = 65; detail = `OPS declined ${delta.toFixed(3)} year-over-year`; }
    }
  } else {
    const recentEra = Number(recent.ERA);
    const priorEra = Number(prior.ERA);

    if (!Number.isFinite(recentEra) || !Number.isFinite(priorEra)) {
      trajectory = "Unknown";
      risk = 40;
      detail = "Cannot compare seasons";
    } else {
      const delta = recentEra - priorEra; // negative = improvement for pitchers
      if (delta < -0.30) { trajectory = "Progressing"; risk = 15; detail = `ERA improved ${Math.abs(delta).toFixed(2)} year-over-year`; }
      else if (delta < 0.30) { trajectory = "Plateau"; risk = 35; detail = `ERA steady (${delta >= 0 ? "+" : ""}${delta.toFixed(2)} YoY)`; }
      else { trajectory = "Regressing"; risk = 65; detail = `ERA rose ${delta.toFixed(2)} year-over-year`; }
    }
  }

  return { factor: { label: "Trajectory", score: clamp(risk), grade: toGrade(clamp(risk)), detail }, trajectory };
}

// ── Factor 4: Sample Size Risk ──────────────────────────────────────

function assessSampleSize(pa: number | null | undefined, ip: number | null | undefined, playerType: "hitter" | "pitcher"): RiskFactor {
  if (playerType === "hitter") {
    const n = pa ?? 0;
    let risk: number;
    let detail: string;
    if (n >= 200) { risk = 10; detail = `${n} PA — reliable sample`; }
    else if (n >= 150) { risk = 25; detail = `${n} PA — adequate sample`; }
    else if (n >= 100) { risk = 50; detail = `${n} PA — limited sample`; }
    else if (n >= 50) { risk = 70; detail = `${n} PA — small sample, proceed with caution`; }
    else { risk = 90; detail = `${n || 0} PA — very small sample`; }
    return { label: "Sample Size", score: risk, grade: toGrade(risk), detail };
  } else {
    const n = ip ?? 0;
    let risk: number;
    let detail: string;
    if (n >= 80) { risk = 10; detail = `${n.toFixed(0)} IP — reliable sample`; }
    else if (n >= 50) { risk = 25; detail = `${n.toFixed(0)} IP — adequate sample`; }
    else if (n >= 30) { risk = 50; detail = `${n.toFixed(0)} IP — limited sample`; }
    else if (n >= 15) { risk = 70; detail = `${n.toFixed(0)} IP — small sample`; }
    else { risk = 90; detail = `${(n || 0).toFixed(0)} IP — very small sample`; }
    return { label: "Sample Size", score: risk, grade: toGrade(risk), detail };
  }
}

// ── Factor 5: Workload Risk (Pitchers Only) ─────────────────────────

function assessWorkload(ip: number | null | undefined, classYear: string | null | undefined): RiskFactor {
  const innings = ip ?? 0;
  const cls = (classYear || "").toLowerCase();

  // Thresholds by class year
  let highThreshold: number;
  let moderateThreshold: number;
  if (cls.includes("fr")) { highThreshold = 60; moderateThreshold = 40; }
  else if (cls.includes("so")) { highThreshold = 85; moderateThreshold = 65; }
  else if (cls.includes("jr")) { highThreshold = 100; moderateThreshold = 80; }
  else { highThreshold = 110; moderateThreshold = 90; } // Sr/Gr

  let risk: number;
  let detail: string;
  if (innings >= highThreshold) {
    risk = 70;
    detail = `${innings.toFixed(0)} IP — heavy workload for ${classYear || "class year"}`;
  } else if (innings >= moderateThreshold) {
    risk = 40;
    detail = `${innings.toFixed(0)} IP — moderate workload`;
  } else {
    risk = 15;
    detail = `${innings.toFixed(0)} IP — manageable workload`;
  }

  return { label: "Workload", score: clamp(risk), grade: toGrade(clamp(risk)), detail };
}

// ── Summary Generator ───────────────────────────────────────────────

function buildSummary(grade: RiskGrade, trajectory: Trajectory, factors: RiskFactor[], playerType: "hitter" | "pitcher"): string {
  const typeRisk = factors.find((f) => f.label === "Player Type");
  const compRisk = factors.find((f) => f.label === "Competition");
  const parts: string[] = [];

  // Lead with overall assessment
  if (grade === "Low") parts.push("Low-risk profile with a stable floor.");
  else if (grade === "Moderate") parts.push("Moderate risk profile — solid but with some variance factors.");
  else if (grade === "Elevated") parts.push("Elevated risk — multiple concerns present.");
  else parts.push("High-risk profile — significant concerns across multiple factors.");

  // Trajectory
  if (trajectory === "Progressing") parts.push("Performance trending upward.");
  else if (trajectory === "Regressing") parts.push("Performance has declined year-over-year.");

  // Type risk detail
  if (typeRisk && typeRisk.detail !== "Standard profile") {
    parts.push(typeRisk.detail.charAt(0).toUpperCase() + typeRisk.detail.slice(1) + ".");
  }

  // Competition flag
  if (compRisk && compRisk.score >= 55) {
    parts.push("Conference competition level suggests stats may be inflated.");
  }

  return parts.join(" ");
}

// ── Public API ──────────────────────────────────────────────────────

export interface HitterRiskInput {
  conference?: string | null;
  confStuffPlus?: number | null;
  confHitterTalentPlus?: number | null;
  careerSeasons?: any[];
  pa?: number | null;
  // Scouting metrics
  chase?: number | null;
  contact?: number | null;
  whiff?: number | null;
  barrel?: number | null;
  lineDrive?: number | null;
  avgEv?: number | null;
  ev90?: number | null;
  pull?: number | null;
  gb?: number | null;
  bb?: number | null;
}

export interface PitcherRiskInput {
  conference?: string | null;
  confStuffPlus?: number | null;
  confHitterTalentPlus?: number | null;
  careerSeasons?: any[];
  ip?: number | null;
  classYear?: string | null;
  // Scouting metrics
  stuffPlus?: number | null;
  whiffPct?: number | null;
  bbPct?: number | null;
  chase?: number | null;
  barrel?: number | null;
  hardHit?: number | null;
  gb?: number | null;
  izWhiff?: number | null;
}

export function assessHitterRisk(input: HitterRiskInput): RiskAssessment {
  const factors: RiskFactor[] = [];

  // 1. Player Type (weight: 40%)
  factors.push(assessHitterTypeRisk({
    chase: input.chase, contact: input.contact, whiff: input.whiff,
    barrel: input.barrel, lineDrive: input.lineDrive, avgEv: input.avgEv,
    ev90: input.ev90, pull: input.pull, gb: input.gb, bb: input.bb,
  }));

  // 2. Competition (weight: 25%)
  factors.push(assessCompetitionRisk(input.conference, input.confStuffPlus, input.confHitterTalentPlus));

  // 3. Trajectory (weight: 20%)
  const { factor: trajFactor, trajectory } = assessTrajectory(input.careerSeasons || [], "hitter");
  factors.push(trajFactor);

  // 4. Sample Size (weight: 15%)
  factors.push(assessSampleSize(input.pa, null, "hitter"));

  // Weighted composite
  const weights = [0.40, 0.25, 0.20, 0.15];
  const overall = clamp(Math.round(
    factors.reduce((sum, f, i) => sum + f.score * weights[i], 0)
  ));

  const grade = toGrade(overall);
  const summary = buildSummary(grade, trajectory, factors, "hitter");

  return { overall, grade, trajectory, factors, summary };
}

export function assessPitcherRisk(input: PitcherRiskInput): RiskAssessment {
  const factors: RiskFactor[] = [];

  // 1. Player Type (weight: 35%)
  factors.push(assessPitcherTypeRisk({
    stuffPlus: input.stuffPlus, whiffPct: input.whiffPct, bbPct: input.bbPct,
    chase: input.chase, barrel: input.barrel, hardHit: input.hardHit,
    gb: input.gb, izWhiff: input.izWhiff,
  }));

  // 2. Competition (weight: 20%)
  factors.push(assessCompetitionRisk(input.conference, input.confStuffPlus, input.confHitterTalentPlus));

  // 3. Trajectory (weight: 20%)
  const { factor: trajFactor, trajectory } = assessTrajectory(input.careerSeasons || [], "pitcher");
  factors.push(trajFactor);

  // 4. Sample Size (weight: 15%)
  factors.push(assessSampleSize(null, input.ip, "pitcher"));

  // 5. Workload (weight: 10%)
  factors.push(assessWorkload(input.ip, input.classYear));

  // Weighted composite
  const weights = [0.35, 0.20, 0.20, 0.15, 0.10];
  const overall = clamp(Math.round(
    factors.reduce((sum, f, i) => sum + f.score * weights[i], 0)
  ));

  const grade = toGrade(overall);
  const summary = buildSummary(grade, trajectory, factors, "pitcher");

  return { overall, grade, trajectory, factors, summary };
}
