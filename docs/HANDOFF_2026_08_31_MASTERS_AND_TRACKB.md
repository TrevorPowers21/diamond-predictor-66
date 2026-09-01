# ⚠️ SUPERSEDED AS THE ENTRY POINT — START AT `docs/HANDOFF_2026_08_31_EOD.md`

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


## 🛑 MUST READ — PROJECTION CALIBRATION IS **WRONG ON PROD RIGHT NOW** (found 2026-09-01)

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

**TRACK B ARCHITECTURE IMPACT:** this file's Track B write-up assumes one config source. There are
three, and the hitter path differs by environment. Any stage description here that says "reads the
equation weights" must specify WHICH table and WHICH season.

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

**TRACK B ARCHITECTURE IMPACT:** this file's Track B write-up describes stage 5.5. That stage is now
BUILT and D1-scoped in code, and emits `<key>_pr_center` for all 11 ratings — but it is NOT applied to
either database. Treat any "stage 5.5 complete" statement here as code-complete only.

That file carries the current prod state (through F44), what's left in dependency order, and the seven rules
this push established. **This document remains valid for the Track B architecture write-up and the two-workstream
framing** — keep reading it for those.

# ▶️ HANDOFF — RSTR IQ, end of 2026-08-30. **START HERE.**
Supersedes `HANDOFF_2026_08_30_PROD_PUSH.md` as the entry point. That file is still valid for Phase-C detail.

## READ IN THIS ORDER
1. **§1 CURRENT STATE** below — what is on prod right now.
2. **§2 THE TWO WORKSTREAMS** — the prod push and the Track B build are SEPARATE. Do not conflate them.
3. `docs/PIPELINE_pitch_log_to_projections.md` → **"TRACK B — THE COMPLETE ARCHITECTURE"**. The build spec.
4. `docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md` — why the runbook's order is wrong.
5. `PROD_MIGRATIONS_TODO.md` — the ledger. **Append every prod change.**
6. Memory: `project_stuff_plus_v2_locked` · `project_prod_push_in_progress` · `reference_db_direct_sessions`
   (both `PGURI`s are SAVED — **never ask for DB passwords**).

---
# §1 CURRENT STATE — PROD (all verified IN THE DATABASE, not from logs)
| area | state |
|---|---|
| **Phase A/B** schema + config | ✅ `model_config` 220 keys. Phase-B tuned values SURVIVED C27's upsert (`nil_tier_sec` 4.0, `r_obp_std_pr` 31.89504). ⚠ gate key names are `r_obp_std_pr` / `p_whip_pr_sd` / `owar_replacement_runs_per_600` — the short forms in older docs return **zero rows**. |
| **Phase C** Stuff+ chain | ✅ 2,013,005 pitches classified+scored. Gate **mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 — IDENTICAL to staging.** |
| C24 · C27 · C26 · C29 · C28(4 steps) · C28b | ✅ applied. Conference `Stuff_plus` **101.17 → 99.15** (legacy-lane fix). |
| **Phase D** | ✅ **COMPLETE.** D29b `team_drs` **derived on prod** (308 teams, sum 0.00) · D30 no-op · D31/D32 committed `0 FAILED` · **D34 passed all 9 gates.** |
| **E2** park factors + `derive_conf_opr_htp` re-run | ✅ `rg_factor_seasonal` 0/309 → full. `run_env_factor` **101.879 → 99.719** (park Δ 2.16 flowed through exactly). Park factors **308/308 IDENTICAL to staging**. |
| *(unplanned)* Camden Kozeal | ✅ Master row created — D1 hitters 5,340 → **5,341**. His WAR now matches staging to 3dp. |
| **`pa` / `IP`** | ✅ **FIXED 2026-08-31 — now FULL SEASON** (`pa` avg 121.8 → **127.7**, `IP` avg 25.67 → **26.66**). Historical: held the regular-season window. |
| **`regular_season_pa` / `_ip`** | ✅ **FILLED 2026-08-31 — 5,322 / 5,372** (median Δ 0.00 vs the old `pa`). F44 unblocked. |

**Prod↔staging:** park factors identical · `run_env_factor` identical · Kozeal's WAR identical. `hitter_talent_plus`
99.23 vs 99.01 = **staging is BEHIND** (never got C24/C26/C27/C28/C28b/C29). **Prod is the current side — a mismatch
here is NOT a prod defect.**

---
# §2 THE TWO WORKSTREAMS — KEEP THEM SEPARATE
## A. FINISH THE PROD PUSH (near-term, mostly ready)
**Only ONE genuine code blocker:** `scripts/backfill-snapshot-total-hitter-war.ts` (F40) reads
`process.env.SUPABASE_URL` with **no `--prod` flag at all** — `--env-file` pointed at prod writes prod with zero
opt-in. **6th instance** of this defect class. Add the double-keyed guard; verify both refuse paths.
**Order (dependency, NOT topic — see the ORDER AUDIT):**
```
0. fix F40's guard
1. F44 refresh_team_season_stats(2026)   ★ MOVED UP — Phase E READS team_season_stats.faced_*
                                          ⚠ its _reg rates land NULL until regular_season_ip is filled (re-run later; idempotent)
2. E35 run-twp-recompute --apply --prod   (prod is_twp 137/31,467 → expect a big change)
3. E36 → E37 → E38 (zsh scripts/_run_step2_all.sh --prod)
   🛑 that loop pipes through `grep | head -3` and SWALLOWS EXIT CODES — "14 teams DONE" is NOT proof.
      Re-run the dry-run after and require 0 pending per team.
4. F39 refresh_composite_war()  ← direct pg session / SQL editor ONLY (PostgREST cuts at ~125s and ROLLS BACK)
5. F40 → F41 → F42 (needs --all) → F42b → F43
6. G46 edge-fn deploy (Trevor) → preview-verify → gh pr create staging→main → Trevor merges → H drops
7. THEN staging catch-up — run THROUGH Track B, not by hand
```
**Verified ready, do NOT re-check:** E35 guard ✅ · E36/E37/E38 asserts + ordered pagination ✅ · `customer_teams` = **14**
(not 18) · F41a/b/c asserts ✅ · F42a/b/c asserts ✅ (F42a is env-driven now) · F43a/F43b **safe by construction**
(`--prod` selects the env file, read directly). `refresh_team_season_stats` table+fn **exist** on prod.

