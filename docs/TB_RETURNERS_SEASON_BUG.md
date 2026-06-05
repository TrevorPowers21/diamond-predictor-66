# TB Returners — Season Pickup Bug

**For:** Peyton
**From:** Trevor + Claude (investigation 2026-06-05)
**TL;DR:** One-line fix. Pre-existing bug, not from your recent commits. Already-fixed bug pattern from `aafd8fa` (May 23) that lives in the parallel TB returners path. Defensive on prod, actively breaking staging.

---

## The bug

`useTeamBuilderData.ts:336-338` (`processReturners` helper inside the `team-builder-returners-v4` query) has **no season filter** on the prediction picker. It returns every regular returner row for the player across all seasons, then `scorePredictionLikeDashboard` picks the highest-scoring one with `updated_at` as the tiebreaker. The scorer has no season preference.

```ts
// current — no season filter
const preds = (player.player_predictions || []).filter(
  (pr: any) =>
    pr.variant === "regular" &&
    (pr.status === "active" || pr.status === "departed"),
);
```

## Why this is the same bug class Trevor fixed on May 23

Commit `aafd8fa` ("precompute: filter pred query by season to avoid 2026/2027 pickup race") added `.eq("season", season)` to `scripts/precompute-pitchers.ts` and `scripts/precompute-transfer-projections.ts`. From that commit message:

> "Both pitcher + hitter transfer precompute scripts loaded the prior prediction row to carry class_transition / dev_aggressiveness forward, but didn't filter by season. With both 2026 and 2027 returner rows present (same rank in the bestPredByPlayer ranker), which one won depended on Postgres result ordering."

Same exact bug class. The TB returners path was extracted from `TeamBuilder.tsx` into `useTeamBuilderData.ts` two days *before* the precompute fix (commit `8513293`, May 21). When the season-filter fix went in on May 23, the parallel TB returner codepath was never updated. Drift between duplicate "pick the best prediction row" implementations — exactly the failure mode CLAUDE.md flags ("Precompute math is duplicated... Change BOTH when math changes or worker drifts from displays").

`main` and `staging` are identical on this file — empty diff. Not a recent regression. Just been sitting there.

---

## Why main / prod looks fine

By accident. On prod:
- 15,025 of 15,155 returner-regular 2026 rows are `status='stale'`
- All 15,690 returner-regular 2027 rows are `status='active'`

The scorer rewards `status === "active"` with `+2`. So 2027 wins by at least +2 every time → the broken code accidentally picks the right row.

The remaining 130 active-2026 rows on prod all belong to **JUCO alumni without a 2027 row** (eligibility exhausted, moved to MLB org, etc.). All have `position = null`, `transfer_portal = false`, JUCO team codes. They have no 2027 alternative, so the picker can't choose wrong — there's only one row.

**Verified:** dual-active-overlap query against prod returns 0 rows. Bug exists in code, no current data state triggers it.

## Why staging is actively broken

Post-May-14 wipe never ran the cascade step that flips old-season returner-regular rows from `active → stale`. So:

- 15,674 returner-regular 2026 rows: ALL `active`
- 15,544 returner-regular 2027 rows: ALL `active`

When both rows are `active`, they tie on the active boost. Rest of scoring is roughly equal. Final tiebreaker = `updated_at`. Whichever side was touched most recently wins. Inconsistent player by player.

(Separately, same root cause hits `Hitter Master.overall_power_rating` and the other 3 hitter power-rating columns on staging — all NULL across all 8,258 rows because `npm run recompute-cascade` never ran post-wipe. Independent issue, same theme: post-wipe cascade was incomplete.)

---

## The fix

`src/pages/team-builder/hooks/useTeamBuilderData.ts`:

```ts
// 1) Add to imports at top:
import { PROJECTION_SEASON } from "@/lib/seasonConstants";

// 2) Replace lines 336-338 in processReturners:
const preds = (player.player_predictions || []).filter(
  (pr: any) =>
    pr.season === PROJECTION_SEASON &&
    pr.variant === "regular" &&
    (pr.status === "active" || pr.status === "departed"),
);
```

