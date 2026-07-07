/**
 * Read-only prod dive:
 *  (A) The 4,623 NULL class_transition rows — by team, variant, class_year
 *  (B) The 2,045 wrong-value rows — what's the pattern of stored→expected?
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

async function pullAll() {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (PROD as any)
      .from("player_predictions")
      .select("player_id, customer_team_id, variant, class_transition, updated_at, created_at, players!inner(class_year, first_name, last_name, division, team)")
      .eq("season", 2027).order("id").range(from, from + 999);
    if (error) { console.log("err", error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

const rows = await pullAll();
console.log(`Total prod 2027 rows: ${rows.length}`);

// Partition into the two categories
const nullCtRows: any[] = [];
const wrongCtRows: any[] = [];
for (const r of rows) {
  const cy = r.players?.class_year;
  const exp = expected(cy);
  if (exp == null) continue;
  if (r.class_transition === exp) continue;
  // mismatch
  if (r.players?.division !== "D1" && r.players?.division !== "NCAA D1" && r.players?.division !== "BBC") continue;
  if (r.class_transition == null) nullCtRows.push(r);
  else wrongCtRows.push(r);
}
console.log(`\nD1 NULL ct: ${nullCtRows.length}`);
console.log(`D1 wrong-value ct: ${wrongCtRows.length}`);

// =============== (A) NULL ct breakdown ===============
console.log("\n========== (A) NULL class_transition rows ==========");

// By customer team
const byTeam: Record<string, number> = {};
for (const r of nullCtRows) {
  const k = r.customer_team_id ?? "(global)";
  byTeam[k] = (byTeam[k] || 0) + 1;
}
console.log(`\nBy customer_team_id:`);
for (const [k, v] of Object.entries(byTeam).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.slice(0,8).padEnd(10)} ${v}`);

// By variant
const byVariant: Record<string, number> = {};
for (const r of nullCtRows) {
  byVariant[r.variant] = (byVariant[r.variant] || 0) + 1;
}
console.log(`\nBy variant:`);
for (const [k, v] of Object.entries(byVariant).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(12)} ${v}`);

// By class_year
const byCy: Record<string, number> = {};
for (const r of nullCtRows) {
  byCy[r.players?.class_year ?? "NULL"] = (byCy[r.players?.class_year ?? "NULL"] || 0) + 1;
}
console.log(`\nBy class_year:`);
for (const [k, v] of Object.entries(byCy).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(8)} ${v}`);

// By players' team (their D1 school)
const byPlayerTeam: Record<string, number> = {};
for (const r of nullCtRows) {
  byPlayerTeam[r.players?.team ?? "?"] = (byPlayerTeam[r.players?.team ?? "?"] || 0) + 1;
}
console.log(`\nTop 15 player-teams with NULL ct:`);
for (const [k, v] of Object.entries(byPlayerTeam).sort((a,b)=>b[1]-a[1]).slice(0,15)) console.log(`  ${k.padEnd(28)} ${v}`);

// Timestamps — when were these last touched?
const updateDates: Record<string, number> = {};
for (const r of nullCtRows) {
  const d = (r.updated_at ?? "").slice(0,10);
  updateDates[d] = (updateDates[d] || 0) + 1;
}
console.log(`\nLast-updated date distribution:`);
for (const [k, v] of Object.entries(updateDates).sort((a,b)=>b[1]-a[1]).slice(0,10)) console.log(`  ${k.padEnd(12)} ${v}`);

// =============== (B) Wrong-value ct breakdown ===============
console.log("\n========== (B) Wrong-value class_transition rows ==========");

// Pattern: cy → stored → expected
const patterns: Record<string, number> = {};
for (const r of wrongCtRows) {
  const k = `${r.players?.class_year} stored=${r.class_transition} expected=${expected(r.players?.class_year)}`;
  patterns[k] = (patterns[k] || 0) + 1;
}
console.log(`\nPatterns (cy → stored vs expected):`);
for (const [k, v] of Object.entries(patterns).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(50)} ${v}`);

// By customer_team_id
const wrongByTeam: Record<string, number> = {};
for (const r of wrongCtRows) {
  const k = r.customer_team_id?.slice(0,8) ?? "(global)";
  wrongByTeam[k] = (wrongByTeam[k] || 0) + 1;
}
console.log(`\nBy customer_team_id:`);
for (const [k, v] of Object.entries(wrongByTeam).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(10)} ${v}`);

// By variant
const wrongByVariant: Record<string, number> = {};
for (const r of wrongCtRows) {
  wrongByVariant[r.variant] = (wrongByVariant[r.variant] || 0) + 1;
}
console.log(`\nBy variant:`);
for (const [k, v] of Object.entries(wrongByVariant).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(12)} ${v}`);

// Timestamps
const wrongDates: Record<string, number> = {};
for (const r of wrongCtRows) {
  const d = (r.updated_at ?? "").slice(0,10);
  wrongDates[d] = (wrongDates[d] || 0) + 1;
}
console.log(`\nLast-updated date distribution:`);
for (const [k, v] of Object.entries(wrongDates).sort((a,b)=>b[1]-a[1]).slice(0,10)) console.log(`  ${k.padEnd(12)} ${v}`);
