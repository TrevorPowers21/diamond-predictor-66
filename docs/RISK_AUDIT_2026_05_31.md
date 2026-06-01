# Risk Assessment Audit — 2026-05-31

Source: `src/lib/playerRisk.ts` (980 lines), `src/components/RiskAssessmentCard.tsx`, `src/components/JucoRiskCards.tsx`, `src/lib/pdfGenerator.ts` (risk section).

Purpose: full readout of what's in the model today, where the thresholds came from, and where I think we should focus the recalibration / additions.

---

## 1. Display change you asked for

**Drop the numeric score on the right side of each factor bar.**

- `RiskAssessmentCard.tsx:111-113` — RSTR card, 7-px wide score column
- `RiskAssessmentCard.tsx:170-172` — Savant card, 6-px wide score column

The score is already the bar fill width — the trailing number is redundant and the 0-100 scale has no real-world meaning to a coach. Recommend: keep the score in `RiskFactor.score` for the bar fill + sort logic, just stop rendering it as a digit. PDF (`pdfGenerator.ts:517-520`) also shows the number — same change there.

Optional polish: replace the right column with a tiny chip ("Low / Mod / Elev / High") per factor so coaches still get a categorical read without seeing the number.

---

## 2. Hitter risk model — current state

`assessHitterRisk` at `playerRisk.ts:908`. Five factors with weights `[0.35, 0.25, 0.20, 0.12, 0.08]`. Null factors get dropped and remaining weights renormalize.

### 2a. Projection (35%) — `assessHitterProjection`
Single input: projected wRC+.

| pWRC+ | risk score | tier label |
|---|---|---|
| ≥150 | 5 | elite |
| 130–149 | 15 | All-American |
| 115–129 | 25 | All-Conference+ |
| 105–114 | 35 | above-avg starter |
| 95–104 | 45 | average starter |
| 85–94 | 60 | below-avg |
| 75–84 | 75 | bench/depth |
| <75 | 88 | org depth |

**Concerns:**
1. Hand-tuned, not empirical. Need to pull the 2026 prod distribution of `p_wrc_plus` for hitters with ≥75 PA and bucket against actual 2026 wRC+ outcomes. The thresholds look right at the top (≥150 is rare-elite) but the middle bands feel too coarse — 95-104 covering a 10-point range at the median is where most decisions get made.
2. **Double-count risk vs Skillset.** Projection already bakes in chase / contact / EV via the prediction model. Then Skillset (factor 2) reads chase / contact / EV again. The two factors are not independent — a contact-heavy hitter shows up twice (good projection + good skillset). Net effect is the skillset axis carries less independent signal than its 25% weight implies.

### 2b. Skillset (25%) — `assessHitterTypeRisk` (`playerRisk.ts:139-333`)
Reads chase, contact, whiff, barrel, line drive, avg EV, EV90, pull, GB, BB. Starts at risk=50, applies a long sequence of +/- deltas, clamps 0-100. Fallback to slash-line (AVG/OBP/ISO) if no TrackMan.

Full threshold dump:

**Contact% (primary driver):**
- <66.7% +28 ("bottom 5%")
- <68% +18, <70% +8
- >85% -18 ("elite"), >80% -10 ("plus")

**Chase% (secondary):**
- >34% +16, >30% +12, >28% +8, >25% +4
- <19% -10 ("elite"), <22% -5 ("plus")

**Chase × Contact interactions (matches your locked rule):**
- both bad (chase>28 + contact<70): +12
- both elite (chase<19 + contact>85): -10
- both plus (chase<22 + contact>80): -6
- very bad contact + good chase: -5 ("does not fully offset")

**Whiff%:** >30% +6, <15% -4

**Avg EV:** <83 +5, <85 +3, >89 -2, >92 -4
**EV90:** <95 +4, >100 -1, >104 -3

**Other:**
- LD%>22 + good contact: -8 ("contact-oriented")
- EV<85 + good contact: -4 ("contact-over-power")
- Barrel>10 + EV>88 + NOT (both chase + contact bad): -10 ("premium hard-hit")
- Barrel>10 + EV>88 + both chase + contact bad: 0 ("power can't rescue")
- Barrel>8 + bad chase: +12 ("boom-or-bust")
- BB%>12 -6, BB%<5 +6

