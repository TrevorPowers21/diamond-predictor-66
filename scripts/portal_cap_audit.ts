import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(url!, key!, { auth: { persistSession: false } });

// Distribution of portal_status players by entry date (last 7 days) and position
const today = new Date().toISOString().slice(0, 10);
const oneWeekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);

const { data: rows } = await (supabase as any)
  .from("players")
  .select("portal_entry_date, portal_status, position, portal_last_seen_at")
  .in("portal_status", ["IN PORTAL", "COMMITTED"])
  .gte("portal_entry_date", oneWeekAgo)
  .eq("division", "D1");

const byDate: Record<string, { total: number; in_portal: number; committed: number; pitcher: number; hitter: number }> = {};
const pitcherPos = new Set(["SP", "RP", "CL", "P", "LHP", "RHP"]);

for (const r of rows || []) {
  const d = r.portal_entry_date || "(null)";
  byDate[d] ||= { total: 0, in_portal: 0, committed: 0, pitcher: 0, hitter: 0 };
  byDate[d].total++;
  if (r.portal_status === "IN PORTAL") byDate[d].in_portal++;
  if (r.portal_status === "COMMITTED") byDate[d].committed++;
  if (pitcherPos.has(r.position)) byDate[d].pitcher++;
  else byDate[d].hitter++;
}

console.log(`# Portal entries by date (D1, last 7 days)\n`);
console.log("| Date | Total | IN PORTAL | COMMITTED | Pitchers | Hitters | Note |");
console.log("|---|---|---|---|---|---|---|");
const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
for (const d of sortedDates) {
  const s = byDate[d];
  const note = s.total >= 480 ? "**cap likely hit**" : "";
  console.log(`| ${d} | ${s.total} | ${s.in_portal} | ${s.committed} | ${s.pitcher} | ${s.hitter} | ${note} |`);
}

// Unmatched count today
const { count: unmatchedToday } = await (supabase as any)
  .from("portal_entries_unmatched")
  .select("id", { count: "exact", head: true })
  .eq("resolved", false);
console.log(`\n**Unresolved unmatched rows in portal_entries_unmatched: ${unmatchedToday ?? "—"}**`);

// How many were touched today (portal_last_seen_at = today)
const todayPrefix = today.slice(0, 10);
const seenToday = (rows || []).filter((r: any) => r.portal_last_seen_at && r.portal_last_seen_at.slice(0, 10) === todayPrefix).length;
console.log(`\nPlayers with portal_last_seen_at = today (${todayPrefix}): **${seenToday}**`);
console.log(`(Tells us how many distinct players today's CSV pulls have touched.)`);
