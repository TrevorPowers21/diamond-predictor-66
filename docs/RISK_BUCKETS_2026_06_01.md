# Risk Model — Proposed Empirical Buckets

Generated 2026-06-01 from prod 2026 distributions. Walk through, push back, then I implement.

**Scoring principles (locked):**
- Penalty for bad signal ~2× reward for elite signal ([risk asymmetry](../../.claude/projects/-Users-danielleogonowski/memory/feedback_risk_asymmetry.md))
- Buckets cut at empirical percentiles, not hand-tuned ([data-driven thresholds](../../.claude/projects/-Users-danielleogonowski/memory/feedback_data_driven_thresholds.md))
- Risk = quality + variance of the roster spot ([risk principle](../../.claude/projects/-Users-danielleogonowski/memory/feedback_risk_assessment_principle.md))

---

## 1. Empirical 2026 distributions

### Hitter Master (D1, PA ≥ 75) — n=3,359

| Metric | P5 | P10 | P25 | P50 | P75 | P90 | P95 |
|---|---|---|---|---|---|---|---|
| Contact% | 64.6 | 67.5 | 72.3 | 77.3 | 82.0 | 85.8 | 87.7 |
| Chase% | 14.6 | 16.5 | 19.3 | 23.0 | 27.0 | 31.0 | 33.5 |
| Avg EV | 78.1 | 80.0 | 83.1 | 86.0 | 88.8 | 90.9 | 92.3 |
| EV90 | 95.0 | 96.6 | 99.0 | 101.6 | 104.0 | 106.1 | 107.5 |
| Barrel% | 3.3 | 6.6 | 11.5 | 16.8 | 21.9 | 26.5 | 28.9 |
| LD% | 14.3 | 16.1 | 18.9 | 21.8 | 25.0 | 27.8 | 29.4 |
| BB% | 5.3 | 6.4 | 8.5 | 10.8 | 13.5 | 16.1 | 17.9 |
| Pull% | 24.4 | 27.3 | 31.9 | 37.1 | 42.3 | 47.3 | 50.5 |
| GB% | 28.5 | 31.4 | 36.2 | 41.9 | 47.8 | 53.4 | 57.0 |
| PA | 85 | 95 | 130 | 184 | 224 | 244 | 254 |

### Pitching Master (D1, IP ≥ 20) — n=2,772

| Metric | P5 | P10 | P25 | P50 | P75 | P90 | P95 |
|---|---|---|---|---|---|---|---|
| Stuff+ | 91.6 | 94.1 | 97.5 | 101.4 | 105.4 | 109.3 | 111.4 |
| Whiff% | 15.2 | 16.7 | 19.5 | 22.9 | 26.8 | 31.1 | 33.6 |
| IZ Whiff% | 9.5 | 10.9 | 13.3 | 16.1 | 19.2 | 22.6 | 24.9 |
| BB% | 5.1 | 6.0 | 8.0 | 10.2 | 12.8 | 15.5 | 17.2 |
| Hard Hit% | 23.0 | 26.0 | 30.0 | 35.0 | 40.0 | 44.0 | 47.0 |
| GB% | 30.3 | 32.7 | 37.0 | 41.9 | 47.2 | 52.1 | 55.3 |
| IP | 21 | 23 | 28 | 37 | 52 | 68 | 75 |

### Projections — n=5,291 hitter / 5,230 pitcher

| Metric | P5 | P10 | P25 | P50 | P75 | P90 | P95 |
|---|---|---|---|---|---|---|---|
| Hitter p_wrc_plus | 65 | 73 | 84 | 97 | 108 | 118 | 123 |
| Pitcher p_rv_plus | 50 | 64 | 81 | 97 | 111 | 123 | 130 |

### Conference Competition — n=40

| Metric | P5 | P10 | P25 | P50 | P75 | P90 | P95 |
|---|---|---|---|---|---|---|---|
| Conf Stuff+ (pitcher quality) | 93.2 | 94.6 | 97.9 | 100.0 | 101.5 | 104.1 | 104.8 |
| Conf OPR (hitter talent) | 44.6 | 55.8 | 89.3 | 95.3 | 101.3 | 108.3 | 114.9 |

### Trajectory — YoY deltas 2025→2026

| Metric | P5 | P10 | P25 | P50 | P75 | P90 | P95 |
|---|---|---|---|---|---|---|---|
| Δ Contact% (hitter, n=1,772) | -8.9 | -6.8 | -3.6 | -0.1 | 3.2 | 6.2 | 7.9 |
| Δ Chase% (hitter) | -8.4 | -6.5 | -3.3 | 0.0 | 3.2 | 6.2 | 8.0 |
| Δ Barrel% (hitter) | -11.6 | -8.2 | -3.5 | 1.0 | 5.9 | 10.0 | 12.5 |
| Δ Stuff+ (pitcher, n=1,270) | -6.5 | -4.8 | -2.5 | 0.1 | 3.1 | 5.7 | 7.3 |
| Δ BB% (pitcher) | -6.9 | -5.1 | -2.8 | -0.5 | 1.5 | 3.7 | 5.1 |
| Δ Whiff% (pitcher) | -6.8 | -5.0 | -1.9 | 1.3 | 4.5 | 7.9 | 9.7 |

