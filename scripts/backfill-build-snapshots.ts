#!/usr/bin/env node
/**
 * Backfill Build Snapshots — writes player_snapshot onto existing
 * team_build_players rows that have player_snapshot IS NULL.
 *
 * Reads predictions from player_predictions at season = CURRENT_SEASON
 * (same source that create-default-builds uses), builds a snapshot object
 * containing hitter and/or pitcher stats, and patches the row.
 *
 * Idempotent: rows that already have a non-null snapshot are skipped.
 * Use --force to overwrite existing snapshots.
 *
 * Usage:
 *   npm run backfill-build-snapshots                    # staging, dry-run
 *   npm run backfill-build-snapshots -- --apply         # staging, write
 *   npm run backfill-build-snapshots:prod -- --apply    # prod, write
 *   npm run backfill-build-snapshots -- --apply --force # overwrite existing
 *   npm run backfill-build-snapshots -- --apply --build <uuid>  # one build
 *
 * Requires: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or VITE_ prefix).
 */

import { createClient } from "@supabase/supabase-js";
import { PROJECTION_SEASON } from "@/lib/seasonConstants";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function arg(name: string): string | undefined {
  const i = process.argv.findIndex(
    (a) => a === `--${name}` || a.startsWith(`--${name}=`)
  );
  if (i < 0) return undefined;
  const v = process.argv[i];
  if (v.includes("=")) return v.split("=").slice(1).join("=");
  return process.argv[i + 1];
}

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

function isPitcherPosition(pos: string | null | undefined): boolean {
  return /^(SP|RP|CL|P|LHP|RHP)/i.test(String(pos || ""));
}

