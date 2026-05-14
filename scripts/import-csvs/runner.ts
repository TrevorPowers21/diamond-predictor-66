import { readFileSync } from "node:fs";

import { importHistoricalHittersCsv } from "@/lib/importHistoricalHitters";
import { importHistoricalPitchersCsv } from "@/lib/importHistoricalPitchers";
import { syncMasterToPlayers, addMissingPlayers } from "@/lib/syncMasterToPlayers";
import { createPredictionsFromMaster } from "@/lib/createPredictionsFromMaster";
import { computeAndStoreNcaaAverages } from "@/lib/computeNcaaAverages";
import { computeAndStoreAllScores } from "@/lib/computeAndStoreScores";
import { bulkRecalculatePredictionsLocal } from "@/lib/predictionEngine";
import { supabase } from "@/integrations/supabase/client";

import type { DetectionResult } from "./detector.ts";
import { parseHeader } from "./csv.ts";

const SP_GS_RATIO_THRESHOLD = 0.5; // GS / G >= 0.5 → SP; below → RP

type NormalizedClass = "FR" | "SO" | "JR" | "SR" | "GR" | "R-FR" | "R-SO" | "R-JR" | "R-SR" | "R-GR";
type ClassYearPair = { sourcePlayerId: string; classYear: NormalizedClass };

/**
 * Normalize a raw ClassYear value to one of 10 canonical forms: FR/SO/JR/SR/GR
 * for non-redshirt years and R-FR/R-SO/R-JR/R-SR/R-GR for redshirts. Redshirt
 * status is meaningful (especially with NCAA roster cap rule changes) and
 * is preserved as the R- prefix.
 *
 * Accepts variants: "R-FR", "RS-FR", "R FR", "FR.", "FRESHMAN", "GRAD", etc.
 * Rejects anything not normalizable to those 10 values (single letters like
 * "L"/"R" that bleed in from hand columns when ClassYear is blank).
 *
 * Note: downstream projection math (class_transition inference, etc.) still
 * needs to treat "R-FR" as "FR" for the year-over-year math. Strip the R-
 * prefix at the read-side, not the write-side.
 */
function normalizeClassYear(raw: string | undefined): NormalizedClass | null {
  if (!raw) return null;
  let x = raw.trim().toUpperCase();
  if (!x) return null;
  // Strip trailing punctuation/whitespace (e.g. "FR.", "JR ", "SO,")
  x = x.replace(/[.\s,;]+$/, "");

  // Detect redshirt prefix: "R-FR", "RS-FR", "R FR" → split into (R-, FR)
  let redshirt = false;
  const m = x.match(/^RS?[-\s]+(.+)$/);
  if (m) {
    redshirt = true;
    x = m[1].trim();
  }

  let base: "FR" | "SO" | "JR" | "SR" | "GR" | null = null;
  if (x === "FR" || x === "SO" || x === "JR" || x === "SR" || x === "GR") base = x;
  else if (x === "FRESHMAN" || x === "FRESH") base = "FR";
  else if (x === "SOPHOMORE" || x === "SOPH") base = "SO";
  else if (x === "JUNIOR") base = "JR";
  else if (x === "SENIOR") base = "SR";
  else if (x === "GRADUATE" || x === "GRAD" || x === "GS") base = "GR";

  if (!base) return null;
  return redshirt ? (`R-${base}` as NormalizedClass) : base;
}

function extractClassYears(csvText: string): ClassYearPair[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseHeader(lines[0]);
  const idIdx = header.findIndex((h) => h.toLowerCase() === "playerid");
  const classIdx = header.findIndex((h) => h.toLowerCase() === "classyear");
  if (idIdx < 0 || classIdx < 0) return [];

  const out: ClassYearPair[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseHeader(lines[i]);
    const sourcePlayerId = cols[idIdx];
    const normalized = normalizeClassYear(cols[classIdx]);
    if (sourcePlayerId && normalized) {
      out.push({ sourcePlayerId, classYear: normalized });
    }
  }
  return out;
}

