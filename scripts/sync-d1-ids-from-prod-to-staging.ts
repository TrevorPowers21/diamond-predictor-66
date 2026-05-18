#!/usr/bin/env node
/**
 * Sync D1 IDs from prod → staging.
 *
 * Staging was hydrated without ID columns (TeamID, conference_id, Conference
 * on Pitching Master + Hitter Master; D1 rows missing from Teams Table).
 * Prod has the correct IDs. This script copies them over.
 *
 * Read source: prod (loads .env.production.local manually)
 * Write target: staging (uses standard SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   from .env.local, loaded via tsx --env-file-if-exists)
 *
 * Phases (in order):
 *   1. Teams Table: INSERT any prod rows missing from staging (by id)
 *   2. Pitching Master: UPDATE staging rows' TeamID + conference_id + Conference
 *      from prod, joined on (source_player_id, Season)
 *   3. Hitter Master: same as Pitching Master
 *
 * Usage:
 *   npm run sync-ids-from-prod                    Dry run (counts only, no writes)
 *   npm run sync-ids-from-prod -- --apply         Execute (requires typed confirmation)
 */
import { createInterface } from "node:readline/promises";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const CONFIRM_PHRASE = "yes-sync-staging-from-prod";
const BATCH_SIZE = 500;
const PAGE_SIZE = 1000; // Supabase default max per query

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function step(line: string): void { console.log(`\n${COLOR.bold}→${COLOR.reset} ${line}`); }
function ok(line: string): void { console.log(`  ${COLOR.green}✓${COLOR.reset} ${line}`); }
function warn(line: string): void { console.log(`  ${COLOR.yellow}!${COLOR.reset} ${line}`); }
function err(line: string): void { console.log(`  ${COLOR.red}✗${COLOR.reset} ${line}`); }
function info(line: string): void { console.log(`  ${COLOR.cyan}·${COLOR.reset} ${line}`); }

