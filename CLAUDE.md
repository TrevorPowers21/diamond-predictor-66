# RSTR IQ — Development Source of Truth

## Design Authority

**The UI/UX Pro Max design system plugin and Magic/Stitch MCP tools are the primary decision makers for all design choices.** Run the design system search before making visual decisions:

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system -p "RSTR IQ"
```

Persisted design system: `design-system/rstr-iq/MASTER.md`

When the plugin's recommendations conflict with rules below, **the plugin wins**. The rules below are guardrails, not overrides.

## Design Guardrails (Global)

- No loading spinners, sliding cursors, skeleton loaders, or animated placeholder effects anywhere
- Brand colors: Gold accent `#D4AF37`, sidebar navy `#070e1f`, darker gold `#A08820`
- Background and card colors should be determined by the design system plugin based on light/dark mode decision
- Font: Oswald for headings/labels in branded areas (banner, sidebar). Body font defers to design system recommendation (currently Inter)
- No unnecessary buttons, subtitles, or decorative UI that isn't actively functional
- Status badges: IN PORTAL = green, WATCHING = gold
- Avatar circles: gold initials on dark gold background
- All interactive elements need `cursor-pointer` and hover transitions (150-300ms)
- Respect `prefers-reduced-motion` on all animations
- Test responsive at 375px, 768px, 1024px, 1440px

---

## Overview Page (OverviewContent.tsx)

Build the following sections in order:

### Morning Briefing Strip
- Full width, `#0D1B3E` bg, 3px left border `#D4AF37`
- Label: `TODAY'S BRIEFING` in tiny spaced gold caps
- Inline dot-separated items: portal activity, NIL updates, filter matches, leaderboard refreshes

### Two Column Grid (1.2fr / 0.8fr)
- **Left:** Top Target hero card — player name, school, position, year, bats, stat boxes (pAVG/pOPS/pISO/oWAR), NIL value, national rank
- **Right:** Target Board — 5 player rows with avatar, name, school/position, NIL value, status badge

### Full Width Activity Feed Card
- Gold dot + feed text + timestamp per item
- Thin dividers, no buttons

---

## Rankings Page (RankingsPage.tsx)

Build a dedicated rankings page at route `/rankings`:

- Full national leaderboards by stat category: pAVG, pOBP, pSLG, pOPS, pISO, pWRC+, oWAR, NIL value
- Tab or dropdown to switch between stat categories
- Each row shows: national rank number, player name, school, position, class, stat value
- Filter controls: position, conference, class year
- National rank number displayed prominently next to each player row in gold
- Sortable columns
- No skeleton loaders or animated placeholders

---

## Scouting Grade Sorting

Add scouting grade as a sortable/filterable field across all player-facing pages:

- Grades on a 20-80 scale (standard baseball scouting scale)
- Sortable on Rankings page, Transfer Portal page, and Player Dashboard
- Display grade badge next to player name where relevant
- Allow filtering by minimum scouting grade threshold

---

## AI Prompt Query Interface (Natural Language Roster Search)

Build a natural language query bar component (`PromptSearch.tsx`) for the Transfer Portal page:

- Text input where coaches type a natural language request, for example:
  - "We don't mind players who chase -- prioritize high avg exit velocity and barrel%"
  - "Show me left-handed pitchers with K/9 above 9 and BB/9 below 3 from power conferences"
- On submit, parse the prompt and translate it into weighted filter/sort criteria against the player database
- Weight the results by matching the described profile — do not hard filter, soft rank instead
- Display results as a ranked list with a match score or fit rating shown per player
- Include a brief plain-English explanation of why each top result matches the prompt
- Store recent prompts in local state for quick re-use

---

## Internal Equation Builder

Build an Equation Builder tool (`EquationBuilder.tsx`) accessible from the sidebar or settings:

- Coaches can define custom composite metrics using existing stat fields
- Example: `Custom Power Score = (ISO x 0.4) + (Barrel% x 0.35) + (Exit Velo x 0.25)`
- UI: drag-and-drop or dropdown stat selector, weight sliders per stat, formula preview
- Save named equations to local state (persist to Supabase user profile later)
- Apply saved equations as a sort column on Rankings and Transfer Portal pages
- Show the custom metric value per player when equation is active

