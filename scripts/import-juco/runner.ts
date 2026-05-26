import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { supabase } from "@/integrations/supabase/client";
import { parseHeader } from "../import-csvs/csv.ts";
import {
  classifyJucoFile,
  type JucoFileKind,
} from "./filenameParser.ts";
import {
  conferenceLabelForRegion,
  districtForRegion,
  districtUuidForRegion,
  regionLabel,
  JUCO_DIVISION,
} from "../../src/lib/juco/regionDistrictMap.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

type Row = Record<string, string>;

type FileBucket = {
  hitterMaster: Array<{ path: string; region: number }>;
  pitchingMaster: Array<{ path: string; region: number }>;
  stuffPlus: Array<{ path: string; pitchType: string; hand: "R" | "L" }>;
  unknown: Array<{ path: string; reason: string }>;
};

export type ImportReport = {
  filesScanned: number;
  teamsUpserted: number;
  playersUpserted: number;
  hitterMasterUpserted: number;
  pitchingMasterUpserted: number;
  stuffPlusUpserted: number;
  errors: string[];
};

// ─── CSV parsing ────────────────────────────────────────────────────────────

function parseCsvFile(path: string): { header: string[]; rows: Row[] } {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = parseHeader(lines[0]);
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseHeader(lines[i]);
    const row: Row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = cells[j] ?? "";
    rows.push(row);
  }
  return { header, rows };
}

// ─── Value coercion ─────────────────────────────────────────────────────────

function toNum(v: string | undefined): number | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s || s === "-" || s === "N/A" || s === "NaN") return null;
  // Strip trailing %
  const cleaned = s.endsWith("%") ? s.slice(0, -1) : s;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: string | undefined): number | null {
  const n = toNum(v);
  return n === null ? null : Math.round(n);
}

function toStr(v: string | undefined): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s && s !== "-" ? s : null;
}

