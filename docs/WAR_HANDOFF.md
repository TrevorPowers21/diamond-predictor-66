# WAR System — Handoff (2026-08-10)

Single source of current state for the two-number WAR rebuild. Companion: `WAR_SYSTEM_DESIGN.md`
(the design spec, §8 = the validated projection quality metrics). Branch `feature/war-recalibration`.

---

## TL;DR — where we are

- **Descriptive WAR**: built + shipped to staging (on the Masters). ✅
- **Scale reconcile** (D1 constants across code + edge fn + composite SQL): committed. ✅
- **Projection quality metrics** (hitter wRC+, pitcher FIP): derived, validated, locked. ✅
- **Offensive side SEALED end-to-end (2026-08-10).** Every constant it touches verified from ≥3 directions;
  the fixture chain traces RE24 → wOBA → wRC+ → WAR with no column disagreeing. Details:
  - **Hitter oWAR conversion `0.163 → 0.3994` — CONFIRMED + PROVEN.** `computeOWar` used `RUNS_PER_PA` 0.163
    (=ΣR/ΣPA, the wrong quantity); wRC+ is a wOBA-ratio so the per-point value is `lgwOBA/wOBAscale = 0.3994`.
    Proven three ways (algebra, reproduces descriptive, corrected RE24 baseline — all → 0.3994). Elite bats were
    halved (Hairston 2.82 → 5.50). **To wire in Step 1** across war.ts + edge fn + TB re-inlines.
  - **wRC+ anchor = lgwOBA 0.3782** (est_wOBA WITH 0.011 intercept). NOT 0.3667 (intercept-less proxy mean),
    NOT 0.3874 (that's the *qualified-regulars* mean — a population choice, not an error; anchor all-D1).
  - **Baseline seam FOUND + CLOSED.** `derive_woba_weights.py:152` baked two baselines into `woba_weights.json`
    (out-weight ⇒ 0.4154 vs wOBAscale ⇒ 0.3985). Re-centered on all-D1 (out −0.3994); three constructions now
    collapse. Structural fix: fixtures carry `_meta.centering_population`, `assertCentering()` guards every combine.
  - **Segmented residual (Step-1 calibration baseline):** grand |err| 0.050, flat across wRC+/PA/BB% except the
    top-19 bats (+0.105, irreducible slash-proxy). Old pool-vs-all-D1 systematic is gone once both sides on 0.3782.
- **Descriptive re-populate on 0.3782** (uniform ~0.016 WAR down) folds into the **Step-6** re-precompute — no
  standalone write. Until then, shipped `desc_owar` is on pool 0.3774.
- **Not yet started**: the 8-step build (wire → scope → B.5 → GB%-HR9 → replacement → re-precompute →
  market/display → prod).

**STEP 1 WIRING — DONE (2026-08-11).** wRC+ rebuilt to C1 and CONSOLIDATED into one source; oWAR conversion
0.163→0.3994; staging config DB synced. Details in "Step 1 — C1 wRC+ consolidation (SHIPPED)" below.
**Immediate next action**: Step 6 re-precompute (staging) — see the build sequence.

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
- **Constants (stamped, D1-derived; authoritative copy = `output/ncaa_league_averages_2026.json` + `woba_weights.json`)**:
  RPW 13.1, lgRA9 6.913, lgERA 6.080, E2T 1.137, replacement RA9 8.83. RE24 run values (above-average, **re-centered
  all-D1 2026-08-10**): BB +0.474, HBP +0.493, 1B +0.606, 2B +0.908, 3B +1.205, HR +1.439, out −0.3994.
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

## Offensive side — RESOLVED (the arc, for the record)

### A. Hitter oWAR conversion `0.163 → 0.3994` — CONFIRMED + PROVEN
`computeOWar` (war.ts:25) does `raa = ((wrcPlus−100)/100) · PA · RUNS_PER_PA(0.163)`. wRC+ is a wOBA-ratio,
so the correct per-point run value is `lgwOBA/wOBAscale = 0.3994` — 0.163 (=ΣR/ΣPA, the league's raw scoring
rate) is a **2.45× miss** plugged into the wrong slot, halving elite bats. **Proven three ways** (algebra;
reproduces wOBA-method descriptive at 0.04; corrected RE24 baseline — all converge on 0.3994). Two-step
environment decomposition (why 0.13→0.40 isn't inflation): events→runs goes UP in a hot league (the 0.40),
runs→wins dampens (RPW 13.1), they mostly cancel (a wRC+ point ≈ 0.18 WAR/600 D1 vs 0.15 MLB). **Wire at Step 1**
(war.ts + edge fn + TB re-inlines), reading from the fixture.

### B. wOBA baseline — POPULATION MISMATCH (not an error) + a real seam, now CLOSED
`0.3874` was never wrong — it's the *qualified-regulars* (PA≥100) mean; `0.3782` is the *all-D1* mean. Anchor on
all-D1 0.3782 (descriptive centers there; 0.3874 would fake-sell-high every hitter ~0.19 WAR). SEPARATELY, a real
seam: `derive_woba_weights.py:152` baked two baselines into `woba_weights.json` (out-weight ⇒ 0.4154 vs wOBAscale
⇒ 0.3985). **Fixed** — re-centered on all-D1 (out −0.3994), three constructions collapse, and every fixture now
carries `_meta.centering_population` + `assertCentering()` guards each combine so the class can't recur. Shipped
`desc_owar` is still on pool 0.3774; its re-populate on 0.3782 (uniform ~0.016 WAR) folds into Step 6.

---

## Step 1 — C1 wRC+ consolidation (SHIPPED 2026-08-11, branch `feature/war-recalibration`, commits `61968fc`→`ed3f79a`)

**wRC+ = `(0.011 + 0.691·OBP + 0.235·SLG) ÷ 0.3782 × 100`** (intercept + regression weights ÷ true lgwOBA;
AVG/ISO redundant → 0). **oWAR RUNS_PER_PA `0.163 → 0.3994`.**

- **One canonical source: `src/lib/wrc.ts`** (`computeWrcPlus` / `computeWrcRaw` / `computeWrcRawFromWeights`, `WRC_C1`).
  The Explore-agent inventory found ~25 wRC+ sites across 3 runtimes; **all** repointed:
  - Display (10): Savant re-exports canonical; ConferenceStats ×2, HistoricalPlayerTable, PlayerProfile ×2,
    ReturningPlayers, Juco ×2, playerRisk.
  - Config/projection (7): predictionEngine, transferProjection, buildTransferProjectionInputs,
    useTeamBuilderSimulation ×2, TeamBuilder, CompareTab → `computeWrcRawFromWeights`.
  - Edge fns (4, Deno local copies, `// canonical:` linked): process-precompute, recalculate-prediction,
    import-power-ratings-csv, google-sheets-sync (dead but consistent).
  - platformDefaults + AdminDashboard (C1 + Intercept field; `owar_*` marked "Derived read-only"; stale text fixed).
- **Intercept** threaded config-editable via `r_w_intercept` / `t_w_intercept` (default 0.011). Required because the
  denom is the true lgwOBA 0.3782 (not the 0.3667 intercept-less proxy) — it centers league-avg at exactly 100.
- **VERIFIED:** repo-wide grep = ZERO old wRC formulas / `0.364`; tsc 195 < 198 baseline; **247/247 tests** (updated to C1).
- **Staging config synced** (`scripts/sql/wrc_c1_model_config.sql`, run + verified): model_config weights/denom/intercept/owar
  → C1; `ncaa_averages.wrc` null → 0.3782. The DB held OLD values that would have overridden the code defaults, so this
  was load-bearing. `t_wrc_plus_ncaa_avg = 1` confirmed a harmless orphan (no denom path reads it; transfer denom key is
  `t_wrc_ncaa_avg`, absent → C1 default 0.3782). **Staging fully C1-consistent: code + tests + config DB + ncaa_averages.**

## SQL ledger — every DB change the WAR redesign touches (status as of 2026-08-11)

| SQL / file | what it does | staging | prod |
|---|---|---|---|
| `scripts/sql/descriptive_war_columns.sql` | ALTER Hitter/Pitching Master — add `desc_owar, wraa, woba, d_war, bsr_war, total_desc_war` (hitter) + `desc_pwar, desc_ra9, desc_fip_ra9, drs_behind, total_desc_war` (pitcher) | ✅ run | ⏳ pending |
| `scripts/sql/wrc_c1_model_config.sql` | wRC+/oWAR constants → C1 in `model_config` + `ncaa_averages.wrc` 0.3782 | ✅ run + verified | ⏳ pending |
| `supabase/migrations/20260810_composite_war_d1_rescale.sql` | redefine `refresh_composite_war()` (d_war/bsr_war ÷13.1, full wSB) | ⚠ DEFINITION only — the `select refresh_composite_war()` fires in **Step 6** | ⏳ pending |
| `scripts/sql/team_drs_store.sql` | team dRS storage (dRS engine, earlier) | ✅ | — |
| ⚠ VERIFY | did the **scale-reconcile** (RPW 13.1 / pwar constants) ever get pasted into the `Equation Weights` table, or does it ride code defaults only? Confirm before prod. | ? | ? |

**Population/write scripts (not SQL, run via `node` on staging):** `populate_descriptive_war.mjs` (writes desc_* — ✅ run,
re-runs in Step 6 on 0.3782); the precompute edge fns rebuild `player_predictions`.

**Equation changes — all in `WAR_SYSTEM_DESIGN.md §8`:** hitter wRC+ C1 (WIRED); pitcher D1-FIP
`3.10 − 0.231·K9 + 0.509·(BB9+HBP9) + 1.486·HR9` (⚠ DERIVED + validated but **NOT wired** — pitcher projection still
runs the old pRV+ blend; that wiring is a separate future step). oWAR conversion 0.3994 + descriptive constants → this doc.

## The build sequence (remaining)

1. ✅ **DONE — Step 1 wiring** (C1 consolidation above). Constants live in `src/lib/wrc.ts` (one source; edge fns mirror);
   the offensive fixtures carry the `centering_population` guard. (the 0.364→
   saga is why). **Gate**: same-season test converges; replacement player ≈ 0; no double-scaling.
2. **Scope**: gap = regular-vs-regular via existing `regular_season_pa`/`regular_season_ip`; descriptive
   headline stays full-season (deep-postseason stars, e.g. Volantis 95 full IP → 75 reg, else fake sell-high).
3. **B.5 rest**: per-metric power-rating math; Stuff+/pitch-log source is current not stale.
4. **Refinement #1**: GB%-informed HR9 (project HR9 partly from ground%). Clean-contact-manager recovery
   is the falsifiable w_luck guard.
5. **Derive replacement** (both sides, one tier principle) — *before* the re-precompute (swapped to avoid
   staging double-churn). Reconcile split population here.
6. **Re-precompute** (staging first) — the big one, now that Step 1 + config are done:
   - **deploy the C1 edge fns** (`process-precompute-jobs` AND `recalculate-prediction` — both changed for C1),
   - **re-populate `desc_owar` on all-D1 lgwOBA 0.3782** (`populate_descriptive_war.mjs` now reads 0.3782 —
     closes the last baseline seam, uniform ~0.016 WAR down),
   - rebuild `player_predictions` p_wrc/p_wrc_plus/o_war/p_war on C1,
   - run `refresh_composite_war()` (paste-SQL `20260810_composite_war_d1_rescale.sql`, **still not run**),
   - reseed `team_war_snapshots`, transfer-fill all users.
   - **Verify in DB**: Hairston oWAR ~5.3, Helfrick ~2.2, league-avg wRC+ ~100, star pWAR ~6.
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

## Where the constants are wired (research 2026-08-10) — READ before Step 1

THREE layers: (1) **derivation fixtures** `output/{ncaa_league_averages_2026,woba_weights,descriptive_constants}.json`
= where values are DERIVED; (2) **runtime config DB** — `model_config` (config_key/config_value/model_type/season,
admin-editable, synced from Google Sheets via `google-sheets-sync`) + `"Equation Weights"` table (newer PRIMARY for
pitching, predictionEngine.ts:274 prefers it, falls back to model_config) + `customer_team_equation_overrides`
(per-team overlay); (3) **hardcoded TS defaults** (fallback when DB empty).

**oWAR conversion `RUNS_PER_PA` (0.163 → 0.3994) — 2 real sites + 1 orphan:**
- `src/savant/lib/war.ts:14` (hardcoded) — imported by depthRoles.ts:296, transferProjection.ts:124,
  buildTransferProjectionInputs.ts:395, playerCalcs.ts:26. The app-side source.
- `supabase/functions/process-precompute-jobs/index.ts:903` (inline `0.163`) — the stored-precompute copy.
- ⚠ `AdminDashboard.tsx:818` `owar_run_value_per_pa` → model_config = **ORPHANED**: no reader anywhere; editing
  it does NOTHING. (Same for owar_runs_per_win / owar_replacement_runs_per_600 / owar_plate_appearances / owar_wrc_plus_baseline.)
  → This constant is LEAGUE PHYSICS (derived from D1 RE24), not a program preference; arguably should be derived-only, not editable.

**wRC+ formula (old 0.45/0.30/0.15/0.10 ÷ 0.364 → new 0.691·OBP + 0.235·SLG ÷ 0.3782) — LIVE via config:**
- model_config keys `r_w_obp/slg/avg/iso`, `r_ncaa_avg_wrc` (+ `t_` transfer variants) READ by predictionEngine.ts:294/704,
  edge fn:421, TeamBuilder, TransferPortal. Plus `"Equation Weights"` table (primary).
- Hardcoded copies to update too: `savant/lib/wrcPlus.ts:19` (SAVANT_NCAA_WRC 0.364, DEFAULT_WRC_WEIGHTS),
  `components/HistoricalPlayerTable.tsx:42` (local computeWrcPlus).
- ⚠ new formula DROPS AVG/ISO → `r_w_avg`/`r_w_iso` go to 0 (or restructure the weight schema).

**Market value:** `nil_base_per_owar` (25000) — WIRED, read via `eqNum("nil_base_per_owar", …)` in TeamBuilder.tsx:2672,
CompareTab.tsx:231, useTeamBuilderSimulation.ts:1115/1572.

**Pitcher pWAR:** `pitchingEquations.ts:239-241` defaults + `"Equation Weights"` table (usePitchingEquationWeights) + edge fn:519.

STEP-1 DECISION (oWAR conversion mechanism): (A) update the 2 hardcoded sites + set the orphaned admin field to 0.3994
(or lock it read-only since it's physics); (B) wire owar_* to actually read from model_config (like the wRC+ weights +
nil already do) — makes admin edits real, single live source, but adds read plumbing. Physics-not-preference argues for (A)+lock.

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
