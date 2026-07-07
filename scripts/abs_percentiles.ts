import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

function fmt(n: number, d = 1): string {
  if (Number.isNaN(n)) return "—";
  return n.toFixed(d);
}

async function fetchAll(table: string): Promise<any[]> {
  const all: any[] = [];
  let from = 0;
  const page = 1000;
  while (true) {
    const { data, error } = await (sb as any).from(table).select("*").range(from, from + page - 1);
    if (error) { console.log("err", error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < page) break;
    from += page;
  }
  return all;
}

function distribution(label: string, currentVals: number[], absVals: number[]) {
  const deltas = currentVals.map((c, i) => (absVals[i] != null && c != null) ? absVals[i] - c : NaN).filter((d) => Number.isFinite(d));
  const validCurrent = currentVals.filter((v) => Number.isFinite(v));
  const validAbs = absVals.filter((v) => Number.isFinite(v));
  console.log(`\n${label}  (N current=${validCurrent.length}, ABS=${validAbs.length}, delta-pairs=${deltas.length})`);
  console.log(`  current:  P10=${fmt(pct(validCurrent, 10))}  P25=${fmt(pct(validCurrent, 25))}  P50=${fmt(pct(validCurrent, 50))}  P75=${fmt(pct(validCurrent, 75))}  P90=${fmt(pct(validCurrent, 90))}`);
  console.log(`  abs:      P10=${fmt(pct(validAbs, 10))}  P25=${fmt(pct(validAbs, 25))}  P50=${fmt(pct(validAbs, 50))}  P75=${fmt(pct(validAbs, 75))}  P90=${fmt(pct(validAbs, 90))}`);
  console.log(`  delta:    P10=${fmt(pct(deltas, 10))}  P25=${fmt(pct(deltas, 25))}  P50=${fmt(pct(deltas, 50))}  P75=${fmt(pct(deltas, 75))}  P90=${fmt(pct(deltas, 90))}`);
  // Also report |delta| percentiles — for "how big is a typical absolute change"
  const absDelta = deltas.map(Math.abs);
  console.log(`  |delta|:  P50=${fmt(pct(absDelta, 50))}  P75=${fmt(pct(absDelta, 75))}  P90=${fmt(pct(absDelta, 90))}`);
}

console.log("=== HITTER metric distributions (staging abs_hitter_stats) ===");
const h = await fetchAll("abs_hitter_stats");
console.log(`Total rows: ${h.length}`);
distribution("In-Zone Barrel %", h.map((r) => r.iz_barrel_pct), h.map((r) => r.abs_iz_barrel_pct));
distribution("In-Zone Swing %",  h.map((r) => r.iz_swing_pct),  h.map((r) => r.abs_iz_swing_pct));
distribution("In-Zone Exit Velo", h.map((r) => r.iz_exit_velo), h.map((r) => r.abs_iz_exit_velo));
distribution("In-Zone Whiff %",  h.map((r) => r.iz_whiff_pct),  h.map((r) => r.abs_iz_whiff_pct));
distribution("Chase %",          h.map((r) => r.chase_pct),     h.map((r) => r.abs_chase_pct));

console.log("\n\n=== PITCHER metric distributions (staging abs_pitcher_stats) ===");
const p = await fetchAll("abs_pitcher_stats");
console.log(`Total rows: ${p.length}`);
distribution("Chase %",         p.map((r) => r.chase_pct),    p.map((r) => r.abs_chase_pct));
distribution("In-Zone Whiff %", p.map((r) => r.iz_whiff_pct), p.map((r) => r.abs_iz_whiff_pct));
distribution("CSW %",           p.map((r) => r.csw_pct),      p.map((r) => r.abs_csw_pct));
distribution("Strike %",        p.map((r) => r.strike_pct),   p.map((r) => r.abs_strike_pct));
distribution("In-Zone %",       p.map((r) => r.iz_pct),       p.map((r) => r.abs_iz_pct));
