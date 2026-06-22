# 2026 Pitch Log Build — Architecture, Schema, and Phase Plan

Generated 2026-06-18 from a session with Trevor + analysis of actual TruMedia CSV exports.

**Scope:** Ingest TruMedia pitch-by-pitch CSVs into Supabase, build aggregations and rate stats, and surface per-player filterable splits on Player / Pitcher Profile. Targets the 2026 season as the pilot. **Expected volume: 2M+ pitches across the full season.**

This document is the working spec — picks up wherever the build stops between sessions. Keep updated as decisions get locked.

---

## 1. Reference Documents

Trevor + Sam working session docs (Google Drive, `RSTR IQ Data` shared folder):

| Doc | Drive ID | Key content |
|---|---|---|
| `RSTR_IQ_Metrics_Session_Notes` | `1JiMZmR4w4pE7zZ6I6r8Bcq_VaqXY6uTBRMla_08VIOk` | Layer 1 (counting stats), Layer 2 (rate stats), Layer 3 (filter splits), formula definitions, locked rulings |
| `RSTR_IQ_Pitch_Log_Session2_Notes` | `1K4FR1USzeRQZ8rTcXeIEJzM0D0jrpZ8VRONB0R0Xdec` | Column-by-column audit of TruMedia export, philosophy "keep more not less", ingestion brief |

**Sample CSV used for the 2026-06-18 column analysis:** `Feb13 Pitch Log.csv` (1857 rows, 28MB). The 8 CSVs visible in Drive cover Feb 13 → March 7.

---

## 2. Architecture (4 layers, all stored — no live computes)

Per Trevor's hard requirement: **no live aggregation queries on the raw pitch log at view time.** Every filter the Profile UI exposes must read from a precomputed summary row.

```
Layer 1: pitch_log_2026          (raw, ~2M rows, indexed)
                ↓ (breaking-ball reclassification + Stuff+ per-pitch)
Layer 2: pitch_log_totals_2026   (counting stats per player+side+season)
                ↓ (rate calculations)
Layer 3: pitch_log_rates_2026    (percentages, EV90, Stuff+ avg, etc.)
                ↓ (split slices)
Layer 4: pitch_log_splits_2026   (filter columns: vs LHP, vs 95+, weekday/weekend, home/away, etc.)
                ↓
Display:  Player Profile + Pitcher Profile filter UI reads Layer 4
```

**Both hitter and pitcher metrics computed from the same raw pitch log.** Same pitch credited to both sides — a whiff is negative for hitter, positive for pitcher.

---

## 3. CSV Structure (verified from actual file read)

### Total: 84 columns

### Critical CSV quirks to handle

1. **4 silent duplicate column names** at different positions:
   | Name | Positions |
   |---|---|
   | `pitchingTeam` | cols 47 and 66 |
   | `pitchingTeamId` | cols 48 and 67 |
   | `battingTeam` | cols 49 and 63 |
   | `battingTeamId` | cols 50 and 64 |
   
   **Ingestion MUST use position-indexed `csv.reader`, NOT name-indexed `csv.DictReader`** — DictReader silently drops the first occurrence.

2. **Foul balls carry ExitVel and LaunchAng** in TruMedia. In the sample file: 292 fouls, 157 (53.8%) have ExitVel populated. Every EV/EV90 calculation MUST gate on `is_foul = false` or numbers get polluted.

3. **Three duplicate metric fields** (same data, different format):
   | Field | Col | Format |
   |---|---|---|
   | `releaseVelocity` | 26 | numeric |
   | `Vel` | 74 | numeric |
   | `exitVelocity` | 27 | numeric |
   | `ExitVel` | 81 | numeric |
   | `probSL` | 29 | decimal 0–1 |
   | `pCallStrk%` | 83 | percent string "100.0%" |
   
   Keep one of each pair. Use `Vel`, `ExitVel`, `probSL`.

### Always-empty columns (drop unconditionally)

