# PROD PUSH — DEFINITIVE STEP-BY-STEP (2026-08-26)
> ⛔ **SUPERSEDED IN PART — READ `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md` FIRST (2026-08-29).**
> Stuff+ statements in this file were written before the lanes were untangled and contain WRONG conclusions.
> Corrected facts: (1) the LIVE Stuff+ is the **pitch_log lane** (armHB, self-consistent) — `pitch_log.stuff_plus` →
> `pitch_log_pitcher_totals` → Season Stats/PitcherProfile. (2) `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
> `rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus` is the **LEGACY lane**, not read for 2026 (fallback for
> ≤2025 + JUCO only), and carries a latent raw-HB bug from `e5dec2f`. (3) `breakingBallReclassification.ts` never
> touched `pitch_log` — it is NOT the anchor classifier. (4) v2 is a re-runnable reconstruction for PROD + Track B; it is
> **NOT** an upgrade to staging's existing `pitch_type_reclassified` labels — do not overwrite them. (5) `A5 aggregator
> missing`, `baseline deriver missing`, and `pop/row convention mismatch` claims are FALSE — all verified present/consistent.


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
- `team_season_stats` table + **war columns** (A10, incl. hitter_war/rotation_pwar) — DONE. But the table is **EMPTY for 2026** → Phase F populate still NEEDED.
- `player_season_defense` (13,454) + `player_season_baserunning` (10,432) — DONE, **current engine 0.11.0**. Loader (D30) is idempotent upsert → re-run harmless or SKIP. **desc-WAR Master cols are still MISSING → D31/32 populate NEEDED.**
- `20260806 RENAME total_war→total_hitter_war` — DONE (`total_hitter_war` exists). ⚠ **SKIP — non-idempotent, ERRORS on re-run.**
- `trackman_pitches` col — present (DDL done; the **data backfill C24 still NEEDED**). `offensive_power_rating` col — present.
- `team_war_snapshots` **2025 champions = 309 rows — DONE (never drop).** 2026 = 466 (will be reseeded F45).
- `refresh_composite_war()` exists but at **÷10** (Push-1 v1) → A6 redefines ÷13.1 (def only), F39 refires.

**NEEDED (run per runbook — prod does NOT have these):**
- **A2/3** Master `desc_*` / `desc_*_reg` cols (MISSING) · **A7** `park_code`/`is_conference_game`/`sequence` (MISSING) ·
  **A8** ConfStats `hitter_talent_plus`/`run_env_factor`/`era_plus…hr9_plus` (MISSING) · **A9** Park `*_seasonal`/`era_factor` (MISSING) ·
  **A11** `pitch_log_pitcher_totals.ip` (MISSING) + Masters UNIQUE · **A12** venue corrections (**table EMPTY, 0 rows, no version → populate**) · **A13b** run-value cols (MISSING).
- **ALL of Phase B** — model_config **79→201 keys**, `nil_tier_sec` **1.5→4.0**, `ncaa_averages.wrc` **0.357→0.3782**, `owar_repl_600` **25→21.22**, `r_obp_std_pr` **28.889→31.89504**, transfer weights, **two-sided SD (`_sd_bad` = 0 → 6)**.
- **ALL of Phase C** producers (park_code/conf/sequence backfills, pull_air/in_zone, trackman_pitches DATA, derive_masters, Stuff+ rollup, computeAndStoreScores, ncaa_averages, conf-stats env+/OPR/HTP, **NJCAA_D1 re-tag = 0 → NEEDED**).
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
`compute_venue_corrections.ts --prod --apply` (venue table + `pitch_log_corrected` view) → Stuff+ classification →
Stuff+ scoring → Conference Stats bucket-A + env+/OPR/HTP → `team_season_stats` (records + pitching rates) → any
pitch-log dWAR. Each reads the corrected/clean pitch_log; running any before GATE 0/1 silently bakes in dup/partial data.

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
10. `20260819000000_team_season_stats.sql` (117 cols + 3 idx + RLS ENABLE + `preseason_proj_total_war`) + `20260819010000_refresh_team_season_stats.sql` (the rebuild fn). IDEM
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
23. C1 Hitter Master `pull_air` + C2 Pitching Master `in_zone_pct` from prod `pitch_log_*_totals`. REGEN
24. `scripts/backfill_trackman_pitches_pitching_master.ts --apply` (prod) — after prod `pitcher_stuff_plus_inputs` populated. REGEN
25. `scripts/derive_masters_from_pitchlog.ts --apply` (prod) → **G0 Stuff+ rollup** `scripts/recompute-stuff-plus.ts` (needs step 12) → BEFORE compute_scores. REGEN
26. D1 store recompute `computeAndStoreScores` (power ratings; propagate=false) — writes `ba/obp/iso_power_rating` + pitcher `*_pr_plus`. REGEN
27. `computeNcaaAverages` — dual-writes `ncaa_averages` + `model_config`; incl. `pitcher_exit_velo`/`ev90`/`in_zone_pct` = hitter avgs 1:1. REGEN
28. Conference Stats — **G-GATE FIRST** (blocker 3): re-run `scripts/sql/conf_stats_bucketA_assembly.sql` on STAGING vs backup `_confstats_backup_preassembly`, confirm diff 0.0000. THEN prod: `conf_stats_bucketA_assembly.sql` (**PASTE, never `--linked`**) · `scripts/compute_conf_pitcher_env_plus.ts --apply` · `scripts/derive_conf_opr_htp.ts --apply`. ⚠ **DO NOT run `populate-conf-stats`** (overwrites JUCO overlay). REGEN
29. NJCAA-D1 re-tag: `UPDATE "Conference Stats" SET division='NJCAA_D1' WHERE season=2026 AND "conference abbreviation" LIKE 'NJCAA%' AND division='D1'`. IDEM

# PHASE D — dWAR / bsrWAR (blocker 1) ★ADD-RUN-STORE — this is the defense/baserunning process on prod
Prereq: step 4 (tables) applied; engine output CSVs present in `scripts/drs/output/` (env-independent, keyed by
source_player_id — reuse the same CSVs, do NOT re-run the Python engine unless the source export changed).
30. **Load raw dRS + wSB into prod** — dry-run then apply:
    `npx tsx scripts/load-drs-wsb-staging.ts --prod --dry-run`  →  `npx tsx scripts/load-drs-wsb-staging.ts --prod`
    Resolves PROD uuids (source_player_id first, name fallback), upserts `player_season_defense` (~13,454) +
    `player_season_baserunning` (~10,408). Unresolved rows are logged, never dropped. REGEN-uuid
31. **Descriptive WAR (total)** — `node scripts/drs/populate_descriptive_war.mjs --prod` (dry-run) → `… --prod --commit`.
    Writes Master `desc_owar` / `d_war` (=Σ drs_floor pos≠P /RPW) / `bsr_war` (=wsb_runs/RPW) / `total_desc_war`. REGEN
32. **Descriptive WAR (reg split)** — `node scripts/drs/populate_descriptive_war_reg.mjs --prod` (dry-run) → `… --prod --commit`.
    Writes Master `desc_*_reg` (reads `player_season_defense_regseason.csv` + `hitter_accrued.csv` reg_* + `wsb_runs_reg`). REGEN
33. **team_drs** (optional exhibit) — `node scripts/drs/derive_team_drs.mjs` re-pointed at prod (or via team_season_stats). REGEN
34. Verify: `d_war`/`bsr_war` populated + centered (~mean 0.01 / 0), `total_desc_war = desc_owar + d_war + bsr_war`.

# PHASE E — PRECOMPUTES ★ORDER
35. **TWP detector FIRST** — `npx tsx scripts/run-twp-recompute.ts --apply` (prod). ⚠ REGEN from prod Masters (do NOT copy staging flags). Dry-run first (default). Sets `is_twp` + primary `position`. MUST precede precomputes so both-side rows generate.
36. **Returner pitchers** — `npm run precompute-returner-pitchers:prod` (dry-run first). Needs the `_plus_ncaa_` overlay (commit 3c4e8c8) or returners ignore the calibration. Writes full pitcher row incl. p_war/market/HR9-floor. REGEN
37. **Returner hitters** — `npm run precompute-returner-hitters:prod` (= `backfill-2027-hitter-returners:prod`; runs `createPredictionsFromMaster` internally). REGEN
38. **Transfers (all 18 teams incl. NC via dynamic list)** — `zsh scripts/_run_step2_all.sh --prod` (reads live `customer_teams`). Runs `precompute-transfer-projections` + `precompute-pitchers` per team. ★ raise statement_timeout for the propagate step. REGEN

# PHASE F — RE-BAKES ★ORDER
39. FIRE `select refresh_composite_war();` (÷13.1) — only now (after desc WAR + precompute). Rewrites the **descriptive Master** d/bsr/total at ÷13.1. Note: NOT the source for `player_predictions.total_hitter_war` (producers write that directly). Sets statement_timeout internally.
40. `scripts/backfill-snapshot-total-hitter-war.ts --apply` (prod) — 7b snapshot catch-up. IDEM-by-value
41. TWP markets: `rebuild-twp-target-rows --apply` · `rebake-twp-markets --apply` · `fix-returner-twp-hitter-market --apply` (prod). REGEN
42. Market resyncs: `resync-build-snapshot-markets.ts --all --apply` · `resync-target-snapshots.ts --all --apply` (prod). IDEM
42b. **Snapshot hitter market RE-PRICE (stale-PTM fix)** — `recompute-snapshot-hitter-market.ts --prod --apply`. Re-derives every hitter snapshot's `market_value` (TWP → `twp_hitter_market_value`) as `total_hitter_war × $25k × PTM(build-program conference) × PVF(players.position)`, writing ONLY the dollar field — every dev_agg/depth/nil toggle preserved. **Why:** snapshots baked before the SEC-4.0 re-price still hold the OLD SEC 1.5 PTM (~$42.5k/win); nothing re-baked them (the profile/TB pure-read the snapshot, so stale $ shows verbatim — e.g. Souza $50,983 for 1.20 WAR). Re-prices SEC builds ~2.6× up, other tiers barely move. **PVF is CORRECT in the market** (pricing layer, spec §7.2) — it is only removed from the Player SCORE (`calcPlayerScore`, spec §1). ⚠ **GOTCHA (must keep):** filter null/non-UUID pids before the `players` position lookup + error-check each `.in` batch — a single literal-`null` player_id (portal-search add) makes Postgres reject the WHOLE `.in("id",batch)` as invalid-uuid, silently dropping ~200 real players' positions → PVF wrongly flattens to 1.0 (Souza $119,839 instead of $131,823). Idempotent. Staging verified: 472 rows then 38 position-corrections; Souza both builds $110k/win (SEC 4.0×IF 1.10); 0 markets >$130k/win; 0 negative; re-dry-run 0. IDEM
43. Snapshots: `backfill-neutral-snapshot.ts --prod --apply` → `heal-stale-snapshots.ts --prod --apply --yes` (ordered-`.range()` versions only). IDEM
44. `select refresh_team_season_stats(2026);` — **LAST**; reads PROD's own `team_war_snapshots` (2025 LSU champ + 39 conf — never drop). REGEN
45. Reseed 2026 `team_war_snapshots` from desc WAR + fill player/transfer snapshots + `o_war→total_hitter_war` display swap (already branch code). REGEN

# PHASE G — EDGE-FN DEPLOY (Trevor; explicit `--project-ref trbvxuoliwrfowibatkm`, NEVER `--linked`)
46. `supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm` — two-sided SD + HR9 floor + TWP-aware + per-conference PTM + faced-competition. Deploy AFTER prod has conf env+ / `ba/obp/iso_plus` + model_config transfer weights. (Staging is at v27; prod is v12.)
47. ~~`recalculate-prediction` returner rebuild~~ — DEAD/superseded (blocker 4). Do NOT run. Returners = batch scripts (steps 36–37).

# PHASE H — GATED DROPS (last, each behind its gate)
48. `DROP TABLE player_prediction_internals` — only after `bulkRecalc` retired + regen `types.ts`.
49. `DROP TABLE public.park_factors` (lowercase) — strip the 2 `from("park_factors")` calls in `google-sheets-sync/index.ts` FIRST/together.
50. `DROP COLUMN pitch_log.batting_team_id`/`pitching_team_id` — recreate `pitch_log_corrected` VIEW without them first.
51. Cleanup temps/RPCs: `_pitcher_name_fix`, `fix_pnames`, `_park_code_fix`, `flag_conf_batch`, `set_conf_game`, `_team_conf`, Stuff+ `_*_backup`/`_reclass_*`. **NEVER drop `team_war_snapshots`.**

---

# VERIFICATION GATES (run at push time)
- **Config present:** model_config 201 keys season 2026; `obp_std_pr`=31.89504, `whip_pr_sd`=37.19844; nil_tier_sec=4.0.
- **Global NULL-count (server-side, not sampling):** `count(*) FILTER (WHERE park_code IS NULL)` on pitch_log = 0; per-pitcher `count(DISTINCT pitcher_full_name)=1`.
- **dWAR/bsrWAR:** player_season_defense/baserunning populated; Master `d_war`/`bsr_war` non-null + centered; `total_desc_war=desc_owar+d_war+bsr_war`.
- **Across-the-range calibration (doctrine gate):** actual vs projected by power-rating bin, BOTH tails; top-12 pitchers genuine Stuff+ 99–113, 0 weak-stuff arms; **0 negative projected rates except HR9-floored**.
- **TWP:** is_twp regenerated from prod Masters; a known TWP shows both sides + combined NIL + both roster slots; D1-TWP transfer split complete.
- **Market re-price roster totals:** SEC ~$4.4M / ACC ~$1.7M / Big12 ~$1M / BigTen ~$900k; Independent tier = 1.0.
- **All 18 customer teams precomputed** (dynamic list incl. North Carolina).
- **Edge fn:** deploy staging→prod; add a test team, confirm its projections match the batch (canonical TS ↔ edge-fn lockstep).
- **team_season_stats:** 308 rows; reads prod 2025 champions.

# STILL-DEFERRED (NOT push blockers)
JUCO TWP market split (fix before JUCO ships) · all JUCO · Stuff+ display min-pitch gate · 19 sub-5-IP negative HR9 ·
hitters two-sided SD · is_position_of_need · Track B unification · WIRE C frontend repoint · nil_valuations RLS · pitch_log.vaa/classification_version.

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
