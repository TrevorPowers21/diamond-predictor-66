# Launch Prep — feature/juco-exploration → main → PROD

**Captured 2026-05-18. Source of truth for the coordinated PROD launch.**

PR: https://github.com/TrevorPowers21/diamond-predictor-66/pull/14

This doc replaces all earlier launch notes. Findings here were verified against actual schema dumps (`tmp/audit/schema-staging.sql` / `schema-prod.sql`) and live row-count + collision audits run against both DBs.

---

## 1. Schema delta

Both DBs have the same 36 tables, identical RLS / triggers / FKs / sequences. The only structural deltas are columns + indexes.

### 1a. Column RENAMES — verified by code grep

These renames correct a misnomer: prod's `ba_plus` columns actually hold a derived **power rating** (scouting-input-blended talent score), not an environmental rate. The rename frees the `*_plus` name for the actual environmental rate columns added in §1b.

| Table | Old (prod) | New (staging) | Code-required? | Reason |
|---|---|---|---|---|
| **Hitter Master** | `ba_plus` | `ba_power_rating` | **YES** | `createPredictionsFromMaster.ts:71,127,317` reads; `computeAndStoreScores.ts:335,549` writes/filters; `PlayerProfile.tsx:664-667` reads; Savant components display |
| **Hitter Master** | `obp_plus` | `obp_power_rating` | YES | same |
| **Hitter Master** | `iso_plus` | `iso_power_rating` | YES | same |
| **Hitter Master** | `overall_plus` | `overall_power_rating` | YES | same |
| **Conference Stats** | `ba_plus` | `ba_power_rating` | **YES** | `conferenceScoutingAverages.ts:471` writes this during Admin → Compute Scores. Feeds `hitter_talent_plus` calc. |
| **Conference Stats** | `obp_plus` | `obp_power_rating` | YES | same |
| **Conference Stats** | `iso_plus` | `iso_power_rating` | YES | same |

**Two-concept distinction (kept separately on staging, both intentional):**
- `ba_power_rating` (and obp/iso/overall): derived talent score from blended scouting inputs. Used in `hitter_talent_plus` calc.
- `ba_plus` (and obp/slg/iso): environmental rate, `(actual_rate / NCAA_avg) × 100`. Added as nullable in §1b. Currently unpopulated; future workstream populates.

**Not on the rename list (previously suspected):**
- `ncaa_averages`: confirmed identical on both DBs. Has no `ba_plus` / `ba_power_rating` columns at all. Code that references `row.ba_power_rating` on ncaa-shaped objects is reading from Hitter Master / Conference Stats, not ncaa_averages.

### 1b. New columns on staging — to be ADDED to prod

| Table | Column | Type / default | Notes |
|---|---|---|---|
| Hitter Master | `division` | `text NOT NULL DEFAULT 'D1'` | Required for D1/JUCO split everywhere |
| Conference Stats | `ba_plus`, `obp_plus`, `slg_plus`, `iso_plus` | `numeric` (nullable) | **Environmental rates** — `(conf_rate / ncaa_avg) × 100`. Different concept from `ba_power_rating` (derived talent score used in `hitter_talent_plus`). Both columns are intentional. **Must run AFTER the rename above (renames free up the `ba_plus`/etc. names; then these ADDs reuse them for the env-rate concept).** Audit confirmed: staging Hitter Master does NOT have an env-rate column set — only Conference Stats does. |
| Hitter Master | `dob`, `class_year` | `date`, `text` | **ALREADY MIGRATED on prod tonight** ✓ |
| Pitching Master | `division` | `text NOT NULL DEFAULT 'D1'` | Required |
| Pitching Master | `trackman_pitches`, `k_pct`, `bf` | `integer`/`numeric`/`integer` | JUCO data-reliability inputs; code reads via `usePitchingSeedData.ts` |
| Pitching Master | `dob`, `class_year` | `date`, `text` | **ALREADY MIGRATED on prod tonight** ✓ |
| Teams Table | `division` | `text NOT NULL DEFAULT 'D1'` | Required |
| Teams Table | `region`, `district` | `text`, `text` | Future taxonomy; not currently in critical-path code |
| players | `division` | `text NOT NULL DEFAULT 'D1'` | Required |
| players | `data_status` | `text` + CHECK (`'complete'`,`'partial'`,`'no_data'`,`'outlier'`) | New status field; nullable |
| pitcher_stuff_plus_inputs | `division` | `text NOT NULL DEFAULT 'D1'` | Required (D1/JUCO Stuff+ split) |
| pitcher_stuff_plus_ncaa | `division` | `text NOT NULL DEFAULT 'D1'` | Required |

