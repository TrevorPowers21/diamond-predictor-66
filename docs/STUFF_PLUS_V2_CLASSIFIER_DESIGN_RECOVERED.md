# STUFF+ v2 PER-PITCH CLASSIFIER — DEFINITIVE DESIGN SPEC (RECOVERED)

**Consolidated 2026-08-28** from 4 transcript-mining passes (session `7531d0c4`, design window
2026-08-16 → 2026-08-17) reconciled against `docs/HANDOFF_STUFF_PLUS_2026_08_16.md` (the distilled
design record) and `docs/STUFF_PLUS_RECLASS_HANDOFF_2026_08_28.md` (the recovered as-built rules).

**Provenance note.** The raw Aug-16/17 design conversation is NOT in the two JSONL files originally
named for the task (`6de…`, `9ae…` — those hold April–July podcast chatter only). The real design
session is `7531d0c4-…jsonl` (45 gyro/armHB hits Aug-16, 247 Aug-17). Where the transcript is silent,
the authoritative fallback is staging `_reclass_result` (2,000,674 rows, `uniq_pitch_id → label`,
env-independent) — the bit-exact answer key — plus the recovered rule STRUCTURE in
`STUFF_PLUS_RECLASS_HANDOFF_2026_08_28.md` §"THE RULES AS BUILT".

---

## 0. CONVENTIONS (read every rule with these)

- **`armHB`** = HB handedness-normalized to **arm-side-positive**: `armHB = (hand == R ? hb : −hb)`.
  `+` = arm-side run, `−` = glove-side break. "Glove-side break" = `−armHB`. **Every boundary rule
  reads `armHB`, never raw `hb`.** The handedness-normalization audit (sinkers run more arm-side than
  4S within each hand) is the check that this fold is correct; it PASSED. Without it the LHP sinker /
  "13+ arm-side run" condition silently inverts.
- **`gap`** = `primaryFB_velo − pitch_velo`, where **primaryFB = the pitcher's HARDEST fastball-family
  cluster**. Two-pass per pitcher: identify primaryFB first (its own gap = 0), then gap-classify the rest.
- **`ivb`** = venue-corrected IVB (`ivb_corrected`, the LOO + empirical-Bayes venue-movement layer, τ≈0.63″).
  Corrected movement is ONE layer feeding classification AND scoring both.
- **`rr` (ride-vs-run ratio)** = `ivb − |armHB|`. The FA/SI discriminant.
- All classification is at the **CLUSTER level per (pitcher × hand)** — NEVER per-pitch as the final
  label. Per-pitch seeding happens first, then the cluster's MEAN carries the label (see §2). Per-pitch
  final labeling was the shortcut that failed Check 1 (breaking 0.816 vs TM 0.858).

---

## 1. THE FULL CLASSIFIER — per-pitch boundary seeds, CASE-evaluation order

This is the **exact recovered evaluation order** (from staging `pg_stat_statements`, confirmed in
`STUFF_PLUS_RECLASS_HANDOFF_2026_08_28.md`). Order is load-bearing: earlier CASE arms claim pitches
before later ones see them. Each pitch is seeded to a bucket; the cluster mean later ratifies or flips it (§2).

```
# per pitch, on pitch_log_corrected:
#   armHB = (hand==R ? hb : −hb);  gap = pf_velo − release_velocity;  ivb = ivb_corrected;  rr = ivb − |armHB|

1. if ivb ≤ −8  AND armHB < 4  AND gap ≥ 4          → CURVEBALL
2. if armHB ≤ −12  AND ivb ∈ [−2, +6]              → SWEEPER
3. if ivb ≥ +5  AND gap ∈ [2, 7]  AND armHB ≤ 2    → CUTTER
4. if gap < 4:                                       (FASTBALL family — the ±4 ride/run strip)
        rr > +4                                     → 4S FB          (ride-dominant)
        rr < −4                                     → SINKER         (run-dominant, arm-side)
        else (middle strip −4 ≤ rr ≤ +4):           resolve by the pitcher's OWN fastball-cluster MEAN
                                                     (as-built per-pitch proxy: rr ≥ 0 → 4S, else Sinker)
5. if |armHB| < 5  AND ivb ∈ [−4, +4]              → GYRO SLIDER
6. if armHB > 0:                                     (OFFSPEED family — arm-side)
        spin < ~1400                                → SPLITTER
        else                                        → CHANGE-UP
7. else                                             → SLIDER         (glove-side breaking residual, ivb<5)
```

