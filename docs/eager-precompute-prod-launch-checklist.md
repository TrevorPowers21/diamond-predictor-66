# Eager Pre-Compute — Prod Launch Checklist

Append-only runbook. Every prod-bound action gets a checkbox + date + result. Pair with `docs/eager-precompute-session-log.md` (chronological audit).

Goal: zero-surprise launch. Every step here has been validated on staging first.

---

## Section A — Database state (PROD)

| # | Item | Status | Applied | Verified |
|---|---|---|---|---|
| A1 | Migration `20260520200000_eager_transfer_precompute_schema.sql` (column + override table + RLS) | ✅ | 2026-05-20 | yes |
| A2 | Migration `20260520210000_player_predictions_unique_with_customer_team.sql` (widened UNIQUE constraint) | ✅ | 2026-05-20 | yes |
| A3 | Independent conference SQL fix (NCAA averages for 1-team conferences) | ✅ | 2026-05-21 by Trevor | pending |
| A3b | Conference Stats Independent pitching rates (mean ERA/FIP/WHIP/K9/BB9/HR9 → env+ = 100) | ⏳ | staging only | pending |
| A3c | Park Factors corruption fix for Indiana + Hawaii (rows had malformed values from import bug, recomputed from source CSVs) | ✅ | 2026-05-21 prod by Trevor | yes |
| A3d | D1 Conference Stats `Overall_Power_Rating` refresh (PA-weighted from per-hitter OPR, ID-based skip Independent) | ⏳ | staging only | pending |
| A3e | Add `p_war` + `o_war` + `market_value` + `projected_ip` + `projected_pa` columns to `player_predictions` (stored derived values) | ⏳ | staging only | pending |
| A4 | `precompute_jobs` queue table | ⏳ | not yet | |
| A5 | DB trigger: `AFTER INSERT ON customer_teams` → enqueue | ⏳ | not yet | |
| A6 | Optional: trigger on stats ingest (debounced) | ⏳ | future | |
| A7 | Optional: trigger on equation_weights / overrides change | ⏳ | future | |

**Verification SQL (run on prod after each migration):**
```sql
-- A1 verify
SELECT column_name FROM information_schema.columns
WHERE table_name='player_predictions' AND column_name='customer_team_id';
SELECT count(*) FROM customer_team_equation_overrides;

-- A2 verify
SELECT conname FROM pg_constraint
WHERE conrelid='public.player_predictions'::regclass AND contype='u';
-- expect: player_predictions_player_team_model_variant_season_key

-- A3 verify
SELECT "conference abbreviation", "AVG", "OBP", "ISO", "Stuff_plus"
FROM "Conference Stats"
WHERE "conference abbreviation"='Independent' AND season=2026;
```

**Pitcher-side data fixes to apply on PROD (also during cutover) — ID-based for safety:**

PROD IDs (verified 2026-05-21):
- Independent conference_id: `f40c786c-7496-4d22-9629-9abb929ffcd3`
- Indiana Park Factors id: `2c1d8e00-7cb2-45a3-9ea4-6241c775234c`
- Hawaii Park Factors id: `076bf758-ee53-40a4-b654-f2e13d2cc6a3`

A3b — Independent conference pitching rates + OPR/WRC+ (so env+ and HTP both compute to 100):
```sql
UPDATE "Conference Stats"
SET "ERA"  = 6.191, "FIP"  = 4.407, "WHIP" = 1.635,
    "K9"   = 8.418, "BB9"  = 4.750, "HR9"  = 0.810,
    "Overall_Power_Rating" = 100,
    "WRC_plus" = 100
WHERE conference_id = 'f40c786c-7496-4d22-9629-9abb929ffcd3' AND season = 2026;
```

