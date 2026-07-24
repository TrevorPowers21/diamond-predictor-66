/**
 * Backfill neutral_snapshot on every team_build_players + target_board row from the
 * gatekept player_predictions neutral (team-precomputed → global regular → any),
 * own-side for a TWP. This is the immutable dev_agg=0 base the toggle recompute uses,
 * persisted so it never depends on a live fetch again.
 *
 *   npx tsx scripts/backfill-neutral-snapshot.ts [--prod] [--apply]
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
const ENV = process.argv.includes("--prod") ? ".env.production.local" : ".env.local";
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(ENV, "VITE_SUPABASE_URL") || rd(ENV, "SUPABASE_URL"), rd(ENV, "SUPABASE_SERVICE_ROLE_KEY"));
const APPLY = process.argv.includes("--apply");
console.log(`### DB: ${ENV}  APPLY=${APPLY} ###`);
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
const page = async (t: string, sel: string, flt: (q: any) => any) => { let f = 0, o: any[] = []; for (;;) { let q = sb.from(t).select(sel); q = flt(q); const { data, error } = await q.range(f, f + 999); if (error) throw error; o = o.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } return o; };

// own-side neutral line (mirrors the prediction fields the recompute reads); the OFF
// side is nulled so a slot row never carries the other side's neutral.
function neutralFor(pred: any, side: "P" | "H"): any {
  const base: any = { dev_aggressiveness: 0, class_transition: pred.class_transition ?? null };
  if (side === "H") {
    Object.assign(base, { p_avg: pred.p_avg ?? null, p_obp: pred.p_obp ?? null, p_slg: pred.p_slg ?? null, p_wrc_plus: pred.p_wrc_plus ?? null, o_war: pred.o_war ?? null, hitter_depth_role: pred.hitter_depth_role ?? null, twp_hitter_market_value: pred.twp_hitter_market_value ?? null, market_value: pred.market_value ?? null });
  } else {
    Object.assign(base, { p_era: pred.p_era ?? null, p_fip: pred.p_fip ?? null, p_whip: pred.p_whip ?? null, p_k9: pred.p_k9 ?? null, p_bb9: pred.p_bb9 ?? null, p_hr9: pred.p_hr9 ?? null, p_rv_plus: pred.p_rv_plus ?? null, p_war: pred.p_war ?? null, pitcher_role: pred.pitcher_role ?? null, pitcher_depth_role: pred.pitcher_depth_role ?? null, twp_pitcher_market_value: pred.twp_pitcher_market_value ?? null, projected_ip: pred.projected_ip ?? null });
  }
  return base;
}
const hasSide = (r: any, side: "P" | "H") => side === "P" ? (r.pitcher_role != null || r.p_era != null || r.p_war != null) : (r.p_wrc_plus != null || r.o_war != null);

(async () => {
  // build → customer_team
  const builds = await page("team_builds", "id, customer_team_id", (q) => q);
  const buildCt = new Map<string, string>(); for (const b of builds) buildCt.set(b.id, b.customer_team_id);

  const bps = await page("team_build_players", "id, build_id, player_id, position_slot", (q) => q);
  const tbs = await page("target_board", "id, player_id, customer_team_id, position_slot", (q) => q);
  const pids = [...new Set([...bps.map((r: any) => r.player_id), ...tbs.map((r: any) => r.player_id)].filter((x) => x && /^[0-9a-f-]{36}$/i.test(String(x))))];
  // player position (for side when a target's position_slot is null, like the reads do)
  const pos = new Map<string, string>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, position").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) pos.set(p.id, p.position); }

  // per-player prediction fetch (reliable, no cap)
  const F = "customer_team_id, variant, model_type, status, p_avg, p_obp, p_slg, p_wrc_plus, p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war, o_war, pitcher_role, class_transition, hitter_depth_role, pitcher_depth_role, market_value, twp_hitter_market_value, twp_pitcher_market_value, projected_ip";
  const preds = new Map<string, any[]>();
  for (let i = 0; i < pids.length; i++) { const { data } = await sb.from("player_predictions").select(F).eq("season", 2027).eq("player_id", pids[i]).in("variant", ["regular", "precomputed"]).in("status", ["active", "departed"]); if (data?.length) preds.set(pids[i] as string, data); if ((i + 1) % 100 === 0) process.stdout.write(`\r  preds ${i + 1}/${pids.length}`); }
  process.stdout.write("\r");

  const pick = (pid: string, ctid: string | null, side: "P" | "H") => {
    const rows = (preds.get(pid) || []).filter((r) => r.customer_team_id == null || r.customer_team_id === ctid);
    return rows.find((r) => r.customer_team_id === ctid && r.variant === "precomputed" && hasSide(r, side))
      ?? rows.find((r) => r.customer_team_id == null && r.variant === "regular" && hasSide(r, side))
      ?? rows.find((r) => hasSide(r, side)) ?? null;
  };

  let bpSet = 0, bpMiss = 0, tbSet = 0, tbMiss = 0;
  const bpUp: { id: string; neutral_snapshot: any }[] = [], tbUp: { id: string; neutral_snapshot: any }[] = [];
  for (const r of bps) { const ctid = buildCt.get(r.build_id) ?? null; const side = isPit(r.position_slot) ? "P" : "H"; const p = pick(r.player_id, ctid, side); if (!p) { bpMiss++; continue; } bpUp.push({ id: r.id, neutral_snapshot: neutralFor(p, side) }); bpSet++; }
  for (const r of tbs) { const side = isPit(r.position_slot ?? pos.get(r.player_id)) ? "P" : "H"; const p = pick(r.player_id, r.customer_team_id, side); if (!p) { tbMiss++; continue; } tbUp.push({ id: r.id, neutral_snapshot: neutralFor(p, side) }); tbSet++; }

  console.log(`team_build_players: ${bpSet} to set, ${bpMiss} no-neutral (no-AB/local)`);
  console.log(`target_board:       ${tbSet} to set, ${tbMiss} no-neutral`);
  if (!APPLY) { console.log("\nDRY RUN — add --apply."); return; }
  for (let i = 0; i < bpUp.length; i++) { const { error } = await sb.from("team_build_players").update({ neutral_snapshot: bpUp[i].neutral_snapshot }).eq("id", bpUp[i].id); if (error) console.log("bp err", error.message); if ((i + 1) % 200 === 0) process.stdout.write(`\r  bp ${i + 1}/${bpUp.length}`); }
  for (let i = 0; i < tbUp.length; i++) { const { error } = await sb.from("target_board").update({ neutral_snapshot: tbUp[i].neutral_snapshot }).eq("id", tbUp[i].id); if (error) console.log("tb err", error.message); if ((i + 1) % 200 === 0) process.stdout.write(`\r  tb ${i + 1}/${tbUp.length}`); }
  console.log(`\n✅ applied bp=${bpUp.length} tb=${tbUp.length}`);
})();
