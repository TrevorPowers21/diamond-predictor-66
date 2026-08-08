# Agent learnings — Defensive Runs Engine (dRS) build + reconciliation (2026-08-03)

Captured for the **RSTR IQ dev agent** (memory `project_rstr_dev_agent`). Decisions,
corrections, and review methodology from the `feature/defensive-runs-engine` session:
reconciling a chat-authored dRS engine (`drs_engine_v0.1.0.zip`) against its own spec +
expected outputs. **Fold into `docs/knowledge/`**: mostly a new `defense-and-drs.md`,
some into `projections-and-scouting.md` and `review-and-parity.md` (both still-to-draft).

Record shape: **rule — why — scope — what it protects against.**
Full spec: `docs/DEFENSIVE_RUNS_ENGINE_SPEC.md`. Reconciliation: `docs/drs-reference/RECONCILIATION.md`.

## dRS domain model (→ defense-and-drs)

- **dRS = credit/debit accounting with EXPLICIT attribution parsed from `atbatDesc`, not
  inferred from hit geometry.** Every BIP: `xOut = 1 − xAVG` (spray-aware, confirmed);
  out → putout fielder earns `(1−xOut)×RUNS_PER_PLAY`, hit → responsible fielder(s)
  debited `share×xOut×RUNS_PER_PLAY`. *Why:* TruMedia's retrosheet event strings name
  who touched the ball; a UZR-style location model guesses. *Protects against:*
  mis-attributing a play to the wrong fielder.
- **The Standard export and the Pitch Log export are COMPLEMENTARY, not interchangeable.**
  Standard carries `atbatDesc` + fielder alignment + catcher throwing + `pPBWP%` +
  `xAVG`/`SprayAng` (populated); its Statcast tracking block (`hang/dist/react/speed/
  jump/wall/infieldDist/infieldTime/outProb`) is EMPTY. The Pitch Log export is the
  reverse. dRS v1 runs off Standard; the v2 native-xOut model needs Pitch Log joined on
  `uniqPitchId`. *Protects against:* assuming one export has everything, or feeding Pitch
  Log rows (no `atbatDesc`) into the event parser.
- **8 components, stored separately, summed for the headline.** Range/Error/DP/Arm +
  Framing/Blocking/Throwing (catchers)/Bunt. Errors kept OUT of range (hands-vs-range
  diagnostic). FC is credit-only, NEVER a range debit (locked). *Protects against:*
  blending a max-punishment error into a range signal and hiding a rangey-but-error-prone
  fielder.
- **Constants come from the D1 RE24 matrix, per-season frozen fixtures — the FIRST build
  task, because every run value depends on it.** Until then everything is stamped
  `constants_version = PLACEHOLDER_MLB_v0` in every output row. *Protects against:*
  shipping MLB-calibrated numbers as if they were D1-real. `fixture_quality=THIN` flags
  when the derivation set is < 2000 PA.

## Parity-review methodology (→ review-and-parity) — the transferable lesson

- **Parity ≠ correctness. A row-for-row diff against expected outputs that were generated
  by the SAME engine only proves determinism/reproducibility.** Real validation is Tier 3
  (season sanity + anchor eyeball vs staff consensus), which needs the full-season export.
  *Protects against:* "0 diffs, ship it" — the most dangerous false-confidence in a
  self-referential test harness. Say this out loud every time expected outputs are
  engine-generated.
- **Check per-component COVERAGE before trusting a green suite.** On the 3-game fixture:
  range 31/38, arm 9/38, catcher comps 3-4/38, error 2/38, bunt 2/38, **dp 0/38** (nets
  to exactly zero by construction). A component that's all-zero across the fixture is
  UNVALIDATED even though every assertion passed. *Protects against:* mistaking "the test
  passed" for "the component works."
- **When an invariant is proved analytically, still assert it on the actual accounting.**
  DP net-zero-at-league-rate → verified to machine zero (3.9e-16) with a synthetic unit,
  not just algebra. *Protects against:* an algebraic proof that the code doesn't actually
  implement.
- **Grep for calibration/routing mismatches between the fixture-derivation path and the
  live-routing path.** dRS bug: fixture counts DP opportunities with `ev.bb_type or
  bb_type_from_result(...)` (fallback), but the router's `is_dp_opp` uses `ev.bb_type=="G"`
  only. Agreed on the sample (all had explicit `/G`), diverges on a full season → the
  net-zero invariant breaks. *Protects against:* two code paths that must agree drifting
  silently — the same class of bug as the "precompute math duplicated in src/lib AND the
  precompute" rule.
- **Exact-string allowlists silently drop the unrecognized — route the miss to an
  exceptions log instead.** Framing counts only `{Ball, Strike Looking, Walk, Strikeout
  (Looking)}`; complete on this data, but a full-season label variant would vanish with no
  record. *Protects against:* silent sample loss that looks like "clean."
- **Heuristic stand-ins for missing source data are the softest numbers — label them.**
  Blocking infers WP/PB from runner advancement (real WP/PB codes = unresolved Open Item
  #4). Plus an operator-precedence latent bug (`A and B and C or D` groups as
  `(A and B and C) or D`, so one branch skips its guards). *Protects against:* trusting a
  guessed component as much as a measured one.

## Environment / running an external Python build (→ process)

- **The build targets Python 3.10+ (`X | None` unions); this machine has 3.9.6 only.** Ran
  a `from __future__ import annotations`-shimmed COPY in scratch (annotations → strings,
  zero logic change) rather than mutating the artifact under review or installing a new
  interpreter. *Protects against:* (a) editing the thing you're supposed to be diffing,
  (b) a heavyweight `brew install python` the user didn't ask for. Disclose the shim.
- **The engine is filename-agnostic (`run_drs.py` takes arbitrary paths); only the frozen
  TEST fixtures hardcode `Standard__1_.csv`/`__2_.csv` — and that's correct.** For the
  date-organized full upload, glob the directory. But `load_rows` needs two guards first:
  an `atbatDesc`-presence check (skip non-Standard exports) and a column guard (it crashes
  on `int(r["pitchNumInGame"])`/`gameId` if absent). *Protects against:* the mixed,
  date-organized dump breaking the ingest.

## dWAR + defensive-projection layer (→ defense-and-drs) — design-locked, build-blocked

Captured from the dWAR Conversion + Projection Addendum v1.0
(`docs/DWAR_CONVERSION_AND_PROJECTION_SPEC.md`). Blocked on the full-season import; the
locked design decisions the agent should carry:

- **Average is LEARNED, not assumed.** dRS does not self-center at zero — that only holds if
  xAVG is perfectly calibrated, and it isn't (validation showed league net range +6.55 /
  +2.91). Each position's average accrual rate is measured empirically from the full-season
  distribution, per position (SS accrues via range+DP, 1B via a narrow easy-chance set, C via
  framing volume). *Protects against:* trusting a theoretical zero-center and shipping a
  systematically biased baseline.
- **Empirical positional scales REPLACE the MLB positional-adjustment ladder — do NOT import
  external constants when you can derive from your own data.** The per-position empirical
  centering IS the positional adjustment. Same instinct as "constants come from the D1 RE24
  matrix, not MLB defaults." *Protects against:* importing MLB-calibrated numbers into a
  metal-bat/college-fielder environment.
- **Replacement applied EXACTLY ONCE across the WAR combiner (critical guardrail).** dWAR is
  built above positional replacement, so if oWAR (`src/savant/lib/war.ts`) already carries a
  replacement treatment, the combiner must not subtract it again. Encode as a unit test: a
  league-average player's total WAR equals the replacement gap exactly once. *Protects
  against:* silent double-counting of replacement between the offensive and defensive sides.
- **Rate denominator = responsibility OPPORTUNITIES, not innings.** Opportunities are the
  skill-rate unit (decontaminated from staff GB/FB profile); innings are only the
  projection-time volume unit. Project off the regressed rate (floor), never raw. *Protects
  against:* a transfer's rate being polluted by his old staff's batted-ball mix.
- **ONE bucket tag drives BOTH offensive PA and defensive innings projection — they can never
  disagree.** Shared cornerstone/everyday/platoon/depth/bench tag. Innings anchors are
  empirical, per position (catcher structurally differs — never share one innings number).
  Same no-drift principle as the shared-editor pattern. *Protects against:* a player projected
  as an everyday bat but a depth glove (or vice versa).
