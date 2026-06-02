import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// 1. Total count
const { count: totalCount } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("id", { count: "exact", head: true });
console.log(`Total rows in portal_entries_unmatched: ${totalCount}`);

// 1b. By reason
for (const r of ["ambiguous", "no_match", "no_stats"]) {
  const { count } = await (sb as any)
    .from("portal_entries_unmatched")
    .select("id", { count: "exact", head: true })
    .eq("resolved", false)
    .eq("reason", r);
  console.log(`  ${r}: ${count}`);
}

const { count: unresolved } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("id", { count: "exact", head: true })
  .eq("resolved", false);
console.log(`Unresolved: ${unresolved}`);

// 2. Recent inserts (by ingested_at)
const { data: recent } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("first_name, last_name, reason, ingested_at, resolved")
  .order("ingested_at", { ascending: false })
  .limit(5);
console.log("\nMost recent 5 rows:");
console.log(JSON.stringify(recent, null, 2));

// 3. The exact query the UI runs
const { data, error } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("*")
  .eq("resolved", false)
  .order("ingested_at", { ascending: false });
console.log(`\nUI query returned: ${data?.length ?? 0} rows`);
if (error) console.log("UI query error:", error);

// 4. RLS check — try with anon key
const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
if (anonKey) {
  const sbAnon = createClient(process.env.SUPABASE_URL!, anonKey, { auth: { persistSession: false } });
  const { data: anonData, error: anonError } = await (sbAnon as any)
    .from("portal_entries_unmatched")
    .select("id, reason")
    .eq("resolved", false)
    .limit(10);
  console.log(`\nAnon-key query returned: ${anonData?.length ?? 0} rows`);
  if (anonError) console.log("Anon query error:", anonError);
} else {
  console.log("\nNo VITE_SUPABASE_ANON_KEY in env to test RLS");
}
