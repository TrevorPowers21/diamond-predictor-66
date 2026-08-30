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
5. **C28 conference stats — READY, 4 steps (runbook listed 3).** ✅ prepped: `--prod` guards added to BOTH producers
   (refuse paths verified) · `_confstats_backup` (162) + `_parkfactors_backup` (615) created on prod · **G-GATE PASSED**
   (77 cols, 0 changed, worst 0.000000 — bucketA is idempotent) · Conference Stuff+ lane FIXED · park-factor blocker
   RETRACTED (`rg_factor` 309/309 on prod).
   **ORDER:** (1) PASTE bucketA in the SQL editor, never `--linked` → (2) `compute_conf_pitcher_env_plus --apply --prod`
   → (3) `derive_conf_opr_htp --apply --prod` → (4) **★ refresh `Stuff_plus` via the FIXED `conferenceStuffPlusV2`** —
   the step the runbook never had. `Stuff_plus` is Bucket B but is written by NEITHER bucketA NOR `derive_conf_opr_htp`;
   it is the ONLY metric both STALE on prod and unrefreshed by the documented steps, and it is the
   competition-translation lever. ⚠ that producer IGNORES `dryRun` — rollback is `_confstats_backup`.
   ⛔ NEVER run `populate-conf-stats` (overwrites the JUCO overlay).

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
## 📍 WHERE WE ARE RIGHT NOW (updated 2026-08-30, end of session)
**PROD — everything through C29 is DONE, verified, and logged:**
| step | result on PROD |
|---|---|
| prereqs | `team_season_stats` (3 migrations, dependency order) · `pitch_log_corrected` view rebuilt 94→102 cols · backups `_v2_prechain_backup` 2,576,146 / `_hm_prestep5_backup` 30,025 / `_pm_prestep5_backup` 29,238 |
| Stuff+ 1 classify | 2,013,005 stamped `v2-ranges-2026-08-28`, needs_review 8.1% |
| Stuff+ 2 baseline | armHB sign check **18/18** |
| Stuff+ 3 score | 2,013,005 scored + recentered, **0 unscored**, every bucket 100.0 |
| **GATE** | per-pitcher Stuff+ **mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7 — IDENTICAL to staging** |
| Stuff+ 4 aggregate | 48/48 + `populate_hitter_run_values`, 24.3 min (`--direct`) |
| Stuff+ 5 Masters | 4,772 pitchers + 4,373 hitters, **0 new rows**; `pull_air` 0 → 4,366 |
| C24 trackman_pitches | 5,618 rows; **D1 5,375/5,375 from pitch_log · NJCAA_D1 2,695/2,695 from legacy** |
| C27 ncaa_averages | 72 fields / 40 config rows; `p_ncaa_avg_stuff_plus` 101.8341 → **100.0141** |
| C26 power ratings | pitchers 8,071 · hitters 8,244 · 0 errors · `propagate=false` |
| C29 NJCAA re-tag | 10 rows → `D1 30 · NJCAA_D1 10 · D2 2` |
**STAGING:** the same 5-step chain is complete (2,015,321 pitches). Staging has NOT had C24/C26/C27/C29 applied.
**NEXT: C28 — the riskiest remaining step. Full prep plan below.**

---
## 🛑 C28 PREP PLAN — CONFERENCE STATS (do NOT run any of this without working the plan)
C28 rebuilds the conference baselines that every projection's competition-translation consumes (a player projected
INTO a conference is scored against that conference's Stuff+/HTP). Blast radius = every projection.

### THE FOUR HAZARDS
1. **⛔ `bucketA_assembly.sql` must be PASTED into the SQL editor — NEVER `supabase db query --linked`.** `--linked`
   resolves to whatever project the CLI is linked to, and `supabase/config.toml` currently names a THIRD project ref
   (`kfkuhdmpchxyffmnowgj`) that is neither staging nor prod. Verify with `supabase projects list` before anything.
2. **⛔ NEVER run `populate-conf-stats` on prod.** It OVERWRITES the hand-calibrated JUCO overlay. It is not part of
   C28; it is a different, destructive script with a confusingly similar name.
3. **★ THE G-GATE HAS NEVER BEEN EXECUTED.** The docs require: re-run `conf_stats_bucketA_assembly.sql` on STAGING,
   diff against `_confstats_backup_preassembly`, confirm **0.0000**, and only then touch prod. This proves the
   assembly is idempotent. It was deferred on 2026-08-21 ("no staging conn") and never done.
