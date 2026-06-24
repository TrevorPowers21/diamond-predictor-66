# Pitch Log Build — Session Handoff

**Date:** 2026-06-22 (updated 2026-06-22 PM)
**Where we are:** **Phase 4 COMPLETE on staging. Prod runbook ready. Phase 5 (Savant UI) is next.**
**Environment:** All work on **staging only** — nothing has touched prod yet.

---

## 🚨 Read first — current status (updated end of session 2026-06-22 PM)

Phases 1–4 are fully built on staging. The prod transition is a **paste-and-go runbook**: [`docs/PITCH_LOG_PROD_RUNBOOK.md`](PITCH_LOG_PROD_RUNBOOK.md).

### Final dimension lineup (after the vs_95plus rework mid-session)

We discovered `vs_95plus` had a sample problem (only 858 of 5,415 pitchers ever threw a 95+ pitch — too few for a useful pitcher dimension), so we restructured:

- **DROPPED:** `vs_95plus` from all 3 tables
- **NEW (hitters only):** `vs_92plus` — pitches each hitter SAW at 92+ mph. 5,048 of 6,096 hitters have at least one row. Lower threshold + hitter-only makes the sample real.
- **NEW (pitchers only):** `vs_top_hitters` — pitches each pitcher threw against the **top quartile of qualified 2026 hitters** (Hitter Master `overall_power_rating ≥ 120.8` AND `pa ≥ 100`). Threshold derived from p75 on staging 2026-06-22. 978 hitters qualify; 5,249 of 5,415 pitchers faced at least one. Captures "how does this arm hold up against elite bats."

### Final aggregation rows per side

| Dimension | Pitcher rows | Hitter rows |
|---|---|---|
| `all` | 5,415 | 6,096 |
| `vs_lhp` | 5,377 | 5,556 |
| `vs_rhp` | 5,403 | 6,007 |
| `vs_92plus` | — (hitter only) | 5,048 |
| `vs_fastball` | 5,366 | 5,822 |
| `vs_breaking_ball` | 5,215 | 5,530 |
| `vs_offspeed` | 4,953 | 5,277 |
| `vs_top_hitters` | 5,249 | — (pitcher only) |

7 dimensions per side. Pitcher tables don't have `vs_92plus` rows; hitter tables don't have `vs_top_hitters` rows. The `applies_to` flag on each dimension entry in the script controls this.

### Script consolidation: Phase 3 'all' folded into the Phase 4 script

Previously the Phase 3 'all' INSERTs were pasted manually and Phase 4 used the script. As of this session, the `all` dimension is a regular entry in [`scripts/aggregate_pitch_log_dimensions.ts`](../scripts/aggregate_pitch_log_dimensions.ts) (with `pitcher_filter: "true"` and `hitter_filter: "true"` as always-true predicates).

**One script run does everything aggregation-wise.** No more separate Phase 3 pastes. The full Phase 3+4 pipeline is now:
```bash
npm run aggregate-pitch-log-dimensions:prod -- --apply
```
~10-12 min for all 19 INSERT...SELECTs (8 dimensions × applicable tables; some pitcher-only or hitter-only).

### New helper-function migration

[`supabase/migrations/20260620140000_pitch_log_helper_functions.sql`](../supabase/migrations/20260620140000_pitch_log_helper_functions.sql) — defines:
- `exec_sql(text)` — runs arbitrary SQL with 15-min statement timeout. Used by the aggregation script. Revoked from anon/authenticated (service_role only).
- `bulk_update_pitch_log_stuff_plus(jsonb)` — bulk Stuff+ UPDATEs. Used by the Stuff+ scoring script.

Both `SECURITY DEFINER`, both REVOKEd from anon/authenticated so PostgREST cannot expose them externally. Documented + commented.

### Migration drift fixed

The base table migration had `pitch_result text NOT NULL`, but on staging we'd ALTER'd it nullable mid-build to absorb edge-case rows. The migration file was updated to match (still nullable) so prod runs cleanly without a follow-up ALTER.

