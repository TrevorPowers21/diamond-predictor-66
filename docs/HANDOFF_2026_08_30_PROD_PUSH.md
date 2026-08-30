# ▶️ HANDOFF — RSTR IQ prod push, 2026-08-30. START HERE.

## READ IN THIS ORDER (do not skip)
1. **`docs/STUFF_PLUS_SOURCE_OF_TRUTH.md`** — which Stuff+ lane is real. Non-negotiable context.
2. **`docs/STUFF_PLUS_EXACT_VALUES.md`** — every threshold, both negative results, all execution logs. §11–§12.
3. This file's **CURRENT STATE** + **NEXT ACTIONS** below.
4. **`PROD_MIGRATIONS_TODO.md`** — the ledger. **Append every prod change, no exceptions.**
5. Memory: `project_stuff_plus_v2_locked` · `project_prod_push_in_progress` · `reference_db_direct_sessions`
   (both `PGURI`s are SAVED — never ask for DB passwords again).

---
## ✅ CURRENT STATE — THE STUFF+ BLOCK IS DONE ON BOTH ENVIRONMENTS
| | STAGING | PROD |
|---|---|---|
| classified + stamped `v2-ranges-2026-08-28` | 2,015,321 | **2,013,005** |
| label distribution | 4S 37.8 · SI 16.0 · SL 10.3 · GY 10.2 · CH 9.1 · CB 5.6 · SW 5.2 · FC 3.7 · SPL 2.1 | **IDENTICAL** |
| needs_review | 8.1% | 8.1% |
| baseline armHB sign check | 18/18 | **18/18** |
| scored + recentered (0 unscored) | 2,015,321 | **2,013,005** |
| per-pitcher Stuff+ gate | mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 | **IDENTICAL** |
| aggregations | 48/48 + run values | **48/48 + run values (24.3 min)** |
| Masters (step 5) | 4,772 pitchers · 0 new rows | **4,772 pitchers + 4,373 hitters · 0 new rows** |
Two different pitch populations → the same numbers. That is **independent replication**, not a self-check.

**PROD PREREQS ALSO DONE:** 3 × `team_season_stats` migrations (dependency order) · `pitch_log_corrected` view rebuilt
94→102 cols · backups `_v2_prechain_backup` (2,576,146) · `_hm_prestep5_backup` (30,025) · `_pm_prestep5_backup` (29,238).
**Classifier:** `src/savant/lib/stuffPlusClassifierV2.ts` @ **95.2% / 95.3%**.

---
## ▶️ NEXT ACTIONS, IN ORDER (prod)
1. ~~**C24** `backfill_trackman_pitches_pitching_master.ts`~~ ✅ **DONE 2026-08-30** — patched to be PITCH_LOG-FIRST for
   D1 with a JUCO legacy fallback (the legacy source undercounted by ~12.1 pitches/pitcher and agreed with pitch_log
   for only 11.9% of pitchers). Applied 5,618 rows. Gate: D1 5,375/5,375 · NJCAA_D1 2,695/2,695 · D2 1/1.
2. ~~**C27 `computeNcaaAverages`**~~ ✅ **DONE 2026-08-30** — 72 fields, 40 model_config rows;
   `p_ncaa_avg_stuff_plus` 101.8341 → **100.0141** (confirms the recenter survived the whole chain).
3. ~~**C26** `computeAndStoreScores` (propagate=false)~~ ✅ **DONE 2026-08-30** — pitchers 8,071 / hitters 8,244,
   0 errors, `player_predictions` untouched. Added the missing double-keyed `--prod` guard to
   `_run_store_no_propagate.ts` first (its banner had claimed "staging" while writing prod).
4. ~~**C29 NJCAA_D1 re-tag**~~ ✅ **DONE 2026-08-30** — 10 rows re-tagged; prod now `D1 30 · NJCAA_D1 10 · D2 2`,
   0 NJCAA rows remain tagged D1 (matches staging). C28 is now safe to run.
5. **C28** conference stats — G-GATE on staging first · bucketA **PASTE, never `--linked`** · `compute_conf_pitcher_env_plus`
   · `derive_conf_opr_htp`. ⛔ **NEVER run `populate-conf-stats`** (overwrites the hand-calibrated JUCO overlay).
6. **Phase D** dWAR/bsrWAR (D30–34). Pagination fixed. ⚠ enable RLS on `player_season_defense`/`_baserunning` FIRST.
7. **Phase E** ★order: TWP detector FIRST → returner pitchers → returner hitters → `_run_step2_all.sh --prod`.
8. **Phase F** ★order: `refresh_composite_war()` (÷13.1) **only now** → snapshot WAR → TWP markets → resyncs
   (**F42 must use `--all`** — its default scope is a STAGING build id, 0 rows on prod) → re-price → heal →
   `refresh_team_season_stats(2026)` **LAST**.
