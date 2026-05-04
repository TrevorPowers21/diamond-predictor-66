/**
 * RSTR IQ — Player Risk Assessment Engine
 *
 * Answers five questions in order of importance:
 *  1. How good is this player?              → Projection (wRC+ / pRV+)
 *  2. How reliable is the skillset?          → Skillset (profile variance)
 *  3. How reliable is the competition?       → Competition (testing level)
 *  4. How is he trending?                    → Trajectory (YoY)
 *  5. Is the sample size large enough?       → Sample Size
 *  6. (Pitchers) How heavy is the workload?  → Workload
 *
 * Each factor produces a 0–100 risk score (higher = riskier).
 * When a factor has no data (null score), its weight redistributes across remaining factors.
 * Overall risk = weighted composite → grade (Low / Moderate / Elevated / High).
 */

// ── Types ───────────────────────────────────────────────────────────

export type RiskGrade = "Low" | "Moderate" | "Elevated" | "High";
export type Trajectory = "Progressing" | "Plateau" | "Regressing" | "Unknown";

export interface RiskFactor {
  label: string;
  score: number | null;   // 0–100, or null when data is unavailable
  grade: RiskGrade | "Unknown";
  detail: string;         // one-line explanation
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

// ── Factor 1: Projection (PRIMARY) ──────────────────────────────────
// "How good is this player?" — anchored by projected wRC+ (hitters) or pRV+ (pitchers).
// Higher projection = lower risk of being a non-contributor.

function assessHitterProjection(pWrcPlus: number | null | undefined): RiskFactor {
  if (pWrcPlus == null || !Number.isFinite(pWrcPlus)) {
    return { label: "Projection", score: null, grade: "Unknown", detail: "Projection unavailable" };
  }
  const v = pWrcPlus;
  let risk: number;
  let tier: string;
  if (v >= 150) { risk = 5;  tier = "elite projected output"; }
  else if (v >= 130) { risk = 15; tier = "All-American caliber projection"; }
  else if (v >= 115) { risk = 25; tier = "All-Conference+ projection"; }
  else if (v >= 105) { risk = 35; tier = "above-average starter projection"; }
  else if (v >= 95)  { risk = 45; tier = "average starter projection"; }
  else if (v >= 85)  { risk = 60; tier = "below-average projection"; }
  else if (v >= 75)  { risk = 75; tier = "bench/depth projection"; }
  else               { risk = 88; tier = "org depth projection"; }
  return {
    label: "Projection",
    score: risk,
    grade: toGrade(risk),
    detail: `Proj ${Math.round(v)} wRC+; ${tier}`,
  };
}

function assessPitcherProjection(prvPlus: number | null | undefined): RiskFactor {
  if (prvPlus == null || !Number.isFinite(prvPlus)) {
    return { label: "Projection", score: null, grade: "Unknown", detail: "Projection unavailable" };
  }
  const v = prvPlus;
  let risk: number;
  let tier: string;
  if (v >= 160) { risk = 5;  tier = "elite projected output"; }
  else if (v >= 140) { risk = 15; tier = "All-American caliber projection"; }
  else if (v >= 120) { risk = 25; tier = "All-Conference+ projection"; }
  else if (v >= 110) { risk = 35; tier = "above-average starter projection"; }
  else if (v >= 95)  { risk = 45; tier = "average starter projection"; }
  else if (v >= 85)  { risk = 60; tier = "below-average projection"; }
  else if (v >= 75)  { risk = 75; tier = "bench/depth projection"; }
  else               { risk = 88; tier = "org depth projection"; }
  return {
    label: "Projection",
    score: risk,
    grade: toGrade(risk),
    detail: `Proj ${Math.round(v)} pRV+; ${tier}`,
  };
}

// ── Factor 2: Skillset Reliability ──────────────────────────────────
// "How reliable is this player's skillset?" — profile variance driver.

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

  // ── Chase & Contact are the PRIMARY risk drivers ──
  // A hitter can survive with bad chase IF contact is good (can recover from bad swings).
  // A hitter can survive with low contact IF chase is good (selective, makes pitchers work).
  // BOTH below average = highest risk — the profile that gets exposed at higher levels.
  const chase = metrics.chase;
  const contact = metrics.contact;
  const whiff = metrics.whiff;
  const barrel = metrics.barrel;
  const ld = metrics.lineDrive;
  const ev = metrics.avgEv;

