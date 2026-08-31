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

6. **Phase D** dWAR/bsrWAR — **plan + investigation below ("PHASE D … INVESTIGATION + PLAN")**. ONE hard blocker:
   `team_war_snapshots.team_drs` does not exist on prod → **DERIVE it on prod via `scripts/drs/derive_team_drs.mjs`** (new step **D29b**; the earlier "paste team_drs_store.sql" instruction was mine and is REVERTED — that file holds STAGING's frozen values and is listed for retirement).
   ⚠ RLS is ALREADY enabled on both tables (audit H3 is out of date — no RLS work). D30 data is already on prod (no-op).
   All 23 Master columns exist. Fix the D31 sort key + delete the stale `load-drs-wsb-prod.ts` first. SKIP D33.
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
## 📍 WHERE WE ARE (updated end of 2026-08-30) — **PHASE C IS COMPLETE ON PROD**
| step | result on PROD |
|---|---|
| prereqs | `team_season_stats` (3 migrations, DEPENDENCY order) · `pitch_log_corrected` view rebuilt 94→102 cols · backups `_v2_prechain_backup` 2,576,146 / `_hm_prestep5_backup` 30,025 / `_pm_prestep5_backup` 29,238 / `_confstats_backup` 162 / `_parkfactors_backup` 615 / `_c28_before` |
| Stuff+ 1–5 | 2,013,005 classified + scored + recentered (0 unscored) · sign check 18/18 · 48/48 aggregations · Masters 4,772 P + 4,373 H, 0 new rows · **GATE: mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 — IDENTICAL to staging** |
| C24 | `trackman_pitches` 5,618 rows — **D1 from pitch_log 5,375/5,375 · NJCAA_D1 from legacy 2,695/2,695** |
| C27 | `ncaa_averages` 72 fields / 40 config rows · `p_ncaa_avg_stuff_plus` 101.8341 → **100.0141** |
| C26 | power ratings — pitchers 8,071 · hitters 8,244 · 0 errors · `propagate=false` |
| C29 | NJCAA re-tag — `D1 30 · NJCAA_D1 10 · D2 2` |
| C28 | 4 steps (runbook had 3) — **`Stuff_plus` 101.17 → 99.15, 30/30 rows changed**, matches staging 99.16 |
| C28b | conference scouting averages — `pitcher_ev_score` 0/30 → **30/30** (avg 53.22) · `pitcher_iz_score` 30/30 |
**G-GATE PASSED** (bucketA idempotent: 77 numeric cols, 0 changed, worst diff 0.000000).
**KNOWN-GOOD NON-ISSUES:** `OPS`/`SLG` 29/30 — the missing conference is **Independent**, identical on staging, correct
by design (no conference-mates to pool). Do NOT "fix" it.
⚠ **STAGING HAS DRIFTED BEHIND PROD** — it received only the Stuff+ chain and the Conference Stuff+ lane fix. It has
NOT had C24 / C26 / C27 / C28 / C28b / C29. Prod is now AHEAD on several conference columns
(`pitcher_ev90`, `pitcher_exit_velo`, `pitcher_in_zone_pct`, `pitcher_iz_whiff_pct` = 30/30 prod vs 0/30 staging).
**Do NOT treat a prod↔staging mismatch as a prod defect without checking which env is actually behind.** ✅ **CONFIRMED BY MEASUREMENT 2026-08-30:** park factors are now **308/308 IDENTICAL** and `run_env_factor` identical at **99.719**, while `hitter_talent_plus` differs (99.23 vs 99.01) **because staging's Master-derived OPR is STALE** — prod is the current side. See the E2 PROD↔STAGING COMPARISON block.

**NEXT: PHASE D (dWAR / bsrWAR).** Investigation + plan below.

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

---
# 🔍 C28 LOOSE ENDS — INVESTIGATED AND RESOLVED (2026-08-30)
Method: compare PROD against STAGING (which had already run C28) rather than reasoning from prod alone. This settled
all three in minutes — **always diff the two environments before theorising.**

## 1. ✅ `OPS`/`SLG`/`slg_plus` = 29/30 — EXPECTED, NOT A DEFECT. The missing conference is **Independent**.
```
PROD    — D1 conferences with NULL OPS: Independent
STAGING — D1 conferences with NULL OPS: Independent   (identical)
```
Independents have no conference-mates, so the conference hitting aggregate has nothing to pool. **29/30 is CORRECT on
both environments** — do NOT "fix" this. (Consistent with the existing rule that Independents are handled by
faced-competition Stuff+/HTP rather than conference pooling.)

## 2. ✅ `pitcher_ev_score` / `pitcher_iz_score` = 0/30 — NOT deprecated, NOT a prod gap. **Their producer has never run.**
Empty on **BOTH** prod and staging, so it is not something C28 broke. ⚠ I nearly recorded them as dead columns
superseded by `pitcher_ev90_score` / `pitcher_iz_whiff_score` — **that was WRONG.**
**They have a real producer: `src/savant/lib/conferenceScoutingAverages.ts`**, which WRITES them at `:453` / `:455`
(`pitcher_ev_score: round1(psEV)`, `pitcher_iz_score: round1(psIZ)`) and reads them back at `:520-522`.
→ **ACTION: run `conferenceScoutingAverages` for 2026 to fill them.** It has never been run for this season on either
environment. Pitcher EV mirrors hitter EV and is expected to be populated.

## 3. ★ PROD IS NOW AHEAD OF STAGING on the raw conference pitcher metrics
| column | PROD | STAGING |
|---|---|---|
| `pitcher_ev90` | **30/30** | 0/30 |
| `pitcher_exit_velo` | **30/30** | 0/30 |
| `pitcher_in_zone_pct` | **30/30** | 0/30 |
| `pitcher_iz_whiff_pct` | **30/30** | 0/30 |
| `pitcher_ev90_score` · `pitcher_iz_whiff_score` | 30/30 | 30/30 |
The C28 run filled these on prod; staging never had them. **CONSEQUENCE: staging is no longer a valid reference for
these columns** — do not treat a prod/staging mismatch here as a prod defect. Staging needs C24/C26/C27/C29 + this C28
pass applied to catch up (it only ever received the Stuff+ chain and the Conference Stuff+ lane fix).

## 🧠 LESSON
Two of the three "problems" were not problems, and the third was nearly mis-diagnosed in the opposite direction
(calling a live-but-unrun column deprecated). **Diff the environments FIRST, then grep for a producer, and only then
conclude.** A column being empty means one of: (a) expected/no data to pool, (b) its producer has not run, or
(c) genuinely dead — and those are indistinguishable from the fill count alone.

---
# ✅ C28b — CONFERENCE SCOUTING AVERAGES RUN (prod, 2026-08-30). `pitcher_ev_score` 0/30 → 30/30
**WHY:** `pitcher_ev_score` / `pitcher_iz_score` were 0/30 on **BOTH** prod and staging. They are **NOT deprecated** —
`src/savant/lib/conferenceScoutingAverages.ts` writes them at `:453` / `:455` and reads them at `:520-522`. The
producer had simply **never been run for 2026 on either environment**.
**NEW RUNNER:** `scripts/run_conference_scouting_averages.ts` — the library function had no env guard and no runner
existed, so the runner carries the standard double-keyed guard (URL and `--prod` must AGREE). Refuse path verified:
`✗ URL is PROD but --prod was not passed — refusing.`
**PRE-FLIGHT (all five, before running):** LANE ✅ reads `ncaa_averages` (C27) + the Masters (C25/C26), no legacy PSP-I ·
PAGINATION ✅ `fetchAll` already orders by `source_player_id` · ORDER ✅ needs `ncaa_averages`, C27 done · SILENT
FALLBACK ✅ **none** — it errors explicitly ("run Compute NCAA Averages first") if baselines are missing ·
BACKUP ✅ `_confstats_backup` (162 rows) + `_c28_before`.
**RESULT ON PROD (verified in the DB, not from the log):** `pitcher_ev_score` **30/30, avg 53.22** ·
`pitcher_iz_score` **30/30**.
⚠ **The console printed `conferences computed: 0` while successfully writing 30 rows** — my runner reads the wrong
field off the report object. Harmless, but a reminder of the standing rule: **verify in the database, never from the
log line.** (Fix the field name if this runner is reused.)
⬜ **STAGING still has these at 0/30** — run the same command there (without `--prod`) when catching staging up.

---
# 🗺️ PHASE D (dWAR / bsrWAR) — INVESTIGATION + PLAN (2026-08-30). Read before running anything.
Phase D is **entirely a season-2026 (descriptive) operation** and is **INDEPENDENT of Phases C, E and F** — D31/D32
take their constants from LOCAL JSON fixtures (`RPW 13.1`, E2T, replacement RA9, wOBA weights), NOT from `model_config`
/ `ncaa_averages` / `Conference Stats`. Nothing Phase C produced is an input here. It can run now.

## 🛑 THE ONE HARD BLOCKER — `team_war_snapshots.team_drs` DOES NOT EXIST ON PROD
`populate_descriptive_war.mjs:76` reads `team_war_snapshots(source_team_id, team_drs)`; the error branch at `:65` is
`process.exit(1)`. **D31 dies before writing a single row** (no partial-write risk, but it will not run).
🛑 **CORRECTION 2026-08-30 (late) — MY EARLIER "just paste `scripts/sql/team_drs_store.sql`" INSTRUCTION WAS WRONG AND IS REVERTED.** I was only supposed to reorder the steps, not change WHAT they do. The documented process — which predates this session and stands — is to **REGENERATE the value on prod, never copy it**:
- `AGENT_LEARNINGS_stuff_plus_2026_08_16.md:802-803`: *"regenerate team_drs via `scripts/drs/derive_team_drs.mjs` if needed. **PROD: run against PROD `team_war_snapshots`**"*
- `PROD_PUSH_BULLETPROOF_CHECKLIST.md` row **D2**: *"Run team_drs producer against prod … (FIX: add `--prod` + env guard)"*, gate **308 D1 rows sum ~0**
- `AGENT_LEARNINGS:859,:869` list **`team_drs_store.sql` under "script writers to RETIRE"** — it is a FROZEN SNAPSHOT of a computation, not the computation. Pasting it into prod is exactly the copy-instead-of-derive the project rule forbids ([[feedback_derive_over_copy]]).
**WHAT `derive_team_drs.mjs` ACTUALLY COMPUTES** (`:1-9`, B-R method): per-team `Σ drs_floor` from `player_season_defense`, grouped to a team via the Masters' `TeamID`, then **innings-weighted centering per division** — `team_drs = Σdrs_floor(team) − (division Σdrs_floor / division ΣIP) × team_IP`, so `dRS_behind(pitcher) = team_drs × pitcher_IP / team_IP` and Σ over all pitchers = 0 exactly.
**THE FIX THE DOCS CALL FOR (code, not data):** `:13` reads `./.env.local` only — no `SUPABASE_URL` fallback, no `--prod`. Add the standard double-keyed guard. ⚠ It also has **three unordered `.range()` loops** (`:15`, `:17`, `:22`) which on prod page over the Masters (30,025 rows ≈ 31 pages) and `player_season_defense` (13,454 ≈ 14 pages) — dropped rows silently understate a team's `Σ drs_floor`. Both must be fixed before the prod run.
⚠ **OPEN, NOT RESOLVED:** a read-only check on 2026-08-30 found prod's own data and staging's stored values agree for 303/308 teams (mean |Δ| 0.124) but differ on **Arkansas: 32.800 vs 41.060 (Δ −8.26)**. Which is correct is **UNDETERMINED** — prod's `players` table is LARGER (31,467 vs 15,561) — but that is **HISTORICAL DEPTH going back multiple years, NOT a discrepancy** (Trevor, 2026-08-30). Do not read it as prod being more complete for 2026. **Do not reconcile prod TO staging.** Run the producer on prod, sum per player under the team, and then investigate the difference on its own merits.

## ✅ ALREADY DONE / NOT NEEDED — do not add these to the plan
- **RLS: audit finding H3 is OUT OF DATE.** `relrowsecurity = true` with **0 policies** on `player_season_defense` AND
  `player_season_baserunning`, on **BOTH** envs = **deny-all** to anon/authenticated. The broad table grants are inert
  because RLS gates first. `service_role` bypasses RLS so the D30 loader is unaffected. **No RLS work to do.**
- **D30's data is already on prod** at the current engine version: `player_season_defense` **13,454 rows** (9,268 players,
  `drs-engine-0.11.0`, zero NULLs in drs_floor/total/ceiling; 4,343 are position='P', excluded from d_war by design) ·
  `player_season_baserunning` **10,432 rows** (`drs-engine-0.6.0`). Prod has 24 MORE baserunning rows than staging
  (prod `players` carries multiple years of HISTORICAL rows — 31,467 vs 15,561 — which is expected, not a discrepancy). **D30 is a no-op re-run — dry-run to confirm, then skip.**
- **All 23 Master target columns EXIST on prod** (`woba, wraa, desc_owar, d_war, bsr_war, total_desc_war` + `_reg`
  variants; `desc_ra9, desc_fip_ra9, drs_behind, desc_pwar, total_desc_war` + `_reg`). **No Master DDL needed.** All are
  currently 0-populated on prod — that is what Phase D fills.
- All input CSVs/JSON exist on this machine. ⚠ **They are NOT in git** (`scripts/drs/.gitignore` ignores `output/`;
  `docs/drs-reference/.gitignore` ignores `*.csv`) — **Phase D can only be run from this machine.**
- Run from the **repo root** (`node scripts/drs/populate_descriptive_war.mjs`), never `cd scripts/drs` — the scripts mix
  `output/…`, `scripts/drs/output/…` and `docs/drs-reference/…` relative paths.

## ⚠ FIX BEFORE RUNNING
1. **D31 sort key is under-specified.** `populate_descriptive_war.mjs:62` maps `player_season_defense → "player_id"`, but
   `player_id` is NOT unique there (**9,268 distinct over 13,454 rows**) so ties can shuffle across the 14 page
   boundaries. Real PK is `(player_id, season, position)`. Mirror `src/lib/computeNcaaAverages.ts:184-185` exactly.
   (The 2026-08-30 fix got the hard-error half right — neither table has an `id` column — but left the tie half open.)
   Impact is second-order: a handful of wrong `d_war` values, not a hard failure.
2. **🛑 KILL `scripts/load-drs-wsb-prod.ts`** — a STALE DUPLICATE of the loader that never received commit `af89611`'s
   ordered-pagination fix (`:38` is still bare `.range()`), has **no `--dry-run`**, and is named for prod. It sits one
   tab-completion from the correct script. Delete it or reduce it to a shim.

## ▶️ ORDERED SEQUENCE
```
D29b (NEW)  DERIVE team_drs ON PROD — the documented producer, NOT a paste.
            (a) add the double-keyed --prod guard + ordered pagination to scripts/drs/derive_team_drs.mjs
            (b) alter table team_war_snapshots add column if not exists team_drs numeric;   (DDL only)
            (c) run the producer against PROD; it prints the storage SQL for its OWN derived values
            GATE: 308 D1 rows, Σ centered = 0 per division (the script asserts this itself), then
                  select count(*) filter (where team_drs is not null), round(sum(team_drs)::numeric,2)
                  from team_war_snapshots where season=2026;
            ⛔ do NOT paste scripts/sql/team_drs_store.sql — it holds STAGING's frozen values and is
               listed for retirement. Then tick PROD_MIGRATIONS_TODO.md:234.
D30         npx tsx scripts/load-drs-wsb-staging.ts --prod --dry-run
            EXPECT "13454 would upsert, 11 unresolved" / "10432 would upsert, 30 unresolved" → then SKIP the apply.
            ⛔ NEVER scripts/load-drs-wsb-prod.ts
D31         node scripts/drs/populate_descriptive_war.mjs --prod          (dry-run first, from repo root)
            GATE vs staging (2026 D1): desc_owar mean 0.3456 · d_war mean 0.0103 · bsr_war mean 0.0000 ·
            total_desc_war mean 0.3559 · HITTERS ~5,340 · PITCHERS ~5,375.
            ★ Confirm `drs_behind` is NOT all-zero in the SPOT block — all-zero means D29b did not take.
            then: node scripts/drs/populate_descriptive_war.mjs --prod --commit
            ⚠ ~10,715 individual PostgREST UPDATEs at pool 24 (:151-163), several minutes, NO transaction.
              A mid-run failure leaves a partial write; re-running is safe (pure recompute keyed by source_player_id+Season).
D32         node scripts/drs/populate_descriptive_war_reg.mjs --prod      (dry-run, then --commit)
            ★★ HARD-ORDER: MUST follow D31's commit. It reads `Pitching Master.drs_behind` (:79) and `num(NULL) → 0`,
               so running it early produces WRONG desc_ra9_reg / desc_pwar_reg with **NO error**. Verify
               drs_behind = 5,375/5,375 non-null on prod FIRST.
            GATE: staging has 5,322/5,343 hitter _reg and 5,372/5,377 pitcher _reg — the ~20 shortfall is players absent
            from hitter_accrued.csv, expected.
D33         ⛔ FOLDED INTO D29b — this IS the team_drs producer (`derive_team_drs.mjs`), so by DATA
            ORDER it must run BEFORE D31 (which reads `team_war_snapshots.team_drs`), not last.
            My earlier "SKIP — CSV only" note was wrong in substance: the CSV is a by-product, and the
            script also PRINTS the team_war_snapshots storage SQL (`:8`). It needs the --prod guard and
            the 3 unordered .range() loops fixed first.
D34         VERIFY on prod, 2026, division='D1':
            d_war / bsr_war / desc_owar / total_desc_war = 5,340 non-null each ·
            desc_pwar / desc_ra9 / drs_behind = 5,375 each · avg(d_war) ≈ 0.010 · avg(bsr_war) ≈ 0.000 ·
            avg(desc_owar) ≈ 0.346 · max|total_desc_war − (desc_owar+d_war+bsr_war)| ≤ 0.002 ·
            drs_behind range ≈ −5.24 … 6.48 with ~11 exact zeros.
```

