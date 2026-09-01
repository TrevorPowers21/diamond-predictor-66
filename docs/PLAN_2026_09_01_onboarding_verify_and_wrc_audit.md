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

## ORDER OF OPERATIONS
```
A0 pitching-const diff  →  A1 deploy  →  A2 dry-run existing team  →  A3 gates
                                                                        ↓
                            B wRC+ audit (+ downstream oWAR/market recompute)
                                                                        ↓
                            A4 add Georgia Tech  →  staging→main PR  →  Trevor merges
```
