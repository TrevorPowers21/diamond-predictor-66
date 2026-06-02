# JUCO Transfer Projection Pipeline Audit — 2026-05-24

**Bottom line: do NOT run JUCO eager precompute yet.** Three blocker categories:
1. Edge Function pitcher path is missing JUCO constants (will silently skip JUCO or catastrophically over-project if filter removed)
2. JUCO backfill scripts only write rate stats — not o_war/market_value/projected_pa
3. Pitcher simulator path is missing the JUCO district-ID fallback (and there's no pitcher equivalent of the hitter outlier regression)

Plus: 3 parallel definitions of JUCO weights across the codebase (drift risk).

---

## Section 1 — Equation Audit

### Canonical source-of-truth files
- `src/lib/transferWeightDefaults.ts:70-93` — `JUCO_TRANSFER_WEIGHTS` (hitter)
- `src/lib/transferWeightDefaults.ts:134-138` — `JUCO_REGRESSION_CONFIG`
- `src/lib/transferWeightDefaults.ts:184-220` — `JUCO_PITCHING_TRANSFER_WEIGHTS`
- `src/lib/transferWeightDefaults.ts:259-270` — `JUCO_DISTRICT_CONFERENCE_ID`
- `src/lib/transferWeightDefaults.ts:279-290` — `JUCO_DISTRICT_HTP_OVERRIDE`

### Hitter usage path — in sync
`buildTransferProjectionInputs.ts`, `TransferPortal.tsx`, `TeamBuilder.tsx` all import the canonical constants. **Hitter side fine.**

### Pitcher usage path — in sync at src level
`buildTransferPitcherInputs.ts`, `TransferPortal.tsx`, `scripts/precompute-pitchers.ts` all wire through `isJucoSource` correctly.

### DRIFT — Edge Function (HIGH SEVERITY)
`supabase/functions/process-precompute-jobs/index.ts`:
- **Lines 54-85:** has hitter JUCO weights + regression config (in sync)
- **MISSING:** `JUCO_PITCHING_TRANSFER_WEIGHTS`, `JUCO_DISTRICT_HTP_OVERRIDE`, `JUCO_DISTRICT_CONFERENCE_ID`
- **Lines 1118-1127:** pitcher path explicitly filters `p.division !== "NJCAA_D1"` (silently excludes JUCO)
- **Line 1228:** `isJucoSource: false` hard-coded in postprocess

If autofire ever fires for JUCO via Edge Function: silently skips JUCO pitchers. If filter relaxed without adding constants: catastrophic over-projection.

### DRIFT — Third parallel copy
`src/lib/config/platformDefaults.ts:73-119` has parallel `JUCO_TRANSFER_WEIGHTS` + `JUCO_OUTLIER_REGRESSION` + `JUCO_DISTRICT_HTP_OVERRIDES` (different shape — nested vs flat). Values match today, but drift-spotting is hard. No pitcher-side weights here yet.

### Regression slope reasonableness
Hitter side checks out — examples:
- AVG .484 → cap-bound → output **.4636** (mild pull, as designed)
- OBP .550 → r=0.085 → output **.536** (light)
- ISO .400 → cap-bound → output **.364**

Calibration target was Pantier-level projection (pAVG .336 / pSLG .718). **Hitter regression is NOT the "way too high" culprit.**

The likelier hitter-side culprit is the upstream env multiplier: with `t_ba_pitching_weight = 1.30` and JUCO district Stuff+ computed inflated, a mid-tier JUCO bat → SEC school still gets positive net multiplier. **Data quality issue on conference stats, not equation bug.**

### Pitcher-side regression — ABSENT
**No pitcher equivalent of `JUCO_REGRESSION_CONFIG`.** A JUCO pitcher with 1.85 ERA / 14.2 K/9 passes through verbatim. Stuff+ delta + HTP override are the only pull-downs. For ~62% of JUCO pitchers without individual Stuff+, the delta is zeroed → only HTP override remains → if HTP fails silently (see §2), nothing pulls them down. **THIS IS THE LIKELY PITCHER "WAY TOO HIGH" CULPRIT.**

---

## Section 2 — District / Conference Resolution Gap

### Hitter side — RESOLVED
`TransferPortal.tsx:1164-1212` falls back to `JUCO_DISTRICT_CONFERENCE_ID` when conference_id lookup misses. Works.

### Pitcher side — GAP
`TransferPortal.tsx:1217-1233` (`resolvePitchingConferenceStats`) has NO JUCO district fallback. If `selectedPitcher.conferenceId` is null and players.conference string mismatches Conference Stats keys, lookup misses → all env+ become null → simulation blocks.

For pitchers where UUID lookup succeeds, math runs — but HTP override only fires if `jucoDistrict` parses successfully. If JUCO teams in Teams Table don't have correct conference string, HTP silently fails → inflated district HTP (107-123) flows through unchanged → **pitcher projection looks artificially good.**

### Recommended path
4-line paste: mirror the hitter resolver's JUCO district fallback into the pitcher resolver. Then verify all JUCO Teams Table rows have correct `conference_id`.

---

## Section 3 — Current JUCO Data State Queries

Paste into prod SQL editor:

```sql
-- Q1: JUCO player counts by position bucket
SELECT
  COUNT(*) FILTER (WHERE division = 'NJCAA_D1') AS juco_total,
  COUNT(*) FILTER (WHERE division = 'NJCAA_D1' AND position IN ('SP','RP','CL','P','LHP','RHP','SM')) AS juco_pitchers,
  COUNT(*) FILTER (WHERE division = 'NJCAA_D1' AND position NOT IN ('SP','RP','CL','P','LHP','RHP','SM')) AS juco_hitters,
  COUNT(*) FILTER (WHERE division = 'NJCAA_D1' AND is_twp) AS juco_twps
FROM players;

-- Q2: Hitter returner-regular row coverage
SELECT
  COUNT(*) AS hitter_rows,
  COUNT(*) FILTER (WHERE pp.p_wrc_plus IS NOT NULL) AS with_p_wrc,
  COUNT(*) FILTER (WHERE pp.o_war IS NOT NULL) AS with_o_war,
  COUNT(*) FILTER (WHERE pp.market_value IS NOT NULL) AS with_market_value,
  COUNT(*) FILTER (WHERE pp.projected_pa IS NOT NULL) AS with_projected_pa
FROM player_predictions pp
JOIN players p ON p.id = pp.player_id
WHERE p.division = 'NJCAA_D1'
  AND pp.model_type = 'returner' AND pp.variant = 'regular'
  AND pp.customer_team_id IS NULL
  AND pp.season = 2027;

-- Q3: Pitcher returner-regular row coverage
SELECT
  COUNT(*) AS pitcher_rows,
  COUNT(*) FILTER (WHERE pp.p_rv_plus IS NOT NULL) AS with_p_rv,
  COUNT(*) FILTER (WHERE pp.p_war IS NOT NULL) AS with_p_war,
  COUNT(*) FILTER (WHERE pp.market_value IS NOT NULL) AS with_market_value,
  COUNT(*) FILTER (WHERE pp.projected_ip IS NOT NULL) AS with_projected_ip
FROM player_predictions pp
JOIN players p ON p.id = pp.player_id
WHERE p.division = 'NJCAA_D1'
  AND pp.model_type = 'returner' AND pp.variant = 'regular'
  AND pp.customer_team_id IS NULL
  AND pp.season = 2027;

-- Q4: Precomputed (per-team) JUCO transfer row coverage — expect 0
SELECT
  ct.name AS customer_team,
  COUNT(*) FILTER (WHERE p.position NOT IN ('SP','RP','CL','P','LHP','RHP','SM')) AS hitter_precomputed,
  COUNT(*) FILTER (WHERE p.position IN ('SP','RP','CL','P','LHP','RHP','SM')) AS pitcher_precomputed
FROM player_predictions pp
JOIN players p ON p.id = pp.player_id
JOIN customer_teams ct ON ct.id = pp.customer_team_id
WHERE p.division = 'NJCAA_D1'
  AND pp.model_type = 'transfer' AND pp.variant = 'precomputed'
  AND pp.season = 2027
GROUP BY ct.name ORDER BY ct.name;

-- Q5: Worst hitter offenders — sanity check "way too high"
SELECT p.first_name, p.last_name, p.team, p.conference,
       pp.p_avg, pp.p_obp, pp.p_slg, pp.p_wrc_plus, pp.o_war, pp.market_value
FROM player_predictions pp
JOIN players p ON p.id = pp.player_id
WHERE p.division = 'NJCAA_D1'
  AND pp.variant IN ('regular','precomputed')
  AND pp.season = 2027
ORDER BY pp.o_war DESC NULLS LAST LIMIT 25;

-- Q6: Worst pitcher offenders
SELECT p.first_name, p.last_name, p.team, p.conference,
       pp.p_era, pp.p_fip, pp.p_k9, pp.p_rv_plus, pp.p_war, pp.market_value
FROM player_predictions pp
JOIN players p ON p.id = pp.player_id
WHERE p.division = 'NJCAA_D1'
  AND pp.variant IN ('regular','precomputed')
  AND pp.season = 2027
ORDER BY pp.p_war DESC NULLS LAST LIMIT 25;
```

---

## Section 4 — "Way Too High" Diagnosis

### Simulator code path (JUCO pitcher → D1)
`src/pages/TransferPortal.tsx:1633-1894`:
1. **Line 1638:** `isJucoPitcherSrc = selectedPitcher.division === "NJCAA_D1"`
2. **Line 1640:** swaps weights to JUCO set (power weights → 0)
3. **Line 1649:** `resolvePitchingConferenceStats` — **NO JUCO district fallback** ← gap
4. **Lines 1681-1686:** HTP override via `JUCO_DISTRICT_HTP_OVERRIDE[district]` — silent null if district name parse fails

### Ranked culprits
1. **(HIGH) Missing pitcher outlier regression** — JUCO pitcher rates pass through verbatim
2. **(HIGH) HTP override silently null** — inflated raw HTP (107-123) flows through, environment looks tough = pitcher looks great
3. **(MED) Stuff+ delta = 0 for ~62% of JUCO pitchers** without individual Stuff+ rows
4. **(MED) `JUCO_PITCHING_TRANSFER_WEIGHTS` calibration** assumes HTP overrides fire — if they don't, weights are moot
5. **(LOW) Conference Stats data quality** — JUCO district env+ rows may be polluted

### Open question for Trevor
**Which specific JUCO pitcher names did you see "way too high"?** Without a name we're guessing category vs specific bug. Cross-check Q6 results against `JUCO_DISTRICT_HTP_OVERRIDE` keys — if a top offender's `players.conference` doesn't match any of the 10 keys (e.g., "NJCAA D1 Mid South" vs "NJCAA D1 Mid-South"), HTP override is silently missing.

---

## Section 5 — Build Plan (Step by Step)

### Step 1 — Add pitcher outlier regression (NEW)
- Add `JUCO_PITCHER_REGRESSION_CONFIG` to `src/lib/transferWeightDefaults.ts:134-138`
- Suggested initial values, calibrate with Trevor:
  - ERA threshold 2.40 / slope 2.0 / maxR 0.15
  - K9 threshold 12.0 / slope 0.10 / maxR 0.15
  - BB9 threshold 5.5 / slope 0.15 / maxR 0.12
  - FIP threshold 2.80 / slope 1.8 / maxR 0.15
- Wire into `src/lib/buildTransferPitcherInputs.ts:166-246`
- Mirror in `src/pages/TransferPortal.tsx:1658-1663`

### Step 2 — Fix pitcher conference resolver
- `TransferPortal.tsx:1217-1233` — add JUCO district fallback (4 lines)
- Verify `buildTransferPitcherInputs.ts:180` downstream callsite

### Step 3 — JUCO backfill scripts write full output columns
- `scripts/backfill-juco-hitter-predictions.ts:115-126`: currently writes only `from_avg/obp/slg`. Add: `p_avg, p_obp, p_slg, p_iso, p_wrc_plus, o_war, market_value, projected_pa`. Replicate `backfill-2027-hitter-returners.ts` pattern, skip PR blend (JUCO has zero power weights).
- `scripts/backfill-juco-pitcher-predictions.ts`: same — add `p_era/fip/whip/k9/bb9/hr9, p_rv_plus, p_war, market_value, projected_ip, pitcher_role`

### Step 4 — Precompute scripts (mostly done)
- `precompute-transfer-projections.ts` + `precompute-pitchers.ts` already support `--division JUCO|ALL|D1` end-to-end
- Missing: actually running with `--division JUCO` per customer team + verifying `from_team` resolution for JUCO players
- Add prod URL guards (punchlist item 12)

### Step 5 — Edge Function parity (CRITICAL)
- Add to `supabase/functions/process-precompute-jobs/index.ts`:
  - `JUCO_PITCHING_TRANSFER_WEIGHTS`, `JUCO_DISTRICT_HTP_OVERRIDE`, `JUCO_DISTRICT_CONFERENCE_ID`, `jucoDistrictNameFromConference`
  - `JUCO_PITCHER_REGRESSION_CONFIG` + apply function
- Remove `p.division !== "NJCAA_D1"` filter at line 1126 OR gate on a `scope === "pitchers_juco"` branch
- Replace hard-coded `isJucoSource: false` at line 1228 with `isJucoSource: p.division === "NJCAA_D1"`
- Add JUCO district fallback in Edge Function's pitcher conf resolver
- Update `fn_customer_teams_autofire_precompute` trigger to enqueue `pitchers_juco` + `hitters_juco` scopes

### Step 6 — Tests
- New `src/lib/jucoParity.test.ts` — assert all 3 parallel JUCO definitions match byte-for-byte
- `transferWeightDefaults.test.ts` — pin `applyJucoOutlierRegression` boundary cases
- `buildTransferPitcherInputs.test.ts` — assert HTP override fires for each of 10 districts
- Manual: hand-calc Pantier + 2 known pitcher names from Q6, compare to script output ±0.001

### Step 7 — Run order on prod (STRICT)
1. Promote schema/code changes through staging first
2. `backfill-juco-hitter-predictions --apply --prod`
3. `backfill-juco-pitcher-predictions --apply --prod`
4. For each of 7 customer teams: `precompute-transfers:prod --team <UUID> --division JUCO`
5. For each of 7: `precompute-pitchers:prod --team <UUID> --division JUCO`
6. Verify via Q2-Q4
7. Spot-check 5 random JUCO players per customer team in UI

### Step 8 — Validation gates
- Q2/Q3: `with_o_war = hitter_rows`, `with_p_war = pitcher_rows`
- Q4: 7 customer teams populated
- Q5/Q6: no `p_wrc_plus > 200` and no `p_war > 6.0` (rough — Trevor confirms tighter limits)

---

## Section 6 — Risk Register

### D1 blast radius
- **LOW** if Steps 1, 2, 6 land first. Hitter pipeline already conditionally routes JUCO.
- **MEDIUM** if Step 5 partial — autofire on new customer team could misfire. Mitigation: keep filter until full constant set lands, then remove in one commit.

### Rows at risk
- New: `player_predictions` rows where division=NJCAA_D1 + customer_team_id in 7 teams + variant=precomputed (currently 0)
- Overwritten: existing returner-regular JUCO rows (Q2/Q3). Risk = silently overwriting good values with bad if Step 1 lands without Trevor's calibration

### Rollback
- New rows: single `DELETE` filtered by `updated_at >= '<run start>'`
- Overwritten: take snapshot `CREATE TABLE player_predictions_juco_snapshot_20260524 AS SELECT * FROM player_predictions WHERE ...` before backfill
- Trigger autofire stays disabled for JUCO until 2+ customer teams pass Trevor's gut check

---

## Open Questions for Trevor

1. **Which specific JUCO pitcher names did you see "way too high"?** Need a name to diagnose HTP-miss vs regression-miss vs data quality.
2. **OK with adding `JUCO_PITCHER_REGRESSION_CONFIG`?** Suggested starting thresholds in §5 Step 1 — need your gut calibration.
3. **Do all JUCO teams in `Teams Table` have correct `conference_id`?** If not, resolver fixes are partial.
4. **Per-customer-team precompute** — also pre-compute JUCO returner-regular baseline in same run, or separate jobs?
5. **Third parallel JUCO definition in `platformDefaults.ts`** — was that intended as a future Supabase-overridable equation table? If yes, parity test protects against drift; if no, delete.
