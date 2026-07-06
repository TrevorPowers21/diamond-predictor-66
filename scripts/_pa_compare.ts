import { createClient } from "@supabase/supabase-js";
const PR = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Anderson's prod players.pa
const { data: pAnd } = await (PR as any).from("players").select("id, first_name, last_name, pa").eq("source_player_id", "1239164928").maybeSingle();
console.log("Prod Anderson:", JSON.stringify(pAnd));

// What's in his prod 2026 Hitter Master row (if any)?
const { data: pHm } = await (PR as any).from("Hitter Master").select("Season, Team, pa, ab, AVG, OBP").eq("source_player_id", "1239164928").order("Season", { ascending: false });
console.log("\nProd Anderson Hitter Master rows:");
for (const r of (pHm || [])) console.log(`  ${r.Season} ${r.Team}: pa=${r.pa} ab=${r.ab} avg=${r.AVG}`);

// His stored o_war on prod regular variant
const { data: pPred } = await (PR as any).from("player_predictions").select("o_war, hitter_depth_role, p_wrc_plus, market_value").eq("player_id", pAnd?.id).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).maybeSingle();
console.log("\nProd Anderson regular variant 2027 row:", JSON.stringify(pPred));

// His precomputed rows
const { data: pPC } = await (PR as any).from("player_predictions").select("customer_team_id, o_war, hitter_depth_role, p_wrc_plus, market_value").eq("player_id", pAnd?.id).eq("season", 2027).eq("variant", "precomputed");
console.log("\nProd Anderson 9 precomputed rows:");
for (const r of (pPC || [])) console.log(`  team=${r.customer_team_id?.slice(0,8)} depth=${r.hitter_depth_role} wrc+=${r.p_wrc_plus} oWar=${r.o_war} MV=${r.market_value}`);
