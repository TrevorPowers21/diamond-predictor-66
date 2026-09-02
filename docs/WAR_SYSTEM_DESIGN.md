# WAR System Design — two numbers: descriptive + projection (2026-08-09)

**Status: DESIGN for pressure-test, NOT built.** Supersedes the "flip 10→13.1 constants" recalibration for the
pitcher side — that exploration surfaced that our WAR needs a real redesign, not a rescale. Hitters get a smaller
but real change (true wRAA vs our fabricated wRC+ index). This doc is written to be torn at; every constant is
marked **DERIVED** or **PLACEHOLDER**, and the build is sequenced so the riskiest unknown (the pRV+ gap) is
resolved before any code is wired.

---

## 0. The core architecture — two numbers, clearly labeled

Every player carries **two WAR numbers that answer different questions**:

- **Descriptive WAR** — *what actually happened last season*, with luck partly regressed and the fielders' work
  removed. The honest record. Who sees it: coaches evaluating their own in-season decisions; team WAR / program
  analytics; the scale in program analytics.
- **Projection WAR** — *what to expect next season*, built from component skills (not outcomes), regressed by
  reliability, aged/class-adjusted. What you pay for.

**BOTH SIDES ARE TWO-NUMBER — symmetric by design:**

| | Descriptive (last season = TRUE RUNS) | Projection (next season = COMPONENT INDEX) |
|---|---|---|
| **Hitters** | true **wRAA / wOBA** (real linear weights — the change Trevor liked; wider, honest spread) | **wRC+** on projected component rates (regressed, aged) |
| **Pitchers** | **RA9 − per-pitcher dRS-behind**, reliability-blended with FIP | **pRV+** on projected component rates (regressed, aged) — *see §5, needs a bug-hunt* |

The rule: **descriptive = true runs (what happened); projection = the component index (what to pay for).** The
index (wRC+/pRV+) is the projection reassembly tool ONLY — it is NOT the descriptive number. Do not display the
projection index as "last season's WAR."

### The disagreement rule (this is a feature, label it)
The two numbers are **allowed to disagree, and the gap is the product.** The explicit rule:
- **|descriptive − projection| small** → sustainable performance. Both numbers agree (Volantis: desc 4.16, proj
  4.93). No signal.
- **descriptive ≫ projection** → lucky/unsustainable season → **sell-high / regression flag** (Urbanczyk: desc
  1.81, proj −0.62 — "good year, don't pay like it repeats").
- **descriptive ≪ projection** → unlucky season, skills say better → **buy-low flag**.
- The **magnitude of the gap** is a tradeable scouting insight and belongs on the pitcher/hitter card:
  *"descriptive says what happened; projection says what to pay for; the delta is the buy-low/sell-high flag."*

**⚠ Precondition (Build Step 0): the two numbers may only disagree for REASONS WE CAN NAME.** A 2.7-WAR gap on
Urbanczyk that we can't fully explain is not allowed to ship — see §5.

---

## FINAL DECISIONS (2026-08-09, Trevor) — authoritative; overrides anything below that conflicts

- **Offensive positional replacement: DEFERRED.** Keep FLAT replacement runs (single league-wide level, 2.0
  wins/600 PA equivalent, derived). Do NOT build per-position offensive replacement. Rationale: positional value
  lives in **market valuations only**; position-indexing replacement would force offensive-WAR recomputation on
  every team-builder position change and duplicate the position-switch complexity already deferred defensively.
  Considered-and-deferred; revisits TOGETHER with the deferred defensive position-switch recompute when team-builder
  work begins.
- **Positional adjustment: NO ladder; defense stays position-aware.** The MLB-style flat runs-by-position ladder
  is STRUCK from the descriptive hitter spec (§1b). No player receives constant runs for his position label —
  either side of the ball, descriptive or projected. This does NOT touch dWAR's position machinery (per-position
  empirical scales, per-position centering, position-indexed defensive replacement, deferred position-switch
  recompute — all stand exactly as built). **Position affects WAR EXCLUSIVELY through measured defensive
  performance vs the player's OWN position's baseline — never a static bonus.** Scarcity/positional premium =
  market valuations only.
- **Everything else stands:** two-number system (descriptive = true runs: wRAA hitters, RA9−dRS-behind FIP-blended
  pitchers; projection = component index: wRC+, pRV+), index NEVER displayed as last-season WAR.
