# HANDOFF — Market Value re-eval + PTM unification (2026-08-21)

Resumable handoff for the market-value work on `feature/war-recalibration`. Full detail + audit:
`docs/AGENT_LEARNINGS_market_value_reverse_engineer_2026_08_21.md`. This is the short version.

## Where we are
- Market-value MODEL is **decided**; the implementation is a **consistency REFACTOR** whose design is **LOCKED
  and NOT YET STARTED** — awaiting Trevor's GO to write code.
- All prior WAR-recalibration / gap-fix / conf-stats / snapshot work on this branch is done + staging-verified
  (see `docs/GAP_FIX_PLAN_2026_08_21.md`, `docs/PIPELINE_pitch_log_to_projections.md`). Market value is the last
  modeling piece before the display-wiring pass + prod push.

## The equation (unchanged shape, linear)
`hitter market = total_hitter_war × $25,000 × PTM × PVM` · `pitcher market = p_war × $25,000 × PTM` (floored $0).
Convex curve REJECTED (Trevor: too complex). PVM unchanged (C/SS/CF 1.3 · 2B/3B/corner-OF 1.1 · 1B/DH/UT 1.0 · bench 0.8).

## PTM — reverse-engineered from real roster spend (LOCKED VALUES)
Coaches claim $40k/win (= current SEC 1.5×$25k), but top SEC rosters (~44 total WAR, Georgia) spend ~$5M =
~$113k/win → SEC PTM must jump. Trevor anchored on **~$100k/win** and set:
| SEC | ACC | Big 12 | Big Ten | strongMid | low-major | JUCO |
|---|---|---|---|---|---|---|
| **4.0** | **1.5** | 1.2 | 1.0 | 0.8 | 0.5 | 0.35 |
Only changes vs today: **SEC 1.5→4.0**, **ACC split out to 1.5** (Big12 stays 1.2). Roster totals land: SEC top
~$4.4M · ACC ~$1.7M · Big12 ~$1M · BigTen ~$900k. Per-conf top-roster WAR: SEC 44.2 · ACC 46.1 · Big12 32.9 · BigTen 36.2.

## Full audit found (why it's a refactor, not a bump)
1. **FOUR tier definitions, only 2 live** — hitter code const + pitcher code defaults are LIVE; `model_config.nil_tier_*`
   (AdminDashboard editor) and `platform_config`/`usePlatformConfig` are both DEAD (no reader). 
2. **Hitter market rode `o_war` in most paths but `total_hitter_war` in the edge fn** — an existing inconsistency.
3. **Edge fn `process-precompute-jobs` has 4 duplicated tier blocks** (pitcher default/resolver, hitter default/resolver;
   hitter copy missing `juco` key) — new-team path would diverge from Team Builder.
4. **Snapshots BAKE market** (`team_build_players.{player,neutral}_snapshot`, `target_board.{transfer,neutral}_snapshot`) →
   re-price REQUIRES a snapshot re-bake. Tooling: `resync-build-snapshot-markets.ts` + `resync-target-snapshots.ts` (WAR-preserving).
5. **NIL:** GM `allocateNil` uses RAW WAR → unaffected by PTM. `calcPlayerScore = WAR × PTM` moves (NilValuations page + TB score col).
6. **GM marketability** = separate 0–100 score, unaffected. Stored market cols = `player_predictions.{market_value,
   twp_hitter_market_value, twp_pitcher_market_value}`. `team_market_pay_log`/`nil_valuations` = coach-entered, not PTM-derived.

## Trevor's decisions on the audit (the refactor spec)
1. **ONE PTM source, hitter == pitcher** ("can't have separate functions") → unify to `model_config` `nil_tier_*` (the
   established pattern); code consts fallback-only; edge fn reads same keys → no duplicated copies.
2. **Market STORED for every row, NO live compute / fallback anywhere** → also repoint the 3 live-display computes to read stored.
3. **`total_hitter_war` everywhere** for hitter market (JUCO = o_war since d/bsr=0).
4. **Snapshot re-bake WIRED into the data run** (automatic, not manual).
5. **Dead code:** verify truly dead → clean; if it's the tier config, WIRE to the single source instead of deleting.

## NEXT (on GO): implement per AGENT_LEARNINGS "UNIFIED REFACTOR DESIGN"
Edit ~8 files + edge fn (4 blocks) + ACC split + remove 3 live computes + delete dead layers → seed model_config
(staging) → re-price 17 teams (total_hitter_war) → auto re-bake 4 snapshot cols → verify roster totals + TWP +
Independent nulls → update `nilProgramSpecific.test.ts` → log every SQL to `PROD_MIGRATIONS_TODO.md` → prod later.
DO NOT START until Trevor greenlights the single-source-in-model_config + delete-dead-layers approach.

## Also open (tracked elsewhere, not market-value)
Display-wiring audit (mostly clean per the branch sweep; primary surfaces read stored) · edge-fn deploys (Trevor) ·
Track-B unification (incl. folding `aggregate_pitch_log_dimensions` = stage 3b) · prod push. See `docs/GAP_FIX_PLAN_2026_08_21.md`.