### Prod transition is one runbook

[`docs/PITCH_LOG_PROD_RUNBOOK.md`](PITCH_LOG_PROD_RUNBOOK.md) walks through the full prod replay in **6 steps**, ~60-90 min hands-on:

1. Paste 4 migration files in prod SQL editor
2. `npm run ingest-pitch-log:prod` over the 32 CSVs (~15 min)
3. Paste flag-derivation UPDATE (~3 min)
4. Paste reclassification UPDATE (~3 min)
5. `npm run compute-pitch-log-stuff-plus:prod -- --apply` (~15 min)
6. `npm run aggregate-pitch-log-dimensions:prod -- --apply` (~10-12 min) — covers all 8 dimensions

⚠ Re-derive the `vs_top_hitters` p75 cutoff on prod before Step 6 — staging gave 120.8 but prod may differ. Script constant lives in `scripts/aggregate_pitch_log_dimensions.ts` if it needs adjusting.

### Display layer pattern (locked decision, worth knowing for Phase 5)

The aggregation tables store **counts only**. Rates (AVG, OBP, SLG, whiff%, chase%, K%, BB%, etc.) get derived at display time in React via simple `count / count` division on the one row returned for `(player_id, dimension_key)`. No live SQL aggregation, no scans of `pitch_log`. The same `deriveRates()` function works for every filter — the dimension dropdown just rebinds which row gets read.

### What's next

- **Phase 5 — Savant page UI**: add the new filter section to `src/savant/pages/PitcherPage.tsx` + `HitterPage.tsx`. Reads aggregation tables by `(player_id, season, dimension_key)`. Filter dropdown sets dimension. Rates derived client-side.
- **Phase 6 — Drive auto-ingestion**: only after Phase 5 ships.
- **Prod transition**: can run before or after Phase 5. Either order works.

---

## TL;DR of the full pitch log build

The 2026 pitch log architecture is **data-complete on staging**. Layer 1 (raw), Layer 2 (computed flags), Layer 2.5 (Stuff+ per pitch), and Layer 3 (8 filter dimensions across 3 aggregation tables) are all DONE. Phases 5–6 (Savant page surface + Drive auto-ingestion) still need to be built.

---

## Status by phase

### Phase 1 — Raw ingestion ✅ COMPLETE

- **`public.pitch_log` table** with 45 columns (raw + computed presence flags + audit)
- **2,573,869 pitches** ingested from 32 TruMedia CSV files
- Date range: **Feb 13 → June 14 2026** (full regular season + postseason)
- **5,415 unique pitchers, 6,096 unique batters**
- Tracking ratios: **88.6% has_velo, 78.1% fully_tracked (is_data)**
- Schema migration: `supabase/migrations/20260619120000_pitch_log_base_table.sql`
- Ingest script: `scripts/ingest_pitch_log.ts` (npm: `ingest-pitch-log`)
- CSV source: `~/dev-main/pitch_logs/` (outside repo, intentionally)

**Key fixes during this phase:**
- TruMedia uses `(N)` suffix on dates for doubleheaders — strip before parsing
- 4 silent duplicate column names in TruMedia exports — position-indexed CSV reading (not name-indexed)
- Multi-week rollup CSVs deleted (truncated by 100K cap) — kept `May22-June16` as only postseason source
- Numeric columns widened from precision-specific to bare `numeric` to handle edge-case values

### Phase 2a — Computed columns migration ✅ COMPLETE

11 nullable columns + 2 indexes added:
- Booleans: `is_foul`, `is_in_zone`, `is_strike`, `is_swing`, `is_whiff`, `is_chase`, `is_in_play`, `is_batted_ball_in_play`
- Text: `pitch_result_category`, `pitch_type_reclassified`
- Numeric: `stuff_plus`
- Migration: `supabase/migrations/20260619140000_pitch_log_computed_columns.sql`

