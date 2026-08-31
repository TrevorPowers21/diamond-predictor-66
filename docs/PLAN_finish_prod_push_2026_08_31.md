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
## ✅ STEP 0 — F40 env guard — **DONE 2026-08-31** (all 4 paths verified) *(code only, no DB)*
`scripts/backfill-snapshot-total-hitter-war.ts:22` uses `process.env.SUPABASE_URL` with **no `--prod` flag anywhere**
(`grep -c` = 0/0) ⇒ `--env-file=.env.production.local` writes PROD with zero opt-in. **6th instance of this defect.**
Add the standard double-keyed guard (URL and `--prod` must AGREE).
**GATE:** both refuse paths print — `✗ URL is PROD but --prod was not passed` and `✗ --prod passed but URL is not prod`.

## ✅ STEP 0b — BACKFILL `pitch_log.game_string` — **DONE 2026-08-31** (0 → 2,576,146 · 8,519 games · 55.3 g/team) (NEW — discovered 2026-08-31, PROD WRITE)
**`game_string` is 0 / 2,576,146 on PROD.** It is an INGEST-time identifier, not derived. While NULL it silently
breaks (a) per-pitcher IP — the half-inning key is `(game_string, inn)` — and (b) `refresh_team_season_stats` step 5's
W/L records, which key on it. **Neither raises an error.**
```
npx tsx scripts/backfill_pitch_log_game_string.ts --prod            # dry-run
npx tsx scripts/backfill_pitch_log_game_string.ts --prod --apply
```
**GATE:** `game_string` 0 → **2,576,146** · `count(distinct game_string)` ≈ the season's game count · spot-check that
the embedded date matches the row's `date`.

## ✅ STEP 0c — FILL `pitch_log_pitcher_totals.ip` — **DONE 2026-08-31** (0 → 5,415 · ip_reg added · Σ IP 147,630.3 = staging) + `ip_reg` (NEW, PROD WRITE)
**`ip` is 0 / 5,509 on PROD**, which is why `K9/BB9/HR9/WHIP/FIP` on the Pitching Master are **stale CSV values**
rather than pitch-log-derived (`pitcherIpDependent` returns `{}` on a null ip). Requires STEP 0b.
```
npx tsx --env-file=.env.production.local scripts/fill_pitcher_totals_ip.ts --prod            # dry-run
npx tsx --env-file=.env.production.local scripts/fill_pitcher_totals_ip.ts --prod --apply
```
**GATE:** derives ~5,400 pitchers (0 before STEP 0b) · `ip` 0 → ~5,400 · `ip_reg` populated · postseason share ≈ **5%**
· mean |Δ| vs `"Pitching Master".IP` ≈ **0.48** (the script self-aborts above 1.0).

## ✅ STEP 1 — extend + APPLY `derive_masters_from_pitchlog.ts` — **DONE 2026-08-31** (3,742 H / 5,374 P · all gates pass) *(code only, no DB)*
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

## ✅ STEP 2 — staging validation — **DONE** (changes explained: ~966 un-gated thin hitters + the IP write) *(dry-run, no writes)* ★ the highest-value step
Staging's `pa` / `regular_season_pa` / `IP` / `regular_season_ip` are **already correct** (median Δ 0.00 vs the engine).
So the extended script must reproduce values staging **already has** — independent replication, the same technique
that validated `derive_team_drs` (308/308 exact) and Kozeal's WAR (3dp).
```
npx tsx --env-file=.env.local scripts/derive_masters_from_pitchlog.ts --dry-run
```
**GATE:** for the four counting columns it reports **≈0 changes** on staging. If it wants to change thousands, the
mapping is wrong — **STOP and diagnose. Do not proceed to prod.**

## ✅ STEP 3 — prod dry-run — **DONE** (values verified: pa/IP rise, ERA rises with postseason, reg == old pa)
```
npx tsx --env-file=.env.production.local scripts/derive_masters_from_pitchlog.ts --dry-run --prod
```
**EXPECT:** ~5,341 hitters and ~5,375 pitchers change (`pa`/`IP` move regular→full) · `regular_season_pa` /
`regular_season_ip` fill from 0 · `k_pct`/`pull_air` pick up the ~963/~603 previously below the gate ·
**0 new rows** (Kozeal already inserted).
**GATE:** the sample diff shows `pa` RISING and `regular_season_pa` ≈ today's `pa`. If the `regular_season_pa` delta is large,
the windows are swapped — STOP.

## ✅ STEP 4 — backup + apply — **DONE** (`_hm_prefill_backup` 8,245 · `_pm_prefill_backup` 8,071) *(first prod write of this plan)*
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

## ✅ STEP 5 — F44 `refresh_team_season_stats(2026)` — **DONE 2026-08-31** (59.7s · 308 rows · all gates pass · required deleting the phantom Wiggins row first)
Now that `regular_season_ip` is filled, `ra9_r` / `fra9_r` compute instead of landing NULL.
```sql
select refresh_team_season_stats(2026);
```
🛑 Fire from the **direct pg session or SQL editor** — not PostgREST (~125s gateway cut ⇒ silent rollback).
**GATE:** `team_season_stats` 0 → **308 rows** · `faced_stuff_plus` / `faced_htp` populated · `ra9_r` / `fra9_r`
**NOT NULL** · WAR matrix non-null · AVG ≈ .277 · wRC+ ≈ 100.

## ✅ STEP 6 — E35 TWP detector — **DONE 2026-08-31** (is_twp 137→253 = staging exactly · legacy TWP 428→34 = staging exactly · 606 rows)
```
npx tsx --env-file=.env.production.local scripts/run-twp-recompute.ts --prod          # dry-run
npx tsx --env-file=.env.production.local scripts/run-twp-recompute.ts --prod --apply
```
Guard added + both refuse paths verified ✅. Prod `is_twp` = **137 / 31,467** (staging 253) ⇒ expect a large change.
**MUST precede the precomputes** so both-side TWP rows generate.
**GATE:** `is_twp` count rises and is sane vs staging's 253; `position` changes reviewed in the report.

## ▶️ STEP 7 — PRECOMPUTES — **NEXT** (read the Masters — hence STEP 2/4 first)
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

