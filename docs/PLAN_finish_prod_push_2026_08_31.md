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

## ★ STEP 0b — BACKFILL `pitch_log.game_string` (NEW — discovered 2026-08-31, PROD WRITE)
**`game_string` is 0 / 2,576,146 on PROD.** It is an INGEST-time identifier, not derived. While NULL it silently
breaks (a) per-pitcher IP — the half-inning key is `(game_string, inn)` — and (b) `refresh_team_season_stats` step 5's
W/L records, which key on it. **Neither raises an error.**
```
npx tsx scripts/backfill_pitch_log_game_string.ts --prod            # dry-run
npx tsx scripts/backfill_pitch_log_game_string.ts --prod --apply
```
**GATE:** `game_string` 0 → **2,576,146** · `count(distinct game_string)` ≈ the season's game count · spot-check that
the embedded date matches the row's `date`.

## ★ STEP 0c — FILL `pitch_log_pitcher_totals.ip` + `ip_reg` (NEW, PROD WRITE)
**`ip` is 0 / 5,509 on PROD**, which is why `K9/BB9/HR9/WHIP/FIP` on the Pitching Master are **stale CSV values**
rather than pitch-log-derived (`pitcherIpDependent` returns `{}` on a null ip). Requires STEP 0b.
```
npx tsx --env-file=.env.production.local scripts/fill_pitcher_totals_ip.ts --prod            # dry-run
npx tsx --env-file=.env.production.local scripts/fill_pitcher_totals_ip.ts --prod --apply
```
**GATE:** derives ~5,400 pitchers (0 before STEP 0b) · `ip` 0 → ~5,400 · `ip_reg` populated · postseason share ≈ **5%**
· mean |Δ| vs `"Pitching Master".IP` ≈ **0.48** (the script self-aborts above 1.0).

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
| **`game_string` populated** | **0 (100% NULL)** | **2,576,146** |
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
| `pitch_log_pitcher_totals.ip` | outs÷3 from `pitch_log` | ❌ **0 / 5,509** | needs `game_string` first |
| `pitch_log_pitcher_totals.ip_reg` | same, ≤ boundary | ❌ **column does not exist** | `add column if not exists` |
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
| `Pitching Master.bf` | `total_bf` | ❌ **0 / 5,375** — free fill, already selected by the producer |
| **`K9` `BB9` `HR9` `WHIP` `FIP`** | `pitcherIpDependent()` — **needs `ip`** | 🔴 **STALE CSV VALUES ON PROD.** `pitcherIpDependent` returns `{}` when `ip` is null, so the producer silently skips them. **Staging derives them; prod does not.** ← *newly discovered, was not in any doc* |
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