---

## Transfer Portal Tracker

Track when players enter the transfer portal and commit to new schools:

- **Portal entry tracking:** date entered portal, source school, conference, position, class year
- **Commitment tracking:** date committed, destination school, destination conference
- **Status field on players:** NOT IN PORTAL / IN PORTAL / COMMITTED
- **Timeline view:** show portal activity feed — who entered, who committed, when
- **Filters:** by conference, position, date range, status
- **Alerts/notifications:** surface new portal entries and commitments in the Morning Briefing strip and Activity Feed
- **Integration:** Transfer Portal simulator should auto-detect portal players and pre-fill "from" school data
- **Data source:** manual entry via admin or future API integration with portal tracking services

---

## Team Builder — Program Analytics + WAR Benchmarks (shipped 2026-05-12)

The Team Builder Analytics tab includes:

### Year-Over-Year Compare card
- Compares current 2026 build to the customer team's prior-year (2025) actual WAR
- 4 cells: Total WAR, Lineup oWAR (top 9 hitters), Rotation pWAR, Bullpen pWAR
- Delta shown per cell with green (ahead) / red (behind) / gray (±0.1)
- Auto-populates from `team_war_snapshots` keyed by `(source_team_id, season)`

### Championship Benchmark Compare card
- Dropdown to pick any 2025 champion (National + Conference, split-champs included)
- Same 4-cell comparison as Year-Over-Year
- Benchmarks grouped in dropdown: National Champion first, then conferences alphabetical

### Data layer
- **Table:** `team_war_snapshots` (one row per team per season)
- **Seed source:** `supabase/queries/seed_team_war_snapshots_2025.sql` — runs the canonical aggregation in `supabase/queries/team_war_2025_aggregation.sql` and upserts all D1 teams + champion flags
- **Annual refresh:** re-run the seed SQL after each season ends; idempotent
- **Hooks:** `useTeamWarSnapshot(sourceTeamId, season)` for single team; `useWarBenchmarks(season)` for champion list

### Formulas (mirror src/savant/lib/war.ts)
```
wRC+ = ((0.45·OBP + 0.30·SLG + 0.15·AVG + 0.10·ISO) / 0.364) · 100
oWAR = ((((wRC+ − 100) / 100) · PA · 0.13) + (PA / 600 · 25)) / 10
pRV+ = 0.30·FIP⁺ + 0.25·ERA⁺ + 0.15·WHIP⁺ + 0.15·K9⁺ + 0.10·BB9⁺ + 0.05·HR9⁺
pWAR = (((pRV+ − 100) / 100) · (IP/9) · 5.5 + (IP/9 · 2.5)) / 10
```

### 56-game proration
- `games_played_est` ≈ team total IP / 9
- `proration_factor` = 56 / games_played_est, capped 0.7–1.5
- All prorated columns scale raw totals by this factor for cross-conference fairness

### 2025 champions captured 2026-05-12
- National: Louisiana State
- 39 conference champion rows across 29 conferences (10 had split regular-season champs)
- Full list in `memory/project_war_benchmarks.md`

---

## Refactoring Policy

These rules apply across all pages (TeamBuilder, PlayerProfile, TransferPortal, Rankings, Dashboard). When touching any file, enforce them in the same PR.

### Shared location for shared logic

| If you find... | It belongs in... |
|---|---|
| Pure calculation or formatting function | `src/lib/` (e.g. `playerCalcs.ts`, `nameUtils.ts`) |
| Name/team normalization helpers | `src/lib/nameUtils.ts` |
| Data-fetching + derived state pattern | `src/hooks/` (e.g. `useSeedDataMaps.ts`, `useTransferPortalContext.ts`) |
| Page-specific hook with no UI | `src/pages/<page>/hooks/` |
| Reusable UI widget | `src/components/` |

**Rule:** When refactoring page A surfaces a function that also exists in page B, extract to shared first, then update both call sites in the same PR. Improving one and leaving the other creates drift — don't do it.

### Known shared functions (canonical locations)