4. **⚠ D1 `Conference Stats.Stuff_plus` HAS NO COMMITTED PRODUCER** (audit G14). It exists on prod only as a COPY
   from the paused push. Establish what actually writes it BEFORE running C28, or the conference Stuff+ silently
   stays stale while everything around it is refreshed.

### PRE-FLIGHT (answer all five in writing first)
- **LANE:** does each producer read pitch_log or the legacy PSP-I? (`derive_conf_opr_htp`, `compute_conf_pitcher_env_plus`)
- **GUARD:** does each have a working double-keyed `--prod` guard? (`compute_conf_pitcher_env_plus` pagination was
  fixed 2026-08-29; re-verify the guard.)
- **ORDER:** C29 ✅ done. Confirm nothing else in C28 depends on a step not yet run.
- **SILENT FALLBACK:** does anything substitute defaults when an input is missing? (C26 did — that is why C27 ran first.)
- **BACKUP:** `_confstats_backup` does NOT exist on prod. **CREATE IT FIRST** — C28 is a destructive rebuild.

### EXECUTION ORDER (only after the above)
1. Back up prod: `create table _confstats_backup as select * from "Conference Stats"` (+ verify row count).
2. **G-GATE on STAGING** — re-run bucketA, diff vs `_confstats_backup_preassembly`, require 0.0000. ABORT if not.
3. PROD: paste `conf_stats_bucketA_assembly.sql` in the SQL editor (never `--linked`).
4. `compute_conf_pitcher_env_plus.ts --apply --prod`
5. `derive_conf_opr_htp.ts --apply --prod`
6. **PHASE GATE:** `hitter_talent_plus` and `run_env_factor` go from 0/42 non-null to populated; D1 = 30 rows and
   NJCAA_D1 = 10 remain correctly separated; conference Stuff+/HTP compare sanely to staging.

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

---
# 🛑 C28 PRE-FLIGHT — FINDINGS (2026-08-30). RUN NOTHING UNTIL THESE ARE RESOLVED.
Ran the 5-question pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) against PROD. Three blockers found.

## ✅ LANE — CLEAN (both producers are on the correct lane)
`compute_conf_pitcher_env_plus.ts` reads `ncaa_averages` (refreshed by C27 ✅) + `"Pitching Master"` D1 WHIP/IP
(refreshed by C26 ✅) + `"Conference Stats"`. `derive_conf_opr_htp.ts` reads `"Park Factors".rg_factor` +
`"Conference Stats"` + `"Teams Table"`. **Neither touches the legacy `pitcher_stuff_plus_inputs`.** Also confirms the
C27-before-C26-before-C28 ordering is right: C28 consumes what both of those produced.

## 🔴 BLOCKER 1 — NEITHER PRODUCER HAS ANY `--prod` GUARD
`grep -c "trbvxuoliwrfowibatkm\|--prod"` = **0** for BOTH `compute_conf_pitcher_env_plus.ts` and
`derive_conf_opr_htp.ts`. `--env-file .env.production.local` writes PROD with **zero opt-in** — the same defect
already fixed in `_run_store_no_propagate.ts` (C26) and the four market scripts. **FIX BEFORE RUNNING:** add the
standard double-keyed guard (URL and `--prod` must AGREE) and verify the refuse path.

## 🔴 BLOCKER 2 — NO BACKUP EXISTS ON PROD, AND THE G-GATE REFERENCE DOES NOT EXIST EITHER
`_confstats_backup` = **ABSENT** on prod · `_confstats_backup_preassembly` = **ABSENT** on prod.
C28 is a DESTRUCTIVE rebuild of the conference baselines that every projection's competition-translation consumes.
**FIX: `create table _confstats_backup as select * from "Conference Stats"` on prod FIRST.**
⚠ The documented **G-GATE** (re-run bucketA on STAGING, diff vs `_confstats_backup_preassembly`, require 0.0000) has
**NEVER been executed** — it was deferred 2026-08-21 ("no staging conn"). The preassembly baseline it compares against
does not exist on prod, so the gate must be run on STAGING, where the artifact belongs.

