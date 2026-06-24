#!/usr/bin/env node
/**
 * Reclassify pitch_type for pitch_log rows.
 *
 * Phase 2 (b) of the pitch log build. Splits raw TruMedia pitch types
 * (FA/SL/CU/CH/FC/FS/SI/UN) into the 9 categories the Stuff+ engine
 * understands:
 *   4-Seam Fastball, Sinker, Cutter, Slider, Sweeper, Gyro Slider,
 *   Curveball, Change-up, Splitter
 *
 * Logic mirrors src/savant/lib/breakingBallReclassification.ts
 * (reclassifyRHP / reclassifyLHP) — ported to inline SQL CASE so it
 * runs in seconds across millions of rows without per-row JS calls.
 *
 * IMPORTANT: if you change reclassifyRHP/LHP in the TS engine, update
 * this SQL to match. Same priority order, same thresholds:
 *
 *   1. ivb > gyroCap → Cutter
 *      (gyroCap = 6 if rel_height >= HIGH_SLOT_THRESHOLD_FT (6.0), else 3)
 *   2. ivb in [-3, ∞) AND hb in [-7, 7] → Gyro Slider
 *   3. ivb <= -8 → Curveball (depth wins, HB-agnostic)
 *   4. hb <= -11 (RHP) / hb >= 11 (LHP) AND ivb > -4 → Sweeper
 *   5. else → Slider
 *
 * Non-breaking types map directly: FA → 4-Seam Fastball, SI → Sinker,
 * CH → Change-up, FS → Splitter. FC (raw Cutter) and CU (raw Curveball)
 * are also reclassified — movement can override the raw tag.
 *
 * Idempotent: only updates rows where pitch_type_reclassified is NULL.
 *
 * Usage:
 *   npm run reclassify-pitch-log -- --apply
 *   npm run reclassify-pitch-log:prod -- --apply
 */
import { createClient } from "@supabase/supabase-js";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { count: total } = await (supabase as any)
    .from("pitch_log")
    .select("*", { count: "exact", head: true });
  const { count: pending } = await (supabase as any)
    .from("pitch_log")
    .select("*", { count: "exact", head: true })
    .is("pitch_type_reclassified", null);

  console.log(`pitch_log rows: ${total ?? "?"} total, ${pending ?? "?"} pending reclassification`);

  if (!apply) {
    console.log("\n[dry-run] No writes. Re-run with --apply.");
    console.log("\nSQL that would run:\n");
    console.log(buildSQL());
    return;
  }

  if (!pending || pending === 0) {
    console.log("\nNothing to reclassify — all rows already have pitch_type_reclassified set.");
    return;
  }

  const startTime = process.hrtime.bigint();
  const { error } = await (supabase as any).rpc("exec_sql", { sql: buildSQL() });
  const elapsed = Number(process.hrtime.bigint() - startTime) / 1e9;

  if (error) {
    console.error(`\nFailed: ${error.message}`);
    console.error(`\nIf "function exec_sql does not exist", paste the SQL below into the Supabase SQL editor:\n`);
    console.log(buildSQL());
    process.exit(1);
  }

  console.log(`\nDone in ${elapsed.toFixed(1)}s.`);
  console.log(`\nVerify with:`);
  console.log(`  SELECT pitch_type_reclassified, COUNT(*) AS n`);
  console.log(`  FROM pitch_log GROUP BY pitch_type_reclassified ORDER BY n DESC;`);
}

function buildSQL(): string {
  return `
UPDATE public.pitch_log
SET pitch_type_reclassified = CASE
  -- Non-breaking-ball types map directly
  WHEN pitch_type = 'FA' THEN '4-Seam Fastball'
  WHEN pitch_type = 'SI' THEN 'Sinker'
  WHEN pitch_type = 'CH' THEN 'Change-up'
  WHEN pitch_type = 'FS' THEN 'Splitter'

  -- Unknown or missing → NULL (no Stuff+ either)
  WHEN pitch_type IS NULL OR pitch_type = '' OR pitch_type = 'UN' THEN NULL

  -- Need movement to reclassify; mark NULL if data incomplete
  WHEN is_data = FALSE THEN NULL

  -- RHP reclassification (movement-based)
  WHEN pitcher_hand = 'R' THEN
    CASE
      -- Priority 1: Cutter (IVB > gyroCap; cap depends on slot)
      WHEN ivb > CASE WHEN COALESCE(rel_height, 0) >= 6.0 THEN 6 ELSE 3 END
        THEN 'Cutter'
      -- Priority 2: Gyro Slider (IVB band + HB neutral)
      WHEN ivb >= -3 AND hb BETWEEN -7 AND 7
        THEN 'Gyro Slider'
      -- Priority 3: Curveball (depth wins)
      WHEN ivb <= -8
        THEN 'Curveball'
      -- Priority 4: Sweeper (dominant horizontal toward glove side for RHP)
      WHEN hb <= -11 AND ivb > -4
        THEN 'Sweeper'
      -- Priority 5: Slider (default)
      ELSE 'Slider'
    END

  -- LHP reclassification (HB sign mirrored)
  WHEN pitcher_hand = 'L' THEN
    CASE
      WHEN ivb > CASE WHEN COALESCE(rel_height, 0) >= 6.0 THEN 6 ELSE 3 END
        THEN 'Cutter'
      WHEN ivb >= -3 AND hb BETWEEN -7 AND 7
        THEN 'Gyro Slider'
      WHEN ivb <= -8
        THEN 'Curveball'
      -- LHP Sweeper: dominant horizontal toward glove side (positive HB)
      WHEN hb >= 11 AND ivb > -4
        THEN 'Sweeper'
      ELSE 'Slider'
    END

  ELSE NULL  -- unknown hand, can't reclassify
END
WHERE pitch_type_reclassified IS NULL;
`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
