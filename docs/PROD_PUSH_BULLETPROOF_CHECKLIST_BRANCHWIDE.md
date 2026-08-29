# PROD PUSH — BULLETPROOF CHECKLIST (BRANCH-WIDE)
> ⛔ **SUPERSEDED IN PART — READ `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md` FIRST (2026-08-29).**
> Stuff+ statements in this file were written before the lanes were untangled and contain WRONG conclusions.
> Corrected facts: (1) the LIVE Stuff+ is the **pitch_log lane** (armHB, self-consistent) — `pitch_log.stuff_plus` →
> `pitch_log_pitcher_totals` → Season Stats/PitcherProfile. (2) `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
> `rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane**, not read for 2026 (fallback for
> ≤2025 + JUCO only), and carries a latent raw-HB bug from `e5dec2f`. (3) `breakingBallReclassification.ts` never
> touched `pitch_log` — it is NOT the anchor classifier. (4) v2 is a re-runnable reconstruction for PROD + Track B; it is
> **NOT** an upgrade to staging's existing `pitch_type_reclassified` labels — do not overwrite them. (5) `A5 aggregator
> missing`, `baseline deriver missing`, and `pop/row convention mismatch` claims are FALSE — all verified present/consistent.


**Branch:** `feature/war-recalibration` → `main` (prod: `trbvxuoliwrfowibatkm`)
**Audit date:** 2026-08-28
**Scope:** 6 dimensions — NIL/market, GM interface, RLS/security, data-content, frontend/deploy, scripts/pipeline.

> This document **complements** `docs/PROD_PUSH_BULLETPROOF_CHECKLIST.md` (migrations/schema/Stuff+/WAR/team-conf-park-env/precomputes/edge-fn/runbook). It does **not** re-cover those items; it covers the branch-wide surface area (product features, security, script safety, ledger hygiene) that the main checklist did not.

**Bulletproof standards referenced:** (1) committed artifact for every DDL/backfill/derivation; (2) prod-pending items have a prod-runnable producer deriving from PROD data; (3) prod matches staging within pre-registered tolerance; (4) prod writes idempotent + resumable (is-distinct-from + keyset order; no ctid/single-UPDATE/VACUUM FULL); (5) dependency order honored; (6) display-safe at every pause; (7) reversible; (8) merged code computes same numbers as stored + edge fn matches.

---

## 1. EXECUTIVE SUMMARY

| Severity | Count |
|---|---|
| **BLOCKER** | **2** |
| **HIGH** | **6** |
| Medium | 4 |
| Low / ok | remainder (informational) |

### Blocks the PUSH (data-corruption / feature-broken on prod)
- **BLOCKER-1 — `gm_budget.nil_allocation_mode` missing on PROD, no committed migration.** The Balanced/Top-Heavy NIL toggle write errors on prod; every `allocateNil` silently falls back to `balanced`. Standard 1 + 8. *(dim: nil-market-value)*
- **BLOCKER-2 — `gm_allocation` destructive TRUNCATE lives in HEAD.** The neutralization (comment-out) exists **only in the uncommitted working tree**. Any fresh checkout / `git checkout .` / stash-drop restores the committed `TRUNCATE public.gm_allocation, public.gm_allocation_source;` — replaying it **wipes live prod coach funding data** (6+6 rows). Standard 1 + 4/reversibility. *(dim: gm-interface)*

### Blocks the MERGE (ledger integrity / would lure operator into destruction)
- **HIGH — GM ledger drift:** ~30 GM migrations marked `[ ]` pending in `PROD_MIGRATIONS_TODO.md` are actually **applied with live data on prod**. This is precisely the vector that turns BLOCKER-2 into a catastrophe (operator "catches up" pending migrations → replays the TRUNCATE). Must be reconciled to `[x]` + "do NOT replay" banner **in the same commit** as the BLOCKER-2 fix. *(dim: gm-interface)*

### SECURITY (see Section 3 — none are live leaks today, but two are latent)
- **HIGH — `player_predictions` team-scope RLS NOT applied on STAGING.** Anon/publishable key reads all **215,123** rows including per-team projections/market values. Prod is correct; staging leaks. Ledger self-contradicts. *(dim: rls-security)*
- **HIGH — `player_season_defense` / `player_season_baserunning` RLS never enabled**, tables exist on PROD, empty today. No committed `ENABLE RLS` anywhere → latent anon read/write once the dWAR/bsr loaders populate them. *(dim: rls-security)*

### Data-pipeline correctness (silent corruption on prod re-run)
- **HIGH — 2 named prod producers hardwired to STAGING** (`backfill_park_factors_seasonal.ts`, `drs/derive_team_drs.mjs`) — cannot target prod as written; Standard 2. *(dim: scripts-pipeline)*
- **HIGH — `derive_masters_from_pitchlog.ts` (Phase C core) paginates ~2.5M pitch_log rows with `.range()` and NO `.order()`** — silent row drop/dupe corrupts Master stat lines → WAR. Standard 3/4. *(dim: scripts-pipeline)*

### Cross-references to the main checklist
- WAR scale (÷13.1 RPW), Stuff+, team/conf/park/env columns, edge-fn parity, precomputes, Phase A/B/C runbook → **main checklist** (`PROD_PUSH_BULLETPROOF_CHECKLIST.md`). The frontend-deploy dimension independently **re-verified** those columns present on prod and stored-vs-live parity (9/9) — see Section 4.
- Phase C step 19 (`pitcher_full_name`, reconstruct) and the `derive_masters_from_pitchlog` producer are the overlap seam: the **ordered-pagination fix below is a precondition** for the main checklist's Phase C prod run.

---

## 2. GAPS TABLE (every BLOCKER + HIGH, deduped)

| # | Sev | Gap | Fix | Standard | prod_step_order |
|---|---|---|---|---|---|
| B1 | BLOCKER | `gm_budget.nil_allocation_mode` has no committed migration; on staging out-of-band; **missing on PROD**. Toggle save errors; `allocateNil` falls back to balanced. `useNilAllocationMode.ts:24`, `RosterBudgetSettings.tsx:54`, `useGmRoster.ts:193`. | Commit migration mirroring `20260710130000_gm_scholarship_mode.sql`: `ALTER TABLE public.gm_budget ADD COLUMN IF NOT EXISTS nil_allocation_mode text NOT NULL DEFAULT 'balanced' CHECK (nil_allocation_mode IN ('balanced','top_heavy'));` + `NOTIFY pgrst`. Add to `PROD_MIGRATIONS_TODO.md`. Apply to prod **before any GM/NIL push**. | 1, 8 | Before GM/NIL push (DDL) |
| B2 | BLOCKER | `gm_allocation` TRUNCATE neutralization is **uncommitted**; HEAD `20260710120000_gm_allocations_per_build.sql:15` still contains live `TRUNCATE gm_allocation, gm_allocation_source`. Replay wipes prod funding data. | Commit the comment-out to the migration on `feature/war-recalibration` so the safety is in HEAD. Same commit carries H1 ledger fix. | 1, 4/reversibility | Immediate (pre-merge) |
| H1 | HIGH | GM ledger drift: ~30 GM migrations `[ ]` in `PROD_MIGRATIONS_TODO.md:63-103` but applied+populated on prod (gm_recruits=56, gm_activity=114, gm_allocation/source=6+6, gm_contract=4, vendor slices filled). | Reconcile GM block to `[x]` (verified vs prod catalog 2026-08-28) + add "GM block is fully live on prod — do NOT replay" banner near `gm_` section. Commit with B2. | Ledger accuracy / dep-order safety | Immediate (pre-merge) |
| H2 | HIGH | `player_predictions` team-scope RLS (`20260823000000`) **not on STAGING** — anon reads all 215,123 rows cross-team. Prod correct. Ledger self-contradicts (exec-log `[x]` prod vs line 429 `[ ]`). | Apply `20260823000000` on STAGING (drops inherited permissive policy). Reconcile ledger: check line 429, record staging-applied. | 3, 6, ledger | Staging (any time); ledger before merge |
| H3 | HIGH | `player_season_defense` / `player_season_baserunning` RLS **never enabled**; exist on PROD (empty). No committed `ENABLE RLS`. Latent anon read/write once populated. Header falsely says staging-only (`20260805_...sql`). | Committed migration: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on both (service-role-only, matching `venue_movement_corrections`; add `FOR SELECT TO authenticated USING(true)` only if a client reads — none does). Apply on prod **before** dWAR/bsr loaders populate. Verify anon read = 0. | 1 | Before dWAR/bsr populate |
| H4 | HIGH | `backfill_park_factors_seasonal.ts:37` hardwires staging URL literal + `.env.local`; input CSVs live at uncommitted `~/RSTR IQ Data/park-factors` (not reproducible from repo). Prod producer (ledger:197). | Add env selection (`SUPABASE_URL \|\| VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`) + `--prod` guard like `recompute-stuff-plus.ts`; run with `--env-file .env.production.local`. Confirm park-factor CSVs present on push machine. | 2 | Park factors seasonal fill (ledger:197) |
| H5 | HIGH | `drs/derive_team_drs.mjs:13` hardcodes `./.env.local` (staging); runbook (ledger:126, 289) says run against prod. | Mirror `populate_descriptive_war.mjs:24`: switch `ENV_FILE` on `--prod` → `.env.production.local`. Re-derive team dRS from prod. | 2 | `team_war_snapshots.team_drs` populate (ledger:126, 289) |
| H6 | HIGH | `derive_masters_from_pitchlog.ts:190-198` `readAll` loop paginates pitch_log (~2.5M) with `.range()` and **no `.order()`** → silent drop/dupe → corrupt Master stat lines/WAR (non-deterministic across re-runs). | Add deterministic `.order('id'/PK, {ascending:true})` (+ tiebreaker) to every paginated select in `readAll` before prod run. | 3, 4 | Phase C (RUNBOOK:147) — **precondition to main-checklist Phase C** |

---

## 3. SECURITY SECTION (call-outs)

**Bottom line: no confirmed LIVE cross-team or anon leak on PROD today.** Prod's anon role is genuinely unauthenticated (verified: `pitch_log` returns 0 rows to anon despite holding data; `player_predictions` per-team scan returns nothing to anon). But there are **two HIGH latent exposures** and two documented decisions to close.

### 3.1 HIGH — STAGING anon reads all per-team projections (H2)
- `player_predictions` team-scope RLS (`20260823000000_player_predictions_rls_team_scope.sql`) is applied on **prod** but **not staging**.
- STAGING anon (legacy JWT from `VITE_SUPABASE_PUBLISHABLE_KEY`): `select *` returns real rows, `count = 215,123`, `where customer_team_id is not null` returns rows → **full anon cross-team read of per-team precomputed projections and market values.**
- Fix: apply the migration on staging; reconcile ledger (`PROD_MIGRATIONS_TODO.md` line 429 `[ ]` vs exec-log `[x]`).

### 3.2 HIGH — RLS never enabled on two public tables (H3)
- `player_season_defense`, `player_season_baserunning` created in `public` with **RLS off** and no committed `ENABLE RLS`. They **exist on prod** (header's "staging-only" claim is false), currently empty.
- With RLS off on a public-schema table, Supabase's default grants extend to `anon`/`authenticated` → **anon read (and likely INSERT/UPDATE/DELETE)** once the dWAR/bsr loaders populate them. Write test intentionally not run (read-only mandate).
- Fix: `ENABLE ROW LEVEL SECURITY` (committed) **before** loaders populate. Ledger:389 flags the prod-path gap but not the RLS gap.

### 3.3 LOW/decision — cross-team read surfaces (document, empty today)
- `nil_valuations` SELECT policy is `TO authenticated USING(true)` → any authenticated user of any program reads all rows if populated. `count=0` both envs. Confirm intent; add `customer_team_id` + team scope before any writer populates if program-confidential. Ledger:429 already flags.
- `pitch_log` family: `TO authenticated USING(true)` by design (league-wide reference, no `customer_team_id`). Anon correctly blocked. No action unless row-level competitive sensitivity is later asserted.
- `team_season_stats`: RLS enabled with **no policy** → service-role-only (over-restrictive, **not a leak**). Not on prod yet. If a client reads it, add `FOR SELECT TO authenticated USING(true)` before shipping the reader.

### 3.4 OK — correctly scoped (template to follow)
- All ~20 `gm_*` tables: `ENABLE RLS` + single `FOR ALL TO authenticated USING(has_role(superadmin) OR is_team_member(customer_team_id)) WITH CHECK(...)`. Anon = 0 rows both envs.
- Storage: `gm-contracts` bucket `public=false`, `storage.objects` policies scope every op by `(storage.foldername(name))[1]::uuid = customer_team_id`. `school-logos` public-read / superadmin-write by design.
- `player_external_ids`: global identity crosswalk, authenticated read + service-role writes via `resolve_or_create_prospect` SECURITY DEFINER RPC.
- **Storage-policy verification gap (LOW):** the 4 `gm_contracts_*` `storage.objects` policies can't be read back via PostgREST; presence inferred from bucket existing. All 4 prod `gm_contract` rows have `pdf_path=null` / 0 bucket objects (path unexercised). Confirm via dashboard SQL (`SELECT polname FROM pg_policies WHERE tablename='objects' AND policyname LIKE 'gm_contracts%'`) **before coaches upload contract PDFs**. Display-safe to defer.

---

## 4. GM + NIL + FRONTEND READINESS (must-be-true before merge)

### 4.1 GM interface — schema is COMPLETE on prod
- Every table/column the shipping GM UI reads is on prod; all 4 vendor-unification slices applied + filled (`team_build_id`, `vendor_id`, `funding_mode`, `base_offset` on `gm_allocation_source`; `allocation_id`/`vendor_id`/`funding_mode`/`base_offset` on `gm_contract`). No prod-schema gap behind GM. Frontend-deploy dimension independently confirmed all 18 `gm_*` tables read by src exist on prod (no 400s).
- **Gating items:** BLOCKER-2 (uncommitted TRUNCATE), HIGH-1 (ledger reconcile). Both must land in one commit before merge.
- LOW: remove dead AI-parse branch in `useGmContracts` (PDFs parsed in-browser via `extractContractPdf`/pdfjs; ledger:106). Contract-funding backfill (ledger:108) already satisfied on prod (contracts carry `funding_mode`+`vendor_id`) — mark not-needed or dry-run to confirm 0 changes.

### 4.2 NIL / market value
- **Must be true before merge:** `gm_budget.nil_allocation_mode` column on **prod** (BLOCKER-1). Until then top_heavy is unsettable; NIL silently balanced.
- Core market math verified good: `total_hitter_war = o_war + d_war + bsr_war` on a single ÷13.1 scale everywhere; `computeHitterMarketValue` identical in TS producers and edge fn (`total×$25k×PTM×PVM`); no ÷10-vs-÷13.1 leak into market. Snapshot re-price `recompute-snapshot-hitter-market.ts` (ledger 42b) is committed, `--prod`-guarded, `.order('id')`-paginated, value-idempotent.
- **Half-shipped / do not assume active:**
  - MEDIUM — `positionNeed.ts` (need-premium, spec §4) fully built + tested but **zero call sites**. Target-board prices carry only the always-on PVM, never the need premium. Either wire `computeRosterNeeds`+`needMultiplierForTarget` into the board price surface, or mark deferred in the ledger so the shipped board isn't assumed to include need pricing.
  - MEDIUM — D1 TWP hitter market priced off `o_war` only (`rebake-twp-markets.ts:24,34,47`; `clean-twp-sides.ts:26`; `fix-returner-twp-hitter-market.ts:76`) vs `total_hitter_war` for non-TWP and transfer path → same column priced on two WAR bases. Make TWP re-bake price off `total_hitter_war`; confirm TWP rows carry `d_war`/`bsr_war` by `source_player_id`. (Ledger 463, 498.)
  - LOW — `rebake-twp-markets.ts` lacks prod/staging guard, uses unordered `.range()` (ledger:171 flagged pattern), writes unconditionally. Add `--prod` guard + `.order('id')` + `abs(old-new)>=1` gate.

### 4.3 Frontend / deploy — display-safe, NO deploy blockers
- All push-critical named columns exist on prod: `player_predictions.{p_rv_plus,p_wrc_plus,customer_team_id,variant,pitcher_role}`, `players.{ip,division}`, quoted `"Conference Stats".{era_plus,fip_plus,whip_plus,k9_plus,bb9_plus,hr9_plus,run_env_factor,hitter_talent_plus,offensive_power_rating}` (`PitchingConferenceStatsTable` safe).
- stored-vs-live parity: `src/lib/storedVsLive.test.ts` 9/9 (runsPerPa 0.3994, runsPerWin 13.1, wRC weights, lgwOBA 0.3782, pitcher weight 0.7).
- `tsc` 217 errors on branch vs 170 on main (+47), but build is `vite build` only (no `tsc &&` gate; tsconfig `noEmit`+`strict:false`) → **does not block the Vercel build** (main already ships 170). Triage `+47` as debt; per memory rule the real check is `tsc -p tsconfig.app.json`.
- LOW pre-existing (NOT push regressions): `ConferenceStatsTable.tsx` reads lowercase `conference_stats` (absent both envs → empty table on Teams page; unchanged query, latent on main too); `PitchingPowerRatingsStorageTable.tsx` reads `pitching_power_ratings_storage` (absent) but is **unrouted/dead**; `team_season_stats` referenced only in lib comments (no runtime read).

### 4.4 Data-content readiness (pending backfills — committed producers exist)
- MEDIUM — Hitter Master `desc_owar`/`d_war`/`bsr_war` **100% NULL on prod** (0/30,025; staging 5,343 populated). Producer committed: `scripts/drs/populate_descriptive_war.mjs` (+`_reg`) / `scripts/sql/descriptive_war_columns.sql` (ledger:539, Steps 30-34). Run `--prod --commit` (then `_reg`) **before** promoting any descriptive-index display; confirm no prod-live UI / `team_season_stats` WAR rollup (ledger:257) renders 0/blank off the NULLs.
- MEDIUM — `team_build_players.total_hitter_war` **NULL on prod** (snapshots store `o_war` only; ledger 7b line 170). Producer committed: `scripts/backfill-snapshot-total-hitter-war.ts` (idempotent-by-value, dry-run default, `--apply`). **Sequencing risk:** merging the 7b `o_war→total_hitter_war` display swap without running this makes build-player profiles fall back to offense-only WAR while the Dashboard shows total → misalignment. Run `--apply` on prod together-with/before the display-swap merge.
- OK — prod `player_predictions` internally consistent (0 mismatch / 20k rows; o_war and total non-null counts match exactly = no half-migrated rows; scale sane; market_value 0 negatives, none >$1M). Prod correctly holds OLD magnitudes (pre-recalibration) — the pre-registered expected difference; cross-env value equality is verified only after the prod re-price/precompute runs (Standard 3).

### 4.5 Scripts / pipeline (beyond H4/H5/H6)
- MEDIUM (unordered `.range()`, add `.order(PK)`): `backfill_trackman_pitches_pitching_master.ts:32-33`; `compute_conf_pitcher_env_plus.ts:13` (feeds Conference Stats env+ → transfer projections). Idempotent-by-value so re-run after fix self-corrects.
- MEDIUM — `aggregate_pitch_log_dimensions.ts:957` (stage 3b, Season-Stats totals + `populate_hitter_run_values(2026)`) has **no `--prod` guard**, reads `VITE_SUPABASE_URL` only. Add explicit ordered runbook step + `--prod`/host-echo guard + `SUPABASE_URL` fallback; verify totals-table counts vs staging within tolerance.
- LOW — `ingest_pitch_log.ts:407-419` unordered `.range()` on players lookup (future ingests only); `backfill_is_conference_game.ts` staging-locked but superseded on prod by committed `flag_conf_batch`/`set_conf_game` RPC (ledger:216-232) — ensure runbook points prod at the RPC, retire/guard the `.ts`; ~147 underscore diagnostics + one `.bak` — optional cleanup before merge.

### 4.6 Data-quality note (not a migration blocker)
- `"Pitching Master".stuff_plus` has out-of-range outliers (min −20.7, source_player_id 1238048512, + exact-0s) in **both envs** → pre-existing source data, not a migration artifact. Optionally clip/investigate; unrelated to this push.

---

## RECOMMENDED PROD_STEP_ORDER (branch-wide overlay)

1. **Commit safety fixes (pre-merge, one commit):** B2 (TRUNCATE comment-out) + H1 (GM ledger `[x]` + do-not-replay banner).
2. **Commit DDL artifacts:** B1 (`nil_allocation_mode` migration) + H3 (`ENABLE RLS` on `player_season_defense`/`baserunning`).
3. **Fix producers before any prod run:** H4, H5 (env/prod guards); H6 + the two MEDIUM unordered-pagination producers (add `.order(PK)`); stage-3b guard.
4. **Staging security parity:** H2 (apply `20260823000000` on staging; reconcile ledger 429).
5. **Apply prod DDL:** B1 `nil_allocation_mode`; H3 RLS (before dWAR/bsr populate).
6. **Prod backfills (committed producers, from prod data):** descriptive WAR (`populate_descriptive_war.mjs --prod --commit`), snapshot `total_hitter_war` (paired with 7b display-swap merge), park factors (H4), team dRS (H5).
7. **Verify:** anon read = 0 on the two RLS tables; storage-policy readback for `gm_contracts_*`; stored-vs-live + edge-fn parity (main checklist); prod-vs-staging tolerance after re-price/precompute.
8. **Merge** once B1/B2/H1 committed, H2 staging-closed, prod DDL applied, and no half-shipped feature is assumed live (need-premium decision recorded).

---
## ★★★ STUFF+ v2 CLASSIFIER — CURRENT STATE + CONCLUSIONS (2026-08-29). Numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11.
**ACCURACY vs the anchor ground truth (`_reclass_result`, all 4,804 pitchers / 2,000,674 pitches):**
`1,885,862 / 2,000,674 = 94.3% per-pitch` · arsenal-mix 94.3% · needs_review 8.1% — **+ the §4.5 gyro fix (measured
+0.96pp / +1.24pp on two disjoint samples) → projected ~95.3-95.4%.** Supersedes the stale 92.6%, which predated the
fixes AND was measured against a DUPLICATE copy of the classifier that has since been deleted.

**THREE FIXES SHIPPED (all measured, none guessed):**
1. **Offspeed armHB floor** `armhb > 0` → **`armhb >= 5`**. Gyro armHB p99=4.7 vs offspeed p1=5.3 — a clean empty gap.
   Killed `Gyro→Change-up` (338 losses) and `Cutter→Change-up` (29) outright.
2. **Fastball-family MERGE GUARD** — never merge clusters whose fastball-family seeds (`4S FB`/`Sinker`/`FBSTRIP`)
   differ. Merge was swallowing the FBSTRIP cluster before it could be resolved; **>60% of all 4S↔Sinker errors** were
   merged FBSTRIP clusters. 91.69% → 93.01%; 4S↔Sinker errors 2,830 → 1,676 (−41%). Also preserves genuine
   two-fastball arms (14ivb/8hb vs 8ivb/14hb at equal velo stay SEPARATE; 14/8 vs 13/9 correctly merge).
3. **§4.5 gyro/slider cluster-centroid floor** `GYRO_ARMHB_FLOOR = -3`, applied BEFORE `tiebreak()` (ordering is worth
   ~+0.3pp). `Gyro→Slider` 1,675→471 / 1,788→508; `Gyro→Cutter` 415→131 / 437→56; zero fastball/offspeed regression.

**TWO NEGATIVE RESULTS — do NOT redo these:**
- `rr > -1.7` FBSTRIP cut (made agreement WORSE: disputes 1,443 → 2,503; it was fit on a merge-corrupted population).
  `rr >= 0` stays — within noise of the 91.9% @ rr=-0.13 optimum.
- The **"arsenal rule"** (flip Slider→Gyro when the pitcher has a GY seed and no SW seed) is a **CONFOUND**, not a rule:
  sweeper-presence predicts the anchor 71.5% vs 89.1% for the cluster's own mean armHB. Implemented literally it
  **LOSES 0.97/1.26pp**. Do not rebuild it from the `_reclass_map` contingency table.
**VERIFIED ALREADY-OPTIMAL (do not touch):** Sweeper/Slider armHB −12 (1.0% error) · Gyro/Slider armHB −5.

**⚠ AGREEMENT WITH THE ANCHOR IS NOT ACCURACY.** The anchor is the PREVIOUS classifier's output (a lost scratchpad
implementation), not truth. The residual ~4.7% mixes (a) v2 wrong, (b) **v2 RIGHT and the anchor wrong**, (c) coin-flips.
Partition it with `scripts/v2_coherence_test.ts` before treating any of it as error. If v2 wins a meaningful share, the
"do NOT overwrite staging's labels" guidance REVERSES.

**⚠ DOWNSTREAM — NOT display-only.** The gyro fix moves **6-8% of ALL breaking-ball volume** Slider→Gyro Slider. Every
mix-dependent artifact MUST be regenerated after a reclass run: `pitcher_stuff_plus_ncaa` baselines, D1/regional means
+ SDs, pitch-shape percentiles. Reclassify → baseline → score → aggregate MUST complete in ONE session.

**PROD STATUS:** prod pitch_log is on the OLD per-pitch CASE labels (`"4-Seam Fastball"` naming, ~2,176,888 rows, NO
`classification_version` stamp, `needs_review` all null, no `_reclass_fix` table) — **v2 has NEVER written to prod**; the
prior prod work was a read-only dry run. v2 vs prod's existing labels = **70.9% agreement (v2 would change 584,130
pitches = 29.1%)**, and v2 is far closer to the validated set (distribution deviation from anchor **38.7 → 21.6**),
correcting prod's Cutter 10.3%→3.7% (anchor 2.4%) and Splitter 0.7%→2.1% (anchor 2.2%). Prod run is GATED on PGURI +
an explicit "prod, now?" and MUST be followed immediately by the Stuff+ recompute chain.

---
# 🔴 STAGE 0 — BLOCKERS FOUND BY AUDIT 2026-08-29. NOTHING RUNS ON PROD UNTIL THESE ARE FIXED.
Two independent read-only audits (docs/state + prod data). **Prod's DATA is ready — 100.00% of prod's `is_data=true`
rows (~1,906,398) are v2-classifiable, venue corrections resolve, same games/window as staging. Every blocker below is
CODE or SCHEMA.** Any one stops the chain; #2 is the dangerous one because it fails SILENTLY.

## THE FOUR HARD BLOCKERS
1. **PROD `pitch_log_corrected` VIEW IS STALE — missing `classification_version`.** The view is `select pl.*, …` and
   Postgres FREEZES `*` at creation time, so prod's view is stuck at **94 columns** vs the base table's 99. Missing:
   `classification_version, needs_review, ab_num_in_game, pitch_num_in_game, pitch_num_in_ab, park_code,
   is_conference_game, game_string`. Running the scorer's exact query (`compute_pitch_log_stuff_plus.ts:172-179`)
   against prod returns: `column pitch_log_corrected.classification_version does not exist`. Same query on staging = OK.
   ⚠ `create or replace view` will NOT fix it (new columns land mid-list) → needs **`drop view pitch_log_corrected
   cascade; create view …`** rebuilt against the current column list. **DDL — requires an explicit go, separate from
   the data-write "prod, now?".** (Reclassification itself is unaffected: `reclassify_prod.ts:38-39` doesn't read those columns.)
2. **⚠ SILENT-CORRUPTION RISK — scorer is hard-filtered to the OLD version string.**
   `compute_pitch_log_stuff_plus.ts:151` and `:176` both `.eq("classification_version", "v1-anchor-2026-08-17")`, but
   `reclassify_prod.ts:19` stamps `v2-ranges-2026-08-28`. **Step 1 and step 3 of the corrected chain DO NOT CONNECT.**
   Unfixed, the scorer matches 0 rows, no-ops, and leaves prod with NEW LABELS + OLD `stuff_plus` — the one invariant
   every doc says must never happen — while appearing to succeed. FIX: parameterize (`--class-version`, default v2).
   (This supersedes checklist G7's "do NOT loosen filter" guidance, which assumed the anchor version.)
3. **`_reclass_pf` DOES NOT EXIST ON PROD** (staging: 4,804 rows) and has **NO producer anywhere in the repo** — every
   reference is a READ. `compute_pitch_log_stuff_plus.ts:132-135` does `process.exit(1)` if it can't load it, so prod
   scoring aborts immediately. FIX: have `reclassify_prod.ts` materialize it as a by-product of its existing
   `pfbVelo()` (`:28`), or inline the same computation into the scorer.
4. **`aggregate_pitch_log_dimensions.ts` has NO prod path** — `:957` reads `process.env.VITE_SUPABASE_URL` only, no
   `SUPABASE_URL` fallback and no `--prod` guard. It is step 4 of the chain and also calls `populate_hitter_run_values(2026)`.

## ALSO REQUIRED BEFORE THE RUN
5. **Resolve the UNCOMMITTED §4.5 reordering** in `src/savant/lib/stuffPlusClassifierV2.ts`. The working tree moves the
   gyro floor to BEFORE the step-4 backfill (fixes fragmentation: 7%→5% of pitchers, median fringe 2.8%→1.1%), but the
   **confirmed 95.1% was measured on the COMMITTED ordering** (after step 4, before `tiebreak`). Measure or revert —
   it changes labels on 6-8% of breaking-ball volume. ⚠ Trevor's standing caveat: agreement-with-the-anchor is NOT
   accuracy for a rule the anchor never had.
6. **`.order(PK)` on `derive_masters_from_pitchlog.ts:188-201`** (`fetchAll`, unordered `.range()` over ~2.5M rows →
   silent drop/dupe). Precondition for chain step 5. Same fix needed on
   `backfill_trackman_pitches_pitching_master.ts:32-33` and `compute_conf_pitcher_env_plus.ts:13` before C24/C28.
7. **⛔ GATE THE LEGACY LANE OUT OF THE LIVE PROD CSV PATH.** `scripts/import-csvs/runner.ts:442,461` calls
   `runBreakingBallReclassification` + `runStuffPlusPipeline` + `legacy_rollupStuffPlusToMaster`, and that script is
   `npm run import:prod` — which per standing practice goes DIRECT TO PROD. **A routine TruMedia import today runs the
   legacy raw-HB lane and scores left-handers BACKWARDS.** Gate behind `season <= 2025` / `--legacy-stuff`. Also delete
   npm `recompute-stuff:prod` and `recompute-stuff-scoped:prod` (`package.json:21,93`) — one keystroke from a prod legacy write.

## LEDGER + DOC INTEGRITY (fix before an operator follows them literally)
8. **`PROD_MIGRATIONS_TODO.md` is missing entries for work ALREADY DONE on prod:** C20 park_code (2,576,146 = 100%),
   C21 is_conference_game + C22 sequence (2,576,146), and migration `20260828000000_pitch_log_classification_version_needs_review.sql`.
   The ledger's own rule (`:28-38`) says "if it's not here, it doesn't happen on prod" — an operator would RE-RUN them.
9. **C21/C22 were COPIED from staging, not derived** (`_next_derived.ts`). The logged principle requires prod to DERIVE
   these going forward; that FOLLOW-UP is on no task list, and **Track B breaks on the next ingest without it.**
10. **Stale text still in these docs:** the top correction banner still says "do NOT overwrite staging's labels"
    (REVERSED by EXACT_VALUES §11.12 — we now standardize on v2 in BOTH envs); five docs still print
    "94.3% → projected ~95.3-95.4%" (confirmed number is **95.1%**, §11.10); the BULLETPROOF verdict is still **NO-GO**
    on blockers G2/G3/G5/G6 that are now FALSE or DONE (v2 writer exists; classifier is 95.1% not ~85%; the "A5
    aggregator missing" and "baseline deriver missing" claims were disproven).
11. **Row-count contradiction across docs** — 2,576,230 (total) vs 2,576,146 (filled) vs ~2,176,888 (labeled) vs
    2,013,005 (v2 dry-run labels) are DIFFERENT populations and no doc says so. Pre-register which number each gate
    checks, or the verify step is unfalsifiable. Prod is_data=true ≈ **1,906,398** (74.01% of 2,575,996).

## STILL-MISSING PRODUCER (new obligation created by the §11.12 decision)
12. **No STAGING reclassification writer.** `reclassify_prod.ts:100` hard-aborts unless PGURI is prod
    (`if (!/trbvxuoliwrfowibatkm/.test(uri)) … exit(1)`). §11.12 requires staging to get the SAME full chain, so this
    needs an env-parameterized target. Not listed as a task in any doc before now.

## GREEN — verified ready on prod (audit 2026-08-29, read-only)
v2-classifiable **100.00%** of is_data=true (~1,906,398) · venue corrections **311 rows**, ivb/hb_corrected differ from
raw in 100% of samples · release_velocity/ivb/hb/spin/rel_height/rel_side/pitcher_hand/pitcher_id/park_code/
is_conference_game/sequence/pitcher_full_name all **0.00% NULL** (extension 0.04%) · same games + window as staging
(2026-02-13 → 06-22, identical first/last uniq_pitch_id) · `pitcher_stuff_plus_ncaa` 18 D1 buckets ·
pitch_log_pitcher_totals 37,186 · hitter_totals 50,227 · by_pitch_type 161,310 / 252,464.
⚠ `Pitching Master` rollup is BEHIND staging: `trackman_pitches>0` **1,126 vs 6,458**; `stuff_plus` 5,251 vs 6,011.
⚠ `vaa` column absent on prod — NOT a blocker (100% NULL on staging; neither classifier nor scorer reads it).
⚠ The known prod dup issue (~3,425 dup rows / 29 games) still lives on this table.
