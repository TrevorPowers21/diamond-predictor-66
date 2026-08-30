# PROD PUSH BULLETPROOF CHECKLIST — feature/war-recalibration → prod (trbvxuoliwrfowibatkm)

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
> - **PROD:** still on the OLD per-pitch CASE labels (`"4-Seam Fastball"`, ~2,176,888 labeled of ~2,575,996, no
>   `classification_version`, `needs_review` all null). **v2 has NEVER written to prod.** Prod's DATA is ready (100.00% of
>   `is_data=true` rows are v2-classifiable; venue corrections present and resolving).
> - **⛔ THE ONE REMAINING PROD BLOCKER:** prod's `pitch_log_corrected` VIEW is `select pl.*` **FROZEN at 94 of 99
>   columns** and is MISSING `classification_version`, so the scorer hard-fails there. Fix =
>   `drop view pitch_log_corrected cascade; create view …`. **DDL — requires its own explicit go**, separate from the
>   data-write "prod, now?".
> - **▶ NEXT ACTION:** rebuild that view on prod, then run the prod Stuff+ chain (reclassify → baseline → score →
>   aggregate **with `--direct`** → Masters) in ONE 4-6 h sitting, machine pinned awake.

Consolidated from 8 dimension audits (migration-ledger, schema-diff, stuffplus-chain, war-defense-composite, team-conf-park-env, precomputes-snapshots, edgefn-code-deploy, runbook-order-safety). Graded against the 8 bulletproof standards. Resume point: Phase C step C19–C22 done; PROD_PUSH_HANDOFF_RESUME_2026_08_26.md.

Prod = `trbvxuoliwrfowibatkm` (⚠ `--linked`). Staging = `slrxowawbijbjrkozqlj` = source of truth.

---

## 1. EXECUTIVE SUMMARY

### Verdict (updated 2026-08-30): **GO once the prod `pitch_log_corrected` VIEW is rebuilt.** The original **NO-GO** is
**LIFTED** — it rested on blockers that are now FALSE or DONE.

The engines are formula-sound (265/265 unit tests pass, in-DB additive parity holds), the dependency spine is correct,
and every *completed* stage (venue) is a clean regenerate-from-prod template. The Stuff+ block that produced the NO-GO
is now built, committed, and **run end-to-end on staging**: the v2 writer exists (`scripts/reclassify_prod.ts`), the
classifier is at **95.2% per-pitch / 95.3% arsenal-mix** (not ~85%), `_reclass_pf` has a producer, and the baseline
deriver / "A5 aggregator missing" claims were disproven. The destructive TRUNCATE landmine is neutralized in the
migration file and the ledger rows are flipped.

**The single remaining hard blocker is prod's stale `pitch_log_corrected` VIEW** (94 of 99 columns, missing
`classification_version`) — DDL, needs its own explicit go. See the STAGE 0 status section below.

| Severity | Original count | Status now |
|---|---|---|
| **BLOCKER** | 5 | **1 open** (stale prod view) — G2/G3/G4/G5 closed |
| **HIGH** | 11 | G6/G7/G9 closed; G15 downgraded (§5); remainder tracked below |
| **MEDIUM** | 9 | unchanged unless noted |

### TOP 5 — ORIGINAL LIST, WITH CURRENT STATUS

1. ✅ **DONE — TRUNCATE landmine neutralized.** `20260710120000_gm_allocations_per_build.sql` no longer TRUNCATEs live
   `gm_allocation`/`gm_allocation_source`; the ledger row is `[x]` APPLIED with a "DO NOT re-enable / re-run" note.
2. ✅ **DONE — the v2 reclassification WRITER exists and has run.** `scripts/reclassify_prod.ts` (keyset, direct session,
   `is distinct from`, per-batch commit) stamps `pitch_type_reclassified` + `classification_version='v2-ranges-2026-08-28'`
   + `needs_review`, and materializes `_reclass_pf`. *Evidence:* staging run classified 2,015,321 pitches.
   ⚠ The old target stamp `v1-anchor-2026-08-17` is obsolete — the chain is on the v2 stamp end-to-end.
3. ✅ **DONE — the classifier is past its gate.** `src/savant/lib/stuffPlusClassifierV2.ts` measures **95.2% per-pitch /
   95.3% arsenal-mix / needs_review 8.1%** on the full 2,000,674-pitch population. The "~85% reconstruction, constants
   UNRECOVERABLE" framing is FALSE and superseded.
4. ✅ **DONE — both Stuff+ inputs have committed producers.** `_reclass_pf` is materialized by `reclassify_prod.ts`
   (5,364 pitchers on staging); the `pitcher_stuff_plus_ncaa` per-(pitch_type×hand) baseline deriver exists, is
   armHB-derived, and ABORTS before writing if its sign check fails (it passed 18/18 on staging).
5. ✅ **DONE — ledger↔prod drift reconciled.** GM block flipped to `[x]` with row-count evidence; C19/C20/C21/C22 and
   `20260828000000_…` are logged retroactively in `PROD_MIGRATIONS_TODO.md`.

### ⛔ THE REMAINING MUST-FIX
**Rebuild prod's `pitch_log_corrected` VIEW** (`drop view … cascade; create view …`) so it exposes
`classification_version`, or the scorer hard-fails on prod. DDL — explicit go required, separate from "prod, now?".

---

## 2. ORDERED REMAINING PROD SEQUENCE

Legend: R/C = Regenerate vs Copy · I/R = Idempotent+Resumable · DS = Display-safe at pause · Trevor = Trevor-driven. Producer path = committed artifact or **MISSING**.

### PHASE 0 — LEDGER + LANDMINE RECONCILIATION (no prod writes) — ✅ **BOTH DONE**

| # | Step | Inputs | Producer | R/C | Staging-match gate | I/R | Reversible | DS | Trevor |
|---|---|---|---|---|---|---|---|---|---|
| 0a | Flip GM block (lines 63–103), Phase A body lines (124/199/216/389–393/404), Push-1 18 files to `[x]` w/ row-count evidence | prod probes | PROD_MIGRATIONS_TODO.md edits | — | prod counts match evidence (gm_recruits=56, defense=13454…) | — | n/a doc | y | n |
| 0b | Strip/guard TRUNCATE in `20260710120000_gm_allocations_per_build.sql`; annotate line 90 "DO NOT RE-RUN" | migration file | supabase/migrations/20260710120000_… | — | file no longer TRUNCATEs live tables | — | git | y | n |

### PHASE A/BUILD — STUFF+ PRODUCER BUILD — ✅ **COMPLETE (2026-08-30)**. Kept for the record; nothing here to do.

| # | Step | Status |
|---|---|---|
| A1 | Reach the classifier acceptance gate | ✅ **DONE — 95.2% per-pitch / 95.3% arsenal-mix / needs_review 8.1%** on the FULL 2,000,674-pitch population (`src/savant/lib/stuffPlusClassifierV2.ts`). The "Tier-2 reconstruction, ~85%, constants UNRECOVERABLE" framing is FALSE. |
| A2 | Committed reclassify WRITER | ✅ **DONE — `scripts/reclassify_prod.ts`** (keyset, direct session, `is distinct from`, per-batch commit). Stamps `pitch_type_reclassified` + `classification_version='v2-ranges-2026-08-28'` + `needs_review`; `--target=staging` for staging; `--go` gated on PGURI. |
| A3 | `_reclass_pf` producer | ✅ **DONE — materialized by `reclassify_prod.ts`** as a by-product of `pfbVelo()`. Staging: 5,364 pitchers, first ever run, works. |
| A4 | `pitcher_stuff_plus_ncaa` baseline producer | ✅ **EXISTS — the "missing deriver" claim was FALSE.** armHB-derived, D1-only, per (pitch_type × hand); it ABORTS before writing if the armHB sign check fails. Staging: sign check PASSED on all 18 buckets → upserted 18/18. |
| A5 | `pitcher_stuff_plus_inputs` D1 re-aggregation | ⛔ **CANCELLED — NOT NEEDED.** PSP-I is the LEGACY lane (≤2025 + JUCO only). The live chain never goes through it. Building it was work on a legacy table. |
| A6 | `bulk_update_pitch_log_stuff_plus` RPC | ✅ present (`20260620140000_helper_functions`). |
| A7 | Quarantine v1 + copy scripts | ✅ **DONE — DELETED** (`reclassify_pitch_log.ts`, `_run_reclassify_bare.ts`, `_run_reclassify_chunked.ts`, `_reclass_rollout.ts`, the three dead Runner components + their npm scripts); `breakingBallReclassification.ts` renamed `legacy_breakingBallReclassification.ts`; `conf_stats_unified_assembly.sql` = SUPERSEDED, do NOT run. |

### PHASE C — STUFF+ REGENERATE ON PROD — **pitch_log lane** (Claude runs `--apply` on "prod, now?")
⛔ This phase was originally written around the LEGACY PSP-I lane. It has been REWRITTEN onto the pitch_log lane.
Full step detail + the 🛑 markers: "THE STUFF+ CHAIN" below.

| # | Step | Inputs | Producer | R/C | Gate | I/R | Reversible | DS |
|---|---|---|---|---|---|---|---|---|
| C0 | ⛔ **PREREQ (DDL, own go): rebuild prod `pitch_log_corrected`** — `drop view … cascade; create view …` so it exposes `classification_version`. Without it the scorer hard-fails. | prod catalog | SQL (PASTE) | — | view has all 99 cols | y | recreate | y |
| C1 | Venue corrections — **DONE/verified** (311 rows, τ IVB 0.622/HB 0.662) | prod pitch_log | `compute_venue_corrections.ts` + `scripts/sql/venue_correction_persist_prod.sql` | R | fixture reproduced ✓ | y | table | y |
| C1b | **BACKUP FIRST** — create `_v2_prechain_backup` on prod (mirror of the staging backup: `pitch_type_reclassified`, `classification_version`, `needs_review`, `stuff_plus` by `uniq_pitch_id`). Reverses the whole chain with one UPDATE…FROM. | prod pitch_log | SQL | — | row count == pitch_log | y | — | y |
| C2 | **Chain step 1 — reclassify** `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`; also materializes `_reclass_pf` | C0, C1 | `scripts/reclassify_prod.ts --dry-run` → `--go` | R | distribution vs staging; needs_review ≈ 8.1% | y (keyset + is-distinct) | C1b backup | y |
| C3 | ~~Re-aggregate `pitcher_stuff_plus_inputs`~~ | — | — | — | ⛔ **CANCELLED — LEGACY LANE. Do not run.** | — | — | — |
| C4 | **Chain step 2 — re-derive `pitcher_stuff_plus_ncaa`** (per pitch_type × hand, armHB, D1-only). MANDATORY after any reclass. | C2 | baseline deriver | R | armHB sign check passes; 18 buckets | y | 71-row backup | y |
> 🛑 **MUST READ — THE C-ROW ORDER BELOW IS NOT THE RUN ORDER (audit 2026-08-30).** Three defects in these rows:
> 1. **C5 (=C24 trackman) is printed before C7b**, its own stated dependency. It must run after the aggregation.
> 2. **C9 (=C23 pull_air/in_zone_pct) is a non-step** — `scripts/derive_masters_from_pitchlog.ts:129` writes `pull_air`
>    and `:142` writes `in_zone_pct`, so C8 already did it. Treat C9 as a verification, not a producer.
> 3. **C10 duplicates C8** — both are `derive_masters_from_pitchlog`. Run it once (as chain step 5).
> 4. **C11/C12 are inverted.** `computeNcaaAverages` (C12) MUST run **before** `computeAndStoreScores` (C11):
>    `src/lib/computeAndStoreScores.ts:206-211` reads its baselines, incl. `stuff_plus`/`stuff_plus_sd` (`:249`), out of
>    the `ncaa_averages` table C12 writes; missing fields fall back to hardcoded defaults **silently** (`:212-215`).
> **True order: C6 → C7 → C7b → C8 (=derive_masters, chain step 5) → C5 (trackman) → E8 (NJCAA re-tag) → C12
> (computeNcaaAverages) → C11 (computeAndStoreScores) → E3–E6 (conference stats).**
> See `docs/PROD_PUSH_STEPS_2026_08_26.md` Phase C for the full reasoning and the 🛑 defects inside C12 itself.

