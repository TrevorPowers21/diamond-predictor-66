import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await (sb as any).from("player_predictions").select("model_type, variant").limit(5000);
const dist: Record<string, number> = {};
for (const r of (data || [])) { const k = `${r.model_type}|${r.variant}`; dist[k] = (dist[k]||0)+1; }
console.log("model_type|variant distribution (sample 5000):");
for (const [k,v] of Object.entries(dist).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(30)} ${v}`);
console.log("\n--- counts by model_type ---");
for (const mt of ["hitter","pitcher","pitching","pitching_returner","pitching_transfer","hitting","hitting_returner","hitting_transfer"]) {
  const { count } = await (sb as any).from("player_predictions").select("*", { count: "exact", head: true }).eq("model_type", mt);
  console.log(`  ${mt.padEnd(22)} ${count}`);
}