A3c — Park Factors corruption fix for Indiana + Hawaii:
```sql
-- Indiana (2c1d8e00)
UPDATE "Park Factors"
SET rg_factor=110.7, avg_factor=102.3, obp_factor=102.3, whip_factor=102.3,
    iso_factor=129.1, hr9_factor=129.1,
    lhb_avg_factor=101.3, lhb_obp_factor=105.9, lhb_iso_factor=124.7,
    rhb_avg_factor=103.1, rhb_obp_factor=99.0,  rhb_iso_factor=131.3
WHERE id = '2c1d8e00-7cb2-45a3-9ea4-6241c775234c';

-- Hawaii (076bf758)
UPDATE "Park Factors"
SET rg_factor=80.1, avg_factor=91.9, obp_factor=92.4, whip_factor=92.4,
    iso_factor=63.0, hr9_factor=63.0,
    lhb_avg_factor=92.4, lhb_obp_factor=93.9, lhb_iso_factor=64.6,
    rhb_avg_factor=90.3, rhb_obp_factor=90.9, rhb_iso_factor=60.8
WHERE id = '076bf758-ee53-40a4-b654-f2e13d2cc6a3';
```

Verify (run in two separate queries on prod since UNION ALL on mixed columns won't render cleanly):
```sql
SELECT "conference abbreviation" AS conf, "ERA", "FIP", "WHIP", "K9", "BB9", "HR9",
       "Overall_Power_Rating", "WRC_plus"
FROM "Conference Stats"
WHERE conference_id = 'f40c786c-7496-4d22-9629-9abb929ffcd3' AND season=2026;

SELECT team_name, rg_factor, avg_factor, obp_factor, iso_factor, hr9_factor
FROM "Park Factors"
WHERE id IN ('2c1d8e00-7cb2-45a3-9ea4-6241c775234c',
             '076bf758-ee53-40a4-b654-f2e13d2cc6a3');
```

A3d — D1 Conference Stats Overall_Power_Rating refresh (PA-weighted from per-hitter `overall_power_rating`).

Stored conference OPR was stale (last rolled up before final 2026 scouting upload). Bottom conferences were under-credited by 5-11 points, top conferences over-credited by 1-2 points. Refresh corrects HTP without touching weights — same Option 1 principle as the pitcher calibration. Independent skipped because it's manually locked to 100 (Oregon State consistency).

Apply on prod via npm script with prod env vars:

```bash
# In a shell with prod SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY:
SUPABASE_URL=https://trbvxuoliwrfowibatkm.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<PROD SERVICE ROLE KEY> \
npx tsx scripts/populate-conference-stats-env-plus.ts --apply
# Type "yes-populate-conf-stats" when prompted
```

Note: the script's staging URL guard at line 304 must be temporarily inverted for prod, or invoke `populateD1OverallPowerRating` directly. Safer: just run the equivalent SQL by hand. Below is the SQL equivalent (29 UPDATEs derived from staging's post-refresh values — but values will be slightly different on prod since per-hitter OPR may have drifted between staging + prod data uploads. Re-derive on prod):

```sql
-- Derive + apply in one statement using prod's current per-hitter data:
WITH live_opr AS (
  SELECT
    t.conference_id,
    round((sum(h.overall_power_rating * h.pa) / nullif(sum(h.pa), 0))::numeric, 1) AS new_opr
  FROM "Hitter Master" h
  JOIN "Teams Table" t ON t.id = h."TeamID"
  WHERE h."Season" = 2026
    AND h.division = 'D1'
    AND h.pa > 0
    AND h.overall_power_rating IS NOT NULL
    AND t.conference_id != 'f40c786c-7496-4d22-9629-9abb929ffcd3'  -- skip Independent
  GROUP BY t.conference_id
)
UPDATE "Conference Stats" cs
SET "Overall_Power_Rating" = lo.new_opr
FROM live_opr lo
WHERE cs.conference_id = lo.conference_id AND cs.season = 2026;

-- Verify: post-refresh table
SELECT "conference abbreviation", "Overall_Power_Rating", "Stuff_plus", "WRC_plus",
       round(("Overall_Power_Rating" + 1.25*("Stuff_plus" - 100) + 0.75*(100 - "WRC_plus"))::numeric, 1) AS htp
FROM "Conference Stats"
WHERE season = 2026 AND "conference abbreviation" NOT ILIKE 'NJCAA%'
ORDER BY htp DESC;
```

