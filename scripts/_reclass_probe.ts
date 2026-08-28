/**
 * RECLASS BOUNDARY PROBE (read-only, staging) — derive staging's ACTUAL decision boundary between two labels
 * from its own output (`pitch_log_corrected.pitch_type_reclassified`) + features. NOT guessing thresholds.
 *   npx tsx --env-file .env.local scripts/_reclass_probe.ts "Sweeper" "Slider"
 */
import { createClient } from "@supabase/supabase-js";
const SEASON = 2026;
const [, , LA = "Sweeper", LB = "Slider"] = process.argv;
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
if (!/slrxowawbijbjrkozqlj/.test(url)) { console.error("staging only"); process.exit(1); }
const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) as any;
const pct = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const stat = (name: string, xs: number[]) => `${name}: n=${xs.length} p5=${pct(xs, .05)?.toFixed(1)} p25=${pct(xs, .25)?.toFixed(1)} p50=${pct(xs, .5)?.toFixed(1)} p75=${pct(xs, .75)?.toFixed(1)} p95=${pct(xs, .95)?.toFixed(1)}`;

async function loadPf() {
  const pf = new Map<string, number>(); let last = "";
  for (;;) { const { data, error } = await sb.from("_reclass_pf").select("pitcher_id,pf_velo").gt("pitcher_id", last).order("pitcher_id").limit(1000);
    if (error) { console.error("_reclass_pf error:", error.message); break; } if (!data || !data.length) break; for (const r of data) pf.set(r.pitcher_id, r.pf_velo); last = data[data.length - 1].pitcher_id; if (data.length < 1000) break; } return pf;
}
async function pull(label: string, pf: Map<string, number>, cap = 40000) {
  const rows: { ar: number; iv: number; gap: number; sp: number; ve: number }[] = []; let last = ""; let pages = 0;
  while (rows.length < cap) {
    const { data, error } = await sb.from("pitch_log_corrected")
      .select("uniq_pitch_id,pitcher_id,pitcher_hand,ivb_corrected,hb_corrected,release_velocity,spin,pitch_type_reclassified")
      .eq("season", SEASON).eq("pitch_type_reclassified", label).gt("uniq_pitch_id", last).order("uniq_pitch_id").limit(1000);
    if (error) { console.error(`pull(${label}) error:`, error.message); break; }
    if (!data || !data.length) break; pages++;
    for (const r of data) { if (r.ivb_corrected == null || r.hb_corrected == null || r.release_velocity == null) continue;
      const ar = r.pitcher_hand === "R" ? r.hb_corrected : -r.hb_corrected; const pfv = pf.get(r.pitcher_id);
      rows.push({ ar, iv: r.ivb_corrected, gap: pfv != null ? pfv - r.release_velocity : NaN, sp: r.spin ?? NaN, ve: r.release_velocity }); }
    last = data[data.length - 1].uniq_pitch_id; if (data.length < 1000) break;
  }
  console.error(`  pulled ${label}: ${rows.length} rows (${pages} pages)`);
  return rows;
}
(async () => {
  const pf = await loadPf();
  console.error(`_reclass_pf loaded: ${pf.size} pitchers`);
  const A = await pull(LA, pf), B = await pull(LB, pf);
  console.log(`\n=== ${LA} vs ${LB} (staging output, season ${SEASON}) ===`);
  for (const [nm, rs] of [[LA, A], [LB, B]] as const) {
    console.log(`\n[${nm}]  ${stat("armHB", rs.map((r) => r.ar))}`);
    console.log(`        ${stat("ivb  ", rs.map((r) => r.iv))}`);
    console.log(`        ${stat("gap  ", rs.map((r) => r.gap).filter((x) => !isNaN(x)))}`);
    console.log(`        ${stat("spin ", rs.map((r) => r.sp).filter((x) => !isNaN(x)))}`);
  }
  const all = [...A.map((r) => ({ ...r, l: LA })), ...B.map((r) => ({ ...r, l: LB }))];
  if (!all.length) { console.log("NO DATA — check errors above"); return; }
  console.log(`\narmHB bins → P(${LA}) [count]:`);
  for (let lo = -20; lo < 6; lo += 2) { const bin = all.filter((r) => r.ar >= lo && r.ar < lo + 2);
    if (bin.length < 20) continue; const a = bin.filter((r) => r.l === LA).length;
    console.log(`  armHB [${lo.toString().padStart(3)},${(lo + 2).toString().padStart(3)}): P(${LA})=${(100 * a / bin.length).toFixed(0)}%  n=${bin.length}`); }
  console.log(`\nivb bins → P(${LA}) [count]:`);
  for (let lo = -14; lo < 12; lo += 2) { const bin = all.filter((r) => r.iv >= lo && r.iv < lo + 2);
    if (bin.length < 20) continue; const a = bin.filter((r) => r.l === LA).length;
    console.log(`  ivb [${lo.toString().padStart(3)},${(lo + 2).toString().padStart(3)}): P(${LA})=${(100 * a / bin.length).toFixed(0)}%  n=${bin.length}`); }
  console.log(`\nrr = ivb - |armHB| bins → P(${LA}) [count]:`);
  for (let lo = -16; lo < 18; lo += 2) { const bin = all.filter((r) => { const rr = r.iv - Math.abs(r.ar); return rr >= lo && rr < lo + 2; });
    if (bin.length < 20) continue; const a = bin.filter((r) => r.l === LA).length;
    console.log(`  rr [${lo.toString().padStart(3)},${(lo + 2).toString().padStart(3)}): P(${LA})=${(100 * a / bin.length).toFixed(0)}%  n=${bin.length}`); }
})().catch((e) => { console.error(e); process.exit(1); });