  // ── CONTACT% is the #1 risk driver. CHASE% is #2. EV is a distant #3. ──
  //
  // Contact below ~65% is a major red flag regardless of anything else.
  // You can have elite chase and still be high risk if you can't put the bat on the ball.
  // Chase discipline helps but cannot fully compensate for truly poor contact.
  //
  const goodChase = chase != null && chase < 22;
  const eliteChase = chase != null && chase < 19;
  const badChase = chase != null && chase > 28;
  const veryBadChase = chase != null && chase > 32;
  const goodContact = contact != null && contact > 80;
  const eliteContact = contact != null && contact > 85;
  const badContact = contact != null && contact < 70;
  const veryBadContact = contact != null && contact < 65;

  // ── Step 1: Contact% — always evaluated first, largest impact ──
  if (contact != null) {
    if (contact < 66.7) {
      risk += 28; reasons.push("bottom 5% contact rate — major swing-and-miss risk");
    } else if (contact < 68) {
      risk += 18; reasons.push("very low contact — vulnerable to better pitching");
    } else if (contact < 70) {
      risk += 8;
    } else if (eliteContact) {
      risk -= 18; reasons.push("elite contact — carries at any level");
    } else if (goodContact) {
      risk -= 10; reasons.push("plus contact");
    }
  }

  // ── Step 2: Chase% — #2 factor, mitigates or compounds contact ──
  if (chase != null) {
    if (chase > 34) {
      risk += 16; reasons.push("very high chase rate");
    } else if (chase > 30) {
      risk += 12; reasons.push("high chase rate");
    } else if (chase > 28) {
      risk += 8; reasons.push("above-avg chase rate");
    } else if (chase > 25) {
      risk += 4;
    } else if (eliteChase) {
      risk -= 10; reasons.push("elite plate discipline");
    } else if (goodChase) {
      risk -= 5; reasons.push("plus discipline");
    }
  }

  // ── Chase/Contact interaction bonuses ──
  // Both bad = compounding penalty (on top of individual penalties above)
  if (badChase && badContact) {
    risk += 12;
    reasons.push("chase + contact combination most exposed at higher competition");
  }
  // Both elite = compounding bonus
  if (eliteChase && eliteContact) {
    risk -= 10;
    reasons.push("elite approach — top-tier chase + contact floor");
  } else if (goodChase && goodContact) {
    risk -= 6;
    reasons.push("plus approach — low chase + good contact floor");
  }
  // Good chase partially compensates very bad contact — but NOT fully
  if (veryBadContact && goodChase) {
    risk -= 5; // small offset, NOT a full rescue
    reasons.push("chase discipline helps but does not fully offset contact concerns");
  }

  if (whiff != null) {
    if (whiff > 30) { risk += 6; reasons.push("high whiff rate"); }
    else if (whiff < 15) { risk -= 4; reasons.push("plus bat-to-ball"); }
  }

  // ── Step 3: Exit Velocity / EV90 — distant #3 factor ──
  // Weak contact gets exposed but this is less predictive than chase/contact.
  const ev90 = metrics.ev90;
  if (ev != null) {
    if (ev < 83) { risk += 5; reasons.push("below-avg exit velo — weak contact quality"); }
    else if (ev < 85) { risk += 3; }
    else if (ev > 92) { risk -= 4; reasons.push("elite exit velocity"); }
    else if (ev > 89) { risk -= 2; reasons.push("plus exit velocity"); }
  }
  if (ev90 != null) {
    if (ev90 < 95) { risk += 4; reasons.push("low EV90 — ceiling concern"); }
    else if (ev90 > 104) { risk -= 3; reasons.push("elite top-end power"); }
    else if (ev90 > 100) { risk -= 1; reasons.push("plus top-end power"); }
  }

  // High contact + high LD = safer floor profile
  if (ld != null && ld > 22 && goodContact) {
    risk -= 8;
    reasons.push("high line drive, contact-oriented");
  }

  // Low EV but high contact = safe floor (contact compensates for lack of power)
  if (ev != null && ev < 85 && goodContact) {
    risk -= 4;
    reasons.push("contact-over-power profile");
  }

  // High barrel + high EV = premium bat, lower risk
  // BUT NOT when both contact and chase are bad — power can't rescue a feared profile
  if (barrel != null && barrel > 10 && ev != null && ev > 88) {
    if (badContact && badChase) {
      // No bonus — power doesn't rescue when both safety valves are gone
      reasons.push("power present but can't offset contact + chase concerns");
    } else {
      risk -= 10;
      reasons.push("premium hard-hit profile");
    }
  }

