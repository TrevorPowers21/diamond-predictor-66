/**
 * Named scouting archetypes — canonical labels for both rule-based and AI
 * scouting report generators. Source of truth for archetype classification.
 *
 * Locked named archetypes have real exemplar players from the locked framework
 * (project_scouting_report_framework memory). Each archetype has:
 *   - A canonical id (`hitter:stevenson` / `pitcher:flora`)
 *   - A display tag used in the opener sentence
 *   - A detection function operating on metric values + percentiles
 *   - A description used as the AI system-prompt definition
 *
 * Catch-all archetypes (feared, balanced, etc.) cover players that don't
 * match a named exemplar. Every player gets exactly one archetype — falls
 * through to `balanced` if nothing else matches.
 *
 * Thresholds reference the empirical D1 distribution via
 * src/lib/scoutingPercentiles.ts — never hand-tuned magic numbers.
 */
import {
  HITTER_PERCENTILES,
  PITCHER_PERCENTILES,
  tierFor,
  type Tier,
} from "./scoutingPercentiles";

// ────────────────────────────────────────────────────────────────────────
// Type definitions
// ────────────────────────────────────────────────────────────────────────

export type HitterArchetypeId =
  | "stevenson"      // Named: premium-position power bat with contact risk
  | "amaral"         // Named: premium-position contact-first, capped ceiling
  | "gracia"         // Named: complete profile with data >> production gap
  | "shelton"        // Named: power bat, ultra-aggressive approach, YoY variance
  | "feared"         // Catch-all: bad chase + bad contact (high-risk profile)
  | "complete"       // Catch-all: plus across the board (no premium-pos disconnect)
  | "powerFirst"     // Catch-all: power + barrel but contact concerns
  | "contactFirst"   // Catch-all: contact + chase plus, no power tools
  | "balanced";      // Catch-all: doesn't fit any pattern

export type PitcherArchetypeId =
  | "flora"            // Named: elite stuff + elite command, 4S FB profile
  | "chaseDependent"   // Catch-all: high chase + low IZ whiff + low whiff (vulnerable up-level)
  | "sinker"           // Catch-all: high ground-ball + plus command (contact pitcher)
  | "stuffOverCommand" // Catch-all: elite stuff but BB%/command concerns
  | "command"          // Catch-all: average stuff + plus command (crafty)
  | "balanced";        // Catch-all: doesn't fit any pattern

export interface HitterArchetype {
  id: HitterArchetypeId;
  tag: string;           // Used in the opener sentence — e.g., "an elite approach with high-end power"
  description: string;   // Used in AI system prompt to define the archetype to the model
}

export interface PitcherArchetype {
  id: PitcherArchetypeId;
  tag: string;
  description: string;
}

// ────────────────────────────────────────────────────────────────────────
// Inputs for archetype detection
// ────────────────────────────────────────────────────────────────────────

export interface HitterDetectionInput {
  position: string | null;
  contact: number | null;       // raw value (e.g., 81.5)
  chase: number | null;
  avgEv: number | null;
  ev90: number | null;
  barrel: number | null;
  pull: number | null;
  laSweet: number | null;       // la_10_30
  popUp: number | null;
  bb: number | null;
  lineDrive: number | null;
  gb: number | null;
  // Production gap signal
  pWrcPlus: number | null;      // projection (production proxy)
}

export interface PitcherDetectionInput {
  stuffPlus: number | null;
  bbPct: number | null;
  chasePct: number | null;
  inZoneWhiffPct: number | null;
  missPct: number | null;       // whiff
  hardHitPct: number | null;
  barrelPct: number | null;
  groundPct: number | null;
  primaryPitchType?: string | null;  // "4S FB", "Sinker", etc.
}

// ────────────────────────────────────────────────────────────────────────
// Archetype registry — tag + description per id
// ────────────────────────────────────────────────────────────────────────

