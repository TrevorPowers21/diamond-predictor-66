# Eager Pre-compute Build — Session Log

Living audit trail of every SQL command, migration, code change, and verification step for the eager transfer pre-compute work. Append-only — never edit prior entries; add new dated sections instead. The point is "what exactly did we do" so future-us or a teammate can reconstruct or roll back.

For the higher-level plan see `~/.claude/projects/-Users-danielleogonowski/memory/project_eager_precompute_buildout_plan.md`.

---

## 2026-05-20 — Foundation shipped

**Branch:** `feature/season-transition-2027` (uncommitted at session end; will commit bundled with next iteration's work per user direction).

### Migration applied to STAGING + PROD

**File:** `supabase/migrations/20260520200000_eager_transfer_precompute_schema.sql`

**Command used (both envs, via `supabase link` switching):**
```bash
supabase link --project-ref slrxowawbijbjrkozqlj   # staging
supabase db query --linked --file supabase/migrations/20260520200000_eager_transfer_precompute_schema.sql

supabase link --project-ref trbvxuoliwrfowibatkm   # prod
supabase db query --linked --file supabase/migrations/20260520200000_eager_transfer_precompute_schema.sql

supabase link --project-ref slrxowawbijbjrkozqlj   # back to staging
```

**What the migration adds (verbatim from the file):**

1. `player_predictions.customer_team_id uuid` — nullable, FK → customer_teams(id) ON DELETE CASCADE.
   - Index `idx_player_predictions_player_team_model` on `(player_id, customer_team_id, model_type) WHERE status = 'active'`
   - Index `idx_player_predictions_customer_team` on `(customer_team_id) WHERE customer_team_id IS NOT NULL`

2. New table `customer_team_equation_overrides`:
   ```
   customer_team_id uuid NOT NULL REFERENCES customer_teams(id) ON DELETE CASCADE,
   model_type       text NOT NULL,
   config_key       text NOT NULL,
   config_value     numeric NOT NULL,
   updated_at       timestamptz NOT NULL DEFAULT now(),
   updated_by       uuid REFERENCES auth.users(id),
   PRIMARY KEY (customer_team_id, model_type, config_key)
   ```
   - Index on `customer_team_id`
   - Trigger `trg_cte_overrides_updated_at` keeps `updated_at` fresh on UPDATE
   - RLS enabled. SELECT: superadmin OR `is_team_member`. WRITE: superadmin only (team-admin self-service deferred to v2).

3. Player_predictions RLS NOT modified — existing `USING (true)` SELECT policy already covers customer-scoped rows.

### Verification queries run

```sql
-- Staging + prod both returned the new column
SELECT column_name FROM information_schema.columns
WHERE table_name='player_predictions' AND column_name='customer_team_id';
-- → customer_team_id

-- Staging + prod both returned the empty new table
SELECT count(*) FROM customer_team_equation_overrides;
-- → 0
```

### Code changes (uncommitted on `feature/season-transition-2027`)

1. **`src/lib/predictionEngine.ts` — `loadEngineConfig(customerTeamId?)`**
   - Accepts new optional `customerTeamId` arg.
   - After loading global `equation_weights` map, if `customerTeamId` provided, fetches all rows from `customer_team_equation_overrides` for that team and overwrites matching keys in the eqWeights map (team wins).
   - Same overlay applied to `model_config` rows (returner + transfer model_type buckets) when team-typed overrides exist.

2. **`src/lib/predictionEngine.ts` — `recalculatePredictionById`**
   - Reads `customer_team_id` from the prediction row.
   - Passes it to `loadEngineConfig(customerTeamId)` in both TWP path and hitter path.

3. **`src/lib/predictionEngine.ts` — `fetchPitcherContext`**
   - Reads `customer_team_id` from the prediction row.
   - After `readPitchingWeights()` returns the sync default eq object, fetches per-team overrides (filtered to `model_type IN ('pitching','transfer','global')`) and overlays matching keys onto the eq object.

**Typecheck:** clean (`npx tsc --noEmit` returned no errors).

### What this enables right now

- Any row in `player_predictions` with `customer_team_id` set → next recalc uses that team's override layer.
- No team-scoped rows exist yet (nothing creates them). So no behavior change visible in app today.
- SQL workflow for tuning Georgia's weights is live:
  ```sql
  -- Read Georgia's effective overrides
  SELECT model_type, config_key, config_value
  FROM customer_team_equation_overrides
  WHERE customer_team_id = '289f4f16-555e-46d3-b899-2462c5cfaa24';  -- Georgia (verify uuid)

  -- Set Georgia's BA power weight to 0.65 (example)
  INSERT INTO customer_team_equation_overrides (customer_team_id, model_type, config_key, config_value)
  VALUES ('289f4f16-...', 'returner', 't_ba_power_weight', 0.65)
  ON CONFLICT (customer_team_id, model_type, config_key)
  DO UPDATE SET config_value = EXCLUDED.config_value;
  ```

### What is NOT yet wired (deferred to next session)

- Precompute script (`scripts/precompute-transfer-projections.ts`)
- Shared input-builder lib (`src/lib/buildTransferProjectionInputs.ts`)
- `precompute_jobs` queue table + Edge Function + worker
- Auto-fire DB triggers (customer_teams insert, stats data ingest, equation changes)
- PlayerProfile read-path team-scoped lookup
- Admin manual re-run button
- Unique index on player_predictions for UPSERT path

### Rollback plan (if needed)

```sql
-- Migration is additive; rollback is safe
DROP TRIGGER IF EXISTS trg_cte_overrides_updated_at ON public.customer_team_equation_overrides;
DROP FUNCTION IF EXISTS public.touch_cte_overrides_updated_at();
DROP TABLE IF EXISTS public.customer_team_equation_overrides;
DROP INDEX IF EXISTS public.idx_player_predictions_player_team_model;
DROP INDEX IF EXISTS public.idx_player_predictions_customer_team;
ALTER TABLE public.player_predictions DROP COLUMN IF EXISTS customer_team_id;
```

Code revert: `git checkout main -- src/lib/predictionEngine.ts` undoes the loader changes.

---

## 2026-05-20 (cont.) — Shared input-builder extracted

**Branch:** `feature/season-transition-2027` (uncommitted; will commit at next checkpoint).

### Code changes

- **NEW `src/lib/buildTransferProjectionInputs.ts`** — pure helper exporting:
  - `readEquationValue(key, fallback, remoteValues?)` — renamed equivalent of the per-page `readLocalNum` (no localStorage involvement; Supabase model_config wins, then `TRANSFER_WEIGHT_DEFAULTS`).
  - `normalizeParkToIndex(n)` — same semantics as TP page helper.
  - `buildHitterTransferInputs(args)` — main entry. Takes player row + from/to team rows + conference + handedness + internals/seedPower fallback + two resolver callbacks (`resolveConferenceHitting`, `resolveParkFactor`) + `remoteEquationValues` map. Returns either `{ blocked: true, missingInputs: [] }` or `{ blocked: false, inputs: TransferProjectionInputs, transferMultiplier, classAdj, isJucoSource }`.
  - Encapsulates: JUCO outlier regression for AVG/OBP/ISO, PR+ resolution (internals → seed-power compute fallback), park handedness routing, conference + park missing-input gating, NCAA averages + std-dev defaults, JUCO-vs-D1 weight branch via `transferWeightsForSource`, class-transition + dev-aggressiveness multiplier.

### What this enables now

- Both TP and the precompute script (next step) can call one function and stay locked together.
- New equation keys are zero-touch: as long as the upstream `loadEngineConfig` returns them in `remoteEquationValues`, the builder reads them via `readEquationValue`. No code changes when keys are added/renamed in Supabase.

### NOT yet done in this sub-step

- TP page (`src/pages/TransferPortal.tsx`) has NOT yet been refactored to use the new builder. The duplication is intentional for now: builder is verified pure and typechecks; TP refactor lands when the precompute script is wired so both can be smoke-tested side-by-side against the same player. Risk of refactoring TP first without a second consumer = silently breaking the simulator with no second source-of-truth to diff against.

### Typecheck

`npx tsc --noEmit` clean.

---

## 2026-05-20 (cont.) — UPSERT unique constraint widened

**File:** `supabase/migrations/20260520210000_player_predictions_unique_with_customer_team.sql`

**Applied to:** STAGING + PROD (`supabase db query --linked --file ...` against both project refs).

### Before / after

- Before: `UNIQUE (player_id, model_type, variant, season)` — pre-dated `customer_team_id`, would have blocked team-scoped UPSERTs from coexisting with global rows.
- After: `UNIQUE NULLS NOT DISTINCT (player_id, customer_team_id, model_type, variant, season)`. Constraint name: `player_predictions_player_team_model_variant_season_key`.

`NULLS NOT DISTINCT` ensures the global row (customer_team_id IS NULL) is still deduped — without it, NULL would be treated as always-distinct and you'd accumulate duplicate global rows.

### Pre-flight check (both envs)

```sql
SELECT player_id, customer_team_id, model_type, variant, season, count(*)
FROM player_predictions
GROUP BY 1,2,3,4,5
HAVING count(*) > 1;
-- staging: 0 rows, prod: 0 rows
```

### Post-apply verification (both envs)

```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.player_predictions'::regclass AND contype = 'u';
-- → player_predictions_player_team_model_variant_season_key
```

### Rollback (if needed)

```sql
ALTER TABLE public.player_predictions
  DROP CONSTRAINT IF EXISTS player_predictions_player_team_model_variant_season_key;
ALTER TABLE public.player_predictions
  ADD CONSTRAINT player_predictions_player_id_model_type_variant_season_key
  UNIQUE (player_id, model_type, variant, season);
```

---

## 2026-05-20 (cont.) — Precompute script shipped + first staging run

**Branch:** `feature/season-transition-2027` (uncommitted)

### Code changes

- **NEW `scripts/precompute-transfer-projections.ts`** — batch eager pre-compute. Loads lookups once (model_config + per-team overrides → `remoteEquationValues`; `Conference Stats` via `fetchConferenceStats`; `Park Factors` via `fetchParkFactorsMap`; `Teams Table` for source-team conference resolution; portal hitters; their latest active `player_predictions` row for `from_avg/obp/slg` + `class_transition`; `player_prediction_internals` for PR+). Calls the shared `buildHitterTransferInputs` then `computeTransferProjection` + `applyTransferPostprocess`. UPSERTs rows scoped to one `customer_team_id`. Pitchers excluded (v1 hitter-only).
- **`src/lib/buildTransferProjectionInputs.ts`** — added `applyTransferPostprocess` so script and TP page derive identical `pSlg/pOps/pWrc/pWrcPlus/oWAR` from `computeTransferProjection` output + `transferMultiplier`.
- **`package.json`** — added `precompute-transfers` and `precompute-transfers:prod` scripts.

### Schema discoveries (column names in player_predictions)

The table uses `p_avg` / `p_obp` / `p_slg` / `p_ops` / `p_iso` / `p_wrc` / `p_wrc_plus` (NOT `projected_*`). There are NO `owar` or `nil_valuation` columns — those are derived at read time from `p_wrc_plus` + position/conference. The script does not persist them.

### Staging run results

```
npm run precompute-transfers -- --team 289f4f16-555e-46d3-b899-2462c5cfaa24
→  destination: University of Georgia (SEC)
→  0 equation keys (model_config empty on staging — readEquationValue falls
    through to TRANSFER_WEIGHT_DEFAULTS canonical values, same as TP page)
→  40 Conference Stats rows, 466 Teams Table rows
→  49 portal players → 27 hitters → 22 computed, 5 blocked
→  upserted 22 rows
```

Block reasons (all unblockable without source-data fixes, same as TP page):
- 4× missing source conference stats (probably JUCO / unknown conferences)
- 1× missing PR+ for one player

### Verification

```sql
SELECT
  count(*) FILTER (WHERE customer_team_id = '289f4f16-...') AS georgia,
  count(*) FILTER (WHERE customer_team_id = '289f4f16-...' AND variant='precomputed') AS georgia_precomputed
FROM player_predictions;
-- → 22, 22
```

### Bugs found + fixed during the run

1. `school_team_id` references Teams Table `id` (primary key), not `source_id` (numeric external id like "226"). Fixed lookup.
2. `Conference Stats` is the quoted/spaced table name with weird columns ("AVG", "OBP", "ISO", "Stuff_plus", "conference abbreviation"). Switched to the existing `fetchConferenceStats` helper which knows how to handle it.
3. Teams Table uses `Season` (capital S) for season but `conference` (lowercase) for conference. Got both right.

### What this enables now

- Anyone can run `npm run precompute-transfers -- --team <uuid> [--dry-run]` to generate team-scoped transfer projections for portal hitters.
- Per-team equation overrides ARE honored (overlay happens in step 2a).
- Prod is still untouched — only used when explicitly invoked.

### Rollback

```sql
DELETE FROM player_predictions
WHERE customer_team_id IS NOT NULL AND variant = 'precomputed';
```

---

## 2026-05-20 (cont.) — Read-path wired (PlayerProfile + Dashboard + HighFollow)

**Branch:** `feature/season-transition-2027` (uncommitted)

### NEW shared helper

`src/lib/teamScopedPredictions.ts`:

- `applyTeamScopeFilter(query, effectiveTeamId)` — Supabase query helper. With a team set, filters to `(customer_team_id IS NULL OR customer_team_id = team)`. Without a team, filters strict-NULL.
- `pickPreferredPrediction(rows, effectiveTeamId)` — given rows for ONE player, picks team-scoped precomputed row first, else global regular row.
- `dedupePreferredPerPlayer(rows, effectiveTeamId)` — same logic but reduces a mixed bag down to one row per player.

### Surfaces wired

1. **PlayerProfile** (`src/pages/PlayerProfile.tsx`)
   - `predictions` query: now loads global + team-scoped rows. `regularPred` selector prefers team-scoped `precomputed` row over global `regular` row.
   - queryKey includes `effectiveTeamId` so cache busts on team switch / impersonation.

2. **Dashboard** (`src/pages/Dashboard.tsx`) — 3 query sites:
   - `topHitters` leaderboard
   - `topPitchers` leaderboard
   - `targetBoard` panel (overview-portal-activity-v4)
   - All use `applyTeamScopeFilter` on the query + `dedupePreferredPerPlayer` on the result. queryKeys all include `effectiveTeamId`.

3. **HighFollowList** (`src/pages/HighFollowList.tsx`) — target board page:
   - `predictions` query updated identically. queryKey includes `effectiveTeamId`.

### What this means for users today

- Superadmin (no impersonation): sees global rows as before. **No behavior change.**
- Superadmin impersonating Georgia: sees team-scoped projections for the 22 hitters that have one; everything else falls back to global. Cache key includes team so switching impersonation re-fetches.
- Real Georgia coach (when account exists): same as impersonating Georgia.

### Surfaces NOT yet wired (deliberate — deferred to next turn)

- **Rankings / ReturningPlayers** (5 query sites) — biggest blast radius, separate turn.
- **PitcherProfile** — counterpart to PlayerProfile; pitcher precompute scope not built yet, so wiring it now buys nothing for pitchers but adds risk.
- **NilValuations** — derives NIL from p_wrc_plus, would benefit but lower priority.
- **TeamBuilder / TransferPortal** — intentionally untouched. TB is the destination flow; TP is the simulator that PRODUCES the math, not consumes precomputed rows.
- **PDF export** — `pdfGenerator.ts` is fed a `ReportPlayer[]` by callers. Whatever surface the PDF is launched from (PlayerProfile, Rankings) propagates naturally. PlayerProfile already wired; Rankings pending.

### Scope expansion note

User wants the team-scoped equation to apply to **every player**, not just portal hitters. Precompute script currently filters `WHERE portal_status = 'IN PORTAL'`. Need a follow-up pass to widen to all hitters (and pitchers when their builder lands). Logged as a todo.

### Typecheck

`npx tsc --noEmit` clean after all four file changes.

---

## 2026-05-20 (cont.) — Scope expansion + Independent fix + D1/JUCO separation

**Branch:** `feature/season-transition-2027` (uncommitted)

### Script changes (`scripts/precompute-transfer-projections.ts`)

1. **Dropped portal filter.** Was `.or("portal_status.eq.IN PORTAL,transfer_portal.eq.true")`. Now loads every player.
2. **Added own-team exclusion.** Players whose `source_team_id` matches the destination team's `source_id` are skipped — transfer math doesn't make sense for a player staying put (their returner row stays canonical).
3. **Conference resolution switched to UUID.** `fromConferenceId` now flows through from `teamByName.get(...).conference_id` (was name-only). Recovered ~1,200 D1 players whose conference NAME drifted but conference_id matched.
4. **Batched .in() queries.** UUIDs at 36 chars each blow Supabase's 16KB URL limit with 500 IDs; dropped to 200.
5. **`--division D1|JUCO|all`** CLI flag (default D1). JUCO is opt-in until district-ID resolver lands.
6. **Division + block-category breakdown** in dry-run output for visibility.

### Database change (NOT a migration — data fix)

Independent conference had a Conference Stats row for 2026 with all stats NULL (1-team conference, importer couldn't aggregate). Caused all Oregon State players (only Independent team) to block on missing From AVG+/OBP+/ISO+.

**Fix (applied to STAGING):**
```sql
UPDATE "Conference Stats"
SET "AVG"=0.280, "OBP"=0.385, "ISO"=0.162, "Stuff_plus"=100
WHERE "conference abbreviation"='Independent' AND season=2026;
```

This is a data statement: Independent = NCAA averages (since there's no actual conference aggregation possible). Applies retroactively to TP simulator + every consumer.

### D1 dry-run results on staging (Georgia)

```
Total hitters in D1:    5,162  (after excluding Georgia's own 39)
Computed:               4,999  (97%)
Blocked:                  163  (3% — all real data gaps)
  158  Missing PR+ (small-school scouting — known gap)
   11  Zero source stats (no PA in 2026 — player-side data gap)
```

### Bugs discovered during this round

- Teams Table `conference` column is lowercase but `Season` is capitalized (already known).
- An earlier accidental `replace_all` on "Conference" → "conference" broke `fromConference`/`toConference` variable names and `ConferenceHittingStats` type name. All fixed.
- `.in()` URL length: cap at ~200 UUIDs per call.

### What needs to happen on PROD (when ready to promote)

#### Migrations (already applied to staging + prod earlier):
- `20260520200000_eager_transfer_precompute_schema.sql` ✅
- `20260520210000_player_predictions_unique_with_customer_team.sql` ✅

#### Data fix (NOT YET on prod):
```sql
-- Run on prod when ready
UPDATE "Conference Stats"
SET "AVG"=0.280, "OBP"=0.385, "ISO"=0.162, "Stuff_plus"=100
WHERE "conference abbreviation"='Independent' AND season=2026;
```

#### Precompute run (NOT YET on prod):
For each customer team on prod, run:
```bash
npm run precompute-transfers:prod -- --team <customer_team_uuid> --division D1
```

Today that's just Georgia (`289f4f16-555e-46d3-b899-2462c5cfaa24`). If other customer teams exist on prod, run for each.

#### JUCO (deferred — needs separate work):
JUCO uses district IDs (separate namespace from conference IDs). Need to wire `jucoDistrictNameFromConference` + `JUCO_DISTRICT_CONFERENCE_ID` from `transferWeightDefaults.ts` into the script's resolver. Once that's wired:
```bash
npm run precompute-transfers:prod -- --team <uuid> --division JUCO
```

#### Code (committed on `feature/season-transition-2027`, needs feature→staging→main flow):
All read-path + script + helper code changes need to land on main.

### Recurring sanity check to add later

For new seasons: scan Conference Stats for null-AVG rows. Any non-aggregated single-team conference (currently just Independent) needs the NCAA-average backfill. Easy to forget for 2027/2028.

---

## 2026-05-20 (cont.) — TeamBuilder + Rankings + TP handedness bug + Dashboard badge

**Branch:** `feature/season-transition-2027` (uncommitted)

### Bugs fixed

1. **TP handedness silently dropped.** `bats_hand` was being selected from the DB but DROPPED in the `SimPlayer` mapper at TransferPortal.tsx:657. Result: `playerHand` was always null in `resolveMetricParkFactor`, so TP was using COMBINED park factors instead of LHB/RHB-specific ones for years. Added `bats_hand` to both the `SimPlayer` type and the mapper. Now Show Work park values reflect actual LHB/RHB factors and simulator output matches the precompute exactly. (Found via Hairston divergence: TP showed 0.354/0.476/139, precompute 0.345/0.470/136. After fix both match precompute.)
2. **Dashboard "Portal" badge.** Was keyed on `prediction.model_type === "transfer"`. With team-scoped precomputed rows (model_type='transfer' for every D1 hitter), every returner showed an amber Portal chip. Switched to `players.transfer_portal` flag from the joined player row.
3. **buildTransferProjectionInputs handedness casing.** Local `batsHandToHandedness` returned uppercase "LHB" but `resolveMetricParkFactor` expects lowercase Handedness enum ("lhb"). Removed local copy, imports canonical helper from `parkFactors.ts`. Hairston shifted from 141 → 136 (LHB park now applied).

### Read-path surfaces wired this round

4. **TeamBuilder live target predictions** (`src/pages/TeamBuilder.tsx:3004`) — applies team-scope filter, prefers team-scoped precomputed row via `pickPreferredPrediction`, falls back to the existing `selectTransferPortalPreferredPrediction` ranker when no team-scoped row.
5. **TeamBuilder loadBuild predictions** (`src/pages/TeamBuilder.tsx:2068`) — same pattern: expanded variants to include precomputed, applied team scope, dedupes preferring team-scoped row before the existing best-of-regular picker.
6. **Rankings (ReturningPlayers) "fast path" — bypassed when team set.** Branch A is server-paginated by sort column; team-scoped duplicates would break that. Routed through Branch B (load all + JS sort + dedupe) when `effectiveTeamId` is set. No team set → unchanged.
7. **Rankings Branch B** — expanded variants, applied scope, dedupes preferring team-scoped row via `dedupePreferredPerPlayer` before the existing best-of-multiple picker.
8. **Rankings NIL aux query** — same pattern.
9. **queryKey** updated on Rankings useQuery to include `teamScope: effectiveTeamId` so cache busts on team switch.

### Where Add-to-Board surfaces are now team-scoped

- PlayerProfile ✅ (previous round)
- Dashboard target-board panel ✅ (previous round)
- HighFollowList page ✅ (previous round)
- TransferPortal simulator (overlay) ✅ (previous round)
- TeamBuilder candidate pool ✅ (this round)
- Rankings (browse-to-add) ✅ (this round)

### Surfaces NOT yet wired (deferred / parallel work)

- **PitcherProfile** — pitcher precompute data doesn't exist yet; read-path wiring is a no-op for hitters. Worth wiring once pitcher precompute lands.
- **PitcherRanking pagination** (line 2183) — same reasoning.
- **JucoPlayerDashboardPanel** — JUCO-specific surface; tied to JUCO district-ID resolver work.
- **Admin batch query** (line 2067) — counts returner prediction IDs, no display impact.

### Typecheck

`npx tsc --noEmit` clean after all changes.

---

## 2026-05-20 (cont.) — TB target-add: stop re-deriving, read stored row

**Branch:** `feature/season-transition-2027` → PR to `staging`

### Problem

User added Hairston via TB target-search expecting the stored precomputed value (0.345 pAVG). TB displayed 0.359 instead. Root cause: two layers of re-derivation that ran AFTER my earlier add-time fix.

### Two-layer fix

1. **Add-time** (`addPlayerFromTargetSearch`, line ~4335) — replaced the join-based lookup (PostgREST FK + RLS made it unreliable) with an explicit Supabase fetch for `(player_id, customer_team_id, variant='precomputed', status='active')`. If found, the snapshot is built from those columns directly. No live computation. Live-compute fallback is now guarded behind `skipLiveCompute` and only fires for agent views (no team) or pitchers (no precompute yet).

2. **Display-time** (`simulateTransferProjection`, line ~3135) — this hook re-derives the projection on EVERY render of a target row, overwriting the stored snapshot. Added an early-return at the top of the hitter branch: when `effectiveTeamId` is set AND `livePred` is a team-scoped `variant='precomputed'` row, return its stored `p_avg/p_obp/p_slg/p_wrc_plus` directly. Pitcher branch unchanged (no pitcher precompute yet).

### Architectural principle (locked in this session)

When a customer team is active and a team-scoped precomputed row exists for a player, the displayed projection IS the stored row. No re-derivation, no fallback to live math. Live computation only happens:
- In TransferPortal simulator (what-if; editable inputs)
- For agent views / no impersonation (no team-scoped row exists)
- For pitchers (until pitcher precompute is built)

### Diagnostic note

A `console.log("[TB target-add stored row]", {...})` was left in `addPlayerFromTargetSearch` for one round of verification. Once Peyton or Trevor confirms Hairston shows 0.345 in TB, remove that log line.

### Commits in this PR

- `3c8063b` — TeamBuilder target-add: use stored precomputed row instead of re-deriving
- `cf7b7c0` — TeamBuilder target-search: include customer_team_id in joined predictions
- `9a2c2e5` — TB target-add: temp diagnostic for precompute fast path
- `5783629` — TB target-add: explicit stored-row fetch, block live compute when team set
- `d1e2d9f` — TB simulateTransferProjection: short-circuit when team-scoped row exists

---

## Template for future entries

```
## YYYY-MM-DD — <step name>

### Migration applied
**File:** ...
**Command:** ...
**Envs:** staging | prod

### Verification queries run
```sql
...
```

### Code changes
- file: change summary
- file: change summary

### What this enables
- ...

### Rollback plan
```sql
...
```
```
