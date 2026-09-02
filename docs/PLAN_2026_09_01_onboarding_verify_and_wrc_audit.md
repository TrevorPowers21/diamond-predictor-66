# PLAN — 2026-09-01 · Onboarding verification + wRC+ audit

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


## 🛑 PROD IS BLOCKED

Trevor, 2026-08-31: *"we wont be able to push this into prod until we make sure adding the new team
actually works like i thought you were doing and then a WRC+ audit."*

⇒ **Nothing on `feature/war-recalibration` goes to prod until BOTH gates below pass.** PR #171 stays
open. The branch is green (tsc 154 = unchanged baseline, 265/265 tests, vite build clean, `deno check`
2 errors both pre-existing on HEAD).

---

## WHERE THINGS STAND

### ✅ Fixed — wrong values became right values
| # | fix | evidence |
|---|---|---|
| 1 | **Ghost leaderboard rows** (`Dashboard.tsx`) — filter `players.team_id IS NULL` | 71 stub pitchers in the pop; **1 visible in the top 50: Harrison Cook**, last real season 2024, `p_rv_plus` NULL in all 3 Master rows, shown at 150. 0 hitters affected. |
| 2 | **Scouting column source** (`ReturningPlayers.tsx`) — pitch-log percentile ONLY, no fallback | Stored `*_score` is a DIFFERENT derivation (baseline normalization), not a stale copy. Agreement within 2 pts: stuff 571/4585, whiff 968/4613, bb 1427/4613, barrel 1219/4553. Volantis 69.58 → 76.9. 909/5,522 now blank (689 previously showed a wrong-source number). |
| 3 | **G46 depth-role anchor** (registry #9) | 174/5,322 hitters (3.3%) and 116/5,372 pitchers (2.2%) change tier — all one direction: identity copies carry POSTSEASON volume, so players were tiered a notch high. Matt Lynch 40.333→37.7 IP, Plisinski 25.333→24.7. |
| 4 | **G46 dry-run** | All 11 mutations verified unreachable: 4 behind the `dryRun` else-branch, 5 after the roster early-return (:2023), 2 GM inserts never called, job bookkeeping after the handler return (:2135). |

⚠ #3 was **not** the "2 lines" the docs claimed — `regular_season_*` was selected NOWHERE and the
Pitching Master select did not even include `IP`. The selects had to be widened first.

### 🔎 Detected, NOT fixed — do not mistake these for solved
- **43 consts drift from `model_config`**; **75 have NO counterpart** and silently win — including
  `pwar_ip_sp/rp/sm` and `market_dollars_per_war`. ⇒ **projected IP per depth role and dollars-per-WAR
  cannot be tuned per program today** without a code change + redeploy.
- The drift gate is a **detector**. It reports; it does not correct.

### ❌ Unverified — the honest boundary
- **Edge-fn hitter transfer weights: OK.** 9 of 12 drift from `src/lib`, but all 9 exist in
  `model_config` at the `src/lib` values and the hitter path overlays `model_config`, so the stale
  consts never reach the math.
- **Edge-fn PITCHING constants (109 keys): UNVERIFIED.** No counterpart block was located in
  `src/lib`, so the comparison never ran. **"The pitching constants are correct" is an unearned claim.**
  ⇒ **GATE A must settle this before any deploy.**

---

## GATE A — DOES ADDING A NEW TEAM ACTUALLY WORK?

**Goal:** prove onboarding produces correct numbers *before* it writes anything to a real program.

### A0. Close the unverified-pitching-constants gap (do this FIRST)
Locate the canonical pitching weights in `src/lib` (start `src/lib/pitchingEquations.ts` —
`readPitchingWeights()` returns `PitchingEquationWeights`; find the defaults object it builds from) and
diff all 109 `PITCHING_EQ_DEFAULTS` keys in the edge fn against it.
⚠ Remember the runtime overlay is **NARROW on the pitcher path** — it only applies keys matching
`transfer_*` or `*_plus_ncaa_*`. Every other pitching const (incl. `pwar_runs_per_win`) is **NOT
overlaid**, so a drifted const there genuinely WINS rather than being masked. This makes A0
load-bearing in a way the hitter side is not.

### A1. Deploy the function (dry-run only)
The dry-run cannot be exercised without deploying — the currently-deployed copy is the OLD one.
`supabase` CLI is present (2.98.2).
⚠ Deploying does not itself write data, but the trigger `trg_customer_teams_autofire_precompute` is
**still ENABLED** (verified `tgenabled='O'` on prod 2026-08-31). Once deployed, the NEXT
`customer_teams` INSERT or Admin "Re-run" fires the NEW copy for real. Decide that before deploying.

### A2. Dry-run against an EXISTING team (before-and-after beats a fresh team)
```
POST { "customerTeamId": "<uuid>", "scope": "hitters_d1", "dry_run": true }
POST { "customerTeamId": "<uuid>", "scope": "pitchers_d1", "dry_run": true }
```
Use **Georgia Bulldogs** `9aef3923-0f11-4813-8036-5766b0db64b6` or **Vanderbilt**
`8100792c-5706-40ed-b7c0-c7548df3c946`. An existing team gives a **diff target** — a fresh team gives
one set of numbers with nothing to check them against.
⚠ **Georgia Tech is NOT a customer team.** The 14 are: Arizona State, Arkansas, BYU, Dallas Baptist,
Florida Atlantic, Gardner-Webb, Georgia Bulldogs, Kansas, Penn State, RSTR IQ All-Americans, Stetson,
TCU, Vanderbilt, Virginia Tech. Adding GT is the *last* step, after the gates pass.

### A3. Gates on the dry-run output (VALUE gates — never counts or exit codes)
1. **Market identity:** `market ÷ WAR == 25,000 × PTM × PVM`. Hitters ≤3 distinct rates per conference,
   pitchers exactly 1.
2. **Depth roles moved the RIGHT way:** re-tiered players should move DOWN (postseason inflation
   removed), never up. Expect ~3.3% hitters / ~2.2% pitchers.
3. **TWP routing:** `market_value` NULL, dollars in `twp_hitter_market_value` /
   `twp_pitcher_market_value`.
4. **Drift gate output:** read the `[config-drift:*]` warnings in the response. `criticalMissing` must
   be empty (only `pwar_runs_per_win` is fatal; verified present at 13.1).
5. **Returner rows used:** spot-check a returner — must come from the GLOBAL `variant='regular'` row
   (`predRank` = 2), not another team's precompute.
6. **NOTHING WRITTEN:** response says `"wrote": "NOTHING"`. Confirm in DB that `precompute_jobs` gained
   no row and the team's default build `id` + `created_at` are unchanged.

### A4. Only then — add Georgia Tech
Real run. On a NEW team the default-build DELETE is a no-op, so it is the safe case.
⚠ On an EXISTING team the same path **deletes and recreates** the default build.

---

## ✅ GATE B — **SOLVED 2026-09-01.** It was none of the four hypotheses below.

🛑 **PROD RUNS A DIFFERENT wRC+ EQUATION THAN THE CODE**, because the legacy `"Equation Weights"` table
(Season 2025) OVERRIDES the code defaults at `predictionEngine.ts:379-405`
(comment: *"Equation Weights table values (Supabase, **primary source**)"*), guarded by
`if (eqWeights.size > 0)`.

```
code default (predictionEngine.ts:120 / :316)
    intercept .011 · obp .691 · slg .235 · avg 0   · iso 0    ÷ .3782
prod, overridden by "Equation Weights" 2025
    intercept .011 · obp .450 · slg .300 · avg .15 · iso .10  ÷ .364
```
Computed at `:543`, which multiplies **all four** terms — so on prod AVG and ISO carry real weight
where the canonical formula zeroes them.

**PROOF — n = 5,122 D1 returner hitters, reproducing the STORED `p_wrc_plus` within ±1.5:**
```
Equation Weights formula   5,122   (100%)
canonical formula          1,164    (23%)
```
⇒ That is Lauaki's **113** where canonical gives **100.5**. It also explains the original asymmetry
(**returners 64% mismatched, transfers 19%**): the transfer path has its OWN config block
(`:428-456`) with its own defaults, so it was only partly affected.

★ **THE GUARD IS WHY STAGING LOOKED FINE.** `if (eqWeights.size > 0)` — staging's `"Equation Weights"`
table is EMPTY (0 rows), so the whole override block is SKIPPED there and staging runs the canonical
formula from code. **Prod: 361 rows, live.** Same code, different equation, purely because one table is
populated. ⚠ This is the THIRD environment split found in one day — verify config on BOTH databases.

**BLAST RADIUS of reverting to canonical** — approved by Trevor 2026-09-01 (*"AVG lowering is fine"*):
```
mean −1.43 · median −1.5 · p05 −9.1 · p95 +6.5 · extremes −18.0 / +19.8 · 62% down / 38% up
```
A **redistribution, not a repricing**: the four-stat formula double-counts AVG (ISO = SLG − AVG), so
contact hitters lose and high-OBP walkers gain. wRC+ → oWAR → market are ~linear ⇒ ≈1.5% median
downstream. **This is far smaller than the pitching change** (C1), which shifts every ERA ~0.35 one way.

**THE FIX** = step 1+2 of the config consolidation: rename `"Equation Weights"` →
`"Equation Weights_LEGACY_2025"` (rename, **not** delete — a missed reader must crash loudly rather than
fall back silently), then delete the `:379-405` override block and the dead `model_config`
returner/transfer fallback beneath it. See `docs/HANDOFF_2026_09_01_CONFIG_SOURCES_AND_CALIBRATION.md`.

### 🗄️ SUPERSEDED — the four hypotheses below were all WRONG. Kept only so nobody re-runs them.


### What is already established (do not re-derive)
Canonical (CLAUDE.md): `wRC+ = ((0.011 + 0.691·OBP + 0.235·SLG) / 0.3782) × 100`
`model_config` confirms `r_w_avg = 0`, `r_w_iso = 0` — AVG and ISO are genuinely zero-weighted.

**Trevor's trigger case — Naulivou Lauaki Jr.** (`03b51d16-aed8-436a-b419-eebba3fde58f`,
source `1612594759`):