Staging post-refresh ordering (for sanity): SEC ~132, ACC ~122, Big 12 ~119, Big Ten ~114, … SWAC ~78, NEC ~78.

Conference Stuff+ and WRC+ already current (verified delta=0 staging 2026-05-21) — no V2 runner needed unless per-pitcher Stuff+ or pitcher_stuff_plus_inputs has changed.

**Open follow-up (not blocking):**
`scripts/import-park-factors-2026.ts` had a parser bug that corrupted Indiana + Hawaii rows during last import. CSVs are clean; DB rows were malformed. Investigate before next park import run.

A3e — Stored derived value columns on `player_predictions` (additive, idempotent).

Replaces live recompute of pWAR/oWAR/market_value across PitcherProfile, PlayerProfile, Dashboard, etc. with pure stored reads. Paste on prod:

```sql
ALTER TABLE player_predictions
  ADD COLUMN IF NOT EXISTS p_war numeric,
  ADD COLUMN IF NOT EXISTS o_war numeric,
  ADD COLUMN IF NOT EXISTS market_value numeric,
  ADD COLUMN IF NOT EXISTS projected_ip numeric,
  ADD COLUMN IF NOT EXISTS projected_pa numeric;

COMMENT ON COLUMN player_predictions.p_war IS
  'Stored pitcher WAR — derived from p_rv_plus + projected_ip + role. Replaces live compute.';
COMMENT ON COLUMN player_predictions.o_war IS
  'Stored hitter WAR — derived from p_wrc_plus + projected_pa + depth_role multiplier.';
COMMENT ON COLUMN player_predictions.market_value IS
  'Stored dollar valuation — derived from p_war/o_war × conference tier × position-value multiplier.';
COMMENT ON COLUMN player_predictions.projected_ip IS
  'IP estimate used in p_war calc (varies by role: SP=85, RP=35, SM=50 from equation weights).';
COMMENT ON COLUMN player_predictions.projected_pa IS
  'PA estimate used in o_war calc (varies by depth_role).';

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'player_predictions'
  AND column_name IN ('p_war','o_war','market_value','projected_ip','projected_pa')
ORDER BY column_name;
```

Expected verify: 5 rows, all `numeric`. After columns exist, prod also needs the pitcher precompute re-run (Section K step 5) + returner pipeline run so columns get populated for all pitchers.

---

## Section B — Code state (PROD = `main`)

| # | Item | Status | Notes |
|---|---|---|---|
| B1 | Schema migrations applied (matches Section A1+A2) | ✅ | |
| B2 | Read-path team-scoping (PlayerProfile / Dashboard / HighFollow / TP / TB / Rankings) | ⏳ | Pending PR #24 merge |
| B3 | Handedness bug fix (TP `bats_hand` mapper) | ⏳ | Pending PR #24 merge |
| B4 | Dashboard `Portal` badge keyed off `players.transfer_portal` | ⏳ | Pending PR #24 merge |
| B5 | TB target-add stored-row fast path + `skipLiveCompute` prod-unblock fix | ⏳ | Pending PR #24 merge |
| B6 | TB roster + target tables sort by oWAR / pWAR | ⏳ | Pending PR #24 merge |
| B7 | Per-team equation override overlay in TP simulator + precompute script | ⏳ | Pending PR #24 merge |

**Verification after PR #24 merges to main:**
- [ ] Vercel auto-deploy succeeds
- [ ] Any prod user (no impersonation) opens PlayerProfile → projections shift by a few wRC+ points vs old prod (handedness fix). Direction sane.
- [ ] Open TP → select any player → Show Work shows LHB/RHB-specific park values (not combined).
- [ ] Dashboard "Top 5 Hitters" — amber `Portal` chip only on actually-in-portal players.
- [ ] TB roster table sorted by oWAR desc, pitcher table by pWAR desc.

