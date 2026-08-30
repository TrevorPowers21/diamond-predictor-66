# Prod migration checklist — `feature/general-manager-interface`

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

## ★ PROD PUSH EXECUTION LOG — 2026-08-26 (LIVE, feature/war-recalibration)
Following `docs/PROD_PUSH_STEPS_2026_08_26.md` exactly, in order. Each step logged the instant it completes.
Prod state reconciled first (Push-1 + pre-recalibration config) — see the runbook's "PROD STATE — RECONCILED" section.
- [x] **GATE 0 — dedup prod pitch_log** — `DELETE FROM pitch_log WHERE runs IS NULL;` (raised statement_timeout). Junk count
  was **3,509** (= expected; attribution complete, safe). Deleted → verify `count(*) WHERE runs IS NULL` = **0**. Done 2026-08-26.
- [x] **GATE 1 — ivb/hb movement complete** — validated via the venue-corrections DRY-RUN on prod: **311 venues, τ IVB 0.622″ / HB 0.662″, centering IVB −0.0066″ / HB +0.0204″, worst park −2.57** (all in range, reproduces the known fixture). Movement complete + stable. Done 2026-08-26.
- [x] **A12 venue corrections — APPLIED + verified** — `scripts/sql/venue_correction_persist_prod.sql` via `_run_sql_file.ts` (exec_sql OK). NOTIFY pgrst reloaded. `venue_movement_corrections` = **311 rows, v1-2026-loo-eb**, worst IVB −2.57, `pitch_log_corrected` view resolves. Done 2026-08-26.
- [x] **Phase A DDL — APPLIED + verified (11 files)** — desc_* cols (Hitter+Pitching Master) · `20260810` composite ÷13.1
  def · `20260808` pitch_num_in_game/ab_num_in_game/pitch_num_in_ab · `20260818…` park_code + is_conference_game ·
  `20260821000000` ConfStats era_plus…hr9_plus · **`20260826160000_war_recalibration_gap_alters.sql` (NEW — filled the
  ad-hoc ConfStats run_env_factor/hitter_talent_plus/updated_at + Park 10×`*_seasonal`+updated_at + pitcher `ip`; generated
  by diffing staging↔prod, types match staging)** · `20260823` player_predictions team-scoped RLS · `20260826150000`+`150500`
  run-value cols+fn. All verified present on prod. ⚠ 20260806 RENAME skipped (already done). Done 2026-08-26.
- [x] **Phase B config — APPLIED + verified** — `step8_model_config_2026.sql` (201 keys; repl 21.22, r_obp_std_pr 31.89504) ·
  `ncaa_averages.wrc=0.3782` · `seed_nil_tiers` (nil_tier_sec **4.0**, ACC 1.5 / Big12 1.2 / JUCO 0.35) ·
  `store_transfer_weights_and_sds --apply` (42 keys, all confirming no-op — step8 covered them) ·
  `compute-projection-calibration --apply` (**19 keys incl. 6 `_sd_bad` two-sided SD**, hr9_shrink_k 66.4). Done 2026-08-26.
- [x] **A11 Masters UNIQUE — APPLIED + verified** — 0 true dups (stable id-scan; earlier 5/7 were pagination artifacts). Added `hitter_master_source_player_season_uniq` + `pitching_master_source_player_season_uniq` via NEW idempotent `20260826160500_masters_source_season_unique.sql` (prod + staging, both were missing it). Done 2026-08-26.
- [x] **C19 pitcher_full_name fix — APPLIED + verified** (2026-08-27) — prod `pitcher_full_name` held the BATTER name; fixed to players `First Last` via `pitcher_id=source_player_id` (single idempotent UPDATE, 900s timeout; gateway HTTP-timed-out at 125s but the txn committed server-side). Verified 41/41 correct table-wide, 0 corrupt. NEW committed `scripts/sql/fix_pitcher_full_names.sql` (closes the ad-hoc gap).
- [x] **C20 park_code — APPLIED + verified** (2026-08-27) — `park_code_filled = 2,576,146 / 2,576,146` (100%) via
  `scripts/_pc_keyset.ts` (keyset on `uniq_pitch_id`, direct pooler session, per-batch commit; 129 batches / ~92 min).
- [x] **C21 is_conference_game + C22 sequence — APPLIED + verified** (2026-08-28) — `is_conf_filled = seq_filled =
  2,576,146 / 2,576,146` via `scripts/_next_derived.ts` (ONE keyset pass). ⚠ **COPIED from staging, NOT derived** →
  FOLLOW-UP REQUIRED (see the ledger-backfill note below).
- [x] **`20260828000000_pitch_log_classification_version_needs_review.sql` — APPLIED prod** (2026-08-28) — adds
  `classification_version` + `needs_review` to prod `pitch_log`. ⚠ the prod `pitch_log_corrected` VIEW was NOT rebuilt
  afterward, so it does not expose them — that is the one remaining prod blocker.
- [ ] ⛔ **PROD BLOCKER (DDL, own explicit go): rebuild `pitch_log_corrected`** — `drop view pitch_log_corrected cascade;
  create view …` against the current 99-column list. The view is `select pl.*` FROZEN at 94 columns and missing
  `classification_version`, so `compute_pitch_log_stuff_plus.ts` hard-fails on prod.
- [ ] **STUFF+ CHAIN on prod (pitch_log lane, steps 1–5)** — reclassify (`reclassify_prod.ts`) → re-derive
  `pitcher_stuff_plus_ncaa` → `compute_pitch_log_stuff_plus.ts` → `aggregate_pitch_log_dimensions.ts --apply --prod
  --direct` → `derive_masters_from_pitchlog.ts --apply`. ⛔ NEVER via `recompute-stuff-plus.ts` / the legacy PSP-I lane.
  DONE + VERIFIED ON STAGING 2026-08-29/30 (steps 1–4; step 5 dry-run only). Budget 4-6 h on prod, ONE sitting.
  ★ Pre-registered prod gate: per-pitcher Stuff+ mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 / 4,234 pitchers.
- [ ] (then the rest of C producers → D desc-WAR → E precomputes → F re-bakes → G edge fn → H drops.)


> ## ★★★ LOGGING DISCIPLINE — VITALLY IMPORTANT (Trevor 2026-08-19) ★★★
> **EVERY schema or SQL change is logged HERE, no exceptions.** This file is the single
> authoritative record for the staging→prod push. The instant we run ANY of the following
> on staging, an entry is appended here BEFORE moving on:
> - a `CREATE TABLE` / `ALTER TABLE` (columns, types, constraints, indexes)
> - a `DROP` (table/column/view/function/RPC) — even a temp/helper cleanup
> - a data write that must be reproduced on prod (backfill, recompute, UPDATE)
> - an RLS `ENABLE` / policy, a role/GUC change, a new RPC or view
>
> Each entry states: the exact DDL/SQL, `APPLIED STAGING <date>` vs `PROD pending`, and any
> **prod-specific note** (e.g. "regenerate the fixture from PROD data, do NOT copy staging"
> when a value is per-env). A change that touches the DB but is NOT written here is a bug.
> The prod push reads ONLY this file — if it's not here, it doesn't happen on prod. [[feedback_claude_runs_backfills_dry_run]]

