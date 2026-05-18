#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { lockRegularSeason } from "../src/lib/lockRegularSeason.ts";

const CURRENT_SEASON = 2026;
const PROD_CONFIRM_PHRASE = "yes-promote-to-prod";

type CliArgs = {
  season: number;
  prod: boolean;
  yes: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { season: CURRENT_SEASON, prod: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--season" && argv[i + 1]) {
      args.season = Number(argv[++i]);
    } else if (a === "--prod") {
      args.prod = true;
    } else if (a === "--yes" || a === "-y") {
      args.yes = true;
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
Lock regular-season PA/IP totals — freezes tier-classification source data so
postseason ABs don't inflate playoff-team players' depth tiers.

Usage:
  npm run lock-season [-- --season 2026]
  npm run lock-season:prod  (production — requires typed confirmation)

Options:
  --season <year>  Season to lock (default: ${CURRENT_SEASON}).
  --prod           Run against production Supabase. Requires typed phrase.
  --yes, -y        Skip standard confirmation (does NOT bypass --prod guard).
  --help           Show this message.

Environments:
  npm run lock-season       → reads .env.local (staging branch)
  npm run lock-season:prod  → reads .env.production.local (production)

This operation is idempotent: rows already locked are skipped. The lock can
only be "broken" by a manual SQL UPDATE setting regular_season_pa / _ip back
to NULL — there's no unlock command.
`);
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
  const url = process.env.SUPABASE_URL || "(unset)";

  console.log("");
  console.log(`Lock regular-season PA + IP totals for ${args.season}.`);
  console.log(`Target: ${url}`);
  console.log("");
  console.log("After locking, tier classification (TeamBuilder hitter + pitcher");
  console.log("depth roles) will read regular_season_pa / regular_season_ip in");
  console.log("preference to live pa / IP. Postseason games keep updating pa/IP");
  console.log("but tiers stay frozen at the regular-season snapshot.");
  console.log("");

  if (args.prod) {
    console.log("⚠️  PRODUCTION MODE — this will write to your live Supabase.");
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
    const ok = await confirm("Proceed? [y/N] ");
    if (!ok) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  console.log("\nLocking…");
  const result = await lockRegularSeason(args.season);

  if (result.error) {
    console.error(`\n✗ Lock failed: ${result.error}`);
    process.exit(1);
  }

  console.log("");
  console.log(`✓ Lock complete for season ${result.season}.`);
  console.log("");
  console.log(`  Hitter Master:   ${result.hittersLocked} newly locked, ${result.hittersAlreadyLocked} already locked.`);
  console.log(`  Pitching Master: ${result.pitchersLocked} newly locked, ${result.pitchersAlreadyLocked} already locked.`);
  console.log("");
  if (result.hittersLocked === 0 && result.pitchersLocked === 0) {
    console.log("Nothing changed — this season was already locked.");
  } else {
    console.log("Tier classification will now use the regular-season snapshot.");
  }
  process.exit(0);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("SUPABASE_URL") || msg.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    console.error("\n✗ Cannot run lock: Supabase credentials missing.");
    console.error("");
    console.error("  Create ~/dev-main/diamond-predictor-66/.env.local (staging) or");
    console.error("  .env.production.local (prod) with:");
    console.error("    SUPABASE_URL=https://<your-project-ref>.supabase.co");
    console.error("    SUPABASE_SERVICE_ROLE_KEY=<service_role-secret>");
    console.error("");
    process.exit(1);
  }
  console.error("Fatal:", err);
  process.exit(1);
});
