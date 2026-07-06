import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data, error } = await (sb as any)
  .from("player_predictions")
  .select("*")
  .eq("id", "48a7a5be-af69-428a-8276-8fcb14663ced")
  .maybeSingle();
if (error) console.log("err:", error.message);
console.log(JSON.stringify(data, null, 2));