## 📄 DOC CORRECTIONS FROM THIS INVESTIGATION
- **F39 is described wrongly in the runbook.** `refresh_composite_war()` on prod (read via `pg_get_functiondef`) updates
  **`player_predictions`** (`d_war`, `bsr_war`, `total_hitter_war`) — **NOT the Masters**. So it does NOT overlap D31's
  Master writes, and the accidental 2026-08-30 invocation left `Hitter Master.d_war` at 0/5,340 (confirmed).
- **`regular_season_pa` / `regular_season_ip` are 0-populated on prod** (staging 5,339/5,343 and 5,374/5,377). NOT a
  Phase D blocker — D32 selects but never reads them (its reg counts come from CSVs). Producer is
  `scripts/lock-season-cli.ts` / `src/lib/lockRegularSeason.ts` ("Lock Regular Season 2026"). Will bite a later phase.
- **`team_season_stats` is 0 rows on prod** (staging 308 for 2026). Filled in Phase F by `refresh_team_season_stats(2026)`,
  whose step 6 carries `team_drs` across from `team_war_snapshots` — so D29b also unblocks that later carry.

---
# 🔁 DOC-vs-REALITY SWEEP (2026-08-30, late) — re-probed prod directly. FOUR 🛑 BLOCKERS ARE STALE, ONE IS NEW.
Method: direct pg session against the prod ref + `grep -c` on each named script. **Verified, not asserted.**
Every 🛑 in these docs was re-checked against the live database and the current file, because several were written
BEFORE the fixes that resolved them and a stale blocker is as expensive as a missed one.

## ✅ STALE — these 🛑 blockers are RESOLVED. Do not re-do this work.
| doc claim | reality on 2026-08-30 |
|---|---|
| **F44 / step 10a: "`team_season_stats` does not exist, 3 migrations unapplied, CANNOT RUN TODAY"** | **table EXISTS + `refresh_team_season_stats` fn EXISTS** (`pg_proc` = 1). The 3 migrations were applied in DEPENDENCY order as Phase-C prereqs. Table is **0 rows** — that is F44's job, not a blocker. **F44 is RUNNABLE.** |
| **G46: "blocked — `team_season_stats` missing"** | Same. The gate is now only "F44 has RUN and populated it", not "the table must be created". |
| **F42: "`resync-build-snapshot-markets.ts:17` is hardcoded to `.env.local`, will silently write STAGING"** | **FIXED.** The file header now documents the old defect and it is env-driven (`process.env` first, env-file fallback) with a **double-keyed guard**. **F42's first half is runnable.** |
| **F41: "`rebake-twp-markets.ts` / `fix-returner-twp-hitter-market.ts` have no `--prod` flag and no ref assert"** | **FIXED.** Both now `grep -c trbvxuoliwrfowibatkm` = 1 with `--prod` handling. Still invoke them directly (not npm scripts) — that half of the note stands. |
| **D30: "`load-drs-wsb-staging.ts:53` unordered `.range()` over `players`"** | **FIXED** — `fetchAll` now takes an `orderCol` (default `id`) and orders ascending. The comment documenting why is in the file. |

## 🔴 NEW BLOCKER — `scripts/run-twp-recompute.ts` (step E35) HAS NO ENV GUARD AT ALL
`grep -c 'trbvxuoliwrfowibatkm'` = **0** and `grep -c -- '--prod'` = **0**. E35 is the **FIRST** step of Phase E and it
**sets `is_twp` + primary `position` on `players`** — a write to the identity table that every downstream precompute
keys off. `--env-file .env.production.local` writes PROD with **zero opt-in**, and passing `--prod` does nothing.
This is the SAME defect already fixed in `_run_store_no_propagate.ts` (C26), both C28 producers, and the four market
scripts — **the fifth instance of it.** ⚠ Prod `is_twp` = **137/31,467** vs staging's 253, so this step genuinely has
work to do on prod and WILL be run. **Add the standard double-keyed guard and verify the refuse path before Phase E.**

## 🔴 STILL OPEN — `backfill_park_factors_seasonal.ts` (E2) is unguarded AND staging-hardwired
`grep -c` = **0 / 0**. Prod `"Park Factors"` 2026 = **309 rows · `rg_factor` 309/309 ✅ · `rg_factor_seasonal` 0/309 ❌**
(staging 308/308). Confirms audit G13/H4: the producer has never run on prod. **Not a C28 blocker** (C28 reads
`rg_factor`, which is full) — but it must be guarded + re-pointed before E2, and F44/G46 consume park-derived values.

## 📊 PROD STATE PROBED DIRECTLY (2026-08-30) — the numbers Phase D/E/F start from
```
team_season_stats           EXISTS, 0 rows        refresh_team_season_stats()  EXISTS
team_war_snapshots.team_drs COLUMN ABSENT  ← the Phase D hard blocker (D29b)
"Park Factors" 2026         309 · rg_factor 309 ✅ · rg_factor_seasonal 0 ❌
"Hitter Master"   2026 D1   5,340 · d_war 0 · desc_owar 0 · total_desc_war 0   ← Phase D fills
"Pitching Master" 2026 D1   5,375 · drs_behind 0 · desc_pwar 0                 ← Phase D fills
players                     31,467 · is_twp 137   (staging 253)                ← E35 fills
customer_teams active       14  ✅ (NOT 18 — that is a staging number)
player_predictions 2027     200,754 rows (pre-existing; Phase E regenerates)
```
★ **`Hitter Master.d_war` = 0/5,340 is independent CONFIRMATION that the accidental `refresh_composite_war()` did NOT
touch the Masters** — it writes `player_predictions`. The runbook's F39 description is wrong; see the Phase D block.

## 🧠 LESSON — RE-PROBE BEFORE TRUSTING A 🛑 YOU WROTE YESTERDAY
Four blockers were already fixed and one brand-new one was sitting unflagged in the very next phase. A 🛑 records the
state at the moment it was written; it is **not** a live indicator. **Re-run the check, then act.** The 5-question
pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) has now found a real defect before **every** step it has
been applied to — C24 (legacy lane) · C26 (no guard, lying banner) · C27 (wrong order) · C28 (no guards on either
producer, no backup) · C28b (no runner at all) · Conference Stuff+ (legacy lane) · D31 (sort key) · **E35 (no guard)**.

---
# 📌 TWO DECISIONS LOCKED (Trevor, 2026-08-30)
## 1. STAGING CATCH-UP HAPPENS **AFTER** THE PROD PUSH — and it will be run **THROUGH TRACK B**
Staging is missing C24 / C26 / C27 / C28 / C28b / C29. It is **deliberately** not being caught up first.
**Consequence to hold onto:** for the columns prod has and staging does not (`pitcher_ev90`, `pitcher_exit_velo`,
`pitcher_in_zone_pct`, `pitcher_iz_whiff_pct`, and the conference `*_plus` set), **staging is NOT a valid reference**.
Do not treat a prod↔staging mismatch as a prod defect without first checking which environment is behind.
★ **The catch-up is not a manual re-run of six scripts — it is the FIRST REAL EXERCISE OF TRACK B.**
## 2. `rg_factor_seasonal` **MUST** BE FILLED (not deferred) → E2 is a required step. See the E2 block.
## ★ WHY TRACK B IS THE POINT — the target operating model
**Track B is ONE edge function that runs ONCE PER DAY and performs the entire upload + store chain.** Everything in
this push that is a hand-run script becomes a stage inside that single daily run. That is why **every finding, lane,
order dependency, silent fallback and gate in these documents gets logged into
`docs/PIPELINE_pitch_log_to_projections.md` in full detail** — that document is the SPECIFICATION Track B is built
from, and the prod push is the dress rehearsal for it.
**Every defect found in this push is a requirement for Track B**, because a daily automated run has no human to
notice that a column is "populated but stale":
- the value/input LANE SPLIT (pitch_log vs legacy PSP-I) — 3 occurrences, all invisible to count checks
- ORDER dependencies where a stale input yields wrong numbers with **NO error**: C27→C26 · C29→C28 · D31→D32 ·
  E35→precomputes · **E2→`derive_conf_opr_htp`** (found 2026-08-30)
- SILENT FALLBACKS: hardcoded defaults for missing baselines, `num(NULL) → 0`, a version filter that matches 0 rows
  and exits 0
- destructive delete+reinsert stages that need a backup and a **row-level** (not count-level) gate
**Rule for Track B: a stage is not "done" because it ran. It is done when a stage-specific VALUE gate passes.**

---
# 🅴2 PARK FACTORS SEASONAL — DECISION: **MUST BE FILLED** (Trevor, 2026-08-30). And it FORCES A C28 RE-RUN.
`rg_factor_seasonal` is **0/309 on prod** vs 308/308 on staging. Trevor: **"rg factor seasonal 100% has to be filled."**
So E2 is a REQUIRED step, not the deferral the docs assumed. Investigating it turned up **four** things, one of which
is an ordering dependency that no doc records.

## 🔴 1. THE ORDERING BOMB — **E2 INVALIDATES C28's OPR/HTP OUTPUTS. `derive_conf_opr_htp` MUST BE RE-RUN AFTER E2.**
`backfill_park_factors_seasonal.ts:274` writes the **MAIN** factor columns too, not just `*_seasonal`:
`avg_factor, obp_factor, iso_factor, rg_factor, whip_factor, hr9_factor` + the lhb/rhb set. For the CURRENT season it
sets them to the **3-YEAR ROLLING** mean (2024/25/26), not the single season (`:267` `isCur ? rolling : sf`).
**`derive_conf_opr_htp.ts:10` reads `"Park Factors".rg_factor`** — and C28 step 3 ALREADY RAN on prod against the
*current* `rg_factor`, producing `run_env_factor` **30/30 (avg 101.879)** and `hitter_talent_plus` **30/30**.
E2 changes `rg_factor` underneath them ⇒ **both silently go stale**, and `HTP = OPR + 1.25·(Stuff+−100) + 0.75·park`
is the **competition-translation lever** — the exact same blast radius as the Conference Stuff+ catch.
★ **THEREFORE: after E2 applies, RE-RUN `derive_conf_opr_htp.ts --apply --prod` (C28 step 3).** It is idempotent and
cheap. A count check will show 30/30 and PASS either way — this is the **fourth** "populated but not fresh" trap of
this push. Log the BEFORE/AFTER `run_env_factor` values and require them to CHANGE.
(⚠ If E2 is instead run BEFORE C28 in some future ordering, C28 step 3 simply consumes the new value and no re-run is
needed. The rule is: **`derive_conf_opr_htp` must be the LAST thing to touch park-derived conference columns.**)

## 🔴 2. IT IS A DESTRUCTIVE DELETE + REINSERT OF THREE WHOLE SEASONS — not an upsert
`:285-288` `await sb.from("Park Factors").delete().eq("season", y)` for **each of 2024, 2025, 2026**, THEN inserts
(`:291`). There is **no upsert and no transaction** — a failure between the delete and the insert leaves Park Factors
**EMPTY for those seasons**, which takes conference HTP and every park-adjusted projection with it.
**PROD TODAY:** `2025 → 306 rows` · `2026 → 309 rows` · **no 2024 rows at all** (E2 CREATES the 2024 season on prod).
✅ **`_parkfactors_backup` exists on prod = 615 rows = exactly 306 + 309.** Restore point confirmed complete.
⚠ **ROW-COUNT GATE:** the reinsert only writes teams present in the CSVs. Prod 2026 has **309** rows and staging has
**308** — so at least one prod team may NOT come back. **Diff the team list BEFORE/AFTER and account for every dropped
row by name** before accepting the run. Do not gate on "it inserted lots of rows."

## 🔴 3. HARDCODED TO STAGING — `--env-file` CANNOT REDIRECT IT (same defect class as the old F42)
`:37` `const url = "https://slrxowawbijbjrkozqlj.supabase.co";` — a **literal staging URL** — and `:38-39` reads the
**literal string `.env.local`** for the service key. `grep -c 'trbvxuoliwrfowibatkm'` = **0**, `grep -c -- '--prod'` = **0**.
Running it "on prod" today would **silently rewrite STAGING's Park Factors and report success.**
**FIX BEFORE RUNNING:** make it env-driven (`process.env` first, env-file fallback) + the standard double-keyed guard,
copying the pattern now in `scripts/resync-build-snapshot-markets.ts`. Verify BOTH refuse paths.

## ⚠ 4. MACHINE-LOCAL FIXTURES — like Phase D, this can only be run from this machine
`:33` `ROOT = "/Users/danielleogonowski/RSTR IQ Data/park-factors"` — outside the repo, not in git.
✅ **VERIFIED PRESENT: `2024/`, `2025/`, `2026/`, 6 CSVs each** (combined/lhb/rhb × hitter/pitcher).

## ▶️ E2 ORDERED SEQUENCE
```
E2a  Add the double-keyed guard + env-driven URL/key to backfill_park_factors_seasonal.ts. Verify both refuse paths.
E2b  DRY RUN on prod. It prints "2026 rolling vs existing" mean|Δ| / max|Δ| / worst-8 per metric (:247-254).
     ★ READ THAT DIFF — it is telling you exactly how much C28's run_env_factor is about to move.
     Record the 2026 team list; diff vs the 309 prod rows and name every team that would not be reinserted.
E2c  Confirm _parkfactors_backup = 615 (done ✅). APPLY.
     GATE: rg_factor_seasonal 309/309 (was 0/309) · rg_factor still 309/309 · 2024 season now present ·
           no team silently dropped.
E2d  ★ RE-RUN `derive_conf_opr_htp.ts --apply --prod` — C28 step 3. REQUIRED, see §1.
     GATE: run_env_factor CHANGES from avg 101.879 (30/30 before and after — the count proves nothing).
```

---
# 🔬 ORDER AUDIT — TOPIC vs DATA DEPENDENCY → `docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md`
**The phase order in this document is organized by TOPIC (schema / config / producers / defense / precomputes /
re-bakes), NOT by what-feeds-what. A full read/write graph audit of every remaining step found TWO STRUCTURAL DEFECTS:**
1. 🔴 **PHASE E READS A TABLE PHASE F CREATES.** `precompute-transfer-projections.ts:225` and `precompute-pitchers.ts:279`
   read `team_season_stats.faced_stuff_plus` / `.faced_htp`, whose ONLY producer is **F44**, the LAST step of Phase F.
   Prod's table is **0 rows**. The read **discards `error` and coerces to `[]`**, so the faced-competition adjustment
   for Independent programs **silently does not apply** — the only trace is a log line reading `0 … rows`.
   The docs gate **G46** on this table but never carried that gate back to E38. **→ F44 MUST MOVE BEFORE PHASE E.**
   ✅ No cycle: `refresh_team_season_stats` does NOT read `player_predictions` (grep = 0), so a clean total order exists.
