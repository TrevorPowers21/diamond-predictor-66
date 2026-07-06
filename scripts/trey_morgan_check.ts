import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Check several active hybrid players
const candidates = [
  "f7843b1e-61d6-42b2-80a6-64f998fe40a2", // Trey Morgan, P, pa=257, ip=79
  "079ffda8-b6df-4f03-821e-2a19ed500845", // Caden Grice, P, pa=275, ip=78
  "b729e286-5ff6-4e74-a06a-c53fd00ef1dd", // Payton Tolle, TWP-position-but-is_twp=false, pa=66, ip=81
  "44573155-0a9c-4a29-8cc7-42a9605fb45d", // Justin Lehman, TWP-pos, pa=164, ip=78
];

for (const id of candidates) {
  const { data: p } = await (sb as any).from("players").select("first_name, last_name, team, position, is_twp, pa, ip").eq("id", id).maybeSingle();
  if (!p) continue;
  const { data: preds } = await (sb as any)
    .from("player_predictions")
    .select("variant, customer_team_id, status, pitcher_role, hitter_depth_role, p_wrc_plus, o_war, p_rv_plus, p_war, market_value")
    .eq("player_id", id)
    .eq("season", 2027)
    .eq("variant", "regular")
    .maybeSingle();
  console.log(`\n=== ${p.first_name} ${p.last_name} | team=${p.team} pos=${p.position} is_twp=${p.is_twp} pa=${p.pa} ip=${p.ip} ===`);
  if (preds) {
    console.log(`  pitcher_role=${preds.pitcher_role} hitter_depth_role=${preds.hitter_depth_role}`);
    console.log(`  p_wrc+=${preds.p_wrc_plus} oWAR=${preds.o_war?.toFixed?.(2)}  |  p_rv+=${preds.p_rv_plus?.toFixed?.(2)} pWAR=${preds.p_war?.toFixed?.(2)}  |  market=$${preds.market_value?.toFixed?.(0)}`);
  } else {
    console.log("  no 2027 regular row");
  }
}
