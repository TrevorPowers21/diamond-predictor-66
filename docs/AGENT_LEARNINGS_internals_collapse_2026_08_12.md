# Agent learnings — Internals collapse + power-rating refits (2026-08-12)

Captured for the **RSTR IQ dev agent**. Session on `feature/war-recalibration`: collapsed
`player_prediction_internals` (a per-prediction COPY of power ratings) so every reader reads the Masters
directly, plus the Step 3-5 composite refits. Record shape: **rule — why — what it protects against.**
Companion state: `docs/INTERNALS_COLLAPSE_HANDOFF.md`, `docs/WAR_COLLAPSE_NEXT_STEPS.md`, `docs/WAR_HANDOFF.md`.
Commits: `70738cb` (Steps 1-5) · `95f0760` (audit+plan) · `584dd4c` (transfer-batch repoint) · `3a0f428`
(Sweep A) · `54cdb10`+`cecedee` (Sweep B).

## The collapse — what & why (→ projections-and-scouting)

- **`player_prediction_internals` was a redundant per-run CACHE, not a source.** `createPredictionsFromMaster`
  (backfill step 1) rebuilt it from the Master on EVERY run — a write-the-Master-value-into-a-table-then-read-it-
  back round trip inside one script. It was "stale" only because the backfill had been dormant since June. The fix:
  every reader reads the Master's stored `ba/obp/iso_power_rating` (hitter) / `*_pr_plus` (pitcher) directly by
  `source_player_id @ CURRENT_SEASON`. *Protects against:* a synchronization problem you can never win — a single
  source cannot drift from itself; a copy always can (June-8 copy vs refit Master = the whole bug).
- **Column mapping (verbatim, no transform):** internals `avg→ba_power_rating`, `obp→obp_power_rating`,
  `slg→iso_power_rating` (hitter); `era/fip/whip/k9/bb9/hr9_power_rating → *_pr_plus` (pitcher). Confirmed at the
  writer. So reading the Master == reading a fresh copy, bit-for-bit.
- **Preserve the scrub on every repoint.** `readSpecificPlus`/`scrubPR` = `n>0 ? n : null` — a stored 0/negative PR
  is degenerate (100=avg), treat as missing → actuals-only. The edge fn's old `internals?.x ?? null` did NOT scrub;
  adding it made transfers match returners. *Protects against:* feeding a literal 0 PR into a projection.

## The airtight A/B — how to prove a read-source swap is neutral (→ review-and-parity) — THE transferable method

- **A read-source swap is output-neutral ⟺ the two sources hold equal values AND the join resolves for 100% of
  rows.** Proof = by-construction (transform-free copy + identical downstream fn) + empirical plumbing (the new
  `source_player_id` join finds a Master row for every player — 0 orphans in the returner sample).
- **Run the SAME code twice to establish determinism BEFORE trusting an A/B diff.** NEW vs NEW2 = 0 proved the new
  path is deterministic; only then does an OLD-vs-NEW diff mean anything.
- **A first-run diff can be a COLD-CACHE artifact, not a bug — prove it with a warm re-run.** OLD-run-1 vs NEW
  showed 49 diffs; the trace showed 47 had identical current PR triples (so not the read swap). Running OLD AGAIN on
  a warm cache (OLD2) vs NEW = **0 diffs across 8,236 rows** — proving the 49 were the internals cache being cold on
  a run that CREATED 7,951 rows, i.e. the exact staleness the collapse removes. *Protects against:* shipping a
  "regression" that is really the old path's cold-cache flaw, or abandoning a correct change because run-1 differed.
- **Trace a surprising diff to its INPUT before theorizing.** The 2 genuine PR-triple diffs were the known Kozeal
  orphan (no Master row → actuals-only) + one stale-null-internals row (Master had a value → NEW more correct). Both
  expected. *Protects against:* rationalizing a diff instead of locating it.
- **Stop on surprise; don't rationalize.** Predicted 0, got 49 → halted, traced, ran the control. (Reinforces
  [[feedback_predictions_on_record_at_right_grain]].)