---

## Section C — Data state per customer team (PROD)

For each customer team that exists on prod:

| Team | school_team_id | Precompute run? | Spot-check verified? | Notes |
|---|---|---|---|---|
| Georgia | (lookup on prod) | ⏳ | | |
| Arkansas | (lookup on prod) | ⏳ | | |
| (others as added) | | | | |

**Lookup customer teams on prod:**
```sql
SELECT id, name, school_team_id FROM customer_teams ORDER BY name;
```

**Run precompute per team:**
```bash
npm run precompute-transfers:prod -- --team <uuid> --division D1 --dry-run   # sanity
npm run precompute-transfers:prod -- --team <uuid> --division D1              # real
```

**Spot-check per team:**
1. Impersonate the team in browser
2. Open one portal hitter's PlayerProfile — projection should match precomputed row
3. TB target search → add same player → display matches profile (no live re-derivation)
4. Switch off impersonation → values revert to global returner numbers

---

## Section D — Multi-client switching behavior

Validated on staging first; only then promote to prod.

| Scenario | Expected | Staging verified | Prod verified |
|---|---|---|---|
| Impersonate Georgia → Hairston shows Georgia stored value | matches `p_avg=0.345` etc. | ⏳ | n/a yet |
| Switch impersonation Georgia → Arkansas → same Hairston re-fetches | Arkansas value (different from Georgia) | ⏳ | n/a yet |
| Switch off all impersonation → global returner row | ~0.385 / 147 wRC+ | ⏳ | n/a yet |
| TB target-add for school WITHOUT precompute on staging | live-compute fallback (no blanks) | ⏳ | n/a yet |
| Per-team override changes Georgia projection only | Arkansas unaffected | ⏳ | n/a yet |

---

## Section E — Auto-fire infrastructure (BUILD on staging FIRST)

| # | Step | Status |
|---|---|---|
| E1 | Create `precompute_jobs` queue table on staging | ✅ 2026-05-21 |
| E2 | Build Edge Function `process-precompute-jobs` worker | ✅ 2026-05-21 |
| E3 | DB trigger: `AFTER INSERT ON customer_teams` → enqueue + `pg_net.http_post` to Edge Function | ✅ 2026-05-21 |
| E4 | Test on staging: insert new customer_team row → row appears in precompute_jobs → Edge Function processes → player_predictions rows land | ✅ 2026-05-21 (Auburn: 3.5s total, 5,000 rows) |
| E5 | Promote to prod: same migrations + Edge Function deployment + trigger | ⏳ |
| E6 | Test on prod: provision a real test customer team through AdminTeams → verify auto-precompute fires | ⏳ |

### E5 Prod promotion runbook (auto-fire infra)

In order:

1. **Apply migrations on prod** (the two new ones from this branch):
   ```bash
   supabase link --project-ref trbvxuoliwrfowibatkm
   supabase db query --linked --file supabase/migrations/20260521120000_precompute_jobs_queue.sql
   supabase db query --linked --file supabase/migrations/20260521130000_customer_teams_autofire_trigger.sql
   ```

2. **Deploy Edge Function to prod**:
   ```bash
   supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm
   ```

3. **Seed prod vault secrets** (paste in prod SQL editor, replace placeholder):
   ```sql
   SELECT vault.create_secret(
     'https://trbvxuoliwrfowibatkm.supabase.co/functions/v1/process-precompute-jobs',
     'precompute_edge_function_url',
     'Edge Function URL for the eager precompute worker'
   );
   SELECT vault.create_secret(
     '<PROD_SERVICE_ROLE_JWT>',
     'precompute_service_role_key',
     'Service role key the trigger uses to invoke process-precompute-jobs'
   );
   ```
   The prod service role key lives in `.env.production.local`.

