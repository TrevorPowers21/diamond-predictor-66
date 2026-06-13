# Review: TWP Prediction Split — Two-Way Player Loading

**Branch:** staging  
**Date:** 2026-06-13  
**Needs review from:** Trevor (worked on TWP logic)

---

## What Changed and Why

### Background

The default build architecture work introduced a pitcher/hitter split in the prediction
lookup for `useLoadBuild`. Previously, a flat `predictionMap` keyed by `player_id` was
used — one entry per player, shared by both the hitter and pitcher rows of a TWP.

The split was needed because `scorePredictionLikeDashboard` awards bonus points for
populated hitter stats (`p_avg`, `p_obp`, etc.). For pure pitchers, this caused the
hitter-model row to outscore the pitcher-model row, leaving `p_era = null` on every
pitcher slot.

### The Split (`useLoadBuild.ts`)

Prediction rows are now split before the `pickBest` call:

```ts
const hitterRows = rows.filter((r: any) => r.pitcher_role == null);
const pitcherRows = rows.filter((r: any) => r.pitcher_role != null);
```

For non-TWP players, side is inferred from `player.position` and the correct candidate
set is used. For TWPs, each side gets its own entry in the side-keyed map
(`${pid}|H` / `${pid}|P`).

### The TWP Regression (and Fix)

When a TWP's prediction data only has a single combined row with `pitcher_role != null`
(the pitcher-model row that also carries hitter stats like `p_avg`), the old code left
`hitterRows` empty and `hPick` came back null — so the hitter side got no prediction
and displayed dashes.

**Fix applied:**

```ts
// Before
const hPick = pickBest(hitterRows);
const pPick = pickBest(pitcherRows);

// After — falls back to all rows when a dedicated side-specific row doesn't exist
const hPick = pickBest(hitterRows.length > 0 ? hitterRows : rows);
const pPick = pickBest(pitcherRows.length > 0 ? pitcherRows : rows);
```

This mirrors the fallback already used for non-TWP players and handles both data shapes:
- **Two separate rows** (hitter-model + pitcher-model): each side gets its own row ✓
- **Single combined row** (`pitcher_role != null` with both stat sets): both sides use
  the same row, same as the previous flat-map behavior ✓

### What Trevor Should Verify

1. **Data shape for TWPs in prod:** Do prod TWP players always have two separate prediction
   rows (one with `pitcher_role = null`, one with `pitcher_role != null`)? If so, the
   fallback path never runs on prod and behavior is identical. If some TWPs have only
   one combined row, the fallback is now handling them correctly on staging.

2. **Snapshot side-keying:** The `player_snapshot` JSONB on `team_build_players` is now
   keyed by side — the TWP hitter row stores a hitter-facing snapshot, the TWP pitcher
   row stores a pitcher-facing snapshot. The backfill script (`npm run backfill-build-snapshots`)
   was updated with the same TWP fallback logic. If Trevor's TWP logic expects both sides
   in a single snapshot object, that would be a conflict to resolve.

3. **`scorePredictionLikeDashboard` for TWPs:** The hitter-model row scores higher due to
   populated `p_avg` fields. For a TWP with two rows, the H side will always pick the
   hitter-model row and the P side will always pick the pitcher-model row — which is
   correct. Confirm this matches what the TWP-specific prediction flow produces.

---

## Files Changed

| File | Change |
|---|---|
| `src/pages/team-builder/hooks/useLoadBuild.ts` | TWP fallback: `hitterRows.length > 0 ? hitterRows : rows` |
| `scripts/backfill-build-snapshots.ts` | Same fallback for TWP hitter rows in the backfill |
