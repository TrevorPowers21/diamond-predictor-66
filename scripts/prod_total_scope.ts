/**
 * Total scope of class_transition problems on PROD.
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

async function pullAll() {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (PROD as any)
      .from("player_predictions")
      .select("player_id, customer_team_id, variant, class_transition, players!inner(class_year, division, team)")
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

// All distinct class_year values seen
const cyDist: Record<string, number> = {};
for (const r of rows) cyDist[r.players?.class_year ?? "NULL"] = (cyDist[r.players?.class_year ?? "NULL"] || 0) + 1;
console.log(`\nAll class_year values seen (rows):`);
for (const [k,v] of Object.entries(cyDist).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(10)} ${v}  ${expected(k as any) == null ? "(UNMAPPED)" : ""}`);

// Distinct players in each problem bucket
const nullCtPlayers = new Set<string>();
const wrongCtPlayers = new Set<string>();
const nullCyPlayers = new Set<string>();
const unmappedKnownCyPlayers = new Set<string>();
const cleanPlayers = new Set<string>();

for (const r of rows) {
  const cy = r.players?.class_year;
  const exp = expected(cy);
  const pid = r.player_id;
  if (cy == null) { nullCyPlayers.add(pid); continue; }
  if (exp == null) { unmappedKnownCyPlayers.add(pid); continue; }
  if (r.class_transition == null) nullCtPlayers.add(pid);
  else if (r.class_transition !== exp) wrongCtPlayers.add(pid);
  else cleanPlayers.add(pid);
}

const allPlayers = new Set([...nullCtPlayers, ...wrongCtPlayers, ...nullCyPlayers, ...unmappedKnownCyPlayers, ...cleanPlayers]);
console.log(`\nDISTINCT PLAYER COUNTS:`);
console.log(`  Total distinct players in prod 2027:       ${allPlayers.size}`);
console.log(`  Clean (all rows correct ct):               ${cleanPlayers.size}`);
console.log(`  Players with at least 1 NULL ct row:       ${nullCtPlayers.size}`);
console.log(`  Players with at least 1 wrong-value ct:    ${wrongCtPlayers.size}`);
console.log(`  Players with NULL class_year (unmappable): ${nullCyPlayers.size}`);
console.log(`  Players with KNOWN-but-unmapped class_year:${unmappedKnownCyPlayers.size}`);

// Overlap between null-ct and wrong-value buckets
const overlap = [...nullCtPlayers].filter(p => wrongCtPlayers.has(p));
console.log(`\n  Overlap (in both NULL & wrong buckets):    ${overlap.length}`);
console.log(`  Union (broken-ct players, distinct):       ${new Set([...nullCtPlayers, ...wrongCtPlayers]).size}`);
