# Team Builder — Default Build Deployment Plan

**Branch:** `feature/default-build-architecture`  
**Date:** 2026-06-28

---

## Background

A "default build" is a system-owned roster seeded from returners — exactly what a brand new team sees when they land on Team Builder for the first time. It lives in the database as `is_default = true`.

**Coaches with existing saved builds are not affected.** The auto-load logic explicitly prefers coach builds over defaults. The default only shows if a coach has no saved builds of their own.

**Why we need it for every team:** When a coach with an existing build wants to start fresh, the fork mechanism (silent copy of the default on first edit) requires a default to copy from. Without it, the new "first change triggers a save prompt" flow has nothing to fork.

---

## Phase 1 — Lock Down the Feature Branch

> Done locally. No deploys yet.

**1.1 — Commit all pending work**

All current feature branch changes are committed:
- Depth change revert bug fix (first edit no longer reverts)
- Build name prompt on first save
- Success confirmation modal after save
- Idle timer extended to 30 seconds
- `hasSavedOnce` state so subsequent saves are silent

**1.2 — TypeScript check + test suite**

```bash
./node_modules/.bin/tsc --noEmit
npm test
```

Both must pass before anything merges forward.

---

## Phase 2 — Prod Data Mirror to Staging

> Staging becomes an exact replica of prod so testing reflects real-world data.

**2.1 — Get prod service role key**

Supabase dashboard → prod project → Settings → API → `service_role` key.

**2.2 — Create `.env.production.local` in the project root**

```
SUPABASE_URL=https://trbvxuoliwrfowibatkm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<key from step 2.1>
```

**2.3 — Dump prod tables and restore to staging**

Tables to mirror: `customer_teams`, `team_builds`, `team_build_players`, `user_team_access`

> Note: This replaces staging's current versions of those tables with prod data.

---

## Phase 3 — Apply DB Migration to Prod

> Run before any code deploys. Safe to run while prod is live — all statements use `IF NOT EXISTS`.

**3.1 — Verify migration status**

In terminal from the project root:

```bash
npx supabase db query "SELECT column_name FROM information_schema.columns WHERE table_name = 'team_builds' AND column_name IN ('is_default','academic_year','player_snapshot');"
```

Expected result: 3 rows. If any are missing, the migration has not been applied.

**3.2 — Apply migration if needed**

File: `supabase/migrations/20260612000000_default_build_architecture.sql`

What it adds:
- `is_default BOOLEAN` on `team_builds`
- `academic_year INTEGER` on `team_builds`
- `player_snapshot JSONB` on `team_build_players`
- `user_id` made nullable on `team_builds` (required for system-owned defaults)
- Index on `(customer_team_id, is_default, updated_at DESC)` for fast default lookups

---

## Phase 4 — Seed Default Builds on Prod

> Run after the migration, before code deploys.

**4.1 — Dry-run first (read-only, no writes)**

In terminal from the project root:

```bash
npm run create-default-builds:prod
```

Review the output. Every team without a default will show as `BUILD`. Teams that already have one will show as `SKIP`.

**4.2 — Apply**

```bash
npm run create-default-builds:prod -- --apply
```

The script is idempotent — safe to re-run. Teams with existing coach builds are not modified. Only missing defaults are created.

---

## Phase 5 — Merge Feature Branch to Staging + Test

> Test against prod-replica data before touching prod code.

**5.1 — Merge `feature/default-build-architecture` → `staging`**

**5.2 — Test scenarios**

| # | Scenario | Expected Result |
|---|---|---|
| 1 | Coach with existing saved build logs in | Their saved build loads — NOT the default |
| 2 | Team with no coach builds logs in | Default (returners) loads |
| 3 | First change on a default build | Fork fires silently, name prompt appears on navigate or idle |
| 4 | Save with a name | Success modal appears, navigates correctly |
| 5 | Navigate away after saving once | Auto-saves silently, no prompt |
| 6 | Depth role change (first edit) | Persists — does not revert |
| 7 | Dev aggressiveness change (first edit) | Persists |
| 8 | Position change (first edit) | Persists |
| 9 | NIL value change (first edit) | Persists |

**5.3 — Sign off**

Scenarios 1 and 2 should be tested against real team data (existing prod coaches). Both should sign off before Phase 6.

---

## Phase 6 — Deploy to Prod

> Only after Phase 5 passes.

**6.1 — Merge `staging` → `main`**

Vercel auto-deploys on push to `main`.

**6.2 — Spot-check prod immediately after deploy**

- Login as a coach with an existing build → their build loads as before
- Login as a team that was just seeded with a default → default loads, first change triggers name prompt

---

## Rollback

If anything goes wrong after Phase 6:

- The DB migration is additive only — no data is altered or deleted. Rolling back the code is sufficient to restore prior behavior.
- Default builds in the DB are harmless to existing data — they are only loaded if no coach builds exist.
- A code rollback (revert `main` to prior commit) is the full rollback. No DB changes required.