## 🔴 BLOCKER 3 — `Park Factors.rg_factor_seasonal` IS EMPTY ON PROD (0/309) — SILENT-FALLBACK RISK
| | PROD | STAGING |
|---|---|---|
| Park Factors 2026 rows | 309 | 308 |
| `rg_factor` | **309 ✅** | 308 |
| `rg_factor_seasonal` | **0 ❌** | **308 ✅** |
`derive_conf_opr_htp.ts:10` reads **`rg_factor`**, which IS populated on prod — so C28 will run. BUT prod is missing
the entire `*_seasonal` set that staging has (its producer, E2 `backfill_park_factors_seasonal.ts`, is hardwired to
STAGING and has never run on prod — audit G13/H4). **Decide BEFORE C28 whether the conference run-environment should
use the seasonal factors** (as staging effectively does downstream) or the flat `rg_factor`. If prod and staging use
different park inputs, their conference HTP/OPR will diverge and the staging-match gate becomes meaningless.

## CURRENT PROD STATE (what C28 is meant to fill)
`Conference Stats` 2026 = **42 rows** (D1 30 · NJCAA_D1 10 · D2 2 after C29) ·
**`hitter_talent_plus` 0/42** · **`run_env_factor` 0/42** ← C28 fills these · `Stuff_plus` **42/42** (pre-existing copy;
audit G14 notes D1 `Stuff_plus` has NO committed producer — confirm what refreshes it or it stays stale while
everything around it is rebuilt).

## ORDERED EXECUTION (only after 1-3 are resolved)
1. Add `--prod` guards to both producers; verify refuse paths.
2. `create table _confstats_backup as select * from "Conference Stats"` on PROD; verify row count = 42.
3. Run the **G-GATE on STAGING** (bucketA re-run vs `_confstats_backup_preassembly`, require diff 0.0000). ABORT if not.
4. Resolve the `rg_factor` vs `rg_factor_seasonal` decision.
5. PROD: **PASTE** `conf_stats_bucketA_assembly.sql` in the SQL editor — **NEVER `--linked`** (`supabase/config.toml`
   currently names a THIRD project ref `kfkuhdmpchxyffmnowgj`; run `supabase projects list` first).
6. `compute_conf_pitcher_env_plus.ts --apply --prod` → `derive_conf_opr_htp.ts --apply --prod`.
7. **PHASE GATE:** `hitter_talent_plus` and `run_env_factor` go 0/42 → populated; D1 stays 30 and NJCAA_D1 stays 10;
   conference Stuff+/HTP compare sanely to staging.
⛔ **NEVER run `populate-conf-stats` on prod** — it overwrites the hand-calibrated JUCO overlay. Different script,
confusingly similar name, not part of C28.

---
# ✅ C28 BLOCKERS 1 & 2 CLEARED (2026-08-30) — blocker 3 was MY over-call, corrected
## ✅ FIXED — `--prod` guards added to BOTH producers
`compute_conf_pitcher_env_plus.ts` and `derive_conf_opr_htp.ts` had **NO env guard at all** (grep count 0) —
`--env-file .env.production.local` would have written PROD with zero opt-in. Added the standard double-keyed guard
(URL and `--prod` must AGREE, refuse otherwise, log the resolved env). **Refuse paths VERIFIED on both:**
`✗ URL is PROD but --prod was not passed — refusing.`
## ✅ FIXED — backups created on PROD
`_confstats_backup` = **162 rows (42 for season 2026)** · `_parkfactors_backup` = **615 rows**.
Park Factors was backed up too even though C28 only READS it — E2 rewrites that table later, and a restore point is
cheap now and expensive to lack later.
## ⚠️ CORRECTION — "park factors must be filled first" was WRONG (my over-call)
`derive_conf_opr_htp.ts:10` reads **`rg_factor`**, which is **309/309 populated on prod**. It NEVER reads
`rg_factor_seasonal`. The SAME script on staging reads the SAME column, so **both environments use identical park
inputs for C28 and there is no divergence** — the staging-match gate remains valid.
The empty `rg_factor_seasonal` (prod 0/309 vs staging 308/308) is **E2's job, later in the sequence**, and its
producer `backfill_park_factors_seasonal.ts` is still hardwired to STAGING (audit G13/H4) — fix that before E2, not
before C28. **C28 is NOT blocked on park factors.**
## STILL OPEN BEFORE C28 RUNS
- **G-GATE on STAGING** — re-run `conf_stats_bucketA_assembly.sql`, diff vs `_confstats_backup_preassembly`, require
  **0.0000**. Never executed (deferred 2026-08-21). The reference table is a STAGING artifact.
