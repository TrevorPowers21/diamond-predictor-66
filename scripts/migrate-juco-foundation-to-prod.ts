#!/usr/bin/env node
/**
 * Phase 2 Step 2 — copy the full JUCO data foundation from STAGING to PROD.
 *
 * Six tables in FK-safe order:
 *   1. Teams Table          — 157 JUCO college rows (UPSERT on id; zero collisions)
 *   2. Conference Stats     — 10 NJCAA D1 district rows (UPSERT on conference_id+season
 *                              so the hardcoded JUCO_DISTRICT_CONFERENCE_ID UUIDs preserve)
 *   3. players              — 5,265 JUCO players (UPSERT on source_player_id to handle
 *                              the 124 prod stub rows; preserves prod UUIDs for those)
 *   4. Hitter Master        — 2,975 JUCO HM rows (UPSERT on source_player_id+Season)
 *   5. Pitching Master      — 2,732 JUCO PM rows (UPSERT on source_player_id+Season)
 *   6. player_predictions   — 2,923 JUCO prediction rows. For the 124 collision players,
 *                              staging's player_id ≠ prod's player_id, so we build a
 *                              source_player_id → prod_player_id map after step 3 and
 *                              translate each prediction's player_id before upserting.
 *                              UPSERT on (player_id, model_type, variant, season).
 *
 * Dry-run by default. --apply enables writes with a typed-phrase guard.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/migrate-juco-foundation-to-prod.ts            # dry-run
 *   npx tsx scripts/migrate-juco-foundation-to-prod.ts --apply    # writes prod
 *
 * Requires .env.production.local with SUPABASE_SERVICE_ROLE_KEY for prod.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync } from "node:fs";

const STAGING_URL = "https://slrxowawbijbjrkozqlj.supabase.co";
const PROD_URL = "https://trbvxuoliwrfowibatkm.supabase.co";
const CONFIRM = "yes-migrate-juco-foundation-to-prod";

const C = { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m", reset: "\x1b[0m" };
const step = (msg: string) => console.log(C.cyan + `\n→ ${msg}` + C.reset);
const info = (msg: string) => console.log(`  ${msg}`);
const ok = (msg: string) => console.log(C.green + `  ✓ ${msg}` + C.reset);
const warn = (msg: string) => console.log(C.yellow + `  ⚠ ${msg}` + C.reset);
const err = (msg: string) => console.log(C.red + `  ✗ ${msg}` + C.reset);

const PAGE = 1000;

async function fetchAll<T = any>(sb: SupabaseClient, table: string, filter: (q: any) => any): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    let q = (sb as any).from(table).select("*");
    q = filter(q);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function upsertChunked(
  sb: SupabaseClient,
  table: string,
  rows: any[],
  onConflict: string,
  chunkSize = 500,
): Promise<{ inserted: number; failed: number; errors: string[] }> {
  let inserted = 0;
  let failed = 0;
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await (sb as any).from(table).upsert(chunk, { onConflict });
    if (error) {
      failed += chunk.length;
      errors.push(`chunk @${i} (${chunk.length} rows): ${error.message}`);
    } else {
      inserted += chunk.length;
    }
  }
  return { inserted, failed, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");

  console.log(C.bold + "\n══ JUCO foundation migration: STAGING → PROD ══" + C.reset);
  console.log(apply ? C.red + "MODE: APPLY (will write to prod)" + C.reset : "MODE: dry-run");

  const stagingKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!stagingKey) { err("SUPABASE_SERVICE_ROLE_KEY (staging) not set in env. source .env.local first."); process.exit(1); }
  const prodKey = readFileSync(".env.production.local", "utf-8")
    .split("\n").find((l) => l.startsWith("SUPABASE_SERVICE_ROLE_KEY="))?.split("=", 2)[1] ?? "";
  if (!prodKey) { err("Prod service role key not found in .env.production.local"); process.exit(1); }

  const staging = createClient(STAGING_URL, stagingKey, { auth: { persistSession: false } });
  const prod = createClient(PROD_URL, prodKey, { auth: { persistSession: false } });

  // ── Read everything from staging first ───────────────────────────────
  step("Reading from STAGING");
  const teams = await fetchAll(staging, "Teams Table", (q) => q.ilike("conference", "%NJCAA%"));
  ok(`Teams Table — ${teams.length} JUCO rows`);
  const confStats = await fetchAll(staging, "Conference Stats", (q) => q.like(`"conference abbreviation"`, "NJCAA D1%"));
  ok(`Conference Stats — ${confStats.length} JUCO D1 district rows`);
  const players = await fetchAll(staging, "players", (q) => q.eq("division", "NJCAA_D1"));
  ok(`players — ${players.length} JUCO rows`);
  const hm = await fetchAll(staging, "Hitter Master", (q) => q.eq("division", "NJCAA_D1"));
  ok(`Hitter Master — ${hm.length} JUCO rows`);
  const pm = await fetchAll(staging, "Pitching Master", (q) => q.eq("division", "NJCAA_D1"));
  ok(`Pitching Master — ${pm.length} JUCO rows`);

  // Predictions: need player_id list to filter
  const jucoPlayerIds = new Set(players.map((p: any) => p.id));
  step("Fetching JUCO predictions from STAGING (chunked .in() on player_id)");
  const preds: any[] = [];
  const idArr = Array.from(jucoPlayerIds);
  for (let i = 0; i < idArr.length; i += 300) {
    const chunk = idArr.slice(i, i + 300);
    const { data, error } = await (staging as any).from("player_predictions").select("*").in("player_id", chunk);
    if (error) { err(`predictions chunk @${i}: ${error.message}`); process.exit(1); }
    preds.push(...(data || []));
  }
  ok(`player_predictions — ${preds.length} JUCO rows`);

  // ── Collision analysis ──────────────────────────────────────────────
  step("Detecting collisions on PROD (staging source_player_id already present on prod)");
  const sourceIds = players.map((p: any) => p.source_player_id).filter(Boolean);
  const prodCollisionMap = new Map<string, string>(); // source_player_id → prod player.id
  for (let i = 0; i < sourceIds.length; i += 200) {
    const chunk = sourceIds.slice(i, i + 200);
    const { data, error } = await prod.from("players").select("id, source_player_id").in("source_player_id", chunk);
    if (error) { err(`collision check chunk @${i}: ${error.message}`); process.exit(1); }
    for (const r of (data || []) as any[]) {
      if (r.source_player_id) prodCollisionMap.set(r.source_player_id, r.id);
    }
  }
  ok(`${prodCollisionMap.size} collisions detected (will enrich in place; prod UUIDs preserved)`);

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(C.bold + "\n══ Summary of writes ══" + C.reset);
  info(`Teams Table:        ${teams.length} (UPSERT on id)`);
  info(`Conference Stats:   ${confStats.length} (UPSERT on conference_id+season)`);
  info(`players:            ${players.length} (UPSERT on source_player_id — ${prodCollisionMap.size} enrich, ${players.length - prodCollisionMap.size} new)`);
  info(`Hitter Master:      ${hm.length} (UPSERT on source_player_id+Season)`);
  info(`Pitching Master:    ${pm.length} (UPSERT on source_player_id+Season)`);
  info(`player_predictions: ${preds.length} (UPSERT on player_id+model_type+variant+season, with player_id translated via sid map)`);

  if (!apply) {
    console.log(C.yellow + "\nDry-run complete. Re-run with --apply to write to prod." + C.reset);
    return;
  }

  // ── Typed-phrase guard ──────────────────────────────────────────────
  console.log(C.red + C.bold + `\n⚠  About to write the above to PROD (${PROD_URL}).` + C.reset);
  console.log(C.red + `Type "${CONFIRM}" to proceed:` + C.reset);
  const rl = createInterface({ input, output });
  const typed = (await rl.question("> ")).trim();
  rl.close();
  if (typed !== CONFIRM) { err("Confirmation phrase mismatch — aborting"); process.exit(1); }

  // ── 1. Teams Table ──────────────────────────────────────────────────
  step("Writing Teams Table");
  const r1 = await upsertChunked(prod, "Teams Table", teams, "id");
  ok(`${r1.inserted}/${teams.length} teams upserted (failed: ${r1.failed})`);
  r1.errors.forEach(err);

  // ── 2. Conference Stats ─────────────────────────────────────────────
  step("Writing Conference Stats");
  const r2 = await upsertChunked(prod, "Conference Stats", confStats, "conference_id,season");
  ok(`${r2.inserted}/${confStats.length} conference rows upserted (failed: ${r2.failed})`);
  r2.errors.forEach(err);

  // ── 3. players — UPSERT on source_player_id ────────────────────────
  // This preserves prod UUIDs for the 124 collisions. For new players,
  // the staging UUID is used (no conflict).
  step("Writing players (UPSERT on source_player_id; 124 stubs enriched in place)");
  const r3 = await upsertChunked(prod, "players", players, "source_player_id");
  ok(`${r3.inserted}/${players.length} players upserted (failed: ${r3.failed})`);
  r3.errors.forEach(err);

  // ── 4. Re-fetch sid→prod_id map (now reflects post-upsert state) ────
  step("Building sid → prod player.id map (for prediction translation)");
  const sidToProdId = new Map<string, string>();
  for (let i = 0; i < sourceIds.length; i += 200) {
    const chunk = sourceIds.slice(i, i + 200);
    const { data } = await prod.from("players").select("id, source_player_id").in("source_player_id", chunk);
    for (const r of (data || []) as any[]) {
      if (r.source_player_id) sidToProdId.set(r.source_player_id, r.id);
    }
  }
  ok(`${sidToProdId.size}/${sourceIds.length} JUCO source_player_ids mapped to prod player.id`);
  if (sidToProdId.size !== sourceIds.length) {
    warn(`Map missing ${sourceIds.length - sidToProdId.size} entries — some players failed to upsert`);
  }

  // ── 5. Hitter Master ────────────────────────────────────────────────
  step("Writing Hitter Master");
  const r5 = await upsertChunked(prod, "Hitter Master", hm, "source_player_id,Season");
  ok(`${r5.inserted}/${hm.length} HM rows upserted (failed: ${r5.failed})`);
  r5.errors.forEach(err);

  // ── 6. Pitching Master ──────────────────────────────────────────────
  step("Writing Pitching Master");
  const r6 = await upsertChunked(prod, "Pitching Master", pm, "source_player_id,Season");
  ok(`${r6.inserted}/${pm.length} PM rows upserted (failed: ${r6.failed})`);
  r6.errors.forEach(err);

  // ── 7. player_predictions ───────────────────────────────────────────
  // Translate staging.player_id → prod.player_id via the sid map. Build
  // a staging.id → source_player_id lookup first (we have it in `players`).
  step("Translating prediction player_ids (staging → prod) + writing");
  const stagingIdToSid = new Map<string, string>();
  for (const p of players as any[]) {
    if (p.source_player_id) stagingIdToSid.set(p.id, p.source_player_id);
  }

  let predTranslated = 0;
  let predDropped = 0;
  const translatedPreds: any[] = [];
  for (const pred of preds as any[]) {
    const sid = stagingIdToSid.get(pred.player_id);
    if (!sid) { predDropped++; continue; }
    const prodPid = sidToProdId.get(sid);
    if (!prodPid) { predDropped++; continue; }
    // Strip the staging `id` so prod uses its own UUID default (avoids
    // any cross-DB id collision). The unique constraint on
    // (player_id, model_type, variant, season) is what guarantees no dupes.
    const { id: _staging_id, ...rest } = pred;
    translatedPreds.push({ ...rest, player_id: prodPid });
    predTranslated++;
  }
  info(`${predTranslated} predictions translated, ${predDropped} dropped (no sid or prod_id match)`);

  const r7 = await upsertChunked(prod, "player_predictions", translatedPreds, "player_id,model_type,variant,season");
  ok(`${r7.inserted}/${translatedPreds.length} predictions upserted (failed: ${r7.failed})`);
  r7.errors.forEach(err);

  console.log(C.bold + C.green + "\n✓ Migration complete." + C.reset);
}

main().catch((e) => { console.error(C.red + String(e) + C.reset); process.exit(1); });
