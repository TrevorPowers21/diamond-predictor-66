# Team Builder — Default Build Architecture
**Date:** 2026-06-09  
**Branch:** feature/team-builder-ux  
**Status:** Approved for implementation

---

## Overview

Every customer team gets a system-managed **default build** — a read-only baseline
roster with predicted values populated at onboarding. Coaches work on **coach builds**
(forks of the default or copies of prior builds). The default is never edited directly.

---

## Database Change

**New column:** `team_builds.is_default BOOLEAN DEFAULT false`

- `true` → system-managed default, name locked, cannot be edited directly
- `false` → coach build, fully editable
- Migration is additive — all existing builds default to `false`, nothing breaks

---

## Admin Flow — New Customer Team Created

1. Super admin creates customer team in admin UI
2. Existing precompute trigger fires → writes `player_predictions`
   (precomputed transfer rows for all players at this team)
3. **NEW:** After precompute completes, system auto-creates the default build:
   - `name = "2027 Roster - Default"`, `is_default = true`
   - All current returners inserted as `team_build_players` rows
   - `player_snapshot` populated immediately from predictions (not null)
4. Customer logs in → Team Builder loads their roster with stats. No action required.

---

## Coach Experience

### Opening Team Builder
| State | Behavior |
|---|---|
| Has coach builds | Load most recent coach build (by `updated_at`) |
| No coach builds, default exists | Load default build (read-only) |
| No builds at all | New build screen |

Stats show immediately from `player_snapshot` — no loading delay.

### Making the First Change to the Default
Any change to the default (add target, change depth, change devAgg, copy it) triggers:

1. **Silent fork** — new `team_build` row created immediately (`is_default = false`,
   temp name `"Unsaved Build"`)
2. **Auto-save starts immediately** — all changes persist to DB, no data is ever lost
3. **Inactivity timer starts** (30–60 seconds from last change)
4. **Prompt fires when:** timer expires OR coach navigates away from the page

> *"Give this build a name to keep it."*  
> `[Build name field]` → **Save** | **Discard**

- **Save with name:** build renamed, becomes permanent coach build
- **Save without name:** auto-named (e.g. *"Georgia Build — Jun 9"*), never loses data
- **Discard:** build deleted from DB, returns to default view

5. After named and saved: coach is on a coach build. Timer gone. Auto-save handles
   all future changes silently (no more prompts).

### On a Named Coach Build
- All changes auto-save after 3–6 seconds
- On navigation away: pending saves flush immediately
- No prompts — it just saves

---

## Build Naming and Management

| Build Type | Rename | Delete |
|---|---|---|
| Default | ❌ Name is system-managed | Confirm: *"You are removing the default roster for this team. This cannot be undone and will affect what coaches see when they first log in."* |
| Coach build | ✅ Inline rename | Confirm: *"Are you sure you want to delete [Build Name]?"* |

---

## Season Rollover

When new season data is loaded and the default is refreshed:

1. Existing `is_default = true` build → rename to `"[PRIOR YEAR] Roster - Default"`
   (preserved in build list as historical reference)
2. New `is_default = true` build created → `"[NEW YEAR] Roster - Default"` with
   updated returners + fresh snapshots
3. **Loading precedence:**
   - Coaches with existing coach builds → still load most recent coach build (no disruption)
   - Coaches with no coach builds → new default loads automatically
   - Default is pinned at top of build selector, clearly labeled

---

## Production Migration Plan

### What Exists in Prod Today
- 10 active customer teams
- ~27 saved builds across those teams (Arkansas, Kansas, Penn State, Stetson,
  Vanderbilt, plus internal demo/All-Americans builds)
- All builds are already meaningfully named
- No `is_default` concept yet — all builds treated equally

### Migration Steps (Zero Downtime, In Order)

**Step 1 — Schema migration**
```sql
ALTER TABLE team_builds
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
```
Additive. All existing builds get `is_default = false`. Nothing breaks.

**Step 2 — Create default builds for all 10 existing teams**  
One-time admin script (run after deploy):
- For each of the 10 customer teams:
  - Read current returners + predictions
  - Insert `team_build` with `is_default = true`, `name = "2027 Roster - Default"`
  - Insert all `team_build_players` with `player_snapshot` populated from predictions

**Step 3 — Coaches log in**  
- See their existing coach builds unchanged (most recent loads automatically)
- New default appears in build selector as baseline reference
- No disruption to any existing work

---

## Staging Test Plan

Before deploying to prod:

1. Copy all prod customer teams + builds into staging (same IDs)
2. Map `user_id` on copied builds to staging admin account
3. Rerun precompute for newly added staging teams
4. Test the full coach journey end-to-end:
   - [ ] New customer team → default build auto-created with real stats
   - [ ] Coach opens TB → most recent build loads (not default)
   - [ ] Coach with no builds → default loads with stats
   - [ ] Edit default → silent fork, timer starts, prompt fires
   - [ ] Discard → returns to default
   - [ ] Save → named coach build, auto-save takes over
   - [ ] Navigate away → pending saves flush, no data loss
   - [ ] Season rollover → old default renamed, new default created
   - [ ] Delete coach build → simple confirm
   - [ ] Delete default → strong warning

---

## Implementation Order

| # | Item | Notes |
|---|---|---|
| 1 | **Migration** — add `is_default` column | Additive, safe |
| 2 | **Snapshot backfill** — fix null snapshots in staging | SQL: null out bad snapshots → loadBuild falls to live predictions |
| 3 | **Default build auto-creation** — trigger on new customer team | Hook into post-precompute step |
| 4 | **One-time script** — create defaults for all 10 existing prod teams | Run at deploy time |
| 5 | **Fork-on-first-edit** — detect default → silent fork → unsaved build state | Core new behavior |
| 6 | **Inactivity timer + name prompt** — 30–60s after first change | Only fires once per new build |
| 7 | **Navigation-away save/discard** | Flush saves or delete unsaved build |
| 8 | **Season rollover logic** — rename old default, create new one | Admin-triggered |
| 9 | **Build management UI** — delete confirmations, lock default name | Different UX per build type |

---

## Open Questions for Trevor

1. **Who creates the default build — client-side script or Edge Function?**  
   The current precompute trigger fires a Supabase Edge Function. Should default build
   creation be an additional step in that same function, or a separate trigger?

2. **`user_id` on default builds** — the `team_builds.user_id` column is NOT NULL today.
   Default builds are system-created, not tied to a specific user. Options:
   - Make `user_id` nullable (schema change)
   - Use a system/service-role user ID as the owner
   - Use the super admin's user ID who created the customer team

3. **`player_snapshot` population at default build creation** — currently snapshots
   are written client-side via `buildBuildPlayerRow`. For server-side default build
   creation, we need equivalent logic on the server. The `refresh_build_snapshots_for_team`
   SQL function (already written, migration `20260604180001`) handles this.
   Should we call that function as the final step of default build creation?

