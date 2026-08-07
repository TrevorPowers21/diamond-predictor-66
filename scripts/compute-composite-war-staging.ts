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

  // d_war: HITTER-SIDE defense — sum drs_floor over NON-pitcher positions only. A player's
  // mound (P) defense is pitcher fielding; we leave p_war alone, so it never lands on the
  // hitter slot (a pure SP → d_war 0; a TWP's fielding-position rows count, their P row doesn't).
  const def = await fetchAll("player_season_defense", "player_id, position, drs_floor", ["season", SEASON]);
  const dwar = new Map<string, number>();
  for (const r of def) {
    if (r.position === "P") continue;
    dwar.set(r.player_id, (dwar.get(r.player_id) || 0) + (Number(r.drs_floor) || 0) / RUNS_PER_WIN);
  }

  // bsr_war: wsb_runs_reg per player
  const bsr = await fetchAll("player_season_baserunning", "player_id, wsb_runs_reg", ["season", SEASON]);
  const bwar = new Map<string, number>();
  for (const r of bsr) bwar.set(r.player_id, (Number(r.wsb_runs_reg) || 0) / RUNS_PER_WIN);

  // PRINT-ONLY: compute the composite in-memory to SEE the landscape. The actual write to
  // player_predictions is a computed bulk UPDATE (SET total_war = o+p+d+bsr), which is a SQL
  // job — see the accompanying UPDATE run in the staging SQL editor.
  const preds = await fetchAll("player_predictions", "player_id, o_war, p_war");
  console.log(`predictions ${preds.length}  d_war players ${dwar.size}  bsr_war players ${bwar.size}`);

  // best composite per player (predictions have multiple rows/scenarios per player).
  // hitter-side WAR = o + d + bsr ; pitcher-side = p (untouched) ; total = both (aggregate only).
  const best = new Map<string, any>();
  for (const p of preds) {
    const d = dwar.get(p.player_id) ?? 0;
    const b = bwar.get(p.player_id) ?? 0;
    const o = Number(p.o_war) || 0, pw = Number(p.p_war) || 0;
    const hit = o + d + b, total = hit + pw;
    const cur = best.get(p.player_id);
    if (!cur || total > cur.total) best.set(p.player_id, { o, pw, d, b, hit, total });
  }
  const names = await fetchAll("players", "id, first_name, last_name, position");
  const nmeta = new Map(names.map((n: any) => [n.id, `${n.first_name?.[0] || ""}. ${n.last_name}`.trim() + " " + (n.position || "")]));

  // hitter-side leaderboard: where defense/baserunning reshape the position-player board
  const hitters = [...best.entries()].filter(([, v]) => v.hit !== 0).sort((a, b) => b[1].hit - a[1].hit);
  console.log("\nTOP 12 HITTER-side WAR = o + d + bsr  [÷10 current scale]:");
  for (const [id, v] of hitters.slice(0, 12))
    console.log(`  ${(nmeta.get(id) || id.slice(0, 8)).padEnd(24)} hit ${v.hit.toFixed(2)}  (o ${v.o.toFixed(2)} / d ${v.d.toFixed(2)} / bsr ${v.b.toFixed(2)})`);

  // biggest movers: d+bsr swing vs oWAR alone (the reason the composite exists)
  const movers = [...best.entries()].map(([id, v]) => ({ id, v, swing: v.d + v.b }))
    .sort((a, b) => b.swing - a.swing);
  console.log("\nTOP 10 defense+baserunning MOVERS (d+bsr added to hitter side):");
  for (const m of movers.slice(0, 10))
    console.log(`  ${(nmeta.get(m.id) || m.id.slice(0, 8)).padEnd(24)} +${m.swing.toFixed(2)}  (o ${m.v.o.toFixed(2)} → hit ${m.v.hit.toFixed(2)})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