### Per-arm one-line rationale + the exact number

1. **CURVEBALL — `ivb ≤ −8 AND armHB < 4 AND gap ≥ 4`.** Topspin (very negative IVB) is the
   curveball signature and "forces entry" at any gap; `−8` is the depth floor. The `armHB < 4` and
   `gap ≥ 4` gates were ADDED (Check 3 golden forced it) so the raw `ivb ≤ −8` rule stops stealing
   **arm-side-deep** pitches (hard sinkers/screwballs, +11..+18 armHB → route to offspeed) and
   **fastball-velo depth** (`ivb ≤ −8 & gap < 4` → REVIEW/exceptions, physically inconsistent
   mis-identified fastballs, 24 clusters flagged). 12-6 cited as `|armHB| < ~8`.
2. **SWEEPER — `armHB ≤ −12 AND ivb ∈ [−2, +6]`.** Extreme glove-side sweep (≥12″) with near-flat
   vertical. The `−12` bar (signed; earlier raw draft used −11) separates it from ordinary sliders.
   HB bar is **slot-conditioned** — a low/sidearm slot manufactures 12+ HB from arm angle alone and
   would false-tag a plain slider; gap band 8–13.
3. **CUTTER — `ivb ≥ +5 AND gap ∈ [2, 7] AND armHB ≤ 2`.** A cutter is a fastball that cuts, so it
   must **retain ride (IVB ≥ +5)**; below +5 it is a hard slider and belongs in the slider room. The
   **+5 floor is HELD — do NOT loosen to +4** (loosening re-admits the top slice of the slider ride
   distribution, recreating the disease the reclass just cleaned; only a KNOWN true-cutter panel arm
   coming back mislabeled moves it, "a share preference isn't evidence"). `gap ∈ [2,7]` = fastball
   timing; `armHB ≤ 2` = glove-side/neutral cut (doc §PARTITION phrases this as "glove-side cut down
   to ~−6").
4. **4S FB / SINKER — the `rr = ivb − |armHB|` ±4 strip, `gap < 4`.**
   - `rr > +4` → **4S** (ride-dominant). A small glove-side cut at the fastball gap **stays 4S** and
     earns the `0.15·zAbs(armHB)` cut-ride reward (13% of the old "cutter" tag = gap-under-2 cut-ride
     four-seams route here).
   - `rr < −4` → **SINKER** (run-dominant, arm-side). True sinkers pulled out of the 4S bin get graded
     on arm-side run + drop instead of being double-penalized (scored on ride-heavy 4S criteria AND
     dragging the 4S baseline down). First cut: **~20% of tagged 4-seams are actually sinkers**
     (FA→79% 4S / 19% SI); 850 arms now carry both.
   - **Middle strip `[−4, +4]` → resolved by the pitcher's OWN fastball-cluster MEAN** (never
     per-pitch). Release-height is **tiebreaker ONLY** (demoted from primary). VAA/HAA is **RESERVED,
     not derived** — it becomes the strip tiebreaker only when local-TrackMan ships real per-pitch VAA
     off the venue-corrected layer; no derived-approximate VAA in any equation or boundary until then.
     As-built proxy: `rr ≥ 0 → 4S, else Sinker`.
5. **GYRO SLIDER — `|armHB| < 5 AND ivb ∈ [−4, +4]`.** The bullet: an axis-spinning pitch has no
   seam-shifted arm-side or glove-side component (`|armHB| < 5`) and near-neutral vertical (IVB ~0,
   incl. gravity-ball negatives). Originating intuition (Trevor): "**0 HB, −6 IVB = a dope gyro
   slider**" — that exemplar sits just BELOW the band, in the gyro↔curve blend strip (see §3). Golden:
   **no near-0-armHB cluster labels slider — a bullet is a gyro, not a slider.** 28% of SL-tagged
   pitches were really gyros — the single biggest hidden bucket.
6. **CHANGE-UP / SPLITTER — `armHB > 0` (arm-side), gap ~6–14.** Caught by **velo-separation from the
   pitcher's own fastball**, NOT the incoming TrackMan tag (TrackMan auto-tags any SLOW pitch
   "Change-up" and any hard one a fastball, regardless of shape). Change-up: spin held (`≥ ~1600`),
   arm-side fade, IVB typically positive. Splitter: killed spin (`< ~1400`), IVB `< ~3`, tumble. The
   CH equation scores `z(fb_ch_velo_diff)` (velo separation), NOT raw velo.