### Phase 2b — Flag derivation ✅ COMPLETE

All 2.57M rows have booleans + category populated from `pitch_result` + `cs_prob`.

**Counts (verified on staging):**
- Fouls: 392,246 (15%)
- Strikes: 1,551,816 (60%)
- In Zone: 974,379 (38%)
- Swings: 1,097,834 (43%)
- Whiffs: 258,087 (10%)
- Chases: 247,484 (10%)
- In Play: 447,501 (17%)
- HRs: 17,766 (0.7%)

Logic ports Session 1 locked rulings (strike rate includes balls-in-play, foul EVs excluded, IZ-whiff denom is swings-in-zone, etc.).

Script: `scripts/derive_pitch_log_flags.ts` (npm: `derive-pitch-log-flags`)

Note: The actual UPDATE was pasted into Supabase SQL editor manually (without BEGIN/COMMIT so it survived the gateway timeout). The TS script's exec_sql fallback wasn't usable until `exec_sql` got created later.

### Phase 2c — Pitch type reclassification ✅ COMPLETE

2.19M pitches classified into 9 categories; 386K NULL.

**Distribution:**
- 4-Seam Fastball: 1,042,175 (40.5%)
- Change-up: 256,532 (10.0%)
- Cutter: 207,697 (8.1%)
- Slider: 166,442 (6.5%)
- Gyro Slider: 160,477 (6.2%)
- Sinker: 157,815 (6.1%)
- Curveball: 111,276 (4.3%)
- Sweeper: 70,606 (2.7%)
- Splitter: 14,382 (0.6%)
- **NULL: 386,467 (15.0%)** — 285K untracked + 101K breaking balls without movement

**Logic:** Ports `reclassifyRHP` / `reclassifyLHP` from `src/savant/lib/breakingBallReclassification.ts` to inline SQL CASE. Priority: Cutter (IVB > 6 high-slot / > 3 low-slot) > Gyro Slider (IVB ≥ -3, HB in [-7, 7]) > Curveball (IVB ≤ -8) > Sweeper (HB ≤ -11 RHP / ≥ +11 LHP, IVB > -4) > Slider (default).

**Spot-check learning:** Hunter Elliott's pitches at IVB 6.2 / HB 3.6 / 83mph get tagged Cutter (~18% of his pitches). Trevor confirmed this matches actual physics — TruMedia's raw `SL` tag conflates true sliders with cutters. The movement-based classification is right; "labels coaches expect" are calibrated to mislabeled TM tags.

Script: `scripts/reclassify_pitch_log.ts` (npm: `reclassify-pitch-log`)

### Phase 2d — Stuff+ per pitch ✅ COMPLETE (v2)

**2,009,602 pitches scored, clamped to [40, 160], recentered, persisted.**

**v1 attempt:** Bucket means came out at 230-540 (instead of 100) because 3.1% of pitches had extreme outlier scores (some 16,000+). The recenter math was correct, but outliers polluted persisted means.

**v2 fix:** Clamp raw per-pitch score to [40, 160] BEFORE the recenter pass. Outliers can't pull bucket means anymore.

**Final v2 result — all 18 (pitch_type × hand) buckets settle at mean 100.76 – 102.52** with max ~153-157 (clamp ceiling minus shift) and min ~34-78. Recenter shifts range +2.1 to +7.3 across buckets.

**Pipeline:**
1. Load pop constants from `pitcher_stuff_plus_ncaa` (D1, season 2026, 18 buckets)
2. Stream pitch_log where `is_data = TRUE AND pitch_type_reclassified IS NOT NULL`
3. For each pitch: build `PitchRow` with `pitches=1`, call `calculateStuffPlus(popKey, row, pop)` from `src/savant/lib/stuffPlusEngine.ts`
4. **Clamp raw score to [40, 160]**
5. Per (pitch_type × hand) bucket: compute mean of in-range (60-140) scores, derive shift = mean - 100
6. Apply shift to ALL scored rows
7. Bulk update via `public.bulk_update_pitch_log_stuff_plus(updates jsonb)` RPC

