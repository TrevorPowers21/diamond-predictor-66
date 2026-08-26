# FUTURE WORK / BACKLOG — captured 2026-08-26

Everything discussed and intentionally held off during the WAR-recalibration cycle, plus the new features Trevor
wants next. One place so nothing is lost. Not prioritized yet — grouped by theme. Cross-refs to the deeper docs/memory.

---

## ★ NEW FEATURES (Trevor wants to build these next)

### 1. Front Office Agent Page
A coach-facing **AI agent inside the Front Office (GM)** — a page where a coach can ask natural-language questions and
get help with roster/budget/contract decisions (e.g. "who can I afford at shortstop under $X", "what happens to my
budget if I sign this transfer", "which contracts come up next year"). Sits on top of the existing GM data
(roster, funding, contracts, allocations, analytics). SPEC TBD with Trevor. Distinct from the internal dev agent
([[project_rstr_dev_agent]]) — this is a product feature for coaches. Route would live under `/gm`.

### 2. Team Comparison
Compare two (or more) **teams / programs** side by side — total WAR, lineup/rotation/bullpen splits, positional
strengths and gaps, budget and pay, benchmark vs champions. Extends the existing player-level `PlayerComparison`
(`/dashboard/compare`) to the team level. Data already exists in `team_season_stats` / `team_war_snapshots`
(the same source the GM/TB benchmark compare uses). SPEC TBD.

---

## ★ JUCO AUDIT (dedicated pass before JUCO ships)
JUCO players are flagged and scored on D1 baselines, but the market + a few displays were intentionally deferred:
- **JUCO TWP market split** — 163 JUCO TWP rows are flagged `is_twp` but their market split (twp_hitter / twp_pitcher)
  was NOT applied (only D1 TWP markets were done). Fix before JUCO market ships. [[project_twp_flag_systemic_gap]]
- **JUCO market calibration** — confirm JUCO market tier (JUCO PTM 0.35) + how JUCO values translate to a D1 program.
- **Verify JUCO D1-scaling end to end** — spot-checked 2026-08-26 (overall_pr_plus D1 ~100.6 / JUCO ~96.8; display
  p_rv_plus D1 96.6 / JUCO 95.7 — correctly D1-scaled). Do the full sweep across every JUCO display + metric.
- **TrackMan selection bias on JUCO** — JUCO TrackMan data skews to the upper crust; account for it. [[feedback_trackman_selection_bias_juco]]
- **Division table separation** — consider moving JUCO/D2/D3/NAIA out of the D1 Master. [[project_division_table_separation]]

---

## ★ TRACK B — unified on-upload edge function
Today the pitch-log → derivations → projections pipeline is a set of **hand-run scripts** (stages 2–5 + 3b). Track B
folds them into ONE edge function that fires on pitch-log ingest and runs stages 2→3→3b→4→5→6 in order, re-deriving
every downstream aggregate in the same pass. [[project_unified_projection_edge_function]] · docs/PIPELINE_pitch_log_to_projections.md
- **Must absorb stage 3b** (`aggregate_pitch_log_dimensions.ts`, the season-stats dimension rollup) — currently offline.
- **Must call `populate_hitter_run_values(season)`** after the hitter aggregation (the run-value z-scores) —
  flagged in the PIPELINE doc + `AGENT_LEARNINGS_hitter_run_values_2026_08_26.md`.
- Also unbuilt: `conf_only` (is_conference_game) dimension, home/away, date-range splits.

---

## DATA / MODELING FOLLOW-ONS (deferred this cycle)
- **dWAR opportunity-scaling** — dWAR is a fixed per-player value; it should scale up/down with defensive
  opportunity/innings (depth role) the way oWAR scales with PA. A depth-role change moves oWAR but not dWAR today.
  NEEDED. [[project_dwar_opportunity_scaling]]
- **Hitters two-sided (directional) SD** — pitchers got the two-sided SD projection; hitters are the symmetric follow-on.
- **Market calibration research phase** — PVM/PTM tuned via coach feedback post-ship; the market model stays "calibrating."
  [[project_market_calibration_research_phase]] · [[project_market_value_ptm_unification]] (one model_config source + stored-only refactor).
- **Player Score / NIL allocation v1** — budget→value rank-decay curve, decoupled from market; settled but NOT wired.
  [[project_player_score_nil_allocation]]
- **is_position_of_need** — position-of-need premium in the market/allocation.
- **Replacement-level auto-derivation** — fold 21.22's derivation into a calibration stage instead of a seeded constant.
- **Small-sample pullback / budget-share floor** — [[project_small_sample_pullback]] [[project_budget_share_roster_floor]].
- **Pitcher role systemic fix** — [[project_pitcher_role_systemic_fix]].

---

## DISPLAY / INFRA (deferred this cycle)
- **Stuff+ display min-pitch gate** — no leaderboard; gate low-pitch arms out of Stuff+ displays.
- **19 residual sub-5-IP negative HR9** — qualification gap; investigate-only.
- **PitcherProfile arsenal type mismatch** — pre-existing (`.velocity/.ivb/.hb` on a type without them); page loads,
  but tighten the type + confirm columns populate.
- **TeamBuilder IDs-over-names refactor** — returners / team_builds.team keyed by NAME → id. [[project_teambuilder_ids_over_names_refactor]]
- **TB oWAR snapshot regression guard** — [[project_teambuilder_owar_snapshot_regression]].
- **nil_valuations RLS** · **pitch_log.vaa / classification_version** · **WIRE C frontend repoint**.
- **Pitch Log finalize + archive** — archive the 2.9GB raw pitch_log to cold storage. [[project_pitch_log_finalize_archive]].

---

*Add to this as new held-off items come up. When one is picked up, move it into `PROD_MIGRATIONS_TODO.md` / a working doc.*