7. **SLIDER — else (glove-side/neutral residual, ivb < 5).** The residual glove-side breaking ball
   after gyro (near-0 armHB) and sweeper (armHB ≤ −12) are removed. Design band:
   `armHB ∈ [−11, −5], ivb ∈ [−5, +4]`. **The lazy "default to slider" catch is explicitly REMOVED** —
   boundary/low-confidence pitches route to nearest-centroid + exceptions log, never a silent slider default.

**CT/SL seam (adjacent, resolved inside arms 3 & 7 + arsenal tiebreaker §3):** the velo-gap valley was
**MEASURED at 7** (cutter gap p50 5.6 / p90 8.3; slider gap p50 9.4 / p10 6.8 → valley 7–8, line at 7).
The external review's guess of ~6 (and the 3.1/7.8 cluster centers) were priors Trevor "made up from
knowledge," retracted. Ride retention breaks the tie: `IVB ≥ +5 → cutter, IVB < +5 → slider`, then the
arsenal tiebreaker in the 6–8 band.

---

## 2. THE PER-PITCHER ALGORITHM (cluster-level; the locked architecture)

Classification is applied at the **cluster level per (pitcher × hand)** on the venue-corrected layer
(15,016 centroids → textbook-clean separation). Per-arm pipeline:

1. **BOUNDARY-SEED** — seed every pitch to its bucket via the §1 CASE order.
2. **MERGE** — agglomeratively merge a pitcher's seed-clusters that are one pitch split by a seam.
   Univariate delta rule (as-built): **`Δarmhb < 4  AND  Δivb < 3.5  AND  Δvelo < 2.5` → merge.**
   *(Historical/superseded: this univariate Δ-merge is the intermediate rule the anchor architecture
   explicitly RETIRES — recorded as the shipped distance, replaced conceptually by multivariate
   proximity-to-anchor. `movementDistance = √(dIVB² + dHB²)`.)*
3. **LABEL-BY-MEAN** — label each merged cluster by its **MEAN** vs the signed boundaries; all the
   cluster's pitches inherit that one label. This is what lets a seam-straddler collapse to one stable
   label while a genuine two-breaker stays split. (Restoring cluster-level from the per-pitch shortcut
   swung breaking +0.15.)
