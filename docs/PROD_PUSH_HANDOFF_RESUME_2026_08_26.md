# PROD PUSH — RESUME HANDOFF (paused 2026-08-26 night)
> ⛔ **SUPERSEDED IN PART — READ `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md` FIRST (2026-08-29).**
> Stuff+ statements in this file were written before the lanes were untangled and contain WRONG conclusions.
> Corrected facts: (1) the LIVE Stuff+ is the **pitch_log lane** (armHB, self-consistent) — `pitch_log.stuff_plus` →
> `pitch_log_pitcher_totals` → Season Stats/PitcherProfile. (2) `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
> `rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane**, not read for 2026 (fallback for
> ≤2025 + JUCO only), and carries a latent raw-HB bug from `e5dec2f`. (3) `breakingBallReclassification.ts` never
> touched `pitch_log` — it is NOT the anchor classifier. (4) v2 is a re-runnable reconstruction for PROD + Track B; it is
> **NOT** an upgrade to staging's existing `pitch_type_reclassified` labels — do not overwrite them. (5) `A5 aggregator
> missing`, `baseline deriver missing`, and `pop/row convention mismatch` claims are FALSE — all verified present/consistent.


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

---
# ✅ SOLVED — STEP 4 `vs_top_hitters`: USE `--direct`. (staging-proven 2026-08-30)
**Root cause CONFIRMED, not theorised:** the query is not broken, it is simply LONGER than the HTTP gateway allows.
Over `exec_sql` it failed **twice, deterministically, at exactly 125.3s**. Over the DIRECT pg session the SAME query
**succeeded in 253.2s** — i.e. it needs ~2× the gateway's ~125s ceiling. Nothing else changed.

## THE COMMAND (staging)
```
npx tsx --env-file .env.local scripts/aggregate_pitch_log_dimensions.ts --apply --direct --only=vs_top_hitters
```
## ⚠⚠ THE COMMAND FOR PROD — RUN THE WHOLE OF STEP 4 WITH `--direct`, NOT JUST THIS DIMENSION
```
npx tsx --env-file .env.production.local scripts/aggregate_pitch_log_dimensions.ts --apply --prod --direct
```
**Reasoning:** `vs_top_hitters` already needs 253s on STAGING. Prod is a SMALLER compute tier with a MORE throttled
disk (expect ~8-10 min for that one dimension), and prod's `exec_sql` has ALREADY been observed timing out on lighter
queries. Through the gateway this dimension would fail on prod **100% of the time**, and the script HALTS on failure,
so it would also block the 8 dimensions that come after it. `--direct` is NOT a staging workaround — it is the
REQUIRED path on prod.

## NEW FLAGS ADDED TO `aggregate_pitch_log_dimensions.ts` (2026-08-30)
- **`--direct`** — executes over the `PGURI` session (`statement_timeout=0`, no gateway ceiling) instead of
  `exec_sql`. Guarded: the PGURI project ref MUST match the target env or it refuses to run. Logs which path is used.
- **`--only=<keys>`** — mirrors `--skip=`; runs ONLY the named dimension(s). Makes step 4 targetable, so a single
  failed dimension can be re-run without redoing the other 47. (Partial answer to the resumability gap.)
- (existing) **`--skip=<keys>`** — skip named dimensions.

## ⚠ THE TRAP THIS CREATED — A STALE DIMENSION THAT LOOKS POPULATED
When `vs_top_hitters` failed, `pitch_log_pitcher_totals` still SHOWED **5,349 rows** for that `dimension_key` — rows
left over from a PRE-v2 run, computed from OLD labels and OLD Stuff+ scores. **A row-count check would have passed.**
→ After ANY reclassification, verify a dimension by FRESHNESS (did this run write it?), never by row count.
→ Related: the script **exits 0 even when a dimension FAILED** — validate by CONTENT (grep the log for `FAILED` and
for the per-dimension `ok`), never by exit code. A run was wrongly marked COMPLETE this way on 2026-08-29.
