# DISPLAY AUDIT — Step 7b `o_war → total_hitter_war` swap (2026-08-23)

Verified against LIVE code by 4 parallel audit passes (hitter display / pitcher+TWP / snapshot writers / compute choke points).
Supersedes the memory `project_war_display_audit` "6 choke points" list where they conflict (drift notes below).

## The design (Trevor, locked)
- **Position-player HEADLINE = `total_hitter_war`** (= `o_war + d_war + bsr_war`), relabel "oWAR" → **"WAR"**.
- `o_war` stays as the **offensive component** inside breakdowns; still computed/run/stored, feeds total.
- Pitchers keep `p_war` (already a total). TWPs stay fully split — never combine hitter+pitcher WAR.
- Default (no toggle) reads **stored** `total_hitter_war`. Toggle recompute = recomputed_oWAR + **stored** `d_war` + **stored** `bsr_war` (never rescale the total directly).

## Doc-drift corrections found (old memory was stale)
- `effectiveProjection.ts` is **NOT dead** — still live-imported by `PitcherProfile.tsx:55` + `loadGmBuildRoster.ts:4` (pitcher helpers). Only its *hitter* exports are unused.
- `savant/lib/war.ts` **still exists** — canonical constants (`RUNS_PER_WIN=13.1` etc.) are live-imported everywhere; its *functions* are test-only now. `computeTotalWar` (L102-116) already sums o+p+d+bsr.
- Sim `playerProjection` lives at `src/pages/team-builder/hooks/useTeamBuilderSimulation.ts` (NOT `src/hooks/...`).
- `total_hitter_war` is currently read for DISPLAY in **zero** places — only `PlayerProfile.tsx:982` reads it, and only for market math, not the tile.

---

