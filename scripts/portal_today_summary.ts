import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const today = new Date().toISOString().slice(0, 10);
const since = `${today}T00:00:00.000Z`;

const { count: matchedToday } = await (sb as any)
  .from("players")
  .select("id", { count: "exact", head: true })
  .gte("portal_last_seen_at", since)
  .in("portal_status", ["IN PORTAL", "COMMITTED", "WITHDRAWN"]);

const { count: inPortalTotal } = await (sb as any)
  .from("players")
  .select("id", { count: "exact", head: true })
  .eq("portal_status", "IN PORTAL");

const { count: committedTotal } = await (sb as any)
  .from("players")
  .select("id", { count: "exact", head: true })
  .eq("portal_status", "COMMITTED");

// EXACT counts via count: "exact", head: true — no 1000-row cap
const { count: unmatchedTotal } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("id", { count: "exact", head: true })
  .eq("resolved", false);

const reasons = ["no_match", "no_stats", "ambiguous"] as const;
const byReason: Record<string, number> = {};
for (const r of reasons) {
  const { count } = await (sb as any)
    .from("portal_entries_unmatched")
    .select("id", { count: "exact", head: true })
    .eq("resolved", false)
    .eq("reason", r);
  byReason[r] = count ?? 0;
}

const { count: ingestedToday } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("id", { count: "exact", head: true })
  .eq("resolved", false)
  .gte("ingested_at", since);

const pitcherPos = ["SP", "RP", "CL", "P", "LHP", "RHP"];
const { count: pitchersToday } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("id", { count: "exact", head: true })
  .eq("resolved", false)
  .gte("ingested_at", since)
  .in("position", pitcherPos);

const hittersToday = (ingestedToday ?? 0) - (pitchersToday ?? 0);

console.log("==== PORTAL CATCHUP CHECK ====");
console.log(`\nToday: ${today}\n`);
console.log("PLAYERS TABLE (current state):");
console.log(`  matched players touched today: ${matchedToday}`);
console.log(`  total IN PORTAL:               ${inPortalTotal}`);
console.log(`  total COMMITTED:               ${committedTotal}`);
console.log("\nUNMATCHED QUEUE (resolved=false, exact counts):");
console.log(`  TOTAL:        ${unmatchedTotal}`);
console.log(`    no_match:   ${byReason.no_match}  (real names we don't have in players table)`);
console.log(`    no_stats:   ${byReason.no_stats}  (matched name but no 2026 stats — walk-ons / freshmen / late adds)`);
console.log(`    ambiguous:  ${byReason.ambiguous}  (multiple candidates — manual link needed)`);
console.log(`\n  ingested TODAY: ${ingestedToday}`);
console.log(`    pitchers:     ${pitchersToday}`);
console.log(`    hitters:      ${hittersToday}`);