| C5 | **C24** `backfill_trackman_pitches_pitching_master.ts` — run AFTER the pitch_log aggregation (C7b), off `pitch_log_pitcher_totals`, **NOT** off the legacy PSP-I aggregation | C7b | script (`.order()` fixed ✓) | R | NOT-NULL ~8,027/8,072 | y | rebuildable | y |
| C6 | NULL old `pitch_log.stuff_plus` (one-shot, **never re-run after C7 starts**) | — | runbook SQL | R | all IS NULL | n (destructive one-shot) | C1b backup | y |
| C7 | 🛑 **MUST READ before running — Chain step 3: compute `pitch_log.stuff_plus`.** The filter is NO LONGER `v1-anchor-2026-08-17` (that silently matched 0 rows = new labels + old scores); it is now `--class-version=`, defaulting to the v2 stamp. Idempotent but **does NOT resume** — every attempt costs the full runtime (~36 min staging, longer on prod). Run DETACHED with `caffeinate -dimsu -w <pid>`. | C2 stamp, C4, `_reclass_pf`, A6 RPC | `scripts/compute_pitch_log_stuff_plus.ts` | R | unscored drains to 0; every (type×hand) bucket recenters to exactly 100.0 | idempotent, NOT resumable | C6/C1b backup | y |
| — | **★ PROD GATE (pre-registered):** per-pitcher Stuff+ **mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 · 4,234 pitchers**. Outside tolerance → **ABORT**. | | | | | | | |
| C7b | 🛑 **MUST READ before running — Chain step 4: aggregate dimensions.** `aggregate_pitch_log_dimensions.ts --apply --prod --direct` (also calls `populate_hitter_run_values`). **`--direct` is REQUIRED on prod** — the gateway cuts at ~125s and the script HALTS on failure. Validate by CONTENT + FRESHNESS, never by exit code or row count. | C7 | `scripts/aggregate_pitch_log_dimensions.ts` | R | all 48 dims written by THIS run | manual (`--only=`) | re-runnable | y |
| C8 | **Backup then Chain step 5 — marry onto the Masters.** CREATE `_master_stuff_backup` + `_confstats_backup` from CURRENT prod values FIRST, then `derive_masters_from_pitchlog.ts --apply` → `Pitching Master.stuff_plus` + `Conference Stats.Stuff_plus`. ⛔ NOT via `recompute-stuff-plus.ts`. | C7b | `scripts/derive_masters_from_pitchlog.ts` (ordered pagination ✓) + conf producers | R | Master.stuff_plus == pitch-weighted mean; conf HTP matches | y | **backups (build in-step)** | boundary-only |
| C9 | **C23** pull_air / in_zone_pct fills | pitch_log | `aggregate_pitch_log_dimensions.ts` | R | matches staging | y | Master backup | y |
| C10 | **C25** derive_masters (desc_*, *_pr_plus) | C7,C9 | scripts/derive_masters_from_pitchlog.ts | R | staging tol | y | Master backup | y |
| C11 | **C26** computeAndStoreScores — ⚠ **RUNS AFTER C12, NOT BEFORE.** Reason: `computeAndStoreScores.ts:206-211` reads its means/SDs (incl. `stuff_plus`/`stuff_plus_sd`, `:249`) from `ncaa_averages`, which C12 writes; missing fields fall back to hardcoded defaults **silently** (`:212-215`). Do not "restore" the numeric order. | C10, **C12** | src/lib computeAndStoreScores | R | staging tol | y | backup | y | n |
| C12 | **C27** ncaa_averages (incl. pitcher_exit_velo/ev90/in_zone fill) — ⚠ **RUNS BEFORE C11** (see C11's reason). ✅ Both known defects fixed in code 2026-08-30: ordered pagination via a per-table PK map (**not** a blanket `.order("id")` — several of these tables have no `id`), and the Stuff+ weight moved off legacy `pitcher_stuff_plus_inputs` onto `pitch_log_pitcher_totals.stuff_plus_data_pitches` with the silent `.catch(() => [])` removed. Expect prod `stuff_plus` 101.8341 → ~102.33. | Masters | src/lib/computeNcaaAverages.ts + **extract inline fills to committed scripts/sql/*.sql** | R | matches staging | y | backup | y | n |

### PHASE B/C — TEAM/CONF/PARK/ENV (order-critical; run in this order)

| # | Step | Inputs | Producer | R/C | Staging-match gate | I/R | Reversible | DS | Trevor |
|---|---|---|---|---|---|---|---|---|---|
| E1 | Apply pitch_log `is_conference_game` + `park_code` backfill on prod (2.58M rows, keyset) — **precondition for all conf rollups** | pitch_log | committed backfill (verify derive-over-copy, not `_next_derived.ts` copy) | R | matches staging distribution | y | pitch_log | y | n |
| E2 | **Park Factors seasonal/rolling** — ⚠ producer hardwired to STAGING URL + off-repo CSVs | local CSVs, Park Factors | scripts/backfill_park_factors_seasonal.ts *(FIX: env URL/key; commit CSVs)* | R | 309 rows rg_factor_seasonal populated; DIFF sane | needs fix (delete+reinsert, not is-distinct) | _park_factors_backup (staging only — add prod) | n (destructive replace) | n |
| E3 | **Conference Stats Bucket-A** (rates+env+ +WRC_plus+pitching rates) | E1 (is_conference_game) | scripts/sql/conf_stats_bucketA_assembly.sql | R | ~30 D1 rows, env+ ~100, WRC_plus shifts off stale | y (temp _conf_agg, keyed UPDATE) | backup conf | n (rewrites stale conf) | n |
| E4 | **D1 Conference Stats Stuff_plus** — ⚠ NO committed producer (present only as paused-push copy) | prod Masters | **MISSING** (build PA/IP-weighted rollup, or document import path) | R (currently copy) | matches staging (40/40) | y | conf backup | n | n |
> 🛑 **CONFERENCE-STATS GUARDS (added 2026-08-30, they were missing from this doc entirely):**
> - **NEVER run `populate-conf-stats` (`scripts/populate-conference-stats-env-plus.ts`) on prod — it overwrites the JUCO overlay.**
> - **Run E8 (NJCAA re-tag) BEFORE E5/E6.** Prod has 10 NJCAA district rows still tagged `division='D1'` for 2026, and
>   `compute_conf_pitcher_env_plus.ts:29` + `derive_conf_opr_htp.ts:12` both filter `.eq("division","D1")` — run them
>   first and you write D1-derived env+/OPR/HTP into the JUCO rows.
> - **E3 bucketA carries a G-GATE** (blocker 3): re-run on STAGING vs `_confstats_backup_preassembly` and confirm diff
>   0.0000 before touching prod. On prod it is **PASTED** into the SQL editor, never `--linked`.

| E5 | **conf_pitcher_env_plus** (era+/fip+/hr9+) — ⚠ **RUNS AFTER E8.** Reason: `compute_conf_pitcher_env_plus.ts:29` filters `.eq("division","D1")` and prod still has 10 NJCAA rows tagged `D1`. | E3 rates, **E8** | scripts/compute_conf_pitcher_env_plus.ts | R | 30 D1 rows, SEC era+>100 hr9+<100 | y (keyed) | conf backup | n | n |
| E6 | **run_env_factor + hitter_talent_plus + OPR** — ⚠ **RUNS AFTER E8.** Reason: `derive_conf_opr_htp.ts:12` filters `.eq("division","D1")`; same 10 mis-tagged NJCAA rows. | E2 (rg_factor), E4 (Stuff_plus), E3 (WRC_plus), **E8** | scripts/derive_conf_opr_htp.ts --apply | R | run_env ~100, HTP matches staging | y | conf backup | n | n |
| E7 | Re-run pitcher transfers on stored HTP | E6 | transfer producer (ledger 416) | R | staging tol | y | player_predictions | n | n |
| E8 | **NJCAA-D1 re-tag** — ⚠ **RUNS BEFORE E5/E6, despite the letter order.** Reason: both of those producers filter `division='D1'` and would write D1-derived env+/OPR/HTP into the JUCO overlay. Verified read-only 2026-08-30: prod season 2026 = 40 `D1` rows of which **10** are `NJCAA%` (staging: 30 `D1` + 10 `NJCAA_D1`, already correct). `UPDATE "Conference Stats" SET division='NJCAA_D1' WHERE season=2026 AND "conference abbreviation" LIKE 'NJCAA%' AND division='D1'` — extract to a committed `scripts/sql/*.sql` | division rows | **inline-only** (build file) | R | prod becomes 30 D1 + 10 NJCAA_D1, matching staging | y | backup | y | n |

### PHASE D — DESCRIPTIVE WAR

| # | Step | Inputs | Producer | R/C | Staging-match gate | I/R | Reversible | DS | Trevor |
|---|---|---|---|---|---|---|---|---|---|
| D1 | Apply `team_drs_store.sql` to prod (adds team_war_snapshots.team_drs) | migration | scripts/sql/team_drs_store.sql (fold into migration) | — | column exists | — | drop col | y | n |
| D2 | Run team_drs producer against prod — ⚠ `derive_team_drs.mjs:13` hardcoded staging (`VITE_SUPABASE_URL` only), NO --prod. 🛑 **ORDER WRONG: run this LAST in Phase D (after D3/D4/D5), not before** — it reads the Masters that D4/D5 write. ✅ Low risk: it writes only `scripts/drs/output/team_drs.csv`, no DB write, and there is no `team_drs` table on prod | player_season_defense, D4/D5 | scripts/drs/derive_team_drs.mjs *(FIX: add --prod + env guard)* | R | 308 D1 rows sum ~0; re-run staging too (empty there) | y | snapshot | y | n |
| D3 | load-drs-wsb-staging --prod — **RUN THIS FIRST IN PHASE D, BEFORE D2** | defense/bsr | scripts/load-drs-wsb-staging.ts (--prod ✓) 🛑 unordered `.range()` at `:53` pages the 31,467-row `players` table — add `.order("id")` or the uuid map silently loses players | R | 13454 def / ~10432 bsr | y | tables | y | n |
| D4 | populate_descriptive_war.mjs --prod | D3 (NOT D2) | **scripts/drs/populate_descriptive_war.mjs** 🛑 path was missing `drs/`; 🛑 unordered `.range()` at `:57`,`:58` — add `.order("id")` first | R | matches staging | y | Master backup | y | n |
| D5 | populate_descriptive_war_reg.mjs --prod | D4 | **scripts/drs/populate_descriptive_war_reg.mjs** 🛑 path was missing `drs/`; 🛑 unordered `.range()` at `:33`,`:34` | R | matches staging | y | backup | y | n |

### PHASE E — TWP + PRECOMPUTES

| # | Step | Inputs | Producer | R/C | Staging-match gate | I/R | Reversible | DS | Trevor |
|---|---|---|---|---|---|---|---|---|---|
| E-TWP | **TWP detector FIRST** — dry-run on prod, pre-register prod counts (137 pre / 428 legacy strings, NOT staging's 253); snapshot `players.position/is_twp` backup first | players, Masters | scripts/run-twp-recompute.ts + src/lib/recomputeTwpStatus.ts *(FIX: add `.order()` to 3 fetch loops; add env guard; backup)* | R | prod set converges; cleared rows are alumni not skips | needs fix (unordered .range) | `_players_twp_backup` (build) | y | n |
| E-RP | Returner pitcher precomputes | E-TWP, calibration, seed_nil | committed precompute producers | R | matches staging dist | y | player_predictions | frozen until F | n |
| E-RH | Returner hitter precomputes | E-RP | committed | R | staging dist | y | pp | frozen | n |
| E-TR | Transfers, 18 teams | E-RH, HTP (E7) | committed transfer producers | R | staging dist | y | pp | frozen | n |

### PHASE F — COMPOSITE + SNAPSHOTS + MARKET (tight sequence, no coach-facing pause between)

| # | Step | Inputs | Producer | R/C | Staging-match gate | I/R | Reversible | DS | Trevor |
|---|---|---|---|---|---|---|---|---|---|
| F1 | **Fire `refresh_composite_war()` (÷13.1)** — ONLY after E o_war reprecompute. ✅ CORRECTED 2026-08-30: prod is **already ÷13.1** (probed implied divisor 13.10), not the superseded ÷10. 🛑 **GATEWAY:** the fn sets `statement_timeout=180000` internally, which exceeds the ~125s HTTP gateway ceiling — fire from the **direct pg session (PGURI) or the SQL editor**, never `.rpc()`/MCP, or it cuts at ~125s and ROLLS BACK | migration 20260810, E precomputes | supabase/migrations/20260810_composite_war_d1_rescale.sql | R | prod d_war = Σdrs_floor/13.1; total = o+d+bsr | y | pp backup | n (flip) | n |
| F2 | populate_hitter_run_values(2026) | pitch_log_hitter_totals refreshed | migration 20260826150500 fn | R | batting_rv ~6053 non-null | y | col nullable | y (nulls hide chip) | n |
| F3 | 🛑 **ORDER CORRECTED 2026-08-30 — this row was scrambled and listed 42b twice.** Canonical Phase-F order is STEPS 40→43: **backfill-snapshot-total-hitter-war → TWP markets (F4) → market resyncs → 42b recompute-snapshot-hitter-market → backfill-neutral → heal-stale.** (Was: neutral/heal FIRST, 42b in both F3 and F4, resyncs on both sides of 42b.) ✅ **FIXED 2026-08-30** — `resync-build-snapshot-markets.ts` was HARDCODED to `rd(".env.local", …)` (silently wrote STAGING on a "prod" run). It is now env-driven (`process.env` first, env-file fallback) with a double-keyed guard: prod URL without `--prod` refuses, `--prod` without a prod URL refuses. All 4 refuse/allow paths smoke-tested on both projects. ⚠ Its default scope is a **staging** build id (`7429b448…`, 0 rows on prod) — on prod pass `--all` | F1, E precomputes | scripts/backfill-snapshot-total-hitter-war.ts (ordered ✓) etc. | R | 0 snapshots with o_war-but-null-total; known player reads snapshot | y | snapshots | n (window) | n |
| F4 | TWP markets → market resyncs → 42b re-price (see the corrected single order in F3 — do not run 42b twice). ✅ **FIXED 2026-08-30** — `rebake-twp-markets.ts` + `fix-returner-twp-hitter-market.ts` (bare `process.env.SUPABASE_URL`, no guard) and `rebuild-twp-target-rows.ts` + `resync-target-snapshots.ts` (env-file, no guard) all now carry the same double-keyed guard. **Run them as `npx tsx --env-file .env.production.local scripts/<x>.ts --prod --apply`** — `--env-file` alone now REFUSES, and `--prod` against staging REFUSES | F3 | committed | R | staging dist | y | pp | n | n |
| F5 | **refresh_team_season_stats(2026) LAST** — ⛔ **BLOCKED: none of the three migrations are on prod** (probed 2026-08-30: `to_regclass('public.team_season_stats')` = NULL, no `refresh_team_season_stats` in `pg_proc`). Apply **20260819000000 (create) → 20260821010000 (war cols) → 20260819010000 (fn)** — that order is load-bearing: fn-before-ALTER `DELETE`s the season then aborts on `hitter_war_total does not exist`, leaving the table EMPTY. Full copy-pasteable plan + verification query = **`PROD_PUSH_STEPS_2026_08_26.md` Phase-A step 10a**. Needs Trevor's explicit "prod, now?" | E3–E6 conf, E2 park, team_war_snapshots | supabase/migrations + refresh_team_season_stats() | R | 308 D1 rows, 0-null WAR, AVG ~.277, wRC+ ~100, pwar matches snapshots | y (DELETE-season-then-rebuild atomic) | old rows persist until commit | y | n |
| F6 | Reseed team_war_snapshots | F5 | committed | R | staging | y | snapshots | n | n |

### PHASE G/H — DEPLOY + FLIP

| # | Step | Producer | Trevor |
|---|---|---|---|
| G1 | Apply RLS migration 20260823000000 (cross-team read leak; deps resolve on prod) | supabase/migrations/20260823000000_player_predictions_rls_team_scope.sql | n |
| G2 | Deploy edge fn **`process-precompute-jobs` ONLY** — 🛑 `recalculate-prediction` is **DEAD, do NOT deploy or run** (STEPS step 47). **AFTER F5 team_season_stats exists AND is populated** (the fn reads `team_season_stats.faced_htp`/`faced_stuff_plus` at `index.ts:1095`,`:1419`; the table does not exist on prod today) | supabase functions deploy | **y** |
| G3 | PREVIEW-VERIFY on Vercel preview (= PROD Supabase) | — | n |
| G4 | **MERGE feature/war-recalibration → main** via `gh pr create`, Trevor clicks merge | — | **y** |
| H | Gated drops (Phase H) — never drop team_war_snapshots; enforce landmine list | — | n |

---

## 3. GAPS TABLE (blocker + high, deduped)

| # | Sev | Gap | Dimensions | Fix | Std violated |
|---|---|---|---|---|---|
| G1 | ✅ **RESOLVED** | `20260710120000_gm_allocations_per_build.sql` TRUNCATEd live gm_allocation (6+6 rows) inside a stale `[ ]` block | migration-ledger | **DONE** — TRUNCATE disabled in the migration file; ledger row is `[x]` APPLIED with a "DO NOT re-enable / re-run" note | 4, 6 |
| G2 | ✅ **RESOLVED (claim was FALSE/now DONE)** | "the v2 reclassification WRITER does not exist" | stuffplus-chain | **`scripts/reclassify_prod.ts` EXISTS and has RUN** — keyset, direct session, is-distinct, per-batch commit, stamps `classification_version='v2-ranges-2026-08-28'` + `needs_review`, materializes `_reclass_pf`. Evidence: staging classified 2,015,321 pitches. v1 + copy scripts DELETED. | 1, 2, 3 |
| G3 | ✅ **RESOLVED (number was FALSE)** | "classifier reconstruction ~85%, v2 constants UNRECOVERABLE" | stuffplus-chain | **95.2% per-pitch / 95.3% arsenal-mix / needs_review 8.1%** on the FULL 2,000,674-pitch population (`src/savant/lib/stuffPlusClassifierV2.ts`, §11.13). Past the gate. | 2, 3 |
| G4 | ✅ **RESOLVED** | `_reclass_pf` had no producer | stuffplus-chain | **`reclassify_prod.ts` now materializes it** as a by-product of `pfbVelo()`. Evidence: staging materialized 5,364 pitchers and step 2 read it back. | 1, 2, 5 |
| G5 | ✅ **RESOLVED (claim was FALSE)** | "the baseline deriver is missing" | stuffplus-chain | The deriver EXISTS, is armHB-derived and D1-only, and ABORTS before writing if its armHB sign check fails. Evidence: staging **sign check PASSED on all 18 buckets → upserted 18/18**. | 1, 2, 5 |
| G6 | ⛔ **CANCELLED (claim was FALSE)** | "the A5 aggregator pitch_log → `pitcher_stuff_plus_inputs` is missing and must be built" | stuffplus-chain | **Not needed.** PSP-I is the LEGACY lane (≤2025 + JUCO only); the live chain never goes through it. Single source of truth = the pitch_log lane. | 1, 2 |
| G7 | ✅ **RESOLVED (guidance REVERSED)** | scorer hard-filtered to `v1-anchor-2026-08-17` while the writer stamps `v2-ranges-2026-08-28` → silently matched 0 rows (new labels + OLD scores) | stuffplus-chain | **Filter is now parameterized `--class-version=`, defaulting to the v2 stamp.** The old "do NOT loosen the filter" advice assumed the anchor version and is obsolete. Evidence: staging steps 1→3 connected, 2,015,321 rows scored. | 5, 6 |
| G8 | HIGH | Stuff+ rollup backups `_master_stuff_backup`/`_confstats_backup` absent on prod, no committed step | runbook-order-safety | As first action of C8 rollup: CREATE backups from CURRENT prod values before overwrite | 7 |
| G9 | ✅ **RESOLVED** | C24 `backfill_trackman` unordered `.range()` + gated on the legacy PSP-I aggregation | runbook-order-safety, precomputes | **`.order(PK)` added** (plus the same fix on `derive_masters_from_pitchlog.ts` and `compute_conf_pitcher_env_plus.ts`). Re-gated on the **pitch_log** aggregation (C7b), not PSP-I. | 5, 3, 4 |
| G10 | HIGH | Prod `player_predictions.d_war`/`bsr_war` on superseded ÷10 scale (staging + migration 20260810 = ÷13.1) | war-defense-composite | After E o_war reprecompute, fire `refresh_composite_war()` (÷13.1); verify d_war=Σdrs_floor/13.1 — never before | 3 |
| G11 | HIGH | `team_war_snapshots.team_drs` MISSING on prod + `derive_team_drs.mjs` hardcoded staging, no --prod | war-defense-composite | Add --prod+env guard to producer; apply team_drs_store.sql; run BEFORE populate_descriptive_war; re-run staging (empty) | 2, 5 |
| G12 | HIGH | `team_season_stats` table absent on prod — needed by refresh_team_season_stats AND read by `process-precompute-jobs` edge fn | schema-diff, edgefn, team-conf-park-env | Apply create→war-cols→fn migrations + populate BEFORE edge-fn deploy; add edge-fn soft-fail guard | 5 |
| G13 | HIGH | Park Factors seasonal producer `backfill_park_factors_seasonal.ts` hardwired STAGING URL + off-repo CSVs; prod rg_factor_seasonal 0/309 | team-conf-park-env | Read env URL/key (run with .env.production.local); commit source CSVs; run + DIFF | 2, 1 |
| G14 | HIGH | D1 Conference Stats `Stuff_plus` — no committed producer (present on prod only as paused-push COPY); feeds HTP/faced_stuff_plus/pitcher env | team-conf-park-env | Build PA/IP-weighted D1 rollup from prod Masters OR document committed import path | 2, 1 |
| G15 | HIGH | `model_config` admin_ui 2026 returner constants DIVERGE prod vs staging (baselines + SDs); edge fns + engine read at runtime → different projections | edgefn-code-deploy | Surface to Trevor which set is canonical (committed code+prod agree on SD 29.99699, contradicts staging-source premise); sync both DBs; re-run returner producers | 3, 8 |
| G16 | HIGH | GM block (40 files) + Phase A DDL + 4 unlogged migrations APPLIED on prod but marked `[ ]` — literal checkbox-follow re-runs applied/destructive work | migration-ledger | Bulk-flip to `[x]` with row-count evidence + "APPLIED out-of-band — verified" notes | 3 |

---

## 4. DEPLOY / MERGE CHECKLIST (before staging→main merge)

**Code parity (must be green before merge):**
- [ ] `npm test` → 265/265 (war.test.ts 24, playerCalcs 17, storedVsLive 9). ✓ currently passing.
- [ ] In-DB additive parity: `total_hitter_war = o_war + d_war + bsr_war`, 0 mismatch on prod+staging 1000-row samples (re-verify AFTER F1 ÷13.1 flip — prod currently mixes scales until then).
- [ ] Stored-vs-live: Master.stuff_plus == pitch-weighted per-pitch mean (add parity check before C8 flip).
- [ ] batting_rv SQL fn coefficients (0.691/0.235/0.3782, RUNS_PER_PA 0.3994) match wRC+ C1 spec. ✓
- [ ] Frontend selects safe: every new player_predictions column (d_war, bsr_war, total_hitter_war, twp_*_market_value, market_value) exists on prod. ✓ (run-values banner uses `select("*")` — degrades to blank, no 400).
- [ ] No `src/*` queries `team_season_stats` before it lands. ✓ (only type/comment refs).

**Edge functions (separately deployed — NOT shipped by Vercel merge; Trevor deploys):**
- [ ] **Sequence gate:** `team_season_stats` created + populated on prod BEFORE deploying `process-precompute-jobs` (index.ts:1095/1419 reads faced_htp/faced_stuff_plus — throws mid-precompute otherwise). Add soft-fail early-return guard.
- [ ] Reconcile `model_config` admin_ui 2026 across prod/staging to the chosen canonical set (G15), THEN re-run returner producers so stored player_predictions match; do NOT deploy edge fn against diverged config.
- [ ] Add automated parity test feeding fixed inputs through edge-fn `recalc`/`recalcTransfer` (recalculate-prediction/index.ts:114-238) asserting equality with `predictionEngine.ts` — edge-fn hardcoded fallbacks (baStdPower 31.297, ncaaObp 0.385) are already STALE vs committed 29.99699.
- [ ] Confirm deployed edge-fn version on prod after deploy (no in-repo version marker; consider embedding VERSION constant). Target ~v27.
- [ ] Apply RLS migration 20260823000000 on prod + staging (cross-team read leak open until applied); action nil_valuations `USING(true)` leak separately.

**Merge mechanics:**
- [ ] Preview-verify on Vercel preview (= PROD Supabase) with known players (Souza/Traeger read snapshot, not live-rebuild).
- [ ] `gh pr create` staging→main; **Trevor clicks final merge**.
- [ ] Landmine list enforced through Phase H: never re-run gm_allocation TRUNCATE, never DROP team_war_snapshots, no bare CREATE POLICY, RENAME total_war skip.

---
## 5. RESOLVED SINCE AUDIT (2026-08-28) — config divergence (G15) investigated

**G15 DOWNGRADED — not a blocker for the 2026 push.** Direct prod↔staging `model_config` diff (377 staging / 360 prod rows) shows:
- **2026 model WEIGHTS: identical** across prod+staging (62 keys, 0 diffs). ✓
- **2026 derived baselines** (35 `*_ncaa_avg`/`*_ncaa_sd`/`*_std_pr` values that differ): prod holds the freshly-applied recalibration from committed `step8_model_config_2026.sql` (e.g. prod `r_obp_std_pr=31.89504`); these are per-env DERIVED and **regenerated on prod in C27** (`computeNcaaAverages`). Staging's are older/pre-recalibration. Prod is the correct env for 2026. No sync needed.
- **2025 weights: prod stale** — 18 differ + 17 missing vs committed code (`usePitchingEquationWeights.ts`: `p_era_barrel_pct_weight 0.05`, `p_whip_whiff_pct_weight 0.45`) which MATCHES STAGING. **HISTORICAL ONLY** (season 2025; the 2026 push does not recompute 2025). Trevor 2026-08-28: mark historical, low impact — sync prod's 2025 admin_ui weights to code/staging during the deferred edge-fn pass, not a push blocker.
- **Edge-fn hardcoded fallbacks**: deferred to the "full edge function" pass (Trevor).
Config-diff tooling: `scripts/_cfg_dump.ts` (dump model_config per-env, keyed by model_type|config_key|season).

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

---
# ✅ C24 `trackman_pitches` — PITCH_LOG-FIRST for D1, LEGACY only for JUCO (fixed + applied to prod 2026-08-30)
**THE BUG:** `backfill_trackman_pitches_pitching_master.ts` summed `pitcher_stuff_plus_inputs.pitches` — the LEGACY
CSV-fed table — to set `trackman_pitches`. That column is the **TrackMan sample-size gate for the Stuff+ display
qualifier**, so it MUST come from the same lane as the Stuff+ values it gates. Same defect shape as
`computeNcaaAverages`: the VALUE moved to the pitch_log lane but a supporting COUNT was left on the legacy table.
**MEASURED ON PROD — the two sources disagree badly:** of 5,367 shared pitchers only **638 (11.9%) were IDENTICAL**;
the legacy table **UNDERCOUNTS by ~12.1 pitches/pitcher** (2,507,664 vs 2,572,528 total, ~65k pitches missing).
An undercount pushes borderline thin-sample arms the WRONG way on the leaderboard.

**THE FIX (Trevor: "keep juco and true ncaa d1 separate"):**
- **D1 → `pitch_log_pitcher_totals.total_pitches` at `dimension_key='all'`** (5,509 pitchers).
- **JUCO → `pitcher_stuff_plus_inputs` fallback.** JUCO has **NO pitch logs at all** — that is the 7,013 vs 5,509
  pitcher gap. Never mix the two lanes; never "fix" JUCO by pointing it at pitch_log.
Implementation: new `pageAll2()` helper (ordered pagination + `dimension_key` filter); pitch_log values OVERRIDE the
legacy sums where present, legacy remains only where pitch_log has nothing.

**DRY RUN (prod):** `pitch_log (D1): 5,509 pitchers · OVERRODE 5,509 with pitch_log · 1,646 remain legacy-sourced
(JUCO / no pitch log) · would change 5,618 Master rows (5,376 NULL, 242 different)`. Values demonstrably changed vs the
legacy version (e.g. `13108257 314→375`, `14110428 1016→685`, `19295025 1280→1435`) — proof the legacy source was wrong.
**APPLIED:** 5,618 rows written.
**PHASE GATE PASSED:** `D1 5,375/5,375` · `NJCAA_D1 2,695/2,695` · `D2 1/1` — 100% coverage, each from the correct lane.

---
# ✅ C27 → C26 APPLIED TO PROD 2026-08-30 (order is load-bearing — C27 FIRST)
## C27 `computeNcaaAverages` — ✅ APPLIED
`hittersUsed 5,340 · pitchersUsed 5,375 · fieldsWritten 72 · modelConfigRowsWritten 40 · ncaa_averages 2026 = 1 row`
**`p_ncaa_avg_stuff_plus` 101.8341 → 100.0141** · `p_sd_stuff_plus = 5.04577` · `p_ncaa_avg_whiff_pct = 23.3673`.
★ **The Stuff+ mean landing at 100.01 is independent CONFIRMATION that the recenter survived the whole chain**
(score → aggregate → Master rollup). The old 101.83 came from the legacy-weighted lane.
⚠ **C27 MUST PRECEDE C26.** `computeAndStoreScores.ts:206-211,:249` reads baselines from `ncaa_averages` and, for any
MISSING field, falls back to HARDCODED defaults **SILENTLY** (`:212-215`). Wrong order ⇒ quietly wrong power ratings
with no error. This ordering was inverted in the docs and is now corrected everywhere.

## C26 `computeAndStoreScores` (propagate=false) — ✅ APPLIED
`pitchers 8,071 updated, 0 errors · hitters 8,244 updated, 0 errors` · `propagate=false` honored on BOTH sides
(**`player_predictions` untouched** — it is Phase F that repopulates those).
🛑 **BUG FIXED BEFORE RUNNING:** `scripts/_run_store_no_propagate.ts` had **NO env guard** and its banner claimed
"staging" while `--env-file .env.production.local` would happily write PROD. Added the standard double-keyed guard
(URL and `--prod` must AGREE) and made the banner print the resolved env. Refuse path verified:
running against the prod env WITHOUT `--prod` now aborts with `✗ URL is PROD but --prod was not passed`.

## PATTERN WORTH NOTING (3 for 3 on the last three steps)
C24 was sourcing from the LEGACY lane · C26's runner had no guard and a banner that LIED about the target DB · C27 was
documented in the wrong ORDER. **Every one was caught by inspecting the step before running it, not after.** Do not
run a remaining step (C28/C29, D, E, F) without first checking: (1) which LANE does it read from — pitch_log or the
legacy PSP-I? (2) does it have a working double-keyed `--prod` guard? (3) is its position in the sequence right, and
does anything it depends on fall back to defaults SILENTLY?

---
# ✅ C29 NJCAA_D1 RE-TAG — APPLIED TO PROD 2026-08-30 (MUST run BEFORE C28)
**BEFORE:** prod `Conference Stats` 2026 = `D1 40 · D2 2`, of which **10 were `NJCAA%` districts wrongly tagged
`division='D1'`** (Appalachian, East, Mid-South, Midwest, Plains, South Atlantic, South Central, South, Southwest, West).
**APPLIED:** `update "Conference Stats" set division='NJCAA_D1' where season=2026 and division='D1' and
"conference abbreviation" like 'NJCAA%'` → **10 rows re-tagged**.
**AFTER (verified):** `D1 30 · NJCAA_D1 10 · D2 2` — **0 NJCAA rows remain tagged D1**. Matches staging exactly.
⚠ **ORDER IS LOAD-BEARING — C29 BEFORE C28.** Both C28 producers (`compute_conf_pitcher_env_plus`,
`derive_conf_opr_htp`) filter on `division`. Running C28 first writes D1-derived values into the JUCO overlay and
CONTAMINATES the JUCO baselines silently — the same "keep JUCO and true NCAA D1 separate" principle applied in C24.
Also: with 10 JUCO rows counted as D1, the D1 conference SDs were inflated (JUCO FIP runs 6.4–8.0).

---
# 🛑 C28 PRE-FLIGHT — FINDINGS (2026-08-30). RUN NOTHING UNTIL THESE ARE RESOLVED.
Ran the 5-question pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) against PROD. Three blockers found.

## ✅ LANE — CLEAN (both producers are on the correct lane)
`compute_conf_pitcher_env_plus.ts` reads `ncaa_averages` (refreshed by C27 ✅) + `"Pitching Master"` D1 WHIP/IP
(refreshed by C26 ✅) + `"Conference Stats"`. `derive_conf_opr_htp.ts` reads `"Park Factors".rg_factor` +
`"Conference Stats"` + `"Teams Table"`. **Neither touches the legacy `pitcher_stuff_plus_inputs`.** Also confirms the
C27-before-C26-before-C28 ordering is right: C28 consumes what both of those produced.

## 🔴 BLOCKER 1 — NEITHER PRODUCER HAS ANY `--prod` GUARD
`grep -c "trbvxuoliwrfowibatkm\|--prod"` = **0** for BOTH `compute_conf_pitcher_env_plus.ts` and
`derive_conf_opr_htp.ts`. `--env-file .env.production.local` writes PROD with **zero opt-in** — the same defect
already fixed in `_run_store_no_propagate.ts` (C26) and the four market scripts. **FIX BEFORE RUNNING:** add the
standard double-keyed guard (URL and `--prod` must AGREE) and verify the refuse path.

## 🔴 BLOCKER 2 — NO BACKUP EXISTS ON PROD, AND THE G-GATE REFERENCE DOES NOT EXIST EITHER
`_confstats_backup` = **ABSENT** on prod · `_confstats_backup_preassembly` = **ABSENT** on prod.
C28 is a DESTRUCTIVE rebuild of the conference baselines that every projection's competition-translation consumes.
**FIX: `create table _confstats_backup as select * from "Conference Stats"` on prod FIRST.**
⚠ The documented **G-GATE** (re-run bucketA on STAGING, diff vs `_confstats_backup_preassembly`, require 0.0000) has
**NEVER been executed** — it was deferred 2026-08-21 ("no staging conn"). The preassembly baseline it compares against
does not exist on prod, so the gate must be run on STAGING, where the artifact belongs.

## 🔴 BLOCKER 3 — `Park Factors.rg_factor_seasonal` IS EMPTY ON PROD (0/309) — SILENT-FALLBACK RISK
| | PROD | STAGING |
|---|---|---|
| Park Factors 2026 rows | 309 | 308 |
| `rg_factor` | **309 ✅** | 308 |
| `rg_factor_seasonal` | **0 ❌** | **308 ✅** |
`derive_conf_opr_htp.ts:10` reads **`rg_factor`**, which IS populated on prod — so C28 will run. BUT prod is missing
the entire `*_seasonal` set that staging has (its producer, E2 `backfill_park_factors_seasonal.ts`, is hardwired to
STAGING and has never run on prod — audit G13/H4). **Decide BEFORE C28 whether the conference run-environment should
use the seasonal factors** (as staging effectively does downstream) or the flat `rg_factor`. If prod and staging use
different park inputs, their conference HTP/OPR will diverge and the staging-match gate becomes meaningless.

## CURRENT PROD STATE (what C28 is meant to fill)
`Conference Stats` 2026 = **42 rows** (D1 30 · NJCAA_D1 10 · D2 2 after C29) ·
**`hitter_talent_plus` 0/42** · **`run_env_factor` 0/42** ← C28 fills these · `Stuff_plus` **42/42** (pre-existing copy;
audit G14 notes D1 `Stuff_plus` has NO committed producer — confirm what refreshes it or it stays stale while
everything around it is rebuilt).

## ORDERED EXECUTION (only after 1-3 are resolved)
1. Add `--prod` guards to both producers; verify refuse paths.
2. `create table _confstats_backup as select * from "Conference Stats"` on PROD; verify row count = 42.
3. Run the **G-GATE on STAGING** (bucketA re-run vs `_confstats_backup_preassembly`, require diff 0.0000). ABORT if not.
4. Resolve the `rg_factor` vs `rg_factor_seasonal` decision.
5. PROD: **PASTE** `conf_stats_bucketA_assembly.sql` in the SQL editor — **NEVER `--linked`** (`supabase/config.toml`
   currently names a THIRD project ref `kfkuhdmpchxyffmnowgj`; run `supabase projects list` first).
6. `compute_conf_pitcher_env_plus.ts --apply --prod` → `derive_conf_opr_htp.ts --apply --prod`.
7. **PHASE GATE:** `hitter_talent_plus` and `run_env_factor` go 0/42 → populated; D1 stays 30 and NJCAA_D1 stays 10;
   conference Stuff+/HTP compare sanely to staging.
⛔ **NEVER run `populate-conf-stats` on prod** — it overwrites the hand-calibrated JUCO overlay. Different script,
confusingly similar name, not part of C28.

---
# ✅ C28 BLOCKERS 1 & 2 CLEARED (2026-08-30) — blocker 3 was MY over-call, corrected
## ✅ FIXED — `--prod` guards added to BOTH producers
`compute_conf_pitcher_env_plus.ts` and `derive_conf_opr_htp.ts` had **NO env guard at all** (grep count 0) —
`--env-file .env.production.local` would have written PROD with zero opt-in. Added the standard double-keyed guard
(URL and `--prod` must AGREE, refuse otherwise, log the resolved env). **Refuse paths VERIFIED on both:**
`✗ URL is PROD but --prod was not passed — refusing.`
## ✅ FIXED — backups created on PROD
`_confstats_backup` = **162 rows (42 for season 2026)** · `_parkfactors_backup` = **615 rows**.
Park Factors was backed up too even though C28 only READS it — E2 rewrites that table later, and a restore point is
cheap now and expensive to lack later.
## ⚠️ CORRECTION — "park factors must be filled first" was WRONG (my over-call)
`derive_conf_opr_htp.ts:10` reads **`rg_factor`**, which is **309/309 populated on prod**. It NEVER reads
`rg_factor_seasonal`. The SAME script on staging reads the SAME column, so **both environments use identical park
inputs for C28 and there is no divergence** — the staging-match gate remains valid.
The empty `rg_factor_seasonal` (prod 0/309 vs staging 308/308) is **E2's job, later in the sequence**, and its
producer `backfill_park_factors_seasonal.ts` is still hardwired to STAGING (audit G13/H4) — fix that before E2, not
before C28. **C28 is NOT blocked on park factors.**
## STILL OPEN BEFORE C28 RUNS
- **G-GATE on STAGING** — re-run `conf_stats_bucketA_assembly.sql`, diff vs `_confstats_backup_preassembly`, require
  **0.0000**. Never executed (deferred 2026-08-21). The reference table is a STAGING artifact.
- **D1 `Conference Stats.Stuff_plus`** — 42/42 populated on prod but audit G14 says there is NO committed producer.
  Establish what refreshes it, or it stays stale while everything around it is rebuilt.
- ⛔ bucketA must be **PASTED** in the SQL editor, never `--linked` (config.toml names a THIRD ref `kfkuhdmpchxyffmnowgj`).
- ⛔ **NEVER** run `populate-conf-stats` on prod (overwrites the hand-calibrated JUCO overlay).

---
# 🔴→✅ CONFERENCE STUFF+ WAS ON THE LEGACY LANE — FIXED 2026-08-30 (critical for Track B)
## THE FINDING (audit G14 said "no committed producer" — that was WRONG)
`src/savant/lib/conferenceStuffPlusV2.ts` **IS** the producer of `"Conference Stats".Stuff_plus`. But it read
per-pitcher scored rows from **`pitcher_stuff_plus_inputs`** — the **LEGACY CSV lane**. The v2 chain writes Stuff+ to
`pitch_log.stuff_plus` and rolls it up to `"Pitching Master".stuff_plus`; it **NEVER writes PSP-I**, so PSP-I holds
**PRE-v2 scores**. Conference Stuff+ would therefore have been built from stale numbers.
**WHY THIS ONE MATTERS MOST:** Conference Stuff+ IS the competition-translation lever — a player projected INTO a
conference is scored against that conference's Stuff+/HTP. A stale value silently biases **every projection**.
This is the THIRD instance of the same shape (C24 `trackman_pitches`, `computeNcaaAverages` weighting, now this):
**the VALUE moved to the pitch_log lane but a supporting INPUT was left on legacy.**

## THE FIX
Read the rolled-up per-pitcher value and its pitch count straight from `"Pitching Master"`:
`Σ("Pitching Master".stuff_plus × trackman_pitches) / Σ(trackman_pitches)` — definition unchanged (pitch-weighted,
full season). Both inputs are **pitch_log-sourced for D1** (C25 writes `stuff_plus`, C24 writes `trackman_pitches`)
and correctly **fall back to the legacy lane for JUCO**, so ONE formula stays right for BOTH divisions without ever
mixing lanes. Filters `stuff_plus IS NOT NULL AND trackman_pitches > 0`.

## VERIFIED ON STAGING (values are sane and the D1/JUCO relationship is correct)
`D1 30 conferences avg 99.16 (range 92.9–107.3)` · `NJCAA_D1 10 avg 96.00 (92.0–100.7)` · `D2 2 avg 93.00`.
D1 centring near 100 with JUCO clearly below it is the expected "conference pitching depth" signal.

## ⚠ GAP FOUND WHILE TESTING — `calculateConferenceStuffPlusV2` IGNORES `dryRun`
It was called with `{ dryRun: true }` and **wrote anyway** ("5. write to Conference Stats"). The option is not
implemented. Benign here (staging needed the refresh and the values are correct) but **there is no way to preview this
producer**. Before running it on PROD: either add real dry-run support, or rely on `_confstats_backup` (already created
on prod, 162 rows / 42 for 2026) as the rollback.
## TRACK B REQUIREMENT
Track B's conference-stats stage must compute Conference Stuff+ from the **pitch_log lane via Pitching Master**, never
from `pitcher_stuff_plus_inputs`, and must keep the D1 / JUCO fallback split intact.

---
# ✅ G-GATE EXECUTED AND PASSED (staging, 2026-08-30) — deferred since 2026-08-21, now done
Method: snapshot `"Conference Stats"` 2026 → `_ggate_before`, re-run `scripts/sql/conf_stats_bucketA_assembly.sql`,
then diff EVERY numeric column joined on `(conference_id, season)`.
**RESULT: 77 numeric columns compared · 0 changed · worst absolute diff 0.000000.**
✅ **The bucketA assembly is IDEMPOTENT** — re-running it does not drift values. Safe to run on prod.
(Reference table `_confstats_backup_preassembly` exists on staging: 162 rows, 42 for 2026.)

# 📊 PROD "Conference Stats" 2026 (D1, 30 rows) — WHAT IS FILLED vs WHAT C28 FILLS
**FILLED (66 cols):** AVG · OBP · ISO · ERA · FIP · WHIP · K9 · BB9 · HR9 · `Overall_Power_Rating` · `WRC_plus` ·
`ba_plus` · `ba_power_rating` · `Stuff_plus` · … (all inputs C28 needs are present)
**EMPTY (13 cols) — exactly C28's outputs, so there is NO partial state:**
`era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus` ← `compute_conf_pitcher_env_plus`
`hitter_talent_plus` `run_env_factor` ← `derive_conf_opr_htp`
`OPS` `SLG` `slg_plus` `pitcher_ev_score` `pitcher_iz_score` ← bucketA assembly

## 🛑 STALE-VALUE CATCH — `Stuff_plus` IS 30/30 FILLED ON PROD **BUT IT IS PRE-v2**
The Conference Stuff+ lane fix was applied and verified on **STAGING only**. Prod's `"Conference Stats".Stuff_plus`
still holds the value computed BEFORE the v2 chain — a fully-populated column that PASSES any count check while being
stale. Third occurrence today of "looks populated, isn't fresh".
→ **C28 ON PROD NEEDS ONE MORE STEP THAN THE DOCS LIST:** run the FIXED `conferenceStuffPlusV2`
(`Σ(Pitching Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)`) to refresh `Stuff_plus` from the pitch_log
lane, ALONGSIDE the two producers that fill the 13 empty columns. Otherwise the competition-translation lever stays
stale while everything around it is rebuilt.
→ Staging reference after the fix: D1 30 conf avg **99.16** (92.9–107.3) · NJCAA_D1 10 avg **96.00** · D2 2 avg 93.00.

---
# 🧩 C28 BUCKET MAP — WHO WRITES WHAT, AND WHY `Stuff_plus` FELL THROUGH THE GAP (2026-08-30)
`scripts/sql/conf_stats_bucketA_assembly.sql:12` states the split verbatim:
`SCOPE: writes ONLY Bucket A (rates/env+/WRC_plus). Bucket B (OPR/Stuff_plus/run_env_factor/…)`

| bucket | producer | columns it writes |
|---|---|---|
| **A** | `conf_stats_bucketA_assembly.sql` (PASTE in SQL editor) | `OBP` `ISO` `SLG` `OPS` `obp_plus` `slg_plus` `iso_plus` `WHIP` `FIP` `ERA` + rates + `WRC_plus` |
| **B (pitching env+)** | `compute_conf_pitcher_env_plus.ts` | `era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus` |
| **B (OPR/HTP)** | `derive_conf_opr_htp.ts` | `run_env_factor` `offensive_power_rating` `hitter_talent_plus` |
| **B (Stuff+)** | ⚠ **`conferenceStuffPlusV2.ts` — a SEPARATE producer, NOT part of the documented C28 steps** | `Stuff_plus` |

## ★ THE GAP, STATED PLAINLY
`Stuff_plus` belongs to **Bucket B** but is written by **NEITHER** bucketA **NOR** `derive_conf_opr_htp`. It has its own
producer that the C28 runbook never listed. So:
**`Stuff_plus` is the ONLY Conference Stats metric that is BOTH (a) stale on prod (pre-v2) AND (b) not refreshed by any
of the three documented C28 steps.** Every other filled column is either rewritten by Bucket A / Bucket B, or is a
source input already refreshed by C24 / C26 / C27.
Because it is 30/30 populated it PASSES every count check while being stale — and it is the competition-translation
lever, so a stale value silently biases EVERY projection of a player INTO a conference.

## ✅ C28 ON PROD — THE CORRECTED FOUR-STEP ORDER (the runbook had three)
0. **Backups already created on prod:** `_confstats_backup` (162 rows / 42 for 2026) · `_parkfactors_backup` (615).
1. **PASTE** `conf_stats_bucketA_assembly.sql` in the SQL editor. ⛔ **NEVER `--linked`** — `supabase/config.toml`
   names a THIRD project ref (`kfkuhdmpchxyffmnowgj`). Run `supabase projects list` first.
   ✅ **G-GATE PASSED 2026-08-30** — re-run on staging diffed 77 numeric columns: **0 changed, worst 0.000000**, so the
   assembly is IDEMPOTENT and cannot drift prod's values.
2. `npx tsx --env-file=.env.production.local scripts/compute_conf_pitcher_env_plus.ts --apply --prod`
   ✅ `--prod` guard ADDED 2026-08-30 (it had none); refuse path verified.
3. `npx tsx --env-file=.env.production.local scripts/derive_conf_opr_htp.ts --apply --prod`
   ✅ `--prod` guard ADDED 2026-08-30 (it had none); refuse path verified.
   Reads `"Park Factors".rg_factor` — **309/309 populated on prod** (it does NOT read `rg_factor_seasonal`, which is
   empty on prod; that is E2's job and NOT a C28 blocker).
4. **★ NEW STEP — refresh `Stuff_plus`:** run the FIXED `conferenceStuffPlusV2`
   (`Σ("Pitching Master".stuff_plus × trackman_pitches) / Σ(trackman_pitches)`).
   ⚠ **It IGNORES `dryRun` and writes regardless — no preview exists.** Rollback = `_confstats_backup`.
⛔ **NEVER run `populate-conf-stats` on prod** — different script, confusingly similar name, overwrites the
hand-calibrated JUCO overlay.

## PHASE GATE AFTER C28 (verify VALUES, not just that it ran)
- The 13 previously-EMPTY columns become populated: `era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus`
  `hitter_talent_plus` `run_env_factor` `OPS` `SLG` `slg_plus` `pitcher_ev_score` `pitcher_iz_score`.
- `Stuff_plus` CHANGES from its stale pre-v2 value (compare BEFORE/AFTER — do not just count non-nulls).
- Division split holds: **D1 = 30 · NJCAA_D1 = 10 · D2 = 2**.
- Staging reference shape after the same fix: D1 avg **99.16** (92.9–107.3) · NJCAA_D1 avg **96.00** · D2 avg 93.00.

---
# ✅ C28 APPLIED TO PROD 2026-08-30 — all four steps, phase gate PASSED
Ran via the DIRECT pg session with the prod ref asserted (equivalent to pasting; **never `--linked`**).
BEFORE snapshot kept as `_c28_before` (alongside `_confstats_backup`).
1. **bucketA assembly** → `OPS` `SLG` `slg_plus` 0/30 → **29/30**
2. **`compute_conf_pitcher_env_plus --apply --prod`** → **30 conf rows**, 0 skipped.
   SANITY (correct direction): SEC ERA 5.82 → era+ **105** · Ivy 5.20 → **117** · HR9 SEC 1.62 → hr9+ **68**
   (SEC allows more HR ⇒ env+ <100) · Ivy 0.70 → **156**.
3. **`derive_conf_opr_htp --apply --prod`** → **30 rows**. e.g. Big 12 HTP 120.4 → **121** · MWC 98.8 → 97.8.
4. **★ `conferenceStuffPlusV2` (FIXED lane)** → **31 rows written**.

## ★ THE `Stuff_plus` CATCH WAS REAL — this is why step 4 exists
**D1 `Stuff_plus`: 101.17 → 99.15, with 30/30 rows CHANGED.** Prod now matches staging's **99.16**.
Following the runbook's three steps would have left it at the stale pre-v2 **101.17** while everything around it was
rebuilt — and a count check would have shown **30/30 populated and PASSED**. Because Conference Stuff+ is the
competition-translation lever, that stale value would have silently biased EVERY projection of a player into a conference.
Division relationship holds and matches staging: **D1 99.15 · NJCAA_D1 96.00 · D2 93.00**.

## PHASE GATE RESULT (D1, all were 0/30 before)
`era_plus 30` `fip_plus 30` `k9_plus 30` `whip_plus 30` `hitter_talent_plus 30` `run_env_factor 30` ✅
`OPS 29` `SLG 29` ⚠ · `pitcher_ev_score 0` ⚠

## ⚠ TWO LOOSE ENDS — NOT resolved, do not assume benign
1. **`OPS`/`SLG`/`slg_plus` = 29/30**, one conference short. Probable cause: a conference with no qualifying hitters,
   but **UNVERIFIED**. Identify the missing conference before trusting conference hitting rates for it.
2. **`pitcher_ev_score` = 0/30 and `pitcher_iz_score` likewise** — listed as bucketA outputs but bucketA did NOT fill
   them. Either they have a different producer or a precondition is unmet. **Find the producer before Phase F**, since
   these feed pitcher-side conference context.

---
# 🔍 C28 LOOSE ENDS — INVESTIGATED AND RESOLVED (2026-08-30)
Method: compare PROD against STAGING (which had already run C28) rather than reasoning from prod alone. This settled
all three in minutes — **always diff the two environments before theorising.**

## 1. ✅ `OPS`/`SLG`/`slg_plus` = 29/30 — EXPECTED, NOT A DEFECT. The missing conference is **Independent**.
```
PROD    — D1 conferences with NULL OPS: Independent
STAGING — D1 conferences with NULL OPS: Independent   (identical)
```
Independents have no conference-mates, so the conference hitting aggregate has nothing to pool. **29/30 is CORRECT on
both environments** — do NOT "fix" this. (Consistent with the existing rule that Independents are handled by
faced-competition Stuff+/HTP rather than conference pooling.)

## 2. ✅ `pitcher_ev_score` / `pitcher_iz_score` = 0/30 — NOT deprecated, NOT a prod gap. **Their producer has never run.**
Empty on **BOTH** prod and staging, so it is not something C28 broke. ⚠ I nearly recorded them as dead columns
superseded by `pitcher_ev90_score` / `pitcher_iz_whiff_score` — **that was WRONG.**
**They have a real producer: `src/savant/lib/conferenceScoutingAverages.ts`**, which WRITES them at `:453` / `:455`
(`pitcher_ev_score: round1(psEV)`, `pitcher_iz_score: round1(psIZ)`) and reads them back at `:520-522`.
→ **ACTION: run `conferenceScoutingAverages` for 2026 to fill them.** It has never been run for this season on either
environment. Pitcher EV mirrors hitter EV and is expected to be populated.

## 3. ★ PROD IS NOW AHEAD OF STAGING on the raw conference pitcher metrics
| column | PROD | STAGING |
|---|---|---|
| `pitcher_ev90` | **30/30** | 0/30 |
| `pitcher_exit_velo` | **30/30** | 0/30 |
| `pitcher_in_zone_pct` | **30/30** | 0/30 |
| `pitcher_iz_whiff_pct` | **30/30** | 0/30 |
| `pitcher_ev90_score` · `pitcher_iz_whiff_score` | 30/30 | 30/30 |
The C28 run filled these on prod; staging never had them. **CONSEQUENCE: staging is no longer a valid reference for
these columns** — do not treat a prod/staging mismatch here as a prod defect. Staging needs C24/C26/C27/C29 + this C28
pass applied to catch up (it only ever received the Stuff+ chain and the Conference Stuff+ lane fix).

## 🧠 LESSON
Two of the three "problems" were not problems, and the third was nearly mis-diagnosed in the opposite direction
(calling a live-but-unrun column deprecated). **Diff the environments FIRST, then grep for a producer, and only then
conclude.** A column being empty means one of: (a) expected/no data to pool, (b) its producer has not run, or
(c) genuinely dead — and those are indistinguishable from the fill count alone.

---
# ✅ C28b — CONFERENCE SCOUTING AVERAGES RUN (prod, 2026-08-30). `pitcher_ev_score` 0/30 → 30/30
**WHY:** `pitcher_ev_score` / `pitcher_iz_score` were 0/30 on **BOTH** prod and staging. They are **NOT deprecated** —
`src/savant/lib/conferenceScoutingAverages.ts` writes them at `:453` / `:455` and reads them at `:520-522`. The
producer had simply **never been run for 2026 on either environment**.
**NEW RUNNER:** `scripts/run_conference_scouting_averages.ts` — the library function had no env guard and no runner
existed, so the runner carries the standard double-keyed guard (URL and `--prod` must AGREE). Refuse path verified:
`✗ URL is PROD but --prod was not passed — refusing.`
**PRE-FLIGHT (all five, before running):** LANE ✅ reads `ncaa_averages` (C27) + the Masters (C25/C26), no legacy PSP-I ·
PAGINATION ✅ `fetchAll` already orders by `source_player_id` · ORDER ✅ needs `ncaa_averages`, C27 done · SILENT
FALLBACK ✅ **none** — it errors explicitly ("run Compute NCAA Averages first") if baselines are missing ·
BACKUP ✅ `_confstats_backup` (162 rows) + `_c28_before`.
**RESULT ON PROD (verified in the DB, not from the log):** `pitcher_ev_score` **30/30, avg 53.22** ·
`pitcher_iz_score` **30/30**.
⚠ **The console printed `conferences computed: 0` while successfully writing 30 rows** — my runner reads the wrong
field off the report object. Harmless, but a reminder of the standing rule: **verify in the database, never from the
log line.** (Fix the field name if this runner is reused.)
⬜ **STAGING still has these at 0/30** — run the same command there (without `--prod`) when catching staging up.

---
# 🗺️ PHASE D (dWAR / bsrWAR) — INVESTIGATION + PLAN (2026-08-30). Read before running anything.
Phase D is **entirely a season-2026 (descriptive) operation** and is **INDEPENDENT of Phases C, E and F** — D31/D32
take their constants from LOCAL JSON fixtures (`RPW 13.1`, E2T, replacement RA9, wOBA weights), NOT from `model_config`
/ `ncaa_averages` / `Conference Stats`. Nothing Phase C produced is an input here. It can run now.

## 🛑 THE ONE HARD BLOCKER — `team_war_snapshots.team_drs` DOES NOT EXIST ON PROD
`populate_descriptive_war.mjs:76` reads `team_war_snapshots(source_team_id, team_drs)`; the error branch at `:65` is
`process.exit(1)`. **D31 dies before writing a single row** (no partial-write risk, but it will not run).
**THE FIX ALREADY EXISTS AND IS NOT A MIGRATION:** `scripts/sql/team_drs_store.sql` — it lives in `scripts/sql/`, NOT in
`supabase/migrations/`, which is exactly why staging got it (2026-08-09) and prod never did. `PROD_MIGRATIONS_TODO.md:234`
records it as "APPLIED STAGING … PROD pending."
**VERIFIED it lands cleanly on prod:** 308 hardcoded `(source_team_id, drs)` values, **sum = −0.007** (correctly centered) ·
**308/308 match prod `team_war_snapshots` season 2026** (prod has 466 rows; the 158 non-D1 correctly stay NULL) ·
**5,375/5,375** prod D1 pitchers with IP>0 resolve `TeamID → Teams Table.source_id → team_drs` (full coverage, zero
fallthrough to `drs_behind = 0`). `:2` is `add column if not exists` → idempotent.
⚠ **DO NOT source these values from staging** — staging's `team_war_snapshots.team_drs` is now **0/308 non-null** (the
table was rebuilt after the 2026-08-09 populate). `scripts/sql/team_drs_store.sql` is the ONLY surviving source of truth.

## ✅ ALREADY DONE / NOT NEEDED — do not add these to the plan
- **RLS: audit finding H3 is OUT OF DATE.** `relrowsecurity = true` with **0 policies** on `player_season_defense` AND
  `player_season_baserunning`, on **BOTH** envs = **deny-all** to anon/authenticated. The broad table grants are inert
  because RLS gates first. `service_role` bypasses RLS so the D30 loader is unaffected. **No RLS work to do.**
- **D30's data is already on prod** at the current engine version: `player_season_defense` **13,454 rows** (9,268 players,
  `drs-engine-0.11.0`, zero NULLs in drs_floor/total/ceiling; 4,343 are position='P', excluded from d_war by design) ·
  `player_season_baserunning` **10,432 rows** (`drs-engine-0.6.0`). Prod has 24 MORE baserunning rows than staging
  (prod `players` 31,467 vs staging 15,561 resolves better). **D30 is a no-op re-run — dry-run to confirm, then skip.**
