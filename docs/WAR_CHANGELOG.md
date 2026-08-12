# WAR Changelog — visible reasons for every number move

Coaches see WAR on staging/prod. Every time a number moves, it gets a dated line here, and the
coach-facing note (WhatsNewModal) is posted when the change actually reaches prod. Trust erodes the
second time numbers move without a posted reason.

---

## 2026-08-10 — Hitter oWAR conversion corrected (staging; not yet on prod)
**What moves:** hitter offensive WAR (oWAR), and anything priced off it (rankings, NIL/market value,
team totals). Star hitters up, below-average hitters down, league-average unchanged. Pitcher WAR
unaffected by this item.

**Why:** the constant converting wRC+ to runs was wrong. It had been set to the league's average
runs-per-PA (0.163); the correct value is the run-value of a wOBA point (lgwOBA/wOBAscale = 0.3994).
The old value systematically under-counted hitters and compressed the top. The fix is a pure slope
correction: it pivots around the league-average hitter (which is why average players don't move) and
lets each hitter land on his true value — the projected number now reproduces descriptive at 0.04 WAR.

**Magnitude (real players):** Helfrick 1.46 → 2.19 (matches his actual production); Hairston (best bat
in the country) → 5.28. Good-but-normal hitters move ~+0.7; only elite outliers move a lot, because
they were the ones most compressed.

**Not egregious because:** top position-player totals (~5–6.6) are bat + premium-position defense +
baserunning, not a runaway offensive number; the pitcher and hitter value spreads match (WAR SD 0.94
vs 0.95, both peaking ~4.8σ), so a win is a win across both sides.

**Cross-system consistency check that passed:** Helfrick's dWAR here (2.49) matches the defensive
board's park-free floor (+33.5 runs ÷ 13.1 = 2.56) within rounding — two separate pipelines, same number.

**Status:** on staging, verified in-DB. Reaches prod at Step 8 (prod replay) — post the WhatsNewModal
note then.

---

## (earlier) 2026-08-07 — D1 scale reconcile (RPW 10 → 13.1, D1 run environment)
Moved all WAR onto the D1 run environment. NOTE: this pass introduced the wrong 0.163 oWAR conversion
constant (corrected 2026-08-10 above).

---

## 2026-08-11 — Step 5: hitter replacement level derived (WAR zero-point) — staging
**What moves:** ALL hitter oWAR — descriptive (re-populated now) + projected (at Step 6). Every hitter shifts down
~0.38 WAR for a full-timer (scales with PA). Pitcher WAR unchanged. Rankings/NIL/team totals shift with oWAR.

**Why:** the hitter replacement floor was **2.0 wins/600 (borrowed from MLB)**; the pitcher floor (RA9 8.83) was
**derived from a .380 win% anchor** (a replacement team wins 38% — the standard definition). Step 5 puts BOTH on
that one principle: replacement offense scores 5.41 R/9 (vs 6.913 avg) at D1's empirical 42.4 PA/9 → 21.25 runs/600
→ **1.62 wins/600**. The borrowed 2.0 was too generous for D1's higher-offense environment.

**Verified, not tuned:** 1.62 lands between the empirical part-time (100–200 PA, −0.79) and depth (50–100 PA, −2.47)
tiers — i.e. the real "freely-available ~100–150 PA player." Kept the principled .380 value rather than snapping to
a band (selection bias means played-depth guys overstate replacement talent).

**Sites:** war.ts (21.22 = 1.62×13.1) + edge fn + woba_weights.json/ncaa_averages fixtures + AdminDashboard +
model_config; descriptive oWAR re-populated (Hairston 5.28→5.07, Helfrick 2.19→1.99). 247 tests updated + pass.
**Status:** staging. Projected oWAR updates at Step 6. Reaches prod at Step 8.

## 2026-08-11 — Power-rating composites refit on 2026 data (staging; live at Step-6)
**What moves:** the `+`-stat composites that steer projected rates — era⁺ and the three hitter composites
(baPlus/obpPlus/isoPlus). Hitter composites move projected AVG/OBP/SLG → wRC+ → oWAR; era⁺ is display/scouting.

**Why:** the composite weights were hand-set; refit same-season on 2026 (D1, rounded 0.05, rounding-free) they
correct several things the hand-weights missed, all consistent with our derived physics:
- **era⁺** — walks were badly under-weighted (0.17→0.30, now the top run-prevention input, matching D1-FIP's 0.570
  walk); in-zone-whiff dropped (redundant with whiff+Stuff+). `bb .30 · whiff .25 · stuff .20 · hardHit .15 · chase .05 · barrel .05`.
- **baPlus** — exit velo up (0.20→0.30). `contact .35 · lineDrive .20 · avgEV .30 · popUp .15`.
- **obpPlus** — built to the measured **57/43 hits/walks split** of OBP: walks 0.15→0.40. `contact .20 · lineDrive .10 · avgEV .15 · popUp .10 · bb .40 · chase .05`.
- **isoPlus** — la dropped (redundant with barrel); raw pull → **pull_air** (pulled-in-air %, pitch-log derived,
  the truer power skill); gb up. `barrel .30 · ev90 .35 · pullAir .10 · gb .25`.

**Data-verified:** era⁺ high-walk arms drop (Vigue 5.14 BB9 → 126), complete arms hold (Berggren 183); obpPlus
surfaces elite plate-discipline (CJ Griggs 21.8% BB → top-4); isoPlus tops are pull-air power hitters. Kept in
lockstep across `powerRatings.ts` + edge Deno port + AdminDashboard; **`pull_air` backfilled from the pitch log**
(retires the dead CSV importer). What the same-season fit could NOT touch (circular): k9⁺/bb9⁺ — left as-is.

**Status:** on staging (code + store re-run, propagate=false so predictions untouched). Reaches prod at Step 8.

**Round 2 (2026-08-11, full composite audit vs 2026 data):**
- **hr9⁺** = `barrel .15 · hard_hit .30 · gb .30 · pull .25` — added hard_hit (strong HR9 predictor, was unused);
  dropped ev90 (corr 0.005) + la (hurt fit); whiff/flyball tested + rejected (whiff double-counts K9). MOVES pWAR (D1-FIP HR9 term).
- **whip⁺** = `bb .30 · whiff .45 · stuff .25` — WHIP is 71% hits / 29% walks (like obpPlus): walks (bb) + hit-suppression
  via MISS-BATS (whiff+stuff, not contact quality — pitcher controls whiffs, not BABIP). Dropped weak ld/ev/gb/chase. DISPLAY-only.
- Confirmed no change: era⁺/baPlus/obpPlus/isoPlus (current inputs already top predictors); k9⁺/bb9⁺ (circular).
model_config sync for all metrics applied on staging.

## 2026-08-11 — Pitcher pRV+ → D1-FIP (staging code; live at Step-6 re-precompute)
**What moves:** pitcher pRV+ and (via it) pWAR, market value, rankings. Aces stop being buried (the old
z-averaged blend compressed the top tail); pRV+ now tracks projected run prevention directly.

**Why:** the old pRV+ blended six overlapping `+`-stats (FIP already contains K/BB/HR) and z-averaged them,
compressing the ace tail. Replaced with the validated D1-FIP index: `projRA9 = (3.847 − 0.231·K9 + 0.509·BB9
+ 1.486·HR9) × 1.137`, `pRV+ = 100 + 100·(6.913 − projRA9)/6.913`. One definition everywhere (projection from
projected rates, actuals from actual rates). Descriptive pWAR (`desc_pwar`) unchanged.

**Status:** on staging (code); reaches prod at Step 8. team_war_snapshots reseed (from desc_pwar) folds into Step 6.
