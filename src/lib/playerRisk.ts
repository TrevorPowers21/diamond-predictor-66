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

// ── Smooth scoring helpers ──────────────────────────────────────────
// Risk factors are anchored on empirical percentile values. Risk between
// anchors interpolates linearly, so a player on the boundary of a tier
// doesn't get a cliff effect (e.g. contact 81.6 vs 82.0 used to mean the
// difference between 0 and -4 risk — now it scales smoothly).

interface Anchor {
  /** Empirical value (must be sorted ascending across an anchor table) */
  value: number;
  /** Risk score or delta at this value */
  score: number;
}

/** Linear interpolation across an anchor table. Out-of-range values clamp. */
function interpolate(value: number, anchors: readonly Anchor[]): number {
  if (anchors.length === 0) return 0;
  if (value <= anchors[0].value) return anchors[0].score;
  if (value >= anchors[anchors.length - 1].value) return anchors[anchors.length - 1].score;
  for (let i = 0; i < anchors.length - 1; i++) {
    const lo = anchors[i];
    const hi = anchors[i + 1];
    if (value >= lo.value && value <= hi.value) {
      const t = hi.value === lo.value ? 0 : (value - lo.value) / (hi.value - lo.value);
      return lo.score + t * (hi.score - lo.score);
    }
  }
  return anchors[anchors.length - 1].score;
}

/**
 * Combo strength on 0..1 — how far the value sits between a "trigger floor"
 * (no contribution) and a "full ceiling" (full contribution). Linear scaling
 * inside the range. Used by hitter Skillset combos so a player who is just
 * below the binary plus cutoff still earns partial combo credit.
 */
