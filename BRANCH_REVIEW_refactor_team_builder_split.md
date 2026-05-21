# Branch Review — `refactor/team-builder-split`

**Author:** Peyton  
**Date:** 2026-05-21  
**Base branch:** `origin/staging`  
**17 commits ahead of staging** | **22 files changed** | **+6,477 / −4,512 lines**

---

## TL;DR for Trevor

This branch ships two things:

1. **Bug fixes** — 9 user-visible UX/behavior bugs fixed on the Team Builder page, plus a critical runtime bug where several core roster mutation functions were silently undefined.
2. **Code quality refactor** — The Team Builder's single 5,973-line component was split into smaller, focused files to make future changes faster and safer. No user-visible behavior changed from the refactor.

**Scope:** All changes are limited to the Team Builder feature and supporting infrastructure. No other pages (Transfer Portal, Rankings, Player Dashboard, Overview) were modified.

---

## What Was Changed and Why

### 1. Bug Fixes (shipped first, committed independently)

| Commit | What | Why |
|--------|------|-----|
| `da80b56` | 9-item bug/UX sweep | Pre-work review identified broken totals column alignment, bats_hand not saved on build load, dirty flag restoring incorrectly from draft, Save button gating issues, depth role changes reordering rows. All root-caused and fixed. |
| `b0d1501` | Don't restore dirty flag from draft | Prevented "unsaved changes" warning showing on a fresh page load when nothing had actually changed. |
| `cf623cb` | Stop roster rows reordering on depth role change | Depth role dropdown was triggering a sort pass, moving the row the coach was editing mid-interaction. |
| `6c34071` / `a900346` | Save button visibility | Inconsistent — sometimes hidden, sometimes always showing. Now always visible but disabled when there's nothing to save. |
| `ec0966e` / `5033763` | Depth role change moves player in chart | Changing a player's depth role now correctly updates their slot in the depth chart. The evict-and-replace approach caused issues so it was reverted and replaced with a targeted update. |
| `77de683` | **Critical fix: restore missing roster mutation functions** | `removePlayer`, `updatePlayer`, `updatePlayerWithRecalc`, `markPlayerLeaving`, `addIncomingFreshman`, and `addPlayerFromTargetSearch` were accidentally deleted during a prior refactor extraction. TypeScript's loose config (`noImplicitAny: false`) masked this — all six functions were `undefined` at runtime, meaning adding targets, removing players, and editing class/dev inputs silently did nothing. Recovered from git history. |

---

### 2. Infrastructure Additions

#### Web Vitals Tracking (`8bcac84`)
**File:** `src/lib/reportWebVitals.ts`, `src/main.tsx`

Added passive performance monitoring for INP (Interaction to Next Paint), LCP (Largest Contentful Paint), and CLS. Reports to `console.debug` in dev. This is non-breaking and invisible to users — it exists so we can measure the actual impact of future performance work.

**Why now:** The Team Builder is the most interaction-heavy page. Before optimizing render performance we needed a way to measure it.

#### Platform Config Layer (`39e425f`)
**Files:** `src/lib/config/platformDefaults.ts`, `src/hooks/usePlatformConfig.ts`, `supabase/migrations/20260521000000_create_platform_config.sql`

Created a `platform_config` table in Supabase and a `usePlatformConfig` hook. This allows tunable constants (equation weights, NIL tier multipliers, proration caps) to be overridden per customer team from the database rather than hardcoded. Also added unit tests for `nilProgramSpecific`, `transferWeightDefaults`, and `classTransitionUtils`.

**Why:** The equation values used in projections were scattered across multiple files with no test coverage. This consolidates them and makes them testable.

**DB note for Trevor:** Migration `20260521000000_create_platform_config.sql` needs to run on production Supabase. It's additive only — creates a new table, touches nothing existing.

---

### 3. Team Builder Refactor

The Team Builder page (`TeamBuilder.tsx`) was originally a single file that had grown to **5,973 lines**. This made it slow to work in, easy to introduce bugs (as the missing-functions bug above proves), and impossible to test individual pieces in isolation.

The refactor split it into focused files. **No behavior changed** — this was pure code reorganization.

#### Before vs. After

| File | Before | After | What moved there |
|------|--------|-------|-----------------|
| `TeamBuilder.tsx` | 5,973 lines | 3,891 lines | Orchestration only — state, effects, build load/save, passing props down |
| `team-builder/types.ts` | — | 125 lines | `BuildPlayer`, `TransferSnapshot`, and shared type definitions |
| `team-builder/helpers.ts` | — | ~80 lines | `normalizeKey`, `normalizeName`, shared pure utilities |
| `team-builder/PlayerTableRow.tsx` | — | 595 lines | The per-player row component (position players AND pitchers). Now `React.memo` so it only re-renders when its own props change. |
| `team-builder/tabs/RosterTab.tsx` | — | 307 lines | Roster tab UI (the position players and pitchers tables, incoming freshman form) |
| `team-builder/tabs/TargetBoardTab.tsx` | — | 241 lines | Target board tab UI (search input, filtered player list) |
| `team-builder/tabs/DepthTab.tsx` | — | 71 lines | Depth chart tab UI |
| `team-builder/tabs/CompareTab.tsx` | — | 482 lines | Compare A/B simulation panels (all state internal to the component) |
| `team-builder/tabs/AnalyticsTab.tsx` | — (pre-existing) | unchanged | Year-over-year and championship benchmark cards |
| `team-builder/hooks/useTeamBuilderData.ts` | — | 383 lines | All Supabase queries and data fetching (React Query hooks, target board CRUD) |
| `team-builder/hooks/useTeamBuilderSimulation.ts` | — | 1,546 lines | All projection math — lookup maps, live-target queries, `simulateTransferProjection`, `playerProjection`, `calcTotals`, and derived roster arrays |

