#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { homedir } from "node:os";

import { probeCsv } from "./csv.ts";
import { detect, dedupeResults, inferSeasonFromName } from "./detector.ts";
import { renderPreview } from "./preview.ts";

const DEFAULT_INBOX = join(homedir(), "RSTR IQ Data", "inbox");
const CURRENT_SEASON = 2026;

type CliArgs = {
  inbox: string;
  season: number;
  yes: boolean;
  dryRun: boolean;
  prod: boolean;
  keepFiles: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    inbox: DEFAULT_INBOX,
    season: CURRENT_SEASON,
    yes: false,
    dryRun: false,
    prod: false,
    keepFiles: false,
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
    } else if (a === "--prod") {
      args.prod = true;
    } else if (a === "--keep-files") {
      args.keepFiles = true;
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
  npm run import:prod  (production — requires typed confirmation)

Options:
  --inbox <path>   Folder to scan for CSVs (default: ~/RSTR IQ Data/inbox)
  --season <year>  Season to import into (default: ${CURRENT_SEASON}). Per-file override from filename.
  --dry-run        Show detection + pipeline plan, exit without prompting.
  --yes, -y        Skip standard confirmation prompt (does NOT bypass --prod guard).
  --prod           Run against production Supabase. Requires typed "yes-promote-to-prod".
  --keep-files     Don't archive successfully-imported files. Useful for re-running.
                   Default behavior moves files to ~/RSTR IQ Data/imported/<YYYY-MM-DD>/.
  --help           Show this message.

Environments:
  npm run import       → reads .env.local (intended for the staging branch)
  npm run import:prod  → reads .env.production.local (production, with --prod confirmation guard)
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

const PROD_CONFIRM_PHRASE = "yes-promote-to-prod";

async function confirmExactPhrase(prompt: string, expected: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(prompt);
    return answer.trim() === expected;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files = listCsvFiles(args.inbox);
  const results = dedupeResults(
    files.map((f) => {
      const probe = probeCsv(f);
      return detect(probe);
    }),
  );

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

  const importable = results.filter((r) => r.match && r.supersededBy === undefined);
  if (importable.length === 0) {
    console.log("Nothing to import. Drop CSVs in the inbox and re-run.");
    process.exit(0);
  }

  if (args.dryRun) {
    console.log(`Dry run — no changes made. Re-run without --dry-run to import.`);
    process.exit(0);
  }

  if (args.prod) {
    // Production confirmation guard: explicit typed phrase, --yes does NOT bypass.
    // Unattended runs (launchd / cron) skip the prompt ONLY when the env var
    // is set to the expected token — keeps a normal shell from accidentally
    // bypassing it via `--yes`.
    if (process.env.RSTR_AUTOMATION_TOKEN === PROD_CONFIRM_PHRASE) {
      console.log("Unattended prod run (RSTR_AUTOMATION_TOKEN matched).");
    } else {
      const url = process.env.SUPABASE_URL || "(unset)";
      console.log("");
      console.log("⚠️  PRODUCTION MODE — this will write to your live Supabase.");
      console.log(`   Target URL: ${url}`);
      console.log("");
      const ok = await confirmExactPhrase(`Type "${PROD_CONFIRM_PHRASE}" to proceed (anything else aborts): `, PROD_CONFIRM_PHRASE);
      if (!ok) {
        console.log("Aborted — production write not confirmed.");
        process.exit(0);
      }
    }
  } else if (!args.yes) {
    const ok = await confirm("Proceed? [y/N] ");
    if (!ok) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  console.log(`\n${importable.length} file${importable.length === 1 ? "" : "s"} queued for import.`);
  const { runImports } = await import("./runner.ts");
  await runImports(results, args.season, args.keepFiles);
  process.exit(0);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("SUPABASE_URL") || msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    console.error("\n✗ Cannot run import: Supabase credentials missing.");
    console.error("");
    console.error("  Create ~/dev-main/diamond-predictor-66/.env.local with:");
    console.error("    SUPABASE_URL=https://<your-project-ref>.supabase.co");
    console.error("    SUPABASE_SERVICE_ROLE_KEY=<service_role-secret>");
    console.error("");
    console.error("  Get the key from: Supabase dashboard → Project Settings → API → 'service_role'.");
    console.error("");
    process.exit(1);
  }
  console.error("Fatal:", err);
  process.exit(1);
});
