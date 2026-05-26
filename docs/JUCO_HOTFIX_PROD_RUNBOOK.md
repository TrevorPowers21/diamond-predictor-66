# JUCO Returner Hotfix — Prod Runbook

Branch: `hotfix/owar-market-value-audit`
Status: validated on staging 2026-05-26.

## What this hotfix fixes

1. **JUCO cross-team (returner regular) projections were being run through the D1 returner equation** (`recalcReturner`), producing nonsense p_* values for JUCO hitters (Yearsley `.464 SLG → .364`). Root cause: `backfill-2027-hitter-returners.ts` had no division filter.
2. **JUCO predictions held stale `from_*` values** from a previous run when blend was active. HM and PM were cleared but predictions never refreshed.
3. **JUCO hitters tagged `position = 'P'`** because the Presto CSV's `pos` column reads "P" for non-pitchers.

## What changed in code

| File | Change |
|---|---|
| `src/lib/nilProgramSpecific.ts` | Added `juco: 0.35` tier; `getProgramTierMultiplierByConference` detects "njcaa" substring |
| `src/lib/jucoReturnerProjection.ts` | NEW — isolated passthrough projection for JUCO returner regular rows |
| `scripts/backfill-2027-hitter-returners.ts` | Division-routing fork; JUCO skips `recalcReturner`. PA ≥ 75 filter nulls sub-threshold JUCO rows |
| `src/lib/createPredictionsFromMaster.ts` | JUCO branch: forces `useBlended=false`, always refreshes `from_*` from raw HM, skips `blended_from_team` propagation, nulls PR internals |
| `scripts/import-juco/runner.ts` | When ingesting from hitter CSV, override `pos = "P"` → `"UTL"` to stop hitters being tagged P on import |

## PROD run order

Run these AFTER `hotfix/owar-market-value-audit` is merged into main and deployed.

### Step 1 — Position fix (JUCO hitters tagged P → UTL)

```sql
-- Preview
SELECT COUNT(*) AS to_relabel
FROM players p
WHERE p.division = 'NJCAA_D1'
  AND p.position = 'P'
  AND EXISTS (
    SELECT 1 FROM "Hitter Master" hm
    WHERE hm.source_player_id = p.source_player_id
      AND hm."Season" = 2026
      AND hm."AVG" IS NOT NULL
  );

-- Apply
UPDATE players p
SET position = 'UTL'
WHERE p.division = 'NJCAA_D1'
  AND p.position = 'P'
  AND EXISTS (
    SELECT 1 FROM "Hitter Master" hm
    WHERE hm.source_player_id = p.source_player_id
      AND hm."Season" = 2026
      AND hm."AVG" IS NOT NULL
  );
```
Staging result: 222 rows relabeled.

### Step 2 — Wipe D1-equation poisoning from JUCO hitter returner regular rows

```sql
-- Preview
SELECT COUNT(*) AS rows_to_clean
FROM player_predictions pp
JOIN players p ON p.id = pp.player_id
WHERE p.division = 'NJCAA_D1'
  AND pp.model_type = 'returner'
  AND pp.variant = 'regular'
  AND pp.customer_team_id IS NULL
  AND pp.from_era IS NULL;     -- hitters only (pitchers carry from_era)

-- Apply
UPDATE player_predictions pp
SET p_avg = NULL, p_obp = NULL, p_slg = NULL, p_iso = NULL, p_ops = NULL,
    p_wrc = NULL, p_wrc_plus = NULL,
    o_war = NULL, market_value = NULL,
    projected_pa = NULL, hitter_depth_role = NULL,
    locked = false
FROM players p
WHERE pp.player_id = p.id
  AND p.division = 'NJCAA_D1'
  AND pp.model_type = 'returner'
  AND pp.variant = 'regular'
  AND pp.customer_team_id IS NULL
  AND pp.from_era IS NULL;
```
Staging result: 4967 rows cleaned.

### Step 3 — Clear JUCO blend columns on Hitter + Pitching Master (idempotent)

```sql
UPDATE "Hitter Master"
SET combined_used = false,
    blended_avg = NULL, blended_obp = NULL, blended_slg = NULL,
    blended_from_team = NULL, blended_from_team_id = NULL
WHERE division = 'NJCAA_D1' AND "Season" = 2026;

UPDATE "Pitching Master"
SET combined_used = false,
    blended_era = NULL, blended_fip = NULL, blended_whip = NULL,
    blended_k9 = NULL, blended_bb9 = NULL, blended_hr9 = NULL,
    blended_from_team = NULL, blended_from_team_id = NULL
WHERE division = 'NJCAA_D1' AND "Season" = 2026;
```
Staging result: both already 0 (idempotent on staging). Prod state unknown — run anyway.

