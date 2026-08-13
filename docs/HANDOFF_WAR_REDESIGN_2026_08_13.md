# HANDOFF — WAR Redesign + Transfer Engine (2026-08-13)

Single entry point for the current state. Branch `feature/war-recalibration`, staging-first. Read this first, then the
detailed companions. **Operating principle (Trevor, emphatic): improvements got built OVER old code without deleting it
— "it works, but there's discrepancy on what's actually used." Trace the ACTIVE path in code/DB, DELETE the dead,
bring the edge fn UP to canonical. Verify everything in code + database — do NOT guess, and do NOT assume Trevor is
right; prove each claim before acting.**

## Detailed companions (all current-cycle)
- `TRANSFER_ENGINE_AUDIT_2026_08_13.md` — the full transfer equation (both sides), divergences, active/dead, edge-fn sync list.
- `AGENT_LEARNINGS_step7b_war_display_audit_2026_08_13.md` — WAR display/market/value map, the scale reshape, calibration, my two errors.
- `STEP7_EXECUTION_MAP.md` · `MASTER_PLAN_remaining_2026_08_12.md` · `STEP8_PROD_MIGRATION_LEDGER.md` · memory
  `project_war_display_audit`, `project_internals_collapse_plan`, `project_market_calibration_research_phase`.

---

## WHERE WE ARE (done + verified in DB, staging)
- **Steps 1-5 modeling LOCKED** (C1 wRC+, D1-FIP pRV+, composite refits, replacement 1.62). Internals collapse
  CODE-COMPLETE (all live readers on Master, dead readers deleted, writer stripped; only bulkRecalc +
  import-internal-ratings remain → Track B).
- **Step 6 (returners) DONE + verified:** hitter + pitcher returners re-precomputed (deterministic by convergence),
  `refresh_composite_war()` ÷13.1, `team_war_snapshots` reseeded to FULL WAR (308 D1 reconcile, lineup≤total verified),
  champions 34.
- **Step 7a (market→total_hitter_war) DONE + verified BOTH sides:** hitter market rides total (0/8,235 inconsistent
  after a `refresh_composite_war` resync of 37 stale-total rows); TWP split intact; **pitcher market rides p_war,
  0 stale among 6,234 pure pitchers** (the initial "stale pitcher" alarm was a `from_avg`-filter artifact — from_avg is
  a hitter field; corrected).

## THE SCALE RESHAPE (measured old=prod ÷10 vs new=staging ÷13.1, matched IDs, JUCO-controlled) — INTENDED + CORRECT
The redesign WIDENED WAR: median hitter DOWN ~18%, elite UP ~2× (Hairston desc_owar 2.5→5.07, his d_war only 0.12 =
OFFENSE not defense), pitchers DOWN, team totals ~flat for good programs (Georgia 39→44, GT 37→46). 272/308 teams down,
36 up, but direction tracks quality (champions mean WAR 24.2 vs league 16.3). Trevor confirmed correct — do NOT re-open
the oWAR scale. **Benchmark `33` → HOLD ~32**, calibrated on a PERCENTILE of COMPETITIVE teams (top-64 by the actual
scored quantity `Σ(WAR × PVM)` p75 = 32.4), NEVER the league average (16.9). PVM: C/SS/CF 1.3, 2B/3B/OF 1.1, 1B/DH 1.0,
pitchers 1.0. (Catcher-PVM-1.5 + conference-tier spread deferred to a coach-feedback research phase.)

---

