# Handoff — Composite WAR + Pitch-Log Migration (post-dRS)

**Date:** 2026-08-06 · Follows the dRS ledger completion (see
`docs/AGENT_LEARNINGS_defensive_runs_engine_2026_08_03.md` for the full settled dRS state; commits
`d8c7e03`, `7d0e2c3`, `e12699e`). dRS is done: every component centered vs its own-season,
own-position/own-park baseline; telescope closes all the way down. This handoff is the FORWARD plan.

---

## 1. Composite WAR column design (LOCKED)

Store the **components separately**, combine at read — never a blended stored total. Mirrors the
market-value structure, but WAR gets to be simpler.

- `o_war` — hitter batting WAR (existing, unchanged)
- `d_war` — hitter defense WAR = Σ NON-P `drs_floor` / rpw  (NEW; hitter-context)
- `bsr_war` — hitter baserunning WAR = wSB / rpw  (NEW; hitter-context)
- `p_war` — pitcher WAR (existing, **UNCHANGED** through all of this)
- **`total_hitter_war` = o_war + d_war + bsr_war** — the HITTER line's total. Renamed FROM the old
  `total_war` to kill the "blended player total" confusion.

### Why `total_hitter_war`, and why it dissolves the TWP problem
The name is **side-specific**, so it holds the hitter line for EVERYONE including TWPs — a TWP fills
it with their *hitter* side (no blend, no `isTwpRow` NULL guard). A TWP is then naturally two clean
lines: `total_hitter_war` (hitter slot) + `p_war` (pitcher slot). Pure pitchers: `total_hitter_war`
NULL, WAR = `p_war`. Because it sums only hitter-side components (never `p_war`), it is **blend-safe
by construction** — the exact thing that made a generated `o+p+d+bsr` total dangerous is gone.

### TWP: nothing changes except the swap
There is **NO separate "TWP oWAR."** A TWP's hitter WAR is `o_war` (the shared hitter column); pitcher
side is `p_war`; both sit on the merged row. The market-value `twp_hitter/twp_pitcher` split exists
only because `market_value` is NULL for TWPs — WAR has no such split. So the `o_war → total_hitter_war`
swap is UNIFORM and covers TWP hitter slots automatically. (Rejected alternatives: generated
`total_war = o+p+d+bsr` — blends TWP sides, breaks downstream 2-profiles/2-lines/2-market-values.)

### Display swap (surgical)
Everywhere `o_war` is the hitter's **headline WAR** → show `total_hitter_war`. KEEP raw `o_war` where
it's the batting **component** of a breakdown (bat / glove / legs). NOTE: `o_war` is stored in some
paths and live-computed via `computeOWarFromWrcPlus` in others (useTeamBuilderSimulation ~:693, :1522)
— the swap must add `d_war + bsr_war` in BOTH the stored-read and live-compute paths. Helpers to add:
`pickHitterWar` (= total_hitter_war / o+d+bsr) and `pickPitcherWar` (= p_war), analogs of
`pickHitterMarketValue`/`pickPitcherMarketValue` in `src/lib/twpMarketValue.ts`.

### dWAR / bsrWAR are DESTINATION-INVARIANT (key simplification, Trevor)
Unlike oWAR — which translates into a *different* program via conference/park/stuff+ — **defense and
baserunning do not translate.** A player's glove and legs are the same wherever they go, so
**returner dWAR == "transfer to anywhere" dWAR.** Consequence: `d_war`/`bsr_war` are the SAME value on
EVERY one of a player's prediction rows (regular + every transfer destination); only `o_war` varies.
So the same `getDbsrMap` wires into the REGULAR-prediction path (`createPredictionsFromMaster` or
wherever) unchanged — no program-specific projection to build there. `total_hitter_war = o_war(row) +
d_war(const) + bsr_war(const)`.

### The tricky parts (flagged for a dedicated design pass — NOT the base case)
- **Toggle reaction rules (Trevor, refined) — d and bsr do NOT scale the same way with tier:**
  - **bsr scales with PA / opportunities** across EVERY tier (same driver as oWAR): everyday_starter →
    cornerstone = more PA = more baserunning chances = more bsrWAR. Use the existing PA-per-role table.
  - **d scales with defensive INNINGS, which are FLAT across the full-time tiers.** everyday_starter
    and cornerstone both field ~full-time → same innings → **dWAR does NOT change between them.** dWAR
    only moves when playing time actually drops (platoon / utility / bench). So the "defensive innings
    per role" table is NOT monotonic like PA — flat at the top, steps down only for part-time roles.
  - **dev aggressiveness → touches NEITHER d nor bsr** (for now; "maybe it should" for dev — parked).
  - Default (previous role, dev=0) → last year's innings + opportunities → last year's d/bsr, unchanged.
  - So a recompute = `adjusted_o_war + d_war(innings-tier) + bsr_war(PA-tier)`; the live-compute path
    (`computeOWarFromWrcPlus`) adds them, each reacting to its own tier driver.
