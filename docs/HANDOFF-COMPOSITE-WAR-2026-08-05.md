# Handoff — Composite WAR (dRS + wSB + calibration + dWAR/bsrWAR wiring)

**Date:** 2026-08-05 · **Branch:** `feature/defensive-runs-engine` · **Prior handoff:** `docs/HANDOFF-2026-08-04.md`

This session took the defensive-runs engine to a positioning-aware v0.6.0, rebuilt baserunning
(wSB) on a two-file architecture that matches NCAA, ran a full WAR-constant calibration audit
against D1 data, locked the composite-WAR architecture, and cleared every identity/data blocker
so the dWAR/bsrWAR data path is ready to execute. Everything additive is committed; the disruptive
oWAR recalibration is deliberately deferred (documented, not applied).

---

## 1. What's committed (branch `feature/defensive-runs-engine`)

| commit | what |
|---|---|
| `46c0dc3` | dRS v0.6.0 — air-ball **catch-probability surface** (positioning-aware range) |
| `cb3ac9c` | wSB v1 (SB/CS, pitch-scan) + `computeOWar` wsbRuns param **(both later superseded)** |
| `f71aadc` | wSB pickoffs (exposure track) |
| `d3aec42` | wSB double-steal front-runner fix (+1,105 league SB) |
| `a1dc515` | **wSB rebuilt on the two-file architecture** (box-score counts + pitch-log values) |
| `85afb42` | AGENT_LEARNINGS: WAR calibration + §8 findings + corrections |
| `dae91d9` | **war.ts composite buckets** (dWAR/bsrWAR/positional/total) at current scale + recalibration TODO |

Tests: 248 TS + 31 Python-dRS all green.

---

## 2. dRS engine — v0.6.0 (positioning-aware, `scripts/drs/`)

- **Air balls** priced by a **catch-probability surface** `P(out | distance-to-cover, hang)` fit per
  position group (CF / corner_OF / IF_air) off empirically-derived D1 reference positions.
  Files: `drs_engine/field.py` (shared geometry, imported by fitter + engine), `field_positions.json`,
  `catch_surface.json`, `derive_field_positions.py`, `derive_catch_surface.py`.
  - Reference positions: IF from sub-1.8s short-hang putout medians; **OF from all-putout centroid**
    (sub-1.8s impossible for OF); handedness-split; 1B dual by hold state.
  - Fixed the liner over-credit at the source (a .910 liner at the fielder now credits ~0, not +0.91).
- **Grounders stay on xAVG** (league-average catch prob under average positioning) — decided NOT to
  build an infield surface: it would add modeling error, not signal. Bar for any future infield
  surface: **beat xAVG on held-out Brier/log-loss**, not consistency.
- Per-model coverage gate: air priced on hang+FBDst+spray, grounder on xAVG; unpriceable → neutral,
  counted in `bip_faced` so `tracking_coverage = scored/faced`.
- Re-cert (full season): zero-sum +5148 → **−425** (air self-fits; ground carries the xAVG-vs-D1 gap),
  10° seam smooth, positions flat within-position (spectrum in the SD, SS σ5.1 vs 1B σ2.2).
- Output `output/player_season_defense_regseason.csv`; the big DRS Pitch Log CSVs are gitignored.

## 3. wSB engine — TWO-FILE architecture (`scripts/drs/drs_engine/baserunning.py`)

The pitch-tracking layer systematically MISSES ~10% of successful steals (Grines 58 vs 66 official;
league 19,741 vs 22,448) — proven by the official file's own per-base breakdown sitting ~10% below its
headline SB. Stats providers track ~90% and **override the total from the box score**; we do the same.
- **Counts** from `docs/drs-reference/2026 Full Season Stolen Bases.csv` (authoritative per-player
  SB2/SB3/SBH, CS2/CS3/CSH, opportunities, keyed by `playerId`; includes steals of home).
- **Run-values** state-weighted from `2026 Full Season SBA Attempt Pitch Log.csv` (RE24; clean
  transitions only — exclude double-steal rows whose target base is occupied, else the delta breaks).
- `run_baserunning.py` takes the two files. Zero-sum +0.067; counts MATCH NCAA by construction.
- Both data files gitignored.

## 4. WAR-constant calibration audit — D1 constants derived (NOT yet applied)

The old oWAR/pWAR constants in `src/savant/lib/war.ts` were transplanted MLB rules of thumb with no D1
provenance. Re-derived from the 2.58M-pitch season (MLB as sanity rail only):

| constant | old | **D1** | basis |
|---|---|---|---|
| runs/win | 10 | **13.1** | Pythagorean `2R`, R=6.54 |
| runs/PA | 0.13 | **0.174** | 105,473 runs ÷ 605,727 PA |
| runs/9 | 5.5 | **6.76** | D1 R/9 |
| replacement | 25 runs | **2.0 wins/600 PA** | fixed-WIN, scales with rpw |

- Run-environment is a **uniform rescale**, not a hitting/pitching rebalance (Pythagorean symmetry:
  `∂W/∂R = −∂W/∂RA = 1/2R`). Recalibration shrinks everything ~7–24%; hitting rose more than pitching
  (×1.34 vs ×1.23), so the o-vs-p gap closes but pitchers stay higher (at college PA/IP: top hitter
  ~2.6 oWAR, ace ~4.7 pWAR).
- The full D1 values + rollout are in `war.ts` `WAR_RECALIBRATION_TODO`.

## 5. Composite WAR architecture (locked)