  // High barrel but high chase = boom-or-bust
  if (barrel != null && barrel > 8 && badChase) {
    risk += 12;
    reasons.push("boom-or-bust — power undermined by chase");
  }

  // Walk rate as indicator of approach quality
  if (metrics.bb != null) {
    if (metrics.bb > 12) { risk -= 6; reasons.push("strong walk rate"); }
    else if (metrics.bb < 5) { risk += 6; reasons.push("low walk rate"); }
  }

  risk = clamp(risk);
  const detail = reasons.length > 0 ? reasons.slice(0, 3).join("; ") : "Standard profile";
  return { label: "Skillset", score: risk, grade: toGrade(risk), detail };
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
  const chase = metrics.chase;
  const barrel = metrics.barrel;
  const hh = metrics.hardHit;
  const gb = metrics.gb;
  const izWhiff = metrics.izWhiff;

  // ── #1: Stuff+ — dominant anchor. Stuff is stuff regardless of competition. ──
  // NCAA Stuff+ distribution is tight — 108+ is ~99th percentile.
  if (stuff != null) {
    if (stuff >= 115) { risk -= 24; reasons.push("elite Stuff+"); }
    else if (stuff >= 108) { risk -= 18; reasons.push("plus Stuff+"); }
    else if (stuff >= 103) { risk -= 10; reasons.push("above-avg Stuff+"); }
    else if (stuff >= 100) { risk -= 4; }
    else if (stuff < 85) { risk += 20; reasons.push("well below-avg Stuff+"); }
    else if (stuff < 90) { risk += 14; reasons.push("below-avg Stuff+"); }
    else if (stuff < 95) { risk += 7; }
  }

  // ── #2: BB% — close second, biggest variance driver. Command is command. ──
  // NCAA BB% distribution: <5% ~90th pctl, <6% ~85th, <7% ~75th, >10% ~25th, >13% ~10th
  if (bb != null) {
    if (bb > 14) { risk += 18; reasons.push("very high walk rate — major command concern"); }
    else if (bb > 12) { risk += 14; reasons.push("high walk rate"); }
    else if (bb > 10) { risk += 8; reasons.push("elevated walk rate"); }
    else if (bb > 8) { risk += 4; }
    else if (bb < 4) { risk -= 16; reasons.push("elite command"); }
    else if (bb < 5.5) { risk -= 12; reasons.push("plus command"); }
    else if (bb < 7) { risk -= 6; reasons.push("above-avg command"); }
  }

  // ── Stuff + BB% interaction — the core risk combos ──
  // Average stuff + below-avg command = nothing to lean on
  if (stuff != null && stuff < 100 && bb != null && bb > 10) {
    risk += 10;
    reasons.push("average stuff + poor command — high-risk combination");
  }
  // Elite stuff + elite command = very low risk, period
  if (stuff != null && stuff >= 108 && bb != null && bb < 6) {
    risk -= 10;
    reasons.push("elite stuff + elite command");
  }
  // Plus stuff + plus command = low risk
  if (stuff != null && stuff >= 103 && stuff < 108 && bb != null && bb < 7) {
    risk -= 5;
    reasons.push("plus stuff + plus command");
  }

  // ── #3: Hard Hit% / Barrel% — red flag when elevated, gets worse at higher levels ──
  // CONTEXT: 4-seam FB pitchers with high whiff will naturally give up harder contact
  // when the ball IS hit — that's the profile, not a red flag. Only penalize hard hit
  // when the pitcher lacks swing-and-miss to justify it.
  const hasWhiff = whiff != null && whiff >= 25; // high-whiff pitcher — hard hit is expected
  if (hh != null) {
    if (hasWhiff) {
      // High-whiff pitcher: hard hit is part of the profile — minimal penalty
      if (hh > 45) { risk += 5; reasons.push("very high hard hit — elevated even for a swing-and-miss profile"); }
      else if (hh < 25) { risk -= 4; reasons.push("suppresses contact and misses bats"); }
    } else {
      // Low-whiff pitcher: hard hit is a real problem — can't miss bats AND gets hit hard
      if (hh > 40) { risk += 14; reasons.push("gets hit hard without swing-and-miss — red flag"); }
      else if (hh > 36) { risk += 8; reasons.push("elevated hard contact without whiff to offset"); }
      else if (hh < 25) { risk -= 6; reasons.push("elite contact suppression"); }
      else if (hh < 30) { risk -= 3; }
    }
  }
  if (barrel != null) {
    if (hasWhiff) {
      // High-whiff: barrel is less alarming — only flag extremes
      if (barrel > 12) { risk += 5; reasons.push("barrel rate elevated even with swing-and-miss"); }
      else if (barrel < 4) { risk -= 4; reasons.push("plus barrel suppression + whiff"); }
    } else {
      // Low-whiff: barrel is a major concern
      if (barrel > 10) { risk += 12; reasons.push("barrel-prone — gets worse against better hitters"); }
      else if (barrel > 7) { risk += 6; reasons.push("elevated barrel rate allowed"); }
      else if (barrel < 3) { risk -= 6; reasons.push("elite barrel suppression"); }
      else if (barrel < 5) { risk -= 3; }
    }
  }

