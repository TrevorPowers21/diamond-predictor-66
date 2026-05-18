# JUCO Exploration — Architecture Plan

**Branch:** `feature/juco-exploration`
**Status:** Scaffolding only. No production code paths touched yet.
**Last updated:** 2026-05-15

## Why this exists

D1 is the proven core. JUCO is a separate operating environment with three friction points:

1. **Inconsistent TrackMan coverage.** Some JUCO programs have units, most don't. Most JUCO pitchers will have a roster row, basic stats, and **zero Stuff+ inputs**.
2. **Different population.** JUCO velocity bands, breaking-ball shapes, and rate-stat baselines all run different from D1. Using D1 population constants on JUCO data would silently mis-calibrate every projection.
3. **Conference structure.** NJCAA D1/D2/D3 are separate divisions with their own conferences. Region-based scheduling means more inter-conference variability than D1.

The risk of just adding JUCO rows into the existing tables without separation: D1 queries silently include JUCO, D1 conference averages get polluted, Stuff+ population becomes a bimodal mess. Coaches notice 2 weeks later when projections look weird.

## Decision: shared tables + `division` column

Per [decision 2026-05-15], all data lives in the same tables (Hitter Master, Pitching Master, Conference Stats, Teams Table, players, pitcher_stuff_plus_ncaa). A `division TEXT` column distinguishes them. All existing rows default to `'D1'` so no read path breaks.

Why this over separate JUCO tables:
- One schema to maintain
- No code path duplication (queries filter by division)
- Easy to add NAIA / D2 / D3 / etc. later — just add a value, no new tables
- Cross-division queries trivial when wanted ("show me all SS regardless of division")

Trade-off: every read path needs a division filter to avoid mixing. The migration sets the column NOT NULL with default 'D1', so omitting the filter shows D1 only (safe default for existing code).

## What this migration adds

[`20260515180000_add_division_juco_scaffold.sql`](../supabase/migrations/20260515180000_add_division_juco_scaffold.sql):

- `division TEXT NOT NULL DEFAULT 'D1'` on: `Hitter Master`, `Pitching Master`, `Conference Stats`, `Teams Table`, `players`, `pitcher_stuff_plus_ncaa`
- `data_status TEXT CHECK IN ('complete','partial','no_data','outlier')` on `players`
- Indexes on `division` for all hot tables

## What's not done yet (deferred until JUCO data arrives)

### Read path filtering
Existing queries continue to return D1 only because everything defaults to `division = 'D1'`. When we start ingesting JUCO, every query that should be D1-scoped needs an explicit `.eq("division", "D1")`. Plan:
1. Audit queries on Hitter Master / Pitching Master / Conference Stats / players / pitcher_stuff_plus_ncaa.
2. Add division filter to D1-specific paths (most of the app).
3. Update Savant + RSTR IQ pages to support division-switching UI (or split into D1/JUCO routes).

### Stuff+ engine routing
The engine looks up population constants by `(pitch_type, hand, season)`. With `division` added, the lookup becomes `(pitch_type, hand, season, division)`. The engine itself doesn't change — just the fetch query in `runStuffPlusPipeline` filters by division, and the pipeline runs **once per division per season**. Most JUCO pitchers will return null/null from the engine due to missing TrackMan inputs; those get flagged `partial` in `data_status`.

### Conference Stats compute
Same pattern. Compute job filters by division → produces per-division conference rows.

### Park factors
**Deferred to v2.** JUCO data is too sparse to compute park factors reliably. For v1, JUCO transfers default to park factor 1.0. Revisit when there's enough game data per JUCO park.

### Data-status flagging logic
Need a recompute job that scans all players and writes `data_status`:
- `complete` — has stats + Stuff+ inputs + within ±3σ of population
- `partial` — has stats but missing Stuff+ inputs OR missing scouting metrics
- `no_data` — players row exists but no Hitter Master / Pitching Master row this season
- `outlier` — has data but values fall outside ±3σ (suggests bad data or genuinely unusual profile — needs review)

Likely lives in `src/lib/recomputeDataStatus.ts` mirroring the `recomputeTwpStatus` pattern. Admin button + CLI command.

### Transfer projections from JUCO
The portal sim's conference-jump math (`from_avg_plus`, `from_park_factor`, etc.) needs JUCO conference + park context. Once `Conference Stats` has JUCO rows + `Teams Table` has JUCO teams with park factors (or defaults to 1.0), the existing transfer math should work without code changes — it reads from `from_team`'s row regardless of division.

### Two-way players in JUCO
TWP detection (`is_twp` flag) is division-agnostic and works fine. JUCO has lots of TWPs.

## What ships today

Just the migration + this doc. The branch is ready to receive JUCO data:
1. Drop JUCO CSVs into `~/RSTR IQ Data/inbox` with `division=JUCO` baked into them
2. (Future) Importer detects division from CSV / filename
3. (Future) Cascade runs JUCO-scoped Stuff+, Conference Stats, etc.

## Open questions

- **JUCO conference taxonomy:** NJCAA D1 / D2 / D3 are separate, each with multiple sub-conferences. Do we use one `division = 'JUCO'` value with conference distinguishing the sub-level, OR three values (`JUCO_D1`, `JUCO_D2`, `JUCO_D3`)? Leaning toward sub-divisional values for cleaner separation.
- **CSV format for JUCO:** TruMedia exports? Trackman direct? Scraped from team sites? Different sources need different importers.
- **Source player IDs:** D1 uses TruMedia's stable `playerId`. JUCO players without TruMedia coverage need a different stable ID strategy.
- **Park factors for v1:** Default all JUCO to 1.0, or null + handle null at projection time?

## Out of scope for this branch

- D1 read-path division filtering — wait until we have real JUCO data and feel the friction
- UI for division switching — Savant + RSTR IQ pages currently assume D1
- Park factor computation for JUCO — see v2 note above
- Data-status flagging for D1 (could be useful, but unrelated to JUCO)
