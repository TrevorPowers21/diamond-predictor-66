/**
 * STEP 1 (read-only): validate that `snapshot == projectEffective(neutral, notes)`.
 * Proves the extracted projectEffective is faithful (it must reproduce the WAR of the
 * known-good rows) AND sizes how many rows are DRIFTED (corrupted / race-stale).
 * NO WRITES.  npx tsx scripts/validate-snapshot-vs-neutral.ts [--prod] [--show]
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
const page = async (t: string, sel: string, flt: (q: any) => any) => { let f = 0, o: any[] = []; for (;;) { let q = sb.from(t).select(sel); q = flt(q); const { data } = await q.range(f, f + 999); o = o.concat(data || []); if (!data || data.length < 1000) break; f += 1000; } return o; };
const near = (a: any, b: any) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= 0.02;

(async () => {
  const nm = new Map<string, string>();
  const check = (label: string, rows: any[], getSnapWar: (r: any, side: "P" | "H") => number | null, getName: (r: any) => string) => {
    let total = 0, match = 0, drift = 0, roleCh = 0, noNeutral = 0, noNotes = 0; const samples: string[] = [];
    for (const r of rows) {
      const neutral = r.neutral_snapshot; if (!neutral) { noNeutral++; continue; }
      const notes = parseNotes(r.production_notes); if (notes == null) { noNotes++; }
      const side: "P" | "H" = isPit(r.position_slot ?? (num(neutral.p_rv_plus) != null ? "SP" : "")) ? "P" : "H";
      const snapWar = getSnapWar(r, side); if (snapWar == null) continue;
      total++;
      const { owar, pwar, roleChanged } = projectEffectiveWar(neutral, notes ?? {});
      if (roleChanged) { roleCh++; continue; } // rates change on role flip — not modeled, skip
      const expected = side === "P" ? pwar : owar;
      if (near(expected, snapWar)) match++;
      else { drift++; if (samples.length < 25) samples.push(`  ${getName(r)} [${side}] devAgg=${notes?.devAggressiveness ?? 0} depth=${notes?.depthRole ?? "-"}: snapshot WAR ${snapWar?.toFixed(3)} vs f(neutral,notes)=${expected?.toFixed(3)}`); }
    }
    console.log(`\n${label}: ${total} checked`);
    console.log(`  MATCH (snapshot == f):   ${match}`);
    console.log(`  DRIFT (needs heal):      ${drift}`);
    console.log(`  role-changed (skipped):  ${roleCh}`);
    console.log(`  no-neutral / no-notes:   ${noNeutral} / ${noNotes}`);
    if (SHOW && samples.length) { console.log("  drift samples:"); samples.forEach((s) => console.log(s)); }
    return { total, match, drift };
  };

  const bps = await page("team_build_players", "player_id, position_slot, player_snapshot, neutral_snapshot, production_notes", (q) => q);
  const tbs = await page("target_board", "player_id, position_slot, transfer_snapshot, neutral_snapshot, production_notes", (q) => q);
  const pids = [...new Set([...bps, ...tbs].map((r: any) => r.player_id).filter((x) => x && /^[0-9a-f-]{36}$/i.test(String(x))))];
  for (let i = 0; i < pids.length; i += 200) { const { data } = await sb.from("players").select("id, first_name, last_name").in("id", pids.slice(i, i + 200)); for (const p of (data || [])) nm.set(p.id, `${p.first_name} ${p.last_name}`); }
  const name = (r: any) => nm.get(r.player_id) ?? String(r.player_id).slice(0, 8);

  const bp = check("team_build_players", bps, (r, s) => s === "P" ? num(r.player_snapshot?.p_war) : num(r.player_snapshot?.o_war), name);
  const tb = check("target_board", tbs, (r, s) => s === "P" ? num(r.transfer_snapshot?.p_war) : num(r.transfer_snapshot?.owar ?? r.transfer_snapshot?.o_war), name);

  const total = bp.total + tb.total, match = bp.match + tb.match, drift = bp.drift + tb.drift;
  const rate = total ? (100 * match / total).toFixed(1) : "0";
  console.log(`\n===== OVERALL: ${match}/${total} match (${rate}%), ${drift} drift =====`);
  console.log(match / Math.max(1, total) > 0.9 ? "✅ projectEffective reproduces the vast majority → faithful; drift = the corrupted/stale rows to heal." : "⚠ low match rate → projectEffective likely diverges from the sim; DO NOT heal yet, fix the function first.");
})();