async function updatePlayersClassYears(pairs: ClassYearPair[]): Promise<{ updated: number; errors: string[] }> {
  const result = { updated: 0, errors: [] as string[] };
  if (pairs.length === 0) return result;

  // Dedupe by sourcePlayerId — last write wins
  const dedup = new Map<string, string>();
  for (const p of pairs) dedup.set(p.sourcePlayerId, p.classYear);

  // Group by class year so we can issue one batched UPDATE per distinct year
  // instead of one per player.
  const byClass = new Map<string, string[]>();
  for (const [sid, cy] of dedup) {
    const arr = byClass.get(cy) ?? [];
    arr.push(sid);
    byClass.set(cy, arr);
  }

  // Only fill BLANK class_year values. Mid-season the class doesn't change,
  // and overwriting on every import would clobber admin corrections. The
  // annual FR→SO advancement is a separate season-transition workflow.
  const CHUNK = 500;
  for (const [classYear, ids] of byClass) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { error, count } = await supabase
        .from("players")
        .update({ class_year: classYear }, { count: "exact" })
        .in("source_player_id", chunk)
        .is("class_year", null);
      if (error) {
        result.errors.push(`class ${classYear} chunk ${i}: ${error.message}`);
      } else {
        result.updated += count ?? 0;
      }
    }
  }
  return result;
}