| variant | p_obp | p_slg | OPS | stored wRC+ | formula |
|---|---|---|---|---|---|
| 2027 `regular`/returner | .336 | .582 | .918 | **113** | **100.5** ❌ |
| 2027 `precomputed`/transfer | .3327 | .5727 | .905 | **99** | 99.3 ✅ |
| 2026 `regular`/returner | .356 | .595 | .951 | **113** | 104.9 ❌ |

🛑 **The 99 is NOT the bug.** It is the formula working: OBP is weighted **~3× SLG**, and his OBP
(.333) is ~45 pts BELOW the D1 average (~.378) while his SLG is well above it. A slugging-driven OPS
lands near 100 by design.
★ **The bug is the 113.** Two returner rows with DIFFERENT inputs both store exactly 113.

**Population scan (season 2027, 4,000 rows each):**
```
RETURNER (regular):      1,426 match / 2,574 MISMATCH   (64% wrong)
TRANSFER (precomputed):  3,229 match /   771 MISMATCH   (19% wrong)
```
Most deviations are small (±3–6); Lauaki's returner is **+13**.

#### (archived) hypotheses — none of these was the cause
1. **`applyDevScale` ordering.** `p_obp`/`p_slg` may be stored POST-scale while `p_wrc_plus` was
   computed PRE-scale (or vice versa). Would explain a systematic small-and-signed gap.
   ⇒ Recompute wRC+ from unscaled inputs and see if the 2,574 collapse.
