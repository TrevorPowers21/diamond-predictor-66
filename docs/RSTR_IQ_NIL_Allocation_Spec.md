# RSTR IQ — Player Score, NIL Allocation, and Needs Pricing
## Build Spec v1.0 (designed and validated in chat; this document is the source of truth)

**Status:** Design locked. Every parameter below is either fitted (curve), derived (starter lines), or explicitly
judgment-set by Trevor (need ladder). Nothing here is open for redesign during wiring; questions route back to chat.

**Session provenance:** authored 2026-08-14. Data appendix + positional-scarcity pulls: `PLAYER_SCORE_NIL_ALLOCATION_2026_08_14.md`.

---

## 1. Layer Architecture
Four layers, strictly separated:
1. **Player Score** ranks a roster. `score = total_WAR × PTM`. **PVF is REMOVED from the score.** Scarcity never inflates
   a player's rank on his own roster; it prices his replacement on the market.
2. **Allocation** distributes a real budget across a ranked roster via a decay curve. Sums to budget by construction.
3. **Supply/replaceability premium** (the need ladder) prices open needs on the target board.
4. **Need detection** determines which positions are open, from roster state the system already holds.

Standalone "market value" is display-only context. The product number is budget-relative: what this player warrants on YOUR budget.

## 2. Allocation Formula (fitted, validated)
For a roster ranked by score, budget B:
```
paid set  = players with score > 0
n_paid    = |paid set|
floor     = floor_frac × B / n_paid          (floor_frac = 0.10)
surplus_i = max(score_i, 0) ^ alpha          (alpha = 0.9)
rate      = (B − floor × n_paid) / Σ surplus_i
NIL_i     = floor + rate × surplus_i          (paid set)
NIL_i     = 0                                 (score ≤ 0)
```
**Fit provenance:** alpha=0.9, floor_frac=0.10 fitted in chat vs observed Arkansas payroll (top-1 10.3%, top-3 30.8%,
top-8 66.7% of $4.875M). On Texas at $5M → 11.7/30.1/63.6, star $584K (vs broken proportional $790K/16%), mid-roster
$60–110K, emergent floor $22K ≈ Arkansas's $20–30K tier. Same params hold shape across all six tier rosters (top-1 stays
9–12% Texas→UMBC) with NO budget-flex param — score distributions already carry tier structure.

**Floor toggle (ships v1, GM SETTINGS):** per-team GM setting, both modes always available.
- "Balanced roster" = floor on (default) · "Top-heavy" = floor_frac=0, difference redistributes upward.
- Label by philosophy, never mechanism. Effect concentrated at the bottom (contributors → $0), modest at top. Every
  dollar exhibit + UI surface respects the team's selected mode.

**Alpha justification (exactly this):** alpha is fit to the aggregate share anchors (top-1/3/8), which survive real-world
capping noise. Model does NOT reproduce pay ties (e.g., three players capped at $500K); it spaces the top by actual
score gaps. Value-honest allocation; the coach applies politics on top.

**Display rule:** allocations under $5K display as a "walk-on / development" tier (low-major floors ~$1K; never print that precision).

**Retired constants (delete, do not stack on):** proportional budget share, `RAW_WAR_BENCHMARK=33` + all dup copies,
`DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE=68`, PVF inside `calcPlayerScore`.

## 3. Need Detection (from existing roster state)
- **Coverage authority:** a player covers ONLY his slotted position. Pitch-log innings are the position authority, not listed autofills.
- **Starter line:** 50th-percentile total WAR at the position, one national line, no tier cutting. Checked against PROJECTION WAR.
- **Freshmen / no-history:** carry 0 WAR (freshman valuation logged future work); a slotted freshman does not clear the line.
- **Three states, pricing is BINARY:** `empty` (nobody clears / nobody slotted → full need premium) · `thin` (someone
  slotted, nobody clears → full need premium; DISPLAY state only so the coach sees his player acknowledged) · `solid`
  (a slotted player clears the 50th line → multiplier 1.0).

## 4. Need Ladder (judgment-set by Trevor)
Applied to target-board displayed prices ONLY while position is in need (empty/thin). Never touches rostered allocations.
| Position | Need multiplier |
|---|---|
| C, SS, weekend SP | 1.3 |
| All OF (incl CF), 2B, 3B | 1.1 |
| 1B, DH, non-starter pitchers | 1.0 always |
Encodes conversion difficulty. A derived supply-scarcity version is a logged someday-check, not v1.

## 5. Conditional Values, Repricing, Freeze
- Board values CONDITIONAL on roster state: `board_price = allocation-implied value × need multiplier (if in need)`.
- Any roster change reprices every player still on the board.
- **Freeze rule:** the moment a player is added, his value freezes at his board price at that instant. Additions never
  retro-reprice. (Committed-contract feature overwrites later: locked $/years, allocator spends remainder over unlocked
  slots. Logged future feature, not v1.)

## 6. CALCULATE AND SHOW (required verification, in order, results to chat before ANY UI wiring)
1. **Projection-based Arkansas re-fit.** Re-match Arkansas payroll on `player_predictions` projection scores by
   player_id (chat fit used descriptive, 25/41). Re-fit alpha + floor_frac vs top-1/3/8 = 10/30/65. SHOW matched count,
   fitted params, fitted-vs-observed shares, rank-by-rank $ (model vs actual). If params within ±0.1 of (0.9, 0.10) →
   lock chat's values; else report and stop.