## B. THE TRACK B BUILD (the real engineering)
Spec: `docs/PIPELINE_pitch_log_to_projections.md` → **"TRACK B — THE COMPLETE ARCHITECTURE"**. Summary:
```
pitch_log (DAILY)  →  pitch_log_*_totals  =  THE ACCUMULATOR (all raw counts, ONE place, rebuilt EVERY import)
                   →  Masters = DERIVED + DISPLAY (rates, ratings, WAR, pa/IP + reg anchors; NO raw counts)
                   →  TruMedia Master sheet (MONTHLY) = CHECK/OVERRIDE only (SB, ERA, G/GS)
```
**WAR reads the accumulator and WRITES the Masters.** Reg/post split = **lock once at the transition**, then the
full-season line keeps growing. **`lock_regular_season` / D33b is OBSOLETE — retire it.**
**Build queue:** ① extend `derive_masters_from_pitchlog` (counting stats + reg/post + gate split + `repRows` fix)
② `pitch_log_pitcher_totals` gains `R`/`ER` **incl. the inherited-runner accrual** ③ `dimension_key='reg'`
④ fold defense/baserunning into the accumulator ⬜ sequencing OPEN ⑤ re-point WAR at the DB ⑥ one boundary source
(later: per-team schedules).

---
# §3 THE NEXT CONCRETE TASK
**▶ FULL STEP-BY-STEP: `docs/PLAN_finish_prod_push_2026_08_31.md`** — 12 steps, each with a VALUE gate.

**Extend `derive_masters_from_pitchlog.ts`** to write, in ONE operation per player:
`pa`/`ab` ← `PA`/`AB` (FULL) · `regular_season_pa` ← `reg_PA` · `IP` ← `full_IP` · `regular_season_ip` ← `reg_IP` ·
`ERA` ← `full_ERA` · `bf` ← `full_BF`. Plus: **remove the PATCH gate** (`:274`) so `k_pct`/`pull_air` fill for
everyone; **keep the 25 PA / 20 BF NEW-ROW gate** (`:469`); **fix `repRows` `:465`** → `"batter_id"` and stop
discarding `error` at `:451`.
**GATE (values, not counts):** `pa` avg **121.8 → ~128.0** · `regular_season_pa` ≈ today's `pa` (**median Δ 0.00**) ·
`regular_season_ip` **0 → 5,374** · a deep playoff team's **depth-role tier counts must NOT move**.
Then **re-run F44** so `ra9_r`/`fra9_r` stop landing NULL.

---
# §4 🛑 MISTAKES MADE — DO NOT REPEAT
- **A subagent with prod credentials called `refresh_composite_war()`** and wrote ~112k rows. → Subagents get STAGING only.
- **Pasted staging's `team_drs` into prod** instead of deriving it. Trevor caught it. → **Derive on prod, never copy.**
- **Changed Kozeal's `TeamID` to the "correct" season row** — split Arkansas into two teams (308→309). Staging was
  right. → **Adopt the `TeamID` a player's teammates already use.**
- **Two false alarms from MY OWN instrument:** (a) park-factor diff matched the CSV's `teamId` instead of `team` →
  reported "309 teams dropped" when it was **1**; (b) compared two derivations by **exact equality** → reported
  "1,306 hitters change" when the median Δ was **0.00**. → **Verify the instrument before reporting an alarm; report
  mean/median/p90/max, never a % exact match.**
- **Claimed docs were consistent having only checked my own edits** — a sweep found 12 more. → Verify, don't assert.
- **Marked a run COMPLETE by exit code** when a dimension had FAILED. → Validate by LOG CONTENT.
- **Nearly concluded off a truncated background log** (header missing). → Re-run with a full capture.
- **Rewrote documented steps instead of just reordering them.** → Reorder; do not redefine.

# §5 THE FOUR GATES THAT ACTUALLY CATCH THINGS
1. **VALUE** — did the number CHANGE? (Conf `Stuff_plus` 101.17→99.15 · `run_env_factor` 101.879→99.719 — both 30/30 before AND after)
2. **MEMBERSHIP** — diff the ID SET (caught Kozeal; `5,340 = 5,340` passed every count)
3. **CARDINALITY** — assert the GROUP count (D1 = 308 teams; the Σ-centering assertion held at 309)
4. **LOG-CONTENT** — read the body, never the exit code (`--create-new` exits 0 while creating nothing)

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
