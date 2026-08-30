# Transfer Projection Engine — Audit + Directives (2026-08-13)
> ⚠️ **STUFF+ CONTENT IN THIS FILE IS SUPERSEDED — see `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md` (2026-08-30).**
> The rest of this document may still be valid; only its Stuff+/reclassification statements are out of date:
> • **LIVE lane = pitch_log**: `pitch_type_reclassified` → `compute_pitch_log_stuff_plus.ts` → `pitch_log.stuff_plus`
>   → `aggregate_pitch_log_dimensions.ts` → totals/by_pitch_type. ⛔ `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline`
>   → `legacy_rollupStuffPlusToMaster` is **LEGACY** (≤2025 + JUCO only) and scores **left-handers BACKWARDS** on 2026.
> • Classifier = `src/savant/lib/stuffPlusClassifierV2.ts` @ **95.2% per-pitch / 95.3% arsenal-mix**. Any 92.6% / 94.3% /
>   95.1% / "~85%" figure here is superseded.
> • `breakingBallReclassification.ts` → renamed **`legacy_breakingBallReclassification.ts`**; `rollupStuffPlusToMaster.ts`
>   → **`legacy_rollupStuffPlusToMaster.ts`**. DELETED: `reclassify_pitch_log.ts`, `_run_reclassify_{bare,chunked}.ts`,
>   `_reclass_rollout.ts`, `ReclassificationRunner/StuffPlusRunner/StuffPlusRollupRunner.tsx` (+ npm `reclassify-pitch-log*`,
>   `recompute-stuff:prod`, `recompute-stuff-scoped:prod`). `reclassify_anchor_prod.ts` never existed — it is `reclassify_prod.ts`.
> • Step 4 on PROD **must** use `--direct` (gateway cuts at ~125s; `vs_top_hitters` needs 253s).


Deep trace of the hitter + pitcher TRANSFER projection engine, with Trevor's decisions. Companion to
`AGENT_LEARNINGS_step7b_war_display_audit_2026_08_13.md`. **Operating principle (Trevor): improvements got built
OVER old code without deleting it — "it works but there's discrepancy on what's actually used." For every item:
trace the ACTIVE path in current code, DELETE dead, and bring the edge fn UP TO the canonical. Do not relay old code.**

A transfer = a player projected AT A DESTINATION TEAM (different conference / park / competition level). The value of
the whole product is projecting across competition levels.

---

## THE EQUATION (shared 7-step skeleton, both sides)
1. **Source rates + power ratings** from the Master (`*_power_rating` hitter / `*_pr_plus` pitcher; collapse-repointed
   to Master by source_player_id, 2026-08-12).
2. **Power blend** — 70% scouting PR+ / 30% raw last-year rate (D1 default `t_*_power_weight=0.70`); **0% for JUCO/D2**
   (raw verbatim + `applyJucoOutlierRegression` pull-to-mean).
