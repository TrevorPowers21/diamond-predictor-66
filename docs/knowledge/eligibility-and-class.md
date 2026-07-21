# Knowledge — Eligibility & Class Data

> Model + a verified audit of prod (2026-07-21). Facts are catalog/data-verified; the model rules are Trevor's judgment.

## The model (how class works)

- **`players.class_year` is the source of truth** for a player's real current class (FR/SO/JR/SR/GR, with `R-` redshirt prefixes). It comes from roster/class-data ingest.
- **`class_transition` is DERIVED from class_year** (`FR→FS, SO→SJ, JR→JS, SR→GR`; map in `importClassData.ts`). It is **double-duty**:
  1. a **projection input** — the 1st letter = current class, and the move carries a **developmental factor** (freshmen develop more year-over-year), and
  2. the **eligibility display** — its 2nd letter = next-season eligibility class.
- **Why class_transition exists separately:** the projection function was built *before* we had a way to pull real class data, so class_transition was its own thing (and defaulted). Now that class_year exists, it should drive everything.
- **Precedence:** explicit **coach override** (`player_overrides.class_transition`) wins → then **`class_year`-derived** → then default. Overrides are rare (redshirts / known eligibility that differs from class). *(Trevor: should also expose the override on player pages, not just Team Builder — future.)*
- **`predictionEngine` defaults class_transition to `"SJ"` when missing** (`|| "SJ"`) — this is the bug source: it defaults to sophomore→junior (→ JR) for everyone without an explicit transition, ignoring class_year.

## The bug (why grad/class year is inconsistent)

Same player shows different class across surfaces because different surfaces read different class sources:
- **GM roster / hub header** → `projectedEligibilityClass(class_year, meta.classTransition)` where `meta.classTransition` is a **frozen snapshot** captured at add-time (often the stale `"SJ"`). And `projectedEligibilityClass` checks the **transition first**, so a stale `"SJ"` **overrides** a correct `class_year`.
- **Projections page** → reads the **live** prediction's class_transition (often corrected to the right value), so it shows the right class.
Example: Cole Johnson (Georgia, `class_year="FR"`) — his own predictions are inconsistent: **2026 regular = `"SJ"`** (stale), **2027 = `"FS"`** (correct). Roster showed JR, projections showed SO.

## Verified audit (prod, 2026-07-21)

- `players.division`: **D1 = 26,110**, **NJCAA_D1 (JUCO) = 5,300**, D2 = 2.
- `player_predictions.season`: only **2026 (15,674)** and **2027 (200,754)** — no older seasons. 2027 is ~13× because each player is precomputed per customer team.
- **~50% of the players table is historical** — 15,738 of 31,412 have **no 2026 prediction** (reference/old-roster rows).
- **Null `class_year`, current players only:** 5,520 total → **251 D1**, **5,269 JUCO**. The missing-class problem is ~95% JUCO.
- **Stale-`SJ` disagreements, current players:** **7,970 — 100% D1, 0 JUCO.**

## Insights to carry (for any class/data audit)

1. **Always filter to current players** (`has a 2026 prediction`). The players table is half historical; raw counts are ~2× inflated otherwise.
2. **Segment by division.** JUCO (`NJCAA_D1`) has much thinner class data — it dominates missing-class stats and skews any class/eligibility audit. D1 is where the real, fixable data lives. (Consistent with JUCO data being thin generally.)
3. **The going-forward cohort = 2026 D1 players.** Historical + JUCO can skew data; scope decisions to current D1 first.

## Fix scope (bounded — pending Trevor's how-deep decision)

- **A. Display fix** — `projectedEligibilityClass` prefers `class_year` (transition = fallback only); route every eligibility display through it. Fixes ~8K D1 displays immediately, no re-precompute.
- **B. Projection fix** — derive class_transition from class_year in the engine + **re-precompute the ~7,970 D1 players** (moves their numbers via the corrected dev factor).
- **C. JUCO class-data** — populate `class_year` for ~5.3K JUCO (a separate ingest track).
- Cleanup: orphan player rows (e.g. the `team=null, class=null` Cole `d9f1e871`).
- **Status:** scope TBD. Fix on a `feature` branch off staging; combine with the live-pERA stored-first cleanup (same consistency theme).
