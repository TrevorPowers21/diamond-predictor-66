# Team Builder — Default Build & Data Architecture
**Date:** 2026-06-09  
**Branch:** feature/team-builder-ux  
**Status:** Approved for implementation

---

## System Architecture Overview

```
Data Source → Raw Data Tables → Projection Tables → App / UI
```

| Layer | What it is | Current state |
|---|---|---|
| **Data Source** | TruMedia CSVs (primary). Future: fall/practice data, lab partner data, APIs, JSON | TruMedia 2022–2026 actuals |
| **Raw Data Tables** | Hitter Master, Pitching Master — store actuals by season and data period | Ingestion via CSV import pipeline |
| **Projection Tables** | `player_predictions` — computed projections per player per team | 2026 actuals → 2027 projections |
| **App / UI** | Team Builder, Dashboard, Player Profile — reads from Projection Tables filtered by who's using the app | Current |

---

## Academic Year — First-Class Concept

Raw data tables need an explicit `academic_year` field. This is distinct from `Season`
(game season) because the same table will store regular season actuals, fall practice
data, spring data, and lab data — all of which must be attributed to the correct
academic year regardless of when they were imported.

**Natural boundary:** ~Aug 15 of a given year marks the start of a new academic year.
Data from that point forward belongs to the next academic year
(e.g., fall 2026 practice data = academic year 2027).

**Historical imports are fully supported.** If you import 2024 fall practice data
today, it belongs to academic year 2025, not 2027. The import pipeline requires an
explicit `academic_year` value; it suggests the current academic year as the default
but always allows override.

**New raw data columns needed (additive migrations):**
- `academic_year INTEGER` — which academic year this row belongs to
- `data_period TEXT` — `regular_season` | `fall` | `spring` | `practice` | `lab`

Backfill for existing rows: `data_period = 'regular_season'`, `academic_year = Season`.

---

## Projection Table — Season Awareness

`player_predictions` already has `season` (the year being projected for). Two
additional fields make multi-period and multi-season projection possible:

- `source_academic_year INTEGER` — which academic year's data this projection is
  based on (currently implied, should be explicit)
- `source_data_period TEXT` — what data period mix was used (enables different
  weighting equations for fall vs regular season)

**Why this matters:**
- A 2027 roster player will eventually have both 2027 projections (current season)
  and 2028 projections (next season building from fall data). Both can coexist.
- Small fall sample → 100% data weight. Full regular season → 30% actual blended.
  The `source_data_period` field tells the projection engine which equation to use.
- Freshman with 50 fall ABs + 17 spring ABs — both contribute to 2027 projections
  at different weights. Multi-period blending is a future data science decision;
  the schema supports it today.

---

## Player Management Policy — Additive Only

**New data in = add or update. Never auto-remove.**

- New players in a CSV are inserted or their stats updated
- Existing players not present in a new CSV are **not removed** — they may be
  injured, shut down for the fall, or simply absent from that export
- Example: a pitcher who threw 120 innings and shut down for the fall retains
  their full 2026 data. Their row is not touched by a fall import.
- **New or unrecognized players** are flagged for coach review
- Player removal is a coach action only — enforced at the pipeline level,
  not just the UI

---

## Program ID + Year-Specific Team ID

Following TruMedia's model (raised by Trevor):

- **Program ID** — persistent entity, consistent forever (e.g., "Georgia Bulldogs").
  Maps to `customer_teams.id` today.
- **Year-specific Team ID** — academic-year instance of that program
  (e.g., "Georgia Bulldogs 2027"). Every `team_build` belongs to a specific
  year of a program.

**Practical implementation (no new table required now):**
- Add `academic_year INTEGER` to `team_builds`
- `customer_team_id` (program) + `academic_year` together define the year-specific
  team concept
- Default builds: `user_id` = the super admin who created the customer team
  (real user, NOT NULL, no schema change required)
- Full program/team table split can be formalized in a later migration when needed

---

## Default Build Architecture

### New DB Columns

```sql
-- team_builds
ALTER TABLE team_builds
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS academic_year INTEGER;
```

- `is_default = true` → system-managed, name locked, not directly editable
- `is_default = false` → coach build, fully editable
- `academic_year` → ties the build to a specific year of the program

---

### When a Customer Team Is Created

1. Super admin creates customer team in admin UI
2. Existing precompute trigger fires → writes `player_predictions`
   (precomputed transfer rows for all players at this team)
3. **NEW:** After precompute completes, system auto-creates the default build:
   - `name = "2027 Roster - Default"`, `is_default = true`, `academic_year = 2027`
   - All current returners inserted as `team_build_players` rows
   - `player_snapshot` populated immediately from predictions (not null)
4. Customer logs in → Team Builder loads their roster with stats. No action required.

**Default build creation also triggers when:**
- New academic year data is first ingested for a team (e.g., fall 2026 data arrives
  → system builds 2027 default alongside the existing 2026 default)
- Does NOT delete the existing default — old default is preserved

---

### Coach Experience

#### Opening Team Builder
| State | Behavior |
|---|---|
| Has coach builds | Load most recent coach build (by `updated_at`) |
| No coach builds, default exists | Load default build (read-only) |
| No builds at all | New build screen |

Stats show immediately from `player_snapshot` — no loading delay.

#### Making the First Change to the Default
Any change to the default (add target, change depth, change devAgg, copy it) triggers:

1. **Silent fork** — new `team_build` row created immediately (`is_default = false`,
   same `academic_year`, temp name `"Unsaved Build"`)
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