- **⭐ SCOPE (2026-08-09, Trevor) — MAIN FOCUS = the DESCRIPTIVE restructure + projection; NOT rebuilding the
  indices now.** Restructure last-season WAR to true-runs ("how did the player actually perform": **wRAA** hitters,
  **RA9−dRS-behind+FIP** pitchers), and keep the PROJECTION on the **EXISTING wRC+/pRV+ indices unchanged.**
  **Rebuilding the NCAA-normalized indices (wRC+/pRV+) on D1 linear weights is DEFERRED** — they feed conference
  translations, projections, and many normalized stats; too much ripple to shift right now. The pRV+ triple-count
  becomes a KNOWN, documented projection limitation to refine later, not a blocker.
- **Build sequence (re-scoped): Step 0 = DOCUMENT the pRV+ gap composition** (name the why for Urbanczyk: how much
  is legit descriptive-vs-projection regression vs pRV+ over-penalization) so we ship with eyes open — do NOT
  rebuild the index now. Then Step 1 dRS-behind fixture + telescope; Step 2 derive the DESCRIPTIVE constants
  (league RA9, E2T, depth-tier pitcher replacement w/ weekend/midweek/bullpen role check, reliability curve from
  split-half D1 stability) — **Step 2 GATE, pre-registered: the reliability curve must BEAT both pure RA9 AND pure
  FIP at predicting next-season RA9−defense out of sample, else folklore constant WITH disclosure.** Then Step 3 wire.
- **Hitters can move first** (no Step-0 pathology): add true-wRAA descriptive; **projection keeps the existing
  wRC+ unchanged.** The linear-weights index rebuild is the deferred item above, revisited on its own.

---

## 1. Descriptive pitcher WAR — the RA9 / dRS / FIP blend

Old-school truth: run prevention is the name of the game — credit it. But remove the fielders (not the
pitcher's job) and regress the part that was luck (won't repeat). The blend:

```
descRA9 = w · (RA9 + dRS_behind/IP·9)  +  (1 − w) · (FIP · E2T)
descPWAR = (replRA9 − descRA9) · (IP / 9) / RPW
```
- **RA9** = 9·R/IP (all runs, not earned — DERIVED per pitcher from the pitch log / Master).
- **dRS_behind** = the fielding runs saved *behind this pitcher's specific innings* (§4). Adding it back makes
  descRA9 defense-NEUTRAL (a pitcher with good gloves behind him gets his RA9 raised → WAR lowered).
- **FIP · E2T** = the peripheral (defense- AND luck-neutral) run rate. FIP is IN the blend on purpose — it
  carries the K/BB/HR skill and regresses the BABIP/sequencing fluke. Keeping *some* contact management (via the
  RA9 term) is deliberate: in D1, strike-throwing + weak contact off overmatched hitters is a real, repeatable
  skill FIP alone discards.
- **w** = reliability weight (§3, item 2) — small sample → lean on FIP; large sample → trust actual runs.

Worked (Urbanczyk, PLACEHOLDER constants): raw RA9 → 2.56 WAR (too generous, credits .230 BABIP luck); RA9−def →
2.43 (fielders out); FIP → 1.22 (too harsh); **BLEND (w≈0.49) → 1.81** (the sabermetric resolution, WARP/DRA-lite
shape). Volantis (peripherals = results): raw 4.12 / RA9−def 3.88 / blend 4.16 / FIP 4.53 → all agree, blend
doesn't distort a real ace.

## 1b. Descriptive hitter WAR — true wRAA (not our wRC+ index)
Our current `wRC+ = (0.45·OBP+0.30·SLG+0.15·AVG+0.10·ISO)/0.364·100` is a **fabricated weighted-stat index**, the
same class of thing as pRV+ — NOT true runs. Descriptive oWAR should use **true linear weights**:
```
wRAA = ((wOBA − lgwOBA) / wOBAscale) · PA         wOBA from real event run values (BB .69, 1B .89, 2B 1.27, 3B 1.61, HR 2.10 — DERIVE from D1 RE24)
oWAR = (wRAA + PositionalAdj + Replacement) / RPW
```
Effect (D1, measured): mean |Δ| **0.20 WAR** vs the index — stars up, weak hitters below zero (real linear
weights have wider tails than the compressed index). **NO positional-adjustment ladder** (struck 2026-08-09):
no player gets constant runs for his position label, either side, descriptive or projected. Position affects WAR
EXCLUSIVELY through measured defensive performance vs the player's OWN position's baseline (dWAR's per-position
empirical scales / centering / position-indexed replacement — all stand). Scarcity/positional premium lives in
**market valuations only**. Offensive replacement stays FLAT (single league-wide level); per-position offensive
replacement is considered-and-DEFERRED (revisits with the defensive position-switch recompute at team-builder time).

