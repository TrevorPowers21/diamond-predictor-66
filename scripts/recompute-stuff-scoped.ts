#!/usr/bin/env node
/**
 * Surgical Stuff+ pipeline — runs the 5 stages against ONLY a specified
 * list of pitchers, instead of the bulk-everyone behavior of
 * scripts/recompute-stuff-plus.ts.
 *
 * Stages (same order, same code — optional sourcePlayerIds filter on each):
 *   1. runVeloDiffPipeline
 *   2. runBreakingBallReclassification
 *   3. runStuffPlusPipeline      (z-scores against locked D1 pop constants — every pitcher)
 *   4. rollupStuffPlusToMaster
 *   5. computeAndStorePitchingScores  → writes era_pr_plus / fip_pr_plus / etc.
 *
 * Behavior when sourcePlayerIds is empty/missing in each function is byte-
 * identical to the original bulk path; the change is purely additive. This
 * script refuses to fire with an empty filter (would be equivalent to the
 * bulk run, which is what we're trying to avoid).
 *
 * Usage:
 *   npm run recompute-stuff-scoped -- --players logan_harrell --env staging
 *   npm run recompute-stuff-scoped -- --players logan_harrell --env staging --apply
 *   npm run recompute-stuff-scoped:prod -- --players logan_harrell --env prod --apply
 *
 * Dry-run by default (just resolves IDs, prints plan, does NOT call pipeline).
 * --apply runs the actual pipeline.
 */

import { createHash } from "node:crypto";

import { runVeloDiffPipeline } from "../src/savant/lib/veloDiffPipeline.ts";
import { runBreakingBallReclassification } from "../src/savant/lib/breakingBallReclassification.ts";
import { runStuffPlusPipeline } from "../src/savant/lib/stuffPlusEngine.ts";
import { rollupStuffPlusToMaster } from "../src/savant/lib/rollupStuffPlusToMaster.ts";
import { computeAndStorePitchingScores } from "../src/lib/computeAndStoreScores.ts";

const SEASON = 2026;
const STAGING_URL_FRAG = "slrxowawbijbjrkozqlj";
const PROD_URL_FRAG = "trbvxuoliwrfowibatkm";

// Player slug -> source_player_id. Mirrors PLAYER_BASELINES in add_d2_player.ts
// and PITCHER_BASELINES in add_d2_pitcher_stuff.ts (deterministic hash:
// `d2:<full name>:<team>`).
const syntheticD2 = (name: string, team: string) =>
  `d2-${createHash("sha1").update(`d2:${name}:${team}`).digest("hex").slice(0, 16)}`;

const PLAYER_SLUG_TO_SOURCE_ID: Record<string, string> = {
  logan_harrell: syntheticD2("Logan Harrell", "Trevecca Nazarene University"),
};

const COLOR = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);
const step = (s: string) => console.log(`\n${COLOR.bold}→${COLOR.reset} ${s}`);

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string): string | null => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? (args[i + 1] || null) : null;
  };
  return {
    players: get("players"),
    sourceIds: get("source-ids"),
    env: get("env"),
    apply: args.includes("--apply"),
  };
}

