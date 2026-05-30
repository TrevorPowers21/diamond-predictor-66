#!/usr/bin/env node
/**
 * Bulk AI scouting report generator.
 *
 * For every eligible D1 player (JUCO excluded), this builds a structured
 * ScoutingContext from src/lib (code does ALL the classification), sends it to
 * Anthropic Haiku 4.5 to write coach-facing prose, and stores one row per
 * (player, side) in ai_scouting_reports.
 *
 * Code drives the logic; the model only writes the read. The model NEVER sees
 * internal archetype ids (Stevenson, Bregman, Flora) — only tier language,
 * standouts, and flags. See SYSTEM_PROMPT below.
 *
 * Idempotent: input_hash = SHA-256 of the exact prompt payload + system prompt
 * version + model. Re-running skips any player whose hash is unchanged. Bump
 * PROMPT_VERSION (or change the system prompt) to force a full regen.
 *
 * Usage:
 *   npm run gen-scouting -- --dry-run            # build contexts, print sample, NO api calls, NO writes
 *   npm run gen-scouting -- --dry-run --limit=10 # dry-run a small sample
 *   npm run gen-scouting:prod -- --dry-run       # dry-run against prod data
 *   npm run gen-scouting:prod                    # REAL run: calls Anthropic + writes prod
 *   npm run gen-scouting:prod -- --side=hitter   # only hitters
 *   npm run gen-scouting:prod -- --force         # ignore input_hash, regenerate all
 */
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/integrations/supabase/client";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import {
  buildHitterContext,
  buildPitcherContext,
  type ScoutingContext,
  type MetricSummary,
} from "@/lib/scoutingContext";
import type {
  HitterDetectionInput,
  PitcherDetectionInput,
} from "@/lib/scoutingArchetypes";
import type { Tier } from "@/lib/scoutingPercentiles";

// ─── Config ──────────────────────────────────────────────────────────────

const MODEL = "claude-haiku-4-5-20251001";
const PROMPT_VERSION = "v5"; // bump to invalidate all input_hashes
const CONCURRENCY = 5;

// Two report tiers. Full = qualified sample, detailed 3-5 paragraph read.
// Brief = below qualified but enough data to say something, short hedged
// snippet. Below the snippet floor we generate nothing (sample is noise).
const FULL_MIN_AB = 75;
const FULL_MIN_IP = 20;
const SNIPPET_MIN_AB = 25;
const SNIPPET_MIN_IP = 10;
const MAX_TOKENS_FULL = 900;
const MAX_TOKENS_BRIEF = 280;

type ReportMode = "full" | "brief";

// Haiku 4.5 pricing (USD per token) — verify against current Anthropic pricing.
const PRICE_IN = 1 / 1_000_000;
const PRICE_OUT = 5 / 1_000_000;

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };

// ─── System prompt (LOCKED — review before any run) ──────────────────────

