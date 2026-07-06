import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const pid = "de0455d6-173f-4378-8474-8f2b61775cff";

console.log("=== WITHOUT inner join ===");
const { data: a } = await (sb as any)
  .from("player_predictions")
  .select("id, player_id, customer_team_id, variant, model_type, status, season, p_wrc_plus, created_at, updated_at")
  .eq("player_id", pid);
console.log(`Rows: ${a?.length ?? 0}`);
console.log(JSON.stringify(a, null, 2));

console.log("\n=== WITH players!inner join ===");
const { data: b } = await (sb as any)
  .from("player_predictions")
  .select("id, player_id, customer_team_id, variant, model_type, status, season, players!inner(id, first_name, last_name, team, transfer_portal, pa, division)")
  .eq("player_id", pid);
console.log(`Rows: ${b?.length ?? 0}`);
console.log(JSON.stringify(b, null, 2));

console.log("\n=== players table row for this id ===");
const { data: p } = await (sb as any).from("players").select("*").eq("id", pid);
console.log(JSON.stringify(p, null, 2));