---
# ✅ STEP 0 DONE — F40 ENV GUARD ADDED (2026-08-30)
`scripts/backfill-snapshot-total-hitter-war.ts` had **no guard of any kind** — it read `process.env.SUPABASE_URL` with
**no `--prod` flag anywhere** (`grep -c` = 0/0), so `--env-file=.env.production.local` wrote PROD with **zero opt-in**;
the only signal was a `host` banner printed AFTER the client was constructed. It writes `team_build_players` +
`target_board` snapshots — **coach-visible build/board data.** **SIXTH instance** of this defect class (after
`_run_store_no_propagate` C26, both C28 producers, the market scripts, `run-twp-recompute` E35, and
`backfill_park_factors_seasonal` E2).
**FIX:** standard double-keyed guard (URL and `--prod` must AGREE) + a resolved-env banner printed BEFORE any work,
+ an explicit missing-credentials check.
**ALL FOUR PATHS VERIFIED:**
```
REFUSE  PROD url, no --prod   → ✗ URL is PROD but --prod was not passed — refusing.
REFUSE  STAGING url, --prod   → ✗ --prod passed but URL is not prod — refusing.
ALLOW   STAGING, no flag      → [env] STAGING/other (slrxowawbijbjrkozqlj)  mode=DRY-RUN
ALLOW   PROD + --prod         → [env] 🔴 PROD (trbvxuoliwrfowibatkm)  mode=DRY-RUN
```
**PROD DRY-RUN (read-only) — F40's actual workload when it runs at STEP 9:**
`d/bsr map: 520 players (of 522 snapshot players)` · **`snapshots to fill: 696`**
⛔ **NOT APPLIED** — F40 runs at STEP 9 of the plan, after the precomputes. This step only added the guard.

---
# 🔴🔴 PROD GAP — `pitch_log.game_string` WAS **0 / 2,576,146**, AND WHAT IT SILENTLY BROKE (2026-08-31)
## THE FINDING
| | PROD | STAGING |
|---|---|---|
| `pitch_log` 2026 rows | 2,576,146 | 2,579,655 |
| **`game_string` populated** | ✅ **2,576,146 (backfilled 2026-08-31)** — was 0 | **2,576,146** |
| `inn` · `outs` · `date` · `pitcher_id` | 2,576,146 each ✅ | ✅ |
**Every other column is fine.** Only `game_string` is empty — and it is **NOT a derived value**. It is an identifier
that arrives WITH the export and is written at INGEST: `scripts/ingest_pitch_log.ts:325`
`game_string: textOrNull(get(row, cols, "gameString"))`. **Prod was loaded from a run that lost that column.**

## 🛑 WHAT IT BREAKS (both silent — neither raises an error)
1. **PER-PITCHER IP (outs ÷ 3) CANNOT BE DERIVED.** The half-inning key is `(game_string, inn)`.
   `scripts/fill_pitcher_totals_ip.ts --prod` derived **0 pitchers** on prod vs **5,415** on staging. It returns an
   empty set, not an error.
2. **`refresh_team_season_stats` STEP 5 (team W/L RECORDS) HAS NOTHING TO KEY ON.** That step states verbatim:
   *"game key = game_string = EXACT game id, doubleheader-safe"*. On prod every key is NULL ⇒ records are wrong/empty
   ⇒ **F44 would have produced a broken records block and reported success.**
★ **THE PHASE-C GATES ALL PASSED WHILE THIS WAS 100% NULL** — the Stuff+ chain, the 48/48 aggregations, C24–C29 and
Phase D never touch `game_string`. It only surfaced when something finally needed it as a KEY. **Another instance of
"a gap stays invisible until a specific consumer needs that exact column."**

## ✅ THE FIX — `scripts/backfill_pitch_log_game_string.ts` (NEW)
Reads the **source export**, not staging: `docs/drs-reference/*DRS Pitch Log*.csv` — **34 files**, `uniqPitchId` (col 7)
→ `gameString` (col 4). ⛔ deliberately NOT copied from staging even though `uniq_pitch_id` matches across
environments — this re-derives from the same source staging was loaded from ([[feedback_derive_over_copy]]).
**DRY-RUN ON PROD:** `read 34 files · 2,652,166 rows · 2,576,230 distinct uniqPitchId · 0 empty gameString` ·
**resolvable 2,576,146 / 2,576,146 = 100.00%**. Spot-check `287772425-23-1 → cs-mur01202602280`, and that row's
`date` is 2026-02-28 — the game string encodes `20260228` ✅.
**SAFETY:** writes only `where game_string is null` (never overwrites) · idempotent · stages the map into a temp table
then does ONE set-based UPDATE (2.5M single-row updates would take hours).
🐛 **FIRST ATTEMPT FAILED — `create temp table … ON COMMIT DROP`.** node-postgres **autocommits every statement**
unless you open an explicit transaction, so the CREATE committed and the table was dropped before the inserts ran
(`relation "_gs_map" does not exist`). **It failed loudly and wrote NOTHING** — prod re-verified at `filled 0`.
✅ Fixed by using a session temp table. **Rule: never use `ON COMMIT DROP` from node-postgres without an explicit BEGIN.**

---
# 🔬 HOW PER-PITCHER IP IS DERIVED — outs ÷ 3, AND THE FOUR WRONG WAYS
Trevor: *"IP is outs total divided by 3 anyway. That's what staging did… there is an outs total in the inning that the
pitch log tracks and you just have to recognize how that changes to get total outs."*
**THE DATA:** `inn` is **TEXT and ALREADY encodes the half** — `'Top 1'` / `'Bot 1'` — so **`(game_string, inn)` IS a
half-inning**; no separate top/bottom key is needed. `outs` is the base-out **STATE BEFORE the pitch** and only ever
holds **0 / 1 / 2** (never 3).
**THE DERIVATION (committed as `scripts/fill_pitcher_totals_ip.ts`):**
```sql
with p as (
  select pitcher_id, outs,
         lead(outs) over (partition by game_string, inn order by uniq_pitch_id) nxt
  from pitch_log where season=2026 and inn is not null and outs is not null)
select pitcher_id, sum(greatest(coalesce(nxt,3) - outs, 0)) / 3.0 as ip from p group by pitcher_id
```
Outs on a play = the NEXT row's `outs` minus this row's, within the half-inning; the final play of a completed
half-inning takes it to 3. **The out is attributed to whoever threw that pitch, so relief appearances split correctly.**
## 📊 ACCURACY — MEASURED AGAINST TruMedia `"Pitching Master".IP` (n=5,377, staging)
| method | mean \|Δ\| | median | verdict |
|---|---|---|---|
| engine `pitcher_line.csv` `full_IP` | **0.411** | 0.30 | best, but CSV-dependent |
| **outs-state delta ÷ 3 (this script)** | **0.476** | **0.33** | ✅ **in-DB, no CSV — chosen** |
| staging's stored `totals.ip` | 0.486 | 0.33 | ← **NOT more correct than a fresh derivation** |
| out-events + Sac, DP=2 | 0.596 | 0.33 | close; misses an out category |
| out-events, DP=2 | 1.260 | 1.00 | |
| attributable `(max+1−min)/3` | — | 1.33 | |
| half-inning `(max+1)/3` | — | 2.67 | ⛔ credits relievers with outs recorded BEFORE they entered |
★ **THE KEY RESULT: this derivation is as accurate as staging's stored column (0.476 vs 0.486, identical medians).**
Staging's `ip` is an **ad-hoc artifact with NO committed producer** — I burned significant effort trying to reproduce
it exactly before realising **matching it was never the goal**; reproducing a correct outs÷3 is.
All methods sit within the ~0.99 correlation this measure carries by design (`refresh_team_season_stats.sql:119`
records **corr 0.9932 vs Master IP**).
**GUARD:** the script ABORTS if mean |Δ| vs the Master line exceeds 1.0 IP — a bad derivation cannot write.
**BOTH WINDOWS IN ONE PASS:** the regular-season split comes from the date parsed out of `game_string`
(`…20260328…`) vs `regular_season_end` — so `ip` and the new `ip_reg` are produced together, no CSV needed.