> ## ★ WAR RECALIBRATION PUSH — AUTHORITATIVE RUNBOOK (2026-08-20) ★
> For the **WAR recalibration + pitch-log migration** push, the execution-ordered,
> gap-closed manifest is **`docs/PROD_PUSH_RUNBOOK_war_recalibration.md`** (DB-change ledger,
> dependency order, the 13 modeling/edge-fn steps, limitations register). Companion audit:
> **`docs/AUDIT_war_recalibration_state.md`**. The WAR-recalibration sections below are
> reconciled to that runbook — where they disagree, **the runbook wins.**
> **CORRECTIONS (2026-08-20):**
> - **`team_war_snapshots` is NOT dropped** — federate-by-era keeps it for pre-2026 (2025 champions). Any "DROP TABLE team_war_snapshots" below is CANCELLED.
> - **park_code/game_string backfill IS DONE on staging** (the earlier "NOT DONE" line is stale).
> - **SD-audit outcome:** `whip_pr_sd`→37.13 and `obp_std_pr`→32.41 (returner+transfer) ARE re-tuned — see runbook Part C steps 1–2.
> - **TRANSFER LEVER STORAGE (pending Trevor's weight decisions, 2026-08-20):** new Conference Stats pitcher env+ cols (era_plus…hr9_plus, ratio scale) + `offensive_power_rating` fill + re-tag 10 NJCAA-D1 districts; Park Factors `era_factor`/`fip_factor` (=rg); cross-conf env+ SDs stored (model_config mirror, values also in code); pitcher env+ z×20→ratio code change. **NOT yet on staging** — see runbook **Part A7**. Transfer projections re-run deferred until this lands.

Every schema change on this branch that is **not yet on prod**, in apply order. Run
these against prod at push time (staging already has them). Most use
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so re-running is safe —
but **verify each against prod first and skip any already applied out of band.**

Apply in filename (timestamp) order. Runner used on staging:
`npx tsx --env-file-if-exists=.env.production.local scripts/_run_sql_file.ts <file>`
(⚠️ prod = `.env.production.local` → `trbvxuoliwrfowibatkm`. Requires explicit go.)

## Migrations (chronological = apply order)

> 

### ✅ APPLIED TO PROD 2026-08-30 — REBUILT the stale `pitch_log_corrected` VIEW (blocker #1 CLEARED)
The view was `select pl.*, …` and Postgres FREEZES `*` at creation time, so prod's copy was stuck at **94 of 99**
base columns and did NOT expose `classification_version` → `compute_pitch_log_stuff_plus.ts` HARD-FAILED on prod
("column pitch_log_corrected.classification_version does not exist") while the same query passed on staging.
⚠ `create or replace view` CANNOT fix this (new columns land mid-list) — it required drop + create.
**PRE-CHECK (read-only): NOTHING depended on the view**, so `cascade` was safe. Done inside a transaction with
rollback-on-error. Definition preserved exactly: `pl.*` + `ivb_corrected = pl.ivb - coalesce(vc.ivb_corr,0)` +
`hb_corrected = pl.hb - coalesce(vc.hb_corr,0)` + `vc.venue_correction_version`, LEFT JOIN
`venue_movement_corrections` on `(game_venue_id, season)`.
**VERIFIED: 94 → 102 columns; 10/10 previously-missing keys present** (`classification_version`, `needs_review`,
`park_code`, `is_conference_game`, `pitch_num_in_game`, `ab_num_in_game`, `pitch_num_in_ab`, `game_string`,
`ivb_corrected`, `hb_corrected`), and **the exact scorer query now succeeds on prod**.
🛑 **LESSON — any `select *` VIEW goes stale the moment a column is added to its base table.** After ANY
`ALTER TABLE pitch_log ADD COLUMN`, this view must be dropped and recreated or the chain silently breaks.

### ✅ APPLIED TO PROD 2026-08-30 — `team_season_stats` (3 migrations, DEPENDENCY order)
Trevor: "Make this the first step on prod." Applied over the direct pg session, in DEPENDENCY order (NOT timestamp order):
- [x] `20260819000000_team_season_stats.sql` — CREATE TABLE
- [x] `20260821010000_team_season_stats_war_columns.sql` — ALTER add 10 WAR/RA9 cols
- [x] `20260819010000_refresh_team_season_stats.sql` — CREATE FUNCTION
⚠ **THE FILENAME TIMESTAMPS SORT WRONG.** `supabase db push` would apply fn (`...19010000`) BEFORE the ALTER
(`...21010000`). The function's first statement is `DELETE FROM team_season_stats WHERE season = p_season`, so
fn-before-ALTER empties the season then ABORTS on `hitter_war_total does not exist`. **Always apply these three by
DEPENDENCY, never by timestamp.**
VERIFIED on prod: table present, **127 columns**, **10/10** WAR/RA9 cols (`hitter_war_reg/total`, `rotation_pwar_reg/total`,
`bullpen_pwar_reg/total`, `ra9_reg/total`, `fip_ra9_reg/total`), function present (2 args), **0 rows — correct, Phase F
populates it**. Creating the function does NOT run it, so no data was touched.
UNBLOCKS: **F44** `refresh_team_season_stats(2026)` and **G46** edge-fn deploy (`process-precompute-jobs` reads this
table at `index.ts:1095,1419` and would throw mid-precompute without it).
NOTE: staging has 128 cols vs prod's 127 — the extra is `preseason_proj_total_war`, which has no committed migration and
is filled by a precompute, not DDL. Left out deliberately; expected to close during E/F.

### ✅ GM BLOCK IS FULLY LIVE ON PROD — DO **NOT** REPLAY (reconciled 2026-08-28/29)
> Every `20260705…`–`20260716…` GM migration below was applied OUT OF BAND and is **populated with live coach data on
> prod** (gm_recruits 56 · gm_activity 114 · gm_allocation + gm_allocation_source 6+6 · gm_contract 4 · all 4
> vendor-unification slices applied and filled). They are marked `[x]` so nobody "catches up the pending migrations" —
> which is exactly the path that would replay the `20260710120000` TRUNCATE and wipe live funding data.

- [x] `20260705120000_gm_front_office_finance.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260706120000_gm_scholarship.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707120000_gm_scholarship_total.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707130000_gm_other_breakdown.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707140000_gm_finance_per_build.sql`  — gm_player_finance re-keyed to build_player_id (+ roster_status/departure_reason)  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707150000_gm_recruits.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707160000_gm_recruits_stage.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707170000_gm_recruit_events.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707180000_gm_recruits_report_date.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707190000_gm_recruit_reports.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707200000_gm_recruits_tier.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707210000_gm_recruit_contact.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707220000_gm_recruit_report_tier.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707230000_team_builds_gm_notes.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708120000_gm_player_finance_notes.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708130000_gm_player_finance_notes_date.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708140000_gm_player_notes.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708150000_gm_recruits_pricing.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708160000_gm_activity.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708170000_gm_recruits_level.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708180000_gm_recruits_extra_contacts.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709120000_gm_activity_link.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709130000_gm_recruiting_budget.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709140000_gm_activity_ref.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709150000_gm_target_board.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709160000_gm_target_asking.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709170000_gm_allocations.sql`  — gm_allocation_source + gm_allocation (funding sources)  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260710120000_gm_allocations_per_build.sql`  — ✅ APPLIED prod+staging (out-of-band). ⚠️ LANDMINE NEUTRALIZED 2026-08-28: originally `TRUNCATE gm_allocation, gm_allocation_source` — now DISABLED in the migration file (live coach data). DO NOT re-enable / re-run the original.
- [x] `20260710130000_gm_scholarship_mode.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260713120000_gm_contracts.sql`  — gm_contract + gm_contract_obligation + gm-contracts storage bucket  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260713140000_team_builds_is_active.sql`  — the live/active build flag  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260714120000_gm_player_info.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260714150000_gm_player_info_social.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260714170000_marketability.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260714190000_marketability_youtube.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)


### ⬆ LEDGER BACKFILL 2026-08-29 — work DONE+VERIFIED on prod but never logged (audit finding #8)
Logged retroactively so nobody re-runs them. Evidence from `docs/PROD_PUSH_HANDOFF_RESUME_2026_08_26.md:48-53,69-70`.
- [x] **C20 park_code** — `park_code_filled = 2,576,146 / 2,576,146` (100%). Method `scripts/_pc_keyset.ts` (keyset on
      uniq_pitch_id, direct pooler session, per-batch commit; 129 batches / ~92 min). Verified 2026-08-27.
- [x] **C21 is_conference_game + C22 sequence** (pitch_num_in_game / ab_num_in_game / pitch_num_in_ab) —
      `is_conf_filled = seq_filled = 2,576,146 / 2,576,146`. Method `scripts/_next_derived.ts` (ONE keyset pass).
      Verified 2026-08-28. ⚠ **COPIED from staging, NOT derived** → FOLLOW-UP REQUIRED: verify the park_code /
      is_conference_game / sequence derivation runs on PROD and is wired into the go-forward pipeline. **Track B breaks
      on the next ingest without it.** (audit finding #9)
- [x] **`20260828000000_pitch_log_classification_version_needs_review.sql`** — adds `classification_version` +
      `needs_review` to prod `pitch_log`. Applied 2026-08-28. ⚠ NOTE: the prod `pitch_log_corrected` VIEW was NOT
      rebuilt afterward, so it does not expose these columns — see STAGE 0 blocker #1.

### ⬇ COMMITTED BUT NOT YET APPLIED (either env)
- [ ] **`20260829120000_gm_budget_nil_allocation_mode.sql`** — `gm_budget.nil_allocation_mode text NOT NULL DEFAULT
      'balanced' CHECK (IN ('balanced','top_heavy'))` + `NOTIFY pgrst`. **Committed 2026-08-29; NEVER RUN on staging or
      prod.** Until it is applied, the Balanced/Top-Heavy NIL toggle write ERRORS on prod and every `allocateNil`
      silently falls back to `balanced`. **Apply to BOTH envs.**

### Vendor unification (project_gm_vendor_unification)
- [x] `20260716120000_gm_vendor.sql`  — slice 1: program-level vendor directory (staging 2026-07-16)  ✅ APPLIED prod+staging + FILLED (all 4 vendor slices verified on prod 2026-08-28)
- [x] `20260716130000_gm_contract_vendor_link.sql`  — slice 3a: gm_contract.vendor_id + gm_allocation_source.vendor_id + backfill directory + link (staging 2026-07-16)  ✅ APPLIED prod+staging + FILLED (all 4 vendor slices verified on prod 2026-08-28)
- [x] `20260716150000_gm_source_funding_mode.sql`  — slice 4a: gm_allocation_source.funding_mode + base_offset (new-money vs carve accounting) (staging 2026-07-16)  ✅ APPLIED prod+staging + FILLED (all 4 vendor slices verified on prod 2026-08-28)
- [x] `20260716170000_gm_contract_funding.sql`  — slice 4b: gm_contract.funding_mode + base_offset + allocation_id (staging 2026-07-16)  ✅ APPLIED prod+staging + FILLED (all 4 vendor slices verified on prod 2026-08-28)

## Non-migration prod steps (from memory)
- ~~Deploy the `parse-contract` edge function + `ANTHROPIC_API_KEY`~~ — NOT needed: contract PDFs are read entirely in the browser (`extractContractPdf`, pdfjs, no AI/network). The AI `parse` path in useGmContracts is dead code (nothing calls it) — remove it.
- [ ] Headshot scrape: run the roster scraper against prod customer teams after push (returners + incoming transfers).
- [ ] **Contract funding backfill** (AFTER the 4 vendor migrations): `npx tsx --env-file-if-exists=.env.production.local scripts/backfill_contract_funding.ts --write` — syncs existing NIL/Other contracts into funding sources/allocations (idempotent; dry-run first without `--write`).

- [ ] 20260717120000_user_team_access_team_admin_modify.sql — RLS: team_admins can modify their own team user_team_access (fixes admin remove-access)

### Recruit identity + mobile recruiting + scouting v2 (`feature/recruit-ids-mobile-board`)
Apply in order at push time. All additive/idempotent. Staging dates noted.
> **✅ APPLIED TO PROD 2026-07-30** — all 4 migrations + backfill run against prod (`trbvxuoliwrfowibatkm`) via `supabase db query --linked`, catalog-verified. BYU had 4 recruits → 4 `prospect` identities minted (Nixon Warren LF→OF normalized first). CODE still pending staging→main (PR #159).
- [x] `20260728120000_player_external_ids_and_prospect.sql` — vendor-agnostic identity crosswalk (`player_external_ids`) + `data_status='prospect'` (staging 2026-07-28, catalog-verified)
- [x] `20260728121000_resolve_or_create_prospect.sql` — `resolve_or_create_prospect()` SECURITY DEFINER writer; exact-external-key auto-link only (staging 2026-07-28, round-trip verified)
- [x] `20260729120000_scout_grades_and_template.sql` — `gm_recruit_reports.grades` JSONB + `gm_scout_template` (per-team customizable scouting template) (staging 2026-07-29)
- [x] `20260730120000_gm_recruits_player_identity.sql` — adds `gm_recruits.player_id` FK → `players(id)` (the recruit↔RSTR IQ identity link; minted at add via `resolve_or_create_prospect`) (staging 2026-07-30, verified)

**Non-migration prod steps for this feature (append as they arise):**
- [ ] Scouting v2 storage: create the `recruit-video` bucket + retention/lifecycle via the Supabase dashboard (owner-restricted — can't go through the SQL runner). [pending 1d]
- [x] Recruit identity backfill (AFTER `20260730120000`): run `supabase/queries/backfill_gm_recruits_player_id.sql` — mints/attaches an identity for every pre-existing recruit (idempotent; only touches `player_id IS NULL`). Staging 2026-07-30: 9/9 linked, 0 orphaned.

- [ ] 20260808_pitch_log_add_sequence.sql — add pitch_num_in_game/ab_num_in_game/pitch_num_in_ab + backfill (scripts/sql/pitch_log_sequence_backfill_steps.sql). APPLIED STAGING 2026-08-08 (2,576,230 rows). PROD pending.

- [ ] team_drs_store.sql (scripts/sql/) — add team_drs column to team_war_snapshots + populate 308 D1 teams (re-centered dRS, season 2026). APPLIED STAGING 2026-08-09 (308 rows, sum ~0). PROD pending. Regenerate values via scripts/drs/derive_team_drs.mjs against prod.

## WAR redesign + internals collapse (feature/war-recalibration) — full run order in docs/STEP8_PROD_MIGRATION_LEDGER.md
- [ ] A1 descriptive_war_columns.sql — Master desc_* columns. PROD pending.
- [ ] A2 descriptive_war_reg_columns.sql — Master desc_*_reg columns. PROD pending.
- [ ] B1 step8_model_config_2026.sql — COMPLETE @2026 model_config mirror (wRC+ C1 + composite refits + replacement 21.22). PROD pending.
  - ⚠ **REGENERATED 2026-08-24 (125→201 keys)** — the 2026-08-13 snapshot had drifted badly vs staging: 80 keys MISSING (per-conference `nil_tier_<code>` market PTM, pitcher `p_*_pr_sd`/`p_ncaa_avg_*`/`p_sd_*`, `transfer_*` pitcher weights, `conf_*_sd`/`park_sd_*`), 26 STALE VALUES (incl. the SD landmine `r/t_obp_std_pr` 28.889→**31.89504**, `r/t_ba_std_pr` 31.297→**29.99699**, transfer weights re-tuned e.g. `t_ba_conference_weight` 0.3→0.256, ncaa_avg refits), 4 old bucket keys removed (`nil_tier_p4/big_ten/strong_mid/low_major`). Root cause: staging was hand-corrected out-of-band (verified correct in DB); the committed seed prod runs was never back-ported → prod would have gotten stale SDs + weights + missing pitcher SDs. Now a faithful 201-key mirror of verified staging. **The `nil_tier_<code>` keys overlap `seed_nil_tiers_model_config.sql` (values match, both idempotent) — either order converges.**
- [ ] B2 UPDATE ncaa_averages SET wrc=0.3782 WHERE season=2026. PROD pending.
- [ ] C1/C2 backfill Hitter Master pull_air + Pitching Master in_zone_pct from prod pitch_log. PROD pending.
- [ ] D1 store recompute (power ratings) on prod. PROD pending.
- [ ] E1/E2 populate_descriptive_war(.mjs) + _reg on 0.3782. PROD pending.
- [ ] F1 20260810_composite_war_d1_rescale.sql (refresh_composite_war ÷13.1 DEFINITION) → F2 fire after precompute. PROD pending.
- [ ] G1/G2 precompute-returner-hitters/pitchers:prod. G3 transfers via edge fn (when resumed). PROD pending.
- [ ] H1 reseed team_war_snapshots; H2 fill player/transfer snapshots; H3 total-WAR display swap. PROD pending.
- [ ] J DROP player_prediction_internals (Track B, AFTER bulkRecalc retired). PROD pending — separate confirmed step.

## ★ PROJECTION CALIBRATION — two-sided SD (feature/war-recalibration) — 2026-08-24 — DESIGNED, NOT BUILT
- [ ] **Two-sided (split) SD recalibration of the projection map** — the symmetric-SD z-shift over-projects elite (impossible
  negative HR9, elite ERA 1.13) → inflated pWAR. Fix: per-stat `sd_good`/`sd_bad` (semi-deviation below/above the mean) on a
  qualified population; scale elite projections by the good-side SD. Full writeup + proof: `docs/AGENT_LEARNINGS_projection_calibration_two_sided_sd_2026_08_24.md`.
  **When built (staging→prod):** (1) compute per-stat mean + `sd_good`/`sd_bad` + the qualifier on the season's actuals;
  (2) store the method + values in `model_config` (read by returner/transfer/edge fn); (3) code change in `pitcherProjection.ts`
  (+ hitter mirror) to use the directional SD; (4) redeploy the edge fn (re-derives SDs each season); (5) re-run ALL precomputes;
  (6) re-verify the calibration table (actual vs projected across the range) + re-bake snapshots + markets.
  ✅ **SPEC LOCKED 2026-08-25 (all data-driven):** (1) qualifier IP≥40/PA≥100; (2) two-sided (split) SD for every stat
  (`sd_good` toward elite, `sd_bad` toward poor); (3) sample-size shrinkage on **HR9 ONLY** (the sole luck-dominated stat:
  luck SD 0.42 > talent SD 0.37), `regressed = mean + (obs−mean)×IP/(IP+K)`; (4) **K data-derived** via variance
  decomposition `K = C/talent_var` (HR9 K=71 this season → elite HR9 0.66; edge fn re-derives K each season). Stage 5.5:
  compute → store in model_config → stage 6 reads → run whole chain front-to-end + verify across the range. Do NOT re-weight
  the HR9 composite (dead end, ceiling 0.335).
  **PITCHING BUILT + VERIFIED STAGING 2026-08-25** (commit 57e8f12): producer `compute-projection-calibration.ts` applied
  (19 model_config keys); `pitcherProjection`/`transferPitcherProjection` use directional SD. Arkansas re-run: Yochum projHR9
  0.15->0.61, pWAR 2.31->2.05; HR9 negatives 66->3. **PROD order:** run `compute-projection-calibration.ts --apply` (stage 5.5)
  BEFORE re-running pitcher precomputes -> re-run all 17 teams transfer + returner-pitcher batch (raise statement_timeout for the
  propagate step) -> re-bake snapshots+markets -> deploy edge fn `process-precompute-jobs` with the directional-SD mirror (Trevor).
  **FULL RE-RUN DONE STAGING 2026-08-25:** transfer (18 teams) + returner batches re-run; snapshots re-baked (backfill-neutral
  bp1205/tb167 + heal 561/561 + resync markets). Board verified — top-12 pitchers all genuine stuff (0 weak-stuff mid-major).
  ⚠ **RETURNER OVERLAY FIX (commit 3c4e8c8):** `precompute-returner-pitchers` never overlaid model_config `_plus_ncaa_` (only
  `p_*`) → ran on stale symmetric SDs. Fixed. **PROD: the returner batch needs this overlay or returners ignore the calibration.**
  **19 residual neg HR9 = qualification gap** (all 0–5 IP / lastHR9 0.00; D1 sub-5-IP slip through while JUCO sub-20-IP already
  nulled) — NOT a floor/calibration issue. Fix TBD (min-IP qual for D1 returners, or per-pitcher last-year shrinkage). Investigate-only.
  **REMAINING:** edge-fn Deno mirror (Trevor deploys); hitters (symmetric, follow-on).

## 7b snapshot total_hitter_war fill (feature/war-recalibration) — 2026-08-24
- [ ] **Fill total_hitter_war into HITTER snapshots** — `scripts/backfill-snapshot-total-hitter-war.ts` (idempotent-by-value, dry-run default, `--apply`). Snapshots stored `o_war` only, so the 7b display swap made build-player profiles fall back to `o_war` (offense-only) while the Dashboard shows total → misaligned WAR + market. Sets `total_hitter_war = o_war + d_war + bsr_war` on `team_build_players.{player_snapshot,neutral_snapshot}` + `target_board.{transfer_snapshot,neutral_snapshot}` (d/bsr from the player's precompute row; snapshot's own team-scoped/toggled o_war preserved). **APPLIED STAGING 2026-08-24** (verified 1149 build hitters correct, 0 wrong, idempotent). **PROD: run `--apply` after the prod re-price/precompute.** ⚠ Must run AFTER the snapshot writers carry total (below) OR it's a one-time catch-up; re-run any time snapshots are re-baked.
  - ⚠️ **RELIABILITY BUG (unordered `.range()` pagination silently skips rows):** fixed in this script. AUDITED the other batch scripts 2026-08-24 — the CRITICAL ones already order (`precompute-transfer-projections`/`precompute-pitchers`/`heal-stale-snapshots`/`resync-build-snapshot-markets`/`resync-target-snapshots`/`backfill-2027-hitter-returners` — precompute even carries a comment about exactly this), so the re-price/refresh/precompute runs were reliable. **ONLY `backfill-neutral-snapshot.ts` lacked `.order()`** → fixed (add `.order("id")`) as part of the writer update below.

## Stuff+ display min-pitch qualifier (feature/war-recalibration) — 2026-08-24
- [ ] **Pitching Master `trackman_pitches` BACKFILL** — populate `trackman_pitches` = Σ `pitcher_stuff_plus_inputs.pitches` per (source_player_id, season). Column already exists (was ~87% NULL — never systematically filled). This is the true per-pitcher TrackMan sample size, the gate for the Stuff+ display min-pitch qualifier (Stuff+ fork RESOLVED=B; a thin-sample arm like 12.7 IP / 22 pitches must not top leaderboards). Producer: `scripts/backfill_trackman_pitches_pitching_master.ts` (idempotent, dry-run default, `--apply`). **APPLIED STAGING 2026-08-24** (5,720 rows: 5,332 were NULL + 388 corrected stale; 6006/6007 stuff_plus pitchers now populated; idempotent re-run = 0 changes; dist p10=47/p25=128/p50=317). 🛑 **MUST READ — CORRECTED 2026-08-30.** ~~PROD: run the same script `--apply` after prod's
  `pitcher_stuff_plus_inputs` is populated (regenerate, don't copy).~~ **THAT INSTRUCTION IS WRONG AND ROUTES YOU INTO
  THE LEGACY RAW-HB LANE.** `pitcher_stuff_plus_inputs` is the legacy PSP-I table this push bans (it stores RAW hb and
  scores left-handers backwards). On prod, run the script **AFTER the pitch_log Stuff+ chain steps 1–4**, so the counts
  come from the freshly-aggregated **`pitch_log_pitcher_totals`** — see `docs/PROD_PUSH_STEPS_2026_08_26.md` step 24 and
  `docs/PROD_PUSH_HANDOFF_RESUME_2026_08_26.md:133`. Do **not** gate this step on `pitcher_stuff_plus_inputs`.
  (Prod does have 32,068 legacy PSP-I rows for 2026, so gating on it would *appear* to work and quietly use the wrong
  lane. Audited 2026-08-30.) **Display gate DEFERRED (Trevor 2026-08-24):** no coach-facing Stuff+ leaderboard/sort exists on this branch (savant leaderboards deleted, no Rankings Stuff+ category, tables don't sort by Stuff+), so there's nothing to gate; thin arms only surface on per-player percentile chips. The backfill is the durable win (feeds `jucoDataReliability` + any future gate). Revisit a `trackman_pitches>=50` qualifier if a real Stuff+ leaderboard is built.

## Stuff+ classification build (feature/war-recalibration) — 2026-08-17
- [ ] venue_correction_persist.sql (scratchpad/) — `venue_movement_corrections` table (310 rows, season 2026, LOO + empirical-Bayes shrunk IVB/HB offsets) + `pitch_log_corrected` stamped VIEW (`venue_correction_version=v1-2026-loo-eb`). Feeds Stuff+ classification AND scoring (one corrected movement layer). APPLIED STAGING 2026-08-17. **PROD: REGENERATE the fixture from PROD pitch_log (per-season, prod venue ids) — do NOT copy staging offsets.** Named "venue movement effects" (miscalibration OR thin-air), not sensor errors.
- [ ] pitch_log.vaa column (`alter table pitch_log add column if not exists vaa numeric`) — RESERVED SLOT (ruling 2026-08-17: do NOT derive; per-pitch VAA absent from all current exports; cluster-mean carries the SI/FF strip). ingest_pitch_log.ts maps VertApprAngle→vaa (forward-compatible). Populates when future LOCAL-TrackMan source ships real VAA/HAA. No prod action until then.
- [x] venue_movement_corrections RLS — `ALTER TABLE public.venue_movement_corrections ENABLE ROW LEVEL SECURITY;` APPLIED STAGING 2026-08-17 (no policy = service-role only, correct for a pipeline fixture). PROD: same ALTER after the table is created on prod.

## Park-factor rebuild + hygiene (feature/war-recalibration) — 2026-08-18
- [x] Stuff+ temp-table RLS lockdown — `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` for the 6 Stuff+ backup/helper
  tables (`_confstats_backup, _master_stuff_backup, _ncaa_backup_preanchor, _reclass_map, _reclass_pf, _reclass_result`).
  APPLIED STAGING 2026-08-18 (was: all exposed to anon/auth; now service-role-only, correct for pipeline temp tables).
  These are STAGING-ONLY Stuff+ artifacts (not promoted to prod). **PROD equivalent:** when Stuff+ regenerates on prod and
  creates its own backup/helper tables, ENABLE RLS on them the same way.
  🛑 **MUST READ — CORRECTED 2026-08-30. Do NOT read this as authorisation to drop all 6.** ~~The DROP of all 6 staging
  temp tables is DEFERRED to the dead-code audit (#7) AFTER Stuff+ prod acceptance.~~ Three of the six named above —
  **`_reclass_result` (2,000,674), `_reclass_map` (37,101), `_reclass_pf` (4,804)** — are on the **NEVER-DROP** list,
  along with `_v2_prechain_backup` and `team_war_snapshots`. See `PROD_MIGRATIONS_TODO.md:819-827` (this same file) and
  `docs/PROD_PUSH_STEPS_2026_08_26.md` step 51. The **only** Stuff+ temp safe to drop is **`_reclass_fix`**. RLS
  lockdown on all six: yes. Dropping all six: no.
- [ ] DROP dead `park_factors` (lowercase, 12 cols, 0 rows) — a duplicate of the live `"Park Factors"` (quoted, 18 cols,
  where 2025/2026 rows actually live + all projection readers point). COUPLED: strip the 2 `from("park_factors")` calls in
  `supabase/functions/google-sheets-sync/index.ts` (lines ~1006/1054) FIRST/together — that function is otherwise LIVE (syncs
  8 tables: players, nil_valuations, player_predictions, season_stats, conference_stats, model_config, power_ratings) so do
  NOT delete the function, only its park_factors delete+insert. Then `DROP TABLE public.park_factors;`. Fold into audit (#7). STAGING+PROD.
- [~] ~~`park_factors_seasonal` (NEW separate table)~~ **SUPERSEDED 2026-08-19 — DO NOT RUN.** Trevor chose COLUMNS on
  `"Park Factors"` (the `*_seasonal` entry directly below), not a separate table. No `park_factors_seasonal` table exists on
  staging; do not create one on prod. Kept here struck-through so the audit trail is explicit.
- [x] `"Park Factors"` seasonal columns + backfill — `ALTER TABLE "Park Factors" ADD COLUMN *_seasonal` (10 cols) +
  `scripts/backfill_park_factors_seasonal.ts --apply` (self-normalized single-season 2024/25/26 + stored 2026 3-yr rolling).
  APPLIED STAGING 2026-08-18 (922 rows). Backup `_park_factors_backup_20260818`. **PROD:** same ALTER + re-run backfill against
  prod (the archived CSVs are league-wide, not per-env — same input both DBs); verify vs prod's current Park Factors rows.- [ ] 20260818000000_pitch_log_park_code.sql — add game_string + park_code to pitch_log (+ index). park_code = stable
  stadium id from gameString (strip trailing 9 digits + `cs-`). APPLIED STAGING 2026-08-18. PROD pending.
  FOLLOW-ON (staging+prod): backfill park_code on existing pitch_log rows from source files (by uniq_pitch_id/game); then
  rebuild pitch-log park factors keyed by park_code + team_id (NOT batting_team_id, which is corrupt). Validated vs TruMedia.- [ ] DROP corrupted pitch_log.batting_team_id + pitching_team_id (source maps 1 id -> up to 15 teams; clean ids =
  team_id/opponent_id, already present). COUPLED (do together, in the dead-code audit): (1) remove batting_team_id/
  pitching_team_id from `scripts/ingest_pitch_log.ts` record + interface; (2) recreate the `pitch_log_corrected` VIEW
  WITHOUT those two columns (it currently SELECTs them) + re-verify Stuff+ classification/scoring still read it;
  (3) `ALTER TABLE pitch_log DROP COLUMN batting_team_id; ALTER TABLE pitch_log DROP COLUMN pitching_team_id;`.
  DRS/WAR/ReturningPlayers do NOT use them (comments / name-alias only). STAGING + PROD.- [ ] Conference Stats HTP+run-env: `ALTER TABLE "Conference Stats" ADD COLUMN run_env_factor double precision, ADD COLUMN
  hitter_talent_plus double precision;` + conf-stats pitch-log build populates them (run_env_factor = conf-avg per-team
  rg_factor from rolling Park Factors; HTP = OPR + 1.25(Stuff+−100) + 0.75(100−run_env_factor)). Repoint 4 live HTP sites +
  transfer engine to read stored. STAGING first, then PROD. (#3+#4 coordinated.)  [APPLIED STAGING 2026-08-18: ALTER + run_env_factor populate (conf-avg per-team rg_factor via Teams Table) + hitter_talent_plus
  = Overall_Power_Rating + 1.25(Stuff_plus-100) + 0.75(100-run_env_factor), 30 D1 confs. Backup _confstats_backup_20260818.
  PROD: same ALTER + repopulate from prod Park Factors/Teams Table. Then repoint 6 live HTP sites to read stored.]- [ ] LIVE-COMPUTE ELIMINATION (ships with edge fn): edge fn produces stored snapshots (transfer/player) + stored conf
  HTP/run_env/OPR; repoint ALL client live-computes to read stored — HTP (~15 sites), oWAR/wRC+/pWAR (~19, incl TB regression),
  transfer projections (~14), resolveConferenceStats. Per repoint: Supabase types regen + PAGE-LOAD verify (CLAUDE.md gate).
  Files: TransferPortal, TeamBuilder, useTeamBuilderSimulation, PlayerProfile, ReturningPlayers, PitchingConferenceStatsTable,
  savant PitcherPage/ConferenceStatsPage. Goal: ZERO client compute. See handoff §LIVE-COMPUTE AUDIT.- [ ] 20260818010000_pitch_log_is_conference_game.sql — add is_conference_game boolean + index. Backfill:
  is_conference_game = (conference_of(team_id) == conference_of(opponent_id)) via "Teams Table".source_id→conference_id
  (Season 2026). APPLYING STAGING 2026-08-18 (ctid-batched, ~40 batches; index dropped during backfill for HOT, recreated after).
  PROD: same ALTER + backfill (or compute in edge fn on ingest). FORWARD: compute post-ingest (edge-fn stage) since it needs
  the Teams Table conference lookup, not row-by-row. ⚠ team_id/opponent_id are the CLEAN ids (batting_team_id/pitching_team_id corrupt).
## ★ is_conference_game BACKFILL — DONE (staging, 2026-08-18)
2.58M rows flagged: **1,407,734 intra-conf / 1,171,921 non-conf / 0 null** (unmapped opponents → false). Method that worked
after several failures (see BIG-WRITE MECHANICS v2 + the CLI-caps-statements finding): a join-based RPC `flag_conf_batch(n)`
(flags the next n NULL rows in one fast statement via `coalesce(bt.conference_id=ot.conference_id, false)` joining `_team_conf`
on team_id/opponent_id), LOOPED until 0 (`/tmp/conf_flag_loop.sh`). Self-converging + timeout-immune (each call <120s).
CLEANUP (audit): drop one-off RPCs `flag_conf_batch`, `set_conf_game` + helper `_team_conf` after the conf-stats run is built.
PROD: same — migration adds the column; backfill via the RPC-loop (or compute in the edge-fn conf-stats stage on ingest).- [ ] Conference Stats UNIFIED RECOMPUTE (edge-fn stage) — recompute ALL conf fields from pitch-log per the CALCULATION SPEC
  (handoff/agent §CONFERENCE-STATS CALCULATION SPEC): intra-conf hitting+pitching rates (proper denominator; IP=outs/3), env+
  (÷NCAA), wRC+ (C1 OBP/SLG — current; corrects the STALE pre-C1 stored value), FIP (+cFIP≈3.157), ERA (DRS earned runs on
  intra-conf), OPR/Stuff+/scouting/run_env/HTP (total-season rollups). Store in "Conference Stats". THEN retire the 5 producers
  (importConferenceStats, populate-conference-stats-env-plus, conferenceScoutingAverages, conferenceStuffPlus-V1) + one-off RPCs
  (flag_conf_batch, set_conf_game) + helper _team_conf. Validated on staging (all rate fields corr 0.98+). STAGING+PROD.- [ ] Conference Stats Bucket-A recompute — APPLIED STAGING 2026-08-18 via scripts/sql/conf_stats_unified_assembly.sql (CTAS
  _conf_agg → UPDATE 29 D1 confs: rates/env+/WRC_plus(C1)/K9/BB9/HR9/WHIP/FIP/ERA). Backup _confstats_backup_preassembly. Fixes
  stale pre-C1 WRC_plus. PROD: same (compute from prod pitch_log; NCAA constants from prod ncaa_averages; cFIP re-derive).
  Then fold into edge fn + retire the 5 producers (build-check-then-clear).

## ★ team_season_stats — NEW canonical per-team-per-season table (feature/war-recalibration) — 2026-08-19
DEDICATED HANDOFF: docs/HANDOFF_team_season_stats_2026_08_19.md (full schema §5, sources, execution order 0–7, verify plan).
DESIGN + WHY also in docs/HANDOFF_STUFF_PLUS_2026_08_16.md + docs/AGENT_LEARNINGS_stuff_plus_2026_08_16.md §TEAM_SEASON_STATS.
⚠ PROD-SPECIFIC: team_war_snapshots on PROD holds 2025 (309 rows incl. Louisiana State natl champ + 39 conf champs) + 2026 (466);
staging has 2026 only. The migrate step MUST read PROD's own team_war_snapshots so the 2025 championship history is preserved.
WAR rollup = pure SUM over Hitter/Pitching Master (reg+total split already stored per player) — no player-boundary work.
Forced by Independents (Oregon State transfers) needing faced-competition; becomes the team-stats layer the system lacks.
Consolidate (Masters philosophy): ONE canonical table; retire team_war_snapshots + Park Factors INTO it AFTER verify (never two live copies).
- [ ] CREATE TABLE `team_season_stats` — key `(source_id, season)` (source_id = STABLE program id; confirmed OSU 3111 / UGA 226
  every season) + store per-season `id` (uuid) + `conference_id` + team_name/abbreviation. AUTHORITATIVE column list + build rule
  in handoff/agent §team_season_stats AUTHORITATIVE SCHEMA. Fill ALL first pass, computed in the ONE edge fn. BUILD RULE: team =
  Σ player values (sum counting stats per window → DERIVE weighted rates from the sums; team WAR = Σ player WAR). COLUMNS:
  records (w/l overall + conference, NEW run from pitch_log game outcomes) ; hitting+pitching counting (Σ) → derived rates ;
  WAR matrix owar/dwar/bsrwar/pwar/total_war each **_reg + _total** (split on season boundary 2026-05-18) + carried proration/
  champion-flags/seed/team_drs ; conf-scoped (migrate from "Conference Stats") ; faced_stuff_plus/faced_htp ; park snapshot
  (single-season + 3-yr rolling, derived from "Park Factors" which STAYS as historical source). RLS ENABLE (service-role pipeline table).
  STAGING first (build + fill + A/B), then PROD (same DDL + edge-fn populate from prod pitch_log/Teams Table/Park Factors).
  [APPLIED STAGING 2026-08-19: migration 20260819000000_team_season_stats.sql (117 cols + 3 indexes + RLS ENABLE) + ALTER ADD
  COLUMN preseason_proj_total_war (future accuracy-tracking, nullable). ⚠ D1 ONLY — JUCO (NJCAA_D1) excluded (descriptive WAR is D1).
  Descriptive-only (no projection block; projection = TB function elsewhere). PROD: same DDL.]
- [x] WAR rollup (step 2) — scripts/sql/team_season_stats_war_rollup.sql. Σ Hitter+Pitching Master (desc_owar/d_war/bsr_war/
  desc_pwar/total_desc_war + _reg), D1 only, join Masters.TeamID="Teams Table".id→source_id. APPLIED STAGING 2026-08-19: 308 rows;
  pWAR corr 1.0000 (exact) vs team_war_snapshots.raw_total_pwar; oWAR=Σdesc_owar by construction. PROD: re-run from prod Masters.
- [ ] STAGING cleanup (done) — DROP _conf_agg + _team_home_park (completed-step scratch; results in Conference Stats/Park Factors;
  backups exist). Cleared RLS advisory. STAGING-ONLY temps → no prod action unless prod created them.
- [ ] team_season_stats RATES (step 3) — team rate block = weighted aggregate of the AUTHORITATIVE Masters (TruMedia=BBRef), NOT
  pitch_log (Master is not a pitch-log total; confirmed import-csvs/registry.ts). Hitting: AVG=Σ(AVG·ab)/Σab, OBP=Σ(OBP·pa)/Σpa,
  SLG=Σ(SLG·ab)/Σab, ISO=SLG−AVG, OPS=OBP+SLG, wRC+=C1; store pa_total/ab_total. Pitching: ERA/FIP/WHIP/K9/BB9/HR9=Σ(rate·IP)/ΣIP;
  store ip_total/bf_total. D1 only, total season (reg rates deferred; Master has no reg-rate cols). Detailed counting splits
  (HR/2B/3B/BB/HBP/SB/CS/SF) from pitch_log later. APPLIED STAGING 2026-08-19 (308 teams, 0 null; team .277/.381/.434 wRC+~100 = D1 baselines). Script scripts/sql/team_season_stats_rates.sql. PROD: re-agg from prod Masters.
- [ ] Team RECORDS run (NEW) — derive overall + conference W-L per team-season from pitch_log game outcomes (runs/game →
  win/loss; is_conference_game → conf record). Not a player rollup. Stores into team_season_stats; enables wins-over-projection (future). STAGING+PROD.
- [ ] CONSOLIDATION (build-check-then-clear, LAST) — **subsume `team_war_snapshots` FOR 2026+, FEDERATE `Park Factors` (Trevor 2026-08-19):**
  - ⚠️ **DROP CANCELLED (federate-by-era, 2026-08-20): DO NOT DROP `team_war_snapshots`.** It stays as the authoritative store for
    **pre-2026** (2025 champions can't be recomputed — no 2025 pitch_log). team_season_stats is canonical for **2026+**. Migrate/carry the
    2026 rows into team_season_stats and repoint 2026+ readers, but the table remains for historical seasons. **No `DROP TABLE`.**
  - `"Park Factors"` is a DIFFERENT grain (park-data INPUT store: raw single-season + rolling, ALL history) → **KEEP IT, do NOT retire.**
    It's always needed as the historical park source + projection ingredient (we are NOT backfilling full park history into team rows).
    team_season_stats stores a DERIVED SNAPSHOT of the values USED for that team-season: the 3-yr rolling (projection input) + the
    single-season, both stamped by the edge fn from `"Park Factors"` each run. Single writer = no drift; `"Park Factors"` stays source-of-truth.
  - Every step (CREATE, each ADD COLUMN, the 2026-row migrate, the repoint) gets its own line logged when applied — per the banner at top. (NO drop — see cancellation above.)
- [x] team_season_stats RECORDS (step 4) — scripts/sql/team_season_stats_records.sql. Derived from pitch_log game outcomes
  (team_id=source_id; game key = DISTINCT team_id/date/game_venue_id/total_runs/opponent_runs → splits doubleheaders by final;
  ⚠ game_string/park_code are 0% populated so unavailable as a game id — the park_code ingest backfill is still pending). W/L from
  total_runs vs opponent_runs (14 ties excluded); boundary 2026-05-18. w_total/l_total=all, w_reg/l_reg=reg, w_conf/l_conf=reg-season
  conference (standings). APPLIED STAGING 2026-08-19: 308 teams avg 55 games; Georgia 53-14 (23-7 SEC), Arkansas 41-22 (17-13). PROD: re-run from prod pitch_log.

- [x] team_season_stats step 5 — migrate snapshot history + conf context. scripts/sql/team_season_stats_migrate_snapshot_conf.sql
  (run the 2 UPDATEs separately — CLI is one-statement-per-call). (a) carry proration_factor/games_played_est/champion flags/
  national_seed_rank from team_war_snapshots (join source_team_id=source_id) — NOT the stale old oWAR. (b) conf_stuff_plus/conf_htp/
  run_env_factor/conf_opr/conf_wrc_plus from "Conference Stats" via conference_id. APPLIED STAGING 2026-08-19: 308/308 both.
  ⚠ team_drs left NULL — team_war_snapshots.team_drs is empty on staging (snapshot rebuilt after the 2026-08-09 populate);
  regenerate via scripts/drs/derive_team_drs.mjs (dwar_total already populated). ⚠ PROD: run (a) against PROD team_war_snapshots
  (has 2025 champions — Louisiana State + 39 conf champs) so championship history carries into 2025 team_season_stats rows.

- [x] team_season_stats step 6 — faced competition + park snapshot. scripts/sql/team_season_stats_faced_park.sql (3 UPDATEs, run
  separately). SEMANTICS (validated): pitch_log team_id=pitching side, opponent_id=batting side. faced_stuff_plus(T)=pitch-wt conf
  Stuff+ of pitchers T's hitters faced (opponent_id=T, metric on team_id conf); faced_htp(T)=pitch-wt conf HTP of hitters T's
  pitchers faced (team_id=T, metric on opponent_id conf). Reproduces proven OSU 100.2/104.5. Park = snapshot of USED rolling+single
  from "Park Factors" (which STAYS historical source). APPLIED STAGING 2026-08-19: 308/308 all three. PROD: re-run from prod pitch_log/Conference Stats/Park Factors.

- [x] park_code/game_string BACKFILL — **DONE on staging** (superseded the 2026-08-19 "NOT DONE" note; see the later "RUNNING STAGING"
  entry which completed). Audit 2026-08-20 confirmed ~100% populated on sampled teams + records now key on game_string (DH-safe,
  Georgia 53-14 / 23-7 SEC). ⚠ Before prod push, run a server-side full-table `count(*) FILTER (WHERE park_code IS NULL)` to confirm
  globally (audit used per-team sampling). PROD pending — backfill from source on prod. STAGING done / PROD pending.
- [ ] team_season_stats RATE/COUNTING re-source (wiring step) — rebuild from pitch_log_hitter_totals/pitcher_totals (frequent primary;
  TruMedia = cross-check). Hitting: Σ raw counts (pa/ab/singles/doubles/triples/hr/bb/hbp/sac) → derive rates + store splits. Pitching:
  needs IP(=outs/3)/ER derivation (conf-stats ERA-via-DRS). Cross-check vs Master (corr 0.996, ~16 AB/team gap = TruMedia reconcile). STAGING+PROD.

- [x] team_season_stats RATE/COUNTING re-source PITCH-LOG-PRIMARY (Trevor 2026-08-19: pitch log = live/frequent, Master = occasional
  source-of-truth fill). scripts/sql/team_season_stats_rates_pitchlog.sql (2 UPDATEs, run separately). HITTING fully pitch-log
  (pitch_log_hitter_totals dim 'all' → rates + splits hr/2b/3b/bb/hbp/k). PITCHING counting pitch-log-native; RATES stay Master
  IP-weighted (interim — pitch_log_pitcher_totals lacks IP/ER). APPLIED STAGING 2026-08-19: 308/308; hitting corr 0.996 vs Master,
  pitch-log K9 corr 0.998; Georgia .324/.623 175HR. Supersedes the step-3 Master-sourced hitting rates. PROD: re-run from prod pitch_log_*_totals.
- [ ] FOLLOW-ON: full pitch-log PITCHING rates (ERA/FIP/WHIP/K9/BB9/HR9) via IP=outs/3 + earned-run derivation (conf-stats ERA-via-DRS
  machinery) so pitching is pitch-log-primary too. Currently Master IP-weighted (source-of-truth interim). + Master-reconcile/fill
  logic (COALESCE pitch_log with Master where a team is thin/absent — needed for low-TrackMan programs; no-op for 2026 D1).

- [x] refresh_team_season_stats(p_season, p_reg_end) — the ONE idempotent routine that rebuilds team_season_stats for a season
  (the descriptive STORE stage the unified upload edge fn calls via RPC after Masters + pitch_log_*_totals refresh). Migration
  20260819010000_refresh_team_season_stats.sql. Assembles all 10 sub-steps (base+WAR, hitting rates+splits pitch-log, pitching
  counting pitch-log, pitching rates Master, records, snapshot carry, conf context, faced ×2, park). DELETE-season-then-rebuild =
  idempotent. p_reg_end defaults to <season>-05-18. APPLIED STAGING 2026-08-19: select refresh_team_season_stats(2026) → 308 rows;
  reproduces pWAR corr 1.0000, team .277/.434, Georgia 53-14 (23-7), OSU faced 100.2/104.5, all 308 fully populated. PROD: create fn + call per season.

- [x] team_season_stats consolidation columns (WIRE C prep) — ALTER ADD hitter_war_reg/total, rotation_pwar_reg/total,
  bullpen_pwar_reg/total + folded into refresh_team_season_stats() (migration 20260819010000, re-created). hitter_war = Σ hitter
  total_desc_war (o+d+bsr); rotation = top-3 pitchers by IP, bullpen = rank 4+ (matches team_war_2025_aggregation.sql). Comparison
  uses REGULAR-SEASON desc WAR (_reg) — NO proration (Trevor: reg-season total is more accurate). APPLIED STAGING 2026-08-19:
  refresh(2026) → 308; rotation+bullpen=pwar (0 mismatch), hitter_war=o+d+bsr (0 mismatch); Georgia 24.0hit/7.0rot/6.1bp/37.1tot. PROD: same.

- [ ] ⚠ team_season_stats vs team_war_snapshots — DO NOT RETIRE team_war_snapshots (Trevor 2026-08-19). team_season_stats is
  descriptive-from-pitch_log = 2026-only; 2025 (prod: LSU champ + 39 conf champs + prior-year WAR) CANNOT be recomputed (no 2025
  pitch_log). FEDERATE BY ERA: team_season_stats canonical 2026+, team_war_snapshots kept for 2025 historical. Readers fall back to
  snapshots for pre-2026. The earlier "retire team_war_snapshots + seed scripts" plan is CANCELLED.

- [ ] ⚠ DATA FIX (ingest) — pitch_log.pitcher_full_name is CORRUPT (holds the BATTER's full name, not the pitcher's; confirmed
  2026-08-19: each pitcher_id has 1 pitcher_abbrev_name but 28-29 pitcher_full_names = batters faced). Reliable: pitcher_id +
  pitcher_abbrev_name. IMPACT = display-name only (all pitcher-keyed derived data uses pitcher_id → unaffected). Fix scripts/ingest_pitch_log.ts
  mapping + backfill pitcher_full_name from pitcher_id→Pitching Master. STAGING+PROD. See memory reference_pitch_log_pitcher_name_corrupt.

- [x] team_season_stats PITCH-LOG PITCHING RATES (Trevor's outs-tracking method) — folded into refresh_team_season_stats() step 4a/4b
  (migration 20260819010000 re-created). IP = Σ(max(outs)+1)/3 over pitching half-innings (corr 0.9932 vs Master IP). K9/BB9/HR9 =
  pitch-log counts×9/IP; WHIP=(BB+H)/IP; FIP=(13HR+3(BB+HBP)−2K)/IP+3.157 (cFIP D1 2026). ERA = Master IP-weighted (SOURCE-OF-TRUTH;
  pitch-log ERA noisy 0.825 due to earned-run attribution). APPLIED STAGING 2026-08-19: 308/308, Arkansas IP 532/K9 10.7/FIP 4.48/ERA 4.74;
  D1 avg K9 8.33/FIP 5.03/ERA 6.16. PROD: same (re-run from prod pitch_log). ⚠ ERA-source decision (Master) is overridable if pitch-log ERA preferred.

- [x] pitcher_full_name BACKFILL — APPLIED STAGING 2026-08-19. Mapping public._pitcher_name_fix (source_player_id→first||last from
  players, 15561 rows) + RPC public.fix_pnames(after,limit) keyset-looped over pitch_log 2026 (19 batches × 150k). Sets pitcher_full_name
  = real pitcher via pitcher_id. VERIFIED: each pitcher_id now 1 full_name matching pitcher_abbrev_name (was 28-29 = batters). PROD:
  build _pitcher_name_fix from prod players + run fix_pnames loop over prod pitch_log. CLEANUP: drop _pitcher_name_fix + fix_pnames after.
  ALSO fix the INGEST (scripts/ingest_pitch_log.ts:319 maps CSV 'fullName' → pitcher_full_name, which is the batter) so new rows are correct.

- [~] park_code / game_string BACKFILL — RUNNING STAGING 2026-08-19 (saved big-write process: raised role statement_timeout +
  single UPDATE in background). Source: docs/drs-reference/*DRS Pitch Log.csv (2.63M rows, uniqPitchId+gameString). Loader
  scripts/backfill_park_code_load.ts → temp public._park_code_fix (uniq_pitch_id, game_string, park_code); park_code =
  gameString stripped of trailing 9 digits + 'cs-' (e.g. cs-ark01202603050 → ark01). 2,576,230 mapped (99.9%), 310 parks.
  UPDATE pitch_log SET game_string, park_code FROM _park_code_fix by uniq_pitch_id. PROD: same (load CSVs → _park_code_fix →
  raised-timeout UPDATE). CLEANUP: drop _park_code_fix + fix_parkcode after. FOLLOW-ON: rebuild pitch-log park factors keyed by
  park_code+team_id; re-key records/outings on game_string (fixes doubleheader merges + the 2 pitch-count artifacts). RESTORE role timeout to 2min after.

- [ ] WIRE C — team_season_stats frontend repoint — STASHED into the edge-fn/live-compute-repoint phase (Trevor 2026-08-19). Full spec
  in handoff/agent §WIRE C STASHED. Repoint 4 readers (useTeamWarSnapshots/GMAnalytics/AnalyticsTab/types) to team_season_stats (era
  fallback, _reg basis); pivot Lineup oWAR→full-team Hitter WAR (needs total_hitter_war plumbed into the hitter player_snapshot + re-precompute);
  relabel. Frontend-only (no prod migration) but noted here so it's not lost. Page-load verify.

- [x] team_season_stats records re-key on game_string (refresh_team_season_stats step 5) — now keys games on game_string (exact,
  doubleheader-safe) instead of the (team_id,date,venue,score-pair) heuristic. APPLIED STAGING 2026-08-20 (function re-created):
  308 teams, Georgia 53-14 (23-7), avg 55 games — consistent + now exact. Requires park_code/game_string backfill applied first. PROD: same.

- [x] team_season_stats DRS ra9 + reg-window pitching (refresh step 4c) — ALTER ADD ra9_total/ra9_reg/fip_ra9_total/fip_ra9_reg +
  populate from Master desc_ra9/desc_ra9_reg/desc_fip_ra9/desc_fip_ra9_reg (IP-weighted; reg by regular_season_ip). DRS-accurate
  run-prevention (careful earned+unearned attribution); ERA stays Master (earned). APPLIED STAGING 2026-08-20: 308/308, avg RA9 6.36
  > ERA 6.16 (unearned incl), Arkansas RA9 5.58/reg 5.52 vs ERA 4.74. PROD: same. (reg-window WAR + RA9 now covered; full reg-window
  avg/era/k9 rate-set needs a 'reg' dimension in aggregate_pitch_log_dimensions.ts — separate follow-on.)
- [x] INGEST pitcher_full_name — FIXED 2026-08-20 (code): ingest_pitch_log.ts now loads a pitcher_id→"First Last" map from players
  in main() and sets pitcher_full_name from it (fallback to CSV fullName only when unmapped) — self-fills correctly on EVERY ingest,
  source-independent. tsc clean. Ships with the branch (no migration). Original diagnosis retained:  the DRS-format CSVs (docs/drs-reference) have fullName=the PITCHER
  (Nathan Taylor = pitcherAbbrev N. Taylor), so ingest_pitch_log.ts:328 fullName→pitcher_full_name is CORRECT for that format. The
  original DB corruption came from a DIFFERENT/older source export (fullName=batter), already fixed by the backfill. ROBUST FIX =
  make the pitcher_full_name-from-pitcher_id resolution (fix_pnames / _pitcher_name_fix) a STANDARD post-ingest step so it's correct
  regardless of the source's fullName meaning. No mapping change needed for DRS CSVs.

- [ ] SD AUDIT + modeling fixes (feature/war-recalibration) — **D1 ONLY. SUPERSEDED BY `docs/PROD_PUSH_RUNBOOK_war_recalibration.md` Part C (the 13 steps).**
  **OUTCOME (2026-08-20, confirmed on latest staging ratings):**
  - **`whip_pr_sd` 24.59 → 37.13** (`pitchingEquations.ts:210` + model_config). Stale after the whip⁺ composite refit — 34% under-scaled.
  - **`obp_std_pr` 28.89 → 32.41** (model_config `r_obp_std_pr` + `t_obp_std_pr`) — returner AND transfer (it's StdDevOBPPowerRating).
  - **Conference env+ pitcher → ratio** `(conf/ncaa)×100` to match hitters (was z×20; only the player power ratings got the /50×100 rebuild — the conference lever was missed).
  - era/fip/k9/bb9/hr9 + ba/iso SDs verified consistent — leave. (b) Store all SDs/weights in model_config + admin (read-source for edge fns).
  - **⚠ TRANSFER weights/SD NOT settled** — do NOT re-run transfer projections until the transfer equation is finished + verified (runbook step 13b). Run RETURNERS only for now (step 13a). STAGING→PROD.

- [ ] **UNLOGGED MIGRATIONS discovered by audit 2026-08-20 (add to prod plan) — verify prod state for each:**
  - `20260805_player_season_defense_baserunning.sql` — CREATE `player_season_defense` (+ baserunning). **⚠ Header says staging-only; NEEDS A PROD PATH** — composite d/bsr-WAR depends on it. Populated by `scripts/load-drs-wsb-staging.ts`.
  - `20260806_pitch_log_widen_attribution.sql` — ALTER pitch_log add attribution cols (`atbat_desc`, event cols) + additive backfill from DRS CSVs. dRS/bsrWAR consume these.
  - `20260806_composite_war_and_refresh.sql` — composite cols + `refresh_composite_war()` v1 (÷10, **superseded** by `20260810_composite_war_d1_rescale` at ÷13.1 — fire the rescale version).
  - `20260724120000_target_board_twp_two_row.sql` — ALTER target_board add `position_slot` + swap UNIQUE constraint.
  - `20260724130000_neutral_snapshot.sql` — ALTER team_build_players + target_board add `neutral_snapshot jsonb` + backfill.
  - `20260630000000_player_slot_values_uniq.sql` — dedupe + UNIQUE index on player_slot_values (prod deduped by hand first).
  - Also LIST the Push-1 DB layer (default_build + pitch_log base migrations 20260619–20260629 + parks_dimensions + hitter_ball_flight_rv) as **"✅ already on prod (Push 1 2026-08-07) — verify"** so the manifest is complete.

- [ ] **ncaa_averages fill (2026-08-20):** `pitcher_exit_velo` / `pitcher_ev90` / `pitcher_in_zone_pct` are NULL on staging → set **= the hitter averages 1-for-1** (same batted-ball population), stored both sides via a function. STAGING+PROD.
- [ ] **Conference Stats legacy cols (2026-08-20):** prod has `iso_power_rating`/`obp_power_rating` (conference-level); staging restructured to `obp_plus`/`iso_plus` + `offensive_power_rating`. **RECONCILE display before any drop — these ARE read by ConferenceStatsPage; do NOT blind-drop.**
- [ ] **KNOWN LIMITATION (deferred):** `pitch_log.vaa` 0% + `classification_version` ~65% — upload miss, left as-is for now.

## TRANSFER LEVER BUILD (feature/war-recalibration, 2026-08-21+) — step-by-step
Building the transfer equation lever finalization. Each DB change logged here as it lands on staging. Detail: `docs/HANDOFF_team_season_stats_2026_08_19.md` §TRANSFER LEVER; `docs/PROD_PUSH_RUNBOOK_war_recalibration.md` Part A7.

- [ ] **`20260821000000_conf_pitcher_env_plus.sql`** — ADD `era_plus,fip_plus,whip_plus,k9_plus,bb9_plus,hr9_plus` (numeric) to `"Conference Stats"`. Per-conf pitcher env+ on the **ratio scale** `(conf/ncaa)*100` (was live-computed z×20 in 3 drifted resolvers). **APPLIED STAGING: ✅ YES (verified 2026-08-21 — era_plus…hr9_plus filled 30/30 clean D1).** Populate: `scripts/compute_conf_pitcher_env_plus.ts --apply` (clean 30 D1, NJCAA excluded; ncaa_averages means + IP-weighted WHIP mean 1.635; all 6 stored raw ratio — HR9 handled on the weight side). PROD: re-run populate on prod (regenerate, don't copy).

- [ ] **model_config transfer weights + SD mirror (2026-08-21)** — re-tuned transfer lever weights (target %impact) + cross-conf/park SD mirror. **APPLIED STAGING** via `scripts/store_transfer_weights_and_sds.ts --apply` (9 UPDATEs + 33 INSERTs, model_type='admin_ui', season 2026). **PROD: re-run the same script** (values match code `transferWeightDefaults.ts` + `pitchingEquations.ts`). ⚠ Hitter `t_*` weights EXISTED in model_config with old values and OVERRIDE code → the UPDATE is required or code changes don't take effect. Keys: hitter t_ba/obp/iso conference(.256/.288/.080)/pitching(1.15/.98/.86)/park(.270/.324/.111); pitcher transfer_* conference(era .106/fip .137/whip .175/k9 .115/bb9 .097/hr9 .043)/competition(era/fip .262/whip .238/k9/bb9/hr9 .297)/park(era/fip .135/whip .324/hr9 .111); SDs conf_env_sd_* + conf_comp_sd_* + park_sd_*.

- [ ] **TRANSFER RE-RUN (Step 2, 2026-08-21)** — recompute all transfer projections with the new stored env+ (ratio) + re-tuned weights. **APPLIED STAGING** (in progress): loop all 17 customer teams × hitter (`precompute-transfer-projections.ts --team <uuid>`) + pitcher (`precompute-pitchers.ts --team <uuid>`). Writes `player_predictions` `model_type='transfer' variant='precomputed' season=2027`. **PROD: re-run the same loop** (`:prod` variants) AFTER env+ columns populated + model_config weights stored on prod. Customer teams: Penn State, Virginia Tech, BYU, Ole Miss, Georgia, Cal Poly, Campbell, Georgia Southern, Kennesaw State, UAB, South Alabama, Kansas, Arkansas, Grand Canyon, Coastal Carolina, UCSB, Notre Dame.

- [ ] **DEPLOY `process-precompute-jobs` edge fn (2026-08-21)** — the NEW-TEAM precompute path (AFTER INSERT trigger on customer_teams → precompute_jobs → this worker) updated to mimic the settled transfer logic: hitter env+ STORED (ba/obp/iso_plus, was live AVG/0.280); from-team id-first via source_team_id (hitter+pitcher, was name-only); D1 pitcher eq overlays model_config transfer_* (was hardcoded). Hitter weights + pitcher env+ were already correct. **Trevor deploys** (staging + prod). Pre-existing Deno literal-type warnings unchanged (non-blocking).

- [ ] **SNAPSHOT REFRESH after transfer re-run (Step 6, 2026-08-21)** — refresh saved build + target snapshots from the new projections WITHOUT changing toggles. Two-step "automatic function": (1) `backfill-neutral-snapshot.ts --apply` refreshes `team_build_players.neutral_snapshot` + `target_board.neutral_snapshot` from current predictions (precomputed-transfer > regular-returner); (2) `heal-stale-snapshots.ts --apply` re-derives `player_snapshot`/`transfer_snapshot = f(new neutral, production_notes)` — toggles (production_notes) untouched. Applies to ALL builds incl. default rosters. **APPLIED STAGING 2026-08-21** (neutral 1174 bp + 167 tb; healed 1271/1271, 0 err; all 38 builds incl. 15 defaults; toggles preserved). **PROD: run same two-step** (`--prod --apply --yes`) AFTER the prod transfer re-run.

- [ ] **⚠️ CONFERENCE STATS PRODUCERS — codify before prod (2026-08-21)** — several Conference Stats columns that feed transfers are populated on staging by UNCOMMITTED hand-run SQL and won't reproduce on prod: `WRC_plus`, `hitter_talent_plus` (HTP), `run_env_factor` (park, no writer at all), `offensive_power_rating` (OPR, 0/30). Must commit producers (OPR compute, canonical-HTP compute, WRC_plus, run_env_factor) + the pitch-log raw-rate assembly. Full map + edge-fn spec: `docs/CONFERENCE_STATS_BUILD_PROCESS_2026_08_21.md`. Canonical HTP = OPR + 1.25(Stuff+−100) + 0.75(100−run_env_factor), stored + read (no live compute).

- [ ] **HTP canonical (park swap) + stored reads + pitcher re-run (2026-08-21)** — `scripts/derive_conf_opr_htp.ts --apply` fills `offensive_power_rating`=Overall_PR + confirms `run_env_factor`=conf-avg rg + stores canonical `hitter_talent_plus` = OPR+1.25(Stuff+−100)+0.75(100−run_env_factor) (park swap; stored value already had it, producer makes it reproducible). All HTP readers wired to STORED (precompute-pitchers, process-precompute-jobs edge fn, TeamBuilder, TransferPortal, ConferenceStatsPage) — live pre-swap compute removed. **PITCHER transfer re-run** on stored HTP (all 17 teams). **PROD: run derive_conf_opr_htp --apply then re-run pitcher transfers; redeploy edge fn.**

> ## ★★★★ VERY IMPORTANT — CONF-STATS PRODUCERS (2026-08-21) ★★★★
> Conference Stats columns feeding transfers were partly hand-run SQL on staging. **Committed producers exist now for run_env_factor / OPR / HTP (`derive_conf_opr_htp.ts`). STILL MUST commit: the raw-rate pitch-log assembly + WRC_plus** (currently a commented-out SQL) or they'll be EMPTY on prod and break transfers/HTP/Program Analytics. See runbook "CRITICAL PROD-PUSH BLOCKER" + `docs/CONFERENCE_STATS_BUILD_PROCESS_2026_08_21.md`.
> **✅ UPDATE 2026-08-21 (GAP 3, a960334): raw-rate assembly + WRC_plus NOW committed** → `scripts/sql/conf_stats_bucketA_assembly.sql` (runnable, idempotent, txn-wrapped, inlines `_team_conf`). ALL 6 conf-stats producers now committed. **Remaining gate:** staging idempotent re-run of that file vs backup `_confstats_backup_preassembly` (couldn't run 2026-08-21 — no staging conn; `supabase --linked` = PROD). **PROD run order:** the 6 conf-stats producers (incl. `conf_stats_bucketA_assembly.sql`, PASTE — do NOT `--linked` blindly, that's prod) → transfer re-run → snapshot refresh → redeploy `process-precompute-jobs` edge fn (now has faced-competition mirror + D1 conf-stats block guard, commits bf69bd1/1c7603a).

- [ ] **⚠️ PROD DATA FIX — NJCAA-D1 division re-tag (2026-08-21)** — 10 `"Conference Stats"` rows named `NJCAA D1 … District` carry `division='D1'` (should be `NJCAA_D1`, matching JUCO players). Makes `division='D1'` a clean 30 so any conf-SD consumer doesn't need a name filter (prevents JUCO contamination of conf-level SDs, e.g. inflated fip+). **APPLIED STAGING 2026-08-21 (Trevor, 10 rows).** **PROD: run this SQL:**
  ```sql
  update "Conference Stats"
  set division = 'NJCAA_D1'
  where season = 2026 and "conference abbreviation" like 'NJCAA%' and division = 'D1';
  ```

- [ ] **RLS: player_predictions team-scope (2026-08-23)** — `20260823000000_player_predictions_rls_team_scope.sql`. Replaces the `USING(true)` SELECT policy (globally readable) with team-scoped: `customer_team_id IS NULL OR superadmin OR is_team_member(customer_team_id)`. Shared global rows stay readable; per-team precomputed rows become own-team-only. Writes unchanged. No app change (read path already filters null-or-own-team). **DDL — apply on staging + prod (needs a staging connection; CLI-linked=PROD).** Also flagged: `nil_valuations` is likewise `USING(true)` (legacy manual table) — tighten separately if it should be team-confidential.

- [ ] **⭐ MARKET-VALUE re-price (2026-08-23)** — model + PTM finalized (per-conference exact-code, SINGLE model_config source). ORDERED:
  1. **Seed model_config** — `scripts/sql/seed_nil_tiers_model_config.sql` (PASTE; ⚠ MUST precede re-price — clears old `nil_tier_sec=1.5` that would override the new 4.0 + dead bucket keys). Values: SEC 4.0/ACC 1.5/Big12 1.2/BigTen 1.0/Independent 1.0/AAC+SunBelt+BigWest+MWC 0.8/default 0.5/juco 0.35.
  2. **Re-price 17 teams** — `precompute-transfer-projections` + `precompute-pitchers` per team (recomputes market_value/twp_* off new PTM; WAR unchanged; hitter market rides total_hitter_war).
  3. **Re-bake snapshots** — `resync-build-snapshot-markets.ts` + `resync-target-snapshots.ts` (snapshots bake market).
  4. **Verify** — roster totals SEC ~$4.4M / ACC ~$1.7M / Big12 ~$1M / BigTen ~$900k; TWP + Independent=1.0.
  5. **Redeploy** `process-precompute-jobs` edge fn (Trevor) — carries the unified per-conference PTM (buildNilTiers reads model_config nil_tier_<code>).
  Code committed (08c40e2→95f22a6). STAGING re-price NOT yet run (needs Trevor nod). Full: `docs/AGENT_LEARNINGS_market_value_reverse_engineer_2026_08_21.md` + `docs/HANDOFF_MASTER_war_recalibration_2026_08_23.md`.

- [ ] **⭐ total_hitter_war STORED DIRECTLY (2026-08-23)** — all 3 hitter producers (precompute-transfer-projections, process-precompute-jobs edge fn, backfill-2027-hitter-returners) now WRITE `total_hitter_war = o_war + d_war + bsr_war` in the upsert (was inline-only for market → left stale). ⇒ on PROD: the re-price re-runs (transfer per-team + returner backfill) fill total_hitter_war fresh; **`refresh_composite_war()` is REDUNDANT for the projection total** (still needed for the descriptive Master columns only — do NOT rely on it for `player_predictions.total_hitter_war` anymore). Code committed 572bd11/2d20a5f. Followed by STEP 7b display swap (o_war→total_hitter_war headline) — see `docs/AGENT_LEARNINGS_total_war_display_2026_08_23.md`.

## ★ TWP FLAG RECOMPUTE — is_twp detector run (feature/war-recalibration) — 2026-08-26
- [ ] **Run the canonical TWP detector `recomputeTwpStatus(2026, PA>=30, IP>=5)`** — `is_twp` was systemically
  unset (only **2** flagged on staging) because the detector — the only writer of `is_twp`/primary `position` —
  is reachable **only from a manual AdminDashboard button and had never been run on current-season data.** Effect:
  ~253 real two-way players (both a Pitching Master pitcher-Role line AND a Hitter Master line meeting threshold)
  were half-projected — the pitcher batch keys on `pitcherTest(position) || is_twp`, so a TWP labeled OF with
  `is_twp=false` had its **pitching side dropped** (stale, unrefreshed projection; e.g. Evan Dempsey FGCU 88.7 IP /
  3.9 pWAR off the pitcher board). The reported "stale orphan pitching rows" were this symptom.
  **THRESHOLD = PA>=30 & IP>=5** (detector default; Trevor-confirmed 2026-08-26). Rationale: flag is **re-derived from
  each season's actuals every run + has a demotion ladder**, so an inclusive threshold never permanently strips a
  developing two-way player's dual-position eligibility (next year's data re-flags/demotes). 50/10 is the cleaner
  one-year sample but only matters if the flag were permanent — it isn't.
  **APPLIED STAGING 2026-08-26** via `scripts/run-twp-recompute.ts --apply` (thin runner over the canonical lib fn;
  Node-CLI service-role client; added a backward-compatible `dryRun` param to `recomputeTwpStatus`). Result:
  `is_twp` **2 → 253** (D1=90 / JUCO=163): 207 net-new + 45 legacy-`position='TWP'`-string migrated + 1 unchanged;
  **0 P→hitter position flips** (the detector only sets hitter-primary when a valid Hitter Master Pos exists — 96
  pitcher-side TWPs stay `position='P'` and just gain the flag); cleanup: 31 demoted→pitcher, 65 cleared→null
  (alumni, no 2026 data), **34 left as `position='TWP'`** (tiny mixed samples + invalid hitter Pos → flagged for
  MANUAL data fix, `is_twp=false`); 0 errors. Dry-run previewed first (dry-run-first discipline).
  **PROD:** run the same `scripts/run-twp-recompute.ts --apply` against prod (regenerate from prod Masters — do NOT
  copy staging flags). MUST run BEFORE the returner/transfer precomputes on prod (so both-side rows generate).
  **FOLLOW-ON (dedicated pass, still on staging — NOT yet run):** re-run returner pitcher+hitter precomputes →
  re-bake TWP markets (`rebake-twp-markets` / `rebuild-twp-target-rows` / `fix-returner-twp-hitter-market`) →
  re-bake snapshots (`heal-stale-snapshots` / `backfill-neutral-snapshot` / `resync-*`) → verify known TWPs
  end-to-end (both sides + combined NIL + both roster slots + sane team WAR). The 34 manual-fix `position='TWP'`
  residuals are a separate data-quality cleanup.

## ★ HR9-ONLY FLOOR + TWP PRECOMPUTE RE-RUN (feature/war-recalibration) — 2026-08-26
Companion to the TWP FLAG RECOMPUTE entry above + the two-sided-SD calibration. Full writeup:
`docs/AGENT_LEARNINGS_twp_flag_systemic_gap_2026_08_26.md` + `docs/HANDOFF_twp_flag_pass_2026_08_26.md`.

- [ ] **HR9-ONLY code floor (CODE, no migration)** — narrowed the earlier blanket `Math.max(0, projected)` to HR9
  ONLY (Trevor: "only on HR9 should there be a floor, everything else should work as is"). `pitcherProjection.
  projectPitchingRate` + `transferPitcherProjection.projectLower` gain a `floorAtZero` param, passed `true` only from
  the HR9 call site; `projectHigher` (K9) un-floored. Every non-HR9 rate stays UNfloored so a negative (which the
  two-sided SD should prevent) surfaces as a real bug, not silently masked (audit doctrine). `npm test` 265 pass, 0
  new tsc errors. **Ships with the branch code (no DB step); prod picks it up when the prod precomputes re-run.**
- [ ] **TWP precompute re-run (STAGING done 2026-08-26; PROD = re-run after the prod detector run):**
  - `precompute-returner-pitchers` — pool 7628→**7829** (+201 TWPs join via `pitcherTest(position) || is_twp`);
    7633 upserted, propagated to 110,383 rows. **0 negative pitching rates across 104,401 rows** (floor holds).
  - `backfill-2027-hitter-returners` — 8235 updated, 0 errors; writes `twp_hitter_market_value` + NULLs shared
    `market_value` for D1 TWPs.
  - **PROD ORDER:** run the TWP detector (`run-twp-recompute.ts --apply`) FIRST, THEN both returner precomputes,
    THEN the transfer per-team precomputes, THEN re-bake markets/snapshots. (Detector before precomputes so both-side
    rows generate.)
- [ ] **⚠ JUCO TWP MARKET GAP — KNOWN, DEFERRED to the JUCO workstream (Trevor 2026-08-26).** The JUCO precompute
  branches write only the shared `market_value`, never the `twp_*_market_value` split → the 163 JUCO TWPs show no
  market on TWP surfaces (90 D1 TWPs correct). **Decision: keep all 253 flagged; fix the JUCO branches (write the
  split + null shared for `is_twp`) BEFORE JUCO ships.** NOT a blocker for the D1 push. Re-run JUCO snapshot markets
  after that fix. Detail in the agent-learnings doc.

## ★ TWP TRANSFER RE-RUN + SNAPSHOT RE-BAKE (feature/war-recalibration) — 2026-08-26
Completes the TWP flag pass. STAGING done + verified; PROD = same sequence after the prod detector run + returner
precomputes. Full state: `docs/HANDOFF_twp_flag_pass_2026_08_26.md`.
- [ ] **Transfer re-run** (`_run_step2_all.sh` = `precompute-transfer-projections` + `precompute-pitchers` × 18
  customer teams) — the TWP transfer rows were stale/single-sided (2,186 of 2,221 pre-run). After: 1,529 D1-TWP
  transfer rows carry the `twp_*` split across all 18 teams. STAGING 2026-08-26.
- [ ] **Snapshot re-bake** (STAGING 2026-08-26, all `--apply`): `rebuild-twp-target-rows` · `rebake-twp-markets` ·
  `backfill-neutral-snapshot` (bp=1205/tb=167) · `resync-target-snapshots --all` (9) · `resync-build-snapshot-markets
  --all` (6, legit market→0 for negative-WAR). `heal-stale-snapshots` drift=0. VERIFIED: Dempsey combined NIL $66,114;
  Overbeek target board 2 rows/team (both slots), SEC-scaled. 0 TWPs on build rosters.
- [ ] **⚠ 88 D1-TWP one-sided transfer rows** (35 pitch-only / 53 hit-only) write shared `market_value` not the split
  → same mechanism as the JUCO TWP market gap; **DEFERRED with it** (make the single-side transfer write path
  TWP-aware). 5% of D1-TWP transfer rows; the 1,529 two-sided majority is correct.

## ★ NORTH CAROLINA (18th team) RE-RUN + DYNAMIC TEAM LIST — 2026-08-26
Resolves the "88 D1-TWP one-sided rows" (they were NOT a code gap): all 88 were on **North Carolina** (`e0defb42`),
the 18th customer team (added 2026-08-25), which was **missing from the hardcoded 17-team `_run_step2_all.sh`** → NC's
whole transfer set (10,207 rows) was stale (old model + pre-TWP-flag).
- [ ] **NC transfer re-run** (`precompute-transfer-projections` + `precompute-pitchers --team e0defb42`) — STAGING done
  2026-08-26 (5,023 hitters / 5,118 pitchers). D1-TWP transfer rows now **1,617 split / 0 shared-only.** **PROD: covered
  automatically by the dynamic runner below (NC is an active customer team).** The earlier "88 deferred with JUCO"
  note is SUPERSEDED — only the JUCO TWP market split remains deferred.
- [ ] **Dynamic customer-team list (CODE — prevents recurrence):** `scripts/list-customer-teams.ts` (NEW) reads active
  teams from the LIVE `customer_teams` table; `scripts/_run_step2_all.sh` rewritten to consume it (`--prod` supported).
  No DB change — but it means the prod per-team re-run now covers ALL active customer teams, not a stale array.
- [ ] **Edge-fn new-team automation (context):** the `customer_teams` AFTER-INSERT trigger → `precompute_jobs` →
  `process-precompute-jobs` works (fired for NC at creation). Remaining: the edge fn runs the OLD symmetric model —
  the edge-fn mirror (two-sided SD + HR9 floor + TWP-aware) must land so new teams are correct at birth. ⚠ PROCESS:
  every projection-model change must update BOTH the offline batches AND the edge fn.

## ★ EDGE-FN MIRROR — two-sided SD + HR9 floor (feature/war-recalibration) — 2026-08-26
- [ ] **`process-precompute-jobs` mirrored to the current model** (was OLD symmetric): 6 `_plus_ncaa_sd_bad` keys added
  to `PITCHING_EQ_DEFAULTS` (overlay loads live model_config values) + avg/sd defaults refreshed to 2026 calibration;
  `dsd` directional-SD helper wired into all 6 projection call sites; HR9-only floor (`Math.max(0, projectLowerP(...))`),
  other rates unfloored. D1 path already TWP-aware (no change). Deno check: 0 NEW errors (2 pre-existing).
  **DEPLOYED STAGING branch `slrxowawbijbjrkozqlj` 2026-08-26 (v26→27).** Prod `main` (`trbvxuoliwrfowibatkm`) v12 UNCHANGED.
  ⚠ staging is a persistent BRANCH of prod under ONE project — the prod-account CLI login reaches both; target with explicit
  `--project-ref` (NEVER `--linked` = prod). **PROD (Trevor drives):** `supabase functions deploy process-precompute-jobs
  --project-ref trbvxuoliwrfowibatkm`. Keep the edge fn in lockstep with src/lib on every future projection-model change.

## ★★★ DEFINITIVE PROD PUSH ORDER → docs/PROD_PUSH_STEPS_2026_08_26.md (2026-08-26)
The authoritative top-to-bottom execution order (51 steps, Phase 0→H) with the 4 pre-prod blockers resolved. Use it as
THE runbook. Blocker resolutions this session:
- [ ] **dWAR/bsrWAR prod path (blocker 1) — SOLVED.** `scripts/load-drs-wsb-staging.ts` + `scripts/drs/populate_descriptive_war.mjs`
  + `populate_descriptive_war_reg.mjs` all now take `--prod` (reads `.env.production.local`, refuses on env mismatch) + the
  loader gains `--dry-run`. Were staging-hardcoded. PROD dWAR/bsrWAR = migration 20260805 → `load-drs-wsb-staging.ts --prod`
  (raw dRS/wSB into player_season_defense/baserunning, reuses the env-independent output CSVs) → `populate_descriptive_war.mjs
  --prod --commit` (desc_owar/d_war/bsr_war/total) → `populate_descriptive_war_reg.mjs --prod --commit` (desc_*_reg). Steps 30–34.
  Verified on staging (dry-run: 13,454 defense / 10,408 bsr rows; d_war mean 0.01, bsr_war 0, centered).
- [ ] **Venue corrections (blocker 2) — NEEDS BUILD.** `venue_correction_persist.sql` + its producer were NEVER committed
  (pasted to staging; scratchpad cleaned; 310-row fixture gone). A producer `scripts/compute_venue_corrections.ts` must be
  written (LOO + empirical-Bayes from prod pitch_log) BEFORE prod Stuff+. Spec + view contract in PROD_PUSH_STEPS step 12.
- [ ] **Conf-stats bucketA gate (blocker 3)** — re-run `conf_stats_bucketA_assembly.sql` on STAGING vs `_confstats_backup_preassembly`
  (diff 0.0000) before trusting it on prod. Step 28.
- [x] **Returner prod path (blocker 4) — RESOLVED = batch scripts** (`precompute-returner-pitchers:prod` +
  `backfill-2027-hitter-returners:prod`). The edge-fn `recalculate-prediction` returner rebuild is DEAD — ignore old runbook steps 5–9/G3.

## ★ VENUE CORRECTIONS PRODUCER + PITCH-LOG INTEGRITY (feature/war-recalibration) — 2026-08-26
- [x] **Blocker 2 SOLVED — venue-corrections producer rebuilt:** `scripts/compute_venue_corrections.ts` (NEW; LOO +
  empirical-Bayes, `--prod`/`--apply`/dry-run guarded). Reproduces the lost original: τ 0.622/0.662 (memory 0.63/0.66),
  centering ≈0, n_pitchers 310/310 exact, worst park −2.57; matches the stored staging fixture within **0.011″**. Schema
  = existing `venue_movement_corrections` (game_venue_id/ivb_corr/hb_corr/b_ivb/b_hb/n_pitchers/n_pitches) + full-passthrough
  `pitch_log_corrected` view. **Did NOT overwrite staging** (existing fixture is the validated in-use one). PROD: run
  `--prod --apply` AFTER pitch-log GATES 0+1 (see PROD_PUSH_STEPS "PITCH-LOG INTEGRITY").
- [ ] **★ PITCH-LOG INTEGRITY GATES (prod prerequisite for ALL pitch-log derivations)** — locked into
  `docs/PROD_PUSH_STEPS_2026_08_26.md`. **GATE 0 DEDUP:** prod pitch_log has ~3,425 duplicate PHYSICAL pitches under
  DISTINCT `uniq_pitch_id`s (staging is clean, verified 0). ⚠ a `uniq_pitch_id` distinct-count shows 0 and MISLEADS —
  detect via `runs IS NULL` junk (~3,509) + total ≈ 2,576,230; fix = `DELETE … WHERE runs IS NULL` after widen (or Approach
  B rebuild). **GATE 1 MOVEMENT COMPLETE:** the venue fixture is computed from ivb/hb, so finish all movement population
  FIRST (staging's audit backfilled ivb/hb on ~19,338 existing pitches AFTER its first fixture → 0.011″ drift; not new
  rows, 0 dups — verified). THEN venue corrections → Stuff+ → conf-stats → team_season_stats. Research: no duplicate
  uniq_pitch_id on staging; drift = in-place movement backfill, not double-import.

## ★ COMPREHENSIVE PROD-PUSH DOCUMENTATION (feature/war-recalibration) — 2026-08-26
Full branch cataloged (785 files) into the authoritative doc set. Use these for the push:
- **`docs/PROD_PUSH_STEPS_2026_08_26.md`** — THE runbook. Ordered steps (Phase 0→H) + PITCH-LOG INTEGRITY gates
  (dedup + movement-complete) + **CALCULATION REFERENCE** (every formula/constant/output) + **SCHEMA/SQL CHANGE
  REFERENCE** (all 101 migrations: what each touches, idempotency, regenerate-on-prod flags) + PROD LANDMINES.
- **`docs/STAGING_DISPLAY_TEST_CHECKLIST_2026_08_26.md`** — every UI change to verify on staging before push, with
  PASS/FAIL per item (WAR-label swap, transfer market conference, TWP both-sides, TB WAR-sort, GM interface, /savant deletion).
- **`docs/PRE_PROD_AUDIT_2026_08_26.md`** — readiness verdict + stale-doc reconciliations.
- [ ] **NEW LANDMINE — model_config conflict:** `wrc_c1_model_config` sets `owar_replacement_runs_per_600=26.2`,
  `step8_model_config_2026` sets **21.22** (current refit). ★ Run `step8` LAST/authoritative so 21.22 wins.
- [ ] **NON-IDEMPOTENT migrations** (guard/one-time care): bare CREATE POLICY (June 20260622/23), `RENAME total_war`
  (20260806), `TRUNCATE gm_allocation` (20260710120000), `team_season_stats_war_rollup` INSERT (dupes on re-run —
  use the refresh fn), player_slot_values dedup DELETE. Full list in PROD_PUSH_STEPS landmines.
- [ ] **ORDER:** `20260821010000` (ts war cols) BEFORE first `refresh_team_season_stats(2026)` (else empty table).
- **TWO UI items to confirm before push:** `HistoricalPlayerTable` pitcher link → `/player/:id` (verify resolves);
  `/savant/*` deletion (Leaderboards/Conf Stats page/Team Profiles removed, no replacement — confirm intended).

## ★ PROD-PUSH HANDOFF + PlayerHub fix (feature/war-recalibration) — 2026-08-26
- [x] **`docs/HANDOFF_PROD_PUSH_2026_08_26.md`** — the "start here" prod-push handoff (state, doc map, phase flow +
  gates, verification, safety). Companions: PROD_PUSH_STEPS (51 steps + calc/schema refs), PRE_PROD_AUDIT,
  STAGING_UX_WALKTHROUGH, STAGING_DISPLAY_TEST_CHECKLIST.
- [x] **PlayerHub historical-player fix** (`src/pages/PlayerHub.tsx:176`) — identity query now resolves a uuid OR a
  legacy source_player_id (Historical tables link by source_player_id). Fixes pitcher/hitter misclassification +
  blank season-stats preview for historical players. tsc clean; page-load verify is in the UX walkthrough §9.
- **model_config `owar_replacement_runs_per_600` RESOLVED:** staging = **21.22** (verified; = 1.62 repl × 13.1 RPW,
  data-driven from the .380 win% anchor). PROD: run ONLY `step8_model_config_2026` (has 21.22); do NOT run
  `wrc_c1_model_config` (stale 26.2). Currently a seeded constant the edge fn reads — future: auto-derive in a calibration stage.

## ★ TEAM BUILDER WAR/MARKET + dWAR opportunity (feature/war-recalibration) — 2026-08-26
- [ ] **dWAR opportunity-scaling — NEEDED, safe to DEFER past first prod push (Trevor).** dWAR does not scale with
  defensive opportunity/innings (depth role) the way oWAR scales with PA — a depth-role change moves oWAR but not dWAR.
  Full writeup: memory `project_dwar_opportunity_scaling`. Not a prod blocker; required follow-on.
- [ ] **TB WAR column mislabeled** — `RosterTab.tsx:177` header says "oWAR" but the value is already `total_hitter_war`
  (via `pickHitterWar`, clean rows). FIX = relabel header "oWAR"→"WAR" (+ the `:294` tooltip). Value compute NOT changed.
- [ ] **TB market disconnect (INVESTIGATED)** — the live/dirty hitter path (`useTeamBuilderSimulation.ts:1101-1105`)
  computes market from OFFENSE oWAR (`owarAdj`), not `total_hitter_war`. Clean rows read the stored (total-based) market;
  toggling recomputes off offense-only → diverges most for bad defenders. FIX (confirm w/ Trevor): base the live market
  on total (offense recomputed + stored d_war/bsr_war). Returner path has the same shape.
- [ ] **Fill 16 build-snapshot totals** — 16 of 578 hitter build-snapshots have `o_war` but null `total_hitter_war`
  (fill missed some non-default builds). FILL every build's snapshot `total_hitter_war = o_war + d_war + bsr_war`,
  **without changing any saved toggle** (dev_agg/depth/nil untouched). STAGING + PROD (re-run after prod snapshots baked).
- [ ] **★ Hitter descriptive Run Values on Season Stats banner — PROD needed (schema + fn + populate)** —
  (1) apply `supabase/migrations/20260826150000_hitter_descriptive_run_values.sql` (6 cols on
  `pitch_log_hitter_totals`, additive/idempotent) + `20260826150500_populate_hitter_run_values_fn.sql`
  (the `populate_hitter_run_values(season)` fn); (2) after the season-stats aggregation
  (`aggregate_pitch_log_dimensions.ts --apply`, which now CALLS the fn at the end) has filled the totals
  tables, the `all`-row run values + national z-scores are populated — or run `select
  populate_hitter_run_values(2026);` standalone if the totals already exist. Descriptive last-season values
  (batting = wRC+-derived, defensive = drs_floor, baserunning = wsb_runs) + `*_z` over qualified pop
  (`pa≥50`/`half_innings≥50`/`opportunities≥20`). Display pure-reads. ⚠ **When Track B (unified edge fn)
  absorbs stage 3b, it MUST also call `populate_hitter_run_values(season)`** (season-stats aggregation is
  currently a HAND-RUN script, not an edge fn). STAGING done 2026-08-26 (6,099 `all` rows; coverage
  batting 6,053 / def 5,138 / bsr 5,346; Souza verified). Full writeup:
  `docs/AGENT_LEARNINGS_hitter_run_values_2026_08_26.md`.
- [ ] **FRONTEND / DISPLAY — ships with the branch merge to main (Vercel prod build); NO separate DB step** —
  (a) **What's New modal** new `2026-08-26` release (4 features: Complete WAR / Market Valuations / Run Values /
  Sharper Projections), `STORAGE_KEY` v8→**v9** so it fires for all users on deploy — this IS the deferred
  "post-push WhatsNewModal note," now in-branch; (b) **run-value VALUE panel** on hitter Season Stats (needs the
  data from step 13b + `populate_hitter_run_values`); (c) **"oWAR"→"WAR"** header relabel (RosterTab / TargetBoardTab);
  (d) **PlayerHub** historical id resolution (uuid OR source_player_id). Copy rules honored (no overclaim / no
  disparaging past / no em-dashes). Full record: `docs/AGENT_LEARNINGS_ui_and_whats_new_2026_08_26.md`. Verify via
  `docs/STAGING_CLICKTHROUGH_2026_08_26.md`.
- [ ] **★ Snapshot hitter market RE-PRICE (stale-PTM fix) — PROD needed** — `recompute-snapshot-hitter-market.ts --prod --apply`
  (runbook **step 42b**, Phase F, AFTER market resyncs). Snapshot `market_value` re-derived = `total_hitter_war × $25k ×
  PTM(build-program conf) × PVF(players.position)`, dollar field ONLY, all toggles preserved. Fixes snapshots frozen at the
  OLD SEC 1.5 PTM (~$42.5k/win) from before the SEC-4.0 re-price — the profile/TB pure-read the snapshot so stale $ shows
  verbatim (Souza showed $50,983 for 1.20 WAR; correct = $131,823). Root confirmed: profile/TB are NOT live-computing — they
  read the active build snapshot; only the baked dollars were stale. **PVF stays in the market** (pricing layer, Allocation
  Spec §7.2); it is removed only from the Player SCORE (`calcPlayerScore`, §1). ⚠ **Script gotcha now fixed (keep on prod):**
  filter null/non-UUID pids + error-check the `players` position `.in` batches — one literal-`null` player_id else poisons a
  whole batch (invalid-uuid), silently dropping ~200 real players' positions → PVF wrongly flattens to 1.0. STAGING done
  2026-08-26 (472 rows, then 38 position-corrections; idempotent, 0 impossible/negative markets).

---

## POINTERS — the Stuff+ chain and classifier facts live in the docs, not the ledger
- Lane map + chain order: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`
- Exact numbers (classifier thresholds, equations, §11 accuracy): `docs/STUFF_PLUS_EXACT_VALUES.md`
- Prod execution order: `docs/PROD_PUSH_STEPS_2026_08_26.md`

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

## ★ PRE-PUSH DEFECT PASS — 2026-08-30 (feature/war-recalibration). NO DB WRITES MADE.
All findings below come from READ-ONLY probes (`information_schema`, `pg_proc`, `select`) against BOTH projects.

### ⛔ NEEDS TREVOR'S GO — `team_season_stats` migrations (the biggest remaining blocker)
- [ ] **THREE migrations are absent from prod** — not two. Probe 2026-08-30: prod
  `to_regclass('public.team_season_stats')` = **NULL**, and `pg_proc` has **no** `refresh_team_season_stats`.
  Staging has the table (128 cols, PK `(source_id, season)`, 4 indexes, 308 rows for 2026) and the function
  `(p_season integer, p_reg_end date)`.
  **Apply in EXACTLY this order:**
  1. `supabase/migrations/20260819000000_team_season_stats.sql` — CREATE TABLE + 3 indexes + RLS
  2. `supabase/migrations/20260821010000_team_season_stats_war_columns.sql` — 10 `ADD COLUMN IF NOT EXISTS`
  3. `supabase/migrations/20260819010000_refresh_team_season_stats.sql` — CREATE OR REPLACE FUNCTION
  **Order is load-bearing:** the function's body writes the step-2 columns, and its first statement is
  `DELETE FROM team_season_stats WHERE season = p_season`. Apply 3 before 2 and the first `refresh_team_season_stats(2026)`
  deletes the season and then **aborts** on `column "hitter_war_total" does not exist` — table left EMPTY.
  All three are `IF NOT EXISTS` → idempotent.
  **Verification query + the full copy-pasteable plan: `docs/PROD_PUSH_STEPS_2026_08_26.md` Phase-A step 10a.**
  Blocks **F44** (`select refresh_team_season_stats(2026);`) and **G46** (edge fn reads the table at
  `supabase/functions/process-precompute-jobs/index.ts:1095`,`:1419`).
  ⚠ Known drift, deliberately NOT in the plan: staging has a 128th column `preseason_proj_total_war` from a hand-run
  ALTER that no committed migration contains and **zero** code references (grepped migrations/functions/scripts/src).
  Prod-after-plan = 127 columns. Do not hand-add it; if wanted, write a committed migration first.

### ✅ CODE FIXES LANDED THIS SESSION (no DB writes)
- [x] **`scripts/resync-build-snapshot-markets.ts` was hardcoded to `rd(".env.local", …)`** — neither `--prod` nor
  `--env-file` could redirect it, so an F42 "prod resync" would silently resync **STAGING** and report success.
  Now env-driven (`process.env` first, env-file fallback) + double-keyed guard. Same guard added to
  `resync-target-snapshots.ts`, `rebuild-twp-target-rows.ts`, `rebake-twp-markets.ts`,
  `fix-returner-twp-hitter-market.ts` (the last two were bare `process.env.SUPABASE_URL` with **no** guard at all).
  Invoke on prod as `npx tsx --env-file .env.production.local scripts/<x>.ts --prod --apply`.
  All 10 refuse paths + both allow paths smoke-tested against both projects.
  ⚠ `resync-build-snapshot-markets`'s default scope is the **staging** build id `7429b448-17be-42a1-9434-86f54ab24e49`,
  which returns **0 rows on prod** — use `--all` there. Script now warns on a 0-row non-`--all` scope.
- [x] **`src/lib/computeNcaaAverages.ts` unordered `.range()`** — corrupted the means/SDs every projection divides by.
  Fixed with a `PAGINATION_KEYS` map of each table's ACTUAL primary key; unregistered tables now **throw** rather than
  paginate unordered. ⛔ **Never replace this with a blanket `.order("id")`**: `pitch_log_pitcher_totals`,
  `pitch_log_hitter_totals`, `player_season_defense`, `player_season_baserunning` have **no `id` column** on either
  project. Smoke-tested `.order(key).range(0,2)` — 7/7 ✓ on staging AND prod.
- [x] **`computeNcaaAverages` Stuff+ weight moved off the LEGACY lane.** Was summing
  `pitcher_stuff_plus_inputs.pitches`; now sums `pitch_log_pitcher_totals.stuff_plus_data_pitches` at
  `dimension_key='all'`, joined `pitcher_id` ↔ `Pitching Master.source_player_id`. The silent `.catch(() => [])` is
  REMOVED — a fetch failure used to become `stuff_plus = NULL`, which makes `computeAndStoreScores`
  `fetchSeasonBaselines` fall back to hardcoded defaults **silently**.
  Measured (read-only `dryRun` of `computeAndStoreNcaaAverages(2026)`): staging 102.0846 → **102.0846** (unchanged);
  **prod 101.8361 → 102.3337** (+0.4976). Prod's stored `ncaa_averages(2026).stuff_plus` is 101.8341 today, so expect
  it to move to ≈102.33 when C27 runs. **Log the value you actually get.**

### ✅ DOC ORDERING CORRECTIONS (each now carries a one-line reason so it isn't "corrected" back)
- [x] **C26 `computeAndStoreScores` runs AFTER C27 `computeNcaaAverages`** — `computeAndStoreScores.ts:206-211` reads
  its baselines (incl. `stuff_plus`/`stuff_plus_sd`, `:249`) from `ncaa_averages`; missing fields fall back to
  hardcoded defaults silently (`:212-215`). Fixed in `PROD_PUSH_HANDOFF_RESUME_2026_08_26.md` (was still 26→27) and
  annotated on the C11/C12 rows of `PROD_PUSH_BULLETPROOF_CHECKLIST.md`. STEPS + RUNBOOK already agreed.
- [x] **C29 NJCAA_D1 re-tag runs BEFORE C28 conference stats** — verified read-only 2026-08-30: prod season 2026 has
  40 `division='D1'` Conference Stats rows of which **10 are `NJCAA%`**; staging is already 30 `D1` + 10 `NJCAA_D1`.
  Both C28 producers (`compute_conf_pitcher_env_plus.ts:29`, `derive_conf_opr_htp.ts:12`) filter `.eq("division","D1")`.
  Fixed in RESUME; annotated on the E5/E6/E8 rows of the CHECKLIST.
- [x] **Dead step 47 (`recalculate-prediction` returner rebuild)** marked DEAD at `RUNBOOK` PART C step 5,
  the PART B section header (steps 5/6/7/9 — only step 8 is still live work), and PART E Phase 1.
  `RUNBOOK:213` (G3), `RUNBOOK:239`, `CHECKLIST` G2 and `STEPS` step 47 were already marked.
- [x] **Bad `.order("id")` advice removed** from `STEPS` step 31 and `RESUME` Phase D — `player_season_defense` /
  `player_season_baserunning` have no `id` column; use their real PKs.

### ⚠ CONTRADICTIONS FOUND IN THE EXISTING DOCS (corrected in place)
- `STEPS` "ALREADY ON PROD" listed **`team_season_stats` … DONE** while a 🛑 twelve lines below said it does not exist.
  The 🛑 is right; the DONE line was struck through.
- `STEPS` "NEEDED" list calls A8 (`Conference Stats.hitter_talent_plus`/`run_env_factor`) and A9
  (`Park Factors.*_seasonal`) **MISSING** on prod. Probed: the **columns exist on prod**; it is the **values** that are
  absent (`hitter_talent_plus` 0/42 non-null, `rg_factor_seasonal` 0/309). Same for the Master `desc_*` columns
  (present; 0/5,340 populated). Documented as a table on Phase-A step 10a. The distinction matters — no DDL is needed
  for those, only the E2/E5/E6 and D31/D32 producers.

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
⚠ **OPEN, NOT RESOLVED:** a read-only check on 2026-08-30 found prod's own data and staging's stored values agree for 303/308 teams (mean |Δ| 0.124) but differ on **Arkansas: 32.800 vs 41.060 (Δ −8.26)**. Which is correct is **UNDETERMINED** — prod's `players` table is LARGER (31,467 vs 15,561) — but that is **HISTORICAL DEPTH going back multiple years, NOT a discrepancy** (Trevor, 2026-08-30). Do not read it as prod being more complete for 2026. **Do not reconcile prod TO staging.** Run the producer on prod, sum per player under the team, and then investigate the difference on its own merits.

## ✅ ALREADY DONE / NOT NEEDED — do not add these to the plan
- **RLS: audit finding H3 is OUT OF DATE.** `relrowsecurity = true` with **0 policies** on `player_season_defense` AND
  `player_season_baserunning`, on **BOTH** envs = **deny-all** to anon/authenticated. The broad table grants are inert
  because RLS gates first. `service_role` bypasses RLS so the D30 loader is unaffected. **No RLS work to do.**
- **D30's data is already on prod** at the current engine version: `player_season_defense` **13,454 rows** (9,268 players,
  `drs-engine-0.11.0`, zero NULLs in drs_floor/total/ceiling; 4,343 are position='P', excluded from d_war by design) ·
  `player_season_baserunning` **10,432 rows** (`drs-engine-0.6.0`). Prod has 24 MORE baserunning rows than staging
  (prod `players` carries multiple years of HISTORICAL rows — 31,467 vs 15,561 — which is expected, not a discrepancy). **D30 is a no-op re-run — dry-run to confirm, then skip.**
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
line), so the 0 may have come from a truncated or stale capture. ✅ **RESOLVED — the clean re-run confirmed `0` was REAL, and the root cause is now found: a wrong argument in the `repRows` call at `:465` (`"batting_team_id"` passed where `"batter_id"` belongs), whose timeout error is then discarded at `:451`. See the ROOT CAUSE block.**
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

---
# 🐛🔴 ROOT CAUSE FOUND — `derive_masters_from_pitchlog.ts` CAN **NEVER** CREATE A HITTER MASTER ROW (2026-08-30)
**This is a REAL, CONFIRMED BUG, not a capture artifact. It is a TRACK B BLOCKER.** Found by chasing why prod is
missing Camden Kozeal's 2026 Hitter Master row; the missing row is the *symptom*, this is the *cause*.

## THE DEFECT — AN ARGUMENT IN THE WRONG POSITION
```ts
async function repRows(ids, idCol, teamCol, abbrevCol, handCol) {        // :444
  … await sb.from("pitch_log").select(`${teamCol}, ${abbrevCol}, ${handCol}`)
        .eq("season", SEASON).eq(idCol, id).limit(1);                    // :451  ← filters on idCol
  if (data && data[0]) map.set(id, data[0]);                             // ← `error` is DISCARDED
}

repRows(newHitterIds,  "batting_team_id", "batting_team_id", "batter_abbrev_name", "batter_hand");  // :465 ❌
repRows(newPitcherIds, "pitcher_id",      "pitching_team_id", "pitcher_abbrev_name","pitcher_hand"); // :486 ✅
```
The **pitcher** call correctly passes `"pitcher_id"` as `idCol`. The **hitter** call passes **`"batting_team_id"`** —
the TEAM column — in the ID-column position. So it executes
`pitch_log WHERE season=2026 AND batting_team_id = '<a player id>'`.

## WHY IT FAILS SILENTLY (three failures stacked)
Verified on PROD:
```
AS CALLED  .eq('batting_team_id', playerId) → null   err: "canceling statement due to statement timeout"
CORRECT    .eq('batter_id',       playerId) → [{"batting_team_id":"3375","batter_abbrev_name":"C. Kozeal","batter_hand":"L"}]
```
1. A player id never matches a team id, so the predicate matches **nothing**…
2. …and scanning **2,576,146** `pitch_log` rows for it **EXCEEDS THE STATEMENT TIMEOUT** — it does not merely return
   empty, it **ERRORS**.
3. `:451` destructures **only `data`** and throws the error away ⇒ `rep` is `undefined` ⇒ `resolveTeam(undefined)` is
   `undefined` ⇒ `if (!team || team.division !== "D1") { skipped++; continue; }` ⇒ **skipped, silently.**
**Consequence: NO hitter Master row can EVER be created by this producer, on any environment, at any PA threshold.**

## THE EVIDENCE THAT PINNED IT (every other gate was cleared first)
Faithful read-only replicas against PROD, each ruling out a candidate cause:
| checked | result |
|---|---|
| `hmAll` (Hitter Master 2026, ordered pagination) | 8,244 rows / 8,244 distinct — Kozeal **NOT** present ⇒ he IS a candidate |
| `hitterTotals` (`pitch_log_hitter_totals`, `dimension_key='all'`) | 6,099 distinct — Kozeal present, `pa=287` |
| `newHitterIds` | **763**, includes Kozeal; **exactly 1** clears `MIN_PA=25` → `["1925267789"]` |
| `teamBySource` (Teams Table Season=2026) | 466 rows, 0 NULL `source_id`, `'3375'` → University of Arkansas **D1** ✅ |
| `repRows` replica using the **CORRECT** `batter_id` | **763 resolved · 0 errored · 0 no-row** |
| the ACTUAL run | **0 hitters created**, `skipped … 898` |
★ **`898 = 763 hitters + 135 pitchers` — i.e. EVERY candidate of both kinds.** A universal skip, not a selective one,
is what pointed at a shared gate rather than at the data.
(The 135 pitchers are separately explained by `MIN_BF=20`; the pitcher `repRows` call itself is correct.)

## ✅ THE FIX (one argument)
`:465` → `repRows(newHitterIds, "batter_id", "batting_team_id", "batter_abbrev_name", "batter_hand")`
**AND — independently — stop swallowing the error at `:451`:** `const { data, error } = …; if (error) { … }`. Count and
report failures; a timeout must never masquerade as "this player has no pitch-log row." Without this second change the
same class of failure stays invisible next time.

## 🅱️ WHAT THIS MEANS FOR TRACK B — READ THIS TWICE
Track B is **ONE EDGE FUNCTION RUNNING ONCE PER DAY, UNATTENDED.** This bug is precisely the failure mode it cannot
survive:
- the stage **runs**, **exits 0**, and prints a plausible number (`0 new rows`)
- "0 created" is **indistinguishable** from "nothing to create" — and 362 days a year, "nothing to create" is the
  truth, so it looks right
- the only visible symptom is a **missing row**, which **no count gate can detect** (prod has 5,340 D1 hitters and
  every count check passes on 5,340)
- it took a **team-level dRS discrepancy on one team** to surface a **single missing player**
**Therefore Track B MUST:** (1) treat any swallowed error as a **hard stop**, never a coerced empty; (2) gate the
new-row stage on the **MEMBERSHIP query**, not on a count or an exit code; (3) **log every row it creates by name +
PA/IP**, and log explicitly when it creates none *and why*.

## 🧠 THE META-LESSON — THE FOURTH SHAPE
1. *populated ≠ fresh* (Conference `Stuff_plus` 30/30 but pre-v2)
2. *populated ≠ right lane* (`trackman_pitches` full, from the legacy table)
3. *count-correct ≠ complete* (5,340 hitters, one of them missing)
4. **NEW: *ran ≠ did anything*** — a stage can execute, exit 0, report a believable figure, and be structurally
   incapable of ever doing its job.
**And the process lesson:** I nearly closed this off a truncated background log that was missing its header. The clean
full capture is what confirmed `0` was real and sent me to the code. **Never conclude from a partial log.**

---
# 🅱️ TRACK B — MASTER `TeamID` IS NOT SEASON-CONSISTENT, AND A SPLIT IS SILENT UNTIL IT ISN'T (2026-08-30)
## THE UNDERLYING CONDITION
`"Teams Table"` carries **one row per team PER SEASON** — prod has **308 rows for Season 2025** and **466 for 2026**,
each with its own `id`. So a single program has MULTIPLE `TeamID` uuids. Arkansas (`source_id 3375`):
`47acae04-1225-4506-9c12-8d6e55cbe9c5` = **Season 2025** · `5679ed85-eeea-4e47-be59-53ffc5087b38` = **Season 2026**.
**The 2026 Masters do NOT consistently use the 2026 id.** Measured on PROD, Season 2026, Arkansas:
| table | `47acae04…` (2025 id) | `5679ed85…` (2026 id) |
|---|---|---|
| `"Hitter Master"` | **16** | 0 |
| `"Pitching Master"` | **18** | **1** ⚠ |
Staging's 2026 Kozeal row likewise carried the **2025** id. **So the 2025 id is the DE-FACTO convention in the 2026
Masters, and the lone pitcher on the 2026 id is a PRE-EXISTING SPLIT that predates this session.** ⬜ NOT FIXED —
logged for whenever the Master `TeamID` question is addressed properly.

## 🛑 WHY THIS MATTERS — ANY TEAM-LEVEL ROLLUP KEYED ON `TeamID` SILENTLY SPLITS THE TEAM
`derive_team_drs.mjs` groups `Σ drs_floor` by the Masters' `TeamID`. If one player carries a different (but equally
"valid") `TeamID` for the same program, he becomes **his own team**. Demonstrated live: after inserting Kozeal with the
**2026** id (I "corrected" staging's 2025 id, assuming it was a bug — **IT WAS NOT**), the producer emitted:
```
div D1: 309 teams          ← was 308
Arkansas  team_drs 32.770  raw_floor 35.255  team_IP 475.0
Arkansas  team_drs  8.429  raw_floor  8.502  team_IP  14.0   ← Kozeal, alone, as a "team"
```
Reverting his `TeamID` to `47acae04…` restored **308 teams**, `raw_floor 43.757` (**exactly staging's**), `team_drs 41.272`.
★ The split announced itself ONLY because the division team-count moved 308→309 and the centering assertion still held.
**A per-team value check would have passed** — both buckets are internally consistent. **What caught it was a
CARDINALITY check.**

## 🅱️ REQUIREMENTS FOR TRACK B
1. **Resolve `TeamID` ONE way, from ONE place, for the whole run** — do not mix a per-season lookup with whatever the
   Masters happen to hold. Prefer joining on **`source_team_id` / `source_id`** (season-stable) over the per-season
   uuid wherever a rollup groups by team. [[feedback_id_over_name]] extends here: *stable* id over *any* id.
2. **When creating a Master row, adopt the `TeamID` its TEAMMATES already use** — never resolve it independently from
   `"Teams Table"` by season. That is exactly the mistake made here, and it silently split a customer team.
3. **CARDINALITY GATE on every team-level rollup:** assert the produced team count EQUALS the expected division count
   (D1 = 308) and FAIL otherwise. A per-team value gate cannot see a split; a count of teams can.
4. The zero-sum centering assertion (`Σ centered = 0`) **does NOT protect against this** — it held at 309 teams.

## ✅ D29b DONE ON PROD (2026-08-30) — team_drs DERIVED, not pasted
`scripts/drs/derive_team_drs.mjs --prod` (guard + ordered pagination added this session; reproduces staging's committed
values **308/308 exact**, worst |Δ| 0.0000) → `scripts/sql/team_drs_store_PROD_2026_08_30.sql` → applied.
`BEFORE with_drs 308 · sum -0.01 · Arkansas 41.060 (staging paste)`
`AFTER  with_drs 308 · sum  0.00 · Arkansas 41.272 (PROD-DERIVED)`  — 308 rows updated.
Residual vs the old staging values: **mean |Δ| 0.100**, max ~0.54 — prod's D1 population differs slightly (5,341 vs
5,343 hitters), shifting the centering rate. Expected, not a defect.
**Also on prod:** Camden Kozeal's 2026 Hitter Master row INSERTED (5,340 → **5,341** D1 hitters) — 31 seed columns,
**all 29 derived columns deliberately omitted** so C26 and Phase D compute them on prod.

---
# ✅ D31 DESCRIPTIVE WAR — APPLIED TO PROD 2026-08-30. Verified IN THE DATABASE, not from the log.
`node scripts/drs/populate_descriptive_war.mjs --prod --commit` (run under `caffeinate -dimsu`, full output captured).
`Hitter Master: 5340/5340 written, 0 FAILED` · `Pitching Master: 5374/5374 written, 0 FAILED` · `done. 0 write errors.`
★ **That "0 FAILED" line only exists because of the fix made earlier the same day** — write errors were previously
`console.error`'d but **NOT counted and NOT fatal** inside a ~10,715-update loop that then exited 0, so a partial write
was indistinguishable from a clean one. Now counted, summarised per table, and `exit 1` on any failure.

## PHASE GATE — PROD vs STAGING REFERENCE (2026, D1)
| metric | PROD | staging ref | ✓ |
|---|---|---|---|
| `desc_owar` mean | **0.3458** | 0.3456 | ✅ |
| `d_war` mean | **0.0103** | 0.0103 | ✅ |
| `bsr_war` mean | **0.0000** | 0.0000 | ✅ |
| `total_desc_war` mean | **0.3562** | 0.3559 | ✅ |
| `desc_pwar` mean | **0.5108** | — | ✅ |
| sum identity `max abs(total_desc_war − (desc_owar+d_war+bsr_war))` | **0.001000** | ≤ 0.002 | ✅ |
| coverage | hitters **5,340 / 5,341** · pitchers **5,374 / 5,375** | — | ✅ |
| `drs_behind` | **5,374** populated · range **−5.26 … 6.84** · **7** exact zeros | — | ✅ |
`bsr_war` (= `wsb_runs / RPW 13.1`, from `player_season_baserunning`) range **−0.386 … 0.502**, centered at 0.
The single missing hitter and pitcher are the pre-existing `sheet-miss 1` — players absent from the source CSV,
unchanged from before this run. NOT a defect.

## ★★ THE STRONGEST VALIDATION OF THE DAY — INDEPENDENT REPLICATION ON CAMDEN KOZEAL
```
PROD    Camden Kozeal — desc_owar 2.404 · d_war 0.649 · bsr_war -0.051 · total_desc_war 3.002
STAGING Camden Kozeal — desc_owar 2.404 · d_war 0.649 · bsr_war -0.051 · total_desc_war 3.002
```
**IDENTICAL to three decimals.** A player who had **no Master row and no numbers at all on prod** hours earlier now
matches the reference exactly — computed from **prod's own** pitch log, **prod's own** Master row (31 seed columns,
zero derived columns copied), **prod's own** `player_season_defense`, and a `team_drs` **derived on prod**. Nothing was
copied from staging except the seed stat line, which was itself cross-checked against prod's pitch log (.321/.411/.658).
★ This closes the loop opened by the Arkansas `team_drs` discrepancy: detector → missing player → root-cause bug →
row created → `team_drs` re-derived → descriptive WAR matches. **Every link verified, none assumed.**

## ORDER NOTE FOR THE NEXT STEP (D32) — THE SILENT ONE
`populate_descriptive_war_reg.mjs:79` reads `"Pitching Master".drs_behind` and coerces **`NULL → 0`**, so running it
before D31 commits yields wrong `desc_ra9_reg` / `desc_pwar_reg` with **NO error**. Gate satisfied: `drs_behind` is
**5,374/5,375 non-null** on prod. **Verify this count, never "D31 exited cleanly".**
