#!/usr/bin/env node
/**
 * Backfill player_predictions rows for JUCO hitters so they appear in the
 * existing Transfer Portal simulator UI.
 *
 * Methodology (locked 2026-05-17):
 *   - Use 2026 actual stats from Hitter Master verbatim (no PR blend, no
 *     regression — JUCO has no multi-season history to calibrate against).
 *   - Power-rating weights are zeroed in JUCO_TRANSFER_WEIGHTS so the
 *     projection collapses to: pAvg = lastAvg × env_multiplier.
 *   - PRs are still computed at import time for ~50% of JUCO players and
 *     remain in Hitter Master as a future add-on for scouting/profile use.
 *
 * Qualifier: PA ≥ 75 (excludes single-tournament samples).
 *
 * Idempotent — uses upsert keyed on (player_id, model_type, variant, season).
 *
 * Usage:
 *   npm run backfill-juco-preds              # dry-run
 *   npm run backfill-juco-preds -- --apply   # write
 */
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { createClient } from "@supabase/supabase-js";

const PA_THRESHOLD = 75;
const SEASON = 2026;
const CONFIRM = "yes-backfill-juco-preds";
const COLOR = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(COLOR.bold + `\n══ Backfill JUCO Hitter Predictions ══` + COLOR.reset);
  console.log(apply ? COLOR.red + "MODE: APPLY (will write)" + COLOR.reset : "MODE: dry-run");

  const isProd = process.argv.includes("--prod");
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  // Env-detection guard: refuse to write prod unless --prod explicitly passed.
  const lowerUrl = url.toLowerCase();
  const looksLikeProd = lowerUrl.includes("ualmkgkdnoubccoieahf") || lowerUrl.includes("trbvxuoliwrfowibatkm") || lowerUrl.includes("prod");
  if (looksLikeProd && !isProd) {
    err(`SUPABASE_URL looks like PROD but --prod was not passed. Refusing to write.`);
    err(`  URL: ${lowerUrl || "(unset)"}`);
    process.exit(1);
  }
  if (isProd && !looksLikeProd) {
    err(`--prod passed but SUPABASE_URL doesn't look like prod. Refusing to write.`);
    err(`  URL: ${lowerUrl || "(unset)"}`);
    process.exit(1);
  }
  if (!looksLikeProd && !lowerUrl.includes("slrxowawbijbjrkozqlj")) {
    err("Expected staging URL (slrxowawbijbjrkozqlj) or prod with --prod flag"); process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  if (apply) {
    warn(`This will write to STAGING. Type "${CONFIRM}" to continue.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question("> ")).trim();
    rl.close();
    if (answer !== CONFIRM) { err("Aborted."); process.exit(1); }
  }

  // ── Pull qualifying JUCO Hitter Master rows ──────────────────────────
  info(`Loading 2026 JUCO Hitter Master rows with PA ≥ ${PA_THRESHOLD}...`);
  const hitters: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (sb as any)
      .from("Hitter Master")
      .select(`source_player_id, "playerFullName", "Team", "AVG", "OBP", "SLG", pa`)
      .eq("division", "NJCAA_D1")
      .eq("Season", SEASON)
      .gte("pa", PA_THRESHOLD)
      .range(from, from + 999);
    if (error) { err(`Hitter Master load: ${error.message}`); process.exit(1); }
    hitters.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  info(`  ${hitters.length} qualifying JUCO hitters`);

  // ── Resolve source_player_id → players.id ────────────────────────────
  info(`Resolving to players.id...`);
  const sourceIds = hitters.map((h) => h.source_player_id).filter(Boolean);
  const idMap = new Map<string, string>();
  const chunkSize = 500;
  for (let i = 0; i < sourceIds.length; i += chunkSize) {
    const chunk = sourceIds.slice(i, i + chunkSize);
    const { data } = await sb.from("players").select("id, source_player_id").in("source_player_id", chunk);
    for (const p of (data || [])) {
      if (p.source_player_id) idMap.set(p.source_player_id, p.id);
    }
  }
  info(`  ${idMap.size}/${sourceIds.length} resolved`);
  const unresolved = sourceIds.length - idMap.size;
  if (unresolved > 0) warn(`  ${unresolved} hitters have no matching players row (will skip)`);

  // ── Check existing predictions (skip if already present) ─────────────
  const playerIds = Array.from(idMap.values());
  const existingIds = new Set<string>();
  // 100-id chunks to avoid PostgREST URL length limits on .in() queries.
  // Earlier 500-chunk runs silently missed existing rows, producing
  // duplicate-key conflicts on re-insert. (Same bug fixed in the pitcher
  // backfill — chunkSize of 500 hits the URL ceiling.)
  for (let i = 0; i < playerIds.length; i += 100) {
    const chunk = playerIds.slice(i, i + 100);
    const { data } = await sb
      .from("player_predictions")
      .select("player_id")
      .in("player_id", chunk)
      .eq("model_type", "returner")
      .eq("variant", "regular")
      .eq("season", SEASON);
    for (const r of (data || [])) existingIds.add(r.player_id);
  }
  info(`  ${existingIds.size} already have a 2026 returner-regular row (will skip)`);

  // ── Build payload ────────────────────────────────────────────────────
  const payload: any[] = [];
  for (const h of hitters) {
    const playerId = h.source_player_id ? idMap.get(h.source_player_id) : null;
    if (!playerId) continue;
    if (existingIds.has(playerId)) continue;
    if (h.AVG == null || h.OBP == null || h.SLG == null) continue;
    payload.push({
      player_id: playerId,
      model_type: "returner",
      variant: "regular",
      season: SEASON,
      status: "active",
      from_avg: h.AVG,
      from_obp: h.OBP,
      from_slg: h.SLG,
      class_transition: null,    // returner row; TP code zeros class adj for JUCO
      dev_aggressiveness: 0,
    });
  }
  info(`  ${payload.length} predictions to insert`);

  if (!apply) {
    console.log(`\n${COLOR.cyan}Dry-run complete. Re-run with --apply.${COLOR.reset}`);
    if (payload.length > 0) {
      const sample = payload[0];
      info(`  Sample: ${JSON.stringify(sample)}`);
    }
    return;
  }

  // ── Insert in chunks ─────────────────────────────────────────────────
  let done = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const { error } = await sb.from("player_predictions").insert(chunk);
    if (error) { err(`  insert chunk @${i}: ${error.message}`); continue; }
    done += chunk.length;
  }
  ok(`Inserted ${done} JUCO returner predictions`);
  console.log(`\n${COLOR.green}Done.${COLOR.reset}`);
}

main().catch((e) => { err(e instanceof Error ? e.message : String(e)); process.exit(1); });
