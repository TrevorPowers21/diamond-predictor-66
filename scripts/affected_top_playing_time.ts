/**
 * Top D1 affected players (broken ct or NULL class_year) by playing time.
 * Read-only.
 */
import { createClient } from "@supabase/supabase-js";
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function expected(cy: string | null | undefined): string | null {
  switch (cy) {
    case "FR": case "R-FR": return "FS";
    case "SO": case "R-SO": return "SJ";
    case "JR": case "R-JR": return "JS";
    case "SR": case "R-SR": case "GR": return "GR";
    default: return null;
  }
}

const all: any[] = [];
let from = 0;
while (true) {
  const { data, error } = await (PROD as any)
    .from("player_predictions")
    .select("player_id, class_transition, players!inner(class_year, division, team, first_name, last_name, position, ab, ip)")
    .eq("season", 2027).order("id").range(from, from + 999);
  if (error) { console.log("err", error.message); break; }
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

// Determine which D1 players are "affected"
type Issue = "NULL_ct" | "WRONG_ct" | "NULL_class_year";
const byPlayer: Record<string, { issue: Issue; meta: any }> = {};
for (const r of all) {
  if (r.players?.division !== "D1") continue;
  const pid = r.player_id;
  const cy = r.players?.class_year;
  const meta = r.players;
  if (cy == null) {
    if (!byPlayer[pid]) byPlayer[pid] = { issue: "NULL_class_year", meta };
    continue;
  }
  const exp = expected(cy);
  if (exp == null) continue;
  if (r.class_transition == null) {
    if (!byPlayer[pid] || byPlayer[pid].issue === "NULL_class_year") byPlayer[pid] = { issue: "NULL_ct", meta };
  } else if (r.class_transition !== exp) {
    if (!byPlayer[pid] || byPlayer[pid].issue === "NULL_class_year") byPlayer[pid] = { issue: "WRONG_ct", meta };
  }
}

const affected = Object.entries(byPlayer).map(([pid, v]) => ({
  pid, issue: v.issue, meta: v.meta,
  ab: Number(v.meta?.ab ?? 0),
  ip: Number(v.meta?.ip ?? 0),
}));

console.log(`Affected D1 players total: ${affected.length}`);

// HITTERS — top 25 by AB
const hitters = affected
  .filter(p => p.ab > 0)
  .sort((a, b) => b.ab - a.ab)
  .slice(0, 25);
console.log(`\n=== TOP 25 AFFECTED HITTERS BY AB ===`);
console.log(`${"Name".padEnd(28)} ${"Team".padEnd(28)} ${"Pos".padEnd(5)} ${"Class".padEnd(6)} ${"AB".padStart(5)} ${"Issue"}`);
for (const p of hitters) {
  console.log(`${(p.meta.first_name + " " + p.meta.last_name).padEnd(28)} ${(p.meta.team ?? "?").padEnd(28)} ${(p.meta.position ?? "?").padEnd(5)} ${(p.meta.class_year ?? "NULL").padEnd(6)} ${String(p.ab).padStart(5)} ${p.issue}`);
}

// PITCHERS — top 25 by IP
const pitchers = affected
  .filter(p => p.ip > 0)
  .sort((a, b) => b.ip - a.ip)
  .slice(0, 25);
console.log(`\n=== TOP 25 AFFECTED PITCHERS BY IP ===`);
console.log(`${"Name".padEnd(28)} ${"Team".padEnd(28)} ${"Pos".padEnd(5)} ${"Class".padEnd(6)} ${"IP".padStart(6)} ${"Issue"}`);
for (const p of pitchers) {
  console.log(`${(p.meta.first_name + " " + p.meta.last_name).padEnd(28)} ${(p.meta.team ?? "?").padEnd(28)} ${(p.meta.position ?? "?").padEnd(5)} ${(p.meta.class_year ?? "NULL").padEnd(6)} ${String(p.ip).padStart(6)} ${p.issue}`);
}

// Summary by issue type — total AB/IP affected
const sumByIssue: Record<string, { count: number; ab: number; ip: number; topAB: number; topIP: number }> = {};
for (const p of affected) {
  if (!sumByIssue[p.issue]) sumByIssue[p.issue] = { count: 0, ab: 0, ip: 0, topAB: 0, topIP: 0 };
  sumByIssue[p.issue].count++;
  sumByIssue[p.issue].ab += p.ab;
  sumByIssue[p.issue].ip += p.ip;
  if (p.ab >= 100) sumByIssue[p.issue].topAB++;
  if (p.ip >= 30) sumByIssue[p.issue].topIP++;
}
console.log(`\n=== SUMMARY BY ISSUE ===`);
for (const [issue, s] of Object.entries(sumByIssue)) {
  console.log(`  ${issue.padEnd(18)} players=${s.count}  total_AB=${s.ab}  total_IP=${Math.round(s.ip)}  100+AB=${s.topAB}  30+IP=${s.topIP}`);
}
