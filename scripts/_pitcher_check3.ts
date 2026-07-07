import { createClient } from "@supabase/supabase-js";
const sb = createClient("https://trbvxuoliwrfowibatkm.supabase.co", process.env.PROD_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const sample: any[] = [];
let from = 0;
while (sample.length < 50000) {
  const { data } = await (sb as any).from("player_predictions").select("model_type").range(from, from+999);
  if (!data || data.length === 0) break;
  sample.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
const mtDist: Record<string, number> = {};
for (const r of sample) mtDist[r.model_type ?? "NULL"] = (mtDist[r.model_type ?? "NULL"] || 0) + 1;
console.log("model_type distribution (first 50k rows):");
for (const [k,v] of Object.entries(mtDist).sort((a,b)=>b[1]-a[1])) console.log(`  ${k.padEnd(30)} ${v}`);

const { count: pitcherPreds } = await (sb as any)
  .from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
  .in("players.position", ["P","SP","RP"]).eq("season", 2027);
console.log(`\n2027 pitcher predictions (join players.position IN P/SP/RP): ${pitcherPreds}`);

const { count: hitterPreds } = await (sb as any)
  .from("player_predictions").select("*, players!inner(position)", { count: "exact", head: true })
  .not("players.position", "in", "(P,SP,RP)").eq("season", 2027);
console.log(`2027 hitter predictions (NOT P/SP/RP): ${hitterPreds}`);