100% empty in the sample file:
- `tarantulaVideoHostedCFURL` (col 1)
- `statcastFieldersInitialFielderPosition` (col 28)
- `hasKinatraxData` (col 34)
- `SessionType` (col 36)
- `pathEff` (col 53)
- `outProb` (col 60)

### EV-presence-by-outcome verification (sample file)

Confirms doc rules:

| Outcome | Total | With EV | Notes |
|---|---|---|---|
| Ball | 629 | 0 | clean |
| Walk | 53 | 0 | clean |
| Hit By Pitch | 12 | 0 | clean |
| Strike Looking | 284 | 0 | clean |
| Strike Swinging | 148 | 4 (2.7%) | edge case — likely foul-tip swings |
| Strikeout (Swinging) | 83 | 0 | clean |
| **Foul** | **292** | **157 (53.8%)** | **MUST be excluded from EV calcs** |
| Single on a Ground Ball | 33 | 25 (75.8%) | expected — Hawkeye gaps |
| Double on a Line Drive | 11 | 10 (90.9%) | normal |
| Home Run (any) | 10 | 10 (100%) | EV embedded in result string too |

### 41 unique pitchResult strings (sample file)

```
'', 'Ball', 'Ball in the Dirt', 'Catcher Interference',
'Double Play', 'Double on a Fly Ball', 'Double on a Ground Ball',
'Double on a Line Drive', "Fielder's Choice", 'Fly Out', 'Foul',
'Ground Out', 'Hit By Pitch',
'Home Run on a 336.56 ft Fly Ball', ..., 'Home Run on a 435.56 ft Fly Ball',
'Intentional Ball', 'Intentional Walk', 'Line Out', 'Pop Out',
'Reached on Error on a Ground Ball', 'Reached on Error on a Line Drive',
'Sac Bunt', 'Sac Fly',
'Single on a Bunt Ground Ball', 'Single on a Fly Ball',
'Single on a Ground Ball', 'Single on a Line Drive', 'Single on a Pop Up',
'Strike Looking', 'Strike Swinging',
'Strikeout (Looking)', 'Strikeout (Swinging)',
'Triple on a Line Drive', 'Walk'
```

**HR strings embed distance** (`'Home Run on a 392.99 ft Fly Ball'`) — parseable bonus. Need a normalization function `parse_pitch_result(str) → category` that maps to clean buckets.

### pitchType raw codes (9 unique)

| Code | Full | Notes |
|---|---|---|
| `FA` | Fastball | |
| `SL` | Slider | needs reclassification → Slider / Sweeper / Gyro Slider |
| `CU` | Curveball | |
| `CH` | Changeup | |
| `FC` | Cutter | |
| `FS` | Splitter | |
| `SI` | Sinker | |
| `UN` | Unknown | drop or NULL pitch_type_reclassified |
| `''` | (missing) | |

Reclassification logic exists in the codebase — **TBD: locate file path** (open question §7).

---

## 4. Schema Design

### Layer 1: `pitch_log_2026` (raw, ~2M rows)

**One row per pitch.** Per Trevor: "keep more, not less" — preserve native column structure even where some fields are sparse.