async function deriveRolesFromGGS(season: number): Promise<{ updated: number; errors: string[] }> {
  const result = { updated: 0, errors: [] as string[] };

  let from = 0;
  const pageSize = 1000;
  const spIds: string[] = [];
  const rpIds: string[] = [];

  while (true) {
    const { data, error } = await supabase
      .from("Pitching Master")
      .select("source_player_id, G, GS, Role")
      .eq("Season", season)
      .range(from, from + pageSize - 1);
    if (error) {
      result.errors.push(`Read page ${from}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;

    for (const p of data) {
      const sid = (p as any).source_player_id as string | null;
      const g = (p as any).G as number | null;
      const gs = (p as any).GS as number | null;
      const currentRole = (p as any).Role as string | null;
      if (!sid || g == null || gs == null) continue;
      const startRatio = g > 0 ? gs / g : 0;
      const derived: "SP" | "RP" = startRatio >= SP_GS_RATIO_THRESHOLD ? "SP" : "RP";
      if (derived !== currentRole) {
        if (derived === "SP") spIds.push(sid);
        else rpIds.push(sid);
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  // Two batched UPDATE calls (one per role) instead of one per pitcher.
  // Chunk via `in()` to stay under PostgREST URL length limits.
  const CHUNK = 500;
  const runRoleBatch = async (role: "SP" | "RP", ids: string[]) => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { error, count } = await supabase
        .from("Pitching Master")
        .update({ Role: role }, { count: "exact" })
        .eq("Season", season)
        .in("source_player_id", chunk);
      if (error) {
        result.errors.push(`${role} chunk ${i}: ${error.message}`);
      } else {
        result.updated += count ?? chunk.length;
      }
    }
  };
  await runRoleBatch("SP", spIds);
  await runRoleBatch("RP", rpIds);

  return result;
}

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function step(label: string): void {
  console.log(`\n${COLOR.cyan}→${COLOR.reset} ${COLOR.bold}${label}${COLOR.reset}`);
}

function ok(line: string): void {
  console.log(`  ${COLOR.green}✓${COLOR.reset} ${line}`);
}

function warn(line: string): void {
  console.log(`  ${COLOR.yellow}!${COLOR.reset} ${line}`);
}

function err(line: string): void {
  console.log(`  ${COLOR.red}✗${COLOR.reset} ${line}`);
}

function timeMs(start: number): string {
  const dt = Date.now() - start;
  if (dt < 1000) return `${dt}ms`;
  return `${(dt / 1000).toFixed(1)}s`;
}

export async function runImports(results: DetectionResult[], season: number): Promise<void> {
  const queue = results.filter((r) => r.match && r.supersededBy === undefined);
  if (queue.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  let hitterImported = false;
  let pitcherImported = false;
  const classYearPairs: ClassYearPair[] = [];

  console.log(`\n${COLOR.bold}=== Imports ===${COLOR.reset}`);

  for (const r of queue) {
    if (!r.match) continue;
    const csvText = readFileSync(r.probe.filePath, "utf8");
    const startMs = Date.now();

    switch (r.match.type) {
      case "hitter_master": {
        step(`${r.probe.fileName} → Hitter Master`);
        try {
          const res = await importHistoricalHittersCsv(csvText, season);
          ok(`${res.inserted} inserted, ${res.skipped} skipped, ${res.errors.length} errors (${timeMs(startMs)})`);
          for (const e of res.errors.slice(0, 3)) err(e);
          if (res.errors.length > 3) warn(`...and ${res.errors.length - 3} more errors`);
          hitterImported = true;
        } catch (e) {
          err(`Importer threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        // Collect ClassYear pairs for post-process
        classYearPairs.push(...extractClassYears(csvText));
        break;
      }
      case "pitching_master": {
        step(`${r.probe.fileName} → Pitching Master`);
        try {
          const res = await importHistoricalPitchersCsv(csvText, season);
          ok(`${res.inserted} inserted, ${res.skipped} skipped, ${res.errors.length} errors (${timeMs(startMs)})`);
          for (const e of res.errors.slice(0, 3)) err(e);
          if (res.errors.length > 3) warn(`...and ${res.errors.length - 3} more errors`);
          pitcherImported = true;
        } catch (e) {
          err(`Importer threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        classYearPairs.push(...extractClassYears(csvText));
        break;
      }
      case "pitcher_stuff_inputs": {
        step(`${r.probe.fileName} → Stuff+ Inputs`);
        warn(`Phase C — Stuff+ Inputs importer not yet wired. Skipping.`);
        break;
      }
      default: {
        step(`${r.probe.fileName} → ${r.match.label}`);
        warn(`Importer for ${r.match.label} not yet wired (Phase D).`);
      }
    }
  }

  // Post-import enhancements
  if (pitcherImported) {
    step(`Derive Role from G/GS (threshold: GS/G >= ${SP_GS_RATIO_THRESHOLD} → SP)`);
    const startMs = Date.now();
    try {
      const res = await deriveRolesFromGGS(season);
      ok(`${res.updated} pitchers updated, ${res.errors.length} errors (${timeMs(startMs)})`);
      for (const e of res.errors.slice(0, 3)) err(e);
    } catch (e) {
      err(`Role derivation threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (classYearPairs.length > 0) {
    step(`Fill blank players.class_year from ClassYear column (${classYearPairs.length} pairs collected)`);
    const startMs = Date.now();
    try {
      const res = await updatePlayersClassYears(classYearPairs);
      ok(`${res.updated} blank class_years filled, ${res.errors.length} errors (${timeMs(startMs)})`);
      for (const e of res.errors.slice(0, 3)) err(e);
    } catch (e) {
      err(`ClassYear update threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Cascade
  if (!hitterImported && !pitcherImported) {
    console.log("\nNo master imports — skipping cascade.");
    return;
  }

  console.log(`\n${COLOR.bold}=== Pipeline cascade ===${COLOR.reset}`);

  step("syncMasterToPlayers");
  try {
    const start = Date.now();
    const res = await syncMasterToPlayers(season);
    ok(`hittersInserted=${res.hittersInserted}, pitchersInserted=${res.pitchersInserted}, errors=${res.errors.length} (${timeMs(start)})`);
    for (const e of res.errors.slice(0, 3)) err(e);
  } catch (e) {
    err(`Threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  step("addMissingPlayers");
  try {
    const start = Date.now();
    const res: any = await addMissingPlayers(season);
    const inserted = res?.inserted ?? res?.created ?? "?";
    const errors = res?.errors?.length ?? 0;
    ok(`inserted=${inserted}, errors=${errors} (${timeMs(start)})`);
    if (Array.isArray(res?.errors)) for (const e of res.errors.slice(0, 3)) err(e);
  } catch (e) {
    err(`Threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  step("createPredictionsFromMaster");
  try {
    const start = Date.now();
    const res: any = await createPredictionsFromMaster(season);
    const created = res?.created ?? res?.inserted ?? "?";
    const errors = res?.errors?.length ?? 0;
    ok(`created=${created}, errors=${errors} (${timeMs(start)})`);
    if (Array.isArray(res?.errors)) for (const e of res.errors.slice(0, 3)) err(e);
  } catch (e) {
    err(`Threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  step("computeAndStoreNcaaAverages");
  try {
    const start = Date.now();
    await computeAndStoreNcaaAverages(season);
    ok(`done (${timeMs(start)})`);
  } catch (e) {
    err(`Threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  step("computeAndStoreAllScores");
  try {
    const start = Date.now();
    await computeAndStoreAllScores(season);
    ok(`done (${timeMs(start)})`);
  } catch (e) {
    err(`Threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  step("bulkRecalculatePredictionsLocal");
  try {
    const start = Date.now();
    await bulkRecalculatePredictionsLocal(season);
    ok(`done (${timeMs(start)})`);
  } catch (e) {
    err(`Threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  console.log(`\n${COLOR.bold}=== Done ===${COLOR.reset}`);
}
