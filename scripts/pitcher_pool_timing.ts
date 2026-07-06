import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function timeRun(label: string, withOrder: boolean) {
  const t0 = performance.now();
  const all: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let q = (sb as any)
      .from("Pitching Master")
      .select("*")
      .eq("Season", 2026)
      .gte("IP", 10)
      .not("Role", "in", "(C,1B,2B,3B,SS,OF,LF,CF,RF,DH,IF,UT)");
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
  return ms;
}

// Warm-up
await timeRun("warmup (no order)", false);
console.log("");

// 3 runs each, alternating to balance any caching
const noOrder: number[] = [];
const withOrder: number[] = [];
for (let i = 0; i < 3; i++) {
  noOrder.push(await timeRun(`no order #${i+1}`, false));
  withOrder.push(await timeRun(`with order #${i+1}`, true));
}

const avg = (arr: number[]) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
console.log(`\nAvg WITHOUT .order(): ${avg(noOrder)}ms`);
console.log(`Avg WITH .order():    ${avg(withOrder)}ms`);
console.log(`Diff: ${avg(withOrder) - avg(noOrder)}ms`);
