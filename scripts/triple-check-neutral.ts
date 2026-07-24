/**
 * Triple-check the neutral pick: for every build/target row, re-resolve the CORRECT
 * neutral by the canonical rule — team-precomputed(program) if it exists, else global
 * regular; NO cross-team `any` fallback (a returner has only the global row; a
 * transfer has the team row). Compare that to (a) my stored neutral_snapshot and
 * (b) the snapshot, and categorize. READ-ONLY.
 *   npx tsx scripts/triple-check-neutral.ts [--prod] [--show]
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import { projectEffectiveWar } from "../src/lib/projectEffective";
const ENV = process.argv.includes("--prod") ? ".env.production.local" : ".env.local";
const SHOW = process.argv.includes("--show");
const rd = (f: string, k: string) => (fs.readFileSync(f, "utf8").match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] || "").trim().replace(/^"|"$/g, "");
const sb = createClient(rd(ENV, "VITE_SUPABASE_URL") || rd(ENV, "SUPABASE_URL"), rd(ENV, "SUPABASE_SERVICE_ROLE_KEY"));
console.log(`### DB: ${ENV} ###`);
const num = (v: any) => (v == null ? null : Number(v));
const isPit = (s: any) => /^(SP|RP|CL|P|LHP|RHP)/i.test(String(s || ""));
const parseNotes = (pn: any) => { try { return typeof pn === "string" ? JSON.parse(pn) : pn; } catch { return null; } };
const near = (a: any, b: any) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= 0.02;
const page = async (t: string, sel: string, flt: (q: any) => any) => { let f = 0, o: any[] = []; for (;;) { let q = sb.from(t).select(sel); q = flt(q); const { data } = await q.range(f, f + 999); o = o.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } return o; };
const hasSide = (r: any, side: "P" | "H") => side === "P" ? (r.pitcher_role != null || r.p_era != null || r.p_war != null) : (r.p_wrc_plus != null || r.o_war != null);

(async () => {
  const builds = await page("team_builds", "id, customer_team_id", (q) => q);
  const buildCt = new Map<string, string>(); for (const b of builds) buildCt.set(b.id, b.customer_team_id);
  const bps = await page("team_build_players", "player_id, build_id, position_slot, player_snapshot, neutral_snapshot, production_notes", (q) => q);
  const tbs = await page("target_board", "player_id, customer_team_id, position_slot, transfer_snapshot, neutral_snapshot, production_notes", (q) => q);
  const rows = [
    ...bps.map((r: any) => ({ pid: r.player_id, ctid: buildCt.get(r.build_id) ?? null, slot: r.position_slot, snapW: (s: "P" | "H") => s === "P" ? num(r.player_snapshot?.p_war) : num(r.player_snapshot?.o_war), stored: r.neutral_snapshot, notes: r.production_notes, where: "roster" })),
    ...tbs.map((r: any) => ({ pid: r.player_id, ctid: r.customer_team_id, slot: r.position_slot, snapW: (s: "P" | "H") => s === "P" ? num(r.transfer_snapshot?.p_war) : num(r.transfer_snapshot?.owar ?? r.transfer_snapshot?.o_war), stored: r.neutral_snapshot, notes: r.production_notes, where: "target" })),
  ];
  const pids = [...new Set(rows.map((r) => r.pid).filter((x) => x && /^[0-9a-f-]{36}$/i.test(String(x))))];
  // reliable per-player prediction fetch
  const preds = new Map<string, any[]>();
  for (let i = 0; i < pids.length; i++) { const { data } = await sb.from("player_predictions").select("customer_team_id, variant, model_type, status, p_wrc_plus, o_war, p_rv_plus, p_war, p_era, pitcher_role").eq("season", 2027).eq("player_id", pids[i] as string).in("variant", ["regular", "precomputed"]).in("status", ["active", "departed"]); if (data?.length) preds.set(pids[i] as string, data); if ((i + 1) % 100 === 0) process.stdout.write(`\r  preds ${i + 1}/${pids.length}`); }
  process.stdout.write("\r");
  const nm = new Map<string, string>();
  for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) nm.set(p.id, `${p.first_name} ${p.last_name}`); }

  // CORRECT neutral: team-precomputed(program) → global regular. No cross-team fallback.
  const correctNeutral = (pid: string, ctid: string | null, side: "P" | "H") => {
    const rs = preds.get(pid) || [];
    return rs.find((r) => r.customer_team_id === ctid && r.variant === "precomputed" && hasSide(r, side))
      ?? rs.find((r) => r.customer_team_id == null && r.variant === "regular" && hasSide(r, side)) ?? null;
  };
  const wOf = (r: any, side: "P" | "H") => side === "P" ? num(r?.p_war) : num(r?.o_war);

  let total = 0, staleSnap = 0, wrongNeutral = 0, noCorrect = 0, allGood = 0, roleCh = 0; const wrong: string[] = [], stale: string[] = [];
  for (const r of rows) {
    if (!/^[0-9a-f-]{36}$/i.test(String(r.pid))) continue;
    const side: "P" | "H" = isPit(r.slot ?? (num(r.stored?.p_rv_plus) != null ? "SP" : "")) ? "P" : "H";
    const snapWar = r.snapW(side); if (snapWar == null) continue;
    total++;
    const correct = correctNeutral(r.pid, r.ctid, side);
    const notes = parseNotes(r.notes) ?? {};
    const proj = projectEffectiveWar(r.stored, notes); if (proj.roleChanged) { roleCh++; continue; }
    const storedWarExp = side === "P" ? proj.pwar : proj.owar;
    const snapMatchesStored = near(storedWarExp, snapWar);
    if (snapMatchesStored) { allGood++; continue; } // snapshot == f(my stored neutral) → fine
    // drift: is my stored neutral the CORRECT row?
    if (!correct) { noCorrect++; continue; }
    const storedNeutralW = wOf(r.stored, side), correctNeutralW = wOf(correct, side);
    if (near(storedNeutralW, correctNeutralW)) { staleSnap++; if (stale.length < 12) stale.push(`  ${nm.get(r.pid)} [${side}] (${r.where}): neutral OK (${correctNeutralW?.toFixed(2)}) → snapshot ${snapWar?.toFixed(2)} STALE vs f=${storedWarExp?.toFixed(2)}`); }
    else { wrongNeutral++; if (wrong.length < 15) wrong.push(`  ${nm.get(r.pid)} [${side}] (${r.where}): my neutral WAR ${storedNeutralW?.toFixed(2)} ≠ correct ${correctNeutralW?.toFixed(2)} (snapshot ${snapWar?.toFixed(2)})`); }
  }
  console.log(`\nrows: ${total}`);
  console.log(`  snapshot == f(stored neutral): ${allGood}`);
  console.log(`  DRIFT → stale snapshot (my neutral is CORRECT): ${staleSnap}`);
  console.log(`  DRIFT → my neutral is WRONG (fix the pick): ${wrongNeutral}`);
  console.log(`  no correct neutral resolvable: ${noCorrect}   role-changed: ${roleCh}`);
  if (SHOW) { if (wrong.length) { console.log("\nWRONG-NEUTRAL samples:"); wrong.forEach((s) => console.log(s)); } if (stale.length) { console.log("\nSTALE-SNAPSHOT samples:"); stale.forEach((s) => console.log(s)); } }
})();
