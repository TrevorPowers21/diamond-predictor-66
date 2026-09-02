# AGENT LEARNINGS — NIL Allocation + Positional Need (2026-08-16)

> ⚠ **Read `docs/AGENT_LEARNINGS_INDEX.md` first.** These files were written in sequence during the
> WAR recalibration and **later ones correct earlier ones** — the index says which are superseded.


Companion to `HANDOFF_NIL_2026_08_16.md`. This is the WHY + the gotchas + the mistakes, so the next agent doesn't
re-derive or repeat them. Operating principle throughout (Trevor): improvements got built OVER old code without deleting
it → trace the ACTIVE path, delete dead, one source of truth. Verify, don't guess.

## The core rebuild
The old NIL = proportional share `score / max(Σscore, RAW_WAR_BENCHMARK 33 × tier) × budget`. It overshot the top
(near-zero-WAR players priced ~$0 → dropped out of the denominator → a star ate too much; Lackey→Arkansas $790K vs a
$500K real ceiling). Replaced by a **rank-decay curve that sums to budget by construction** — no explode-when-teammates-
weak bug. Then **budget-flex** so it doesn't scale linearly: as budget drops the top HOLDS value (alpha ramps up) and the
floor DRAINS (floor_frac down). $5M is the fixed calibration endpoint; every smaller budget concentrates from there.

## GOTCHA #1 — there were SIX drifted copies of the allocation
Not one. The proportional split lived in the TB sim (`projectedBudgetShareForPlayer`), NilValuations (68 fallback), AND
four hand-rolled clones (GMRoster, GMScenarios, GMTargets, PlayerHub — each re-derived `war×PVM / max(Σ,33) × budget`
inline). Fixing only the TB sim would have shipped two different NIL numbers. **Lesson: audit for ALL display surfaces of
a value before "fixing" it** — a subagent completeness-audit found the 4 GM/Hub clones the TB-only view would have missed.
All six now route through the one `allocateNil`.

## GOTCHA #2 — projection vs descriptive WAR (do NOT conflate)
Two distinct uses, and Trevor corrected me on it:
- **The championship BAR is built from DESCRIPTIVE 2026 full-season WAR** — ONLY because it's the one complete season of
  real data to calibrate a threshold from. (Not because descriptive is "the" measure.)
- **Every player VALUE — the score, the roster need-check, target values — uses PROJECTED WAR.** We project forward.
I initially wrote "returner clears on his descriptive WAR" in two committed places — WRONG, fixed in `f799c6f`. The GM/TB
rows already carry projected WAR, so there is NO descriptive-WAR join to add for need detection.

## GOTCHA #3 — the national positional-scarcity chase is a dead end (PARKED)
Trevor wanted data-driven positional value to replace the hand PVM ladder. We re-pulled at ≥50 half-innings (fixed the
corner-OF truncation; 311 multi-position players vs the old 34). Findings that killed it:
- On **descriptive** WAR the within-position elite→median **cliff is nearly FLAT** (~1.75–1.92 all positions except 2B) →
  cliff barely differentiates.
- Raw **elite-supply count** (≥2.0 bar) **INVERTS** intuition (2B/3B fewest elite, C/SS "abundant") because **catcher
  counting-WAR is suppressed** by fewer innings (rest days → low ceiling, p90 only 1.52) and raw count tracks total bodies.
- The answer flips depending on the metric (cliff vs count vs rate); catcher needs a special per-inning normalization.
**Conclusion (Trevor): not worth chasing. Positional value → PURELY the team-need premium.** The national "position worth
in the abstract" signal is inherently noisy at this level. Receipts in spec §7.4. **Do not re-attempt the national derived
index without new data / a fundamentally better metric.**

