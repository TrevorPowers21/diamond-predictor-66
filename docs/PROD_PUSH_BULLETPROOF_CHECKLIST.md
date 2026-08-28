# PROD PUSH BULLETPROOF CHECKLIST — feature/war-recalibration → prod (trbvxuoliwrfowibatkm)

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
