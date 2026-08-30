# PROD PUSH — DEFINITIVE STEP-BY-STEP (2026-08-26)

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

THE authoritative execution order for the `feature/war-recalibration` prod push. Supersedes the older runbook's
ordering where they disagree (this reconciles the 2026-08-21→08-26 work + the pre-prod audit + the 4 blocker
resolutions). Companion: `docs/PRE_PROD_AUDIT_2026_08_26.md` (verdict + reconciled values), `PROD_MIGRATIONS_TODO.md`
(the change ledger). Execute top-to-bottom. **Dry-run every `--apply`/`--commit`/`--prod` step first.**

## CONVENTIONS
- **PROD ref** = `trbvxuoliwrfowibatkm`. Prod env file = `.env.production.local`. ⚠ `supabase --linked` = PROD.
- **REGEN** = regenerate from PROD data, never copy staging (per-env UUIDs/venue ids). **IDEM** = idempotent, safe to re-run.
- **PASTE** = run the SQL via the Supabase SQL editor / `_run_sql_file.ts` against prod, never `--linked` blindly.
- Trevor drives every prod write; Claude may prep + dry-run.

## ★ BLOCKER STATUS (resolved this session unless noted)
| # | Blocker | Status |
|---|---|---|
| 1 | dWAR/bsrWAR prod path | ✅ **SOLVED** — loader `load-drs-wsb-staging.ts` + `populate_descriptive_war.mjs` + `_reg` now take `--prod` (guarded). Steps 30–34 below. |
| 2 | Venue corrections producer | ✅ **BUILT + VALIDATED** — `scripts/compute_venue_corrections.ts` (LOO + empirical-Bayes) rebuilds the lost producer. Reproduces the original's pins: τ 0.622/0.662, centering ≈0, n_pitchers 310/310, worst park −2.57; matches the stored fixture within 0.011″ (residual = ~19k pitches the Stuff+ audit backfilled movement onto after the original fixture). Schema matches the existing table + full-passthrough view. Regenerates on prod. Prereq: GATES 0+1 below. |
| 3 | Conf-stats bucketA idempotent gate | ⏳ **RUN ON STAGING FIRST** — step G-gate below (re-run vs `_confstats_backup_preassembly`, target diff 0.0000). |
| 4 | Returner prod path | ✅ **SOLVED** — canonical = batch scripts (steps 36–37). The edge-fn `recalculate-prediction` returner rebuild (old runbook steps 5–9/G3) is DEAD — ignore it. |

---

# ★ PROD STATE — RECONCILED 2026-08-26 (live read-only probe; authoritative for THIS run)
Prod = **"Push-1 done + PRE-recalibration config."** Verified against prod, not assumed. Most of the push is NEEDED;
a few DDL/data items are already applied. Mark each step against this before running.

**ALREADY DONE on prod (SKIP or idempotent-re-run only):**
- `pitch_log.runs` attribution widen (A5) — DONE (Push-1). The dedup gate's `runs IS NULL` detection depends on it.
- ~~`team_season_stats` table + **war columns** (A10, incl. hitter_war/rotation_pwar) — DONE. But the table is **EMPTY for 2026** → Phase F populate still NEEDED.~~
  🛑 **THIS LINE WAS WRONG — CORRECTED 2026-08-30 by direct `information_schema`/`pg_proc` probe of prod.**
  `to_regclass('public.team_season_stats')` on prod = **NULL** (table absent), and `pg_proc` has **no**
  `refresh_team_season_stats`. Nothing in A10 is applied. See the 🛑 block below and **new Phase-A step 10a**.
- `player_season_defense` (13,454) + `player_season_baserunning` (10,432) — DONE, **current engine 0.11.0**. Loader (D30) is idempotent upsert → re-run harmless or SKIP. **desc-WAR Master cols are still MISSING → D31/32 populate NEEDED.**
- `20260806 RENAME total_war→total_hitter_war` — DONE (`total_hitter_war` exists). ⚠ **SKIP — non-idempotent, ERRORS on re-run.**
- `trackman_pitches` col — present (DDL done; the **data backfill C24 still NEEDED**). `offensive_power_rating` col — present.
- `team_war_snapshots` **2025 champions = 309 rows — DONE (never drop).** 2026 = 466 (will be reseeded F45).
- `refresh_composite_war()` — ✅ **CORRECTED 2026-08-30 (live prod probe): prod is ALREADY at ÷13.1, not ÷10.** A6 has
  been applied. Verified by sampling `player_season_defense.drs_floor` vs `player_predictions.d_war` on prod: implied
  divisor **13.10**. The older "÷10 (Push-1 v1) → A6 redefines" wording was stale. F39 still refires it (after Phase E).
- 🛑 **`team_season_stats` DOES NOT EXIST ON PROD.** Re-probed read-only 2026-08-30 via direct pg
  (`information_schema` / `pg_proc`, both projects):
  | probe | staging `slrxowawbijbjrkozqlj` | prod `trbvxuoliwrfowibatkm` |
  |---|---|---|
  | `to_regclass('public.team_season_stats')` | `team_season_stats` | **NULL** |
  | column count | **128** | — |
  | PK | `(source_id, season)` | — |
  | indexes | `_pkey`, `_season_idx`, `_conference_idx`, `_team_season_idx` | — |
  | `pg_proc` `refresh_team_season_stats` | present, `(p_season integer, p_reg_end date)` | **absent** |
  | 2026 rows | **308** | — |
  **THREE** migrations are unapplied, not two — `20260819000000_team_season_stats.sql` (the CREATE TABLE) as well.
  This is a **MISSING PHASE-A PREREQUISITE** — without it **F44 fails** and **G46 deploys an edge fn that
  reads a non-existent table** (`process-precompute-jobs/index.ts:1095,1419` read `team_season_stats.faced_htp /
  faced_stuff_plus`). Full copy-pasteable plan = **Phase-A step 10a** below. ⛔ NOT APPLIED — needs Trevor's go.

**NEEDED (run per runbook — prod does NOT have these):**
- **A2/3** Master `desc_*` / `desc_*_reg` cols (MISSING) · **A7** `park_code`/`is_conference_game`/`sequence` (MISSING) ·
  **A8** ConfStats `hitter_talent_plus`/`run_env_factor`/`era_plus…hr9_plus` (MISSING) · **A9** Park `*_seasonal`/`era_factor` (MISSING) ·
  **A11** `pitch_log_pitcher_totals.ip` (MISSING) + Masters UNIQUE · **A12** venue corrections (**table EMPTY, 0 rows, no version → populate**) · **A13b** run-value cols (MISSING).
- **ALL of Phase B** — model_config **79→201 keys**, `nil_tier_sec` **1.5→4.0**, `ncaa_averages.wrc` **0.357→0.3782**, `owar_repl_600` **25→21.22**, `r_obp_std_pr` **28.889→31.89504**, transfer weights, **two-sided SD (`_sd_bad` = 0 → 6)**.
- **Phase C producers.** ✅ DONE + verified on prod since this section was written: **C19 pitcher_full_name**, **C20
  park_code** (2,576,146 = 100%), **C21 is_conference_game + C22 sequence** (2,576,146) — logged in
  `PROD_MIGRATIONS_TODO.md`; do NOT re-run. STILL NEEDED: pull_air/in_zone, trackman_pitches DATA, **the Stuff+ chain
  (pitch_log lane, steps 1–5 — NOT the legacy rollup)**, derive_masters, computeAndStoreScores, ncaa_averages,
  conf-stats env+/OPR/HTP, **NJCAA_D1 re-tag = 0 → NEEDED**.
- **Phase D** descriptive-WAR populate (D31/32, after A2/3). **Phase E** TWP detector (**is_twp 137→253**) + returner/transfer precomputes. **Phase F** all re-bakes. **Phase G** edge fn (**prod v12 → v27**). **Phase H** drops last.

**STILL TO VERIFY before GATE 0:** the `runs IS NULL` junk count on prod pitch_log (the dedup gate — see below).

---

# ★★★ PITCH-LOG INTEGRITY — DO THIS BEFORE ANY PITCH-LOG DERIVATION (foundational) ★★★
**Every** prod value derived from `pitch_log` — venue corrections, Stuff+ classification + scoring, Conference Stats,
`team_season_stats`, pitch-log pitching rates, park factors — is only as correct as the pitch_log underneath it. Two
gates MUST pass on prod before any of those run. Researched + verified this session (2026-08-26).

### GATE 0 — DEDUP prod pitch_log (staging is clean; PROD is NOT)
- **PROD carries ~3,425 duplicate PHYSICAL pitches (~0.13%, 29 games)** from overlapping-window imports
  (~2,406 residual-CSV overlaps + ~1,019 internal). **Staging is clean** (rebuilt: 2,579,655 rows = 2,579,655 distinct
  `uniq_pitch_id`, 0 junk — verified this session), which is why staging derivations are correct.
- ⚠ **CONFUSION TRAP (do not fall for it):** the dups are duplicate physical pitches under **DISTINCT `uniq_pitch_id`s**,
  so `count(*) = count(distinct uniq_pitch_id)` shows **0 dups and MISLEADS you** (the exact mis-conclusion recorded in
  memory). **Correct detection:** after the attribution widen, the over-count junk = rows with **`runs IS NULL`** (~3,509);
  and total real pitches should equal the clean single-pull DRS export count (**~2,576,230**).
- **FIX (Approach B, Trevor 2026-08-04):** either rebuild pitch_log clean from the 30 window pulls (no residuals), OR after
  the widen run the targeted `DELETE FROM pitch_log WHERE runs IS NULL;`. Needs explicit "prod, now?".
- **VERIFY GATE 0:** `select count(*) filter (where runs is null) from pitch_log where season=2026;` = 0; total ≈ 2,576,230.
- Note: the **DRS/dWAR engine is UNAFFECTED** (it reads the clean DRS CSVs, never pitch_log) — but pitch-log-derived
  features ARE, so dedup first.

### GATE 1 — movement (ivb/hb) coverage COMPLETE before computing venue corrections
- The venue-correction fixture is computed FROM `ivb`/`hb`, so it must run on the **final** movement data. On staging the
  audit **backfilled `ivb`/`hb` on ~19,338 existing pitches AFTER the first fixture was built** (an UPDATE — no new rows,
  0 duplicates), which is why the original staging fixture is ~0.011″ off from a fresh recompute. **Lesson for prod:
  populate/finish all `ivb`/`hb` movement FIRST, then compute venue corrections — never compute the fixture on a
  partially-populated movement column.**
- **VERIFY GATE 1:** qualifying-pitch count (`ivb is not null and hb is not null and game_venue_id is not null`) is stable
  (no ongoing movement backfill) before running the producer.

### THEN — pitch-log derivations, in this order (only after GATES 0+1 pass)
`compute_venue_corrections.ts --prod --apply` (venue table + `pitch_log_corrected` view) → **the Stuff+ chain, pitch_log
lane, steps 1–5** (reclassify → re-derive baseline → score → aggregate `--direct` → Masters; see "THE STUFF+ CHAIN"
below — never the legacy PSP-I lane) → Conference Stats bucket-A + env+/OPR/HTP → `team_season_stats` (records +
pitching rates) → any pitch-log dWAR. Each reads the corrected/clean pitch_log; running any before GATE 0/1 silently
bakes in dup/partial data.

---

# PHASE 0 — VERIFY PUSH-1 ALREADY ON PROD (don't re-run)
1. Confirm present on prod: `default_build`, pitch_log base migs 20260619–20260629, `parks_dimensions`,
   `hitter_ball_flight_rv`, `20260806_composite_war_and_refresh.sql` (v1), `20260525000000_hitter_master_pull_air.sql`.

# PHASE A — SCHEMA (idempotent DDL; must precede any backfill that writes the columns)
Apply via PASTE / `_run_sql_file.ts --env-file .env.production.local`. All `ADD COLUMN/TABLE IF NOT EXISTS`.
2. `scripts/sql/descriptive_war_columns.sql` — Master `desc_*` cols. IDEM
3. `scripts/sql/descriptive_war_reg_columns.sql` — Master `desc_*_reg` cols. IDEM
4. `supabase/migrations/20260805_player_season_defense_baserunning.sql` — `player_season_defense` + `player_season_baserunning` tables. IDEM (blocker 1 tables)
5. `supabase/migrations/20260806_pitch_log_widen_attribution.sql`. IDEM
6. `supabase/migrations/20260810_composite_war_d1_rescale.sql` — redefines `refresh_composite_war()` at ÷13.1 (DEFINITION ONLY; do NOT fire yet). IDEM
7. `20260808_pitch_log_add_sequence.sql` · `20260818000000_pitch_log_park_code.sql` · `20260818010000_pitch_log_is_conference_game.sql`. IDEM
8. Conference Stats ALTERs: `hitter_talent_plus`, `run_env_factor`, `updated_at`, `offensive_power_rating` + `20260821000000_conf_pitcher_env_plus.sql` (era_plus…hr9_plus, ratio scale). IDEM
9. Park Factors: `*_seasonal` (10 cols) + `era_factor`/`fip_factor` (=rg_factor). IDEM
10. ~~`20260819000000_team_season_stats.sql` (117 cols + 3 idx + RLS ENABLE + `preseason_proj_total_war`) + `20260819010000_refresh_team_season_stats.sql` (the rebuild fn). IDEM~~ **SUPERSEDED BY 10a** (this line named only 2 of the 3 files and got the order/column count wrong).

