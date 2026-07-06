# PROD Upload — Master Log (Pitch Log + Power Ratings)

Single source of truth for **everything** the pitch_log + power-ratings system
needs on **prod** (`trbvxuoliwrfowibatkm`). Ordered, idempotent, every step.

This supersedes / absorbs `PROD_RUNBOOK_pitchlog_spray_zone_2026_06_28.md`
(that's just the last slice) and folds in the base pipeline
(`PITCH_LOG_PROD_RUNBOOK.md`) + the RV/xStats work.

**Golden rules (learned the hard way — see GOTCHAS):**
- Send/paste migrations + small UPDATEs; **never paste the big multi-million-row
  UPDATEs** (gateway cancels them). Use the **batched scripts** for those.
- `exec_sql` INSERT…SELECTs survive the 125s gateway timeout server-side; big
  single UPDATEs do **not**. `vs_top_hitters` always times out → survives → verify.
- Everything is additive + idempotent. **Stored projections are NOT touched**
  (the July precompute is separate). Safe to run mid-season.
- `:prod` npm scripts use `.env.production.local`.

---

## 0 — DETERMINE PROD'S CURRENT STATE (run first)

**KNOWN STATE (verified against prod 2026-06-29 — per-column probe; the
`SELECT *` table-exists check gives FALSE POSITIVES on empty tables, so probe a
real column with `.limit(1)`):**
- Base `pitch_log` present, **2,187,403 reclassified** + Stuff+ + the spray re-export **columns** (`spray_ang`/`distance`/`px_norm`/`pz_norm`/`x_*` exist) but `spray_ang` was populated on only ~13.8k rows → spray data not loaded.
- Base agg tables (`*_totals`, `*_by_pitch_type`, both hands) exist; `parks` exists.
- **Prod was BEHIND on migrations** (schema, not just data): missing **06-27** (pitch_log `hit_location`/`batted_direction` + totals sections/pull-air/EV90/LA10-30), **06-28** (pitch_log `pitch_zone` + the `*_by_zone` TABLES — which did NOT exist), and **#16** (totals cross-tabs + by_pitch_type RV).

**✅ COMPLETE 2026-06-29 (full pipeline done + verified on prod):**
- Migrations 06-27 + 06-28 + #16 applied via `exec_sql` (all `IF NOT EXISTS`).
- Ingest: 30 numeric CSVs, **2,575,749 rows** upserted (the timed-out `2:26-2:28` re-run clean). §4/§5 skipped (reclassify + Stuff+ preserved — raw-fields-only upsert).
- Labels: spray (hit_location/batted_direction) + `pitch_zone` (2,342,700) backfilled + verified (only out-of-±45 / `|px|,|pz|>4` left NULL, by design). NOTE: `_backfill_spray_labels.ts` SELECT now has retry (survived a transient `fetch failed`).
- Re-aggregate: all 48 tasks. `vs_top_hitters` (40-42) hit the 125s gateway timeout → recovered via §8 (`_kill_locks` → stuff dims → `_run_vstop.ts` fires each solo + polls a fresh `computed_at` to confirm the server-side commit before the next). Verified: pitcher 7 dims, hitter 9 dims, RV + cross-tabs + xStats + by_zone all populated.

**`_run_vstop.ts`** (new) is the clean way to finish `vs_top_hitters`: sequential, one-at-a-time, verifies each commit — gentler on prod than firing all 3 at once. Remaining for full launch = **frontend PR** (staging → main) — data is ready.

Run these to confirm before starting:

```sql
-- A. base table + volume
SELECT COUNT(*) AS pitches,
       COUNT(*) FILTER (WHERE is_foul IS NOT NULL) AS flags_done,
       COUNT(*) FILTER (WHERE pitch_type_reclassified IS NOT NULL) AS reclassified,
       COUNT(*) FILTER (WHERE stuff_plus IS NOT NULL) AS stuffplus_done,
       COUNT(*) FILTER (WHERE px_norm IS NOT NULL) AS has_location,
       COUNT(*) FILTER (WHERE spray_ang IS NOT NULL) AS has_spray,
       COUNT(*) FILTER (WHERE hit_location IS NOT NULL) AS spray_labeled,
       COUNT(*) FILTER (WHERE pitch_zone IS NOT NULL) AS zone_labeled
FROM pitch_log;

-- B. which agg tables exist
SELECT table_name FROM information_schema.tables
WHERE table_name LIKE 'pitch_log_%' ORDER BY 1;

-- C. dimension coverage (if aggregated)
SELECT dimension_key, COUNT(*) FROM pitch_log_pitcher_totals GROUP BY 1 ORDER BY 1;

-- D. helper funcs present
SELECT proname FROM pg_proc WHERE proname IN ('exec_sql','bulk_update_pitch_log_stuff_plus');
```
Map results to the sections below. Skip anything already complete (all idempotent).

---

## 1 — MIGRATIONS (paste each file's contents in prod SQL editor, in order)

All in `supabase/migrations/`. Additive — safe to re-run (IF NOT EXISTS guards).

| # | File | Adds |
|---|---|---|
| 1 | `20260619120000_pitch_log_base_table.sql` | `pitch_log` (45 cols) |
| 2 | `20260619140000_pitch_log_computed_columns.sql` | flag/Stuff+ columns |
| 3 | `20260620120000_pitch_log_aggregations.sql` | totals + pitcher_by_pitch_type tables |
| 4 | `20260620140000_pitch_log_helper_functions.sql` | `exec_sql`, `bulk_update_pitch_log_stuff_plus` |
| 5 | `20260622120000_pitch_log_rls.sql` | RLS read policies |
| 6 | `20260622140000_pitch_log_hitter_by_pitch_type.sql` | hitter_by_pitch_type table |
| 7 | `20260623120000_pitch_log_xba_lookup.sql` | `pitch_log_xba_lookup` table |
| 8 | `20260623140000_pitch_log_total_out_of_zone.sql` | `total_out_of_zone` cols (chase/zone denom fix) |
| 9 | `20260623160000_pitch_log_agg_columns_full.sql` | remaining agg columns |
| 10 | `20260624120000_pitch_log_location_spray.sql` | `spray_ang, distance, px_norm, pz_norm, x_*` |
| 11 | `20260625000000_pitch_log_pitcher_by_pitch_type_rv.sql` | RV event-count cols |
| 12 | `20260626000000_pitch_log_pitcher_by_pitch_type_k_split.sql` | looking/swinging K split |
| 13 | `20260627000000_pitch_log_pull_air_la_ev90.sql` | spray sections / pull / EV90 / LA10-30 cols + `hit_location`/`batted_direction` |
| 14 | `20260628000000_pitch_log_by_zone.sql` | `pitch_zone` + `*_by_zone` tables |
| 15 | `20260629000000_parks_dimensions.sql` | `parks` (shared physical fence dimensions — park-aware HR system) |
| 16 | `20260629100000_hitter_ball_flight_rv.sql` | hitter Ball Flight cross-tabs (`batted_*_ground`/`_air` on `hitter_totals`) + RV components (`balls`/`called_strikes`/K-split on `hitter_by_pitch_type`) |

**#16 must run BEFORE the §8 re-aggregate** — the updated `aggregate_pitch_log_dimensions.ts` now emits those columns (hitter `by_pitch_type` RV components + 5 direction×trajectory cross-tabs on hitter totals; `batted_pull_air` standardized to LA≥5 so Pull GB% + Pull Air% = Pull%). Until the re-aggregate runs, the hitter Ball Flight cross-tabs + the vs-Pitch-Type RV column render `—`. No backfill — a normal re-aggregate populates them.

(13 + 14 SQL is inlined in `PROD_RUNBOOK_pitchlog_spray_zone_2026_06_28.md` if you want it in the doc.) Verify after: state-check query A + B above.

**#15 `parks` is independent of the pitch_log chain** — it's the only genuinely-new shared table for the park-aware HR system. Everything else that doc proposes already exists: `organizations`→`customer_teams`, `memberships`→`user_team_access`, `current_org_ids()`→`has_role`/`is_team_member`, `programs`→"Teams Table", private `batted_balls`→`pitch_log`. So do NOT build those — reuse them. Can run anytime (no data backfill; load rows from the parks CSV after).

After loading rows, backfill `team_id` (matches `parks` → "Teams Table") so a customer's park resolves via `customer_teams.school_team_id`, then feed `BaseballField.dimensions` (currently hardcoded 330/370/400/370/330) from it — it maps the 7 fence points (lf_line…rf_line) to the 5 it draws.

**parks CSV column order:** `slug, program, conference, stadium, lf_line, lf_gap, lc, cf, rc, rf_gap, rf_line, wall_ht_ft, outfield_sqft, altitude_ft`. First confirmed row: `georgia,Georgia,SEC,Foley Field,350,347,364,390,387,340,314,8,90767,` (altitude blank → null; sanity-flag: lf_gap 347 < lf_line 350 — confirm not a swap).

---

## 2 — INGEST (re-run on prod to LOAD THE SPRAY DATA)

**Source: `~/dev-main/pitch_logs/` — use the 30 NUMERIC-dated CSVs only**
(`2:13 Pitch Log.csv` … `5:22-6:24 Pitch Log.csv`, i.e. `4/12`-style). The dir
also holds a duplicate spelled-out set (`April11-April12 …`, 31 files) — **skip
those** (same data, redundant). Glob `[0-9]*.csv` matches exactly the numeric set
(continuous Feb13→Jun24, no gaps). Header carries the 2026-06-24 fields:
`SprayAng`, `dist`, `infieldDist`, `PZNorm`, `PXNorm`.
**This is the prod spray-load mechanism** — prod has the base rows but only
~13.8k with `spray_ang`; the ingest **upserts on `uniq_pitch_id` (idempotent)**,
so re-running all 61 fills `spray_ang`/`dist`/`px_norm`/`pz_norm` onto the
existing 2.19M rows. Required even though `pitch_log` isn't empty.
```bash
for csv in ~/dev-main/pitch_logs/[0-9]*.csv; do   # numeric-dated set only
  echo "=== $(basename "$csv") ==="
  npm run ingest-pitch-log:prod -- "$csv" --apply
done
```
~15-20 min. Expect ~2,573,869 pitches, 5,415 pitchers, 6,096 batters, Feb13–Jun14.

**The upsert payload is RAW fields only** (no `stuff_plus` / `pitch_type_reclassified`
/ flags / labels in the record), so on conflict those computed columns are NOT in
the `DO UPDATE SET` → **preserved**. So on prod: re-ingest only refreshes raw fields
(adds spray) and **§4 reclassify + §5 Stuff+ can be SKIPPED** (already done, untouched).
Prod path = **§2 ingest → §3 derive labels (needs spray_ang) → §8 re-aggregate** (skip
`vs_top_hitters`). Verify `spray_ang` count jumps to ~394k after, then labels after §3.

---

## 3 — DERIVE FLAGS + LABELS

**`derive_pitch_log_flags.ts` now sets the booleans + category + `hit_location`
+ `batted_direction` + `pitch_zone` in ONE pass** (reads `px_norm`/`pz_norm`/
`spray_ang`/`batter_hand`).

### Path A — pitch_log is FRESH (flags not yet derived): one command does it all
```bash
npm run derive-pitch-log-flags:prod -- --apply
```
This sets every flag AND all three labels. **Skip section 6 (backfills).**

### Path B — flags ALREADY derived on prod (older pipeline, missing new labels)
The derive script skips rows where `is_foul` is already set, so the new labels
(`hit_location`/`batted_direction`/`pitch_zone`) won't backfill that way →
use the batched backfills in section 6.

---

## 4 — RECLASSIFY PITCH TYPES (only if not yet done)
```bash
npm run reclassify-pitch-log:prod -- --apply
```
Or paste the reclassify CASE UPDATE from `PITCH_LOG_PROD_RUNBOOK.md` Step 4
(with `SET statement_timeout='600s';`). ~2.19M classified, ~386K NULL.

---

## 5 — STUFF+ PER PITCH (only if not yet done)
```bash
npm run compute-pitch-log-stuff-plus:prod -- --apply
```
~15 min. Each (pitch_type × hand) bucket mean ≈ 100-102.

---

## 6 — BACKFILL LABELS (Path B only — flags already derived without new labels)

⚠ **Batched scripts only** — do NOT paste these UPDATEs (gateway cancels them).
```bash
# spray labels (hit_location + batted_direction) — ~440K batted balls, ~15 min
npx tsx --env-file-if-exists=.env.production.local scripts/_backfill_spray_labels.ts
# pitch_zone — ~2.3M located pitches, ~30 min
npx tsx --env-file-if-exists=.env.production.local scripts/_backfill_pitch_zone.ts
```
Both idempotent + resumable. Verify: state-check query A (`spray_labeled`,
`zone_labeled` > 0), plus distribution:
```sql
SELECT pitch_zone, COUNT(*) FROM pitch_log WHERE pitch_zone IS NOT NULL GROUP BY 1 ORDER BY 1;
SELECT batted_direction, COUNT(*) FROM pitch_log WHERE batted_direction IS NOT NULL GROUP BY 1 ORDER BY 1;
```

---

## 7 — xBA LOOKUP (only if `pitch_log_xba_lookup` empty)
```bash
npm run build-xba-lookup:prod
```
~2 min. ~9,500-10,500 (EV, LA) bucket rows.

---

## 8 — RE-AGGREGATE (every time data/labels change — the big one)

```bash
npm run aggregate-pitch-log-dimensions:prod -- --apply
```
~20-25 min, 48 statements (10 dims × applicable tables incl `*_by_zone`).

**`vs_top_hitters` is the slow dimension** (the heavy IN-subquery; pre-resolved in
the script but still the longest, ~several min). For a FULL build (pitcher + hitter
data, like the prod upload) it **MUST run** — it's a real pitcher dimension (pitchers
vs elite hitters) and powers the "vs Top Hitters" view. **Do NOT `--skip` it on prod.**
The only time it's skippable is a **hitter-only** patch where you just need the
hitter tables refreshed (e.g. the 2026-06-29 staging cross-tab/RV fill) — there it's
irrelevant. So: prod = run ALL dims; hitter-only patch = `--skip=vs_top_hitters` ok.

