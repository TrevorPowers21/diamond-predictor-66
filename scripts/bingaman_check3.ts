import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const sid = "1082321491";
const { data: pm } = await (sb as any).from("Pitching Master").select("source_player_id, playerFullName, Team, Season, chase_score, whiff_score, ev_score, barrel_score, IP").eq("source_player_id", sid);
console.log("Pitching Master rows for Bingaman:");
console.log(JSON.stringify(pm, null, 2));
