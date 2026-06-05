/**
 * ABS (Automated Ball-Strike) stats importer.
 *
 * Two CSVs from TruMedia, one each for hitters + pitchers, each ~10K rows.
 * Each row carries the player's plate-discipline + contact metrics under
 * BOTH the current NCAA strike zone and the new SEC ABS zone.
 *
 * Writes to standalone tables `abs_hitter_stats` / `abs_pitcher_stats`
 * (one row per (source_player_id, season), UPSERTed on conflict).
 *
 * D1 ONLY. The `newestTeamLevel` column distinguishes D1 from JUCO; JUCO
 * rows are dropped at import time and never make it into the tables.
 *
 * No other tables are touched, no downstream cascade is triggered. Pure
 * isolated data load.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseHeader } from "../../scripts/import-csvs/csv";

export interface AbsImportResult {
  totalRows: number;
  d1Rows: number;
  jucoSkipped: number;
  missingSourceId: number;
  upserted: number;
  errors: string[];
}

/**
 * Parses a TruMedia percentage / numeric cell. Returns null for empty,
 * "-", or unparseable values. Strips trailing % and any whitespace.
 */
function parseStat(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "-" || s === "--") return null;
  const cleaned = s.replace(/%/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns true if the team-level value corresponds to D1.
 * TruMedia uses "BBC" (Baseball — Division I) for D1; JUCO is "NJCAA D1"
 * or similar. Treat anything that isn't unambiguously D1 as non-D1 to
 * keep JUCO out of the ABS tables.
 */
function isD1(teamLevel: string | undefined | null): boolean {
  if (!teamLevel) return false;
  const s = String(teamLevel).trim().toUpperCase();
  // BBC = TruMedia's D1 code. Other observed codes: NJCAA, NAIA, D2, D3.
  return s === "BBC";
}

/**
 * Splits a CSV body line, respecting quoted fields. Mirrors parseHeader's
 * quoting rules so a comma inside a quoted name doesn't break the row.
 */
function parseLine(line: string): string[] {
  return parseHeader(line);
}

function rowsFromCsv(csvText: string): { header: string[]; rows: string[][] } {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = parseHeader(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { header, rows };
}

/**
 * Looks up a column index by name, case-insensitive. Returns -1 if not
 * found so callers can decide whether the column is required.
 */
function indexOf(header: string[], name: string): number {
  const target = name.toLowerCase();
  return header.findIndex((h) => h.toLowerCase() === target);
}

/* ─── HITTER ───────────────────────────────────────────────────────────── */

const HITTER_COLUMN_MAP = {
  source_player_id: "playerId",
  team_level: "newestTeamLevel",
  iz_barrel_pct: "IzBarrel%",
  abs_iz_barrel_pct: "HABSizBarrel%",
  iz_swing_pct: "InZoneSwing%",
  abs_iz_swing_pct: "HABS InZoneSwing%",
  iz_exit_velo: "IzExitVel",
  abs_iz_exit_velo: "HABSizEV",
  iz_whiff_pct: "InZoneWhiff%",
  abs_iz_whiff_pct: "HABSInZoneWhiff%",
  chase_pct: "Chase%",
  abs_chase_pct: "HABSChase%",
} as const;

export async function importAbsHitterStatsCsv(
  csvText: string,
  season: number,
): Promise<AbsImportResult> {
  const result: AbsImportResult = {
    totalRows: 0,
    d1Rows: 0,
    jucoSkipped: 0,
    missingSourceId: 0,
    upserted: 0,
    errors: [],
  };

  const { header, rows } = rowsFromCsv(csvText);
  if (rows.length === 0) {
    result.errors.push("CSV had no body rows.");
    return result;
  }

  // Resolve column indices once per import.
  const idx = Object.fromEntries(
    Object.entries(HITTER_COLUMN_MAP).map(([db, csv]) => [db, indexOf(header, csv)]),
  ) as Record<keyof typeof HITTER_COLUMN_MAP, number>;

  for (const required of ["source_player_id", "team_level"] as const) {
    if (idx[required] < 0) {
      result.errors.push(`Missing required CSV column: ${HITTER_COLUMN_MAP[required]}`);
      return result;
    }
  }

  const batch: any[] = [];
  for (const row of rows) {
    result.totalRows++;

    const teamLevel = row[idx.team_level];
    if (!isD1(teamLevel)) {
      result.jucoSkipped++;
      continue;
    }
    result.d1Rows++;

    const sourcePlayerId = row[idx.source_player_id]?.trim();
    if (!sourcePlayerId) {
      result.missingSourceId++;
      continue;
    }

    // Column-aware payload — only include fields whose CSV column was
    // found. Supabase upsert does ON CONFLICT DO UPDATE SET col=excluded.col
    // for each column in the payload, so omitted columns are preserved on
    // existing rows. This lets a partial-column export (e.g., TruMedia
    // sending only HABSChase% in a follow-up) update just that column
    // without nulling out the rest of an existing row.
    const payload: any = {
      source_player_id: sourcePlayerId,
      season,
      updated_at: new Date().toISOString(),
    };
    if (idx.iz_barrel_pct      >= 0) payload.iz_barrel_pct      = parseStat(row[idx.iz_barrel_pct]);
    if (idx.abs_iz_barrel_pct  >= 0) payload.abs_iz_barrel_pct  = parseStat(row[idx.abs_iz_barrel_pct]);
    if (idx.iz_swing_pct       >= 0) payload.iz_swing_pct       = parseStat(row[idx.iz_swing_pct]);
    if (idx.abs_iz_swing_pct   >= 0) payload.abs_iz_swing_pct   = parseStat(row[idx.abs_iz_swing_pct]);
    if (idx.iz_exit_velo       >= 0) payload.iz_exit_velo       = parseStat(row[idx.iz_exit_velo]);
    if (idx.abs_iz_exit_velo   >= 0) payload.abs_iz_exit_velo   = parseStat(row[idx.abs_iz_exit_velo]);
    if (idx.iz_whiff_pct       >= 0) payload.iz_whiff_pct       = parseStat(row[idx.iz_whiff_pct]);
    if (idx.abs_iz_whiff_pct   >= 0) payload.abs_iz_whiff_pct   = parseStat(row[idx.abs_iz_whiff_pct]);
    if (idx.chase_pct          >= 0) payload.chase_pct          = parseStat(row[idx.chase_pct]);
    if (idx.abs_chase_pct      >= 0) payload.abs_chase_pct      = parseStat(row[idx.abs_chase_pct]);
    batch.push(payload);
  }

  // Upsert in chunks of 500 — Supabase has a row-count cap on a single
  // request, and chunking keeps individual failures from sinking the
  // whole import.
  const CHUNK = 500;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    const { error } = await (supabase as any)
      .from("abs_hitter_stats")
      .upsert(slice, { onConflict: "source_player_id,season" });
    if (error) {
      result.errors.push(`Chunk ${i}-${i + slice.length}: ${error.message}`);
      continue;
    }
    result.upserted += slice.length;
  }

  return result;
}

/* ─── PITCHER ──────────────────────────────────────────────────────────── */

const PITCHER_COLUMN_MAP = {
  source_player_id: "playerId",
  team_level: "newestTeamLevel",
  chase_pct: "Chase%",
  // The ABSChase column (no %) carries the ABS chase rate. The separate
  // ABSChase% column is empty in the TruMedia export and is intentionally
  // skipped — see also the schema comment in 20260605120000_abs_stats_v2.sql.
  abs_chase_pct: "ABSChase",
  iz_whiff_pct: "InZoneWhiff%",
  abs_iz_whiff_pct: "ABSInZoneWhiff%",
  csw_pct: "CSW%",
  abs_csw_pct: "ABSCSW%",
  strike_pct: "Strike%",
  abs_strike_pct: "ABSStrike%",
  iz_pct: "InZoneMdl%",
  abs_iz_pct: "ABSInZone%",
} as const;

export async function importAbsPitcherStatsCsv(
  csvText: string,
  season: number,
): Promise<AbsImportResult> {
  const result: AbsImportResult = {
    totalRows: 0,
    d1Rows: 0,
    jucoSkipped: 0,
    missingSourceId: 0,
    upserted: 0,
    errors: [],
  };

  const { header, rows } = rowsFromCsv(csvText);
  if (rows.length === 0) {
    result.errors.push("CSV had no body rows.");
    return result;
  }

  const idx = Object.fromEntries(
    Object.entries(PITCHER_COLUMN_MAP).map(([db, csv]) => [db, indexOf(header, csv)]),
  ) as Record<keyof typeof PITCHER_COLUMN_MAP, number>;

  for (const required of ["source_player_id", "team_level"] as const) {
    if (idx[required] < 0) {
      result.errors.push(`Missing required CSV column: ${PITCHER_COLUMN_MAP[required]}`);
      return result;
    }
  }

  const batch: any[] = [];
  for (const row of rows) {
    result.totalRows++;

    const teamLevel = row[idx.team_level];
    if (!isD1(teamLevel)) {
      result.jucoSkipped++;
      continue;
    }
    result.d1Rows++;

    const sourcePlayerId = row[idx.source_player_id]?.trim();
    if (!sourcePlayerId) {
      result.missingSourceId++;
      continue;
    }

    batch.push({
      source_player_id: sourcePlayerId,
      season,
      chase_pct: parseStat(row[idx.chase_pct]),
      abs_chase_pct: parseStat(row[idx.abs_chase_pct]),
      iz_whiff_pct: parseStat(row[idx.iz_whiff_pct]),
      abs_iz_whiff_pct: parseStat(row[idx.abs_iz_whiff_pct]),
      csw_pct: parseStat(row[idx.csw_pct]),
      abs_csw_pct: parseStat(row[idx.abs_csw_pct]),
      strike_pct: parseStat(row[idx.strike_pct]),
      abs_strike_pct: parseStat(row[idx.abs_strike_pct]),
      iz_pct: parseStat(row[idx.iz_pct]),
      abs_iz_pct: parseStat(row[idx.abs_iz_pct]),
      updated_at: new Date().toISOString(),
    });
  }

  const CHUNK = 500;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    const { error } = await (supabase as any)
      .from("abs_pitcher_stats")
      .upsert(slice, { onConflict: "source_player_id,season" });
    if (error) {
      result.errors.push(`Chunk ${i}-${i + slice.length}: ${error.message}`);
      continue;
    }
    result.upserted += slice.length;
  }

  return result;
}