```sql
CREATE TABLE pitch_log_2026 (
  -- Primary key
  uniq_pitch_id text PRIMARY KEY,           -- CSV col 7 (encodes game+AB+pitch#)
  
  -- Game context
  date timestamptz NOT NULL,                -- CSV col 19
  game_venue_id text,                       -- CSV col 32
  level text,                               -- CSV col 33 (e.g. 'BBC')
  home boolean,                             -- CSV col 38 (parsed from 'true'/'false')
  inn text,                                 -- CSV col 22 ('Top 1', 'Bot 3')
  outs integer,                             -- CSV col 23
  
  -- Player IDs (CORE — must match players.source_player_id)
  pitcher_id text NOT NULL,                 -- CSV col 68 (BP)
  batter_id text NOT NULL,                  -- CSV col 65 (BM)
  catcher_id text,                          -- CSV col 71
  
  -- Display names
  pitcher_full_name text,                   -- CSV col 9
  pitcher_abbrev_name text,                 -- CSV col 18
  batter_abbrev_name text,                  -- CSV col 17
  catcher_abbrev_name text,                 -- CSV col 72
  
  -- Handedness
  pitcher_hand char(1),                     -- CSV col 16 ('L'/'R')
  batter_hand char(1),                      -- CSV col 14
  
  -- Team context
  pitching_team_id text,                    -- CSV col 67 (second occurrence)
  batting_team_id text,                     -- CSV col 64 (second occurrence)
  catching_team_id text,                    -- CSV col 70
  team_id text,                             -- CSV col 43
  opponent_id text,                         -- CSV col 44
  
  -- Outcome
  pitch_result text,                        -- CSV col 21 (nullable — edge cases like Catcher Interference may be blank; row still counts toward "pitches seen")
  pitch_result_category text,               -- derived: Strike/Ball/Walk/HBP/HR/Single/Double/Triple/GroundOut/FlyOut/LineOut/PopOut/Sac/Error/Strikeout/Foul
  count text,                               -- CSV col 31 ('0-0' etc.)
  
  -- Pitch classification
  pitch_type text,                          -- CSV col 24 (raw: FA/SL/CU/CH/FC/FS/SI/UN)
  pitch_type_reclassified text,             -- post-pass after breaking-ball logic
  
  -- Pitch metrics
  release_velocity numeric(5,2),            -- CSV col 74 (Vel)
  exit_velocity numeric(5,2),               -- CSV col 81 (ExitVel) — NULL when pitch wasn't put in play OR was foul
  launch_angle numeric(5,2),                -- CSV col 82
  cs_prob numeric(6,5),                     -- CSV col 29 (probSL, 0–1)
  ivb numeric(5,2),                         -- CSV col 75 induced vertical break
  hb numeric(5,2),                          -- CSV col 76 horizontal break
  extension numeric(4,2),                   -- CSV col 77
  spin numeric(6,1),                        -- CSV col 78 (rpm)
  rel_height numeric(4,2),                  -- CSV col 79
  rel_side numeric(4,2),                    -- CSV col 80
  
  -- Location
  x_loc numeric(8,6),                       -- CSV col 11
  y_loc numeric(8,6),                       -- CSV col 12

  -- Tracking-data presence flags (generated, 3-tier model)
  has_velo boolean GENERATED ALWAYS AS (
    release_velocity IS NOT NULL
  ) STORED,                                 -- TRUE = velo captured (allows 95+ filter)
  is_data boolean GENERATED ALWAYS AS (
    release_velocity IS NOT NULL AND ivb IS NOT NULL AND hb IS NOT NULL
  ) STORED,                                 -- TRUE = full capture (allows Stuff+ / movement metrics)
  
  -- Score state (high-leverage / close-game filter source)
  total_runs integer,                       -- CSV col 41 (final)
  current_runs integer,                     -- CSV col 42 (at this pitch)
  opponent_current_runs integer,            -- CSV col 46
  opponent_runs integer,                    -- CSV col 45 (final)
  
  -- Computed boolean flags (filled post-ingest)
  is_foul boolean,
  is_in_play boolean,
  is_batted_ball_in_play boolean,
  is_strike boolean,
  is_in_zone boolean,
  is_swing boolean,
  is_whiff boolean,
  is_chase boolean,
  
  -- Computed per-pitch values (filled post-ingest)
  stuff_plus numeric(5,2),                  -- from Stuff+ model
  
  -- Audit
  imported_at timestamptz NOT NULL DEFAULT NOW(),
  csv_source text                           -- e.g., 'Feb13 Pitch Log.csv'
);

CREATE INDEX idx_pitch_log_pitcher_date ON pitch_log_2026(pitcher_id, date);
CREATE INDEX idx_pitch_log_batter_date  ON pitch_log_2026(batter_id, date);
CREATE INDEX idx_pitch_log_pitch_type   ON pitch_log_2026(pitch_type_reclassified);
CREATE INDEX idx_pitch_log_date         ON pitch_log_2026(date);
```