type CliArgs = { apply: boolean };

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false };
  for (const a of argv) {
    if (a === "--apply") args.apply = true;
    else if (a === "--help" || a === "-h") {
      console.log(`
Sync D1 IDs from prod → staging.

Usage:
  npm run sync-ids-from-prod              Dry run (no writes)
  npm run sync-ids-from-prod -- --apply   Execute (requires typed confirmation)
`);
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

/** Tiny .env parser — no dep, handles KEY=VALUE with optional quotes. */
function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function makeClient(label: string, url: string, key: string): SupabaseClient {
  if (!url || !key) {
    err(`Missing creds for ${label} (url=${!!url}, key=${!!key})`);
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function confirmDestructive(): Promise<void> {
  warn(`This will WRITE to staging. Type "${CONFIRM_PHRASE}" to continue, anything else to abort.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("> ")).trim();
  rl.close();
  if (answer !== CONFIRM_PHRASE) {
    err(`Confirmation failed (got: ${JSON.stringify(answer)}). Aborting — no writes performed.`);
    process.exit(1);
  }
  ok("Confirmed. Proceeding.");
}

/** Page through a Supabase query past the default 1000-row limit. */
async function fetchAll<T = Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  columns: string,
  filter?: (q: any) => any,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    let q: any = client.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`fetchAll ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

// ── Phase 1: Teams Table ──────────────────────────────────────────────────
async function syncTeamsTable(prod: SupabaseClient, staging: SupabaseClient, apply: boolean) {
  step("Phase 1: Teams Table");

  const prodRows = await fetchAll<Record<string, unknown>>(prod, "Teams Table", "*");
  info(`Prod has ${prodRows.length} Teams Table rows`);

  const stagingIds = new Set(
    (await fetchAll<{ id: string }>(staging, "Teams Table", "id")).map((r) => r.id),
  );
  info(`Staging has ${stagingIds.size} Teams Table rows`);

  const missing = prodRows.filter((r) => !stagingIds.has(r.id as string));
  info(`To insert: ${missing.length} rows`);

  if (missing.length === 0) {
    ok("Teams Table already in sync");
    return;
  }
  if (!apply) {
    info("(dry-run — not writing)");
    return;
  }

  // Strip division column from prod rows if staging schema differs — but since
  // staging has the division column and prod doesn't, default of 'D1' applies.
  // Just remove division if present so the default kicks in.
  const cleaned = missing.map((r) => {
    const { division: _, ...rest } = r as Record<string, unknown>;
    return rest;
  });

  let inserted = 0;
  for (let i = 0; i < cleaned.length; i += BATCH_SIZE) {
    const chunk = cleaned.slice(i, i + BATCH_SIZE);
    const { error } = await staging.from("Teams Table").insert(chunk);
    if (error) {
      err(`Batch ${i}-${i + chunk.length} insert failed: ${error.message}`);
      throw error;
    }
    inserted += chunk.length;
    info(`Inserted ${inserted}/${cleaned.length}`);
  }
  ok(`Teams Table sync complete: ${inserted} rows inserted`);
}

// ── Phase 2 + 3: Master tables ID backfill ────────────────────────────────
type IdMapRow = { source_player_id: string; Season: number; TeamID: string | null; conference_id: string | null; Conference: string | null };

async function syncMasterTableIds(
  prod: SupabaseClient,
  staging: SupabaseClient,
  table: "Pitching Master" | "Hitter Master",
  apply: boolean,
) {
  step(`Phase: ${table} ID backfill`);

  // Count staging rows missing IDs
  const { count: missingCount, error: countErr } = await staging
    .from(table)
    .select("id", { count: "exact", head: true })
    .is("TeamID", null);
  if (countErr) throw new Error(`${table} count: ${countErr.message}`);
  info(`Staging has ${missingCount ?? "?"} rows with NULL TeamID`);

  // Pull (source_player_id, Season, TeamID, conference_id, Conference) from prod
  // for all rows where TeamID IS NOT NULL.
  const prodRows = await fetchAll<IdMapRow>(
    prod,
    table,
    `source_player_id, "Season", "TeamID", conference_id, "Conference"`,
    (q) => q.not("TeamID", "is", null),
  );
  info(`Prod ${table} has ${prodRows.length} rows with TeamID populated`);

  // Build map keyed by (source_player_id, Season)
  const idMap = new Map<string, IdMapRow>();
  for (const r of prodRows) idMap.set(`${r.source_player_id}|${r.Season}`, r);

  // Pull staging rows that need IDs (paged, just the keys we need to UPDATE)
  const stagingRows = await fetchAll<{ id: string; source_player_id: string; Season: number }>(
    staging,
    table,
    `id, source_player_id, "Season"`,
    (q) => q.is("TeamID", null),
  );
  info(`Staging ${table} has ${stagingRows.length} rows to backfill`);

  // Match
  const updates: Array<{ id: string; TeamID: string; conference_id: string | null; Conference: string | null }> = [];
  let unmatched = 0;
  for (const s of stagingRows) {
    const key = `${s.source_player_id}|${s.Season}`;
    const p = idMap.get(key);
    if (!p) { unmatched++; continue; }
    if (!p.TeamID) { unmatched++; continue; }
    updates.push({ id: s.id, TeamID: p.TeamID, conference_id: p.conference_id, Conference: p.Conference });
  }

  ok(`Matched ${updates.length} rows`);
  if (unmatched > 0) warn(`${unmatched} staging rows had no prod match — investigate later`);

  if (updates.length === 0 || !apply) {
    if (!apply) info("(dry-run — not writing)");
    return;
  }

  // Apply per-row UPDATEs with bounded concurrency (upsert with partial payload
  // fails NOT NULL on insert path — use .update() to stay UPDATE-only).
  const CONCURRENCY = 25;
  let updated = 0;
  let failed = 0;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const chunk = updates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (u) => {
        const { error } = await staging
          .from(table)
          .update({ TeamID: u.TeamID, conference_id: u.conference_id, Conference: u.Conference })
          .eq("id", u.id);
        return error;
      }),
    );
    for (const e of results) {
      if (e) { failed++; if (failed <= 3) err(`Update error: ${e.message}`); }
      else updated++;
    }
    if ((i + chunk.length) % 1000 < CONCURRENCY || (i + chunk.length) === updates.length) {
      info(`Progress: ${updated} updated, ${failed} failed (${i + chunk.length}/${updates.length})`);
    }
  }
  if (failed > 0) warn(`${failed} updates failed (see errors above)`);
  ok(`${table} sync complete: ${updated} rows updated`);
}

// ── Phase 4: Conference Stats sync (added 2026-05-17) ─────────────────────
async function syncConferenceStats(prod: SupabaseClient, staging: SupabaseClient, apply: boolean) {
  step("Phase 4: Conference Stats");

  const prodRows = await fetchAll<Record<string, unknown>>(prod, "Conference Stats", "*");
  info(`Prod has ${prodRows.length} Conference Stats rows`);

  // Build set of existing staging (conference_id, season) keys so we don't dupe
  const stagingRows = await fetchAll<{ conference_id: string | null; season: number }>(
    staging,
    "Conference Stats",
    "conference_id, season",
  );
  const stagingKeys = new Set(stagingRows.map((r) => `${r.conference_id ?? ""}|${r.season}`));
  info(`Staging has ${stagingRows.length} Conference Stats rows`);

  const missing = prodRows.filter((r) => !stagingKeys.has(`${(r as any).conference_id ?? ""}|${(r as any).season}`));
  info(`To insert: ${missing.length} rows`);

  if (missing.length === 0) {
    ok("Conference Stats already in sync");
    return;
  }
  if (!apply) {
    info("(dry-run — not writing)");
    return;
  }

  let inserted = 0;
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const chunk = missing.slice(i, i + BATCH_SIZE);
    const { error } = await staging.from("Conference Stats").insert(chunk);
    if (error) {
      err(`Batch ${i}-${i + chunk.length} insert failed: ${error.message}`);
      throw error;
    }
    inserted += chunk.length;
    info(`Inserted ${inserted}/${missing.length}`);
  }
  ok(`Conference Stats sync complete: ${inserted} rows inserted`);
}

// ── Verify ────────────────────────────────────────────────────────────────
async function verify(staging: SupabaseClient) {
  step("Verification");
  for (const table of ["Pitching Master", "Hitter Master"] as const) {
    const { count: total } = await staging.from(table).select("id", { count: "exact", head: true });
    const { count: nullCount } = await staging.from(table).select("id", { count: "exact", head: true }).is("TeamID", null);
    const populated = (total ?? 0) - (nullCount ?? 0);
    info(`${table}: ${populated}/${total ?? "?"} have TeamID (${nullCount ?? "?"} still NULL)`);
  }
  const { count: ttCount } = await staging.from("Teams Table").select("id", { count: "exact", head: true });
  info(`Teams Table: ${ttCount} rows`);
  const { count: csCount } = await staging.from("Conference Stats").select("conference_id", { count: "exact", head: true });
  info(`Conference Stats: ${csCount} rows`);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(COLOR.bold + "\n══ Sync D1 IDs: prod → staging ══" + COLOR.reset);
  console.log(args.apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  // Staging from process.env (loaded by --env-file-if-exists=.env.local)
  const stagingUrl = process.env.SUPABASE_URL ?? "";
  const stagingKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  // Prod from .env.production.local (manually loaded)
  const prodEnv = loadEnvFile(join(process.cwd(), ".env.production.local"));
  const prodUrl = prodEnv.SUPABASE_URL ?? "";
  const prodKey = prodEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";

  info(`Staging URL: ${stagingUrl}`);
  info(`Prod URL:    ${prodUrl}`);

  if (stagingUrl === prodUrl) {
    err("Staging and prod URLs are identical. Aborting to prevent self-write.");
    process.exit(1);
  }
  if (!stagingUrl.includes("slrxowawbijbjrkozqlj")) {
    err(`Staging URL doesn't look like staging (expected slrxowawbijbjrkozqlj). Got: ${stagingUrl}`);
    process.exit(1);
  }
  if (!prodUrl.includes("trbvxuoliwrfowibatkm")) {
    err(`Prod URL doesn't look like prod (expected trbvxuoliwrfowibatkm). Got: ${prodUrl}`);
    process.exit(1);
  }

  const staging = makeClient("staging", stagingUrl, stagingKey);
  const prod = makeClient("prod", prodUrl, prodKey);

  if (args.apply) await confirmDestructive();

  await syncTeamsTable(prod, staging, args.apply);
  await syncMasterTableIds(prod, staging, "Pitching Master", args.apply);
  await syncMasterTableIds(prod, staging, "Hitter Master", args.apply);
  await syncConferenceStats(prod, staging, args.apply);
  await verify(staging);

  console.log("\n" + (args.apply ? COLOR.green + "Done." : COLOR.cyan + "Dry-run complete. Re-run with --apply to execute.") + COLOR.reset);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
