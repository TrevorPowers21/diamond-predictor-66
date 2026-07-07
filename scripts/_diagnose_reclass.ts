import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const queries: Array<{ label: string; fn: () => any }> = [
    { label: "total                          :", fn: () => (sb as any).from("pitch_log").select("uniq_pitch_id", { count: "exact", head: true }) },
    { label: "is_data=true                   :", fn: () => (sb as any).from("pitch_log").select("uniq_pitch_id", { count: "exact", head: true }).eq("is_data", true) },
    { label: "pitch_type IS NOT NULL         :", fn: () => (sb as any).from("pitch_log").select("uniq_pitch_id", { count: "exact", head: true }).not("pitch_type", "is", null) },
    { label: "pitch_type_reclassified IS NULL:", fn: () => (sb as any).from("pitch_log").select("uniq_pitch_id", { count: "exact", head: true }).is("pitch_type_reclassified", null) },
    {
      label: "reclass-eligible combined      :",
      fn: () => (sb as any).from("pitch_log").select("uniq_pitch_id", { count: "exact", head: true })
        .is("pitch_type_reclassified", null)
        .not("pitch_type", "is", null)
        .neq("pitch_type", "")
        .neq("pitch_type", "UN")
        .eq("is_data", true),
    },
  ];

  for (const q of queries) {
    const { count, error } = await q.fn();
    console.log(q.label, error ? `ERROR ${error.message}` : count?.toLocaleString() ?? "null");
  }

  const { data, error: e2 } = await (sb as any).from("pitch_log")
    .select("uniq_pitch_id, pitch_type, is_data, pitcher_hand, ivb, hb, rel_height")
    .is("pitch_type_reclassified", null)
    .not("pitch_type", "is", null)
    .neq("pitch_type", "")
    .neq("pitch_type", "UN")
    .eq("is_data", true)
    .limit(3);
  console.log("\nSample eligible rows:", e2 ? e2.message : JSON.stringify(data, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
