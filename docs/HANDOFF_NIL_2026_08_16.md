# NIL Allocation + Positional Need — HANDOFF (2026-08-16)

Branch `feature/war-recalibration`. Source of truth for design: `docs/RSTR_IQ_NIL_Allocation_Spec.md`.
Reasoning / gotchas: `docs/AGENT_LEARNINGS_nil_allocation_2026_08_16.md`. Memory: `project_player_score_nil_allocation`.

## TL;DR
The NIL allocation model was rebuilt from a broken proportional split into a **rank-decay curve with budget-flex**,
wired to **every** surface (one source, no drift). **Positional value** was decided to be **purely team-need-driven**
(no national multiplier). The **need fixture** (championship bars + need ladder) is built + tested. What's LEFT is
(a) wiring the **need detection + board premium** (actionable now — uses projected WAR), and (b) the **score →
total_hitter_war** upgrade, which is SEQUENCED after the Step 6b/7c recompute chain (do NOT wire early). After that →
back to Stuff+.

## COMMITS THIS SESSION (branch feature/war-recalibration)
| commit | what |
|---|---|
| `3b8d24d` | equation displays read exactly as computed (C1) — fixed Overall-Pitcher-Rating blend + stale comments + CLAUDE.md |
| `89f9faf` | NIL curve `allocateNil` + budget-flex; all 6 allocation surfaces repointed; PVM removed from score; retired RAW_WAR_BENCHMARK 33 + calcProgramSpecificAllocation |
| `5f09034` | GM Balanced/Top-Heavy toggle persisted on `gm_budget.nil_allocation_mode` + settings UI |
| `22565ef` | shared mode read `useNilAllocationMode(teamId)` — TB + GM Scenarios mirror the GM toggle |
| `60806de` | tier-color off avg paid allocation; removed the dead `68` thread (DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE + fallbackRosterTotalPlayerScore + dup projectedNilTierClass) |
| `94db363` | `positionNeed.ts` fixture — championship-starter bars (p70 descriptive) + need ladder + helpers (14 tests) |
| `f799c6f` | clarify: need check uses PROJECTED WAR; bar is descriptive-calibrated only |

**Staging SQL (run by Trevor):** `ALTER TABLE gm_budget ADD COLUMN IF NOT EXISTS nil_allocation_mode text NOT NULL
DEFAULT 'balanced' CHECK (nil_allocation_mode IN ('balanced','top_heavy'));` → regen Supabase types (optional tidiness;
compiles today via loose typing). Log to `PROD_MIGRATIONS_TODO.md` for prod.

## LOCKED DECISIONS
1. **Allocation = rank-decay curve + budget-flex** (`src/lib/nilAllocation.ts`, spec §2):
   `NIL_i = floor + rate·max(score,0)^alpha`, sums to budget. `alpha(B)=max(1.1, 1.1+0.5·log10($5M/B))` (top holds value
   as budget drops); `floor_frac(B)=0.10·min(1,B/$5M)` (floor drains); `$10K` min-payment; $5M = fixed calibration
   endpoint. **alpha 1.1 elasticity locked.** Balanced (floor on) = DEFAULT; Top-Heavy (floor_frac 0) = the GM toggle.
2. **Score = total_WAR × PTM. PVM REMOVED from score.** Interim = `owar × PTM`; hitters upgrade to `total_hitter_war`
   (o+d+bsr) — SEQUENCED (see below), NOT now.
3. **Positional value = PURELY the §4 team-need premium.** NO always-on national multiplier (old PVM retired, not
   replaced by a derived index). National derived scarcity **PARKED** (noisy — see agent-learnings + spec §7.4).
4. **Need ladder** (board prices only, when a spot is a hole): C/SS/weekend-SP **1.3**; all OF incl CF + 2B/3B **1.1**;
   1B/DH/non-starter-P **1.0**. CF=1.1 is coach-feedback-backed. **No bench tier.** Generic pitch-log `OF`/`IF` → 1.1.
