#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { join } from "node:path";
import { homedir } from "node:os";

import { runJucoImport } from "./runner.ts";
import { runDataCascade } from "@/lib/runDataCascade";

const DEFAULT_DIR = join(homedir(), "RSTR IQ Data", "juco-exploration");
const CURRENT_SEASON = 2026;
const PROD_CONFIRM_PHRASE = "yes-juco-to-prod";

type CliArgs = {
  dir: string;
  season: number;
  write: boolean;
  prod: boolean;
  yes: boolean;
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

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dir: DEFAULT_DIR,
    season: CURRENT_SEASON,
    write: false,
    prod: false,
    yes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" && argv[i + 1]) args.dir = argv[++i];
    else if (a === "--season" && argv[i + 1]) args.season = Number(argv[++i]);
    else if (a === "--write") args.write = true;
    else if (a === "--prod") { args.prod = true; args.write = true; }
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else { console.error(`Unknown arg: ${a}`); printHelp(); process.exit(1); }
  }
  return args;
}

function printHelp(): void {
  console.log(`
JUCO importer — bulk-ingest NJCAA D1 data from juco-exploration folder

Usage:
  npm run import-juco                  Dry run against staging (no writes)
  npm run import-juco -- --write       Actually write to staging
  npm run import-juco:prod -- --write  Write to production (requires typed confirmation)

Options:
  --dir <path>     Source folder (default: ~/RSTR IQ Data/juco-exploration)
  --season <year>  Season to import into (default: ${CURRENT_SEASON})
  --write          Actually write to Supabase (default: dry-run)
  --prod           Use production env + require typed confirmation phrase
  --yes, -y        Skip the "proceed?" prompt for staging writes
  --help           Show this message

Environments:
  npm run import-juco       → .env.local (staging)
  npm run import-juco:prod  → .env.production.local (prod, with typed-phrase guard)

What it does (in order):
  1. Scan folder, classify 19 hitter region + 19 pitcher region + 16 per-pitch CSVs
  2. Upsert 158 unique teams into Teams Table (division=NJCAA_D1)
  3. Upsert 5,170 unique players into players (division=NJCAA_D1)
  4. Upsert Hitter Master rows where PA > 0 (drop ghost rows)
  5. Upsert Pitching Master rows where IP > 0 (drop ghost rows)
  6. Replace pitcher_stuff_plus_inputs rows for JUCO scope

After this completes successfully, run \`npm run recompute-stuff\` to cascade
through the Stuff+ engine + NCAA averages + scores + predictions.
`);
}

async function confirmExactPhrase(prompt: string, expected: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim() === expected;
  } finally { rl.close(); }
}

async function confirmYesNo(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(prompt);
    return /^y(es)?$/i.test(answer.trim());
  } finally { rl.close(); }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.SUPABASE_URL || "(unset)";

  console.log("");
  console.log(`${COLOR.bold}JUCO Import — season ${args.season}${COLOR.reset}`);
  console.log(`Source:  ${args.dir}`);
  console.log(`Target:  ${url}`);
  console.log(`Mode:    ${args.write ? "WRITE" : "DRY-RUN"}${args.prod ? " (PROD)" : ""}`);
  console.log("");

  if (args.write && args.prod) {
    console.log(`${COLOR.yellow}⚠  PRODUCTION MODE${COLOR.reset} — this will write to live Supabase.`);
    const ok = await confirmExactPhrase(
      `Type "${PROD_CONFIRM_PHRASE}" to proceed (anything else aborts): `,
      PROD_CONFIRM_PHRASE,
    );
    if (!ok) { console.log("Aborted — prod write not confirmed."); process.exit(0); }
  } else if (args.write && !args.yes) {
    const proceed = await confirmYesNo("Proceed with WRITE to staging? [y/N] ");
    if (!proceed) { console.log("Aborted."); process.exit(0); }
  }

  step(args.write ? "Importing JUCO data" : "Scanning JUCO data (dry-run)");

  const start = Date.now();
  try {
    const report = await runJucoImport(args.dir, args.season, args.write);
    const dt = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`\n${COLOR.bold}=== Report (${dt}s) ===${COLOR.reset}`);
    console.log(`Files scanned:           ${report.filesScanned}`);
    console.log(`Teams ${args.write ? "upserted" : "to upsert"}:        ${report.teamsUpserted}`);
    console.log(`Players ${args.write ? "upserted" : "to upsert"}:      ${report.playersUpserted}`);
    console.log(`Hitter Master ${args.write ? "rows" : "rows to write"}:  ${report.hitterMasterUpserted}`);
    console.log(`Pitching Master ${args.write ? "rows" : "rows to write"}: ${report.pitchingMasterUpserted}`);
    console.log(`Stuff+ per-pitch ${args.write ? "rows" : "rows to write"}: ${report.stuffPlusUpserted}`);

    // Distinguish skip warnings (non-region files, harmless) from real errors.
    const skips = report.errors.filter((e) => /^Skip /.test(e));
    const fatal = report.errors.filter((e) => !/^Skip /.test(e));
    if (skips.length > 0) {
      console.log(`\n${COLOR.yellow}Skipped (${skips.length} non-region files — harmless):${COLOR.reset}`);
      for (const e of skips.slice(0, 5)) console.log(`  · ${e}`);
      if (skips.length > 5) console.log(`  ...and ${skips.length - 5} more`);
    }
    if (fatal.length > 0) {
      console.log(`\n${COLOR.red}Errors (${fatal.length}):${COLOR.reset}`);
      for (const e of fatal.slice(0, 20)) err(e);
      if (fatal.length > 20) console.log(`  ...and ${fatal.length - 20} more`);
      process.exit(1);
    }

    ok("Import done");

    if (args.write) {
      // Auto-run the data cascade so ncaa_averages, scoring, conference Stuff+,
      // env-rates, predictions, and target_board snapshots all reflect the
      // freshly-imported JUCO state. Without this, projections for JUCO players
      // (and any conference whose stats moved) silently stay stale.
      console.log(`\n${COLOR.bold}=== Cascade ===${COLOR.reset}`);
      const report = await runDataCascade({ season: args.season });
      if (report.errors.length > 0) {
        console.log(`\n${COLOR.red}Cascade errors (${report.errors.length}):${COLOR.reset}`);
        for (const e of report.errors.slice(0, 10)) err(e);
        process.exit(1);
      }
    }
    process.exit(0);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    err(`Fatal: ${msg}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
