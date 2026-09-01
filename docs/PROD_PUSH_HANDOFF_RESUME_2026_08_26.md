# PROD PUSH — RESUME HANDOFF (paused 2026-08-26 night)

> ▶️ **START HERE for the prod push: `docs/HANDOFF_2026_08_30_PROD_PUSH.md`** (current state, next actions in order, mistakes not to repeat, standing rules).
> ## ★ CURRENT STATE — READ FIRST (2026-08-30). This supersedes every older statement in this file.
> - **LANE (TOP DOG):** the only correct Stuff+ lane is the **pitch_log lane** —
>   `pitch_log.pitch_type_reclassified` → `compute_pitch_log_stuff_plus.ts` → `pitch_log.stuff_plus` →
>   `aggregate_pitch_log_dimensions.ts` → `pitch_log_pitcher_totals` / `_by_pitch_type` → Season Stats + PitcherProfile.
>   **armHB throughout, self-consistent, CORRECT.**
> - **LEGACY LANE (≤2025 + JUCO ONLY, NEVER 2026):** `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
>   `legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus`. It stores RAW hb, and since commit `e5dec2f` the
>   shared equations expect armHB — so running it scores **LEFT-HANDERS BACKWARDS**. Not live, not on main. Every step in
>   this document has been rewritten onto the pitch_log lane; if you find one that still routes through the legacy lane,
>   it is WRONG. (`legacy_breakingBallReclassification.ts`, renamed from `breakingBallReclassification.ts`, never touched
>   `pitch_log` and is NOT the anchor classifier.)
> - **CLASSIFIER:** `src/savant/lib/stuffPlusClassifierV2.ts` is the SINGLE source (`scripts/reclassify_v2.ts` is only a
>   validation harness; its duplicate copy was deleted). **FINAL ACCURACY = 95.2% per-pitch / 95.3% arsenal-mix /
>   needs_review 8.1%** on the full 2,000,674-pitch population. ⚠ SUPERSEDED — never quote as current: **92.6%, 94.3%,
>   95.1%, "~85%", and any "projected ~95.3-95.4%"**.
> - **DECISION (Trevor, FINAL):** standardize on v2 in **BOTH** environments — **DO overwrite staging's labels.** Any
>   "do NOT overwrite staging's labels" guidance anywhere is REVERSED and obsolete.
> - **STAGING:** the v2 chain is RUN + VERIFIED — backup `_v2_prechain_backup` (2,579,655 rows, DO NOT DROP) ·
>   2,015,321 classified/stamped `v2-ranges-2026-08-28` (needs_review 8.1%) · `_reclass_pf` materialized (5,364
>   pitchers) · baseline armHB SIGN CHECK PASSED 18/18 · 2,015,321 scored + recentered (every type×hand bucket exactly
>   100.0) · step 4 all 48 dimensions + `populate_hitter_run_values`. **Still open on staging:** step 5
>   `derive_masters_from_pitchlog.ts` is DRY-RUN ONLY (0 hitters / 4,675 pitchers would change; never applied on ANY env).
> - **PROD (historical):** still on the OLD per-pitch CASE labels (`"4-Seam Fastball"`, ~2,176,888 labeled of ~2,575,996, no
>   `classification_version`, `needs_review` all null). **v2 has NEVER written to prod.** Prod's DATA is ready (100.00% of
>   `is_data=true` rows are v2-classifiable; venue corrections present and resolving).
> - **⛔ THE ONE REMAINING PROD BLOCKER:** prod's `pitch_log_corrected` VIEW is `select pl.*` **FROZEN at 94 of 99
>   columns** and is MISSING `classification_version`, so the scorer hard-fails there. Fix =
>   `drop view pitch_log_corrected cascade; create view …`. **DDL — requires its own explicit go**, separate from the
>   data-write "prod, now?".
> - **▶ NEXT ACTION:** rebuild that view on prod, then run the prod Stuff+ chain (reclassify → baseline → score →
>   aggregate **with `--direct`** → Masters) in ONE 4-6 h sitting, machine pinned awake.

## 🛑 MUST READ — **WHERE CONSTANTS COME FROM.** THREE CONFIG SYSTEMS ARE LIVE (2026-09-01)

Every stage below reads constants. **They do not all read the same place**, and the hitter path reads a
DIFFERENT SOURCE ON PROD THAN ON STAGING. Nothing in this spec is trustworthy until this is fixed.

| path | reads | PROD | STAGING |
|---|---|---|---|
| Pitching — `readPitchingWeights` (`pitchingEquations.ts:147`) | `"Equation Weights"` @ **2025** | 0 of 40 mapped keys present → **code defaults** | table EMPTY → **code defaults** |
| Hitting — `predictionEngine.ts:261` | `"Equation Weights"` @ **2025** | **333 keys — LIVE, overrides code** | table EMPTY → **code defaults** |
| Pitcher power ratings — `loadPitchingPowerEq` (`predictionEngine.ts:694`) | `model_config` admin_ui @ **2026**, **keys starting `p_` ONLY** | ✅ | ✅ |
| Batch precomputes + edge fn | `model_config` admin_ui @ **CURRENT_SEASON** | ✅ | ✅ |

⛔ **`predictionEngine`'s "fall back to `model_config`" branch is DEAD CODE.** It filters
`model_type IN ('returner','transfer')`, but `model_config` contains **only `admin_ui`** rows in both
databases (prod 2025:140 / 2026:220 · staging 2025:157 / 2026:220). It has never returned a value.

🚨 **THE COST OF THIS, MEASURED:** prod's returner **wRC+ runs a different equation than the code**
(`.45/.30/.15/.10 ÷ .364` instead of `.691/.235/0/0 ÷ .3782`). Across 5,122 D1 returner hitters the
legacy formula reproduces the stored `p_wrc_plus` for **5,122 (100%)** and the canonical for **1,164
(23%)**. Staging looked correct only because its table is EMPTY and the override block is guarded by
`if (eqWeights.size > 0)`. See GATE B in `docs/PLAN_2026_09_01_onboarding_verify_and_wrc_audit.md`.

⚠ **KEY-CONVENTION CONFLICT — resolve before writing any calibration key.** `loadPitchingPowerEq`
consumes only `p_`-prefixed keys (`p_era_pr_sd` already exists in `model_config`), while
`compute-projection-calibration.ts` emits `era_plus_pr_center` / `era_plus_pr_sd`. **Nothing reads
`pr_center` or `pr_sd` from any table today**, so stage 5.5's output is INERT until one convention wins
and the producer matches it.

**TARGET STATE (approved 2026-09-01):** `model_config`, `model_type='admin_ui'`, `season=2026` is the
**single source of truth**. `"Equation Weights"` is legacy → rename to `"Equation Weights_LEGACY_2025"`
(**rename, not delete** — a missed reader must crash loudly, not fall back silently to code defaults).

**RESUME IMPACT:** any resume point that verified hitter projections did so against prod's legacy
formula, not the canonical one. Those verifications are void.

## 🛑 MUST READ — PROJECTION CALIBRATION IS **WRONG ON PROD RIGHT NOW** (found 2026-09-01)

Two constants were **fit on one population and applied to another**. Both bias EVERY pitcher's
projection by a CONSTANT — equal discrepancies at every percentile and in every class bucket.

**(1) Stage 5.5 had NO division filter.** Baselines were computed across every division:
`D1 1,295 (mean ERA 5.264) · NJCAA_D1 477 (6.118) · ALL 1,773 (5.492)` at the producer's own
`IP >= 40` qualifier. **477 JUCO pitchers — 27% of the sample — inflated the D1 anchor by 0.229 ERA
(4.3%).** `git log` confirms the filter was NEVER present.

**(2) The z-shift subtracts a hardcoded `100`, but PR+ is not centered at 100 on that population.**
True D1/`IP>=40` centers: `era 109.7253 · fip 108.2875 · whip 108.4028 · k9 101.6919 · bb9 123.1615 ·
hr9 102.0359 · overall 109.0064`. On all-division/`IP>=20` they are 96.3–104.0 (≈100) — PR+ was FIT
there, APPLIED here. ERA carried **+0.44 of phantom improvement** per pitcher; **BB9 is worst at 123.16**.

**MEASURED EFFECT** (real ERA constants) — a constant offset; the spread is unchanged:
`AVERAGE pitcher 4.9280 → 5.2757 (actual 5.3040) · ELITE 3.8457 → 4.1934 · WEAK 6.2359 → 6.7028`

★ Hitting is **not** contaminated the same way (its anchors were already D1-scoped; centers
100.31–103.79). Centers are stored for both sides regardless — nothing may assume 100.

⛔ **CODE IS FIXED, DATA IS NOT.** As of this writing: `model_config` has **not** been written on either
database, the **edge function still has its own constant copies and its own hardcoded `100`** (so
onboarding still projects with the old bias), and **precomputes have not been re-run** — every stored
`p_era`/`p_war`/`market_value` on prod still carries the bias.

⚠ After applying, **re-verify the ACROSS-THE-RANGE table, not the mean.** And note the trap: this bug
is invisible to a range check, because a miscentered rating shifts the LEVEL while keeping the SHAPE.
The tell was *equal* discrepancies everywhere. **A constant offset with correct spread ⇒ a population
mismatch in the constants, not a broken model.**

Full detail: `docs/PIPELINE_pitch_log_to_projections.md` stage 5.5 MUST READ.

**RESUME IMPACT:** any resume point that reports projections as verified is now stale. The values were
verified against constants that were themselves computed on the wrong population.

The single "start here" to resume the `feature/war-recalibration` prod push. We stopped at a **clean, fully-logged,
coherent checkpoint** — the foundational + config layers are DONE + verified on prod; the heavy regeneration (Phase C
onward) is untouched. Prod users currently see the OLD, consistent numbers (displays pure-read stored predictions;
nothing recomputes until Phase E), so nothing is half-broken.

- **Prod ref:** `trbvxuoliwrfowibatkm` · env `.env.production.local` (has SUPABASE_URL + VITE_SUPABASE_URL + service key, both = prod).
- **Runbook (authoritative order):** `docs/PROD_PUSH_STEPS_2026_08_26.md` (read its "PROD STATE — RECONCILED" section first).
- **Live ledger / execution log:** `PROD_MIGRATIONS_TODO.md` (top section "★ PROD PUSH EXECUTION LOG — 2026-08-26 (LIVE)").
- **Runner:** `npx tsx --env-file .env.production.local scripts/_run_sql_file.ts <file.sql>` (uses VITE_SUPABASE_URL; runs whole file via exec_sql, one txn). exec_sql returns void — verify reads separately via a `.from()` query.

## ✅ DONE + VERIFIED ON PROD TONIGHT
1. **GATE 0 — pitch_log dedup.** `DELETE FROM pitch_log WHERE runs IS NULL` (3,509 junk removed; verify `count WHERE runs IS NULL` = 0). Detector = runs-null, NOT distinct-uniq_pitch_id (that misleads).
2. **GATE 1 — movement complete.** Validated via the venue dry-run reproducing the fixture (τ IVB 0.622″ / HB 0.662″, 311 venues, centering ≈0, worst −2.57).
3. **Step 12 — venue corrections.** `scripts/sql/venue_correction_persist_prod.sql` applied → `venue_movement_corrections` 311 rows (v1-2026-loo-eb) + `pitch_log_corrected` view.
4. **Phase A DDL — 11 files.** desc_* cols · `20260810` composite ÷13.1 def · `20260808` pitch_num_in_game/ab_num_in_game/pitch_num_in_ab · `20260818…` park_code + is_conference_game · `20260821000000` ConfStats era_plus…hr9_plus · **NEW `20260826160000_war_recalibration_gap_alters.sql`** (ConfStats run_env_factor/hitter_talent_plus/updated_at + Park 10×`*_seasonal`+updated_at + pitcher `ip`) · `20260823` team-scoped RLS · `20260826150000`+`150500` run-value cols+fn. ⚠ `20260806 RENAME total_war` SKIPPED (already done).
5. **Phase B config.** `step8_model_config_2026.sql` (201 keys; repl 21.22, r_obp_std_pr 31.89504) · `ncaa_averages.wrc=0.3782` · `seed_nil_tiers` (nil_tier_sec **4.0**) · `store_transfer_weights_and_sds --apply` · `compute-projection-calibration --apply` (**6 `_sd_bad` two-sided SD keys**, hr9_shrink_k 66.4).
6. **A11 — Masters UNIQUE.** 0 true dups (verified via stable id-ordered scan; earlier 5/7 were pagination artifacts). Added `hitter_master_source_player_season_uniq` + `pitching_master_source_player_season_uniq` (**NEW `20260826160500_masters_source_season_unique.sql`**, applied prod + staging).

**Also confirmed (read-only):** pitch_log is CURRENT (date range 2026-02-13 → 06-22 = full season, same as staging; raw columns velocity/ivb/hb/exit_velo/launch_angle/pitch_type/cs_prob all identical to staging). **Defensive data present + current** (`player_season_defense` 13,454 / `player_season_baserunning` 10,432, engine 0.11.0; DRS output CSVs in `scripts/drs/output/`; pitch_log fielder/catcher attribution present). **No pitch-log or defensive ingest is needed** — Phase C only regenerates *derived* columns.

**Commits (feature/war-recalibration):** `1abe09d` reconciliation · `a1c2026` gap-fill+PhaseA log · `a6ef44d` PhaseB log · `56ff2a1` A11 · (+ GATE/venue logged in the ledger).

## ▶ SESSION 2 (2026-08-27) — done + resume point
- ✅ **C19 pitcher_full_name — DONE** — was corrupt (= batter name); fixed to players `First Last` via
  `pitcher_id=source_player_id`. NEW committed `scripts/sql/fix_pitcher_full_names.sql` (single idempotent UPDATE,
  900s SET LOCAL). Verified 41/41 correct table-wide. ⚠ exec_sql gateway-timed-out at 125s but txn COMMITTED server-side.
- ✅ **C20 park_code — DONE & VERIFIED (2026-08-27)** — `park_code_filled = 2,576,146 / 2,576,146` (100%). Method = `scripts/_pc_keyset.ts`
  (keyset on `uniq_pitch_id`, direct pooler session, per-batch commit, 300ms throttle) — 129 batches / ~92 min on the free tier.
- ✅ **C21 is_conference_game + C22 sequence — DONE & VERIFIED (2026-08-28)** — `scripts/_next_derived.ts`: copied the 4 cols
  (is_conference_game / pitch_num_in_game / ab_num_in_game / pitch_num_in_ab) from STAGING → prod `_derived_fix`, then ONE keyset UPDATE.
  Final: is_conf_filled = seq_filled = **2,576,146 / 2,576,146**. Script hardened after 3 bugs (all resumable, no data lost): PostgREST
  1000-row read cap; hard-exit on transient staging fetch-fail (→ 6× retry); connection stall/hang (→ keepAlive + query_timeout + auto-reconnect).
- ✅ **Stuff+ — UNBLOCKED (2026-08-30). The reclassification rebuild is DONE.** Everything that follows in this file
  about "Option A / rebuild plan / blocked" is SUPERSEDED; the whole legacy sequence that ran through
  `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` → `legacy_rollupStuffPlusToMaster` has been REMOVED, because
  running it revives the raw-HB bug and scores LEFT-HANDERS BACKWARDS. Follow **"THE STUFF+ CHAIN"** at the bottom of
  this doc — the pitch_log lane — and nothing else.
  - **Classifier:** `src/savant/lib/stuffPlusClassifierV2.ts` (SINGLE source), **95.2% per-pitch / 95.3% arsenal-mix /
    needs_review 8.1%** on the full 2,000,674-pitch population. The earlier framing here — "the classifier CASE is
    only recoverable from `pg_stat_statements`", "reproduces staging only ~73%", "the per-pitch writer does not exist",
    "`legacy_breakingBallReclassification.ts` is the anchor classifier" — is all FALSE/obsolete. That file writes
    `rstr_pitch_class` on PSP-I and **has never touched `pitch_log`**.
  - **Writer:** `scripts/reclassify_prod.ts` — keyset over a direct session, `is distinct from` guards, per-batch commit;
    stamps `pitch_type_reclassified` + `classification_version='v2-ranges-2026-08-28'` + `needs_review`, and
    materializes `_reclass_pf`. `--target=staging` for staging; `--go` gated on PGURI + an explicit "prod, now?".
  - **Schema gap closed:** `20260828000000_pitch_log_classification_version_needs_review.sql` added
    `classification_version` + `needs_review` to prod `pitch_log` (applied 2026-08-28). ⚠ the prod
    `pitch_log_corrected` VIEW was NOT rebuilt afterward → that is the one remaining prod blocker.
  - **Equations verified committed + pushed:** `e5dec2f` (fold final equations), `7d62479` (recenter-vs-scope fix),
    `a837a90` (gyro/reclass improvements). The code that runs = the code that built staging.
  - **Decision (Trevor, final):** standardize on v2 in BOTH environments — DO overwrite staging's labels.
  - **Staging is DONE + verified** end-to-end (backup → classify → baseline 18/18 → score+recenter → all 48
    aggregations); only step 5 (`derive_masters_from_pitchlog.ts`) is still dry-run. See the state section below.

  ### ★ PRINCIPLE (Trevor, 2026-08-28): prefer DERIVE over COPY where the derivation must work in the future.
  Copying park_code/is_conf/sequence from staging was a one-time migration expedient (values correct, fast, under the
  disk-IO crunch). But prod must be able to DERIVE these columns going forward (every new pitch-log upload) — so the
  on-upload pipeline / Track B edge fn must run the real derivation on prod, not depend on staging copies. Stuff+ IS
  done the right way (clean regen on each env). **FOLLOW-UP, still open:** verify the park_code / is_conference_game /
  sequence derivation runs on prod and is wired into the go-forward pipeline. [[project_unified_projection_edge_function]]
- (historical) C20 detail — `_park_code_fix` fully loaded (2,576,230 rows).
  After a LONG battle with prod Disk IO throttling (see the big new section in `docs/AGENT_LEARNINGS_prod_push_execution_2026_08_27.md`),
  the working method is **`scripts/_pc_keyset.ts`** — keyset pagination on `uniq_pitch_id` over a DIRECT pooler session, per-batch commit,
  `is distinct from` (idempotent/RESUMABLE), 300ms throttle. **Status at handoff: ~38% scanned, ~1.2M+ of 2,576,146 park_code filled,
  ~80 batches / ~2 hr left at free-tier baseline.** Progress log: scratchpad `pc_keyset.log`.
  **HOW TO RUN/RESUME** (direct session — the HTTP gateway rolls back long UPDATEs): build PGURI from `supabase/.temp/pooler-url` +
  the DB password (dashboard → Settings → Database), then
  `PGURI=… PROGRESS_LOG=…/pc_keyset.log npx tsx scripts/_pc_keyset.ts`. Re-running after any interruption just resumes (skips done rows).
  **VERIFY when done:** `count(*) filter(where park_code is not null)` == 2,576,146 (== _park_code_fix minus dedup). Then commit + log C20.
  ⚠ do NOT use the HTTP gateway / ctid batching / VACUUM FULL for this — all failed (learnings doc). Consider a compute bump for speed.

  ### ⚠ REMAINING BIG pitch_log FULL-TABLE WRITE — only ONE is left (it hits the same Disk IO wall)
  C21 `is_conference_game` and C22 sequence are **DONE + verified on prod** (2,576,146 / 2,576,146 each) — do NOT re-run.
  The only remaining ~2.5M-row write is the **Stuff+ chain** (classification + scoring, writing `pitch_type_reclassified`,
  `classification_version`, `needs_review`, `stuff_plus`) — the heaviest step; strongly favor a **temporary compute bump**,
  and budget 4-6 h. Everything after it (derive_masters, scores, ncaa_avg, conf-stats, Phase D/E/F) reads pitch_log
  AGGREGATES → writes small Master/ConfStats tables → does NOT hit this wall. Pattern: `scripts/_pc_keyset.ts`
  (keyset PK, throttle, direct session, resumable) — which is exactly what `reclassify_prod.ts` already does.

### Then continue Phase C
✅ 19 pitcher_full_name · ✅ 20 park_code · ✅ 21 is_conference_game · ✅ 22 sequence — all DONE + verified on prod.
REMAINING: **the Stuff+ chain (pitch_log lane, steps 1–5 — heavy)** · 23 pull_air/in_zone · 24 trackman ·
25 derive_masters · 26 scores · 27 ncaa_avg · 28 conf-stats (G-gate) · 29 NJCAA re-tag.
⚠ Expect more staging-hardcoded scripts / missing UPDATE-SQL / missing helper tables — same reconstruct-from-staging-and-commit pattern.
Full learnings: `docs/AGENT_LEARNINGS_prod_push_execution_2026_08_27.md`.

### Phase C steps (per runbook, with what exists)
- ✅ **19** pitcher_full_name — DONE + verified (41/41 correct table-wide).
- ✅ **20** park_code backfill — DONE + verified, 2,576,146 / 2,576,146 (100%) via `scripts/_pc_keyset.ts`.
- ✅ **21** is_conference_game — DONE + verified, 2,576,146 / 2,576,146 (`scripts/_next_derived.ts`).
- ✅ **22** pitch_log sequence — DONE + verified, 2,576,146 / 2,576,146 (same keyset pass as 21).
- **23** Hitter Master `pull_air` + Pitching Master `in_zone_pct` from `pitch_log_*_totals`.
- 🛑 **Stuff+ (HEAVY, ~2.5M pitches) — the pitch_log lane, steps 1–5.** ⛔ **PREREQ: rebuild prod's `pitch_log_corrected`
  VIEW first** (94 of 99 cols, missing `classification_version` → the scorer hard-fails). Then: `reclassify_prod.ts`
  (labels + version + needs_review + `_reclass_pf`) → re-derive `pitcher_stuff_plus_ncaa` → `compute_pitch_log_stuff_plus.ts`
  (reads `pitch_log_corrected`, `--class-version=` defaults to the v2 stamp; idempotent but NOT resumable — run detached)
  → `aggregate_pitch_log_dimensions.ts --apply --prod --direct` → `derive_masters_from_pitchlog.ts --apply`.
  ⛔ **NOT `recompute-stuff-plus.ts` / `runStuffPlusPipeline` / `legacy_rollupStuffPlusToMaster`** — legacy raw-HB lane,
  scores left-handers backwards. Recomputes `stuff_plus` on the NEW venue fixture (prod `stuff_plus` is currently old).
- **24** `backfill_trackman_pitches_pitching_master.ts --apply` — run AFTER the pitch_log aggregation above, off
  `pitch_log_pitcher_totals`; ⚠ NOT off the legacy `pitcher_stuff_plus_inputs`. Ordered pagination fixed.
- **25** `derive_masters_from_pitchlog.ts --apply` (needs A11 UNIQUE ✓; ordered pagination ✓) — this is what sets
  `Pitching Master.stuff_plus`, and it must run BEFORE compute_scores.
> 🛑 **THE NUMBERS BELOW ARE NOT THE RUN ORDER.** Correct Phase-C tail order (audit 2026-08-30, matches
> `PROD_PUSH_STEPS_2026_08_26.md` and `PROD_PUSH_BULLETPROOF_CHECKLIST.md`):
> **25 → 24 → 29 → 27 → 26 → 28.** Two inversions, each with a one-line reason so nobody "corrects" it back:
> - **27 before 26** — `computeAndStoreScores.ts:206-211` reads its means/SDs (incl. `stuff_plus`/`stuff_plus_sd`,
>   `:249`) out of the `ncaa_averages` table that 27 writes; a missing field falls back to hardcoded defaults
>   **silently** (`:212-215`), so running 26 first z-scores the new Stuff+ against the stale distribution.
> - **29 before 28** — prod season 2026 has **10 NJCAA rows still tagged `division='D1'`** (verified read-only
>   2026-08-30: 40 `D1` rows, 10 of them `NJCAA%`; staging is already 30 `D1` + 10 `NJCAA_D1`). Both 28 producers
>   (`compute_conf_pitcher_env_plus.ts:29`, `derive_conf_opr_htp.ts:12`) filter `.eq("division","D1")`, so running 28
>   first writes D1-derived env+/OPR/HTP straight into the JUCO overlay.

- **26** `computeAndStoreScores` (power ratings; propagate=false). ⚠ **RUNS AFTER 27** — see the 🛑 above.
- **27** `computeNcaaAverages`. ⚠ **RUNS BEFORE 26** — see the 🛑 above. ✅ Its two defects (unordered `.range()`,
  legacy-lane Stuff+ weight + silent `.catch`) are **fixed in code 2026-08-30**; expect prod `ncaa_averages(2026).stuff_plus`
  101.8341 → ~102.33.
- **28** Conference Stats — ⚠ **RUNS AFTER 29** — see the 🛑 above. — ★ **G-GATE FIRST** (re-run `conf_stats_bucketA_assembly.sql` on STAGING vs `_confstats_backup_preassembly`, diff 0.0000) THEN prod: bucketA (PASTE, never --linked) · `compute_conf_pitcher_env_plus.ts --apply` · `derive_conf_opr_htp.ts --apply`. ⚠ DO NOT run `populate-conf-stats` (overwrites JUCO overlay).
- **29** NJCAA_D1 re-tag `UPDATE "Conference Stats" SET division='NJCAA_D1' WHERE season=2026 AND "conference abbreviation" LIKE 'NJCAA%' AND division='D1'`. ⚠ **RUNS BEFORE 28** — exactly 10 rows match on prod (verified 2026-08-30).

## REMAINING PHASES (after C)
- **D — dWAR/bsr:** `load-drs-wsb-staging.ts --prod` (idempotent re-load; data already current) → `scripts/drs/populate_descriptive_war.mjs --prod --commit` → `scripts/drs/populate_descriptive_war_reg.mjs --prod --commit`. 🛑 **All three page with an UNORDERED `.range()` — fix before running** (`load-drs-wsb-staging.ts:53` over the 31,467-row `players` table; `populate_descriptive_war.mjs:57,58`; `populate_descriptive_war_reg.mjs:33,34`). ⛔ **Do NOT add a blanket `.order("id")`** — corrected 2026-08-30:
  `player_season_defense` and `player_season_baserunning` have **no `id` column** on either project. Use the real PK:
  defense → `.order("player_id").order("season").order("position")`; baserunning → `.order("player_id").order("season")`;
  `players`/Masters → `.order("id")`. (Same rule as the `PAGINATION_KEYS` map in `src/lib/computeNcaaAverages.ts`.) Prod guards themselves are correct ✅. (Optional exhibit `scripts/drs/derive_team_drs.mjs` runs LAST if at all — staging-hardcoded at `:13`, but CSV-only, no DB write.) (fills the desc_* Master cols we added in Phase A). Verify d_war/bsr_war centered.
- **E — precomputes (HEAVY) ★order:** `run-twp-recompute.ts --apply` (is_twp 137→253, FIRST) → returner pitchers (`:prod`) → returner hitters (`:prod`) → `zsh scripts/_run_step2_all.sh --prod` (**every ACTIVE team from the dynamic list — prod has 14, and North Carolina is NOT on prod**; "18 incl. NC" is a staging figure. Raise statement_timeout for propagate.) 🛑 `_run_step2_all.sh:36,38` pipe each run through `| grep | head`, which **discards exit codes** — "ALL DONE" is not proof every team succeeded; re-run the dry-run per team to confirm.
- **F — re-bakes ★order:** `select refresh_composite_war();` (÷13.1, only now) 🛑 **fire from the direct pg session (PGURI) or the SQL editor — NOT `.rpc()`/MCP**: the fn sets `statement_timeout=180000` internally, above the ~125s HTTP gateway ceiling, so over HTTP it cuts and ROLLS BACK. (Prod is already ÷13.1 — verified 2026-08-30.) → `backfill-snapshot-total-hitter-war.ts --apply` → TWP markets → market resyncs (✅ **FIXED 2026-08-30** — `resync-build-snapshot-markets.ts` no longer hardcodes `.env.local`; it and `resync-target-snapshots.ts`, `rebuild-twp-target-rows.ts`, `rebake-twp-markets.ts`, `fix-returner-twp-hitter-market.ts` are all env-driven with a double-keyed guard. **Invoke as `npx tsx --env-file .env.production.local scripts/<x>.ts --prod --apply`**; `--env-file` alone now refuses, and `--prod` against staging refuses. ⚠ `resync-build-snapshot-markets` defaults to a **staging** build id → use `--all` on prod) → **`recompute-snapshot-hitter-market.ts --prod --apply`** (stale-PTM re-price, step 42b) → neutral + heal snapshots → `select refresh_team_season_stats(2026);` LAST 🛑 **BLOCKED: `team_season_stats` and `refresh_team_season_stats` DO NOT EXIST ON PROD** (probe 2026-08-30). Apply `20260819000000` (create) → `20260821010000` (war cols) → `20260819010000` (fn) in Phase A first — **that order is load-bearing** (fn-before-ALTER `DELETE`s the season then aborts on `hitter_war_total does not exist`, leaving the table EMPTY). Copy-pasteable plan + verification query = `PROD_PUSH_STEPS_2026_08_26.md` **Phase-A step 10a**; needs Trevor's explicit "prod, now?". → reseed 2026 team_war_snapshots + display swap.
🛑 **SUPERSEDED 2026-08-31 — G46 was REMOVED from the push (Track B branch). DO NOT DEPLOY.** - **G — edge fn (Trevor):** `supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm` (prod v12 → v27). NEVER `--linked`. 🛑 **PREREQ (was unstated here): `team_season_stats` must EXIST and BE POPULATED** — i.e. F44 has run. The fn reads `team_season_stats.faced_htp`/`faced_stuff_plus` at `supabase/functions/process-precompute-jobs/index.ts:1095`,`:1419`; deploy early and Independent-team faced-competition silently degrades. Deploy `process-precompute-jobs` ONLY — `recalculate-prediction` is DEAD.
- **PREVIEW-VERIFY → MERGE:** check the Vercel preview (reads PROD) → merge to main (Trevor drives).
- **H — gated drops (LAST):** park_factors lowercase (strip google-sheets-sync calls first) · pitch_log corrupt team-id cols (recreate view first) · player_prediction_internals · one-off temps (**only `_reclass_fix`**). ⛔ **NEVER drop `team_war_snapshots`** (2025 champions = 309 rows on prod), `_reclass_result`, `_reclass_map`, `_reclass_pf`, or `_v2_prechain_backup` — see "PHASE-H CLEANUP" below.

## PROTOCOL (keep following it)
Dry-run every `--apply`/write first → show result → Trevor says "prod, now?" → apply → **log the row in
`PROD_MIGRATIONS_TODO.md` execution log before moving on**. DDL/SQL via `_run_sql_file.ts` or PASTE. `--prod` backfills:
Claude runs. Edge-fn deploy + final merge: Trevor. **When a step's script is missing (ad-hoc gap): reconstruct from the
staging schema/data, commit it, then apply — never improvise blind.**

## LANDMINES (do not trip)
- ⚠ `--linked` = PROD. Conf-stats bucketA = PASTE. Edge fn = explicit `--project-ref`, never `--linked`.
- Non-idempotent one-timers: `20260806 RENAME total_war` (DONE — skip), `TRUNCATE gm_allocation`, bare `CREATE POLICY`, `team_season_stats_war_rollup` INSERT (use the refresh fn), `player_slot_values` dedup DELETE.
- Order: seed_nil BEFORE re-price (done) · `refresh_composite_war()` FIRE (÷13.1) only AFTER Phase E o_war re-precompute · ts-war-columns BEFORE first `refresh_team_season_stats` (cols already present on prod) · calibration BEFORE pitcher precomputes (done).
- REGENERATE-not-copy on prod (per-env ids): venue (done), park_code, pitcher_full_name, descriptive WAR, team_season_stats, conf-stats, TWP flags, trackman, calibration, market re-price.
- PostgREST count on huge tables (pitch_log) TIMES OUT — use estimated count or early-stop `.limit()` presence checks; paginate with a STABLE unique order (`id`), never a non-unique column.

## VERIFICATION GATES (at the end, from the runbook)
201 keys / nil_tier_sec 4.0 (✓ done) · 0 negative projected rates except HR9-floored · top-12 pitchers Stuff+ 99–113 · TWP both sides + combined NIL, 253 flagged · market roster totals SEC ~$4.4M / ACC ~$1.7M / Big12 ~$1M · all 18 teams precomputed · team_season_stats 308 rows · edge fn staging↔prod lockstep (add a test team, projections match batch).

---

## ★★★ THE STUFF+ CHAIN — pitch_log lane (the ONLY correct order)
Any Stuff+ step that routes through `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
`legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane** and is WRONG for 2026. It
revives the latent raw-HB bug (`e5dec2f` removed `hbSign`; PSP-I still stores RAW hb ⇒ left-handers scored backwards)
and writes numbers nothing displays. **Never run it for 2026.**

1. **Reclassify** → `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`
   `scripts/reclassify_prod.ts` (v2 classifier; `--dry-run` first, then `--go` with PGURI + explicit "prod, now?";
   `--target=staging` for staging). Also MATERIALIZES `_reclass_pf` as a by-product — the scorer hard-depends on it.
2. **Re-derive the pop baseline** → `pitcher_stuff_plus_ncaa` (per pitch_type × hand, **armHB**, D1-only).
   ⚠ MANDATORY, not optional: the §4.5 gyro fix moves 6-8% of ALL breaking-ball volume Slider→Gyro Slider, so every
   mix-dependent artifact is invalid until regenerated. The deriver ABORTS before writing if the armHB sign check fails.
3. **Score per pitch** → `pitch_log.stuff_plus` — `scripts/compute_pitch_log_stuff_plus.ts`
   🛑 **MUST READ BEFORE RUNNING THIS STEP:** the version filter is now parameterized (`--class-version=`, defaulting to
   the v2 stamp) — it used to be hard-coded to `v1-anchor-2026-08-17`, which silently matched 0 rows and left NEW LABELS
   + OLD SCORES. This step is idempotent but does **NOT** resume: every attempt costs the FULL runtime (~36 min on
   staging, longer on prod) and a mid-run failure leaves v2 labels + STALE scores. Run it DETACHED with
   `caffeinate -dimsu -w <pid>`. Requires `_reclass_pf` (materialized by step 1).
   (normalizes hb→armHB itself; recenters each (pitch_type × hand) bucket to mean 100)
4. **Aggregate** → `pitch_log_pitcher_totals` / `pitch_log_hitter_totals` / `*_by_pitch_type`
   `scripts/aggregate_pitch_log_dimensions.ts --apply` (also calls `populate_hitter_run_values(season)`)
   🛑 **MUST READ BEFORE RUNNING THIS STEP → see "STEP 4 — SOLVED: USE `--direct`" below.** On PROD you MUST run ALL of
   step 4 with `--direct` (the HTTP gateway cuts at ~125s; `vs_top_hitters` needs 253s on staging, longer on prod, and a
   failure HALTS the dimensions after it). Validate by CONTENT + FRESHNESS — never by exit code or row count.
5. **Marry onto the Masters** → `scripts/derive_masters_from_pitchlog.ts --apply`
   (its `readAll` pagination is now `.order(PK)`-ed — unordered `.range()` over ~2.5M rows silently dropped/duped).
6. Then continue the runbook: C23–C29 → Phase D (dWAR) → E (precomputes) → F (re-bakes) → G (edge fn) → H (drops).

**INVARIANTS**
- ⚠ A label change invalidates every downstream number. Steps 1→5 must complete in the SAME working session;
  never leave an environment with new labels and old `stuff_plus`.
- `hb` is stored RAW everywhere and displayed raw. armHB is a COMPUTE convention only — normalize in memory.
  NEVER rewrite the stored `hb` column.
- One consistent label vocabulary: `4S FB` (not `4-Seam Fastball`) + a `classification_version` stamp on every row.
- Full detail + evidence: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`; exact numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11.

