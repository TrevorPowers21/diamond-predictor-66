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

**STEP 1 WIRING — DONE (2026-08-11), BOTH SIDES.** Hitter wRC+ (C1) + pitcher pRV+ (D1-FIP) both rebuilt and
CONSOLIDATED to one canonical source each (`src/lib/wrc.ts`, `src/lib/pitcherQuality.ts`); oWAR conversion
0.163→0.3994; staging config synced (hitter live values, pitcher reference). tsc 195=baseline, 247/247 tests.

**⚠ SESSION 2026-08-11 — Step 3 gate CLEARED + power-rating composites REFIT (staging). NEXT = Step 4 → Step 5 → Step 6.**
Done this session (all staging, store re-run propagate=false, predictions untouched, moves oWAR at Step 6):
- **Pagination bug FIXED** (the gate's real find): `.range()` w/ non-unique `.order()` dropped rows — corrupting the
  multi-season blend AND dropping whole players/fallbacks from the transfer precompute (Trevor observed). Fixed
  `computeAndStoreScores.ts:174` + 4 `precompute-*.ts`. `in_zone_pct` backfilled from pitch log (was null → flattened BB9⁺).
- **Composite refits** (2026 same-season fit): **era⁺** (walks .17→.30 top input, izWhiff dropped), **baPlus** (avgEV↑),
  **obpPlus** (built to OBP's measured 57/43 hits/walks, walks .40), **isoPlus** (`la` dropped, raw pull → pitch-log
  **pull_air**, gb top). **k9⁺/bb9⁺ LEFT ALONE** (same-season circular; needs walled OOS). Synced code + edge port +
  AdminDashboard + model_config; verified in-DB; 247 tests, 0 new tsc errors. See [[project_power_rating_refits_2026_08_11]].
- Power-rating fallbacks verified firing (blend/in-zone/stuff-redistribute); grades match reality on both sides.

**Step 4 (composite audit/refit) + Step 5 (replacement level) BOTH DONE 2026-08-11.** hr9⁺ (GB%+hard_hit) and
whip⁺ (71/29 miss-bats) refit; k9⁺/bb9⁺ left (circular). **Step 5:** hitter floor DERIVED to 1.62 wins/600 (.380
win% anchor, same as pitcher RA9 8.83; was borrowed 2.0) — descriptive oWAR re-populated, all sites synced,
**model_config synced + VERIFIED in-DB 2026-08-12** (`owar_replacement_runs_per_600 = 21.22` @ season 2026; the
legacy season-2025 row is still 25, unread per the season gotcha). **NEXT = Step 6 (staging re-precompute).** All modeling is now locked. The build order remains:
a re-precompute (Step 6) writes the projection numbers to staging, so it must run only AFTER the projection
INPUTS are verified correct. Skipping ahead bakes unverified numbers in and forces a second full re-precompute.
Specifically Step 6 must wait on: **Step 3** (power ratings computed + consumed correctly, fallbacks accurately
used), **Step 4** (GB%-informed HR9 refinement), **Step 5** (replacement level DERIVED both sides — the hitter
floor is still the borrowed 2.0/600). These aren't optional polish; each changes the projected rates or the
WAR zero-point that Step 6 freezes into `player_predictions` + snapshots.

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
   projections, so OOS-fitting the coefficients would double-count it. **Mechanism (corrected 2026-08-11 —
   the doc previously overstated this):** the rate projection is a FLAT `0.3·last + 0.7·scouting` blend per
   side (hitter bumps to 0.1/0.9 when `combined_used`), plus per-stat SDs for the PR+→rate z-shift. Pulling a
   player toward his scouting-implied skill IS regression — that's what prevents the double-count. It is NOT a
   per-stat persistence-calibrated coefficient. The earlier "K9 0.578 vs contact 0.147 per-stat persistence"
   language described logic that **does not exist in code** (`pitcherProjection.ts` uses a single
   `PITCHING_POWER_RATING_WEIGHT=0.7`; `predictionEngine.ts` a single `powerWeight:0.7`). The 0.7/0.3 split is a
   deliberate theory-driven prior (Trevor: college rewards past performance more than a scouting model would —
   good college hitters keep hitting through data limits, unlike MLB), NOT yet fit to data. **Empirically
   testing/replacing it = a dedicated next-offseason session** — see Deferred Studies below. The decision still
   holds; only its rationale was mis-described.
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

## Step 1b — pitcher pRV+ → D1-FIP (SHIPPED 2026-08-11)

Replaced the old z-averaged 6-component pRV+ blend with the validated D1-FIP index. **One canonical
`src/lib/pitcherQuality.ts`** (edge fn mirrors it): `projFIP = 3.847 − 0.231·K9 + 0.509·BB9 + 1.486·HR9`
(lgHBP9 1.467 folded into the intercept — there's no projected HBP9 rate); `projRA9 = projFIP × E2T 1.137`;
`pRV+ = 100 + 100·(6.913 − projRA9)/6.913` (linear — the ratio form blows up in a 6.9-run env). pWAR formula
unchanged (consumes pRV+ via `pwar_r_per_9` 6.915). **ONE pRV+ definition** (Trevor): projection pRV+ from
projected rates, actuals pRV+ from actual K9/BB9/HR9 — same formula. The `era_pr_plus…` power-rating `+`-stats
STAY (they're the projection rate INPUTS, not the blend). Wired across all 3 engines + edge (×2) + effective ×2
+ computeAndStoreScores + PitcherProfile ×4 + JucoPanel + storage table. **Savant `prvPlus.ts` left as-is**
(legacy skill-composite, flagged; dies in the Savant rewrite). tsc 195=baseline, 247/247 tests.
⚠ **Step 6:** reseed `team_war_snapshots` from `desc_pwar` — the old `seed_team_war_snapshots_2026.sql` uses an
inline power-rating blend on the OLD `5.5/2.5/10` scale and must be retired.

## FINAL REFIT STATE (2026-08-11) — all composites + replacement, committed to staging

Every power-rating composite audited against 2026 data + refit where warranted. All synced across FOUR places
(kept in lockstep or stored≠live): `src/lib/powerRatings.ts` (authoritative store) · edge Deno port
(`process-precompute-jobs`) · live-path defaults (`usePitchingEquationWeights`, `PitchingPowerRatingsStorageTable`) ·
`AdminDashboard` (display) · `model_config` (DB). Store re-run `propagate=false` (predictions untouched → land at Step 6).

**Final weights (all VERIFIED in-DB @ model_config season 2026):**
- **era⁺** (display; pWAR rides D1-FIP): whiff .25 · bb .30 · hh .15 · chase .05 · barrel .05 · stuff .20  (izWhiff dropped)
- **baPlus** → AVG: contact .35 · lineDrive .20 · avgEV .30 · popUp .15
- **obpPlus** → OBP (57/43 hits/walks): contact .20 · lineDrive .10 · avgEV .15 · popUp .10 · **bb .40** · chase .05
- **isoPlus** → ISO: barrel .30 · ev90 .35 · **pull_air .10** · gb .25  (la dropped; pull_air pitch-log-derived + backfilled)
- **hr9⁺** → HR9 (MOVES pWAR): barrel .15 · **hard_hit .30** · gb .30 · pull .25  (ev90+la dropped)
- **whip⁺** → WHIP (display; 71/29 hits/walks): bb .30 · whiff .45 · stuff .25  (ld/ev/gb/chase dropped)
- **k9⁺ / bb9⁺**: UNCHANGED (same-season fit circular; needs OOS = walled)
- **Replacement (Step 5, WAR zero-point):** hitter 1.62 wins/600 (`owar_replacement_runs_per_600` 21.22 = 1.62×13.1);
  pitcher 1.92 runs/9 (RA9 8.83) — BOTH now on the .380 win% anchor. Descriptive oWAR re-populated at 1.62.

**⚠ model_config SEASON GOTCHA (cost a round-trip 2026-08-11):** config the app reads lives at **season = CURRENT_SEASON = 2026**
(`AdminDashboard ADMIN_UI_SEASON = 2026`; `usePitchingEquationWeights` reads `CURRENT_SEASON`; `predictionEngine` reads
the current season). There are **legacy admin_ui rows at season 2025** — DO NOT write config there; writing 2025 lands on
rows nothing reads (silent "admin shows old values"). Always upsert `('admin_ui', 2026, key, val)`.

## SQL ledger — every DB change the WAR redesign touches (status as of 2026-08-11)

| SQL / file | what it does | staging | prod |
|---|---|---|---|
| `scripts/sql/descriptive_war_columns.sql` | ALTER Hitter/Pitching Master — add `desc_owar, wraa, woba, d_war, bsr_war, total_desc_war` (hitter) + `desc_pwar, desc_ra9, desc_fip_ra9, drs_behind, total_desc_war` (pitcher) | ✅ run | ⏳ pending |
| `desc_*_reg columns` (Step 2, pasted inline 2026-08-11) | ALTER Hitter Master `woba_reg,wraa_reg,desc_owar_reg,d_war_reg,bsr_war_reg,total_desc_war_reg` + Pitching Master `desc_ra9_reg,desc_fip_ra9_reg,drs_behind_reg,desc_pwar_reg,total_desc_war_reg` | ✅ run + populated + verified | ⏳ pending (append to a .sql before prod) |
| `scripts/sql/wrc_c1_model_config.sql` | wRC+/oWAR constants → C1 in `model_config` + `ncaa_averages.wrc` 0.3782 | ✅ run + verified | ⏳ pending |
| `scripts/sql/pitcher_c1_model_config.sql` | pitcher D1-FIP/pWAR constants → `model_config` (REFERENCE only — pitcher path rides code defaults, not read; parity with hitters) | ⏳ pending | ⏳ pending |
| `supabase/migrations/20260810_composite_war_d1_rescale.sql` | redefine `refresh_composite_war()` (d_war/bsr_war ÷13.1, full wSB) | ⚠ DEFINITION only — the `select refresh_composite_war()` fires in **Step 6** | ⏳ pending |
| `scripts/sql/team_drs_store.sql` | team dRS storage (dRS engine, earlier) | ✅ | — |
| ✅ RESOLVED | scale-reconcile pwar constants: the `Equation Weights` table is EMPTY (0 rows) and `model_config` has NO pwar/pRV+/per-9 keys → pitcher WAR rides **code defaults** (`pitchingEquations.ts` = C1: r_per_9 6.915 / repl 1.92 / RPW 13.1). No stale DB weights; nothing to paste. | — | — |

**Population/write scripts (not SQL, run via `node` on staging):** `populate_descriptive_war.mjs` (writes desc_* — ✅ run,
re-runs in Step 6 on 0.3782); the precompute edge fns rebuild `player_predictions`.

**Equation changes — all in `WAR_SYSTEM_DESIGN.md §8`:** hitter wRC+ C1 (WIRED); pitcher D1-FIP (WIRED 2026-08-11 —
projection form `3.847 − 0.231·K9 + 0.509·BB9 + 1.486·HR9`, HBP folded; canonical src/lib/pitcherQuality.ts);
oWAR conversion 0.3994 + descriptive constants → this doc.

## Pagination bug (found 2026-08-11) — systemic, gates the re-precompute

`.range()` pagination with a NON-unique `.order()` key (or none) silently overlaps/skips pages → drops whole
rows. Found across the precompute path. **Impact:** small-sample players blended a RANDOM subset of prior seasons
(the Michael-Anderson/Parker-Dixon failure — a good transfer's prior season dropped, stored rating computed off a
tiny noisy line); and whole players/fallbacks dropped from the transfer precompute (Trevor observed this — a
returner row kept a fallback the transfer lost). Pre-existing on prod.
- **FIXED (2026-08-11):** `computeAndStoreScores.ts:174` `fetchAllPrior` (+`.order("id")` tiebreaker — the +stat
  blend; this is a LIB, so the future edge fn inherits the fix); `precompute-transfer-projections.ts`,
  `precompute-pitchers.ts`, `precompute-returner-pitchers.ts`, `backfill-2027-hitter-returners.ts` (loadAllPaged
  `+.order("id")`). **Already safe (NOT touched):** `syncMasterToPlayers.ts`, `inferClassTransitions.ts` (both
  already carry a unique composite `(Season, source_player_id)` order).
- **Not swept (display-only / lower stakes / superseded):** HistoricalPlayerTable, storage tables,
  conferenceScoutingAverages, GM board (has its own workaround). Fold into Track B or a separate sweep.
- **`in_zone_pct` DATA GAP:** null for ALL 2026 D1 pitchers (TruMedia header is `InZoneMdl%`, unmapped this
  upload; it carries 30% of BB9⁺ weight → defaulted to 50 → flattened BB9 ratings). Backfilled from the pitch log
  (`pitch_log_pitcher_totals.total_in_zone/total_out_of_zone`, 98% coverage) — paste-SQL, staging. Track B derives
  this automatically so the header can never drop it again.

## Two tracks (2026-08-11 — do NOT conflate)

**Track A = the WAR redesign (Steps 1–8).** Finishes on the CURRENT (manual, script-triggered) process. Step 6
runs the now-pagination-fixed precompute scripts. Correction-only (quality metrics + descriptive), not a
projection-philosophy change — see user-trust note.

**Track B = unified ingest→projection edge function (Trevor's target architecture).** A real build, NOT part of
Track A; retires the manual scripts and makes today's bug classes (pagination, header-drop) structurally
impossible. Fires ON UPLOAD (no button), weekly through spring. Pipeline:
1. Pitch-log file lands in a folder → ingested to raw data.
2. Derive all needed metrics from the pitch log (in-zone%, chase, whiff, EV, **Stuff+**, …).
3. Marry derived metrics into Pitching/Hitter Master (pitch-log-derived data OWNED by this process, not the CSV).
4. Compute power ratings from the derived data (imports `computeAndStoreScores` lib — one stored path, no live compute).
5. Run projections → write `player_predictions` + all display data.
6. One edge function, on-upload trigger, weekly.
7. Periodic Master CSV drop = basic active-player info refresh; roster scrapes = roster currency (PRESEASON
   player-linking concern; once data flows it links to the right player). = formalizes [[project_eager_precompute_buildout_plan]].

Sequencing: Track B must NOT block Track A. Ship the WAR corrections on the current fixed scripts, then build B.

## Deferred Studies (Step-3 research outcomes, 2026-08-11 — do NOT do inside this WAR redesign)

Each of these is "sound logic, potentially not yet backed by data." They are real future improvements, each
blocked on data we can't currently trust. Recorded so we don't half-do them mid-redesign and churn users.

1. **Projection blend weights (0.7 scouting / 0.3 last) — empirical per-stat refit.** THE study: on our 5 seasons
   (2022–2026; ~8,400 hitter + ~5,300 pitcher YoY returner pairs) fit `nextYear ≈ a·lastActual + b·powerRating`
   per stat → data-driven per-stat weights, and test whether power ratings out-predict past performance (Trevor's
   college-rewards-past-performance thesis). **BLOCKERS:** (a) historical Stuff+ is NOT consistent YoY — older
   imports used older methodology; a "does the rating predict" test would measure our own pipeline drift unless we
   reprocess all historical imports to today's Stuff+ definition first. (b) Two-directional survivorship: returners
   exclude BOTH the weak (cut) AND the best (MLB draft / graduation) — must be modeled, not naively correlated.
   → **Next-offseason session.** Until then 0.7/0.3 stands as a deliberate prior.
2. **SP↔RP role-transition values** — restudy `sp_to_rp_*` per-stat knobs. Blocked on reliable role-switch samples
   under current methodology. The per-stat role logic (K9/BB9 move more than WHIP) stays as Trevor's intent.
3. **JUCO (and later D2/D3) translation** — the hand-calibrated district Stuff+/HTP overrides are intentional
   (subjective JUCO-level → D1-conference mapping from draft history; no buildable power rating at JUCO n). Any
   improvement = its own research/working session; do NOT regenerate the overlay in the meantime.
4. **One computation path / kill live compute** (nearer-term, Step 6 architecture, NOT a study): consolidate the
   +stat math to a single stored path folded into the unified upload→projection load (edge fn or precompute stage),
   removing the live-compute fallback and the Deno hitter port. Trevor: "should be 1 spot, I hate live computes."

## The build sequence (remaining)

1. ✅ **DONE — Step 1 wiring** (C1 consolidation above). Constants live in `src/lib/wrc.ts` (one source; edge fns mirror);
   the offensive fixtures carry the `centering_population` guard. (the 0.364→
   saga is why). **Gate**: same-season test converges; replacement player ≈ 0; no double-scaling.
2. ✅ **DONE — Regular-season descriptive WAR (Step 2, 2026-08-11).** RECOMPUTED (not prorated) on games
   ≤ 2026-05-18 and STORED alongside full-season on the player row (Option A). Full-season stays the historical
   headline; the `_reg` columns feed the projection GAP + team_war_snapshots/program analytics. Verified in-DB
   (Helfrick total 4.755→4.261, Hairston 5.391→5.310, top ace pWAR 5.978→5.165; 5,322 hitters + 5,372 pitchers).
   - **New columns (staging, ALTERed + populated):** Hitter Master `woba_reg, wraa_reg, desc_owar_reg, d_war_reg,
     bsr_war_reg, total_desc_war_reg`; Pitching Master `desc_ra9_reg, desc_fip_ra9_reg, drs_behind_reg,
     desc_pwar_reg, total_desc_war_reg`. Populate = `scripts/drs/populate_descriptive_war_reg.mjs` (writes reg only;
     mirrors the full-season populate's formulas). **⚠ prod ALTER + populate pending (Step 8).**
   - **Reg = true SUBSET of full (identical zero-point):** the dRS run-environment baseline (park effects, xOut
     rates) is derived on ALL games, then only regular-season games are accrued — so `d_war_reg` is full minus
     postseason on the same scale, NOT a re-baselined number. Added `--regular-season` mode to `run_drs.py`.
   - **ID-at-source fix (Trevor):** the old `player_season_defense_regseason.csv` was a stale Aug-4 file keyed on
     PLAYER NAME with no `source_player_id` → the reg defense join silently matched nothing (`d_war_reg`≈0).
     Regenerated via the current engine (emits `source_player_id` at col 3); every join now keys on ID. Baserunning
     was already ID-keyed (`playerId` = source_player_id) with `wsb_runs_reg` present — no regen needed.
   - **Pitcher `reg_R` accrued EXACTLY (not ratio-approximated):** taught the ER engine
     (`accrue_pitcher_er.py::process_half_inning`, optional `runs` dict) to also tally TOTAL runs (earned+unearned)
     per responsible pitcher with the same inherited-runner attribution; `accrue_pitcher_line.py` now emits
     `full_R/reg_R/RA9`. Validated: full_R≥full_ER 100%, Σfull_R 111,170 vs score-delta 111,704 (99.5%). The
     earlier `reg_ER × (fullR/fullER)` shortcut is retired. `drs_behind_reg` stays an IP-proration of the stored
     (already IP-prorated) team dRS behind the pitcher — a team-defense allocation, consistent with full-season.
3. **B.5 — power ratings + fallbacks (THE GATE).** Research DONE 2026-08-11 (3 agents mapped the whole system;
   discussed with Trevor). **Outcome: most of this FREEZES rather than changes** — the projection philosophy
   (0.7/0.3 blend), SP↔RP role logic, and JUCO are all deferred to future sessions (see Deferred Studies), because
   the studies that would justify changing them need historical data we can't yet trust (consistent YoY Stuff+,
   reliable role-transition samples, JUCO n). So the Step-3 gate NARROWS to two do-able (not study) items:
   (a) **verify stored vs live +stats currently agree** and scope removing the live-compute fallback entirely
   (Trevor: "should be 1 spot, I hate live computes" — one stored path, no live recompute; likely dead logic);
   (b) **confirm the re-precompute reads the frozen JUCO/role constants without regenerating them** — CONFIRMED:
   `populate-conference-stats-env-plus.ts` (the only consumer of the JUCO regional overlay) is a standalone
   `npm run populate-conf-stats`, NOT chained into any precompute, so **do NOT run it** during Step 6 or it
   overwrites the hand-calibrated draft-research district Stuff+/HTP with low-n noise.
   Net: the re-precompute ships Step 1 (wRC+/pRV+/oWAR corrections) + descriptive WAR only — a smaller,
   correction-only change (defensible to users via changelog), NOT a projection-philosophy rework.
4. **Refinement #1 — GB%-informed HR9** (project HR9 partly from ground%). Changes the projected HR9 rate that
   D1-FIP consumes; clean-contact-manager recovery (Magdaleno → ~0) is the falsifiable guard for dropping w_luck.
   Must land before Step 6 or the pitcher projection is missing a validated input refinement.
5. **Derive replacement** (both sides, one tier principle) — the WAR ZERO-POINT. Hitter floor still borrowed
   (2.0/600); pitcher 8.83 derived. Re-derive both on one principle; the hitter/pitcher split falls out. This
   sets where 0 WAR sits, so it must be final before Step 6 writes WAR — swapped ahead of the re-precompute to
   avoid staging double-churn.
6. **Re-precompute** (staging first) — the big one, now that Step 1 + config are done:
   - **⚠ PREREQUISITE (in progress) — INTERNALS COLLAPSE / repoint the precompute off `player_prediction_internals`.**
     The precompute readers (`process-precompute-jobs` edge fn + `backfill-2027-hitter-returners`) currently read
     power ratings from `player_prediction_internals`, a June-8 STALE COPY of the Master ratings — so running Step 6
     as-is would silently bake two-month-old ratings into `player_predictions`. Rewire both to read the Master's
     `ba/obp/iso_power_rating` (pitcher `*_pr_plus`) by `source_player_id @ 2026` FIRST. This IS the collapse work
     (Trevor, 2026-08-12: "make sure that is how the edge function runs and it is rewired to no longer use the
     player prediction internals"). Dead readers (recalcById/CompareTab/TB-sim) neutered; `bulkRecalc` retired
     staged (Track B). **Full spec: `docs/INTERNALS_COLLAPSE_HANDOFF.md`** / [[project_internals_collapse_plan]].
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