One-line change inside the filter, plus the import. Doesn't touch the scorer, doesn't touch any other path.

Mirrors what `useTeamBuilderSimulation.ts:483` (live target predictions) already does:

```ts
.eq("season", PROJECTION_SEASON)
```

After the fix, the two TB query paths will be consistent on season handling.

## Test plan

- Open a saved build on staging. Pick a returner with both a 2026 and 2027 regular row. Confirm TB shows the **2027** numbers (oWAR, market_value, slash projections, etc.)
- Cross-check the same player on Player Profile / Compare — numbers should match exactly
- Cold reload — same result, no flicker
- Confirm no regression for returners that only have a 2027 row (common case) — should look identical to before
- Confirm no regression for the all-active-active staging case — picker now locks to 2027 deterministically instead of coin-flipping

---

## Verification SQL (paste into Supabase SQL editor)

### 1. Find players currently exposed to the bug

```sql
SELECT
  pl.id AS player_id,
  pl.first_name,
  pl.last_name,
  pl.team,
  pl.position,
  pl.is_twp,
  COUNT(*) FILTER (WHERE pp.season = 2026 AND pp.status = 'active') AS rows_2026_active,
  COUNT(*) FILTER (WHERE pp.season = 2026 AND pp.status = 'stale')  AS rows_2026_stale,
  COUNT(*) FILTER (WHERE pp.season = 2027 AND pp.status = 'active') AS rows_2027_active
FROM players pl
JOIN player_predictions pp ON pp.player_id = pl.id
WHERE pp.variant = 'regular'
  AND pp.model_type = 'returner'
  AND pp.season IN (2026, 2027)
GROUP BY pl.id, pl.first_name, pl.last_name, pl.team, pl.position, pl.is_twp
HAVING COUNT(*) FILTER (WHERE pp.season = 2026 AND pp.status = 'active') > 0
   AND COUNT(*) FILTER (WHERE pp.season = 2027 AND pp.status = 'active') > 0
ORDER BY pl.team NULLS LAST, pl.last_name, pl.first_name;
```

Expected on staging: thousands of rows.
Expected on prod: zero rows.

### 2. Side-by-side row comparison for affected players

```sql
WITH affected AS (
  SELECT pp.player_id
  FROM player_predictions pp
  WHERE pp.variant = 'regular'
    AND pp.model_type = 'returner'
    AND pp.status = 'active'
    AND pp.season IN (2026, 2027)
  GROUP BY pp.player_id
  HAVING COUNT(DISTINCT pp.season) = 2
)
SELECT
  pl.first_name || ' ' || pl.last_name AS name,
  pl.team,
  pl.position,
  pp.season,
  pp.status,
  pp.updated_at,
  ROUND(pp.p_wrc_plus::numeric, 0) AS p_wrc_plus,
  ROUND(pp.o_war::numeric, 2)      AS o_war,
  ROUND(pp.market_value::numeric, 0) AS market_value,
  ROUND(pp.p_rv_plus::numeric, 0)  AS p_rv_plus,
  ROUND(pp.p_war::numeric, 2)      AS p_war,
  ROUND(pp.from_avg::numeric, 3)   AS from_avg,
  ROUND(pp.from_era::numeric, 2)   AS from_era,
  pp.hitter_depth_role,
  pp.pitcher_role
FROM affected a
JOIN players pl ON pl.id = a.player_id
JOIN player_predictions pp ON pp.player_id = a.player_id
WHERE pp.variant = 'regular'
  AND pp.model_type = 'returner'
  AND pp.season IN (2026, 2027)
ORDER BY pl.team NULLS LAST, pl.last_name, pl.first_name, pp.season DESC
LIMIT 100;
```

### 3. Which row TB actually picks today (models the bug)

