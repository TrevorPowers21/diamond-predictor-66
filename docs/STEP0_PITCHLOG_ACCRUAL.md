# STEP 0 — pitch-log stat accrual · LIVING RESUME DOC (read this first after any compaction)

**Branch:** `feature/war-recalibration`. **Parent plan:** `docs/COMBINED_RECALIBRATION_PITCHLOG_PLAN.md`.
**Agent knowledge:** `docs/AGENT_LEARNINGS_defensive_runs_engine_2026_08_03.md`. This doc is the single
resume point for the Step 0 build — update the "RESUME POINT" block below as work progresses.

## RESUME POINT (update this every chunk)
- **CHUNK 1 (parser) + CHUNK 2 (pitcher accrual) + CHUNK 3 (hitter accrual) DONE + committed.** Parser
  parse-fails cut **1.01% -> 0.11%** (chunk-3 extensions: multi-RBI `(2RBI)` parens, `TH` throw-error mod,
  `+WP/+SB/+PB` compound events on W/K, `CI` catcher-interference, `CS/PO/pickoff` -> `is_pa=False` so they're
  excluded from PA cleanly, `BATINT/FDP` mods). Hitter accrual `scripts/drs/accrue_hitter_stats.py` +
  pitcher `accrue_pitcher_stats.py`; both skip `not ev.is_pa`.
- **HITTER accrual VALIDATED (all-games):** vs `Hitter Master` (n=3647 ab>=50) AVG mean|Δ| **0.001**, OBP 0.002,
  SLG 0.003 (93-96% within .010); PA gap -1.0, AB gap -0.8. Piasecki EXACT: PA343/AB283/.336/.446/.523 both sides.
- **MAJOR ARCHITECTURE DISCOVERY (2026-08-08):**
  1. **Hitter Master is ALREADY pitch-log-derived** (Trevor's "we overrode hitters w/ pitch log" = CONFIRMED —
     my re-accrual reproduces it exactly). So the hitter Master match is a CONSISTENCY check, not independent.
     Independent hitter rail = official box-score totals (SB-count pattern), not the Master.
  2. **`pitch_log_hitter_totals` (50,418 rows) + `pitch_log_pitcher_totals` (37,306 rows) ALREADY EXIST** —
     the prior pitch-log aggregation, per (pitcher/batter_id, season, dimension_key: all/vs_rhp/vs_lhp/...).
     HITTER totals carry the FULL line (PA/AB/1B/2B/3B/HR/K/BB/HBP/SAC + all sub-metrics + x-stats). PITCHER
     totals carry BF/PA/K/BB/HBP/hits-allowed/stuff+/tracking/x-stats — **but NO outs/IP and NO runs/ER.**
  3. Builder = **`scripts/aggregate_pitch_log_dimensions.ts`** — SQL `INSERT...SELECT COUNT(*) FILTER` off the
     per-pitch `pitch_result_category` column. It CANNOT compute outs/IP or ER (those need atbat_desc parsing).
  4. So the pitcher "whole 'nother run" = **add IP (outs) + ER to the pitcher totals from atbat_desc** — exactly
     what chunk-2 accrual computes. Extension, not rebuild. Prior `scripts/calibrate_xera.ts` = expected-ERA work.
- **POSTSEASON (open question flagged to Trevor):** pitch log spans 2026-02-13 -> **06-22** incl. conf tourneys +
  NCAA (postseason = 33,801 PA, 4.9%). All-games accrual matches Master AB -0.81; **reg-season-only (<=5/18,
  Option A) is -8.47** -> the current Master appears to INCLUDE postseason (or double-counts, Trevor unsure).
  DECISION PENDING for the overwrite: store reg-season-only (true to Option A WAR) vs all-games (matches today's
  Master). Mid-major negative gaps (ALCN -10.5) = separate inherent untracked-game coverage, already accepted.
- **ERA (chunk 2):** unbiased mean Δ -0.05, per-pitcher mean|Δ| 0.88 = inherited-runner attribution (mound
  simplification). FIP/WHIP/K9/BB9/HR9/IP match tightly (independent, since Pitching Master = reimported TruMedia).
- **INDEPENDENT VALIDATION DONE (2026-08-08):** Trevor pulled the 4 real TruMedia exports (Regular/Full x
  Hitting/Pitching Master Stats.csv, in docs/drs-reference/, playerId key, reg=<=5/18 full=all). Archived into
  the sources-of-truth tarball (217MB) + manifest. My pitcher accrual (all-games) vs **Full Pitching Master**
  (n=2835 IP>=20): IP mean|Δ| 0.71 (100% w/in 3), K 0.08, BB 0.06, HR 0.002, H 0.05, BF 0.32, FIP 0.06, WHIP
  0.035 — ALL match the INDEPENDENT source. **Only ER/ERA off: ER mean|Δ| 3.67, ERA 0.87 (mean Δ +0.02).**
  Biggest misses have matching IP but ER swinging both ways (30v18, 26v40) = 100% CONFIRMED inherited-runner
  attribution (mound simplification), a redistribution (mean nets ~0), not a tally bug.
- **DECISION PENDING w/ Trevor — ERA path:** (A) build inherited-runner ER attribution (pitch-log-native inning
  state machine; base-state is in pitch_log) vs (B) take ER/ERA from the Master export (now a validated
  independent source) + pitch-log everything else. FIP matches either way + is projection-preferred. My lean: A.
- **BOUNDARY (still to verify):** my reg-season accrual should match Regular Master; full should match Full
  Master — confirms 5/18 = TruMedia's regular season. Quick check, not yet run.
- **THEN chunk 6:** extend pitcher totals/loader with IP+ER (+ chosen ERA path) -> derive ERA/FIP/WHIP ->
  overwrite Pitching Master (staging first), full + regular splits per the locked policy.


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
