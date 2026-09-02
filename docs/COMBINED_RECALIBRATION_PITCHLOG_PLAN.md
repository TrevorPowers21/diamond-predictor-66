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

## LOCKED DECISIONS (Trevor 2026-08-08)
- **STORE = (A) OVERWRITE the Masters with pitch-log-derived values.** No new `player_season_stats` table
  ("overwrite and cross check, not new data, unnecessary"). The cross-check happens DURING the run — compare
  pitch-log-derived vs the current Master values, validate, then overwrite. Projection keeps reading the
  Masters (now pitch-log-sourced). The TruMedia Master export remains the *conceptual* cross-check rail (like
  SB counts: pitch log for value, official/Master to confirm), but we don't persist a parallel table.
- **pWAR: recalibrate to the RESEARCH-derived D1 constants (Trevor clarified 2026-08-08 — I first misread this
  as rpw-only).** Change the pWAR values the calibration audit says to change (`docs/drs-reference/CONSTANTS_D1_2026.md`
  + AGENT_LEARNINGS "WAR calibration audit": r/9 → ~6.76, pitcher replacement → ~2.48/9IP, rpw → 13.1), and
  RECONCILE the edge-fn (`pwar_r_per_9 7.11`, `pwar_replacement_runs_per_9 1.5`, rpw 10) vs war.ts
  (`RUNS_PER_9 5.5`, `2.5`, rpw 10) divergence onto that single D1 set. **"Nothing else" is ARCHITECTURAL, not
  numeric:** pitchers get NO dWAR component (pitcher fielding stays out of pitcher WAR), and pWAR is NOT folded
  into a blended total WAR — pitchers stay `p_war`, hitters stay `total_hitter_war` (the side-specific design;
  the old "o+p+d+bsr blended total" idea stays REJECTED).