9. **Phase G** edge fn deploy (Trevor) — `--project-ref trbvxuoliwrfowibatkm`, **never `--linked`**.
10. **Preview-verify → `gh pr create` staging→main → Trevor merges → Phase H drops.**

**🛑 PRE-FLIGHT EVERY REMAINING STEP (3 for 3 caught this way — C24 legacy lane · C26 no guard · C27 wrong order):**
(1) Which LANE does it read — pitch_log or the legacy PSP-I? (2) Does it have a working double-keyed `--prod` guard?
(3) Is its ORDER right, and does anything it depends on fall back to defaults SILENTLY?

**PHASE-GATE EVERY STEP:** count non-null BEFORE and AFTER · compare to staging for the **same season** · validate by
CONTENT not exit code · verify FRESHNESS not row count. "Column exists" ≠ "column populated".

---
## 🛑 MISTAKES MADE — DO NOT REPEAT
- **A subagent given prod credentials called `refresh_composite_war()` "to see if it existed" and wrote ~112k live rows.**
  → Give subagents STAGING only, or no `.rpc` capability. To check existence, query `pg_proc` / `information_schema`.
- **Reported "5,215 rows touched" after checking ONE season.** It was both. → 2026 = descriptive, 2027 = projections.
- **Claimed the docs were consistent having only checked the ones I edited.** A sweep found 12 more. → Verify, don't assert.
- **Marked a run COMPLETE by exit code** when a dimension had FAILED. → Validate by log content.
- **Twice nearly shipped a blanket `order("id")`** that breaks tables with no `id` (`pitch_log_*_totals`,
  `player_season_defense/baserunning`). → Confirm the PK first.
- **Appended every correction to the BOTTOM of docs**, so a top-down reader hit stale instructions. → Inline 🛑 markers.
- **Called a transient failure "structural."** → Environmental failures die at a DIFFERENT point each run; structural
  ones die at the SAME place with the SAME duration.
- **Raised a false `trackman_pitches` regression** by comparing mismatched denominators. → Compare like-for-like
  against the BACKUP before calling anything a regression.
- **`--direct` with `statement_timeout=0` hung prod for 39 min** — it removes the ceiling AND the failure signal.
  → TODO: `keepAlive` + FINITE `query_timeout` + per-dimension progress logging.

## 📌 STANDING RULES
Prod writes need an explicit **"prod, now?"** · dry-run first · long steps run **detached** with
`caffeinate -dimsu -w <pid>` · **step 3 does NOT resume** (full runtime per attempt; a mid-run failure leaves v2 labels
+ STALE scores) · **step 4 on prod REQUIRES `--direct`** · never route Stuff+ through the legacy PSP-I lane (it scores
LHP backwards) · never create Master rows implicitly · **never drop** `_reclass_result` / `_reclass_map` /
`_reclass_pf` / `team_war_snapshots` · log every prod change to `PROD_MIGRATIONS_TODO.md` before moving on.

---
# ✅ C24 `trackman_pitches` — PITCH_LOG-FIRST for D1, LEGACY only for JUCO (fixed + applied to prod 2026-08-30)
**THE BUG:** `backfill_trackman_pitches_pitching_master.ts` summed `pitcher_stuff_plus_inputs.pitches` — the LEGACY
CSV-fed table — to set `trackman_pitches`. That column is the **TrackMan sample-size gate for the Stuff+ display
qualifier**, so it MUST come from the same lane as the Stuff+ values it gates. Same defect shape as
`computeNcaaAverages`: the VALUE moved to the pitch_log lane but a supporting COUNT was left on the legacy table.
**MEASURED ON PROD — the two sources disagree badly:** of 5,367 shared pitchers only **638 (11.9%) were IDENTICAL**;
the legacy table **UNDERCOUNTS by ~12.1 pitches/pitcher** (2,507,664 vs 2,572,528 total, ~65k pitches missing).
An undercount pushes borderline thin-sample arms the WRONG way on the leaderboard.

**THE FIX (Trevor: "keep juco and true ncaa d1 separate"):**
- **D1 → `pitch_log_pitcher_totals.total_pitches` at `dimension_key='all'`** (5,509 pitchers).
- **JUCO → `pitcher_stuff_plus_inputs` fallback.** JUCO has **NO pitch logs at all** — that is the 7,013 vs 5,509
  pitcher gap. Never mix the two lanes; never "fix" JUCO by pointing it at pitch_log.
