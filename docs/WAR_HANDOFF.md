# WAR System — Handoff (2026-08-10)

Single source of current state for the two-number WAR rebuild. Companion: `WAR_SYSTEM_DESIGN.md`
(the design spec, §8 = the validated projection quality metrics). Branch `feature/war-recalibration`.

---

## TL;DR — where we are

- **Descriptive WAR**: built + shipped to staging (on the Masters). ✅
- **Scale reconcile** (D1 constants across code + edge fn + composite SQL): committed. ✅
- **Projection quality metrics** (hitter wRC+, pitcher FIP): derived, validated, locked. ✅
- **⚠ TWO OPEN ISSUES found on final re-check (must fix before wiring the projection):**
  1. **Hitter oWAR conversion is wrong** — `RUNS_PER_PA` heuristic compresses elite bats ~2×; must
     compute projection oWAR from wOBA via the **wRAA scale** (like descriptive does).
  2. **wOBA baseline is pool-biased / stale** — `lgwOBA` fixture 0.3774 was derived on the ~33
     DRS-log teams, not all D1 (0.3874); descriptive wRAA is centered ~0.01 wOBA too low →
     every hitter inflated ~0.23 WAR. Recompute baselines on **all D1** and re-populate descriptive.
- **Not yet started**: the 8-step build (wire → scope → B.5 → GB%-HR9 → replacement → re-precompute →
  market/display → prod).

**Immediate next action**: recompute the all-D1 wOBA baseline (`lgwOBA`/`wOBAscale`/`lgOBP`), re-populate
`desc_owar`, then wire projection oWAR via the wRAA scale. Trevor to confirm before re-populating.

---

## What we're building

Two numbers per player, fully D1-derived (no MLB borrowing):
- **Descriptive** = what he actually did last season (true runs).
- **Projection** = what we expect next season = a **quality metric × projected opportunities** (the MLB
  architecture — quality-of-player number scaled to playing time). Projection *machinery* (per-rate
  regression/aging) is untouched; only the quality-metric *construction* was rebuilt.
- The **gap** (descriptive − projection) is the buy-low / sell-high signal.

---

## Foundation (shipped to staging)

- **Descriptive WAR on the Masters**, per player-season: hitter = true wRAA (D1 RE24 weights) + dRS + wSB;
  pitcher = RA9 − dRS-behind, 50/50 with FIP. D1-populated (5,343 hitters + 5,377 pitchers, 0 D1 nulls).
- **Constants (stamped, D1-derived)**: RPW 13.1, lgRA9 6.915, lgERA 6.08, E2T 1.137, replacement RA9 8.83,
  RE24 run values (BB +0.458, HBP +0.478, 1B +0.590, 2B +0.893, 3B +1.190, HR +1.423, out −0.415).
- **Scale reconcile (committed e26fca4 / 8c42d20)**: all WAR-scale constants moved to the D1 set in
  `war.ts`, `pitchingEquations.ts`, `process-precompute-jobs/index.ts`, and the composite SQL. Composite
  `refresh_composite_war` redefinition = paste-SQL `20260810_composite_war_d1_rescale.sql`, **NOT yet run**
  on staging (must run in Stage C, after o_war re-precompute, else it mixes scales).

---

## Validated projection quality metrics (regression-derived on D1)

Same method both sides: regress the run-value target on the metrics we already project.

| | Formula | Validation |
|---|---|---|
| **Hitter wRC+** | `0.691·OBP + 0.235·SLG` ÷ league denom | wOBA corr **0.996** |
| **Pitcher (FIP)** | `3.10 − 0.231·K9 + 0.509·(BB9+HBP9) + 1.486·HR9` → ×E2T → RA9 | same-season \|Δ\| **0.30** |

- **Key exhibit / doctrine proof**: D1 walk coefficient **0.570 vs MLB FIP 0.33 (+73%)** — the D1 run
  environment reprices the walk; HR/K ≈ MLB. MLB FIP would systematically bury elite-control pitchers.
- HBP folded into the walk term (matches FIP's `3·(BB+HBP)`), NOT a free predictor (free predictor
  over-fit HBP to 0.570 > walk).

