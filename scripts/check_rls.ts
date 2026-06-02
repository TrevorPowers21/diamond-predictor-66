import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Check if RLS is enabled on the table
const { data, error } = await (sb as any).rpc("get_table_rls_status").catch(() => ({ data: null, error: "rpc not available" }));
console.log("RPC:", data, error);

// Try direct query on pg_class via raw SQL — won't work without rpc.
// Instead, try to read as anon-equivalent by checking what's accessible.

// Direct test: count what we have
const { data: rows, error: e2 } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("id, reason, resolved")
  .eq("resolved", false)
  .limit(3);
console.log("Service role can read:", rows?.length, e2);

// Look up policies
const { data: pol, error: e3 } = await (sb as any).rpc("show_policies", { table_name: "portal_entries_unmatched" }).catch(() => ({ data: null, error: "no rpc" }));
console.log("Policies:", pol, e3);
