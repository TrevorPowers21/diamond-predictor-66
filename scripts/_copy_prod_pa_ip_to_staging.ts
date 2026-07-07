/**
 * Copy prod's Hitter Master.pa and Pitching Master.IP values into
 * staging's regular_season_pa and regular_season_ip columns.
 *
 * Use case: staging's Master was overwritten with postseason-inclusive
 * data, so locking with the current pa/IP would freeze the wrong number.
 * Prod's Master still holds regular-season-only values (postseason
 * import hasn't run there yet), so we copy from there to give staging
 * a faithful "locked" state for testing the cascade.
 *
 * Run order:
 *   1. Read prod's Hitter Master (Season 2026) → {source_player_id, pa}
 *   2. Read prod's Pitching Master (Season 2026) → {source_player_id, IP}
 *   3. Update staging's regular_season_pa / regular_season_ip per row,
 *      keyed on (source_player_id, Season=2026). Skip if already set.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

// Read prod creds directly from .env.production.local (we're running with
// staging creds via npm script env loader; prod values are read manually).
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) throw new Error(`Env file not found: ${path}`);
  const env: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

const prodEnv = readEnvFile(".env.production.local");
const prodSb = createClient(
  prodEnv.VITE_SUPABASE_URL || prodEnv.SUPABASE_URL,
  prodEnv.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Staging from the env vars loaded by npm script
const stagingSb = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function fetchAllRows(sb: any, table: string, cols: string): Promise<any[]> {
  // Keyset pagination by source_player_id — OFFSET-based .range() silently
  // skips rows past ~8000 on prod (gateway timeout on the count-then-offset
  // query plan), which caused the first run to miss 3 hitters including
  // Hudson Brown. Keyset is index-only + constant-time per page.
  const out: any[] = [];
  let lastId = "";
  const PAGE = 1000;
  while (true) {
    let query = sb.from(table).select(cols).eq("Season", 2026).order("source_player_id", { ascending: true }).limit(PAGE);
    if (lastId) query = query.gt("source_player_id", lastId);
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    lastId = data[data.length - 1].source_player_id;
    if (data.length < PAGE) break;
  }
  return out;
}

async function main() {
  console.log(`Reading prod Hitter Master...`);
  const prodHitters = await fetchAllRows(prodSb, "Hitter Master", "source_player_id, pa");
  console.log(`  ${prodHitters.length} rows`);

  console.log(`Reading prod Pitching Master...`);
  const prodPitchers = await fetchAllRows(prodSb, "Pitching Master", "source_player_id, IP");
  console.log(`  ${prodPitchers.length} rows`);

  // Map source_player_id → regular-season value
  const hitterMap = new Map<string, number>();
  for (const r of prodHitters) {
    if (r.source_player_id && r.pa != null) hitterMap.set(r.source_player_id, Number(r.pa));
  }
  const pitcherMap = new Map<string, number>();
  for (const r of prodPitchers) {
    if (r.source_player_id && r.IP != null) pitcherMap.set(r.source_player_id, Number(r.IP));
  }
  console.log(`\nMapped ${hitterMap.size} hitter regular-season PA values + ${pitcherMap.size} pitcher regular-season IP values from prod.\n`);

  // Read staging Master to know which source_player_ids exist there
  console.log(`Reading staging Hitter Master IDs...`);
  const stHitters = await fetchAllRows(stagingSb, "Hitter Master", "source_player_id, regular_season_pa");
  console.log(`  ${stHitters.length} rows on staging`);
  const stHitterAlreadySet = stHitters.filter((r) => r.regular_season_pa != null).length;
  console.log(`  ${stHitterAlreadySet} already have regular_season_pa set (will skip)`);

  console.log(`Reading staging Pitching Master IDs...`);
  const stPitchers = await fetchAllRows(stagingSb, "Pitching Master", "source_player_id, regular_season_ip");
  console.log(`  ${stPitchers.length} rows on staging`);
  const stPitcherAlreadySet = stPitchers.filter((r) => r.regular_season_ip != null).length;
  console.log(`  ${stPitcherAlreadySet} already have regular_season_ip set (will skip)`);

  // Build updates — only set on staging rows where (1) we have a prod
  // regular-season value and (2) staging's regular_season_pa is currently null.
  const hitterUpdates = stHitters.filter((r) => r.regular_season_pa == null && hitterMap.has(r.source_player_id));
  const pitcherUpdates = stPitchers.filter((r) => r.regular_season_ip == null && pitcherMap.has(r.source_player_id));
  console.log(`\nPlanned: ${hitterUpdates.length} hitter PA writes + ${pitcherUpdates.length} pitcher IP writes`);

  // Apply hitter updates
  console.log(`\nApplying hitter regular_season_pa updates...`);
  let hPaWrote = 0;
  for (let i = 0; i < hitterUpdates.length; i += 50) {
    const batch = hitterUpdates.slice(i, i + 50);
    await Promise.all(batch.map(async (r) => {
      const pa = hitterMap.get(r.source_player_id);
      const { error } = await (stagingSb as any)
        .from("Hitter Master")
        .update({ regular_season_pa: pa })
        .eq("source_player_id", r.source_player_id)
        .eq("Season", 2026);
      if (!error) hPaWrote++;
    }));
    if (i % 1000 === 0) console.log(`  ${hPaWrote} / ${hitterUpdates.length}...`);
  }

  console.log(`\nApplying pitcher regular_season_ip updates...`);
  let pIpWrote = 0;
  for (let i = 0; i < pitcherUpdates.length; i += 50) {
    const batch = pitcherUpdates.slice(i, i + 50);
    await Promise.all(batch.map(async (r) => {
      const ip = pitcherMap.get(r.source_player_id);
      const { error } = await (stagingSb as any)
        .from("Pitching Master")
        .update({ regular_season_ip: ip })
        .eq("source_player_id", r.source_player_id)
        .eq("Season", 2026);
      if (!error) pIpWrote++;
    }));
    if (i % 1000 === 0) console.log(`  ${pIpWrote} / ${pitcherUpdates.length}...`);
  }

  console.log(`\n✅ Done. Hitter PA writes: ${hPaWrote} / ${hitterUpdates.length}, Pitcher IP writes: ${pIpWrote} / ${pitcherUpdates.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