4. **Bootstrap existing customer teams** (one-time; auto-fire only covers NEW inserts going forward).

   Prod has **8 customer teams** as of 2026-05-21 (verify with `SELECT id, name FROM customer_teams ORDER BY name;` before cutover — list may have grown).

   ```bash
   # Verified prod UUIDs 2026-05-21:
   npm run precompute-transfers:prod -- --team 6deca66a-b4c0-403f-9614-a9d32f1d5994 --division D1   # Arkansas
   npm run precompute-transfers:prod -- --team 66b33ebe-8449-4894-808e-f86f15e3d1f0 --division D1   # Florida Atlantic Owls
   npm run precompute-transfers:prod -- --team 9aef3923-0f11-4813-8036-5766b0db64b6 --division D1   # Georgia Bulldogs
   npm run precompute-transfers:prod -- --team ee947a80-a37e-46d7-bb83-629ee338cfa6 --division D1   # Kansas Jayhawks
   npm run precompute-transfers:prod -- --team 8e21628e-5ad2-421d-bce9-6b54175d1375 --division D1   # Penn State Nittany Lions
   npm run precompute-transfers:prod -- --team b061b218-397c-40b7-ab97-894eb8f75d05 --division D1   # Stetson Hatters
   npm run precompute-transfers:prod -- --team e032ef44-dfd1-420c-a4f0-0917094c440e --division D1   # TCU Horned Frogs
   # RSTR IQ All-Americans is skipped — no school_team_id, no destination
   ```

   Each run takes ~30-60s. Expect ~5,000 rows per team. After all 7 complete:
   ```sql
   SELECT customer_team_id, count(*) AS rows
   FROM player_predictions WHERE variant='precomputed'
   GROUP BY customer_team_id ORDER BY rows DESC;
   -- Should show 7 customer_team_id rows, each with ~5,000.
   ```

5. **Smoke test on prod**:
   ```sql
   -- Pick any D1 team that isn't a current customer
   SELECT t.id, t.full_name FROM "Teams Table" t
   LEFT JOIN customer_teams ct ON ct.school_team_id = t.id
   WHERE t."Season"=2026 AND t.conference='SEC' AND ct.id IS NULL LIMIT 1;

   -- Insert a TEST customer team (clean up after)
   INSERT INTO customer_teams (name, school_team_id) VALUES
     ('AUTOFIRE TEST', '<the-id-above>') RETURNING id;

   -- Wait 5s, then check precompute_jobs (should show status='completed')
   SELECT status, rows_written, completed_at - created_at AS duration
   FROM precompute_jobs WHERE customer_team_id = '<inserted-id>';

   -- Verify rows landed
   SELECT count(*) FROM player_predictions
   WHERE customer_team_id = '<inserted-id>' AND variant='precomputed';

   -- Clean up
   DELETE FROM customer_teams WHERE id = '<inserted-id>';
   ```

---

## Section F — Customers who will see changes immediately after prod merge

When PR #24 merges to main, Vercel auto-deploys. Every prod user will see:

1. **Handedness park-factor fix** — projections shift by 3–5 wRC+ points for many players. This is a real math improvement (fixes a years-old silent bug). Not an error.
2. **Dashboard Portal badge** — corrected. Previously was potentially showing on non-portal players in some edge cases.
3. **TB roster + target tables now sort by WAR descending** — top of table is now "best projected" instead of "added first."
4. **TB target-add no longer crashes for impersonating users** — was a bug we caught + fixed before any prod customer hit it.

If you want every existing user to see a "What's New" modal explaining the changes: bump `STORAGE_KEY` in `src/components/WhatsNewModal.tsx` (v2 → v3). User decided 2026-05-21 to defer this until a bigger user-visible release.

---

## Section G — Rollback plan (if something goes wrong on prod)

### Quick rollback (revert merge commit)
```bash
git checkout main
git revert -m 1 <merge-commit-sha>
git push origin main
```
Vercel auto-redeploys previous code. Schema + data stays as-is (additive only — no rows deleted).

