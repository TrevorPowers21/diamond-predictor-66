import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Tre Phelps source_player_id: 1297607680
const { data } = await (sb as any).from("abs_hitter_stats").select("*").eq("source_player_id", "1297607680").maybeSingle();
console.log("Tre Phelps ABS hitter row:");
console.log(JSON.stringify(data, null, 2));
