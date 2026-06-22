# Pitch Log Build — Production Runbook

End-to-end replay of the full pipeline on prod. Every step verified on staging 2026-06-19 → 2026-06-22.

**Assumptions before starting:**
- Local repo is at the latest commit with all the pitch log work merged
- `~/dev-main/pitch_logs/` contains the same 32 source CSVs we ingested on staging (no rollup files)
- Prod Supabase credentials are in `.env.production.local` (`VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- Estimated total time end-to-end: **60-90 minutes wall clock** (most of it is ingestion + Stuff+)

⚠ Run each step in order. Some depend on the previous step's result.

---

## Step 1 — Schema migrations (paste in prod SQL editor, in this order)

All four migration files together create the schema. Paste each file's contents, run, verify, then move to the next.

### 1a. Base table
File: [`supabase/migrations/20260619120000_pitch_log_base_table.sql`](../supabase/migrations/20260619120000_pitch_log_base_table.sql)

Creates `public.pitch_log` with 45 columns + 6 indexes. `has_velo` and `is_data` are generated columns.

Verify:
```sql
SELECT COUNT(column_name) FROM information_schema.columns
WHERE table_name = 'pitch_log';
-- Expected: 45
```

### 1b. Phase 2 computed columns
File: [`supabase/migrations/20260619140000_pitch_log_computed_columns.sql`](../supabase/migrations/20260619140000_pitch_log_computed_columns.sql)

Adds 11 nullable columns to `pitch_log` for derived flags + Stuff+.

Verify:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'pitch_log' AND column_name IN
  ('is_foul', 'is_in_zone', 'is_strike', 'is_swing', 'is_whiff', 'is_chase',
   'is_in_play', 'is_batted_ball_in_play', 'pitch_result_category',
   'pitch_type_reclassified', 'stuff_plus');
-- Expected: 11 rows
```

### 1c. Aggregation tables
File: [`supabase/migrations/20260620120000_pitch_log_aggregations.sql`](../supabase/migrations/20260620120000_pitch_log_aggregations.sql)

Creates `pitch_log_pitcher_totals`, `pitch_log_pitcher_by_pitch_type`, `pitch_log_hitter_totals`.

Verify:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'pitch_log_%total%'
   OR table_name = 'pitch_log_pitcher_by_pitch_type';
-- Expected: 3 rows
```

### 1d. Helper functions
File: [`supabase/migrations/20260620140000_pitch_log_helper_functions.sql`](../supabase/migrations/20260620140000_pitch_log_helper_functions.sql)

Creates `exec_sql(text)` and `bulk_update_pitch_log_stuff_plus(jsonb)`.

Verify:
```sql
SELECT proname FROM pg_proc
WHERE proname IN ('exec_sql', 'bulk_update_pitch_log_stuff_plus');
-- Expected: 2 rows
```

---

## Step 2 — Ingest CSVs (Phase 1)

Run from terminal. The `:prod` variant uses `.env.production.local`.

```bash
cd ~/dev-main/diamond-predictor-66

for csv in ~/dev-main/pitch_logs/*.csv; do
  echo "=== $(date '+%H:%M:%S')  $(basename "$csv") ==="
  npm run ingest-pitch-log:prod -- "$csv" --apply
done
```

Estimated runtime: **~15 minutes** for all 32 CSVs.

Verify (in SQL editor):
```sql
SELECT
  COUNT(*) AS total_pitches,
  COUNT(*) FILTER (WHERE has_velo) AS with_velo,
  COUNT(*) FILTER (WHERE is_data) AS fully_tracked,
  COUNT(DISTINCT pitcher_id) AS unique_pitchers,
  COUNT(DISTINCT batter_id) AS unique_batters,
  COUNT(DISTINCT csv_source) AS files,
  MIN(date)::date AS first_pitch,
  MAX(date)::date AS last_pitch
FROM pitch_log;
```

**Expected on staging-equivalent data:**
- `total_pitches ≈ 2,573,869`
- `with_velo ≈ 88.6%`
- `fully_tracked ≈ 78.1%`
- `unique_pitchers ≈ 5,415`
- `unique_batters ≈ 6,096`
- `files = 32`
- Date range: `2026-02-13 → 2026-06-14`

---

## Step 3 — Flag derivation (Phase 2b)

Paste this in prod SQL editor. **No `BEGIN/COMMIT` wrap** so it survives the gateway 60s timeout (the DB keeps running after disconnect).

```sql
UPDATE public.pitch_log
SET
  pitch_result_category = CASE
    WHEN pitch_result IS NULL OR pitch_result = '' THEN 'Other'
    WHEN pitch_result = 'Foul' THEN 'Foul'
    WHEN pitch_result IN ('Ball', 'Ball in the Dirt', 'Intentional Ball') THEN 'Ball'
    WHEN pitch_result IN ('Walk', 'Intentional Walk') THEN 'Walk'
    WHEN pitch_result = 'Hit By Pitch' THEN 'HBP'
    WHEN pitch_result IN ('Strike Looking', 'Strike Swinging') THEN 'Strike'
    WHEN pitch_result LIKE 'Strikeout%' THEN 'Strikeout'
    WHEN pitch_result LIKE 'Home Run%' THEN 'HR'
    WHEN pitch_result LIKE 'Single%' THEN 'Single'
    WHEN pitch_result = 'Double Play' THEN 'DoublePlay'
    WHEN pitch_result LIKE 'Triple%' THEN 'Triple'
    WHEN pitch_result LIKE 'Double%' THEN 'Double'
    WHEN pitch_result = 'Ground Out' THEN 'GroundOut'
    WHEN pitch_result = 'Fly Out' THEN 'FlyOut'
    WHEN pitch_result = 'Line Out' THEN 'LineOut'
    WHEN pitch_result = 'Pop Out' THEN 'PopOut'
    WHEN pitch_result IN ('Sac Bunt', 'Sac Fly') THEN 'Sac'
    WHEN pitch_result LIKE 'Reached on Error%' THEN 'Error'
    WHEN pitch_result = E'Fielder\'s Choice' THEN 'FieldersChoice'
    ELSE 'Other'
  END,
  is_foul = COALESCE(pitch_result = 'Foul', false),
  is_in_zone = (cs_prob >= 0.50),
  is_strike = COALESCE((
    pitch_result IN ('Strike Looking', 'Strike Swinging', 'Foul')
    OR pitch_result LIKE 'Strikeout%' OR pitch_result LIKE 'Single%'
    OR pitch_result = 'Double Play' OR pitch_result LIKE 'Triple%'
    OR pitch_result LIKE 'Double%' OR pitch_result LIKE 'Home Run%'
    OR pitch_result IN ('Ground Out', 'Fly Out', 'Line Out', 'Pop Out')
    OR pitch_result IN ('Sac Bunt', 'Sac Fly')
    OR pitch_result LIKE 'Reached on Error%' OR pitch_result = E'Fielder\'s Choice'
  ), false),
  is_swing = COALESCE((
    pitch_result IN ('Strike Swinging', 'Foul') OR pitch_result = 'Strikeout (Swinging)'
    OR pitch_result LIKE 'Single%' OR pitch_result = 'Double Play'
    OR pitch_result LIKE 'Triple%' OR pitch_result LIKE 'Double%'
    OR pitch_result LIKE 'Home Run%'
    OR pitch_result IN ('Ground Out', 'Fly Out', 'Line Out', 'Pop Out')
    OR pitch_result IN ('Sac Bunt', 'Sac Fly')
    OR pitch_result LIKE 'Reached on Error%' OR pitch_result = E'Fielder\'s Choice'
  ), false),
  is_whiff = COALESCE(pitch_result IN ('Strike Swinging', 'Strikeout (Swinging)'), false),
  is_chase = (cs_prob IS NOT NULL AND cs_prob < 0.50 AND COALESCE((
    pitch_result IN ('Strike Swinging', 'Foul') OR pitch_result = 'Strikeout (Swinging)'
    OR pitch_result LIKE 'Single%' OR pitch_result = 'Double Play'
    OR pitch_result LIKE 'Triple%' OR pitch_result LIKE 'Double%'
    OR pitch_result LIKE 'Home Run%'
    OR pitch_result IN ('Ground Out', 'Fly Out', 'Line Out', 'Pop Out')
    OR pitch_result IN ('Sac Bunt', 'Sac Fly')
    OR pitch_result LIKE 'Reached on Error%' OR pitch_result = E'Fielder\'s Choice'
  ), false)),
  is_in_play = COALESCE((
    pitch_result LIKE 'Single%' OR pitch_result = 'Double Play'
    OR pitch_result LIKE 'Triple%' OR pitch_result LIKE 'Double%'
    OR pitch_result LIKE 'Home Run%'
    OR pitch_result IN ('Ground Out', 'Fly Out', 'Line Out', 'Pop Out')
    OR pitch_result IN ('Sac Bunt', 'Sac Fly')
    OR pitch_result LIKE 'Reached on Error%' OR pitch_result = E'Fielder\'s Choice'
  ), false),
  is_batted_ball_in_play = COALESCE((
    pitch_result LIKE 'Single%' OR pitch_result = 'Double Play'
    OR pitch_result LIKE 'Triple%' OR pitch_result LIKE 'Double%'
    OR pitch_result LIKE 'Home Run%'
    OR pitch_result IN ('Ground Out', 'Fly Out', 'Line Out', 'Pop Out')
    OR pitch_result IN ('Sac Bunt', 'Sac Fly')
    OR pitch_result LIKE 'Reached on Error%' OR pitch_result = E'Fielder\'s Choice'
  ), false)
WHERE is_foul IS NULL;
```

Wait ~3 min after gateway disconnect, then verify:
```sql
SELECT
  COUNT(*) FILTER (WHERE is_foul IS NULL) AS missing_flags,
  COUNT(*) FILTER (WHERE is_foul) AS fouls,
  COUNT(*) FILTER (WHERE is_strike) AS strikes
FROM pitch_log;
-- Expected: missing_flags=0, fouls≈392K, strikes≈1.55M
```

---

## Step 4 — Pitch type reclassification (Phase 2c)

Paste in prod SQL editor, no `BEGIN/COMMIT`:

```sql
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
```

Wait ~3 min, then verify:
```sql
SELECT pitch_type_reclassified, COUNT(*) AS n
FROM pitch_log
GROUP BY pitch_type_reclassified
ORDER BY n DESC;
-- Expected: 10 rows (9 pitch types + NULL ~386K)
```

---

## Step 5 — Stuff+ per pitch (Phase 2d)

```bash
cd ~/dev-main/diamond-predictor-66
npm run compute-pitch-log-stuff-plus:prod -- --apply
```

Estimated runtime: **~15 minutes** (scoring ~4 min + bulk update via RPC ~10 min).

Verify (every bucket should be near 100):
```sql
SELECT pitch_type_reclassified, pitcher_hand,
       COUNT(*) AS pitches,
       ROUND(AVG(stuff_plus)::numeric, 2) AS mean
FROM pitch_log
WHERE stuff_plus IS NOT NULL
GROUP BY pitch_type_reclassified, pitcher_hand
ORDER BY pitch_type_reclassified, pitcher_hand;
-- Expected: 18 rows, all means in 100.7-102.5 range
```

---

## Step 6 — Aggregations (Phase 3 + Phase 4 combined)

The aggregation script populates BOTH the 'all' baseline AND the 6 filter dimensions in a single run. One script, 8 dimension entries.

```bash
cd ~/dev-main/diamond-predictor-66
npm run aggregate-pitch-log-dimensions:prod -- --apply
```

Estimated runtime: **~10-12 minutes** for 19 INSERT...SELECTs (8 dimensions × applicable tables; some pitcher-only or hitter-only).

⚠ **Before running**: confirm the `vs_top_hitters` threshold of `overall_power_rating >= 120.8` is still right for prod. The threshold was derived from p75 on staging. Re-derive on prod:

```sql
WITH qualified AS (
  SELECT source_player_id, pa, overall_power_rating
  FROM "Hitter Master"
  WHERE "Season" = 2026 AND overall_power_rating IS NOT NULL AND pa >= 100
)
SELECT ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY overall_power_rating)::numeric, 1) AS p75
FROM qualified;
```

If the p75 on prod ≠ 120.8, update the threshold in `scripts/aggregate_pitch_log_dimensions.ts` (the `vs_top_hitters` dimension's `pitcher_filter`) before running.

Verify after script completes:
```sql
SELECT dimension_key, COUNT(*) AS rows
FROM pitch_log_pitcher_totals
GROUP BY dimension_key
ORDER BY dimension_key;
-- Expected: 7 rows — all, vs_lhp, vs_rhp, vs_fastball, vs_breaking_ball, vs_offspeed, vs_top_hitters
```

```sql
SELECT dimension_key, COUNT(*) AS rows
FROM pitch_log_hitter_totals
GROUP BY dimension_key
ORDER BY dimension_key;
-- Expected: 7 rows — all, vs_lhp, vs_rhp, vs_92plus, vs_fastball, vs_breaking_ball, vs_offspeed
```

---

## Done

After Step 6 verifies clean, prod has the full pitch log pipeline:
- 2.57M raw pitches
- Flags + reclassification + Stuff+ computed
- 3 aggregation tables × 7 dimensions = ~100K rows of precomputed display data
- Ready for Phase 5 Savant UI consumption

---

## Re-running after new CSVs (mid-season for 2027)

Once Phase 6 (Drive auto-ingestion) is built, this becomes automatic. Until then, the manual flow per new CSV:

1. Drop CSV into `~/dev-main/pitch_logs/`
2. `npm run ingest-pitch-log:prod -- "<csv path>" --apply`
3. Re-run flag derivation (Step 3 SQL) — only NULL flags get touched (idempotent via `WHERE is_foul IS NULL`)
4. Re-run reclassification (Step 4 SQL) — same idempotent gate on `WHERE pitch_type_reclassified IS NULL`
5. `npm run compute-pitch-log-stuff-plus:prod -- --apply` — only scores rows where `stuff_plus IS NULL`
6. Re-run Phase 4 script — recomputes all dimension rows for all players (ON CONFLICT DO UPDATE)
7. Verify

Steps 3-6 are all idempotent so they're safe to re-run.

---

## File inventory

```
docs/
  PITCH_LOG_BUILD.md                              # canonical build spec
  PITCH_LOG_HANDOFF_2026_06_19.md                 # earlier session handoff
  PITCH_LOG_HANDOFF_2026_06_22.md                 # comprehensive session handoff
  PITCH_LOG_PROD_RUNBOOK.md                       # this file — paste-and-go prod transition

supabase/migrations/
  20260619120000_pitch_log_base_table.sql         # Step 1a — pitch_log schema
  20260619140000_pitch_log_computed_columns.sql   # Step 1b — derived columns
  20260620120000_pitch_log_aggregations.sql       # Step 1c — aggregation tables
  20260620140000_pitch_log_helper_functions.sql   # Step 1d — exec_sql + bulk_update

scripts/
  ingest_pitch_log.ts                             # Step 2
  derive_pitch_log_flags.ts                       # Step 3 (alt — paste SQL above)
  reclassify_pitch_log.ts                         # Step 4 (alt — paste SQL above)
  compute_pitch_log_stuff_plus.ts                 # Step 5
  aggregate_pitch_log_dimensions.ts               # Step 7 (Phase 4 dimensions)
```

npm scripts:
- `ingest-pitch-log[:prod]`
- `derive-pitch-log-flags[:prod]`
- `reclassify-pitch-log[:prod]`
- `compute-pitch-log-stuff-plus[:prod]`
- `aggregate-pitch-log-dimensions[:prod]`

All `:prod` variants use `.env.production.local`.