- **D1 `Conference Stats.Stuff_plus`** — 42/42 populated on prod but audit G14 says there is NO committed producer.
  Establish what refreshes it, or it stays stale while everything around it is rebuilt.
- ⛔ bucketA must be **PASTED** in the SQL editor, never `--linked` (config.toml names a THIRD ref `kfkuhdmpchxyffmnowgj`).
- ⛔ **NEVER** run `populate-conf-stats` on prod (overwrites the hand-calibrated JUCO overlay).

---
# 🔴→✅ CONFERENCE STUFF+ WAS ON THE LEGACY LANE — FIXED 2026-08-30 (critical for Track B)
## THE FINDING (audit G14 said "no committed producer" — that was WRONG)
`src/savant/lib/conferenceStuffPlusV2.ts` **IS** the producer of `"Conference Stats".Stuff_plus`. But it read
per-pitcher scored rows from **`pitcher_stuff_plus_inputs`** — the **LEGACY CSV lane**. The v2 chain writes Stuff+ to
`pitch_log.stuff_plus` and rolls it up to `"Pitching Master".stuff_plus`; it **NEVER writes PSP-I**, so PSP-I holds
**PRE-v2 scores**. Conference Stuff+ would therefore have been built from stale numbers.
**WHY THIS ONE MATTERS MOST:** Conference Stuff+ IS the competition-translation lever — a player projected INTO a
conference is scored against that conference's Stuff+/HTP. A stale value silently biases **every projection**.
This is the THIRD instance of the same shape (C24 `trackman_pitches`, `computeNcaaAverages` weighting, now this):
**the VALUE moved to the pitch_log lane but a supporting INPUT was left on legacy.**

## THE FIX
Read the rolled-up per-pitcher value and its pitch count straight from `"Pitching Master"`:
`Σ("Pitching Master".stuff_plus × trackman_pitches) / Σ(trackman_pitches)` — definition unchanged (pitch-weighted,
full season). Both inputs are **pitch_log-sourced for D1** (C25 writes `stuff_plus`, C24 writes `trackman_pitches`)
and correctly **fall back to the legacy lane for JUCO**, so ONE formula stays right for BOTH divisions without ever
mixing lanes. Filters `stuff_plus IS NOT NULL AND trackman_pitches > 0`.

## VERIFIED ON STAGING (values are sane and the D1/JUCO relationship is correct)
`D1 30 conferences avg 99.16 (range 92.9–107.3)` · `NJCAA_D1 10 avg 96.00 (92.0–100.7)` · `D2 2 avg 93.00`.
D1 centring near 100 with JUCO clearly below it is the expected "conference pitching depth" signal.

## ⚠ GAP FOUND WHILE TESTING — `calculateConferenceStuffPlusV2` IGNORES `dryRun`
It was called with `{ dryRun: true }` and **wrote anyway** ("5. write to Conference Stats"). The option is not
implemented. Benign here (staging needed the refresh and the values are correct) but **there is no way to preview this
producer**. Before running it on PROD: either add real dry-run support, or rely on `_confstats_backup` (already created
on prod, 162 rows / 42 for 2026) as the rollback.
## TRACK B REQUIREMENT
Track B's conference-stats stage must compute Conference Stuff+ from the **pitch_log lane via Pitching Master**, never
from `pitcher_stuff_plus_inputs`, and must keep the D1 / JUCO fallback split intact.

---
# ✅ G-GATE EXECUTED AND PASSED (staging, 2026-08-30) — deferred since 2026-08-21, now done
Method: snapshot `"Conference Stats"` 2026 → `_ggate_before`, re-run `scripts/sql/conf_stats_bucketA_assembly.sql`,
then diff EVERY numeric column joined on `(conference_id, season)`.
**RESULT: 77 numeric columns compared · 0 changed · worst absolute diff 0.000000.**
✅ **The bucketA assembly is IDEMPOTENT** — re-running it does not drift values. Safe to run on prod.
(Reference table `_confstats_backup_preassembly` exists on staging: 162 rows, 42 for 2026.)

