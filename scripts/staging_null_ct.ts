import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const all: any[] = [];
let from = 0;
while (true) {
  const { data, error } = await (STAGING as any)
    .from("player_predictions")
    .select("player_id, customer_team_id, variant, class_transition, players!inner(class_year, division, team, first_name, last_name)")
    .eq("season", 2027).range(from, from + 999);
  if (error) { console.log("err", error.message); break; }
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}

console.log(`Total staging 2027 rows: ${all.length}`);

const nullCtKnownCy = all.filter(r => r.class_transition == null && r.players?.class_year != null);
const nullCtNullCy = all.filter(r => r.class_transition == null && r.players?.class_year == null);
const knownCtNullCy = all.filter(r => r.class_transition != null && r.players?.class_year == null);

console.log(`\n=== NULL class_transition breakdown ===`);
console.log(`  NULL ct + KNOWN class_year (fixable):     ${nullCtKnownCy.length}`);
console.log(`  NULL ct + NULL class_year (unfixable):    ${nullCtNullCy.length}`);
console.log(`  Known ct + NULL class_year (left alone):  ${knownCtNullCy.length}`);

// Distinct players in fixable bucket
const fixablePlayers = new Set(nullCtKnownCy.map(r => r.player_id));
console.log(`\n  Distinct players in fixable bucket: ${fixablePlayers.size}`);

// By division
const fixableByDiv: Record<string, number> = {};
for (const r of nullCtKnownCy) {
  const div = r.players?.division ?? "?";
  fixableByDiv[div] = (fixableByDiv[div] || 0) + 1;
}
console.log(`\n  Fixable bucket by division:`);
for (const [k,v] of Object.entries(fixableByDiv).sort((a,b)=>b[1]-a[1])) console.log(`    ${k.padEnd(12)} ${v}`);

// By variant
const fixableByVariant: Record<string, number> = {};
for (const r of nullCtKnownCy) {
  fixableByVariant[r.variant] = (fixableByVariant[r.variant] || 0) + 1;
}
console.log(`\n  Fixable bucket by variant:`);
for (const [k,v] of Object.entries(fixableByVariant).sort((a,b)=>b[1]-a[1])) console.log(`    ${k.padEnd(12)} ${v}`);

// Sample
console.log(`\n  Sample fixable (NULL ct + known class_year):`);
for (const r of nullCtKnownCy.slice(0,10)) {
  console.log(`    ${(r.players?.first_name + " " + r.players?.last_name).padEnd(28)} cy=${r.players?.class_year?.padEnd(5)} team=${r.players?.team} variant=${r.variant} div=${r.players?.division}`);
}
