# Prod Deploy Plan — ABS + Cascade Fixes + TWP MV (2026-06-08)

Running list of everything to apply to prod when shipping `feature/abs-georgia-to-main`. Updated as we add items.

---

## Deploy sequence

```
1. Merge PR feature/abs-georgia-to-main → main
2. Vercel auto-deploys main → code goes live
3. Apply migrations (Supabase SQL editor, prod project)
4. Run data fixes (Supabase SQL editor, prod project)
5. CLI: npm run import:prod         (cascade w/ all 4 fixes)
6. CLI: npx tsx --env-file=.env.production.local scripts/rerun_all_teams_precompute.ts
7. Verify Anderson + Roblez + Overbeek on prod
8. CLI: launchctl load ~/Library/LaunchAgents/com.rstriq.portal-pull.plist
```

---

## SQL — migrations (apply via Supabase SQL editor, prod project)

### 1. ABS tables
**File:** `supabase/migrations/20260605120000_abs_stats_v2.sql`
**What it does:** creates `abs_hitter_stats` + `abs_pitcher_stats` tables with RLS.
Paste contents of file into SQL editor.

### 2. Pitcher bb_score propagation fix
**File:** `supabase/migrations/20260608000000_pitcher_bb_score_propagation.sql`
**What it does:** replaces `propagate_pitcher_scores_to_predictions` to include `pitcher_bb_score` and legacy `bb_score`.
Paste contents of file into SQL editor.

### 3. TWP market_value columns
**File:** `supabase/migrations/20260608120000_twp_market_value_columns.sql`
**What it does:** adds two new nullable columns to `player_predictions` for TWP-specific market values, so hitter and pitcher sides of a TWP no longer stomp each other's MV on the shared `market_value` column.
Paste contents of file into SQL editor.

### 4. Pitcher depth role column
**File:** `supabase/migrations/20260608140000_pitcher_depth_role_column.sql`
**What it does:** adds `pitcher_depth_role` column to `player_predictions` for parity with `hitter_depth_role`. Auto-assigned by the worker from `players.ip` + `pitcher_role`. Read sites prefer stored, fall back to live-derive for older rows.
Paste contents of file into SQL editor.

### 5. Mark known TWPs (Kenny Ishikawa)
Ensures Kenny Ishikawa is flagged `is_twp=true` so cross-team views read his hitter + pitcher MVs from the split columns and the Target Board adds both sides when he's added.

```sql
UPDATE players SET is_twp = true WHERE id = '52fad838-9135-4681-b428-af5d17480c12';
```

---

## SQL — data fixes (apply via Supabase SQL editor, prod project)

### 4. Unlock all 2027 rows
Required because `protect_locked_predictions` trigger silently blocks UPDATEs to locked rows.

```sql
UPDATE player_predictions SET locked = false WHERE season = 2027;
```

### 5. Canonical class_transition update
Snaps all 2027 non-overridden rows to canonical mapping:
- FR / R-FR → FS
- SO / R-SO → SJ
- JR / R-JR → JS
- SR / R-SR / GR → GR

```sql
UPDATE player_predictions pp
SET class_transition = CASE pl.class_year
  WHEN 'FR'   THEN 'FS'
  WHEN 'R-FR' THEN 'FS'
  WHEN 'SO'   THEN 'SJ'
  WHEN 'R-SO' THEN 'SJ'
  WHEN 'JR'   THEN 'JS'
  WHEN 'R-JR' THEN 'JS'
  WHEN 'SR'   THEN 'GR'
  WHEN 'R-SR' THEN 'GR'
  WHEN 'GR'   THEN 'GR'
  ELSE pp.class_transition
END
FROM players pl
WHERE pp.player_id = pl.id
  AND pp.season = 2027
  AND pp.class_transition_overridden = false
  AND pl.class_year IN ('FR','R-FR','SO','R-SO','JR','R-JR','SR','R-SR','GR');
```

### 6. Backfill pitcher scouting score propagation
Re-runs propagation now that the function includes bb_score:

```sql
SELECT propagate_pitcher_scores_to_predictions(2026);
```

