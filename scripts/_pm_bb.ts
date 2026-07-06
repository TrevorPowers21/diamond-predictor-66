import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await (sb as any).from("Pitching Master").select("*").eq("source_player_id", "1180787200").eq("Season", 2026).maybeSingle();
console.log("Pitching Master 2026 for Roblez (all columns):");
console.log(JSON.stringify(data, null, 2));
