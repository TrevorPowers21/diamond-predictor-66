# Launch Prep — feature/juco-exploration → main

Captured 2026-05-18. Source of truth for the coordinated PROD launch.

PR: https://github.com/TrevorPowers21/diamond-predictor-66/pull/14

---

## 1. Schema delta (STAGING → PROD)

Both DBs have the same 36 tables. **Prod needs the following schema changes before the new code is deployed**, because the code references column names and tables that only exist on staging.

### 1a. Column RENAMES — revised after code-grep verification

| Table             | Old (prod)         | New (staging)         | Code reads it? | Required for launch? |
|-------------------|--------------------|------------------------|----------------|-----------------------|
| Hitter Master     | `ba_plus`          | `ba_power_rating`     | ✓ yes          | **YES — must rename**  |
| Hitter Master     | `obp_plus`         | `obp_power_rating`    | ✓ yes          | **YES — must rename**  |
| Hitter Master     | `iso_plus`         | `iso_power_rating`    | ✓ yes          | **YES — must rename**  |
| Hitter Master     | `overall_plus`     | `overall_power_rating`| ✓ yes          | **YES — must rename**  |
| Conference Stats  | `ba_plus`          | `ba_power_rating`     | ✗ no (uses `select *`) | optional — no code break either way |
| Conference Stats  | `obp_plus`         | `obp_power_rating`    | ✗ no           | optional |
| Conference Stats  | `iso_plus`         | `iso_power_rating`    | ✗ no           | optional |
| ncaa_averages     | `ba_plus`          | `ba_power_rating`     | ✓ yes — `select *` + downstream `row.ba_power_rating` access in PlayerProfile, Savant, conferenceScoutingAverages | **YES — must rename** |
| ncaa_averages     | `obp_plus`         | `obp_power_rating`    | ✓ yes | **YES — must rename** |
| ncaa_averages     | `iso_plus`         | `iso_power_rating`    | ✓ yes | **YES — must rename** |
| ncaa_averages     | `overall_plus`     | `overall_power_rating`| ✓ yes | **YES — must rename** |

**User mental model confirmation:** Conference Stats *should* have `ba_power_rating` (used to compute `hitter_talent_plus`). Even though no code references it by name today, renaming on prod is cleaner / future-proof. Staging also has a redundant `ba_plus`/`obp_plus`/`slg_plus`/`iso_plus` set at the END of Conference Stats — separate from the rename. We will NOT propagate those extra columns to prod (likely accidental).

**Code that DOES break on prod without the Hitter Master rename:**
- `src/lib/createPredictionsFromMaster.ts:71` — selects `ba_power_rating, obp_power_rating, iso_power_rating, overall_power_rating` from Hitter Master
- `src/lib/createPredictionsFromMaster.ts:127` — reads `(hitter as any).ba_power_rating`
- `src/lib/createPredictionsFromMaster.ts:317` — same
- `src/lib/computeAndStoreScores.ts:335,549` — writes/filters on `ba_power_rating`
- Savant Power Ratings card / Conference Scouting Runner / Career table all read `*.ba_power_rating` etc.

### 1b. New columns on staging (need to be added to prod)

| Table                        | New column         | Type                    | Notes |
|------------------------------|--------------------|-------------------------|-------|
| Hitter Master                | `division`         | `text NOT NULL DEFAULT 'D1'` | Required for D1/JUCO split everywhere |
| Hitter Master                | `ba_plus`          | `numeric`               | Brand new field (NOT a rename) |
| Hitter Master                | `obp_plus`         | `numeric`               | "" |
| Hitter Master                | `slg_plus`         | `numeric`               | "" |
| Hitter Master                | `iso_plus`         | `numeric`               | "" |
| Hitter Master                | `dob`              | `date`                  | Already migrated tonight ✓ |
| Hitter Master                | `class_year`       | `text`                  | Already migrated tonight ✓ |
| Pitching Master              | `division`         | `text NOT NULL DEFAULT 'D1'` | "" |
| Pitching Master              | `trackman_pitches` | `integer`               | JUCO data-reliability inputs |
| Pitching Master              | `k_pct`            | `numeric`               | "" |
| Pitching Master              | `bf`               | `integer`               | "" |
| Pitching Master              | `dob`              | `date`                  | Already migrated tonight ✓ |
| Pitching Master              | `class_year`       | `text`                  | Already migrated tonight ✓ |
| Teams Table                  | `division`         | `text NOT NULL DEFAULT 'D1'` | "" |
| Teams Table                  | `region`           | `text`                  | "" |
| Teams Table                  | `district`         | `text`                  | "" |
| players                      | `division`         | `text NOT NULL DEFAULT 'D1'` | "" |
| players                      | `data_status`      | `text` + check constraint `('complete','partial','no_data','outlier')` | "" |
| pitcher_stuff_plus_inputs    | `division`         | `text NOT NULL DEFAULT 'D1'` | "" |
| pitcher_stuff_plus_ncaa      | `division`         | `text NOT NULL DEFAULT 'D1'` | "" |

