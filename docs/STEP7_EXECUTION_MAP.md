# Step 7 — Execution Map (market → total WAR + display + snapshot fill)

Detailed, compaction-proof map so progress isn't lost. Companions: `MASTER_PLAN_remaining_2026_08_12.md` §Step 7
(the locked decisions), `AGENT_LEARNINGS_internals_collapse_2026_08_12.md` §Step 7 (the logic), `project_war_display_audit`
memory (the display choke points). Branch `feature/war-recalibration`, staging-first. **Status: SCOPED + DECIDED, NOT BUILT.**

## Prereqs (DONE)
Step 6 complete on staging: returners re-precomputed (deterministic), `refresh_composite_war` ÷13.1 fired
(`player_predictions.total_hitter_war = o_war + d_war + bsr_war`, all ÷13.1), team_war_snapshots reseeded on full WAR.
So `total_hitter_war` is already populated + correct on returner rows — 7a can read it.

## LOCKED DECISIONS (Trevor 2026-08-13 — do not re-litigate)
- Market rides **`total_hitter_war`** (o+d+bsr); total WAR is the ONLY market input. Moves only via oWAR (d/bsr
  destination-invariant) but the value plugged in is the full total.
- **TWP market STAYS SIDE-SPLIT** (`twp_hitter_market_value` + `twp_pitcher_market_value`; shared `market_value` NULL
  for TWP). Combined-TWP-market = possible future research; DO NOT break the split.
- **Snapshot fill: toggles PERSIST (non-negotiable); values RECOMPUTE.** Fresh precompute → apply the coach's
  persisted toggles (`class_transition`/`dev_aggressiveness`/`roster_status`, stored in `production_notes`
  `__team_builder_metrics_v1`) on top → write results to `player_snapshot`/`transfer_snapshot`. Never null/reset a
  toggle; never show raw precompute where a coach saved an override. `production_notes` is sacred.

---

## 7a — Market value → total WAR (the input swap) — ✅ DONE (precompute side, 2026-08-13)

**BUILT (commits `74905fc` returner + `8bf4677` transfer):** each precompute site now loads `d_war, bsr_war` from the
Hitter Master (destination-invariant; same values `refresh_composite_war` sums into `total_hitter_war`) and feeds
`computeHitterMarketValue(oWar + dWar + bsrWar, …)`. Pattern per site: `const dWar = master?.d_war ?? 0; const bsrWar
= master?.bsr_war ?? 0; const total = oWar!=null ? oWar+dWar+bsrWar : null; market = total!=null ? f(total,…) : null`.
- **Returner backfill:** DONE + VERIFIED on staging — `mv_after/mv_before == total/oWAR` EXACTLY for all movers
  (Helfrick oWAR 2.53 + d 2.49 → total 5.09, $123k→$248k, ratio 2.013=2.013; Fawley 2.395 ✓; 8/8 ✓). 3,402 hitters
  moved (1,852 up good-glove/legs, 1,550 down poor D); o_war unchanged. **Verification method: ratio check
  mv_after/mv_before == total/oWAR** (market is linear in WAR, so the ratio is the clean correctness test).
- **Edge fn (D1 transfers) + transfer batch:** code-complete, **UNTESTED** (transfers paused) — ride the Step-6b
  transfer deploy for warm-cache A/B. JUCO: null d/bsr → total=oWAR, unchanged. TWP: side-split untouched.
- **NOT done in 7a:** PlayerProfile `:985` live-computes market for DISPLAY → that's 7b (read the stored total-WAR
  market, don't recompute from oWAR).

**Change (reference):** `computeHitterMarketValue(oWar, {conference, position})` → feed **`total_hitter_war` (o+d+bsr)**.
`computeHitterMarketValue` (`src/lib/depthRoles.ts:314`) unchanged (`WAR × PVF × PTM × 25,000`, `Math.max(0,·)`).

