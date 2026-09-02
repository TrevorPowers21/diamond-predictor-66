# Agent learnings — Step 7b WAR display swap: audit, the scale-reshape, + calibration (2026-08-13)

Captured for the RSTR IQ dev agent. Task: swap the hitter HEADLINE from offensive `o_war` to TOTAL hitter WAR
(`total_hitter_war` = o_war + d_war/13.1 + bsr_war/13.1, stored on `player_predictions`) and relabel "oWAR"→"WAR",
everywhere — incl. Team Builder snapshots-under-toggles, GM side, market value, and the projected/stable-team-value
anchors. Branch `feature/war-recalibration`, staging-first. **Status: AUDITED + measured; NOT built.** Companion:
`docs/STEP7_EXECUTION_MAP.md`, memory `project_war_display_audit`. Record shape: fact — why — what it protects.

---

## PART 1 — WHERE EVERYTHING LIVES (the display/market/value map, verified in current code)

**`total_hitter_war` is read by ZERO frontend files today.** It's a NEW column (stored on `player_predictions` +
reseeded into `team_war_snapshots`), so "read nowhere yet" is expected, not a finding — it's a naming/wiring gap.

### Hitter WAR display sites (outside TB/GM)
- `ReturningPlayers.tsx:3020` header "oWAR" + `:3127` cell `pred.o_war`; **GOTCHA: the sortKey literal is `"p_war"`
  on the hitter column** (:1875 reads `o_war` under that key) — a find/replace landmine. STORED read.
- `PlayerProfile.tsx:1726` hero "oWAR" — **LIVE rebuild** from wRC+ (`computeOWarFromWrcPlus`), `storedOWar` fetched
  at :948 but `void`-ed :964. `:985` `computedNilValuation` live-computes market from oWar. `historicalOWar` (:953,
  descriptive, actual prior season) is computed then `void`-ed :972 → the natural insertion point for descriptive+gap.
- `PlayerComparison.tsx:361` "oWAR" hero, `row.o_war` STORED. `TransferPortal.tsx:1583` "oWAR" hero, `row.o_war`
  STORED. `TargetBoardSubtab.tsx:584/638` col "oWAR" `pred.o_war` (from 3 snapshot sources). `PlayerHub.tsx:489/602`
  WAR box (GmRow.war). `pdfGenerator.ts:236/1114` PDF "oWAR"/"PROJECTED oWAR".
- `HighFollowList` renders NO WAR. `NilValuations.tsx` route COMMENTED OUT (App.tsx:117), reads a DIFFERENT field
  `component_breakdown.ncaa_owar` (not player_predictions). `savant/TeamProfilePage` = separate live-stat engine, EXCLUDE.

### Team Builder — single choke point + the toggle blocker
- **ALL TB hitter headline WAR = `useTeamBuilderSimulation.playerProjection` (:1278-1512).** Clean row → reads snapshot
  (`snap.o_war ?? snap.owar` :1308); **pitcher clean row returns `owar: snap.p_war` (:1305)** — so `owar` IS pWAR for
  pitchers (this is why the budget benchmark is full-team, see Part 3). Dirty row (any toggle moved) → rebuilds owar
  from wRC+ only (:1455-1511); **d_war/bsr_war are NEVER fetched (selects :520, useLoadBuild :194/217 omit them),
  never on the BuildPlayer shape, never added.** So a naive total display would DROP d/bsr the instant a coach toggles.
- Mirrors: `projectEffective.ts` (`projectEffectiveWar`, offense-only) + `effectiveProjection.ts`
  (`effectiveHitterWar`/`effectiveMarket`) — but **`effectiveProjection.ts` is DEAD (0 callers)**; PlayerProfile + TB
  each have their OWN inline live-compute. So the fix lands in TWO live sites, not three.
- Snapshot writes: `TeamBuilder.tsx:1937` (save) + `:2304` (per-row update) + `useTargetBoard.ts:177` — all store
  `o_war` only. **The TB "Compare tab" NO LONGER EXISTS (deleted in the collapse); `"compare"` in validTabs is vestigial.**
- Analytics: `rosterTableTotals.totalWar` (:1852), `POS_STARTER_OWAR`/`POS_ELITE_OWAR` gauges (`AnalyticsTab.tsx:513-527`
  = the "Hitter WAR by Position" **Program Analytics** card), championship/YoY compare vs `team_war_snapshots` (reads
  `prorated_*` today — **should read `raw_*` = descriptive; the reg-season May-18 boundary is stored so NO proration**).

### GM side — pure reader
- `loadGmBuildRoster.ts:33` `storedWar = pitcher ? snap.p_war : snap.o_war` → `GmRow.war`. `useGmTargetBoard.ts:75/169`.
  `GMTargets.tsx:167` "Proj oWAR" mislabel. No `gm_roster` table; `useGmRoster:830` copies snapshots verbatim.
- **`Math.max(rosterScore, 33)` is hardcoded-DUPLICATED 5×:** `useTeamBuilderSimulation:1687`, `GMRoster:387`,
  `GMTargets:128`, `GMScenarios:218`, `PlayerHub:280`. Dedupe to ONE shared constant.