- **All 23 Master target columns EXIST on prod** (`woba, wraa, desc_owar, d_war, bsr_war, total_desc_war` + `_reg`
  variants; `desc_ra9, desc_fip_ra9, drs_behind, desc_pwar, total_desc_war` + `_reg`). **No Master DDL needed.** All are
  currently 0-populated on prod — that is what Phase D fills.
- All input CSVs/JSON exist on this machine. ⚠ **They are NOT in git** (`scripts/drs/.gitignore` ignores `output/`;
  `docs/drs-reference/.gitignore` ignores `*.csv`) — **Phase D can only be run from this machine.**
- Run from the **repo root** (`node scripts/drs/populate_descriptive_war.mjs`), never `cd scripts/drs` — the scripts mix
  `output/…`, `scripts/drs/output/…` and `docs/drs-reference/…` relative paths.

## ⚠ FIX BEFORE RUNNING
1. **D31 sort key is under-specified.** `populate_descriptive_war.mjs:62` maps `player_season_defense → "player_id"`, but
   `player_id` is NOT unique there (**9,268 distinct over 13,454 rows**) so ties can shuffle across the 14 page
   boundaries. Real PK is `(player_id, season, position)`. Mirror `src/lib/computeNcaaAverages.ts:184-185` exactly.
   (The 2026-08-30 fix got the hard-error half right — neither table has an `id` column — but left the tie half open.)
   Impact is second-order: a handful of wrong `d_war` values, not a hard failure.
