# Pitch Log Build — Handoff Document

**Date:** 2026-06-19
**Where we are:** Phase 2d (Stuff+ per pitch) — blocked on user creating one Postgres function, then ready to run.
**Environment:** All work on **staging only**. Nothing has touched prod.

---

## TL;DR

The 2026 pitch log architecture is **75% built**. All 2.57M pitches are ingested, flagged, and classified. The last remaining step in Phase 2 is computing Stuff+ scores per pitch — code is ready, blocked on creating one Postgres helper function on staging.

After Phase 2 finishes, Phases 3–6 (aggregations → display) still need to be built.

---

## 1. What's DONE

### Phase 1 — Raw ingestion ✅

**Tables created on staging:**
- `public.pitch_log` — base table with 45 columns
- Migration file: `supabase/migrations/20260619120000_pitch_log_base_table.sql`

**Data on staging:**
- **2,573,869 total pitches**
- Date range: **2026-02-13 → 2026-06-14** (full regular season + postseason)
- **5,415 unique pitchers, 6,096 unique batters, 32 source CSV files**
- 88.6% has_velo (TruMedia captured velocity)
- 78.1% is_data (full Hawkeye/KinaTrax capture — velo + IVB + HB)

**Source files ingested from `~/dev-main/pitch_logs/`:**
- 31 single-day or few-day CSVs (Feb 13 → June 12)
- 1 multi-week rollup (`April7-May4 Pitch Log.csv`) — kept because its rows overlapped with smaller files via upsert
- Removed locally: `Feb12-Mar9`, `Mar10-April6`, `May5-June1`, `May22-June16` (TruMedia 100K cap meant they were just truncated subsets — single-day files covered same dates completely; **except `May22-June16` was kept because it's the only postseason coverage**)

**Ingestion script:** `scripts/ingest_pitch_log.ts` (npm: `ingest-pitch-log`)
- Position-indexed CSV parsing (handles TruMedia's 4 duplicate column names)
- Batch upsert, idempotent on `uniq_pitch_id`
- Strips `(N)` doubleheader suffix from dates
- Logs tracking-data ratios per file

### Phase 2a — Computed columns migration ✅

Added 11 nullable columns + 2 indexes:

- `is_foul`, `is_in_zone`, `is_strike`, `is_swing`, `is_whiff`, `is_chase`, `is_in_play`, `is_batted_ball_in_play` (booleans)
- `pitch_result_category` (text)
- `pitch_type_reclassified` (text)
- `stuff_plus` (numeric)
- Indexes: `(pitch_type_reclassified, pitcher_hand)`, partial on `is_in_zone IS NOT NULL`

Migration file: `supabase/migrations/20260619140000_pitch_log_computed_columns.sql`

### Phase 2b — Flag derivation ✅

All 2.57M rows have boolean outcome flags + normalized category populated.

**Counts:**
| Metric | Count | % |
|---|---|---|
| Fouls | 392,246 | 15% |
| Strikes | 1,551,816 | 60% |
| In Zone | 974,379 | 38% |
| Swings | 1,097,834 | 43% |
| Whiffs | 258,087 | 10% |
| Chases | 247,484 | 10% |
| In Play | 447,501 | 17% |
| HRs | 17,766 | 0.7% |

**Logic:** Session 1 locked rulings (strike rate includes balls-in-play, foul EVs excluded, in-zone threshold cs_prob ≥ 0.50, etc.). Full breakdown in `docs/PITCH_LOG_BUILD.md` §5.

**Script:** `scripts/derive_pitch_log_flags.ts` (npm: `derive-pitch-log-flags`).

### Phase 2c — Pitch type reclassification ✅

All breakable pitches classified into one of 9 types. Logic ported from `src/savant/lib/breakingBallReclassification.ts` (reclassifyRHP/reclassifyLHP) to inline SQL CASE.

| Pitch | Count | % |
|---|---|---|
| 4-Seam Fastball | 1,042,175 | 40.5% |
| Change-up | 256,532 | 10.0% |
| Cutter | 207,697 | 8.1% |
| Slider | 166,442 | 6.5% |
| Gyro Slider | 160,477 | 6.2% |
| Sinker | 157,815 | 6.1% |
| Curveball | 111,276 | 4.3% |
| Sweeper | 70,606 | 2.7% |
| Splitter | 14,382 | 0.6% |
| **NULL** | **386,467** | **15.0%** |

**NULL breakdown:**
- 285,359 — TruMedia couldn't identify the pitch (raw `pitch_type IS NULL / 'UN'`)
- 101,108 — has pitch_type but missing movement (SL/CU/FC without IVB+HB)

**Decision locked:** Movement-based classification wins over scouting tradition (and TruMedia's mislabeled raw tags). Trevor confirmed Hunter Elliott's 18% Cutter rate is correct because the movement profile (6.2 IVB, 3.6 HB at 83 mph) is **textbook cutter shape**. Volchko-style FA-tagged-as-cutter pitches are not auto-corrected yet (see deferred §3).

**Script:** `scripts/reclassify_pitch_log.ts` (npm: `reclassify-pitch-log`)

---

## 2. What's IN PROGRESS

### Phase 2d — Stuff+ per pitch ⏳

**Status:** Script is built and debugged. Blocked on user creating one Postgres function on staging, then ready to run.

**Run 1 result (last attempt):**
- Scored 1,115,407 rows in memory across 16 (pitch_type × hand) buckets
- Recenter pass computed correctly (bucket means at +2 to +7 above 100, shifts applied)
- ~894K 4-Seam Fastball rows were SKIPPED — pop constants use `"4S FB"` key but reclassification produced `"4-Seam Fastball"` (different strings)
- All upserts FAILED — Supabase `upsert()` tries to INSERT for missing rows, hits the `season NOT NULL` constraint

**Both bugs fixed in latest script:**
1. Added `POP_TYPE_KEY` mapping: `"4-Seam Fastball" → "4S FB"` (recovers the 894K)
2. Switched persistence from `upsert()` to a bulk RPC function (~5 min vs 3+ hours per-row UPDATEs)

**What user needs to do BEFORE running again:**

Paste this on staging SQL editor:

```sql
CREATE OR REPLACE FUNCTION public.bulk_update_pitch_log_stuff_plus(updates jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected int;
BEGIN
  WITH u AS (
    SELECT (elem->>'uniq_pitch_id')::text AS uniq_pitch_id,
           (elem->>'stuff_plus')::numeric AS stuff_plus
    FROM jsonb_array_elements(updates) AS elem
  )
  UPDATE public.pitch_log p
  SET stuff_plus = u.stuff_plus
  FROM u
  WHERE p.uniq_pitch_id = u.uniq_pitch_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
```

**Then run:** `npm run compute-pitch-log-stuff-plus -- --apply`

Estimated runtime: ~10 min (4 min to score + ~5 min to bulk-update via RPC).

**Pipeline the script runs:**
1. Loads pop constants from `pitcher_stuff_plus_ncaa` (D1, season 2026, 18 buckets = 9 pitch types × 2 hands)
2. Streams pitch_log rows where `is_data = TRUE AND pitch_type_reclassified IS NOT NULL AND stuff_plus IS NULL`
3. For each: builds `PitchRow` with `pitches=1`, calls `calculateStuffPlus(popKey, row, pop)` from `src/savant/lib/stuffPlusEngine.ts`
4. Recenter pass: per (pitch_type × hand) bucket, shifts scores so bucket mean = 100 (excludes outliers >140 / <60)
5. Bulk updates all `stuff_plus` values via the RPC function

**Script:** `scripts/compute_pitch_log_stuff_plus.ts` (npm: `compute-pitch-log-stuff-plus`)

**Simplification active:** Change-up `fb_ch_velo_diff` is set to `null` (engine treats as "matches population mean"). Per-pitcher fastball velo precompute exceeded Supabase statement timeout. Deferred to follow-up — see §3.

---

## 3. What still needs to be done (in build order)

### Phase 3 — Layer 2 + 3 aggregations 📋

Build the rollup tables that feed the Profile UI:

- `pitch_log_totals` — counting stats per (player_id, side, season). Strike #, Ball #, BBIP, In-zone #, Whiff #, GB/LD/FB/PU #, Barrel #, Hard Hit #, BB #, Chase #, LA 10-30 #, IZ Whiff #, IZ Swing #, CSW # (pitcher only), Hit #, Total Bases #, On-base #. Both hitter and pitcher rows per player.
- `pitch_log_rates` — derived percentages: Avg EV (BBIP), EV90 (BBIP), Contact %, Whiff %, GB/LD/FB/PU %, Walk %, Chase %, Barrel %, LA 10-30 %, Hard Hit %, IZ Whiff %, IZ %, CSW %, Stuff+ avg
- **Data reliability tier** column per row: `data_reliability_pct = COUNT(*) FILTER (WHERE is_data) / COUNT(*)`, then percentile bucket across season for tier label (elite/above avg/avg/below avg/poor)

### Phase 4 — Layer 4 filter splits 📋

Per-dimension rows on a splits table: `(player_id, side, season, dimension_key)` where `dimension_key` is `all`, `vs_lhp`, `vs_rhp`, `vs_95plus`, `stuff_100plus`, `stuff_105plus`, `weekday`, `weekend`, `home`, `away`, `high_lev`, `close_game`. Same metric columns as Layer 3, scoped to the dimension.

### Phase 5 — Profile UI 📋

- Filter dropdown on PlayerProfile + PitcherProfile
- Reads from Layer 4 by `(player_id, side, season, dimension_key)`
- **DO NOT silently swap displays** — first compare new pitch log %s vs existing PitcherProfile displays for 5–10 sample pitchers, then swap with a defensible diff story (see [[project_pitch_usage_audit_pending]] memory)

### Phase 6 — Drive auto-ingestion 📋

Replace manual CSV-to-folder workflow with automatic Drive pull. Triggered per outing. Only after Phase 5 is shipping reliably.

---

## 4. Deferred refinements (logged, not blocking)

### FA → Cutter movement check (Volchko case)

The current reclassification only applies movement-based logic to raw `SL / CU / FC`. Raw `FA` (4-seam fastball) is passed through. Some pitchers self-tag a true cutter as a fastball (Joey Volchko was the example).

**Fix (when revisiting):**

```sql
WHEN pitch_type = 'FA' THEN
  CASE
    WHEN ivb IS NOT NULL AND hb IS NOT NULL
         AND ivb < 12 AND ABS(hb) < 6
      THEN 'Cutter'
    ELSE '4-Seam Fastball'
  END
```

Rationale: real 4-seam FBs have IVB 14-22 with HB 6-12. Cutters have IVB 4-10 with `abs(HB) < 5`. The two clusters don't overlap so the threshold is safe.

### Coach pitch-type override UI

Per-pitcher per-pitch-type override (e.g. "Trevor says Elliott's IVB-6 pitches are actually Sliders not Cutters"). When override applied, must trigger Stuff+ recompute for affected pitches.

### Per-pitcher fastball velo precompute (for changeup `fb_ch_velo_diff`)

Current Stuff+ run zeroes out `fb_ch_velo_diff`. Changeup Stuff+ loses some per-pitcher accuracy. Worth precomputing via server-side SQL view or RPC and joining into the scoring pipeline. Other 8 pitch types not affected.

---

## 5. Key decisions locked in

| Decision | Rationale |
|---|---|
| Movement-based reclassification wins over scout-tradition labels | Pitchers and TruMedia mislabel themselves. Physics is the only objective signal. |
| Elliott's 18% cutter is correct | Movement profile (6.2 IVB, 3.6 HB at 83mph) is textbook cutter; the "slider" label coaches expect is calibrated to mislabeled TruMedia tags. |
| Coach UI override is the long-term fix for label disagreements | Keep data layer truthful, give UI escape hatch. Override triggers Stuff+ recompute on affected pitches. |
| Recenter Stuff+ per (pitch_type × hand) bucket, not per pitcher | Locks each bucket at mean = 100 across the population. Same as the existing Savant aggregate pipeline. |
| Per-pitch fb_ch_velo_diff zeroed for now (changeups only) | Per-pitcher fastball velo precompute exceeded statement timeout. Approximation. Other 8 pitch types unaffected. |
| Multi-week rollup CSVs deleted from local (except May22-June16) | TruMedia 100K cap meant they only contained truncated date-range subsets that smaller files already covered. May22-June16 is the only postseason source. |

---

## 6. Files created

```
docs/
  PITCH_LOG_BUILD.md                              # canonical build spec (read this first)
  PITCH_LOG_HANDOFF_2026_06_19.md                 # this file

supabase/migrations/
  20260619120000_pitch_log_base_table.sql         # Phase 1 schema
  20260619140000_pitch_log_computed_columns.sql   # Phase 2a schema additions

scripts/
  ingest_pitch_log.ts                             # Phase 1 ingest
  derive_pitch_log_flags.ts                       # Phase 2b
  reclassify_pitch_log.ts                         # Phase 2c
  compute_pitch_log_stuff_plus.ts                 # Phase 2d (in progress)

package.json scripts:
  ingest-pitch-log[:prod]
  derive-pitch-log-flags[:prod]
  reclassify-pitch-log[:prod]
  compute-pitch-log-stuff-plus[:prod]
```

## 7. Relevant memory files

- `project_tomorrow_priorities_2026_06_18.md` — the original priority that kicked off this work
- `project_pitch_usage_audit_pending.md` — "existing pitch usage on PitcherProfile is wrong, this is the fix; do side-by-side comparison before swap"
- `docs/PITCH_LOG_BUILD.md` — the full spec with all locked rulings, schema, layer plan

---

## 8. Resume checklist for next session

When picking this back up:

1. **Confirm with Trevor**: did the `bulk_update_pitch_log_stuff_plus` function get created on staging?
2. If yes: run `npm run compute-pitch-log-stuff-plus -- --apply` in background (~10 min)
3. After Stuff+ finishes, verify on staging:
   ```sql
   SELECT pitch_type_reclassified, pitcher_hand,
          COUNT(*) AS n,
          ROUND(AVG(stuff_plus)::numeric, 1) AS mean_stuff_plus,
          ROUND(MIN(stuff_plus)::numeric, 1) AS min_stuff_plus,
          ROUND(MAX(stuff_plus)::numeric, 1) AS max_stuff_plus
   FROM pitch_log
   WHERE stuff_plus IS NOT NULL
   GROUP BY pitch_type_reclassified, pitcher_hand
   ORDER BY pitch_type_reclassified, pitcher_hand;
   ```
   Each bucket's mean_stuff_plus should be ~100 (recenter worked). Min/max should mostly be in [60, 140] (outliers should be rare).
4. Spot-check a known pitcher (e.g., Hunter Elliott, Gabe Gaeckle, Brett Renfrow): pull their pitch mix with Stuff+ avg per pitch type, sanity-check the scores look right.
5. Proceed to Phase 3 (Layer 2 + 3 aggregation tables).
