# WALKTHROUGH — Returner-Hitter Recompute (edge fn `recalculate-prediction`)

Read top-to-bottom. Each step: **where the data comes from → the equation → the real math → 🚩 what's wrong.**
Goal: agree on every defect so the rebuilt edge fn matches the intended equation.

## The player (real row, staging, projecting 2026→2027)
| input | value | table.column |
|---|---|---|
| from_avg | 0.297 | `player_predictions.from_avg` ← Hitter Master `AVG`/`blended_avg` |
| from_obp | 0.415 | `player_predictions.from_obp` ← Hitter Master `OBP`/`blended_obp` |
| from_slg | 0.371 | `player_predictions.from_slg` ← Hitter Master `SLG`/`blended_slg` |
| power_rating_plus (overall) | 88 | `player_predictions.power_rating_plus` ← Hitter Master overall power rating |
| per-stat `from_obp_plus` (SD-blend needs this) | — | `player_predictions.from_obp_plus` ← Hitter Master `obp_power_rating` |
| class_transition | JS | `player_predictions.class_transition` ← `class_year` |
| dev_aggressiveness | 0 | `player_predictions.dev_aggressiveness` |
| **STORED result** | p_avg 0.276 · p_obp 0.407 · p_slg 0.373 · p_iso 0.097 · p_wrc 0.380 · p_wrc+ 100 | `player_predictions.p_*` |

---

### STEP 1 — Load the player row
Reads `player_predictions` (`.select("*")` WHERE `model_type IN (returner,transfer)` AND `status='active'`), edge line 305. ✅ fine.

### STEP 2 — Load config
Reads `model_config` `.eq("model_type","returner")`, edge line 207.
🚩 **WRONG #1 — 0 rows.** All model_config rows are `model_type='admin_ui'`; the returner equation is stored as `r_*` keys there. So `configRows` is empty → the code silently uses **hardcoded Deno defaults** (edge lines 214-219). None of your stored equation is read.

### STEP 3 — Class base + dev
`ct=JS` → `bases = classBases['JS']`. **Source used:** hardcoded `{avg .015, obp .02, slg .02}` (should be `model_config` `r_ba_class_js`=1.5→.015 / `r_obp_class_js`=1.5→.015 / `r_iso_class_js`=2→.02).
🚩 **WRONG #2 — hardcoded ≠ stored:** stored OBP class base is **.015**, hardcoded is **.02**. Also the key is `r_iso_class_*` (iso) but the edge maps it to `.slg` — name mismatch. `devAgg = 0` (from the row). ✅ dev ok.

### STEP 4 — Dampening model
Edge uses a **divisor** model: `d = 1 − min(.75, max(0,(stat−ncaaBase)/divisor)×prFactor)`, divisors `{avg .10, obp .085, slg .30}` (hardcoded).
🚩 **WRONG #3 — wrong dampening model.** Your stored model is **tiered** (`r_obp_damp_tier1_max .455 / tier2 .485 / tier3 .525` with impacts `1/.9/.7/.4`). The edge divisor model is a different mechanism entirely.

### STEP 5 — OBP (`usePR=false`)
```
d        = 1 − (0.415−0.385)/0.085              = 1 − 0.353 = 0.647
growthAdj= 1 + (0.02 + 0)·0.647                 = 1.01294
powerAdj = 1 + 0.4·((88−100)/100)·0.647        = 0.96894
p_obp    = 0.415 × 1.01294 × 0.96894           = 0.4073 → 0.407
```
✅ matches stored 0.407 — but **coincidental** (uses the wrong hardcoded base .02 + wrong damp; lands here anyway).

### STEP 6 — AVG (`usePR=true`, prFactor = 1.1−0.88 = 0.22)
```
d        = 1 − (0.297−0.28)/0.10 × 0.22         = 1 − 0.0374 = 0.9626
growthAdj= 1 + (0.015 + 0)·0.9626               = 1.01444
powerAdj = 1 + 0.4·(−0.12)·0.9626              = 0.95380
p_avg    = 0.297 × 1.01444 × 0.95380           = 0.2874 → 0.287
```
🚩 **WRONG #4 — stored is 0.276, edge gives 0.287.** The edge fn did NOT produce the stored data.

