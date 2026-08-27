# PROD PUSH — RESUME HANDOFF (paused 2026-08-26 night)

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
- ⏳ **C20 park_code — IN PROGRESS** — rewrote `scripts/backfill_park_code_load.ts` prod-capable + self-contained
  (was staging-hardcoded + missing the UPDATE): creates `_park_code_fix`, loads park_code from `docs/drs-reference/*DRS Pitch Log.csv`,
  then raised-timeout `UPDATE pitch_log.park_code`. **RESUME HERE:** run it (`--prod`), verify park_code populated + matches staging, commit + log.

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
