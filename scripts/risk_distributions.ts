/**
 * One-off: pull empirical 2026 D1 percentile distributions for every metric
 * that informs the risk model. Output a markdown table so we can hand-tune
 * empirical bucket cuts in the audit walk-through.
 *
 * Filters:
 *   - Hitter Master: division = D1, Season = 2026, pa >= 75 (qualified)
 *   - Pitching Master: division = D1, Season = 2026, IP >= 20 (qualified)
 *   - Predictions: variant = 'regular', model_type IN ('returner','transfer')
 *
 * Run: tsx --env-file-if-exists=.env.production.local scripts/risk_distributions.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function reportRow(name: string, raw: (number | null | undefined)[], digits = 1): string {
  const vals = raw.filter((v): v is number => v != null && Number.isFinite(Number(v))).map(Number);
  if (vals.length === 0) return `| ${name} | n=0 | — | — | — | — | — | — | — |`;
  const ps = [5, 10, 25, 50, 75, 90, 95];
  const cells = ps.map((p) => fmt(percentile(vals, p), digits));
  return `| ${name} | ${vals.length} | ${cells.join(" | ")} |`;
}

async function fetchAll<T>(builder: () => any): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await builder().range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

console.log("# Risk Model — Empirical 2026 D1 Distributions\n");

// ── HITTER MASTER ──
console.log("## Hitter Master (D1, Season=2026, PA ≥ 75)\n");
const hitters = await fetchAll<any>(() =>
  supabase
    .from("Hitter Master")
    .select("source_player_id, pa, contact, chase, barrel, avg_exit_velo, ev90, line_drive, bb, pull, gb")
    .eq("division", "D1")
    .eq("Season", 2026)
    .gte("pa", 75),
);
console.log(`Qualified hitters: **${hitters.length}**\n`);
console.log("| Metric | n | P5 | P10 | P25 | P50 | P75 | P90 | P95 |");
console.log("|---|---|---|---|---|---|---|---|---|");
console.log(reportRow("Contact%", hitters.map((h) => h.contact)));
console.log(reportRow("Chase%", hitters.map((h) => h.chase)));
console.log(reportRow("Avg EV", hitters.map((h) => h.avg_exit_velo)));
console.log(reportRow("EV90", hitters.map((h) => h.ev90)));
console.log(reportRow("Barrel%", hitters.map((h) => h.barrel)));
console.log(reportRow("LD%", hitters.map((h) => h.line_drive)));
console.log(reportRow("BB%", hitters.map((h) => h.bb)));
console.log(reportRow("Pull%", hitters.map((h) => h.pull)));
console.log(reportRow("GB%", hitters.map((h) => h.gb)));
console.log(reportRow("PA", hitters.map((h) => h.pa), 0));
console.log("");

// ── PITCHING MASTER ──
console.log("## Pitching Master (D1, Season=2026, IP ≥ 20)\n");
const pitchers = await fetchAll<any>(() =>
  supabase
    .from("Pitching Master")
    .select("source_player_id, IP, stuff_plus, miss_pct, in_zone_whiff_pct, bb_pct, hard_hit_pct, chase_pct, barrel_pct, ground_pct")
    .eq("division", "D1")
    .eq("Season", 2026)
    .gte("IP", 20),
);
console.log(`Qualified pitchers: **${pitchers.length}**\n`);
console.log("| Metric | n | P5 | P10 | P25 | P50 | P75 | P90 | P95 |");
console.log("|---|---|---|---|---|---|---|---|---|");
console.log(reportRow("Stuff+", pitchers.map((p) => p.stuff_plus)));
console.log(reportRow("Whiff%", pitchers.map((p) => p.miss_pct)));
console.log(reportRow("IZ Whiff%", pitchers.map((p) => p.in_zone_whiff_pct)));
console.log(reportRow("BB%", pitchers.map((p) => p.bb_pct)));
console.log(reportRow("Hard Hit%", pitchers.map((p) => p.hard_hit_pct)));
console.log(reportRow("Chase%", pitchers.map((p) => p.chase_pct)));
console.log(reportRow("Barrel%", pitchers.map((p) => p.barrel_pct)));
console.log(reportRow("GB%", pitchers.map((p) => p.ground_pct)));
console.log(reportRow("IP", pitchers.map((p) => p.IP), 0));
console.log("");

// ── PROJECTIONS ──
console.log("## Projections (player_predictions, 2026, regular variant)\n");
const hitPred = await fetchAll<any>(() =>
  supabase
    .from("player_predictions")
    .select("player_id, p_wrc_plus")
    .eq("season", 2026)
    .eq("variant", "regular")
    .in("model_type", ["returner", "transfer"])
    .not("p_wrc_plus", "is", null),
);
const pitPred = await fetchAll<any>(() =>
  supabase
    .from("player_predictions")
    .select("player_id, p_rv_plus")
    .eq("season", 2026)
    .eq("variant", "regular")
    .in("model_type", ["returner", "transfer"])
    .not("p_rv_plus", "is", null),
);
console.log(`Hitter projections (p_wrc_plus): **${hitPred.length}** | Pitcher projections (p_rv_plus): **${pitPred.length}**\n`);
console.log("| Metric | n | P5 | P10 | P25 | P50 | P75 | P90 | P95 |");
console.log("|---|---|---|---|---|---|---|---|---|");
console.log(reportRow("Hitter p_wrc_plus", hitPred.map((r) => r.p_wrc_plus), 0));
console.log(reportRow("Pitcher p_rv_plus", pitPred.map((r) => r.p_rv_plus), 0));
console.log("");

// ── CONFERENCE COMP ──
console.log("## Conference Competition (Conference Stats, 2026, D1)\n");
const { data: confs } = await (supabase as any)
  .from("Conference Stats")
  .select("conference_id, Stuff_plus, Overall_Power_Rating")
  .eq("season", 2026)
  .eq("division", "D1");
const stuffs = (confs || []).map((c: any) => c.Stuff_plus).filter((v: any) => v != null);
const talents = (confs || []).map((c: any) => c.Overall_Power_Rating).filter((v: any) => v != null);
console.log(`Conferences w/ Stuff+: **${stuffs.length}** | w/ Overall Power Rating (hitter talent proxy): **${talents.length}**\n`);
console.log("| Metric | n | P5 | P10 | P25 | P50 | P75 | P90 | P95 |");
console.log("|---|---|---|---|---|---|---|---|---|");
console.log(reportRow("Conf Stuff+", stuffs));
console.log(reportRow("Conf Hitter OPR", talents));
console.log("");

// ── TRAJECTORY YoY DELTAS ──
console.log("## Trajectory — YoY Deltas (2025 → 2026)\n");
const hit25 = await fetchAll<any>(() =>
  supabase
    .from("Hitter Master")
    .select("source_player_id, contact, chase, barrel")
    .eq("division", "D1")
    .eq("Season", 2025)
    .gte("pa", 75),
);
const hit25Map = new Map(hit25.map((h: any) => [h.source_player_id, h]));
const contactDeltas: number[] = [];
const chaseDeltas: number[] = [];
const barrelDeltas: number[] = [];
for (const h of hitters) {
  const prior = hit25Map.get(h.source_player_id);
  if (!prior) continue;
  if (h.contact != null && prior.contact != null) contactDeltas.push(h.contact - prior.contact);
  if (h.chase != null && prior.chase != null) chaseDeltas.push(h.chase - prior.chase);
  if (h.barrel != null && prior.barrel != null) barrelDeltas.push(h.barrel - prior.barrel);
}

const pit25 = await fetchAll<any>(() =>
  supabase
    .from("Pitching Master")
    .select("source_player_id, stuff_plus, bb_pct, miss_pct")
    .eq("division", "D1")
    .eq("Season", 2025)
    .gte("IP", 20),
);
const pit25Map = new Map(pit25.map((p: any) => [p.source_player_id, p]));
const stuffDeltas: number[] = [];
const bbDeltas: number[] = [];
const whiffDeltas: number[] = [];
for (const p of pitchers) {
  const prior = pit25Map.get(p.source_player_id);
  if (!prior) continue;
  if (p.stuff_plus != null && prior.stuff_plus != null) stuffDeltas.push(p.stuff_plus - prior.stuff_plus);
  if (p.bb_pct != null && prior.bb_pct != null) bbDeltas.push(p.bb_pct - prior.bb_pct);
  if (p.miss_pct != null && prior.miss_pct != null) whiffDeltas.push(p.miss_pct - prior.miss_pct);
}

console.log("| Metric | n | P5 | P10 | P25 | P50 | P75 | P90 | P95 |");
console.log("|---|---|---|---|---|---|---|---|---|");
console.log(reportRow("Δ Contact% (hitter)", contactDeltas));
console.log(reportRow("Δ Chase% (hitter)", chaseDeltas));
console.log(reportRow("Δ Barrel% (hitter)", barrelDeltas));
console.log(reportRow("Δ Stuff+ (pitcher)", stuffDeltas));
console.log(reportRow("Δ BB% (pitcher)", bbDeltas));
console.log(reportRow("Δ Whiff% (pitcher)", whiffDeltas));