## GOTCHA #4 — SS is bimodal (drove the p70 bar choice)
For the championship-starter bar we used p70 of full-time regulars (reg_pa≥200) on descriptive WAR. SS jumps 1.02 (p60) →
1.70 (p75): a big glove-first, light-bat cluster drags SS's median down, then a jump to the two-way (championship) SS. p60
would call a good-field/no-hit SS "solid" (wrong); p70 (SS 1.42) clears the glove-first cluster without p75's over-strict
2.31 catcher bar. Chose **p70** — "championship starter," aligns with the team WAR-benchmark (striving-for-championships)
logic. With the 1.3/1.1/1.0 multiples the aggressive bar is a gentle "could use an upgrade" nudge, not jarring (Trevor).

## GOTCHA #5 — score→total_hitter_war is SEQUENCED, not now
Confirmed against the plan (HANDOFF_WAR_REDESIGN §89): `3→(1+2)→4→Step 6b→7b→7c→7d→Step 8`. **7c snapshot = THE NIL
scoring source**; transfer `total_hitter_war` is stale until **Step 6b** (transfers never re-run since Step 6). Wiring the
score to total_hitter_war before 6b/7c would read stale totals. The score stays `owar × PTM` interim; the swap rides the
recompute chain. The DECISION (hitters get o+d+bsr) is locked; the WIRING is gated.

## GOTCHA #6 — the mode is a shared read, NOT a push; save/push-to-coach is separate
GM sets `gm_budget.nil_allocation_mode`; TB + Scenarios read the same value live (`useNilAllocationMode`) so the toggle
changes every surface at once. This is ONLY the projected-allocation shape. Actual pay + budget still flow GM→coach via
the existing finalize/push path, untouched. TB uses `team_builds.total_budget`, GM uses `gm_budget` — different money
sources; only the mode is shared. GMScenarios loads via `loadGmBuildRoster` (no gm_budget in scope) → it reads the mode
through `useNilAllocationMode` too.

## GOTCHA #7 — dead code removed, not stacked (per Trevor's standing directive)
Retired with the rebuild (not left as passengers): RAW_WAR_BENCHMARK 33, calcProgramSpecificAllocation, DEFAULT_PROGRAM_
TOTAL_PLAYER_SCORE 68 (both defs + the fallbackRosterTotalPlayerScore state threaded TeamBuilder→playerRowProps→
PlayerTableRow), the duplicate `projectedNilTierClass` in TeamBuilder.tsx (dead — never called; the real one is in
team-builder/helpers.ts), usePlatformConfig.defaultProgramTotalPlayerScore (zero consumers), PVM inside calcPlayerScore.

## Verification discipline used
Every step: grep for ALL callers before changing a signature; run `tsc -p tsconfig.app.json` and confirm no NEW errors
reference the changed symbols (the ~198 baseline errors are pre-existing); run the full vitest suite. **Could not browser-
verify** (no page load available) — flagged every time; the curve/fixture MATH is unit-tested, the end-to-end render is a
preview-branch check for Trevor. Data pulls for the scarcity research were throwaway `npx tsx` scripts against staging
(.env.local, read-only): `"Hitter Master".total_desc_war` / `"Pitching Master".desc_pwar` (Season 2026) joined to
`player_season_defense` (2026, half_innings≥50) by `source_player_id`, D1 only; projections at `player_predictions`
(returner|regular|2027).

## Data-source cheat-sheet (for the wiring + future scarcity work)
- Descriptive WAR: `"Hitter Master".total_desc_war[_reg]` / `"Pitching Master".desc_pwar[_reg]`, keyed `source_player_id`,
  `Season` column (2026).
- Projected WAR: `player_predictions` (`o_war`/`p_war`/`total_hitter_war`/`d_war`/`bsr_war`), `model_type='returner',
  variant='regular', season=2027` for the own-school forward projection. Keyed by `players.id` (UUID).
- Position credibility: `player_season_defense` (`half_innings` per player×position, `season=2026`), `source_player_id`.
- Full-time gate: `regular_season_pa` (hitters) / `regular_season_ip` (pitchers) on the Masters.