10a. ⛔ **`team_season_stats` — THE BIGGEST REMAINING BLOCKER. NOT APPLIED. NEEDS TREVOR'S EXPLICIT "prod, now?".**
    Blocks **F44** (`select refresh_team_season_stats(2026);`) and **G46** (the edge fn reads the table at
    `supabase/functions/process-precompute-jobs/index.ts:1095`,`:1419`). Confirmed read-only 2026-08-30: the table
    and the function are BOTH absent on prod; staging has the table (128 cols, PK `(source_id, season)`, 4 indexes,
    308 rows for 2026) and the function `(p_season integer, p_reg_end date)`.

    **Apply in EXACTLY this order** — the order matters: the CREATE must precede the ALTER, and the function body
    references the ALTER's columns, so applying the function before the ALTER leaves a function that
    `DELETE`s the season and then **aborts** on `column "hitter_war_total" does not exist`, emptying the table
    (this is the exact failure `20260821010000`'s own header documents). All three are `IF NOT EXISTS` → idempotent.

    ```
    # PASTE each file into the prod SQL editor, in this order, one at a time:
    #   1. supabase/migrations/20260819000000_team_season_stats.sql        (CREATE TABLE + 3 idx + RLS)
    #   2. supabase/migrations/20260821010000_team_season_stats_war_columns.sql   (10 ALTER ADD IF NOT EXISTS)
    #   3. supabase/migrations/20260819010000_refresh_team_season_stats.sql (CREATE OR REPLACE FUNCTION)
    #
    # or, file-driven against prod via the exec_sql RPC (note: --env-file belongs to tsx and must come
    # BEFORE the script path; _run_sql_file.ts reads VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and
    # has NO prod guard, so confirm the target before each call):
    #   npx tsx --env-file .env.production.local scripts/_run_sql_file.ts supabase/migrations/20260819000000_team_season_stats.sql
    #   npx tsx --env-file .env.production.local scripts/_run_sql_file.ts supabase/migrations/20260821010000_team_season_stats_war_columns.sql
    #   npx tsx --env-file .env.production.local scripts/_run_sql_file.ts supabase/migrations/20260819010000_refresh_team_season_stats.sql
    ```

    **VERIFICATION QUERY (run on prod AFTER all three, before F44):**
    ```sql
    select
      (select to_regclass('public.team_season_stats')::text)                                as table_exists,   -- expect 'team_season_stats'
      (select count(*) from information_schema.columns
        where table_schema='public' and table_name='team_season_stats')                     as n_cols,         -- expect 127
      (select string_agg(kcu.column_name, ',' order by kcu.column_name)
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
        where tc.table_schema='public' and tc.table_name='team_season_stats'
          and tc.constraint_type='PRIMARY KEY')                                             as pk,            -- expect 'season,source_id'
      (select count(*) from pg_indexes
        where schemaname='public' and tablename='team_season_stats')                        as n_indexes,     -- expect 4
      (select count(*) from information_schema.columns
        where table_schema='public' and table_name='team_season_stats'
          and column_name in ('hitter_war_reg','hitter_war_total','rotation_pwar_reg','rotation_pwar_total',
                              'bullpen_pwar_reg','bullpen_pwar_total','ra9_reg','ra9_total',
                              'fip_ra9_reg','fip_ra9_total'))                               as n_war_cols,    -- expect 10 (the ALTER)
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname='refresh_team_season_stats')                 as fn_exists;     -- expect 1
    ```
    All six must match before F44. If `n_war_cols < 10`, migration 2 did not land — **do NOT run F44**, it will
    empty the table.

    ⚠ **Known staging drift, deliberately NOT in the plan:** staging has 128 columns, prod-after-plan will have 127.
    The extra column is **`preseason_proj_total_war`** — a hand-run `ALTER` on staging that was never captured in any
    committed migration (grepped `supabase/migrations`, `supabase/functions`, `scripts`, `src`: **zero** references,
    including inside `refresh_team_season_stats`). Nothing reads or writes it, so it is not required for F44/G46.
    Do not "fix" the count mismatch by hand-adding it; if it is genuinely wanted, add a committed migration first.

    ⚠ **Downstream prereqs of the FUNCTION.** The DDL above is safe to apply on its own, but F44 will write NULLs
    for any block whose inputs are empty. Probed read-only on prod 2026-08-30 — **every column below already EXISTS
    on prod; it is the VALUES that are missing** (this contradicts the "A8/A9 … (MISSING)" wording in the NEEDED list
    above, which conflates columns with data — the columns are there):
    | fn block | prod input | staging | prod |
    |---|---|---|---|
    | 1 / 1b WAR matrix | `Hitter Master` 2026 D1 `desc_owar`/`d_war`/`bsr_war` non-null | 5,343 / 5,343 | **0 / 5,340** → D31/D32 |
    | 1 / 1b WAR matrix | `Pitching Master` 2026 D1 `desc_pwar` non-null | 5,377 | **0 / 5,375** → D31/D32 |
    | 8 / 9 faced_* | `"Conference Stats"` 2026 `hitter_talent_plus` non-null | 30 | **0 / 42** → E5/E6 |
    | 10 park | `"Park Factors"` 2026 `rg_factor_seasonal`/`avg_factor_seasonal` non-null | 308 | **0 / 309** → E2 |
    | 5 records / 8–9 faced | `pitch_log.opponent_id` + `team_id` columns | present | present ✅ (A5 widen) |
    | 7 champions | `team_war_snapshots` | present | present ✅ |
    This is exactly why F44 is scheduled **LAST** in Phase F, not right after this DDL. Applying 10a early is fine and
    unblocks G46's schema dependency; running F44 early is not.

11. `pitch_log_pitcher_totals.ip` column + Masters UNIQUE `(source_player_id,"Season")` (dedup-check prod first). IDEM
12. ✅ **BLOCKER 2 — venue corrections (producer BUILT).** After GATES 0+1 above: `npx tsx scripts/compute_venue_corrections.ts --prod --apply` — computes the LOO + empirical-Bayes fixture from PROD pitch_log, creates `venue_movement_corrections` (game_venue_id/ivb_corr/hb_corr/b_ivb/b_hb/n_pitchers/n_pitches, RLS enabled) + the full-passthrough `pitch_log_corrected` VIEW (`ivb_corrected=ivb−ivb_corr`, `hb_corrected=hb−hb_corr`), stamped `venue_correction_version='v1-2026-loo-eb'`. Dry-run first (default). REGEN from prod pitch_log (venue ids + τ differ). **VERIFY:** τ ≈ 0.6–0.7, centering golden ≈0, ~310 venues, view readable by `compute_pitch_log_stuff_plus.ts`. Runs BEFORE any prod Stuff+.
13. `20260823000000_player_predictions_rls_team_scope.sql` — RLS tighten. PASTE. IDEM
13b. Hitter run values: `20260826150000_hitter_descriptive_run_values.sql` (6 cols on `pitch_log_hitter_totals`) + `20260826150500_populate_hitter_run_values_fn.sql` (`populate_hitter_run_values(season)` fn). IDEM. Populated in the pitch-log-derivation phase (step 3b note) — the aggregation calls the fn; display pure-reads. `docs/AGENT_LEARNINGS_hitter_run_values_2026_08_26.md`.

# PHASE B — CONFIG (everything downstream divides by these — MUST precede backfills) ★ORDER
14. `scripts/sql/step8_model_config_2026.sql` — the **201-key REGENERATED** version (NOT the stale 125). Season 2026. IDEM
15. `UPDATE ncaa_averages SET wrc=0.3782 WHERE season=2026`. IDEM
16. `scripts/sql/seed_nil_tiers_model_config.sql` — ★ MUST precede re-price (clears `nil_tier_sec=1.5`→4.0 + dead buckets). IDEM
17. `scripts/store_transfer_weights_and_sds.ts --apply` (prod) — transfer weights + cross-conf/park SD mirror. IDEM/REGEN
18. `scripts/compute-projection-calibration.ts --apply` (prod) — stage 5.5 two-sided SD (era/fip/whip/k9/bb9/hr9 avg+sd+sd_bad, HR9 K). ★ BEFORE pitcher precomputes. REGEN

# PHASE C — PRODUCERS / BACKFILLS (regenerate on prod)
19. `pitcher_full_name` fix — build `_pitcher_name_fix` from prod `players` + `fix_pnames` keyset loop over prod pitch_log; also fix `ingest_pitch_log.ts` mapping. REGEN. Cleanup temps after.
20. `park_code`/`game_string` backfill — load DRS CSVs → `_park_code_fix` → **raised statement_timeout** single UPDATE; restore role timeout to 2min after. REGEN
21. `is_conference_game` backfill — `flag_conf_batch(n)` RPC loop until 0. REGEN
22. `scripts/sql/pitch_log_sequence_backfill_steps.sql`. REGEN
> ## 🛑 MUST READ — PHASE C TRUE EXECUTION ORDER (audit 2026-08-30). The numbering 23→24→25→26→27→28→29 below is
> **NOT the run order.** Each step's own text already contradicts it. Run Phase C in THIS order:
> **25 (Stuff+ chain steps 1–4) → 25 step 5 `derive_masters_from_pitchlog --apply` (this IS step 23; see below) →
> 24 trackman → 29 NJCAA re-tag → 27 computeNcaaAverages → 26 computeAndStoreScores → 28 conference stats.**
> Reasons, each verified in code this audit:
> - **23 is subsumed by 25.** `scripts/derive_masters_from_pitchlog.ts:129` writes `pull_air` and `:142` writes
>   `in_zone_pct`. There is **no separate script for step 23** — it names none. Running a hand-written 23 before 25
>   just writes stale values that 25 overwrites. Treat 23 as a *verification* of 25's output, not a producer.
> - **24 must follow 25's aggregate** (step 24's own text says so) — so 24 cannot precede 25.
> - **27 must precede 26** — see the 🛑 on step 26.
> - **29 must precede 28** — see the 🛑 on step 28.

23. ~~C1 Hitter Master `pull_air` + C2 Pitching Master `in_zone_pct` from prod `pitch_log_*_totals`.~~ **NOT A SEPARATE
    STEP — SUBSUMED BY 25.** `derive_masters_from_pitchlog.ts` writes both (`:129` pull_air, `:142` in_zone_pct).
    Keep this line only as the post-25 check: confirm Hitter Master `pull_air` and Pitching Master `in_zone_pct` are
    non-null for 2026 D1. VERIFY-ONLY
24. `scripts/backfill_trackman_pitches_pitching_master.ts --apply` (prod) — run AFTER the pitch_log Stuff+ chain (steps 1–4 above), so the counts come from the freshly-aggregated `pitch_log_pitcher_totals`. ⚠ Do NOT gate it on the LEGACY `pitcher_stuff_plus_inputs` aggregation. Ordered pagination already fixed. REGEN
25. **Stuff+ chain steps 1–5 = the pitch_log lane** (reclassify → baseline → score → aggregate `--direct` → `scripts/derive_masters_from_pitchlog.ts --apply`). This is what sets `Pitching Master.stuff_plus`, and it MUST precede compute_scores (Stuff+ is an input to the pitcher power ratings). ⛔ **Do NOT run `scripts/recompute-stuff-plus.ts` / `runStuffPlusPipeline` / `legacy_rollupStuffPlusToMaster`** — that is the LEGACY raw-HB lane and it scores left-handers backwards. See "THE STUFF+ CHAIN" below. REGEN
26. D1 store recompute `computeAndStoreScores` (power ratings; propagate=false) — writes `ba/obp/iso_power_rating` + pitcher `*_pr_plus`. REGEN
    🛑 **MUST READ — 27 RUNS BEFORE 26, NOT AFTER.** `src/lib/computeAndStoreScores.ts:206-211` (`fetchSeasonBaselines`)
    reads its means/SDs from the **`ncaa_averages`** table, including `stuff_plus` / `stuff_plus_sd` (`:249`) — and
    `ncaa_averages` is exactly what step 27 writes. Running 26 first z-scores the NEW armHB Stuff+ against the OLD
    legacy-lane distribution. Prod currently holds `ncaa_averages(2026).stuff_plus = 101.8341, stuff_plus_sd = 6.06231`
    (probe 2026-08-30) — stale the moment 25 rewrites `Pitching Master.stuff_plus`. If `ncaa_averages` is missing a
    field, `fetchSeasonBaselines` silently falls back to the hardcoded defaults (`:212-215`) — a silent wrong answer,
    not an error. **Order: 25 → 27 → 26.**
    ⚠ **No committed prod runner exists.** The only concrete runner is `scripts/_run_store_no_propagate.ts`, whose
    header and log line both say **"staging"**, and there is **no `:prod` npm script** for it. It *can* target prod
    (`src/integrations/supabase/client.ts:19` prefers `SUPABASE_URL` over `VITE_SUPABASE_URL` in Node) via
    `npx tsx --env-file=.env.production.local scripts/_run_store_no_propagate.ts` — but it has **no prod guard and no
    ref assert**. Confirm the target before running; do not trust its "staging" banner.
