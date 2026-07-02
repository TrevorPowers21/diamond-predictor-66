# Deploy Runbook — Default Build + Target Consolidation

**Date:** 2026-07-02 · **Branch:** `feature/target-board-consolidation` (superset of `feature/default-build-architecture`)

> Exhaustive, verified-against-prod runbook. Every difference between prod and the
> branch is enumerated below, with the exact action to close it. Nothing is assumed —
> the schema state was probed object-by-object on prod (the Supabase migration
> tracker is empty because migrations here are applied via raw SQL, so object probes
> are the source of truth).

---

## A. Verified current state (probed 2026-07-02)

| Migration / object | Prod | Staging | Needed by deploy code? |
|---|---|---|---|
| `20260612` `team_builds.is_default` | ❌ **missing** | ✅ | **YES** |
| `20260612` `team_builds.academic_year` | ❌ **missing** | ✅ | **YES** |
| `20260612` `team_build_players.player_snapshot` | ✅ present (partial apply) | ✅ | yes (already there) |
| `20260612` index `idx_team_builds_default` | ❌ missing (comes w/ is_default) | ✅ | perf only |
| pitch_log base + computed cols (`19120000`,`19140000`) | ✅ | ✅ | n/a |
| aggregation tables (`20120000`) | ✅ | ✅ | n/a |
| hitter/pitcher by-pitch-type, xba_lookup, by_zone | ✅ | ✅ | n/a |
| all agg column-adds (`23140000`–`29100000`) | ✅ | ✅ | n/a |
| `29000000` **`parks` table** | ❌ missing (deferred) | — | **NO — no code reads `parks`** |

**Migration tracker:** `supabase_migrations.schema_migrations` returned null for these
versions → migrations were applied via `supabase db query --linked --file`, not the CLI
tracker. Do NOT rely on the tracker; rely on object existence.

**Prod is pristine this session** — 14 customer_teams, 148 target_board rows, unchanged.
Every prod command run was read-only or dry-run. All writes went to **staging only**.

---

## B. The complete diff — everything different + everything to add

### Schema (prod is missing exactly this)
1. `team_builds.is_default BOOLEAN NOT NULL DEFAULT false`
2. `team_builds.academic_year INTEGER` (+ backfill from build name)
3. index `idx_team_builds_default`
4. `team_builds.user_id` → nullable (`DROP NOT NULL`)

→ **All four come from ONE migration:** `20260612000000_default_build_architecture.sql`.
It is `ADD COLUMN IF NOT EXISTS`, so it adds the 4 missing pieces and **skips
`player_snapshot`** (already present). Nothing else schema-wise changes.

### NOT applied, and NOT needed
- `20260629000000_parks_dimensions.sql` (parks table) — deferred park-aware HR feature.
  **No code references the `parks` table**, so it stays deferred. Do not apply.

### Data operations to run on prod (idempotent, dry-run first)
5. **Seed default builds:** `create-default-builds:prod` — inserts one `is_default` roster
   per team; only ever shown to teams with zero coach builds.
6. **Consolidate targets:** `migrate-targets:prod` — moves 130 per-build watchlist rows →
   universal `target_board` (18 net-new inserts), deletes the 130 redundant copies.
   Dry-run preview (2026-07-02): `130 → 95 distinct, 18 insert, 130 delete`.

### Code
7. Merge the branch (67 commits: default-build architecture + target consolidation + fixes)
   → `staging` → `main`. Vercel auto-deploys on `main`.

---

## C. Step-by-step deploy (ordered — each step gates the next)

### PRE-FLIGHT (read-only)
- [ ] `npm run audit-tb:prod` — capture the baseline (teams/builds/targets/overrides).
- [ ] Confirm with Peyton how `team_build_players.player_snapshot` got onto prod (a partial
      apply of `20260612`). Harmless — the migration is `IF NOT EXISTS` — but confirm no
      other partial state exists.
- [ ] (Optional, recommended) Run the before/after snapshot-verify to get a
      provable-non-destructive receipt.

### STEP 1 — Merge to staging
```bash
git checkout staging && git merge feature/target-board-consolidation
git push origin staging
```
- [ ] Verify staging build is green. (Behavior already validated on local dev :5175.)

### STEP 2 — Apply the schema migration to PROD
> ⚠️ HARD GATE: `db-migrate` uses `--linked`. Confirm the linked project is **PROD
> (trbvxuoliwrfowibatkm)** before running: `npx supabase projects list` (look for the ● linked marker).
```bash
npm run db-migrate -- supabase/migrations/20260612000000_default_build_architecture.sql
```
- [ ] **Verify (expect 3 rows):**
```bash
npx supabase db query "SELECT column_name FROM information_schema.columns WHERE table_name IN ('team_builds','team_build_players') AND column_name IN ('is_default','academic_year','player_snapshot');"
```
**Rollback:** additive only — nothing to roll back. Columns are inert until code uses them.

### STEP 3 — Seed default builds on PROD
```bash
npm run create-default-builds:prod              # DRY-RUN — review BUILD/SKIP list
npm run create-default-builds:prod -- --apply   # write
```
- [ ] Verify: default build count > 0, one per team without a coach build.
**Rollback:** delete rows where `is_default = true` — harmless, only loaded when a team has
no coach builds.

### STEP 4 — Deploy code (merge to main)
```bash
gh pr create --base main --head staging --title "Default build + target consolidation" --body "..."
# review, then merge → Vercel auto-deploys
```
- [ ] Smoke test prod: coach with existing build → their build loads (not default);
      team with no builds → default loads; target board consistent across a team's builds;
      sitting on a default build → no save prompt.
**Rollback:** revert `main` to prior commit (full code rollback; no DB changes required).

### STEP 5 — Consolidate targets on PROD (AFTER code is live)
> Must run after Step 4 — old code would re-freeze targets per-build.
```bash
npm run migrate-targets:prod                    # DRY-RUN — expect 130→95, 18 insert, 130 delete
npm run migrate-targets:prod -- --apply         # write
```
- [ ] Verify: each team's target board identical across its builds; on-roster players
      unchanged; `npm run audit-tb:prod` shows watchlist now on the universal board.
**Rollback:** additive to `target_board`; the deleted per-build rows were redundant shadows
of universal entries. If ever needed, reconstruct from `target_board`.

---

## D. What is explicitly NOT changing (reassurance)
- **Coach data untouched:** rosters, on-roster transfers, dev-agg (65 overrides), depth
  (898 rows / 21 depth charts), NIL/money, imported freshmen (106) — none are read or
  written by any step except their existing storage.
- **Pitch-log pipeline already live on prod** (15 migrations present) — merge is a no-op there.
- **`parks` stays deferred** — not applied, not needed.
- **Only deletes anywhere** = Step 5's 130 redundant watchlist shadows (data preserved).

## E. Open items before executing
1. Peyton confirms the prod `player_snapshot` origin (non-blocking).
2. Build/run the before/after snapshot-verify receipt around Steps 4→5.