- **Position changes (the genuinely hard one):** dWAR IS position-specific (an SS's dWAR ≠ their 2B
  dWAR), so moving a player's build position SHOULD change their dWAR. The per-position values already
  exist (`player_season_defense` has per-position rows); a position they PLAYED → use that row. A
  position they NEVER played → needs a projection (positional adjustment / range translated to the new
  spot). NOTE: the default `d_war = Σ non-P drs_floor` sums ALL positions played = the season-total
  defensive value (correct for the natural-position default), but a single-position build assignment
  wants that position's value, not the sum. This is where the storage/projection design work lives.

### Write-path map + the composite's home (Trevor, 2026-08-06)
The regular/o_war write paths look sprawling but mostly aren't:
- **`google-sheets-sync` — DEAD.** Ignore.
- **`createPredictionsFromMaster` (variant "regular") — LEGACY.** The Master export is SUPERSEDED by
  the pitch log. Master stays useful as a fallback / cross-check, but the PITCH LOG is the source of
  truth everything moves to. Do NOT invest in patching this path.
- **JUCO precompute — a SEPARATE function, MASTER-based, always different.** These D1 changes do NOT
  apply to JUCO (JUCO has no pitch-log/dRS data). JUCO needs its own test pass at some point. D1 ONLY.
- So the ONE path that matters is the **D1 pitch-log precompute** (`process-precompute-jobs`).

**COMPOSITE LIVES IN A CENTRALIZED `refresh_composite_war()` (chosen over per-generator inline).**
A D1 bulk-join UPDATE: `player_season_defense` (Σ non-P drs_floor) + `player_season_baserunning` onto
`player_predictions`, setting `d_war`/`bsr_war` (player-level, destination-invariant) and
`total_hitter_war = o+d+bsr` per row. Called after the precompute; covers BOTH regular + precomputed
D1 rows without touching the legacy master path. JUCO auto-excluded (no D1 dRS rows → d/bsr 0/null).
The ÷10 (Push 2's flip point) lives in exactly ONE place here. (The earlier per-row edit to the hitter
loop was reverted in favor of this.)

### Edge function (`supabase/functions/process-precompute-jobs/index.ts`)
- Hitter loop (~:1146–1180): compute `oWar` as today, then add to the upsert:
  `d_war`, `bsr_war` (from a league-wide `player_id → {Σ non-P drs_floor, wsb}` map loaded once), and
  `total_hitter_war = oWar + dwar + bwar` (no TWP guard).
- Pitcher loop (~:1490): `p_war` UNCHANGED. (Pure pitchers keep `total_hitter_war` NULL.)
- The ÷10 constants: line 519 `pwar_runs_per_win: 10`, line 901 oWAR `/10`, and the new d/bsr `/10`
  are the ONLY things Push 2 touches.

---

## 2. PUSH SEQUENCE (separate prod pushes, verify each before the next — Trevor)

Do NOT fold the recalibration into the data push. Prove the additions run on prod first.

