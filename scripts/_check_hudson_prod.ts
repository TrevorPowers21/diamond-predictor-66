import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

function readEnvFile(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

const prodEnv = readEnvFile(".env.production.local");
const prod = createClient(prodEnv.VITE_SUPABASE_URL || prodEnv.SUPABASE_URL, prodEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  // Look up Hudson Brown in prod
  const { data: hudson } = await (prod as any).from("Hitter Master").select("playerFullName, pa, regular_season_pa, source_player_id, Season").ilike("playerFullName", "%Hudson%Brown%").eq("Season", 2026);
  console.log("Prod Hitter Master by name:");
  for (const r of hudson ?? []) console.log(`  ${r.playerFullName} pa=${r.pa} regular_season_pa=${r.regular_season_pa} sid=${r.source_player_id} season=${r.Season}`);

  const { data: bySid } = await (prod as any).from("Hitter Master").select("playerFullName, pa, regular_season_pa, source_player_id, Season").eq("source_player_id", "1342167668").eq("Season", 2026);
  console.log("\nProd Hitter Master by sid 1342167668:");
  for (const r of bySid ?? []) console.log(`  ${r.playerFullName} pa=${r.pa} regular_season_pa=${r.regular_season_pa} sid=${r.source_player_id} season=${r.Season}`);

  // What's the prod row count?
  const { data: probe } = await (prod as any).from("Hitter Master").select("source_player_id, pa").eq("Season", 2026).limit(3);
  console.log("\nProd Hitter Master sample:", JSON.stringify(probe, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