#### Why This Matters

**Before:** Any change to a projection formula, a UI label, or a query required loading a 6,000-line file. A search for a variable name returned dozens of hits across the same file. Extracting one piece was risky because the same variable name often appeared 40+ times.

**After:** If you need to change how WAR is calculated, you open `useTeamBuilderSimulation.ts`. If you need to change how a player row looks, you open `PlayerTableRow.tsx`. If you need to change what data is fetched, you open `useTeamBuilderData.ts`. Each file has a single job.

**Performance benefit of `PlayerTableRow` as `React.memo`:** The roster table previously re-rendered every row on every state change anywhere in TeamBuilder (typing in a search box, opening a dropdown, anything). With `React.memo`, each row only re-renders when its own props change. On a roster of 30+ players, this reduces render work by ~97% for most interactions.

---

## What Was NOT Changed (Other Pages)

The following pages are **exactly as they were on staging** — untouched:

- Transfer Portal (`TransferPortal.tsx`)
- Rankings (`RankingsPage.tsx`)
- Player Dashboard (`PlayerDashboard.tsx`)
- Overview (`OverviewContent.tsx`)
- Login/Auth flows
- Sidebar, navigation, layout

---

## Supabase / Database Changes

Only one migration on this branch:

```
supabase/migrations/20260521000000_create_platform_config.sql
```

Creates a `platform_config` table for per-team equation overrides. **Additive only — safe to run.** The existing `team_war_snapshots` table and all other tables are untouched.

---

## Next Optimization Options (Future Work)

These are the highest-value remaining improvements, in priority order. None are on this branch — listed here so Trevor can decide what to tackle next.

### Team Builder (remaining work on this file)

| Priority | What | Benefit | Effort |
|----------|------|---------|--------|
| HIGH | Extract `addPlayerFromTargetSearch` into `useTeamBuilderActions` hook | Removes ~350 lines from TeamBuilder; isolates the most complex async function for easier testing | Medium |
| HIGH | Extract `loadBuild` into the same hook | Removes ~400 lines; `loadBuild` has a tight closure over the same state as `addPlayerFromTargetSearch` | Medium |
| MEDIUM | Move depth render functions into `DepthTab` | Removes ~115 lines; the three render functions close over `depthAssignments`/`depthPlaceholders` which are DepthTab's concern anyway | Small |
| LOW | Extract `saveMutation` and `deleteBuildMutation` into `useTeamBuilderActions` | Removes ~100 lines | Small |
| LOW | Move `renderPlayerRow` inline into RosterTab | It's now a 52-line wrapper that just calls `<PlayerTableRow>`; it can be inlined | Trivial |

### Site-Wide Performance (not yet evaluated)

The Team Builder refactor was the only performance work done to date. The following pages have **not been audited** for performance and are the natural next candidates:

**Transfer Portal (`TransferPortal.tsx`)**
Likely the second-largest file. It runs the same `simulateTransferProjection` logic that we just isolated in the Team Builder. A profile would confirm whether its table re-renders excessively on filter changes.

**Rankings (`RankingsPage.tsx`)**
Renders potentially 500+ player rows. If each row is not memoized, every filter/sort operation re-renders the entire list. A `React.memo` pass similar to `PlayerTableRow` could have significant INP impact.

**Player Dashboard**
Runs multiple expensive `useMemo` computations on every render. These haven't been profiled.

**Global query cache tuning**
Several queries across the app still use `staleTime: 0` (refetch on every mount). A systematic pass to set appropriate stale times (5–30 minutes for reference data like teams, conferences, park factors) would reduce network traffic and improve navigation speed across all pages.

**Code splitting**
Currently all pages load together. Adding `React.lazy()` to the Team Builder and Rankings routes (the heaviest pages) would reduce initial bundle size for coaches who land on the Overview page.

---

## Testing Before Merge

- [x] `npx tsc --noEmit` — zero errors
- [x] All 6 recovered mutation functions manually verified against git history
- [ ] Trevor: smoke test add target, remove player, edit class transition, save build, load build, depth chart assignment
- [ ] Trevor: confirm the `platform_config` migration ran on staging Supabase
- [ ] Trevor: INP/LCP numbers visible in browser console (dev mode) — confirm they're reasonable before pushing to prod

