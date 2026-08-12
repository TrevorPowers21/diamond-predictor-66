# WAR Redesign + Internals Collapse — Detailed Next Steps (2026-08-12)

Written after committing `70738cb` (Steps 2–5 refit + collapse Phase 1). This is the execution plan from here.
Companions: `WAR_HANDOFF.md` (full modeling state), `INTERNALS_COLLAPSE_HANDOFF.md` (collapse spec), memory
[[project_internals_collapse_plan]].

---

## 0. Where we are (done + verified on staging)

- **Steps 1–5 modeling LOCKED:** C1 wRC+, D1-FIP pRV+, composite refits (era⁺/baPlus/obpPlus/isoPlus/hr9⁺/whip⁺),
  replacement 1.62 wins/600. Synced code + edge port + AdminDashboard + model_config@2026. Pagination + in_zone fixed.
- **Collapse Phase 1 (read-side) DONE + airtight:** hitter-returner backfill and the transfer edge fn both read the
  Master's stored PR by `source_player_id`; `createPredictionsFromMaster` no longer writes internals; dead `seedPower`
  removed. Warm-cache A/B = 0 diffs / 8,236 returners; deterministic. JUCO stays on `projectJucoReturner`.
- **Pitcher returners already collapsed:** `precompute-returner-pitchers.ts` reads Pitching Master `*_pr_plus`
  directly (never internals) — no repoint needed, just a re-run (Step 6).
- Staging **hitter-returner** `player_predictions` currently hold the refit+collapse output (from the A/B runs).

---

## 1. COMPLETE internals surface (re-audit — the 6-site audit was partial)

Everything that still touches `player_prediction_internals`. **All must be gone before `DROP`.**