  // ── High barrel + low whiff = bad recipe at higher levels ──
  if (barrel != null && barrel > 7 && whiff != null && whiff < 20) {
    risk += 10;
    reasons.push("gets barreled without swing-and-miss to compensate");
  }

  // ── #4: IZ Whiff% — stuff confirmation / challenge ──
  if (izWhiff != null) {
    // IZ whiff confirms Stuff+ — high IZ whiff with high Stuff+ = real deal
    if (izWhiff >= 20) { risk -= 6; reasons.push("elite in-zone whiff — stuff confirmed"); }
    else if (izWhiff >= 16) { risk -= 3; }
    // Low IZ whiff challenges Stuff+ — model says good stuff but hitters aren't missing in zone
    else if (izWhiff < 10) { risk += 6; reasons.push("low IZ whiff — stuff not generating misses in zone"); }
    else if (izWhiff < 12) { risk += 3; }
  }
  // Stuff+ high but IZ whiff low = flag
  if (stuff != null && stuff >= 105 && izWhiff != null && izWhiff < 12) {
    risk += 5;
    reasons.push("Stuff+ doesn't match in-zone swing-and-miss");
  }

  // ── #5: Chase% — flags BB% instability. High chase = BB% artificially low. ──
  // Chase fluctuates most with competition — at higher levels chase drops, BB% rises.
  if (chase != null) {
    if (chase > 35) { risk += 5; reasons.push("high chase rate — BB% may rise against better hitters"); }
    else if (chase > 30) { risk += 3; }
    else if (chase < 18) { risk -= 3; }
  }
  // High chase + low BB% = unstable command picture
  if (chase != null && chase > 30 && bb != null && bb < 6) {
    risk += 4;
    reasons.push("low BB% may be masked by undisciplined opposing lineups");
  }

  // ── #6: Whiff% — only meaningful relative to IZ whiff and chase context ──
  // Discounted — whiff is polluted by chase. High whiff + high chase = inflated.
  if (whiff != null) {
    if (whiff >= 30 && izWhiff != null && izWhiff >= 16) { risk -= 4; reasons.push("legitimate swing-and-miss"); }
    else if (whiff < 16) { risk += 4; reasons.push("limited swing-and-miss"); }
  }
  // Whiff high but IZ whiff low = chase-driven, not stuff-driven
  if (whiff != null && whiff >= 25 && izWhiff != null && izWhiff < 12) {
    risk += 5;
    reasons.push("whiff rate inflated by chase — not real swing-and-miss");
  }

  // ── GB% — translatable floor note, not a risk weight. ──
  // High GB% from a good sinker translates. Noted positively but minimal risk impact.
  if (gb != null) {
    if (gb > 55) { risk -= 3; reasons.push("elite ground ball rate — translatable floor"); }
    else if (gb > 50) { risk -= 1; }
    // Low GB% is not penalized — fly ball pitchers with good stuff are fine
  }

  risk = clamp(risk);
  const detail = reasons.length > 0 ? reasons.slice(0, 3).join("; ") : "Standard profile";
  return { label: "Skillset", score: risk, grade: toGrade(risk), detail };
}

// ── Factor 2: Competition Factor ────────────────────────────────────

/**
/**
 * Tier fallback — used by both hitter & pitcher when no metric is available.
 */
