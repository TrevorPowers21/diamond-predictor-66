import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const pid = "de0455d6-173f-4378-8474-8f2b61775cff"; // Ethan Hott

console.log("Variants for this player, season 2027, customer_team_id IS NULL:");
const { data } = await (sb as any)
  .from("player_predictions")
  .select("id, player_id, customer_team_id, variant, model_type, status, season, players!inner(id, transfer_portal, pa, position, is_twp, division)")
  .eq("season", 2027)
  .in("model_type", ["returner", "transfer"])
  .in("variant", ["regular", "precomputed"])
  .in("status", ["active", "departed"])
  .or("position.not.in.(SP,RP,CL,P,LHP,RHP),is_twp.eq.true", { referencedTable: "players" })
  .not("players.division", "eq", "NJCAA_D1")
  .gte("players.pa", 75)
  .is("customer_team_id", null)
  .eq("player_id", pid);
console.log(`Rows: ${data?.length ?? 0}`);
console.log(JSON.stringify(data, null, 2));

console.log("\nSame query but WITHOUT inner join:");
const { data: d2 } = await (sb as any)
  .from("player_predictions")
  .select("id, player_id, customer_team_id, variant, model_type, status, season")
  .eq("season", 2027)
  .in("model_type", ["returner", "transfer"])
  .in("variant", ["regular", "precomputed"])
  .in("status", ["active", "departed"])
  .is("customer_team_id", null)
  .eq("player_id", pid);
console.log(`Rows: ${d2?.length ?? 0}`);
console.log(JSON.stringify(d2, null, 2));
