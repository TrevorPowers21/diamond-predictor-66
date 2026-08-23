# MASTER HANDOFF — feature/war-recalibration (2026-08-23)

The comprehensive, resumable handoff for the whole branch + the ordered prod push. Detail docs linked per section.
Standing constraints: **D1 only, JUCO separate**; **staging-first, never feature→main**; prod writes = paste-SQL or Trevor
drives; log every DB change to `PROD_MIGRATIONS_TODO.md`. ⚠️ `supabase --linked` = **PROD** (`trbvxuoliwrfowibatkm`);
staging = `slrxowawbijbjrkozqlj` (.env.local). Batch scripts run on staging via `.env.local`.

## What this branch is
Finish the RSTR IQ transfer-projection equation + the pitch-log→snapshot pipeline, everything STORED + reproducible for a
clean prod push, folding into ONE unified edge fn (Track B). This session: closed the audit gaps, codified the conf-stats
producers, cleaned savant, finalized + implemented the market-value re-price, and ran a full stored-first display audit.

---
## ✅ DONE (code on staging branch; tsc 180 pre-existing, 265 tests pass)

### 1. Audit gaps (5) — all fixed [docs/GAP_FIX_PLAN_2026_08_21.md]
- GAP 1 faced-competition for independents (Oregon State faced 104.47/100.22 not own-conf) — builders + callers + re-run 17 teams + edge-fn mirror.
- GAP 2 edge-fn `?? 100` → D1 block guard. GAP 3 raw-rate/WRC+ Bucket-A producer codified + STAGING-VERIFIED (29/29 confs 0.0000). GAP 4 stale HTP display → stored. GAP 5 source_team_id park (both sides, value-neutral).

### 2. Conference Stats producers — all committed [docs/CONFERENCE_STATS_BUILD_PROCESS_2026_08_21.md]
`conf_stats_bucketA_assembly.sql` (rates/env+/WRC+/ERA-DRS/FIP), `derive_conf_opr_htp.ts` (OPR/run_env/canonical park-swap HTP), `compute_conf_pitcher_env_plus.ts` (pitcher env+). team_season_stats WAR cols migration `20260821010000`. NJCAA-D1 re-tag SQL. OPR = PA-avg Overall_Power_Rating; HTP = OPR+1.25(Stuff+−100)+0.75(100−run_env).

### 3. team_season_stats prod-blocker — fixed [migration 20260821010000]
10 WAR cols (hitter_war/rotation_pwar/bullpen_pwar/ra9/fip_ra9 _reg/_total) were hand-run ALTERs → committed `ADD COLUMN IF NOT EXISTS` migration (else refresh_team_season_stats DELETE-then-aborts on prod → empty table).

### 4. Savant cleanup [571fa49]
Deleted the 8 stale `savant/pages/*` + `/savant/*` routes + SavantRoute/SavantLayout. **KEPT `savant/components/`** (`PitchLogSection` powers the live coach `/stats` season-stats display). tsc dropped 198→181.

### 5. Season-stats aggregation → edge-fn plan [docs/PIPELINE_pitch_log_to_projections.md stage 3b]
`aggregate_pitch_log_dimensions.ts` (dimension splits → pitch_log_*_totals) is an offline producer to absorb into Track B. conf_only/intra-conf per-player split unbuilt.

### 6. MARKET VALUE re-price — implemented [docs/AGENT_LEARNINGS_market_value_reverse_engineer_2026_08_21.md]
Reverse-engineered PTM from real roster spend. **LINEAR (convex rejected), base $25k/WAR.** **PER-CONFERENCE exact-code**
resolver (no fuzzy names), SINGLE `model_config nil_tier_<code>` source for BOTH hitter + pitcher + edge fn:
**SEC 4.0 · ACC 1.5 · Big12 1.2 · BigTen 1.0 · Independent 1.0 · AAC/SunBelt/BigWest/MWC 0.8 · else 0.5 · NJCAA 0.35.**
Hitter market rides `total_hitter_war`; profiles no-toggle→stored, toggle→recompute-off-WAR. Commits 08c40e2→5fafad9.

### 7. Stored-first display audit + fixes [docs/STORED_FIRST_DISPLAY_AUDIT_2026_08_23.md, 95f22a6]
Projections stored-first everywhere on load (coverage 99.6-100%, projected-not-prevseason clean). Scouting grades flipped
to stored-first (4 chip surfaces + usePlayerHubPreview). TWP `loadGmBuildRoster` market side-aware. RLS gap found + migration written.

### 8. RLS tighten — migration written [20260823000000_player_predictions_rls_team_scope.sql]
`player_predictions` was `USING(true)` (globally readable). New: `customer_team_id IS NULL OR superadmin OR is_team_member`.

---
## ★ PROD PUSH — ORDERED (staging first, then prod paste; log each to PROD_MIGRATIONS_TODO)
Authoritative DB-change ledger: `PROD_MIGRATIONS_TODO.md`. Runbook: `docs/PROD_PUSH_RUNBOOK_war_recalibration.md`.

**A. Schema migrations** (apply in timestamp order; all `IF NOT EXISTS`/idempotent):
- team_season_stats WAR cols `20260821010000`; conf pitcher env+ `20260821000000`; player_predictions RLS `20260823000000`; + all prior branch migrations in the ledger.

