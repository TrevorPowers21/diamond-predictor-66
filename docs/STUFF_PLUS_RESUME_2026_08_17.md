# STUFF+ RESUME POINT — 2026-08-17 (read this first to continue)

Single dense handoff for the Stuff+ rebuild. Full design/rationale: `HANDOFF_STUFF_PLUS_2026_08_16.md` +
`AGENT_LEARNINGS_stuff_plus_2026_08_16.md`. Memories: [[project_stuff_plus_classifier_build]] [[project_venue_movement_correction]]
[[project_pipeline_and_savant_clear]]. Branch `feature/war-recalibration` (0 behind / 123 ahead of origin/main).

## WHERE WE ARE
- **Phase 1 (classifier) DONE + LOCKED** — all 4 gate checks passed (TrackMan stability win all families overall +0.046/
  breaking +0.026; archetype routing; absurdity goldens; Gibler = ONE breaking ball → anchor fold validated).
- **Phase 2 step 1 DONE** — the 9 FOLDED FINAL EQUATIONS written to the handoff ("FOLDED FINAL EQUATIONS": armHB, hbSign
  retired → +z(armHB) arm-side buckets SI/CH/SPL, −z(armHB) glove-side FC/SL/SW/CB; 4S zAbs(armHB); gyro bullet |armHB|;
  cutter ivb signed; curveball −0.15 z(armHB) sign-fix; spin shaves; +z(fb_gap) on gyro/slider/sweeper/curve).
- **Phase 2 step 2 WRITE DONE on staging** — `pitch_log.pitch_type_reclassified` = anchor taxonomy for **2,000,674 pitches**,
  stamped `classification_version='v1-anchor-2026-08-17'`, `needs_review=true` on 9.0% (flagged = score-and-flag exceptions;
  MONITORED GOLDEN baseline). 14,647 tiny-sample pitches (pitchers below classifier threshold) left unstamped → keep prior
  labels / global-fallback. Index `idx_pitch_log_reclassified_hand` recreated. New cols added: `classification_version` text,
  `needs_review` boolean.

## STAGING ARTIFACTS (helper tables — safe to DROP once Stuff+ recomputed)
- `_reclass_result(uniq_pitch_id, label, needs_review)` — materialized per-pitch labels (the write source).
- `_reclass_map(pitcher_id, seed, label, needs_review)` — per-(pitcher×seed) anchor label map (37,256 rows).
- `_reclass_pf(pitcher_id, pf_velo)` — primary-FB velo per pitcher (4,804).
- `venue_movement_corrections` (310) + `pitch_log_corrected` VIEW (`venue_correction_version=v1-2026-loo-eb`) — KEEP (the corrected layer).
- scratchpad: `_seedcent_out.json` (per pid×half×seed centroids — the anchor-construction input), `_venue_corrections.json`, `_pf_values.txt`, `_map_tbl.txt`.

## NEXT (Phase 2 step 2b → 4) — all on the corrected layer + new taxonomy
1. **Baseline re-derive** `pitcher_stuff_plus_ncaa` per (`pitch_type_reclassified` × hand) on **armHB** (RHP hb / LHP −hb,
   from corrected hb) + a NEW **fb_gap** mean/sd column. ⚠ PIN the CURRENT derivation methodology first (read-before-change;
   the derivation script wasn't obvious — search how `pitcher_stuff_plus_ncaa` is currently populated; engine reads it as
   `popMap` keyed `pitch_type::hand`). The Stuff+ layer's "hb" field becomes armHB throughout (no schema rename needed — store
   armHB in hb). fb_gap = z of (primaryFB velo − pitch velo) vs bucket-optimal (new column + per-pitch compute).
2. **Fold the 9 calc functions** in `src/savant/lib/stuffPlusEngine.ts` (calc4SFB…calcSplitter, :123–288) to the FOLDED
   equations — remove `hbSign`, use fixed per-bucket sign on z(armHB); apply cutter `zAbs(ivb)→z(ivb)`, curveball sign fix,
   gyro velo 0.40→0.30, slider/sweeper spin 0.20→0.10, add `z(fb_gap)` (needs new PitchRow+PopConstants field + fb_gap in the
   scoring loop). NOTE the committed calc is still the PRE-final version — wiring applies fold + final-equation changes together.
3. **Recompute** `scripts/compute_pitch_log_stuff_plus.ts` (scores per-pitch from `pitch_type_reclassified` via
   `calculateStuffPlus`, reads baseline popMap, recenters each (type×hand) bucket to mean 100, upserts `pitch_log.stuff_plus`).
   It reads raw `hb` → must compute armHB + fb_gap per pitch and pass them. Acceptance: recenter warnings <2 off 100; sane leaderboard.
