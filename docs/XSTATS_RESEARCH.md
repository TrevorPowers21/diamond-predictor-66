# Expected Stats (xBA / xSLG / xOBP / xOPS / xISO / xwOBA) — Research

**Purpose:** Settle the methodology before Trevor pulls TruMedia exports.
Specifically: figure out which inputs actually matter, address Trevor's
hunch that MLB doesn't actually use spray angle, and lock in the
RSTR IQ approach.

**Status:** Research / planning. No code changes from this doc.

---

## 1. Your hunch about spray angle is correct

**MLB's official Statcast xBA / xSLG / xwOBA use ONLY (exit_velocity,
launch_angle).** Spray angle is NOT in the model.

Sources (well-documented public methodology, MLB.com / Baseball Savant):

- **xBA released 2017** as a 2D lookup of (EV, LA) → probability of a hit
- **xSLG released 2018**, same 2D lookup, different weighting (probability
  of single / double / triple / HR)
- **xwOBA released 2017**, same 2D lookup, weighted by linear weights
- **xBA + Sprint Speed** added 2019 as a variant for fast runners (infield
  hit probability inflates with sprint speed). The CORE model is still
  EV × LA — sprint speed is an additive adjustment, not a third dimension
- **Spray angle was NOT added to the public xBA model.** MLB has internally
  noted that adding spray would help with shifts and asymmetric fields,
  but they've chosen not to make it part of the canonical x-stats. The
  reason: shifts/positioning move year-to-year and add noise; pure
  physics-based xBA stays stable

### Why MLB doesn't use spray (the actual reasoning)

1. **Year-to-year noise.** Defensive positioning changes (the 2023 shift
   restrictions changed average xBA-by-shift values overnight). A pure
   physics model doesn't have this problem.
2. **Selection effect.** Spray angle correlates with the type of pitch you
   got — outside pitches go oppo, inside go pull. Including it bakes in
   pitcher patterns rather than hitter quality.
3. **Bucket sparsity.** Adding a third dimension multiplies bucket count
   — 24 EV × 30 LA × 20 spray = 14,400 buckets vs 720 in 2D. Many become
   thin.
4. **Stability.** Pure physics xBA is the "skill" signal. Coaches use it
   to identify under/over-performers vs their actual outcomes.

---

## 2. What this means for RSTR IQ

### Option A: Match MLB exactly — 2D (EV, LA) only

- **xBA / xSLG / xwOBA computed from (exit_velocity, launch_angle) only**
- Spray angle still useful for Pull%/Center%/Oppo% (display stat, not in x-stat model)
- **Doesn't require the deferred SprayAng re-export.** Can build xBA/xSLG TODAY
  with existing pitch_log data (we already have EV + LA)
- Matches industry standard, comparable to MLB metrics
- Coaches recognize the methodology

### Option B: 3D model — (EV, LA, Spray)

- More granular, catches direction effects (pull power, oppo singles)
- Requires SprayAng re-export
- Some buckets thin → estimates jitter
- Deviates from MLB convention — coaches doing cross-comparison see different numbers

### Option C: 2D base + spray-adjusted variant

- Compute pure 2D xBA as the headline (MLB-comparable)
- Also compute "xBA-adjusted" or "xSLG-adjusted" as supplementary metrics
  that bake in spray angle
- Best of both — coaches see the standard MLB shape, plus a college-specific
  spray-aware view
- Most work but most powerful

### Recommendation: Option A first, Option C eventually

Build the pure 2D (EV, LA) model first — we have the data today, no
re-export needed. Validates the framework end-to-end. Once spray data
arrives, layer in C as an enhancement, not a replacement.

**This changes the deferred bucket priority.** Spray is still worth getting
for Pull%/Center%/Oppo% and Pull Air% display stats, but the xStats build
no longer blocks on it.

---

## 3. RSTR IQ xStats methodology (2D version, A)

### 3a. Bucket the (EV, LA) space

```
EV buckets:  1-mph bins, 60-119 mph    →  60 buckets
LA buckets:  1° bins, -30° to +60°     →  91 buckets
Total: 60 × 91 = 5,460 buckets
```

With 2.5M+ batted balls in 2026 alone, most buckets will be well-populated.
Edge buckets (very low EV or extreme LA) will be thin — we'll smooth those
via neighbor averaging or just trust them less.

### 3b. Compute per-bucket outcome probabilities

For each (EV, LA) bucket, count actual outcomes from ALL pitch_log
batted balls across all hitters / pitchers / situations:

```sql
SELECT
  FLOOR(exit_velocity)::int  AS ev_bin,
  FLOOR(launch_angle)::int   AS la_bin,
  COUNT(*)                                                       AS n,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Single')::numeric / COUNT(*) AS p_1b,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Double')::numeric / COUNT(*) AS p_2b,
  COUNT(*) FILTER (WHERE pitch_result_category = 'Triple')::numeric / COUNT(*) AS p_3b,
  COUNT(*) FILTER (WHERE pitch_result_category = 'HR')::numeric     / COUNT(*) AS p_hr
FROM pitch_log
WHERE is_batted_ball_in_play
  AND exit_velocity IS NOT NULL
  AND launch_angle IS NOT NULL
GROUP BY ev_bin, la_bin
HAVING COUNT(*) >= 5  -- min sample per bucket
```

Stored in `pitch_log_xba_lookup` (see §3c schema).

### 3c. Schema

```sql
CREATE TABLE pitch_log_xba_lookup (
  ev_bin integer NOT NULL,        -- floor(exit_velocity)
  la_bin integer NOT NULL,        -- floor(launch_angle)
  sample_n integer NOT NULL,
  p_1b numeric NOT NULL,
  p_2b numeric NOT NULL,
  p_3b numeric NOT NULL,
  p_hr numeric NOT NULL,
  p_hit numeric NOT NULL,         -- sum of the above
  expected_bases numeric NOT NULL, -- 1*p_1b + 2*p_2b + 3*p_3b + 4*p_hr
  expected_woba numeric NOT NULL,  -- weighted by linear weights
  computed_at timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ev_bin, la_bin)
);
```

### 3d. Per-player x-stat aggregation

Add to `pitch_log_hitter_totals`:

```sql
ALTER TABLE pitch_log_hitter_totals
  ADD COLUMN x_hits_sum numeric NOT NULL DEFAULT 0,
  ADD COLUMN x_bases_sum numeric NOT NULL DEFAULT 0,
  ADD COLUMN x_woba_sum numeric NOT NULL DEFAULT 0;
```

Compute by joining batted balls to the lookup at aggregation time:

```sql
SELECT
  batter_id,
  season,
  ...,
  SUM(COALESCE(l.p_hit, 0))         AS x_hits_sum,
  SUM(COALESCE(l.expected_bases, 0)) AS x_bases_sum,
  SUM(COALESCE(l.expected_woba, 0))  AS x_woba_sum
FROM pitch_log p
LEFT JOIN pitch_log_xba_lookup l
  ON FLOOR(p.exit_velocity)::int = l.ev_bin
 AND FLOOR(p.launch_angle)::int = l.la_bin
WHERE p.is_batted_ball_in_play
  AND <dimension filter>
GROUP BY batter_id, season
```

### 3e. Derive at display time

```
xBA   = x_hits_sum  / ab            (K and other non-batted-ball outs add 0)
xSLG  = x_bases_sum / ab
xISO  = xSLG - xBA
xwOBA = (x_woba_sum + bb*w_bb + hbp*w_hbp) / (ab + bb + hbp + sf)
```

Where `w_bb ≈ 0.69`, `w_hbp ≈ 0.72`, `w_1b ≈ 0.88`, `w_2b ≈ 1.25`,
`w_3b ≈ 1.58`, `w_hr ≈ 2.04` (the linear weights baked into
`expected_woba` per bucket; BB/HBP added externally since they're not
batted balls).

### 3f. xOBP — derived, not in the bucket model

OBP = (H + BB + HBP) / (AB + BB + HBP + SF)

xOBP just substitutes expected hits for actual:
```
xOBP = (x_hits_sum + bb + hbp) / (ab + bb + hbp + sf)
```

xOBP isn't strictly an "expected" stat in the Statcast sense (BB and HBP
are already deterministic, not probabilistic). But coaches will ask
for it — provide it as the natural extension.

### 3g. xOPS = xOBP + xSLG (same as actual OPS)

---

## 4. Linear weights — values to use

MLB's 2023 linear weights (publicly published by FanGraphs / MLB):

| Event | weight |
|---|---|
| BB | 0.696 |
| HBP | 0.726 |
| 1B | 0.882 |
| 2B | 1.254 |
| 3B | 1.586 |
| HR | 2.041 |
| Out | 0 |

These are for MLB. **For college**, the relative magnitudes will be
similar but the absolute scale shifts (different run environment).
The xwOBA scale will look ~10-15% higher in college due to higher BABIPs.

**Recommendation:** start with MLB weights for coach-recognizability. If
calibration drift becomes a real complaint, recompute college-specific
weights from RSTR IQ's own outcomes.

---

## 5. Implementation phasing

