import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// For each combination, count rows where player.class_year = X and prediction.class_transition != Y
const tests = [
  { cy: "FR", expected_ct: "FS" },
  { cy: "R-FR", expected_ct: "FS" }, // per prod observed behavior
  { cy: "SO", expected_ct: "SJ" },
  { cy: "R-SO", expected_ct: "SJ" }, // ???
  { cy: "JR", expected_ct: "JS" },
  { cy: "R-JR", expected_ct: "JS" }, // per prod observed behavior
  { cy: "SR", expected_ct: "GR" },
];

for (const [label, sb] of [["STAGING", STAGING], ["PROD", PROD]] as const) {
  console.log(`\n=== ${label} ===`);
  for (const t of tests) {
    // Get ALL distinct class_transition values for this class_year on 2027 precomputed
    const { data, error } = await (sb as any)
      .from("player_predictions")
      .select("class_transition, players!inner(class_year)")
      .eq("season", 2027)
      .eq("variant", "precomputed")
      .eq("players.class_year", t.cy)
      .limit(5000);
    if (error) { console.log(`  ${t.cy}: err ${error.message}`); continue; }
    const dist: Record<string, number> = {};
    for (const r of (data || [])) {
      const ct = r.class_transition ?? "NULL";
      dist[ct] = (dist[ct] || 0) + 1;
    }
    const distStr = Object.entries(dist).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(", ");
    console.log(`  class_year=${t.cy.padEnd(5)}  →  ${distStr}`);
  }
}
