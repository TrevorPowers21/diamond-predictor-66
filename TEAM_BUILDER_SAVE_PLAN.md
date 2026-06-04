# Team Builder — Save Architecture & UX Plan
_For review with Trevor — 2026-06-04_

---

## Background

Today Team Builder has a "Save Build" button that coaches frequently forget to press. Changes are lost on navigation. The `dirty` flag tracks unsaved changes but nothing surfaces it visually. This plan proposes rebuilding the save architecture from the ground up alongside a performance overhaul.

---

## The Core Architecture Change (Context)

Today Team Builder re-fetches and re-computes everything from `player_predictions` on every load:
- 50-player live prediction query (~1-2s)
- Pitching master: 5,731 rows, 13 seconds, sequential pages
- Render flicker as each query settles

**Proposed: Store a snapshot of computed values directly on `team_build_players`**

At save time, capture each player's base precomputed stats (slash line, oWAR, market value, pitcher rates) into a `player_snapshot JSONB` column. On load, read the snapshot — no `player_predictions` queries, no pitching master. One DB read, one render, correct numbers.

The two coach adjustment knobs (depth role, dev aggressiveness) still apply as instant client-side math on top of the stored base values. Same overlay logic as today, just has a reliable fast base.

**Precompute keeps snapshots fresh:** After the precompute pipeline runs for a team, it UPDATEs the `player_snapshot` for every player in every active build for that team. Coach knob settings are untouched. Coaches see fresh numbers next load without doing anything.

---

## The Save UX Decision

### Option A — Autosave with debounce _(recommended)_

Debounce of 2-3 seconds after the last change. Saves silently to `team_build_players`. Header shows a status line.

**UI:**
```
Team Builder                          [VIEWING AS Arkansas ▾]
                          Saved · 2 min ago
```

States:
- `Saved · 2 min ago` — clean, no unsaved changes
- `Saving...` — debounce fired, write in progress  
- `Unsaved changes` — during the debounce window (2-3s after last action)
- `Save failed · Retry` — network error

**What triggers a save:**
- Adding a player
- Removing a player
- Changing depth role
- Changing dev aggressiveness
- Changing NIL value override
- Changing position slot
- Changing roster status (returner → leaving)

**Pros:**
- Zero mental overhead for coaches
- No lost work on tab close or navigation
- Industry standard — coaches already expect this from every tool they use
- With the snapshot architecture, saves are cheap writes, not expensive re-computes

**Cons:**
- Multiple coaches editing the same build simultaneously → last write wins
  - Manageable: add `Last saved by [name]` to the status line to surface conflicts
  - In practice: most schools have one primary recruiting coordinator on the build at a time