/** Split "Landon Blais" → { first: "Landon", last: "Blais" } */
function splitName(full: string, firstName?: string): { first: string; last: string } {
  const trimmed = (full ?? "").trim();
  const first = (firstName ?? "").trim();
  if (first && trimmed.startsWith(first)) {
    return { first, last: trimmed.slice(first.length).trim() };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

// ─── Scanner ────────────────────────────────────────────────────────────────

export function scanDir(dir: string): FileBucket {
  const bucket: FileBucket = {
    hitterMaster: [],
    pitchingMaster: [],
    stuffPlus: [],
    unknown: [],
  };
  const entries = readdirSync(dir).filter((e) => e.toLowerCase().endsWith(".csv") && !e.startsWith("."));
  for (const e of entries) {
    const path = join(dir, e);
    if (!statSync(path).isFile()) continue;
    const cls: JucoFileKind = classifyJucoFile(e);
    if (cls.kind === "hitter_master") bucket.hitterMaster.push({ path, region: cls.region });
    else if (cls.kind === "pitching_master") bucket.pitchingMaster.push({ path, region: cls.region });
    else if (cls.kind === "stuff_plus_inputs") bucket.stuffPlus.push({ path, pitchType: cls.pitchType, hand: cls.hand });
    else bucket.unknown.push({ path, reason: cls.reason });
  }
  return bucket;
}

// ─── Team upsert ────────────────────────────────────────────────────────────
// Teams Table key: source_id (stable cross-season). One row per team per season
// via composite (source_id, Season). Already-existing rows are updated with
// JUCO-specific columns (division, region, district, conference fields).

async function extractAndUpsertTeams(
  files: { path: string; region: number }[],
  season: number,
  write: boolean,
): Promise<{ count: number; errors: string[] }> {
  const teams = new Map<string, { source_id: string; full_name: string; abbreviation: string; region: number }>();
  for (const { path, region } of files) {
    const { rows } = parseCsvFile(path);
    for (const r of rows) {
      const tid = toStr(r["newestTeamId"]);
      if (!tid) continue;
      if (!teams.has(tid)) {
        teams.set(tid, {
          source_id: tid,
          full_name: toStr(r["newestTeamName"]) ?? tid,
          abbreviation: toStr(r["newestTeamAbbrevName"]) ?? tid,
          region,
        });
      }
    }
  }

  const rows = [...teams.values()].map((t) => ({
    source_id: t.source_id,
    full_name: t.full_name,
    abbreviation: t.abbreviation,
    Season: season,
    division: JUCO_DIVISION,
    region: regionLabel(t.region),
    district: districtForRegion(t.region),
    conference: conferenceLabelForRegion(t.region),
    conference_id: districtUuidForRegion(t.region),
  }));

  if (!write) return { count: rows.length, errors: [] };

  const errors: string[] = [];
  let written = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await (supabase as any)
      .from("Teams Table")
      .upsert(batch, { onConflict: "source_id,Season" });
    if (error) errors.push(`Teams batch ${i}: ${error.message}`);
    else written += batch.length;
  }
  return { count: written, errors };
}

// ─── Player upsert ──────────────────────────────────────────────────────────
// players key: source_player_id. One row per player total (persists across
// seasons). Upsert overwrites identity fields each run; transfer_portal and
// portal_status preserved if existing (default for new rows: false / 'NOT_IN_PORTAL').

async function extractAndUpsertPlayers(
  hitterFiles: { path: string; region: number }[],
  pitcherFiles: { path: string; region: number }[],
  write: boolean,
): Promise<{ count: number; errors: string[] }> {
  type PlayerRecord = {
    source_player_id: string;
    first_name: string;
    last_name: string;
    source_team_id: string | null;
    team: string | null;
    conference: string | null;
    position: string | null;
    bats_hand: string | null;
    throws_hand: string | null;
    division: string;
  };
  const players = new Map<string, PlayerRecord>();

  function ingest(files: { path: string; region: number }[], isHitterSource: boolean): void {
    for (const { path, region } of files) {
      const { rows } = parseCsvFile(path);
      for (const r of rows) {
        const pid = toStr(r["playerId"]);
        if (!pid) continue;
        const { first, last } = splitName(r["playerFullName"] ?? "", r["playerFirstName"]);
        const tid = toStr(r["newestTeamId"]);
        if (!players.has(pid)) {
          // JUCO Presto hitter CSV often carries `pos = "P"` for non-pitchers
          // (source-data quirk — TruMedia hitter export defaults position to
          // "P" for some JUCO rows). When ingesting from a HITTER file, treat
          // any "P" as unknown and store "UTL" so a hitter never gets tagged
          // as a pitcher in players.position. Pitcher-file ingest stays as-is.
          const rawPos = toStr(r["pos"]);
          const position = isHitterSource && rawPos === "P" ? "UTL" : rawPos;
          players.set(pid, {
            source_player_id: pid,
            first_name: first || "Unknown",
            last_name: last || "Player",
            source_team_id: tid,
            team: toStr(r["newestTeamName"]),
            conference: conferenceLabelForRegion(region),
            position,
            bats_hand: toStr(r["batsHand"]),
            throws_hand: toStr(r["throwsHand"]),
            division: JUCO_DIVISION,
          });
        }
      }
    }
  }
  ingest(hitterFiles, true);
  ingest(pitcherFiles, false);

  if (!write) return { count: players.size, errors: [] };

  // Resolve team_id (UUID) per source_team_id from Teams Table for the current season
  // so we can populate players.team_id. Reverse-lookup table for the players we just collected.
  const sourceTeamIds = [...new Set([...players.values()].map((p) => p.source_team_id).filter(Boolean) as string[])];
  const teamIdMap = new Map<string, string>(); // source_team_id → team_id (UUID)
  for (let i = 0; i < sourceTeamIds.length; i += 200) {
    const batch = sourceTeamIds.slice(i, i + 200);
    const { data } = await (supabase as any)
      .from("Teams Table")
      .select("id, source_id")
      .in("source_id", batch)
      .eq("division", JUCO_DIVISION);
    for (const r of data ?? []) {
      if (r.source_id && r.id) teamIdMap.set(r.source_id, r.id);
    }
  }

  const rows = [...players.values()].map((p) => ({
    source_player_id: p.source_player_id,
    first_name: p.first_name,
    last_name: p.last_name,
    source_team_id: p.source_team_id,
    team_id: p.source_team_id ? teamIdMap.get(p.source_team_id) ?? null : null,
    team: p.team,
    conference: p.conference,
    position: p.position,
    bats_hand: p.bats_hand,
    throws_hand: p.throws_hand,
    division: p.division,
    portal_status: "NOT IN PORTAL",
    transfer_portal: false,
  }));

  const errors: string[] = [];
  let written = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // ignoreDuplicates so existing players keep their transfer_portal/portal_status flags
    const { error } = await (supabase as any)
      .from("players")
      .upsert(batch, { onConflict: "source_player_id", ignoreDuplicates: false });
    if (error) errors.push(`Players batch ${i}: ${error.message}`);
    else written += batch.length;
  }
  return { count: written, errors };
}

