# Feature Branch Test Checklist — `feature/eligibility-class-consistency`

Everything on this branch, combined into one pass so nothing is missed. This branch
holds the whole multi-day arc: **pERA → pitcher WAR → market → Phase B (roster +
targets) → notes-recipe → active-build resolver → TWP two-row.**
87 commits · 28 source files · 1 migration · 13 data-op scripts · fork = `f796d3f`.

## How to read this
- **[AUTO]** — a command proves it. Run it; it must pass. This is the real proof
  (the DB scripts recompute every invariant from stored values).
- **[BROWSER]** — needs the app loaded. Neither the CLI nor a DB check can see render/
  flicker/drag; the exact thing to look at is spelled out, plus the DB proxy that
  backs it where one exists.
- **[DATA]** — a one-time staging data op already run; re-running its dry-run should
  report 0 remaining.

## Current automated status (2026-07-24)
- [x] `npm test` → **242 passed** (9 files: war, playerCalcs, pitcherProjection, nilProgramSpecific, storedVsLive, …)
- [x] `tsc -p tsconfig.app.json --noEmit` → **196 errors, all pre-existing** (0 net new from this branch; baseline documented in CLAUDE.md)
- [x] `npx tsx scripts/verify-all.ts` → **0 issues across 15 programs**
- [x] `npx tsx scripts/audit-georgia.ts` → **0 inconsistencies** (Georgia deep dive)

---

## §0 — Automated gates (run all four; all must be green)
```
npm test                                             # 242 pass
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit | grep -c 'error TS'   # 196 (no new)
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... # from .env.local
npx tsx scripts/verify-all.ts                        # 0 issues, 15 programs
npx tsx scripts/audit-georgia.ts                     # 0 inconsistencies
```
`verify-all.ts` is the keystone — it recomputes, for EVERY program: one active build
(+ resolver agreement); every target snapshot's WAR-from-depth + market=f(WAR) at the
program tier; rostered board notes==roster notes + snapshot 1:1; and TWP two-row shape.

---

## §1 — Pitcher WAR / pERA (where the arc started)
Files: `PitcherProfile.tsx`, `effectiveProjection.ts`, `pitcherProjection.ts`,
`depthRoles.ts`, `ReturningPlayers.tsx`, `transferPitcherProjection.ts`,
`buildTransferPitcherInputs.ts`, `jucoReturnerPitcherProjection.ts`.
- [ ] [AUTO] `pitcherProjection.test.ts` (18) + `war.test.ts` pass — pWAR/pRV+ formulas.
- [ ] [AUTO] verify-all §2 pitcher rows: `pWAR == computePitcherWar(pRV+, IP(depth))`.
- [ ] [BROWSER] PitcherProfile loads for a pitcher — **no classTransition crash**; pWAR
      shown = the number the depth role implies (workhorse reliever 50 IP, weekend SP ~85).