## Auditing reachability — grep finds sites, it does NOT find liveness (→ review-and-parity) — a correction the agent must carry

- **A grep-based "complete surface" audit is necessary but OVER-CALLS liveness.** A second, broader audit found the
  full site list (valuable — caught `precompute-transfer-projections.ts`, a live transfer batch the first audit
  missed) but flagged DETACHED interactive paths as "LIVE" because it saw the call site without verifying invocation.
  The narrower first audit was MORE accurate on reachability. *Protects against:* trusting a thorough-looking audit's
  verdicts; use it for the site LIST, re-verify each LIVE/DEAD by tracing to rendered JSX / actual invocation.
- **"Defined" ≠ "invoked." Prove liveness by tracing to a real trigger.** `recalculatePredictionById`'s wrapper
  handlers (updateClassTransition/updateDevAgg/savePredEdit/updatePlayerWithRecalc) appear ONLY at their definitions
  — never `.mutate()`d, never in JSX (grep each handler: 1 ref = the def). CompareTab lives in
  `<TabsContent value="compare-hidden" className="hidden">` with no trigger → never mounts. `simulateTransferProjection`
  is `const sim = null; void simulateTransferProjection`. All DEAD despite having call sites. The domain expert
  (Trevor) corroborated ("we restructured class-transition/dev-agg to session-only"). *Protects against:* mistaking
  a call site for a live path.
- **A shared helper used by a retire-staged path is NOT deletable yet.** `bulkRecalculatePredictionsLocal` (LIVE,
  retire-staged) also calls `recalcReturner`/`recalcTransfer`/`recalcPitcher` (mapped the internal call graph before
  deleting). So only `recalculatePredictionById` + its private `fetchPitcherContext` were deletable; the shared
  helpers die with bulkRecalc in Track B. *Protects against:* deleting a "dead" helper that a live sibling still needs.

## "Fixed but never cleared" — old code survives refactors (→ process) — Trevor's flagged theme

- **When a component/function was refactored, the OLD version often stays in the tree unreferenced.** `CompareTab.tsx`
  (hidden, live-computing from internals) was superseded by the routed, stored-first `PlayerComparison.tsx`
  (`/dashboard/compare`, reads `player_predictions` directly) — but never deleted. The domain expert's instinct
  ("there might be an update further down that shows the correct version, this is old code") was RIGHT; searching the
  full surface (`find -iname '*compare*'`, App.tsx routes) found the real one. *Protects against:* repointing/polishing
  dead code, and missing that the "regression" is just an un-deleted old copy. → logged: an app-wide dead-code audit
  and an unused-DATA (orphan tables/columns) audit as their own efforts.
- **Remove the table REFERENCE minimally when full dead-fn deletion cascades.** For dead readers whose result feeds
  a void'd fn or is returned from a hook (TB-sim → return → TeamBuilder dep array), deleting the whole chain cascades
  across files. Removing just the DB read (→ empty constant) clears the DROP-blocking reference safely; the dead
  shell is swept later. *Protects against:* a risky multi-file cascade in one pass when the goal is only "no table ref."

## The 981 null-PR investigation — no store bug (→ projections-and-scouting)

- **Master rows with raw inputs but null PR are legitimate, not a store gap — check division + input completeness.**
  981 @2026: **829 JUCO** (NJCAA_D1, excluded from D1 PRs by design) + **152 D1** almost all missing tracking
  sub-metrics (line_drive/pop_up/barrel/ev90). The store correctly nulls a PR when the inputs to compute it don't
  exist. *Protects against:* "fixing" a store that isn't broken; and confirms **power ratings are D1-only** (Trevor's
  invariant) — JUCO PRs are handled separately (`projectJucoReturner`, never the D1 equation).
- **A live-compute fallback that uses the same inputs the store used can NEVER rescue a null.** The edge fn's
  `seedPower` (computeHitterPowerRatings from raw metrics) can't produce a PR the store didn't already store (same
  function, same missing inputs) — AND its only caller never passed it, so it was already dead. Deleted. *Protects
  against:* keeping a live-compute "safety net" that is provably redundant. → spawned [[project_division_table_separation]]
  (move JUCO/D2/D3/NAIA out of the D1 Master so PR-creation is D1-only structurally).

