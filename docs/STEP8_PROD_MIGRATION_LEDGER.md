# Step 8 — PROD Migration Ledger (WAR redesign + internals collapse)

**Purpose (Trevor, 2026-08-13):** every DB change this branch made, with the exact SQL/command, in run order, so the
prod promotion is turnkey. Nothing runs on prod until staging is fully verified and Trevor says "prod, now?".
Append each item to repo `PROD_MIGRATIONS_TODO.md` as it's promoted. Branch: `feature/war-recalibration`.

**Discipline:** DDL/SQL pasted in the prod SQL editor (owner) — the CLI is prod-linked but writes go via the editor
or a driven rpc. Data is **CALCULATED on prod** (prod resolves its own UUIDs), never copied from staging. Deploy the
edge fn AFTER migrations. Post the `WhatsNewModal` note when WAR numbers move.

---

## RUN ORDER (top → bottom)

### A. SCHEMA — ALTER the Masters (idempotent `ADD COLUMN IF NOT EXISTS`)
| # | file | what | prod status to verify |
|---|---|---|---|
| A1 | `scripts/sql/descriptive_war_columns.sql` | Hitter Master `desc_owar, wraa, woba, d_war, bsr_war, total_desc_war`; Pitching Master `desc_pwar, desc_ra9, desc_fip_ra9, drs_behind, total_desc_war` | ⏳ pending (Push-1 added composite cols; desc_* may be partial — verify) |
| A2 | `scripts/sql/descriptive_war_reg_columns.sql` | Hitter Master `woba_reg, wraa_reg, desc_owar_reg, d_war_reg, bsr_war_reg, total_desc_war_reg`; Pitching Master `desc_ra9_reg, desc_fip_ra9_reg, drs_behind_reg, desc_pwar_reg, total_desc_war_reg` | ⏳ pending |
| A3 | `supabase/migrations/20260525000000_hitter_master_pull_air.sql` | Hitter Master `pull_air` column | ✅ likely already on prod (May) — verify |
| A4 | `supabase/migrations/20260806_composite_war_and_refresh.sql` | composite cols (`o_war/d_war/bsr_war/total_hitter_war`) + `refresh_composite_war()` v1 | ✅ Push 1 (2026-08-07) — verify |

### B. CONFIG — model_config + ncaa_averages @ season 2026
| # | file / SQL | what |
|---|---|---|
| B1 | **`scripts/sql/step8_model_config_2026.sql`** (generated 2026-08-13 from staging) | **COMPLETE @2026 model_config mirror** — idempotent upsert of all 125 rows. Carries wRC+ C1 weights (`r_w_obp 0.691 / r_w_slg 0.235`, AVG/ISO→0, intercept 0.011), the composite refits (era⁺ `bb .30/whiff .25/stuff .20/hh .15/chase .05/barrel .05`; baPlus; obpPlus `walk .40`; isoPlus `pull_air .10`; hr9⁺ `hh .30/gb .30/pull .25/barrel .15`, ev90/la→0; whip⁺ `bb .30/whiff .45/stuff .25`), and **replacement `owar_replacement_runs_per_600 = 21.22`**. Supersedes the model_config parts of `wrc_c1_model_config.sql`. |
| B2 | `UPDATE ncaa_averages SET wrc = 0.3782 WHERE season = 2026;` | wRC+ denominator anchor (all-D1 lgwOBA). Also in `wrc_c1_model_config.sql`; run either. |
| B3 | `scripts/sql/pitcher_c1_model_config.sql` | pitcher D1-FIP/pWAR REFERENCE only — the pitcher path rides code defaults (Equation Weights table empty; no pwar keys). Optional (parity with hitters). |

**⚠ model_config SEASON GOTCHA:** the app reads season **2026** (`ADMIN_UI_SEASON`/`CURRENT_SEASON`). Legacy `admin_ui`
rows exist at 2025 — do NOT write there. B1 writes 2026 only.

### C. DATA BACKFILLS — Master columns derived from the prod pitch_log (calculated, not copied)
Prod's `pitch_log` already holds the data (Push 1). Reproduce these on prod:
- **C1 — Hitter Master `pull_air`** ← `pitch_log_hitter_totals.batted_pull_air / batted_balls_in_play` (spray to pull
  side + LA above grounder cutoff; RHB pull left <−15°, LHB pull right >15°). Backfill by `source_player_id, Season=2026`.
