import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
// Try selecting hitter_contact_score - if it errors, migration not applied
const { data, error } = await (sb as any).from("player_predictions").select("hitter_contact_score, hitter_barrel_score, hitter_chase_score, hitter_ev_score, pitcher_whiff_score").limit(1);
if (error) {
  console.log("Migration 20260603120000_split_hitter_pitcher_scouting_scores NOT APPLIED on staging");
  console.log("Error:", error.message);
} else {
  console.log("Migration IS applied. Sample:", JSON.stringify(data, null, 2));
}
