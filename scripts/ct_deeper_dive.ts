/**
 * Deeper dive — read-only:
 *  (A) PROD mismatches: are they D1 (BBC) or JUCO (NJCAA_D1)?
 *  (B) Staging NULL class_year rows: who are they? Sample 15.
 *  (C) GR / R-SR distribution: would mapping them to GR actually flag fewer or more issues?
 */
import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function expected(cy: string | null | undefined): string | null {
  switch (cy) {
    case "FR": case "R-FR": return "FS";
    case "SO": case "R-SO": return "SJ";
    case "JR": case "R-JR": return "JS";
    case "SR": case "R-SR": case "GR": return "GR"; // <- expanded mapping
    default: return null;
  }
}

async function pullAll(sb: any) {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("player_predictions")
      .select("player_id, customer_team_id, variant, class_transition, players!inner(class_year, first_name, last_name, division, team, conference)")
      .eq("season", 2027).order("id").range(from, from + 999);
    if (error) { console.log("err", error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

// ============== (A) PROD mismatches by team_level ==============
console.log("========== (A) PROD mismatches — D1 vs JUCO ==========");
{
  const rows = await pullAll(PROD);
  let bbcMismatch = 0, njcaaMismatch = 0, otherMismatch = 0;
  let bbcNullCt = 0, njcaaNullCt = 0;
  const samplesByLevel: Record<string, any[]> = {};
  for (const r of rows) {
    const cy = r.players?.class_year;
    const exp = expected(cy);
    if (exp == null) continue;
    if (r.class_transition === exp) continue;
    const level = r.players?.division ?? "(unknown)";
    if (level === "NCAA D1" || level === "BBC" || level === "D1") {
      bbcMismatch++;
      if (r.class_transition == null) bbcNullCt++;
    } else if (level?.includes("NJCAA") || level?.includes("JUCO")) {
      njcaaMismatch++;
      if (r.class_transition == null) njcaaNullCt++;
    } else {
      otherMismatch++;
    }
    if (!samplesByLevel[level]) samplesByLevel[level] = [];
    if (samplesByLevel[level].length < 5) samplesByLevel[level].push({
      name: `${r.players?.first_name} ${r.players?.last_name}`,
      cy, stored: r.class_transition, expected: exp, team: r.players?.team, variant: r.variant,
    });
  }
  console.log(`  BBC (D1):      ${bbcMismatch} mismatches  (${bbcNullCt} are NULL class_transition)`);
  console.log(`  NJCAA_D1:      ${njcaaMismatch} mismatches  (${njcaaNullCt} are NULL class_transition)`);
  console.log(`  Other levels:  ${otherMismatch} mismatches`);
  console.log(`\n  Samples:`);
  for (const [lvl, samples] of Object.entries(samplesByLevel)) {
    console.log(`  --- ${lvl} ---`);
    for (const s of samples) console.log(`    ${s.name.padEnd(28)} cy=${s.cy?.padEnd(5)} stored=${String(s.stored).padEnd(4)} expected=${s.expected} team=${s.team} variant=${s.variant}`);
  }
}

// ============== (B) Staging NULL class_year — who are they? ==============
console.log("\n========== (B) Staging NULL class_year rows — spot check ==========");
{
  const { data } = await (STAGING as any)
    .from("player_predictions")
    .select("player_id, variant, customer_team_id, class_transition, players!inner(class_year, first_name, last_name, division, team, source_player_id)")
    .eq("season", 2027)
    .is("players.class_year", null)
    .limit(15);
  console.log(`  Sample of 15 NULL-class_year players on staging:`);
  for (const r of (data || [])) {
    console.log(`    ${(r.players?.first_name + " " + r.players?.last_name).padEnd(28)} team=${(r.players?.team ?? "?").padEnd(20)} level=${(r.players?.division ?? "?").padEnd(10)} variant=${r.variant.padEnd(11)} ct=${r.class_transition} src=${r.players?.source_player_id}`);
  }

  // Also: which team_levels do these NULL-class_year rows belong to?
  const { data: levelBreakdown } = await (STAGING as any)
    .from("player_predictions")
    .select("players!inner(division)")
    .eq("season", 2027)
    .is("players.class_year", null)
    .limit(20000);
  const lvlDist: Record<string, number> = {};
  for (const r of (levelBreakdown || [])) {
    const k = r.players?.division ?? "(unknown)";
    lvlDist[k] = (lvlDist[k] || 0) + 1;
  }
  console.log(`\n  NULL-class_year rows by team_level (capped at 20k):`);
  for (const [k, v] of Object.entries(lvlDist).sort((a,b)=>b[1]-a[1])) console.log(`    ${k.padEnd(12)} ${v}`);
}

// ============== (C) Distribution under expanded mapping (GR + R-SR → GR) ==============
console.log("\n========== (C) Re-audit with GR + R-SR → GR ==========");
for (const [label, sb] of [["STAGING", STAGING], ["PROD", PROD]] as const) {
  const rows = await pullAll(sb);
  let match = 0, mismatch = 0, unknown = 0;
  for (const r of rows) {
    const cy = r.players?.class_year;
    const exp = expected(cy);
    if (exp == null) { unknown++; continue; }
    if (r.class_transition === exp) match++; else mismatch++;
  }
  console.log(`  ${label}: matches=${match} mismatches=${mismatch} unknown=${unknown} (of ${rows.length})`);
}
