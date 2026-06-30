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
//
// Header-name lookup (2026-06-24): TruMedia shifted the CSV layout in the
// SprayAng + Distance + Pitch Location re-export — Extension/Spin swapped
// positions, ExitVel/LaunchAng shifted from 81/82 to 85/86, and 7 new
// fields appended. Hard-coded positions silently corrupt when columns
// move, so we now resolve each field's position from the header row of
// each file. Robust to future layout shifts too.
//
// FIELD_TO_HEADER maps our internal field name → exact TruMedia header
// string. resolveColPositions() walks the parsed header row and returns
// a {field → 1-indexed col position} map for that file. Duplicated names
// (battingTeamId, pitchingTeamId, etc.) resolve to the LAST occurrence,
// which matches the existing rule from the column audit.
const FIELD_TO_HEADER = {
  uniqPitchId: "uniqPitchId",
  fullName: "fullName",
  x: "x",
  y: "y",
  batterHand: "batterHand",
  pitcherHand: "pitcherHand",
  batterAbbrevName: "batterAbbrevName",
  pitcherAbbrevName: "pitcherAbbrevName",
  date: "date",
  pitchResult: "pitchResult",
  inn: "inn",
  outs: "outs",
  pitchType: "pitchType",
  probSL: "probSL",
  count: "count",
  gameVenueId: "gameVenueId",
  level: "level",
  home: "home",
  teamId: "teamId",
  opponentId: "opponentId",
  opponentRuns: "opponentRuns",
  totalRuns: "totalRuns",
  currentRuns: "currentRuns",
  opponentCurrentRuns: "opponentCurrentRuns",
  // Duplicate names — last-occurrence wins (pitchingTeamId at col 67, etc.)
  pitchingTeamId: "pitchingTeamId",
  battingTeamId: "battingTeamId",
  batterId: "batterId",
  pitcherId: "pitcherId",
  catchingTeamId: "catchingTeamId",
  catcherId: "catcherId",
  catcherAbbrevName: "catcherAbbrevName",
  // Pitch metrics
  vel: "Vel",
  ivb: "IVB",
  hb: "HB",
  extension: "Extension",
  spin: "Spin",
  relHeight: "RelHeight",
  relSide: "RelSide",
  exitVel: "ExitVel",
  launchAng: "LaunchAng",
  // NEW 2026-06-24 fields (only present in re-exported CSVs)
  pzNorm: "PZNorm",
  pxNorm: "PXNorm",
  sprayAng: "SprayAng",
  distance: "FBDst",
  xAvg: "xAVG",
  xSlg: "xSLG",
  xWoba: "xWOBA",
} as const;

type FieldName = keyof typeof FIELD_TO_HEADER;
type ColPositions = Partial<Record<FieldName, number>>;

/**
 * Walk the parsed header row and return a {field → 1-indexed position}
 * map. For columns with duplicate header names, last occurrence wins
 * (matches the rule from docs/PITCH_LOG_BUILD.md §3 for battingTeamId /
 * pitchingTeamId / etc.). Fields not present in the header are absent
 * from the result; cell() returns null for those, so old-format CSVs
 * without the 2026-06-24 fields ingest cleanly with new-field = null.
 */
function resolveColPositions(header: string[]): ColPositions {
  const positions: ColPositions = {};
  for (let i = 0; i < header.length; i++) {
    const headerName = header[i].trim();
    for (const [field, expected] of Object.entries(FIELD_TO_HEADER) as Array<[FieldName, string]>) {
      if (headerName === expected) {
        // 1-indexed position (cell() expects 1-indexed)
        positions[field] = i + 1;
      }
    }
  }
  return positions;
}

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
  // NEW 2026-06-24 fields (null when ingesting an old-format CSV)
  pz_norm: number | null;
  px_norm: number | null;
  spray_ang: number | null;
  distance: number | null;
  x_avg: number | null;
  x_slg: number | null;
  x_woba: number | null;
  csv_source: string;
}

