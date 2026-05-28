/**
 * Scouting Context Builder — structured AI payload.
 *
 * Takes a player's raw scouting metrics and produces a structured
 * `ScoutingContext` object that downstream consumers (the AI edge function,
 * the future copilot, or the rule-based prose generator) all read from.
 *
 * Goal: ONE source of truth for "what does this player's data say". The
 * AI edge function never sees raw archetype IDs by name (Stevenson, Bregman,
 * Flora). It receives:
 *   - The archetype's tag (a description phrase)
 *   - The archetype's description (what the profile means)
 *   - Tier labels per metric (elite, plus, ..., bottom)
 *   - A list of standouts (metrics outside average in either direction)
 *   - Optional compound flags (e.g., "production gap")
 *
 * The system prompt at the edge function will instruct Claude to translate
 * this context into a coach-friendly read WITHOUT using archetype names.
 *
 * Pure code-driven classification, no markdown/freeform reads at runtime.
 */
import {
  HITTER_PERCENTILES,
  PITCHER_PERCENTILES,
  tierFor,
  approxPercentile,
  type Tier,
  type MetricDistribution,
} from "@/lib/scoutingPercentiles";
import {
  detectHitterArchetype,
  detectPitcherArchetype,
  HITTER_ARCHETYPES,
  PITCHER_ARCHETYPES,
  type HitterArchetypeId,
  type PitcherArchetypeId,
  type HitterDetectionInput,
  type PitcherDetectionInput,
} from "@/lib/scoutingArchetypes";
import { getConfTier } from "@/lib/playerRisk";

// ────────────────────────────────────────────────────────────────────────
// Output shape — what the AI prompt builder / consumers read
// ────────────────────────────────────────────────────────────────────────

export interface MetricSummary {
  metric: string;
  value: number;
  tier: Tier;
  pctRank: number;
}

/**
 * How the player's competition level shapes the read. Anchors the bottom-line
 * "translates up / where it can grow" closer. confTier is the CONF_TIER bucket
 * (1 = power conf, higher = weaker). talentPlus is the conference-level talent
 * the player competed against — arm quality (conf Stuff+) for a hitter, bat
 * quality (conf wRC+) for a pitcher — the comparable competition identifier.
 */
export interface CompetitionContext {
  conference: string | null;
  confTier: number;
  isPowerTier: boolean;
  talentPlus: number | null;
  talentKind: "arms_faced" | "bats_faced";
}