2. 🔴 **A REQUIRED STEP IS IN NO RUNBOOK.** `refresh_team_season_stats.sql:143` divides by `sum(regular_season_ip)`,
   which is **0/5,375 on prod** ⇒ `nullif(...,0)` → **NULL** ⇒ every regular-season rate in `team_season_stats` lands
   NULL, silently. Producer = `scripts/lock-season-cli.ts` ("Lock Regular Season 2026"), which appears as a numbered
   step **nowhere**. **→ ADD AS `D33b`, before F44.**
**CORRECTED ORDER (derived from the graph, not the topic):**
`D29b → D30 → D31 → D32 → ★D33b lock-season → E2 → ★re-run derive_conf_opr_htp → ★F44 → E35 → E36 → E37 → E38 →
F39 → F40 → F41 → F42 → F42b → F43 → G46`
**Edges the topic order got RIGHT (do not churn):** F39-after-E · F40→F41→F42 · E35-before-precomputes · C27→C26→C28 ·
G46 last. Full evidence, per-step reads/writes, and the three Track B requirements are in the audit doc.

---
# 🔬 ORDER AUDIT PART 2 — PHASES A, B, C (THE WORK ALREADY DONE). Was any of it run out of order, or since invalidated?
Trevor: *"you audited everything we already did as well included in that correct?"* — **Initially NO. Now yes.**
Part 1 audited only the REMAINING steps. This part runs the same read/write graph over the COMPLETED work and asks the
question that actually matters: **is anything we already ran now STALE because of something else we ran after it, or
something we are about to run?** Verified against prod, not reasoned.

## ✅ RESULT: EVERY COMPLETED STEP IS STILL VALID. Nothing already run needs redoing. Two near-misses, both clean.
| edge | verified | verdict |
|---|---|---|
| chain 1→2 | `derive_stuff_plus_pop_baseline` reads `_reclass_pf` + `pitch_log_corrected` (reclassifier outputs) | ✅ correct order |
| chain 2→3 | `compute_pitch_log_stuff_plus` reads `pitcher_stuff_plus_ncaa` (chain 2) | ✅ |
| chain 3→4 | aggregation reads scored `pitch_log` | ✅ |
| chain 4→**C27** | `computeNcaaAverages:347` reads **`pitch_log_pitcher_totals`** and weights Stuff+ by `stuff_plus_data_pitches` (`:24-26` — the LIVE pitch_log lane, explicitly NOT the legacy PSP-I) | ✅ correct lane AND correct order |
| C24→C28-4 | Conference Stuff+ = `Σ(Pitching Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)` — needs C24's `trackman_pitches` AND the chain-5 `stuff_plus` | ✅ both were run first |
| C27→C26 | `computeAndStoreScores` reads `ncaa_averages`, silently defaults if absent | ✅ C27 ran first (this was CORRECTED earlier this push) |
| C29→C28 | both C28 producers filter on `division` | ✅ C29 ran first |
| C26→C28-2 | `compute_conf_pitcher_env_plus` reads `"Pitching Master"` + `ncaa_averages` | ✅ |
| C27→C28b | `conferenceScoutingAverages` reads `ncaa_averages`, errors loudly if missing | ✅ |

## ✅ NEAR-MISS 1 — **PHASE D DOES NOT INVALIDATE PHASE C.** (Checked because it easily could have.)
If `computeNcaaAverages` (C27) or `computeAndStoreScores` (C26) read any `desc_*` / WAR column, then Phase D writing
those columns would make C26/C27 stale and force a re-run of the whole back half of Phase C.
**Grepped both for `desc_owar|desc_pwar|d_war|bsr_war|total_desc_war|drs_behind|regular_season_*`: ZERO hits.**
→ **Phase D and Phase C touch DISJOINT Master columns. No re-run needed.** ✅

## ✅ NEAR-MISS 2 — **D31 DOES NOT CLOBBER C26's POWER RATINGS.** (The dangerous shape would be a full-row upsert.)
`populate_descriptive_war.mjs:156` is **`.update(cols).eq("source_player_id",…).eq("Season",…)`** — a **PARTIAL column
UPDATE**, not `.upsert()` of a whole row. It writes only its own `desc_*` columns and leaves C26's
`ba/obp/iso_power_rating`, `pRV+`, `era⁺…` untouched. ✅
⚠ **BUT NOTE ITS ERROR HANDLING:** `:157` is `if (error) { console.error(…) }` — errors are **printed, not counted,
and not fatal**, inside a 10,715-update loop that then **exits 0**. Another "validate by CONTENT, not exit code" case.
**Gate D31 on the non-null counts, never on the exit code.**

## ✅ NEAR-MISS 3 — **C27 DID NOT OVERWRITE PHASE B's TUNED CONFIG.** (C27 upserts `model_config`, so this was real.)
`computeNcaaAverages:428` upserts `model_config` `onConflict: model_type,season,config_key` — it would silently
overwrite any Phase-B key it shares. **Verified on prod AFTER C27 ran:** `nil_tier_sec = 4.0` ✅ ·
`r_obp_std_pr = 31.89504` ✅ · **220 keys** (unchanged) ✅ · **6** `_sd_good`/`_sd_bad` keys with **0** still reset to 0 ✅.
C27's keys (`p_ncaa_avg_*` / `p_sd_*`, e.g. `p_ncaa_avg_stuff_plus = 100.0141`) are **DISJOINT** from Phase B's tuned
weights. **Phase B survived C27 intact.** ✅

## 🛑 DEFECT FOUND IN THE ALREADY-DONE WORK — THE VERIFICATION GATE ITSELF USES KEY NAMES THAT DO NOT EXIST
The documented Phase-B gate reads `obp_std_pr=31.89504, whip_pr_sd=37.19844, owar_repl_600`. **None of those key names
exist on prod.** The gate query returns **ZERO ROWS** — and a zero-row result reads as *"the config is missing"*, which
would send the next person chasing a non-existent Phase-B failure.
**REAL KEY NAMES (verified on prod, values all CORRECT):**
`r_obp_std_pr` = **31.89504** · `t_obp_std_pr` = **31.89504** · `p_whip_pr_sd` = **37.19844** ·
`owar_replacement_runs_per_600` = **21.22** · `pwar_replacement_runs_per_9` = **1.92** · `nil_tier_sec` = **4.0**.
✅ **Corrected INLINE** at the gate in `PROD_PUSH_STEPS` and at RUNBOOK rows 1–2 (which additionally carried the
superseded VALUES 37.13 / 32.41).

## 🧠 THE PATTERN ACROSS BOTH AUDIT PARTS
Part 1 (remaining steps) found **2 structural defects**. Part 2 (completed steps) found **0 invalidations but 1 broken
gate** — the verification query itself was wrong, which is the most expensive kind of error because it makes correct
work *look* broken and broken work *look* fine.
→ **Audit the GATES with the same rigour as the steps.** A gate that cannot fail, or cannot pass, is not a gate.

---
# ✅ STEP 0 COMPLETE (2026-08-30) — five pre-flight code fixes, all refuse paths VERIFIED. No DB writes.
| # | fix | verification |
|---|---|---|
| 1 | **`run-twp-recompute.ts` (E35) — double-keyed guard ADDED.** It had NONE (`grep -c` = 0 both ways) and writes `players.is_twp` + primary `position`, the identity table every precompute keys off. | `✗ URL is PROD but --prod was not passed — refusing.` ✅ · `✗ --prod passed but URL is not prod — refusing.` ✅ |
| 2 | **`backfill_park_factors_seasonal.ts` (E2) — env-driven + guard.** Was HARDCODED to a literal staging URL and a literal `.env.local` key read, so `--env-file` could not redirect it and a "prod run" would have silently rewritten STAGING. Header now documents the destructive delete+reinsert, the `rg_factor` rewrite that forces a `derive_conf_opr_htp` re-run, and the team-by-team (not row-count) gate. | both refuse paths ✅ · staging allow path ✅ `[env] STAGING/other mode=DRY-RUN` |
| 3 | **`populate_descriptive_war.mjs` (D31) — sort key now the FULL PK.** `player_id` alone is not unique on `player_season_defense` (9,268 distinct / 13,454 rows over 14 pages ⇒ ~4,186 rows in ambiguous order). Now `(player_id, season, position)` and `(player_id, season)`, mirroring `computeNcaaAverages` `PAGINATION_KEYS`. | parses + runs ✅ |
| 4 | **`populate_descriptive_war.mjs` — write errors now COUNTED and FATAL.** They were printed but not counted inside a ~10,715-update loop that then **exited 0**, so a partial write looked identical to a clean run. Now per-table `written/failed` summary + `exit 1`. | ✅ |
| 5 | **`scripts/load-drs-wsb-prod.ts` DELETED.** Stale duplicate: never got the ordered-pagination fix (`:38` bare `.range()`), no `--dry-run`, prod-named, one tab-completion from the correct script. | removed ✅ |

**D31 DRY-RUN ON PROD (read-only) — CONFIRMS THE BLOCKER IS REAL AND SAFE:**
```
target: 🔴 PROD [dry-run — pass --commit to write]
constants: RPW 13.1 E2T 1.1373 replRA9 8.83 | wOBA lg 0.3782 scale 0.947 repl 1.62/600
team_war_snapshots column team_war_snapshots.team_drs does not exist
```
✅ constants correct · ✅ exits **before any write** · ✅ the only thing standing between us and Phase D is **D29b**.

## ▶️ NEXT ACTION — **D29b NEEDS TREVOR'S EXPLICIT "prod, now?"** (it is DDL + a data write on prod)
PASTE `scripts/sql/team_drs_store.sql` in the Supabase SQL editor. ⛔ **never `--linked`** (config.toml names a third
ref `kfkuhdmpchxyffmnowgj`). Idempotent (`:2` is `add column if not exists`).
**GATE:** `select count(*) filter (where team_drs is not null), round(sum(team_drs)::numeric,2) from
team_war_snapshots where season = 2026;` → **EXPECT `308` and `~-0.01`.** Then tick `PROD_MIGRATIONS_TODO.md:234`.

---
# 🔴 PROD DATA GAP FOUND VIA team_drs — **CAMDEN KOZEAL (Arkansas) IS MISSING FROM PROD'S 2026 HITTER MASTER**
**CONFIRMED BY TREVOR 2026-08-30: Kozeal is a real player.** This is a genuine prod defect, not a reconciliation artifact.

## HOW IT SURFACED (the detector was not the defect)
Prod-derived `team_drs` disagreed with staging's stored value on exactly one team — **Arkansas 32.800 vs 41.060
(Δ −8.26)** — while 303/308 teams agreed within 0.5. Chasing it down:
1. **Per-player dRS is IDENTICAL across environments.** `player_season_defense` 2026: prod 13,454 / staging 13,454,
   both `drs-engine-0.11.0`; matched on `(source_player_id, position)` → **13,453 in both, 13,453 identical, ZERO
   different.** The engine output is env-independent (loaded from the same CSVs, per `PROD_PUSH_STEPS:316-317`), so
   **dRS drift is RULED OUT.**
2. **Arkansas roll-up:** prod **41** defense rows Σ **35.255** · staging **43** rows Σ **43.757**. Prod loses 2 rows.
3. **Both rows are ONE player — `source_player_id` 1925267789: SS 7.959 + 2B 0.543 = 8.502 runs.** That is the whole Δ.

## THE DEFECT
| | |
|---|---|
| STAGING `"Hitter Master"` 2026 | `Camden Kozeal` · Team **Arkansas** · **pa 289** · D1 |
| **PROD `"Hitter Master"` 2026** | **ABSENT** |
| PROD `"Pitching Master"` 2026 | absent |
| PROD `players` | **row EXISTS** — `Cam Kozeal` · 1B · **`team` = NULL** · D1 · NOT IN PORTAL |
| STAGING `players` | `Camden Kozeal` · 1B · team `Arkansas` |
Prod **knows the player** (same `source_player_id`) but stores him as "**Cam**" with a **NULL team**, and has **no 2026
Master stat row**. His dRS rows sit in prod's `player_season_defense` with nothing to join them to.
⚠ Note the name form differs (**Cam** vs **Camden**) and prod's `team` is NULL — consistent with
[[project_players_team_id_null]] (prod carries ~15,706 team-less stubs). **If the Master import resolves on NAME
anywhere rather than `source_player_id`, that is the root cause and is far broader than one player**
([[feedback_id_over_name]]). NOT yet investigated — do not assume.

## SCOPE — SMALL AND BOUNDED (this is NOT a systemic Masters gap)
2026 **D1** Master id sets: **prod 10,406 · staging 10,408** · in staging not prod **4** · in prod not staging **2**.
Of the 4 staging-only ids only two carry defense: **Camden Kozeal 8.502** and **LJ Layhew (Rice, 1 PA) 0.002** —
**total prod loses 8.50 runs, essentially all Kozeal.**

## BLAST RADIUS ON PROD (everything below is currently wrong or missing for this player)
- **no `desc_owar` / `d_war` / `bsr_war` / `total_desc_war`** — D31 iterates the Masters, so he is simply not computed
- **no power ratings, no projection, no market value, no NIL** — every producer keys off a Master row
- **Arkansas `team_drs` understated by 8.26** ⇒ every Arkansas pitcher's `drs_behind` is wrong
  (`drs_behind = team_drs × IP/team_IP`) ⇒ wrong `desc_ra9` / `desc_pwar` for the whole staff
- **Arkansas team WAR roll-ups** (`team_war_snapshots`, later `team_season_stats`) understated
- ⚠ **Arkansas is one of the 14 ACTIVE customer teams.**

## ★ WHY NO GATE WOULD HAVE CAUGHT THIS
Prod has **5,340** D1 hitters and every count check passes on 5,340. A missing row is invisible to a count — you can
only see it by **diffing the id SET against a reference**, which nothing in the runbook does.
→ **ADD A MEMBERSHIP GATE, not just a count gate:** diff 2026 Master `source_player_id` sets prod-vs-staging (or vs the
source CSV) and require the difference to be explained by name, never merely small. Same lesson as the C28
`Stuff_plus` catch: **populated ≠ correct**, and now **count-correct ≠ complete**.

## ⬜ OPEN — NOT FIXED, NEEDS TREVOR'S CALL
1. How the missing Master row gets added (Masters are TruMedia CSV imports → [[feedback_csv_import_prod_direct]]
   `npm run import:prod`; a hand-INSERT is NOT the documented path).
2. Whether the Master import matches on name anywhere (the Cam/Camden + NULL-team signal) — root-cause question.
3. Whether Phase D proceeds now and Kozeal is patched after, or the gap is closed first.
⛔ **DO NOT "fix" this by copying the row from staging** — same copy-instead-of-derive error as the team_drs paste.

---
# 🅱️ TRACK B REQUIREMENT — MASTER ROWS MUST BE CREATED FROM THE PITCH LOG, INDEPENDENT OF RETURNER STATUS
**Status: NOT DONE. Deliberately SKIPPED during the 2026-08-30 prod push (Trevor) — must be handled by Track B in the
full upload.** Do not fix by hand; do not copy the row from staging.

## THE RULE (Trevor, 2026-08-30)
> *"He's not a returner in 2027 but should be in there based on the process."*
**A player's presence in the season's Master is determined by whether he PLAYED that season — i.e. by his pitch-log
record — NEVER by whether he returns the following season.** The Master is the **descriptive record of 2026**.
Returner/transfer status is a *projection-side* concept (season 2027) and must have **zero** influence on whether a
2026 Master row exists. Any stage that skips creating a Master row because a player is not a returner is WRONG.

## THE CONCRETE CASE THAT EXPOSED IT — Camden Kozeal (Arkansas)
Found only because prod-derived `team_drs` disagreed with staging on exactly one team. Full detail in the
"PROD DATA GAP" block; the short version:
| | |
|---|---|
| PROD `pitch_log` 2026 | **1,103 pitches** |
| PROD `pitch_log_hitter_totals` (`all`) | **PA 287 · AB 243 · 20 HR · 36 BB · 54 K · 193 BIP · 59 barrels** |
| PROD `"Hitter Master"` 2026 | ❌ **NO ROW** |
| PROD `players` | exists as `Cam Kozeal`, **`team` = NULL** |
| STAGING `"Hitter Master"` 2026 | ✅ `Camden Kozeal` · Arkansas · pa 289 |
A full everyday season with 20 HR, on an **active customer team**, with **no Master row on prod** — therefore no
`desc_owar` / `d_war` / `total_desc_war`, no power ratings, no projection, no market value, and 8.5 runs of his
defense orphaned out of Arkansas's `team_drs`.