export const HITTER_ARCHETYPES: Record<HitterArchetypeId, HitterArchetype> = {
  stevenson: {
    id: "stevenson",
    tag: "elite raw power and an ultra-aggressive approach",
    description: "High ceiling / high variance. Premium-position bat (C/SS/CF) with plus or elite raw power but contact concerns that raise the variance. Approach trends ultra-aggressive. Profiles as a top-of-draft type if contact ticks up; org depth if it doesn't.",
  },
  amaral: {
    id: "amaral",
    tag: "elite contact and plus swing decisions",
    description: "Low variance / capped ceiling. Premium-position contact-first hitter (typically SS) with elite contact and plus chase but no power tools. High-floor regular at a premium position; ceiling is everyday role rather than impact bat.",
  },
  gracia: {
    id: "gracia",
    tag: "a complete profile with even more upside than the production shows",
    description: "Premium-position bat with elite data across the board (contact, chase, power, EV) but production hasn't fully caught up. Often has a pop-up flag muting production. The data points to a star-level outcome once the LA stabilizes.",
  },
  shelton: {
    id: "shelton",
    tag: "high-end power and an ultra-aggressive approach",
    description: "Plus power tools paired with ultra-aggressive approach. Big YoY swings — production fluctuates with the contact rate. Premium hitter when it clicks; can be exposed by upper-level pitching when it doesn't.",
  },
  feared: {
    id: "feared",
    tag: "significant approach and contact concerns",
    description: "Bad chase AND bad contact — power doesn't fully rescue. Vulnerable to good pitching, low floor.",
  },
  complete: {
    id: "complete",
    tag: "a complete, well-rounded offensive profile",
    description: "Plus contact, plus chase, plus power. Profiles as a regular starter with All-Conference upside.",
  },
  powerFirst: {
    id: "powerFirst",
    tag: "a strong feel for power",
    description: "Plus EV + plus barrel, but contact concerns raise the variance. Power can carry — provided contact rate doesn't collapse against higher-level arms.",
  },
  contactFirst: {
    id: "contactFirst",
    tag: "a contact-oriented profile",
    description: "Plus contact + plus swing decisions, no power tools. Low-strikeout profile but limited ceiling without LA development.",
  },
  balanced: {
    id: "balanced",
    tag: "a balanced offensive profile",
    description: "No single standout — average across the board.",
  },
};

export const PITCHER_ARCHETYPES: Record<PitcherArchetypeId, PitcherArchetype> = {
  flora: {
    id: "flora",
    tag: "elite stuff and elite command",
    description: "Elite Stuff+ (top 10% of D1) paired with elite command (BB% top 10%). Typically anchored by a 4S FB with high whiff and a plus secondary. Top-rotation profile.",
  },
  chaseDependent: {
    id: "chaseDependent",
    tag: "a chase-dependent profile",
    description: "High chase rate masking a low IZ whiff% and low overall whiff. Misses come from chase rather than stuff — vulnerable at higher levels where hitters lay off out-of-zone.",
  },
  sinker: {
    id: "sinker",
    tag: "a ground-ball-oriented sinker profile",
    description: "Elite GB% + plus command. Low whiff is expected and not alarming for the profile. Contact pitcher who relies on weak contact.",
  },
  stuffOverCommand: {
    id: "stuffOverCommand",
    tag: "elite stuff with command concerns",
    description: "Plus or elite Stuff+ but BB% / chase profile suggests command isn't there yet. High-leverage reliever ceiling; starter outcome depends on strike-throwing development.",
  },
  command: {
    id: "command",
    tag: "average stuff with plus command",
    description: "Below-average to average Stuff+ but plus command/BB%. Crafty backend rotation or middle reliever — survives on location and sequencing.",
  },
  balanced: {
    id: "balanced",
    tag: "a balanced pitching profile",
    description: "No standout strength — average across stuff, command, and contact suppression.",
  },
};

// ────────────────────────────────────────────────────────────────────────
// Detection functions
// ────────────────────────────────────────────────────────────────────────

const isPremiumPos = (pos: string | null): boolean =>
  !!pos && ["C", "SS", "CF"].some((p) => pos.toUpperCase().includes(p));

/**
 * Detect the best-fit hitter archetype. Named archetypes (Stevenson, Amaral,
 * Gracia, Shelton) win over catch-alls when they match. Always returns
 * exactly one archetype — falls through to "balanced" if nothing fits.
 */