**Open call:** Trevor leaning toward single `pitch_log` table with a `season` integer column instead of per-season tables. **TBD §5.**

### Layer 2: `pitch_log_totals` (counting stats)

One row per `(player_id, side, season)`. Both hitter and pitcher have rows for every metric.

Fields per the Session 1 doc — Strike number, Ball number, Batted ball total, In-zone, Whiff, GB/LD/FB/PU, Barrel, Hard hit, BB, Chase, LA 10-30, IZ whiff, IZ swing, CSW (pitcher only), Hit, Total bases, On-base.

Plus pitch-type totals per the 8 reclassified types.

### Layer 3: `pitch_log_rates` (rate stats)

One row per `(player_id, side, season)`. Joins to Layer 2 totals for denominators.

Avg EV (BBIP), EV90 (BBIP), Contact %, Whiff %, GB/LD/FB/PU %, Walk %, Chase %, Barrel %, LA 10-30 %, Hard hit %, IZ whiff %, IZ %, CSW % (pitcher), Stuff+ (avg per pitch).

Triple-slash derived: SLG (TB/AB), OBP (OB/PA), ISO, Runs Created.

#### Data reliability tier

Two columns per (player_id, side, season):

| Column | Formula |
|---|---|
| `data_reliability_pct` | `COUNT(*) FILTER (WHERE is_data) / COUNT(*)` over the player's pitches |
| `data_reliability_tier` | Percentile bucket of `data_reliability_pct` across all players this season |

**Tier bucketing**: compute the season-wide distribution of `data_reliability_pct`, then assign each player's value a tier (top tier, above average, average, below average, poor) using percentile cutoffs — same approach as the existing scouting tiers. Means "this player's sample is in the top X% for tracking completeness," answering whether the coach should trust the numbers.

Surfaced on Profile alongside the stats so coaches see "Stuff+ 108 (tracking: elite)" vs "Stuff+ 108 (tracking: poor — small sample)."

### Layer 4: `pitch_log_splits` (filter columns)

One row per `(player_id, side, season, dimension_key)`. Same metrics as Layer 3 but scoped to a filter dimension.

Initial dimension_key values per the docs:
- `all` (baseline)
- `vs_lhp`, `vs_rhp`
- `vs_95plus` (release_velocity >= 95)
- `stuff_100plus`, `stuff_105plus`
- `weekday`, `weekend`
- `home`, `away`
- `high_lev` (within 3 runs in inning 7+)
- `close_game` (1-run game)
- More as Trevor adds

---

## 5. Locked Rulings (from Session 1 doc, do NOT re-derive)

