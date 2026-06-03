#!/usr/bin/env node
/**
 * JUCO customer-team precompute runner — loops over every active customer
 * team and runs both the JUCO hitter + pitcher transfer precompute scripts.
 *
 * Why this exists: process-precompute-jobs (the Edge Function) excludes JUCO
 * by design. The JUCO transfer equation lives in
 *   - scripts/precompute-transfer-projections.ts (hitters, --division JUCO)
 *   - scripts/precompute-pitchers.ts (pitchers, --division JUCO)
 * Both must be fired per customer team. This wrapper sequences all of them.
 *
 * Usage:
 *   STAGING:  npm run juco-precompute-all
 *   PROD:     npm run juco-precompute-all:prod
 *
 * Dry-run any time with --dry-run.
 *
 * Idempotent — the underlying scripts UPSERT keyed on
 * (player_id, customer_team_id, model_type, variant, season).
 */
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ENV_LABEL = url.includes("trbvxuoliwrfowibatkm") ? "PROD"
                : url.includes("slrxowawbijbjrkozqlj") ? "STAGING"
                : "UNKNOWN";
const dryRun = process.argv.includes("--dry-run");

console.log(`\n${"=".repeat(60)}`);
console.log(`JUCO customer-team precompute runner`);
console.log(`${"=".repeat(60)}`);
console.log(`Target:  ${url}`);
console.log(`Env:     ${ENV_LABEL}`);
console.log(`Mode:    ${dryRun ? "DRY-RUN" : "APPLY"}`);
console.log("");

if (ENV_LABEL === "UNKNOWN") {
  console.error("Refusing to run — could not detect STAGING or PROD from SUPABASE_URL.");
  console.error("Set .env.local (staging) or .env.production.local (prod) before invoking.");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

// Pull active customer teams (excluding RSTR IQ All-Americans internal team)
const { data: teams, error } = await (sb as any)
  .from("customer_teams")
  .select("id, name")
  .eq("active", true)
  .not("name", "ilike", "%All-Americans%")
  .order("name");
if (error) { console.error("Failed to load customer_teams:", error); process.exit(1); }
if (!teams || teams.length === 0) { console.error("No active customer teams found."); process.exit(1); }

console.log(`Found ${teams.length} active customer team(s):`);
for (const t of teams) console.log(`  - ${t.name} (${t.id})`);
console.log("");

// Per-team summary
type Outcome = { team: string; hitterStatus: "ok" | "failed" | "skipped"; pitcherStatus: "ok" | "failed" | "skipped" };
const outcomes: Outcome[] = [];

// Determine which prod flag to pass to inner scripts based on env we're in.
const innerProdFlag = ENV_LABEL === "PROD" ? "--prod" : null;
const innerDryRunFlag = dryRun ? "--dry-run" : null;

function runInnerScript(scriptPath: string, team: { id: string; name: string }): "ok" | "failed" {
  const args = [
    "tsx",
    scriptPath,
    "--team", team.id,
    "--division", "JUCO",
  ];
  if (innerProdFlag) args.push(innerProdFlag);
  if (innerDryRunFlag) args.push(innerDryRunFlag);
  console.log(`  > npx ${args.join(" ")}`);
  const res = spawnSync("npx", args, { stdio: "inherit", env: process.env });
  if (res.status === 0) return "ok";
  console.error(`  ✗ exit status: ${res.status}`);
  return "failed";
}

for (let i = 0; i < teams.length; i++) {
  const t = teams[i];
  console.log(`\n[${i + 1}/${teams.length}] ${t.name}  (${t.id})`);
  console.log("─".repeat(60));
  console.log("Hitters:");
  const hitterStatus = runInnerScript("scripts/precompute-transfer-projections.ts", t);
  console.log("Pitchers:");
  const pitcherStatus = runInnerScript("scripts/precompute-pitchers.ts", t);
  outcomes.push({ team: t.name, hitterStatus, pitcherStatus });
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Summary`);
console.log(`${"=".repeat(60)}`);
for (const o of outcomes) {
  console.log(`  ${o.team.padEnd(35)} hitters=${o.hitterStatus.padEnd(8)} pitchers=${o.pitcherStatus}`);
}
const failed = outcomes.filter((o) => o.hitterStatus === "failed" || o.pitcherStatus === "failed").length;
if (failed > 0) {
  console.error(`\n${failed} team(s) had failures. Inspect logs above.`);
  process.exit(1);
}
console.log(`\nAll teams completed successfully.`);

if (!dryRun) {
  console.log(`\nNow run the propagation functions in the Supabase SQL editor to refresh`);
  console.log(`scoring tile columns on the new precomputed rows:`);
  console.log(`  SELECT propagate_hitter_scores_to_predictions(2026) AS hitter_rows_updated,`);
  console.log(`         propagate_pitcher_scores_to_predictions(2026) AS pitcher_rows_updated;`);
}