---

## ★★★ STUFF+ v2 CLASSIFIER — FINAL STATE + CONCLUSIONS (2026-08-30). Numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11.
**SINGLE SOURCE:** `src/savant/lib/stuffPlusClassifierV2.ts`. `scripts/reclassify_v2.ts` is a VALIDATION HARNESS only —
its duplicate copy of the classifier was DELETED (that duplication is exactly why earlier numbers drifted).

**FINAL ACCURACY — full population, all 4,804 pitchers / 2,000,674 pitches of `_reclass_result`:**
**1,904,808 / 2,000,674 = 95.2% per-pitch · arsenal-mix 95.3% · needs_review 8.1%** (§11.13 — with §4.5 running BEFORE
the step-4 backfill). ⚠ **SUPERSEDED, never quote as current:** 92.6% (measured on the deleted duplicate copy),
94.3% (pre-gyro-fix), 95.1% (§4.5 running after the fold), "~85%" (the abandoned Tier-2 reconstruction), and any
"projected ~95.3-95.4%".

**THREE FIXES SHIPPED (all measured, none guessed):**
1. **Offspeed armHB floor** `armhb > 0` → **`armhb >= 5`**. Gyro armHB p99=4.7 vs offspeed p1=5.3 — a clean empty gap.
   Killed `Gyro→Change-up` (338 losses) and `Cutter→Change-up` (29) outright.
