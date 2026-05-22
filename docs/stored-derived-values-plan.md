# Plan: Stored Derived Values + Pure-Read Architecture

**Created:** 2026-05-21 EOD
**Why:** PitcherProfile and Dashboard show different numbers for the same pitcher in no-impersonation mode (e.g. Rossow 2.13 vs 2.15 ERA). Root cause: PitcherProfile live-recomputes while Dashboard reads from stored `player_predictions` row. Live recompute drifts from stored as inputs evolve (equation weight changes, PR+ refreshes, etc.).

## End-State Architecture (the rule)

**Every derived player value displayed in the UI is a pure read from `player_predictions`. Zero live recompute. Zero fallback paths.**

Read precedence (every surface):
- **Impersonating a customer team** → row where `customer_team_id = <effectiveTeamId>` AND `variant = 'precomputed'` AND `model_type = 'transfer'`
- **No impersonation** → row where `customer_team_id IS NULL` AND `variant = 'regular'` AND `model_type = 'returner'`

If no stored row exists → display "—" (null). Never fall back to live compute. Missing data is data; surfacing it tells us the precompute pipeline didn't cover this player and we fix the pipeline.

Recompute trigger: any input change (Pitching/Hitter Master stat update, PR+ refresh, Conference Stats, Park Factors, equation weights, customer team change) fires precompute jobs via the existing auto-fire DB trigger infrastructure.

---

## Phase 1 — Schema migration

**File:** `supabase/migrations/20260522XXXXXX_add_derived_columns_to_player_predictions.sql`

Add columns to `player_predictions`:
- `p_war` numeric — pitcher WAR (derived from pRV+, projected IP, role)
- `o_war` numeric — hitter WAR (derived from pWRC+, PA estimate) ← MAY ALREADY EXIST, verify first
- `market_value` numeric — dollar value (derived from p_war / o_war, conference tier multiplier, position-value multiplier)
- `projected_ip` numeric — pitcher IP estimate used for pWAR calc
- `projected_pa` numeric — hitter PA estimate used for oWAR calc

Migration must be idempotent (`ADD COLUMN IF NOT EXISTS`).

**Verify before migration:** check what's already in `player_predictions`:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='player_predictions' ORDER BY ordinal_position;
```

---

## Phase 2 — Math consolidation (single source of truth)

Currently the pWAR + market_value formulas live in **multiple places**:
- `src/lib/pitcherProjection.ts` — PitcherProfile live compute
- `src/lib/transferPitcherProjection.ts` — TB/TP transfer math
- `src/lib/buildTransferPitcherInputs.ts` — shared builder (just created)
- `supabase/functions/process-precompute-jobs/index.ts` — Edge Function (hitter only currently)
- `src/savant/lib/war.ts` — Savant WAR (likely already consolidated)

**Action:** confirm `src/savant/lib/war.ts` is canonical. Make every other site import from there. No duplicate formulas anywhere. Same for market_value (`canShowPitchingMarketValue`, `getPitchingPvfForRole`, `getProgramTierMultiplierByConference`).

If formulas vary by intent (e.g., transfer pWAR uses adjusted IP estimate, returner pWAR uses last-season IP), document it explicitly in a single file and have all call sites use it.

---

## Phase 3 — Write-path updates

### 3a. Transfer precompute (pitcher)

**File:** `scripts/precompute-pitchers.ts` (lines ~430-470 where row is built)

Add to the UPSERT row:
```typescript
p_war: result.p_war,                  // already returned from computeTransferPitcherProjection
market_value: result.market_value,    // already returned
projected_ip: result.projected_ip,    // need to add to lib return shape
```

`src/lib/transferPitcherProjection.ts` already returns `p_war` and `market_value` so the math is there. Just need to wire to the row.

### 3b. Returner pipeline (pitcher)

**File:** `src/lib/createPredictionsFromMaster.ts` (where pitcher returner rows are inserted, find lines that insert model_type='returner' for pitchers)

Currently writes the returner row with stats only. Needs to also compute + write p_war + market_value using the same canonical formula from Phase 2.

This is the bigger lift — `createPredictionsFromMaster` may not currently compute pitcher rates at all for returner rows; the live PitcherProfile compute path is what produces them today. If the script is computing them: extend to also store pWar + market_value. If the script ISN'T producing pitcher returner rows: need to add a pitcher-returner-projection function and call it.

**Verify first:** check what `player_predictions` rows exist for pitchers without a customer_team:
```sql
SELECT model_type, variant, count(*),
       count(p_era) AS with_era, count(p_war) AS with_war, count(market_value) AS with_mv