**Two important script-internal mappings:**
- `POP_TYPE_KEY["4-Seam Fastball"] = "4S FB"` — our reclassification calls it `"4-Seam Fastball"` but the engine and pop constants use `"4S FB"`. Without this map, ~894K fastballs got dropped.
- `fb_ch_velo_diff = null` for all changeups (deferred — see "Deferred refinements" below).

Script: `scripts/compute_pitch_log_stuff_plus.ts` (npm: `compute-pitch-log-stuff-plus`)

Required Postgres function on staging:
```sql
CREATE OR REPLACE FUNCTION public.bulk_update_pitch_log_stuff_plus(updates jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE affected int;
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

### Phase 3 — Layer 2/3 aggregation tables ✅ COMPLETE (`all` dimension)

Three tables built and populated for `dimension_key = 'all'`:

**`pitch_log_pitcher_totals`** — 5,415 rows
- Pitch volume, swings/takes, tracking presence, zone/chase/whiff counts, BF, K, BB, HBP, Stuff+ sum + denom

**`pitch_log_pitcher_by_pitch_type`** — 30K+ rows (5,415 pitchers × pitch types they threw)
- Per-pitch-type pitches/swings/whiffs/in_zone/chases/called_strikes/data_pitches + sums of velo/IVB/HB/extension/spin/rel_height/rel_side

**`pitch_log_hitter_totals`** — 6,096 rows
- PA, AB, hits (1B/2B/3B/HR), K, BB, HBP, Sac
- Pitch volume + plate discipline
- Batted-ball type counts (GB/LD/FB/PU)
- Barrels, hard hit, LA 10-30
- EV sum + count of batted balls with EV (EV90 deliberately NOT stored — use Pitching Master if needed)

**Architectural decision (Trevor):** Store COUNTS, derive rates at display. Filter dimensions become NEW ROWS per player, not new columns. Lets us compose filters by summing rows.

**Data reliability:** Just store `total_data_pitches` and `total_pitches` per row. Display computes `data_reliability_pct = total_data_pitches / total_pitches`. Risk assessment system then tiers it externally — no tier column in these tables.

Schema migration: `supabase/migrations/20260620120000_pitch_log_aggregations.sql`

### Phase 4 — Filter dimensions ✅ COMPLETE

**Final dimension set (after vs_95plus rework mid-session):** 8 entries including `all`, with two dimensions that apply to only one side. See the "Read first" section at the top of this doc for the final row counts per dimension.

| Dimension | Pitcher filter | Hitter filter |
|---|---|---|
| `all` | `true` (always-true) | `true` |
| `vs_lhp` | `batter_hand = 'L'` | `pitcher_hand = 'L'` |
| `vs_rhp` | `batter_hand = 'R'` | `pitcher_hand = 'R'` |
| `vs_92plus` | — (n/a for pitchers) | `release_velocity >= 92` |
| `vs_fastball` | `pitch_type_reclassified IN ('4-Seam Fastball','Sinker','Cutter')` | same |
| `vs_breaking_ball` | `pitch_type_reclassified IN ('Slider','Curveball','Gyro Slider','Sweeper')` | same |
| `vs_offspeed` | `pitch_type_reclassified IN ('Change-up','Splitter')` | same |
| `vs_top_hitters` | `batter_id IN (SELECT source_player_id FROM "Hitter Master" WHERE "Season"=2026 AND pa>=100 AND overall_power_rating>=120.8)` | — (n/a for hitters) |

**Why the rework:** `vs_95plus` had a sample problem (only 858 of 5,415 pitchers ever threw a 95+ pitch). Trevor's call: drop it, lower the threshold for hitters (92 = better sample), and add the more meaningful `vs_top_hitters` filter for pitchers (how does this arm look against elite bats).

**`vs_top_hitters` cutoff derivation:** p75 of `overall_power_rating` among qualified hitters (`pa >= 100`) on staging = 120.8. The 978 hitters at/above this cutoff form the "top hitters" pool. The threshold is a hard-coded constant in the script — re-derive on prod before running (the runbook flags this).

**Script:** [`scripts/aggregate_pitch_log_dimensions.ts`](../scripts/aggregate_pitch_log_dimensions.ts) (npm: `aggregate-pitch-log-dimensions`)

**Consolidated 2026-06-22 PM:** Phase 3's `all` dimension is now in the script (always-true predicates). One run covers Phase 3 + Phase 4 — 19 INSERT...SELECTs in ~10-12 min. Old Phase 3 paste-the-three-INSERTs step is obsolete.

Each statement runs via the `public.exec_sql(sql text)` RPC. Auto-commit (no BEGIN/COMMIT) so gateway timeouts don't roll back. Idempotent via ON CONFLICT DO UPDATE.

The `exec_sql` and `bulk_update_pitch_log_stuff_plus` functions are now in a proper migration: [`supabase/migrations/20260620140000_pitch_log_helper_functions.sql`](../supabase/migrations/20260620140000_pitch_log_helper_functions.sql) — paste-and-go on prod, no separate function-creation step needed.

### Phase 5 — Savant page integration 📋 NOT BUILT

**Key reframe from earlier sessions:** The pitch log data goes on the **Savant pages** (`src/savant/pages/PitcherPage.tsx`, `HitterPage.tsx`) as a NEW filter-driven section — NOT on the main `PlayerProfile.tsx` / `PitcherProfile.tsx`.

This is a critical simplification:
- **No risk to existing Profile displays** (the `pitch_usage_audit_pending` concern becomes largely moot)
- **Savant page already has the eval/filter UI shape** — we feed it new data, not redesign components
- **Coaches navigate to Savant when they want this detail** — Profile stays for headline projections, Savant for deep dive
- Existing Savant page reads from Pitching Master / Hitter Master; the new pitch log tables sit ALONGSIDE as a new section. Pitching Master remains the source for things pitch log can't surface (career-spanning data, conference-blended stats, etc.)

Phase 5 work:
1. New "Pitch Log Filters" section on Savant `PitcherPage` + `HitterPage`
2. Filter dropdown sets `dimension_key`
3. Reads aggregation rows by `(player_id, season, dimension_key)`
4. Derives rates at display time (whiff% = whiffs/swings, pitch_usage_pct = pitches / totals.total_pitches, etc.)
5. Per-pitch-type breakdown shows pitch usage + per-type Stuff+ + per-type whiff

### Phase 6 — Drive auto-ingestion 📋 NOT BUILT

Replace manual CSV-to-folder workflow with automatic Drive pull triggered per outing. Only after Phase 5 is shipping reliably.

---

## Locked decisions in this build

| Decision | Rationale |
|---|---|
| Movement-based reclassification wins over scout-tradition labels | Pitchers and TruMedia mislabel themselves. Physics is the only objective signal. |
| Elliott's 18% cutter is correct | Movement profile (6.2 IVB, 3.6 HB at 83mph) is textbook cutter; the "slider" label is calibrated to mislabeled TM tags. |
| Stuff+ per-pitch scores clamped to [40, 160] before recenter | 3% of per-pitch scores produce math-overflow extreme values (16K+). Clamp keeps bucket means at 100. |
| Coach UI override is long-term fix for label disagreements | Keep data layer truthful, give UI escape hatch. Override triggers Stuff+ recompute on affected pitches. Deferred. |
| Recenter Stuff+ per (pitch_type × hand) bucket, not per pitcher | Locks each bucket at mean = 100 across the population. Matches existing Savant aggregate pipeline. |
| Per-pitch `fb_ch_velo_diff` zeroed for changeups | Per-pitcher fastball velo precompute exceeded statement timeout. Other 8 pitch types unaffected. Deferred. |
| Multi-week rollup CSVs deleted from local (except May22-June16) | TruMedia 100K cap = truncated subsets that smaller files already covered. May22-June16 = only postseason source. |
| Phase 5 destination is Savant pages, NOT Profile | Risk-free new surface vs swap-with-comparison. Pitch usage audit memory becomes largely moot. |
| Store counts in aggregation tables, derive rates at display | Composable across filter dimensions. Sum-then-divide always works. |
| EV90 deliberately not aggregated | Trevor says unnecessary for display. If ever needed, raw EVs are in pitch_log. |
| Data reliability stored as raw counts (`total_data_pitches`, `total_pitches`) | Display divides; risk assessment system reads the pct and tiers externally. No tier column. |

---

## Deferred refinements (logged, not blocking)

### FA → Cutter movement check (Volchko case)
Some pitchers self-tag a true cutter as a fastball (Joey Volchko example). Current reclassification only applies movement logic to raw SL/CU/FC. To catch FA-tagged cutters, add a movement check for FA:
```sql
WHEN pitch_type = 'FA' THEN
  CASE
    WHEN ivb IS NOT NULL AND hb IS NOT NULL
         AND ivb < 12 AND ABS(hb) < 6
      THEN 'Cutter'
    ELSE '4-Seam Fastball'
  END
