import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await (sb as any).from("players").select("first_name, last_name, class_year, position, team").in("id", ["5d4654f4-2db8-4a53-a291-f7985c2b5402"]);
console.log(JSON.stringify(data, null, 2));
