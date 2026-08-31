# 📋 STEP-BY-STEP PLAN — FINISH THE PROD PUSH (from 2026-08-30 state)
Pick up here. Every step has a **GATE** that must pass before the next. **Gates are VALUES, never counts or exit codes.**
Scope: finishing the push. Track B build work is separate (`docs/PIPELINE_pitch_log_to_projections.md`).

**WHERE WE ARE:** Phases A/B/C ✅ · Phase D ✅ (D34 all 9 gates) · E2 + `derive_conf_opr_htp` re-run ✅.
**WHAT'S LEFT:** fill the Master counting columns from the pitch log, then F44 → E35 → precomputes → F39–F43 → G46.

---
## ⚠️ THE ONE ORDERING RULE THAT MATTERS
**The Master column fill (STEP 2) MUST precede the precomputes (STEP 7).** `precompute-returner-*` and
`precompute-transfer-*` READ `"Hitter Master".pa` / `"Pitching Master".IP` and the depth-role anchors. Filling after
them leaves every projection built on the old regular-season-only values. **Fill → F44 → E35 → precomputes.**

---
## STEP 0 — F40 env guard *(code only, no DB)*
`scripts/backfill-snapshot-total-hitter-war.ts:22` uses `process.env.SUPABASE_URL` with **no `--prod` flag anywhere**
(`grep -c` = 0/0) ⇒ `--env-file=.env.production.local` writes PROD with zero opt-in. **6th instance of this defect.**
Add the standard double-keyed guard (URL and `--prod` must AGREE).
**GATE:** both refuse paths print — `✗ URL is PROD but --prod was not passed` and `✗ --prod passed but URL is not prod`.

## STEP 1 — extend `derive_masters_from_pitchlog.ts` *(code only, no DB)*
**1a. Write the counting columns to EXISTING rows**, all in ONE upsert per player:
| column | ← source | window |
|---|---|---|
| `pa`, `ab` | `hitter_accrued.csv` `PA`, `AB` | **FULL** |
| `regular_season_pa` | `hitter_accrued.csv` `reg_PA` | **REG (≤2026-05-18)** |
| `IP` | `pitcher_line.csv` `full_IP` | **FULL** |
| `regular_season_ip` | `pitcher_line.csv` `reg_IP` | **REG** |
| `ERA` | `pitcher_line.csv` `full_ERA` | **FULL** |
| `bf` | `pitcher_line.csv` `full_BF` | **FULL** |
🛑 **BOTH WINDOWS IN THE SAME WRITE.** Depth-role tiering reads `regular_season_pa ?? pa`; a full-season `pa` with a
NULL `regular_season_pa` silently feeds postseason-inflated volume into tier classification.
**1b. Split the gate** — `:274` PATCH gate **removed** (fill `k_pct`/`pull_air` for everyone, per the slash line);
`:469` NEW-ROW gate **stays at 25 PA / 20 BF**.
**1c. Fix `repRows`** — `:465` `"batting_team_id"` → **`"batter_id"`**; `:451` `const { data, error }` with failures
counted and fatal. *(Not needed for this push, but it is adjacent code and Track B requires it.)*
**1d. Remove `ERA`/`IP`/`bf` from `PITCHER_UNMAPPED`** (leave `G`, `GS`, `Role`).
**GATE:** `tsc -p tsconfig.app.json --noEmit 2>&1 | grep derive_masters` shows no NEW errors.

## STEP 2 — VALIDATE ON STAGING FIRST *(dry-run, no writes)* ★ the highest-value step
Staging's `pa` / `regular_season_pa` / `IP` / `regular_season_ip` are **already correct** (median Δ 0.00 vs the engine).
So the extended script must reproduce values staging **already has** — independent replication, the same technique
that validated `derive_team_drs` (308/308 exact) and Kozeal's WAR (3dp).
```
npx tsx --env-file=.env.local scripts/derive_masters_from_pitchlog.ts --dry-run
```
**GATE:** for the four counting columns it reports **≈0 changes** on staging. If it wants to change thousands, the
mapping is wrong — **STOP and diagnose. Do not proceed to prod.**

## STEP 3 — PROD DRY RUN
```
npx tsx --env-file=.env.production.local scripts/derive_masters_from_pitchlog.ts --dry-run --prod
```
**EXPECT:** ~5,341 hitters and ~5,375 pitchers change (`pa`/`IP` move regular→full) · `regular_season_pa` /
`regular_season_ip` fill from 0 · `k_pct`/`pull_air` pick up the ~963/~603 previously below the gate ·
**0 new rows** (Kozeal already inserted).
**GATE:** the sample diff shows `pa` RISING and `regular_season_pa` ≈ today's `pa`. If the `regular_season_pa` delta is large,
the windows are swapped — STOP.

## STEP 4 — BACK UP, THEN APPLY *(first prod write of this plan)*
```sql
create table _hm_prefill_backup as select * from "Hitter Master"   where "Season"=2026;
create table _pm_prefill_backup as select * from "Pitching Master" where "Season"=2026;
```
Verify counts (5,341 / 5,375), then apply. Needs an explicit **"prod, now?"**.
**GATE — VALUES, verified in the DB:**
- `pa` avg **121.8 → ~128.0** · `IP` avg rises
- `regular_season_pa` **0 → ~5,322** · `regular_season_ip` **0 → ~5,372**
- `regular_season_pa` vs today's `pa`: **median Δ 0.00**
- `k_pct` **4,374 → ~5,341** · `pull_air` **4,367 → ~5,341**
- ★ **pick a deep playoff team (LSU / Arkansas): its depth-role tier counts must NOT move.**
- ★ **`desc_owar` / `total_desc_war` UNCHANGED** — D31 wrote them from the full-season CSV; this step must not disturb them.