---

## 2. Key findings from the data

### Projection upper buckets are empirically unreachable today

The current model's top hitter Projection bucket is `pWRC+ ≥ 150 → risk 5`. **Empirically, P95 is 123** — meaning ~zero hitters qualify for that bucket in prod. The whole top tier of the current bucket scheme (130/115) is also above P95 / near it. Same for pitchers: current "elite ≥160 pRV+" is way above empirical P95 (130).

**Implication:** the current model effectively collapses Projection into a 4-bucket scheme starting at "above-avg starter" because the upper 4 buckets are empty. We should cut the buckets where players actually live.

### Some current Skillset thresholds are right

The "Contact% > 85 = elite" label is fair — that's P90. "Chase% < 22 = plus" sits at P30, which is more like "above avg" than "plus." Tightening needed but the magnitudes weren't wrong by much.

### Current Barrel% thresholds are way too lenient

Today's model says "Barrel% > 10 + EV > 88 = premium hard-hit profile, -10 risk." Empirically Barrel > 10 is below P25 — fires for **75% of hitters**. Premium should mean P85+ which is Barrel > 25.

### Conference Stuff+ has tighter spread than the current scheme assumes

40 D1 conferences. P5 to P95 spans only 11.6 points (93 → 105). Current buckets carve 3-point slices at the top (108 / 105 / 102 / 100) — empirically those buckets are at P95+, P95-P92, P92-P75, P75-P50. Way too granular at the top.

---

## 3. Proposed buckets

### Projection (35% weight)

**Hitter (p_wrc_plus):**
| Bucket | Cut | Risk | Frequency |
|---|---|---|---|
| Elite | ≥ 118 | -10 | top 10% |
| Plus | 108-117 | -4 | top 25% |
| Average | 85-107 | 0 | middle 50% |
| Below avg | 73-84 | +12 | bottom 25% |
| Poor | < 73 | +22 | bottom 10% |
| Bottom 5% | < 65 | +28 | bottom 5% |

**Pitcher (p_rv_plus):**
| Bucket | Cut | Risk |
|---|---|---|
| Elite | ≥ 123 | -10 |
| Plus | 111-122 | -4 |
| Average | 82-110 | 0 |
| Below avg | 64-81 | +12 |
| Poor | < 64 | +22 |
| Bottom 5% | < 50 | +28 |

### Skillset — Hitter

**Contact% (primary, asymmetric):**
| Cut | Risk | Note |
|---|---|---|
| ≥ 86 | -8 | elite (P90+) |
| 82-85.9 | -4 | plus (P75-90) |
| 72.3-81.9 | 0 | average |
| 67.5-72.2 | +12 | below avg (P10-25) |
| < 67.5 | +22 | poor (P5-10) |
| < 65 | +28 | bottom 5% |

**Chase% (secondary, inverted, asymmetric):**
| Cut | Risk | Note |
|---|---|---|
| ≤ 16.5 | -6 | elite (P10-) |
| 16.5-19.2 | -3 | plus (P10-25) |
| 19.3-26.9 | 0 | average |
| 27-30.9 | +10 | above avg (P75-90) |
| ≥ 31 | +18 | high (P90+) |
| ≥ 33.5 | +25 | top 5% |

**Chase × Contact interactions** (your locked rule, asymmetric):
- Both bad (chase > 27 AND contact < 72): +12 extra
- Both elite (chase < 16.5 AND contact > 86): -6 extra
- Both plus (chase < 19 AND contact > 82): -3 extra
- Very bad contact + good chase (contact < 68 AND chase < 19): -4 (partial offset)

**Avg EV (light weight, asymmetric, more penalty than reward):**
| Cut | Risk |
|---|---|
| > 91 | -2 |
| 83-91 | 0 |
| 80-82.9 | +5 |
| < 80 | +10 |

**EV90 (ceiling cap):**
| Cut | Risk |
|---|---|
| > 106 | -4 |
| 99-106 | 0 |
| 96.6-98.9 | +5 |
| < 96.6 | +8 |

**LD × Contact bonus** (high floor archetype):
- LD > 25 AND Contact > 82 → -6

**Barrel × Contact bonus** (new — premium contact + power):
- Barrel > 22 AND Contact > 82 → -8

**Barrel + bad chase penalty** (boom-or-bust):
- Barrel > 22 AND Chase > 27 → +12

