import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

console.log("=== customer_teams matching Georgia ===");
const { data } = await (sb as any)
  .from("customer_teams")
  .select("id, name, school_team_id, slug")
  .or("name.ilike.%georgia%,slug.ilike.%georgia%");
console.log(JSON.stringify(data, null, 2));

console.log("\n=== teams table — Georgia row (resolves school_team_id) ===");
if (data?.[0]?.school_team_id) {
  const { data: team } = await (sb as any)
    .from("teams")
    .select("id, name, abbreviation, fullName, conference, source_team_id")
    .eq("id", data[0].school_team_id)
    .maybeSingle();
  console.log(JSON.stringify(team, null, 2));
}
