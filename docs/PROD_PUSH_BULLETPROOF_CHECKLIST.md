# PROD PUSH BULLETPROOF CHECKLIST — feature/war-recalibration → prod (trbvxuoliwrfowibatkm)
> ⛔ **SUPERSEDED IN PART — READ `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md` FIRST (2026-08-29).**
> Stuff+ statements in this file were written before the lanes were untangled and contain WRONG conclusions.
> Corrected facts: (1) the LIVE Stuff+ is the **pitch_log lane** (armHB, self-consistent) — `pitch_log.stuff_plus` →
> `pitch_log_pitcher_totals` → Season Stats/PitcherProfile. (2) `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
> `rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane**, not read for 2026 (fallback for
> ≤2025 + JUCO only), and carries a latent raw-HB bug from `e5dec2f`. (3) `breakingBallReclassification.ts` never
> touched `pitch_log` — it is NOT the anchor classifier. (4) v2 is a re-runnable reconstruction for PROD + Track B; it is
> **NOT** an upgrade to staging's existing `pitch_type_reclassified` labels — do not overwrite them. (5) `A5 aggregator
> missing`, `baseline deriver missing`, and `pop/row convention mismatch` claims are FALSE — all verified present/consistent.


Consolidated from 8 dimension audits (migration-ledger, schema-diff, stuffplus-chain, war-defense-composite, team-conf-park-env, precomputes-snapshots, edgefn-code-deploy, runbook-order-safety). Graded against the 8 bulletproof standards. Resume point: Phase C step C19–C22 done; PROD_PUSH_HANDOFF_RESUME_2026_08_26.md.

Prod = `trbvxuoliwrfowibatkm` (⚠ `--linked`). Staging = `slrxowawbijbjrkozqlj` = source of truth.

---

## 1. EXECUTIVE SUMMARY

### Verdict: **NO-GO** for any further prod write until the Stuff+ block is buildable and the TRUNCATE landmine is neutralized.

The engines are formula-sound (265/265 unit tests pass, in-DB additive parity holds), the dependency spine is correct, and every *completed* stage (venue) is a clean regenerate-from-prod template. The push is blocked by the **middle of the Stuff+ chain**, which today has no committed prod-runnable producer and is not yet at its reconstruction gate — plus one destructive landmine sitting in a stale-checkbox block.

| Severity | Deduped count |
|---|---|
| **BLOCKER** | 5 |
| **HIGH** | 11 |
| **MEDIUM** | 9 |
| Total actionable (blocker+high+medium) | 25 |

### TOP 5 MUST-FIX BEFORE ANY FURTHER PROD WRITE

1. **Neutralize the `20260710120000_gm_allocations_per_build.sql` TRUNCATE landmine.** It `TRUNCATE`s live `gm_allocation`/`gm_allocation_source` (6+6 live rows) and sits inside a stale `[ ]` block (ledger line 90). Mark `[x]` APPLIED and strip/guard the TRUNCATE so no operator re-runs it.
2. **Build + commit the v2 anchor reclassification WRITER.** `reclassify_backfill.ts` is validate-only; the only committed writers are the DEAD copy path and OLD v1 taxonomy. No committed way to stamp `pitch_type_reclassified` + `classification_version='v1-anchor-2026-08-17'` on prod exists. First remaining step is unrunnable.
3. **Get the classifier to its ≥95% acceptance gate.** Reconstruction is ~85% vs staging `_reclass_result`; exact v2 constants declared UNRECOVERABLE. Cannot regenerate the taxonomy correctly today — everything downstream (Stuff+, power ratings, predictions) inherits a wrong taxonomy if run now.
4. **Commit prod producers for the two missing Stuff+ inputs:** `_reclass_pf` (per-pitcher primary-FB velo — absent on prod, only READ) and the `pitcher_stuff_plus_ncaa` per-(pitch_type×hand) baseline re-derived on the new taxonomy (only READERS exist). Both are load-bearing scorer inputs.
5. **Reconcile the ledger↔prod drift before touching prod.** ~40-file GM block + Phase A DDL + 4 unlogged migrations are APPLIED on prod but marked `[ ]`; an operator following the checkboxes literally re-runs applied (some destructive) work. Flip to `[x]` with evidence first.

---

## 2. ORDERED REMAINING PROD SEQUENCE

Legend: R/C = Regenerate vs Copy · I/R = Idempotent+Resumable · DS = Display-safe at pause · Trevor = Trevor-driven. Producer path = committed artifact or **MISSING**.

### PHASE 0 — LEDGER + LANDMINE RECONCILIATION (no prod writes)

| # | Step | Inputs | Producer | R/C | Staging-match gate | I/R | Reversible | DS | Trevor |
|---|---|---|---|---|---|---|---|---|---|
| 0a | Flip GM block (lines 63–103), Phase A body lines (124/199/216/389–393/404), Push-1 18 files to `[x]` w/ row-count evidence | prod probes | PROD_MIGRATIONS_TODO.md edits | — | prod counts match evidence (gm_recruits=56, defense=13454…) | — | n/a doc | y | n |
| 0b | Strip/guard TRUNCATE in `20260710120000_gm_allocations_per_build.sql`; annotate line 90 "DO NOT RE-RUN" | migration file | supabase/migrations/20260710120000_… | — | file no longer TRUNCATEs live tables | — | git | y | n |

### PHASE A/BUILD — STUFF+ PRODUCER BUILD (own sessions, NOT runbook steps)

| # | Step | Inputs | Producer | R/C | Staging-match gate | I/R | Reversible | DS | Trevor |
|---|---|---|---|---|---|---|---|---|---|
| A1 | **Reach classifier ≥95% gate** — Tier-2 reconstruction vs `_reclass_result` answer key (arsenal tiebreaker, cluster-mean FA/SI strip, exact fold) | staging `_reclass_result`, reclassify_backfill.ts | scripts/reclassify_backfill.ts (extend) | R | ≥95% per-pitch agreement on LARGE sample + pre-registered confusion-matrix tolerances | n/a | git | y | n |
| A2 | Build committed **anchor reclassify WRITER** (keyset, direct session, `is distinct from`, per-batch commit, stamps `classification_version`+`needs_review`) | pitch_log_corrected, A1 classifier | **MISSING** → scripts/reclassify_anchor_prod.ts (build) | R | writes match validate harness | y | pitch_log backup | y | n |
| A3 | Build committed **`_reclass_pf` producer** (primary-FB velo per pitcher from prod pitch_log_corrected) | pitch_log_corrected | **MISSING** (build; or inline into A2+scorer) | R | prod velos match staging `_reclass_pf` (4804 rows) within tol | y | n/a (rebuildable) | y | n |
| A4 | Build committed **`pitcher_stuff_plus_ncaa` baseline producer** (mean+_sd per pitch_type×hand, new taxonomy, DELETE stale then insert, stamp version) | reclassified+venue-corrected pitches | **MISSING** (build) | R | final rows == staging (18) A/B means/SDs | y | back up 71 old rows | y | n |
| A5 | Build committed **`pitcher_stuff_plus_inputs` D1 re-aggregation** (new taxonomy) OR retire+repoint readers | reclassified pitch_log | **MISSING** (only add_d2 one-off exists) | R | ~31k rows matching staging (31,774) | y | backup | y | n |
| A6 | Commit **`bulk_update_pitch_log_stuff_plus` RPC** migration (idempotent UPDATE…FROM jsonb) | — | **MISSING** → supabase/migrations/*.sql (build) | — | function exists on prod | y | drop function | y | n |
| A7 | Quarantine/delete v1 + copy scripts: `reclassify_pitch_log.ts`, `_run_reclassify_chunked.ts`, `_reclass_rollout.ts`; rename `conf_stats_unified_assembly.sql`→*_SUPERSEDED | — | git | — | not runnable | — | git | y | n |

### PHASE C — STUFF+ REGENERATE ON PROD (Claude runs --apply on "prod, now?")

| # | Step | Inputs | Producer | R/C | Staging-match gate | I/R | Reversible | DS | Trevor |
|---|---|---|---|---|---|---|---|---|---|
| C1 | Venue corrections — **DONE/verified** (311 rows, τ IVB 0.622/HB 0.662) | prod pitch_log | scripts/compute_venue_corrections.ts + scripts/sql/venue_correction_persist_prod.sql | R | fixture reproduced ✓ | y | table | y | n |
| C2 | Reclassify pitch_log.pitch_type_reclassified (keyset) | A2, A3 | scripts/reclassify_anchor_prod.ts (A2) | R | ≥95% vs `_reclass_result` | y | pitch_log backup | y | n |
| C3 | Re-aggregate `pitcher_stuff_plus_inputs` (new taxonomy) | C2 | A5 producer | R | ~31k rows | y | backup | y | n |
| C4 | Re-derive `pitcher_stuff_plus_ncaa` (DELETE season then insert) | C2 | A4 producer | R | ==18 rows | y | 71-row backup | y | n |
| C5 | **C24** backfill_trackman_pitches — GATED: must run AFTER C3 (post-reclass inputs ~31k, NOT stale 99,760) | C3 inputs | scripts/backfill_trackman_pitches_pitching_master.ts *(add `.order()`)* | R | NOT-NULL ~8,027/8,072 | needs fix (unordered .range) | rebuildable | y | n |
| C6 | NULL old pitch_log.stuff_plus (one-shot, **never re-run after C7 starts**) | — | runbook SQL | R | all IS NULL | n (destructive one-shot) | Master rollup backup covers display | y | n |
| C7 | Compute pitch_log.stuff_plus (keyset, WHERE IS NULL, filter `classification_version='v1-anchor-2026-08-17'`) | C2 stamp, C3, C4, A3, A6 RPC | scripts/compute_pitch_log_stuff_plus.ts | R | pending count drains to 0 | y | C6 backup | y | n |
| — | **STAGING-MATCH GATE**: per-pitcher Stuff+ on prod matches staging within pre-registered tolerance | | | | | | | | |
| C8 | **Backup then rollup**: CREATE `_master_stuff_backup` + `_confstats_backup` from CURRENT prod values, THEN rollup to Pitching Master.stuff_plus + Conference Stats.Stuff_plus | C7, aggregate_pitch_log_dimensions | scripts/derive_masters_from_pitchlog.ts + conf producers | R | Master.stuff_plus == pitch-weighted mean; conf HTP matches | y | **backups (build in-step)** | boundary-only | n |
| C9 | **C23** pull_air / in_zone_pct fills | pitch_log | scripts (aggregate_pitch_log_dimensions.ts) | R | matches staging | y | Master backup | y | n |
| C10 | **C25** derive_masters (desc_*, *_pr_plus) | C7,C9 | scripts/derive_masters_from_pitchlog.ts | R | staging tol | y | Master backup | y | n |
| C11 | **C26** computeAndStoreScores | C10 | src/lib computeAndStoreScores | R | staging tol | y | backup | y | n |
| C12 | **C27** ncaa_averages (incl. pitcher_exit_velo/ev90/in_zone fill) | Masters | src/lib/computeNcaaAverages.ts + **extract inline fills to committed scripts/sql/*.sql** | R | matches staging | y | backup | y | n |

### PHASE B/C — TEAM/CONF/PARK/ENV (order-critical; run in this order)

| # | Step | Inputs | Producer | R/C | Staging-match gate | I/R | Reversible | DS | Trevor |
|---|---|---|---|---|---|---|---|---|---|
| E1 | Apply pitch_log `is_conference_game` + `park_code` backfill on prod (2.58M rows, keyset) — **precondition for all conf rollups** | pitch_log | committed backfill (verify derive-over-copy, not `_next_derived.ts` copy) | R | matches staging distribution | y | pitch_log | y | n |
| E2 | **Park Factors seasonal/rolling** — ⚠ producer hardwired to STAGING URL + off-repo CSVs | local CSVs, Park Factors | scripts/backfill_park_factors_seasonal.ts *(FIX: env URL/key; commit CSVs)* | R | 309 rows rg_factor_seasonal populated; DIFF sane | needs fix (delete+reinsert, not is-distinct) | _park_factors_backup (staging only — add prod) | n (destructive replace) | n |
| E3 | **Conference Stats Bucket-A** (rates+env+ +WRC_plus+pitching rates) | E1 (is_conference_game) | scripts/sql/conf_stats_bucketA_assembly.sql | R | ~30 D1 rows, env+ ~100, WRC_plus shifts off stale | y (temp _conf_agg, keyed UPDATE) | backup conf | n (rewrites stale conf) | n |
| E4 | **D1 Conference Stats Stuff_plus** — ⚠ NO committed producer (present only as paused-push copy) | prod Masters | **MISSING** (build PA/IP-weighted rollup, or document import path) | R (currently copy) | matches staging (40/40) | y | conf backup | n | n |
| E5 | **conf_pitcher_env_plus** (era+/fip+/hr9+) | E3 rates | scripts/compute_conf_pitcher_env_plus.ts | R | 30 D1 rows, SEC era+>100 hr9+<100 | y (keyed) | conf backup | n | n |
| E6 | **run_env_factor + hitter_talent_plus + OPR** | E2 (rg_factor), E4 (Stuff_plus), E3 (WRC_plus) | scripts/derive_conf_opr_htp.ts --apply | R | run_env ~100, HTP matches staging | y | conf backup | n | n |
| E7 | Re-run pitcher transfers on stored HTP | E6 | transfer producer (ledger 416) | R | staging tol | y | player_predictions | n | n |
| E8 | **NJCAA-D1 re-tag** — extract inline SQL to committed scripts/sql/*.sql | division rows | **inline-only** (build file) | R | matches staging | y | backup | y | n |

### PHASE D — DESCRIPTIVE WAR

| # | Step | Inputs | Producer | R/C | Staging-match gate | I/R | Reversible | DS | Trevor |
|---|---|---|---|---|---|---|---|---|---|
| D1 | Apply `team_drs_store.sql` to prod (adds team_war_snapshots.team_drs) | migration | scripts/sql/team_drs_store.sql (fold into migration) | — | column exists | — | drop col | y | n |
| D2 | Run team_drs producer against prod — ⚠ `derive_team_drs.mjs` hardcoded staging, NO --prod | player_season_defense | scripts/drs/derive_team_drs.mjs *(FIX: add --prod + env guard)* | R | 308 D1 rows sum ~0; re-run staging too (empty there) | y | snapshot | y | n |
| D3 | load-drs-wsb-staging --prod | defense/bsr | scripts/load-drs-wsb-staging.ts (--prod ✓) | R | 13454 def / ~10432 bsr | y | tables | y | n |
| D4 | populate_descriptive_war.mjs --prod (reads team_drs) | D2 | scripts/populate_descriptive_war.mjs | R | matches staging | y | Master backup | y | n |
| D5 | populate_descriptive_war_reg.mjs --prod | D4 | scripts/populate_descriptive_war_reg.mjs | R | matches staging | y | backup | y | n |

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
| F1 | **Fire `refresh_composite_war()` (÷13.1)** — ONLY after E o_war reprecompute (prod d/bsr currently on superseded ÷10) | migration 20260810, E precomputes | supabase/migrations/20260810_composite_war_d1_rescale.sql | R | prod d_war = Σdrs_floor/13.1; total = o+d+bsr | y | pp backup | n (flip) | n |
| F2 | populate_hitter_run_values(2026) | pitch_log_hitter_totals refreshed | migration 20260826150500 fn | R | batting_rv ~6053 non-null | y | col nullable | y (nulls hide chip) | n |
| F3 | Snapshot backfills: backfill-neutral → heal-stale → backfill-snapshot-total-hitter-war (reads FRESH d/bsr, covers 1470 tbp/184 board) → recompute-snapshot-hitter-market → resync-* | F1, E precomputes | scripts/backfill-snapshot-total-hitter-war.ts (ordered ✓) etc. | R | 0 snapshots with o_war-but-null-total; known player reads snapshot | y | snapshots | n (window) | n |
| F4 | TWP markets → market resyncs → 42b re-price | F3 | committed | R | staging dist | y | pp | n | n |
| F5 | **refresh_team_season_stats(2026) LAST** — apply 20260819000000 (create) → 20260821010000 (war cols) → 20260819010000 (fn) first | E3–E6 conf, E2 park, team_war_snapshots | supabase/migrations + refresh_team_season_stats() | R | 308 D1 rows, 0-null WAR, AVG ~.277, wRC+ ~100, pwar matches snapshots | y (DELETE-season-then-rebuild atomic) | old rows persist until commit | y | n |
| F6 | Reseed team_war_snapshots | F5 | committed | R | staging | y | snapshots | n | n |

### PHASE G/H — DEPLOY + FLIP

| # | Step | Producer | Trevor |
|---|---|---|---|
| G1 | Apply RLS migration 20260823000000 (cross-team read leak; deps resolve on prod) | supabase/migrations/20260823000000_player_predictions_rls_team_scope.sql | n |
| G2 | Deploy edge fns (`process-precompute-jobs`, `recalculate-prediction`) — **AFTER F5 team_season_stats exists** | supabase functions deploy | **y** |
| G3 | PREVIEW-VERIFY on Vercel preview (= PROD Supabase) | — | n |
| G4 | **MERGE feature/war-recalibration → main** via `gh pr create`, Trevor clicks merge | — | **y** |
| H | Gated drops (Phase H) — never drop team_war_snapshots; enforce landmine list | — | n |

---

## 3. GAPS TABLE (blocker + high, deduped)

| # | Sev | Gap | Dimensions | Fix | Std violated |
|---|---|---|---|---|---|
| G1 | BLOCKER | `20260710120000_gm_allocations_per_build.sql` TRUNCATEs live gm_allocation (6+6 rows) inside stale `[ ]` block (ledger 90) | migration-ledger | Mark `[x]` APPLIED; strip/guard TRUNCATE; "DO NOT RE-RUN" note | 4, 6 |
| G2 | BLOCKER | v2 anchor reclassification WRITER does not exist (`reclassify_backfill.ts` validate-only; only DEAD copy + OLD v1 writers committed) | stuffplus-chain, runbook-order-safety | Build `reclassify_anchor_prod.ts` (keyset, direct session, is-distinct, stamps version); quarantine v1+copy scripts | 1, 2, 3 |
| G3 | BLOCKER | Classifier reconstruction ~85% vs staging (gate ≥95%); exact v2 constants UNRECOVERABLE | stuffplus-chain | Tier-2 fit vs `_reclass_result` answer key + tiebreaker/strip/fold; iterate --validate on large sample to ≥95% | 2, 3 |
| G4 | BLOCKER | `_reclass_pf` (per-pitcher primary-FB velo) absent on prod, no producer — classifier + scorer both READ it | stuffplus-chain, runbook | Build prod producer from pitch_log_corrected OR inline into A2+scorer; verify vs staging (4804) | 1, 2, 5 |
| G5 | BLOCKER | `pitcher_stuff_plus_ncaa` baseline (per pitch_type×hand) — no producer to re-derive on new taxonomy (only READERS) | stuffplus-chain | Build producer: mean+_sd per type×hand, DELETE stale then insert, stamp version; A/B vs staging (==18) | 1, 2, 5 |
| G6 | HIGH | `pitcher_stuff_plus_inputs` D1 re-aggregation — no committed producer (only add_d2 one-off); two Stuff+ sources of truth | stuffplus-chain | Decide single source of truth; build D1 re-aggregator or retire+repoint readers | 1, 2 |
| G7 | HIGH | Scorer gated on `classification_version='v1-anchor-2026-08-17'` that nothing STAMPS on prod (→0 rows) | stuffplus-chain | A2 writer must stamp version on every row; do NOT loosen filter | 5, 6 |
| G8 | HIGH | Stuff+ rollup backups `_master_stuff_backup`/`_confstats_backup` absent on prod, no committed step | runbook-order-safety | As first action of C8 rollup: CREATE backups from CURRENT prod values before overwrite | 7 |
| G9 | HIGH | C24 backfill_trackman ordering hazard vs stale 99,760-row `pitcher_stuff_plus_inputs` (staging 31,774) | runbook-order-safety, precomputes | Gate C24 on post-reclass re-aggregation (~31k); add `.order()` to unordered `.range()` | 5, 3, 4 |
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
## ★★★ CORRECTED STUFF+ CHAIN (2026-08-29) — USE THIS, NOT THE LEGACY STEPS BELOW/ABOVE
Any Stuff+ step in this document that routes through `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
`rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane** and is WRONG for 2026. Running it
revives the latent raw-HB bug (e5dec2f removed `hbSign`; PSP-I still stores RAW hb ⇒ left-handers scored backwards)
and writes numbers nothing displays. **Do not run those steps.**

**THE CORRECT ORDER (pitch_log lane — the live source of truth):**
1. **Reclassify** → `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`
   `scripts/reclassify_prod.ts` (v2 classifier; `--dry-run` first, then `--go` with PGURI + explicit "prod, now?")
2. **Re-derive the pop baseline** → `pitcher_stuff_plus_ncaa` (per pitch_type × hand, **armHB**, D1-only)
3. **Score per pitch** → `pitch_log.stuff_plus`  — `scripts/compute_pitch_log_stuff_plus.ts`
   (normalizes hb→armHB itself; recenters each (pitch_type × hand) bucket to mean 100)
4. **Aggregate** → `pitch_log_pitcher_totals` / `pitch_log_hitter_totals` / `*_by_pitch_type`
   `scripts/aggregate_pitch_log_dimensions.ts --apply` (also calls `populate_hitter_run_values(season)`)
5. **Marry onto the Masters** → `scripts/derive_masters_from_pitchlog.ts --apply`
   (⚠ add `.order(PK)` to its `readAll` pagination first — unordered `.range()` over ~2.5M rows silently drops/dupes)
6. Then continue the runbook: C23–C29 → Phase D (dWAR) → E (precomputes) → F (re-bakes) → G (edge fn) → H (drops).

**INVARIANTS**
- ⚠ A label change invalidates every downstream number. Steps 1→5 must complete in the SAME working session;
  never leave prod with new labels and old `stuff_plus`.
- `hb` is stored RAW everywhere and displayed raw. armHB is a COMPUTE convention only — normalize in memory.
  NEVER rewrite the stored `hb` column.
- One consistent label vocabulary: `4S FB` (not `4-Seam Fastball`) + a `classification_version` stamp on every row.
- Full detail + evidence: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`.

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
## 🏆 PHASE-H CLEANUP — DO NOT DROP `_reclass_result` (2026-08-29)
Phase H lists Stuff+ `_reclass_*` temp tables as drop candidates. **EXCLUDE these three:**
- **`_reclass_result` (2,000,674 rows)** — the ONLY surviving record of the lost ANCHOR classifier's output. Its source
  code was scratchpad-only and is gone permanently. Once staging is overwritten with v2 this is the SOLE way to ever
  measure against the old process. It is the regression baseline for every future classifier change.
