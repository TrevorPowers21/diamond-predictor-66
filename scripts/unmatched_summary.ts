import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const { data } = await (sb as any).from("portal_entries_unmatched").select("reason").eq("resolved", false);
const by: Record<string, number> = {};
for (const r of data || []) by[r.reason] = (by[r.reason] || 0) + 1;
console.log("portal_entries_unmatched by reason (resolved=false):");
for (const [k, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(`  TOTAL: ${(data || []).length}`);