- **Strike rate INCLUDES balls in play.** Strike # = strike looking + strike swinging + foul tip + balls in play.
- **EV / EV90 are batted-balls-in-play only.** Foul balls excluded, even though they carry EV in TruMedia.
- **In-zone whiff denominator is swings in zone** (NOT pitches in zone).
- **CSW % is over total pitches**, not over swings. Intentional — penalizes pitchers for throwing balls. FanGraphs / Alex Fast definition.
- **Ground ball cutoff is launch angle < 10** (strict, NOT ≤ 10).
- **Barrel is EV ≥ 95 AND LA 10–35.** Future MLB-style scaling concept parked.
- **One credit per at-bat** via the dedup key (uniqPitchId encodes AB#).

### Pitch type reclassification

The existing breaking-ball reclassification logic (per the Session 1 doc, "already stored in the code") splits raw `SL` into:
- Slider
- Sweeper
- Gyro Slider

And possibly other refinements. **Need to locate the implementation file — open question §7.**

### Stuff+ per pitch

Existing Stuff+ model (per the doc, "already built"). Runs per-pitch on the reclassified pitch type. **Need to locate — open question §7.**

---

## 6. Phase Plan

### Phase 1: Raw ingestion (in progress)

1. Create `pitch_log_2026` table migration
2. Build `scripts/ingest_pitch_log.ts` — reads CSV by path, batch-inserts 1000 rows at a time, idempotent on `uniq_pitch_id`
3. Ingestion does NOT compute boolean flags or Stuff+ — those are post-passes
4. Test against staging with `Feb13 Pitch Log.csv` (smallest)
5. Verify row count, pitcher_id / batter_id match `players.source_player_id`, NULL handling on empty cells
6. Run full ingestion of all 8 CSVs against staging

### Phase 2: Computed flags + reclassification

Migration adds the empty columns; three post-pass scripts populate.

**2a — Flag derivation** ([scripts/derive_pitch_log_flags.ts](scripts/derive_pitch_log_flags.ts))
Single SQL UPDATE classifies `pitch_result` into category + booleans (`is_foul`, `is_in_zone`, `is_strike`, `is_swing`, `is_whiff`, `is_chase`, `is_in_play`, `is_batted_ball_in_play`). Idempotent on `is_foul IS NULL`.
Run: `npm run derive-pitch-log-flags -- --apply`

**2b — Pitch type reclassification** ([scripts/reclassify_pitch_log.ts](scripts/reclassify_pitch_log.ts))
Ports `reclassifyRHP` / `reclassifyLHP` from `breakingBallReclassification.ts` to inline SQL CASE. Splits raw SL / CU / FC by movement (IVB / HB / rel_height) into Slider / Sweeper / Gyro Slider / Cutter / Curveball. Non-breaking types (FA / SI / CH / FS) map directly. Idempotent on `pitch_type_reclassified IS NULL`.
Run: `npm run reclassify-pitch-log -- --apply`

**2c — Stuff+ per pitch** (NOT YET BUILT — defer until 2a + 2b verified)
Score each pitch via `calculateStuffPlus` from `stuffPlusEngine.ts`, then recenter each (pitch_type × hand) bucket so mean = 100 (Option A from §7). JS-required (the engine has 9 per-pitch-type scoring functions, not portable to inline SQL).

**Verification after 2a + 2b**: pick 5–10 sample pitchers, confirm pitch-type distribution matches Pitching Master observed values, spot-check Sweeper/Gyro/Slider splits look reasonable.

### Phase 3: Layer 2 + 3 aggregations

1. Create totals + rates tables
2. Build aggregation script — rolls up from Layer 1 to Layer 2, derives Layer 3
3. Compare against existing PitcherProfile / PlayerProfile rate stats for ~10 sample pitchers
4. Identify any discrepancies (this is where the wrong-pitch-usage issue Trevor flagged gets resolved — see [[project_pitch_usage_audit_pending]])

### Phase 4: Layer 4 splits

1. Add split dimensions one at a time (vs LHP, vs 95+, etc.)
2. Each becomes a row per `(player_id, side, season, dimension_key)`

### Phase 5: Profile UI

1. Filter dropdown on PlayerProfile + PitcherProfile
2. Reads Layer 4 single-row lookup
3. Side-by-side comparison vs current displays for verification (see audit memory)
4. Swap displays when confidence is established

### Phase 6: Productionization

1. Drive ingestion path (automatic CSV pull instead of manual upload)
2. Per-outing incremental updates as new CSVs land
3. Fall intrasquad use case — sell to programs

---

## 7. Resolved + Open Questions

### Resolved 2026-06-19

1. **Breaking-ball reclassification location:** `src/savant/lib/breakingBallReclassification.ts`
   - Key exports: `reclassifyRHP(ivb, hb, relHeight)` and `reclassifyLHP(ivb, hb, relHeight)` (and `reclassify(row)` wrapper)
   - Returns one of: `Cutter` | `Gyro Slider` | `Curveball` | `Sweeper` | `Slider`
   - Priority order (RHP):
     1. `ivb > gyroCap` → Cutter (gyroCap = 6 if high slot ≥ HIGH_SLOT_THRESHOLD_FT, else 3)
     2. `ivb >= -3 AND hb in [-7, 7]` → Gyro Slider
     3. `ivb <= -8` → Curveball (depth wins, HB-agnostic)
     4. `hb <= -11 AND ivb > -4` → Sweeper
     5. else → Slider (default)
   - LHP mirrors the HB signs (`hb >= 11` for Sweeper, etc.)
   - **Pure function — no DB calls.** Per-pitch application is straightforward: feed each pitch's `ivb`, `hb`, `rel_height` directly.
   - Currently used at the aggregate-pitcher level (`pitcher_stuff_plus_inputs` rows). For per-pitch use, just call the function directly per row in Phase 2.
   - The file also contains aggregate-only logic (`consolidate()`, boundary/outlier detection, population averages) that's NOT relevant per-pitch — only the `reclassifyRHP`/`reclassifyLHP`/`reclassify` functions matter for our use.

2. **Stuff+ model location:** `src/savant/lib/stuffPlusEngine.ts`
   - Key export: `calculateStuffPlus(pitchType, row, popConstants)` — returns `{ score, zs }` or null
   - Handles 9 pitch types: `4S FB`, `Sinker`, `Cutter`, `Gyro Slider`, `Slider`, `Sweeper`, `Curveball`, `Change-up`, `Splitter`
   - Per-pitch-type functions: `calc4SFB`, `calcSinker`, `calcCutter`, `calcGyroSlider`, `calcSlider`, `calcSweeper`, `calcCurveball`, `calcChangeup`, `calcSplitter`
   - Population constants pulled from `pitcher_stuff_plus_ncaa` table (per pitch_type × hand bucket, D1 only — JUCO uses D1 baselines per locked memory)
   - **Z-scoring + bucket recentering** — `runStuffPlusPipeline()` recenters per-(pitch_type×hand) bucket means against population so Stuff+ lands at mean=100. For per-pitch application, we can either:
     - **Option A:** Score per-pitch, then recenter the entire pitch-type×hand bucket so the bucket's mean = 100. (Matches existing pipeline behavior.)
     - **Option B:** Use the existing aggregated `pitcher_stuff_plus_inputs` rows as the Stuff+ source and join into pitch log for display only.
   - **Recommend A** for Phase 2 — full per-pitch independence + recenter pass during aggregation.
   - Pre-existing input type `PitchRow` has aggregate fields (`pitches` count, `fb_ch_velo_diff`). For per-pitch we'd pass `pitches = 1` and compute `velo_diff` separately.

### Still open

3. **Per-season table (`pitch_log_2026`) or single `pitch_log` with `season` column?** Recommend single table with column. **TBD — confirm.**
4. **Confirm column 67 (pitching_team_id second occurrence) is the one to keep** over column 48. Audit suggested the second is the user-selected version.
5. **Drive ingestion now or manual upload first?** Recommend manual to start.
6. **CSV staging area** — local folder convention? `~/dev-main/pitch_logs/` or similar?
7. **Computed flags timing** — during ingest (slower per-row) or post-ingest pass (cleaner)? Recommend post-pass.

---

## 8. Related Memory Files

- [[project_pitch_usage_audit_pending]] — existing pitch usage on Profile looks wrong, this build is the fix
- [[project_target_board_refactor_deferred]] — separate architectural debt, July/Aug
- [[project_pitcher_role_systemic_fix]] — separate, also deferred

---

## 9. Process Notes

- This is a 2M+ row build. **Do not rush ingestion.** Build in concept fully, validate sample data end-to-end, then scale.
- Locked rulings live in §5 — re-derive these only if Trevor + Sam revisit explicitly.
- Profile display swap happens LAST and only after side-by-side comparison validates new numbers vs current (per the pitch usage audit memory).