export interface ScoutingContext {
  side: "hitter" | "pitcher";
  /**
   * Internal archetype id. Never emit this in user-facing output. Use the
   * `tag` and `description` instead to inform analysis language.
   */
  archetypeId: HitterArchetypeId | PitcherArchetypeId;
  /** Profile-phrase descriptor (NOT a player name). Safe to quote. */
  archetypeTag: string;
  /** Longer profile description used to inform AI analysis. Safe to quote in spirit, never by name. */
  archetypeDescription: string;
  /** Metrics outside the average tier (either direction). What the player jumps off the page for. */
  standouts: MetricSummary[];
  /** Full per-metric breakdown so the AI can reference any specific data point. */
  metrics: MetricSummary[];
  /** Compound conditions worth flagging in analysis (e.g., production gap). */
  flags: string[];
  /** Competition level + how the data translates stepping up. Drives the closer. */
  competition: CompetitionContext;
  /** Competition-translation signals for the bottom-line closer. */
  translationFlags: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const STANDOUT_TIERS = new Set<Tier>(["elite", "plus", "poor", "bottom"]);

function summarize(metric: string, value: number | null | undefined, dist: MetricDistribution | undefined): MetricSummary | null {
  if (value == null || !Number.isFinite(value) || !dist) return null;
  const tier = tierFor(value, dist);
  const pctRank = approxPercentile(value, dist);
  if (tier == null || pctRank == null) return null;
  return { metric, value: Number(value), tier, pctRank };
}

// ── Tier predicates (shared) ──
const isPlusTier = (t: Tier | null) => t === "elite" || t === "plus";
const isEliteTier = (t: Tier | null) => t === "elite";
const isAvgOrLower = (t: Tier | null) => t === "average" || t === "belowAvg" || t === "poor" || t === "bottom";
const isWeakTier = (t: Tier | null) => t === "belowAvg" || t === "poor" || t === "bottom";

/**
 * Build the competition context for a player. talentPlus is the conference-level
 * talent faced (conf Stuff+ for hitters = arm quality; conf wRC+ for pitchers =
 * bat quality), passed in from the caller since it requires a Conference Stats
 * lookup.
 */
function buildCompetition(
  side: "hitter" | "pitcher",
  conference: string | null | undefined,
  talentPlus: number | null | undefined,
): CompetitionContext {
  const confTier = getConfTier(conference);
  return {
    conference: conference ?? null,
    confTier,
    isPowerTier: confTier <= 1,
    talentPlus: talentPlus ?? null,
    talentKind: side === "hitter" ? "arms_faced" : "bats_faced",
  };
}

// ────────────────────────────────────────────────────────────────────────
// Hitter context builder
// ────────────────────────────────────────────────────────────────────────

export interface HitterContextProfile {
  pa?: number | null;
  position?: string | null;
  batHand?: string | null;
  conference?: string | null;
  /** Conference-level Stuff+ (arm quality the hitter faced). For competition context. */
  confStuffPlus?: number | null;
}

/**
 * Hitter competition-translation flags. Caveats fire only below the power tier
 * (there's a level to step up to). See project_competition_translation_rules.
 */
function hitterTranslationFlags(metrics: MetricSummary[], comp: CompetitionContext): string[] {
  const out: string[] = [];
  if (comp.isPowerTier) return out; // power-conf data is the top reference; no step-up caveat
  const tierOf = (m: string) => metrics.find((x) => x.metric === m)?.tier ?? null;
  const chase = tierOf("chase");
  const contact = tierOf("contact");
  // Chase: a strong number earned vs weaker arms is most likely to be tested up.
  if (isPlusTier(chase)) out.push("xlate_chase_inflated");
  // Contact: good-to-great carries up; below-avg/poor more likely to erode.
  if (isPlusTier(contact)) out.push("xlate_contact_carries");
  else if (isWeakTier(contact)) out.push("xlate_contact_erosion");
  return out;
}

export function buildHitterContext(
  input: HitterDetectionInput,
  profile?: HitterContextProfile,
): ScoutingContext {
  const archetypeId = detectHitterArchetype(input);
  const archetype = HITTER_ARCHETYPES[archetypeId];

  const candidates: Array<MetricSummary | null> = [
    summarize("contact",       input.contact,    HITTER_PERCENTILES.contact),
    summarize("chase",         input.chase,      HITTER_PERCENTILES.chase),
    summarize("avg_exit_velo", input.avgEv,      HITTER_PERCENTILES.avg_exit_velo),
    summarize("ev90",          input.ev90,       HITTER_PERCENTILES.ev90),
    summarize("barrel",        input.barrel,     HITTER_PERCENTILES.barrel),
    summarize("pull",          input.pull,       HITTER_PERCENTILES.pull),
    summarize("pull_air",      input.pullAir,    HITTER_PERCENTILES.pull_air),
    summarize("la_10_30",      input.laSweet,    HITTER_PERCENTILES.la_10_30),
    summarize("pop_up",        input.popUp,      HITTER_PERCENTILES.pop_up),
    summarize("bb",            input.bb,         HITTER_PERCENTILES.bb),
    summarize("line_drive",    input.lineDrive,  HITTER_PERCENTILES.line_drive),
    summarize("gb",            input.gb,         HITTER_PERCENTILES.gb),
  ];
  const metrics = candidates.filter((m): m is MetricSummary => m != null);
  const standouts = metrics.filter((m) => STANDOUT_TIERS.has(m.tier));

  // Compound flags worth surfacing to the AI.
  const flags: string[] = [];
  const tierOf = (metric: string) => metrics.find((m) => m.metric === metric)?.tier ?? null;
  const isPlus = (t: Tier | null) => t === "elite" || t === "plus";
  const isBad = (t: Tier | null) => t === "poor" || t === "bottom";

  if (input.pWrcPlus != null) {
    const wrcRank = Number(input.pWrcPlus);
    // Production gap: archetype suggests upside but production lags. Heuristic:
    // top-tier raw signals (elite power OR elite contact) paired with sub-110 wRC+
    if ((tierOf("avg_exit_velo") === "elite" || tierOf("barrel") === "elite" || tierOf("contact") === "elite") && wrcRank < 110) {
      flags.push("production_gap");
    }
  }
  if (tierOf("chase") === "bottom") flags.push("ultra_aggressive_chase");
  if (isPlus(tierOf("avg_exit_velo")) && !isPlus(tierOf("pull_air"))) flags.push("power_without_pull_air");
  if (isPlus(tierOf("barrel")) && isBad(tierOf("la_10_30"))) flags.push("barrel_la_disconnect");
  if (isBad(tierOf("contact")) && isPlus(tierOf("chase"))) flags.push("swing_miss_with_discipline");
  if (isBad(tierOf("contact")) && isBad(tierOf("chase"))) flags.push("swing_miss_and_chase");

  const competition = buildCompetition("hitter", profile?.conference, profile?.confStuffPlus);
  const translationFlags = hitterTranslationFlags(metrics, competition);

  return {
    side: "hitter",
    archetypeId,
    archetypeTag: archetype.tag,
    archetypeDescription: archetype.description,
    standouts,
    metrics,
    flags,
    competition,
    translationFlags,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Pitcher context builder
// ────────────────────────────────────────────────────────────────────────

export interface PitcherContextProfile {
  ip?: number | null;
  position?: string | null;
  throwHand?: string | null;
  conference?: string | null;
  primaryPitchType?: string | null;
  /** Conference-level wRC+ (bat quality the pitcher faced). For competition context. */
  confWrcPlus?: number | null;
}

/**
 * Pitcher competition-translation flags. Root cause threaded through most:
 * elite chase vs weaker bats inflates whiff and suppresses walks. Stuff+ is the
 * cross-D1 comparable anchor and is never caveated. See
 * project_competition_translation_rules.
 */
function pitcherTranslationFlags(metrics: MetricSummary[], comp: CompetitionContext): string[] {
  const out: string[] = [];
  const tierOf = (m: string) => metrics.find((x) => x.metric === m)?.tier ?? null;
  const stuff = tierOf("stuff_plus");
  const izWhiff = tierOf("in_zone_whiff_pct");
  const whiff = tierOf("miss_pct");
  const chase = tierOf("chase_pct");
  const bb = tierOf("bb_pct");
  const hardHit = tierOf("hard_hit_pct");
  const barrel = tierOf("barrel_pct");

  // PRIMARY: high whiff (total or IZ) not matched by Stuff+ → may be missing
  // something AND/OR (below power tier) a product of lesser competition.
  const highWhiff = isPlusTier(whiff) || isPlusTier(izWhiff);
  if (highWhiff && isAvgOrLower(stuff)) {
    out.push(comp.isPowerTier ? "xlate_whiff_vs_stuff" : "xlate_whiff_vs_stuff_lowcomp");
  }
  // Stuff+ is real and comparable league-wide — affirmative anchor.
  if (isPlusTier(stuff)) out.push("xlate_stuff_anchor");

  // Caveats below the power tier only (step-up concern):
  if (!comp.isPowerTier) {
    // Chase-dependent: chase strong but IZ whiff weak = least translatable.
    if (isPlusTier(chase) && isWeakTier(izWhiff)) out.push("xlate_chase_dependent");
    // Soft contact earned vs weaker bats — hard-hit/barrel climb a level up.
    if (isPlusTier(hardHit) || isPlusTier(barrel)) out.push("xlate_softcontact_vs_weak");
    // Low walks partly chase-suppressed vs weaker bats.
    if (isPlusTier(bb) && isEliteTier(chase)) out.push("xlate_walks_chase_suppressed");
  }
  return out;
}

export function buildPitcherContext(
  input: PitcherDetectionInput,
  profile?: PitcherContextProfile,
): ScoutingContext {
  const archetypeId = detectPitcherArchetype(input);
  const archetype = PITCHER_ARCHETYPES[archetypeId];

  const candidates: Array<MetricSummary | null> = [
    summarize("stuff_plus",        input.stuffPlus,       PITCHER_PERCENTILES.stuff_plus),
    summarize("bb_pct",            input.bbPct,           PITCHER_PERCENTILES.bb_pct),
    summarize("chase_pct",         input.chasePct,        PITCHER_PERCENTILES.chase_pct),
    summarize("in_zone_whiff_pct", input.inZoneWhiffPct,  PITCHER_PERCENTILES.in_zone_whiff_pct),
    summarize("miss_pct",          input.missPct,         PITCHER_PERCENTILES.miss_pct),
    summarize("hard_hit_pct",      input.hardHitPct,      PITCHER_PERCENTILES.hard_hit_pct),
    summarize("barrel_pct",        input.barrelPct,       PITCHER_PERCENTILES.barrel_pct),
    summarize("ground_pct",        input.groundPct,       PITCHER_PERCENTILES.ground_pct),
  ];
  const metrics = candidates.filter((m): m is MetricSummary => m != null);
  const standouts = metrics.filter((m) => STANDOUT_TIERS.has(m.tier));

  const flags: string[] = [];
  const tierOf = (metric: string) => metrics.find((m) => m.metric === metric)?.tier ?? null;
  const isPlus = (t: Tier | null) => t === "elite" || t === "plus";
  const isBad = (t: Tier | null) => t === "poor" || t === "bottom";

  if (isPlus(tierOf("stuff_plus")) && isBad(tierOf("bb_pct"))) flags.push("stuff_over_command");
  if (isBad(tierOf("stuff_plus")) && isPlus(tierOf("bb_pct"))) flags.push("command_over_stuff");
  if (tierOf("ground_pct") === "elite") flags.push("ground_ball_machine");
  if (isPlus(tierOf("chase_pct")) && isBad(tierOf("in_zone_whiff_pct"))) flags.push("chase_dependent");
  if (isPlus(tierOf("in_zone_whiff_pct")) && isPlus(tierOf("miss_pct"))) flags.push("pure_swing_miss");

  const competition = buildCompetition("pitcher", profile?.conference, profile?.confWrcPlus);
  const translationFlags = pitcherTranslationFlags(metrics, competition);

  return {
    side: "pitcher",
    archetypeId,
    archetypeTag: archetype.tag,
    archetypeDescription: archetype.description,
    standouts,
    metrics,
    flags,
    competition,
    translationFlags,
  };
}
