# MASTER HANDOFF — 2026-06-28

Single deep-detail handoff for a fresh session. Covers: (1) what shipped to
staging this session + the code/process detail, (2) the configurable
Visuals-tab / zone-field toggle design, (3) the full Inferred Bat Speed +
Squared-Up structure, (4) prod upload plan, (5) memory cleanup plan, (6)
tomorrow. Self-contained — drop into a clean session and resume.

Repo: `~/dev-main/diamond-predictor-66`. Staging `slrxowawbijbjrkozqlj`
(`.env.local`), prod `trbvxuoliwrfowibatkm` (`.env.production.local`).
Active feature branch, **not merged**. Everything below is on **staging**.

---

# PART 1 — WHAT SHIPPED THIS SESSION (pitch_log spray + zone + power ratings)

## 1.1 The goal / framing
Make the **internal power ratings read pitch_log FIRST** (2026 Master is the
cross-check, not the source). This is **display only** — the stored projections
and precompute are untouched (that's the July step). Pitch_log is 2026-only; for
2025/earlier the displays still read Master.

## 1.2 Power ratings now pitch_log-first (both player pages, bottom-left admin block)

### Pitcher — `src/pages/PitcherProfile.tsx`
- Added `pitchLogTotalsRow` query (pitch_log_pitcher_totals, dim `all`, season
  `effectiveSeason`, enabled only when `effectiveSeason===2026`) + `pitchLogMetrics`
  memo deriving the 14 sub-metrics.
- The `internalPowerRatings` useMemo's `metrics` object reads **pitch_log first,
  Master second** per metric: `pl?.iz ?? parseNum(powerRatingsRow[12])`, etc.
- Why it mattered (Volantis case): his **2026 Pitching Master `in_zone_pct` is
  null** (the TruMedia CSV gap) → `metrics.iz` null → `scores.iz` null →
  `hasBb9Inputs` false → BB/9 → FIP → Overall all `—`. pitch_log has his IZ%
  (48.1) → now computes. Fixed the mislabeled "2025 Input Metrics" header →
  `{effectiveSeason} Input Metrics · pitch log`.
- The IZ% display card reads the same `internalPowerRatings.metrics.iz`, so the
  one fix repairs both the cards and the cascade.

### Hitter — `src/pages/PlayerProfile.tsx` + `src/hooks/usePitchLog2026HitterRates.ts`
- The hook already powered `pitchLogPowerDerived = computeHitterPowerRatings(...)`
  but **`ev90` and `pull` were hardcoded `null`** ("deferred — can't derive yet").
  We now derive them: `ev90 ← ev_90` (gated on tracked-BIP floor 5),
  `pull ← directional pull% = batted_pull/(batted_pull+batted_center+batted_oppo)*100`
  (matches HM `pull` baseline 36.5, NOT pull-air). Hitter `isoPower` REQUIRES
  ev90Score + pullScore → null pull/ev90 was blanking ISO+ → Overall+ (the hitter
  analogue of the pitcher HR9 blank). Filling them fixes it.
- In PlayerProfile, `activeSeasonScoutingGrades`: `ev90Score`, `pullScore`, and the
  `baPlus/obpPlus/isoPlus/overallPlus` roll-ups now read **pitch_log first**
  (gated `effectiveSeason===2026` via `plPower`), Master fallback. Input-metric
  cards prefer pitch_log too (`plRates`). Verified the pWAR/market path reads
  `projectionSourceRow.overall_power_rating` SEPARATELY → stored values untouched.

### Calibration note (locked for now, verify vs HM later)
Pull% for the power rating = **directional pull%** (~33-44%, matches HM `HPull%`
/ `pull` baseline 36.5). NOT pull-air (~16%). EV90 = `percentile_cont(0.9)` of
own/allowed EV — reproduces HM's `90thExitVel`.

## 1.3 Spray storage (per-row labels + aggregation)
- Migration `supabase/migrations/20260627000000_pitch_log_pull_air_la_ev90.sql`:
  pitch_log `hit_location` + `batted_direction`; totals tables get section /
  direction / pull-air / EV90 / LA10-30 columns (pitcher) and the 5 sections +
  pull/oppo + pull-air + EV90 (hitter).
- **`hit_location`** (absolute field section, batter-agnostic, from `spray_ang`):
  far_left −45..−30, left_center −30..−15, center −15..15, right_center 15..30,
  far_right 30..45. → drives the BaseballField viz (its `COL_BOUNDS` were synced
  to `[-45,-30,-15,15,30,45]`).
- **`batted_direction`** (pull/center/oppo, center band ±15, RHB pulls left / LHB
  pulls right, resolved per-row by `batter_hand` so **switch hitters are exact**
  — verified 170 switch hitters in the data show both L and R rows).
- Aggregator (`scripts/aggregate_pitch_log_dimensions.ts`) counts these labels +
  `percentile_cont(0.9)` EV90 on both totals tables.
- Backfilled 394K batted balls on staging; all 10 dimensions re-aggregated.

## 1.4 Zone storage (the big one — foundation for the configurable display)
- Migration `supabase/migrations/20260628000000_pitch_log_by_zone.sql`:
  pitch_log `pitch_zone` (text) + two tables `pitch_log_pitcher_by_zone` /
  `pitch_log_hitter_by_zone` mirroring the `by_pitch_type` column set (full count
  components) keyed `(player_id, season, pitch_zone, dimension_key)` + `ev_90` +
  RLS authenticated-read.
- **13-zone label** = `zoneForPitch` in `src/savant/components/PitchZone*.tsx`
  EXACTLY: in-zone unit square (px/pz ∈ [-1,1]) → '1'..'9' (3×3, row0=top pz>1/3,
  col0=left px<-1/3); outside → 'UL'/'UR'/'LL'/'LR' by sign; |px|>4 or |pz|>4 →
  NULL. Absolute (catcher's view), NOT batter-relative inside/outside.
- Derive step `scripts/derive_pitch_log_flags.ts` now sets all three labels
  (`hit_location`, `batted_direction`, `pitch_zone`) on ingest → **future CSVs
  auto-label**.
- Aggregator: `pitcherByZoneSQL` + `hitterByZoneSQL` (GROUP BY pitch_zone, +EV90),
  registered as tasks for all dims.
- Backfilled **2,342,700** pitches on staging; all dims re-aggregated. Verified
  Volantis zone breakdown: whiffs low (z7 52%, LL 83%), weak contact up (z1 EV90
  71) — reads true for a breaking-ball-down lefty.

## 1.5 Code/process lessons baked in (the pain, saved)
- **Big UPDATEs via `exec_sql`/SQL-editor get CANCELLED on the 125s gateway
  disconnect** (rows never commit). INSERT…SELECTs SURVIVE server-side. → Use
  **batched PK-paged scripts** for backfills (`scripts/_backfill_spray_labels.ts`,
  `scripts/_backfill_pitch_zone.ts`): read by PK, `UPDATE … FROM (VALUES …)` via
  exec_sql in 1000-row batches, retry on lock/timeout, idempotent + resumable.
- **`.upsert()` can't partial-update pitch_log** (`season NOT NULL`) — same lesson
  as the Stuff+ build's bulk RPC.
- **Reads over 2.5M on unindexed filters time out** → page by primary key, filter
  in JS.
- **Zombie locks**: a killed/timed-out big UPDATE holds row locks → `lock timeout`
  on new writes. Clear with `scripts/_kill_locks.ts` (terminates pitch_log
  lock-holders >45s via `pg_locks`, not query text — the exec_sql wrapper hides
  the inner UPDATE so name-matching misses it).
- **`vs_top_hitters`** (977-id IN filter + percentile) exceeds 125s → survives
  server-side → the aggregator script exits on it; finish it solo (emit-sql +
  `scripts/_run_sql_file.ts`), wait ~3 min, verify rows committed.

---

# PART 2 — CONFIGURABLE VISUALS TAB / ZONE-FIELD TOGGLE DESIGN (next build)

## 2.1 Current Stats page structure (for context)
`src/savant/components/PitchLogSection.tsx` — a Stats tab (default) + a Visuals
tab. Visuals currently has fixed sections: Pitch Location (StrikeZonePlot,
PitchZoneUsage, PitchUsagePie), Pitch Quality (PitchMovementPlot, PitchZoneXwoba,
PerPitchSuccessTable), Batted Ball (placeholders), Trends (placeholder). The
13-zone charts compute client-side from raw px/pz rows.

## 2.2 The vision (Trevor)
Make the zone/field displays **configurable**:
1. **User picks the metric** that colors each zone heatmap / field display (any
   metric — Usage%, Whiff%, CSW%, Chase%, xwOBA, Avg EV, EV90, Barrel%, Hard-Hit%,
   Stuff+, RV, …).
2. **User adds/removes panels** — choose which tables/visuals to show or hide.
3. Everything respects the active **dimension filter** (vs LHP / vs Fastball / …).

## 2.3 Why zone storage makes this efficient (the decision we made)
- Without storage: each dimension change re-fetches thousands of raw pitches +
  re-buckets in JS. Heavy, repeats per dimension.
- With `*_by_zone` storage: each `(player, dimension)` view = a **13-row read**.
  Metric-switching and dimension-switching are instant.
- **Key principle: store count COMPONENTS per zone, derive the rate at display.**
  The `by_zone` tables carry the full component set (pitches, swings, whiffs,
  called_strikes, chases, batted balls, ev_sum, barrels, hard_hit, x_woba_sum,
  x_hits/bases_sum, RV event counts, stuff_plus_sum, ev_90, …). So ANY menu metric
  derives from one stored row → efficiency AND flexibility together.
- Constraint: only metrics whose components we store. The component set is broad
  enough to cover the realistic menu; a truly custom formula would need raw rows.

## 2.4 UI structure to build
- **Metric selector per zone/field panel** — a dropdown (`MetricPicker`) listing
  the menu; selecting it recolors the heatmap. Shares the existing percentile /
  red-blue color ramp conventions (see PitchZoneXwoba's `xwobaToPercentile` and
  the `strikeZoneCellColor`).
- **Panel manager** — a toggle list (checkbox/chips) of available panels
  (Zone heatmap, Spray field, EV×LA scatter, Per-pitch table, Movement, …); user
  shows/hides. Persist the layout in localStorage (preview) per side
  (pitcher/hitter), like the existing grid state.
- **Data hooks** — new `usePitchLogByZone(playerId, season, dimension)` returning
  the 13 rows; a `deriveZoneMetric(row, metricKey)` switch mirroring the
  `derivePitchTypeBreakdowns` pattern in `src/savant/lib/pitchLogRates.ts`.
- **Field display** — `BaseballField.tsx` (already built, cutoffs ±15/±30); feed
  it the 5 hit_location section counts (already stored per dimension on
  hitter_totals) OR derive from raw rows via `bucketBattedBalls`. The user metric
  can drive `colorInfield`/`colorOutfield` (e.g. avg EV per section).
- **Restructure**: replace the fixed Visuals sections with a **grid of
  configurable panels**. Each panel = `{ type, metricKey, visible }`. The Visuals
  tab renders visible panels; a "+" adds from the panel catalog.

## 2.5 Metric menu (defines the stored components — all already in by_zone)
Discipline: Usage%, Swing%, Whiff%, Contact%, CSW%, Called-Strike%, Chase%,
Zone%(n/a-it-is-the-zone). Outcomes: xwOBA, AVG, SLG, wOBA, K%, BB%, Run Value.
Contact quality: Avg EV, EV90, Hard-Hit%, Barrel%, GB/LD/FB/PU%. Stuff: Stuff+,
Velo. (Pitcher = "allowed" variants; hitter = own.)

## 2.6 Also still-deferred Visuals work (from 06-26 handoff)
- Hitter Visuals tab tilt toward batted-ball quality: 13-Zone EV heatmap, EV×LA
  cartesian density heatmap (better than TruMedia's polar scatter), HitterPerPitch
  SuccessTable, spray field. Hitter RV (mirror pitcher; don't negate the offense
  sum). Trends (rolling xwOBA). Tracking-error filter (`is_data=false` for vel<65
  / rel_height<3 / extension<3 / spin<500).

---

# PART 3 — INFERRED BAT SPEED + SQUARED-UP (full structure)

Working metric: infer a college hitter's bat speed from TruMedia EV + pitch-velo,
no bat tracking. Companion files: the Metric Spec (full PostgreSQL) + the
Calibration Memo (defensibility). Calibrated + defensible: `q_metal = 0.242`,
validated to 1.2 mph RMSE against 5 measured pro bat speeds.

## 3.1 Core method
Collision identity (Nathan): `EV = (1+q)·B + q·P` (EV exit velo, B bat speed,
P pitch speed, q collision efficiency). Invert per ball:

    implied_bat_speed_i = (EV_i − 0.242·P_i) / 1.242

`q_metal = 0.242` (college BBCOR metal). Per-ball conversion (then a percentile)
is what makes it competition-robust: a flush ball off 86 and off 96 back out to
the same bat speed.

## 3.2 The four outputs per hitter-season (over qualified, outlier-cleaned BIP)
- **Floor** = p95 of implied_bat_speed — repeatable swing speed; THE headline;
  what q is calibrated to. Publish + rank on this.
- **Ceiling** = p99 — raw best-flush capability. Scouting context, unstable on
  thin samples, never trusted on Tier C.
- **Runway** = ceiling − floor — consistency / development room. Same floor +
  different runway = opposite development stories.
- **Squared-up rate** (ceiling-denominated analog):
  `potential_EV_i = 1.242·ceiling + 0.242·P_i`;
  `squared_up_pct_i = EV_i / potential_EV_i`; squared_up if ≥ T (T=0.90
  provisional); rate = share of competitive BIP clearing T. Honest label: a
  season ceiling-denominated analog, NOT MLB's per-swing metric. Self-relative
  STYLE axis (contact vs power), not a quality grade — both poles are premium.

## 3.3 Pipeline order (matters — coefficient + estimator are a matched pair)
1. Plausibility: EV 30-125, pitch 55-105.
2. Chop rule: drop EV ≥ 118 at LA < −10 (impossible "crushed into the ground").
3. Tail fence: per hitter, drop EV > p95(EV)+8 (isolated misreads).
4. Convert each ball → implied bat speed (pitch-corrected).
5. p95 (floor), p99 (ceiling), runway, squared-up rate.
6. Confidence by qualified BIP: A ≥120, B 60-119, C 30-59, insufficient <30.

## 3.4 Calibration record
Anchors: 5 2024 first-round college hitters with college-metal + measured first
pro (wood) Statcast bat speed. q_wood ~0.231 from pro (maxEV, BS) pairs. q_metal
fit so the p95 estimator reproduces first-pro bat speed → **0.242, RMSE 1.2 mph**.
Metal premium over wood ~0.011 (<2 mph at flush). Identifying assumption: bat
speed constant across wood/metal at the same time (both drop-3) — confirmed.

| Anchor | College p95 EV | Floor(q=.242) | First pro wood BS | Residual |
|---|---|---|---|---|
| Caglianone | 117.2 | 76.7 | 77.4 | −0.7 |
| Smith | 113.3 | 73.7 | 74.5 | −0.8 |
| Benge | 107.4 | 70.8 | 71.3 | −0.5 |
| Bazzana | 110.2 | 71.6 | 69.5 | +2.1 |
| Kurtz | (2024 injured) | ~73 / ~76(2023) | ~76.5 | validation |

Residuals straddle zero → q reads physics, not a hidden bias.

## 3.5 Validation + rules learned
- External: Georgia staff confirmed floor-as-stable / ceiling-as-peak on Jackson +
  Phelps (down-ballot, the least-tested tier).
- Internal archetype find: squared-up frame (nothing tuned to draft) reproduced
  the contact-vs-power split — Bazzana (#1, contact) top SU 51, Caglianone (#6,
  raw power) bottom 20.
- Rules: robust peak never single max (use p95); pool thin/compromised seasons
  (Kurtz injured 2024 under-read ~2 mph); BASELINE RULE = compare college to a
  hitter's FIRST wood season, never a later one (Smith's apparent "+4" vs 2026 was
  +1.4 vs first pro); suppressed ceiling inflates squared-up; discipline is why
  it's trustworthy (every "development" dissolved under correct baseline / fuller
  sample). Whiff vs squared-up: whiffs filtered at step 1, never enter SU; a
  hitter can be high-SU + a contact concern (giveback to velo goes to whiffs).

## 3.6 Current data
2026 board (8): floor/ceiling/runway/SU + velo gap (OFF−FB; negative = velo-proof).
Bogenpohl 75.2/77.5/2.4/27/−0.8 · Burress 72.6/77.2/4.6/21/+1.2 · Strosnider
71.9/75.1/3.1/33/−0.5 · Cholowsky 71.4/73.0/1.5/33/0.0 · Lackey 71.3/72.6/1.2/37/
+0.8 · Sorrell 71.3/74.6/3.2/29/−0.8 · Jackson 71.2/72.4/1.3/41/+2.4 · Phelps
68.2/70.8/2.6/35/+3.0. 13-hitter SU reference frame: Bazzana 51 (top) … Caglianone
20 (bottom), 2026 prospects interleaved.

## 3.7 Open roadmap (next on bat speed)
1. **Population pull** (highest value) — run the metric across the full 2026 D1
   hitter set so "good" has a real baseline + finalize T so league avg ≈ MLB ~33.
2. Savant cross-check — pull actual MLB squared-up for Caglianone/Smith/Bazzana;
   test if college ceiling-denominated ordering survives to the pros.
3. Down-ballot offset check (calibration set was top-1% draftees).
4. Identifiability close-out — one contemporaneous metal+wood (Blast/sensor) read
   removes the q-vs-bat-speed-change confound. Highest-leverage single data point.
5. Threshold + version freeze (stamp q_metal_version + su_threshold_version).
6. Companion metrics — formalize velo gap (FB vs OFF) + whiff-vs-velocity columns.

## 3.8 Key cautions
Floor is calibrated; ceiling is an extrapolation (lead with floor). Squared-up is
a STYLE axis, not a quality grade. 13 bats is a reference frame, not a baseline —
strongest external proof is still one program's nod on two players.

---

# PART 4 — PROD UPLOAD

Full ordered process in **`docs/PROD_UPLOAD_MASTER_LOG.md`** (state-check → 14
migrations → ingest/derive/reclassify/Stuff+/backfills/xBA/aggregate/calibrate →
frontend deploy → gotchas). The 06-28 slice alone is
`docs/PROD_RUNBOOK_pitchlog_spray_zone_2026_06_28.md`. Power-rating display +
July precompute context in `docs/POWER_RATINGS_PITCHLOG_HANDOFF_2026_06_26.md`.
Nothing is on prod yet from this session. Stored projections untouched until July.

---

# PART 5 — MEMORY.md CLEANUP PLAN (deferred, do with Trevor's yes/no)
MEMORY.md is ~48KB; only ~24KB loads → entries past ~line 110 truncate on load.
Plan: 10-min pass — propose a list of clearly-completed entries to ARCHIVE (dated
session logs `project_session_2026*`, shipped/launched/superseded ones) for quick
yes/no (files stay on disk, out of the loaded index), then tighten the rest to
≤~90-char hooks. Target <17KB. Don't unilaterally drop pointers — judgment calls
are Trevor's.

---

# PART 6 — TOMORROW / NEXT (Trevor)
1. **Display polish** — build the configurable Visuals tab (Part 2): metric
   pickers on zone/field panels + add/remove panels. Data layer (by_zone) is ready.
2. **Inferred bat speed** — continue Part 3; first high-value step = the
   population pull to set a real baseline + the T threshold.

## Deferred / separate
- **July precompute** — source STORED power ratings from pitch_log (lockstep
  across the duplicated-math set in `src/lib/*` + the edge worker) + re-run
  precompute → makes the real projections accurate. Until then display-only.
- **Doc cleanup** (Trevor's note) — once past this push, consolidate the pile of
  pitch_log/handoff/runbook docs into a smaller canonical set.
- ~16 untracked `scripts/_*.ts` debug files from this session — safe to delete.

## File index (this session)
Migrations: `20260627000000_pitch_log_pull_air_la_ev90.sql`,
`20260628000000_pitch_log_by_zone.sql`.
Scripts: `derive_pitch_log_flags.ts` (labels), `aggregate_pitch_log_dimensions.ts`
(by_zone + spray/EV90), `sql/derive_pitch_log_spray_labels.sql`,
`sql/derive_pitch_log_pitch_zone.sql`, `_backfill_spray_labels.ts`,
`_backfill_pitch_zone.ts`, `_kill_locks.ts`, `_run_sql_file.ts`.
Frontend: `PitcherProfile.tsx`, `PlayerProfile.tsx`,
`usePitchLog2026HitterRates.ts`, `usePitchLogTotals.ts`, `pitchLogRates.ts`,
`BaseballField.tsx`. Docs: `PROD_UPLOAD_MASTER_LOG.md`,
`PROD_RUNBOOK_pitchlog_spray_zone_2026_06_28.md`,
`POWER_RATINGS_PITCHLOG_HANDOFF_2026_06_26.md`, this file.