**Bugs / dead inputs:**
1. **`pull` is in the input but never consumed.** `playerRisk.ts:147, 159, 918` — passed in, included in the `anyTrackman` check, but no scoring rule references it. Should either remove it from the type or wire it up. Your locked rule on pull-air ("high pull-air = power feel, low pull-air = limited power") would slot in here.
2. **`gb` (hitter) is in the input but never consumed.** Same pattern as `pull`. Per your locked GB rule: high hitter GB = power potential capped, low hitter GB = feel for hitting in the air. Belongs in skillset.
3. **No penalty for very low LD%.** Bonus exists for >22%, no risk for <15%.
4. **Walk rate is a single binary check.** 12 / 5 buckets only. No middle ground.

**Calibration concerns vs scouting framework master:**
- Contact% buckets (66.7 / 68 / 70 / 80 / 85) — framework master has empirical tiers; need to map exactly. The 66.7 "bottom 5%" claim should be verified against current prod percentile distribution.
- EV90 thresholds (95 / 100 / 104) — framework master defines empirical bands; these may or may not match.
- Avg EV >92 "elite" — feels right; >89 "plus" might be too generous against framework master.

### 2c. Competition (20%) — `assessHitterCompetitionRisk`
Reads conference Stuff+ (pitching quality of the conference).

| Stuff+ | risk |
|---|---|
| ≥108 | 5 |
| 105-107 | 12 |
| 102-104 | 22 |
| 100-101 | 32 |
| 98-99 | 45 |
| 96-97 | 58 |
| 94-95 | 70 |
| 92-93 | 80 |
| <92 | 90 |

Fallback by conference tier (1=Power → 15, 2=strong mid → 35, 3=mid → 55, 4=lower → 75) if no Stuff+ provided.

**Concerns:**
1. Uses *conference average* Stuff+. A SEC hitter who only saw the bottom half of the SEC rotation has the same comp number as one who got the front-end starters. Could enhance with actual *faced* Stuff+ if we have it, but that's a downstream want.
2. SD=10 assumption ([stuff-plus-scale-study](../README.md)) needs validation. If actual SD is tighter, these buckets are over-spaced. If wider, under-spaced.
3. No interaction with skillset. A high-Stuff+-comp hitter who still posted elite contact should get an extra bonus — that's the "carries up" signal.

### 2d. Trajectory (12%) — `assessTrajectory(seasons, "hitter")`
Compares most recent season OPS to prior. Delta on (OBP + SLG).
- >+0.040: Progressing, risk=15
- -0.020 to +0.040: Plateau, risk=35
- <-0.020: Regressing, risk=65
- <2 seasons or no data: risk=40, "Unknown"

**Concerns:**
1. **Only 2-year delta.** A JR who went .700 → .850 → .830 reads as "regressing" against year 2 even though year 3 is the second-best of his career.
2. **OPS-based**, not wRC+. A hitter who played in a softer conf year 2 gets unfair credit; one who played up in year 3 gets penalized.
3. **No age/class adjustment.** A FR→SO bump is expected; a SR with no growth is more telling than a FR plateau.

### 2e. Sample Size (8%) — `assessSampleSize(pa)`
PA tiers: ≥200 (10), 150-199 (25), 100-149 (50), 50-99 (70), <50 (90).

**Concerns:**
1. Already pull back via your 75-AB blend in the projection. So Sample Size partially double-counts the pullback that already shaped the projection input.
2. 8% weight is small — fine.

---

## 3. Pitcher risk model — current state

`assessPitcherRisk` at `playerRisk.ts:939`. Six or seven factors:
- Without durability: weights `[0.30, 0.22, 0.18, 0.12, 0.08, 0.10]`
- With durability: `[0.28, 0.20, 0.16, 0.12, 0.06, 0.08, 0.10]`

### 3a. Projection (28-30%) — `assessPitcherProjection`
Reads pRV+.

| pRV+ | risk |
|---|---|
| ≥160 | 5 |
| 140-159 | 15 |
| 120-139 | 25 |
| 110-119 | 35 |
| 95-109 | 45 |
| 85-94 | 60 |
| 75-84 | 75 |
| <75 | 88 |

**Concerns:** same shape as hitters. The 95-109 band covers 15 points at the median — too wide. Also same double-count risk with Skillset.

