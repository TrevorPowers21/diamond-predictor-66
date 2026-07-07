import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function loadAll<T>(builder: () => any): Promise<T[]> {
  const out: any[] = []; let from = 0;
  while (true) {
    const { data, error } = await builder().range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

const { data: teams } = await (sb as any)
  .from("customer_teams")
  .select("id, name").eq("active", true).not("name", "ilike", "%All-Americans%").order("name");

const EXPECTED_H = 1520;
const EXPECTED_P = 1018;

console.log(`Team                                  hitter   pitcher  total  short`);
for (const t of teams ?? []) {
  const rows = await loadAll<any>(() =>
    (sb as any).from("player_predictions")
      .select("p_avg, p_era, players!inner(division)")
      .eq("customer_team_id", t.id).eq("variant", "precomputed").eq("model_type", "transfer").eq("season", 2027)
      .eq("players.division", "NJCAA_D1"));
  let h = 0, p = 0;
  for (const r of rows) {
    if (r.p_avg != null) h++;
    if (r.p_era != null) p++;
  }
  const short = (h < EXPECTED_H ? "H" : "") + (p < EXPECTED_P ? "P" : "");
  const marker = short ? `← short ${EXPECTED_H - h} hitters, ${EXPECTED_P - p} pitchers` : "✓";
  console.log(`${t.name.padEnd(38)} ${String(h).padStart(6)}  ${String(p).padStart(8)}  ${String(rows.length).padStart(5)}  ${marker}`);
}