**GB% (your locked rule, hitter-only):**
| Cut | Risk |
|---|---|
| ≥ 53 | +6 ("power output capped") |
| 48-52.9 | +3 |
| 32-47.9 | 0 |
| < 32 | -4 ("feel for hitting in the air") |

### Skillset — Pitcher

**Stuff+ (anchor, asymmetric):**
| Cut | Risk |
|---|---|
| ≥ 109 | -10 (P90+) |
| 105-108.9 | -5 (P75-90) |
| 97.5-104.9 | 0 (average) |
| 94.1-97.4 | +12 (P10-25) |
| < 94.1 | +22 (poor) |

**Whiff% (results signal, validated by IZ Whiff%):**
| Cut | Risk | Validation |
|---|---|---|
| ≥ 31 | -4 | requires IZ Whiff ≥ 16, else 0 |
| 27-30.9 | -2 | requires IZ Whiff ≥ 14, else 0 |
| 19.5-26.9 | 0 | — |
| 16.7-19.4 | +8 | — |
| < 16.7 | +14 | — |

**IZ Whiff% standalone flags (gating only, not its own scorer):**
- High Whiff + Low IZ Whiff combo (whiff ≥ 27 AND iz_whiff < 13): zeros the whiff bonus, no extra penalty

**BB% (close 2nd, asymmetric):**
| Cut | Risk |
|---|---|
| ≤ 6 | -6 (elite, P10-) |
| 6-7.9 | -3 (plus, P10-25) |
| 8-12.7 | 0 (average) |
| 12.8-15.4 | +12 (above avg) |
| ≥ 15.5 | +22 (high, P90+) |

**Stuff × BB interactions** (mirrors hitter Chase×Contact):
- Below avg Stuff (<94) AND high BB% (>13) → +10 extra
- Elite Stuff (≥109) AND elite BB (≤6) → -4 extra

**Hard Hit% (penalty-only, batted-ball-luck signal):**
| Cut | Risk |
|---|---|
| ≥ 44 | +12 (P90+) |
| 40-43.9 | +6 (P75-90) |
| < 40 | 0 (no reward) |

### Competition (20% weight)

**Hitter (faces pitcher quality, Conf Stuff+):**
| Cut | Risk |
|---|---|
| ≥ 104 | -8 (top conference tier) |
| 101.5-103.9 | -4 |
| 97.9-101.4 | 0 (average D1) |
| 94.6-97.8 | +12 |
| < 94.6 | +22 |

**Pitcher (faces hitter quality, Conf OPR):**
| Cut | Risk |
|---|---|
| ≥ 108 | -8 |
| 101-107 | -4 |
| 89-100 | 0 |
| 56-88 | +12 |
| < 56 | +22 |

### Trajectory (12% weight)

**Meaningful change thresholds (per metric):**
- Hitter Contact%: ±3.2 points = directional (matches P25/P75)
- Hitter Chase%: ±3.2 points
- Hitter Barrel%: ±4 points (slightly wider — more YoY variance)
- Pitcher Stuff+: ±2.5 points
- Pitcher BB%: ±2.5 points (asymmetric distribution favors BB improvement)
- Pitcher Whiff%: ±4 points

**Tier scoring:**
| Pattern | Risk |
|---|---|
| 2+ metrics meaningfully up | 25 (Progressing) |
| 2+ metrics meaningfully down | 60 (Regressing) |
| Mixed / mostly flat | 35 (Plateau) |
| < 2 prior seasons | factor skipped, weights renormalize |

### Sample Size (8% weight)

**Hitter PA:**
| Cut | Risk |
|---|---|
| ≥ 225 | 5 (reliable, P75+) |
| 184-224 | 15 (adequate, P50-75) |
| 130-183 | 30 (limited, P25-50) |
| 95-129 | 50 (small, P10-25) |
| < 95 | 75 (very small, <P10) |

**Pitcher IP:**
| Cut | Risk |
|---|---|
| ≥ 52 | 5 (reliable) |
| 37-51 | 15 (adequate) |
| 28-36 | 30 (limited) |
| 23-27 | 50 (small) |
| < 23 | 75 (very small) |

---

## 4. What to push back on

A few places I'm uncertain — would value a quick check:

1. **Hitter Projection top cut at 118.** P90 in projections — feels right to me. But "elite" maybe should be rarer (P95 = 123)? Up to you.
2. **Avg EV magnitudes are very light** (-2 to +10). Consistent with your "shouldn't carry much weight" feedback. Want them lighter still or fine?
3. **Pitcher Conf OPR P10 is 55.8** — that's some sparse-data low-major conferences. Risk +22 at <56 might over-penalize. Could cap penalty for pitchers from very low-major at +15 since competition risk is inherent and well-known.
4. **Trajectory uses ±3.2 / ±2.5** as "meaningful change." Could go wider (±5) so only obvious moves trigger.

Once you sign off, I rebuild `playerRisk.ts` from this spec and ship it.