### 3b. Skillset (20-22%) — `assessPitcherTypeRisk` (`playerRisk.ts:335-539`)
Reads Stuff+, Whiff%, BB%, Chase%, Barrel%, Hard Hit%, GB%, In-Zone Whiff%. Fallback to K/9, BB/9, HR/9.

**Stuff+ (anchor):**
- ≥115 -24, 108-114 -18, 103-107 -10, 100-102 -4
- <95 +7, <90 +14, <85 +20

**BB% (close 2nd, largest variance driver):**
- >14 +18, >12 +14, >10 +8, >8 +4
- <4 -16, <5.5 -12, <7 -6

**Stuff × BB interaction:**
- avg stuff + poor command (<100 + >10%): +10
- elite + elite (≥108 + <6%): -10
- plus + plus (103-107 + <7%): -5

**Hard Hit / Barrel — gated by whiff (`playerRisk.ts:455-480`):**
- *High-whiff pitcher (whiff ≥25%):* HH>45 +5, HH<25 -4, Barrel>12 +5, Barrel<4 -4
- *Low-whiff pitcher (whiff <25%):* HH>40 +14, HH 36-40 +8, HH<25 -6, HH<30 -3, Barrel>10 +12, Barrel 7-10 +6, Barrel<3 -6, Barrel<5 -3

**High Barrel + Low Whiff combo:** Barrel>7 AND whiff<20: +10

**In-Zone Whiff:** ≥20 -6, ≥16 -3, <12 +3, <10 +6. Plus: Stuff+≥105 with IZ whiff<12 → +5 ("stuff doesn't match in-zone misses")

**Chase:** >35 +5, >30 +3, <18 -3. Plus: chase>30 + BB<6 → +4 ("BB% masked by undisciplined opposing lineups")

**Whiff (discounted because chase pollutes it):**
- Whiff≥30 + IZ whiff≥16: -4 ("legitimate")
- Whiff<16: +4
- Whiff≥25 + IZ whiff<12: +5 ("inflated by chase, not real")

**GB%:** >55 -3, >50 -1

**Big missing items vs your locked feedback:**
1. **VAA is not in the model at all.** Your locked rule ([feedback_vaa_analysis.md](../../.claude/projects/-Users-danielleogonowski/memory/feedback_vaa_analysis.md)): VAA + release height + extension + IVB are required context for fastball quality. None of these are inputs today. For a high-Stuff+ pitcher with a flat VAA / poor extension, the Stuff+ is overstated and the risk model has no way to know.
2. **Pitch profile context (4S FB vs sinker) missing.** Your locked rule ([feedback_pitcher_framework.md](../../.claude/projects/-Users-danielleogonowski/memory/feedback_pitcher_framework.md)): hard hit reads differently against a 4S-dominant arm vs a sinkerballer. Today the only context for HH is whiff%. A sinker guy with whiff<25 + HH 36-40 gets +8 — but for him, ground-ball-tilted contact is the design. Risk is over-stated.
3. **Velocity not in the model.** At college level fastball velo is the floor-setter and a leading predictor of competition translation. Not used.
4. **No pitch-mix breadth.** A 2-pitch arm at 110 Stuff+ is a different risk than a 4-pitch arm at the same number. Reliever vs starter risk diverges here.
5. **No platoon / handedness signal.** LHP vs RHP, reverse splits, etc.

**Other concerns:**
- Hard Hit thresholds in low-whiff bucket (>40 +14) are punishing — but for a true GB sinker pitcher with HH>40 + GB>55, the GB bonus is only -3. Net +11 over-penalizes the archetype.
- IZ whiff thresholds (20 / 16 / 12 / 10) — verify against prod distribution. These look hand-tuned.

### 3c. Competition (16-18%) — `assessPitcherCompetitionRisk`
Conference Hitter Talent+. Same shape as hitter Stuff+ table, just inverted (high HitterTalent+ = elite comp).

Same concerns as hitter competition: conference-average, not faced; SD assumption; no interaction term.

### 3d. Trajectory (12%) — same fn as hitter
ERA delta. >-0.30 = Progressing (15), -0.30 to +0.30 = Plateau (35), >+0.30 = Regressing (65).

**ERA is noisy.** Trajectory based on ERA can flip on a couple of bad starts. FIP-based would be more stable. Better still: rate stats (K%, BB%, HardHit%) year-over-year.

### 3e. Sample Size (6-8%) — IP tiers
≥80 (10), 50-79 (25), 30-49 (50), 15-29 (70), <15 (90).