- **Each season measured against its OWN fixtures** (own RE24, own league rates, own constants
  stamp) for cross-season comparability; no-history players (FR/JUCO) get a hard-regressed
  position-average prior with a wide floor/ceiling (v1), cohort priors once two seasons exist
  (v2), coach-overridable in the GM workflow.

## RE24 derivation + season boundary (2026-08-04, → defense-and-drs)

Building the D1 RE24 matrix (spec §7, first real-numbers task) + the regular-season boundary.

- **RE24 = for each of 24 base-out states, mean runs scored from that state to the end of
  the half-inning, over COMPLETE half-innings only.** Data supports it: base state from
  `ManOnFirst/Second/Third`, outs from `outs` (state entering the PA), half-inning =
  (`gameId`, `inn`="Top/Bot N"), runs-per-play from the **`Runs`** column (validated: it's
  runs-scored-on-the-play, handles HR/error/WP without re-deriving). `Runs` beats
  `currentRuns`/`totalRuns` (those are running/aggregate scores). *Protects against:*
  hand-deriving HR/WP scoring and getting it wrong.
- **Completeness filter bug that BIASED the matrix:** `outs_recorded()` doesn't count a
  strikeout as an out (K has no movement token), so K-heavy innings looked like they never
  reached 3 outs and got dropped — 67% of half-innings excluded, disproportionately
  low-scoring ones → RE inflated. Fix: `outs_recorded(ev) + (1 if ev.event_type=="K")`.
  Skip rate dropped 67% → 6.6% (the real ~1-incomplete-per-game). *Protects against:* a
  silent selection bias that passes every "looks reasonable" eyeball (the matrix SHAPE was
  right the whole time; only the levels were inflated).
- **Sanity-check a derived matrix against a known reference + internal monotonicity.** D1
  RE24 landed ~1.5× MLB (hotter college run env, spec-predicted), every cell monotonic in
  runners↑ and outs↓, empty/0-out=0.75 → ~6.7 R/team/game (right D1 range). *Protects
  against:* shipping a plausible-but-wrong matrix. Also flag sample composition — TruMedia's
  tracked teams skew toward stronger programs, so it's "the tracked league," slightly above
  true all-D1.
