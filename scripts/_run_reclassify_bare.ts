import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

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
WHERE pitch_type_reclassified IS NULL;
`;

async function main() {
  const start = Date.now();
  console.log("Firing bare reclassify UPDATE via exec_sql (will likely gateway-timeout but DB continues)...");
  const { error } = await (sb as any).rpc("exec_sql", { sql: SQL });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (error) {
    console.log(`exec_sql returned after ${elapsed}s: ${error.message}`);
    console.log(`(treating as gateway timeout — DB UPDATE continues server-side; verify with GROUP BY)`);
  } else {
    console.log(`✅ exec_sql returned cleanly after ${elapsed}s`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
