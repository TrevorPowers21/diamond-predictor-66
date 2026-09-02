# Internals Collapse — Handoff (power ratings → ONE source)

**Owner decision (Trevor, 2026-08-11):** collapse per-player power ratings to a **single source (the Masters)** and
retire `player_prediction_internals` as a power-rating store. Do it right, staged. This precedes the Step-6
re-precompute of the WAR redesign ([[project_war_system_redesign]] / `docs/WAR_HANDOFF.md`).

> **One-line problem:** power ratings are duplicated into `player_prediction_internals` at prediction-creation time.
> The projection readers read the *copy*, not the Master. The copy is a **June-8 stale snapshot**, so a perfect
> Master re-store does NOT flow into projections until internals is refreshed. That is the Step-6 staleness class.

---

## 0. The two stages (why this exists at all)

| Stage | What | Writes to | Direction |
|---|---|---|---|
| **Master import** (Hitter/Pitching Master CSV, pitch log) | store **actuals** + computed power ratings (`+`-stats) | **Hitter/Pitching Master** | descriptive ("what happened") |
| **Projection** (`backfill-2027` returners, `process-precompute-jobs` transfers) | read Master ratings → **project next season** | **`player_predictions`** | forward ("what we expect") |

The Master is the **source**; the projection scripts are the **consumers**. The bug: consumers read power ratings
out of `player_prediction_internals` (a copy) instead of the Master (the source).

---

## 1. Facts locked (pre-flight — do NOT re-litigate)

**Column mapping** (internals → Master), confirmed at the writer `createPredictionsFromMaster.ts:350`:

| internals column | Hitter Master column |
|---|---|
| `avg_power_rating` | `ba_power_rating` |
| `obp_power_rating` | `obp_power_rating` |
| `slg_power_rating` | `iso_power_rating`  ← name change (slg copy IS the ISO-plus) |

Pitcher (internals → Pitching Master): `era/fip/whip/k9/bb9/hr9_power_rating` → `*_pr_plus`.

- **Join key:** `source_player_id` + `Season = CURRENT_SEASON (2026)`. Proven because
  `createPredictionsFromMaster` reads Master at `dataSeason = CURRENT_SEASON` (:26,32) — internals holds 2026 ratings.
- **The display layer already reads Master ratings** (`useSavantHitters.ts:43` selects `ba/obp/iso_power_rating`
  off the Master by `source_player_id, Season`). So the Master is the *proven* source; only the projection readers detour.
