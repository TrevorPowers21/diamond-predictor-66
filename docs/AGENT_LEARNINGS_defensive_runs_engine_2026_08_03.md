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
