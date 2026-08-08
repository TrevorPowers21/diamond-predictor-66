# Combined plan — recalibration + pitch-log accrual + finalize, as ONE staging-buttoned effort → ONE prod push

**Strategy (Trevor 2026-08-08):** usage is low right now, and the dWAR/bsrWAR addition gives narrative cover
for WAR moving — so instead of staging Push 2/3/5 as separate prod pushes (players move 3×), **do it ALL on
staging, in stages (snapshot between for the impact story), then ONE large prod push with a changelog that
acknowledges every change.** Players move ONCE. The before/after snapshot already taken
(`docs/snapshots/prod_player_predictions_baseline_2026-08-07_pre-push2.csv` + `player_predictions_snap_2026_08_07`)
captures the full jump.

## Corrected data model (audited 2026-08-08 — do NOT trust the "players holds stats" memory)
- **`players`** = identity/roster + playing-time counts (`pa`/`ab`/`ip`/`g`/`gs`) + portal fields. **NO rate
  stats, NO season col, NO power ratings.** Not the stats store.
- **`Hitter Master`** (table, has `Season`) = the hitter season line: AVG/OBP/SLG/ISO + sub-metrics
  (contact/barrel/chase/EV90/pull/…) + `*_power_rating` + blended (multi-season, used as projection base/fallback).
- **`Pitching Master`** (table, has `Season`) = the pitcher season line: IP/ERA/FIP/WHIP/K9/BB9/HR9 + sub-metrics
  + `*_pr_plus` + `stuff_plus` + blended.
- **`player_predictions`** = `from_*` (projection base, loaded from the Masters) + `p_*` (projected) + `season`.
  **`player_prediction_internals`** = per-prediction power ratings.
- **Projection engine reads:** `Pitching Master` (pitchers), the `players`/Master hitter path (hitters),
  Conference Stats, Park Factors, model_config, equation overrides → writes `player_predictions`.

## THE key design fork (Trevor's call before building)
The pitch-log accrual produces pitch-log-derived season stats + power-rating inputs. Where do they land?
- **(A) Overwrite the Masters** — Masters become pitch-log-sourced; simplest for the projection (reads Masters
  unchanged) but you LOSE the independent cross-check (the TruMedia export values are gone unless backed up).
- **(B) New `player_season_stats` table (pitch-log-derived, keyed by player+season)** — projection reads THIS;
  the Masters stay untouched as the pure cross-check rail (Trevor's "Masters = cross-check", like SB counts).
  More wiring (repoint the projection reads), cleaner separation. **Recommended.**
Decide A vs B first — it shapes steps 0 and 3.

## STEP 0 — finalized data + the pitch-log accrual (the prerequisite; the "whole 'nother run")
Pitch log = source of truth for ALL data (season stats AND power-rating sub-metrics), Masters = cross-check.
1. **Confirm the pitch log is complete/final** (currently through ~6/24; verify no gaps vs the season).
2. **Accrue the HITTER line from the pitch log** → AVG/OBP/SLG/ISO + the sub-metrics that feed power ratings
   (contact/barrel/chase/EV/pull/…). Trevor believes hitters are near-final — VERIFY: diff pitch-log-derived
   vs `Hitter Master` on a sample. Store per player+season.
3. **Accrue the PITCHER line from the pitch log** (the new run):
   - Clean tallies (events + IP, dRS parser already extracts): IP (outs/3), WHIP, FIP, K9, BB9, HR9, K%, BB%,
     stuff+ (already pitch-log-native).
   - **ERA** via the dRS **error attribution** — earned = runs that scored without depending on a charged
     error; the engine already parses errors + run-scoring, so earned/unearned reconstruction is now buildable
     (was the one hard part). Test reliability; fallback = keep ERA from `Pitching Master` (cross-check) if noisy.
   - Diff vs `Pitching Master` on a sample to validate (Trevor cross-checks the Master).
4. **Power ratings from the accrued sub-metrics** — `computeHitterPowerRatings` / `computePitchingPowerRatings`
   (`src/lib/powerRatings.ts`) fed by the pitch-log sub-metrics instead of the Master export.
5. Store per **(A) Masters** or **(B) new `player_season_stats`** per the fork. (Season col; don't over-invest
   in deep historical seasons — current-season accrual + the fallback seasons the projection uses.)

## STEP 1 — recalibration (10 → 13.1) — `docs/PUSH2_RECALIBRATION_PLAN.md`
Centralize the 7 copy-pasted oWAR formulas (+ reconcile the edge-fn vs war.ts pWAR divergence 7.11/1.5 vs
5.5/2.5 → ONE D1 set: `RUNS_PER_9 6.76`, pitcher repl ≈2.48, `rpw 13.1`), flip the constants +
`refresh_composite_war` `/10→/13.1`.

## STEP 2 — display swap
`o_war → total_hitter_war` where it's the HEADLINE (keep raw `o_war` in bat/glove/legs breakdowns), via
`pickHitterWar`/`pickPitcherWar`, in both stored-read and live-compute paths.

## STEP 3 — re-precompute (ONE run, staging) + snapshot BETWEEN for the impact story
Re-precompute after each of step 0 / step 1 so you can attribute the change: (a) recalibration alone → (b)
+pitch-log stats/power ratings → (c) +finalized data. Each snapshot vs the prior = the "acknowledge every
change" report, WITHOUT three prod pushes. Verify: 250-PA hitter ~2.6 WAR, aces still > hitters, identity
`total_hitter_war = o+d+bsr` holds, page loads clean.

## STEP 4 — reseed + repoint
Reseed `team_war_snapshots` (`seed_team_war_snapshots_2025.sql`) on the new totals. Repoint market value +
projected budget at TOTAL WAR (+ positional scarcity). Load TeamBuilder + simulation pages.

## THE ONE PROD PUSH (on "prod, now?", with changelog)
Deploy edge fn + run the SQL `/13.1` + repoint reads + ONE prod re-precompute + reseed snapshots. Changelog
acknowledges: added dWAR + bsrWAR, recalibrated to D1 (10→13.1), stats/power ratings now pitch-log-sourced,
2027 projections finalized. Diff `player_predictions_snap_2026_08_07` (÷10) vs live → the full before/after.

## Open decisions to lock before building
1. **A vs B** (overwrite Masters vs new pitch-log stats table). Recommended: B.
2. **pWAR constant set** (one D1 set; derive, don't split the difference).
3. **ERA reconstruction** reliability from the pitch log (clean sweep vs ERA-hybrid).
4. **Hitter final-standard confirmation** (pitch-log vs Hitter Master diff).

## Not in this effort
Transfer-projection fallbacks (was Push 4 — returners already have them; source/trigger TBD). Playwright e2e
harness (deferred).
