# PROD PUSH — RESUME HANDOFF (paused 2026-08-26 night)

> ## ★★ READ `docs/PROD_PUSH_STEPS_2026_08_26.md` IN FULL BEFORE ANY STEP — FOLLOW IT EXACTLY. DO NOT INVENT A PROCESS.
> Learned the hard way on C20 (park_code): the runbook says a **"raised statement_timeout single UPDATE."** That is the
> process. Do THAT and BE PATIENT — a full-table pitch_log UPDATE is ~8–12 min TOTAL (per scan, not per row) and that is
> FINE. Do NOT batch it / nested-loop it / pg_cron it — that was tail-chasing.
> **Mechanism that works for big pitch_log UPDATEs: the Supabase SQL EDITOR** (`SET statement_timeout='900s'; UPDATE …;`).
> The editor holds the connection for the full run. `exec_sql`/rpc RECYCLES the pooled connection ~13 min in and kills
> the query mid-flight (that's why step-20's UPDATE kept "rolling back"). "failed to fetch" in the editor is just the UI
> losing the response — the query keeps running; wait it out, then verify.

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
- ⏸️ **Stuff+ — BLOCKED on reclassification rebuild (Option A, Trevor 2026-08-28). ★ See `docs/STUFF_PLUS_RECLASS_REBUILD_PLAN.md`.**
  ⚠ **CORRECTION 2026-08-28 (where it IS vs SHOULD be):** staging's per-pitch labels came from an IN-DB "classifier v2" that was NEVER
  committed (the fastball split, v2 breaking thresholds, anchor-gravity override, per-pitch propagation are all scratchpad; commits 8827a38/63b0edd
  are docs-only). Committed code (`reclassifyRHP` etc.) is an EARLIER version → reproduces staging only ~73%. GROUND TRUTH = staging `_reclass_result`
  (2M, env-independent). SHOULD BE: the whole reclassifier built as committed code in Track B, validated vs `_reclass_result`. Full findings in the
  rebuild-plan doc. FOR THIS PUSH pick: RECOVERED 2026-08-28: the classifier CASE is retained in staging `pg_stat_statements` — exact structure (curve→sweeper→
  fastball-gap-split→offspeed→slider→gyro on ivb/armHB/gap/spin) recovered; only literal thresholds are masked (`$N`) → FIT to `_reclass_result`.
  `pf_velo` stored in `_reclass_pf`. See `docs/STUFF_PLUS_RECLASS_REBUILD_PLAN.md` §BREAKTHROUGH. Rebuild in `scripts/reclassify_backfill.ts`
  (structure done; label/threshold fit vs `_reclass_result` = open step). This becomes the committed Track-B classifier.
  The per-pitch anchor reclassification (clustering→seeds→per-pitch label write) was scratchpad-only + is NOT recoverable from committed code
  → must REIMPLEMENT from the documented anchor algorithm (reusing committed `consolidate()`), validate vs staging, commit. This is a BUILD
  (own session), and it IS Track-B stage 3.1. Everything below is the surrounding Stuff+ sequence; the rebuild is the prerequisite.

  #### ★★ STUFF+ REGEN PLAN — resume here tomorrow (docs/STUFF_PLUS_RESUME_2026_08_17.md is the source-of-truth procedure)
  **DONE tonight:**
  - ✅ Schema gap closed: `20260828000000_pitch_log_classification_version_needs_review.sql` (added `classification_version` text +
    `needs_review` boolean to prod pitch_log — ad-hoc gap; committed + applied). fb_gap = folded into existing `velo_diff`/`fb_ch_velo_diff`
    (present on both envs — NOT a separate column). `pitcher_stuff_plus_inputs` + `pitcher_stuff_plus_ncaa` schemas already match staging.
  - ✅ Equations VERIFIED committed + PUSHED: `e5dec2f` (fold final equations), `7d62479` (recenter-vs-scope fix), `a837a90` +
    (gyro/reclass improvements). Source files clean (not stranded uncommitted). The code that runs = the code that built staging.
  - ✅ pop-stats `pitcher_stuff_plus_ncaa` present on prod (71 rows, 9 types, 2026).

  **APPROACH (CORRECTED 2026-08-28 — Trevor):** this push runs the data through the **CURRENT** stage-3 pipeline correctly (NOT the old
  CASE, NOT Track B). Track B (the ONE unified edge fn, `docs/PIPELINE_pitch_log_to_projections.md`) = a **separate future feature branch**.
  - ⛔ **The old per-pitch deterministic CASE is SUPERSEDED** (`reclassify_pitch_log.ts`, `_run_reclassify_bare/chunked.ts`). Verified against
    staging: it reproduces only **~41%** of staging's labels → it is NOT the classifier that built staging. Do not use it.
  - ✅ **The correct reclassification is MOVEMENT-based at the pitcher-seed level** (PIPELINE doc stage 3.1): `breakingBallReclassification.ts`
    reads `pitcher_stuff_plus_inputs` (per pitcher × pitch_type × hand, venue-corrected) and writes `rstr_pitch_class` per seed; each pitch then
    inherits its pitcher-seed's label. That's why per-pitch CASE fails (classifier judges the pitcher's aggregate, not each pitch).

  #### ★★ LOGGED GAP (missing/broken — for this push AND Track B):
  **The reclassification MECHANISM (confirmed w/ Trevor + read-only staging probes 2026-08-28):** per-pitch **movement classification** THEN
  per-pitcher **consolidation** — infrequent pitches near a movement-bucket boundary get overridden into the pitcher's dominant adjacent bucket.
  Evidence: the pure per-pitch CASE reproduces only **~41%** of staging labels (no consolidation); `pitcher_stuff_plus_inputs.pitch_type` is the
  RECLASSIFIED 9-category label (NOT raw codes → a raw-code join returns 0 rows); `rstr_pitch_class` carries **seed sub-versions**
  (`Slider_v1/_v2`, `Gyro Slider_v1..v5`, `Cutter_v1..v4`) = the consolidation/clustering. Logic lives in `breakingBallReclassification.ts`
  (`boundary_case` / `p_consolidated` passes) — committed ✅.
  **THE GAP:** no clean committed writer lands this classifier's **per-pitch** result on `pitch_log.pitch_type_reclassified`. `breakingBallReclassification.ts`
  writes `pitcher_stuff_plus_inputs`/`Master`, never pitch_log; the only committed pitch_log writers are the SUPERSEDED CASE. Staging's per-pitch
  pitch_log labels came from ad-hoc scratchpad tooling (`_reclass_result` → pitch_log). → **TOMORROW: map how the committed classifier's per-pitch
  labels reach pitch_log (run the classifier, trace/rebuild the per-pitch write), validate vs staging, COMMIT it.** NOT a simple join (join hypothesis
  disproven). Also confirm the writer of `classification_version`/`needs_review`. Required for Track B too.

  **SEQUENCE FOR THIS PUSH (run the current stage-3 scripts, validate each vs staging):**
  1. RE-AGGREGATE `pitcher_stuff_plus_inputs` per (source_player_id × pitch_type × hand) from `pitch_log_corrected` (venue-corrected).
  2. RECLASSIFY seeds: `breakingBallReclassification.ts` (movement classifier) → `rstr_pitch_class` on inputs.
  3. **PROPAGATE** rstr_pitch_class → `pitch_log.pitch_type_reclassified` (the GAP above — write + commit the join, verify vs staging).
  4. RE-DERIVE baseline `pitcher_stuff_plus_ncaa` (post-reclass, stamped).
  5. NULL old `pitch_log.stuff_plus`; COMPUTE per-pitch (`compute_pitch_log_stuff_plus.ts`, reads pitch_log_corrected, recenters) — keyset, not ctid.
  6. ★ STAGING-MATCH GATE at each stage.
  7. ROLLUP → Pitching Master.stuff_plus + Conference Stats.Stuff_plus (back up first). STOP before propagation (scores/ncaa/predictions = later steps).
  Orchestrator `recompute-stuff-plus.ts` runs velo-diff→reclassify→score→rollup on inputs+Master (INTERACTIVE `--prod` guard, gateway writes) —
  but it does NOT write pitch_log; the per-pitch pitch_log path (steps 3+5) is separate. ⚠ MAP the exact current writers before running.

  **THE SEQUENCE (once labels are in, either path):** (logged in STUFF_PLUS_RESUME §"RE-DERIVE SEQUENCE")
  1. Ensure `pitch_type_reclassified` = anchor taxonomy on prod pitch_log (via A or B).
  2. RE-AGGREGATE `pitcher_stuff_plus_inputs` per (source_player_id × pitch_type_reclassified × hand) from `pitch_log_corrected`
     (armHB = R?hb:−hb stored in `hb`; velo_diff for CH). Small (~15–40k rows, fast GROUP BY).
  3. RE-DERIVE baseline `pitcher_stuff_plus_ncaa` (the two derivers: `nonBreakingBallPopConstants.ts` + `breakingBallReclassification.ts`
     pop step, on new taxonomy). Small.
  4. **NULL old `pitch_log.stuff_plus`** (compute script only processes IS NULL), then COMPUTE per-pitch via `compute_pitch_log_stuff_plus.ts`
     (reads `pitch_log_corrected`, computes armHB+fb_gap per pitch, recenters each type×hand bucket to mean 100). ⚠ writes via
     `bulk_update_pitch_log_stuff_plus` RPC (confirm it EXISTS on prod first) in 1000-row batches — **run ALONE (one job/table), keyset not ctid**.
  5. ★ **STAGING-MATCH GATE** — compare prod pitch_log.stuff_plus vs staging by uniq_pitch_id (sample); ABORT if mismatch beyond tolerance.
  6. ROLLUP directly from pitch_log → `Pitching Master.stuff_plus` (pitch-weighted avg/pitcher) + `Conference Stats.Stuff_plus` (avg/conf).
     Back up first (`_master_stuff_backup`, `_confstats_backup`). STOP here (--stuff-only equivalent) — do NOT propagate to scores/ncaa/predictions
     (those are separate ordered steps C26/C27 + Phase E/F).
  **Write mechanic:** use the proven keyset/direct-session pattern for the ~2M writes (NOT ctid; NOT single-UPDATE-via-gateway which rolls back).
  **Validation at every stage = does it match staging** (Trevor's gate). Orchestrator `recompute-stuff-plus.ts` exists but has an INTERACTIVE
  `--prod` guard + gateway-bound writes → prefer running the stages explicitly with the robust write transport.

  ### ★ PRINCIPLE (Trevor, 2026-08-28): prefer DERIVE over COPY where the derivation must work in the future.
  Copying park_code/is_conf/sequence from staging was a one-time migration expedient (values correct, fast, under the disk-IO crunch).
  But prod must be able to DERIVE these columns going forward (every new pitch-log upload) — so the on-upload pipeline / Track B edge fn
  must run the real derivation on prod, not depend on staging copies. Stuff+ is done the "right" way (clean regen). FOLLOW-UP: verify the
  park_code/is_conf/sequence derivation scripts run on prod + are wired into the go-forward pipeline. [[project_unified_projection_edge_function]]
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

  ### ⚠ REMAINING BIG pitch_log FULL-TABLE WRITES (each hits the SAME Disk IO wall — use the keyset method)
  1. **C21 is_conference_game** (~2.5M-row UPDATE) · 2. **C22 sequence / pitch_num_in_game** (~2.5M-row UPDATE) — these two are
     env-independent → **combine into ONE keyset pass** (set both column groups per batch). 3. **Stuff+** classification+scoring
     (writes stuff_plus + pitch_type_reclassified to ALL ~2.5M rows) — the **heaviest**; strongly favor a **temporary compute bump**.
  Everything after (derive_masters, scores, ncaa_avg, conf-stats, Phase D/E/F) reads pitch_log AGGREGATES → writes small Master/ConfStats
  tables → does NOT hit this wall. Pattern for all three: `scripts/_pc_keyset.ts` as the template (keyset PK, throttle, direct session, resumable).

### Then continue Phase C
21 is_conference_game (`backfill_is_conference_game.ts`) · 22 sequence (`pitch_log_sequence_backfill_steps.sql`) ·
23 pull_air/in_zone · Stuff+ (heavy) · 24 trackman · 25 derive_masters · 26 scores · 27 ncaa_avg · 28 conf-stats (G-gate) · 29 NJCAA re-tag.
⚠ Expect more staging-hardcoded scripts / missing UPDATE-SQL / missing helper tables — same reconstruct-from-staging-and-commit pattern.
Full learnings: `docs/AGENT_LEARNINGS_prod_push_execution_2026_08_27.md`.

### Phase C steps (per runbook, with what exists)
- **19** pitcher_full_name — ⚠ reconstruct (above).
- **20** park_code backfill — `scripts/backfill_park_code_load.ts` (loads DRS CSVs → `_park_code_fix` → raised-timeout UPDATE; restore role timeout after). prod park_code currently NULL.
- **21** is_conference_game — `scripts/backfill_is_conference_game.ts` (`flag_conf_batch(n)` RPC loop until 0). prod NULL.
- **22** pitch_log sequence — `scripts/sql/pitch_log_sequence_backfill_steps.sql`. prod pitch_num_in_game NULL.
- **23** Hitter Master `pull_air` + Pitching Master `in_zone_pct` from `pitch_log_*_totals`.
- **Stuff+ (HEAVY, ~2.5M pitches):** per-pitch classification (`compute_pitch_log_stuff_plus.ts`, reads `pitch_log_corrected`) → scoring → rollup (`recompute-stuff-plus.ts`). Recomputes `stuff_plus` with the NEW venue fixture (prod stuff_plus is currently old).
- **24** `backfill_trackman_pitches_pitching_master.ts --apply` (after `pitcher_stuff_plus_inputs` populated).
- **25** `derive_masters_from_pitchlog.ts --apply` (needs A11 UNIQUE ✓) → Stuff+ rollup BEFORE compute_scores.
- **26** `computeAndStoreScores` (power ratings; propagate=false).
- **27** `computeNcaaAverages`.
- **28** Conference Stats — ★ **G-GATE FIRST** (re-run `conf_stats_bucketA_assembly.sql` on STAGING vs `_confstats_backup_preassembly`, diff 0.0000) THEN prod: bucketA (PASTE, never --linked) · `compute_conf_pitcher_env_plus.ts --apply` · `derive_conf_opr_htp.ts --apply`. ⚠ DO NOT run `populate-conf-stats` (overwrites JUCO overlay).
- **29** NJCAA_D1 re-tag `UPDATE "Conference Stats" SET division='NJCAA_D1' WHERE season=2026 AND "conference abbreviation" LIKE 'NJCAA%' AND division='D1'`.

## REMAINING PHASES (after C)
- **D — dWAR/bsr:** `load-drs-wsb-staging.ts --prod` (idempotent re-load; data already current) → `populate_descriptive_war.mjs --prod --commit` → `_reg.mjs --prod --commit` (fills the desc_* Master cols we added in Phase A). Verify d_war/bsr_war centered.
- **E — precomputes (HEAVY) ★order:** `run-twp-recompute.ts --apply` (is_twp 137→253, FIRST) → returner pitchers (`:prod`) → returner hitters (`:prod`) → `zsh scripts/_run_step2_all.sh --prod` (all 18 teams incl. NC, dynamic list; raise statement_timeout for propagate).
- **F — re-bakes ★order:** `select refresh_composite_war();` (÷13.1, only now) → `backfill-snapshot-total-hitter-war.ts --apply` → TWP markets → market resyncs → **`recompute-snapshot-hitter-market.ts --prod --apply`** (stale-PTM re-price, step 42b) → neutral + heal snapshots → `select refresh_team_season_stats(2026);` LAST → reseed 2026 team_war_snapshots + display swap.
- **G — edge fn (Trevor):** `supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm` (prod v12 → v27). NEVER `--linked`.
- **PREVIEW-VERIFY → MERGE:** check the Vercel preview (reads PROD) → merge to main (Trevor drives).
- **H — gated drops (LAST):** park_factors lowercase (strip google-sheets-sync calls first) · pitch_log corrupt team-id cols (recreate view first) · player_prediction_internals · one-off temps. **NEVER drop `team_war_snapshots`** (2025 champions = 309 rows on prod).

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