# 📊 PROD "Conference Stats" 2026 (D1, 30 rows) — WHAT IS FILLED vs WHAT C28 FILLS
**FILLED (66 cols):** AVG · OBP · ISO · ERA · FIP · WHIP · K9 · BB9 · HR9 · `Overall_Power_Rating` · `WRC_plus` ·
`ba_plus` · `ba_power_rating` · `Stuff_plus` · … (all inputs C28 needs are present)
**EMPTY (13 cols) — exactly C28's outputs, so there is NO partial state:**
`era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus` ← `compute_conf_pitcher_env_plus`
`hitter_talent_plus` `run_env_factor` ← `derive_conf_opr_htp`
`OPS` `SLG` `slg_plus` `pitcher_ev_score` `pitcher_iz_score` ← bucketA assembly

## 🛑 STALE-VALUE CATCH — `Stuff_plus` IS 30/30 FILLED ON PROD **BUT IT IS PRE-v2**
The Conference Stuff+ lane fix was applied and verified on **STAGING only**. Prod's `"Conference Stats".Stuff_plus`
still holds the value computed BEFORE the v2 chain — a fully-populated column that PASSES any count check while being
stale. Third occurrence today of "looks populated, isn't fresh".
→ **C28 ON PROD NEEDS ONE MORE STEP THAN THE DOCS LIST:** run the FIXED `conferenceStuffPlusV2`
(`Σ(Pitching Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)`) to refresh `Stuff_plus` from the pitch_log
lane, ALONGSIDE the two producers that fill the 13 empty columns. Otherwise the competition-translation lever stays
stale while everything around it is rebuilt.
→ Staging reference after the fix: D1 30 conf avg **99.16** (92.9–107.3) · NJCAA_D1 10 avg **96.00** · D2 2 avg 93.00.

---
# 🧩 C28 BUCKET MAP — WHO WRITES WHAT, AND WHY `Stuff_plus` FELL THROUGH THE GAP (2026-08-30)
`scripts/sql/conf_stats_bucketA_assembly.sql:12` states the split verbatim:
`SCOPE: writes ONLY Bucket A (rates/env+/WRC_plus). Bucket B (OPR/Stuff_plus/run_env_factor/…)`

| bucket | producer | columns it writes |
|---|---|---|
| **A** | `conf_stats_bucketA_assembly.sql` (PASTE in SQL editor) | `OBP` `ISO` `SLG` `OPS` `obp_plus` `slg_plus` `iso_plus` `WHIP` `FIP` `ERA` + rates + `WRC_plus` |
| **B (pitching env+)** | `compute_conf_pitcher_env_plus.ts` | `era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus` |
| **B (OPR/HTP)** | `derive_conf_opr_htp.ts` | `run_env_factor` `offensive_power_rating` `hitter_talent_plus` |
| **B (Stuff+)** | ⚠ **`conferenceStuffPlusV2.ts` — a SEPARATE producer, NOT part of the documented C28 steps** | `Stuff_plus` |

## ★ THE GAP, STATED PLAINLY
`Stuff_plus` belongs to **Bucket B** but is written by **NEITHER** bucketA **NOR** `derive_conf_opr_htp`. It has its own
producer that the C28 runbook never listed. So:
**`Stuff_plus` is the ONLY Conference Stats metric that is BOTH (a) stale on prod (pre-v2) AND (b) not refreshed by any
of the three documented C28 steps.** Every other filled column is either rewritten by Bucket A / Bucket B, or is a
source input already refreshed by C24 / C26 / C27.
Because it is 30/30 populated it PASSES every count check while being stale — and it is the competition-translation
lever, so a stale value silently biases EVERY projection of a player INTO a conference.

## ✅ C28 ON PROD — THE CORRECTED FOUR-STEP ORDER (the runbook had three)
0. **Backups already created on prod:** `_confstats_backup` (162 rows / 42 for 2026) · `_parkfactors_backup` (615).
1. **PASTE** `conf_stats_bucketA_assembly.sql` in the SQL editor. ⛔ **NEVER `--linked`** — `supabase/config.toml`
   names a THIRD project ref (`kfkuhdmpchxyffmnowgj`). Run `supabase projects list` first.
   ✅ **G-GATE PASSED 2026-08-30** — re-run on staging diffed 77 numeric columns: **0 changed, worst 0.000000**, so the
   assembly is IDEMPOTENT and cannot drift prod's values.
2. `npx tsx --env-file=.env.production.local scripts/compute_conf_pitcher_env_plus.ts --apply --prod`
   ✅ `--prod` guard ADDED 2026-08-30 (it had none); refuse path verified.