### 1c. New indexes on staging — to be ADDED to prod

**UNIQUE constraints (required for upsert idempotency in the data scripts):**
- `hitter_master_src_player_season_uniq` UNIQUE on `("source_player_id", "Season")`
- `pitching_master_src_player_season_uniq` UNIQUE on `("source_player_id", "Season")`
- `players_src_player_uniq` UNIQUE on `("source_player_id")`
- `teams_table_src_season_uniq` UNIQUE on `("source_id", "Season")`

**Verified safe to create:** prod has zero duplicate `(source_player_id, Season)` rows on either master table, zero duplicate `source_player_id` on players, zero null `source_player_id`. All four constraints will create cleanly.

**Lookup indexes (optional but match staging exactly):**
- `idx_hitter_master_division`, `idx_pitching_master_division`, `idx_players_division`
- `idx_pitcher_stuff_plus_inputs_division`, `idx_pitcher_stuff_plus_ncaa_division`
- `idx_teams_table_district`, `idx_teams_table_region`

---

## 2. Data delta — verified

| Table | STAGING | PROD | Notes |
|---|---:|---:|---|
| Teams Table — total | 773 | 616 | +157 staging = JUCO teams |
| Teams Table — JUCO | 157 | 0 | Migrate all 157. Zero source_id collisions on prod. |
| Conference Stats — total | 160 | 150 | +10 staging = NJCAA D1 districts |
| Conference Stats — JUCO | 10 | 0 | Migrate all 10. **`conference_id` MUST be preserved** — hardcoded in `JUCO_DISTRICT_CONFERENCE_ID` |
| players — total | 15,664 | 26,230 | Prod has 10,566 MORE (multi-season history). **Do NOT overwrite D1 history.** |
| players — JUCO | 5,265 | 0 | But **124 of the 5,265 already exist as STUB rows on prod** (name + source_player_id populated; team/conf null). These get **enriched in-place** by the upsert (prod UUID preserved). Net new = 5,141. |
| Hitter Master — total | 8,307 | 27,113 | Prod has multi-season; staging is 2026-only. |
| Hitter Master — JUCO | 2,975 | 0 | Migrate all 2,975. Zero (source_player_id, Season) collisions on prod. |
| Pitching Master — total | 8,098 | 26,533 | Same multi-season pattern |
| Pitching Master — JUCO | 2,732 | 0 | Migrate all 2,732. Zero collisions. |
| player_predictions — total | 13,322 | 10,399 | Staging delta = +2,923. **Verified: all 2,923 are JUCO** (count of predictions for JUCO players on staging = exactly 2,923). Safe to migrate. |
| pitcher_stuff_plus_inputs | 30,442 | 94,247 | Prod has MORE (historical seasons). **Do NOT touch.** |
| pitcher_stuff_plus_ncaa | 18 | 71 | Same pattern. **Do NOT touch.** |

**The 124 stub-row collisions** (verified by sampling):
- All 124 match by `source_player_id` AND by name
- All 124 prod rows have `team = NULL` and `conference = NULL` — they're placeholder entries from upstream ingest
- All 124 have prod-assigned UUIDs different from staging UUIDs
- The migration must update them in place using `source_player_id` as the conflict target (NOT `id`), preserving prod UUIDs so any FK references (target_board, etc.) survive

---

## 3. Migration ordering — single launch session

Every step is idempotent.

### Step 1 — Schema migration on PROD

File to create: `supabase/migrations/20260518150000_align_prod_with_staging.sql`. Single SQL file with these sections (in this order):

