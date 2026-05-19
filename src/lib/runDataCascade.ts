/**
 * Data cascade — the canonical post-import recompute that keeps ncaa_averages,
 * scoring, predictions, conference rollups, and env-rates in sync with the
 * current Hitter Master / Pitching Master state.
 *
 * Run this after ANY data ingestion that changes 2026 Hitter/Pitching Master
 * rows or Stuff+ inputs (D1 imports, JUCO imports, conference stats imports,
 * etc.). The cascade also invalidates target_board.transfer_snapshot so that
 * stored projections can't outlive a refresh of their inputs.
 */
import { supabase } from "@/integrations/supabase/client";
import { addMissingPlayers } from "@/lib/syncMasterToPlayers";
import { computeAndStoreNcaaAverages } from "@/lib/computeNcaaAverages";
import { computeAndStoreAllScores } from "@/lib/computeAndStoreScores";
import { createPredictionsFromMaster } from "@/lib/createPredictionsFromMaster";
import { calculateConferenceStuffPlus } from "@/savant/lib/conferenceStuffPlus";
import { computeConferenceEnvRates } from "@/lib/importConferenceStats";
import { bulkRecalculatePredictionsLocal } from "@/lib/predictionEngine";

export interface CascadeReport {
  steps: Array<{ name: string; ms: number; ok: boolean; note?: string }>;
  errors: string[];
  totalMs: number;
}

export interface RunDataCascadeOptions {
  season: number;
  /** Invalidate stored target_board snapshots so they re-compute on next view. Default true. */
  invalidateTargetBoardSnapshots?: boolean;
  /** Pipe progress lines to this logger. Default console.log. */
  log?: (line: string) => void;
}

export async function runDataCascade(opts: RunDataCascadeOptions): Promise<CascadeReport> {
  const { season, invalidateTargetBoardSnapshots = true, log = (l) => console.log(l) } = opts;
  const start = Date.now();
  const report: CascadeReport = { steps: [], errors: [], totalMs: 0 };

  async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
    const s = Date.now();
    log(`\n→ ${name}`);
    try {
      await fn();
      const ms = Date.now() - s;
      log(`  ✓ done (${(ms / 1000).toFixed(1)}s)`);
      report.steps.push({ name, ms, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`  ✗ ${msg}`);
      report.steps.push({ name, ms: Date.now() - s, ok: false, note: msg });
      report.errors.push(`${name}: ${msg}`);
    }
  }

  await step("addMissingPlayers", () => addMissingPlayers(season));
  await step("computeAndStoreNcaaAverages", () => computeAndStoreNcaaAverages(season));
  await step("computeAndStoreAllScores", () => computeAndStoreAllScores(season));
  await step("createPredictionsFromMaster", () => createPredictionsFromMaster(season));
  await step("calculateConferenceStuffPlus", () => calculateConferenceStuffPlus(season));
  await step("computeConferenceEnvRates", () => computeConferenceEnvRates(season));
  await step("bulkRecalculatePredictionsLocal", () => bulkRecalculatePredictionsLocal(season));

  if (invalidateTargetBoardSnapshots) {
    await step("Invalidate target_board snapshots (force re-snapshot on next view)", async () => {
      const { error } = await (supabase as any)
        .from("target_board")
        .update({ transfer_snapshot: null })
        .not("transfer_snapshot", "is", null);
      if (error) throw error;
    });
  }

  report.totalMs = Date.now() - start;
  log(`\n✓ Cascade complete in ${(report.totalMs / 1000).toFixed(1)}s${report.errors.length > 0 ? ` (${report.errors.length} errors)` : ""}`);
  return report;
}