**Wiring decision (recommend the centralized option):**
- d_war + bsr_war are DESTINATION-INVARIANT (on the Master by `source_player_id` / `player_season_defense` +
  `player_season_baserunning` by `player_id`). `refresh_composite_war` already sums them into `total_hitter_war` on
  `player_predictions`. **So the cleanest single-source wiring = recompute `market_value` FROM the stored
  `total_hitter_war`** (in or right after `refresh_composite_war`, one place), rather than adding d/bsr at each
  inline caller. Matches Trevor's "one source, no live compute." Alternative (per-caller: fetch d/bsr + add to oWar)
  = more sites, more drift risk — avoid unless the central approach can't cover a path.

**Market write/compute SITES (all need the total-WAR value, TWP excluded):**
| site | path | notes |
|---|---|---|
| `scripts/backfill-2027-hitter-returners.ts:289` | returner precompute | `computeHitterMarketValue(oWar,…)` — D1 branch |
| `src/lib/predictionEngine.ts:79` | returner engine | verify enclosing fn; returner market |
| `supabase/functions/process-precompute-jobs/index.ts` | transfer edge fn | transfer market (Deno port) |
| `scripts/precompute-transfer-projections.ts` / `src/lib/buildTransferProjectionInputs.ts` | transfer batch | market via the shared builder |
| `src/lib/jucoReturnerProjection.ts:100` | JUCO returner | JUCO tier scale — verify whether it should use total or stay oWAR-only (JUCO has no d/bsr; likely oWAR-only stays, confirm) |
| `src/pages/PlayerProfile.tsx:985` | interactive display | `computedNilValuation` — confirm live vs stored-first |
| `src/pages/team-builder/hooks/useTeamBuilderSimulation.ts:693` | TB sim | likely void'd/stored-first (was in the dead-code sweep) — verify |
| `scripts/fix-returner-twp-hitter-market.ts` | TWP market fix | TWP path — STAYS side-split |

**TWP:** `pickHitterMarketValue`/`pickPitcherMarketValue` (`src/lib/twpMarketValue.ts:20/29`) — leave as-is; TWP hitter
market from the hitter side, pitcher from the pitcher side. Do NOT combine.