- Experimental changes get saved automatically (coach tries a scenario, walks away, it's saved)
  - Manageable: "Duplicate Build" feature lets coaches experiment on a copy

---

### Option B — Explicit Save with dirty indicator

Keep a manual save action but make the unsaved state unmistakably obvious.

**UI — Clean state:**
```
[Save Build]   (outline button, subdued)
```

**UI — Dirty state:**
```
[Save Changes]   ● Unsaved changes     (solid gold button + label)
```

The save button goes from outline/ghost to solid gold (`#D4AF37`) when there are unsaved changes. Small `● Unsaved changes` text appears beside it.

**Pros:**
- Coaches control what gets committed — good for scenario-building
- No concurrency risk between coaches on the same build
- Simpler to implement
- Clear "checkpoint" model — a saved build is intentional

**Cons:**
- Coaches forget to press save (this is the bug we're trying to fix)
- Requires more coaching/onboarding
- Still loses work on accidental navigation

---

### Option C — Autosave + Named Versions _(future state)_

Autosave the working state continuously. Additionally allow coaches to create named snapshots: "Pre-Portal Window", "Spring Visit List", "Final Board".

This is the Figma model — autosave keeps you current, named versions let you checkpoint intentional moments.

Not in scope for this implementation. Worth building once the base autosave is in place.

---

## Trevor's Questions to Answer

1. **Autosave vs explicit save** — Do coaches at partner schools expect to control when changes commit? Or would they prefer Google Docs behavior?

2. **Multi-coach concurrency** — Do multiple coaches from the same school regularly edit the same build at the same time? If yes, last-write-wins is a problem and we need to decide how to handle it (optimistic locking, merge, or just surface the conflict).

3. **Experimental builds** — Do coaches want to try scenarios without committing? If yes, autosave needs a "Duplicate Build" escape hatch before it launches.

4. **Build naming/versioning** — Is the current single-build-per-team model right, or do schools want to maintain multiple named builds? (Spring board vs Fall board, etc.)

---

## Implementation Plan

### Phase 1 — Schema (1 migration)

```sql
-- Add snapshot column to team_build_players
ALTER TABLE team_build_players
  ADD COLUMN IF NOT EXISTS player_snapshot JSONB;

-- Index for precompute update query
CREATE INDEX IF NOT EXISTS idx_tbp_player_id
  ON team_build_players(player_id);
```

Snapshot shape per player:
```json
{
  "p_avg": 0.323, "p_obp": 0.435, "p_slg": 0.685,
  "p_wrc_plus": 148, "o_war": 2.07, "market_value": 101004,
  "hitter_depth_role": "everyday_starter",
  "p_rv_plus": 118, "p_era": 3.82, "p_fip": 3.91,
  "p_whip": 1.21, "p_k9": 10.4, "p_bb9": 3.1,
  "p_war": 1.27, "variant": "precomputed",
  "snapshot_at": "2026-06-04T10:00:00Z"
}
```

---

### Phase 2 — Save path

`serializeBuildPlayerMeta` (already handles depth_role, dev_aggressiveness) gets extended to also write `player_snapshot` to the row.

At save time, for each player:
1. Read `shown` from `playerProjection` (the base precomputed row, before overlay)
2. Write relevant fields into `player_snapshot`
3. Write `depth_role` and `dev_aggressiveness` into `production_notes` (already done)

No overlay math in the snapshot — store base values only so precompute can safely overwrite them.

---

### Phase 3 — Load path

`useLoadBuild` reads `player_snapshot` from `team_build_players` and uses it as `p.prediction`.

**Queries eliminated on load:**
- `liveTargetPredictions` — gone (data in snapshot)
- Nested `player_predictions` join in returners query — simplified
- Pitching master on page load — deferred until Pitching tab is opened

**Fallback:** If `player_snapshot` is null (pre-migration build, or newly added player not yet saved), fetch from `player_predictions` for just that player. One targeted query, not 50.

---

### Phase 4 — Precompute pipeline update

In `process-precompute-jobs` Edge Function, after writing new rows to `player_predictions`:

```sql
UPDATE team_build_players tbp
SET player_snapshot = jsonb_build_object(
    'p_avg', pp.p_avg,
    'p_obp', pp.p_obp,
    'p_slg', pp.p_slg,
    'p_wrc_plus', pp.p_wrc_plus,
    'o_war', pp.o_war,
    'market_value', pp.market_value,
    'hitter_depth_role', pp.hitter_depth_role,
    'p_rv_plus', pp.p_rv_plus,
    'p_era', pp.p_era,
    'p_whip', pp.p_whip,
    'p_k9', pp.p_k9,
    'p_bb9', pp.p_bb9,
    'p_hr9', pp.p_hr9,
    'p_war', pp.p_war,
    'variant', pp.variant,
    'snapshot_at', now()
)
FROM player_predictions pp
JOIN builds b ON b.id = tbp.build_id
WHERE tbp.player_id = pp.player_id
  AND pp.customer_team_id = :team_id
  AND pp.season = 2026
  AND pp.variant = 'precomputed'
  AND pp.status = 'active';
```

Coach's `depth_role` and `dev_aggressiveness` in `production_notes` are untouched. Only the base stats update.

---

### Phase 5 — Migrate existing builds

Re-run `rerun_all_teams_precompute.ts` for all 10 teams. Phase 4 runs as part of each job. All existing builds get backfilled with current snapshots automatically. No separate migration script.

---

### Phase 6 — Autosave UI (if chosen)

- Debounce helper (2500ms) fires after any `updatePlayer`, `addPlayer`, `removePlayer`
- Status line in header: `Saved · X min ago` / `Saving...` / `Unsaved changes`
- On save success: update `lastSavedAt` state, clear `dirty` flag
- On save failure: show `Save failed · Retry` with manual retry button

**OR** Explicit save with dirty indicator (Option B above) — same `dirty` flag, different UI treatment.

---

### Phase 7 — DB indexes

```sql
-- player_predictions: fast lookup for newly added players + precompute UPDATE
CREATE INDEX IF NOT EXISTS idx_pp_player_scope
  ON player_predictions(player_id, season, variant, customer_team_id)
  WHERE status = 'active';

-- team_build_players: build load + precompute UPDATE
CREATE INDEX IF NOT EXISTS idx_tbp_build_id
  ON team_build_players(build_id);

-- Pitching master: IP threshold filter
CREATE INDEX IF NOT EXISTS idx_pitching_master_season_ip
  ON pitching_master(season, "IP");
```

---

## Expected Load Time After This Work

| Today | After |
|-------|-------|
| 13s pitching master on every load | Deferred — loads only when Pitching tab opened |
| 50-player live prediction query (1-2s) | Eliminated — snapshot on build row |
| Render flicker 2-3 times | Single render — one DB read |
| **Total perceived load: ~15s** | **Target: <1s** |
