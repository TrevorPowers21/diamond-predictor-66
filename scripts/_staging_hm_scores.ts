import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

console.log("=== Hitter Master 2026 scoring columns NULL audit ===");
const { count: total } = await (sb as any).from("Hitter Master").select("*", { count: "exact", head: true }).eq("Season", 2026);
console.log(`Total: ${total}`);
for (const col of ["contact_score", "barrel_score", "avg_ev_score", "chase_score", "ev_score"]) {
  try {
    const { count, error } = await (sb as any).from("Hitter Master").select("*", { count: "exact", head: true }).eq("Season", 2026).is(col, null);
    if (error) { console.log(`  ${col}: column doesn't exist (${error.message})`); continue; }
    const pct = total ? ((count! / total!) * 100).toFixed(1) : "0";
    console.log(`  NULL ${col.padEnd(20)}: ${String(count).padStart(6)} (${pct}%)`);
  } catch (e: any) {
    console.log(`  ${col}: ${e.message}`);
  }
}

console.log("\nSample row:");
const { data: sample } = await (sb as any).from("Hitter Master").select("playerFullName, contact_score, barrel_score, avg_ev_score, chase_score").eq("Season", 2026).not("contact_score", "is", null).limit(2);
console.log(JSON.stringify(sample, null, 2));