### Schema rollback (only if absolutely needed — currently zero customers depend on team-scoped reads)
```sql
-- Reverse migration A2
ALTER TABLE public.player_predictions
  DROP CONSTRAINT IF EXISTS player_predictions_player_team_model_variant_season_key;
ALTER TABLE public.player_predictions
  ADD CONSTRAINT player_predictions_player_id_model_type_variant_season_key
  UNIQUE (player_id, model_type, variant, season);

-- Reverse migration A1 (DESTRUCTIVE if precompute rows exist — only run if Section C is empty)
DROP TRIGGER IF EXISTS trg_cte_overrides_updated_at ON public.customer_team_equation_overrides;
DROP FUNCTION IF EXISTS public.touch_cte_overrides_updated_at();
DROP TABLE IF EXISTS public.customer_team_equation_overrides;
DROP INDEX IF EXISTS public.idx_player_predictions_player_team_model;
DROP INDEX IF EXISTS public.idx_player_predictions_customer_team;
ALTER TABLE public.player_predictions DROP COLUMN IF EXISTS customer_team_id;
```

### Data rollback (remove all precomputed rows for a team)
```sql
DELETE FROM player_predictions
WHERE customer_team_id = '<uuid>' AND variant = 'precomputed';
```

---

---

## Section H — Architectural principle (the one rule)

**When a customer team is active AND a team-scoped precomputed row exists, the displayed projection IS the stored row. No re-derivation, no live math.** Live computation only fires when:
- No customer team active (agent view / no impersonation)
- No precomputed row exists yet for that player + team
- TransferPortal simulator (intentional what-if with editable destination)
- Pitchers (until pitcher precompute is built)

This rule is enforced in:
- `src/pages/PlayerProfile.tsx` — `regularPred` selector
- `src/pages/TeamBuilder.tsx` — `addPlayerFromTargetSearch` + `simulateTransferProjection`
- `src/lib/teamScopedPredictions.ts` — shared `pickPreferredPrediction` helper

---

## Section I — Reference (copy/paste constants)

### Supabase project refs

| Env | Project Ref | Link command |
|---|---|---|
| Staging | `slrxowawbijbjrkozqlj` | `supabase link --project-ref slrxowawbijbjrkozqlj` |
| Prod | `trbvxuoliwrfowibatkm` | `supabase link --project-ref trbvxuoliwrfowibatkm` |

### Customer team UUIDs

**STAGING** (look up fresh on prod — UUIDs differ):
```sql
SELECT id, name, school_team_id FROM customer_teams;
```

Known staging UUIDs (validated 2026-05-20):
- Georgia: `289f4f16-555e-46d3-b899-2462c5cfaa24`
- Arkansas: `81ad0369-e0c7-4427-a8db-39a091863d40`
- RSTR IQ All-Americans: internal, no `school_team_id`, skip

### Env files used by NPM scripts

- `.env.local` — staging credentials (gitignored)
- `.env.production.local` — prod credentials (gitignored)

The npm scripts load these via `tsx --env-file-if-exists=...`. Service role keys must be present in both files.

### NPM script aliases

```bash
# Staging
npm run precompute-transfers -- --team <uuid> --division D1 [--dry-run]

# Prod (uses .env.production.local automatically)
npm run precompute-transfers:prod -- --team <uuid> --division D1 [--dry-run]
```

Other flags:
- `--division JUCO` (NOT YET IMPLEMENTED — district-ID resolver pending)
- `--division all` (D1 + JUCO once JUCO lands)
- `--debug-player Hairston` (dumps full inputs for one player)

### Per-team equation override SQL pattern

Override a single weight for one customer team (the principle is the same for any `config_key` in `model_config` admin_ui domain):

