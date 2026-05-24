# Stored-vs-Live Compute Audit
**Branch:** `feature/stored-vs-live-audit`  
**Date:** 2026-05-24  
**Author:** Peyton Beard (pcbeard22)

---

## Background and Directive

Trevor's standing directive: **stored `player_predictions` values come first and foremost.** The live engine (predictionEngine, pitcherProjection, transferProjection) only runs when a coach changes an interactive knob — dev aggressiveness, depth role, class transition, or position slot. For all other views, the UI should read from the precomputed row and surface "—" if no row exists. Full spec: `docs/stored-derived-values-plan.md`.

This audit reviews every UI surface and precompute script against that directive, documents what was already correct, what was wrong, and what was fixed.

---

## Precompute Pipeline Summary

Before auditing the frontend, we mapped the full precompute chain — one script per player type:

| Script (npm run …) | Writes to | Players targeted |
|---|---|---|
| `precompute-returner-hitters` | `player_predictions` (model_type=returner, variant=regular, customer_team_id=NULL) | All D1 hitters |
| `precompute-returner-pitchers` | `player_predictions` (model_type=returner, variant=regular, customer_team_id=NULL) | All D1 pitchers |
| `precompute-transfers` | `player_predictions` (model_type=transfer, variant=precomputed, customer_team_id=<team>) | Transfer targets per customer team |
| `precompute-pitchers` | `player_predictions` (model_type=transfer, variant=precomputed, customer_team_id=<team>) | Pitcher targets per customer team |

**Row selection precedence (read path):**
1. `customer_team_id = effectiveTeamId AND variant = 'precomputed'` — the team's custom projection
2. `customer_team_id IS NULL AND variant = 'regular'` — the global returner baseline

Both the `pickPreferredPrediction` function (`src/lib/teamScopedPredictions.ts`) and each profile page implement this same two-tier lookup.

---

## Findings by Surface

### 1. PitcherProfile.tsx — `projectedPitching` useMemo

**Finding: dead live-compute block (~155 lines)**

The useMemo was structured in two parts:

- **Lines 1137–1286 (dead):** Loaded PR+ from `projectionSourceRow`/`internalPowerRatings`, called `projectPitchingRate()` six times for ERA/FIP/WHIP/K9/BB9/HR9, applied class adjustments, role adjustments, computed live pRV+, pWAR, and market value. This path was never exposed — the result block below overwrote every value.

- **Lines 1293–1385 (live, correct):** Read the stored row (team precomputed → returner fallback), then applied session overlays: role transition (`applyRoleTransitionAdjustment`), dev aggressiveness delta (±6% per unit), depth role IP (`pitcherExpectedIp`), and re-derived pRV+/pWAR/market value only when the overlay changed anything. This is correct stored-first behavior.

The cached-projection ref (`cachedProjectionRef = useRef<any>(null)`) was also a live-compute artifact — it existed to prevent the projection from going null when the scouting-year dropdown changed, which only happened because the live path depended on `projectionSourceRow`. The stored row is not affected by the scouting-year dropdown, so the ref was no longer needed.

**Additional dead imports removed:**
- `projectPitchingRate` (import from `@/lib/pitcherProjection`)
- `toPitchingClassAdj` (local helper, only called from the dead block)
- `useRef` (React import — only used for `cachedProjectionRef`)

**Dep array:** 29 entries → 8 entries after removing all live-compute dependencies:

| Removed | Why |
|---|---|
| `projectedClassTransition` | Only used in live-compute path |
| `internalPowerRatings.{bb9,era,fip,hr9,k9,whip}Plus` (×6) | Fallback PR+ source for live compute |
| `latestStats?.era`, `latestStats?.whip` | Live compute inputs |
| `powerRatingsRow` | Fallback PR+ source for live compute |
| `projectionSourceRow` | Primary PR+ source for live compute |
| `storageBb9`, `storageEra`, `storageFip`, `storageHr9`, `storageK9`, `storageIp`, `storageWhip` (×7) | `lastStat` inputs for `projectPitchingRate` |
| `teamByName`, `teamParkComponents` | Were already `void`-suppressed (park factor not applied on returner path) |
| `storageProjectionOverride.{class_transition,dev_aggressiveness,pitcher_role}` | Already captured through `projectedClassTransition`, `projectedDevAggressiveness`, `projectedRole` state |

**Kept deps:** `projectedDevAggressiveness`, `depthRole`, `displayConference`, `derivedRole`, `projectedRole`, `predictions`, `effectiveTeamId`, `displayTeam`

---

### 2. PlayerProfile.tsx — hitter projected rates

**Finding: already correct**