- **Total WAR = oWAR + pWAR + dWAR + bsrWAR + positional-scarcity.** Sub-WARs sum; replacement applied
  once (in oWAR/pWAR). Functions in `war.ts`: `computeDWar`, `computeBsrWar`, `computePositionalValue`,
  `computeTotalWar` (all on `RUNS_PER_WIN` so they rescale together).
- **dWAR = DRS ÷ rpw**, per-position rows summed to a total, NO internal positional adjustment (the
  opportunity-neutral catch-surface metric already handles fielding-spread; per-position avg DRS ≈ 0,
  opportunity lives in the SD).
- **Positional SCARCITY is a SEPARATE, settable combine term** (`POSITIONAL_VALUE_WINS`, empty for
  now → 0). It prices scarcity (invisible to any fielding metric), derivable from cross-position
  offensive gaps. Do NOT conflate "the metric needs no baseline" (true) with "WAR needs no positional
  term" (false). Populate before total WAR ships.
- **bsrWAR = wsb_runs ÷ rpw.**
- **Season scope:** full-season primary (headline), regular-season split for team comparison; the
  DISPLAYED profile WAR is *projected*, actual full-season WAR feeds program analytics + projection.
  dWAR/bsrWAR carry ~1:1 year-to-year; o/pWAR get projected.

## 6. Phased execution plan (Trevor)

- **PHASE A (in progress):** add dWAR/bsrWAR as buckets at the CURRENT ÷10 scale so oWAR/pWAR + stored
  precomputes DON'T move. war.ts DONE (`dae91d9`). Remaining: the data path (below) + add defense/bsr
  to the precompute + staging test.
- **PHASE B (later, separate branch, AFTER A confirmed):** the oWAR **recalibration** — centralize the
  7 duplicate oWAR formula copies + flip to D1 constants + fix display. Copies: `src/lib/{playerCalcs,
  transferProjection, buildTransferProjectionInputs, depthRoles}.ts`, `src/pages/TeamBuilder.tsx`,
  `src/pages/team-builder/hooks/useTeamBuilderSimulation.ts`, `supabase/functions/process-precompute-
  jobs/index.ts`. Values in `war.ts` `WAR_RECALIBRATION_TODO`.
- **PHASE C:** rerun ALL precomputes together (recalibration + dWAR/bsr in ONE re-valuation, so players
  move once) + finalize 2027 projections + wiring.

## 7. Identity — 100% SOLVED (the data-path unblock)

No fielder id exists in the pitch log. Resolved internally:
- **dRS fielder name → TruMedia id** via the pitch log's own batter+catcher+**pitcher** `(team,name)→id`
  pairs: **99.985%**; residual 10 players (defensive-only, never batted/caught/pitched) close via a
  `players` name+team match.
- **wSB** already carries the TruMedia `playerId` (0 nulls; verified = pitch-log `batterId` — same id space).
- **Bridge to RSTR IQ uuid:** `players.source_player_id` IS the TruMedia id; **all 15,561 players have
  one** (verified on staging). So `source_player_id → players.id (uuid)`, and everything keys/stores on
  the **uuid**, not the TruMedia id.

## 8. DATA-PATH EXECUTION SEQUENCE (next — no blockers)

1. **dRS engine emits `source_player_id`** — build the `(team,name)→id` map (batter+catcher+pitcher) +
   the 10 residuals, add it to each output row. *(Python — STEP 1, do next.)*
2. **Load script (TS, staging via `.env.local`)** — read the dRS + wSB CSVs, join `source_player_id →
   players.id`, upsert into the new tables keyed on **uuid**. The id-mapping happens HERE.
3. **Two staging tables** `player_season_defense` (per-position rows + components + coverage) and
   `player_season_baserunning` (SB/CS/SBH, wsb_runs) — DDL drafted + run on staging.
4. **`player_predictions` columns** `d_war`, `bsr_war`, `total_war` (staging ALTER).
5. **Precompute edge function** (`process-precompute-jobs`) — join both by uuid, `d_war = Σ
   position drs_floor / RUNS_PER_WIN`, `bsr_war = wsb_runs_reg / RUNS_PER_WIN`, `total_war`. *(Draft,
   Trevor deploys to staging.)*
6. **Precompute run** (human-run) → load a page, see where everyone lands.

## 9. Operational rules confirmed this session

- **DB access:** on STAGING (`slrxowawbijbjrkozqlj`) the agent may run migrations/SQL directly, but
  **transparently** — show the SQL + target before running, verify it landed, flag+confirm destructive
  ops (DROP/TRUNCATE/DELETE). **PROD (`trbvxuoliwrfowibatkm`) requires an explicit "prod, now?".**
- **⚠️ The Supabase CLI is linked to PROD** (`supabase/.temp/project-ref`). Do NOT use `db query
  --linked` for staging writes — it hits prod. Staging path = TS scripts with `.env.local` (data) +
  the staging SQL editor / a staging connection (DDL). Reads via `.env.local` are fine.
- CLAUDE.md carries a Database Access Boundary (MCP read-only, staging-scoped).

## 10. Pointers

- Memory: `project_defensive_runs_engine`, `project_baserunning_wsb`, `project_composite_war`,
  `project_season_boundaries` (season scope revised: full-season primary + reg split).
- Agent knowledge: `docs/AGENT_LEARNINGS_defensive_runs_engine_2026_08_03.md` (dRS + catch surface +
  wSB forensics + WAR calibration + §8 + the grounder/xAVG decision + the "metric ≠ WAR" correction).
- Constants: `docs/drs-reference/CONSTANTS_D1_2026.md`.
- Still pending (from prior handoff, unaffected): regular-season filter on the dRS RUN path, grammar
  queue for Sam, pitch_log dedup cleanup (needs "prod, now?").