```sql
WITH affected AS (
  SELECT pp.player_id
  FROM player_predictions pp
  WHERE pp.variant = 'regular'
    AND pp.model_type = 'returner'
    AND pp.status = 'active'
    AND pp.season IN (2026, 2027)
  GROUP BY pp.player_id
  HAVING COUNT(DISTINCT pp.season) = 2
),
ranked AS (
  SELECT
    pp.player_id,
    pp.season,
    pp.status,
    pp.updated_at,
    pp.p_wrc_plus,
    pp.o_war,
    pp.market_value,
    -- mirror scorePredictionLikeDashboard:
    (CASE WHEN pp.model_type = 'returner' THEN 6 ELSE 0 END) +
    (CASE WHEN pp.p_avg IS NOT NULL AND pp.p_obp IS NOT NULL AND pp.p_slg IS NOT NULL
              AND pp.p_ops IS NOT NULL AND pp.p_iso IS NOT NULL AND pp.p_wrc_plus IS NOT NULL THEN 5 ELSE 0 END) +
    (CASE WHEN pp.ev_score IS NOT NULL OR pp.barrel_score IS NOT NULL
              OR pp.whiff_score IS NOT NULL OR pp.chase_score IS NOT NULL THEN 2 ELSE 0 END) +
    (CASE WHEN pp.status = 'active' THEN 2 ELSE 0 END) +
    (CASE WHEN pp.from_avg IS NOT NULL OR pp.from_obp IS NOT NULL OR pp.from_slg IS NOT NULL THEN 1 ELSE 0 END)
    AS score,
    ROW_NUMBER() OVER (
      PARTITION BY pp.player_id
      ORDER BY
        (CASE WHEN pp.model_type = 'returner' THEN 6 ELSE 0 END) +
        (CASE WHEN pp.p_avg IS NOT NULL AND pp.p_obp IS NOT NULL AND pp.p_slg IS NOT NULL
                  AND pp.p_ops IS NOT NULL AND pp.p_iso IS NOT NULL AND pp.p_wrc_plus IS NOT NULL THEN 5 ELSE 0 END) +
        (CASE WHEN pp.ev_score IS NOT NULL OR pp.barrel_score IS NOT NULL
                  OR pp.whiff_score IS NOT NULL OR pp.chase_score IS NOT NULL THEN 2 ELSE 0 END) +
        (CASE WHEN pp.status = 'active' THEN 2 ELSE 0 END) +
        (CASE WHEN pp.from_avg IS NOT NULL OR pp.from_obp IS NOT NULL OR pp.from_slg IS NOT NULL THEN 1 ELSE 0 END)
        DESC,
        pp.updated_at DESC
    ) AS pick_rank
  FROM affected a
  JOIN player_predictions pp ON pp.player_id = a.player_id
  WHERE pp.variant = 'regular'
    AND pp.model_type = 'returner'
    AND pp.season IN (2026, 2027)
)
SELECT
  pl.first_name || ' ' || pl.last_name AS name,
  pl.team,
  r.season AS picked_season,
  r.score,
  r.updated_at AS picked_updated_at,
  ROUND(r.p_wrc_plus::numeric, 0) AS picked_p_wrc_plus,
  ROUND(r.o_war::numeric, 2) AS picked_o_war,
  ROUND(r.market_value::numeric, 0) AS picked_market_value
FROM ranked r
JOIN players pl ON pl.id = r.player_id
WHERE r.pick_rank = 1
ORDER BY r.season ASC, pl.team NULLS LAST, pl.last_name
LIMIT 200;
```

Rows sorted with the wrongly-picked 2026 rows at the top. After the code fix lands, every `picked_season` should be 2027.

---

## Status summary

| Branch | Bug present in code | Currently triggering | Notes |
|---|---|---|---|
| `main` (prod data) | yes | **no** | 130 active-2026 rows are JUCO alumni without 2027 rows — no collision possible |
| `staging` | yes | **yes** | ~thousands of dual-active players from post-wipe season-rollover never running |

## Other items worth doing in the same session

- **Staging**: `npm run recompute-cascade` (or hit the button in Admin Dashboard) — backfills `Hitter Master.overall_power_rating` + `ba_/obp_/iso_power_rating`, currently NULL across all 8,258 rows on staging. Same post-wipe-cascade root cause as the season-rollover gap.
- **Optional tidy-up on prod**: flip the 130 alumni 2026-active rows to `status='stale'` to match the rest of prod's data state. Pure cleanliness — no behavior impact since they have no 2027 collision anyway. SQL on request.
