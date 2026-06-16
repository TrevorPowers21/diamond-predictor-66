#!/usr/bin/env node
/**
 * Surgical precompute trigger — fires `process-precompute-jobs` for ONE or
 * MORE specific players (by source_player_id) across every active customer
 * team. Uses the new optional `sourcePlayerIds` filter param on the edge
 * function so it does NOT touch any other player's predictions.
 *
 * Same env-detection + dry-run-by-default discipline as
 * `scripts/add_d2_player.ts`.
 *
 * Usage:
 *   npm run precompute-players -- --players logan_harrell,jake_berkland --env staging
 *   npm run precompute-players -- --players logan_harrell,jake_berkland --env staging --apply
 *
 * Or with raw source_player_ids when not in the slug map:
 *   npm run precompute-players -- --source-ids d2-abc123,d2-def456 --env staging --apply
 *
 * What it does (for each customer_team × {hitters_d1, pitchers_d1}):
 *   1. Resolves player slugs -> source_player_ids (and/or accepts raw ids)
 *   2. Enqueues a precompute_jobs row with trigger_source='precompute_specific_players'
 *   3. Fires the edge function with body {jobId, sourcePlayerIds}
 *   4. Edge function filters to those players only, runs the same math as bulk
 *
 * Behavior with empty/missing sourcePlayerIds: edge function falls back to
 * full bulk scope. We always pass a non-empty list here so this script can
 * never accidentally trigger a full team recompute.
 */

import { createClient } from "@supabase/supabase-js";

// Player slug -> source_player_id mapping. Mirrors PLAYER_BASELINES in
// scripts/add_d2_player.ts. Hash is deterministic from `d2:<full name>:<team>`
// per syntheticSourceId() in that script.
//
// For new D2 onboards: add a baseline to add_d2_player.ts, run it once to
// land the player, then add the slug -> source_player_id pair here.
import { createHash } from "node:crypto";
const syntheticD2 = (name: string, team: string) =>
  `d2-${createHash("sha1").update(`d2:${name}:${team}`).digest("hex").slice(0, 16)}`;

const PLAYER_SLUG_TO_SOURCE_ID: Record<string, string> = {
  logan_harrell: syntheticD2("Logan Harrell", "Trevecca Nazarene University"),
  jake_berkland: syntheticD2("Jake Berkland", "Minnesota State University-Mankato"),
};

const STAGING_URL_FRAG = "slrxowawbijbjrkozqlj";
const PROD_URL_FRAG = "trbvxuoliwrfowibatkm";

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

  // Resolve sourcePlayerIds
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
    err("No source_player_ids resolved. Refusing to fire empty-filter precompute (would recompute the entire scope).");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    err("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env");
    process.exit(1);
  }
  const isStaging = url.includes(STAGING_URL_FRAG);
  const isProd = url.includes(PROD_URL_FRAG);
  if (env === "staging" && !isStaging) { err(`--env staging but URL points elsewhere:\n   ${url}`); process.exit(1); }
  if (env === "prod" && !isProd) { err(`--env prod but URL points elsewhere:\n   ${url}`); process.exit(1); }

  console.log(`${COLOR.bold}\n══ Precompute Specific Players ══${COLOR.reset}`);
  console.log(`Target DB:           ${isProd ? `${COLOR.red}PROD${COLOR.reset}` : "staging"} (${url})`);
  console.log(`sourcePlayerIds:     ${resolvedIds.join(", ")}`);
  console.log(`Mode:                ${apply ? `${COLOR.red}APPLY (will write)${COLOR.reset}` : "dry-run (will not enqueue or fire)"}`);

  const sb = createClient(url, key, { auth: { persistSession: false } });

  // Discover active customer teams
  step("Discovering active customer teams");
  const { data: teams, error: teamsErr } = await sb
    .from("customer_teams")
    .select("id, name")
    .eq("active", true);
  if (teamsErr) { err(`customer_teams lookup: ${teamsErr.message}`); process.exit(1); }
  if (!teams || teams.length === 0) { err("No active customer teams found."); process.exit(1); }
  for (const t of teams) info(`${t.id.slice(0, 8)} ${t.name}`);

  const scopes = ["hitters_d1", "pitchers_d1"] as const;
  const fnUrl = `${url}/functions/v1/process-precompute-jobs`;
  const auth = `Bearer ${key}`;

  for (const t of teams) {
    for (const scope of scopes) {
      step(`${t.name} / ${scope}`);
      if (!apply) {
        info(`[dry-run] Would enqueue precompute_jobs row + fire edge function with sourcePlayerIds=${JSON.stringify(resolvedIds)}`);
        continue;
      }
      // Enqueue
      const { data: job, error: jobErr } = await (sb as any)
        .from("precompute_jobs")
        .insert({ customer_team_id: t.id, scope, trigger_source: "precompute_specific_players" })
        .select("id")
        .single();
      if (jobErr) { err(`enqueue failed: ${jobErr.message}`); continue; }
      info(`enqueued job ${job.id.slice(0, 8)}`);

      // Fire
      const res = await fetch(fnUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ jobId: job.id, sourcePlayerIds: resolvedIds }),
      });
      const text = await res.text().catch(() => "");
      if (res.ok) ok(`fired (status ${res.status}) ${text.slice(0, 200)}`);
      else err(`fire failed (status ${res.status}): ${text.slice(0, 300)}`);
    }
  }

  console.log(`${COLOR.bold}${COLOR.green}\n══ DONE ══${COLOR.reset}`);
  console.log(`Mode:    ${apply ? "APPLIED" : "dry-run"}\n`);
}

// Module-scope guard — only run as CLI, never on import.
const isMainEntry = (() => {
  try {
    const argv1 = process.argv[1] || "";
    return argv1.endsWith("precompute_specific_players.ts") || argv1.endsWith("precompute_specific_players.js");
  } catch { return false; }
})();

if (isMainEntry) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
