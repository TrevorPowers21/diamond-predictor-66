# Team Builder Architecture

**Last updated:** 2026-06-12  
**Status:** Active reference — update when architecture changes

---

## What Team Builder Is

The Team Builder is a roster-planning tool that lets coaches build, simulate, and save projected rosters. It combines system-precomputed player stats (pERA, pAVG, oWAR, etc.) with coach-defined roster decisions (depth, dev aggressiveness, pitcher role, position) to project team-level WAR and NIL budget.

---

## Data Flow Overview

```
New Raw Data (daily/weekly during season)
        │
        ▼
Player Pre-Computed Values (player_predictions table)
        │
        ▼
Stored Stats in Team Build Database (player_snapshot JSONB column)
        │                              ▲
        │             Coach Variable Changes
        │             (Dev Agg, Depth, Pitcher Role, Position)
        │             stored in position_slot + production_notes
        ▼
Team Builder renders stats + applies simulation
```

Two inputs flow into what gets stored in `team_build_players`:

1. **Player Pre-Computed Values** — base stats generated from raw data by the precompute pipeline. Applies to both Returners and Targets. Stored in `player_snapshot`.
2. **Coach Variable Changes** — decisions coaches make on top of base stats. Stored separately in `position_slot` and `production_notes`. Never overwritten by a precompute refresh.

---

## Database Schema

### `team_builds`
| Column | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `customer_team_id` | UUID | FK to customer_teams |
| `user_id` | UUID (nullable) | NULL for system default builds |
| `name` | TEXT | Build display name |
| `team` | TEXT | School name (matches players.team) |
| `total_budget` | NUMERIC | NIL budget cap for this build |
| `is_default` | BOOLEAN | True = system-owned default; False = coach build |
| `academic_year` | INTEGER | Year this build projects for (e.g. 2027) |
| `depth_assignments` | JSONB | Position → depth_order map |
| `depth_placeholders` | JSONB | Slot → freshman/transfer placeholder |
| `updated_at` | TIMESTAMPTZ | Used to sort builds (most recent first) |

### `team_build_players`
| Column | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `build_id` | UUID | FK to team_builds |
| `player_id` | UUID (nullable) | FK to players; NULL for local/fallback players |
| `source` | TEXT | `"returner"` or `"portal"` |
| `position_slot` | TEXT | Coach-assigned position or pitcher role (SP/RP/SS/CF etc.) |
| `depth_order` | INTEGER | Row rank within the depth chart |
| `nil_value` | NUMERIC | Per-player NIL value (coach-adjusted or computed) |
| `custom_name` | TEXT | Override name for unnamed/fallback slots |
| `player_snapshot` | JSONB | **Precomputed stats snapshot** — populated at build creation and refreshed by backfill |
| `production_notes` | JSONB | Packed coach variables + local player metadata |

---

## What Goes Where

### `player_snapshot` — precomputed stats only
Written by the system. Coaches never edit this directly.

```json
{
  "p_avg": 0.312, "p_obp": 0.401, "p_slg": 0.489, "p_wrc_plus": 118,
  "o_war": 1.8, "market_value": 62000, "hitter_depth_role": "cornerstone",
  "p_era": 3.94, "p_fip": 4.12, "p_whip": 1.28,
  "p_k9": 9.4, "p_bb9": 2.8, "p_hr9": 0.9,
  "p_rv_plus": 112, "p_war": 1.4,
  "pitcher_role": "SP", "pitcher_depth_role": "weekend_starter",
  "class_transition": "JR", "dev_aggressiveness": 0
}
```

### `position_slot` — coach's role/position decision
- Hitters: `"SS"`, `"CF"`, `"C"`, etc. (position change from default)
- Pitchers: `"SP"` or `"RP"` (starter vs reliever choice)
- This persists across precompute refreshes — a coach's decision to move a player to DH stays