## 1. PICK HELPERS — don't exist yet (build first)
`src/lib/twpMarketValue.ts` (44 lines) has `pickHitterMarketValue`/`pickPitcherMarketValue`/`sumTwpMarketValues`. **No WAR analog.**
ADD, mirroring the market helpers:
- `pickHitterWar(row, isTwp)` → `row.total_hitter_war ?? null` (TWP reads its hitter row's total)
- `pickPitcherWar(row, isTwp?)` → `row.p_war ?? null`
Extend `RowWithMaybeTwpMv` (or a sibling type) with `o_war? / p_war? / total_hitter_war? / d_war? / bsr_war?`.

## 2. HITTER HEADLINE sites — repoint `o_war`/`owar` → `total_hitter_war` + relabel "oWAR"→"WAR" (7)
| # | File:line | Current | Change |
|---|---|---|---|
| 1 | `PlayerProfile.tsx:1730-1731` hero tile; value `displayOWar` (L997→964→961) **LIVE-rebuilds oWAR from wRC+**, `void storedOWar` L958 | live rebuild | Default: read stored `total_hitter_war`. Toggle path: recomputed oWAR + stored `d_war` + stored `bsr_war` (dBsr constant already derived L982-988). Relabel L1730. |
| 2 | `PlayerComparison.tsx:361-363` hero, `row.o_war` (select L178, type L44) | `row.o_war` | `pickHitterWar(row, row.is_twp)`; relabel L362; add `total_hitter_war` to select L178 |
| 3 | `TransferPortal.tsx:1555-1557` sim hero, `simulation.owar` (from `row.o_war` L1290, select L851) | `simulation.owar` | carry `total_hitter_war` into the sim row; default headline = stored total; relabel L1556 |
| 4 | `PlayerHub.tsx:490` `statBox("WAR", row.war)`; `row.war` = GM `o_war` (via `useGmTargetBoard:171`) + `targetWar` L261 | `o_war` | source `war` from `total_hitter_war` (fix in §5 readers); label already "WAR" |
| 5 | `ReturningPlayers.tsx:3127` cell `pred.o_war`; header L3020 `label="oWAR" sortKeyVal="p_war"` | `pred.o_war` | `pickHitterWar(pred, pred.is_twp)`; relabel L3020; **sortKey landmine → §6** |
| 6 | `TargetBoardSubtab.tsx:638` cell `pred.o_war`; header L584 `label="oWAR" sk="o_war"` | `pred.o_war` | `pickHitterWar`; relabel L584; normalize `o_war ?? owar` at L395 → also carry total |
| 7 | `team-builder/PlayerTableRow.tsx:724-725` `projectedOwar` (= `projection.owar`, L174) | `projection.owar` | source `owar` from total in the sim clean-row (§4) |

## 3. COMPONENT / AGGREGATE oWAR — KEEP as offensive (do NOT swap)
- `NilValuations.tsx:457` `ncaa_owar` — NIL formula component.
- Team "Lineup oWAR" sums — intentional offensive component shown ALONGSIDE a separate "Total WAR" cell:
  `AnalyticsTab.tsx:337/823/829` (+accum 138/170-186/626-633), `GMAnalytics.tsx:185`, and the `prorated_*_owar`
  rollups in `useTeamWarSnapshots.ts` (17/19/22/24/140/192/196/237). These are DESCRIPTIVE team snapshots
  (championship benchmarks) — leave on oWAR. **DECISION for Trevor: confirm keep.**

## 4. COMPUTE CHOKE POINTS — current state
| Loc | Class | Action |
|---|---|---|
| `playerCalcs.ts:18-29` `computeOWarFromWrcPlus` | LIVE engine | KEEP — it's the oWAR *component*; toggle path adds stored d+bsr on top |
| `savant/lib/war.ts` constants + `computeTotalWar` L102-116 | canonical | KEEP; reuse `computeTotalWar` semantics |
| `effectiveProjection.ts` (pitcher helpers live) | live | no hitter change needed |
| `teamScopedPredictions.ts` | stored-read router | ensure selects carry `total_hitter_war` (see §7) |
| `useTeamBuilderSimulation.ts` `playerProjection` L1273: **clean** hitter L1303-1305 returns `snap.o_war ?? snap.owar` | stored-read | return `snap.total_hitter_war` for hitter clean path (pitcher clean L1300 `owar:p_war` unchanged) |
| same, **dirty** L1492 `computeOWarFromWrcPlus` | live | recomputed oWAR + stored d+bsr = toggled total |
| team totals L1789-1800 accumulate `owar` | stored-read | automatically becomes total once clean-row returns total |

## 5. SNAPSHOTS — `total_hitter_war`/`d_war`/`bsr_war` are in NO snapshot payload (add + re-bake)
Every writer stores hitter `o_war` only. Add `total_hitter_war` (+ `d_war`,`bsr_war` pass-through) to each, and add them to the feeding SELECTs.
**Writers:** edge fn `process-precompute-jobs` player_snapshot L1811/1835 (+ select L1754); `TeamBuilder.tsx` L1916/1930, 2283-2296, 2922-2935 buildHitterRow (owar L2927); `useTargetBoard.ts` L151-159 transfer_snapshot (L154) + L162 neutral_snapshot + L174 TWP hitterSnap; GM `useGmRoster.ts:833` (select `useGmTargetBoard:75`); scripts `create-default-builds.ts` (274/347-352), `backfill-build-snapshots.ts` (284), `backfill-neutral-snapshot.ts` (24), `backfill-target-transfer-snapshots.ts:32`.
**Readers to repoint:** `loadGmBuildRoster.ts:38` `pitcher ? p_war : o_war` → `: total_hitter_war`; `useGmTargetBoard.ts:171` same; `TeamBuilder.tsx:3066` self-heal normalizer; `useLoadBuild.ts` selects 194/217; `useTargetBoard.ts:140` select; `TeamBuilder.tsx:2853/2767` bake selects.
**Re-bake after:** `resync-build-snapshot-markets.ts` + `resync-target-snapshots.ts` (currently market-only — extend to carry the WAR fields, or add a one-off backfill of total/d/bsr into existing snapshots).

## 6. SORT-KEY landmine (ReturningPlayers)
Hitter "oWAR" column's `sortKey` literal is **`"p_war"`** (`FAST_DB_SORT_KEYS` L73; DB remap L1600 → `p_wrc_plus`; comparator L1875 `sortKey==="p_war" → o_war`; header L3020). The pitcher table L3415 ALSO uses `sortKeyVal="p_war"` for real pWAR. **Fix the READ (L1875 → total_hitter_war), do NOT rename the key** — a blind find/replace breaks the pitcher table. Other WAR sorts (all fine to leave or repoint read-only): `HighFollowList:342` `owar`, `TransferPortal:369` `owar`, `TargetBoardSubtab:150/584` `o_war`, `GMTargets:188` `war`.

## 7. SELECTS to widen (add `total_hitter_war, d_war, bsr_war`)
`PlayerComparison:178`, `TransferPortal:851`, `useTargetBoard:140`, `useGmTargetBoard:75`, `useTeamBuilderData:153/308`, `useTeamBuilderSimulation:522`, `useLoadBuild:194/217`, `TargetBoardSubtab:323`, `TeamBuilder:2853/2767`, edge fn `:1754`, snapshot backfill scripts' field lists.

## 8. VERIFY (load each page)
Hitter headline = total WAR labeled "WAR"; component oWAR intact in breakdowns; TWP renders TWO lines (hitter total + pitcher p_war), never combined; team "Lineup oWAR" cells unchanged; benchmark holds ~32; sort still works on both hitter+pitcher tables.

## Execution order (safe)
1. Pick helpers (§1) — pure add, no behavior change. **Check in with Trevor.**
2. Widen selects (§7) — data available, still displaying o_war. No visible change.
3. Snapshot writers+readers (§5) carry total; re-bake. Roster/board headline flips to total.
4. Headline display swap + relabel (§2) + sim clean-row (§4) + sort read (§6).
5. Verify (§8). Then it folds into the prod push (§D of HANDOFF_MASTER).
