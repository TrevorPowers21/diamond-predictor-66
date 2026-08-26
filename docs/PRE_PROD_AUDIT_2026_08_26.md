# PRE-PROD AUDIT — feature/war-recalibration (2026-08-26)

Comprehensive readiness audit before the prod push. Three parallel audits (prod ledger/runbook, handoffs/agent-learnings,
git/code-drift) + a live staging DB integrity check. This doc is the reconciliation layer — where the OLDER docs carry
stale numbers, **the values here are authoritative** (verified against staging DB + the 2026-08-24 config regen).

## ★ VERDICT
- **This session's work (TWP flags + HR9-only floor + edge-fn mirror + dynamic runner) is VERIFIED CLEAN and prod-ready.**
- **The full branch push is NOT yet clear** — the audit surfaced **4 genuine gaps** (below), all pre-dating this session
  (defense/baserunning, venue corrections, a conf-stats gate, a returner-path decision). Close those before pushing.
- Nothing this session did was broken; nothing in this session's scope was missed.

## ✅ VERIFIED CLEAN (staging)
| Check | Result |
|---|---|
| `is_twp` flags | 253 (D1 90 / JUCO 163) — matches detector run |
| Negative projected pitching rates | **0 across 105,353 rows** (HR9-only floor holds; others unfloored) |
| `total_hitter_war` = o_war+d_war+bsr_war | 6,811 returner rows, **0 mismatch** |
| D1-TWP transfer split markets | 1,617 split / **0 shared-only** (NC re-run closed the 88) |
| `model_config` two-sided SD | all 6 `_plus_ncaa_sd_bad` keys present (era/fip/whip/k9/bb9/hr9) |
| Customer teams | 18/18 active; NC (18th) 10,208 transfer rows fresh |
| Edge-fn ↔ src/lib | **full lockstep** — directional SD + HR9-only floor equivalent across all 3 files; all 6 sd_bad keys wired + overlaid |
| Tests | **265/265 pass** |
| Temp scratch files | cleaned (`_diag2_tmp.ts`, `_rerun_floor.sh` removed) |
| Edge-fn deploy | staging v26→27; **prod main v12 UNCHANGED** |

## ⚠ BLOCKERS — close before the push (all pre-date this session; need Trevor)
1. **`player_season_defense` / baserunning has NO committed prod path.** Migration `20260805_..._defense_baserunning.sql`
   is idempotent DDL, but the only loader is `scripts/load-drs-wsb-staging.ts` (staging-named). **Composite d/bsr-WAR
   silently breaks on prod without a prod producer.** *Both* the ledger and handoff audits flagged this independently —
   it's the #1 gap. → Need the prod loader (or confirm how DRS/wSB data lands on prod).
2. **`venue_correction_persist.sql` is not in the repo.** Ledger says it lives in `scratchpad/`; filesystem search found
   it nowhere. It creates `venue_movement_corrections` + the `pitch_log_corrected` VIEW that **Stuff+ classification AND
   scoring both read**. Prod note says "regenerate from prod pitch_log" but there's no committed file/producer. → Recover
   or re-commit the producer before Stuff+ runs on prod.
3. **Conference Stats `conf_stats_bucketA_assembly.sql` idempotent re-run never validated on staging** ("couldn't run
   2026-08-21 — no staging conn"). It's the ★ critical conf-stats blocker; the gate (re-run vs backup, target diff
   0.0000) is still open. → Run the staging idempotent check before trusting it on prod.
4. **Returner prod path is ambiguous.** The runbook's 13-step `recalculate-prediction` edge-fn returner rebuild (steps
   5–9) is marked "NOT YET BUILT," but the newer architecture runs returners via batch scripts
   (`precompute-returner-*`). These appear to supersede the edge-fn plan but it's never stated. → Trevor confirms:
   batch scripts are canonical for the returner prod path (edge fn is transfer/new-team only).

## ★ STALE-DOC RECONCILIATION (older docs carry outdated values — use THESE)
| Item | Stale (runbook/older) | ✅ AUTHORITATIVE (staging-verified) |
|---|---|---|
| `model_config` seed key count | 125 | **201 keys** (regenerated 2026-08-24; `step8_model_config_2026.sql`) |
| `obp_std_pr` (`r/t_obp_std_pr`) | 32.41 | **31.89504** |
| `whip_pr_sd` | 37.13 | **37.19844** |
| Step 7b hitter display swap | "NOT STARTED" | **DONE** — `pickHitterWar`/`pickPitcherWar` live in `twpMarketValue.ts`, wired everywhere |
| 88 D1-TWP one-sided rows | "deferred with JUCO" | **FIXED** — all were North Carolina (missed team); NC re-run closed them |
| `team_war_snapshots` DROP | "retire/DROP" language | **CANCELLED** — federate-by-era, keep for 2025 champions. NEVER drop. |
| `park_code`/`game_string` | "NOT DONE" | **DONE on staging** |
| `refresh_composite_war()` | ÷10 (v1) | **÷13.1** (rescale); now redundant for `player_predictions.total_hitter_war` (producers write it directly) — keep only for descriptive Master cols |