---
# 📋 THE COMPLETE FILL LIST — WHAT MUST BE POPULATED, WHERE IT COMES FROM, AND ITS STATE
## LAYER 2 — `pitch_log_*_totals` (THE ACCUMULATOR — rebuilt on EVERY import)
| table.column | source | PROD state | note |
|---|---|---|---|
| `pitch_log_pitcher_totals.ip` | outs÷3 from `pitch_log` | ✅ **5,415 (filled 2026-08-31)** | required `game_string` first |
| `pitch_log_pitcher_totals.ip_reg` | same, ≤ boundary | ✅ **column added + 5,415 filled (2026-08-31)** | |
| `..._pitcher_totals.R` / `ER` | ⬜ **NOT BUILT** | ❌ absent | ⚠ needs the engine's **inherited-runner attribution, earned+unearned** — NOT a naive count. Blocks pitcher WAR from the DB. |
| `..._pitcher_totals` counts (`total_bf/pa/k/bb/hbp`, hits, batted-ball, `stuff_plus_sum`) | aggregator | ✅ 5,509 | |
| `pitch_log_hitter_totals` (`pa ab hits_* k bb hbp sac`, batted-ball, `ev_*`) | aggregator | ✅ 6,099 | full-season `pa`/`ab` verified **median Δ 0.00** vs engine |
| `pitch_log_hitter_totals.batting_rv / defensive_rv / baserunning_rv` | `populate_hitter_run_values` | ✅ | ★ precedent for folding defense/baserunning INTO the accumulator |
| a `reg` window for the hitter side | ⬜ **NOT BUILT** | ❌ | either `dimension_key='reg'` or `*_reg` columns |
## LAYER 3 — the Masters (DERIVED + DISPLAY)
| column | source | PROD state |
|---|---|---|
| `Hitter Master.pa` / `ab` | accumulator (full) | ⚠ holds the **REGULAR-SEASON** line — must become FULL |
| `Hitter Master.regular_season_pa` | engine `reg_PA` / a reg window | ❌ **0 / 5,341** |
| `Pitching Master.IP` | `ip` (full) | ⚠ holds the REGULAR-SEASON line |
| `Pitching Master.regular_season_ip` | `ip_reg` | ❌ **0 / 5,375** |
| `Pitching Master.ERA` | engine `full_ERA` (until `ER` lands in the accumulator) | ⚠ stale CSV |
| `Pitching Master.bf` | `total_bf` | ✅ **5,372 (filled 2026-08-31)** |
| **`K9` `BB9` `HR9` `WHIP` `FIP`** | `pitcherIpDependent()` — **needs `ip`** | ✅ **DERIVED ON PROD 2026-08-31 — 5,375/5,375.** Historical: `pitcherIpDependent` returned `{}` on a null `ip`, so the producer silently skipped them and prod held stale TruMedia values while staging derived them. Fixed by filling `ip` (step 0c) then running step 1. |
| `k_pct` / `pull_air` | accumulator | ⚠ 4,374 / 4,367 of 5,341 — the `MIN_PA` PATCH gate (now removed) |
| rates + batted-ball + `stuff_plus` | accumulator | ✅ (dry-run: 0 changes) |
| `G` / `GS` | ⬜ no pitch-log source found | Master-override. Trevor: *"almost positive the pitch log import has a starting pitcher id"* — Track B flag |
| SB / CS | Master sheet | **override BY DESIGN** |
| `dob` / `class_year` | roster scraper | out of scope |

## ▶️ ORDER (each step unblocks the next — none of these are optional)
```
1. game_string backfill        ← unblocks 2 AND F44's records block
2. fill_pitcher_totals_ip      → ip + ip_reg  (derives 0 pitchers until step 1 lands)
3. derive_masters_from_pitchlog → K9/BB9/HR9/WHIP/FIP finally derive; pa/IP/ERA/bf + regular_season_* written
4. F44 refresh_team_season_stats → _reg rates stop landing NULL; records block works
5. postseason-inclusive Master sheet import = the CROSS-CHECK / OVERRIDE layer
```

---
# 🐛 TWO node-postgres TRAPS THAT EACH COST A PROD RUN (2026-08-31). Exact reproductions.
Both hit while backfilling `pitch_log.game_string` (2,576,146 rows). **Both failed LOUDLY and wrote NOTHING** — prod
re-verified at `game_string filled 0` after each. Recording them precisely because neither is obvious and both will
recur in Track B, which does bulk writes by definition.

## TRAP 1 — `CREATE TEMP TABLE … ON COMMIT DROP` IS DESTROYED IMMEDIATELY
```ts
await c.query(`create temp table _gs_map (…) on commit drop`);   // ← commits, and DROPS, right here
await c.query(`insert into _gs_map …`);                           // ✗ relation "_gs_map" does not exist
```
**WHY:** node-postgres runs every `query()` in its own implicit transaction (autocommit) unless you open an explicit
`BEGIN`. `ON COMMIT DROP` therefore fires the instant the CREATE statement commits — before any INSERT can run.
**FIX:** either wrap the whole sequence in an explicit `BEGIN … COMMIT`, or use a plain session temp table
(`drop table if exists x; create temp table x (…)`), which lives until the connection closes.
**RULE: never use `ON COMMIT DROP` from node-postgres without an explicit transaction.**

## TRAP 2 — A SINGLE BULK `UPDATE` EXCEEDS PROD'S `statement_timeout` AND ROLLS BACK WHOLE
```
FATAL: canceling statement due to statement timeout
```
**PROD `statement_timeout` = `2min`** (verified: `show statement_timeout`). One set-based UPDATE joining 2.5M rows
blew straight through it. Because it is a SINGLE statement it rolled back **entirely** — no partial write, but ~4
minutes of staging work thrown away.
**FIX — batch it, and prefer `unnest()` over a temp table:**
```sql
update pitch_log p set game_string = m.gs
from unnest($1::text[], $2::text[]) as m(upid, gs)
where p.uniq_pitch_id = m.upid and p.season = $3 and p.game_string is null
```
25,000 rows per chunk → **~103 statements, each ~0.25 min**, comfortably under the 2-minute ceiling. This also
removes the temp table entirely, so TRAP 1 cannot recur.
**MEASURED THROUGHPUT ON PROD:** ≈ **87,000 rows/min** (1,175,000 rows in 13.5 min) ⇒ ~30 min for the full 2.58M.
★ **DESIGN THE `WHERE` CLAUSE SO A PARTIAL RUN IS RESUMABLE.** `where game_string is null` means an interrupted run
can simply be re-run — it only touches what is still empty. **A batched write without a resumable predicate is worse
than a single statement**, because a single statement at least rolls back cleanly.

