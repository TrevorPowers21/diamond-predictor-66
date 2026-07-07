import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

for (const [name, id] of [["Trent", "5d4654f4-2db8-4a53-a291-f7985c2b5402"], ["Brad", null]] as const) {
  let pid = id;
  if (!pid) {
    const { data } = await (STAGING as any).from("players").select("id").eq("first_name", "Brad").ilike("last_name", "Grindlinger").maybeSingle();
    pid = data?.id;
  }
  if (!pid) continue;
  console.log(`\n=== ${name} (${pid}) — full row timestamps ===`);
  const { data: preds } = await (STAGING as any)
    .from("player_predictions")
    .select("variant, model_type, customer_team_id, status, class_transition, created_at, updated_at")
    .eq("player_id", pid)
    .eq("season", 2027)
    .order("created_at");
  for (const r of (preds || [])) {
    const teamLabel = r.customer_team_id?.slice(0,8) ?? "(global)";
    console.log(`  ${r.variant.padEnd(11)} team=${teamLabel} ct=${r.class_transition?.padEnd(3)} created=${r.created_at} updated=${r.updated_at}`);
  }
}