```sql
-- Example: drop Georgia's BA power weight from 0.70 default to 0.30
INSERT INTO customer_team_equation_overrides
  (customer_team_id, model_type, config_key, config_value)
VALUES
  ('<georgia-uuid>', 'admin_ui', 't_ba_power_weight', 0.30)
ON CONFLICT (customer_team_id, model_type, config_key)
DO UPDATE SET config_value = EXCLUDED.config_value;

-- Re-run precompute for that team to materialize the new math
-- npm run precompute-transfers:prod -- --team <georgia-uuid> --division D1

-- Read all overrides for one team
SELECT model_type, config_key, config_value
FROM customer_team_equation_overrides
WHERE customer_team_id = '<georgia-uuid>'
ORDER BY model_type, config_key;

-- Remove an override (revert to canonical default)
DELETE FROM customer_team_equation_overrides
WHERE customer_team_id = '<georgia-uuid>' AND config_key = 't_ba_power_weight';
```

`model_type` should be `'admin_ui'` to match the global query. Other valid values: `'transfer'`, `'global'`, `'returner'` — the script overlays all of these. Use `'admin_ui'` when in doubt.

---

## Section J — Schema gotchas (in case you forget)

These bit us during yesterday's script work. Save the time.

| Table | Gotcha |
|---|---|
| `"Teams Table"` (quoted, space) | `full_name` column (NOT `"Team"`). `Season` is **capital S**. `conference` is lowercase. `source_id` is the external ID; `id` is the per-season UUID. `customer_teams.school_team_id` references `id` (NOT `source_id`). |
| `"Conference Stats"` (quoted, space) | Columns: `"AVG"`, `"OBP"`, `"ISO"`, `"Stuff_plus"` (uppercase). Conference name lives in `"conference abbreviation"` (lowercase, with space). `season` is lowercase. **For 1-team conferences (e.g. Independent), the importer leaves stats NULL — must backfill with NCAA averages.** |
| `player_predictions` | Columns are `p_avg`, `p_obp`, `p_slg`, `p_ops`, `p_iso`, `p_wrc`, `p_wrc_plus`, `p_rv_plus`, `p_war`, `p_era`, etc. **NO `owar` or `nil_valuation` columns** — those are derived at read time from `p_wrc_plus`. |
| `players` | `transfer_portal` (boolean) is the source of truth for portal status — NOT `prediction.model_type === 'transfer'` (which is now true for every precomputed row regardless). |
| `customer_team_equation_overrides` | RLS: SELECT for team members + superadmin; WRITE for superadmin only (team-admin self-service is v2). |

### Supabase JS client gotchas

- `.in("player_id", uuids)` URL is built as a query string. **~200 UUIDs is the safe upper bound** — go higher and you hit `HeadersOverflowError` at 16KB. The precompute script batches at 200.
- PostgREST FK disambiguation can return unexpected join rows when a table has multiple FKs (e.g. `player_predictions` → `players` + `customer_teams`). When in doubt, use an **explicit follow-up query** instead of an inline join.
- Default cache (React Query) ignores Supabase RLS context changes — always include `effectiveTeamId` in `queryKey` for team-scoped queries.

### `playerProjection()` return shape gotcha

Returns different keys depending on `treatAsPitcher`:
- **Hitter side:** `owar` (not `p_war`)
- **Pitcher side:** `owar` (aliased to pwar) AND `pwar` — read `pwar` for pitchers

This burned us yesterday on the WAR sort.

---

## Section K — Cutover Day Runbook (target: minutes)

For when we're ready to flip prod from "pre-precompute" to "fully-precomputed with autofire."

**Pre-flight (done before cutover day):**
- [x] Schema migrations on prod (Section A1/A2 — done 2026-05-20)
- [x] Independent SQL fix on prod (Section A3 — done 2026-05-21)
- [ ] PR #24 merged to main → Vercel auto-deploys (Section B — pending)
- [ ] Auto-fire infra built + tested on staging (Section E)
- [ ] Auto-fire infra deployed to prod (Section E5)

**Day-of (in order):**

