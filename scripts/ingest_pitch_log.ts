#!/usr/bin/env node
/**
 * Ingest a TruMedia pitch-by-pitch CSV into public.pitch_log.
 *
 * - Position-indexed CSV reading (NOT name-indexed). TruMedia exports
 *   have 4 silently duplicate column NAMES — pitchingTeam (cols 47+66),
 *   pitchingTeamId (48+67), battingTeam (49+63), battingTeamId (50+64).
 *   Per the column audit (docs/PITCH_LOG_BUILD.md §3) we KEEP the second
 *   occurrence. Reading by position is the only safe way.
 *
 * - Empty cells, dashes ('-'), and obvious junk → NULL. Never zero.
 *
 * - Upserts on uniq_pitch_id. Idempotent — re-running the same CSV
 *   produces the same DB state.
 *
 * - Batches 500 rows per upsert. Smaller batches keep memory bounded
 *   and progress visible.
 *
 * - season column derived from the date field (year).
 *
 * Usage:
 *   npm run ingest-pitch-log -- <csv path>                # dry-run, staging
 *   npm run ingest-pitch-log -- <csv path> --apply        # write to staging
 *   npm run ingest-pitch-log:prod -- <csv path> --apply   # write to prod
 *
 * Examples:
 *   npm run ingest-pitch-log -- ~/dev-main/pitch_logs/Feb13.csv
 *   npm run ingest-pitch-log -- ~/dev-main/pitch_logs/Feb13.csv --apply
 *
 * Env file (.env.local for staging, .env.production.local for prod) is
 * loaded by the npm script wrapper via --env-file-if-exists.
 */
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { createClient } from "@supabase/supabase-js";

// ─── 1-indexed → 0-indexed column positions (per docs/PITCH_LOG_BUILD.md §3) ──
// Numbers come from the TruMedia CSV header position (1-indexed). Subtract 1
// when accessing the parsed row array.
const COL = {
  uniqPitchId: 7,
  fullName: 9, // pitcher full name
  x: 11,
  y: 12,
  batterHand: 14,
  pitcherHand: 16,
  batterAbbrevName: 17,
  pitcherAbbrevName: 18,
  date: 19,
  pitchResult: 21,
  inn: 22,
  outs: 23,
  pitchType: 24,
  probSL: 29, // called-strike probability 0..1
  count: 31,
  gameVenueId: 32,
  level: 33,
  home: 38,
  teamId: 43,
  opponentId: 44,
  opponentRuns: 45,
  totalRuns: 41,
  currentRuns: 42,
  opponentCurrentRuns: 46,
  // Pick the SECOND occurrence of duplicated names
  pitchingTeamId: 67,
  battingTeamId: 64,
  batterId: 65,
  pitcherId: 68,
  catchingTeamId: 70,
  catcherId: 71,
  catcherAbbrevName: 72,
  // Pitch metrics block (cols 74–82, 1-indexed)
  vel: 74,
  ivb: 75,
  hb: 76,
  extension: 77,
  spin: 78,
  relHeight: 79,
  relSide: 80,
  exitVel: 81,
  launchAng: 82,
} as const;

// ─── CSV parsing ────────────────────────────────────────────────────────────
function parseCSVRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      // Escaped quote inside quoted field: ""
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// ─── Field normalizers ──────────────────────────────────────────────────────
function cell(row: string[], oneIndexedCol: number): string {
  const v = row[oneIndexedCol - 1];
  return v == null ? "" : v.trim();
}

function textOrNull(s: string): string | null {
  if (!s) return null;
  if (s === "-" || s === "—") return null;
  return s;
}