## Execution discipline (→ db-safety-and-process, reinforces existing)

- **Guard a large line-range deletion with a boundary assertion.** Deleted predictionEngine 874-1234 only after
  asserting line 874 = `fetchPitcherContext` start AND line 1236 = `bulkRecalc` start. *Protects against:* an
  off-by-N sed nuking the wrong 360 lines.
- **Gate every code deletion on tsc error count vs BASELINE, not zero.** The app has ~198 pre-existing errors; stash
  the edits, count errors in the touched files at HEAD, compare. Every sweep: with == baseline (0 new). *Protects
  against:* "can't gate on zero" paralysis, and shipping a deletion that broke a reference.
- **Verify config sync in the DB with the REAL key names.** model_config@2026 spot-check initially showed 2
  "missing" — they were wrong key-name guesses (`obp_bb_pct_weight` is really `obp_walk_pct_weight=0.4`;
  `p_fip_hr9…` rides code defaults). Pull the actual keys before calling a sync gap. *Protects against:* a false
  regression scare (and false peace of mind).
- **All DB writes were staging (`.env.local`) precompute scripts I ran; no prod. Reads = my own node scripts w/
  service role.** Staging-first held throughout.

## Status at write time
Collapse **code-complete**: all live readers on the Master; all dead readers removed; write stripped. Only
`bulkRecalculatePredictionsLocal` + `import-internal-ratings` still reference the table (Track B, before DROP).
Steps 1-5 verified (247 tests + model_config@2026). Next: Step-6 pitcher-returner re-precompute; Track B retire+DROP.

---

# STEP 6 — Returner re-precompute + the market investigation (2026-08-13)

Ran the returner re-precompute (staging) for pitchers, then verified hitters got the same treatment. Both are now
re-precomputed, deterministic, and consistent. Several durable lessons + a list of what-to-change.

## Mover-tracking is the verification method for any re-precompute (→ review-and-parity) — the transferable technique
- **Snapshot BEFORE, run, snapshot AFTER, rank the largest deltas with names.** This single technique surfaced
  every real finding this session: the pitcher small-sample HR9 tail, the JUCO FIP-wrong-at-source, and the hitter
  market staleness. A pass/fail count hides them; the *ranked movers* expose them. *Protects against:* shipping a
  re-precompute whose aggregate "looks fine" while a tail is degenerate.
- **A clean pre-change baseline only exists if the precompute was DORMANT before the run.** Pitchers had a genuine
  pre-refit baseline (`P_BEFORE`) because the pitcher precompute hadn't run since June — so its movers showed the
  full refit repricing. Hitters did NOT: the hitter precompute ran 5× during the collapse A/B, and every run's
  step-1 `createPredictionsFromMaster` refreshes internals/`from_*` to the current (refit) Master — so all hitter
  snapshots are post-refit and can't show the refit delta. *Protects against:* mistaking residual noise for the
  change you're trying to measure. Capture baselines BEFORE the first run of a changed pipeline.

## Determinism is proven by CONVERGENCE, not by one diff (→ review-and-parity) — the closing move
- **Two consecutive fresh re-runs diffing to 0 is the definitive proof a pipeline is deterministic.** When the
  hitter market looked non-deterministic (170 rows changed vs the prior state), the answer wasn't more theorizing —
  it was: re-run once more, diff. `H_FINAL2 vs H_FINAL = 0 across every field including market_value` → deterministic,
  case closed. *Protects against:* endless speculation about a suspected non-determinism; the convergence run settles it.

