# Player Score / NIL Allocation — Architecture v1 + Data (2026-08-14)

Settled direction for how a coach's typed budget becomes a per-player projected value, plus the ground-truth data to
fit it. Companion: `HANDOFF_WAR_REDESIGN_2026_08_13.md`, memory `project_war_display_audit`. Branch
`feature/war-recalibration`. **Status: DESIGN SETTLED (v1), data pulled, curve NOT yet fit or wired.**

---

## THE SETTLED ARCHITECTURE (Trevor, 2026-08-14)
1. **Market value and budget allocation are DECOUPLED.** No reliable clearing market (budgets ~$150K–$5M), so the
   product's core number is budget-relative: "on YOUR budget, this player warrants $X." **Allocation is the product;
   standalone market value ($/WAR) is display-only context.**
2. **Allocation = RANK-BASED DECAY CURVE, not proportional share.** Rank the roster by player score, distribute the real
   budget along a decay curve. **Anchored to the observed Arkansas payroll shape: top-1 ~10% of budget (never ~16% like
   the proportional math gave Lackey), top-3 ~30%, top-8 ~65%, long paid middle, floor money (~$20–30K at an SEC
   budget) for rostered contributors, zeros allowed for the last few slots.** Curve sums to budget by construction →
   no player's number explodes when teammates are weak (the original proportional bug).
3. **Concentration flexes with budget size.** Small budgets concentrate at the top + zero out more of the bottom; large
   budgets flatten. **One concentration parameter scaling with log-budget.**
4. **Floor toggle = a PHILOSOPHY switch.** Same budget, two modes: "balanced roster" (floor on, paid depth) vs
   "top-heavy" (floor at zero, difference redistributes up). Label by philosophy, not mechanism. GM's choice.
