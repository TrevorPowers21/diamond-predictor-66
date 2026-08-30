# PROD PUSH — DEFINITIVE STEP-BY-STEP (2026-08-26)
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
    so `d_war` stays NULL for those players through D31/D32 and F39. **Add `.order("id", { ascending: true })` to
    `fetchAll` before running.** Prod path itself is sound: `:29-31` asserts the `trbvxuoliwrfowibatkm` ref both ways ✅.
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
    - 🛑 `scripts/rebake-twp-markets.ts:15` and `scripts/fix-returner-twp-hitter-market.ts:16` take
      `process.env.SUPABASE_URL` with **no `--prod` flag and no ref assert**. `--prod` on their command line is
      **silently ignored**. They hit whatever env file you loaded — so they MUST be run as
      `npx tsx --env-file=.env.production.local scripts/<name>.ts --apply`. Get the `--env-file` wrong and they write
      staging while looking successful.
    - Unordered `.range()` in `rebake-twp-markets.ts:21,29` and `fix-returner-twp-hitter-market.ts:26,34` is
      **benign on prod today**: those reads are `players` filtered to `is_twp=true` (253), `target_board` (184) and
      `Teams Table` (774) — all under the 1000-row page size, so single-page (counts probed 2026-08-30). Re-check if
      `target_board` or `Teams Table` ever crosses 1000.
42. Market resyncs: `resync-build-snapshot-markets.ts --all --apply` · `resync-target-snapshots.ts --all --apply` (prod). IDEM
    🛑 **MUST READ — `resync-build-snapshot-markets.ts` HAS NO PROD PATH AND WILL WRITE STAGING.**
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
    🛑 **MUST READ — THIS STEP CANNOT RUN TODAY. MISSING PREREQUISITE → see new Phase-A step 10a.** Re-probed
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
    and `:1419` (faced-competition for Independents). That table **does not exist on prod today** (see F44). So the
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
  `obp_std_pr`=31.89504, `whip_pr_sd`=37.19844; nil_tier_sec=4.0. (`RUNBOOK:118` still carries the superseded
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