### `production_notes` (packed JSON via `serializeBuildPlayerMeta`)
Contains all other coach variables:
- `depth_role` — Cornerstone / Everyday Starter / Weekend Starter / etc.
- `dev_aggressiveness` — coach's development override
- `class_transition` + override flag
- `dev_aggressiveness_overridden` flag
- `roster_status` — returner / leaving / target
- `transfer_snapshot` — for portal targets: their from-school stats
- `localPlayer` — name/position data for fallback/unnamed slots
- `projection_tier`, `nil_value_overridden`

### `total_budget` on `team_builds`
Stored (not calculated on load). The simulation uses it as the budget cap input. Simple arithmetic is performed in the UI using the stored value.

---

## Build Types

### Default Build (`is_default = true`, `user_id = NULL`)
- System-owned. One per team per academic year.
- Created/refreshed by `scripts/create-default-builds.ts` and the `process-precompute-jobs` Edge Function.
- Contains every returner for the team with `player_snapshot` populated.
- `position_slot` and depth derived fresh from prediction data each year — **never copied from prior year builds**.
- Coaches cannot permanently edit this build. Any change triggers a fork into a new coach build.

### Coach Build (`is_default = false`, `user_id` set)
- Coach-owned. Unlimited per team.
- Created by forking the default build on first save, or via "Save As".
- Coach variables (`position_slot`, `production_notes`) persist indefinitely.
- `player_snapshot` refreshed during annual season transition (via backfill script).
- Old coach builds are never deleted — they remain accessible in the build selector.

---

## Fork-on-First-Edit

When a coach makes any change while on a default build and then saves:

1. `forkFromDefaultIfNeeded()` silently creates a new coach build with `is_default = false`
2. All player rows are copied over (including current `player_snapshot` values)
3. The coach's save applies to the forked build, not the default
4. The default build remains untouched for other users

The fork uses the default build's `academic_year` so the new coach build is correctly tagged to the current season.

---

## Loading Flow (useLoadBuild)

When a build is loaded (`loadBuild(buildId)`):

1. Fetch `team_build_players` for the build
2. For each row, check `player_snapshot` — if it has at least one non-null stat (`p_avg`, `p_era`, `o_war`, or `p_war`), use it directly as `activePred` (**snapshot-first, zero extra queries**)
3. For rows without a valid snapshot, batch-fetch from `player_predictions` (`season = PROJECTION_SEASON`, `variant IN (regular, precomputed)`)
4. For the live prediction lookup, split rows by `pitcher_role`:
   - Pitcher players → prefer rows with `pitcher_role != null` (pitcher model rows have `p_era`)
   - Hitter players → prefer rows with `pitcher_role = null`
   - This prevents the hitter model row (which scores higher in the ranking function due to `p_avg` etc.) from winning and leaving `p_era = null`
5. Side-keyed maps (`${pid}|H` / `${pid}|P`) prevent TWP sides from overwriting each other

### Auto-Load on Team Selection
On initial team load (no draft restored, no `selectedBuildId`):
1. Prefer the most recent **coach build** for the current team
2. Fall back to the most recent **default build** if no coach builds exist
3. If neither exists: blank slate for auto-seed

---

## Season Transition

### Timeline
- **During season (e.g. 2026):** Predictions update regularly for PROJECTION_SEASON (2027). Both default and coach builds reference these.
- **New year cutover (2027 → 2028):** Run the create-default-builds script with the new `PROJECTION_SEASON = 2028`. New default builds are created fresh from 2027 actuals. Run the backfill script to refresh `player_snapshot` on all existing coach builds.

### What Happens to Old Coach Builds
- **Nothing** — they are preserved exactly as-is in the DB.
- Coaches can still access them via the build selector.
- Their `position_slot` and `production_notes` (coach variables) remain unchanged.
- Their `player_snapshot` gets refreshed with new season data by the backfill script.

### What Happens to `position_slot` on Season Transition
Default builds for the new year derive `position_slot` fresh from prediction data:
- Pitchers: `pred.pitcher_role` → "SP" or "RP" (from 2027 actuals)
- Hitters: `player.position` from the players table

**Old coach build `position_slot` overrides are NOT copied.** This is intentional — the new default starts clean so coaches can reassess roles with actual data.

### Season Transition UX

