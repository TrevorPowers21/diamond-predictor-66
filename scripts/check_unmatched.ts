import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data, error } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("*")
  .eq("resolved", false)
  .eq("reason", "no_match")
  .limit(5);
if (error) console.error(error);
console.log(`Sample no_match rows (${data?.length ?? 0}):`);
console.log(JSON.stringify(data, null, 2));

const { count } = await (sb as any).from("portal_entries_unmatched").select("id", { count: "exact", head: true }).eq("resolved", false).eq("reason", "no_match");
console.log(`\nTotal no_match resolved=false: ${count}`);