function tierFallbackRisk(conference: string | null | undefined): { risk: number; tierDetail: string } {
  const tier = getConfTier(conference);
  if (tier === 1) return { risk: 15, tierDetail: "Power conference (no metric data)" };
  if (tier === 2) return { risk: 35, tierDetail: "Strong conference (no metric data)" };
  if (tier === 3) return { risk: 55, tierDetail: "Mid-tier conference (no metric data)" };
  return { risk: 75, tierDetail: "Lower conference (no metric data)" };
}

function buildCompetitionFactor(
  conference: string | null | undefined,
  metric: number | null | undefined,
  metricLabel: string,
  riskFromMetric: (m: number) => { risk: number; gradeText: string },
): RiskFactor {
  let risk: number;
  const detailParts: string[] = [];

  if (metric != null && Number.isFinite(metric)) {
    const { risk: r, gradeText } = riskFromMetric(metric);
    risk = r;
    if (conference) detailParts.push(conference);
    detailParts.push(`${metricLabel} ${Math.round(metric)}`);
    detailParts.push(gradeText);
  } else {
    const fallback = tierFallbackRisk(conference);
    risk = fallback.risk;
    if (conference) detailParts.push(conference);
    detailParts.push(fallback.tierDetail);
  }

  return { label: "Competition", score: clamp(risk), grade: toGrade(clamp(risk)), detail: detailParts.join("; ") };
}

/**
 * Hitter competition risk — uses Stuff+ (pitching quality faced).
 * Calibrated against the realistic D1 range (~92–108).
 * NEC / SWAC at the bottom (~92) land in High (red).
 */
function assessHitterCompetitionRisk(conference: string | null | undefined, confStuffPlus?: number | null): RiskFactor {
  return buildCompetitionFactor(conference, confStuffPlus, "Stuff+", (m) => {
    if (m >= 108) return { risk: 5,  gradeText: "elite competition" };
    if (m >= 105) return { risk: 12, gradeText: "top-tier competition" };
    if (m >= 102) return { risk: 22, gradeText: "above-avg competition" };
    if (m >= 100) return { risk: 32, gradeText: "solid competition" };
    if (m >= 98)  return { risk: 45, gradeText: "average competition" };
    if (m >= 96)  return { risk: 58, gradeText: "below-avg competition" };
    if (m >= 94)  return { risk: 70, gradeText: "weak competition — stats may be inflated" };
    if (m >= 92)  return { risk: 80, gradeText: "bottom-tier competition — significant inflation risk" };
    return { risk: 90, gradeText: "very weak competition — stats unreliable" };
  });
}

/**
 * Pitcher competition risk — uses Hitter Talent+ (hitting quality faced).
 * Wider range than Stuff+ (~70–117) since HT+ aggregates OPR + Stuff+ + wRC+.
 * NCAA average is ~103.
 */
function assessPitcherCompetitionRisk(conference: string | null | undefined, confHitterTalentPlus?: number | null): RiskFactor {
  return buildCompetitionFactor(conference, confHitterTalentPlus, "Hitter Talent+", (m) => {
    if (m >= 115) return { risk: 5,  gradeText: "elite competition" };
    if (m >= 110) return { risk: 12, gradeText: "top-tier competition" };
    if (m >= 105) return { risk: 22, gradeText: "above-avg competition" };
    if (m >= 100) return { risk: 35, gradeText: "solid competition" };
    if (m >= 95)  return { risk: 50, gradeText: "average competition" };
    if (m >= 90)  return { risk: 62, gradeText: "below-avg competition" };
    if (m >= 85)  return { risk: 73, gradeText: "weak competition — stats may be inflated" };
    if (m >= 78)  return { risk: 82, gradeText: "bottom-tier competition — significant inflation risk" };
    return { risk: 90, gradeText: "very weak competition — stats unreliable" };
  });
}

// ── Factor 3: Performance Trajectory ────────────────────────────────

