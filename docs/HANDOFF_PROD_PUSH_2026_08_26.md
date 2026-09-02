# HANDOFF — PROD PUSH (feature/war-recalibration) — 2026-08-26

The single "start here" for executing the prod push. State, the doc map, the execution flow with its gates, and the
verification. The exact numbered commands live in `docs/PROD_PUSH_STEPS_2026_08_26.md`; this is the orientation +
safety layer around them.

## WHERE THINGS STAND
- **Branch:** `feature/war-recalibration`. Everything below is **built + verified on staging**; **prod is untouched.**
- **Trevor drives every prod write.** Claude prepped/verified on staging + can dry-run. Log every prod change to `PROD_MIGRATIONS_TODO.md`.
- **All 4 pre-prod blockers resolved:** (1) dWAR/bsrWAR prod path — loader + populators now `--prod`; (2) venue
  corrections — producer rebuilt + validated (reproduces the original within 0.011″); (3) conf-stats bucketA idempotent
  gate — PASSED on staging; (4) returner path — batch scripts are canonical (edge-fn rebuild is dead).
- **Staging verified:** is_twp 253, 0 negative projected pitching rates / 104k rows, total_hitter_war consistent,
  D1-TWP transfer splits complete, 18 customer teams (incl. North Carolina), 265/265 tests, edge fn v27 on staging.

## THE DOC SET (what to open when)
| Doc | Use |
|---|---|
| **`PROD_PUSH_STEPS_2026_08_26.md`** | THE runbook — 51 numbered steps (Phase 0→H) + PITCH-LOG INTEGRITY gates + CALCULATION REFERENCE (every formula) + SCHEMA/SQL REFERENCE (every migration) + PROD LANDMINES |
| **`PRE_PROD_AUDIT_2026_08_26.md`** | Readiness verdict + stale-doc reconciliations (authoritative values) |
| **`STAGING_UX_WALKTHROUGH_2026_08_26.md`** | Sit-down coach test — run this on STAGING before pushing |
| **`STAGING_DISPLAY_TEST_CHECKLIST_2026_08_26.md`** | Exhaustive per-page UI reference if something red-flags |
| **`PROD_MIGRATIONS_TODO.md`** | The change ledger — append every prod change as it runs |

## EXECUTION FLOW (phases — full commands in PROD_PUSH_STEPS)
Every DATA step **regenerates on prod** (prod resolves its own UUIDs/venue ids); DDL is idempotent. **Dry-run every
`--apply`/`--commit`/`--prod` step first.** ⚠ `supabase --linked` = PROD; deploy edge fns with explicit `--project-ref trbvxuoliwrfowibatkm`, never `--linked`.

0. **Verify Push-1 already on prod** (June pitch_log base, GM July) — don't re-run.
1. **Phase A — Schema** (idempotent DDL): descriptive_war cols, defense/baserunning tables, composite-war ÷13.1 *definition
   only*, pitch_log park_code/is_conf/sequence, Conference Stats +cols, Park Factors seasonal, team_season_stats +
   **its war-columns migration** + refresh fn, venue-corrections (created by the producer in step 3b), RLS.
2. **★ PITCH-LOG INTEGRITY (foundational — before any derivation):** GATE 0 dedup prod pitch_log (`DELETE … WHERE runs
   IS NULL`; detect via runs-null junk, NOT a uniq_pitch_id count — that misleads); GATE 1 movement (ivb/hb) complete.
3. **Phase B — Config** ★order: `step8_model_config_2026` (201-key, has 21.22 — do NOT run `wrc_c1_model_config`) →
   `ncaa_averages.wrc=0.3782` → `seed_nil_tiers_model_config` (BEFORE re-price) → `store_transfer_weights_and_sds` →
   `compute-projection-calibration --apply` (stage 5.5, BEFORE pitcher precomputes).
   3b. **Pitch-log derivations** (after GATES 0+1): `compute_venue_corrections.ts --prod --apply` → Stuff+ classify +
   score → conf-stats (bucketA PASTE + env+/OPR/HTP).
4. **Phase C — Producers/backfills** (regenerate): pitcher_full_name, park_code, is_conference_game, pull_air/in_zone,
   trackman_pitches, Masters-from-pitchlog + **Stuff+ rollup before compute_scores**, power ratings, ncaa_averages,
   NJCAA re-tag, descriptive WAR cols.
5. **Phase D — dWAR/bsrWAR** ★: `load-drs-wsb-staging.ts --prod` → `populate_descriptive_war.mjs --prod --commit` →
   `populate_descriptive_war_reg.mjs --prod --commit`.