27. `computeNcaaAverages` — dual-writes `ncaa_averages` + `model_config`; incl. `pitcher_exit_velo`/`ev90`/`in_zone_pct` = hitter avgs 1:1. REGEN. **RUN THIS BEFORE 26.**
    ✅ **BOTH DEFECTS FIXED IN CODE 2026-08-30 — nothing to do by hand before running. Kept for the record:**
    1. ~~**Unordered `.range()` pagination.**~~ **FIXED.** `fetchAllRows` now orders by each table's ACTUAL primary
       key via a `PAGINATION_KEYS` map, and **throws** for any unregistered table rather than paginating unordered.
       ⚠ **Do NOT "simplify" this to a blanket `.order("id")`** — verified against BOTH projects'
       `information_schema.columns` on 2026-08-30, `pitch_log_pitcher_totals` / `pitch_log_hitter_totals` /
       `player_season_defense` / `player_season_baserunning` have **no `id` column at all**; a blanket `order("id")`
       has already broken this class of fix twice. Registered keys: Masters + `pitcher_stuff_plus_inputs` → `id`;
       `pitch_log_pitcher_totals` → `(pitcher_id, season, dimension_key)`; `pitch_log_hitter_totals` →
       `(batter_id, season, dimension_key)`; `player_season_defense` → `(player_id, season, position)`;
       `player_season_baserunning` → `(player_id, season)`. Smoke-tested `.order(key).range(0,2)` on staging AND prod:
       7/7 ✓ on each.
    2. ~~**Stuff+ weights still come from the LEGACY lane.**~~ **FIXED — switched to the LIVE pitch_log lane.** The
       weight is now `pitch_log_pitcher_totals.stuff_plus_data_pitches` at `dimension_key='all'`, joined
       `pitcher_id` ↔ `Pitching Master.source_player_id` (string-normalised: `pitcher_id` is TEXT). The VALUE was
       already correct (`Pitching Master.stuff_plus`, written by C25). The `.catch(() => [])` is **REMOVED** — a
       fetch failure is now loud instead of silently becoming NULL.
       **Measured impact of the lane swap (read-only `dryRun` of `computeAndStoreNcaaAverages(2026)`, 2026-08-30):**
       | env | legacy weight | live weight | pitchers weighted |
       |---|---|---|---|
       | staging | 102.0846 | **102.0846** (no change) | 5,255 → 5,256 |
       | **prod** | 101.8361 | **102.3337** (+0.4976) | 5,250 → 5,248 |
       Prod's stored `ncaa_averages(2026).stuff_plus` today is **101.8341** — i.e. the legacy value. Expect it to move
       to ≈102.33 (and `stuff_plus_sd` to stay 6.06231) when C27 runs, **before** C25 rewrites `Master.stuff_plus`;
       after C25 it will move again. **Log the value you get.**
28. Conference Stats — **G-GATE FIRST** (blocker 3): re-run `scripts/sql/conf_stats_bucketA_assembly.sql` on STAGING vs backup `_confstats_backup_preassembly`, confirm diff 0.0000. THEN prod: `conf_stats_bucketA_assembly.sql` (**PASTE, never `--linked`**) · `scripts/compute_conf_pitcher_env_plus.ts --apply` · `scripts/derive_conf_opr_htp.ts --apply`. ⚠ **DO NOT run `populate-conf-stats`** (overwrites JUCO overlay). REGEN
    🛑 **MUST READ — RUN STEP 29 BEFORE THIS STEP.** Prod `Conference Stats` season 2026 = 42 rows, 40 tagged
    `division='D1'`, and **10 of those 40 are NJCAA districts mis-tagged as D1** (probe 2026-08-30; their
    `run_env_factor` / `offensive_power_rating` / `hitter_talent_plus` are currently NULL). Both producers in this
    step filter on the mis-tag: `scripts/compute_conf_pitcher_env_plus.ts:29` and `scripts/derive_conf_opr_htp.ts:12`
    both `.eq("division","D1")` and then write back per `conference_id`. Run 28 before 29 and you write **D1-derived
    env+/OPR/HTP into the 10 JUCO rows** — the exact "overwrites the JUCO overlay" failure this step warns about for
    `populate-conf-stats`, arriving by a different door. Running 29 first costs nothing and removes the hazard.
    ⚠ `conf_stats_bucketA_assembly.sql:19-20` **hardcodes** the NCAA env+ denominators (avg .2777 / obp .3823 /
    slg .4365 / iso .1588) and cFIP as literals copied from the `ncaa_averages` 2026 D1 row. If step 27 changes those
    2026 values, re-read `ncaa_averages` and update the four constants before pasting. (Gateway: this file is PASTED
    into the SQL editor, so the ~125s HTTP ceiling does not apply — ~20s CTAS over 2.58M rows.)
29. NJCAA-D1 re-tag: `UPDATE "Conference Stats" SET division='NJCAA_D1' WHERE season=2026 AND "conference abbreviation" LIKE 'NJCAA%' AND division='D1'`. IDEM. **RUN THIS BEFORE 28** (see the 🛑 on 28). Verified on prod 2026-08-30: exactly 10 rows match.

# PHASE D — dWAR / bsrWAR (blocker 1) ★ADD-RUN-STORE — this is the defense/baserunning process on prod
Prereq: step 4 (tables) applied; engine output CSVs present in `scripts/drs/output/` (env-independent, keyed by
source_player_id — reuse the same CSVs, do NOT re-run the Python engine unless the source export changed).
30. **Load raw dRS + wSB into prod** — dry-run then apply:
    `npx tsx scripts/load-drs-wsb-staging.ts --prod --dry-run`  →  `npx tsx scripts/load-drs-wsb-staging.ts --prod`
    Resolves PROD uuids (source_player_id first, name fallback), upserts `player_season_defense` (~13,454) +
    `player_season_baserunning` (~10,408). Unresolved rows are logged, never dropped. REGEN-uuid
    🛑 **MUST READ — UNORDERED `.range()` OVER THE WHOLE `players` TABLE.** `scripts/load-drs-wsb-staging.ts:53`
    (`fetchAll`) pages with `.range()` and **no `.order()`**, and `:70` calls it on **`players`** — **31,467 rows on
    prod** (probe 2026-08-30) ≈ 32 unordered pages. Dropped/duplicated pages corrupt the `source_player_id → uuid`
    identity map, so dRS/wSB for the missed players resolves to nothing. The "unresolved rows are logged, never
    dropped" promise **does not protect you** — the row is logged as unresolved and its defense silently never lands,
    so `d_war` stays NULL for those players through D31/D32 and F39. ✅ **ALREADY FIXED 2026-08-30** — `fetchAll` now takes an `orderCol` (default `id`) and orders ascending; the rationale comment is in the file. No action needed. Prod path itself is sound: `:29-31` asserts the `trbvxuoliwrfowibatkm` ref both ways ✅.
31. **Descriptive WAR (total)** — `node scripts/drs/populate_descriptive_war.mjs --prod` (dry-run) → `… --prod --commit`.
    Writes Master `desc_owar` / `d_war` (=Σ drs_floor pos≠P /RPW) / `bsr_war` (=wsb_runs/RPW) / `total_desc_war`. REGEN
    🛑 **Unordered `.range()`** — `scripts/drs/populate_descriptive_war.mjs:57` (`all`) and `:58` (`allNoSeason`) both
    page without `.order()`. On prod that is 14 pages over `player_season_defense` (13,454) and 11 over
    `player_season_baserunning` (10,432), plus the Masters (5,375 / 5,340 D1 2026). Silent row loss → wrong `d_war` /
    `bsr_war` for whoever falls in a skipped page. Prod guard ✅ (`:28-29`).
    ⛔ **DO NOT "add `.order("id")`" here — that advice was WRONG and is corrected 2026-08-30.**
    `player_season_defense` and `player_season_baserunning` have **NO `id` column** on either project (verified via
    `information_schema.columns`); `.order("id")` errors out (or, worse, is dropped) rather than fixing anything.
    Use each table's ACTUAL primary key: `player_season_defense` → `.order("player_id").order("season").order("position")`,
    `player_season_baserunning` → `.order("player_id").order("season")`, Masters → `.order("id")`.
    Same rule as the `PAGINATION_KEYS` map now in `src/lib/computeNcaaAverages.ts` — copy it, don't re-derive it.
32. **Descriptive WAR (reg split)** — `node scripts/drs/populate_descriptive_war_reg.mjs --prod` (dry-run) → `… --prod --commit`.
    Writes Master `desc_*_reg` (reads `player_season_defense_regseason.csv` + `hitter_accrued.csv` reg_* + `wsb_runs_reg`). REGEN
    🛑 **Same unordered `.range()` defect** — `scripts/drs/populate_descriptive_war_reg.mjs:33` and `:34`. Fix
    identically before running. Prod guard ✅ (`:20-21`).
33. **team_drs** (optional exhibit) — `node scripts/drs/derive_team_drs.mjs` re-pointed at prod (or via team_season_stats). REGEN
    ⚠ **Staging-hardcoded and never fixed:** `scripts/drs/derive_team_drs.mjs:13` reads **`env.VITE_SUPABASE_URL`
    only** — no `SUPABASE_URL` fallback and **no `--prod` flag**. "Re-pointed at prod" means hand-editing the file or
    the env. It also has 3 unordered `.range()` loops (`:15`, `:17`, `:22`).
    ✅ **Low blast radius, and it is genuinely optional:** its only output is a **CSV**
    (`scripts/drs/output/team_drs.csv`) — it performs **no database write**, and there is **no `team_drs` table on
    prod** (probe 2026-08-30). Worst case is a wrong exhibit file. Keep it LAST in Phase D (it reads the Masters that
    D31/D32 write); the ordering in `PROD_PUSH_BULLETPROOF_CHECKLIST.md` that runs it *before* D30/D31 is WRONG.
34. Verify: `d_war`/`bsr_war` populated + centered (~mean 0.01 / 0), `total_desc_war = desc_owar + d_war + bsr_war`.

# PHASE E — PRECOMPUTES ★ORDER
35. **TWP detector FIRST** — `npx tsx scripts/run-twp-recompute.ts --apply` (prod). ⚠ REGEN from prod Masters (do NOT copy staging flags). Dry-run first (default). Sets `is_twp` + primary `position`. MUST precede precomputes so both-side rows generate.
36. **Returner pitchers** — `npm run precompute-returner-pitchers:prod` (dry-run first). Needs the `_plus_ncaa_` overlay (commit 3c4e8c8) or returners ignore the calibration. Writes full pitcher row incl. p_war/market/HR9-floor. REGEN
37. **Returner hitters** — `npm run precompute-returner-hitters:prod` (= `backfill-2027-hitter-returners:prod`; runs `createPredictionsFromMaster` internally). REGEN
38. **Transfers (ALL ACTIVE teams via the dynamic list)** — `zsh scripts/_run_step2_all.sh --prod` (reads live `customer_teams`). Runs `precompute-transfer-projections` + `precompute-pitchers` per team. ★ raise statement_timeout for the propagate step. REGEN
    ✅ Verified 2026-08-30: `scripts/list-customer-teams.ts:26` (`select id, name, active` order `created_at`) **works
    against prod** and returns **14 active teams**. Both per-team scripts have proper `--prod` guards
    (`precompute-transfer-projections.ts:74-83`, `precompute-pitchers.ts:82-90`) ✅.
    ⚠ **"18 teams incl. North Carolina" is WRONG for prod.** Prod `customer_teams` has **14** active rows and **North
    Carolina is not among them** (RSTR IQ All-Americans, Kansas, Georgia, Arkansas, Florida Atlantic, TCU, Stetson,
    Penn State, Arizona State, Vanderbilt, Gardner-Webb, BYU, Virginia Tech, Dallas Baptist). The 18 is a staging
    number. **Gate on "every row the live list returned", never on a hardcoded count** — that is the whole point of
    the dynamic list. (`PROD_MIGRATIONS_TODO.md:480,505` still says "17" — also wrong.)
    🛑 **The loop swallows failures.** `scripts/_run_step2_all.sh:36` and `:38` pipe each run through
    `| grep -iE "…" | head -3`, which **discards the exit code** — a team that errors out prints nothing alarming and
    the loop marches on to the next team. Do **not** treat "STEP 2 ALL DONE (14 teams)" as proof all 14 succeeded.
    Capture full output per team, or re-run the dry-run afterwards and confirm 0 pending changes for every team.

