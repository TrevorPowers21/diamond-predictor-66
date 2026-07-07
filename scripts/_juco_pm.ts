import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// What teams are in Pitching Master 2026?
const { data } = await (sb as any).from("Pitching Master").select("Conference, Team").eq("Season", 2026).limit(50000);
const confDist: Record<string, number> = {};
for (const r of (data || [])) confDist[r.Conference ?? "NULL"] = (confDist[r.Conference ?? "NULL"] || 0) + 1;
console.log("2026 Pitching Master by Conference (top 30):");
for (const [k,v] of Object.entries(confDist).sort((a,b)=>b[1]-a[1]).slice(0,30)) console.log(`  ${k.padEnd(35)} ${v}`);

// Check Source for JUCO indicator
const { data: jucoCheck } = await (sb as any).from("Pitching Master").select("*").eq("Season", 2026).ilike("Conference", "%njcaa%").limit(3);
console.log("\nSample JUCO rows (Conference ILIKE njcaa):");
console.log(JSON.stringify(jucoCheck, null, 2));

// And 2025 for comparison
const { count: pm25Total } = await (sb as any).from("Pitching Master").select("*", { count: "exact", head: true }).eq("Season", 2025);
const { count: pm25Juco } = await (sb as any).from("Pitching Master").select("*", { count: "exact", head: true }).eq("Season", 2025).ilike("Conference", "%njcaa%");
const { count: pm26Total } = await (sb as any).from("Pitching Master").select("*", { count: "exact", head: true }).eq("Season", 2026);
const { count: pm26Juco } = await (sb as any).from("Pitching Master").select("*", { count: "exact", head: true }).eq("Season", 2026).ilike("Conference", "%njcaa%");
console.log(`\n2025 Pitching Master: total=${pm25Total}, JUCO=${pm25Juco}`);
console.log(`2026 Pitching Master: total=${pm26Total}, JUCO=${pm26Juco}`);