2. **Six-roster allocation table.** Locked formula on all six tier rosters at stated budgets. SHOW per roster:
   top-1/3/8 shares, star $, rank-10 $, rank-20 $, floor $, paid count — and same under top-heavy toggle.
3. **Lackey case.** Old proportional $790K vs new allocation on the $5M roster, with rank context — BOTH modes.
4. **Need-state detection dry run.** For six rosters: 50th-pct starter line per position (projection WAR, national),
   then each roster's position state (empty/thin/solid) + which player clears it. Sanity: SEC mostly solid, low-major mostly need.
5. **Need multiplier effect.** One roster with an SS need: sample board SS priced with/without 1.3, and the reprice when
   a qualifying SS is added (his frozen value + board's new SS at 1.0). BOTH floor modes.
6. **Conservation assertion (goldens):** Σ NIL_i = B exactly, every roster, both modes. Add to regression suite.
7. **Retired-constant sweep.** grep proof the five retired constants + dups are gone (the 33 had 4 dup copies).
Every dollar table in 1–5 shown in BOTH modes side by side. No UI, no DB writes until 1–7 shown + confirmed in chat.

## 7. Positional Scarcity Layer (derived; DATA-PULL only for code, math in chat)
Eventually replaces/validates the §4 hand ladder with a per-season derived fixture. Nothing coach-facing changes until
the derived surface is compared to the ladder in chat.

### 7.1 Logic (locked)
- **Supply:** credible pitch-log innings at a position; multi-position players count at EVERY credible position (supply
  is the ONE place this is true; §3 coverage stays slotted-only). Tiers by projection-WAR percentile WITHIN position:
  Tier 1 = top decile, Tier 2 = 50–90th, below = fungible.
- **Demand:** structural (~300 D1 × slots; demand line = above-50th-pct starter every slot).
- **Scarcity = replacement CLIFF, not count.** Per position×tier: WAR gap between that tier's median and the best
  realistically-available alternative (top of the available pool + conversion-weighted adjacent supply). Steep = scarce.
- **Conversion matrix, empirical:** from every 2-position player-season, how the rate translated (SS→2B ≈ full,
  corner-OF↔corner-OF full, anything→C ≈ 0, 3B→SS discounted). Catcher cliff steepest — derived, not assumed.
- **Scarcity index:** normalized cliff depth, league-avg position-tier = 1.0. Per-season stamped fixture + stale-guard.

### 7.2 Per-player application (locked)
`scarcity-adjusted value = base value + scarcity(pos, player's tier) × his above-replacement surplus`
- SURPLUS ONLY (bench bodies at scarce positions don't inflate). PRICING layer only (board price + display); NEVER enters score/rank.
- Composes with §4 need ladder: scarcity = what he costs anyone (national, always on); need = what he costs YOU now
  (roster-conditional, binary, on top).

### 7.3 Validation rule
Derived surface compared to §4 ladder in chat. Agreement → ladder gets receipts, derived fixture takes over per-season.
Disagreement → argued in chat. Hand ladder stays live until then.

### 7.4 Derivation results (2026, built in chat) — V1 VERDICT: hand ladder stays, with receipts
- **Tier-scaling CONFIRMED:** Tier-1 cliffs (1.2–1.5 WAR) ~2× median-starter cliffs (0.5–0.7) every position → premiums
  belong on Tier-1/surplus (what §7.2 already does).
- **Conversion structure CONFIRMED:** zero players convert INTO catcher (all C-pairs are C moonlighting at 1B/LF); 1B is
  everyone's 2nd position (16/34 pairs); SS↔2B real.
- **Weekend SP = scarcest asset in the sport:** supply 0.24 above-median arms/slot (worst anywhere); cliff (wSP p90 →
  best other-P) = 1.83 WAR, ~3× any position player. 1.3 hand value is if anything LIGHT; held at 1.3 per Trevor, logged.
- **Catcher scarcity tier-concentrated:** median C most abundant (1.75 credible/team) but joint-highest Tier-1 cliff
  (1.52) + widest elite spread (max 5.09, framing). Tier-scaled premium captures this; flat count-based would not.
- **Two artifacts block precise derived multipliers now:** (1) corner-OF supply truncated by the 100-half-inning
  threshold × platoon usage (naive derivation ranked LF scarcest; corner p10 +0.02 is the tell); (2) conversion matrix
  rests on 34 players with noisy per-100-half-inning rates.
- **Ordering agrees where data is trustworthy:** wSP + SS top, 1B bottom — matches the ladder.
**V1 verdict:** hand ladder ships (ordering + conversion + tier-scaling validated). Derived surface does NOT replace it
yet. Revisit next season: credibility threshold → ~50 half-innings (fixes corner truncation), larger multi-position
sample, wSP 1.3-vs-derived on the table.

## 8. DATA PULLS for §7 — DONE 2026-08-14 (in `PLAYER_SCORE_NIL_ALLOCATION_2026_08_14.md`)
Six pulls returned (availability dropped per Trevor — project forward, can't predict portal; JUCO excluded naturally):
supply counts + Tier-1 by position, within-position projection-WAR distributions, weekend-SP identification (Role=SP &
IP≥65), sanity row (ladder vs Tier-1 count), 34-player multi-position translation. Credible = half_innings≥100.