`regularPred` is a pure two-tier lookup (team precomputed → global regular) computed inline:

```typescript
const regularPred = (() => {
  if (effectiveTeamId) {
    const teamRow = predictions.find(
      (p) => p.customer_team_id === effectiveTeamId && p.variant === "precomputed",
    );
    if (teamRow) return teamRow;
  }
  return predictions.find((p) => p.variant === "regular" && p.customer_team_id == null);
})();
```

All four projected rate stats are pure stored reads with a session dev_agg scale applied on top:

```typescript
const projectedAvg      = applyDevScale(regularPred?.p_avg);
const projectedObp      = applyDevScale(regularPred?.p_obp);
const projectedSlg      = applyDevScale(regularPred?.p_slg);
const projectedWrcPlus  = applyDevScale(regularPred?.p_wrc_plus);
```

`applyDevScale` is a session-only overlay (stored dev_agg vs session dev_agg delta). No live recompute from raw inputs.

**Minor fix applied:** Three `computeDerived()` calls were being evaluated inline on every render:

```typescript
// Before: called inline, recomputed every render
const seedDerived    = seedStatRow ? computeDerived(...) : null;
const fromDerived    = computeDerived(predFromAvg, predFromObp, predFromSlg);
const projectedDerived = computeDerived(projectedAvg, projectedObp, projectedSlg);
```

Wrapped in `useMemo` so they only recompute when their inputs change.

**`baseProjectedOWar` note:** Line 774 has a secondary fallback:

```typescript
const baseProjectedOWar = storedOWar ?? computeHitterOWar(regularPred?.p_wrc_plus ?? null, carryForwardPa, null);
```

This is not a raw-input live recompute — it derives oWAR from the stored `p_wrc_plus` when `o_war` is null (possible on older rows before the column was added). Considered acceptable.

---

### 3. Dashboard.tsx — player rankings/leaderboards

**Finding: already correct**

Dashboard reads from `player_predictions` in three separate queries (top hitters, top pitchers, WAR rankings). All three use `dedupePreferredPerPlayer(rows, effectiveTeamId)` which calls `pickPreferredPrediction` — the canonical two-tier selector in `src/lib/teamScopedPredictions.ts`. No live recompute anywhere on this surface.

---

### 4. Precompute scripts — safety guards

**Finding: inconsistent prod URL guards**

`scripts/precompute-returner-pitchers.ts` already had a prod URL guard that refused to write to production if `SUPABASE_URL` looked like prod but `--prod` was not passed (and vice versa). The same guard was **missing** from:

- `scripts/precompute-pitchers.ts`
- `scripts/precompute-transfer-projections.ts`

**Fix applied:** Added the same guard block to both scripts:

```typescript
const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").toLowerCase();
const looksLikeProd = supabaseUrl.includes("ualmkgkdnoubccoieahf")
  || supabaseUrl.includes("trbvxuoliwrfowibatkm")
  || supabaseUrl.includes("prod");
if (looksLikeProd && !isProd) {
  console.error("✗ SUPABASE_URL looks like PROD but --prod was not passed. Refusing to write.");
  process.exit(1);
}
if (isProd && !looksLikeProd) {
  console.error("✗ --prod passed but SUPABASE_URL doesn't look like prod. Refusing to write.");
  process.exit(1);
}
```

**Finding: hitter returner precompute naming confusion**

`scripts/backfill-2027-hitter-returners.ts` was named as a one-time backfill but is actually the canonical recurring precompute for hitter returners (analogous to `precompute-returner-pitchers`). The script was already correct; only naming was ambiguous.

**Fix applied:**
- Added `precompute-returner-hitters` alias to `package.json` pointing to the same script
- Updated the script's header comment to document it as the canonical recurring task

---

### 5. `p_whip_chase_pct_weight` — not fixed

**Finding:** This weight is hardcoded to `0.05` in `AdminDashboard.tsx` (lines 2489–2496). The admin UI explicitly locks this field and resets any edit the user makes. Moving it to the engine config table would require Trevor's sign-off on unlocking that control. Deferred.

---

## Tests Added

Four new test files covering the full formula stack. All run in `npm test` (~2 seconds).

### `src/savant/lib/war.test.ts` — 26 tests
Formula unit tests for the wRC+/oWAR/pWAR stack:
- `computeWrcRaw`: weighted-sum formula, null inputs, single-null
- `computeWrcPlus`: ratio to ncaaWrc, above/below average, zero ncaaWrc guard
- `computeOWar`: known values (avg hitter 100 wRC+ 600 PA → 2.5 WAR; above-avg 130/600 → 4.84 WAR), null guard, zero-PA guard
- `computeOWarFromStats`: end-to-end from AVG/OBP/SLG
- `computePWar`: avg pitcher (100 pRV+, 90 IP) → 2.5 WAR; above-avg 120/90 → 3.6 WAR; null pRV+; zero IP; role-level IP bands