### Step 4 — Refresh JUCO HITTER predictions from raw Hitter Master

```sql
UPDATE player_predictions pp
SET from_avg = hm."AVG",
    from_obp = hm."OBP",
    from_slg = hm."SLG",
    locked = false
FROM "Hitter Master" hm, players p
WHERE pp.player_id = p.id
  AND hm.source_player_id = p.source_player_id
  AND hm."Season" = 2026
  AND p.division = 'NJCAA_D1'
  AND pp.model_type = 'returner'
  AND pp.variant   = 'regular'
  AND pp.customer_team_id IS NULL
  AND pp.season    = 2027;
```

### Step 5 — Check JUCO pitcher prediction staleness (diagnostic)

```sql
SELECT
  COUNT(*) AS juco_pitcher_pred_rows,
  COUNT(*) FILTER (
    WHERE pp.from_era IS DISTINCT FROM pm."ERA"
       OR pp.from_fip IS DISTINCT FROM pm."FIP"
       OR pp.from_whip IS DISTINCT FROM pm."WHIP"
       OR pp.from_k9 IS DISTINCT FROM pm."K9"
       OR pp.from_bb9 IS DISTINCT FROM pm."BB9"
       OR pp.from_hr9 IS DISTINCT FROM pm."HR9"
  ) AS stale_rows
FROM player_predictions pp
JOIN players p ON p.id = pp.player_id
JOIN "Pitching Master" pm
  ON pm.source_player_id = p.source_player_id AND pm."Season" = 2026
WHERE p.division = 'NJCAA_D1'
  AND pp.model_type = 'returner'
  AND pp.variant   = 'regular'
  AND pp.customer_team_id IS NULL
  AND pp.season    = 2027
  AND pp.from_era IS NOT NULL;
```
Staging result: 2568 / 2695 stale.

### Step 6 — Refresh JUCO PITCHER predictions from raw Pitching Master (if step 5 shows staleness)

```sql
UPDATE player_predictions pp
SET from_era  = pm."ERA",
    from_fip  = pm."FIP",
    from_whip = pm."WHIP",
    from_k9   = pm."K9",
    from_bb9  = pm."BB9",
    from_hr9  = pm."HR9",
    locked    = false
FROM "Pitching Master" pm, players p
WHERE pp.player_id = p.id
  AND pm.source_player_id = p.source_player_id
  AND pm."Season" = 2026
  AND p.division = 'NJCAA_D1'
  AND pp.model_type = 'returner'
  AND pp.variant   = 'regular'
  AND pp.customer_team_id IS NULL
  AND pp.season    = 2027
  AND pp.from_era IS NOT NULL;
```

### Step 7 — Run the backfill on prod

```
npm run backfill-2027-hitter-returners:prod
```

This will:
- D1 rows: pass through unchanged `recalcReturner` (no behavioral change)
- JUCO rows: passthrough actuals via `projectJucoReturner` + JUCO tier market value, sub-75-PA rows nulled

### Step 8 — Re-run customer team transfer precomputes (any pre-existing per-team precomputed rows for JUCO are also potentially stale)

NOT YET TESTED — open question. Adds risk; do not run until transfer portal equation audit is done.

## Spot-check after prod run

```sql
-- Yearsley should show p_* = .464/.587/1.139 (raw HM passthrough)
SELECT pp.from_avg, pp.from_obp, pp.from_slg,
       pp.p_avg, pp.p_obp, pp.p_slg, pp.p_iso, pp.p_wrc_plus,
       pp.o_war, pp.market_value, pp.hitter_depth_role, pp.projected_pa
FROM player_predictions pp
JOIN players p ON p.id = pp.player_id
WHERE p.first_name='Kameron' AND p.last_name='Yearsley'
  AND pp.model_type='returner' AND pp.variant='regular'
  AND pp.customer_team_id IS NULL AND pp.season=2027;
```

## NOT done in this hotfix (separate work)

- **Transfer portal equation audit for JUCO** — Yearsley → Kansas projecting `.393 wRC+ 142`, Yearsley → Arkansas projecting `.347 wRC+ 130`. Gap between Big 12 and SEC env+ feels too wide. User flagged this 2026-05-26.
- **Per-customer-team JUCO precomputed rows refresh** — same staleness might exist on `variant='precomputed'` rows for JUCO sources. Audit before refreshing.
- **Pitching equation audit for JUCO** — user said pitching looks like it's working but flagged it for a look.