- **Preserve two transforms on every repoint** (don't drop them):
  1. `readSpecificPlus` scrub — `n > 0 ? n : null` (zero/negative → null). `predictionEngine.ts:251`.
  2. `MANUAL_INTERNAL_OVERRIDES` fallback (one player `ff4b0520…`, not on staging).
- **12 internals-only players** (written by the `import-internal-ratings` CSV edge fn, never on any Master):
  they **null on collapse** — Trevor chose (B) let-null, investigate later. Kozeal is an **orphan duplicate**
  `players` record (`source_id 1360340511`), not a data-loss case. Log both as follow-ups.

---

## 2. Usage audit verdict (2026-08-11) — which internals readers are LIVE vs DEAD

Full evidence in agent report; summary:

| # | Site | Verdict | Action |
|---|---|---|---|
| 1 | `recalculatePredictionById` (predictionEngine.ts:1062/1176; writes 1126/1160) | **DEAD** — every caller detached (ReturningPlayers controls never rendered; PlayerProfile dev-agg preview-only; TB recalc never invoked; PitcherProfile dead import) | neuter read (Phase 2) |
| 2 | `bulkRecalculatePredictionsLocal` (predictionEngine.ts:1337) | **LIVE** — AdminDashboard button + `import`/`recompute-stuff`/`import-juco` npm pipelines | **RETIRE STAGED** (Track B) — do NOT repoint |
| 3 | `backfill-2027-hitter-returners.ts:188` (`npm run precompute-returner-hitters`) | **LIVE** — canonical returner precompute (dormant since June, but the live path) | **REPOINT to Master** (Phase 1) |
| 4 | `CompareTab.tsx:126/140` | **DEAD** — mounts only in a `hidden` tab with no trigger; never mounts | neuter read (Phase 2) |
| 5 | `useTeamBuilderSimulation.ts:584` | **DEAD** — `simulateTransferProjection` is `void`ed in both consumers (stored-first) | neuter read (Phase 2) |
| 6 | `process-precompute-jobs` edge fn:1106 | **LIVE** — canonical transfer worker | **REPOINT to Master** (Phase 1) |

**Writers of internals:** `createPredictionsFromMaster.ts:395-396` (returner build) and
`import-internal-ratings/index.ts:187-188` (CSV edge fn — the 12 orphans). Both retire in Track B before DROP.

---

## STATUS (2026-08-12) — Phase 1 DONE + verified airtight on staging

- **Backfill returners** (`backfill-2027-hitter-returners.ts`): repointed internals→Master `ba/obp/iso_power_rating`
  by `source_player_id @ CURRENT_SEASON`, preserving the `readSpecificPlus` scrub. **A/B airtight:** OLD2 (warm
  internals) vs NEW (Master) = **0 diffs / 8,236 rows**; NEW vs NEW2 = 0 (deterministic). The original 49-row
  OLD-vs-NEW diff was a **first-run cold-cache artifact** (that run created 7,951 rows) — i.e. the exact staleness
  the collapse removes. JUCO (2,897 in the test set) correctly routed via `projectJucoReturner` (never the D1 eqn).
- **Step-1 internals WRITE stripped** from `createPredictionsFromMaster.ts` (map + 3 populate sites + UPSERT removed).
  Verified: no upsert fires; stripped-code determinism NEW3b vs NEW3 = 0; no tsc errors.
- **Edge fn transfers** (`process-precompute-jobs`): repointed internals→Master `ba/obp/iso_power_rating` by
  `source_player_id @ CURRENT_SEASON`, added `scrubPR` (0/neg→null, matches backfill). **Dead `seedPower`
  live-compute deleted** (its only caller never passed it); `computeHitterPowerRatings` now dead (marked, removed in
  Track B). Deploy + transfer A/B rides the Step-6 edge deploy (transfers not run yet).
- **Investigation finding (no store bug):** the 981 Master rows with null PR = 829 JUCO (excluded by design) + 152
  D1 without tracking inputs (correct null). Fed the [[project_division_table_separation]] proposal.

**DEAD-CODE SWEEPS A+B DONE (2026-08-12, committed `3a0f428` / `54cdb10` / `cecedee`):**
- Sweep A — deleted superseded `CompareTab.tsx` (old dead code; the REAL compare is the routed, stored-first
  `PlayerComparison.tsx` at `/dashboard/compare`, reads `player_predictions` directly) + the orphaned `PlayerProfile`
  internals query.
- Sweep B — deleted `recalculatePredictionById` + `fetchPitcherContext` (retired interactive recompute path; all
  callers detached) and cleared the `TB-sim` internals read (fed the void'd `simulateTransferProjection`). KEPT the
  shared `recalcReturner/recalcTransfer/recalcPitcher` (live via backfill + retire-staged bulkRecalc).
- Each verified: 0 refs to the deleted fns; tsc error count == baseline (no new errors); 247 tests pass.

**COMPLETE re-audit finding:** the original 6-site audit was PARTIAL. Full surface catalogued in
`docs/WAR_COLLAPSE_NEXT_STEPS.md §1`; the broader audit found the site list but OVER-CALLED reachability (flagged
detached interactive paths as live — re-verified each by tracing to rendered JSX). Live-reader miss it caught:
`precompute-transfer-projections.ts` (npm `precompute-transfers`, JUCO/legacy-D1 batch) — now repointed (`584dd4c`).

**ONLY remaining internals references (Track B, before DROP):** `bulkRecalculatePredictionsLocal` (predictionEngine,
retire-staged read+write) + `import-internal-ratings` CSV writer. Retire those, then
`DROP TABLE player_prediction_internals` + regen types. Table sits inert until then — nothing coach-facing touches it.

## 3. The plan (phased)

### PHASE 1 — Repoint the two LIVE projection writers to the Master  *(DONE 2026-08-12)*
- **1a. `backfill-2027-hitter-returners.ts`** — step-2 `recalcReturner` reads power ratings from the internals map
  (`:188`). Replace with a **Hitter Master** fetch by `source_player_id @ 2026` → build `powerContext` from
  `ba/obp/iso_power_rating` (mapped per §1), preserving `readSpecificPlus` + overrides. Step-1
  `createPredictionsFromMaster` may keep writing internals for now (harmless; bulkRecalc still reads it until Track B).
- **1b. edge fn `process-precompute-jobs:1106`** — transfers already recompute ratings from the Master via
  `computeAndStoreScores` (transfers carry NO internals — all internals are returner/regular/global). The `:1106`
  internals read is a **returner-seed fallback** that is mostly empty. **VERIFY** the transfer path is Master-fed
  (expected yes); repoint or remove the returner-seed fallback to read Master by `source_player_id @ 2026`.
  Edge fn already loads players with `source_player_id` at `:1058`.

> After Phase 1, Step 6 (returner backfill + transfer edge) reads **fresh Master ratings** — the staleness class is gone.
> The internals TABLE still exists (bulkRecalc + writers reference it); that is fine and intended.

### PHASE 2 — Neuter the DEAD internals reads  *(0-confusion cleanup, no behavior change)*
Point sites 1/4/5 at the Master (or null — they render nothing) so **nothing live references the copy**:
- `recalculatePredictionById` (1062/1176) — dead fn; make its internals read read Master (or delete the fn; all
  callers detached). Lowest-risk: repoint the read for consistency, leave the fn.
- `CompareTab.tsx:126/140` — dead tab; repoint or delete the query.
- `useTeamBuilderSimulation.ts:584` — `void`ed sim; repoint or delete the read.
- These are **not** Step-6 blockers (nothing coach-facing hits them); they exist so the table can be DROPPed later.

### PHASE 3 — Retire writers + DROP  *(Track B, when bulkRecalc dies)*
- Retire `bulkRecalculatePredictionsLocal` (site 2) as part of Track B (the on-upload edge fn replaces the
  button + CSV-import cascade). Its internals read (`:1337`) dies with it. **Do NOT repoint it now** — polishing a
  path we're deleting.
- Retire the internals **writers**: `createPredictionsFromMaster.ts:395-396` (stop building internals) and
  decommission `import-internal-ratings` edge fn (source of the 12 orphans; rebuild clean with a real table + import
  fn if re-added — Trevor: "rebuild with usable tables").
- Regenerate Supabase types, then **`DROP TABLE player_prediction_internals`** as a separate, explicitly-confirmed step.

### Sequencing rule
Phase 1 = the only thing Step 6 needs. Phases 2–3 are cleanup that follow the
**"fix right → take the process → clean up the how"** principle ([[project_unified_projection_edge_function]]):
don't clean the "how" before the process (Track B) is formalized. The table DROP waits for Track B because
`bulkRecalc` legitimately still reads internals until then.

---

## 4. Step-6 execution (after Phase 1 lands on staging)
- Deploy edge fn (`process-precompute-jobs`) — carries the refit composites + 1.62 replacement + Master repoint.
- Re-precompute: `npm run precompute-returner-hitters` (returners) + fire the edge fn for D1 transfers.
- Do **NOT** run `populate-conf-stats`. **Ignore JUCO** (separate project).
- Verify in-DB (Trevor can't open UI): returner + transfer projections now reflect the refit ratings & 1.62 floor.

## 5. Follow-ups to log
- **Kozeal** orphan duplicate `players` record (`source_id 1360340511`) — reconcile/merge.
- The **12 internals-only players** null on collapse — investigate (were CSV-imported straight to internals,
  never onto a Master; decide whether they belong on the Master or are retired).

**Related:** `docs/WAR_HANDOFF.md`, `docs/POWER_RATINGS_SYNOPSIS.md`, memory
[[project_unified_projection_edge_function]], [[project_power_rating_refits_2026_08_11]], [[project_war_system_redesign]].
