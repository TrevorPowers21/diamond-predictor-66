# STEP 0 — pitch-log stat accrual · LIVING RESUME DOC (read this first after any compaction)

**Branch:** `feature/war-recalibration`. **Parent plan:** `docs/COMBINED_RECALIBRATION_PITCHLOG_PLAN.md`.
**Agent knowledge:** `docs/AGENT_LEARNINGS_defensive_runs_engine_2026_08_03.md`. This doc is the single
resume point for the Step 0 build — update the "RESUME POINT" block below as work progresses.

## RESUME POINT (update this every chunk)
- **✅ STEP 0 COMPLETE (2026-08-08).** The pitch-log accrual prerequisite is done + validated. Summary:
  1. **Master is AUTHORITATIVE** (= Baseball Reference; TruMedia uses our same method on complete data). Where
     pitch log != Master → use the Master. DO NOT overwrite the Masters with pitch-log values (would swap
     BBRef numbers for our lower-coverage ones on low-TrackMan teams). Our diffs = OUR export's coverage gaps.
  2. **Master TABLES already current + FULL-season (postseason included) — VERIFIED on CWS pitchers** (UNC/UGA:
     table matches the FULL export not the Regular — DeCaro 97.333=97⅓ IP, Scott 59.667, Volchko 95.333). Built
     from the post-CWS pitch log (spans to 6/22). Player stat store = full-season = BBRef. NO RELOAD needed.
  3. **Pitch-log ENGINE built + validated:** score-driven ERA (`accrue_pitcher_er.py` / `accrue_pitcher_line.py`)
     0.232 mean|Δ| vs Master, exact where coverage complete (Govel 2.88 vs 2.87); FIP/WHIP/K9/BB9/HR9 + hitter
     rates all exact. = validated method + cross-check (`validate_vs_master.py`) + base for a "public override" model.
  4. **Sequence columns imported to STAGING** (pitch_num_in_game/ab_num_in_game/pitch_num_in_ab, 2,576,230 rows)
     so the engine can run from the DB. Prod replay pending (`scripts/sql/pitch_log_sequence_backfill_steps.sql`).
- **team_war_snapshots**: a single date-filtered run (regular season ≤5/18); FOLDS INTO the recalibration push
  (depends on the recalibrated WAR — reseeding now would be redone). Not standalone.
- **NEXT MAJOR EFFORT = the RECALIBRATION (Step 1+, docs/PUSH2_RECALIBRATION_PLAN.md + COMBINED plan):**
  centralize the 7 oWAR copies + flip oWAR D1 constants (RUNS_PER_PA 0.174, REPLACEMENT 2.0/600, RPW 13.1) +
  pWAR to research D1 + refresh_composite_war /10→/13.1; reconcile dWAR/bsrWAR to FULL-season for the player
  store (composite currently o=full, d/bsr=regular); display swap (o_war→total_hitter_war via pickHitterWar/
  pickPitcherWar); ONE staging re-precompute (snapshot between); reseed team_war_snapshots; repoint market value
  → ONE prod push with changelog. Prod also needs the sequence-column replay + the Push-1-style prod steps.


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