### Market value
- `depthRoles.ts:312/314` `computeHitterMarketValue(oWar, {conference, position})` = `WAR × $25,000 × PTM × PVF`,
  `Math.max(0,·)`. Param NAMED `oWar` but WAR-generic. PTM = conference tier (SEC 1.5…0.5), PVF = position (C/SS/CF
  1.3…). **Repoint = feed total_hitter_war, don't rename the fn.**
- REPOINTED (3 precompute paths, 7a): edge fn (local dup :913/:1166), `backfill-2027-hitter-returners:288`,
  `precompute-transfer-projections:384`. NOT repointed (still oWar): `predictionEngine.deriveHitterStored:69`
  (regular variant), `jucoReturnerProjection:99`, `PlayerProfile:985` LIVE, `useTeamBuilderSimulation:693` LIVE,
  + ~8 maintenance/QA scripts incl `verify-all.ts` (asserts market==f(oWar) — will false-flag post-repoint).
- Displays: `pickHitterMarketValue`/`pickPitcherMarketValue` (`twpMarketValue.ts:20/29`) everywhere (TWP-aware).

---

## PART 2 — THE SCALE RESHAPE (the redesign WIDENED the distribution) — measured, verified 3 ways

**Method (transferable): prod = OLD scale (÷10 + old equations), staging = NEW (÷13.1 + Steps 1-5 refits). Prod-vs-
staging by matched `source_team_id`/`source_player_id` = a true old-vs-new.** Watch the JUCO confound: prod
`team_war_snapshots` = 466 teams (158 JUCO); staging = 308 D1. Inner-join on source_team_id → D1-only, comparable.

**The finding — WAR got concentrated at the top, not uniformly up or down:**
- **Typical/median hitter DOWN ~18%** (per-position mean offensive oWAR OLD 0.84 → NEW 0.69; every position 0.70-0.91×).
  Higher replacement floor (21.22/600) pushes the middle+bottom down; many weak bats go NEGATIVE.
- **Elite hitters UP sharply** (Landon Hairston desc_owar 2.5→5.07 ≈ 2×; per-position p90 rose ~1.7-1.95 → ~1.96-2.29).
  Steeper wRC+→runs slope rewards top production.
- **Defense/baserunning adds LITTLE at the mean** (+0.00-0.05/player) — it's a TAIL effect (specific gloves like
  Helfrick-catchers), NOT a level shift. Hairston's "5 WAR" is his OFFENSE (d_war only 0.12), i.e. the offensive
  formula, not defense.
- **Pitchers DOWN broadly** (D1-FIP refit + ÷13.1).
- **Team totals: 272/308 DOWN, 36 UP — but direction tracks quality.** Good programs UP/flat (Georgia Tech 37.2→46.1
  +8.9, North Carolina 29.4→38.0 +8.6, Georgia 39.0→44.2 +5.2, UCLA 33.0→36.2 +3.1); weak programs DOWN, many negative
  (Loyola Marymount 16.9→0.1, Delaware State 10.8→−5.9). Means/medians down, TAILS up, good teams roughly flat/up.
