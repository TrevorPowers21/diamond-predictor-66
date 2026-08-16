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
paid set  = players with score > 0 AND NIL_i ≥ min_payment      (iterate: drop below-min → redistribute → repeat)
n_paid    = |paid set|
floor     = floor_frac(B) × B / n_paid
surplus_i = max(score_i, 0) ^ alpha(B)
rate      = (B − floor × n_paid) / Σ surplus_i
NIL_i     = floor + rate × surplus_i          (paid set)
NIL_i     = 0                                 (score ≤ 0, or below min_payment)

  BUDGET-FLEX (ref budget B* = $5,000,000):
    alpha(B)      = max(1.1, 1.1 + 0.5 · log10(B*/B))    — concentration ramps UP as budget drops (top holds value)
    floor_frac(B) = 0.10 · min(1, B/B*)                  — floor drains toward 0 as budget drops (balanced default)
    min_payment   = $10,000                              — below-line cleanup → literal $0 tail
    top-heavy toggle: floor_frac = 0 at any budget (drains the floor immediately, redistributes up)
```
**★ ANCHOR FRAMING REJECTED (Trevor 2026-08-15):** there is NO fixed "top-1% player = X% of budget" target, no cap,
implied or otherwise. The star's dollar FLOATS with his WAR and the budget through the formula — permanently, by design.
What was calibrated is the **ELASTICITY** — how much more a generational #1 commands than a merely-very-good #1 on the
same roster.
**alpha = 1.1 LOCKED.** Sensitivity on the Texas $5M roster (star's WAR swapped 2.5→5.5, same supporting cast):
alpha 0.9 → 3-WAR topper $350K (7.0%) / 5-WAR $523K (10.5%), ratio 1.49; alpha 1.0 → $362K/$563K, ratio 1.56; alpha 1.2
→ $379K/$643K, ratio 1.70. **1.1** sets a 5-WAR elite ~$600K (12%) and a 3-WAR roster-topper ~$370K (7.4%) on $5M, every
share emergent from WAR × budget, never anchored. **Rationale:** the observed Arkansas payroll fits ~0.9, but that curve
embeds coach-side suppression (caps, hometown discounts, peace-keeping); the model prices TALENT, coaches apply discounts
on top → price a step above the observed curve. **floor_frac stays 0.10.** Alpha + floor_frac live in the stamped
constants fixture (no inline copies).

**alpha 1.1 CONFIRMED LOCKED (Trevor 2026-08-15) — no re-run for decimal reconciliation.** The calibrated quantity was
always the ELASTICITY (the whole point of rejecting the anchor framing); the codebase exhibit reproduced it (ratio 1.62
vs chat's 1.63 = the formula reproducing to within rounding). The absolute dollars were never a promise — they were an
illustration on ONE roster with ONE WAR source. The ~8% gap between the descriptive-WAR exhibit ($650K @ 5-WAR) and the
chat illustration ($600K) has **fully named causes** (WAR source = descriptive total WAR; weaker supporting cast in the
auto-picked Texas roster) → a discrepancy explained by identified mechanisms is a RECONCILIATION, not a bug. And the
**wire-time scoring source (toggled build snapshot + post-Step-6b transfer projections) will differ from BOTH** the chat
illustration and the descriptive exhibit — so decimal-matching a roster that will never exist in production chases a
number with no referent. Both illustrations sit inside the same behavior: **star share floating 7–14% with his WAR.**

**EMERGENT-SHARES DEMONSTRATION (on the record — Oklahoma is the useful outlier):** in the exhibit, Oklahoma's top-1 =
**10.7%** while every other tier sits 13–15%. That is NOT noise — the curve is correctly reading a **deeper roster**:
their supporting cast holds more surplus, so the topper claims less of the same budget, same formula. This is the answer
to a coach asking "why does my guy show a smaller % than that other program's guy": **deeper roster, same formula —
shares are EMERGENT, never anchored.**

**ACCEPTED COST OF 1.1 (eyes-open, documented):** choosing steeper-than-observed compresses the middle roster. On the
Texas exhibit (balanced), rank-15 drops **$114K → $95K** and rank-20 **$66K → $51K** going 0.9 → 1.1. That transfer of
value to the top is the deliberate, accepted cost of pricing talent a step above the coach-suppressed observed curve.

**Floor toggle (ships v1, GM SETTINGS):** per-team GM setting, both modes always available.
- "Balanced roster" = floor on (default) · "Top-heavy" = floor_frac=0, difference redistributes upward.
- Label by philosophy, never mechanism. Effect concentrated at the bottom (contributors → $0), modest at top. Every
  dollar exhibit + UI surface respects the team's selected mode.

**★ BUDGET DOWNSCALING (budget-flex) — settled + VERIFIED (Trevor, 2026-08-16).** The curve must NOT scale linearly with
budget: at a small budget the top must stay COMPETITIVE (not collapse budget/$5M) while the floor drains to $0 faster.
Two budget-flexed knobs, BOTH baked into the default curve (formulas above):
- **Concentration ramp** `alpha(B) = max(1.1, 1.1 + 0.5·log10($5M/B))` — 1.1 at $5M, 1.45 at $1M, 1.60 at $500K. Makes
  the top HOLD value as budget drops (top-1 holds ~28% of its $5M dollar at $1M vs 20% under pure-linear) and squeezes
  the middle. Clamped ≥1.1 so **$5M is the fixed calibration endpoint** (locked elasticity untouched); everything below
  concentrates from there. Budgets >$5M behave as $5M (revisit if a mega-budget program appears).
- **Floor drain** `floor_frac(B) = 0.10·min(1, $5M/… )` → `0.10·min(1, B/$5M)` — full floor (0.10) at $5M = the locked
  balanced default; drains linearly (0.02 at $1M) so the guaranteed floor trends to $0 progressively, not chopped.
- **Two levers, ONE is a toggle.** The ramp is ALWAYS on (not coach-facing; "linear" is never offered — it's the naive
  shrink we rejected). The floor toggle (balanced ↔ top-heavy) is the single GM setting, stacking on top of the ramp.
- **DEFAULT = ramp + balanced floor** (both on). **Top-heavy toggle** = `floor_frac=0` at any budget.
- **Verified (Georgia roster, 2026-08-16):** Σ NIL_i = B exactly at $5M/$3M/$1M/$500K, both modes; toggle behaves
  correctly at every budget (drops the guaranteed floor, pushes up, 1 fewer paid, Σ conserved) and its top-up shrinks at
  low budget (+$57K at $5M → +$5K at $1M) because the floor is already draining. $5M default = byte-identical to the
  pre-budget-flex locked behavior (27 paid, floor $22.6K, top-8 58%).

**Alpha justification (exactly this):** alpha is fit to the aggregate share anchors (top-1/3/8), which survive real-world
capping noise. Model does NOT reproduce pay ties (e.g., three players capped at $500K); it spaces the top by actual
score gaps. Value-honest allocation; the coach applies politics on top.

**Display rule:** allocations under $5K display as a "walk-on / development" tier (low-major floors ~$1K; never print that precision).

**Retired constants (delete, do not stack on):** proportional budget share, `RAW_WAR_BENCHMARK=33` + all dup copies,
`DEFAULT_PROGRAM_TOTAL_PLAYER_SCORE=68`, PVF inside `calcPlayerScore`.

## 3. Need Detection (from existing roster state)
- **Coverage authority:** a player covers ONLY his slotted position. Pitch-log innings are the position authority, not listed autofills.
- **Starter line = CHAMPIONSHIP-starter bar (LOCKED 2026-08-16, `src/lib/positionNeed.ts`).** Per-position WAR bar =
  **p70 of full-time regulars** (reg_season_pa≥200 hitters / reg_season_ip≥65 wSP) on **2026 DESCRIPTIVE full-season WAR**
  (`total_desc_war` / `desc_pwar`) — NOT projection (projection bakes in the depth role we assign). p70 (top-tier, past
  SS's glove-first cluster) because users strive for championships: a spot is "solid" only if a rostered player is a
  championship-caliber regular there. Stamped bars: C 2.11 · RF 1.88 · 1B 1.77 · CF 1.74 · LF 1.70 · 3B 1.57 · 2B 1.48 ·
  SS 1.42 · weekend-SP 3.06. Generic pitch-log `OF`/`IF` labels use the group average until the position-display fix.
  A returner clears on his DESCRIPTIVE WAR; a target has no descriptive history so his board value is his projection, but
  the roster's need-state is decided by the returners' descriptive WAR vs the bar.
- **Freshmen / no-history:** carry 0 WAR (freshman valuation logged future work); a slotted freshman does not clear the line.
- **Three states, pricing is BINARY:** `empty` (nobody clears / nobody slotted → full need premium) · `thin` (someone
  slotted, nobody clears → full need premium; DISPLAY state only so the coach sees his player acknowledged) · `solid`
  (a slotted player clears the 50th line → multiplier 1.0).

## 4. Need Ladder (judgment-set by Trevor) — ★ THE positional-value layer (LOCKED 2026-08-16)
**Decision (Trevor 2026-08-16): positional value is PURELY team-need-driven — this need ladder is the ONLY positional
multiplier. There is NO always-on national positional multiplier** (the old PVM is retired, NOT replaced by a derived
national index — see §7.4). A position commands a premium ONLY when it's an actual hole on the roster (empty/thin per §3),
which is the scarcity a coach actually feels. No bench tier.
Applied to target-board displayed prices ONLY while position is in need (empty/thin). Never touches rostered allocations.
| Position | Need multiplier |
|---|---|
| C, SS, weekend SP | 1.3 |
| All OF (incl CF), 2B, 3B | 1.1 |
| 1B, DH, non-starter pitchers | 1.0 always |
- **CF = 1.1 (not 1.3) is COACH-FEEDBACK-backed** (a receipt, not a guess) — and the 2026 descriptive re-pull agreed (CF
  not distinctly scarce). Up-the-middle premium is C/SS, not CF.
- **Generic `OF` / `IF` labels also map to 1.1** — the pitch-log position read still emits generic `OF`/`IF` until the
  position-display fix lands (a wiring dependency). Conservative: `IF`→1.1 (never auto-credit a generic infielder the SS
  1.3), `OF`→1.1 (all OF is 1.1 regardless).
Encodes conversion difficulty. Magnitudes 1.3/1.1/1.0 are Trevor-set (validated ordering, not fitted).

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
   then each roster's position state (empty/thin/solid) + which player clears it. Sanity: SEC mostly solid, low-major
   mostly need. **REMINDER (Trevor): starter lines compute from PROJECTION WAR per the spec → this item inherits NONE of
   the descriptive-vs-projection ambiguity from the alpha exhibits.**
5. **Need multiplier effect.** One roster with an SS need: sample board SS priced with/without 1.3, and the reprice when
   a qualifying SS is added (his frozen value + board's new SS at 1.0). BOTH floor modes. **REMINDER (Trevor): the freeze
   demo must use the WIRE-TIME scoring source (toggled build snapshot + post-Step-6b transfer projections) so it shows
   the PRODUCT, not another illustration.**
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

**★ 2026-08-16 DESCRIPTIVE RE-PULL — national derived surface PARKED for good (v1), hand ladder is final.** Re-ran at
≥50 half-innings (corner truncation fixed: LF/RF now mid-pack; 311 multi-position players vs the old 34). Switched the
value axis to DESCRIPTIVE reg-season WAR (Trevor: projected WAR bakes in the depth-role we assign, so it's not a clean
talent signal). Findings: (a) wSP scarcest by a mile (median weekend starter 2.46 > every position's Tier-1; scarcity is
ROLE-slot, ~1.2/team, not elite-count); (b) on descriptive WAR the within-position elite→median cliff is nearly FLAT
(~1.75–1.92 all positions except 2B 1.46) — so cliff barely differentiates; (c) raw elite-SUPPLY count (≥2.0 WAR bar)
INVERTS intuition (2B/3B fewest elite; C/SS/RF abundant) because catcher counting-WAR is SUPPRESSED by fewer innings
(rest days → lower ceiling, p90 only 1.52) and raw count tracks total bodies. **Conclusion: the national "how much is a
position worth in the abstract" signal is inherently noisy at this level (answer flips by metric; catcher needs a special
per-inning normalization). Not worth chasing.** Positional value → PURELY the §4 team-need premium (Trevor 2026-08-16).
The re-pull scripts were throwaway; data source = `"Hitter Master".total_desc_war_reg` / `"Pitching Master".desc_pwar_reg`
(Season 2026) joined to `player_season_defense` (2026, half_innings≥50) by `source_player_id`, D1 only.

## §6 EXECUTION STATUS (2026-08-14) — item 1 INCONCLUSIVE, scoring-source correction found
Item 1 (Arkansas projection re-fit) was run and is **inconclusive, NOT a real failure — I fit against the WRONG
scoring source.** Findings:
- **Returner projections are FRESH** (`updated_at=2026-08-13`, Step 6); WAR math is correct for the projected wRC+
  (Traeger desc wRC+ 102 → proj 117 → 1.77 WAR checks out).
- **The base `returner/regular` projection is the UN-TOGGLED baseline.** The coach's build applied **dev aggressiveness +
  cornerstone role**, which lift WAR above the baseline (Souza base ~104 wRC+/1.15 WAR → the toggled build number the
  coach paid $500K against). **The payroll tracks the TOGGLED `player_snapshot` values, not the base projection** — so
  the fit MUST score off the build snapshot (toggle-applied), which is exactly what §7c produces.
- **Transfers were scored on their OWN-SCHOOL projection** (Gomez's 3.24 is his FDU value, not SEC-trimmed for Arkansas).
  The Arkansas-context transfer projection is stale until Step 6b runs.
- Gomez ($25K, 3.24-WAR FDU SS, correct cornerstone role) = a real bargain the tool would surface — hometown-discount
  layer, not a model error. Relievers are systematically paid below WAR (market/leverage) — the coach's layer.
- **Reframe (Trevor):** the tool INFORMS off projected WAR; the coach applies discounts/role/retention. Do NOT fit
  alpha/floor_frac to reproduce the exact payroll. Open calibration question flagged: reliever role/leverage adjustment;
  and whether the projection lifts a good hitter's down year enough (Traeger 102→117 vs expected 125–130).
- One role caveat: TJ Pompey stored cornerstone on `regular_season_pa` 190 (but total `pa` 225 ≥ 220 → cornerstone is
  right if the role uses total pa) — resolve the pa-vs-regular_season_pa role source in bucket 4.
**TO RE-DO ITEM 1 CLEANLY:** score off the build `player_snapshot` (toggled) with transfers on the Arkansas-context
projection (post Step 6b). Items 2–7 not started.

## 8. DATA PULLS for §7 — DONE 2026-08-14 (in `PLAYER_SCORE_NIL_ALLOCATION_2026_08_14.md`)
Six pulls returned (availability dropped per Trevor — project forward, can't predict portal; JUCO excluded naturally):
supply counts + Tier-1 by position, within-position projection-WAR distributions, weekend-SP identification (Role=SP &
IP≥65), sanity row (ladder vs Tier-1 count), 34-player multi-position translation. Credible = half_innings≥100.