5. **PVF applies to ABOVE-REPLACEMENT SURPLUS only, never the whole score.** Bench bodies at any position get floor
   money; position premiums concentrate at the top where the market pays them. **Catcher PVF likely drops to ~1.0** now
   that total WAR carries framing (the 1.3 priced defense WAR couldn't see; it can now). Final ladder TBD after seeing
   how surplus-only scales.
6. **No retention/acquisition multiplier in v1.** Real mechanism = committed contracts (multi-year locked dollars =
   roster data, not a coefficient). SUCCESSOR FEATURE: slots carry locked money/years; allocator treats locked as
   spent, distributes remaining budget over unlocked slots.
7. **Needs nudge** (scarcity premium when roster has ≤1 above-replacement player at a premium position): DEFERRED
   pending the same scaling check as PVF.

**Design flow:** send data → design/fit the curve in chat → check Lackey/Arkansas against it → locked spec → wiring.

---

## THE PROBLEM v1 REPLACES (why proportional share is wrong)
Current: `PlayerScore = totalWAR × PVF × PTM`; `ProjectedNIL = (score / max(Σscore, floor)) × budget`. It overshoots
the top because the bottom is priced ~$0 (near-zero/negative WAR players add nothing to the denominator), so a star
eats a huge share. Vahn Lackey → Arkansas $5M: proportional math gave **$790K (~16%)**; the coach's real ceiling for
ANY player is **$500K (~10%)**. Standalone market value was ~$207K.

## GROUND TRUTH — Arkansas active build (prod, $4.975M, 41 players, $4.875M allotted, 98%)
- **Top-1 = 10%, top-3 = 30%, top-8 = 65%** of budget — the decay anchors above are these numbers.
- **Pay barely tracks WAR:** Souza (2B, low WAR) = $500K; Neiswonger (SP, 4.04 WAR) = $250K; Eaves (RP, 2.26) = $50K;
  Harvey (RP, 2.06) = $40K. Everyday position players + the ace get paid; high-WAR relievers get little. $/score ranged
  $3.5K–$3.5M → NOT proportional → rank-decay confirmed.
- **Real floor exists:** depth players $10–30K; only the last ~4 slots at $0.
- Georgia builds are not filled out ($0/inactive) — Arkansas is the only ground truth.
Full 41-row payroll table is in the session transcript (2026-08-14).

---

## THE DATA (A–E, staging total WAR, 2026)

### E. Current constants (v1 replaces these explicitly)
- PVF (`nilProgramSpecific.ts:51`): C/SS/CF **1.3** · 2B/3B/IF/LF/RF/OF **1.1** · 1B/DH/UT **1.0** · bench 0.8 · default 1.0
- PTM (`nilProgramSpecific.ts:3`): SEC **1.5** · ACC/Big12 **1.2** · Big Ten **1.0** · strong-mid **0.8** · low-major **0.5** · JUCO 0.35
- $/WAR: `HITTER_DOLLARS_PER_WAR=25000` (`depthRoles.ts:312`); `nil_base_per_owar=25000` (`useTeamBuilderSimulation:1553`);
  pitcher `market_dollars_per_war=25000` (`pitchingEquations.ts:259`)
- Denominators: `RAW_WAR_BENCHMARK=33` (`useTeamBuilderSimulation:1687` + 4 dup copies); `DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE=68`
  (`nilProgramSpecific.ts:1`, flat = BROKEN, always binds)
- Applied: `calcPlayerScore = owar×ptm×pvm` (`nilProgramSpecific.ts:75`) → market `oWar×dpw×ptm×pvm` (`depthRoles.ts:329`)
  → budget share `(score / max(Σscore, 33×PTM)) × budget` (`useTeamBuilderSimulation:1690`)

### C. Below-replacement (WAR ≤ 0) per team, by tier — drives the zero-slot boundary
SEC 7.9/36 (**22%**) · ACC/Big12 9.4/35 (27%) · Big Ten 9.9/34 (29%) · strong-mid 11.5/35 (33%) · low-major 13.9/35 (**40%**)

### D. Above-replacement score share (WAR>0, WAR×PVF) by position group — what PVF does before the ladder is set
| Tier | C/SS/CF | corner | 1B/DH | pitcher |
|---|---|---|---|---|
| SEC | 24% | 19% | 6% | 51% |
| ACC/Big12 | 21% | 24% | 6% | 49% |
| Big Ten | 19% | 22% | 6% | 54% |
| strong-mid | 15% | 21% | 5% | 59% |
| low-major | 17% | 22% | 5% | 56% |

### A. Score-by-rank decay — 6 representative rosters (score = totalWAR × PVF × PTM)
- **top-SEC Texas (1.5, 61.4):** 8.66,7.55,5.64,5.44,5.20,4.50,4.40,3.25,2.62,2.47,1.81,1.37,1.28,1.22,1.17,1.08,1.03,0.92,0.69,0.52,0.47,0.39,0.33,0.28,0.28,0.19,0.09,0.07,0.04,−0.05,−0.15,−0.23,−0.30,−0.31,−0.55
- **mid-SEC Ole Miss (1.5, 46.0):** 4.82,4.53,4.52,3.44,3.43,3.14,2.95,2.59,2.26,2.25,1.93,1.85,1.35,1.30,1.29,1.14,0.92,0.75,0.68,0.63,0.61,0.32,0.25,0.19,0.18,0.11,0.10,0.02,−0.00,−0.02,−0.09,−0.35,−0.42,−0.68
- **ACC/Big12 NC State (1.2, 30.6):** 3.92,3.15,2.85,2.82,2.70,2.16,2.10,1.97,1.83,1.32,1.28,1.19,1.17,0.97,0.77,0.39,0.37,0.33,0.27,0.23,0.21,0.14,0.13,0.11,0.08,0.04,0.03,−0.02,−0.03,−0.09,−0.15,−0.24,−0.58,−0.81
- **Big Ten Illinois (1.0, 20.1):** 2.76,2.25,1.99,1.48,1.48,1.46,1.33,1.30,1.25,1.15,0.95,0.91,0.79,0.73,0.67,0.61,0.37,0.31,0.30,0.26,0.19,0.12,0.11,−0.09,−0.14,−0.27,−0.28,−0.28,−0.30,−0.44,−0.85
- **strong-mid Air Force (0.8, 16.9):** 2.70,2.56,1.27,1.14,1.13,1.06,0.80,0.78,0.73,0.70,0.67,0.64,0.64,0.59,0.53,0.53,0.53,0.44,0.43,0.34,0.20,0.10,0.09,0.06,0.04,0.03,−0.02,−0.03,−0.04,−0.06,−0.09,−0.10,−0.17,−0.18,−0.18,−0.19,−0.24,−0.28,−0.29
- **low-major UMBC (0.5, 9.7):** 1.50,1.08,1.04,0.94,0.83,0.76,0.74,0.72,0.69,0.68,0.48,0.32,0.31,0.30,0.27,0.25,0.24,0.20,0.13,0.05,0.01,−0.00,−0.02,−0.03,−0.04,−0.07,−0.09,−0.12,−0.16,−0.18,−0.19,−0.21,−0.37,−0.38

### B. Arkansas fit target ($ vs total-WAR score, SEC 1.5)
Cumulative $ shares **top1=10% / top3=30% / top8=65%** validate the decay anchors. $/score wildly variable → rank-decay
not proportional. ⚠ **CAVEAT for the real fit:** the B pull matched on *descriptive* total WAR + name (25/41 matched;
16 recruits/JUCO absent from the D1 Master; a few name-collisions). **The clean fit must use the PROJECTION score
(`player_predictions.total_hitter_war`) matched by `player_id`** — the number the coach actually saw. Rerun pending.

---

---

## POSITIONAL SCARCITY LAYER — data + ★ PROGRAM-ANALYTICS VALUE (over industry) (2026-08-14)

**★ This is a value-over-industry program-analytics asset, not just a NIL input.** No competitor offers a national,
pitch-log-derived positional-scarcity SURFACE — how many credible Tier-1 players exist at each position, and how steep
the replacement cliff is behind them. A program can see the **national talent market by position** (where the market is
thin, where premiums are real) to drive recruiting priorities, roster construction, portal strategy, and NIL. Its
FIRST use is validating/replacing the hand-set position ladder; its SECOND is a standalone program-analytics feature.

**Method (locked for this pull):** credible fielder = `player_season_defense.half_innings ≥ 100` (uniform; `bip_opps`
is ~0 for C/1B so can't be the measure — catcher value is framing/blocking, not range). Tier-1 = top decile of
projection WAR *within position*, Tier-2 = 50–90th. Weekend-SP = `Role=SP & IP≥65` (`derivePitcherDepthRole`).
Projection WAR = returner/regular/2027 (`total_hitter_war` fielders, `p_war` pitchers). **JUCO excluded naturally**
(no pitch log → not in `player_season_defense`). **Availability DELIBERATELY dropped** (Trevor): project forward, can't
predict who's actually in the portal — scarcity = how many Tier-1 EXIST, and that sets the market. Multi-position
players count at EVERY credible position. Scarcity = replacement CLIFF per position × tier, NOT raw counts.

**### 1. Supply counts (D1, 2026)** `position,total_credible,tier1_top10pct,tier2_50to90,below50`
C,524,53,210,261 · SS,321,32,129,159 · 2B,307,31,121,155 · 3B,269,27,107,135 · 1B,374,37,150,185 · LF,184,19,74,91 ·
CF,274,28,109,137 · RF,191,20,76,95 · weekend-SP,416,38,180,198 · other-P,3502,361,1411,1729

**### 3. Within-position projection-WAR** `position,n,p10,p25,p50,p75,p90,max`
C,524,-0.55,-0.17,0.48,1.20,2.00,5.09 · SS,320,-0.63,-0.09,0.63,1.37,2.17,3.45 · 2B,307,-0.23,0.20,0.77,1.46,1.94,3.37 ·
3B,269,-0.20,0.31,0.89,1.56,2.06,3.02 · 1B,372,-0.01,0.41,0.99,1.58,2.19,3.63 · LF,184,-0.08,0.46,0.99,1.55,2.26,3.67 ·
CF,274,-0.35,0.18,0.79,1.55,2.08,3.09 · RF,191,0.12,0.44,0.97,1.64,2.30,3.25 ·
weekend-SP,416,1.28,1.73,2.18,2.68,3.08,4.08 · other-P,3501,-0.02,0.15,0.43,0.85,1.25,2.54

**### 5. Weekend-SP** (`Role=SP&IP≥65`): weekend-SP n=416, IP p50 76.3/p90 90.3, WAR p10 1.28/p50 2.18/p90 3.08/max 4.08;
other-P n=3502, IP p50 27.3/p90 53.0, WAR p10 −0.02/p50 0.43/p90 1.25/max 2.54.

**### 6. Sanity (hand-ladder vs Tier-1 count):** C 1.3→53 · SS 1.3→32 · 2B 1.1→31 · 3B 1.1→27 · 1B 1.0→37 · LF 1.1→19 ·
CF 1.1→28 · RF 1.1→20 · weekend-SP 1.3→38 · other-P 1.0→361.

**### 2. Multi-position translation** = 34 D1 players credible at 2+ positions (raw `half_innings, bip_opportunities,
drs_total, range_runs, drs/half-inning` per position; full table in the 2026-08-14 transcript). No `positional_scales`
table exists → chat derives the conversion matrix from these. C↔1B movers show `0` catcher BIP → C translation needs
framing runs, not range.

**⭐ THE KEY FINDING:** raw Tier-1 COUNT would INVERT the current ladder — **catcher is the LEAST scarce by count (53
Tier-1)** while LF (19), RF (20), 3B (27), CF (28) are thinnest. So counts alone are misleading; the value is the
**replacement CLIFF** (C falls p90 2.00 → p50 0.48 — steep despite the count). The scarcity surface (built in chat from
these pulls) prices the cliff × tier, then compares to the hand ladder before any constant changes.

## NEXT
0. **Positional scarcity surface** — chat assembles it from the pulls above, compares to the hand ladder → locked
   position constants (successor to PVF); also ships as a program-analytics feature (value over industry).
1. (optional) Clean B rerun off projection score + player_id → true $-vs-score fit.
2. Fit the decay curve's concentration parameter to Arkansas dollars; check Lackey lands ~$500K-ceiling not $790K.
3. Lock the v1 spec (curve form, concentration-vs-log-budget, floor toggle, surplus-only PVF ladder, zero-slot boundary
   by tier from C).
4. Wire: replace `calcPlayerScore`/proportional-share path; player score on **total WAR** (7b dependency); dedupe the
   33/68 anchors. THEN builds.
