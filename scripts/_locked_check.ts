import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: roblez } = await (sb as any).from("player_predictions").select("variant, customer_team_id, class_transition, locked").eq("player_id", "03dd3c82-b85a-43a0-9815-89403d253a2e").eq("season", 2027);
console.log("Roblez rows:");
for (const r of (roblez || [])) console.log(`  ${r.variant.padEnd(11)} team=${r.customer_team_id?.slice(0,8) ?? "global"} ct=${r.class_transition} locked=${r.locked}`);

// Check locked status across regular variant rows still SJ for SR players
const { count: lockedSjSr } = await (sb as any).from("player_predictions").select("*, players!inner(class_year)", { count: "exact", head: true }).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).eq("class_transition", "SJ").eq("players.class_year", "SR").eq("locked", true);
const { count: unlockedSjSr } = await (sb as any).from("player_predictions").select("*, players!inner(class_year)", { count: "exact", head: true }).eq("season", 2027).eq("variant", "regular").is("customer_team_id", null).eq("class_transition", "SJ").eq("players.class_year", "SR").eq("locked", false);
console.log(`\nSR + regular + ct=SJ: locked=${lockedSjSr}, unlocked=${unlockedSjSr}`);
