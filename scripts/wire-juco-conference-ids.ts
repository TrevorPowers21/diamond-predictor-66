#!/usr/bin/env node
/**
 * Wire conference_id linkage for JUCO district rows + JUCO players.
 *
 * Phases:
 *   1. Sync Conference Names from prod → staging (29 rows — preserves UUIDs)
 *   2. Insert 10 JUCO district Conference Names with deterministic UUIDs
 *   3. Update Conference Stats JUCO district rows → set conference_id
 *   4. Update Hitter Master + Pitching Master JUCO rows → set conference_id
 *      based on their Teams Table district
 *
 * Run after `npm run populate-conf-stats -- --apply` has created the 10
 * district rows in Conference Stats.
 */
import { createInterface } from "node:readline/promises";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const CONFIRM_PHRASE = "yes-wire-juco-conf-ids";

const COLOR = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
const step = (s: string) => console.log(`\n${COLOR.bold}→${COLOR.reset} ${s}`);
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

/** Deterministic UUID v5-style from a name (so reruns produce same IDs). */
function uuidFromName(name: string): string {
  const hash = createHash("sha1").update(`juco-district:${name}`).digest("hex");
  // Format as UUID v4-shape: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const DISTRICTS = [
  "South Atlantic", "Southwest", "Mid-South", "Plains", "Appalachian",
  "East", "Midwest", "South", "South Central", "West",
];