// ─── Hitter Master upsert (PA > 0) ──────────────────────────────────────────

async function upsertHitterMaster(
  files: { path: string; region: number }[],
  season: number,
  write: boolean,
): Promise<{ count: number; errors: string[] }> {
  type HitRow = Record<string, any>;
  const rows: HitRow[] = [];

  // Lookup team UUID + conference UUID per source_team_id
  const allSourceIds = new Set<string>();
  for (const { path } of files) {
    const { rows: csvRows } = parseCsvFile(path);
    for (const r of csvRows) {
      const tid = toStr(r["newestTeamId"]);
      if (tid) allSourceIds.add(tid);
    }
  }
  const teamMap = new Map<string, { id: string; conference_id: string | null }>();
  const sourceIdList = [...allSourceIds];
  for (let i = 0; i < sourceIdList.length; i += 200) {
    const batch = sourceIdList.slice(i, i + 200);
    const { data } = await (supabase as any)
      .from("Teams Table")
      .select("id, source_id, conference_id")
      .in("source_id", batch)
      .eq("Season", season)
      .eq("division", JUCO_DIVISION);
    for (const r of data ?? []) {
      if (r.source_id) teamMap.set(r.source_id, { id: r.id, conference_id: r.conference_id });
    }
  }

  for (const { path, region } of files) {
    const { rows: csvRows } = parseCsvFile(path);
    for (const r of csvRows) {
      const pa = toInt(r["PA"]);
      if (!pa || pa <= 0) continue; // PA>0 filter — drop ghost rows
      const pid = toStr(r["playerId"]);
      if (!pid) continue;
      const tid = toStr(r["newestTeamId"]);
      const teamInfo = tid ? teamMap.get(tid) : undefined;

      rows.push({
        source_player_id: pid,
        playerFullName: toStr(r["playerFullName"]),
        Team: toStr(r["newestTeamName"]),
        TeamID: teamInfo?.id ?? null,
        Conference: conferenceLabelForRegion(region),
        conference_id: teamInfo?.conference_id ?? null,
        Season: season,
        Pos: toStr(r["pos"]),
        BatHand: toStr(r["batsHand"]),
        ThrowHand: toStr(r["throwsHand"]),
        AVG: toNum(r["BA"]),
        OBP: toNum(r["OBP"]),
        SLG: toNum(r["SLG"]),
        ISO: toNum(r["ISO"]),
        pa,
        ab: toInt(r["AB"]),
        trackman_pitches: toInt(r["P"]),
        k_pct: toNum(r["K%"]),
        bb: toNum(r["BB%"]),
        contact: toNum(r["Contact%"]),
        chase: toNum(r["Chase%"]),
        avg_exit_velo: toNum(r["ExitVel"]),
        ev90: toNum(r["90thExitVel"]),
        barrel: toNum(r["Barrel%"]),
        line_drive: toNum(r["Line%"]),
        gb: toNum(r["Ground%"]),
        pop_up: toNum(r["Popup%"]),
        la_10_30: toNum(r["LA10-30%"]),
        pull: toNum(r["HPull%"]),
        division: JUCO_DIVISION,
      });
    }
  }

  if (!write) return { count: rows.length, errors: [] };

  const errors: string[] = [];
  let written = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await (supabase as any)
      .from("Hitter Master")
      .upsert(batch, { onConflict: "source_player_id,Season" });
    if (error) errors.push(`Hitter Master batch ${i}: ${error.message}`);
    else written += batch.length;
  }
  return { count: written, errors };
}

// ─── Pitching Master upsert (IP > 0) ────────────────────────────────────────