```bash
# 1. Link to prod
cd ~/dev-main/diamond-predictor-66
supabase link --project-ref trbvxuoliwrfowibatkm

# 2. Inventory customer teams on prod
supabase db query --linked "SELECT id, name, school_team_id FROM customer_teams ORDER BY name;"
# Copy each customer_team_id

# 3. Dry-run precompute for each team (sanity)
npm run precompute-transfers:prod -- --team <uuid-1> --division D1 --dry-run
npm run precompute-transfers:prod -- --team <uuid-2> --division D1 --dry-run
# ... etc. Expect ~5,000 D1 hitters per team, ~97% computed.

# 4. Real run for HITTER precompute (each team)
npm run precompute-transfers:prod -- --team <uuid-1> --division D1
npm run precompute-transfers:prod -- --team <uuid-2> --division D1
# ... ~30s per team. Verify each one prints "✓ done".

# 5. Real run for PITCHER precompute (each team) — added 2026-05-21
npm run precompute-pitchers:prod -- --team <uuid-1>
npm run precompute-pitchers:prod -- --team <uuid-2>
# ... ~30s per team. Expect ~5,000 D1 pitchers per team, ~97% computed.
# Verify each prints "✓ done" with row count.

# 6. Verify on prod (hitter + pitcher row counts)
supabase db query --linked "
  SELECT customer_team_id, count(*) AS rows,
         count(p_avg) AS hitter_rows,
         count(p_era) AS pitcher_rows
  FROM player_predictions
  WHERE variant='precomputed'
  GROUP BY customer_team_id;
"
# Expect ~5,000 hitter_rows + ~5,000 pitcher_rows per team.

# 7. Spot-check in browser (impersonate each customer team):
#    - Hairston or known portal hitter shows team-scoped value (hitter side)
#    - Sean Jenkins or known portal pitcher shows team-scoped value (pitcher side)
# 8. Notify customers (optional WhatsNewModal bump)
```

Estimated total time: **10–15 minutes** for steps 1–7 once auto-fire is live for future customer onboarding.

---

## Section L — DEPENDENCIES BEFORE PROD CUTOVER (added 2026-05-21 EOD)

The cutover above ships team-scoped precomputed projections (hitter + pitcher). **DO NOT promote to main yet** — these gating items must land first:

| Gate | Status | Blocker |
|---|---|---|
| L1 | Returner pipeline writes pitcher rates + p_war + market_value | Not started — see `docs/stored-derived-values-plan.md` Phase 3b |
| L2 | PitcherProfile + Dashboard read pure-stored values (no live recompute fallback) | Partial — c1af893 has stored-first with fallback. Plan Phase 4a removes fallback. |
| L3 | Pitcher precompute Edge Function (auto-fire scope = pitchers_d1) | Not started — see Phase 6 of master plan |
| L4 | Auto-fire trigger extension to enqueue pitcher jobs on customer_team INSERT | Not started |
| L5 | Verification: Rossow + 5 pitchers show identical values on Profile + Dashboard on staging | Not done — see `docs/stored-derived-values-plan.md` Phase 6 |
| L6 | TB target board cleanup (add depth default + read precomputed + market value team-scoped) | Not done — flagged BEFORE MAIN |

**Skipped/reverted this session (NOT to be re-applied to prod):**
- DEFAULT_PITCHING_WEIGHTS calibration (era_sd 1.588 → 2.567 etc.) — broke elite-tail math (powerAdj went negative for PR+ > 170). Reverted in code. Needs different approach. See memory `pitcher-precompute-calibration` for the 12 calibrated values when we retry.

**Why the gate matters:** without L1, no-impersonation pitcher views show stale or missing returner rows. Without L2, profile and dashboard diverge. Without L3+L4, new customer teams won't auto-get pitcher precompute. Without L5, we don't have confidence the math is right end-to-end. Without L6, target board UX regressions ship.

**Order of operations to clear gates:** L5 verification → L1 returner pipeline → re-verify L5 → L2 read-path cleanup → L3 + L4 auto-fire → L5 final verification → L6 TB cleanup → merge to main → run cutover runbook above.

---

*Last updated: 2026-05-21 EOD. Pair with `docs/eager-precompute-session-log.md` for chronological detail and `docs/stored-derived-values-plan.md` for the architecture refactor.*
