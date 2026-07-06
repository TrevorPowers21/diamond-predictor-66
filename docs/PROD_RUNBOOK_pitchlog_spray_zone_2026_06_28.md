# PROD Runbook — Pitch Log Spray + Power-Rating Inputs + Zone Storage

Everything to push this session's pitch_log work to **prod** (`trbvxuoliwrfowibatkm`).
Self-contained: every step + all SQL inline. Run in order.

Scope of this push:
1. Spray/EV90/pull-air aggregation columns (power-rating inputs)
2. Per-row spray labels (`hit_location`, `batted_direction`)
3. Per-row `pitch_zone` label + per-zone aggregation tables (`*_by_zone`)
4. Re-aggregate so all the above populate
5. Frontend: power ratings read pitch_log-first (deploys via normal merge)

> NOTE: the **stored projections / precompute are NOT touched** here. This is
> the display layer. The stored-rating calc change + re-precompute is the
> separate July step (see `POWER_RATINGS_PITCHLOG_HANDOFF_2026_06_26.md`).

---

## STEP 0 — Prerequisites (verify FIRST)

Prod must already have the base pitch_log pipeline live (2.57M pitches, flags,
reclassification, Stuff+, base aggregation tables) per
`docs/PITCH_LOG_PROD_RUNBOOK.md`, INCLUDING the 2026-06-22/23 additions
(`total_out_of_zone`, `pitch_log_xba_lookup`, `pitch_log_hitter_by_pitch_type`).

CRITICAL — the spray + zone backfills need **location columns populated**.
Verify prod's pitch_log has `px_norm` / `pz_norm` / `spray_ang` filled (from
the location/spray ingest). Run in the prod SQL editor:

```sql
SELECT
  COUNT(*)                                  AS total,
  COUNT(*) FILTER (WHERE px_norm IS NOT NULL) AS has_pxnorm,
  COUNT(*) FILTER (WHERE spray_ang IS NOT NULL AND is_batted_ball_in_play) AS has_spray_bip
FROM pitch_log;
```
If `has_pxnorm` ≈ 0, the location ingest hasn't run on prod — stop and ingest
the location/spray CSVs first (migration `20260624120000_pitch_log_location_spray.sql`
+ re-ingest). The rest of this runbook assumes those columns are populated.

---

## STEP 1 — Migrations (paste in prod SQL editor, in order)

### 1a. Spray / EV90 / pull-air aggregation columns
File: `supabase/migrations/20260627000000_pitch_log_pull_air_la_ev90.sql`

```sql
ALTER TABLE public.pitch_log
  ADD COLUMN IF NOT EXISTS hit_location     text,
  ADD COLUMN IF NOT EXISTS batted_direction text;
CREATE INDEX IF NOT EXISTS idx_pitch_log_hit_location ON public.pitch_log (hit_location) WHERE hit_location IS NOT NULL;

ALTER TABLE public.pitch_log_pitcher_totals
  ADD COLUMN IF NOT EXISTS batted_pull_allowed          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_center_allowed        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_oppo_allowed          integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_pull_air_allowed      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_la_10_to_30_allowed   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ev_90_allowed                numeric;

ALTER TABLE public.pitch_log_hitter_totals
  ADD COLUMN IF NOT EXISTS batted_far_left     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_left_center  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_center       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_right_center integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_far_right    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_pull         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_oppo         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_pull_air     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ev_90               numeric;
```

### 1b. Zone label + per-zone tables
File: `supabase/migrations/20260628000000_pitch_log_by_zone.sql`
This one is long (two CREATE TABLEs + RLS) — **paste the file's full contents**.
It can also be applied via `exec_sql` (multi-statement is fine; ~16s on staging):
```bash
npx tsx --env-file-if-exists=.env.production.local \
  scripts/_run_sql_file.ts supabase/migrations/20260628000000_pitch_log_by_zone.sql
```

