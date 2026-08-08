# STEP 0 — pitch-log stat accrual · LIVING RESUME DOC (read this first after any compaction)

**Branch:** `feature/war-recalibration`. **Parent plan:** `docs/COMBINED_RECALIBRATION_PITCHLOG_PLAN.md`.
**Agent knowledge:** `docs/AGENT_LEARNINGS_defensive_runs_engine_2026_08_03.md`. This doc is the single
resume point for the Step 0 build — update the "RESUME POINT" block below as work progresses.

## RESUME POINT (update this every chunk)
- **PITCHER ERA — SCORE-DRIVEN + Trevor's rules, DONE (2026-08-08).** `scripts/drs/accrue_pitcher_er.py`.
  Final vs INDEPENDENT Full Pitching Master (n=2835 IP>=20): **ERA mean|Δ| 0.232, 89% within 0.5 ERA (66%
  within 0.25), ER 98% within 3, aggregate -0.7%.** Progression: mound-simplification 0.87 -> occupancy+out-at-home
  0.242 -> +score-driven capture & rules 2+3 = 0.232.
- **Method (Trevor's architecture, all validated):**
  1. SCORE-DRIVEN run capture — walk every pitch, batting-team score on the NEXT pitch minus this = runs on this
     pitch (delta handles 2+ runs/pitch; catches WP/PB/steal-home/balk + the ~900 the `Runs` col drops). Total
     111,704 vs Master R 111,659 = **99.96%**. (currentRuns/opponentCurrentRuns is the score COMING IN — lag one pitch.)
  2. INHERITED-RUNNER attribution — base-slot occupancy (ManOnFirst/Second/Third), name-agnostic so courtesy
     runners keep the slot's pitcher; charged to whoever put the runner on, across pitching changes.
  3. EARNED/UNEARNED — rule 2 (reached-on-error = unearned) + rule 3 (once an error should've been the 3rd out,
     recon_outs>=3, every later run unearned) OR'd with the `(UR)` tag. Out-at-home (`3XH`) is an out, not a run.
- **RESIDUAL (irreducible from the pitch log, ~11% >0.5 ERA, MIXED direction = not bias):** WP vs PB is NOT
  labeled in the pitch log (I mark all non-PA scoring earned; passed balls should be unearned) + earned/unearned
  judgment edge cases. Cannot be resolved from pitch-log data alone.
- **CONSISTENCY DECISION (pending Trevor):** he requires the DISPLAYED ERA match official exactly (trust). Options:
  (A) store ER/ERA/R from the Master export (exact, both splits; earned/unearned is an official-scorer ruling
  anyway) + everything else pitch-log-native; the pitch-log ERA engine (0.232) stays as cross-check/future engine.
  (B) ship the pitch-log ERA (0.232/89%). Recommend A for exact consistency.
- **All else pitch-log-native + EXACT vs Master:** IP/K/BB/HBP/H/HR/BF/FIP/WHIP/K9/BB9/HR9 (+ stuff+/tracking/ratings).
- **Exports + policy:** 4 TruMedia masters archived (217MB tarball + manifest). Full/regular split policy LOCKED.
- **NEXT — chunk 6:** consolidate the pitcher line (IP+ER+rates), full+regular splits, overwrite Pitching Master
  (staging first) — with the A/B ERA decision. Then reconcile dWAR/bsrWAR to full-season for the player store.


## Goal (locked decisions)
Accrue the **hitter + pitcher season line AND the power-rating sub-metrics from the pitch log** (source of
truth) and **OVERWRITE the Masters** with them (validate vs current Master DURING the run; no new table). Then
the projection engine reads the Masters (now pitch-log-sourced), Masters export = conceptual cross-check.
- pWAR recalibration (later step) = research D1 constants; NO pitcher dWAR; NO blended total (side-specific).
- Scope TEAM metrics (W/L offense, home/road splits, conf-vs-conf, park stats) into the same inning/score pass.

## Key technical facts (so a cold context doesn't re-derive)
- **Source CSVs:** `docs/drs-reference/*DRS Pitch Log.csv` (34 files incl. 4 date re-exports; the engine +
  loaders glob ONLY `*DRS Pitch Log.csv`). Full-season = 2,576,230 unique pitches (dedupe on `uniqPitchId`).
- **Parser:** `scripts/drs/drs_engine/parser.py` `parse_atbat_desc()` → `ParsedEvent`: `event_type`
  (OUT/SINGLE/DOUBLE/TRIPLE/HR/ERROR/FC/K/OTHER), `putout_chain`, `bb_type` (G/F/L/P), `is_bunt`, `dp_kind`,
  `hit_zone`, `error_fielder`, `movements` (list of `Movement{frm,to,out,chain,error_fielder}`).
  **NEEDS EXTENDING:** capture the `(UR)` unearned token on movements (currently only pulls `E{n}` from parens).
- **ERA (feasibility CONFIRMED):** TruMedia pre-encodes unearned runs `(UR)` in `atbat_desc` movement tokens
  (`S/7(RBI).3-H(UR)`), errors as `E<pos>` (`E6.1-3`). So EARNED run = a movement to `H` (home) WITHOUT `(UR)`,
  charged to the pitcher on the mound. ERA = earned·9/IP.
- **Pitcher tallies from the pitch log:** IP = outs recorded ÷3 (out movements + putout events); K = event_type K
  (careful: strikeout is a PA-end); BB = walks (from `pitch_result`="Walk" / atbat OTHER + a walk marker —
  VERIFY where walks are marked); H = SINGLE+DOUBLE+TRIPLE+HR; HR; earned runs = scoring movements w/o UR.
  Then FIP=(13·HR+3·BB−2·K)/IP+C, WHIP=(BB+H)/IP, K9/BB9/HR9. stuff_plus already pitch-log-native.
- **Hitter tallies:** AB/H/2B/3B/HR/BB/HBP/SF → AVG/OBP/SLG/ISO + sub-metrics (contact/barrel/chase/EV/pull...)
  many already in `pitch_log` cols (x_avg/spray_ang/exit_velocity/launch_angle/...).
- **Where stats live (audited — NOT in `players`):** `Hitter Master` (Season; AVG/OBP/SLG/ISO + `*_power_rating`
  + blended) and `Pitching Master` (Season; IP/ERA/FIP/WHIP/K9/BB9/HR9 + `*_pr_plus` + `stuff_plus` + blended).
  Identity join key: `source_player_id`. Overwrite target = these tables (per season).
- **Load path:** resolve `source_player_id` → env's own `players.id` uuid (staging/prod uuids DIFFER — see
  `scripts/load-drs-wsb-prod.ts`). Overwrite the Master rows keyed by (source_player_id, Season).