| # | Site | Kind | Status / action |
|---|---|---|---|
| A | `createPredictionsFromMaster.ts` | WRITE | ✅ REMOVED (this session) |
| B | `backfill-2027-hitter-returners.ts` | READ | ✅ REPOINTED → Master |
| C | `process-precompute-jobs` edge fn | READ | ✅ REPOINTED → Master (deploy pending, Step 6) |
| D | `precompute-transfer-projections.ts:282` (npm `precompute-transfers`, per-team hitter transfer batch) | READ | ⏳ REPOINT → Master (via `buildTransferProjectionInputs`) — mirror the edge fn. Also called by `juco_precompute_all_teams.ts`. |
| E | `src/lib/buildTransferProjectionInputs.ts` | READ (shared builder used by D + interactive TP sim) | ⏳ REPOINT → Master; the shared fix covers D and the interactive path |
| F | `predictionEngine.ts:864` (WRITE) / `:891` (READ) in `fetchPitcherContext` | R/W | ⏳ CLASSIFY live vs dead, then repoint(→Pitching Master `*_pr_plus`) or neuter. Feeds `computePitcherProjection`. |
| G | `predictionEngine.ts` `recalculatePredictionById` reads `:1062/:1176` (+ writes `:1125/:1160`) | R/W | DEAD (audit) → neuter/delete |
| H | `predictionEngine.ts:1337` `bulkRecalculatePredictionsLocal` | READ | LIVE, RETIRE-STAGED (Track B) — do NOT repoint |
| I | `predictionEngine.ts:1612` | READ | ⏳ CLASSIFY (not in original audit) |
| J | `CompareTab.tsx:126/140` | READ | DEAD (hidden tab) → neuter/delete |
| K | `useTeamBuilderSimulation.ts:584` | READ | DEAD (void'd sim) → neuter/delete |
| L | `PlayerProfile.tsx:478` | READ | ⏳ CLASSIFY (dead display per audit note, but confirm) → neuter |
| M | `import-internal-ratings/index.ts:187` | WRITE (CSV importer) | RETIRE (Track B) — source of the 12 orphans |
| N | `src/integrations/supabase/types.ts` | TYPE | regenerate after DROP |
| O | `staging_vs_prod_audit.ts`, `_staging_vs_prod_full.ts` | table-name in audit lists | harmless; drop the entry post-DROP |

**Action item before DROP:** run a fresh repo-wide grep and classify D, E, F, I, L for real (reachability), the same
way the original 6 were done. Do NOT assume the partial audit was complete — it wasn't.

---

## 2. TRACK A — finish Step 6 (returner re-precompute) — NEAR-TERM

Transfers are intentionally NOT run yet (Trevor), so Step 6 now = the **returner** re-precompute + the D1-wide
composite/snapshot refresh. Order matters (inputs before the write that freezes them):

1. **Re-populate `desc_owar` on all-D1 lgwOBA 0.3782** — `populate_descriptive_war.mjs` (already reads 0.3782);
   uniform ~0.016 WAR down. Closes the last descriptive baseline seam.
2. **Hitter returners** — ✅ already current on staging (A/B runs). Re-run once more only if anything changed since.
3. **Pitcher returners** — `npm run precompute-returner-pitchers` (reads the refit Pitching Master `*_pr_plus`
   directly; pushes D1-FIP pRV+ + replacement into pitcher returner `p_war`). **Not yet run this session — required.**
4. **`refresh_composite_war()`** — paste-SQL `20260810_composite_war_d1_rescale.sql` (÷13.1 + full wSB). Run AFTER
   o_war/p_war re-precompute or it mixes scales.
5. **Reseed `team_war_snapshots`** from `desc_pwar`/`desc_owar` (retire the old inline-blend seed SQL on the 5.5/2.5/10 scale).
6. **DO NOT run** `populate-conf-stats` (overwrites the hand-calibrated JUCO overlay). **Ignore JUCO.**
7. **Verify in-DB** (Trevor can't open UI): Hairston oWAR ~5.1, Helfrick ~2.0, league-avg wRC+ ~100, star pWAR ~5–6,
   pitcher returner p_war reflects D1-FIP (aces un-buried).

Gate: everything in §2 is descriptive/returner-only + correction-only — defensible to users via `WAR_CHANGELOG.md`.

---

## 3. COMPLETE THE COLLAPSE (remaining readers) — pairs with the transfer work

Not blocking Step-6-returners, but required before DROP and before transfers run on the new source:

1. **Repoint `buildTransferProjectionInputs.ts` (E)** internals→Master by `source_player_id` (mirror the edge-fn
   diff: read `ba/obp/iso_power_rating`, `scrubPR`, seed-fallback stays only if it exists there). This one fix
   collapses BOTH the `precompute-transfers` script (D) and the interactive TransferPortal path.
2. **Classify + handle F, I, L** (pitcher `fetchPitcherContext`, predictionEngine:1612, PlayerProfile:478) —
   repoint to the Master (`*_pr_plus` for pitcher, `ba/obp/iso_power_rating` for hitter) if live, delete if dead.
3. **Neuter the confirmed-dead reads** G, J, K (recalcById, CompareTab, TB-sim) so nothing live references the table.
4. **A/B each repoint** the same way we did returners where it moves numbers (transfer precompute OLD vs NEW = 0 on
   a warm cache). Transfer A/B rides the edge-fn deploy.

---

## 4. TRACK B — retire + DROP (the durable cleanup)

Only after §1 shows zero live readers remain:

1. **Retire `bulkRecalculatePredictionsLocal` (H)** + the CSV `import-internal-ratings` edge fn (M) — replaced by the
   unified on-upload edge fn. These are the last writers/readers.
2. **Remove dead code:** `computeHitterPowerRatings` in the edge fn (marked dead), any remaining internals plumbing.
3. **`DROP TABLE player_prediction_internals`** — separate, explicitly-confirmed step ("prod, now?" for prod).
4. **Regenerate `types.ts`**; drop the audit-list entries (O).
5. **Unified on-upload edge function** (Track B proper) — pitch-log→derive→marry→ratings→projections, one stored path,
   no live compute. Retires the manual scripts. See [[project_unified_projection_edge_function]].

---

## 5. ADJACENT CLEANUPS (own efforts, captured so they're not lost)

- **Division-table separation** — move JUCO/D2/D3/NAIA out of the D1 Master so PR-creation is D1-only structurally.
  [[project_division_table_separation]]. Plan with the data-model / JUCO work.
- **Postseason inclusion in power-rating sub-metrics** — verify the Master's batted-ball/pitch inputs include
  postseason games (power ratings are season-long; the 5-18 boundary is only for descriptive-WAR accumulation).
- **Retire dead `import-pull-air.ts`** (superseded by pitch-log-derived pull_air).

---

## 6. STEPS 7–8 — market/display + prod replay (later, on Trevor's call)

7. **Market value → projection total** + **display pass 2**: total WAR everywhere (hitters swap `o_war→total_hitter_war`;
   pitchers keep `p_war`); descriptive + gap on the card. Repoint market value at total WAR.
8. **Prod replay** on explicit "prod, now?": prod ALTERs (`desc_*` + `desc_*_reg` columns) + all refits + the collapse
   code + re-precompute, staging-verified first. Prod migrations appended to `PROD_MIGRATIONS_TODO.md`. Post the
   `WhatsNewModal` note when WAR numbers move on prod.

---

## Immediate next action (recommended)
Run **§2** in order (pitcher returners is the one genuinely-missing re-run) — it finishes Step-6-returners and is
pure correction. Then tackle §3.1 (`buildTransferProjectionInputs`) as the highest-leverage remaining collapse fix
(covers two paths at once). Deploy the edge fn + transfer A/B whenever transfers are back on the table.