/**
 * Read a field's value from the row using the resolved column positions.
 * Returns "" (which downstream normalizers treat as null) when the field
 * isn't in this file's header — so old-format CSVs without the 2026-06-24
 * fields ingest cleanly with new-field = null.
 */
function get(row: string[], cols: ColPositions, field: FieldName): string {
  const pos = cols[field];
  return pos == null ? "" : cell(row, pos);
}

function buildRecord(row: string[], cols: ColPositions, csvSource: string): PitchLogRow | { skip: string } {
  const uniqId = textOrNull(get(row, cols, "uniqPitchId"));
  if (!uniqId) return { skip: "missing uniq_pitch_id" };

  const dateInfo = parseDateOrNull(get(row, cols, "date"));
  if (!dateInfo) return { skip: `bad date: ${get(row, cols, "date")}` };

  const pitcherId = textOrNull(get(row, cols, "pitcherId"));
  const batterId = textOrNull(get(row, cols, "batterId"));
  if (!pitcherId) return { skip: "missing pitcher_id" };
  if (!batterId) return { skip: "missing batter_id" };

  // pitch_result may be empty for edge cases (Catcher Interference w/ no
  // outcome string, etc.). We keep the row anyway — it still counts toward
  // "pitches seen / thrown" denominators even without an outcome. The DB
  // column is nullable, so just pass through null.
  const pitchResult = textOrNull(get(row, cols, "pitchResult"));

  return {
    uniq_pitch_id: uniqId,
    season: dateInfo.season,
    date: dateInfo.iso,
    game_venue_id: textOrNull(get(row, cols, "gameVenueId")),
    level: textOrNull(get(row, cols, "level")),
    home: boolOrNull(get(row, cols, "home")),
    inn: textOrNull(get(row, cols, "inn")),
    outs: intOrNull(get(row, cols, "outs")),
    pitcher_id: pitcherId,
    batter_id: batterId,
    catcher_id: textOrNull(get(row, cols, "catcherId")),
    pitcher_full_name: textOrNull(get(row, cols, "fullName")),
    pitcher_abbrev_name: textOrNull(get(row, cols, "pitcherAbbrevName")),
    batter_abbrev_name: textOrNull(get(row, cols, "batterAbbrevName")),
    catcher_abbrev_name: textOrNull(get(row, cols, "catcherAbbrevName")),
    pitcher_hand: handOrNull(get(row, cols, "pitcherHand")),
    batter_hand: handOrNull(get(row, cols, "batterHand")),
    pitching_team_id: textOrNull(get(row, cols, "pitchingTeamId")),
    batting_team_id: textOrNull(get(row, cols, "battingTeamId")),
    catching_team_id: textOrNull(get(row, cols, "catchingTeamId")),
    team_id: textOrNull(get(row, cols, "teamId")),
    opponent_id: textOrNull(get(row, cols, "opponentId")),
    pitch_result: pitchResult,
    count: textOrNull(get(row, cols, "count")),
    pitch_type: textOrNull(get(row, cols, "pitchType")),
    release_velocity: numOrNull(get(row, cols, "vel")),
    exit_velocity: numOrNull(get(row, cols, "exitVel")),
    launch_angle: numOrNull(get(row, cols, "launchAng")),
    cs_prob: numOrNull(get(row, cols, "probSL")),
    ivb: numOrNull(get(row, cols, "ivb")),
    hb: numOrNull(get(row, cols, "hb")),
    extension: numOrNull(get(row, cols, "extension")),
    spin: numOrNull(get(row, cols, "spin")),
    rel_height: numOrNull(get(row, cols, "relHeight")),
    rel_side: numOrNull(get(row, cols, "relSide")),
    x_loc: numOrNull(get(row, cols, "x")),
    y_loc: numOrNull(get(row, cols, "y")),
    total_runs: intOrNull(get(row, cols, "totalRuns")),
    current_runs: intOrNull(get(row, cols, "currentRuns")),
    opponent_current_runs: intOrNull(get(row, cols, "opponentCurrentRuns")),
    opponent_runs: intOrNull(get(row, cols, "opponentRuns")),
    // NEW 2026-06-24 fields (null when ingesting an old-format CSV)
    pz_norm: numOrNull(get(row, cols, "pzNorm")),
    px_norm: numOrNull(get(row, cols, "pxNorm")),
    spray_ang: numOrNull(get(row, cols, "sprayAng")),
    distance: numOrNull(get(row, cols, "distance")),
    x_avg: numOrNull(get(row, cols, "xAvg")),
    x_slg: numOrNull(get(row, cols, "xSlg")),
    x_woba: numOrNull(get(row, cols, "xWoba")),
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
    console.warn(`WARN: header has ${header.length} columns (expected ~84+). Continuing anyway.`);
  }

  // ─── Resolve column positions from header (handles layout changes) ───────
  const cols = resolveColPositions(header);
  // Spot-check that critical fields were found. Soft warning for new fields
  // (only present in 2026-06-24+ exports).
  const critical: FieldName[] = ["uniqPitchId", "date", "pitcherId", "batterId", "pitchType", "vel"];
  const missingCritical = critical.filter((f) => cols[f] == null);
  if (missingCritical.length > 0) {
    console.error(`FATAL: critical headers missing: ${missingCritical.join(", ")}`);
    process.exit(1);
  }
  const newFields: FieldName[] = ["pzNorm", "pxNorm", "sprayAng", "distance", "xAvg", "xSlg", "xWoba"];
  const presentNew = newFields.filter((f) => cols[f] != null);
  if (presentNew.length === 0) {
    console.log(`No new 2026-06-24 fields in header — looks like a pre-re-export file. New columns will be null.`);
  } else if (presentNew.length < newFields.length) {
    console.warn(`WARN: partial new-field coverage (${presentNew.length}/${newFields.length}). Missing: ${newFields.filter((f) => cols[f] == null).join(", ")}`);
  } else {
    console.log(`✓ All 7 new 2026-06-24 fields found in header (PZNorm/PXNorm/SprayAng/FBDst/xAVG/xSLG/xWOBA).`);
  }

  // ─── Build records ───────────────────────────────────────────────────────
  const records: PitchLogRow[] = [];
  const skips: Record<string, number> = {};
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    const result = buildRecord(row, cols, csvSource);
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
    console.log(`  pitch          = ${r.pitch_type}, vel=${r.release_velocity}, ivb=${r.ivb}, hb=${r.hb}, spin=${r.spin}, ext=${r.extension}`);
    console.log(`  location       = pzNorm=${r.pz_norm}, pxNorm=${r.px_norm}`);
    console.log(`  batted         = ev=${r.exit_velocity}, la=${r.launch_angle}, sprayAng=${r.spray_ang}, dist=${r.distance}`);
    console.log(`  TM xStats      = xAvg=${r.x_avg}, xSlg=${r.x_slg}, xWoba=${r.x_woba}`);
    console.log(`  result         = ${r.pitch_result}`);
  }

  // Show a batted-ball sample too (the new fields really matter on batted balls)
  const bbSample = records.find((r) => r.exit_velocity != null && r.spray_ang != null);
  if (bbSample) {
    console.log(`\nBatted-ball sample (for spray/xStats check):`);
    console.log(`  uniq_pitch_id  = ${bbSample.uniq_pitch_id}`);
    console.log(`  batter         = ${bbSample.batter_abbrev_name}`);
    console.log(`  pitch          = ${bbSample.pitch_type}, vel=${bbSample.release_velocity}`);
    console.log(`  contact        = ev=${bbSample.exit_velocity}, la=${bbSample.launch_angle}`);
    console.log(`  spray          = sprayAng=${bbSample.spray_ang}°, dist=${bbSample.distance}ft`);
    console.log(`  TM xStats      = xAvg=${bbSample.x_avg}, xSlg=${bbSample.x_slg}, xWoba=${bbSample.x_woba}`);
    console.log(`  result         = ${bbSample.pitch_result}`);
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
