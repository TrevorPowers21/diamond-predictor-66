# Pitcher projected-IP / pWAR = depth-role, not coarse role — full audit

**Discovered 2026-07-27** while fixing Kenny Ishikawa's two-way pitcher row on prod.
Kenny was NOT a one-off — he surfaced a systemic gap.

## The rule (memory: `feedback_projected_ip_from_depth_role`)
A pitcher's **projected IP, pWAR, and market must derive from the pitcher DEPTH ROLE**
(`pitcherExpectedIp(depth)` — weekend_starter 85, weekday_starter 50, swing_starter 30,
workhorse 50, high-lev 33, mid 20, low 12, specialist 6), NOT the coarse SP/RP/SM role IP
(`pwar_ip_sp` 85 / `pwar_ip_rp` 35 / `pwar_ip_sm`). Coarse == depth ONLY for the prototypical
weekend_starter (85); it is WRONG for every other depth (weekday SP, swing, all relievers).

The canonical writer is `derivePitcherStored()` (src/lib/predictionEngine.ts) — derives depth
from real IP, then `pitcherExpectedIp(depth)` → pWAR → market. Fixed in this PR by commit
`06ae521` ("Pitcher WAR consistency: … depth-role IP").

## Blast radius on prod (2026-07-27 audit)
`player_predictions`, season 2027, rows with a `pitcher_depth_role`:
- **returner / regular / GLOBAL: 5,230 rows → 4,697 have projected_ip ≠ pitcherExpectedIp(depth),
  4,455 have a wrong p_war.** e.g. weekday_starter ip 85→50 pWAR 1.141→0.675; low_impact_reliever
  ip 35→12 pWAR 0.051→0.020. **These were never re-run after `06ae521`.**
- transfer / precomputed / team: 81,438 rows → **0 ip mismatch** (already re-run, correct).

The app reads the returner-GLOBAL row for returner pitcher **profiles, rankings, dashboards, and
as the TB/board fallback** — so every returner pitcher currently shows an inflated pWAR/IP/market.

## WHAT NEEDS TO CHANGE

### A. DATA — re-run + re-verify (prod AND staging)  ← the big fix, needs Trevor's go
1. **Re-run `scripts/precompute-returner-pitchers.ts`** (already depth-IP correct via
   derivePitcherStored). Rewrites the 4,697 returner-global rows: projected_ip, p_war,
   market_value, pitcher_depth_role. Override-safe (preserves class_transition/dev_aggressiveness).
   Recommend: subset dry-run / small batch first, confirm a known row (Kenny 85→30), then full.
2. **Re-heal build/board snapshots** (`heal-stale-snapshots.ts --all --market`) afterward — a
   pitcher snapshot with a KNOWN depth already reads depth-IP via projectEffective (fine), but any
   null-depth pitcher snapshot falls back to the neutral's stored projected_ip (could be a stale 85);
   re-heal refreshes those + any neutral copied from a returner row.
3. **Re-run `verify-all --prod`** + the new prediction-level IP check (below).

### B. CODE — coarse role IP still live (prevent regression)
These bypass `derivePitcherStored` and use `projectedRole ? pwar_ip_sp : pwar_ip_rp : pwar_ip_sm`.
Change each to derive depth from IP and use `pitcherExpectedIp(depth)` (+ write projected_ip):
- [x] `src/lib/pitcherProjection.ts` (`computePitcherProjection`) — now uses `projectedIpFromRealIp(input.ip, …)`;
      added `ip` to the input + wired the 3 live callers (TB sim, HighFollowList, predictionEngine).
- [x] `src/lib/transferPitcherProjection.ts` (`computeTransferPitcherProjection`) — same, `ip` added + TB-sim caller wired.
- [x] `derivePitcherDepthRole` + new `projectedIpFromRealIp` moved to `src/lib/depthRoles.ts` (shared, no circular import).
- [x] `supabase/functions/process-precompute-jobs/index.ts` — NO change needed: the transfer path at 1478-1490
      ALREADY recomputes pWAR + market off `ipForPitcherDepthRole(depthRole)` (overrides the coarse intermediate).
      That's why transfer/precomputed rows had 0 ip-mismatch. **No edge redeploy required for this.**
- [x] JUCO path `src/lib/jucoReturnerPitcherProjection.ts` already uses `pitcherExpectedIp` — OK.
- Backward-compatible: when `ip` is absent the helper falls back to coarse role IP, so existing tests are unaffected.

### C. TOOLING
- [ ] Add to `verify-all`: a §checking `player_predictions.projected_ip == pitcherExpectedIp(pitcher_depth_role)`
      and p_war == computePitcherWar(rv+, that IP). Today verify-all only checks build/board SNAPSHOTS,
      so it never caught the 4,697 stale prediction rows.

## ⭐ THE reusable prediction-layer prod op (fills the handoff's how-gap)
The handoff logged the WHAT (row counts) but not the HOW — the prediction-layer fix was a
one-off SQL batch. **`scripts/recompute-derived-cascade.ts` is now that missing artifact.**
It recomputes the full derived cascade from EXISTING rates, in order, canonical:
  round pRV+/wRC+ → projected_ip(depth) → pWAR/oWAR → market (last).
- Conference resolution (matches staging): transfer → customer destination conf; global →
  `players.team_id → Teams Table.conference` (NOT `players.conference`).
- p_war/o_war written to EXACT recompute (1e-6) so market stays consistent with stored WAR.
- **VALIDATE method (no more guessing): dry-run on staging must report ~0 (12 hitter-market
  edge / 184k). Then prod dry-run → apply → re-dry-run converges.** Idempotent, 25-wide concurrent.
- Prod applied 2026-07-27: stat/WAR cascade now EXACT parity with staging (0 across
  pRV+/wRC+/IP/pWAR/oWAR); root cause was prod p_war baked off UNROUNDED rv+ (breaking the
  whole-pRV+ convention → 35,870 p_war↔market inconsistencies, all fixed).

## Two-way (is_twp=false) "market anomalies" — NOT anomalies (prod correct, staging buggy)
~79 position players (PA≥30) with sub-threshold pitching (IP<5) carry both hitter+pitcher stats
on one returner/global row. Per `recomputeTwpStatus` (PA≥30 AND IP≥5 → two-way; else bleed),
they are HITTERS → `market_value` = hitter market. Prod's cascade landed on this correctly;
STAGING has the pitcher-market bleed bug (e.g. Michael Anderson IF, 232 PA / 1.67 IP: staging
$3,567 pitcher vs prod $53,473 hitter — prod right). Later cleanup: fix staging + run
`recomputeTwpStatus` on prod for flag consistency (Tague Davis pos=TWP but is_twp=false).

## Already done (this session)
- Kenny Ishikawa hand-fixed consistently (pitcher row @ swing_starter 30 IP, pWAR 0.026, $975).
- Snapshot-level consistency (wRC+/oWAR, market migration, side-detection) — see PROD_PROMOTION_HANDOFF.md.
- The stale header comment in `precompute-returner-pitchers.ts` ("Math goes through
  computePitcherProjection") is misleading — the D1 path actually uses `derivePitcherStored`. Fix the comment.
