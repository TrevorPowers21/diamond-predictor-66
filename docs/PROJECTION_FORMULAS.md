# Projection Formulas & Backend Design

## Batting Average (BA) Prediction — Returning Players Only

### BA Formula
```
Blended = (LastBA × (1 - PowerRatingWeight)) + (NCAAAvgBA × (BAPowerRatingPlus / NCAAAvgPowerRating) × PowerRatingWeight)
Mult = 1 + ClassAdjustment + DevAggressiveness × 0.06
Projected = Blended × Mult
Delta = Projected - LastBA
DampFactor = {1.0 if Delta ≤ 0, 1.0 if 0 < Delta ≤ 0.03, 0.9 if 0.03 < Delta ≤ 0.06, 0.7 if 0.06 < Delta ≤ 0.08, 0.4 if Delta > 0.08}
Final = LastBA + (Delta × DampFactor)
```

### OBP Formula
```
Blended = (LastOBP × (1 - PowerRatingWeight)) + (NCAAAvgOBP × (OBPPowerRatingPlus / NCAAAvgPowerRating) × PowerRatingWeight)
Mult = 1 + ClassAdjustment + DevAggressiveness × 0.06
Projected = Blended × Mult
Delta = Projected - LastOBP
DampFactor = {1.0 if Delta ≤ 0, 1.0 if 0 < Delta ≤ 0.03, 0.9 if 0.03 < Delta ≤ 0.06, 0.7 if 0.06 < Delta ≤ 0.08, 0.4 if Delta > 0.08}
Final = LastOBP + (Delta × DampFactor)
```

### Parameters
- **PowerRatingWeight** = 0.7 (constant, shared across both BA and OBP)
- **NCAAAvgPowerRating** = 100 (constant, shared damping factor, do NOT edit)
- **NCAAAvgBA** = .280 (example; NCAA average batting average, year-specific, **editable via admin UI**)
- **NCAAAvgOBP** = .385 (example; NCAA average on-base percentage, year-specific, **editable via admin UI**)
- **ClassCode** = Class transition code (FS, SJ, JS, GR; shared across formulas)
- **ClassAdjustment** = Based on ClassCode:
  - FS (Freshman) → +3% (0.03)
  - SJ (Sophomore/Junior) → +2% (0.02)
  - JS (Junior/Senior) → +1.5% (0.015)
  - GR (Graduate) → +1% (0.01)
- **DevAggressiveness** = -2 to +2 (manual per-player adjustment; -2=conservative, +2=aggressive; shared across formulas)

**Player-Specific Data (from database):**
- **LastBA** = Prior season batting average
- **LastOBP** = Prior season on-base percentage
- **BAPowerRatingPlus** = BA Power Rating+ from power ratings CSV (Column 21), indexed by player
- **OBPPowerRatingPlus** = OBP Power Rating+ from power ratings CSV (Column 22), indexed by player

### Class Adjustments
- FS (Fresh) → +3%
- SJ (Sophomore/Junior transitional) → +2%
- JS (Junior/Senior transitional) → +1.5%
- GR (Graduate) → +1%

### Power Ratings CSV Structure

**File:** `Offensive Transfer Portal_NIL Valuation Model - All Power Ratings (1).csv`

**Import Strategy:**
- **Column 1:** Player name
- **Columns 2–3:** Contact%, Line Drive% (used in formula calculations)
- **Columns 4–33:** Essential stat inputs (Chase%, Barrel%, Fly Ball%, BB%, Pop-Up%, Exit Velocity, Contact SD, LD SD, EV SD, etc.)
  - 📌 **Important Note:** These columns are necessary for the projection formula but currently come from Excel. Plan API integration (e.g., 64analytics) to pull live data for backend automation.
- **Columns 34–36:** Spacing/empty columns
- **Column 20:** BA Power Rating (not used in formula)
- **Column 21:** BA Power Rating+ ← **This is L26 in the formula** ✅
- **Columns 22–24:** OBP Power Rating+, ISO Power Rating+, Overall Power Rating+
- **Skip rows 4–33 and 37–57** during CSV import (these are header/spacing/detail rows)

---

## Pending Clarifications

### 1. BA-Specific Power Ratings (L26) ✅ RESOLVED
**Answer:** BA Power Rating+ comes from the power ratings CSV (Column 21), keyed by player name.

**Action:** Create `team_power_ratings` table to store imported CSV data, then lookup player's team/conference to fetch L26 during projection calculation.

