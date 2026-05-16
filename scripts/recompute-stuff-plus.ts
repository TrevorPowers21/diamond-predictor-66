#!/usr/bin/env node
/**
 * Re-run the Stuff+ pipeline against existing pitcher_stuff_plus_inputs rows.
 * No CSV upload needed — useful when the classification rules or equation
 * weights change but the raw TrackMan data is the same.
 *
 * Order of operations (same as the CSV import cascade):
 *   1. runVeloDiffPipeline           → recomputes fb_ch_velo_diff
 *   2. runBreakingBallReclassification → re-applies the gyro/curveball/sweeper/slider classifier
 *   3. runStuffPlusPipeline           → recomputes per-pitch stuff_plus
 *   4. rollupStuffPlusToMaster        → aggregates to Pitching Master.stuff_plus
 *   5. (optional) refresh NCAA averages + scores + predictions
 *
 * Steps 1-4 are the "Stuff+ recompute"; step 5 propagates the new stuff_plus
 * into downstream projections. Default behavior runs all 5; --stuff-only
 * stops after step 4.
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { runVeloDiffPipeline } from "../src/savant/lib/veloDiffPipeline.ts";
import { runBreakingBallReclassification } from "../src/savant/lib/breakingBallReclassification.ts";
import { runStuffPlusPipeline } from "../src/savant/lib/stuffPlusEngine.ts";
import { rollupStuffPlusToMaster } from "../src/savant/lib/rollupStuffPlusToMaster.ts";
import { computeAndStoreNcaaAverages } from "../src/lib/computeNcaaAverages.ts";
import { computeAndStoreAllScores } from "../src/lib/computeAndStoreScores.ts";
import { bulkRecalculatePredictionsLocal } from "../src/lib/predictionEngine.ts";

const CURRENT_SEASON = 2026;
const PROD_CONFIRM_PHRASE = "yes-promote-to-prod";

type CliArgs = {
  season: number;
  prod: boolean;
  yes: boolean;
  stuffOnly: boolean;
};

const COLOR = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
};

function step(line: string): void { console.log(`\n${COLOR.bold}→${COLOR.reset} ${line}`); }
function ok(line: string): void { console.log(`  ${COLOR.green}✓${COLOR.reset} ${line}`); }
function err(line: string): void { console.log(`  ${COLOR.red}✗${COLOR.reset} ${line}`); }
function timeMs(start: number): string {
  const dt = Date.now() - start;
  if (dt < 1000) return `${dt}ms`;
  return `${(dt / 1000).toFixed(1)}s`;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { season: CURRENT_SEASON, prod: false, yes: false, stuffOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--season" && argv[i + 1]) {
      args.season = Number(argv[++i]);
    } else if (a === "--prod") {
      args.prod = true;
    } else if (a === "--yes" || a === "-y") {
      args.yes = true;
    } else if (a === "--stuff-only") {
      args.stuffOnly = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`
Re-run the Stuff+ pipeline against existing pitcher_stuff_plus_inputs rows.
No CSV upload required.

Usage:
  npm run recompute-stuff [-- --season 2026]
  npm run recompute-stuff:prod  (production — requires typed confirmation)

Options:
  --season <year>  Season to recompute (default: ${CURRENT_SEASON}).
  --prod           Run against production Supabase. Requires typed phrase.
  --yes, -y        Skip standard confirmation prompt (NOT bypass --prod guard).
  --stuff-only     Stop after Stuff+ rollup. Skip NCAA averages + scores +
                   predictions cascade. Faster when you just want to see
                   updated per-pitch Stuff+ values.
  --help           Show this message.

Environments:
  npm run recompute-stuff       → reads .env.local (staging)
  npm run recompute-stuff:prod  → reads .env.production.local (production)
`);
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(prompt);
    return /^y(es)?$/i.test(answer.trim());
  } finally { rl.close(); }
}

async function confirmExactPhrase(prompt: string, expected: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim() === expected;
  } finally { rl.close(); }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL || "(unset)";

  console.log("");
  console.log(`${COLOR.bold}Stuff+ pipeline recompute — season ${args.season}${COLOR.reset}`);
  console.log(`Target: ${url}`);
  console.log("");

  if (args.prod) {
    console.log(`${COLOR.yellow}⚠  PRODUCTION MODE${COLOR.reset} — this will write to your live Supabase.`);
    console.log("");
    const ok = await confirmExactPhrase(
      `Type "${PROD_CONFIRM_PHRASE}" to proceed (anything else aborts): `,
      PROD_CONFIRM_PHRASE,
    );
    if (!ok) {
      console.log("Aborted — production write not confirmed.");
      process.exit(0);
    }
  } else if (!args.yes) {
    const proceed = await confirm("Proceed? [y/N] ");
    if (!proceed) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  console.log(`\n${COLOR.bold}=== Stuff+ pipeline ===${COLOR.reset}`);

  // Step 1 — velo-diff
  step("Compute velo-diff (FB / CH gap per hand)");
  {
    const start = Date.now();
    try {
      const { report, errors } = await runVeloDiffPipeline(args.season);
      const written = (report as any)?.written ?? "?";
      ok(`${written} rows updated, ${errors.length} errors (${timeMs(start)})`);
      for (const e of errors.slice(0, 3)) err(e);
    } catch (e) {
      err(`Velo-diff threw: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }

  // Step 2 — reclassify
  step("Reclassify breaking balls (Cutter / Gyro / Slider / Sweeper / Curveball)");
  {
    const start = Date.now();
    try {
      const { report, errors } = await runBreakingBallReclassification(args.season);
      const written = report.consolidatedRowsProduced ?? "?";
      ok(`${written} rows produced from ${report.totalPulled ?? "?"} pulled, ${errors.length} errors (${timeMs(start)})`);
      for (const e of errors.slice(0, 3)) err(e);
    } catch (e) {
      err(`Reclassification threw: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }

  // Step 3 — Stuff+ engine
  step("Compute per-pitch Stuff+ scores");
  {
    const start = Date.now();
    try {
      const { report, errors } = await runStuffPlusPipeline(args.season);
      const written = (report as any)?.written ?? "?";
      ok(`${written} pitches scored, ${errors.length} errors (${timeMs(start)})`);
      for (const e of errors.slice(0, 3)) err(e);
    } catch (e) {
      err(`Stuff+ engine threw: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }

  // Step 4 — rollup
  step("Rollup Stuff+ to Pitching Master.stuff_plus");
  {
    const start = Date.now();
    try {
      const { report, errors } = await rollupStuffPlusToMaster(args.season);
      ok(`${report.pitchersUpdated} pitchers updated (${report.pitchersSkipped} skipped — no Pitching Master row), ${errors.length} errors (${timeMs(start)})`);
      for (const e of errors.slice(0, 3)) err(e);
    } catch (e) {
      err(`Stuff+ rollup threw: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    }
  }

  if (args.stuffOnly) {
    console.log(`\n${COLOR.bold}=== Done (--stuff-only) ===${COLOR.reset}`);
    console.log("Skipped: NCAA averages, scores, predictions. Pitcher projections will use stale stuff_plus until cascade runs.");
    process.exit(0);
  }

  console.log(`\n${COLOR.bold}=== Downstream cascade ===${COLOR.reset}`);

  step("computeAndStoreNcaaAverages");
  {
    const start = Date.now();
    try {
      await computeAndStoreNcaaAverages(args.season);
      ok(`done (${timeMs(start)})`);
    } catch (e) {
      err(`NCAA averages threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  step("computeAndStoreAllScores");
  {
    const start = Date.now();
    try {
      await computeAndStoreAllScores(args.season);
      ok(`done (${timeMs(start)})`);
    } catch (e) {
      err(`Compute scores threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  step("bulkRecalculatePredictionsLocal");
  {
    const start = Date.now();
    try {
      await bulkRecalculatePredictionsLocal(args.season);
      ok(`done (${timeMs(start)})`);
    } catch (e) {
      err(`Bulk recalc threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\n${COLOR.bold}=== Done ===${COLOR.reset}`);
  process.exit(0);
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("SUPABASE_URL") || msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    console.error("\n✗ Supabase credentials missing. Create .env.local (staging) or .env.production.local (prod) with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  console.error("Fatal:", e);
  process.exit(1);
});