const SYSTEM_PROMPT = `You are a baseball scouting analyst writing a player evaluation for a college coaching staff. You will be given a structured data profile for one player. Your job is to turn that data into a clear, coach-facing scouting read.

HARD RULES:
- Write ONLY about what the data says. Never invent stats, velocities, scout grades, or biographical facts that are not in the profile.
- Never use internal labels, code names, or player comparisons of any kind. Do not say a player is "a [Name] type" or compare him to any major leaguer or other player. Identify the data that stands out and explain what it means on the field.
- GROUND EVERY JUDGMENT IN THE DATA. Whenever you make an evaluative claim, name the specific metric AND cite its actual value from the profile, so a coach can see exactly why you reached that conclusion. Not "limited power" but "limited power: a 82.8 average exit velocity and an 11.6% barrel rate, both below-average." Not "elite approach" but "an elite 13.2% chase rate." Pair the tier word with the value every time. Keep it readable prose, not a stat dump, but no conclusion should float without the metric and value behind it.
- AIRTIGHT METRIC LABELING: the number you cite is the metric's VALUE (the rate, mph, or Stuff+ figure given in the profile). NEVER call that value a "percentile" or a "percentile rank." Do not state percentiles at all. Use the tier word (elite/plus/etc.) for ranking and the value for the number. E.g., correct: "a 13.2% chase rate, elite discipline." Wrong: "a chase rate in the 13.2 percentile."
- Use these tier words exactly: elite, plus, above-average, average, below-average, poor, well below-average. The profile already tells you the tier for each metric, use it, do not re-grade.
- Translate tiers into baseball outcomes, do not just restate them. Not "his exit velocity is elite" but "an elite 92.4 average exit velocity means the power plays in any park and against any level of arm." Lead the reader to the on-field consequence, but always with the metric and value attached.

STRUCTURE:
- OPEN WITH A ONE-SENTENCE BANNER that classifies the player by profile, role, and defining trait. Use the player's name, handedness, and position to set the role, then the trait that most defines him. PREFER leading with the defining strength, but be honest: if the profile has no real positive or is majority negative, the banner should state the concern instead. Examples: "Marcus Lee is a power-hitting corner infielder who punishes mistakes but expands the zone." / "Jordan Pena is a contact-oriented middle infielder with elite bat-to-ball and limited power." / "Cole Rivera is a power right-handed arm with swing-and-miss stuff and some command concerns." / "Tyler Boone is a power-hitting corner outfielder with major swing-and-miss concerns." / "Devin Cross is a finesse left-handed arm without a clear out pitch." Map position to role naturally: 1B/3B = corner infielder, 2B/SS = middle infielder, C = catcher, LF/RF = corner outfielder, CF = center fielder, P = right-handed or left-handed arm (use the throwing hand). This banner is the first line; the rest of the report builds the case behind it.
- After the banner, 3 to 5 short paragraphs, one topic per paragraph (e.g., power, approach/plate discipline, contact, batted-ball profile; for pitchers: stuff, command, swing-and-miss, contact management). Lead the body with the strongest standout.
- Work the flags in naturally where they fit — they describe real tension in the profile (e.g., a power-vs-contact disconnect, chase concerns, stuff-over-command).
- Close with a short bottom-line read that does two things: (1) the role/ceiling the profile points to, and (2) how the data translates as the competition gets tougher, using the COMPETITION CONTEXT and the "HOW THE DATA TRANSLATES STEPPING UP" notes provided. State which skills should carry and which are most likely to be tested a level up. Keep it hedged and probabilistic ("most likely to be tested," "should carry"), never a verdict ("will decline").

COMPETITION RULES:
- Anchor any step-up read to the level the player actually competed at (the COMPETITION CONTEXT line). A power-conference player's data is already battle-tested; a lower-tier player's strengths were earned against weaker competition. Do NOT speculate about "college vs pro" in the abstract.
- For pitchers, treat Stuff+ as the league-wide comparable indicator of pitch quality and reference its level (e.g., a 110 Stuff+ is plus stuff that holds up conference to conference). Power metrics for hitters (exit velocity, EV90, barrel) are strength-driven tools that travel — do not flag them as competition-dependent.

VOICE:
- Conversational but precise, the way an experienced scout talks to a head coach. No filler, no hedging, no bullet lists. Plain prose paragraphs.
- Plain baseball language, not analyst jargon. Coaches do not want sabermetric phrasing for development needs. Do NOT write "launch-angle development," "sweet-spot optimization," "barrel-rate gains," or similar. Say it plainly: "the power will need to develop," "he needs to drive the ball more consistently." Cite the metric values as data, but describe what needs to change in coach terms.
- Do not mention "tiers," "percentiles," "the data profile," or that you were given structured input. Just give the read.
- Never use em dashes. Use commas, colons, parentheses, or separate sentences instead.
- Do not add a markdown title, heading, or bold header line. The banner sentence is the opener, written as plain prose.`;

