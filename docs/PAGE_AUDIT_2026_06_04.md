# FULL-PAGE DATA FLOW AUDIT — RSTR IQ

**Branch:** `audit/full-page-data-flow`
**Staging SHA:** `2b9aa9d` (Merge PR #111)
**Date:** 2026-06-03
**Mode:** Read-only. No code changes, no migrations, no commits.

---

## 0. CROSS-PAGE SUMMARY

### Tables read by 3+ pages
| Table | Pages | Read pattern |
|---|---|---|
| `player_predictions` | Dashboard, Player Dashboard, Compare, TPS, TB, Player Profile, Pitcher Profile, High Follow | Stored-first via `pickPreferredPrediction(rows, effectiveTeamId)` |
| `players` | All pages | Identity + portal status + position + division |
| `Hitter Master` | Player Dashboard, Compare/TPS (risk only), Player Profile, High Follow | Current/career stats + scouting metrics + `blended_*` fallback |
| `Pitching Master` | Player Dashboard, Compare/TPS (risk only), Pitcher Profile, High Follow, TB returner pitcher path | Current/career rates + scouting + `blended_*` |
| `customer_teams` | Effective school scoping everywhere | Via `useEffectiveSchool()` |
| `nil_valuations` | Player Dashboard (fallback), Player/Pitcher Profile, TB allPlayersSearch | Fallback when `market_value` null on prediction row |

### Worst-offender queries
1. `team-builder-all-players-search` — ~16K rows, `useTeamBuilderData.ts:135-169`, staleTime 60min (acceptable b/c cached).
2. `returning-players-2025-unified` slow path — all hitter-pool rows pulled when conference filter active.
3. `usePitchingSeedData` — full `Pitching Master` scan (~3-5K rows) on every Pitcher tab entry; staleTime 12h.
4. `transfer-sim-players` — combined ~32K players + ~100K predictions on TPS mount.
5. `pitchArsenalRows` on PitcherProfile — multi-season query with usage aggregation.

### Cumulative IO (cold session: Dashboard → Player Profile → TPS → TB)
- Dashboard: ~4 parallel queries, ~600-800ms
- Player Profile: ~5 parallel + 4 sequential, ~250-300ms
- TPS: 1 big seed query (~32K + ~100K rows) + per-selection query, 2-3s cold
- TB: 12+ seed queries + simulation queries, 3-5s cold
- **Total cold transfer ~150K-200K rows over ~6-8s; warm session <1s/page**

### Stored-first compliance
- Dashboard ✓ | Compare ✓ | TPS ✓ (with 2 gating bugs) | Player Profile ✓ | Pitcher Profile ⚠️ (missing team-scope filter) | TB ✓ (one open data Q: Hairston) | Player Dashboard ⚠️ (NIL fallback + pitcher stuff_score live-compute)

---

## 1. /  (Overview — `src/pages/Dashboard.tsx`)

### Queries
| # | queryKey | File:Line | Table | Filter | Stale | Rows |
|---|---|---|---|---|---|---|
| 1 | `overview-top-hitters` | Dashboard.tsx:72-154 | `player_predictions` + `players!inner` | season=2026, status in active/departed, model in returner/transfer, position NOT pitcher, division ≠ NJCAA_D1, pa ≥ 75, p_wrc_plus NOT NULL | 5min | 50+50 merge → top 5 |
| 2 | `overview-top-pitchers` | Dashboard.tsx:156-229 | `player_predictions` + `players!inner` | same as above + pitcher positions, ip ≥ 20 | 5min | 50+50 merge → top 5 |
| 3 | `overview-briefing-stats` | Dashboard.tsx:232-275 | `players` + `player_predictions` | portal_status counts, commit_school ilike, max updated_at | 5min | counts + 3 + 1 |
| 4 | `overview-portal-activity-v4` | Dashboard.tsx:320-418 | `players` + `player_predictions` | portal_status IN (IN PORTAL, COMMITTED), 3-day floor, min-sample (pa≥25 or ip≥10) | 60s | 150 → 50 |

### UI elements
| Element | Source | DB column | Stored/Derived |
|---|---|---|---|
| Top 5 Hitters cards | #1 | `p_wrc_plus, p_avg, p_obp, p_slg` | STORED ✓ |
| Top 5 Pitchers cards | #2 | `p_rv_plus, p_era, p_fip, p_k9` | STORED ✓ |
| Portal tile | #3 | `players.count() WHERE portal_status='IN PORTAL'` | STORED (global, not team-scoped) |
| Committed tile | #3 | `players.count() WHERE commit_school ilike <schoolName>` | STORED |
| Projections-updated timestamp | #3 | `player_predictions.updated_at` (max) | STORED ✓ |
| Portal activity feed | #4 | mixed players + dedup'd predictions | STORED ✓ |

### Load
- Cold ~600-800ms parallel; warm sub-200ms; staleTime good.
- All metrics stored; null = "—" no fallback.

### Anomalies — None critical.

---

## 2. /dashboard/returning  (Player Dashboard — `src/pages/ReturningPlayers.tsx`)

### Hitter tab queries
| # | queryKey | File:Line | Table | Filter | Stale | Rows |
|---|---|---|---|---|---|---|
| 1 | `returning-players-2025-unified` (FAST PATH) | RP.tsx:1463-1985 | `player_predictions` + `players!inner` | season=2026, model in returner/transfer, status active/departed, hitter-or-TWP, division ≠ NJCAA_D1, pa ≥ 75, team-scope filter | 60min | 100/page via `.range()` + count exact |
| 1' | same (SLOW PATH) | RP.tsx | same | when sort key not in FAST_DB_SORT_KEYS OR conference filter active | 60min | all rows → JS sort/paginate |
| 2 | `hitter_master` | useHitterSeedData.ts:49-76 | `Hitter Master` | Season=2026, 1000-row pages | 12h | ~2.5-3.5K |
| 3 | `conference-stats-2026` | useConferenceStats | `Conference Stats` | season | 30min | ~30 |

### Pitcher tab queries
| # | queryKey | File:Line | Table | Filter | Stale | Rows |
|---|---|---|---|---|---|---|
| 4 | `returning-pitcher-predictions-by-source-id` | RP.tsx:2224-2320 | `player_predictions` + `players!inner(source_player_id)` | season=2026, p_era NOT NULL, applyTeamScopeFilter | 60min | ~2-4K |
| 5 | `pitching_master` | usePitchingSeedData.ts:76-105 | `Pitching Master` | Season=2026, **IP ≥ 10** (PR #111), role NOT hitter | 12h | ~3-5K |

### Hitter UI mapping
| Column | Source | DB column | Notes |
|---|---|---|---|
| Name, team, position, class, bats | #1 (join) | players.* | STORED |
| pAVG/pOBP/pSLG/pOPS/pISO | #1 | `player_predictions.p_*` | STORED ✓ — fast-path sorts server-side |
| pWRC+ | #1 | `p_wrc_plus` | STORED ✓ default sort |
| oWAR | #1 | `o_war` | STORED ✓ slow-path sort only |
| **Market Value** | #1 + fallback | `market_value` OR `computeNilFallback()` | **⚠️ LIVE COMPUTE fallback** (owar × 25k × tier × pos) |

### Pitcher UI mapping
| Column | Source | DB column | Notes |
|---|---|---|---|
| ERA/FIP/WHIP/K9/BB9/HR9 | #5 | `Pitching Master.{era,fip,whip,k9,bb9,hr9}` or `blended_*` | STORED (current rates, not projections) |
| Stuff+ | #5 + live calc | `calcScore(...)` | **⚠️ LIVE COMPUTE** — inconsistent with other scores |
| whiff_score, bb_score, barrel_score | #4 | `player_predictions.*_score` | STORED ✓ |
| PR+ scores | #5 | `Pitching Master.*_pr_plus` OR live recompute | STORED-preferred, live fallback ⚠️ |
| pERA/pFIP/pWHIP/pK9/pBB9/pHR9 | #4 | `p_*` from dbPred | STORED-only ✓ ("—" if null) |
| pRV+, pWAR, market_value | #4 | `p_rv_plus, p_war, market_value` | STORED ✓ |
| Role | #4 + override | `pitcher_role` OR override localStorage | STORED w/ override |

### Anomalies
- ⚠️ NIL fallback `computeNilFallback()` lives in hitter sort path; live-compute drift when stored market_value null.
- ⚠️ `stuff_score` live-computed where other scouting scores stored.
- ⚠️ Conference filter forces slow path (PostgREST can't do two `or` on same embedded resource).
- **🐛 PR #111 IP threshold 1→10** drops ~27% of pitchers — affects pitcher tab search + leaderboard (open todo #3).

---

## 3. /dashboard/compare  (Compare Dashboard — `src/pages/PlayerComparison.tsx`)

### Queries
| # | queryKey | File:Line | Table | Filter | Stale | Rows |
|---|---|---|---|---|---|---|
| 1 | `compare-all-players` | PC.tsx:139-161 | `players` | paginated 1000/page | 60min | ~32K |
| 2 | `compare-predictions` | PC.tsx:168-188 | `player_predictions` | player_id IN (a,b), season=2026, status active/departed, variant in regular/precomputed | 30min | 2-20 |

### Row selection (PC.tsx:191-199)
```ts
pickPreferredPrediction(rows, destTeamId)  // destTeamId = effectiveTeamId from useEffectiveSchool()
```
✓ Correct.

### Hitter UI (renderHitterPanel PC.tsx:285-391)
| Card | Source | DB column |
|---|---|---|
| pWRC+ hero | `row.p_wrc_plus` | STORED ✓ |
| oWAR hero | `row.o_war` | STORED ✓ (2-decimal display) |
| Market hero | `row.market_value` | STORED ✓ |
| pAVG/pOBP/pSLG/pOPS/pISO | `row.p_*` | STORED ✓ |

### Pitcher UI (PC.tsx:394-523)
| Card | Source | DB column |
|---|---|---|
| pRV+ | `row.p_rv_plus` | STORED ✓ |
| pWAR | `row.p_war` | STORED ✓ |
| Market | `row.market_value` | STORED ✓ |
| ERA/FIP/WHIP/K9/BB9/HR9 | `row.p_*` | STORED ✓ |

### Anomalies
- Minor: `simulation` useMemo missing `!authLoading` gate (low impact; "Select a player." fallback masks it).

---

## 4. /dashboard/portal  (Transfer Portal Simulator — `src/pages/TransferPortal.tsx`)

### Queries (selected)
| # | queryKey | File:Line | Notes |
|---|---|---|---|
| 1 | `transfer-sim-players` | TP.tsx:578-702 | ~32K players + ~100K predictions, 60min stale, **BIG** |
| 2 | `admin-ui-equation-values` | TP.tsx:737-767 | model_config overrides |
| 3 | `transfer-sim-hitter-career` | TP.tsx:965-980 | Hitter Master per selected player |
| 4 | `transfer-sim-pitcher-career` | TP.tsx:984-1000 | Pitching Master per selected pitcher |
| 5 | `tps-hitter-pred-rows` | TP.tsx:1021-1039 | `player_predictions` for selected hitter |
| 6 | `tps-pitcher-pred-rows` | TP.tsx:1051-1069 | `player_predictions` for selected pitcher, gate `!!selectedPitcherPlayerId && !authLoading` |
| 7 | `transfer-portal-pa-lookup` | TP.tsx:1091-1131 | Risk sample-size |
| 8 | `transfer-portal-juco-trackman` | TP.tsx:1136-1180 | JUCO data reliability badge |

### Row selection
- Hitter: `pickPreferredPrediction(selectedHitterPredictions, effectiveTeamId)` at TP.tsx:1408 ✓
- Pitcher: same pattern at TP.tsx:1443 ✓
- `selectedPitcher.id` correctly maps from `usePitchingSeedData` source_player_id ✓

### UI mapping (both tabs)
All hero + stat grid cards read STORED `player_predictions.*` columns. No applyDevScale / class_transition / depthMult applied on display. ✓

### Risk assessment
- `projectionSourceRow` derived from `hitterCareerSeasons` / `pitcherCareerSeasons` with `combined_used → blended_*` fallback (TP.tsx:1695-1711, 1888-1908). ✓ Matches PlayerProfile/PitcherProfile pattern.

### 🐛 CRITICAL: missing `!authLoading` gate
**File:Line:** `src/pages/TransferPortal.tsx:1438-1450`

```ts
const pitchingSimulation = useMemo<PitchingSim | null>(() => {
  if (!selectedPitcher) return null;                           // ← needs `|| authLoading`
  const row = pickPreferredPrediction(selectedPitcherPredictions, effectiveTeamId);
  const ok = row && row.p_rv_plus != null;
  return {
    blocked: !ok,
    missingInputs: ok ? [] : ["No stored projection for this pitcher at this team"],
    ...
  };
}, [selectedPitcher, selectedPitcherPredictions, effectiveTeamId, pitchingRoleOverride]);
// ← deps missing `authLoading`
```

Symptom: "Missing inputs: No stored projection for this pitcher at this team" flashes on cold pitcher-tab load before query resolves. **Same one-line gate needed on hitter useMemo at TP.tsx:1400 for symmetry.** (Open todo #1.)

---

## 5. /dashboard/team-builder  (`src/pages/TeamBuilder.tsx` + `src/pages/team-builder/*`)

### Seed queries (`useTeamBuilderData.ts`)
| Hook | Source | File:Line | Notes |
|---|---|---|---|
| useHitterSeedData | `Hitter Master` | UTBD:72 | 60min stale |
| usePitchingSeedData | `Pitching Master` | UTBD:76 | 60min stale; gated by auth |
| useConferenceStats | `Conference Stats` | UTBD:78 | 30min |
| usePlayerOverrides | `player_overrides` | UTBD:79 | 30min |
| usePitcherRoleOverrides | localStorage + DB | UTBD:80 | — |
| useTeamsTable | `teams` | UTBD:81 | 30min |
| useParkFactors | `park_factors` | UTBD:82 | 30min |
| useTargetBoard | `roster` + `player_predictions` | UTBD:83-89 | session |
| `admin-ui-equation-values` | `model_config` | UTBD:118-133 | 30min |
| `team-builder-all-players-search` | `players + player_predictions + nil_valuations` | UTBD:135-169 | **60min, 16K rows** |
| `team-builder-pa-lookup` | `Hitter Master` PRIOR_SEASON | UTBD:171-194 | 30min |
| `team-builder-season-usage-lookup-v7` | multiple | UTBD:196+ | — |

### Simulation queries (`useTeamBuilderSimulation.ts`)
| Query | File:Line | Notes |
|---|---|---|
| `team-builder-live-target-predictions` | UTBS:475-490 | `.in("player_id", targetPlayerIds)` + `applyTeamScopeFilter`, select includes `o_war, market_value, projected_pa, p_war, projected_ip, pitcher_role, class_transition, dev_aggressiveness` |
| `team-builder-live-target-players` | UTBS:508-519 | identity columns |
| `team-builder-prediction-internals` | UTBS:538-549 | rarely needed |

### Hitter projection (target, precomputed) — UTBS:628-653
```ts
if (variant === "precomputed" && customer_team_id === effectiveTeamId) {
  const owar = lp.o_war;          // STORED, no depthMult
  const market = lp.market_value;  // STORED, no transform
  return { p_avg, p_obp, p_slg, p_ops, p_iso, p_wrc_plus, owar, nil_valuation: market };
}
```
✓ PR #111 depthMult double-count fix in place — stored o_war/market_value read raw.

### Hitter projection (returner) — UTBS:1307-1328
Reads `p.prediction.o_war` directly; no depthMult; falls through to "—" if null. ✓

### Pitcher projection (target) — UTBS:1247-1305
**Live-computes class-transition multipliers** (`lowBetterMult` / `highBetterMult` derived from class_transition + dev_aggressiveness, ±0.06/level), applies to `p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9` rates. Then recomputes pRV+ from adjusted rates. Then pWAR via `computePitcherPwar(p, source)` which applies `depthRoleMultiplier(p.depth_role)` at end.

### Pitcher projection (returner) — UTBS:1156-1216
Calls `computeReturnerPitchingProjection` → `computePitcherProjection()` lib function with class_transition + devAgg as params. Then pWAR via same `computePitcherPwar`.

### Depth role seeding
- Hitter add (TeamBuilder.tsx:1500-1504): `defaultHitterDepthRoleFromPa(seedHitterAb)` from hitterAb map → hitterMasterPaMap → seedByPlayerId.
- Pitcher add (TeamBuilder.tsx:1515): `defaultPitcherDepthRoleFromIp(pmRec?.ip, inferredRole)`.
- **Possible regression source:** stale PA/IP data, or path where `pmRec`/`seedHitterAb` resolves to null → defaults to "utility"/"weekend_starter". (Open todo #6.)

### UI mapping (all tabs)
| Cell | Source | Stored/Derived |
|---|---|---|
| oWAR (hitter target) | UTBS:628-653 → `lp.o_war` | STORED ✓ |
| oWAR (hitter returner) | UTBS:1327 → `p.prediction.o_war` | STORED ✓ |
| pWAR (pitcher) | UTBS:1303 → `computePitcherPwar` | DERIVED (class + depth applied) |
| Market value (hitter, target) | `lp.market_value` | STORED ✓ |
| Market value (pitcher, both) | `projectedNilForPlayer` | DERIVED (pwar × $/war × tier × role) |
| Slash, rates | precomputed row | STORED ✓ |
| Depth chip | `p.depth_role` | session state, seeded once |

### Landon Hairston (Arizona State) anomaly
Slash correct; oWAR 3.07 vs 2.3, market $101K vs $83K. Code path: hitter target → UTBS:628-653 → reads `lp.o_war` and `lp.market_value` raw from `player_predictions`. **No client-side math could inflate these values.**

Conclusion: the stored row itself has the inflated values. Hypotheses:
1. Precompute job ran with wrong `hitter_depth_role` (e.g. "cornerstone" instead of "everyday_starter") for Arizona State; oWAR/market_value baked in at wrong tier.
2. Pre-PR #111 row never recomputed under new pipeline.

Verify by querying `player_predictions WHERE player_id = <Hairston UUID> AND customer_team_id = <Arizona State UUID> AND variant = 'precomputed'` and checking `hitter_depth_role, projected_pa, o_war, market_value, updated_at`. (Open todo #5.)

### Anomalies
- `liveTargetPredictions` has no staleTime — refires on every roster/team change.
- Class-transition multipliers ONLY apply to target pitchers, not returners. Documented behavior, but if coach overrides class_transition on a returner pitcher, change is ignored until removed + re-added.

---

## 6. /dashboard/player/:id  (Player Profile — `src/pages/PlayerProfile.tsx`)

### Queries
| # | queryKey | File:Line | Source | Notes |
|---|---|---|---|---|
| 1 | `player-profile` | PP:202-245 | `players` + Hitter Master fallback | UUID then numeric source_player_id |
| 2 | `player-predictions` | PP:249-271 | `player_predictions` | season=2026, status=active, **team-scope filter applied** ✓ |
| 3 | `player-season-stats` | PP:273-285 | `season_stats` | all seasons |
| 4 | `player-hitter-master-seasons` | PP:290-304 | `Hitter Master` | by source_player_id, all seasons |
| 5 | `player-has-pitching` | PP:307-321 | `Pitching Master` | IP ≥ 1, TWP detection |
| 6 | `ncaa-wrc-mean-profile` | PP:345-357 | `ncaa_averages` | disabled for 2026 |
| 7 | `player-internal-ratings` | PP:398-413 | `player_prediction_internals` | admin-only |
| 8 | `useNilValuation` hook | PP:395 | `nil_valuations` | latest season |
| 9 | `useScoutingReport` hook | PP:247 | AI report table | type=hitter |
| 10 | `useCoachNotes` hook | PP:181 | `coach_notes` | per player |

### projectionSourceRow (PP:575-617)
Pins to 2026 Hitter Master row; if `combined_used`, swap all rate stats to `blended_*` columns. Pulls scouting scores from Hitter Master columns (`barrel_score, contact_score, chase_score, ev_score, bb_score, ...`).

### UI mapping
| Section | Source | DB column |
|---|---|---|
| Hero | #1 + #4 (2026) | players.*, Hitter Master.* |
| Slash hero | #4 (2026 row) + #2 (predictions) | `p_avg/p_obp/p_slg` (STORED) |
| **oWAR display** | #2 + session overlay | `regularPred.o_war × overlayScale` |
| Market value | #2 + session overlay | `regularPred.market_value × overlayScale` |
| Power Rating (overall) | #4 | `overall_power_rating` from Hitter Master |
| Scouting grades | #4 (activeSeasonRow) | Hitter Master `*_score` columns |
| Risk Assessment | `assessHitterRisk(projectionSourceRow)` | Hitter Master metrics |
| AI Scouting Report | #9 or `generateHitterReport()` | STORED if exists, else computed |
| Coach Notes | #10 | `coach_notes` |
| Career stats table | #4 | Hitter Master season rows |

### 🐛 oWAR display: 1 decimal place
**File:Line:** `src/pages/PlayerProfile.tsx:1508`
```tsx
{displayOWar != null ? displayOWar.toFixed(1) : "—"}
```
→ Change to `.toFixed(2)` (open todo #4).

### Skeleton loader
PP:627-654 uses `animate-pulse` — the documented Peyton exception per memory `feedback_skeleton_loader_exception`.

---

## 7. /dashboard/pitcher/:id  (Pitcher Profile — `src/pages/PitcherProfile.tsx`)

### Queries
| # | queryKey | File:Line | Source | Notes |
|---|---|---|---|---|
| 1 | `pitcher-profile-player` | PiP:339-400 | `players` + numeric/Pitching Master fallback | Storage-route support |
| 2 | `pitcher-profile-predictions` | PiP:494-507 | `player_predictions` | **⚠️ NO team-scope filter** |
| 3 | `pitcher-profile-master-seasons` | PiP:423-446 | `Pitching Master` | source_player_id OR ilike playerFullName |
| 4 | `pitcher-profile-season-stats` | PiP:404-416 | `season_stats` | dbRoute only |
| 5 | `pitcher-has-hitting` | PiP:449-463 | `Hitter Master` | AB ≥ 1, TWP detection |
| 6 | `pitcher-profile-pitch-arsenal` | PiP:546-645 | `pitcher_stuff_plus_inputs` (fallback `Pitch Arsenal`) | per pitch type, multi-season |
| 7 | `pitcher-profile-nil` | PiP:509-523 | `nil_valuations` | dbRoute only |

### UI mapping
| Section | Source | DB column |
|---|---|---|
| Hero | #1 + #3 (2026) | players.*, Pitching Master.* |
| Pitch Arsenal | #6 + masterRow | `pitcher_stuff_plus_inputs.{stuff_plus, whiff_pct, total_pitches}` |
| Pitching stats (IP/ERA/FIP/WHIP/K9/BB9/HR9) | #3 | `Pitching Master.{IP,ERA,FIP,WHIP,K9,BB9,HR9}` or `blended_*` |
| Projected pitching | #2 | `p_era, p_fip, p_whip, p_k9, p_bb9, p_hr9, p_rv_plus, p_war` STORED ✓ |
| Scouting grades | #2 internalPowerRatings useMemo (PiP:1277-1282) | `pitcher_whiff_score, pitcher_iz_whiff_score, pitcher_barrel_score, pitcher_chase_score, pitcher_ev_score, pitcher_bb_score` ✓ post-PR #101 domain-scoped columns |
| Risk Assessment | `assessPitcherRisk(...)` | Pitching Master metrics |

### 🐛 PitcherProfile missing team-scope filter
PP applies `customer_team_id.is.null OR customer_team_id.eq.<teamId>` (PP:249-271). PiP:494-507 does NOT. If both global and team-scoped rows exist, behavior is undefined (last row wins via `.find()` calls downstream).

**Fix template:** match PlayerProfile pattern + `pickPreferredPrediction(rows, effectiveTeamId)`.

### Josiah Overbeek TWP — analysis
- PlayerProfile reads scouting from **Hitter Master** raw columns — never touched by PR #101 split → CORRECT.
- PitcherProfile reads scouting from **player_predictions.pitcher_*_score** (PiP:1277-1282) — post-PR #101 ✓ CORRECT.
- **Most likely residual source of "wrong stats"**: PitcherProfile's missing team-scope filter (above) returning a hitter-variant row, OR career-stats table rendering. Spot check Overbeek on both pages to confirm. (Open todo #2.)

---

## 8. /dashboard/team-builder (Target Board tab)

Target Board surfaces `useTargetBoard()` data passed as prop; no new queries. Per-row projection reuses `playerProjection()` from useTeamBuilderSimulation. STORED ✓.

---

## 9. Secondary pages

| Page | Route | Source | Notes |
|---|---|---|---|
| AdminDashboard | `/admin` | 8 useQuery hooks: storage, power, exit positions, conf stats, park factors, pitch arsenal imports | Admin tools |
| HighFollowList | `/high-follow` | `useHighFollow` + Hitter/Pitching Master + prediction projections | Sortable by p_avg/p_era/oWAR/NIL |
| NilValuations | (route TODO line 1) | `nil_valuations` + players FK + predictions | Unreachable currently |
| Teams | `/teams` | `useTeamsTable` + park factors | Admin CRUD |

---

## 10. KNOWN CONCERN ROLL-UP

| # | Concern | Status | File:Line |
|---|---|---|---|
| 1 | TPS pitcher "Missing inputs" during load | Root cause confirmed; needs `!authLoading` gate | TP.tsx:1438-1450 (pitcher), 1400 (hitter) |
| 2 | Josiah Overbeek TWP | Likely caused by PiP missing team-scope filter (#3 below), NOT PR #101 column split | PiP:494-507 |
| 3 | TPS pitcher search missing pitchers | Caused by PR #111 `usePitchingSeedData` IP threshold 1→10 | usePitchingSeedData.ts:76-105 |
| 4 | Player Profile oWAR 2nd decimal | `.toFixed(1)` → `.toFixed(2)` | PP:1508 |
| 5 | Landon Hairston TB mismatch | Code path reads stored row raw — issue is in the STORED row, not client. Need DB inspection: hitter_depth_role + projected_pa + updated_at for player_id × Arizona State customer_team_id | UTBS:628-653 (code is correct; data is suspect) |
| 6 | TB depth auto-assign regression | Seeded from `defaultHitterDepthRoleFromPa(seedHitterAb)` / `defaultPitcherDepthRoleFromIp(pmRec?.ip)`. Likely cause: PA/IP map resolving to null → falls back to lowest-tier default | TeamBuilder.tsx:1500-1516 |
| 7 | PitcherProfile missing team-scope | Confirmed | PiP:494-507 |

---

## 11. AUDITOR NOTES

- No code edits made. No migrations run. No git push.
- Working tree clean on `audit/full-page-data-flow`.
- This audit is a snapshot of staging at SHA 2b9aa9d. PR #112 merging to main does not change the code paths described above.

---

## 12. PORTAL SCRAPE — 2026-06-04 09:10

**CSV:** `transfers_2026-06-04-0910.csv`
**Source:** Verified Athletics (auto pull via `scripts/auto_pull_portal.sh`)
**Total CSV rows:** 500
**D1 rows:** 413
**Result:** 343 matched (0 committed, 0 withdrawn, 1 manual-held), **70 unmatched**, 0 arrived (cleared), 0 stale-skipped
**Import duration:** 39.5s
**Cascade:** none (no master / Stuff+ / conference imports queued)
**Class Data CSV:** queued but Phase D importer not yet wired — skipped

