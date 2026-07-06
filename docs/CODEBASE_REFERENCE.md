# RSTR IQ — Codebase Reference

Persistent reference for future Claude sessions. Read this FIRST before any TB / projection / scouting work.
Generated 2026-06-15. Source paths assume repo root `~/dev-main/diamond-predictor-66`.

---

## 1. PROJECT AT A GLANCE

RSTR IQ is a college baseball player-development + roster-planning copilot. Vite + React + TS + shadcn + Tailwind on Vercel; Supabase backend; Claude Haiku 4.5 for bulk AI scouting reports. Eight customer teams in prod (Arizona State, Arkansas, Florida Atlantic, Georgia, Kansas, Penn State, Stetson, TCU).

Two divisions live: `D1` and `NJCAA_D1`. JUCO is excluded from most user-facing surfaces and AI scouting.

Primary surfaces:
- **Overview** (`/dashboard`) — landing dashboard.
- **Player Dashboard** (`/dashboard/returning`) — full returning-roster table (`ReturningPlayers.tsx`).
- **Transfer Portal** (`/dashboard/portal`) — `TransferPortal.tsx`.
- **Team Builder** (`/dashboard/team-builder`) — `TeamBuilder.tsx`; 4 visible tabs (roster, target-board, depth, analytics) + 1 hidden (compare).
- **Targets** (`/dashboard/targets`) — `Targets.tsx`; two subtabs (target-board for individual eval, high-follow watchlist).
- **Player / Pitcher Profile** (`/dashboard/player/:id`, `/dashboard/pitcher/:id`).
- **Compare** (`/dashboard/compare`) — `PlayerComparison.tsx`.
- **War Room**, **Admin**, **Savant** (internal eval tool, lazy).

`CURRENT_SEASON = 2026`, `PROJECTION_SEASON = 2027`.

---

## 2. WHERE THE MATH LIVES

**RULE OF THUMB:** Every projection formula exists in at least TWO places — a `src/lib/*` module AND the precompute edge function `supabase/functions/process-precompute-jobs/index.ts`. When you change one, you MUST change the other in the same PR. See §6 invariant on math duplication.

### Hitter — transfer projection
- Canonical lib: `src/lib/transferProjection.ts:72` `computeTransferProjection`
- Input builder: `src/lib/buildTransferProjectionInputs.ts` (whole file; class+devAgg multiplier at module bottom)
- Postprocess: same file, `applyTransferPostprocess` — returns `owar` using `actualPa ?? 260`
- Worker copy: `supabase/functions/process-precompute-jobs/index.ts:205-256` (computeTransferProjection), `:308-489` (buildHitterTransferInputs + applyTransferPostprocess). Worker does NOT include `owar` in postprocess; instead recomputes downstream via `computeHitterOWar(pWrcPlus, hitterDepthRole)` at `:1130`.
- **Known drift:** worker uses `classFromYear(player.class_year)` to default freshmen to `FS` (0.03); lib defaults null `class_transition` to `SJ` (0.02). Edit `buildTransferProjectionInputs.ts` to port `classFromYear` over.

### Hitter — returner projection
- `src/lib/predictionEngine.ts:494` `recalcReturner`
- pAvg/pObp/pIso math: `:538-565` (lines vary across versions; verify before edit).
- ISO power-blend constant `0.7` for canonical lib; `predictionEngine.recalcTransfer:645` hardcodes `0.3` — **drift candidate**, fix not yet shipped.

### Hitter — wRC+ / oWAR
- `wRC+ = ((0.45·OBP + 0.30·SLG + 0.15·AVG + 0.10·ISO) / 0.364) · 100`
- `oWAR = ((((wRC+ − 100) / 100) · PA · 0.13) + (PA / 600 · 25)) / 10`
- Canonical: `src/savant/lib/wrcPlus.ts` + `src/savant/lib/war.ts:7`
- Duplicates: `src/lib/playerCalcs.ts:15` `computeOWarFromWrcPlus`; `src/lib/depthRoles.ts:241` `computeHitterOWar` (uses depth-role PA, not 260 default); edge fn `index.ts:885` `computeHitterOWar`.
- **Three PA defaults across copies:** 260 (playerCalcs, savant), 215 (depthRoles when no role), depth-role-derived (depthRoles + worker). Reconcile before changing.

### Hitter — power ratings (PR+) from sub-metrics
- `src/lib/powerRatings.ts:94` `computeHitterPowerRatings`
- Weights at `:121-126` (baPower 0.4/0.25/0.2/0.15; obpPower 0.35/0.2/0.15/0.1/0.15/0.05; isoPower 0.45/0.3/0.15/0.05/0.05). Worker mirror at `index.ts:169-195`.

### Hitter — JUCO outlier regression
- `src/lib/transferWeightDefaults.ts:116` `applyJucoOutlierRegression`; config at `:134-138`.
- Worker mirror: `index.ts:128-134` + `JUCO_REGRESSION_CONFIG` at `:69-73`.

### Pitcher — transfer projection
- Canonical lib: `src/lib/transferPitcherProjection.ts:322` `computeTransferPitcherProjection`
- projectLower at `:109-149`; projectHigher `:152-186`; calcPitchingPlus `:35`; applyRoleTransitionAdjustment `:48`.
- pRV+ composite weights: 0.30 FIP / 0.25 ERA / 0.15 WHIP / 0.15 K9 / 0.10 BB9 / 0.05 HR9 at `:413-422`.
- pWAR: `:424-427`. Market value: `:441-442`.
- Lib transfer DOES NOT apply class+devAgg.
- Worker copy: `index.ts:661-706` (computeTransferPitcherProjection), `:708-768` (applyPitcherPostprocess — APPLIES class+devAgg AFTER role transition). **This is the load-bearing semantic drift** — see §6.