---

## Locked decisions (with rationale)

1. **Quality metric stays quality × opportunities** (MLB-correct). We rebuilt the metric *construction*,
   not the projection machinery.
2. **No flat w_luck term.** Regression FIP projects skill; luck is the residual (FIP's purpose).
   Contact-suppression skill is credited via the SKILL channel (ground% persists r=0.601), not a raw
   ERA−FIP fraction. **Guard**: Step-4 GB%-HR9 must recover a *clean* contact-manager (low-K, elite
   results, normal HBP) to ~0; if not, w_luck reopens.
3. **Coefficients fit same-season, NOT out-of-sample.** Regression-to-mean already lives in the RATE
   projections (verified: rates projected separately, `0.3·last + 0.7·scouting`, per-stat SDs; the
   last-season term carries each stat's YoY persistence — K9 0.578 vs contact 0.147). OOS-fitting the
   coefficients would double-count regression. **This decision is gated by the B.5 regression check —
   PASSED by construction.**
4. **Replacement is DERIVED, not imposed.** MLB's "fix total WAR + choose 57/43 + back-solve" is the
   borrowed shortcut we reject. Derive BOTH replacement levels from the D1 talent gradient on ONE
   principle = freely-available/depth-tier player (arms+bats who absorb innings/PA when the front-line
   can't); split falls out, VERIFY don't tune. Guards: same percentile-of-usage tier def both sides;
   min-n floor; documented as "freely-available talent as actually deployed" (selection bias — depth
   players who play are the better ones, often soft contexts). Current levels are INCONSISTENT: pitcher
   8.83 (win%-anchor, derived) vs hitter 2.0 wins/600 (borrowed) — re-derive both.
5. **Replacement 8.83 holds for now** — the "2.0 WAR at 200 IP" alarm was a phantom (no D1 arm throws
   200 IP; at ~90 IP the line yields a ~1.5-WAR average Friday starter, correct).

---

## ⚠ OPEN ISSUES (found on final data-check, fix before wiring)

### A. Hitter oWAR conversion (RUNS_PER_PA is wrong)
The `(wRC+−100)/100 × PA × RUNS_PER_PA` heuristic treats wRC+ as a run-ratio, but it's a wOBA-ratio →
compresses elite bats ~2× (Hairston desc 5.28 → 2.79). **Fix: compute projection oWAR from projected
wOBA via the wRAA scale** (`(wOBA−lgwOBA)/wOBAscale · PA / RPW + repl`), same as descriptive → |Δ| 0.39→0.17,
elite bats recover (Hairston → 5.13). If keeping heuristic form, correct RUNS_PER_PA = `lgwOBA/wOBAscale ≈ 0.41`
(not 0.163) — but the wRAA scale is the clean answer.

### B. wOBA baseline pool-biased / stale
`lgwOBA` fixture **0.3774** was derived on the DRS-log pool (~33 high-TrackMan teams), not all D1 (**0.3874**).
RE24 run *values* are fine (physics); the *population baseline* is ~0.01 wOBA too low → descriptive wRAA is
centered on too-generous a bar, **inflating every hitter ~0.23 WAR**. Same for `wOBAscale` and `lgOBP` (refined
denom is 0.3761, I'd been quoting 0.3715). **Fix: recompute lgwOBA/wOBAscale/lgOBP on all D1, keep RE24 values,
re-populate `desc_owar`.** Re-centering moves every hitter (and the split, and market values) — confirm magnitude
with Trevor before re-populating.

---

## The build sequence (8 steps, after the two fixes above)

0. **(pre-fix)** recompute all-D1 wOBA baseline + re-populate descriptive; wire oWAR via wRAA scale.
1. **Wire** the two quality metrics into the projection path (refined wRC+ → oWAR via wRAA scale; D1-FIP → pWAR).
   Denominators/baselines become **stamped per-season fixtures with stale-guards** (the 0.364→0.3715→0.3874
   saga is why). **Gate**: same-season test converges; replacement player ≈ 0; no double-scaling.
2. **Scope**: gap = regular-vs-regular via existing `regular_season_pa`/`regular_season_ip`; descriptive
   headline stays full-season (deep-postseason stars, e.g. Volantis 95 full IP → 75 reg, else fake sell-high).
3. **B.5 rest**: per-metric power-rating math; Stuff+/pitch-log source is current not stale.
4. **Refinement #1**: GB%-informed HR9 (project HR9 partly from ground%). Clean-contact-manager recovery
   is the falsifiable w_luck guard.
5. **Derive replacement** (both sides, one tier principle) — *before* the re-precompute (swapped to avoid
   staging double-churn). Reconcile split population here.
6. **Re-precompute** on final constants: deploy edge fn, rebuild `player_predictions` o_war/p_war, run
   `refresh_composite_war()`, reseed `team_war_snapshots`, transfer-fill all users. Verify in DB.
7. **Market value → projection total** + **display pass 2** (total WAR everywhere, hitters swap o_war→total,
   pitchers keep p_war; descriptive + gap on the card).
8. **Prod replay** on explicit "prod, now?" — staging verified first.

---

## Bugs found + fixed (institutional memory)

- **CSV parse bug (ac590b4)**: TruMedia export quotes team names with embedded commas ("University of
  Hawai'i, Manoa"); naive `split(",")` shifted columns on ~70 rows (1.3%). Corrupted `populate_descriptive_war.mjs`
  (wrote staging desc WAR) → fixed with quote-aware `parseLine`, re-populated. Aggregates were robust
  (E2T 1.1370≈1.1373, FIP coeffs unchanged, wOBA fit IMPROVED 0.984→0.996); only per-player values for
  comma-team players were wrong (Magdaleno desc_pwar 5.05→4.94). **Lesson: any script reading the export
  sheets needs quote-aware parsing.** Clean (verified): `derive_woba_weights.py` (csv.DictReader), FIP core
  (Master columns), persistence check (Master).
- **Magdaleno "high-HBP" story RETRACTED** — it was 100% the CSV corruption (fake 382 IP/116 HBP). Real
  HBP9 1.04 (normal, 43rd pctile). He IS a clean contact-manager; the guard stands.
- **Out-at-home / earned-run edge cases** in the descriptive ERA engine (earlier session) — resolved.

---

## Rejected approaches (keep — best institutional memory)

- **Naive SD-stretch** to match wRC+ spread → Volantis/Flora blow up to 7.2–7.4 WAR, *and* doesn't fix
  contact-managers.
- **Pure run-anchor** on actual RA9 → collapses identical-run pitchers to the same number, kills the
  projection's value.
- **MLB FIP coefficients** → under-value D1 walks (walk weight 73% higher in D1).
- **6-component pRV+ blend** (z·20 each, then average) → double-counts K/BB/HR (in FIP AND standalone),
  compresses the tail (3.1 SD vs hitters' 4.7).
- **RUNS_PER_PA heuristic** for oWAR → compresses elite bats 2× (wOBA-ratio ≠ run-ratio).
- **Imposing the 57/43 split** → derive replacement, split is an output.

---

## Data provenance + discipline

- Staging-first; verify every stage in the DB (Trevor can't open the UI); DDL pasted in the staging
  editor (CLI is linked to **prod** `trbvxuoliwrfowibatkm`, `.env.local` = staging `slrxowawbijbjrkozqlj`);
  explicit "prod, now?" before any prod write.
- All derivations stamped fixtures; parity tests (`src/lib/storedVsLive.test.ts` etc.).
- Robust CSV parsing for the export sheets (post-bug).
- Per-season league baselines become stamped fixtures with runtime stale-guards.

## Key numbers reference

RPW 13.1 · lgRA9 6.915 · lgERA 6.08 · E2T 1.137 · replacement RA9 8.83 (pitcher, re-derive) ·
hitter replacement 2.0 wins/600 (borrowed, re-derive) · lgwOBA all-D1 **0.3874** (fixture 0.3774 = pool,
STALE) · wOBAscale 0.947 (pool, recompute) · lgOBP 0.3898 · lgSLG 0.4543 · RUNS_PER_PA 0.163 (WRONG for
oWAR; wRAA scale or 0.41).