- **C2 — Pitching Master `in_zone_pct`** ← `pitch_log_pitcher_totals.total_in_zone / (total_in_zone + total_out_of_zone)`
  (the TruMedia `InZoneMdl%` header was unmapped on the CSV → null for all 2026 D1 → BB9⁺ flattened). Backfill by
  `source_player_id, Season=2026`.
  *(Both were paste-SQL on staging; the derivation is the source of truth. If a prod pitch-log-derive job exists it
  supersedes these. Track B's unified edge fn makes this automatic.)*

### D. STORE — recompute the power ratings on the fresh Masters (prod)
Run the store so the refit composites land on the Masters (propagate=false — projections come from the precompute):
- **D1** — `npm run recompute-stuff:prod` / the store path that runs `computeAndStoreScores` for hitters + pitchers.
  Writes `ba/obp/iso_power_rating` (hitter) + `*_pr_plus` (pitcher) using the B1 weights. Verify a few leaders in-DB.
  *(On staging this was the "store re-run propagate=false".)*

### E. DESCRIPTIVE WAR — populate on all-D1 0.3782 (prod, calculated)
- **E1** — `node scripts/drs/populate_descriptive_war.mjs` (prod env) → `desc_owar/wraa/woba/d_war/bsr_war/total_desc_war`
  (+ pitcher desc_*) on 0.3782. Uniform ~0.016 WAR down vs pool.
- **E2** — `node scripts/drs/populate_descriptive_war_reg.mjs` (prod env) → the `_reg` columns (regular-season subset).

### F. REFRESH COMPOSITE — the ÷13.1 rescale (paste-SQL, then fire)
- **F1 — DEFINITION:** paste `supabase/migrations/20260810_composite_war_d1_rescale.sql` (redefines
  `refresh_composite_war()` — `d_war = Σ NON-P drs_floor / 13.1`, `bsr_war = wsb_runs(FULL) / 13.1`,
  `SET statement_timeout='180000'`, `IS DISTINCT FROM` change-guard). **Do NOT `select refresh_composite_war()` yet.**
- **F2 — FIRE:** after E + the precompute (G), `select refresh_composite_war();` (runs under the timeout; only rewrites
  changed rows).

### G. RE-PRECOMPUTE — projections (prod, calculated)
- **G1 — hitter returners:** `npm run precompute-returner-hitters:prod` (reads the fresh Hitter Master by
  `source_player_id` — collapse repoint; internals no longer touched).
- **G2 — pitcher returners:** `npm run precompute-returner-pitchers:prod` (reads Pitching Master `*_pr_plus`).
- **G3 — transfers (when resumed):** deploy the edge fn (`supabase functions deploy process-precompute-jobs
  --project-ref trbvxuoliwrfowibatkm`) AFTER the migrations, then fire per customer team
  (`npm run precompute-players:prod` / `rerun_all_teams_precompute`). JUCO via `juco-precompute-all:prod`.
- **⚠ Do NOT run `populate-conf-stats`** (overwrites the hand-calibrated JUCO overlay). Ignore JUCO otherwise.

### H. SNAPSHOTS + DISPLAY (Step 7 on prod)
- **H1 — reseed `team_war_snapshots`** from `desc_owar/desc_pwar` (retire the old inline-blend seed on the 5.5/2.5/10 scale).
- **H2 — fill `player_snapshot` / `transfer_snapshot`** so coach TOGGLE updates (roster_status/class_transition/
  dev_aggressiveness) are caught against the new numbers (mechanism TBD in the Step-7 discussion).
- **H3** — market value repointed at total WAR; `o_war→total_hitter_war` display swap (`pickHitterWar`/`pickPitcherWar`).

### I. VERIFY IN-DB (prod)
Hairston oWAR ~5.1, Helfrick ~2.0, league-avg wRC+ ~100, star pWAR ~5–6 (aces un-buried via D1-FIP), team snapshots
sane, descriptive re-populated (~0.016 down). Cross-check: a hitter's projected oWAR reproduces descriptive to ~0.04.

### J. COLLAPSE / DROP (Track B — SEPARATE, after bulkRecalc retired; own "prod, now?")
- Only after B1 (retire `bulkRecalc` + `import-internal-ratings`) lands: `DROP TABLE player_prediction_internals;`
  then regenerate `src/integrations/supabase/types.ts`. Not part of the WAR replay — its own confirmed step.

---

## The exact code that must be on prod (via feature → staging → main)
Steps 1-5 + collapse code, all committed on `feature/war-recalibration`:
`70738cb` (Steps 1-5) · `584dd4c` (transfer-batch repoint) · `3a0f428` (Sweep A) · `54cdb10`+`cecedee` (Sweep B) ·
`b3d36c7`/`c5aaf12` (docs). Flow: `feature → staging` PR, verify on the Vercel preview (points at PROD Supabase),
then `staging → main` PR — **Trevor clicks the final merge**.

## Post-promotion
- Append A1/A2/B1/B2/C/F1 (and the DROP, when it happens) to `PROD_MIGRATIONS_TODO.md`.
- Post the coach-facing `WhatsNewModal` note (no em dashes) explaining the WAR move — reference `WAR_CHANGELOG.md`.

---

## K. CODE INVENTORY — what is USED vs what ISN'T (branch-vs-staging categorization, 2026-08-16)
Every changed `src/` + edge-fn file on `feature/war-recalibration` was read-diffed and bucketed. The branch is **one
coherent thing: the WAR/wRC+/pRV+ "C1" recalibration** propagated to every live compute site. Nothing unrelated snuck in.

### LIVE — the recalibration (these produce the numbers; must all be on prod)
Three number families, each with a canonical source + all consumers:
- **wRC+ → C1** (`0.011 + 0.691·OBP + 0.235·SLG ÷ 0.3782`, AVG/ISO→0; **rounds to int**). Canonical `src/lib/wrc.ts`
  (`computeWrcPlus`); `src/savant/lib/wrcPlus.ts` re-exports it. Consumers: predictionEngine, transferProjection,
  buildTransferProjectionInputs, jucoReturnerProjection, playerRisk, playerCalcs, useTeamBuilderSimulation, TeamBuilder,
  ReturningPlayers, PlayerProfile, HistoricalPlayerTable, ConferenceStatsTable, JucoPlayerDashboardPanel,
  ConferenceStatsPage; edge fns `process-precompute-jobs`, `recalculate-prediction`, `import-power-ratings-csv`,
  `google-sheets-sync`.
- **oWAR constants** (`runsPerPa 0.3994 / repl 21.22 / RPW 13.1`). Canonical `src/savant/lib/war.ts`. Consumers:
  playerCalcs, depthRoles, transferProjection, buildTransferProjectionInputs, computeAndStoreScores,
  useTeamBuilderSimulation, TeamBuilder, edge fn. New `computeDWar/BsrWar/TotalWar/positional`.
- **pRV+ → D1-FIP index** (new `src/lib/pitcherQuality.ts` `computePrvPlus`, replaces 6-component z-blend); pWAR run-env
  `6.915/1.92/13.1` (`pitchingEquations.ts`); power-rating refits (`powerRatings.ts` baPlus/obpPlus/isoPlus+pullAir,
  ERA/WHIP/HR9, izWhiff dropped). Consumers: transferPitcherProjection, pitcherProjection, projectEffective,
  effectiveProjection, buildTransferPitcherInputs, jucoReturnerPitcherProjection, computeAndStoreScores, PitcherProfile,
  PitchingStatsStorageTable, PitchingPowerRatingsStorageTable, `usePitchingEquationWeights` (DEFAULTS = live fallback),
  JucoPlayerDashboardPanel, edge fn.

### DEAD — retire, no live caller (safe to drop; do NOT count on for outputs)
- `predictionEngine.ts` — `recalculatePredictionById` + `fetchPitcherContext` (callers in PlayerProfile/TeamBuilder
  removed on this branch; "retired dead path" notes remain).
- `src/pages/team-builder/tabs/CompareTab.tsx` — DELETED (superseded build-vs-build compare; zero refs on HEAD). The
  shipped Year-over-Year / Championship-Benchmark analytics **survives** in `AnalyticsTab.tsx` (+ GMAnalytics).
- `createPredictionsFromMaster.ts` — internals-table writes removed (readers repointed to Master by `source_player_id`).

### ORPHAN / INERT — keep-aware (not wrong, just not doing work)
- **`player_prediction_internals` table** — no LIVE reader remains (only reads left are inside the dead
  `recalculatePredictionById`). One orphan WRITER survives: edge fn `import-internal-ratings` (invoked from
  `DataSync.tsx`), now populating a table nothing reads. → **DROP at item J**; retire the edge fn + its DataSync button
  with it. Kept until the full push to main (staging still carries the old reader shells).
- **`platformDefaults.ts` `WRC_PLUS_COEFFICIENTS`** — updated to C1 but has **zero importers**. Intentional mirror for
  the not-yet-built per-program equation-override surface ([[project_per_program_equation_overrides]]); inert today, not
  a wire-up gap. Live math runs off `wrc.ts`.
- **`AdminDashboard.tsx` editor defaults** — seed/reset strings updated to C1. Harmless as display; writes C1 config to
  the DB only if an admin clicks "save defaults." Not touching it.

### CONFIRMATIONS (grep/read, 2026-08-16)
- **Math (rounded wRC+ → WAR):** clean. The rounded `computeWrcPlus` feeds the wRC+ *column* only; displayed WAR is read
  from the stored precompute. The stored WAR pipeline (edge fn) rounds its own wRC+ before oWAR (`index.ts:261/505→1166`)
  — pre-existing, uniform, ≤~0.04 WAR effect. No inconsistency.
- **Internals collapse safe:** grep for `.from('player_prediction_internals')` reads returns only dead-fn hits → the
  write-removal is provably identical for live paths.
- A few display sites (ReturningPlayers/PlayerProfile) now show **integer** wRC+ (rode in with `computeWrcPlus`) — matches
  the stored pipeline; benign, more conventional.

## L. DECISIONS INDEX — where every locked decision lives (so prod-push knows the "why")
| Decision | Home doc / memory |
|---|---|
| Two-number WAR architecture; all modeling LOCKED | `WAR_HANDOFF.md`, `HANDOFF_WAR_REDESIGN_2026_08_13.md`; memory `project_war_system_redesign` |
| Power-rating composite refits (era⁺/baPlus/obpPlus/isoPlus/hr9⁺/whip⁺) | memory `project_power_rating_refits_2026_08_11`; SQL = ledger **B1** |
| Replacement level 21.22 (owar) / 1.62 (pwar), .380/1.92 anchors | `WAR_HANDOFF.md`; ledger B1 |
| pRV+ = D1-FIP index (not z-blend) | `WAR_CHANGELOG.md`; `src/lib/pitcherQuality.ts` |
| Master authoritative (=Baseball Ref); pitch log = engine/cross-check | memory `project_war_pitchlog_migration_master_plan` |
| Stuff+/HTP + conference PARK-FACTOR swap (replaces 100−wRC+ term) | `TRANSFER_ENGINE_AUDIT_2026_08_13.md`; memory `project_transfer_engine_audit`, `project_park_factor_rework` |
| Stuff+ weighting fork A/B/C | ✅ RESOLVED 2026-08-24 = **Option B (pitch-weighted recenter)** + display-only min-pitch qualifier. Empirically confirmed staging is ALREADY B (per-pitch recenter: FA\|R pitch-wt mean 100.12 vs per-pitcher 98.74; SL\|R 100.01 vs 99.48; FA\|L 100.53 vs 98.49) — matches Trevor's instinct, so NO re-score. Curveball-HB sign bug already folded-fixed (`stuffPlusEngine.ts:251`, independent). Docs saying "parked as unweighted" were STALE. Only leftover = a display-only min-pitch qualifier (no recompute). See `TRANSFER_ENGINE_AUDIT_2026_08_13.md` §3b (now closed). |
| Internals collapse (repoint readers → Master; drop table) | `INTERNALS_COLLAPSE_HANDOFF.md`; ledger item J + §K above |
| Step-7 display/snapshot execution (o_war→total_hitter_war swap) | `STEP7_EXECUTION_MAP.md`; memory `project_war_display_audit` |
| NIL allocation curve + budget-flex downscaling | `RSTR_IQ_NIL_Allocation_Spec.md` §2; memory `project_player_score_nil_allocation`. **NOT wired — first NIL code change still pending; gated behind 7b/7c/6b.** |