function numOrNull(s: string): number | null {
  const t = textOrNull(s);
  if (t == null) return null;
  // TruMedia uses '-' for missing; sometimes percentages "100.0%"
  const clean = t.replace(/%$/, "");
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(s: string): number | null {
  const n = numOrNull(s);
  return n == null ? null : Math.trunc(n);
}

function boolOrNull(s: string): boolean | null {
  const t = textOrNull(s);
  if (t == null) return null;
  const lower = t.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return null;
}

function handOrNull(s: string): "L" | "R" | null {
  const t = textOrNull(s);
  if (t == null) return null;
  const upper = t.toUpperCase();
  return upper === "L" || upper === "R" ? upper : null;
}

function parseDateOrNull(s: string): { iso: string; season: number } | null {
  let t = textOrNull(s);
  if (!t) return null;
  // TruMedia appends ' (N)' to the date for doubleheader game numbers
  // (e.g., '2026-02-13 19:00:00 (2)' = second game of the day at 7pm).
  // Strip the suffix before parsing — game number isn't stored here; it
  // already lives in uniqPitchId.
  t = t.replace(/\s*\(\d+\)\s*$/, "");
  // TruMedia format: '2026-02-13 20:40:00' — ISO-ish, parseable
  const d = new Date(t.includes("T") ? t : t.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return null;
  return { iso: d.toISOString(), season: d.getUTCFullYear() };
}

// ─── Row → DB record ────────────────────────────────────────────────────────
interface PitchLogRow {
  uniq_pitch_id: string;
  season: number;
  date: string;
  game_venue_id: string | null;
  level: string | null;
  home: boolean | null;
  inn: string | null;
  outs: number | null;
  pitcher_id: string;
  batter_id: string;
  catcher_id: string | null;
  pitcher_full_name: string | null;
  pitcher_abbrev_name: string | null;
  batter_abbrev_name: string | null;
  catcher_abbrev_name: string | null;
  pitcher_hand: "L" | "R" | null;
  batter_hand: "L" | "R" | null;
  pitching_team_id: string | null;
  batting_team_id: string | null;
  catching_team_id: string | null;
  team_id: string | null;
  opponent_id: string | null;
  pitch_result: string | null;
  count: string | null;
  pitch_type: string | null;
  release_velocity: number | null;
  exit_velocity: number | null;
  launch_angle: number | null;
  cs_prob: number | null;
  ivb: number | null;
  hb: number | null;
  extension: number | null;
  spin: number | null;
  rel_height: number | null;
  rel_side: number | null;
  x_loc: number | null;
  y_loc: number | null;
  total_runs: number | null;
  current_runs: number | null;
  opponent_current_runs: number | null;
  opponent_runs: number | null;
  csv_source: string;
}

function buildRecord(row: string[], csvSource: string): PitchLogRow | { skip: string } {
  const uniqId = textOrNull(cell(row, COL.uniqPitchId));
  if (!uniqId) return { skip: "missing uniq_pitch_id" };

  const dateInfo = parseDateOrNull(cell(row, COL.date));
  if (!dateInfo) return { skip: `bad date: ${cell(row, COL.date)}` };

  const pitcherId = textOrNull(cell(row, COL.pitcherId));
  const batterId = textOrNull(cell(row, COL.batterId));
  if (!pitcherId) return { skip: "missing pitcher_id" };
  if (!batterId) return { skip: "missing batter_id" };

  // pitch_result may be empty for edge cases (Catcher Interference w/ no
  // outcome string, etc.). We keep the row anyway — it still counts toward
  // "pitches seen / thrown" denominators even without an outcome. The DB
  // column is nullable, so just pass through null.
  const pitchResult = textOrNull(cell(row, COL.pitchResult));

  return {
    uniq_pitch_id: uniqId,
    season: dateInfo.season,
    date: dateInfo.iso,
    game_venue_id: textOrNull(cell(row, COL.gameVenueId)),
    level: textOrNull(cell(row, COL.level)),
    home: boolOrNull(cell(row, COL.home)),
    inn: textOrNull(cell(row, COL.inn)),
    outs: intOrNull(cell(row, COL.outs)),
    pitcher_id: pitcherId,
    batter_id: batterId,
    catcher_id: textOrNull(cell(row, COL.catcherId)),
    pitcher_full_name: textOrNull(cell(row, COL.fullName)),
    pitcher_abbrev_name: textOrNull(cell(row, COL.pitcherAbbrevName)),
    batter_abbrev_name: textOrNull(cell(row, COL.batterAbbrevName)),
    catcher_abbrev_name: textOrNull(cell(row, COL.catcherAbbrevName)),
    pitcher_hand: handOrNull(cell(row, COL.pitcherHand)),
    batter_hand: handOrNull(cell(row, COL.batterHand)),
    pitching_team_id: textOrNull(cell(row, COL.pitchingTeamId)),
    batting_team_id: textOrNull(cell(row, COL.battingTeamId)),
    catching_team_id: textOrNull(cell(row, COL.catchingTeamId)),
    team_id: textOrNull(cell(row, COL.teamId)),
    opponent_id: textOrNull(cell(row, COL.opponentId)),
    pitch_result: pitchResult,
    count: textOrNull(cell(row, COL.count)),
    pitch_type: textOrNull(cell(row, COL.pitchType)),
    release_velocity: numOrNull(cell(row, COL.vel)),
    exit_velocity: numOrNull(cell(row, COL.exitVel)),
    launch_angle: numOrNull(cell(row, COL.launchAng)),
    cs_prob: numOrNull(cell(row, COL.probSL)),
    ivb: numOrNull(cell(row, COL.ivb)),
    hb: numOrNull(cell(row, COL.hb)),
    extension: numOrNull(cell(row, COL.extension)),
    spin: numOrNull(cell(row, COL.spin)),
    rel_height: numOrNull(cell(row, COL.relHeight)),
    rel_side: numOrNull(cell(row, COL.relSide)),
    x_loc: numOrNull(cell(row, COL.x)),
    y_loc: numOrNull(cell(row, COL.y)),
    total_runs: intOrNull(cell(row, COL.totalRuns)),
    current_runs: intOrNull(cell(row, COL.currentRuns)),
    opponent_current_runs: intOrNull(cell(row, COL.opponentCurrentRuns)),
    opponent_runs: intOrNull(cell(row, COL.opponentRuns)),
    csv_source: csvSource,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const csvPath = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");
  const env = args.includes("--prod") ? "prod" : "staging";

  if (!csvPath) {
    console.error("Usage: npm run ingest-pitch-log -- <csv path> [--apply]");
    process.exit(1);
  }
  if (!existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  // npm script preloads env file via --env-file-if-exists.
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env. Run via "npm run ingest-pitch-log" (auto-loads .env.local).`);
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ─── Read + parse ────────────────────────────────────────────────────────
  const csvSource = basename(csvPath);
  console.log(`\nIngest: ${csvSource} → ${env}${apply ? "" : " (dry-run)"}`);
  const raw = readFileSync(csvPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  console.log(`Lines: ${lines.length} (incl. header)`);

  const header = parseCSVRow(lines[0]);
  console.log(`Columns: ${header.length}`);
  if (header.length < 80) {
    console.warn(`WARN: header has ${header.length} columns (expected ~84). Continuing anyway.`);
  }

  // ─── Build records ───────────────────────────────────────────────────────
  const records: PitchLogRow[] = [];
  const skips: Record<string, number> = {};
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    const result = buildRecord(row, csvSource);
    if ("skip" in result) {
      skips[result.skip] = (skips[result.skip] ?? 0) + 1;
      continue;
    }
    records.push(result);
  }
  console.log(`Parsed: ${records.length} pitch rows`);
  if (Object.keys(skips).length > 0) {
    console.log("Skipped:");
    for (const [reason, count] of Object.entries(skips)) {
      console.log(`  ${count.toString().padStart(5)} × ${reason}`);
    }
  }

  // ─── Sample log ──────────────────────────────────────────────────────────
  if (records.length > 0) {
    const r = records[0];
    console.log(`\nFirst record sample:`);
    console.log(`  uniq_pitch_id  = ${r.uniq_pitch_id}`);
    console.log(`  date / season  = ${r.date} / ${r.season}`);
    console.log(`  pitcher        = ${r.pitcher_full_name} (${r.pitcher_id}, ${r.pitcher_hand})`);
    console.log(`  batter         = ${r.batter_abbrev_name} (${r.batter_id}, ${r.batter_hand})`);
    console.log(`  pitch          = ${r.pitch_type}, vel=${r.release_velocity}, ivb=${r.ivb}, hb=${r.hb}`);
    console.log(`  result         = ${r.pitch_result}`);
  }

  // ─── Quick presence stats ────────────────────────────────────────────────
  const hasVelo = records.filter((r) => r.release_velocity != null).length;
  const fullyTracked = records.filter(
    (r) => r.release_velocity != null && r.ivb != null && r.hb != null,
  ).length;
  console.log(`\nTracking stats:`);
  console.log(`  Total parsed:           ${records.length}`);
  console.log(`  has_velo (will be TRUE): ${hasVelo} (${((100 * hasVelo) / records.length).toFixed(1)}%)`);
  console.log(`  is_data (will be TRUE):  ${fullyTracked} (${((100 * fullyTracked) / records.length).toFixed(1)}%)`);

  if (!apply) {
    console.log(`\n[dry-run] No writes. Re-run with --apply to upload.`);
    return;
  }

  // ─── Batch upsert ────────────────────────────────────────────────────────
  const BATCH = 500;
  let written = 0;
  let failedBatches = 0;
  console.log(`\nUploading ${records.length} rows in batches of ${BATCH}…`);
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH);
    const { error } = await (supabase as any)
      .from("pitch_log")
      .upsert(chunk, { onConflict: "uniq_pitch_id" });
    if (error) {
      failedBatches++;
      console.error(`  batch ${i}-${i + chunk.length} FAILED: ${error.message}`);
    } else {
      written += chunk.length;
    }
    if (i % 5000 === 0 || i + BATCH >= records.length) {
      console.log(`  ${written}/${records.length} written…`);
    }
  }

  console.log(`\nDone. ${written} rows upserted, ${failedBatches} batches failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
