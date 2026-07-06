import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: p } = await (STAGING as any)
  .from("players")
  .select("*")
  .eq("id", "5d4654f4-2db8-4a53-a291-f7985c2b5402")
  .maybeSingle();
console.log("player:", JSON.stringify(p, null, 2));

if (p) {
  const { data: preds } = await (STAGING as any)
    .from("player_predictions")
    .select("season, variant, model_type, customer_team_id, status, class_transition, dev_aggressiveness")
    .eq("player_id", p.id)
    .order("season", { ascending: false })
    .order("variant");
  console.log(`\nAll prediction rows (count=${preds?.length}):`);
  for (const r of (preds || [])) {
    console.log(`  s${r.season} ${r.variant.padEnd(11)} model=${r.model_type} team=${r.customer_team_id?.slice(0,8) ?? "(global)"} status=${r.status} ct=${r.class_transition}`);
  }
}
