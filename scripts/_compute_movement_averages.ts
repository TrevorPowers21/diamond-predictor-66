/**
 * Compute D1 NCAA average movement (IVB / HB) per pitch_type_reclassified
 * + pitcher_hand. Used for the Movement Profile plot's reference overlay
 * (hatched ovals showing where each pitch type "should" land in the
 * IVB/HB space). One mean + std per (pitch_type, hand).
 */
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  console.log("Pulling per-pitch (pitch_type, hand) movement samples...");
  const stats: Record<string, { ivbSum: number; ivbSq: number; hbSum: number; hbSq: number; n: number }> = {};

  const PAGE = 1000;
  let lastId = "";
  let total = 0;
  while (true) {
    let q = (sb as any)
      .from("pitch_log")
      .select("uniq_pitch_id, pitcher_hand, pitch_type_reclassified, ivb, hb")
      .eq("season", 2026)
      .eq("is_data", true)
      .not("pitch_type_reclassified", "is", null)
      .order("uniq_pitch_id", { ascending: true })
      .limit(PAGE);
    if (lastId) q = q.gt("uniq_pitch_id", lastId);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.ivb == null || r.hb == null || !r.pitcher_hand) continue;
      const k = `${r.pitch_type_reclassified}|${r.pitcher_hand}`;
      if (!stats[k]) stats[k] = { ivbSum: 0, ivbSq: 0, hbSum: 0, hbSq: 0, n: 0 };
      stats[k].ivbSum += r.ivb;
      stats[k].ivbSq += r.ivb * r.ivb;
      stats[k].hbSum += r.hb;
      stats[k].hbSq += r.hb * r.hb;
      stats[k].n += 1;
    }
    total += data.length;
    lastId = data[data.length - 1].uniq_pitch_id;
    if (total % 100000 < PAGE) console.log(`  scanned ${total.toLocaleString()}...`);
    if (data.length < PAGE) break;
  }

  console.log(`\n=== D1 2026 movement averages ===`);
  console.log(`(format: pitch_type | hand | n | IVB mean ± std | HB mean ± std)`);
  const rows = Object.entries(stats).map(([k, v]) => {
    const [type, hand] = k.split("|");
    const ivbMean = v.ivbSum / v.n;
    const ivbStd = Math.sqrt(v.ivbSq / v.n - ivbMean * ivbMean);
    const hbMean = v.hbSum / v.n;
    const hbStd = Math.sqrt(v.hbSq / v.n - hbMean * hbMean);
    return { type, hand, n: v.n, ivbMean, ivbStd, hbMean, hbStd };
  });
  rows.sort((a, b) => a.type.localeCompare(b.type) || a.hand.localeCompare(b.hand));
  for (const r of rows) {
    console.log(`  ${r.type.padEnd(20)} | ${r.hand} | n=${r.n.toString().padStart(7)} | IVB ${r.ivbMean.toFixed(1).padStart(6)} ± ${r.ivbStd.toFixed(1)} | HB ${r.hbMean.toFixed(1).padStart(6)} ± ${r.hbStd.toFixed(1)}`);
  }

  console.log(`\n=== As TS constants ===`);
  console.log(`export const NCAA_MOVEMENT_AVERAGES: Record<string, Record<"L" | "R", { ivb: number; hb: number; ivbStd: number; hbStd: number; n: number }>> = {`);
  const byType: Record<string, Record<string, any>> = {};
  for (const r of rows) {
    if (!byType[r.type]) byType[r.type] = {};
    byType[r.type][r.hand] = r;
  }
  for (const [type, hands] of Object.entries(byType)) {
    console.log(`  ${JSON.stringify(type)}: {`);
    for (const [hand, r] of Object.entries(hands)) {
      console.log(`    ${hand}: { ivb: ${r.ivbMean.toFixed(2)}, hb: ${r.hbMean.toFixed(2)}, ivbStd: ${r.ivbStd.toFixed(2)}, hbStd: ${r.hbStd.toFixed(2)}, n: ${r.n} },`);
    }
    console.log(`  },`);
  }
  console.log(`};`);
}
main().catch((e) => { console.error(e); process.exit(1); });