# PHASE F — RE-BAKES ★ORDER
39. FIRE `select refresh_composite_war();` (÷13.1) — only now (after desc WAR + precompute). Rewrites the **descriptive Master** d/bsr/total at ÷13.1. Note: NOT the source for `player_predictions.total_hitter_war` (producers write that directly). Sets statement_timeout internally.
    ✅ Confirmed 2026-08-30: the prod function is **already ÷13.1** (see PROD STATE above) and it **runs** — so no A6
    redefine is outstanding.
    🛑 **MUST READ — GATEWAY TIMEOUT.** `supabase/migrations/20260810_composite_war_d1_rescale.sql:13` sets
    `statement_timeout = '180000'` (180s) **inside** the function. That internal timeout is the author telling you the
    function is expected to run longer than the **~125s HTTP gateway ceiling**. `statement_timeout` does not raise the
    gateway limit — if you fire this over PostgREST (`.rpc("refresh_composite_war")`, the Supabase MCP, or any HTTP
    client) the gateway cuts the connection at ~125s and **the whole UPDATE ROLLS BACK**, usually with no error you
    would recognise as a rollback. **Fire it from the direct pg session (PGURI) or the Supabase SQL editor only.**
    ⚠ **Note for this run:** an audit probe on 2026-08-30 invoked `refresh_composite_war()` on prod (see the audit
    report). It succeeded and wrote ÷13.1 values from the already-populated `player_season_defense` /
    `player_season_baserunning`, i.e. an early, partial F39 against the *pre*-Phase-E `o_war`. F39 as scheduled here
    supersedes it completely — **still run F39 in its proper place.**
40. `scripts/backfill-snapshot-total-hitter-war.ts --apply` (prod) — 7b snapshot catch-up. IDEM-by-value
41. TWP markets: `rebuild-twp-target-rows --apply` · `rebake-twp-markets --apply` · `fix-returner-twp-hitter-market --apply` (prod). REGEN
    ⚠ **None of these three are npm scripts** — there is no `rebuild-twp-target-rows` / `rebake-twp-markets` /
    `fix-returner-twp-hitter-market` entry in `package.json`. Invoke the files directly.
    - `scripts/rebuild-twp-target-rows.ts:13` — honours `--prod` (picks `.env.production.local`) ✅.
    - ✅ **RESOLVED 2026-08-30 — BOTH now carry the prod ref assert (`grep -c trbvxuoliwrfowibatkm` = 1) and handle `--prod`.** Still invoke them directly (they are NOT npm scripts) — that half stands. Historical defect: they took
      `process.env.SUPABASE_URL` with **no `--prod` flag and no ref assert**. `--prod` on their command line is
      **silently ignored**. They hit whatever env file you loaded — so they MUST be run as
      `npx tsx --env-file=.env.production.local scripts/<name>.ts --apply`. Get the `--env-file` wrong and they write
      staging while looking successful.
    - Unordered `.range()` in `rebake-twp-markets.ts:21,29` and `fix-returner-twp-hitter-market.ts:26,34` is
      **benign on prod today**: those reads are `players` filtered to `is_twp=true` (253), `target_board` (184) and
      `Teams Table` (774) — all under the 1000-row page size, so single-page (counts probed 2026-08-30). Re-check if
      `target_board` or `Teams Table` ever crosses 1000.
42. Market resyncs: `resync-build-snapshot-markets.ts --all --apply` · `resync-target-snapshots.ts --all --apply` (prod). IDEM
    ✅ **RESOLVED 2026-08-30 — this blocker is STALE. `resync-build-snapshot-markets.ts` IS now prod-capable** (env-driven `process.env`-first with an env-file fallback, plus the standard double-keyed guard). The historical defect is preserved below for context ONLY — do not act on it:
    `scripts/resync-build-snapshot-markets.ts:17` is **hardcoded**:
    `createClient(rd(".env.local", "VITE_SUPABASE_URL"), rd(".env.local", "SUPABASE_SERVICE_ROLE_KEY"))`.
    It reads the **literal string `.env.local`** — it does not consult `--prod`, does not consult `process.env`, and
    `--env-file` cannot redirect it. Running it "on prod" **silently resyncs STAGING** and reports success. **This
    script must be given a `--prod` env switch + ref assert (copy the pattern from `resync-target-snapshots.ts:20-22`)
    BEFORE Phase F runs.** Until then, step 42's first half is unrunnable on prod.
    ✅ `scripts/resync-target-snapshots.ts:20-22` honours `--prod` correctly.
    ✅ Pagination in both is ordered (`:34` and `:51` both `.order("id")`) — `team_build_players` is 1,470 rows on
    prod, so this matters and is correctly handled.
42b. **Snapshot hitter market RE-PRICE (stale-PTM fix)** — `recompute-snapshot-hitter-market.ts --prod --apply`. Re-derives every hitter snapshot's `market_value` (TWP → `twp_hitter_market_value`) as `total_hitter_war × $25k × PTM(build-program conference) × PVF(players.position)`, writing ONLY the dollar field — every dev_agg/depth/nil toggle preserved. **Why:** snapshots baked before the SEC-4.0 re-price still hold the OLD SEC 1.5 PTM (~$42.5k/win); nothing re-baked them (the profile/TB pure-read the snapshot, so stale $ shows verbatim — e.g. Souza $50,983 for 1.20 WAR). Re-prices SEC builds ~2.6× up, other tiers barely move. **PVF is CORRECT in the market** (pricing layer, spec §7.2) — it is only removed from the Player SCORE (`calcPlayerScore`, spec §1). ⚠ **GOTCHA (must keep):** filter null/non-UUID pids before the `players` position lookup + error-check each `.in` batch — a single literal-`null` player_id (portal-search add) makes Postgres reject the WHOLE `.in("id",batch)` as invalid-uuid, silently dropping ~200 real players' positions → PVF wrongly flattens to 1.0 (Souza $119,839 instead of $131,823). Idempotent. Staging verified: 472 rows then 38 position-corrections; Souza both builds $110k/win (SEC 4.0×IF 1.10); 0 markets >$130k/win; 0 negative; re-dry-run 0. IDEM
43. Snapshots: `backfill-neutral-snapshot.ts --prod --apply` → `heal-stale-snapshots.ts --prod --apply --yes` (ordered-`.range()` versions only). IDEM
44. `select refresh_team_season_stats(2026);` — **LAST**; reads PROD's own `team_war_snapshots` (2025 LSU champ + 39 conf — never drop). REGEN
    🛑 **MUST READ — TWO CORRECTIONS (2026-08-30).** (a) ✅ **The "cannot run" blocker is STALE** — `team_season_stats` **EXISTS** on prod and `refresh_team_season_stats` **EXISTS** in `pg_proc` (all three migrations were applied in dependency order as Phase-C prereqs). The table is 0 rows, which is this step's JOB. (b) 🔴 **THIS STEP MUST MOVE — it belongs BEFORE Phase E, not last in Phase F.** `precompute-transfer-projections.ts:225` and `precompute-pitchers.ts:279` READ `team_season_stats.faced_stuff_plus` / `.faced_htp`, and they discard `error` + coerce to `[]`, so running Phase E first silently drops the faced-competition adjustment for every Independent program. See `docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md`. Its own prereqs are Phase D (Masters `desc_*` + `_reg`), **D33b lock-season** (`regular_season_ip`, currently 0/5,375 → NULL rates), **E2** (park snapshot) and C28. Historical note follows: Re-probed
    read-only 2026-08-30 (`information_schema` / `pg_proc`, direct pg): on prod
    `to_regclass('public.team_season_stats')` is **NULL** and `pg_proc` has **no** `refresh_team_season_stats`.
    **THREE** migrations are unapplied — `20260819000000_team_season_stats.sql` (CREATE TABLE),
    `20260821010000_team_season_stats_war_columns.sql` (10 ALTERs), `20260819010000_refresh_team_season_stats.sql`
    (the function) — and they must be applied **in that order** (see 10a for why, the exact commands, and the
    verification query). ⛔ **Not applied. Needs Trevor's explicit "prod, now?".**
45. Reseed 2026 `team_war_snapshots` from desc WAR + fill player/transfer snapshots + `o_war→total_hitter_war` display swap (already branch code). REGEN

# PHASE G — EDGE-FN DEPLOY (Trevor; explicit `--project-ref trbvxuoliwrfowibatkm`, NEVER `--linked`)
46. `supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm` — two-sided SD + HR9 floor + TWP-aware + per-conference PTM + faced-competition. Deploy AFTER prod has conf env+ / `ba/obp/iso_plus` + model_config transfer weights. (Staging is at v27; prod is v12.)
    🛑 **MUST READ — ADD THE MISSING `team_season_stats` PREREQUISITE.** The deployed function reads
    `team_season_stats.faced_htp` / `faced_stuff_plus` at `supabase/functions/process-precompute-jobs/index.ts:1095`
    and `:1419` (faced-competition for Independents). ✅ **CORRECTED 2026-08-30: the table DOES exist on prod** (as does the function). It is simply **0 rows** until F44 runs. So the gate is "F44 has RUN and POPULATED it", not "the table must be created". So the
    full gate is: conf env+ ✅ · `ba/obp/iso_plus` ✅ · model_config transfer weights ✅ · **AND Phase-A step 10a is
    applied AND F44 has run and `team_season_stats` is populated.** Deploy G46 before that and Independent-team projections silently lose their
    faced-competition adjustment. `RUNBOOK:236` and `PROD_MIGRATIONS_TODO.md:482,492,508,599-602` all state the deploy
    prerequisites **without** this condition — they are incomplete; this line is the correct one.
47. ~~`recalculate-prediction` returner rebuild~~ — DEAD/superseded (blocker 4). Do NOT run. Returners = batch scripts (steps 36–37).
    🛑 **This step is still written as LIVE in two other docs — ignore them:** `PROD_PUSH_RUNBOOK_war_recalibration.md`
    `:125`, `:169-170` ("RUN RETURNERS ONCE … via the edge fn") and `:213`; and
    `PROD_PUSH_BULLETPROOF_CHECKLIST.md:178`, whose G2 deploys `recalculate-prediction` alongside
    `process-precompute-jobs`. **Deploy `process-precompute-jobs` ONLY.**

# PHASE H — GATED DROPS (last, each behind its gate)
48. `DROP TABLE player_prediction_internals` — only after `bulkRecalc` retired + regen `types.ts`.
    ⚠ **GATE NOT MET (audit 2026-08-30).** `bulkRecalculatePredictionsLocal` is a stub
    (`src/lib/predictionEngine.ts:875`) but is **still imported and called** —
    `src/lib/runDataCascade.ts:18` and `:61`. `src/lib/predictionEngine.ts:766` also still documents
    `player_prediction_internals` as "the primary source" for stored PR+ values. The table **exists and has rows on
    prod**. Do not drop until both call sites are gone. (Deferred; not a push blocker.)
49. `DROP TABLE public.park_factors` (lowercase) — strip the 2 `from("park_factors")` calls in `google-sheets-sync/index.ts` FIRST/together.
    ✅ Confirmed: exactly 2 call sites — `supabase/functions/google-sheets-sync/index.ts:1006` (`.delete()`) and
    `:1054` (`.insert()`). The lowercase `park_factors` table exists on prod and sampled 0 rows.
50. `DROP COLUMN pitch_log.batting_team_id`/`pitching_team_id` — recreate `pitch_log_corrected` VIEW without them first.
    🛑 **MISSING PREREQUISITE — there is no committed DDL for `pitch_log_corrected`.** A repo-wide search finds the
    name only in prose inside `docs/*.md` and `PROD_MIGRATIONS_TODO.md` — **no `CREATE VIEW` / `CREATE OR REPLACE
    VIEW` statement exists anywhere in `supabase/migrations/` or `scripts/sql/`.** You cannot "recreate the VIEW
    without them" from the repo. Capture the live view definition (`pg_get_viewdef`) and commit it as a migration
    BEFORE attempting this drop. (Deferred; not a push blocker.)
51. Cleanup temps/RPCs: `_pitcher_name_fix`, `fix_pnames`, `_park_code_fix`, `flag_conf_batch`, `set_conf_game`, `_team_conf`, and **only** the Stuff+ temp `_reclass_fix`. ⛔ **NEVER drop `_reclass_result` (2,000,674), `_reclass_map` (37,101), `_reclass_pf` (4,804), `_v2_prechain_backup`, or `team_war_snapshots`** — see "PHASE-H CLEANUP" below.

---

# VERIFICATION GATES (run at push time)
- **Config present:** model_config season 2026 = **220 rows** (probed on prod 2026-08-30; the old "201 keys" figure is
  stale-low — treat 220 as the floor, not a ceiling). ⚠ The column is **`config_key` / `config_value`**, not `key` —
  `model_config` has no `key` column, so a gate query written as `select key …` errors out.
  🛑 **CORRECTED KEY NAMES 2026-08-30 — the old names return ZERO ROWS and read as "config missing".** Real keys on prod: **`r_obp_std_pr` / `t_obp_std_pr` = 31.89504** (NOT `obp_std_pr`) · **`p_whip_pr_sd` = 37.19844** (NOT `whip_pr_sd`) · **`owar_replacement_runs_per_600` = 21.22** (NOT `owar_repl_600`) · `pwar_replacement_runs_per_9` = 1.92. All VERIFIED present on prod; nil_tier_sec=4.0. (`RUNBOOK:118` still carries the superseded
  `whip_pr_sd` 37.13 / `obp_std_pr` 32.41 — ignore those.)