### 1c. New indexes on staging (need to be added to prod)

- `hitter_master_src_player_season_uniq` UNIQUE on `("source_player_id", "Season")` — **REQUIRED** for upsert idempotency in the data migration scripts
- `pitching_master_src_player_season_uniq` UNIQUE on `("source_player_id", "Season")` — **REQUIRED**
- `players_src_player_uniq` UNIQUE on `("source_player_id")` — **REQUIRED**
- `teams_table_src_season_uniq` UNIQUE on `("source_id", "Season")` — **REQUIRED**
- `idx_hitter_master_division` on `(division)`
- `idx_pitching_master_division` on `(division)`
- `idx_players_division` on `(division)`
- `idx_pitcher_stuff_plus_inputs_division` on `(division)`
- `idx_pitcher_stuff_plus_ncaa_division` on `(division)`
- `idx_teams_table_district` on `(district)`
- `idx_teams_table_region` on `(region)`

---

## 2. Data delta (STAGING vs PROD)

| Table                       | STAGING    | PROD       | Notes |
|-----------------------------|-----------:|-----------:|-------|
| Teams Table — total         | 773        | 616        | +157 on staging = JUCO teams |
| Teams Table — JUCO          | 157        | 0          | Migrate all 157 |
| Conference Stats — total    | 160        | 150        | +10 on staging = NJCAA D1 districts |
| Conference Stats — JUCO     | 10         | 0          | **Migrate WITH original UUIDs preserved** — hardcoded in `JUCO_DISTRICT_CONFERENCE_ID` |
| players — total             | 15,664     | 26,230     | Prod has 10,566 MORE (historical seasons) — DO NOT overwrite |
| players — JUCO              | 5,265      | 0          | Migrate JUCO subset only |
| Hitter Master — total       | 8,307      | 27,113     | Prod has multi-season; staging is 2026-only |
| Hitter Master — JUCO        | 2,975      | 0          | Migrate JUCO subset only |
| Pitching Master — total     | 8,098      | 26,533     | "" |
| Pitching Master — JUCO      | 2,732      | 0          | "" |
| player_predictions — total  | 13,322     | 10,399     | Staging has +2,923; needs investigation (may be JUCO returner snapshots + recent regenerations) |
| pitcher_stuff_plus_inputs   | 30,442     | 94,247     | Prod has MORE; staging is per-season subset. Don't migrate. |
| pitcher_stuff_plus_ncaa     | 18         | 71         | Same pattern. Don't migrate. |

**Critical interpretation:** prod is the canonical multi-season store. Staging has only 2026 data plus the JUCO additions. **The migration is strictly additive for JUCO** — we never write back staging's narrower D1 subset over prod's full D1 history.

---

## 3. Migration ordering (single launch session)

Each step is idempotent. Each script prints a dry-run summary before requiring a typed-phrase confirmation.

### Step 1: Schema migrations on prod

Create one combined SQL file: `supabase/migrations/20260518150000_align_prod_with_staging.sql`. Contents:

- All `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` for the new columns
- All `ALTER TABLE … RENAME COLUMN …` for the renames (`ba_plus → ba_power_rating` etc.) — gated on `IF EXISTS` checks via `DO $$ … $$;` block
- All `CREATE UNIQUE INDEX IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`

Run: `supabase db query --linked --file supabase/migrations/20260518150000_align_prod_with_staging.sql`

### Step 2: JUCO foundation data migration on prod

