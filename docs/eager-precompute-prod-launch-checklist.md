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
| E1 | Create `precompute_jobs` queue table on staging | ⏳ |
| E2 | Build Edge Function `process-precompute-jobs` worker | ⏳ |
| E3 | DB trigger: `AFTER INSERT ON customer_teams` → enqueue + `pg_net.http_post` to Edge Function | ⏳ |
| E4 | Test on staging: insert new customer_team row → row appears in precompute_jobs → Edge Function processes → player_predictions rows land | ⏳ |
| E5 | Promote to prod: same migrations + Edge Function deployment + trigger | ⏳ |
| E6 | Test on prod: provision a real test customer team through AdminTeams → verify auto-precompute fires | ⏳ |

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

# 4. Real run for each team
npm run precompute-transfers:prod -- --team <uuid-1> --division D1
npm run precompute-transfers:prod -- --team <uuid-2> --division D1
# ... ~30s per team. Verify each one prints "✓ done".

# 5. Verify on prod
supabase db query --linked "
  SELECT customer_team_id, count(*) AS rows
  FROM player_predictions
  WHERE variant='precomputed'
  GROUP BY customer_team_id;
"
# Expect one row per customer team with ~5,000 each.

# 6. Spot-check in browser (impersonate each customer team, verify Hairston / known portal hitter shows team-scoped value)
# 7. Notify customers (optional WhatsNewModal bump)
```

Estimated total time: **5–10 minutes** for everything in step 1–6 once auto-fire is live for future customer onboarding.

---

*Last updated: 2026-05-21. Pair with `docs/eager-precompute-session-log.md` for chronological detail.*
