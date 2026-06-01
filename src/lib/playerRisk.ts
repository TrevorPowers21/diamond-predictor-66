/**
 * RSTR IQ — Player Risk Assessment Engine (rebuilt 2026-06-01)
 *
 * Five factors, identical weights for hitters and pitchers:
 *   Projection  35% — "How good is the projected output?" (quality risk)
 *   Skillset    25% — "How likely is the projection to hold at higher levels?"
 *   Competition 20% — "How tested is the projection by the conference faced?"
 *   Trajectory  12% — "Direction of the underlying skill metrics YoY"
 *   Sample Size  8% — "Is the underlying sample large enough to trust?"
 *
 * Locked principles:
 *   • Risk = quality risk + variance risk for a roster spot.
 *   • Penalties for bad signals ≈ 2× the rewards for elite signals.
 *   • All thresholds empirically anchored on 2026 D1 distributions
 *     (see docs/RISK_BUCKETS_2026_06_01.md for derivation).
 *
 * Null-data handling: any factor whose data is missing returns score=null;
 * remaining factor weights renormalize. If all five are null, fallback to 50.
 */

// ── Types ───────────────────────────────────────────────────────────

export type RiskGrade = "Low" | "Moderate" | "Elevated" | "High";
export type Trajectory = "Progressing" | "Plateau" | "Regressing" | "Unknown";

export interface RiskFactor {
  label: string;
  score: number | null;
  grade: RiskGrade | "Unknown";
  detail: string;
}