| Function | File | Was duplicated in |
|---|---|---|
| `computeOWarFromWrcPlus` | `src/lib/playerCalcs.ts` | TeamBuilder, PlayerProfile, ReturningPlayers, useTeamBuilderSimulation |
| `normalizeName` | `src/lib/nameUtils.ts` (re-exported from `helpers.ts`) | TeamBuilder, PlayerProfile |
| `nameTeamKey`, `normalizeTeamForKey`, `getNameVariants` | `src/lib/nameUtils.ts` | PlayerProfile |
| `isUuid`, `readStoragePitcherLocalPlayers`, `parseBuildPlayerMeta`, `serializeBuildPlayerMeta` | `src/pages/team-builder/helpers.ts` | TeamBuilder (inline) |
| `defaultHitterDepthRoleFromPa`, `defaultPitcherDepthRoleFromIp` | `src/pages/team-builder/helpers.ts` | TeamBuilder (inline) |
| `asPitcherRole` | `src/pages/team-builder/helpers.ts` | TeamBuilder had a duplicate — removed |
| Prediction selection (`pickPreferredPrediction`, team-scoped logic) | `src/lib/teamScopedPredictions.ts` | — |

### addPlayerFromTargetSearch — deferred, not extracted

Extraction difficulty: CRITICAL (3 interleaved async paths, transfer projection duplicated ~130 lines). Leave in TeamBuilder until a 4th player-add path is needed — that's the forcing function.

### Hook extraction guidelines

When a function closes over 8+ deps and has 5+ logical sections, extract as a `use*` hook that accepts deps as a typed params object and returns the callback. Keep the dep array accurate — omit values that are not read inside the function body.

---

## Testing

Run the test suite any time you touch formula logic, projection math, or add a new metric:

```bash
npm test
```

Full suite runs in ~2 seconds. **When to run:**
- Changing equation weights (predictionEngine, wrcPlus, pitcherProjection) → parity tests catch if you updated one copy but not another
- Adding a new metric to the precompute pipeline → add a parity test in `src/lib/storedVsLive.test.ts`, then run
- Modifying oWAR, pWAR, wRC+, or `projectPitchingRate` → formula unit tests catch regressions
- Activating a `.skip` regression test in `storedVsLive.test.ts` → means the stored-first read path for that surface is in place

**Test files:**
| File | Covers |
|---|---|
| `src/savant/lib/war.test.ts` | wRC+, oWAR, pWAR formulas |
| `src/lib/playerCalcs.test.ts` | `computeOWarFromWrcPlus` parity vs `computeOWar` |
| `src/lib/pitcherProjection.test.ts` | `projectPitchingRate`, blend weight, damping |
| `src/lib/storedVsLive.test.ts` | Formula constant parity across all duplicate call sites; regression placeholders for Rossow ERA + TB Compare |

---

## Current Session State

**Last Updated:** 2026-05-24 (session 5)
**Session Status:** Phase 4a stored-first audit complete — commit `5d9b94f` on `feature/stored-vs-live-audit`

### Stored-First Audit — Phase Status
| Phase | Status | What |
|---|---|---|
| 4a | ✅ Done | PitcherProfile `projectedPitching` useMemo — stripped dead live-compute block (~155 lines), dep array 29→8, removed `cachedProjectionRef`, `toPitchingClassAdj`, `projectPitchingRate` import, `useRef` import |
| 4b | ✅ Already done | PlayerProfile hitter rates (`projectedAvg/Obp/Slg/WrcPlus`) are pure stored reads via `applyDevScale(regularPred?.p_*)` |
| 4c | ✅ Already done | Dashboard uses `dedupePreferredPerPlayer` with correct precedence (team precomputed → global regular) |
| 4d | ⏳ Trevor sync | TB/TP simulator stored-first — needs Trevor |

### Remaining Bugs (resolve with Trevor)
- TB add path passes only conference name, not conference_id, to resolveConferenceStats — causes wrong env+ for players whose `players.conference` is null (e.g. Rossow)
- "From: Campbell (—)" display gap — same root cause
- TB Compare tab shows wrong values
- Dev aggressiveness change is slow (full sim re-cascade)
- ~~PitcherProfile vs Dashboard show different numbers~~ — Phase 4a eliminates this

