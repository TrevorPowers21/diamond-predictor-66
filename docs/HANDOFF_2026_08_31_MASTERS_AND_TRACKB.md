# ▶️ HANDOFF — RSTR IQ, end of 2026-08-30. **START HERE.**
Supersedes `HANDOFF_2026_08_30_PROD_PUSH.md` as the entry point. That file is still valid for Phase-C detail.

## READ IN THIS ORDER
1. **§1 CURRENT STATE** below — what is on prod right now.
2. **§2 THE TWO WORKSTREAMS** — the prod push and the Track B build are SEPARATE. Do not conflate them.
3. `docs/PIPELINE_pitch_log_to_projections.md` → **"TRACK B — THE COMPLETE ARCHITECTURE"**. The build spec.
4. `docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md` — why the runbook's order is wrong.
5. `PROD_MIGRATIONS_TODO.md` — the ledger. **Append every prod change.**
6. Memory: `project_stuff_plus_v2_locked` · `project_prod_push_in_progress` · `reference_db_direct_sessions`
   (both `PGURI`s are SAVED — **never ask for DB passwords**).

---
# §1 CURRENT STATE — PROD (all verified IN THE DATABASE, not from logs)
| area | state |
|---|---|
| **Phase A/B** schema + config | ✅ `model_config` 220 keys. Phase-B tuned values SURVIVED C27's upsert (`nil_tier_sec` 4.0, `r_obp_std_pr` 31.89504). ⚠ gate key names are `r_obp_std_pr` / `p_whip_pr_sd` / `owar_replacement_runs_per_600` — the short forms in older docs return **zero rows**. |
| **Phase C** Stuff+ chain | ✅ 2,013,005 pitches classified+scored. Gate **mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 — IDENTICAL to staging.** |
| C24 · C27 · C26 · C29 · C28(4 steps) · C28b | ✅ applied. Conference `Stuff_plus` **101.17 → 99.15** (legacy-lane fix). |
| **Phase D** | ✅ **COMPLETE.** D29b `team_drs` **derived on prod** (308 teams, sum 0.00) · D30 no-op · D31/D32 committed `0 FAILED` · **D34 passed all 9 gates.** |
| **E2** park factors + `derive_conf_opr_htp` re-run | ✅ `rg_factor_seasonal` 0/309 → full. `run_env_factor` **101.879 → 99.719** (park Δ 2.16 flowed through exactly). Park factors **308/308 IDENTICAL to staging**. |
| *(unplanned)* Camden Kozeal | ✅ Master row created — D1 hitters 5,340 → **5,341**. His WAR now matches staging to 3dp. |
| **`pa` / `IP`** | ⚠ hold the **REGULAR-SEASON** window (verified: mean \|Δ\| 0.865 vs `reg_PA`, 6.567 vs full `PA`). **Must become FULL season.** |
| **`regular_season_pa` / `_ip`** | ❌ **0 / 5,341 and 0 / 5,375.** Blocks F44's `_reg` rates. |

**Prod↔staging:** park factors identical · `run_env_factor` identical · Kozeal's WAR identical. `hitter_talent_plus`
99.23 vs 99.01 = **staging is BEHIND** (never got C24/C26/C27/C28/C28b/C29). **Prod is the current side — a mismatch
here is NOT a prod defect.**

---
# §2 THE TWO WORKSTREAMS — KEEP THEM SEPARATE
## A. FINISH THE PROD PUSH (near-term, mostly ready)
**Only ONE genuine code blocker:** `scripts/backfill-snapshot-total-hitter-war.ts` (F40) reads
`process.env.SUPABASE_URL` with **no `--prod` flag at all** — `--env-file` pointed at prod writes prod with zero
opt-in. **6th instance** of this defect class. Add the double-keyed guard; verify both refuse paths.
**Order (dependency, NOT topic — see the ORDER AUDIT):**
```
0. fix F40's guard
1. F44 refresh_team_season_stats(2026)   ★ MOVED UP — Phase E READS team_season_stats.faced_*
                                          ⚠ its _reg rates land NULL until regular_season_ip is filled (re-run later; idempotent)
2. E35 run-twp-recompute --apply --prod   (prod is_twp 137/31,467 → expect a big change)
3. E36 → E37 → E38 (zsh scripts/_run_step2_all.sh --prod)
   🛑 that loop pipes through `grep | head -3` and SWALLOWS EXIT CODES — "14 teams DONE" is NOT proof.
      Re-run the dry-run after and require 0 pending per team.
4. F39 refresh_composite_war()  ← direct pg session / SQL editor ONLY (PostgREST cuts at ~125s and ROLLS BACK)
5. F40 → F41 → F42 (needs --all) → F42b → F43
6. G46 edge-fn deploy (Trevor) → preview-verify → gh pr create staging→main → Trevor merges → H drops
7. THEN staging catch-up — run THROUGH Track B, not by hand
```
**Verified ready, do NOT re-check:** E35 guard ✅ · E36/E37/E38 asserts + ordered pagination ✅ · `customer_teams` = **14**
(not 18) · F41a/b/c asserts ✅ · F42a/b/c asserts ✅ (F42a is env-driven now) · F43a/F43b **safe by construction**
(`--prod` selects the env file, read directly). `refresh_team_season_stats` table+fn **exist** on prod.