### `src/lib/playerCalcs.test.ts` — 17 tests
Unit tests for `computeOWarFromWrcPlus` plus a **parity suite** that asserts `computeOWarFromWrcPlus === computeOWar` for the same inputs across 9 representative cases. If either copy drifts, the parity tests fail.

### `src/lib/pitcherProjection.test.ts` — 18 tests
- `dampFactorForProjected`: threshold boundary behavior, empty thresholds
- `projectPitchingRate`: null guards (null lastStat, null prPlus, zero prSd), ERA known values (prPlus=110 → ~3.64), K/9 known values (prPlus=115 → ~10.25), devAggressiveness direction (lower ERA / higher K9), classAdjustment effect
- Blend weight constant pin: `PITCHING_POWER_RATING_WEIGHT = 0.7`
- pWAR role-level IP bands: SP/RP/SM ranges produce expected WAR

### `src/lib/storedVsLive.test.ts` — 13 tests (2 skipped)
**Cross-site constant parity layer** — the most important file for future maintenance:
- Hitter oWAR constants: `runsPerPa = 0.13`, `runsPerWin = 10` pinned across all three implementations (war.ts, playerCalcs.ts, transferProjection.ts inline)
- `transferProjection.ts` inline oWAR formula matches `computeOWar` for 5 known inputs (average, above-average, below-average, zero PA, near-zero PA)
- wRC+ weight constants: `SAVANT_WRC_WEIGHTS` match `DEFAULT_WRC_WEIGHTS` in predictionEngine (OBP=0.45, SLG=0.30, AVG=0.15, ISO=0.10)
- `SAVANT_NCAA_WRC = 0.364` matches predictionEngine
- Pitcher blend weight: `PITCHING_POWER_RATING_WEIGHT = 0.7`, dev factor `0.06`

**Two `.skip` regression placeholders** to activate once stored-first read paths are confirmed for those surfaces:

```typescript
describe.skip("known regressions — activate as stored-first paths land", () => {
  it("Rossow ERA: PitcherProfile and Dashboard show same value", ...);
  it("TB Compare tab: transfer player projection matches target board projection", ...);
});
```

---

## Commits on This Branch

| Hash | Description |
|---|---|
| `224dad2` | `test:` stored-vs-live audit — formula unit tests + parity layer (4 files, 655 lines, 237 tests) |
| `f97843b` | `docs:` CLAUDE.md testing workflow section |
| `7793f5b` | `fix:` precompute safety guards (pitchers + transfers) + PlayerProfile useMemo wrapping |
| `5d9b94f` | `feat:` PitcherProfile Phase 4a — strip 200-line dead live-compute block, trim dep array 29→8 |
| `8b23338` | `chore:` CLAUDE.md session checkpoint update |

---

## Remaining Work

### Phase 4d — TB/TP simulator stored-first (Trevor sync needed)
The Team Builder simulation (`useTeamBuilderSimulation.ts`) still runs live projection math on every sim pass. Per Trevor's plan, it should read from precomputed rows for the baseline and only re-derive when an interactive overlay (depth role, dev_agg) changes. This is the most impactful remaining item but requires Trevor's input on the safe migration path for the compare tab.

### Activate `.skip` regression tests
Once Phase 4d lands and the TB/Compare surface is confirmed stored-first, remove the `.skip` from `storedVsLive.test.ts` and supply the known-correct values:
- Rossow ERA: verify PitcherProfile and Dashboard show the same computed number
- TB Compare tab: verify transfer player projection matches target board projection

### `p_whip_chase_pct_weight` unlock
AdminDashboard locks this to `0.05`. Needs Trevor's decision on whether to allow runtime tuning.

### Conference ID resolution in TB add path
The add-player path passes only `conference` (name string) to `resolveConferenceStats`, not `conference_id`. For players where `players.conference` is null (e.g. Rossow), this produces the wrong env+ and wrong projection. Root cause of the "From: Campbell (—)" display gap. Fix is shared with the Rossow ERA regression.

---

## No-Fallback Rule (Reference)

Per Trevor's directive and `docs/stored-derived-values-plan.md`:

> If a stored row exists → read it. If it does not → show "—" (null display). Do not live-recompute from raw stat inputs on any profile or dashboard surface.

Session-only overlays (depth role, dev aggressiveness, role transition RP↔SP) are the **only** permitted live computation on profile pages. They layer on top of stored values without touching the database.
