import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Top pitchers by IP
const { data: pitchers } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("first_name, last_name, current_school, position, conference, ip, ab, reason")
  .eq("resolved", false)
  .in("reason", ["no_match", "no_stats", "ambiguous"])
  .in("position", ["SP", "RP", "CL", "P", "LHP", "RHP"])
  .not("ip", "is", null)
  .order("ip", { ascending: false })
  .limit(15);

console.log("## Top 15 unmatched PITCHERS by IP\n");
console.log("| Player | School | Conf | Pos | IP | Reason |");
console.log("|---|---|---|---|---|---|");
for (const p of pitchers || []) {
  console.log(`| ${p.first_name} ${p.last_name} | ${p.current_school ?? "—"} | ${p.conference ?? "—"} | ${p.position ?? "—"} | ${p.ip} | ${p.reason} |`);
}

// Top hitters by AB — exclude pitcher positions
const pitcherPos = ["SP", "RP", "CL", "P", "LHP", "RHP"];
const { data: hitters } = await (sb as any)
  .from("portal_entries_unmatched")
  .select("first_name, last_name, current_school, position, conference, ip, ab, reason")
  .eq("resolved", false)
  .not("position", "in", `(${pitcherPos.join(",")})`)
  .not("ab", "is", null)
  .order("ab", { ascending: false })
  .limit(15);

console.log("\n## Top 15 unmatched HITTERS by AB\n");
console.log("| Player | School | Conf | Pos | AB | Reason |");
console.log("|---|---|---|---|---|---|");
for (const p of hitters || []) {
  console.log(`| ${p.first_name} ${p.last_name} | ${p.current_school ?? "—"} | ${p.conference ?? "—"} | ${p.position ?? "—"} | ${p.ab} | ${p.reason} |`);
}