2. **🛑 KILL `scripts/load-drs-wsb-prod.ts`** — a STALE DUPLICATE of the loader that never received commit `af89611`'s
   ordered-pagination fix (`:38` is still bare `.range()`), has **no `--dry-run`**, and is named for prod. It sits one
   tab-completion from the correct script. Delete it or reduce it to a shim.

## ▶️ ORDERED SEQUENCE
```
D29b (NEW)  PASTE scripts/sql/team_drs_store.sql in the Supabase SQL editor. ⛔ never `--linked`
            (config.toml still names a third ref kfkuhdmpchxyffmnowgj). Idempotent.
            GATE: select count(*) filter (where team_drs is not null), round(sum(team_drs)::numeric,2)
                  from team_war_snapshots where season=2026;   EXPECT 308 and ~-0.01
            Then tick PROD_MIGRATIONS_TODO.md:234.
D30         npx tsx scripts/load-drs-wsb-staging.ts --prod --dry-run
            EXPECT "13454 would upsert, 11 unresolved" / "10432 would upsert, 30 unresolved" → then SKIP the apply.
            ⛔ NEVER scripts/load-drs-wsb-prod.ts
D31         node scripts/drs/populate_descriptive_war.mjs --prod          (dry-run first, from repo root)
            GATE vs staging (2026 D1): desc_owar mean 0.3456 · d_war mean 0.0103 · bsr_war mean 0.0000 ·
            total_desc_war mean 0.3559 · HITTERS ~5,340 · PITCHERS ~5,375.
            ★ Confirm `drs_behind` is NOT all-zero in the SPOT block — all-zero means D29b did not take.
            then: node scripts/drs/populate_descriptive_war.mjs --prod --commit
            ⚠ ~10,715 individual PostgREST UPDATEs at pool 24 (:151-163), several minutes, NO transaction.
              A mid-run failure leaves a partial write; re-running is safe (pure recompute keyed by source_player_id+Season).
D32         node scripts/drs/populate_descriptive_war_reg.mjs --prod      (dry-run, then --commit)
            ★★ HARD-ORDER: MUST follow D31's commit. It reads `Pitching Master.drs_behind` (:79) and `num(NULL) → 0`,
               so running it early produces WRONG desc_ra9_reg / desc_pwar_reg with **NO error**. Verify
               drs_behind = 5,375/5,375 non-null on prod FIRST.
            GATE: staging has 5,322/5,343 hitter _reg and 5,372/5,377 pitcher _reg — the ~20 shortfall is players absent
            from hitter_accrued.csv, expected.
D33         ⛔ SKIP. CSV-only output (`:36` writes team_drs.csv), no DB write anywhere, and `:13` hardcodes
            `./.env.local`. D29b already supplies the values it would derive. If ever run it must be LAST (it reads the
            Masters that D31/D32 write) — the checklist ordering that puts it before D30/D31 is WRONG.
D34         VERIFY on prod, 2026, division='D1':
            d_war / bsr_war / desc_owar / total_desc_war = 5,340 non-null each ·
            desc_pwar / desc_ra9 / drs_behind = 5,375 each · avg(d_war) ≈ 0.010 · avg(bsr_war) ≈ 0.000 ·
            avg(desc_owar) ≈ 0.346 · max|total_desc_war − (desc_owar+d_war+bsr_war)| ≤ 0.002 ·
            drs_behind range ≈ −5.24 … 6.48 with ~11 exact zeros.
```

