/**
 * Prints active customer teams from the LIVE `customer_teams` table, one per line
 * as `<uuid>:<name>`. The single source of truth for "which teams get precomputed"
 * so runners never drift from a hardcoded list (North Carolina was missed 2026-08-26
 * because `_run_step2_all.sh` carried a stale 17-team array — this fixes that class of bug).
 *
 * Usage:
 *   npx tsx --env-file-if-exists=.env.local scripts/list-customer-teams.ts            # staging, active only
 *   npx tsx --env-file-if-exists=.env.production.local scripts/list-customer-teams.ts # prod
 *   ... --all   # include inactive teams too
 *
 * Consumed by _run_step2_all.sh (and any per-team batch loop). Reads
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the loaded env file.
 */
import { createClient } from "@supabase/supabase-js";

const includeInactive = process.argv.includes("--all");
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("list-customer-teams: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required (load .env.local / .env.production.local).");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

let q = sb.from("customer_teams").select("id, name, active").order("created_at");
const { data, error } = await q;
if (error) { console.error(`list-customer-teams: ${error.message}`); process.exit(1); }
const rows = (data || []).filter((t: any) => includeInactive || t.active);
for (const t of rows) {
  // sanitize the name to a single token (no spaces/colons) so shell `${entry##*:}` parsing stays clean
  const label = String(t.name || t.id).replace(/[:\s]+/g, "");
  process.stdout.write(`${t.id}:${label}\n`);
}