## ORDERED PROD SEQUENCE (phases — full 49-step detail in the runbook + this session's ledger entries)
Every data step **regenerates on prod** (prod resolves its own UUIDs); DDL is idempotent. Ordering that MATTERS is starred.
- **Phase 0** — verify Push-1 layer already on prod (don't re-run).
- **Phase A — Schema** (all `ADD COLUMN IF NOT EXISTS`): Master desc_* / desc_*_reg, defense/baserunning ⚠(blocker 1),
  attribution, composite-war ÷13.1 *definition only*, pitch_log seq/park_code/is_conf_game, Conference Stats +cols,
  Park Factors seasonal, team_season_stats create + refresh fn, venue corrections ⚠(blocker 2), player_predictions RLS.
- **Phase B — Config** ★ (everything divides by these): `step8_model_config_2026.sql` **(201-key)** → `ncaa_averages.wrc=0.3782`
  → `seed_nil_tiers_model_config.sql` **(BEFORE re-price)** → `store_transfer_weights_and_sds` → `compute-projection-calibration --apply` **(BEFORE pitcher precomputes)**.
- **Phase C — Producers/backfills** (regenerate): pitcher_full_name fix, park_code/game_string, is_conference_game,
  pull_air/in_zone_pct, trackman_pitches, Masters-from-pitchlog + **Stuff+ rollup before compute_scores**, power-rating
  store, ncaa_averages, the **6 conf-stats producers** ⚠(blocker 3, PASTE never `--linked`), NJCAA-D1 re-tag, descriptive WAR.
- **Phase D — TWP detector** ★: `run-twp-recompute.ts --apply` **(regenerate from prod Masters; BEFORE precomputes)**.
- **Phase E — Precomputes**: createPredictionsFromMaster → returner pitchers **(needs the 3c4e8c8 overlay fix)** → returner
  hitters → `_run_step2_all.sh --prod` (dynamic list, all 18 teams incl. NC) ★(raise statement_timeout for propagate).
- **Phase F — Re-bakes**: fire `refresh_composite_war()` → snapshot total_hitter_war catch-up → TWP markets
  (rebuild-twp-target-rows / rebake-twp-markets / fix-returner-twp-hitter-market) → market resyncs → neutral + heal
  snapshots (ordered `.range()` versions) → `refresh_team_season_stats(2026)` **LAST** (reads prod's own team_war_snapshots)
  → reseed 2026 team_war_snapshots + display swap.
- **Phase G — Edge-fn deploy** (Trevor, explicit `--project-ref trbvxuoliwrfowibatkm`, NEVER `--linked`):
  `process-precompute-jobs` (two-sided SD + HR9 floor + TWP-aware + PTM + faced-competition). `recalculate-prediction` ⚠(blocker 4).
- **Phase H — Gated drops** (last, each behind its gate): park_factors lowercase (strip google-sheets-sync calls first),
  pitch_log corrupt team-id cols (recreate view first), player_prediction_internals (after bulkRecalc retired), one-off RPCs/temps.

## PROD LANDMINES (do not trip)
- **REGENERATE, never copy staging** (per-env ids): venue corrections, park_code, pitcher_full_name, descriptive WAR,
  team_season_stats, all conf-stats, **TWP flags**, trackman_pitches, calibration K/SDs, transfer env+, market re-price.
- **`team_war_snapshots` on prod holds 2025 champions** (LSU + 39 conf) — cannot recompute; read it, never drop it.
- **`--linked` = PROD.** Paste conf-stats SQL; deploy edge fns with explicit prod ref (staging is a persistent branch
  under the same project, so `--linked` reaches prod).
- **DO NOT run `populate-conf-stats` on prod** — overwrites the hand-calibrated JUCO overlay.
- Use the `.order()`-fixed batch/backfill scripts (unordered `.range()` silently skips rows).
- Post-push: WhatsNewModal note (no em dashes) when WAR moves; append promoted items back to PROD_MIGRATIONS_TODO.

## DEFERRED (NOT blockers — don't mistake for missing work)
JUCO TWP market split (163 rows, fix before JUCO ships) · all JUCO · Stuff+ display min-pitch gate (no leaderboard) ·
19 residual sub-5-IP negative HR9 (qualification gap, investigate-only) · hitters two-sided SD (symmetric follow-on) ·
is_position_of_need · Track B unification · WIRE C frontend repoint · nil_valuations RLS · pitch_log.vaa/classification_version.

## STAGING DISPLAY CHECKLIST — see the separate "what to click" section in the chat / handoff.