### STEP 7 — SLG (`usePR=true`)
```
d        = 1 − max(0,(0.371−0.442)/0.30)        = 1 − 0 = 1.0     (below NCAA → no damp)
growthAdj= 1 + (0.02 + 0)·1.0                    = 1.02
powerAdj = 1 + 0.4·(−0.12)·1.0                  = 0.952
p_slg    = 0.371 × 1.02 × 0.952                 = 0.3603 → 0.360
```
🚩 **WRONG #5 — stored is 0.373, edge gives 0.360.**
Then `p_ops = p_obp + p_slg`, `p_iso = p_slg − p_avg = 0.360−0.287 = 0.073` (🚩 stored 0.097).

### STEP 8 — wRC
```
edge line 114:  p_wrc = 0.691·p_obp + 0.235·p_slg          (NO intercept)
              = 0.691·0.407 + 0.235·0.373 = 0.369
stored p_wrc  = 0.380 = 0.011 + 0.691·0.407 + 0.235·0.373  ← the +0.011 intercept is IN the stored value
```
🚩 **WRONG #6 — missing the `0.011` wRC intercept.** This is the "wRC+ is now OBP+SLG (+intercept)" change; the edge fn is on the old formula.

### STEP 9 — wRC+
```
edge:   (0.369 / 0.3782)·100 = 98
stored: (0.380 / 0.3782)·100 = 100
```
🚩 **WRONG #7 — edge would output 98 where the real answer is 100.**

### STEP 10 — Write back
Writes `{p_avg,p_obp,p_slg,p_ops,p_iso,p_wrc,p_wrc_plus,...}` → `player_predictions` (edge line 330).
🚩 **WRONG #8 — power model is wrong end-to-end:** multiplicative `1 + powerWeight·((prPlus−100)/100)·d` instead of your **SD-blend**, AND it uses the **overall** `power_rating_plus` (88) for every stat instead of the **per-stat** `from_obp_plus` your equation calls for.

---

## FLAG SUMMARY (8)
1. Reads `model_type='returner'` → 0 rows → hardcoded defaults (never reads stored `r_*`).
2. Hardcoded class bases ≠ stored (OBP .02 vs .015; iso↔slg name mismatch).
3. Divisor dampening instead of the stored **tiered** model.
4. AVG output wrong (0.287 vs 0.276) → edge is not the producer.
5. SLG output wrong (0.360 vs 0.373); ISO wrong (0.073 vs 0.097).
6. wRC omits the **0.011 intercept**.
7. wRC+ wrong (98 vs 100).
8. Power model is multiplicative (not SD-blend) and uses **overall** rating, not **per-stat** `from_obp_plus`.

## The intended equation the rebuild must implement (your spec)
```
ScaledOBP = NCAAAvgOBP + ((OBPPowerRating+ − NCAAAvgPowerRating) / StdDevOBPPowerRating) × StdDevNCAAOBP
Blended   = LastOBP × (1 − PowerRatingWeight) + ScaledOBP × PowerRatingWeight
Mult      = 1 + ClassAdjustment + DevAggressiveness × 0.06
Projected = Blended × Mult
```
**Sources for the rebuild:** `OBPPowerRating+` = `player_predictions.from_obp_plus` (← Hitter Master `obp_power_rating`); `StdDevOBPPowerRating` = `model_config.r_obp_std_pr` (**32.41** after the fix); `StdDevNCAAOBP` = `model_config.r_obp_std_ncaa` (0.046781); `NCAAAvgOBP` = `r_ncaa_avg_obp` (0.385); class/dev/damp/wRC (+intercept) all from `r_*`. Read from `model_config` (`admin_ui`), no hardcoded fork.

---
*(Next: same walkthrough for TRANSFER — `recalcTransfer` / `process-precompute-jobs`, which also reads Conference Stats + Park Factors + Teams Table.)*