```
Rationale: real 4S FBs have IVB 14-22 with HB 6-12. Cutters have IVB 4-10 with `abs(HB) < 5`. Non-overlapping clusters.

### Coach pitch-type override UI
Per-pitcher per-pitch-type override (e.g., "Elliott's high-IVB pitches are actually Sliders, not Cutters"). When override applied, must trigger Stuff+ recompute for affected pitches.

### Per-pitcher fastball velo precompute (for changeup `fb_ch_velo_diff`)
Current changeup Stuff+ loses per-pitcher velo-gap accuracy. Worth precomputing via server-side SQL view or RPC and joining into scoring pipeline.

### Additional filter dimensions (Phase 4b)
- `home` / `away` (boolean column in pitch_log)
- `weekday` / `weekend` (`EXTRACT(DOW FROM date)`)
- `close_game` (`abs(total_runs - opponent_runs) <= 2`)
- `high_lev` (within 3 runs in inning 7+; needs 'Top 7' string parsing)
- `stuff_100plus` / `stuff_105plus` (pitcher-only — slice by their own Stuff+ tier)

---

## Files inventory

```
docs/
  PITCH_LOG_BUILD.md                              # canonical build spec (read first)
  PITCH_LOG_HANDOFF_2026_06_19.md                 # earlier session handoff
  PITCH_LOG_HANDOFF_2026_06_22.md                 # this file
  PITCH_LOG_PROD_RUNBOOK.md                       # ← NEW: paste-and-go prod transition (6 steps)