2. **Fastball-family MERGE GUARD** — never merge clusters whose fastball-family seeds (`4S FB`/`Sinker`/`FBSTRIP`)
   differ. Merge was swallowing the FBSTRIP cluster before it could be resolved; **>60% of all 4S↔Sinker errors** were
   merged FBSTRIP clusters. 91.69% → 93.01%; 4S↔Sinker errors 2,830 → 1,676 (−41%). Also preserves genuine
   two-fastball arms (14ivb/8hb vs 8ivb/14hb at equal velo stay SEPARATE; 14/8 vs 13/9 correctly merge).
3. **§4.5 gyro/slider cluster-centroid floor** `GYRO_ARMHB_FLOOR = -3`, applied **BEFORE the step-4 backfill** (and
   therefore before `tiebreak()`). `Gyro→Slider` 1,675→471 / 1,788→508; `Gyro→Cutter` 415→131 / 437→56; zero
   fastball/offspeed regression. Ordering is load-bearing and is worth the final +0.1pp over the "after the fold" build.

**TWO NEGATIVE RESULTS — do NOT rebuild these:**
- `rr > -1.7` FBSTRIP cut (made agreement WORSE: disputes 1,443 → 2,503; it was fit on a merge-corrupted population).
  `rr >= 0` stays — within noise of the 91.9% @ rr=-0.13 optimum.