Verify both migrations:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name='pitch_log' AND column_name IN ('hit_location','batted_direction','pitch_zone');
-- expect 3 rows
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('pitch_log_pitcher_by_zone','pitch_log_hitter_by_zone');
-- expect 2 rows
```

---

## STEP 2 — Backfill the per-row labels

These populate `hit_location` / `batted_direction` (batted balls, ~440K) and
`pitch_zone` (all located pitches, ~2.3M) on existing rows.

⚠ **DO NOT paste the big UPDATEs in the SQL editor and DO NOT run them as a
single `exec_sql` call.** The gateway cancels big UPDATEs on disconnect (only
INSERT…SELECTs survive) — they will silently not commit. **Use the batched
PK-paged scripts** (proven on staging — they read by primary key, update 1,000
at a time via `exec_sql`, retry on lock/timeout):

```bash
# spray labels (hit_location + batted_direction)
npx tsx --env-file-if-exists=.env.production.local scripts/_backfill_spray_labels.ts
# pitch_zone
npx tsx --env-file-if-exists=.env.production.local scripts/_backfill_pitch_zone.ts
```
Each is idempotent (skips already-labeled rows) and resumable. Spray ~15 min,
zone ~30 min on staging-equivalent volume.

> For reference, the equivalent SQL these scripts apply lives in
> `scripts/sql/derive_pitch_log_spray_labels.sql` and
> `scripts/sql/derive_pitch_log_pitch_zone.sql`. Going forward,
> `scripts/derive_pitch_log_flags.ts` sets ALL three labels on ingest, so this
> backfill is **one-time** for the already-ingested prod dataset. (If prod's
> pitch_log is being run FRESH — flags not yet derived — then
> `npm run derive-pitch-log-flags:prod -- --apply` sets every flag + all three
> labels in one pass and Step 2 is unnecessary.)

Verify labels:
```sql
SELECT hit_location, COUNT(*) FROM pitch_log WHERE hit_location IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT batted_direction, COUNT(*) FROM pitch_log WHERE batted_direction IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT pitch_zone, COUNT(*) FROM pitch_log WHERE pitch_zone IS NOT NULL GROUP BY 1 ORDER BY 1;
-- pitch_zone: expect '1'..'9' + UL/UR/LL/LR; center zone (5) biggest in-zone;
-- batted_direction: center biggest, pull > oppo.
```

---

## STEP 3 — Re-aggregate (all dimensions, all tables incl by_zone)

```bash
npm run aggregate-pitch-log-dimensions:prod -- --apply
```
~20-25 min, 48 statements (10 dims × applicable tables, now incl `*_by_zone`).

Two known handling points (both seen on staging):
- ⚠ Re-derive the `vs_top_hitters` p75 cutoff on prod BEFORE running, in case it
  differs from staging's 120.8:
  ```sql
  SELECT ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY overall_power_rating)::numeric,1) AS p75
  FROM "Hitter Master"
  WHERE "Season"=2026 AND overall_power_rating IS NOT NULL AND pa>=100;
  ```
  If ≠ 120.8, update the constant in `scripts/aggregate_pitch_log_dimensions.ts`.
- ⚠ `vs_top_hitters` statements hit the 125s gateway timeout but **survive
  server-side**. The script will FAIL/exit on the first one. Recovery (proven):
  1. `npx tsx --env-file-if-exists=.env.production.local scripts/_kill_locks.ts`
  2. Run the stuff dims via skip:
     `npm run aggregate-pitch-log-dimensions:prod -- --apply --skip=all,vs_lhp,vs_rhp,vs_92plus,vs_fastball,vs_breaking_ball,vs_offspeed,vs_top_hitters`
  3. Emit + run the 3 vs_top_hitters statements solo, then wait ~3 min and verify they committed:
     ```bash
     npm run aggregate-pitch-log-dimensions:prod -- --emit-sql=/tmp/agg_prod --skip=all,vs_lhp,vs_rhp,vs_92plus,vs_fastball,vs_breaking_ball,vs_offspeed,vs_stuff_100plus,vs_stuff_105plus
     for f in vs_top_hitters_pitcher_totals vs_top_hitters_pitcher_by_pitch_type vs_top_hitters_pitcher_by_zone; do
       npx tsx --env-file-if-exists=.env.production.local scripts/_run_sql_file.ts /tmp/agg_prod/$f.sql; done
     ```

Verify aggregation:
```sql
SELECT dimension_key, COUNT(*) FROM pitch_log_pitcher_totals GROUP BY 1 ORDER BY 1;   -- 7 dims
SELECT dimension_key, COUNT(*) FROM pitch_log_hitter_totals  GROUP BY 1 ORDER BY 1;   -- 9 dims
SELECT dimension_key, COUNT(*) FROM pitch_log_pitcher_by_zone GROUP BY 1 ORDER BY 1;  -- 7 dims
SELECT dimension_key, COUNT(*) FROM pitch_log_hitter_by_zone  GROUP BY 1 ORDER BY 1;  -- 9 dims
-- Spot-check the power-rating inputs on a qualified pitcher (all dim):
SELECT pitcher_id, ev_90_allowed, batted_pull_allowed, batted_center_allowed,
       batted_oppo_allowed, batted_pull_air_allowed, batted_la_10_to_30_allowed
FROM pitch_log_pitcher_totals WHERE dimension_key='all' AND total_pitches>=200
ORDER BY total_pitches DESC LIMIT 5;   -- all non-null/non-zero
```

---

## STEP 4 — Frontend deploy (normal flow)

The display changes go through the standard **feature → staging → main** PR.
Files: `PitcherProfile.tsx`, `PlayerProfile.tsx`,
`usePitchLog2026HitterRates.ts`, `PitchingPowerRatingsStorageTable.tsx`
(orphaned — harmless), `BaseballField.tsx`, `usePitchLogTotals.ts`,
`pitchLogRates.ts`, plus the new migration files + aggregator/derive scripts.

After deploy, spot-check on prod-pointed preview: Volantis (pitcher) Internal
Power Ratings bottom-left block computes (no `—`, IZ% reads from pitch_log), and
a hitter's ISO+/Overall+ compute.

---

## ROLLBACK / SAFETY
- All migrations are **additive** (new columns/tables). No drops, no data loss.
- Backfills are **idempotent** (skip already-labeled).
- Re-aggregation is **idempotent** (ON CONFLICT DO UPDATE).
- **Stored projections untouched** — coaches' numbers don't move until the
  separate July precompute. Safe to run during the season.