4. **ANCHOR FOLD** — build the arsenal from **ANCHORS** = clusters with real usage
   (**≥60 pitches OR ≥10% of the arm's mix**) that sit clearly separated in full movement space (close
   candidate anchors merge into one). Any **residual** cluster — low-usage OR within close multivariate
   proximity of an anchor — **folds into the nearest anchor and inherits its label** ("gravity toward
   the main pitch"). Folded pitches count into the anchor's totals so mix% reflects merged reality.
   - **FOLD GUARD (velo/gap family guard):** the candidate must be **plausibly the same pitch FAMILY**
     as the anchor — **near in VELO/GAP especially.** Same speed off the same fastball + near-identical
     sweep = one pitch varying its finish → fold. Same movement + different speed = two pitches → do
     NOT fold. Golden: an 80-pitch changeup never folds into a slider just because they sit close in
     raw movement.
   - **FAR-OUTLIER / SCORE-AND-FLAG:** a small cluster genuinely distant from EVERY anchor does NOT
     fold. It keeps its own nearest-centroid label (so it IS scored) + a **confidence/exceptions FLAG**
     (`needs_review`, queryable). Never held unlabeled (that would drop pitches from the run-value
     ledger and make mix% lie). The kid experimenting with a nascent pitch for 15 throws still gets seen.
5. **TIEBREAKERS** at the two ambiguous seams — see §3.
6. **SMALL-SAMPLE FALLBACK** — arms below the clustering threshold (**< ~150 pitches**; cluster only at
   ≥~150–300) skip per-pitcher clustering and take the **global boundary rules applied to the pitcher's
   per-cluster MEANS — never per-pitch.** Label still at cluster level.

**Implementation shape (staging):** anchor labels built as `_reclass_map` (pitcher×seed → label,
37,256) → materialized to `_reclass_result` (2.0M) → `UPDATE pitch_type_reclassified`, stamped
`classification_version = 'v1-anchor-2026-08-17'`. Backups before every destructive write
(`_ncaa_backup_preanchor`, `_master_stuff_backup`, `_confstats_backup`).

---

## 3. THE ARSENAL TIEBREAKERS

### CT/SL — binary + DECISIVE (not advisory)
In the **6–8 mph velo-gap band** around the measured valley of 7:
**a 2nd distinct breaking ball in the arsenal → CUTTER; the only breaking ball → SLIDER.**
Made decisive (was proposed advisory) because a gap-only line spills genuine 4.5–5.5-gap cutters into
the slider bucket — the arsenal (does he OWN a second breaker?) is the ground truth for whether an
86–88 hard breaker off a 92 FB is a cutter or a slider. Paired with the ride floor: `IVB ≥ +5 → cutter,
IVB < +5 → slider`, THEN arsenal tiebreaker for the band.

### Gyro / Curve — blend strip, gap decides
In the **`|armHB|` low, `IVB ∈ [−8, −4]` blend strip**:
`gap ≤ 8 → GYRO;  gap ≥ 10 → CURVE;  gap 8–10 → by cluster mean + arsenal.`
Hard bounds override: `IVB > −4 → gyro regardless of gap; IVB < −8 → curve regardless.`
Rationale: depth and sweep are both "break at curve velocity," so gyro-vs-curve is a velocity-gap
question, not a movement one — and the two curves stay ONE equation bucket (split only when one formula
would misgrade a legitimate shape; sliders needed it, curves don't). Trevor's `0-HB/−6-IVB` exemplar
lands exactly in this strip. Curve at −8 is strict: 43% of tagged "curves" fall to SL/SW/GY (slurvy
curves with IVB between −8 and −4) — flagged, judged defensible.

*(Status: neither tiebreaker is built in the current `reclassify_backfill.ts` ~85% rebuild — both are
listed as not-yet-implemented documented mechanics worth points. They exist in the design and in the
staging answer key, not yet in the reproduction script.)*

---

## 4. VALIDATION

The 20-arm human panel Trevor was to supply was **WAIVED** (he couldn't rattle 20 arms cold) and
replaced by a **4-check ground-truth lock gate**. Consistency (stability/coherence/mix) ≠ correctness —
a misplaced boundary passes every self-consistency check — so the primary gate is a COMPARATIVE
benchmark vs TrackMan.

**Gate checks:**
- **Check 1 — TrackMan within-season stability benchmark [MANDATORY primary].** Same **3,629 arms**,
  half-split, by family. Pre-registered STOP: if TrackMan ties or beats us anywhere.
- **Check 2 — archetype-pure auto-panel.** ~15–20 DB-queried center-of-mass arms (dead-center, far
  from seams). Expect 100%; any miss = hard bug. (16 IVB/11 armHB → 4S; 0/0 bullet at gap 8 → gyro;
  killed-spin tumbler → splitter; −10 IVB at gap 13 → curve; +16 armHB at gap 11 → sweeper — nine
  buckets.) **PASS.**
- **Check 3 — absurdity goldens (permanent).** no 0HB/0IVB→CB · no −IVB→4S · no <1400 spin→CH · no
  gap0→CB · no |armHB|≥12→GY · **no near-0-armHB cluster→slider (a bullet is a gyro).** **PASS after
  the fix the golden forced** (CB arm-side-deep steal → CB now requires `ivb≤−8 & armHB<4 & gap≥4`; the
  24 fastball-velo-depth anomalies route to REVIEW, never force-labeled).
- **Check 4 — low-confidence video check [the one human step, OUTSTANDING at lock].** 10
  lowest-confidence exceptions-log clusters + REVIEW anomalies (Gibler included), ~30 min on video.

**Check 1 progression (on record):**
| Stage | Overall | FB | Breaking | Offspeed |
|---|---|---|---|---|
| TrackMan baseline | 0.822 | 0.877 | 0.858 | 0.960 |
| Per-pitch shortcut (FAILED — STOP) | 0.834 | 0.911 | **0.816** | **0.929** |
| Cluster-level rebuild (WINS ALL 4) | 0.860 | 0.938 | 0.870 | 0.982 |
| **FINAL deployed (anchor + score-and-flag, flagged INCLUDED)** | **0.867** | **0.948** | **0.884** | **0.977** |

The per-pitch shortcut LOST breaking + offspeed and STOPPED the build — Check 1 catching a quiet
divergence from the locked cluster-then-label design, exactly as designed (2nd time pre-registration
caught a finish-line gap). **Honest deviation from the thesis:** the biggest edge is **FB / sinker
extraction (+0.072)**, NOT breaking (a narrow +0.026 win) — TrackMan's breaking tags were steadier than
the thesis assumed. Including flagged low-usage clusters pulls breaking from the +0.084 exclude-number
to +0.026 (they're inherently less stable half-to-half) — the honest shipping number, still wins everywhere.

**Match rates / other metrics:**
- First-cut FA→79% 4S / 19% SI; Slider splits 44/22/21 → SL/gyro/sweeper.
- FC settled at **3.6% and RULED correct** (of old cutter tag: 34% retained, 30%→SL `ivb<5` hard
  breakers, 13%→4S `gap<2` cut-ride). Cluster centroids textbook-distinct: gyro 0.6 armHB, slider 6.6,
  sweeper 14.
- Final league mix: **4S 37 / SI 16.5 / SL 14 / CH 9 / GY 6.4 / CB 5.7 / SW 5.6 / FC 3.6 / SPL 2.3%.**
- **NEW MONITORED GOLDEN — flagged-cluster share: baseline 6.86% of pitches; alert if it drifts UP
  across a season** (= anchor rules degrading; the number says so before the product does). (Earlier
  staging write stamped `needs_review=true` on 9.0% of 2,000,674 pitches.)

**Archetypes (Check 2 anchors, one per bucket):** 4S (16 IVB / 11 armHB), Sinker (low-slot arm-side
run), Cutter (86–88 glove-side cut off 92, ride retained), Gyro (0/0 bullet at gap 8), Slider
(glove-side −8 armHB), Sweeper (+16 armHB at gap 11), Curve (−10 IVB at gap 13), Change-up (arm-side
fade, spin held), Splitter (killed-spin tumbler).

**Two logged known-ambiguous archetypes** (documented tiebreaker, don't block the build): (a) 86–88
cutter-shaped hard slider off a 92 FB → arsenal tiebreaker; (b) low-slot sinker / 4S straddler →
fastball-cluster-mean on the ±4 strip, rel_height tiebreaker.

**Gibler acceptance case** (canonical validation of anchor+fold+gravity-ball): expected output one 4S,
one gyro (~387 pitches, gravity-ball flag = the anchor), one CH. His 290-pitch gyro is the anchor; the
97-pitch depth cluster sits within a whisker in every dimension except tilt → folds into the gyro → one
gyro ~387 pitches. One breaking ball → fold validated; two → tighten proximity. This is the outstanding
Check-4 item.

---

## 5. CONFIDENCE / GAPS — where the transcript was FIRM vs discussed vs SILENT

### FIRM (stated verbatim in transcript, dated)
- FA/SI split on `rr = IVB − |armHB|` with the ±4 strip; middle strip by fastball-cluster mean;
  release-height demoted to tiebreaker-only (2026-08-17T13:37).
- armHB convention + handedness audit passing (2026-08-17T15:41).
- Cutter +5 IVB floor HELD, do-not-loosen (2026-08-17T15:59, 13:37).
- CT/SL valley MEASURED at 7, band 6–8; review's 6 retracted (2026-08-17T15:41).
- Gyro Slider band `|armHB|<5 & IVB∈[−4,+4]` (2026-08-17T13:40 spec v1; 15:38 audit: 28% of sliders
  were gyros).
- Sweeper `armHB ≤ −12 & IVB∈[−2,+6]`, slot-conditioned (2026-08-17T13:40).
- Curveball base `IVB ≤ −8` at any gap, refined to `IVB≤−8 & armHB<4 & gap≥4` (spec v1 + Check-3 fix).
- Gyro/curve blend strip, gap decides (2026-08-17 ~L62490, ~L50774).
- CT/SL arsenal tiebreaker decisive; Gyro/curve arsenal-and-gap tiebreaker (2026-08-17 ~13:54, 15:38).
- Anchor architecture (≥60p OR ≥10%), fold guard, score-and-flag, 6.86% golden, all Check-1 numbers,
  Gibler case (2026-08-17 handoff-mirrored + 17:18).
- VAA reserved-not-derived (2026-08-17T15:33, 13:51).
- Change-up by velo-separation, splitter spin<1400 (2026-08-17T13:37, 22:32).

### DISCUSSED (reasoned in transcript but not a hard single-number lock)
- The "first cut for off-fastball pitches (gap ≳ 4): armHB>0 → offspeed, armHB≤0 → breaking" —
  discussed as the family separator; the as-built CASE order encodes it implicitly (offspeed arm at
  step 6, after breaking arms already claimed their pitches).
- The EARLIER Aug-16 committed v1 (raw unsigned hb, `reclassifyRHP`, `gyroCap = high-slot?6:3`, gyro
  `ivb≥−3 & hb∈[−7,7]`, sweeper `hb≤−11`) — recorded to flag number drift; **superseded** by the
  Aug-17 signed-armHB spec. Do NOT ship the Aug-16 numbers.
- Merge Δ params (`Δarmhb<4 & Δivb<3.5 & Δvelo<2.5`) — stated as the shipped intermediate rule but
  flagged as the one the anchor architecture retires conceptually.

### SILENT — derive from `_reclass_result` / not in transcript
- **Exact literal thresholds.** `pg_stat_statements` masked constants to `$N`; the in-DB v2 used TUNED
  values that differ from the design doc (documented spec numbers reproduce only 65%; fitted numbers
  83%; the widened `gap<4` gate 85%). The exact-to-100% numbers exist ONLY in `_reclass_result`.
- Exact fastball GATE width: doc/transcript imply `gap<2` for "small glove-side stays 4S"; the as-built
  widened it to `gap<4` (sinkers span gap 2–3; `gap<2` leaked them to Change-up; worth +5%). **FLAG.**
- Exact merge/fold distance bounds, the anchor "clearly separated" threshold, and the multivariate
  proximity radius — approximated by the current rebuild, not recovered literally.

### RECONCILIATION FLAGS — transcript/design-doc vs recovered as-built
1. **Fastball gap gate:** doc §THE PARTITION = fastball family "gap 0–3" and off-fastball first-cut at
   "gap ≳ 4" (implies fastball gate ~`gap<2`). **As-built = `gap < 4`** (widened; +5% accuracy). The
   design intent and the shipped code disagree on the gate width — resolve to the as-built `gap<4` for
   reproduction, but the design doc's `±4 strip resolved by fastball-cluster mean` is the correct
   target for the exact rebuild.
2. **FA/SI middle strip:** doc = resolve by the pitcher's fastball-cluster MEAN. **As-built proxy =
   per-pitch `rr≥0 ? 4S : Sinker`** — an approximation, not the mean-resolution. The merge+cluster-mean
   step (§2 step 3) partially restores the intended behavior.
3. **Cutter glove-side gate:** doc §PARTITION = "glove-side cut, armHB down to ~−6." **As-built adds
   `armHB ≤ 2`** (looser neutral gate). Line 51 of the handoff (`IVB≥+5 & gap∈[2,7]`) omits the armHB
   term entirely; the recovered rule includes `armHB ≤ 2`. Minor; both are glove-side/neutral.
4. **Evaluation order:** doc §PARTITION narrates fastball-family first; **recovered CASE order evaluates
   Curveball → Sweeper → Cutter → Fastball → Gyro → Offspeed → Slider.** The recovered order is
   authoritative for reproduction (breaking extremes claim first, slider is the residual).
5. **Arsenal tiebreakers + far-outlier score-and-flag** are in the design + the staging answer key but
   NOT in the current `reclassify_backfill.ts` (~85%) reproduction — the remaining points to chase.

### Top remaining per-pitch confusions in the ~85% rebuild (what a better fit must fix)
Sweeper→Slider (1112, armHB −8..−12 near-sweepers) · Gyro→Slider (588) · 4S↔Sinker (~650, boundary
noise) · Cutter→Slider (217) · Curveball→Slider (212, CB-refinement strictness).

---

## Cross-reference
- `HANDOFF_STUFF_PLUS_2026_08_16.md` — §"THE PARTITION" (design spec v1), line 51–53 (measured
  boundaries), §"REBUILT to the locked design", §"ANCHOR-BASED ARSENAL CONSTRUCTION", §"FULL FINAL
  EQUATIONS" + §"FOLDED FINAL EQUATIONS" (the 9 scoring buckets that pair with these labels).
- `STUFF_PLUS_RECLASS_HANDOFF_2026_08_28.md` — §"THE RULES AS BUILT" (recovered CASE order), §SHORTCOMINGS.
- `AGENT_LEARNINGS_stuff_plus_2026_08_16.md`, `STUFF_PLUS_RESUME_2026_08_17.md`.
- Answer key: staging `_reclass_result` (2.0M), `_reclass_map` (37,256), `_reclass_pf`.

## ★★★ 2026-08-28 — BREAKTHROUGH: the classifier is TWO-STAGE (coarse SEED → per-pitcher RESOLUTION). Recovered from `_reclass_map`.
This is WHY box-rule reconstruction plateaus ~87%: staging's classifier is NOT a per-pitch rule. `_reclass_map` (37,256 rows,
pitcher×seed→label) proves a two-stage process:
**STAGE 1 — coarse per-pitch SEED into 10 buckets** (NOT the 9 final types): `4S, SI, FBSTRIP, SL, SW, GY, CB, CH, SPL, FC`.
  The critical one WE NEVER HAD: **`FBSTRIP`** (4,597 seeds) = the ambiguous fastball rr∈[−4,+4] strip, held as its OWN bucket
  (this IS the "sinker vs 4-seam" mechanism). Per-seed totals: 4S 4559 · SI 3600 · FBSTRIP 4597 · SL 4659 · SW 3423 · GY 3932 ·
  CB 3260 · CH 4153 · SPL 2002 · FC 3071.
**STAGE 2 — per-pitcher cluster RESOLUTION overrides 23.4% of seeds** (28,534 stay / 8,722 override). Top overrides (seed→label,
  % of that seed): FBSTRIP→4S 71% · FBSTRIP→Sinker 28% · **SL→Gyro Slider 33%** · GY→Slider 19% · SI→4S 6% · SPL→Change 10% ·
  SL→Cutter 4% · FC→Gyro 6% · CH→Split 3% · 4S→Sinker 3% · FC→Slider 4% · CB→Change 4% · GY→Cutter 2% · SW→Curve 1%.
  needs_review = 48% of map rows (~9% pitch-weighted).
**IMPLICATION:** the label ≈ seed 77% of the time; the OTHER 23% (the overrides) are the per-pitcher cluster decisions our box
rules skip entirely — the two biggest being FBSTRIP→4S/Sinker (the FA/SI strip) and SL→Gyro (a THIRD of slider-seeds). To learn
the CORRECT forward process (Trevor: we never saved it + 100% need it): rebuild as SEED (10 buckets incl. FBSTRIP) → per-pitcher
cluster → RESOLVE, with the resolution rules reverse-engineered from `_reclass_map` + movement. NOT copying — learning the process
from the staging labels. Tool: `scripts/_map_transitions.ts`. This UPDATES `STUFF_PLUS_V2_CLASSIFIER_DESIGN_RECOVERED.md` §1/§2.

## ★★★ 2026-08-28 — DERIVED per-PITCH × HAND cluster-centroid RANGES (the definitive boundaries) + HANDEDNESS VERIFIED
Tool: `scripts/reclassify_v2.ts --derive --sample N` (runs seed+cluster, reads staging `_reclass_result` majority label per cluster).
**HANDEDNESS: VERIFIED CORRECT.** `armHB = (R?hb:−hb)` unifies hands — armHB ranges MATCH RHP vs LHP for every pitch while raw
hb flips sign (e.g. 4S: RHP rawHB≈+10 / LHP rawHB≈−10, both armHB≈+10). Classify on armHB, never raw hb.
**Cluster-centroid ranges [p5·p25·p50·p75·p95], armHB-normalized (hand-agnostic):**
- 4S FB:   rr[0·2·6·9·13]   armHB[3·7·10·12·15]  ivb[9·13·16·18·20]  gap≈0        velo[85·90·94]
- Sinker:  rr[−14·−8·−6·−3·0] armHB[6·14·16·18·20] ivb[2·7·10·12·14]  gap≈0
- Cutter:  rr[−3·4·6·8·14]  armHB[−8·−3·−2·0·3]  ivb[3·7·8·10·16]    gap[2·4·5·6·8]
- Gyro:    rr[−10·−4·−1·1·5] armHB[−6·−4·−3·−1·4] ivb[−4·−1·1·3·7]   gap[5·7·9·10·12]  (0-HB + NEG/neutral ivb; +ivb 0-HB = CUTTER)
- Slider:  rr[−13·−8·−5·−1·5] armHB[−11·−8·−6·−4·4] ivb[−5·−1·2·4·8]  gap[5·8·9·11·12]
- Sweeper: rr[−21·−18·−16·−13·−10] armHB[−18·−16·−14·−13·−12] ivb[−5·−3·−1·1·4] gap[8·10·11·12·15]
- Curve:   rr[−29·−25·−21·−17·−12] armHB[−17·−12·−10·−6·−2] ivb[−15·−12·−11·−9·−8] gap[9·13·17]
- Splitter: armHB[6·8·10·13·18] ivb[−3·3·5·8·12] gap[4·6·8·9·11] SPIN[906·1071·1247·1366·1599] (killed spin = the discriminant)
- Change:  armHB[6·11·13·15·18] ivb[−1·4·7·9·13] gap[5·6·8·9·12] spin[1508·1841·2267]
**KEY separators (with realistic BLEED, per Trevor):** 4S/Sinker = rr≈0 (medians +6/−6); Cutter = ride(ivb≥5)+small gap(2-7)+glove/neutral;
Splitter = spin<~1400; Sweeper = armHB≤−12; Gyro↔Slider GENUINELY OVERLAP (both armHB −11..+4) → ~−5 seam w/ bleed, do NOT force.
**LESSON (Trevor): set boundaries at each pitch's CORE (p25-p75), NOT the p95 tail — chasing tails (gyro ivb→+7, cutter gap→8)
steals from neighbors and REGRESSES. Bleed-over at the seams is realistic/fine.** v2 now 90.2% per-pitch / 91.0% arsenal-mix (honest diverse 120-pitcher sample).

## ★★★ 2026-08-28 — the process is a FEEDBACK LOOP: classify → SCORE → RECLASSIFY-with-scores (full arsenal). (Trevor)
Not a linear pipeline. `breakingBallReclassification.ts` row type carries BOTH `stuff_plus` AND `gyro_stuff_plus` (line 27) — every
breaking ball is scored as-is AND as-a-gyro. HANDOFF_STUFF_PLUS line 41: "final flip count re-runs post-boundary with velo-gap +
ARSENAL." So after Stuff+ runs, a **full-arsenal reclassification pass** flips borderline SEAM cases by which score is coherent +
the pitcher's arsenal — NOT by moving a movement boundary. This is what resolves the ~gyro↔slider (armHB≈−5) and 4S↔sinker bleeds
that box-rules structurally can't: e.g. a Slider cluster at armHB−5.1 → Gyro because its gyro_stuff_plus scores coherently.
The committed v1 has the HOOKS (two-score row, `consolidate()` 4-tier arsenal dedup, `rstr_reclassification_log`) but the actual
score-driven flip was scratchpad v2 (lost). **v2 classifier (reclassify_v2.ts, 91.5%) is the FIRST pass; the score-flip is a
SECOND pass that needs the scorer (stuff_plus + gyro_stuff_plus).** → this is why the Stuff+ cross-check matters: the scores feed
BACK into the labels. Build order: v2 classify → score both ways → arsenal reclassify borderline → final labels.

## ★★★ CORRECTION 2026-08-28 (supersedes the "3-STAGE FEEDBACK LOOP") — NO feedback loop. NO gyro_stuff_plus. LINEAR pipeline.
Trevor 2026-08-28: gyro does NOT need its own score. VERIFIED in `stuffPlusEngine.ts`: `calcGyroSlider` is the SINGLE gyro equation
(defined once, line 173; rewards negative IVB depth + HB-near-zero) and the unified "all pitches" Stuff+ scores gyros with it via a
plain pitch-type switch (line 305: `case "Gyro Slider": return calcGyroSlider(...)`). `gyro_stuff_plus` appears ONLY in the OLD
`breakingBallReclassification.ts` + CSV importer + schema type — the unified engine NEVER computes/reads it = scratchpad cruft, DROP it.
**The real architecture is LINEAR (not a feedback loop):**
  1. CLASSIFY by the derived RANGES → assign each pitch its label (`reclassify_v2.ts`, 91.5%).
  2. Run the FULL Stuff+ ONCE (`stuffPlusEngine.ts` `calculateStuffPlus` → switch by pitch_type → per-(type×hand) recenter → write `stuff_plus`).
  3. AGGREGATE over the full season (per pitcher rollup).
There is NO Stage-3 score-informed reclassification and NO scoring-a-pitch-as-a-gyro. The gyro/slider (and 4S/sinker) SEAM BLEED is
just accepted (labeled by the range boundary; genuinely-ambiguous clusters → `needs_review` → backfill/review). This SIMPLIFIES the
remaining build: wire v2 labels → stuffPlusEngine → aggregate. Ignore the "3-stage/gyro_stuff_plus" sections above — this correction wins.
