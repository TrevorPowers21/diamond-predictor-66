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