4. **Store** conf Stuff+ V2 (retire V1) + per-player Stuff+ (Pitching Master). Then Track B automation.
5. Then the recompute chain (6b→7c→…) carries into projections + NIL. Park factors after. Clear Savant.

## ★ BASELINE + SCORING METHODOLOGY (PINNED 2026-08-17 — read-before-change done)
- **Baseline `pitcher_stuff_plus_ncaa` (18 rows = 9 types × 2 hands, keyed on ENGINE labels "4S FB"/"Sinker"/… which MATCH the
  reclassified labels; `hb` is handedness-SIGNED: RHP 4S +10.3 / LHP −10.6; sliders glove-signed) is DERIVED FROM
  `pitcher_stuff_plus_inputs` (per source_player_id × pitch_type × hand aggregate), NOT from pitch_log directly.**
  - `src/savant/lib/nonBreakingBallPopConstants.ts` → fastball/offspeed families; `breakingBallReclassification.ts` → breakers.
  - Method: `fetchAll(season)` reads `pitcher_stuff_plus_inputs` (velocity/ivb/hb/rel_height/rel_side/extension/spin/pitches),
    filter `pitch_type in NON_BREAKING_BALLS`, require ivb+hb, group by `pitch_type::hand`, **PITCH-WEIGHTED mean + sd** (wMean/
    wSd weighted by `pitches`) → upsert `pitcher_stuff_plus_ncaa` onConflict `(pitch_type,hand,season)`.
- **Scoring `compute_pitch_log_stuff_plus.ts`** is PER-PITCH from `pitch_log` (reads `pitch_type_reclassified`), z vs baseline
  popMap, recenter each (type×hand) bucket to per-pitcher mean 100, upsert `pitch_log.stuff_plus`.
- **⇒ RE-DERIVE SEQUENCE (exact):** (1) **RE-AGGREGATE `pitcher_stuff_plus_inputs`** per (source_player_id × pitch_type_reclassified
  × hand) from `pitch_log_corrected`: pitches, avg velocity, avg **ivb_corrected**, avg **armHB (R?hb:−hb on corrected hb)** stored
  in the `hb` column, avg rel_height/rel_side/extension/spin, + NEW **fb_gap** (needs a new column on inputs + baseline), velo_diff
  for CH. This is SMALL (~15–40k rows = fast GROUP BY, no ctid-batching). (2) Run the two derivers (modified: `pitch_type→
  pitch_type_reclassified`, they already read `hb` which now = armHB; add fb_gap mean/sd) → new baseline. (3) Fold the 9 calc
  functions (below). (4) `compute_pitch_log_stuff_plus` per-pitch (compute armHB+fb_gap per pitch, feed calc) + recenter — 2M
  write = ctid-batch. **armHB fold = "hb" column carries armHB everywhere; no rename. fb_gap = the one genuinely-new column.**

## ★ WRITE MECHANICS LEARNED (critical — big writes to pitch_log)
- Staging pooler (session mode, port 5432) enforces a **hard ~120s statement_timeout and IGNORES `statement_timeout=0`** via
  connection options → any single statement >120s → `57014 canceling statement due to statement timeout` + **full rollback**.
- To write ~2M rows despite this: (1) **DROP indexes on the updated columns first** (enables HOT updates — huge speedup),
  recreate after; (2) **materialize** the result into a helper table via CTAS (fast heap write, no timeout); (3) **batch the
  UPDATE by slicing the SMALL driving table by ctid** (`_reclass_result r WHERE r.ctid >= '(S,0)' AND r.ctid < '(E,0)' AND
  pl.uniq_pitch_id=r.uniq_pitch_id`), ~350 blocks ≈ 52k rows ≈ <120s each, in a background bash loop. **Do NOT** filter
  `pitch_log.ctid` or hash-mod (the planner then re-scans the full 2M join table every batch → each batch times out).
- Trevor's logged alt (PITCH_LOG_PROD_RUNBOOK): a bare UPDATE (no BEGIN/COMMIT) pasted in the SQL editor survives the gateway
  disconnect — but a heavy 2M-row JOIN update still got cancelled; the ctid-batched loop is the reliable path here.
- Reads/aggregations: `supabase db query --db-url "<staging conn from scratchpad/.staging_dburl>"`. numeric returns come as
  `{Int,Exp}` structs — decode `Int*10^Exp`; strip the leading "Connecting…" line; use `JSONDecoder().raw_decode`.

## OPEN / DEFERRED
- **TB oWAR regression = MUST-FIX/CHECK after projections run** → [[project_teambuilder_owar_snapshot_regression]] (live-rebuild
  vs stored snapshot; toggle/PA-driven; needs prod protections + snapshot values when snapshots filled).
- gravity-ball flag cosmetic (fire on gyro anchors only). VAA/HAA reserved (future local-TrackMan source).
