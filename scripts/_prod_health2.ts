import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const tables = [
  "Pitching Master","Hitter Master","Conference Stats","Teams Table","Park Factors",
  "Pitching Master Returners","Hitter Master Returners",
];
console.log("=== PROD legacy-named table counts ===");
for (const t of tables) {
  const { count, error } = await (sb as any).from(t).select("*", { count: "exact", head: true });
  console.log(`  ${t.padEnd(30)} ${error ? "ERR " + error.message : count}`);
}
