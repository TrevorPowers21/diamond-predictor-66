# RSTR IQ — Master Plan: Everything Left to Finish (2026-08-12)

Single source for all remaining work after the internals collapse + Steps 1-5. Supersedes the "next steps" section
of `WAR_COLLAPSE_NEXT_STEPS.md` (kept for the internals-surface table). Companions: `WAR_HANDOFF.md` (modeling
state), `AGENT_LEARNINGS_internals_collapse_2026_08_12.md` (method), memory index.

Branch: `feature/war-recalibration`. Everything below is staging-first; prod only on explicit "prod, now?".

---

## 0. Where we are (done)
- **Steps 1-5 modeling LOCKED + committed** (`70738cb`): C1 wRC+, D1-FIP pRV+, composite refits
  (era⁺/baPlus/obpPlus/isoPlus/hr9⁺/whip⁺), replacement 1.62. Verified: 247 tests + model_config@2026.
- **Internals collapse CODE-COMPLETE** (`584dd4c`/`3a0f428`/`54cdb10`/`cecedee`): all live readers on the Master,
  all dead readers deleted, writer stripped. Only `bulkRecalc` + `import-internal-ratings` still reference the table.
- **Staging hitter-returner projections** already hold the refit+collapse output (from the A/B runs).

## 1. Dependency graph (what gates what)
```
Track A (WAR completion) ── independent of Track B, ships first ──┐
  Step 6 returner re-precompute ─→ Step 7 market/display ─→ Step 8 PROD replay
                                                                  │
Track B (internals retire+DROP) ── needs bulkRecalc retired ──────┤ (prod replay folds collapse code in)
  B1 retire last refs ─→ B2 DROP+types ─→ (B3 unified edge fn, longer build)
                                                                  │
Adjacent cleanups (dead-code audit, unused-data, division split, ─┘ each independent; slot anytime
  postseason check, import-pull-air) ── mostly own efforts
```
**Rule:** Track A can finish on the current scripts without Track B. Track B's DROP waits for `bulkRecalc` to die.
Prod replay (Step 8) is the single event that carries Steps 1-5 + reg columns + collapse code to prod together.

---

## TRACK A — finish the WAR redesign (Steps 6-8)

### Step 6 — returner re-precompute (staging) — NEAR-TERM, correction-only
Order matters (verify inputs before the write that freezes them). Do NOT run `populate-conf-stats`. Ignore JUCO.
1. **Re-populate `desc_owar` on all-D1 lgwOBA 0.3782** — `node scripts/drs/populate_descriptive_war.mjs` (reads
   0.3782). Uniform ~0.016 WAR down; closes the last descriptive baseline seam.
2. **Hitter returners** — already current on staging (A/B runs). Re-run `npm run precompute-returner-hitters` only
   if anything changed since.
3. **Pitcher returners** — `npm run precompute-returner-pitchers`. **← the genuinely-missing run.** Reads the refit
   Pitching Master `*_pr_plus` directly (already collapsed); pushes D1-FIP pRV+ + replacement into pitcher `p_war`.
4. **`refresh_composite_war()`** — paste-SQL `supabase/migrations/20260810_composite_war_d1_rescale.sql` (÷13.1 +
   full wSB). Run AFTER o_war/p_war so it doesn't mix scales.
5. **Reseed `team_war_snapshots`** from `desc_owar`/`desc_pwar` — retire the old inline-blend seed on the 5.5/2.5/10
   scale (`seed_team_war_snapshots_2026.sql`).
