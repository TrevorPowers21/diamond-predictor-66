# STEP 0 — pitch-log stat accrual · LIVING RESUME DOC (read this first after any compaction)

**Branch:** `feature/war-recalibration`. **Parent plan:** `docs/COMBINED_RECALIBRATION_PITCHLOG_PLAN.md`.
**Agent knowledge:** `docs/AGENT_LEARNINGS_defensive_runs_engine_2026_08_03.md`. This doc is the single
resume point for the Step 0 build — update the "RESUME POINT" block below as work progresses.

## RESUME POINT (update this every chunk)
- **CHUNK 6 IN PROGRESS — consolidated pitcher line BUILT + VALIDATED.** `scripts/drs/accrue_pitcher_line.py`
  = one pass producing the full pitcher line (IP/BF/K/BB/HBP/H/HR/ER -> ERA/FIP/WHIP/K9/BB9/HR9/K%/BB%) for
  FULL (all games) + REGULAR (<=5/18) splits. Validated: FULL vs Full Master + REGULAR vs Regular Master both
  ERA mean|Δ| 0.232 (89% within 0.5), FIP 0.063, WHIP 0.027, IP 0.52; reg_IP<=full_IP for all. Output
  `scripts/drs/output/pitcher_line.csv` (full_* + reg_* cols).
- **ERA = pitch-log-native (Trevor's decision, like SB): store the calc, cross-check Master routinely**
  (`scripts/drs/validate_vs_master.py`). Residual ~11% >0.5 ERA = WP-vs-PB unlabeled in the pitch log
  (CONFIRMED irreducible: my error detection already beats the pitchResult flags 0-missed; no column recovers WP/PB).
- **SEQUENCE COLUMNS IMPORTED TO STAGING** (pitch_num_in_game/ab_num_in_game/pitch_num_in_ab, 2,576,230 rows;
  cleanup done). Prod replay pending (scripts/sql/pitch_log_sequence_backfill_steps.sql; PROD_MIGRATIONS_TODO).
  CLI is linked to PROD (trbvxuoliwrfowibatkm) — staging DDL must be pasted in the staging editor.
- **OVERWRITE TARGET = `Pitching Master`:** main stat cols (IP/ERA/FIP/WHIP/K9/BB9/HR9/bb_pct/k_pct/bf) hold the
  FULL-season line; only `regular_season_ip` exists for the regular split (NO reg_era/fip/... columns).
- **DECISION PENDING (Trevor) before the overwrite loader:** store the full regular split per-pitcher (ADD
  reg_* columns to Pitching Master) vs just full-season line + regular_season_ip (regular aggregates live at the
  team level in team_war_snapshots). And confirm we REPLACE the Master's ERA with the pitch-log ERA (0.232).
- **NEXT:** (a) resolve the split-storage decision; (b) build the overwrite loader (staging first, paste-SQL/
  script writing to Pitching Master keyed source_player_id+Season); (c) optional DB-parity check (calc from the
  DB pitch_log matches the CSV result) for production readiness. Then reconcile dWAR/bsrWAR to full-season.


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