- **Quality validation (champions proxy — DB has champion flags, NO win/loss records):** champions' mean full WAR
  24.2 vs league 16.3; champions' median WAR-rank improved 84→72 new-vs-old; elite champs rise to rank 1-6.
  Caveat: 16/34 champs top-64 either way (mid-major conference champs don't rank high in raw WAR — expected).

**⭐ This reshape is INTENDED + CORRECT (Trevor confirmed): Hairston 5.07 is right.** It is the descriptive twin of the
locked Steps 1-5 modeling. Do NOT re-open the oWAR scale.

**⚠ descriptive vs projection (Trevor, do-not-conflate):** `team_war_snapshots.raw_*` = DESCRIPTIVE last-season WAR,
summed from each player's ACTUAL at-bats (`total_desc_war`), NOT a projection. The Part-2 team/position analysis is all
DESCRIPTIVE. The MARKET + DISPLAY swaps operate on the PROJECTION (`player_predictions.total_hitter_war`, forward 2027,
built from projected wRC+ × projected opportunities). Same reshape because same formula, but different data.

---

## PART 3 — CALIBRATION (percentile of the COMPETITIVE tier, never the league average)

- **The `33` budget benchmark is FULL-TEAM (hitters + pitchers), not offense.** Proven: `playerProjection` returns
  `owar = p_war` for pitchers (:1305), so `projectedPlayerScore`'s `totalScore` denominator (:1640-1644) sums hitter
  WAR + pitcher pWAR over the whole roster. **The `33` comment reproduces on PROD as full-team p75 = 28.48** ("league
  p75 28.8"), confirming the quantity.
- **⭐ CALIBRATE ON A PERCENTILE OF COMPETITIVE TEAMS, NOT THE AVERAGE (Trevor).** The tool serves programs competing
  for conference championships; teams like Delaware State will never use it and MUST NOT drag the floor down.
- **⭐ AND against the RIGHT QUANTITY (Trevor): the `33` floors `totalScore = Σ calcPlayerScore`, NOT raw WAR.**
  `calcPlayerScore = WAR × PTM × PVM` (`nilProgramSpecific.ts:63`); PTM cancels (floor is `33 × PTM`), so `33` is on the
  scale of **`Σ(WAR × PVM)`**. PVM (`getPositionValueMultiplier`): C/SS/CF=1.3, 2B/3B/IF/LF/RF/OF=1.1, 1B/DH/UT=1.0,
  bench=0.8, **pitchers (P/SP/RP) → default 1.0**. So calibrate on `Σ hitter(total_desc_war × PVM(Pos)) + Σ pitcher(desc_pwar × 1.0)`.
- **RESULT (proper score, staging D1, 2026):** league p50 = 16.9 (average would wrongly gut it to ~17); **TOP-64 by
  score p50-p75 = 29.6-32.4; champions p75 = 30.4.** → **new benchmark ≈ 32 = HOLD at 33.** PVM adds ~+2 vs raw WAR
  (top-64 score p75 32.4 vs raw-WAR p75 30.2), so calibrating on raw WAR under-sets it. Top-10 by score = the recognizable
  powers (Georgia Tech 51.8, Georgia 49.2, NC, Texas, UCLA…), 6/10 champions — sanity confirmed. *Protects against:*
  letting the un-served bottom of D1 collapse a floor that prices competitive rosters, AND calibrating on WAR instead of
  the score the code actually floors.
- **Position gauges (Program Analytics) → new per-position thresholds** (staging total_desc_war p50/p90, D1 pa≥100):
  C 0.50/1.96 · SS 0.50/2.13 · CF 0.64/2.20 · 2B 0.60/1.85 · 3B 0.59/2.01 · LF 0.64/1.90 · RF 0.69/2.29 · 1B 0.69/2.18
  (DH n<15 → default 1B; OF 0.46/1.60). Old bars (starter ~0.9-1.1 / elite ~1.7-1.95) were on the pre-rescale scale.
- **Championship/YoY benchmarks: NO reseed needed.** Step 6 already reseeded `team_war_snapshots` to total WAR (verified
  clean: lineup ≤ total on every real team; Georgia Tech reconciles 31.98 raw). 7b only flips the BUILD side to total.
  (Switch AnalyticsTab reads `prorated_*` → `raw_*` = descriptive.)
- **`DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE = 68`** (NilValuations): reads a DIFFERENT field (`ncaa_owar`), not this
  repoint. Leave it; log as its own follow-up (don't half-migrate a second data path).

---

## PART 4 — DESIGN DECISIONS LOCKED (Trevor, 2026-08-13)

1. **Toggle behavior:** dev_aggressiveness + class_transition recompute ONLY oWAR (current fn/scale); depth_role scales
   d/bsr by playing-time. **IMPLEMENTATION (Trevor's insight): STORE d_war/bsr_war ON THE SNAPSHOTS** (constant
   pass-throughs) so total = recomputed_oWAR + stored_d_war + stored_bsr_war. Snapshots need the two new fields added
   at every write site (`TeamBuilder:1937/2304`, `useTargetBoard:177`, GM). Cleaner than a live d/bsr recompute.
2. **Position gauges → TOTAL WAR** (new per-position thresholds above).
3. **Budget-share → TOTAL WAR + recalibrate anchors data-driven + dedupe the 5 `33` copies.** Percentile-of-competitive.
4. **Label:** relabel/repoint only the HEADLINE oWAR → "WAR"/total; leave "oWAR" where it's the offensive COMPONENT.
5. **Use RAW descriptive (not prorated):** the May-18 reg-season boundary is stored; nothing to prorate. AnalyticsTab
   `prorated_*` → `raw_*`.
6. **NilValuations `68` left alone** (separate `ncaa_owar` path).

---

## PART 5 — METHOD LESSONS (mistakes I made — carry these)

- **I calibrated the `33` on HITTERS ONLY (got ~13) — WRONG; the benchmark is full-team incl pitchers.** Read the
  actual denominator code before calibrating a constant; `playerProjection` maps pitcher pWAR into the `owar` field
  (:1305). *Protects against:* calibrating a constant against the wrong quantity.
- **I asserted "÷10→÷13.1 lowered the scale" without measuring — WRONG net.** The redesign changed replacement + run
  values + added defense; the NET is a reshape (median down, tails up), not a uniform shift. MEASURE old-vs-new
  empirically before claiming a direction. *Protects against:* reasoning from one constant instead of the data.
- **I presented a "22% drop" from a JUCO-confounded prod-vs-staging distribution (prod n=466 incl 158 JUCO vs staging
  308 D1) — WRONG.** Check population parity (n, division mix) FIRST; use matched joins + a percentile of the RELEVANT
  segment, never raw distribution means across mismatched populations. *Protects against:* confounded aggregate scares.
- **STOP AND CHECK AT MODELING/ANALYSIS CROSSROADS (Trevor, emphatic this session): "do it right not fast." Don't
  present half-baked/confounded numbers as conclusions; surface the crossroad and wait.** Reinforces
  [[feedback_check_before_rushing]] + [[feedback_stop_and_talk_on_real_problems]].
