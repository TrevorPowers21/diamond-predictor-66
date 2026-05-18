#!/usr/bin/env node
/**
 * Backfill player_predictions rows for JUCO pitchers so they appear in the
 * existing TP pitching simulator.
 *
 * Methodology (locked 2026-05-17):
 *   - Use 2026 actual rate stats from Pitching Master verbatim.
 *   - Per-stat power weights = 0 (raw rates × env multiplier only).
 *   - Individual stuff_plus copied when present; null when absent.
 *     Callsite skips Stuff+ delta entirely for null Stuff+ pitchers
 *     (no district-average fallback per user direction 2026-05-17).
 *   - Conference hitter_talent_plus override applied at projection time
 *     via JUCO_DISTRICT_HTP_OVERRIDE in transferWeightDefaults.ts.
 *
 * Qualifier: IP ≥ 20 (matches the hitter PA ≥ 75 bar — excludes
 * single-appearance arms, keeps cohort meaningful).
 *
 * Usage:
 *   npm run backfill-juco-pitcher-preds              # dry-run
 *   npm run backfill-juco-pitcher-preds -- --apply   # write
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const IP_THRESHOLD = 20;
const SEASON = 2026;
const CONFIRM = "yes-backfill-juco-pitcher-preds";
const COLOR = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(COLOR.bold + `\n══ Backfill JUCO Pitcher Predictions ══` + COLOR.reset);
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

  // ── Pull qualifying JUCO Pitching Master rows ────────────────────────
  info(`Loading 2026 JUCO Pitching Master rows with IP ≥ ${IP_THRESHOLD}...`);
  const pitchers: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (sb as any)
      .from("Pitching Master")
      .select(`source_player_id, "playerFullName", "Team", "IP", "ERA", "FIP", "WHIP", "K9", "BB9", "HR9", stuff_plus, Role`)
      .eq("division", "NJCAA_D1")
      .eq("Season", SEASON)
      .gte("IP", IP_THRESHOLD)
      .range(from, from + 999);
    if (error) { err(`Pitching Master load: ${error.message}`); process.exit(1); }
    pitchers.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  info(`  ${pitchers.length} qualifying JUCO pitchers`);
  const withStuff = pitchers.filter((p) => p.stuff_plus != null).length;
  info(`  ${withStuff} (${Math.round(withStuff / pitchers.length * 100)}%) have individual Stuff+`);

  // ── Resolve source_player_id → players.id ────────────────────────────
  info(`Resolving to players.id...`);
  const sourceIds = pitchers.map((p) => p.source_player_id).filter(Boolean);
  const idMap = new Map<string, string>();
  for (let i = 0; i < sourceIds.length; i += 500) {
    const chunk = sourceIds.slice(i, i + 500);
    const { data } = await sb.from("players").select("id, source_player_id").in("source_player_id", chunk);
    for (const p of (data || [])) {
      if (p.source_player_id) idMap.set(p.source_player_id, p.id);
    }
  }
  info(`  ${idMap.size}/${sourceIds.length} resolved`);

  // ── Identify existing rows (hitter-only TWP rows we need to UPDATE
  //    vs missing rows we need to INSERT vs already-backfilled to skip).
  const playerIds = Array.from(idMap.values());
  const existingRowMap = new Map<string, { id: string; from_era: number | null }>();
  for (let i = 0; i < playerIds.length; i += 100) {
    const chunk = playerIds.slice(i, i + 100);
    const { data } = await sb
      .from("player_predictions")
      .select("id, player_id, from_era")
      .in("player_id", chunk)
      .eq("model_type", "returner")
      .eq("variant", "regular")
      .eq("season", SEASON);
    for (const r of (data || [])) existingRowMap.set(r.player_id, { id: r.id, from_era: r.from_era });
  }
  const alreadyPitching = Array.from(existingRowMap.values()).filter((r) => r.from_era != null).length;
  const twpToUpdate = Array.from(existingRowMap.values()).filter((r) => r.from_era == null).length;
  info(`  ${alreadyPitching} already have pitcher returner (skip)`);
  info(`  ${twpToUpdate} TWP rows (hitter row exists, add pitcher fields via UPDATE)`);

  // ── Split payload into INSERTs (new rows) vs UPDATEs (TWP merges) ────
  const inserts: any[] = [];
  const updates: Array<{ id: string; patch: any }> = [];
  const inferRole = (role: string | null, ip: number): "SP" | "RP" | "SM" => {
    if (role === "SP" || role === "RP" || role === "SM") return role;
    return ip >= 60 ? "SP" : "RP";
  };
  for (const p of pitchers) {
    const playerId = p.source_player_id ? idMap.get(p.source_player_id) : null;
    if (!playerId) continue;
    if (p.ERA == null || p.FIP == null || p.WHIP == null || p.K9 == null || p.BB9 == null || p.HR9 == null) continue;
    const pitcherFields = {
      from_era: p.ERA, from_fip: p.FIP, from_whip: p.WHIP,
      from_k9: p.K9, from_bb9: p.BB9, from_hr9: p.HR9,
      from_stuff_plus_self: p.stuff_plus,
      pitcher_role: inferRole(p.Role, p.IP),
    };
    const existing = existingRowMap.get(playerId);
    if (existing) {
      if (existing.from_era != null) continue;  // already has pitcher data
      // TWP — UPDATE the existing hitter row by id with pitcher fields
      updates.push({ id: existing.id, patch: pitcherFields });
    } else {
      // Pitcher-only — INSERT fresh row
      inserts.push({
        player_id: playerId,
        model_type: "returner",
        variant: "regular",
        season: SEASON,
        status: "active",
        class_transition: null,
        dev_aggressiveness: 0,
        ...pitcherFields,
      });
    }
  }
  info(`  ${inserts.length} new inserts · ${updates.length} TWP updates`);

  if (!apply) {
    console.log(`\n${COLOR.cyan}Dry-run complete. Re-run with --apply.${COLOR.reset}`);
    if (inserts.length > 0) info(`  Insert sample: ${JSON.stringify(inserts[0])}`);
    if (updates.length > 0) info(`  Update sample: id=${updates[0].id}, patch=${JSON.stringify(updates[0].patch)}`);
    return;
  }

  let insDone = 0;
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500);
    const { error } = await sb.from("player_predictions").insert(chunk);
    if (error) { err(`  insert chunk @${i}: ${error.message}`); continue; }
    insDone += chunk.length;
  }
  ok(`Inserted ${insDone} pitcher-only JUCO returner predictions`);

  // TWP updates — by row id, in parallel batches
  const CONC = 25;
  let updDone = 0;
  for (let i = 0; i < updates.length; i += CONC) {
    const chunk = updates.slice(i, i + CONC);
    await Promise.all(chunk.map(async (u) => {
      const { error } = await sb.from("player_predictions").update(u.patch).eq("id", u.id);
      if (!error) updDone++;
      else warn(`  update ${u.id}: ${error.message}`);
    }));
  }
  ok(`Updated ${updDone} TWP rows with pitcher fields`);
  console.log(`\n${COLOR.green}Done.${COLOR.reset}`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