- The **"arsenal rule"** (flip Slider→Gyro when the pitcher has a GY seed and no SW seed) is a **CONFOUND**, not a rule:
  sweeper-presence predicts the anchor 71.5% vs 89.1% for the cluster's own mean armHB. Implemented literally it
  **LOSES 0.97/1.26pp**. Do not rebuild it from the `_reclass_map` contingency table.
**VERIFIED ALREADY-OPTIMAL (do not touch):** Sweeper/Slider armHB −12 (1.0% error) · Gyro/Slider armHB −5.

**★ DECISION — STANDARDIZE ON v2 IN BOTH ENVIRONMENTS (Trevor, FINAL; EXACT_VALUES §11.12).**
The coherence partition (234 pitchers, 1,188 decidable disputes, run after all three fixes) measured that the ANCHOR
wins the disputed residual **55.9 / 44.1**. That measurement STANDS, and its cost is quantified: ≈11,700 pitches ≈
**0.6% of the population**. We pay it, because the anchor has **NO SOURCE CODE** (lost scratchpad) — it can never be
re-run, on new data or on prod — while v2 is committed, versioned, re-runnable, and is what Track B needs on every
ingest, with ONE vocabulary + a `classification_version` stamp in both environments.
→ **DO overwrite staging's `pitch_type_reclassified` with v2.** Any "do NOT overwrite staging's labels" guidance
(including the earlier framing in SOURCE_OF_TRUTH §4 and EXACT_VALUES §11.11) is **REVERSED and obsolete**.
→ **PRESERVE `_reclass_result`** — the sole surviving record of the anchor, and the regression baseline for every
future classifier change.
⚠ Limitation kept on the record: the coherence partition does NOT cover the Gyro↔Slider pair (23,048 pitches, the
largest residual) — centroids were unavailable after the §4.5 fix. Whether the −3 floor over-calls gyro relative to
physical truth is STILL UNMEASURED; do not claim it either way.

