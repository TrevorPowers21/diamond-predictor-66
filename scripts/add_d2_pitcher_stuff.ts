#!/usr/bin/env node
/**
 * Surgical D2 pitcher Stuff+ ingest — ONE player at a time.
 *
 * Reads per-pitch + scouting CSVs from
 *   ~/RSTR IQ Data/inbox/kansas_d2/<player>/
 * and writes them surgically into:
 *   1. pitcher_stuff_plus_inputs (one row per pitch type — INSERTs only the
 *      pitches the player throws; idempotent skip if rows already exist)
 *   2. "Pitching Master" — UPDATE only this player's row with the 16
 *      scouting columns from the pitching_master CSV
 *   3. "Pitching Master" — NULL out the player's six *_pr_plus columns so
 *      the downstream `recompute-stuff` pipeline recomputes them with the
 *      real Stuff+ values instead of leaving 100 placeholders in place.
 *
 * Safety constraints by design (mirror scripts/add_d2_player.ts):
 *   - Single-player scope (--player <slug>), no bulk anything
 *   - Dry-run by default; --apply required to write
 *   - --env staging|prod required; asserts SUPABASE_URL matches
 *   - Module-scope guard prevents accidental auto-run on import
 *   - source_player_id resolved from the same hash function as add_d2_player
 *
 * Usage:
 *   npm run add-d2-pitcher-stuff -- --player logan_harrell --env staging
 *   npm run add-d2-pitcher-stuff -- --player logan_harrell --env staging --apply
 *
 * Run order on staging:
 *   1. npm run add-d2-pitcher-stuff -- --player logan_harrell --env staging --apply
 *   2. npm run recompute-stuff               # full 5-stage pipeline; UPSERT-safe
 *   3. npm run precompute-players -- --players logan_harrell --env staging --apply
 *   4. SQL verify
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const INBOX_ROOT = join(homedir(), "RSTR IQ Data", "inbox", "kansas_d2");

const SEASON = 2026;
const STAGING_URL_FRAG = "slrxowawbijbjrkozqlj";
const PROD_URL_FRAG = "trbvxuoliwrfowibatkm";

// Mirror PLAYER_BASELINES from add_d2_player.ts — only the fields we need
// for resolving source_player_id and pitcher hand.
type PitcherBaseline = {
  full_name: string;
  from_team: string;
  hand: string; // "R" | "L"
};

const PITCHER_BASELINES: Record<string, PitcherBaseline> = {
  logan_harrell: {
    full_name: "Logan Harrell",
    from_team: "Trevecca Nazarene University",
    hand: "R",
  },
};

// Filename-slug -> canonical pitch_type. Must match what the reclassifier +
// Stuff+ engine recognize. Mirrors the list in
// scripts/add_d2_player.ts / src/savant/lib/stuffPlusEngine.ts.
const FILENAME_SLUG_TO_PITCH_TYPE: Record<string, string> = {
  "4sfb":       "4S FB",
  "sinker":     "Sinker",
  "cutter":     "Cutter",
  "slider":     "Slider",
  "sweeper":    "Sweeper",
  "curveball":  "Curveball",
  "gyroslider": "Gyro Slider",
  "change":     "Change-up",
  "changeup":   "Change-up",
  "splitter":   "Splitter",
};

const COLOR = {
  reset: "\x1b[0m", bold: "\x1b[1m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
const ok = (s: string) => console.log(`  ${COLOR.green}✓${COLOR.reset} ${s}`);
const warn = (s: string) => console.log(`  ${COLOR.yellow}!${COLOR.reset} ${s}`);
const err = (s: string) => console.log(`  ${COLOR.red}✗${COLOR.reset} ${s}`);
const info = (s: string) => console.log(`  ${COLOR.cyan}·${COLOR.reset} ${s}`);
const step = (s: string) => console.log(`\n${COLOR.bold}→${COLOR.reset} ${s}`);

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string): string | null => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? (args[i + 1] || null) : null;
  };
  return {
    player: get("player"),
    env: get("env"),
    apply: args.includes("--apply"),
  };
}

function syntheticSourceId(name: string, team: string): string {
  const hash = createHash("sha1").update(`d2:${name.trim()}:${team.trim()}`).digest("hex").slice(0, 16);
  return `d2-${hash}`;
}

// "16.4%" -> 16.4 (percentage value, NOT decimal). "85.2" -> 85.2.
// Existing D1 pipeline stores percent columns as the percentage value
// (e.g. miss_pct mean ≈ 23.4, not 0.234). Confirmed in the
// computeAndStorePitchingScores baselines output.
// Per the zero-is-missing feedback rule, treat exactly 0 as null.
function parseValue(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const stripped = trimmed.endsWith("%") ? trimmed.slice(0, -1) : trimmed;
  const n = Number(stripped);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return null;
  return n;
}

function parseCsvSingleRow(path: string): Record<string, string> | null {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf-8").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const headers = lines[0].split(",").map((h) => h.trim());
  const values = lines[1].split(",").map((v) => v.trim());
  const out: Record<string, string> = {};
  headers.forEach((h, i) => { out[h] = values[i] ?? ""; });
  return out;
}

// "Logan_harrel_4sFB_stuff_plus.csv" -> "4sfb"
// "Logan_Harrel_pitching_master.csv" -> "pitching_master"
function extractFileType(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".csv")) return null;
  if (lower.endsWith("_pitching_master.csv")) return "pitching_master";
  const m = lower.match(/_([^_]+)_stuff_plus\.csv$/);
  return m ? m[1] : null;
}

async function main() {
  const { player, env, apply } = parseArgs();

  if (!player) { err("--player <slug> required (e.g. logan_harrell)"); process.exit(1); }
  if (!env || (env !== "staging" && env !== "prod")) {
    err("--env required: 'staging' or 'prod'");
    process.exit(1);
  }
  const baseline = PITCHER_BASELINES[player];
  if (!baseline) {
    err(`Unknown player slug: '${player}'. Known: ${Object.keys(PITCHER_BASELINES).join(", ")}`);
    err("Add a baseline to PITCHER_BASELINES in scripts/add_d2_pitcher_stuff.ts before re-running.");
    process.exit(1);
  }

  const inboxDir = join(INBOX_ROOT, player);
  if (!existsSync(inboxDir)) { err(`Inbox folder not found: ${inboxDir}`); process.exit(1); }

  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    err("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env");
    process.exit(1);
  }
  const isStaging = url.includes(STAGING_URL_FRAG);
  const isProd = url.includes(PROD_URL_FRAG);
  if (env === "staging" && !isStaging) { err(`--env staging requested but URL points elsewhere:\n   ${url}`); process.exit(1); }
  if (env === "prod" && !isProd)       { err(`--env prod requested but URL points elsewhere:\n   ${url}`); process.exit(1); }

  console.log(`${COLOR.bold}\n══ Ingest D2 Pitcher Stuff+: ${player} ══${COLOR.reset}`);
  console.log(`Target DB:   ${isProd ? `${COLOR.red}PROD${COLOR.reset}` : "staging"} (${url})`);
  console.log(`Inbox:       ${inboxDir}`);
  console.log(`Mode:        ${apply ? `${COLOR.red}APPLY (will write)${COLOR.reset}` : "dry-run (no writes)"}`);

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const sourcePlayerId = syntheticSourceId(baseline.full_name, baseline.from_team);
  info(`source_player_id: ${sourcePlayerId}`);

  // ── Inventory the inbox files we recognize ──────────────────────────
  step("Step 0: scanning inbox");
  const files = readdirSync(inboxDir);
  type FileEntry = { filename: string; fullPath: string; type: string; pitchType?: string };
  const recognized: FileEntry[] = [];
  for (const filename of files) {
    if (filename.endsWith(".md")) continue;
    const type = extractFileType(filename);
    if (!type) {
      warn(`Unrecognized filename pattern, skipping: ${filename}`);
      continue;
    }
    if (type === "pitching_master") {
      recognized.push({ filename, fullPath: join(inboxDir, filename), type });
      info(`pitching_master  ← ${filename}`);
    } else {
      const pitchType = FILENAME_SLUG_TO_PITCH_TYPE[type];
      if (!pitchType) {
        warn(`Unknown pitch-type slug '${type}', skipping: ${filename}`);
        continue;
      }
      recognized.push({ filename, fullPath: join(inboxDir, filename), type, pitchType });
      info(`per-pitch (${pitchType.padEnd(12)}) ← ${filename}`);
    }
  }
  if (recognized.length === 0) { err("No usable CSVs found in inbox."); process.exit(1); }

  // ── 1. pitcher_stuff_plus_inputs (one row per pitch type) ───────────
  step("Step 1: pitcher_stuff_plus_inputs (per-pitch INSERTs)");
  const perPitch = recognized.filter((r) => r.type !== "pitching_master");
  for (const f of perPitch) {
    const csv = parseCsvSingleRow(f.fullPath);
    if (!csv) { warn(`Empty or unparsable CSV: ${f.filename}`); continue; }

    // Idempotent: skip if a row for this (player, pitch_type, season, hand) already exists
    const { data: existing, error: selErr } = await sb.from("pitcher_stuff_plus_inputs")
      .select("id")
      .eq("source_player_id", sourcePlayerId)
      .eq("season", SEASON)
      .eq("pitch_type", f.pitchType!)
      .eq("hand", baseline.hand)
      .maybeSingle();
    if (selErr) { err(`stuff_plus_inputs lookup (${f.pitchType}): ${selErr.message}`); process.exit(1); }
    if (existing) { warn(`${f.pitchType} row already exists (id=${existing.id}) — skipping insert`); continue; }

    const row = {
      id: randomUUID(),
      source_player_id: sourcePlayerId,
      season: SEASON,
      division: "D2",
      hand: baseline.hand,
      pitch_type: f.pitchType!,
      velocity:   parseValue(csv["Vel"]),
      ivb:        parseValue(csv["IndVertBrk"]),
      hb:         parseValue(csv["HorzBrk"]),
      spin:       parseValue(csv["Spin"]),
      extension:  parseValue(csv["Extension"]),
      rel_height: parseValue(csv["RelHeight"]),
      rel_side:   parseValue(csv["RelSide"]),
      vaa:        parseValue(csv["VertApprAngle"]),
      pitches:    parseValue(csv["P"]),
      whiff_pct:  parseValue(csv["Miss%"]),
    };

    if (apply) {
      const { error } = await sb.from("pitcher_stuff_plus_inputs").insert(row);
      if (error) { err(`stuff_plus_inputs insert (${f.pitchType}): ${error.message}`); process.exit(1); }
      ok(`${f.pitchType.padEnd(12)} → velocity=${row.velocity} ivb=${row.ivb} hb=${row.hb} pitches=${row.pitches}`);
    } else {
      info(`[dry-run] Would INSERT ${f.pitchType.padEnd(12)} ${JSON.stringify({ velocity: row.velocity, ivb: row.ivb, hb: row.hb, spin: row.spin, pitches: row.pitches, whiff_pct: row.whiff_pct })}`);
    }
  }

  // ── 2. Pitching Master scouting UPDATE + 3. pr_plus null-out ────────
  const pmFile = recognized.find((r) => r.type === "pitching_master");
  if (!pmFile) {
    step("Step 2/3: pitching_master.csv missing — SKIPPED");
    warn("No <player>_pitching_master.csv file. Skipping PM scouting update + pr_plus nullification.");
  } else {
    step("Step 2: Pitching Master scouting UPDATE");
    const csv = parseCsvSingleRow(pmFile.fullPath);
    if (!csv) { err(`pitching_master CSV is empty: ${pmFile.filename}`); process.exit(1); }

    // Verify the row exists before we touch it
    const { data: pmExisting, error: pmErr } = await sb.from("Pitching Master")
      .select("id")
      .eq("source_player_id", sourcePlayerId)
      .eq("Season", SEASON)
      .maybeSingle();
    if (pmErr) { err(`Pitching Master lookup: ${pmErr.message}`); process.exit(1); }
    if (!pmExisting) {
      err(`No Pitching Master row found for ${sourcePlayerId} season ${SEASON}.`);
      err(`Run scripts/add_d2_player.ts first to land the base row.`);
      process.exit(1);
    }

    const update: Record<string, number | null> = {
      G:                  parseValue(csv["G"]),
      GS:                 parseValue(csv["GS"]),
      bf:                 parseValue(csv["BF"]),
      k_pct:              parseValue(csv["K%"]),
      bb_pct:             parseValue(csv["BB%"]),
      miss_pct:           parseValue(csv["Miss%"]),
      chase_pct:          parseValue(csv["Chase%"]),
      in_zone_whiff_pct:  parseValue(csv["InZoneWhiff%"]),
      in_zone_pct:        parseValue(csv["InZoneMdl%"]),
      barrel_pct:         parseValue(csv["Barrel%"]),
      hard_hit_pct:       parseValue(csv["HardHit%"]),
      exit_vel:           parseValue(csv["ExitVel"]),
      "90th_vel":         parseValue(csv["90thExitVel"]),
      ground_pct:         parseValue(csv["Ground%"]),
      line_pct:           parseValue(csv["Line%"]),
      la_10_30_pct:       parseValue(csv["LA10-30%"]),
      h_pull_pct:         parseValue(csv["HPull%"]),
    };

    if (apply) {
      const { error } = await sb.from("Pitching Master").update(update).eq("id", pmExisting.id);
      if (error) { err(`Pitching Master scouting UPDATE: ${error.message}`); process.exit(1); }
      ok(`Updated Pitching Master scouting columns (row ${pmExisting.id})`);
    } else {
      info(`[dry-run] Would UPDATE Pitching Master scouting:`);
      info(`           ${JSON.stringify(update)}`);
    }

    step("Step 3: NULL pr_plus columns (so recompute-stuff fills with real values)");
    const nullify = {
      era_pr_plus:  null,
      fip_pr_plus:  null,
      whip_pr_plus: null,
      k9_pr_plus:   null,
      bb9_pr_plus:  null,
      hr9_pr_plus:  null,
    };
    if (apply) {
      const { error } = await sb.from("Pitching Master").update(nullify).eq("id", pmExisting.id);
      if (error) { err(`Pitching Master pr_plus null UPDATE: ${error.message}`); process.exit(1); }
      ok(`Nulled 6 pr_plus columns (row ${pmExisting.id})`);
    } else {
      info(`[dry-run] Would NULL the 6 pr_plus columns on this row.`);
    }
  }

  console.log(`${COLOR.bold}${COLOR.green}\n══ DONE ══${COLOR.reset}`);
  console.log(`Mode:    ${apply ? "APPLIED" : "dry-run"}`);
  console.log(`\nNext steps (on staging):`);
  console.log(`  1. npm run recompute-stuff                                      # full Stuff+ pipeline`);
  console.log(`  2. npm run precompute-players -- --players ${player} --env staging --apply`);
  console.log(`  3. SQL verify Logan's stuff_plus + pr_plus + projection\n`);
}

// Module-scope guard — only run as CLI, never on import (ABS-style auto-run gotcha).
const isMainEntry = (() => {
  try {
    const argv1 = process.argv[1] || "";
    return argv1.endsWith("add_d2_pitcher_stuff.ts") || argv1.endsWith("add_d2_pitcher_stuff.js");
  } catch { return false; }
})();

if (isMainEntry) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