2. **A different denominator on the returner path.** `0.379946 / 113 × 100 = 0.33624` — but the 2026
   row implies `0.35117`. Two different implied denominators ⇒ probably NOT a constant swap, which
   points back to (1) or to (3).
3. **wRC+ not derived from its own stored OBP/SLG at all** on the returner path (copied, or computed
   from a different source line). ⇒ The fact that TWO rows with different inputs both read 113 is the
   strongest evidence for this. **Test this first if (1) does not explain it.**
4. **Rounding.** Cannot explain ±13; may explain part of the ±3–6 tail.

### Gates on the fix
- Every `p_wrc_plus` reproduces from its own stored `p_obp`/`p_slg` within ±1, on BOTH variants.
- Lauaki's returner rows change (113 → ~100 / ~105), and his transfer row does **not** move.
- `o_war` is recomputed wherever wRC+ changes — `oWAR` is a function of wRC+, so a silent wRC+ fix
  leaves WAR (and therefore market value) stale.

⚠ **Blast radius:** wRC+ → oWAR → `total_hitter_war` → market value → NIL → `player_snapshot` in every
default build. A wRC+ correction is NOT display-only. Scope the downstream recompute before running it.

---

## GATE C — ERA / HR9 CALIBRATION (added 2026-08-31, Trevor: *"eras felt pretty low in projections"*)

### ✅ The two-sided SD IS implemented and IS live on prod — this is not a "did we ship it" question
`model_config` (admin_ui / 2026) carries all six pitching stats with `_ncaa_avg` + `_ncaa_sd` +
`_ncaa_sd_bad`: era 5.483/1.587/2.304 · fip 5.098/1.315/1.869 · whip 1.514/0.257/0.341 ·
k9 8.502/2.340/1.982 · bb9 4.014/1.304/1.763 · hr9 1.062/0.221/0.281.
Built 2026-08-25, commit `57e8f12`. See
`docs/AGENT_LEARNINGS_projection_calibration_two_sided_sd_2026_08_24.md`.

### ★ The original bug IS fixed — verify this stays true, don't re-litigate it
| | before (1-sided SD) | now (prod, measured 2026-08-31) | actual 2026 |
|---|---|---|---|
| elite ERA | 1.13 (impossible) | **2.79** | p05 **2.93** |
| HR9 negatives | 66 | **0** | 0 |
| HR9 min | −0.23 | **0.407** | 0.000 |