- **FUTURE data cleanup (not now, noted so it's not lost):** consolidate toward **ONE players table + ONE
  player_predictions table** — fold the Hitter/Pitching Master stat columns into the unified model rather than
  separate Master tables. Deferred; flagged as a cleanup pass.

## LOCKED — full-season vs regular-season SPLIT (Trevor 2026-08-08)
The pitch log includes postseason (2/13→6/22; conf tourneys + NCAA). Accrue BOTH lines; consumer decides:
- **Player stat store + player TOTAL WAR + POWER RATINGS → FULL season (incl. postseason).** Small college
  samples: postseason ABs vs high-quality opponents solidify power ratings. Past seasons: full. Total WAR incl. post.
- **Program analytics (team_war_snapshots, YoY/championship benchmarks) → REGULAR season only** (≤5/18) — matches
  the clean ~56-game season / official records. Old "Option A" holds HERE only.
- **Projections → TARGET regular-season WAR** (depth roles = regular-season PA totals); **INPUT = full-season power
  ratings** ("we project regular-season wins, but if we have more data, use it").
- **Storage:** emit a full-season line + a regular-season split per player (mirrors the existing `regular_season_pa`
  column — extend to a full regular-season set). Player/WAR/ratings read full; program analytics reads the reg split.
- **⚠ IMPLICATION (flagged, resolve at composite-wire time):** dWAR/bsrWAR (dRS engine) currently filter to regular
  season; if player TOTAL WAR is full-season, defense/baserunning components should be accrued FULL-season for the
  player store (reg split retained for team analytics). oWAR (Hitter Master) is ALREADY full-season, so today's
  shipped composite is INCONSISTENT (o=full, d/bsr=regular) — reconcile when we re-run.
- **Independent validation rail (Trevor pulling):** fresh TruMedia Master exports — one regular-season-only + one
  full-season, hitters AND pitchers. The reg-vs-full diff confirms the 5/18 boundary; the pitcher export is the
  independent ERA/count check (today's Master is pitch-log-derived → circular). Archive: sources of truth are now
  saved (`docs/drs-reference/SOURCES_OF_TRUTH_MANIFEST.md` + `~/rstr-data-archive/2026_drs_sources_of_truth.tar.gz`).

## STEP 0 — finalized data + the pitch-log accrual (the prerequisite; the "whole 'nother run")
Pitch log = source of truth for ALL data (season stats AND power-rating sub-metrics), Masters = cross-check.
1. **Confirm the pitch log is complete/final** (currently through ~6/24; verify no gaps vs the season).
2. **Accrue the HITTER line from the pitch log** → AVG/OBP/SLG/ISO + the sub-metrics that feed power ratings
   (contact/barrel/chase/EV/pull/…). Trevor believes hitters are near-final — VERIFY: diff pitch-log-derived
   vs `Hitter Master` on a sample. Store per player+season.
3. **Accrue the PITCHER line from the pitch log** (the new run):
   - Clean tallies (events + IP, dRS parser already extracts): IP (outs/3), WHIP, FIP, K9, BB9, HR9, K%, BB%,
     stuff+ (already pitch-log-native).
   - **ERA — needs a real inning/run reconstruction, deeper than an outs total (Trevor 2026-08-08).** Must:
     (a) recognize when an inning STARTS and ENDS, (b) apply the earned/unearned RULES (a run is unearned if it
     only scored because of a charged error — reconstruct the inning as if the error hadn't happened), (c) use
     the SCORE data to know exactly when a run scored + how much. The pitch_log has the run columns
     (`current_runs`/`total_runs`/`opponent_runs` + the per-play `runs` we backfilled) + the dRS error
     attribution, so it's buildable. **FEASIBILITY CONFIRMED 2026-08-08: earned/unearned is PRE-ENCODED** — TruMedia tags unearned runs `(UR)` directly in `atbat_desc` movement tokens (e.g. `S/7(RBI).3-H(UR)`), and errors as `E<pos>` (e.g. `E6.1-3`). The dRS parser already tokenizes these, so ERA = runs scored WITHOUT `(UR)`, attributed to `pitcher_id`, ÷ IP×9 — no from-scratch inning replay needed. Verified on a full game (18/18 half-innings, inn/outs/runs/pitcher_id 350/350). This is FEASIBILITY-FIRST: prove the inning-boundary + earned/unearned
     logic on a sample before committing; fallback = keep ERA from `Pitching Master` if the reconstruction is
     noisy. Diff vs `Pitching Master` to validate (Trevor cross-checks).
   - **OPPORTUNITY (Trevor 2026-08-08): the inning/score reconstruction is the same machinery that unlocks
     TEAM-level metrics — capture them in the SAME pass while we're parsing innings + scores:** team offense
     from W/L, home/road record + splits, conference-vs-conference games, and PARK-specific stats (esp. valuable
     since the park-factor build is internal here). "Could be very important in the future." Not required for
     ERA itself, but cheap to accrue alongside since we're already reconstructing game state. Scope it into the
     reconstruction design. (Trevor: ask if the conf-vs-conf rationale is needed — NOT needed now.)
4. **Power ratings from the accrued sub-metrics** — `computeHitterPowerRatings` / `computePitchingPowerRatings`
   (`src/lib/powerRatings.ts`) fed by the pitch-log sub-metrics instead of the Master export.
5. Store per **(A) Masters** or **(B) new `player_season_stats`** per the fork. (Season col; don't over-invest
   in deep historical seasons — current-season accrual + the fallback seasons the projection uses.)

## STEP 1 — recalibration (10 → 13.1) — `docs/PUSH2_RECALIBRATION_PLAN.md`
Centralize the 7 copy-pasted oWAR formulas + flip the **oWAR** D1 constants (`RUNS_PER_PA 0.174`,
`REPLACEMENT 2.0 wins/600PA`, `RUNS_PER_WIN 13.1`) + `refresh_composite_war` `/10→/13.1`. **pWAR: recalibrate
to the research D1 constants** (r/9 ~6.76, pitcher replacement ~2.48, rpw 13.1) and reconcile the edge-fn vs
war.ts divergence onto that one set. Architectural guardrails: NO dWAR for pitchers, NO blended total WAR
(pitchers = `p_war`, side-specific).

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

## Decisions — status
- ✅ **Store: OVERWRITE the Masters** (A), no new table, cross-check during the run.
- ✅ **pWAR: recalibrate to the research D1 constants** (r/9 ~6.76, repl ~2.48, rpw 13.1 — reconcile edge-fn
  vs war.ts onto that set). Architectural: NO dWAR for pitchers, NO blended total WAR (side-specific `p_war`).
- 🔎 **ERA reconstruction feasibility** — prove inning-boundary + earned/unearned + score logic on a sample
  before committing (hybrid fallback = Master ERA). FIRST feasibility task.
- 🔎 **Hitter final-standard** — diff pitch-log-derived vs `Hitter Master`.
- 🔎 **Team-metrics scope** — decide how much (W/L offense, home/road splits, conf-vs-conf, park stats) to
  accrue in the reconstruction pass. Cheap alongside ERA; "could be very important in the future."
- 🗂️ **FUTURE cleanup** — consolidate to 1 players table + 1 player_predictions table (fold Masters in).

## Not in this effort
Transfer-projection fallbacks (was Push 4 — returners already have them; source/trigger TBD). Playwright e2e
harness (deferred).