---

## 2. Projection WAR — components, not outcomes (our wRC+/pRV+ ARE right here)
Validated architecture (this is how ZiPS/Steamer/Marcel all work; nobody projects WAR directly):
1. **Project the component SKILLS**, not the slash/ERA: K%, BB%, ISO/contact-quality (hitters); K%, BB%, HR-rate
   (pitchers). Skills are stable; outcomes aren't. Our TrackMan/pitch-log inputs (bat speed, contact quality)
   are Step-1 inputs public projectors would kill for.
2. **Weighted multi-year average** (Marcel ~5/4/3, most-recent heaviest).
3. **Per-stat regression by reliability** (K% barely regresses; BABIP regresses hard). **GAP vs our engine:** we
   regress ~uniformly; upgrade to per-stat.
4. **Aging / CLASS curves** — our biggest edge and biggest missing piece. In college, class replaces age
   (a 21-yo junior ≠ a 21-yo freshman; development track > birthday). Fresh→soph→junior jumps are huge and
   **nobody has derived them from tracking-era college data** — we have 2+ seasons. Same fixture pattern as
   everything else: measure the year-over-year contact-quality/skill delta by class from our own transitions,
   stamp it, apply it.
5. **Reassemble**: projected rates → wOBA/wRC+ (hitters) or the pRV+ blend (pitchers) → same RAA formula →
   projected playing time (depth role) → WAR.

**Projection keeps the EXISTING wRC+/pRV+ indices unchanged (2026-08-09 scope).** They already work as the
projection reassembly index and they feed conference translations + many normalized stats — rebuilding them now is
too much ripple for the gain. So projection stays as-is; the DESCRIPTIVE side (true wRAA / RA9-blend) is where the
restructure happens. The pRV+ double/triple-count (§5) becomes a KNOWN, documented projection limitation, not a
blocker; Step 0 names it rather than fixing it now.

**DEFERRED (considered, worthwhile, not now) — rebuild the indices on D1 linear weights.** The clean fix is:
today the `+`-components are already NCAA-relative (OBP⁺ = player OBP / NCAA-avg OBP, etc.), and the flaw is that
FOUR correlated components get normalized separately and THEN re-blended (double-count). A rebuild would keep the
SAME NCAA anchor (wRC+ 100 = NCAA average) but normalize ONCE: raw events → D1 RE24 weights → wOBA → single
normalization vs lg(NCAA) wOBA (same on the pitcher side). Same baseline, one normalization instead of four —
kills the double-count at the source. DEFERRED because it ripples through conference/normalized-stat consumers;
revisit as its own effort.

---

## 3. Constants to DERIVE (the rough list IS the ballgame)
Every one of these is currently a PLACEHOLDER; none ship until DERIVED from D1 data with a stamped fixture.

| constant | placeholder | DERIVE from | note |
|---|---|---|---|
| `RPW` | 13.1 | Pythagorean 2R, R=6.54 | the one solid value (CONSTANTS_D1_2026) |
| league `RA9` | 6.34 (IP-wtd) | D1 total runs / IP | weighting choice matters (IP-wtd skews to good arms) |
| `E2T` (earned→total) | 1.08 | D1 (R − ER)/ER ratio | FIP is earned-scale; RA9 is total |
| `wOBA` event weights + scale | MLB-ish | **D1 RE24 matrix** (derive_re24.py) | same method as the dRS constants |
| reliability curve **`w`** | IP/(IP+70) | **split-half D1 stability** of BABIP/LOB across pitcher-seasons | NOT MLB folklore — college metal-bat BABIP may stabilize on a different timescale; this number IS the blend |
| pitcher `replacement` | .400 win% | **depth-tier innings** (like defensive replacement came from depth-tier chances) | check role split: weekend-starter / midweek-arm / bullpen may be the real D1 usage tiers, not MLB SP/RP |
| hitter `replacement` | 2.0 win/600 (26.2 r) | depth-tier PA | fixed-WIN so the floor is stable across run env |
| positional adj ladder | absent | D1 cross-position offensive gaps | needed for descriptive oWAR |