export interface RiskAssessment {
  overall: number;
  grade: RiskGrade;
  trajectory: Trajectory;
  factors: RiskFactor[];
  summary: string;
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

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// ── Conference Tier Fallback ────────────────────────────────────────
// Used when Stuff+ / OPR for the conference isn't available.

const CONF_TIER: Record<string, number> = {
  SEC: 1, ACC: 1, "Big 12": 1, "Big Ten": 1, "Pac-12": 1,
  AAC: 2, "Big East": 2, "Mountain West": 2, WCC: 2, Colonial: 2,
  "Sun Belt": 2, "Conference USA": 2, "Missouri Valley": 2, "A-10": 2,
  MAC: 3, WAC: 3, ASUN: 3, SoCon: 3, CAA: 3, Horizon: 3,
  "Big West": 3, Ivy: 3, Patriot: 3, "America East": 3,
  OVC: 4, "Big South": 4, Summit: 4, Southland: 4, NEC: 4,
  MAAC: 4, MEAC: 4, SWAC: 4,
};

export function getConfTier(conference: string | null | undefined): number {
  if (!conference) return 3;
  if (CONF_TIER[conference]) return CONF_TIER[conference];
  const norm = conference.toLowerCase().trim();
  for (const [key, tier] of Object.entries(CONF_TIER)) {
    if (norm.includes(key.toLowerCase()) || key.toLowerCase().includes(norm)) return tier;
  }
  return 3;
}

// ── Factor 1: Projection ────────────────────────────────────────────
// Empirically-anchored buckets (P5/P10/P25/P50/P75/P90/P95) for the projected
// wRC+ (hitters) and pRV+ (pitchers) distributions on 2026 prod.

export function assessHitterProjection(pWrcPlus: number | null | undefined): RiskFactor {
  if (!isNum(pWrcPlus)) {
    return { label: "Projection", score: null, grade: "Unknown", detail: "Projection unavailable" };
  }
  let score: number;
  let tier: string;
  if (pWrcPlus >= 118) { score = 10; tier = "elite projected output"; }
  else if (pWrcPlus >= 108) { score = 25; tier = "plus projected output"; }
  else if (pWrcPlus >= 85) { score = 50; tier = "average starter projection"; }
  else if (pWrcPlus >= 73) { score = 65; tier = "below-average projection"; }
  else if (pWrcPlus >= 65) { score = 80; tier = "bench/depth projection"; }
  else { score = 90; tier = "org depth projection"; }
  return {
    label: "Projection",
    score,
    grade: toGrade(score),
    detail: `Proj ${Math.round(pWrcPlus)} wRC+; ${tier}`,
  };
}

export function assessPitcherProjection(prvPlus: number | null | undefined): RiskFactor {
  if (!isNum(prvPlus)) {
    return { label: "Projection", score: null, grade: "Unknown", detail: "Projection unavailable" };
  }
  let score: number;
  let tier: string;
  if (prvPlus >= 123) { score = 10; tier = "elite projected output"; }
  else if (prvPlus >= 111) { score = 25; tier = "plus projected output"; }
  else if (prvPlus >= 82) { score = 50; tier = "average starter projection"; }
  else if (prvPlus >= 64) { score = 65; tier = "below-average projection"; }
  else if (prvPlus >= 50) { score = 80; tier = "bench/depth projection"; }
  else { score = 90; tier = "org depth projection"; }
  return {
    label: "Projection",
    score,
    grade: toGrade(score),
    detail: `Proj ${Math.round(prvPlus)} pRV+; ${tier}`,
  };
}

// ── Factor 2: Skillset (Hitter) ─────────────────────────────────────
// Starts at neutral 50, applies asymmetric deltas. Penalties ≈ 2× rewards.

export interface HitterSkillsetMetrics {
  contact?: number | null;
  chase?: number | null;
  avgEv?: number | null;
  ev90?: number | null;
  barrel?: number | null;
  lineDrive?: number | null;
  gb?: number | null;
}

export function assessHitterTypeRisk(m: HitterSkillsetMetrics): RiskFactor {
  const hasAny = [m.contact, m.chase, m.avgEv, m.ev90, m.barrel, m.lineDrive, m.gb]
    .some((v) => isNum(v));
  if (!hasAny) {
    return { label: "Skillset", score: null, grade: "Unknown", detail: "Scouting data unavailable" };
  }

  let risk = 50;
  const reasons: string[] = [];

  // Contact% — primary driver. Empirical: P90≈86, P75≈82, P25≈72.3, P10≈67.5, P5≈64.6
  if (isNum(m.contact)) {
    if (m.contact < 65) { risk += 28; reasons.push("bottom 5% contact rate — major swing-and-miss risk"); }
    else if (m.contact < 67.5) { risk += 22; reasons.push("very low contact — vulnerable to better pitching"); }
    else if (m.contact < 72.3) { risk += 12; reasons.push("below-average contact"); }
    else if (m.contact >= 86) { risk -= 8; reasons.push("elite contact — carries at any level"); }
    else if (m.contact >= 82) { risk -= 4; reasons.push("plus contact"); }
  }

  // Chase% — secondary driver. Empirical: P10≈16.5, P25≈19.3, P75≈27, P90≈31, P95≈33.5
  if (isNum(m.chase)) {
    if (m.chase >= 33.5) { risk += 25; reasons.push("top-5% chase rate — significant exposure risk"); }
    else if (m.chase >= 31) { risk += 18; reasons.push("very high chase rate"); }
    else if (m.chase >= 27) { risk += 10; reasons.push("above-average chase rate"); }
    else if (m.chase <= 16.5) { risk -= 6; reasons.push("elite plate discipline"); }
    else if (m.chase <= 19.3) { risk -= 3; reasons.push("plus discipline"); }
  }

  // Chase × Contact interactions (locked rule: both bad = compounding penalty)
  const veryBadContact = isNum(m.contact) && m.contact < 68;
  const badContact = isNum(m.contact) && m.contact < 72;
  const goodContact = isNum(m.contact) && m.contact >= 82;
  const eliteContact = isNum(m.contact) && m.contact >= 86;
  const badChase = isNum(m.chase) && m.chase >= 27;
  const goodChase = isNum(m.chase) && m.chase <= 19.3;
  const eliteChase = isNum(m.chase) && m.chase <= 16.5;

  if (badChase && badContact) {
    risk += 12;
    reasons.push("chase + contact combination most exposed at higher competition");
  } else if (eliteChase && eliteContact) {
    risk -= 6;
    reasons.push("elite approach — top-tier chase + contact floor");
  } else if (goodChase && goodContact) {
    risk -= 3;
    reasons.push("plus approach — low chase + good contact");
  } else if (veryBadContact && goodChase) {
    risk -= 4;
    reasons.push("chase discipline helps but does not fully offset contact concerns");
  }

  // Avg EV — light weight consistency signal. Empirical: P50≈86, P10≈80, P90≈90.9
  if (isNum(m.avgEv)) {
    if (m.avgEv < 80) { risk += 10; reasons.push("very low avg exit velo — weak contact quality"); }
    else if (m.avgEv < 83) { risk += 5; }
    else if (m.avgEv > 91) { risk -= 2; reasons.push("plus exit velocity"); }
  }

  // EV90 — ceiling cap. Empirical: P50≈101.6, P10≈96.6, P90≈106.1
  if (isNum(m.ev90)) {
    if (m.ev90 < 96.6) { risk += 8; reasons.push("low EV90 — ceiling concern"); }
    else if (m.ev90 < 99) { risk += 5; }
    else if (m.ev90 > 106) { risk -= 4; reasons.push("elite top-end power"); }
  }

  // LD% × Contact bonus — stable high-floor archetype
  if (isNum(m.lineDrive) && m.lineDrive >= 25 && goodContact) {
    risk -= 6;
    reasons.push("line-drive contact profile — stable floor");
  }

  // Barrel% × Contact bonus — premium contact + power (new)
  if (isNum(m.barrel) && m.barrel >= 22 && goodContact) {
    risk -= 8;
    reasons.push("premium contact + power — stable high-floor profile");
  }

  // Barrel% + bad chase — boom-or-bust penalty
  if (isNum(m.barrel) && m.barrel >= 22 && badChase) {
    risk += 12;
    reasons.push("boom-or-bust — power undermined by chase");
  }

  // GB% — locked rule: high GB = power capped, low GB = feel for hitting in the air
  if (isNum(m.gb)) {
    if (m.gb >= 53) { risk += 6; reasons.push("high ground-ball rate — power output capped"); }
    else if (m.gb >= 48) { risk += 3; }
    else if (m.gb < 32) { risk -= 4; reasons.push("low ground-ball rate — feel for hitting in the air"); }
  }

  const final = clamp(Math.round(risk));
  return {
    label: "Skillset",
    score: final,
    grade: toGrade(final),
    detail: reasons.slice(0, 3).join("; ") || "Balanced scouting profile",
  };
}

// ── Factor 2: Skillset (Pitcher) ────────────────────────────────────

export interface PitcherSkillsetMetrics {
  stuffPlus?: number | null;
  whiffPct?: number | null;
  izWhiff?: number | null;
  bbPct?: number | null;
  hardHit?: number | null;
}

export function assessPitcherTypeRisk(m: PitcherSkillsetMetrics): RiskFactor {
  const hasAny = [m.stuffPlus, m.whiffPct, m.izWhiff, m.bbPct, m.hardHit].some((v) => isNum(v));
  if (!hasAny) {
    return { label: "Skillset", score: null, grade: "Unknown", detail: "Scouting data unavailable" };
  }

  let risk = 50;
  const reasons: string[] = [];

  // Stuff+ — anchor. Empirical: P90≈109, P75≈105, P50≈101, P25≈97.5, P10≈94.1
  if (isNum(m.stuffPlus)) {
    if (m.stuffPlus >= 109) { risk -= 10; reasons.push("elite Stuff+"); }
    else if (m.stuffPlus >= 105) { risk -= 5; reasons.push("plus Stuff+"); }
    else if (m.stuffPlus < 94.1) { risk += 22; reasons.push("well below-average Stuff+"); }
    else if (m.stuffPlus < 97.5) { risk += 12; reasons.push("below-average Stuff+"); }
  }

  // Whiff% with IZ Whiff% validation. The model rewards real swing-and-miss
  // (validated by in-zone whiffs) and ignores chase-inflated whiff totals.
  // Whiff% empirical: P90≈31, P75≈27, P50≈22.9, P10≈16.7
  // IZ Whiff% empirical: P75≈19.2, P50≈16.1, P25≈13.3, P10≈10.9
  if (isNum(m.whiffPct)) {
    const izOk = isNum(m.izWhiff);
    if (m.whiffPct >= 31) {
      if (izOk && m.izWhiff! >= 16) { risk -= 4; reasons.push("legitimate swing-and-miss — high whiff confirmed in zone"); }
      // else: no reward — high whiff but low IZ Whiff = chase-inflated
      else if (izOk) { reasons.push("high whiff but inflated by chase — not real swing-and-miss"); }
    } else if (m.whiffPct >= 27) {
      if (izOk && m.izWhiff! >= 14) { risk -= 2; reasons.push("plus swing-and-miss"); }
    } else if (m.whiffPct < 16.7) { risk += 14; reasons.push("very limited swing-and-miss"); }
    else if (m.whiffPct < 19.5) { risk += 8; reasons.push("limited swing-and-miss"); }
  }

  // BB% — close second to Stuff+. Empirical: P10≈6, P25≈8, P50≈10.2, P75≈12.8, P90≈15.5
  if (isNum(m.bbPct)) {
    if (m.bbPct >= 15.5) { risk += 22; reasons.push("very high walk rate — major command risk"); }
    else if (m.bbPct >= 12.8) { risk += 12; reasons.push("above-average walk rate"); }
    else if (m.bbPct <= 6) { risk -= 6; reasons.push("elite command"); }
    else if (m.bbPct <= 8) { risk -= 3; reasons.push("plus command"); }
  }

  // Stuff × BB interactions (mirrors hitter Chase × Contact)
  const eliteStuff = isNum(m.stuffPlus) && m.stuffPlus >= 109;
  const belowAvgStuff = isNum(m.stuffPlus) && m.stuffPlus < 94.1;
  const eliteBb = isNum(m.bbPct) && m.bbPct <= 6;
  const highBb = isNum(m.bbPct) && m.bbPct >= 12.8;
  if (belowAvgStuff && highBb) {
    risk += 10;
    reasons.push("below-average stuff + poor command — compounding risk");
  } else if (eliteStuff && eliteBb) {
    risk -= 4;
    reasons.push("elite stuff + elite command");
  }

  // Hard Hit% — penalty-only signal (batted-ball-luck dependence)
  // Empirical: P75≈40, P90≈44, P95≈47
  if (isNum(m.hardHit)) {
    if (m.hardHit >= 44) { risk += 12; reasons.push("very high hard-hit rate — luck-dependent"); }
    else if (m.hardHit >= 40) { risk += 6; reasons.push("above-average hard-hit rate"); }
  }

  const final = clamp(Math.round(risk));
  return {
    label: "Skillset",
    score: final,
    grade: toGrade(final),
    detail: reasons.slice(0, 3).join("; ") || "Balanced scouting profile",
  };
}

// ── Factor 3: Competition ───────────────────────────────────────────
// Empirical: Conf Stuff+ P10≈94.6, P25≈97.9, P50≈100, P75≈101.5, P90≈104.1
//            Conf OPR    P10≈55.8, P25≈89.3, P50≈95.3, P75≈101.3, P90≈108.3

export function assessHitterCompetitionRisk(
  conference: string | null | undefined,
  confStuffPlus?: number | null,
): RiskFactor {
  if (isNum(confStuffPlus)) {
    let score: number;
    let tier: string;
    if (confStuffPlus >= 104) { score = 10; tier = "elite conference pitching"; }
    else if (confStuffPlus >= 101.5) { score = 25; tier = "above-average competition"; }
    else if (confStuffPlus >= 97.9) { score = 50; tier = "average D1 competition"; }
    else if (confStuffPlus >= 94.6) { score = 70; tier = "below-average competition — stats may inflate"; }
    else { score = 85; tier = "weak competition — significant inflation risk"; }
    const confLabel = conference || "—";
    return {
      label: "Competition",
      score,
      grade: toGrade(score),
      detail: `${confLabel}; Stuff+ ${confStuffPlus.toFixed(1)}; ${tier}`,
    };
  }
  // Conference-tier fallback
  const tier = getConfTier(conference);
  const score = tier === 1 ? 20 : tier === 2 ? 40 : tier === 3 ? 60 : 75;
  return {
    label: "Competition",
    score,
    grade: toGrade(score),
    detail: `${conference || "Unknown"} (Tier ${tier})`,
  };
}

export function assessPitcherCompetitionRisk(
  conference: string | null | undefined,
  confHitterTalentPlus?: number | null,
): RiskFactor {
  if (isNum(confHitterTalentPlus)) {
    let score: number;
    let tier: string;
    if (confHitterTalentPlus >= 108) { score = 10; tier = "elite conference offense"; }
    else if (confHitterTalentPlus >= 101) { score = 25; tier = "above-average competition"; }
    else if (confHitterTalentPlus >= 89) { score = 50; tier = "average D1 competition"; }
    else if (confHitterTalentPlus >= 56) { score = 70; tier = "below-average competition — stats may inflate"; }
    else { score = 80; tier = "weak competition — significant inflation risk"; }
    const confLabel = conference || "—";
    return {
      label: "Competition",
      score,
      grade: toGrade(score),
      detail: `${confLabel}; OPR ${confHitterTalentPlus.toFixed(1)}; ${tier}`,
    };
  }
  const tier = getConfTier(conference);
  const score = tier === 1 ? 20 : tier === 2 ? 40 : tier === 3 ? 60 : 75;
  return {
    label: "Competition",
    score,
    grade: toGrade(score),
    detail: `${conference || "Unknown"} (Tier ${tier})`,
  };
}

// ── Factor 4: Trajectory ────────────────────────────────────────────
// Data-driven trajectory using underlying skill metrics (not production).
// 3 tiers with a wider neutral middle. Skip factor when <2 prior seasons.
//
// Hitter metrics: Contact% (±3.2), Chase% inverted (±3.2), Barrel% (±4)
// Pitcher metrics: Stuff+ (±2.5), BB% inverted (±2.5), Whiff% (±4)
// "Meaningful change" thresholds match the empirical P25/P75 YoY delta.

const HIT_TRAJ_THRESHOLDS = { contact: 3.2, chase: 3.2, barrel: 4 };
const PIT_TRAJ_THRESHOLDS = { stuffPlus: 2.5, bbPct: 2.5, whiffPct: 4 };

type SeasonRow = Record<string, any> & { Season?: number | null };

function pickLastTwo(seasons: SeasonRow[] | undefined): [SeasonRow, SeasonRow] | null {
  if (!Array.isArray(seasons) || seasons.length < 2) return null;
  const withSeason = seasons
    .filter((s) => isNum(s.Season))
    .sort((a, b) => (b.Season as number) - (a.Season as number));
  if (withSeason.length < 2) return null;
  return [withSeason[0], withSeason[1]];
}

function direction(delta: number, threshold: number, betterIsHigher: boolean): "up" | "flat" | "down" {
  if (Math.abs(delta) < threshold) return "flat";
  const positive = delta > 0;
  if (betterIsHigher) return positive ? "up" : "down";
  return positive ? "down" : "up"; // inverted (e.g. chase)
}

function assessHitterTrajectory(seasons: SeasonRow[] | undefined): { factor: RiskFactor; trajectory: Trajectory } {
  const pair = pickLastTwo(seasons);
  if (!pair) {
    return {
      factor: { label: "Trajectory", score: null, grade: "Unknown", detail: "Insufficient career data" },
      trajectory: "Unknown",
    };
  }
  const [curr, prior] = pair;

  const reads: { metric: string; dir: "up" | "flat" | "down" }[] = [];
  if (isNum(curr.contact) && isNum(prior.contact)) {
    reads.push({ metric: "Contact%", dir: direction(curr.contact - prior.contact, HIT_TRAJ_THRESHOLDS.contact, true) });
  }
  if (isNum(curr.chase) && isNum(prior.chase)) {
    reads.push({ metric: "Chase%", dir: direction(curr.chase - prior.chase, HIT_TRAJ_THRESHOLDS.chase, false) });
  }
  if (isNum(curr.barrel) && isNum(prior.barrel)) {
    reads.push({ metric: "Barrel%", dir: direction(curr.barrel - prior.barrel, HIT_TRAJ_THRESHOLDS.barrel, true) });
  }

  if (reads.length < 2) {
    return {
      factor: { label: "Trajectory", score: null, grade: "Unknown", detail: "Insufficient scouting data across seasons" },
      trajectory: "Unknown",
    };
  }

  const ups = reads.filter((r) => r.dir === "up").length;
  const downs = reads.filter((r) => r.dir === "down").length;

  let trajectory: Trajectory;
  let score: number;
  let detail: string;
  if (ups >= 2 && downs === 0) {
    trajectory = "Progressing"; score = 25;
    detail = `${ups} of ${reads.length} skill metrics improving YoY`;
  } else if (downs >= 2 && ups === 0) {
    trajectory = "Regressing"; score = 65;
    detail = `${downs} of ${reads.length} skill metrics declining YoY`;
  } else {
    trajectory = "Plateau"; score = 40;
    detail = `Skill metrics stable / mixed YoY`;
  }
  return {
    factor: { label: "Trajectory", score, grade: toGrade(score), detail },
    trajectory,
  };
}

function assessPitcherTrajectory(seasons: SeasonRow[] | undefined): { factor: RiskFactor; trajectory: Trajectory } {
  const pair = pickLastTwo(seasons);
  if (!pair) {
    return {
      factor: { label: "Trajectory", score: null, grade: "Unknown", detail: "Insufficient career data" },
      trajectory: "Unknown",
    };
  }
  const [curr, prior] = pair;

  const reads: { metric: string; dir: "up" | "flat" | "down" }[] = [];
  if (isNum(curr.stuff_plus) && isNum(prior.stuff_plus)) {
    reads.push({ metric: "Stuff+", dir: direction(curr.stuff_plus - prior.stuff_plus, PIT_TRAJ_THRESHOLDS.stuffPlus, true) });
  }
  if (isNum(curr.bb_pct) && isNum(prior.bb_pct)) {
    reads.push({ metric: "BB%", dir: direction(curr.bb_pct - prior.bb_pct, PIT_TRAJ_THRESHOLDS.bbPct, false) });
  }
  if (isNum(curr.miss_pct) && isNum(prior.miss_pct)) {
    reads.push({ metric: "Whiff%", dir: direction(curr.miss_pct - prior.miss_pct, PIT_TRAJ_THRESHOLDS.whiffPct, true) });
  }

  if (reads.length < 2) {
    return {
      factor: { label: "Trajectory", score: null, grade: "Unknown", detail: "Insufficient scouting data across seasons" },
      trajectory: "Unknown",
    };
  }

  const ups = reads.filter((r) => r.dir === "up").length;
  const downs = reads.filter((r) => r.dir === "down").length;

  let trajectory: Trajectory;
  let score: number;
  let detail: string;
  if (ups >= 2 && downs === 0) {
    trajectory = "Progressing"; score = 25;
    detail = `${ups} of ${reads.length} skill metrics improving YoY`;
  } else if (downs >= 2 && ups === 0) {
    trajectory = "Regressing"; score = 65;
    detail = `${downs} of ${reads.length} skill metrics declining YoY`;
  } else {
    trajectory = "Plateau"; score = 40;
    detail = `Skill metrics stable / mixed YoY`;
  }
  return {
    factor: { label: "Trajectory", score, grade: toGrade(score), detail },
    trajectory,
  };
}

// ── Factor 5: Sample Size ───────────────────────────────────────────
// Empirical hitter PA: P10≈95, P25≈130, P50≈184, P75≈224
// Empirical pitcher IP: P10≈23, P25≈28, P50≈37, P75≈52

function assessSampleSize(
  pa: number | null | undefined,
  ip: number | null | undefined,
  playerType: "hitter" | "pitcher",
): RiskFactor {
  const n = playerType === "hitter" ? pa : ip;
  if (!isNum(n)) {
    return { label: "Sample Size", score: null, grade: "Unknown", detail: "Sample size unavailable" };
  }
  const unit = playerType === "hitter" ? "PA" : "IP";
  const tiers = playerType === "hitter"
    ? [{ min: 225, score: 10, label: "reliable sample" },
       { min: 184, score: 25, label: "adequate sample" },
       { min: 130, score: 45, label: "limited sample" },
       { min: 95,  score: 65, label: "small sample, proceed with caution" }]
    : [{ min: 52, score: 10, label: "reliable sample" },
       { min: 37, score: 25, label: "adequate sample" },
       { min: 28, score: 45, label: "limited sample" },
       { min: 23, score: 65, label: "small sample" }];

  for (const t of tiers) {
    if (n >= t.min) {
      return {
        label: "Sample Size",
        score: t.score,
        grade: toGrade(t.score),
        detail: `${Math.round(n)} ${unit} — ${t.label}`,
      };
    }
  }
  return {
    label: "Sample Size",
    score: 80,
    grade: "High",
    detail: `${Math.round(n)} ${unit} — very small sample`,
  };
}

// ── Composite + Summary ─────────────────────────────────────────────

function computeComposite(factors: RiskFactor[], weights: number[]): number {
  const usable: Array<{ score: number; weight: number }> = [];
  for (let i = 0; i < factors.length; i++) {
    if (factors[i].score != null) usable.push({ score: factors[i].score as number, weight: weights[i] ?? 0 });
  }
  if (usable.length === 0) return 50;
  const totalWeight = usable.reduce((s, f) => s + f.weight, 0);
  if (totalWeight === 0) return 50;
  const weighted = usable.reduce((s, f) => s + (f.score * f.weight), 0) / totalWeight;
  return clamp(Math.round(weighted));
}

function buildSummary(
  grade: RiskGrade,
  trajectory: Trajectory,
  factors: RiskFactor[],
  playerType: "hitter" | "pitcher",
): string {
  const role = playerType === "hitter" ? "bat" : "arm";
  const proj = factors.find((f) => f.label === "Projection");
  const skill = factors.find((f) => f.label === "Skillset");
  const comp = factors.find((f) => f.label === "Competition");

  const parts: string[] = [];
  parts.push(`${grade} risk ${role}.`);
  if (proj?.detail && proj.score != null) parts.push(`${proj.detail}.`);
  if (trajectory !== "Unknown") parts.push(`Trajectory: ${trajectory}.`);
  if (skill?.detail && skill.score != null && skill.score >= 55) parts.push(`${skill.detail}.`);
  if (comp?.score != null && comp.score >= 55) parts.push(`${comp.detail}.`);
  return parts.join(" ");
}

// ── Public API ──────────────────────────────────────────────────────

export interface HitterRiskInput {
  conference?: string | null;
  /** Projected wRC+ for next season (from player_predictions.p_wrc_plus) */
  projectedWrcPlus?: number | null;
  /** Stuff+ — the pitching quality hitters face in this conference */
  confStuffPlus?: number | null;
  careerSeasons?: SeasonRow[];
  pa?: number | null;
  // Skillset metrics (current season)
  chase?: number | null;
  contact?: number | null;
  avgEv?: number | null;
  ev90?: number | null;
  barrel?: number | null;
  lineDrive?: number | null;
  gb?: number | null;
  // Back-compat (no longer scored, callers may still pass these — ignored)
  whiff?: number | null;
  pull?: number | null;
  bb?: number | null;
}

export interface PitcherRiskInput {
  conference?: string | null;
  /** Current pRV+ (proxy for projection until a pitcher-prediction model exists) */
  projectedPrvPlus?: number | null;
  /** Hitter Talent+ — computed: PR+ + 1.25*(Stuff+-100) + 0.75*(100-wRC+) */
  confHitterTalentPlus?: number | null;
  careerSeasons?: SeasonRow[];
  ip?: number | null;
  // Skillset metrics (current season)
  stuffPlus?: number | null;
  whiffPct?: number | null;
  izWhiff?: number | null;
  bbPct?: number | null;
  hardHit?: number | null;
  // Back-compat (no longer scored — ignored)
  chase?: number | null;
  barrel?: number | null;
  gb?: number | null;
  classYear?: string | null;
  k9?: number | null;
  bb9?: number | null;
  hr9?: number | null;
}

const HITTER_WEIGHTS = [0.35, 0.25, 0.20, 0.12, 0.08];
const PITCHER_WEIGHTS = [0.35, 0.25, 0.20, 0.12, 0.08];

export function assessHitterRisk(input: HitterRiskInput): RiskAssessment {
  const factors: RiskFactor[] = [];
  factors.push(assessHitterProjection(input.projectedWrcPlus));
  factors.push(assessHitterTypeRisk({
    contact: input.contact, chase: input.chase, avgEv: input.avgEv,
    ev90: input.ev90, barrel: input.barrel, lineDrive: input.lineDrive,
    gb: input.gb,
  }));
  factors.push(assessHitterCompetitionRisk(input.conference, input.confStuffPlus));
  const { factor: trajFactor, trajectory } = assessHitterTrajectory(input.careerSeasons);
  factors.push(trajFactor);
  factors.push(assessSampleSize(input.pa, null, "hitter"));

  const overall = computeComposite(factors, HITTER_WEIGHTS);
  const grade = toGrade(overall);
  const summary = buildSummary(grade, trajectory, factors, "hitter");
  return { overall, grade, trajectory, factors, summary };
}

export function assessPitcherRisk(input: PitcherRiskInput): RiskAssessment {
  const factors: RiskFactor[] = [];
  factors.push(assessPitcherProjection(input.projectedPrvPlus));
  factors.push(assessPitcherTypeRisk({
    stuffPlus: input.stuffPlus, whiffPct: input.whiffPct, izWhiff: input.izWhiff,
    bbPct: input.bbPct, hardHit: input.hardHit,
  }));
  factors.push(assessPitcherCompetitionRisk(input.conference, input.confHitterTalentPlus));
  const { factor: trajFactor, trajectory } = assessPitcherTrajectory(input.careerSeasons);
  factors.push(trajFactor);
  factors.push(assessSampleSize(null, input.ip, "pitcher"));

  const overall = computeComposite(factors, PITCHER_WEIGHTS);
  const grade = toGrade(overall);
  const summary = buildSummary(grade, trajectory, factors, "pitcher");
  return { overall, grade, trajectory, factors, summary };
}
