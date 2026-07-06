import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: players } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, source_player_id, division")
  .ilike("last_name", "%Overbeek%");
console.log("Players matching 'Overbeek':");
console.log(JSON.stringify(players, null, 2));

for (const p of players ?? []) {
  console.log(`\n=== ${p.first_name} ${p.last_name} (${p.team}, ${p.position}, source=${p.source_player_id}) ===`);
  const { data: preds } = await (sb as any)
    .from("player_predictions")
    .select("model_type, variant, customer_team_id, season, p_avg, p_obp, p_slg, p_wrc_plus, o_war, market_value, p_era, p_fip, p_rv_plus, p_war, pitcher_role, class_transition, dev_aggressiveness, updated_at")
    .eq("player_id", p.id)
    .order("season", { ascending: false });
  if (!preds || preds.length === 0) {
    console.log("  no prediction rows");
    continue;
  }
  // Customer team name lookup
  const ctIds = Array.from(new Set(preds.filter((pr: any) => pr.customer_team_id).map((pr: any) => pr.customer_team_id)));
  const teamNames = new Map<string, string>();
  if (ctIds.length > 0) {
    const { data: cts } = await (sb as any).from("customer_teams").select("id, name").in("id", ctIds);
    for (const ct of cts ?? []) teamNames.set(ct.id, ct.name);
  }
  for (const pr of preds) {
    const teamLabel = pr.customer_team_id ? teamNames.get(pr.customer_team_id) ?? pr.customer_team_id.slice(0, 8) : "—";
    const isHitter = pr.p_wrc_plus != null;
    if (isHitter) {
      console.log(`  ${pr.model_type}/${pr.variant} season=${pr.season} team=${teamLabel} p_avg=${pr.p_avg} p_wrc+=${pr.p_wrc_plus} oWAR=${pr.o_war?.toFixed?.(2)} MV=${pr.market_value} ct=${pr.class_transition} dev=${pr.dev_aggressiveness}`);
    } else {
      console.log(`  ${pr.model_type}/${pr.variant} season=${pr.season} team=${teamLabel} p_era=${pr.p_era} pRV+=${pr.p_rv_plus} pWAR=${pr.p_war?.toFixed?.(2)} role=${pr.pitcher_role}`);
    }
  }
}