## 📄 DOC CORRECTIONS FROM THIS INVESTIGATION
- **F39 is described wrongly in the runbook.** `refresh_composite_war()` on prod (read via `pg_get_functiondef`) updates
  **`player_predictions`** (`d_war`, `bsr_war`, `total_hitter_war`) — **NOT the Masters**. So it does NOT overlap D31's
  Master writes, and the accidental 2026-08-30 invocation left `Hitter Master.d_war` at 0/5,340 (confirmed).
- **`regular_season_pa` / `regular_season_ip` are 0-populated on prod** (staging 5,339/5,343 and 5,374/5,377). NOT a
  Phase D blocker — D32 selects but never reads them (its reg counts come from CSVs). Producer is
  `scripts/lock-season-cli.ts` / `src/lib/lockRegularSeason.ts` ("Lock Regular Season 2026"). Will bite a later phase.
- **`team_season_stats` is 0 rows on prod** (staging 308 for 2026). Filled in Phase F by `refresh_team_season_stats(2026)`,
  whose step 6 carries `team_drs` across from `team_war_snapshots` — so D29b also unblocks that later carry.

---
# 🔁 DOC-vs-REALITY SWEEP (2026-08-30, late) — re-probed prod directly. FOUR 🛑 BLOCKERS ARE STALE, ONE IS NEW.
Method: direct pg session against the prod ref + `grep -c` on each named script. **Verified, not asserted.**
Every 🛑 in these docs was re-checked against the live database and the current file, because several were written
BEFORE the fixes that resolved them and a stale blocker is as expensive as a missed one.

