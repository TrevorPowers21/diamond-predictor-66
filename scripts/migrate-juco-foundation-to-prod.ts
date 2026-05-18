#!/usr/bin/env node
/**
 * Copy the entire JUCO data foundation from STAGING to PROD.
 *
 * Why this exists: the JUCO go-to-market work (Transfer Portal JUCO division,
 * JUCO subtab, JUCO profile pages, TB target-board JUCO projections) was built
 * up over weeks on staging. Prod has none of it. This script bulk-copies the
 * full set so the feature ships end-to-end with one run.
 *
 * Tables (in FK-safe order):
 *   1. Teams Table          — 157 JUCO college rows (UUID preserved)
 *   2. Conference Stats     — 10 NJCAA D1 district rows (conference_id preserved
 *                              so the hardcoded JUCO_DISTRICT_CONFERENCE_ID
 *                              map in src/lib/transferWeightDefaults.ts keeps
 *                              resolving)
 *   3. players              — every player with division='NJCAA_D1' (id preserved
 *                              so player_predictions FKs work)
 *   4. Hitter Master        — every row with division='NJCAA_D1'
 *   5. Pitching Master      — every row with division='NJCAA_D1'
 *   6. player_predictions   — every row whose player_id is in the JUCO set
 *
 * Idempotent: each table uses UPSERT on its primary/unique key. Safe to re-run
 * partial migrations.
 *
 * Dry-run by default. Pass --apply to actually write to prod. Typed-phrase
 * guard before writes start.
 *
 * Usage:
 *   set -a && source .env.local && source .env.production.local && set +a
 *   npx tsx scripts/migrate-juco-foundation-to-prod.ts            # dry-run
 *   npx tsx scripts/migrate-juco-foundation-to-prod.ts --apply    # writes prod
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const STAGING_URL = "https://slrxowawbijbjrkozqlj.supabase.co";
const PROD_URL = "https://trbvxuoliwrfowibatkm.supabase.co";
const CONFIRM = "yes-migrate-juco-foundation-to-prod";
const COLOR = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m", reset: "\x1b[0m" };
const step = (msg: string) => console.log(COLOR.cyan + `\n→ ${msg}` + COLOR.reset);
const info = (msg: string) => console.log(`  ${msg}`);
const ok = (msg: string) => console.log(COLOR.green + `  ✓ ${msg}` + COLOR.reset);
const err = (msg: string) => console.log(COLOR.red + `  ✗ ${msg}` + COLOR.reset);

const PAGE = 1000;

/** Paginated full-table fetch with optional filter. */
async function fetchAll<T = any>(
  sb: SupabaseClient,
  table: string,
  filter: (q: any) => any,
  selectCols = "*",
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    let q = (sb as any).from(table).select(selectCols);
    q = filter(q);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/** Chunked upsert. onConflict optional — Supabase defaults to PK. */
async function upsertChunked(
  sb: SupabaseClient,
  table: string,
  rows: any[],
  onConflict?: string,
  chunkSize = 500,
): Promise<{ inserted: number; failed: number; errors: string[] }> {
  let inserted = 0;
  let failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const opts = onConflict ? { onConflict } : undefined;
    const { error } = await (sb as any).from(table).upsert(chunk, opts);
    if (error) {
      failed += chunk.length;
      errors.push(`chunk @${i}: ${error.message}`);
      // Don't abort — surface and keep going so the operator sees the full
      // failure scope, not just the first bad chunk.
    } else {
      inserted += chunk.length;
    }
  }
  return { inserted, failed, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  console.log(COLOR.bold + "\n══ JUCO foundation migration: STAGING → PROD ══" + COLOR.reset);
  console.log(apply ? COLOR.red + "MODE: APPLY (will write to prod)" + COLOR.reset : "MODE: dry-run");

  // Read both env sets from process.env. Operator is expected to have sourced
  // both .env.local and .env.production.local before running. We require the
  // staging+prod URLs and service-role keys to be set.
  const stagingKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const prodKey = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!stagingKey) { err("SUPABASE_SERVICE_ROLE_KEY (staging) not set"); process.exit(1); }
  if (!prodKey) {
    err("PROD_SUPABASE_SERVICE_ROLE_KEY not set. Add it via:");
    info("  export PROD_SUPABASE_SERVICE_ROLE_KEY=\"$(grep ^SUPABASE_SERVICE_ROLE_KEY .env.production.local | cut -d= -f2-)\"");
    process.exit(1);
  }

  const staging = createClient(STAGING_URL, stagingKey, { auth: { persistSession: false } });
  const prod = createClient(PROD_URL, prodKey, { auth: { persistSession: false } });

  // ── 1. Teams Table (JUCO subset) ──────────────────────────────────
  step("Step 1/6: Teams Table (JUCO)");
  const teams = await fetchAll(staging, "Teams Table", (q) => q.ilike("conference", "%NJCAA%"));
  ok(`fetched ${teams.length} JUCO team rows from staging`);
  // Sanity: log a sample
  if (teams.length > 0) info(`  sample: ${teams[0].name} (${teams[0].conference})`);

  // ── 2. Conference Stats (NJCAA D1 districts) ──────────────────────
  step("Step 2/6: Conference Stats (NJCAA D1)");
  const confStats = await fetchAll(staging, "Conference Stats", (q) => q.like(`"conference abbreviation"`, "NJCAA D1%"));
  ok(`fetched ${confStats.length} JUCO conference stat rows from staging`);
  if (confStats.length > 0) {
    info(`  sample: ${confStats[0]["conference abbreviation"]} (id=${confStats[0].conference_id})`);
  }

  // ── 3. players (JUCO) ─────────────────────────────────────────────
  step("Step 3/6: players (JUCO)");
  const players = await fetchAll(staging, "players", (q) => q.eq("division", "NJCAA_D1"));
  ok(`fetched ${players.length} JUCO player rows from staging`);
  const playerIdSet = new Set(players.map((p: any) => p.id));

  // ── 4. Hitter Master (JUCO) ───────────────────────────────────────
  step("Step 4/6: Hitter Master (JUCO)");
  const hm = await fetchAll(staging, "Hitter Master", (q) => q.eq("division", "NJCAA_D1"));
  ok(`fetched ${hm.length} JUCO Hitter Master rows from staging`);

  // ── 5. Pitching Master (JUCO) ─────────────────────────────────────
  step("Step 5/6: Pitching Master (JUCO)");
  const pm = await fetchAll(staging, "Pitching Master", (q) => q.eq("division", "NJCAA_D1"));
  ok(`fetched ${pm.length} JUCO Pitching Master rows from staging`);

  // ── 6. player_predictions (for JUCO players) ──────────────────────
  step("Step 6/6: player_predictions (for JUCO players)");
  // Chunked .in() lookup against the JUCO player_id set.
  const allPlayerIds = Array.from(playerIdSet);
  const preds: any[] = [];
  for (let i = 0; i < allPlayerIds.length; i += 300) {
    const chunk = allPlayerIds.slice(i, i + 300);
    const { data, error } = await (staging as any).from("player_predictions").select("*").in("player_id", chunk);
    if (error) { err(`predictions chunk @${i}: ${error.message}`); process.exit(1); }
    preds.push(...(data || []));
  }
  ok(`fetched ${preds.length} JUCO player_predictions rows from staging`);

  // ── Summary ───────────────────────────────────────────────────────
  console.log(COLOR.bold + "\n══ Summary of what will be written ══" + COLOR.reset);
  info(`Teams Table:          ${teams.length}`);
  info(`Conference Stats:     ${confStats.length}`);
  info(`players:              ${players.length}`);
  info(`Hitter Master:        ${hm.length}`);
  info(`Pitching Master:      ${pm.length}`);
  info(`player_predictions:   ${preds.length}`);

  if (!apply) {
    console.log(COLOR.yellow + "\nDry-run complete. Re-run with --apply to write to prod." + COLOR.reset);
    return;
  }

  // ── Typed-phrase guard ────────────────────────────────────────────
  console.log(COLOR.red + COLOR.bold + `\n⚠  About to write the above to PROD (${PROD_URL}).` + COLOR.reset);
  console.log(COLOR.red + `Type "${CONFIRM}" to proceed:` + COLOR.reset);
  const rl = createInterface({ input, output });
  const typed = (await rl.question("> ")).trim();
  rl.close();
  if (typed !== CONFIRM) { err("Confirmation phrase mismatch — aborting"); process.exit(1); }

  // ── Write in FK-safe order ────────────────────────────────────────
  step("Writing Teams Table");
  const r1 = await upsertChunked(prod, "Teams Table", teams, "id");
  ok(`upserted ${r1.inserted}/${teams.length} teams (failed: ${r1.failed})`);
  r1.errors.forEach((e) => err(e));

  step("Writing Conference Stats");
  // Conference Stats unique key is (conference_id, season) per the schema; passing
  // both as the conflict target ensures idempotency.
  const r2 = await upsertChunked(prod, "Conference Stats", confStats, "conference_id,season");
  ok(`upserted ${r2.inserted}/${confStats.length} conference stat rows (failed: ${r2.failed})`);
  r2.errors.forEach((e) => err(e));

  step("Writing players");
  const r3 = await upsertChunked(prod, "players", players, "id");
  ok(`upserted ${r3.inserted}/${players.length} players (failed: ${r3.failed})`);
  r3.errors.forEach((e) => err(e));

  step("Writing Hitter Master");
  // HM unique on (source_player_id, Season).
  const r4 = await upsertChunked(prod, "Hitter Master", hm, "source_player_id,Season");
  ok(`upserted ${r4.inserted}/${hm.length} HM rows (failed: ${r4.failed})`);
  r4.errors.forEach((e) => err(e));

  step("Writing Pitching Master");
  const r5 = await upsertChunked(prod, "Pitching Master", pm, "source_player_id,Season");
  ok(`upserted ${r5.inserted}/${pm.length} PM rows (failed: ${r5.failed})`);
  r5.errors.forEach((e) => err(e));

  step("Writing player_predictions");
  const r6 = await upsertChunked(prod, "player_predictions", preds, "id");
  ok(`upserted ${r6.inserted}/${preds.length} prediction rows (failed: ${r6.failed})`);
  r6.errors.forEach((e) => err(e));

  console.log(COLOR.bold + COLOR.green + "\n✓ Migration complete." + COLOR.reset);
}

main().catch((e) => { console.error(COLOR.red + String(e) + COLOR.reset); process.exit(1); });
