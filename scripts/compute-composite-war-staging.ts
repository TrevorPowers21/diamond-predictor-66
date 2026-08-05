/**
 * Compute composite WAR buckets on STAGING player_predictions for the Phase A test.
 *   npx tsx scripts/compute-composite-war-staging.ts
 *
 * d_war   = Σ (player's per-position drs_floor) / RUNS_PER_WIN     (from player_season_defense)
 * bsr_war = wsb_runs_reg / RUNS_PER_WIN                            (from player_season_baserunning)
 * total_war = (o_war||0) + (p_war||0) + d_war + bsr_war            (positional scarcity = 0 for now)
 *
 * RUNS_PER_WIN = 10 (current scale — the D1 ÷13.1 recalibration is Phase B). This is a one-shot
 * staging pass so we can SEE where everyone lands; the edge function makes it permanent later.
 * Prereq: the d_war/bsr_war/total_war columns exist + the two season tables are loaded.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const RUNS_PER_WIN = 10;
const SEASON = 2026;
const env = fs.readFileSync(".env.local", "utf8");
const get = (k: string) => (env.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim();
const url = get("SUPABASE_URL");
const sb = createClient(url, get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

async function fetchAll(table: string, cols: string, eq?: [string, any]): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = (sb as any).from(table).select(cols).range(from, from + 999);
    if (eq) q = q.eq(eq[0], eq[1]);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function main() {
  console.log("target:", url.match(/https:\/\/([a-z]+)/)?.[1], "(staging=slrxowawbijbjrkozqlj)");

  // d_war: sum drs_floor per player
  const def = await fetchAll("player_season_defense", "player_id, drs_floor", ["season", SEASON]);
  const dwar = new Map<string, number>();
  for (const r of def) dwar.set(r.player_id, (dwar.get(r.player_id) || 0) + (Number(r.drs_floor) || 0) / RUNS_PER_WIN);

  // bsr_war: wsb_runs_reg per player
  const bsr = await fetchAll("player_season_baserunning", "player_id, wsb_runs_reg", ["season", SEASON]);
  const bwar = new Map<string, number>();
  for (const r of bsr) bwar.set(r.player_id, (Number(r.wsb_runs_reg) || 0) / RUNS_PER_WIN);

  // existing o_war/p_war
  const preds = await fetchAll("player_predictions", "player_id, o_war, p_war");
  console.log(`predictions ${preds.length}  d_war players ${dwar.size}  bsr_war players ${bwar.size}`);

  const updates: any[] = [];
  for (const p of preds) {
    const d = dwar.get(p.player_id) ?? 0;
    const b = bwar.get(p.player_id) ?? 0;
    if (d === 0 && b === 0) continue; // nothing new for this player
    const total = (Number(p.o_war) || 0) + (Number(p.p_war) || 0) + d + b;
    updates.push({ player_id: p.player_id, d_war: +d.toFixed(4), bsr_war: +b.toFixed(4), total_war: +total.toFixed(4) });
  }
  for (let i = 0; i < updates.length; i += 500) {
    const { error } = await (sb as any).from("player_predictions").upsert(updates.slice(i, i + 500), { onConflict: "player_id" });
    if (error) throw new Error(`update: ${error.message}`);
  }
  console.log(`updated ${updates.length} predictions with d_war/bsr_war/total_war`);

  // sanity: top 10 by total_war
  const top = await fetchAll("player_predictions", "player_id, o_war, p_war, d_war, bsr_war, total_war");
  top.sort((a, b) => (b.total_war ?? -99) - (a.total_war ?? -99));
  console.log("\nTOP 10 total_war (o / p / d / bsr):");
  for (const t of top.slice(0, 10))
    console.log(`  ${t.player_id.slice(0, 8)}  total ${(+t.total_war).toFixed(2)}  (${(+t.o_war || 0).toFixed(2)} / ${(+t.p_war || 0).toFixed(2)} / ${(+t.d_war || 0).toFixed(2)} / ${(+t.bsr_war || 0).toFixed(2)})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