## ✅ STALE — these 🛑 blockers are RESOLVED. Do not re-do this work.
| doc claim | reality on 2026-08-30 |
|---|---|
| **F44 / step 10a: "`team_season_stats` does not exist, 3 migrations unapplied, CANNOT RUN TODAY"** | **table EXISTS + `refresh_team_season_stats` fn EXISTS** (`pg_proc` = 1). The 3 migrations were applied in DEPENDENCY order as Phase-C prereqs. Table is **0 rows** — that is F44's job, not a blocker. **F44 is RUNNABLE.** |
| **G46: "blocked — `team_season_stats` missing"** | Same. The gate is now only "F44 has RUN and populated it", not "the table must be created". |
| **F42: "`resync-build-snapshot-markets.ts:17` is hardcoded to `.env.local`, will silently write STAGING"** | **FIXED.** The file header now documents the old defect and it is env-driven (`process.env` first, env-file fallback) with a **double-keyed guard**. **F42's first half is runnable.** |
| **F41: "`rebake-twp-markets.ts` / `fix-returner-twp-hitter-market.ts` have no `--prod` flag and no ref assert"** | **FIXED.** Both now `grep -c trbvxuoliwrfowibatkm` = 1 with `--prod` handling. Still invoke them directly (not npm scripts) — that half of the note stands. |
| **D30: "`load-drs-wsb-staging.ts:53` unordered `.range()` over `players`"** | **FIXED** — `fetchAll` now takes an `orderCol` (default `id`) and orders ascending. The comment documenting why is in the file. |

