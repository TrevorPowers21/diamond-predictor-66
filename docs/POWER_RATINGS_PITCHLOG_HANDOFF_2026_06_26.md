# Power Ratings → Pitch Log Source — Handoff

**Date:** 2026-06-26
**Branch:** feature branch (pitch log / power ratings work) — NOT merged yet (waiting on hitter side too)
**Status:** Pitcher side done + verified on **staging**. Hitter side TODO. Prod untouched. Stored projections untouched.

---

## The goal (Trevor's framing)
- **pitch_log is the primary source; 2026 Pitching Master is the cross-check.** Read pitch_log first, Master as per-metric fallback / accuracy check.
- The display fix (now) is preview only. **The prize is July:** when we re-run the power ratings that *build the stored projections*, they source from pitch_log and come out accurate.
- **Do not merge until BOTH hitters and pitchers are done.**

---

## What changed (code, on the branch)

| File | Change |
|---|---|
| `src/pages/PitcherProfile.tsx` | Internal Power Ratings `metrics` read **pitch_log first** (2026 `all` dim), Master per-metric fallback. Added `pitchLogTotalsRow` query + `pitchLogMetrics` memo. Fixed hardcoded "2025 Input Metrics" label → real season + "· pitch log" tag. |
| `src/components/PitchingPowerRatingsStorageTable.tsx` | Admin grid **auto-loads from pitch_log** on mount (2026) + "Load from Pitch Log" button. Pull% uses **directional pull%** (matches HM `HPull%` scale), not pull-air. Dropped qualified floor to ≥1 pitch. |
| `src/savant/components/BaseballField.tsx` | `COL_BOUNDS` → `[-45,-30,-15,15,30,45]` (matches stored `hit_location` cutoffs). |
| `src/savant/hooks/usePitchLogTotals.ts` | Added new column fields to pitcher + hitter totals row types. |
| `scripts/aggregate_pitch_log_dimensions.ts` | Counts per-row labels (sections + pull/center/oppo + pull-air) + `percentile_cont(0.9)` EV90, both tables. |
| `scripts/derive_pitch_log_flags.ts` | Derives `hit_location` + `batted_direction` per row on ingest (future CSVs auto-label). |
| `supabase/migrations/20260627000000_pitch_log_pull_air_la_ev90.sql` | Adds `hit_location`/`batted_direction` to pitch_log + section/direction/pull-air/EV90/LA10-30 columns to both totals tables. |
| `scripts/sql/derive_pitch_log_spray_labels.sql` | One-time backfill UPDATE for existing rows. |

### Per-row label definitions (locked)
- `hit_location`: far_left (-45..-30), left_center (-30..-15), center (-15..15), right_center (15..30), far_right (30..45)
- `batted_direction`: pull / center / oppo, center band ±15 (matches HM HPull%), RHB pulls left / LHB pulls right, resolved per-row by `batter_hand` (switch hitters exact)

### Calibration to nail later
- **Pull% = directional pull% = `batted_pull / (pull+center+oppo)`** (~33-44%), to match HM `HPull%` baseline (36.5). NOT pull-air (~16%). Cross-check exact denominator vs HM.

---

## PROD RUNBOOK — display layer (run when ready to make prod's *display* match staging)