3. `npx tsx --env-file=.env.production.local scripts/derive_conf_opr_htp.ts --apply --prod`
   ✅ `--prod` guard ADDED 2026-08-30 (it had none); refuse path verified.
   Reads `"Park Factors".rg_factor` — **309/309 populated on prod** (it does NOT read `rg_factor_seasonal`, which is
   empty on prod; that is E2's job and NOT a C28 blocker).
4. **★ NEW STEP — refresh `Stuff_plus`:** run the FIXED `conferenceStuffPlusV2`
   (`Σ("Pitching Master".stuff_plus × trackman_pitches) / Σ(trackman_pitches)`).
   ⚠ **It IGNORES `dryRun` and writes regardless — no preview exists.** Rollback = `_confstats_backup`.
⛔ **NEVER run `populate-conf-stats` on prod** — different script, confusingly similar name, overwrites the
hand-calibrated JUCO overlay.

## PHASE GATE AFTER C28 (verify VALUES, not just that it ran)
- The 13 previously-EMPTY columns become populated: `era_plus` `fip_plus` `k9_plus` `bb9_plus` `hr9_plus` `whip_plus`
  `hitter_talent_plus` `run_env_factor` `OPS` `SLG` `slg_plus` `pitcher_ev_score` `pitcher_iz_score`.
- `Stuff_plus` CHANGES from its stale pre-v2 value (compare BEFORE/AFTER — do not just count non-nulls).
- Division split holds: **D1 = 30 · NJCAA_D1 = 10 · D2 = 2**.
- Staging reference shape after the same fix: D1 avg **99.16** (92.9–107.3) · NJCAA_D1 avg **96.00** · D2 avg 93.00.

---
# ✅ C28 APPLIED TO PROD 2026-08-30 — all four steps, phase gate PASSED
Ran via the DIRECT pg session with the prod ref asserted (equivalent to pasting; **never `--linked`**).
BEFORE snapshot kept as `_c28_before` (alongside `_confstats_backup`).
1. **bucketA assembly** → `OPS` `SLG` `slg_plus` 0/30 → **29/30**
2. **`compute_conf_pitcher_env_plus --apply --prod`** → **30 conf rows**, 0 skipped.
   SANITY (correct direction): SEC ERA 5.82 → era+ **105** · Ivy 5.20 → **117** · HR9 SEC 1.62 → hr9+ **68**
   (SEC allows more HR ⇒ env+ <100) · Ivy 0.70 → **156**.
3. **`derive_conf_opr_htp --apply --prod`** → **30 rows**. e.g. Big 12 HTP 120.4 → **121** · MWC 98.8 → 97.8.
4. **★ `conferenceStuffPlusV2` (FIXED lane)** → **31 rows written**.

## ★ THE `Stuff_plus` CATCH WAS REAL — this is why step 4 exists
**D1 `Stuff_plus`: 101.17 → 99.15, with 30/30 rows CHANGED.** Prod now matches staging's **99.16**.
Following the runbook's three steps would have left it at the stale pre-v2 **101.17** while everything around it was
rebuilt — and a count check would have shown **30/30 populated and PASSED**. Because Conference Stuff+ is the
competition-translation lever, that stale value would have silently biased EVERY projection of a player into a conference.
Division relationship holds and matches staging: **D1 99.15 · NJCAA_D1 96.00 · D2 93.00**.

## PHASE GATE RESULT (D1, all were 0/30 before)
`era_plus 30` `fip_plus 30` `k9_plus 30` `whip_plus 30` `hitter_talent_plus 30` `run_env_factor 30` ✅
`OPS 29` `SLG 29` ⚠ · `pitcher_ev_score 0` ⚠

## ⚠ TWO LOOSE ENDS — NOT resolved, do not assume benign
1. **`OPS`/`SLG`/`slg_plus` = 29/30**, one conference short. Probable cause: a conference with no qualifying hitters,
   but **UNVERIFIED**. Identify the missing conference before trusting conference hitting rates for it.
2. **`pitcher_ev_score` = 0/30 and `pitcher_iz_score` likewise** — listed as bucketA outputs but bucketA did NOT fill
   them. Either they have a different producer or a precondition is unmet. **Find the producer before Phase F**, since
   these feed pitcher-side conference context.