6. **Phase E — Precomputes** ★order: `run-twp-recompute.ts --apply` (TWP detector, FIRST) → returner pitchers (needs the
   3c4e8c8 overlay) → returner hitters → `_run_step2_all.sh --prod` (all 18 teams via the live customer_teams list).
7. **Phase F — Re-bakes** ★order: FIRE `refresh_composite_war()` (÷13.1, only now) → snapshot total_hitter_war catch-up
   → TWP markets → market resyncs → neutral + heal snapshots → `refresh_team_season_stats(2026)` LAST (reads prod's own
   team_war_snapshots) → reseed 2026 snapshots + display swap.
🛑 **SUPERSEDED 2026-08-31 — G46 was REMOVED from the push (Track B branch). DO NOT DEPLOY.** 8. **Phase G — Edge fn deploy** (Trevor): `supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm`.
9. **Phase H — Gated drops** (last): park_factors lowercase (strip google-sheets-sync calls first), corrupt pitch_log
   team-id cols, player_prediction_internals, one-off RPCs/temps. **NEVER drop team_war_snapshots.**

## VERIFICATION GATES (at push time — from PROD_PUSH_STEPS)
- model_config 201 keys; `owar_replacement_runs_per_600=21.22`, `obp_std_pr=31.89504`, `whip_pr_sd=37.19844`, nil_tier_sec=4.0.
- pitch_log: `count(*) FILTER (WHERE runs IS NULL)=0`; total ≈ 2,576,230; `park_code IS NULL`=0.
- dWAR/bsrWAR: player_season_defense/baserunning populated; Master d_war/bsr_war centered; total = desc_owar+d_war+bsr_war.
- Across-the-range calibration: top-12 pitchers genuine Stuff+ 99–113, 0 weak-stuff arms; **0 negative projected rates except HR9-floored**.
- Market re-price roster totals: SEC ~$4.4M / ACC ~$1.7M / Big12 ~$1M / BigTen ~$900k; Independent tier = 1.0.
- All 18 customer teams precomputed; a known TWP shows both sides + combined NIL; team_season_stats 308 rows.
- Edge fn: staging→prod; add a test team, confirm its projections match the batch.

## SAFETY / KNOWN LANDMINES (full list in PROD_PUSH_STEPS)
- **Non-idempotent (guard/one-time):** bare CREATE POLICY (June), `RENAME total_war` (20260806), `TRUNCATE gm_allocation`,
  `team_season_stats_war_rollup` INSERT (dupes — use the refresh fn), player_slot_values dedup DELETE.
- **model_config:** run only step8 (21.22); do NOT run `wrc_c1_model_config` (stale 26.2).
- **Order:** ts-war-columns migration BEFORE first `refresh_team_season_stats(2026)`; seed_nil_tiers BEFORE re-price;
  `refresh_composite_war()` fire only after o_war re-precompute; TWP detector BEFORE precomputes; calibration BEFORE pitcher precomputes.
- **Regenerate-not-copy on prod:** venue corrections, TWP flags, conf-stats, dWAR/bsrWAR, descriptive WAR, team_season_stats,
  calibration, trackman_pitches, market re-price (per-env ids/venues).
- **Do NOT** run `populate-conf-stats` on prod (overwrites JUCO overlay).

## DEFERRED (NOT blockers)
JUCO TWP market split (fix before JUCO ships) · hitters two-sided SD (symmetric follow-on) · Stuff+ display min-pitch
gate · 19 sub-5-IP negative-HR9 qualification · is_position_of_need · Track B unification · replacement-level
auto-derivation (fold 21.22's derivation into a calibration stage) · nil_valuations RLS · pitch_log.vaa.

## POST-PUSH
- Append every prod change to `PROD_MIGRATIONS_TODO.md` as it runs.
- **WhatsNewModal note is DONE** — the `2026-08-26` release (4 features) is already in-branch, `STORAGE_KEY` v9, fires on
  the frontend deploy for all users. No em-dashes in the new release. See `docs/AGENT_LEARNINGS_ui_and_whats_new_2026_08_26.md`.
- Run the STAGING_UX_WALKTHROUGH (or `docs/STAGING_CLICKTHROUGH_2026_08_26.md`) against prod as a smoke test.

## FRONTEND / DISPLAY SHIPPING WITH THIS MERGE (no separate prod DB step, except run-value data)
What's New v9 release · hitter Season-Stats **VALUE** run-value panel (needs step 13b + `populate_hitter_run_values`) ·
"oWAR"→"WAR" relabel (RosterTab/TargetBoardTab) · PlayerHub historical id resolution · softened market-valuation copy.
Full record: `docs/AGENT_LEARNINGS_ui_and_whats_new_2026_08_26.md`. Verify: `docs/STAGING_CLICKTHROUGH_2026_08_26.md`.