**BEFORE running:** re-derive the `vs_top_hitters` p75 cutoff on prod:
```sql
SELECT ROUND(percentile_cont(0.75) WITHIN GROUP (ORDER BY overall_power_rating)::numeric,1) AS p75
FROM "Hitter Master" WHERE "Season"=2026 AND overall_power_rating IS NOT NULL AND pa>=100;
```
If ≠ 120.8, update the constant in `scripts/aggregate_pitch_log_dimensions.ts`.

**`vs_top_hitters` will time out (125s) → survives server-side → script exits.**
Recovery (proven on staging):
```bash
# 1. clear the timed-out statement's lock
npx tsx --env-file-if-exists=.env.production.local scripts/_kill_locks.ts
# 2. run the two stuff dims (they finish fast)
npm run aggregate-pitch-log-dimensions:prod -- --apply \
  --skip=all,vs_lhp,vs_rhp,vs_92plus,vs_fastball,vs_breaking_ball,vs_offspeed,vs_top_hitters
# 3. emit + run the 3 vs_top_hitters statements solo, wait ~3 min, verify they committed
npm run aggregate-pitch-log-dimensions:prod -- --emit-sql=/tmp/agg_prod \
  --skip=all,vs_lhp,vs_rhp,vs_92plus,vs_fastball,vs_breaking_ball,vs_offspeed,vs_stuff_100plus,vs_stuff_105plus
for f in vs_top_hitters_pitcher_totals vs_top_hitters_pitcher_by_pitch_type vs_top_hitters_pitcher_by_zone; do
  npx tsx --env-file-if-exists=.env.production.local scripts/_run_sql_file.ts /tmp/agg_prod/$f.sql; done
```

