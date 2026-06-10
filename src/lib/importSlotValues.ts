/**
 * Player Slot Values importer.
 *
 * One CSV per draft cycle. Each row carries a draft-eligible player's
 * MLB Draft slot dollar value plus identity. The table is combined
 * hitter + pitcher — no per-side split.
 *
 * Two row shapes are handled:
 *   • College player already in our players table — matched by name+school
 *     to populate player_id. `is_high_school` is false.
 *   • High-school prospect not in players — player_id stays NULL. The row
 *     carries player_name + current_school + commitment_school inline.
 *
 * Matching to players.id is a soft name+school join. Unmatched college rows
 * are still imported (player_id NULL) so the data isn't lost — they surface
 * in the unmatched count for follow-up.
 *
 * Upsert key is (draft_year, player_name, current_school) so the same row
 * can be re-imported with refreshed slot values without dupes.
 */
import { supabase } from "@/integrations/supabase/client";
import { parseHeader } from "../../scripts/import-csvs/csv";

export interface SlotValueImportResult {
  totalRows: number;
  upserted: number;
  matchedToPlayer: number;
  highSchoolRows: number;
  unmatchedCollegeRows: number;
  missingSlotValue: number;
  errors: string[];
}

function parseNumeric(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "-" || s === "--" || s === "N/A") return null;
  const cleaned = s.replace(/[$,%\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseBool(raw: string | undefined | null): boolean {
  if (raw == null) return false;
  const s = String(raw).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "hs" || s === "high school";
}

/**
 * Heuristic high-school detector from a school name. Catches the long tail
 * of HS prospects whose Commitment column is blank in the CSV.
 */
function schoolLooksHighSchool(school: string | null): boolean {
  if (!school) return false;
  const s = school.toLowerCase();
  if (/\bhs\b/.test(s)) return true;                  // "Sandalwood HS, Jacksonville FL"
  if (s.includes("high school")) return true;
  if (s.includes("academy")) return true;             // Montverde Academy, IMG Academy
  if (s.includes("colegio")) return true;             // Colegio Angel David
  if (/\bchristian\b/.test(s) && !s.includes("college")) return true; // Central Pointe Christian
  if (/\bsenior\b/.test(s) && !s.includes("college")) return true;    // Niceville Senior
  return false;
}

function parseInt0(raw: string | undefined | null): number | null {
  const n = parseNumeric(raw);
  return n == null ? null : Math.trunc(n);
}

function rowsFromCsv(csvText: string): { header: string[]; rows: string[][] } {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const header = parseHeader(lines[0]);
  const rows = lines.slice(1).map((l) => parseHeader(l));
  return { header, rows };
}

function indexOf(header: string[], ...names: string[]): number {
  for (const name of names) {
    const target = name.toLowerCase();
    const i = header.findIndex((h) => h.toLowerCase() === target);
    if (i >= 0) return i;
  }
  return -1;
}

function trimOrNull(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s ? s : null;
}

/** Light name normalizer for matching: lowercase, strip punctuation + suffixes. */
function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best-effort match against players table by name + current_school.
 * Returns null when no unambiguous match exists — the row still imports
 * with player_id NULL.
 */
async function matchPlayerId(
  playerName: string,
  currentSchool: string | null,
): Promise<string | null> {
  const parts = playerName.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts.slice(1).join(" ");

  let q = supabase
    .from("players")
    .select("id, first_name, last_name, team")
    .ilike("first_name", `${first}%`)
    .ilike("last_name", `%${last}%`)
    .limit(20);

  const { data, error } = await q;
  if (error || !data || data.length === 0) return null;

  const targetSchool = currentSchool ? normName(currentSchool) : null;
  const targetFull = normName(playerName);

  // Prefer exact name + school match.
  for (const row of data) {
    const rowName = normName(`${row.first_name ?? ""} ${row.last_name ?? ""}`);
    if (rowName !== targetFull) continue;
    if (!targetSchool) return row.id as string;
    const rowSchool = normName(String(row.team ?? ""));
    if (rowSchool === targetSchool || rowSchool.includes(targetSchool) || targetSchool.includes(rowSchool)) {
      return row.id as string;
    }
  }

  // If exactly one name match and no school disambiguation, accept it.
  const fullMatches = data.filter((r) => normName(`${r.first_name ?? ""} ${r.last_name ?? ""}`) === targetFull);
  if (fullMatches.length === 1) return fullMatches[0].id as string;

  return null;
}

const COLUMN_MAP = {
  player_name: ["player_name", "player", "name", "playerFullName"],
  current_school: ["current_school", "school", "team", "current_team"],
  commitment_school: ["commitment_school", "commitment", "committed_to", "commit_school"],
  is_high_school: ["is_high_school", "is_hs", "hs"],
  rank: ["rank", "ordinal_rank"],
  aggregate: ["aggregate", "agg", "industry_rank"],
  slot_value: ["slot_value", "Slot Value ($)", "slot value", "slot", "value", "$"],
  position: ["position", "pos"],
  bats_hand: ["bats_hand", "bats", "b"],
  throws_hand: ["throws_hand", "throws", "t"],
  class_year: ["class_year", "class", "year", "grad_year"],
  height: ["height", "ht"],
  weight: ["weight", "wt"],
  source: ["source", "src"],
  notes: ["notes", "note"],
} as const;

export async function importPlayerSlotValuesCsv(
  csvText: string,
  draftYear: number,
): Promise<SlotValueImportResult> {
  const result: SlotValueImportResult = {
    totalRows: 0,
    upserted: 0,
    matchedToPlayer: 0,
    highSchoolRows: 0,
    unmatchedCollegeRows: 0,
    missingSlotValue: 0,
    errors: [],
  };

  const { header, rows } = rowsFromCsv(csvText);
  if (rows.length === 0) {
    result.errors.push("CSV had no body rows.");
    return result;
  }

  const idx = Object.fromEntries(
    Object.entries(COLUMN_MAP).map(([key, candidates]) => [key, indexOf(header, ...candidates)]),
  ) as Record<keyof typeof COLUMN_MAP, number>;

  if (idx.player_name < 0) {
    result.errors.push("Missing required column: player_name");
    return result;
  }
  if (idx.slot_value < 0) {
    result.errors.push("Missing required column: slot_value");
    return result;
  }

  const batch: any[] = [];
  for (const row of rows) {
    result.totalRows++;

    const playerName = trimOrNull(row[idx.player_name]);
    if (!playerName) continue;

    const slotValue = parseNumeric(row[idx.slot_value]);
    if (slotValue == null) {
      result.missingSlotValue++;
      continue;
    }

    const currentSchool = idx.current_school >= 0 ? trimOrNull(row[idx.current_school]) : null;
    const commitmentSchool = idx.commitment_school >= 0 ? trimOrNull(row[idx.commitment_school]) : null;
    const explicitHs = idx.is_high_school >= 0 ? parseBool(row[idx.is_high_school]) : false;
    const isHs = explicitHs || !!commitmentSchool || schoolLooksHighSchool(currentSchool);

    let playerId: string | null = null;
    if (!isHs) {
      playerId = await matchPlayerId(playerName, currentSchool);
      if (playerId) result.matchedToPlayer++;
      else result.unmatchedCollegeRows++;
    } else {
      result.highSchoolRows++;
    }

    const payload: any = {
      draft_year: draftYear,
      player_id: playerId,
      player_name: playerName,
      current_school: currentSchool,
      is_high_school: isHs,
      commitment_school: commitmentSchool,
      rank: idx.rank >= 0 ? parseInt0(row[idx.rank]) : null,
      aggregate: idx.aggregate >= 0 ? parseNumeric(row[idx.aggregate]) : null,
      slot_value: slotValue,
      position: idx.position >= 0 ? trimOrNull(row[idx.position]) : null,
      bats_hand: idx.bats_hand >= 0 ? trimOrNull(row[idx.bats_hand]) : null,
      throws_hand: idx.throws_hand >= 0 ? trimOrNull(row[idx.throws_hand]) : null,
      class_year: idx.class_year >= 0 ? trimOrNull(row[idx.class_year]) : null,
      height: idx.height >= 0 ? trimOrNull(row[idx.height]) : null,
      weight: idx.weight >= 0 ? parseInt0(row[idx.weight]) : null,
      source: idx.source >= 0 ? trimOrNull(row[idx.source]) : null,
      notes: idx.notes >= 0 ? trimOrNull(row[idx.notes]) : null,
      updated_at: new Date().toISOString(),
    };
    batch.push(payload);
  }

  const CHUNK = 500;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const slice = batch.slice(i, i + CHUNK);
    const { error } = await (supabase as any)
      .from("player_slot_values")
      .upsert(slice, { onConflict: "draft_year,player_name,current_school" });
    if (error) {
      result.errors.push(`Chunk ${i}-${i + slice.length}: ${error.message}`);
      continue;
    }
    result.upserted += slice.length;
  }

  return result;
}