// Brief tier — for players below the qualified sample floor. Short, honest,
// acknowledges the limited sample without overcommitting to a projection.
const SYSTEM_PROMPT_BRIEF = `You are a baseball scouting analyst writing a SHORT note for a college coaching staff about a player who has only a limited sample of data so far. You will be given a structured data profile.

HARD RULES:
- Write ONLY about what the data says. Never invent stats, velocities, grades, or biographical facts not in the profile.
- Never use internal labels, code names, or player comparisons of any kind. Identify the data that stands out and what it means on the field.
- Ground the read in the data: name the standout metric AND its actual value (e.g., "a 91.3% contact rate"), so the coach sees what drives the note.
- AIRTIGHT METRIC LABELING: the number you cite is the metric's VALUE (rate/mph/Stuff+), never a "percentile." Do not state percentiles. Use the tier word for ranking and the value for the number.
- Use these tier words exactly: elite, plus, above-average, average, below-average, poor, well below-average. The profile already gives you the tier per metric, use it, do not re-grade.
- This is a SMALL SAMPLE. Note the read is preliminary on a limited sample. Do not project a role or ceiling with confidence.
- Open with a short classification of the player (handedness + position-based role + the one defining trait, positive if there is one, otherwise the defining concern), then the supporting note. E.g., "On a limited sample, Jordan Pena looks like a contact-oriented middle infielder: an early 88% contact rate stands out."
- Never use em dashes. Use commas, colons, parentheses, or separate sentences.
- Plain baseball language, no analyst jargon. Say "the power will need to develop," not "launch-angle development."
- Do not add a markdown title or heading. Write plain prose.

LENGTH AND SHAPE:
- 2 to 3 sentences, ONE short paragraph. No headers, no bullet lists.
- Name the one or two things that genuinely stand out (the top standouts) and what they'd mean if they hold, then stop. Do not force a full breakdown of every metric.
- If a clear translation note is provided (HOW THE DATA TRANSLATES STEPPING UP), you may fold ONE short, hedged clause into the close (e.g., the level the data came against). Do not over-explain it. For pitchers, Stuff+ is the league-wide comparable read of pitch quality.`;

// ─── Human-readable label maps ────────────────────────────────────────────

const TIER_LABEL: Record<Tier, string> = {
  elite: "elite",
  plus: "plus",
  aboveAvg: "above-average",
  average: "average",
  belowAvg: "below-average",
  poor: "poor",
  bottom: "well below-average",
};

const METRIC_LABEL: Record<string, string> = {
  // hitter
  contact: "contact rate",
  chase: "chase rate",
  avg_exit_velo: "average exit velocity",
  ev90: "90th-percentile exit velocity",
  barrel: "barrel rate",
  pull: "pull rate",
  pull_air: "pull-air rate",
  la_10_30: "sweet-spot launch angle rate",
  pop_up: "pop-up rate",
  bb: "walk rate",
  line_drive: "line-drive rate",
  gb: "ground-ball rate",
  // pitcher
  stuff_plus: "Stuff+",
  bb_pct: "walk rate",
  chase_pct: "chase rate",
  in_zone_whiff_pct: "in-zone whiff rate",
  miss_pct: "whiff rate",
  hard_hit_pct: "hard-hit rate",
  barrel_pct: "barrel rate",
  ground_pct: "ground-ball rate",
};

const FLAG_LABEL: Record<string, string> = {
  production_gap: "raw tools outrun the production so far — the data points to more upside than the results show",
  ultra_aggressive_chase: "an extremely aggressive, expand-the-zone approach",
  power_without_pull_air: "power that has not yet been channeled into pull-side air",
  barrel_la_disconnect: "barrels the ball but the launch angle isn't optimizing it",
  swing_miss_with_discipline: "swing-and-miss in the zone but disciplined enough not to chase",
  swing_miss_and_chase: "both swing-and-miss and chase concerns — the high-risk combination",
  stuff_over_command: "the stuff is ahead of the command",
  command_over_stuff: "the command is ahead of the stuff",
  ground_ball_machine: "an elite ground-ball profile",
  chase_dependent: "swing-and-miss that leans on chase rather than beating hitters in the zone",
  pure_swing_miss: "a pure bat-missing profile both in and out of the zone",
};