**B. Conference Stats producers** (paste; NOT `--linked`=PROD): `conf_stats_bucketA_assembly.sql` → `derive_conf_opr_htp.ts --apply` → `compute_conf_pitcher_env_plus.ts --apply` → NJCAA-D1 re-tag SQL. (Gate: staging diff already 0.0000 for Bucket-A.)

**C. team_season_stats**: `select refresh_team_season_stats(2026);` (after A adds the cols).

**D. MARKET VALUE** (order matters):
1. `scripts/sql/seed_nil_tiers_model_config.sql` — ⚠ BEFORE re-price (clears old nil_tier_sec=1.5 that overrides 4.0).
2. Re-price 17 teams: `precompute-transfer-projections` + `precompute-pitchers` per team.
3. Re-bake snapshots: `resync-build-snapshot-markets.ts` + `resync-target-snapshots.ts`.
4. Verify roster totals (SEC ~$4.4M / ACC ~$1.7M / Big12 ~$1M / BigTen ~$900k) + TWP + Independent=1.0.

**E. Deploy edge fn** `process-precompute-jobs` (Trevor) — new-team path (has the unified PTM + faced-competition + conf-stats block guard).

**F. Verification gates** (runbook): global NULL-count on pitch_log/Masters; confirm each customer team's precompute ran.

---
## PHASE 3 — dead-code cleanup ✅ DONE [9933454, 65032a3]
Deleted dead `deriveHitterStored` (o_war outlier), `platformDefaults.ts` + `usePlatformConfig.ts` (dormant tier layer),
TransferPortal dead imports, and the broken AdminDashboard 5-bucket `nil_tier` editor. PitcherProfile Stuff+ → stored
`stuff_score`; pWar/pRV+/rates → no-toggle-stored guard. tsc 180→178, 265 tests pass.

## PHASE 4 — market-value re-price ON STAGING [IN PROGRESS 2026-08-23]
- ✅ **model_config seeded on staging** — old `nil_tier_sec=1.5` + dead bucket keys cleared; new per-conference set live (SEC 4.0…). Verified before/after. Committed artifact: `scripts/sql/seed_nil_tiers_model_config.sql` (for PROD).
- ⏳ **Re-pricing 17 teams** running (`_run_step2_all.sh`).
- NEXT: re-bake snapshots (`resync-build-snapshot-markets.ts --all --apply` + `resync-target-snapshots.ts --all --apply`) → verify roster totals + Independent=1.0 + TWP.
- **PROD:** run seed → apply RLS migration → re-price → re-bake → verify → deploy edge fn (Trevor). Same order as §D above.

## ★ total_hitter_war STORED FIX + STEP 7b DISPLAY SWAP (2026-08-23) — the "rewire before prod"
Full detail + WHY + exact steps: **`docs/AGENT_LEARNINGS_total_war_display_2026_08_23.md`**.
- **WHY:** `total_hitter_war` was computed inline only to price market, never stored — it was filled by a SEPARATE
  `refresh_composite_war()` job that lagged `o_war`. The re-price rewrote `o_war` → ~84k rows had `total_hitter_war ≠ o+d+bsr`.
- **FIX (Trevor):** all 3 hitter producers (transfer batch `572bd11`, edge fn `572bd11`, returner backfill `2d20a5f`)
  now WRITE `total_hitter_war = o_war + d_war + bsr_war` directly → always fresh + consistent, no separate job, no
  ordering guard. `total_hitter_war` = the POSITION-PLAYER headline source; `o_war` stays the offensive component that
  feeds it. `refresh_composite_war()` is now REDUNDANT for the projection total (keep for descriptive Master cols only).
- **Re-run status (staging):** transfer hitters re-run ✅ (total consistent), returner backfill re-running.
- **STEP 7b display swap — NOT STARTED (the rewire):** build TWP-aware `pickHitterWar`/`pickPitcherWar`; swap every
  hitter HEADLINE across the 6 choke points to stored `total_hitter_war` (relabel "oWAR"→"WAR"); component o_war stays;
  snapshots carry total + d/bsr; descriptive+gap on card; verify (TWP = 2 lines). Exact steps in the agent-learnings doc.

## OPEN / PENDING (post-Phase-4)
- **PROD push** — everything committed + staged; run the ordered §A-F push when ready (Trevor drives prod / paste-SQL).
- **is_position_of_need** (#5) — designed, not built (Phase 1 scope per team_season_stats handoff).
- **Track B unification** — fold all producers (conf-stats, stage 3b dimension agg, market re-price) into ONE on-upload edge fn.
- **RLS `nil_valuations`** also `USING(true)` (legacy manual table) — tighten separately if wanted.
- **Minor stored-first leftovers:** 2 GM readers still hand-roll TWP pick (read-equivalent); season-stats filtered dimensions live (accepted, Trevor OK).

## Detail docs
GAP_FIX_PLAN_2026_08_21 · CONFERENCE_STATS_BUILD_PROCESS_2026_08_21 · PIPELINE_pitch_log_to_projections · AGENT_LEARNINGS_market_value_reverse_engineer_2026_08_21 · STORED_FIRST_DISPLAY_AUDIT_2026_08_23 · HANDOFF_market_value_2026_08_21 · PROD_PUSH_RUNBOOK_war_recalibration · PROD_MIGRATIONS_TODO.