**⚠ DOWNSTREAM — NOT display-only.** The gyro fix moves **6-8% of ALL breaking-ball volume** Slider→Gyro Slider. Every
mix-dependent artifact MUST be regenerated after a reclass run: `pitcher_stuff_plus_ncaa` baselines, D1/regional means
+ SDs, pitch-shape percentiles. Reclassify → baseline → score → aggregate MUST complete in ONE session.

**PROD STATUS:** prod pitch_log is on the OLD per-pitch CASE labels (`"4-Seam Fastball"` naming, ~2,176,888 labeled of
~2,575,996, NO `classification_version` stamp, `needs_review` all null) — **v2 has NEVER written to prod**; the prior
prod work was a read-only dry run. v2 vs prod's existing labels = **70.9% agreement (v2 would change 584,130 pitches =
29.1%)**, and v2 is far closer to the validated set (distribution deviation from anchor **38.7 → 21.6**), correcting
prod's Cutter 10.3%→3.7% (anchor 2.4%) and Splitter 0.7%→2.1% (anchor 2.2%). Prod run is GATED on PGURI + an explicit
"prod, now?" and MUST be followed immediately by the rest of the Stuff+ chain.

---

# STAGE 0 — PRE-PROD BLOCKER STATUS (updated 2026-08-30): **1 OPEN, THE REST RESOLVED**
Prod's **DATA is ready** — 100.00% of prod's `is_data=true` rows (~1,906,398) are v2-classifiable, venue corrections
resolve, same games/window as staging. Every blocker was CODE or SCHEMA, and all but one have shipped.