// Competition-translation signals → hedged closer language. Probabilistic, never
// a verdict. See project_competition_translation_rules.
const TRANSLATION_LABEL: Record<string, string> = {
  // hitter
  xlate_chase_inflated: "the chase discipline was earned against lower-tier arms, so it is one of the first things likely to be tested stepping up in competition",
  xlate_contact_carries: "the contact ability is strong enough that it should carry as competition rises",
  xlate_contact_erosion: "the bat-to-ball is already a question and tends to erode further against better stuff a level up",
  // pitcher
  xlate_stuff_anchor: "Stuff+ is measured on a scale comparable across every conference, so this pitch quality reads as real regardless of who he faced",
  xlate_whiff_vs_stuff: "the swing-and-miss outruns the Stuff+, which is comparable league-wide, so the whiff may not be fully backed by the measured stuff",
  xlate_whiff_vs_stuff_lowcomp: "the swing-and-miss outruns the Stuff+ (a league-wide comparable measure), which could mean the stuff is missing something OR that the whiff is a product of facing lesser competition",
  xlate_chase_dependent: "the misses lean on chase rather than beating hitters in the zone, the least translatable profile against better bats that do not expand",
  xlate_softcontact_vs_weak: "the soft contact came against lower-tier bats, and hard-hit and barrel rates tend to climb as the hitters get more talented",
  xlate_walks_chase_suppressed: "the low walk rate leans partly on chase against weaker bats, so walks can tick up against hitters who do not expand the zone",
};

function confTierWord(tier: number): string {
  if (tier <= 1) return "power conference";
  if (tier === 2) return "strong mid-major";
  if (tier === 3) return "mid-tier conference";
  return "lower-division conference";
}

// ─── Prompt payload (what the model actually sees — NO archetype id) ──────

interface PlayerMeta {
  id: string;
  firstName: string | null;
  lastName: string | null;
  position: string | null;
  classYear: string | null;
  team: string | null;
  conference: string | null;
  hand: string | null; // bats (hitter) or throws (pitcher)
  sample: { kind: "PA" | "AB" | "IP"; value: number | null };
}

function metricLine(m: MetricSummary): string {
  const label = METRIC_LABEL[m.metric] ?? m.metric;
  // Value + tier only. Percentile is intentionally omitted so the prose can't
  // confuse a metric's value with its percentile rank.
  return `- ${label}: ${m.value} (${TIER_LABEL[m.tier]})`;
}

/**
 * Serialize a ScoutingContext + player meta into the user message. Deliberately
 * OMITS context.archetypeId so the model never sees a code name. Tag and
 * description inform the framing but are presented as profile language.
 */
function buildUserMessage(ctx: ScoutingContext, meta: PlayerMeta): string {
  const name = [meta.firstName, meta.lastName].filter(Boolean).join(" ") || "This player";
  const sideWord = ctx.side === "hitter" ? "hitter" : "pitcher";
  const handLabel = ctx.side === "hitter" ? "Bats" : "Throws";
  const headerBits = [
    meta.position ? `Position: ${meta.position}` : null,
    meta.hand ? `${handLabel}: ${meta.hand}` : null,
    meta.classYear ? `Class: ${meta.classYear}` : null,
    meta.team ? `Team: ${meta.team}` : null,
    meta.conference ? `Conference: ${meta.conference}` : null,
    meta.sample.value != null ? `${meta.sample.kind}: ${meta.sample.value}` : null,
  ].filter(Boolean).join(" | ");

  const standouts = ctx.standouts.length
    ? ctx.standouts.map(metricLine).join("\n")
    : "- (no metric is far from average; this is a balanced profile)";
  const allMetrics = ctx.metrics.map(metricLine).join("\n");
  const flags = ctx.flags.length
    ? ctx.flags.map((f) => `- ${FLAG_LABEL[f] ?? f.replace(/_/g, " ")}`).join("\n")
    : "- (none)";

  // Competition context + translation signals for the closer.
  const comp = ctx.competition;
  const talentBit = comp.talentPlus != null
    ? ` The ${comp.talentKind === "arms_faced" ? "average arm quality faced (conference Stuff+)" : "average bat quality faced (conference wRC+)"} was ${comp.talentPlus}.`
    : "";
  const compLine = `Competed in a ${confTierWord(comp.confTier)} (${comp.conference ?? "unknown"}).${talentBit}`;
  const xlate = ctx.translationFlags.length
    ? ctx.translationFlags.map((f) => `- ${TRANSLATION_LABEL[f] ?? f.replace(/_/g, " ")}`).join("\n")
    : "- (nothing notable; the profile should translate without major caveats)";

  return `PLAYER: ${name} — ${sideWord}
${headerBits}

PROFILE FRAMING (use to inform the read, do NOT quote any name): ${ctx.archetypeTag}.
${ctx.archetypeDescription}

WHAT STANDS OUT (lead with the strongest of these):
${standouts}

FULL METRIC PROFILE:
${allMetrics}

PROFILE TENSIONS / FLAGS:
${flags}

COMPETITION CONTEXT: ${compLine}

HOW THE DATA TRANSLATES STEPPING UP (work these into the bottom-line closer, hedged):
${xlate}

Write the scouting report now.`;
}

