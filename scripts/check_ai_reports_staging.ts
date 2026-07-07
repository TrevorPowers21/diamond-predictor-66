import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// 1) Try SELECT
console.log("--- SELECT test ---");
const { data: sel, error: selErr, count } = await (STAGING as any).from("ai_scouting_reports").select("*", { count: "exact" }).limit(1);
console.log("data:", sel, "count:", count, "error:", selErr?.message);

// 2) Try INSERT a dummy row to see the exact error
console.log("\n--- INSERT test ---");
const { error: insErr } = await (STAGING as any).from("ai_scouting_reports").insert({
  player_id: "00000000-0000-0000-0000-000000000000",
  side: "hitter",
  archetype_id: "test",
  body: "test",
  model: "test",
  input_hash: "test-hash-0000",
  generated_at: new Date().toISOString(),
});
console.log("insert error:", insErr?.message);

// 3) Try the same with upsert
console.log("\n--- UPSERT test ---");
const { error: upErr } = await (STAGING as any).from("ai_scouting_reports").upsert({
  player_id: "00000000-0000-0000-0000-000000000000",
  side: "hitter",
  archetype_id: "test",
  body: "test",
  model: "test",
  input_hash: "test-hash-0001",
  generated_at: new Date().toISOString(),
}, { onConflict: "player_id,side" });
console.log("upsert error:", upErr?.message);