async function upsertPitchingMaster(
  files: { path: string; region: number }[],
  season: number,
  write: boolean,
): Promise<{ count: number; errors: string[] }> {
  type PitchRow = Record<string, any>;
  const rows: PitchRow[] = [];

  const allSourceIds = new Set<string>();
  for (const { path } of files) {
    const { rows: csvRows } = parseCsvFile(path);
    for (const r of csvRows) {
      const tid = toStr(r["newestTeamId"]);
      if (tid) allSourceIds.add(tid);
    }
  }
  const teamMap = new Map<string, { id: string; conference_id: string | null }>();
  const sourceIdList = [...allSourceIds];
  for (let i = 0; i < sourceIdList.length; i += 200) {
    const batch = sourceIdList.slice(i, i + 200);
    const { data } = await (supabase as any)
      .from("Teams Table")
      .select("id, source_id, conference_id")
      .in("source_id", batch)
      .eq("Season", season)
      .eq("division", JUCO_DIVISION);
    for (const r of data ?? []) {
      if (r.source_id) teamMap.set(r.source_id, { id: r.id, conference_id: r.conference_id });
    }
  }

  for (const { path, region } of files) {
    const { rows: csvRows } = parseCsvFile(path);
    for (const r of csvRows) {
      const ip = toNum(r["IP"]);
      if (!ip || ip <= 0) continue; // IP>0 filter — drop ghost rows
      const pid = toStr(r["playerId"]);
      if (!pid) continue;
      const tid = toStr(r["newestTeamId"]);
      const teamInfo = tid ? teamMap.get(tid) : undefined;

      // Role inference: GS / G ratio ≥ 0.5 → SP, else RP (matches existing convention)
      const g = toInt(r["G"]);
      const gs = toInt(r["GS"]);
      const role = (g && gs && gs / g >= 0.5) ? "SP" : "RP";

      rows.push({
        source_player_id: pid,
        playerFullName: toStr(r["playerFullName"]),
        Team: toStr(r["newestTeamName"]),
        TeamID: teamInfo?.id ?? null,
        Conference: conferenceLabelForRegion(region),
        conference_id: teamInfo?.conference_id ?? null,
        Season: season,
        ThrowHand: toStr(r["throwsHand"]),
        Role: role,
        IP: ip,
        G: g,
        GS: gs,
        ERA: toNum(r["ERA"]),
        FIP: toNum(r["FIP"]),
        WHIP: toNum(r["WHIP"]),
        K9: toNum(r["K/9"]),
        BB9: toNum(r["BB/9"]),
        HR9: toNum(r["HR/9"]),
        miss_pct: toNum(r["Miss%"]),
        bb_pct: toNum(r["BB%"]),
        hard_hit_pct: toNum(r["HardHit%"]),
        in_zone_whiff_pct: toNum(r["InZoneWhiff%"]),
        chase_pct: toNum(r["Chase%"]),
        barrel_pct: toNum(r["Barrel%"]),
        line_pct: toNum(r["Line%"]),
        exit_vel: toNum(r["ExitVel"]),
        ground_pct: toNum(r["Ground%"]),
        in_zone_pct: toNum(r["InZone%"]),
        "90th_vel": toNum(r["90thExitVel"]),
        h_pull_pct: toNum(r["HPull%"]),
        la_10_30_pct: toNum(r["LA10-30%"]),
        trackman_pitches: toInt(r["P"]),
        k_pct: toNum(r["K%"]),
        bf: toInt(r["BF"]),
        division: JUCO_DIVISION,
      });
    }
  }

  if (!write) return { count: rows.length, errors: [] };

  const errors: string[] = [];
  let written = 0;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await (supabase as any)
      .from("Pitching Master")
      .upsert(batch, { onConflict: "source_player_id,Season" });
    if (error) errors.push(`Pitching Master batch ${i}: ${error.message}`);
    else written += batch.length;
  }
  return { count: written, errors };
}

// ─── Per-pitch Stuff+ upsert ────────────────────────────────────────────────
// Idempotent: delete existing (season, pitch_type, hand, division=NJCAA_D1)
// then bulk insert. Mirrors the existing D1 importer pattern.

