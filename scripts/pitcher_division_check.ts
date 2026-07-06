import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data: flora } = await (sb as any)
  .from("Pitching Master")
  .select("*")
  .ilike("playerFullName", "%Flora%")
  .eq("Season", 2026)
  .limit(1);

if (flora?.[0]) {
  const r = flora[0];
  console.log("Flora row — all keys:");
  console.log(Object.keys(r).sort().join(", "));
  console.log("\nFields likely relevant to division:");
  for (const k of Object.keys(r)) {
    if (k.toLowerCase().includes("div") || k.toLowerCase().includes("nca") || k.toLowerCase().includes("juco")) {
      console.log(`  ${k}: ${r[k]}`);
    }
  }
  console.log("\nrow.division =", r.division);
  console.log("row.Division =", r.Division);
}
