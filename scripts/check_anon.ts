import { createClient } from "@supabase/supabase-js";
const ANON = "sb_publishable_YR8l4neda98iEFz675e8Jg_yFBvhP_v";
const URL = "https://trbvxuoliwrfowibatkm.supabase.co";
const sb = createClient(URL, ANON, { auth: { persistSession: false } });

const { data, error, count } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("id, reason, resolved", { count: "exact" })
  .eq("resolved", false)
  .limit(5);
console.log("Anon-role count:", count);
console.log("Anon-role rows returned:", data?.length);
console.log("Error:", error);
console.log("Sample:", JSON.stringify(data?.slice(0, 2), null, 2));
