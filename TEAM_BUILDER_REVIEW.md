# Team Builder — Pre-Work Review

**Branch:** `team-builder-fixes`
**Date:** 2026-05-20
**File under review:** `src/pages/TeamBuilder.tsx` (7,818 lines)

---

## Summary

Full audit of the Team Builder page combining a code review and user-reported issues. All items below are confirmed root-caused. Nothing has been changed yet — this document exists so the team can align on scope and priority before work begins.

---

## Bugs (Code Errors)

### B1 — Totals row is misaligned by one column

**Both tables (Position Players and Pitchers)**
The "Totals" label uses `colSpan={7}`, which spans 7 columns: Player, Status, Pos, Position Change, Dev Agg, Depth, AND the pAVG/pOBP/pSLG column. This pushes all totals data one column to the right:
- pAVG/pOBP/pSLG totals appear under the wRC+ header
- wRC+ totals appear under Market Value
- etc.

**Fix:** Change `colSpan={7}` to `colSpan={6}` in both tables.
**Lines:** 6327 (position table), 6388 (pitcher table)
**Effort:** Trivial (2-line change)

---

### B2 — `bats_hand` not set when loading a saved build

When loading a saved build via `loadBuild()`, the reconstructed player object at line 2248 does not include `bats_hand`. The auto-seed path at line 2346 does include it. Result: handedness-aware park factor calculations default to "switch/unknown" for all players in loaded builds, causing a small but systematic projection error.

**Fix:** Add `bats_hand: (pd as any).bats_hand ?? null` to the player object in `loadBuild`.
**Line:** 2248
**Effort:** Trivial (1-line change)

---

### B3 — `from_team_id` read from TransferSnapshot but not in the type

Line 1587 reads `p.transfer_snapshot.from_team_id` but the `TransferSnapshot` type (line 62) has no such field. It always evaluates to `null`, forcing pitcher target team resolution to fall back to name-matching even when a team ID would be available.

**Fix:** Either add `from_team_id` to the `TransferSnapshot` type and populate it, or remove the dead read.
**Lines:** 62 (type), 1587 (read)
**Effort:** Small

---

## User-Reported Issues (with Root Causes)

### U1 — Nothing shows on page load

**Symptom:** Page loads blank. Must click "New Build" or add a player to see data.

**Root cause:** When navigating away, the persist effect (line 2533) immediately writes an empty state to localStorage (`selectedTeam: "", rosterPlayers: []`) right after the draft restore effect clears state. On the next page load, this empty draft is found and restored, setting `restoredFromDraftRef.current = true`, which blocks the auto-load effect at line 2516. The page waits silently with no loading indicator while builds/returners queries are in-flight (1–3 seconds).

**Fix:**
1. Guard persist effect — only write when state is non-empty / outside the restore window
2. Add a loading placeholder so users know data is coming

**Lines:** 2516 (auto-load effect), 2533 (persist effect)
**Effort:** Small

---

### U2 — Slow page load and hesitation when clicking

**Root cause (3 compounding causes):**
1. `staleTime: 0` on the returners query (line 1794) — refetches on every page visit and every dependency change, triggering the full auto-seed pipeline repeatedly
2. The depth assignment effect (line 5238) runs on every single roster change AND calls `playerProjection()` (expensive transfer simulation) inside a loop for every player
3. `allPlayersForSearch` paginates ALL players on every mount with no cache TTL tuning

**Fix:**
1. Change `staleTime: 0` to `staleTime: 5 * 60 * 1000` on the returners query
2. Extract and memoize the depth assignment effect's expensive calls
3. Increase `staleTime` on `allPlayersForSearch` to match the 30-minute window of other queries

**Lines:** 1794 (staleTime), 5238 (depth effect)
**Effort:** Small–Medium

---

### U3 — Starters getting moved to bench when changes happen

**Root cause:** The corrective depth-role effect (line 2403) runs when `seasonUsage` loads while a saved build is active. It recomputes `depth_role` from current-season PA data and deletes `depthAssignments` for any player whose tier changed. This is correct for the initial load — but the depth assignment auto-fill effect (line 5238) then re-runs and re-assigns slots based on the new tiers, potentially overriding manual assignments the coach had made.

