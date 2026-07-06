import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key);

const PLAYER_ID = "7d07f97e-ef45-4b3a-8a72-fdee13a90ee9";

const { data: player } = await supabase
  .from("players")
  .select("id, first_name, last_name, position, team, from_team, conference, division, source_player_id, ip, is_twp")
  .eq("id", PLAYER_ID)
  .maybeSingle();

console.log("Player:");
console.log(player);

const { data: preds } = await supabase
  .from("player_predictions")
  .select("id, customer_team_id, variant, model_type, status, season, from_era, from_fip, from_whip, from_k9, from_bb9, from_hr9, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, market_value, pitcher_role, projected_ip, updated_at")
  .eq("player_id", PLAYER_ID)
  .eq("season", 2027)
  .order("variant")
  .order("customer_team_id", { nullsFirst: false });

console.log("\nPrediction rows (season=2027):");
for (const r of preds || []) {
  const team = r.customer_team_id ? r.customer_team_id.slice(0, 8) : "GLOBAL";
  console.log(
    `[${r.variant}|${r.model_type}|team=${team}|status=${r.status}|role=${r.pitcher_role}|ip=${r.projected_ip}]`
  );
  console.log(
    `   from: era=${r.from_era} fip=${r.from_fip} whip=${r.from_whip} k9=${r.from_k9} bb9=${r.from_bb9} hr9=${r.from_hr9}`
  );
  console.log(
    `   proj: era=${r.p_era?.toFixed?.(2)} fip=${r.p_fip?.toFixed?.(2)} whip=${r.p_whip?.toFixed?.(2)} k9=${r.p_k9?.toFixed?.(2)} bb9=${r.p_bb9?.toFixed?.(2)} hr9=${r.p_hr9?.toFixed?.(2)}`
  );
  console.log(
    `   pRV+=${r.p_rv_plus?.toFixed?.(1)} pWAR=${r.p_war?.toFixed?.(2)} MV=${r.market_value} updated=${r.updated_at}`
  );
}