### Pitcher — returner projection
- `src/lib/pitcherProjection.ts:370` `computePitcherProjection`
- `projectPitchingRate` at `:125` (class+devAgg applied to BLENDED last-stat, BEFORE role transition).
- `PITCHING_POWER_RATING_WEIGHT = 0.7` at `:17`; `PITCHING_DEV_FACTOR = 0.06` at `:18`.
- pRV+ aggregation `:469-476`. pWAR `:479-482`.
- Power-rating compute from scouting: `:296-352` `computePitchingPrPlusFromScores`.

### Pitcher — pWAR / market value canonical
- `pWAR = (((pRV+ − 100) / 100) · (IP/9) · 7.11 + (IP/9 · 1.5)) / 10`
- `src/lib/depthRoles.ts:151` `computePitcherWar`
- Market: `depthRoles.ts:200` `computePitcherMarketValue` = `pWar * $25k * tier_mult * pvf` floored at 0.
- **Savant uses different constants** — `src/savant/lib/war.ts:37` defaults `r_per_9 = 5.5`, `repl = 2.5`, `rpw = 10`. Per CLAUDE.md the 5.5/2.5/10 is the "benchmark" version. Pitching equations defaults (`src/lib/pitchingEquations.ts:193-309`) lock in 7.11/1.5/10.

### Pitcher — power ratings
- `src/lib/powerRatings.ts:270` `computePitchingPowerRatings`; weights `:246-253`; defaults `:144-158`. Worker mirror `index.ts:498-528` `PITCHING_EQ_DEFAULTS`.

### NIL — budget share + player score
- `src/pages/team-builder/hooks/useTeamBuilderSimulation.ts:1575` `projectedBudgetShareForPlayer`
  - Denominator floor at `:1639-1641`: `RAW_WAR_BENCHMARK = 33`, `adjustedBenchmark = 33 * programTierMultiplier`, `denominator = max(nonOverriddenScore, adjustedBenchmark)`.
  - Returner+target inclusion logic at `:1585-1597` (off-roster targets see their own "what if I were the next add" share).
- `src/lib/nilProgramSpecific.ts:63` `calcPlayerScore = owar * ptm * pvm`.
- `nilProgramSpecific.ts:78` `calcProgramSpecificAllocation` (roster floor 68, separate use).
- Position multipliers: `nilProgramSpecific.ts:51` (C/SS/CF 1.3; 2B/3B/LF/RF/OF 1.1; 1B/DH/UT 1.0; BENCH 0.8).
- Tier multipliers: `:3-10` `DEFAULT_NIL_TIER_MULTIPLIERS` (sec 1.5 / p4 1.2 / bigTen 1.0 / strongMid 0.8 / lowMajor 0.5 / juco 0.35).

### Transfer weight defaults
- `src/lib/transferWeightDefaults.ts:9-47` `TRANSFER_WEIGHT_DEFAULTS` (canonical).
- JUCO overrides: `:70-93` hitter, `:184-221` pitcher.
- JUCO district map: `:260-271` `JUCO_DISTRICT_CONFERENCE_ID`; `:280-291` `JUCO_DISTRICT_HTP_OVERRIDE`.
- Worker copies entire block at `index.ts:39-112`.

### Pitching equation weights
- `src/lib/pitchingEquations.ts:311` `readPitchingWeights()` — merge order: DEFAULTS → Supabase cache → localStorage → legacy migration (`:457-471`) → QA lock-in (`:475-481`).

### depth_role math
- `src/lib/depthRoles.ts:43` `hitterDepthRoleMultiplier` (cornerstone 1.15, everyday 1.0, platoon 0.7, utility 0.4, bench 0.15).
- `:65` `paForHitterDepthRole` (245/215/145/85/25).
- `:90` `defaultHitterDepthRoleFromActualPa` (PA thresholds 220/130/50/15).
- `:104` `pitcherExpectedIp` per depth role.
- `:124` `pitcherRoleFromDepthRole`.

### Role-transition adjustment (SP↔RP)
- `src/lib/transferPitcherProjection.ts:48` `applyRoleTransitionAdjustment` (canonical).
- TB live simulation re-implements at `useTeamBuilderSimulation.ts:1338-1378` with `rtRoleCurve` — verify in lockstep before edit.

### TB live-simulation overlay (depth × devAgg × role transition)
- `src/pages/team-builder/hooks/useTeamBuilderSimulation.ts:1282-1467` `playerProjection`
- Hitter precomputed overlay at `:665-703` (`overlayScale = depthScale * devAggScale`).
- Hitter `devAggClassAdj` at `:683, :1447` is missing the `JS` branch (folds JS → 0.02 default). Pitcher path has explicit JS=0.015 at `:1318, :1558`.
- Pitcher overlay at `:1381-1412`: `pwar = storedPWar * ipScaleForRow * pvfRatioForRow * devAggScalePitch`.

---

## 3. SCHEMA QUICK REFERENCE

Only columns we actually query. UUID = `gen_random_uuid()`.

### `players` (master roster)
`id (uuid)`, `source_player_id (text, TruMedia id)`, `first_name`, `last_name`, `position`, `team_id (uuid FK)`, `source_team_id (text)`, `is_twp (bool)`, `class_year`, `division ('D1' | 'NJCAA_D1')`, `conference`, `bats_hand`, `throws_hand`, `data_status`. NO `season`, NO `full_name`.

### `player_predictions` (THE central table)
`id`, `player_id`, `season`, `status ('active'|'departed'|'leaving')`, `variant ('regular'|'precomputed')`, `model_type ('returner'|'transfer')`, `customer_team_id (uuid|null)`, `updated_at`,
slash: `p_avg`, `p_obp`, `p_slg`, `p_ops`, `p_iso`, `p_wrc_plus`,
pitcher: `p_era`, `p_fip`, `p_whip`, `p_k9`, `p_bb9`, `p_hr9`, `p_rv_plus`,
WAR/$: `o_war`, `p_war`, `market_value`, `twp_hitter_market_value`, `twp_pitcher_market_value`,
role: `pitcher_role`, `projected_ip`, `projected_pa`,
scouting scores: `barrel_score`, `hitter_barrel_score`, `pitcher_barrel_score`, `ev_score`, `contact_score`, `chase_score`, `stuff_score`, `whiff_score`, `bb_score`.