Run `scripts/migrate-juco-foundation-to-prod.ts --apply`. Script already written; idempotent UPSERTs. Order:
1. Teams Table (JUCO) — UPSERT on `id`
2. Conference Stats (NJCAA D1) — UPSERT on `(conference_id, season)` so the 10 hardcoded UUIDs preserve exactly
3. players (JUCO) — UPSERT on `id`
4. Hitter Master (JUCO) — UPSERT on `(source_player_id, Season)`
5. Pitching Master (JUCO) — UPSERT on `(source_player_id, Season)`
6. player_predictions (JUCO players) — UPSERT on `id`

### Step 3: JUCO Presto pitchers (any beyond the 5,265 baseline)

Run `scripts/add-presto-missing-pitchers.ts --apply` (URL guard already updated to accept prod). 51 likely added on staging via this same path; expect 0 net new on prod after step 2 if prod is now in sync with staging.

### Step 4: JUCO DOB / class_year (already in HM/PM after step 2)

DOB + class_year landed via the JUCO HM/PM rows in step 2. If any later CSV updates exist, run `scripts/import-juco-class-dob.ts --apply` (URL guard already updated). Expect 0 net new.

### Step 5: Spot-check prod

```bash
set -a && source .env.production.local && set +a
npx tsx -e '
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  // Yearsley should resolve end-to-end
  const { data: p } = await sb.from("players").select("id, division").eq("source_player_id", "1585883434").single();
  console.log("Yearsley on prod:", p);
  const { data: cs } = await (sb as any).from("Conference Stats").select(`"conference abbreviation", conference_id`).eq("conference_id", "95f8d637-dfc3-4dca-a6c4-dd23ec925fca").single();
  console.log("Midwest district on prod:", cs);
  // Confirm 2026 D1 PA still loads (the regression we were worried about)
  const { count } = await (sb as any).from("Hitter Master").select("*", { count: "exact", head: true }).eq("Season", 2026).eq("division", "D1");
  console.log("PROD 2026 D1 Hitter Master count:", count);
})();
'
```

Expected: Yearsley present + JUCO division, Midwest district resolves by exact UUID, prod 2026 D1 HM count unchanged from pre-migration.

### Step 6: Merge PR + verify Vercel deploy

```bash
gh pr merge 14 --merge
```

Watch Vercel dashboard for green deploy.

### Step 7: Smoke test prod via UI

- TransferPortal: JUCO toggle, pick Yearsley + Georgia → `.317/.427/.600`
- JUCO subtab on Player Dashboard: leaderboards populate
- TB target board: add JUCO player, projection lands
- TB depth chart: class colors match legend, no all-bench default
- Program Analytics: tier labels read "Contributor" for ~1.8 pWAR SPs
- What's New popup fires once + dismisses

### Step 8: Relink Supabase CLI back to staging

```bash
supabase link --project-ref slrxowawbijbjrkozqlj
```

---

## 4. Rollback

- **Schema renames**: re-run inverse `ALTER TABLE … RENAME COLUMN` (irreversible without a separate revert script — write one alongside the forward migration).
- **New columns**: drop columns (harmless), or leave them in place since they're nullable.
- **Data inserts**: scoped to `division = 'NJCAA_D1'` so `DELETE` filtered by that division reverts cleanly.
- **Code**: revert the merge commit + redeploy.

---

## 5. Open risks worth re-checking before tonight goes live

1. **player_predictions delta of +2,923 on staging**: confirm those are JUCO-only returner snapshots. If any D1 prediction rows exist only on staging (e.g., test data, recent re-runs), migrating wholesale risks overwriting prod returner rows the live pipeline already produced.
2. **`pitcher_stuff_plus_inputs / ncaa`** scope: confirm these are NOT in the JUCO migration path. They have way more rows on prod (historical seasons). Touching them risks data loss.
3. **Column rename idempotency**: the migration must succeed whether the column has been renamed or not (DO $$ block with `IF EXISTS` lookup against `information_schema.columns`).
4. **Vercel build cache**: post-merge, the first prod page load may hit a stale build cache. Hard-refresh once before signing off.

---

## 6. What's NOT in this launch

- 2026 WAR snapshot refresh (waits for season wrap)
- D1 DOB / class_year backfill (waits for 2026 final stat upload)
- Risk card density redesign (Stitch options pending pick)
- Color audit
- Savant full grade grid expansion
