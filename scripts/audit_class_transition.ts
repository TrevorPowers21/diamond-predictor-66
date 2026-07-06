/**
 * Audit class_transition drift on prod vs staging.
 *
 * Compare each prediction row's class_transition against what would be
 * inferred from the player's class_year. Reports rows that DIFFER —
 * those are the ones the SQL UPDATE would touch.
 */
import { createClient } from "@supabase/supabase-js";

const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function expectedFromClassYear(cy: string | null | undefined): string | null {
  switch (cy) {
    case "FR": return "FS";
    case "R-FR": return "SJ";
    case "SO": return "SJ";
    case "R-SO": return "JS";
    case "JR": return "JS";
    case "R-JR": return "GR";
    case "SR": return "GR";
    default: return null;
  }
}

async function audit(label: string, sb: any) {
  // Pull all 2027 precomputed rows + their player class_year
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("player_predictions")
      .select("player_id, customer_team_id, variant, class_transition, players!inner(class_year, first_name, last_name)")
      .eq("season", 2027)
      .eq("variant", "precomputed")
      .order("id")
      .range(from, from + 999);
    if (error) { console.log("err", error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`\n=== ${label}: ${all.length} 2027 precomputed rows ===`);

  // Tally mismatches
  let total = 0, matches = 0, mismatches = 0, unknown = 0;
  const sample: any[] = [];
  for (const r of all) {
    total++;
    const cy = r.players?.class_year;
    const expected = expectedFromClassYear(cy);
    if (expected == null) { unknown++; continue; }
    if (expected === r.class_transition) matches++;
    else {
      mismatches++;
      if (sample.length < 10) sample.push({
        name: `${r.players.first_name} ${r.players.last_name}`,
        cy, ct_stored: r.class_transition, ct_expected: expected, team: r.customer_team_id?.slice(0,8),
      });
    }
  }
  console.log(`  matches:    ${matches}`);
  console.log(`  mismatches: ${mismatches}`);
  console.log(`  unknown class_year (skipped): ${unknown}`);
  if (sample.length) {
    console.log(`  sample mismatches:`);
    for (const s of sample) console.log(`    ${s.name.padEnd(28)} class_year=${s.cy?.padEnd(5)} stored=${s.ct_stored?.padEnd(3)} expected=${s.ct_expected} team=${s.team}`);
  }
}

await audit("STAGING", STAGING);
await audit("PROD", PROD);
