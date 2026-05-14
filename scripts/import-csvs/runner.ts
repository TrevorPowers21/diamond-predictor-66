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

type ClassYearPair = { sourcePlayerId: string; classYear: string };

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
    const classYear = cols[classIdx];
    if (sourcePlayerId && classYear) {
      out.push({ sourcePlayerId, classYear: classYear.trim().toUpperCase() });
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

  const BATCH = 200;
  const entries = [...dedup.entries()];
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH);
    for (const [sourcePlayerId, classYear] of chunk) {
      const { error } = await supabase
        .from("players")
        .update({ class_year: classYear })
        .eq("source_player_id", sourcePlayerId);
      if (error) {
        result.errors.push(`${sourcePlayerId}: ${error.message}`);
      } else {
        result.updated++;
      }
    }
  }
  return result;
}

async function deriveRolesFromGGS(season: number): Promise<{ updated: number; errors: string[] }> {
  const result = { updated: 0, errors: [] as string[] };

  let from = 0;
  const pageSize = 1000;
  const updates: Array<{ sourcePlayerId: string; role: "SP" | "RP" }> = [];

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
        updates.push({ sourcePlayerId: sid, role: derived });
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  for (const u of updates) {
    const { error } = await supabase
      .from("Pitching Master")
      .update({ Role: u.role })
      .eq("source_player_id", u.sourcePlayerId)
      .eq("Season", season);
    if (error) {
      result.errors.push(`${u.sourcePlayerId}: ${error.message}`);
    } else {
      result.updated++;
    }
  }

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
    step(`Update players.class_year from ClassYear column (${classYearPairs.length} pairs collected)`);
    const startMs = Date.now();
    try {
      const res = await updatePlayersClassYears(classYearPairs);
      ok(`${res.updated} players updated, ${res.errors.length} errors (${timeMs(startMs)})`);
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