- `_reclass_map` (37,101 rows) — per-pitcher seed→label resolution; the evidence base for arsenal-conditioning research.
- `_reclass_pf` (4,804 rows) — per-pitcher primary-FB velo.
Safe to drop: `_reclass_fix` (transient writer staging table only).

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

---
# 🔴 STEP 4 (aggregate_pitch_log_dimensions) — GATEWAY TIMEOUT ON `vs_top_hitters`. Found on staging 2026-08-29/30.
**EVERY aggregation in this script runs through `exec_sql` over the HTTP gateway** (`aggregate_pitch_log_dimensions.ts:1035`
`await supabase.rpc("exec_sql", { sql })`). The gateway cuts the client at ~125s and the work is LOST.

## The deterministic failure
`[40/48] vs_top_hitters → pitcher_totals — FAILED after 125.3s: upstream request timeout`
**Reproduced EXACTLY twice** — same dimension, same error, same 125.3s duration. Not a dropped connection: that query
must resolve the top-quartile hitter set (~967 IDs) and filter ~2M pitches against it, which exceeds the gateway ceiling.
47 of 48 aggregations complete fine (~60-72s each); only this one is structurally too heavy for `exec_sql`.
⚠ **The script HALTS on the failure**, so dimensions 41-48 never ran either — one bad dimension blocks 9.

