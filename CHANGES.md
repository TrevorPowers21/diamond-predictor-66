# Changelog — testing-peyton

## Session: March 11, 2026

### Team Builder — Compare Tab (Work In Progress)
- Added a new `Compare` tab in Team Builder.
- Built two independent side-by-side panels: `Compare A` and `Compare B`.
- Each panel now has:
  - Player search (name/team/position)
  - Destination team search
  - Context + multipliers display (from/to conference, park factor, AVG+/OBP+/ISO+ deltas, Stuff+ delta)
  - Projected outcomes (`pAVG`, `pOBP`, `pSLG`, `pOPS`, `pISO`, `pWRC+`, `oWAR`, projected NIL)
  - Clickable link to the selected player profile
- Compare panels support choosing the same player in both A and B for side-by-side scenario testing.

### Start Here Next Session
- Start in Team Builder `Compare` tab.
- Validate calculations panel-by-panel against Transfer Portal dashboard for matching inputs.
- If any mismatch appears, trace one player line-by-line (PowerAdj, Blended, Multiplier, Projected) before changing broad logic.

## Session: March 10, 2026

### Fixes

#### Transfer Portal — 400 Bad Request on player predictions query
- Removed trailing comma after `power_rating_plus` in the Supabase select string that caused all `/pitches/` queries to be rejected.

#### Transfer Portal & Team Builder — Prediction selection mismatch
- **Root cause:** TeamBuilder was filtering predictions with `variant='regular' + status IN ('active','departed')`, which could exclude a player's only valid prediction.
- **Fix:** Aligned TeamBuilder's prediction filter to match Transfer Portal — `model_type IN ('returner','transfer')` only.

#### Team Builder — Non-deterministic prediction tie-breaking
- Added `updated_at` descending as a secondary sort key in `selectTransferPortalPreferredPrediction` so the same prediction is always chosen regardless of DB return order.

#### Team Builder — Ranking formula mismatch vs Transfer Portal
- Added `modelMatchBoost` (+4 for transfer model) and `variantBoost` (+3 for regular variant) to the TeamBuilder rank function, matching Transfer Portal's logic exactly.

#### Team Builder — oWAR and NIL display mismatch vs Transfer Portal
- **Root cause:** TeamBuilder applied a `depthRoleMultiplier` (0.6× for default "utility" depth role) to oWAR and used a different NIL calculation pipeline (`calcPlayerScore`), while Transfer Portal uses raw values.
- **Fix:** Updated `simulateTransferProjection` to return `owar` and `nil_valuation` computed identically to Transfer Portal (`owar × basePerOwar × ptm × pvm`). Target player rows now display raw values, bypassing the depth role multiplier.

---

### UI Changes

#### Team Builder — Collapsible cards
- **Projected NIL Equation** card: collapsed by default, click header to expand/collapse.
- **Team-Only Power Metrics Upload** card: collapsed by default, click header to expand/collapse.
- Both cards show a chevron indicator (▾ / ▴) in the header.

#### Overview (Dashboard) — Visualization redesign
- Replaced two separate "Visual Top 10" and "Ranking Top 10" modules (each with their own metric dropdown + pool dropdown) with a single unified card.
- **Metric selection** is now a tab strip: `pAVG · pOBP · pSLG · pOPS · pISO · pWRC+ · oWAR · NIL`
- **Pool selection** is a single dropdown (All Conferences or specific conference) in the top-right corner.
- Left panel: ranked player list (1–10) with player name, school, position, Transfer badge, and metric value.
- Right panel: horizontal bar chart — same data, visual representation. Chart stretches to match list height.
- Removed gold/silver/bronze rank badge styling from top-3 entries.
- Improved bar chart spacing (`barCategoryGap="30%"`).

---

### Debug Cleanup
- Removed all `[TB-sim]`, `[TB-cands]` console.log statements from `TeamBuilder.tsx`.
- Removed all `[TP-sim]` console.log statements from `TransferPortal.tsx`.

---

### Open Questions / Planning

#### Default Depth Role for New Target Players
- Currently defaults to `"utility"` (0.6× multiplier), which affects internal scoring and budget calculations.
- **Question:** Should newly added target players default to `"starter"` (1.0×) instead?

#### NIL Display — Team Builder
- Projected NIL column remains visible in the roster/target board tables.
- Future consideration: move projected NIL values behind an admin-only screen or informational pop-up.

#### Performance & Bugs
- Excessive re-renders visible during page load (multiple simulation calls per player per render cycle).
- Consider memoization audit or moving heavy computations outside render.

#### Site Development
- Create a separate admin/testing site and a dedicated single-team demo site.

#### Non-Game Data Loading
- Implement fall/pre-season and in-season data ingestion via Hawkeye/TrackMan templates or a new secure upload template.
