# WAR System — Handoff (2026-08-10)

Single source of current state for the two-number WAR rebuild. Companion: `WAR_SYSTEM_DESIGN.md`
(the design spec, §8 = the validated projection quality metrics). Branch `feature/war-recalibration`.

---

## TL;DR — where we are

- **Descriptive WAR**: built + shipped to staging (on the Masters). ✅
- **Scale reconcile** (D1 constants across code + edge fn + composite SQL): committed. ✅
- **Projection quality metrics** (hitter wRC+, pitcher FIP): derived, validated, locked. ✅
- **ONE OPEN ISSUE (re-checked with data 2026-08-10, `scripts/drs/_verify_baseline_owar.mjs`):**
  1. **Hitter oWAR conversion is wrong — CONFIRMED.** `computeOWar` (war.ts) converts wRC+→runs at
     `RUNS_PER_PA` 0.163, but wRC+ is a wOBA-ratio so the correct per-point value is
     `lgwOBA/wOBAscale = 0.3994` (**2.45× miss**) → elite bats halved (Hairston desc 5.26 → heuristic
     2.82 → wRAA-scale 5.50; mean |proj−desc| 0.281 → 0.042). Fix at WIRE (Step 1): convert oWAR off the
     wOBA/wRAA scale (RUNS_PER_PA ≈ 0.40, or build oWAR directly from projected wOBA). Descriptive is
     already on the wRAA scale (correct) — only the projection path is broken.
  - **RETRACTED (was issue 2): wOBA baseline pool-bias.** Measured all-D1 PA-weighted lgwOBA = **0.3782**
    vs fixture 0.3774 (Δ +0.0008); re-centering moves desc_owar ~**0.01 WAR/hitter**, inside rounding.
    The earlier "all-D1 0.3874 / ~0.23 WAR inflation" was wrong — pool ≈ all-D1. **No baseline recompute,
    no descriptive re-population.** Small wire-time calibration only: stamp wRC+ denom **0.3667** (not 0.3715).
- **Not yet started**: the 8-step build (wire → scope → B.5 → GB%-HR9 → replacement → re-precompute →
  market/display → prod).

**Immediate next action**: Step 1 wire — fix the oWAR conversion (RUNS_PER_PA → wOBA scale) and stamp the
wRC+ denom 0.3667. Descriptive layer stands as shipped.

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

## OPEN ISSUE (re-checked with data, `scripts/drs/_verify_baseline_owar.mjs`)

### A. Hitter oWAR conversion (RUNS_PER_PA is wrong) — CONFIRMED
`computeOWar` (war.ts:25) does `raa = ((wrcPlus−100)/100) · PA · RUNS_PER_PA(0.163)`. wRC+ is a wOBA-ratio,
so the correct per-point run value is `lgwOBA/wOBAscale = 0.3994` — 0.163 is a **2.45× miss**, halving elite
bats. Measured over 5,343 D1 hitters: mean |proj−desc| oWAR **0.281** (heuristic) vs **0.042** (wRAA-scale);
Hairston (291 PA, .561 wOBA) desc **5.26** / heuristic **2.82** / wRAA-scale **5.50**. **Fix at Step 1: convert
oWAR off the wOBA/wRAA scale** (RUNS_PER_PA ≈ 0.40 = lgwOBA/wOBAscale, or build oWAR directly from projected
wOBA). Descriptive `desc_owar` already uses the wRAA scale — correct; only the projection path is broken.

### B. wOBA baseline pool-bias — RETRACTED (data refutes it)
Claimed the fixture lgwOBA 0.3774 (DRS pool) understated all-D1 (0.3874), inflating hitters ~0.23 WAR.
**Measured: all-D1 PA-weighted lgwOBA = 0.3782** (Δ +0.0008 from fixture); re-centering shifts desc_owar
**mean −0.008 WAR** (max −0.022). The pool's offensive level ≈ all-D1. **No recompute, no re-population.**
Real wire-time calibration only: refined-wRC+ denom, all-D1 PA-weighted = **0.3667** (stamp this, not 0.3715);
lgOBP fixture 0.3774 vs all-D1 0.3823 affects only wOBAscale, and wRAA is scale-independent → descriptive stands.

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

## NCAA D1 averages + SDs — why each matters (`output/ncaa_league_averages_2026.json`)