### 2. Global Parameters (U3, V3, Y3) ✅ RESOLVED
**Answer:** Create a dedicated `projection_weights` table with specifically-named columns for each weight. This table will be managed in the admin dashboard and shared across multiple equations (BA projection, returning player projection, transfer portal model, etc.).

**Action:** Create migration for `projection_weights(id, season, u3, v3, y3, [other shared weights], created_at, updated_at)`. Plan API endpoint to fetch active weights by season.

### 3. Admin UI Features ✅ RESOLVED
**Selected:**
- ✅ View/filter predictions by season, model, status
- ✅ Edit global parameters (V3, U3 overrides)
- ✅ Edit per-player dev_aggressiveness
- ✅ Manually trigger full or partial recalculation
- ✅ Export predictions to CSV/Excel
- ✅ View projection history / audit trail

**Action:** Build admin dashboard section with prediction table grid, parameter editor, recalc trigger button, and export function.

### 4. Dev Aggressiveness (F26)
**Status:** Already in `player_predictions.dev_aggressiveness`; may need refinement per requirements.

### 5. Last Season BA (from_avg)
**Status:** Stored in `player_predictions.from_avg`; existing schema supports pooling later.

### 6. Multi-year Projections (2025 → 2026+)
**Status:** `player_predictions` has `season` column; ready for multi-year calculations.

**Action:** Design edge function to generate forecasts for upcoming seasons (2026, etc.).

### 7. Returning Player Equation ✅ IN PROGRESS
**Status:** BA formula for returning players (provided and documented above). Ready for backend implementation.

**Action:** Create edge function and database schema to calculate returning player BA projections.

### 8. Transfer Portal Equation 🔔 PENDING
**Status:** Different equation for transfer portal players. Pending formula details from user.

**Action:** Get transfer portal BA projection formula once returning players complete.

---

## Schema TODO

- [ ] Verify/create BA-specific power rating column or table.
- [ ] Create `projection_parameters` table (or decide alternative).
- [ ] Create edge function: `calculate_ba_projection(player_id, season)`.
- [ ] Add admin UI endpoint to manage V3 (and U3 if override needed).
- [ ] Batch recalculation function for all players (triggered manually or daily).
- [ ] Admin dashboard view: see/edit stored predictions, manually trigger recalc.

---

## NIL Valuation Model Split (Future Note)

- Keep two separate NIL equations:
  - **Default NIL equation** is for **software access users only**.
  - **Program-specific NIL equation** is for **consultation workflows only**.
- Program-specific consultation equation:
```
PlayerScore = oWAR × PTM × PVF
ProgramSpecificNIL = (PlayerScore / SumOfTotalRosterPlayerScore(~68 fallback)) × NILBudget
```
- Surface consultation equation outputs in:
  - `NIL Valuation` dashboard
  - `Team Builder` (team enters NIL budget; app auto-calculates player score and roster score sum)

---

## Admin Dashboard Cleanup
- Consolidate prediction management into a dedicated "Projections" section.
- Add controls to:
  - View/filter predictions by season, model, status.
  - Edit global parameters (V3).
  - Edit per-player dev aggressiveness.
  - Manually trigger full or partial recalculation.
  - Export predictions to CSV/Excel.

---

## Future Must-Dos (Post-CSV Automation)

- Next session priority: Start with **Isolated Power Power Rating** and finish the full setup end-to-end (equation, inputs, NCAA averages, standard deviations, editable weights, and rating+).
- Define a single source-of-truth schema for `players`, `teams`, `conference_stats`, `park_factors`, `power_ratings`, and `player_predictions` with canonical IDs and alias mapping.
- Replace CSV uploads with automated data ingestors (API/scrape connectors) writing into staging tables first.
- Add scheduled sync jobs (daily/weekly) with idempotent upserts.
- Add validation gates before promotion from staging to production (required fields, ranges, duplicates, canonical team-name checks).
- Automatically calculate and refresh all model standard deviations from full-system player data during data processing (with manual override retained in admin).
- Pull score inputs as percentiles directly from TruMedia (or equivalent primary data source) instead of manually deriving percentile scores in the app.
- Version equation constants/weights with effective dates and store version used for each prediction run.
- Trigger automatic prediction recalculation after successful syncs (incremental first, full batch optional).
- Separate environments (`dev`, `test`, `prod`) and keep `testing-trevor` pointed to test-only data sources.
- Add admin override workflows with lock + reason + audit history so manual changes are traceable.
- Add monitoring/alerts for sync failures, stale data, unresolved aliases, and abnormal row deltas.
- Run parallel CSV vs automated pipeline validation during cutover, then retire CSV operations after parity.
