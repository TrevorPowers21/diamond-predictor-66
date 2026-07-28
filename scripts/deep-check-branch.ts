/**
 * Deeper read-only checks beyond verify-all, to shrink the browser pass:
 *  A. regression: the TWP two-row migration must NOT duplicate a non-TWP player
 *     (every non-TWP on a board = exactly 1 row).
 *  B. render-safety: every production_notes is valid JSON (a malformed recipe would
 *     break the board render).
 *  C. no orphan target rows (player_id must exist in players).
 *  D. cross-surface parity: for each rostered target, the value each surface would
 *     display resolves to the SAME number (all surfaces = roster player_snapshot).
 *  E. named spot-checks: Souza / Traeger / Cespedes stored WAR on the active build.
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { resolveActiveBuildId } from "../src/lib/activeBuild";
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(".env.local", "VITE_SUPABASE_URL"), rd(".env.local", "SUPABASE_SERVICE_ROLE_KEY"));
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
const num = (v: any) => v == null ? null : Number(v);
let issues = 0; const flag = (s: string) => { issues++; console.log(`  ❌ ${s}`); };
const page = async (t: string, sel: string, flt: (q: any) => any) => { let f = 0, o: any[] = []; for (;;) { let q = sb.from(t).select(sel); q = flt(q); const { data } = await q.range(f, f + 999); o = o.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } return o; };

(async () => {
  const tb = await page("target_board", "id, player_id, customer_team_id, position_slot, transfer_snapshot, production_notes", (q) => q);
  const pids = [...new Set(tb.map((r: any) => r.player_id))];
  const meta = new Map<string, any>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name, is_twp").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) meta.set(p.id, p); }
  const nm = (id: string) => { const m = meta.get(id); return m ? `${m.first_name} ${m.last_name}` : id.slice(0, 8); };

  // A. non-TWP = exactly 1 row per (player, team); TWP = exactly 2
  console.log("=== A. row-count per (player,team): non-TWP=1, TWP=2 ===");
  const groups = new Map<string, any[]>();
  for (const r of tb) { const k = `${r.player_id}|${r.customer_team_id}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
  let nonTwp = 0, twp = 0;
  for (const [k, rows] of groups) {
    const pid = k.split("|")[0]; const isTwpP = !!meta.get(pid)?.is_twp;
    if (isTwpP) { twp++; if (rows.length !== 2) flag(`${nm(pid)} (TWP): ${rows.length} rows (want 2)`); }
    else { nonTwp++; if (rows.length !== 1) flag(`${nm(pid)} (non-TWP): ${rows.length} rows (want 1) — DUPLICATE regression`); }
  }
  console.log(`  non-TWP groups: ${nonTwp}, TWP groups: ${twp}`);

  // B. production_notes valid JSON
  console.log("=== B. production_notes valid JSON ===");
  let bad = 0; for (const r of tb) { if (r.production_notes == null) continue; try { const o = typeof r.production_notes === "string" ? JSON.parse(r.production_notes) : r.production_notes; if (typeof o !== "object") throw 0; } catch { bad++; flag(`${nm(r.player_id)}: unparseable production_notes`); } }
  console.log(`  rows with notes checked; malformed: ${bad}`);

  // C. orphan rows
  console.log("=== C. no orphan target rows ===");
  let orphan = 0; for (const pid of pids) if (!meta.has(pid)) { orphan++; flag(`orphan player_id ${pid.slice(0, 8)} on board`); }
  console.log(`  orphans: ${orphan}`);

  // D. cross-surface parity (rostered): every surface resolves rostered → active-build
  //    player_snapshot for the matching side. Confirm board transfer_snapshot == that.
  console.log("=== D. cross-surface parity: board line == active-roster snapshot (rostered) ===");
  const { data: builds } = await sb.from("team_builds").select("id, customer_team_id, is_active, is_default, team, academic_year, updated_at, created_at");
  const byCt = new Map<string, any[]>(); for (const b of (builds || [])) { (byCt.get(b.customer_team_id) ?? byCt.set(b.customer_team_id, []).get(b.customer_team_id)!).push(b); }
  let parity = 0;
  for (const [k, rows] of groups) {
    const [pid, ctid] = k.split("|"); const activeId = resolveActiveBuildId(byCt.get(ctid)); if (!activeId) continue;
    const { data: bps } = await sb.from("team_build_players").select("position_slot, player_snapshot").eq("build_id", activeId).eq("player_id", pid).eq("included_in_roster", true);
    if (!bps?.length) continue;
    for (const r of rows) {
      const side = isPit(r.position_slot ?? "") ? "pit" : "hit";
      const rosterRow = bps.length === 1 ? bps[0] : bps.find((b: any) => (isPit(b.position_slot) ? "pit" : "hit") === side);
      if (!rosterRow?.player_snapshot) continue;
      parity++;
      const ts = r.transfer_snapshot || {}, ps = rosterRow.player_snapshot;
      const bw = side === "pit" ? num(ts.p_war) : num(ts.owar ?? ts.o_war);
      const rw = side === "pit" ? num(ps.p_war) : num(ps.o_war);
      if (bw != null && rw != null && Math.abs(bw - rw) > 0.02) flag(`${nm(pid)} [${side}]: board WAR ${bw?.toFixed(3)} ≠ roster ${rw?.toFixed(3)}`);
    }
  }
  console.log(`  rostered surface-parity rows checked: ${parity}`);

  // E. named spot-checks (active-build stored WAR)
  console.log("=== E. spot-checks (active-build player_snapshot) ===");
  for (const last of ["Souza", "Traeger", "Cespedes"]) {
    const { data: pl } = await sb.from("players").select("id, first_name, last_name").eq("last_name", last);
    for (const p of (pl || [])) {
      const { data: rows } = await sb.from("team_build_players").select("build_id, position_slot, player_snapshot, included_in_roster, team_builds!inner(is_active)").eq("player_id", p.id).eq("included_in_roster", true);
      const active = (rows || []).filter((r: any) => r.team_builds?.is_active);
      for (const r of active) { const s = r.player_snapshot || {}; console.log(`  ${p.first_name} ${p.last_name} [${r.position_slot}]: wRC+=${s.p_wrc_plus ?? "-"} oWAR=${s.o_war != null ? Number(s.o_war).toFixed(3) : "-"} pRV+=${s.p_rv_plus ?? "-"} pWAR=${s.p_war != null ? Number(s.p_war).toFixed(3) : "-"}`); }
    }
  }

  console.log(`\n===== ${issues === 0 ? "✅ deep checks clean" : `❌ ${issues} issue(s)`} =====`);
})();