Verify:
```sql
SELECT dimension_key, COUNT(*) FROM pitch_log_pitcher_totals  GROUP BY 1 ORDER BY 1;  -- 7
SELECT dimension_key, COUNT(*) FROM pitch_log_hitter_totals   GROUP BY 1 ORDER BY 1;  -- 9
SELECT dimension_key, COUNT(*) FROM pitch_log_pitcher_by_zone GROUP BY 1 ORDER BY 1;  -- 7
SELECT dimension_key, COUNT(*) FROM pitch_log_hitter_by_zone  GROUP BY 1 ORDER BY 1;  -- 9
-- power-rating inputs populated (all dim):
SELECT pitcher_id, ev_90_allowed, batted_pull_allowed, batted_pull_air_allowed, batted_la_10_to_30_allowed
FROM pitch_log_pitcher_totals WHERE dimension_key='all' AND total_pitches>=200
ORDER BY total_pitches DESC LIMIT 5;
```

---

## 9 — CALIBRATE xSTATS (after aggregation, if xStat displays drift)
```bash
npm run calibrate-xstats-quantile:prod
```
Prints TS const arrays. Replace `HITTER_XBA/XSLG/XWOBA_LOOKUP` +
`PITCHER_XBA/XSLG_LOOKUP` in `src/savant/lib/pitchLogRates.ts`, commit, deploy.