- **Season boundary is a shared single-source config, not a hardcoded date.**
  `scripts/drs/drs_engine/season_config.py` (`is_regular_season(gameString)`) — WAR + DRS
  both read it so they can never disagree; mirror to a DB `season_config` row for TS/Python
  parity. **2026 reg season ends 2026-05-18 (Option A — conf tournaments + NCAA are
  postseason)**; projection is regular-season-only so a clean ~56-game WAR isn't
  postseason-inflated. See [[project_season_boundaries]]. Excluding postseason barely moved
  RE24 (it's structurally stable), but it matters a lot on the projection/accumulation side.
- **Constants (spec §7) derive from RE24 via empirical linear weights:** per PA,
  RV = RE(after) − RE(before) + runs; average by event type. RUNS_PER_PLAY = mean RV(hit) −
  mean RV(BIP out); DP/CS/SB/BASE fall out of the same pass; RUNS_PER_STRIKE needs a
  separate count-based (not base-out) pass. Present all 7 with MLB reference values for
  sanity-check BEFORE replacing PLACEHOLDER_MLB_v0 in the engine. (Derivation pending
  Trevor's go as of 2026-08-04.)

## Process note carried forward

- **Capture-then-confirm on a big multi-phase build.** The user said "remembered" + "we
  will need to build" — so the engine was spec'd, reconciled, and documented, but the
  production build (RE24 derivation, ingest hardening, the 4 fixes, wiring into the app)
  was NOT started without confirming scope/sequence — especially with the recruiting PR
  #160 still mid-promotion. (Reinforces `feedback_stop_and_talk_on_real_problems`.)

## 2026-08-04 discoveries (→ defense-and-drs + review-and-parity)

- **The RAW distribution is a diagnostic, not an output — read it before trusting anything.**
  Engine ranked every SS +25 and every LF −17 (a 42-run positional gap). *Why:* range hit-debits
  were attributed to the `hit_zone` RETRIEVER, not the responsible fielder — 73% of hits debited an
  OF, and 28% of those were ground balls that got through the infield (scored "S/7"). *Protects
  against:* laundering a structural attribution bug into the positional scales/dWAR. Every raw
  positional mean should be near-zero after centering; a large non-zero mean before centering is a
  red flag to trace, not a number to subtract.
- **Attribution can be wrong while magnitude is right.** xOut (how catchable) was correct; the
  *which-fielder* was wrong (retriever ≠ responsible). Fix = attribute by trajectory+spray:
  LA<10° → infield lane always (OF never touch a grounder, per UZR/DRS/OAA), air → OF lane;
  **calibrate spray→lane empirically from OUTS** (where the fielder is known), never guess the sign.
- **NEVER add a catchability floor to a symmetric credit/debit metric.** A floor (only charge if
  out-prob > X) lets you earn +0.91 robbing a 10% ball but pay nothing when 10% balls drop → the
  league stops netting to zero → breaks the telescoping cert, and creates a cliff. The tiny unfair
  charges were the *attribution* bug, not a missing gate. Debit every attributed ball at xOut scale.
- **Noise handling = visibility, not exclusion.** Infield line-drive defense is near-random
  (positioning luck, ~0 year-to-year repeatability), but removing/capping liners breaks symmetry.
  Instead decompose range into gb/ld/fb sub-buckets on the row and regress the noisy (liner) bucket
  hardest. Same numbers MLB trusts, luck labeled and visible to coaches.
- **Coverage bias is STRUCTURED, not random — check clustering, then disclose + filter.** 22% of
  BIP had no xAVG, bimodally by venue (98 parks ~0% tracked, clustered at resource-limited programs).
  Regression does NOT fix structured missingness (it's compression toward average, not noise). Fix:
  disclose per-player (`tracking_coverage` + a "compressed_to_avg" flag + a tracked-only rate as the
  unbiased projection read), and derive league scales from ≥80%-coverage players + a min-n guard.
- **Verify numeric claims against the matrix, not intuition — and own it when wrong.** Claimed the
  pure-full-cost error formulation gives ~0.964 per state; checking the RE24 matrix, it gives
  0.871/0.578/0.302 by out-state — never 0.964. Retracted immediately. (Same lesson as the parity
  telescoping: the internal, data-checkable claims are the trustworthy ones.)
- **dWAR from a single season is legitimate (within-season relative metric).** When no retroactive
  season exists, derive positional scales / replacement / runs-per-win from the current season
  itself — circularity is ~1/N per player (negligible); the retroactive season only bought
  cross-season absolute comparability + projection priors, both moot until a 2nd season.

## Design-system codification (→ new design-and-brand.md)

- **The shipped app's rendered appearance is canonical — codify it, don't redesign.** When asked to
  document/tokenize a design system, ratify what renders (zero visual change), don't impose the
  doc's aspiration. *Protects against:* an agent "fixing" the design to match a stale spec.
- **Verify a font/color is actually LOADED before trusting the doc.** MASTER.md claimed Oswald
  headings; Oswald was referenced 265× via `font-[Oswald]` but never `@import`ed → it always
  rendered as Inter. The doc was describing an intent that never shipped. Grep the loads
  (`@import`, `<link>`), not just the usages.
- **Screenshot verification is the safety mechanism for "zero visual change" — and this agent can't
  take browser screenshots.** For pixel-equivalence tasks, do the mechanical code/token/grep/vitest
  work but hand the visual sign-off back to the user (preview deploy); flag the limitation up front.

## Air-ball catch-probability surface (2026-08-04, engine v0.6.0)

- **A ratio-fix for the wrong metric can hide the real fix — replace the metric.** League-average
  xAVG credits catching a .910 liner at +0.91 even when the ball was hit right at the fielder
  (positioning luck, not skill). The tempting fixes (down-weight the bucket, regress liners hardest)
  only dampen a symptom. The real fix is a per-ball CATCH PROBABILITY: `P(out | distance-to-cover,
  hang)`. A liner AT the fielder is high-P(out) → credit ~0; a gap shot is low-P(out) → real credit.
  This also dissolves the "no catchability floor" debate: an uncatchable ball is far → P(out)~0 →
  debit~0 automatically, and a robbery → credit~1, with zero-sum intact.
- **You don't need per-play positioning to build OAA-style catch prob — average positioning washes
  out.** Distance-to-cover = ball landing point minus the fielder's REFERENCE position. Any constant
  offset in the reference just shifts the fitted surface and cancels (the surface is fit on
  distance-from-reference and scored the same way). So a consistent, handedness-correct reference is
  enough; exact positioning only sharpens it (true OAA).
- **Derive the reference positions from the data; the method must match the physics of each position.**
  Infield refs = median landing point of **sub-1.8s-hang putouts** (short hang = no reaction time = ball
  ~at the fielder's start) — handedness shading and the 1B hold-shift fall out correctly. That trick is
  **physically impossible for outfielders** (OF fly balls hang 3–5s; the season had <5 OF putouts under
  1.8s), so OF uses the **all-putout centroid** instead. Don't force one estimator across regimes that
  differ physically. MLB numbers are a sanity RAIL (shape check), never an input.
- **"Priced" is per-model, so the coverage gate is per-model.** Air balls are priced by the surface
  (needs hang+FBDst+spray, ~93–100%), NOT xAVG; grounders by xAVG (~78%). Gating air on xAVG would
  wrongly drop ~90% of untracked-park air balls the surface can price anyway. Switching air to the
  surface SHRINKS the untracked problem on purpose.
- **Zero-sum survives arbitrary attribution because it's per-cell.** Credit real catchers (actual
  putout fielder on outs) and nearest-by-reference on hits — different populations — yet within any
  surface cell Σcredit − Σdebit = outs·(1−p) − hits·p = 0 when p = outs/n. So a fitted-on-itself
  surface self-calibrates the air half to ~0 (the ground/xAVG half keeps its calibration gap, centered
  downstream). The zero-sum "guard" is a real regression assert: it went +5148 → −425 after the swap,
  cleanly split gb(−760)/air(+335).
- **Guard the measurement traps up front, measure them, document — don't discover later.** FBDst on a
  CAUGHT ball is the catch point, not the landing point, so outs read ~27ft shorter than hits at equal
  hang → the surface is mildly conservative on great running catches (measured, documented, livable).
  Deep flies truncate at the fence (15% of air balls ≥340ft) → flagged; the distance model
  self-mitigates (far balls get low P(out) → small debit) even without park dims.
- **Raw range SHOULD center to ~0 within a position — positional value lives elsewhere.** After the
  fix, every position's mean range ≈ 0 (an average SS making average SS plays nets 0) and the defensive
  spectrum shows up in the SPREAD (SS σ=5.1 ≫ 1B σ=2.2). Do NOT read near-zero means as "no positional
  difference" and do NOT force-center; the between-position VALUE is a separate, settable positional
  baseline in the dWAR layer ("average SS = X runs"). Confusing the two is a real modeling trap.
- **A module name can shadow a stdlib import silently.** `from . import field` clobbered dataclasses'
  `field`, breaking `field(default_factory=...)` with a cryptic "'module' object is not callable" at
  class-definition time. Alias domain modules (`import field as geom`) when the name collides with a
  common import.

## Baserunning wSB (2026-08-05)

- **A zero-sum "above-average" metric must condition its baseline on the same state its actuals
  live in.** Pricing steal expectation with a GLOBAL attempt/success rate × state-specific play
  value left a +98-run league residual, because runners pick their spots — attempts correlate with
  favorable base-out states, so the global rate under/over-counts per state. Making the baseline the
  EMPIRICAL mean realized value per opportunity, keyed by base-out state, forces exact per-state
  zero-sum (Σactual − n·mean = 0) → league sum +0.05. General rule: if "expected" is a rate × value
  and either varies by state while the actuals are state-specific, the covariance leaks; bucket by
  state and subtract the bucket mean.
- **Reuse the run-value spine across offense and defense, not the component code.** wSB lives on the
  offensive side but shares the dRS RE24 matrix + fixtures pattern + parser; steals, kills, and errors
  are all "RE delta of a base-out transition." One matrix, many components, each zero-sum against its
  own baseline — standard MLB architecture. Don't fork the pricing.
- **Add a cross-cutting param as optional-with-safe-default to avoid a call-site sweep.** Baserunning
  joins oWAR via `computeOWar(..., wsbRuns = 0)` — added to RAA before the single replacement term, so
  replacement stays applied once and every existing 2-arg call site is byte-unchanged until it opts in.

## wSB rebuild — the data-forensics PROCESS (2026-08-05)

The single most transferable thing from this whole arc is the *process* of discovering a
signal is lossy and finding the authoritative source. The sequence:

- **Internal consistency does NOT prove correctness — validate counts against an external
  ground truth early.** The first wSB engine passed every internal check (exact zero-sum,
  plausible leaders, sensible run-values) and was still wrong: it undercounted the national
  SB leader by 14% (57 vs the official 66). Zero-sum is invariant to *which* fielder/runner
  is charged and to a *uniform* undercount, so it can't catch systematic missingness. The
  moment a real external number existed (NCAA leaderboard), the gap was obvious. Get the
  external anchor before trusting a derived count.
- **A single derived flag is usually lossy — enumerate EVERY place the event is written
  down.** Steals lived in four different signals, none complete: `SBA/SB` flags (routine
  steals, ~90%), `atbatDesc` tokens (`K/S+SB3`, `CS2(24)` — only steals on a PA-ending
  pitch), `pitchResult "Pickoff CS"` (pickoff-CS, and only in the runner-centric export),
  and base-state transitions (everything, incl. steals of home). Assuming the first flag you
  find is authoritative is the trap.
- **Ground-truth-by-reconstruction is right but often contaminated — measure the
  contamination before trusting it.** Base-state transitions (a runner advancing a base
  mid-at-bat) reproduced the leader's 66 exactly, but league-wide they doubled the count
  (37k vs 18k) because wild-pitch/passed-ball advances look identical to steals and there is
  no clean WP/PB flag (the same reason the blocking model is a heuristic). A method that
  nails one hand-checked case can still be systematically broken at scale.
- **When the data genuinely can't disambiguate, find how the AUTHORITATIVE source does it —
  and copy that architecture.** Official stats providers track what the pitches show (~90%)
  and **override the total from the box score** for the untracked remainder. Proof was in the
  official file itself: its per-base breakdown (`SB2+SB3+SBH`) is exactly the pitch-tracked
  number and sits ~10% below its own headline `SB`. We independently arrived at the same
  two-file design — pitch log for run-*value* states, box score for *counts*.
- **Separate the COUNT problem from the VALUE problem; they need different sources.** Count
  is data-completeness (only the authoritative box score has all of it); value is modeling
  (only the pitch log has the base-out state). Trying to get both from one file is what
  forced all the failed heuristics.
- **Derive model parameters from CLEAN inputs even when you score on all inputs.** The
  per-base run VALUE was dragged down (steal-of-2nd +0.093 vs the true +0.154) by 13% of rows
  being double-steal front runners whose target base was occupied — a "move to an occupied
  base" that breaks the RE24 delta. Excluding those from the value *mean* (while still taking
  the *count* from the box score) fixed it. Filter the derivation set to the cases the math
  is valid for; don't let malformed states poison a league-average parameter.
- **The domain expert's instinct out-predicted the model — listen to it.** The user pointing
  at "steals of 3rd and double steals" located a real bug (the double-steal front runner was
  being dropped, +1,105 steals league-wide once fixed); the user's "maybe the providers use an
  override like we're planning" correctly named the final architecture before the data proved
  it. When someone who knows the data pushes back on a clean-looking result, dig again.
- **Own premature "validated" calls.** I declared the SB reading validated when the leader's
  regular-season 56 vs official 66 looked like the postseason boundary — the full-season check
  then showed only 1 postseason steal, so the gap was a counting/coverage issue, not the
  boundary. State the check you actually ran, not the one you hoped you ran.

## WAR calibration audit + composite (2026-08-05)

- **The one place an MLB number can hide is as an INPUT constant — audit for it.** oWAR/pWAR
  in war.ts hardcoded `runsPerPa=0.13, rPer9=5.5, runsPerWin=10, replacement=25` with zero
  derivation. Everything else in the system was measured from D1; these were transplanted
  MLB rules of thumb. Re-derived from the same 2.58M-pitch data (MLB as sanity rail only):
  runs/win 10→**13.1** (Pythagorean `2R`, R=6.54), runs/PA 0.13→**0.174** (105,473 runs ÷
  605,727 PA), runs/9 5.5→**6.76** (D1 R/9). If a constant has no provenance comment, treat
  it as suspect.
- **"Higher run environment favors pitching" is a real intuition and it's wrong — a run saved
  = a run created.** Provable via the Pythagorean derivative: `∂W/∂R = 1/(2R)` and
  `∂W/∂RA = −1/(2R)` at the average point — equal and opposite. The same identity gives
  `rpw = 2R`. So run-environment changes are a *uniform* rescale, not a hitting/pitching
  rebalance. The rebalance, if any, comes only from the run-VALUE constants being miscalibrated
  — which is a checkable bug, not a principle. (I got this wrong twice before deriving it: first
  claimed the effects "cancel" without proof, then guessed "pitching +15%" by scaling 5.5 by the
  full run-environment ratio. The correct pitching target is league R/9 (×1.23), which is a
  *smaller* rise than hitting's (×1.34) — so recalibration nudges hitting *up* vs pitching.)
- **Test recalibrations at realistic playing time, not textbook.** A college season is ~56 games,
  so a full-time hitter gets ~250 PA while an ace throws ~90-100 IP. Examples at 600 PA made top
  hitters look like 5.9 WAR; at 250 PA they land at ~2.6, which matched the user's real top-end
  (and explained why pitchers legitimately out-WAR hitters — IP volume, not a formula quirk).
- **Replacement is a fixed WIN level, not fixed runs.** Hardcoding replacement in runs (25) makes
  the average-player floor sag whenever runs/win changes. Express it as ~2.0 wins per 600 PA
  (→ `replacement_runs = 2.0 × rpw`) so the floor is stable across run-environment changes; a
  250-PA starter then lands ~0.83 WAR, a full 600-PA equivalent ~2.0.
- **The composite's job is to reshape, not just rescale.** ÷13 shrinks everyone ~7-24%; adding
  dWAR/bsrWAR then *redistributes* — glove/legs players rise, one-dimensional sluggers crater,
  the o-vs-p gap closes but pitchers stay higher. The rescale only feels fair once the new value
  axes are in.

## §8 dWAR — the engine already solved "no positional bonus" (2026-08-05)

- **An opportunity-neutral fielding metric puts positional value in the SPREAD, not the mean —
  so per-position averages come out ~0, and that's correct, not a bug.** The expectation was
  "SS average DRS ≈ +6.5 because SS get more chances." But the v0.6.0 catch-surface engine prices
  every ball on its own catch probability and is zero-sum, so an average SS making average SS
  plays nets ~0 — same as an average 1B. The opportunity didn't disappear; it shows up as a wider
  *spread* (SS range SD ~5.1 vs 1B ~2.2): a SS can separate himself far more, but the position's
  average is ~0. This means the FIELDING METRIC needs no per-position baseline — average SS and
  average 1B both net ~0 DRS, correctly, for free.
- **CRITICAL DISTINCTION (corrected 2026-08-05 — the first pass got this wrong): "the metric
  needs no positional baseline" is TRUE; "WAR needs no positional adjustment" is FALSE. Different
  claims.** MLB's positional adjustment was NEVER a fielding-spread correction — it prices
  SCARCITY (an average SS does a job almost nobody can fill; average 1B are abundant), and that
  value is invisible to ANY fielding metric, zero-sum or not, by construction. So the honest
  architecture is: **dWAR = DRS ÷ rpw with NO internal adjustment** (the opportunity-neutral metric
  handles the fielding-spread part), **PLUS an explicit, settable positional VALUE term at the WAR
  combine** (scarcity — eventually derivable from cross-position offensive gaps, which is how MLB
  derives theirs). Drop that term and roster valuations systematically favor corner sluggers over
  up-the-middle players — backwards from how any coach values a lineup (a 0.0-dWAR SS hitting .280
  and a 0.0-dWAR 1B hitting .280 are NOT equal). The trap is sliding from a true statement about
  the metric to a false one about WAR; keep them separate.
- **Defensive replacement is small.** Fielders vary in runs far less than hitters (a replacement
  fielder is only ~1-2 DRS below average), so the defensive share of the whole-player replacement
  is ~0.1-0.2 WAR; the bulk stays offensive.

## When NOT to build a positioning model — the infield/grounder case (2026-08-05)

- **A consistency upgrade is not automatically a signal upgrade — set an empirical bar before
  building.** The air-ball catch surface beat xAVG because xAVG was blind to the *decisive*
  variables — hang time and landing distance, the "right at him vs ranged for it" information.
  Grounders are different: a spray-conditioned xAVG on ground balls ALREADY is a catch probability
  under average positioning, because the league-wide spray-lane conversion rates were generated by
  infielders standing where they normally stand — the rocket in the 5.5 hole prices low, the ball
  at the SS's normal spot prices high, for exactly that reason. And EV is already in the model as
  the reaction-time proxy. There is no missing-variable analog. An infield surface built on an
  *approximated* crossing point (no measured landing coordinate, unknown bounce/deceleration) would
  be a NOISIER reconstruction of what xAVG already encodes cleanly — on the outfield the surface
  added signal; on the infield it mostly adds modeling error. Statcast's own history is the
  external check: outfield catch probability shipped years before infield OAA, and infield OAA
  waited for *measured* starting positions because reaction-scale plays make the average-positioning
  assumption proportionally much worse.
- **The rule: a positioning surface replaces a league-average model ONLY if it beats it on
  held-out calibration (Brier / log-loss on P(out)), never on philosophical consistency.** Keep
  grounders on xAVG until an infield surface clears that bar on measured data.
- **A downstream layer that is a pure function of an upstream one creates no sequencing lock.**
  "We must finalize DRS before wiring dWAR" was fake pressure: dWAR = DRS ÷ rpw with no adjustment
  layer, so a later DRS change is just a re-division, and the version stamps carry provenance.
  Don't let false sequencing pressure rush an upstream decision.

## Grounder calibration arc — three-function architecture + the discipline that caught SS −1,141 (2026-08-06, → defense-and-drs + review-and-parity)

The infield grounder ledger was net −2,363 runs (every position off zero, IF p90 ≈ 0). Fixing it
took a chain of diagnostics, and the *method* mattered more than any single fix.

**The process rule that carried the whole arc (→ review-and-parity):**
- **Pre-register the prediction — expectation + numeric tolerance + the GRAIN it's checked at —
  before the run exists.** Then the readout is a lookup, not a debate. Every step here had a written
  prediction first: ROE-test thresholds (within 0.5pp of 1 = confirmed; else FC-leak; else xAVG level),
  the 3B-boundary prediction (−22→−25 shrinks 3B but leaves it most-negative), per-chance-spread not
  raw-SD as the difficulty test, ±200/position as the acceptance band.
- **Choose the grain fine enough to expose redistribution.** After the g(xAVG,spray) calibration the
  LEAGUE sum went −2,363 → +40 and *zero looked like done* — but the defect had **redistributed onto
  shortstops (SS −1,141)**, not vanished. It was caught ONLY because acceptance criteria were written at
  **position grain, not league grain**. A league-grain check ships a −1.4 run/season phantom tax on
  every SS. Aggregate grain hides redistribution; go to the finest grain the bug can hide in.
- **Stop on surprise; never trade a named bug for an unnamed one.** A fix that makes the headline
  metric pass while moving the imbalance somewhere unnamed is not a fix. Every off-prediction number
  gets read against the record, not rationalized into "close enough."
- **Distinguish "correct by construction" from "empirical outcome" up front.** Post-fix per-position
  zero is an *empirical* result (credits individual, debits fractional), so it gets a tolerance band
  and a stop-and-read rule — not an assumed pass.

**The architecture that fell out — three functions, one question each (→ defense-and-drs):**
- **`g(xAVG, spray)` — how hard was it (PRICING).** Season-fit isotonic level correction (fixes the
  ROE convention xAVG carries: BA counts reached-on-error as an out, but our ledger excludes ROE, so
  xAVG over-predicts outs on the scored subset → −759 league) + 5° spray-region offsets (xAVG's own
  spray conditioning is thin at the pull extreme). Corrects the BALL's difficulty, never a fielder's.
- **reach-shares — whose ball was it (BLAME).** Fractional hit debits: a hit at spray s debits
  infielders by their empirical out-conversion share at s. Overlap zones are real (the 5.5 hole IS
  shared), so no hard lane boundary is right on both sides — it can only relocate the debt (moving
  −22→−25 traded a 3B bug for the SS one). Self-consistent: the same out-population that earns the
  credits defines who owes the debits. Away from seams, share → 100/0, reproducing prior behavior.
- **putout chains — who took it (CREDIT).** Individual, observed fact, untouched. The asymmetry
  (credit individual, blame probabilistic) is deliberate and is how UZR does it.

**The meta-lesson:** every bug in the arc was ONE function forced to do TWO jobs — xAVG carrying an
ROE convention it wasn't built for; one spray cut doing pricing AND responsibility; hard lanes
pretending overlap zones don't exist. Give each question its own empirically-derived, season-stamped,
provenance-guarded input and the objections dissolve. That's the "why it's built this way" paragraph
for any future auditor.

**Also relocated, not deleted:** P/C comebacker/dribbler fielding left the dWAR grounder pool (no hit
lane routes to P/C, so crediting them skimmed the zero-sum pool — +1,511 P / +60 C drained onto the
infield). Parked in a `pitcher_fielding` accumulator outside dWAR (raw xAVG·RPP, uncalibrated, so the
relocation conserves the pre-bake number bit-for-bit — an exact per-position conservation check, not a
fuzzy sum). May want a home on the pitcher side someday, like MLB DRS carries pitcher fielding.

**Provenance discipline:** `grounder_calibration.json` and `reach_shares.json` are SEASON FIXTURES
(properties of this year's xAVG against this year's population), stamped with season + constants_version
+ their own version; the engine REFUSES to run on a calibration whose constants_version drifted from the
engine's — mechanical enforcement that a stale calibration (next season's retrained xAVG) can't be
silently applied and recreate the ROE bug in reverse. Refit is a required step of season fixture derivation.

**Status at write time:** P/C exclusion + g(xAVG,spray) + −25 pricing boundary + fractional reach-share
debits are baked (engine v0.8.0, fixtures stamped). Acceptance test (all four IF positions within ±200,
per-chance 3B still widest, IF p90 positive) is IN PROGRESS — not recorded as confirmed until the run
lands and is read against the pre-registered band. Then: telescope re-cert (also proves fractional debits
conserve — shares sum to 1 per spray bin), goldens, staging.

## dRS SETTLED STATE — v0.11.0, ledger fully centered + composite staged (2026-08-06, → defense-and-drs)

The whole arc landed. What we settled on, after a LOT of energy proving each piece:

**The three-function grounder architecture (v0.8.0):** g(xAVG,spray) prices the ball (how hard),
reach-shares assign the blame (whose ball — fractional, RUN-weighted out-conversion share so credit
and debit distribute by the same measure), putout chains assign the credit (who took it, individual).
P/C comebacker fielding relocated OUT of the dWAR pool to `pitcher_fielding` (no hit lane routes to
them). Grounder xAVG recalibrated for the ROE convention (BA counts reached-on-error as an out; our
ledger excludes ROE) + spray-region offsets. Fixtures: grounder_calibration.json, reach_shares.json.

**Per-position centering as the UNIFORM rule (v0.10.0):** the deepest lesson. Four components in a
row (grounder pool skim, seam transfer, engagement blend, DP baseline) were all the SAME disease —
**league-centered but not position-centered.** The league sum was zero the entire time each
per-position bias existed, so the tripwire was at the wrong grain for four bugs. Fix the CLASS: every
component entering dWAR centers per position (dp per-position rate; range-air/arm/bunt de-meaned per
position by exposure; errors per position×trajectory with engagement = out-chain membership OR an E
charge, hands conditioned on REACH). Positional residue removed = market-layer info (scarcity, exiled
to market valuation on purpose). `check_position_grain.py` asserts per-position sums IN THE SUITE so
the class can't recur silently — that's the "finished ledger" in the strongest sense.

**Framing centered (v0.11.0), the last component:** 2-way catcher×park decomposition
(framing/chance ≈ catcher_skill + park_effect, alternating chance-weighted means, avg-catcher-skill=0)
removes the +970 model offset AND per-park TrackMan miscalibration; each catcher keeps park-free
vs-average skill. Elite framers stay (r=0.59 home/road says the skill travels). Park effects EMPIRICAL-
BAYES SHRUNK by visitor sample (K=σ²/τ²) — the unshrunk 2-way applies its noisiest estimates at full
strength on the least-identified (home/park-collinear) catchers; every other estimator shrinks by
sample, so this one must too. Naive "residual vs own baseline" is zero-sum per catcher and can't
remove the offset — that trap cost a cycle to avoid. Fixture: park_effects.json.

**Result:** telescope closes ALL the way down (drs_total → +8 blocking residual only) for the first
time. Positional hierarchy EMERGED unprogrammed and correct: C(framing) +3.3 > SS +1.3 > 2B/CF +0.7-1.1
> 3B +0.7-0.9 > RF/LF +0.4 > 1B +0.3 > P ~0. The regressed drs_floor mean tilts slightly + at
high-variance positions (SS +0.23) — CORRECT shrinkage (good SS play more, shrink less), NOT de-meaned:
the raw ledger is where zero-sum lives, the floor is where per-player honesty lives, and a population
of individually-honest estimates need not average to zero.

**Composite (hitter-side, TWP-safe):** d_war and bsr_war are HITTER-context (mirror twpMarketValue's
pickHitter/pickPitcher). Position player = o+d+bsr; pitcher = p (untouched); TWP = two slots. total_war
= o+p+d+bsr (aggregate, the sumTwp analog). d_war = Σ NON-P drs_floor / rpw. Currently on the INTERIM
÷10 scale (D1 ÷13.1 is a later push). Staged + verified on staging player_predictions.

**Process discipline that carried it (the transferable part):** pre-register predictions+tolerances
+GRAIN before every run; stop on surprise; never trade a named bug for an unnamed one; show the board
read-only before writing. "Zero looks like done" — league-grain acceptance would have shipped SS
−1,141 and four position biases. See [[feedback_predictions_on_record_at_right_grain]].

Commits: d8c7e03 (grounder), 7d0e2c3 (per-position class fix), e12699e (framing + EB). Versions stamped
+ constants_version stale-guarded on grounder_calibration/reach_shares fixtures.

## Composite WAR + the pitch-log migration (2026-08-06, → defense-and-drs + process)

The dRS/wSB output feeds a COMPOSITE WAR. Durable decisions (full plan: docs/HANDOFF-WAR-PITCHLOG-MIGRATION.md):

- **Columns:** `o_war` (bat), `d_war` (Σ NON-P drs_floor / rpw), `bsr_war` (wSB / rpw), `p_war` (pitch,
  UNCHANGED). **`total_hitter_war = o+d+bsr`** — renamed from a blended `total_war`. Side-specific NAME
  is the whole trick: a TWP fills it with its HITTER side, no blend, no NULL guard; pitcher side stays
  `p_war`. A blended `o+p+d+bsr` was rejected — it breaks the TWP 2-profiles/2-lines/2-market-values.
  No separate "TWP oWAR" exists: a TWP's hitter WAR is just `o_war`. Display swap: `o_war →
  total_hitter_war` where oWAR is the HEADLINE (keep raw `o_war` where it's the batting COMPONENT of a
  breakdown). Helpers `pickHitterWar`/`pickPitcherWar` mirror `pickHitter/PitcherMarketValue`.
- **dWAR/bsrWAR are DESTINATION-INVARIANT** (defense/legs don't translate program-to-program like
  oWAR does): same value on every prediction row for a player; only `o_war` varies. So a CENTRALIZED
  `refresh_composite_war()` (D1 bulk join, one ÷scale knob) populates the composite on ALL D1 rows —
  chosen over inline-per-generator to avoid the 7-copies sprawl.
- **Toggle reaction (defers to a later build-layer pass):** `bsr` scales with PA/opportunities (all
  tiers); `d` scales with defensive INNINGS which are FLAT across full-time tiers (everyday_starter ==
  cornerstone for D), stepping down only for part-time roles; `dev aggressiveness` touches neither.
  Position change → dWAR is position-specific (per-position rows exist in player_season_defense; a
  never-played position needs a positional projection). Default (prev role/position, dev=0) = last
  year's numbers unchanged, so the precompute is a no-op on the composite.
- **Write-path reality:** google-sheets-sync DEAD; createPredictionsFromMaster LEGACY (Master
  SUPERSEDED by the pitch log, kept as fallback/cross-check); JUCO precompute SEPARATE + master-based
  (D1 changes do NOT touch it). One D1 pitch-log precompute (`process-precompute-jobs`) is the path.
- **Push order (separate prod pushes, verify each):** 1) dRS/wSB + composite at ÷10 additive (oWAR/pWAR
  unchanged) + edge fn recurring; 2) ONLY 10→13.1 + the oWAR→total_hitter_war display swap; 3)
  big-export→pitch-log calc migration (powerRatings + edge fn); 4) TRANSFER-projection fallbacks
  (returners already have them); 5) finalize 2027 → improved market values (+ positional scarcity,
  exiled from dWAR, wired in the market layer). Pitch_log has 3,425 dupes by uniq_pitch_id to dedup on
  staging before prod (dRS unaffected — normalize.py dedupes).

## Push 1 staging execution + the pitch-log architecture correction (2026-08-06, → defense-and-drs + process)

Building + verifying Push 1 on staging surfaced one infrastructure bug and one architecture correction
that reshaped the whole pitch-log plan. Both are the durable kind.

**refresh_composite_war() timed out on the API path but not in the SQL editor — the classic split.**
The first draft rewrote all ~184k `player_predictions` rows every call. `select refresh_composite_war();`
SUCCEEDED in the dashboard SQL editor (long/no statement_timeout) but the identical call via
`supabase.rpc()` / the edge function FAILED with `57014 canceling statement due to statement timeout`
(PostgREST's short per-request timeout). The edge function caught it as non-fatal and logged it, so the
recurring composite silently never fired — looked deployed, did nothing. *Fix (two parts):* (1)
`SET statement_timeout = '180000'` on the function so a bulk maintenance UPDATE gets room; (2)
`WHERE ... IS DISTINCT FROM <computed>` so after the one-time populate a post-precompute run only
rewrites the rows whose `o_war` actually moved (one team ≈ hundreds), not a full-table rewrite —
dropped the rpc from timeout to ~710ms. *Protects against:* shipping a maintenance function that passes
every editor test and dies on the API path; and full-table churn on a metric that only changes per-team.
*General rule:* any DB function you'll call from an edge function / PostgREST must be tested THROUGH that
path (statement_timeout differs), and a whole-table UPDATE wants a change-guard so re-runs are cheap.

**The self-healing test is the way to prove a recurring wiring actually fires.** To confirm the edge
function's refresh call runs (not just that data already looks right), CORRUPT a detectable delta then
trigger the real path: null `total_hitter_war` on 12 rows across teams (NOT in the run's player scope) →
fire a one-player precompute through the deployed function → confirm the GLOBAL refresh healed all 12.
Because the refresh is global, healing rows outside the precompute's scope proves the refresh fired
independent of what the precompute computed. Restore staging integrity afterward (heal any leftover
nulls). *Protects against:* an idempotent re-run that can't distinguish "the function ran" from "nothing
needed changing." Verify-in-DB, and make the test detect the mechanism, not the end-state.

**PITCH-LOG ARCHITECTURE CORRECTION — the "DRS Pitch Log" export is ONE combined file, not two
complementary halves.** The earlier model (from the 3-game reconciliation: "Standard carries atbatDesc
+ alignment; Pitch Log carries the tracking block; they're complementary") was SUPERSEDED by the
full-season reality. The `docs/drs-reference/*.DRS Pitch Log.csv` files (30 files, full season, ~1.8GB)
are a SINGLE export with BOTH halves — attribution (`atbatDesc`, full fielder alignment
`FirstBaseman..RightFielder`, `ManOnFirst/Second/Third`, `SBA2/SBA3/SB2/SB3`, `pPBWP%`, `PopTime`,
catcher-throw `CTimeToBase/CThrowBase/CExchTime/DelivTime`, `Runs`) AND tracking (`HangTime`, `xAVG`,
`SprayAng`, `FBDst`, `ExitVel`, `LaunchAng`, `IVB`, `HB`, `Spin`, `pCallStrk%`). **This is THE pitch log**
and it is what the engine ran off (v0.11.0, full season) — so the current staging
`player_season_defense`/`baserunning` aggregates are built from the COMPLETE data and are FINAL, not
provisional. *Protects against:* carrying a small-fixture data-model assumption into the production plan
(the "two exports" belief nearly split Push 1 into a wrong sequence).

**Trevor's architecture (the intent behind the plan): ONE `pitch_log` table = the single source of
truth; ALL derived data (dRS/dWAR, bsrWAR, oWAR, power ratings) computes FROM it.** The CSV→Python path
is an interim mechanism — "the end result is all the same" because the numbers are identical whether the
engine reads a CSV or the table. Confirmed: the DB has exactly ONE pitch-log table (`pitch_log`,
2,579,655 rows) — no separate DRS table to consolidate. But the table currently stores only the TRACKING
half (`spray_ang`, `distance`, `x_avg`, `x_slg`, `x_woba`, `stuff_plus`, `exit_velocity`, `launch_angle`,
`ivb`, `spin`, `extension`, `rel_height/side`, `pitch_zone`, `cs_prob`); it is MISSING the attribution
half the engine consumes. So **Push 1's pitch-log component = widen, not reload** (Trevor: "add the
necessary columns to what is already there"): `ALTER TABLE pitch_log ADD COLUMN` the missing attribution
fields (`atbat_desc`, the 7 non-catcher fielder names, `man_on_first/second/third`, `sba2/sb2/sba3/sb3`,
`p_pbwp_pct`, `prob_sl`, `p_call_strk_pct`, `pop_time`, catcher-throw, `hang_time`, `fb_dst`, `runs`),
backfill from the drs-reference CSVs by `uniq_pitch_id`, then dedup to ONE row per `uniq_pitch_id` (the
3,425 dupes are overlapping date-window files, e.g. `5.13-5.15` ∩ `5.15-5.21` share 5/15 — "the pitch
still persists once, just not double-counted"). Rewiring the engine/edge-fn to READ the table directly
is Push 3, since numbers are identical either way — Push 1 only requires the complete data be IN the
table. *Protects against:* treating a column-widen as a risky reload, and re-deriving dWAR before the
single source actually holds what dWAR needs.

**TWO complementary pitch-log EXPORTS, not one — and the table was built from the other (danger).** Deeper
than the "one combined file" correction above: there are two DIFFERENT TruMedia exports, each with extra
columns the other lacks. (1) The "SprayAng+Distance re-export" (2026-06-24) loaded the `pitch_log` TABLE and
carries the pitch-SHAPE metrics `Extension`/`RelHeight`/`RelSide`/`PZNorm`/`PXNorm`/`xSLG`/`xWOBA` — but NO
attribution. (2) The "DRS Pitch Log" (drs-reference) carries attribution + `HangTime` + catcher-throw +
`pCallStrk%` — but NOT those 7 shape columns. So `ingest_pitch_log.ts` (which upserts the FULL `PitchLogRow`
on `uniq_pitch_id`) MUST NOT be re-run on the DRS export — it would NULL the shape columns the DRS file
lacks. The widen backfill is therefore ADDITIVE (update only the new attribution columns by `uniq_pitch_id`),
never a re-upsert. The permanent fix is a SINGLE combined export = DRS layout + the 7 shape columns; the full
canonical column→db map is `docs/PITCH_LOG_COMBINED_EXPORT_SPEC.md` (request it once, never merge two files
again). *Protects against:* a full-row upsert silently wiping columns absent from the file you're loading.

**Two column-mapping traps found by cross-checking the importer + a live row:** (a) db `distance` == `FBDst`
(verified value-for-value against the CSV), NOT the dead `dist` col — do not add a `fb_dst` duplicate. (b) db
`cs_prob` actually holds `probSL` (importer line 325 maps `probSL → cs_prob` — a mislabel; it's the framing
strike prob, already present) — do not add a `prob_sl` duplicate. Always diff proposed new columns against
BOTH the importer's field map AND a real row before ALTER.

**Dedup + UNIQUE(uniq_pitch_id) is the durable dupe fix (Trevor: "another safety check, perfect").** The
importer's `onConflict: "uniq_pitch_id"` REQUIRES a unique index. Backfill executes via path (a): batch-load
attribution into a temp table (`.env.local`), then a server-side `UPDATE pitch_log ... FROM tmp ... WHERE
uniq_pitch_id` (CLI is prod-linked, so writes go through the staging SQL editor or a driven rpc).

**UNIQUE(uniq_pitch_id) does NOT catch the real dupes — they're duplicate PHYSICAL pitches under DISTINCT
ids (2026-08-07, self-corrected).** I first concluded "3,425 dupes was a misdiagnosis, zero dups" because
`ADD CONSTRAINT UNIQUE(uniq_pitch_id)` SUCCEEDED (0 removed). WRONG — that only proves the *ids* are unique,
which was never the question. The 2026-08-04 analysis (`project_pitch_log_dedup_cleanup`) already said the
over-count is duplicate PHYSICAL pitches under *different* `uniq_pitch_id`s (overlapping window+residual
imports) + internal junk. Verified: game 260318618 has 658 rows in the table but only 269 in the clean DRS
export (~389 over-count), with malformed ids (`260318618-1-370` = at-bat 1 pitch 370, all-null data). So the
over-count is REAL and a UNIQUE-on-id constraint is orthogonal to it. *Lesson:* "can a UNIQUE constraint be
built?" answers "are the KEYS distinct?", NOT "are there duplicate real entities?" — don't let a passing
constraint talk you out of a correct prior analysis. Reconcile a surprising result against existing careful
findings BEFORE broadcasting a reversal (I over-claimed, then had to walk it back one message later).

**Silver lining — the attribution backfill is itself a clean dedup selector.** Backfilling additively from
the clean DRS export (one row per real pitch) sets `runs` (and the rest) on exactly the real pitches; the
~3,509 rows left with `runs IS NULL` are the un-attributed set. UNIQUE(uniq_pitch_id) is a separate safety
layer, not the over-count fix.

**The "over-count" is mostly a COVERAGE gap, not duplication — and it's an INHERENT tracking limit
(2026-08-07).** Drilling into the ~3,509 un-attributed rows: only ~829 are all-null junk/internal-dup (game
260318618-style, malformed ids, pitchers already captured elsewhere). The other ~2,680 are REAL pitches from
**79 pitchers on team-halves the DRS export never covered** (game 444179791: DRS has the Wisc-side 189, the
Iowa-side 265 real pitches are absent). Content-matched 0/265 against attributed rows (NOT duplicates), and
the 79 pitchers appear NOWHERE in the DRS export. **Test that settled it:** Trevor re-pulled the 4 affected
dates (Feb 17/24, Mar 3/4) in full DRS format → **0 of the 79 captured.** They exist only in the basic Pitch
Log layout (no fielder alignment), so they're UNTRACKED and dRS structurally cannot include them. *Lessons:*
(1) a row-count "over-count" can be a coverage DIFFERENCE between two exports, not duplication — content-match
before calling it dupes; (2) "certified 13454/13454" proves the aggregates match THE EXPORT, not that the
export is COMPLETE — keep those claims separate; (3) when the domain has structural coverage limits (college
≠ MLB TrackMan), quantify the gap, test whether it's recoverable, and if not, accept it explicitly rather
than chasing it. Here it was 0.14% of pitches, unrecoverable → accepted, not a Push-1 blocker.

**A >60s single SQL statement does NOT survive the Supabase editor's disconnect — batch it (2026-08-07).**
The monolithic 2.5M-row `UPDATE ... FROM` failed TWICE in the SQL editor: "Failed to fetch" at the ~60s
gateway timeout, then the whole atomic transaction rolled back — even with `set statement_timeout = 0`
(so it wasn't statement_timeout; the editor cancels the query when the browser connection drops). Discriminated
running-vs-dead via `pg_stat_activity` (no rows = dead) and a known-row probe (its value never flipped =
nothing committed). THE ROBUST PATTERN: a server-side batch function `fn(_after text, _lim int)` with
`set statement_timeout = 0` that updates a bounded `uniq_pitch_id` range and returns `(processed, last_id)`,
driven in a loop from a `.env.local` script (cursor = last_id until it stops advancing). 25k/call × ~105 calls,
each commits under the gateway timeout, fully observable (probe committed chunks mid-run). Same shape as the
`refresh_composite_war` statement_timeout fix, but here the killer was disconnect-cancel, not the timeout GUC —
so lifting the timeout alone is NOT enough; the work must be chunked into sub-60s committed units. *Protects
against:* silent multi-minute "is it running or dead?" mysteries and non-durable all-or-nothing bulk writes.

**Process notes worth keeping:** (a) When challenged ("we need the pitch log to accurately do player
season defense, correct?") I INVESTIGATED the data flow (read normalize.py's input contract, probed the
table columns) instead of defending the "A is independent" framing — the domain expert's push located a
real gap in my model. (b) The engine now runs on this machine's Python 3.9.6 AS-IS (core files carry
`from __future__ import annotations`; no shim dance) — full-season re-run is `find docs/drs-reference
-name "*DRS Pitch Log.csv" -print0 | xargs -0 python3 scripts/drs/run_drs.py`, gated to only the DRS
Pitch Log files so the Standard fixtures + SBA files don't contaminate it. (c) PostgREST table-existence
probe: a missing table returns `error.code = PGRST205`, NOT a null count with no error — check the code,
don't infer existence from a head-count. (d) Destination-invariance shows up as an un-deduped
`total_hitter_war` leaderboard stacking ONE player's transfer-destination rows (d/bsr identical, only
o_war varies) — correct stored data, needs per-player dedupe for display.

## PUSH 1 SHIPPED TO PROD — execution + provenance (2026-08-07, → defense-and-drs + process)

Push 1 (dRS/wSB + composite at ÷10 additive) is LIVE + verified on prod, and the code is on `main`
(`feature/defensive-runs-engine` → `staging` #169 → `main` #170). Durable lessons from the prod push:

- **Aggregates are CALCULATED into each env, never COPIED — staging and prod player UUIDs DIFFER.**
  `player_season_defense`/`baserunning` are keyed on `players.id` (uuid), and the same `source_player_id`
  maps to a DIFFERENT uuid on staging vs prod (verified: fec2e47f≠9786e452). So a staging→prod table copy
  would inject uuids that don't exist in prod's `players` → broken FKs / wrong players. The right path is
  `load-drs-wsb-prod.ts` (a prod-pointed clone of the staging loader): read the engine-output CSVs (keyed on
  `source_player_id`), resolve to PROD's own uuids, upsert. Trevor caught this when I first proposed a copy —
  "are we sure it's a copy or are we uploading the same way?" *Protects against:* cross-env uuid corruption,
  and the subtler "prod just mirrors staging" anti-pattern. dRS→dWAR and wSB→bsrWAR ARE computed on prod
  (`refresh_composite_war`); only the pitch_log→DRS-components step is still offline (Push 3 rewires it).
- **"Calculated, not copied" is Trevor's hard requirement — prod must be able to take in the pitch log and
  produce accurate defensive metrics, not depend on staging.** So Push 1 also loads the COMPLETE DRS pitch
  log into the prod `pitch_log` table (the widen), making it the source the aggregates rest on; Push 3 makes
  the engine read that table so prod is fully self-sufficient (no offline CSV run). Same widen process as
  staging: ALTER add attribution cols → temp table → `.env.production.local` loader → batched
  `backfill_pitch_log_attr_batch` driver (25k/call, ~105 calls) → dedup + UNIQUE. Prod matched staging
  EXACTLY (with_atbat 685,942 / with_shortstop 2,575,699 / with_hangtime 325,017 / with_runs 2,576,146).
- **Prod ownership gotcha: `ALTER TABLE` inside a service-role rpc fails `must be owner of table`.** `pl_finish`
  ran fine on staging (service role had rights) but on prod the service-role-invoked function can't ALTER
  `pitch_log` — run the dedup + `ADD CONSTRAINT UNIQUE` directly in the SQL editor (owner), or make the
  function `SECURITY DEFINER`. The function is atomic, so the failed call changed nothing. *Protects against:*
  assuming staging grants == prod grants.
- **Cross-env VERIFICATION is a per-player checksum, not a vibe.** Confirmed prod ≡ staging by matching
  `d_war`/`bsr_war` per `source_player_id`: 5,093 defense + 10,406 baserunning IDENTICAL, 0 differ; Σdrs_floor
  721.819 vs 721.814 (the 0.005 = 11 unresolved defensive-only residuals). Say "matches" only with the diff.
- **Additive-first sequencing let the composite ship + preview-test WITHOUT any display risk.** Push 1 adds
  `d_war`/`bsr_war`/`total_hitter_war` and populates them, but `oWAR`/`pWAR`/`market_value` and every DISPLAY
  are untouched — the `o_war→total_hitter_war` swap is Push 2. So merging the code is a "no rendered change"
  event, verified by inspecting the actual frontend diff (war.ts = constant-extraction refactor with UNCHANGED
  values; savant components = same hex colors moved to shared imports; new tailwind tokens used by 0
  components). The Vercel PREVIEW points at PROD Supabase, so the composite is testable pre-merge.
- **Git flow is feature → staging → main, NEVER feature → main (corrected mid-push).** I opened the PR straight
  to main; Trevor: "we need to push this branch from feature to staging." Re-targeted the PR base to `staging`
  (feature→staging), merged, then a `staging→main` PR for the promotion (Trevor drives the final merge). Also:
  `staging` reads "N behind main" purely from staging→main MERGE COMMITS that live only on main — cosmetic, no
  missing code; it self-heals when the next feature branch (which merged main in) lands on staging.
- **Edge-fn deploy is separate from the git merge and must follow the schema.** Deployed with an explicit
  `--project-ref trbvxuoliwrfowibatkm`, target verified in the output. Deployed AFTER the prod migrations so
  the composite function/columns exist (the fn's `refresh_composite_war()` call is non-fatal either way). Did
  NOT trigger precomputes on prod — Trevor: "don't run all of it, just what's necessary to add; we run the
  precomputes on our next branch." So the recurring composite refresh activates when Push 2 re-precomputes.

**Push 2 is planned + documented** (`docs/PUSH2_RECALIBRATION_PLAN.md`): centralize the 7 copy-pasted oWAR
formulas (+ reconcile the edge-fn vs war.ts pWAR-constant divergence — 7.11/1.5 vs 5.5/2.5 → one D1 set) →
flip `RUNS_PER_WIN 10→13.1` etc. + `refresh_composite_war` `/10→/13.1` → `o_war→total_hitter_war` display
swap (`pickHitterWar`/`pickPitcherWar`) → re-precompute → reseed `team_war_snapshots` → repoint market value
at total WAR. Push 3 = engine computes aggregates FROM the pitch_log table (self-sufficiency). Deferred:
Playwright e2e harness (Supabase auth fixture + smoke spec).

## Combined recalibration + pitch-log accrual plan — LOCKED decisions (2026-08-08, → process + defense-and-drs)

Full plan: `docs/COMBINED_RECALIBRATION_PITCHLOG_PLAN.md`. After Push 1 shipped, Trevor chose to fold Push
2/3/5 into ONE staging-buttoned effort → ONE prod push (players move once), because usage is low now and the
dWAR/bsrWAR addition gives narrative cover for WAR moving. Snapshot BETWEEN staging stages for a per-change
impact report without three prod pushes. Durable decisions + corrections:

- **DATA MODEL CORRECTION (audited, do NOT trust "players holds stats"):** `players` = identity/roster +
  playing-time counts (`pa/ab/ip/g/gs`) + portal — NO rate stats, NO season col, NO power ratings. The season
  STAT LINE + power ratings live in **`Hitter Master`** (AVG/OBP/SLG/ISO + sub-metrics + `*_power_rating` +
  blended, has `Season`) and **`Pitching Master`** (IP/ERA/FIP/WHIP/K9/BB9/HR9 + `*_pr_plus` + `stuff_plus` +
  blended, has `Season`). `player_predictions.from_*` = the projection base (loaded from the Masters);
  `player_prediction_internals` = per-prediction power ratings. The projection engine reads `Pitching Master`
  for pitchers + the players/Master hitter path — it was NEVER re-run through pitch-log data (Trevor held it to
  avoid shifting numbers mid-portal-season).
- **STORE = OVERWRITE the Masters with pitch-log-derived values (Trevor).** No new `player_season_stats` table
  ("overwrite and cross check, not new data, unnecessary"). Cross-check DURING the run (pitch-log vs current
  Master), validate, overwrite. Pitch log = source of truth for ALL data — season stats AND power-rating
  sub-metrics; the Master export stays the conceptual cross-check rail (SB-count pattern) but isn't persisted
  in parallel.
- **pWAR: ONLY `RUNS_PER_WIN` 10→13.1 (Trevor).** Do NOT change `pwar_r_per_9` (7.11), `pwar_replacement_runs_per_9`
  (1.5), or anything else on the pitcher side — the earlier "reconcile the edge-fn vs war.ts pWAR divergence"
  is DROPPED. oWAR gets the full D1 recalibration; pWAR is rpw-only.
- **ERA from the pitch log needs REAL inning/run reconstruction, not an outs total (Trevor).** Recognize
  inning start/end, apply earned/unearned RULES (a run is unearned iff it only scored because of a charged
  error — replay the inning without the error), and use the SCORE data (`current_runs`/`total_runs`/
  `opponent_runs` + the per-play `runs` backfilled) to know exactly when + how much scored. The dRS error
  attribution makes this buildable now (was the hard part). FEASIBILITY-FIRST — prove it on a sample; hybrid
  fallback = Master ERA if noisy.
- **The inning/score reconstruction is a MULTIPLIER — capture TEAM metrics in the same pass (Trevor):** team
  offense from W/L, home/road record + splits, conference-vs-conference games, and PARK-specific stats (esp.
  valuable — park-factor build is internal here). Not required for ERA but cheap alongside it; scope into the
  reconstruction design. (Conf-vs-conf rationale: not needed now.)
- **FUTURE data cleanup (noted, deferred):** consolidate toward ONE players table + ONE player_predictions
  table — fold the Hitter/Pitching Master stat columns into the unified model instead of separate Master tables.
- **PROCESS:** Trevor: "continue to save all this into md documents so when we compact, none of it is lost,
  and save it all into the agent information." → this doc + `COMBINED_RECALIBRATION_PITCHLOG_PLAN.md` are the
  durable record; keep appending decisions as they're made.

**Before/after snapshot for the whole jump:** `docs/snapshots/prod_player_predictions_baseline_2026-08-07_pre-push2.csv`
(31,367 baseline rows) + full-table `player_predictions_snap_2026_08_07` on prod/staging. Diff after the one
big re-precompute → the complete before/after.

## ERA-from-pitch-log feasibility — CONFIRMED, earned/unearned is pre-encoded (2026-08-08)
Probed a full game's pitch_log: all 18 half-innings present, `inn`/`outs`/`runs`/`pitcher_id` at 350/350
coverage. KEY: TruMedia already tags **unearned runs `(UR)`** inside `atbat_desc` movement tokens (e.g.
`S/7(RBI).3-H(UR);1-2` = a run that scored unearned) and **errors as `E<pos>`** (e.g. `E6.1-3`). The dRS
parser already tokenizes these strings. So ERA does NOT need a from-scratch inning replay + earned/unearned
rules engine — it's: earned runs = scored movements to `H` WITHOUT `(UR)`, attributed to the pitcher on the
mound, ÷ IP×9. The one part Trevor flagged as hard (earned/unearned) is essentially pre-solved by the
notation; the build is tallying tokens the parser already reads. Still validate the totals vs Pitching Master.
