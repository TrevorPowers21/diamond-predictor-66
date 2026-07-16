/**
 * One-time backfill: sync every existing NIL/Other contract into the GM funding
 * layer (gm_allocation_source + gm_allocation + carve), using the SAME logic the
 * app runs on contract save. Idempotent — safe to re-run (it recomputes Σ deals
 * per vendor+player and upserts). GM layer only; never touches team_build_players.
 *
 * Needed on PROD after the vendor-unification migrations, because contracts
 * created before this feature have no source/allocation yet. (Staging has none.)
 *
 *   npx tsx --env-file-if-exists=.env.local            scripts/backfill_contract_funding.ts            # dry run (staging)
 *   npx tsx --env-file-if-exists=.env.production.local scripts/backfill_contract_funding.ts --write     # PROD (needs go)
 */
import { createClient } from "@supabase/supabase-js";
import { syncContractFunding } from "../src/gm/lib/contractFundingSync";

const SEASON = 2027; // = PROJECTION_SEASON
const WRITE = process.argv.includes("--write");
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const host = (process.env.VITE_SUPABASE_URL || "").replace("https://", "").split(".")[0];
  console.log(`Target: ${host}  |  ${WRITE ? "WRITE" : "DRY RUN"}`);
  const { data: contracts, error } = await (sb as any).from("gm_contract")
    .select("id, customer_team_id, player_id, bucket, vendor_id, vendor_name, funding_mode, total_value")
    .in("bucket", ["nil", "other"]).not("vendor_id", "is", null);
  if (error) { console.error("query failed:", error.message); process.exit(1); }

  // One sync per unique (team, player, vendor, bucket) — the sync sums all their
  // deals, so running it once per group covers every contract in that group.
  const groups = new Map<string, any>();
  for (const c of contracts ?? []) {
    const key = `${c.customer_team_id}|${c.player_id}|${c.vendor_id}|${c.bucket}`;
    if (!groups.has(key)) groups.set(key, c);
  }
  console.log(`${(contracts ?? []).length} NIL/Other contracts → ${groups.size} vendor·player groups to sync`);
  if (!WRITE) { console.log("\nDRY RUN — re-run with --write to persist."); return; }

  let ok = 0, skipped = 0;
  for (const g of groups.values()) {
    const allocId = await syncContractFunding(sb, g.customer_team_id, null, {
      player_id: g.player_id, bucket: g.bucket, vendor_id: g.vendor_id, vendor_name: g.vendor_name, funding_mode: g.funding_mode,
    }, SEASON);
    if (allocId) {
      await (sb as any).from("gm_contract").update({ allocation_id: allocId })
        .eq("customer_team_id", g.customer_team_id).eq("player_id", g.player_id).eq("vendor_id", g.vendor_id).eq("bucket", g.bucket);
      ok++;
    } else { skipped++; }
  }
  console.log(`Done — ${ok} synced, ${skipped} skipped (no active build / non-roster).`);
}
main();
