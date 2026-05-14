#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { homedir } from "node:os";

import { probeCsv } from "./csv.ts";
import { detect, inferSeasonFromName } from "./detector.ts";
import { renderPreview } from "./preview.ts";

const DEFAULT_INBOX = join(homedir(), "RSTR IQ Data", "inbox");
const CURRENT_SEASON = 2026;

type CliArgs = {
  inbox: string;
  season: number;
  yes: boolean;
  dryRun: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    inbox: DEFAULT_INBOX,
    season: CURRENT_SEASON,
    yes: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--inbox" && argv[i + 1]) {
      args.inbox = argv[++i];
    } else if (a === "--season" && argv[i + 1]) {
      args.season = Number(argv[++i]);
    } else if (a === "--yes" || a === "-y") {
      args.yes = true;
    } else if (a === "--dry-run") {
      args.dryRun = true;
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
RSTR IQ CSV importer

Usage:
  npm run import [-- --inbox <path>] [--season <year>] [--yes] [--dry-run]

Options:
  --inbox <path>   Folder to scan for CSVs (default: ~/RSTR IQ Data/inbox)
  --season <year>  Season to import into (default: ${CURRENT_SEASON}). Per-file override from filename.
  --dry-run        Show detection + pipeline plan, exit without prompting.
  --yes, -y        Skip confirmation prompt.
  --help           Show this message.
`);
}

function listCsvFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    console.error(`Cannot read inbox: ${dir}`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  return entries
    .filter((e) => e.toLowerCase().endsWith(".csv"))
    .filter((e) => !e.startsWith("."))
    .map((e) => join(dir, e))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(prompt);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = listCsvFiles(args.inbox);
  const results = files.map((f) => {
    const probe = probeCsv(f);
    return detect(probe);
  });

  // Per-file season inference (filename override beats CLI default)
  const perFileSeasons = new Map<string, number>();
  for (const r of results) {
    perFileSeasons.set(r.probe.filePath, inferSeasonFromName(r.probe.fileName, args.season));
  }
  // For display we show the user-provided season; per-file overrides happen at import time
  const displaySeason = args.season;

  process.stdout.write(renderPreview({ results, season: displaySeason, inboxPath: args.inbox }));

  // Future: show per-file season override if it differs from --season
  const overrides = [...perFileSeasons.entries()].filter(([, yr]) => yr !== args.season);
  if (overrides.length > 0) {
    console.log(`\nSeason overrides inferred from filename:`);
    for (const [path, yr] of overrides) {
      const name = path.split("/").pop();
      console.log(`  • ${name} → season ${yr}`);
    }
    console.log("");
  }

  const importable = results.filter((r) => r.match);
  if (importable.length === 0) {
    console.log("Nothing to import. Drop CSVs in the inbox and re-run.");
    process.exit(0);
  }

  if (args.dryRun) {
    console.log(`Dry run — no changes made. Re-run without --dry-run to import.`);
    process.exit(0);
  }

  if (!args.yes) {
    const ok = await confirm("Proceed? [y/N] ");
    if (!ok) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  console.log(`\n${importable.length} file${importable.length === 1 ? "" : "s"} queued for import.`);
  console.log("Phase B will wire the actual imports — for now this is a no-op.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
