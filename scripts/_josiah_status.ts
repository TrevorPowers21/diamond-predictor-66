import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data: j } = await (sb as any).from("players").select("first_name, last_name, ip, is_twp, pa").eq("id", "711045dd-f8ae-4df8-be1c-a1cac94702d5").maybeSingle();
console.log("Josiah staging:", JSON.stringify(j));
