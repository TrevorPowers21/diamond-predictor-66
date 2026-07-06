import { createClient } from "@supabase/supabase-js";
const STAGING = createClient("https://slrxowawbijbjrkozqlj.supabase.co", process.env.STAGING_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const PROD = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function getCols(sb: any, table: string): Promise<string[]> {
  const { data } = await sb.from(table).select("*").limit(1);
  return Object.keys(data?.[0] || {}).sort();
}

for (const table of ["Hitter Master", "Pitching Master"]) {
  const sCols = new Set(await getCols(STAGING, table));
  const pCols = new Set(await getCols(PROD, table));
  const onlyStaging = [...sCols].filter((c) => !pCols.has(c));
  const onlyProd = [...pCols].filter((c) => !sCols.has(c));
  console.log(`\n=== ${table} schema diff ===`);
  console.log(`  staging cols: ${sCols.size}, prod cols: ${pCols.size}`);
  console.log(`  ONLY ON STAGING (${onlyStaging.length}): ${onlyStaging.join(", ")}`);
  console.log(`  ONLY ON PROD    (${onlyProd.length}): ${onlyProd.join(", ")}`);
}