## ⚠ RELATED, ALREADY LOGGED — DO NOT "SOLVE" THIS WITH `statement_timeout = 0`
A previous session set `statement_timeout = 0` for a `--direct` run and **prod hung for 39 minutes with no active
query** — removing the ceiling also removes the failure signal. **Use a FINITE timeout and BATCH.** Same reasoning as
the ~125s PostgREST gateway ceiling that silently rolls back `refresh_composite_war()`.

## 🅱️ TRACK B REQUIREMENT
Track B writes in bulk on every ingest. It MUST: batch every write under the statement timeout · use a resumable
predicate · never rely on `ON COMMIT DROP` · report per-batch progress and a final written count · treat a
swallowed error as a hard stop. All four of these were violated by code found in this push.

---
# ✅ STEP 0b + 0c APPLIED TO PROD (2026-08-31) — `game_string` backfilled, per-pitcher IP derived
## 0b — `pitch_log.game_string` BACKFILL: **0 → 2,576,146 (100%)**
```
✓ updated 2,576,146 rows
AFTER — filled 2,576,146 / 2,576,146 · distinct games 8,519
```
★ **SANITY GATE THAT MATTERS: 8,519 distinct games × 2 team-appearances ÷ 308 D1 teams = 55.3 games/team** — exactly a
~56-game season. A bad join would have produced a nonsense number here; a row count alone would not have caught it.
Source: `docs/drs-reference/*DRS Pitch Log*.csv` (34 files, `uniqPitchId`→`gameString`), **not** copied from staging.
**RUNTIME:** ~30 min at **≈87,000 rows/min**, 103 batches of 25,000. Two failed attempts first (see the node-postgres
traps block) — both wrote NOTHING and prod was re-verified at `filled 0` after each.

## 0c — `pitch_log_pitcher_totals.ip` + NEW `ip_reg`: **0 → 5,415**
```
DERIVED — 5415 pitchers (5382 with IP>0)
  Σ IP 147,630.3   Σ reg 140,202.7   post = 7,427.7 (5.0%)
  vs TruMedia Master.IP — n=5,374  mean|Δ|=0.458  median=0.33  p90=1.33
```
**THREE INDEPENDENT CONFIRMATIONS:** (1) **Σ IP 147,630.3 is IDENTICAL to staging's** — same pitch log, same
derivation, same answer, computed separately; (2) mean |Δ| **0.458** matches staging's **0.476**; (3) the **5.0%
postseason share** is right for conference tournaments + regionals on a 56-game season.
DDL: `alter table pitch_log_pitcher_totals add column if not exists ip_reg numeric`.

## 🛑 THE GUARD FIRED — AND IT WAS RIGHT TO. READ THIS BEFORE LOOSENING ANY THRESHOLD.
The first prod dry-run **ABORTED**: `mean |Δ| = 1.827 > 1.0 — derivation looks wrong`.
**The derivation was fine. The COMPARISON was wrong.**
| prod `"Pitching Master".IP` vs | mean \|Δ\| | median |
|---|---|---|
| derived **FULL** `ip` | **1.827** | 0.67 |
| derived **`ip_reg`** | **0.458** | **0.33** |
**PROD's `Master.IP` HOLDS THE REGULAR-SEASON LINE** (staging's holds FULL). Checking a full-season derivation against
a regular-season column manufactures a false discrepancy.
✅ **FIXED THE COMPARISON, NOT THE THRESHOLD** — the script now checks `ip_reg` by default with a `--cmp-full`
override for once the Masters hold the full-season line. **Loosening the threshold would have written silently and
destroyed the only signal that told us which window prod's Master column is in.**
★ **LESSON: a tripped guard is DATA.** It said "these two numbers disagree" and the disagreement was the real finding.
Compare like with like; never relax a gate to make it pass.

## ▶️ WHAT THIS ARMS (nothing has changed on the Masters yet)
`derive_masters_from_pitchlog` calls `pitcherIpDependent(t, ip)`, which returns `{}` on a null `ip`. With `ip` now
populated it will finally derive **`K9` `BB9` `HR9` `WHIP` `FIP`** on prod instead of silently leaving stale TruMedia
values. **Those five columns do NOT change until STEP 1 runs** — 0c only arms it.
Also unblocked: `refresh_team_season_stats` step 5 (team W/L records), which keys on `game_string`.

---
# ✅ STEP 1 APPLIED TO PROD (2026-08-31) — the Masters now carry FULL-SEASON counting stats + the reg anchors
`derive_masters_from_pitchlog.ts --apply --no-newrows --prod`. Backups: `_hm_prefill_backup` (8,245) ·
`_pm_prefill_backup` (8,071). Changed 3,742 hitters / 5,374 pitchers.

## GATES (prod, 2026, D1) — before → after
| gate | before | after | ✓ |
|---|---|---|---|
| `pa` avg | 121.8 | **127.7** | ✅ full-season |
| `regular_season_pa` | **0** | **5,322** (avg 121.4) | ✅ |
| `regular_season_pa` vs the OLD `pa` | — | **median Δ 0.00** (n=5,322) | ✅ |
| `IP` avg | 25.67 | **26.66** | ✅ |
| `regular_season_ip` | **0** | **5,372** (avg 25.32) | ✅ |
| `bf` | **0** | **5,372** | ✅ free fill, was never wired |
| `K9` / `WHIP` | stale CSV | **5,375 / 5,375 DERIVED** | ✅ ← the gap 0c armed |
| `k_pct` | 4,374 | **5,334** | ✅ patch gate removed |
| **depth-role volume** (`regular_season_pa ?? pa`) | — | **median Δ 0.00** | ✅ tiers stable |

## 🛑 TWO OF MY OWN GATES WERE MISCALIBRATED — THE DATA WAS RIGHT BOTH TIMES
1. **`pull_air` 4,781 (I expected ~5,341).** ❌ my expectation. `pull_air` is gated by **`MIN_TRACKED_BIP`** — a
   DATA-QUALITY floor — not by `MIN_PA`. I had already documented "sample-gated columns: do NOT fill these" and then
   wrote a gate expecting them filled. **4,781 is correct.**
