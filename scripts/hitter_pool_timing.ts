import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function timeRun(label: string, withOrder: boolean) {
  const t0 = performance.now();
  const all: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let q = (sb as any)
      .from("Hitter Master")
      .select("source_player_id, playerFullName, Team, TeamID, Conference, conference_id, Season, Pos, BatHand, ThrowHand, AVG, OBP, SLG, ISO, ab")
      .eq("Season", 2026);
    if (withOrder) q = q.order("source_player_id", { ascending: true });
    q = q.range(from, from + pageSize - 1);
    const { data, error } = await q;
    if (error) { console.log("err:", error.message); break; }
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  const ms = Math.round(performance.now() - t0);
  console.log(`${label}: ${all.length} rows in ${ms}ms`);
  return { ms, count: all.length };
}

await timeRun("warmup", false);
console.log("");

const noOrder: number[] = [];
const withOrder: number[] = [];
for (let i = 0; i < 3; i++) {
  noOrder.push((await timeRun(`no order #${i+1}`, false)).ms);
  withOrder.push((await timeRun(`with order #${i+1}`, true)).ms);
}

const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
console.log(`\nAvg WITHOUT .order(): ${avg(noOrder)}ms`);
console.log(`Avg WITH .order():    ${avg(withOrder)}ms`);
console.log(`Diff: ${avg(withOrder) - avg(noOrder)}ms`);