**Precondition:** prod must already have the full base pitch_log pipeline (ingest 2.57M → flags → reclassify → Stuff+ → base aggregations). If not, run `docs/PITCH_LOG_PROD_RUNBOOK.md` first. (VERIFY prod's pitch_log state before starting.)

1. **Apply migration** `20260627000000_pitch_log_pull_air_la_ev90.sql` in the prod SQL editor (additive, instant).
2. **Backfill the per-row labels** — DO NOT paste the big UPDATE in the SQL editor (gateway cancels it). Use the **batched exec_sql script** pointed at prod (the proven path):
   - `scripts/_backfill_spray_labels.ts` (PK-paged, `UPDATE … FROM (VALUES …)` per 1000 via `exec_sql`, retries). Run with `--env-file-if-exists=.env.production.local`.
   - Idempotent (`hit_location IS NULL` skip). ~2.5M rows scanned by PK; only batted balls labeled.
3. **Re-aggregate** all dimensions: `npm run aggregate-pitch-log-dimensions:prod -- --apply`.
   - ⚠ Re-derive the `vs_top_hitters` p75 cutoff on prod first (per existing runbook).
   - ⚠ `vs_top_hitters` will hit the 125s gateway "timeout" — **it survives server-side** (confirmed on staging). Either let it finish (don't kill it) or run it solo via `--emit-sql` + `scripts/_run_sql_file.ts`.
4. **Verify** a qualified pitcher's `pitch_log_pitcher_totals` (dim `all`): `ev_90_allowed`, `batted_pull_allowed/center/oppo`, `batted_pull_air_allowed`, `batted_la_10_to_30_allowed` all populated.

**Note:** going forward, `derive_pitch_log_flags.ts` auto-labels new CSVs on ingest, so step 2 is one-time per existing dataset.

---

## JULY RUNBOOK — stored ratings → pitch_log (THE prize: accurate projections)

This is the part that changes the **stored** power ratings the projections use. Do it after the portal slows.

1. **Change the power-rating CALC to source from pitch_log** in the compute paths (lockstep — `feedback_precompute_math_duplication`):
   - `src/lib/createPredictionsFromMaster.ts`
   - `src/lib/predictionEngine.ts` (the `metrics` → `scores` → PR+ chain, ~line 894+ equivalent)
   - `scripts/precompute-pitchers.ts` / `precompute-returner-pitchers.ts`
   - `supabase/functions/process-precompute-jobs/index.ts` (the edge worker mirror)
   - Pattern: pitch_log 2026 sub-metrics first, Master fallback (same as the display fix).
2. **Re-run precompute** for all customer teams → `player_prediction_internals` repopulates from pitch_log → projections pick it up.
3. Why deferred: changing the calc now risks the live write triggers (CSV import, `customer_teams` auto-fire, on-demand recalc) writing pitch_log-sourced values mid-portal inconsistently.

---

## HITTER side — ✅ DONE (matches pitcher), 2026-06-26
- `src/hooks/usePitchLog2026HitterRates.ts` — now surfaces **ev90** (`ev_90`) + **directional pull%** (`batted_pull / (pull+center+oppo)`, matches HM `pull` baseline 36.5). These were the two `null`/"deferred" fields; filling them un-blanks **ISO+ → Overall+** (isoPower requires ev90Score + pullScore).
- `src/pages/PlayerProfile.tsx` — `activeSeasonScoutingGrades`: `ev90Score`, `pullScore`, and the **baPlus/obpPlus/isoPlus/overallPlus roll-ups** now read **pitch_log first** (gated `effectiveSeason === 2026` via `plPower`), stored HM fallback. Display Input Metrics cards also prefer pitch_log (`plRates`). Verified: pitcher pWAR/market path reads `projectionSourceRow.overall_power_rating` separately, so **stored values untouched** — display-only.
- **No hitter admin grid exists** (pitcher had `PitchingPowerRatingsStorageTable`; hitters don't), so nothing else to mirror.

### Still open (hitter, not blocking merge)
- Season-stats display additions (spray field viz + Pull/Center/Oppo / Pull-Air / EV90). More valuable for hitters — design pending.

---

## PITCH-ZONE STORAGE (by_zone) — 2026-06-28, in progress on staging

Foundation for a **configurable zone/field display** (user picks any metric to
color the 13-zone heatmap, toggles panels). Stores the full count-component set
**per zone** so any metric derives from one (player, dimension) read.

**13-zone definition** = `zoneForPitch` in `src/savant/components/PitchZone*.tsx`
EXACTLY: in-zone unit square → '1'..'9' (row0=top pz>1/3, col0=left px<-1/3),
outside → 'UL'/'UR'/'LL'/'LR' by sign, |px|>4 or |pz|>4 → NULL. Absolute
(catcher's view), NOT batter-relative inside/outside (Trevor: "the zone is the
zone").

**Files:**
- `supabase/migrations/20260628000000_pitch_log_by_zone.sql` — `pitch_log.pitch_zone` + `pitch_log_pitcher_by_zone` + `pitch_log_hitter_by_zone` (mirror by_pitch_type + `ev_90` + RLS)
- `scripts/derive_pitch_log_flags.ts` — `pitchZone()` added → **future ingests auto-label**
- `scripts/aggregate_pitch_log_dimensions.ts` — `pitcherByZoneSQL` + `hitterByZoneSQL`, registered tasks (GROUP BY pitch_zone, + EV90 percentile)
- `scripts/sql/derive_pitch_log_pitch_zone.sql` — one-time backfill UPDATE
- `scripts/_backfill_pitch_zone.ts` — batched PK-paged backfill (the reliable path)

**PROD steps (when ready):**
1. Apply `20260628000000_pitch_log_by_zone.sql` (additive). Can run via `exec_sql` (multi-statement OK, ~16s on staging).
2. Backfill `pitch_zone` — run `scripts/_backfill_pitch_zone.ts` against prod (batched). **Don't** paste the single UPDATE — `exec_sql` cancels big UPDATEs on disconnect (only INSERT…SELECTs survive); the batched PK-paged script is the proven path. ~2M rows.
3. Re-aggregate: `npm run aggregate-pitch-log-dimensions:prod -- --apply` (now includes the by_zone tasks; `vs_top_hitters` still needs the survive-the-timeout handling).

## Gotchas learned this session (save the pain)
- **exec_sql via RPC gets cancelled by the gateway on disconnect for SOME ops but survives for INSERT…SELECT** — the big single backfill UPDATE did NOT survive (labels stayed 0); the aggregator's INSERT…SELECT statements DO survive past the 125s gateway timeout. Use the **batched** approach for big UPDATEs.
- **Zombie lock recovery:** a stuck/killed big UPDATE holds row locks and blocks new writes (`lock timeout`). Clear with `scripts/_kill_locks.ts` (terminates pitch_log lock-holders >45s old by `pg_locks`, not by query text — the exec_sql wrapper hides the inner query).
- **`.upsert()` can't do partial-column updates** on pitch_log (`season NOT NULL`). Use `UPDATE … FROM (VALUES …)` via exec_sql (same lesson as the Stuff+ build's bulk RPC).
- Read timeouts: page by **primary key** (fast index), filter in JS — don't filter on unindexed columns over 2.5M rows.

---

## Debug scripts created (untracked `scripts/_*.ts`) — safe to delete
`_check_spray_ang, _check_switch_hand, _check_labels, _spot_dir, _poll_labels, _backfill_spray_labels, _kill_locks, _run_sql_file, _count_top, _dim_coverage, _verify_rating_inputs, _verify_view_inputs, _volantis_iz` — plus `scratchpad/agg_top/*.sql` emitted SQL.