## WORKAROUND USED ON STAGING (Trevor's call)
1. `--skip=vs_top_hitters` to clear the other 47 (the `--skip` flag exists at `:953-954`, matched at `:1029`).
2. Run `vs_top_hitters` SEPARATELY over the **direct pg session** (`PGURI`) where there is no gateway timeout —
   the same pattern the reclassifier already uses for its big writes.

## ⚠⚠ PROD IMPLICATION — THIS WILL BE WORSE ON PROD, PLAN FOR IT
Prod is on a smaller compute tier with a more throttled disk, and prod's `exec_sql` has ALREADY been observed timing
out on far lighter queries. Do NOT assume the other 47 will clear on prod just because they did on staging.
**Recommended prod approach: run stage 4 over the direct pg session from the start**, not through `exec_sql`.
Budget generously and run it detached/unattended-safe.

## SEPARATE, ENVIRONMENTAL FAILURES SEEN THE SAME NIGHT (do not confuse with the above)
Three earlier failures were the LOCAL MACHINE sleeping / dropping its connection overnight, NOT script defects:
- staging insert during the v2 test: `TypeError: fetch failed`
- STEP 3 scoring died at 1,665,000/2,015,321 (~83%): `read ECONNRESET`
- STEP 4 first run died at 13/48, second reached 39/48
**Symptom that distinguishes them:** environmental failures die at DIFFERENT points each run; the `vs_top_hitters`
failure dies at the SAME dimension with the SAME duration every time.
✅ **PROVEN PROCESS (Trevor): run long steps DETACHED in the background and let them take however long they need,**
with `caffeinate -dimsu -w <pid>` tied to the process so the machine cannot sleep mid-run. Do not babysit, do not
add aggressive retry loops.
⚠ STEP 3 (`compute_pitch_log_stuff_plus.ts`) is idempotent but does **NOT** resume — `:185` re-scores ALL rows matching
the class version rather than filtering `stuff_plus IS NULL`, so every attempt costs the FULL runtime (~36 min on
staging). A mid-run failure leaves **v2 labels + STALE scores**, the one state every doc says must never exist.