### 🔴 C1 — ERA RUNS UNIFORMLY LOW (Trevor's read is correct)
D1, regular-season IP ≥ 40, same 1,181 pitchers projected forward:
```
                  n       mean   p05     p10    median  p90    min
ACTUAL 2026     1,181     5.30   2.93    3.42   5.09    7.52   1.16
PROJECTED 2027  1,181     5.10   2.79    3.19   4.91    7.32   1.15
delta                    −0.20  −0.14   −0.23  −0.18   −0.20  −0.01
ratio proj/actual         0.962  0.952   0.933  0.965   0.973
```
⇒ **NOT a tail problem and NOT the SD.** The shape is right; the whole distribution is shifted down
~3–5%, and the ratios are near-constant, which is the signature of a **multiplicative** adjustment
applied league-wide — i.e. the class-progression (`class_era_*`) and/or `dev_aggressiveness` terms, not
the two-sided SD.
**Investigate in this order:**
1. `class_era_fs/sj/js/gr` — these are in the edge fn's const block with **NO `model_config`
   counterpart** (part of the 75 unbacked keys), so they silently win and cannot be tuned per program.
2. `dev_aggressiveness · 0.06` in `projected = blended × (1 ∓ classAdj ∓ devAgg·0.06)`.
3. Is a league-wide ~4% ERA improvement even intended? The same 1,181 arms a year older should NOT
   collectively improve at every percentile including p90.
⚠ Note the anchor points the OTHER way: `era_plus_ncaa_avg = 5.483` is ABOVE the measured IP≥40 mean
of 5.30, so the calibrated mean would push projections UP. The downward shift is happening downstream
of it. Do not "fix" this by lowering the anchor.