### 3f. Workload (8-10%) — `assessWorkload(ip, classYear)`
Class-keyed thresholds:

| Class | High | Moderate |
|---|---|---|
| FR | ≥60 IP (70) | 40-59 (40) |
| SO | ≥85 IP (70) | 65-84 (40) |
| JR | ≥100 IP (70) | 80-99 (40) |
| SR/GR | ≥110 IP (70) | 90-109 (40) |

**Concerns:**
- FR "high workload" at 60 IP is low — a healthy FR weekend starter in a power conf clears 60 by mid-April.
- Inverse intuition issue: "high workload" = high *risk*. For a starter, high IP is the *positive* signal — he stayed healthy and earned the role. For a reliever, 60 IP IS a lot. Workload risk should branch on role, not just class.
- Class-keyed but role-blind.

### 3g. Durability (10% when present) — `assessPitcherDurability`
Skipped if <2 prior seasons.

Rules:
1. Severe crash: prior peak ≥30 + recent <10 → 80 risk
2. Chronic low: ≥2 seasons + avg<15/season → 70
3. Moderate dropoff: prior peak ≥40 + recent <40% of peak → 55
4. Else: 20 ("healthy")

Reasonable heuristic. Two gaps:
1. No injury history field — durability is workload-shape proxy only.
2. A pitcher who moved from SP to RP intentionally reads as "dropoff" today (e.g. 80 IP → 25 IP). False positive.

---

## 4. JUCO variant — `JucoRiskCards.tsx`

Different factor set + weights. Worth noting because the same numbers-on-the-side decision applies (the card is rendered through the same `RiskAssessmentCardRSTR`, so removing the right-column score covers JUCO too).

**JUCO Pitcher (5 factors):** Projection 35, Skillset 25, **Data Reliability 15**, Competition 15, Stuff+ 10.
**JUCO Hitter (4 factors):** Projection 40, Skillset 30, **Data Reliability 15**, Competition 15.

Data Reliability tier: verified (5) / partial (40) / stats-only (70) / none (95) based on TrackMan pitch count + BF or PA.

The Data Reliability axis is good — would be worth a version of this for D1 hitters in the "partial scouting gap" bucket (~129 small-school hitters per [partial-scouting-gap](../../.claude/projects/-Users-danielleogonowski/memory/project_partial_scouting_gap.md)). Currently those get scored on slash-line fallback with no visibility that the read is data-limited.

---

## 5. Suggestions — prioritized for tomorrow's session

### Priority 1 — Display

- **Remove numeric score from each row.** Lines `RiskAssessmentCard.tsx:111-113`, `RiskAssessmentCard.tsx:170-172`, `pdfGenerator.ts:517-520`.
- Optionally replace with a 3-letter tier chip (LO / MOD / ELV / HI) so the categorical read survives.

### Priority 2 — Wire up dead inputs (small change, real signal)

- **Hitter `pull` and `gb` are passed in and ignored.** Per your locked rules:
  - High pull-air → power potential signal (lower risk on the EV side)
  - High GB → power potential capped (higher risk)
  - Low GB → feel for hitting in the air (lower risk on the contact side)
- One block of `if` rules at `playerRisk.ts:~295` would fix this.

### Priority 3 — Empirical recalibration (your "data-driven thresholds" rule)

Pull current 2026 distributions from prod and re-bucket against actual outcomes:
- Hitter projection thresholds vs 2026 actual wRC+
- Skillset thresholds for Contact / Chase / EV / EV90 — confirm "bottom 5%" / "elite" labels are real percentiles
- Pitcher Stuff+ thresholds — pair with [stuff-plus-scale-study](../../.claude/projects/-Users-danielleogonowski/memory/project_stuff_plus_scale_study.md); confirm SD before locking buckets
- IZ whiff thresholds (20 / 16 / 12 / 10)

### Priority 4 — Pitcher framework additions (your locked feedback)

