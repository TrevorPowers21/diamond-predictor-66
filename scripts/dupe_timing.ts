import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

// Pull all dupes with timestamps
const all: any[] = [];
let from = 0;
const PAGE = 1000;
while (true) {
  const { data, error } = await (sb as any)
    .from("player_predictions")
    .select("id, player_id, customer_team_id, variant, model_type, status, created_at, updated_at, p_wrc_plus")
    .eq("season", 2027)
    .eq("model_type", "returner")
    .eq("variant", "regular")
    .is("customer_team_id", null)
    .range(from, from + PAGE - 1);
  if (error) { console.error(error); break; }
  all.push(...(data || []));
  if (!data || data.length < PAGE) break;
  from += PAGE;
}

const byPlayer = new Map<string, any[]>();
for (const r of all) {
  if (!r.player_id) continue;
  const arr = byPlayer.get(r.player_id) || [];
  arr.push(r);
  byPlayer.set(r.player_id, arr);
}

let dupePlayers = 0;
const createdHisto: Record<string, number> = {};
const updatedHisto: Record<string, number> = {};
const sameContent: { same: number; diff: number } = { same: 0, diff: 0 };
const examples: any[] = [];
for (const [pid, rows] of byPlayer.entries()) {
  if (rows.length < 2) continue;
  dupePlayers++;
  for (const r of rows) {
    const cKey = (r.created_at || "").slice(0, 10);
    const uKey = (r.updated_at || "").slice(0, 10);
    createdHisto[cKey] = (createdHisto[cKey] ?? 0) + 1;
    updatedHisto[uKey] = (updatedHisto[uKey] ?? 0) + 1;
  }
  const wrcs = new Set(rows.map((r) => r.p_wrc_plus));
  if (wrcs.size === 1) sameContent.same++; else sameContent.diff++;
  if (examples.length < 5) {
    examples.push({
      pid,
      rows: rows.map((r) => ({ id: r.id, p_wrc_plus: r.p_wrc_plus, created_at: r.created_at, updated_at: r.updated_at, status: r.status })),
    });
  }
}

console.log(`Total dupe players: ${dupePlayers}`);
console.log(`Same p_wrc_plus across dupes: ${sameContent.same}  Different: ${sameContent.diff}`);
console.log(`\ncreated_at distribution (top 10):`);
for (const [k, n] of Object.entries(createdHisto).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${k}: ${n}`);
console.log(`\nupdated_at distribution (top 10):`);
for (const [k, n] of Object.entries(updatedHisto).sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${k}: ${n}`);
console.log(`\nExamples:`);
for (const e of examples) console.log(JSON.stringify(e, null, 2));