### 🔴 C2 — HR9 IS NOW OVER-REGRESSED (the known holdout, over-corrected)
```
                  mean    p05(elite)   median   p90     min    negatives
ACTUAL 2026       1.011     0.350      0.960    1.650   0.000      0
PROJECTED 2027    1.039     0.620      1.028    1.387   0.407      0
```
Mean is right (+0.03) and the negatives are gone, but the **spread collapsed to ~59% of reality**
(projected p05→p90 range 0.767 vs actual 1.300). Elite HR-preventers project **0.62 when reality is
0.35**; the bad side projects 1.39 vs a real 1.65.
⇒ The HR9 shrinkage (data-K = 71, baked into HR9's mean/SD by `compute-projection-calibration.ts`)
traded the impossible-value bug for the exact failure the 8/24 doc rejected in uniform Pearson shrink:
**"a projection tool whose 'elite' is barely above average fails its one job."**
This is the doc's own open holdout — *"is the HR9 composite over-inflating ratings, or does HR9's
genuinely weak signal (corr 0.32) warrant more regression?"* — still unresolved, now with evidence that
the current answer over-compresses.
⛔ Do NOT fix with a floor or a dial (explicitly rejected 2026-08-24).

### 🔬 C1 narrowing done 2026-08-31 — READ THIS BEFORE RE-INVESTIGATING
Trevor: *"It's consistent so something is scaled improperly which is easier."* Agreed — the evidence
says a single misapplied SCALAR, not a broken model.

**❌ `dev_aggressiveness` is ELIMINATED as the cause.** Measured on the projected rows
(season 2027, `variant='regular'`, `customer_team_id is null`, `p_era` not null, n=7,062):
```
mean 0.000 · min 0 · max 0 · 148 nulls
```
Every value is **zero**, so the `∓ devAgg·0.06` term contributes NOTHING. Do not spend time there.

**⚠ The by-class breakdown did NOT run — `"Pitching Master".class_year` is NULL for all 1,181 rows.**
Re-run it against **`players.class_year`** instead. That test is still the decisive one:
*if graduates/seniors also improve ~4%, it is NOT class progression* and the scalar is somewhere else.

⇒ **Prime remaining suspect: `class_era_fs/sj/js/gr`.** These live only in the const blocks with **NO
`model_config` counterpart** (part of the 75 unbacked keys), so they silently win, cannot be tuned, and
never get validated against anything. Check whether a class adjustment is being applied to players who
should receive none — a default that is not 1.0 applied league-wide would produce exactly the observed
uniform ~0.962 ratio.

**The signature to match:** ratio is 0.962 overall and 0.93–0.97 at every percentile. Whatever is found
must explain a near-constant multiplicative factor, not a tail effect.

### Gates on any C fix
- Re-run the across-the-range table above. Projected percentiles must track actual within ~0.05 ERA at
  p05 / median / p90 — **the whole range, not the mean** (that is the 8/24 doctrine).
- HR9 elite must reach ~0.35, p90 ~1.65, with **zero** negatives.
- ⚠ ERA/HR9 feed `p_rv_plus` → `pWAR` → market value → `player_snapshot`. Any change needs the same
  scoped downstream recompute as the wRC+ fix in Gate B.

## GATE D — TEAM BUILDER vs PLAYER PROFILE DISAGREE BY 1 POINT (added 2026-08-31)

**Reported:** a couple of **Arkansas** players show AVG and OBP **1 point apart** between the Team
Builder row and the Player Profile.

🛑 **THE SIZE OF THE GAP IS NOT THE POINT — THE EXISTENCE OF IT IS.** Trevor, 2026-08-31:
> *"I'm gonna guess it's a dev aggressiveness thing that causes that but the reality is we need to only
> be reading player snapshots for both team builder rows and player profiles so there shouldn't even be
> 1 point of difference cause nothing is live."*

⇒ Do **not** chase the rounding. Under the pure-read architecture
([[project_stored_derived_values_architecture]]) both surfaces read the SAME stored
`player_snapshot`, so the correct difference is **exactly zero**. A 1-point gap is proof that at least
one of the two is still deriving a value at render time instead of reading it. **Find the live compute
and remove it — that is the fix.** The number agreeing afterwards is a side effect, not the goal.

### ✅ DIAGNOSED 2026-09-01 — Trevor's guess was exactly right, and the gap is bigger than 1 point
**The two surfaces read DIFFERENT SOURCES, and one applies a multiplier the other does not:**

| surface | source | transform |
|---|---|---|
| Team Builder (`PlayerTableRow.tsx:612`) | `projection.shown` → `p.prediction ?? p.transfer_snapshot` = the stored **`team_build_players.player_snapshot`** | **none** |
| Player Profile (`PlayerProfile.tsx:1014`) | `regularPred.p_avg` from **`player_predictions`** | **`× devAggScale`** (`:935`) |

`devAggScale = _sessionMult / _storedMult`, where `_storedMult = 1 + devAggClassAdj + storedDevAgg·0.06`
and `_sessionMult` uses the SESSION slider. It equals 1 only when the session slider matches what was
stored.

**Measured on prod (Arkansas, `6deca66a-b4c0-403f-9614-a9d32f1d5994`):**
- **Default build: 0 of 12 differ.** The edge fn writes it from neutral predictions — clean.
- **Saved build "Arkansas Baseball 2027 Roster" (`is_default=false`): 11 of 46 differ from the
  team-scoped row, 20 of 46 from the global row.**
- The deltas are **not** 1 point. A.J. Evasco snapshot `.35424` vs team-scoped `.33456`; Jonathan Gomez
  `.30564` vs global `.357` (~51 points).

**★ The multiplier is EXACT and identifies the cause beyond doubt.** `snapshot ÷ team_scoped` is
precisely `1.02941` or `1.05882`:
```
(1 + 0.02 + 0.5·0.06) / (1 + 0.02 + 0·0.06) = 1.05/1.02 = 1.029411…   ⇒ saved at dev_aggressiveness 0.5
(1 + 0.02 + 1.0·0.06) / (1 + 0.02 + 0·0.06) = 1.08/1.02 = 1.058823…   ⇒ saved at dev_aggressiveness 1.0
```
with `devAggClassAdj = 0.02` and stored `dev_aggressiveness = 0` (confirmed: 0.000 across all 7,062
projected rows). ⇒ **The build snapshot bakes the session dev slider in at save time.** It is not a
stale copy and not rounding — it is a deliberately *adjusted* number being compared against a *neutral*
one.

⚠ **Each player appears TWICE in that build** — once at dev 0.5 and once at dev 1.0 (Evasco, Marin,
Traeger, Zeb Allen all duplicated). Determine whether that is intentional scenario rows or a
duplicate-insert bug **before** any dedupe.

### 🔑 THE DECISION THIS FORCES (needs Trevor)
Trevor's requirement is that **both surfaces read `player_snapshot` and nothing is live**. But the
snapshot currently stores a *dev-adjusted* value, while the profile shows the *neutral* projection
scaled by the session slider. Those are two different quantities, so "read the same thing" requires
choosing which one is canonical:
- **(a)** Profile reads the active build's `player_snapshot` → matches TB exactly, but the profile then
  shows a coach-adjusted number rather than the player's neutral projection.
- **(b)** Snapshots store the NEUTRAL value and the dev slider is applied at render on both surfaces →
  keeps the profile neutral, but then TB is not purely reading either.
- **(c)** Snapshots store BOTH (neutral + adjusted) and each surface reads the field it means.
⇒ **(c) is the only option that satisfies pure-read without losing the coach's adjustment.** Confirm
before building.

**Where to look:**
1. Does the Team Builder row read `team_build_players.player_snapshot`, or re-derive from
   `player_predictions` / the sim? `useTeamBuilderSimulation` re-runs projection math — if the
   displayed AVG/OBP comes from the sim rather than the snapshot, that is the bug.
   ⚠ Related known issue: [[project_teambuilder_owar_snapshot_regression]] — *TB live-rebuilds vs
   snapshot*. This may be the same root cause surfacing on a different column.
2. Does PlayerProfile read stored (`applyDevScale(regularPred?.p_*)`) or compute?
3. `applyDevScale` is the likeliest culprit if one surface applies it and the other does not —
   **note `dev_aggressiveness` measured 0.000 across all projected rows on 2026-08-31**, so if
   dev-scaling explains the gap, something is applying a non-zero scale where the stored value has none.

**Gate:** pick the 2 Arkansas players, read `team_build_players.player_snapshot` and the profile's
source row directly in the DB, and confirm both surfaces render that stored value **byte-for-byte**.
No tolerance band — the architecture says zero.

## 🔴 LOGGED SHORTCOMING (2026-09-01) — SMALL-SAMPLE pRV+ IS DECOUPLED FROM ERA

**Not fixed. Logged deliberately** (Trevor: *"lets just log that as a problem"*). Surfaced while chasing
Harrison Cook on the Top 5; he turned out to be one instance of a class, and not the important one.

### The mechanism — an ABSENT event on a tiny sample reads as EXCELLENCE
`pRV+` is FIP-driven (K/9, BB/9, HR/9); `p_era` is ERA-driven. On a 1–3 inning sample nobody gives up
a homer, so HR/9 = 0, and HR/9 is heavily weighted in projected RA9. The result is an elite rating
sitting next to a terrible ERA. Measured on PROD (2027, `variant='regular'`, active):

| player | actual IP | G | K/9 | BB/9 | **HR/9** | FIP | actual ERA | **pRV+** |
|---|---|---|---|---|---|---|---|---|
| Lucas Dixon | **1.0** | 1 | 9.0 | 0 | **0** | 1.16 | 0.00 | **142** |
| Brad Curtis | **1.3** | 1 | 13.5 | 6.75 | **0** | 2.41 | 47.25 | 133 |
| Andrew Carter | **1.7** | 2 | 22.5 | 4.5 | **0** | 1.16 | 10.80 | 144 |
| Carson Boyer | **2.3** | 3 | **0** | 0 | **0** | 4.79 | 11.57 | 133 |

★ Carson Boyer rates **133 with ZERO strikeouts**. HR/9 = 0 for every member of the set.
`D1 contradictory set: avg 12.4 IP · min 1.0 · max 50 · 13 of 24 under 5 IP.`

### Scale, by division (PROD, all divisions — earlier counts in this doc were D1-scoped)
```
division     pRV+>=120 AND ERA>=6     projected_ip<=10 AND pRV+>=120     total rated
D1                   27                          119                        5,459
NJCAA_D1             53                            0                        1,172
D2                    0                            0                            1
```
- **D1: 119 pitchers with <=10 projected IP can outrank genuine starters** on any pRV+-sorted board.
  All 27 contradictory rows sit at `projected_ip = 6` — the `specialist_reliever` thin-sample tier.
- **JUCO is 53 of the 80 contradictory rows (66%) at ~9x the D1 rate** (4.5% vs 0.5%) — but with
  **ZERO** tiny-IP cases (Reagan King 149 / 7.92 ERA on **30** IP; O'Gorman 136 / 9.28 on **50**).
  ⇒ **A DIFFERENT BUG.** Trevor, 2026-09-01: *"the juco fip is destroyed anyway and wasn't calculated
  properly, which is a future audit."* Consistent with JUCO rating against **D1 baselines** and
  TrackMan skewing to the upper crust. Belongs to the JUCO restructure, not here.
  See [[project_juco_restructure_planned]], `docs/JUCO_AUDIT_2026_05_24.md`.

### Why the `team_id` display filter was the WRONG fix (do not retry it)
Harrison Cook was the only STUB in the set; the other 26 D1 rows are real, current 2026 players.
`team_id IS NULL` was a proxy that correlated on prod and carried **zero** signal on staging
(99.99% NULL there) — it hid one symptom, missed the class, and emptied the list in the other
environment. ⇒ **The rating is what is wrong, not the visibility of the row.**

### When picked up
Same family as [[project_small_sample_pullback]] (`<75 AB / 25 IP` blend prior year). The fix belongs
in the projection, not a display gate: regress the FIP inputs toward the population mean by sample
size, so an unobserved home run on 1 IP stops reading as elite HR prevention.
⚠ Cross-check against the HR9 holdout in
`docs/AGENT_LEARNINGS_projection_calibration_two_sided_sd_2026_08_24.md` — HR9's rating is already the
weakest predictor (corr **0.32**), and this is that weakness showing up at the low-IP tail.

## 🧹 STALE PROJECTIONS — 146 D1 PLAYERS WHO HAVE NOT PLAYED SINCE 2022–2025 (2026-09-01)

Found while chasing Harrison Cook. **Cook was not a special case — he was the highest-ranked of a
population of 146.** Trevor deleted his row manually; the rest are scoped below.

### What they are
D1 players carrying a **2027 projection** with **no 2026 Master row on either side** (hitter or pitcher):
```
players:                          146
  team_id NULL (gone):            145
  still rostered (PROTECT):         1   ← Carson Wiggins, P, Arkansas, last pitched 2025, 14 IP
prediction rows:                  457   (146 regular + 311 precomputed)
by last season played:  2025 → 52 · 2024 → 40 · 2023 → 18 · 2022 → 36
in use on a build:                  0
in use on a target board:           0
```
⇒ **Nothing references them.** Deleting their projections breaks no build, board, or roster.

### 🛑 WHY THE `ip >= 20` GUARD DOES NOT CATCH THEM
The Top 5 filters `players.ip >= 20` — but `players.ip` is the **stale identity copy** from whatever
season they last played. A pitcher who threw 46 innings in 2025 still reads `ip = 46.333` today and
sails through. **69 stale D1 pitchers clear the guard this way.** Ethan Walker (last pitched 2025,
ip 46.3) sits at **pRV+ 143 against a ~144 cutoff** — one data refresh from being visible.
★ This is the SAME identity-copy defect as the depth-role anchor (registry #9), on a different surface.
**Any guard reading `players.ip` / `players.pa` is reading a column nothing keeps in sync.**

### ⚠ THE ONE CASE THAT MUST NOT BE DELETED
A player who **redshirted or was injured through 2026** legitimately has no 2026 Master row and SHOULD
keep his 2027 projection. Exactly one such player exists (Carson Wiggins,
`31d52121-0522-451a-b6dd-a1f2a8e7b9b0`), and `team_id IS NOT NULL` separates him cleanly. **Any future
sweep MUST keep that guard** — the discriminator is "still on a roster", not "has no recent stats".

### Scope decisions
- **D1 ONLY.** JUCO is deliberately excluded pending the restructure.
- Deletes **all variants** (regular + per-team precomputed).
- Not reversible, but safe: nothing references these rows, and the precompute regenerates anything needed.

### ★ THE ACCOUNTING THAT CLOSED THIS OUT
Of the 26 D1 rows with `pRV+ >= 120` AND `ERA >= 6`:
| | count | verdict |
|---|---|---|
| blocked by `ip >= 20` | 19 | small sample, never visible ✅ |
| genuine FIP-vs-ERA divergence | 6 | **working as designed** — Tate Jones 50 IP, FIP 3.29 vs ERA 5.94; Kalkbrenner 42.3 IP, FIP 4.32 vs ERA 9.35. A FIP-based metric is SUPPOSED to flag peripherals outrunning run prevention. NOT a bug. ✅ |
| stale stub | 1 | Ethan Smith, last pitched 2023 ⚠ |
⛔ **There are TWO Ethan Smiths** — a 2023 stub and a real 2026 pitcher. Same trap as Harrison Cook.
**Any cleanup must key on `player_id`, never on name.**

## ✅ CLOSED — THE 191 NULL-`player_id` ROWS ARE **CORRECTLY** UNLINKED. DO NOT RELINK.

Investigated and **closed without writing**, 2026-09-01. `scripts/relink-build-player-ids.ts` exists
(dry-run default, `--active-only`, `--list`) and stays as documentation of what is recoverable. The
answer is: **nothing.**

### Why — the orphans are FRESHMEN, and the "matches" are other people
Trevor's question — *"are they not freshman?"* — is what closed this out. It is the right read:
```
production_notes on the unmatched orphans:  classTransition "FS"  rosterStatus "returner"
   Aj Calio · Bo Holloway · Brody Carr · Eli Herst · Gunner Skelton   [Vanderbilt Projected]
   Grey Sanders                                                       [2027 Proj Jayhawks]
```
**`FS` = freshman.** They have no `players` row because they have **no college stats yet**. The 35
"no match" skips are the system behaving correctly, not a data gap.

### 🛑 ALL SIX PROPOSED MATCHES WERE THE WRONG PEOPLE
| proposed match | what that `players` row actually is |
|---|---|
| Ned Frutchey | D1, **no team**, last pitched **2025** |
| Payton Gubler | D1, **no team**, last pitched **2025** |
| Rockwell Lybbert | D1, **no team**, last pitched **2025** |
| Jaxon Grossman | D1, **no team**, last pitched **2023** |
| Jake Berkland | D2 Minnesota State, **SO**, **270 PA in 2026** |
| Logan Harrell | D2 Trevecca Nazarene, **JR**, **93 IP in 2026** |

The four D1 "matches" are **stale stubs from the exact population whose 2027 projections were deleted
the same day**. The two D2 ones are established players with full 2026 seasons. Trevor confirmed the
build rows were **manually added**, so these are **name collisions, not recoveries** — the Harrison
Cook failure mode, harder to see because each name is unique in `players`.
⇒ Writing those 6 links would have permanently bound real roster rows to the wrong humans.
**NULL is strictly better: it is honest about not knowing.**

### The rows are safe as they stand
```
49 orphan rows on ACTIVE builds
   player_snapshot 23 · neutral_snapshot 0 · named 41 · included_in_roster 49 · nil_value>0 20
   wrc / owar / era: ALL NULL  → they contribute ZERO WAR
```
They hold a roster slot with a name and a position and nothing else. Nothing breaks; they do not rank,
do not corrupt totals, do not poison snapshots. A freshman with no stats **should** have no projection.

### ⬜ Two loose ends (small, not blocking)
1. **8 of the 49 have no name at all** — empty rows holding a roster slot. Not a player in any sense.
2. **All 49 count as `included_in_roster`**, so they sit in the roster denominator. Probably intended
   for a freshman placeholder, but **not traced** against the budget-share floor
   ([[project_budget_share_roster_floor]]). Worth confirming before it matters for pay math.

★ **PROCESS NOTE.** The dry run plus Trevor's freshman question is the only reason this did not become
a bad prod write. I had scoped it, guarded it, and recommended running it. **A heuristic that passes
its own guards can still be wrong about the world** — the guards proved "exactly one row bears this
name", which is not the same as "this is that person".

## ALSO OPEN (not blocking, do not lose)
- **Modeling question for Trevor:** is a 3:1 OBP:SLG weighting the intent? It means a power bat with a
  mediocre OBP always grades ~league-average. Lauaki is the poster case.
- `trg_customer_teams_autofire_precompute` is **ARMED** — decide before onboarding anyone.
- **Third registry #9 site**: default-build fallback ~:2002 still reads `p.pa` / `p.ip`. Fires only when
  the stored depth role is missing, which fixes #3 make rare. Logged, not patched.
- **JUCO ungated on the returning-pitching query** — 2,695 rows, 1,558 with no scouting. Parked in
  `docs/JUCO_AUDIT_2026_05_24.md` per Trevor. **Explicitly NOT the Volantis cause.**
- G46 remains the **third copy** of the projection math. Track B must absorb it or Track B is copy #4.
- Vercel: `diamond-predictor-66` git link removed 2026-08-31 (nothing deleted; `player.rstriq.com`
  still serves its 08-26 build). It cannot deploy from `main` until `apps/player` lands there.

## SCOUTING COLUMN — STATUS 2026-08-31 (carry forward)
✅ **Rendering again.** The blank column was MY regression: the pitcher chips were keyed on
`r.source_player_id`, but the PITCHING row type has no such field — pitcher rows carry
**`id` = source_player_id** (numeric TruMedia id, not a UUID). Fixed to `?? r.id`. The defect predated
the branch; it was invisible while the stored score was preferred, because `live` was never reached.
Confirmed in data: **4,613 of 5,522 D1 rows will show chips**, 909 blank (under the 100-pitch
qualifier — the same bar PitcherProfile uses).
⬜ **ACCURACY NOT YET CHECKED** (Trevor: *"I didn't check accuracy but it's showing will check
tomorrow"*). Gate: pick 3–4 pitchers incl. **Dylan Volantis** and confirm the dashboard chip equals the
PitcherProfile grade EXACTLY. Volantis should read **77**, not 69.58.

## ORDER OF OPERATIONS
```
D  TB-vs-Profile snapshot read     (cheapest; pure-read violation, no math)
C1 ERA scalar hunt                 (class_era_*; devAgg ELIMINATED — measured 0.000)
   verify scouting accuracy        (Volantis must read 77)
B  wRC+ audit                      (the 113; returners 64% mismatched)
   ── all three of the above change stored values ⇒ ONE scoped downstream recompute ──
A0 pitching-const diff  →  A1 deploy  →  A2 dry-run existing team  →  A3 gates
                                       ↓
                       A4 add Georgia Tech  →  staging→main PR  →  Trevor merges

⚠ B, C1 and D all move numbers that feed p_rv_plus / oWAR → market → player_snapshot. Do the math
  fixes FIRST, then ONE recompute, then verify onboarding against corrected values. Running A before
  them means dry-running against numbers we already know are wrong.
★ HR9 is FINE per Trevor (2026-08-31) — C2 is CLOSED, do not re-open it.
```