## OWN a wrong mechanism call — trace to the INPUT before broadcasting (→ review-and-parity) — I got this wrong
- **I diagnosed "market swings thousands run-to-run from a conference-resolution bug." That was WRONG.** The real
  cause: the 170 market-changed players had **identical oWar** (0 diffs) and were all-null / below-replacement; their
  correct market is $0. The prior state held a **stale POSITIVE** value; the fresh re-run corrected it to $0. It was
  a one-time stale-data cleanup, not randomness, and `computeHitterMarketValue` is a pure `oWar×PVF×PTM×nil` function
  (deterministic given inputs). *Lesson:* before naming a mechanism (esp. an alarming one), verify the INPUT is what
  you think — here oWar was identical, which immediately rules out "the projection changed" and points at stale
  writes. Empirically check, then speak. (Reinforces [[feedback_predictions_on_record_at_right_grain]] and the parity
  doc's "internal, data-checkable claims are the trustworthy ones.")

## The `from_avg NOT NULL` loop filter causes downstream staleness (→ projections-and-scouting) — the residual bug
- **A player excluded from a run's recalc loop keeps STALE downstream fields until a full re-run reaches them.** The
  returner backfill loads `... .not("from_avg","is",null)`. A player whose `from_avg` is null at run time is skipped
  entirely, so an old `market_value` (or any written field) lingers. When `createPredictionsFromMaster` later
  populates `from_avg`, the next run's loop recomputes and corrects it. The D1 write ALWAYS sets `market_value`
  (`meta.is_twp ? null : marketValue`, null for null-oWar) — so being *in* the loop is correct; the gap is only for
  players transitioning in/out of the projectable set. *Protects against:* assuming a stored field is current when
  its owner may have been filtered out of recent runs. **Hardening (Step 7):** clear market on exit, or always full-re-run.

## Hitter and pitcher returner precomputes are SEPARATE scripts — keep them in lockstep (→ process) — the "lost sight of hitters" lesson
- **`precompute-returner-hitters` and `precompute-returner-pitchers` are independent; running one does NOT refresh
  the other** (the pitcher script does not even call `createPredictionsFromMaster`). Focusing on pitchers left the
  hitter side carrying stale market values. *Rule:* a "re-precompute the returners" task means BOTH scripts as a set
  (and transfers), or the un-run side silently drifts. *Protects against:* declaring "Step 6 done" after one side.

## Step-6 run results (staging, for the record)
- **Pitcher returners:** 8,073 rows, 0 lost; 6,263 WAR changed (3,123 up / 1,638 down) — the refit `*_pr_plus` +
  D1-FIP + collapse repricing. Blocked: 196 = sub-1-IP (PM load `.gte("IP",1)`) or no PM row — correctly excluded
  (label "no_pm_row" is imprecise; many DO have a <1-IP row). Absurd projected HR9 (>3) is a **pre-existing** ~1.7%
  small-sample tail (103→109, market $0, drops out) — NOT a refit regression. JUCO rates are actuals-passthrough
  (confirmed unchanged); JUCO pRV+/WAR move only via the D1-FIP formula.
- **Hitter returners:** re-run fresh; rates+WAR deterministic; the 170-row market drift was one-time stale cleanup
  (above), converged to 0 on re-run. D1 FIP sanity-checked fine (good arms show FIP<ERA); the FIP problem is
  JUCO-only (below).

## WHAT WE NEED TO CHANGE (the running list from this session)
1. **Pitcher small-sample pullback** — 109 pitchers project absurd HR9 (>3, up to ~9); tighten the sub-~20-IP band so
   the projected-HR9 z-shift can't blow up. Pre-existing; the mover-tracking exposed it.
2. **JUCO FIP is wrong at the source** — recompute FIP from components (HR/K/BB/IP) instead of the miscalculated
   stored FIP; JUCO pRV+/WAR follow. JUCO-only, fold into [[project_division_table_separation]]. Fix D1 first.
3. **`from_avg` market-staleness hardening** — clear market on exit or always full-re-run (Step 7).
4. **Recompute `ncaa_averages` means + SDs in the upload/update run** — they're the denominators of every rating; a
   static fixture rots (null `pitcher_in_zone_pct`). Order it right before the store. Near-term + Track B.
5. **Market → total WAR (Step 7)** — the formula shape stays `WAR×PVF×PTM×25,000`; swap the WAR input oWAR→total WAR.
   Design note: Teams Table is intentionally per-Season (program id + per-season team id + per-season `conference_id`
   for realignment, e.g. Delaware CAA 2025 → CUSA 2026) — respect the Season model in any market/conference rework.