1. **Renames** in `DO $$ … $$;` blocks gated on `information_schema.columns` lookup so re-running is a no-op:
   - Hitter Master: `ba_plus → ba_power_rating` (×4 cols)
   - Conference Stats: `ba_plus → ba_power_rating` (×3 cols)
2. **`ALTER TABLE … ADD COLUMN IF NOT EXISTS`** for all new columns in §1b (skip `dob`/`class_year` — already migrated tonight)
3. **CHECK constraint** on `players.data_status` (add separately, guard with `IF NOT EXISTS` via DO block)
4. **`CREATE UNIQUE INDEX IF NOT EXISTS`** for the four uniques in §1c
5. **`CREATE INDEX IF NOT EXISTS`** for the seven lookup indexes

Run: `supabase db query --linked --file supabase/migrations/20260518150000_align_prod_with_staging.sql`

Verify post-run: a smoke query for column existence on each affected table.

### Step 2 — JUCO foundation data migration on PROD

Update `scripts/migrate-juco-foundation-to-prod.ts` with the refined logic:

1. **Teams Table** (157 rows) — UPSERT on `id` (no collisions)
2. **Conference Stats** (10 rows) — UPSERT on `(conference_id, season)` so UUIDs preserve exactly
3. **players** (5,265 rows) — UPSERT on **`source_player_id`** (not `id`). For 124 collisions: prod UUID preserved, other fields enriched. For 5,141 new: inserted with staging UUID.
4. **Build sid→prod_id map** from the post-upsert state of players (fetch all JUCO players from prod after step 3)
5. **Hitter Master** (2,975 rows) — UPSERT on `(source_player_id, Season)`. No id translation needed (this table doesn't reference player.id).
6. **Pitching Master** (2,732 rows) — same as HM
7. **player_predictions** (2,923 rows) — for each staging row:
   - Look up `source_player_id` of its `player_id` from staging
   - Translate to prod's `player_id` via the sid→prod_id map
   - STRIP the staging `id` field (let prod assign via gen_random_uuid default, OR keep staging id for new players)
   - UPSERT on `(player_id, model_type, variant, season)` — the existing unique constraint

Run: `npx tsx scripts/migrate-juco-foundation-to-prod.ts --apply`

### Step 3 — JUCO Presto pitchers (any beyond the 5,265 baseline)

After step 2, prod has the same 5,265 JUCO players as staging. If the Presto CSV identified any pitchers not in that 5,265 set, they're inserted by:
```
npx tsx scripts/add-presto-missing-pitchers.ts "/Users/danielleogonowski/RSTR IQ Data/juco-exploration/presto-pitcher-none.csv" --apply
```
URL guard already accepts prod. Expect ~0 new on prod after step 2 (since staging already includes them).

### Step 4 — JUCO DOB / class_year (CSV)

DOB + class_year landed on prod in step 2 via the Hitter Master / Pitching Master rows. Re-running the CSV import is idempotent:
```
npx tsx scripts/import-juco-class-dob.ts "/Users/danielleogonowski/RSTR IQ Data/juco-exploration/2026 JUCO Class Year:DOB 051826.csv" --apply
```

### Step 5 — Spot-check prod (SQL)

Run a verification script that asserts:
- Yearsley resolves on prod with `division='NJCAA_D1'`
- Conference Stats has all 10 JUCO districts under their staging UUIDs (esp. `95f8d637-…` for Midwest)
- Prod 2026 D1 Hitter Master count is **unchanged** from pre-migration baseline (no D1 data was touched)
- 0 dupes still on Hitter Master / Pitching Master / players
- Yearsley's prediction reads cleanly: `from_avg = 0.464`, `division='NJCAA_D1'` on player

### Step 6 — Merge PR + Vercel deploy

```bash
gh pr merge 14 --merge
```
Watch the Vercel dashboard.

### Step 7 — Smoke test prod via UI

- Transfer Portal simulator: JUCO toggle, Yearsley → Georgia → `.317/.427/.600`
- Player Dashboard JUCO subtab: leaderboards populate, district filter works
- TB target board: add a JUCO player from JUCO subtab → projection lands in TB
- TB depth chart: class colors match legend, NO all-bench default for any team
- Program Analytics: 1.8 pWAR SP reads "Contributor"
- WhatsNewModal: fires once, dismisses, doesn't re-fire on refresh
- Kenny Ishikawa shows on both hitter + pitcher sides (his prod `is_twp=true` is already correct)

### Step 8 — Relink CLI back to staging

```bash
supabase link --project-ref slrxowawbijbjrkozqlj
```

---

## 4. Rollback

- **Schema renames:** inverse `ALTER TABLE … RENAME COLUMN`. The migration SQL should include an inverse companion script side-by-side for fast rollback.
- **New columns:** nullable additions; safe to leave in place or `DROP COLUMN`.
- **JUCO data inserts:** scoped to `division='NJCAA_D1'`. Reversible by `DELETE … WHERE division='NJCAA_D1'` (cascade rules permitting; FK behavior should be checked).
- **The 124 enriched stub rows:** before the migration, snapshot their current state (e.g., `SELECT * INTO tmp.players_stub_backup FROM players WHERE source_player_id IN (...)`). Rollback restores from snapshot.
- **Code:** revert merge commit + redeploy.

---

## 5. Resolved open risks

| Risk | Status |
|---|---|
| `player_predictions` +2,923 delta might include D1 drift | **Resolved**: exactly equal to JUCO prediction count. Safe to migrate. |
| `pitcher_stuff_plus_inputs / ncaa` in JUCO path | **Resolved**: NOT in the migration script. Prod has more rows; we don't touch. |
| Column rename idempotency | Will be handled by `DO $$ IF EXISTS $$` blocks in the SQL |
| Vercel build cache | Hard-refresh once after deploy |
| 124 collision JUCO stub rows on prod | **Resolved**: upsert on `source_player_id` enriches them in place, preserves prod UUIDs |
| Existing prod dupes blocking unique indexes | **Resolved**: zero dupes on HM/PM/players |

## 6. Remaining open risks for Phase 2

1. **player_predictions `id` collision** — staging predictions have UUIDs. If by chance any UUID coincides with an existing prod prediction's UUID (cosmic-ray probability), the insert would conflict on PK. Mitigation: omit `id` field from upsert payload, let prod generate fresh UUIDs. The natural unique constraint `(player_id, model_type, variant, season)` is what guarantees no duplicate semantic rows.
2. **Vercel env vars** — confirm prod Vercel uses `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` pointing at `trbvxuoliwrfowibatkm`. Check Vercel dashboard before merging.
3. **Customer team_id references on the 124 stub rows** — if any of the 124 prod stubs are on a customer team's target_board or build, upsert-enriching them is fine (we preserve their id), and the new JUCO division flag adds context without breaking anything. Verify by counting target_board rows referencing those 124 ids before merging.

---

## 7. NOT in this launch

- 2026 WAR snapshot refresh (waits for season wrap)
- D1 DOB / class_year backfill (waits for 2026 final stat upload)
- Risk card density redesign (Stitch options pending pick)
- Color audit
- Savant full grade grid expansion
- `pitcher_stuff_plus_inputs / ncaa` JUCO subset (defer; prod has different season scope)

---

## 8. Files involved

| Asset | Status |
|---|---|
| `LAUNCH_PREP.md` | This doc — source of truth |
| `supabase/migrations/20260518120000_add_dob_class_year.sql` | Shipped to prod ✓ |
| `supabase/migrations/20260518150000_align_prod_with_staging.sql` | **TO WRITE** (Phase 2 first task) |
| `scripts/migrate-juco-foundation-to-prod.ts` | Exists; **needs rewrite** for source_player_id upsert + sid→prod_id translation |
| `scripts/add-presto-missing-pitchers.ts` | URL guard accepts prod ✓ |
| `scripts/import-juco-class-dob.ts` | URL guard accepts prod ✓ |
| `tmp/audit/schema-{staging,prod}.sql` | Diff source (gitignored) |
| `tmp/audit-*.ts` | Audit verification scripts (gitignored) |