**Fix:** Before the corrective effect wipes `depthAssignments`, check if the player was in a manually-promoted slot (i.e., their assignment tier doesn't match their depth_role tier). Preserve those manual assignments.

**Lines:** 2403 (corrective effect), 5238 (auto-fill effect)
**Effort:** Medium

---

### U4 — No way to save Actual Value ($)

**Symptom:** The Actual Value input accepts typed values but they are lost on page refresh unless the user clicks "Save As."

**Root cause:** The `saveMutation` at line 2609 already supports updating an existing build (not just saving as new). But the UI header only exposes a "Save As" button, which always prompts for a new name. There is no plain "Save" button to update the currently-loaded build.

**Fix:** Add a "Save" button to the header that calls `saveMutation.mutate({})` (no `saveAs: true`). This will update the existing `selectedBuildId` build with the current roster including `nil_value` fields.

**Lines:** 2609 (saveMutation), 6082–6126 (header render)
**Effort:** Small

---

### U5 — Builds don't default to most recent

**Symptom:** On page load, the build dropdown shows "New Build" selected instead of the most recent saved build.

**Root cause:** The auto-load effect at line 2516 correctly targets `builds[0]` (sorted by `updated_at desc`), but it's blocked when `restoredFromDraftRef.current = true` — which is set whenever ANY localStorage draft is found, including empty ones. This is tied directly to the U1 empty-draft bug.

**Fix:** Resolves automatically once U1 (empty draft persistence) is fixed.

**Lines:** 2516
**Effort:** Resolved by U1 fix

---

### U6 — "Add Incoming Freshman" labeled "Coming soon" but works

The card header at line 6250 says "Coming soon" but `addIncomingFreshman()` is fully implemented and the button is wired up.

**Fix:** Remove the "Coming soon" label from the card title.
**Line:** 6250
**Effort:** Trivial

---

## Additional UX Issues (from Code Review)

### A1 — Compare tab shows "Coming soon" but full UI is implemented

The full Compare A/B UI (~250 lines) exists in `TabsContent value="compare-hidden"` which is never rendered (not in the TabsList). The visible Compare tab shows "Coming soon." This is dead code.

**Options:** Either surface it (add to TabsList) or delete it.
**Lines:** 6636–6889
**Effort:** Small (wire up) or trivial (delete)

### A2 — "Leaving" status removes player with no confirmation

Selecting "Leaving" from the status dropdown immediately removes the player from the roster (line 5774). Easy to mis-click.

**Fix:** Add a confirmation dialog before removal.
**Line:** 5774

### A3 — Dev Aggressiveness values have no labels

The dropdown shows `0.0`, `0.5`, `1.0` with no context. Coaches won't know what these mean.

**Fix:** Label as "Conservative (0)", "Moderate (0.5)", "Aggressive (1.0)".

---

## Structural Issue — 7,818-Line Single File

The entire Team Builder — state, 20+ queries, 5 tab contents, transfer projection simulation, pitcher calculation pipeline, CSV parsing, NIL math — lives in one file. This makes it:
- Slow to navigate (takes 10+ chunks to read in full)
- Hard to debug (one change can affect 50 things in scope)
- Hard to optimize (can't memoize across component boundaries)
- Requires matching changes in both TransferPortal and TeamBuilder whenever projection math changes (copy-paste duplication)

**Proposed structure:**
```
src/pages/team-builder/
  index.tsx                       ~500 lines  (state, effects, layout shell)
  PlayerRow.tsx                   ~400 lines  (renderPlayerRow extracted)
  hooks/
    useTeamBuilderData.ts         ~600 lines  (returners, builds, allPlayers queries)
    useTeamBuilderProjections.ts  ~900 lines  (simulateTransferProjection, playerProjection, calcTotals)
    useDepthChart.ts              ~300 lines  (depth assignment effect + helpers)
  tabs/
    RosterTab.tsx                 ~300 lines
    TargetBoardTab.tsx            ~250 lines
    DepthTab.tsx                  ~400 lines
    AnalyticsTab.tsx              ~300 lines
```

This is a **pure reorganization** — no logic changes. Goes from 1 file at 7,818 lines to 9 files averaging ~450 lines each. Should be done as its own isolated PR with zero behavior changes so it can be reviewed and merged cleanly.

---

## Priority Order

| # | Issue | Type | Effort |
|---|---|---|---|
| 1 | Nothing shows on load + empty draft bug (U1) | Bug | Small |
| 2 | Add "Save" button for Actual Value (U4) | UX | Small |
| 3 | `staleTime: 0` on returners query (U2) | Perf | Trivial |
| 4 | Starters moving to bench (U3) | Bug | Medium |
| 5 | Totals row misalignment (B1) | Bug | Trivial |
| 6 | `bats_hand` missing in loadBuild (B2) | Bug | Trivial |
| 7 | Builds default to most recent (U5) | Bug | Fixed by #1 |
| 8 | Remove "Coming soon" on Incoming Freshman (U6) | UX | Trivial |
| 9 | Compare tab — wire up or delete (A1) | UX | Small |
| 10 | "Leaving" status confirmation dialog (A2) | UX | Small |
| 11 | Dev Aggressiveness labels (A3) | UX | Trivial |
| 12 | Debounce recalculatePredictionById | Perf | Small |
| 13 | File split into tab components (own PR) | Structural | Large |

---

## What's NOT Changing

- Projection math (transfer simulation, pWAR, oWAR, NIL equations) — no logic changes
- Supabase schema — no new migrations needed for any of the above
- RLS / multi-tenant scoping — already correct
- `customer_team_equation_overrides` integration (Trevor's `3efe4eb`) — merged and working

---

*Generated 2026-05-20 on branch `team-builder-fixes` (base: staging `3efe4eb`)*
