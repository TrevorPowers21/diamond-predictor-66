# Inferred Bat Speed & Squared-Up — Operation Runbook

Read-only against `pitch_log`, additive output table, staging-verified before prod.
Mirrors the established pitch-log aggregation process (`INSERT…SELECT` via `exec_sql`,
staging on `.env.local` → prod on `.env.production.local`).

## Deliverable
Per hitter-season table `hitter_bat_speed_season` keyed `(batter_id, season)`:
`bat_speed_floor` (p95), `bat_speed_ceiling` (p99), `runway`, `squared_up_rate`,
`avg_squared_up_pct`, `qualified_bip`, `confidence` (A≥120 / B≥60 / C≥30 BIP).
Layer 1 (per-event view) is deferred. Pooled multi-season table deferred (one season only).

## Method (locked)
```
implied_bat_speed = (exit_velocity - 0.242 * release_velocity) / 1.242   -- per batted ball
floor   = p95(implied_bat_speed)   ceiling = p99(implied_bat_speed)   runway = ceiling - floor
squared_up_pct  = exit_velocity / (1.242 * ceiling + 0.242 * release_velocity)
squared_up_rate = mean(squared_up_pct >= 0.90) * 100
```
Constants: q=0.242, T=0.90.

## Outlier protection — order is load-bearing
1. Plausibility bounds — EV∈[30,125], release velo∈[55,105].
2. Chop-misread — drop EV≥118 AND launch_angle<−10.
3. Tail fence per hitter-season — drop EV > p95(EV)+8, **computed before the percentiles**.

If the fence CTE collapses into the aggregation, protection silently disappears and numbers
drift with no error. The `fence` CTE in the build SQL runs before `agg` — do not reorder.

## Source / destination (resolved on staging S0)
- Source: `public.pitch_log` — `exit_velocity`, `release_velocity`, `launch_angle`,
  `batter_id` (text = source_player_id), `season` (int), `is_batted_ball_in_play` (bool).
  **`is_batted_ball_in_play = true` is required.** One season present: 2026.
- Destination: `public.hitter_bat_speed_season` (standalone, additive). Sits beside the
  pull-air store `pitch_log_hitter_totals` but is not coupled to it (that table is keyed
  `(batter_id, season, dimension_key)` with split rows).

## Reproduction gate (batter_id = source_player_id)
| Hitter | batter_id | floor | ceiling |
|---|---|---|---|
| Daniel Jackson (Georgia) | 1493011308 | 71.2 | 72.4 |
| Roch Cholowsky (UCLA) | 1330771712 | 71.4 | 73.0 |
| Derek Curiel (LSU) | 1119106753 | 68.9 | 71.8 |
| Caden Bogenpohl (Missouri St) | 1167235840 | 75.2 | 77.5 |
| Tre Phelps (Georgia) | 1297607680 | 68.2 | 70.8 |

Pass = all five reproduce floor+ceiling within rounding. Any drift ⇒ column mapping or
fence order is off — fix on staging, never prod.

## Steps

### S0 — schema lock (DONE, read-only)
Column names, types, one-season confirmation, and the five batter_ids all resolved.

### S1 — SQL written (DONE, no DB)
`supabase/queries/hitter_bat_speed_build.sql` — idempotent CREATE + TRUNCATE + INSERT…SELECT.

### S2/S3 — staging build + validation
```
npx tsx --env-file-if-exists=.env.local scripts/_run_sql_file.ts supabase/queries/hitter_bat_speed_build.sql
```
Then read back (client returns rows; `exec_sql` does not):
- Reproduction gate — the five hitters above.
- Population sanity — count of rows, confidence-tier histogram, floor/ceiling min/median/max.
- Fence proof — pick hitters with the highest raw `max_ev` (from `pitch_log_hitter_totals`)
  and confirm their stored ceiling is sane, not dragged up by a phantom EV.

### S4 — hold
No display wiring yet; that's a follow-up once numbers are blessed.

### S5/S6 — prod, only on go
Run the identical `supabase/queries/hitter_bat_speed_build.sql` against prod via
`.env.production.local` (same `exec_sql` path the pitch-log aggregations used), or paste it
into the prod SQL editor. Re-run the reproduction gate on prod. Idempotent (truncate+reload).

## Rollback
`DROP TABLE public.hitter_bat_speed_season;` — additive, no raw-log mutation.