Recomputed on corrected data (means = all-D1 aggregate; SDs = qualified subset PA≥100 / IP≥30 so tiny
samples don't inflate spread). The fixture carries a per-value "why"; the load-bearing ones:

| value | mean | SD | why it's important |
|---|---|---|---|
| **lgwOBA** | 0.3782 | 0.0526 | hitter anchor — centers wRAA (0 at avg) AND is the wRC+ denom. All hitter WAR rides on it. |
| **wOBAscale** | 0.947 | — | wOBA→runs; sets oWAR RUNS_PER_PA. |
| lgOBP / lgSLG | 0.3824 / 0.4368 | 0.049 / 0.106 | wRC+ terms (0.691 / 0.235). SLG has the widest spread → power differentiates hitters most. |
| **lgRA9** | 6.913 | — | TOTAL-run environment = the WAR currency; anchors RPW + replacement. Pitcher value measured vs this, not ERA. |
| **lgERA** | 6.080 | — | earned-run env; with lgRA9 defines **E2T 1.137** (earned→total; without it pitcher WAR ~14% too high). |
| **lgK9** | 8.279 | 2.144 | FIP input + most persistent skill (r 0.578); SD is the K9⁺ denominator. |
| **lgBB9** | 4.725 | 1.571 | FIP input; D1 walk repriced far above MLB (the signature finding). SD = BB9⁺ denom. |
| **lgHR9** | 1.102 | 0.538 | heaviest FIP coef (1.486); luck-bucket → GB%-HR9 (Step 4) reclaims groundballer skill here. |
| **RPW** | 13.1 | — | runs-per-win; turns runs into WAR. Shared both sides or the desc−proj gap is fake. |
| **replacement RA9 / 2.0-wins-600** | 8.83 / 2.0 | — | the WAR zero point each side (re-derive both, Step 5). |
| **oWAR RUNS_PER_PA** | 0.3994 | — | =lgwOBA/wOBAscale; the conversion that makes proj oWAR reproduce descriptive (replaces wrong 0.163). |

**Spread/tail findings (the SDs, not just the means):**
- Hitter wRC+ SD **13.9** (≈ MLB ~15, sane); best bat **4.71 SD** above mean.
- Pitcher rate SDs (K9 2.14 / BB9 1.57 / HR9 0.54 / HBP9 0.73) are the **denominators of every `+`-stat and Stuff+**
  z-score — normalize on a consistent population when B.5 wires power ratings.
- **Tail asymmetry is expected, not a bug:** D1-FIP's top tail is short (best pitcher only **2.54 SD** below mean)
  but desc_pWAR's tail is long (maxZ **4.86**) — the IP-leverage in the WAR formula restores it. FIP is a **run
  estimate, not a z-index**, so its SD does NOT govern WAR. **Do not z-normalize or SD-stretch the FIP metric** —
  that was the old pRV+'s fatal move (z-averaging compressed it to 3.1 SD and buried aces). Run-mapping calibrates it.

## Data provenance + discipline

- Staging-first; verify every stage in the DB (Trevor can't open the UI); DDL pasted in the staging
  editor (CLI is linked to **prod** `trbvxuoliwrfowibatkm`, `.env.local` = staging `slrxowawbijbjrkozqlj`);
  explicit "prod, now?" before any prod write.
- All derivations stamped fixtures; parity tests (`src/lib/storedVsLive.test.ts` etc.).
- Robust CSV parsing for the export sheets (post-bug).
- Per-season league baselines become stamped fixtures with runtime stale-guards.

## Key numbers reference

**Authoritative NCAA D1 averages → `output/ncaa_league_averages_2026.json`** (recomputed on corrected data
2026-08-10). RPW 13.1 · lgRA9 6.913 · lgERA 6.080 · E2T 1.137 · replacement RA9 8.83 (pitcher, re-derive) ·
hitter replacement 2.0 wins/600 (borrowed, re-derive) · lgwOBA **0.3782** · wOBAscale 0.947 · lgOBP 0.3824 ·
lgSLG 0.4368 · lgAVG 0.2779 · lgISO 0.1589 · lgK9 8.279 · lgBB9 4.725 · lgHR9 1.102 · lgHBP9 1.467.
**wRC+ anchor = lgwOBA 0.3782** (est_wOBA WITH 0.011 intercept), NOT 0.3667 (intercept-less proxy mean).
**oWAR RUNS_PER_PA = lgwOBA/wOBAscale = 0.3994** — replaces the wrong 0.163 (=ΣR/ΣPA, different quantity).