## B. THE TRACK B BUILD (the real engineering)
Spec: `docs/PIPELINE_pitch_log_to_projections.md` → **"TRACK B — THE COMPLETE ARCHITECTURE"**. Summary:
```
pitch_log (DAILY)  →  pitch_log_*_totals  =  THE ACCUMULATOR (all raw counts, ONE place, rebuilt EVERY import)
                   →  Masters = DERIVED + DISPLAY (rates, ratings, WAR, pa/IP + reg anchors; NO raw counts)
                   →  TruMedia Master sheet (MONTHLY) = CHECK/OVERRIDE only (SB, ERA, G/GS)
```
**WAR reads the accumulator and WRITES the Masters.** Reg/post split = **lock once at the transition**, then the
full-season line keeps growing. **`lock_regular_season` / D33b is OBSOLETE — retire it.**
**Build queue:** ① extend `derive_masters_from_pitchlog` (counting stats + reg/post + gate split + `repRows` fix)
② `pitch_log_pitcher_totals` gains `R`/`ER` **incl. the inherited-runner accrual** ③ `dimension_key='reg'`
④ fold defense/baserunning into the accumulator ⬜ sequencing OPEN ⑤ re-point WAR at the DB ⑥ one boundary source
(later: per-team schedules).

---
# §3 THE NEXT CONCRETE TASK
**▶ FULL STEP-BY-STEP: `docs/PLAN_finish_prod_push_2026_08_31.md`** — 12 steps, each with a VALUE gate.

**Extend `derive_masters_from_pitchlog.ts`** to write, in ONE operation per player:
`pa`/`ab` ← `PA`/`AB` (FULL) · `regular_season_pa` ← `reg_PA` · `IP` ← `full_IP` · `regular_season_ip` ← `reg_IP` ·
`ERA` ← `full_ERA` · `bf` ← `full_BF`. Plus: **remove the PATCH gate** (`:274`) so `k_pct`/`pull_air` fill for
everyone; **keep the 25 PA / 20 BF NEW-ROW gate** (`:469`); **fix `repRows` `:465`** → `"batter_id"` and stop
discarding `error` at `:451`.
**GATE (values, not counts):** `pa` avg **121.8 → ~128.0** · `regular_season_pa` ≈ today's `pa` (**median Δ 0.00**) ·
`regular_season_ip` **0 → 5,374** · a deep playoff team's **depth-role tier counts must NOT move**.
Then **re-run F44** so `ra9_r`/`fra9_r` stop landing NULL.

---
# §4 🛑 MISTAKES MADE — DO NOT REPEAT
- **A subagent with prod credentials called `refresh_composite_war()`** and wrote ~112k rows. → Subagents get STAGING only.
- **Pasted staging's `team_drs` into prod** instead of deriving it. Trevor caught it. → **Derive on prod, never copy.**
- **Changed Kozeal's `TeamID` to the "correct" season row** — split Arkansas into two teams (308→309). Staging was
  right. → **Adopt the `TeamID` a player's teammates already use.**
- **Two false alarms from MY OWN instrument:** (a) park-factor diff matched the CSV's `teamId` instead of `team` →
  reported "309 teams dropped" when it was **1**; (b) compared two derivations by **exact equality** → reported
  "1,306 hitters change" when the median Δ was **0.00**. → **Verify the instrument before reporting an alarm; report
  mean/median/p90/max, never a % exact match.**
- **Claimed docs were consistent having only checked my own edits** — a sweep found 12 more. → Verify, don't assert.
- **Marked a run COMPLETE by exit code** when a dimension had FAILED. → Validate by LOG CONTENT.
- **Nearly concluded off a truncated background log** (header missing). → Re-run with a full capture.
- **Rewrote documented steps instead of just reordering them.** → Reorder; do not redefine.

# §5 THE FOUR GATES THAT ACTUALLY CATCH THINGS
1. **VALUE** — did the number CHANGE? (Conf `Stuff_plus` 101.17→99.15 · `run_env_factor` 101.879→99.719 — both 30/30 before AND after)
2. **MEMBERSHIP** — diff the ID SET (caught Kozeal; `5,340 = 5,340` passed every count)
3. **CARDINALITY** — assert the GROUP count (D1 = 308 teams; the Σ-centering assertion held at 309)
4. **LOG-CONTENT** — read the body, never the exit code (`--create-new` exits 0 while creating nothing)

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