---

## 4. The team-dRS fixture — full-season team defense prorated by IP (the Baseball-Reference method)
**DECISION (2026-08-09): team defense prorated by IP, NOT per-pitcher-specific plays.** B-R adjusts each
pitcher's runs using the TEAM's full-season defensive quality applied to his innings — they do not compute which
nine fielders stood behind him on a Tuesday. Reason (Trevor): a team's season-long defense is a **stable,
believable** number; any single pitcher's ~80-IP slice of defensive events is **noise**. So:
```
dRS_behind(pitcher) = centered_team_dRS × pitcher_IP / team_IP
```
Built + validated (`scripts/drs/derive_team_drs.mjs` → `output/team_drs.csv`): 308 D1 teams, Arkansas +41.1 →
Delaware State −27.8, Urbanczyk = Rice(+10.8) × 66.7/510 = **1.41**.

**Team measure = RE-CENTERED `drs_floor` (innings-weighted, per division).** DOCTRINE, one line: **raw where
books must balance, regressed where estimates must predict, CENTERED where a regressed estimate enters a
balancing ledger.** The dRS-behind fixture is a *prediction input* (best estimate of defense behind his innings)
→ so it's the **floor** (regressed; raw carries the same small-sample luck a player's raw does, and subtracting
unregressed luck from RA9 injects noise into the number the blend exists to stabilize). But it enters a *balancing
ledger* (must net to zero league-wide) → so it's **centered**: `centered = team_floor − (league_floor_sum /
league_def_innings) × team_def_innings`. Innings-weighted (NOT a flat per-team mean) so college cancellations /
unequal game counts don't leak bias through the proration. The +721 raw-floor league sum is the documented
selection effect (good defenders play more, shrink less) — fine at player-display grain, a systematic gift to
pitchers if left in a balancing ledger, so it's centered out.

**Conservation telescope (final form):** `Σ dRS_behind across ALL pitchers == 0 exactly`, by construction (Σ of
per-team IP shares = 1, and Σ centered_team_dRS = 0 per division). Assert in the golden suite alongside the
position-grain checks.

**KNOWN LIMITATION (logged, not a build item):** IP-proration assumes every pitcher gets team-AVERAGE defense,
but weekend starters pitch behind the A lineup while midweek arms get the bench. Our per-pitch alignment data
*supports* an actual-defenders-behind-innings version someday — but weekend-vs-midweek is a second-order effect
not worth its complexity until the first-order (team-level) system is live. Team-level now; per-pitch only when
it earns its complexity.

**Storage:** `centered_team_dRS` → a `team_drs` column on `team_war_snapshots` (keyed source_team_id + season);
`dRS_behind` is derived per-pitcher in the descriptive WAR calc (team_drs × IP share).

---

## 5. BUILD STEP 0 (FIRST, before any wiring) — reconcile the pRV+ gap
**The problem:** Urbanczyk is descriptive **1.81** but projection **−0.62** (pRV+ 62 = below replacement). 2.7 WAR
apart. "Descriptive vs projected" explains *maybe half*. Shipping two systems that tell coaches opposite stories
about the same arm, for reasons we can't name, is how trust dies in the first demo.

**Prime suspect — pRV+ double-counts K/BB.** `pRV+ = 0.30·FIP⁺ + 0.25·ERA⁺ + 0.15·WHIP⁺ + 0.15·K9⁺ + 0.10·BB9⁺
+ 0.05·HR9⁺`. K/BB are already inside FIP⁺ (0.30) AND WHIP⁺ (0.15, walks) AND their own K9⁺/BB9⁺ terms (0.25).
So a 4.86-BB/9 arm is penalized 3×, dragging pRV+ 62 far below his FIP⁺ (~91).

**RESOLVED (2026-08-09, Trevor) — the gap is INTENDED, and we know exactly why; no reconciliation or rebuild
needed to ship.** The two labels dissolve the reviewer's "opposite stories" worry: they aren't opposite, they're
*last season* vs *next season*. Urbanczyk is the canonical correct case, not a bug:
- **Descriptive ("how did he perform") = +1.81** — he ran a 2.8 ERA, he genuinely prevented runs → positive WAR. Right.
- **Projection ("how good is this pitcher going forward", pRV+) = −0.62** — 4.86 BB/9, 5.19 FIP, horrible
  peripherals → should NOT project positive at all. Right. pRV+ being below replacement here is the projection
  doing its one job, not the triple-count breaking it.
So Step 0 is CLOSED: we ship the two numbers with clear labels and a known, correct why. The pRV+ triple-count
rebuild (price events once from D1 RE24 weights) stays the DEFERRED §2 item — a future precision nicety, NOT a
blocker, because it wouldn't flip Urbanczyk's sign anyway (a bad-peripheral arm projects negative either way).
The descriptive number is the honest last-season record; the projection is what to pay for; the gap is the signal.

---

## 6. Build sequence
0. **pRV+ gap — CLOSED (§5).** Resolved by design: the descriptive-vs-projection split IS the answer (Urbanczyk
   correct — +1.81 last season, −0.62 going forward). No rebuild; the triple-count fix is the deferred §2 nicety
   and wouldn't flip signs. **Build STARTS at Step 1.**
1. **Build the per-pitcher dRS-behind fixture** (§4) + its conservation telescope.
2. **Derive all constants + the reliability curve** (§3) from D1 data, each a stamped fixture with its own check.
   **GATE (pre-registered):** the derived reliability curve `w` must BEAT both pure RA9 AND pure FIP at predicting
   next-season `RA9−defense` OUT OF SAMPLE. If it fails, fall back to the folklore constant WITH disclosure — do
   not ship a blend that's worse than either endpoint.
3. **Wire** the two-number system: descriptive (wRAA / RA9-dRS-FIP blend) + projection (components), both clearly
   labeled, both paths (stored + live), display shows both + the gap.

## 7. Provenance discipline (same as everything else)
Stamped fixtures (version + season + derivation script), version guards, position-grain-style assertions where
they apply (the dRS-behind conservation check is one; the wOBA telescoping-zero-sum is another). No placeholder
constant reaches a demo unlabeled. Cross-check the finished descriptive numbers against Baseball-Reference-style
external WAR where a public equivalent exists (it mostly doesn't for D1 — which is the point).

## 8. Projection quality-metric rebuild — VALIDATED (2026-08-10)
BOTH quality metrics derived by REGRESSION on D1 data (same method), replacing the earlier chain/blend
framings. Architecture stays MLB-correct: quality = Σ(projected event rate × D1 run value), normalize to
100 (=league avg), × projected REGULAR-season opportunities. Only the quality-metric CONSTRUCTION changed;
the per-rate projection machinery (regression/aging) is untouched.

  ⚠ ALL NUMERIC CONSTANTS (coeffs, denom, league averages, SDs) LIVE ONLY IN output/ncaa_league_averages_2026.json.
    The prose below names them for reading; the FIXTURE is the single source (the denom has drifted through four
    values — 0.364 stale / 0.3715 / 0.3667 proxy-mean / 0.3782 lgwOBA — precisely because numbers lived in prose).

  HITTER wRC+  = (0.011 + 0.691·OBP + 0.235·SLG) / lgwOBA·100   (OLS of D1 wOBA on slash; corr 0.996; re-derived
                 EXACT on corrected data). Uses est_wOBA WITH the intercept, anchored on lgwOBA (the REAL D1 avg
                 wOBA), NOT the intercept-less proxy mean 0.3667. ISO/AVG redundant (ISO=SLG−AVG; power via SLG).
                 OBP 0.45→0.691 IS the walk fix. Residual = 2B/3B/HR split + per-PA/per-AB denom mismatch (deferred).
  PITCHER FIP  = 3.10 − 0.231·K9 + 0.509·(BB9+HBP9) + 1.486·HR9,  ×E2T → total RA9   (OLS of D1 ERA, n=1988, IP≥30)
                 HBP folded into the walk term. JUSTIFIED BY OUR OWN RE24 VALUES: BB and HBP have near-identical
                 D1 run cost (0.458 vs 0.478), so one coefficient is correct — this is a D1 derivation, NOT a copy
                 of MLB FIP (which prices 3·(BB+HBP) at a different absolute ratio). Same-season test (WAR units):
                 mean |proj_pwar − desc_pwar| = 0.297 ≈ 0.30 (vs pRV+ blend 0.59). Volantis Δ −0.16 (ace stable),
                 Magdaleno −0.57 (contact-mgr gap → GB%-HR9 closes), Flora/Urbanczyk diverge on purpose (luck).
                 ⭐ D1 walk coef repriced far above MLB FIP's 0.33. Single best "derive-don't-borrow" exhibit.
  Projected WAR: hitter (wRAA + repl)/RPW ; pitcher (replRA9 − projRA9)·IP/9/RPW. Both = quality-RATE × OPPORTUNITY,
                 and neither rate's SPREAD governs its value spread — the value tail comes from rate × PA (hitter,
                 4.7 SD) or rate × IP (pitcher, desc_pWAR 4.86 SD despite FIP's short 2.54-SD rate tail). Do NOT
                 z-normalize / SD-stretch either metric (that was the pRV+ postmortem's rejected fix).

DECISIONS (cross-check flags resolved):
  - ⚠ THE TWO INDICES ARE DIFFERENT CONSTRUCTIONS: wRC+ is a wOBA-RATIO index, D1-FIP is a RUN-ESTIMATE. So the
    old "a 160 hitter ≡ a 160 pitcher" equivalence is NO LONGER strictly true and must NOT appear in display copy.
    They meet only after conversion to WAR (both /RPW on the same run scale) — compare WAR, not the indices.
  - ANCHOR POPULATION = all-D1 (lgwOBA 0.3782, every PA>0), NOT qualified regulars (0.3874, PA≥100). Forced by
    consistency with descriptive wRAA, which centers all-D1; anchoring on 0.3874 would drop every hitter ~0.19 WAR
    (a fake sell-high on everyone). The 0.3782-vs-0.3874 gap was a POPULATION mismatch, not an error.
  - CENTERING: fit the wRC+ regression PA-weighted on the anchor population so est_wOBA's PA-weighted mean == lgwOBA
    and the index centers at exactly 100 (unweighted fit is off 0.06 wRC+ — sub-point but pinned via a golden).
  - oWAR run conversion RUNS_PER_PA_WOBA = lgwOBA/wOBAscale (≈0.3994) JOINS the stamped-fixture chain with a runtime
    stale-guard — it must NOT live inline anywhere (this is the 2nd constant-drift bug after the 0.364 denom).
  - w_luck = NO flat luck term. Regression FIP projects skill; luck is the residual (FIP's purpose). Magdaleno's
    contact suppression is credited through the SKILL channel (ground% r=0.601), not a flat w_luck×(ERA−FIP) fraction.
  - REFINEMENT #1 (post-wire): GB%-informed HR9 — project HR9 partly from projected ground% (persists 0.601) instead
    of flat regression, so groundball HR-suppression is credited durably (completes Magdaleno's recovery).
  - Out-of-sample coefficients NOT required: regression-to-mean lives in the RATE projections (already there); FIP
    coefficients are cross-sectional run pricing (same-season physics). OOS-fitting them would double-count regression.
    Load-bearing on the Step-3 check that rate projections regress PER-COMPONENT — if fallbacks blend uniformly, reopen.
    Honest footnote: same-season OLS coeffs absorb whatever luck correlates cross-sectionally with the rates — fine
    for pricing physics, and it's WHY the residual is where BABIP luck lives by construction.
  - Scope: gap = regular-vs-regular via existing regular_season_pa/_ip columns; descriptive headline full-season.
  - Magnitude on record: composite-wRC+ elite compression measured 1.5–2.0 WAR (Hairston −2.03), not ±0.3–0.5.

### 8a — oWAR run conversion + the run-environment decomposition (answers "why 0.13 → 0.40")
The oWAR conversion RUNS_PER_PA = lgwOBA/wOBAscale = **0.3994** (fixture). The old 0.163 was ΣR/ΣPA (the
league's absolute scoring rate) plugged into the wrong slot — a wOBA-ratio deviation needs the run-value of a
wOBA point, not the average run rate. Confirmed three ways (pure-RE24 = wOBA-method = wRC+×RPP; _recenter_check.mjs).

WHY THE JUMP LOOKS BACKWARDS BUT ISN'T — two environment effects on two different steps, pushing opposite ways:
  1. EVENTS → RUNS (this is the 0.40). In a hot offensive league each hit drives in more traffic and each out
     wastes more, so an event is worth MORE runs. The D1 RE24 weights literally show it (BB 0.458 vs MLB ~0.29,
     out −0.415 vs ~−0.26). This step goes UP in college: 0.40 > MLB's ~0.31.
  2. RUNS → WINS (this is RPW = 13.1 vs MLB ~10). More runs scored means each run matters LESS for a win, so
     value is DAMPENED. This is the "friendly environment tightens the gap" intuition — applied at this step.
  They mostly cancel: a wRC+ point is worth ~0.18 WAR/600 PA in D1 vs ~0.15 in MLB. The scary-looking 0.40 gets
  divided right back down by the (correctly larger) RPW. The 0.13→0.40 change fixes a wrong plug; it is not inflation.

  ⚠ The proof of 0.40 is that pure-RE24 = wOBA-method (independent constructions agreeing), NOT that hitter WAR SD
  (~0.95) happens to match pitcher WAR SD (~0.94). The raw hitter/pitcher distributions genuinely differ (ERA spans
  2→10 vs a compressed hitting distribution — which is exactly why we index to 100). SD-symmetry is discarded as
  evidence; construction-agreement is the standard.

### 8b — the offensive baseline seam (closed 2026-08-10)
derive_woba_weights.py line 152 computed lg_raw with RE24-bucket counts over pa_total, baking two baselines into
one fixture (out-weight ⇒ 0.4154, wOBAscale ⇒ 0.3985). The ONE correct all-D1 baseline is lg_raw = 0.3994
(Σ raw-runs ÷ Σ PA, all D1). Fixed: linear_weights_above_avg re-centered (out −0.4154 → −0.3994), lgwOBA
pool 0.3774 → all-D1 0.3782; physics unchanged; three constructions now collapse.
Structural close: every derived fixture now carries `_meta.centering_population`, and code that combines
fixtures calls `assertCentering()` (scripts/drs/_fixture_guard.mjs) — this seam-class can't ship silently again.

STEP-1 CALIBRATION BASELINE — segmented residual, projection oWAR vs descriptive, BOTH on all-D1 0.3782
(_residual_segments.mjs; grand |err| 0.050, signed −0.005). Flat = pass; a flat grand mean hiding a tail = fail.

  segment            |err|    signed        segment          |err|   signed
  wRC+ <80           0.036   +0.006         PA 50-120        0.034  −0.004
  wRC+ 80-95         0.047   −0.007         PA 120-200       0.052  −0.002
  wRC+ 95-105        0.056   −0.005         PA 200-260       0.060  −0.007
  wRC+ 105-120       0.055   −0.012         PA >=260         0.065  −0.011
  wRC+ 120-140       0.048   +0.006         BB% Q1 (<8%)     0.046  +0.008
  wRC+ >=140 (n=19)  0.109   +0.105  <--    BB% Q4 (>14%)    0.057  −0.019

FLAT everywhere except the top-19 bats (+0.105) — that is the IRREDUCIBLE wRC+ slash-proxy error (the
2B/3B/HR split the OBP+SLG proxy can't see). It is the measured cost of the slash-proxy bridge: ~0.09 WAR on
19 players, which is exactly the number that would justify event-level projection IF anyone ever asks "what
would we gain" — and the argument for not building it now. The old pool-vs-all-D1 signed systematic
(−0.016→−0.029) is GONE once both sides are on 0.3782; the shipped desc_owar (still on pool 0.3774) closes
that uniform ~0.016 WAR at the Step-6 re-populate.

--- (superseded design notes below; kept for the diagnosis + rejected-approaches record) ---

## 8b. (original) Pitcher projection rebuild — the pRV+ CHAIN
"Swap the assembler, not the projector." The projection engine (validated per-rate projections of K9/BB9/HR9)
is fine; the ASSEMBLY is broken. Current pRV+ = 0.30·FIP⁺+0.25·ERA⁺+0.15·WHIP⁺+0.15·K9⁺+0.10·BB9⁺+0.05·HR9⁺,
each X⁺ = 100+z·20. Two structural faults: (a) FIP already contains K/BB/HR, so K9⁺/BB9⁺/HR9⁺ DOUBLE-COUNT the
three true outcomes; (b) averaging six separately-normalized z-scores COMPRESSES the tail — the best pitcher
reaches only 3.1 SD above the mean vs the best hitter's 4.7 (wRC+ normalizes ONCE, so its tail survives).
Empirically pRV+ fails the same-season test: mean|proj−desc| = 0.59 WAR (wRC+ = 0.20), biased low for aces —
a weak-contact ace (Magdaleno 2.36 ERA/2.48 FIP) buried at pRV+ 131 → 3.3 WAR vs his 5.05 descriptive.

REJECTED: (1) SD-stretch to match wRC+ → Volantis 7.2 / Flora 7.4, egregious, AND doesn't fix Magdaleno.
(2) Pure run-anchor on ACTUAL RA9 → collapses identical-run pitchers to one number, erasing the projection's value.

THE CHAIN (industry-standard: Steamer/ZiPS/THE BAT never blend overlapping stats — skills in, one run number out):
  1. Inputs = existing validated projected K/BB/HBP/HR rates. Nothing new; the projector is untouched.
  2. Assemble projected component RA9 via a D1 FIP ANALOG — price events with our RE24-derived run values
     (output/woba_weights.json, NOT MLB's 13/3/2) + league contact baseline → total-run scale via E2T = 1.137.
  3. + w_luck × prior-season (ERA − FIP) gap.  w_luck ≈ 0.1–0.2, FIT 2025→2026 OUT OF SAMPLE (same gate as the
     reliability curve). Weak-contact keeps a sliver of edge; the .230-BABIP guy gives most of it back.
  4. Index ONCE, linear (display only):  pRV+ = 100 + 100·(lgRA9 − projRA9)/lgRA9.  (The ratio form
     100·lgRA9/projRA9 blows up in a 6.9-run environment → 290+, unusable — do NOT use it.)
  5. Projected pWAR = (replRA9 − projRA9) · projected IP/9 ÷ RPW.  projIP from role/usage (same layer as hitters).
DELETES: all six blend weights, per-component z-scores, the z·20 scaler, any back-solved calibration.
Prototype (placeholder weights) hit the acceptance sentence: Volantis 5.26, Magdaleno 4.89 (gap 0.37 from their
FIP difference — single-counted, not a K double-penalty), Flora correctly SHORT (luck it shouldn't reproduce),
mean|Δ| 0.22. Repeatability (Volantis > Magdaleno) is carried by the per-component REGRESSION CONSTANTS, not by
any K term — K% persists, contact luck regresses.

PIVOTAL EMPIRICAL CHECK (decides a branch): do our existing rate projections regress per-component or uniformly?
Correlate projected-vs-actual (or actual year-over-year) BY STAT — IP ≥ 40 in BOTH seasons, read CORRELATIONS not
raw errors (K9 and BABIP live on different scales), floor the sample so thin-arm noise doesn't fake uniformity.
K9 meaningfully tighter than the contact-dependent stats → differential persistence already lives in the
projections and the chain inherits the engine for free. Everything clustered → build a per-component regression
schedule (each constant fit to predict next-season actuals OUT OF SAMPLE, same as w_luck).

REPLACEMENT / hitter-pitcher SPLIT = IMPOSED, not derived. MLB fixed total league WAR and CHOSE 57/43 position/
pitcher, then back-solved replacement levels. Our current 57/43-PITCHER-heavy split is thus neither validated nor
refuted by the 8.83 derivation. Decide it AFTER the hitter wRAA rebuild un-suppresses the hitter side — then
either accept the college-native emergent split with documentation, or impose a chosen split and back-solve.

SEQUENCE (locked): hitter wRAA rebuild → re-check the 57/43 split → pitcher chain rebuild → replacement/split
decision LAST. The same-season test is a CALIBRATION CHECK, not the goal: it must PASS on the ERA≈FIP subset and
FAIL on purpose for luck profiles (Urbanczyk/Flora must NOT reproduce their descriptive — that divergence is the
product). HAVE: RE24 run values, E2T 1.137, validated rate projections, descriptive side shipped. BUILD: the D1
FIP analog, the w_luck fit, and the per-component regression check.
