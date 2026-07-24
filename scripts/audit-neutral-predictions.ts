/**
 * Audit: how many players on an active build (returners + rostered) or a target
 * board have NO loadable NEUTRAL prediction for their side — the immutable dev_agg=0
 * line the toggle recompute must base off (missing → dev-agg compounds).
 *
 * "Loadable neutral" mirrors the load/pick: season 2027, variant regular/precomputed,
 * status active/departed, team-scoped (program's precomputed → global regular → any),
 * and a row that carries the player's SIDE (pitcher: p_era/pitcher_role; hitter: wRC+).
 *
 *   npx tsx scripts/audit-neutral-predictions.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { resolveActiveBuildId } from "../src/lib/activeBuild";
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(".env.local", "VITE_SUPABASE_URL"), rd(".env.local", "SUPABASE_SERVICE_ROLE_KEY"));
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
const page = async (t: string, sel: string, flt: (q: any) => any) => { let f = 0, o: any[] = []; for (;;) { let q = sb.from(t).select(sel); q = flt(q); const { data } = await q.range(f, f + 999); o = o.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } return o; };

(async () => {
  // gather every (player, ct, side) that needs a neutral: active-build roster + targets
  const { data: builds } = await sb.from("team_builds").select("id, customer_team_id, is_active, is_default, team, academic_year, updated_at, created_at");
  const byCt = new Map<string, any[]>(); for (const b of (builds || [])) { (byCt.get(b.customer_team_id) ?? byCt.set(b.customer_team_id, []).get(b.customer_team_id)!).push(b); }
  const need = new Map<string, { pid: string; ctid: string; side: "P" | "H"; where: string }>(); // key pid|ctid|side
  for (const [ctid, bs] of byCt) {
    const activeId = resolveActiveBuildId(bs); if (!activeId) continue;
    const bps = await page("team_build_players", "player_id, position_slot", (q) => q.eq("build_id", activeId));
    for (const bp of bps) { const side = isPit(bp.position_slot) ? "P" : "H"; need.set(`${bp.player_id}|${ctid}|${side}`, { pid: bp.player_id, ctid, side, where: "roster" }); }
  }
  const tb = await page("target_board", "player_id, customer_team_id, position_slot", (q) => q);
  const tpos = new Map<string, string>();
  { const pids = [...new Set(tb.map((r: any) => r.player_id))]; for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, position").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) tpos.set(p.id, p.position); } }
  for (const r of tb) { const side = isPit(r.position_slot ?? tpos.get(r.player_id)) ? "P" : "H"; const k = `${r.player_id}|${r.customer_team_id}|${side}`; if (!need.has(k)) need.set(k, { pid: r.player_id, ctid: r.customer_team_id, side, where: "target" }); }

  // fetch predictions for all involved players
  const allPids = [...new Set([...need.values()].map((n) => n.pid))];
  // Small batches (20 players) so a batch's total rows stay well under the 1000
  // cap — avoids the pagination artifact that was falsely dropping rows.
  const preds = new Map<string, any[]>();
  for (let i = 0; i < allPids.length; i += 20) { const batch = allPids.slice(i, i + 20); let f = 0; for (;;) { const { data } = await sb.from("player_predictions").select("player_id, customer_team_id, variant, status, pitcher_role, p_era, p_rv_plus, p_wrc_plus, o_war, p_war").eq("season", 2027).in("player_id", batch).in("variant", ["regular", "precomputed"]).in("status", ["active", "departed"]).order("id").range(f, f + 999); if (!data?.length) break; for (const r of data) { (preds.get(r.player_id) ?? preds.set(r.player_id, []).get(r.player_id)!).push(r); } if (data.length < 1000) break; f += 1000; } }
  // sanity probe: Flukey must show his global row
  const fl = preds.get("642d3b47-d8df-4513-8f4a-57e3e1cbbd93");
  console.log(`[probe] Flukey pred rows fetched: ${fl?.length ?? 0} (expect >=1)`);

  const nm = new Map<string, string>();
  for (let i = 0; i < allPids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name").in("id", allPids.slice(i, i + 200)); for (const p of (data || [])) nm.set(p.id, `${p.first_name} ${p.last_name}`); }
  const ctName = new Map<string, string>(); { const { data } = await sb.from("customer_teams").select("id, name"); for (const c of (data || [])) ctName.set(c.id, c.name); }

  // resolve the neutral pick per (player, ct, side); missing if none carries the side
  const hasSide = (r: any, side: "P" | "H") => side === "P" ? (r.pitcher_role != null || r.p_era != null || r.p_war != null) : (r.p_wrc_plus != null || r.o_war != null);
  let checked = 0, missing = 0, placeholder = 0, noRow = 0, emptyRow = 0; const byProg = new Map<string, number>(); const samples: string[] = [];
  for (const n of need.values()) {
    if (!n.pid || !/^[0-9a-f-]{36}$/i.test(String(n.pid))) { placeholder++; continue; } // local/placeholder roster row
    checked++;
    const rows = (preds.get(n.pid) || []).filter((r) => r.customer_team_id == null || r.customer_team_id === n.ctid);
    const pick = rows.find((r) => r.customer_team_id === n.ctid && r.variant === "precomputed" && hasSide(r, n.side))
      ?? rows.find((r) => r.customer_team_id == null && r.variant === "regular" && hasSide(r, n.side))
      ?? rows.find((r) => hasSide(r, n.side)) ?? null;
    if (!pick) { missing++; const mode = rows.length === 0 ? "NO-ROW" : "EMPTY-SIDE"; if (mode === "NO-ROW") noRow++; else emptyRow++; const ck = n.ctid ?? "none"; byProg.set(ck, (byProg.get(ck) ?? 0) + 1); if (samples.length < 20) samples.push(`  ${nm.get(n.pid) ?? String(n.pid).slice(0, 8)} [${n.side}] @${ctName.get(n.ctid) ?? String(ck).slice(0, 8)} (${n.where}) — ${mode}`); }
  }
  console.log(`(player, team, side) needing a neutral: ${checked}  (+${placeholder} local/placeholder rows skipped)`);
  console.log(`MISSING a loadable neutral: ${missing}  (NO-ROW=${noRow} genuinely absent, EMPTY-SIDE=${emptyRow} row exists but blank)`);
  console.log("by program:"); for (const [id, c] of [...byProg].sort((a, b) => b[1] - a[1])) console.log(`  ${ctName.get(id) ?? id.slice(0, 8)}: ${c}`);
  if (samples.length) { console.log("samples:"); samples.forEach((s) => console.log(s)); }
})();