| Phase | What | Requires SprayAng? | Time |
|---|---|---|---|
| **xStats A1** | Build lookup table from existing pitch_log (EV, LA only) | No | ~30 min |
| **xStats A2** | Add x_hits_sum / x_bases_sum / x_woba_sum to hitter_totals + hitter_by_pitch_type, populate via aggregation script | No | ~45 min |
| **xStats A3** | Display xBA / xSLG / xwOBA on percentile bars (per the locked UI placement) | No | ~30 min |
| **xStats A4** | Recompute league-average xwOBA on staging, sanity-check magnitudes against known hitters | No | ~15 min |
| **xStats B** | Spray-adjusted xBA variant (after SprayAng re-export) | Yes | ~1 hr |
| **xStats C** | Compare xPower 2025 → 2026 actuals vs current power_rating predictions (research) | No (uses A-derived xStats from 2025 once we have historical) | ~1-2 hr research |
| **xStats D** | Fold xPower into power_rating composite IF C proves it's better | No | Real refactor, careful rollout |

**The first 3 phases (A1-A3) can ship today with existing data.** SprayAng
deferral doesn't block xStats anymore.

---

## 6. Open questions for Trevor

1. **Bucket size:** 1 mph × 1° gives 5,460 buckets. Too fine? Coarser bins
   (2 mph × 2°) give 1,365 buckets — denser per-bucket sample, smoother
   estimates, but loses fine resolution. **Recommend:** 1×1, smooth via
   neighbor average when sample < 10.

2. **HR cap:** Should we cap p_hr to <1.0 even when a bucket has 100%
   home-run rate (e.g., 115 mph at 28° in our college sample)? MLB does
   no capping. **Recommend:** no cap — let the data speak.

3. **Out-of-park dimensions in college:** College parks vary more than MLB.
   A 415-foot HR at JMU is not a HR at Vandy. **For v1, ignore park
   factors.** Phase D refinement.

4. **Linear weights:** Use MLB's for v1, or compute college weights from
   our own outcomes? **Recommend MLB's** for v1 (coach-recognizable).
   College recompute is Phase D.

5. **Pitcher x-stats:** Same model, applied to pitches the pitcher threw.
   Tells you the QUALITY OF CONTACT he allows (xBA-against, xSLG-against).
   **Recommend including** in the Phase A build since it's the same lookup,
   different aggregation target.

6. **Showing on Stats page:** Per the locked UI decision, xBA and xSLG
   render on the percentile bars panel (right column), interleaved with
   AVG/SLG. xwOBA could go there too as a composite. **Recommend:** xBA,
   xSLG, xwOBA on the bars. xOBP / xOPS / xISO derived but maybe only
   shown in a future expanded view.

---

## 7. What changes for the deferred SprayAng work

The deferred bucket (`docs/PITCH_LOG_BUILD.md §10`) currently lists xStats
as depending on SprayAng. **That's wrong.** Update the deferred spec:

- **SprayAng is needed for:** Pull/Center/Oppo% · Pull Air% · spray-adjusted xBA variant (Phase B)
- **SprayAng is NOT needed for:** core xBA/xSLG/xwOBA (those use EV+LA only)
- **Distance is needed for:** xPower trajectory metric (still deferred)

So the xStats build can happen first. Spray gets its own pass when the
re-export is ready.

---

## 8. Recommended next session order

When Trevor sits back down:

1. **Read this doc** — confirm the 2D approach matches his intuition
2. **Decide on the 6 open questions in §6** — most have clear recommendations
3. **Build xStats A1-A3** (~2 hr) — get xBA/xSLG/xwOBA on the Stats page
4. **Spot-check a known elite hitter and a known regression-candidate**
   — confirm the x-stat directional reads pass the sniff test
5. **Validate xPower predictive value (Phase C)** — research exercise before
   touching projections
6. **Eventually: full power_rating refactor** — Phase D, careful rollout

After xStats A ships, then we tackle SprayAng re-export as a separate pass
for Pull/Center/Oppo + spray-adjusted variants.

---

## 9. One thing this doesn't address — the launch-blocking question

**Should xStats be in the launch v1?** That's a product decision, not a
technical one. The data + display work is real (a few hours), but it's
a NEW SIGNAL coaches haven't seen yet. Some risks:

- Coaches don't trust unfamiliar numbers without context
- xBA divergence from AVG creates "why is this different?" questions
- Without xPower → projection validation (Phase C/D), x-stats are pure
  display — useful for spot-checks but not yet powering decisions

**Safer launch posture:** ship the Season Stats page as-is (filter
dimensions, percentile bars, rates) WITHOUT x-stats. Add xStats in a
follow-up rollout after launch with explicit coach education on what
the new bars mean.

**Aggressive launch posture:** ship with xStats on the bars. Coaches
get the full Savant-style view from day one. Higher initial confusion,
faster feature parity with what they've seen on MLB.com.

Trevor's call.