## THE TRANSFER ENGINE — realizations + shortcomings (the "built over top" theme, in the flesh)
The transfer math (project a player AT a destination competition level — the product's core value) is coherent, BUT it
lives in **THREE independently-maintained copies that have drifted**: canonical `src/lib/*`, the Deno edge fn
(`process-precompute-jobs`, can't import src/), and TeamBuilder's live hook. This is the same "improve-over-top,
never-delete" pattern at the process level, across THREE axes (hitter/pitcher, CLI/edge, stored/live).

**VERIFIED by me (code read):**
- Pitcher **edge fn still applies PVF** (`index.ts:672-673` `× pvfForRole`) while canonical dropped it
  (`depthRoles.ts:267` `void ctx.role`) → SP transfer market ~20% inflated on the edge path. Real bug.
- **Triple-oWAR dead code:** `computeTransferProjection`'s internal `owar` (`transferProjection.ts:124`, `actualPa??260`)
  is read by NOTHING; the stored oWAR is `computeHitterOWar(...depthRole)` (`precompute-transfer-projections.ts:384`).
  The 260-PA version is V1 leftover — DELETE.
- Transfers are **stale on staging** (returners re-precomputed in Step 6; transfers NEVER re-run/deployed → Step 6b).

**FLAGGED by audit agents — NOT yet re-verified by me (must prove before acting):**
- Hitter batch script may not route TWP market to `twp_hitter_market_value` (edge fn does). Trevor: the DISPLAY handles
  `is_twp` regardless, so confirm whether this is even the active path or dead. DON'T overcomplicate TWP.
- TB live pitcher preview may show class/dev-adjusted pRV+ but un-adjusted pWAR/$ until save. Trevor's INTENDED
  behavior: a toggle recomputes rates + WAR + market LIVE for display (both sides), snapshot-read after save. Likely a
  stale branch built over — verify active path, delete stale.
- lgRA9 6.913 (pRV+) vs 6.915 (pWAR) — cosmetic, make identical.

---

## THE PLAN — 4 buckets, bucket 3 FIRST (Trevor: don't fix the edge fn then have to fix it again)

**Coverage map — every point from Trevor's direction → bucket (so nothing is dropped):**

| Trevor said | Bucket | Status |
|---|---|---|
| Both hitter+pitcher scripts run on the edge fn / one upload→display process | 1 | pending |
| Remove pitcher PVF from edge fn (SP value already in IP) | 1 | VERIFIED bug, fix pending |
| Hitter market → total+PVM in edge fn; pitcher market → p_war no-PVF in edge fn | 1 | pending |
| Rate index (pRV+ D1-FIP, wRC+ C1) consistent in edge fn | 1 | verify + sync |
| lgRA9 6.913/6.915 cleanup | 1 | pending |
| Triple-oWAR → delete dead (V1 built-over) | 2 | VERIFIED dead, delete pending |
| TB live toggle recomputes rates+WAR+market live both sides, snapshot on save; check for old code | 2 | verify active/dead |
| TWP: ONLY add total_hitter_war + redirect oWAR→total; don't overcomplicate | 2 | pending |
| Confirm conference Stuff+ accuracy + how derived from pitch logs | 3 | ✅ DONE — derivation sound, DB clean; canonical conf Stuff+ = pitch-weighted V2, retire V1 |
| HTP pick-apart: isolate hitter talent from run-environment / weak pitching | 3 | ✅ DONE — sound + sniff-test-valid; `100−wRC+` → conf-avg PARK FACTOR **MODELED+VALIDATED** (all 30 confs; Ivy/Patriot/BigEast/MAAC over-boost fixed, top stable). Detail: TRANSFER_ENGINE_AUDIT §Bucket 3 |
| Store conf aggregates (Stuff+, park factor, HTP, OPR) in `Conference Stats` + make it part of the UPLOAD | 3/TrackB | pending — add `wrc_park_factor`+HTP+OPR cols; calc+insert on upload (unified pipeline) |
| Independent = schedule-based opponent HTP/Stuff+ faced (not own HTP) | 3 | future item |
| Future: resolve "Conference Stats" calc (conf-vs-conf raw stats vs overall OPR/HTP/Stuff+) | future | logged |
| Role from IP/GS like PA from AB; verify depth-role PA/IP RANGES use regular-season totals | 4 | pending |
| Defensive depth tiers so d/bsr scale under position/depth toggles (returner AND transfer) | 4 | pending |
| Edge fn d/bsr→market "UNTESTED" = what we're testing; 1-for-1 into transfer (depth tier) | 1/4 | pending |

**Sequence:** **3 → (1 + 2) → 4 → Step 6b → 7b build → 7c → 7d → Step 8 → Track B.**
- **Bucket 3 (Stuff+/HTP) goes FIRST** — it's the core value (projecting across competition levels), and everything
  downstream inherits it; fixing the edge fn before the levers are confirmed risks fixing it twice. It's a DERIVATION
  investigation: trace how conference Stuff+ + HTP inputs (Overall Power Rating, Stuff+, wRC+) are computed from
  pitch-log/conference data, then stress-test that HTP isolates true hitter talent from run-environment + pitching-faced
  context. Bring Trevor the actual numbers + questionable assumptions to pick apart together.
- Then **1+2** (edge-fn sync + dead-code deletion) so the engine is self-consistent, ONE source of truth.
- Then **4** (regular-season range check + defensive depth tiers — the latter needed for BOTH returner + transfer
  toggle-scaling, i.e. it's a 7b/7c dependency).
- Then **Step 6b** (deploy edge fn + fire transfers + A/B BOTH sides) — the prerequisite for 7c and the transfer-facing
  parts of 7b.

## STANDING DISCIPLINE (from this session's misses)
- **Verify BOTH hitter and pitcher sides at every step** (the "finish one side, neglect the other" pattern bit us on
  Step 6 market + almost on 7a). Now extended: verify all THREE copies (canonical/edge/live) agree.
- **Trace liveness to real invocation before calling code live/dead** (grep finds sites, not liveness).
- **Check population parity + use percentiles of the relevant segment** (the JUCO-confound / league-average traps).
- **Don't persist a finding until verified in code/DB** ("we don't need wrong information").
