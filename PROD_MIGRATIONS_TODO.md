# Prod migration checklist — `feature/general-manager-interface`
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

> ### ✅ GM BLOCK IS FULLY LIVE ON PROD — DO **NOT** REPLAY (reconciled 2026-08-28/29)
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
