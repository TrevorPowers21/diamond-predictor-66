# AGENT LEARNINGS — Hitter descriptive Run Values on the Season Stats banner (2026-08-26)

> ⚠ **Read `docs/AGENT_LEARNINGS_INDEX.md` first.** These files were written in sequence during the
> WAR recalibration and **later ones correct earlier ones** — the index says which are superseded.


## What was built
A "VALUE" cluster on the RIGHT of the hitter Season Stats banner (`/stats` → `PitchLogSection`),
position players only, shown only on the full-season **unfiltered** view. Three descriptive
(last-season, NOT projection) run values, each a chip colored by its national z-percentile:

- **Batting Run Value** = `((wRC+ − 100)/100) × PA × 0.3994`, wRC+ from the stored season counts using
  the SAME OBP/SLG the banner shows (`OBP=(H+BB+HBP)/(AB+BB+HBP+SAC)`, `SLG=TB/AB`, wRC+ = C1 formula).
- **Defensive Run Value** = `player_season_defense.drs_floor` (DRS engine, same season).
- **Baserunning Run Value** = `player_season_baserunning.wsb_runs` (same season).

Each value's national **z-score** (`*_rv_z`) is stored too: `z = (rv − mean)/stddev_pop` over the
qualified 2026 population (batting `pa≥50` / defensive `half_innings≥50` / baserunning `opportunities≥20`).

## Trevor's design decisions (why it's shaped this way)
1. **Descriptive, last-season actuals — never projection.** The Season Stats page is descriptive; a
   projected number there would be inconsistent. (`o_war` on `player_predictions` is the projection —
   explicitly NOT used.)
2. **No live compute — store z-scores, pure-read on display.** Folded into the existing "add z-scores
   when we accrue data" process (the season-stats aggregation), read straight off the stored row.
3. **Read from where the season-stats percentiles read** = `pitch_log_hitter_totals` (keyed
   `batter_id, season, dimension_key`; "no filters" = `dimension_key='all'`), NOT `player_predictions`.
4. **Same line as the plain chips, percentile-table treatment** (colored red/blue by rank), labeled
   "Value"; chips named Batting / Defensive / Baserunning Run Value.

## Where it lives
| Piece | File |
|---|---|
| 6 columns on `pitch_log_hitter_totals` | `supabase/migrations/20260826150000_hitter_descriptive_run_values.sql` |
| `populate_hitter_run_values(season)` SQL fn | `supabase/migrations/20260826150500_populate_hitter_run_values_fn.sql` |
| Batch call (stage 3b) | `scripts/aggregate_pitch_log_dimensions.ts` — calls the fn after all aggregations |
| Row type | `src/savant/hooks/usePitchLogTotals.ts` (`PitchLogHitterTotalsRow` +6 fields) |
| Display | `src/savant/components/PitchLogSection.tsx` — `HitterValueCluster` / `ValueChip` / `zToPercentile`; `PageShell.topRight`; gated in `HitterPitchLog` |

## Landmines / non-obvious things learned
- **The season-stats aggregation (stage 3b, `aggregate_pitch_log_dimensions.ts`) is a HAND-RUN script,
  NOT an edge function.** The "Track B" unified on-upload edge fn that would run it is planned/UNBUILT
  (`docs/PIPELINE_pitch_log_to_projections.md` §115-118). `process-precompute-jobs` only does
  projections. So the run values auto-update whenever the aggregation is re-run; **when Track B absorbs
  stage 3b, it MUST also call `populate_hitter_run_values(season)`** — documented in the PIPELINE doc.
- `batter_id` in `pitch_log_hitter_totals` **is the `source_player_id`** (text) — join the DRS/wSB
  tables on `source_player_id`, not the players UUID.
- The fn must run **after** the aggregation (batting_rv reads the fresh `all`-row counts).
- z is stored; the display maps z→percentile via the **normal CDF** (pure fn, no population query) then
  reuses `percentileColor`. DRS has fat tails (z up to ~14) — the CDF clamps to 0–100 so color is fine.
- `batting_rv` mirrors `HitterStatsLine`'s exact OBP/SLG (uses `sac` in the OBP denominator) so the
  stored value is consistent with the displayed slash line. Verified: Souza wRC+ 93.5 → batting_rv −6.75
  (manual == stored); defensive_rv −1.99 == drs_floor; baserunning_rv 1.16 == wsb_runs.

## Staging verification (2026-08-26)
- Migration + fn applied; `populate_hitter_run_values(2026)` filled the `all` rows.
- Coverage (of 6,099 `all` rows): batting 6,053 / defensive 5,138 / baserunning 5,346.
- z sanity: batting mean −0.03, sd 0.93 (subsample); tsc clean on edited files; aggregate dry-run OK.
- **Display load-verify still pending** on the Vercel preview (Trevor can't open local UI).
