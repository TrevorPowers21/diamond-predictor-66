import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Matches zoneForPitch in PitchZone*.tsx exactly.
function pitchZone(px: number | null, pz: number | null): string | null {
  if (px == null || pz == null) return null;
  if (Math.abs(px) > 4 || Math.abs(pz) > 4) return null;
  if (px >= -1 && px <= 1 && pz >= -1 && pz <= 1) {
    const col = px < -1 / 3 ? 0 : px < 1 / 3 ? 1 : 2;
    const row = pz > 1 / 3 ? 0 : pz > -1 / 3 ? 1 : 2;
    return String(row * 3 + col + 1);
  }
  if (px <= 0 && pz >= 0) return "UL";
  if (px >= 0 && pz >= 0) return "UR";
  if (px <= 0 && pz <= 0) return "LL";
  return "LR";
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function execWithRetry(sql: string, tries = 5): Promise<void> {
  for (let t = 0; t < tries; t++) {
    const { error } = await (sb as any).rpc("exec_sql", { sql });
    if (!error) return;
    if (t === tries - 1) { console.error("exec_sql err:", error.message); process.exit(1); }
    await sleep(1500 * (t + 1));
  }
}

async function main() {
  console.log("URL:", process.env.VITE_SUPABASE_URL);
  const FETCH = 5000;
  let lastId = "", scanned = 0, written = 0;
  const t0 = Date.now();
  while (true) {
    let sel = (sb as any)
      .from("pitch_log")
      .select("uniq_pitch_id, px_norm, pz_norm, pitch_zone")
      .order("uniq_pitch_id", { ascending: true })
      .limit(FETCH);
    if (lastId) sel = sel.gt("uniq_pitch_id", lastId);
    const { data, error } = await sel;
    if (error) { console.error("SELECT err:", error.message); process.exit(1); }
    if (!data || data.length === 0) break;

    const todo = data
      .filter((r: any) => r.pitch_zone == null)
      .map((r: any) => ({ id: r.uniq_pitch_id, z: pitchZone(r.px_norm, r.pz_norm) }))
      .filter((r: any) => r.z != null);
    if (todo.length > 0) {
      const values = todo.map((r: any) => `(${q(r.id)},${q(r.z)})`).join(",");
      await execWithRetry(`UPDATE public.pitch_log AS p
        SET pitch_zone = v.z::text
        FROM (VALUES ${values}) AS v(id, z)
        WHERE p.uniq_pitch_id = v.id;`);
      written += todo.length;
    }
    scanned += data.length;
    lastId = data[data.length - 1].uniq_pitch_id;
    if (scanned % 100000 < FETCH) {
      const rate = scanned / ((Date.now() - t0) / 1000);
      console.log(`  scanned ${scanned}, written ${written}  (${rate.toFixed(0)}/s)`);
    }
  }
  console.log(`DONE. scanned ${scanned}, written ${written} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
