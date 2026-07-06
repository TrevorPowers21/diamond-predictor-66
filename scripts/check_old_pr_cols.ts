import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

for (const col of ["overall_plus", "ba_plus", "obp_plus", "iso_plus"]) {
  const { count } = await (STAGING as any).from("Hitter Master").select("source_player_id", { count: "exact", head: true }).eq("Season", 2026).not(col, "is", null);
  console.log(`staging Hitter Master 2026 with ${col}: ${count}`);
}