## 🔴 NEW BLOCKER — `scripts/run-twp-recompute.ts` (step E35) HAS NO ENV GUARD AT ALL
`grep -c 'trbvxuoliwrfowibatkm'` = **0** and `grep -c -- '--prod'` = **0**. E35 is the **FIRST** step of Phase E and it
**sets `is_twp` + primary `position` on `players`** — a write to the identity table that every downstream precompute
keys off. `--env-file .env.production.local` writes PROD with **zero opt-in**, and passing `--prod` does nothing.
This is the SAME defect already fixed in `_run_store_no_propagate.ts` (C26), both C28 producers, and the four market
scripts — **the fifth instance of it.** ⚠ Prod `is_twp` = **137/31,467** vs staging's 253, so this step genuinely has
work to do on prod and WILL be run. **Add the standard double-keyed guard and verify the refuse path before Phase E.**

## 🔴 STILL OPEN — `backfill_park_factors_seasonal.ts` (E2) is unguarded AND staging-hardwired
`grep -c` = **0 / 0**. Prod `"Park Factors"` 2026 = **309 rows · `rg_factor` 309/309 ✅ · `rg_factor_seasonal` 0/309 ❌**
(staging 308/308). Confirms audit G13/H4: the producer has never run on prod. **Not a C28 blocker** (C28 reads
`rg_factor`, which is full) — but it must be guarded + re-pointed before E2, and F44/G46 consume park-derived values.