**Read precedence everywhere** (`src/lib/teamScopedPredictions.ts:34` `pickPreferredPrediction`):
1. `customer_team_id = effectiveTeamId AND variant = 'precomputed'`
2. `customer_team_id IS NULL AND variant = 'regular'`

### `player_prediction_internals`
`prediction_id`, `avg_power_rating`, `obp_power_rating`, `slg_power_rating`, and raw `era_power_rating` / `fip_power_rating` / `whip_power_rating` / `k9_power_rating` / `bb9_power_rating` / `hr9_power_rating` (raw, NOT PR+). **Trap:** stored PR+ for ERA/FIP/WHIP comes from `Pitching Master.era_pr_plus/fip_pr_plus/whip_pr_plus`, NOT from internals.

### `Hitter Master` / `Pitching Master`
Per-season stat masters. Keyed by `source_player_id` (string) and `Season` (column literal). Pitching Master has `era_pr_plus`, `fip_pr_plus`, `whip_pr_plus` (K9/BB9/HR9 PR+ NOT stored — live-computed). IP filter on `usePitchingSeedData` is 10 IP minimum (PR #111, was 1).

### `Conference Stats`
Per-conference per-season aggregate. Key columns: `conference`, `conference_id`, `avg_plus`, `obp_plus`, `iso_plus`, `stuff_plus`, `hitter_talent_plus`, era/fip/whip/k9/bb9/hr9 `_plus`. Resolved via `resolveConferenceStats` with alias fallback.

### `Park Factors` (uppercase canonical)
`team_id`, `team_name`, per-handedness `ba_*`, `obp_*`, `hr_*`, etc. Resolver: `resolveTransferParkFactor` (UUID-first, name fallback).

### `Teams Table`
`id`, `name`, `abbreviation`, `fullName`, `conference`, `conference_id`, `source_team_id`, `park_factor`, `division`. The `abbreviation` is primary display name.

### `team_builds` + `team_build_players`
- `team_builds`: `id`, `name`, `customer_team_id`, `total_budget`, `depth_assignments (jsonb)`, `depth_placeholders (jsonb)`.
- `team_build_players`: `build_id`, `player_id`, `source`, `position_slot`, `depth_order`, `nil_value`, `roster_status`, `included_in_roster (NOT NULL DEFAULT true)` (migration `20260614120000_team_build_players_included_in_roster.sql`), `production_notes (jsonb)` carries `depth_role` / `dev_aggressiveness` / `class_transition` via `serializeBuildPlayerMeta`.

### `target_board_picks`
`customer_team_id`, `player_id`, `added_at`, `priority` (planned, currently localStorage-backed in `TargetBoardSubtab`).

### `high_follow`
`customer_team_id`, `player_id`, `added_at`.

### `nil_valuations`
Global NIL fallback (per-player). Read via `useNilValuation` hook (2h staleTime).

### `team_war_snapshots`
Per `(source_team_id, season)`: `total_war`, `lineup_owar`, `rotation_pwar`, `bullpen_pwar`, `national_seed_rank`. Seeded by `supabase/queries/seed_team_war_snapshots_2025.sql`.

### `equation_weights` + `customer_team_equation_overrides`
Admin equation tuning. `loadEquationWeightsMap` merges.

### `model_config`
Legacy + admin UI settings (read by `loadPitchingPowerEq` for `p_*` rows).

### `ai_scouting_reports` (planned migration `20260528000000_ai_scouting_reports.sql`)
`(id, player_id, side, archetype_id, body, model, input_hash, generated_at)` UNIQUE `(player_id, side)`.

### `pitcher_stuff_plus_inputs` / `pitcher_stuff_plus_ncaa`
Per-pitch per-hand inputs and reference NCAA baselines. Future: `(pitch_type, hand, season, division)` key.

---

## 4. PAGE MAP

| Route | Component | Reads | Math: live vs stored |
|---|---|---|---|
| `/dashboard` | `Dashboard.tsx` | `player_predictions` via `dedupePreferredPerPlayer` + `Hitter Master` | Stored. |
| `/dashboard/returning` | `ReturningPlayers.tsx` | predictions, Hitter/Pitching Master, season_stats | Stored. Custom sort path can force JS-side full-table sort. |
| `/dashboard/portal` | `TransferPortal.tsx` | `players`, predictions, masters, conf stats, park factors | **Live transfer compute when no precomputed row.** Two cold-load "missing inputs" gating bugs at `:1400` (hitter) and `:1438-1450` (pitcher) — need `!authLoading` gate. |
| `/dashboard/team-builder` | `TeamBuilder.tsx` (3353 lines) | predictions, builds, returners, target board | **Live overlay** via `useTeamBuilderSimulation`. Class/devAgg/depth/role-transition knobs recompute on top of stored values. |
| `/dashboard/targets` | `Targets.tsx` (wrapper, 52 lines) | URL `?tab=` | None. |
| `/dashboard/targets?tab=target-board` | `targets/TargetBoardSubtab.tsx` (807 lines) | `useTargetBoard` + direct `player_predictions` query | **Stored only.** dnd-kit drag reorder backed by localStorage (demo; → `target_board_picks.priority`). |
| `/dashboard/targets?tab=high-follow` | `HighFollowList.tsx` (embedded; 585 lines) | `useHighFollow`, masters, predictions | Mostly stored. Pitcher live `computePitcherProjection` for fallback inside `pitcherProjectionMap`. Stored `p_era` overrides live. |
| `/dashboard/high-follow` | `HighFollowList.tsx` (standalone) | same as above | same as above. Legacy bookmark route preserved. |
| `/dashboard/player/:id` | `PlayerProfile.tsx` | predictions, Hitter Master, internals, season_stats | Stored-first (Phase 4b). `applyDevScale(regularPred?.p_*)`. Progressive skeleton on shell (the documented exception). |
| `/dashboard/pitcher/:id` | `PitcherProfile.tsx` | predictions, Pitching Master, conf stats | Stored-first (Phase 4a). ⚠️ Missing team-scope filter at `:494-507` — last-row-wins via `.find()`. |
| `/dashboard/compare` | `PlayerComparison.tsx` | predictions, internals, conf stats, parks | Live transfer compute. |
| `/dashboard/war-room` | `WarRoom.tsx` | misc | Mostly stored. |
| `/dashboard/admin` | `AdminDashboard.tsx` | various | RoleGuard. |
| `/dashboard/admin/teams` | `AdminTeams.tsx` | `customer_teams` | superadmin. |
| `/dashboard/admin/users` | `AdminUsers.tsx` | `user_*` | team_admin+. |
| `/auth` | `Auth.tsx` | supabase auth | — |
| `/savant/*` | lazy chunk (`SavantRoute`) | own queries | Email allowlist gate. |

### TeamBuilder tabs
- `roster` → `RosterTab.tsx` (335 lines) — returning roster + freshman intake.
- `target-board` → `TargetBoardTab.tsx` (242 lines) — **roster-fit** lens (different from `/targets` page).
- `compare-hidden` → `CompareTab.tsx` (482 lines) — **DEAD UI** (no TabsTrigger; `className="hidden"` at TeamBuilder.tsx:3302).
- `depth` → `DepthTab.tsx` (174 lines) — diamond + rotation/relievers stacks.
- `analytics` → `AnalyticsTab.tsx` (1085 lines) — year-over-year, championship benchmarks, WAR-by-position.

### TB TargetBoardTab vs Targets-page TargetBoardSubtab — DO NOT CONFUSE
| | TB TargetBoardTab | Targets/TargetBoardSubtab |
|---|---|---|
| Lens | Roster-fit (depth_role + dev_agg + position-change apply) | Individual eval (raw stored projection) |
| Data | BuildPlayer props from `useTeamBuilderSimulation` | `useTargetBoard()` + direct supabase query |
| Drag reorder | none | dnd-kit + localStorage |
| Position groups | none | Hitter Overall vs By Position (C/IF/OF) collapsibles |
| Budget context | yes | no |
| Risk / Dev Agg / Depth / Position-change columns | yes | no |
| Scouting mini-boxes | no | yes (Brl/EV/Con/Chs hitter; Stf+/Whf/BB/Brl pitcher) |

---

## 5. HOOKS MAP

### Auth / scoping
- `useAuth()` — `src/hooks/useAuth.tsx`. Returns `user, signOut, roles, isSuperadmin, userTeamRole, effectiveTeamId, isLoading (authLoading)`. `user_roles` + `user_team_access` parallelized via `Promise.all`.
- `useEffectiveSchool()` — derives current school from team scoping.
- `RoleGuard` — wrapper for role-gated admin routes.
- `ProtectedRoute` — auth wrapper for `/dashboard/*`.

### Team Builder
- `useTeamBuilderData()` — `src/pages/team-builder/hooks/useTeamBuilderData.ts`. Returns ~30 fields: hitter/pitching stats, power ratings, exit positions, overrides, teams, conf stats, parks, target board, builds, returners, etc. Single fat hook destructured at `TeamBuilder.tsx:739`.
- `useTeamBuilderSimulation({...inputs})` — `useTeamBuilderSimulation.ts` (1865 lines). Returns: `playerProjection, projectedPlayerScore, projectedNilForPlayer, effectiveNilForPlayer, projectedBudgetShareForPlayer, projectedBudgetValue, calcTotals, rosterTableTotals, positionTableTotals, pitcherTableTotals, targetPositionTableTotals, targetPitcherTableTotals, hitterEligible, pitcherEligible, positionPlayers, pitchers, targetPositionPlayers, targetPitchers, totalEffectiveNil, totalRosterPlayerScore, budgetRemaining, pitchingTierMultipliers, pitchingPvfForRole, simulateTransferProjection, computePitcherPwar, computeReturnerPitchingProjection, isProjectedStatus, ...`. THE math engine for TB.
- `useLoadBuild({...refs})` — extracts build-load logic out of TB.

### Targets / High Follow
- `useTargetBoard()` — returns `{ board, isLoading, addToBoard, removePlayer, isOnSupabaseBoard }`.
- `useHighFollow()` — returns `{ list, isLoading, addToList, removePlayer }`.

### Stored predictions
- `useNilValuation(playerId)` — `src/hooks/useNilValuation.ts`. staleTime 2h, refetchOnWindowFocus false, explicit columns. Wired into PlayerProfile only (Dashboard/ReturningPlayers still inline).
- `pickPreferredPrediction(rows, effectiveTeamId)` — `src/lib/teamScopedPredictions.ts:34`.
- `dedupePreferredPerPlayer(rows, effectiveTeamId)` — `:59`.
- `applyTeamScopeFilter(query, effectiveTeamId)` — `:20`.

### Benchmarks / WAR
- `useTeamWarSnapshot(sourceTeamId, season)` — single-team snapshot.
- `useWarBenchmarks(season)` — conference champ benchmarks.
- `useNationalSeedBenchmark(season, range)` — e.g. `"1-8"` national seeds.
- `useAllTeamSnapshots(season)` — emulate-team picker source.

### Pitching / parks / conferences
- `usePitchingEquationWeights()` — Supabase + localStorage merge.
- `useParkFactors()` — `parkMap` for UUID/name lookups.
- `useTeamsTable()` — `teams`, `teamsByName`, `teamByKey`.
- `usePitchingSeedData()` — Pitching Master scan (IP ≥ 10 since PR #111).

### Misc
- `useToast()` — shadcn toaster.
- `useSearchParams()` — URL state for tab routing.

---

## 6. CRITICAL INVARIANTS

### 1. Stored-first reads (AUDIT_stored_vs_live_2026-05-24.md)
*"If a stored row exists → read it. If it does not → show '—' (null display). Do not live-recompute from raw stat inputs on any profile or dashboard surface."*
Permitted live compute: session-only overlays for depth role, dev agg, role transition (RP↔SP) on profile and TB pages. Anything else: stored. Dashboard, Player Profile (Phase 4b), Pitcher Profile (Phase 4a), Compare, Target Board subtab are stored-first. TB and TP simulator still apply session overlays.

### 2. Math duplication (feedback_precompute_math_duplication.md)
EVERY projection formula exists in `src/lib/*` AND `supabase/functions/process-precompute-jobs/index.ts`. Touch both in the same PR. Known live drifts:
- Worker applies class+devAgg to transfer pitchers via `applyPitcherPostprocess`; lib `transferPitcherProjection.ts` does not. TB live-recompute will disagree with stored precompute for any non-JUCO transfer pitcher whenever `dev_aggressiveness != 0` or `class_transition != SJ`.
- `predictionEngine.recalcTransfer:645` ISO power blend hardcoded `0.3`; canonical lib uses `0.7` default.
- Hitter freshman class default: worker uses `classFromYear` → `FS` (0.03); lib defaults null → `SJ` (0.02).

### 3. IDs over names (feedback_id_over_name.md)
All lookups must use `id` / `source_player_id` / `source_team_id` / `conference_id`. Name strings are display only. Two same-name players ARE in the DB. The portal-pull walk-through needs a name-mapping decision (see deferred work).

### 4. Two Supabase projects (project_supabase_projects.md)
- **staging**: `slrxowawbijbjrkozqlj` (`.env.local`)
- **prod**: `trbvxuoliwrfowibatkm` (`.env.production.local`)
- SQL: staging → test locally → prod. Don't conflate. Precompute scripts have safety guards (`AUDIT_stored_vs_live_2026-05-24.md`): refuse to write if URL looks like prod but `--prod` not passed.

### 5. Preview verification (feedback_preview_verification_loop.md)
Vercel preview URLs point at PROD Supabase. They are NOT useful for verifying staging-bound PRs. Use local dev for staging-bound; preview as gate for main-bound.

### 6. JUCO display invariants (PLAYBOOK_juco_display_invariants.md)
1. Stored only — read `p_avg/p_obp/p_slg/p_iso/p_ops/p_wrc_plus` directly. No live re-derivation. Null = blank.
2. Deterministic row order — explicit `ORDER BY customer_team_id DESC NULLS LAST, player_id ASC`, then dedupe Map.
3. Sort tie-break on `source_player_id.localeCompare()`.
4. Position filter at query — hitter excludes P/SP/RP/CL/LHP/RHP unless `is_twp=true`; pitcher mirror.
5. JUCO never goes through D1 engine. Branch on `division === 'NJCAA_D1'` before calling `recalcPitcher`/`recalcReturner`. Canonical passthroughs: `jucoReturnerProjection.ts`, `jucoReturnerPitcherProjection.ts`.
6. Conference resolution must apply `jucoDistrictNameFromConference()` + `JUCO_DISTRICT_CONFERENCE_ID` lookup.

### 7. Don't generate AI scouting reports for JUCO.

### 8. Workflow rules
- feature → staging → main (never direct).
- Don't auto-merge. Send PR link, Trevor merges in GH UI.
- Send SQL for paste; don't run TS write scripts unless told.
- TruMedia / Presto CSV via `npm run import:prod` direct.
- Plaintext for copy targets (creds/paths/URLs); clickable only for navigation.
- WhatsNewModal never uses em-dashes.
- Pull SQL distribution from prod first before tier/threshold tuning; never hand-tune.

### 9. Refactoring policy
Discover a function used in 2+ places? Extract to shared in the SAME PR and update both call sites. Don't fix one and leave the other. Exception: `addPlayerFromTargetSearch` in `TeamBuilder.tsx` (~540 lines, 3 interleaved async paths) — deferred until a 4th call site appears.

### 10. Hook extraction threshold
8+ closure deps AND 5+ logical sections → extract as `use*` hook with typed params.

### 11. UI rules
No spinners, sliding cursors, skeleton loaders, animated placeholders. ONE exception: PlayerProfile progressive skeleton. Brand colors: `#D4AF37` gold, `#070e1f` sidebar navy, `#A08820` darker gold. Status badges: IN PORTAL green, WATCHING gold. Oswald for branded headings; Inter body. Cursor-pointer + 150-300ms hover. Test 375/768/1024/1440.

### 12. UI/UX Pro Max + Stitch wins
Plugin/MCP are primary design decision makers. Search via `python3 skills/ui-ux-pro-max/scripts/search.py "<q>" --design-system -p "RSTR IQ"` before visual decisions. Persisted system at `design-system/rstr-iq/MASTER.md`.

### 13. tsc invocation
Use `./node_modules/.bin/tsc --noEmit`, NOT `npx tsc`. Staging→refactor merges always conflict on `TeamBuilder.tsx` — cherry-pick individual commits.

### 14. Testing
Run `npm test` (~2s) when touching: equation weights, precompute pipeline metrics, oWAR/pWAR/wRC+/projectPitchingRate, activating `.skip` regression tests. Files: `war.test.ts`, `playerCalcs.test.ts`, `pitcherProjection.test.ts`, `storedVsLive.test.ts`.

### 15. Locked constants (CLAUDE.md)
`runsPerPa=0.13`, `runsPerWin=10`, `PITCHING_POWER_RATING_WEIGHT=0.7`, `SAVANT_NCAA_WRC=0.364`, dev factor `0.06`, `p_whip_chase_pct_weight=0.05` (admin resets edits). 56-game proration cap **0.7–1.5**.

---

## 7. KNOWN BUGS AND DEFERRED WORK

| Issue | Owning memory file | Status |
|---|---|---|
| Budget-Share roster floor (33 × tier multiplier) | `project_budget_share_roster_floor.md` | **SHIPPED 2026-06-15** as hotfix. See `useTeamBuilderSimulation.ts:1641`. |
| Targets Tab redesign (rename High Follow → Targets; new Target Board subtab w/ DnD) | `project_targets_tab_redesign.md` | DEFERRED 2026-06-14. Branch after Peyton's TB work lands. |
| JUCO Pitcher FIP calibration (Yanke 9.53 → 13.32 — too aggressive) | `project_juco_pitcher_fip_calibration.md` | DEFERRED 2026-06-11. FIP path has no `dampFactor` (WHIP has 0.75). Consider adding `dampFactor=0.75` to FIP at `transferPitcherProjection.ts:378` AND `index.ts:674`. |
| Pitcher Profile missing team-scope filter | `PAGE_AUDIT_2026_06_04.md` #7 | Open. Likely cause of Josiah Overbeek TWP regression. |
| TPS pitcher cold-load "Missing inputs" flash | `PAGE_AUDIT_2026_06_04.md` #1 | Need `!authLoading` gate at `TransferPortal.tsx:1438-1450` + `:1400`. |
| TPS pitcher search missing pitchers (IP 1→10 threshold) | `PAGE_AUDIT_2026_06_04.md` #3 | Open after PR #111. |
| PlayerProfile oWAR `.toFixed(1)` should be `.toFixed(2)` | `PAGE_AUDIT_2026_06_04.md` #4 | Trivial fix at `PlayerProfile.tsx:1508`. |
| Landon Hairston stored row drift | `PAGE_AUDIT_2026_06_04.md` #5 | Re-precompute likely with correct `hitter_depth_role`. |
| TB depth auto-assign falls through to default when PA/IP null | `PAGE_AUDIT_2026_06_04.md` #6 | Open. |
| PitcherProfile RP↔SP role override not honored by worker | This doc §2 pitcher transfer | Worker uses `baseRole \|\| "SM"`; lib transfer accepts `ctx.roleOverride`. |
| `recalcTransfer` ISO power blend hardcoded 0.3 | `predictionEngine.ts:645` | Drift candidate vs canonical 0.7. |
| Hitter `devAggClassAdj` missing JS branch | `useTeamBuilderSimulation.ts:683, 1447` | Folds JS → SJ default 0.02. |
| `PITCHER_SLOT_ROLES` vs `PITCHER_SLOTS` mismatch | `TeamBuilder.tsx:57` vs `:2812-2826` | RP5–RP8 defined in role map but only RP1–RP4 + CL in slots. CL never auto-filled. |
| Dead UI: `compare-hidden` TabsContent | `TeamBuilder.tsx:3302-3313` | No TabsTrigger; never reachable. |
| Duplicated `addPlayerFromTargetSearch` transfer math | `TeamBuilder.tsx:2058-2599` | Deferred per refactoring policy (3 paths, need 4th to force extract). |
| Inline UUID regex 3× in TB despite `isUuid` import | `TeamBuilder.tsx:1967, 2317, 2616` | Minor cleanup. |
| `TeamRow` type missing `abbreviation`/`fullName` | `TeamBuilder.tsx:148` | Type drift; runtime fine. |
| TB↔Profile build pairing (auto-save TB knobs into profile) | `project_tb_profile_build_pairing.md` | DEFERRED 2026-06-09. Schema + UX work. |
| TB TWP search add still broken on prod | `project_tomorrow_tb_twp_search.md` | DEFERRED 2026-06-08. Reproduce + fix first thing next session. |
| Slot values upcoming | `project_slot_values_upcoming.md` | Pre-scaffold schema + importer (ABS pattern). |
| Walk portal unmatched review (same-name policy) | `project_next_session_priorities_2026_06_01.md` | One-time link vs persistent name-mapping. |
| Code out TPS; replace with Target Board sidebar | `project_next_session_priorities_2026_06_01.md` | Hover-preview profile, PDF export, stats+scouting focus, no dev_agg/position. |
| Player dashboard load audit (still slow post-Peyton) | `project_next_session_priorities_2026_06_01.md` | Priority #1 next session. |
| ABS stats Georgia-only | `project_next_session_priorities_2026_06_01.md` | Open. |
| Pitcher IP < 5 noise floor (constants defined, code not wired) | `project_pitcher_ip_floor.md` | Open. |
| Savant percentile blend default for pullback pitchers | `project_savant_percentile_blend.md` | TODO with `*combined footnote`. |
| Profile page TODOs (team abbrev in career stats, pin projections, blended-everywhere) | `project_profile_todos.md` | Open. |
| Class adjustment for portal pitchers | `project_pending_class_adj_portal.md` | Needs adding to both portal and TB. |
| Phase 4d TB/TP stored-first | `AUDIT_stored_vs_live_2026-05-24.md` | Blocked on Trevor sync. `.skip` tests activate when ready. |
| Class-transition multipliers don't apply to returner pitchers | `PAGE_AUDIT_2026_06_04.md` | Coach override on returner pitcher ignored until remove + re-add. |

---

## 8. RECENT CHANGES (2026-06-14 → 2026-06-15)

### 2026-06-15 — Budget-Share Roster Floor HOTFIX
- `useTeamBuilderSimulation.ts:1639-1641`: floored denominator at `RAW_WAR_BENCHMARK (33) × programTierMultiplier`. Off-roster target toggle no longer inflates per-player share. Tier multiplier cancels (same budget → same numbers across tiers); position premium survives in numerator only.
- Memory: `project_budget_share_roster_floor.md`.

### 2026-06-14 — `included_in_roster` column
- Migration `20260614120000_team_build_players_included_in_roster.sql`: ADD COLUMN `included_in_roster boolean NOT NULL DEFAULT true`; backfill `source='portal'` rows → false.
- Type added to `BuildPlayer` at `TeamBuilder.tsx:104`.
- New target adds default `false` at three add paths: `:2117` (seed hitter), `:2338` (storage pitcher), `:2495` (standard DB).
- Returners + existing targets default `true` on save (`:1903`).
- `isOnRoster` filter at `:2859-2861` gates depth assignment eligibility.
- `countsTowardRoster` at `useTeamBuilderSimulation.ts:1477-1480`.

### 2026-06-14 — Targets page launch
- New route `/dashboard/targets` → `Targets.tsx` wrapper.
- Two subtabs: `target-board` (`TargetBoardSubtab.tsx` 807 lines, individual eval lens, dnd-kit drag reorder backed by localStorage, position-group collapsibles) and `high-follow` (`HighFollowList.tsx` embedded mode).
- Legacy `/dashboard/high-follow` preserved for bookmarks (`App.tsx:99`).
- Sidebar item "Targets" added with Star icon (DashboardLayout `navItems:26-34`); no separate High Follow entry.
- Targets tab redesign deferred (`project_targets_tab_redesign.md`).

### 2026-06-14 — Barrel score split for hitters/pitchers
- `TargetBoardSubtab.tsx:123-125, 258, 528, 641`: `pred?.hitter_barrel_score ?? pred?.barrel_score` (hitter render), `pred?.pitcher_barrel_score ?? pred?.barrel_score` (pitcher render). Prefixed-or-fallback pattern.

---

## 9. HIGHEST-RISK CHANGE AREAS

A 1-line edit in any of these can break 5+ surfaces. Order: highest impact first.

### A. `src/lib/transferPitcherProjection.ts` constants/formulas
**Breaks:** TP, TB (target adds), PlayerComparison, PitcherProfile precompute, edge function (drift), all NIL/market-value reads.
**Test:** `npm test pitcherProjection storedVsLive`. Verify worker `index.ts:661-768` in lockstep. Cherry-pick Yanke (JUCO) + a SEC SP + a transfer RP and diff stored vs live.

### B. `useTeamBuilderSimulation.ts` overlay math (`playerProjection`, `projectedBudgetShareForPlayer`, `projectedNilForPlayer`)
**Breaks:** TB roster, target board, analytics, depth, budget share, NIL caps. The 33 × tier benchmark touches every projected-status row.
**Test:** Open TB on TCU + Stetson + Arkansas. Toggle off-roster targets, change dev agg, change depth role. Confirm Total WAR, Budget Used, per-row Actual Value all stable.

### C. `supabase/functions/process-precompute-jobs/index.ts` constants
**Breaks:** ALL stored precomputed rows. Re-precompute is slow (`PRED_ID_BATCH=200`, `UPSERT_BATCH=500`). Drift vs lib creates Profile-vs-Dashboard mismatches.
**Test:** Re-fire one customer team precompute; spot-check 5 random hitters + 5 pitchers stored row vs lib live re-compute. Run `storedVsLive.test.ts`.

### D. `src/lib/teamScopedPredictions.ts` `pickPreferredPrediction`
**Breaks:** Dashboard, ReturningPlayers, TPS, TB, all profile pages. Every page that reads `player_predictions` routes through this.
**Test:** Login as Arkansas vs login as Georgia vs no-team superadmin; same player should show team-specific row when present, regular row otherwise.

### E. `src/lib/depthRoles.ts` multipliers / PA / IP maps
**Breaks:** oWAR / pWAR everywhere (depth role overlay scales these).
**Test:** Snapshot a known Cornerstone (mult 1.15) vs Everyday (1.0) on TB; verify projection ratio = 1.15.

### F. `src/lib/nilProgramSpecific.ts` tier / position multipliers
**Breaks:** Budget share, market value (pitcher + hitter), TB allocation, Compare NIL.
**Test:** Swap a player from 2B → SS (1.1 → 1.3 mult); expect ~18% NIL bump.

### G. `src/lib/pitchingEquations.ts` `readPitchingWeights` merge order
**Breaks:** All pitcher math everywhere. Admin localStorage write can silently override DEFAULTS.
**Test:** Clear localStorage `admin_pitching_equations_v1`; verify defaults take effect; check QA lock-in at `:475-481` not bypassed.

### H. `src/savant/lib/war.ts` constants (5.5/2.5/10 vs 7.11/1.5/10)
**Breaks:** Savant numbers, `team_war_snapshots` seed query, Analytics benchmarks.
**Test:** Reseed `team_war_snapshots` via `supabase/queries/seed_team_war_snapshots_2025.sql`; spot-check vs CLAUDE.md locked formulas.

### I. `TeamBuilder.tsx` auto-seed effect (`:1479-1645`) / draft persist (`:1778-1815`) / restore (`:1688-1755`)
**Breaks:** Per-team draft isolation, returner→BuildPlayer hydration, TWP dual-row spawn, depth chart restore.
**Test:** Switch between three teams in sequence; verify drafts don't leak; create + delete a build; switch teams while build loaded.

### J. `TeamBuilder.tsx:2056-2599` `addPlayerFromTargetSearch`
**Breaks:** All target adds (seed hitter, storage pitcher, DB path), TWP dual-row spawn, target board sync.
**Test:** Add a TWP, a JUCO transfer, a storage-only pitcher, and a seeded freshman. Confirm dedupe and `included_in_roster=false` default.

---

## 10. WHEN TO CONSULT WHICH MEMORY FILE

| Task | Memory file |
|---|---|
| Touching budget share / NIL allocation | `project_budget_share_roster_floor.md` |
| Target board / High Follow redesign | `project_targets_tab_redesign.md` |
| JUCO pitcher projection numbers off | `project_juco_pitcher_fip_calibration.md` + `PLAYBOOK_juco_display_invariants.md` |
| Any display regression on JUCO surface | `project_juco_display_playbook.md` → `PLAYBOOK_juco_display_invariants.md` |
| D2 / NAIA / HS player one-off PDF | `project_d2_pdf_workflow.md` + `scripts/README_d2_pdf.md` |
| Slot value data prep | `project_slot_values_upcoming.md` |
| TB pitcher overlay (depth + dev_agg + SP↔RP) | `project_tb_pitcher_knobs_landed.md` (PR #122) |
| TB ↔ Profile build pairing | `project_tb_profile_build_pairing.md` |
| TB TWP search still broken | `project_tomorrow_tb_twp_search.md` |
| Staging vs prod, where to send SQL | `project_supabase_projects.md` + `feedback_send_sql_to_paste.md` |
| Sidebar terminology (Player Dashboard vs Overview vs Profile) | `feedback_dashboard_vs_profile_terminology.md` |
| Next session priorities | `project_next_session_priorities_2026_06_01.md` |
| Skeleton/loader UI decision | `feedback_skeleton_loader_exception.md` + CLAUDE.md UI rules |
| Launch state / what shipped 2026-05-31 | `project_launch_2026_05_31.md` |
| AI scouting scrape / framework | `project_ai_scouting_reports.md` + `SCOUTING_REPORT_FRAMEWORK_2026_05_26.md` |
| Empirical pitch-shape thresholds (4S FB, Sinker, offspeed) | `project_pitch_shape_thresholds_2026_05_27.md` |
| Competition-translation caveats (chase travels? whiff? Stuff+?) | `project_competition_translation_rules_2026_05_28.md` |
| Scouting archetypes / voice rules | `project_scouting_framework_master_2026_05_26.md` |
| Data-driven tier thresholds | `feedback_data_driven_thresholds.md` |
| Risk model design | `project_risk_assessment_model.md` + `feedback_risk_assessment_principle.md` + `feedback_risk_asymmetry.md` + `feedback_chase_contact_risk.md` |
| Post-launch punchlist | `project_post_launch_punchlist_2026_05_24.md` |
| TWP positions reference | `reference_twp_positions_2026.md` |
| Pre-promotion verification | `project_promote_check_dempsey.md` |
| Workflow (push order, no auto-merge, etc.) | `feedback_staging_before_main.md` + `feedback_csv_import_prod_direct.md` + `feedback_send_sql_to_paste.md` + `feedback_no_clickable_links.md` |
| Eager precompute reading / market value drift | `project_eager_precompute_market_value_drift.md` |
| Target Board add defaults (everyday vs utility) | `project_target_board_add_defaults.md` |
| Precompute math duplication | `feedback_precompute_math_duplication.md` |
| Preview URL pitfall | `feedback_preview_verification_loop.md` |
| Highlight-after-resort UX | `feedback_highlight_after_resort.md` |
| Repo paths | `project_repo_paths.md` (lives at `~/dev/diamond-predictor-66` per memory; verify `~/dev-main` working tree) |
| Players schema reference | `reference_schema_players.md` |
| Dashboard docs (all 8 pages breakdown) | `project_dashboard_docs.md` |
| Demo school lock | `feedback_demo_school_lock.md` |
| Risk audit (most recent) | `RISK_AUDIT_2026_05_31.md` + `RISK_BUCKETS_2026_06_01.md` |
| Page-by-page audit | `PAGE_AUDIT_2026_06_04.md` |
| Performance audit (bundle / queries / staleTime) | `PERF_AUDIT_2026_06_01.md` |
| Stored vs live audit + No-Fallback Rule | `AUDIT_stored_vs_live_2026-05-24.md` |
| Stored derived values plan (Phase 1-6) | `stored-derived-values-plan.md` |
| JUCO architecture decisions | `juco-architecture.md` |
| TruMedia pipeline (designed, not shipped) | `TRUMEDIA_PIPELINE.md` |
| Analytics / PostHog | `ANALYTICS_SETUP_2026_06_02.md` |
| Historic projection formulas | `PROJECTION_FORMULAS.md` |

---

## Appendix — File Index (most-touched)

- `src/pages/TeamBuilder.tsx` — 3353 lines, hottest file.
- `src/pages/team-builder/hooks/useTeamBuilderSimulation.ts` — 1865 lines, math engine.
- `src/pages/team-builder/tabs/{Roster,TargetBoard,Compare,Depth,Analytics}Tab.tsx`
- `src/pages/targets/TargetBoardSubtab.tsx` — 807 lines.
- `src/pages/HighFollowList.tsx` — 585 lines.
- `src/pages/Targets.tsx` — 52 lines wrapper.
- `src/pages/{Dashboard,ReturningPlayers,TransferPortal,PlayerComparison,PlayerProfile,PitcherProfile,WarRoom,Auth}.tsx`
- `src/lib/{transferProjection,transferPitcherProjection,pitcherProjection,predictionEngine,powerRatings,nilProgramSpecific,transferWeightDefaults,pitchingEquations,depthRoles,playerCalcs,teamScopedPredictions}.ts`
- `src/savant/lib/{war,wrcPlus}.ts`
- `src/components/DashboardLayout.tsx` — 197 lines.
- `src/App.tsx` — 147 lines (routing).
- `src/hooks/{useAuth,useNilValuation}.tsx`
- `supabase/functions/process-precompute-jobs/index.ts` — 1582 lines, worker.
- `supabase/migrations/20260614120000_team_build_players_included_in_roster.sql` — most recent migration.
- `docs/CLAUDE.md` — repo source of truth (locked rules + formulas).
- `docs/PLAYBOOK_juco_display_invariants.md` — 6 JUCO invariants.
- `docs/AUDIT_stored_vs_live_2026-05-24.md` — No-Fallback Rule.
