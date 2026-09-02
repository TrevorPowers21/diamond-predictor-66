# AGENT LEARNINGS — total_hitter_war stored fix + Step 7b display swap (2026-08-23)

## THE WHY (diagnosis) — why total_hitter_war was stale after the re-price
- The precompute (batch `precompute-transfer-projections.ts` + edge fn `process-precompute-jobs`) computes
  `totalHitterWar = o_war + d_war + bsr_war` **inline, only to price market value**. It wrote `o_war` + `market_value`
  to `player_predictions` but **NEVER wrote `total_hitter_war`.**
- `total_hitter_war` was a **separate stored column filled by a SEPARATE job** — `refresh_composite_war()`
  (migrations `20260806_composite_war_and_refresh.sql` / `20260810_composite_war_d1_rescale.sql`), a centralized
  D1 bulk join that runs AFTER the precompute.
- ⇒ every precompute run rewrote `o_war` fresh, but `total_hitter_war` kept its OLD value until `refresh_composite_war()`
  fired again. The 2026-08-23 market re-price touched ~101k hitter rows → their `total_hitter_war` lagged. Measured:
  **84,886 / 101,597 rows had `total_hitter_war ≠ o_war + d_war + bsr_war`.** The old "ordering guard" (STEP7_EXECUTION_MAP:136)
  was a workaround for exactly this — re-fire `refresh_composite_war()` after any `o_war` re-precompute.
- **NOT caused by the market changes** — the `o_war` formula (`computeHitterOWar`/wRC+/depth-role) was untouched;
  Phase 1/2 only changed PTM/market. The precompute just re-wrote the same `o_war` and the separate total column lagged.

## THE FIX (Trevor 2026-08-23) — store total_hitter_war directly, kill the separate-job lag
- **The precompute now WRITES `total_hitter_war: totalHitterWar` in the upsert** (batch `:446`, edge fn `:1240`).
  It already computed the value inline for market — now it's stored too. So `total_hitter_war` is **ALWAYS fresh +
  consistent** with `o_war` (no lag, no ordering guard, no dependency on `refresh_composite_war()` for the projection total).
  Commit `572bd11`.
- **Design (Trevor):** `total_hitter_war` = the POSITION-PLAYER headline / the main + only WAR that matters for display
  and market. `o_war` (offensive WAR) is still calculated, run, and stored — it FEEDS INTO total_hitter_war (total =
  o_war + d_war + bsr_war). We do NOT keep a separate stale-able stored total from a separate job.
- **Consequence:** `refresh_composite_war()` is now REDUNDANT for the projection total (`player_predictions.total_hitter_war`).
  It can stay for the DESCRIPTIVE Master columns (`total_desc_war` etc.), but the prod push no longer needs it to fire
  after the precompute for the projection side.

## STEP 7b — DISPLAY SWAP `o_war → total_hitter_war` (the rewire) — EXACT STEPS
Goal: hitter HEADLINE WAR everywhere = stored `total_hitter_war` (relabel "oWAR" → "WAR"); pitchers keep `p_war`;
component `o_war` stays only inside breakdowns; TWPs stay fully split (never combine hitter+pitcher WAR). Plan source:
`docs/STEP7_EXECUTION_MAP.md` §7b + `project_war_display_audit` memory (6 choke points) + `AGENT_LEARNINGS_step7b_war_display_audit_2026_08_13.md`.

**Step 0 — data (DONE 2026-08-23):** total_hitter_war stored directly by precompute; hitters re-run so the column is
fresh + consistent. VERIFY `total_hitter_war == o_war + d_war + bsr_war` = 0 stale.

**Step 1 — pick helpers.** Add to `src/lib/twpMarketValue.ts` (mirror `pickHitter/PitcherMarketValue`):
`pickHitterWar(row, isTwp)` → `total_hitter_war` (the hitter-side total; TWP reads its hitter row);
`pickPitcherWar(row)` → `p_war`. These DON'T exist yet.

**Step 2 — swap the display sites (headline → total, relabel "WAR").** From the audit:
- `ReturningPlayers.tsx:3020` header "oWAR"→"WAR" + `:3127` cell `pred.o_war`→`total_hitter_war`. ⚠ GOTCHA: the hitter
  column's sortKey literal is `"p_war"` (`:1875` reads `o_war` under that key) — a find/replace landmine, fix the read not the key.
- `PlayerProfile.tsx:1726` hero — currently LIVE-rebuilds oWAR from wRC+; read stored `total_hitter_war` for the headline
  (the toggle preview recompute already flows through total — keep it; default reads stored).
- `PlayerComparison.tsx:361`, `TransferPortal.tsx:1583`, `TargetBoardSubtab.tsx:584/638`, `PlayerHub.tsx:489/602` —
  hero/col `row.o_war` → `total_hitter_war` (via pickHitterWar).
- `useTeamBuilderSimulation.playerProjection` (:1278-1512) — clean row returns `owar: snap.o_war`; return
  `snap.total_hitter_war` instead (pitcher clean row already returns `owar: snap.p_war` — that's the pitcher total, fine).
- GM: `loadGmBuildRoster.ts:33` `storedWar = pitcher ? snap.p_war : snap.o_war` → `snap.total_hitter_war` for hitters.
  `useGmTargetBoard.ts:171`.
- Keep component `o_war` only where a card shows the OFFENSE breakdown (not the headline).

**Step 3 — snapshots carry the total.** Snapshot writers currently store `o_war` only
(`TeamBuilder.tsx:1937/2304`, `useTargetBoard.ts:177`, edge-fn player_snapshot `:1808`, GM). Add `total_hitter_war`
(+ `d_war`/`bsr_war` as const pass-throughs per the locked decision) so the roster/board headline reads total and a
toggle recompute = recomputed_oWAR + stored d + stored bsr. Re-bake snapshots after.

**Step 4 — descriptive + gap on the card.** Show last-season descriptive (`total_desc_war` hitters / `desc_pwar`
pitchers, from the Masters) beside the projection total + the gap (descriptive − projection = buy-low/sell-high).

**Step 5 — verify.** Load each page: hitter headline = total WAR labeled "WAR"; component oWAR intact; TWPs render TWO
lines (hitter total WAR + pitcher p_war), never combined; Program Analytics position gauges on total WAR (per-pos
thresholds in project_war_display_audit); benchmark holds ~32.

## STATUS
Step 0 DONE (total_hitter_war stored + hitters re-run). Steps 1-5 = the display swap, NOT STARTED. This is the
"rewire everything before prod" work.