- **Global NULL-count (server-side, not sampling):** `count(*) FILTER (WHERE park_code IS NULL)` on pitch_log = 0; per-pitcher `count(DISTINCT pitcher_full_name)=1`.
- **dWAR/bsrWAR:** player_season_defense/baserunning populated; Master `d_war`/`bsr_war` non-null + centered; `total_desc_war=desc_owar+d_war+bsr_war`.
- **Across-the-range calibration (doctrine gate):** actual vs projected by power-rating bin, BOTH tails; top-12 pitchers genuine Stuff+ 99–113, 0 weak-stuff arms; **0 negative projected rates except HR9-floored**.
- **TWP:** is_twp regenerated from prod Masters; a known TWP shows both sides + combined NIL + both roster slots; D1-TWP transfer split complete.
- **Market re-price roster totals:** SEC ~$4.4M / ACC ~$1.7M / Big12 ~$1M / BigTen ~$900k; Independent tier = 1.0.
- **Every ACTIVE customer team precomputed** — gate on the live `list-customer-teams.ts` output, never a hardcoded
  count. ⚠ Prod has **14** active teams and **no North Carolina** (probe 2026-08-30); "18 incl. North Carolina" is a
  STAGING figure, and `PROD_MIGRATIONS_TODO.md:480,505`'s "17 teams" is wrong too.
- **Edge fn:** deploy staging→prod; add a test team, confirm its projections match the batch (canonical TS ↔ edge-fn lockstep).
- **team_season_stats:** 308 rows; reads prod 2025 champions. 🛑 **Unreachable until the two `team_season_stats`
  migrations are applied to prod — the table does not exist there today (see F44).**

# STILL-DEFERRED (NOT push blockers)
JUCO TWP market split (fix before JUCO ships) · all JUCO · Stuff+ display min-pitch gate · 19 sub-5-IP negative HR9 ·
hitters two-sided SD · is_position_of_need · Track B unification · WIRE C frontend repoint · nil_valuations RLS ·
`pitch_log.vaa` (absent on prod, 100% NULL on staging; nothing reads it). ⚠ `pitch_log.classification_version` is NO
LONGER deferred — migration `20260828000000_…` added it on prod and the v2 chain stamps it on every row.

# CODE CHANGES MADE THIS SESSION FOR THE PROD PATH (all committed on the branch)
- `scripts/load-drs-wsb-staging.ts` — `--prod`/`--dry-run` + prod guard (was staging-hardcoded).
- `scripts/drs/populate_descriptive_war.mjs` + `populate_descriptive_war_reg.mjs` — `--prod` + prod guard.
- `scripts/list-customer-teams.ts` (NEW) + `scripts/_run_step2_all.sh` — dynamic customer-team list (so no team is missed).
- `scripts/run-twp-recompute.ts` (NEW) + `recomputeTwpStatus` dryRun; `pitcherProjection`/`transferPitcherProjection` HR9-only floor; edge-fn mirror.

---
# ★ CALCULATION REFERENCE — how every prod number is computed
Every formula quoted from code (branch feature/war-recalibration). Run env = D1 2026; **RPW (runs-per-win) = 13.1** across the WAR family. This is the "know what it's calculating before any runs" reference; each step above that produces a value points here.

## Cross-cutting constants (pin these)
- **RPW 13.1** — oWAR, pWAR, and composite d/bsr all ÷ it.
- **RUNS_PER_PA 0.3994** (= lgwOBA 0.3782 / wOBAscale 0.947); **REPLACEMENT_RUNS_PER_600PA 21.22** (1.62 wins/600); pitcher **replRA9 8.83**, **lgRA9 6.915 / 6.913**.
- **wRC+ denom 0.3782**; **cFIP 3.157**; **E2T (earned→total) 1.137**.
- **PITCHING_POWER_RATING_WEIGHT 0.7**; **PITCHING_DEV_FACTOR 0.06**.
- **$/WAR 25,000**; PTM SEC 4.0 → low-major 0.5 → JUCO 0.35.

## 1. WAR family (`src/savant/lib/war.ts`, `src/lib/{wrc,pitcherQuality,playerCalcs}.ts`)
- **wRC+** (`wrc.ts`, C1 2026-08-10): `est_wOBA = 0.011 + 0.691·OBP + 0.235·SLG`; `wRC+ = round(est_wOBA/0.3782·100)`. AVG/ISO weights 0. → `player_predictions.p_wrc_plus`, Hitter Master, `Conference Stats.WRC_plus`.
- **oWAR** (`computeOWarFromWrcPlus`): `raa = ((wRC+−100)/100)·PA·0.3994`; `replRuns = (PA/600)·21.22`; `oWAR = (raa+replRuns)/13.1` (PA default 260). → `player_predictions.o_war`.
- **pRV+** (`pitcherQuality.computePrvPlus`, D1-FIP index): `projFIP = 3.847 − 0.231·K9 + 0.509·BB9 + 1.486·HR9`; `projRA9 = projFIP·1.137`; `pRV+ = 100 + 100·(6.913−projRA9)/6.913` (LINEAR). → `p_rv_plus`.
- **pWAR**: `rpa = ((pRV+−100)/100)·(IP/9)·6.915`; `replRuns = (IP/9)·1.92`; `pWAR = (rpa+replRuns)/13.1`. → `p_war`.
- **dWAR/bsrWAR**: `d_war = drsRuns/13.1`, `bsr_war = wsbRuns/13.1` (no positional adj). `total = oWar+pWar+dWar+bsrWar`.

## 2. Composite / total hitter WAR (`20260810_composite_war_d1_rescale.sql` — supersedes 20260806's ÷10)
`refresh_composite_war()` bulk-updates `player_predictions`: `d_war = Σ drs_floor/13.1` over `player_season_defense (season=2026, position≠'P')`; `bsr_war = wsb_runs/13.1` (FULL season) from `player_season_baserunning`; `total_hitter_war = o_war + d_war + bsr_war`. Carries `statement_timeout=180000` + `IS DISTINCT FROM` guards. ⚠ 20260806 (÷10, wsb_runs_reg) is SUPERSEDED — the live divisor is 13.1, bsr source is full-season `wsb_runs`.

## 3. Pitcher projection (`src/lib/pitcherProjection.ts`, `transferPitcherProjection.ts`)
**Returner `projectPitchingRate`** (per rate): `rawZ = (prPlus−100)/prSd`; **directional SD** `dirSd = rawZ≥0 ? ncaaSd(good) : ncaaSdBad(bad)`; `zShift = rawZ·dirSd`; `powerAdjusted = lowerIsBetter ? ncaaAvg−zShift : ncaaAvg+zShift`; `blended = lastStat·0.3 + powerAdjusted·0.7`; `mult = lowerIsBetter ? (1−classAdj−dev·0.06) : (1+classAdj+dev·0.06)`; `projected = blended·mult`; **HR9-only floor** `Math.max(0,·)` (every other rate unfloored on purpose). Park NOT applied to returners. → `p_era/p_fip/p_whip/p_k9/p_bb9/p_hr9` → pRV+ → pWAR → market.
**Transfer**: `dsd(prPlus,sdGood,sdBad)=prPlus≥100?sdGood:sdBad`. `projectLower` (ERA/FIP/WHIP/BB9/HR9): `powerAdj=ncaaAvg−((prPlus−100)/prSd)·ncaaSd`; `blended=last·(1−pw)+powerAdj·pw`; `mult = 1 − confTerm + compTerm + parkTerm` where `confTerm=confW·((toPlus−fromPlus)/100)`, `compTerm=compW·((toTalent−fromTalent)/100)`, `parkTerm=parkW·((toPark−fromPark)/100)`; `adjustedMult=1+(mult−1)·damp` (WHIP damp 0.75); HR9-only floor. `projectHigher` (K9): `+` powerAdj, `mult=1+confTerm−compTerm`, no park, not floored.

## 4. Projection calibration — stage 5.5 (`scripts/compute-projection-calibration.ts`)
Qualified pop IP≥40. **Two-sided semi-deviation:** `sd_lo = sqrt(Σ_{v<mean}(v−mean)²/n_lo)`, `sd_hi` likewise; `sd_good = lowerBetter?sd_lo:sd_hi`, `sd_bad = lowerBetter?sd_hi:sd_lo`. **HR9-only shrinkage (variance decomposition):** `C = perNine?9·mean:mean`; `meanLuckVar = mean(C/IP)`; `talentVar = obsVar − meanLuckVar`; **`K = C/talentVar`**; `regressed = mean + (obs−mean)·IP/(IP+K)`. → `model_config` `<stat>_plus_ncaa_avg/_ncaa_sd/_ncaa_sd_bad` + `hr9_plus_shrink_k` (admin_ui, season 2026).

## 5. Power ratings (`src/lib/powerRatings.ts`, refit 2026-08-11). Sub-scores = CDF percentile 0–100; `toPlus(v)=(v/50)·100`.
**Hitter:** `baPower = 0.35·contact+0.20·lineDrive+0.30·avgEV+0.15·popUp`; `obpPower = 0.20·contact+0.10·lineDrive+0.15·avgEV+0.10·popUp+0.40·bb+0.05·chase`; `isoPower = 0.30·barrel+0.35·ev90+0.10·pullAir+0.25·gb`; `overall = 0.25·baPlus+0.40·obpPlus+0.35·isoPlus`. → Hitter Master `ba/obp/iso/overall_power_rating`.
**Pitcher pr_plus** (each `=(weightedAvgScore/50)·100`, Stuff+ scored vs mean 100/sd 3.968): ERA{whiff .25,bb .30,hh .15,chase .05,barrel .05,stuff .20}; WHIP{bb .30,whiff .45,stuff .25}; K9{whiff .35,stuff .30,izWhiff .25,chase .10}; BB9{bb .55,iz .30,chase .15}; HR9{barrel .15,hh .30,gb .30,pull .25}; FIP{hr9 .45,bb9 .30,k9 .25}; overall=(era+fip)/2. → Pitching Master `*_pr_plus`.

## 6. Stuff+ (`scripts/compute_pitch_log_stuff_plus.ts`)
Per pitch, z-score shape (velo, IVB, HB, extension, spin, rel_height) vs `pitcher_stuff_plus_ncaa` pop means/SDs per (pitch_type×hand); movement is VENUE-CORRECTED (`pitch_log_corrected.ivb_corrected/hb_corrected`, HB folded arm-side). Raw clamp [40,160]; per-bucket recenter so mean=100 (excl >140/<60). → `pitch_log.stuff_plus` → per-pitcher rollup → power-rating input.

## 7. Venue corrections (`scripts/compute_venue_corrections.ts`, `v1-2026-loo-eb`)
(1) LOO: `residual = pitcher_mean_at_venue − pitcher_mean_elsewhere`. (2) per venue (≥2 informing): `rawOffset = mean(residuals)`, `s²_v = Var(residuals)/n_v`. (3) EB: `τ² = max(0, Var(rawOffsets) − mean(s²_v))`; **`B_v = τ²/(τ²+s²_v)`**; `shrunk = B_v·rawOffset` (IVB & HB separately, τ≈0.63/0.66). Applied no-threshold: `corrected = raw − shrunk`. → `venue_movement_corrections` + view `pitch_log_corrected`.

## 8. dWAR / bsrWAR — dRS engine (`scripts/drs/`, `D1_2026_v1`, engine 0.11.0)
Constants from the 2026 D1 RE24 matrix: RUNS_PER_PLAY 1.045, RUNS_PER_SINGLE 0.964, RUNS_PER_DP 0.771, RUNS_PER_STRIKE 0.225, RUNS_PER_PBWP 0.320, RUNS_CS 0.583, RUNS_SB_COST 0.175. **8 components** (Range/Error/DP/Arm/Framing/Blocking/Throwing/Bunt) → `drs_total`; **`drs_floor` = Σ each component regressed** `value·n/(n+prior)` (priors range/error 350, dp 120, arm 90, frame/block 4000, throw/bunt 60). All but framing per-position centered. → `player_season_defense.drs_floor`.
**wSB:** `wsb_runs = Σ(SB·sbVal+CS·csVal) − Σ opps·lgExpPerOpp`; `wsb_runs_reg = wsb·opps/(opps+60)`. → `player_season_baserunning`.
**Descriptive WAR** (`populate_descriptive_war.mjs`/`_reg`): HITTER `wraa=((woba−lgwOBA)/wOBAscale)·PA`; `desc_owar = wraa/13.1 + (PA/600)·offense_replacement`; `d_war = Σ drs_floor(≠P)/13.1`; `bsr_war = wsb_runs/13.1`; `total_desc_war = sum`. PITCHER `desc_ra9 = 0.5·(RA9 + drs_behind_per9) + 0.5·(FIP·1.137)`; `desc_pwar = (replRA9 − desc_ra9)·IP/9/13.1`. → Hitter/Pitching Master `desc_*` (+ `_reg`).