1. **PUSH 1 — dRS + wSB additions + composite, at ÷10, additive. ✅ SHIPPED TO PROD (2026-08-07).**
   Prod has: `player_season_defense`/`baserunning` tables + data (CALCULATED to prod uuids via
   `load-drs-wsb-prod.ts`, NOT copied — staging/prod uuids differ); `player_predictions` +`d_war`/`bsr_war`/
   `total_hitter_war` (add-only — prod never had `total_war`); `refresh_composite_war()`; `pitch_log` widened
   with the full DRS attribution + unique key (matches staging exactly); `total_hitter_war` populated
   (identity 1000/1000); edge fn deployed (recurring refresh + UCSB build fix). Verified prod ≡ staging
   per-player (d_war 5,093/5,093, bsr 10,406/10,406 identical). oWAR/pWAR/market_value UNTOUCHED. Code on
   `main` (#169 feature→staging, #170 staging→main). Precomputes NOT re-run (that's Push 2). Full execution
   record: `AGENT_LEARNINGS_defensive_runs_engine_2026_08_03.md` "PUSH 1 SHIPPED TO PROD".
2. **PUSH 2 — 10 → 13.1 recalibration + the `o_war → total_hitter_war` display swap. PLANNED:
   `docs/PUSH2_RECALIBRATION_PLAN.md`.** Not a one-file flip: centralize the 7 copy-pasted oWAR formulas
   (+ reconcile the edge-fn vs war.ts pWAR divergence to ONE D1 set), flip the constants + `refresh_composite_war`
   `/10→/13.1`, the display swap (`pickHitterWar`/`pickPitcherWar`), re-precompute, reseed `team_war_snapshots`,
   repoint market value at total WAR. Everything rescales together (d/bsr share runs-per-win); players move once.
3. **PUSH 3 — data-source migration: big-export total lines → PITCH LOG.** Rewire the edge function +
   `powerRatings.ts` (computeHitterPowerRatings / readPitchingWeights) to compute from the pitch log
   (the `pitch_log` table already carries derived cols: stuff_plus, x_avg/x_slg/x_woba, spray_ang,
   distance, pitch_zone...). Store pitch-log-derived data/ratings. Run projections for returners +
   every user. Trevor: "we already did it, just need to rewire" — find the existing pitch-log
   derivations before rebuilding.
4. **PUSH 4 — fallbacks in TRANSFER projections** (returners ALREADY have them). Source/trigger TBD
   (big-export line? prior year? regional/positional prior? interacts with small-sample pullback).
5. **PUSH 5 — finalize 2027 projections** on the updated WARs → improved MARKET VALUES. Market value =
   f(better WAR) + POSITIONAL SCARCITY (the term exiled from dWAR to the market layer) + NIL/budget.

---

## 3. PITCH_LOG WIDEN + UNIQUE KEY + over-count cleanup (staging 2026-08-07)

**The ~3,425 over-count is REAL** (per the 2026-08-04 analysis, `project_pitch_log_dedup_cleanup`): duplicate
PHYSICAL pitches under *different* `uniq_pitch_id`s (overlapping window+residual imports) + internal junk
(e.g. game 260318618 = 658 table rows vs 269 in the clean DRS export). `UNIQUE(uniq_pitch_id)` was added and
is worth keeping, but it does NOT remove these — they have distinct (often malformed) ids, so a same-id
constraint is orthogonal. Do NOT read the constraint's success as "no dupes."

**What the widen did (staging, done):** the `pitch_log` table stored only the tracking/shape half (from the
re-export). Push 1 ADDED the attribution half (see `PITCH_LOG_COMBINED_EXPORT_SPEC.md` +
`20260806_pitch_log_widen_attribution.sql`), backfilled ADDITIVELY from `docs/drs-reference/*.DRS Pitch
Log.csv` by `uniq_pitch_id`. Result: 2,576,146 rows got attribution (99.86%); **3,509 rows left with `runs IS
NULL` ARE the over-count/junk** (absent from the clean DRS export). `UNIQUE(uniq_pitch_id)` now enforced.

**The dedup is now trivial** — the backfill flagged the over-count precisely. Approach B (rebuild clean)
reduces to **`DELETE FROM pitch_log WHERE runs IS NULL`** after the widen → the clean 2,576,146-pitch set
matching the DRS export. Matters for Push 3 (pitch_log-based aggregations would double-count); **irrelevant to
Push 1** (dRS reads the CSVs + `normalize.py` dedupes; composite reads the aggregates). PENDING Trevor's call:
run the DELETE now on staging, or defer to Push 3. Spot-check a broader sample of the un-attributed rows
(confirm all junk-like, not real pitches the DRS export missed) before deleting.

**PROD RUNBOOK (replay of the staging path — the monolithic editor UPDATE does NOT survive here):**
1. `ALTER TABLE pitch_log ADD COLUMN ...` (the attribution columns) — `20260806_pitch_log_widen_attribution.sql`.
2. `CREATE TABLE pitch_log_attr (...)` (temp landing table, `uniq_pitch_id` PK).
3. `node scripts/backfill_pitch_log_attribution.mjs --apply` — loads 2,576,230 attribution rows into the
   temp table (point `.env`/URL at PROD; ~13 min). Streams + dedups; memory-bounded.
4. Create `backfill_pitch_log_attr_batch(_after,_lim)` (function, `set statement_timeout=0`) + run
   `node scripts/drive_pitch_log_backfill.mjs` — the BATCHED server-side UPDATE, ~105 calls × 25k, ~27 min.
   **Do NOT run the join-UPDATE as one editor statement** — a >60s single statement dies on the editor's
   disconnect even with `statement_timeout=0` (it rolls back atomically; confirmed twice on staging). Batched
   calls each commit under the gateway timeout and are observable.
5. Create + call `pl_verify()` (coverage) and `pl_finish()` (dedup no-op + `ADD CONSTRAINT UNIQUE`).
6. `DROP` the temp table + all helper functions.

**dRS is UNAFFECTED by any of this** — the engine reads the CSVs and `normalize.py:65–90` dedupes on
`uniqPitchId`, so `player_season_defense`/`baserunning` (already certified 13454/13454) don't change.

---

## 4. Provenance / safety
Staging-first; `.env.local` = staging (data loads via TS scripts); paste-SQL for `player_predictions`/
app-data writes; explicit "prod, now?" before any prod write; staging→main via PR, Trevor clicks the
final merge. dRS composite already live + verified on staging `player_predictions` (÷10). Related
memory: `project_war_pitchlog_migration_master_plan`, `project_composite_war`,
`project_eager_precompute_buildout_plan`.