- **VAA + release height + extension + IVB** as a fastball quality factor. Even a coarse first pass — "VAA flat for release height" flag → +risk overlay on Stuff+ — would close the locked-rule gap.
- **Pitch profile context** for hard hit. Tag arm as 4S-dominant vs sinker (use Stuff+ table's pitch usage rows), branch HH/Barrel thresholds accordingly.
- **Velocity** as a floor signal.

### Priority 5 — Trajectory upgrade

- Switch hitter trajectory from OPS to wRC+ (already computed).
- Switch pitcher trajectory from ERA to FIP or composite (K%+BB%+HH% trend).
- Consider a 3-year regression slope instead of binary YoY when 3+ seasons available.

### Priority 6 — De-couple Projection from Skillset

Projection already embeds the same chase/contact/EV signals Skillset uses. Options:
1. Make Skillset score the *residual* — how much the player's underlying inputs over/underperformed the projection model.
2. Drop one factor, rebalance weights.
3. Rename Skillset → "Translation Risk" and score only the inputs that DON'T flow into the projection (e.g. IZ whiff for pitchers, pull-air for hitters).

---

## 6. New factors / signals worth discussing

In rough order of how much I think they'd move the needle:

1. **Park-adjusted EV / Barrel / HR rate.** Hitters in extreme parks today get full credit for power. Park factor adjustment already lives in the simulator pipeline — pull it through here.

2. **Pitch-mix breadth (pitchers).** Count of pitches with usable Stuff+ + usage %. A 1-pitch reliever ≠ a 3-pitch starter at the same overall Stuff+.

3. **Platoon / handedness signal.**
   - Hitter: split vs LHP/RHP if we have it, or proxy with handedness + opp-handed Stuff+ faced.
   - Pitcher: reverse-split flag (LHP who's better vs RHB or vice versa) — major roster fit signal.

4. **2-strike approach (hitter).** Chase / whiff in 2-strike counts diverges from overall chase / whiff. If we don't have it now, flag as future-data want.

5. **BABIP regression flag.** Both sides — hitter BABIP above .380 likely regresses, pitcher BABIP below .240 likely regresses. Helps the projection-risk axis specifically.

6. **Conference move direction.** Step-up vs step-down on transfer should weight differently. Currently competition is just absolute, doesn't know about the move.

7. **Position-fit (hitter).** Bat profile vs defensive position. A low-power utility bat moving to corner OF is a roster-fit risk the projection won't catch.

8. **Workload role-aware (pitcher).** Branch the workload thresholds on starter vs reliever, not just class year. SP at 60 IP as a FR = healthy starter. RP at 60 IP = heavy bullpen leverage.

9. **Injury history field.** Anything from VA / coach notes / public reports. Currently only IP-shape is used as a proxy.

10. **Trajectory across competition moves.** If a player jumped from low-mid to power conf and held similar numbers, that's a stronger positive signal than the same numbers at one school.

11. **Roster context / opportunity risk.** Blocked at position, transferring into a crowded room. Outside the player profile, but a risk for the coach.

12. **Confidence band on the projection.** The projection has uncertainty (small-sample blend, partial-scouting gaps). Surfacing that band as its own factor would give coaches a "how much do we trust this" axis.

---

## 7. Quick "if we change nothing else, change this" list

1. Stop rendering numeric scores in the right column.
2. Use `pull` and `gb` for hitters.
3. Switch hitter trajectory to wRC+ delta.
4. Branch pitcher workload on role.
5. Add a "Data Reliability" factor for D1 partial-scouting players too.

These are all small surgical changes. Bigger items (VAA, pitch-profile context, empirical recalibration) need a longer session.

---

## Pointers

- [feedback_chase_contact_risk.md](../../.claude/projects/-Users-danielleogonowski/memory/feedback_chase_contact_risk.md) — already implemented well
- [feedback_pitcher_framework.md](../../.claude/projects/-Users-danielleogonowski/memory/feedback_pitcher_framework.md) — partially implemented, pitch-profile context missing
- [feedback_vaa_analysis.md](../../.claude/projects/-Users-danielleogonowski/memory/feedback_vaa_analysis.md) — not implemented at all
- [project_partial_scouting_gap.md](../../.claude/projects/-Users-danielleogonowski/memory/project_partial_scouting_gap.md) — only handled in JUCO, not D1
- [project_stuff_plus_scale_study.md](../../.claude/projects/-Users-danielleogonowski/memory/project_stuff_plus_scale_study.md) — SD assumption blocks confident Stuff+ tier locks
- [project_scouting_framework_master_2026_05_26.md](../../.claude/projects/-Users-danielleogonowski/memory/project_scouting_framework_master_2026_05_26.md) — section VII has empirical tier targets to compare against
