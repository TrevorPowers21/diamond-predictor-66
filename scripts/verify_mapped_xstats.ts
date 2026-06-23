import { createClient } from "@supabase/supabase-js";
const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const HITTER_XBA_LOOKUP: [number, number][] = [
  [0.0020, 0.0750], [0.1742, 0.2222], [0.2696, 0.2479], [0.3296, 0.2731],
  [0.3727, 0.2977], [0.4017, 0.3164], [0.4249, 0.3306], [0.4523, 0.3495],
  [0.4850, 0.3729], [0.5730, 0.4485],
];
const HITTER_XSLG_LOOKUP: [number, number][] = [
  [0.0026, 0.0980], [0.1454, 0.2771], [0.2857, 0.3301], [0.3735, 0.3627],
  [0.4226, 0.3860], [0.4734, 0.4188], [0.5158, 0.4472], [0.5604, 0.4800],
  [0.6103, 0.5153], [0.7367, 0.6045], [1.0967, 1.1569],
];
const interp = (t: [number, number][], x: number): number => {
  if (x <= t[0][0]) return t[0][1];
  if (x >= t[t.length-1][0]) return t[t.length-1][1];
  for (let i = 0; i < t.length - 1; i++) {
    const [x0, y0] = t[i]; const [x1, y1] = t[i+1];
    if (x >= x0 && x <= x1) return y0 + ((x-x0)/(x1-x0))*(y1-y0);
  }
  return t[t.length-1][1];
};

async function main() {
  const data: any[] = [];
  let from = 0;
  while (true) {
    const { data: page } = await (supabase as any)
      .from("pitch_log_hitter_totals")
      .select("ab, hits_single, hits_double, hits_triple, hits_hr, x_hits_sum, x_bases_sum")
      .eq("season", 2026)
      .eq("dimension_key", "all")
      .range(from, from + 999);
    if (!page || page.length === 0) break;
    data.push(...page);
    if (page.length < 1000) break;
    from += 1000;
  }
  const qual = data.filter((r: any) => r.ab >= 50);
  let tAB = 0, tHits = 0, tTB = 0, sumXBARaw = 0, sumXSLGRaw = 0, sumXBAMapped = 0, sumXSLGMapped = 0;
  for (const r of qual) {
    const hits = r.hits_single + r.hits_double + r.hits_triple + r.hits_hr;
    const tb = r.hits_single + 2*r.hits_double + 3*r.hits_triple + 4*r.hits_hr;
    const rawXba = r.x_hits_sum / r.ab;
    const rawXslg = r.x_bases_sum / r.ab;
    tAB += r.ab; tHits += hits; tTB += tb;
    sumXBARaw += r.x_hits_sum; sumXSLGRaw += r.x_bases_sum;
    sumXBAMapped += interp(HITTER_XBA_LOOKUP, rawXba) * r.ab;
    sumXSLGMapped += interp(HITTER_XSLG_LOOKUP, rawXslg) * r.ab;
  }
  console.log(`Qualified hitters: ${qual.length}`);
  console.log(`League AVG:        ${(tHits/tAB).toFixed(3)}`);
  console.log(`League xBA  (raw): ${(sumXBARaw/tAB).toFixed(3)}`);
  console.log(`League xBA  (map): ${(sumXBAMapped/tAB).toFixed(3)}`);
  console.log(`League SLG:        ${(tTB/tAB).toFixed(3)}`);
  console.log(`League xSLG (raw): ${(sumXSLGRaw/tAB).toFixed(3)}`);
  console.log(`League xSLG (map): ${(sumXSLGMapped/tAB).toFixed(3)}`);
}

main().then(() => process.exit(0));