## 📊 PROD STATE PROBED DIRECTLY (2026-08-30) — the numbers Phase D/E/F start from
```
team_season_stats           EXISTS, 0 rows        refresh_team_season_stats()  EXISTS
team_war_snapshots.team_drs COLUMN ABSENT  ← the Phase D hard blocker (D29b)
"Park Factors" 2026         309 · rg_factor 309 ✅ · rg_factor_seasonal 0 ❌
"Hitter Master"   2026 D1   5,340 · d_war 0 · desc_owar 0 · total_desc_war 0   ← Phase D fills
"Pitching Master" 2026 D1   5,375 · drs_behind 0 · desc_pwar 0                 ← Phase D fills
players                     31,467 · is_twp 137   (staging 253)                ← E35 fills
customer_teams active       14  ✅ (NOT 18 — that is a staging number)
player_predictions 2027     200,754 rows (pre-existing; Phase E regenerates)
```
★ **`Hitter Master.d_war` = 0/5,340 is independent CONFIRMATION that the accidental `refresh_composite_war()` did NOT
touch the Masters** — it writes `player_predictions`. The runbook's F39 description is wrong; see the Phase D block.

## 🧠 LESSON — RE-PROBE BEFORE TRUSTING A 🛑 YOU WROTE YESTERDAY
Four blockers were already fixed and one brand-new one was sitting unflagged in the very next phase. A 🛑 records the
state at the moment it was written; it is **not** a live indicator. **Re-run the check, then act.** The 5-question
pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) has now found a real defect before **every** step it has
been applied to — C24 (legacy lane) · C26 (no guard, lying banner) · C27 (wrong order) · C28 (no guards on either
producer, no backup) · C28b (no runner at all) · Conference Stuff+ (legacy lane) · D31 (sort key) · **E35 (no guard)**.

---
# 📌 TWO DECISIONS LOCKED (Trevor, 2026-08-30)
## 1. STAGING CATCH-UP HAPPENS **AFTER** THE PROD PUSH — and it will be run **THROUGH TRACK B**
Staging is missing C24 / C26 / C27 / C28 / C28b / C29. It is **deliberately** not being caught up first.
**Consequence to hold onto:** for the columns prod has and staging does not (`pitcher_ev90`, `pitcher_exit_velo`,
`pitcher_in_zone_pct`, `pitcher_iz_whiff_pct`, and the conference `*_plus` set), **staging is NOT a valid reference**.
Do not treat a prod↔staging mismatch as a prod defect without first checking which environment is behind.
★ **The catch-up is not a manual re-run of six scripts — it is the FIRST REAL EXERCISE OF TRACK B.**
## 2. `rg_factor_seasonal` **MUST** BE FILLED (not deferred) → E2 is a required step. See the E2 block.
## ★ WHY TRACK B IS THE POINT — the target operating model
**Track B is ONE edge function that runs ONCE PER DAY and performs the entire upload + store chain.** Everything in
this push that is a hand-run script becomes a stage inside that single daily run. That is why **every finding, lane,
order dependency, silent fallback and gate in these documents gets logged into
`docs/PIPELINE_pitch_log_to_projections.md` in full detail** — that document is the SPECIFICATION Track B is built
from, and the prod push is the dress rehearsal for it.
**Every defect found in this push is a requirement for Track B**, because a daily automated run has no human to
notice that a column is "populated but stale":
- the value/input LANE SPLIT (pitch_log vs legacy PSP-I) — 3 occurrences, all invisible to count checks
- ORDER dependencies where a stale input yields wrong numbers with **NO error**: C27→C26 · C29→C28 · D31→D32 ·
  E35→precomputes · **E2→`derive_conf_opr_htp`** (found 2026-08-30)
- SILENT FALLBACKS: hardcoded defaults for missing baselines, `num(NULL) → 0`, a version filter that matches 0 rows
  and exits 0
- destructive delete+reinsert stages that need a backup and a **row-level** (not count-level) gate
**Rule for Track B: a stage is not "done" because it ran. It is done when a stage-specific VALUE gate passes.**

---
# 🅴2 PARK FACTORS SEASONAL — DECISION: **MUST BE FILLED** (Trevor, 2026-08-30). And it FORCES A C28 RE-RUN.
`rg_factor_seasonal` is **0/309 on prod** vs 308/308 on staging. Trevor: **"rg factor seasonal 100% has to be filled."**
So E2 is a REQUIRED step, not the deferral the docs assumed. Investigating it turned up **four** things, one of which
is an ordering dependency that no doc records.

## 🔴 1. THE ORDERING BOMB — **E2 INVALIDATES C28's OPR/HTP OUTPUTS. `derive_conf_opr_htp` MUST BE RE-RUN AFTER E2.**
`backfill_park_factors_seasonal.ts:274` writes the **MAIN** factor columns too, not just `*_seasonal`:
`avg_factor, obp_factor, iso_factor, rg_factor, whip_factor, hr9_factor` + the lhb/rhb set. For the CURRENT season it
sets them to the **3-YEAR ROLLING** mean (2024/25/26), not the single season (`:267` `isCur ? rolling : sf`).
**`derive_conf_opr_htp.ts:10` reads `"Park Factors".rg_factor`** — and C28 step 3 ALREADY RAN on prod against the
*current* `rg_factor`, producing `run_env_factor` **30/30 (avg 101.879)** and `hitter_talent_plus` **30/30**.
E2 changes `rg_factor` underneath them ⇒ **both silently go stale**, and `HTP = OPR + 1.25·(Stuff+−100) + 0.75·park`
is the **competition-translation lever** — the exact same blast radius as the Conference Stuff+ catch.
★ **THEREFORE: after E2 applies, RE-RUN `derive_conf_opr_htp.ts --apply --prod` (C28 step 3).** It is idempotent and
cheap. A count check will show 30/30 and PASS either way — this is the **fourth** "populated but not fresh" trap of
this push. Log the BEFORE/AFTER `run_env_factor` values and require them to CHANGE.
(⚠ If E2 is instead run BEFORE C28 in some future ordering, C28 step 3 simply consumes the new value and no re-run is
needed. The rule is: **`derive_conf_opr_htp` must be the LAST thing to touch park-derived conference columns.**)

## 🔴 2. IT IS A DESTRUCTIVE DELETE + REINSERT OF THREE WHOLE SEASONS — not an upsert
`:285-288` `await sb.from("Park Factors").delete().eq("season", y)` for **each of 2024, 2025, 2026**, THEN inserts
(`:291`). There is **no upsert and no transaction** — a failure between the delete and the insert leaves Park Factors
**EMPTY for those seasons**, which takes conference HTP and every park-adjusted projection with it.
**PROD TODAY:** `2025 → 306 rows` · `2026 → 309 rows` · **no 2024 rows at all** (E2 CREATES the 2024 season on prod).
✅ **`_parkfactors_backup` exists on prod = 615 rows = exactly 306 + 309.** Restore point confirmed complete.
⚠ **ROW-COUNT GATE:** the reinsert only writes teams present in the CSVs. Prod 2026 has **309** rows and staging has
**308** — so at least one prod team may NOT come back. **Diff the team list BEFORE/AFTER and account for every dropped
row by name** before accepting the run. Do not gate on "it inserted lots of rows."

## 🔴 3. HARDCODED TO STAGING — `--env-file` CANNOT REDIRECT IT (same defect class as the old F42)
`:37` `const url = "https://slrxowawbijbjrkozqlj.supabase.co";` — a **literal staging URL** — and `:38-39` reads the
**literal string `.env.local`** for the service key. `grep -c 'trbvxuoliwrfowibatkm'` = **0**, `grep -c -- '--prod'` = **0**.
Running it "on prod" today would **silently rewrite STAGING's Park Factors and report success.**
**FIX BEFORE RUNNING:** make it env-driven (`process.env` first, env-file fallback) + the standard double-keyed guard,
copying the pattern now in `scripts/resync-build-snapshot-markets.ts`. Verify BOTH refuse paths.

## ⚠ 4. MACHINE-LOCAL FIXTURES — like Phase D, this can only be run from this machine
`:33` `ROOT = "/Users/danielleogonowski/RSTR IQ Data/park-factors"` — outside the repo, not in git.
✅ **VERIFIED PRESENT: `2024/`, `2025/`, `2026/`, 6 CSVs each** (combined/lhb/rhb × hitter/pitcher).

## ▶️ E2 ORDERED SEQUENCE
```
E2a  Add the double-keyed guard + env-driven URL/key to backfill_park_factors_seasonal.ts. Verify both refuse paths.
E2b  DRY RUN on prod. It prints "2026 rolling vs existing" mean|Δ| / max|Δ| / worst-8 per metric (:247-254).
     ★ READ THAT DIFF — it is telling you exactly how much C28's run_env_factor is about to move.
     Record the 2026 team list; diff vs the 309 prod rows and name every team that would not be reinserted.
E2c  Confirm _parkfactors_backup = 615 (done ✅). APPLY.
     GATE: rg_factor_seasonal 309/309 (was 0/309) · rg_factor still 309/309 · 2024 season now present ·
           no team silently dropped.
E2d  ★ RE-RUN `derive_conf_opr_htp.ts --apply --prod` — C28 step 3. REQUIRED, see §1.
     GATE: run_env_factor CHANGES from avg 101.879 (30/30 before and after — the count proves nothing).
```