supabase/migrations/
  20260619120000_pitch_log_base_table.sql         # Phase 1 schema (pitch_result NOT NULL drift fixed)
  20260619140000_pitch_log_computed_columns.sql   # Phase 2a schema additions
  20260620120000_pitch_log_aggregations.sql       # Phase 3 aggregation tables
  20260620140000_pitch_log_helper_functions.sql   # ← NEW: exec_sql + bulk_update_pitch_log_stuff_plus
                                                  #   (security-hardened — REVOKEd from anon/authenticated)

scripts/
  ingest_pitch_log.ts                             # Phase 1 ingest (CSV → pitch_log)
  derive_pitch_log_flags.ts                       # Phase 2b (booleans + category)
  reclassify_pitch_log.ts                         # Phase 2c (pitch_type_reclassified)
  compute_pitch_log_stuff_plus.ts                 # Phase 2d (stuff_plus per pitch)
  aggregate_pitch_log_dimensions.ts               # Phase 3+4 (all + filter dimensions, consolidated)

package.json scripts:
  ingest-pitch-log[:prod]
  derive-pitch-log-flags[:prod]
  reclassify-pitch-log[:prod]
  compute-pitch-log-stuff-plus[:prod]
  aggregate-pitch-log-dimensions[:prod]
```

### Postgres functions required (now in migrations)

Both helper functions are defined in [`20260620140000_pitch_log_helper_functions.sql`](../supabase/migrations/20260620140000_pitch_log_helper_functions.sql) — no separate paste-step needed during prod transition. The migration also includes proper REVOKEs against `anon` and `authenticated` so PostgREST cannot expose `exec_sql` externally (only service_role can call it).

| Function | Purpose | Called by |
|---|---|---|
| `exec_sql(sql text)` | Run arbitrary SQL with 15-min statement timeout (`SET statement_timeout = '900s'`) | `aggregate_pitch_log_dimensions.ts` |
| `bulk_update_pitch_log_stuff_plus(updates jsonb)` | Bulk UPDATE Stuff+ from JSON payload | `compute_pitch_log_stuff_plus.ts` |

---

## Related memory files

- `project_pitch_log_status_2026_06_19.md` — earlier mid-build snapshot
- `project_pitch_usage_audit_pending.md` — historical concern; mostly moot now that Phase 5 = new Savant surface
- `project_tomorrow_priorities_2026_06_18.md` — the original priority that kicked off this work
- `docs/PITCH_LOG_BUILD.md` — full spec with locked rulings, schema, layer plan

---

## Resume checklist for next session

1. **Pre-flight on staging:** verify `exec_sql` and `bulk_update_pitch_log_stuff_plus` both exist:
   ```sql
   SELECT proname FROM pg_proc WHERE proname IN ('exec_sql', 'bulk_update_pitch_log_stuff_plus');
   ```
2. **If exec_sql missing:** paste the function definition (above) on staging.
3. **Verify Phase 3 'all' dimension is still populated:**
   ```sql
   SELECT 'pitcher_totals' AS tbl, COUNT(*) FROM pitch_log_pitcher_totals WHERE dimension_key = 'all'
   UNION ALL SELECT 'pitcher_by_pitch_type', COUNT(*) FROM pitch_log_pitcher_by_pitch_type WHERE dimension_key = 'all'
   UNION ALL SELECT 'hitter_totals', COUNT(*) FROM pitch_log_hitter_totals WHERE dimension_key = 'all';
   ```
   Expected: 5,415 / 30K+ / 6,096.
4. **Run Phase 4 script:**
   ```bash
   cd ~/dev-main/diamond-predictor-66
   npm run aggregate-pitch-log-dimensions -- --apply
   ```
   Estimated 15-20 min. Each of 18 INSERT...SELECTs runs server-side and survives gateway timeouts.
5. **Verify Phase 4 result:**
   ```sql
   SELECT dimension_key, COUNT(*) AS rows
   FROM pitch_log_pitcher_totals GROUP BY dimension_key ORDER BY dimension_key;
   ```
   Expected: 7 rows (`all` + 6 vs_* dimensions).
6. **Spot-check** a known pitcher's filter rows (e.g., Hunter Elliott vs LHP vs RHP):
   ```sql
   SELECT dimension_key, total_pitches, total_swings, total_whiffs
   FROM pitch_log_pitcher_totals
   WHERE pitcher_id = (SELECT source_player_id FROM players WHERE first_name = 'Hunter' AND last_name = 'Elliott')
   ORDER BY dimension_key;
   ```
7. **Move to Phase 5:** Read `src/savant/pages/PitcherPage.tsx` to plan the new filter section UI. The aggregation table reads will look like:
   ```ts
   const { data } = await supabase.from('pitch_log_pitcher_totals')
     .select('*')
     .eq('pitcher_id', sourcePlayerId)
     .eq('season', 2026)
     .eq('dimension_key', selectedFilter);
   ```
   Then derive rates client-side.