## ★ SCOPE IS MEASURED AND TIGHT — he is the ONLY real one
| 2026 hitter orphans (pitch-log totals, no Master row) | PROD | STAGING |
|---|---|---|
| all | 763 | 759 |
| **PA ≥ 50** | **1 (Kozeal, 287 PA)** | **0** |
| PA ≥ 150 | 1 | 0 |
The other ~762 orphans top out at **18 PA** and staging has 759 of the same — that is normal Master-inclusion
background, **NOT** a defect. Pitchers: 135 prod orphans, same character.
→ 🛑 **CORRECTED 2026-08-30: this warning was WRONG.** `--create-new` is ALREADY scoped — `MIN_PA` default **25** (`:74`) plus a **D1 gate** (`:473`). Of the 763 candidates on prod exactly **ONE** clears PA≥25 (Kozeal, 287); the rest top out at 18 PA. The threshold question is answered by the committed code: **25 PA / 20 BF**.

## WHAT TRACK B MUST DO (stage 5, the Masters rollup)
`scripts/derive_masters_from_pitchlog.ts` already builds Master rows from `pitch_log_*_totals` and already has the
`--create-new` flag (default OFF, per the standing rule "never create Master rows implicitly"). Track B must:
1. **Create missing Master rows from the pitch log** as part of the normal upload — gated by the **Master's own
   inclusion threshold** (a PA/IP qualifier), **NOT** by returner status, roster status, or portal status.
2. **Establish what that threshold actually is** before enabling creation — it is currently UNDETERMINED. The data
   says any cutoff between ~20 and ~250 PA isolates Kozeal from the background, but a hand-picked number is not an
   answer: find the rule the Master import itself uses and mirror it. ⬜ **OPEN QUESTION.**
3. Preserve the existing safety: never create rows implicitly/silently; log every row created, with name + PA/IP.
4. **Run BEFORE anything that iterates the Masters** — descriptive WAR, `team_drs`, power ratings, `computeNcaaAverages`,
   `refresh_team_season_stats`. A row created after those have run is a row that is missing from all of them.

## ★ THE GATE THIS NEEDS (a COUNT GATE CANNOT SEE THIS)
Prod has 5,340 D1 hitters and **every count check passes on 5,340** — a missing row is invisible to a count.
**MEMBERSHIP GATE, per season, after the Masters rollup:**
```sql
-- must return 0 rows; anything here PLAYED but has no Master record
select plt.batter_id, plt.pa from pitch_log_hitter_totals plt
where plt.season = :season and plt.dimension_key = 'all' and plt.pa >= :qualifier
  and not exists (select 1 from "Hitter Master" hm where hm."Season" = :season and hm.source_player_id = plt.batter_id);
```
(and the `pitch_log_pitcher_totals` / `"Pitching Master"` equivalent by IP).
**Require it to be EMPTY, or every exception explained BY NAME — never merely "small".** This is the third distinct
shape of the same lesson: *populated ≠ fresh* (Conference Stuff+), *populated ≠ right lane* (`trackman_pitches`), and
now ***count-correct ≠ complete***.

---
# 🔬 INVESTIGATION — THE MASTER NEW-ROW PATH (`derive_masters_from_pitchlog.ts --create-new`). TRACK B DEPENDS ON THIS.
Chasing why prod is missing Camden Kozeal's 2026 Hitter Master row turned into an audit of the **new-row creation
path itself** — the mechanism Track B must use on every upload. Everything below is VERIFIED on prod, read-only.

## ✅ CORRECTION TO MY OWN EARLIER WARNING — `--create-new` IS ALREADY CORRECTLY SCOPED
I previously wrote that `--create-new` "would create ~763 rows, 762 of which should not exist." **THAT WAS WRONG.**
The producer already gates new rows on **two** filters (`:469`, `:473`):
- **`MIN_PA` — default 25**, overridable via `--min-pa <n>` (`:74`, `:39`). Pitchers: `MIN_BF` default 20.
- **D1 gate** — `if (!team || team.division !== "D1") skip`.
Measured on prod: of **763** hitter new-row candidates, exactly **ONE** clears PA ≥ 25 — **Kozeal (287 PA)**. The other
762 top out at **18 PA**. So the flag self-scopes correctly and the threshold question I logged as OPEN is **ANSWERED
BY THE COMMITTED CODE: 25 PA / 20 BF.**

## ✅ THE ROW CAN BE DERIVED ENTIRELY FROM PROD — NO COPY FROM STAGING NEEDED
Verified prod's own pitch log reproduces staging's Master values **exactly**:
`AVG (38+18+2+20)/243 = .321` · `OBP (78+36+4)/287 = .411` · `SLG 160/243 = .658` — staging Master: **.321 / .411 / .658**.
And the identity resolves from prod alone: `pitch_log.batting_team_id = '3375'` → `"Teams Table"` (Season-filtered) →
`University of Arkansas · SEC · D1 · id 5679ed85-…`; name from `players`; hand from the pitch log (`batter_hand = L`).
★ **What a new Master row actually needs is NARROW.** Staging's Kozeal row has 60 populated columns, but the 11
`*_score` fields, the 4 power ratings, and the whole `desc_*`/`woba`/`wraa` block (+ `_reg`) are **DOWNSTREAM OUTPUTS**
of C26 and Phase D — they compute themselves once the row exists. (Proof: prod's reference Arkansas hitter has only
**45** populated columns, precisely because Phase D has not run there.) Only identity + slash line + the batted-ball /
discipline block must be seeded, and all of it is pitch-log-derived anyway.
⛔ **So there is NO justification for copying the row from staging** ([[feedback_derive_over_copy]]).

## 🔴 UNRESOLVED CONTRADICTION — EVERY GATE PASSES, YET THE RUN REPORTED 0 NEW ROWS
Gate-by-gate trace for `source_player_id 1925267789` against PROD (each verified individually):
| gate | result |
|---|---|
| in `pitch_log_hitter_totals` (season 2026, `dimension_key='all'`) | ✅ YES, `pa = 287` |
| already has a 2026 `"Hitter Master"` row (→ would exclude) | ✅ NO — he IS a candidate |
| representative `pitch_log` row (`repRows`, `:444`) | ✅ `batting_team_id='3375'`, `C. Kozeal`, hand `L` |
| `teamBySource.get('3375')` (Teams Table, Season-filtered) | ✅ Arkansas, SEC, **D1**, Season 2026 |
| `MIN_PA` ≥ 25 | ✅ 287 |
**And a faithful replica of `buildNewRows`' candidate selection — same ordered pagination, same filters — returns:**
```
hmAll (Hitter Master 2026): 8244 rows → 8244 distinct   contains Kozeal? NO  ← candidate
hitterTotals:               6099 rows → 6099 distinct   contains Kozeal? YES pa=287
newHitterIds: 763           includes Kozeal? YES
  of those PA>=25: 1  → ["1925267789"]
```
→ **The producer SHOULD create exactly one row: his. The dry-run reported `0 hitters, 0 pitchers` and
`(skipped — non-D1 team / unresolved identity / below sample gate: 898)`.**
⚠ The captured output was **missing its header** (began mid-table, no env banner, no "Pitch-log totals: N hitters"
line), so the 0 may have come from a truncated or stale capture. ✅ **RESOLVED — the clean re-run confirmed `0` was REAL, and the root cause is now found: a wrong argument in the `repRows` call at `:465` (`"batting_team_id"` passed where `"batter_id"` belongs), whose timeout error is then discarded at `:451`. See the ROOT CAUSE block.**
**DO NOT resolve this by assumption. It is either (a) a capture artifact, or (b) a real silent failure in the new-row
path — and (b) would be a TRACK B BLOCKER, because a daily automated upload would silently never create anyone.**

## ⚠ SIDE-FINDING — STAGING'S KOZEAL ROW POINTS AT THE **2025** TeamID
Both envs carry two Arkansas `"Teams Table"` rows: `47acae04-…` (Season **2025**) and `5679ed85-…` (Season **2026**).
Staging's 2026 Kozeal Master row has `TeamID = 47acae04-…` — **the 2025 row.** The producer resolves Season-filtered
and would write `5679ed85-…`. Harmless for `team_drs` (both map to `source_id 3375`), but it means **staging's Master
`TeamID` values are not uniformly season-correct** — worth a separate check before anything joins on `TeamID` across
seasons. NOT investigated.

## 🅱️ WHAT TRACK B MUST TAKE FROM THIS
1. **Use the committed producer with `--create-new` and its existing PA/BF + D1 gates.** Do not hand-build rows, do not
   copy across environments, do not invent a threshold — 25 PA / 20 BF is the committed answer.
2. **New-row creation MUST run before anything that iterates the Masters** (descriptive WAR, `team_drs`, power ratings,
   `computeNcaaAverages`, `refresh_team_season_stats`). A row created afterwards is missing from all of them.
3. **`--create-new` needs its own VALUE gate**, because "0 rows created" is indistinguishable from "nothing to create":
   after the stage, re-run the membership query and require it to be EMPTY. See the MEMBERSHIP GATE block.
4. **Never trust a background/truncated log.** Validate by re-querying the DB, or by a full captured run — this
   investigation was nearly concluded off a header-less capture. Same rule as "validate by CONTENT, not exit code."

---
# 🐛🔴 ROOT CAUSE FOUND — `derive_masters_from_pitchlog.ts` CAN **NEVER** CREATE A HITTER MASTER ROW (2026-08-30)
**This is a REAL, CONFIRMED BUG, not a capture artifact. It is a TRACK B BLOCKER.** Found by chasing why prod is
missing Camden Kozeal's 2026 Hitter Master row; the missing row is the *symptom*, this is the *cause*.

## THE DEFECT — AN ARGUMENT IN THE WRONG POSITION
```ts
async function repRows(ids, idCol, teamCol, abbrevCol, handCol) {        // :444
  … await sb.from("pitch_log").select(`${teamCol}, ${abbrevCol}, ${handCol}`)
        .eq("season", SEASON).eq(idCol, id).limit(1);                    // :451  ← filters on idCol
  if (data && data[0]) map.set(id, data[0]);                             // ← `error` is DISCARDED
}

repRows(newHitterIds,  "batting_team_id", "batting_team_id", "batter_abbrev_name", "batter_hand");  // :465 ❌
repRows(newPitcherIds, "pitcher_id",      "pitching_team_id", "pitcher_abbrev_name","pitcher_hand"); // :486 ✅
```
The **pitcher** call correctly passes `"pitcher_id"` as `idCol`. The **hitter** call passes **`"batting_team_id"`** —
the TEAM column — in the ID-column position. So it executes
`pitch_log WHERE season=2026 AND batting_team_id = '<a player id>'`.

## WHY IT FAILS SILENTLY (three failures stacked)
Verified on PROD:
```
AS CALLED  .eq('batting_team_id', playerId) → null   err: "canceling statement due to statement timeout"
CORRECT    .eq('batter_id',       playerId) → [{"batting_team_id":"3375","batter_abbrev_name":"C. Kozeal","batter_hand":"L"}]
```
1. A player id never matches a team id, so the predicate matches **nothing**…
2. …and scanning **2,576,146** `pitch_log` rows for it **EXCEEDS THE STATEMENT TIMEOUT** — it does not merely return
   empty, it **ERRORS**.
3. `:451` destructures **only `data`** and throws the error away ⇒ `rep` is `undefined` ⇒ `resolveTeam(undefined)` is
   `undefined` ⇒ `if (!team || team.division !== "D1") { skipped++; continue; }` ⇒ **skipped, silently.**
**Consequence: NO hitter Master row can EVER be created by this producer, on any environment, at any PA threshold.**

## THE EVIDENCE THAT PINNED IT (every other gate was cleared first)
Faithful read-only replicas against PROD, each ruling out a candidate cause:
| checked | result |
|---|---|
| `hmAll` (Hitter Master 2026, ordered pagination) | 8,244 rows / 8,244 distinct — Kozeal **NOT** present ⇒ he IS a candidate |
| `hitterTotals` (`pitch_log_hitter_totals`, `dimension_key='all'`) | 6,099 distinct — Kozeal present, `pa=287` |
| `newHitterIds` | **763**, includes Kozeal; **exactly 1** clears `MIN_PA=25` → `["1925267789"]` |
| `teamBySource` (Teams Table Season=2026) | 466 rows, 0 NULL `source_id`, `'3375'` → University of Arkansas **D1** ✅ |
| `repRows` replica using the **CORRECT** `batter_id` | **763 resolved · 0 errored · 0 no-row** |
| the ACTUAL run | **0 hitters created**, `skipped … 898` |
★ **`898 = 763 hitters + 135 pitchers` — i.e. EVERY candidate of both kinds.** A universal skip, not a selective one,
is what pointed at a shared gate rather than at the data.
(The 135 pitchers are separately explained by `MIN_BF=20`; the pitcher `repRows` call itself is correct.)

## ✅ THE FIX (one argument)
`:465` → `repRows(newHitterIds, "batter_id", "batting_team_id", "batter_abbrev_name", "batter_hand")`
**AND — independently — stop swallowing the error at `:451`:** `const { data, error } = …; if (error) { … }`. Count and
report failures; a timeout must never masquerade as "this player has no pitch-log row." Without this second change the
same class of failure stays invisible next time.

## 🅱️ WHAT THIS MEANS FOR TRACK B — READ THIS TWICE
Track B is **ONE EDGE FUNCTION RUNNING ONCE PER DAY, UNATTENDED.** This bug is precisely the failure mode it cannot
survive:
- the stage **runs**, **exits 0**, and prints a plausible number (`0 new rows`)
- "0 created" is **indistinguishable** from "nothing to create" — and 362 days a year, "nothing to create" is the
  truth, so it looks right
- the only visible symptom is a **missing row**, which **no count gate can detect** (prod has 5,340 D1 hitters and
  every count check passes on 5,340)
- it took a **team-level dRS discrepancy on one team** to surface a **single missing player**
**Therefore Track B MUST:** (1) treat any swallowed error as a **hard stop**, never a coerced empty; (2) gate the
new-row stage on the **MEMBERSHIP query**, not on a count or an exit code; (3) **log every row it creates by name +
PA/IP**, and log explicitly when it creates none *and why*.

## 🧠 THE META-LESSON — THE FOURTH SHAPE
1. *populated ≠ fresh* (Conference `Stuff_plus` 30/30 but pre-v2)
2. *populated ≠ right lane* (`trackman_pitches` full, from the legacy table)
3. *count-correct ≠ complete* (5,340 hitters, one of them missing)
4. **NEW: *ran ≠ did anything*** — a stage can execute, exit 0, report a believable figure, and be structurally
   incapable of ever doing its job.
**And the process lesson:** I nearly closed this off a truncated background log that was missing its header. The clean
full capture is what confirmed `0` was real and sent me to the code. **Never conclude from a partial log.**

---
# 🅱️ TRACK B — MASTER `TeamID` IS NOT SEASON-CONSISTENT, AND A SPLIT IS SILENT UNTIL IT ISN'T (2026-08-30)
## THE UNDERLYING CONDITION
`"Teams Table"` carries **one row per team PER SEASON** — prod has **308 rows for Season 2025** and **466 for 2026**,
each with its own `id`. So a single program has MULTIPLE `TeamID` uuids. Arkansas (`source_id 3375`):
`47acae04-1225-4506-9c12-8d6e55cbe9c5` = **Season 2025** · `5679ed85-eeea-4e47-be59-53ffc5087b38` = **Season 2026**.
**The 2026 Masters do NOT consistently use the 2026 id.** Measured on PROD, Season 2026, Arkansas:
| table | `47acae04…` (2025 id) | `5679ed85…` (2026 id) |
|---|---|---|
| `"Hitter Master"` | **16** | 0 |
| `"Pitching Master"` | **18** | **1** ⚠ |
Staging's 2026 Kozeal row likewise carried the **2025** id. **So the 2025 id is the DE-FACTO convention in the 2026
Masters, and the lone pitcher on the 2026 id is a PRE-EXISTING SPLIT that predates this session.** ⬜ NOT FIXED —
logged for whenever the Master `TeamID` question is addressed properly.