## ⛔ STILL OPEN — the only thing blocking the prod chain
1. **PROD `pitch_log_corrected` VIEW IS STALE — missing `classification_version`.** The view is `select pl.*, …` and
   Postgres FREEZES `*` at creation time, so prod's view is stuck at **94 columns** vs the base table's 99. Missing:
   `classification_version, needs_review, ab_num_in_game, pitch_num_in_game, pitch_num_in_ab, park_code,
   is_conference_game, game_string`. Running the scorer's query against prod returns
   `column pitch_log_corrected.classification_version does not exist`. Same query on staging = OK.
   ⚠ `create or replace view` will NOT fix it (new columns land mid-list) → needs **`drop view pitch_log_corrected
   cascade; create view …`** rebuilt against the current column list. **DDL — requires an explicit go, separate from the
   data-write "prod, now?".** (Reclassification itself is unaffected — `reclassify_prod.ts` doesn't read those columns.)

## ✅ RESOLVED — shipped; do NOT re-raise these as blockers
2. **Scorer version filter — RESOLVED.** It was hard-coded `.eq("classification_version","v1-anchor-2026-08-17")` while
   `reclassify_prod.ts` stamps `v2-ranges-2026-08-28`, so it silently matched 0 rows (new labels + old scores). It is now
   **parameterized (`--class-version=`, defaulting to the v2 stamp)**. *Evidence:* on staging steps 1→3 connected
   end-to-end and scored 2,015,321 rows. (This also supersedes the old checklist item "do NOT loosen the filter".)
3. **`_reclass_pf` producer — RESOLVED.** `reclassify_prod.ts` now materializes it as a by-product of `pfbVelo()`.
   *Evidence:* the staging run materialized **5,364 pitchers**, and step 2 read it back.
4. **`aggregate_pitch_log_dimensions.ts` prod path — RESOLVED.** It now has a prod path + a `--prod` guard, plus the NEW
   `--direct` and `--only=` flags. *Evidence:* `--direct` cleared `vs_top_hitters` on staging in 253.2s.
5. **§4.5 ordering — RESOLVED.** §4.5 runs BEFORE the step-4 backfill; measured **95.2% / 95.3%** (§11.13) — strictly
   better on both metrics than the 95.1% "after the fold" ordering, so there is nothing left to measure or revert.
6. **Ordered pagination — RESOLVED.** `derive_masters_from_pitchlog.ts` `readAll` is ordered, plus two further
   ordered-pagination fixes (`backfill_trackman_pitches_pitching_master.ts`, `compute_conf_pitcher_env_plus.ts`).
7. **Legacy lane gated out of the live prod CSV path — RESOLVED.** `scripts/import-csvs/runner.ts` (= `npm run
   import:prod`, which goes DIRECT to prod) no longer runs the legacy raw-HB lane, and npm `recompute-stuff:prod` /
   `recompute-stuff-scoped:prod` were **DELETED**. A routine TruMedia import can no longer score left-handers backwards.
8. **Ledger entries — RESOLVED.** C20 park_code (2,576,146 = 100%), C21 `is_conference_game` + C22 sequence
   (2,576,146), and migration `20260828000000_pitch_log_classification_version_needs_review.sql` are all logged in
   `PROD_MIGRATIONS_TODO.md`.
9. **Staging reclassification writer — RESOLVED.** `reclassify_prod.ts --target=staging`, with a double-keyed guard
   (it refuses unless PGURI's project ref matches the named target).

## ⚠ CLAIMS THAT ARE FALSE — audits disproved them; do not treat any of these as live blockers
"A5 aggregator (pitch_log → `pitcher_stuff_plus_inputs`) is missing" · "the baseline deriver is missing" ·
"the live path has a pop/row convention mismatch" · "the v2 reclassification WRITER does not exist" ·
"the classifier is only ~85% and cannot reach its gate". All verified present / correct / superseded.

## OPEN BUT NOT BLOCKING
- **C21/C22 derive-over-copy follow-up.** They were COPIED from staging (`_next_derived.ts`), not derived. Prod must be
  able to DERIVE `park_code` / `is_conference_game` / sequence going forward or **Track B breaks on the next ingest.**
- **Migration `20260829120000_gm_budget_nil_allocation_mode.sql`** — committed, **NOT yet applied to either env.**
- **Row-count populations, pinned so gates are falsifiable** (these are DIFFERENT populations, not a contradiction):
  2,576,230 = prod pitch_log total pre-dedup · 2,576,146 = park_code/is_conf/sequence filled · ~2,176,888 = prod rows
  carrying an OLD CASE label · 2,013,005 = the v2 prod DRY-RUN label count · **prod `is_data=true` ≈ 1,906,398**
  (74.01% of 2,575,996) · staging v2 classified/stamped = 2,015,321.

## GREEN — verified ready on prod (audit 2026-08-29, read-only)
v2-classifiable **100.00%** of is_data=true (~1,906,398) · venue corrections **311 rows**, ivb/hb_corrected differ from
raw in 100% of samples · release_velocity/ivb/hb/spin/rel_height/rel_side/pitcher_hand/pitcher_id/park_code/
is_conference_game/sequence/pitcher_full_name all **0.00% NULL** (extension 0.04%) · same games + window as staging
(2026-02-13 → 06-22, identical first/last uniq_pitch_id) · `pitcher_stuff_plus_ncaa` 18 D1 buckets ·
pitch_log_pitcher_totals 37,186 · hitter_totals 50,227 · by_pitch_type 161,310 / 252,464.
⚠ `Pitching Master` rollup is BEHIND staging: `trackman_pitches>0` **1,126 vs 6,458**; `stuff_plus` 5,251 vs 6,011.
⚠ `vaa` column absent on prod — NOT a blocker (100% NULL on staging; neither classifier nor scorer reads it).

---

# ▶️ STAGING + PROD STATE, AND THE NEXT ACTIONS (2026-08-30)

## ✅ DONE + VERIFIED ON STAGING (do NOT redo)
| step | result |
|---|---|
| 0 backup | `_v2_prechain_backup` = **2,579,655 rows** / 2,191,583 labeled / 2,014,152 scored. **DO NOT DROP until the chain is signed off.** Reverses everything via one UPDATE…FROM join on `uniq_pitch_id`. |
| 1 classify | **2,015,321** stamped `v2-ranges-2026-08-28`, needs_review **8.1%**, 101 batches, updated 1,995,321. `_reclass_pf` materialized (**5,364** pitchers) — NEW producer, first ever run, works. |
| 2 baseline | **✓ armHB SIGN CHECK PASSED ON ALL 18 BUCKETS** → upserted 18/18. The armHB convention is now PROVEN, not assumed (the deriver aborts before writing if it fails). |
| 3 score | **2,015,321 scored + recentered** (35.7 min). unscored = 0. Every (type×hand) bucket recenters to **exactly 100.0**. |
| 4 aggregate | **ALL 48 dimensions refreshed** + `populate_hitter_run_values(2026)` ✓. The 3 `vs_top_hitters` aggregations that had failed on the gateway were completed over the DIRECT pg session (`--direct`). Tables: pitcher_totals 37,575 · hitter_totals 50,633 · pitcher_by_pitch_type 186,622 · hitter_by_pitch_type 301,957 · hitter run values 6,053. |

**★ PROD-GATE TOLERANCE (pre-registered): per-pitcher Stuff+ mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 ·
4,234 pitchers.** Prod must land within tolerance of this or **ABORT**.

## ⚠ STILL OPEN ON STAGING
- **Step 5 `derive_masters_from_pitchlog.ts` — DRY RUN ONLY.** Dry run: **0 hitters / 4,675 pitchers** would change
  (of 4,772 above-gate). It has NEVER been applied on ANY environment. Review the diff before `--apply`.

## ▶️ NEXT ACTIONS, IN ORDER
1. Review + apply step 5 (Masters) on staging.
2. **PROD BLOCKER FIRST — rebuild the stale view:** prod `pitch_log_corrected` is `select pl.*` frozen at **94 of 99
   columns** and MISSING `classification_version`, so the scorer hard-fails there. Needs
   `drop view pitch_log_corrected cascade; create view …`. **DDL — needs its own explicit go, separate from "prod, now?".**
3. Apply migration `20260829120000_gm_budget_nil_allocation_mode.sql` to BOTH envs (committed, never run).
4. Prod chain: reclassify → baseline → score → aggregate (**`--direct` from the start**) → Masters. Then C23→C29,
   Phase D→H per the runbook, on the pitch_log lane.

## ⏱ PROD TIME BUDGET
Staging actuals: step 1 ≈ **75 min** (load + classify + 2M keyset UPDATE) · step 3 ≈ **36 min** · step 4 ≈ **50 min**
→ **staging total ≈ 2.5-3 h.** Prod is a SMALLER compute tier with a MORE throttled disk and its `exec_sql` already
times out on lighter queries → **budget 4-6 h for the prod Stuff+ block alone**, plus C23-C29 and Phases D-H after it.
Do it in **ONE sitting** with the machine pinned awake (`caffeinate -dimsu -w <pid>`) — steps 1→5 must not be split,
because a gap leaves prod with **v2 labels + STALE scores**.
⚠ **Step 3 does NOT resume** (it re-scores everything matching the class version), so any interruption costs the FULL
runtime again. The two-phase fix (score only `stuff_plus IS NULL`, then ALWAYS recenter across the full population) is
worth building BEFORE the prod run — the recenter must see the whole population, which is why a naive resume is wrong.

---

# ✅ STEP 4 (`aggregate_pitch_log_dimensions`) — SOLVED: USE `--direct`. (staging-proven 2026-08-30)
**ROOT CAUSE CONFIRMED, not theorised.** Every aggregation in this script ran through `exec_sql` over the HTTP gateway
(`aggregate_pitch_log_dimensions.ts:1035`), and the gateway cuts the client at ~125s — the work is LOST.
`[40/48] vs_top_hitters → pitcher_totals — FAILED after 125.3s: upstream request timeout`, **reproduced EXACTLY twice**
(same dimension, same error, same duration). That query must resolve the top-quartile hitter set (~967 IDs) and filter
~2M pitches against it. Over the **DIRECT pg session the SAME query succeeded in 253.2s** — it simply needs ~2× the
gateway's ceiling; nothing else changed. 47 of 48 dimensions run fine (~60-72s each). ⚠ The script **HALTS** on a
failure, so dimensions 41-48 never ran either — one bad dimension blocked 9.

## THE COMMANDS
Staging (single dimension):
```
npx tsx --env-file .env.local scripts/aggregate_pitch_log_dimensions.ts --apply --direct --only=vs_top_hitters
```
**PROD — run the WHOLE of step 4 with `--direct`, not just this dimension:**
```
npx tsx --env-file .env.production.local scripts/aggregate_pitch_log_dimensions.ts --apply --prod --direct
```
`vs_top_hitters` already needs 253s on STAGING. Prod is a smaller compute tier with a more throttled disk (expect
~8-10 min for that one dimension) and prod's `exec_sql` has ALREADY been observed timing out on lighter queries →
through the gateway it would fail on prod **100% of the time**, and the halt would block the 8 dimensions after it.
**`--direct` is NOT a staging workaround — it is the REQUIRED path on prod.**

## FLAGS ON `aggregate_pitch_log_dimensions.ts`
- **`--direct`** (new 2026-08-30) — executes over the `PGURI` session (`statement_timeout=0`, no gateway ceiling)
  instead of `exec_sql`. Guarded: the PGURI project ref MUST match the target env or it refuses to run. Logs the path used.
- **`--only=<keys>`** (new 2026-08-30) — mirrors `--skip=`; runs ONLY the named dimension(s), so one failed dimension can
  be re-run without redoing the other 47. (Partial answer to the resumability gap.)
- **`--skip=<keys>`** (existing) — skip named dimensions.
- **`--prod`** guard + prod path (added at Stage 0).

## ⚠ THE TWO TRAPS — validate by CONTENT and FRESHNESS, never by exit code or row count
- **A failed dimension leaves STALE rows that LOOK populated.** When `vs_top_hitters` failed, `pitch_log_pitcher_totals`
  still SHOWED **5,349 rows** for that `dimension_key` — left over from a PRE-v2 run, computed from OLD labels and OLD
  Stuff+ scores. **A row-count check would have passed.** → After ANY reclassification, verify a dimension by
  FRESHNESS (did *this* run write it?), never by row count.
- **The script EXITS 0 even when a dimension FAILED.** → grep the log for `FAILED` and for the per-dimension `ok`.
  A run was wrongly marked COMPLETE this way on 2026-08-29.

## RESUMABILITY OF THE CHAIN (know what a restart costs)
| step | resumable? | why |
|---|---|---|
| 1 `reclassify_prod.ts` | ✅ FULLY | keyset on PK + `is distinct from` guards + `_reclass_fix` upserted by PK. A re-run skips completed rows. |
| 3 `compute_pitch_log_stuff_plus.ts` | ❌ NO — and it is the costliest to lose | re-scores ALL rows matching the class version instead of filtering `stuff_plus IS NULL`. Every attempt costs the FULL runtime (~36 min staging, longer on prod), and a mid-run failure leaves **v2 labels + STALE scores**. FIX (future): two phases — score only NULLs, then ALWAYS recenter the full population (the recenter must see everything to shift each bucket to mean 100). |
| 4 `aggregate_pitch_log_dimensions.ts` | ⚠ MANUALLY | the 48 dims are independent and `--skip=`/`--only=` exist, but you must pass the completed keys BY HAND. FIX (future): auto-skip dims already written for this run-generation. |

## ⚠ ENVIRONMENTAL FAILURES — do not confuse them with the gateway timeout
Three failures the same night were the LOCAL MACHINE sleeping / dropping its connection, NOT script defects:
staging insert `TypeError: fetch failed` · STEP 3 scoring died at 1,665,000/2,015,321 (~83%) with `read ECONNRESET` ·
STEP 4 first run died at 13/48, second at 39/48.
**Distinguishing symptom:** environmental failures die at DIFFERENT points each run; the `vs_top_hitters` failure died
at the SAME dimension with the SAME duration every time.
✅ **PROVEN PROCESS (Trevor): run long steps DETACHED and let them take however long they need,** with
`caffeinate -dimsu -w <pid>` tied to the process so the machine cannot sleep mid-run. Do not babysit, do not add
aggressive retry loops.

---

## 🏆 PHASE-H CLEANUP — WHAT MUST NEVER BE DROPPED
Phase H lists the Stuff+ `_reclass_*` temp tables as drop candidates. **EXCLUDE these — plus `team_war_snapshots`:**
- **`_reclass_result` (2,000,674 rows)** — the ONLY surviving record of the lost ANCHOR classifier's output. Its source
  code was scratchpad-only and is gone permanently. Now that we standardize on v2, this is the SOLE way to ever measure
  against the old process — the regression baseline for every future classifier change.
- **`_reclass_map` (37,101 rows)** — per-pitcher seed→label resolution; the evidence base for arsenal-conditioning research.
- **`_reclass_pf` (4,804 rows)** — per-pitcher primary-FB velo (the v2 staging run materialized 5,364 rows of it).
- **`team_war_snapshots`** — holds prod's irreplaceable 2025 champions (309 rows). NEVER drop.
Safe to drop: **`_reclass_fix`** (transient writer staging table only).

---
# ✅ MANDATORY PHASE-GATE CHECK — "column exists" ≠ "column is populated" (added 2026-08-30)
The 2026-08-30 audit measured that A8/A9-era columns **EXIST** on prod. It did NOT measure whether their producers
actually FILL them. Those are different failures and only the second one is silent.
**RULE: after EVERY producer step, verify the VALUE landed — not just that the column/table is there.**
A producer that runs, exits 0, and writes nothing looks identical to success. We hit this exact shape twice already:
`vs_top_hitters` left 5,349 STALE rows that made a row-count check PASS, and `compute_pitch_log_stuff_plus` was
filtered to a version string that matched 0 rows while appearing to succeed.

## KNOWN-EMPTY ON PROD TODAY (columns present, values absent) — each must be re-checked AFTER its producer runs
| column / field | table | prod state (2026-08-30) | filled by | GATE: re-check after |
|---|---|---|---|---|
| `hitter_talent_plus` | Conference Stats | **0 / 42** non-null | C28 conf-stats work | C28 |
| `run_env_factor` | Conference Stats | absent values | C28 (`compute_conf_pitcher_env_plus` / `derive_conf_opr_htp`) | C28 |
| `rg_factor_seasonal` (+ the other 9 `*_seasonal`) | Park Factors | **0 / 309** | E2 park-factor producer | E2 |
| `desc_owar` (+ `desc_*` / `total_desc_war`) | Hitter/Pitching Master | **0 / 5,340** | D31 `populate_descriptive_war.mjs` · D32 `_reg` | D31/D32 |
| `preseason_proj_total_war` | (staging-only col, 127 vs 128) | absent on prod | some precompute/snapshot call — NOT a migration | E/F precomputes |
| `trackman_pitches` | Pitching Master | **1,126** vs staging **6,458** | C24 | C24 |
| `stuff_plus` | Pitching Master | 5,251 vs staging 6,011 | C25 `derive_masters_from_pitchlog` | C25 |

## HOW TO GATE (do this at every phase boundary, not at the end)
1. **Count non-null BEFORE and AFTER** the producer. `after > before` and `after ≈ staging's count` — record both numbers.
2. **Compare to STAGING** (the source of truth) for the same season. ⚠ **SEASON KEYS DIFFER BY PURPOSE:
   2026 = completed season / descriptive WAR · 2027 = projections.** A query on the wrong season returns a misleading
   ZERO. (This already produced a false "staging has no WAR data" alarm on 2026-08-30.)
3. **Validate by CONTENT, not exit code** — several producers exit 0 having written nothing.
4. **Verify FRESHNESS, not row count** — a failed step can leave stale rows that a count check passes.
5. If a value is STILL empty after its producer ran, that is a SEPARATE BUG. Stop and diagnose; do NOT proceed to the
   next phase assuming it fills later.

---
# 🛑 STEP 5 / C25 `derive_masters_from_pitchlog.ts` — READ BEFORE `--apply` (2026-08-30)
**This script had NO gate on new-row creation.** `newHitterRows`/`newPitcherRows` were spread into the SAME upsert as
the patches, so `--apply` silently INSERTED invented Master rows and there was no way to take the updates without the
inserts. **FIXED 2026-08-30: new-row creation is now opt-in via `--create-new`, default OFF.**

**WHY inserting them is wrong:** the Masters are the **TruMedia season-stat source of truth**. This script only marries
pitch-log derivations onto EXISTING rows — it explicitly never writes `ERA, IP, G, GS, Role`. A row built from
pitch_log alone is a **HALF-POPULATED player** that downstream treats as real with missing stats. And the candidates
are exactly the pitchers present in pitch_log but ABSENT from the Master — identity-resolution gaps and non-TruMedia
teams — i.e. the rows you least want silently materialized.

## HOW TO RUN IT
```
# review first — dry run is the DEFAULT (no flag)
npx tsx --env-file .env.local scripts/derive_masters_from_pitchlog.ts
# apply patches to EXISTING rows only (new rows skipped + counted in the output)
npx tsx --env-file .env.local scripts/derive_masters_from_pitchlog.ts --apply
# ONLY if the new-row list has been reviewed and each row is genuinely wanted:
#   ... --apply --create-new
```
## MANDATORY BEFORE `--apply` ON EITHER ENV
1. **BACK UP BOTH MASTERS FIRST** — there is no other backup and this writes the season-stat tables.
   Staging snapshots taken 2026-08-30: `_hm_prestep5_backup` (30,027 rows) · `_pm_prestep5_backup` (29,239), each a
   full copy indexed on `(source_player_id, "Season")`. **Do the equivalent on PROD before C25.**
2. **Read the diff, not the headline count.** The dry run reports "N would change", but the per-player samples show
   many IDENTICAL before/after values (`9.42/9.42`, `4.81/4.81`) — i.e. no-op rewrites inflate that number. Confirm
   WHICH FIELDS actually move and by how much before accepting it.
3. **Hitters vs pitchers is a useful control.** An earlier dry run showed **0 hitters / 4,675 pitchers** changing —
   consistent with this being Stuff+-driven (the chain just recomputed it) rather than something broader going wrong.
   If HITTERS suddenly start changing too, stop and find out why.
4. **PHASE-GATE after it runs:** Master `stuff_plus` non-null count should rise toward staging's (prod was 5,251 vs
   staging 6,011). "Column exists" ≠ "column populated" — verify the VALUE landed.

---
# ⚠️ `--direct` SILENT HANG — statement_timeout=0 removes the CEILING but also the FAILURE SIGNAL (prod, 2026-08-30)
**What happened:** the prod stage-4 run stalled on `[41/48] vs_top_hitters → pitcher_by_pitch_type` and sat there for
**39 minutes with zero log output**. Diagnosis over a second connection: **NO active query on prod** (`pg_stat_activity`
showed only my own catalog lookup) and **0 ungranted locks** — so the database was doing nothing. The client process was
alive but waiting forever. The direct connection had dropped and the client never learned about it.

**ROOT CAUSE — a gap in the `--direct` fix shipped earlier the same day.** To defeat the HTTP gateway's ~125s cut we set
`statement_timeout = 0` and a very long `query_timeout`. That correctly removes the ceiling that made `vs_top_hitters`
impossible over `exec_sql` — but it ALSO removes the only signal that something died. A dropped pooler connection
therefore presents as an INFINITE HANG instead of an error, and nothing retries because nothing failed.

**FIX TO MAKE (not yet implemented):** on the `--direct` pg client set `keepAlive: true` with a keepalive delay, a
finite `query_timeout` sized to the slowest known dimension with headroom (staging `vs_top_hitters` 254.9s, prod 151.6s
→ e.g. 20-30 min, not 0), and per-dimension progress logging so a stall is visible in the log rather than only in
`pg_stat_activity`. `statement_timeout=0` on the SERVER side is fine; it is the CLIENT-side infinite wait that is wrong.

**HOW TO DETECT A STALL (do this, don't guess):**
1. Compare the log's mtime to now — no output for >2× the slowest dimension = suspect.
2. Query `pg_stat_activity` on a SEPARATE connection: if there is **no active query**, the client is hung, not slow.
3. Check `pg_locks where not granted` — 0 means it is not a lock wait either.
4. Also check for STALE PROCESSES from earlier runs (`pgrep -f aggregate_pitch_log`) — an old staging run was still
   alive and competing for connections.

**RECOVERY (safe — stage 4 is idempotent):** kill the hung + stale processes, then re-run. Prefer re-running the FULL
set on prod rather than cherry-picking with `--only`/`--skip`: dimension rows that already exist may be STALE from the
pre-v2 process, and "rows exist" does NOT mean "rows are fresh". Steps 1-3 are unaffected — do NOT redo them.
**Nothing was corrupted by this stall.**

---
# ✅ PROVEN ON PROD — THE STUFF+ CHAIN, WHAT IT PRODUCED, AND WHY IT IS CORRECT (2026-08-30)
The full 5-step chain has now run END-TO-END on BOTH environments. This is the record of what worked, the values it
produced, and the EVIDENCE that it is right — not just that it completed.

## THE RESULT — PROD AND STAGING AGREE ON INDEPENDENT DATA
| check | STAGING | PROD | verdict |
|---|---|---|---|
| pitches classified | 2,015,321 | 2,013,005 | both = every `is_data=true` row |
| label distribution | 4S 37.8 · SI 16.0 · SL 10.3 · GY 10.2 · CH 9.1 · CB 5.6 · SW 5.2 · FC 3.7 · SPL 2.1 | **IDENTICAL** | deterministic |
| needs_review | 8.1% | 8.1% | identical |
| per-pitcher Stuff+ | mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 | **mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7** | identical |
| bucket recenter | every (type×hand) = 100.0 | every (type×hand) = 100.0 | correct by construction |
| unscored rows | 0 | 0 | full coverage |
| armHB sign check | 18/18 buckets | 18/18 buckets | convention PROVEN twice |
| Master avg stuff_plus | 98.82 | 98.86 | consistent |
**WHY THIS IS THE PROOF:** two DIFFERENT pitch populations, run through the same committed classifier + scorer,
produced the same distribution to the tenth of a percent AND the same per-pitcher percentiles. That cannot happen by
chance if anything upstream (labels, baseline, convention, recenter) were wrong. Independent replication, not a
self-check.

## THE VALUES IT USED (canonical; see the "TRACK B — EVERY VALUE THE CHAIN COMPUTES WITH" block)
Classifier v2 @ **95.2% per-pitch / 95.3% arsenal-mix** vs the anchor ground truth (full 2,000,674-pitch population).
Three shipped fixes, each MEASURED not guessed: offspeed **armHB floor = 5** (gyro p99 4.7 vs offspeed p1 5.3, a clean
empty gap) · **fastball-family merge guard** (91.69%→93.01%, 4S↔Sinker errors −41%) · **§4.5 gyro floor = −3 applied
BEFORE the backfill** (95.1%→95.2% AND fragmentation 7%→5%, strictly better on both). Two NEGATIVE results recorded so
they are never rebuilt: `rr > −1.7` and the "arsenal rule" (both lose ~1pp). Verified-optimal, do not touch:
Sweeper/Slider armHB −12 (1.0% error) · Gyro/Slider armHB −5. **RPW = 13.1**, verified stored in BOTH envs'
`model_config` (`owar_runs_per_win` / `pwar_runs_per_win`) and present 4× in prod's live `refresh_composite_war()`.

## WHY EACH SAFEGUARD MATTERED (all of these fired or would have)
- **Abort-before-write sign check** — the reason armHB is TRUSTED on both envs rather than assumed.
- **Backups before every destructive step** (`_v2_prechain_backup` 2.58M/2.58M rows, `_hm_prestep5_backup` 30,025/30,027,
  `_pm_prestep5_backup` 29,238/29,239) — made the whole chain reversible; used to disprove a suspected regression.
- **Halt-on-failure between steps** — stopped a quoting bug before it wrote anything.
- **`--direct` for stage 4** — `vs_top_hitters` needs 151–255s and the HTTP gateway cuts at ~125s, so it would have
  failed 100% on prod AND halted the 8 dimensions behind it.
- **New-row creation gated OFF** — prevented inventing half-populated Master rows. Confirmed 0 new rows on both envs.
- **Phase-gate "value landed, not just ran"** — caught that `pull_air` went 0 → 4,366 on prod (C23 subsumed by C25).

## ⚠ THE THREE TRAPS THAT PRODUCED FALSE ALARMS (check these before reporting a problem)
1. **Season keys.** 2026 = completed/descriptive · 2027 = projections. Wrong season ⇒ misleading ZERO. Caused a false
   "staging has no WAR data" alarm.
2. **Different denominators.** A count across ALL seasons vs `Season=2026 AND division='D1'` are not comparable —
   this produced a false "trackman_pitches regression" (it was 0 before AND after; C24 populates it, and it had not run).
3. **"Rows exist" ≠ "rows fresh."** A failed aggregation leaves stale rows that PASS a count check.
**RULE: compare like-for-like against the BACKUP before calling anything a regression.**