## 9. Conference stats (`conf_stats_bucketA_assembly.sql`, `derive_conf_opr_htp.ts`)
**Bucket A** (intra-conf pitch_log, D1 2026): AVG=H/AB, OBP=(H+BB+HBP)/(AB+BB+HBP+SF), ISO=(2B+2·3B+3·HR)/AB, SLG=(H+2B+2·3B+3·HR)/AB; IP=(K/GO/FO/PO/LO/Sac/FC outs + 2·DP)/3; K9/BB9/HR9=·9/IP; WHIP=(BB+H)/IP; **FIP=(13·HR+3·(BB+HBP)−2·K)/IP+3.157**; ERA=ER·9/IP (ER = runs − '(UR)' runs); env+ = rate/ncaa_avg·100 (avg .2777/obp .3823/slg .4365/iso .1588); WRC_plus C1. → `Conference Stats` rates + *_plus.
**Bucket B**: `run_env_factor = avg(member rg_factor)`; `OPR = PA-avg Overall_Power_Rating`; **`HTP = OPR + 1.25·(Stuff+−100) + 0.75·(100−run_env_factor)`**. → `run_env_factor`, `offensive_power_rating`, `hitter_talent_plus`.

## 10. Market value (`src/lib/nilProgramSpecific.ts`, `twpMarketValue.ts`)
`market = WAR × $25,000 × PTM`, floored $0. **PTM** (per-conference exact-code, model_config `nil_tier_<code>`): SEC 4.0, ACC 1.5, Big12 1.2, BigTen 1.0, Independent 1.0, strong-mid (AAC/SunBelt/BigWest/MWC) 0.8, low-major 0.5, JUCO 0.35. Position mult (pricing layer): C/SS/CF 1.3, IF+corner 1.1, 1B/DH/UT 1.0, bench 0.8. TWP: `market_value` NULL, split into `twp_hitter_market_value`/`twp_pitcher_market_value`. → `player_predictions.market_value` (+ twp_* for TWP).

---
# ★ SCHEMA / SQL CHANGE REFERENCE — what every migration touches + how
101 added SQL files (89 migrations + 25 scripts/sql). **[FND]** = foundational, likely already on prod (June pitch_log base, July GM). **[WAR]** = the Aug WAR-recalibration push. **[!!]** = NON-idempotent or must-regenerate-on-prod.

