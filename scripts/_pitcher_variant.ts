import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Distribution of 2027 pitcher prediction rows by variant + customer_team_id
const { data } = await (sb as any).from("player_predictions")
  .select("variant, customer_team_id, p_era, players!inner(position)")
  .in("players.position", ["P","SP","RP"]).eq("season", 2027).limit(50000);
const dist: Record<string, number> = {};
const withEra: Record<string, number> = {};
for (const r of (data || [])) {
  const k = `variant=${r.variant} team=${r.customer_team_id ? "set" : "NULL"}`;
  dist[k] = (dist[k] || 0) + 1;
  if (r.p_era != null) withEra[k] = (withEra[k] || 0) + 1;
}
console.log("2027 pitcher pred rows by (variant, team):");
for (const [k,v] of Object.entries(dist).sort((a,b)=>b[1]-a[1])) {
  console.log(`  ${k.padEnd(40)} total=${v}  withEra=${withEra[k] || 0}`);
}

// What teams have precomputed pitcher rows?
const { data: teamRows } = await (sb as any).from("player_predictions")
  .select("customer_team_id, players!inner(position)")
  .in("players.position", ["P","SP","RP"]).eq("season", 2027).eq("variant","precomputed").not("customer_team_id","is",null).limit(20000);
const teamDist: Record<string, number> = {};
for (const r of (teamRows || [])) teamDist[r.customer_team_id?.slice(0,8) ?? "?"] = (teamDist[r.customer_team_id?.slice(0,8) ?? "?"] || 0) + 1;
console.log("\nprecomputed pitcher rows by customer_team_id (8-char):");
for (const [k,v] of Object.entries(teamDist).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(10)} ${v}`);
