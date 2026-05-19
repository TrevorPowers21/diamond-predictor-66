import { supabase } from "@/integrations/supabase/client";
import { parseHeader } from "../../scripts/import-csvs/csv";

export interface ConferenceStatsImportResult {
  updated: number;
  inserted: number;
  skipped: number;
  errors: string[];
  unknownAbbrevs: string[];
}

type Row = {
  abbrev: string;
  AVG: number | null;
  OBP: number | null;
  ISO: number | null;
  ERA: number | null;
  FIP: number | null;
  WHIP: number | null;
  K9: number | null;
  BB9: number | null;
  HR9: number | null;
  SLG: number | null;
};

const ABBREV_KEYS = ["conference abbreviation", "conference_abbreviation", "Conference Abbreviation", "abbreviation", "Conference"];

function num(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  const n = Number(String(s).trim());
  return Number.isFinite(n) ? n : null;
}

function parseRows(csvText: string): Row[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseHeader(lines[0]);
  const lower = header.map((h) => h.trim().toLowerCase());

  const idxOf = (...names: string[]) => {
    for (const n of names) {
      const i = lower.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };

  const iAbbrev = idxOf(...ABBREV_KEYS);
  if (iAbbrev < 0) return [];

  const cols = {
    abbrev: iAbbrev,
    AVG: idxOf("AVG", "BA"),
    OBP: idxOf("OBP"),
    ISO: idxOf("ISO"),
    SLG: idxOf("SLG"),
    ERA: idxOf("ERA"),
    FIP: idxOf("FIP"),
    WHIP: idxOf("WHIP"),
    K9: idxOf("K9", "K/9"),
    BB9: idxOf("BB9", "BB/9"),
    HR9: idxOf("HR9", "HR/9"),
  };

  const out: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseHeader(lines[i]);
    const abbrev = (c[cols.abbrev] ?? "").trim();
    if (!abbrev) continue;
    out.push({
      abbrev,
      AVG: cols.AVG >= 0 ? num(c[cols.AVG]) : null,
      OBP: cols.OBP >= 0 ? num(c[cols.OBP]) : null,
      ISO: cols.ISO >= 0 ? num(c[cols.ISO]) : null,
      SLG: cols.SLG >= 0 ? num(c[cols.SLG]) : null,
      ERA: cols.ERA >= 0 ? num(c[cols.ERA]) : null,
      FIP: cols.FIP >= 0 ? num(c[cols.FIP]) : null,
      WHIP: cols.WHIP >= 0 ? num(c[cols.WHIP]) : null,
      K9: cols.K9 >= 0 ? num(c[cols.K9]) : null,
      BB9: cols.BB9 >= 0 ? num(c[cols.BB9]) : null,
      HR9: cols.HR9 >= 0 ? num(c[cols.HR9]) : null,
    });
  }
  return out;
}

/**
 * Imports per-conference aggregate stats by matching on "conference abbreviation".
 * UPDATEs existing rows for (abbrev, season). Logs unknown abbreviations so
 * the user can backfill the Conference Stats row before re-running.
 */
export async function importConferenceStatsCsv(
  csvText: string,
  season: number,
): Promise<ConferenceStatsImportResult> {
  const rows = parseRows(csvText);
  const result: ConferenceStatsImportResult = {
    updated: 0,
    inserted: 0,
    skipped: 0,
    errors: [],
    unknownAbbrevs: [],
  };

  if (rows.length === 0) {
    result.errors.push("No rows parsed — check CSV header (need 'conference abbreviation' column).");
    return result;
  }

  // Load existing rows for season to know which exist already
  const { data: existing, error: fetchErr } = await (supabase as any)
    .from("Conference Stats")
    .select('"conference abbreviation", conference_id, season')
    .eq("season", season);
  if (fetchErr) {
    result.errors.push(`Fetch existing: ${fetchErr.message}`);
    return result;
  }
  const existingAbbrevs = new Set<string>(
    (existing ?? []).map((r: any) => String(r["conference abbreviation"]).trim()),
  );

  for (const r of rows) {
    if (!existingAbbrevs.has(r.abbrev)) {
      result.unknownAbbrevs.push(r.abbrev);
      result.skipped++;
      continue;
    }

    const payload: Record<string, number | null> = {
      AVG: r.AVG,
      OBP: r.OBP,
      ISO: r.ISO,
      ERA: r.ERA,
      FIP: r.FIP,
      WHIP: r.WHIP,
      K9: r.K9,
      BB9: r.BB9,
      HR9: r.HR9,
    };
    if (r.SLG != null) payload.SLG = r.SLG;

    const { error } = await (supabase as any)
      .from("Conference Stats")
      .update(payload)
      .eq("conference abbreviation", r.abbrev)
      .eq("season", season);

    if (error) {
      result.errors.push(`${r.abbrev}: ${error.message}`);
    } else {
      result.updated++;
    }
  }

  return result;
}

/**
 * After NCAA averages are refreshed, compute conference-level environmental
 * rate plusses: ba_plus / obp_plus / slg_plus / iso_plus = (conf_rate / NCAA_avg) × 100.
 * These are different from the *_power_rating columns (which are talent scores
 * computed from underlying scouting metrics).
 */
export async function computeConferenceEnvRates(season: number): Promise<{
  updated: number;
  skipped: number;
  errors: string[];
}> {
  const result = { updated: 0, skipped: 0, errors: [] as string[] };

  const { data: ncaa, error: ncaaErr } = await (supabase as any)
    .from("ncaa_averages")
    .select("avg, obp, slg, iso")
    .eq("season", season)
    .maybeSingle();
  if (ncaaErr || !ncaa) {
    result.errors.push(`No ncaa_averages row for season ${season}`);
    return result;
  }

  const ncaaAvg = ncaa.avg as number | null;
  const ncaaObp = ncaa.obp as number | null;
  const ncaaSlg = ncaa.slg as number | null;
  const ncaaIso = ncaa.iso as number | null;

  const { data: confs, error: confErr } = await (supabase as any)
    .from("Conference Stats")
    .select('"conference abbreviation", "AVG", "OBP", "SLG", "ISO"')
    .eq("season", season);
  if (confErr) {
    result.errors.push(`Fetch confs: ${confErr.message}`);
    return result;
  }

  for (const c of confs ?? []) {
    const payload: Record<string, number | null> = {};
    if (ncaaAvg && c.AVG != null) payload.ba_plus = Math.round((c.AVG / ncaaAvg) * 1000) / 10;
    if (ncaaObp && c.OBP != null) payload.obp_plus = Math.round((c.OBP / ncaaObp) * 1000) / 10;
    if (ncaaSlg && c.SLG != null) payload.slg_plus = Math.round((c.SLG / ncaaSlg) * 1000) / 10;
    if (ncaaIso && c.ISO != null) payload.iso_plus = Math.round((c.ISO / ncaaIso) * 1000) / 10;

    if (Object.keys(payload).length === 0) {
      result.skipped++;
      continue;
    }

    const { error } = await (supabase as any)
      .from("Conference Stats")
      .update(payload)
      .eq("conference abbreviation", c["conference abbreviation"])
      .eq("season", season);
    if (error) result.errors.push(`${c["conference abbreviation"]}: ${error.message}`);
    else result.updated++;
  }

  return result;
}
