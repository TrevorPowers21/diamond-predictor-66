import { supabase } from "@/integrations/supabase/client";

/**
 * Headless importer for a single Stuff+ Inputs CSV file (one pitch type × one
 * hand per file, per TruMedia's export pattern). Mirrors the parse logic in
 * src/components/StuffPlusImporter.tsx but is callable from Node (CLI cascade)
 * without React. Idempotent — deletes existing rows for (season, pitch_type,
 * hand) before inserting, so re-running with the same CSV produces the same
 * row set, not duplicates.
 *
 * Caller is responsible for chaining the downstream pipeline (velo-diff →
 * reclassify → Stuff+ engine → rollup) once all per-file imports finish.
 */

export interface StuffPlusInputsImportResult {
  inserted: number;
  deleted: number;
  pitchType: string;
  hand: string;
  errors: string[];
}

interface ParsedRow {
  source_player_id: string;
  season: number;
  pitch_type: string;
  hand: string;
  team: string;
  team_id: string;
  conference: string | null;
  conference_id: string | null;
  pitches: number | null;
  velocity: number | null;
  ivb: number | null;
  hb: number | null;
  rel_height: number | null;
  rel_side: number | null;
  extension: number | null;
  spin: number | null;
  vaa: number | null;
  whiff_pct: number | null;
  stuff_plus: null;
  gyro_stuff_plus: null;
}

function parseNum(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val.trim() === "-") return null;
  const n = Number(val.trim());
  return Number.isFinite(n) ? n : null;
}

function parseWhiff(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val.trim() === "-") return null;
  const cleaned = val.replace(/%/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseInt2(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val.trim() === "-") return null;
  const n = Number(val.trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export async function importStuffPlusInputsCsv(
  csvText: string,
  season: number,
): Promise<StuffPlusInputsImportResult> {
  const result: StuffPlusInputsImportResult = {
    inserted: 0,
    deleted: 0,
    pitchType: "",
    hand: "",
    errors: [],
  };

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    result.errors.push("CSV must have a header row and at least one data row.");
    return result;
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iPlayerId = col("playerId");
  const iThrowsHand = col("throwsHand");
  const iTeamName = col("newestTeamName");
  const iTeamId = col("newestTeamId");
  const iPitchType = col("Pitch Type");
  const iPitches = col("P");
  const iVel = col("Vel");
  const iIVB = col("IndVertBrk");
  const iHB = col("HorzBrk");
  const iRelH = col("RelHeight");
  const iRelS = col("RelSide");
  const iExt = col("Extension");
  const iSpin = col("Spin");
  const iVAA = col("VertApprAngle");
  const iMiss = col("Miss%");

  if (iPlayerId === -1) {
    result.errors.push(`Missing required column 'playerId'. Found: ${header.join(", ")}`);
    return result;
  }

  // Detect pitch_type + hand from first data row. The TruMedia per-file pattern
  // means every row in a single file shares the same (pitch_type, hand).
  const firstDataRow = parseCsvLine(lines[1]);
  const detectedPitchType = iPitchType !== -1 ? (firstDataRow[iPitchType] || "").trim() : "";
  if (!detectedPitchType) {
    result.errors.push("Could not detect Pitch Type from first data row.");
    return result;
  }
  const detectedHand = iThrowsHand !== -1 ? (firstDataRow[iThrowsHand] || "").trim() : "";
  if (!detectedHand) {
    result.errors.push("Could not detect throwsHand from first data row.");
    return result;
  }

  result.pitchType = detectedPitchType;
  result.hand = detectedHand;

  // Teams Table lookup for conference resolution.
  const { data: teams } = await supabase
    .from("Teams Table")
    .select("id, full_name, abbreviation, conference, conference_id, source_id");
  type TeamEntry = { conference: string | null; conference_id: string | null };
  const teamLookup = new Map<string, TeamEntry>();
  for (const t of teams || []) {
    const entry: TeamEntry = { conference: t.conference, conference_id: t.conference_id };
    if (t.source_id) teamLookup.set(String(t.source_id), entry);
    if (t.abbreviation) teamLookup.set(t.abbreviation.toLowerCase().trim(), entry);
    teamLookup.set(t.full_name.toLowerCase().trim(), entry);
  }

  // Parse data rows.
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const playerId = (values[iPlayerId] || "").trim();
    if (!playerId) continue;

    const teamId = iTeamId !== -1 ? (values[iTeamId] || "").trim() : "";
    const teamName = iTeamName !== -1 ? (values[iTeamName] || "").trim() : "";

    let conf: TeamEntry = { conference: null, conference_id: null };
    if (teamId && teamLookup.has(teamId)) {
      conf = teamLookup.get(teamId)!;
    } else if (teamName && teamLookup.has(teamName.toLowerCase().trim())) {
      conf = teamLookup.get(teamName.toLowerCase().trim())!;
    }

    const rowHand = iThrowsHand !== -1 ? (values[iThrowsHand] || "").trim() : detectedHand;

    rows.push({
      source_player_id: playerId,
      season,
      pitch_type: detectedPitchType,
      hand: rowHand || detectedHand,
      team: teamName,
      team_id: teamId,
      conference: conf.conference,
      conference_id: conf.conference_id,
      pitches: parseInt2(values[iPitches]),
      velocity: parseNum(values[iVel]),
      ivb: parseNum(values[iIVB]),
      hb: parseNum(values[iHB]),
      rel_height: parseNum(values[iRelH]),
      rel_side: parseNum(values[iRelS]),
      extension: parseNum(values[iExt]),
      spin: parseInt2(values[iSpin]),
      vaa: parseNum(values[iVAA]),
      whiff_pct: parseWhiff(values[iMiss]),
      stuff_plus: null,
      gyro_stuff_plus: null,
    });
  }

  // Filter rows that didn't actually throw the pitch.
  const withPitches = rows.filter((r) => r.pitches != null && r.pitches >= 1);

  // Dedupe — keep first row per source_player_id (matches the UI importer).
  const seen = new Set<string>();
  const filtered: ParsedRow[] = [];
  for (const r of withPitches) {
    if (!seen.has(r.source_player_id)) {
      seen.add(r.source_player_id);
      filtered.push(r);
    }
  }

  if (filtered.length === 0) {
    result.errors.push("No valid rows after filtering (need pitches >= 1).");
    return result;
  }

  // Idempotent guard: delete existing rows for (season, pitch_type, hand) so
  // re-running on the same CSV produces the same row set, not duplicates.
  // The UI importer doesn't do this, which is why running it twice doubles
  // rows. Automation should be safe to re-run.
  const { error: delError, count: delCount } = await (supabase as any)
    .from("pitcher_stuff_plus_inputs")
    .delete({ count: "exact" })
    .eq("season", season)
    .eq("pitch_type", detectedPitchType)
    .eq("hand", detectedHand);
  if (delError) {
    result.errors.push(`Delete existing rows failed: ${delError.message}`);
    return result;
  }
  result.deleted = delCount ?? 0;

  // Insert new rows in batches.
  const BATCH = 100;
  for (let i = 0; i < filtered.length; i += BATCH) {
    const batch = filtered.slice(i, i + BATCH);
    const { error } = await (supabase as any)
      .from("pitcher_stuff_plus_inputs")
      .insert(batch);
    if (error) {
      result.errors.push(`Batch ${Math.floor(i / BATCH) + 1}: ${error.message}`);
    } else {
      result.inserted += batch.length;
    }
  }

  return result;
}