2. **`ERA` avg 8.72 — I called it implausible.** ❌ wrong comparison. It was **8.65 BEFORE**; the raw mean is dominated
   by tiny-IP outliers (Luke Rolland 0.30 IP / 216.0 ERA — pre-existing). The meaningful measure, **IP-WEIGHTED ERA,
   moved 6.10 → 6.12** — essentially unchanged, the sliver being postseason innings.
★ **RULE: for any per-player rate, gate on the IP/PA-WEIGHTED mean, never the raw mean.** A raw mean over a
long tiny-denominator tail is not a league average and will trigger false alarms.

## 🧠 FOUR INSTRUMENT ERRORS IN ONE SESSION — THE PATTERN
Every one was MY measurement, not the data: (1) park-factor diff matched the CSV's `teamId` instead of `team` →
"309 teams dropped" when it was **1**; (2) compared two derivations by EXACT EQUALITY → "1,306 hitters change" when
median Δ was **0.00**; (3) `Number(null) === 0` passed `isFinite` → a fabricated 26.6-IP discrepancy; (4) raw-mean ERA
→ a false regression. **VERIFY THE INSTRUMENT BEFORE REPORTING AN ALARM.** Report mean/median/p90/max — never a
percent-exact-match, and never a raw mean over a skewed denominator.
✅ **The one gate that fired for real** — the IP-fill guard at 1.827 — was RIGHT, and its disagreement was the finding
(prod's `Master.IP` held the regular-season line). **Fix the comparison, never the threshold.**

## ▶️ NEXT
`F44 refresh_team_season_stats(2026)` — now fully unblocked: `regular_season_ip` is populated (its `nullif(sum(...),0)`
no longer yields NULL) **and** `game_string` exists (its records block keys on it). Then E35 → precomputes → F39 → F40–43.
⬜ **Still to come:** the postseason-inclusive Master sheet import, which OVERRIDES where it is more accurate
(SB, ERA, G/GS) — per the derive-then-check order.

---
# ✅ F44 `refresh_team_season_stats(2026)` — APPLIED TO PROD 2026-08-31. Completed in 59.7s.
## GATES — ALL PASS (prod, season 2026)
```
rows 0 → 308                                308
faced_stuff_plus / faced_htp                308 / 308   ← what Phase E actually reads
ra9_reg / fip_ra9_reg                       308 / 308   ← would be NULL without regular_season_ip
AVG 0.277 · wRC+ 98.8 · ERA 6.20 · total_war 15.09
W/L records                                 308 teams · 27.6W-27.4L · 55.0 games
team_drs · ip_total · park snapshot         308 / 308 / 308
Arkansas exactly ONE row                    1
```
★ **THREE GATES ARE DIRECT PAYOFFS FROM TODAY'S EARLIER WORK:**
1. `ra9_reg`/`fip_ra9_reg` = 308 — these divide by `sum(regular_season_ip)` (`:143,:145`), which was **0/5,375 this
   morning**. Without STEP 1 they would ALL have landed NULL, silently.
2. **W/L records = 27.6W-27.4L over 55.0 games** — the records block keys on `game_string`, which was **0/2,576,146**
   this morning. **55.0 games/team independently cross-checks the 8,519 distinct games** from the backfill
   (8,519 × 2 ÷ 308 = 55.3). Two different derivations of season length agreeing.
3. `AVG 0.277` and `wRC+ 98.8` land exactly where the runbook predicted (~.277 / ~100).

## 🛑 F44 FAILED FIRST — A PRIMARY KEY CAUGHT WHAT NO GATE OF OURS WOULD HAVE
```
duplicate key value violates unique constraint "team_season_stats_pkey"
Key (source_id, season)=(3375, 2026) already exists.
```
The function does `GROUP BY "TeamID"` then `JOIN "Teams Table" tt ON tt.id = TeamID` to get `source_id`. **Two
`TeamID`s resolving to ONE `source_id` therefore emit two rows with the same PK.** `team_season_stats` stayed at
**0 rows** — a plpgsql function is atomic, so it rolled back whole.
★ **THE DATABASE CONSTRAINT DID CARDINALITY ENFORCEMENT NO APPLICATION GATE WOULD HAVE.** It refused to write two
Arkansas rows rather than silently producing one. **A PRIMARY KEY IS A CARDINALITY GATE — lean on it.**

## 🔍 ROOT CAUSE — A MANUFACTURED MASTER ROW, NOT A `TeamID` PROBLEM
**My first proposed fix (re-point the `TeamID`) WAS WRONG.** Trevor pushed back — *"I am more worried about the team
id changing and impacting a lot more than we realize"* — and investigating proved him right.
### WHAT THE INVESTIGATION FOUND
| the `TeamID` convention is MIXED, and that is FINE | |
|---|---|
| 2026 Masters pointing at a **2025** Teams-Table row | **254 TeamIDs · 8,794 rows** |
| 2026 Masters pointing at a **2026** Teams-Table row | **55 TeamIDs · 1,922 rows** |
**So 55 teams legitimately use their 2026 id.** Arkansas was not an outlier for using one — it was the **ONLY
`source_id` where BOTH appeared**. The two Arkansas Teams-Table rows are **identical in every field** except `id` and
`Season` (same `source_id`, name, abbreviation, conference, `conference_id`, division), and the 2026 row is genuinely
referenced by **34 `players` rows**. ⛔ **DO NOT "normalize" the 254/55 split — F44 only requires that each
`source_id` resolve to ONE `TeamID`.**
### THE ACTUAL DEFECT — Carson Wiggins (`1583774970`)
| | |
|---|---|
| prod `pitch_log` 2026 | **0 pitches, 0 games** |
| prod `pitch_log_pitcher_totals` | **no row** |
| **staging `"Pitching Master"`** | **DOES NOT EXIST** |
| prod `"Pitching Master"` | 1 row, `IP 14`, `ERA 3.21`, on the 2026 `TeamID` |
A **manufactured row with no season behind it** — Trevor: *"Wiggins was manually added because there was a chance he
was coming back, then he signed."* **DELETED** (backed up to `_pm_wiggins_backup`); his `players` row untouched.
★ **THE KOZEAL/WIGGINS DISTINCTION — THIS IS THE RULE:**
> **Kozeal:** 1,103 pitches, 287 PA of real pitch-log data, **no Master row** → the row was MISSING and had to be created.
> **Wiggins:** a Master row with **ZERO pitch-log data** → the row was PHANTOM and had to be removed.
> **Presence in a season's Master is determined by whether the PITCH LOG shows he played — nothing else.**
### VERIFIED AFTER THE DELETE — **NO `TeamID` CHANGED**
`source_ids served by >1 TeamID: 0` → **308 TeamIDs mapping to 308 distinct source_ids, 1:1.** The mixed 254/55
convention is untouched.

## 🧠 PROCESS NOTES
- **I guessed column names twice** (`ra9_r`, `AVG`) before reading `information_schema`. `ra9_r`/`fra9_r` are the
  function's internal CTE aliases; the TABLE columns are `ra9_reg`/`ra9_total`/`fip_ra9_reg`. **Read the schema; do
  not infer column names from the producing SQL.**
- **`statement_timeout` could NOT be raised via the node-postgres client option** — `show statement_timeout` still
  reported `2min` despite passing `statement_timeout: 900000`. F44 finished in **59.7s** so it did not matter, but for
  anything longer use `set statement_timeout = '15min'` as an explicit statement (a FINITE value — **never 0**).

---
# ✅ E35 TWP DETECTOR — APPLIED TO PROD 2026-08-31 (11.4s, 606 updates, 0 errors)
`npx tsx --env-file=.env.production.local scripts/run-twp-recompute.ts --prod --apply`
(guard ADDED earlier today — it had NONE; backup `_players_pre_twp_backup`, 31,467 rows)

## GATES
| gate | before | after | staging | ✓ |
|---|---|---|---|---|
| `players.is_twp` | 137 | **253** | **253** | ✅ **exact match** |
| legacy `position='TWP'` | 428 | **34** | **34** | ✅ **exact match** |
| `position` NULL | 196 | 462 | 94 | ✅ prod carries far more alumni |
| rows changed | — | **606** | — | ✅ = the dry-run figure |
| D1 TWPs | — | **90** | — | ℹ |
**BREAKDOWN:** 124 new · 80 legacy-migrated · 49 unchanged · 28 → hitter · 108 → pitcher · 266 cleared → NULL · 34 left alone.
★ **`124 + 80 + 49 = 253` — arrived at INDEPENDENTLY from prod's own Masters and landing exactly on staging's 253.**
Same independent-replication pattern as the Stuff+ gate, `team_drs`, and Kozeal's WAR.

## 🛑 MY GATE EXPECTATION WAS WRONG (again) — THE DATA WAS RIGHT
I predicted legacy `position='TWP'` would go to **0**. It went to **34** — which is **exactly staging's 34** and
**exactly the detector's own `left alone: 34` bucket**. Those rows are DELIBERATELY untouched by the detector, not
missed. **Do not "finish the job" by nulling them.**
→ Sixth instrument/expectation error this session. **Before calling a number a failure, check whether the producer
already told you it would be that number** — the report literally printed `left alone: 34`.

## WHAT THE 266 "cleared → NULL" ACTUALLY ARE — NOT DESTRUCTIVE
Prod carried **428** legacy `position='TWP'` rows vs staging's 34, because prod holds **years of historical players**
(31,467 vs 15,561 — expected depth, NOT a discrepancy). `'TWP'` is not a position; it is the **old overload the
detector exists to replace** — its own header: *"Replaces the prior `position = 'TWP'` overload, which destroyed the
hitter position."* The 266 are **ALUMNI with no 2026 data**, whose real position was already destroyed by that
overload and is unrecoverable. Setting `position = NULL` is the honest result (rule 6: *"No 2026 data → is_twp=false,
position = NULL (alumni)"*). **Nothing recoverable was lost.**

## WHY THIS HAD TO PRECEDE THE PRECOMPUTES
`is_twp` drives BOTH-SIDE row generation. Running E36/E37/E38 first would have produced projections for 137 TWPs
instead of 253 — **116 two-way players silently missing their second side**, with no error anywhere.

---
# ✅ E36 RETURNER PITCHERS — APPLIED TO PROD 2026-08-31 (+ the propagate re-run)
## RESULT
`6440 computed · 8050 blocked (of 15,646 pitchers) · 1,172 JUCO computed · 1,156 JUCO nulled (sub-20 IP)` →
**7,596 rows upserted.** Blocked reason is uniformly `no_pm_row` (no `"Pitching Master"` row) — expected for
alumni/non-2026 players.
## GATES
```
returner pitcher rows with p_war   6,632  (market_value 6,466 · p_era 6,632 · pitcher_depth_role 5,459)
p_war distribution                 avg 0.607 · −1.75 … 3.93
propagate scouting scores          91,393 rows carry pitcher_whiff_score
market values                      avg $13,482 · max $382,705
```

## 🛑 MY ERROR — I CALLED IT A DRY RUN AND IT WROTE. **THE `:prod` npm ALIASES APPLY BY DEFAULT.**
```
"precompute-returner-pitchers:prod": "tsx --env-file-if-exists=.env.production.local scripts/precompute-returner-pitchers.ts --prod"
```
**There is NO `--dry-run` in the alias.** The script DOES support it (`:104` `process.argv.includes("--dry-run")`) —
it just has to be passed through:
```
npm run precompute-returner-pitchers:prod -- --dry-run      ← the `--` is REQUIRED
```
I announced "dry-run first", ran the bare alias, and it upserted **7,596 rows to prod**. The write was the authorized
next step so nothing unintended landed, but **the description was wrong and I did not verify the mode before running.**
★ **RULE: for every `npm run …:prod` alias, `grep` it in `package.json` FIRST and confirm whether a dry-run flag is
present. Assume these aliases WRITE.** This applies to E37 (`precompute-returner-hitters:prod`) and every other
`:prod` alias in the remaining sequence.

## 🐛 THE PROPAGATE TIMED OUT — AND THE FIX IS THE ONE THAT MATTERS FOR EVERY LONG STATEMENT
`✗ propagate failed: canceling statement due to statement timeout`
`propagate_pitcher_scores_to_predictions` is an `UPDATE … FROM players, "Pitching Master"` with **NO season filter on
`player_predictions`**, so it rewrites **~105k rows** across every season/model. Prod's `statement_timeout` is **2min**.
✅ **RE-RAN SUCCESSFULLY: `105,093 rows in 11.3s`.**
★★ **`SET statement_timeout = '15min'` AS AN EXPLICIT STATEMENT WORKS. The node-postgres CLIENT CONSTRUCTOR OPTION
DOES NOT.** Passing `new pg.Client({ statement_timeout: 900000 })` left `show statement_timeout` reporting `2min`.
```ts
const c = new pg.Client({ connectionString: PGURI, keepAlive: true });
await c.connect();
await c.query(`set statement_timeout = '15min'`);   // FINITE — never 0
```
⛔ **NEVER `statement_timeout = 0`** — a previous session did that and prod hung 39 minutes with no failure signal.
ℹ The step is IDEMPOTENT (it only copies scouting scores from the Masters), so re-running after a timeout is safe.

## 🧠 COLUMN NAMES — I GUESSED AGAIN (3rd time today)
`model_version` does not exist; the columns are **`model_type`** and **`variant`**. Earlier: `ra9_r`/`AVG` on
`team_season_stats`. **Read `information_schema.columns` — do NOT infer column names from a producing script or a
function body.**

---
# 🔬 E36 PROD↔STAGING VERIFICATION (2026-08-31) — pitchers MATCH; hitters differ because E37 has not run
## ✅ PITCHERS — E36 REPRODUCES STAGING
| | PROD | STAGING |
|---|---|---|
| rows with `p_war` | **6,632** | 6,562 |
| avg `p_war` | **0.607** | 0.598 |
| `p_war` range | −1.75 … **3.93** | −6.68 … **3.93** |
| market rows · avg · max | 6,466 · **$13,146** · **$382,705** | 6,343 · $13,241 · $387,691 |
**PER-PLAYER (joined on `source_player_id`, n=6,485): `|Δ| p_war` mean 0.023 · MEDIAN 0.004 · p90 0.050.**
**`$/WAR` ratio prod÷staging: median 1.000 · p10 1.000 · p90 1.000** — the pricing rate is IDENTICAL.
Top players: `Ruger Riojas 3.58 / $357,778.626` **EXACTLY equal in both**; Volantis/Kuhns differ only by their small
`p_war` delta. ✅ **NIL tiers are IDENTICAL in both envs** — `sec=4.0 acc=1.5 big12=1.2 bigten=1.0 … juco=0.35`
(Trevor: PTM was raised for SEC and ACC — **that raise is already on PROD**).
★ Prod's `p_war` FLOOR is BETTER: **−1.75 vs staging's −6.68.** Staging retains an outlier prod does not.

## ⚠ HITTERS — PROD IS STALE, AND THAT IS EXPECTED (E37 IS THE NEXT STEP)
| | PROD | STAGING |
|---|---|---|
| market rows · avg · **max** | 6,488 · $13,816 · **$104,110** | 6,513 · $16,803 · **$613,259** |
Prod's returner hitters still carry **pre-SEC-4.0 pricing** — a ~6× gap at the top end. **E37 closes this.**
🛑 **DO NOT read this as a prod defect.** And note the gap only became visible when split BY SIDE: my first comparison
lumped hitters and pitchers together and produced a misleading "staging max $613,259 vs prod $382,705".
**Compare like with like — split by side before comparing markets.**

## 🛑 `updated_at` IS NOT A FRESHNESS SIGNAL
Prod's returner-HITTER rows show `updated_at = 2026-08-31` while their VALUES are stale — because
`propagate_pitcher_scores_to_predictions` rewrote scouting-score columns on **every** row (105,093 of them) and bumped
the timestamp. **A recent `updated_at` proves a row was TOUCHED, not that its numbers are current.**
Same family as "populated ≠ fresh" (Conference `Stuff_plus` at 30/30) and "count-correct ≠ complete" (Kozeal).
→ **Gate on the VALUE, never on `updated_at`.**

---
# 🧮 EQUATION / CALIBRATION VERIFICATION ON PROD (2026-08-31) — the two-sided SD IS live and IS being used
Trevor asked whether the equation work — **including the two-sided SD** — actually made it to prod. **I had NOT
verified it** and was implicitly relying on "220 keys on both envs", which only proves the KEYS exist. Verified properly:

## ✅ 1. THE TWO-SIDED SD IS PRESENT ON PROD — AND `sd_good` IS NOT MISSING
**There are no literal `sd_good` keys, and that is BY DESIGN.** `src/lib/pitcherProjection.ts:185` states it:
> *"a positive rating-z projects toward the GOOD side (use **sd_good = ncaaSd**); negative toward the [bad] side"*
So the pair is **`<stat>_plus_ncaa_sd` (GOOD side) + `<stat>_plus_ncaa_sd_bad` (BAD side)**.
**All 6 bad-side keys are on PROD** (re-derived by C27 from prod's own population):
```
era_plus_ncaa_sd_bad  2.304009   (staging 2.264985)
fip_plus_ncaa_sd_bad  1.869489   (staging 1.843704)
whip_plus_ncaa_sd_bad 0.341070   (staging 0.337614)
k9_plus_ncaa_sd_bad   1.982413   (staging 1.966669)
bb9_plus_ncaa_sd_bad  1.763271   (staging 1.733557)
hr9_plus_ncaa_sd_bad  0.281018   (staging 0.271141)
```

## ✅ 2. THE CODE ACTUALLY CONSUMES THEM (existence ≠ use — checked separately)
```
src/lib/transferPitcherProjection.ts:390-395   dsd(<stat>Pr, eq.<stat>_plus_ncaa_sd, eq.<stat>_plus_ncaa_sd_bad)
                                               → era · fip · whip · k9 · bb9 · hr9
src/lib/pitcherProjection.ts:455               ncaaSd: eq.era_plus_ncaa_sd, ncaaSdBad: eq.era_plus_ncaa_sd_bad
src/lib/transferPitcherProjection.ts:111-112   "PR+ > 100 = better talent → the compressed GOOD side (sd_good);
                                                PR+ < 100 → the wide BAD side (sd_bad)"
```

## ✅ 3. **E36 (RUN ON PROD TODAY) USED IT** — the run itself is the proof
`scripts/precompute-returner-pitchers.ts:133`:
> *"Overlay `model_config <stat>_plus_ncaa_*` (incl. the **stage-5.5 two-sided `_sd` / `_sd_bad`** + calibrated …)"*
and `:13` / `:38` route the math through `computePitcherProjection` in `pitcherProjection.ts`, which takes `ncaaSdBad`.
**⇒ The 6,632 prod pitcher projections written today were computed WITH the two-sided SD.**

## ✅ 4. `model_config` KEY SETS ARE IDENTICAL — 220 / 220, ZERO missing either way
`in STAGING not prod: 0` · `in PROD not staging: 0`.

## ⚠ 5. THE "77 DIFFERENCES" WERE MOSTLY NOISE — 156 formatting, **64 genuine**
A raw string comparison reported 77 differing values; a NUMERIC comparison shows **156 formatting-only**
(`0.3` vs `0.30`) and **64 genuinely different**. **Compare numerically, never as strings.**
**All 64 are prod being FRESHER** — they are the NCAA averages/SDs that **C27 re-derived from prod's own data**, and
**staging never ran C27**:
```
p_ncaa_avg_stuff_plus  prod 100.0141  staging 99.4358   ← ★ the Stuff+ RECENTER reached the projection constants
p_sd_stuff_plus        prod 5.04577   staging 5.93754
p_ncaa_avg_whiff_pct   prod 23.3673   staging 23.4593
r_ncaa_avg_ba          prod 0.2772    staging 0.28      ← prod DERIVED; staging a rounded literal
r_ba_std_pr            prod 29.99699  staging 31.297
r_obp_std_ncaa         prod 0.05081   staging 0.046781
```
★ **`p_ncaa_avg_stuff_plus = 100.0141` on prod is an END-TO-END signal** that the Stuff+ recenter survived
score → aggregate → Master rollup → `computeNcaaAverages` → the projection constants.
🛑 **CONSEQUENCE FOR E37:** the hitter-side calibration (`r_ba_std_pr`, `r_obp_std_ncaa`, `r_ncaa_avg_*`) ALSO differs
from staging for the same C27 reason. **E37's hitter numbers will NOT match staging exactly — that is EXPECTED, not
drift.** Compare E37 against the *shape* (distribution, depth-role mix), not against staging's literal values.

## 🧠 THE CHECK I WAS SKIPPING
"220 keys on both environments" proves only that the **keys exist**. It does NOT prove they are **populated with
re-derived values**, nor that any **code path consumes them**. Those are three separate questions:
**(a) does the key exist · (b) is its value fresh · (c) does the producer actually read it.**
→ **For any calibration change, verify all three.** Trevor caught this by asking; I had answered (a) only.

---
# 🔴 DEPTH-ROLE SOURCE DEFECT — `players.pa` WAS DRIVING THE TIER, AND IT WENT STALE (found + fixed 2026-08-31)
## HOW IT SURFACED
After E37, prod's returner-hitter depth mix had **306 fewer `cornerstone`** than staging (1,088 vs 1,394) while
`o_war` matched (**max 6.86 in BOTH**) and markets closed correctly. Markets/WAR right, TIERS wrong ⇒ the tier input
was the problem, not the projection.

## ❌ MY FIRST HYPOTHESIS WAS WRONG — measured, then discarded
I assumed the Master `pa` change moved players across the 220-PA boundary. **It did not:**
`>=200 PA: 1,332 → 1,297 (−35)` · `>=150 PA: 2,239 → 2,228 (−11)`. Nowhere near 306. **And the direction was wrong** —
Master `pa` went UP (full season), which would produce MORE cornerstones, not fewer.

## ✅ THE ACTUAL CAUSE — the tier reads a DIFFERENT TABLE
`scripts/backfill-2027-hitter-returners.ts:286` called `defaultHitterDepthRoleFromActualPa(meta.pa)` where
`meta.pa` comes from **`players.pa`** (`:136` `.from("players").select("… pa …")`) — a stat living on the **IDENTITY**
table, which **nothing keeps in sync with the Masters**.
| | `players.pa` | `"Hitter Master".pa` | in sync? |
|---|---|---|---|
| **STAGING** | 128.0 | 128.0 | ✅ **5,343 / 5,343 identical, median Δ 0.0** |
| **PROD (after Step 1)** | **120.4** | **127.7** | ❌ 2,118 / 5,325 · median Δ **2.0** |
★ **SMOKING GUN: staging's `players.pa >= 220` count is 1,394 — EXACTLY its cornerstone count.**
The threshold is hardcoded (`src/lib/depthRoles.ts:93` `if (safePa >= 220) return "cornerstone"`).
**I created the divergence**: Step 1 updated `"Hitter Master".pa` to full-season and left `players.pa` untouched.
It never surfaced on staging because there the two columns happen to be equal.
★ **FIFTH INSTANCE of the same shape** — *the VALUE moved to one table, a supporting INPUT stayed on another*
(after C24 `trackman_pitches`, `computeNcaaAverages` weighting, Conference `Stuff_plus`, and F44's `TeamID`).

## ✅ THE FIX — CHANGE WHAT IS READ; DO NOT SYNC ANOTHER COLUMN
Trevor: *"Both should be regular season PA"* · *"we don't even really need `players.pa` if we are using regular season
pa/ip — just change what column is read, not filling another column."* The Masters ALREADY carry both windows from
Step 1 (`regular_season_pa` 5,322 · `regular_season_ip` 5,372), so **nothing needed filling.**
```
scripts/precompute-returner-pitchers.ts:488
-  const actualIp = Number(pmRow.IP) || 0;
+  const actualIp = Number(pmRow.regular_season_ip ?? pmRow.IP) || 0;      // select("*") already fetches it

scripts/backfill-2027-hitter-returners.ts:186   + regular_season_pa, pa   (added to the Master select)
scripts/backfill-2027-hitter-returners.ts:286
-  defaultHitterDepthRoleFromActualPa(meta.pa)
+  defaultHitterDepthRoleFromActualPa(master?.regular_season_pa ?? master?.pa ?? meta.pa)
```
**FALLBACK = the Master's FULL-season `pa`/`IP`** (Trevor: *"full season is fine"*) for the ~19 hitters / ~3 pitchers
with no reg value — so **`players` is no longer a stat source on this path**.
⛔ **`players.pa` / `players.ip` are LEFT IN PLACE, not removed** — other consumers may read them; a column drop
mid-push is not worth the risk. **Do NOT add duplicate reg columns to `players`** (Trevor: no duplicated unused columns).
✅ **BOTH PATHS NOW AGREE ON THE REGULAR SEASON:** the precompute matches TeamBuilder
(`useTeamBuilderData.ts:239` `regular_season_pa ?? pa`, `:254` `regular_season_ip ?? IP`), which was already correct.
**TeamBuilder is the reference implementation here.**
⚠ **E36 + E37 MUST BE RE-RUN** — their `hitter_depth_role`/`pitcher_depth_role` and the `projected_pa`/`projected_ip`
derived from them are stale. `o_war` / `p_war` / rates / markets are UNAFFECTED. Re-running is idempotent.

## 🏷️ LEGACY FUNCTIONS MARKED (2026-08-31) — stop rediscovering these
Banners added in-file so nobody proposes them again:
| file | last touched | why LEGACY |
|---|---|---|
| `src/lib/syncMasterToPlayers.ts` | 2026-06-07 | `refreshPaIpFromMaster()` syncs Master→`players.pa/ip` — the model just superseded. ⛔ `syncMasterToPlayers()` **WIPES** the players table. ✅ `addMissingPlayers()` still live. |
| `src/lib/importPaAbData.ts` | 2026-04-03 | writes PA/AB onto `players` |
| `src/lib/runDataCascade.ts` | 2026-05-19 | imports `bulkRecalculatePredictionsLocal`, a **STUB** (`predictionEngine.ts:875`) — the open gate on Phase-H 48 |
| `scripts/recompute-cascade.ts` | 2026-08-20 | **PARTLY** legacy: calls the LEGACY `calculateConferenceStuffPlus` **and** the stubbed `bulkRecalc` |
| `src/savant/lib/conferenceStuffPlus.ts` | 2026-04-26 | reads the legacy `pitcher_stuff_plus_inputs` lane; superseded by `conferenceStuffPlusV2` |
★ I proposed `refreshPaIpFromMaster` as "the committed process" purely because its docstring matched the symptom.
Trevor: *"that is old outdated stale logic … all of these are outdated I am almost positive."* **A docstring that
matches your symptom is not evidence the function is current — CHECK `git log -1 --format=%ad` FIRST.**