## STEP 5 — F44 `refresh_team_season_stats(2026)`
Now that `regular_season_ip` is filled, `ra9_r` / `fra9_r` compute instead of landing NULL.
```sql
select refresh_team_season_stats(2026);
```
🛑 Fire from the **direct pg session or SQL editor** — not PostgREST (~125s gateway cut ⇒ silent rollback).
**GATE:** `team_season_stats` 0 → **308 rows** · `faced_stuff_plus` / `faced_htp` populated · `ra9_r` / `fra9_r`
**NOT NULL** · WAR matrix non-null · AVG ≈ .277 · wRC+ ≈ 100.

## STEP 6 — E35 TWP detector
```
npx tsx --env-file=.env.production.local scripts/run-twp-recompute.ts --prod          # dry-run
npx tsx --env-file=.env.production.local scripts/run-twp-recompute.ts --prod --apply
```
Guard added + both refuse paths verified ✅. Prod `is_twp` = **137 / 31,467** (staging 253) ⇒ expect a large change.
**MUST precede the precomputes** so both-side TWP rows generate.
**GATE:** `is_twp` count rises and is sane vs staging's 253; `position` changes reviewed in the report.

## STEP 7 — PRECOMPUTES (read the Masters — hence STEP 2/4 first)
```
npm run precompute-returner-pitchers:prod      # dry-run first
npm run precompute-returner-hitters:prod
zsh scripts/_run_step2_all.sh --prod
```
🛑 **`_run_step2_all.sh:36,:38` pipe each team through `grep | head -3`, DISCARDING the exit code.** "STEP 2 ALL DONE
(14 teams)" is **NOT** proof. **Re-run the dry-run afterwards and require 0 pending changes for every one of the 14.**
`customer_teams` active = **14** (NOT 18 — that is a staging number). Gate on the live list, never a hardcoded count.
**GATE:** `player_predictions` season **2027** repopulated for all 14 teams; 0 pending on the re-dry-run.

## STEP 8 — F39 `refresh_composite_war()`
```sql
select refresh_composite_war();   -- ÷13.1, already correct on prod
```
🛑 **direct pg session / SQL editor ONLY** — over PostgREST the gateway cuts at ~125s and the whole UPDATE **ROLLS
BACK**, often with no error you would recognise.
**GATE:** `player_predictions` `d_war`/`bsr_war`/`total_hitter_war` refreshed. (It writes `player_predictions`, **NOT**
the Masters — the runbook's F39 description is wrong.)

## STEP 9 — F40 → F43 markets & snapshots
```
F40  scripts/backfill-snapshot-total-hitter-war.ts --apply           (guard added in STEP 0)
F41  rebuild-twp-target-rows · rebake-twp-markets · fix-returner-twp-hitter-market   (--apply; invoke DIRECTLY, not npm)
F42  resync-build-snapshot-markets --all --apply · resync-target-snapshots --all --apply   ★ --all is REQUIRED
     (default scope is a STAGING build id = 0 rows on prod)
F42b recompute-snapshot-hitter-market --prod --apply
F43  backfill-neutral-snapshot --prod --apply → heal-stale-snapshots --prod --apply --yes
```
**GATE:** 0 snapshots with `o_war` but NULL `total_hitter_war`; no market > $130k/win; 0 negative markets; re-dry-run 0.

## STEP 10 — G46 edge-fn deploy *(Trevor)*
```
supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm
```
⛔ **never `--linked`** (`supabase/config.toml` names a THIRD ref `kfkuhdmpchxyffmnowgj`).
⛔ **do NOT deploy `recalculate-prediction`** — dead/superseded.
**GATE (now satisfiable):** conf env+ ✅ · `ba/obp/iso_plus` ✅ · model_config transfer weights ✅ · **`team_season_stats`
POPULATED (STEP 5)** ✅.

## STEP 11 — preview-verify → PR → merge → Phase H
Vercel preview points at **PROD** Supabase. Then `gh pr create` staging→main; **Trevor clicks merge**.
Phase H drops stay gated (H48 blocked — `bulkRecalculatePredictionsLocal` still imported at `runDataCascade.ts:18,:61`).

## STEP 12 — staging catch-up **THROUGH TRACK B**
Staging never received C24/C26/C27/C28/C28b/C29. Trevor's decision: catch it up **after** the push, **via Track B** —
its first real exercise. Do NOT hand-run the six scripts.

---
## 🚦 BLOCKER SUMMARY
| # | blocker | status |
|---|---|---|
| F40 has no env guard | 🔴 STEP 0 | one-file fix |
| Master counting columns unfilled / wrong window | 🔴 STEPS 1–4 | **the main work** |
| F44 `_reg` rates NULL | 🟡 resolved by STEP 4 | run F44 after the fill |
| WAR sourced from CSVs | 🟢 **not a push blocker** | values verified correct; re-point in Track B |
| `repRows` `:465` | 🟢 not a push blocker | fixed opportunistically in STEP 1c |
| `G`/`GS`, SB, `dob`/`class_year`, hitter `trackman_pitches` | 🟢 out of scope | by design / vestigial |