---

## 10 — FRONTEND DEPLOY (normal feature → staging → main PR)

Power ratings read pitch_log-first (display only):
- `src/pages/PitcherProfile.tsx`, `src/pages/PlayerProfile.tsx`
- `src/hooks/usePitchLog2026HitterRates.ts` (ev90 + pull derive)
- `src/components/PitchingPowerRatingsStorageTable.tsx` (orphaned — harmless)
- `src/savant/components/BaseballField.tsx`, `src/savant/hooks/usePitchLogTotals.ts`, `src/savant/lib/pitchLogRates.ts`
- migrations 13/14 + `aggregate_pitch_log_dimensions.ts` + `derive_pitch_log_flags.ts`

Post-deploy on prod-pointed preview: Volantis (pitcher) Internal Power Ratings
computes (no `—`, IZ% from pitch_log); a hitter's ISO+/Overall+ compute.

---

## NOT IN THIS UPLOAD (separate, deferred)
- **July precompute** — sourcing the STORED power ratings (the ones that build
  projections) from pitch_log + re-running precompute. See
  `POWER_RATINGS_PITCHLOG_HANDOFF_2026_06_26.md` § July Runbook. Touches the
  duplicated-math set in lockstep.
- **Configurable zone/field display UI** — frontend build on top of the
  now-stored by_zone data.

---

## GOTCHAS (the pain, saved)
- **Big UPDATEs via exec_sql/editor get cancelled on the 125s gateway
  disconnect** (labels stay 0). INSERT…SELECTs survive. → batched PK-paged
  scripts for backfills; survive-then-verify for `vs_top_hitters`.
- **Zombie locks**: a killed/timed-out big UPDATE holds row locks and blocks new
  writes (`lock timeout`). Clear with `scripts/_kill_locks.ts` (terminates
  pitch_log lock-holders >45s by `pg_locks`, not query text).
- **`.upsert()` can't partial-update pitch_log** (`season NOT NULL`). Use
  `UPDATE … FROM (VALUES …)` via exec_sql (batched scripts do this).
- **Reads over 2.5M on unindexed filters time out** → page by primary key, filter
  in JS (what the batched backfills do).
- **`vs_top_hitters` 977-id filter** exceeds 125s → survives server-side → verify
  after a short wait; don't kill it before checking.
