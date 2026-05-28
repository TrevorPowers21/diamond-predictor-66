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

// ────────────────────────────────────────────────────────────────────────
// Output shape — what the AI prompt builder / consumers read
// ────────────────────────────────────────────────────────────────────────

export interface MetricSummary {
  metric: string;
  value: number;
  tier: Tier;
  pctRank: number;
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

// ────────────────────────────────────────────────────────────────────────
// Hitter context builder
// ────────────────────────────────────────────────────────────────────────

export interface HitterContextProfile {
  pa?: number | null;
  position?: string | null;
  batHand?: string | null;
  conference?: string | null;
}

export function buildHitterContext(
  input: HitterDetectionInput,
  _profile?: HitterContextProfile,
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

  return {
    side: "hitter",
    archetypeId,
    archetypeTag: archetype.tag,
    archetypeDescription: archetype.description,
    standouts,
    metrics,
    flags,
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
}

export function buildPitcherContext(
  input: PitcherDetectionInput,
  _profile?: PitcherContextProfile,
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

  return {
    side: "pitcher",
    archetypeId,
    archetypeTag: archetype.tag,
    archetypeDescription: archetype.description,
    standouts,
    metrics,
    flags,
  };
}
