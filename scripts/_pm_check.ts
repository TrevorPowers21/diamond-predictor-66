import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { count: totalPM } = await (sb as any).from("Pitching Master").select("*", { count: "exact", head: true });
console.log(`Pitching Master total: ${totalPM}`);
for (const s of [2023, 2024, 2025, 2026, 2027]) {
  const { count } = await (sb as any).from("Pitching Master").select("*", { count: "exact", head: true }).eq("Season", s);
  const { count: withIP } = await (sb as any).from("Pitching Master").select("*", { count: "exact", head: true }).eq("Season", s).gte("IP", 10);
  console.log(`  Season ${s}: total=${count}  with IP>=10: ${withIP}`);
}

// Same for Hitter Master
console.log("\n--- Hitter Master ---");
for (const s of [2023, 2024, 2025, 2026, 2027]) {
  const { count } = await (sb as any).from("Hitter Master").select("*", { count: "exact", head: true }).eq("Season", s);
  console.log(`  Season ${s}: ${count}`);
}