FROM player_predictions
WHERE customer_team_id IS NULL
GROUP BY model_type, variant;
```

### 3c. Transfer precompute (hitter)

**File:** `scripts/precompute-transfer-projections.ts`

If `o_war` + `market_value` not already stored: same change as 3a. Most likely already stored or partially.

### 3d. Returner pipeline (hitter)

**File:** `src/lib/createPredictionsFromMaster.ts` hitter branch

Same as 3b: ensure o_war + market_value land in the stored row.

### 3e. Edge Function (process-precompute-jobs)

**File:** `supabase/functions/process-precompute-jobs/index.ts`

Mirror script changes — when computing transfer projections, also compute + write p_war + market_value (pitcher branch when we add it; hitter branch update if 3c needed).

---

## Phase 4 — Read-path cleanup (the actual user-visible fix)

### 4a. PitcherProfile.tsx

**Current state:** partial fix shipped in c1af893 — reads stored when present, falls back to live recompute when null.

**Target state:** no fallback. Pure stored read. If stored is missing, display "—".

Replace the `projectedPitching` useMemo body (lines ~1157-1380) with:

```typescript
const projectedPitching = useMemo(() => {
  const storedTeamRow = effectiveTeamId
    ? (predictions as any[]).find((p) => p.customer_team_id === effectiveTeamId && p.variant === "precomputed")
    : null;
  const storedReturnerRow = (predictions as any[]).find((p) => p.model_type === "returner" && p.variant === "regular" && p.customer_team_id == null);
  const stored = storedTeamRow ?? storedReturnerRow;
  if (!stored) {
    return { pEra: null, pFip: null, pWhip: null, pK9: null, pBb9: null, pHr9: null, pRvPlus: null, pWar: null, marketValue: null, projectedIp: null };
  }
  return {
    pEra: stored.p_era ?? null,
    pFip: stored.p_fip ?? null,
    pWhip: stored.p_whip ?? null,
    pK9: stored.p_k9 ?? null,
    pBb9: stored.p_bb9 ?? null,
    pHr9: stored.p_hr9 ?? null,
    pRvPlus: stored.p_rv_plus ?? null,
    pWar: stored.p_war ?? null,
    marketValue: stored.market_value ?? null,
    projectedIp: stored.projected_ip ?? null,
  };
}, [predictions, effectiveTeamId]);
```

**Delete the cache** (`cachedProjectionRef`) — stored row IS the cache. **Delete the dead live-compute code** at lines 1157-1308 (powerAdj, blended, rate computations) — entirely unused after this change.

### 4b. PlayerProfile.tsx (hitter)

Check whether the hitter projection display does the same partial-fallback pattern. Apply same no-fallback rule.

### 4c. Dashboard.tsx

Verify Dashboard already pure-reads from `player_predictions` and uses `dedupePreferredPerPlayer` with the same precedence rule as 4a/4b. If row selection differs from profile, normalize to a single shared helper.

### 4d. TransferPortal + TeamBuilder

These already compute live for the simulator UI (intentional — coach changes class transition / dev aggressiveness on the fly). Question: should TB/TP ALSO read stored when no overrides are active, and only live-compute when coach interacts? Probably yes for consistency, but defer until the rest lands.

### 4e. All other surfaces

Audit grep for any read of pitcher/hitter projected rates:
```bash
grep -rn "p_era\|p_fip\|p_whip\|p_k9\|p_bb9\|p_hr9\|p_war\|market_value\|p_wrc_plus\|o_war\|p_avg\|p_obp\|p_slg" src/pages/ src/components/ src/savant/
```

Each hit needs to either (a) read from stored or (b) be the simulator overlay where live compute is intentional.

---

## Phase 5 — Auto-fire triggers (already partially built)

**Existing:** `supabase/migrations/20260521130000_customer_teams_autofire_trigger.sql` fires on customer_team INSERT.

**Add triggers for input changes:**

1. **Hitter Master / Pitching Master row update** → fire precompute for ALL customer_teams (the player's stats changed → all team-scoped projections need refresh)
2. **pitching_power_ratings_storage update** → same
3. **Conference Stats update** → fire precompute for all customer_teams (env+ changed)
4. **Park Factors update** → fire precompute for all customer_teams whose destination is that team (narrower scope)
5. **equation_weights / customer_team_equation_overrides update** → fire precompute for affected customer_teams

Each trigger inserts a `precompute_jobs` row, Edge Function processes them.

**Concern:** if Trevor updates all 7000 pitcher rows in one transaction, you don't want 7000 jobs queued. Debounce: trigger function checks if a pending/running job for the same (customer_team, scope) exists; if yes, skip.

---

## Phase 6 — Verification gates

After Phase 1-5 ship:

1. **Row coverage check** — for every (player_id, customer_team_id) pair displayed in the UI, a `player_predictions` row exists. If not, surface the gap.
2. **Profile = Dashboard** — pick 5 random pitchers + 5 random hitters, confirm header on profile matches the cell in dashboard leaderboard (no impersonation), then again impersonating Georgia / Arkansas / Penn State.
3. **No live-compute** — `grep` for `projectPitchingRate`, `computeTransferProjection`, etc. in display-path files. Only acceptable hits: TB/TP simulator overlay + the precompute scripts themselves.
4. **Auto-fire latency** — modify a Conference Stats row, confirm precompute job fires within ~5 sec and player_predictions rows update within ~60 sec.

---

## Known concerns / open questions

1. **Stuff+ / wRC+ recompute cascading** — if Stuff+ engine changes, conference Stuff+ shifts → HTP shifts → every pitcher transfer projection shifts. The auto-fire chain needs to handle multi-step recomputes correctly.

2. **Returner pitcher projection origin** — `PitcherProfile.projectedPitching` (live) currently produces values that get written via the "Save" button (line 1118 area calls `updatePrediction.mutate(returnerPreds.map(...))`). After Phase 4a removes live compute, the Save button breaks. Need to either: (a) remove the Save button, or (b) compute via the same canonical formula from Phase 2 in a one-shot way.

3. **Risk / Scouting / NIL downstream** — many derived values consume `projectedPitching` (risk engine, scouting report generator, NIL). If we replace live compute with stored read, those downstream calculations either need stored inputs or their own precompute step. Worth tracing before Phase 4a ships.

4. **Class transition / dev aggressiveness overrides** — currently a coach can override class transition and dev aggressiveness on PitcherProfile and the live compute re-runs. After Phase 4a, those overrides need to either: (a) trigger a precompute write, or (b) overlay on top of the stored values at display time (small live recompute is acceptable here since it's coach-driven).

5. **`p_war` and `o_war` formula audit** — there are multiple wRC+ → oWAR formulas floating in the codebase. Confirm `src/savant/lib/war.ts` is canonical and TB/TP/Dashboard/Profile all use the same one.

6. **`market_value` formula stability** — depends on dollar-per-WAR constant, conference tier multipliers, position-value multipliers. All of these change over time. Precompute regeneration cadence matters.

---

## Suggested execution order (when picking back up)

1. **Phase 6 verification first** — pick Rossow + 5 others, document exact current state per surface. Establishes the ground truth we're fixing toward.
2. **Phase 1** — migration (safe, additive).
3. **Phase 2** — math consolidation audit. Don't change anything yet, just map.
4. **Phase 3b first** (returner pipeline pitcher) — this is the gap that produces the no-impersonation mismatch. Without this, Phase 4a's profile read has no source.
5. **Phase 4a** — pure-stored profile read. Test against Rossow. Profile == Dashboard.
6. **Phase 3a** (transfer precompute pWar/market_value) — already partially in place via script, just needs the row columns added in.
7. **Phase 4b-4e** — clean up other surfaces.
8. **Phase 5** — auto-fire triggers for input change.

**Today's state:**
- PitcherProfile (commit c1af893 on staging) has partial fix — reads stored, falls back to live. Better than before but not complete. User saw profile/dashboard still differing on local — may need page reload, or may indicate Phase 3b is needed first (no returner row for the pitcher being viewed → fell back to live → diverged).
- Pitcher precompute script ships transfer/precomputed rows for impersonation. Returner rows haven't been refreshed in the new pattern.

**Risk if shipping piecemeal:** if Phase 4a ships before 3b, every no-impersonation pitcher view shows "—" because no returner row has the new columns populated. Phase 3b is the unlock.
