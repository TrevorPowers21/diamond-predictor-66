# FULL PIPELINE — pitch-log ingest → refresh snapshot (confirmed 2026-08-21)
> ⚠️ **STUFF+ CONTENT IN THIS FILE IS SUPERSEDED — see `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md` (2026-08-30).**
> The rest of this document may still be valid; only its Stuff+/reclassification statements are out of date:
> • **LIVE lane = pitch_log**: `pitch_type_reclassified` → `compute_pitch_log_stuff_plus.ts` → `pitch_log.stuff_plus`
>   → `aggregate_pitch_log_dimensions.ts` → totals/by_pitch_type. ⛔ `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline`
>   → `legacy_rollupStuffPlusToMaster` is **LEGACY** (≤2025 + JUCO only) and scores **left-handers BACKWARDS** on 2026.
> • Classifier = `src/savant/lib/stuffPlusClassifierV2.ts` @ **95.2% per-pitch / 95.3% arsenal-mix**. Any 92.6% / 94.3% /
>   95.1% / "~85%" figure here is superseded.
> • `breakingBallReclassification.ts` → renamed **`legacy_breakingBallReclassification.ts`**; `rollupStuffPlusToMaster.ts`
>   → **`legacy_rollupStuffPlusToMaster.ts`**. DELETED: `reclassify_pitch_log.ts`, `_run_reclassify_{bare,chunked}.ts`,
>   `_reclass_rollout.ts`, `ReclassificationRunner/StuffPlusRunner/StuffPlusRollupRunner.tsx` (+ npm `reclassify-pitch-log*`,
>   `recompute-stuff:prod`, `recompute-stuff-scoped:prod`). `reclassify_anchor_prod.ts` never existed — it is `reclassify_prod.ts`.
> • Step 4 on PROD **must** use `--direct` (gateway cuts at ~125s; `vs_top_hitters` needs 253s).


The end-to-end process, every step CONFIRMED on `feature/war-recalibration` (staging). This IS the spec for the ONE unified edge function (Track B): each numbered step is a module that folds into the on-upload edge fn. D1 only, JUCO out of scope (separate fn). Nothing is live-computed downstream — every displayed value reads a STORED column.

Companion specs: `PIPELINE_pitch_log_to_projections.md`, `TRANSFER_EQUATION_LINEAGE_2026_08_21.md`, `CONFERENCE_STATS_BUILD_PROCESS_2026_08_21.md`.

## THE 12 STEPS (in dependency order)

### 1. Pitch-log ingest → totals
`ingest_pitch_log.ts` → `pitch_log` (+ `park_code`, `game_string`, `is_conference_game`, pitcher_full_name resolved from pitcher_id). SQL rollups → `pitch_log_hitter_totals` / `pitch_log_pitcher_totals`. **Per-pitcher IP** via out-attribution (added `pitch_log_pitcher_totals.ip`; corr 0.9995 vs Master). ✅

### 2. Derive Masters from pitch log
`derive_masters_from_pitchlog.ts` → `Hitter Master` + `Pitching Master` full line (rates + scouting + K9/BB9/HR9/WHIP + **descriptive classic FIP** `(13·HR+3·(BB+HBP)−2·K)/IP+3.157`). TruMedia = sporadic fill/override (null/thin → keep Master). Keyed `source_player_id`+Season. ✅

### 3. Stuff+ rollup → Master
`recompute-stuff-plus.ts` (reclassify → per-pitch Stuff+ vs D1 baseline → `rollupStuffPlusToMaster`). Input to pitcher power ratings (k9⁺/era⁺/whip⁺). ✅

### 4. ncaa_averages
`computeNcaaAverages.ts` → means (PA/IP-weighted) + SDs (qualified AB≥75/IP≥25). **Dual-writes to `ncaa_averages` AND `model_config`** (p_ncaa_avg_*/p_sd_*/r_*/t_*). Pitcher exit-velo/ev90/in_zone pinned = hitter 1-for-1. ✅

### 5. compute_scores → power ratings
`computeAndStoreAllScores.ts` → `*_score` = scoreFromNormal(metric, ncaa_mean, ncaa_sd) → composites `/50·100` → `*_power_rating` / `*_pr_plus` back on the Masters. `obp_power_rating` = the returner SD-blend's `from_obp_plus`. ✅