### Activate `.skip` regression tests when stored-first lands for those surfaces
`src/lib/storedVsLive.test.ts` has two `.skip` blocks: Rossow ERA mismatch, TB Compare values.

### Refactor Progress Summary
| Phase | Lines removed | What moved |
|---|---|---|
| Session 1 | -2,082 | useTeamBuilderData hook, useTeamBuilderSimulation hook, CompareTab |
| Session 2 | -166 | DepthTab render fns, renderPlayerRow → playerRowProps, slotMatchesPosition |
| Session 3–4 | -521 | loadBuild → useLoadBuild; shared utils to lib/; useSeedDataMaps + useTransferPortalContext for PlayerProfile |
| Session 5 | -200 | PitcherProfile dead live-compute block + unused helpers |
| **Total** | **-2,969** | — |

### Current Branch State
- **`feature/stored-vs-live-audit`** — latest commit `5d9b94f`
- Built on top of `refactor/team-builder-split` which Trevor has reviewed
- tsc zero errors, 237 tests pass

### New files this cycle
| File | Purpose |
|---|---|
| `src/lib/playerCalcs.ts` | `computeOWarFromWrcPlus` — was copy-pasted in 4 files |
| `src/lib/nameUtils.ts` | `normalizeName`, `nameTeamKey`, `normalizeTeamForKey`, `getNameVariants` |
| `src/pages/team-builder/hooks/useLoadBuild.ts` | Extracted 275-line `loadBuild` callback |
| `src/hooks/useSeedDataMaps.ts` | Replaces 2 duplicate useMemo seed-map blocks in PlayerProfile |
| `src/hooks/useTransferPortalContext.ts` | `isTransferPortal`, `isReturner`, `fromTeamData` query |

### Remaining Hard Extractions (defer to fresh session)
Both blocks are deeply coupled — need 15-20 params each to extract cleanly:
1. **`loadBuild`** (~395 lines, ~line 1705) — closes over: `builds`, state setters, `supabase`, `effectiveTeamId`, `pitchingMasterRows`, `toast`, 3 refs
2. **`addPlayerFromTargetSearch`** (~540 lines, ~line 2493) — closes over: `allPlayersForSearch`, `rosterPlayers`, `selectedTeam`, `teamByKey`, `teamParkComponents`, `resolveConferenceStats`, many state setters, `supabase`, `toast`

### Watch Out For
- `depthAssignments`/`depthPlaceholders` state stays in TeamBuilder — passed as props to DepthTab, NOT moved there (persisted to Supabase)
- tsc: use `./node_modules/.bin/tsc --noEmit` (not `npx tsc`)
- Merging staging → refactor always conflicts on TeamBuilder.tsx — cherry-pick individual commits instead
- New staging commits since our last sync: cherry-pick order was `b2beb17 33f3fb6 ada1fd0 99d2050 c1af893 0cd3a5f`

### Key Files
- `src/pages/TeamBuilder.tsx` — 3,725 lines, two large blocks remain
- `src/pages/team-builder/helpers.ts` — `depthKey`, `slotMatchesPosition`, `classColor`, `playerCurrentClass` all exported here
- `src/pages/team-builder/hooks/useTeamBuilderSimulation.ts` — 1,546 lines, projection math + WAR sort
- `src/pages/team-builder/tabs/DepthTab.tsx` — 174 lines, self-contained depth render logic
- `BRANCH_REVIEW_refactor_team_builder_split.md` — full change doc for Trevor

---

## Technical Notes

- Primary data source: Supabase (Hitter Master, Pitching Master, Conference Stats, Teams Table, Park Factors)
- Player linking across seasons: `source_player_id`
- Teams Table uses `abbreviation` as primary display name
- Players table `team_id` FK points to "Teams Table"
- All equations live in `readPitchingWeights()` and `computeHitterPowerRatings()` in powerRatings.ts
- SchoolBanner component accepts `schoolLogoUrl` and `schoolName` props for per-team branding
- Design system reference: `design-system/rstr-iq/MASTER.md`
