# PUSH 2 — WAR recalibration (10 → 13.1) + composite display swap

**Dedicated branch off `main` after PR #170 lands.** This is the first *visible* change: WAR values move
(once) and the app starts showing the composite (`total_hitter_war`) instead of raw `o_war`. Source of
truth: the `WAR_RECALIBRATION_TODO` block in `src/savant/lib/war.ts` + `docs/drs-reference/CONSTANTS_D1_2026.md`.

## Goal + net effect
Replace the transplanted MLB rules-of-thumb constants with D1-derived values (from the 2.58M-pitch season).
**Every WAR shrinks ~23%; hitting stays ~flat vs pitching (pitching shrinks a bit more, the o-vs-p gap
closes but pitchers stay higher).** Players move ONCE — oWAR/pWAR/dWAR/bsrWAR all share `RUNS_PER_WIN`, so
they rescale together in the same pass.

## The constant changes (D1-derived)
| constant | old (MLB) | new (D1) | provenance |
|---|---|---|---|
| `RUNS_PER_WIN` | 10 | **13.1** | Pythagorean `2R`, R = 6.54 R/team/game |
| `RUNS_PER_PA` | 0.13 | **0.174** | 105,473 runs ÷ 605,727 PA |
| `RUNS_PER_9` | 5.5 | **6.76** | D1 R/9 |
| `REPLACEMENT_RUNS_PER_600PA` | 25 | **2.0 wins/600 PA** (= 2.0·rpw → 26.2) | fixed-WIN so it scales with rpw |
| `PITCHER_REPLACEMENT_PER_9IP` | 2.5 | **≈2.48/9IP** | fixed-WIN pitcher replacement |

Replacement is expressed as a fixed WIN level (not fixed runs) so the average-player floor is stable across
run-environment changes.

## Interplay with Push 1 (already on prod at ÷10)
- `refresh_composite_war()` currently divides `drs_floor`/`wsb_runs_reg` by **10.0** → change to **13.1**
  (d/bsr share rpw). `war.ts` `computeDWar`/`computeBsrWar` already take `runsPerWin` (default `RUNS_PER_WIN`),
  so the live-compute path rescales automatically when the constant flips.
- So Push 2 = flip the constants (incl. the SQL `/10.0`) + re-run everything once.

## Step 1 — CENTRALIZE (prereq; the formula is copy-pasted, must sync)
The oWAR formula inlines `0.13 / 25 / 10` in **7 places**; make them all import the `war.ts` constants:
- `src/lib/playerCalcs.ts`, `src/lib/transferProjection.ts`, `src/lib/buildTransferProjectionInputs.ts`,
  `src/lib/depthRoles.ts`, `src/pages/TeamBuilder.tsx`,
  `src/pages/team-builder/hooks/useTeamBuilderSimulation.ts`, `supabase/functions/process-precompute-jobs/index.ts`
  (edge fn: lines 899-901 `(pa/600)*25`, `*0.13`, `/10`).
- pWAR copies: `src/lib/pitchingEquations.ts` + (locate `pitchLogRates.ts` — grep returned MISSING; find the
  current pitch-log pWAR path).
- **RECONCILE the pWAR divergence:** the edge fn uses `pwar_r_per_9: 7.11`, `pwar_replacement_runs_per_9: 1.5`,
  `pwar_runs_per_win: 10` while `war.ts` uses `5.5 / 2.5 / 10` — these must land on ONE D1 set
  (`RUNS_PER_9 6.76`, pitcher repl ≈2.48, rpw 13.1). Decide the single source before flipping.
- Parity tests (`playerCalcs.test.ts`, `storedVsLive.test.ts`) enforce the copies stay in sync — run after.

## Step 2 — DISPLAY SWAP (o_war → total_hitter_war)
- Add helpers `pickHitterWar` (= `total_hitter_war`, i.e. o+d+bsr) and `pickPitcherWar` (= `p_war`), analogs
  of `pickHitter/PitcherMarketValue` in `src/lib/twpMarketValue.ts`.
- Swap `o_war → total_hitter_war` **everywhere it's the hitter's HEADLINE WAR**; KEEP raw `o_war` where it's
  the batting **component** of a bat/glove/legs breakdown.
- Do it in BOTH the stored-read path AND the live-compute path (`computeOWarFromWrcPlus` in
  `useTeamBuilderSimulation` ~:693, :1522) — add `d_war + bsr_war` in both.
- TWP-safe by construction: `total_hitter_war` holds the hitter side for everyone; pitcher side stays `p_war`.

## Step 3 — Edge function
- Flip the constants (line 519 `pwar_runs_per_win: 10` → 13.1, r/9, replacement; lines 899-901 oWAR
  `25/0.13/10`), importing the shared set.
- `refresh_composite_war()`: `/10.0` → `/13.1` (both the defense and baserunning subqueries).
- Deploy to **staging first** (`--project-ref slrxowawbijbjrkozqlj`), verify, then prod on "prod, now?".

## Step 4 — RE-PRECOMPUTE (regenerate stored oWAR/pWAR + composite)
- Re-run the D1 precompute for every customer team (staging → verify → prod). This regenerates stored
  `o_war`/`p_war` at 13.1 AND the recurring `refresh_composite_war()` repopulates `total_hitter_war`.
- Verify: a full-time hitter ~250 PA lands ~2.6 WAR (not 5.9 at 600-PA textbook); pitchers still > hitters
  by IP volume; identity `total_hitter_war = o+d+bsr` holds.

## Step 5 — Reseed `team_war_snapshots`
- Re-run `supabase/queries/seed_team_war_snapshots_2025.sql` on the new totals (the YoY/championship
  benchmark cards read this).

## Step 6 — Repoint market value + projected budget at TOTAL WAR
- Market value = f(**total WAR**) + positional scarcity (the term exiled from dWAR) + NIL/budget. Repoint the
  market-value / projected-budget reads from `o_war` to `total_hitter_war`; load TeamBuilder + simulation
  pages to confirm.

## Verification + push sequence
1. Centralize + flip constants + display swap on a branch → `npm test` (parity tests catch un-synced copies).
2. Deploy edge fn to staging + re-precompute staging + verify values/identity + load the pages.
3. staging → main PR; on "prod, now?": deploy edge fn to prod, run the SQL `/13.1` change, re-precompute prod,
   reseed snapshots. Then the composite is live AND displayed at the correct D1 scale.

**Not in Push 2:** Push 3 (engine computes aggregates FROM the pitch_log table). Push 4 (transfer fallbacks).
Push 5 (finalize 2027 → improved market values).
