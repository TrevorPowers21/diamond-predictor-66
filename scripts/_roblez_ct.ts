import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await (sb as any).from("player_predictions").select("id, variant, customer_team_id, class_transition, class_transition_overridden, updated_at").eq("player_id", "03dd3c82-b85a-43a0-9815-89403d253a2e").eq("season", 2027);
for (const r of (data || [])) console.log(`${r.variant.padEnd(11)} team=${r.customer_team_id?.slice(0,8) ?? "global"} ct=${r.class_transition} overridden=${r.class_transition_overridden} updated=${r.updated_at}`);

// Also check a sample SR player whose regular row stayed SJ
const { data: sample } = await (sb as any).from("player_predictions").select("id, player_id, class_transition, class_transition_overridden, players!inner(first_name, last_name, class_year)").eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).eq("class_transition", "SJ").eq("players.class_year", "SR").limit(3);
console.log("\nSample SR players still ct=SJ on regular variant:");
for (const r of (sample || [])) console.log(`  ${r.players.first_name} ${r.players.last_name} (cy=${r.players.class_year}) ct=${r.class_transition} overridden=${r.class_transition_overridden}`);
