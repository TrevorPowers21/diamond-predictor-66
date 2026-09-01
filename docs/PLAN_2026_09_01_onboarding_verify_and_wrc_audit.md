# PLAN — 2026-09-01 · Onboarding verification + wRC+ audit

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

## GATE B — wRC+ AUDIT

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

### Hypotheses to test, in order
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