Should return a row count (~18-19k on prod, similar to staging's 18,772).

---

## CLI scripts (run from local terminal)

### 7. Master CSV reimport (refreshes Hitter Master + Pitching Master 2026 D1)

```sh
# Re-copy CSVs into inbox (they'll get archived after import)
cp ~/"RSTR IQ Data/imported/2026-05-19/2026 Final Regular Season Hitting Master 051826.csv" ~/"RSTR IQ Data/inbox/"
cp ~/"RSTR IQ Data/imported/2026-05-19/2026 Final Regular Season Pitching Master 051826.csv" ~/"RSTR IQ Data/inbox/"

# Run prod import (cascade now actually works — bulkRecalc populates all 15K+ rows)
cd ~/dev-main/diamond-predictor-66
npm run import:prod
```

The cascade now includes (after our fixes):
- syncMasterToPlayers
- addMissingPlayers
- computeAndStoreNcaaAverages
- computeAndStoreAllScores (propagates hitter/pitcher scores to predictions)
- createPredictionsFromMaster
- conference Stuff+ rollup
- env-rates
- bulkRecalculatePredictionsLocal — now actually does work (populates o_war/MV with safety guards)

### 8. Per-team precompute rerun
Refreshes all 10 customer teams' precomputed rows with the canonical class_transition + fresh Master data.

```sh
npx tsx --env-file=.env.production.local scripts/rerun_all_teams_precompute.ts
```

Expect ~127K row updates across 10 teams × 2 scopes.

### 9. Re-arm portal pull launchd job

```sh
launchctl load ~/Library/LaunchAgents/com.rstriq.portal-pull.plist
```

---

## Verification spot-checks on prod after everything runs

| Player | What to check | URL |
|---|---|---|
| Michael Anderson (PSU, IF, SR) | Career stats table shows 2026 row, power rating populated, oWAR ~1.94 | `/dashboard/player/29edd467-c5f1-4e64-9f78-d81e4e503c46` |
| Justus Agosto (North Alabama, RP) | Stored p_era ~4.97, pWar ~0.85, MV ~$10.7k, all 4 scouting grades (Stf+/Whf/BB%/Brl) visible | `/dashboard/pitcher/2570eb20-3812-4d05-9c3f-4fc738f0b116` |
| Josiah Overbeek (Army, TWP) | `twp_hitter_market_value` populated, `twp_pitcher_market_value` ~$0, raw `market_value` = NULL | `/dashboard/player/bc25768c-882c-4a06-9e90-ea64c14f6c5f` (also `/dashboard/pitcher/bc25768c...`) |
| Albert Roblez (Oregon State, RP, SR) | ct = GR, dashboard scouting tile shows Stf+/Whf/BB%/Brl, profile matches dashboard | `/dashboard/pitcher/2570eb20...` (find his prod id by name) |
| Returning Players Dashboard | Hitter tab + Pitcher tab — scouting grades populated for D1 players | `/dashboard/returning` |
| Kenny Ishikawa (returner TWP) | `is_twp=true`; profile shows both hitter + pitcher; adding to TB Target Board creates BOTH lineup + bullpen rows | `/dashboard/player/52fad838-9135-4681-b428-af5d17480c12` |
| Dylan Vigue (weekday_starter) | `pitcher_depth_role='weekday_starter'`, `projected_ip=50`, pWAR computed off 50 IP (not 85) | search by name on prod |

---

## State of code fixes on `feature/abs-georgia-to-main`

| # | Fix | File |
|---|---|---|
| 1 | `deriveHitterStored` uses depth-role tier PA | `src/lib/predictionEngine.ts` |
| 2 | `bulkRecalc` calls derive functions + safety guards | `src/lib/predictionEngine.ts` |
| 3 | Scouting fetch uses `CURRENT_SEASON` (was `PRIOR_SEASON`) | `src/lib/predictionEngine.ts` |
| 4 | `runner.ts` calls `bulkRecalc()` without arg | `scripts/import-csvs/runner.ts` |
| 5 | `PitcherProfile` stored-first display (no live compute by default) | `src/pages/PitcherProfile.tsx` |
| 6 | `PitcherProfile` reads `pitcher_*_score` domain columns | `src/pages/PitcherProfile.tsx` |
| 7 | `ReturningPlayers` pitcher tab reads `pitcher_*_score` | `src/pages/ReturningPlayers.tsx` |
| 8 | `ReturningPlayers` hitter tab reads `hitter_*_score` | `src/pages/ReturningPlayers.tsx` |
| 9 | Dashboard pitcher scouting tile shows partial grades (OR not AND) | `src/pages/ReturningPlayers.tsx` |
| 10 | ABS Comparison Table panel (cherry-picked from v2) | multiple |
| 11 | TWP MV split columns (`twp_hitter_market_value`, `twp_pitcher_market_value`) + TWP-aware derive + worker + read sites | migration + `predictionEngine.ts` + worker + `PitcherProfile.tsx` + `PlayerProfile.tsx` + `ReturningPlayers.tsx` + `TeamBuilder.tsx` + `useTeamBuilderData.ts` + `useTeamBuilderSimulation.ts` + `twpMarketValue.ts` |
| 12 | Stored `pitcher_depth_role` column + worker auto-derive + TB read | migration + worker + `TeamBuilder.tsx` + `useTeamBuilderData.ts` + `useTeamBuilderSimulation.ts` |
| 13 | pWAR / market value computed off granular depth IP (weekday_starter=50, weekend=80, etc.) for BOTH returner + transfer paths | `predictionEngine.ts` + worker `applyPitcherPostprocess` |
| 14 | Target Board adds BOTH hitter + pitcher row for TWPs | `TeamBuilder.tsx` `addPlayerFromTargetSearch` |
