/**
 * One-shot prod → staging copy for the audit-identified gaps:
 *   - model_config (season=2026 only — current-cycle config)
 *   - ai_scouting_reports (only those whose player_id exists on staging)
 *
 * Read-only against prod. Pass --dry-run to skip the staging writes
 * (logs what WOULD be inserted but makes no changes).
 */
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

const STAGING = createClient(
  "https://slrxowawbijbjrkozqlj.supabase.co",
  process.env.STAGING_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const PROD = createClient(
  "https://trbvxuoliwrfowibatkm.supabase.co",
  process.env.PROD_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function fetchAll(sb: any, table: string, filterFn?: (q: any) => any): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    let q = sb.from(table).select("*").order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} fetch: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function upsertChunked(sb: any, table: string, rows: any[], conflictKey: string): Promise<{ inserted: number; errors: string[] }> {
  const errors: string[] = [];
  let inserted = 0;
  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Skipping upsert of ${rows.length} rows into ${table}`);
    if (rows.length > 0) console.log(`  [DRY-RUN] First row sample:`, JSON.stringify({ ...rows[0], body: rows[0]?.body ? `${String(rows[0].body).slice(0, 80)}...` : undefined }, null, 2));
    return { inserted: rows.length, errors };
  }
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await sb.from(table).upsert(slice, { onConflict: conflictKey });
    if (error) {
      errors.push(`chunk ${i}-${i + slice.length}: ${error.message}`);
      continue;
    }
    inserted += slice.length;
  }
  return { inserted, errors };
}

// ─── 1) model_config (season=2026) ────────────────────────────────────
console.log("=== model_config (season=2026) ===");
const mcRows = await fetchAll(PROD, "model_config", (q) => q.eq("season", 2026));
console.log(`  Fetched ${mcRows.length} prod rows for 2026`);
// Strip id so staging generates fresh UUIDs — model_config keys on (model_type, config_key, season)
const mcPayload = mcRows.map((r) => {
  const { id, created_at, updated_at, ...rest } = r;
  return { ...rest, updated_at: new Date().toISOString() };
});
const mcResult = await upsertChunked(STAGING, "model_config", mcPayload, "model_type,config_key,season");
console.log(`  Upserted ${mcResult.inserted} into staging`);
for (const e of mcResult.errors.slice(0, 3)) console.log(`  ERR: ${e}`);

// ─── 2) ai_scouting_reports — translate via source_player_id ─────────
// Player UUIDs differ between envs. Same TruMedia source_player_id, but
// staging assigned its own UUIDs when players were created. So we map:
//   prod report → prod player_id → prod players.source_player_id
//                → staging players.id (by source_player_id) → write
console.log("\n=== ai_scouting_reports ===");
const reports = await fetchAll(PROD, "ai_scouting_reports");
console.log(`  Fetched ${reports.length} prod reports`);

// Build prod player_id → source_player_id map
const prodPlayerIdToSource = new Map<string, string>();
{
  let from = 0;
  while (true) {
    const { data } = await (PROD as any).from("players").select("id, source_player_id").order("id").range(from, from + 1000 - 1);
    if (!data || data.length === 0) break;
    for (const p of data) if (p.source_player_id) prodPlayerIdToSource.set(p.id, p.source_player_id);
    if (data.length < 1000) break;
    from += 1000;
  }
}
console.log(`  Prod players w/ source_player_id: ${prodPlayerIdToSource.size}`);

// Build staging source_player_id → staging player_id map
const stagingSourceToPlayerId = new Map<string, string>();
{
  let from = 0;
  while (true) {
    const { data } = await (STAGING as any).from("players").select("id, source_player_id").order("id").range(from, from + 1000 - 1);
    if (!data || data.length === 0) break;
    for (const p of data) if (p.source_player_id) stagingSourceToPlayerId.set(p.source_player_id, p.id);
    if (data.length < 1000) break;
    from += 1000;
  }
}
console.log(`  Staging players w/ source_player_id: ${stagingSourceToPlayerId.size}`);

// Translate each report's player_id
let translated = 0;
let prodNoSource = 0;
let stagingNoMatch = 0;
const reportPayload: any[] = [];
for (const r of reports) {
  const sourceId = prodPlayerIdToSource.get(r.player_id);
  if (!sourceId) { prodNoSource++; continue; }
  const stagingPid = stagingSourceToPlayerId.get(sourceId);
  if (!stagingPid) { stagingNoMatch++; continue; }
  const { id: _id, ...rest } = r;
  reportPayload.push({ ...rest, player_id: stagingPid });
  translated++;
}
console.log(`  Translated ${translated} reports for staging`);
console.log(`  Prod report had no source_player_id: ${prodNoSource}`);
console.log(`  Source not on staging (historical/JUCO/etc): ${stagingNoMatch}`);
const repResult = await upsertChunked(STAGING, "ai_scouting_reports", reportPayload, "player_id,side");
console.log(`  Upserted ${repResult.inserted} into staging`);
for (const e of repResult.errors.slice(0, 3)) console.log(`  ERR: ${e}`);

console.log("\n=== Done ===");
if (DRY_RUN) console.log("(DRY RUN — no writes to staging. Re-run without --dry-run to apply.)");
