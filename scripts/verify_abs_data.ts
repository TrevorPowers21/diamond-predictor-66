import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { count: hCount } = await (sb as any).from("abs_hitter_stats").select("id", { count: "exact", head: true });
const { count: pCount } = await (sb as any).from("abs_pitcher_stats").select("id", { count: "exact", head: true });
console.log(`abs_hitter_stats:  ${hCount} rows`);
console.log(`abs_pitcher_stats: ${pCount} rows`);

console.log("\n=== Sample hitter row ===");
const { data: hSample } = await (sb as any).from("abs_hitter_stats").select("*").not("abs_iz_barrel_pct", "is", null).limit(2);
console.log(JSON.stringify(hSample, null, 2));

console.log("\n=== Sample pitcher row ===");
const { data: pSample } = await (sb as any).from("abs_pitcher_stats").select("*").not("abs_csw_pct", "is", null).limit(2);
console.log(JSON.stringify(pSample, null, 2));