async function main() {
  const isProd = process.argv.includes("--prod");
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");
  const singleBuildId = arg("build");

  const supabaseUrl = (
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ""
  ).toLowerCase();
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    "";

  const looksLikeProd =
    supabaseUrl.includes("trbvxuoliwrfowibatkm") ||
    supabaseUrl.includes("prod");

  if (looksLikeProd && !isProd) {
    console.error(
      `${C.red}✗ SUPABASE_URL looks like PROD but --prod was not passed. Refusing to write.${C.reset}`
    );
    process.exit(1);
  }
  if (isProd && !looksLikeProd) {
    console.error(
      `${C.red}✗ --prod passed but SUPABASE_URL doesn't look like prod. Refusing to write.${C.reset}`
    );
    process.exit(1);
  }

  const ENV_LABEL = looksLikeProd ? "PROD" : "STAGING";
  const sb = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  console.log(`\n${"=".repeat(64)}`);
  console.log(`  Backfill Build Snapshots`);
  console.log(`${"=".repeat(64)}`);
  console.log(`  Env:          ${ENV_LABEL}`);
  console.log(`  Season:       ${PROJECTION_SEASON}`);
  console.log(`  Mode:         ${apply ? "APPLY (writes to DB)" : "DRY-RUN"}`);
  console.log(`  Force:        ${force}`);
  if (singleBuildId) console.log(`  Build filter: ${singleBuildId}`);
  console.log(`${"=".repeat(64)}\n`);

  // 1. Load all build player rows that need snapshots
  let bpQuery = sb
    .from("team_build_players")
    .select("id, player_id, position_slot, build_id, player_snapshot");

  if (!force) {
    bpQuery = bpQuery.is("player_snapshot", null);
  }
  if (singleBuildId) {
    bpQuery = bpQuery.eq("build_id", singleBuildId);
  }

  console.log(`Loading build player rows...`);
  const { data: buildPlayers, error: bpErr } = await bpQuery;
  if (bpErr) {
    console.error(`${C.red}✗ Failed to load build players: ${bpErr.message}${C.reset}`);
    process.exit(1);
  }
  if (!buildPlayers || buildPlayers.length === 0) {
    console.log(`${C.green}✓ No rows need backfilling.${C.reset}`);
    return;
  }

  // Skip rows without a valid player_id (local/fallback players)
  const rowsWithId = buildPlayers.filter(
    (bp: any) => typeof bp.player_id === "string" && bp.player_id.length > 0
  );
  console.log(
    `  Total rows: ${buildPlayers.length}, rows with player_id: ${rowsWithId.length}\n`
  );

  // 2. Load predictions for all unique player_ids in one batch
  const uniquePlayerIds = [...new Set(rowsWithId.map((bp: any) => bp.player_id as string))];
  console.log(`Loading predictions for ${uniquePlayerIds.length} unique players (season=${PROJECTION_SEASON})...`);

  const PAGE_SIZE = 500;
  let allPredictions: any[] = [];
  for (let i = 0; i < uniquePlayerIds.length; i += PAGE_SIZE) {
    const chunk = uniquePlayerIds.slice(i, i + PAGE_SIZE);
    const { data: predData, error: predErr } = await sb
      .from("player_predictions")
      .select(
        "player_id, customer_team_id, variant, model_type, status, " +
        "p_avg, p_obp, p_slg, p_wrc_plus, o_war, market_value, " +
        "twp_hitter_market_value, twp_pitcher_market_value, hitter_depth_role, " +
        "p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, " +
        "pitcher_role, pitcher_depth_role, class_transition, dev_aggressiveness"
      )
      .in("player_id", chunk)
      .eq("season", PROJECTION_SEASON)
      .in("status", ["active", "departed"]);

    if (predErr) {
      console.error(`${C.red}✗ Prediction fetch error: ${predErr.message}${C.reset}`);
      process.exit(1);
    }
    allPredictions = allPredictions.concat(predData || []);
  }
  console.log(`  Loaded ${allPredictions.length} prediction rows.\n`);

  // 3. Load player metadata to know is_twp and position
  const { data: playerData, error: playerErr } = await sb
    .from("players")
    .select("id, position, is_twp")
    .in("id", uniquePlayerIds);

  if (playerErr) {
    console.error(`${C.red}✗ Player fetch error: ${playerErr.message}${C.reset}`);
    process.exit(1);
  }
  const playerMap = new Map<string, { position: string | null; is_twp: boolean }>();
  for (const p of playerData || []) {
    playerMap.set(p.id, { position: p.position ?? null, is_twp: !!p.is_twp });
  }

  // 4. Build prediction map: one entry per player_id, prefer team-scoped
  //    precomputed row over global regular.
  const predMap = new Map<string, any>();
  // Also build a pitcher-specific map for TWPs (pitcher_role != null)
  const pitcherPredMap = new Map<string, any>();

  for (const pred of allPredictions) {
    const key = pred.player_id;
    const isTeamPrecomputed = pred.variant === "precomputed" && pred.customer_team_id != null;
    const isGlobalRegular = pred.variant === "regular" && pred.customer_team_id == null;
    const hasPitcherRole = pred.pitcher_role != null;

    if (hasPitcherRole) {
      // TWP pitcher side or pitcher-model row
      const existing = pitcherPredMap.get(key);
      if (!existing || isTeamPrecomputed) {
        pitcherPredMap.set(key, pred);
      } else if (isGlobalRegular && existing.variant !== "precomputed") {
        pitcherPredMap.set(key, pred);
      }
    } else {
      // Hitter side (or non-TWP player)
      const existing = predMap.get(key);
      if (!existing || isTeamPrecomputed) {
        predMap.set(key, pred);
      } else if (isGlobalRegular && existing.variant !== "precomputed") {
        predMap.set(key, pred);
      }
    }
  }

  // 5. Build snapshots and update rows
  let updated = 0;
  let skipped = 0;
  let noData = 0;
  const CHUNK = 50;

  const updates: Array<{ id: string; player_snapshot: any }> = [];

  for (const bp of rowsWithId) {
    const pid = bp.player_id as string;
    const player = playerMap.get(pid);
    const isTwp = player?.is_twp ?? false;
    const playerPos = player?.position ?? null;

    const bpSide = isPitcherPosition(bp.position_slot) ? "P" : "H";

    // Pick the right prediction row for this slot
    let pred: any = null;
    if (bpSide === "P") {
      // Use pitcher-model row first; fall back to general row if none
      pred = pitcherPredMap.get(pid) ?? predMap.get(pid) ?? null;
    } else {
      pred = predMap.get(pid) ?? null;
    }

    if (!pred) {
      noData++;
      continue;
    }

    const isPitcher = bpSide === "P" || isPitcherPosition(playerPos);

    // Build snapshot mirroring the structure create-default-builds uses
    const snapshot: Record<string, any> = {};
    if (!isPitcher || isTwp) {
      snapshot.p_avg = pred.p_avg ?? null;
      snapshot.p_obp = pred.p_obp ?? null;
      snapshot.p_slg = pred.p_slg ?? null;
      snapshot.p_wrc_plus = pred.p_wrc_plus ?? null;
      snapshot.o_war = pred.o_war ?? null;
      snapshot.market_value = isTwp
        ? (pred.twp_hitter_market_value ?? pred.market_value ?? null)
        : (pred.market_value ?? null);
      snapshot.hitter_depth_role = pred.hitter_depth_role ?? null;
    }
    if (isPitcher || isTwp) {
      snapshot.p_era = pred.p_era ?? null;
      snapshot.p_fip = pred.p_fip ?? null;
      snapshot.p_whip = pred.p_whip ?? null;
      snapshot.p_k9 = pred.p_k9 ?? null;
      snapshot.p_bb9 = pred.p_bb9 ?? null;
      snapshot.p_hr9 = pred.p_hr9 ?? null;
      snapshot.p_rv_plus = pred.p_rv_plus ?? null;
      snapshot.p_war = pred.p_war ?? null;
      snapshot.pitcher_depth_role = pred.pitcher_depth_role ?? null;
      snapshot.pitcher_role = pred.pitcher_role ?? null;
    }
    snapshot.class_transition = pred.class_transition ?? null;
    snapshot.dev_aggressiveness = pred.dev_aggressiveness ?? null;

    // Only write if there's at least one meaningful stat
    const hasStats =
      snapshot.p_avg != null ||
      snapshot.p_era != null ||
      snapshot.o_war != null ||
      snapshot.p_war != null;

    if (!hasStats) {
      noData++;
      continue;
    }

    updates.push({ id: bp.id, player_snapshot: snapshot });
  }

  console.log(`  Rows to update: ${updates.length}`);
  console.log(`  Rows skipped (no prediction data): ${noData}`);
  console.log(`  Rows with no player_id: ${buildPlayers.length - rowsWithId.length}\n`);

  if (!apply) {
    console.log(
      `${C.yellow}DRY-RUN — pass --apply to write.${C.reset}\n` +
      `  Would update ${updates.length} rows.\n`
    );
    // Show a sample
    if (updates.length > 0) {
      const sample = updates[0];
      console.log(`  Sample row id: ${sample.id}`);
      console.log(`  Sample snapshot: ${JSON.stringify(sample.player_snapshot, null, 2)}`);
    }
    return;
  }

  // Apply in chunks
  let failedChunk = false;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    for (const row of chunk) {
      const { error } = await sb
        .from("team_build_players")
        .update({ player_snapshot: row.player_snapshot })
        .eq("id", row.id);
      if (error) {
        console.error(`  ${C.red}✗ Update failed for row ${row.id}: ${error.message}${C.reset}`);
        failedChunk = true;
      } else {
        updated++;
      }
    }
    process.stdout.write(`\r  Updated ${updated} / ${updates.length}...`);
  }

  console.log(
    `\n\n${failedChunk ? C.yellow + "⚠" : C.green + "✓"}${C.reset}  Done — ${updated} rows updated, ${noData} skipped (no data).`
  );
}

main().catch((err) => {
  console.error(`\n${C.red}Fatal:${C.reset}`, err);
  process.exit(1);
});