function comboStrength(value: number, floor: number, ceiling: number, higherIsBetter: boolean): number {
  if (higherIsBetter) {
    if (value <= floor) return 0;
    if (value >= ceiling) return 1;
    return (value - floor) / (ceiling - floor);
  } else {
    if (value >= floor) return 0;
    if (value <= ceiling) return 1;
    return (floor - value) / (floor - ceiling);
  }
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

// Empirical hitter projection anchors (2026 D1, P5..P95).
// Median anchored at 35 (high Low) per the locked principle: average
// inputs shouldn't carry "Moderate" risk by default. Risk grades up only
// when projection actually drops below average.
const HITTER_PROJ_ANCHORS: readonly Anchor[] = [
  { value: 65,  score: 90 },  // bottom 5%
  { value: 73,  score: 78 },  // poor (P10)
  { value: 85,  score: 55 },  // below avg (P25)
  { value: 97,  score: 35 },  // average (P50) — top of Low band
  { value: 108, score: 15 },  // plus (P75)
  { value: 118, score: 5  },  // elite (P90)
] as const;

function tierLabelFromScore(score: number, kind: "projection" | "competition"): string {
  if (kind === "projection") {
    if (score <= 15) return "elite projected output";
    if (score <= 30) return "plus projected output";
    if (score <= 55) return "average starter projection";
    if (score <= 75) return "below-average projection";
    return "bench/depth projection";
  }
  if (score <= 15) return "elite competition";
  if (score <= 30) return "above-average competition";
  if (score <= 55) return "average D1 competition";
  if (score <= 75) return "below-average competition — stats may inflate";
  return "weak competition — significant inflation risk";
}

export function assessHitterProjection(pWrcPlus: number | null | undefined): RiskFactor {
  if (!isNum(pWrcPlus)) {
    return { label: "Projection", score: null, grade: "Unknown", detail: "Projection unavailable" };
  }
  const score = clamp(Math.round(interpolate(pWrcPlus, HITTER_PROJ_ANCHORS)));
  return {
    label: "Projection",
    score,
    grade: toGrade(score),
    detail: `Proj ${Math.round(pWrcPlus)} wRC+; ${tierLabelFromScore(score, "projection")}`,
  };
}

// Empirical pitcher projection anchors (2026 D1, P5..P95).
const PITCHER_PROJ_ANCHORS: readonly Anchor[] = [
  { value: 50,  score: 90 },
  { value: 64,  score: 78 },
  { value: 82,  score: 55 },
  { value: 97,  score: 35 },  // average (P50)
  { value: 111, score: 15 },
  { value: 123, score: 5  },
] as const;

export function assessPitcherProjection(prvPlus: number | null | undefined): RiskFactor {
  if (!isNum(prvPlus)) {
    return { label: "Projection", score: null, grade: "Unknown", detail: "Projection unavailable" };
  }
  const score = clamp(Math.round(interpolate(prvPlus, PITCHER_PROJ_ANCHORS)));
  return {
    label: "Projection",
    score,
    grade: toGrade(score),
    detail: `Proj ${Math.round(prvPlus)} pRV+; ${tierLabelFromScore(score, "projection")}`,
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

// ── Hitter Skillset anchor tables (smooth interpolation) ────────────
// Each anchor's `score` is the risk DELTA applied at that empirical value.
// Penalty side ≈ 2× reward side per the asymmetry principle.

const HIT_CONTACT_ANCHORS: readonly Anchor[] = [
  { value: 64.6, score: 28 },
  { value: 67.5, score: 22 },
  { value: 72.3, score: 12 },
  { value: 77.3, score: 0 },
  { value: 82.0, score: -4 },
  { value: 85.8, score: -8 },
] as const;

const HIT_CHASE_ANCHORS: readonly Anchor[] = [
  { value: 14.6, score: -6 },
  { value: 16.5, score: -6 },
  { value: 19.3, score: -3 },
  { value: 23.0, score: 0 },
  { value: 27.0, score: 10 },
  { value: 31.0, score: 18 },
  { value: 33.5, score: 25 },
] as const;

const HIT_AVG_EV_ANCHORS: readonly Anchor[] = [
  { value: 78.1, score: 10 },
  { value: 80.0, score: 10 },
  { value: 83.1, score: 5 },
  { value: 86.0, score: 0 },
  { value: 90.9, score: -2 },
  { value: 92.3, score: -2 },
] as const;

const HIT_EV90_ANCHORS: readonly Anchor[] = [
  { value: 95.0, score: 8 },
  { value: 96.6, score: 8 },
  { value: 99.0, score: 5 },
  { value: 101.6, score: 0 },
  { value: 106.1, score: -4 },
  { value: 107.5, score: -4 },
] as const;

const HIT_GB_ANCHORS: readonly Anchor[] = [
  { value: 28.5, score: -4 },
  { value: 32.0, score: 0 },
  { value: 48.0, score: 3 },
  { value: 53.0, score: 6 },
  { value: 57.0, score: 6 },
] as const;

// Baseline: average inputs net to 35 (top of Low). Below-average inputs
// push toward Moderate / Elevated; elite inputs reach the floor.
const HITTER_SKILLSET_BASELINE = 35;

export function assessHitterTypeRisk(m: HitterSkillsetMetrics): RiskFactor {
  const hasAny = [m.contact, m.chase, m.avgEv, m.ev90, m.barrel, m.lineDrive, m.gb]
    .some((v) => isNum(v));
  if (!hasAny) {
    return { label: "Skillset", score: null, grade: "Unknown", detail: "Scouting data unavailable" };
  }

  let risk = HITTER_SKILLSET_BASELINE;
  const reasons: string[] = [];

  // ── Individual metrics (smooth) ──
  if (isNum(m.contact)) {
    const d = interpolate(m.contact, HIT_CONTACT_ANCHORS);
    risk += d;
    if (d <= -6) reasons.push("elite contact — carries at any level");
    else if (d <= -2) reasons.push("plus contact");
    else if (d >= 22) reasons.push("very low contact — major swing-and-miss risk");
    else if (d >= 10) reasons.push("below-average contact");
  }

  if (isNum(m.chase)) {
    const d = interpolate(m.chase, HIT_CHASE_ANCHORS);
    risk += d;
    if (d <= -5) reasons.push("elite plate discipline");
    else if (d <= -2) reasons.push("plus discipline");
    else if (d >= 18) reasons.push("very high chase rate");
    else if (d >= 8) reasons.push("above-average chase rate");
  }

  if (isNum(m.avgEv)) {
    const d = interpolate(m.avgEv, HIT_AVG_EV_ANCHORS);
    risk += d;
    if (d <= -1.5) reasons.push("plus exit velocity");
    else if (d >= 8) reasons.push("weak exit velocity");
  }

  if (isNum(m.ev90)) {
    const d = interpolate(m.ev90, HIT_EV90_ANCHORS);
    risk += d;
    if (d <= -3) reasons.push("elite top-end power");
    else if (d >= 7) reasons.push("low EV90 — ceiling concern");
  }

  if (isNum(m.gb)) {
    const d = interpolate(m.gb, HIT_GB_ANCHORS);
    risk += d;
    if (d >= 5) reasons.push("high ground-ball rate — power output capped");
    else if (d <= -3) reasons.push("low ground-ball rate — feel for hitting in the air");
  }

  // ── Combo bonuses & penalties (smooth strength scaling) ──
  // Strength floors at P50 (no contribution) and ceil at the "elite" / "very bad" end
  // (full contribution). min(strengthA, strengthB) gates the combo magnitude.

  // Chase × Contact (locked rule: both bad compounds; both good rewards)
  if (isNum(m.chase) && isNum(m.contact)) {
    const chaseGoodStrength = comboStrength(m.chase, 23, 16.5, false);
    const contactGoodStrength = comboStrength(m.contact, 77.3, 85.8, true);
    const goodStrength = Math.min(chaseGoodStrength, contactGoodStrength);
    if (goodStrength > 0) {
      const delta = -6 * goodStrength;
      risk += delta;
      if (goodStrength >= 0.7) reasons.push("elite chase + contact floor");
      else if (goodStrength >= 0.3) reasons.push("plus approach — low chase + good contact");
    }

    const chaseBadStrength = comboStrength(m.chase, 23, 31, true);
    const contactBadStrength = comboStrength(m.contact, 77.3, 67.5, false);
    const badStrength = Math.min(chaseBadStrength, contactBadStrength);
    if (badStrength > 0) {
      const delta = 12 * badStrength;
      risk += delta;
      if (badStrength >= 0.5) reasons.push("chase + contact combo most exposed at higher competition");
    }
  }

  // LD × Contact bonus — high-floor contact-oriented archetype
  if (isNum(m.lineDrive) && isNum(m.contact)) {
    const ldStrength = comboStrength(m.lineDrive, 21.8, 25, true);
    const contactStrength = comboStrength(m.contact, 77.3, 82, true);
    const s = Math.min(ldStrength, contactStrength);
    if (s > 0) {
      const delta = -6 * s;
      risk += delta;
      if (s >= 0.5) reasons.push("line-drive contact profile — stable floor");
    }
  }

  // Barrel × Contact bonus — premium contact + power (new)
  if (isNum(m.barrel) && isNum(m.contact)) {
    const barrelStrength = comboStrength(m.barrel, 16.8, 22, true);
    const contactStrength = comboStrength(m.contact, 77.3, 82, true);
    const s = Math.min(barrelStrength, contactStrength);
    if (s > 0) {
      const delta = -8 * s;
      risk += delta;
      if (s >= 0.5) reasons.push("premium contact + power — stable high-floor profile");
    }
  }

  // Barrel + bad chase — boom-or-bust penalty
  if (isNum(m.barrel) && isNum(m.chase)) {
    const barrelStrength = comboStrength(m.barrel, 16.8, 22, true);
    const chaseBadStrength = comboStrength(m.chase, 23, 31, true);
    const s = Math.min(barrelStrength, chaseBadStrength);
    if (s > 0) {
      const delta = 12 * s;
      risk += delta;
      if (s >= 0.5) reasons.push("boom-or-bust — power undermined by chase");
    }
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

// ── Pitcher Skillset anchor tables ──────────────────────────────────

const PIT_STUFF_ANCHORS: readonly Anchor[] = [
  { value: 91.6,  score: 22 },
  { value: 94.1,  score: 12 },
  { value: 97.5,  score: 0 },
  { value: 101.4, score: 0 },
  { value: 105.4, score: -5 },
  { value: 109.3, score: -10 },
] as const;

const PIT_WHIFF_ANCHORS: readonly Anchor[] = [
  { value: 15.2, score: 14 },
  { value: 16.7, score: 14 },
  { value: 19.5, score: 8 },
  { value: 22.9, score: 0 },
  { value: 27.0, score: -2 },
  { value: 31.1, score: -4 },
] as const;

const PIT_BB_ANCHORS: readonly Anchor[] = [
  { value: 6.0,  score: -6 },
  { value: 8.0,  score: -3 },
  { value: 10.2, score: 0 },
  { value: 12.8, score: 12 },
  { value: 15.5, score: 22 },
] as const;

const PIT_HARDHIT_ANCHORS: readonly Anchor[] = [
  // Penalty-only per Trevor's locked rule. No reward for low hard hit.
  { value: 30, score: 0 },
  { value: 40, score: 6 },
  { value: 44, score: 12 },
  { value: 47, score: 12 },
] as const;

const PITCHER_SKILLSET_BASELINE = 35;

export function assessPitcherTypeRisk(m: PitcherSkillsetMetrics): RiskFactor {
  const hasAny = [m.stuffPlus, m.whiffPct, m.izWhiff, m.bbPct, m.hardHit].some((v) => isNum(v));
  if (!hasAny) {
    return { label: "Skillset", score: null, grade: "Unknown", detail: "Scouting data unavailable" };
  }

  let risk = PITCHER_SKILLSET_BASELINE;
  const reasons: string[] = [];

  // Stuff+ (anchor)
  if (isNum(m.stuffPlus)) {
    const d = interpolate(m.stuffPlus, PIT_STUFF_ANCHORS);
    risk += d;
    if (d <= -8) reasons.push("elite Stuff+");
    else if (d <= -3) reasons.push("plus Stuff+");
    else if (d >= 18) reasons.push("well below-average Stuff+");
    else if (d >= 8) reasons.push("below-average Stuff+");
  }

  // Whiff% with IZ Whiff% validation. The bonus side (negative delta) is
  // scaled by how strongly the in-zone whiff rate confirms the stuff is
  // playing. Low IZ + high whiff = chase-inflated; we suppress the reward.
  if (isNum(m.whiffPct)) {
    let d = interpolate(m.whiffPct, PIT_WHIFF_ANCHORS);
    if (d < 0 && isNum(m.izWhiff)) {
      // IZ Whiff validation strength — 0 below 13, 1 at 16+
      const izStrength = comboStrength(m.izWhiff, 13, 16, true);
      d = d * izStrength;
      if (izStrength < 0.5 && m.whiffPct >= 27) {
        reasons.push("whiff inflated by chase — not real swing-and-miss");
      }
    }
    risk += d;
    if (d <= -3) reasons.push("legitimate swing-and-miss — high whiff confirmed in zone");
    else if (d <= -1) reasons.push("plus swing-and-miss");
    else if (d >= 10) reasons.push("very limited swing-and-miss");
    else if (d >= 5) reasons.push("limited swing-and-miss");
  }

  // BB% (close 2nd to Stuff+, asymmetric)
  if (isNum(m.bbPct)) {
    const d = interpolate(m.bbPct, PIT_BB_ANCHORS);
    risk += d;
    if (d <= -5) reasons.push("elite command");
    else if (d <= -2) reasons.push("plus command");
    else if (d >= 18) reasons.push("very high walk rate — major command risk");
    else if (d >= 8) reasons.push("above-average walk rate");
  }

  // Stuff × BB interactions (smoothed combo strength)
  if (isNum(m.stuffPlus) && isNum(m.bbPct)) {
    const stuffBadStrength = comboStrength(m.stuffPlus, 101.4, 94.1, false);
    const bbBadStrength = comboStrength(m.bbPct, 10.2, 15.5, true);
    const badStrength = Math.min(stuffBadStrength, bbBadStrength);
    if (badStrength > 0) {
      const delta = 10 * badStrength;
      risk += delta;
      if (badStrength >= 0.5) reasons.push("below-avg stuff + poor command — compounding risk");
    }

    const stuffGoodStrength = comboStrength(m.stuffPlus, 101.4, 109.3, true);
    const bbGoodStrength = comboStrength(m.bbPct, 10.2, 6, false);
    const goodStrength = Math.min(stuffGoodStrength, bbGoodStrength);
    if (goodStrength > 0) {
      const delta = -4 * goodStrength;
      risk += delta;
      if (goodStrength >= 0.7) reasons.push("elite stuff + elite command");
    }
  }

  // Hard Hit% (penalty-only)
  if (isNum(m.hardHit)) {
    const d = interpolate(m.hardHit, PIT_HARDHIT_ANCHORS);
    risk += d;
    if (d >= 10) reasons.push("very high hard-hit rate — luck-dependent");
    else if (d >= 4) reasons.push("above-average hard-hit rate");
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

// Conference Stuff+ (hitter's competition) — P5 ≈ 93, P50 ≈ 100, P90 ≈ 104
const CONF_STUFF_ANCHORS: readonly Anchor[] = [
  { value: 93,  score: 85 },
  { value: 97.9, score: 60 },
  { value: 101.5, score: 35 },
  { value: 104, score: 10 },
  { value: 105, score: 10 },
] as const;

// Conference Overall Power Rating (pitcher's competition) — wider spread:
// P10 ≈ 56, P50 ≈ 95, P90 ≈ 108
const CONF_OPR_ANCHORS: readonly Anchor[] = [
  { value: 44, score: 85 },
  { value: 56, score: 75 },
  { value: 89, score: 50 },
  { value: 101, score: 25 },
  { value: 108, score: 10 },
  { value: 115, score: 10 },
] as const;

export function assessHitterCompetitionRisk(
  conference: string | null | undefined,
  confStuffPlus?: number | null,
): RiskFactor {
  if (isNum(confStuffPlus)) {
    const score = clamp(Math.round(interpolate(confStuffPlus, CONF_STUFF_ANCHORS)));
    return {
      label: "Competition",
      score,
      grade: toGrade(score),
      detail: `${conference || "—"}; Stuff+ ${confStuffPlus.toFixed(1)}; ${tierLabelFromScore(score, "competition")}`,
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

export function assessPitcherCompetitionRisk(
  conference: string | null | undefined,
  confHitterTalentPlus?: number | null,
): RiskFactor {
  if (isNum(confHitterTalentPlus)) {
    const score = clamp(Math.round(interpolate(confHitterTalentPlus, CONF_OPR_ANCHORS)));
    return {
      label: "Competition",
      score,
      grade: toGrade(score),
      detail: `${conference || "—"}; OPR ${confHitterTalentPlus.toFixed(1)}; ${tierLabelFromScore(score, "competition")}`,
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
// Trajectory: wRC+ / pRV+ delta is the headline. Underlying skill metrics
// validate the read — they can soften or harden the wRC+ direction by one
// tier, but not flip it. Examples:
//   wRC+ up + skills up   → Progressing (clean)
//   wRC+ up + skills down → Plateau (production up but unsustainable)
//   wRC+ flat + skills up → Progressing (quietly improving foundation)
//   wRC+ down + skills up → Plateau (foundation intact — bounce candidate)
//   wRC+ down + skills down → Regressing (clean decline)
//
// Meaningful-change thresholds:
//   wRC+ ±10  (≈ half a standard deviation of meaningful skill change)
//   pRV+ ±10
//   Hitter skills: Contact ±3.2, Chase ±3.2, Barrel ±4 (empirical P25/P75 YoY)
//   Pitcher skills: Stuff+ ±2.5, BB% ±2.5, Whiff% ±4

const WRC_DELTA_THRESHOLD = 10;
const PRV_DELTA_THRESHOLD = 10;
const HIT_SKILL_THRESHOLDS = { contact: 3.2, chase: 3.2, barrel: 4 };
const PIT_SKILL_THRESHOLDS = { stuffPlus: 2.5, bbPct: 2.5, whiffPct: 4 };

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
  return positive ? "down" : "up"; // inverted (e.g. chase, BB%)
}

/**
 * Compute wRC+ from raw slash stats per the locked formula:
 *   wRC+ = ((0.45·OBP + 0.30·SLG + 0.15·AVG + 0.10·ISO) / 0.364) · 100
 * Returns null if any required input is missing.
 */
function deriveWrcPlus(row: SeasonRow): number | null {
  const avg = row.AVG, obp = row.OBP, slg = row.SLG;
  if (!isNum(avg) || !isNum(obp) || !isNum(slg)) return null;
  const iso = slg - avg;
  return ((0.45 * obp + 0.30 * slg + 0.15 * avg + 0.10 * iso) / 0.364) * 100;
}

function classifySkills(
  reads: { dir: "up" | "flat" | "down" }[],
): "up" | "flat" | "down" {
  if (reads.length === 0) return "flat";
  const ups = reads.filter((r) => r.dir === "up").length;
  const downs = reads.filter((r) => r.dir === "down").length;
  if (ups >= 2 && downs === 0) return "up";
  if (downs >= 2 && ups === 0) return "down";
  return "flat";
}

/**
 * Combine headline (wRC+ or pRV+) direction with skills direction into a
 * single trajectory tier. wRC+ direction sets the base; skills shift it by
 * at most one tier in either direction.
 */
function combineTrajectory(
  headline: "up" | "flat" | "down",
  skills: "up" | "flat" | "down",
  headlineLabel: string,
): { trajectory: Trajectory; score: number; detail: string } {
  // Build a 3×3 lookup of (headline, skills) → trajectory
  const matrix: Record<string, { trajectory: Trajectory; score: number; note: string }> = {
    "up|up":     { trajectory: "Progressing", score: 20, note: `${headlineLabel} up; underlying skills validate it` },
    "up|flat":   { trajectory: "Progressing", score: 25, note: `${headlineLabel} up; skills steady` },
    "up|down":   { trajectory: "Plateau",     score: 45, note: `${headlineLabel} up but underlying skills regressed — unsustainable` },
    "flat|up":   { trajectory: "Progressing", score: 30, note: `${headlineLabel} steady; skills quietly improving` },
    "flat|flat": { trajectory: "Plateau",     score: 40, note: `${headlineLabel} steady; skills steady` },
    "flat|down": { trajectory: "Regressing",  score: 55, note: `${headlineLabel} steady but skills declining — caution` },
    "down|up":   { trajectory: "Plateau",     score: 45, note: `${headlineLabel} down but skills intact — bounce candidate` },
    "down|flat": { trajectory: "Regressing",  score: 60, note: `${headlineLabel} down; skills not improving` },
    "down|down": { trajectory: "Regressing",  score: 65, note: `${headlineLabel} down; skills also declining` },
  };
  const key = `${headline}|${skills}`;
  const entry = matrix[key] || matrix["flat|flat"];
  return { trajectory: entry.trajectory, score: entry.score, detail: entry.note };
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

  // Headline: derived wRC+ direction
  const currWrc = deriveWrcPlus(curr);
  const priorWrc = deriveWrcPlus(prior);
  if (currWrc == null || priorWrc == null) {
    return {
      factor: { label: "Trajectory", score: null, grade: "Unknown", detail: "Insufficient slash data across seasons" },
      trajectory: "Unknown",
    };
  }
  const headlineDir = direction(currWrc - priorWrc, WRC_DELTA_THRESHOLD, true);

  // Validators: skills direction (Contact / Chase / Barrel)
  const skillReads: { dir: "up" | "flat" | "down" }[] = [];
  if (isNum(curr.contact) && isNum(prior.contact)) {
    skillReads.push({ dir: direction(curr.contact - prior.contact, HIT_SKILL_THRESHOLDS.contact, true) });
  }
  if (isNum(curr.chase) && isNum(prior.chase)) {
    skillReads.push({ dir: direction(curr.chase - prior.chase, HIT_SKILL_THRESHOLDS.chase, false) });
  }
  if (isNum(curr.barrel) && isNum(prior.barrel)) {
    skillReads.push({ dir: direction(curr.barrel - prior.barrel, HIT_SKILL_THRESHOLDS.barrel, true) });
  }
  const skillsDir = classifySkills(skillReads);

  const { trajectory, score, detail } = combineTrajectory(headlineDir, skillsDir, "wRC+");
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

  // Headline: overall_pr_plus (= pRV+) direction. Higher is better.
  const currPrv = isNum(curr.overall_pr_plus) ? curr.overall_pr_plus : null;
  const priorPrv = isNum(prior.overall_pr_plus) ? prior.overall_pr_plus : null;
  if (currPrv == null || priorPrv == null) {
    return {
      factor: { label: "Trajectory", score: null, grade: "Unknown", detail: "Insufficient pRV+ data across seasons" },
      trajectory: "Unknown",
    };
  }
  const headlineDir = direction(currPrv - priorPrv, PRV_DELTA_THRESHOLD, true);

  // Validators: Stuff+ + BB% + Whiff% directions
  const skillReads: { dir: "up" | "flat" | "down" }[] = [];
  if (isNum(curr.stuff_plus) && isNum(prior.stuff_plus)) {
    skillReads.push({ dir: direction(curr.stuff_plus - prior.stuff_plus, PIT_SKILL_THRESHOLDS.stuffPlus, true) });
  }
  if (isNum(curr.bb_pct) && isNum(prior.bb_pct)) {
    skillReads.push({ dir: direction(curr.bb_pct - prior.bb_pct, PIT_SKILL_THRESHOLDS.bbPct, false) });
  }
  if (isNum(curr.miss_pct) && isNum(prior.miss_pct)) {
    skillReads.push({ dir: direction(curr.miss_pct - prior.miss_pct, PIT_SKILL_THRESHOLDS.whiffPct, true) });
  }
  const skillsDir = classifySkills(skillReads);

  const { trajectory, score, detail } = combineTrajectory(headlineDir, skillsDir, "pRV+");
  return {
    factor: { label: "Trajectory", score, grade: toGrade(score), detail },
    trajectory,
  };
}

// ── Factor 5: Sample Size ───────────────────────────────────────────
// Empirical hitter PA: P10≈95, P25≈130, P50≈184, P75≈224
// Empirical pitcher IP: P10≈23, P25≈28, P50≈37, P75≈52

// Sample-size anchors. Median sample (P50) anchored at 15 — at the median
// PA / IP we have plenty of data to evaluate, so risk should be very low
// by default. Risk only spikes when the sample is genuinely short.
const HIT_PA_ANCHORS: readonly Anchor[] = [
  { value: 50,  score: 80 },
  { value: 95,  score: 55 },
  { value: 130, score: 30 },
  { value: 184, score: 15 },  // median — plenty of data
  { value: 225, score: 5 },
  { value: 260, score: 5 },
] as const;

const PIT_IP_ANCHORS: readonly Anchor[] = [
  { value: 15, score: 80 },
  { value: 23, score: 55 },
  { value: 28, score: 30 },
  { value: 37, score: 15 },
  { value: 52, score: 5 },
  { value: 80, score: 5 },
] as const;

function sampleLabel(score: number): string {
  if (score <= 15) return "reliable sample";
  if (score <= 30) return "adequate sample";
  if (score <= 50) return "limited sample";
  if (score <= 70) return "small sample";
  return "very small sample";
}

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
  const anchors = playerType === "hitter" ? HIT_PA_ANCHORS : PIT_IP_ANCHORS;
  const score = clamp(Math.round(interpolate(n, anchors)));
  return {
    label: "Sample Size",
    score,
    grade: toGrade(score),
    detail: `${Math.round(n)} ${unit} — ${sampleLabel(score)}`,
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
