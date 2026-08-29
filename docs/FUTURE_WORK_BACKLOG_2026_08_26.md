# FUTURE WORK / BACKLOG — captured 2026-08-26

Everything discussed and intentionally held off during the WAR-recalibration cycle, plus the new features Trevor
wants next. One place so nothing is lost. Grouped by theme. Cross-refs to the deeper docs/memory.

---

## ★★ TOP PRIORITY (Trevor flagged 2026-08-26)

### Hitters two-sided (directional) SD  — VERY IMPORTANT
Trevor **wanted this in this cycle** and thought it was in — it is NOT. Pitchers got the two-sided SD (each of the 6
metrics has a `_sd_bad` directional key: era/fip/whip/k9/bb9/hr9); **hitters still use a SYMMETRIC SD** (ba/obp/iso
have only `_std` / `_std_pr`, no `_std_bad`). This is a **build task**, not a config flip: compute the directional
(bad-side) SDs for the hitter metrics (ba/obp/iso and/or wRC+ components) and wire them into the hitter projection the
same way the pitcher path does. **#1 follow-on** — build it right after (or, if Trevor wants, before) the prod push.

### Finalize the dev agent build  — VERY IMPORTANT
Finish and ship the RSTR IQ dev agent — the CLI/dev agent that cross-checks the code against Supabase. Trevor wanted
this and it was never completed. Scope + current state to confirm. [[project_rstr_dev_agent]]

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
- **Hitters two-sided (directional) SD** — ★★ moved to TOP PRIORITY above (Trevor wanted it this cycle).
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

---
## ★★★ TRACK B — STUFF+ STAGE, LOCKED SPEC (2026-08-29). Supersedes any earlier Stuff+ description here.
Track B = ONE function on pitch-log ingest (weekly/biweekly, local folder watch). Master-sheet uploads come LATER as a
CHECK + to override only what pitch_log cannot produce (e.g. AVG/SB). **pitch_log is the SOURCE OF TRUTH.**

**THE STUFF+ STAGE — exact order. Steps 1→5 MUST complete in ONE run; a label change invalidates every number below it.**
1. **CLASSIFY** → `pitch_log.pitch_type_reclassified` + `classification_version` + `needs_review`
   `src/savant/lib/stuffPlusClassifierV2.ts` (v2 — the SINGLE classifier), driven by `scripts/reclassify_prod.ts`.
2. **RE-DERIVE the pop baseline** → `pitcher_stuff_plus_ncaa` (per pitch_type × hand, **armHB**, D1-only).
   ⚠ MANDATORY, not optional: the §4.5 gyro fix moves **6-8% of ALL breaking-ball volume** Slider→Gyro Slider, so every
   mix-dependent artifact (baselines, D1/regional means + SDs, pitch-shape percentiles) is invalid until regenerated.
3. **SCORE per pitch** → `pitch_log.stuff_plus` — `scripts/compute_pitch_log_stuff_plus.ts`
   (normalizes hb→armHB itself; recenters each (pitch_type × hand) bucket to mean 100).
4. **AGGREGATE** → `pitch_log_pitcher_totals` / `pitch_log_hitter_totals` / `*_by_pitch_type`
   `scripts/aggregate_pitch_log_dimensions.ts` (must also call `populate_hitter_run_values(season)`).
5. **MARRY ONTO THE MASTERS** → `scripts/derive_masters_from_pitchlog.ts`
   (⚠ add `.order(PK)` to its `readAll` first — unordered `.range()` over ~2.5M rows silently drops/dupes).
Then: power ratings → conference baselines → projections → market/NIL.

**⛔ WHAT TRACK B MUST NEVER DO**
- NEVER route Stuff+ through the LEGACY lane: `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
  `legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus`. Nothing reads it for 2026 and it carries the latent
  raw-HB bug (e5dec2f removed `hbSign`; PSP-I stores RAW hb ⇒ left-handers scored BACKWARDS).
- NEVER call `legacy_breakingBallReclassification` (v1). It writes `rstr_pitch_class` on PSP-I, has never touched
  pitch_log, and is NOT the anchor classifier. Conflating the two cost a full day (2026-08-28/29).
- NEVER rewrite the stored `hb` column to armHB. `hb` is RAW by design (UI displays it; the CSV importer writes it raw).
  armHB is a COMPUTE convention — normalize in memory only.
- NEVER leave new labels with stale scores. Steps 1→5 are one transaction-of-work.

**LANE COVERAGE (measured):** `pitch_log` is **D1-only** — 5,303 pitchers. PSP-I covers 7,012; the 1,709 difference is
**1,627 NJCAA_D1 + 81 D1 + 1 D2**. → **JUCO has no pitch logs and stays CSV-derived** (scored vs D1 baselines). Track B's
pitch_log chain covers D1 only; do not let it silently drop JUCO. JUCO process is being restarted separately.

**CLASSIFIER STATE FEEDING TRACK B (2026-08-29):** v2 = **94.3% per-pitch** on the full 2,000,674-pitch anchor set
(arsenal-mix 94.3%, needs_review 8.1%), **→ projected ~95.3-95.4%** with the §4.5 gyro floor. Three shipped fixes:
offspeed `armHB >= 5` floor · fastball-family MERGE GUARD (>60% of 4S↔Sinker errors) · §4.5 gyro cluster floor `-3`
applied BEFORE `tiebreak()`. Two logged NEGATIVE results — `rr > -1.7` and the "arsenal rule" confound (loses ~1pp) —
do NOT rebuild either. Full numbers: `docs/STUFF_PLUS_EXACT_VALUES.md` §11. Lane map: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`.

**⚠ AGREEMENT WITH THE ANCHOR IS NOT ACCURACY.** The anchor is the previous classifier's output, not truth. The residual
~4.7% mixes v2-wrong / **v2-RIGHT-anchor-wrong** / coin-flips — partition with `scripts/v2_coherence_test.ts` before
treating it as error, and before deciding whether staging's labels should be updated rather than preserved.