**Season Banner** (shown when the user has prior-year coach builds but no current-year coach build):
```
Team build is now 2028.
See previous builds here.        ← opens build selector
Save to create new build.         ← triggers Save As
```
- Dismisses per-session (sessionStorage)
- Permanently gone once a current-year coach build exists

**Dirty Default Prompt** (shown when a coach edits the default build):
- Appears after ~4-5 seconds of idle after a change, OR on navigating away
- Message: "You're editing the default roster. Save to create your 2028 build."
- Subtle — not a blocking modal
- Disappears automatically once the build is saved (fork happens, build is no longer default)

---

## Scripts

### `npm run create-default-builds [-- --apply] [--force] [--team <uuid>]`
Creates one `is_default=true` build per active customer team.
- Queries `player_predictions` at `season = PROJECTION_SEASON`
- Splits hitter/pitcher prediction rows correctly (pitcher_role-aware)
- `player_snapshot` populated for all rows
- `position_slot` derived fresh from prediction data
- Idempotent — skips teams that already have a current-year default unless `--force`
- `--force` replaces existing default builds
- Production: `npm run create-default-builds:prod -- --apply`

### `npm run backfill-build-snapshots [-- --apply] [--force] [--build <uuid>]`
Writes `player_snapshot` onto existing `team_build_players` rows.
- Run after season transition to refresh coach builds with new stats
- `--force` overwrites even rows that already have a snapshot (use for stale snapshot correction)
- Does NOT touch `position_slot` or `production_notes` — coach variables are preserved
- Production: `npm run backfill-build-snapshots:prod -- --apply --force`

### `npm run precompute-returner-pitchers [-- --apply]`
Creates global returner pitcher prediction rows (`model_type=returner, variant=regular, customer_team_id=NULL`) with pitcher stats (`p_era`, `p_fip`, etc.). Run before create-default-builds or backfill-build-snapshots if pitcher stats are missing.

---

## Annual Season Transition Runbook

When cutting over to a new season (e.g., 2027 → 2028):

1. Update `CURRENT_SEASON` in `src/lib/seasonConstants.ts` (triggers `PROJECTION_SEASON` bump)
2. Run precompute pipeline on prod to generate new prediction rows
3. `npm run precompute-returner-pitchers:prod -- --apply` (pitcher model rows)
4. `npm run create-default-builds:prod -- --apply` (new default builds from fresh actuals)
5. `npm run backfill-build-snapshots:prod -- --apply --force` (refresh all coach build snapshots)
6. Deploy frontend — season transition banner will appear automatically for coaches with prior-year builds

---

## Key Constants

| Constant | Value (2026) | File |
|---|---|---|
| `CURRENT_SEASON` | 2026 | `src/lib/seasonConstants.ts` |
| `PROJECTION_SEASON` | 2027 | `src/lib/seasonConstants.ts` |
| `PRIOR_SEASON` | 2025 | `src/lib/seasonConstants.ts` |

All prediction queries use `season = PROJECTION_SEASON`. The build's `academic_year` equals `PROJECTION_SEASON` at creation time.

---

## Key Files

| File | Purpose |
|---|---|
| `src/pages/TeamBuilder.tsx` | Main page: build selector, save/fork logic, banners, auto-load effect |
| `src/pages/team-builder/hooks/useLoadBuild.ts` | Build loading: snapshot-first, side-keyed prediction maps |
| `src/pages/team-builder/hooks/useTeamBuilderData.ts` | Data queries: builds list, returners, seed data |
| `src/pages/team-builder/hooks/useTeamBuilderSimulation.ts` | WAR/NIL simulation math |
| `src/pages/team-builder/helpers.ts` | `serializeBuildPlayerMeta`, `parseBuildPlayerMeta`, position helpers |
| `scripts/create-default-builds.ts` | Seeds default builds for all teams |
| `scripts/backfill-build-snapshots.ts` | Backfills player_snapshot on existing build rows |
| `scripts/precompute-returner-pitchers.ts` | Creates pitcher model prediction rows |
| `supabase/migrations/20260612000000_default_build_architecture.sql` | Migration: is_default, academic_year, player_snapshot columns |