// ─── Idempotency hash ─────────────────────────────────────────────────────

function systemPromptFor(mode: ReportMode): string {
  return mode === "full" ? SYSTEM_PROMPT : SYSTEM_PROMPT_BRIEF;
}

function inputHash(userMessage: string, mode: ReportMode): string {
  return createHash("sha256")
    .update(`${PROMPT_VERSION}\n${MODEL}\n${mode}\n${systemPromptFor(mode)}\n${userMessage}`)
    .digest("hex");
}

// ─── Pagination helper ────────────────────────────────────────────────────

async function loadAllPaged<T>(builder: () => any): Promise<T[]> {
  const PAGE = 1000;
  let out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await builder().range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ─── Build the work list ──────────────────────────────────────────────────

interface Job {
  playerId: string;
  side: "hitter" | "pitcher";
  mode: ReportMode;
  archetypeId: string;
  meta: PlayerMeta;
  userMessage: string;
  hash: string;
}

async function buildJobs(side: "hitter" | "pitcher" | "both"): Promise<Job[]> {
  // D1 players only — JUCO (NJCAA_D1) excluded. Keyed by source_player_id.
  console.log(`${C.cyan}→${C.reset} loading D1 players...`);
  const players = await loadAllPaged<any>(() =>
    supabase
      .from("players")
      .select("id, source_player_id, division, position, class_year, team, conference, pa, ip, first_name, last_name, bats_hand, throws_hand")
      .eq("division", "D1"),
  );
  const playerBySourceId = new Map<string, any>();
  for (const p of players) {
    if (p.source_player_id) playerBySourceId.set(String(p.source_player_id), p);
  }
  console.log(`  ${players.length} D1 players (${playerBySourceId.size} with source_player_id)`);

  // p_wrc_plus for the production_gap flag — the PROJECTION_SEASON (2027)
  // returner/regular cross-team projection built off 2026 actuals.
  console.log(`${C.cyan}→${C.reset} loading p_wrc_plus (returner/regular, season=${PROJECTION_SEASON})...`);
  const predRows = await loadAllPaged<any>(() =>
    supabase
      .from("player_predictions")
      .select("player_id, p_wrc_plus")
      .eq("season", PROJECTION_SEASON)
      .eq("model_type", "returner")
      .eq("variant", "regular")
      .is("customer_team_id", null)
      .not("p_wrc_plus", "is", null),
  );
  const wrcByPlayer = new Map<string, number>();
  for (const r of predRows) if (r.p_wrc_plus != null) wrcByPlayer.set(String(r.player_id), Number(r.p_wrc_plus));

  // Conference-level talent identifiers: conf Stuff+ (arms a hitter faced) and
  // conf wRC+ (bats a pitcher faced). Keyed by normalized conference name.
  console.log(`${C.cyan}→${C.reset} loading Conference Stats (talent identifiers)...`);
  const confNorm = (s: string | null | undefined) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const confStats = await loadAllPaged<any>(() =>
    (supabase as any).from("Conference Stats").select('"conference abbreviation", season, Stuff_plus, WRC_plus').eq("season", CURRENT_SEASON),
  );
  const confStuffByName = new Map<string, number>();
  const confWrcByName = new Map<string, number>();
  for (const c of confStats) {
    const key = confNorm(c["conference abbreviation"]);
    if (!key) continue;
    if (c.Stuff_plus != null) confStuffByName.set(key, Number(c.Stuff_plus));
    if (c.WRC_plus != null) confWrcByName.set(key, Number(c.WRC_plus));
  }

  const jobs: Job[] = [];
  let skippedNoMetrics = 0;
  let skippedNoPlayer = 0;

  // ── Hitters ──
  if (side === "hitter" || side === "both") {
    console.log(`${C.cyan}→${C.reset} loading Hitter Master ${CURRENT_SEASON} (ab >= ${SNIPPET_MIN_AB})...`);
    const hitters = await loadAllPaged<any>(() =>
      supabase
        .from("Hitter Master")
        .select(
          "source_player_id, ab, Pos, avg_exit_velo, ev90, barrel, bb, chase, contact, line_drive, la_10_30, gb, pull, pull_air, pop_up",
        )
        .eq("Season", CURRENT_SEASON)
        .gte("ab", SNIPPET_MIN_AB),
    );
    console.log(`  ${hitters.length} hitter rows (ab >= ${SNIPPET_MIN_AB})`);
    for (const h of hitters) {
      const p = h.source_player_id ? playerBySourceId.get(String(h.source_player_id)) : null;
      if (!p) { skippedNoPlayer++; continue; }
      const input: HitterDetectionInput = {
        position: p.position ?? h.Pos ?? null,
        contact: h.contact, chase: h.chase, avgEv: h.avg_exit_velo, ev90: h.ev90,
        barrel: h.barrel, pull: h.pull, pullAir: h.pull_air, laSweet: h.la_10_30,
        popUp: h.pop_up, bb: h.bb, lineDrive: h.line_drive, gb: h.gb,
        pWrcPlus: wrcByPlayer.get(String(p.id)) ?? null,
      };
      const ctx = buildHitterContext(input, {
        conference: p.conference,
        confStuffPlus: confStuffByName.get(confNorm(p.conference)) ?? null,
      });
      if (ctx.metrics.length === 0) { skippedNoMetrics++; continue; }
      const mode: ReportMode = (h.ab ?? 0) >= FULL_MIN_AB ? "full" : "brief";
      const meta: PlayerMeta = {
        id: p.id, firstName: p.first_name, lastName: p.last_name,
        position: p.position ?? h.Pos ?? null, classYear: p.class_year,
        team: p.team, conference: p.conference, hand: p.bats_hand ?? null,
        sample: { kind: "PA", value: p.pa ?? null },
      };
      const userMessage = buildUserMessage(ctx, meta);
      jobs.push({ playerId: p.id, side: "hitter", mode, archetypeId: ctx.archetypeId, meta, userMessage, hash: inputHash(userMessage, mode) });
    }
  }

  // ── Pitchers ──
  if (side === "pitcher" || side === "both") {
    console.log(`${C.cyan}→${C.reset} loading Pitching Master ${CURRENT_SEASON} (IP >= ${SNIPPET_MIN_IP})...`);
    const pitchers = await loadAllPaged<any>(() =>
      supabase
        .from("Pitching Master")
        .select(
          "source_player_id, IP, miss_pct, bb_pct, hard_hit_pct, in_zone_whiff_pct, chase_pct, barrel_pct, ground_pct, stuff_plus",
        )
        .eq("Season", CURRENT_SEASON)
        .gte("IP", SNIPPET_MIN_IP),
    );
    console.log(`  ${pitchers.length} pitcher rows (IP >= ${SNIPPET_MIN_IP})`);
    for (const pr of pitchers) {
      const p = pr.source_player_id ? playerBySourceId.get(String(pr.source_player_id)) : null;
      if (!p) { skippedNoPlayer++; continue; }
      const input: PitcherDetectionInput = {
        stuffPlus: pr.stuff_plus, bbPct: pr.bb_pct, chasePct: pr.chase_pct,
        inZoneWhiffPct: pr.in_zone_whiff_pct, missPct: pr.miss_pct,
        hardHitPct: pr.hard_hit_pct, barrelPct: pr.barrel_pct, groundPct: pr.ground_pct,
      };
      const ctx = buildPitcherContext(input, {
        conference: p.conference,
        confWrcPlus: confWrcByName.get(confNorm(p.conference)) ?? null,
      });
      if (ctx.metrics.length === 0) { skippedNoMetrics++; continue; }
      const mode: ReportMode = (pr.IP ?? 0) >= FULL_MIN_IP ? "full" : "brief";
      const meta: PlayerMeta = {
        id: p.id, firstName: p.first_name, lastName: p.last_name,
        position: "P", classYear: p.class_year, team: p.team, conference: p.conference,
        hand: p.throws_hand ?? null,
        sample: { kind: "IP", value: p.ip ?? null },
      };
      const userMessage = buildUserMessage(ctx, meta);
      jobs.push({ playerId: p.id, side: "pitcher", mode, archetypeId: ctx.archetypeId, meta, userMessage, hash: inputHash(userMessage, mode) });
    }
  }

  console.log(`  ${C.dim}skipped: ${skippedNoPlayer} no matching D1 player, ${skippedNoMetrics} no scouting metrics${C.reset}`);
  return jobs;
}

// Deterministic guardrails the model doesn't reliably self-enforce:
// strip em/en dashes (Trevor's hard no-em-dash rule) and any leading markdown
// title/header the model tacks on despite the prompt.
function sanitizeBody(s: string): string {
  let out = s.replace(/\s*[—–]\s*/g, ", ");
  // Fix artifacts from the dash replacement.
  out = out.replace(/,\s*([.,;:!?])/g, "$1"); // ", ." -> "."
  out = out.replace(/\s+([.,;:!?])/g, "$1");   // " ," -> ","
  out = out.replace(/,\s*,/g, ",");            // ", ," -> ","
  // Drop a leading markdown heading or bold title line if present.
  out = out.replace(/^\s*#{1,6}\s.*\n+/, "");
  out = out.replace(/^\s*\*\*[^\n]*\*\*\s*\n+/, "");
  return out.trim();
}

// ─── Anthropic call with retry ────────────────────────────────────────────

async function generateOne(client: Anthropic, job: Job): Promise<{ body: string; inTok: number; outTok: number }> {
  let attempt = 0;
  while (true) {
    try {
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: job.mode === "full" ? MAX_TOKENS_FULL : MAX_TOKENS_BRIEF,
        system: [{ type: "text", text: systemPromptFor(job.mode), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: job.userMessage }],
      });
      const raw = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      return { body: sanitizeBody(raw), inTok: msg.usage.input_tokens, outTok: msg.usage.output_tokens };
    } catch (e: any) {
      attempt++;
      const status = e?.status ?? e?.response?.status;
      if ((status === 429 || status === 529 || status >= 500) && attempt <= 5) {
        const wait = Math.min(2 ** attempt * 1000, 30_000);
        console.log(`${C.yellow}  retry ${attempt} (status ${status}) in ${wait}ms${C.reset}`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const isProd = process.argv.includes("--prod");
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
  const sideArg = process.argv.find((a) => a.startsWith("--side="));
  const side = (sideArg ? sideArg.split("=")[1] : "both") as "hitter" | "pitcher" | "both";
  const tierArg = process.argv.find((a) => a.startsWith("--tier="));
  const tierFilter = (tierArg ? tierArg.split("=")[1] : "both") as "full" | "brief" | "both";

  // Env guard — refuse to mismatch prod.
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").toLowerCase();
  const looksLikeProd = supabaseUrl.includes("ualmkgkdnoubccoieahf") || supabaseUrl.includes("trbvxuoliwrfowibatkm") || supabaseUrl.includes("prod");
  if (looksLikeProd && !isProd) {
    console.error(`${C.red}✗ SUPABASE_URL looks like PROD but --prod was not passed. Refusing.${C.reset}`);
    process.exit(1);
  }
  if (isProd && !looksLikeProd) {
    console.error(`${C.red}✗ --prod passed but SUPABASE_URL doesn't look like prod. Refusing.${C.reset}`);
    process.exit(1);
  }

  console.log(`${C.bold}Scouting Report Generation${C.reset} on ${isProd ? "PROD" : "STAGING"}${dryRun ? ` ${C.yellow}[DRY RUN — no API calls, no writes]${C.reset}` : ""}`);
  console.log(`  model: ${MODEL} | prompt: ${PROMPT_VERSION} | side: ${side} | tier: ${tierFilter}${force ? " | FORCE regen" : ""}`);

  let jobs = await buildJobs(side);
  if (tierFilter !== "both") jobs = jobs.filter((j) => j.mode === tierFilter);
  const nFull = jobs.filter((j) => j.mode === "full").length;
  const nBrief = jobs.filter((j) => j.mode === "brief").length;
  console.log(`${C.bold}${jobs.length} eligible reports${C.reset} (${jobs.filter((j) => j.side === "hitter").length} hitter, ${jobs.filter((j) => j.side === "pitcher").length} pitcher) — ${nFull} full, ${nBrief} brief`);

  // Skip unchanged (idempotency) unless --force.
  let toRun = jobs;
  if (!force) {
    console.log(`${C.cyan}→${C.reset} loading existing report hashes...`);
    const existing = await loadAllPaged<any>(() => supabase.from("ai_scouting_reports").select("player_id, side, input_hash"));
    const existingHash = new Map<string, string>();
    for (const r of existing) existingHash.set(`${r.player_id}:${r.side}`, r.input_hash);
    toRun = jobs.filter((j) => existingHash.get(`${j.playerId}:${j.side}`) !== j.hash);
    console.log(`  ${jobs.length - toRun.length} unchanged (skip), ${toRun.length} to (re)generate`);
  }

  if (Number.isFinite(limit)) toRun = toRun.slice(0, limit);

  // ── Dry run: print samples + cost estimate, no calls, no writes ──
  if (dryRun) {
    console.log(`\n${C.bold}═══ FULL SYSTEM PROMPT (locked, ${PROMPT_VERSION}) ═══${C.reset}\n${SYSTEM_PROMPT}\n`);
    console.log(`${C.bold}═══ BRIEF SYSTEM PROMPT (locked, ${PROMPT_VERSION}) ═══${C.reset}\n${SYSTEM_PROMPT_BRIEF}\n`);
    const sample = toRun.slice(0, Math.min(toRun.length, Number.isFinite(limit) ? limit : 5));
    for (const j of sample) {
      console.log(`${C.bold}═══ ${j.meta.firstName} ${j.meta.lastName} (${j.side}, ${j.mode.toUpperCase()}, internal archetype: ${j.archetypeId}) ═══${C.reset}`);
      console.log(j.userMessage);
      console.log("");
    }
    const full = toRun.filter((j) => j.mode === "full").length;
    const brief = toRun.filter((j) => j.mode === "brief").length;
    // ~3500 in tokens/report (system cached after first); full ~550 out, brief ~150 out.
    const estIn = toRun.length * 3500;
    const estOut = full * 550 + brief * 150;
    console.log(`${C.yellow}[DRY RUN]${C.reset} would generate ${toRun.length} reports (${full} full, ${brief} brief).`);
    console.log(`  rough cost: ~$${(estIn * PRICE_IN + estOut * PRICE_OUT).toFixed(2)} (pre prompt-cache savings)`);
    console.log(`  ${C.dim}no API calls made, nothing written.${C.reset}`);
    return;
  }

  // ── Real run ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(`${C.red}✗ ANTHROPIC_API_KEY not set. Add it to .env.production.local.${C.reset}`);
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  let done = 0, errors = 0, totalIn = 0, totalOut = 0;
  // Simple concurrency pool.
  const queue = [...toRun];
  async function worker() {
    while (queue.length) {
      const job = queue.shift()!;
      try {
        const { body, inTok, outTok } = await generateOne(client, job);
        totalIn += inTok; totalOut += outTok;
        const { error } = await supabase.from("ai_scouting_reports").upsert(
          {
            player_id: job.playerId, side: job.side, archetype_id: job.archetypeId,
            body, model: MODEL, input_hash: job.hash, generated_at: new Date().toISOString(),
          },
          { onConflict: "player_id,side" },
        );
        if (error) { errors++; console.log(`${C.red}  write fail ${job.meta.lastName}: ${error.message}${C.reset}`); }
        else done++;
      } catch (e: any) {
        errors++;
        console.log(`${C.red}  gen fail ${job.meta.lastName}: ${e?.message ?? e}${C.reset}`);
      }
      process.stdout.write(`\r  ${done}/${toRun.length}${errors ? ` (${errors} err)` : ""}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const cost = totalIn * PRICE_IN + totalOut * PRICE_OUT;
  console.log(`\n${C.green}✓ done${C.reset} — ${done} written, ${errors} errors`);
  console.log(`  tokens: ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out | cost ~$${cost.toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