async function upsertPerPitchStuffPlus(
  files: { path: string; pitchType: string; hand: "R" | "L" }[],
  season: number,
  write: boolean,
): Promise<{ count: number; errors: string[] }> {
  type PpRow = Record<string, any>;
  let total = 0;
  const errors: string[] = [];

  for (const { path, pitchType, hand } of files) {
    const { rows: csvRows } = parseCsvFile(path);

    // Look up team + conference info for players in this file
    const teamIds = new Set<string>();
    for (const r of csvRows) {
      const tid = toStr(r["newestTeamId"]);
      if (tid) teamIds.add(tid);
    }
    const teamMap = new Map<string, { id: string; conference: string | null; conference_id: string | null }>();
    const sourceIdList = [...teamIds];
    for (let i = 0; i < sourceIdList.length; i += 200) {
      const batch = sourceIdList.slice(i, i + 200);
      const { data } = await (supabase as any)
        .from("Teams Table")
        .select("id, source_id, conference, conference_id")
        .in("source_id", batch)
        .eq("Season", season)
        .eq("division", JUCO_DIVISION);
      for (const r of data ?? []) {
        if (r.source_id) teamMap.set(r.source_id, { id: r.id, conference: r.conference, conference_id: r.conference_id });
      }
    }

    const rows: PpRow[] = [];
    for (const r of csvRows) {
      const pid = toStr(r["playerId"]);
      const pitches = toInt(r["P"]);
      if (!pid || !pitches || pitches <= 0) continue;
      const tid = toStr(r["newestTeamId"]);
      const teamInfo = tid ? teamMap.get(tid) : undefined;

      // 0 spin physically impossible → treat as null
      const spin = toNum(r["Spin"]);
      const spinFinal = spin && spin > 0 ? spin : null;

      rows.push({
        source_player_id: pid,
        season,
        pitch_type: pitchType,
        hand,
        team: toStr(r["newestTeamName"]),
        team_id: teamInfo?.id ?? null,
        conference: teamInfo?.conference ?? null,
        conference_id: teamInfo?.conference_id ?? null,
        pitches,
        velocity: toNum(r["Vel"]),
        ivb: toNum(r["IndVertBrk"]),
        hb: toNum(r["HorzBrk"]),
        rel_height: toNum(r["RelHeight"]),
        rel_side: toNum(r["RelSide"]),
        extension: toNum(r["Extension"]),
        spin: spinFinal,
        vaa: toNum(r["VertApprAngle"]),
        whiff_pct: toNum(r["Miss%"]),
        division: JUCO_DIVISION,
      });
    }

    if (!write) {
      total += rows.length;
      continue;
    }

    // Delete existing rows for this (season, pitch_type, hand) within JUCO scope.
    // Need to filter on division via the source_player_id join — but the simpler
    // approach: delete by (season, pitch_type, hand) AND player belongs to JUCO.
    // For safety, we identify JUCO players first and limit delete to their IDs.
    const jucoPlayerIds = rows.map((r) => r.source_player_id);
    // Delete in batches of source_player_id
    for (let i = 0; i < jucoPlayerIds.length; i += 500) {
      const batch = jucoPlayerIds.slice(i, i + 500);
      const { error } = await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .delete()
        .eq("season", season)
        .eq("pitch_type", pitchType)
        .eq("hand", hand)
        .in("source_player_id", batch);
      if (error) errors.push(`Delete ${pitchType} ${hand} batch ${i}: ${error.message}`);
    }

    // Insert fresh
    const BATCH = 200;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const { error } = await (supabase as any)
        .from("pitcher_stuff_plus_inputs")
        .insert(batch);
      if (error) errors.push(`Insert ${pitchType} ${hand} batch ${i}: ${error.message}`);
      else total += batch.length;
    }
  }
  return { count: total, errors };
}

// ─── Main pipeline ──────────────────────────────────────────────────────────

export async function runJucoImport(
  dir: string,
  season: number,
  write: boolean,
): Promise<ImportReport> {
  const report: ImportReport = {
    filesScanned: 0,
    teamsUpserted: 0,
    playersUpserted: 0,
    hitterMasterUpserted: 0,
    pitchingMasterUpserted: 0,
    stuffPlusUpserted: 0,
    errors: [],
  };

  const files = scanDir(dir);
  report.filesScanned =
    files.hitterMaster.length + files.pitchingMaster.length + files.stuffPlus.length;

  if (files.unknown.length > 0) {
    for (const u of files.unknown) report.errors.push(`Skip ${u.path}: ${u.reason}`);
  }

  // 1. Teams Table — from both hitter + pitcher files (same teams in both)
  const allRegionFiles = [...files.hitterMaster, ...files.pitchingMaster];
  const teamsResult = await extractAndUpsertTeams(allRegionFiles, season, write);
  report.teamsUpserted = teamsResult.count;
  report.errors.push(...teamsResult.errors);

  // 2. players — same source
  const playersResult = await extractAndUpsertPlayers(files.hitterMaster, files.pitchingMaster, write);
  report.playersUpserted = playersResult.count;
  report.errors.push(...playersResult.errors);

  // 3. Hitter Master (PA>0 filter)
  const hitterResult = await upsertHitterMaster(files.hitterMaster, season, write);
  report.hitterMasterUpserted = hitterResult.count;
  report.errors.push(...hitterResult.errors);

  // 4. Pitching Master (IP>0 filter)
  const pitcherResult = await upsertPitchingMaster(files.pitchingMaster, season, write);
  report.pitchingMasterUpserted = pitcherResult.count;
  report.errors.push(...pitcherResult.errors);

  // 5. Per-pitch Stuff+
  const stuffResult = await upsertPerPitchStuffPlus(files.stuffPlus, season, write);
  report.stuffPlusUpserted = stuffResult.count;
  report.errors.push(...stuffResult.errors);

  return report;
}