## 🛑 WHY THIS MATTERS — ANY TEAM-LEVEL ROLLUP KEYED ON `TeamID` SILENTLY SPLITS THE TEAM
`derive_team_drs.mjs` groups `Σ drs_floor` by the Masters' `TeamID`. If one player carries a different (but equally
"valid") `TeamID` for the same program, he becomes **his own team**. Demonstrated live: after inserting Kozeal with the
**2026** id (I "corrected" staging's 2025 id, assuming it was a bug — **IT WAS NOT**), the producer emitted:
```
div D1: 309 teams          ← was 308
Arkansas  team_drs 32.770  raw_floor 35.255  team_IP 475.0
Arkansas  team_drs  8.429  raw_floor  8.502  team_IP  14.0   ← Kozeal, alone, as a "team"
```
Reverting his `TeamID` to `47acae04…` restored **308 teams**, `raw_floor 43.757` (**exactly staging's**), `team_drs 41.272`.
★ The split announced itself ONLY because the division team-count moved 308→309 and the centering assertion still held.
**A per-team value check would have passed** — both buckets are internally consistent. **What caught it was a
CARDINALITY check.**

## 🅱️ REQUIREMENTS FOR TRACK B
1. **Resolve `TeamID` ONE way, from ONE place, for the whole run** — do not mix a per-season lookup with whatever the
   Masters happen to hold. Prefer joining on **`source_team_id` / `source_id`** (season-stable) over the per-season
   uuid wherever a rollup groups by team. [[feedback_id_over_name]] extends here: *stable* id over *any* id.
2. **When creating a Master row, adopt the `TeamID` its TEAMMATES already use** — never resolve it independently from
   `"Teams Table"` by season. That is exactly the mistake made here, and it silently split a customer team.
3. **CARDINALITY GATE on every team-level rollup:** assert the produced team count EQUALS the expected division count
   (D1 = 308) and FAIL otherwise. A per-team value gate cannot see a split; a count of teams can.
4. The zero-sum centering assertion (`Σ centered = 0`) **does NOT protect against this** — it held at 309 teams.

## ✅ D29b DONE ON PROD (2026-08-30) — team_drs DERIVED, not pasted
`scripts/drs/derive_team_drs.mjs --prod` (guard + ordered pagination added this session; reproduces staging's committed
values **308/308 exact**, worst |Δ| 0.0000) → `scripts/sql/team_drs_store_PROD_2026_08_30.sql` → applied.
`BEFORE with_drs 308 · sum -0.01 · Arkansas 41.060 (staging paste)`
`AFTER  with_drs 308 · sum  0.00 · Arkansas 41.272 (PROD-DERIVED)`  — 308 rows updated.
Residual vs the old staging values: **mean |Δ| 0.100**, max ~0.54 — prod's D1 population differs slightly (5,341 vs
5,343 hitters), shifting the centering rate. Expected, not a defect.
**Also on prod:** Camden Kozeal's 2026 Hitter Master row INSERTED (5,340 → **5,341** D1 hitters) — 31 seed columns,
**all 29 derived columns deliberately omitted** so C26 and Phase D compute them on prod.

---
# ✅ D31 DESCRIPTIVE WAR — APPLIED TO PROD 2026-08-30. Verified IN THE DATABASE, not from the log.
`node scripts/drs/populate_descriptive_war.mjs --prod --commit` (run under `caffeinate -dimsu`, full output captured).
`Hitter Master: 5340/5340 written, 0 FAILED` · `Pitching Master: 5374/5374 written, 0 FAILED` · `done. 0 write errors.`
★ **That "0 FAILED" line only exists because of the fix made earlier the same day** — write errors were previously
`console.error`'d but **NOT counted and NOT fatal** inside a ~10,715-update loop that then exited 0, so a partial write
was indistinguishable from a clean one. Now counted, summarised per table, and `exit 1` on any failure.

## PHASE GATE — PROD vs STAGING REFERENCE (2026, D1)
| metric | PROD | staging ref | ✓ |
|---|---|---|---|
| `desc_owar` mean | **0.3458** | 0.3456 | ✅ |
| `d_war` mean | **0.0103** | 0.0103 | ✅ |
| `bsr_war` mean | **0.0000** | 0.0000 | ✅ |
| `total_desc_war` mean | **0.3562** | 0.3559 | ✅ |
| `desc_pwar` mean | **0.5108** | — | ✅ |
| sum identity `max abs(total_desc_war − (desc_owar+d_war+bsr_war))` | **0.001000** | ≤ 0.002 | ✅ |
| coverage | hitters **5,340 / 5,341** · pitchers **5,374 / 5,375** | — | ✅ |
| `drs_behind` | **5,374** populated · range **−5.26 … 6.84** · **7** exact zeros | — | ✅ |
`bsr_war` (= `wsb_runs / RPW 13.1`, from `player_season_baserunning`) range **−0.386 … 0.502**, centered at 0.
The single missing hitter and pitcher are the pre-existing `sheet-miss 1` — players absent from the source CSV,
unchanged from before this run. NOT a defect.

## ★★ THE STRONGEST VALIDATION OF THE DAY — INDEPENDENT REPLICATION ON CAMDEN KOZEAL
```
PROD    Camden Kozeal — desc_owar 2.404 · d_war 0.649 · bsr_war -0.051 · total_desc_war 3.002
STAGING Camden Kozeal — desc_owar 2.404 · d_war 0.649 · bsr_war -0.051 · total_desc_war 3.002
```
**IDENTICAL to three decimals.** A player who had **no Master row and no numbers at all on prod** hours earlier now
matches the reference exactly — computed from **prod's own** pitch log, **prod's own** Master row (31 seed columns,
zero derived columns copied), **prod's own** `player_season_defense`, and a `team_drs` **derived on prod**. Nothing was
copied from staging except the seed stat line, which was itself cross-checked against prod's pitch log (.321/.411/.658).
★ This closes the loop opened by the Arkansas `team_drs` discrepancy: detector → missing player → root-cause bug →
row created → `team_drs` re-derived → descriptive WAR matches. **Every link verified, none assumed.**

## ORDER NOTE FOR THE NEXT STEP (D32) — THE SILENT ONE
`populate_descriptive_war_reg.mjs:79` reads `"Pitching Master".drs_behind` and coerces **`NULL → 0`**, so running it
before D31 commits yields wrong `desc_ra9_reg` / `desc_pwar_reg` with **NO error**. Gate satisfied: `drs_behind` is
**5,374/5,375 non-null** on prod. **Verify this count, never "D31 exited cleanly".**

---
# ✅✅ PHASE D COMPLETE ON PROD — 2026-08-30. D34 verification passed on every gate.
| step | result |
|---|---|
| **D29b** `team_drs` | **DERIVED on prod** (not pasted) via `derive_team_drs.mjs --prod` → 308 D1 teams, Σ centered −0.0000, stored: `with_drs 308 · sum 0.00`. Arkansas 41.060 → **41.272**. |
| **D30** dRS/wSB load | **NO-OP confirmed** by dry-run — `13454 would upsert / 11 unresolved`, `10432 / 30 unresolved`; data already present at `drs-engine-0.11.0` / `0.6.0`. Apply intentionally SKIPPED. |
| **D31** descriptive WAR | **COMMITTED** — `Hitter Master 5340/5340 written, 0 FAILED` · `Pitching Master 5374/5374 written, 0 FAILED` · `0 write errors`. |
| **D32** `_reg` split | **COMMITTED** — `Hitter Master 5322/5322` · `Pitching Master 5372/5372`. |
| **D33** | folded into D29b (it IS the `team_drs` producer). |
| **D34** | **PASSED — all 9 checks below.** |
| *(unplanned)* | **Camden Kozeal's 2026 Hitter Master row CREATED** → 5,340 → **5,341** D1 hitters. |

## D34 RESULT (prod, Season 2026, division='D1') — the numbers to compare against next time
```
✅ hitters desc_owar/d_war/bsr_war/total_desc_war   5340/5340/5340/5340 of 5341
✅ hitters _reg set                                 5322/5322/5322/5322
✅ pitchers desc_pwar/desc_ra9/drs_behind           5374/5374/5374 of 5375
✅ pitchers _reg                                    5372/5372
✅ avg d_war      0.0103   (≈0.010)
✅ avg bsr_war    0.0000   (≈0.000)
✅ avg desc_owar  0.3458   (≈0.346)
✅ sum identity   0.001000 (≤0.002)   max|total_desc_war − (desc_owar+d_war+bsr_war)|
✅ drs_behind range  −5.26 … 6.84
ℹ  avg total_desc_war 0.3562 · _reg 0.3354 · avg desc_pwar 0.5108 · _reg 0.5385
```
The one uncovered hitter and pitcher are the pre-existing `sheet-miss 1`; the 19 hitter / 3 pitcher `_reg` shortfalls
are players absent from `hitter_accrued.csv` / the line file — **matching staging exactly (5,322 and 5,372)**. Expected.

## ⚠ KNOWN GAP CARRIED FORWARD — `populate_descriptive_war_reg.mjs` STILL SWALLOWS WRITE ERRORS
The error-counting fix (count failures, summarise per table, `exit 1`) was applied to **`populate_descriptive_war.mjs`
ONLY**. `_reg` still logs errors without counting them and prints a bare `done.` — so a partial `_reg` write would
still look clean. It happened to succeed here (`5322/5322`, `5372/5372` progress counters reached full), but
**apply the same fix to `_reg` before it is ever re-run.** ⬜ OPEN.

## ▶️ NEXT PER THE CORRECTED ORDER (NOT the topic order)
`E2` park factors seasonal → **★ re-run `derive_conf_opr_htp --apply --prod`** (E2 rewrites `rg_factor`, invalidating
C28's `run_env_factor`/`hitter_talent_plus` at 30/30 — a count check will PASS either way) → `D33b` lock-regular-season
(`regular_season_ip` is 0/5,375 and `refresh_team_season_stats` divides by it) → **`F44` MOVED UP** (Phase E reads
`team_season_stats.faced_*`) → `E35` TWP → `E36/37/38` precomputes → `F39`… See
`docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md`.

---
# 🚨 THE EXACT MATH + THE THINGS THAT MUST BE CAUGHT (2026-08-30). Every number here is VERIFIED ON PROD.
Consolidated so a reader never has to reconstruct a formula or a constant from prose. **If a number below does not
reproduce, STOP — do not proceed to the next stage.**

## 1. THE CONSTANTS (from `populate_descriptive_war.mjs`'s own banner, prod run 2026-08-30)
```
RPW 13.1   E2T 1.1373   replRA9 8.83   wOBA lg 0.3782   wOBA scale 0.947   offense replacement 1.62/600
```
`RPW = 13.1` is the divisor for **every** WAR quantity. ⚠ Older docs say ÷10 (Push-1 v1) — **SUPERSEDED**.

## 2. DESCRIPTIVE WAR — THE ACTUAL FORMULAS
```
HITTER   wraa            = ((woba − lgwOBA 0.3782) / wOBAscale 0.947) × PA
         desc_owar       = wraa/13.1 + (PA/600) × 1.62
         d_war           = Σ drs_floor (positions ≠ P) / 13.1
         bsr_war         = wsb_runs / 13.1
         total_desc_war  = desc_owar + d_war + bsr_war          ← IDENTITY, must hold to ≤0.002
PITCHER  drs_behind      = team_drs × (pitcher_IP / team_IP)     ← Σ over a team's pitchers = 0 EXACTLY
         desc_ra9        = 0.5 × (RA9 + drs_behind_per9) + 0.5 × (FIP × 1.137)
         desc_pwar       = (replRA9 8.83 − desc_ra9) × (IP/9) / 13.1
TEAM     team_drs        = Σ drs_floor(team) − (division Σdrs_floor / division ΣIP) × team_IP
                           ← innings-weighted centering PER DIVISION; Σ centered = 0 EXACTLY
```

## 3. THE VERIFIED PROD NUMBERS (Season 2026, division='D1') — compare against these
```
hitters 5,341 rows · desc_owar/d_war/bsr_war/total_desc_war = 5,340 each · _reg set = 5,322 each
pitchers 5,375 rows · desc_pwar/desc_ra9/drs_behind = 5,374 each · _reg = 5,372
avg desc_owar 0.3458   avg d_war 0.0103   avg bsr_war 0.0000   avg total_desc_war 0.3562  (_reg 0.3354)
avg desc_pwar 0.5108  (_reg 0.5385)       drs_behind −5.26 … 6.84       sum identity worst 0.001000
team_drs: 308 D1 teams · sum 0.00 · Arkansas 41.272 (raw_floor 43.757, team_IP 475.0)
Conference Stuff+ D1 99.15 · NJCAA_D1 96.00 · D2 93.00     p_ncaa_avg_stuff_plus 100.0141 · p_sd_stuff_plus 5.04577
Stuff+ per-pitcher gate: mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7  (IDENTICAL prod ↔ staging)
```

## 4. 🛑 THE SIX THINGS THAT MUST BE CAUGHT — each PASSED a naive check while being WRONG
| # | what | the naive check that PASSES | what actually catches it |
|---|---|---|---|
| 1 | **Conference `Stuff_plus` stale (pre-v2)** — 101.17, should be 99.15 | `count(*) = 30/30` ✅ | compare the VALUE before/after; it is written by a **4th producer** (`conferenceStuffPlusV2`) the runbook omitted |
| 2 | **`trackman_pitches` from the LEGACY lane** — undercounts ~12.1 pitches/pitcher, only **638/5,367 (11.9%)** matched | column fully populated ✅ | check the LANE, not the fill: D1 must come from `pitch_log_pitcher_totals.total_pitches` @ `dimension_key='all'` |
| 3 | **`run_env_factor` goes stale under E2** — E2 rewrites `rg_factor`, which `derive_conf_opr_htp:10` reads | `30/30` before AND after ✅ | value must CHANGE from **101.879**; re-run `derive_conf_opr_htp` AFTER E2 |
| 4 | **Missing Master row (Kozeal, 287 PA, 20 HR)** | `5,340 = 5,340` ✅ | **MEMBERSHIP diff**, not a count — pitch-log PA ≥ qualifier with no Master row must be EMPTY |
| 5 | **`--create-new` structurally broken** — `:465` passes `"batting_team_id"` as `idCol`; query times out over 2,576,146 rows; `:451` discards `error` | exit 0, prints `0 new rows` ✅ | "0 created" ≠ "nothing to create" — gate on the MEMBERSHIP query, and NEVER swallow `error` |
| 6 | **Team split by `TeamID`** — one player on the 2026 uuid vs 16 on the 2025 uuid ⇒ Kozeal became his own 14-IP "team" | per-team values internally consistent ✅ · Σ centered = 0 **held at 309 teams** ✅ | **CARDINALITY gate**: assert D1 team count **= 308**, fail otherwise |

## 5. 🛑 SILENT-FALLBACK INVENTORY — a missing input yields a plausible WRONG number, with NO error
| producer | the coercion | consequence |
|---|---|---|
| `computeAndStoreScores.ts:206-211,:249` | missing `ncaa_averages` field → **hardcoded default** (`:212-215`) | wrong power ratings; **run C27 BEFORE C26** |
| `populate_descriptive_war_reg.mjs:79` | `num(NULL) → 0` on `drs_behind` | wrong `desc_ra9_reg`/`desc_pwar_reg`; **D31 must commit first** (gate: `drs_behind` 5,374/5,375) |
| `precompute-transfer-projections.ts:225` / `precompute-pitchers.ts:279` | `const { data } =` discards `error`; `(rows \|\| [])` | empty faced-competition Map ⇒ Independents lose the adjustment; **F44 must precede Phase E** |
| `refresh_team_season_stats.sql:143` | `nullif(sum(regular_season_ip),0)` → NULL | every regular-season rate NULL; **needs lock-season (`regular_season_ip` is 0/5,375 on prod)** |
| `compute_pitch_log_stuff_plus.ts` | `classification_version` filter mismatch | scores **0 rows, exits 0**; pass the stamp just written, never a literal |
| `derive_masters_from_pitchlog.ts:451` | discards `error` on a timing-out query | **no hitter row can ever be created** |

## 6. ✅ THE GATES THAT ACTUALLY WORK (use these, not counts)
1. **VALUE gate** — compare the number before/after, and to a reference env for the SAME season (2026 = descriptive, 2027 = projections).
2. **MEMBERSHIP gate** — diff the ID SET, not the count. Caught Kozeal.
3. **CARDINALITY gate** — assert the expected number of GROUPS (D1 = 308 teams). Caught the `TeamID` split.
4. **IDENTITY gate** — `total_desc_war = desc_owar + d_war + bsr_war` ≤ 0.002; `Σ team_drs = 0`; `Σ drs_behind = 0`.
5. **LOG-CONTENT gate** — read the log body, never the exit code. `0 FAILED` must be printed, not inferred.
6. **SIGN gate** — arm-side pitches positive armHB for BOTH hands (18/18 buckets), else ABORT before writing.

---
# ✅ E2 PARK FACTORS + MANDATORY C28-STEP-3 RE-RUN — APPLIED TO PROD 2026-08-30
## E2a — code fixes first (the docs already called for the guard; the banner was found during the dry run)
- double-keyed `--prod` guard + env-driven URL/key (was a **literal staging URL** + literal `.env.local` read).
- 🛑 **LYING BANNER FIXED** — `:215` printed `MODE: … target=STAGING` **while running against PROD**. Identical defect
  to `_run_store_no_propagate.ts` (C26). Now prints the RESOLVED env. **Third instance of this class.**

## E2b — DRY RUN + the TEAM-BY-TEAM GATE (a row count would have hidden this)
`_parkfactors_backup` verified **615 rows = 306 (2025) + 309 (2026)** before touching anything.
CSV 2026 = **308** teams vs PROD 2026 = **309** rows ⇒ delete+reinsert would drop one.
**Diffed BY NAME: the single dropped team is `Fort Wayne`.** ✅ **CORRECT — Trevor: they had no 2026 team.**
⚠ My first diff was WRONG and briefly reported "309 would be dropped" — my probe matched the CSV's **`teamId`**
column instead of **`team`** (`/team/i` hits `teamId` first). Corrected immediately. **The real name column is `team`
(index 3): `Rank,teamId,teamName,team,teamFullName,…`.** Do not re-derive this by regex; use the literal column name.

## E2c — APPLIED. `✓ Wrote 922 rows across 2024/2025/2026 (seasonal + main).`
| season | rows before → after | `rg_factor` | **`rg_factor_seasonal`** |
|---|---|---|---|
| 2024 | *(absent)* → **307** | 307 | **307** |
| 2025 | 306 → **307** | 307 | **307** |
| 2026 | 309 → **308** | 308 | **308** |
**`rg_factor_seasonal` 0/309 → fully populated — the objective of E2.** Georgia 2026 `rg_factor` = **109.35**,
exactly the dry-run's predicted rolling value; `rg_factor_seasonal` = 107.76 (single-season). Fort Wayne now present in
2024/2025 only. ⚠ `source_team_id` is 306/307 for 2024 and 2025 (2 unmapped historical teams) — 308/308 for 2026.

## ★ E2d — THE MANDATORY RE-RUN, AND THE NUMBER THAT PROVES IT
E2 rewrites the **MAIN** factor columns (current season → 3-yr rolling), and `derive_conf_opr_htp.ts:10` reads
`"Park Factors".rg_factor`. Measured rewrite magnitude from the dry run:
```
RG  mean|Δ| 2.16  max|Δ| 7.24 (n=308)   ISO mean|Δ| 2.11  max 7.07   AVG 0.65   OBP 0.38
worst: Monmouth/rg 100.3→93.06 · Mississippi Valley State/rg 134.44→127.52 · Northern Colorado/rg 121.5→115.08
```
`npx tsx --env-file=.env.production.local scripts/derive_conf_opr_htp.ts --apply --prod` → **APPLIED 30 rows.**
| | BEFORE | AFTER |
|---|---|---|
| `run_env_factor` **count** | **30/30** | **30/30** ← ⚠ **IDENTICAL — a count gate PASSES either way** |
| `run_env_factor` **avg** | **101.879** | **99.719** (**−2.16**) |
| `hitter_talent_plus` avg | 100.13 | **99.23** (−0.90) |
★★ **The `run_env_factor` shift of −2.16 EQUALS the park `RG mean|Δ|` of 2.16.** The competition-translation lever
moved by exactly the amount park factors moved. Had E2 been run in its documented Phase-E slot *after* C28, this value
would have been silently stale at a passing 30/30 — biasing every projection of a player INTO a conference.
Division split intact: **D1 30 · NJCAA_D1 10 · D2 2.** Sample HTP moves: Big 12 117.2→**119.1** · SBC 103.8→**107.7** ·
Independent 109.1→**122** · MWC 95.7→**96** · The Summit 93.8→**93.4**.

## 🧠 RULE CONFIRMED BY MEASUREMENT
**`derive_conf_opr_htp` must be the LAST thing to touch park-derived conference columns.** Any stage that rewrites
`"Park Factors".rg_factor` invalidates `run_env_factor` / `hitter_talent_plus` / `offensive_power_rating` **without
changing their fill count**. Gate on the VALUE CHANGING, never on the count.

---
# 🔬 E2 PROD↔STAGING COMPARISON — HOW IT WAS VERIFIED, AND WHAT A DIFFERENCE MEANS (2026-08-30)
Run AFTER E2 + the `derive_conf_opr_htp` re-run. **Method matters as much as the result** — this is the template for
comparing the two environments now that they have diverged.

## METHOD (do it this way; a row count proves nothing)
1. **Structural:** row counts + non-null counts per season, both envs.
2. **VALUE-level:** pull all 2026 rows from each, **join on `team_name`**, compare each numeric field, report
   `matched / IDENTICAL / worst |Δ|` — never just "counts agree".
3. **Downstream:** compare the consumers (`Conference Stats`) separately, and **attribute every difference** to a
   named cause before calling it a defect.

## ✅ RESULT 1 — PARK FACTORS ARE *IDENTICAL*. This is INDEPENDENT REPLICATION, not a copy.
| | PROD | STAGING |
|---|---|---|
| rows 2024 / 2025 / 2026 | **307 / 307 / 308** | **307 / 307 / 308** |
| `rg_factor` populated | 307 / 307 / 308 | 307 / 307 / 308 |
| `rg_factor_seasonal` populated | 307 / 307 / 308 | 307 / 307 / 308 |
| **2026 `rg_factor` joined on `team_name`** | **308 matched · 308 IDENTICAL · worst \|Δ\| 0.0000** | |
| **2026 `rg_factor_seasonal`** | **308 IDENTICAL** | |
Same source CSVs, same formula, executed separately against two different databases → **byte-identical output**.
Prod's park factors are now in exactly the state staging is in. ★ This is the same class of evidence as the Stuff+
per-pitcher gate (mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 identical across two different pitch populations) and
the Kozeal descriptive-WAR match (2.404 / 0.649 / −0.051 / 3.002 to three decimals).

## ✅ RESULT 2 — `run_env_factor` IDENTICAL; the other two differ FOR A KNOWN REASON
| Conference Stats 2026 D1 | PROD | STAGING | verdict |
|---|---|---|---|
| `run_env_factor` | **99.719** | **99.719** | ✅ **identical** — the purely park-derived value. Identical parks ⇒ identical result. **The E2 → `derive_conf_opr_htp` chain is verified end-to-end.** |
| `Stuff_plus` | 99.15 | 99.16 | Δ −0.01 — immaterial |
| `hitter_talent_plus` | 99.23 | 99.01 | Δ +0.22 — **EXPECTED, see below** |
**Why HTP differs:** `HTP = OPR + 1.25·(Stuff+ − 100) + 0.75·(100 − run_env)`. `run_env` is now identical and Stuff+ is
within 0.01, so the difference comes from **`offensive_power_rating`**, which is built off the **Masters** — and
**STAGING NEVER RECEIVED C24 / C26 / C27 / C28 / C28b / C29.** Its Master-derived inputs are OLDER.
🛑 **THEREFORE: PROD IS THE MORE CURRENT SIDE FOR THESE COLUMNS. A prod↔staging mismatch here is NOT a prod defect.**
Prod is also ahead on `pitcher_ev90`, `pitcher_exit_velo`, `pitcher_in_zone_pct`, `pitcher_iz_whiff_pct`
(**30/30 prod vs 0/30 staging**) and `pitcher_ev_score`/`pitcher_iz_score` (**30/30 vs 0/30**).

## 🧭 THE RULE THIS ESTABLISHES — HOW TO READ ANY PROD↔STAGING DIFFERENCE FROM NOW ON
Before calling a difference a defect, answer **in this order**:
1. **Is the input identical?** (park CSVs, engine CSVs, pitch log) — if yes, an output difference is a real signal.
2. **Which env is BEHIND on the producing step?** Staging is missing C24/C26/C27/C28/C28b/C29. Prod is missing nothing
   in Phase C. **Whoever is behind explains the gap; do not "fix" the current side toward the stale one.**
3. **Is the differing column derived from the Masters?** If so, staging's drift explains it.
4. Only if 1–3 do not explain it is it a defect.
⛔ **NEVER reconcile prod TO staging by copying values.** That is what produced the `team_drs` paste that had to be
undone, and it would have carried staging's Arkansas 41.060 (a value prod could not reproduce) into prod permanently.

---
# 🅱️🔴🔴 TRACK B BLOCKER — **WAR MUST READ THE DB MASTERS, NOT TruMedia CSVs.** ARCHITECTURE DIRECTIVE (Trevor, 2026-08-30)
**THIS IS THE MOST IMPORTANT ITEM IN THIS DOCUMENT. Track B CANNOT WORK UNTIL IT IS FIXED.**

## THE DIRECTIVE, IN TREVOR'S TERMS
> *"derive_masters_from_pitchlog.ts needs to be the one that writes all the stats and even if a little off then it
> needs to be checked and overridden if off by the master sheets. The reason why is because on track b it is going to
> be absorbing pitch logs **every day through the spring**, but only ingesting master sheets **once a month or so** —
> and the only differences should be a check on some of the information as a 2nd source… things like **stolen base and
> ERA** that aren't always perfect from deriving the pitch log. That is why it has to run in the order I am mentioning
> and I am adamant about making sure it does in fact do that."*

## THE MANDATORY ORDER
```
pitch log (DAILY)  →  derive_masters_from_pitchlog.ts writes ALL stats to the Masters
                   →  WAR / power ratings / projections READ THE MASTERS (from the DATABASE)
                   →  TruMedia Master CSV (MONTHLY) = a CHECK / OVERRIDE layer only, applied ON TOP
```
The Master **sheet** is a *second source for verification*, not the primary. Override scope is narrow and specific:
**stolen bases and ERA**, plus anything else demonstrably not derivable cleanly from the pitch log.

## 🔴 THE BLOCKER AS IT STANDS TODAY — WAR IS WIRED THE WRONG WAY ROUND
`scripts/drs/populate_descriptive_war.mjs` reads its hitting and pitching lines **from CSV FILES ON DISK**:
```js
:75  const hitSheet = sheet("docs/drs-reference/Full Season Hitting Master Stats.csv");
:76  const pitSheet = sheet("docs/drs-reference/Full Season Pitching Master Stats.csv");
:102 const PA = g("PA");         // ← from the CSV, NOT from "Hitter Master".pa
```
`"Hitter Master"` is queried at `:77` **only** to build the D1 id list (`source_player_id, division, pa`) — the `pa`
column is never used in the math. `populate_descriptive_war_reg.mjs` is the same shape, reading
`scripts/drs/output/hitter_accrued.csv` and `pitcher_line.csv`.
**⇒ In Track B there are no daily TruMedia season CSVs. A daily run would have NOTHING to read.** The WAR stage as
written is structurally incapable of running inside Track B.
★ It also means today's prod WAR was computed from **TruMedia season CSVs**, not from the pitch log — the exact
inversion of the pitch-log-primary architecture. It is CORRECT (it matched staging to four decimals) but it is
**SOURCED WRONG**, and that must not be carried into Track B.

## ✅ WHY THIS IS FIXABLE — EVERY INPUT ALREADY EXISTS, PITCH-LOG-DERIVED
Two pipelines already produce everything, and BOTH are pitch-log-sourced:
| source | window(s) | supplies |
|---|---|---|
| `pitch_log_{hitter,pitcher}_totals` (**DB**) | full | rates + batted-ball/discipline: `AVG OBP SLG ISO contact barrel chase bb line_drive gb pop_up la_10_30 k_pct avg_exit_velo ev90 pull pull_air`, pitcher `K9 BB9 HR9 WHIP FIP stuff_plus hard_hit_pct barrel_pct …`, and **`ip`** |
| `scripts/drs/output/hitter_accrued.csv` (27 cols) | **FULL + REG** | `PA AB H 2B 3B HR BB HBP SF SH AVG OBP SLG ISO` and `reg_PA reg_AB reg_H reg_2B reg_3B reg_HR reg_BB reg_HBP reg_SF reg_SH` |
| `scripts/drs/output/pitcher_line.csv` (37 cols) | **FULL + REG** | `full_IP full_BF full_K full_BB full_HBP full_H full_HR full_ER **full_ERA** full_R full_RA9 full_FIP full_WHIP full_K9 full_BB9 full_HR9 full_K_pct full_BB_pct` + the complete matching `reg_*` set incl. **`reg_ERA`** |
⚠ **Barrel%/EV are NOT in the engine CSVs** — they come from `pitch_log_hitter_totals`. Two pipelines, one lane.
★ **`full_ERA` and `full_IP` ALREADY EXIST** — yet `PITCHER_UNMAPPED = ["ERA","IP","G","GS","Role"]` still declares
them *"left to TruMedia Master (never written)"*. **That comment is now WRONG for ERA and IP.** Only `G`/`GS` (and
`Role`, which is not a stat) genuinely lack a pitch-log source today.

## 🔴 WHAT `derive_masters_from_pitchlog.ts` DOES **NOT** WRITE TODAY (the whole gap)
It ran on prod (`4,772 pitchers + 4,373 hitters · 0 new rows`) and today re-dry-runs at **0 changes** — so everything
in its write set already matches. **The gap is what is NOT in that set:**
| Master column | prod today | available from | status |
|---|---|---|---|
| `pa` / `ab` | **regular-season line** (avg pa 121.8 vs staging 128.0) | `hitter_accrued.csv` `PA`/`AB` | ❌ patched only on NEW rows |
| `regular_season_pa` | **0 / 5,341** | `hitter_accrued.csv` `reg_PA` | ❌ never written |
| `IP` | regular-season line | `pitcher_line.csv` `full_IP` · `pitch_log_pitcher_totals.ip` | ❌ in `PITCHER_UNMAPPED` |
| `regular_season_ip` | **0 / 5,375** | `pitcher_line.csv` `reg_IP` | ❌ never written |
| `ERA` | stale CSV import | `pitcher_line.csv` `full_ERA` | ❌ in `PITCHER_UNMAPPED` |
| `G` / `GS` | stale CSV import | *(no pitch-log source found)* | ⬜ Master-override only |
| SB / caught stealing | Master sheet | *(partially)* | ⬜ **Master-override by design** |
**⇒ THIS is why prod has no postseason PA.** The step ran, but the counting stats were never in its write set, so the
Masters still hold whatever an older CSV import left. **VERIFIED:** prod `pa` == staging `regular_season_pa` for
**5,339/5,339 hitters (100.0%)** and prod `IP` == staging `regular_season_ip` for **5,374/5,374 (100.0%)**; **0.0%**
match the full-season values.

## ▶️ THE REQUIRED WORK, IN ORDER
1. **Extend `derive_masters_from_pitchlog.ts` to write the counting stats to EXISTING rows** — `pa`, `ab`, `IP`, `ERA`
   — plus the **reg/post split** into `regular_season_pa` / `regular_season_ip` from `reg_PA` / `reg_IP`.
   Boundary is `scripts/drs/drs_engine/season_config.py` → **`2026: regular_season_end 2026-05-18 / postseason_start
   2026-05-19`**. Per that file's own policy: **player stats + power ratings = FULL season; program analytics =
   REGULAR season; projections target a regular-season line.**
2. **Re-point `populate_descriptive_war.mjs` / `_reg.mjs` at the DB Masters** instead of the CSV sheets. Until this is
   done Track B has no WAR stage.
3. **Add the Master-sheet CHECK/OVERRIDE layer** — monthly CSV compared against the derived values, overriding only
   where the pitch log is known-weak (**SB, ERA**), and **logging every override with both values**.
4. ⛔ **`D33b` / `lock_regular_season` IS OBSOLETE — NOT DEFERRED (Trevor, 2026-08-30).** `derive_masters_from_pitchlog` writes `pa` and `regular_season_pa` in the SAME run from the SAME source row, so the atomicity rule is met structurally and the lock has no remaining purpose. **Retire it.** Original note: That RPC is `regular_season_pa = pa` where
   NULL — a snapshot that only works if `pa` is *already* the regular-season line. It predates the engine's split, has
   **NO unlock**, and running it now would permanently freeze the pre-postseason number into `regular_season_pa` while
   `pa` is about to be rewritten to full-season. **Write both columns from the engine output instead.**

---
# 📐 SCOPE — MAKE `derive_masters_from_pitchlog.ts` FILL THE MASTERS COMPLETELY (2026-08-30). NOT YET BUILT.
**Trevor's priority, in his words:** *"what we definitely need to do though is write the derive masters from pitch log
into the master so it captures everything, recognizes the split between regular season and postseason and how that
stores into things like the team stats that are important, and just make sure every column in the master is being
filled properly — then once that is done bring in the master sheet that includes the postseason (so not the full
regular season named one)."*
★ **WAR RE-POINTING IS EXPLICITLY *NOT* REQUIRED FIRST.** Trevor: *"I don't necessarily think the WAR needs to be
reproduced and it will be mapped in Track B as long as we continue to emphasize what the goal is."* The CSV-reading
WAR stage stays flagged (see the TRACK B BLOCKER block) and is mapped into Track B later. **Do not rebuild it now.**

## THE ORDER (non-negotiable)
```
1. derive_masters_from_pitchlog.ts fills the Masters COMPLETELY from the pitch log,
   with the regular/postseason split, and feeds the team-stat rollups correctly
2. THEN import the POSTSEASON-INCLUSIVE Master sheet  ⚠ NOT "Full Season Hitting Master Stats.csv"
   — that file is the regular-season-named export. Use the one that INCLUDES postseason.
```

## ✅ COLUMN AUDIT — PROD, Season 2026, division='D1' (VERIFIED 2026-08-30)
### `"Hitter Master"` — 83 columns / 5,341 rows
| bucket | columns | verdict |
|---|---|---|
| **EMPTY (4)** | `regular_season_pa` · `trackman_pitches` · `dob` · `class_year` | `regular_season_pa` = **THE GAP** (build it). `trackman_pitches` on the HITTER table is a **pitcher concept — vestigial, confirm then ignore/drop**. `dob`/`class_year` are **roster/bio data** (roster scraper), NOT stats — out of scope here. |
| **WRONG WINDOW** | `pa` `ab` (+ the slash line that derives from them) | populated, but holding the **REGULAR-SEASON** line. Must become **FULL season**. Verified: prod `pa` == staging `regular_season_pa` for **5,339/5,339 (100.0%)**. |
| **PARTIAL — BY DESIGN, NOT DEFECTS** | `line_drive`(5163) `avg_exit_velo`(5082) `barrel`(5078) `ev90`(5151) `pull`(5216) `la_10_30`(5078) `gb`(5163) `pop_up`(5163) + their `*_score` + the 4 power ratings (5122–5130) | gated by **`MIN_TRACKED_BIP`** — legitimately null for low-sample hitters. **Do NOT "fill" these.** |
| **PARTIAL — BY DESIGN** | all 15 `blended_*` + `combined_pa`/`combined_seasons` (~1,061) | only players with multi-season history. Correct. |
| **PARTIAL — GATE ARTIFACT** | `k_pct`(4,374) `pull_air`(4,367) `pull_air_score`(4,366) | **5,341 − 4,374 = 967 ≈ the `thin(<25 PA)=963`** skipped by `MIN_PA`. These are written ONLY by this producer, so sub-gate players never get them, while `AVG/OBP/SLG` (written elsewhere) are full. ⬜ **DECIDE: is a 25-PA floor correct for `k_pct`/`pull_air`, or should they follow the same rule as the slash line?** |
| **FULL (38)** | identity, slash line, conference, division, the `desc_*` set | ✅ |
### `"Pitching Master"` — 97 columns / 5,375 rows
| bucket | columns | verdict |
|---|---|---|
| **EMPTY (4)** | `regular_season_ip` · **`bf`** · `dob` · `class_year` | `regular_season_ip` = **THE GAP**. ★ **`bf` (batters faced) is 0/5,375 yet `pitcher_line.csv` carries `full_BF` and the producer ALREADY selects `bf`** — a free fill that is simply unwired. |
| **WRONG WINDOW** | `IP` · `ERA` | `IP` holds the **REGULAR-SEASON** line (prod `IP` == staging `regular_season_ip` for **5,374/5,374 = 100.0%**). `ERA` is from the stale import. Both are in `PITCHER_UNMAPPED` yet BOTH exist as `full_IP` / `full_ERA`. |
| **PARTIAL — BY DESIGN** | `hard_hit_pct` `barrel_pct` `line_pct` `exit_vel` `ground_pct` `90th_vel` `la_10_30_pct` `stuff_plus`(5251) + scores | sample-gated. Correct. |
| **PARTIAL — BY DESIGN** | 20 `blended_*` + `combined_ip`/`combined_seasons` (~1,658) | multi-season only. Correct. |
| **PARTIAL — GATE ARTIFACT** | `k_pct`(4,772) | = the above-gate pitcher count (`MIN_BF=20`). Same open question as the hitter side. |
| **FULL (56)** | identity, rate stats, `desc_*`, `trackman_pitches` (C24), conference | ✅ |

## 🔧 THE BUILD — WHAT TO WRITE, AND FROM WHERE (every input already exists, all pitch-log-derived)
| Master column | source | file/table | window |
|---|---|---|---|
| `pa` `ab` | `PA` `AB` | `scripts/drs/output/hitter_accrued.csv` | **FULL** |
| `regular_season_pa` | `reg_PA` | same file | **REG (≤2026-05-18)** |
| `IP` | `full_IP` | `scripts/drs/output/pitcher_line.csv` *(or `pitch_log_pitcher_totals.ip`)* | **FULL** |
| `regular_season_ip` | `reg_IP` | `pitcher_line.csv` | **REG** |
| `ERA` | `full_ERA` | `pitcher_line.csv` (`reg_ERA` also present) | **FULL** |
| `bf` | `full_BF` | `pitcher_line.csv` | **FULL** |
| rates + batted-ball | already written | `pitch_log_{hitter,pitcher}_totals` | FULL |
| `G` `GS` | ⬜ **no pitch-log source found** | — | Master-override only |
| SB / CS | ⬜ partial | — | **Master-override BY DESIGN** |
**BOUNDARY (single source of truth):** `scripts/drs/drs_engine/season_config.py` →
`2026: regular_season_end "2026-05-18", postseason_start "2026-05-19"`. Its own policy, verbatim: *player stat store +
player TOTAL WAR + POWER RATINGS = **FULL** season · PROGRAM ANALYTICS (team_war_snapshots, YoY/championship) =
**REGULAR** season · PROJECTIONS target a **regular-season** line.* ⬜ **Mirror this into a DB `season_config` row so
TS and Python share ONE value** — the file itself flags this as unresolved.

## ⬇️ DOWNSTREAM — "how that stores into things like the team stats"
`refresh_team_season_stats(p_season, p_reg_end DEFAULT <season>-05-18)` already takes the boundary and already builds
`_reg` **and** `_total` variants. It reads Master `desc_*`/`_reg` (done ✅) **and divides by `regular_season_ip`**
(`:143` `nullif(sum(pm.regular_season_ip),0)`) — **currently 0/5,375, so every regular-season rate it computes lands
NULL, silently.** ⇒ **Filling `regular_season_ip` is a HARD PREREQUISITE for F44.** Per policy, team analytics use the
REGULAR-season window, which is exactly why this column matters.

## 🛑 GUARDRAILS FOR THE BUILD
1. **`--create-new` is BROKEN** — `:465` passes `"batting_team_id"` where `repRows`' `idCol` belongs, the query times
   out over 2,576,146 rows, and `:451` discards the `error`. **Fix before relying on any new-row path.**
2. **Never create Master rows implicitly** — keep creation behind `--create-new`, log every row by name + PA/IP.
3. **Adopt the `TeamID` a player's teammates already use** — resolving it independently by season splits the team
   (proved live: Arkansas 308→309 teams). Prefer the season-stable `source_team_id` for any rollup.
4. **Do NOT run `lock_regular_season` / D33b.** It is `regular_season_pa = pa` where NULL, has **no unlock**, and would
   freeze the pre-postseason number. **Write both columns from the engine output instead.**
5. **Gate on VALUE + MEMBERSHIP + CARDINALITY, never counts.** After the build: `pa` avg must move ~121.8 → ~128.0;
   `regular_season_pa` must equal the OLD `pa` per player; `regular_season_ip` 0 → 5,374.

---
# ✅ DECISION — DO **NOT** ADD REGULAR-SEASON STAT COLUMNS. Only `regular_season_pa` / `regular_season_ip`. (Trevor, 2026-08-30)
> *"We don't really need regular season stats — we kinda just need WARs from them, and I don't think it displays
> anything except including the postseason data… my main concern was more about what we actually need for the regular
> season, which was the metrics that go into WAR — which we have."*

## WHAT EXISTS, AND WHY THAT IS ENOUGH
| table | `_reg` columns | nature |
|---|---|---|
| `"Hitter Master"` (7 of 83) | **`regular_season_pa`** · `woba_reg` `wraa_reg` `desc_owar_reg` `d_war_reg` `bsr_war_reg` `total_desc_war_reg` | **1 stat anchor + 6 WAR OUTPUTS** |
| `"Pitching Master"` (6 of 97) | **`regular_season_ip`** · `desc_ra9_reg` `desc_fip_ra9_reg` `drs_behind_reg` `desc_pwar_reg` `total_desc_war_reg` | **1 stat anchor + 5 WAR OUTPUTS** |
There is **NO** regular-season `AVG/OBP/SLG/ISO`, no reg `H/2B/3B/HR/BB`, no reg `ERA/FIP/WHIP/K9/BB9/HR9`. **That is
CORRECT and intentional.** The regular-season WAR is already computed and stored; the reg *inputs* are consumed at
compute time from the engine output and do not need persisting.
⚠ The engine produces **28** `reg_*` values that have no Master column and are discarded each run —
`hitter_accrued.csv` (10): `reg_PA reg_AB reg_H reg_2B reg_3B reg_HR reg_BB reg_HBP reg_SF reg_SH`;
`pitcher_line.csv` (18): `reg_IP reg_BF reg_K reg_BB reg_HBP reg_H reg_HR reg_ER reg_ERA reg_R reg_RA9 reg_FIP
reg_WHIP reg_K9 reg_BB9 reg_HR9 reg_K_pct reg_BB_pct`. **Leave it that way unless a display need appears.**
Downstream already copes: `refresh_team_season_stats(p_season, p_reg_end)` **re-derives** regular-season team rates
straight from `pitch_log` by date; it only reads `desc_*_reg` + `regular_season_ip` from the Masters.

## 🛑 BUILD HAZARD — WRITE `regular_season_pa`/`_ip` IN THE **SAME OPERATION** THAT MAKES `pa`/`IP` FULL-SEASON
The three live consumers all use the same fallback:
```
useTeamBuilderData.ts:239   Number(r.regular_season_pa ?? r.pa ?? r.ab)     ← hitter depth-role tier volume
useTeamBuilderData.ts:254   Number(r.regular_season_ip ?? r.IP)             ← pitcher depth-role tier volume
usePitchingSeedData.ts:124  r.regular_season_ip ?? r.IP
refresh_team_season_stats.sql:143,145   ÷ sum(regular_season_ip)
```
Purpose, per `AdminDashboard.tsx:4072`: *"tier classification … stays anchored to regular-season volume. Postseason
games keep updating live pa/IP but tiers stay frozen — **playoff teams don't get inflated tier counts.**"*
**TODAY:** `regular_season_pa` is NULL ⇒ everything falls through to `?? pa` ⇒ and prod's `pa` *happens* to be the
regular-season line ⇒ **tiers are accidentally correct.**
**THE TRAP:** the instant `pa`/`IP` become FULL-season while `regular_season_*` is still NULL, that same fallback
starts using **postseason-inflated volume** ⇒ **deep-run playoff teams get their hitters/pitchers pushed up a depth
tier**, with **no error anywhere**. It is the exact failure the lock mechanism was built to prevent, re-introduced by
filling the wrong column first.
✅ **RULE: one operation, both columns, or neither.** Order within the build: write `regular_season_pa = reg_PA` and
`regular_season_ip = reg_IP` **BEFORE or ATOMICALLY WITH** `pa = PA` / `IP = full_IP`.
✅ **GATE:** after the build, `regular_season_pa` must equal the OLD `pa` per player (prod's current values), and `pa`
must have risen (avg **121.8 → ~128.0**). Spot-check a deep playoff team (LSU / Arkansas) and confirm its depth-role
tier counts did **not** change.
⛔ Still **DO NOT** run `lock_regular_season` / D33b — it snapshots `pa → regular_season_pa`, which is only valid while
`pa` is the regular-season line, and it has **no unlock**.

---
# ✅ THREE BUILD DECISIONS LOCKED (Trevor, 2026-08-30) — these define how `derive_masters_from_pitchlog.ts` is extended
## 1. THE ATOMICITY REQUIREMENT IS SATISFIED BY CONSTRUCTION — `lock_regular_season` BECOMES OBSOLETE
> *"which would just simply be the derive masters from pitch log correct?"* — **YES.**
Because this ONE producer writes `pa`/`ab`/`IP`/`ERA` **and** `regular_season_pa`/`regular_season_ip` in the **same
run, from the same source row** (`hitter_accrued.csv` gives `PA` + `reg_PA`; `pitcher_line.csv` gives `full_IP` +
`reg_IP`), the "one operation, both columns, or neither" rule is met **structurally** — there is no window in which
`pa` is full-season while `regular_season_pa` is still NULL, which is the state that would silently inflate
depth-role tiers for playoff teams.
⛔ **THEREFORE `lock_regular_season` / D33b IS NOT DEFERRED — IT IS OBSOLETE.** It is a pre-engine snapshot mechanism
(`regular_season_pa = pa` where NULL, **no unlock**) that only works while `pa` is the regular-season line. Once this
build lands it must never be run. **Retire it alongside `team_drs_store.sql`.**

## 2. `k_pct` / `pull_air` — FILL FOR EVERYONE, FOLLOWING THE SLASH LINE
> *"follow the slashline and fill it for everyone."*
**Today:** `k_pct` **4,374** / `pull_air` **4,367** of **5,341** hitters (pitcher `k_pct` 4,772 of 5,375) — the
shortfall is exactly the `thin(<25 PA)=963` skipped by `MIN_PA`, while `AVG/OBP/SLG/ISO` show **full** coverage only
because they were last written by the older CSV import.
🛑 **THE GATE MUST BE SPLIT IN TWO — it currently gates the WHOLE patch at `:274`:**
```ts
:274  if ((t.pa ?? 0) < MIN_PA) { hitterThin++; continue; }   // ← PATCH gate: REMOVE / set to 0
:469  if ((t.pa ?? 0) < MIN_PA) { skipped++; continue; }      // ← NEW-ROW gate: KEEP at 25 PA / 20 BF
```
**PATCHING an existing row: no floor** — every player with pitch-log data gets every derived field.
**CREATING a new row: keep the floor** — otherwise `--create-new` manufactures a Master row for every 1-PA appearance
(on prod that would be **763 candidates instead of 1**; the background orphans top out at 18 PA).
⚠ **Once this producer is the SOLE writer, leaving the patch gate at 25 would strand ~963 hitters + ~603 pitchers on
permanently stale CSV values.** Sample-gated batted-ball fields (`barrel`, `ev90`, `avg_exit_velo`, `la_10_30`, …)
keep their own `MIN_TRACKED_BIP` floor — that is a DATA-QUALITY floor, not a volume floor, and is correct.

## 3. `--create-new` STAYS IN THE PIPELINE — AND ITS BUG IS NOW REQUIRED WORK
> *"keep create new in pitch log track b… we are gonna NEED it in Track B because 2027 will have a bunch of new
> players when Track B runs for the first time in a regular season and will have to do it. It actually makes more
> sense to have it built in that process to ensure it's done properly."*
New-row creation is a **first-class Track B stage**, not a manual patch: at the start of each season virtually every
freshman/transfer appears in the pitch log before any Master sheet arrives, and Track B ingests pitch logs **daily**
vs master sheets **monthly** — so the pipeline MUST be able to create the row itself.
🔴 **THEREFORE THE `repRows` BUG IS BLOCKING, NOT OPTIONAL:** `:465` passes `"batting_team_id"` where `idCol` belongs
(`:486` correctly passes `"pitcher_id"`), so it queries `pitch_log WHERE batting_team_id = <a player id>` — matches
nothing, **exceeds the statement timeout** over 2,576,146 rows, and `:451` **discards the `error`** ⇒ every hitter
silently skipped ⇒ **no hitter Master row can EVER be created.** Left unfixed, Track B's first 2027 run creates **zero
hitters** and reports `0 new rows` with **exit 0**.
**FIX:** `:465` → `"batter_id"`, **and** `:451` → `const { data, error } = …` with failures counted + fatal.
**GATE:** after the fix, a prod dry-run must report **exactly 1** new hitter (Kozeal was already inserted manually, so
re-verify against the current membership query) and the MEMBERSHIP query must come back EMPTY.

---
# 🅱️🏛️ TRACK B — THE COMPLETE ARCHITECTURE (CANONICAL, 2026-08-30). Build from THIS. Zero ambiguity intended.
Settled with Trevor across this session. **Every statement below is a DECISION, not a proposal.** Where something is
genuinely undecided it is marked ⬜ OPEN. Where something is verified on prod it says VERIFIED.

## 1. THE TWO CADENCES — everything else follows from this
| source | cadence | role |
|---|---|---|
| **Pitch log** | **DAILY, all spring** | **PRIMARY SOURCE OF TRUTH.** The majority of every statistic is DERIVED from it. |
| **TruMedia Master sheet** | **~MONTHLY** | **SECOND SOURCE / CHECK.** Overrides the derived value ONLY where the pitch log is known-weak — **stolen bases, ERA, G/GS**. Never a daily dependency. |
⇒ **NO STAGE MAY DEPEND ON A FILE THAT ONLY ARRIVES MONTHLY.** Any stage reading `docs/drs-reference/*.csv` or
`scripts/drs/output/*.csv` is structurally unrunnable inside Track B.

## 2. THE THREE LAYERS — each value lives in EXACTLY ONE place
```
   ┌── LAYER 1 ── pitch_log ─────────────────────────────────────────────────────┐
   │  raw per-pitch. Never aggregated in place. Immutable history.               │
   └────────────────────────────────┬────────────────────────────────────────────┘
                                    │  REBUILT ON **EVERY** PITCH-LOG IMPORT
   ┌── LAYER 2 ── pitch_log_*_totals ── THE ACCUMULATOR ─────────────────────────┐
   │  ALL RAW COUNTS live here and ONLY here, per (player, season, dimension_key)│
   │  hitter: pa ab hits_single/double/triple/hr k bb hbp sac batted_* ev_* …    │
   │  pitcher: total_bf total_pa total_k total_bb total_hbp hits_*_allowed ip …  │
   │  + defensive/baserunning run values (batting_rv, defensive_rv, baserunning_rv)│
   └────────────────────────────────┬────────────────────────────────────────────┘
                                    │  DERIVE (rates, ratings, WAR)
   ┌── LAYER 3 ── "Hitter Master" / "Pitching Master" ── DERIVED + DISPLAY ──────┐
   │  rates (AVG/OBP/SLG/ISO, K9/BB9/HR9/WHIP/FIP), power ratings, stuff_plus,   │
   │  desc_* and desc_*_reg WAR, plus pa/ab/IP + regular_season_pa/_ip as the    │
   │  DISPLAY + DEPTH-ROLE-TIER anchors.                                         │
   │  ⛔ NO raw component counts here (no H/2B/3B/HR/BB/HBP columns) — they live  │
   │     in Layer 2. Storing them twice is exactly what we are eliminating.      │
   └─────────────────────────────────────────────────────────────────────────────┘
```
**★ WAR READS LAYER 2 AND WRITES LAYER 3.** That is the resolution of "WAR must read the Masters": the *counts* come
from the accumulator, the *results* land on the Master, and every consumer downstream reads the Master.
**★ `pitch_log_*_totals` IS NOT AN END-OF-SEASON ARTIFACT.** It was built that way only because the season was already
over. **It must rebuild on every import** — it is the mechanism by which pitch-log data reaches the Masters.

## 3. THE REGULAR/POSTSEASON SPLIT — LOCK ONCE AT THE TRANSITION, THEN KEEP ACCUMULATING
> Trevor: *"we also probably just need to recognize the one time in the year when it transitions to the postseason and
> lock in the regular season values, then just keep adding what becomes postseason values."*
```
during the regular season   →  totals accumulate normally
AT THE TRANSITION (one time)→  SNAPSHOT the regular-season line   (dimension_key='reg', or the *_reg columns)
after the transition        →  'all' KEEPS GROWING (full season);  'reg' NEVER CHANGES AGAIN
```
This is the *correct* form of what `lock_regular_season` was groping at — but driven by the accumulator, not by copying
`pa` into `regular_season_pa`. **⛔ `lock_regular_season` / D33b IS OBSOLETE. Retire it.**
**Boundary:** `2026-05-18` (regular_season_end) / `2026-05-19` (postseason_start).
🛑 **IT IS CURRENTLY TYPED IN TWO PLACES** — `scripts/drs/drs_engine/season_config.py` and
`refresh_team_season_stats`'s `p_reg_end` default. **THERE MUST BE ONE SOURCE.** Two copies can drift and nothing
errors. ⬜ **FUTURE (Trevor's plan):** load **per-team SCHEDULES** for upcoming seasons so the system knows when each
team's regular season ends — which removes the constant entirely and handles teams whose seasons end on different
dates. Not urgent; wire the single source first.
**Policy (from `season_config.py`, unchanged):** player stats + power ratings = **FULL** season · program analytics
(`team_war_snapshots`, YoY/championship) = **REGULAR** season · projections TARGET a regular-season line.

## 4. 🔴 WHAT MUST BE BUILT — THE GAP INVENTORY (exact columns, VERIFIED on prod 2026-08-30)
### 4a. `pitch_log_pitcher_totals` (51 cols) IS MISSING THE RUN-PREVENTION INPUTS
HAS: `total_bf total_pa total_k total_bb total_hbp hits_{single,double,triple,hr}_allowed total_ab ip batted_* ev_* stuff_plus_sum`
**MISSING — and `desc_ra9` / `desc_pwar` cannot be computed without them:**
| missing | why it matters | note |
|---|---|---|
| **`R`** (total runs allowed) | `desc_ra9 = 0.5·(RA9 + drs_behind_per9) + 0.5·(FIP·E2T)` | ⚠ **NOT a naive count** — the engine accrues it with **inherited-runner attribution, earned + unearned** (`pitcher_line.csv` `full_R`). **That accrual logic must move INTO the totals build.** |
| **`ER`** (earned runs) | `ERA` | same accrual |
| **`G` / `GS`** | roster/role context | ⬜ Trevor: *"almost positive the pitch log import has a starting pitcher id"* — derivable, **not worth chasing now. Track B flag.** |
### 4b. DEFENSE + BASERUNNING SHOULD FOLD INTO THE SAME ACCUMULATOR
> Trevor: *"same could be said for storing baserunning and defensive values in that same run that might be a separate
> table now — those should all go into the pitch_log_*_totals then that should be derived into the masters from every
> pitch log imported."*
Today they are **separate tables** rebuilt by an offline Python engine:
`player_season_defense` (32 cols — `drs_floor/total/ceiling`, `range_*`, `arm_runs`, `framing_runs`, …) and
`player_season_baserunning` (15 cols — `sb cs sbh wsb_runs` **+ `wsb_runs_reg`** ← *a reg variant already exists here*).
★ **PRECEDENT ALREADY IN PLACE:** `pitch_log_hitter_totals` already carries **`batting_rv`, `defensive_rv`,
`baserunning_rv`** (+ `_z`), written by `populate_hitter_run_values(season)`. So the bridge exists — it just runs as a
separate step instead of as part of the accumulator.
⬜ **OPEN — Trevor's direction is clear (fold them in); the sequencing is not decided.** dRS is a heavy engine with its
own constants; whether it becomes a stage of the daily run or stays a periodic rebuild feeding the accumulator needs a
call. **Do not assume either.**
### 4c. `derive_masters_from_pitchlog.ts` — the extension already scoped
Write to EXISTING rows: `pa`/`ab` (FULL), `IP` (FULL), `ERA`, `bf`, **and** `regular_season_pa`/`regular_season_ip`
**in the same operation** (see the depth-role tier hazard). Split the gate: **no floor for PATCHING** (`:274`),
**keep 25 PA / 20 BF for CREATING** (`:469`). Fix `repRows` `:465` → `"batter_id"` and stop discarding `error` at `:451`.

## 5. ✅ WHAT IS ALREADY CORRECT — DO NOT RE-TEST, DO NOT "FIX"
- **Rates + batted-ball/discipline on both Masters** — already pitch-log-derived and written; the prod dry-run reports
  **0 changes** on 4,373 hitters / 4,772 pitchers. Correct.
- **`desc_*` and `desc_*_reg` WAR on prod** — D31/D32 committed, D34 passed all 9 gates. Values verified against
  staging (`desc_owar` 0.3458 vs 0.3456, sum identity 0.001). **Correct, even though SOURCED from CSVs** — that is a
  Track B wiring problem, not a data problem. **Do not recompute.**
- **`team_drs`** — derived on prod, 308 teams, sum 0.00. **Correct.**
- **Park factors + `run_env_factor`** — prod↔staging **308/308 IDENTICAL**, `run_env_factor` identical at 99.719.
- **Sample-gated columns** (`barrel`, `ev90`, `avg_exit_velo`, `la_10_30`, the `*_score` set, power ratings) — null
  below `MIN_TRACKED_BIP` **by design**. ⛔ **NOT a gap. Do not fill.**
- **`blended_*` + `combined_*`** (~1,061 hitters / 1,658 pitchers) — multi-season players only, **by design**.

## 6. ⚖️ ROADBLOCKS vs NOT-WORTH-FIXING
| item | verdict |
|---|---|
| WAR reads CSVs, not the DB | 🔴 **ROADBLOCK for Track B** — but NOT for the current prod push. Re-point during the Track B build, not now. |
| `pitch_log_pitcher_totals` missing `R`/`ER` (+ the inherited-runner accrual) | 🔴 **ROADBLOCK** — no pitcher WAR without it. |
| `repRows` `:465` bug (no hitter row can ever be created) | 🔴 **ROADBLOCK** — 2027's first run is mostly new players. |
| `regular_season_pa`/`_ip` unfilled | 🔴 **ROADBLOCK for F44** (`nullif(sum(regular_season_ip),0)` → NULL rates) **and a live hazard** the moment `pa` goes full-season. |
| `pa`/`IP` holding the regular-season line | 🟡 **Fix in the build.** Harmless today *because* `regular_season_*` is NULL and the fallback lands on the right value. |
| Boundary date typed in 2 places | 🟡 **Wire to one source — not urgent.** Superseded later by per-team schedules. |
| `G`/`GS` with no pitch-log source | 🟢 **NOT worth chasing now.** Master-override; Track B flag. |
| SB / CS | 🟢 **Master-override BY DESIGN.** Not a gap. |
| `dob` / `class_year` empty | 🟢 **Not stats.** Roster-scraper concern, out of scope. |
| `trackman_pitches` on `"Hitter Master"` | 🟢 **Vestigial** (a pitcher concept). Confirm, then ignore or drop. |
| `k_pct` / `pull_air` short by ~963 | 🟡 **Fix via the patch-gate removal** — fill for everyone, following the slash line. |
| Reg-season STAT columns beyond `pa`/`IP` | 🟢 **DECIDED: do not add.** Counts live in Layer 2; the Master stores derived results only. |
| Recomputing prod WAR | 🟢 **NOT needed.** Values verified correct. |

## 7. 🧭 THE FOUR GATE TYPES THAT ACTUALLY CATCH THINGS (a count gate catches none of them)
1. **VALUE** — did the number CHANGE? (Conference `Stuff_plus` 101.17→99.15 · `run_env_factor` 101.879→99.719, both **30/30 before AND after**)
2. **MEMBERSHIP** — diff the ID SET. (caught Kozeal: 5,340 = 5,340 passed every count)
3. **CARDINALITY** — assert the GROUP count (D1 = 308 teams). (caught the `TeamID` split; the Σ-centering assertion held at 309)
4. **LOG-CONTENT** — read the body, never the exit code. (`0 FAILED` must be printed, not inferred; `--create-new` exits 0 while creating nothing)

---
# 📍 WHERE WE ARE — END OF 2026-08-30. Current state, and what is left.
## ✅ DONE ON PROD (verified in the DB, not from logs)
| phase | state |
|---|---|
| **A / B** schema + config | ✅ `model_config` 220 keys · Phase-B tuned values SURVIVED C27's upsert (`nil_tier_sec` 4.0, `r_obp_std_pr` 31.89504) |
| **C** Stuff+ chain 1–5 | ✅ 2,013,005 pitches · per-pitcher gate **mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 — IDENTICAL to staging** |
| **C24 / C27 / C26 / C29 / C28 (4 steps) / C28b** | ✅ all applied; Conference `Stuff_plus` **101.17 → 99.15** (the lane fix) |
| **D29b** `team_drs` | ✅ **DERIVED on prod** (not pasted) — 308 teams, sum 0.00, Arkansas 41.272 |
| **D30** dRS/wSB load | ✅ confirmed NO-OP (13,454 / 10,432 already present) |
| **D31 / D32** descriptive WAR + `_reg` | ✅ committed, `0 FAILED`; **D34 passed all 9 gates** |
| **E2** park factors + ★`derive_conf_opr_htp` re-run | ✅ `rg_factor_seasonal` 0/309 → full; `run_env_factor` **101.879 → 99.719** |
| *(unplanned)* Camden Kozeal | ✅ Master row created — D1 hitters 5,340 → **5,341** |
**Prod↔staging where compared:** park factors **308/308 identical** · `run_env_factor` identical · Kozeal's WAR
identical to 3dp. Remaining diffs (`hitter_talent_plus` 99.23 vs 99.01) are **staging being BEHIND** — prod is current.

## ⛔ NOT DONE, AND DELIBERATELY SO
- **`D33b` / `lock_regular_season`** — **OBSOLETE, do not run.** Superseded by the accumulator lock (§3 of the
  architecture). It has **no unlock** and would freeze the pre-postseason number.
- **`pa`/`IP` still hold the REGULAR-SEASON line** — harmless *today* precisely because `regular_season_*` is NULL and
  the depth-role fallback lands on the right value. **Fixed in the derive_masters build, both columns together.**
- **WAR still sourced from CSVs** — correct numbers, wrong wiring. **Re-point during the Track B build, not now.**

## ▶️ REMAINING PROD PUSH (dependency order, NOT topic order)
`F44 refresh_team_season_stats` ← **BLOCKED on `regular_season_ip`** (it divides by it → NULL rates) →
`E35` TWP detector (guard added ✅) → `E36/E37/E38` precomputes → `F39` `refresh_composite_war` → `F40–F43` →
`G46` edge-fn deploy → PR staging→main → `H` drops → **THEN staging catch-up, run THROUGH Track B.**
★ **F44 MOVED UP, before Phase E** — `precompute-transfer-projections.ts:225` / `precompute-pitchers.ts:279` READ
`team_season_stats.faced_*` and coerce a miss to `[]`. See the ORDER AUDIT.

## 🔨 THE BUILD QUEUE (in order, all scoped, none started)
1. **`derive_masters_from_pitchlog.ts` extension** — counting stats + reg/post split + gate split + `repRows` fix.
2. **`pitch_log_pitcher_totals` gains `R`/`ER`** — including the inherited-runner accrual currently only in the engine.
3. **`dimension_key='reg'`** on the totals build → kills the last hitter-side CSV dependency.
4. **Fold defense/baserunning into the accumulator** ⬜ sequencing OPEN.
5. **Re-point WAR at the DB** (Layer 2 → Layer 3).
6. **One boundary-date source** → later, per-team schedules.

## 🧠 THE SIX DEFECTS THIS PUSH FOUND — every one PASSED a naive check
1. Conference `Stuff_plus` **stale at 30/30** (a 4th producer the runbook omitted)
2. `trackman_pitches` **fully populated from the WRONG LANE** (638/5,367 = 11.9% agreement)
3. `run_env_factor` **stale under E2 at 30/30** (park rewrite invalidates it)
4. **Kozeal missing** — invisible to `5,340 = 5,340`
5. **`--create-new` structurally broken** — exits 0, prints `0 new rows`, can never create a hitter
6. **`TeamID` team split** — both buckets internally consistent, Σ-centering held **at 309 teams**
