import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const CHUNK = 200_000;

const SQL = `
UPDATE public.pitch_log
SET pitch_type_reclassified = CASE
  WHEN pitch_type = 'FA' THEN '4-Seam Fastball'
  WHEN pitch_type = 'SI' THEN 'Sinker'
  WHEN pitch_type = 'CH' THEN 'Change-up'
  WHEN pitch_type = 'FS' THEN 'Splitter'
  WHEN pitch_type IS NULL OR pitch_type = '' OR pitch_type = 'UN' THEN NULL
  WHEN is_data = FALSE THEN NULL
  WHEN pitcher_hand = 'R' THEN
    CASE
      WHEN ivb > CASE WHEN COALESCE(rel_height, 0) >= 6.0 THEN 6 ELSE 3 END THEN 'Cutter'
      WHEN ivb >= -3 AND hb BETWEEN -7 AND 7 THEN 'Gyro Slider'
      WHEN ivb <= -8 THEN 'Curveball'
      WHEN hb <= -11 AND ivb > -4 THEN 'Sweeper'
      ELSE 'Slider'
    END
  WHEN pitcher_hand = 'L' THEN
    CASE
      WHEN ivb > CASE WHEN COALESCE(rel_height, 0) >= 6.0 THEN 6 ELSE 3 END THEN 'Cutter'
      WHEN ivb >= -3 AND hb BETWEEN -7 AND 7 THEN 'Gyro Slider'
      WHEN ivb <= -8 THEN 'Curveball'
      WHEN hb >= 11 AND ivb > -4 THEN 'Sweeper'
      ELSE 'Slider'
    END
  ELSE NULL
END
WHERE uniq_pitch_id IN (
  SELECT uniq_pitch_id FROM public.pitch_log
  WHERE pitch_type_reclassified IS NULL
    AND (pitch_type IS NOT NULL AND pitch_type <> '' AND pitch_type <> 'UN')
    AND is_data = TRUE
  ORDER BY uniq_pitch_id
  LIMIT ${CHUNK}
)
`;

// NOTE: the reclassify CASE evaluates to NULL for any row where pitch_type
// is null/UN OR is_data=FALSE. We filter those rows OUT of the targeted
// WHERE clause so the loop converges (otherwise NULL-target rows would
// re-match WHERE pitch_type_reclassified IS NULL forever).

async function pendingCount(): Promise<number> {
  const { count } = await (sb as any)
    .from("pitch_log")
    .select("uniq_pitch_id", { count: "exact", head: true })
    .is("pitch_type_reclassified", null)
    .not("pitch_type", "is", null)
    .not("pitch_type", "eq", "")
    .not("pitch_type", "eq", "UN")
    .eq("is_data", true);
  return count ?? 0;
}

async function main() {
  const start = Date.now();
  let last = -1, chunkNum = 0;
  while (true) {
    chunkNum++;
    const before = await pendingCount();
    if (before === 0) { console.log("✅ All pitches reclassified."); break; }
    if (before === last) { console.error(`No progress, pending=${before}`); process.exit(1); }
    const cs = Date.now();
    console.log(`Chunk ${chunkNum}: pending=${before.toLocaleString()}...`);
    const { error } = await (sb as any).rpc("exec_sql", { sql: SQL });
    if (error) { console.error(`exec_sql: ${error.message}`); process.exit(1); }
    const after = await pendingCount();
    console.log(`  → ${((Date.now() - cs) / 1000).toFixed(1)}s, ${(before - after).toLocaleString()} updated, ${after.toLocaleString()} pending`);
    last = before;
  }
  console.log(`\nTotal: ${((Date.now() - start) / 1000).toFixed(1)}s, ${chunkNum} chunks`);
}
main().catch((e) => { console.error(e); process.exit(1); });