5. **Championship-starter bar** = p70 of full-time regulars (reg_pa≥200 / reg_ip≥65), **2026 DESCRIPTIVE full-season WAR**
   (calibration only — the one full season): C 2.11 · RF 1.88 · 1B 1.77 · CF 1.74 · LF 1.70 · 3B 1.57 · 2B 1.48 · SS 1.42
   · wSP 3.06. **Players are CHECKED against it with PROJECTED WAR** (we project forward).
6. **Shared allocation mode** lives on `gm_budget.nil_allocation_mode`; GM pages read via `useGmRoster`, TB + Scenarios
   via `useNilAllocationMode(teamId)`. **Save/push-to-coach unchanged** — the shared read is ONLY the projected-allocation
   shape, not actual pay.
7. **Tier-color** = budget ÷ paid-player count (avg allocation), not the old 68 baseline.

## FILES
**New:** `src/lib/nilAllocation.ts`(+test), `src/lib/positionNeed.ts`(+test), `src/gm/hooks/useNilAllocationMode.ts`.
**Curve wired into (6 surfaces):** TB sim `projectedBudgetShareForPlayer` (`useTeamBuilderSimulation.ts`), NilValuations
consultation, GMRoster, GMScenarios, GMTargets, PlayerHub. **Retired:** RAW_WAR_BENCHMARK 33, calcProgramSpecificAllocation,
DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE 68 (both defs), fallbackRosterTotalPlayerScore thread, duplicate projectedNilTierClass,
PVM-in-calcPlayerScore, usePlatformConfig.defaultProgramTotalPlayerScore.

## WHAT'S LEFT — in order

### A. Need detection + board premium — HELPERS BUILT + TESTED; WIRING RIDES THE 6b/7c TOTAL-WAR PASS
`positionNeed.ts` is done: `computeRosterNeeds(roster)` → holes set, `needMultiplierForTarget(holes, pos)` → 1.3/1.1/1.0
board markup, both tested (19 tests). **But the wiring is NOT actionable standalone** — realized while wiring GMTargets
(2026-08-16): the championship bar is **TOTAL WAR** (o+d+bsr) but the GM/TB rows expose **`o_war` only** (`GmTarget.war` /
`GmRow.war` = o_war). Checking o_war vs a total bar **under-credits defense** and over-flags exactly the defensive spots
the premium is for (a championship defensive catcher reads as a "hole"). So the need check needs **total projected WAR**,
which is the SAME `total_hitter_war`-on-the-rows plumbing as the score swap. **Decision (Trevor 2026-08-16): fold the need
wiring into the total_hitter_war pass (B) — one plumbing job — rather than a partial `o_war` read that silently resolves
wrong later.** GMTargets was wired then REVERTED (note left in-code). To wire (with B): compute holes from rostered
returners' TOTAL projected WAR vs the bars → `needMultiplierForTarget` on GMTargets + TB target-board display prices;
freeze on add (spec §5); never touches rostered allocations. Generic `OF`/`IF` → 1.1/group-bar until the pitch-log
position-display fix. Weekend-SP need = a follow-on (needs the pitcher weekend-starter role on the rows).

### B. Score → total_hitter_war (SEQUENCED — do NOT wire before Step 6b + 7c) — carries the need-check plumbing too
Per HANDOFF_WAR_REDESIGN §89 sequence (`3→(1+2)→4→Step 6b→7b→7c→7d→Step 8`): 7c snapshot = THE NIL scoring source;
transfer `total_hitter_war` is stale until Step 6b. When there:
- Add `d_war, bsr_war, total_hitter_war` to the TB prediction select (`useTeamBuilderData.ts:153` stops at `o_war, p_war`)
  + the `LivePredictionRow`/`TransferSnapshot` types.
- `projectedPlayerScore`: total = `isPitcher(p) ? owar : owar + d_war + bsr_war` (live owar + stored d/bsr = what the
  snapshot autopopulates to `total_hitter_war` on save). Pass total to `calcPlayerScore`.

### C. Then → back to Stuff+ (the open DECISION-2 weighting fork A/B/C, recentering). Separate from NIL.

## VERIFY
- 250 app tests + 14 positionNeed + 10 nilAllocation green. Type-clean (only known ~198 pre-existing baseline tsc errors).
- **NOT browser-verified** — the curve math is unit-tested but the TB/GM end-to-end render needs a preview-branch check.