---
# ▶️ RESUME HERE — STAGING CHAIN 95% DONE (2026-08-30). Read this block first.

## ✅ DONE + VERIFIED ON STAGING (do NOT redo)
| step | result |
|---|---|
| 0 backup | `_v2_prechain_backup` = 2,579,655 rows / 2,191,583 labeled / 2,014,152 scored. **DO NOT DROP until the chain is signed off.** Reverses everything via one UPDATE…FROM join on `uniq_pitch_id`. |
| 1 classify | **2,015,321** stamped `v2-ranges-2026-08-28`, needs_review 8.1%, 101 batches, updated 1,995,321. `_reclass_pf` materialized (**5,364** pitchers) — NEW producer, first ever run, works. |
| 2 baseline | **✓ armHB SIGN CHECK PASSED ON ALL 18 BUCKETS** → upserted 18/18. The armHB convention is now PROVEN, not assumed (the deriver aborts before writing if it fails). |
| 3 score | **2,015,321 scored + recentered** (35.7 min). unscored=0. Every (type×hand) bucket recenters to **exactly 100.0**. |
| 4 aggregate | **45 of 48** refreshed + `populate_hitter_run_values(2026)` ✓. Tables: pitcher_totals 37,575 · hitter_totals 50,633 · pitcher_by_pitch_type 186,622 · hitter_by_pitch_type 301,957 · hitter run values 6,053. |