- **Power ratings:** `src/lib/powerRatings.ts` `computeHitterPowerRatings` / `computePitchingPowerRatings` —
  feed from the accrued sub-metrics instead of the Master export.

## Build plan (resumable chunks — commit each)
1. **Extend the parser** to capture `(UR)` unearned + confirm walk/HBP/SF detection. Add a unit check.
2. **Pitcher accrual PROTOTYPE** on a sample team → IP/H/BB/K/HR/ER → ERA/FIP/WHIP/K9/BB9/HR9. Diff vs
   `Pitching Master` (staging, read-only) for that team → tune until it matches to tolerance.
3. **Hitter accrual PROTOTYPE** on a sample → AVG/OBP/SLG/ISO + sub-metrics. Diff vs `Hitter Master`.
4. **Scale to full season** → output CSVs (`scripts/drs/output/hitter_accrued.csv`, `pitcher_accrued.csv`).
5. **Cross-check report** vs the current Masters (leaders, distribution, biggest diffs) — validate before overwrite.
6. **Overwrite loader** (staging first) → Master rows keyed (source_player_id, Season); power ratings recomputed.
7. **Team-metrics accrual** (same pass): W/L, home/road splits, conf-vs-conf, park stats.

## Validation rails
Pitching Master + Hitter Master (the current TruMedia export values) = cross-check. Also official leaders where
knowable (SB-count pattern). Log every diff; do not overwrite until the sample matches to tolerance.
