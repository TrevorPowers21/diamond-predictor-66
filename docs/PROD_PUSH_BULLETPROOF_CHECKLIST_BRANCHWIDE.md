# PROD PUSH — BULLETPROOF CHECKLIST (BRANCH-WIDE)

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