## A. Pitch-log base + aggregation (June 20260619–20260630) [FND]
DDL idempotent; ALL row data (flags, stuff_plus, reclass, aggregates, xBA, spray/zone, ev90) is script-computed → regenerate on prod after schema.
- `20260619120000_pitch_log_base_table` — CREATE `pitch_log` (PK uniq_pitch_id). GENERATED: `has_velo = release_velocity IS NOT NULL`; **`is_data = release_velocity NOT NULL AND ivb NOT NULL AND hb NOT NULL`** (this is the venue-producer's `is_data` filter).
- `20260619140000_computed_columns` — is_foul/in_zone/strike/swing/whiff/chase/in_play/batted_ball, pitch_result_category, pitch_type_reclassified, stuff_plus. `is_in_zone = cs_prob>=0.50`; `is_chase = is_swing AND NOT is_in_zone`.
- `20260620120000_aggregations` — CREATE pitch_log_{pitcher_totals, pitcher_by_pitch_type, hitter_totals}. `20260620140000_helper_functions` — `exec_sql(text)` (SECURITY DEFINER, service-role only) + `bulk_update_pitch_log_stuff_plus`.
- `20260623120000_xba_lookup` [!!] — `pitch_log_xba_lookup` (ev_bin,la_bin → p_hit/expected_bases/expected_woba; woba wts 1B .882/2B 1.254/3B 1.586/HR 2.041).
- Others: total_out_of_zone (Chase/Zone denom), agg_columns_full (~20 QoC/xwoba cols), location_spray (spray_ang/distance/x_avg/x_slg/x_woba), pitcher_by_pitch_type_rv (RV inputs), k_split, pull_air_la_ev90 (`ev_90`=90th-pctile EV), by_zone (13-zone), `parks` dimensions (geometry), hitter_ball_flight_rv.
- ⚠ bare `CREATE POLICY` (no guard, errors on re-run): 20260622120000, 20260622140000, 20260623120000. `20260630_player_slot_values_uniq` [!!] destructive DELETE-dedup.

## B. GM front-office interface (July 202607*) [FND]
~46 migrations, almost all idempotent (IF NOT EXISTS / DROP POLICY+CREATE). Uniform RLS `has_role(superadmin) OR is_team_member(customer_team_id)`. No in-SQL math (marketability/scholarship/allocation is app-side; migrations add input columns only). New tables: gm_player_finance, gm_budget, gm_recruits(+events/reports), gm_player_notes, gm_activity, gm_allocation(_source), gm_contract(_obligation), gm_player_info, gm_program_marketability, gm_vendor, gm_scout_template, player_external_ids + `gm-contracts` storage bucket.
- ⚠ **`20260710120000_gm_allocations_per_build` [!!] — unconditional `TRUNCATE gm_allocation, gm_allocation_source`** — destructive on prod if populated; verify empty first.
- `20260724120000_target_board_twp_two_row` — drops all target_board unique constraints, new UNIQUE(user_id,customer_team_id,player_id,coalesce(position_slot,'')) — enables TWP two-row. `20260724130000_neutral_snapshot` — team_build_players/target_board `.neutral_snapshot` jsonb.
- `20260728121000_resolve_or_create_prospect` — SECURITY DEFINER prospect-minting fn; `20260728120000` allows `players.data_status='prospect'`.

## C. WAR-recalibration migrations (Aug 20260805–20260823) [WAR]
- `20260805_player_season_defense_baserunning` — CREATE `player_season_defense` (`drs_floor`=regressed→dWAR) + `player_season_baserunning` (`wsb_runs`/`wsb_runs_reg`→bsrWAR). Empty until `load-drs-wsb-staging.ts`. No RLS (league-wide).
- `20260806_composite_war_and_refresh` [!!] — `RENAME total_war→total_hitter_war` (**run once, no guard**) + defines & FIRES `refresh_composite_war()` at **÷10** (superseded).
- `20260810_composite_war_d1_rescale` [!!] — CREATE OR REPLACE `refresh_composite_war()` at **÷13.1**, full-season `wsb_runs`, **DEFINITION ONLY** (does not fire on paste). ⚠ Fire only in Phase F AFTER o_war re-precompute (else mixes 10-scaled o_war with 13.1 d/bsr).
- `20260806_pitch_log_widen_attribution` — ~25 DRS attribution cols (atbat_desc, fielders, base runners, catcher metrics, `runs`). Backfilled additively from clean DRS CSV by uniq_pitch_id. **The dedup gate (`runs IS NULL` junk) depends on this.**
- `20260818000000_park_code` (`park_code`=game_string − trailing 9 digits − `cs-`), `20260818010000_is_conference_game`, `20260808_add_sequence`.
- `20260819000000_team_season_stats` — CREATE (PK source_id,season; 117 cols; RLS enabled, ZERO policies→service-role). ⚠ **OMITS 10 cols the refresh fn writes.**
- `20260821010000_team_season_stats_war_columns` [WAR PREREQ] — ADD hitter_war/rotation_pwar/bullpen_pwar/ra9/fip_ra9 (_reg+_total). ★ **MUST apply BEFORE first `refresh_team_season_stats(2026)` or the DELETE-rebuild aborts → empty table.**
- `20260819010000_refresh_team_season_stats` [!!] — CREATE OR REPLACE the DELETE-then-rebuild fn; must be EXECUTED on prod (`select refresh_team_season_stats(2026);`) LAST. team WAR=Σ Master desc_*; rotation=top-3 IP; records via game_string (DH-safe); IP=Σ(max(outs)+1)/3.
- `20260821000000_conf_pitcher_env_plus` — Conference Stats era_plus…hr9_plus (ratio (conf/ncaa)·100).
- `20260823000000_player_predictions_rls_team_scope` [!!] — DROP `USING(true)` + CREATE team-scoped SELECT policy (`customer_team_id IS NULL OR superadmin OR is_team_member`).

## D. WAR scripts/sql [WAR]
- **model_config:** `step8_model_config_2026` (201-key UPSERT, authoritative) · `wrc_c1_model_config` (⚠ sets `owar_replacement_runs_per_600=26.2` — CONFLICTS with step8's **21.22**; run step8 LAST) · `pitcher_c1_model_config` (reference) · `seed_nil_tiers_model_config` (DELETE nil_tier_% + per-conf PTM; before re-price).
- **descriptive_war_columns / _reg_columns** — Master `desc_*` (+`_reg`) DDL (idempotent, copyable).
- **team_season_stats populate:** `_war_rollup` [!!] INSERT-no-ON-CONFLICT (**dupes on re-run** — the refresh fn supersedes it) · `_rates` (Master IP/PA-weighted) · `_rates_pitchlog` [!!] (hitting from pitch_log) · `_records` [!!] · `_faced_park` [!!] (faced_* from pitch_log; park snapshot from "Park Factors") · `_migrate_snapshot_conf` (joins team_war_snapshots + Conference Stats; NOT stale oWAR).
- **team_drs_store** — `team_war_snapshots.team_drs` from ~308 inline literals (safe to copy staging→prod).
- **conf_stats_bucketA_assembly** [!!] (regenerate; formulas in Calculation Reference §9) · `conf_stats_unified_assembly` = SUPERSEDED scratch, **do NOT run**.
- **park:** `park_from_pitchlog_2026`/`park_home_2026` [!!] builds; `park_gate*`/`park_rg_hr` read-only validation.
- **pitch_log derivations:** `derive_pitch_log_pitch_zone` [!!], `derive_pitch_log_spray_labels` [!!]; `pitch_log_backfill_steps` + `pitch_log_sequence_backfill_steps` run-books (destructive dedup + constraint).

## ★ PROD LANDMINES from the schema audit (add to the master landmine list)
- **NON-IDEMPOTENT (error/duplicate on re-run):** bare CREATE POLICY (20260622120000/140000, 20260623120000); `RENAME total_war` (20260806); `create policy player_predictions_select_team_scoped` (safe only with its paired DROP); **TRUNCATE gm_allocation/_source** (20260710120000); `team_season_stats_war_rollup` INSERT (no ON CONFLICT → dupes); `player_slot_values` dedup DELETE.
- **CONFLICT (resolved):** `wrc_c1_model_config.sql` carries the STALE `owar_replacement_runs_per_600 = 26.2`; `step8_model_config_2026.sql` has the correct **21.22** (= 1.62 replacement-wins × 13.1 RPW, derived from the .380 win% anchor). **Resolution: on prod run ONLY `step8` (authoritative, 201-key); do NOT run `wrc_c1_model_config`.** Staging is already 21.22 (verified 2026-08-26). 21.22 must be set BEFORE the oWAR precomputes. (Future: fold the replacement-level derivation into a calibration stage so it re-derives each season instead of being a seeded constant.)
- **ORDER:** `20260821010000` (ts war cols) BEFORE first `refresh_team_season_stats(2026)`; `seed_nil_tiers` before re-price; `refresh_composite_war()` FIRE (÷13.1) only after o_war re-precompute.

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
🛑 **CORRECTION 2026-08-30 (late) — MY EARLIER "just paste `scripts/sql/team_drs_store.sql`" INSTRUCTION WAS WRONG AND IS REVERTED.** I was only supposed to reorder the steps, not change WHAT they do. The documented process — which predates this session and stands — is to **REGENERATE the value on prod, never copy it**:
- `AGENT_LEARNINGS_stuff_plus_2026_08_16.md:802-803`: *"regenerate team_drs via `scripts/drs/derive_team_drs.mjs` if needed. **PROD: run against PROD `team_war_snapshots`**"*
- `PROD_PUSH_BULLETPROOF_CHECKLIST.md` row **D2**: *"Run team_drs producer against prod … (FIX: add `--prod` + env guard)"*, gate **308 D1 rows sum ~0**
- `AGENT_LEARNINGS:859,:869` list **`team_drs_store.sql` under "script writers to RETIRE"** — it is a FROZEN SNAPSHOT of a computation, not the computation. Pasting it into prod is exactly the copy-instead-of-derive the project rule forbids ([[feedback_derive_over_copy]]).
**WHAT `derive_team_drs.mjs` ACTUALLY COMPUTES** (`:1-9`, B-R method): per-team `Σ drs_floor` from `player_season_defense`, grouped to a team via the Masters' `TeamID`, then **innings-weighted centering per division** — `team_drs = Σdrs_floor(team) − (division Σdrs_floor / division ΣIP) × team_IP`, so `dRS_behind(pitcher) = team_drs × pitcher_IP / team_IP` and Σ over all pitchers = 0 exactly.
**THE FIX THE DOCS CALL FOR (code, not data):** `:13` reads `./.env.local` only — no `SUPABASE_URL` fallback, no `--prod`. Add the standard double-keyed guard. ⚠ It also has **three unordered `.range()` loops** (`:15`, `:17`, `:22`) which on prod page over the Masters (30,025 rows ≈ 31 pages) and `player_season_defense` (13,454 ≈ 14 pages) — dropped rows silently understate a team's `Σ drs_floor`. Both must be fixed before the prod run.
⚠ **OPEN, NOT RESOLVED:** a read-only check on 2026-08-30 found prod's own data and staging's stored values agree for 303/308 teams (mean |Δ| 0.124) but differ on **Arkansas: 32.800 vs 41.060 (Δ −8.26)**. Which is correct is **UNDETERMINED** — prod resolves more players than staging (31,467 vs 15,561), so prod may well be the better sum. **Do not reconcile prod TO staging.** Run the producer on prod, sum per player under the team, and then investigate the difference on its own merits.

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
D29b (NEW)  DERIVE team_drs ON PROD — the documented producer, NOT a paste.
            (a) add the double-keyed --prod guard + ordered pagination to scripts/drs/derive_team_drs.mjs
            (b) alter table team_war_snapshots add column if not exists team_drs numeric;   (DDL only)
            (c) run the producer against PROD; it prints the storage SQL for its OWN derived values
            GATE: 308 D1 rows, Σ centered = 0 per division (the script asserts this itself), then
                  select count(*) filter (where team_drs is not null), round(sum(team_drs)::numeric,2)
                  from team_war_snapshots where season=2026;
            ⛔ do NOT paste scripts/sql/team_drs_store.sql — it holds STAGING's frozen values and is
               listed for retirement. Then tick PROD_MIGRATIONS_TODO.md:234.
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
D33         ⛔ FOLDED INTO D29b — this IS the team_drs producer (`derive_team_drs.mjs`), so by DATA
            ORDER it must run BEFORE D31 (which reads `team_war_snapshots.team_drs`), not last.
            My earlier "SKIP — CSV only" note was wrong in substance: the CSV is a by-product, and the
            script also PRINTS the team_war_snapshots storage SQL (`:8`). It needs the --prod guard and
            the 3 unordered .range() loops fixed first.
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

---
# 🔬 ORDER AUDIT — TOPIC vs DATA DEPENDENCY → `docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md`
**The phase order in this document is organized by TOPIC (schema / config / producers / defense / precomputes /
re-bakes), NOT by what-feeds-what. A full read/write graph audit of every remaining step found TWO STRUCTURAL DEFECTS:**
1. 🔴 **PHASE E READS A TABLE PHASE F CREATES.** `precompute-transfer-projections.ts:225` and `precompute-pitchers.ts:279`
   read `team_season_stats.faced_stuff_plus` / `.faced_htp`, whose ONLY producer is **F44**, the LAST step of Phase F.
   Prod's table is **0 rows**. The read **discards `error` and coerces to `[]`**, so the faced-competition adjustment
   for Independent programs **silently does not apply** — the only trace is a log line reading `0 … rows`.
   The docs gate **G46** on this table but never carried that gate back to E38. **→ F44 MUST MOVE BEFORE PHASE E.**
   ✅ No cycle: `refresh_team_season_stats` does NOT read `player_predictions` (grep = 0), so a clean total order exists.
2. 🔴 **A REQUIRED STEP IS IN NO RUNBOOK.** `refresh_team_season_stats.sql:143` divides by `sum(regular_season_ip)`,
   which is **0/5,375 on prod** ⇒ `nullif(...,0)` → **NULL** ⇒ every regular-season rate in `team_season_stats` lands
   NULL, silently. Producer = `scripts/lock-season-cli.ts` ("Lock Regular Season 2026"), which appears as a numbered
   step **nowhere**. **→ ADD AS `D33b`, before F44.**
**CORRECTED ORDER (derived from the graph, not the topic):**
`D29b → D30 → D31 → D32 → ★D33b lock-season → E2 → ★re-run derive_conf_opr_htp → ★F44 → E35 → E36 → E37 → E38 →
F39 → F40 → F41 → F42 → F42b → F43 → G46`
**Edges the topic order got RIGHT (do not churn):** F39-after-E · F40→F41→F42 · E35-before-precomputes · C27→C26→C28 ·
G46 last. Full evidence, per-step reads/writes, and the three Track B requirements are in the audit doc.

---
# 🔬 ORDER AUDIT PART 2 — PHASES A, B, C (THE WORK ALREADY DONE). Was any of it run out of order, or since invalidated?
Trevor: *"you audited everything we already did as well included in that correct?"* — **Initially NO. Now yes.**
Part 1 audited only the REMAINING steps. This part runs the same read/write graph over the COMPLETED work and asks the
question that actually matters: **is anything we already ran now STALE because of something else we ran after it, or
something we are about to run?** Verified against prod, not reasoned.

## ✅ RESULT: EVERY COMPLETED STEP IS STILL VALID. Nothing already run needs redoing. Two near-misses, both clean.
| edge | verified | verdict |
|---|---|---|
| chain 1→2 | `derive_stuff_plus_pop_baseline` reads `_reclass_pf` + `pitch_log_corrected` (reclassifier outputs) | ✅ correct order |
| chain 2→3 | `compute_pitch_log_stuff_plus` reads `pitcher_stuff_plus_ncaa` (chain 2) | ✅ |
| chain 3→4 | aggregation reads scored `pitch_log` | ✅ |
| chain 4→**C27** | `computeNcaaAverages:347` reads **`pitch_log_pitcher_totals`** and weights Stuff+ by `stuff_plus_data_pitches` (`:24-26` — the LIVE pitch_log lane, explicitly NOT the legacy PSP-I) | ✅ correct lane AND correct order |
| C24→C28-4 | Conference Stuff+ = `Σ(Pitching Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)` — needs C24's `trackman_pitches` AND the chain-5 `stuff_plus` | ✅ both were run first |
| C27→C26 | `computeAndStoreScores` reads `ncaa_averages`, silently defaults if absent | ✅ C27 ran first (this was CORRECTED earlier this push) |
| C29→C28 | both C28 producers filter on `division` | ✅ C29 ran first |
| C26→C28-2 | `compute_conf_pitcher_env_plus` reads `"Pitching Master"` + `ncaa_averages` | ✅ |
| C27→C28b | `conferenceScoutingAverages` reads `ncaa_averages`, errors loudly if missing | ✅ |

## ✅ NEAR-MISS 1 — **PHASE D DOES NOT INVALIDATE PHASE C.** (Checked because it easily could have.)
If `computeNcaaAverages` (C27) or `computeAndStoreScores` (C26) read any `desc_*` / WAR column, then Phase D writing
those columns would make C26/C27 stale and force a re-run of the whole back half of Phase C.
**Grepped both for `desc_owar|desc_pwar|d_war|bsr_war|total_desc_war|drs_behind|regular_season_*`: ZERO hits.**
→ **Phase D and Phase C touch DISJOINT Master columns. No re-run needed.** ✅

## ✅ NEAR-MISS 2 — **D31 DOES NOT CLOBBER C26's POWER RATINGS.** (The dangerous shape would be a full-row upsert.)
`populate_descriptive_war.mjs:156` is **`.update(cols).eq("source_player_id",…).eq("Season",…)`** — a **PARTIAL column
UPDATE**, not `.upsert()` of a whole row. It writes only its own `desc_*` columns and leaves C26's
`ba/obp/iso_power_rating`, `pRV+`, `era⁺…` untouched. ✅
⚠ **BUT NOTE ITS ERROR HANDLING:** `:157` is `if (error) { console.error(…) }` — errors are **printed, not counted,
and not fatal**, inside a 10,715-update loop that then **exits 0**. Another "validate by CONTENT, not exit code" case.
**Gate D31 on the non-null counts, never on the exit code.**

## ✅ NEAR-MISS 3 — **C27 DID NOT OVERWRITE PHASE B's TUNED CONFIG.** (C27 upserts `model_config`, so this was real.)
`computeNcaaAverages:428` upserts `model_config` `onConflict: model_type,season,config_key` — it would silently
overwrite any Phase-B key it shares. **Verified on prod AFTER C27 ran:** `nil_tier_sec = 4.0` ✅ ·
`r_obp_std_pr = 31.89504` ✅ · **220 keys** (unchanged) ✅ · **6** `_sd_good`/`_sd_bad` keys with **0** still reset to 0 ✅.
C27's keys (`p_ncaa_avg_*` / `p_sd_*`, e.g. `p_ncaa_avg_stuff_plus = 100.0141`) are **DISJOINT** from Phase B's tuned
weights. **Phase B survived C27 intact.** ✅

## 🛑 DEFECT FOUND IN THE ALREADY-DONE WORK — THE VERIFICATION GATE ITSELF USES KEY NAMES THAT DO NOT EXIST
The documented Phase-B gate reads `obp_std_pr=31.89504, whip_pr_sd=37.19844, owar_repl_600`. **None of those key names
exist on prod.** The gate query returns **ZERO ROWS** — and a zero-row result reads as *"the config is missing"*, which
would send the next person chasing a non-existent Phase-B failure.
**REAL KEY NAMES (verified on prod, values all CORRECT):**
`r_obp_std_pr` = **31.89504** · `t_obp_std_pr` = **31.89504** · `p_whip_pr_sd` = **37.19844** ·
`owar_replacement_runs_per_600` = **21.22** · `pwar_replacement_runs_per_9` = **1.92** · `nil_tier_sec` = **4.0**.
✅ **Corrected INLINE** at the gate in `PROD_PUSH_STEPS` and at RUNBOOK rows 1–2 (which additionally carried the
superseded VALUES 37.13 / 32.41).

## 🧠 THE PATTERN ACROSS BOTH AUDIT PARTS
Part 1 (remaining steps) found **2 structural defects**. Part 2 (completed steps) found **0 invalidations but 1 broken
gate** — the verification query itself was wrong, which is the most expensive kind of error because it makes correct
work *look* broken and broken work *look* fine.
→ **Audit the GATES with the same rigour as the steps.** A gate that cannot fail, or cannot pass, is not a gate.

---
# 🔴 PROD DATA GAP FOUND VIA team_drs — **CAMDEN KOZEAL (Arkansas) IS MISSING FROM PROD'S 2026 HITTER MASTER**
**CONFIRMED BY TREVOR 2026-08-30: Kozeal is a real player.** This is a genuine prod defect, not a reconciliation artifact.

## HOW IT SURFACED (the detector was not the defect)
Prod-derived `team_drs` disagreed with staging's stored value on exactly one team — **Arkansas 32.800 vs 41.060
(Δ −8.26)** — while 303/308 teams agreed within 0.5. Chasing it down:
1. **Per-player dRS is IDENTICAL across environments.** `player_season_defense` 2026: prod 13,454 / staging 13,454,
   both `drs-engine-0.11.0`; matched on `(source_player_id, position)` → **13,453 in both, 13,453 identical, ZERO
   different.** The engine output is env-independent (loaded from the same CSVs, per `PROD_PUSH_STEPS:316-317`), so
   **dRS drift is RULED OUT.**
2. **Arkansas roll-up:** prod **41** defense rows Σ **35.255** · staging **43** rows Σ **43.757**. Prod loses 2 rows.
3. **Both rows are ONE player — `source_player_id` 1925267789: SS 7.959 + 2B 0.543 = 8.502 runs.** That is the whole Δ.

## THE DEFECT
| | |
|---|---|
| STAGING `"Hitter Master"` 2026 | `Camden Kozeal` · Team **Arkansas** · **pa 289** · D1 |
| **PROD `"Hitter Master"` 2026** | **ABSENT** |
| PROD `"Pitching Master"` 2026 | absent |
| PROD `players` | **row EXISTS** — `Cam Kozeal` · 1B · **`team` = NULL** · D1 · NOT IN PORTAL |
| STAGING `players` | `Camden Kozeal` · 1B · team `Arkansas` |
Prod **knows the player** (same `source_player_id`) but stores him as "**Cam**" with a **NULL team**, and has **no 2026
Master stat row**. His dRS rows sit in prod's `player_season_defense` with nothing to join them to.
⚠ Note the name form differs (**Cam** vs **Camden**) and prod's `team` is NULL — consistent with
[[project_players_team_id_null]] (prod carries ~15,706 team-less stubs). **If the Master import resolves on NAME
anywhere rather than `source_player_id`, that is the root cause and is far broader than one player**
([[feedback_id_over_name]]). NOT yet investigated — do not assume.

## SCOPE — SMALL AND BOUNDED (this is NOT a systemic Masters gap)
2026 **D1** Master id sets: **prod 10,406 · staging 10,408** · in staging not prod **4** · in prod not staging **2**.
Of the 4 staging-only ids only two carry defense: **Camden Kozeal 8.502** and **LJ Layhew (Rice, 1 PA) 0.002** —
**total prod loses 8.50 runs, essentially all Kozeal.**

## BLAST RADIUS ON PROD (everything below is currently wrong or missing for this player)
- **no `desc_owar` / `d_war` / `bsr_war` / `total_desc_war`** — D31 iterates the Masters, so he is simply not computed
- **no power ratings, no projection, no market value, no NIL** — every producer keys off a Master row
- **Arkansas `team_drs` understated by 8.26** ⇒ every Arkansas pitcher's `drs_behind` is wrong
  (`drs_behind = team_drs × IP/team_IP`) ⇒ wrong `desc_ra9` / `desc_pwar` for the whole staff
- **Arkansas team WAR roll-ups** (`team_war_snapshots`, later `team_season_stats`) understated
- ⚠ **Arkansas is one of the 14 ACTIVE customer teams.**

## ★ WHY NO GATE WOULD HAVE CAUGHT THIS
Prod has **5,340** D1 hitters and every count check passes on 5,340. A missing row is invisible to a count — you can
only see it by **diffing the id SET against a reference**, which nothing in the runbook does.
→ **ADD A MEMBERSHIP GATE, not just a count gate:** diff 2026 Master `source_player_id` sets prod-vs-staging (or vs the
source CSV) and require the difference to be explained by name, never merely small. Same lesson as the C28
`Stuff_plus` catch: **populated ≠ correct**, and now **count-correct ≠ complete**.

## ⬜ OPEN — NOT FIXED, NEEDS TREVOR'S CALL
1. How the missing Master row gets added (Masters are TruMedia CSV imports → [[feedback_csv_import_prod_direct]]
   `npm run import:prod`; a hand-INSERT is NOT the documented path).
2. Whether the Master import matches on name anywhere (the Cam/Camden + NULL-team signal) — root-cause question.
3. Whether Phase D proceeds now and Kozeal is patched after, or the gap is closed first.
⛔ **DO NOT "fix" this by copying the row from staging** — same copy-instead-of-derive error as the team_drs paste.

---
# 🅱️ TRACK B REQUIREMENT — MASTER ROWS MUST BE CREATED FROM THE PITCH LOG, INDEPENDENT OF RETURNER STATUS
**Status: NOT DONE. Deliberately SKIPPED during the 2026-08-30 prod push (Trevor) — must be handled by Track B in the
full upload.** Do not fix by hand; do not copy the row from staging.

## THE RULE (Trevor, 2026-08-30)
> *"He's not a returner in 2027 but should be in there based on the process."*
**A player's presence in the season's Master is determined by whether he PLAYED that season — i.e. by his pitch-log
record — NEVER by whether he returns the following season.** The Master is the **descriptive record of 2026**.
Returner/transfer status is a *projection-side* concept (season 2027) and must have **zero** influence on whether a
2026 Master row exists. Any stage that skips creating a Master row because a player is not a returner is WRONG.

## THE CONCRETE CASE THAT EXPOSED IT — Camden Kozeal (Arkansas)
Found only because prod-derived `team_drs` disagreed with staging on exactly one team. Full detail in the
"PROD DATA GAP" block; the short version:
| | |
|---|---|
| PROD `pitch_log` 2026 | **1,103 pitches** |
| PROD `pitch_log_hitter_totals` (`all`) | **PA 287 · AB 243 · 20 HR · 36 BB · 54 K · 193 BIP · 59 barrels** |
| PROD `"Hitter Master"` 2026 | ❌ **NO ROW** |
| PROD `players` | exists as `Cam Kozeal`, **`team` = NULL** |
| STAGING `"Hitter Master"` 2026 | ✅ `Camden Kozeal` · Arkansas · pa 289 |
A full everyday season with 20 HR, on an **active customer team**, with **no Master row on prod** — therefore no
`desc_owar` / `d_war` / `total_desc_war`, no power ratings, no projection, no market value, and 8.5 runs of his
defense orphaned out of Arkansas's `team_drs`.

## ★ SCOPE IS MEASURED AND TIGHT — he is the ONLY real one
| 2026 hitter orphans (pitch-log totals, no Master row) | PROD | STAGING |
|---|---|---|
| all | 763 | 759 |
| **PA ≥ 50** | **1 (Kozeal, 287 PA)** | **0** |
| PA ≥ 150 | 1 | 0 |
The other ~762 orphans top out at **18 PA** and staging has 759 of the same — that is normal Master-inclusion
background, **NOT** a defect. Pitchers: 135 prod orphans, same character.
→ 🛑 **CORRECTED 2026-08-30: this warning was WRONG.** `--create-new` is ALREADY scoped — `MIN_PA` default **25** (`:74`) plus a **D1 gate** (`:473`). Of the 763 candidates on prod exactly **ONE** clears PA≥25 (Kozeal, 287); the rest top out at 18 PA. The threshold question is answered by the committed code: **25 PA / 20 BF**.

## WHAT TRACK B MUST DO (stage 5, the Masters rollup)
`scripts/derive_masters_from_pitchlog.ts` already builds Master rows from `pitch_log_*_totals` and already has the
`--create-new` flag (default OFF, per the standing rule "never create Master rows implicitly"). Track B must:
1. **Create missing Master rows from the pitch log** as part of the normal upload — gated by the **Master's own
   inclusion threshold** (a PA/IP qualifier), **NOT** by returner status, roster status, or portal status.
2. **Establish what that threshold actually is** before enabling creation — it is currently UNDETERMINED. The data
   says any cutoff between ~20 and ~250 PA isolates Kozeal from the background, but a hand-picked number is not an
   answer: find the rule the Master import itself uses and mirror it. ⬜ **OPEN QUESTION.**
3. Preserve the existing safety: never create rows implicitly/silently; log every row created, with name + PA/IP.
4. **Run BEFORE anything that iterates the Masters** — descriptive WAR, `team_drs`, power ratings, `computeNcaaAverages`,
   `refresh_team_season_stats`. A row created after those have run is a row that is missing from all of them.

## ★ THE GATE THIS NEEDS (a COUNT GATE CANNOT SEE THIS)
Prod has 5,340 D1 hitters and **every count check passes on 5,340** — a missing row is invisible to a count.
**MEMBERSHIP GATE, per season, after the Masters rollup:**
```sql
-- must return 0 rows; anything here PLAYED but has no Master record
select plt.batter_id, plt.pa from pitch_log_hitter_totals plt
where plt.season = :season and plt.dimension_key = 'all' and plt.pa >= :qualifier
  and not exists (select 1 from "Hitter Master" hm where hm."Season" = :season and hm.source_player_id = plt.batter_id);
```
(and the `pitch_log_pitcher_totals` / `"Pitching Master"` equivalent by IP).
**Require it to be EMPTY, or every exception explained BY NAME — never merely "small".** This is the third distinct
shape of the same lesson: *populated ≠ fresh* (Conference Stuff+), *populated ≠ right lane* (`trackman_pitches`), and
now ***count-correct ≠ complete***.

---
# 🔬 INVESTIGATION — THE MASTER NEW-ROW PATH (`derive_masters_from_pitchlog.ts --create-new`). TRACK B DEPENDS ON THIS.
Chasing why prod is missing Camden Kozeal's 2026 Hitter Master row turned into an audit of the **new-row creation
path itself** — the mechanism Track B must use on every upload. Everything below is VERIFIED on prod, read-only.

## ✅ CORRECTION TO MY OWN EARLIER WARNING — `--create-new` IS ALREADY CORRECTLY SCOPED
I previously wrote that `--create-new` "would create ~763 rows, 762 of which should not exist." **THAT WAS WRONG.**
The producer already gates new rows on **two** filters (`:469`, `:473`):
- **`MIN_PA` — default 25**, overridable via `--min-pa <n>` (`:74`, `:39`). Pitchers: `MIN_BF` default 20.
- **D1 gate** — `if (!team || team.division !== "D1") skip`.
Measured on prod: of **763** hitter new-row candidates, exactly **ONE** clears PA ≥ 25 — **Kozeal (287 PA)**. The other
762 top out at **18 PA**. So the flag self-scopes correctly and the threshold question I logged as OPEN is **ANSWERED
BY THE COMMITTED CODE: 25 PA / 20 BF.**

## ✅ THE ROW CAN BE DERIVED ENTIRELY FROM PROD — NO COPY FROM STAGING NEEDED
Verified prod's own pitch log reproduces staging's Master values **exactly**:
`AVG (38+18+2+20)/243 = .321` · `OBP (78+36+4)/287 = .411` · `SLG 160/243 = .658` — staging Master: **.321 / .411 / .658**.
And the identity resolves from prod alone: `pitch_log.batting_team_id = '3375'` → `"Teams Table"` (Season-filtered) →
`University of Arkansas · SEC · D1 · id 5679ed85-…`; name from `players`; hand from the pitch log (`batter_hand = L`).
★ **What a new Master row actually needs is NARROW.** Staging's Kozeal row has 60 populated columns, but the 11
`*_score` fields, the 4 power ratings, and the whole `desc_*`/`woba`/`wraa` block (+ `_reg`) are **DOWNSTREAM OUTPUTS**
of C26 and Phase D — they compute themselves once the row exists. (Proof: prod's reference Arkansas hitter has only
**45** populated columns, precisely because Phase D has not run there.) Only identity + slash line + the batted-ball /
discipline block must be seeded, and all of it is pitch-log-derived anyway.
⛔ **So there is NO justification for copying the row from staging** ([[feedback_derive_over_copy]]).

## 🔴 UNRESOLVED CONTRADICTION — EVERY GATE PASSES, YET THE RUN REPORTED 0 NEW ROWS
Gate-by-gate trace for `source_player_id 1925267789` against PROD (each verified individually):
| gate | result |
|---|---|
| in `pitch_log_hitter_totals` (season 2026, `dimension_key='all'`) | ✅ YES, `pa = 287` |
| already has a 2026 `"Hitter Master"` row (→ would exclude) | ✅ NO — he IS a candidate |
| representative `pitch_log` row (`repRows`, `:444`) | ✅ `batting_team_id='3375'`, `C. Kozeal`, hand `L` |
| `teamBySource.get('3375')` (Teams Table, Season-filtered) | ✅ Arkansas, SEC, **D1**, Season 2026 |
| `MIN_PA` ≥ 25 | ✅ 287 |
**And a faithful replica of `buildNewRows`' candidate selection — same ordered pagination, same filters — returns:**
```
hmAll (Hitter Master 2026): 8244 rows → 8244 distinct   contains Kozeal? NO  ← candidate
hitterTotals:               6099 rows → 6099 distinct   contains Kozeal? YES pa=287
newHitterIds: 763           includes Kozeal? YES
  of those PA>=25: 1  → ["1925267789"]
```
→ **The producer SHOULD create exactly one row: his. The dry-run reported `0 hitters, 0 pitchers` and
`(skipped — non-D1 team / unresolved identity / below sample gate: 898)`.**
⚠ The captured output was **missing its header** (began mid-table, no env banner, no "Pitch-log totals: N hitters"
line), so the 0 may have come from a truncated or stale capture. **RE-RUN WITH A CLEAN FULL CAPTURE BEFORE CONCLUDING.**
**DO NOT resolve this by assumption. It is either (a) a capture artifact, or (b) a real silent failure in the new-row
path — and (b) would be a TRACK B BLOCKER, because a daily automated upload would silently never create anyone.**

## ⚠ SIDE-FINDING — STAGING'S KOZEAL ROW POINTS AT THE **2025** TeamID
Both envs carry two Arkansas `"Teams Table"` rows: `47acae04-…` (Season **2025**) and `5679ed85-…` (Season **2026**).
Staging's 2026 Kozeal Master row has `TeamID = 47acae04-…` — **the 2025 row.** The producer resolves Season-filtered
and would write `5679ed85-…`. Harmless for `team_drs` (both map to `source_id 3375`), but it means **staging's Master
`TeamID` values are not uniformly season-correct** — worth a separate check before anything joins on `TeamID` across
seasons. NOT investigated.

## 🅱️ WHAT TRACK B MUST TAKE FROM THIS
1. **Use the committed producer with `--create-new` and its existing PA/BF + D1 gates.** Do not hand-build rows, do not
   copy across environments, do not invent a threshold — 25 PA / 20 BF is the committed answer.
2. **New-row creation MUST run before anything that iterates the Masters** (descriptive WAR, `team_drs`, power ratings,
   `computeNcaaAverages`, `refresh_team_season_stats`). A row created afterwards is missing from all of them.
3. **`--create-new` needs its own VALUE gate**, because "0 rows created" is indistinguishable from "nothing to create":
   after the stage, re-run the membership query and require it to be EMPTY. See the MEMBERSHIP GATE block.
4. **Never trust a background/truncated log.** Validate by re-querying the DB, or by a full captured run — this
   investigation was nearly concluded off a header-less capture. Same rule as "validate by CONTENT, not exit code."