**★ PROD-GATE TOLERANCE (pre-registered): per-pitcher Stuff+ mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 · 4,234 pitchers.**
Prod must land within tolerance of this or ABORT.

## ⚠ OUTSTANDING ON STAGING
1. **3 × `vs_top_hitters` aggregations are STALE** — they failed twice (deterministic 125.3s gateway timeout) and were
   skipped on the successful run. ⚠ **`pitch_log_pitcher_totals` SHOWS `vs_top_hitters: 5,349` rows so the table LOOKS
   populated — those rows predate the v2 chain and are computed from OLD labels + OLD scores.** Must be re-run over the
   DIRECT pg session (`PGURI` in `.env.local`), not `exec_sql`.
2. **Step 5 `derive_masters_from_pitchlog.ts` — DRY RUN ONLY so far.** Dry run: **0 hitters** / **4,675 pitchers** would
   change (of 4,772 above-gate). Has NEVER been applied on ANY environment. Review the diff before `--apply`.

## ▶️ NEXT ACTIONS, IN ORDER
1. Run the 3 `vs_top_hitters` aggregations over the direct pg session (also = the PROD recipe for stage 4).
2. Review + apply step 5 (Masters) on staging.
3. **PROD BLOCKER FIRST — rebuild the stale view:** prod `pitch_log_corrected` is `select pl.*` frozen at **94 of 99
   columns** and is MISSING `classification_version`, so the scorer hard-fails there. Needs
   `drop view pitch_log_corrected cascade; create view …`. **DDL — needs its own explicit go, separate from "prod, now?".**
4. Apply migration `20260829120000_gm_budget_nil_allocation_mode.sql` to BOTH envs (committed, never run).
5. Prod chain: reclassify → baseline → score → aggregate (**direct session from the start**) → Masters. Then C23→C29,
   Phase D→H per the runbook, on the CORRECTED pitch_log lane.

## ⏱ REALISTIC TIME ESTIMATE FOR THE PROD RUN
Staging actuals: step 1 ≈ **75 min** (load+classify+2M keyset UPDATE) · step 3 ≈ **36 min** · step 4 ≈ **50 min**.
**Staging total ≈ 2.5-3 h.** Prod is a SMALLER compute tier with a MORE throttled disk and its `exec_sql` already times
out on lighter queries → **budget 4-6 h for the prod Stuff+ block alone**, plus C23-C29 and Phases D-H after it.
Do it in ONE sitting with the machine pinned awake (`caffeinate -dimsu -w <pid>`) — steps 1→5 must not be split, because
a gap leaves prod with **v2 labels + STALE scores**.
⚠ **Step 3 does NOT resume** (re-scores everything matching the class version), so any interruption costs the FULL
runtime again. Consider building the two-phase fix (score only NULLs → always recenter all) BEFORE the prod run.
