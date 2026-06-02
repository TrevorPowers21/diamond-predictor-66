import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const targetUrl = process.env.SUPABASE_URL ?? "";
console.log(`Target: ${targetUrl}\n`);

const { data: players } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, source_player_id, position, ip, division, conference, class_year")
  .ilike("first_name", "Mason")
  .ilike("last_name", "Edwards")
  .limit(5);

if (!players || players.length === 0) { console.log("Mason Edwards not found"); process.exit(0); }
for (const p of players) {
  console.log(`Mason Edwards | id=${p.id} | team=${p.team} | pos=${p.position} | ip=${p.ip} | div=${p.division} | class=${p.class_year}`);
}

const targetId = players[0].id;
const { data: preds } = await (sb as any)
  .from("player_predictions")
  .select("id, customer_team_id, variant, model_type, status, season, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, market_value, projected_ip, pitcher_role, from_era, from_fip")
  .eq("player_id", targetId)
  .order("variant")
  .order("season");

console.log(`\n${preds?.length ?? 0} prediction rows for ${players[0].first_name} ${players[0].last_name}:\n`);

const { data: ct } = await (sb as any).from("customer_teams").select("id, display_name").eq("active", true);
const ctMap = new Map(ct?.map((t: any) => [t.id, t.display_name]) ?? []);

for (const r of preds || []) {
  const team = r.customer_team_id ? (ctMap.get(r.customer_team_id) ?? r.customer_team_id) : "GLOBAL";
  console.log(`[${r.variant} | ${r.model_type} | s=${r.season}] ${team}`);
  console.log(`  p_era=${r.p_era}  p_fip=${r.p_fip}  p_whip=${r.p_whip}  p_k9=${r.p_k9}  p_bb9=${r.p_bb9}  p_hr9=${r.p_hr9}`);
  console.log(`  p_rv_plus=${r.p_rv_plus}  p_war=${r.p_war}  market_value=${r.market_value}  proj_ip=${r.projected_ip}  role=${r.pitcher_role}`);
  console.log();
}
