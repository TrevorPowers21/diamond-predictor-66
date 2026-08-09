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

## 4. The per-pitcher dRS-behind fixture (genuinely novel — no public college system can do this)
B-R subtracts *team-level* defense prorated across all a team's pitchers. We can do better: dRS attributes each
play to a **named fielder on an identified pitch**, so we compute the fielding runs saved **behind THIS pitcher's
specific innings** — Urbanczyk got 1.7 runs of Rice's +13.3, not a flat proration, because most of Rice's glove
work happened behind *other* arms. Prorating would have wrongly docked him.

**Fixture spec:** for each (pitcher, season): `dRS_behind = Σ over the pitcher's innings of the fielding
run-value of plays made behind him` (from the dRS per-play ledger, matched by pitch → pitcher_id). Stamp it like
every other fixture (version, season, provenance).

**Conservation check (its telescope):** `Σ_pitchers dRS_behind(p) == team dRS` for every team — the per-pitcher
attribution must sum back to the team total. This is the same zero-sum discipline as the dRS ledger itself; if it
doesn't telescope, the pitch→pitcher matching is leaking. Assert it per team, per season.

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
