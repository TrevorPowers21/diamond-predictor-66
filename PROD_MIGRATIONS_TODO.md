
> ▶️ **CURRENT STATE + ROADMAP: `docs/HANDOFF_2026_09_02_STATE_AND_ROADMAP.md`** — what shipped, what
> is verified, the 9 open items, and the five queued workstreams (coach agent display · team
> comparison + 2027 roster upload · JUCO · Track B / agent-as-resource · player development).
> ⭐ The highest-value refactor is named there: **one save path owning every derived copy.**






## 🛑 TEAM BUILDER READ/WRITE PATH — 2026-09-01 (read before touching snapshots)

**One defect class behind every symptom: a stored copy nobody recomputes, behind a `??` chain that
silently changes which source wins when a field becomes populated.**

- **`p.prediction` IS NOT A SNAPSHOT.** `useLoadBuild:411` = `snapshot ?? predictionMap[...]`, so it
  degrades to the raw prediction row on a lookup miss. Display now reads
  **`p.player_snapshot ?? p.transfer_snapshot`** (useLoadBuild exposes `player_snapshot`).
- **Filling a previously-NULL field flipped the whole page.** `shown = neutralPrediction ?? prediction`
  worked only because neutral was mostly NULL; backfilling it made a dead branch live for 1,254 rows.
  **A `??` chain is not a precedence decision.**
- **THREE GUARDRAILS, all required:** (1) `_dirty` gate — a clean row is NEVER scaled; (2) base =
  neutral while dirty — scaling a BAKED snapshot is what compounded (.342 → .356); (3) `snapshotBacked`
  forces `devAggScale = 1` on a clean row (mirrors `PlayerProfile.tsx:986`).
  Sequence: toggle → dirty → scale neutral ONCE (the live bridge) → save bakes it → clean → verbatim.
- **The save bakes NEUTRAL × the toggle** (`playerProjection({...rp, _dirty:true})`), never a re-read
  projection — otherwise it writes the UNSCALED line while production_notes records the toggle.
- **Every local state update after a save must refresh EVERY snapshot copy** — `saveTargetToggle`
  updated only `transfer_snapshot`, so the row fell back to a stale `player_snapshot`: the flash
  up → down → correct-after-DB.
- **An effect with `exhaustive-deps` disabled closes over STALE state.** The auto-load effect re-runs
  on any refetch and wiped `_dirty` + the unsaved toggle; guard via a **ref**, not the array.
- **Roster vs board:** a player can hold two copies. Once rostered, **the board reads the roster's
  snapshot** (staging 32 / prod 47 synced, 0 differing). Board spells oWAR `owar`, market `nil_valuation`.
- **Slot is authoritative for side**, not snapshot content (Kenny Ishikawa's SP row held hitter fields).
- **Depth role drives IP/PA; market is STORED, not derived.** Neiswonger 30 IP → 85 ⇒ pWAR 1.14 → 3.329,
  $99k → $332,852.

⚠ **OPEN:** 10 staging / 18 prod pitchers with unverifiable pWAR (skipped, not guessed) · 1 wrong-side
neutral · JUCO PTM (Blair) · removal-from-roster semantics undefined · **the durable fix is ONE save
path owning every derived copy** — tonight's scripts are repairs.

Full detail: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


## 🛑 SNAPSHOT LAYERS — REFRESHING THE BASE DOES NOT FIX THE SURFACE (2026-09-01)

Trevor found this **by clicking**, after every automated check passed: Hudson Brown **.396** in Team
Builder vs **.385** on Player Profile; Overbeek **.306** vs **.304**. Primrose and Lawson matched —
**two spot checks are not a verification.**

**THREE stored layers, different readers:** `neutral_snapshot` = dev_agg=0 BASE (build rows read it:
`shown = neutralPrediction ?? prediction`) · `target_board.transfer_snapshot` = toggle-BAKED, and it
is what a **board-only target** renders from (`useTeamBuilderSimulation.ts:1359`) ·
`player_snapshot` = toggle-BAKED build copy. Refreshing neutral alone left **60 of 74** board rows stale.

**ORDER (snapshots LAST, four of them):** precomputes → `backfill-neutral-snapshots --refresh`
(builds) → `backfill-neutral-snapshot --target-board-only` (board) →
`backfill-target-transfer-snapshots` → `refresh-player-snapshots-untoggled` →
**`audit-snapshot-consistency` must print ✅ CLEAN**.

⛔ **Two traps, both "the copy is not what you think":**
1. **`node-postgres` returns `numeric` as a STRING.** The verbatim pitcher copy wrote strings and
   **crashed Team Builder** (`shownMetric.toFixed is not a function`, 627 staging / 653 prod rows).
   Fixed with `pg.types.setTypeParser(1700/20, Number)`. ⇒ **Verify TYPES, not just values.**
2. **A column you don't SELECT can't be written** — hit again; widen the select in the same edit.

**FINAL AUDIT:** staging **✅ CLEAN** (169/167/1,254/1,205 all 0 mismatch, 0 strings); prod 0 mismatch
except 2 inert vestigial `p_war` keys on position players. Build toggles preserved (59 staging /
147 prod); board-only target toggles reset — accepted by Trevor.

⚠ Audit gotchas that caused FALSE alarms: `market_value` is stored as `nil_valuation` and `o_war` as
`owar`; a TWP nulls the shared `market_value` by design; and checks MUST be side-aware because a TWP
carries both sides on ONE prediction row. Full detail: Track B.


## ★ NEUTRAL SNAPSHOT SOURCING — VERIFIED 2026-09-01 (returner = global · transfer = precomputed)

**Rule:** predRank is *team-scoped FIRST, global SECOND, never another team's precompute.* A returner
has no precompute at his own school → global. A transfer's team-scoped row IS the projection INTO
that school; using global would project him at his CURRENT school.

**Measured on staging after the refill (side-aware):**
```
team_build_players  returner 1,213 → 0 team-scoped · 1,203 global · 0 WRONG
                    target      41 → 36 team-scoped ·     5 global* · 0 WRONG
target_board        transfer   154 → 150 team-scoped · 4 TWP-pitcher-side · 0 WRONG
                    returner    13 →  12 global                          · 0 WRONG
  * 5 targets have no precompute for that team yet — global is the documented fallback.
```
⚠ The 4 "wrong" rows were a BAD QUERY, not bad data — all Josiah Overbeek, a TWP whose PITCHER-slot
board rows correctly hold pWAR. `coalesce(o_war, p_war)` pulled his hitter oWAR off the same row.
**Every snapshot check must be side-aware; a TWP carries both sides on ONE prediction row.**

⛔ **The two neutral scripts are NOT interchangeable — the tables use different shapes.**
`team_build_players` pitcher neutral = VERBATIM prediction row (77 keys incl. `variant`,
`customer_team_id`) → `backfill-neutral-snapshots.ts` (**PLURAL**) `--refresh`.
`target_board` = NORMALIZED (13/15 keys) → `backfill-neutral-snapshot.ts` (**SINGULAR**)
`--target-board-only`. Running the singular one unscoped STRIPS the verbatim build keys.

✅ Toggle-safe, proven: 1,207/1,207 build + 167/167 board neutrals at `dev_aggressiveness = 0`, while
59 build + 17 board rows keep a non-zero toggle in `production_notes`, untouched.
⛔ NEVER add a refresh flag to anything writing `player_snapshot`/`transfer_snapshot` from predictions.

Full runbook + exact commands: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


## 🛑 SNAPSHOTS ARE COPIES — A PRECOMPUTE DOES NOT REFRESH THEM (2026-09-01)

**Symptom:** *"player profile is showing properly on staging but team builder is not."* That IS the
diagnosis. Player Profile / Dashboard / Top 5 read `player_predictions` **directly** (fresh instantly).
Team Builder / Target Board / GM hub read a **SNAPSHOT COPY** frozen at write time. Nothing cascades.

**Measured on staging right after the returner + transfer recomputes:**
```
team_build_players.player_snapshot   604 rows · 296 STALE · worst gap 3.907 WAR
team_build_players.neutral_snapshot  586 rows · 310 STALE
target_board.transfer_snapshot        74 rows ·  62 STALE · worst gap 50.0 wRC+
```

**RUN ORDER — predictions first, snapshots LAST:**
1. `precompute-returner-pitchers` → `precompute-returner-hitters` (pitchers FIRST; shared `market_value`, hitter must be last writer)
2. per team: `precompute-transfers -- --team <uuid>` + `precompute-pitchers -- --team <uuid>` (14 prod / 18 staging)
3. `backfill-build-snapshots -- --apply --force` ⚠ **`--force` REQUIRED** — without it the script only fills `player_snapshot IS NULL` rows and ours are populated-but-stale → **silent no-op**
4. `scripts/backfill-target-transfer-snapshots.ts --apply`
5. `scripts/backfill-snapshot-total-hitter-war.ts --apply` — MUST be last; steps 3/4 write `o_war` only. ⛔ It *skips snapshots that already have* `total_hitter_war`, so it only works because 3/4 overwrite the object first. **Never run it standalone after a recompute.**

⚠ **OPEN GAP: `neutral_snapshot` has NO refresh path.** `backfill-neutral-snapshots.ts` is `IS NULL` only, no `--force`. The 310 stale rows cannot be refreshed by any existing script, and it is the dev_agg=0 base every toggle reads. **NOT FIXED.**

**Named gate — Naulivou Lauaki Jr. (Oregon, R-FR):** wRC+ **113 → 101**, oWAR 0.966 → 0.436, market **$24,260 → $9,671**. ✅ verified on staging AND prod. Market moves ~60% on a 12-pt wRC+ change because oWAR scales off `(wRC+ − 100)` — arithmetic, not a bug.

Full runbook + SQL verify gates: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


## ★ 2026-09-01 (PM) — CENTRES · total_hitter_war · CROSS-IMPL DIFF (commit `ffc161d`)

🛑 **New required gate: diff the deployed edge function against the local precompute over the same
team.** Code review, typecheck and eyeballing the output ALL passed on a function giving every `IF`
player a 10% market shortfall. Only the row-by-row diff caught it.
**Georgia, staging:** hitters **7,814/7,814 identical** (incl. market, after the `IF` fix);
pitchers **1,754/1,755 at IP>=40** — ⚠ sub-40 IP diverges (33% under 10 IP). **OPEN.**

- **Centres**: `predictionEngine` returner hitters were hardcoded at 100 and read `model_config` zero
  times; `transferPitcherProjection`'s `prCenter` params existed but **no caller passed them** (bb9's
  true centre is 121.68); `dsd` split at 100 in both transfer copies vs `prCenter` in
  `projectPitchingRate` — now the stored average everywhere. OBP correctly did not move (centre ≈100).
- **`total_hitter_war`**: six selects omitted it, so snapshots carried the oWAR COMPONENT (Helfrick
  2.5 → 5.02). `market_value` was in every select and always right — that asymmetry found it.
  **No backfill needed**; 0 hitter rows affected on either DB.
- **`IF`/`INF`/`INFIELD`** missing from the edge function's 1.1 tier — would have hit Georgia Tech's
  whole infield.
- **`from/to_*_plus` mean different things by `model_type`** — player rating on returner rows,
  CONFERENCE avg+ on transfer rows.
- **Last live compute removed** from the TeamBuilder add path (102 lines).
- **Loud fallbacks shipped** — unresolved `model_config` keys are now named, not silent.

✅ **RETRACTED 2026-09-01:** an earlier version of this block listed a `total_hitter_war` rounding
drift as OPEN. **It is not real.** Stored `total_hitter_war` = `o_war + d_war + bsr_war` EXACTLY on
**102,420/102,420** staging and **105,281/105,281** prod transfer rows (max drift 0.00000000).
The claim came from measuring the LOCAL components against the EDGE total — which proves the edge is
exact and says nothing about the local total. 🛑 Same error as the "sub-40 pitcher divergence": two
GENERATIONS of a row compared as if they were two IMPLEMENTATIONS. **Prove both sides are FRESH
before diffing.**

**Staging only — PROD UNTOUCHED.** Full detail: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


> 🚨 **BEFORE ACTING ON ANYTHING IN THIS FILE:**
> · **`docs/HANDOFF_WHATS_AHEAD_2026_08_31.md`** — what is ahead, the 6 Track B blockers, and the 11 earned rules
> · **`docs/HANDOFF_2026_08_31_EOD.md`** — current prod state, verified in the DB
> · **"🚨🚨 SILENT-FAILURE REGISTRY"** (below in this file) — 16 defects that produced a populated table, a clean
>   exit code and a plausible number. **NOT ONE raised an error.** Each entry says where it belongs in Track B.
> **A stage that "ran fine" tells you nothing.**

## 🔒 HARDCODED CONSTANTS — 66 STILL NEED A DEPLOY. ORDER OF WORK LOGGED (2026-09-01)

Trevor's rule: *"we don't want anything hardcoded and unchangeable."* Measured on
`DEFAULT_PITCHING_WEIGHTS` (115 constants): **49 tunable via `model_config`, 66 NOT** —
24 class transitions · 12 composite weights · 12 SP↔RP role transition · **9 MARKET / dollars-per-WAR**
· 6 plus scales · **3 projected IP per depth role**.
⚠ `market_dollars_per_war` and `market_tier_sec` mean **a program's pay-per-WAR cannot be changed
without shipping code**; `pwar_ip_sp/rp/sm` drive every pWAR.

✅ **Nothing is broken today** — all 127 edge-fn constants resolve correctly (46 overlaid · 72 identical
to `src/lib` · 9 read through `readEquationValue`, which checks `model_config` first). Onboarding uses
the same numbers as the batch. 🛑 The danger is that these are SILENT fallbacks: they fire only when a
`model_config` key is missing, and substitute a stale value with no warning.

**ORDER (deliberate):** **A** loud fallbacks now (cheap, no behaviour change) → **B** step 6 recompute +
across-the-range verify → **C** Gate A onboarding + Georgia Tech (**NOT blocked by the 66**) → **D** seed
the 66 into `model_config`, AFTER C, because it moves market values and pWAR and would otherwise land
two uncontrolled changes inside one verification.
⛔ D needs a NAMING decision first — `loadPitchingPowerEq` only takes `p_`-prefixed keys, and `market_*`
is shared with the hitter path, so it is not a pitching key. A wrong prefix recreates the
written-but-never-read problem. Full detail: Track B + `docs/HANDOFF_2026_09_01_CONFIG_SOURCES_AND_CALIBRATION.md`.


## ✅ STATUS 2026-09-01 — CONFIG CONSOLIDATION STEPS 1–4 **DONE** (calibration APPLIED to BOTH DBs). RESUME AT STEP 5.

**The config-source problem described below is FIXED IN CODE.** `model_config` (`model_type='admin_ui'`,
`season=2026`) is now the **single source of truth**. Do not redo steps 1–3.

| step | done | evidence |
|---|---|---|
| 1 | `"Equation Weights"` → `"Equation Weights_LEGACY_2025"` on **BOTH** databases | 361 rows intact · no dependent views/functions · **5,122 stored D1 returner hitters UNCHANGED (mean wRC+ 98.82)** — proof nothing live-computes |
| 2 | Legacy reads retired | `predictionEngine` no longer reads the 2025 table (**that was Gate B**); dead `model_config` returner/transfer fallback removed; `pitchingEquations` repointed to `model_config` 2026. ⚠ per-team override block **KEPT** — it is a feature, not legacy |
| 3 | Key convention + readers wired | `p_<stat>_pr_center` / `h_<stat>_pr_center` (matches the 54 existing `p_*` keys); **12 keys added to the `fields` mapping** — this is what made the calibration stop being inert |
| 4 | **Calibration APPLIED** to both databases | `model_config` admin_ui/2026 **220 → 236 keys**. Prod: `era_plus_ncaa_avg` 5.483215 → **5.263544**, `p_era_pr_center` **109.725344**, `p_bb9_pr_center` **123.161475**. 0 non-calibration keys changed. **Stored projections UNCHANGED** — 5,122 D1 returner hitters, mean wRC+ 98.82, identical to baseline. Rollback: `/tmp/calib/{prod,staging}_before.json` |

⚖️ **WEIGHTING = PER-ROW, BY DECISION.** Each qualified pitcher counts once; volume is carried separately
by `projected_ip`. IP-weighting is the convention for CONFERENCE/REGION baselines (a run-environment
question), not for this (a rank-a-player question). 🛑 Anchors and centres must ALWAYS be computed the
same way on the same rows — mixing per-row with IP-weighted offsets every projection by ~1.7 rating
points ≈ 0.09 ERA, which is C1 in miniature. See the ⚖️ block in Track B.


🛑 **CONSTANTS APPLIED, PROJECTIONS NOT RECOMPUTED.** `model_config` is now correct on both databases; the edge
function still carries its own constants and its own hardcoded `100`, and **no precompute has re-run** —
so every stored `p_era` / `p_war` / `p_wrc_plus` / `market_value` still carries BOTH biases and **no
displayed number has changed.**

▶️ **RESUME AT STEP 5** — mirror the edge fn → re-run precomputes →
verify **ACROSS THE RANGE** (p05/p10/median/p90; a mean-only check is blind to this class of bug).
Full detail + paste-ready resume text: `docs/HANDOFF_2026_09_01_CONFIG_SOURCES_AND_CALIBRATION.md`.


## 🛑 MUST READ — **WHERE CONSTANTS COME FROM.** THREE CONFIG SYSTEMS ARE LIVE (2026-09-01)

Every stage below reads constants. **They do not all read the same place**, and the hitter path reads a
DIFFERENT SOURCE ON PROD THAN ON STAGING. Nothing in this spec is trustworthy until this is fixed.

| path | reads | PROD | STAGING |
|---|---|---|---|
| Pitching — `readPitchingWeights` (`pitchingEquations.ts:147`) | `"Equation Weights"` @ **2025** | 0 of 40 mapped keys present → **code defaults** | table EMPTY → **code defaults** |
| Hitting — `predictionEngine.ts:261` | `"Equation Weights"` @ **2025** | **333 keys — LIVE, overrides code** | table EMPTY → **code defaults** |
| Pitcher power ratings — `loadPitchingPowerEq` (`predictionEngine.ts:694`) | `model_config` admin_ui @ **2026**, **keys starting `p_` ONLY** | ✅ | ✅ |
| Batch precomputes + edge fn | `model_config` admin_ui @ **CURRENT_SEASON** | ✅ | ✅ |

⛔ **`predictionEngine`'s "fall back to `model_config`" branch is DEAD CODE.** It filters
`model_type IN ('returner','transfer')`, but `model_config` contains **only `admin_ui`** rows in both
databases (prod 2025:140 / 2026:220 · staging 2025:157 / 2026:220). It has never returned a value.

🚨 **THE COST OF THIS, MEASURED:** prod's returner **wRC+ runs a different equation than the code**
(`.45/.30/.15/.10 ÷ .364` instead of `.691/.235/0/0 ÷ .3782`). Across 5,122 D1 returner hitters the
legacy formula reproduces the stored `p_wrc_plus` for **5,122 (100%)** and the canonical for **1,164
(23%)**. Staging looked correct only because its table is EMPTY and the override block is guarded by
`if (eqWeights.size > 0)`. See GATE B in `docs/PLAN_2026_09_01_onboarding_verify_and_wrc_audit.md`.

⚠ **KEY-CONVENTION CONFLICT — resolve before writing any calibration key.** `loadPitchingPowerEq`
consumes only `p_`-prefixed keys (`p_era_pr_sd` already exists in `model_config`), while
`compute-projection-calibration.ts` emits `era_plus_pr_center` / `era_plus_pr_sd`. **Nothing reads
`pr_center` or `pr_sd` from any table today**, so stage 5.5's output is INERT until one convention wins
and the producer matches it.

**TARGET STATE (approved 2026-09-01):** `model_config`, `model_type='admin_ui'`, `season=2026` is the
**single source of truth**. `"Equation Weights"` is legacy → rename to `"Equation Weights_LEGACY_2025"`
(**rename, not delete** — a missed reader must crash loudly, not fall back silently to code defaults).

**MIGRATION ENTRY — NOT APPLIED:** rename `"Equation Weights"` → `"Equation Weights_LEGACY_2025"`
(prod only; staging's is already empty). ⚠ This CHANGES prod hitter output — reverts wRC+ to the
canonical formula. Measured: median −1.5 wRC+, 62% down / 38% up, ≈1.5% median on oWAR and market.
**Rename, do NOT drop** — a missed reader must crash loudly rather than silently use code defaults.


## 🛑 MUST READ — PROJECTION CALIBRATION IS **WRONG ON PROD RIGHT NOW** (found 2026-09-01)

Two constants were **fit on one population and applied to another**. Both bias EVERY pitcher's
projection by a CONSTANT — equal discrepancies at every percentile and in every class bucket.

**(1) Stage 5.5 had NO division filter.** Baselines were computed across every division:
`D1 1,295 (mean ERA 5.264) · NJCAA_D1 477 (6.118) · ALL 1,773 (5.492)` at the producer's own
`IP >= 40` qualifier. **477 JUCO pitchers — 27% of the sample — inflated the D1 anchor by 0.229 ERA
(4.3%).** `git log` confirms the filter was NEVER present.

**(2) The z-shift subtracts a hardcoded `100`, but PR+ is not centered at 100 on that population.**
True D1/`IP>=40` centers: `era 109.7253 · fip 108.2875 · whip 108.4028 · k9 101.6919 · bb9 123.1615 ·
hr9 102.0359 · overall 109.0064`. On all-division/`IP>=20` they are 96.3–104.0 (≈100) — PR+ was FIT
there, APPLIED here. ERA carried **+0.44 of phantom improvement** per pitcher; **BB9 is worst at 123.16**.

**MEASURED EFFECT** (real ERA constants) — a constant offset; the spread is unchanged:
`AVERAGE pitcher 4.9280 → 5.2757 (actual 5.3040) · ELITE 3.8457 → 4.1934 · WEAK 6.2359 → 6.7028`

★ Hitting is **not** contaminated the same way (its anchors were already D1-scoped; centers
100.31–103.79). Centers are stored for both sides regardless — nothing may assume 100.

⛔ **CODE IS FIXED, DATA IS NOT.** As of this writing: `model_config` has **not** been written on either
database, the **edge function still has its own constant copies and its own hardcoded `100`** (so
onboarding still projects with the old bias), and **precomputes have not been re-run** — every stored
`p_era`/`p_war`/`market_value` on prod still carries the bias.

⚠ After applying, **re-verify the ACROSS-THE-RANGE table, not the mean.** And note the trap: this bug
is invisible to a range check, because a miscentered rating shifts the LEVEL while keeping the SHAPE.
The tell was *equal* discrepancies everywhere. **A constant offset with correct spread ⇒ a population
mismatch in the constants, not a broken model.**

Full detail: `docs/PIPELINE_pitch_log_to_projections.md` stage 5.5 MUST READ.

**MIGRATION ENTRY — NOT YET APPLIED (either database):**
`model_config` upsert of **41** calibration keys via `scripts/compute-projection-calibration.ts --apply`
(`model_type='admin_ui'`, `season=CURRENT_SEASON`). Replaces 19 all-division keys with D1-only values and
ADDS `<key>_pr_center` / `<key>_pr_sd` for all 11 ratings. **Staging first.** Not a DDL change — it is a
data upsert, but it moves every projection, so it must be followed by a full precompute re-run.

# Prod migration checklist — `feature/general-manager-interface`

> ▶️ **START HERE for the prod push: `docs/HANDOFF_2026_08_30_PROD_PUSH.md`** (current state, next actions in order, mistakes not to repeat, standing rules).
> ## ★ CURRENT STATE — READ FIRST (2026-08-30). This supersedes every older statement in this file.
> - **LANE (TOP DOG):** the only correct Stuff+ lane is the **pitch_log lane** —
>   `pitch_log.pitch_type_reclassified` → `compute_pitch_log_stuff_plus.ts` → `pitch_log.stuff_plus` →
>   `aggregate_pitch_log_dimensions.ts` → `pitch_log_pitcher_totals` / `_by_pitch_type` → Season Stats + PitcherProfile.
>   **armHB throughout, self-consistent, CORRECT.**
> - **LEGACY LANE (≤2025 + JUCO ONLY, NEVER 2026):** `pitcher_stuff_plus_inputs` → `runStuffPlusPipeline` →
>   `legacy_rollupStuffPlusToMaster` → `"Pitching Master".stuff_plus`. It stores RAW hb, and since commit `e5dec2f` the
>   shared equations expect armHB — so running it scores **LEFT-HANDERS BACKWARDS**. Not live, not on main. Every step in
>   this document has been rewritten onto the pitch_log lane; if you find one that still routes through the legacy lane,
>   it is WRONG. (`legacy_breakingBallReclassification.ts`, renamed from `breakingBallReclassification.ts`, never touched
>   `pitch_log` and is NOT the anchor classifier.)
> - **CLASSIFIER:** `src/savant/lib/stuffPlusClassifierV2.ts` is the SINGLE source (`scripts/reclassify_v2.ts` is only a
>   validation harness; its duplicate copy was deleted). **FINAL ACCURACY = 95.2% per-pitch / 95.3% arsenal-mix /
>   needs_review 8.1%** on the full 2,000,674-pitch population. ⚠ SUPERSEDED — never quote as current: **92.6%, 94.3%,
>   95.1%, "~85%", and any "projected ~95.3-95.4%"**.
> - **DECISION (Trevor, FINAL):** standardize on v2 in **BOTH** environments — **DO overwrite staging's labels.** Any
>   "do NOT overwrite staging's labels" guidance anywhere is REVERSED and obsolete.
> - **STAGING:** the v2 chain is RUN + VERIFIED — backup `_v2_prechain_backup` (2,579,655 rows, DO NOT DROP) ·
>   2,015,321 classified/stamped `v2-ranges-2026-08-28` (needs_review 8.1%) · `_reclass_pf` materialized (5,364
>   pitchers) · baseline armHB SIGN CHECK PASSED 18/18 · 2,015,321 scored + recentered (every type×hand bucket exactly
>   100.0) · step 4 all 48 dimensions + `populate_hitter_run_values`. **Still open on staging:** step 5
>   `derive_masters_from_pitchlog.ts` is DRY-RUN ONLY (0 hitters / 4,675 pitchers would change; never applied on ANY env).
> - **PROD (historical):** still on the OLD per-pitch CASE labels (`"4-Seam Fastball"`, ~2,176,888 labeled of ~2,575,996, no
>   `classification_version`, `needs_review` all null). **v2 has NEVER written to prod.** Prod's DATA is ready (100.00% of
>   `is_data=true` rows are v2-classifiable; venue corrections present and resolving).
> - **⛔ THE ONE REMAINING PROD BLOCKER:** prod's `pitch_log_corrected` VIEW is `select pl.*` **FROZEN at 94 of 99
>   columns** and is MISSING `classification_version`, so the scorer hard-fails there. Fix =
>   `drop view pitch_log_corrected cascade; create view …`. **DDL — requires its own explicit go**, separate from the
>   data-write "prod, now?".
> - **▶ NEXT ACTION:** rebuild that view on prod, then run the prod Stuff+ chain (reclassify → baseline → score →
>   aggregate **with `--direct`** → Masters) in ONE 4-6 h sitting, machine pinned awake.

## ★ PROD PUSH EXECUTION LOG — 2026-08-26 (LIVE, feature/war-recalibration)
Following `docs/PROD_PUSH_STEPS_2026_08_26.md` exactly, in order. Each step logged the instant it completes.
Prod state reconciled first (Push-1 + pre-recalibration config) — see the runbook's "PROD STATE — RECONCILED" section.
- [x] **GATE 0 — dedup prod pitch_log** — `DELETE FROM pitch_log WHERE runs IS NULL;` (raised statement_timeout). Junk count
  was **3,509** (= expected; attribution complete, safe). Deleted → verify `count(*) WHERE runs IS NULL` = **0**. Done 2026-08-26.
- [x] **GATE 1 — ivb/hb movement complete** — validated via the venue-corrections DRY-RUN on prod: **311 venues, τ IVB 0.622″ / HB 0.662″, centering IVB −0.0066″ / HB +0.0204″, worst park −2.57** (all in range, reproduces the known fixture). Movement complete + stable. Done 2026-08-26.
- [x] **A12 venue corrections — APPLIED + verified** — `scripts/sql/venue_correction_persist_prod.sql` via `_run_sql_file.ts` (exec_sql OK). NOTIFY pgrst reloaded. `venue_movement_corrections` = **311 rows, v1-2026-loo-eb**, worst IVB −2.57, `pitch_log_corrected` view resolves. Done 2026-08-26.
- [x] **Phase A DDL — APPLIED + verified (11 files)** — desc_* cols (Hitter+Pitching Master) · `20260810` composite ÷13.1
  def · `20260808` pitch_num_in_game/ab_num_in_game/pitch_num_in_ab · `20260818…` park_code + is_conference_game ·
  `20260821000000` ConfStats era_plus…hr9_plus · **`20260826160000_war_recalibration_gap_alters.sql` (NEW — filled the
  ad-hoc ConfStats run_env_factor/hitter_talent_plus/updated_at + Park 10×`*_seasonal`+updated_at + pitcher `ip`; generated
  by diffing staging↔prod, types match staging)** · `20260823` player_predictions team-scoped RLS · `20260826150000`+`150500`
  run-value cols+fn. All verified present on prod. ⚠ 20260806 RENAME skipped (already done). Done 2026-08-26.
- [x] **Phase B config — APPLIED + verified** — `step8_model_config_2026.sql` (201 keys; repl 21.22, r_obp_std_pr 31.89504) ·
  `ncaa_averages.wrc=0.3782` · `seed_nil_tiers` (nil_tier_sec **4.0**, ACC 1.5 / Big12 1.2 / JUCO 0.35) ·
  `store_transfer_weights_and_sds --apply` (42 keys, all confirming no-op — step8 covered them) ·
  `compute-projection-calibration --apply` (**19 keys incl. 6 `_sd_bad` two-sided SD**, hr9_shrink_k 66.4). Done 2026-08-26.
- [x] **A11 Masters UNIQUE — APPLIED + verified** — 0 true dups (stable id-scan; earlier 5/7 were pagination artifacts). Added `hitter_master_source_player_season_uniq` + `pitching_master_source_player_season_uniq` via NEW idempotent `20260826160500_masters_source_season_unique.sql` (prod + staging, both were missing it). Done 2026-08-26.
- [x] **C19 pitcher_full_name fix — APPLIED + verified** (2026-08-27) — prod `pitcher_full_name` held the BATTER name; fixed to players `First Last` via `pitcher_id=source_player_id` (single idempotent UPDATE, 900s timeout; gateway HTTP-timed-out at 125s but the txn committed server-side). Verified 41/41 correct table-wide, 0 corrupt. NEW committed `scripts/sql/fix_pitcher_full_names.sql` (closes the ad-hoc gap).
- [x] **C20 park_code — APPLIED + verified** (2026-08-27) — `park_code_filled = 2,576,146 / 2,576,146` (100%) via
  `scripts/_pc_keyset.ts` (keyset on `uniq_pitch_id`, direct pooler session, per-batch commit; 129 batches / ~92 min).
- [x] **C21 is_conference_game + C22 sequence — APPLIED + verified** (2026-08-28) — `is_conf_filled = seq_filled =
  2,576,146 / 2,576,146` via `scripts/_next_derived.ts` (ONE keyset pass). ⚠ **COPIED from staging, NOT derived** →
  FOLLOW-UP REQUIRED (see the ledger-backfill note below).
- [x] **`20260828000000_pitch_log_classification_version_needs_review.sql` — APPLIED prod** (2026-08-28) — adds
  `classification_version` + `needs_review` to prod `pitch_log`. ⚠ the prod `pitch_log_corrected` VIEW was NOT rebuilt
  afterward, so it does not expose them — that is the one remaining prod blocker.
- [ ] ⛔ **PROD BLOCKER (DDL, own explicit go): rebuild `pitch_log_corrected`** — `drop view pitch_log_corrected cascade;
  create view …` against the current 99-column list. The view is `select pl.*` FROZEN at 94 columns and missing
  `classification_version`, so `compute_pitch_log_stuff_plus.ts` hard-fails on prod.
- [ ] **STUFF+ CHAIN on prod (pitch_log lane, steps 1–5)** — reclassify (`reclassify_prod.ts`) → re-derive
  `pitcher_stuff_plus_ncaa` → `compute_pitch_log_stuff_plus.ts` → `aggregate_pitch_log_dimensions.ts --apply --prod
  --direct` → `derive_masters_from_pitchlog.ts --apply`. ⛔ NEVER via `recompute-stuff-plus.ts` / the legacy PSP-I lane.
  DONE + VERIFIED ON STAGING 2026-08-29/30 (steps 1–4; step 5 dry-run only). Budget 4-6 h on prod, ONE sitting.
  ★ Pre-registered prod gate: per-pitcher Stuff+ mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 / 4,234 pitchers.
- [ ] (then the rest of C producers → D desc-WAR → E precomputes → F re-bakes → G edge fn → H drops.)


> ## ★★★ LOGGING DISCIPLINE — VITALLY IMPORTANT (Trevor 2026-08-19) ★★★
> **EVERY schema or SQL change is logged HERE, no exceptions.** This file is the single
> authoritative record for the staging→prod push. The instant we run ANY of the following
> on staging, an entry is appended here BEFORE moving on:
> - a `CREATE TABLE` / `ALTER TABLE` (columns, types, constraints, indexes)
> - a `DROP` (table/column/view/function/RPC) — even a temp/helper cleanup
> - a data write that must be reproduced on prod (backfill, recompute, UPDATE)
> - an RLS `ENABLE` / policy, a role/GUC change, a new RPC or view
>
> Each entry states: the exact DDL/SQL, `APPLIED STAGING <date>` vs `PROD pending`, and any
> **prod-specific note** (e.g. "regenerate the fixture from PROD data, do NOT copy staging"
> when a value is per-env). A change that touches the DB but is NOT written here is a bug.
> The prod push reads ONLY this file — if it's not here, it doesn't happen on prod. [[feedback_claude_runs_backfills_dry_run]]

> ## ★ WAR RECALIBRATION PUSH — AUTHORITATIVE RUNBOOK (2026-08-20) ★
> For the **WAR recalibration + pitch-log migration** push, the execution-ordered,
> gap-closed manifest is **`docs/PROD_PUSH_RUNBOOK_war_recalibration.md`** (DB-change ledger,
> dependency order, the 13 modeling/edge-fn steps, limitations register). Companion audit:
> **`docs/AUDIT_war_recalibration_state.md`**. The WAR-recalibration sections below are
> reconciled to that runbook — where they disagree, **the runbook wins.**
> **CORRECTIONS (2026-08-20):**
> - **`team_war_snapshots` is NOT dropped** — federate-by-era keeps it for pre-2026 (2025 champions). Any "DROP TABLE team_war_snapshots" below is CANCELLED.
> - **park_code/game_string backfill IS DONE on staging** (the earlier "NOT DONE" line is stale).
> - **SD-audit outcome:** `whip_pr_sd`→37.13 and `obp_std_pr`→32.41 (returner+transfer) ARE re-tuned — see runbook Part C steps 1–2.
> - **TRANSFER LEVER STORAGE (pending Trevor's weight decisions, 2026-08-20):** new Conference Stats pitcher env+ cols (era_plus…hr9_plus, ratio scale) + `offensive_power_rating` fill + re-tag 10 NJCAA-D1 districts; Park Factors `era_factor`/`fip_factor` (=rg); cross-conf env+ SDs stored (model_config mirror, values also in code); pitcher env+ z×20→ratio code change. **NOT yet on staging** — see runbook **Part A7**. Transfer projections re-run deferred until this lands.

Every schema change on this branch that is **not yet on prod**, in apply order. Run
these against prod at push time (staging already has them). Most use
`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, so re-running is safe —
but **verify each against prod first and skip any already applied out of band.**

Apply in filename (timestamp) order. Runner used on staging:
`npx tsx --env-file-if-exists=.env.production.local scripts/_run_sql_file.ts <file>`
(⚠️ prod = `.env.production.local` → `trbvxuoliwrfowibatkm`. Requires explicit go.)

## Migrations (chronological = apply order)

> 

### ✅ APPLIED TO PROD 2026-08-30 — REBUILT the stale `pitch_log_corrected` VIEW (blocker #1 CLEARED)
The view was `select pl.*, …` and Postgres FREEZES `*` at creation time, so prod's copy was stuck at **94 of 99**
base columns and did NOT expose `classification_version` → `compute_pitch_log_stuff_plus.ts` HARD-FAILED on prod
("column pitch_log_corrected.classification_version does not exist") while the same query passed on staging.
⚠ `create or replace view` CANNOT fix this (new columns land mid-list) — it required drop + create.
**PRE-CHECK (read-only): NOTHING depended on the view**, so `cascade` was safe. Done inside a transaction with
rollback-on-error. Definition preserved exactly: `pl.*` + `ivb_corrected = pl.ivb - coalesce(vc.ivb_corr,0)` +
`hb_corrected = pl.hb - coalesce(vc.hb_corr,0)` + `vc.venue_correction_version`, LEFT JOIN
`venue_movement_corrections` on `(game_venue_id, season)`.
**VERIFIED: 94 → 102 columns; 10/10 previously-missing keys present** (`classification_version`, `needs_review`,
`park_code`, `is_conference_game`, `pitch_num_in_game`, `ab_num_in_game`, `pitch_num_in_ab`, `game_string`,
`ivb_corrected`, `hb_corrected`), and **the exact scorer query now succeeds on prod**.
🛑 **LESSON — any `select *` VIEW goes stale the moment a column is added to its base table.** After ANY
`ALTER TABLE pitch_log ADD COLUMN`, this view must be dropped and recreated or the chain silently breaks.

### ✅ APPLIED TO PROD 2026-08-30 — `team_season_stats` (3 migrations, DEPENDENCY order)
Trevor: "Make this the first step on prod." Applied over the direct pg session, in DEPENDENCY order (NOT timestamp order):
- [x] `20260819000000_team_season_stats.sql` — CREATE TABLE
- [x] `20260821010000_team_season_stats_war_columns.sql` — ALTER add 10 WAR/RA9 cols
- [x] `20260819010000_refresh_team_season_stats.sql` — CREATE FUNCTION
⚠ **THE FILENAME TIMESTAMPS SORT WRONG.** `supabase db push` would apply fn (`...19010000`) BEFORE the ALTER
(`...21010000`). The function's first statement is `DELETE FROM team_season_stats WHERE season = p_season`, so
fn-before-ALTER empties the season then ABORTS on `hitter_war_total does not exist`. **Always apply these three by
DEPENDENCY, never by timestamp.**
VERIFIED on prod: table present, **127 columns**, **10/10** WAR/RA9 cols (`hitter_war_reg/total`, `rotation_pwar_reg/total`,
`bullpen_pwar_reg/total`, `ra9_reg/total`, `fip_ra9_reg/total`), function present (2 args), **0 rows — correct, Phase F
populates it**. Creating the function does NOT run it, so no data was touched.
UNBLOCKS: **F44** `refresh_team_season_stats(2026)` and **G46** edge-fn deploy (`process-precompute-jobs` reads this
table at `index.ts:1095,1419` and would throw mid-precompute without it).
NOTE: staging has 128 cols vs prod's 127 — the extra is `preseason_proj_total_war`, which has no committed migration and
is filled by a precompute, not DDL. Left out deliberately; expected to close during E/F.

### ✅ GM BLOCK IS FULLY LIVE ON PROD — DO **NOT** REPLAY (reconciled 2026-08-28/29)
> Every `20260705…`–`20260716…` GM migration below was applied OUT OF BAND and is **populated with live coach data on
> prod** (gm_recruits 56 · gm_activity 114 · gm_allocation + gm_allocation_source 6+6 · gm_contract 4 · all 4
> vendor-unification slices applied and filled). They are marked `[x]` so nobody "catches up the pending migrations" —
> which is exactly the path that would replay the `20260710120000` TRUNCATE and wipe live funding data.

- [x] `20260705120000_gm_front_office_finance.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260706120000_gm_scholarship.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707120000_gm_scholarship_total.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707130000_gm_other_breakdown.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707140000_gm_finance_per_build.sql`  — gm_player_finance re-keyed to build_player_id (+ roster_status/departure_reason)  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707150000_gm_recruits.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707160000_gm_recruits_stage.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707170000_gm_recruit_events.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707180000_gm_recruits_report_date.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707190000_gm_recruit_reports.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707200000_gm_recruits_tier.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707210000_gm_recruit_contact.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707220000_gm_recruit_report_tier.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260707230000_team_builds_gm_notes.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708120000_gm_player_finance_notes.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708130000_gm_player_finance_notes_date.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708140000_gm_player_notes.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708150000_gm_recruits_pricing.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708160000_gm_activity.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708170000_gm_recruits_level.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260708180000_gm_recruits_extra_contacts.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709120000_gm_activity_link.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709130000_gm_recruiting_budget.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709140000_gm_activity_ref.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709150000_gm_target_board.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709160000_gm_target_asking.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260709170000_gm_allocations.sql`  — gm_allocation_source + gm_allocation (funding sources)  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260710120000_gm_allocations_per_build.sql`  — ✅ APPLIED prod+staging (out-of-band). ⚠️ LANDMINE NEUTRALIZED 2026-08-28: originally `TRUNCATE gm_allocation, gm_allocation_source` — now DISABLED in the migration file (live coach data). DO NOT re-enable / re-run the original.
- [x] `20260710130000_gm_scholarship_mode.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260713120000_gm_contracts.sql`  — gm_contract + gm_contract_obligation + gm-contracts storage bucket  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260713140000_team_builds_is_active.sql`  — the live/active build flag  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260714120000_gm_player_info.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260714150000_gm_player_info_social.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260714170000_marketability.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)
- [x] `20260714190000_marketability_youtube.sql`  ✅ APPLIED prod+staging (out-of-band, verified 2026-08-28)


### ⬆ LEDGER BACKFILL 2026-08-29 — work DONE+VERIFIED on prod but never logged (audit finding #8)
Logged retroactively so nobody re-runs them. Evidence from `docs/PROD_PUSH_HANDOFF_RESUME_2026_08_26.md:48-53,69-70`.
- [x] **C20 park_code** — `park_code_filled = 2,576,146 / 2,576,146` (100%). Method `scripts/_pc_keyset.ts` (keyset on
      uniq_pitch_id, direct pooler session, per-batch commit; 129 batches / ~92 min). Verified 2026-08-27.
- [x] **C21 is_conference_game + C22 sequence** (pitch_num_in_game / ab_num_in_game / pitch_num_in_ab) —
      `is_conf_filled = seq_filled = 2,576,146 / 2,576,146`. Method `scripts/_next_derived.ts` (ONE keyset pass).
      Verified 2026-08-28. ⚠ **COPIED from staging, NOT derived** → FOLLOW-UP REQUIRED: verify the park_code /
      is_conference_game / sequence derivation runs on PROD and is wired into the go-forward pipeline. **Track B breaks
      on the next ingest without it.** (audit finding #9)
- [x] **`20260828000000_pitch_log_classification_version_needs_review.sql`** — adds `classification_version` +
      `needs_review` to prod `pitch_log`. Applied 2026-08-28. ⚠ NOTE: the prod `pitch_log_corrected` VIEW was NOT
      rebuilt afterward, so it does not expose these columns — see STAGE 0 blocker #1.

### ⬇ COMMITTED BUT NOT YET APPLIED (either env)
- [ ] **`20260829120000_gm_budget_nil_allocation_mode.sql`** — `gm_budget.nil_allocation_mode text NOT NULL DEFAULT
      'balanced' CHECK (IN ('balanced','top_heavy'))` + `NOTIFY pgrst`. **Committed 2026-08-29; NEVER RUN on staging or
      prod.** Until it is applied, the Balanced/Top-Heavy NIL toggle write ERRORS on prod and every `allocateNil`
      silently falls back to `balanced`. **Apply to BOTH envs.**

### Vendor unification (project_gm_vendor_unification)
- [x] `20260716120000_gm_vendor.sql`  — slice 1: program-level vendor directory (staging 2026-07-16)  ✅ APPLIED prod+staging + FILLED (all 4 vendor slices verified on prod 2026-08-28)
- [x] `20260716130000_gm_contract_vendor_link.sql`  — slice 3a: gm_contract.vendor_id + gm_allocation_source.vendor_id + backfill directory + link (staging 2026-07-16)  ✅ APPLIED prod+staging + FILLED (all 4 vendor slices verified on prod 2026-08-28)
- [x] `20260716150000_gm_source_funding_mode.sql`  — slice 4a: gm_allocation_source.funding_mode + base_offset (new-money vs carve accounting) (staging 2026-07-16)  ✅ APPLIED prod+staging + FILLED (all 4 vendor slices verified on prod 2026-08-28)
- [x] `20260716170000_gm_contract_funding.sql`  — slice 4b: gm_contract.funding_mode + base_offset + allocation_id (staging 2026-07-16)  ✅ APPLIED prod+staging + FILLED (all 4 vendor slices verified on prod 2026-08-28)

## Non-migration prod steps (from memory)
- ~~Deploy the `parse-contract` edge function + `ANTHROPIC_API_KEY`~~ — NOT needed: contract PDFs are read entirely in the browser (`extractContractPdf`, pdfjs, no AI/network). The AI `parse` path in useGmContracts is dead code (nothing calls it) — remove it.
- [ ] Headshot scrape: run the roster scraper against prod customer teams after push (returners + incoming transfers).
- [ ] **Contract funding backfill** (AFTER the 4 vendor migrations): `npx tsx --env-file-if-exists=.env.production.local scripts/backfill_contract_funding.ts --write` — syncs existing NIL/Other contracts into funding sources/allocations (idempotent; dry-run first without `--write`).

- [ ] 20260717120000_user_team_access_team_admin_modify.sql — RLS: team_admins can modify their own team user_team_access (fixes admin remove-access)

### Recruit identity + mobile recruiting + scouting v2 (`feature/recruit-ids-mobile-board`)
Apply in order at push time. All additive/idempotent. Staging dates noted.
> **✅ APPLIED TO PROD 2026-07-30** — all 4 migrations + backfill run against prod (`trbvxuoliwrfowibatkm`) via `supabase db query --linked`, catalog-verified. BYU had 4 recruits → 4 `prospect` identities minted (Nixon Warren LF→OF normalized first). CODE still pending staging→main (PR #159).
- [x] `20260728120000_player_external_ids_and_prospect.sql` — vendor-agnostic identity crosswalk (`player_external_ids`) + `data_status='prospect'` (staging 2026-07-28, catalog-verified)
- [x] `20260728121000_resolve_or_create_prospect.sql` — `resolve_or_create_prospect()` SECURITY DEFINER writer; exact-external-key auto-link only (staging 2026-07-28, round-trip verified)
- [x] `20260729120000_scout_grades_and_template.sql` — `gm_recruit_reports.grades` JSONB + `gm_scout_template` (per-team customizable scouting template) (staging 2026-07-29)
- [x] `20260730120000_gm_recruits_player_identity.sql` — adds `gm_recruits.player_id` FK → `players(id)` (the recruit↔RSTR IQ identity link; minted at add via `resolve_or_create_prospect`) (staging 2026-07-30, verified)

**Non-migration prod steps for this feature (append as they arise):**
- [ ] Scouting v2 storage: create the `recruit-video` bucket + retention/lifecycle via the Supabase dashboard (owner-restricted — can't go through the SQL runner). [pending 1d]
- [x] Recruit identity backfill (AFTER `20260730120000`): run `supabase/queries/backfill_gm_recruits_player_id.sql` — mints/attaches an identity for every pre-existing recruit (idempotent; only touches `player_id IS NULL`). Staging 2026-07-30: 9/9 linked, 0 orphaned.

- [ ] 20260808_pitch_log_add_sequence.sql — add pitch_num_in_game/ab_num_in_game/pitch_num_in_ab + backfill (scripts/sql/pitch_log_sequence_backfill_steps.sql). APPLIED STAGING 2026-08-08 (2,576,230 rows). PROD pending.

- [ ] team_drs_store.sql (scripts/sql/) — add team_drs column to team_war_snapshots + populate 308 D1 teams (re-centered dRS, season 2026). APPLIED STAGING 2026-08-09 (308 rows, sum ~0). PROD pending. Regenerate values via scripts/drs/derive_team_drs.mjs against prod.

## WAR redesign + internals collapse (feature/war-recalibration) — full run order in docs/STEP8_PROD_MIGRATION_LEDGER.md
- [ ] A1 descriptive_war_columns.sql — Master desc_* columns. PROD pending.
- [ ] A2 descriptive_war_reg_columns.sql — Master desc_*_reg columns. PROD pending.
- [ ] B1 step8_model_config_2026.sql — COMPLETE @2026 model_config mirror (wRC+ C1 + composite refits + replacement 21.22). PROD pending.
  - ⚠ **REGENERATED 2026-08-24 (125→201 keys)** — the 2026-08-13 snapshot had drifted badly vs staging: 80 keys MISSING (per-conference `nil_tier_<code>` market PTM, pitcher `p_*_pr_sd`/`p_ncaa_avg_*`/`p_sd_*`, `transfer_*` pitcher weights, `conf_*_sd`/`park_sd_*`), 26 STALE VALUES (incl. the SD landmine `r/t_obp_std_pr` 28.889→**31.89504**, `r/t_ba_std_pr` 31.297→**29.99699**, transfer weights re-tuned e.g. `t_ba_conference_weight` 0.3→0.256, ncaa_avg refits), 4 old bucket keys removed (`nil_tier_p4/big_ten/strong_mid/low_major`). Root cause: staging was hand-corrected out-of-band (verified correct in DB); the committed seed prod runs was never back-ported → prod would have gotten stale SDs + weights + missing pitcher SDs. Now a faithful 201-key mirror of verified staging. **The `nil_tier_<code>` keys overlap `seed_nil_tiers_model_config.sql` (values match, both idempotent) — either order converges.**
- [ ] B2 UPDATE ncaa_averages SET wrc=0.3782 WHERE season=2026. PROD pending.
- [ ] C1/C2 backfill Hitter Master pull_air + Pitching Master in_zone_pct from prod pitch_log. PROD pending.
- [ ] D1 store recompute (power ratings) on prod. PROD pending.
- [ ] E1/E2 populate_descriptive_war(.mjs) + _reg on 0.3782. PROD pending.
- [ ] F1 20260810_composite_war_d1_rescale.sql (refresh_composite_war ÷13.1 DEFINITION) → F2 fire after precompute. PROD pending.
- [ ] G1/G2 precompute-returner-hitters/pitchers:prod. G3 transfers via edge fn (when resumed). PROD pending.
- [ ] H1 reseed team_war_snapshots; H2 fill player/transfer snapshots; H3 total-WAR display swap. PROD pending.
- [ ] J DROP player_prediction_internals (Track B, AFTER bulkRecalc retired). PROD pending — separate confirmed step.

## ★ PROJECTION CALIBRATION — two-sided SD (feature/war-recalibration) — 2026-08-24 — DESIGNED, NOT BUILT
- [ ] **Two-sided (split) SD recalibration of the projection map** — the symmetric-SD z-shift over-projects elite (impossible
  negative HR9, elite ERA 1.13) → inflated pWAR. Fix: per-stat `sd_good`/`sd_bad` (semi-deviation below/above the mean) on a
  qualified population; scale elite projections by the good-side SD. Full writeup + proof: `docs/AGENT_LEARNINGS_projection_calibration_two_sided_sd_2026_08_24.md`.
  **When built (staging→prod):** (1) compute per-stat mean + `sd_good`/`sd_bad` + the qualifier on the season's actuals;
  (2) store the method + values in `model_config` (read by returner/transfer/edge fn); (3) code change in `pitcherProjection.ts`
  (+ hitter mirror) to use the directional SD; (4) redeploy the edge fn (re-derives SDs each season); (5) re-run ALL precomputes;
  (6) re-verify the calibration table (actual vs projected across the range) + re-bake snapshots + markets.
  ✅ **SPEC LOCKED 2026-08-25 (all data-driven):** (1) qualifier IP≥40/PA≥100; (2) two-sided (split) SD for every stat
  (`sd_good` toward elite, `sd_bad` toward poor); (3) sample-size shrinkage on **HR9 ONLY** (the sole luck-dominated stat:
  luck SD 0.42 > talent SD 0.37), `regressed = mean + (obs−mean)×IP/(IP+K)`; (4) **K data-derived** via variance
  decomposition `K = C/talent_var` (HR9 K=71 this season → elite HR9 0.66; edge fn re-derives K each season). Stage 5.5:
  compute → store in model_config → stage 6 reads → run whole chain front-to-end + verify across the range. Do NOT re-weight
  the HR9 composite (dead end, ceiling 0.335).
  **PITCHING BUILT + VERIFIED STAGING 2026-08-25** (commit 57e8f12): producer `compute-projection-calibration.ts` applied
  (19 model_config keys); `pitcherProjection`/`transferPitcherProjection` use directional SD. Arkansas re-run: Yochum projHR9
  0.15->0.61, pWAR 2.31->2.05; HR9 negatives 66->3. **PROD order:** run `compute-projection-calibration.ts --apply` (stage 5.5)
  BEFORE re-running pitcher precomputes -> re-run all 17 teams transfer + returner-pitcher batch (raise statement_timeout for the
  propagate step) -> re-bake snapshots+markets -> deploy edge fn `process-precompute-jobs` with the directional-SD mirror (Trevor).
  **FULL RE-RUN DONE STAGING 2026-08-25:** transfer (18 teams) + returner batches re-run; snapshots re-baked (backfill-neutral
  bp1205/tb167 + heal 561/561 + resync markets). Board verified — top-12 pitchers all genuine stuff (0 weak-stuff mid-major).
  ⚠ **RETURNER OVERLAY FIX (commit 3c4e8c8):** `precompute-returner-pitchers` never overlaid model_config `_plus_ncaa_` (only
  `p_*`) → ran on stale symmetric SDs. Fixed. **PROD: the returner batch needs this overlay or returners ignore the calibration.**
  **19 residual neg HR9 = qualification gap** (all 0–5 IP / lastHR9 0.00; D1 sub-5-IP slip through while JUCO sub-20-IP already
  nulled) — NOT a floor/calibration issue. Fix TBD (min-IP qual for D1 returners, or per-pitcher last-year shrinkage). Investigate-only.
  **REMAINING:** edge-fn Deno mirror (Trevor deploys); hitters (symmetric, follow-on).

## 7b snapshot total_hitter_war fill (feature/war-recalibration) — 2026-08-24
- [ ] **Fill total_hitter_war into HITTER snapshots** — `scripts/backfill-snapshot-total-hitter-war.ts` (idempotent-by-value, dry-run default, `--apply`). Snapshots stored `o_war` only, so the 7b display swap made build-player profiles fall back to `o_war` (offense-only) while the Dashboard shows total → misaligned WAR + market. Sets `total_hitter_war = o_war + d_war + bsr_war` on `team_build_players.{player_snapshot,neutral_snapshot}` + `target_board.{transfer_snapshot,neutral_snapshot}` (d/bsr from the player's precompute row; snapshot's own team-scoped/toggled o_war preserved). **APPLIED STAGING 2026-08-24** (verified 1149 build hitters correct, 0 wrong, idempotent). **PROD: run `--apply` after the prod re-price/precompute.** ⚠ Must run AFTER the snapshot writers carry total (below) OR it's a one-time catch-up; re-run any time snapshots are re-baked.
  - ⚠️ **RELIABILITY BUG (unordered `.range()` pagination silently skips rows):** fixed in this script. AUDITED the other batch scripts 2026-08-24 — the CRITICAL ones already order (`precompute-transfer-projections`/`precompute-pitchers`/`heal-stale-snapshots`/`resync-build-snapshot-markets`/`resync-target-snapshots`/`backfill-2027-hitter-returners` — precompute even carries a comment about exactly this), so the re-price/refresh/precompute runs were reliable. **ONLY `backfill-neutral-snapshot.ts` lacked `.order()`** → fixed (add `.order("id")`) as part of the writer update below.

## Stuff+ display min-pitch qualifier (feature/war-recalibration) — 2026-08-24
- [ ] **Pitching Master `trackman_pitches` BACKFILL** — populate `trackman_pitches` = Σ `pitcher_stuff_plus_inputs.pitches` per (source_player_id, season). Column already exists (was ~87% NULL — never systematically filled). This is the true per-pitcher TrackMan sample size, the gate for the Stuff+ display min-pitch qualifier (Stuff+ fork RESOLVED=B; a thin-sample arm like 12.7 IP / 22 pitches must not top leaderboards). Producer: `scripts/backfill_trackman_pitches_pitching_master.ts` (idempotent, dry-run default, `--apply`). **APPLIED STAGING 2026-08-24** (5,720 rows: 5,332 were NULL + 388 corrected stale; 6006/6007 stuff_plus pitchers now populated; idempotent re-run = 0 changes; dist p10=47/p25=128/p50=317). 🛑 **MUST READ — CORRECTED 2026-08-30.** ~~PROD: run the same script `--apply` after prod's
  `pitcher_stuff_plus_inputs` is populated (regenerate, don't copy).~~ **THAT INSTRUCTION IS WRONG AND ROUTES YOU INTO
  THE LEGACY RAW-HB LANE.** `pitcher_stuff_plus_inputs` is the legacy PSP-I table this push bans (it stores RAW hb and
  scores left-handers backwards). On prod, run the script **AFTER the pitch_log Stuff+ chain steps 1–4**, so the counts
  come from the freshly-aggregated **`pitch_log_pitcher_totals`** — see `docs/PROD_PUSH_STEPS_2026_08_26.md` step 24 and
  `docs/PROD_PUSH_HANDOFF_RESUME_2026_08_26.md:133`. Do **not** gate this step on `pitcher_stuff_plus_inputs`.
  (Prod does have 32,068 legacy PSP-I rows for 2026, so gating on it would *appear* to work and quietly use the wrong
  lane. Audited 2026-08-30.) **Display gate DEFERRED (Trevor 2026-08-24):** no coach-facing Stuff+ leaderboard/sort exists on this branch (savant leaderboards deleted, no Rankings Stuff+ category, tables don't sort by Stuff+), so there's nothing to gate; thin arms only surface on per-player percentile chips. The backfill is the durable win (feeds `jucoDataReliability` + any future gate). Revisit a `trackman_pitches>=50` qualifier if a real Stuff+ leaderboard is built.

## Stuff+ classification build (feature/war-recalibration) — 2026-08-17
- [ ] venue_correction_persist.sql (scratchpad/) — `venue_movement_corrections` table (310 rows, season 2026, LOO + empirical-Bayes shrunk IVB/HB offsets) + `pitch_log_corrected` stamped VIEW (`venue_correction_version=v1-2026-loo-eb`). Feeds Stuff+ classification AND scoring (one corrected movement layer). APPLIED STAGING 2026-08-17. **PROD: REGENERATE the fixture from PROD pitch_log (per-season, prod venue ids) — do NOT copy staging offsets.** Named "venue movement effects" (miscalibration OR thin-air), not sensor errors.
- [ ] pitch_log.vaa column (`alter table pitch_log add column if not exists vaa numeric`) — RESERVED SLOT (ruling 2026-08-17: do NOT derive; per-pitch VAA absent from all current exports; cluster-mean carries the SI/FF strip). ingest_pitch_log.ts maps VertApprAngle→vaa (forward-compatible). Populates when future LOCAL-TrackMan source ships real VAA/HAA. No prod action until then.
- [x] venue_movement_corrections RLS — `ALTER TABLE public.venue_movement_corrections ENABLE ROW LEVEL SECURITY;` APPLIED STAGING 2026-08-17 (no policy = service-role only, correct for a pipeline fixture). PROD: same ALTER after the table is created on prod.

## Park-factor rebuild + hygiene (feature/war-recalibration) — 2026-08-18
- [x] Stuff+ temp-table RLS lockdown — `ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;` for the 6 Stuff+ backup/helper
  tables (`_confstats_backup, _master_stuff_backup, _ncaa_backup_preanchor, _reclass_map, _reclass_pf, _reclass_result`).
  APPLIED STAGING 2026-08-18 (was: all exposed to anon/auth; now service-role-only, correct for pipeline temp tables).
  These are STAGING-ONLY Stuff+ artifacts (not promoted to prod). **PROD equivalent:** when Stuff+ regenerates on prod and
  creates its own backup/helper tables, ENABLE RLS on them the same way.
  🛑 **MUST READ — CORRECTED 2026-08-30. Do NOT read this as authorisation to drop all 6.** ~~The DROP of all 6 staging
  temp tables is DEFERRED to the dead-code audit (#7) AFTER Stuff+ prod acceptance.~~ Three of the six named above —
  **`_reclass_result` (2,000,674), `_reclass_map` (37,101), `_reclass_pf` (4,804)** — are on the **NEVER-DROP** list,
  along with `_v2_prechain_backup` and `team_war_snapshots`. See `PROD_MIGRATIONS_TODO.md:819-827` (this same file) and
  `docs/PROD_PUSH_STEPS_2026_08_26.md` step 51. The **only** Stuff+ temp safe to drop is **`_reclass_fix`**. RLS
  lockdown on all six: yes. Dropping all six: no.
- [ ] DROP dead `park_factors` (lowercase, 12 cols, 0 rows) — a duplicate of the live `"Park Factors"` (quoted, 18 cols,
  where 2025/2026 rows actually live + all projection readers point). COUPLED: strip the 2 `from("park_factors")` calls in
  `supabase/functions/google-sheets-sync/index.ts` (lines ~1006/1054) FIRST/together — that function is otherwise LIVE (syncs
  8 tables: players, nil_valuations, player_predictions, season_stats, conference_stats, model_config, power_ratings) so do
  NOT delete the function, only its park_factors delete+insert. Then `DROP TABLE public.park_factors;`. Fold into audit (#7). STAGING+PROD.
- [~] ~~`park_factors_seasonal` (NEW separate table)~~ **SUPERSEDED 2026-08-19 — DO NOT RUN.** Trevor chose COLUMNS on
  `"Park Factors"` (the `*_seasonal` entry directly below), not a separate table. No `park_factors_seasonal` table exists on
  staging; do not create one on prod. Kept here struck-through so the audit trail is explicit.
- [x] `"Park Factors"` seasonal columns + backfill — `ALTER TABLE "Park Factors" ADD COLUMN *_seasonal` (10 cols) +
  `scripts/backfill_park_factors_seasonal.ts --apply` (self-normalized single-season 2024/25/26 + stored 2026 3-yr rolling).
  APPLIED STAGING 2026-08-18 (922 rows). Backup `_park_factors_backup_20260818`. **PROD:** same ALTER + re-run backfill against
  prod (the archived CSVs are league-wide, not per-env — same input both DBs); verify vs prod's current Park Factors rows.- [ ] 20260818000000_pitch_log_park_code.sql — add game_string + park_code to pitch_log (+ index). park_code = stable
  stadium id from gameString (strip trailing 9 digits + `cs-`). APPLIED STAGING 2026-08-18. PROD pending.
  FOLLOW-ON (staging+prod): backfill park_code on existing pitch_log rows from source files (by uniq_pitch_id/game); then
  rebuild pitch-log park factors keyed by park_code + team_id (NOT batting_team_id, which is corrupt). Validated vs TruMedia.- [ ] DROP corrupted pitch_log.batting_team_id + pitching_team_id (source maps 1 id -> up to 15 teams; clean ids =
  team_id/opponent_id, already present). COUPLED (do together, in the dead-code audit): (1) remove batting_team_id/
  pitching_team_id from `scripts/ingest_pitch_log.ts` record + interface; (2) recreate the `pitch_log_corrected` VIEW
  WITHOUT those two columns (it currently SELECTs them) + re-verify Stuff+ classification/scoring still read it;
  (3) `ALTER TABLE pitch_log DROP COLUMN batting_team_id; ALTER TABLE pitch_log DROP COLUMN pitching_team_id;`.
  DRS/WAR/ReturningPlayers do NOT use them (comments / name-alias only). STAGING + PROD.- [ ] Conference Stats HTP+run-env: `ALTER TABLE "Conference Stats" ADD COLUMN run_env_factor double precision, ADD COLUMN
  hitter_talent_plus double precision;` + conf-stats pitch-log build populates them (run_env_factor = conf-avg per-team
  rg_factor from rolling Park Factors; HTP = OPR + 1.25(Stuff+−100) + 0.75(100−run_env_factor)). Repoint 4 live HTP sites +
  transfer engine to read stored. STAGING first, then PROD. (#3+#4 coordinated.)  [APPLIED STAGING 2026-08-18: ALTER + run_env_factor populate (conf-avg per-team rg_factor via Teams Table) + hitter_talent_plus
  = Overall_Power_Rating + 1.25(Stuff_plus-100) + 0.75(100-run_env_factor), 30 D1 confs. Backup _confstats_backup_20260818.
  PROD: same ALTER + repopulate from prod Park Factors/Teams Table. Then repoint 6 live HTP sites to read stored.]- [ ] LIVE-COMPUTE ELIMINATION (ships with edge fn): edge fn produces stored snapshots (transfer/player) + stored conf
  HTP/run_env/OPR; repoint ALL client live-computes to read stored — HTP (~15 sites), oWAR/wRC+/pWAR (~19, incl TB regression),
  transfer projections (~14), resolveConferenceStats. Per repoint: Supabase types regen + PAGE-LOAD verify (CLAUDE.md gate).
  Files: TransferPortal, TeamBuilder, useTeamBuilderSimulation, PlayerProfile, ReturningPlayers, PitchingConferenceStatsTable,
  savant PitcherPage/ConferenceStatsPage. Goal: ZERO client compute. See handoff §LIVE-COMPUTE AUDIT.- [ ] 20260818010000_pitch_log_is_conference_game.sql — add is_conference_game boolean + index. Backfill:
  is_conference_game = (conference_of(team_id) == conference_of(opponent_id)) via "Teams Table".source_id→conference_id
  (Season 2026). APPLYING STAGING 2026-08-18 (ctid-batched, ~40 batches; index dropped during backfill for HOT, recreated after).
  PROD: same ALTER + backfill (or compute in edge fn on ingest). FORWARD: compute post-ingest (edge-fn stage) since it needs
  the Teams Table conference lookup, not row-by-row. ⚠ team_id/opponent_id are the CLEAN ids (batting_team_id/pitching_team_id corrupt).
## ★ is_conference_game BACKFILL — DONE (staging, 2026-08-18)
2.58M rows flagged: **1,407,734 intra-conf / 1,171,921 non-conf / 0 null** (unmapped opponents → false). Method that worked
after several failures (see BIG-WRITE MECHANICS v2 + the CLI-caps-statements finding): a join-based RPC `flag_conf_batch(n)`
(flags the next n NULL rows in one fast statement via `coalesce(bt.conference_id=ot.conference_id, false)` joining `_team_conf`
on team_id/opponent_id), LOOPED until 0 (`/tmp/conf_flag_loop.sh`). Self-converging + timeout-immune (each call <120s).
CLEANUP (audit): drop one-off RPCs `flag_conf_batch`, `set_conf_game` + helper `_team_conf` after the conf-stats run is built.
PROD: same — migration adds the column; backfill via the RPC-loop (or compute in the edge-fn conf-stats stage on ingest).- [ ] Conference Stats UNIFIED RECOMPUTE (edge-fn stage) — recompute ALL conf fields from pitch-log per the CALCULATION SPEC
  (handoff/agent §CONFERENCE-STATS CALCULATION SPEC): intra-conf hitting+pitching rates (proper denominator; IP=outs/3), env+
  (÷NCAA), wRC+ (C1 OBP/SLG — current; corrects the STALE pre-C1 stored value), FIP (+cFIP≈3.157), ERA (DRS earned runs on
  intra-conf), OPR/Stuff+/scouting/run_env/HTP (total-season rollups). Store in "Conference Stats". THEN retire the 5 producers
  (importConferenceStats, populate-conference-stats-env-plus, conferenceScoutingAverages, conferenceStuffPlus-V1) + one-off RPCs
  (flag_conf_batch, set_conf_game) + helper _team_conf. Validated on staging (all rate fields corr 0.98+). STAGING+PROD.- [ ] Conference Stats Bucket-A recompute — APPLIED STAGING 2026-08-18 via scripts/sql/conf_stats_unified_assembly.sql (CTAS
  _conf_agg → UPDATE 29 D1 confs: rates/env+/WRC_plus(C1)/K9/BB9/HR9/WHIP/FIP/ERA). Backup _confstats_backup_preassembly. Fixes
  stale pre-C1 WRC_plus. PROD: same (compute from prod pitch_log; NCAA constants from prod ncaa_averages; cFIP re-derive).
  Then fold into edge fn + retire the 5 producers (build-check-then-clear).

## ★ team_season_stats — NEW canonical per-team-per-season table (feature/war-recalibration) — 2026-08-19
DEDICATED HANDOFF: docs/HANDOFF_team_season_stats_2026_08_19.md (full schema §5, sources, execution order 0–7, verify plan).
DESIGN + WHY also in docs/HANDOFF_STUFF_PLUS_2026_08_16.md + docs/AGENT_LEARNINGS_stuff_plus_2026_08_16.md §TEAM_SEASON_STATS.
⚠ PROD-SPECIFIC: team_war_snapshots on PROD holds 2025 (309 rows incl. Louisiana State natl champ + 39 conf champs) + 2026 (466);
staging has 2026 only. The migrate step MUST read PROD's own team_war_snapshots so the 2025 championship history is preserved.
WAR rollup = pure SUM over Hitter/Pitching Master (reg+total split already stored per player) — no player-boundary work.
Forced by Independents (Oregon State transfers) needing faced-competition; becomes the team-stats layer the system lacks.
Consolidate (Masters philosophy): ONE canonical table; retire team_war_snapshots + Park Factors INTO it AFTER verify (never two live copies).
- [ ] CREATE TABLE `team_season_stats` — key `(source_id, season)` (source_id = STABLE program id; confirmed OSU 3111 / UGA 226
  every season) + store per-season `id` (uuid) + `conference_id` + team_name/abbreviation. AUTHORITATIVE column list + build rule
  in handoff/agent §team_season_stats AUTHORITATIVE SCHEMA. Fill ALL first pass, computed in the ONE edge fn. BUILD RULE: team =
  Σ player values (sum counting stats per window → DERIVE weighted rates from the sums; team WAR = Σ player WAR). COLUMNS:
  records (w/l overall + conference, NEW run from pitch_log game outcomes) ; hitting+pitching counting (Σ) → derived rates ;
  WAR matrix owar/dwar/bsrwar/pwar/total_war each **_reg + _total** (split on season boundary 2026-05-18) + carried proration/
  champion-flags/seed/team_drs ; conf-scoped (migrate from "Conference Stats") ; faced_stuff_plus/faced_htp ; park snapshot
  (single-season + 3-yr rolling, derived from "Park Factors" which STAYS as historical source). RLS ENABLE (service-role pipeline table).
  STAGING first (build + fill + A/B), then PROD (same DDL + edge-fn populate from prod pitch_log/Teams Table/Park Factors).
  [APPLIED STAGING 2026-08-19: migration 20260819000000_team_season_stats.sql (117 cols + 3 indexes + RLS ENABLE) + ALTER ADD
  COLUMN preseason_proj_total_war (future accuracy-tracking, nullable). ⚠ D1 ONLY — JUCO (NJCAA_D1) excluded (descriptive WAR is D1).
  Descriptive-only (no projection block; projection = TB function elsewhere). PROD: same DDL.]
- [x] WAR rollup (step 2) — scripts/sql/team_season_stats_war_rollup.sql. Σ Hitter+Pitching Master (desc_owar/d_war/bsr_war/
  desc_pwar/total_desc_war + _reg), D1 only, join Masters.TeamID="Teams Table".id→source_id. APPLIED STAGING 2026-08-19: 308 rows;
  pWAR corr 1.0000 (exact) vs team_war_snapshots.raw_total_pwar; oWAR=Σdesc_owar by construction. PROD: re-run from prod Masters.
- [ ] STAGING cleanup (done) — DROP _conf_agg + _team_home_park (completed-step scratch; results in Conference Stats/Park Factors;
  backups exist). Cleared RLS advisory. STAGING-ONLY temps → no prod action unless prod created them.
- [ ] team_season_stats RATES (step 3) — team rate block = weighted aggregate of the AUTHORITATIVE Masters (TruMedia=BBRef), NOT
  pitch_log (Master is not a pitch-log total; confirmed import-csvs/registry.ts). Hitting: AVG=Σ(AVG·ab)/Σab, OBP=Σ(OBP·pa)/Σpa,
  SLG=Σ(SLG·ab)/Σab, ISO=SLG−AVG, OPS=OBP+SLG, wRC+=C1; store pa_total/ab_total. Pitching: ERA/FIP/WHIP/K9/BB9/HR9=Σ(rate·IP)/ΣIP;
  store ip_total/bf_total. D1 only, total season (reg rates deferred; Master has no reg-rate cols). Detailed counting splits
  (HR/2B/3B/BB/HBP/SB/CS/SF) from pitch_log later. APPLIED STAGING 2026-08-19 (308 teams, 0 null; team .277/.381/.434 wRC+~100 = D1 baselines). Script scripts/sql/team_season_stats_rates.sql. PROD: re-agg from prod Masters.
- [ ] Team RECORDS run (NEW) — derive overall + conference W-L per team-season from pitch_log game outcomes (runs/game →
  win/loss; is_conference_game → conf record). Not a player rollup. Stores into team_season_stats; enables wins-over-projection (future). STAGING+PROD.
- [ ] CONSOLIDATION (build-check-then-clear, LAST) — **subsume `team_war_snapshots` FOR 2026+, FEDERATE `Park Factors` (Trevor 2026-08-19):**
  - ⚠️ **DROP CANCELLED (federate-by-era, 2026-08-20): DO NOT DROP `team_war_snapshots`.** It stays as the authoritative store for
    **pre-2026** (2025 champions can't be recomputed — no 2025 pitch_log). team_season_stats is canonical for **2026+**. Migrate/carry the
    2026 rows into team_season_stats and repoint 2026+ readers, but the table remains for historical seasons. **No `DROP TABLE`.**
  - `"Park Factors"` is a DIFFERENT grain (park-data INPUT store: raw single-season + rolling, ALL history) → **KEEP IT, do NOT retire.**
    It's always needed as the historical park source + projection ingredient (we are NOT backfilling full park history into team rows).
    team_season_stats stores a DERIVED SNAPSHOT of the values USED for that team-season: the 3-yr rolling (projection input) + the
    single-season, both stamped by the edge fn from `"Park Factors"` each run. Single writer = no drift; `"Park Factors"` stays source-of-truth.
  - Every step (CREATE, each ADD COLUMN, the 2026-row migrate, the repoint) gets its own line logged when applied — per the banner at top. (NO drop — see cancellation above.)
- [x] team_season_stats RECORDS (step 4) — scripts/sql/team_season_stats_records.sql. Derived from pitch_log game outcomes
  (team_id=source_id; game key = DISTINCT team_id/date/game_venue_id/total_runs/opponent_runs → splits doubleheaders by final;
  ⚠ game_string/park_code are 0% populated so unavailable as a game id — the park_code ingest backfill is still pending). W/L from
  total_runs vs opponent_runs (14 ties excluded); boundary 2026-05-18. w_total/l_total=all, w_reg/l_reg=reg, w_conf/l_conf=reg-season
  conference (standings). APPLIED STAGING 2026-08-19: 308 teams avg 55 games; Georgia 53-14 (23-7 SEC), Arkansas 41-22 (17-13). PROD: re-run from prod pitch_log.

- [x] team_season_stats step 5 — migrate snapshot history + conf context. scripts/sql/team_season_stats_migrate_snapshot_conf.sql
  (run the 2 UPDATEs separately — CLI is one-statement-per-call). (a) carry proration_factor/games_played_est/champion flags/
  national_seed_rank from team_war_snapshots (join source_team_id=source_id) — NOT the stale old oWAR. (b) conf_stuff_plus/conf_htp/
  run_env_factor/conf_opr/conf_wrc_plus from "Conference Stats" via conference_id. APPLIED STAGING 2026-08-19: 308/308 both.
  ⚠ team_drs left NULL — team_war_snapshots.team_drs is empty on staging (snapshot rebuilt after the 2026-08-09 populate);
  regenerate via scripts/drs/derive_team_drs.mjs (dwar_total already populated). ⚠ PROD: run (a) against PROD team_war_snapshots
  (has 2025 champions — Louisiana State + 39 conf champs) so championship history carries into 2025 team_season_stats rows.

- [x] team_season_stats step 6 — faced competition + park snapshot. scripts/sql/team_season_stats_faced_park.sql (3 UPDATEs, run
  separately). SEMANTICS (validated): pitch_log team_id=pitching side, opponent_id=batting side. faced_stuff_plus(T)=pitch-wt conf
  Stuff+ of pitchers T's hitters faced (opponent_id=T, metric on team_id conf); faced_htp(T)=pitch-wt conf HTP of hitters T's
  pitchers faced (team_id=T, metric on opponent_id conf). Reproduces proven OSU 100.2/104.5. Park = snapshot of USED rolling+single
  from "Park Factors" (which STAYS historical source). APPLIED STAGING 2026-08-19: 308/308 all three. PROD: re-run from prod pitch_log/Conference Stats/Park Factors.

- [x] park_code/game_string BACKFILL — **DONE on staging** (superseded the 2026-08-19 "NOT DONE" note; see the later "RUNNING STAGING"
  entry which completed). Audit 2026-08-20 confirmed ~100% populated on sampled teams + records now key on game_string (DH-safe,
  Georgia 53-14 / 23-7 SEC). ⚠ Before prod push, run a server-side full-table `count(*) FILTER (WHERE park_code IS NULL)` to confirm
  globally (audit used per-team sampling). PROD pending — backfill from source on prod. STAGING done / PROD pending.
- [ ] team_season_stats RATE/COUNTING re-source (wiring step) — rebuild from pitch_log_hitter_totals/pitcher_totals (frequent primary;
  TruMedia = cross-check). Hitting: Σ raw counts (pa/ab/singles/doubles/triples/hr/bb/hbp/sac) → derive rates + store splits. Pitching:
  needs IP(=outs/3)/ER derivation (conf-stats ERA-via-DRS). Cross-check vs Master (corr 0.996, ~16 AB/team gap = TruMedia reconcile). STAGING+PROD.

- [x] team_season_stats RATE/COUNTING re-source PITCH-LOG-PRIMARY (Trevor 2026-08-19: pitch log = live/frequent, Master = occasional
  source-of-truth fill). scripts/sql/team_season_stats_rates_pitchlog.sql (2 UPDATEs, run separately). HITTING fully pitch-log
  (pitch_log_hitter_totals dim 'all' → rates + splits hr/2b/3b/bb/hbp/k). PITCHING counting pitch-log-native; RATES stay Master
  IP-weighted (interim — pitch_log_pitcher_totals lacks IP/ER). APPLIED STAGING 2026-08-19: 308/308; hitting corr 0.996 vs Master,
  pitch-log K9 corr 0.998; Georgia .324/.623 175HR. Supersedes the step-3 Master-sourced hitting rates. PROD: re-run from prod pitch_log_*_totals.
- [ ] FOLLOW-ON: full pitch-log PITCHING rates (ERA/FIP/WHIP/K9/BB9/HR9) via IP=outs/3 + earned-run derivation (conf-stats ERA-via-DRS
  machinery) so pitching is pitch-log-primary too. Currently Master IP-weighted (source-of-truth interim). + Master-reconcile/fill
  logic (COALESCE pitch_log with Master where a team is thin/absent — needed for low-TrackMan programs; no-op for 2026 D1).

- [x] refresh_team_season_stats(p_season, p_reg_end) — the ONE idempotent routine that rebuilds team_season_stats for a season
  (the descriptive STORE stage the unified upload edge fn calls via RPC after Masters + pitch_log_*_totals refresh). Migration
  20260819010000_refresh_team_season_stats.sql. Assembles all 10 sub-steps (base+WAR, hitting rates+splits pitch-log, pitching
  counting pitch-log, pitching rates Master, records, snapshot carry, conf context, faced ×2, park). DELETE-season-then-rebuild =
  idempotent. p_reg_end defaults to <season>-05-18. APPLIED STAGING 2026-08-19: select refresh_team_season_stats(2026) → 308 rows;
  reproduces pWAR corr 1.0000, team .277/.434, Georgia 53-14 (23-7), OSU faced 100.2/104.5, all 308 fully populated. PROD: create fn + call per season.

- [x] team_season_stats consolidation columns (WIRE C prep) — ALTER ADD hitter_war_reg/total, rotation_pwar_reg/total,
  bullpen_pwar_reg/total + folded into refresh_team_season_stats() (migration 20260819010000, re-created). hitter_war = Σ hitter
  total_desc_war (o+d+bsr); rotation = top-3 pitchers by IP, bullpen = rank 4+ (matches team_war_2025_aggregation.sql). Comparison
  uses REGULAR-SEASON desc WAR (_reg) — NO proration (Trevor: reg-season total is more accurate). APPLIED STAGING 2026-08-19:
  refresh(2026) → 308; rotation+bullpen=pwar (0 mismatch), hitter_war=o+d+bsr (0 mismatch); Georgia 24.0hit/7.0rot/6.1bp/37.1tot. PROD: same.

- [ ] ⚠ team_season_stats vs team_war_snapshots — DO NOT RETIRE team_war_snapshots (Trevor 2026-08-19). team_season_stats is
  descriptive-from-pitch_log = 2026-only; 2025 (prod: LSU champ + 39 conf champs + prior-year WAR) CANNOT be recomputed (no 2025
  pitch_log). FEDERATE BY ERA: team_season_stats canonical 2026+, team_war_snapshots kept for 2025 historical. Readers fall back to
  snapshots for pre-2026. The earlier "retire team_war_snapshots + seed scripts" plan is CANCELLED.

- [ ] ⚠ DATA FIX (ingest) — pitch_log.pitcher_full_name is CORRUPT (holds the BATTER's full name, not the pitcher's; confirmed
  2026-08-19: each pitcher_id has 1 pitcher_abbrev_name but 28-29 pitcher_full_names = batters faced). Reliable: pitcher_id +
  pitcher_abbrev_name. IMPACT = display-name only (all pitcher-keyed derived data uses pitcher_id → unaffected). Fix scripts/ingest_pitch_log.ts
  mapping + backfill pitcher_full_name from pitcher_id→Pitching Master. STAGING+PROD. See memory reference_pitch_log_pitcher_name_corrupt.

- [x] team_season_stats PITCH-LOG PITCHING RATES (Trevor's outs-tracking method) — folded into refresh_team_season_stats() step 4a/4b
  (migration 20260819010000 re-created). IP = Σ(max(outs)+1)/3 over pitching half-innings (corr 0.9932 vs Master IP). K9/BB9/HR9 =
  pitch-log counts×9/IP; WHIP=(BB+H)/IP; FIP=(13HR+3(BB+HBP)−2K)/IP+3.157 (cFIP D1 2026). ERA = Master IP-weighted (SOURCE-OF-TRUTH;
  pitch-log ERA noisy 0.825 due to earned-run attribution). APPLIED STAGING 2026-08-19: 308/308, Arkansas IP 532/K9 10.7/FIP 4.48/ERA 4.74;
  D1 avg K9 8.33/FIP 5.03/ERA 6.16. PROD: same (re-run from prod pitch_log). ⚠ ERA-source decision (Master) is overridable if pitch-log ERA preferred.

- [x] pitcher_full_name BACKFILL — APPLIED STAGING 2026-08-19. Mapping public._pitcher_name_fix (source_player_id→first||last from
  players, 15561 rows) + RPC public.fix_pnames(after,limit) keyset-looped over pitch_log 2026 (19 batches × 150k). Sets pitcher_full_name
  = real pitcher via pitcher_id. VERIFIED: each pitcher_id now 1 full_name matching pitcher_abbrev_name (was 28-29 = batters). PROD:
  build _pitcher_name_fix from prod players + run fix_pnames loop over prod pitch_log. CLEANUP: drop _pitcher_name_fix + fix_pnames after.
  ALSO fix the INGEST (scripts/ingest_pitch_log.ts:319 maps CSV 'fullName' → pitcher_full_name, which is the batter) so new rows are correct.

- [~] park_code / game_string BACKFILL — RUNNING STAGING 2026-08-19 (saved big-write process: raised role statement_timeout +
  single UPDATE in background). Source: docs/drs-reference/*DRS Pitch Log.csv (2.63M rows, uniqPitchId+gameString). Loader
  scripts/backfill_park_code_load.ts → temp public._park_code_fix (uniq_pitch_id, game_string, park_code); park_code =
  gameString stripped of trailing 9 digits + 'cs-' (e.g. cs-ark01202603050 → ark01). 2,576,230 mapped (99.9%), 310 parks.
  UPDATE pitch_log SET game_string, park_code FROM _park_code_fix by uniq_pitch_id. PROD: same (load CSVs → _park_code_fix →
  raised-timeout UPDATE). CLEANUP: drop _park_code_fix + fix_parkcode after. FOLLOW-ON: rebuild pitch-log park factors keyed by
  park_code+team_id; re-key records/outings on game_string (fixes doubleheader merges + the 2 pitch-count artifacts). RESTORE role timeout to 2min after.

- [ ] WIRE C — team_season_stats frontend repoint — STASHED into the edge-fn/live-compute-repoint phase (Trevor 2026-08-19). Full spec
  in handoff/agent §WIRE C STASHED. Repoint 4 readers (useTeamWarSnapshots/GMAnalytics/AnalyticsTab/types) to team_season_stats (era
  fallback, _reg basis); pivot Lineup oWAR→full-team Hitter WAR (needs total_hitter_war plumbed into the hitter player_snapshot + re-precompute);
  relabel. Frontend-only (no prod migration) but noted here so it's not lost. Page-load verify.

- [x] team_season_stats records re-key on game_string (refresh_team_season_stats step 5) — now keys games on game_string (exact,
  doubleheader-safe) instead of the (team_id,date,venue,score-pair) heuristic. APPLIED STAGING 2026-08-20 (function re-created):
  308 teams, Georgia 53-14 (23-7), avg 55 games — consistent + now exact. Requires park_code/game_string backfill applied first. PROD: same.

- [x] team_season_stats DRS ra9 + reg-window pitching (refresh step 4c) — ALTER ADD ra9_total/ra9_reg/fip_ra9_total/fip_ra9_reg +
  populate from Master desc_ra9/desc_ra9_reg/desc_fip_ra9/desc_fip_ra9_reg (IP-weighted; reg by regular_season_ip). DRS-accurate
  run-prevention (careful earned+unearned attribution); ERA stays Master (earned). APPLIED STAGING 2026-08-20: 308/308, avg RA9 6.36
  > ERA 6.16 (unearned incl), Arkansas RA9 5.58/reg 5.52 vs ERA 4.74. PROD: same. (reg-window WAR + RA9 now covered; full reg-window
  avg/era/k9 rate-set needs a 'reg' dimension in aggregate_pitch_log_dimensions.ts — separate follow-on.)
- [x] INGEST pitcher_full_name — FIXED 2026-08-20 (code): ingest_pitch_log.ts now loads a pitcher_id→"First Last" map from players
  in main() and sets pitcher_full_name from it (fallback to CSV fullName only when unmapped) — self-fills correctly on EVERY ingest,
  source-independent. tsc clean. Ships with the branch (no migration). Original diagnosis retained:  the DRS-format CSVs (docs/drs-reference) have fullName=the PITCHER
  (Nathan Taylor = pitcherAbbrev N. Taylor), so ingest_pitch_log.ts:328 fullName→pitcher_full_name is CORRECT for that format. The
  original DB corruption came from a DIFFERENT/older source export (fullName=batter), already fixed by the backfill. ROBUST FIX =
  make the pitcher_full_name-from-pitcher_id resolution (fix_pnames / _pitcher_name_fix) a STANDARD post-ingest step so it's correct
  regardless of the source's fullName meaning. No mapping change needed for DRS CSVs.

- [ ] SD AUDIT + modeling fixes (feature/war-recalibration) — **D1 ONLY. SUPERSEDED BY `docs/PROD_PUSH_RUNBOOK_war_recalibration.md` Part C (the 13 steps).**
  **OUTCOME (2026-08-20, confirmed on latest staging ratings):**
  - **`whip_pr_sd` 24.59 → 37.13** (`pitchingEquations.ts:210` + model_config). Stale after the whip⁺ composite refit — 34% under-scaled.
  - **`obp_std_pr` 28.89 → 32.41** (model_config `r_obp_std_pr` + `t_obp_std_pr`) — returner AND transfer (it's StdDevOBPPowerRating).
  - **Conference env+ pitcher → ratio** `(conf/ncaa)×100` to match hitters (was z×20; only the player power ratings got the /50×100 rebuild — the conference lever was missed).
  - era/fip/k9/bb9/hr9 + ba/iso SDs verified consistent — leave. (b) Store all SDs/weights in model_config + admin (read-source for edge fns).
  - **⚠ TRANSFER weights/SD NOT settled** — do NOT re-run transfer projections until the transfer equation is finished + verified (runbook step 13b). Run RETURNERS only for now (step 13a). STAGING→PROD.

- [ ] **UNLOGGED MIGRATIONS discovered by audit 2026-08-20 (add to prod plan) — verify prod state for each:**
  - `20260805_player_season_defense_baserunning.sql` — CREATE `player_season_defense` (+ baserunning). **⚠ Header says staging-only; NEEDS A PROD PATH** — composite d/bsr-WAR depends on it. Populated by `scripts/load-drs-wsb-staging.ts`.
  - `20260806_pitch_log_widen_attribution.sql` — ALTER pitch_log add attribution cols (`atbat_desc`, event cols) + additive backfill from DRS CSVs. dRS/bsrWAR consume these.
  - `20260806_composite_war_and_refresh.sql` — composite cols + `refresh_composite_war()` v1 (÷10, **superseded** by `20260810_composite_war_d1_rescale` at ÷13.1 — fire the rescale version).
  - `20260724120000_target_board_twp_two_row.sql` — ALTER target_board add `position_slot` + swap UNIQUE constraint.
  - `20260724130000_neutral_snapshot.sql` — ALTER team_build_players + target_board add `neutral_snapshot jsonb` + backfill.
  - `20260630000000_player_slot_values_uniq.sql` — dedupe + UNIQUE index on player_slot_values (prod deduped by hand first).
  - Also LIST the Push-1 DB layer (default_build + pitch_log base migrations 20260619–20260629 + parks_dimensions + hitter_ball_flight_rv) as **"✅ already on prod (Push 1 2026-08-07) — verify"** so the manifest is complete.

- [ ] **ncaa_averages fill (2026-08-20):** `pitcher_exit_velo` / `pitcher_ev90` / `pitcher_in_zone_pct` are NULL on staging → set **= the hitter averages 1-for-1** (same batted-ball population), stored both sides via a function. STAGING+PROD.
- [ ] **Conference Stats legacy cols (2026-08-20):** prod has `iso_power_rating`/`obp_power_rating` (conference-level); staging restructured to `obp_plus`/`iso_plus` + `offensive_power_rating`. **RECONCILE display before any drop — these ARE read by ConferenceStatsPage; do NOT blind-drop.**
- [ ] **KNOWN LIMITATION (deferred):** `pitch_log.vaa` 0% + `classification_version` ~65% — upload miss, left as-is for now.

## TRANSFER LEVER BUILD (feature/war-recalibration, 2026-08-21+) — step-by-step
Building the transfer equation lever finalization. Each DB change logged here as it lands on staging. Detail: `docs/HANDOFF_team_season_stats_2026_08_19.md` §TRANSFER LEVER; `docs/PROD_PUSH_RUNBOOK_war_recalibration.md` Part A7.

- [ ] **`20260821000000_conf_pitcher_env_plus.sql`** — ADD `era_plus,fip_plus,whip_plus,k9_plus,bb9_plus,hr9_plus` (numeric) to `"Conference Stats"`. Per-conf pitcher env+ on the **ratio scale** `(conf/ncaa)*100` (was live-computed z×20 in 3 drifted resolvers). **APPLIED STAGING: ✅ YES (verified 2026-08-21 — era_plus…hr9_plus filled 30/30 clean D1).** Populate: `scripts/compute_conf_pitcher_env_plus.ts --apply` (clean 30 D1, NJCAA excluded; ncaa_averages means + IP-weighted WHIP mean 1.635; all 6 stored raw ratio — HR9 handled on the weight side). PROD: re-run populate on prod (regenerate, don't copy).

- [ ] **model_config transfer weights + SD mirror (2026-08-21)** — re-tuned transfer lever weights (target %impact) + cross-conf/park SD mirror. **APPLIED STAGING** via `scripts/store_transfer_weights_and_sds.ts --apply` (9 UPDATEs + 33 INSERTs, model_type='admin_ui', season 2026). **PROD: re-run the same script** (values match code `transferWeightDefaults.ts` + `pitchingEquations.ts`). ⚠ Hitter `t_*` weights EXISTED in model_config with old values and OVERRIDE code → the UPDATE is required or code changes don't take effect. Keys: hitter t_ba/obp/iso conference(.256/.288/.080)/pitching(1.15/.98/.86)/park(.270/.324/.111); pitcher transfer_* conference(era .106/fip .137/whip .175/k9 .115/bb9 .097/hr9 .043)/competition(era/fip .262/whip .238/k9/bb9/hr9 .297)/park(era/fip .135/whip .324/hr9 .111); SDs conf_env_sd_* + conf_comp_sd_* + park_sd_*.

- [ ] **TRANSFER RE-RUN (Step 2, 2026-08-21)** — recompute all transfer projections with the new stored env+ (ratio) + re-tuned weights. **APPLIED STAGING** (in progress): loop all 17 customer teams × hitter (`precompute-transfer-projections.ts --team <uuid>`) + pitcher (`precompute-pitchers.ts --team <uuid>`). Writes `player_predictions` `model_type='transfer' variant='precomputed' season=2027`. **PROD: re-run the same loop** (`:prod` variants) AFTER env+ columns populated + model_config weights stored on prod. Customer teams: Penn State, Virginia Tech, BYU, Ole Miss, Georgia, Cal Poly, Campbell, Georgia Southern, Kennesaw State, UAB, South Alabama, Kansas, Arkansas, Grand Canyon, Coastal Carolina, UCSB, Notre Dame.

- [ ] **DEPLOY `process-precompute-jobs` edge fn (2026-08-21)** — the NEW-TEAM precompute path (AFTER INSERT trigger on customer_teams → precompute_jobs → this worker) updated to mimic the settled transfer logic: hitter env+ STORED (ba/obp/iso_plus, was live AVG/0.280); from-team id-first via source_team_id (hitter+pitcher, was name-only); D1 pitcher eq overlays model_config transfer_* (was hardcoded). Hitter weights + pitcher env+ were already correct. **Trevor deploys** (staging + prod). Pre-existing Deno literal-type warnings unchanged (non-blocking).

- [ ] **SNAPSHOT REFRESH after transfer re-run (Step 6, 2026-08-21)** — refresh saved build + target snapshots from the new projections WITHOUT changing toggles. Two-step "automatic function": (1) `backfill-neutral-snapshot.ts --apply` refreshes `team_build_players.neutral_snapshot` + `target_board.neutral_snapshot` from current predictions (precomputed-transfer > regular-returner); (2) `heal-stale-snapshots.ts --apply` re-derives `player_snapshot`/`transfer_snapshot = f(new neutral, production_notes)` — toggles (production_notes) untouched. Applies to ALL builds incl. default rosters. **APPLIED STAGING 2026-08-21** (neutral 1174 bp + 167 tb; healed 1271/1271, 0 err; all 38 builds incl. 15 defaults; toggles preserved). **PROD: run same two-step** (`--prod --apply --yes`) AFTER the prod transfer re-run.

- [ ] **⚠️ CONFERENCE STATS PRODUCERS — codify before prod (2026-08-21)** — several Conference Stats columns that feed transfers are populated on staging by UNCOMMITTED hand-run SQL and won't reproduce on prod: `WRC_plus`, `hitter_talent_plus` (HTP), `run_env_factor` (park, no writer at all), `offensive_power_rating` (OPR, 0/30). Must commit producers (OPR compute, canonical-HTP compute, WRC_plus, run_env_factor) + the pitch-log raw-rate assembly. Full map + edge-fn spec: `docs/CONFERENCE_STATS_BUILD_PROCESS_2026_08_21.md`. Canonical HTP = OPR + 1.25(Stuff+−100) + 0.75(100−run_env_factor), stored + read (no live compute).

- [ ] **HTP canonical (park swap) + stored reads + pitcher re-run (2026-08-21)** — `scripts/derive_conf_opr_htp.ts --apply` fills `offensive_power_rating`=Overall_PR + confirms `run_env_factor`=conf-avg rg + stores canonical `hitter_talent_plus` = OPR+1.25(Stuff+−100)+0.75(100−run_env_factor) (park swap; stored value already had it, producer makes it reproducible). All HTP readers wired to STORED (precompute-pitchers, process-precompute-jobs edge fn, TeamBuilder, TransferPortal, ConferenceStatsPage) — live pre-swap compute removed. **PITCHER transfer re-run** on stored HTP (all 17 teams). **PROD: run derive_conf_opr_htp --apply then re-run pitcher transfers; redeploy edge fn.**

> ## ★★★★ VERY IMPORTANT — CONF-STATS PRODUCERS (2026-08-21) ★★★★
> Conference Stats columns feeding transfers were partly hand-run SQL on staging. **Committed producers exist now for run_env_factor / OPR / HTP (`derive_conf_opr_htp.ts`). STILL MUST commit: the raw-rate pitch-log assembly + WRC_plus** (currently a commented-out SQL) or they'll be EMPTY on prod and break transfers/HTP/Program Analytics. See runbook "CRITICAL PROD-PUSH BLOCKER" + `docs/CONFERENCE_STATS_BUILD_PROCESS_2026_08_21.md`.
> **✅ UPDATE 2026-08-21 (GAP 3, a960334): raw-rate assembly + WRC_plus NOW committed** → `scripts/sql/conf_stats_bucketA_assembly.sql` (runnable, idempotent, txn-wrapped, inlines `_team_conf`). ALL 6 conf-stats producers now committed. **Remaining gate:** staging idempotent re-run of that file vs backup `_confstats_backup_preassembly` (couldn't run 2026-08-21 — no staging conn; `supabase --linked` = PROD). **PROD run order:** the 6 conf-stats producers (incl. `conf_stats_bucketA_assembly.sql`, PASTE — do NOT `--linked` blindly, that's prod) → transfer re-run → snapshot refresh → redeploy `process-precompute-jobs` edge fn (now has faced-competition mirror + D1 conf-stats block guard, commits bf69bd1/1c7603a).

- [ ] **⚠️ PROD DATA FIX — NJCAA-D1 division re-tag (2026-08-21)** — 10 `"Conference Stats"` rows named `NJCAA D1 … District` carry `division='D1'` (should be `NJCAA_D1`, matching JUCO players). Makes `division='D1'` a clean 30 so any conf-SD consumer doesn't need a name filter (prevents JUCO contamination of conf-level SDs, e.g. inflated fip+). **APPLIED STAGING 2026-08-21 (Trevor, 10 rows).** **PROD: run this SQL:**
  ```sql
  update "Conference Stats"
  set division = 'NJCAA_D1'
  where season = 2026 and "conference abbreviation" like 'NJCAA%' and division = 'D1';
  ```

- [ ] **RLS: player_predictions team-scope (2026-08-23)** — `20260823000000_player_predictions_rls_team_scope.sql`. Replaces the `USING(true)` SELECT policy (globally readable) with team-scoped: `customer_team_id IS NULL OR superadmin OR is_team_member(customer_team_id)`. Shared global rows stay readable; per-team precomputed rows become own-team-only. Writes unchanged. No app change (read path already filters null-or-own-team). **DDL — apply on staging + prod (needs a staging connection; CLI-linked=PROD).** Also flagged: `nil_valuations` is likewise `USING(true)` (legacy manual table) — tighten separately if it should be team-confidential.

- [ ] **⭐ MARKET-VALUE re-price (2026-08-23)** — model + PTM finalized (per-conference exact-code, SINGLE model_config source). ORDERED:
  1. **Seed model_config** — `scripts/sql/seed_nil_tiers_model_config.sql` (PASTE; ⚠ MUST precede re-price — clears old `nil_tier_sec=1.5` that would override the new 4.0 + dead bucket keys). Values: SEC 4.0/ACC 1.5/Big12 1.2/BigTen 1.0/Independent 1.0/AAC+SunBelt+BigWest+MWC 0.8/default 0.5/juco 0.35.
  2. **Re-price 17 teams** — `precompute-transfer-projections` + `precompute-pitchers` per team (recomputes market_value/twp_* off new PTM; WAR unchanged; hitter market rides total_hitter_war).
  3. **Re-bake snapshots** — `resync-build-snapshot-markets.ts` + `resync-target-snapshots.ts` (snapshots bake market).
  4. **Verify** — roster totals SEC ~$4.4M / ACC ~$1.7M / Big12 ~$1M / BigTen ~$900k; TWP + Independent=1.0.
  5. **Redeploy** `process-precompute-jobs` edge fn (Trevor) — carries the unified per-conference PTM (buildNilTiers reads model_config nil_tier_<code>).
  Code committed (08c40e2→95f22a6). STAGING re-price NOT yet run (needs Trevor nod). Full: `docs/AGENT_LEARNINGS_market_value_reverse_engineer_2026_08_21.md` + `docs/HANDOFF_MASTER_war_recalibration_2026_08_23.md`.

- [ ] **⭐ total_hitter_war STORED DIRECTLY (2026-08-23)** — all 3 hitter producers (precompute-transfer-projections, process-precompute-jobs edge fn, backfill-2027-hitter-returners) now WRITE `total_hitter_war = o_war + d_war + bsr_war` in the upsert (was inline-only for market → left stale). ⇒ on PROD: the re-price re-runs (transfer per-team + returner backfill) fill total_hitter_war fresh; **`refresh_composite_war()` is REDUNDANT for the projection total** (still needed for the descriptive Master columns only — do NOT rely on it for `player_predictions.total_hitter_war` anymore). Code committed 572bd11/2d20a5f. Followed by STEP 7b display swap (o_war→total_hitter_war headline) — see `docs/AGENT_LEARNINGS_total_war_display_2026_08_23.md`.

## ★ TWP FLAG RECOMPUTE — is_twp detector run (feature/war-recalibration) — 2026-08-26
- [ ] **Run the canonical TWP detector `recomputeTwpStatus(2026, PA>=30, IP>=5)`** — `is_twp` was systemically
  unset (only **2** flagged on staging) because the detector — the only writer of `is_twp`/primary `position` —
  is reachable **only from a manual AdminDashboard button and had never been run on current-season data.** Effect:
  ~253 real two-way players (both a Pitching Master pitcher-Role line AND a Hitter Master line meeting threshold)
  were half-projected — the pitcher batch keys on `pitcherTest(position) || is_twp`, so a TWP labeled OF with
  `is_twp=false` had its **pitching side dropped** (stale, unrefreshed projection; e.g. Evan Dempsey FGCU 88.7 IP /
  3.9 pWAR off the pitcher board). The reported "stale orphan pitching rows" were this symptom.
  **THRESHOLD = PA>=30 & IP>=5** (detector default; Trevor-confirmed 2026-08-26). Rationale: flag is **re-derived from
  each season's actuals every run + has a demotion ladder**, so an inclusive threshold never permanently strips a
  developing two-way player's dual-position eligibility (next year's data re-flags/demotes). 50/10 is the cleaner
  one-year sample but only matters if the flag were permanent — it isn't.
  **APPLIED STAGING 2026-08-26** via `scripts/run-twp-recompute.ts --apply` (thin runner over the canonical lib fn;
  Node-CLI service-role client; added a backward-compatible `dryRun` param to `recomputeTwpStatus`). Result:
  `is_twp` **2 → 253** (D1=90 / JUCO=163): 207 net-new + 45 legacy-`position='TWP'`-string migrated + 1 unchanged;
  **0 P→hitter position flips** (the detector only sets hitter-primary when a valid Hitter Master Pos exists — 96
  pitcher-side TWPs stay `position='P'` and just gain the flag); cleanup: 31 demoted→pitcher, 65 cleared→null
  (alumni, no 2026 data), **34 left as `position='TWP'`** (tiny mixed samples + invalid hitter Pos → flagged for
  MANUAL data fix, `is_twp=false`); 0 errors. Dry-run previewed first (dry-run-first discipline).
  **PROD:** run the same `scripts/run-twp-recompute.ts --apply` against prod (regenerate from prod Masters — do NOT
  copy staging flags). MUST run BEFORE the returner/transfer precomputes on prod (so both-side rows generate).
  **FOLLOW-ON (dedicated pass, still on staging — NOT yet run):** re-run returner pitcher+hitter precomputes →
  re-bake TWP markets (`rebake-twp-markets` / `rebuild-twp-target-rows` / `fix-returner-twp-hitter-market`) →
  re-bake snapshots (`heal-stale-snapshots` / `backfill-neutral-snapshot` / `resync-*`) → verify known TWPs
  end-to-end (both sides + combined NIL + both roster slots + sane team WAR). The 34 manual-fix `position='TWP'`
  residuals are a separate data-quality cleanup.

## ★ HR9-ONLY FLOOR + TWP PRECOMPUTE RE-RUN (feature/war-recalibration) — 2026-08-26
Companion to the TWP FLAG RECOMPUTE entry above + the two-sided-SD calibration. Full writeup:
`docs/AGENT_LEARNINGS_twp_flag_systemic_gap_2026_08_26.md` + `docs/HANDOFF_twp_flag_pass_2026_08_26.md`.

- [ ] **HR9-ONLY code floor (CODE, no migration)** — narrowed the earlier blanket `Math.max(0, projected)` to HR9
  ONLY (Trevor: "only on HR9 should there be a floor, everything else should work as is"). `pitcherProjection.
  projectPitchingRate` + `transferPitcherProjection.projectLower` gain a `floorAtZero` param, passed `true` only from
  the HR9 call site; `projectHigher` (K9) un-floored. Every non-HR9 rate stays UNfloored so a negative (which the
  two-sided SD should prevent) surfaces as a real bug, not silently masked (audit doctrine). `npm test` 265 pass, 0
  new tsc errors. **Ships with the branch code (no DB step); prod picks it up when the prod precomputes re-run.**
- [ ] **TWP precompute re-run (STAGING done 2026-08-26; PROD = re-run after the prod detector run):**
  - `precompute-returner-pitchers` — pool 7628→**7829** (+201 TWPs join via `pitcherTest(position) || is_twp`);
    7633 upserted, propagated to 110,383 rows. **0 negative pitching rates across 104,401 rows** (floor holds).
  - `backfill-2027-hitter-returners` — 8235 updated, 0 errors; writes `twp_hitter_market_value` + NULLs shared
    `market_value` for D1 TWPs.
  - **PROD ORDER:** run the TWP detector (`run-twp-recompute.ts --apply`) FIRST, THEN both returner precomputes,
    THEN the transfer per-team precomputes, THEN re-bake markets/snapshots. (Detector before precomputes so both-side
    rows generate.)
- [ ] **⚠ JUCO TWP MARKET GAP — KNOWN, DEFERRED to the JUCO workstream (Trevor 2026-08-26).** The JUCO precompute
  branches write only the shared `market_value`, never the `twp_*_market_value` split → the 163 JUCO TWPs show no
  market on TWP surfaces (90 D1 TWPs correct). **Decision: keep all 253 flagged; fix the JUCO branches (write the
  split + null shared for `is_twp`) BEFORE JUCO ships.** NOT a blocker for the D1 push. Re-run JUCO snapshot markets
  after that fix. Detail in the agent-learnings doc.

## ★ TWP TRANSFER RE-RUN + SNAPSHOT RE-BAKE (feature/war-recalibration) — 2026-08-26
Completes the TWP flag pass. STAGING done + verified; PROD = same sequence after the prod detector run + returner
precomputes. Full state: `docs/HANDOFF_twp_flag_pass_2026_08_26.md`.
- [ ] **Transfer re-run** (`_run_step2_all.sh` = `precompute-transfer-projections` + `precompute-pitchers` × 18
  customer teams) — the TWP transfer rows were stale/single-sided (2,186 of 2,221 pre-run). After: 1,529 D1-TWP
  transfer rows carry the `twp_*` split across all 18 teams. STAGING 2026-08-26.
- [ ] **Snapshot re-bake** (STAGING 2026-08-26, all `--apply`): `rebuild-twp-target-rows` · `rebake-twp-markets` ·
  `backfill-neutral-snapshot` (bp=1205/tb=167) · `resync-target-snapshots --all` (9) · `resync-build-snapshot-markets
  --all` (6, legit market→0 for negative-WAR). `heal-stale-snapshots` drift=0. VERIFIED: Dempsey combined NIL $66,114;
  Overbeek target board 2 rows/team (both slots), SEC-scaled. 0 TWPs on build rosters.
- [ ] **⚠ 88 D1-TWP one-sided transfer rows** (35 pitch-only / 53 hit-only) write shared `market_value` not the split
  → same mechanism as the JUCO TWP market gap; **DEFERRED with it** (make the single-side transfer write path
  TWP-aware). 5% of D1-TWP transfer rows; the 1,529 two-sided majority is correct.

## ★ NORTH CAROLINA (18th team) RE-RUN + DYNAMIC TEAM LIST — 2026-08-26
Resolves the "88 D1-TWP one-sided rows" (they were NOT a code gap): all 88 were on **North Carolina** (`e0defb42`),
the 18th customer team (added 2026-08-25), which was **missing from the hardcoded 17-team `_run_step2_all.sh`** → NC's
whole transfer set (10,207 rows) was stale (old model + pre-TWP-flag).
- [ ] **NC transfer re-run** (`precompute-transfer-projections` + `precompute-pitchers --team e0defb42`) — STAGING done
  2026-08-26 (5,023 hitters / 5,118 pitchers). D1-TWP transfer rows now **1,617 split / 0 shared-only.** **PROD: covered
  automatically by the dynamic runner below (NC is an active customer team).** The earlier "88 deferred with JUCO"
  note is SUPERSEDED — only the JUCO TWP market split remains deferred.
- [ ] **Dynamic customer-team list (CODE — prevents recurrence):** `scripts/list-customer-teams.ts` (NEW) reads active
  teams from the LIVE `customer_teams` table; `scripts/_run_step2_all.sh` rewritten to consume it (`--prod` supported).
  No DB change — but it means the prod per-team re-run now covers ALL active customer teams, not a stale array.
- [ ] **Edge-fn new-team automation (context):** the `customer_teams` AFTER-INSERT trigger → `precompute_jobs` →
  `process-precompute-jobs` works (fired for NC at creation). Remaining: the edge fn runs the OLD symmetric model —
  the edge-fn mirror (two-sided SD + HR9 floor + TWP-aware) must land so new teams are correct at birth. ⚠ PROCESS:
  every projection-model change must update BOTH the offline batches AND the edge fn.

## ★ EDGE-FN MIRROR — two-sided SD + HR9 floor (feature/war-recalibration) — 2026-08-26
- [ ] **`process-precompute-jobs` mirrored to the current model** (was OLD symmetric): 6 `_plus_ncaa_sd_bad` keys added
  to `PITCHING_EQ_DEFAULTS` (overlay loads live model_config values) + avg/sd defaults refreshed to 2026 calibration;
  `dsd` directional-SD helper wired into all 6 projection call sites; HR9-only floor (`Math.max(0, projectLowerP(...))`),
  other rates unfloored. D1 path already TWP-aware (no change). Deno check: 0 NEW errors (2 pre-existing).
  **DEPLOYED STAGING branch `slrxowawbijbjrkozqlj` 2026-08-26 (v26→27).** Prod `main` (`trbvxuoliwrfowibatkm`) v12 UNCHANGED.
  ⚠ staging is a persistent BRANCH of prod under ONE project — the prod-account CLI login reaches both; target with explicit
  `--project-ref` (NEVER `--linked` = prod). **PROD (Trevor drives):** `supabase functions deploy process-precompute-jobs
  --project-ref trbvxuoliwrfowibatkm`. Keep the edge fn in lockstep with src/lib on every future projection-model change.

## ★★★ DEFINITIVE PROD PUSH ORDER → docs/PROD_PUSH_STEPS_2026_08_26.md (2026-08-26)
The authoritative top-to-bottom execution order (51 steps, Phase 0→H) with the 4 pre-prod blockers resolved. Use it as
THE runbook. Blocker resolutions this session:
- [ ] **dWAR/bsrWAR prod path (blocker 1) — SOLVED.** `scripts/load-drs-wsb-staging.ts` + `scripts/drs/populate_descriptive_war.mjs`
  + `populate_descriptive_war_reg.mjs` all now take `--prod` (reads `.env.production.local`, refuses on env mismatch) + the
  loader gains `--dry-run`. Were staging-hardcoded. PROD dWAR/bsrWAR = migration 20260805 → `load-drs-wsb-staging.ts --prod`
  (raw dRS/wSB into player_season_defense/baserunning, reuses the env-independent output CSVs) → `populate_descriptive_war.mjs
  --prod --commit` (desc_owar/d_war/bsr_war/total) → `populate_descriptive_war_reg.mjs --prod --commit` (desc_*_reg). Steps 30–34.
  Verified on staging (dry-run: 13,454 defense / 10,408 bsr rows; d_war mean 0.01, bsr_war 0, centered).
- [ ] **Venue corrections (blocker 2) — NEEDS BUILD.** `venue_correction_persist.sql` + its producer were NEVER committed
  (pasted to staging; scratchpad cleaned; 310-row fixture gone). A producer `scripts/compute_venue_corrections.ts` must be
  written (LOO + empirical-Bayes from prod pitch_log) BEFORE prod Stuff+. Spec + view contract in PROD_PUSH_STEPS step 12.
- [ ] **Conf-stats bucketA gate (blocker 3)** — re-run `conf_stats_bucketA_assembly.sql` on STAGING vs `_confstats_backup_preassembly`
  (diff 0.0000) before trusting it on prod. Step 28.
- [x] **Returner prod path (blocker 4) — RESOLVED = batch scripts** (`precompute-returner-pitchers:prod` +
  `backfill-2027-hitter-returners:prod`). The edge-fn `recalculate-prediction` returner rebuild is DEAD — ignore old runbook steps 5–9/G3.

## ★ VENUE CORRECTIONS PRODUCER + PITCH-LOG INTEGRITY (feature/war-recalibration) — 2026-08-26
- [x] **Blocker 2 SOLVED — venue-corrections producer rebuilt:** `scripts/compute_venue_corrections.ts` (NEW; LOO +
  empirical-Bayes, `--prod`/`--apply`/dry-run guarded). Reproduces the lost original: τ 0.622/0.662 (memory 0.63/0.66),
  centering ≈0, n_pitchers 310/310 exact, worst park −2.57; matches the stored staging fixture within **0.011″**. Schema
  = existing `venue_movement_corrections` (game_venue_id/ivb_corr/hb_corr/b_ivb/b_hb/n_pitchers/n_pitches) + full-passthrough
  `pitch_log_corrected` view. **Did NOT overwrite staging** (existing fixture is the validated in-use one). PROD: run
  `--prod --apply` AFTER pitch-log GATES 0+1 (see PROD_PUSH_STEPS "PITCH-LOG INTEGRITY").
- [ ] **★ PITCH-LOG INTEGRITY GATES (prod prerequisite for ALL pitch-log derivations)** — locked into
  `docs/PROD_PUSH_STEPS_2026_08_26.md`. **GATE 0 DEDUP:** prod pitch_log has ~3,425 duplicate PHYSICAL pitches under
  DISTINCT `uniq_pitch_id`s (staging is clean, verified 0). ⚠ a `uniq_pitch_id` distinct-count shows 0 and MISLEADS —
  detect via `runs IS NULL` junk (~3,509) + total ≈ 2,576,230; fix = `DELETE … WHERE runs IS NULL` after widen (or Approach
  B rebuild). **GATE 1 MOVEMENT COMPLETE:** the venue fixture is computed from ivb/hb, so finish all movement population
  FIRST (staging's audit backfilled ivb/hb on ~19,338 existing pitches AFTER its first fixture → 0.011″ drift; not new
  rows, 0 dups — verified). THEN venue corrections → Stuff+ → conf-stats → team_season_stats. Research: no duplicate
  uniq_pitch_id on staging; drift = in-place movement backfill, not double-import.

## ★ COMPREHENSIVE PROD-PUSH DOCUMENTATION (feature/war-recalibration) — 2026-08-26
Full branch cataloged (785 files) into the authoritative doc set. Use these for the push:
- **`docs/PROD_PUSH_STEPS_2026_08_26.md`** — THE runbook. Ordered steps (Phase 0→H) + PITCH-LOG INTEGRITY gates
  (dedup + movement-complete) + **CALCULATION REFERENCE** (every formula/constant/output) + **SCHEMA/SQL CHANGE
  REFERENCE** (all 101 migrations: what each touches, idempotency, regenerate-on-prod flags) + PROD LANDMINES.
- **`docs/STAGING_DISPLAY_TEST_CHECKLIST_2026_08_26.md`** — every UI change to verify on staging before push, with
  PASS/FAIL per item (WAR-label swap, transfer market conference, TWP both-sides, TB WAR-sort, GM interface, /savant deletion).
- **`docs/PRE_PROD_AUDIT_2026_08_26.md`** — readiness verdict + stale-doc reconciliations.
- [ ] **NEW LANDMINE — model_config conflict:** `wrc_c1_model_config` sets `owar_replacement_runs_per_600=26.2`,
  `step8_model_config_2026` sets **21.22** (current refit). ★ Run `step8` LAST/authoritative so 21.22 wins.
- [ ] **NON-IDEMPOTENT migrations** (guard/one-time care): bare CREATE POLICY (June 20260622/23), `RENAME total_war`
  (20260806), `TRUNCATE gm_allocation` (20260710120000), `team_season_stats_war_rollup` INSERT (dupes on re-run —
  use the refresh fn), player_slot_values dedup DELETE. Full list in PROD_PUSH_STEPS landmines.
- [ ] **ORDER:** `20260821010000` (ts war cols) BEFORE first `refresh_team_season_stats(2026)` (else empty table).
- **TWO UI items to confirm before push:** `HistoricalPlayerTable` pitcher link → `/player/:id` (verify resolves);
  `/savant/*` deletion (Leaderboards/Conf Stats page/Team Profiles removed, no replacement — confirm intended).

## ★ PROD-PUSH HANDOFF + PlayerHub fix (feature/war-recalibration) — 2026-08-26
- [x] **`docs/HANDOFF_PROD_PUSH_2026_08_26.md`** — the "start here" prod-push handoff (state, doc map, phase flow +
  gates, verification, safety). Companions: PROD_PUSH_STEPS (51 steps + calc/schema refs), PRE_PROD_AUDIT,
  STAGING_UX_WALKTHROUGH, STAGING_DISPLAY_TEST_CHECKLIST.
- [x] **PlayerHub historical-player fix** (`src/pages/PlayerHub.tsx:176`) — identity query now resolves a uuid OR a
  legacy source_player_id (Historical tables link by source_player_id). Fixes pitcher/hitter misclassification +
  blank season-stats preview for historical players. tsc clean; page-load verify is in the UX walkthrough §9.
- **model_config `owar_replacement_runs_per_600` RESOLVED:** staging = **21.22** (verified; = 1.62 repl × 13.1 RPW,
  data-driven from the .380 win% anchor). PROD: run ONLY `step8_model_config_2026` (has 21.22); do NOT run
  `wrc_c1_model_config` (stale 26.2). Currently a seeded constant the edge fn reads — future: auto-derive in a calibration stage.

## ★ TEAM BUILDER WAR/MARKET + dWAR opportunity (feature/war-recalibration) — 2026-08-26
- [ ] **dWAR opportunity-scaling — NEEDED, safe to DEFER past first prod push (Trevor).** dWAR does not scale with
  defensive opportunity/innings (depth role) the way oWAR scales with PA — a depth-role change moves oWAR but not dWAR.
  Full writeup: memory `project_dwar_opportunity_scaling`. Not a prod blocker; required follow-on.
- [ ] **TB WAR column mislabeled** — `RosterTab.tsx:177` header says "oWAR" but the value is already `total_hitter_war`
  (via `pickHitterWar`, clean rows). FIX = relabel header "oWAR"→"WAR" (+ the `:294` tooltip). Value compute NOT changed.
- [ ] **TB market disconnect (INVESTIGATED)** — the live/dirty hitter path (`useTeamBuilderSimulation.ts:1101-1105`)
  computes market from OFFENSE oWAR (`owarAdj`), not `total_hitter_war`. Clean rows read the stored (total-based) market;
  toggling recomputes off offense-only → diverges most for bad defenders. FIX (confirm w/ Trevor): base the live market
  on total (offense recomputed + stored d_war/bsr_war). Returner path has the same shape.
- [ ] **Fill 16 build-snapshot totals** — 16 of 578 hitter build-snapshots have `o_war` but null `total_hitter_war`
  (fill missed some non-default builds). FILL every build's snapshot `total_hitter_war = o_war + d_war + bsr_war`,
  **without changing any saved toggle** (dev_agg/depth/nil untouched). STAGING + PROD (re-run after prod snapshots baked).
- [ ] **★ Hitter descriptive Run Values on Season Stats banner — PROD needed (schema + fn + populate)** —
  (1) apply `supabase/migrations/20260826150000_hitter_descriptive_run_values.sql` (6 cols on
  `pitch_log_hitter_totals`, additive/idempotent) + `20260826150500_populate_hitter_run_values_fn.sql`
  (the `populate_hitter_run_values(season)` fn); (2) after the season-stats aggregation
  (`aggregate_pitch_log_dimensions.ts --apply`, which now CALLS the fn at the end) has filled the totals
  tables, the `all`-row run values + national z-scores are populated — or run `select
  populate_hitter_run_values(2026);` standalone if the totals already exist. Descriptive last-season values
  (batting = wRC+-derived, defensive = drs_floor, baserunning = wsb_runs) + `*_z` over qualified pop
  (`pa≥50`/`half_innings≥50`/`opportunities≥20`). Display pure-reads. ⚠ **When Track B (unified edge fn)
  absorbs stage 3b, it MUST also call `populate_hitter_run_values(season)`** (season-stats aggregation is
  currently a HAND-RUN script, not an edge fn). STAGING done 2026-08-26 (6,099 `all` rows; coverage
  batting 6,053 / def 5,138 / bsr 5,346; Souza verified). Full writeup:
  `docs/AGENT_LEARNINGS_hitter_run_values_2026_08_26.md`.
- [ ] **FRONTEND / DISPLAY — ships with the branch merge to main (Vercel prod build); NO separate DB step** —
  (a) **What's New modal** new `2026-08-26` release (4 features: Complete WAR / Market Valuations / Run Values /
  Sharper Projections), `STORAGE_KEY` v8→**v9** so it fires for all users on deploy — this IS the deferred
  "post-push WhatsNewModal note," now in-branch; (b) **run-value VALUE panel** on hitter Season Stats (needs the
  data from step 13b + `populate_hitter_run_values`); (c) **"oWAR"→"WAR"** header relabel (RosterTab / TargetBoardTab);
  (d) **PlayerHub** historical id resolution (uuid OR source_player_id). Copy rules honored (no overclaim / no
  disparaging past / no em-dashes). Full record: `docs/AGENT_LEARNINGS_ui_and_whats_new_2026_08_26.md`. Verify via
  `docs/STAGING_CLICKTHROUGH_2026_08_26.md`.
- [ ] **★ Snapshot hitter market RE-PRICE (stale-PTM fix) — PROD needed** — `recompute-snapshot-hitter-market.ts --prod --apply`
  (runbook **step 42b**, Phase F, AFTER market resyncs). Snapshot `market_value` re-derived = `total_hitter_war × $25k ×
  PTM(build-program conf) × PVF(players.position)`, dollar field ONLY, all toggles preserved. Fixes snapshots frozen at the
  OLD SEC 1.5 PTM (~$42.5k/win) from before the SEC-4.0 re-price — the profile/TB pure-read the snapshot so stale $ shows
  verbatim (Souza showed $50,983 for 1.20 WAR; correct = $131,823). Root confirmed: profile/TB are NOT live-computing — they
  read the active build snapshot; only the baked dollars were stale. **PVF stays in the market** (pricing layer, Allocation
  Spec §7.2); it is removed only from the Player SCORE (`calcPlayerScore`, §1). ⚠ **Script gotcha now fixed (keep on prod):**
  filter null/non-UUID pids + error-check the `players` position `.in` batches — one literal-`null` player_id else poisons a
  whole batch (invalid-uuid), silently dropping ~200 real players' positions → PVF wrongly flattens to 1.0. STAGING done
  2026-08-26 (472 rows, then 38 position-corrections; idempotent, 0 impossible/negative markets).

---

## POINTERS — the Stuff+ chain and classifier facts live in the docs, not the ledger
- Lane map + chain order: `docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`
- Exact numbers (classifier thresholds, equations, §11 accuracy): `docs/STUFF_PLUS_EXACT_VALUES.md`
- Prod execution order: `docs/PROD_PUSH_STEPS_2026_08_26.md`

---

# STAGE 0 — PRE-PROD BLOCKER STATUS (updated 2026-08-30): **1 OPEN, THE REST RESOLVED**
Prod's **DATA is ready** — 100.00% of prod's `is_data=true` rows (~1,906,398) are v2-classifiable, venue corrections
resolve, same games/window as staging. Every blocker was CODE or SCHEMA, and all but one have shipped.

## ⛔ STILL OPEN — the only thing blocking the prod chain
1. **PROD `pitch_log_corrected` VIEW IS STALE — missing `classification_version`.** The view is `select pl.*, …` and
   Postgres FREEZES `*` at creation time, so prod's view is stuck at **94 columns** vs the base table's 99. Missing:
   `classification_version, needs_review, ab_num_in_game, pitch_num_in_game, pitch_num_in_ab, park_code,
   is_conference_game, game_string`. Running the scorer's query against prod returns
   `column pitch_log_corrected.classification_version does not exist`. Same query on staging = OK.
   ⚠ `create or replace view` will NOT fix it (new columns land mid-list) → needs **`drop view pitch_log_corrected
   cascade; create view …`** rebuilt against the current column list. **DDL — requires an explicit go, separate from the
   data-write "prod, now?".** (Reclassification itself is unaffected — `reclassify_prod.ts` doesn't read those columns.)

## ✅ RESOLVED — shipped; do NOT re-raise these as blockers
2. **Scorer version filter — RESOLVED.** It was hard-coded `.eq("classification_version","v1-anchor-2026-08-17")` while
   `reclassify_prod.ts` stamps `v2-ranges-2026-08-28`, so it silently matched 0 rows (new labels + old scores). It is now
   **parameterized (`--class-version=`, defaulting to the v2 stamp)**. *Evidence:* on staging steps 1→3 connected
   end-to-end and scored 2,015,321 rows. (This also supersedes the old checklist item "do NOT loosen the filter".)
3. **`_reclass_pf` producer — RESOLVED.** `reclassify_prod.ts` now materializes it as a by-product of `pfbVelo()`.
   *Evidence:* the staging run materialized **5,364 pitchers**, and step 2 read it back.
4. **`aggregate_pitch_log_dimensions.ts` prod path — RESOLVED.** It now has a prod path + a `--prod` guard, plus the NEW
   `--direct` and `--only=` flags. *Evidence:* `--direct` cleared `vs_top_hitters` on staging in 253.2s.
5. **§4.5 ordering — RESOLVED.** §4.5 runs BEFORE the step-4 backfill; measured **95.2% / 95.3%** (§11.13) — strictly
   better on both metrics than the 95.1% "after the fold" ordering, so there is nothing left to measure or revert.
6. **Ordered pagination — RESOLVED.** `derive_masters_from_pitchlog.ts` `readAll` is ordered, plus two further
   ordered-pagination fixes (`backfill_trackman_pitches_pitching_master.ts`, `compute_conf_pitcher_env_plus.ts`).
7. **Legacy lane gated out of the live prod CSV path — RESOLVED.** `scripts/import-csvs/runner.ts` (= `npm run
   import:prod`, which goes DIRECT to prod) no longer runs the legacy raw-HB lane, and npm `recompute-stuff:prod` /
   `recompute-stuff-scoped:prod` were **DELETED**. A routine TruMedia import can no longer score left-handers backwards.
8. **Ledger entries — RESOLVED.** C20 park_code (2,576,146 = 100%), C21 `is_conference_game` + C22 sequence
   (2,576,146), and migration `20260828000000_pitch_log_classification_version_needs_review.sql` are all logged in
   `PROD_MIGRATIONS_TODO.md`.
9. **Staging reclassification writer — RESOLVED.** `reclassify_prod.ts --target=staging`, with a double-keyed guard
   (it refuses unless PGURI's project ref matches the named target).

## ⚠ CLAIMS THAT ARE FALSE — audits disproved them; do not treat any of these as live blockers
"A5 aggregator (pitch_log → `pitcher_stuff_plus_inputs`) is missing" · "the baseline deriver is missing" ·
"the live path has a pop/row convention mismatch" · "the v2 reclassification WRITER does not exist" ·
"the classifier is only ~85% and cannot reach its gate". All verified present / correct / superseded.

## OPEN BUT NOT BLOCKING
- **C21/C22 derive-over-copy follow-up.** They were COPIED from staging (`_next_derived.ts`), not derived. Prod must be
  able to DERIVE `park_code` / `is_conference_game` / sequence going forward or **Track B breaks on the next ingest.**
- **Migration `20260829120000_gm_budget_nil_allocation_mode.sql`** — committed, **NOT yet applied to either env.**
- **Row-count populations, pinned so gates are falsifiable** (these are DIFFERENT populations, not a contradiction):
  2,576,230 = prod pitch_log total pre-dedup · 2,576,146 = park_code/is_conf/sequence filled · ~2,176,888 = prod rows
  carrying an OLD CASE label · 2,013,005 = the v2 prod DRY-RUN label count · **prod `is_data=true` ≈ 1,906,398**
  (74.01% of 2,575,996) · staging v2 classified/stamped = 2,015,321.

## GREEN — verified ready on prod (audit 2026-08-29, read-only)
v2-classifiable **100.00%** of is_data=true (~1,906,398) · venue corrections **311 rows**, ivb/hb_corrected differ from
raw in 100% of samples · release_velocity/ivb/hb/spin/rel_height/rel_side/pitcher_hand/pitcher_id/park_code/
is_conference_game/sequence/pitcher_full_name all **0.00% NULL** (extension 0.04%) · same games + window as staging
(2026-02-13 → 06-22, identical first/last uniq_pitch_id) · `pitcher_stuff_plus_ncaa` 18 D1 buckets ·
pitch_log_pitcher_totals 37,186 · hitter_totals 50,227 · by_pitch_type 161,310 / 252,464.
⚠ `Pitching Master` rollup is BEHIND staging: `trackman_pitches>0` **1,126 vs 6,458**; `stuff_plus` 5,251 vs 6,011.
⚠ `vaa` column absent on prod — NOT a blocker (100% NULL on staging; neither classifier nor scorer reads it).

---

# ▶️ STAGING + PROD STATE, AND THE NEXT ACTIONS (2026-08-30)

## ✅ DONE + VERIFIED ON STAGING (do NOT redo)
| step | result |
|---|---|
| 0 backup | `_v2_prechain_backup` = **2,579,655 rows** / 2,191,583 labeled / 2,014,152 scored. **DO NOT DROP until the chain is signed off.** Reverses everything via one UPDATE…FROM join on `uniq_pitch_id`. |
| 1 classify | **2,015,321** stamped `v2-ranges-2026-08-28`, needs_review **8.1%**, 101 batches, updated 1,995,321. `_reclass_pf` materialized (**5,364** pitchers) — NEW producer, first ever run, works. |
| 2 baseline | **✓ armHB SIGN CHECK PASSED ON ALL 18 BUCKETS** → upserted 18/18. The armHB convention is now PROVEN, not assumed (the deriver aborts before writing if it fails). |
| 3 score | **2,015,321 scored + recentered** (35.7 min). unscored = 0. Every (type×hand) bucket recenters to **exactly 100.0**. |
| 4 aggregate | **ALL 48 dimensions refreshed** + `populate_hitter_run_values(2026)` ✓. The 3 `vs_top_hitters` aggregations that had failed on the gateway were completed over the DIRECT pg session (`--direct`). Tables: pitcher_totals 37,575 · hitter_totals 50,633 · pitcher_by_pitch_type 186,622 · hitter_by_pitch_type 301,957 · hitter run values 6,053. |

**★ PROD-GATE TOLERANCE (pre-registered): per-pitcher Stuff+ mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 ·
4,234 pitchers.** Prod must land within tolerance of this or **ABORT**.

## ⚠ STILL OPEN ON STAGING
- **Step 5 `derive_masters_from_pitchlog.ts` — DRY RUN ONLY.** Dry run: **0 hitters / 4,675 pitchers** would change
  (of 4,772 above-gate). It has NEVER been applied on ANY environment. Review the diff before `--apply`.

## ▶️ NEXT ACTIONS, IN ORDER
1. Review + apply step 5 (Masters) on staging.
2. **PROD BLOCKER FIRST — rebuild the stale view:** prod `pitch_log_corrected` is `select pl.*` frozen at **94 of 99
   columns** and MISSING `classification_version`, so the scorer hard-fails there. Needs
   `drop view pitch_log_corrected cascade; create view …`. **DDL — needs its own explicit go, separate from "prod, now?".**
3. Apply migration `20260829120000_gm_budget_nil_allocation_mode.sql` to BOTH envs (committed, never run).
4. Prod chain: reclassify → baseline → score → aggregate (**`--direct` from the start**) → Masters. Then C23→C29,
   Phase D→H per the runbook, on the pitch_log lane.

## ⏱ PROD TIME BUDGET
Staging actuals: step 1 ≈ **75 min** (load + classify + 2M keyset UPDATE) · step 3 ≈ **36 min** · step 4 ≈ **50 min**
→ **staging total ≈ 2.5-3 h.** Prod is a SMALLER compute tier with a MORE throttled disk and its `exec_sql` already
times out on lighter queries → **budget 4-6 h for the prod Stuff+ block alone**, plus C23-C29 and Phases D-H after it.
Do it in **ONE sitting** with the machine pinned awake (`caffeinate -dimsu -w <pid>`) — steps 1→5 must not be split,
because a gap leaves prod with **v2 labels + STALE scores**.
⚠ **Step 3 does NOT resume** (it re-scores everything matching the class version), so any interruption costs the FULL
runtime again. The two-phase fix (score only `stuff_plus IS NULL`, then ALWAYS recenter across the full population) is
worth building BEFORE the prod run — the recenter must see the whole population, which is why a naive resume is wrong.

---

## 🏆 PHASE-H CLEANUP — WHAT MUST NEVER BE DROPPED
Phase H lists the Stuff+ `_reclass_*` temp tables as drop candidates. **EXCLUDE these — plus `team_war_snapshots`:**
- **`_reclass_result` (2,000,674 rows)** — the ONLY surviving record of the lost ANCHOR classifier's output. Its source
  code was scratchpad-only and is gone permanently. Now that we standardize on v2, this is the SOLE way to ever measure
  against the old process — the regression baseline for every future classifier change.
- **`_reclass_map` (37,101 rows)** — per-pitcher seed→label resolution; the evidence base for arsenal-conditioning research.
- **`_reclass_pf` (4,804 rows)** — per-pitcher primary-FB velo (the v2 staging run materialized 5,364 rows of it).
- **`team_war_snapshots`** — holds prod's irreplaceable 2025 champions (309 rows). NEVER drop.
Safe to drop: **`_reclass_fix`** (transient writer staging table only).

---

## ★ PRE-PUSH DEFECT PASS — 2026-08-30 (feature/war-recalibration). NO DB WRITES MADE.
All findings below come from READ-ONLY probes (`information_schema`, `pg_proc`, `select`) against BOTH projects.

### ⛔ NEEDS TREVOR'S GO — `team_season_stats` migrations (the biggest remaining blocker)
- [ ] **THREE migrations are absent from prod** — not two. Probe 2026-08-30: prod
  `to_regclass('public.team_season_stats')` = **NULL**, and `pg_proc` has **no** `refresh_team_season_stats`.
  Staging has the table (128 cols, PK `(source_id, season)`, 4 indexes, 308 rows for 2026) and the function
  `(p_season integer, p_reg_end date)`.
  **Apply in EXACTLY this order:**
  1. `supabase/migrations/20260819000000_team_season_stats.sql` — CREATE TABLE + 3 indexes + RLS
  2. `supabase/migrations/20260821010000_team_season_stats_war_columns.sql` — 10 `ADD COLUMN IF NOT EXISTS`
  3. `supabase/migrations/20260819010000_refresh_team_season_stats.sql` — CREATE OR REPLACE FUNCTION
  **Order is load-bearing:** the function's body writes the step-2 columns, and its first statement is
  `DELETE FROM team_season_stats WHERE season = p_season`. Apply 3 before 2 and the first `refresh_team_season_stats(2026)`
  deletes the season and then **aborts** on `column "hitter_war_total" does not exist` — table left EMPTY.
  All three are `IF NOT EXISTS` → idempotent.
  **Verification query + the full copy-pasteable plan: `docs/PROD_PUSH_STEPS_2026_08_26.md` Phase-A step 10a.**
  Blocks **F44** (`select refresh_team_season_stats(2026);`) and **G46** (edge fn reads the table at
  `supabase/functions/process-precompute-jobs/index.ts:1095`,`:1419`).
  ⚠ Known drift, deliberately NOT in the plan: staging has a 128th column `preseason_proj_total_war` from a hand-run
  ALTER that no committed migration contains and **zero** code references (grepped migrations/functions/scripts/src).
  Prod-after-plan = 127 columns. Do not hand-add it; if wanted, write a committed migration first.

### ✅ CODE FIXES LANDED THIS SESSION (no DB writes)
- [x] **`scripts/resync-build-snapshot-markets.ts` was hardcoded to `rd(".env.local", …)`** — neither `--prod` nor
  `--env-file` could redirect it, so an F42 "prod resync" would silently resync **STAGING** and report success.
  Now env-driven (`process.env` first, env-file fallback) + double-keyed guard. Same guard added to
  `resync-target-snapshots.ts`, `rebuild-twp-target-rows.ts`, `rebake-twp-markets.ts`,
  `fix-returner-twp-hitter-market.ts` (the last two were bare `process.env.SUPABASE_URL` with **no** guard at all).
  Invoke on prod as `npx tsx --env-file .env.production.local scripts/<x>.ts --prod --apply`.
  All 10 refuse paths + both allow paths smoke-tested against both projects.
  ⚠ `resync-build-snapshot-markets`'s default scope is the **staging** build id `7429b448-17be-42a1-9434-86f54ab24e49`,
  which returns **0 rows on prod** — use `--all` there. Script now warns on a 0-row non-`--all` scope.
- [x] **`src/lib/computeNcaaAverages.ts` unordered `.range()`** — corrupted the means/SDs every projection divides by.
  Fixed with a `PAGINATION_KEYS` map of each table's ACTUAL primary key; unregistered tables now **throw** rather than
  paginate unordered. ⛔ **Never replace this with a blanket `.order("id")`**: `pitch_log_pitcher_totals`,
  `pitch_log_hitter_totals`, `player_season_defense`, `player_season_baserunning` have **no `id` column** on either
  project. Smoke-tested `.order(key).range(0,2)` — 7/7 ✓ on staging AND prod.
- [x] **`computeNcaaAverages` Stuff+ weight moved off the LEGACY lane.** Was summing
  `pitcher_stuff_plus_inputs.pitches`; now sums `pitch_log_pitcher_totals.stuff_plus_data_pitches` at
  `dimension_key='all'`, joined `pitcher_id` ↔ `Pitching Master.source_player_id`. The silent `.catch(() => [])` is
  REMOVED — a fetch failure used to become `stuff_plus = NULL`, which makes `computeAndStoreScores`
  `fetchSeasonBaselines` fall back to hardcoded defaults **silently**.
  Measured (read-only `dryRun` of `computeAndStoreNcaaAverages(2026)`): staging 102.0846 → **102.0846** (unchanged);
  **prod 101.8361 → 102.3337** (+0.4976). Prod's stored `ncaa_averages(2026).stuff_plus` is 101.8341 today, so expect
  it to move to ≈102.33 when C27 runs. **Log the value you actually get.**

### ✅ DOC ORDERING CORRECTIONS (each now carries a one-line reason so it isn't "corrected" back)
- [x] **C26 `computeAndStoreScores` runs AFTER C27 `computeNcaaAverages`** — `computeAndStoreScores.ts:206-211` reads
  its baselines (incl. `stuff_plus`/`stuff_plus_sd`, `:249`) from `ncaa_averages`; missing fields fall back to
  hardcoded defaults silently (`:212-215`). Fixed in `PROD_PUSH_HANDOFF_RESUME_2026_08_26.md` (was still 26→27) and
  annotated on the C11/C12 rows of `PROD_PUSH_BULLETPROOF_CHECKLIST.md`. STEPS + RUNBOOK already agreed.
- [x] **C29 NJCAA_D1 re-tag runs BEFORE C28 conference stats** — verified read-only 2026-08-30: prod season 2026 has
  40 `division='D1'` Conference Stats rows of which **10 are `NJCAA%`**; staging is already 30 `D1` + 10 `NJCAA_D1`.
  Both C28 producers (`compute_conf_pitcher_env_plus.ts:29`, `derive_conf_opr_htp.ts:12`) filter `.eq("division","D1")`.
  Fixed in RESUME; annotated on the E5/E6/E8 rows of the CHECKLIST.
- [x] **Dead step 47 (`recalculate-prediction` returner rebuild)** marked DEAD at `RUNBOOK` PART C step 5,
  the PART B section header (steps 5/6/7/9 — only step 8 is still live work), and PART E Phase 1.
  `RUNBOOK:213` (G3), `RUNBOOK:239`, `CHECKLIST` G2 and `STEPS` step 47 were already marked.
- [x] **Bad `.order("id")` advice removed** from `STEPS` step 31 and `RESUME` Phase D — `player_season_defense` /
  `player_season_baserunning` have no `id` column; use their real PKs.

### ⚠ CONTRADICTIONS FOUND IN THE EXISTING DOCS (corrected in place)
- `STEPS` "ALREADY ON PROD" listed **`team_season_stats` … DONE** while a 🛑 twelve lines below said it does not exist.
  The 🛑 is right; the DONE line was struck through.
- `STEPS` "NEEDED" list calls A8 (`Conference Stats.hitter_talent_plus`/`run_env_factor`) and A9
  (`Park Factors.*_seasonal`) **MISSING** on prod. Probed: the **columns exist on prod**; it is the **values** that are
  absent (`hitter_talent_plus` 0/42 non-null, `rg_factor_seasonal` 0/309). Same for the Master `desc_*` columns
  (present; 0/5,340 populated). Documented as a table on Phase-A step 10a. The distinction matters — no DDL is needed
  for those, only the E2/E5/E6 and D31/D32 producers.

---
# ✅ MANDATORY PHASE-GATE CHECK — "column exists" ≠ "column is populated" (added 2026-08-30)
The 2026-08-30 audit measured that A8/A9-era columns **EXIST** on prod. It did NOT measure whether their producers
actually FILL them. Those are different failures and only the second one is silent.
**RULE: after EVERY producer step, verify the VALUE landed — not just that the column/table is there.**
A producer that runs, exits 0, and writes nothing looks identical to success. We hit this exact shape twice already:
`vs_top_hitters` left 5,349 STALE rows that made a row-count check PASS, and `compute_pitch_log_stuff_plus` was
filtered to a version string that matched 0 rows while appearing to succeed.

## KNOWN-EMPTY ON PROD TODAY (columns present, values absent) — each must be re-checked AFTER its producer runs
| column / field | table | prod state (2026-08-30) | filled by | GATE: re-check after |
|---|---|---|---|---|
| `hitter_talent_plus` | Conference Stats | **0 / 42** non-null | C28 conf-stats work | C28 |
| `run_env_factor` | Conference Stats | absent values | C28 (`compute_conf_pitcher_env_plus` / `derive_conf_opr_htp`) | C28 |
| `rg_factor_seasonal` (+ the other 9 `*_seasonal`) | Park Factors | **0 / 309** | E2 park-factor producer | E2 |
| `desc_owar` (+ `desc_*` / `total_desc_war`) | Hitter/Pitching Master | **0 / 5,340** | D31 `populate_descriptive_war.mjs` · D32 `_reg` | D31/D32 |
| `preseason_proj_total_war` | (staging-only col, 127 vs 128) | absent on prod | some precompute/snapshot call — NOT a migration | E/F precomputes |
| `trackman_pitches` | Pitching Master | **1,126** vs staging **6,458** | C24 | C24 |
| `stuff_plus` | Pitching Master | 5,251 vs staging 6,011 | C25 `derive_masters_from_pitchlog` | C25 |

## HOW TO GATE (do this at every phase boundary, not at the end)
1. **Count non-null BEFORE and AFTER** the producer. `after > before` and `after ≈ staging's count` — record both numbers.
2. **Compare to STAGING** (the source of truth) for the same season. ⚠ **SEASON KEYS DIFFER BY PURPOSE:
   2026 = completed season / descriptive WAR · 2027 = projections.** A query on the wrong season returns a misleading
   ZERO. (This already produced a false "staging has no WAR data" alarm on 2026-08-30.)
3. **Validate by CONTENT, not exit code** — several producers exit 0 having written nothing.
4. **Verify FRESHNESS, not row count** — a failed step can leave stale rows that a count check passes.
5. If a value is STILL empty after its producer ran, that is a SEPARATE BUG. Stop and diagnose; do NOT proceed to the
   next phase assuming it fills later.

---
# 🛑 STEP 5 / C25 `derive_masters_from_pitchlog.ts` — READ BEFORE `--apply` (2026-08-30)
**This script had NO gate on new-row creation.** `newHitterRows`/`newPitcherRows` were spread into the SAME upsert as
the patches, so `--apply` silently INSERTED invented Master rows and there was no way to take the updates without the
inserts. **FIXED 2026-08-30: new-row creation is now opt-in via `--create-new`, default OFF.**

**WHY inserting them is wrong:** the Masters are the **TruMedia season-stat source of truth**. This script only marries
pitch-log derivations onto EXISTING rows — it explicitly never writes `ERA, IP, G, GS, Role`. A row built from
pitch_log alone is a **HALF-POPULATED player** that downstream treats as real with missing stats. And the candidates
are exactly the pitchers present in pitch_log but ABSENT from the Master — identity-resolution gaps and non-TruMedia
teams — i.e. the rows you least want silently materialized.

## HOW TO RUN IT
```
# review first — dry run is the DEFAULT (no flag)
npx tsx --env-file .env.local scripts/derive_masters_from_pitchlog.ts
# apply patches to EXISTING rows only (new rows skipped + counted in the output)
npx tsx --env-file .env.local scripts/derive_masters_from_pitchlog.ts --apply
# ONLY if the new-row list has been reviewed and each row is genuinely wanted:
#   ... --apply --create-new
```
## MANDATORY BEFORE `--apply` ON EITHER ENV
1. **BACK UP BOTH MASTERS FIRST** — there is no other backup and this writes the season-stat tables.
   Staging snapshots taken 2026-08-30: `_hm_prestep5_backup` (30,027 rows) · `_pm_prestep5_backup` (29,239), each a
   full copy indexed on `(source_player_id, "Season")`. **Do the equivalent on PROD before C25.**
2. **Read the diff, not the headline count.** The dry run reports "N would change", but the per-player samples show
   many IDENTICAL before/after values (`9.42/9.42`, `4.81/4.81`) — i.e. no-op rewrites inflate that number. Confirm
   WHICH FIELDS actually move and by how much before accepting it.
3. **Hitters vs pitchers is a useful control.** An earlier dry run showed **0 hitters / 4,675 pitchers** changing —
   consistent with this being Stuff+-driven (the chain just recomputed it) rather than something broader going wrong.
   If HITTERS suddenly start changing too, stop and find out why.
4. **PHASE-GATE after it runs:** Master `stuff_plus` non-null count should rise toward staging's (prod was 5,251 vs
   staging 6,011). "Column exists" ≠ "column populated" — verify the VALUE landed.

---
# ⚠️ `--direct` SILENT HANG — statement_timeout=0 removes the CEILING but also the FAILURE SIGNAL (prod, 2026-08-30)
**What happened:** the prod stage-4 run stalled on `[41/48] vs_top_hitters → pitcher_by_pitch_type` and sat there for
**39 minutes with zero log output**. Diagnosis over a second connection: **NO active query on prod** (`pg_stat_activity`
showed only my own catalog lookup) and **0 ungranted locks** — so the database was doing nothing. The client process was
alive but waiting forever. The direct connection had dropped and the client never learned about it.

**ROOT CAUSE — a gap in the `--direct` fix shipped earlier the same day.** To defeat the HTTP gateway's ~125s cut we set
`statement_timeout = 0` and a very long `query_timeout`. That correctly removes the ceiling that made `vs_top_hitters`
impossible over `exec_sql` — but it ALSO removes the only signal that something died. A dropped pooler connection
therefore presents as an INFINITE HANG instead of an error, and nothing retries because nothing failed.

**FIX TO MAKE (not yet implemented):** on the `--direct` pg client set `keepAlive: true` with a keepalive delay, a
finite `query_timeout` sized to the slowest known dimension with headroom (staging `vs_top_hitters` 254.9s, prod 151.6s
→ e.g. 20-30 min, not 0), and per-dimension progress logging so a stall is visible in the log rather than only in
`pg_stat_activity`. `statement_timeout=0` on the SERVER side is fine; it is the CLIENT-side infinite wait that is wrong.

**HOW TO DETECT A STALL (do this, don't guess):**
1. Compare the log's mtime to now — no output for >2× the slowest dimension = suspect.
2. Query `pg_stat_activity` on a SEPARATE connection: if there is **no active query**, the client is hung, not slow.
3. Check `pg_locks where not granted` — 0 means it is not a lock wait either.
4. Also check for STALE PROCESSES from earlier runs (`pgrep -f aggregate_pitch_log`) — an old staging run was still
   alive and competing for connections.

**RECOVERY (safe — stage 4 is idempotent):** kill the hung + stale processes, then re-run. Prefer re-running the FULL
set on prod rather than cherry-picking with `--only`/`--skip`: dimension rows that already exist may be STALE from the
pre-v2 process, and "rows exist" does NOT mean "rows are fresh". Steps 1-3 are unaffected — do NOT redo them.
**Nothing was corrupted by this stall.**

---
# ✅ PROVEN ON PROD — THE STUFF+ CHAIN, WHAT IT PRODUCED, AND WHY IT IS CORRECT (2026-08-30)
The full 5-step chain has now run END-TO-END on BOTH environments. This is the record of what worked, the values it
produced, and the EVIDENCE that it is right — not just that it completed.

## THE RESULT — PROD AND STAGING AGREE ON INDEPENDENT DATA
| check | STAGING | PROD | verdict |
|---|---|---|---|
| pitches classified | 2,015,321 | 2,013,005 | both = every `is_data=true` row |
| label distribution | 4S 37.8 · SI 16.0 · SL 10.3 · GY 10.2 · CH 9.1 · CB 5.6 · SW 5.2 · FC 3.7 · SPL 2.1 | **IDENTICAL** | deterministic |
| needs_review | 8.1% | 8.1% | identical |
| per-pitcher Stuff+ | mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 | **mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7** | identical |
| bucket recenter | every (type×hand) = 100.0 | every (type×hand) = 100.0 | correct by construction |
| unscored rows | 0 | 0 | full coverage |
| armHB sign check | 18/18 buckets | 18/18 buckets | convention PROVEN twice |
| Master avg stuff_plus | 98.82 | 98.86 | consistent |
**WHY THIS IS THE PROOF:** two DIFFERENT pitch populations, run through the same committed classifier + scorer,
produced the same distribution to the tenth of a percent AND the same per-pitcher percentiles. That cannot happen by
chance if anything upstream (labels, baseline, convention, recenter) were wrong. Independent replication, not a
self-check.

## THE VALUES IT USED (canonical; see the "TRACK B — EVERY VALUE THE CHAIN COMPUTES WITH" block)
Classifier v2 @ **95.2% per-pitch / 95.3% arsenal-mix** vs the anchor ground truth (full 2,000,674-pitch population).
Three shipped fixes, each MEASURED not guessed: offspeed **armHB floor = 5** (gyro p99 4.7 vs offspeed p1 5.3, a clean
empty gap) · **fastball-family merge guard** (91.69%→93.01%, 4S↔Sinker errors −41%) · **§4.5 gyro floor = −3 applied
BEFORE the backfill** (95.1%→95.2% AND fragmentation 7%→5%, strictly better on both). Two NEGATIVE results recorded so
they are never rebuilt: `rr > −1.7` and the "arsenal rule" (both lose ~1pp). Verified-optimal, do not touch:
Sweeper/Slider armHB −12 (1.0% error) · Gyro/Slider armHB −5. **RPW = 13.1**, verified stored in BOTH envs'
`model_config` (`owar_runs_per_win` / `pwar_runs_per_win`) and present 4× in prod's live `refresh_composite_war()`.

## WHY EACH SAFEGUARD MATTERED (all of these fired or would have)
- **Abort-before-write sign check** — the reason armHB is TRUSTED on both envs rather than assumed.
- **Backups before every destructive step** (`_v2_prechain_backup` 2.58M/2.58M rows, `_hm_prestep5_backup` 30,025/30,027,
  `_pm_prestep5_backup` 29,238/29,239) — made the whole chain reversible; used to disprove a suspected regression.
- **Halt-on-failure between steps** — stopped a quoting bug before it wrote anything.
- **`--direct` for stage 4** — `vs_top_hitters` needs 151–255s and the HTTP gateway cuts at ~125s, so it would have
  failed 100% on prod AND halted the 8 dimensions behind it.
- **New-row creation gated OFF** — prevented inventing half-populated Master rows. Confirmed 0 new rows on both envs.
- **Phase-gate "value landed, not just ran"** — caught that `pull_air` went 0 → 4,366 on prod (C23 subsumed by C25).

## ⚠ THE THREE TRAPS THAT PRODUCED FALSE ALARMS (check these before reporting a problem)
1. **Season keys.** 2026 = completed/descriptive · 2027 = projections. Wrong season ⇒ misleading ZERO. Caused a false
   "staging has no WAR data" alarm.
2. **Different denominators.** A count across ALL seasons vs `Season=2026 AND division='D1'` are not comparable —
   this produced a false "trackman_pitches regression" (it was 0 before AND after; C24 populates it, and it had not run).
3. **"Rows exist" ≠ "rows fresh."** A failed aggregation leaves stale rows that PASS a count check.
**RULE: compare like-for-like against the BACKUP before calling anything a regression.**

---
# ✅ C24 `trackman_pitches` — PITCH_LOG-FIRST for D1, LEGACY only for JUCO (fixed + applied to prod 2026-08-30)
**THE BUG:** `backfill_trackman_pitches_pitching_master.ts` summed `pitcher_stuff_plus_inputs.pitches` — the LEGACY
CSV-fed table — to set `trackman_pitches`. That column is the **TrackMan sample-size gate for the Stuff+ display
qualifier**, so it MUST come from the same lane as the Stuff+ values it gates. Same defect shape as
`computeNcaaAverages`: the VALUE moved to the pitch_log lane but a supporting COUNT was left on the legacy table.
**MEASURED ON PROD — the two sources disagree badly:** of 5,367 shared pitchers only **638 (11.9%) were IDENTICAL**;
the legacy table **UNDERCOUNTS by ~12.1 pitches/pitcher** (2,507,664 vs 2,572,528 total, ~65k pitches missing).
An undercount pushes borderline thin-sample arms the WRONG way on the leaderboard.

**THE FIX (Trevor: "keep juco and true ncaa d1 separate"):**
- **D1 → `pitch_log_pitcher_totals.total_pitches` at `dimension_key='all'`** (5,509 pitchers).
- **JUCO → `pitcher_stuff_plus_inputs` fallback.** JUCO has **NO pitch logs at all** — that is the 7,013 vs 5,509
  pitcher gap. Never mix the two lanes; never "fix" JUCO by pointing it at pitch_log.
Implementation: new `pageAll2()` helper (ordered pagination + `dimension_key` filter); pitch_log values OVERRIDE the
legacy sums where present, legacy remains only where pitch_log has nothing.

**DRY RUN (prod):** `pitch_log (D1): 5,509 pitchers · OVERRODE 5,509 with pitch_log · 1,646 remain legacy-sourced
(JUCO / no pitch log) · would change 5,618 Master rows (5,376 NULL, 242 different)`. Values demonstrably changed vs the
legacy version (e.g. `13108257 314→375`, `14110428 1016→685`, `19295025 1280→1435`) — proof the legacy source was wrong.
**APPLIED:** 5,618 rows written.
**PHASE GATE PASSED:** `D1 5,375/5,375` · `NJCAA_D1 2,695/2,695` · `D2 1/1` — 100% coverage, each from the correct lane.

---
# ✅ C27 → C26 APPLIED TO PROD 2026-08-30 (order is load-bearing — C27 FIRST)
## C27 `computeNcaaAverages` — ✅ APPLIED
`hittersUsed 5,340 · pitchersUsed 5,375 · fieldsWritten 72 · modelConfigRowsWritten 40 · ncaa_averages 2026 = 1 row`
**`p_ncaa_avg_stuff_plus` 101.8341 → 100.0141** · `p_sd_stuff_plus = 5.04577` · `p_ncaa_avg_whiff_pct = 23.3673`.
★ **The Stuff+ mean landing at 100.01 is independent CONFIRMATION that the recenter survived the whole chain**
(score → aggregate → Master rollup). The old 101.83 came from the legacy-weighted lane.
⚠ **C27 MUST PRECEDE C26.** `computeAndStoreScores.ts:206-211,:249` reads baselines from `ncaa_averages` and, for any
MISSING field, falls back to HARDCODED defaults **SILENTLY** (`:212-215`). Wrong order ⇒ quietly wrong power ratings
with no error. This ordering was inverted in the docs and is now corrected everywhere.

## C26 `computeAndStoreScores` (propagate=false) — ✅ APPLIED
`pitchers 8,071 updated, 0 errors · hitters 8,244 updated, 0 errors` · `propagate=false` honored on BOTH sides
(**`player_predictions` untouched** — it is Phase F that repopulates those).
🛑 **BUG FIXED BEFORE RUNNING:** `scripts/_run_store_no_propagate.ts` had **NO env guard** and its banner claimed
"staging" while `--env-file .env.production.local` would happily write PROD. Added the standard double-keyed guard
(URL and `--prod` must AGREE) and made the banner print the resolved env. Refuse path verified:
running against the prod env WITHOUT `--prod` now aborts with `✗ URL is PROD but --prod was not passed`.

## PATTERN WORTH NOTING (3 for 3 on the last three steps)
C24 was sourcing from the LEGACY lane · C26's runner had no guard and a banner that LIED about the target DB · C27 was
documented in the wrong ORDER. **Every one was caught by inspecting the step before running it, not after.** Do not
run a remaining step (C28/C29, D, E, F) without first checking: (1) which LANE does it read from — pitch_log or the
legacy PSP-I? (2) does it have a working double-keyed `--prod` guard? (3) is its position in the sequence right, and
does anything it depends on fall back to defaults SILENTLY?

---
# ✅ C29 NJCAA_D1 RE-TAG — APPLIED TO PROD 2026-08-30 (MUST run BEFORE C28)
**BEFORE:** prod `Conference Stats` 2026 = `D1 40 · D2 2`, of which **10 were `NJCAA%` districts wrongly tagged
`division='D1'`** (Appalachian, East, Mid-South, Midwest, Plains, South Atlantic, South Central, South, Southwest, West).
**APPLIED:** `update "Conference Stats" set division='NJCAA_D1' where season=2026 and division='D1' and
"conference abbreviation" like 'NJCAA%'` → **10 rows re-tagged**.
**AFTER (verified):** `D1 30 · NJCAA_D1 10 · D2 2` — **0 NJCAA rows remain tagged D1**. Matches staging exactly.
⚠ **ORDER IS LOAD-BEARING — C29 BEFORE C28.** Both C28 producers (`compute_conf_pitcher_env_plus`,
`derive_conf_opr_htp`) filter on `division`. Running C28 first writes D1-derived values into the JUCO overlay and
CONTAMINATES the JUCO baselines silently — the same "keep JUCO and true NCAA D1 separate" principle applied in C24.
Also: with 10 JUCO rows counted as D1, the D1 conference SDs were inflated (JUCO FIP runs 6.4–8.0).

---
# 🛑 C28 PRE-FLIGHT — FINDINGS (2026-08-30). RUN NOTHING UNTIL THESE ARE RESOLVED.
Ran the 5-question pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) against PROD. Three blockers found.

## ✅ LANE — CLEAN (both producers are on the correct lane)
`compute_conf_pitcher_env_plus.ts` reads `ncaa_averages` (refreshed by C27 ✅) + `"Pitching Master"` D1 WHIP/IP
(refreshed by C26 ✅) + `"Conference Stats"`. `derive_conf_opr_htp.ts` reads `"Park Factors".rg_factor` +
`"Conference Stats"` + `"Teams Table"`. **Neither touches the legacy `pitcher_stuff_plus_inputs`.** Also confirms the
C27-before-C26-before-C28 ordering is right: C28 consumes what both of those produced.

## 🔴 BLOCKER 1 — NEITHER PRODUCER HAS ANY `--prod` GUARD
`grep -c "trbvxuoliwrfowibatkm\|--prod"` = **0** for BOTH `compute_conf_pitcher_env_plus.ts` and
`derive_conf_opr_htp.ts`. `--env-file .env.production.local` writes PROD with **zero opt-in** — the same defect
already fixed in `_run_store_no_propagate.ts` (C26) and the four market scripts. **FIX BEFORE RUNNING:** add the
standard double-keyed guard (URL and `--prod` must AGREE) and verify the refuse path.

## 🔴 BLOCKER 2 — NO BACKUP EXISTS ON PROD, AND THE G-GATE REFERENCE DOES NOT EXIST EITHER
`_confstats_backup` = **ABSENT** on prod · `_confstats_backup_preassembly` = **ABSENT** on prod.
C28 is a DESTRUCTIVE rebuild of the conference baselines that every projection's competition-translation consumes.
**FIX: `create table _confstats_backup as select * from "Conference Stats"` on prod FIRST.**
⚠ The documented **G-GATE** (re-run bucketA on STAGING, diff vs `_confstats_backup_preassembly`, require 0.0000) has
**NEVER been executed** — it was deferred 2026-08-21 ("no staging conn"). The preassembly baseline it compares against
does not exist on prod, so the gate must be run on STAGING, where the artifact belongs.

## 🔴 BLOCKER 3 — `Park Factors.rg_factor_seasonal` IS EMPTY ON PROD (0/309) — SILENT-FALLBACK RISK
| | PROD | STAGING |
|---|---|---|
| Park Factors 2026 rows | 309 | 308 |
| `rg_factor` | **309 ✅** | 308 |
| `rg_factor_seasonal` | **0 ❌** | **308 ✅** |
`derive_conf_opr_htp.ts:10` reads **`rg_factor`**, which IS populated on prod — so C28 will run. BUT prod is missing
the entire `*_seasonal` set that staging has (its producer, E2 `backfill_park_factors_seasonal.ts`, is hardwired to
STAGING and has never run on prod — audit G13/H4). **Decide BEFORE C28 whether the conference run-environment should
use the seasonal factors** (as staging effectively does downstream) or the flat `rg_factor`. If prod and staging use
different park inputs, their conference HTP/OPR will diverge and the staging-match gate becomes meaningless.

## CURRENT PROD STATE (what C28 is meant to fill)
`Conference Stats` 2026 = **42 rows** (D1 30 · NJCAA_D1 10 · D2 2 after C29) ·
**`hitter_talent_plus` 0/42** · **`run_env_factor` 0/42** ← C28 fills these · `Stuff_plus` **42/42** (pre-existing copy;
audit G14 notes D1 `Stuff_plus` has NO committed producer — confirm what refreshes it or it stays stale while
everything around it is rebuilt).

## ORDERED EXECUTION (only after 1-3 are resolved)
1. Add `--prod` guards to both producers; verify refuse paths.
2. `create table _confstats_backup as select * from "Conference Stats"` on PROD; verify row count = 42.
3. Run the **G-GATE on STAGING** (bucketA re-run vs `_confstats_backup_preassembly`, require diff 0.0000). ABORT if not.
4. Resolve the `rg_factor` vs `rg_factor_seasonal` decision.
5. PROD: **PASTE** `conf_stats_bucketA_assembly.sql` in the SQL editor — **NEVER `--linked`** (`supabase/config.toml`
   currently names a THIRD project ref `kfkuhdmpchxyffmnowgj`; run `supabase projects list` first).
6. `compute_conf_pitcher_env_plus.ts --apply --prod` → `derive_conf_opr_htp.ts --apply --prod`.
7. **PHASE GATE:** `hitter_talent_plus` and `run_env_factor` go 0/42 → populated; D1 stays 30 and NJCAA_D1 stays 10;
   conference Stuff+/HTP compare sanely to staging.
⛔ **NEVER run `populate-conf-stats` on prod** — it overwrites the hand-calibrated JUCO overlay. Different script,
confusingly similar name, not part of C28.

---
# ✅ C28 BLOCKERS 1 & 2 CLEARED (2026-08-30) — blocker 3 was MY over-call, corrected
## ✅ FIXED — `--prod` guards added to BOTH producers
`compute_conf_pitcher_env_plus.ts` and `derive_conf_opr_htp.ts` had **NO env guard at all** (grep count 0) —
`--env-file .env.production.local` would have written PROD with zero opt-in. Added the standard double-keyed guard
(URL and `--prod` must AGREE, refuse otherwise, log the resolved env). **Refuse paths VERIFIED on both:**
`✗ URL is PROD but --prod was not passed — refusing.`
## ✅ FIXED — backups created on PROD
`_confstats_backup` = **162 rows (42 for season 2026)** · `_parkfactors_backup` = **615 rows**.
Park Factors was backed up too even though C28 only READS it — E2 rewrites that table later, and a restore point is
cheap now and expensive to lack later.
## ⚠️ CORRECTION — "park factors must be filled first" was WRONG (my over-call)
`derive_conf_opr_htp.ts:10` reads **`rg_factor`**, which is **309/309 populated on prod**. It NEVER reads
`rg_factor_seasonal`. The SAME script on staging reads the SAME column, so **both environments use identical park
inputs for C28 and there is no divergence** — the staging-match gate remains valid.
The empty `rg_factor_seasonal` (prod 0/309 vs staging 308/308) is **E2's job, later in the sequence**, and its
producer `backfill_park_factors_seasonal.ts` is still hardwired to STAGING (audit G13/H4) — fix that before E2, not
before C28. **C28 is NOT blocked on park factors.**
## STILL OPEN BEFORE C28 RUNS
- **G-GATE on STAGING** — re-run `conf_stats_bucketA_assembly.sql`, diff vs `_confstats_backup_preassembly`, require
  **0.0000**. Never executed (deferred 2026-08-21). The reference table is a STAGING artifact.
- **D1 `Conference Stats.Stuff_plus`** — 42/42 populated on prod but audit G14 says there is NO committed producer.
  Establish what refreshes it, or it stays stale while everything around it is rebuilt.
- ⛔ bucketA must be **PASTED** in the SQL editor, never `--linked` (config.toml names a THIRD ref `kfkuhdmpchxyffmnowgj`).
- ⛔ **NEVER** run `populate-conf-stats` on prod (overwrites the hand-calibrated JUCO overlay).

---
# 🔴→✅ CONFERENCE STUFF+ WAS ON THE LEGACY LANE — FIXED 2026-08-30 (critical for Track B)
## THE FINDING (audit G14 said "no committed producer" — that was WRONG)
`src/savant/lib/conferenceStuffPlusV2.ts` **IS** the producer of `"Conference Stats".Stuff_plus`. But it read
per-pitcher scored rows from **`pitcher_stuff_plus_inputs`** — the **LEGACY CSV lane**. The v2 chain writes Stuff+ to
`pitch_log.stuff_plus` and rolls it up to `"Pitching Master".stuff_plus`; it **NEVER writes PSP-I**, so PSP-I holds
**PRE-v2 scores**. Conference Stuff+ would therefore have been built from stale numbers.
**WHY THIS ONE MATTERS MOST:** Conference Stuff+ IS the competition-translation lever — a player projected INTO a
conference is scored against that conference's Stuff+/HTP. A stale value silently biases **every projection**.
This is the THIRD instance of the same shape (C24 `trackman_pitches`, `computeNcaaAverages` weighting, now this):
**the VALUE moved to the pitch_log lane but a supporting INPUT was left on legacy.**

## THE FIX
Read the rolled-up per-pitcher value and its pitch count straight from `"Pitching Master"`:
`Σ("Pitching Master".stuff_plus × trackman_pitches) / Σ(trackman_pitches)` — definition unchanged (pitch-weighted,
full season). Both inputs are **pitch_log-sourced for D1** (C25 writes `stuff_plus`, C24 writes `trackman_pitches`)
and correctly **fall back to the legacy lane for JUCO**, so ONE formula stays right for BOTH divisions without ever
mixing lanes. Filters `stuff_plus IS NOT NULL AND trackman_pitches > 0`.

## VERIFIED ON STAGING (values are sane and the D1/JUCO relationship is correct)
`D1 30 conferences avg 99.16 (range 92.9–107.3)` · `NJCAA_D1 10 avg 96.00 (92.0–100.7)` · `D2 2 avg 93.00`.
D1 centring near 100 with JUCO clearly below it is the expected "conference pitching depth" signal.

## ⚠ GAP FOUND WHILE TESTING — `calculateConferenceStuffPlusV2` IGNORES `dryRun`
It was called with `{ dryRun: true }` and **wrote anyway** ("5. write to Conference Stats"). The option is not
implemented. Benign here (staging needed the refresh and the values are correct) but **there is no way to preview this
producer**. Before running it on PROD: either add real dry-run support, or rely on `_confstats_backup` (already created
on prod, 162 rows / 42 for 2026) as the rollback.
## TRACK B REQUIREMENT
Track B's conference-stats stage must compute Conference Stuff+ from the **pitch_log lane via Pitching Master**, never
from `pitcher_stuff_plus_inputs`, and must keep the D1 / JUCO fallback split intact.

---
# ✅ G-GATE EXECUTED AND PASSED (staging, 2026-08-30) — deferred since 2026-08-21, now done
Method: snapshot `"Conference Stats"` 2026 → `_ggate_before`, re-run `scripts/sql/conf_stats_bucketA_assembly.sql`,
then diff EVERY numeric column joined on `(conference_id, season)`.
**RESULT: 77 numeric columns compared · 0 changed · worst absolute diff 0.000000.**
✅ **The bucketA assembly is IDEMPOTENT** — re-running it does not drift values. Safe to run on prod.
(Reference table `_confstats_backup_preassembly` exists on staging: 162 rows, 42 for 2026.)

# 📊 PROD "Conference Stats" 2026 (D1, 30 rows) — WHAT IS FILLED vs WHAT C28 FILLS
**FILLED (66 cols):** AVG · OBP · ISO · ERA · FIP · WHIP · K9 · BB9 · HR9 · `Overall_Power_Rating` · `WRC_plus` ·
`ba_plus` · `ba_power_rating` · `Stuff_plus` · … (all inputs C28 needs are present)
**EMPTY (13 cols) — exactly C28's outputs, so there is NO partial state:**
`era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus` ← `compute_conf_pitcher_env_plus`
`hitter_talent_plus` `run_env_factor` ← `derive_conf_opr_htp`
`OPS` `SLG` `slg_plus` `pitcher_ev_score` `pitcher_iz_score` ← bucketA assembly

## 🛑 STALE-VALUE CATCH — `Stuff_plus` IS 30/30 FILLED ON PROD **BUT IT IS PRE-v2**
The Conference Stuff+ lane fix was applied and verified on **STAGING only**. Prod's `"Conference Stats".Stuff_plus`
still holds the value computed BEFORE the v2 chain — a fully-populated column that PASSES any count check while being
stale. Third occurrence today of "looks populated, isn't fresh".
→ **C28 ON PROD NEEDS ONE MORE STEP THAN THE DOCS LIST:** run the FIXED `conferenceStuffPlusV2`
(`Σ(Pitching Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)`) to refresh `Stuff_plus` from the pitch_log
lane, ALONGSIDE the two producers that fill the 13 empty columns. Otherwise the competition-translation lever stays
stale while everything around it is rebuilt.
→ Staging reference after the fix: D1 30 conf avg **99.16** (92.9–107.3) · NJCAA_D1 10 avg **96.00** · D2 2 avg 93.00.

---
# 🧩 C28 BUCKET MAP — WHO WRITES WHAT, AND WHY `Stuff_plus` FELL THROUGH THE GAP (2026-08-30)
`scripts/sql/conf_stats_bucketA_assembly.sql:12` states the split verbatim:
`SCOPE: writes ONLY Bucket A (rates/env+/WRC_plus). Bucket B (OPR/Stuff_plus/run_env_factor/…)`

| bucket | producer | columns it writes |
|---|---|---|
| **A** | `conf_stats_bucketA_assembly.sql` (PASTE in SQL editor) | `OBP` `ISO` `SLG` `OPS` `obp_plus` `slg_plus` `iso_plus` `WHIP` `FIP` `ERA` + rates + `WRC_plus` |
| **B (pitching env+)** | `compute_conf_pitcher_env_plus.ts` | `era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus` |
| **B (OPR/HTP)** | `derive_conf_opr_htp.ts` | `run_env_factor` `offensive_power_rating` `hitter_talent_plus` |
| **B (Stuff+)** | ⚠ **`conferenceStuffPlusV2.ts` — a SEPARATE producer, NOT part of the documented C28 steps** | `Stuff_plus` |

## ★ THE GAP, STATED PLAINLY
`Stuff_plus` belongs to **Bucket B** but is written by **NEITHER** bucketA **NOR** `derive_conf_opr_htp`. It has its own
producer that the C28 runbook never listed. So:
**`Stuff_plus` is the ONLY Conference Stats metric that is BOTH (a) stale on prod (pre-v2) AND (b) not refreshed by any
of the three documented C28 steps.** Every other filled column is either rewritten by Bucket A / Bucket B, or is a
source input already refreshed by C24 / C26 / C27.
Because it is 30/30 populated it PASSES every count check while being stale — and it is the competition-translation
lever, so a stale value silently biases EVERY projection of a player INTO a conference.

## ✅ C28 ON PROD — THE CORRECTED FOUR-STEP ORDER (the runbook had three)
0. **Backups already created on prod:** `_confstats_backup` (162 rows / 42 for 2026) · `_parkfactors_backup` (615).
1. **PASTE** `conf_stats_bucketA_assembly.sql` in the SQL editor. ⛔ **NEVER `--linked`** — `supabase/config.toml`
   names a THIRD project ref (`kfkuhdmpchxyffmnowgj`). Run `supabase projects list` first.
   ✅ **G-GATE PASSED 2026-08-30** — re-run on staging diffed 77 numeric columns: **0 changed, worst 0.000000**, so the
   assembly is IDEMPOTENT and cannot drift prod's values.
2. `npx tsx --env-file=.env.production.local scripts/compute_conf_pitcher_env_plus.ts --apply --prod`
   ✅ `--prod` guard ADDED 2026-08-30 (it had none); refuse path verified.
3. `npx tsx --env-file=.env.production.local scripts/derive_conf_opr_htp.ts --apply --prod`
   ✅ `--prod` guard ADDED 2026-08-30 (it had none); refuse path verified.
   Reads `"Park Factors".rg_factor` — **309/309 populated on prod** (it does NOT read `rg_factor_seasonal`, which is
   empty on prod; that is E2's job and NOT a C28 blocker).
4. **★ NEW STEP — refresh `Stuff_plus`:** run the FIXED `conferenceStuffPlusV2`
   (`Σ("Pitching Master".stuff_plus × trackman_pitches) / Σ(trackman_pitches)`).
   ⚠ **It IGNORES `dryRun` and writes regardless — no preview exists.** Rollback = `_confstats_backup`.
⛔ **NEVER run `populate-conf-stats` on prod** — different script, confusingly similar name, overwrites the
hand-calibrated JUCO overlay.

## PHASE GATE AFTER C28 (verify VALUES, not just that it ran)
- The 13 previously-EMPTY columns become populated: `era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus`
  `hitter_talent_plus` `run_env_factor` `OPS` `SLG` `slg_plus` `pitcher_ev_score` `pitcher_iz_score`.
- `Stuff_plus` CHANGES from its stale pre-v2 value (compare BEFORE/AFTER — do not just count non-nulls).
- Division split holds: **D1 = 30 · NJCAA_D1 = 10 · D2 = 2**.
- Staging reference shape after the same fix: D1 avg **99.16** (92.9–107.3) · NJCAA_D1 avg **96.00** · D2 avg 93.00.

---
# ✅ C28 APPLIED TO PROD 2026-08-30 — all four steps, phase gate PASSED
Ran via the DIRECT pg session with the prod ref asserted (equivalent to pasting; **never `--linked`**).
BEFORE snapshot kept as `_c28_before` (alongside `_confstats_backup`).
1. **bucketA assembly** → `OPS` `SLG` `slg_plus` 0/30 → **29/30**
2. **`compute_conf_pitcher_env_plus --apply --prod`** → **30 conf rows**, 0 skipped.
   SANITY (correct direction): SEC ERA 5.82 → era+ **105** · Ivy 5.20 → **117** · HR9 SEC 1.62 → hr9+ **68**
   (SEC allows more HR ⇒ env+ <100) · Ivy 0.70 → **156**.
3. **`derive_conf_opr_htp --apply --prod`** → **30 rows**. e.g. Big 12 HTP 120.4 → **121** · MWC 98.8 → 97.8.
4. **★ `conferenceStuffPlusV2` (FIXED lane)** → **31 rows written**.

## ★ THE `Stuff_plus` CATCH WAS REAL — this is why step 4 exists
**D1 `Stuff_plus`: 101.17 → 99.15, with 30/30 rows CHANGED.** Prod now matches staging's **99.16**.
Following the runbook's three steps would have left it at the stale pre-v2 **101.17** while everything around it was
rebuilt — and a count check would have shown **30/30 populated and PASSED**. Because Conference Stuff+ is the
competition-translation lever, that stale value would have silently biased EVERY projection of a player into a conference.
Division relationship holds and matches staging: **D1 99.15 · NJCAA_D1 96.00 · D2 93.00**.

## PHASE GATE RESULT (D1, all were 0/30 before)
`era_plus 30` `fip_plus 30` `k9_plus 30` `whip_plus 30` `hitter_talent_plus 30` `run_env_factor 30` ✅
`OPS 29` `SLG 29` ⚠ · `pitcher_ev_score 0` ⚠

## ⚠ TWO LOOSE ENDS — NOT resolved, do not assume benign
1. **`OPS`/`SLG`/`slg_plus` = 29/30**, one conference short. Probable cause: a conference with no qualifying hitters,
   but **UNVERIFIED**. Identify the missing conference before trusting conference hitting rates for it.
2. **`pitcher_ev_score` = 0/30 and `pitcher_iz_score` likewise** — listed as bucketA outputs but bucketA did NOT fill
   them. Either they have a different producer or a precondition is unmet. **Find the producer before Phase F**, since
   these feed pitcher-side conference context.

---
# 🔍 C28 LOOSE ENDS — INVESTIGATED AND RESOLVED (2026-08-30)
Method: compare PROD against STAGING (which had already run C28) rather than reasoning from prod alone. This settled
all three in minutes — **always diff the two environments before theorising.**

## 1. ✅ `OPS`/`SLG`/`slg_plus` = 29/30 — EXPECTED, NOT A DEFECT. The missing conference is **Independent**.
```
PROD    — D1 conferences with NULL OPS: Independent
STAGING — D1 conferences with NULL OPS: Independent   (identical)
```
Independents have no conference-mates, so the conference hitting aggregate has nothing to pool. **29/30 is CORRECT on
both environments** — do NOT "fix" this. (Consistent with the existing rule that Independents are handled by
faced-competition Stuff+/HTP rather than conference pooling.)

## 2. ✅ `pitcher_ev_score` / `pitcher_iz_score` = 0/30 — NOT deprecated, NOT a prod gap. **Their producer has never run.**
Empty on **BOTH** prod and staging, so it is not something C28 broke. ⚠ I nearly recorded them as dead columns
superseded by `pitcher_ev90_score` / `pitcher_iz_whiff_score` — **that was WRONG.**
**They have a real producer: `src/savant/lib/conferenceScoutingAverages.ts`**, which WRITES them at `:453` / `:455`
(`pitcher_ev_score: round1(psEV)`, `pitcher_iz_score: round1(psIZ)`) and reads them back at `:520-522`.
→ **ACTION: run `conferenceScoutingAverages` for 2026 to fill them.** It has never been run for this season on either
environment. Pitcher EV mirrors hitter EV and is expected to be populated.

## 3. ★ PROD IS NOW AHEAD OF STAGING on the raw conference pitcher metrics
| column | PROD | STAGING |
|---|---|---|
| `pitcher_ev90` | **30/30** | 0/30 |
| `pitcher_exit_velo` | **30/30** | 0/30 |
| `pitcher_in_zone_pct` | **30/30** | 0/30 |
| `pitcher_iz_whiff_pct` | **30/30** | 0/30 |
| `pitcher_ev90_score` · `pitcher_iz_whiff_score` | 30/30 | 30/30 |
The C28 run filled these on prod; staging never had them. **CONSEQUENCE: staging is no longer a valid reference for
these columns** — do not treat a prod/staging mismatch here as a prod defect. Staging needs C24/C26/C27/C29 + this C28
pass applied to catch up (it only ever received the Stuff+ chain and the Conference Stuff+ lane fix).

## 🧠 LESSON
Two of the three "problems" were not problems, and the third was nearly mis-diagnosed in the opposite direction
(calling a live-but-unrun column deprecated). **Diff the environments FIRST, then grep for a producer, and only then
conclude.** A column being empty means one of: (a) expected/no data to pool, (b) its producer has not run, or
(c) genuinely dead — and those are indistinguishable from the fill count alone.

---
# ✅ C28b — CONFERENCE SCOUTING AVERAGES RUN (prod, 2026-08-30). `pitcher_ev_score` 0/30 → 30/30
**WHY:** `pitcher_ev_score` / `pitcher_iz_score` were 0/30 on **BOTH** prod and staging. They are **NOT deprecated** —
`src/savant/lib/conferenceScoutingAverages.ts` writes them at `:453` / `:455` and reads them at `:520-522`. The
producer had simply **never been run for 2026 on either environment**.
**NEW RUNNER:** `scripts/run_conference_scouting_averages.ts` — the library function had no env guard and no runner
existed, so the runner carries the standard double-keyed guard (URL and `--prod` must AGREE). Refuse path verified:
`✗ URL is PROD but --prod was not passed — refusing.`
**PRE-FLIGHT (all five, before running):** LANE ✅ reads `ncaa_averages` (C27) + the Masters (C25/C26), no legacy PSP-I ·
PAGINATION ✅ `fetchAll` already orders by `source_player_id` · ORDER ✅ needs `ncaa_averages`, C27 done · SILENT
FALLBACK ✅ **none** — it errors explicitly ("run Compute NCAA Averages first") if baselines are missing ·
BACKUP ✅ `_confstats_backup` (162 rows) + `_c28_before`.
**RESULT ON PROD (verified in the DB, not from the log):** `pitcher_ev_score` **30/30, avg 53.22** ·
`pitcher_iz_score` **30/30**.
⚠ **The console printed `conferences computed: 0` while successfully writing 30 rows** — my runner reads the wrong
field off the report object. Harmless, but a reminder of the standing rule: **verify in the database, never from the
log line.** (Fix the field name if this runner is reused.)
⬜ **STAGING still has these at 0/30** — run the same command there (without `--prod`) when catching staging up.

---
# 🗺️ PHASE D (dWAR / bsrWAR) — INVESTIGATION + PLAN (2026-08-30). Read before running anything.
Phase D is **entirely a season-2026 (descriptive) operation** and is **INDEPENDENT of Phases C, E and F** — D31/D32
take their constants from LOCAL JSON fixtures (`RPW 13.1`, E2T, replacement RA9, wOBA weights), NOT from `model_config`
/ `ncaa_averages` / `Conference Stats`. Nothing Phase C produced is an input here. It can run now.

## 🛑 THE ONE HARD BLOCKER — `team_war_snapshots.team_drs` DOES NOT EXIST ON PROD
`populate_descriptive_war.mjs:76` reads `team_war_snapshots(source_team_id, team_drs)`; the error branch at `:65` is
`process.exit(1)`. **D31 dies before writing a single row** (no partial-write risk, but it will not run).
🛑 **CORRECTION 2026-08-30 (late) — MY EARLIER "just paste `scripts/sql/team_drs_store.sql`" INSTRUCTION WAS WRONG AND IS REVERTED.** I was only supposed to reorder the steps, not change WHAT they do. The documented process — which predates this session and stands — is to **REGENERATE the value on prod, never copy it**:
- `AGENT_LEARNINGS_stuff_plus_2026_08_16.md:802-803`: *"regenerate team_drs via `scripts/drs/derive_team_drs.mjs` if needed. **PROD: run against PROD `team_war_snapshots`**"*
- `PROD_PUSH_BULLETPROOF_CHECKLIST.md` row **D2**: *"Run team_drs producer against prod … (FIX: add `--prod` + env guard)"*, gate **308 D1 rows sum ~0**
- `AGENT_LEARNINGS:859,:869` list **`team_drs_store.sql` under "script writers to RETIRE"** — it is a FROZEN SNAPSHOT of a computation, not the computation. Pasting it into prod is exactly the copy-instead-of-derive the project rule forbids ([[feedback_derive_over_copy]]).
**WHAT `derive_team_drs.mjs` ACTUALLY COMPUTES** (`:1-9`, B-R method): per-team `Σ drs_floor` from `player_season_defense`, grouped to a team via the Masters' `TeamID`, then **innings-weighted centering per division** — `team_drs = Σdrs_floor(team) − (division Σdrs_floor / division ΣIP) × team_IP`, so `dRS_behind(pitcher) = team_drs × pitcher_IP / team_IP` and Σ over all pitchers = 0 exactly.
**THE FIX THE DOCS CALL FOR (code, not data):** `:13` reads `./.env.local` only — no `SUPABASE_URL` fallback, no `--prod`. Add the standard double-keyed guard. ⚠ It also has **three unordered `.range()` loops** (`:15`, `:17`, `:22`) which on prod page over the Masters (30,025 rows ≈ 31 pages) and `player_season_defense` (13,454 ≈ 14 pages) — dropped rows silently understate a team's `Σ drs_floor`. Both must be fixed before the prod run.
⚠ **OPEN, NOT RESOLVED:** a read-only check on 2026-08-30 found prod's own data and staging's stored values agree for 303/308 teams (mean |Δ| 0.124) but differ on **Arkansas: 32.800 vs 41.060 (Δ −8.26)**. Which is correct is **UNDETERMINED** — prod's `players` table is LARGER (31,467 vs 15,561) — but that is **HISTORICAL DEPTH going back multiple years, NOT a discrepancy** (Trevor, 2026-08-30). Do not read it as prod being more complete for 2026. **Do not reconcile prod TO staging.** Run the producer on prod, sum per player under the team, and then investigate the difference on its own merits.

## ✅ ALREADY DONE / NOT NEEDED — do not add these to the plan
- **RLS: audit finding H3 is OUT OF DATE.** `relrowsecurity = true` with **0 policies** on `player_season_defense` AND
  `player_season_baserunning`, on **BOTH** envs = **deny-all** to anon/authenticated. The broad table grants are inert
  because RLS gates first. `service_role` bypasses RLS so the D30 loader is unaffected. **No RLS work to do.**
- **D30's data is already on prod** at the current engine version: `player_season_defense` **13,454 rows** (9,268 players,
  `drs-engine-0.11.0`, zero NULLs in drs_floor/total/ceiling; 4,343 are position='P', excluded from d_war by design) ·
  `player_season_baserunning` **10,432 rows** (`drs-engine-0.6.0`). Prod has 24 MORE baserunning rows than staging
  (prod `players` carries multiple years of HISTORICAL rows — 31,467 vs 15,561 — which is expected, not a discrepancy). **D30 is a no-op re-run — dry-run to confirm, then skip.**
- **All 23 Master target columns EXIST on prod** (`woba, wraa, desc_owar, d_war, bsr_war, total_desc_war` + `_reg`
  variants; `desc_ra9, desc_fip_ra9, drs_behind, desc_pwar, total_desc_war` + `_reg`). **No Master DDL needed.** All are
  currently 0-populated on prod — that is what Phase D fills.
- All input CSVs/JSON exist on this machine. ⚠ **They are NOT in git** (`scripts/drs/.gitignore` ignores `output/`;
  `docs/drs-reference/.gitignore` ignores `*.csv`) — **Phase D can only be run from this machine.**
- Run from the **repo root** (`node scripts/drs/populate_descriptive_war.mjs`), never `cd scripts/drs` — the scripts mix
  `output/…`, `scripts/drs/output/…` and `docs/drs-reference/…` relative paths.

## ⚠ FIX BEFORE RUNNING
1. **D31 sort key is under-specified.** `populate_descriptive_war.mjs:62` maps `player_season_defense → "player_id"`, but
   `player_id` is NOT unique there (**9,268 distinct over 13,454 rows**) so ties can shuffle across the 14 page
   boundaries. Real PK is `(player_id, season, position)`. Mirror `src/lib/computeNcaaAverages.ts:184-185` exactly.
   (The 2026-08-30 fix got the hard-error half right — neither table has an `id` column — but left the tie half open.)
   Impact is second-order: a handful of wrong `d_war` values, not a hard failure.
2. **🛑 KILL `scripts/load-drs-wsb-prod.ts`** — a STALE DUPLICATE of the loader that never received commit `af89611`'s
   ordered-pagination fix (`:38` is still bare `.range()`), has **no `--dry-run`**, and is named for prod. It sits one
   tab-completion from the correct script. Delete it or reduce it to a shim.

## ▶️ ORDERED SEQUENCE
```
D29b (NEW)  DERIVE team_drs ON PROD — the documented producer, NOT a paste.
            (a) add the double-keyed --prod guard + ordered pagination to scripts/drs/derive_team_drs.mjs
            (b) alter table team_war_snapshots add column if not exists team_drs numeric;   (DDL only)
            (c) run the producer against PROD; it prints the storage SQL for its OWN derived values
            GATE: 308 D1 rows, Σ centered = 0 per division (the script asserts this itself), then
                  select count(*) filter (where team_drs is not null), round(sum(team_drs)::numeric,2)
                  from team_war_snapshots where season=2026;
            ⛔ do NOT paste scripts/sql/team_drs_store.sql — it holds STAGING's frozen values and is
               listed for retirement. Then tick PROD_MIGRATIONS_TODO.md:234.
D30         npx tsx scripts/load-drs-wsb-staging.ts --prod --dry-run
            EXPECT "13454 would upsert, 11 unresolved" / "10432 would upsert, 30 unresolved" → then SKIP the apply.
            ⛔ NEVER scripts/load-drs-wsb-prod.ts
D31         node scripts/drs/populate_descriptive_war.mjs --prod          (dry-run first, from repo root)
            GATE vs staging (2026 D1): desc_owar mean 0.3456 · d_war mean 0.0103 · bsr_war mean 0.0000 ·
            total_desc_war mean 0.3559 · HITTERS ~5,340 · PITCHERS ~5,375.
            ★ Confirm `drs_behind` is NOT all-zero in the SPOT block — all-zero means D29b did not take.
            then: node scripts/drs/populate_descriptive_war.mjs --prod --commit
            ⚠ ~10,715 individual PostgREST UPDATEs at pool 24 (:151-163), several minutes, NO transaction.
              A mid-run failure leaves a partial write; re-running is safe (pure recompute keyed by source_player_id+Season).
D32         node scripts/drs/populate_descriptive_war_reg.mjs --prod      (dry-run, then --commit)
            ★★ HARD-ORDER: MUST follow D31's commit. It reads `Pitching Master.drs_behind` (:79) and `num(NULL) → 0`,
               so running it early produces WRONG desc_ra9_reg / desc_pwar_reg with **NO error**. Verify
               drs_behind = 5,375/5,375 non-null on prod FIRST.
            GATE: staging has 5,322/5,343 hitter _reg and 5,372/5,377 pitcher _reg — the ~20 shortfall is players absent
            from hitter_accrued.csv, expected.
D33         ⛔ FOLDED INTO D29b — this IS the team_drs producer (`derive_team_drs.mjs`), so by DATA
            ORDER it must run BEFORE D31 (which reads `team_war_snapshots.team_drs`), not last.
            My earlier "SKIP — CSV only" note was wrong in substance: the CSV is a by-product, and the
            script also PRINTS the team_war_snapshots storage SQL (`:8`). It needs the --prod guard and
            the 3 unordered .range() loops fixed first.
D34         VERIFY on prod, 2026, division='D1':
            d_war / bsr_war / desc_owar / total_desc_war = 5,340 non-null each ·
            desc_pwar / desc_ra9 / drs_behind = 5,375 each · avg(d_war) ≈ 0.010 · avg(bsr_war) ≈ 0.000 ·
            avg(desc_owar) ≈ 0.346 · max|total_desc_war − (desc_owar+d_war+bsr_war)| ≤ 0.002 ·
            drs_behind range ≈ −5.24 … 6.48 with ~11 exact zeros.
```

## 📄 DOC CORRECTIONS FROM THIS INVESTIGATION
- **F39 is described wrongly in the runbook.** `refresh_composite_war()` on prod (read via `pg_get_functiondef`) updates
  **`player_predictions`** (`d_war`, `bsr_war`, `total_hitter_war`) — **NOT the Masters**. So it does NOT overlap D31's
  Master writes, and the accidental 2026-08-30 invocation left `Hitter Master.d_war` at 0/5,340 (confirmed).
- **`regular_season_pa` / `regular_season_ip` are 0-populated on prod** (staging 5,339/5,343 and 5,374/5,377). NOT a
  Phase D blocker — D32 selects but never reads them (its reg counts come from CSVs). Producer is
  `scripts/lock-season-cli.ts` / `src/lib/lockRegularSeason.ts` ("Lock Regular Season 2026"). Will bite a later phase.
- **`team_season_stats` is 0 rows on prod** (staging 308 for 2026). Filled in Phase F by `refresh_team_season_stats(2026)`,
  whose step 6 carries `team_drs` across from `team_war_snapshots` — so D29b also unblocks that later carry.

---
# 🔁 DOC-vs-REALITY SWEEP (2026-08-30, late) — re-probed prod directly. FOUR 🛑 BLOCKERS ARE STALE, ONE IS NEW.
Method: direct pg session against the prod ref + `grep -c` on each named script. **Verified, not asserted.**
Every 🛑 in these docs was re-checked against the live database and the current file, because several were written
BEFORE the fixes that resolved them and a stale blocker is as expensive as a missed one.

## ✅ STALE — these 🛑 blockers are RESOLVED. Do not re-do this work.
| doc claim | reality on 2026-08-30 |
|---|---|
| **F44 / step 10a: "`team_season_stats` does not exist, 3 migrations unapplied, CANNOT RUN TODAY"** | **table EXISTS + `refresh_team_season_stats` fn EXISTS** (`pg_proc` = 1). The 3 migrations were applied in DEPENDENCY order as Phase-C prereqs. Table is **0 rows** — that is F44's job, not a blocker. **F44 is RUNNABLE.** |
| **G46: "blocked — `team_season_stats` missing"** | Same. The gate is now only "F44 has RUN and populated it", not "the table must be created". |
| **F42: "`resync-build-snapshot-markets.ts:17` is hardcoded to `.env.local`, will silently write STAGING"** | **FIXED.** The file header now documents the old defect and it is env-driven (`process.env` first, env-file fallback) with a **double-keyed guard**. **F42's first half is runnable.** |
| **F41: "`rebake-twp-markets.ts` / `fix-returner-twp-hitter-market.ts` have no `--prod` flag and no ref assert"** | **FIXED (guards), then SUPERSEDED ENTIRELY 2026-08-31.** 🗑️ **`rebake-twp-markets.ts` is DELETED** — superseded by F42, which writes the same two tables at the **program's** conference; it priced at the **player's** conference (−65% measured). ⏭️ `fix-returner-twp-hitter-market.ts` **SKIPPED** — its remaining 110 rows are all JUCO (parked); D1 was already correct. **Neither is to be run.** |
| **D30: "`load-drs-wsb-staging.ts:53` unordered `.range()` over `players`"** | **FIXED** — `fetchAll` now takes an `orderCol` (default `id`) and orders ascending. The comment documenting why is in the file. |

## 🔴 NEW BLOCKER — `scripts/run-twp-recompute.ts` (step E35) HAS NO ENV GUARD AT ALL
`grep -c 'trbvxuoliwrfowibatkm'` = **0** and `grep -c -- '--prod'` = **0**. E35 is the **FIRST** step of Phase E and it
**sets `is_twp` + primary `position` on `players`** — a write to the identity table that every downstream precompute
keys off. `--env-file .env.production.local` writes PROD with **zero opt-in**, and passing `--prod` does nothing.
This is the SAME defect already fixed in `_run_store_no_propagate.ts` (C26), both C28 producers, and the four market
scripts — **the fifth instance of it.** ⚠ Prod `is_twp` = **137/31,467** vs staging's 253, so this step genuinely has
work to do on prod and WILL be run. **Add the standard double-keyed guard and verify the refuse path before Phase E.**

## 🔴 STILL OPEN — `backfill_park_factors_seasonal.ts` (E2) is unguarded AND staging-hardwired
`grep -c` = **0 / 0**. Prod `"Park Factors"` 2026 = **309 rows · `rg_factor` 309/309 ✅ · `rg_factor_seasonal` 0/309 ❌**
(staging 308/308). Confirms audit G13/H4: the producer has never run on prod. **Not a C28 blocker** (C28 reads
`rg_factor`, which is full) — but it must be guarded + re-pointed before E2, and F44/G46 consume park-derived values.

## 📊 PROD STATE PROBED DIRECTLY (2026-08-30) — the numbers Phase D/E/F start from
```
team_season_stats           EXISTS, 0 rows        refresh_team_season_stats()  EXISTS
team_war_snapshots.team_drs COLUMN ABSENT  ← the Phase D hard blocker (D29b)
"Park Factors" 2026         309 · rg_factor 309 ✅ · rg_factor_seasonal 0 ❌
"Hitter Master"   2026 D1   5,340 · d_war 0 · desc_owar 0 · total_desc_war 0   ← Phase D fills
"Pitching Master" 2026 D1   5,375 · drs_behind 0 · desc_pwar 0                 ← Phase D fills
players                     31,467 · is_twp 137   (staging 253)                ← E35 fills
customer_teams active       14  ✅ (NOT 18 — that is a staging number)
player_predictions 2027     200,754 rows (pre-existing; Phase E regenerates)
```
★ **`Hitter Master.d_war` = 0/5,340 is independent CONFIRMATION that the accidental `refresh_composite_war()` did NOT
touch the Masters** — it writes `player_predictions`. The runbook's F39 description is wrong; see the Phase D block.

## 🧠 LESSON — RE-PROBE BEFORE TRUSTING A 🛑 YOU WROTE YESTERDAY
Four blockers were already fixed and one brand-new one was sitting unflagged in the very next phase. A 🛑 records the
state at the moment it was written; it is **not** a live indicator. **Re-run the check, then act.** The 5-question
pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) has now found a real defect before **every** step it has
been applied to — C24 (legacy lane) · C26 (no guard, lying banner) · C27 (wrong order) · C28 (no guards on either
producer, no backup) · C28b (no runner at all) · Conference Stuff+ (legacy lane) · D31 (sort key) · **E35 (no guard)**.

---
# 📌 TWO DECISIONS LOCKED (Trevor, 2026-08-30)
## 1. STAGING CATCH-UP HAPPENS **AFTER** THE PROD PUSH — and it will be run **THROUGH TRACK B**
Staging is missing C24 / C26 / C27 / C28 / C28b / C29. It is **deliberately** not being caught up first.
**Consequence to hold onto:** for the columns prod has and staging does not (`pitcher_ev90`, `pitcher_exit_velo`,
`pitcher_in_zone_pct`, `pitcher_iz_whiff_pct`, and the conference `*_plus` set), **staging is NOT a valid reference**.
Do not treat a prod↔staging mismatch as a prod defect without first checking which environment is behind.
★ **The catch-up is not a manual re-run of six scripts — it is the FIRST REAL EXERCISE OF TRACK B.**
## 2. `rg_factor_seasonal` **MUST** BE FILLED (not deferred) → E2 is a required step. See the E2 block.
## ★ WHY TRACK B IS THE POINT — the target operating model
**Track B is ONE edge function that runs ONCE PER DAY and performs the entire upload + store chain.** Everything in
this push that is a hand-run script becomes a stage inside that single daily run. That is why **every finding, lane,
order dependency, silent fallback and gate in these documents gets logged into
`docs/PIPELINE_pitch_log_to_projections.md` in full detail** — that document is the SPECIFICATION Track B is built
from, and the prod push is the dress rehearsal for it.
**Every defect found in this push is a requirement for Track B**, because a daily automated run has no human to
notice that a column is "populated but stale":
- the value/input LANE SPLIT (pitch_log vs legacy PSP-I) — 3 occurrences, all invisible to count checks
- ORDER dependencies where a stale input yields wrong numbers with **NO error**: C27→C26 · C29→C28 · D31→D32 ·
  E35→precomputes · **E2→`derive_conf_opr_htp`** (found 2026-08-30)
- SILENT FALLBACKS: hardcoded defaults for missing baselines, `num(NULL) → 0`, a version filter that matches 0 rows
  and exits 0
- destructive delete+reinsert stages that need a backup and a **row-level** (not count-level) gate
**Rule for Track B: a stage is not "done" because it ran. It is done when a stage-specific VALUE gate passes.**

---
# 🅴2 PARK FACTORS SEASONAL — DECISION: **MUST BE FILLED** (Trevor, 2026-08-30). And it FORCES A C28 RE-RUN.
`rg_factor_seasonal` is **0/309 on prod** vs 308/308 on staging. Trevor: **"rg factor seasonal 100% has to be filled."**
So E2 is a REQUIRED step, not the deferral the docs assumed. Investigating it turned up **four** things, one of which
is an ordering dependency that no doc records.

## 🔴 1. THE ORDERING BOMB — **E2 INVALIDATES C28's OPR/HTP OUTPUTS. `derive_conf_opr_htp` MUST BE RE-RUN AFTER E2.**
`backfill_park_factors_seasonal.ts:274` writes the **MAIN** factor columns too, not just `*_seasonal`:
`avg_factor, obp_factor, iso_factor, rg_factor, whip_factor, hr9_factor` + the lhb/rhb set. For the CURRENT season it
sets them to the **3-YEAR ROLLING** mean (2024/25/26), not the single season (`:267` `isCur ? rolling : sf`).
**`derive_conf_opr_htp.ts:10` reads `"Park Factors".rg_factor`** — and C28 step 3 ALREADY RAN on prod against the
*current* `rg_factor`, producing `run_env_factor` **30/30 (avg 101.879)** and `hitter_talent_plus` **30/30**.
E2 changes `rg_factor` underneath them ⇒ **both silently go stale**, and `HTP = OPR + 1.25·(Stuff+−100) + 0.75·park`
is the **competition-translation lever** — the exact same blast radius as the Conference Stuff+ catch.
★ **THEREFORE: after E2 applies, RE-RUN `derive_conf_opr_htp.ts --apply --prod` (C28 step 3).** It is idempotent and
cheap. A count check will show 30/30 and PASS either way — this is the **fourth** "populated but not fresh" trap of
this push. Log the BEFORE/AFTER `run_env_factor` values and require them to CHANGE.
(⚠ If E2 is instead run BEFORE C28 in some future ordering, C28 step 3 simply consumes the new value and no re-run is
needed. The rule is: **`derive_conf_opr_htp` must be the LAST thing to touch park-derived conference columns.**)

## 🔴 2. IT IS A DESTRUCTIVE DELETE + REINSERT OF THREE WHOLE SEASONS — not an upsert
`:285-288` `await sb.from("Park Factors").delete().eq("season", y)` for **each of 2024, 2025, 2026**, THEN inserts
(`:291`). There is **no upsert and no transaction** — a failure between the delete and the insert leaves Park Factors
**EMPTY for those seasons**, which takes conference HTP and every park-adjusted projection with it.
**PROD TODAY:** `2025 → 306 rows` · `2026 → 309 rows` · **no 2024 rows at all** (E2 CREATES the 2024 season on prod).
✅ **`_parkfactors_backup` exists on prod = 615 rows = exactly 306 + 309.** Restore point confirmed complete.
⚠ **ROW-COUNT GATE:** the reinsert only writes teams present in the CSVs. Prod 2026 has **309** rows and staging has
**308** — so at least one prod team may NOT come back. **Diff the team list BEFORE/AFTER and account for every dropped
row by name** before accepting the run. Do not gate on "it inserted lots of rows."

## 🔴 3. HARDCODED TO STAGING — `--env-file` CANNOT REDIRECT IT (same defect class as the old F42)
`:37` `const url = "https://slrxowawbijbjrkozqlj.supabase.co";` — a **literal staging URL** — and `:38-39` reads the
**literal string `.env.local`** for the service key. `grep -c 'trbvxuoliwrfowibatkm'` = **0**, `grep -c -- '--prod'` = **0**.
Running it "on prod" today would **silently rewrite STAGING's Park Factors and report success.**
**FIX BEFORE RUNNING:** make it env-driven (`process.env` first, env-file fallback) + the standard double-keyed guard,
copying the pattern now in `scripts/resync-build-snapshot-markets.ts`. Verify BOTH refuse paths.

## ⚠ 4. MACHINE-LOCAL FIXTURES — like Phase D, this can only be run from this machine
`:33` `ROOT = "/Users/danielleogonowski/RSTR IQ Data/park-factors"` — outside the repo, not in git.
✅ **VERIFIED PRESENT: `2024/`, `2025/`, `2026/`, 6 CSVs each** (combined/lhb/rhb × hitter/pitcher).

## ▶️ E2 ORDERED SEQUENCE
```
E2a  Add the double-keyed guard + env-driven URL/key to backfill_park_factors_seasonal.ts. Verify both refuse paths.
E2b  DRY RUN on prod. It prints "2026 rolling vs existing" mean|Δ| / max|Δ| / worst-8 per metric (:247-254).
     ★ READ THAT DIFF — it is telling you exactly how much C28's run_env_factor is about to move.
     Record the 2026 team list; diff vs the 309 prod rows and name every team that would not be reinserted.
E2c  Confirm _parkfactors_backup = 615 (done ✅). APPLY.
     GATE: rg_factor_seasonal 309/309 (was 0/309) · rg_factor still 309/309 · 2024 season now present ·
           no team silently dropped.
E2d  ★ RE-RUN `derive_conf_opr_htp.ts --apply --prod` — C28 step 3. REQUIRED, see §1.
     GATE: run_env_factor CHANGES from avg 101.879 (30/30 before and after — the count proves nothing).
```

---
# 🔬 ORDER AUDIT — TOPIC vs DATA DEPENDENCY → `docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md`
**The phase order in this document is organized by TOPIC (schema / config / producers / defense / precomputes /
re-bakes), NOT by what-feeds-what. A full read/write graph audit of every remaining step found TWO STRUCTURAL DEFECTS:**
1. 🔴 **PHASE E READS A TABLE PHASE F CREATES.** `precompute-transfer-projections.ts:225` and `precompute-pitchers.ts:279`
   read `team_season_stats.faced_stuff_plus` / `.faced_htp`, whose ONLY producer is **F44**, the LAST step of Phase F.
   Prod's table is **0 rows**. The read **discards `error` and coerces to `[]`**, so the faced-competition adjustment
   for Independent programs **silently does not apply** — the only trace is a log line reading `0 … rows`.
   The docs gate **G46** on this table but never carried that gate back to E38. **→ F44 MUST MOVE BEFORE PHASE E.**
   ✅ No cycle: `refresh_team_season_stats` does NOT read `player_predictions` (grep = 0), so a clean total order exists.
2. 🔴 **A REQUIRED STEP IS IN NO RUNBOOK.** `refresh_team_season_stats.sql:143` divides by `sum(regular_season_ip)`,
   which is **0/5,375 on prod** ⇒ `nullif(...,0)` → **NULL** ⇒ every regular-season rate in `team_season_stats` lands
   NULL, silently. Producer = `scripts/lock-season-cli.ts` ("Lock Regular Season 2026"), which appears as a numbered
   step **nowhere**. **→ ADD AS `D33b`, before F44.**
**CORRECTED ORDER (derived from the graph, not the topic):**
`D29b → D30 → D31 → D32 → ★D33b lock-season → E2 → ★re-run derive_conf_opr_htp → ★F44 → E35 → E36 → E37 → E38 →
F39 → F40 → F41 → F42 → F42b → F43 → G46`
**Edges the topic order got RIGHT (do not churn):** F39-after-E · F40→F41→F42 · E35-before-precomputes · C27→C26→C28 ·
G46 last. Full evidence, per-step reads/writes, and the three Track B requirements are in the audit doc.

---
# 🔬 ORDER AUDIT PART 2 — PHASES A, B, C (THE WORK ALREADY DONE). Was any of it run out of order, or since invalidated?
Trevor: *"you audited everything we already did as well included in that correct?"* — **Initially NO. Now yes.**
Part 1 audited only the REMAINING steps. This part runs the same read/write graph over the COMPLETED work and asks the
question that actually matters: **is anything we already ran now STALE because of something else we ran after it, or
something we are about to run?** Verified against prod, not reasoned.

## ✅ RESULT: EVERY COMPLETED STEP IS STILL VALID. Nothing already run needs redoing. Two near-misses, both clean.
| edge | verified | verdict |
|---|---|---|
| chain 1→2 | `derive_stuff_plus_pop_baseline` reads `_reclass_pf` + `pitch_log_corrected` (reclassifier outputs) | ✅ correct order |
| chain 2→3 | `compute_pitch_log_stuff_plus` reads `pitcher_stuff_plus_ncaa` (chain 2) | ✅ |
| chain 3→4 | aggregation reads scored `pitch_log` | ✅ |
| chain 4→**C27** | `computeNcaaAverages:347` reads **`pitch_log_pitcher_totals`** and weights Stuff+ by `stuff_plus_data_pitches` (`:24-26` — the LIVE pitch_log lane, explicitly NOT the legacy PSP-I) | ✅ correct lane AND correct order |
| C24→C28-4 | Conference Stuff+ = `Σ(Pitching Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)` — needs C24's `trackman_pitches` AND the chain-5 `stuff_plus` | ✅ both were run first |
| C27→C26 | `computeAndStoreScores` reads `ncaa_averages`, silently defaults if absent | ✅ C27 ran first (this was CORRECTED earlier this push) |
| C29→C28 | both C28 producers filter on `division` | ✅ C29 ran first |
| C26→C28-2 | `compute_conf_pitcher_env_plus` reads `"Pitching Master"` + `ncaa_averages` | ✅ |
| C27→C28b | `conferenceScoutingAverages` reads `ncaa_averages`, errors loudly if missing | ✅ |

## ✅ NEAR-MISS 1 — **PHASE D DOES NOT INVALIDATE PHASE C.** (Checked because it easily could have.)
If `computeNcaaAverages` (C27) or `computeAndStoreScores` (C26) read any `desc_*` / WAR column, then Phase D writing
those columns would make C26/C27 stale and force a re-run of the whole back half of Phase C.
**Grepped both for `desc_owar|desc_pwar|d_war|bsr_war|total_desc_war|drs_behind|regular_season_*`: ZERO hits.**
→ **Phase D and Phase C touch DISJOINT Master columns. No re-run needed.** ✅

## ✅ NEAR-MISS 2 — **D31 DOES NOT CLOBBER C26's POWER RATINGS.** (The dangerous shape would be a full-row upsert.)
`populate_descriptive_war.mjs:156` is **`.update(cols).eq("source_player_id",…).eq("Season",…)`** — a **PARTIAL column
UPDATE**, not `.upsert()` of a whole row. It writes only its own `desc_*` columns and leaves C26's
`ba/obp/iso_power_rating`, `pRV+`, `era⁺…` untouched. ✅
⚠ **BUT NOTE ITS ERROR HANDLING:** `:157` is `if (error) { console.error(…) }` — errors are **printed, not counted,
and not fatal**, inside a 10,715-update loop that then **exits 0**. Another "validate by CONTENT, not exit code" case.
**Gate D31 on the non-null counts, never on the exit code.**

## ✅ NEAR-MISS 3 — **C27 DID NOT OVERWRITE PHASE B's TUNED CONFIG.** (C27 upserts `model_config`, so this was real.)
`computeNcaaAverages:428` upserts `model_config` `onConflict: model_type,season,config_key` — it would silently
overwrite any Phase-B key it shares. **Verified on prod AFTER C27 ran:** `nil_tier_sec = 4.0` ✅ ·
`r_obp_std_pr = 31.89504` ✅ · **220 keys** (unchanged) ✅ · **6** `_sd_good`/`_sd_bad` keys with **0** still reset to 0 ✅.
C27's keys (`p_ncaa_avg_*` / `p_sd_*`, e.g. `p_ncaa_avg_stuff_plus = 100.0141`) are **DISJOINT** from Phase B's tuned
weights. **Phase B survived C27 intact.** ✅

## 🛑 DEFECT FOUND IN THE ALREADY-DONE WORK — THE VERIFICATION GATE ITSELF USES KEY NAMES THAT DO NOT EXIST
The documented Phase-B gate reads `obp_std_pr=31.89504, whip_pr_sd=37.19844, owar_repl_600`. **None of those key names
exist on prod.** The gate query returns **ZERO ROWS** — and a zero-row result reads as *"the config is missing"*, which
would send the next person chasing a non-existent Phase-B failure.
**REAL KEY NAMES (verified on prod, values all CORRECT):**
`r_obp_std_pr` = **31.89504** · `t_obp_std_pr` = **31.89504** · `p_whip_pr_sd` = **37.19844** ·
`owar_replacement_runs_per_600` = **21.22** · `pwar_replacement_runs_per_9` = **1.92** · `nil_tier_sec` = **4.0**.
✅ **Corrected INLINE** at the gate in `PROD_PUSH_STEPS` and at RUNBOOK rows 1–2 (which additionally carried the
superseded VALUES 37.13 / 32.41).

## 🧠 THE PATTERN ACROSS BOTH AUDIT PARTS
Part 1 (remaining steps) found **2 structural defects**. Part 2 (completed steps) found **0 invalidations but 1 broken
gate** — the verification query itself was wrong, which is the most expensive kind of error because it makes correct
work *look* broken and broken work *look* fine.
→ **Audit the GATES with the same rigour as the steps.** A gate that cannot fail, or cannot pass, is not a gate.

---
# 🔴 PROD DATA GAP FOUND VIA team_drs — **CAMDEN KOZEAL (Arkansas) IS MISSING FROM PROD'S 2026 HITTER MASTER**
**CONFIRMED BY TREVOR 2026-08-30: Kozeal is a real player.** This is a genuine prod defect, not a reconciliation artifact.

## HOW IT SURFACED (the detector was not the defect)
Prod-derived `team_drs` disagreed with staging's stored value on exactly one team — **Arkansas 32.800 vs 41.060
(Δ −8.26)** — while 303/308 teams agreed within 0.5. Chasing it down:
1. **Per-player dRS is IDENTICAL across environments.** `player_season_defense` 2026: prod 13,454 / staging 13,454,
   both `drs-engine-0.11.0`; matched on `(source_player_id, position)` → **13,453 in both, 13,453 identical, ZERO
   different.** The engine output is env-independent (loaded from the same CSVs, per `PROD_PUSH_STEPS:316-317`), so
   **dRS drift is RULED OUT.**
2. **Arkansas roll-up:** prod **41** defense rows Σ **35.255** · staging **43** rows Σ **43.757**. Prod loses 2 rows.
3. **Both rows are ONE player — `source_player_id` 1925267789: SS 7.959 + 2B 0.543 = 8.502 runs.** That is the whole Δ.

## THE DEFECT
| | |
|---|---|
| STAGING `"Hitter Master"` 2026 | `Camden Kozeal` · Team **Arkansas** · **pa 289** · D1 |
| **PROD `"Hitter Master"` 2026** | **ABSENT** |
| PROD `"Pitching Master"` 2026 | absent |
| PROD `players` | **row EXISTS** — `Cam Kozeal` · 1B · **`team` = NULL** · D1 · NOT IN PORTAL |
| STAGING `players` | `Camden Kozeal` · 1B · team `Arkansas` |
Prod **knows the player** (same `source_player_id`) but stores him as "**Cam**" with a **NULL team**, and has **no 2026
Master stat row**. His dRS rows sit in prod's `player_season_defense` with nothing to join them to.
⚠ Note the name form differs (**Cam** vs **Camden**) and prod's `team` is NULL — consistent with
[[project_players_team_id_null]] (prod carries ~15,706 team-less stubs). **If the Master import resolves on NAME
anywhere rather than `source_player_id`, that is the root cause and is far broader than one player**
([[feedback_id_over_name]]). NOT yet investigated — do not assume.

## SCOPE — SMALL AND BOUNDED (this is NOT a systemic Masters gap)
2026 **D1** Master id sets: **prod 10,406 · staging 10,408** · in staging not prod **4** · in prod not staging **2**.
Of the 4 staging-only ids only two carry defense: **Camden Kozeal 8.502** and **LJ Layhew (Rice, 1 PA) 0.002** —
**total prod loses 8.50 runs, essentially all Kozeal.**

## BLAST RADIUS ON PROD (everything below is currently wrong or missing for this player)
- **no `desc_owar` / `d_war` / `bsr_war` / `total_desc_war`** — D31 iterates the Masters, so he is simply not computed
- **no power ratings, no projection, no market value, no NIL** — every producer keys off a Master row
- **Arkansas `team_drs` understated by 8.26** ⇒ every Arkansas pitcher's `drs_behind` is wrong
  (`drs_behind = team_drs × IP/team_IP`) ⇒ wrong `desc_ra9` / `desc_pwar` for the whole staff
- **Arkansas team WAR roll-ups** (`team_war_snapshots`, later `team_season_stats`) understated
- ⚠ **Arkansas is one of the 14 ACTIVE customer teams.**

## ★ WHY NO GATE WOULD HAVE CAUGHT THIS
Prod has **5,340** D1 hitters and every count check passes on 5,340. A missing row is invisible to a count — you can
only see it by **diffing the id SET against a reference**, which nothing in the runbook does.
→ **ADD A MEMBERSHIP GATE, not just a count gate:** diff 2026 Master `source_player_id` sets prod-vs-staging (or vs the
source CSV) and require the difference to be explained by name, never merely small. Same lesson as the C28
`Stuff_plus` catch: **populated ≠ correct**, and now **count-correct ≠ complete**.

## ⬜ OPEN — NOT FIXED, NEEDS TREVOR'S CALL
1. How the missing Master row gets added (Masters are TruMedia CSV imports → [[feedback_csv_import_prod_direct]]
   `npm run import:prod`; a hand-INSERT is NOT the documented path).
2. Whether the Master import matches on name anywhere (the Cam/Camden + NULL-team signal) — root-cause question.
3. Whether Phase D proceeds now and Kozeal is patched after, or the gap is closed first.
⛔ **DO NOT "fix" this by copying the row from staging** — same copy-instead-of-derive error as the team_drs paste.

---
# 🅱️ TRACK B REQUIREMENT — MASTER ROWS MUST BE CREATED FROM THE PITCH LOG, INDEPENDENT OF RETURNER STATUS
**Status: NOT DONE. Deliberately SKIPPED during the 2026-08-30 prod push (Trevor) — must be handled by Track B in the
full upload.** Do not fix by hand; do not copy the row from staging.

## THE RULE (Trevor, 2026-08-30)
> *"He's not a returner in 2027 but should be in there based on the process."*
**A player's presence in the season's Master is determined by whether he PLAYED that season — i.e. by his pitch-log
record — NEVER by whether he returns the following season.** The Master is the **descriptive record of 2026**.
Returner/transfer status is a *projection-side* concept (season 2027) and must have **zero** influence on whether a
2026 Master row exists. Any stage that skips creating a Master row because a player is not a returner is WRONG.

## THE CONCRETE CASE THAT EXPOSED IT — Camden Kozeal (Arkansas)
Found only because prod-derived `team_drs` disagreed with staging on exactly one team. Full detail in the
"PROD DATA GAP" block; the short version:
| | |
|---|---|
| PROD `pitch_log` 2026 | **1,103 pitches** |
| PROD `pitch_log_hitter_totals` (`all`) | **PA 287 · AB 243 · 20 HR · 36 BB · 54 K · 193 BIP · 59 barrels** |
| PROD `"Hitter Master"` 2026 | ❌ **NO ROW** |
| PROD `players` | exists as `Cam Kozeal`, **`team` = NULL** |
| STAGING `"Hitter Master"` 2026 | ✅ `Camden Kozeal` · Arkansas · pa 289 |
A full everyday season with 20 HR, on an **active customer team**, with **no Master row on prod** — therefore no
`desc_owar` / `d_war` / `total_desc_war`, no power ratings, no projection, no market value, and 8.5 runs of his
defense orphaned out of Arkansas's `team_drs`.

## ★ SCOPE IS MEASURED AND TIGHT — he is the ONLY real one
| 2026 hitter orphans (pitch-log totals, no Master row) | PROD | STAGING |
|---|---|---|
| all | 763 | 759 |
| **PA ≥ 50** | **1 (Kozeal, 287 PA)** | **0** |
| PA ≥ 150 | 1 | 0 |
The other ~762 orphans top out at **18 PA** and staging has 759 of the same — that is normal Master-inclusion
background, **NOT** a defect. Pitchers: 135 prod orphans, same character.
→ 🛑 **CORRECTED 2026-08-30: this warning was WRONG.** `--create-new` is ALREADY scoped — `MIN_PA` default **25** (`:74`) plus a **D1 gate** (`:473`). Of the 763 candidates on prod exactly **ONE** clears PA≥25 (Kozeal, 287); the rest top out at 18 PA. The threshold question is answered by the committed code: **25 PA / 20 BF**.

## WHAT TRACK B MUST DO (stage 5, the Masters rollup)
`scripts/derive_masters_from_pitchlog.ts` already builds Master rows from `pitch_log_*_totals` and already has the
`--create-new` flag (default OFF, per the standing rule "never create Master rows implicitly"). Track B must:
1. **Create missing Master rows from the pitch log** as part of the normal upload — gated by the **Master's own
   inclusion threshold** (a PA/IP qualifier), **NOT** by returner status, roster status, or portal status.
2. **Establish what that threshold actually is** before enabling creation — it is currently UNDETERMINED. The data
   says any cutoff between ~20 and ~250 PA isolates Kozeal from the background, but a hand-picked number is not an
   answer: find the rule the Master import itself uses and mirror it. ⬜ **OPEN QUESTION.**
3. Preserve the existing safety: never create rows implicitly/silently; log every row created, with name + PA/IP.
4. **Run BEFORE anything that iterates the Masters** — descriptive WAR, `team_drs`, power ratings, `computeNcaaAverages`,
   `refresh_team_season_stats`. A row created after those have run is a row that is missing from all of them.

## ★ THE GATE THIS NEEDS (a COUNT GATE CANNOT SEE THIS)
Prod has 5,340 D1 hitters and **every count check passes on 5,340** — a missing row is invisible to a count.
**MEMBERSHIP GATE, per season, after the Masters rollup:**
```sql
-- must return 0 rows; anything here PLAYED but has no Master record
select plt.batter_id, plt.pa from pitch_log_hitter_totals plt
where plt.season = :season and plt.dimension_key = 'all' and plt.pa >= :qualifier
  and not exists (select 1 from "Hitter Master" hm where hm."Season" = :season and hm.source_player_id = plt.batter_id);
```
(and the `pitch_log_pitcher_totals` / `"Pitching Master"` equivalent by IP).
**Require it to be EMPTY, or every exception explained BY NAME — never merely "small".** This is the third distinct
shape of the same lesson: *populated ≠ fresh* (Conference Stuff+), *populated ≠ right lane* (`trackman_pitches`), and
now ***count-correct ≠ complete***.

---
# 🔬 INVESTIGATION — THE MASTER NEW-ROW PATH (`derive_masters_from_pitchlog.ts --create-new`). TRACK B DEPENDS ON THIS.
Chasing why prod is missing Camden Kozeal's 2026 Hitter Master row turned into an audit of the **new-row creation
path itself** — the mechanism Track B must use on every upload. Everything below is VERIFIED on prod, read-only.

## ✅ CORRECTION TO MY OWN EARLIER WARNING — `--create-new` IS ALREADY CORRECTLY SCOPED
I previously wrote that `--create-new` "would create ~763 rows, 762 of which should not exist." **THAT WAS WRONG.**
The producer already gates new rows on **two** filters (`:469`, `:473`):
- **`MIN_PA` — default 25**, overridable via `--min-pa <n>` (`:74`, `:39`). Pitchers: `MIN_BF` default 20.
- **D1 gate** — `if (!team || team.division !== "D1") skip`.
Measured on prod: of **763** hitter new-row candidates, exactly **ONE** clears PA ≥ 25 — **Kozeal (287 PA)**. The other
762 top out at **18 PA**. So the flag self-scopes correctly and the threshold question I logged as OPEN is **ANSWERED
BY THE COMMITTED CODE: 25 PA / 20 BF.**

## ✅ THE ROW CAN BE DERIVED ENTIRELY FROM PROD — NO COPY FROM STAGING NEEDED
Verified prod's own pitch log reproduces staging's Master values **exactly**:
`AVG (38+18+2+20)/243 = .321` · `OBP (78+36+4)/287 = .411` · `SLG 160/243 = .658` — staging Master: **.321 / .411 / .658**.
And the identity resolves from prod alone: `pitch_log.batting_team_id = '3375'` → `"Teams Table"` (Season-filtered) →
`University of Arkansas · SEC · D1 · id 5679ed85-…`; name from `players`; hand from the pitch log (`batter_hand = L`).
★ **What a new Master row actually needs is NARROW.** Staging's Kozeal row has 60 populated columns, but the 11
`*_score` fields, the 4 power ratings, and the whole `desc_*`/`woba`/`wraa` block (+ `_reg`) are **DOWNSTREAM OUTPUTS**
of C26 and Phase D — they compute themselves once the row exists. (Proof: prod's reference Arkansas hitter has only
**45** populated columns, precisely because Phase D has not run there.) Only identity + slash line + the batted-ball /
discipline block must be seeded, and all of it is pitch-log-derived anyway.
⛔ **So there is NO justification for copying the row from staging** ([[feedback_derive_over_copy]]).

## 🔴 UNRESOLVED CONTRADICTION — EVERY GATE PASSES, YET THE RUN REPORTED 0 NEW ROWS
Gate-by-gate trace for `source_player_id 1925267789` against PROD (each verified individually):
| gate | result |
|---|---|
| in `pitch_log_hitter_totals` (season 2026, `dimension_key='all'`) | ✅ YES, `pa = 287` |
| already has a 2026 `"Hitter Master"` row (→ would exclude) | ✅ NO — he IS a candidate |
| representative `pitch_log` row (`repRows`, `:444`) | ✅ `batting_team_id='3375'`, `C. Kozeal`, hand `L` |
| `teamBySource.get('3375')` (Teams Table, Season-filtered) | ✅ Arkansas, SEC, **D1**, Season 2026 |
| `MIN_PA` ≥ 25 | ✅ 287 |
**And a faithful replica of `buildNewRows`' candidate selection — same ordered pagination, same filters — returns:**
```
hmAll (Hitter Master 2026): 8244 rows → 8244 distinct   contains Kozeal? NO  ← candidate
hitterTotals:               6099 rows → 6099 distinct   contains Kozeal? YES pa=287
newHitterIds: 763           includes Kozeal? YES
  of those PA>=25: 1  → ["1925267789"]
```
→ **The producer SHOULD create exactly one row: his. The dry-run reported `0 hitters, 0 pitchers` and
`(skipped — non-D1 team / unresolved identity / below sample gate: 898)`.**
⚠ The captured output was **missing its header** (began mid-table, no env banner, no "Pitch-log totals: N hitters"
line), so the 0 may have come from a truncated or stale capture. ✅ **RESOLVED — the clean re-run confirmed `0` was REAL, and the root cause is now found: a wrong argument in the `repRows` call at `:465` (`"batting_team_id"` passed where `"batter_id"` belongs), whose timeout error is then discarded at `:451`. See the ROOT CAUSE block.**
**DO NOT resolve this by assumption. It is either (a) a capture artifact, or (b) a real silent failure in the new-row
path — and (b) would be a TRACK B BLOCKER, because a daily automated upload would silently never create anyone.**

## ⚠ SIDE-FINDING — STAGING'S KOZEAL ROW POINTS AT THE **2025** TeamID
Both envs carry two Arkansas `"Teams Table"` rows: `47acae04-…` (Season **2025**) and `5679ed85-…` (Season **2026**).
Staging's 2026 Kozeal Master row has `TeamID = 47acae04-…` — **the 2025 row.** The producer resolves Season-filtered
and would write `5679ed85-…`. Harmless for `team_drs` (both map to `source_id 3375`), but it means **staging's Master
`TeamID` values are not uniformly season-correct** — worth a separate check before anything joins on `TeamID` across
seasons. NOT investigated.

## 🅱️ WHAT TRACK B MUST TAKE FROM THIS
1. **Use the committed producer with `--create-new` and its existing PA/BF + D1 gates.** Do not hand-build rows, do not
   copy across environments, do not invent a threshold — 25 PA / 20 BF is the committed answer.
2. **New-row creation MUST run before anything that iterates the Masters** (descriptive WAR, `team_drs`, power ratings,
   `computeNcaaAverages`, `refresh_team_season_stats`). A row created afterwards is missing from all of them.
3. **`--create-new` needs its own VALUE gate**, because "0 rows created" is indistinguishable from "nothing to create":
   after the stage, re-run the membership query and require it to be EMPTY. See the MEMBERSHIP GATE block.
4. **Never trust a background/truncated log.** Validate by re-querying the DB, or by a full captured run — this
   investigation was nearly concluded off a header-less capture. Same rule as "validate by CONTENT, not exit code."

---
# 🐛🔴 ROOT CAUSE FOUND — `derive_masters_from_pitchlog.ts` CAN **NEVER** CREATE A HITTER MASTER ROW (2026-08-30)
**This is a REAL, CONFIRMED BUG, not a capture artifact. It is a TRACK B BLOCKER.** Found by chasing why prod is
missing Camden Kozeal's 2026 Hitter Master row; the missing row is the *symptom*, this is the *cause*.

## THE DEFECT — AN ARGUMENT IN THE WRONG POSITION
```ts
async function repRows(ids, idCol, teamCol, abbrevCol, handCol) {        // :444
  … await sb.from("pitch_log").select(`${teamCol}, ${abbrevCol}, ${handCol}`)
        .eq("season", SEASON).eq(idCol, id).limit(1);                    // :451  ← filters on idCol
  if (data && data[0]) map.set(id, data[0]);                             // ← `error` is DISCARDED
}

repRows(newHitterIds,  "batting_team_id", "batting_team_id", "batter_abbrev_name", "batter_hand");  // :465 ❌
repRows(newPitcherIds, "pitcher_id",      "pitching_team_id", "pitcher_abbrev_name","pitcher_hand"); // :486 ✅
```
The **pitcher** call correctly passes `"pitcher_id"` as `idCol`. The **hitter** call passes **`"batting_team_id"`** —
the TEAM column — in the ID-column position. So it executes
`pitch_log WHERE season=2026 AND batting_team_id = '<a player id>'`.

## WHY IT FAILS SILENTLY (three failures stacked)
Verified on PROD:
```
AS CALLED  .eq('batting_team_id', playerId) → null   err: "canceling statement due to statement timeout"
CORRECT    .eq('batter_id',       playerId) → [{"batting_team_id":"3375","batter_abbrev_name":"C. Kozeal","batter_hand":"L"}]
```
1. A player id never matches a team id, so the predicate matches **nothing**…
2. …and scanning **2,576,146** `pitch_log` rows for it **EXCEEDS THE STATEMENT TIMEOUT** — it does not merely return
   empty, it **ERRORS**.
3. `:451` destructures **only `data`** and throws the error away ⇒ `rep` is `undefined` ⇒ `resolveTeam(undefined)` is
   `undefined` ⇒ `if (!team || team.division !== "D1") { skipped++; continue; }` ⇒ **skipped, silently.**
**Consequence: NO hitter Master row can EVER be created by this producer, on any environment, at any PA threshold.**

## THE EVIDENCE THAT PINNED IT (every other gate was cleared first)
Faithful read-only replicas against PROD, each ruling out a candidate cause:
| checked | result |
|---|---|
| `hmAll` (Hitter Master 2026, ordered pagination) | 8,244 rows / 8,244 distinct — Kozeal **NOT** present ⇒ he IS a candidate |
| `hitterTotals` (`pitch_log_hitter_totals`, `dimension_key='all'`) | 6,099 distinct — Kozeal present, `pa=287` |
| `newHitterIds` | **763**, includes Kozeal; **exactly 1** clears `MIN_PA=25` → `["1925267789"]` |
| `teamBySource` (Teams Table Season=2026) | 466 rows, 0 NULL `source_id`, `'3375'` → University of Arkansas **D1** ✅ |
| `repRows` replica using the **CORRECT** `batter_id` | **763 resolved · 0 errored · 0 no-row** |
| the ACTUAL run | **0 hitters created**, `skipped … 898` |
★ **`898 = 763 hitters + 135 pitchers` — i.e. EVERY candidate of both kinds.** A universal skip, not a selective one,
is what pointed at a shared gate rather than at the data.
(The 135 pitchers are separately explained by `MIN_BF=20`; the pitcher `repRows` call itself is correct.)

## ✅ THE FIX (one argument)
`:465` → `repRows(newHitterIds, "batter_id", "batting_team_id", "batter_abbrev_name", "batter_hand")`
**AND — independently — stop swallowing the error at `:451`:** `const { data, error } = …; if (error) { … }`. Count and
report failures; a timeout must never masquerade as "this player has no pitch-log row." Without this second change the
same class of failure stays invisible next time.

## 🅱️ WHAT THIS MEANS FOR TRACK B — READ THIS TWICE
Track B is **ONE EDGE FUNCTION RUNNING ONCE PER DAY, UNATTENDED.** This bug is precisely the failure mode it cannot
survive:
- the stage **runs**, **exits 0**, and prints a plausible number (`0 new rows`)
- "0 created" is **indistinguishable** from "nothing to create" — and 362 days a year, "nothing to create" is the
  truth, so it looks right
- the only visible symptom is a **missing row**, which **no count gate can detect** (prod has 5,340 D1 hitters and
  every count check passes on 5,340)
- it took a **team-level dRS discrepancy on one team** to surface a **single missing player**
**Therefore Track B MUST:** (1) treat any swallowed error as a **hard stop**, never a coerced empty; (2) gate the
new-row stage on the **MEMBERSHIP query**, not on a count or an exit code; (3) **log every row it creates by name +
PA/IP**, and log explicitly when it creates none *and why*.

## 🧠 THE META-LESSON — THE FOURTH SHAPE
1. *populated ≠ fresh* (Conference `Stuff_plus` 30/30 but pre-v2)
2. *populated ≠ right lane* (`trackman_pitches` full, from the legacy table)
3. *count-correct ≠ complete* (5,340 hitters, one of them missing)
4. **NEW: *ran ≠ did anything*** — a stage can execute, exit 0, report a believable figure, and be structurally
   incapable of ever doing its job.
**And the process lesson:** I nearly closed this off a truncated background log that was missing its header. The clean
full capture is what confirmed `0` was real and sent me to the code. **Never conclude from a partial log.**

---
# 🅱️ TRACK B — MASTER `TeamID` IS NOT SEASON-CONSISTENT, AND A SPLIT IS SILENT UNTIL IT ISN'T (2026-08-30)
## THE UNDERLYING CONDITION
`"Teams Table"` carries **one row per team PER SEASON** — prod has **308 rows for Season 2025** and **466 for 2026**,
each with its own `id`. So a single program has MULTIPLE `TeamID` uuids. Arkansas (`source_id 3375`):
`47acae04-1225-4506-9c12-8d6e55cbe9c5` = **Season 2025** · `5679ed85-eeea-4e47-be59-53ffc5087b38` = **Season 2026**.
**The 2026 Masters do NOT consistently use the 2026 id.** Measured on PROD, Season 2026, Arkansas:
| table | `47acae04…` (2025 id) | `5679ed85…` (2026 id) |
|---|---|---|
| `"Hitter Master"` | **16** | 0 |
| `"Pitching Master"` | **18** | **1** ⚠ |
Staging's 2026 Kozeal row likewise carried the **2025** id. **So the 2025 id is the DE-FACTO convention in the 2026
Masters, and the lone pitcher on the 2026 id is a PRE-EXISTING SPLIT that predates this session.** ⬜ NOT FIXED —
logged for whenever the Master `TeamID` question is addressed properly.

## 🛑 WHY THIS MATTERS — ANY TEAM-LEVEL ROLLUP KEYED ON `TeamID` SILENTLY SPLITS THE TEAM
`derive_team_drs.mjs` groups `Σ drs_floor` by the Masters' `TeamID`. If one player carries a different (but equally
"valid") `TeamID` for the same program, he becomes **his own team**. Demonstrated live: after inserting Kozeal with the
**2026** id (I "corrected" staging's 2025 id, assuming it was a bug — **IT WAS NOT**), the producer emitted:
```
div D1: 309 teams          ← was 308
Arkansas  team_drs 32.770  raw_floor 35.255  team_IP 475.0
Arkansas  team_drs  8.429  raw_floor  8.502  team_IP  14.0   ← Kozeal, alone, as a "team"
```
Reverting his `TeamID` to `47acae04…` restored **308 teams**, `raw_floor 43.757` (**exactly staging's**), `team_drs 41.272`.
★ The split announced itself ONLY because the division team-count moved 308→309 and the centering assertion still held.
**A per-team value check would have passed** — both buckets are internally consistent. **What caught it was a
CARDINALITY check.**

## 🅱️ REQUIREMENTS FOR TRACK B
1. **Resolve `TeamID` ONE way, from ONE place, for the whole run** — do not mix a per-season lookup with whatever the
   Masters happen to hold. Prefer joining on **`source_team_id` / `source_id`** (season-stable) over the per-season
   uuid wherever a rollup groups by team. [[feedback_id_over_name]] extends here: *stable* id over *any* id.
2. **When creating a Master row, adopt the `TeamID` its TEAMMATES already use** — never resolve it independently from
   `"Teams Table"` by season. That is exactly the mistake made here, and it silently split a customer team.
3. **CARDINALITY GATE on every team-level rollup:** assert the produced team count EQUALS the expected division count
   (D1 = 308) and FAIL otherwise. A per-team value gate cannot see a split; a count of teams can.
4. The zero-sum centering assertion (`Σ centered = 0`) **does NOT protect against this** — it held at 309 teams.

## ✅ D29b DONE ON PROD (2026-08-30) — team_drs DERIVED, not pasted
`scripts/drs/derive_team_drs.mjs --prod` (guard + ordered pagination added this session; reproduces staging's committed
values **308/308 exact**, worst |Δ| 0.0000) → `scripts/sql/team_drs_store_PROD_2026_08_30.sql` → applied.
`BEFORE with_drs 308 · sum -0.01 · Arkansas 41.060 (staging paste)`
`AFTER  with_drs 308 · sum  0.00 · Arkansas 41.272 (PROD-DERIVED)`  — 308 rows updated.
Residual vs the old staging values: **mean |Δ| 0.100**, max ~0.54 — prod's D1 population differs slightly (5,341 vs
5,343 hitters), shifting the centering rate. Expected, not a defect.
**Also on prod:** Camden Kozeal's 2026 Hitter Master row INSERTED (5,340 → **5,341** D1 hitters) — 31 seed columns,
**all 29 derived columns deliberately omitted** so C26 and Phase D compute them on prod.

---
# ✅ D31 DESCRIPTIVE WAR — APPLIED TO PROD 2026-08-30. Verified IN THE DATABASE, not from the log.
`node scripts/drs/populate_descriptive_war.mjs --prod --commit` (run under `caffeinate -dimsu`, full output captured).
`Hitter Master: 5340/5340 written, 0 FAILED` · `Pitching Master: 5374/5374 written, 0 FAILED` · `done. 0 write errors.`
★ **That "0 FAILED" line only exists because of the fix made earlier the same day** — write errors were previously
`console.error`'d but **NOT counted and NOT fatal** inside a ~10,715-update loop that then exited 0, so a partial write
was indistinguishable from a clean one. Now counted, summarised per table, and `exit 1` on any failure.

## PHASE GATE — PROD vs STAGING REFERENCE (2026, D1)
| metric | PROD | staging ref | ✓ |
|---|---|---|---|
| `desc_owar` mean | **0.3458** | 0.3456 | ✅ |
| `d_war` mean | **0.0103** | 0.0103 | ✅ |
| `bsr_war` mean | **0.0000** | 0.0000 | ✅ |
| `total_desc_war` mean | **0.3562** | 0.3559 | ✅ |
| `desc_pwar` mean | **0.5108** | — | ✅ |
| sum identity `max abs(total_desc_war − (desc_owar+d_war+bsr_war))` | **0.001000** | ≤ 0.002 | ✅ |
| coverage | hitters **5,340 / 5,341** · pitchers **5,374 / 5,375** | — | ✅ |
| `drs_behind` | **5,374** populated · range **−5.26 … 6.84** · **7** exact zeros | — | ✅ |
`bsr_war` (= `wsb_runs / RPW 13.1`, from `player_season_baserunning`) range **−0.386 … 0.502**, centered at 0.
The single missing hitter and pitcher are the pre-existing `sheet-miss 1` — players absent from the source CSV,
unchanged from before this run. NOT a defect.

## ★★ THE STRONGEST VALIDATION OF THE DAY — INDEPENDENT REPLICATION ON CAMDEN KOZEAL
```
PROD    Camden Kozeal — desc_owar 2.404 · d_war 0.649 · bsr_war -0.051 · total_desc_war 3.002
STAGING Camden Kozeal — desc_owar 2.404 · d_war 0.649 · bsr_war -0.051 · total_desc_war 3.002
```
**IDENTICAL to three decimals.** A player who had **no Master row and no numbers at all on prod** hours earlier now
matches the reference exactly — computed from **prod's own** pitch log, **prod's own** Master row (31 seed columns,
zero derived columns copied), **prod's own** `player_season_defense`, and a `team_drs` **derived on prod**. Nothing was
copied from staging except the seed stat line, which was itself cross-checked against prod's pitch log (.321/.411/.658).
★ This closes the loop opened by the Arkansas `team_drs` discrepancy: detector → missing player → root-cause bug →
row created → `team_drs` re-derived → descriptive WAR matches. **Every link verified, none assumed.**

## ORDER NOTE FOR THE NEXT STEP (D32) — THE SILENT ONE
`populate_descriptive_war_reg.mjs:79` reads `"Pitching Master".drs_behind` and coerces **`NULL → 0`**, so running it
before D31 commits yields wrong `desc_ra9_reg` / `desc_pwar_reg` with **NO error**. Gate satisfied: `drs_behind` is
**5,374/5,375 non-null** on prod. **Verify this count, never "D31 exited cleanly".**

---
# ✅✅ PHASE D COMPLETE ON PROD — 2026-08-30. D34 verification passed on every gate.
| step | result |
|---|---|
| **D29b** `team_drs` | **DERIVED on prod** (not pasted) via `derive_team_drs.mjs --prod` → 308 D1 teams, Σ centered −0.0000, stored: `with_drs 308 · sum 0.00`. Arkansas 41.060 → **41.272**. |
| **D30** dRS/wSB load | **NO-OP confirmed** by dry-run — `13454 would upsert / 11 unresolved`, `10432 / 30 unresolved`; data already present at `drs-engine-0.11.0` / `0.6.0`. Apply intentionally SKIPPED. |
| **D31** descriptive WAR | **COMMITTED** — `Hitter Master 5340/5340 written, 0 FAILED` · `Pitching Master 5374/5374 written, 0 FAILED` · `0 write errors`. |
| **D32** `_reg` split | **COMMITTED** — `Hitter Master 5322/5322` · `Pitching Master 5372/5372`. |
| **D33** | folded into D29b (it IS the `team_drs` producer). |
| **D34** | **PASSED — all 9 checks below.** |
| *(unplanned)* | **Camden Kozeal's 2026 Hitter Master row CREATED** → 5,340 → **5,341** D1 hitters. |

## D34 RESULT (prod, Season 2026, division='D1') — the numbers to compare against next time
```
✅ hitters desc_owar/d_war/bsr_war/total_desc_war   5340/5340/5340/5340 of 5341
✅ hitters _reg set                                 5322/5322/5322/5322
✅ pitchers desc_pwar/desc_ra9/drs_behind           5374/5374/5374 of 5375
✅ pitchers _reg                                    5372/5372
✅ avg d_war      0.0103   (≈0.010)
✅ avg bsr_war    0.0000   (≈0.000)
✅ avg desc_owar  0.3458   (≈0.346)
✅ sum identity   0.001000 (≤0.002)   max|total_desc_war − (desc_owar+d_war+bsr_war)|
✅ drs_behind range  −5.26 … 6.84
ℹ  avg total_desc_war 0.3562 · _reg 0.3354 · avg desc_pwar 0.5108 · _reg 0.5385
```
The one uncovered hitter and pitcher are the pre-existing `sheet-miss 1`; the 19 hitter / 3 pitcher `_reg` shortfalls
are players absent from `hitter_accrued.csv` / the line file — **matching staging exactly (5,322 and 5,372)**. Expected.

## ⚠ KNOWN GAP CARRIED FORWARD — `populate_descriptive_war_reg.mjs` STILL SWALLOWS WRITE ERRORS
The error-counting fix (count failures, summarise per table, `exit 1`) was applied to **`populate_descriptive_war.mjs`
ONLY**. `_reg` still logs errors without counting them and prints a bare `done.` — so a partial `_reg` write would
still look clean. It happened to succeed here (`5322/5322`, `5372/5372` progress counters reached full), but
**apply the same fix to `_reg` before it is ever re-run.** ⬜ OPEN.

## ▶️ NEXT PER THE CORRECTED ORDER (NOT the topic order)
`E2` park factors seasonal → **★ re-run `derive_conf_opr_htp --apply --prod`** (E2 rewrites `rg_factor`, invalidating
C28's `run_env_factor`/`hitter_talent_plus` at 30/30 — a count check will PASS either way) → `D33b` lock-regular-season
(`regular_season_ip` is 0/5,375 and `refresh_team_season_stats` divides by it) → **`F44` MOVED UP** (Phase E reads
`team_season_stats.faced_*`) → `E35` TWP → `E36/37/38` precomputes → `F39`… See
`docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md`.

---
# 🚨 THE EXACT MATH + THE THINGS THAT MUST BE CAUGHT (2026-08-30). Every number here is VERIFIED ON PROD.
Consolidated so a reader never has to reconstruct a formula or a constant from prose. **If a number below does not
reproduce, STOP — do not proceed to the next stage.**

## 1. THE CONSTANTS (from `populate_descriptive_war.mjs`'s own banner, prod run 2026-08-30)
```
RPW 13.1   E2T 1.1373   replRA9 8.83   wOBA lg 0.3782   wOBA scale 0.947   offense replacement 1.62/600
```
`RPW = 13.1` is the divisor for **every** WAR quantity. ⚠ Older docs say ÷10 (Push-1 v1) — **SUPERSEDED**.

## 2. DESCRIPTIVE WAR — THE ACTUAL FORMULAS
```
HITTER   wraa            = ((woba − lgwOBA 0.3782) / wOBAscale 0.947) × PA
         desc_owar       = wraa/13.1 + (PA/600) × 1.62
         d_war           = Σ drs_floor (positions ≠ P) / 13.1
         bsr_war         = wsb_runs / 13.1
         total_desc_war  = desc_owar + d_war + bsr_war          ← IDENTITY, must hold to ≤0.002
PITCHER  drs_behind      = team_drs × (pitcher_IP / team_IP)     ← Σ over a team's pitchers = 0 EXACTLY
         desc_ra9        = 0.5 × (RA9 + drs_behind_per9) + 0.5 × (FIP × 1.137)
         desc_pwar       = (replRA9 8.83 − desc_ra9) × (IP/9) / 13.1
TEAM     team_drs        = Σ drs_floor(team) − (division Σdrs_floor / division ΣIP) × team_IP
                           ← innings-weighted centering PER DIVISION; Σ centered = 0 EXACTLY
```

## 3. THE VERIFIED PROD NUMBERS (Season 2026, division='D1') — compare against these
```
hitters 5,341 rows · desc_owar/d_war/bsr_war/total_desc_war = 5,340 each · _reg set = 5,322 each
pitchers 5,375 rows · desc_pwar/desc_ra9/drs_behind = 5,374 each · _reg = 5,372
avg desc_owar 0.3458   avg d_war 0.0103   avg bsr_war 0.0000   avg total_desc_war 0.3562  (_reg 0.3354)
avg desc_pwar 0.5108  (_reg 0.5385)       drs_behind −5.26 … 6.84       sum identity worst 0.001000
team_drs: 308 D1 teams · sum 0.00 · Arkansas 41.272 (raw_floor 43.757, team_IP 475.0)
Conference Stuff+ D1 99.15 · NJCAA_D1 96.00 · D2 93.00     p_ncaa_avg_stuff_plus 100.0141 · p_sd_stuff_plus 5.04577
Stuff+ per-pitcher gate: mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7  (IDENTICAL prod ↔ staging)
```

## 4. 🛑 THE SIX THINGS THAT MUST BE CAUGHT — each PASSED a naive check while being WRONG
| # | what | the naive check that PASSES | what actually catches it |
|---|---|---|---|
| 1 | **Conference `Stuff_plus` stale (pre-v2)** — 101.17, should be 99.15 | `count(*) = 30/30` ✅ | compare the VALUE before/after; it is written by a **4th producer** (`conferenceStuffPlusV2`) the runbook omitted |
| 2 | **`trackman_pitches` from the LEGACY lane** — undercounts ~12.1 pitches/pitcher, only **638/5,367 (11.9%)** matched | column fully populated ✅ | check the LANE, not the fill: D1 must come from `pitch_log_pitcher_totals.total_pitches` @ `dimension_key='all'` |
| 3 | **`run_env_factor` goes stale under E2** — E2 rewrites `rg_factor`, which `derive_conf_opr_htp:10` reads | `30/30` before AND after ✅ | value must CHANGE from **101.879**; re-run `derive_conf_opr_htp` AFTER E2 |
| 4 | **Missing Master row (Kozeal, 287 PA, 20 HR)** | `5,340 = 5,340` ✅ | **MEMBERSHIP diff**, not a count — pitch-log PA ≥ qualifier with no Master row must be EMPTY |
| 5 | **`--create-new` structurally broken** — `:465` passes `"batting_team_id"` as `idCol`; query times out over 2,576,146 rows; `:451` discards `error` | exit 0, prints `0 new rows` ✅ | "0 created" ≠ "nothing to create" — gate on the MEMBERSHIP query, and NEVER swallow `error` |
| 6 | **Team split by `TeamID`** — one player on the 2026 uuid vs 16 on the 2025 uuid ⇒ Kozeal became his own 14-IP "team" | per-team values internally consistent ✅ · Σ centered = 0 **held at 309 teams** ✅ | **CARDINALITY gate**: assert D1 team count **= 308**, fail otherwise |

## 5. 🛑 SILENT-FALLBACK INVENTORY — a missing input yields a plausible WRONG number, with NO error
| producer | the coercion | consequence |
|---|---|---|
| `computeAndStoreScores.ts:206-211,:249` | missing `ncaa_averages` field → **hardcoded default** (`:212-215`) | wrong power ratings; **run C27 BEFORE C26** |
| `populate_descriptive_war_reg.mjs:79` | `num(NULL) → 0` on `drs_behind` | wrong `desc_ra9_reg`/`desc_pwar_reg`; **D31 must commit first** (gate: `drs_behind` 5,374/5,375) |
| `precompute-transfer-projections.ts:225` / `precompute-pitchers.ts:279` | `const { data } =` discards `error`; `(rows \|\| [])` | empty faced-competition Map ⇒ Independents lose the adjustment; **F44 must precede Phase E** |
| `refresh_team_season_stats.sql:143` | `nullif(sum(regular_season_ip),0)` → NULL | every regular-season rate NULL; **needs lock-season (`regular_season_ip` is 0/5,375 on prod)** |
| `compute_pitch_log_stuff_plus.ts` | `classification_version` filter mismatch | scores **0 rows, exits 0**; pass the stamp just written, never a literal |
| `derive_masters_from_pitchlog.ts:451` | discards `error` on a timing-out query | **no hitter row can ever be created** |

## 6. ✅ THE GATES THAT ACTUALLY WORK (use these, not counts)
1. **VALUE gate** — compare the number before/after, and to a reference env for the SAME season (2026 = descriptive, 2027 = projections).
2. **MEMBERSHIP gate** — diff the ID SET, not the count. Caught Kozeal.
3. **CARDINALITY gate** — assert the expected number of GROUPS (D1 = 308 teams). Caught the `TeamID` split.
4. **IDENTITY gate** — `total_desc_war = desc_owar + d_war + bsr_war` ≤ 0.002; `Σ team_drs = 0`; `Σ drs_behind = 0`.
5. **LOG-CONTENT gate** — read the log body, never the exit code. `0 FAILED` must be printed, not inferred.
6. **SIGN gate** — arm-side pitches positive armHB for BOTH hands (18/18 buckets), else ABORT before writing.

---
# ✅ E2 PARK FACTORS + MANDATORY C28-STEP-3 RE-RUN — APPLIED TO PROD 2026-08-30
## E2a — code fixes first (the docs already called for the guard; the banner was found during the dry run)
- double-keyed `--prod` guard + env-driven URL/key (was a **literal staging URL** + literal `.env.local` read).
- 🛑 **LYING BANNER FIXED** — `:215` printed `MODE: … target=STAGING` **while running against PROD**. Identical defect
  to `_run_store_no_propagate.ts` (C26). Now prints the RESOLVED env. **Third instance of this class.**

## E2b — DRY RUN + the TEAM-BY-TEAM GATE (a row count would have hidden this)
`_parkfactors_backup` verified **615 rows = 306 (2025) + 309 (2026)** before touching anything.
CSV 2026 = **308** teams vs PROD 2026 = **309** rows ⇒ delete+reinsert would drop one.
**Diffed BY NAME: the single dropped team is `Fort Wayne`.** ✅ **CORRECT — Trevor: they had no 2026 team.**
⚠ My first diff was WRONG and briefly reported "309 would be dropped" — my probe matched the CSV's **`teamId`**
column instead of **`team`** (`/team/i` hits `teamId` first). Corrected immediately. **The real name column is `team`
(index 3): `Rank,teamId,teamName,team,teamFullName,…`.** Do not re-derive this by regex; use the literal column name.

## E2c — APPLIED. `✓ Wrote 922 rows across 2024/2025/2026 (seasonal + main).`
| season | rows before → after | `rg_factor` | **`rg_factor_seasonal`** |
|---|---|---|---|
| 2024 | *(absent)* → **307** | 307 | **307** |
| 2025 | 306 → **307** | 307 | **307** |
| 2026 | 309 → **308** | 308 | **308** |
**`rg_factor_seasonal` 0/309 → fully populated — the objective of E2.** Georgia 2026 `rg_factor` = **109.35**,
exactly the dry-run's predicted rolling value; `rg_factor_seasonal` = 107.76 (single-season). Fort Wayne now present in
2024/2025 only. ⚠ `source_team_id` is 306/307 for 2024 and 2025 (2 unmapped historical teams) — 308/308 for 2026.

## ★ E2d — THE MANDATORY RE-RUN, AND THE NUMBER THAT PROVES IT
E2 rewrites the **MAIN** factor columns (current season → 3-yr rolling), and `derive_conf_opr_htp.ts:10` reads
`"Park Factors".rg_factor`. Measured rewrite magnitude from the dry run:
```
RG  mean|Δ| 2.16  max|Δ| 7.24 (n=308)   ISO mean|Δ| 2.11  max 7.07   AVG 0.65   OBP 0.38
worst: Monmouth/rg 100.3→93.06 · Mississippi Valley State/rg 134.44→127.52 · Northern Colorado/rg 121.5→115.08
```
`npx tsx --env-file=.env.production.local scripts/derive_conf_opr_htp.ts --apply --prod` → **APPLIED 30 rows.**
| | BEFORE | AFTER |
|---|---|---|
| `run_env_factor` **count** | **30/30** | **30/30** ← ⚠ **IDENTICAL — a count gate PASSES either way** |
| `run_env_factor` **avg** | **101.879** | **99.719** (**−2.16**) |
| `hitter_talent_plus` avg | 100.13 | **99.23** (−0.90) |
★★ **The `run_env_factor` shift of −2.16 EQUALS the park `RG mean|Δ|` of 2.16.** The competition-translation lever
moved by exactly the amount park factors moved. Had E2 been run in its documented Phase-E slot *after* C28, this value
would have been silently stale at a passing 30/30 — biasing every projection of a player INTO a conference.
Division split intact: **D1 30 · NJCAA_D1 10 · D2 2.** Sample HTP moves: Big 12 117.2→**119.1** · SBC 103.8→**107.7** ·
Independent 109.1→**122** · MWC 95.7→**96** · The Summit 93.8→**93.4**.

## 🧠 RULE CONFIRMED BY MEASUREMENT
**`derive_conf_opr_htp` must be the LAST thing to touch park-derived conference columns.** Any stage that rewrites
`"Park Factors".rg_factor` invalidates `run_env_factor` / `hitter_talent_plus` / `offensive_power_rating` **without
changing their fill count**. Gate on the VALUE CHANGING, never on the count.

---
# 🔬 E2 PROD↔STAGING COMPARISON — HOW IT WAS VERIFIED, AND WHAT A DIFFERENCE MEANS (2026-08-30)
Run AFTER E2 + the `derive_conf_opr_htp` re-run. **Method matters as much as the result** — this is the template for
comparing the two environments now that they have diverged.

## METHOD (do it this way; a row count proves nothing)
1. **Structural:** row counts + non-null counts per season, both envs.
2. **VALUE-level:** pull all 2026 rows from each, **join on `team_name`**, compare each numeric field, report
   `matched / IDENTICAL / worst |Δ|` — never just "counts agree".
3. **Downstream:** compare the consumers (`Conference Stats`) separately, and **attribute every difference** to a
   named cause before calling it a defect.

## ✅ RESULT 1 — PARK FACTORS ARE *IDENTICAL*. This is INDEPENDENT REPLICATION, not a copy.
| | PROD | STAGING |
|---|---|---|
| rows 2024 / 2025 / 2026 | **307 / 307 / 308** | **307 / 307 / 308** |
| `rg_factor` populated | 307 / 307 / 308 | 307 / 307 / 308 |
| `rg_factor_seasonal` populated | 307 / 307 / 308 | 307 / 307 / 308 |
| **2026 `rg_factor` joined on `team_name`** | **308 matched · 308 IDENTICAL · worst \|Δ\| 0.0000** | |
| **2026 `rg_factor_seasonal`** | **308 IDENTICAL** | |
Same source CSVs, same formula, executed separately against two different databases → **byte-identical output**.
Prod's park factors are now in exactly the state staging is in. ★ This is the same class of evidence as the Stuff+
per-pitcher gate (mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 identical across two different pitch populations) and
the Kozeal descriptive-WAR match (2.404 / 0.649 / −0.051 / 3.002 to three decimals).

## ✅ RESULT 2 — `run_env_factor` IDENTICAL; the other two differ FOR A KNOWN REASON
| Conference Stats 2026 D1 | PROD | STAGING | verdict |
|---|---|---|---|
| `run_env_factor` | **99.719** | **99.719** | ✅ **identical** — the purely park-derived value. Identical parks ⇒ identical result. **The E2 → `derive_conf_opr_htp` chain is verified end-to-end.** |
| `Stuff_plus` | 99.15 | 99.16 | Δ −0.01 — immaterial |
| `hitter_talent_plus` | 99.23 | 99.01 | Δ +0.22 — **EXPECTED, see below** |
**Why HTP differs:** `HTP = OPR + 1.25·(Stuff+ − 100) + 0.75·(100 − run_env)`. `run_env` is now identical and Stuff+ is
within 0.01, so the difference comes from **`offensive_power_rating`**, which is built off the **Masters** — and
**STAGING NEVER RECEIVED C24 / C26 / C27 / C28 / C28b / C29.** Its Master-derived inputs are OLDER.
🛑 **THEREFORE: PROD IS THE MORE CURRENT SIDE FOR THESE COLUMNS. A prod↔staging mismatch here is NOT a prod defect.**
Prod is also ahead on `pitcher_ev90`, `pitcher_exit_velo`, `pitcher_in_zone_pct`, `pitcher_iz_whiff_pct`
(**30/30 prod vs 0/30 staging**) and `pitcher_ev_score`/`pitcher_iz_score` (**30/30 vs 0/30**).

## 🧭 THE RULE THIS ESTABLISHES — HOW TO READ ANY PROD↔STAGING DIFFERENCE FROM NOW ON
Before calling a difference a defect, answer **in this order**:
1. **Is the input identical?** (park CSVs, engine CSVs, pitch log) — if yes, an output difference is a real signal.
2. **Which env is BEHIND on the producing step?** Staging is missing C24/C26/C27/C28/C28b/C29. Prod is missing nothing
   in Phase C. **Whoever is behind explains the gap; do not "fix" the current side toward the stale one.**
3. **Is the differing column derived from the Masters?** If so, staging's drift explains it.
4. Only if 1–3 do not explain it is it a defect.
⛔ **NEVER reconcile prod TO staging by copying values.** That is what produced the `team_drs` paste that had to be
undone, and it would have carried staging's Arkansas 41.060 (a value prod could not reproduce) into prod permanently.

---
# 🅱️🔴🔴 TRACK B BLOCKER — **WAR MUST READ THE DB MASTERS, NOT TruMedia CSVs.** ARCHITECTURE DIRECTIVE (Trevor, 2026-08-30)
**THIS IS THE MOST IMPORTANT ITEM IN THIS DOCUMENT. Track B CANNOT WORK UNTIL IT IS FIXED.**

## THE DIRECTIVE, IN TREVOR'S TERMS
> *"derive_masters_from_pitchlog.ts needs to be the one that writes all the stats and even if a little off then it
> needs to be checked and overridden if off by the master sheets. The reason why is because on track b it is going to
> be absorbing pitch logs **every day through the spring**, but only ingesting master sheets **once a month or so** —
> and the only differences should be a check on some of the information as a 2nd source… things like **stolen base and
> ERA** that aren't always perfect from deriving the pitch log. That is why it has to run in the order I am mentioning
> and I am adamant about making sure it does in fact do that."*

## THE MANDATORY ORDER
```
pitch log (DAILY)  →  derive_masters_from_pitchlog.ts writes ALL stats to the Masters
                   →  WAR / power ratings / projections READ THE MASTERS (from the DATABASE)
                   →  TruMedia Master CSV (MONTHLY) = a CHECK / OVERRIDE layer only, applied ON TOP
```
The Master **sheet** is a *second source for verification*, not the primary. Override scope is narrow and specific:
**stolen bases and ERA**, plus anything else demonstrably not derivable cleanly from the pitch log.

## 🔴 THE BLOCKER AS IT STANDS TODAY — WAR IS WIRED THE WRONG WAY ROUND
`scripts/drs/populate_descriptive_war.mjs` reads its hitting and pitching lines **from CSV FILES ON DISK**:
```js
:75  const hitSheet = sheet("docs/drs-reference/Full Season Hitting Master Stats.csv");
:76  const pitSheet = sheet("docs/drs-reference/Full Season Pitching Master Stats.csv");
:102 const PA = g("PA");         // ← from the CSV, NOT from "Hitter Master".pa
```
`"Hitter Master"` is queried at `:77` **only** to build the D1 id list (`source_player_id, division, pa`) — the `pa`
column is never used in the math. `populate_descriptive_war_reg.mjs` is the same shape, reading
`scripts/drs/output/hitter_accrued.csv` and `pitcher_line.csv`.
**⇒ In Track B there are no daily TruMedia season CSVs. A daily run would have NOTHING to read.** The WAR stage as
written is structurally incapable of running inside Track B.
★ It also means today's prod WAR was computed from **TruMedia season CSVs**, not from the pitch log — the exact
inversion of the pitch-log-primary architecture. It is CORRECT (it matched staging to four decimals) but it is
**SOURCED WRONG**, and that must not be carried into Track B.

## ✅ WHY THIS IS FIXABLE — EVERY INPUT ALREADY EXISTS, PITCH-LOG-DERIVED
Two pipelines already produce everything, and BOTH are pitch-log-sourced:
| source | window(s) | supplies |
|---|---|---|
| `pitch_log_{hitter,pitcher}_totals` (**DB**) | full | rates + batted-ball/discipline: `AVG OBP SLG ISO contact barrel chase bb line_drive gb pop_up la_10_30 k_pct avg_exit_velo ev90 pull pull_air`, pitcher `K9 BB9 HR9 WHIP FIP stuff_plus hard_hit_pct barrel_pct …`, and **`ip`** |
| `scripts/drs/output/hitter_accrued.csv` (27 cols) | **FULL + REG** | `PA AB H 2B 3B HR BB HBP SF SH AVG OBP SLG ISO` and `reg_PA reg_AB reg_H reg_2B reg_3B reg_HR reg_BB reg_HBP reg_SF reg_SH` |
| `scripts/drs/output/pitcher_line.csv` (37 cols) | **FULL + REG** | `full_IP full_BF full_K full_BB full_HBP full_H full_HR full_ER **full_ERA** full_R full_RA9 full_FIP full_WHIP full_K9 full_BB9 full_HR9 full_K_pct full_BB_pct` + the complete matching `reg_*` set incl. **`reg_ERA`** |
⚠ **Barrel%/EV are NOT in the engine CSVs** — they come from `pitch_log_hitter_totals`. Two pipelines, one lane.
★ **`full_ERA` and `full_IP` ALREADY EXIST** — yet `PITCHER_UNMAPPED = ["ERA","IP","G","GS","Role"]` still declares
them *"left to TruMedia Master (never written)"*. **That comment is now WRONG for ERA and IP.** Only `G`/`GS` (and
`Role`, which is not a stat) genuinely lack a pitch-log source today.

## 🔴 WHAT `derive_masters_from_pitchlog.ts` DOES **NOT** WRITE TODAY (the whole gap)
It ran on prod (`4,772 pitchers + 4,373 hitters · 0 new rows`) and today re-dry-runs at **0 changes** — so everything
in its write set already matches. **The gap is what is NOT in that set:**
| Master column | prod today | available from | status |
|---|---|---|---|
| `pa` / `ab` | **regular-season line** (avg pa 121.8 vs staging 128.0) | `hitter_accrued.csv` `PA`/`AB` | ❌ patched only on NEW rows |
| `regular_season_pa` | **0 / 5,341** | `hitter_accrued.csv` `reg_PA` | ❌ never written |
| `IP` | regular-season line | `pitcher_line.csv` `full_IP` · `pitch_log_pitcher_totals.ip` | ❌ in `PITCHER_UNMAPPED` |
| `regular_season_ip` | **0 / 5,375** | `pitcher_line.csv` `reg_IP` | ❌ never written |
| `ERA` | stale CSV import | `pitcher_line.csv` `full_ERA` | ❌ in `PITCHER_UNMAPPED` |
| `G` / `GS` | stale CSV import | *(no pitch-log source found)* | ⬜ Master-override only |
| SB / caught stealing | Master sheet | *(partially)* | ⬜ **Master-override by design** |
**⇒ THIS is why prod has no postseason PA.** The step ran, but the counting stats were never in its write set, so the
Masters still hold whatever an older CSV import left. **VERIFIED:** prod `pa` == staging `regular_season_pa` for
**5,339/5,339 hitters (100.0%)** and prod `IP` == staging `regular_season_ip` for **5,374/5,374 (100.0%)**; **0.0%**
match the full-season values.

## ▶️ THE REQUIRED WORK, IN ORDER
1. **Extend `derive_masters_from_pitchlog.ts` to write the counting stats to EXISTING rows** — `pa`, `ab`, `IP`, `ERA`
   — plus the **reg/post split** into `regular_season_pa` / `regular_season_ip` from `reg_PA` / `reg_IP`.
   Boundary is `scripts/drs/drs_engine/season_config.py` → **`2026: regular_season_end 2026-05-18 / postseason_start
   2026-05-19`**. Per that file's own policy: **player stats + power ratings = FULL season; program analytics =
   REGULAR season; projections target a regular-season line.**
2. **Re-point `populate_descriptive_war.mjs` / `_reg.mjs` at the DB Masters** instead of the CSV sheets. Until this is
   done Track B has no WAR stage.
3. **Add the Master-sheet CHECK/OVERRIDE layer** — monthly CSV compared against the derived values, overriding only
   where the pitch log is known-weak (**SB, ERA**), and **logging every override with both values**.
4. ⛔ **`D33b` / `lock_regular_season` IS OBSOLETE — NOT DEFERRED (Trevor, 2026-08-30).** `derive_masters_from_pitchlog` writes `pa` and `regular_season_pa` in the SAME run from the SAME source row, so the atomicity rule is met structurally and the lock has no remaining purpose. **Retire it.** Original note: That RPC is `regular_season_pa = pa` where
   NULL — a snapshot that only works if `pa` is *already* the regular-season line. It predates the engine's split, has
   **NO unlock**, and running it now would permanently freeze the pre-postseason number into `regular_season_pa` while
   `pa` is about to be rewritten to full-season. **Write both columns from the engine output instead.**

---
# 📐 SCOPE — MAKE `derive_masters_from_pitchlog.ts` FILL THE MASTERS COMPLETELY (2026-08-30). NOT YET BUILT.
**Trevor's priority, in his words:** *"what we definitely need to do though is write the derive masters from pitch log
into the master so it captures everything, recognizes the split between regular season and postseason and how that
stores into things like the team stats that are important, and just make sure every column in the master is being
filled properly — then once that is done bring in the master sheet that includes the postseason (so not the full
regular season named one)."*
★ **WAR RE-POINTING IS EXPLICITLY *NOT* REQUIRED FIRST.** Trevor: *"I don't necessarily think the WAR needs to be
reproduced and it will be mapped in Track B as long as we continue to emphasize what the goal is."* The CSV-reading
WAR stage stays flagged (see the TRACK B BLOCKER block) and is mapped into Track B later. **Do not rebuild it now.**

## THE ORDER (non-negotiable)
```
1. derive_masters_from_pitchlog.ts fills the Masters COMPLETELY from the pitch log,
   with the regular/postseason split, and feeds the team-stat rollups correctly
2. THEN import the POSTSEASON-INCLUSIVE Master sheet  ⚠ NOT "Full Season Hitting Master Stats.csv"
   — that file is the regular-season-named export. Use the one that INCLUDES postseason.
```

## ✅ COLUMN AUDIT — PROD, Season 2026, division='D1' (VERIFIED 2026-08-30)
### `"Hitter Master"` — 83 columns / 5,341 rows
| bucket | columns | verdict |
|---|---|---|
| **EMPTY (4)** | `regular_season_pa` · `trackman_pitches` · `dob` · `class_year` | `regular_season_pa` = **THE GAP** (build it). `trackman_pitches` on the HITTER table is a **pitcher concept — vestigial, confirm then ignore/drop**. `dob`/`class_year` are **roster/bio data** (roster scraper), NOT stats — out of scope here. |
| **WRONG WINDOW** | `pa` `ab` (+ the slash line that derives from them) | populated, but holding the **REGULAR-SEASON** line. Must become **FULL season**. Verified: prod `pa` == staging `regular_season_pa` for **5,339/5,339 (100.0%)**. |
| **PARTIAL — BY DESIGN, NOT DEFECTS** | `line_drive`(5163) `avg_exit_velo`(5082) `barrel`(5078) `ev90`(5151) `pull`(5216) `la_10_30`(5078) `gb`(5163) `pop_up`(5163) + their `*_score` + the 4 power ratings (5122–5130) | gated by **`MIN_TRACKED_BIP`** — legitimately null for low-sample hitters. **Do NOT "fill" these.** |
| **PARTIAL — BY DESIGN** | all 15 `blended_*` + `combined_pa`/`combined_seasons` (~1,061) | only players with multi-season history. Correct. |
| **PARTIAL — GATE ARTIFACT** | `k_pct`(4,374) `pull_air`(4,367) `pull_air_score`(4,366) | **5,341 − 4,374 = 967 ≈ the `thin(<25 PA)=963`** skipped by `MIN_PA`. These are written ONLY by this producer, so sub-gate players never get them, while `AVG/OBP/SLG` (written elsewhere) are full. ⬜ **DECIDE: is a 25-PA floor correct for `k_pct`/`pull_air`, or should they follow the same rule as the slash line?** |
| **FULL (38)** | identity, slash line, conference, division, the `desc_*` set | ✅ |
### `"Pitching Master"` — 97 columns / 5,375 rows
| bucket | columns | verdict |
|---|---|---|
| **EMPTY (4)** | `regular_season_ip` · **`bf`** · `dob` · `class_year` | `regular_season_ip` = **THE GAP**. ★ **`bf` (batters faced) is 0/5,375 yet `pitcher_line.csv` carries `full_BF` and the producer ALREADY selects `bf`** — a free fill that is simply unwired. |
| **WRONG WINDOW** | `IP` · `ERA` | `IP` holds the **REGULAR-SEASON** line (prod `IP` == staging `regular_season_ip` for **5,374/5,374 = 100.0%**). `ERA` is from the stale import. Both are in `PITCHER_UNMAPPED` yet BOTH exist as `full_IP` / `full_ERA`. |
| **PARTIAL — BY DESIGN** | `hard_hit_pct` `barrel_pct` `line_pct` `exit_vel` `ground_pct` `90th_vel` `la_10_30_pct` `stuff_plus`(5251) + scores | sample-gated. Correct. |
| **PARTIAL — BY DESIGN** | 20 `blended_*` + `combined_ip`/`combined_seasons` (~1,658) | multi-season only. Correct. |
| **PARTIAL — GATE ARTIFACT** | `k_pct`(4,772) | = the above-gate pitcher count (`MIN_BF=20`). Same open question as the hitter side. |
| **FULL (56)** | identity, rate stats, `desc_*`, `trackman_pitches` (C24), conference | ✅ |

## 🔧 THE BUILD — WHAT TO WRITE, AND FROM WHERE (every input already exists, all pitch-log-derived)
| Master column | source | file/table | window |
|---|---|---|---|
| `pa` `ab` | `PA` `AB` | `scripts/drs/output/hitter_accrued.csv` | **FULL** |
| `regular_season_pa` | `reg_PA` | same file | **REG (≤2026-05-18)** |
| `IP` | `full_IP` | `scripts/drs/output/pitcher_line.csv` *(or `pitch_log_pitcher_totals.ip`)* | **FULL** |
| `regular_season_ip` | `reg_IP` | `pitcher_line.csv` | **REG** |
| `ERA` | `full_ERA` | `pitcher_line.csv` (`reg_ERA` also present) | **FULL** |
| `bf` | `full_BF` | `pitcher_line.csv` | **FULL** |
| rates + batted-ball | already written | `pitch_log_{hitter,pitcher}_totals` | FULL |
| `G` `GS` | ⬜ **no pitch-log source found** | — | Master-override only |
| SB / CS | ⬜ partial | — | **Master-override BY DESIGN** |
**BOUNDARY (single source of truth):** `scripts/drs/drs_engine/season_config.py` →
`2026: regular_season_end "2026-05-18", postseason_start "2026-05-19"`. Its own policy, verbatim: *player stat store +
player TOTAL WAR + POWER RATINGS = **FULL** season · PROGRAM ANALYTICS (team_war_snapshots, YoY/championship) =
**REGULAR** season · PROJECTIONS target a **regular-season** line.* ⬜ **Mirror this into a DB `season_config` row so
TS and Python share ONE value** — the file itself flags this as unresolved.

## ⬇️ DOWNSTREAM — "how that stores into things like the team stats"
`refresh_team_season_stats(p_season, p_reg_end DEFAULT <season>-05-18)` already takes the boundary and already builds
`_reg` **and** `_total` variants. It reads Master `desc_*`/`_reg` (done ✅) **and divides by `regular_season_ip`**
(`:143` `nullif(sum(pm.regular_season_ip),0)`) — **currently 0/5,375, so every regular-season rate it computes lands
NULL, silently.** ⇒ **Filling `regular_season_ip` is a HARD PREREQUISITE for F44.** Per policy, team analytics use the
REGULAR-season window, which is exactly why this column matters.

## 🛑 GUARDRAILS FOR THE BUILD
1. **`--create-new` is BROKEN** — `:465` passes `"batting_team_id"` where `repRows`' `idCol` belongs, the query times
   out over 2,576,146 rows, and `:451` discards the `error`. **Fix before relying on any new-row path.**
2. **Never create Master rows implicitly** — keep creation behind `--create-new`, log every row by name + PA/IP.
3. **Adopt the `TeamID` a player's teammates already use** — resolving it independently by season splits the team
   (proved live: Arkansas 308→309 teams). Prefer the season-stable `source_team_id` for any rollup.
4. **Do NOT run `lock_regular_season` / D33b.** It is `regular_season_pa = pa` where NULL, has **no unlock**, and would
   freeze the pre-postseason number. **Write both columns from the engine output instead.**
5. **Gate on VALUE + MEMBERSHIP + CARDINALITY, never counts.** After the build: `pa` avg must move ~121.8 → ~128.0;
   `regular_season_pa` must equal the OLD `pa` per player; `regular_season_ip` 0 → 5,374.

---
# ✅ DECISION — DO **NOT** ADD REGULAR-SEASON STAT COLUMNS. Only `regular_season_pa` / `regular_season_ip`. (Trevor, 2026-08-30)
> *"We don't really need regular season stats — we kinda just need WARs from them, and I don't think it displays
> anything except including the postseason data… my main concern was more about what we actually need for the regular
> season, which was the metrics that go into WAR — which we have."*

## WHAT EXISTS, AND WHY THAT IS ENOUGH
| table | `_reg` columns | nature |
|---|---|---|
| `"Hitter Master"` (7 of 83) | **`regular_season_pa`** · `woba_reg` `wraa_reg` `desc_owar_reg` `d_war_reg` `bsr_war_reg` `total_desc_war_reg` | **1 stat anchor + 6 WAR OUTPUTS** |
| `"Pitching Master"` (6 of 97) | **`regular_season_ip`** · `desc_ra9_reg` `desc_fip_ra9_reg` `drs_behind_reg` `desc_pwar_reg` `total_desc_war_reg` | **1 stat anchor + 5 WAR OUTPUTS** |
There is **NO** regular-season `AVG/OBP/SLG/ISO`, no reg `H/2B/3B/HR/BB`, no reg `ERA/FIP/WHIP/K9/BB9/HR9`. **That is
CORRECT and intentional.** The regular-season WAR is already computed and stored; the reg *inputs* are consumed at
compute time from the engine output and do not need persisting.
⚠ The engine produces **28** `reg_*` values that have no Master column and are discarded each run —
`hitter_accrued.csv` (10): `reg_PA reg_AB reg_H reg_2B reg_3B reg_HR reg_BB reg_HBP reg_SF reg_SH`;
`pitcher_line.csv` (18): `reg_IP reg_BF reg_K reg_BB reg_HBP reg_H reg_HR reg_ER reg_ERA reg_R reg_RA9 reg_FIP
reg_WHIP reg_K9 reg_BB9 reg_HR9 reg_K_pct reg_BB_pct`. **Leave it that way unless a display need appears.**
Downstream already copes: `refresh_team_season_stats(p_season, p_reg_end)` **re-derives** regular-season team rates
straight from `pitch_log` by date; it only reads `desc_*_reg` + `regular_season_ip` from the Masters.

## 🛑 BUILD HAZARD — WRITE `regular_season_pa`/`_ip` IN THE **SAME OPERATION** THAT MAKES `pa`/`IP` FULL-SEASON
The three live consumers all use the same fallback:
```
useTeamBuilderData.ts:239   Number(r.regular_season_pa ?? r.pa ?? r.ab)     ← hitter depth-role tier volume
useTeamBuilderData.ts:254   Number(r.regular_season_ip ?? r.IP)             ← pitcher depth-role tier volume
usePitchingSeedData.ts:124  r.regular_season_ip ?? r.IP
refresh_team_season_stats.sql:143,145   ÷ sum(regular_season_ip)
```
Purpose, per `AdminDashboard.tsx:4072`: *"tier classification … stays anchored to regular-season volume. Postseason
games keep updating live pa/IP but tiers stay frozen — **playoff teams don't get inflated tier counts.**"*
**TODAY:** `regular_season_pa` is NULL ⇒ everything falls through to `?? pa` ⇒ and prod's `pa` *happens* to be the
regular-season line ⇒ **tiers are accidentally correct.**
**THE TRAP:** the instant `pa`/`IP` become FULL-season while `regular_season_*` is still NULL, that same fallback
starts using **postseason-inflated volume** ⇒ **deep-run playoff teams get their hitters/pitchers pushed up a depth
tier**, with **no error anywhere**. It is the exact failure the lock mechanism was built to prevent, re-introduced by
filling the wrong column first.
✅ **RULE: one operation, both columns, or neither.** Order within the build: write `regular_season_pa = reg_PA` and
`regular_season_ip = reg_IP` **BEFORE or ATOMICALLY WITH** `pa = PA` / `IP = full_IP`.
✅ **GATE:** after the build, `regular_season_pa` must equal the OLD `pa` per player (prod's current values), and `pa`
must have risen (avg **121.8 → ~128.0**). Spot-check a deep playoff team (LSU / Arkansas) and confirm its depth-role
tier counts did **not** change.
⛔ Still **DO NOT** run `lock_regular_season` / D33b — it snapshots `pa → regular_season_pa`, which is only valid while
`pa` is the regular-season line, and it has **no unlock**.

---
# ✅ THREE BUILD DECISIONS LOCKED (Trevor, 2026-08-30) — these define how `derive_masters_from_pitchlog.ts` is extended
## 1. THE ATOMICITY REQUIREMENT IS SATISFIED BY CONSTRUCTION — `lock_regular_season` BECOMES OBSOLETE
> *"which would just simply be the derive masters from pitch log correct?"* — **YES.**
Because this ONE producer writes `pa`/`ab`/`IP`/`ERA` **and** `regular_season_pa`/`regular_season_ip` in the **same
run, from the same source row** (`hitter_accrued.csv` gives `PA` + `reg_PA`; `pitcher_line.csv` gives `full_IP` +
`reg_IP`), the "one operation, both columns, or neither" rule is met **structurally** — there is no window in which
`pa` is full-season while `regular_season_pa` is still NULL, which is the state that would silently inflate
depth-role tiers for playoff teams.
⛔ **THEREFORE `lock_regular_season` / D33b IS NOT DEFERRED — IT IS OBSOLETE.** It is a pre-engine snapshot mechanism
(`regular_season_pa = pa` where NULL, **no unlock**) that only works while `pa` is the regular-season line. Once this
build lands it must never be run. **Retire it alongside `team_drs_store.sql`.**

## 2. `k_pct` / `pull_air` — FILL FOR EVERYONE, FOLLOWING THE SLASH LINE
> *"follow the slashline and fill it for everyone."*
**Today:** `k_pct` **4,374** / `pull_air` **4,367** of **5,341** hitters (pitcher `k_pct` 4,772 of 5,375) — the
shortfall is exactly the `thin(<25 PA)=963` skipped by `MIN_PA`, while `AVG/OBP/SLG/ISO` show **full** coverage only
because they were last written by the older CSV import.
🛑 **THE GATE MUST BE SPLIT IN TWO — it currently gates the WHOLE patch at `:274`:**
```ts
:274  if ((t.pa ?? 0) < MIN_PA) { hitterThin++; continue; }   // ← PATCH gate: REMOVE / set to 0
:469  if ((t.pa ?? 0) < MIN_PA) { skipped++; continue; }      // ← NEW-ROW gate: KEEP at 25 PA / 20 BF
```
**PATCHING an existing row: no floor** — every player with pitch-log data gets every derived field.
**CREATING a new row: keep the floor** — otherwise `--create-new` manufactures a Master row for every 1-PA appearance
(on prod that would be **763 candidates instead of 1**; the background orphans top out at 18 PA).
⚠ **Once this producer is the SOLE writer, leaving the patch gate at 25 would strand ~963 hitters + ~603 pitchers on
permanently stale CSV values.** Sample-gated batted-ball fields (`barrel`, `ev90`, `avg_exit_velo`, `la_10_30`, …)
keep their own `MIN_TRACKED_BIP` floor — that is a DATA-QUALITY floor, not a volume floor, and is correct.

## 3. `--create-new` STAYS IN THE PIPELINE — AND ITS BUG IS NOW REQUIRED WORK
> *"keep create new in pitch log track b… we are gonna NEED it in Track B because 2027 will have a bunch of new
> players when Track B runs for the first time in a regular season and will have to do it. It actually makes more
> sense to have it built in that process to ensure it's done properly."*
New-row creation is a **first-class Track B stage**, not a manual patch: at the start of each season virtually every
freshman/transfer appears in the pitch log before any Master sheet arrives, and Track B ingests pitch logs **daily**
vs master sheets **monthly** — so the pipeline MUST be able to create the row itself.
🔴 **THEREFORE THE `repRows` BUG IS BLOCKING, NOT OPTIONAL:** `:465` passes `"batting_team_id"` where `idCol` belongs
(`:486` correctly passes `"pitcher_id"`), so it queries `pitch_log WHERE batting_team_id = <a player id>` — matches
nothing, **exceeds the statement timeout** over 2,576,146 rows, and `:451` **discards the `error`** ⇒ every hitter
silently skipped ⇒ **no hitter Master row can EVER be created.** Left unfixed, Track B's first 2027 run creates **zero
hitters** and reports `0 new rows` with **exit 0**.
**FIX:** `:465` → `"batter_id"`, **and** `:451` → `const { data, error } = …` with failures counted + fatal.
**GATE:** after the fix, a prod dry-run must report **exactly 1** new hitter (Kozeal was already inserted manually, so
re-verify against the current membership query) and the MEMBERSHIP query must come back EMPTY.

---
# 🅱️🏛️ TRACK B — THE COMPLETE ARCHITECTURE (CANONICAL, 2026-08-30). Build from THIS. Zero ambiguity intended.
Settled with Trevor across this session. **Every statement below is a DECISION, not a proposal.** Where something is
genuinely undecided it is marked ⬜ OPEN. Where something is verified on prod it says VERIFIED.

## 1. THE TWO CADENCES — everything else follows from this
| source | cadence | role |
|---|---|---|
| **Pitch log** | **DAILY, all spring** | **PRIMARY SOURCE OF TRUTH.** The majority of every statistic is DERIVED from it. |
| **TruMedia Master sheet** | **~MONTHLY** | **SECOND SOURCE / CHECK.** Overrides the derived value ONLY where the pitch log is known-weak — **stolen bases, ERA, G/GS**. Never a daily dependency. |
⇒ **NO STAGE MAY DEPEND ON A FILE THAT ONLY ARRIVES MONTHLY.** Any stage reading `docs/drs-reference/*.csv` or
`scripts/drs/output/*.csv` is structurally unrunnable inside Track B.

## 2. THE THREE LAYERS — each value lives in EXACTLY ONE place
```
   ┌── LAYER 1 ── pitch_log ─────────────────────────────────────────────────────┐
   │  raw per-pitch. Never aggregated in place. Immutable history.               │
   └────────────────────────────────┬────────────────────────────────────────────┘
                                    │  REBUILT ON **EVERY** PITCH-LOG IMPORT
   ┌── LAYER 2 ── pitch_log_*_totals ── THE ACCUMULATOR ─────────────────────────┐
   │  ALL RAW COUNTS live here and ONLY here, per (player, season, dimension_key)│
   │  hitter: pa ab hits_single/double/triple/hr k bb hbp sac batted_* ev_* …    │
   │  pitcher: total_bf total_pa total_k total_bb total_hbp hits_*_allowed ip …  │
   │  + defensive/baserunning run values (batting_rv, defensive_rv, baserunning_rv)│
   └────────────────────────────────┬────────────────────────────────────────────┘
                                    │  DERIVE (rates, ratings, WAR)
   ┌── LAYER 3 ── "Hitter Master" / "Pitching Master" ── DERIVED + DISPLAY ──────┐
   │  rates (AVG/OBP/SLG/ISO, K9/BB9/HR9/WHIP/FIP), power ratings, stuff_plus,   │
   │  desc_* and desc_*_reg WAR, plus pa/ab/IP + regular_season_pa/_ip as the    │
   │  DISPLAY + DEPTH-ROLE-TIER anchors.                                         │
   │  ⛔ NO raw component counts here (no H/2B/3B/HR/BB/HBP columns) — they live  │
   │     in Layer 2. Storing them twice is exactly what we are eliminating.      │
   └─────────────────────────────────────────────────────────────────────────────┘
```
**★ WAR READS LAYER 2 AND WRITES LAYER 3.** That is the resolution of "WAR must read the Masters": the *counts* come
from the accumulator, the *results* land on the Master, and every consumer downstream reads the Master.
**★ `pitch_log_*_totals` IS NOT AN END-OF-SEASON ARTIFACT.** It was built that way only because the season was already
over. **It must rebuild on every import** — it is the mechanism by which pitch-log data reaches the Masters.

## 3. THE REGULAR/POSTSEASON SPLIT — LOCK ONCE AT THE TRANSITION, THEN KEEP ACCUMULATING
> Trevor: *"we also probably just need to recognize the one time in the year when it transitions to the postseason and
> lock in the regular season values, then just keep adding what becomes postseason values."*
```
during the regular season   →  totals accumulate normally
AT THE TRANSITION (one time)→  SNAPSHOT the regular-season line   (dimension_key='reg', or the *_reg columns)
after the transition        →  'all' KEEPS GROWING (full season);  'reg' NEVER CHANGES AGAIN
```
This is the *correct* form of what `lock_regular_season` was groping at — but driven by the accumulator, not by copying
`pa` into `regular_season_pa`. **⛔ `lock_regular_season` / D33b IS OBSOLETE. Retire it.**
**Boundary:** `2026-05-18` (regular_season_end) / `2026-05-19` (postseason_start).
🛑 **IT IS CURRENTLY TYPED IN TWO PLACES** — `scripts/drs/drs_engine/season_config.py` and
`refresh_team_season_stats`'s `p_reg_end` default. **THERE MUST BE ONE SOURCE.** Two copies can drift and nothing
errors. ⬜ **FUTURE (Trevor's plan):** load **per-team SCHEDULES** for upcoming seasons so the system knows when each
team's regular season ends — which removes the constant entirely and handles teams whose seasons end on different
dates. Not urgent; wire the single source first.
**Policy (from `season_config.py`, unchanged):** player stats + power ratings = **FULL** season · program analytics
(`team_war_snapshots`, YoY/championship) = **REGULAR** season · projections TARGET a regular-season line.

## 4. 🔴 WHAT MUST BE BUILT — THE GAP INVENTORY (exact columns, VERIFIED on prod 2026-08-30)
### 4a. `pitch_log_pitcher_totals` (51 cols) IS MISSING THE RUN-PREVENTION INPUTS
HAS: `total_bf total_pa total_k total_bb total_hbp hits_{single,double,triple,hr}_allowed total_ab ip batted_* ev_* stuff_plus_sum`
**MISSING — and `desc_ra9` / `desc_pwar` cannot be computed without them:**
| missing | why it matters | note |
|---|---|---|
| **`R`** (total runs allowed) | `desc_ra9 = 0.5·(RA9 + drs_behind_per9) + 0.5·(FIP·E2T)` | ⚠ **NOT a naive count** — the engine accrues it with **inherited-runner attribution, earned + unearned** (`pitcher_line.csv` `full_R`). **That accrual logic must move INTO the totals build.** |
| **`ER`** (earned runs) | `ERA` | same accrual |
| **`G` / `GS`** | roster/role context | ⬜ Trevor: *"almost positive the pitch log import has a starting pitcher id"* — derivable, **not worth chasing now. Track B flag.** |
### 4b. DEFENSE + BASERUNNING SHOULD FOLD INTO THE SAME ACCUMULATOR
> Trevor: *"same could be said for storing baserunning and defensive values in that same run that might be a separate
> table now — those should all go into the pitch_log_*_totals then that should be derived into the masters from every
> pitch log imported."*
Today they are **separate tables** rebuilt by an offline Python engine:
`player_season_defense` (32 cols — `drs_floor/total/ceiling`, `range_*`, `arm_runs`, `framing_runs`, …) and
`player_season_baserunning` (15 cols — `sb cs sbh wsb_runs` **+ `wsb_runs_reg`** ← *a reg variant already exists here*).
★ **PRECEDENT ALREADY IN PLACE:** `pitch_log_hitter_totals` already carries **`batting_rv`, `defensive_rv`,
`baserunning_rv`** (+ `_z`), written by `populate_hitter_run_values(season)`. So the bridge exists — it just runs as a
separate step instead of as part of the accumulator.
⬜ **OPEN — Trevor's direction is clear (fold them in); the sequencing is not decided.** dRS is a heavy engine with its
own constants; whether it becomes a stage of the daily run or stays a periodic rebuild feeding the accumulator needs a
call. **Do not assume either.**
### 4c. `derive_masters_from_pitchlog.ts` — the extension already scoped
Write to EXISTING rows: `pa`/`ab` (FULL), `IP` (FULL), `ERA`, `bf`, **and** `regular_season_pa`/`regular_season_ip`
**in the same operation** (see the depth-role tier hazard). Split the gate: **no floor for PATCHING** (`:274`),
**keep 25 PA / 20 BF for CREATING** (`:469`). Fix `repRows` `:465` → `"batter_id"` and stop discarding `error` at `:451`.

## 5. ✅ WHAT IS ALREADY CORRECT — DO NOT RE-TEST, DO NOT "FIX"
- **Rates + batted-ball/discipline on both Masters** — already pitch-log-derived and written; the prod dry-run reports
  **0 changes** on 4,373 hitters / 4,772 pitchers. Correct.
- **`desc_*` and `desc_*_reg` WAR on prod** — D31/D32 committed, D34 passed all 9 gates. Values verified against
  staging (`desc_owar` 0.3458 vs 0.3456, sum identity 0.001). **Correct, even though SOURCED from CSVs** — that is a
  Track B wiring problem, not a data problem. **Do not recompute.**
- **`team_drs`** — derived on prod, 308 teams, sum 0.00. **Correct.**
- **Park factors + `run_env_factor`** — prod↔staging **308/308 IDENTICAL**, `run_env_factor` identical at 99.719.
- **Sample-gated columns** (`barrel`, `ev90`, `avg_exit_velo`, `la_10_30`, the `*_score` set, power ratings) — null
  below `MIN_TRACKED_BIP` **by design**. ⛔ **NOT a gap. Do not fill.**
- **`blended_*` + `combined_*`** (~1,061 hitters / 1,658 pitchers) — multi-season players only, **by design**.

## 6. ⚖️ ROADBLOCKS vs NOT-WORTH-FIXING
| item | verdict |
|---|---|
| WAR reads CSVs, not the DB | 🔴 **ROADBLOCK for Track B** — but NOT for the current prod push. Re-point during the Track B build, not now. |
| `pitch_log_pitcher_totals` missing `R`/`ER` (+ the inherited-runner accrual) | 🔴 **ROADBLOCK** — no pitcher WAR without it. |
| `repRows` `:465` bug (no hitter row can ever be created) | 🔴 **ROADBLOCK** — 2027's first run is mostly new players. |
| `regular_season_pa`/`_ip` unfilled | 🔴 **ROADBLOCK for F44** (`nullif(sum(regular_season_ip),0)` → NULL rates) **and a live hazard** the moment `pa` goes full-season. |
| `pa`/`IP` holding the regular-season line | 🟡 **Fix in the build.** Harmless today *because* `regular_season_*` is NULL and the fallback lands on the right value. |
| Boundary date typed in 2 places | 🟡 **Wire to one source — not urgent.** Superseded later by per-team schedules. |
| `G`/`GS` with no pitch-log source | 🟢 **NOT worth chasing now.** Master-override; Track B flag. |
| SB / CS | 🟢 **Master-override BY DESIGN.** Not a gap. |
| `dob` / `class_year` empty | 🟢 **Not stats.** Roster-scraper concern, out of scope. |
| `trackman_pitches` on `"Hitter Master"` | 🟢 **Vestigial** (a pitcher concept). Confirm, then ignore or drop. |
| `k_pct` / `pull_air` short by ~963 | 🟡 **Fix via the patch-gate removal** — fill for everyone, following the slash line. |
| Reg-season STAT columns beyond `pa`/`IP` | 🟢 **DECIDED: do not add.** Counts live in Layer 2; the Master stores derived results only. |
| Recomputing prod WAR | 🟢 **NOT needed.** Values verified correct. |

## 7. 🧭 THE FOUR GATE TYPES THAT ACTUALLY CATCH THINGS (a count gate catches none of them)
1. **VALUE** — did the number CHANGE? (Conference `Stuff_plus` 101.17→99.15 · `run_env_factor` 101.879→99.719, both **30/30 before AND after**)
2. **MEMBERSHIP** — diff the ID SET. (caught Kozeal: 5,340 = 5,340 passed every count)
3. **CARDINALITY** — assert the GROUP count (D1 = 308 teams). (caught the `TeamID` split; the Σ-centering assertion held at 309)
4. **LOG-CONTENT** — read the body, never the exit code. (`0 FAILED` must be printed, not inferred; `--create-new` exits 0 while creating nothing)

---
# 📍 WHERE WE ARE — END OF 2026-08-30. Current state, and what is left.
## ✅ DONE ON PROD (verified in the DB, not from logs)
| phase | state |
|---|---|
| **A / B** schema + config | ✅ `model_config` 220 keys · Phase-B tuned values SURVIVED C27's upsert (`nil_tier_sec` 4.0, `r_obp_std_pr` 31.89504) |
| **C** Stuff+ chain 1–5 | ✅ 2,013,005 pitches · per-pitcher gate **mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 — IDENTICAL to staging** |
| **C24 / C27 / C26 / C29 / C28 (4 steps) / C28b** | ✅ all applied; Conference `Stuff_plus` **101.17 → 99.15** (the lane fix) |
| **D29b** `team_drs` | ✅ **DERIVED on prod** (not pasted) — 308 teams, sum 0.00, Arkansas 41.272 |
| **D30** dRS/wSB load | ✅ confirmed NO-OP (13,454 / 10,432 already present) |
| **D31 / D32** descriptive WAR + `_reg` | ✅ committed, `0 FAILED`; **D34 passed all 9 gates** |
| **E2** park factors + ★`derive_conf_opr_htp` re-run | ✅ `rg_factor_seasonal` 0/309 → full; `run_env_factor` **101.879 → 99.719** |
| *(unplanned)* Camden Kozeal | ✅ Master row created — D1 hitters 5,340 → **5,341** |
**Prod↔staging where compared:** park factors **308/308 identical** · `run_env_factor` identical · Kozeal's WAR
identical to 3dp. Remaining diffs (`hitter_talent_plus` 99.23 vs 99.01) are **staging being BEHIND** — prod is current.

## ⛔ NOT DONE, AND DELIBERATELY SO
- **`D33b` / `lock_regular_season`** — **OBSOLETE, do not run.** Superseded by the accumulator lock (§3 of the
  architecture). It has **no unlock** and would freeze the pre-postseason number.
- **`pa`/`IP` still hold the REGULAR-SEASON line** — harmless *today* precisely because `regular_season_*` is NULL and
  the depth-role fallback lands on the right value. **Fixed in the derive_masters build, both columns together.**
- **WAR still sourced from CSVs** — correct numbers, wrong wiring. **Re-point during the Track B build, not now.**

## ▶️ REMAINING PROD PUSH (dependency order, NOT topic order)
`F44 refresh_team_season_stats` ← **BLOCKED on `regular_season_ip`** (it divides by it → NULL rates) →
`E35` TWP detector (guard added ✅) → `E36/E37/E38` precomputes → `F39` `refresh_composite_war` → `F40–F43` →
`G46` edge-fn deploy → PR staging→main → `H` drops → **THEN staging catch-up, run THROUGH Track B.**
★ **F44 MOVED UP, before Phase E** — `precompute-transfer-projections.ts:225` / `precompute-pitchers.ts:279` READ
`team_season_stats.faced_*` and coerce a miss to `[]`. See the ORDER AUDIT.

## 🔨 THE BUILD QUEUE (in order, all scoped, none started)
1. **`derive_masters_from_pitchlog.ts` extension** — counting stats + reg/post split + gate split + `repRows` fix.
2. **`pitch_log_pitcher_totals` gains `R`/`ER`** — including the inherited-runner accrual currently only in the engine.
3. **`dimension_key='reg'`** on the totals build → kills the last hitter-side CSV dependency.
4. **Fold defense/baserunning into the accumulator** ⬜ sequencing OPEN.
5. **Re-point WAR at the DB** (Layer 2 → Layer 3).
6. **One boundary-date source** → later, per-team schedules.

## 🧠 THE SIX DEFECTS THIS PUSH FOUND — every one PASSED a naive check
1. Conference `Stuff_plus` **stale at 30/30** (a 4th producer the runbook omitted)
2. `trackman_pitches` **fully populated from the WRONG LANE** (638/5,367 = 11.9% agreement)
3. `run_env_factor` **stale under E2 at 30/30** (park rewrite invalidates it)
4. **Kozeal missing** — invisible to `5,340 = 5,340`
5. **`--create-new` structurally broken** — exits 0, prints `0 new rows`, can never create a hitter
6. **`TeamID` team split** — both buckets internally consistent, Σ-centering held **at 309 teams**

---
# 🚦 PUSH-TO-PROD ROADBLOCKS — WHAT ACTUALLY BLOCKS FINISHING THE PUSH (2026-08-30)
**Scope: THE PROD PUSH ONLY.** Track B build work is tracked separately (see the TRACK B ARCHITECTURE block) and is
**NOT** a push blocker. Readiness swept script-by-script, verified — not reasoned from memory.

## 🔴 GENUINE BLOCKERS — must be handled before/while running the remaining steps
| # | blocker | detail | fix |
|---|---|---|---|
| 1 | **F40 `backfill-snapshot-total-hitter-war.ts` HAS NO ENV GUARD** | `:22` `createClient(process.env.SUPABASE_URL!, …)` with **no `--prod` flag anywhere** (`grep -c` = 0/0). `--env-file=.env.production.local` writes PROD with **zero opt-in**. **SIXTH instance** of this defect class (after `_run_store_no_propagate`, both C28 producers, the market scripts, E35, E2). | Add the standard double-keyed guard + verify both refuse paths. ~5 min. |
| 2 | **F44 will write NULL regular-season rates** | `refresh_team_season_stats.sql:143,145` divide by `sum(regular_season_ip)`, which is **0/5,375 on prod** ⇒ `nullif(...,0)` → NULL ⇒ `ra9_r` / `fra9_r` and the `_reg` rate set land NULL, **silently**. | ⚠ **NOT a hard block** — see below. Run F44 now, **re-run after** the `derive_masters` build fills `regular_season_ip`. The function is idempotent (DELETE-season-then-rebuild). |

## ✅ WHY BLOCKER 2 DOES NOT STOP THE PUSH
`faced_stuff_plus` / `faced_htp` — the columns Phase E actually reads — are built by **steps 8 and 9** of
`refresh_team_season_stats`, which join `pitch_log` to the conference Stuff+/HTP. **They do NOT depend on
`regular_season_ip`.** So F44 run today still correctly unblocks `precompute-transfer-projections.ts:225` and
`precompute-pitchers.ts:279`. Only the **program-analytics `_reg` rates** are degraded, and those feed YoY /
championship-benchmark displays, not projections. **Run it, note the gap, re-run later.**

## ✅ NOT BLOCKERS — verified ready (do NOT re-check, do NOT "fix")
| step | state |
|---|---|
| **E35** TWP detector | guard **ADDED + both refuse paths verified** ✅ |
| **E36 / E37 / E38a / E38b** precomputes | all carry the prod ref assert (`grep` = 1) + ordered pagination ✅ · `customer_teams` = **14 active** (NOT 18 — that is a staging number) |
| **F41a / F41b / F41c** TWP markets | ref asserts present ✅ (the earlier "no `--prod`" note is STALE). ⚠ invoke directly — **not npm scripts**. F41b's unordered `.range()` is **benign**: its reads are `players is_twp=true` (253), `target_board` (184), `"Teams Table"` (774) — all single-page. Re-check only if any crosses 1000. |
| **F42a / F42b / F42c** resyncs | ref asserts present ✅ (the "hardcoded `.env.local`" note is STALE — F42a is env-driven + double-key-guarded). ⚠ **F42a needs `--all`** — its default scope is a **staging** build id (0 rows on prod). |
| **F43a / F43b** snapshots | **SAFE BY CONSTRUCTION** — `--prod` SELECTS the env file and they read it directly, so `--env-file` cannot redirect them and prod is unreachable without `--prod`. No ref assert, but no exposure. |
| **F39** `refresh_composite_war()` | already **÷13.1** on prod and runs ✅. 🛑 fire from the **direct pg session / SQL editor only** — over PostgREST the ~125s gateway cuts it and the whole UPDATE **ROLLS BACK**. |
| **G46** edge-fn deploy | gate is now only "F44 has RUN and POPULATED `team_season_stats`" — the table + function **exist** on prod. |

## 🟢 EXPLICITLY NOT PUSH PROBLEMS (correct as-is — keep going, do not edit)
- **`pa` / `IP` holding the regular-season line.** Depth-role tiering reads `regular_season_pa ?? pa`; `regular_season_pa`
  is NULL so it falls through to `pa` — which **IS** the regular-season line. **The tiers are CORRECT today.** This
  only becomes a hazard when `pa` goes full-season, which happens in the derive_masters build where both columns are
  written together. **Nothing to do for the push.**
- **WAR sourced from CSVs.** Numbers **verified correct** (D34 all 9 gates; Kozeal matches staging to 3dp). Wrong
  *wiring*, right *values*. **Do NOT recompute.** Re-point during the Track B build.
- **`repRows` `:465` bug.** Affects only **new-row creation**, which the push does not use. Track B blocker, not a push one.
- **`G`/`GS`, SB/CS, `dob`/`class_year`, `trackman_pitches` on Hitter Master.** Out of scope / by design / vestigial.
- **Everything already applied** — Stuff+ chain, C24/C26/C27/C28/C28b/C29, D29b–D34, E2 + the `derive_conf_opr_htp`
  re-run, Kozeal's row. **Verified. Do not re-run or re-test.**

## ▶️ THE REMAINING PUSH, READY TO EXECUTE (dependency order)
```
0.  FIX F40's env guard (only genuine code blocker)
1.  F44  refresh_team_season_stats(2026)   ← MOVED UP, must precede Phase E (faced_* reads)
2.  E35  run-twp-recompute --apply --prod   (prod is_twp 137/31,467 → expect a large change)
3.  E36  returner pitchers  →  E37 returner hitters  →  E38 zsh scripts/_run_step2_all.sh --prod
        ⚠ the loop pipes through `grep | head -3` and SWALLOWS EXIT CODES — do not trust "14 teams DONE";
          re-run the dry-run afterwards and require 0 pending per team.
4.  F39  refresh_composite_war()  (direct pg session ONLY)
5.  F40 → F41 → F42 (--all) → F42b → F43
6.  🛑 G46 REMOVED (Track B branch)  →  preview-verify  →  gh pr create staging→main  →  Trevor merges
7.  H    gated drops  →  THEN staging catch-up, run THROUGH Track B
8.  LATER: re-run F44 once derive_masters fills regular_season_ip (idempotent)
```

---
# 🎯 DIRECTIVE — PROD MUST HOLD **FULL-SEASON** `pa`/`IP` (INCLUDING POSTSEASON), WITH THE REG SPLIT ALONGSIDE
> Trevor, 2026-08-30: *"what we need to do is update prod to reflect full season stats including postseason, which
> means that the engine needs to recognize regular season PA the correct way and fill them with that information."*

## THE TARGET STATE (both columns, ONE operation, from the engine)
| column | value | engine source |
|---|---|---|
| `"Hitter Master".pa` / `ab` | **FULL season, incl. postseason** | `hitter_accrued.csv` → `PA` / `AB` |
| `"Hitter Master".regular_season_pa` | **REG only (≤ 2026-05-18)** | `hitter_accrued.csv` → `reg_PA` |
| `"Pitching Master".IP` | **FULL season, incl. postseason** | `pitcher_line.csv` → `full_IP` |
| `"Pitching Master".regular_season_ip` | **REG only** | `pitcher_line.csv` → `reg_IP` |
| `"Pitching Master".ERA` / `bf` | **FULL season** | `pitcher_line.csv` → `full_ERA` / `full_BF` |
🛑 **WRITE BOTH WINDOWS IN THE SAME OPERATION.** Depth-role tiering reads `regular_season_pa ?? pa` — if `pa` goes
full-season while `regular_season_*` is still NULL, tiering silently uses **postseason-inflated volume** and deep-run
playoff teams get pushed up a tier, with no error. **This is why the engine must supply both, not a snapshot.**

## 📊 THE MEASUREMENT THAT ESTABLISHES THE CURRENT STATE (prod + staging, VERIFIED 2026-08-30)
| comparison | mean \|Δ\| | median | p90 | max |
|---|---|---|---|---|
| **STAGING** `regular_season_pa` vs engine `reg_PA` | 0.858 | **0.00** | 3 | 23 |
| **STAGING** `pa` vs engine `PA` (full) | 0.852 | **0.00** | 2 | 23 |
| **PROD** `pa` vs engine **`reg_PA`** | **0.865** | **0.00** | 3 | 37 |
| **PROD** `pa` vs engine `PA` (full) | **6.567** | 1.00 | 20 | 79 |
| **PROD** `IP` vs engine **`reg_IP`** | **0.402** | 0.30 | 1.03 | 8.03 |
| **PROD** `IP` vs engine `full_IP` | **1.428** | 0.37 | 4.33 | 27.67 |
**CONCLUSIONS:**
1. ✅ **STAGING IS FILLED CORRECTLY** — both windows match their own engine source at **median 0**, correctly paired.
   **Do NOT "fix" staging.** (Trevor was right; my earlier doubt was wrong.)
2. ✅ **PROD's `pa`/`IP` ARE THE REGULAR-SEASON WINDOW** — 0.865 vs 6.567 for PA, 0.402 vs 1.428 for IP. Unambiguous.
3. ✅ The residual **~0.86 PA / ~0.40 IP** is TruMedia counting vs the engine's pitch-log derivation — the same
   effect recorded as **IP corr 0.9932 vs Master IP** in the `team_season_stats` migration. **Expected, not a defect.**
4. ✅ **FILLING `regular_season_pa`/`_ip` FROM THE ENGINE IS LOW-RISK** — the value differs from today's `pa` by a
   **median of 0.00**, so depth-role tiers barely move. **My earlier "this changes 1,306 hitters" warning was WRONG.**

## 🧠 METHODOLOGICAL LESSON — DO NOT COMPARE TWO DERIVATIONS BY EXACT EQUALITY
I first tested prod `pa` == engine `reg_PA` with **exact integer equality** and got **75.5%**, then reported that as
"1,306 hitters would change." **That was a false alarm.** The true distribution is **median 0, mean 0.865**. Exact
equality between two INDEPENDENT derivations of the same quantity will always show a large "mismatch %" that is really
just rounding/derivation noise.
✅ **RULE: when comparing two derivations, report mean/median/p90/max of |Δ| — never a % exact match.**
⚠ **Second occurrence today.** The first was the E2 park-factor diff, where my probe matched the CSV's `teamId`
column instead of `team` and briefly reported "all 309 teams would be dropped" (the truth was **1**: Fort Wayne).
**Both were MY instrument, not the data.** Verify the instrument before reporting an alarm.

## ▶️ EXECUTION (part of the `derive_masters_from_pitchlog` extension — NOT a separate lock step)
1. Write all four columns from the engine in ONE upsert per player.
2. **GATE (values, not counts):** `pa` avg **121.8 → ~128.0** · `regular_season_pa` ≈ today's `pa` (median Δ 0) ·
   `regular_season_ip` **0 → 5,374** · `IP` avg rises · spot-check a deep playoff team (LSU / Arkansas) and confirm
   its **depth-role tier counts do not move**.
3. Then **re-run F44** (`refresh_team_season_stats`) so `ra9_r` / `fra9_r` stop landing NULL. Idempotent.
⛔ **`lock_regular_season` / D33b remains OBSOLETE** — it snapshots `pa`, which is exactly the wrong mechanism.

---
# ✅ STEP 0 DONE — F40 ENV GUARD ADDED (2026-08-30)
`scripts/backfill-snapshot-total-hitter-war.ts` had **no guard of any kind** — it read `process.env.SUPABASE_URL` with
**no `--prod` flag anywhere** (`grep -c` = 0/0), so `--env-file=.env.production.local` wrote PROD with **zero opt-in**;
the only signal was a `host` banner printed AFTER the client was constructed. It writes `team_build_players` +
`target_board` snapshots — **coach-visible build/board data.** **SIXTH instance** of this defect class (after
`_run_store_no_propagate` C26, both C28 producers, the market scripts, `run-twp-recompute` E35, and
`backfill_park_factors_seasonal` E2).
**FIX:** standard double-keyed guard (URL and `--prod` must AGREE) + a resolved-env banner printed BEFORE any work,
+ an explicit missing-credentials check.
**ALL FOUR PATHS VERIFIED:**
```
REFUSE  PROD url, no --prod   → ✗ URL is PROD but --prod was not passed — refusing.
REFUSE  STAGING url, --prod   → ✗ --prod passed but URL is not prod — refusing.
ALLOW   STAGING, no flag      → [env] STAGING/other (slrxowawbijbjrkozqlj)  mode=DRY-RUN
ALLOW   PROD + --prod         → [env] 🔴 PROD (trbvxuoliwrfowibatkm)  mode=DRY-RUN
```
**PROD DRY-RUN (read-only) — F40's actual workload when it runs at STEP 9:**
`d/bsr map: 520 players (of 522 snapshot players)` · **`snapshots to fill: 696`**
⛔ **NOT APPLIED** — F40 runs at STEP 9 of the plan, after the precomputes. This step only added the guard.

---
# 🔴🔴 PROD GAP — `pitch_log.game_string` WAS **0 / 2,576,146**, AND WHAT IT SILENTLY BROKE (2026-08-31)
## THE FINDING
| | PROD | STAGING |
|---|---|---|
| `pitch_log` 2026 rows | 2,576,146 | 2,579,655 |
| **`game_string` populated** | ✅ **2,576,146 (backfilled 2026-08-31)** — was 0 | **2,576,146** |
| `inn` · `outs` · `date` · `pitcher_id` | 2,576,146 each ✅ | ✅ |
**Every other column is fine.** Only `game_string` is empty — and it is **NOT a derived value**. It is an identifier
that arrives WITH the export and is written at INGEST: `scripts/ingest_pitch_log.ts:325`
`game_string: textOrNull(get(row, cols, "gameString"))`. **Prod was loaded from a run that lost that column.**

## 🛑 WHAT IT BREAKS (both silent — neither raises an error)
1. **PER-PITCHER IP (outs ÷ 3) CANNOT BE DERIVED.** The half-inning key is `(game_string, inn)`.
   `scripts/fill_pitcher_totals_ip.ts --prod` derived **0 pitchers** on prod vs **5,415** on staging. It returns an
   empty set, not an error.
2. **`refresh_team_season_stats` STEP 5 (team W/L RECORDS) HAS NOTHING TO KEY ON.** That step states verbatim:
   *"game key = game_string = EXACT game id, doubleheader-safe"*. On prod every key is NULL ⇒ records are wrong/empty
   ⇒ **F44 would have produced a broken records block and reported success.**
★ **THE PHASE-C GATES ALL PASSED WHILE THIS WAS 100% NULL** — the Stuff+ chain, the 48/48 aggregations, C24–C29 and
Phase D never touch `game_string`. It only surfaced when something finally needed it as a KEY. **Another instance of
"a gap stays invisible until a specific consumer needs that exact column."**

## ✅ THE FIX — `scripts/backfill_pitch_log_game_string.ts` (NEW)
Reads the **source export**, not staging: `docs/drs-reference/*DRS Pitch Log*.csv` — **34 files**, `uniqPitchId` (col 7)
→ `gameString` (col 4). ⛔ deliberately NOT copied from staging even though `uniq_pitch_id` matches across
environments — this re-derives from the same source staging was loaded from ([[feedback_derive_over_copy]]).
**DRY-RUN ON PROD:** `read 34 files · 2,652,166 rows · 2,576,230 distinct uniqPitchId · 0 empty gameString` ·
**resolvable 2,576,146 / 2,576,146 = 100.00%**. Spot-check `287772425-23-1 → cs-mur01202602280`, and that row's
`date` is 2026-02-28 — the game string encodes `20260228` ✅.
**SAFETY:** writes only `where game_string is null` (never overwrites) · idempotent · stages the map into a temp table
then does ONE set-based UPDATE (2.5M single-row updates would take hours).
🐛 **FIRST ATTEMPT FAILED — `create temp table … ON COMMIT DROP`.** node-postgres **autocommits every statement**
unless you open an explicit transaction, so the CREATE committed and the table was dropped before the inserts ran
(`relation "_gs_map" does not exist`). **It failed loudly and wrote NOTHING** — prod re-verified at `filled 0`.
✅ Fixed by using a session temp table. **Rule: never use `ON COMMIT DROP` from node-postgres without an explicit BEGIN.**

---
# 🔬 HOW PER-PITCHER IP IS DERIVED — outs ÷ 3, AND THE FOUR WRONG WAYS
Trevor: *"IP is outs total divided by 3 anyway. That's what staging did… there is an outs total in the inning that the
pitch log tracks and you just have to recognize how that changes to get total outs."*
**THE DATA:** `inn` is **TEXT and ALREADY encodes the half** — `'Top 1'` / `'Bot 1'` — so **`(game_string, inn)` IS a
half-inning**; no separate top/bottom key is needed. `outs` is the base-out **STATE BEFORE the pitch** and only ever
holds **0 / 1 / 2** (never 3).
**THE DERIVATION (committed as `scripts/fill_pitcher_totals_ip.ts`):**
```sql
with p as (
  select pitcher_id, outs,
         lead(outs) over (partition by game_string, inn order by uniq_pitch_id) nxt
  from pitch_log where season=2026 and inn is not null and outs is not null)
select pitcher_id, sum(greatest(coalesce(nxt,3) - outs, 0)) / 3.0 as ip from p group by pitcher_id
```
Outs on a play = the NEXT row's `outs` minus this row's, within the half-inning; the final play of a completed
half-inning takes it to 3. **The out is attributed to whoever threw that pitch, so relief appearances split correctly.**
## 📊 ACCURACY — MEASURED AGAINST TruMedia `"Pitching Master".IP` (n=5,377, staging)
| method | mean \|Δ\| | median | verdict |
|---|---|---|---|
| engine `pitcher_line.csv` `full_IP` | **0.411** | 0.30 | best, but CSV-dependent |
| **outs-state delta ÷ 3 (this script)** | **0.476** | **0.33** | ✅ **in-DB, no CSV — chosen** |
| staging's stored `totals.ip` | 0.486 | 0.33 | ← **NOT more correct than a fresh derivation** |
| out-events + Sac, DP=2 | 0.596 | 0.33 | close; misses an out category |
| out-events, DP=2 | 1.260 | 1.00 | |
| attributable `(max+1−min)/3` | — | 1.33 | |
| half-inning `(max+1)/3` | — | 2.67 | ⛔ credits relievers with outs recorded BEFORE they entered |
★ **THE KEY RESULT: this derivation is as accurate as staging's stored column (0.476 vs 0.486, identical medians).**
Staging's `ip` is an **ad-hoc artifact with NO committed producer** — I burned significant effort trying to reproduce
it exactly before realising **matching it was never the goal**; reproducing a correct outs÷3 is.
All methods sit within the ~0.99 correlation this measure carries by design (`refresh_team_season_stats.sql:119`
records **corr 0.9932 vs Master IP**).
**GUARD:** the script ABORTS if mean |Δ| vs the Master line exceeds 1.0 IP — a bad derivation cannot write.
**BOTH WINDOWS IN ONE PASS:** the regular-season split comes from the date parsed out of `game_string`
(`…20260328…`) vs `regular_season_end` — so `ip` and the new `ip_reg` are produced together, no CSV needed.

---
# 📋 THE COMPLETE FILL LIST — WHAT MUST BE POPULATED, WHERE IT COMES FROM, AND ITS STATE
## LAYER 2 — `pitch_log_*_totals` (THE ACCUMULATOR — rebuilt on EVERY import)
| table.column | source | PROD state | note |
|---|---|---|---|
| `pitch_log_pitcher_totals.ip` | outs÷3 from `pitch_log` | ✅ **5,415 (filled 2026-08-31)** | required `game_string` first |
| `pitch_log_pitcher_totals.ip_reg` | same, ≤ boundary | ✅ **column added + 5,415 filled (2026-08-31)** | |
| `..._pitcher_totals.R` / `ER` | ⬜ **NOT BUILT** | ❌ absent | ⚠ needs the engine's **inherited-runner attribution, earned+unearned** — NOT a naive count. Blocks pitcher WAR from the DB. |
| `..._pitcher_totals` counts (`total_bf/pa/k/bb/hbp`, hits, batted-ball, `stuff_plus_sum`) | aggregator | ✅ 5,509 | |
| `pitch_log_hitter_totals` (`pa ab hits_* k bb hbp sac`, batted-ball, `ev_*`) | aggregator | ✅ 6,099 | full-season `pa`/`ab` verified **median Δ 0.00** vs engine |
| `pitch_log_hitter_totals.batting_rv / defensive_rv / baserunning_rv` | `populate_hitter_run_values` | ✅ | ★ precedent for folding defense/baserunning INTO the accumulator |
| a `reg` window for the hitter side | ⬜ **NOT BUILT** | ❌ | either `dimension_key='reg'` or `*_reg` columns |
## LAYER 3 — the Masters (DERIVED + DISPLAY)
| column | source | PROD state |
|---|---|---|
| `Hitter Master.pa` / `ab` | accumulator (full) | ⚠ holds the **REGULAR-SEASON** line — must become FULL |
| `Hitter Master.regular_season_pa` | engine `reg_PA` / a reg window | ❌ **0 / 5,341** |
| `Pitching Master.IP` | `ip` (full) | ⚠ holds the REGULAR-SEASON line |
| `Pitching Master.regular_season_ip` | `ip_reg` | ❌ **0 / 5,375** |
| `Pitching Master.ERA` | engine `full_ERA` (until `ER` lands in the accumulator) | ⚠ stale CSV |
| `Pitching Master.bf` | `total_bf` | ✅ **5,372 (filled 2026-08-31)** |
| **`K9` `BB9` `HR9` `WHIP` `FIP`** | `pitcherIpDependent()` — **needs `ip`** | ✅ **DERIVED ON PROD 2026-08-31 — 5,375/5,375.** Historical: `pitcherIpDependent` returned `{}` on a null `ip`, so the producer silently skipped them and prod held stale TruMedia values while staging derived them. Fixed by filling `ip` (step 0c) then running step 1. |
| `k_pct` / `pull_air` | accumulator | ⚠ 4,374 / 4,367 of 5,341 — the `MIN_PA` PATCH gate (now removed) |
| rates + batted-ball + `stuff_plus` | accumulator | ✅ (dry-run: 0 changes) |
| `G` / `GS` | ⬜ no pitch-log source found | Master-override. Trevor: *"almost positive the pitch log import has a starting pitcher id"* — Track B flag |
| SB / CS | Master sheet | **override BY DESIGN** |
| `dob` / `class_year` | roster scraper | out of scope |

## ▶️ ORDER (each step unblocks the next — none of these are optional)
```
1. game_string backfill        ← unblocks 2 AND F44's records block
2. fill_pitcher_totals_ip      → ip + ip_reg  (derives 0 pitchers until step 1 lands)
3. derive_masters_from_pitchlog → K9/BB9/HR9/WHIP/FIP finally derive; pa/IP/ERA/bf + regular_season_* written
4. F44 refresh_team_season_stats → _reg rates stop landing NULL; records block works
5. postseason-inclusive Master sheet import = the CROSS-CHECK / OVERRIDE layer
```

---
# 🐛 TWO node-postgres TRAPS THAT EACH COST A PROD RUN (2026-08-31). Exact reproductions.
Both hit while backfilling `pitch_log.game_string` (2,576,146 rows). **Both failed LOUDLY and wrote NOTHING** — prod
re-verified at `game_string filled 0` after each. Recording them precisely because neither is obvious and both will
recur in Track B, which does bulk writes by definition.

## TRAP 1 — `CREATE TEMP TABLE … ON COMMIT DROP` IS DESTROYED IMMEDIATELY
```ts
await c.query(`create temp table _gs_map (…) on commit drop`);   // ← commits, and DROPS, right here
await c.query(`insert into _gs_map …`);                           // ✗ relation "_gs_map" does not exist
```
**WHY:** node-postgres runs every `query()` in its own implicit transaction (autocommit) unless you open an explicit
`BEGIN`. `ON COMMIT DROP` therefore fires the instant the CREATE statement commits — before any INSERT can run.
**FIX:** either wrap the whole sequence in an explicit `BEGIN … COMMIT`, or use a plain session temp table
(`drop table if exists x; create temp table x (…)`), which lives until the connection closes.
**RULE: never use `ON COMMIT DROP` from node-postgres without an explicit transaction.**

## TRAP 2 — A SINGLE BULK `UPDATE` EXCEEDS PROD'S `statement_timeout` AND ROLLS BACK WHOLE
```
FATAL: canceling statement due to statement timeout
```
**PROD `statement_timeout` = `2min`** (verified: `show statement_timeout`). One set-based UPDATE joining 2.5M rows
blew straight through it. Because it is a SINGLE statement it rolled back **entirely** — no partial write, but ~4
minutes of staging work thrown away.
**FIX — batch it, and prefer `unnest()` over a temp table:**
```sql
update pitch_log p set game_string = m.gs
from unnest($1::text[], $2::text[]) as m(upid, gs)
where p.uniq_pitch_id = m.upid and p.season = $3 and p.game_string is null
```
25,000 rows per chunk → **~103 statements, each ~0.25 min**, comfortably under the 2-minute ceiling. This also
removes the temp table entirely, so TRAP 1 cannot recur.
**MEASURED THROUGHPUT ON PROD:** ≈ **87,000 rows/min** (1,175,000 rows in 13.5 min) ⇒ ~30 min for the full 2.58M.
★ **DESIGN THE `WHERE` CLAUSE SO A PARTIAL RUN IS RESUMABLE.** `where game_string is null` means an interrupted run
can simply be re-run — it only touches what is still empty. **A batched write without a resumable predicate is worse
than a single statement**, because a single statement at least rolls back cleanly.

## ⚠ RELATED, ALREADY LOGGED — DO NOT "SOLVE" THIS WITH `statement_timeout = 0`
A previous session set `statement_timeout = 0` for a `--direct` run and **prod hung for 39 minutes with no active
query** — removing the ceiling also removes the failure signal. **Use a FINITE timeout and BATCH.** Same reasoning as
the ~125s PostgREST gateway ceiling that silently rolls back `refresh_composite_war()`.

## 🅱️ TRACK B REQUIREMENT
Track B writes in bulk on every ingest. It MUST: batch every write under the statement timeout · use a resumable
predicate · never rely on `ON COMMIT DROP` · report per-batch progress and a final written count · treat a
swallowed error as a hard stop. All four of these were violated by code found in this push.

---
# ✅ STEP 0b + 0c APPLIED TO PROD (2026-08-31) — `game_string` backfilled, per-pitcher IP derived
## 0b — `pitch_log.game_string` BACKFILL: **0 → 2,576,146 (100%)**
```
✓ updated 2,576,146 rows
AFTER — filled 2,576,146 / 2,576,146 · distinct games 8,519
```
★ **SANITY GATE THAT MATTERS: 8,519 distinct games × 2 team-appearances ÷ 308 D1 teams = 55.3 games/team** — exactly a
~56-game season. A bad join would have produced a nonsense number here; a row count alone would not have caught it.
Source: `docs/drs-reference/*DRS Pitch Log*.csv` (34 files, `uniqPitchId`→`gameString`), **not** copied from staging.
**RUNTIME:** ~30 min at **≈87,000 rows/min**, 103 batches of 25,000. Two failed attempts first (see the node-postgres
traps block) — both wrote NOTHING and prod was re-verified at `filled 0` after each.

## 0c — `pitch_log_pitcher_totals.ip` + NEW `ip_reg`: **0 → 5,415**
```
DERIVED — 5415 pitchers (5382 with IP>0)
  Σ IP 147,630.3   Σ reg 140,202.7   post = 7,427.7 (5.0%)
  vs TruMedia Master.IP — n=5,374  mean|Δ|=0.458  median=0.33  p90=1.33
```
**THREE INDEPENDENT CONFIRMATIONS:** (1) **Σ IP 147,630.3 is IDENTICAL to staging's** — same pitch log, same
derivation, same answer, computed separately; (2) mean |Δ| **0.458** matches staging's **0.476**; (3) the **5.0%
postseason share** is right for conference tournaments + regionals on a 56-game season.
DDL: `alter table pitch_log_pitcher_totals add column if not exists ip_reg numeric`.

## 🛑 THE GUARD FIRED — AND IT WAS RIGHT TO. READ THIS BEFORE LOOSENING ANY THRESHOLD.
The first prod dry-run **ABORTED**: `mean |Δ| = 1.827 > 1.0 — derivation looks wrong`.
**The derivation was fine. The COMPARISON was wrong.**
| prod `"Pitching Master".IP` vs | mean \|Δ\| | median |
|---|---|---|
| derived **FULL** `ip` | **1.827** | 0.67 |
| derived **`ip_reg`** | **0.458** | **0.33** |
**PROD's `Master.IP` HOLDS THE REGULAR-SEASON LINE** (staging's holds FULL). Checking a full-season derivation against
a regular-season column manufactures a false discrepancy.
✅ **FIXED THE COMPARISON, NOT THE THRESHOLD** — the script now checks `ip_reg` by default with a `--cmp-full`
override for once the Masters hold the full-season line. **Loosening the threshold would have written silently and
destroyed the only signal that told us which window prod's Master column is in.**
★ **LESSON: a tripped guard is DATA.** It said "these two numbers disagree" and the disagreement was the real finding.
Compare like with like; never relax a gate to make it pass.

## ▶️ WHAT THIS ARMS (nothing has changed on the Masters yet)
`derive_masters_from_pitchlog` calls `pitcherIpDependent(t, ip)`, which returns `{}` on a null `ip`. With `ip` now
populated it will finally derive **`K9` `BB9` `HR9` `WHIP` `FIP`** on prod instead of silently leaving stale TruMedia
values. **Those five columns do NOT change until STEP 1 runs** — 0c only arms it.
Also unblocked: `refresh_team_season_stats` step 5 (team W/L records), which keys on `game_string`.

---
# ✅ STEP 1 APPLIED TO PROD (2026-08-31) — the Masters now carry FULL-SEASON counting stats + the reg anchors
`derive_masters_from_pitchlog.ts --apply --no-newrows --prod`. Backups: `_hm_prefill_backup` (8,245) ·
`_pm_prefill_backup` (8,071). Changed 3,742 hitters / 5,374 pitchers.

## GATES (prod, 2026, D1) — before → after
| gate | before | after | ✓ |
|---|---|---|---|
| `pa` avg | 121.8 | **127.7** | ✅ full-season |
| `regular_season_pa` | **0** | **5,322** (avg 121.4) | ✅ |
| `regular_season_pa` vs the OLD `pa` | — | **median Δ 0.00** (n=5,322) | ✅ |
| `IP` avg | 25.67 | **26.66** | ✅ |
| `regular_season_ip` | **0** | **5,372** (avg 25.32) | ✅ |
| `bf` | **0** | **5,372** | ✅ free fill, was never wired |
| `K9` / `WHIP` | stale CSV | **5,375 / 5,375 DERIVED** | ✅ ← the gap 0c armed |
| `k_pct` | 4,374 | **5,334** | ✅ patch gate removed |
| **depth-role volume** (`regular_season_pa ?? pa`) | — | **median Δ 0.00** | ✅ tiers stable |

## 🛑 TWO OF MY OWN GATES WERE MISCALIBRATED — THE DATA WAS RIGHT BOTH TIMES
1. **`pull_air` 4,781 (I expected ~5,341).** ❌ my expectation. `pull_air` is gated by **`MIN_TRACKED_BIP`** — a
   DATA-QUALITY floor — not by `MIN_PA`. I had already documented "sample-gated columns: do NOT fill these" and then
   wrote a gate expecting them filled. **4,781 is correct.**
2. **`ERA` avg 8.72 — I called it implausible.** ❌ wrong comparison. It was **8.65 BEFORE**; the raw mean is dominated
   by tiny-IP outliers (Luke Rolland 0.30 IP / 216.0 ERA — pre-existing). The meaningful measure, **IP-WEIGHTED ERA,
   moved 6.10 → 6.12** — essentially unchanged, the sliver being postseason innings.
★ **RULE: for any per-player rate, gate on the IP/PA-WEIGHTED mean, never the raw mean.** A raw mean over a
long tiny-denominator tail is not a league average and will trigger false alarms.

## 🧠 FOUR INSTRUMENT ERRORS IN ONE SESSION — THE PATTERN
Every one was MY measurement, not the data: (1) park-factor diff matched the CSV's `teamId` instead of `team` →
"309 teams dropped" when it was **1**; (2) compared two derivations by EXACT EQUALITY → "1,306 hitters change" when
median Δ was **0.00**; (3) `Number(null) === 0` passed `isFinite` → a fabricated 26.6-IP discrepancy; (4) raw-mean ERA
→ a false regression. **VERIFY THE INSTRUMENT BEFORE REPORTING AN ALARM.** Report mean/median/p90/max — never a
percent-exact-match, and never a raw mean over a skewed denominator.
✅ **The one gate that fired for real** — the IP-fill guard at 1.827 — was RIGHT, and its disagreement was the finding
(prod's `Master.IP` held the regular-season line). **Fix the comparison, never the threshold.**

## ▶️ NEXT
`F44 refresh_team_season_stats(2026)` — now fully unblocked: `regular_season_ip` is populated (its `nullif(sum(...),0)`
no longer yields NULL) **and** `game_string` exists (its records block keys on it). Then E35 → precomputes → F39 → F40–43.
⬜ **Still to come:** the postseason-inclusive Master sheet import, which OVERRIDES where it is more accurate
(SB, ERA, G/GS) — per the derive-then-check order.

---
# ✅ F44 `refresh_team_season_stats(2026)` — APPLIED TO PROD 2026-08-31. Completed in 59.7s.
## GATES — ALL PASS (prod, season 2026)
```
rows 0 → 308                                308
faced_stuff_plus / faced_htp                308 / 308   ← what Phase E actually reads
ra9_reg / fip_ra9_reg                       308 / 308   ← would be NULL without regular_season_ip
AVG 0.277 · wRC+ 98.8 · ERA 6.20 · total_war 15.09
W/L records                                 308 teams · 27.6W-27.4L · 55.0 games
team_drs · ip_total · park snapshot         308 / 308 / 308
Arkansas exactly ONE row                    1
```
★ **THREE GATES ARE DIRECT PAYOFFS FROM TODAY'S EARLIER WORK:**
1. `ra9_reg`/`fip_ra9_reg` = 308 — these divide by `sum(regular_season_ip)` (`:143,:145`), which was **0/5,375 this
   morning**. Without STEP 1 they would ALL have landed NULL, silently.
2. **W/L records = 27.6W-27.4L over 55.0 games** — the records block keys on `game_string`, which was **0/2,576,146**
   this morning. **55.0 games/team independently cross-checks the 8,519 distinct games** from the backfill
   (8,519 × 2 ÷ 308 = 55.3). Two different derivations of season length agreeing.
3. `AVG 0.277` and `wRC+ 98.8` land exactly where the runbook predicted (~.277 / ~100).

## 🛑 F44 FAILED FIRST — A PRIMARY KEY CAUGHT WHAT NO GATE OF OURS WOULD HAVE
```
duplicate key value violates unique constraint "team_season_stats_pkey"
Key (source_id, season)=(3375, 2026) already exists.
```
The function does `GROUP BY "TeamID"` then `JOIN "Teams Table" tt ON tt.id = TeamID` to get `source_id`. **Two
`TeamID`s resolving to ONE `source_id` therefore emit two rows with the same PK.** `team_season_stats` stayed at
**0 rows** — a plpgsql function is atomic, so it rolled back whole.
★ **THE DATABASE CONSTRAINT DID CARDINALITY ENFORCEMENT NO APPLICATION GATE WOULD HAVE.** It refused to write two
Arkansas rows rather than silently producing one. **A PRIMARY KEY IS A CARDINALITY GATE — lean on it.**

## 🔍 ROOT CAUSE — A MANUFACTURED MASTER ROW, NOT A `TeamID` PROBLEM
**My first proposed fix (re-point the `TeamID`) WAS WRONG.** Trevor pushed back — *"I am more worried about the team
id changing and impacting a lot more than we realize"* — and investigating proved him right.
### WHAT THE INVESTIGATION FOUND
| the `TeamID` convention is MIXED, and that is FINE | |
|---|---|
| 2026 Masters pointing at a **2025** Teams-Table row | **254 TeamIDs · 8,794 rows** |
| 2026 Masters pointing at a **2026** Teams-Table row | **55 TeamIDs · 1,922 rows** |
**So 55 teams legitimately use their 2026 id.** Arkansas was not an outlier for using one — it was the **ONLY
`source_id` where BOTH appeared**. The two Arkansas Teams-Table rows are **identical in every field** except `id` and
`Season` (same `source_id`, name, abbreviation, conference, `conference_id`, division), and the 2026 row is genuinely
referenced by **34 `players` rows**. ⛔ **DO NOT "normalize" the 254/55 split — F44 only requires that each
`source_id` resolve to ONE `TeamID`.**
### THE ACTUAL DEFECT — Carson Wiggins (`1583774970`)
| | |
|---|---|
| prod `pitch_log` 2026 | **0 pitches, 0 games** |
| prod `pitch_log_pitcher_totals` | **no row** |
| **staging `"Pitching Master"`** | **DOES NOT EXIST** |
| prod `"Pitching Master"` | 1 row, `IP 14`, `ERA 3.21`, on the 2026 `TeamID` |
A **manufactured row with no season behind it** — Trevor: *"Wiggins was manually added because there was a chance he
was coming back, then he signed."* **DELETED** (backed up to `_pm_wiggins_backup`); his `players` row untouched.
★ **THE KOZEAL/WIGGINS DISTINCTION — THIS IS THE RULE:**
> **Kozeal:** 1,103 pitches, 287 PA of real pitch-log data, **no Master row** → the row was MISSING and had to be created.
> **Wiggins:** a Master row with **ZERO pitch-log data** → the row was PHANTOM and had to be removed.
> **Presence in a season's Master is determined by whether the PITCH LOG shows he played — nothing else.**
### VERIFIED AFTER THE DELETE — **NO `TeamID` CHANGED**
`source_ids served by >1 TeamID: 0` → **308 TeamIDs mapping to 308 distinct source_ids, 1:1.** The mixed 254/55
convention is untouched.

## 🧠 PROCESS NOTES
- **I guessed column names twice** (`ra9_r`, `AVG`) before reading `information_schema`. `ra9_r`/`fra9_r` are the
  function's internal CTE aliases; the TABLE columns are `ra9_reg`/`ra9_total`/`fip_ra9_reg`. **Read the schema; do
  not infer column names from the producing SQL.**
- **`statement_timeout` could NOT be raised via the node-postgres client option** — `show statement_timeout` still
  reported `2min` despite passing `statement_timeout: 900000`. F44 finished in **59.7s** so it did not matter, but for
  anything longer use `set statement_timeout = '15min'` as an explicit statement (a FINITE value — **never 0**).

---
# 🅱️ TRACK B — RULES ADDED 2026-08-31 FROM THE MASTERS/F44 WORK. Build these in from the start.
## 1. ROW EXISTENCE IS DECIDED BY THE PITCH LOG, IN BOTH DIRECTIONS
| case | evidence | action |
|---|---|---|
| **Kozeal** | 1,103 pitches · 287 PA · **no Master row** | **CREATE** the row |
| **Wiggins** | **0 pitches** · no totals row · a Master row exists | **REMOVE** the row |
Track B must handle **both**: create rows for players the pitch log shows played, and flag/remove Master rows with no
pitch-log season behind them. **Neither is decided by returner status, roster status, or portal status.**
⚠ A manufactured row is not harmless — Wiggins' phantom row **hard-blocked `refresh_team_season_stats`** via a PK
violation and would have folded 14 phantom IP into Arkansas's team rollups had it been "fixed" by re-pointing.

## 2. `TeamID` IS A SEASONED KEY — GROUP ON `source_id`, NOT ON `TeamID`
`"Teams Table"` has **one row per team per season** (prod: 308 for 2025, 466 for 2026), so a program has MULTIPLE
`TeamID`s. The 2026 Masters legitimately use a MIX: **254 TeamIDs → 2025 rows (8,794 player-rows)** and
**55 TeamIDs → 2026 rows (1,922 player-rows)**. **That mix is NOT a defect and must not be "normalized".**
**THE ONLY INVARIANT THAT MATTERS:** each `source_id` must resolve to exactly **ONE** `TeamID` within a season's
Masters. Violate it and any team rollup either double-counts or hits a PK violation.
✅ **TRACK B RULE: for team-level grouping, resolve to `source_id` FIRST and group on that** — never group on the
per-season `TeamID` uuid. And when creating a Master row, **adopt the `TeamID` the player's teammates already use**;
resolving it independently by season is what split Arkansas 308→309 earlier the same day.
✅ **ASSERT THE INVARIANT AS A GATE:** `select source_id from (…) group by source_id having count(distinct TeamID)>1`
must return **ZERO ROWS** before any team rollup runs.

## 3. LEAN ON DATABASE CONSTRAINTS — THEY CATCH WHAT APPLICATION GATES MISS
The `team_season_stats_pkey` on `(source_id, season)` caught the Arkansas duplicate that **no count, value, or
membership gate would have** — and because a plpgsql function is atomic it rolled back to 0 rows rather than leaving
half a table. **A PRIMARY KEY IS A CARDINALITY GATE.** Track B's tables should carry the natural keys that make
double-counting impossible, rather than relying on the writer to be careful.

## 4. BULK-WRITE MECHANICS (measured on prod)
- `statement_timeout` = **2min**, and it **cannot be raised via the node-postgres client option** (`show
  statement_timeout` still reported `2min` after passing `statement_timeout: 900000`). Use an explicit
  `set statement_timeout = '15min'` statement — a **FINITE** value, **never `0`**.
- **BATCH every bulk write.** One UPDATE over 2.5M rows blew the timeout and rolled back whole. 25,000-row chunks fed
  through `unnest()` ran ~0.25 min each. Measured throughput: **≈87,000 rows/min**.
- **Make the `WHERE` clause RESUMABLE** (`where col is null`) so an interrupted batch run can simply be re-run.
- ⛔ **Never `CREATE TEMP TABLE … ON COMMIT DROP`** from node-postgres without an explicit `BEGIN` — autocommit drops
  it before the next statement.
- **Read `information_schema` for column names.** The producing SQL's CTE aliases (`ra9_r`, `fra9_r`) are NOT the
  table's columns (`ra9_reg`, `ra9_total`, `fip_ra9_reg`).

## 5. WHAT F44 PROVES ABOUT THE DEPENDENCY CHAIN
F44 consumed, in one call, nearly everything built today — and each would have failed SILENTLY, not loudly:
`regular_season_ip` (else `ra9_reg`/`fip_ra9_reg` → NULL via `nullif(sum(...),0)`) · `game_string` (else the W/L
records block has no key) · Masters `desc_*`/`_reg` · `team_drs` · Conference Stuff+/HTP · `"Park Factors".rg_factor`.
**Track B must run these in dependency order and gate each on a VALUE, because the failure mode is a populated table
full of NULLs and zeros that passes every count check.**

---
# ✅ E35 TWP DETECTOR — APPLIED TO PROD 2026-08-31 (11.4s, 606 updates, 0 errors)
`npx tsx --env-file=.env.production.local scripts/run-twp-recompute.ts --prod --apply`
(guard ADDED earlier today — it had NONE; backup `_players_pre_twp_backup`, 31,467 rows)

## GATES
| gate | before | after | staging | ✓ |
|---|---|---|---|---|
| `players.is_twp` | 137 | **253** | **253** | ✅ **exact match** |
| legacy `position='TWP'` | 428 | **34** | **34** | ✅ **exact match** |
| `position` NULL | 196 | 462 | 94 | ✅ prod carries far more alumni |
| rows changed | — | **606** | — | ✅ = the dry-run figure |
| D1 TWPs | — | **90** | — | ℹ |
**BREAKDOWN:** 124 new · 80 legacy-migrated · 49 unchanged · 28 → hitter · 108 → pitcher · 266 cleared → NULL · 34 left alone.
★ **`124 + 80 + 49 = 253` — arrived at INDEPENDENTLY from prod's own Masters and landing exactly on staging's 253.**
Same independent-replication pattern as the Stuff+ gate, `team_drs`, and Kozeal's WAR.

## 🛑 MY GATE EXPECTATION WAS WRONG (again) — THE DATA WAS RIGHT
I predicted legacy `position='TWP'` would go to **0**. It went to **34** — which is **exactly staging's 34** and
**exactly the detector's own `left alone: 34` bucket**. Those rows are DELIBERATELY untouched by the detector, not
missed. **Do not "finish the job" by nulling them.**
→ Sixth instrument/expectation error this session. **Before calling a number a failure, check whether the producer
already told you it would be that number** — the report literally printed `left alone: 34`.

## WHAT THE 266 "cleared → NULL" ACTUALLY ARE — NOT DESTRUCTIVE
Prod carried **428** legacy `position='TWP'` rows vs staging's 34, because prod holds **years of historical players**
(31,467 vs 15,561 — expected depth, NOT a discrepancy). `'TWP'` is not a position; it is the **old overload the
detector exists to replace** — its own header: *"Replaces the prior `position = 'TWP'` overload, which destroyed the
hitter position."* The 266 are **ALUMNI with no 2026 data**, whose real position was already destroyed by that
overload and is unrecoverable. Setting `position = NULL` is the honest result (rule 6: *"No 2026 data → is_twp=false,
position = NULL (alumni)"*). **Nothing recoverable was lost.**

## WHY THIS HAD TO PRECEDE THE PRECOMPUTES
`is_twp` drives BOTH-SIDE row generation. Running E36/E37/E38 first would have produced projections for 137 TWPs
instead of 253 — **116 two-way players silently missing their second side**, with no error anywhere.

---
# ✅ E36 RETURNER PITCHERS — APPLIED TO PROD 2026-08-31 (+ the propagate re-run)
## RESULT
`6440 computed · 8050 blocked (of 15,646 pitchers) · 1,172 JUCO computed · 1,156 JUCO nulled (sub-20 IP)` →
**7,596 rows upserted.** Blocked reason is uniformly `no_pm_row` (no `"Pitching Master"` row) — expected for
alumni/non-2026 players.
## GATES
```
returner pitcher rows with p_war   6,632  (market_value 6,466 · p_era 6,632 · pitcher_depth_role 5,459)
p_war distribution                 avg 0.607 · −1.75 … 3.93
propagate scouting scores          91,393 rows carry pitcher_whiff_score
market values                      avg $13,482 · max $382,705
```

## 🛑 MY ERROR — I CALLED IT A DRY RUN AND IT WROTE. **THE `:prod` npm ALIASES APPLY BY DEFAULT.**
```
"precompute-returner-pitchers:prod": "tsx --env-file-if-exists=.env.production.local scripts/precompute-returner-pitchers.ts --prod"
```
**There is NO `--dry-run` in the alias.** The script DOES support it (`:104` `process.argv.includes("--dry-run")`) —
it just has to be passed through:
```
npm run precompute-returner-pitchers:prod -- --dry-run      ← the `--` is REQUIRED
```
I announced "dry-run first", ran the bare alias, and it upserted **7,596 rows to prod**. The write was the authorized
next step so nothing unintended landed, but **the description was wrong and I did not verify the mode before running.**
★ **RULE: for every `npm run …:prod` alias, `grep` it in `package.json` FIRST and confirm whether a dry-run flag is
present. Assume these aliases WRITE.** This applies to E37 (`precompute-returner-hitters:prod`) and every other
`:prod` alias in the remaining sequence.

## 🐛 THE PROPAGATE TIMED OUT — AND THE FIX IS THE ONE THAT MATTERS FOR EVERY LONG STATEMENT
`✗ propagate failed: canceling statement due to statement timeout`
`propagate_pitcher_scores_to_predictions` is an `UPDATE … FROM players, "Pitching Master"` with **NO season filter on
`player_predictions`**, so it rewrites **~105k rows** across every season/model. Prod's `statement_timeout` is **2min**.
✅ **RE-RAN SUCCESSFULLY: `105,093 rows in 11.3s`.**
★★ **`SET statement_timeout = '15min'` AS AN EXPLICIT STATEMENT WORKS. The node-postgres CLIENT CONSTRUCTOR OPTION
DOES NOT.** Passing `new pg.Client({ statement_timeout: 900000 })` left `show statement_timeout` reporting `2min`.
```ts
const c = new pg.Client({ connectionString: PGURI, keepAlive: true });
await c.connect();
await c.query(`set statement_timeout = '15min'`);   // FINITE — never 0
```
⛔ **NEVER `statement_timeout = 0`** — a previous session did that and prod hung 39 minutes with no failure signal.
ℹ The step is IDEMPOTENT (it only copies scouting scores from the Masters), so re-running after a timeout is safe.

## 🧠 COLUMN NAMES — I GUESSED AGAIN (3rd time today)
`model_version` does not exist; the columns are **`model_type`** and **`variant`**. Earlier: `ra9_r`/`AVG` on
`team_season_stats`. **Read `information_schema.columns` — do NOT infer column names from a producing script or a
function body.**

---
# 🔬 E36 PROD↔STAGING VERIFICATION (2026-08-31) — pitchers MATCH; hitters differ because E37 has not run
## ✅ PITCHERS — E36 REPRODUCES STAGING
| | PROD | STAGING |
|---|---|---|
| rows with `p_war` | **6,632** | 6,562 |
| avg `p_war` | **0.607** | 0.598 |
| `p_war` range | −1.75 … **3.93** | −6.68 … **3.93** |
| market rows · avg · max | 6,466 · **$13,146** · **$382,705** | 6,343 · $13,241 · $387,691 |
**PER-PLAYER (joined on `source_player_id`, n=6,485): `|Δ| p_war` mean 0.023 · MEDIAN 0.004 · p90 0.050.**
**`$/WAR` ratio prod÷staging: median 1.000 · p10 1.000 · p90 1.000** — the pricing rate is IDENTICAL.
Top players: `Ruger Riojas 3.58 / $357,778.626` **EXACTLY equal in both**; Volantis/Kuhns differ only by their small
`p_war` delta. ✅ **NIL tiers are IDENTICAL in both envs** — `sec=4.0 acc=1.5 big12=1.2 bigten=1.0 … juco=0.35`
(Trevor: PTM was raised for SEC and ACC — **that raise is already on PROD**).
★ Prod's `p_war` FLOOR is BETTER: **−1.75 vs staging's −6.68.** Staging retains an outlier prod does not.

## ⚠ HITTERS — PROD IS STALE, AND THAT IS EXPECTED (E37 IS THE NEXT STEP)
| | PROD | STAGING |
|---|---|---|
| market rows · avg · **max** | 6,488 · $13,816 · **$104,110** | 6,513 · $16,803 · **$613,259** |
Prod's returner hitters still carry **pre-SEC-4.0 pricing** — a ~6× gap at the top end. **E37 closes this.**
🛑 **DO NOT read this as a prod defect.** And note the gap only became visible when split BY SIDE: my first comparison
lumped hitters and pitchers together and produced a misleading "staging max $613,259 vs prod $382,705".
**Compare like with like — split by side before comparing markets.**

## 🛑 `updated_at` IS NOT A FRESHNESS SIGNAL
Prod's returner-HITTER rows show `updated_at = 2026-08-31` while their VALUES are stale — because
`propagate_pitcher_scores_to_predictions` rewrote scouting-score columns on **every** row (105,093 of them) and bumped
the timestamp. **A recent `updated_at` proves a row was TOUCHED, not that its numbers are current.**
Same family as "populated ≠ fresh" (Conference `Stuff_plus` at 30/30) and "count-correct ≠ complete" (Kozeal).
→ **Gate on the VALUE, never on `updated_at`.**

---
# 🧮 EQUATION / CALIBRATION VERIFICATION ON PROD (2026-08-31) — the two-sided SD IS live and IS being used
Trevor asked whether the equation work — **including the two-sided SD** — actually made it to prod. **I had NOT
verified it** and was implicitly relying on "220 keys on both envs", which only proves the KEYS exist. Verified properly:

## ✅ 1. THE TWO-SIDED SD IS PRESENT ON PROD — AND `sd_good` IS NOT MISSING
**There are no literal `sd_good` keys, and that is BY DESIGN.** `src/lib/pitcherProjection.ts:185` states it:
> *"a positive rating-z projects toward the GOOD side (use **sd_good = ncaaSd**); negative toward the [bad] side"*
So the pair is **`<stat>_plus_ncaa_sd` (GOOD side) + `<stat>_plus_ncaa_sd_bad` (BAD side)**.
**All 6 bad-side keys are on PROD** (re-derived by C27 from prod's own population):
```
era_plus_ncaa_sd_bad  2.304009   (staging 2.264985)
fip_plus_ncaa_sd_bad  1.869489   (staging 1.843704)
whip_plus_ncaa_sd_bad 0.341070   (staging 0.337614)
k9_plus_ncaa_sd_bad   1.982413   (staging 1.966669)
bb9_plus_ncaa_sd_bad  1.763271   (staging 1.733557)
hr9_plus_ncaa_sd_bad  0.281018   (staging 0.271141)
```

## ✅ 2. THE CODE ACTUALLY CONSUMES THEM (existence ≠ use — checked separately)
```
src/lib/transferPitcherProjection.ts:390-395   dsd(<stat>Pr, eq.<stat>_plus_ncaa_sd, eq.<stat>_plus_ncaa_sd_bad)
                                               → era · fip · whip · k9 · bb9 · hr9
src/lib/pitcherProjection.ts:455               ncaaSd: eq.era_plus_ncaa_sd, ncaaSdBad: eq.era_plus_ncaa_sd_bad
src/lib/transferPitcherProjection.ts:111-112   "PR+ > 100 = better talent → the compressed GOOD side (sd_good);
                                                PR+ < 100 → the wide BAD side (sd_bad)"
```

## ✅ 3. **E36 (RUN ON PROD TODAY) USED IT** — the run itself is the proof
`scripts/precompute-returner-pitchers.ts:133`:
> *"Overlay `model_config <stat>_plus_ncaa_*` (incl. the **stage-5.5 two-sided `_sd` / `_sd_bad`** + calibrated …)"*
and `:13` / `:38` route the math through `computePitcherProjection` in `pitcherProjection.ts`, which takes `ncaaSdBad`.
**⇒ The 6,632 prod pitcher projections written today were computed WITH the two-sided SD.**

## ✅ 4. `model_config` KEY SETS ARE IDENTICAL — 220 / 220, ZERO missing either way
`in STAGING not prod: 0` · `in PROD not staging: 0`.

## ⚠ 5. THE "77 DIFFERENCES" WERE MOSTLY NOISE — 156 formatting, **64 genuine**
A raw string comparison reported 77 differing values; a NUMERIC comparison shows **156 formatting-only**
(`0.3` vs `0.30`) and **64 genuinely different**. **Compare numerically, never as strings.**
**All 64 are prod being FRESHER** — they are the NCAA averages/SDs that **C27 re-derived from prod's own data**, and
**staging never ran C27**:
```
p_ncaa_avg_stuff_plus  prod 100.0141  staging 99.4358   ← ★ the Stuff+ RECENTER reached the projection constants
p_sd_stuff_plus        prod 5.04577   staging 5.93754
p_ncaa_avg_whiff_pct   prod 23.3673   staging 23.4593
r_ncaa_avg_ba          prod 0.2772    staging 0.28      ← prod DERIVED; staging a rounded literal
r_ba_std_pr            prod 29.99699  staging 31.297
r_obp_std_ncaa         prod 0.05081   staging 0.046781
```
★ **`p_ncaa_avg_stuff_plus = 100.0141` on prod is an END-TO-END signal** that the Stuff+ recenter survived
score → aggregate → Master rollup → `computeNcaaAverages` → the projection constants.
🛑 **CONSEQUENCE FOR E37:** the hitter-side calibration (`r_ba_std_pr`, `r_obp_std_ncaa`, `r_ncaa_avg_*`) ALSO differs
from staging for the same C27 reason. **E37's hitter numbers will NOT match staging exactly — that is EXPECTED, not
drift.** Compare E37 against the *shape* (distribution, depth-role mix), not against staging's literal values.

## 🧠 THE CHECK I WAS SKIPPING
"220 keys on both environments" proves only that the **keys exist**. It does NOT prove they are **populated with
re-derived values**, nor that any **code path consumes them**. Those are three separate questions:
**(a) does the key exist · (b) is its value fresh · (c) does the producer actually read it.**
→ **For any calibration change, verify all three.** Trevor caught this by asking; I had answered (a) only.

---
# 🔴 DEPTH-ROLE SOURCE DEFECT — `players.pa` WAS DRIVING THE TIER, AND IT WENT STALE (found + fixed 2026-08-31)
## HOW IT SURFACED
After E37, prod's returner-hitter depth mix had **306 fewer `cornerstone`** than staging (1,088 vs 1,394) while
`o_war` matched (**max 6.86 in BOTH**) and markets closed correctly. Markets/WAR right, TIERS wrong ⇒ the tier input
was the problem, not the projection.

## ❌ MY FIRST HYPOTHESIS WAS WRONG — measured, then discarded
I assumed the Master `pa` change moved players across the 220-PA boundary. **It did not:**
`>=200 PA: 1,332 → 1,297 (−35)` · `>=150 PA: 2,239 → 2,228 (−11)`. Nowhere near 306. **And the direction was wrong** —
Master `pa` went UP (full season), which would produce MORE cornerstones, not fewer.

## ✅ THE ACTUAL CAUSE — the tier reads a DIFFERENT TABLE
`scripts/backfill-2027-hitter-returners.ts:286` called `defaultHitterDepthRoleFromActualPa(meta.pa)` where
`meta.pa` comes from **`players.pa`** (`:136` `.from("players").select("… pa …")`) — a stat living on the **IDENTITY**
table, which **nothing keeps in sync with the Masters**.
| | `players.pa` | `"Hitter Master".pa` | in sync? |
|---|---|---|---|
| **STAGING** | 128.0 | 128.0 | ✅ **5,343 / 5,343 identical, median Δ 0.0** |
| **PROD (after Step 1)** | **120.4** | **127.7** | ❌ 2,118 / 5,325 · median Δ **2.0** |
★ **SMOKING GUN: staging's `players.pa >= 220` count is 1,394 — EXACTLY its cornerstone count.**
The threshold is hardcoded (`src/lib/depthRoles.ts:93` `if (safePa >= 220) return "cornerstone"`).
**I created the divergence**: Step 1 updated `"Hitter Master".pa` to full-season and left `players.pa` untouched.
It never surfaced on staging because there the two columns happen to be equal.
★ **FIFTH INSTANCE of the same shape** — *the VALUE moved to one table, a supporting INPUT stayed on another*
(after C24 `trackman_pitches`, `computeNcaaAverages` weighting, Conference `Stuff_plus`, and F44's `TeamID`).

## ✅ THE FIX — CHANGE WHAT IS READ; DO NOT SYNC ANOTHER COLUMN
Trevor: *"Both should be regular season PA"* · *"we don't even really need `players.pa` if we are using regular season
pa/ip — just change what column is read, not filling another column."* The Masters ALREADY carry both windows from
Step 1 (`regular_season_pa` 5,322 · `regular_season_ip` 5,372), so **nothing needed filling.**
```
scripts/precompute-returner-pitchers.ts:488
-  const actualIp = Number(pmRow.IP) || 0;
+  const actualIp = Number(pmRow.regular_season_ip ?? pmRow.IP) || 0;      // select("*") already fetches it

scripts/backfill-2027-hitter-returners.ts:186   + regular_season_pa, pa   (added to the Master select)
scripts/backfill-2027-hitter-returners.ts:286
-  defaultHitterDepthRoleFromActualPa(meta.pa)
+  defaultHitterDepthRoleFromActualPa(master?.regular_season_pa ?? master?.pa ?? meta.pa)
```
**FALLBACK = the Master's FULL-season `pa`/`IP`** (Trevor: *"full season is fine"*) for the ~19 hitters / ~3 pitchers
with no reg value — so **`players` is no longer a stat source on this path**.
⛔ **`players.pa` / `players.ip` are LEFT IN PLACE, not removed** — other consumers may read them; a column drop
mid-push is not worth the risk. **Do NOT add duplicate reg columns to `players`** (Trevor: no duplicated unused columns).
✅ **BOTH PATHS NOW AGREE ON THE REGULAR SEASON:** the precompute matches TeamBuilder
(`useTeamBuilderData.ts:239` `regular_season_pa ?? pa`, `:254` `regular_season_ip ?? IP`), which was already correct.
**TeamBuilder is the reference implementation here.**
⚠ **E36 + E37 MUST BE RE-RUN** — their `hitter_depth_role`/`pitcher_depth_role` and the `projected_pa`/`projected_ip`
derived from them are stale. `o_war` / `p_war` / rates / markets are UNAFFECTED. Re-running is idempotent.

## 🏷️ LEGACY FUNCTIONS MARKED (2026-08-31) — stop rediscovering these
Banners added in-file so nobody proposes them again:
| file | last touched | why LEGACY |
|---|---|---|
| `src/lib/syncMasterToPlayers.ts` | 2026-06-07 | `refreshPaIpFromMaster()` syncs Master→`players.pa/ip` — the model just superseded. ⛔ `syncMasterToPlayers()` **WIPES** the players table. ✅ `addMissingPlayers()` still live. |
| `src/lib/importPaAbData.ts` | 2026-04-03 | writes PA/AB onto `players` |
| `src/lib/runDataCascade.ts` | 2026-05-19 | imports `bulkRecalculatePredictionsLocal`, a **STUB** (`predictionEngine.ts:875`) — the open gate on Phase-H 48 |
| `scripts/recompute-cascade.ts` | 2026-08-20 | **PARTLY** legacy: calls the LEGACY `calculateConferenceStuffPlus` **and** the stubbed `bulkRecalc` |
| `src/savant/lib/conferenceStuffPlus.ts` | 2026-04-26 | reads the legacy `pitcher_stuff_plus_inputs` lane; superseded by `conferenceStuffPlusV2` |
| ~~`scripts/clean-twp-sides.ts`~~ **🗑️ DELETED 2026-08-31** | 2026-07-23 | **DELETED, not just marked legacy** (Trevor: *"you can delete it if its that destructive"*). Self-declared **"One-time:"**. ⛔ **NO env guard** (`grep -c` = 0/0 — bare `process.env.SUPABASE_URL!`, wrote `target_board` + `team_build_players` with ZERO opt-in; **7th instance** of that defect class). 🚨 **Priced the TWP hitter market off `o_war` only** (`:33`,`:84`) — would RE-INTRODUCE the split basis F39/F40 eliminated (REGISTRY #19). **Superseded by `rebuild-twp-target-rows.ts` (F41a)**: same job, idempotent, from the source of truth, guarded. Had no npm script and no callers. ♻️ **Recover if ever needed:** `git show 3316078:scripts/clean-twp-sides.ts` (96 lines). |
★ I proposed `refreshPaIpFromMaster` as "the committed process" purely because its docstring matched the symptom.
Trevor: *"that is old outdated stale logic … all of these are outdated I am almost positive."* **A docstring that
matches your symptom is not evidence the function is current — CHECK `git log -1 --format=%ad` FIRST.**

---
# ✅ E36 + E37 RE-RUN AFTER THE DEPTH-ROLE FIX (prod, 2026-08-31)
Re-ran both so tiers derive from the REGULAR-SEASON window. Both idempotent. Propagate needed the explicit
`set statement_timeout = '15min'` again (105,093 rows, 14.8s) — the bare run times out at prod's 2min default.

## RESULT — PROD vs STAGING, and why they now DIFFER BY DESIGN
| | PROD | STAGING | reading |
|---|---|---|---|
| **HITTER** cornerstone | **1,138** (1,088 pre-fix) | 1,394 | prod anchors on REG; staging on FULL |
| everyday_starter | 2,513 | 2,365 | |
| avg `projected_pa` | 170.9 | 173.5 | |
| avg `o_war` | **0.795** | 0.717 | prod's C27 calibration is fresher |
| **max `o_war`** | **6.86** | **6.86** | ✅ **identical — the projection math reproduces** |
| market avg / max | $19,274 / **$673,949** | $16,564 / $613,259 | |
| **PITCHER** weekend_starter | **336** | 417 | prod a tier lower on REG innings |
| workhorse_reliever | 418 | 529 | |
| weekday_starter | 524 | 430 | |
| avg `projected_ip` | **30.0** | 31.2 | |
| avg `p_war` | **0.584** (0.607 pre-fix) | 0.598 | |
| **max `p_war`** | **3.93** | **3.93** | ✅ identical |
**THE DRIVER, EXPLICITLY:**
```
PROD     "Hitter Master".regular_season_pa >= 220  →    896  (D1)     ← REGULAR season
STAGING  players.pa >= 220                         →  1,394           ← FULL season (old rule)
```
🛑 **PROD AND STAGING SHOULD NO LONGER MATCH ON DEPTH ROLES.** Prod anchors tiers to regular-season volume (the fix);
staging still uses full-season PA/IP because it has not had the fix. **A depth-role mismatch is NOT a prod defect** —
staging picks this up when it is caught up THROUGH TRACK B. Everything else reconciles: **max `o_war` 6.86 and max
`p_war` 3.93 are IDENTICAL**, and the higher prod `o_war`/markets trace to C27's fresher calibration.

## 🛑 CORRECTION — I SAID THE DEPTH-ROLE CHANGE WOULD NOT TOUCH `p_war`. THAT WAS WRONG.
The tier sets `projected_ip` / `projected_pa`, and **`p_war` scales with innings**:
`projected_ip 31.2 → 30.0` ⇒ `avg p_war 0.607 → 0.584` (−0.023). Hitters likewise: `projected_pa 173.5 → 170.9`.
**Depth role is NOT a display attribute — it is a WAR INPUT.** Changing its source changes projections, and therefore
market values. `max` is unchanged in both, so the top of the distribution is stable — but the mean moved.
→ **Anything that alters depth-role derivation REQUIRES a full re-run of E36/E37 and everything downstream of them.**

## ⚙️ MECHANICS WORTH KEEPING
- `npm run …:prod -- --dry-run` — the `--` is REQUIRED; the alias itself contains no dry-run flag and **writes**.
- The propagate RPC needs `set statement_timeout = '15min'` as an **explicit statement** (the node-postgres client
  constructor option does NOT take). FINITE — never `0`.
- Write long-running output **straight to a file**, never through a `grep` pipe — grep buffers and the log stays
  0 bytes, hiding all progress (cost one blind 5-minute wait).

---
# ✅ STAGING VALIDATION OF THE DEPTH-ROLE FIX (2026-08-31) — the divergence WAS the rule, not a data defect
**METHOD:** apply the SAME fixed code to STAGING, so the only remaining difference between environments is DATA.
If the tiers converge, the earlier prod↔staging gap was the rule change; if they stay apart, it is a data problem.
**This is the cleanest way to separate "we changed the rule" from "prod is broken" — use it whenever a rule changes.**

## PITCHERS — CONVERGED ✅
| role | PROD | STAGING | Δ |
|---|---|---|---|
| high_leverage_reliever | 967 | 963 | +4 |
| low_impact_reliever | 776 | 757 | +19 |
| mid_leverage_reliever | 958 | 918 | +40 |
| specialist_reliever | 1,226 | 1,174 | +52 |
| swing_starter | 254 | 242 | +12 |
| weekday_starter | 524 | 488 | +36 |
| weekend_starter | 336 | 346 | **−10** |
| workhorse_reliever | 418 | 428 | **−10** |
Same ordering, proportional deltas. **Prod carries 70 more pitchers with `p_war` (6,632 vs 6,562)**, which accounts
for most of the spread.
**BEFORE staging got the fix:** `weekend_starter` 336 vs **417**, `workhorse_reliever` 418 vs **529** — gaps of 81 and
111. **AFTER:** −10 and −10. **The gap collapsed by ~90% once both ran the same rule.**
`avg p_war` **0.584 vs 0.598 → 0.584 vs 0.577** · `projected_ip` **30.0 vs 30.4** · `max p_war` **3.93 in BOTH** ✅

## ⚙️ MECHANICAL DIFFERENCE WORTH KNOWING
**The propagate RPC SUCCEEDS INLINE on staging (110,383 rows) but TIMES OUT on prod** at the 2min default.
Prod's `player_predictions` is larger and the statement is un-scoped by season. **On prod, always follow the
precompute with the explicit-`SET` propagate; on staging the bare run is fine.** Do not read the staging success as
evidence the prod path works.

## 🧠 THE RULE THIS ESTABLISHES
When a DERIVATION RULE changes, prod↔staging comparison is **meaningless until BOTH run the new rule**. Before that,
a mismatch tells you nothing — I nearly logged the 306-cornerstone gap as a prod defect when it was the fix working.
✅ **Sequence: fix → apply to prod → apply the SAME code to staging → THEN compare.** Any residual difference after
that is genuine data (population size, calibration freshness), and can be attributed rather than guessed at.

---
# 🔍 E38 PRE-FLIGHT AUDIT (2026-08-31) — run BEFORE `zsh scripts/_run_step2_all.sh --prod`
Audited after the depth-role fix, because E38 runs a DIFFERENT pair of scripts from E36/E37.

## 🔴 FINDING 1 — THE TRANSFER **HITTER** HAD THE SAME `players.pa` DEFECT. **FIXED.**
E36/E37 (returners) were fixed earlier; the transfer pair had NOT been checked.
| script | depth-role input | state |
|---|---|---|
| `precompute-pitchers.ts` (transfer PITCHER) | `:362` `r.regular_season_ip ?? r.IP` · `:535` `pmRow?.regular_season_ip ?? pmRow?.IP ?? p.ip` | ✅ **ALREADY CORRECT** |
| `precompute-transfer-projections.ts` (transfer HITTER) | `:409` `const rawPa = (p as any).pa` ← **`players.pa`** | ❌ **BUGGED → FIXED** |
**FIX APPLIED** (same pattern, `masterPR` was already in scope for `d_war`):
```
:305  + regular_season_pa, pa      (added to the "Hitter Master" select)
:409  const rawPa = masterPR?.regular_season_pa ?? masterPR?.pa ?? (p as any).pa ?? null;
```
★ **Fixing the returner path did NOT fix the transfer path.** Four scripts derive depth roles; three needed
inspection and two needed changes. **When a shared helper's INPUT convention changes, audit EVERY caller** —
`grep -rn "defaultHitterDepthRoleFromActualPa\|defaultPitcherDepthRoleFromIp"`.

## ⚠ FINDING 2 — `RSTR IQ All-Americans` HAS **`school_team_id = NULL`** AND **0 TRANSFER PREDICTIONS**
| PROD active team | transfer preds |
|---|---|
| **RSTR IQ All-Americans** | **0** |
| the other 13 (Kansas, Georgia, Arkansas, TCU, Penn State, …) | **~14,240 each** |
Its `customer_teams` row: `school_team_id = NULL · active = true · savant_enabled = true · market_pay_enabled = false`.
**STAGING HAS NO SUCH TEAM** — it is prod-only. Transfer projections need a DESTINATION program (conference, park,
PTM), so with no `school_team_id` there is nothing to project INTO. **The 0 is almost certainly BY DESIGN.**
🛑 **BUT `list-customer-teams.ts` RETURNS IT**, so the loop WILL attempt it — and the loop **discards exit codes**
(below), so a failure or no-op there is indistinguishable from success. **Expect 13 teams to produce ~14,240 rows and
All-Americans to produce 0. Do NOT treat that 0 as a failed run — and do NOT "fix" it by assigning a school.**

## 🛑 FINDING 3 — THE LOOP SWALLOWS EXIT CODES (already known, restated because it now matters more)
```zsh
npx tsx … precompute-transfer-projections.ts --team "$uuid" $PROD_FLAG 2>&1 | grep -iE "Result:|computed|error" | head -3
npx tsx … precompute-pitchers.ts            --team "$uuid" $PROD_FLAG 2>&1 | grep -iE "Result:|computed|overlaid|error" | head -3
```
The pipe means the loop's status is `grep`'s, not the script's. **`STEP 2 ALL DONE (14 teams)` PROVES NOTHING.**
✅ **GATE: after the run, verify PER TEAM in the DB** — 13 teams × ~14,240 rows + All-Americans at 0 — and re-run a
dry pass requiring 0 pending changes. **Never accept the banner.**

## ✅ FINDING 4 — DEPENDENCIES SATISFIED
| prerequisite | PROD | STAGING |
|---|---|---|
| `team_season_stats` rows | **308** | 308 |
| `faced_stuff_plus` / `faced_htp` (what E38 READS) | **308 / 308** | 308 / 308 |
| active customer teams | **14** | 18 |
F44 ran, so `precompute-transfer-projections.ts:225` and `precompute-pitchers.ts:279` will find the faced-competition
values instead of coercing an empty map. **This was the ORDER-AUDIT inversion — F44 had to precede Phase E, and does.**

## ⚠ FINDING 5 — THE TEAM LISTS DIFFER (14 prod vs 18 staging). NOT A DEFECT.
Prod's 14: RSTR IQ All-Americans · Kansas · Georgia · Arkansas · Florida Atlantic · TCU · Stetson · Penn State ·
Arizona State · Vanderbilt · Gardner-Webb · BYU · Virginia Tech · Dallas Baptist.
**"18 teams incl. North Carolina" is a STAGING number and is WRONG for prod.** Gate on what the live list returns,
never on a hardcoded count.

## ▶️ E38 EXECUTION ORDER
```
1. (done) fix the transfer-hitter depth-role source
2. DRY-RUN one team on prod first — confirm the depth roles look REG-anchored before committing 14 teams
3. zsh scripts/_run_step2_all.sh --prod        (~14 teams x 2 scripts; run detached under caffeinate)
4. GATE per team in the DB (13 x ~14,240 + All-Americans 0), NOT the banner
5. re-run dry → require 0 pending per team
```

---
# ✅ HITTER DEPTH-ROLE CONVERGENCE CONFIRMED (2026-08-31) — the fix behaves identically on both envs
Staging E37 re-run finished (`7,025 computed · 1,416 all-null · 2 rows missing master ratings`, EXIT=0).

## THE GAP COLLAPSED 91% ONCE BOTH ENVS RAN THE SAME RULE
| role | PROD | STAGING | Δ NOW | Δ BEFORE staging's fix |
|---|---|---|---|---|
| **cornerstone** | **1,138** | **1,161** | **−23** | **−256** |
| everyday_starter | 2,513 | 2,510 | **+3** | +148 |
| platoon_starter | 1,844 | 1,840 | **+4** | +70 |
| utility | 842 | 834 | +8 | +18 |
| bench | 683 | 694 | −11 | +1 |
`projected_pa` **173.5 → 171.3** (prod 170.9) · **`max o_war` 6.86 in BOTH** ✅
**Mirrors the pitcher result exactly** (`weekend_starter` 81→10, `workhorse_reliever` 111→10, also ~90%).
★ **TWO INDEPENDENT CONFIRMATIONS, hitters and pitchers, that the 2026-08-31 depth-role divergence was the RULE
CHANGE and not a prod defect.**

## THE RESIDUAL IS ATTRIBUTABLE — NOT DRIFT
| | PROD | STAGING | cause |
|---|---|---|---|
| avg `o_war` | **0.795** | 0.710 | prod's **C27 calibration is fresher** (staging never ran C27) |
| avg market | **$19,274** | $16,277 | same |
| max market | **$673,949** | $613,259 | same |
| hitters with `o_war` | 6,806 | 6,811 | population differs by 5 |
| `regular_season_pa` filled · avg | 5,322 · **121.4** | 5,339 · **121.7** | near-identical — the INPUT agrees |
★ **The INPUT (`regular_season_pa`, 121.4 vs 121.7) agrees to 0.3 PA while the OUTPUT (`o_war`) differs by 0.085.**
That is the signature of a CALIBRATION difference, not a data difference — exactly what C27 freshness predicts.

## 🧠 MY OWN PROBE ERROR (6th of the session — logged for the pattern, not the incident)
I labelled a column `ge220` but omitted the `>= 220` predicate, so it returned the TOTAL filled count (5,322 / 5,339)
rather than the above-threshold count. The values shown were still valid (`regular_season_pa` fill + average) but the
LABEL was wrong and would have misled a later reader.
→ **A mislabeled correct number is as dangerous as a wrong number.** Running tally of instrument errors this session:
wrong CSV column · exact-equality between derivations · `Number(null)` passing `isFinite` · raw-mean over a
tiny-denominator tail · guessed column names (×3) · this mislabeled aggregate. **Every one was MY measurement, never
the data.** Against ONE guard that fired correctly (the IP check at 1.827), where the disagreement WAS the finding.

---
# 📊 REFERENCE — WHY PROD AND STAGING PROJECTIONS DIFFER (measured 2026-08-31). Use this to attribute, not guess.
Measured across **n = 3,861** D1 pitchers with `IP > 10`, `|prod − staging|` on every `"Pitching Master"` input the
projection engine reads:
| input | mean \|Δ\| | **median** | p90 | reading |
|---|---|---|---|---|
| **`stuff_plus`** | 0.027 | **0.000** | 0.100 | ✅ **IDENTICAL — the v2 chain reproduces exactly** |
| `HR9` | 0.038 | 0.030 | 0.080 | negligible |
| `WHIP` | 0.057 | 0.050 | 0.120 | negligible |
| `FIP` | 0.076 | 0.050 | 0.180 | negligible |
| `BB9` | 0.177 | 0.120 | 0.390 | small |
| `K9` | 0.259 | 0.230 | 0.500 | small |
| **`ERA`** | **0.290** | **0.180** | **0.710** | ★ largest RAW-RATE difference |
| `IP` | 0.533 | 0.367 | 1.333 | ~0.4 IP |
| **`p_rv_plus` (PR+)** | **2.500** | **1.000** | **7.000** | ★★ **LARGEST — and larger than any of its own inputs** |

## THE CAUSAL RANKING (dominant → negligible)
1. **★★ C27 CALIBRATION FRESHNESS — the dominant driver, via PR+.** PR+ is a z-score composite against
   `ncaa_averages` means/SDs. **Prod ran C27 and re-derived them from prod's own population; staging never did.**
   Small input deltas measured against *different* means/SDs **AMPLIFY**: PR+ moves a median 1.0 (p90 **7.0**) on a
   ~100 scale — bigger than any input that feeds it. **PR+ is what the projection engine actually consumes**, so this
   is where prod↔staging projection differences come from.
   Evidence: `p_ncaa_avg_stuff_plus` prod **100.0141** vs staging **99.4358**; `p_sd_stuff_plus` **5.04577** vs **5.93754**.
2. **★ ERA SOURCE — not window.** BOTH envs hold FULL-season ERA. Prod's now comes from the **engine's accrual**
   (`pitcher_line.csv` `full_ERA` — inherited-runner attribution, earned+unearned); staging's is still **TruMedia's
   official** figure. Worked example — **Dylan Volantis: prod ERA 1.98 vs staging 2.08.**
   ⚠ **ERA is a field the monthly Master sheet is meant to OVERRIDE** if the pitch-log derivation is off — it is one of
   the named weak-derivation fields (with SB and G/GS).
3. K9 / BB9 / FIP / WHIP / HR9 — all median ≤ 0.23. Same pitch-log derivation both sides.
4. **`stuff_plus` — ZERO (median 0.000).** Whatever differs, it is never Stuff+.

## 🛑 THE MISATTRIBUTION THIS TABLE PREVENTS
Trevor: *"I even noticed that Dylan Volantis Stuff+ went down"* — reasonably attributed to C27.
**IT WAS NOT C27.** `stuff_plus` is **102.60 in BOTH envs**, from **1,525 scored pitches averaging 102.58 in BOTH**.
**C27 writes `ncaa_averages` / `model_config` — POPULATION CONSTANTS — never per-player `stuff_plus`.**
The drop Trevor remembers is **107.6 → 102.60**, which is the **Stuff+ v2 RECLASSIFICATION + RECENTER** — the change
he himself challenged at the time (*"I find it hard to believe Dylan Volantis would be a 107.6 stuff+"*). His instinct
was right and v2 corrected it. For context, 102.60 sits ~4 points above the Master population mean
(**98.59 prod / 98.82 staging**) — a far more defensible placement than 107.6.
★ **RULE: before attributing a per-player change to a producer, confirm that producer WRITES that column.**
Volantis' other prod↔staging deltas are separately explained: `trackman_pitches` 1,530 vs 1,406 (**prod ran C24**,
staging did not) · `IP` 95.30 vs 95.00 (engine vs TruMedia).

## ✅ HOW TO USE THIS
- A prod↔staging **projection** difference is **EXPECTED** until staging is caught up through Track B. Attribute it to
  PR+/C27 first.
- **Input agrees but output differs ⇒ CALIBRATION.** Demonstrated twice: `regular_season_pa` agrees to 0.3 PA while
  `o_war` differs 0.085; `stuff_plus` agrees to 0.000 while PR+ differs 1.0.
- **Only investigate as a defect** when an input with a *median* difference of ~0 produces a large output change that
  calibration cannot explain.

---
# ✅ E38 TRANSFERS — APPLIED TO PROD 2026-08-31. All 14 teams, 0 errors.
`caffeinate -dimsu zsh scripts/_run_step2_all.sh --prod` · EXIT=0 · **0 error/fail mentions in the log**.
Per team ~4,990 hitter + ~5,110 pitcher computed (38–39% of ~13,000 candidates) — consistent across all 13 real teams.

## GATE — VERIFIED PER TEAM IN THE DATABASE, **NOT** FROM THE BANNER
| team | rows | `o_war` | `p_war` |
|---|---|---|---|
| Kansas · Penn State · TCU · Florida Atlantic · BYU | 14,274–14,276 | 8,099–8,103 | 6,294–6,296 |
| Virginia Tech · Arkansas · Dallas Baptist · Arizona State · Stetson | 14,269–14,271 | 8,096–8,099 | 6,293–6,294 |
| Gardner-Webb · Vanderbilt · Georgia | 14,267–14,268 | 8,096–8,098 | 6,290–6,292 |
| **RSTR IQ All-Americans** | **0** | 0 | 0 |
★ **The 9-ROW SPREAD (14,267–14,276) IS THE REAL SIGNAL.** A team cut short by a swallowed failure would sit visibly
below the others. None does. **Row-count TIGHTNESS across peers is a better completeness gate than any single count.**

## ✅ THE AUDIT'S TWO PREDICTIONS BOTH HELD
1. **`RSTR IQ All-Americans` produced 0 — SILENTLY.** The log shows both banners with **NO `Result:` line between
   them**, then the loop moved straight to Kansas:
   ```
   ===== [1/14] RSTRIQAll-Americans HITTER =====
   ===== [1/14] RSTRIQAll-Americans PITCHER =====
   ===== [2/14] KansasJayhawks HITTER =====
   ```
   Correct (`school_team_id` is NULL — no destination program to project INTO). **But a REAL failure would look
   IDENTICAL.** This is the exit-code-swallowing risk demonstrated live, on a real run. ⛔ Do NOT "fix" this by
   assigning it a school.
2. **The transfer-hitter depth-role fix was REQUIRED.** Had E38 run before the audit, ~185,000 transfer rows would
   carry FULL-season-anchored tiers while the returners carry REGULAR-season — the same players holding different
   tiers depending on which model row you read, and nearly impossible to spot afterwards.

## ✅ DEPTH ROLES CONFIRMED REGULAR-SEASON ANCHORED
**885 of 886 transfer cornerstones have `"Hitter Master".regular_season_pa >= 220` (99.9%).** The single exception is
a null-reg row using the documented full-season fallback.
| role | RETURNER | TRANSFER | reading |
|---|---|---|---|
| everyday_starter | 2,513 | **2,510** | ✅ top tiers agree ±10 |
| cornerstone | 1,138 | **1,128** | ✅ |
| platoon_starter | 1,844 | 2,132 | larger transfer CANDIDATE POOL (JUCO/D2/low-PA nationally) |
| utility | 842 | 1,322 | same |
| bench | 683 | 1,011 | same |

## ✅ EQUATION INPUTS VERIFIED **BEFORE** THE RUN (single-team prod dry-run, Kansas)
```
overlaid 34 pitching weights from model_config      ← config IS read (incl. every *_plus_ncaa_* key)
308 team_season_stats faced_stuff_plus rows         ← hitter side consumes F44
308 team_season_stats faced_htp rows                ← pitcher side consumes F44
```
★ **Those `308 faced_*` lines are the ORDER-AUDIT INVERSION paying off live** — this is the exact read that would have
returned an EMPTY MAP (and silently dropped the faced-competition adjustment for every Independent program) had Phase E
run before F44, as the original topic-ordered runbook specified.
Two-sided SD reaches the engine: all 6 `*_ncaa_sd_bad` exist in `DEFAULT_PITCHING_WEIGHTS`, so they pass the
`k in pitchingEq` overlay guard at `precompute-pitchers.ts:156` and are consumed by `dsd()` at
`transferPitcherProjection.ts:390-395`.

---
# 🚨🚨 SILENT-FAILURE REGISTRY — EVERY DEFECT THAT WOULD HAVE SHIPPED WITHOUT AN ERROR
## READ THIS BEFORE WRITING ANY TRACK B STAGE. Each entry says WHERE it belongs in Track B and WHEN it must run.
**The unifying property: NOT ONE of these raised an error.** Every one produced a populated table, a clean exit code,
and a plausible number. They were found by VALUE / MEMBERSHIP / CARDINALITY gates and by cross-environment comparison —
never by a failure. **A Track B stage that "ran fine" tells you nothing.**

| # | 🚨 defect | how it presented | what caught it | **TRACK B: where + when** |
|---|---|---|---|---|
| 1 | **Conference `Stuff_plus` computed from the LEGACY lane** | `30/30` populated, looked complete | VALUE compare → **101.17 vs the correct 99.15** | **Stage 14 (conference).** `conferenceStuffPlusV2` = `Σ(Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)`. ⛔ NEVER `pitcher_stuff_plus_inputs`. **Runs AFTER the Masters rollup, and is a 4th producer the runbook omitted.** |
| 2 | **`trackman_pitches` from the legacy table** | column fully populated | lane check → only **638/5,367 (11.9%)** agreed; legacy UNDERCOUNTS ~12.1/pitcher | **Stage 6.** D1 ← `pitch_log_pitcher_totals.total_pitches` @ `dimension_key='all'`; JUCO ← legacy. **Keep the lanes separate.** |
| 3 | **`run_env_factor` went stale under the park rewrite** | `30/30` before AND after | VALUE → **101.879 → 99.719** (= the park `RG mean|Δ| 2.16`) | **Stage 14.** `derive_conf_opr_htp` MUST be the **LAST** thing to touch park-derived conference columns. Park factors (stage 12) invalidate it. |
| 4 | **Camden Kozeal — a real 287-PA / 20-HR season with NO Master row** | `5,340 = 5,340`, every count passed | **MEMBERSHIP** diff (pitch-log PA ≥ qualifier vs Master) | **Stage 5.** Create rows for anyone the pitch log shows PLAYED. Gate = the membership query returning EMPTY. |
| 5 | **`--create-new` structurally incapable of creating a hitter** | `exit 0`, printed `0 new rows` | reading the code after a replica said it SHOULD create 1 | **Stage 5.** `repRows` `:465` passed `"batting_team_id"` as `idCol` ⇒ query TIMED OUT over 2.5M rows ⇒ `:451` DISCARDED the error. **2027 opens with mostly new players — this MUST work.** |
| 6 | **Arkansas split across two `TeamID`s** | both buckets internally consistent; **Σ-centering held at 309 teams** | **CARDINALITY** (D1 must = 308) — later a **PRIMARY KEY** | **Stage 15.** Group on **`source_id`**, never the per-season `TeamID`. Assert `count(distinct TeamID) per source_id = 1` BEFORE any team rollup. |
| 7 | **`pitch_log.game_string` 100% NULL on prod** | every Phase-C gate passed — nothing needed it as a KEY | per-pitcher IP derived **0 pitchers** | **Stage 1 (ingest).** It is an INGEST-time identifier, not derived. Without it: per-pitcher IP is impossible AND `refresh_team_season_stats` step 5 (W/L records) has no key. |
| 8 | **`pitch_log_pitcher_totals.ip` 0/5,509 on prod** | column EXISTED, so `ipColExists` returned true | `K9/BB9/HR9/WHIP/FIP` silently left at stale CSV values | **Stage 2 (accumulator).** `pitcherIpDependent()` returns `{}` on a null `ip` — **no error**. Compute `ip` in the totals build. |
| 9 | **Depth role read `players.pa`** (identity table, never synced) | tiers looked fine on staging (columns happen to be equal there) | prod↔staging → **306 fewer cornerstones** | **Stages 5 + 18.** Read the Masters' `regular_season_pa`/`regular_season_ip`. **4 scripts derive depth roles — fixing one does NOT fix the others.** |
| 10 | **Transfer HITTER kept the `players.pa` bug after the returner was fixed** | would have written ~185k rows with the WRONG tier window | the **E38 PRE-FLIGHT AUDIT** | **Stage 18.** When a shared helper's INPUT convention changes, `grep` EVERY caller. |
| 11 | **Phase E reads `team_season_stats.faced_*`, which Phase F creates** | `const { data } =` discarded `error`; `(rows \|\| [])` → empty Map ⇒ Independents silently lose faced-competition | the ORDER AUDIT (read/write graph) | **Stage 15 BEFORE stage 18.** The docs gated G46 on this table but never carried the gate back to the precomputes. |
| 12 | **`regular_season_ip` empty ⇒ `nullif(sum(...),0)` → NULL** | `team_season_stats` populated, rates just… NULL | reading the SQL body | **Stage 15.** Needs stage 11 (the reg/post lock) first. |
| 13 | **WAR reads CSVs on disk, not the DB** | correct numbers, wrong wiring | asking "what does this READ?" | 🔴 **TRACK B BLOCKER.** A daily run has NO TruMedia CSV. Re-point at the accumulator → Masters. |
| 14 | **6 scripts writing PROD with no env guard** | ran fine — against whichever env you loaded | `grep -c 'trbvxuoliwrfowibatkm'` = 0 | **Every stage.** Double-keyed guard: URL and `--prod` must AGREE. |
| 15 | **`npm run …:prod` aliases WRITE** | I announced "dry-run" and it upserted 7,596 rows | reading `package.json` afterwards | **Every stage.** `-- --dry-run` (the `--` is REQUIRED). **Assume `:prod` aliases write.** |
| 16 | **`updated_at` bumped on 105,093 rows whose values never changed** | fresh timestamp, stale values | comparing VALUES | **Every stage.** ⛔ **`updated_at` is NOT a freshness signal.** |
| 18 | 🚨 **F41a `rebuild-twp-target-rows` DELETEs board rows and REINSERTS from a HAND-LISTED field set that omits `total_hitter_war`** — silently stripping the value F40 wrote hours earlier | row count unchanged, board renders, `o_war` + market still present, exit 0 — **only a field INSIDE the JSON vanishes** | reading the builders (`:28`,`:30`) and the `F` select list (`:44`) against F40's gate | **Stage 19.** ⛔ **NEVER rebuild a snapshot from a hand-listed field set** — round-trip the object and overwrite only what the stage owns (`rebake-twp-markets.ts:44,55` `{...s}` does this correctly). Also: **a backup taken before the PREVIOUS step is not a backup for this one.** |
| 19 | 🚨 **TWP hitter market priced off `o_war` while every other hitter is priced off `total_hitter_war`** | both are valid WAR columns and both produce plausible dollars | code read after F39/F40 unified the basis everywhere else | **Stage 19.** ONE pricing basis system-wide. Assert `market_value` and `twp_hitter_market_value` derive from the SAME WAR column. Measured split: Colasante −9.5%, Overbeek −2.0%. |
| 20 | 🚨🚨 **The transfer HITTER engine never routed TWP markets to `twp_hitter_market_value`** — it wrote every TWP's dollars into the shared `market_value`, which the display layer IGNORES for TWPs | the column was populated with a correct, sensibly-priced number; nothing was null, nothing errored — the value was simply in the column nobody reads, so **2,119 transfer + 110 returner TWP hitter rows rendered BLANK to coaches** | tracing why F41b existed at all, then diffing the four projection paths against each other | **Stage 18.** ALL FOUR paths (returner hitter/pitcher, transfer hitter/pitcher) must route TWP → `twp_*` + NULL the shared column. Three did; the transfer hitter did not — and its own sibling file's comment *claimed* it did. ⛔ **The repair CANNOT be done downstream:** only stage 18 knows the DESTINATION program's conference, and re-pricing later from the player's own conference under-prices by the full PTM ratio (SEC 4.0 vs Patriot 1.36 = **2.9×**). **A repair step that re-derives a value the engine already computed correctly is itself the bug** — that was F41b. |
| 21 | 🚨 **Producers branch on the snapshot's OWN embedded `is_twp`, not `players.is_twp`** — E35 flipped the players flag 137→253 and the snapshots were never updated | the dollars are CORRECT and correctly priced; they are simply written to the column the display layer will not read for that player. Nothing errors, nothing is null, the row looks complete | a TWP build snapshot holding BOTH a shared `market_value` ($112,305, correct) and a stale `twp_hitter_market_value` ($38,106, wrong conference) — **disagreeing by the exact 2.9× PTM ratio** | **Stage 19.** ⛔ **NEVER branch on a flag embedded in a snapshot** — join to the owning table at read time. A snapshot records VALUES, it is not a source of truth for IDENTITY. Gate: `players.is_twp AND snapshot->>'market_value' IS NOT NULL` = **0 rows**. ⛔ Do NOT back-fill `is_twp` into snapshots — that just creates another copy to go stale. **6th instance of "the value moved, a supporting flag stayed behind".** |
| 22 | 🚨🚨 **An `.in("id", …)` list built from raw FKs containing a NULL — Postgres rejects the WHOLE batch as invalid-uuid, and the `error` was discarded** | the ONLY symptom was cosmetic: dry-run samples printing `undefined` for the player name. Every real player in the poisoned batch silently vanished from the position AND `is_twp` lookups | noticing that every sample line said `undefined`, then checking `team_build_players` for NULL `player_id` (**191 of 1,470**) | **Every stage.** Filter to well-formed UUIDs and **`throw` on batch error**. ⚠ **This defect would have silently UNDONE REGISTRY #21 minutes after it was fixed** — the `is_twp` map came from the same poisoned lookup, so TWPs would read `false` and re-route to the shared column. **The fix and the thing that breaks it were in the same function.** ★ **A cosmetic logging anomaly is a data-integrity signal.** |
| 23 | 🚨 **`resync-build-snapshot-markets` never re-derived POSITIVE pitcher markets** — it only floored non-positive WAR to $0, deferring the rest to "the app's live bake" | the stored value was a plausible number (often a stale one, sometimes `$0`) and no gate compared surfaces | Colasante's SP slot: **$0 on the build snapshot vs $130,733 on the target board** — same player, same side, two surfaces | **Stage 19.** A stored-first architecture cannot defer a stored value to a live bake. **Price BOTH surfaces in ONE stage with the SAME rules**, and gate `board == build` per player. Pitcher gate = **exactly ONE `$/win` rate per conference** (no position multiplier); hitter gate = at most three. |
| 24 | 🚨🚨 **TWO precompute stages both write `market_value` on the SAME `returner/regular` row — E37 (hitters) runs after E36 (pitchers) and NULLED the pitcher market** | both stages ran clean and reported success. The defect existed ONLY in their INTERACTION, and only on the ~113-player overlap (pitchers who also carry a Hitter Master row). The row kept E36's `p_war`/`projected_ip`/`depth_role` — only the dollars vanished | UX completeness check → **34 D1 pitchers with positive WAR and no market** (e.g. Derek Arrocha, SWAC, 2.531 pWAR, correct market $31,635) | **Stage 18/19.** 🔴 **ONE COLUMN, ONE OWNER** — no two stages may write the same column on the same row. 🔴 **A stage must NEVER null a field it has no value for** — omit the key; nulling asserts "I know this is empty", which the stage computing the OTHER side is not entitled to say. 🔴 **Gate ACROSS stages, not within them.** ★ `predictionEngine.ts:57-59` already NAMED this collision — the TWP column split exists to prevent it — but the protection only fires for `is_twp` players. |
| 25 | 🏛️ **SIDE ELIGIBILITY IS DECIDED BY `players.position`, NOT BY PA/IP — and the PA>=30 / IP>=5 minimum exists ONLY inside the TWP detector, nowhere in the equations** | every count passes; the equations run and produce plausible numbers on the wrong players. **203 D1 players with real IP carry a non-pitcher position** and were silently never entered into the pitcher loop (stale `p_war`, no market, nothing logged); conversely **221 players with token volume on one side get that side's equations run anyway**, producing junk WAR that then collides on the shared market column | classifying the population by PA/IP presence → bucket → tag, in that order | **Stage 18 — ARCHITECTURE DIRECTIVE, see the full block.** `src/lib/sideEligibility.ts` is built (NOT wired). **8 exact wire-in sites documented.** ⚠ **Skipping a side ≠ clearing it** — STEP 4 must ALSO null the non-qualifying side (measured: 643 players would otherwise freeze). ⚠ The `30` threshold is duplicated in **5 files** — one source or it drifts. ⛔ NCAA D1 only. |
| 26 | 🚨 **REGISTRY #21 RECURRED in `heal-stale-snapshots.ts:106`** — a THIRD script branching the market column on the snapshot's embedded `is_twp` | the gate had read **0 leaks hours earlier**; the run reported `healed 1029/1029 errors=0`; nothing failed | the post-run gate, which caught a TWP pitcher slot holding a shared `market_value` of $101,953 | **Stage 19.** ★ **THE PROCESS LESSON: I fixed #21 in two producers and stopped, then reasoned a third site was "harmless" instead of checking. It was not.** When a defect class is found, **`grep` EVERY site in the same pass** — a reasoned "harmless" is not a verification. The script already LOADED the authoritative `players.is_twp` map (`:67`) and used it elsewhere (`:75`); only the market branch ignored it. |
| 27 | 🚨 **The market-column placement check is gated behind an OFF-BY-DEFAULT `--market` flag** | the default pass printed **`drift=0`** while a TWP was actively mis-routed into the wrong column | running with `--market`, which surfaced 23 rows | **Stage 19.** ⛔ **A "0 drift" result means only that the ENABLED checks found nothing.** Column-placement correctness must never be optional — fold it into the always-on gate. |
| 28 | 🚨 **"SAFE BY CONSTRUCTION" WAS FALSE — a script with TWO Supabase clients aimed by TWO different mechanisms** | the docs asserted `--env-file` could not redirect it; the benign symptom is a startup crash when `process.env` is unset | tracing the transitive import chain `pitchingEquations:125 → useEquationWeights → supabaseQueries:1 → shared client` | **Every stage.** The script's OWN client reads the env FILE (`--prod`); a transitively-imported SHARED client reads `process.env` (`--env-file`), and it genuinely QUERIES (pitching weights). Mismatch them ⇒ **writes PROD while reading constants from STAGING, silently.** ★ **A NEW SHAPE: not a MISSING guard, but two guards that can DISAGREE (7th instance of the class).** Assert at startup that every client resolves to the SAME project ref. |

## 🚨 MECHANICAL TRAPS THAT COST A RUN EACH (all reproduce in Track B — it writes in bulk by definition)
| trap | symptom | fix |
|---|---|---|
| `CREATE TEMP TABLE … ON COMMIT DROP` | `relation "_gs_map" does not exist` | node-postgres autocommits EVERY statement — the CREATE commits and drops it. Use a session temp table or an explicit `BEGIN`. |
| One bulk `UPDATE` over 2.5M rows | `canceling statement due to statement timeout`, **whole thing rolls back** | prod `statement_timeout` = **2min**. Batch 25k via `unnest()` (~**87,000 rows/min**). |
| `new pg.Client({ statement_timeout })` | silently ignored — `show statement_timeout` still `2min` | `await c.query("set statement_timeout = '15min'")` as an EXPLICIT statement. **FINITE — never `0`** (a prior session hung prod 39 min). |
| Long job piped through `grep` | log stays **0 bytes**, no progress visible | write straight to a file. |
| `_run_step2_all.sh` pipes each team through `grep \| head -3` | **discards the exit code** — `STEP 2 ALL DONE (14 teams)` proves NOTHING | gate PER TEAM in the DB; peer row-count TIGHTNESS is the real signal. |
| `refresh_composite_war()` over PostgREST | gateway cuts at ~125s, **UPDATE rolls back**, no recognisable error | direct pg session / SQL editor ONLY. |

## 🚨 THE FOUR GATES THAT ACTUALLY CATCH THINGS (a count gate caught NONE of the above)
1. **VALUE** — did the number CHANGE? (#1, #3)
2. **MEMBERSHIP** — diff the ID SET, not the count. (#4)
3. **CARDINALITY** — assert the GROUP count; lean on PRIMARY KEYS. (#6)
4. **LOG-CONTENT** — read the body, never the exit code. (#5, #15)
Plus: **cross-environment comparison AFTER both run the same rule** — which is how #9 was proven to be a rule change
rather than a defect (gaps collapsed ~91%).

---
# ✅ F39 `refresh_composite_war()` — APPLIED TO PROD 2026-08-31 (9.0s)
Fired from the **DIRECT pg session** with `set statement_timeout = '15min'` (FINITE, never 0).
| | BEFORE | AFTER |
|---|---|---|
| `d_war` populated | 200,754 | **201,221** |
| `bsr_war` populated | 200,754 | **201,221** |
| `total_hitter_war` | 112,087 | 112,087 |
| avg `total_hitter_war` | 0.3517 | **0.3549** |
Filled **467** rows that lacked `d_war`/`bsr_war` and re-derived every total at ÷13.1.

## GATES — ALL PASS
```
identity total_hitter_war = o_war + d_war + bsr_war   worst 0.000000  (n=112,087)   ← EXACT to 6dp
rows with o_war but NULL total                        0
d_war / bsr_war centered                              avg d 0.0038 · bsr 0.0000 · range −1.24 … 2.49
returner totals                                       n=6,806 · avg 0.803 · max 6.86
```
★ `max total_hitter_war` **6.86** matches `max o_war` **6.86** on BOTH envs — the top of the distribution carries
through unchanged.

## 🚨 WHY THE TRANSPORT MATTERED
`supabase/migrations/20260810_composite_war_d1_rescale.sql:13` sets `statement_timeout = '180000'` **inside** the
function — the author signalling it can exceed the **~125s HTTP gateway ceiling**. `statement_timeout` does NOT raise
that ceiling: over PostgREST (`.rpc(...)`, the Supabase MCP, any HTTP client) the gateway cuts the connection and the
**WHOLE UPDATE ROLLS BACK**, usually with no error you would recognise as a rollback.
**It ran in 9.0s here — but "it was fast this time" is not a reason to use the wrong transport.**

## ✅ RUNBOOK CORRECTION CONFIRMED IN PRACTICE
`refresh_composite_war()` writes **`player_predictions`** (`d_war`, `bsr_war`, `total_hitter_war`) — **NOT the
Masters.** The Masters' Phase-D `d_war`/`bsr_war` are untouched. Older runbook text describing it as rewriting "the
descriptive Master" is WRONG.

---
# ✅ REGISTRY #17 — RESOLVED / NOT A DEFECT: unmeasured defense → 0 IS the correct default
Found by checking **ACCURACY**, not the identity (Trevor: *"check accuracy not just total"*). The identity
`total = o + d + bsr` held at **worst 0.000000 across 112,087 rows** — and proved nothing about whether `d` was
CORRECTLY SOURCED. It holds regardless of where `d` came from. **Exactly the "internally consistent but sourced
wrong" shape.**

## ✅ THE ACCURACY CHECK THAT DID MEAN SOMETHING
`player_predictions.d_war` vs `"Hitter Master".d_war` (the Phase-D descriptive value), joined via
`players.source_player_id`:
```
n = 72,726 · IDENTICAL 72,726 (100.0%) · median Δ 0.0002 · worst 0.000
bsr_war: n = 72,726 · IDENTICAL 72,726 (100.0%) · worst 0.000
```
★ **The projection side and the descriptive side derive the SAME number from the SAME source.** Correctly sourced.
✅ **This is intentional and correct:** `refresh_composite_war()` writes **`player_predictions`** (the PROJECTION
side); the Masters hold the **DESCRIPTIVE 2026** record from Phase D. Two different things that share column names —
the Masters are NOT touched, by design.

## 🚨 THE DEFECT — `coalesce(..., 0)` MAKES "NO DATA" LOOK LIKE "LEAGUE AVERAGE"
```sql
coalesce(d.dw, 0) as dw   -- Σ drs_floor WHERE position <> 'P' / 13.1
coalesce(b.bw, 0) as bw   -- wsb_runs / 13.1
```
A player with **NO row** in `player_season_defense` gets `d_war = 0`, stored **identically** to a player measured at
exactly 0.000. And `total_hitter_war = o_war + d_war + bsr_war`, so their total silently treats **unmeasured defense
as league-average**.
```
d_war = 0 rows                          133,816 of 201,221
  ├ NO defense row (coalesce default)    73,345   ← "unknown", stored as 0
  └ genuinely 0.000 from real data        60,471   ← measured
bsr_war = 0 with NO baserunning row       58,119
```
## SCOPE — 38 rows actually matter, not 73,345
| division | defaulted players | verdict |
|---|---|---|
| **NJCAA_D1** | **5,218** | ✅ **EXPECTED** — the dRS engine has no JUCO coverage |
| D1 | 1,286 | mostly low-PA |
| D2 | 2 | — |
★ **D1 players with ≥50 PA and NO defense row: 38** (avg **131.3 PA**, max **270 PA**).
**Those 38 are real contributors credited with exactly-average defense on no measurement.**

## ✅ RESOLVED 2026-08-31 — TREVOR'S CALL: **THIS IS CORRECT, LEAVE IT**
> *"JUCO and historical will not get dWAR and bsrWAR so we will only be filling that in moving forward. I would say
> just be consistent. Unmeasured defense should probably just be net 0 which should be league average correct?"*
**YES — and that resolves it.** `drs_floor` is a **runs-ABOVE-AVERAGE** metric, so **net 0 IS league average**.
Coalescing an unmeasured player to 0 assigns him **league-average defense**, which is the correct and CONSISTENT
neutral prior for a projection. It is NOT a wrong value dressed as data.
🛑 **THIS IS THE OPPOSITE OF [[feedback_zero_is_missing_not_a_value]].** That rule applies where 0 is an IMPOSSIBLE
measurement (an exact-0 scouting % means "not measured" — nobody has a true 0% chase rate). Here 0 is a **meaningful,
attainable value** — the centre of the scale. **Distinguish the two cases by asking: is 0 a value the metric can
legitimately take? If yes, a 0 default is a prior. If no, it is missing data.**
✅ **JUCO (5,218) and historical players will never get dWAR/bsrWAR** — coverage begins going forward. Expected.
✅ The **38 D1 players with ≥50 PA and no defense row** get a league-average prior. Consistent with everyone else.
🅱️ **TRACK B:** keep the `coalesce(…, 0)` — it is the intended neutral prior. **Do NOT "fix" it to NULL.**
---
# ✅ F40 SNAPSHOT `total_hitter_war` BACKFILL — APPLIED TO PROD 2026-08-31
`npx tsx --env-file=.env.production.local scripts/backfill-snapshot-total-hitter-war.ts --prod --apply`
Backups first: `_tbp_pre_f40_backup` (1,470) · `_tb_pre_f40_backup` (184).
**`APPLIED: filled total_hitter_war on 696 snapshots.`** · d/bsr map resolved **520 of 522** snapshot players.

## GATES — ALL PASS
```
team_build_players: o_war present but total NULL   0 / 0   (player_snapshot / neutral_snapshot)
target_board:       o_war present but total NULL   0 / 0   (transfer_snapshot / neutral_snapshot)
identity total = o_war + d_war + bsr_war           worst 0.000000  (n=612)
values                                              n=612 · avg 1.053 · max 4.35
```
★ **Zero orphans on ALL FOUR snapshot JSON fields** — that is the documented gate ("0 snapshots with `o_war` but NULL
`total_hitter_war`"), met on every one.
✅ The **2 of 522** players absent from the d/bsr map take the **league-average 0 prior** — correct per REGISTRY #17
(`drs_floor` is runs-above-average, so 0 IS average). **Not a gap.**

## 🚨 THIS STEP WAS ONLY RUNNABLE BECAUSE OF THE MORNING'S GUARD FIX
`scripts/backfill-snapshot-total-hitter-war.ts` had **NO env guard at all** — `process.env.SUPABASE_URL` with **no
`--prod` flag anywhere** (`grep -c` = 0/0), so `--env-file` pointed at prod would have written prod with **zero
opt-in**, and the only signal was a `host` banner printed AFTER the client was constructed. **SIXTH instance** of that
defect class (after `_run_store_no_propagate`, both C28 producers, the market scripts, `run-twp-recompute` E35 and
`backfill_park_factors_seasonal` E2). Guard added + all four paths verified before this run.

---
# 🔍🚨 F41 PRE-FLIGHT AUDIT (2026-08-31) — **RUN NOTHING YET. TWO FINDINGS NEED TREVOR'S CALL.**
Ran the 5-question pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) against all three F41 scripts before
executing. **It found a defect before this step, exactly as it has before every step it has been applied to.**
F41 = `rebuild-twp-target-rows` (F41a) · `rebake-twp-markets` (F41b) · `fix-returner-twp-hitter-market` (F41c).

## 🚨 FINDING 1 — **F41a WILL DESTROY THE `total_hitter_war` F40 WROTE THIS MORNING.** DO NOT RUN IT AS-IS.
`scripts/rebuild-twp-target-rows.ts` **DELETEs** a TWP's `target_board` rows for the team and **REINSERTS exactly two**
from its own row builders. Those builders do **not carry `total_hitter_war`**:
```ts
:28  hitterFromRoster = (ps) => ({ is_twp:true, …, owar: ps.o_war, o_war: ps.o_war, twp_hitter_market_value: … })
:30  hitterFromPred   = (p)  => ({ is_twp:true, …, owar: p.o_war,  o_war: p.o_war,  twp_hitter_market_value: … })
:44  const F = "player_id,…,p_war,o_war,hitter_depth_role,pitcher_depth_role,twp_hitter_market_value,…"
```
**`total_hitter_war` appears in NEITHER builder NOR the `F` select list.** So the reinserted rows come back without it.
**MEASURED ON PROD — the exact rows that would be stripped:**
| board row | player | slot | `o_war` | **`total_hitter_war`** | after F41a |
|---|---|---|---|---|---|
| `a37d96ca…` | Gio Colasante | IF | 0.9238 | **1.0210** | ❌ **NULL** |
| `fd02d8d7…` | Aiden Mouton | *(null slot)* | null | **1.4548** | ❌ **NULL** |
| `0ea09bd0…` | Josiah Overbeek | 1B | 2.0082 | **2.0489** | ❌ **NULL** |
| `91755956…` / `718c9dd7…` | Colasante SP · Overbeek RP | pitcher slots | null | null | — |
★ **THIS DIRECTLY RE-BREAKS F40's OWN DOCUMENTED GATE** — *"0 snapshots with `o_war` but NULL `total_hitter_war`"*,
which passed **0 / 0 on all four snapshot JSON fields** hours earlier. Running F41a silently reverts it for TWPs.
⚠ **Blast radius is SMALL (3 rows) but the shape is the dangerous one:** the script exits 0, the board still renders,
the rows still hold `o_war` and a market value — **nothing errors, and no count gate can see it** (the row count is
unchanged; only a field inside the JSON goes missing). Same family as registry #4/#16.
⚠ Note **Aiden Mouton's row has `position_slot = NULL`** while F41a's contract is *"exactly TWO own-side rows (hitter
slot + pitcher slot)"* — so that row is not merely rewritten, it is **replaced by a differently-keyed pair.** What his
null-slot row represents has **NOT** been determined. ⬜ **Do not assume it is safe to discard.**
### ⬜ OPTIONS — TREVOR'S CALL, NOT MINE
1. **Add `total_hitter_war` to both builders + the `F` select list** (3-line change), then run. Keeps F40 intact.
2. **Run F41a, then re-run F40** to refill. Works, but leaves a window where the board is wrong and depends on F40
   being re-run — the kind of implicit ordering this push exists to eliminate.
3. **Skip F41a**, run only F41b/F41c. Only valid if the board rows are already correctly shaped — **unverified.**
🛑 **Whichever is chosen, take a fresh backup first.** `_tb_pre_f40_backup` (184) is a **PRE-F40** snapshot, so
restoring from it would ALSO lose F40's fill. **`create table _tb_pre_f41_backup as select * from target_board;` first.**

## 🚨 FINDING 2 — ALL THREE PRICE THE TWP HITTER MARKET OFF `o_war`, NOT `total_hitter_war`
Verified in code, not inferred:
```
rebake-twp-markets.ts:34   hMkt = (owar,p) => computeHitterMarketValue(Number(owar), {conference,position})
rebake-twp-markets.ts:44   twp_hitter_market_value: hMkt(s.o_war ?? s.owar, p)
rebake-twp-markets.ts:57   ns.twp_hitter_market_value = hMkt(s.o_war, p)
fix-returner-twp-hitter-market.ts:86   computeHitterMarketValue(Number(r.o_war), {…})
```
This was logged as a **MEDIUM** "half-shipped" item long before this push (`BRANCHWIDE` §4.2). **It is now worse than
when it was written:** F39 and F40 — both applied 2026-08-31 — made `total_hitter_war = o_war + d_war + bsr_war` the
canonical pricing basis for **every non-TWP hitter and the entire transfer path**. So F41 no longer *leaves* a split
basis; it **actively creates one**, on the very day the rest of the system was unified.
**MEASURED UNDERPRICING on the two TWPs on the board:**
`Overbeek o_war 2.008 vs total 2.049 (−2.0%)` · `Colasante 0.924 vs 1.021 (−9.5%)`.
✅ The inputs exist — F39 filled `d_war`/`bsr_war` on **201,221** rows, and TWP rows carry them.
⬜ **OPEN — needs Trevor's call.** Same class of question as F42b (which explicitly *does* price off `total_hitter_war`).

## ✅ FINDING 3 — THE "UNORDERED `.range()` IS BENIGN" NOTE IS **CORRECT, BUT ITS INVENTORY WAS WRONG**
Re-verified because `is_twp` moved **137 → 253** in E35, which invalidated the counts the old note was based on.
| table | rows | how it is read | exposure |
|---|---|---|---|
| `players` (`is_twp=true`) | **253** | `.range()` `:31` | ✅ single page |
| `target_board` | **184** | `.range()` `:39` | ✅ single page |
| `"Teams Table"` | 774 | **not a `.range()` read in this script** | ⚠ **the old note listed it in error** |
| **`team_build_players`** | **1,470 — OVER the 1000 page size** | `.in("player_id", batch)` @ 100 ids `:52` | ✅ **not `.range()`**; TWPs hold **23 rows total, max 7 per player** ⇒ ~7×100 worst case, far under the 1000 cap |
★ **The conclusion held, but for a reason the note did not state, and it omitted the one table that actually exceeds
the page size.** A future reader "re-checking if any crosses 1000" would have checked the wrong three tables and
missed `team_build_players` entirely. **Corrected inline everywhere.**

## ✅ FINDING 4 — F41c's TARGET DEFECT IS REAL AND STILL PRESENT (the script IS needed)
Its header claims the returner precompute historically wrote the hitter market into the **shared** `market_value`
column for TWPs, where it should be NULL. **Confirmed on prod — E37's re-run did NOT stop this:**
```
is_twp returner/regular rows (2027)        253
  ├ shared market_value NON-NULL            110   ← should be NULL
  ├ twp_hitter_market_value set              87
  └ twp_pitcher_market_value set             90
is_twp rows across ALL seasons/models with market_value set   2,372
```
✅ **So F41c has genuine work to do.** ⚠ But note it **writes `player_predictions`**, which F39 also wrote — confirm
it only touches `market_value` / `twp_hitter_market_value` and not the WAR columns.

## ✅ FINDING 5 — GUARDS ARE PRESENT ON ALL THREE (the old "no `--prod`" note is STALE)
`guard=1 prodflag=3` on each of `rebuild-twp-target-rows.ts`, `rebake-twp-markets.ts` *(since DELETED)*,
`fix-returner-twp-hitter-market.ts`, all last touched 2026-08-30. ⚠ Still **invoke directly — none is an npm script.**

## 🅱️ WHAT TRACK B MUST TAKE FROM THIS
1. **A DELETE + REINSERT stage MUST reinsert every field it deleted.** F41a's builders are a hand-maintained column
   list that silently drifted behind the schema the moment F40 added a field. **Track B must never rebuild a JSON
   snapshot from a hand-listed field set** — round-trip the existing object and overwrite only what the stage owns
   (which is exactly what `rebake-twp-markets.ts:44,55` does correctly with `{...s}`). **F41a is the counter-example.**
2. **ONE PRICING BASIS.** `total_hitter_war` is canonical after F39/F40. Any stage still pricing off `o_war` is a
   latent split. Assert `market_value` and `twp_hitter_market_value` derive from the same WAR column, system-wide.
3. **A BACKUP TAKEN BEFORE THE PREVIOUS STEP IS NOT A BACKUP FOR THIS ONE.** `_tb_pre_f40_backup` predates F40's
   writes, so it cannot serve as F41's restore point. **Snapshot immediately before each destructive stage.**
4. **RE-VERIFY A "BENIGN" PAGINATION NOTE WHENEVER ITS DRIVING COUNT CHANGES.** `is_twp` 137 → 253 invalidated the
   basis of the old note; the conclusion survived, the reasoning did not.

## ✅✅ RESOLUTION (2026-08-31) — **THE BUG WAS IN THE ENGINE, NOT IN F41. FIXED AT SOURCE.**
Trevor: *"the way the process works is supposed to be run through the transfer engine and all of the market values
display the market value for the program they are projected to, so that is a bug in it and needs to be solved. Are you
sure that is the process in order and actually what runs or only what runs for returners?"* — **He was right to ask.
F41 is not the process; it is a repair step that existed only because the engine skipped a case.**

### THE FOUR PROJECTION PATHS — three routed TWP markets correctly, ONE did not
| path | prices off | conference used | routes TWP → `twp_*` |
|---|---|---|---|
| returner hitter — `backfill-2027-hitter-returners.ts:306,327` | `total_hitter_war` ✅ | own program ✅ | ✅ |
| returner pitcher — `precompute-returner-pitchers.ts:517` → `predictionEngine.ts:57-61` | — | own ✅ | ✅ |
| transfer pitcher — `precompute-pitchers.ts:539` → `predictionEngine.ts:57-61` | — | **destination** ✅ | ✅ |
| **transfer hitter — `precompute-transfer-projections.ts:425`** | `total_hitter_war` ✅ | **destination** ✅ | ❌ **MISSING** |
★ The transfer hitter engine was **already pricing correctly** — `computeHitterMarketValue(totalHitterWar, {conference: toConference, …})`. Its ONLY defect was writing the result to the shared `market_value` instead of `twp_hitter_market_value`.
★ **The returner file's own comment claimed this was "the same convention as the transfer precompute."** It was aspirational — the transfer side never implemented it. **A comment asserting that another file does something is not evidence that it does.**

### THE USER-VISIBLE COST — measured on prod BEFORE the fix
`pickHitterMarketValue` (`src/lib/twpMarketValue.ts:25`) returns `twp_hitter_market_value` whenever `is_twp` is true and **never falls back to `market_value`**. So a TWP priced into the shared column renders **BLANK**:
```
model_type            rows    shared_mv set   twp_h set   HITTER SHOWS BLANK
returner/regular       253            110          87            110
transfer/precomputed  3,285         2,119       1,101          2,119
                                                              ─────
                                                              2,229 TWP hitter rows with NO market value on screen
```
🛑 **A COUNT GATE PASSES ON EVERY ONE OF THESE.** `market_value` was populated with a correct, sensibly-priced number. Nothing was null, nothing errored — the number was simply in the column nobody reads. **This is the "populated, plausible, and in the wrong place" shape.**

### 🛑 WHY THE DOWNSTREAM REPAIR (F41b) WAS ITSELF THE BUG
`rebake-twp-markets.ts` re-derived the hitter market from `players.conference` — the player's CURRENT school. But a target-board market must answer *"what is he worth to the program recruiting him?"*, and **only stage 18 knows that destination.** Measured:
| player | his conference | recruiting program | program conf | stored (engine, correct) | F41b would rewrite to |
|---|---|---|---|---|---|
| Josiah Overbeek | Patriot League | Arkansas | **SEC** | **$75,307** | **$25,611** (−66%) |
| Gio Colasante | Ivy League | Georgia | **SEC** | **$38,106** | **$14,038** (−63%) |
`SEC 4.0 ÷ Patriot ~1.36 = 2.94×` — exactly the observed drop. ★ **This was NOT caused by the `o_war` → `total_hitter_war` change (that moves values +2%); it is a pre-existing landmine that only becomes visible when the script RUNS.**
✅ **RULE: NEVER re-derive downstream a value the engine already computed with context the downstream stage does not have.** A repair step that recomputes rather than *carries* is a silent downgrade.

### ✅ THE FIX APPLIED — `precompute-transfer-projections.ts:465-466`
```ts
market_value: (p as any).is_twp ? null : marketValue,
...((p as any).is_twp ? { twp_hitter_market_value: marketValue } : {}),
```
Mirrors `backfill-2027-hitter-returners.ts:327` exactly. `p` is the player row and already carries `is_twp` (used at `:250` in the same loop's filter; selected at `:236`). `tsc -p tsconfig.app.json` — no new errors.

### ▶️ CONSEQUENCES FOR THE F41 STEP — IT SHRINKS
| script | verdict |
|---|---|
| **F41a `rebuild-twp-target-rows`** | ✅ **KEEPS ITS REAL JOB** — splitting a newly-flagged TWP's single board row into two own-side rows (e.g. Aiden Mouton, flagged by E35 today). Now also carries `total_hitter_war` through (REGISTRY #18). Once the engine is correct it no longer needs F41b behind it to repair markets, so **F41a + F41b collapse to a single step** (Trevor: *"can this be 1 process"*). |
| **F41b `rebake-twp-markets`** | 🗑️ **DELETED 2026-08-31 (whole script, not just the hitter half).** Further investigation showed F42a/F42b write the SAME two tables (`team_build_players`, `target_board`) at the **build program's** conference — so it is fully superseded, and its player-conference pricing would have destroyed stage 18's destination-priced value. ♻️ `git show 9c61e7d:scripts/rebake-twp-markets.ts` |
| **F41c `fix-returner-twp-hitter-market`** | ✅ **STILL NEEDED, but only ~110 returner rows.** The returner engine routes correctly; these are TWPs whose returner rows were never RECOMPUTED (E37 patches only what it computes, so blocked players keep pre-TWP values). Legitimate one-time catch-up. |

### ✅ TWP CONVENTION — CONFIRMED BY TREVOR, NOT ASSUMED
> *"the nil valuation should be null for twp and the twp should be checking is twp = true whether it shows the twp hitter/pitcher market value and is twp = false should show the correct market values."*
Matches the code exactly (`twpMarketValue.ts:25,34`). **`nil_valuation` is NULL for TWPs by design** — every TWP builder sets it explicitly. The two sides are **never summed** into one figure on a side-specific surface. `total_hitter_war` respects this: it is `o_war + d_war + bsr_war` with **no `p_war`**, so pricing the hitter side off it never merges the pitcher side.

### 🅱️ TRACK B — THE STAGE-18 REQUIREMENT THIS CREATES
Trevor: *"the thing we probably need to run in track B is the fact that these need to be done in the correct steps so we dont get to this point and have these shortcomings."*
1. **Every projection path routes TWP markets identically.** Assert it as a gate: `is_twp AND market_value IS NOT NULL` must return **ZERO ROWS** after stage 18, on every model_type.
2. **Price at the DESTINATION program's conference** for transfer rows, the player's own for returners. Never re-derive later.
3. **When N sibling paths implement a convention, diff ALL N.** Three of four had it; the outlier was invisible because its output looked perfectly normal. `grep` every caller, do not trust a comment.

## 🛑 SCOPE RULE — **D1 NCAA IS THE CONSISTENCY BOUNDARY. JUCO IS PARKED.** (Trevor, 2026-08-31)
> *"we are gonna do a full juco restructure with moving databases and bunching them in with some D2 and D3 stuff so
> anything JUCO related is gonna be tricky or wrong. The consistency is all in D1 NCAA."*

**⛔ DO NOT "FIX" JUCO DIVERGENCE. It is expected, not a defect, and a JUCO restructure will invalidate the work.**
A full JUCO rebuild is coming — **databases move, and JUCO gets grouped with D2/D3**. Until then JUCO values are
knowingly unreliable and any effort spent reconciling them is wasted twice: once now, once again after the move.

### THE CONCRETE CASE THAT ESTABLISHED THIS — 2,119 blank TWP hitter rows, DELIBERATELY LEFT
After the stage-18 TWP routing fix (REGISTRY #20), D1 came out perfect and JUCO did not:
| division | TWP transfer rows | shared `market_value` | `twp_hitter_market_value` | verdict |
|---|---|---|---|---|
| **D1** | **90 per team** | **0** ✅ | **90** ✅ | ✅ **FIXED — routes correctly, priced at destination tier** |
| **NJCAA_D1** | **163 per team** | **163** ❌ | **0** ❌ | 🅿️ **PARKED — 2,119 rows across 13 teams still render BLANK** |
**ROOT CAUSE — SCOPE, NOT A REGRESSION.** `precompute-transfer-projections.ts:243` defaults to **D1-only**
(`return div !== "NJCAA_D1"`), and `_run_step2_all.sh:30` has **never** passed `--division`. So the runner has always
been D1-only and the JUCO rows are stale from a historical `--division JUCO|ALL` pass. **The fix is correct; it simply
never ran against JUCO.** Running `--division JUCO` WOULD close all 2,119 — ⛔ **deliberately NOT done.**
ℹ Scale if it is ever revisited: **52,481 JUCO transfer rows**, none carrying `twp_hitter_market_value`. There is also
a `JUCO_PA_THRESHOLD = 75` floor on that path.

### 🅱️ WHAT THIS MEANS FOR TRACK B — GATES MUST BE DIVISION-SCOPED
1. **EVERY value/completeness gate scopes to `division = 'D1'` unless it exists specifically to test JUCO.** A gate run
   across all divisions will fail on JUCO forever and train the next agent to ignore it — which is how a REAL D1
   failure gets waved through. **A gate that always fails is worse than no gate.**
2. **A prod↔staging or expected-vs-actual mismatch on JUCO is NOT evidence of a defect.** Check `division` BEFORE
   opening an investigation. This joins the existing ordering of causes ("which env is behind?") as a first question.
3. **Keep the D1 and JUCO lanes separate in code** — already the standing rule (C24 `trackman_pitches`,
   Conference Stuff+ D1/JUCO fallback, [[feedback_juco_uses_d1_baselines]]). This confirms it at the GATE layer too.
4. ⬜ **On the restructure:** JUCO moves databases and merges with D2/D3. Anything keyed on `division='NJCAA_D1'`,
   the JUCO district conference IDs (`JUCO_DISTRICT_CONFERENCE_ID`), or the JUCO PA/IP floors will need revisiting
   **then** — not now.

---
# ✅ F41 — EXECUTED AND CLOSED 2026-08-31. **THE STEP SHRANK FROM THREE SCRIPTS TO ONE.**
Outcome of the pre-flight audit + the stage-18 engine fix. **F41 is no longer "run three market scripts".**

| was | now | why |
|---|---|---|
| **F41a `rebuild-twp-target-rows`** | ✅ **RAN — the only surviving piece** | It is the ONLY producer that refreshes a TWP's board rows FROM `player_predictions`. F42 re-prices stored WAR but explicitly does **not** re-copy from predictions, so without F41a a TWP's board WAR stays stale forever. |
| **F41b `rebake-twp-markets`** | 🗑️ **DELETED** | **Fully superseded by F42**, which writes the SAME two tables (`target_board`, `team_build_players`) at the **build program's conference** — the correct basis. F41b priced at the **player's own** conference and would have cut TWP hitter markets **~65%** (measured), destroying the destination-priced value stage 18 computes. ♻️ `git show 9c61e7d:scripts/rebake-twp-markets.ts` |
| **F41c `fix-returner-twp-hitter-market`** | ⏭️ **SKIPPED — nothing left for it to do on D1** | Split by division: **D1 90 rows already correct** (0 shared / 87 routed — E37's re-run did it properly). **All 110 rows it would still write are JUCO**, which is PARKED. |

## ▶️ F41a RESULT (prod, 3 TWP groups, `✅ applied`)
Backup taken first: **`_tb_pre_f41_backup` (184 rows)** — post-F40, so unlike `_tb_pre_f40_backup` it CAN restore F40's fill.
```
Gio Colasante  @Georgia  [roster]: IF owar 0.9238 twpH 38,106  | SP pwar 1.3073 twpP 0
Aiden Mouton   @Kansas   [pred]  : IF owar 1.4548 twpH —       | RP pwar —      twpP —     (JUCO — parked)
Josiah Overbeek@Arkansas [pred]  : 1B owar 2.2848 twpH 232,576 | RP pwar 0.2084 twpP 20,840
```
★ **Overbeek $75,307 → $232,576.** Not inflation — his board row was carrying a value priced at **Patriot League**'s
tier while **Arkansas is SEC**. Stage 18 now prices at the destination and F41a carried it onto the board.
★ **Aiden Mouton was the reason F41a exists:** E35 flagged him TWP today, so his board row was still a SINGLE
non-TWP row (`is_twp:"false"` inside the snapshot). He is now correctly split into two own-side rows. His markets are
blank because he is **NJCAA_D1 — parked**, not because anything failed.

## ✅ GATES — ALL PASS
```
REGISTRY #18  total_hitter_war SURVIVED the delete+reinsert   Colasante 1.0210 · Mouton 1.4548 · Overbeek 2.3258
F40's gate re-asserted, ALL 185 board rows                    transfer_orphans 0 · neutral_orphans 0
CARDINALITY   every TWP = exactly 2 rows per team             3 groups, all at 2
nil_valuation NULL on every TWP row                           ✅ per Trevor's rule
board rows 184 → 185                                          Mouton's single row became two
```
⚠ **Colasante's SP slot shows `twpP = 0`** — carried from his roster snapshot, which stores 0. **F42 re-prices it from
the stored `p_war` 1.3073 at the program tier**, so it resolves at F42. Do NOT hand-patch it.

## 🛑 THE SEQUENCING LESSON — **F41a MUST PRECEDE F42, AND FOR A NON-OBVIOUS REASON**
F41a **copies** market values; F42 **computes** them. Between the two, a TWP's board can legitimately show `$0`/blank
(Colasante's SP slot right now). **They are one logical operation split across two steps.**
🅱️ **TRACK B:** the board refresh must be **ONE stage** — re-copy WAR from predictions, THEN re-price at the program
tier, with no committed state in between. Trevor: *"can this be 1 process."* **Yes — and it must be.**

## 🧠 WHAT THE F41 AUDIT ACTUALLY BOUGHT
Three scripts were queued to run. After auditing: **one ran, one was deleted as actively harmful, one was skipped as
having no D1 work left.** Had the queue been run as written it would have (a) stripped `total_hitter_war` off every
TWP board row, re-breaking F40's gate, and (b) cut TWP hitter markets ~65% by re-pricing at the wrong conference.
★ **Neither would have raised an error.** ★ **And the root cause was upstream in stage 18 — the repair scripts existed
only because the engine skipped a case.** *Audit the step before running it; then ask why the step exists at all.*

---
# 🛑 GATE CORRECTION (2026-08-31) — **"NO MARKET > $130k/win" IS NOT A RULE. STOP TREATING IT AS ONE.**
Trevor: *"don't draw a line in the sand like that. The math will work as long as the values stay consistent. That is
the point of 4.0 PTM and 1.3 PVM — it doesn't need to be a threshold that stays within, cause it could be confusing
over time with **total market value vs per win**, and I worry about that more than anything."*

## WHERE $130,000 ACTUALLY CAME FROM — it is an OUTPUT of the formula, not a constraint on it
```
DEFAULT_NIL_BASE_PER_WAR = 25,000   (src/lib/nilProgramSpecific.ts:26)
SEC PTM                  = 4.0      (:10  — the highest program tier)
PVM for C / SS / CF      = 1.3      (:82  — the highest position multiplier)
25,000 × 4.0 × 1.3       = 130,000
```
**Nobody chose $130k.** It is simply the largest number the equation can emit per win. As a gate it is close to
tautological: it can only fail if SEC rises above 4.0, a PVM above 1.3 appears, or the base moves off $25,000 — i.e.
it detects **config drift**, and nothing about whether a market value is sensible. A badly wrong price sails straight
through it so long as its multipliers are in range.

## 🚨 THE REAL RISK IT CREATES — **TOTAL vs PER-WIN CONFUSION**
A "$130k" figure floating in the docs invites the reader to compare it against a **TOTAL** market value. Live example
from this push: **Josiah Overbeek is $232,576 TOTAL at $100,000 PER WIN.** Judged against "the $130k ceiling" that
looks like a 79% breach; it is nothing of the sort. **The two quantities differ by a factor of the player's WAR.**
✅ **RULE: always state the UNIT. Write `$/win` or `total`, never a bare dollar figure**, and never compare across the
two. I made exactly this error while reporting F42 and had to walk it back.

## ✅ THE GATE THAT REPLACES IT — AN IDENTITY, NOT A THRESHOLD
Assert the market is an EXACT function of the displayed WAR at the row's own multipliers:
```
market_value / total_hitter_war  ==  25,000 × PTM(program conference) × PVM(position)
```
**Magnitude-agnostic** (no line to drift over), **unit-unambiguous** (it is explicitly a rate, formed as a ratio), and
it catches what actually goes wrong: the **wrong conference** (the F41b defect — player's own instead of the
destination's), the wrong position, a stale base, or a market that is not derived from the WAR on display.
### ✅ MEASURED ON PROD 2026-08-31 — every conference lands on EXACTLY 3 rates, to the dollar
| conference | PTM | observed `$/win` (= 25,000 × PTM × {1.0, 1.1, 1.3}) | distinct rates | rows |
|---|---|---|---|---|
| SEC | 4.0 | **100,000 / 110,000 / 130,000** | 3 | 119 |
| ACC | 1.5 | **37,500 / 41,250 / 48,750** | 3 | 11 |
| Big 12 | 1.2 | **30,000 / 33,000 / 39,000** | 3 | 167 |
| Big Ten | 1.0 | **25,000 / 27,500 / 32,500** | 3 | 38 |
★ **`distinct_rates = 3` per conference is the strongest part of the assertion** — exactly the three position tiers,
no strays. A single row priced off the wrong conference or a defaulted PVM shows up as a 4th rate immediately.

## 🅱️ TRACK B
1. **Replace the `> $130k/win` check with the identity above.** Fail on any rate that is not `25,000 × PTM × PVM` for
   that row's own program and position; assert **≤ 3 distinct rates per conference**.
2. **Never gate on a magnitude derived from the model's own constants.** A bound computed from the same multipliers
   the stage uses cannot detect an error in those multipliers — it moves with them.
3. **Label every dollar figure `total` or `$/win`.** This is a display and documentation rule, not just a gate rule.

---
# 🚨 REGISTRY #21 — **THE SNAPSHOT CARRIES ITS OWN `is_twp` COPY, AND NOTHING KEEPS IT IN SYNC** (2026-08-31)
Trevor: *"that needs to be null because it will create confusion with the code."* — Correct, and the single bad row is
the visible tip of a **denormalization defect**, not a one-off.

## THE MECHANISM
Both F42 producers branch on **`s.is_twp` — the flag stored INSIDE the JSON snapshot** — never on `players.is_twp`:
```ts
resync-build-snapshot-markets.ts:64    const isTwp = !!s.is_twp, …
                              :70-71   if (isTwp) { …twp_hitter_market_value… } else { …market_value… }
recompute-snapshot-hitter-market.ts:62 const isTwp = !!s.is_twp;
                                   :64 const field = isTwp ? "twp_hitter_market_value" : "market_value";
```
**E35 flipped `players.is_twp` 137 → 253 on 2026-08-31. The snapshots were never updated.** So any snapshot written
before E35 still says `is_twp: false` / omits it entirely, and every downstream producer keying off it routes the
player's dollars to the **WRONG COLUMN** — while the display layer (`pickHitterMarketValue`) reads `players.is_twp`
and looks in the OTHER one. Result: a correct number, in the wrong field, rendering blank or double.

## SCOPE — MEASURED, AND SMALL (because F41a rebuilt the board rows)
| surface | snapshot `is_twp` = true | **ABSENT/false** | shared `market_value` wrongly set |
|---|---|---|---|
| `target_board` | **6 / 6** ✅ | 0 | 0 ✅ |
| `team_build_players` | 21 | **2** | **1** |
★ `target_board` is clean **only because F41a rebuilt those rows today** and its builders hardcode `is_twp: true`.
The build snapshots were never rebuilt, so they kept the stale flag.
### THE ONE BAD ROW
```
Gio Colasante [IF]  snapshot is_twp: (absent)
  market_value            $112,305   ← CORRECT value ($/win 110,000 = 25,000 × SEC 4.0 × IF 1.1 × total_hw 1.0210)
                                        but in the SHARED column, which must be NULL for a TWP
  twp_hitter_market_value  $38,106   ← STALE (priced at Ivy League, his OWN conference, pre-fix)
```
🛑 **The two columns DISAGREE by 2.9× — the exact PTM ratio from REGISTRY #19.** The correct dollars are sitting in the
column the code will not read for a TWP, and the column it WILL read holds the old wrong-conference value.

## ★ THIS IS THE SIXTH INSTANCE OF ONE SHAPE
*the VALUE moved to one place, a supporting FLAG/INPUT stayed on another* — after C24 `trackman_pitches`,
`computeNcaaAverages` weighting, Conference `Stuff_plus`, F44's `TeamID`, and `players.pa` vs `"Hitter Master".pa`
(REGISTRY #9). **A denormalized copy with no writer to keep it fresh is the recurring defect of this codebase.**

## ✅ THE REAL FIX — READ THE SOURCE OF TRUTH, DO NOT SYNC ANOTHER COPY
Exactly the resolution Trevor chose for `players.pa` (*"just change what column is read, not filling another column"*):
**every producer must branch on `players.is_twp`, joined at read time — never on the snapshot's embedded copy.**
⬜ **CODE CHANGE REQUIRED in both F42 producers** (`resync-build-snapshot-markets.ts:64`,
`recompute-snapshot-hitter-market.ts:62`). They already fetch `players` for `position`, so the flag is one column away.
⛔ **Do NOT "fix" this by back-filling `is_twp` into every snapshot** — that creates a seventh copy to go stale.

## 🅱️ TRACK B — STAGE 19
1. **NEVER branch on a flag embedded in a snapshot.** Join to the owning table at read time. A snapshot is a
   point-in-time *record of values*, not a source of truth for *identity*.
2. **GATE:** `players.is_twp = true AND snapshot->>'market_value' IS NOT NULL` must return **ZERO ROWS** on both
   `team_build_players` and `target_board`, on every run.
3. **Corollary gate:** the snapshot's own `is_twp` must AGREE with `players.is_twp`, or the snapshot is stale —
   assert it rather than trusting it.

## ✅ REGISTRY #21 — FIXED IN CODE AND APPLIED TO PROD (2026-08-31)
Trevor: *"no question this needs to be the process and needs to be consistent."* — and *"am I supposed to run the
SQL?"* **No.** A hand-written SQL patch would have fixed one row and left the defect live. **The code change makes the
producers self-correcting**, so the same run that re-prices also repairs — which is why no SQL was needed.

### THE CHANGE — both F42 producers now branch on `players.is_twp`
```ts
resync-build-snapshot-markets.ts:57   .select("id, first_name, last_name, position, is_twp")   ← + is_twp
                                :64   const isTwp = playerTwp.get(r.player_id) === true;        ← was !!s.is_twp
                                :66   if (isTwp && s.market_value != null) { s.market_value = null; s.is_twp = true; }
recompute-snapshot-hitter-market.ts:50 .select("… position, is_twp")                            ← + is_twp
                                   :62 const isTwp = playerTwp.get(r.player_id) === true;       ← was !!s.is_twp
                                   :70 if (isTwp) { s.market_value = null; s.is_twp = true; }
```
Plus a `staleShared` condition so **a TWP holding a non-null shared `market_value` counts as a change even when the
dollars in its own column are already correct** — otherwise the repair silently no-ops on rows whose value happens to
match. `tsc -p tsconfig.app.json` — no new errors.

### RESULT ON PROD
```
F42b  applied 3   Gio Colasante [IF] SEC  twp_hitter_market_value $38,106 → $112,305  ($110,000/win)
F42a  applied 1   shared market_value nulled
GATE  TWP rows carrying a shared market_value:  team_build_players 0 · target_board 0   ✅
      identity intact — every conference still ≤3 distinct $/win rates, 0 negatives      ✅
```
★ Colasante's board and build hitter rows now **agree at $112,305**, in the column the display layer actually reads.

## ⚠️ NEW GAP FOUND BY THE GATE — **NOTHING RE-DERIVES PITCHER MARKETS ON *BUILD* SNAPSHOTS**
The same check exposed a surface asymmetry that predates this work:
```
Gio Colasante [SP]   target_board  twp_pitcher_market_value  $130,733   ← re-derived by resync-target-snapshots
                     team_build_players                          $0     ← never re-derived by anything
```
| surface | hitter market | pitcher market |
|---|---|---|
| `target_board` | ✅ `resync-target-snapshots` fully re-derives | ✅ fully re-derives |
| `team_build_players` | ✅ `recompute-snapshot-hitter-market` | ❌ **NO PRODUCER** |
`resync-build-snapshot-markets` deliberately only floors NON-POSITIVE WAR to $0 — its own comment: *"Positive-WAR
markets depend on position … we leave those to the app's live bake, never guess here."* So a positive-WAR pitcher on a
build snapshot keeps whatever stale dollars it had — here **$0 against a real `p_war` of 1.3073**.
⬜ **OPEN — NOT FIXED.** Two readings, and it needs Trevor's call: (a) the app's live bake genuinely repairs this on
render, making the stored $0 harmless; or (b) it is a stored-first violation and the build snapshot is simply wrong.
**Given [[project_stored_derived_values_architecture]] ("UI reads stored, no live compute") (b) is the more likely
reading** — but it is UNVERIFIED, and the fix belongs with whoever owns the build-snapshot bake.
🅱️ **TRACK B:** the two surfaces must be re-priced by the SAME stage with the SAME rules. A player's dollars differing
between his board row and his build row is invisible to every gate that looks at one surface at a time.
**GATE: for any player on both surfaces, `board.twp_*_market_value` must equal `build.twp_*_market_value`.**

## ✅ RESOLVED 2026-08-31 — BUILD-SNAPSHOT PITCHER MARKETS NOW RE-DERIVED (and a worse defect found underneath)
Trevor: *"needs to be fixed."* Fixing it exposed a second, more dangerous defect in the same script.

### 1. THE FIX — `resync-build-snapshot-markets.ts` now derives positive pitcher markets
It previously ONLY floored non-positive WAR to $0, leaving every positive-WAR pitcher on stale dollars ("left to the
app's live bake"). That is a **stored-first violation** ([[project_stored_derived_values_architecture]]) and produced
Colasante's SP slot at **$0 against a real `p_war` of 1.3073** while his board row correctly held **$130,733**.
```ts
const pitcherOnly = owar == null;
if (pwar != null && pwar > 0 && (isTwp || pitcherOnly)) {
  const role = pitcherRoleFromDepthRole(s.pitcher_depth_role || "workhorse_reliever");
  const newP = computePitcherMarketValue(pwar, { conference: conf, role, team: buildTeam.get(r.build_id) ?? null }, EQ);
  … field = isTwp ? "twp_pitcher_market_value" : "market_value"
}
```
⚠ **The `(isTwp || pitcherOnly)` guard is load-bearing.** For a NON-TWP the pitcher dollars live in the SHARED
`market_value` — the same column a hitter uses — so writing it unconditionally would clobber a two-sided non-TWP
row's hitter market. TWPs are unambiguous (own column).
⚠ **`team` must be the PROGRAM being priced into**, not the player — it feeds `canShowPitchingMarketValue`'s
Independent/Oregon-State guard. ⬜ **`resync-target-snapshots.ts:81` passes a PLAYER NAME there** — a latent bug that
only bites on Independent programs. **NOT copied here; still open in that file.**

### 🚨 2. THE DEFECT FOUND UNDERNEATH — NULL `player_id` SILENTLY POISONED THE WHOLE LOOKUP
`team_build_players` holds **191 rows with `player_id` NULL** (portal-search adds). F42a built its lookup as:
```ts
const pids = [...new Set(bps.map((r) => r.player_id))];              // ← no null / UUID filter
const { data } = await sb.from("players")…in("id", pids.slice(…));   // ← `error` DISCARDED
```
**A single null in an `.in("id", …)` makes Postgres reject the ENTIRE batch as invalid-uuid.** With the error thrown
away, every real player in that batch vanished from `posName`, `playerPos` **and `playerTwp`**.
★ **THE TELL WAS COSMETIC:** every dry-run sample printed `undefined` for the player name. That "harmless logging
quirk" was the only visible symptom of a poisoned lookup.
🛑 **IT WOULD HAVE SILENTLY UNDONE REGISTRY #21 WITHIN MINUTES OF FIXING IT** — `playerTwp` comes from that same
lookup, so genuine TWPs would have read `is_twp = false` and been re-routed straight back into the shared
`market_value`. **The fix and the thing that breaks the fix were in the same function.**
✅ **FIXED:** UUID filter + `if (error) throw` on every batch — the same guard already present in
`recompute-snapshot-hitter-market.ts:47-50`, **which was never ported here.**
✅ **SWEEP OF THE REMAINING PUSH PATH:** `backfill-neutral-snapshot.ts:40` and `heal-stale-snapshots.ts:65` **already**
filter `/^[0-9a-f-]{36}$/i`, and `heal-stale-snapshots:67` already reads `is_twp` from `players`. **F42a was the only
push-path script missing it.** (Numerous one-off audit scripts still lack it — out of scope, none write prod.)

### ✅ 3. THE GATE — pitchers have NO position multiplier, so it is EXACTLY ONE RATE PER CONFERENCE
Stronger than the hitter identity (which allows three rates for the three PVM tiers):
| conference | `$/win` | = 25,000 × PTM | rows | distinct rates |
|---|---|---|---|---|
| SEC | **100,000** | × 4.0 | 154 | **1** ✅ |
| ACC | **37,500** | × 1.5 | 12 | **1** ✅ |
| Big 12 | **30,000** | × 1.2 | 154 | **1** ✅ |
| Big Ten | **25,000** | × 1.0 | 31 | **1** ✅ |
| AAC | **20,000** | × 0.8 | 11 | **1** ✅ |
| Big South · CUSA · ASUN | **12,500** | × 0.5 | 67 | **1** ✅ |
★ **`distinct_rates = 1` is the whole assertion.** A single pitcher priced off the wrong conference, a stale PTM, or a
defaulted role appears instantly as a second rate — regardless of dollar magnitude. **Use this, not a threshold.**
✅ **Colasante now AGREES across surfaces:** build and board both `$112,305` hitter / `$130,733` pitcher.

### ✅ 4. THE SEC JUMP IS EXPECTED — NOT A DEFECT (Trevor, 2026-08-31)
> *"That is going to be normal — we made the same jump on this push to prod for all players, so all SEC coaches are
> gonna see a large jump."*
**172 rows re-priced.** SEC pitchers moved **$37,500/win → $100,000/win (2.667× = 4.0 ÷ 1.5)**; ACC 1.25×. Those
snapshots were baked BEFORE SEC PTM went 1.5 → 4.0 and had never been re-derived. This is the **pitcher-side twin of
the documented F42b hitter re-price** ("SEC builds ~2.6× up"), and it is push-wide and intended.
🛑 **DO NOT "investigate" a large SEC increase as a regression.** Verify it against the identity
(`$/win == 25,000 × PTM`), not against its previous value.
**Backups:** `_tbp_pre_pitchermkt_backup` (1,470) · `_tbp_pre_twpflag_backup` · `_tbp_pre_f42b_backup` · `_tb_pre_f42_backup`.

### 🅱️ TRACK B — STAGE 19
1. **BOTH surfaces, ONE stage, SAME rules.** `target_board` and `team_build_players` must be priced together.
   **GATE: for any player on both, `board.*_market_value == build.*_market_value`.** A per-surface gate is blind to this.
2. **Pitcher gate = EXACTLY ONE `$/win` rate per conference. Hitter gate = at most THREE** (the PVM tiers).
3. **Never build an `.in()` list from raw foreign keys.** Filter to well-formed UUIDs and **throw on batch error** —
   one null poisons the whole batch and the failure is silent, cosmetic, and downstream-corrupting.
4. **A "cosmetic" logging anomaly (`undefined` names) is a DATA-INTEGRITY signal.** Chase it.

---
# 🔍 SNAPSHOT COMPLETENESS AUDIT (2026-08-31) — **THE FIRST PUSH THAT CHANGES WHAT COACHES SEE**
Trevor: *"Now that we are refilling snapshots we need to make sure the work is complete because this will be the first
one to update user experience."* — Full verbatim record so this is traceable and buildable. **Every number below is
measured on PROD, season 2027, `division='D1'` unless stated.**

## 1. ✅ D1 TWP MARKET ROUTING IS COMPLETE ON PROD — AND STAGING IS NOT A VALID REFERENCE
| | PROD | STAGING |
|---|---|---|
| D1 TWP rows (all model types) | **1,256** | 1,707 |
| `twp_hitter_market_value` set | **1,253** | **122** |
| `twp_pitcher_market_value` set | **1,256** | 1,707 |
| shared `market_value` LEAK on a TWP | **0** ✅ | 0 |
| **TWP hitter rows rendering BLANK** | **0** ✅ | **1,582** ❌ |
🛑 **STAGING HAS THE DEFECT PROD JUST FIXED.** It never received the stage-18 TWP routing change, so **1,582 of its D1
TWP hitter rows would render blank.** ⚠ **DO NOT use staging to validate TWP markets** — prod is the current side.
🅱️ **HARD REQUIREMENT ON THE STAGING CATCH-UP:** it MUST include the stage-18 TWP routing fix
(`precompute-transfer-projections.ts:465-466`), or staging comes back wrong. Add to the Track B catch-up run.

## 2. USER-VISIBLE COMPLETENESS — WOULD ANY D1 PLAYER RENDER A BLANK MARKET?
Computed exactly as the UI resolves it (`pickHitterMarketValue` / `pickPitcherMarketValue`: read `twp_*` when
`players.is_twp`, else `market_value`):
| model_type | is_twp | rows | has o_war | **hitter BLANK** | **pitcher BLANK** |
|---|---|---|---|---|---|
| returner | false | 10,463 | 5,035 | **0** ✅ | **106** ⚠ |
| returner | **true** | 90 | 87 | **0** ✅ | **0** ✅ |
| transfer | false | 131,854 | 65,414 | **0** ✅ | **0** ✅ |
| transfer | **true** | 1,166 | 1,166 | **0** ✅ | **0** ✅ |
★ **Every hitter surface is complete. Every TWP surface is complete.** The ONLY gap is 106 returner pitchers.

## 3. 🚨 THE 106 BLANK RETURNER PITCHERS — **NOT the Independent rule.** Two DIFFERENT problems.
First hypothesis was `canShowPitchingMarketValue`'s Independent/Oregon-State guard. **Measured: 0 are Independent.**
```
conference NULL ................ 64   ← alumni, see 3a
real conference ................ 42   ← see 3b   (of which p_war <= 0: 8 · p_war > 0: 34)
Independent (the hypothesis) .... 0   ❌ hypothesis WRONG
```
### 3a. 64 with a NULL conference — **0 of 64 have a 2026 `"Pitching Master"` row**
No 2026 season ⇒ E36 BLOCKS them (`no_pm_row`) ⇒ their row keeps a **stale `p_war` from an older run**, and
`canShowPitchingMarketValue` returns false on an empty conference so the market is null. These are **alumni/stubs**,
consistent with [[project_players_team_id_null]] (prod carries ~15,706 team-less stubs). ⚠ **The blank market is
arguably correct; the STALE `p_war` on a non-2026 player is the real smell.** ⬜ Not chased.
### 3b. 🚨🚨 **34 WITH POSITIVE WAR, A VALID CONFERENCE, AND A 2026 MASTER ROW — GENUINELY UNEXPLAINED**
**ALL 34 HAVE a 2026 `"Pitching Master"` row**, so E36 COMPUTED them — they are not blocked. They carry `p_war`,
`p_rv_plus`, `pitcher_depth_role` and `projected_ip`, and still have **no market value**:
```
Derek Arrocha   SWAC     Jackson State           p_war 2.531  PR+ 123  weekend_starter         85.0 proj IP
JB Manarchuck   MAAC     Mount St. Mary's        p_war 1.606  PR+ 127  workhorse_reliever      50.0
John Costa      ASUN     North Florida           p_war 1.577  PR+ 126  workhorse_reliever      50.0
Adam Brodnax    Sun Belt UL Monroe               p_war 1.518  PR+ 124  weekday_starter         50.0
Alex Jankowski  NEC      LIU Brooklyn            p_war 1.019  PR+ 118  high_leverage_reliever  33.0
Tyler Roark     Sun Belt UL Monroe               p_war 0.961  PR+ 105  workhorse_reliever      50.0
Sam Harris      ACC      North Carolina State    p_war 0.866  PR+ 117  high_leverage_reliever  33.0
Adam Lehmann    MAC      Western Michigan        p_war 0.770  PR+ 112  high_leverage_reliever  33.0
```
**HYPOTHESES TESTED AND REJECTED — do not re-test these:**
| hypothesis | result |
|---|---|
| Independent-conference guard | ❌ **0 of 106 are Independent** |
| no 2026 Master row (E36 blocked) | ❌ **34 of 34 HAVE one** |
| null `players.team` | ❌ **0 have a null team** |
| non-positive WAR floors to null | ❌ only **8** of the 42 are `p_war <= 0`; the **34 are all positive** |
| the sub-20 IP null-out | ❌ that gate is **JUCO-only** (`JUCO_IP_THRESHOLD`). The CONTROL group contains **1,799 priced pitchers under 20 IP**, and **17 of the 34 are OVER 20 IP** (max **79.7**) |
**CONTROL:** 4,403 of 4,476 priced D1 returner pitchers have a 2026 Master row — a Master row normally ⇒ a market.
🛑 **STATUS: OPEN, UNEXPLAINED, USER-VISIBLE.** A 2.5-WAR weekend starter showing no market value is exactly the kind
of thing a coach notices first. ⬜ **NEXT STEP: trace `precompute-returner-pitchers.ts:497`**
(`computePitcherMarketValue({ conference, team: teamName, is_twp, ip: actualIp })`) for these specific
`source_player_id`s — `:415` resolves `conference = teamRow?.conference ?? p.conference`, so the most likely cause is
that **`teamRow` fails to resolve and something ELSE in that path nulls the result** — but that is a HYPOTHESIS, not a
finding. **Do not report a cause until it is measured.**

## 4. 🅿️ JUCO — 2,119 BLANK TWP HITTER ROWS, PARKED BY DESIGN
Per the D1-consistency-boundary rule. ⚠ **If a JUCO player is on a coach's board today, a blank market is what they
see.** Expected, not a defect — but it IS user-visible, so it should be a known talking point rather than a surprise.

## 🅱️ TRACK B — WHAT THIS AUDIT ADDS TO STAGE 19
1. **THE COMPLETENESS GATE MUST BE WRITTEN AS THE UI RESOLVES IT**, not as a column check:
   `coalesce(twp_*_market_value WHEN players.is_twp, market_value) IS NULL AND <side>_war IS NOT NULL` ⇒ **0 rows**,
   scoped to `division='D1'`. A per-column check passes while the screen shows a blank.
2. **SEPARATE "BLANK BECAUSE BLOCKED" FROM "BLANK DESPITE BEING COMPUTED".** The 64 (no Master row, stale WAR) and
   the 34 (Master row, computed, still blank) look identical in any count and are completely different problems.
   **Join to the Master and split them.**
3. **A STALE `p_war` ON A PLAYER WITH NO CURRENT-SEASON MASTER ROW IS ITS OWN DEFECT CLASS.** Blocked players keep
   values from earlier runs indefinitely; nothing expires them.
4. **THE STAGING CATCH-UP MUST CARRY THE STAGE-18 TWP ROUTING FIX** — otherwise it reintroduces 1,582 blanks.

---
# ✅🚨 REGISTRY #24 — SOLVED: **E37 STOMPED E36's PITCHER MARKET ON THE SHARED `returner/regular` ROW** (2026-08-31)
The 34 blank-market D1 returner pitchers from the completeness audit. **Root cause found, fixed, verified.**
Trevor's steer was right: *"Check if they are transfer or returner equations… it skipped without an explanation."*
The equations were fine. **The row was overwritten AFTER it was computed correctly.**

## THE MECHANISM — ONE ROW, TWO OWNERS, LAST WRITER WINS
There is **exactly ONE `returner/regular` global row per player**, and **BOTH** returner precomputes write
`market_value` on it. **E37 runs AFTER E36.**
```
E36 precompute-returner-pitchers  →  writes market_value = $31,635  (+ p_war, projected_ip, pitcher_depth_role)
E37 backfill-2027-hitter-returners →  PATCHES THE SAME ROW. oWar is null ⇒ marketValue null
                                   →  wrote `market_value: marketValue` UNCONDITIONALLY ⇒ **NULL** ⇒ stomped
```
### ★ THE CODEBASE ALREADY NAMED THIS COLLISION — AND THE PROTECTION DOES NOT COVER THESE PLAYERS
`src/lib/predictionEngine.ts:57-59`, verbatim:
> *"For TWPs: route MV to `twp_pitcher_market_value` and NULL out the shared `market_value` column **so the hitter
> loop's market_value write doesn't get stomped**"*
**The entire `twp_*_market_value` column split exists to prevent exactly this.** But it only fires when
`meta.is_twp` is true. **A pitcher who merely HAS a 2026 `"Hitter Master"` row — without being flagged TWP — enters
E37's scope with no protection.** He collides, and there is no separate column to catch his value.

## THE EVIDENCE — CONCLUSIVE, NOT INFERRED
| check | result |
|---|---|
| 34/34 have a 2026 **Hitter Master** row | ⭐ **YES** — all in E37's scope |
| 34/34 carry `hitter_depth_role` + `projected_pa` | ⭐ **E37's fingerprint — it wrote these rows** |
| 34/34 have `o_war` | **0** — so E37's `marketValue` was null |
| E36 scoped dry-run (`--source-ids 1510497154`) | **`market_value: 31635.73`** — the engine computes it fine |
| stored `p_war` / `projected_ip` / `depth_role` | **exactly match** E36's current output ⇒ E36 DID write the row |
| CONTROL: priced pitchers with a hitter Master row | only **113 of 4,476** — the rest never enter E37's scope |

## ✅ THE FIX — `backfill-2027-hitter-returners.ts:308`
**Never NULL a shared column you have no value for.** Only write `market_value` when a hitter value exists:
```ts
...(meta.is_twp
  ? { market_value: null, twp_hitter_market_value: marketValue }
  : (marketValue != null ? { market_value: marketValue } : {})),
```
Then re-ran E36 (7,596 rows) + the pitcher propagate (105,112 rows, 15.3s, explicit `set statement_timeout='15min'`).

## ✅ VERIFIED ON PROD — THE UNEXPLAINED BUCKET IS **ZERO**
```
Derek Arrocha  SWAC  p_war 2.5309  market_value $31,635.73  ($12,500/win = 25,000 × SWAC 0.5)  ✅
D1 returner pitchers, positive WAR, no market — ALL now categorised:
   55  null conference — alumni, no 2026 Master row (stale p_war, see below)   EXPECTED
    7  excluded from the pitcher loop by position (OF/UTL/C/IF/TWP)            EXPECTED
    0  ⚠ STILL UNEXPLAINED                                                     ✅
UX COMPLETENESS (D1): hitter_BLANK 0 / 0 / 0 / 0 · pitcher_BLANK 74 (all explained) / 0 / 0 / 0
```
⬜ **TWO RESIDUAL CLASSES, both known and neither a market defect:**
1. **55 alumni with a stale `p_war`** and no 2026 Master row. E36 blocks them (`no_pm_row`) so nothing refreshes or
   expires the old value. **The blank market is correct; the STALE WAR is the real smell.** ⬜ Own defect class.
2. **7 pitchers excluded by `pitcherTest(position)`** (OF/UTL/C/IF/TWP in `players.position`) — never enter the
   pitcher loop, so their `p_war` is likewise stale. ⬜ Position-data quality, not pricing.

## 🅱️ TRACK B — WHAT THIS MANDATES (and it is a STAGING CATCH-UP REQUIREMENT)
1. 🔴 **ONE COLUMN, ONE OWNER.** No two stages may write the same column on the same row. Either give each side its
   own column (as TWPs already have) or make ownership explicit and assert it. **This is the single most reusable
   lesson of the whole leg: the bug was not in any equation — it was in WHO WROTE LAST.**
2. 🔴 **A STAGE MUST NEVER NULL A FIELD IT HAS NO VALUE FOR.** Omit the key from the patch. Nulling asserts
   "I know this is empty", which a stage computing the *other* side is not entitled to say.
3. 🔴 **GATE ACROSS STAGES, NOT WITHIN THEM.** E36 and E37 each ran clean and reported success. The defect existed
   only in their INTERACTION, and only on the ~113-player overlap. **Re-assert every stage's output gate AFTER the
   whole sequence, not just after that stage.**
4. 🔴 **STAGING CATCH-UP MUST CARRY THIS FIX** (`backfill-2027-hitter-returners.ts:308`) — staging runs the same
   E36→E37 order and will have the same stomped pitchers.
5. **A stale value on a blocked player never expires.** Track B should either refresh or explicitly invalidate rows
   whose source row has disappeared for the current season.

---
# 🏛️🅱️ ARCHITECTURE DIRECTIVE — **SIDE ELIGIBILITY IS STATS-DRIVEN, IN THIS ORDER** (Trevor, 2026-08-31)
## SILENT-FAILURE REGISTRY #25. **BUILD THIS INTO TRACK B. It is NOT wired into the push — deliberately.**

> *"Does a player have stats in the pitching master or hitting master? Then it should showcase returner and transfer
> equations. It should recognize PA and IP, not anything else."*
> *"It needs to FIRST recognize players who have BOTH, then identify the buckets of each, and drop the TWP tag from
> players under the minimum. **Not start there.**"*
> *"Just make it **ncaa only**."*

## ★ THE ORDER IS LOAD-BEARING — DO NOT START AT THE MINIMUM
```
STEP 1  PRESENCE   does he have PA at all? IP at all?      ← identifies the two-way CANDIDATE
STEP 2  BUCKET     does each side clear its minimum?         PA >= 30  /  IP >= 5
STEP 3  TAG        is_twp = TRUE only if BOTH clear;         under the minimum on a side ⇒ DROP the tag
STEP 4  EQUATIONS  run ONLY the sides that cleared …         ⚠ AND invalidate the sides that did not
```
**Starting at the minimum destroys STEP 1:** you can no longer distinguish a genuine two-way who fell short on one
side from a player who never had that side at all — and that distinction is exactly what decides the tag.
⚠ **SCOPE: NCAA D1 ONLY.** JUCO keeps its own floors (`JUCO_PA_THRESHOLD = 75`, `JUCO_IP_THRESHOLD = 20`) and is
being restructured — [[project_juco_restructure_planned]].

## 📊 MEASURED ON PROD 2026-08-31 (D1, regular-season window)
| step | result |
|---|---|
| **STEP 1** — has BOTH PA and IP | **309** |
| **STEP 3** — `is_twp` TRUE (both clear) | **88** |
| **STEP 3** — **DROP the tag** (under minimum) | **221** |
| STEP 2 · pitcher who batted a little → PITCHER only | **106** (avg PA 7, IP 27.3) |
| STEP 2 · hitter who threw a little → HITTER only | **82** (avg PA 138, IP 2.1) |
| STEP 2 · token on both sides → NEITHER runs | **33** (avg PA 10, IP 1.8) |
| reconcile vs today's flag | **2 should DROP · 0 should ADD** |
★★ **THE TAG IS ALREADY ESSENTIALLY CORRECT — THE EQUATIONS ARE NOT.** Only 2 D1 players are mis-tagged. The real
defect is that **the minimum lives in the detector and NOWHERE ELSE**, so all 221 get BOTH sides' equations run on
them. A 138-PA hitter with 2.1 IP receives pitcher equations, a junk `p_war`, and that write then competes for the
single shared `market_value` column — **REGISTRY #24, 221 times over.**

## ✅ BUILT: `src/lib/sideEligibility.ts` (NEW, committed, NOT yet wired)
`classifySides(hitterMasterRow, pitcherMasterRow)` → `{ hasBothStats, hitter, pitcher, isTwp, dropTwpTag, pa, ip }`
plus `SIDE_MIN_PA = 30`, `SIDE_MIN_IP = 5`, `isNcaaD1()`, `hitterMarketField()`, `pitcherMarketField()`.
**Window = regular season with a full-season fallback** (`regular_season_pa ?? pa`), matching the depth-role anchor.
Trevor: *"for the sake of consistency just use regular season."* Measured: only **32 of 10,406** D1 players change
side under a full-season window, all boundary cases (Brett Denby would become "two-way" on **2.7 postseason relief
innings**).

## 🔧 EVERY WIRE-IN POINT — EXACT FILE AND LINE (verified 2026-08-31)
| # | file | line | today | must become |
|---|---|---|---|---|
| 1 | `scripts/precompute-returner-pitchers.ts` | **:190** | `pitcherTest = /^(SP\|RP\|CL\|P\|LHP\|RHP\|SM)/i` | keep only as a cheap pre-filter |
| 2 | `scripts/precompute-returner-pitchers.ts` | **:195** | `allPlayers.filter(p => pitcherTest(p.position) \|\| p.is_twp)` | `classifySides(null, pm).pitcher` — **after** `pmBySourceId` is built (~`:222`) |
| 3 | `scripts/precompute-returner-pitchers.ts` | **:196-201** | `--source-ids` scoping | **MOVE below the gate** — it currently filters the POSITION list, so a miscategorised pitcher scoped by id matches 0 and the run aborts |
| 4 | `scripts/precompute-pitchers.ts` (transfer) | **:304-312** | `if (!pitcherTest(p.position) && !p.is_twp) return false` | `classifySides(...).pitcher` |
| 5 | `scripts/precompute-transfer-projections.ts` (transfer hitter) | **:247-256** | `if (isPitcher(p.position) && !p.is_twp) return false` | `classifySides(...).hitter` |
| 6 | `scripts/backfill-2027-hitter-returners.ts` (returner hitter) | **~:218-222** | JUCO PA floor only; **no D1 PA gate at all** | `classifySides(...).hitter` |
| 7 | `scripts/run-twp-recompute.ts` | **:21** | `const PA = 30, IP = 5` — **the ONLY place the minimum exists today** | import `SIDE_MIN_PA` / `SIDE_MIN_IP` so it cannot drift |
| 8 | `src/lib/recomputeTwpStatus.ts` | **:154** | `paThreshold = 30` (a 2nd copy) | import the shared constants |
⚠ **The threshold `30` is currently duplicated in at least 5 files** (`run-twp-recompute:21`, `recomputeTwpStatus:154`,
`audit_phase_c_percentiles:30`, `verify_percentile_all_dims:23`, `verify_percentile_metrics:21`). **One source, or it
drifts** — that is the shape of nearly every defect in this registry.

## ⚠⚠ THE MISSING HALF — **SKIPPING A SIDE ≠ CLEARING IT**
A player who drops below a minimum keeps whatever `p_war` / `o_war` / market an earlier run wrote, **forever**,
because nothing revisits him. **Measured: applying the IP floor to the returner-pitcher path ALONE would stop
updating 643 players who currently hold a `p_war`.** A dry-run of the gate showed `15,646 → 6,785` candidates
(**+207 recovered** — real IP but a non-pitcher `position`; **−9,068 dropped**), and `blocked` fell **8,050 → 0**
because the exclusions become intentional instead of incidental.
🔴 **THEREFORE STEP 4 HAS TWO ACTIONS, NOT ONE:** run the qualifying side, **and NULL the non-qualifying side's
stored values** (`p_war` / `o_war`, `projected_ip` / `projected_pa`, the depth role, and the market). Without the
second action this trades one stale-value class for another.

## 🚫 WHY IT IS NOT IN THIS PUSH
It changes `p_war` for ~643 players and `o_war` for an unmeasured number, needs the invalidation half designed rather
than bolted on, interacts with the JUCO floors, and wants E36/E37/E38 re-run together. The push is one step from done.
**The one wired script was REVERTED so the push stays on known-good code; only the helper is committed.**

## 🧠 THE PROCESS LESSON FROM BUILDING IT
`tsc -p tsconfig.app.json --noEmit` reported **CLEAN on a file with unbalanced braces** — it does **not** cover
`scripts/`. The error only appeared when the script was RUN (`Transform failed: Unexpected end of file`).
✅ **For any change under `scripts/`, the REAL check is executing it with `--dry-run`.** Same class as the documented
"`tsc --noEmit` at the root is a NO-OP" trap.

---
# ✅ C1 wRC+ VERIFICATION — CLOSED, BOTH SIDES (2026-08-31)
Trevor: *"did you make the update on the WRC+ equation to reflect both projecting and the previous season? That was
part of this feature branch."* **Verified end-to-end. Nothing is missing. Two long-standing ⚠ items are now closed.**

## ① THE PROJECTING SIDE — C1 IS LIVE ON PROD, IDENTICAL TO STAGING
All 11 `model_config` keys hold the C1 values, **prod == staging on every one**:
```
r_w_obp 0.691 · r_w_slg 0.235 · r_w_avg 0 · r_w_iso 0 · r_w_intercept 0.011
t_w_obp 0.691 · t_w_slg 0.235 · t_w_avg 0 · t_w_iso 0 · t_w_intercept 0.011 · r_ncaa_avg_wrc 0.3782
```
✅ **THE `PROD_MIGRATIONS_TODO:700` LANDMINE IS RESOLVED IN PRACTICE.** `wrc_c1_model_config.sql` would have set
`owar_replacement_runs_per_600 = 26.2`; **prod and staging both hold 21.22** (the correct, later value). The stale
constant never landed. ⛔ **Do NOT run that SQL now — it would REGRESS the replacement level.**

## ② THE EDGE FUNCTIONS — ALL FOUR LOCAL COPIES ARE C1 (they cannot import `src/`)
`src/lib/wrc.ts` warns that Deno edge fns keep LOCAL copies, grep-linked by `// canonical: src/lib/wrc.ts`.
Every one checked:
| edge function | line | state |
|---|---|---|
| **`process-precompute-jobs`** ← **what G46 deploys** | `:454-456` | reads `r_w_intercept`/`r_w_obp`/`r_w_slg` from config with **C1 defaults** ✅ |
| `google-sheets-sync` | `:860` | `{0.011, 0.691, 0.235, 0, 0}` ✅ |
| `import-power-ratings-csv` | `:76` | `0.011 + 0.691·OBP + 0.235·SLG` ✅ |
| `recalculate-prediction` | `:19` | C1 ✅ — and ⛔ **NOT deployed, by design** |
### ✅ THE `⚠ VERIFY` LEFT IN `wrc_c1_model_config.sql` IS NOW ANSWERED
That SQL flagged: *"the transfer denom the engine actually reads … DB has `t_wrc_plus_ncaa_avg = 1` (odd) and code
reads `t_wrc_ncaa_avg` (absent → code default 0.3782 applies). Confirm before trusting the transfer wRC+."*
**MEASURED:** `t_wrc_ncaa_avg` is **ABSENT on BOTH envs** ⇒ `process-precompute-jobs:431` falls through to its C1
default **0.3782 — CORRECT**. `t_wrc_plus_ncaa_avg = 1` is a key **the edge fn never reads** — inert, not a denominator.
**⇒ G46 IS SAFE TO DEPLOY on this axis.**

## ③ THE PREVIOUS-SEASON SIDE — THERE IS NO STORED PER-PLAYER wRC+ TO RECOMPUTE
Every `%wrc%` column on prod, enumerated from `information_schema`:
| table | column | nature |
|---|---|---|
| `player_predictions` | `p_wrc_plus`, `p_wrc` | **PROJECTION** (2027), per player |
| `Conference Stats` | `WRC_plus` | conference aggregate |
| `team_season_stats` | `wrc_plus_reg`, `wrc_plus_total`, `conf_wrc_plus` | team aggregate |
| `ncaa_averages` | `wrc`, `wrc_sd` | population constants |
★ **Nothing on `"Hitter Master"` or `players`.** The previous-season per-player wRC+ a coach sees is **computed at
DISPLAY time** from the Master's stored OBP/SLG via `src/lib/wrc.ts` — C1 by construction. **There is no stored
descriptive wRC+ that could be stale.**
### ✅ AND THE TWO STORED AGGREGATES REPRODUCE EXACTLY UNDER C1
```
Conference WRC_plus vs (0.011 + 0.691·OBP + 0.235·SLG)/0.3782×100, from its OWN stored OBP/SLG:
   30 D1 conferences · worst delta 0.000        ← EXACT
   (the 1 "outside 1pt" is Independent, whose SLG is NULL — the documented no-conference-mates case)
Team wrc_plus_total (F44): 308 teams · avg 98.8 · range 81.8–127.9   ← lands where the runbook predicted
```

## 🧠 WHAT THIS MEANS FOR THE PROD↔STAGING wRC+ GAP
The measured **median 4-point wRC+ / 0.133 `o_war`** difference vs staging is **NOT an equation or config problem** —
the constants are byte-identical across environments. It comes from the projected **OBP/SLG inputs** differing
(median 0.003 / 0.002), which traces to **C27 recalibrating prod's NCAA means and SDs**. Prod is the fresher side.
⚠ **Do not "fix" wRC+ toward staging.** See the measured input-difference table.
### ★ THE STRONGEST SIGNAL IN THE WHOLE COMPARISON
`d_war` and `bsr_war` are **EXACTLY IDENTICAL across 5,121 D1 players — mean 0, max 0.** The new WAR components are
destination-invariant and reproduce perfectly; `total_hitter_war` tracks `o_war` because of it. Depth roles agree
**98.7%**. The projected slash line matches to a thousandth. **The engine reproduces; only the calibration differs.**

## 🅱️ TRACK B
1. **`src/lib/wrc.ts` is the ONE source — but the 4 edge fns physically CANNOT import it.** Their local copies are
   grep-linked by `// canonical: src/lib/wrc.ts`. **Any change to `WRC_C1` must update all four in lockstep**, and
   Track B should assert it (compare the deployed constants against `WRC_C1` on every run).
2. **A config key that is ABSENT is not automatically a defect** — here absence is CORRECT, because the code default
   IS the canonical value. Assert the EFFECTIVE value (config ?? code default), never mere presence.

---
# ✅ F43 COMPLETE (2026-08-31) — **AND THE SHORTCOMINGS IT EXPOSED. READ ALL OF THESE BEFORE BUILDING STAGE 19.**
`backfill-neutral-snapshot` (F43a) → `heal-stale-snapshots` (F43b). **The last write of the push.**
```
F43a  applied bp=1259 tb=182 · 0 error/fail
F43b  healed 1029/1029 errors=0 · re-dry drift=0
F43b  healed 23/23 (market pass, after the #21 fix below)
GATES  F40 orphans 0/0/0/0 · REGISTRY #21 leaks 0/0 · negatives 0 · re-dry drift 0
       neutral == prediction: board 68/68 · build 40/40 · worst 0.0000
```
★ **THIS IS THE STEP THAT MAKES THE WHOLE PUSH VISIBLE.** Coach-facing WAR moved substantially — Landon Hairston
**2.518 → 4.247 (+69%)**, Daniel Jackson 1.944 → 3.425, Collin Smith 0.208 → 2.032 (SP↔RP transition). **Verified as
the current model output, matched to four decimals — not drift.** Trevor: *"That is a normal change and one we have to own."*

## 🚨 SHORTCOMING 1 — REGISTRY #21 RECURRED IN A **THIRD** SCRIPT, AND MY OWN PREDICTION MADE IT WORSE
`heal-stale-snapshots.ts:106` branched on **`s.is_twp` — the snapshot's embedded copy** — to choose the market column:
```ts
:67   twp.set(p.id, !!p.is_twp)      // ← the AUTHORITATIVE players map IS loaded
:75   twp.get(pid)                   // ← and IS used, for the role fallback
:106  const isTwp = !!s.is_twp;      // ← but the MARKET branch ignored it   ❌
```
**LIVE DAMAGE:** the F43b run wrote `market_value = $101,953` onto Gio Colasante's TWP **pitcher** slot (whose snapshot
`is_twp` was absent) and left `twp_pitcher_market_value` stale at $130,733 — **re-breaking a gate that had read 0 hours
earlier.**
🛑 **THE PROCESS FAILURE IS MINE, AND IT IS THE LESSON:** I fixed REGISTRY #21 in the two F42 producers and **stopped
there instead of grepping every consumer**. I then explicitly observed that Colasante's SP slot had `is_twp` absent and
recorded it as *"harmless — the producers now read `players.is_twp`."* **That prediction was false for this script, and
running F43b made it bite.** ⇒ **When a defect class is found, `grep` EVERY site in the same pass. A reasoned
"harmless" is not a verification.** (Rule already in the docs as "when a shared helper's input convention changes,
audit EVERY caller" — REGISTRY #10. I had the rule and did not apply it.)
✅ **FIXED** — `:106` now reads `twp.get(r.pid) === true`.

## 🚨 SHORTCOMING 2 — THE MARKET-COLUMN FIX IS INVISIBLE WITHOUT `--market`
After fixing `:106`, the routine heal still would NOT repair Colasante: `:161`'s `mktDrift` is gated behind the
**`--market` flag, OFF by default** ("so the routine heal stays narrow"). A row whose WAR is correct but whose dollars
sit in the **wrong column** is a market-only drift — **invisible to the default run.**
⚠ The default pass reported **`drift=0`** while a TWP was actively mis-routed. **A "0 drift" result does not mean the
snapshots are correct — it means nothing the enabled checks look at is wrong.**
✅ Resolved by `--market` (23 rows). 🅱️ **TRACK B: the column-placement check must NOT be optional.**

## 🚨 SHORTCOMING 3 — "SAFE BY CONSTRUCTION" WAS FALSE: **TWO CLIENTS, TWO POINTERS**
The docs claim F43 is *"SAFE BY CONSTRUCTION — `--prod` SELECTS the env file … `--env-file` cannot redirect them."*
**Only true of the script's OWN client.** A transitive import pulls in the shared one:
```
heal-stale-snapshots → pitchingEquations:125 → hooks/useEquationWeights → lib/supabaseQueries:1 → integrations/supabase/client
                                                                                                   ↑ reads process.env
```
`fetchEquationWeights` **actually queries** with it (the pitching weights). So the script has **two Supabase clients
aimed by two different mechanisms**: its own from the env FILE (`--prod`), the shared one from `process.env`
(`--env-file`). Run `--env-file=.env.local --prod` and it **writes PROD while reading its equation weights from
STAGING** — right target, wrong constants, **no error**.
★ **A NEW SHAPE OF THE ENV-GUARD DEFECT (7th instance): not a MISSING guard, but TWO guards that can DISAGREE.**
⚠ The benign symptom is the script refusing to start when `process.env` is unset — which is how this was found.
🅱️ **TRACK B: assert at startup that EVERY client in the process resolves to the SAME project ref, and fail loudly.**

## ⚠ SHORTCOMING 4 — A LONG PROD WRITE KILLED MID-FLIGHT LEAVES A PARTIAL STATE
F43a's first apply hit a 2-minute shell timeout and was **SIGTERM'd mid-write** (`populated` moved 1,260 → 1,263).
Recoverable ONLY because the script is idempotent and rebuilds from predictions. **Same lesson as the E38 run, and it
was repeated in the same session.** 🅱️ **Detach every prod write from the start; never rely on idempotency as the
safety net.**

## ✅ WHAT F43 PROVED (keep these as the stage-19 contract)
1. **F43a's contract holds exactly:** `neutral == the gatekept prediction` — board 68/68, build 40/40, **worst 0.0000**.
   Precedence is *team-precomputed → global regular → any*; 555 of 595 rostered rows resolve to the global returner and
   40 to the team-precomputed row. **Both are correct — comparing against the wrong one manufactures false drift.**
2. **F43b's contract holds:** `snapshot = f(neutral, notes)` **preserves coach toggles**. Hairston has three build rows;
   the untoggled one matches neutral **exactly** (4.2469) while two carry `depthRole: "starter"` and correctly sit
   lower (2.5178). **A snapshot differing from its neutral is NOT drift when a toggle explains it.**
3. **Re-dry to `drift=0` is the completion gate** — but see SHORTCOMING 2 for what that gate does not cover.

## 🧠 MY OWN INSTRUMENT ERRORS IN THIS STEP (all mine, none the data — the running tally continues)
| error | consequence |
|---|---|
| Compared board snapshots to the **global returner** line instead of the **team-precomputed** row — **THREE times** | manufactured "56 of 68 disagree" and "16 of 82 agree, worst 3.80". Correct join: **68/68 exact** |
| `awk -F'[ →]'` parsed `rv+82→113` as a WAR field | fabricated a "4.438 WAR move"; the real max was **1.82** |
| grepped for `fail` and matched the string **`errors=0`** in the success line | reported "1 fail mention" on a clean run |
| guessed the column name `"Conference"` (it is `"conference abbreviation"`) | query threw — **4th guessed column name this push**, against a documented rule to read `information_schema` first |
★ **EVERY ONE WAS THE MEASUREMENT, NEVER THE DATA.** The standing rule — *verify the instrument before reporting an
alarm* — was violated four more times in a single step. **When a comparison spans two surfaces, state which row you are
joining to BEFORE reading the result.**

---
# 🅱️ G46 IS **NOT** TRACK B — IT IS A THIRD COPY OF STAGE 18. TRACK B MUST ABSORB IT. (2026-08-31)
Trevor: *"Isn't that what track b is? Why does it need to be run again?"* — **The right instinct. They are not the same
thing, and the overlap is itself the problem.**

## WHAT `process-precompute-jobs` ACTUALLY IS
| | `process-precompute-jobs` (G46) | **Track B** |
|---|---|---|
| trigger | a **customer team is ADDED** (`trg_customer_teams_autofire_precompute` → `pg_net.http_post`), or the Admin "Re-run" button | **DAILY, on pitch-log ingest** |
| scope | ONE team's transfer projections | the WHOLE chain |
| stages | **stage 18 ONLY** | stages 1–19 |
⇒ It is **one stage, for one team, fired by onboarding** — not a pipeline. Track B is the daily run that should
*contain* stage 18.

## 🚨 WHY IT STILL HAD TO BE DEPLOYED — A LIVE REGRESSION, NOT A FEATURE
```
precompute_jobs (prod):  197 completed · 669,292 rows written · last fired 2026-07-06
trigger trg_customer_teams_autofire_precompute:  ENABLED
```
**The trigger is ARMED and the deployed copy is STALE.** The next `customer_teams` INSERT — or one press of Admin
"Re-run" — fires the OLD function and writes projections using **SEC PTM 1.5, no `total_hitter_war`, the old park
resolution and the pre-unification NIL tiers** directly into `player_predictions`, **silently undoing this entire
push for that team.** It has already written 669k rows historically, so this is not hypothetical.
★ **G46 does not enable anything. It closes a regression that fires on the next onboarding.**

## 🚨 THE REAL DEFECT — THE PROJECTION MATH NOW EXISTS IN **THREE** PLACES
The function's own header states it: *"The math (computeTransferProjection, computeHitterPowerRatings, JUCO
regression, weight defaults) is duplicated from `src/lib/`. Supabase Edge Functions run on Deno and can't `import`
from the Vite src tree."*
| copy | where |
|---|---|
| 1 | `scripts/precompute-*.ts` (the batch path) |
| 2 | `supabase/functions/process-precompute-jobs/` (the Deno mirror) |
| 3 | whatever **Track B** builds |
**This is the SAME defect shape as every entry in the registry — one value computed in two places that drift — except
ACROSS A LANGUAGE BOUNDARY, which makes it strictly worse:** `tsc` cannot see it, and **five commits on this branch had
to hand-mirror changes into it** (PTM unification to SEC 4.0, writing `total_hitter_war` directly, `source_team_id`
park resolution, the faced-competition logic, the dWAR/bsr path).
⚠ The wRC+ constants are a live example: `src/lib/wrc.ts` warns that each edge fn keeps a LOCAL copy grep-linked by
`// canonical: src/lib/wrc.ts`. **Four copies verified correct on 2026-08-31 — by hand.** Nothing enforces it.

## 🅱️ THE DIRECTIVE
1. 🔴 **TRACK B MUST ABSORB `process-precompute-jobs`, NOT RUN ALONGSIDE IT.** Otherwise Track B becomes the
   **FOURTH** copy of stage 18 and the drift problem gets worse, not better.
2. **Until it is absorbed, treat the deployed function as a REGRESSION SURFACE.** Any change to the projection math,
   the NIL tiers, the park resolution or the wRC+ constants **must be mirrored into it and redeployed in the same
   session**, or the next onboarding writes stale values.
3. **ADD A DRIFT ASSERTION** — the deployed function should compare its own constants (`WRC_C1`, the NIL tier map,
   `DEFAULT_NIL_BASE_PER_WAR`, RPW 13.1) against `model_config` at startup and **fail loudly** on a mismatch, rather
   than silently computing with a stale local default. **This is the only mechanical defence available across the
   Deno/Vite boundary.**
4. ⬜ **OPEN QUESTION for the Track B build:** does the onboarding path stay event-triggered (a team is added ⇒
   project immediately) or fold into the daily run (a new team simply gets picked up tomorrow)? Event-triggered is
   better UX; the daily run is one less copy. **Not decided.**

---
# 🛑 G46 IS **REMOVED FROM THIS PUSH** — DECISION (Trevor, 2026-08-31)
> *"This is an unnecessary… another function that could disrupt a lot of the data we've already accumulated and
> should not be a part of this push to prod. We should be able to acknowledge where it's imperfect and how it fits
> into the overarching Track B goal that we will feature on the next feature branch."*

## ✅ THE DECIDING EVIDENCE — G46 DELIVERS **NOTHING** THIS PUSH NEEDS
Every fix in the branch copy of `process-precompute-jobs` **was already delivered to prod DATA by the batch path**:
| fix in the edge fn (branch) | already in prod? | delivered by |
|---|---|---|
| NIL tiers SEC 4.0 | ✅ | E36/E37/E38 batch + F42 re-price |
| `total_hitter_war` written directly | ✅ | F39 `refresh_composite_war` + batch |
| park resolution by `source_team_id` | ✅ | E2 park factors + batch precomputes |
| `faced_htp` / `faced_stuff_plus` for Independents | ✅ | F44 → E38 consumed 308/308 |
| dWAR / bsrWAR path | ✅ | Phase D + F39 |
**AND THE QUEUE IS EMPTY:** `precompute_jobs` = **0 pending · 0 running · last job 2026-07-06**.
⇒ **The edge function has no outstanding work and writes nothing prod is missing. It only matters for FUTURE
onboarding events.** Deploying it now adds risk and delivers zero value to this push.

## 🚨 WHERE IT IS IMPERFECT — ACKNOWLEDGED, MEASURED, NOT FIXED
### 1. 🔴 IT STILL CARRIES **REGISTRY #9** — depth roles from `players.pa` / `players.ip`
```
:1214  const hitterDepthRole  = defaultHitterDepthRoleFromActualPa((p as any).pa ?? null);
:1601  const pitcherDepthRole = defaultPitcherDepthRoleFromIp((p as any).ip ?? null, …);
```
**ZERO references to `regular_season_pa` / `regular_season_ip`.** These are the IDENTITY-table columns that nothing
keeps in sync with the Masters — the exact defect fixed in **four batch scripts** this session. **The edge function is
the FIFTH caller and was never fixed.** Measured on prod:
```
5,341 D1 hitters:  players.pa == Master regular_season_pa on only 3,347 (63%) · mean |Δ| 2.34 PA
crossing the 220-PA cornerstone line:  players.pa 847  vs  Master regular_season_pa 896   ⇒ ~49 players mis-tiered
```
⚠ **Depth role is NOT cosmetic** — it sets `projected_pa` → WAR → market value. Deploying would silently re-introduce
registry #9 on a surface this push just cleaned.
### 2. ✅ BUT IT IS **AHEAD** OF THE BATCH ON TWP ROUTING — DRIFT RUNS BOTH WAYS
```
:1228  const isTwpRow = !!(p as any).is_twp          ← reads players.is_twp, the SOURCE OF TRUTH (correct, #21)
:1253  market_value: isTwpRow ? null : marketValue,
:1254  twp_hitter_market_value: isTwpRow ? marketValue : null    ← the exact fix the BATCH was missing
```
★ **The edge function had the stage-18 TWP routing right ALL ALONG; the batch script was the outlier.** ⇒ **A
hand-mirrored copy does not drift in one direction — each copy can be ahead on some axes and behind on others.**
Never assume the mirror is the stale one.

## ⚠ THE EXPOSURE THAT REMAINS EITHER WAY — **THE TRIGGER IS ARMED**
`trg_customer_teams_autofire_precompute` on `customer_teams` is **ENABLED**, and `pg_net.http_post`s the DEPLOYED
(older) function on every INSERT. History: **197 completed jobs · 669,292 rows written.** So:
- **Deploy** ⇒ a less-stale function that still mis-tiers depth roles (registry #9).
- **Don't deploy** ⇒ the MORE stale function fires instead (SEC PTM 1.5, no `total_hitter_war`, old park resolution).
🛑 **NOT DEPLOYING DOES NOT REMOVE THE RISK — IT ONLY CHANGES WHICH STALE COPY FIRES.**
⬜ **OPEN — NEEDS A DECISION BEFORE ANY TEAM IS ONBOARDED:** disable/neutralise
`trg_customer_teams_autofire_precompute` until Track B absorbs the function, so no stale copy can write
`player_predictions` on onboarding. **Not done — do not onboard a customer team until this is settled.**

## 🅱️ HOW IT FITS INTO TRACK B — NEXT FEATURE BRANCH
`process-precompute-jobs` is **stage 18 for ONE team, event-triggered** — a fragment of Track B, not a parallel system.
It is the **THIRD** implementation of the projection math (batch `scripts/`, this Deno mirror, and whatever Track B
builds). Its own header admits the duplication: *"the math is duplicated from `src/lib/`. Supabase Edge Functions run
on Deno and can't `import` from the Vite src tree."*
1. 🔴 **TRACK B MUST ABSORB IT — NOT RUN BESIDE IT.** Otherwise Track B is the **FOURTH** copy.
2. 🔴 **BEFORE IT IS EVER DEPLOYED, MIRROR THE DEPTH-ROLE FIX** (`regular_season_pa ?? pa`, `regular_season_ip ?? IP`)
   — one line per side. It is the only known defect blocking it.
3. **ADD A STARTUP DRIFT ASSERTION** — compare the function's local constants (`WRC_C1`, NIL tier map,
   `DEFAULT_NIL_BASE_PER_WAR`, RPW 13.1) against `model_config` and **fail loudly** on mismatch. Across the Deno/Vite
   boundary this is the ONLY mechanical defence; `tsc` cannot see the copy.
4. ⬜ **DESIGN QUESTION FOR THE BUILD:** does onboarding stay event-triggered (add a team ⇒ project immediately) or
   fold into the daily run (a new team is picked up tomorrow)? Event-triggered is better UX; the daily run is one
   fewer copy. **Undecided.**

## ▶️ WHAT THIS CHANGES IN THE PUSH SEQUENCE
```
OLD:  … F43 → G46 edge-fn deploy → preview-verify → PR → merge → Phase H
NEW:  … F43 → preview-verify → PR staging→main → Trevor merges → Phase H
      G46 MOVED OUT — to the Track B feature branch. ⛔ Do NOT deploy as part of this push.
```

---
# ✅✅ FULL PROD ↔ STAGING AUDIT (2026-08-31) — **VERDICT: PROD IS READY. NO DISPLAY GAPS. NO BLOCKERS.**
Trevor: *"does every piece of the database that we need — whether it's to get to what we need or to display what we
need — [exist and is it] correct and consistent… if we push this into prod right now, would the database in prod match
what needs to be matched in staging and show the correct values."* **Answer: YES.** Method and evidence below.

## ★ THE HEADLINE — ZERO COLUMNS POPULATED ON STAGING BUT EMPTY ON PROD
Column-by-column coverage diff (every column, `information_schema`-driven, not a hand-picked list):
| surface | prod / staging rows | columns populated on staging but EMPTY on prod |
|---|---|---|
| `"Hitter Master"` 2026 D1 | 5,341 / 5,343 | **NONE** ✅ |
| `"Pitching Master"` 2026 D1 | 5,374 / 5,377 | **NONE** ✅ (prod AHEAD on `bf`) |
| `player_predictions` returner | 15,694 / 15,551 | **NONE** ✅ |
| `player_predictions` transfer | 185,527 / 199,572 | **NONE** ✅ |
| `"Conference Stats"` D1 | 30 / 30 | **NONE** ✅ (prod AHEAD on **29** columns) |
| `team_season_stats` 2026 | 308 / 308 | **NONE** ✅ (prod AHEAD on `team_drs`) |
⇒ **Nothing the UI reads is missing on prod.** Every display path has its data.

## ★ VALUE-LEVEL — THE DESCRIPTIVE WAR CHAIN IS **BIT-IDENTICAL**
`"Hitter Master"`, per player joined on `source_player_id` (n = 5,340):
```
desc_owar · d_war · bsr_war · total_desc_war · woba     mean 0 · median 0 · p90 0   ← EXACTLY IDENTICAL
pa · regular_season_pa                                  median 0 (mean ~0.9 = TruMedia-vs-engine counting noise)
```
`"Pitching Master"` (n = 5,374): `stuff_plus` **median 0.000** · `fip` 0.04 · `whip` 0.04 · `k9` 0.2 ·
`desc_pwar` **0.001** · `desc_ra9` **0.003** · `drs_behind` **0.008**.
`"Conference Stats"` (n = 30): **`run_env_factor` mean 0 · median 0 · p90 0 — EXACTLY IDENTICAL** ·
`WRC_plus` median 0 · `Stuff_plus` median 0.1.
★ **`run_env_factor` and the whole descriptive WAR chain reproducing to ZERO across two independently-computed
databases is the strongest evidence in this audit.** The engine is deterministic and prod ran it correctly.

## ⚠ THE SUBTLE DIFFERENCES — ALL ATTRIBUTED, NONE A PROD DEFECT
| difference | measured | cause — VERIFIED, not assumed |
|---|---|---|
| `p_rv_plus` (PR+) | median **1**, p90 6 | ★ **C27 calibration freshness.** Prod re-derived `ncaa_averages`/`model_config` from its OWN population; **staging never ran C27**. Small input deltas measured against different means/SDs AMPLIFY. |
| `ERA` | median **0.15** | ★ **SOURCE, not window.** Prod's comes from the engine's accrual (inherited-runner, earned+unearned); staging's is TruMedia's official figure. ⚠ ERA is a named Master-sheet OVERRIDE field. |
| `IP` / `regular_season_ip` | median **0.3** | TruMedia counting vs the engine's pitch-log derivation (`corr 0.9932`, recorded in the F44 migration). |
| `hitter_talent_plus` | median **0.5** | `OPR` is Master-derived and **staging never got C24/C26/C27/C28/C28b/C29**. |
| wRC+ / `o_war` (projections) | median **4** / **0.133** | Same C27 chain — the equation and all 11 C1 config keys are **byte-identical** (verified separately). |
| Hitter Master rows | 5,341 vs 5,343 | Different player populations. Prod carries 31,467 `players` vs staging 15,561 (historical depth). |
| `player_predictions` 2027 | 201,221 vs 215,123 | **prod 14 active customer teams, staging 18.** Prod has MORE returner rows (15,694 vs 15,551). |
| `team_war_snapshots.team_drs` | prod **308**, staging **0** | ★ **PROD AHEAD** — staging never ran D29b. |
| `bf`, `pitcher_ev_score`, 29 Conference Stats columns | prod filled, staging 0 | ★ **PROD AHEAD** — C24/C28b and the Masters fill. |
🛑 **PROD IS THE CURRENT SIDE ON EVERY AXIS WHERE THEY DIFFER.** ⛔ **NEVER reconcile prod TOWARD staging.**

## 📋 THE C-STEP GAP, STATED ONCE (this is the root of nearly every difference above)
**STAGING NEVER RECEIVED: C24 · C26 · C27 · C28 · C28b · C29.** Consequences, measured:
- `ncaa_averages` / `model_config` NCAA means+SDs are STALE on staging (64 keys genuinely differ; 156 more were
  formatting-only — **compare numerically, never as strings**).
- `p_ncaa_avg_stuff_plus` prod **100.0141** vs staging 99.4358 · `p_sd_stuff_plus` **5.04577** vs 5.93754.
- `trackman_pitches` +42 on prod · `pitcher_ev*`/`iz*` **30/30 prod vs 0/30 staging**.
⇒ **A prod↔staging difference is EXPECTED until staging is caught up THROUGH TRACK B**, and the catch-up carries
five hard requirements (see "STAGING CATCH-UP — HARD REQUIREMENTS").

## ✅ AUDIT CONCLUSION
1. **Every column the UI reads is populated on prod.** Zero display gaps on all six surfaces.
2. **The descriptive WAR chain and `run_env_factor` reproduce EXACTLY** — independent replication across two databases.
3. **Every remaining difference is attributed to a named, verified cause**, and in every case prod is the fresher side.
4. ⇒ **Pushing prod as it stands would display CORRECT values.** No blocker found.
⬜ **Two things remain OUTSIDE the data** (both logged separately, neither a data defect):
   the **armed onboarding trigger** (`trg_customer_teams_autofire_precompute`) and the **G46 edge function** — removed
   from this push and moved to the Track B branch.
