- [ ] [BROWSER] Same pitcher shows **identical pWAR** on Team Builder, PitcherProfile, GM.
- [ ] [BROWSER] pRV+ displays as a whole number everywhere (it's rounded inside pWAR).

## §2 — Market values (no PVF, destination conference)
Files: `predictionEngine.ts`, `nilProgramSpecific.ts`, `depthRoles.ts`; data: `fix-pitcher-market-pvf.ts`.
- [ ] [AUTO] `nilProgramSpecific.test.ts` (76) pass — tier + position multipliers.
- [ ] [AUTO] verify-all §2: hitter market = `oWAR×25000×tier×posMult`; pitcher = `pWAR×25000×tier` (no PVF), at each program's conference.
- [ ] [DATA] `npx tsx scripts/fix-pitcher-market-pvf.ts` (dry-run) → **0 to change / $0** (already applied; idempotent).
- [ ] [BROWSER] A transfer pitcher (e.g. Cespedes) values at the **destination** program's tier (SEC ~$113k), not his old school; no weekend-starter premium.
- [ ] [BROWSER] Same WAR + same conference + same position → identical market on TB, profile, GM, board.

## §3 — Phase B: snapshot is the source of truth (roster)
Files: `useTeamBuilderSimulation.ts`, `PlayerTableRow.tsx`, `TeamBuilder.tsx`, `PlayerProfile.tsx`, `effectiveProjection.ts`.
- [ ] [AUTO] `storedVsLive.test.ts` (11) pass — no formula drift across duplicate call sites.
- [ ] [AUTO] verify-all §2 — every stored snapshot is self-consistent (WAR recomputes from its depth).
- [ ] [BROWSER] Team Builder loads **settled instantly, no flicker** (returners + rostered transfers).
- [ ] [BROWSER] Toggle a depth/dev-agg → value updates once; **refresh → it persisted, no double dev-agg** (numbers don't drift up on reload).
- [ ] [BROWSER] After save→reload a row is **read-only** (no live re-compute); GM row == TB row == profile, exactly.
- [ ] [BROWSER] Spot-check re-baked values: Souza 118/1.594, Traeger 117/1.562, Cespedes 124/3.028.

## §4 — Target board Phase B (all four surfaces read the snapshot)
Files: `useTargetBoard.ts`, `TargetBoardSubtab.tsx`, `useGmTargetBoard.ts`, `GMTargets.tsx`, `PlayerHub.tsx`, `team-builder/tabs/TargetBoardTab.tsx`.
- [ ] [AUTO] verify-all §2/§3 — target snapshots self-consistent; rostered targets' board line == roster player_snapshot 1:1.
- [ ] [BROWSER] Target board loads **one instant batch, no wave/flicker**.
- [ ] [BROWSER] Toggle a target on the TB board → **refresh → it persisted** (not reverted to neutral).
- [ ] [BROWSER] The **same line** shows on: TB target board, Targets-tab board, target's PlayerProfile, GM target board (rostered→player_snapshot, else→transfer_snapshot).
- [ ] [BROWSER] On a target's PlayerProfile/PitcherProfile the depth/dev-agg controls are **read-only** (display-only).
- [ ] [BROWSER] Adding a target creates its row instantly (no async rebuild); removing it reverts the player page to neutral.

## §5 — Notes recipe travels with the snapshot (both ways)
Files: `TeamBuilder.tsx` saveMutation mirror + `saveTargetToggle`; data: `backfill-target-notes-from-roster.ts`.
- [ ] [AUTO] verify-all §3 — board `production_notes` depth == active-build roster notes (all 37 one-way rostered targets).
- [ ] [DATA] `backfill-target-notes-from-roster.ts` (dry-run) → the rostered one-way targets (re-mirror is idempotent).
- [ ] [BROWSER] A rostered target shows the **coach's roster toggle state** on the board's knobs (recipe present, not defaults).
- [ ] [BROWSER] **Add** a target to the roster → its notes come across; change the rostered player → the board matches; **remove** from roster → the board keeps the toggles.

## §6 — Active-build resolver (auto-resolve the live build)
Files: `src/lib/activeBuild.ts`; readers `useGmTargetBoard.ts`, `TargetBoardSubtab.tsx`; `TeamBuilder.tsx` (mirror gate); data: `set-active-builds.ts`.
- [ ] [AUTO] verify-all §1 — exactly **one** `is_active` build per program AND the resolver independently picks that same build.
- [ ] [DATA] `set-active-builds.ts` (dry-run) → **0 programs need a flag** (already set; leaves existing untouched).
- [ ] [BROWSER] Each program's target board resolves the correct active build (Arkansas → "Arkansas Baseball 2027 Roster" with Traeger; Kansas → the 2027 build, not the stale 2026 one).
- [ ] [BROWSER] Save a NON-active (scenario) build → it does **not** overwrite the universal board's notes (gate holds).
- Note: resolver rule = explicit is_active (same-team) → current-year, largest roster, most-recent → default. Mark-active-on-create already lives in GM `createBuild`.

## §7 — TWP two-row target board (Kenny)
Migration `20260724120000_target_board_twp_two_row.sql`; code `useTargetBoard.ts`,
`TargetBoardSubtab.tsx`, `useGmTargetBoard.ts`, `GMTargets.tsx`, `TeamBuilder.tsx`
(saveTargetToggle), `PlayerHub.tsx`; data `rebuild-twp-target-rows.ts`.
- [ ] [AUTO] verify-all §4 — every TWP on a board = **exactly 2 own-side rows** (hitter slot + pitcher slot); hitter row carries no pitcher data and vice-versa.
- [ ] [AUTO] Migration applied: `select position_slot from target_board limit 1` succeeds; a 2nd-side insert for a TWP succeeds (unique index allows it).
- [ ] [DATA] `rebuild-twp-target-rows.ts` (dry-run) → Kenny RF 1.499/$61,817/cornerstone + SP 0.832/$31,193/swing_starter; Overbeek split on his boards.
- [ ] [BROWSER] Kenny shows as **two rows** — his hitter line in the hitter table, his pitcher line in the pitcher table, each with its own stats.
- [ ] [BROWSER] Toggle Kenny's hitter side → only his hitter row changes (pitcher row untouched); refresh persists per-side.
- [ ] [BROWSER] Add Kenny to the roster from the board → brings **both** sides (matches the roster's two rows).
- [ ] [BROWSER] A **non-TWP** target still renders exactly **once** (the whole change is `is_twp`-gated — this is the regression to watch).
- [ ] [BROWSER] Kenny's PlayerHub profile shows the correct side's WAR/market (not an arbitrary/blank side).

---

## §7.5 — Page-load matrix (load EVERY page; nothing breaks)
The two migrations add columns to `target_board` + `team_build_players` and change
`target_board`'s unique constraints, so any page reading those tables could break on a
bad query — every page below is at minimum a "does it still load, no console error"
smoke test. **★ = branch changed this page's logic** (load + verify behavior). **○ =
smoke only** (load, confirm no crash). (Savant intentionally excluded.)

### Coach app (`/dashboard`)
- [ ] ★ `/dashboard/team-builder` — Team Builder. No-flicker load; toggle→persist→no drift;
      read-only after save; pWAR/market/pRV+ correct; Souza 118/1.594, Traeger 117/1.562, Cespedes 124/3.028.
- [ ] ★ `/dashboard/targets` — Targets board. One instant batch, no wave; toggle persists;
      **Kenny = 2 rows**; a non-TWP target = 1 row (the regression to watch).
- [ ] ★ `/dashboard/high-follow` — High Follow list loads; target WAR/market correct.
- [ ] ★ `/player/:playerId` — PlayerHub. Both TWP sides fetched, correct side shown; read-only toggles for returner/target.
- [ ] ★ `/dashboard/player/:id` — PlayerProfile (hitter). Matches TB; read-only depth/dev-agg for returners/targets.
- [ ] ★ `/dashboard/pitcher/:id` — PitcherProfile. **No classTransition crash**; pWAR matches depth role; matches TB.
- [ ] ○ `/dashboard/player/:id/stats` · ○ `/dashboard/pitcher/:id/stats` — load, no error.
- [ ] ★ `/dashboard/returning` — ReturningPlayers. pERA/pWAR match TB; pitcher rows no crash.
- [ ] ○ `/dashboard/portal` — TransferPortal. Search returns players + market.
- [ ] ○ `/dashboard/compare` · ○ `/dashboard/war-room` · ○ `/dashboard` (overview) · ○ `/dashboard/dev-weights` — load, render.
- [ ] ○ `/dashboard/settings` — scouting-CSV upload UI intact.
- [ ] ○ `/dashboard/admin` (+ `/admin/teams`, `/admin/users`) — load (if admin).

### GM app (`/gm`)
- [ ] ★ `/gm/roster` — GM row == TB row == profile exactly; resolves correct active build.
- [ ] ★ `/gm/targets` — same target line as coach board; Kenny splits to 2 sides.
- [ ] ★ `/gm/scenarios` — builds list loads; a non-active build does NOT overwrite board notes.
- [ ] ★ `/gm/player/:playerId` — PlayerHub Financials; correct side/values.
- [ ] ○ `/gm` · ○ `/gm/analytics` (WAR benchmarks) · ○ `/gm/allocations` · ○ `/gm/contracts` · ○ `/gm/recruiting` — load, render.

### Auth / entry
- [ ] ○ `/` (Index) · ○ `/auth` — load + login works.

## §8 — Staging data ops (all applied) + prod promotion
Every script below has already run on **staging** (verify-all = 0). Prod is the
coordinate-with-Trevor batch — full order + counts in **handoff §9 + §10**. Run each
dry-run first; --apply after; verify via catalog, not "OK".
Order: pitcher-market fix → target/build snapshot resyncs → returner-TWP market →
transfer_snapshot backfill → rostered-consistency → clean-twp-sides → set-active-builds
(⚠ confirm each program's live build with Trevor — prod activity ≠ staging) → notes
mirror → **target_board TWP migration** → **rebuild-twp-target-rows** → verify-all.

- [ ] Staging PR opened (always-PR rule); Trevor drives staging→main + the prod merge.
- [ ] Prod: apply the 13 data scripts + 1 migration in the §9/§10 order.
- [ ] Prod: `verify-all.ts` (adapt env to `.env.production.local`) → 0.

---

## Fastest path to "everything checked"
1. Run the four **§0 gates** — if all green, every recomputable invariant holds across all 15 programs.
2. Do **one browser smoke pass** hitting the [BROWSER] items: load TB (no flicker), toggle+refresh (persists), open a target's profile (read-only + same numbers), open the target board (four surfaces agree), and load **Kenny** (two rows, own-side) + one **non-TWP** target (still one row).
3. Confirm the three **[DATA]** dry-runs report nothing left to change.