function assessTrajectory(seasons: any[], playerType: "hitter" | "pitcher"): { factor: RiskFactor; trajectory: Trajectory } {
  if (!seasons || seasons.length === 0) {
    return {
      factor: { label: "Trajectory", score: null, grade: "Unknown", detail: "No multi-year data" },
      trajectory: "Unknown",
    };
  }
  if (seasons.length < 2) {
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
  // When PA/IP is not provided at all (undefined), skip the factor entirely
  if (playerType === "hitter" && pa == null) {
    return { label: "Sample Size", score: null, grade: "Unknown", detail: "Sample size unavailable" };
  }
  if (playerType === "pitcher" && ip == null) {
    return { label: "Sample Size", score: null, grade: "Unknown", detail: "Sample size unavailable" };
  }
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

// ── Factor 6: Durability (Pitchers Only) ────────────────────────────

/**
 * Assess durability / availability risk based on career IP patterns across seasons.
 * Flags pitchers with low cumulative innings over multiple years (injury history or
 * limited role) or dramatic workload dropoffs (likely injury or role loss).
 *
 * Returns null if < 2 seasons of data (can't assess pattern).
 */
function assessPitcherDurability(seasons: any[] | undefined): RiskFactor | null {
  if (!seasons || seasons.length < 2) return null;

  const seasonsWithData = seasons
    .map((s) => ({ season: Number(s.Season ?? s.season), ip: Number(s.IP ?? s.ip) || 0 }))
    .filter((s) => s.ip > 0);

  if (seasonsWithData.length < 2) return null;

  const totalIp = seasonsWithData.reduce((sum, s) => sum + s.ip, 0);
  const avgPerSeason = totalIp / seasonsWithData.length;

  // Detect dropoff: most recent season vs prior peak
  const sorted = [...seasonsWithData].sort((a, b) => b.season - a.season);
  const recentIp = sorted[0].ip;
  const priorPeak = Math.max(...sorted.slice(1).map((s) => s.ip));

  // Severe dropoff: was at a real workload, now minimal. Likely injury / role loss.
  if (priorPeak >= 30 && recentIp < 10) {
    const risk = 80;
    return {
      label: "Durability",
      score: risk,
      grade: toGrade(risk),
      detail: `Workload crashed from ${priorPeak.toFixed(0)} IP to ${recentIp.toFixed(0)} IP — injury or role loss concern`,
    };
  }

  // Chronic low availability: multi-season but never builds volume
  if (seasonsWithData.length >= 2 && avgPerSeason < 15) {
    const risk = 70;
    return {
      label: "Durability",
      score: risk,
      grade: toGrade(risk),
      detail: `Only ${totalIp.toFixed(0)} IP across ${seasonsWithData.length} seasons — limited availability history`,
    };
  }

  // Moderate dropoff
  if (priorPeak >= 40 && recentIp < priorPeak * 0.4) {
    const risk = 55;
    return {
      label: "Durability",
      score: risk,
      grade: toGrade(risk),
      detail: `Workload dropped from ${priorPeak.toFixed(0)} IP to ${recentIp.toFixed(0)} IP — possible injury or role change`,
    };
  }

  // Healthy pattern
  const risk = 20;
  return {
    label: "Durability",
    score: risk,
    grade: toGrade(risk),
    detail: `${totalIp.toFixed(0)} IP across ${seasonsWithData.length} seasons — healthy workload history`,
  };
}

// ── Summary Generator ───────────────────────────────────────────────

function buildSummary(grade: RiskGrade, trajectory: Trajectory, factors: RiskFactor[], playerType: "hitter" | "pitcher"): string {
  const projection = factors.find((f) => f.label === "Projection");
  const skillset = factors.find((f) => f.label === "Skillset");
  const compRisk = factors.find((f) => f.label === "Competition");
  const parts: string[] = [];

  // Lead with overall assessment
  if (grade === "Low") parts.push("Low-risk profile with a stable floor.");
  else if (grade === "Moderate") parts.push("Moderate risk profile — solid but with some variance factors.");
  else if (grade === "Elevated") parts.push("Elevated risk — multiple concerns present.");
  else parts.push("High-risk profile — significant concerns across multiple factors.");

  // Projection headline
  if (projection && projection.score != null && projection.detail !== "Projection unavailable") {
    parts.push(projection.detail.charAt(0).toUpperCase() + projection.detail.slice(1) + ".");
  }

  // Trajectory
  if (trajectory === "Progressing") parts.push("Performance trending upward.");
  else if (trajectory === "Regressing") parts.push("Performance has declined year-over-year.");

  // Skillset detail
  if (skillset && skillset.detail !== "Standard profile") {
    parts.push(skillset.detail.charAt(0).toUpperCase() + skillset.detail.slice(1) + ".");
  }

  // Competition flag
  if (compRisk && compRisk.score != null && compRisk.score >= 55) {
    parts.push("Competition level suggests stats may be inflated or skillset under-tested.");
  }

  return parts.join(" ");
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Composite weighted-average helper that safely skips null-scored factors.
 * Remaining factor weights are renormalized so the overall still sums to 100%.
 */
function computeComposite(factors: RiskFactor[], weights: number[]): number {
  let weightedSum = 0;
  let activeWeight = 0;
  factors.forEach((f, i) => {
    if (f.score != null && Number.isFinite(f.score)) {
      weightedSum += f.score * weights[i];
      activeWeight += weights[i];
    }
  });
  if (activeWeight <= 0) return 50; // no data at all — neutral fallback
  return clamp(Math.round(weightedSum / activeWeight));
}

export interface HitterRiskInput {
  conference?: string | null;
  /** Projected wRC+ for next season (from player_predictions.p_wrc_plus) */
  projectedWrcPlus?: number | null;
  /** Stuff+ — the pitching quality hitters face in this conference */
  confStuffPlus?: number | null;
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
  /** Current pRV+ (proxy for projection until a pitcher-prediction model exists) */
  projectedPrvPlus?: number | null;
  /** Hitter Talent+ — computed: PR+ + 1.25*(Stuff+-100) + 0.75*(100-wRC+) */
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

  // 1. Projection — "How good is he?" (weight: 35%)
  factors.push(assessHitterProjection(input.projectedWrcPlus));

  // 2. Skillset — "How reliable is the skillset?" (weight: 25%)
  factors.push(assessHitterTypeRisk({
    chase: input.chase, contact: input.contact, whiff: input.whiff,
    barrel: input.barrel, lineDrive: input.lineDrive, avgEv: input.avgEv,
    ev90: input.ev90, pull: input.pull, gb: input.gb, bb: input.bb,
  }));

  // 3. Competition — "How reliable is the competition?" (weight: 20%)
  factors.push(assessHitterCompetitionRisk(input.conference, input.confStuffPlus));

  // 4. Trajectory — "How is he trending?" (weight: 12%)
  const { factor: trajFactor, trajectory } = assessTrajectory(input.careerSeasons || [], "hitter");
  factors.push(trajFactor);

  // 5. Sample Size — "Is the sample large enough?" (weight: 8%)
  factors.push(assessSampleSize(input.pa, null, "hitter"));

  const weights = [0.35, 0.25, 0.20, 0.12, 0.08];
  const overall = computeComposite(factors, weights);
  const grade = toGrade(overall);
  const summary = buildSummary(grade, trajectory, factors, "hitter");

  return { overall, grade, trajectory, factors, summary };
}

export function assessPitcherRisk(input: PitcherRiskInput): RiskAssessment {
  const factors: RiskFactor[] = [];

  // 1. Projection — "How good is he?" (weight: 30%)
  factors.push(assessPitcherProjection(input.projectedPrvPlus));

  // 2. Skillset — "How reliable is the skillset?" (weight: 22%)
  factors.push(assessPitcherTypeRisk({
    stuffPlus: input.stuffPlus, whiffPct: input.whiffPct, bbPct: input.bbPct,
    chase: input.chase, barrel: input.barrel, hardHit: input.hardHit,
    gb: input.gb, izWhiff: input.izWhiff,
  }));

  // 3. Competition — "How reliable is the competition?" (weight: 18%)
  factors.push(assessPitcherCompetitionRisk(input.conference, input.confHitterTalentPlus));

  // 4. Trajectory — "How is he trending?" (weight: 12%)
  const { factor: trajFactor, trajectory } = assessTrajectory(input.careerSeasons || [], "pitcher");
  factors.push(trajFactor);

  // 5. Sample Size — "Is the sample large enough?" (weight: 6%)
  factors.push(assessSampleSize(null, input.ip, "pitcher"));

  // 6. Workload — current-season workload vs class (weight: 8%)
  factors.push(assessWorkload(input.ip, input.classYear));

  // 7. Durability — multi-season availability pattern (weight: 10%)
  //    Catches chronic low availability and workload crashes that Sample Size
  //    alone can't see (a pitcher with 60 IP as a Jr then 4 IP as a Sr).
  const durability = assessPitcherDurability(input.careerSeasons);
  if (durability) factors.push(durability);

  const weights = durability
    ? [0.28, 0.20, 0.16, 0.12, 0.06, 0.08, 0.10]
    : [0.30, 0.22, 0.18, 0.12, 0.08, 0.10];
  const overall = computeComposite(factors, weights);
  const grade = toGrade(overall);
  const summary = buildSummary(grade, trajectory, factors, "pitcher");

  return { overall, grade, trajectory, factors, summary };
}
