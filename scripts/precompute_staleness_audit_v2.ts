import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const targetUrl = process.env.SUPABASE_URL ?? "";
const LABEL = targetUrl.includes("trbvxuoliwrfowibatkm") ? "PROD" : targetUrl.includes("slrxowawbijbjrkozqlj") ? "STAGING" : "UNKNOWN";
console.log(`Target: ${targetUrl} (${LABEL})\n`);
if (LABEL === "UNKNOWN") process.exit(1);

const { data: teams } = await (sb as any).from("customer_teams").select("id, display_name, name").eq("active", true).order("created_at");

console.log(`| Team | Total | depth_role NULL | FS | SJ | JS | GR | NULL ct |`);
console.log(`|---|---|---|---|---|---|---|---|`);

for (const t of teams || []) {
  const { count: total } = await (sb as any)
    .from("player_predictions")
    .select("id", { count: "exact", head: true })
    .eq("customer_team_id", t.id).eq("variant", "precomputed").eq("model_type", "transfer").eq("season", 2027);

  if (!total) {
    console.log(`| ${t.display_name ?? t.name} | 0 | — | — | — | — | — | — |`);
    continue;
  }

  const { count: nullDepth } = await (sb as any)
    .from("player_predictions")
    .select("id", { count: "exact", head: true })
    .eq("customer_team_id", t.id).eq("variant", "precomputed").eq("model_type", "transfer").eq("season", 2027)
    .is("hitter_depth_role", null);

  const counts: Record<string, number> = {};
  for (const ct of ["FS", "SJ", "JS", "GR"]) {
    const { count } = await (sb as any)
      .from("player_predictions")
      .select("id", { count: "exact", head: true })
      .eq("customer_team_id", t.id).eq("variant", "precomputed").eq("model_type", "transfer").eq("season", 2027)
      .eq("class_transition", ct);
    counts[ct] = count ?? 0;
  }
  const { count: nullCt } = await (sb as any)
    .from("player_predictions")
    .select("id", { count: "exact", head: true })
    .eq("customer_team_id", t.id).eq("variant", "precomputed").eq("model_type", "transfer").eq("season", 2027)
    .is("class_transition", null);

  console.log(`| ${t.display_name ?? t.name} | ${total} | ${nullDepth} | ${counts.FS} | ${counts.SJ} | ${counts.JS} | ${counts.GR} | ${nullCt} |`);
}
