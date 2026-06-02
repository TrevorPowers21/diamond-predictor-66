import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const pid = "fa303a0e-7bea-45c9-a524-a9d2541788b9";

// All rows, all variants, full row
const { data: pp } = await (sb as any).from("player_predictions").select("*").eq("player_id", pid).eq("season", 2026);
console.log("ALL player_predictions rows for Bingaman:");
console.log(JSON.stringify(pp, null, 2));