6. **Verify in-DB** (Trevor can't open UI): Hairston oWAR ~5.1, Helfrick ~2.0, league-avg wRC+ ~100, star pWAR ~5-6,
   pitcher returner p_war reflects D1-FIP (aces un-buried), team snapshots sane.

### Step 6b — transfer re-precompute (DEFERRED — transfers not running now)
When transfers resume: **deploy the edge fn** (`process-precompute-jobs` — carries refit composites + 1.62 +
Master repoint) via `supabase functions deploy --project-ref <staging>`, then fire per customer team
(`precompute-players` / `rerun_all_teams_precompute`). Run the transfer A/B (OLD-vs-NEW = 0 on a warm cache, same
method as returners) to confirm neutrality. JUCO transfers via `juco-precompute-all` (already repointed).

### Step 7 — market value → total WAR + display pass 2 (staging)
- Repoint market value at **total WAR** (was oWAR). `nil_base_per_owar` stays; the input becomes total_hitter_war.
- Display swap: `o_war → total_hitter_war` where oWAR is the HEADLINE (hitters); pitchers keep `p_war`. Use
  `pickHitterWar`/`pickPitcherWar`. Keep raw `o_war` where it's the batting COMPONENT of a breakdown.
- Surface **descriptive + the gap** (descriptive − projection = buy-low/sell-high) on the player card.
- Verify TWP 2-profiles/2-lines/2-market-values intact.

### Step 8 — PROD replay (on explicit "prod, now?")
Staging fully verified first. One event carries everything to prod:
- **Prod ALTERs:** `descriptive_war_columns.sql` (desc_* ) + the `desc_*_reg` columns (append to a .sql first) +
  `wrc_c1_model_config.sql` + composite/replacement model_config@2026 + `20260810_composite_war_d1_rescale.sql`.
- **Prod code:** the whole `feature/war-recalibration` (Steps 1-5 + collapse) via `feature → staging → main` PRs
  (never feature→main; Trevor drives the final merge).
- **Prod re-precompute:** mirror Step 6 on prod (calculated, not copied — prod resolves its own UUIDs).
- **Deploy the edge fn** to prod after the migrations.
- **Append every migration to `PROD_MIGRATIONS_TODO.md`.** Post the `WhatsNewModal` note when WAR numbers move.

---

## TRACK B — internals retire + DROP (+ the durable edge fn)

### B1 — retire the last three internals references (staging)
1. **`bulkRecalculatePredictionsLocal`** (predictionEngine `:976` read / `:1251` write) — retire the function.
   Callers to unwire: `runDataCascade.ts:61`, `AdminDashboard.tsx` bulk-recalc button, `recompute-stuff-plus.ts:243`,
   `_test_bulk_recalc.ts`. It ALSO calls `recalcReturner/recalcTransfer/recalcPitcher` — those become dead once
   bulkRecalc dies (delete them together). Confirm the import/recompute-stuff/import-juco pipelines don't need the
   projection re-write (they shouldn't post-collapse — projections come from the precompute scripts / edge fn).
2. **`import-internal-ratings` edge fn** — decommission (source of the 12 orphan players). Its UI trigger is the
   unrouted `DataSync.tsx` page. If a CSV power-rating import is ever needed again, rebuild against the Master with a
   real table + import fn (Trevor: "rebuild with usable tables").
3. **Legacy-D1 `precompute-transfers` mode** — the D1 path is superseded by the edge fn; keep only the JUCO path
   (`juco-precompute-all`). Optional: gate the script to `--division JUCO` only.
4. **Remove dead `computeHitterPowerRatings`** in the edge fn (marked dead after seedPower removal).

### B2 — DROP + regenerate types (staging, then prod as a separate confirmed step)
- After B1: repo grep for `player_prediction_internals` = 0 functional refs.
- `DROP TABLE player_prediction_internals;` (paste-SQL, staging; prod on explicit "prod, now?").
- `supabase gen types` → regenerate `src/integrations/supabase/types.ts`; drop the two audit-list entries
  (`staging_vs_prod_audit.ts`, `_staging_vs_prod_full.ts`).

### B3 — unified on-upload edge function (the durable build — larger, own effort)
Trevor's target architecture ([[project_unified_projection_edge_function]]): ONE edge fn fires ON UPLOAD (no button),
weekly through spring: pitch-log lands → derive all metrics (in-zone%, chase, whiff, EV, Stuff+) → marry into the
Masters (pitch-log-owned) → compute power ratings (one stored path, no live compute) → run projections → write
`player_predictions`. Retires the manual scripts; makes today's bug classes (pagination, header-drop) structurally
impossible. This is where bulkRecalc + the CSV cascade are truly replaced. Sequenced AFTER Track A ships.

---

## ADJACENT CLEANUPS (own efforts — slot anytime; logged so they're not lost)

1. **App-wide dead-code audit** — "fixed but never cleared" is prevalent (CompareTab proved it). Known shells left
   THIS session to sweep: `updatePlayerWithRecalc` (TeamBuilder, now session-only, passed to PlayerTableRow but never
   invoked), `savePredEdit`/`startPredEdit`/`updatePrediction` (PlayerProfile, never in JSX), `simulateTransferProjection`
   + `internalsByPredictionId` plumbing (TB-sim, void'd), `DataSync.tsx` (unrouted page). Audit for superseded
   components/functions app-wide; delete with tsc-vs-baseline gating.
2. **Unused-DATA audit** — the DB twin of #1: orphan tables/columns. `player_prediction_internals` is the first
   domino; also review the `reference_prod_schema_audit` cleanup list. Confirm-then-drop, staging first.
3. **Division-table separation** [[project_division_table_separation]] — move JUCO/D2/D3/NAIA out of the D1
   Hitter/Pitching Master into their own table so PR-creation is D1-only STRUCTURALLY (not via scattered `isJuco`
   branches). Migration + rewire every Master reader + JUCO→D1 transfer/career joins. Plan with the JUCO/data-model work.
4. **Postseason-inclusion check** — verify the Master's batted-ball/pitch power-rating sub-metrics INCLUDE postseason
   games (power ratings are season-long; the 2026-05-18 boundary is only for descriptive-WAR accumulation). If they
   exclude postseason, that's a data-inclusion fix (Trevor: "we intentionally include postseason within the full season").
5. **Retire dead `scripts/import-pull-air.ts`** — superseded by pitch-log-derived pull_air.

---

## DEFERRED STUDIES (next offseason — do NOT do inside this redesign)
Each is sound logic blocked on data we can't yet trust (see `WAR_HANDOFF.md` Deferred Studies):
1. **Projection blend 0.7/0.3 per-stat empirical refit** — blocked on consistent YoY Stuff+ + two-directional
   survivorship modeling.
2. **SP↔RP role-transition values** — blocked on reliable role-switch samples.
3. **JUCO / D2 / D3 translation** — hand-calibrated district overrides stay; any change is its own working session.

---

## PROD PROMOTION — the checklist (Step 8 detail)
- Every SQL change → append to repo `PROD_MIGRATIONS_TODO.md`.
- Flow: `feature → staging` PR (`gh pr create`), verify on the Vercel preview (points at PROD Supabase), then
  `staging → main` PR — **Trevor clicks the final merge**.
- Prod re-precompute is CALCULATED on prod (its own UUIDs), never copied from staging.
- Edge fn deployed to prod AFTER migrations (`--project-ref trbvxuoliwrfowibatkm`).
- Post the `WhatsNewModal` coach-facing note when WAR numbers move on prod (no em dashes).

---

## RECOMMENDED ORDER
1. **Step 6 returners** (pitcher-returner precompute + composite/snapshot refresh) — finishes the real WAR numbers,
   correction-only, low-risk. ← do first.
2. **Step 7** market/display pass 2 (staging).
3. **Track B1 + B2** — retire the last internals refs + DROP (staging), once Step 6 confirms nothing else needs bulkRecalc.
4. **Step 8** prod replay (on "prod, now?") — carries Steps 1-5 + reg columns + collapse code together.
5. **Adjacent cleanups** + **B3 unified edge fn** — as their own efforts, after the WAR ships.
