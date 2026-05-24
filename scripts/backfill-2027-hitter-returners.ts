#!/usr/bin/env node
/**
 * 2027 Hitter Returner Backfill.
 *
 * After the 2026-05-23 season-convention fix, all read paths filter for
 * `season = PROJECTION_SEASON = 2027`. The hitter side has zero returner rows
 * at 2027 (they're all preserved at 2026 as history), so Dashboard hitter
 * leaderboards are empty. This script fixes that in two steps:
 *
 *   1. `createPredictionsFromMaster()` — creates `(model_type='returner',
 *      variant='regular', customer_team_id=NULL, season=2027)` rows for every
 *      player that doesn't have one yet, populating `from_avg / from_obp /
 *      from_slg / power_rating_plus / class_transition` from Hitter Master
 *      2026.
 *   2. For every 2027 hitter returner row (existing or newly-created), recompute
 *      `p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc, p_wrc_plus` using the live
 *      `recalcReturner` engine + the player's stored power-rating internals.
 *
 * Pitcher and transfer rows are intentionally untouched here. The filter
 * `from_avg IS NOT NULL` excludes pitcher rows (which carry from_era instead).
 * Transfer rows are not selected at all.
 *
 * Usage:
 *   npm run backfill-2027-hitter-returners               # staging
 *   npm run backfill-2027-hitter-returners -- --dry-run  # staging dry-run
 *   npm run backfill-2027-hitter-returners:prod          # prod
 */

import { supabase } from "@/integrations/supabase/client";
import { CURRENT_SEASON, PROJECTION_SEASON } from "@/lib/seasonConstants";
import { createPredictionsFromMaster } from "@/lib/createPredictionsFromMaster";
import {
  loadEngineConfig,
  recalcReturner,
  readSpecificPlus,
  type ReturnerPowerContext,
} from "@/lib/predictionEngine";
import { computeHitterOWar, computeHitterMarketValue } from "@/lib/depthRoles";

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m" };