async function confirm(): Promise<void> {
  warn(`This will WRITE to staging. Type "${CONFIRM_PHRASE}" to continue.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("> ")).trim();
  rl.close();
  if (answer !== CONFIRM_PHRASE) { err("Aborted."); process.exit(1); }
  ok("Confirmed. Proceeding.");
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(COLOR.bold + "\n══ Wire JUCO Conference IDs ══" + COLOR.reset);
  console.log(apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  const stagingUrl = process.env.SUPABASE_URL ?? "";
  const stagingKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const prodEnv = loadEnvFile(join(process.cwd(), ".env.production.local"));
  const prodUrl = prodEnv.SUPABASE_URL ?? "";
  const prodKey = prodEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!stagingUrl.includes("slrxowawbijbjrkozqlj")) { err("Expected staging URL"); process.exit(1); }
  if (!prodUrl.includes("trbvxuoliwrfowibatkm")) { err("Expected prod URL"); process.exit(1); }

  const staging = createClient(stagingUrl, stagingKey, { auth: { persistSession: false } });
  const prod = createClient(prodUrl, prodKey, { auth: { persistSession: false } });

  if (apply) await confirm();

  // ── Phase 1: Sync Conference Names prod → staging ─────────────────────
  step("Phase 1: Conference Names sync");
  const { data: prodNames } = await prod.from("Conference Names").select("*");
  const { data: stagingNames } = await staging.from("Conference Names").select("id");
  const stagingIds = new Set((stagingNames ?? []).map((r: any) => r.id));
  const missing = (prodNames ?? []).filter((r: any) => !stagingIds.has(r.id));
  info(`Prod: ${prodNames?.length ?? 0}, Staging: ${stagingNames?.length ?? 0}, To insert: ${missing.length}`);
  if (apply && missing.length > 0) {
    const { error } = await staging.from("Conference Names").insert(missing);
    if (error) { err(`Insert failed: ${error.message}`); throw error; }
    ok(`Inserted ${missing.length} Conference Names`);
  }

  // ── Phase 2: JUCO district Conference Names ───────────────────────────
  step("Phase 2: JUCO district Conference Names");
  const districtRows = DISTRICTS.map((d) => ({
    id: uuidFromName(d),
    name: `NJCAA D1 ${d} District`,
    "conference abbreviation": `NJCAA D1 ${d}`,
  }));
  for (const r of districtRows) info(`${r["conference abbreviation"]} → ${r.id}`);
  if (apply) {
    const { error } = await staging.from("Conference Names").upsert(districtRows, { onConflict: "id" });
    if (error) { err(`Upsert failed: ${error.message}`); throw error; }
    ok(`Upserted ${districtRows.length} JUCO district Conference Names`);
  }

  // Build district name → conference_id map for downstream phases
  const districtConfId = new Map<string, string>();
  for (const r of districtRows) districtConfId.set(r["conference abbreviation"].replace("NJCAA D1 ", ""), r.id);

  // ── Phase 3: Update Conference Stats JUCO rows → set conference_id ────
  step("Phase 3: Conference Stats JUCO rows conference_id");
  const { data: jucoCSRows } = await staging
    .from("Conference Stats")
    .select(`"conference abbreviation", season, conference_id`)
    .ilike("conference abbreviation", "NJCAA D1%");
  info(`Found ${jucoCSRows?.length ?? 0} JUCO Conference Stats rows`);
  for (const r of (jucoCSRows ?? []) as any[]) {
    // "conference abbreviation" = "NJCAA D1 East District" → extract "East"
    const m = r["conference abbreviation"].match(/^NJCAA D1 (.+) District$/);
    if (!m) { warn(`Skip unmatched: ${r["conference abbreviation"]}`); continue; }
    const districtName = m[1];
    const newId = districtConfId.get(districtName);
    if (!newId) { warn(`No UUID for district: ${districtName}`); continue; }
    if (r.conference_id === newId) continue;
    if (apply) {
      const { error } = await staging.from("Conference Stats")
        .update({ conference_id: newId })
        .eq("conference abbreviation", r["conference abbreviation"])
        .eq("season", r.season);
      if (error) warn(`Update failed for ${districtName}: ${error.message}`);
    }
    info(`${districtName} → ${newId}`);
  }
  if (apply) ok("Conference Stats JUCO rows wired");

  // ── Phase 4: Update Hitter Master + Pitching Master conference_id ─────
  step("Phase 4: JUCO Hitter/Pitching Master conference_id");

  // Get Teams Table district map
  const { data: teamsTable } = await staging.from("Teams Table").select("id, district");
  const teamDistrict = new Map<string, string>();
  for (const t of (teamsTable ?? []) as any[]) {
    if (t.id && t.district) teamDistrict.set(t.id, t.district);
  }
  info(`Teams Table district map: ${teamDistrict.size} entries`);

  for (const table of ["Hitter Master", "Pitching Master"] as const) {
    info(`Processing ${table}...`);
    // Page through JUCO rows
    const rows: any[] = [];
    let from = 0;
    while (true) {
      const { data } = await staging.from(table)
        .select(`id, "TeamID", conference_id`)
        .eq("division", "NJCAA_D1")
        .range(from, from + 999);
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
      from += 1000;
    }
    info(`  ${rows.length} JUCO rows`);

    const updates: Array<{ id: string; conference_id: string }> = [];
    for (const r of rows) {
      const district = teamDistrict.get(r.TeamID);
      if (!district) continue;
      const newConfId = districtConfId.get(district);
      if (!newConfId) continue;
      if (r.conference_id === newConfId) continue;
      updates.push({ id: r.id, conference_id: newConfId });
    }
    info(`  ${updates.length} need conference_id update`);

    if (apply && updates.length > 0) {
      const CONCURRENCY = 25;
      let done = 0;
      for (let i = 0; i < updates.length; i += CONCURRENCY) {
        const chunk = updates.slice(i, i + CONCURRENCY);
        await Promise.all(chunk.map(async (u) => {
          await staging.from(table).update({ conference_id: u.conference_id }).eq("id", u.id);
        }));
        done += chunk.length;
      }
      ok(`  Updated ${done} ${table} rows`);
    }
  }

  console.log("\n" + (apply ? COLOR.green + "Done." : COLOR.cyan + "Dry-run complete. Re-run with --apply.") + COLOR.reset);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