3. **Competition/environment translation** (THE core value) — 3 multiplicative deltas vs destination:
   - conference level (avg/obp/iso_plus), **opposing-side quality**, park (K9 + JUCO skip park).
   - **Hitter opposing = destination pitching Stuff+** (weight ~1.0 = ~3× conference weight; the "tested vs weak
     competition" lever). **Pitcher opposing = destination hitter talent** `HTP = OverallPowerRating +
     1.25×(Stuff+−100) + 0.75×(100−wRC+)` (`precompute-pitchers.ts:174`) — "how good are the hitters he'll face,"
     balanced so it isn't inflated by a high-run environment or weak pitching.
4. **Class-transition + dev-aggressiveness** — `× (1 + class% + devAgg×0.06)` (JUCO source → 0).
5. **Depth role** from last-season ACTUAL PA/IP → a discrete tier of opportunities (PA hitters / IP pitchers).
6. **WAR** = (rate index − 100)/100 × opportunities × runs/9 + replacement, ÷ **13.1 (RPW)**.
7. **Market** = WAR × $25k × destination conference tier.

**Rate indices (data-backed, locked):** hitter wRC+ C1 (OBP .691 + SLG .235, intercept .011); pitcher pRV+ = D1-FIP
`3.847 − 0.231·K9 + 0.509·BB9 + 1.486·HR9`, ×1.137 (E2T), indexed to lgRA9 6.913.
**WAR:** hitter oWAR = ((wRC+−100)/100·PA·0.3994 + 21.22·PA/600)/13.1, + d_war + bsr_war = total; pitcher pWAR =
((pRV+−100)/100·IP/9·6.915 + 1.92·IP/9)/13.1.
**Market:** hitter = **total_hitter_war** × $25k × tier × **position PVM**; pitcher = **p_war** × $25k × tier, **NO PVF**
(SP value already in IP — don't double-count).

## DIVERGENCES hitter vs pitcher (Trevor's recurring "one side neglected" risk)
- Different scripts: hitter `precompute-transfer-projections.ts`; pitcher `precompute-pitchers.ts`. **Both must run on
  the edge fn** and fold into the ONE unified upload→display process (automatic from pitch logs, Track B).
- Opposing-quality term: pitching Stuff+ (hitter) vs hitter HTP (pitcher).
- Pitcher has SP↔RP **role-transition** adjustment + starter-regression boost; hitter depth role only sets PA.
- Market: hitter total+PVM; pitcher p_war, no PVF.

---

## THE 3-COPIES DRIFT (the real problem — canonical / Deno edge fn / TB live hook)
Same math exists in THREE independently-maintained implementations; they've drifted. **Directive: collapse toward ONE
(the unified edge fn), and until then bring the edge fn to canonical.**

### EDGE-FN SYNC LIST (bring edge fn `process-precompute-jobs` up to canonical `src/lib/*`)
- ✅ CONFIRMED **pitcher PVF bug**: canonical `depthRoles.ts:267` `void ctx.role` (no PVF); edge fn `index.ts:672-673`
  still `× pvfForRole(role)` → SP transfer market ~20% high. **Fix: remove PVF from edge fn** (Trevor: SP value already
  in IP). "Should have fixed that, never updated the edge fn."
- **Hitter market → total_hitter_war × PVM** (7a) — confirm edge fn matches (d/bsr addition present but marked UNTESTED).
- **Pitcher market → p_war × $/WAR × tier (no PVF)** — per above.
- **Rate index (pRV+ D1-FIP, wRC+ C1)** — confirm edge fn uses the current formulas, not a stale composite.
- **lgRA9 cleanup**: `pitcherQuality.ts:30` 6.913 (pRV+) vs `pitchingEquations.ts:239` 6.915 (pWAR). Make identical
  (minor, but should be consistent).

### VERIFY ACTIVE vs DEAD (trace liveness, delete dead — do NOT trust grep alone)
- ✅ **Triple-oWAR CONFIRMED dead**: `computeTransferProjection`'s internal `owar` (`transferProjection.ts:124`,
  `actualPa??260`) read by NOTHING; stored oWAR = `computeHitterOWar(...depthRole)` (`precompute-transfer-projections.ts:384`).
  **DELETE the 260-PA owar** (+ the mirror in applyTransferPostprocess if likewise dead). Depth-role version is supreme.
- **TB live toggle behavior (INTENDED, per Trevor):** when a coach moves a toggle, ALL of it recomputes LIVE for
  display — rates AND pWAR/oWAR AND market — so the coach sees it immediately; once SAVED it defaults to
  no-live-compute and reads the player/transfer snapshot. This must be the SAME for hitters and pitchers. The agent
  flagged "TB pitcher preview shows adjusted pRV+ but un-adjusted pWAR/$" — **likely OLD code built over; verify the
  ACTIVE dirty-row path recomputes WAR+market live on BOTH sides, and delete whatever stale branch doesn't.**
- **TWP (Trevor — DO NOT overcomplicate):** the display already reads `is_twp` and redirects to
  `twp_hitter_market_value` / `twp_pitcher_market_value`; stats are self-explanatory, no bleed, oWAR/pWAR separately
  labeled. **The ONLY 7b change for TWP = add total_hitter_war like every other player + redirect the oWAR read to
  total_hitter_war. Nothing else.** (Re-examine whether the "batch script doesn't route TWP market" is even the active
  path or dead — the display handles the split regardless.)

### BUCKET 3 — Stuff+ / HTP competition-translation levers — INVESTIGATED 2026-08-13

**Derivation (verified in code + DB).** Conference Stuff+ chain: pitch-shape data (`pitcher_stuff_plus_inputs`:
velo/IVB/HB/release/extension/spin) → per-pitch Stuff+ z-scored vs a **D1 population baseline**
(`pitcher_stuff_plus_ncaa`, per pitch-type×hand), recentered to mean 100 → per-pitcher composite
(`Pitching Master.stuff_plus`, pitch-weighted) → conference roll-up. JUCO/D2 z-scored vs the D1 baseline (locked
`juco_uses_d1_baselines`). **HTP = OPR + 1.25·(Stuff+−100) + 0.75·(100−wRC+)**, all from the conf's `Conference Stats`
row: OPR = PA-weighted conf avg of each hitter's **process** power rating (batted-ball/EV/contact — not run outcomes);
Stuff+ = above; wRC+ = conf offense (SLG+OBP based).

**DB reality — corrected the audit agent's over-calls (research, not guess):**
- ❌ "duplicate rows / two pipelines wrote dupes" → **0 true duplicates** (162 rows = 30 conf × 5 seasons 2022-25 + 42
  for 2026; the "Big 12 twice" was cross-season).
- ❌ "wRC+ hand-entered/untraceable" → **computed** (precise decimals 89.9…105.9). The 30 real D1 conferences are
  complete; the only null-input rows are the 10 **JUCO districts** → they use hardcoded `JUCO_DISTRICT_HTP_OVERRIDE`
  by design.
- **HTP ranking 2026 D1 passes the sniff test:** SEC 132 › ACC 122 › Big 12 120 › American 115 › Big Ten 115 › CUSA 114
  › … › OVC 93 › MAAC 91 › SWAC 78 › NEC 78. (Calibrated historically by tinkering the weights until the ranking looked
  right — NOT a data-fit; keep that in mind for any re-weighting.)

**DECISIONS / DIRECTIONS (Trevor 2026-08-13):**
1. **⭐ wRC+ term (`100−wRC+`) → CONFERENCE-AVERAGE PARK FACTOR — MODELED + VALIDATED (approved direction).** It was
   built BEFORE park factors — a proxy for run ENVIRONMENT that conflates environment WITH hitter quality (already in
   OPR) → the Ivy double-count. **Formula (principled):** per team `slg_f = 0.675·avg_f + 0.325·iso_f` (SLG=AVG+ISO by
   rate share), `wrc_park = 0.72·obp_f + 0.28·slg_f` (est-wOBA weights 0.691·OBP/0.235·SLG normalized at league
   OBP .355/SLG .400). Use the **COMBINED (both-sides) `avg/obp/iso_factor`**, NOT the lhb/rhb splits (splits are for
   individual-hitter projection; a conference environment is both-handed). Conference park = simple member average,
   joined by **`conference_id`** (name-join missed 8 confs; conference_id → 30/30). **Result (2026, all 30 D1 confs):**
   fixes the weak-hitter over-boost — Ivy 104.7→98.4, Patriot 100→93.7, Big East 104.7→100, MAAC 91.1→87; top power
   confs barely move (SEC 132→131, ACC 122, Big 12 121, Big Ten 114 — their parks ≈ neutral); bottom stays bottom.
   Still passes the sniff test, strictly cleaner. Weights `1.25`/`0.75` + `0.72/0.28` are tinker/rate-derived — tunable.
   MWC (altitude) rises +2.3 and that's FINE (high+low-altitude parks average out — Trevor).
2. **⭐ STORE IT IN `Conference Stats` + MAKE IT PART OF THE UPLOAD.** Conference Stats is the home for the conference
   aggregates per conference × season: `Stuff_plus` (already), + ADD `wrc_park_factor`, the `HTP` we actually use, and
   OPR — all STORED, not recomputed live. **These must CALCULATE + INSERT as part of the data UPLOAD** (the unified
   pipeline, Track B): when an upload lands, recompute the conference roll-ups (Stuff+, park factor, HTP, OPR) and write
   them. Today they're scattered one-off scripts (conferenceStuffPlusV2, populate-conference-stats-env-plus) → fold into
   the upload. Per-player season park factor is also now storable from pitch-log venues. [[project_park_factor_rework]].
3. **⚠ FUTURE DISCUSSION — how "Conference Stats" are calculated (definitional inconsistency, Trevor):** the raw
   Conference Stats (AVG/ERA/etc.) are **conference-vs-conference** stats (intra-conference matchups), whereas OPR / HTP
   / Stuff+ are **overall** aggregates across ALL the conference's players/games. That mismatch needs resolving —
   decide the ONE definition of a "conference stat." Logged as a future idea, not now.
4. **Independent — the real fix is SCHEDULE-BASED opponent strength (Trevor).** The park swap makes Independent WORSE
   (113.6→118.3, rank 4) because it's Oregon State alone in a pitcher-friendly park. **OSU's OWN HTP is irrelevant —
   they don't face themselves.** The fix = compute the HTP/Stuff+ of the teams OSU **actually FACED** (their schedule).
   Broader insight: schedule-based "competition faced" is the *correct* form; conference-average is a proxy that works
   for conference members but breaks for independents. Own item, future.
4. **Two Stuff+ types are BOTH NEEDED (not a bug to collapse):** (a) individual-pitcher Stuff+, (b) per-conference
   Stuff+. Canonical conference Stuff+ = take **every** pitcher's impact **weighted by their pitch totals** from the
   pitch log (the V2 pitch-weighted method). **Retire V1** (per-pitcher-composite, name-keyed). "Don't care how we get
   there but necessary."
5. **OPR (batted-ball) susceptibility — complex, needs doing:** unlike Stuff+ (pure pitch shape, context-independent),
   batted-ball data CAN be manipulated by ball-flight ENVIRONMENT and QUALITY OF STUFF FACED. So OPR may itself need a
   park/competition context-adjustment. Complex conversation, flagged for a dedicated pass (ties to park factor + Stuff+).
6. HTP shape is directionally correct + sniff-test-validated → keep it; the refinements are the wRC+→park-factor swap
   (#1), the OPR-context question (#5), and the Independent/schedule case (#3).

### BUCKET 3b — Stuff+ engine RECHECK (2026-08-13, verified in code + DB)

**Verdict: the Stuff+ math is TRUSTWORTHY.** Per-pitch z-score models (per pitch type × hand) vs a **D1-clean baseline**
(`pitcher_stuff_plus_ncaa`, all 18 rows division=D1 — the JUCO-contamination risk is code-only, didn't materialize),
recentered per bucket, pitch-weighted composite + conference. IP≥20 leaderboard is legit (Cal Randall UCLA, McElvain
Arkansas, Dax Whitney OSU-SP, Garcia LSU…); distribution centered ~101.6.

**DECISIONS / OPEN (Trevor 2026-08-13):**
- **STORE finalized conference stats via a ONE-TIME SQL (add column + populate), then fold the ongoing calc into the
  UPLOAD.** Pitch log = source of truth → the current 5-6 manual admin buttons are the OLD process; build the NEW
  process off the pitch log (automatic, part of upload — Track B). Retire the old manual chain.
- **⭐ WEIGHTING FORK (OPEN — needs Trevor's call):** the recenter is DELIBERATELY per-pitcher UNWEIGHTED
  (`stuffPlusEngine.ts:450-454`: "pitch-weighted double-counts high-volume pitchers who tend to be the better ones").
  Trevor's instinct = pitch-weighted (1000-pitch arm ≫ 1-pitch arm). QUANTIFIED: pitch-weighted mean runs +3-6 above
  per-pitcher on fastballs/sinkers (Sinker::L 99.0→105.2, 4S FB::R 99.9→103.4) — good arms throw more. So pitch-weighting
  = a real 3-6pt recalibration (drops all FB/SI Stuff+), NOT just small-sample cleanup. Small-sample noise is ALREADY
  controlled in aggregates (conference is pitch-weighted; recenter dilutes a 1-pitch arm 1-in-4800); the leaderboard
  1-IP arms are a DISPLAY-qualifier issue (min pitches to appear), not a weighting bug. **Options: A keep unweighted +
  display floor; B pitch-weight recenter (consistent w/ conference, −3-6 ripple); C unweighted + min-pitch threshold in
  the recenter (agent's lean — fixes small-sample without the ripple).** AWAITING DECISION.
- **Curveball HB weight `−0.15` = LIKELY A BUG (Trevor).** Sinker is arm-side (its sign is right), but Sweeper AND
  Curveball are glove-side breaking balls and should share sign — Curveball's `−0.15` vs Sweeper's `+0.40` is
  inconsistent. Fix as part of the "big Stuff+ conversation." (`stuffPlusEngine.ts:247`)
- **Gyro Slider non-z HB term = CORRECT as-is (Trevor);** the real gyro fix is in RECLASSIFICATION — separate later project.
- **Velocity convention per-pitch (z vs zMax vs velo-diff) = FINE (Trevor)** — deliberately didn't punish a slow-but-
  effective curveball. Part of the future "big Stuff+ conversation."
- **Dead inputs (vaa, whiff_pct unused in scoring; gyro_stuff_plus null) = NORMAL (Trevor), no action.**
- **Idempotency: essentially converged** (max bucket deviation 1.02, 0 outliers) — a re-run nudges ≤1pt. Minor.
- **⚠ FUTURE "big Stuff+ conversation":** velocity/spin conventions, curveball sign, gyro reclassification, the
  weighting philosophy — a dedicated Stuff+ review.
- **Two competing composite writers** (`stuffPlusEngine` excludes needs_review vs `rollupStuffPlusToMaster` doesn't) +
  two baseline writers → collapse to ONE canonical each when building the pitch-log upload process.

### NEW REQUIREMENTS (Trevor, 2026-08-13)
- **Verify depth-role RANGES use REGULAR-SEASON totals:** the hitter PA tiers (`defaultHitterDepthRoleFromActualPa`:
  ≥220/130/50/15 → PA 245/215/145/85/25) and pitcher IP/GS tiers must project off the correct **regular-season** PA/IP
  (not full-season incl postseason). Check the thresholds + the source column.
- **⭐ DEFENSIVE DEPTH TIERS:** d_war/bsr_war are stored pass-throughs today, but they must **scale as position/depth
  toggles change** — so a player needs assigned DEFENSIVE depth tiers (parallel to the PA/IP opportunity tiers) so
  d/bsr scale with playing time + position. **Needed for ANY Team Builder function — returner AND transfer**, not just
  transfers. This is the mechanism behind the 7b/7c "depth-role scales d/bsr" decision.

---

## THE TARGET ARCHITECTURE (ties to Track B)
ONE process, automatic, from pitch-log upload → display: pitch log lands → derive metrics → marry into Masters →
recompute ncaa_averages → power ratings → **run BOTH hitter + pitcher projections (returner + transfer) on the edge
fn** → write player_predictions → display reads stored (live-recompute only for unsaved TB toggles). Collapses the 3
drifting copies into 1. Step 6b (deploy + fire transfers) is the near-term step; the unified fn is the durable build.