**Verify:** market_value now tracks total_hitter_war (a glove/legs hitter's market rises vs oWAR-only); TWP
side-split intact; deterministic (re-run convergence = 0, watching for the from_avg-staleness note — clear market on exit).

---

## 7b — Display swap `o_war → total_hitter_war` (hitters headline)

**Create the pick helpers** (mirror `pickHitterMarketValue`/`pickPitcherMarketValue` in `src/lib/twpMarketValue.ts`):
`pickHitterWar` (returns `total_hitter_war` for a hitter row, TWP-aware) + `pickPitcherWar` (returns `p_war`). Do NOT
exist yet — build them.

**Swap sites = the 6 display choke points** (full list in `project_war_display_audit` memory — READ it): every hitter
HEADLINE WAR flips `o_war → total_hitter_war`; pitchers keep `p_war`. Keep raw `o_war` ONLY where it's the batting
COMPONENT of a breakdown (not the headline). Surfaces: Rankings, Player Dashboard/ReturningPlayers, PlayerProfile,
TeamBuilder roster/analytics, PlayerComparison, target board.

**Descriptive + gap on the card:** show last-season descriptive (`total_desc_war` hitters / `desc_pwar` pitchers,
from the Masters) alongside the projection, + the gap (descriptive − projection = buy-low/sell-high).

---

## 7c — Snapshot fill (THE HARD ONE — recompute values, persist toggles)

**Where snapshots + toggles live:**
- `player_snapshot` (build hitter/pitcher display values) written at `TeamBuilder.tsx:1937` (build save) + `:2352`
  (update); `transfer_snapshot` at `useTargetBoard.ts:177-181` (target board) + TeamBuilder. GM side: `useGmRoster.ts:830`.
- **Toggles** serialized in `production_notes` as `__team_builder_metrics_v1` via `serializeBuildPlayerMeta`
  (`src/pages/team-builder/helpers.ts:442`); parsed by `parseBuildPlayerMeta` (`:397`). Edge-fn mirror =
  `buildPlayerMetaJson` (`process-precompute-jobs:1597`, used :1718/1725/1734).

**The fill mechanism (per the locked rule):** for every saved build/target row that has a snapshot:
1. Read the coach's PERSISTED toggles from `production_notes` (`class_transition`, `dev_aggressiveness`, `roster_status`).
2. Recompute the player's projection on the FRESH baseline (Step-6 `player_predictions`) WITH those toggles applied.
3. Write the recomputed display values into `player_snapshot`/`transfer_snapshot`. **Leave `production_notes`
   (the toggles) untouched.**

**Open design questions to resolve with Trevor before building 7c:**
- WHERE does the fill run — a new precompute/edge step iterating `team_builds` + target_board rows, or on-read
  (recompute snapshot lazily when a build loads)? (Batch fill matches the re-precompute cadence.)
- Which table(s) hold the saved builds to iterate (`team_builds` + `target_board`/watchlist)? Enumerate.
- TWP snapshot handling (two profiles) — mirror the side-split.
- Interaction with the from_avg-staleness note (a player who left the projectable set).

⚠ This is the biggest, least-specified piece — do a focused investigation of the `team_builds` schema + the
snapshot/toggle read path (`useLoadBuild`, `playerProjection` in `useTeamBuilderSimulation`) before writing it.

---

## 7d — TWP verify
After 7a/7b: confirm TWPs still render 2 profiles / 2 lines / 2 market values (hitter total WAR + pitcher p_war,
`twp_hitter_market_value` + `twp_pitcher_market_value`), nothing collapsed to a single blended number.

---

## RECOMMENDED BUILD ORDER
1. **7a market** (self-contained, testable; recommend the central "market from stored total_hitter_war" wiring) →
   verify market tracks total, TWP split intact, convergence = 0.
2. **7b display swap** (`pickHitterWar`/`pickPitcherWar` + the 6 choke points + descriptive/gap) → load pages to verify.
3. **7c snapshot fill** (resolve the open design Qs first) → the hard one; verify a coach's saved toggle survives + the
   snapshot shows fresh-WAR-with-that-toggle.
4. **7d TWP verify** throughout.
Then Step 8 (prod replay via `STEP8_PROD_MIGRATION_LEDGER.md`) folds 7a/7b/7c code + the market recompute in.

## STATUS TABLE (update as built)
| piece | status |
|---|---|
| 7a market → total WAR | ✅ DONE — returner VERIFIED (`74905fc`); transfer code-ready/untested (`8bf4677`) |
| 7b display swap + pick helpers + descriptive/gap | ⏳ not started — NEXT |
| 7c snapshot fill (toggles persist) | ⏳ not started — design Qs open |
| 7d TWP verify | ⏳ not started |

## ⚠ ORDERING GUARD — re-fire `refresh_composite_war()` after ANY `o_war` re-precompute (7a)
7a's market re-precompute **rewrites `o_war`**. `total_hitter_war` is a stored column = `o_war + d_war/13.1 +
bsr_war/13.1`, frozen the last time `refresh_composite_war()` ran. So a re-precompute of `o_war` that is NOT followed
by `refresh_composite_war()` leaves `total_hitter_war` stale (market is fine — it's computed from the fresh `o_war`
inline). **Rule: `o_war` re-precompute → ALWAYS `select refresh_composite_war();` right after.** This matches the prod
ledger order (`STEP8_PROD_MIGRATION_LEDGER.md`: G re-precompute → **F2** fire), so prod is already safe if run in
order. Staging hit 37 stale-`total` rows because Step 6 fired the refresh, THEN 7a rewrote `o_war` — order inverted.
Consistency check (2026-08-13) confirmed: market rides total **0/8,235 inconsistent**, TWP split intact, **37/8,235**
stale `total_hitter_war` (all `o_war` moved by the 7a re-precompute; Δ = o_war_at_refresh − o_war_now, analytically).
Resync = `select refresh_composite_war();` (idempotent + `IS DISTINCT FROM` guard → touches only the 37).

**NEXT: (1) resync `refresh_composite_war()`, re-verify 0 mismatches; then start 7b.** Prior note — run a consistency
check (Step 6 + 7a) before 7b — confirm on staging that for returner hitters
`market_value == f(total_hitter_war)` and `total_hitter_war == o_war + d_war + bsr_war` line up end-to-end, TWP
side-split intact, and the team_war_snapshots still reconcile. Then start 7b (`pickHitterWar`/`pickPitcherWar` +
the 6 display choke points from `project_war_display_audit`).