async function loadAllPaged<T>(builder: () => any): Promise<T[]> {
  const PAGE = 1000;
  let out: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await builder().range(from, from + PAGE - 1);
    if (error) throw error;
    out = out.concat(data || []);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const dryRun = process.argv.includes("--dry-run");

  // Env-detection guard: refuse to write prod unless --prod explicitly passed.
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").toLowerCase();
  const looksLikeProd = supabaseUrl.includes("ualmkgkdnoubccoieahf") || supabaseUrl.includes("prod");
  if (looksLikeProd && !isProd) {
    console.error(`${C.red}✗ SUPABASE_URL looks like PROD but --prod was not passed. Refusing to write.${C.reset}`);
    console.error(`  URL: ${supabaseUrl || "(unset)"}`);
    process.exit(1);
  }
  if (isProd && !looksLikeProd) {
    console.error(`${C.red}✗ --prod passed but SUPABASE_URL doesn't look like prod. Refusing to write.${C.reset}`);
    console.error(`  URL: ${supabaseUrl || "(unset)"}`);
    process.exit(1);
  }

  console.log(`${C.bold}2027 Hitter Returner Backfill${C.reset} on ${isProd ? "PROD" : "STAGING"}${dryRun ? ` ${C.yellow}[DRY RUN]${C.reset}` : ""}`);
  console.log(`  data season:       ${CURRENT_SEASON} (Hitter Master)`);
  console.log(`  projection season: ${PROJECTION_SEASON} (player_predictions write target)`);

  // ─── Step 1: createPredictionsFromMaster ─────────────────────────────
  if (dryRun) {
    console.log(`${C.yellow}[DRY RUN]${C.reset} skipping createPredictionsFromMaster() — would create/update returner rows at season=${PROJECTION_SEASON} from Hitter Master ${CURRENT_SEASON}`);
  } else {
    console.log(`${C.cyan}→${C.reset} step 1: createPredictionsFromMaster() — creating 2027 returner rows from Hitter Master 2026...`);
    const createResult = await createPredictionsFromMaster();
    console.log(`  ${C.green}✓${C.reset} createPredictionsFromMaster:`, createResult);
    if (createResult.errors.length > 0) {
      console.log(`  ${C.yellow}${createResult.errors.length} errors during create (continuing to recalc):${C.reset}`);
      for (const e of createResult.errors.slice(0, 5)) console.log(`    ${e}`);
    }
  }

  // ─── Step 2: load all 2027 hitter returner rows ──────────────────────
  console.log(`${C.cyan}→${C.reset} step 2: loading 2027 hitter returner rows...`);
  const rows = await loadAllPaged<any>(() =>
    supabase
      .from("player_predictions")
      .select("*")
      .eq("season", PROJECTION_SEASON)
      .eq("model_type", "returner")
      .eq("variant", "regular")
      .is("customer_team_id", null)
      .not("from_avg", "is", null),
  );
  console.log(`  ${rows.length} hitter returner rows at season=${PROJECTION_SEASON} (from_avg NOT NULL)`);
  if (rows.length === 0) {
    console.log(`${C.yellow}Nothing to recalc. Exiting.${C.reset}`);
    return;
  }

  // ─── Step 3: load engine config ──────────────────────────────────────
  console.log(`${C.cyan}→${C.reset} loading engine config (returner side)...`);
  const config = await loadEngineConfig();

  // ─── Step 3b: load player meta (position + conference + pa) for oWAR/$ ─
  // Returner rows have customer_team_id=NULL, so the "home" conference is the
  // player's current team conference — used for the program-tier market scale.
  // players.conference is NULL for ~10K rows, so fall back to Teams Table
  // resolution via source_team_id (or team name) when missing — otherwise the
  // multiplier defaults to lowMajor (0.5) and every affected player gets
  // mid-major market values regardless of where they actually play.
  console.log(`${C.cyan}→${C.reset} loading player meta (position + conference + pa)...`);
  const playerIds = Array.from(new Set(rows.map((r) => r.player_id as string)));
  const playerMeta = new Map<string, { position: string | null; conference: string | null; pa: number | null }>();
  const PLAYER_BATCH = 200;
  const rawPlayers: Array<{ id: string; position: string | null; conference: string | null; pa: number | null; source_team_id: string | null; team: string | null }> = [];
  for (let i = 0; i < playerIds.length; i += PLAYER_BATCH) {
    const ids = playerIds.slice(i, i + PLAYER_BATCH);
    const { data, error } = await supabase
      .from("players")
      .select("id, position, conference, pa, source_team_id, team")
      .in("id", ids);
    if (error) throw error;
    for (const p of (data || []) as any[]) rawPlayers.push(p);
  }

  // Build a Teams Table lookup keyed by source_id and by normalized team name
  // so we can resolve conference when players.conference is null.
  console.log(`${C.cyan}→${C.reset} loading Teams Table for conference fallback...`);
  const teamsRows = await loadAllPaged<any>(() =>
    (supabase as any).from("Teams Table").select("source_id, full_name, abbreviation, conference"),
  );
  const teamConfBySourceId = new Map<string, string | null>();
  const teamConfByName = new Map<string, string | null>();
  const normKey = (s: string | null | undefined) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const t of teamsRows as any[]) {
    if (t.source_id) teamConfBySourceId.set(String(t.source_id), t.conference ?? null);
    if (t.full_name) teamConfByName.set(normKey(t.full_name), t.conference ?? null);
    if (t.abbreviation) teamConfByName.set(normKey(t.abbreviation), t.conference ?? null);
  }
  let confFromPlayer = 0;
  let confFromSourceId = 0;
  let confFromName = 0;
  let confUnresolved = 0;
  for (const p of rawPlayers) {
    let conf: string | null = p.conference ?? null;
    if (conf) confFromPlayer++;
    else if (p.source_team_id && teamConfBySourceId.has(String(p.source_team_id))) {
      conf = teamConfBySourceId.get(String(p.source_team_id)) ?? null;
      if (conf) confFromSourceId++; else confUnresolved++;
    } else if (p.team && teamConfByName.has(normKey(p.team))) {
      conf = teamConfByName.get(normKey(p.team)) ?? null;
      if (conf) confFromName++; else confUnresolved++;
    } else {
      confUnresolved++;
    }
    playerMeta.set(p.id, { position: p.position, conference: conf, pa: p.pa });
  }
  console.log(`  conference resolution: ${confFromPlayer} from players.conference, ${confFromSourceId} from source_team_id, ${confFromName} from team name, ${confUnresolved} unresolved`);

  // ─── Step 4: batch-load internals + recalc ───────────────────────────
  console.log(`${C.cyan}→${C.reset} recomputing p_* fields...`);
  const INTERNALS_BATCH = 200;
  const updates: Array<{ id: string; patch: any }> = [];
  let computed = 0;
  let nullProjected = 0;
  let missingInternals = 0;

  for (let i = 0; i < rows.length; i += INTERNALS_BATCH) {
    const slice = rows.slice(i, i + INTERNALS_BATCH);
    const ids = slice.map((r) => r.id);
    const { data: internals, error } = await supabase
      .from("player_prediction_internals")
      .select("prediction_id, avg_power_rating, obp_power_rating, slg_power_rating")
      .in("prediction_id", ids);
    if (error) throw error;
    const byId = new Map<string, any>();
    for (const it of internals || []) byId.set((it as any).prediction_id, it);

    for (const row of slice) {
      const internal = byId.get(row.id);
      if (!internal) missingInternals++;
      const powerContext: ReturnerPowerContext = {
        baPlus: readSpecificPlus(internal?.avg_power_rating) ?? null,
        obpPlus: readSpecificPlus(internal?.obp_power_rating) ?? null,
        isoPlus: readSpecificPlus(internal?.slg_power_rating) ?? null,
      };
      const result = recalcReturner(row, config.returner, powerContext);
      if (result.p_avg == null && result.p_obp == null && result.p_slg == null) {
        nullProjected++;
      }
      const meta = playerMeta.get(row.player_id) ?? { position: null, conference: null, pa: null };
      const oWar = computeHitterOWar(result.p_wrc_plus, meta.pa, null);
      const marketValue = computeHitterMarketValue(oWar, {
        conference: meta.conference,
        position: meta.position,
      });
      updates.push({
        id: row.id,
        patch: {
          p_avg: result.p_avg,
          p_obp: result.p_obp,
          p_slg: result.p_slg,
          p_ops: result.p_ops,
          p_iso: result.p_iso,
          p_wrc: result.p_wrc,
          p_wrc_plus: result.p_wrc_plus,
          o_war: oWar,
          market_value: marketValue,
          projected_pa: meta.pa,
          // Unlock so future runs can refresh; trigger reverts rates when locked=true.
          locked: false,
          updated_at: new Date().toISOString(),
        },
      });
      computed++;
    }
  }

  console.log(`${C.bold}Recalc result:${C.reset} ${C.green}${computed} computed${C.reset}, ${C.yellow}${nullProjected} all-null projections${C.reset}, ${C.yellow}${missingInternals} rows missing internals${C.reset}`);

  if (dryRun) {
    console.log(`${C.yellow}[DRY RUN]${C.reset} would UPDATE ${updates.length} rows. Sample:`);
    console.log(JSON.stringify(updates.slice(0, 2), null, 2));
    return;
  }

  // ─── Step 5: UPDATE rows in batches (NOT upsert — rows already exist) ─
  console.log(`${C.cyan}→${C.reset} updating ${updates.length} rows in batches of 100...`);
  const WRITE_BATCH = 100;
  let written = 0;
  let writeErrors = 0;
  for (let i = 0; i < updates.length; i += WRITE_BATCH) {
    const batch = updates.slice(i, i + WRITE_BATCH);
    // Each row update goes individually (Supabase UPDATE doesn't support
    // multi-row WHERE id IN (...) with per-row values). Fire concurrently
    // within each batch to keep throughput reasonable.
    const settled = await Promise.allSettled(
      batch.map((u) =>
        supabase.from("player_predictions").update(u.patch).eq("id", u.id),
      ),
    );
    for (const s of settled) {
      if (s.status === "rejected" || (s.status === "fulfilled" && (s.value as any).error)) {
        writeErrors++;
      } else {
        written++;
      }
    }
    process.stdout.write(`\r  ${written}/${updates.length}${writeErrors > 0 ? ` (${writeErrors} errors)` : ""}`);
  }
  console.log(`\n${C.green}✓ done${C.reset} — ${written} updated, ${writeErrors} errors`);
}

main().catch((e) => { console.error(e); process.exit(1); });