### 6. std_pr (power-rating SDs)
`computeStdPr.ts` → r_*/t_*_std_pr (+ p_*_pr_sd) → model_config + code. Re-measured on current ratings (must re-run after any recompute). Wired into `recompute-cascade`. ✅

### 7. create_predictions
`createPredictionsFromMaster.ts` → `player_predictions` returner/regular, **season 2027**. **Writes per-stat `from_avg_plus/from_obp_plus/from_slg_plus`** (= ba/obp/iso_power_rating) — the returner SD-blend input. ✅

### 8. Returner recompute
`precompute-returner-hitters.ts` (recalcReturner SD-blend) + `precompute-returner-pitchers.ts` (computePitcherProjection). The stored returner projection (base for own-roster players). ✅

### 9. CONFERENCE-STATS build (the conf-stats-derive step) — feeds transfers
Order: raw counting (PA/AB) + rates → env+ → Stuff+/OPR → park → HTP last.
- **9a Raw rates** (AVG/OBP/…/ERA/FIP, intra-conf `is_conference_game=true`): pitch-log Bucket-A assembly. ⚠️ **STILL HAND-RUN SQL — must codify.**
- **9b Hitter env+** (ba/obp/iso/slg_plus = rate/ncaa·100): `computeConferenceEnvRates` (cascade). ✅ STORED
- **9c Pitcher env+** (era…hr9_plus, ratio): `compute_conf_pitcher_env_plus.ts` (mig 20260821000000). ✅ STORED
- **9d Stuff+ / Overall_Power_Rating**: Stuff+ rollup + `populate-conference-stats-env-plus` (Overall_PR = PA-avg hitters' overall PR). ✅
- **9e OPR** (`offensive_power_rating` = Overall_Power_Rating): `derive_conf_opr_htp.ts`. ✅ committed
- **9f WRC_plus** (C1 OBP/SLG): ⚠️ **STILL commented-out SQL — must codify.**
- **9g run_env_factor** (conf-avg member `rg_factor`): `derive_conf_opr_htp.ts`. ✅ committed (verified exact)
- **9h HTP** (`hitter_talent_plus` = OPR + 1.25·(Stuff+−100) + 0.75·(100−run_env_factor), PARK SWAP): `derive_conf_opr_htp.ts`. ✅ STORED, read-only, one canonical value everywhere.

### 10. TRANSFER projections
`precompute-transfer-projections.ts` (hitter) + `precompute-pitchers.ts` (pitcher), per customer team. Reads: Master `*_power_rating`/`*_pr_plus` (by source_player_id); Conference Stats env+/Stuff+/HTP **all STORED, no live compute**; Park Factors per-team (hitter uses lhb/rhb handedness; pitcher combined); model_config weights (both sides, re-tuned to target %impact). Team resolution **id-first** (source_team_id). Equation: power-blend → env translation (conf ~1% / competition 4% / park) → class+dev → depth role → WAR → market. Writes `player_predictions` transfer/precomputed/2027. ✅ re-run all 17 customer teams.

### 11. team_season_stats (Program Analytics) — ⚠️ MUST RUN BEFORE STEP 10 (order correction, Trevor 2026-08-21)
`refresh_team_season_stats(season)` → Σ Masters **descriptive** WAR (owar/dwar/bsrwar/pwar reg+total) + conf context (conf_stuff_plus/conf_htp/conf_opr from Conference Stats) + **faced-competition (faced_stuff_plus/faced_htp)** + park + records. 308 D1 rows. Descriptive (actual season), separate from projections. ✅ populated.
**⚠️ CORRECTION: this belongs BEFORE transfers (step 10), because `faced_stuff_plus`/`faced_htp` are the CORRECT competition input for INDEPENDENT programs** (Oregon State: 0 conf games → schedule-weighted faced HTP ~104.6, NOT the Independent conference's own 124.6). Correct order: 9 → 11(faced) → 10.
**⚠️ WIRING GAP (found 2026-08-21):** the transfer projections do NOT read `faced_stuff_plus`/`faced_htp` — independents use the "Independent" Conference Stats row's OWN HTP (124.6) instead of faced (~104.6), over-stating the competition they faced. Narrow (Oregon State only in 2026) but a real inaccuracy. FIX = wire the transfer competition term to read `team_season_stats.faced_htp`/`faced_stuff_plus` when the from-program is independent. [[project_faced_competition_independents]]

### 12. Snapshot refresh (the "automatic function")
`backfill-neutral-snapshot.ts` → `neutral_snapshot` from current predictions (**team-scoped pick: this-team precomputed → global regular → bounded fallback; NEVER another team's data**) → `heal-stale-snapshots.ts` → `player_snapshot`/`transfer_snapshot = projectEffectiveWar(neutral, production_notes)`. **Toggles (`production_notes`) never written.** Covers ALL builds incl. default rosters + target_board. RLS: program-scoped by customer_team_id. ✅

## DATA-INTEGRITY INVARIANTS (must hold in the edge fn)
- Every displayed value reads a STORED column (env+, HTP, projections, snapshots) — **no live compute** anywhere.
- Team resolution by **ID** (source_team_id), never name.
- Snapshot selection **team-scoped** (never another team's precompute); toggles preserved.
- Conference Stats keyed `conference_id`+season; clean D1=30 (NJCAA excluded).
- JUCO = separate function (blocked from D1 path via null stored env+).

## ⚠️ NOT YET AUTOMATIC / prod-push blockers
- **9a raw-rate assembly + 9f WRC_plus** = hand-run SQL → codify before prod (else empty on prod → transfers/HTP/Program Analytics break). ★★★★
- Steps 1–12 are separate scripts today; the edge fn folds them into ONE on-upload run.
- New-team path = `process-precompute-jobs` edge fn (code fixed to match; ⏳ Trevor deploy).

## WHAT'S NEXT (plan)
1. **Codify the two hand-run producers** (9a raw-rate pitch-log assembly, 9f WRC_plus) — removes the prod-push blocker.
2. **Display wiring audit** — map EVERY surface that shows these stats (Team Builder, GM roster/hub, Program Analytics team snapshots, target board, Conference Stats page, player/pitcher profiles) and confirm each reads the STORED value → accurate + consistent everywhere. (The next work session.)
3. **⭐ MARKET VALUE equation — evaluate/redo** (Trevor 2026-08-21): revisit even against prior coach feedback. Hitter = total_hitter_war × $/WAR × conf tier × position PVM; pitcher = p_war × $/WAR × tier (no PVF). Decide the model before prod.
4. **Deploy `process-precompute-jobs` edge fn** (Trevor) — new-team path.
5. **Unify Steps 1–12 into ONE edge fn** (Track B) — autonomous on upload; retire the drifted copies + hand-run SQL.
6. **Prod push** — the runbook, Trevor drives.
7. Deferred: JUCO separate fn; players.team_id backfill; NCAA anchors → ncaa_averages read; conference-to-conference rollups.

---
## ★★★ TRACK B — STUFF+ STAGE, LOCKED SPEC (2026-08-29). Supersedes any earlier Stuff+ description here.
Track B = ONE function on pitch-log ingest (weekly/biweekly, local folder watch). Master-sheet uploads come LATER as a
CHECK + to override only what pitch_log cannot produce (e.g. AVG/SB). **pitch_log is the SOURCE OF TRUTH.**

**THE STUFF+ STAGE — exact order. Steps 1→5 MUST complete in ONE run; a label change invalidates every number below it.**
1. **CLASSIFY** → `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`
   `src/savant/lib/stuffPlusClassifierV2.ts` (v2 — the SINGLE classifier), driven by `scripts/reclassify_prod.ts`.
2. **RE-DERIVE the pop baseline** → `pitcher_stuff_plus_ncaa` (per pitch_type × hand, **armHB**, D1-only).
   ⚠ MANDATORY, not optional: the §4.5 gyro fix moves **6-8% of ALL breaking-ball volume** Slider→Gyro Slider, so every
   mix-dependent artifact (baselines, D1/regional means + SDs, pitch-shape percentiles) is invalid until regenerated.
3. **SCORE per pitch** → `pitch_log.stuff_plus` — `scripts/compute_pitch_log_stuff_plus.ts`
   (normalizes hb→armHB itself; recenters each (pitch_type × hand) bucket to mean 100).
4. **AGGREGATE** → `pitch_log_pitcher_totals` / `pitch_log_hitter_totals` / `*_by_pitch_type`
   `scripts/aggregate_pitch_log_dimensions.ts` (must also call `populate_hitter_run_values(season)`).
5. **MARRY ONTO THE MASTERS** → `scripts/derive_masters_from_pitchlog.ts`
   (⚠ add `.order(PK)` to its `readAll` first — unordered `.range()` over ~2.5M rows silently drops/dupes).
Then: power ratings → conference baselines → projections → market/NIL.

**⛔ WHAT TRACK B MUST NEVER DO**
- NEVER route Stuff+ through the LEGACY lane: `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
  `legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus`. Nothing reads it for 2026 and it carries the latent
  raw-HB bug (e5dec2f removed `hbSign`; PSP-I stores RAW hb ⇒ left-handers scored BACKWARDS).
- NEVER call `legacy_breakingBallReclassification` (v1). It writes `rstr_pitch_class` on PSP-I, has never touched
  pitch_log, and is NOT the anchor classifier. Conflating the two cost a full day (2026-08-28/29).
- NEVER rewrite the stored `hb` column to armHB. `hb` is RAW by design (UI displays it; the CSV importer writes it raw).
  armHB is a COMPUTE convention — normalize in memory only.
- NEVER leave new labels with stale scores. Steps 1→5 are one transaction-of-work.

**LANE COVERAGE (measured):** `pitch_log` is **D1-only** — 5,303 pitchers. PSP-I covers 7,012; the 1,709 difference is
**1,627 NJCAA_D1 + 81 D1 + 1 D2**. → **JUCO has no pitch logs and stays CSV-derived** (scored vs D1 baselines). Track B's
pitch_log chain covers D1 only; do not let it silently drop JUCO. JUCO process is being restarted separately.

**CLASSIFIER STATE FEEDING TRACK B (2026-08-29):** v2 = **94.3% per-pitch** on the full 2,000,674-pitch anchor set
(arsenal-mix 94.3%, needs_review 8.1%), **→ projected ~95.3-95.4%** with the §4.5 gyro floor. Three shipped fixes:
offspeed `armHB >= 5` floor · fastball-family MERGE GUARD (>60% of 4S↔Sinker errors) · §4.5 gyro cluster floor `-3`
applied BEFORE `tiebreak()`. Two logged NEGATIVE results — `rr > -1.7` and the "arsenal rule" confound (loses ~1pp) —
do NOT rebuild either. Full numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11. Lane map: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`.

**⚠ AGREEMENT WITH THE ANCHOR IS NOT ACCURACY.** The anchor is the previous classifier's output, not truth. The residual
~4.7% mixes v2-wrong / **v2-RIGHT-anchor-wrong** / coin-flips — partition with `scripts/v2_coherence_test.ts` before
treating it as error, and before deciding whether staging's labels should be updated rather than preserved.

---
# 🧭 TRACK B — EXECUTION LESSONS FROM THE FIRST REAL RUN (staging + prod, 2026-08-29/30)
The 5-step chain has now been run END-TO-END on BOTH environments. Track B automates exactly this chain on ingest,
so every failure mode below WILL recur unattended unless Track B is built to handle it. This section is the
requirements list, written from what actually happened — not theory.

## ✅ WHAT WORKED (keep these properties)
- **Per-pitcher classification is deterministic.** Prod and staging produced an IDENTICAL label distribution to the
  tenth of a percent (4S 37.8 · SI 16.0 · SL 10.3 · GY 10.2 · CH 9.1 · CB 5.6 · SW 5.2 · FC 3.7 · SPL 2.1) and an
  IDENTICAL per-pitcher Stuff+ gate (mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7). Two independent datasets, same
  numbers ⇒ the classifier + scorer are reproducible. **Track B should assert this gate after every run.**
- **A hard SIGN CHECK that refuses to write** caught nothing because nothing was wrong — but it is the reason we can
  TRUST the armHB convention on both envs (18/18 buckets, twice). **Keep abort-before-write invariants.**
- **`is distinct from` + keyset + per-batch commit** made step 1 resumable and cheap to retry.
- **Backups before every destructive step** (`_v2_prechain_backup`, `_hm_prestep5_backup`, `_pm_prestep5_backup`) made
  the whole chain reversible. **Track B must snapshot before it writes, every run.**
- **Halt-on-failure between steps** stopped a quoting bug from cascading (it died before writing anything).

## ❌ WHAT BROKE — AND WHAT TRACK B MUST DO ABOUT IT
1. **STEP 3 DOES NOT RESUME.** `compute_pitch_log_stuff_plus.ts:185` re-scores every row matching the class version
   rather than filtering `stuff_plus IS NULL`, so each attempt costs the FULL runtime (staging 35.7 min, prod 29.9)
   and a mid-run failure leaves **v2 labels + STALE scores** — the one state that must never exist.
   → **TRACK B FIX: two phases — (a) score only `stuff_plus IS NULL`, (b) ALWAYS recenter across the FULL population**
   (the recenter needs every row to shift each bucket to mean 100, which is why naive resume is wrong).
2. **`--direct` REMOVES THE FAILURE SIGNAL.** `statement_timeout=0` + long `query_timeout` defeats the gateway's ~125s
   cut (required: `vs_top_hitters` needs 151-255s) but a dropped pooler connection then becomes an INFINITE HANG.
   Prod stage 4 sat **39 minutes with no output**, no active query, no locks. Nothing retried because nothing failed.
   → **TRACK B FIX: `keepAlive: true`, a FINITE `query_timeout` (~20-30 min, sized off the slowest dimension), and
   per-dimension progress logging.** Unattended automation CANNOT have an unbounded wait.
3. **EXIT CODE 0 ≠ SUCCESS.** `aggregate_pitch_log_dimensions.ts` exits 0 even when a dimension FAILED, and it HALTS
   on that failure so the 8 dimensions behind it never run. A run was wrongly marked COMPLETE this way.
   → **TRACK B FIX: validate by CONTENT (grep for the per-item success line + `FAILED`), never by exit code.**
4. **"ROWS EXIST" ≠ "ROWS ARE FRESH".** When `vs_top_hitters` failed, its table still showed 5,349 rows from the
   PRE-v2 run. A row-count check PASSES on stale data.
   → **TRACK B FIX: stamp a run/version marker on aggregate rows and verify FRESHNESS, not count.**
5. **`select *` VIEWS GO STALE SILENTLY.** Prod's `pitch_log_corrected` was frozen at 94/99 columns and did not expose
   `classification_version`, so the scorer hard-failed on prod while passing on staging. `create or replace` cannot
   fix it — it needs drop+create.
   → **TRACK B FIX: after ANY `ALTER TABLE pitch_log ADD COLUMN`, rebuild the view. Assert the view's column count
   matches the base table before the chain starts.**
6. **A LABEL CHANGE INVALIDATES EVERYTHING BELOW IT.** The §4.5 gyro floor moved 6-8% of breaking-ball volume, so every
   mix-dependent baseline/SD/percentile was invalid until regenerated.
   → **TRACK B FIX: steps 1→5 are ONE transaction-of-work. Never emit "done" between them.**
7. **ORDERING IS LOAD-BEARING AND WAS WRONG IN THE DOCS.** C26 must follow C27 (it reads `ncaa_averages` and falls back
   to hardcoded defaults SILENTLY when fields are missing); C29 must precede C28 (10 NJCAA rows are still tagged
   `division='D1'` and both C28 producers filter on it). Migration order for `team_season_stats` is by DEPENDENCY, not
   timestamp — the filenames sort wrong and fn-before-ALTER empties the table.
8. **UNORDERED `.range()` SILENTLY DROPS/DUPES ROWS.** Found in 6+ producers. A blanket `order("id")` is NOT the fix —
   `pitch_log_*_totals`, `player_season_defense` and `player_season_baserunning` have NO `id` column.
   → **TRACK B FIX: per-table PK map; refuse to paginate an unregistered table.**
9. **NEW-ROW CREATION WAS UNGATED.** `derive_masters_from_pitchlog` spread invented Master rows into the same upsert as
   the patches. The Masters are the TruMedia source of truth; a pitch-log-only row is a half-populated player.
   → **TRACK B FIX: never create Master rows implicitly. Opt-in only (`--create-new`), default OFF.**
10. **ENV GUARDS WERE MISSING OR WRONG.** One market script hardcoded `.env.local` (would resync STAGING while
    reporting success on a prod run); two others had NO guard at all and would write prod with zero opt-in; one had a
    STAGING build-id as its default scope, returning 0 rows on prod.
    → **TRACK B FIX: double-keyed guard everywhere — the URL and the `--prod` flag must AGREE, or refuse to run.**
11. **SEASON KEYS DIFFER BY PURPOSE.** 2026 = completed season (descriptive WAR), 2027 = projections. A query on the
    wrong season returns a misleading ZERO — this produced a false "staging has no WAR data" alarm.
    → **TRACK B FIX: every gate query must state its season explicitly and assert a non-zero denominator.**
12. **MACHINE SLEEP KILLED LONG RUNS.** Distinguish: environmental failures die at a DIFFERENT point each run;
    structural ones die at the SAME place with the SAME duration. Run detached with `caffeinate -dimsu -w <pid>`.