async function main() {
  const { players, sourceIds, env, apply } = parseArgs();

  if (!env || (env !== "staging" && env !== "prod")) {
    err("--env required: 'staging' or 'prod'");
    process.exit(1);
  }
  if (!players && !sourceIds) {
    err("--players <slug,slug> OR --source-ids <id,id> required");
    process.exit(1);
  }

  const resolvedIds: string[] = [];
  if (players) {
    for (const slug of players.split(",").map((s) => s.trim()).filter(Boolean)) {
      const id = PLAYER_SLUG_TO_SOURCE_ID[slug];
      if (!id) { err(`Unknown slug: '${slug}'. Known: ${Object.keys(PLAYER_SLUG_TO_SOURCE_ID).join(", ")}`); process.exit(1); }
      resolvedIds.push(id);
    }
  }
  if (sourceIds) {
    for (const id of sourceIds.split(",").map((s) => s.trim()).filter(Boolean)) {
      resolvedIds.push(id);
    }
  }
  if (resolvedIds.length === 0) {
    err("No source_player_ids resolved. Refusing to fire empty-filter (would be a bulk recompute — use scripts/recompute-stuff-plus.ts for that intentionally).");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) { err("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
  const isStaging = url.includes(STAGING_URL_FRAG);
  const isProd = url.includes(PROD_URL_FRAG);
  if (env === "staging" && !isStaging) { err(`--env staging but URL points elsewhere:\n   ${url}`); process.exit(1); }
  if (env === "prod" && !isProd) { err(`--env prod but URL points elsewhere:\n   ${url}`); process.exit(1); }

  console.log(`${COLOR.bold}\n══ Recompute Stuff+ (Scoped) ══${COLOR.reset}`);
  console.log(`Target DB:           ${isProd ? `${COLOR.red}PROD${COLOR.reset}` : "staging"} (${url})`);
  console.log(`Season:              ${SEASON}`);
  console.log(`sourcePlayerIds:     ${resolvedIds.join(", ")}`);
  console.log(`Mode:                ${apply ? `${COLOR.red}APPLY (will write)${COLOR.reset}` : "dry-run (no writes)"}`);

  if (!apply) {
    console.log(`\n${COLOR.cyan}Dry-run — no pipeline calls fired. Re-run with --apply.${COLOR.reset}\n`);
    return;
  }

  // ── Stage 1 — Velo diff ────────────────────────────────────────────────
  step("Stage 1: runVeloDiffPipeline");
  {
    const start = Date.now();
    const { report, errors } = await runVeloDiffPipeline(SEASON, resolvedIds);
    const written = (report as any)?.written ?? "?";
    ok(`${written} rows updated, ${errors.length} errors (${Date.now() - start}ms)`);
    for (const e of errors.slice(0, 3)) err(e);
  }

  // ── Stage 2 — Breaking-ball reclassifier ───────────────────────────────
  step("Stage 2: runBreakingBallReclassification");
  {
    const start = Date.now();
    const { report, errors } = await runBreakingBallReclassification(SEASON, resolvedIds);
    info(`reclassified ${(report as any)?.classified ?? "?"} rows, ${errors.length} errors (${Date.now() - start}ms)`);
    for (const e of errors.slice(0, 3)) err(e);
  }

  // ── Stage 3 — Stuff+ engine ────────────────────────────────────────────
  step("Stage 3: runStuffPlusPipeline (per-pitch stuff_plus)");
  {
    const start = Date.now();
    const { report, errors } = await runStuffPlusPipeline(SEASON, resolvedIds);
    info(`scored ${(report as any)?.scored ?? "?"} pitches, ${errors.length} errors (${Date.now() - start}ms)`);
    for (const e of errors.slice(0, 3)) err(e);
  }

  // ── Stage 4 — Rollup to Pitching Master ────────────────────────────────
  step("Stage 4: rollupStuffPlusToMaster");
  {
    const start = Date.now();
    const { report, errors } = await rollupStuffPlusToMaster(SEASON, resolvedIds);
    info(`rolled up ${(report as any)?.updated ?? "?"} pitcher rows, ${errors.length} errors (${Date.now() - start}ms)`);
    for (const e of errors.slice(0, 3)) err(e);
  }

  // ── Stage 5 — pr_plus columns (era_pr_plus / fip_pr_plus / etc) ────────
  step("Stage 5: computeAndStorePitchingScores (writes *_pr_plus columns)");
  {
    const start = Date.now();
    const { updated, errors } = await computeAndStorePitchingScores(SEASON, resolvedIds);
    info(`updated ${updated} Pitching Master rows, ${errors} errors (${Date.now() - start}ms)`);
  }

  console.log(`${COLOR.bold}${COLOR.green}\n══ DONE ══${COLOR.reset}\n`);
}

// Module-scope guard — only run as CLI, never on import.
const isMainEntry = (() => {
  try {
    const argv1 = process.argv[1] || "";
    return argv1.endsWith("recompute-stuff-scoped.ts") || argv1.endsWith("recompute-stuff-scoped.js");
  } catch { return false; }
})();

if (isMainEntry) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
