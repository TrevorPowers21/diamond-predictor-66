import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await (sb as any).from("player_predictions").select("hitter_chase_score, hitter_barrel_score, hitter_ev_score, hitter_contact_score, pitcher_chase_score, pitcher_barrel_score, pitcher_ev_score, pitcher_whiff_score, pitcher_iz_whiff_score, chase_score, barrel_score, ev_score").eq("player_id", "fa303a0e-7bea-45c9-a524-a9d2541788b9").eq("season", 2026);
console.log(JSON.stringify(data, null, 2));