Implementation: new `pageAll2()` helper (ordered pagination + `dimension_key` filter); pitch_log values OVERRIDE the
legacy sums where present, legacy remains only where pitch_log has nothing.

**DRY RUN (prod):** `pitch_log (D1): 5,509 pitchers · OVERRODE 5,509 with pitch_log · 1,646 remain legacy-sourced
(JUCO / no pitch log) · would change 5,618 Master rows (5,376 NULL, 242 different)`. Values demonstrably changed vs the
legacy version (e.g. `13108257 314→375`, `14110428 1016→685`, `19295025 1280→1435`) — proof the legacy source was wrong.
**APPLIED:** 5,618 rows written.
**PHASE GATE PASSED:** `D1 5,375/5,375` · `NJCAA_D1 2,695/2,695` · `D2 1/1` — 100% coverage, each from the correct lane.

---
# ✅ C27 → C26 APPLIED TO PROD 2026-08-30 (order is load-bearing — C27 FIRST)
## C27 `computeNcaaAverages` — ✅ APPLIED
`hittersUsed 5,340 · pitchersUsed 5,375 · fieldsWritten 72 · modelConfigRowsWritten 40 · ncaa_averages 2026 = 1 row`
**`p_ncaa_avg_stuff_plus` 101.8341 → 100.0141** · `p_sd_stuff_plus = 5.04577` · `p_ncaa_avg_whiff_pct = 23.3673`.
★ **The Stuff+ mean landing at 100.01 is independent CONFIRMATION that the recenter survived the whole chain**
(score → aggregate → Master rollup). The old 101.83 came from the legacy-weighted lane.
⚠ **C27 MUST PRECEDE C26.** `computeAndStoreScores.ts:206-211,:249` reads baselines from `ncaa_averages` and, for any
MISSING field, falls back to HARDCODED defaults **SILENTLY** (`:212-215`). Wrong order ⇒ quietly wrong power ratings
with no error. This ordering was inverted in the docs and is now corrected everywhere.

## C26 `computeAndStoreScores` (propagate=false) — ✅ APPLIED
`pitchers 8,071 updated, 0 errors · hitters 8,244 updated, 0 errors` · `propagate=false` honored on BOTH sides
(**`player_predictions` untouched** — it is Phase F that repopulates those).
🛑 **BUG FIXED BEFORE RUNNING:** `scripts/_run_store_no_propagate.ts` had **NO env guard** and its banner claimed
"staging" while `--env-file .env.production.local` would happily write PROD. Added the standard double-keyed guard
(URL and `--prod` must AGREE) and made the banner print the resolved env. Refuse path verified:
running against the prod env WITHOUT `--prod` now aborts with `✗ URL is PROD but --prod was not passed`.

## PATTERN WORTH NOTING (3 for 3 on the last three steps)
C24 was sourcing from the LEGACY lane · C26's runner had no guard and a banner that LIED about the target DB · C27 was
documented in the wrong ORDER. **Every one was caught by inspecting the step before running it, not after.** Do not
run a remaining step (C28/C29, D, E, F) without first checking: (1) which LANE does it read from — pitch_log or the
legacy PSP-I? (2) does it have a working double-keyed `--prod` guard? (3) is its position in the sequence right, and
does anything it depends on fall back to defaults SILENTLY?

---
# ✅ C29 NJCAA_D1 RE-TAG — APPLIED TO PROD 2026-08-30 (MUST run BEFORE C28)
**BEFORE:** prod `Conference Stats` 2026 = `D1 40 · D2 2`, of which **10 were `NJCAA%` districts wrongly tagged
`division='D1'`** (Appalachian, East, Mid-South, Midwest, Plains, South Atlantic, South Central, South, Southwest, West).
**APPLIED:** `update "Conference Stats" set division='NJCAA_D1' where season=2026 and division='D1' and
"conference abbreviation" like 'NJCAA%'` → **10 rows re-tagged**.
**AFTER (verified):** `D1 30 · NJCAA_D1 10 · D2 2` — **0 NJCAA rows remain tagged D1**. Matches staging exactly.
⚠ **ORDER IS LOAD-BEARING — C29 BEFORE C28.** Both C28 producers (`compute_conf_pitcher_env_plus`,
`derive_conf_opr_htp`) filter on `division`. Running C28 first writes D1-derived values into the JUCO overlay and
CONTAMINATES the JUCO baselines silently — the same "keep JUCO and true NCAA D1 separate" principle applied in C24.
Also: with 10 JUCO rows counted as D1, the D1 conference SDs were inflated (JUCO FIP runs 6.4–8.0).
