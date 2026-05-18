#!/usr/bin/env node
/**
 * Remap Teams Table.conference_id for JUCO rows from orphan placeholder
 * UUIDs (a1c70000-...) to the real district UUIDs created by
 * wire-juco-conference-ids.ts. Mapping is by district name.
 *
 * The placeholder UUIDs came from an earlier JUCO import; they don't exist
 * in Conference Names or Conference Stats so any lookup through them fails
 * silently — TransferPortal then falls back to name aliases and matches the
 * wrong conference row.
 *
 * Usage:
 *   npm run fix-juco-tt-conf-ids                # dry-run
 *   npm run fix-juco-tt-conf-ids -- --apply     # apply
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const COLOR = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);
const CONFIRM = "yes-fix-juco-tt-conf-ids";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(COLOR.bold + `\n══ Fix JUCO Teams Table conference_id ══` + COLOR.reset);
  console.log(apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes("slrxowawbijbjrkozqlj")) { err("Expected staging URL"); process.exit(1); }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  if (apply) {
    warn(`This will write to STAGING. Type "${CONFIRM}" to continue.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("> ")).trim();
    rl.close();
    if (answer !== CONFIRM) { err("Aborted."); process.exit(1); }
  }

  // ── Build district name → correct conference_id map from Conf Names ──
  const { data: confNames } = await sb.from("Conference Names").select("id, name").like("name", "NJCAA D1 % District");
  const districtToId = new Map<string, string>();
  for (const r of confNames || []) {
    // "NJCAA D1 Appalachian District" → "Appalachian"
    const m = (r.name || "").match(/^NJCAA D1 (.+) District$/);
    if (m) districtToId.set(m[1], r.id);
  }
  info(`Loaded ${districtToId.size} district name→id mappings:`);
  for (const [d, id] of districtToId) info(`  ${d.padEnd(15)} → ${id}`);

  // ── Pull JUCO Teams Table rows with placeholder conf_id ──────────────
  const { data: tt } = await sb
    .from("Teams Table")
    .select("id, full_name, district, conference, conference_id, Season")
    .eq("division", "NJCAA_D1")
    .eq("Season", 2026);
  info(`\n${tt?.length ?? 0} JUCO Teams Table 2026 rows`);

  // ── Build update list ────────────────────────────────────────────────
  const updates: Array<{ id: string; conference_id: string; name: string; district: string }> = [];
  const unresolved: any[] = [];
  for (const t of (tt || []) as any[]) {
    if (!t.district) { unresolved.push({ id: t.id, name: t.full_name, reason: "no district" }); continue; }
    const correctId = districtToId.get(t.district);
    if (!correctId) { unresolved.push({ id: t.id, name: t.full_name, district: t.district, reason: "no mapping" }); continue; }
    if (t.conference_id === correctId) continue;
    updates.push({ id: t.id, conference_id: correctId, name: t.full_name, district: t.district });
  }
  info(`${updates.length} rows to update, ${unresolved.length} unresolved`);
  if (unresolved.length > 0 && unresolved.length < 20) {
    for (const u of unresolved) warn(`  unresolved: ${u.name} (${u.reason}, district=${u.district ?? "?"})`);
  }

  if (!apply) {
    console.log(`\n${COLOR.cyan}Dry-run complete. Sample updates:${COLOR.reset}`);
    for (const u of updates.slice(0, 5)) info(`  ${u.name.padEnd(28)} [${u.district.padEnd(15)}] → ${u.conference_id}`);
    return;
  }

  // ── Apply updates ─────────────────────────────────────────────────────
  let done = 0;
  const CONCURRENCY = 25;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const chunk = updates.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (u) => {
      const { error } = await sb.from("Teams Table").update({ conference_id: u.conference_id }).eq("id", u.id);
      if (error) warn(`  ${u.name}: ${error.message}`);
      else done++;
    }));
  }
  ok(`Updated ${done} Teams Table rows`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
