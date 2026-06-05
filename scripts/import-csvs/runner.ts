import { readFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";

import { importHistoricalHittersCsv } from "@/lib/importHistoricalHitters";
import { importHistoricalPitchersCsv } from "@/lib/importHistoricalPitchers";
import { importStuffPlusInputsCsv } from "@/lib/importStuffPlusInputsCsv";
import { importConferenceStatsCsv, computeConferenceEnvRates } from "@/lib/importConferenceStats";
import { importPortalEntriesCsv } from "@/lib/importPortalEntries";
import { importAbsHitterStatsCsv, importAbsPitcherStatsCsv } from "@/lib/importAbsStats";
import { calculateConferenceStuffPlus } from "@/savant/lib/conferenceStuffPlus";
import { addMissingPlayers } from "@/lib/syncMasterToPlayers";
import { createPredictionsFromMaster } from "@/lib/createPredictionsFromMaster";
import { computeAndStoreNcaaAverages } from "@/lib/computeNcaaAverages";
import { computeAndStoreAllScores } from "@/lib/computeAndStoreScores";
import { bulkRecalculatePredictionsLocal } from "@/lib/predictionEngine";
import { rollupStuffPlusToMaster } from "@/savant/lib/rollupStuffPlusToMaster";
import { runVeloDiffPipeline } from "@/savant/lib/veloDiffPipeline";
import { runBreakingBallReclassification } from "@/savant/lib/breakingBallReclassification";
import { runStuffPlusPipeline } from "@/savant/lib/stuffPlusEngine";
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

export async function runImports(
  results: DetectionResult[],
  season: number,
  keepFiles: boolean = false,
): Promise<void> {
  const queue = results.filter((r) => r.match && r.supersededBy === undefined);
  if (queue.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  let hitterImported = false;
  let pitcherImported = false;
  let stuffInputsImported = false;
  let conferenceImported = false;
  const stuffInputsImports: Array<{ file: string; pitchType: string; hand: string; inserted: number; deleted: number }> = [];
  const classYearPairs: ClassYearPair[] = [];
  // Files that imported successfully — archived to imported/<date>/ after the
  // cascade completes (unless --keep-files was passed). Failed files stay in
  // the inbox so the next run will pick them up to retry.
  const importedFilePaths: string[] = [];

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
          if (res.inserted > 0) importedFilePaths.push(r.probe.filePath);
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
          if (res.inserted > 0) importedFilePaths.push(r.probe.filePath);
        } catch (e) {
          err(`Importer threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        classYearPairs.push(...extractClassYears(csvText));
        break;
      }
      case "pitcher_stuff_inputs": {
        step(`${r.probe.fileName} → Stuff+ Inputs`);
        try {
          // Filename is the source of truth for pitch_type + hand.
          // No "Pitch Type" column needed in the CSV — TruMedia's per-pitch
          // export doesn't include one, and we used to add it manually.
          const res = await importStuffPlusInputsCsv(csvText, season, r.probe.fileName);
          if (res.errors.length > 0) {
            for (const e of res.errors.slice(0, 3)) err(e);
            if (res.errors.length > 3) warn(`...and ${res.errors.length - 3} more errors`);
          }
          for (const w of res.warnings) warn(w);
          if (res.inserted > 0) {
            ok(`${res.pitchType} / ${res.hand}: ${res.deleted} replaced, ${res.inserted} inserted (${timeMs(startMs)})`);
            stuffInputsImports.push({ file: r.probe.fileName, pitchType: res.pitchType, hand: res.hand, inserted: res.inserted, deleted: res.deleted });
            stuffInputsImported = true;
            importedFilePaths.push(r.probe.filePath);
          }
        } catch (e) {
          err(`Stuff+ importer threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        break;
      }
      case "portal_entries":
      case "portal_commits":
      case "portal_withdrawals": {
        const mode = r.match.type === "portal_commits" ? "commits"
                   : r.match.type === "portal_withdrawals" ? "withdrawals"
                   : "entries";
        const label = mode === "commits" ? "Portal Commits"
                    : mode === "withdrawals" ? "Portal Withdrawals"
                    : "Portal Entries";
        step(`${r.probe.fileName} → ${label}`);
        try {
          const res = await importPortalEntriesCsv(csvText, mode);
          ok(`${res.matched} matched (${res.committed} committed, ${res.withdrawn} withdrawn, ${res.manualOverrideHeld} manual-held), ${res.unmatched} unmatched, ${res.arrived} arrived (cleared), ${res.staleSkipped} stale-skipped (${timeMs(startMs)})`);
          console.log(`  ${COLOR.dim}total CSV rows: ${res.totalRows}, D1 rows: ${res.d1Rows}${COLOR.reset}`);
          for (const e of res.errors.slice(0, 3)) err(e);
          if (res.errors.length > 3) warn(`...and ${res.errors.length - 3} more errors`);
          if (res.matched > 0 || res.unmatched > 0) importedFilePaths.push(r.probe.filePath);
        } catch (e) {
          err(`Portal importer threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        break;
      }
      case "conference_stats": {
        step(`${r.probe.fileName} → Conference Stats`);
        try {
          const res = await importConferenceStatsCsv(csvText, season);
          ok(`${res.updated} updated, ${res.skipped} skipped (${timeMs(startMs)})`);
          if (res.unknownAbbrevs.length > 0) {
            warn(`Unknown conference abbrevs (no DB row for season ${season}): ${res.unknownAbbrevs.join(", ")}`);
          }
          for (const e of res.errors.slice(0, 3)) err(e);
          if (res.errors.length > 3) warn(`...and ${res.errors.length - 3} more errors`);
          if (res.updated > 0) {
            conferenceImported = true;
            importedFilePaths.push(r.probe.filePath);
          }
        } catch (e) {
          err(`Conference Stats importer threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        break;
      }
      case "abs_hitter_stats": {
        step(`${r.probe.fileName} → ABS Hitter Stats`);
        try {
          const res = await importAbsHitterStatsCsv(csvText, season);
          ok(`${res.upserted} upserted (${res.d1Rows} D1 rows, ${res.jucoSkipped} JUCO skipped, ${res.missingSourceId} missing id) (${timeMs(startMs)})`);
          for (const e of res.errors.slice(0, 3)) err(e);
          if (res.errors.length > 3) warn(`...and ${res.errors.length - 3} more errors`);
          if (res.upserted > 0) importedFilePaths.push(r.probe.filePath);
        } catch (e) {
          err(`ABS hitter importer threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        break;
      }
      case "abs_pitcher_stats": {
        step(`${r.probe.fileName} → ABS Pitcher Stats`);
        try {
          const res = await importAbsPitcherStatsCsv(csvText, season);
          ok(`${res.upserted} upserted (${res.d1Rows} D1 rows, ${res.jucoSkipped} JUCO skipped, ${res.missingSourceId} missing id) (${timeMs(startMs)})`);
          for (const e of res.errors.slice(0, 3)) err(e);
          if (res.errors.length > 3) warn(`...and ${res.errors.length - 3} more errors`);
          if (res.upserted > 0) importedFilePaths.push(r.probe.filePath);
        } catch (e) {
          err(`ABS pitcher importer threw: ${e instanceof Error ? e.message : String(e)}`);
        }
        break;
      }
      default: {
        step(`${r.probe.fileName} → ${r.match.label}`);
        warn(`Importer for ${r.match.label} not yet wired (Phase D).`);
      }
    }
  }

  // Stuff+ pipeline cascade — runs when Stuff+ Inputs were imported this run.
  // Order matters: imports already happened in the case block above, here we
  // chain the per-pitch math:
  //   1. velo-diff (FB-CH gap, used by offspeed/breaking ball equations)
  //   2. breaking-ball reclassification (assigns rstr_pitch_class on movement)
  //   3. Stuff+ engine (computes per-pitch stuff_plus scores)
  //   4. rollup to Pitching Master.stuff_plus (pitch-weighted per-pitcher avg)
  // If Stuff+ Inputs were NOT touched but Pitching Master WAS, we still want
  // the rollup at the end to restore Pitching Master.stuff_plus (the master
  // CSV's delete-and-insert wipes the column; rollup re-aggregates from the
  // intact pitcher_stuff_plus_inputs).
  if (stuffInputsImported) {
    console.log(`\n${COLOR.bold}=== Stuff+ pipeline ===${COLOR.reset}`);

    step(`Compute velo-diff (FB / CH gap per hand)`);
    {
      const startMs = Date.now();
      try {
        const { report, errors } = await runVeloDiffPipeline(season);
        const written = (report as any)?.written ?? (report as any)?.rowsWritten ?? "?";
        ok(`${written} rows updated, ${errors.length} errors (${timeMs(startMs)})`);
        for (const e of errors.slice(0, 3)) err(e);
      } catch (e) {
        err(`Velo-diff threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    step(`Reclassify breaking balls (Gyro Slider / Slider / Sweeper / Curveball)`);
    {
      const startMs = Date.now();
      try {
        const { report, errors } = await runBreakingBallReclassification(season);
        const written = report.consolidatedRowsProduced ?? report.totalPulled ?? "?";
        ok(`${written} rows produced from ${report.totalPulled ?? "?"} pulled, ${errors.length} errors (${timeMs(startMs)})`);
        for (const e of errors.slice(0, 3)) err(e);
      } catch (e) {
        err(`Reclassification threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    step(`Compute per-pitch Stuff+ scores`);
    {
      const startMs = Date.now();
      try {
        const { report, errors } = await runStuffPlusPipeline(season);
        const written = (report as any)?.written ?? (report as any)?.rowsWritten ?? "?";
        ok(`${written} pitches scored, ${errors.length} errors (${timeMs(startMs)})`);
        for (const e of errors.slice(0, 3)) err(e);
      } catch (e) {
        err(`Stuff+ engine threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Rollup Pitching Master.stuff_plus — runs whenever either Stuff+ Inputs OR
  // Pitching Master was imported. After Stuff+ Inputs: rolls up freshly-
  // computed per-pitch scores. After Pitching Master alone: restores the
  // column from the unchanged pitcher_stuff_plus_inputs table (master CSV's
  // delete-and-insert wipes stuff_plus on every import).
  if (stuffInputsImported || pitcherImported) {
    step("Rollup Stuff+ to Pitching Master.stuff_plus");
    const startMs = Date.now();
    try {
      const { report, errors } = await rollupStuffPlusToMaster(season);
      ok(`${report.pitchersUpdated} pitchers updated (${report.pitchersSkipped} skipped — no Pitching Master row), ${errors.length} errors (${timeMs(startMs)})`);
      for (const e of errors.slice(0, 3)) err(e);
    } catch (e) {
      err(`Stuff+ rollup threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Post-import enhancement: derive Role from G/GS. Writes to Pitching Master
  // rows (not players), so this can run before the player-touching cascade.
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

  // Cascade — runs whenever any data that feeds projections changed.
  // Stuff+ Inputs alone justify a recalc (per-pitch stuff_plus → Pitching
  // Master.stuff_plus → projection equation reads it for transfer/returner
  // pitcher projections).
  if (!hitterImported && !pitcherImported && !stuffInputsImported && !conferenceImported) {
    console.log("\nNo master, Stuff+, or conference imports — skipping cascade.");
    return;
  }

  console.log(`\n${COLOR.bold}=== Pipeline cascade ===${COLOR.reset}`);

  // Skip syncMasterToPlayers in the routine CLI cascade. It DELETEs every row
  // in the players table and re-inserts with fresh UUIDs, which cascade-deletes
  // every player_predictions row (including coach-curated target-board entries
  // and portal-sim transfer projections). addMissingPlayers below is non-
  // destructive — it only inserts source_player_ids that aren't already in
  // the players table — so player UUIDs stay stable across imports and
  // predictions/target_board/high_follow FKs remain valid. The full sync
  // (metadata refresh, team reassignment, TWP redetection) is still available
  // via the AdminDashboard "Sync Master" button for when it's actually needed.
  //
  // Cascade order matters: NCAA averages + Compute Scores must populate
  // Hitter/Pitching Master's power-rating columns BEFORE createPredictionsFromMaster
  // reads them (line 64 of createPredictionsFromMaster.ts: "Read
  // ba_power_rating/obp_power_rating/iso_power_rating directly (already computed by Compute Scores)").
  // Otherwise internals get null power_ratings → bulkRecalc returns null
  // p_avg/p_obp/p_slg/p_wrc_plus → hitter projections blank everywhere.
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

  // Conference rollups — refresh per-conf Stuff+ (from rolled-up per-pitcher
  // stuff_plus) and env-rate plusses (from fresh NCAA averages). Runs before
  // bulkRecalc so projection math sees the latest conference data.
  if (conferenceImported || pitcherImported || stuffInputsImported) {
    step("calculateConferenceStuffPlus (rollup → Conference Stats.Stuff_plus)");
    try {
      const start = Date.now();
      const { report, errors } = await calculateConferenceStuffPlus(season);
      ok(`${report.written} conferences updated, ${errors.length} errors (${timeMs(start)})`);
      for (const e of errors.slice(0, 3)) err(e);
    } catch (e) {
      err(`Threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (conferenceImported || hitterImported) {
    step("computeConferenceEnvRates (ba_plus/obp_plus/iso_plus/slg_plus)");
    try {
      const start = Date.now();
      const res = await computeConferenceEnvRates(season);
      ok(`${res.updated} updated, ${res.skipped} skipped, ${res.errors.length} errors (${timeMs(start)})`);
      for (const e of res.errors.slice(0, 3)) err(e);
    } catch (e) {
      err(`Threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  step("bulkRecalculatePredictionsLocal");
  try {
    const start = Date.now();
    await bulkRecalculatePredictionsLocal(season);
    ok(`done (${timeMs(start)})`);
  } catch (e) {
    err(`Threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Invalidate target_board snapshots — projection inputs just changed, so the
  // stored snapshots are stale. Null them out so TB recomputes fresh on next view.
  step("Invalidate target_board snapshots");
  try {
    const start = Date.now();
    const { error } = await (supabase as any)
      .from("target_board")
      .update({ transfer_snapshot: null })
      .not("transfer_snapshot", "is", null);
    if (error) throw error;
    ok(`snapshots cleared (${timeMs(start)})`);
  } catch (e) {
    err(`Threw: ${e instanceof Error ? e.message : String(e)}`);
  }

  // ClassYear blank-fill runs LAST so the writes survive any player-touching
  // step in the cascade above (the previous order had it before addMissingPlayers
  // and syncMasterToPlayers, so the writes got wiped immediately by syncMaster's
  // table-clear).
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

  // Archive successfully-imported files out of the inbox so the next run
  // doesn't re-pick them up. Failed files stay put for retry. Skipped via
  // --keep-files flag for cases where you want to re-run on the same files
  // (e.g., testing pipeline changes without re-exporting from TruMedia).
  if (!keepFiles && importedFilePaths.length > 0) {
    console.log(`\n${COLOR.bold}=== Archive ===${COLOR.reset}`);
    const inboxParent = dirname(importedFilePaths[0]);
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const archiveRoot = join(dirname(inboxParent), "imported", today);
    try {
      mkdirSync(archiveRoot, { recursive: true });
    } catch (e) {
      err(`Could not create archive folder ${archiveRoot}: ${e instanceof Error ? e.message : String(e)}`);
    }
    let moved = 0;
    let failed = 0;
    for (const src of importedFilePaths) {
      const dest = join(archiveRoot, basename(src));
      try {
        // Avoid clobber — if dest already exists (re-run on same day), append a counter.
        let target = dest;
        let counter = 1;
        while (existsSync(target)) {
          const ext = target.match(/\.[^.]+$/)?.[0] ?? "";
          const stem = target.slice(0, target.length - ext.length);
          target = `${stem.replace(/ \(\d+\)$/, "")} (${counter})${ext}`;
          counter += 1;
          if (counter > 99) break; // sanity guard
        }
        renameSync(src, target);
        moved += 1;
      } catch (e) {
        failed += 1;
        err(`Could not archive ${basename(src)}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    ok(`${moved} files moved to ${archiveRoot}${failed > 0 ? ` (${failed} failed — left in inbox)` : ""}`);
  } else if (keepFiles && importedFilePaths.length > 0) {
    console.log(`\n--keep-files: ${importedFilePaths.length} processed files left in inbox.`);
  }

  console.log(`\n${COLOR.bold}=== Done ===${COLOR.reset}`);
}