#### On a Named Coach Build
- All changes auto-save after 3–6 seconds
- On navigation away: pending saves flush immediately
- No prompts — it just saves

---

## Build Naming and Management

| Build Type | Rename | Delete |
|---|---|---|
| Default | ❌ Name is system-managed | ⚠️ *"You are removing the default roster for this team. This cannot be undone and will affect what coaches see when they first log in. Are you sure you want to proceed?"* |
| Coach build | ✅ Inline rename | *"Are you sure you want to delete [Build Name]?"* |

---

## Season Rollover

When new season data is loaded:

1. Existing `is_default = true` build → rename to `"[PRIOR YEAR] Roster - Default"`
   (preserved in build list as historical reference, `is_default` stays true so it
   still loads correctly if a coach has no coach builds for that year)
2. New `is_default = true` build created → `"[NEW YEAR] Roster - Default"` with
   updated returners + fresh snapshots, `academic_year = NEW_YEAR`
3. **Loading precedence:**
   - Coaches with existing coach builds → still load most recent coach build
   - Coaches with no coach builds → most recent default loads automatically
   - Default pinned at top of build selector, clearly labeled with year

---

## Production Migration Plan

### What Exists in Prod Today
- 10 active customer teams
- ~27 saved builds (Arkansas, Kansas, Penn State, Stetson, Vanderbilt, plus
  internal All-Americans demo builds)
- All builds are already meaningfully named
- No `is_default` or `academic_year` concepts yet

### Migration Steps (Zero Downtime, In Order)

**Step 1 — Schema migrations (additive)**
```sql
-- Team builds
ALTER TABLE team_builds
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS academic_year INTEGER;

-- Raw data tables
ALTER TABLE "Hitter Master"
  ADD COLUMN IF NOT EXISTS academic_year INTEGER,
  ADD COLUMN IF NOT EXISTS data_period TEXT DEFAULT 'regular_season';

ALTER TABLE "Pitching Master"
  ADD COLUMN IF NOT EXISTS academic_year INTEGER,
  ADD COLUMN IF NOT EXISTS data_period TEXT DEFAULT 'regular_season';

-- Projection table
ALTER TABLE player_predictions
  ADD COLUMN IF NOT EXISTS source_academic_year INTEGER,
  ADD COLUMN IF NOT EXISTS source_data_period TEXT DEFAULT 'regular_season';
```

Backfill: set `academic_year = "Season"` on Master tables, `source_academic_year = season - 1`
on player_predictions (since 2027 projections come from 2026 data).

**Step 2 — Create default builds for all 10 existing teams**
One-time admin script (run after deploy):
- For each customer team: read returners + predictions, insert `is_default = true`
  build named `"2027 Roster - Default"` with `academic_year = 2027`,
  populate `player_snapshot` for every player

**Step 3 — Coaches log in**
- Existing coach builds unchanged, most recent loads automatically
- New default appears in build selector as baseline reference
- No disruption to any existing work

---

## Staging Test Plan

Before deploying to prod:

1. Copy all prod customer teams + builds into staging (same IDs)
2. Map `user_id` on copied builds to staging admin account
3. Rerun precompute for any newly added staging teams
4. Test full coach journey:
   - [ ] New customer team → default build auto-created with real stats
   - [ ] Coach opens TB → most recent coach build loads
   - [ ] Coach with no builds → default loads with stats
   - [ ] Edit default → silent fork, timer starts, prompt fires
   - [ ] Discard → returns to default
   - [ ] Save → named coach build, auto-save takes over
   - [ ] Navigate away → pending saves flush, no data loss
   - [ ] New academic year data ingested → new default created, old preserved
   - [ ] Delete coach build → simple confirm
   - [ ] Delete default → strong warning

---

## Implementation Order

| # | Item | Notes |
|---|---|---|
| 1 | **Migrations** — `is_default`, `academic_year`, `data_period`, `source_academic_year` | All additive, safe |
| 2 | **Snapshot backfill** — fix null snapshots in staging | Null out bad snapshots → loadBuild falls to live predictions |
| 3 | **Default build auto-creation** — trigger on new customer team + new academic year data | Hook into post-precompute step |
| 4 | **One-time script** — create defaults for all 10 existing prod teams | Run at deploy time |
| 5 | **Fork-on-first-edit** — detect default → silent fork → unsaved build state | Core new behavior |
| 6 | **Inactivity timer + name prompt** — 30–60s after first change | Only fires once per new build |
| 7 | **Navigation-away save/discard** | Flush saves or delete unsaved build |
| 8 | **Season rollover logic** — preserve old default, create new one | Admin-triggered |
| 9 | **Build management UI** — delete confirmations, lock default name | Different UX per type |
| 10 | **Import pipeline update** — require `academic_year` + `data_period` on all CSV imports | Explicit override, no date inference |

---

## Open Questions for Trevor

1. **Who creates the default build — client-side script or Edge Function?**  
   The current precompute trigger fires a Supabase Edge Function. Should default build
   creation be an additional step in that same function, or a separate trigger
   that fires after precompute jobs complete?

2. **`player_snapshot` population at default build creation**  
   Snapshots are currently written client-side via `buildBuildPlayerRow`. For
   server-side default build creation we need equivalent server logic. The
   `refresh_build_snapshots_for_team` SQL function (migration `20260604180001`)
   already exists and handles this. Should we call it as the final step of
   default build creation?

3. **Fall data equation weighting**  
   Trevor noted that small fall samples may warrant 100% weight (vs. 30% blend for
   full regular season). Is this a hardcoded rule (fall = 100%, regular = blend)
   or should it be configurable per data period in `model_config`?