export function detectHitterArchetype(input: HitterDetectionInput): HitterArchetypeId {
  const t = (metric: string, v: number | null) => v == null ? null : tierFor(v, HITTER_PERCENTILES[metric]);
  const isElite = (tier: Tier | null) => tier === "elite";
  const isPlus = (tier: Tier | null) => tier === "elite" || tier === "plus";
  const isAboveAvg = (tier: Tier | null) => isPlus(tier) || tier === "aboveAvg";
  const isBad = (tier: Tier | null) => tier === "poor" || tier === "bottom";

  const contactTier = t("contact", input.contact);
  const chaseTier = t("chase", input.chase);
  const evTier = t("avg_exit_velo", input.avgEv);
  const ev90Tier = t("ev90", input.ev90);
  const barrelTier = t("barrel", input.barrel);
  const popUpTier = t("pop_up", input.popUp);
  const laSweetTier = t("la_10_30", input.laSweet);
  const bbTier = t("bb", input.bb);

  const elitePower = isElite(evTier) || isElite(ev90Tier) || isElite(barrelTier);
  const plusPower = isPlus(evTier) || isPlus(ev90Tier) || isPlus(barrelTier);
  const noPower = !isAboveAvg(evTier) && !isAboveAvg(barrelTier);

  const eliteContact = isElite(contactTier);
  const plusContact = isPlus(contactTier);
  const badContact = isBad(contactTier);

  const eliteChase = isElite(chaseTier);
  const plusChase = isPlus(chaseTier);
  const badChase = isBad(chaseTier);
  const ultraAggressiveChase = chaseTier === "bottom";

  const popUpFlag = isBad(popUpTier);
  const premium = isPremiumPos(input.position);

  // Named archetypes first (specific to general)

  // Stevenson — premium-pos power bat with contact concerns
  if (premium && plusPower && badContact && (badChase || ultraAggressiveChase)) {
    return "stevenson";
  }

  // Amaral — premium-pos contact-first, no power
  if (premium && eliteContact && plusChase && noPower) {
    return "amaral";
  }

  // Gracia — premium-pos complete profile with production gap (pop-up flag)
  if (premium && plusContact && plusChase && plusPower && popUpFlag) {
    return "gracia";
  }

  // Shelton — power + ultra-aggressive approach (variance bat)
  if (plusPower && ultraAggressiveChase && !badContact) {
    return "shelton";
  }

  // Catch-all buckets

  if (badContact && badChase) return "feared";
  if (plusContact && plusChase && plusPower) return "complete";
  if (plusPower && !plusContact) return "powerFirst";
  if (plusContact && plusChase && noPower) return "contactFirst";

  return "balanced";
}

/**
 * Detect the best-fit pitcher archetype.
 */
export function detectPitcherArchetype(input: PitcherDetectionInput): PitcherArchetypeId {
  const t = (metric: string, v: number | null) => v == null ? null : tierFor(v, PITCHER_PERCENTILES[metric]);
  const isElite = (tier: Tier | null) => tier === "elite";
  const isPlus = (tier: Tier | null) => tier === "elite" || tier === "plus";
  const isAboveAvg = (tier: Tier | null) => isPlus(tier) || tier === "aboveAvg";
  const isBelowAvg = (tier: Tier | null) => tier === "belowAvg" || tier === "poor" || tier === "bottom";

  const stuffTier = t("stuff_plus", input.stuffPlus);
  const bbTier = t("bb_pct", input.bbPct);          // lowerBetter — elite = low BB
  const chaseTier = t("chase_pct", input.chasePct); // higherBetter
  const izWhiffTier = t("in_zone_whiff_pct", input.inZoneWhiffPct);
  const whiffTier = t("miss_pct", input.missPct);
  const gbTier = t("ground_pct", input.groundPct);

  const eliteStuff = isElite(stuffTier);
  const plusStuff = isPlus(stuffTier);
  const eliteCommand = isElite(bbTier);
  const plusCommand = isPlus(bbTier);
  const belowCommand = isBelowAvg(bbTier);

  // Named: Flora — elite stuff + elite command (4S FB anchor preferred but not required)
  if (eliteStuff && eliteCommand) {
    return "flora";
  }

  // Chase-dependent — high chase masking low IZ whiff + low overall whiff
  if (isAboveAvg(chaseTier) && isBelowAvg(izWhiffTier) && isBelowAvg(whiffTier)) {
    return "chaseDependent";
  }

  // Sinker — elite GB + plus command (contact pitcher)
  if (isElite(gbTier) && plusCommand) {
    return "sinker";
  }

  // Stuff over command — plus stuff but command issues
  if (plusStuff && belowCommand) {
    return "stuffOverCommand";
  }

  // Command — plus command without standout stuff
  if (plusCommand && !plusStuff) {
    return "command";
  }

  return "balanced";
}
