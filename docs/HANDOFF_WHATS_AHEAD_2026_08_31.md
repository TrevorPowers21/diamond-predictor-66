# 🧭 HANDOFF — WHAT'S AHEAD. Written 2026-08-31 (end of day). **START HERE.**
Forward-looking companion to `docs/HANDOFF_2026_08_31_EOD.md` (current state) and
`docs/PLAN_finish_prod_push_2026_08_31.md` (step-by-step).

## 🚨 READ FIRST — THE ONE THING THAT MATTERS
**Every defect found in this push produced a populated table, a clean exit code, and a plausible number.**
Not one raised an error. See **"🚨🚨 SILENT-FAILURE REGISTRY"** (in every push doc) — 16 numbered entries, each with
where it belongs in Track B. **A stage that "ran fine" tells you nothing. Gate on VALUE, MEMBERSHIP, CARDINALITY and
LOG-CONTENT — never on counts or exit codes.**

---
# §1 WHERE WE ARE — PROD, verified in the DB
✅ **Phases A/B/C** · **Phase D** (D34 all 9 gates) · **E2** park + `derive_conf_opr_htp` re-run ·
**`game_string`** 0 → 2,576,146 (8,519 games = 55.3/team) · **`ip`/`ip_reg`** 0 → 5,415 ·
**Masters full-season** (`pa` 121.8→127.7, `regular_season_pa` 5,322, `regular_season_ip` 5,372, `bf` 5,372) ·
**`K9/BB9/HR9/WHIP/FIP` now pitch-log-derived** · **F44** `team_season_stats` 0 → 308 ·
**E35** `is_twp` 137 → 253 · **E36/E37** re-run REG-anchored · **E38** 13 teams × ~14,270 rows.
Plus: Kozeal's real row CREATED, Wiggins' phantom row DELETED, depth-role source fixed in **4 scripts**.

---
# §2 IMMEDIATELY AHEAD — FINISH THE PUSH (~half a day)
```
✅ F39  select refresh_composite_war();          DONE 2026-08-31 · 9.0s · d_war/bsr_war 200,754→201,221
       · identity total = o+d+bsr worst **0.000000** across 112,087 rows · avg total 0.3517→0.3549
       🚨 the transport is the point: DIRECT pg session / SQL editor ONLY, `set statement_timeout='15min'`
          (FINITE, never 0). Over PostgREST the ~125s gateway cuts it and the WHOLE UPDATE ROLLS BACK with no
          recognisable error. It ran in 9.0s — "it was fast" is NOT a reason to use the wrong transport.
       ✅ writes `player_predictions`, NOT the Masters (older runbook text is WRONG).

✅ F40  backfill-snapshot-total-hitter-war --apply   DONE · 696 snapshots · 0 orphans on all 4 JSON fields
✅ F41  rebuild-twp-target-rows  DONE 2026-08-31 (rebake-twp-markets DELETED · fix-returner-twp-hitter-market SKIPPED — JUCO only)
       🚨 **BLOCKED — DO NOT RUN.** Pre-flight audit 2026-08-31 found (a) F41a DELETEs+REINSERTs without
          `total_hitter_war`, STRIPPING what F40 just wrote (3 board rows measured), and (b) all three price the
          TWP hitter market off `o_war` while F39/F40 made `total_hitter_war` canonical everywhere else.
          **Both need Trevor's call.** Take `_tb_pre_f41_backup` first. See "F41 PRE-FLIGHT AUDIT (2026-08-31)".
✅ F41  rebuild-twp-target-rows ONLY — DONE 2026-08-31. ⛔ rebake-twp-markets DELETED (superseded by F42, priced at the WRONG conference). ⏭️ fix-returner-twp-hitter-market SKIPPED (all-JUCO, parked).
  F42  resync-build-snapshot-markets --all --apply · resync-target-snapshots --all --apply
       🚨 `--all` is REQUIRED — the default scope is a STAGING build id (0 rows on prod)
  F42b recompute-snapshot-hitter-market --prod --apply    (stale-PTM re-price; SEC builds ~2.6× up)
  F43  backfill-neutral-snapshot → heal-stale-snapshots
  G46  supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm
       🚨 NEVER --linked (config.toml names a THIRD ref kfkuhdmpchxyffmnowgj) · do NOT deploy recalculate-prediction
  →    preview-verify (Vercel preview points at PROD) → gh pr create staging→main → **Trevor merges** → Phase H drops
```
**⬜ STILL OWED AFTER THAT:** the **postseason-inclusive Master sheet import** — the CROSS-CHECK/OVERRIDE layer for the
fields the pitch log derives weakly (**SB, ERA, G/GS**). Order is derive-then-override, so it comes last.

---
# §3 THEN — STAGING CATCH-UP, **THROUGH TRACK B**
Staging never received C24/C26/C27/C28/C28b/C29. Trevor's decision: catch it up **after** the push and **via Track B**,
as Track B's first real exercise — not by hand-running six scripts.
⚠ Until then, **prod is AHEAD of staging** on: conference `*_plus` columns · `pitcher_ev*`/`iz*` (30/30 vs 0/30) ·
NCAA averages/SDs (C27) · ERA source · depth-role anchoring. **A prod↔staging mismatch is NOT automatically a prod
defect** — see the measured input-difference table ("WHY PROD AND STAGING PROJECTIONS DIFFER").

---
# §4 THE TRACK B BUILD — the real engineering ahead
Spec: `docs/PIPELINE_pitch_log_to_projections.md` → **"TRACK B — THE COMPLETE ARCHITECTURE"** + **"RULES ADDED
2026-08-31"** + the **19-stage CANONICAL RUN ORDER**.
```
pitch_log (DAILY)  →  pitch_log_*_totals = THE ACCUMULATOR (all raw counts, ONE place, rebuilt EVERY import)
                   →  Masters = DERIVED + DISPLAY (rates, ratings, WAR; NO raw counts)
                   →  TruMedia Master sheet (~MONTHLY) = CHECK/OVERRIDE only (SB, ERA, G/GS)
```
**WAR reads the accumulator and WRITES the Masters.** Reg/post = **lock once at the transition**, then the full-season
line keeps growing. ⛔ `lock_regular_season` is **OBSOLETE** — retire it.

## 🚨 THE SIX BUILD BLOCKERS, IN DEPENDENCY ORDER
| # | blocker | why it blocks |
|---|---|---|
| 1 | **`pitch_log_pitcher_totals` needs `R` / `ER`** | `desc_ra9` needs RA9. ⚠ **NOT a naive count** — the engine accrues it with **inherited-runner attribution, earned + unearned**. That logic must MOVE INTO the totals build, not be reimplemented. |
| 2 | **A `reg` window on the accumulator** (`dimension_key='reg'` or `*_reg` columns) | kills the last CSV dependency on the hitter side |
| 3 | **Fold defense + baserunning into the accumulator** | precedent exists: `pitch_log_hitter_totals` already carries `batting_rv`/`defensive_rv`/`baserunning_rv`. ⬜ **sequencing OPEN** — dRS is a heavy engine; daily stage vs periodic rebuild is undecided |
| 4 | **Re-point WAR at the DB** (registry #13) | a daily run has no TruMedia CSV |
| 5 | **Fix `repRows` `:465`** (registry #5) | 2027 opens with mostly NEW players — `--create-new` MUST work |
| 6 | **ONE boundary-date source** | `2026-05-18` is typed in `season_config.py` AND `refresh_team_season_stats`'s `p_reg_end`. ⬜ future: per-team SCHEDULES so each team's end date is known |
**Not worth chasing:** `G`/`GS` (no pitch-log source found; Trevor: *"almost positive the pitch log import has a
starting pitcher id"* — Track B flag) · SB (Master-override BY DESIGN) · `dob`/`class_year` (roster scraper) ·
`trackman_pitches` on `"Hitter Master"` (vestigial) · **recomputing prod WAR** (values verified correct).

---
# §5 🚨 THE RULES — earned, not theoretical
1. **ORDER BY THE DATA, NOT THE TOPIC.** The runbook's phases are a table of contents. The real order is "who reads
   whose column" — that audit moved F44 ahead of Phase E and invented `D33b`.
2. **PRESENCE IN A SEASON'S MASTER IS DECIDED BY THE PITCH LOG — BOTH WAYS.** Kozeal (data, no row) → CREATE.
   Wiggins (row, no data) → REMOVE. Never by returner/roster/portal status.
3. **GROUP TEAMS ON `source_id`**, never the per-season `TeamID`.
4. **GATE ON VALUE / MEMBERSHIP / CARDINALITY / LOG-CONTENT.** Never counts, never exit codes, never `updated_at`.
5. **A TRIPPED GUARD IS DATA.** The IP guard fired at 1.827 and the disagreement WAS the finding. **Fix the
   comparison, never the threshold.**
6. **VERIFY THE INSTRUMENT BEFORE REPORTING AN ALARM.** Six false alarms this session were ALL my measurement:
   wrong CSV column · exact-equality between derivations · `Number(null)` passing `isFinite` · raw mean over a
   tiny-denominator tail · guessed column names ×3 · a mislabeled aggregate. **Report mean/median/p90/max.**
7. **CHECK `git log -1 --format=%ad` BEFORE TRUSTING A FUNCTION.** A docstring matching your symptom is not evidence
   it is current — `refreshPaIpFromMaster` was 3 months stale. **5 legacy functions are now banner-marked in-file.**
8. **AFTER A RULE CHANGE, prod↔staging comparison is MEANINGLESS until BOTH run the new rule.** Proven twice
   (hitters 256→23, pitchers 81→10, ~91% collapse).
9. **VERIFY CONFIG THREE WAYS:** (a) the key EXISTS · (b) its value is FRESH for THIS env · (c) a code path READS it.
   "220 keys on both" answers only (a).
10. **WHEN A SHARED HELPER'S INPUT CHANGES, AUDIT EVERY CALLER.** Fixing the returner depth role did NOT fix the
    transfer one — 4 scripts, 2 needed changes.
11. **AUDIT BEFORE EACH STEP.** The 5-question pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) has found
    a real defect before **every** step it was applied to.

---
# §6 BACKUPS ON PROD (⛔ never drop)
`_hm_prefill_backup` (8,245) · `_pm_prefill_backup` (8,071) · `_pm_wiggins_backup` (1) ·
`_players_pre_twp_backup` (31,467) · `_confstats_backup` (162) · `_parkfactors_backup` (615) · `_c28_before` ·
`_v2_prechain_backup` (2,576,146).
⛔ **NEVER DROP:** `_reclass_result` · `_reclass_map` · `_reclass_pf` · `team_war_snapshots`.
🔑 Both `PGURI`s are SAVED (`.env.local` / `.env.production.local`) — **never ask for DB passwords**.

---
# ✅ F39 `refresh_composite_war()` — APPLIED TO PROD 2026-08-31 (9.0s)
Fired from the **DIRECT pg session** with `set statement_timeout = '15min'` (FINITE, never 0).
| | BEFORE | AFTER |
|---|---|---|
| `d_war` populated | 200,754 | **201,221** |
| `bsr_war` populated | 200,754 | **201,221** |
| `total_hitter_war` | 112,087 | 112,087 |
| avg `total_hitter_war` | 0.3517 | **0.3549** |
Filled **467** rows that lacked `d_war`/`bsr_war` and re-derived every total at ÷13.1.

## GATES — ALL PASS
```
identity total_hitter_war = o_war + d_war + bsr_war   worst 0.000000  (n=112,087)   ← EXACT to 6dp
rows with o_war but NULL total                        0
d_war / bsr_war centered                              avg d 0.0038 · bsr 0.0000 · range −1.24 … 2.49
returner totals                                       n=6,806 · avg 0.803 · max 6.86
```
★ `max total_hitter_war` **6.86** matches `max o_war` **6.86** on BOTH envs — the top of the distribution carries
through unchanged.

## 🚨 WHY THE TRANSPORT MATTERED
`supabase/migrations/20260810_composite_war_d1_rescale.sql:13` sets `statement_timeout = '180000'` **inside** the
function — the author signalling it can exceed the **~125s HTTP gateway ceiling**. `statement_timeout` does NOT raise
that ceiling: over PostgREST (`.rpc(...)`, the Supabase MCP, any HTTP client) the gateway cuts the connection and the
**WHOLE UPDATE ROLLS BACK**, usually with no error you would recognise as a rollback.
**It ran in 9.0s here — but "it was fast this time" is not a reason to use the wrong transport.**

## ✅ RUNBOOK CORRECTION CONFIRMED IN PRACTICE
`refresh_composite_war()` writes **`player_predictions`** (`d_war`, `bsr_war`, `total_hitter_war`) — **NOT the
Masters.** The Masters' Phase-D `d_war`/`bsr_war` are untouched. Older runbook text describing it as rewriting "the
descriptive Master" is WRONG.

---
# ✅ REGISTRY #17 — RESOLVED / NOT A DEFECT: unmeasured defense → 0 IS the correct default
Found by checking **ACCURACY**, not the identity (Trevor: *"check accuracy not just total"*). The identity
`total = o + d + bsr` held at **worst 0.000000 across 112,087 rows** — and proved nothing about whether `d` was
CORRECTLY SOURCED. It holds regardless of where `d` came from. **Exactly the "internally consistent but sourced
wrong" shape.**

## ✅ THE ACCURACY CHECK THAT DID MEAN SOMETHING
`player_predictions.d_war` vs `"Hitter Master".d_war` (the Phase-D descriptive value), joined via
`players.source_player_id`:
```
n = 72,726 · IDENTICAL 72,726 (100.0%) · median Δ 0.0002 · worst 0.000
bsr_war: n = 72,726 · IDENTICAL 72,726 (100.0%) · worst 0.000
```
★ **The projection side and the descriptive side derive the SAME number from the SAME source.** Correctly sourced.
✅ **This is intentional and correct:** `refresh_composite_war()` writes **`player_predictions`** (the PROJECTION
side); the Masters hold the **DESCRIPTIVE 2026** record from Phase D. Two different things that share column names —
the Masters are NOT touched, by design.

## 🚨 THE DEFECT — `coalesce(..., 0)` MAKES "NO DATA" LOOK LIKE "LEAGUE AVERAGE"
```sql
coalesce(d.dw, 0) as dw   -- Σ drs_floor WHERE position <> 'P' / 13.1
coalesce(b.bw, 0) as bw   -- wsb_runs / 13.1
```
A player with **NO row** in `player_season_defense` gets `d_war = 0`, stored **identically** to a player measured at
exactly 0.000. And `total_hitter_war = o_war + d_war + bsr_war`, so their total silently treats **unmeasured defense
as league-average**.
```
d_war = 0 rows                          133,816 of 201,221
  ├ NO defense row (coalesce default)    73,345   ← "unknown", stored as 0
  └ genuinely 0.000 from real data        60,471   ← measured
bsr_war = 0 with NO baserunning row       58,119
```
## SCOPE — 38 rows actually matter, not 73,345
| division | defaulted players | verdict |
|---|---|---|
| **NJCAA_D1** | **5,218** | ✅ **EXPECTED** — the dRS engine has no JUCO coverage |
| D1 | 1,286 | mostly low-PA |
| D2 | 2 | — |
★ **D1 players with ≥50 PA and NO defense row: 38** (avg **131.3 PA**, max **270 PA**).
**Those 38 are real contributors credited with exactly-average defense on no measurement.**

## ✅ RESOLVED 2026-08-31 — TREVOR'S CALL: **THIS IS CORRECT, LEAVE IT**
> *"JUCO and historical will not get dWAR and bsrWAR so we will only be filling that in moving forward. I would say
> just be consistent. Unmeasured defense should probably just be net 0 which should be league average correct?"*
**YES — and that resolves it.** `drs_floor` is a **runs-ABOVE-AVERAGE** metric, so **net 0 IS league average**.
Coalescing an unmeasured player to 0 assigns him **league-average defense**, which is the correct and CONSISTENT
neutral prior for a projection. It is NOT a wrong value dressed as data.
🛑 **THIS IS THE OPPOSITE OF [[feedback_zero_is_missing_not_a_value]].** That rule applies where 0 is an IMPOSSIBLE
measurement (an exact-0 scouting % means "not measured" — nobody has a true 0% chase rate). Here 0 is a **meaningful,
attainable value** — the centre of the scale. **Distinguish the two cases by asking: is 0 a value the metric can
legitimately take? If yes, a 0 default is a prior. If no, it is missing data.**
✅ **JUCO (5,218) and historical players will never get dWAR/bsrWAR** — coverage begins going forward. Expected.
✅ The **38 D1 players with ≥50 PA and no defense row** get a league-average prior. Consistent with everyone else.
🅱️ **TRACK B:** keep the `coalesce(…, 0)` — it is the intended neutral prior. **Do NOT "fix" it to NULL.**
---
# ✅ F40 SNAPSHOT `total_hitter_war` BACKFILL — APPLIED TO PROD 2026-08-31
`npx tsx --env-file=.env.production.local scripts/backfill-snapshot-total-hitter-war.ts --prod --apply`
Backups first: `_tbp_pre_f40_backup` (1,470) · `_tb_pre_f40_backup` (184).
**`APPLIED: filled total_hitter_war on 696 snapshots.`** · d/bsr map resolved **520 of 522** snapshot players.

## GATES — ALL PASS
```
team_build_players: o_war present but total NULL   0 / 0   (player_snapshot / neutral_snapshot)
target_board:       o_war present but total NULL   0 / 0   (transfer_snapshot / neutral_snapshot)
identity total = o_war + d_war + bsr_war           worst 0.000000  (n=612)
values                                              n=612 · avg 1.053 · max 4.35
```
★ **Zero orphans on ALL FOUR snapshot JSON fields** — that is the documented gate ("0 snapshots with `o_war` but NULL
`total_hitter_war`"), met on every one.
✅ The **2 of 522** players absent from the d/bsr map take the **league-average 0 prior** — correct per REGISTRY #17
(`drs_floor` is runs-above-average, so 0 IS average). **Not a gap.**

## 🚨 THIS STEP WAS ONLY RUNNABLE BECAUSE OF THE MORNING'S GUARD FIX
`scripts/backfill-snapshot-total-hitter-war.ts` had **NO env guard at all** — `process.env.SUPABASE_URL` with **no
`--prod` flag anywhere** (`grep -c` = 0/0), so `--env-file` pointed at prod would have written prod with **zero
opt-in**, and the only signal was a `host` banner printed AFTER the client was constructed. **SIXTH instance** of that
defect class (after `_run_store_no_propagate`, both C28 producers, the market scripts, `run-twp-recompute` E35 and
`backfill_park_factors_seasonal` E2). Guard added + all four paths verified before this run.

---
# 🔍🚨 F41 PRE-FLIGHT AUDIT (2026-08-31) — **RUN NOTHING YET. TWO FINDINGS NEED TREVOR'S CALL.**
Ran the 5-question pre-flight (LANE · GUARD · ORDER · SILENT FALLBACK · BACKUP) against all three F41 scripts before
executing. **It found a defect before this step, exactly as it has before every step it has been applied to.**
F41 = `rebuild-twp-target-rows` (F41a) · `rebake-twp-markets` (F41b) · `fix-returner-twp-hitter-market` (F41c).

## 🚨 FINDING 1 — **F41a WILL DESTROY THE `total_hitter_war` F40 WROTE THIS MORNING.** DO NOT RUN IT AS-IS.
`scripts/rebuild-twp-target-rows.ts` **DELETEs** a TWP's `target_board` rows for the team and **REINSERTS exactly two**
from its own row builders. Those builders do **not carry `total_hitter_war`**:
```ts
:28  hitterFromRoster = (ps) => ({ is_twp:true, …, owar: ps.o_war, o_war: ps.o_war, twp_hitter_market_value: … })
:30  hitterFromPred   = (p)  => ({ is_twp:true, …, owar: p.o_war,  o_war: p.o_war,  twp_hitter_market_value: … })
:44  const F = "player_id,…,p_war,o_war,hitter_depth_role,pitcher_depth_role,twp_hitter_market_value,…"
```
**`total_hitter_war` appears in NEITHER builder NOR the `F` select list.** So the reinserted rows come back without it.
**MEASURED ON PROD — the exact rows that would be stripped:**
| board row | player | slot | `o_war` | **`total_hitter_war`** | after F41a |
|---|---|---|---|---|---|
| `a37d96ca…` | Gio Colasante | IF | 0.9238 | **1.0210** | ❌ **NULL** |
| `fd02d8d7…` | Aiden Mouton | *(null slot)* | null | **1.4548** | ❌ **NULL** |
| `0ea09bd0…` | Josiah Overbeek | 1B | 2.0082 | **2.0489** | ❌ **NULL** |
| `91755956…` / `718c9dd7…` | Colasante SP · Overbeek RP | pitcher slots | null | null | — |
★ **THIS DIRECTLY RE-BREAKS F40's OWN DOCUMENTED GATE** — *"0 snapshots with `o_war` but NULL `total_hitter_war`"*,
which passed **0 / 0 on all four snapshot JSON fields** hours earlier. Running F41a silently reverts it for TWPs.
⚠ **Blast radius is SMALL (3 rows) but the shape is the dangerous one:** the script exits 0, the board still renders,
the rows still hold `o_war` and a market value — **nothing errors, and no count gate can see it** (the row count is
unchanged; only a field inside the JSON goes missing). Same family as registry #4/#16.
⚠ Note **Aiden Mouton's row has `position_slot = NULL`** while F41a's contract is *"exactly TWO own-side rows (hitter
slot + pitcher slot)"* — so that row is not merely rewritten, it is **replaced by a differently-keyed pair.** What his
null-slot row represents has **NOT** been determined. ⬜ **Do not assume it is safe to discard.**
### ⬜ OPTIONS — TREVOR'S CALL, NOT MINE
1. **Add `total_hitter_war` to both builders + the `F` select list** (3-line change), then run. Keeps F40 intact.
2. **Run F41a, then re-run F40** to refill. Works, but leaves a window where the board is wrong and depends on F40
   being re-run — the kind of implicit ordering this push exists to eliminate.
3. **Skip F41a**, run only F41b/F41c. Only valid if the board rows are already correctly shaped — **unverified.**
🛑 **Whichever is chosen, take a fresh backup first.** `_tb_pre_f40_backup` (184) is a **PRE-F40** snapshot, so
restoring from it would ALSO lose F40's fill. **`create table _tb_pre_f41_backup as select * from target_board;` first.**

## 🚨 FINDING 2 — ALL THREE PRICE THE TWP HITTER MARKET OFF `o_war`, NOT `total_hitter_war`
Verified in code, not inferred:
```
rebake-twp-markets.ts:34   hMkt = (owar,p) => computeHitterMarketValue(Number(owar), {conference,position})
rebake-twp-markets.ts:44   twp_hitter_market_value: hMkt(s.o_war ?? s.owar, p)
rebake-twp-markets.ts:57   ns.twp_hitter_market_value = hMkt(s.o_war, p)
fix-returner-twp-hitter-market.ts:86   computeHitterMarketValue(Number(r.o_war), {…})
```
This was logged as a **MEDIUM** "half-shipped" item long before this push (`BRANCHWIDE` §4.2). **It is now worse than
when it was written:** F39 and F40 — both applied 2026-08-31 — made `total_hitter_war = o_war + d_war + bsr_war` the
canonical pricing basis for **every non-TWP hitter and the entire transfer path**. So F41 no longer *leaves* a split
basis; it **actively creates one**, on the very day the rest of the system was unified.
**MEASURED UNDERPRICING on the two TWPs on the board:**
`Overbeek o_war 2.008 vs total 2.049 (−2.0%)` · `Colasante 0.924 vs 1.021 (−9.5%)`.
✅ The inputs exist — F39 filled `d_war`/`bsr_war` on **201,221** rows, and TWP rows carry them.
⬜ **OPEN — needs Trevor's call.** Same class of question as F42b (which explicitly *does* price off `total_hitter_war`).

## ✅ FINDING 3 — THE "UNORDERED `.range()` IS BENIGN" NOTE IS **CORRECT, BUT ITS INVENTORY WAS WRONG**
Re-verified because `is_twp` moved **137 → 253** in E35, which invalidated the counts the old note was based on.
| table | rows | how it is read | exposure |
|---|---|---|---|
| `players` (`is_twp=true`) | **253** | `.range()` `:31` | ✅ single page |
| `target_board` | **184** | `.range()` `:39` | ✅ single page |
| `"Teams Table"` | 774 | **not a `.range()` read in this script** | ⚠ **the old note listed it in error** |
| **`team_build_players`** | **1,470 — OVER the 1000 page size** | `.in("player_id", batch)` @ 100 ids `:52` | ✅ **not `.range()`**; TWPs hold **23 rows total, max 7 per player** ⇒ ~7×100 worst case, far under the 1000 cap |
★ **The conclusion held, but for a reason the note did not state, and it omitted the one table that actually exceeds
the page size.** A future reader "re-checking if any crosses 1000" would have checked the wrong three tables and
missed `team_build_players` entirely. **Corrected inline everywhere.**

## ✅ FINDING 4 — F41c's TARGET DEFECT IS REAL AND STILL PRESENT (the script IS needed)
Its header claims the returner precompute historically wrote the hitter market into the **shared** `market_value`
column for TWPs, where it should be NULL. **Confirmed on prod — E37's re-run did NOT stop this:**
```
is_twp returner/regular rows (2027)        253
  ├ shared market_value NON-NULL            110   ← should be NULL
  ├ twp_hitter_market_value set              87
  └ twp_pitcher_market_value set             90
is_twp rows across ALL seasons/models with market_value set   2,372
```
✅ **So F41c has genuine work to do.** ⚠ But note it **writes `player_predictions`**, which F39 also wrote — confirm
it only touches `market_value` / `twp_hitter_market_value` and not the WAR columns.

## ✅ FINDING 5 — GUARDS ARE PRESENT ON ALL THREE (the old "no `--prod`" note is STALE)
`guard=1 prodflag=3` on each of `rebuild-twp-target-rows.ts`, `rebake-twp-markets.ts` *(since DELETED)*,
`fix-returner-twp-hitter-market.ts`, all last touched 2026-08-30. ⚠ Still **invoke directly — none is an npm script.**

## 🅱️ WHAT TRACK B MUST TAKE FROM THIS
1. **A DELETE + REINSERT stage MUST reinsert every field it deleted.** F41a's builders are a hand-maintained column
   list that silently drifted behind the schema the moment F40 added a field. **Track B must never rebuild a JSON
   snapshot from a hand-listed field set** — round-trip the existing object and overwrite only what the stage owns
   (which is exactly what `rebake-twp-markets.ts:44,55` does correctly with `{...s}`). **F41a is the counter-example.**
2. **ONE PRICING BASIS.** `total_hitter_war` is canonical after F39/F40. Any stage still pricing off `o_war` is a
   latent split. Assert `market_value` and `twp_hitter_market_value` derive from the same WAR column, system-wide.
3. **A BACKUP TAKEN BEFORE THE PREVIOUS STEP IS NOT A BACKUP FOR THIS ONE.** `_tb_pre_f40_backup` predates F40's
   writes, so it cannot serve as F41's restore point. **Snapshot immediately before each destructive stage.**
4. **RE-VERIFY A "BENIGN" PAGINATION NOTE WHENEVER ITS DRIVING COUNT CHANGES.** `is_twp` 137 → 253 invalidated the
   basis of the old note; the conclusion survived, the reasoning did not.

## ✅✅ RESOLUTION (2026-08-31) — **THE BUG WAS IN THE ENGINE, NOT IN F41. FIXED AT SOURCE.**
Trevor: *"the way the process works is supposed to be run through the transfer engine and all of the market values
display the market value for the program they are projected to, so that is a bug in it and needs to be solved. Are you
sure that is the process in order and actually what runs or only what runs for returners?"* — **He was right to ask.
F41 is not the process; it is a repair step that existed only because the engine skipped a case.**

### THE FOUR PROJECTION PATHS — three routed TWP markets correctly, ONE did not
| path | prices off | conference used | routes TWP → `twp_*` |
|---|---|---|---|
| returner hitter — `backfill-2027-hitter-returners.ts:306,327` | `total_hitter_war` ✅ | own program ✅ | ✅ |
| returner pitcher — `precompute-returner-pitchers.ts:517` → `predictionEngine.ts:57-61` | — | own ✅ | ✅ |
| transfer pitcher — `precompute-pitchers.ts:539` → `predictionEngine.ts:57-61` | — | **destination** ✅ | ✅ |
| **transfer hitter — `precompute-transfer-projections.ts:425`** | `total_hitter_war` ✅ | **destination** ✅ | ❌ **MISSING** |
★ The transfer hitter engine was **already pricing correctly** — `computeHitterMarketValue(totalHitterWar, {conference: toConference, …})`. Its ONLY defect was writing the result to the shared `market_value` instead of `twp_hitter_market_value`.
★ **The returner file's own comment claimed this was "the same convention as the transfer precompute."** It was aspirational — the transfer side never implemented it. **A comment asserting that another file does something is not evidence that it does.**

### THE USER-VISIBLE COST — measured on prod BEFORE the fix
`pickHitterMarketValue` (`src/lib/twpMarketValue.ts:25`) returns `twp_hitter_market_value` whenever `is_twp` is true and **never falls back to `market_value`**. So a TWP priced into the shared column renders **BLANK**:
```
model_type            rows    shared_mv set   twp_h set   HITTER SHOWS BLANK
returner/regular       253            110          87            110
transfer/precomputed  3,285         2,119       1,101          2,119
                                                              ─────
                                                              2,229 TWP hitter rows with NO market value on screen
```
🛑 **A COUNT GATE PASSES ON EVERY ONE OF THESE.** `market_value` was populated with a correct, sensibly-priced number. Nothing was null, nothing errored — the number was simply in the column nobody reads. **This is the "populated, plausible, and in the wrong place" shape.**

### 🛑 WHY THE DOWNSTREAM REPAIR (F41b) WAS ITSELF THE BUG
`rebake-twp-markets.ts` re-derived the hitter market from `players.conference` — the player's CURRENT school. But a target-board market must answer *"what is he worth to the program recruiting him?"*, and **only stage 18 knows that destination.** Measured:
| player | his conference | recruiting program | program conf | stored (engine, correct) | F41b would rewrite to |
|---|---|---|---|---|---|
| Josiah Overbeek | Patriot League | Arkansas | **SEC** | **$75,307** | **$25,611** (−66%) |
| Gio Colasante | Ivy League | Georgia | **SEC** | **$38,106** | **$14,038** (−63%) |
`SEC 4.0 ÷ Patriot ~1.36 = 2.94×` — exactly the observed drop. ★ **This was NOT caused by the `o_war` → `total_hitter_war` change (that moves values +2%); it is a pre-existing landmine that only becomes visible when the script RUNS.**
✅ **RULE: NEVER re-derive downstream a value the engine already computed with context the downstream stage does not have.** A repair step that recomputes rather than *carries* is a silent downgrade.

### ✅ THE FIX APPLIED — `precompute-transfer-projections.ts:465-466`
```ts
market_value: (p as any).is_twp ? null : marketValue,
...((p as any).is_twp ? { twp_hitter_market_value: marketValue } : {}),
```
Mirrors `backfill-2027-hitter-returners.ts:327` exactly. `p` is the player row and already carries `is_twp` (used at `:250` in the same loop's filter; selected at `:236`). `tsc -p tsconfig.app.json` — no new errors.

### ▶️ CONSEQUENCES FOR THE F41 STEP — IT SHRINKS
| script | verdict |
|---|---|
| **F41a `rebuild-twp-target-rows`** | ✅ **KEEPS ITS REAL JOB** — splitting a newly-flagged TWP's single board row into two own-side rows (e.g. Aiden Mouton, flagged by E35 today). Now also carries `total_hitter_war` through (REGISTRY #18). Once the engine is correct it no longer needs F41b behind it to repair markets, so **F41a + F41b collapse to a single step** (Trevor: *"can this be 1 process"*). |
| **F41b `rebake-twp-markets`** | 🗑️ **DELETED 2026-08-31 (whole script, not just the hitter half).** Further investigation showed F42a/F42b write the SAME two tables (`team_build_players`, `target_board`) at the **build program's** conference — so it is fully superseded, and its player-conference pricing would have destroyed stage 18's destination-priced value. ♻️ `git show 9c61e7d:scripts/rebake-twp-markets.ts` |
| **F41c `fix-returner-twp-hitter-market`** | ✅ **STILL NEEDED, but only ~110 returner rows.** The returner engine routes correctly; these are TWPs whose returner rows were never RECOMPUTED (E37 patches only what it computes, so blocked players keep pre-TWP values). Legitimate one-time catch-up. |

### ✅ TWP CONVENTION — CONFIRMED BY TREVOR, NOT ASSUMED
> *"the nil valuation should be null for twp and the twp should be checking is twp = true whether it shows the twp hitter/pitcher market value and is twp = false should show the correct market values."*
Matches the code exactly (`twpMarketValue.ts:25,34`). **`nil_valuation` is NULL for TWPs by design** — every TWP builder sets it explicitly. The two sides are **never summed** into one figure on a side-specific surface. `total_hitter_war` respects this: it is `o_war + d_war + bsr_war` with **no `p_war`**, so pricing the hitter side off it never merges the pitcher side.

### 🅱️ TRACK B — THE STAGE-18 REQUIREMENT THIS CREATES
Trevor: *"the thing we probably need to run in track B is the fact that these need to be done in the correct steps so we dont get to this point and have these shortcomings."*
1. **Every projection path routes TWP markets identically.** Assert it as a gate: `is_twp AND market_value IS NOT NULL` must return **ZERO ROWS** after stage 18, on every model_type.
2. **Price at the DESTINATION program's conference** for transfer rows, the player's own for returners. Never re-derive later.
3. **When N sibling paths implement a convention, diff ALL N.** Three of four had it; the outlier was invisible because its output looked perfectly normal. `grep` every caller, do not trust a comment.

## 🛑 SCOPE RULE — **D1 NCAA IS THE CONSISTENCY BOUNDARY. JUCO IS PARKED.** (Trevor, 2026-08-31)
> *"we are gonna do a full juco restructure with moving databases and bunching them in with some D2 and D3 stuff so
> anything JUCO related is gonna be tricky or wrong. The consistency is all in D1 NCAA."*

**⛔ DO NOT "FIX" JUCO DIVERGENCE. It is expected, not a defect, and a JUCO restructure will invalidate the work.**
A full JUCO rebuild is coming — **databases move, and JUCO gets grouped with D2/D3**. Until then JUCO values are
knowingly unreliable and any effort spent reconciling them is wasted twice: once now, once again after the move.

### THE CONCRETE CASE THAT ESTABLISHED THIS — 2,119 blank TWP hitter rows, DELIBERATELY LEFT
After the stage-18 TWP routing fix (REGISTRY #20), D1 came out perfect and JUCO did not:
| division | TWP transfer rows | shared `market_value` | `twp_hitter_market_value` | verdict |
|---|---|---|---|---|
| **D1** | **90 per team** | **0** ✅ | **90** ✅ | ✅ **FIXED — routes correctly, priced at destination tier** |
| **NJCAA_D1** | **163 per team** | **163** ❌ | **0** ❌ | 🅿️ **PARKED — 2,119 rows across 13 teams still render BLANK** |
**ROOT CAUSE — SCOPE, NOT A REGRESSION.** `precompute-transfer-projections.ts:243` defaults to **D1-only**
(`return div !== "NJCAA_D1"`), and `_run_step2_all.sh:30` has **never** passed `--division`. So the runner has always
been D1-only and the JUCO rows are stale from a historical `--division JUCO|ALL` pass. **The fix is correct; it simply
never ran against JUCO.** Running `--division JUCO` WOULD close all 2,119 — ⛔ **deliberately NOT done.**
ℹ Scale if it is ever revisited: **52,481 JUCO transfer rows**, none carrying `twp_hitter_market_value`. There is also
a `JUCO_PA_THRESHOLD = 75` floor on that path.

### 🅱️ WHAT THIS MEANS FOR TRACK B — GATES MUST BE DIVISION-SCOPED
1. **EVERY value/completeness gate scopes to `division = 'D1'` unless it exists specifically to test JUCO.** A gate run
   across all divisions will fail on JUCO forever and train the next agent to ignore it — which is how a REAL D1
   failure gets waved through. **A gate that always fails is worse than no gate.**
2. **A prod↔staging or expected-vs-actual mismatch on JUCO is NOT evidence of a defect.** Check `division` BEFORE
   opening an investigation. This joins the existing ordering of causes ("which env is behind?") as a first question.
3. **Keep the D1 and JUCO lanes separate in code** — already the standing rule (C24 `trackman_pitches`,
   Conference Stuff+ D1/JUCO fallback, [[feedback_juco_uses_d1_baselines]]). This confirms it at the GATE layer too.
4. ⬜ **On the restructure:** JUCO moves databases and merges with D2/D3. Anything keyed on `division='NJCAA_D1'`,
   the JUCO district conference IDs (`JUCO_DISTRICT_CONFERENCE_ID`), or the JUCO PA/IP floors will need revisiting
   **then** — not now.

---
# ✅ F41 — EXECUTED AND CLOSED 2026-08-31. **THE STEP SHRANK FROM THREE SCRIPTS TO ONE.**
Outcome of the pre-flight audit + the stage-18 engine fix. **F41 is no longer "run three market scripts".**

| was | now | why |
|---|---|---|
| **F41a `rebuild-twp-target-rows`** | ✅ **RAN — the only surviving piece** | It is the ONLY producer that refreshes a TWP's board rows FROM `player_predictions`. F42 re-prices stored WAR but explicitly does **not** re-copy from predictions, so without F41a a TWP's board WAR stays stale forever. |
| **F41b `rebake-twp-markets`** | 🗑️ **DELETED** | **Fully superseded by F42**, which writes the SAME two tables (`target_board`, `team_build_players`) at the **build program's conference** — the correct basis. F41b priced at the **player's own** conference and would have cut TWP hitter markets **~65%** (measured), destroying the destination-priced value stage 18 computes. ♻️ `git show 9c61e7d:scripts/rebake-twp-markets.ts` |
| **F41c `fix-returner-twp-hitter-market`** | ⏭️ **SKIPPED — nothing left for it to do on D1** | Split by division: **D1 90 rows already correct** (0 shared / 87 routed — E37's re-run did it properly). **All 110 rows it would still write are JUCO**, which is PARKED. |

## ▶️ F41a RESULT (prod, 3 TWP groups, `✅ applied`)
Backup taken first: **`_tb_pre_f41_backup` (184 rows)** — post-F40, so unlike `_tb_pre_f40_backup` it CAN restore F40's fill.
```
Gio Colasante  @Georgia  [roster]: IF owar 0.9238 twpH 38,106  | SP pwar 1.3073 twpP 0
Aiden Mouton   @Kansas   [pred]  : IF owar 1.4548 twpH —       | RP pwar —      twpP —     (JUCO — parked)
Josiah Overbeek@Arkansas [pred]  : 1B owar 2.2848 twpH 232,576 | RP pwar 0.2084 twpP 20,840
```
★ **Overbeek $75,307 → $232,576.** Not inflation — his board row was carrying a value priced at **Patriot League**'s
tier while **Arkansas is SEC**. Stage 18 now prices at the destination and F41a carried it onto the board.
★ **Aiden Mouton was the reason F41a exists:** E35 flagged him TWP today, so his board row was still a SINGLE
non-TWP row (`is_twp:"false"` inside the snapshot). He is now correctly split into two own-side rows. His markets are
blank because he is **NJCAA_D1 — parked**, not because anything failed.

## ✅ GATES — ALL PASS
```
REGISTRY #18  total_hitter_war SURVIVED the delete+reinsert   Colasante 1.0210 · Mouton 1.4548 · Overbeek 2.3258
F40's gate re-asserted, ALL 185 board rows                    transfer_orphans 0 · neutral_orphans 0
CARDINALITY   every TWP = exactly 2 rows per team             3 groups, all at 2
nil_valuation NULL on every TWP row                           ✅ per Trevor's rule
board rows 184 → 185                                          Mouton's single row became two
```
⚠ **Colasante's SP slot shows `twpP = 0`** — carried from his roster snapshot, which stores 0. **F42 re-prices it from
the stored `p_war` 1.3073 at the program tier**, so it resolves at F42. Do NOT hand-patch it.

## 🛑 THE SEQUENCING LESSON — **F41a MUST PRECEDE F42, AND FOR A NON-OBVIOUS REASON**
F41a **copies** market values; F42 **computes** them. Between the two, a TWP's board can legitimately show `$0`/blank
(Colasante's SP slot right now). **They are one logical operation split across two steps.**
🅱️ **TRACK B:** the board refresh must be **ONE stage** — re-copy WAR from predictions, THEN re-price at the program
tier, with no committed state in between. Trevor: *"can this be 1 process."* **Yes — and it must be.**

## 🧠 WHAT THE F41 AUDIT ACTUALLY BOUGHT
Three scripts were queued to run. After auditing: **one ran, one was deleted as actively harmful, one was skipped as
having no D1 work left.** Had the queue been run as written it would have (a) stripped `total_hitter_war` off every
TWP board row, re-breaking F40's gate, and (b) cut TWP hitter markets ~65% by re-pricing at the wrong conference.
★ **Neither would have raised an error.** ★ **And the root cause was upstream in stage 18 — the repair scripts existed
only because the engine skipped a case.** *Audit the step before running it; then ask why the step exists at all.*

---
# 🛑 GATE CORRECTION (2026-08-31) — **"NO MARKET > $130k/win" IS NOT A RULE. STOP TREATING IT AS ONE.**
Trevor: *"don't draw a line in the sand like that. The math will work as long as the values stay consistent. That is
the point of 4.0 PTM and 1.3 PVM — it doesn't need to be a threshold that stays within, cause it could be confusing
over time with **total market value vs per win**, and I worry about that more than anything."*

## WHERE $130,000 ACTUALLY CAME FROM — it is an OUTPUT of the formula, not a constraint on it
```
DEFAULT_NIL_BASE_PER_WAR = 25,000   (src/lib/nilProgramSpecific.ts:26)
SEC PTM                  = 4.0      (:10  — the highest program tier)
PVM for C / SS / CF      = 1.3      (:82  — the highest position multiplier)
25,000 × 4.0 × 1.3       = 130,000
```
**Nobody chose $130k.** It is simply the largest number the equation can emit per win. As a gate it is close to
tautological: it can only fail if SEC rises above 4.0, a PVM above 1.3 appears, or the base moves off $25,000 — i.e.
it detects **config drift**, and nothing about whether a market value is sensible. A badly wrong price sails straight
through it so long as its multipliers are in range.

## 🚨 THE REAL RISK IT CREATES — **TOTAL vs PER-WIN CONFUSION**
A "$130k" figure floating in the docs invites the reader to compare it against a **TOTAL** market value. Live example
from this push: **Josiah Overbeek is $232,576 TOTAL at $100,000 PER WIN.** Judged against "the $130k ceiling" that
looks like a 79% breach; it is nothing of the sort. **The two quantities differ by a factor of the player's WAR.**
✅ **RULE: always state the UNIT. Write `$/win` or `total`, never a bare dollar figure**, and never compare across the
two. I made exactly this error while reporting F42 and had to walk it back.

## ✅ THE GATE THAT REPLACES IT — AN IDENTITY, NOT A THRESHOLD
Assert the market is an EXACT function of the displayed WAR at the row's own multipliers:
```
market_value / total_hitter_war  ==  25,000 × PTM(program conference) × PVM(position)
```
**Magnitude-agnostic** (no line to drift over), **unit-unambiguous** (it is explicitly a rate, formed as a ratio), and
it catches what actually goes wrong: the **wrong conference** (the F41b defect — player's own instead of the
destination's), the wrong position, a stale base, or a market that is not derived from the WAR on display.
### ✅ MEASURED ON PROD 2026-08-31 — every conference lands on EXACTLY 3 rates, to the dollar
| conference | PTM | observed `$/win` (= 25,000 × PTM × {1.0, 1.1, 1.3}) | distinct rates | rows |
|---|---|---|---|---|
| SEC | 4.0 | **100,000 / 110,000 / 130,000** | 3 | 119 |
| ACC | 1.5 | **37,500 / 41,250 / 48,750** | 3 | 11 |
| Big 12 | 1.2 | **30,000 / 33,000 / 39,000** | 3 | 167 |
| Big Ten | 1.0 | **25,000 / 27,500 / 32,500** | 3 | 38 |
★ **`distinct_rates = 3` per conference is the strongest part of the assertion** — exactly the three position tiers,
no strays. A single row priced off the wrong conference or a defaulted PVM shows up as a 4th rate immediately.

## 🅱️ TRACK B
1. **Replace the `> $130k/win` check with the identity above.** Fail on any rate that is not `25,000 × PTM × PVM` for
   that row's own program and position; assert **≤ 3 distinct rates per conference**.
2. **Never gate on a magnitude derived from the model's own constants.** A bound computed from the same multipliers
   the stage uses cannot detect an error in those multipliers — it moves with them.
3. **Label every dollar figure `total` or `$/win`.** This is a display and documentation rule, not just a gate rule.

---
# 🚨 REGISTRY #21 — **THE SNAPSHOT CARRIES ITS OWN `is_twp` COPY, AND NOTHING KEEPS IT IN SYNC** (2026-08-31)
Trevor: *"that needs to be null because it will create confusion with the code."* — Correct, and the single bad row is
the visible tip of a **denormalization defect**, not a one-off.

## THE MECHANISM
Both F42 producers branch on **`s.is_twp` — the flag stored INSIDE the JSON snapshot** — never on `players.is_twp`:
```ts
resync-build-snapshot-markets.ts:64    const isTwp = !!s.is_twp, …
                              :70-71   if (isTwp) { …twp_hitter_market_value… } else { …market_value… }
recompute-snapshot-hitter-market.ts:62 const isTwp = !!s.is_twp;
                                   :64 const field = isTwp ? "twp_hitter_market_value" : "market_value";
```
**E35 flipped `players.is_twp` 137 → 253 on 2026-08-31. The snapshots were never updated.** So any snapshot written
before E35 still says `is_twp: false` / omits it entirely, and every downstream producer keying off it routes the
player's dollars to the **WRONG COLUMN** — while the display layer (`pickHitterMarketValue`) reads `players.is_twp`
and looks in the OTHER one. Result: a correct number, in the wrong field, rendering blank or double.

## SCOPE — MEASURED, AND SMALL (because F41a rebuilt the board rows)
| surface | snapshot `is_twp` = true | **ABSENT/false** | shared `market_value` wrongly set |
|---|---|---|---|
| `target_board` | **6 / 6** ✅ | 0 | 0 ✅ |
| `team_build_players` | 21 | **2** | **1** |
★ `target_board` is clean **only because F41a rebuilt those rows today** and its builders hardcode `is_twp: true`.
The build snapshots were never rebuilt, so they kept the stale flag.
### THE ONE BAD ROW
```
Gio Colasante [IF]  snapshot is_twp: (absent)
  market_value            $112,305   ← CORRECT value ($/win 110,000 = 25,000 × SEC 4.0 × IF 1.1 × total_hw 1.0210)
                                        but in the SHARED column, which must be NULL for a TWP
  twp_hitter_market_value  $38,106   ← STALE (priced at Ivy League, his OWN conference, pre-fix)
```
🛑 **The two columns DISAGREE by 2.9× — the exact PTM ratio from REGISTRY #19.** The correct dollars are sitting in the
column the code will not read for a TWP, and the column it WILL read holds the old wrong-conference value.

## ★ THIS IS THE SIXTH INSTANCE OF ONE SHAPE
*the VALUE moved to one place, a supporting FLAG/INPUT stayed on another* — after C24 `trackman_pitches`,
`computeNcaaAverages` weighting, Conference `Stuff_plus`, F44's `TeamID`, and `players.pa` vs `"Hitter Master".pa`
(REGISTRY #9). **A denormalized copy with no writer to keep it fresh is the recurring defect of this codebase.**

## ✅ THE REAL FIX — READ THE SOURCE OF TRUTH, DO NOT SYNC ANOTHER COPY
Exactly the resolution Trevor chose for `players.pa` (*"just change what column is read, not filling another column"*):
**every producer must branch on `players.is_twp`, joined at read time — never on the snapshot's embedded copy.**
⬜ **CODE CHANGE REQUIRED in both F42 producers** (`resync-build-snapshot-markets.ts:64`,
`recompute-snapshot-hitter-market.ts:62`). They already fetch `players` for `position`, so the flag is one column away.
⛔ **Do NOT "fix" this by back-filling `is_twp` into every snapshot** — that creates a seventh copy to go stale.

## 🅱️ TRACK B — STAGE 19
1. **NEVER branch on a flag embedded in a snapshot.** Join to the owning table at read time. A snapshot is a
   point-in-time *record of values*, not a source of truth for *identity*.
2. **GATE:** `players.is_twp = true AND snapshot->>'market_value' IS NOT NULL` must return **ZERO ROWS** on both
   `team_build_players` and `target_board`, on every run.
3. **Corollary gate:** the snapshot's own `is_twp` must AGREE with `players.is_twp`, or the snapshot is stale —
   assert it rather than trusting it.

## ✅ REGISTRY #21 — FIXED IN CODE AND APPLIED TO PROD (2026-08-31)
Trevor: *"no question this needs to be the process and needs to be consistent."* — and *"am I supposed to run the
SQL?"* **No.** A hand-written SQL patch would have fixed one row and left the defect live. **The code change makes the
producers self-correcting**, so the same run that re-prices also repairs — which is why no SQL was needed.

### THE CHANGE — both F42 producers now branch on `players.is_twp`
```ts
resync-build-snapshot-markets.ts:57   .select("id, first_name, last_name, position, is_twp")   ← + is_twp
                                :64   const isTwp = playerTwp.get(r.player_id) === true;        ← was !!s.is_twp
                                :66   if (isTwp && s.market_value != null) { s.market_value = null; s.is_twp = true; }
recompute-snapshot-hitter-market.ts:50 .select("… position, is_twp")                            ← + is_twp
                                   :62 const isTwp = playerTwp.get(r.player_id) === true;       ← was !!s.is_twp
                                   :70 if (isTwp) { s.market_value = null; s.is_twp = true; }
```
Plus a `staleShared` condition so **a TWP holding a non-null shared `market_value` counts as a change even when the
dollars in its own column are already correct** — otherwise the repair silently no-ops on rows whose value happens to
match. `tsc -p tsconfig.app.json` — no new errors.

### RESULT ON PROD
```
F42b  applied 3   Gio Colasante [IF] SEC  twp_hitter_market_value $38,106 → $112,305  ($110,000/win)
F42a  applied 1   shared market_value nulled
GATE  TWP rows carrying a shared market_value:  team_build_players 0 · target_board 0   ✅
      identity intact — every conference still ≤3 distinct $/win rates, 0 negatives      ✅
```
★ Colasante's board and build hitter rows now **agree at $112,305**, in the column the display layer actually reads.

## ⚠️ NEW GAP FOUND BY THE GATE — **NOTHING RE-DERIVES PITCHER MARKETS ON *BUILD* SNAPSHOTS**
The same check exposed a surface asymmetry that predates this work:
```
Gio Colasante [SP]   target_board  twp_pitcher_market_value  $130,733   ← re-derived by resync-target-snapshots
                     team_build_players                          $0     ← never re-derived by anything
```
| surface | hitter market | pitcher market |
|---|---|---|
| `target_board` | ✅ `resync-target-snapshots` fully re-derives | ✅ fully re-derives |
| `team_build_players` | ✅ `recompute-snapshot-hitter-market` | ❌ **NO PRODUCER** |
`resync-build-snapshot-markets` deliberately only floors NON-POSITIVE WAR to $0 — its own comment: *"Positive-WAR
markets depend on position … we leave those to the app's live bake, never guess here."* So a positive-WAR pitcher on a
build snapshot keeps whatever stale dollars it had — here **$0 against a real `p_war` of 1.3073**.
⬜ **OPEN — NOT FIXED.** Two readings, and it needs Trevor's call: (a) the app's live bake genuinely repairs this on
render, making the stored $0 harmless; or (b) it is a stored-first violation and the build snapshot is simply wrong.
**Given [[project_stored_derived_values_architecture]] ("UI reads stored, no live compute") (b) is the more likely
reading** — but it is UNVERIFIED, and the fix belongs with whoever owns the build-snapshot bake.
🅱️ **TRACK B:** the two surfaces must be re-priced by the SAME stage with the SAME rules. A player's dollars differing
between his board row and his build row is invisible to every gate that looks at one surface at a time.
**GATE: for any player on both surfaces, `board.twp_*_market_value` must equal `build.twp_*_market_value`.**

## ✅ RESOLVED 2026-08-31 — BUILD-SNAPSHOT PITCHER MARKETS NOW RE-DERIVED (and a worse defect found underneath)
Trevor: *"needs to be fixed."* Fixing it exposed a second, more dangerous defect in the same script.

### 1. THE FIX — `resync-build-snapshot-markets.ts` now derives positive pitcher markets
It previously ONLY floored non-positive WAR to $0, leaving every positive-WAR pitcher on stale dollars ("left to the
app's live bake"). That is a **stored-first violation** ([[project_stored_derived_values_architecture]]) and produced
Colasante's SP slot at **$0 against a real `p_war` of 1.3073** while his board row correctly held **$130,733**.
```ts
const pitcherOnly = owar == null;
if (pwar != null && pwar > 0 && (isTwp || pitcherOnly)) {
  const role = pitcherRoleFromDepthRole(s.pitcher_depth_role || "workhorse_reliever");
  const newP = computePitcherMarketValue(pwar, { conference: conf, role, team: buildTeam.get(r.build_id) ?? null }, EQ);
  … field = isTwp ? "twp_pitcher_market_value" : "market_value"
}
```
⚠ **The `(isTwp || pitcherOnly)` guard is load-bearing.** For a NON-TWP the pitcher dollars live in the SHARED
`market_value` — the same column a hitter uses — so writing it unconditionally would clobber a two-sided non-TWP
row's hitter market. TWPs are unambiguous (own column).
⚠ **`team` must be the PROGRAM being priced into**, not the player — it feeds `canShowPitchingMarketValue`'s
Independent/Oregon-State guard. ⬜ **`resync-target-snapshots.ts:81` passes a PLAYER NAME there** — a latent bug that
only bites on Independent programs. **NOT copied here; still open in that file.**

### 🚨 2. THE DEFECT FOUND UNDERNEATH — NULL `player_id` SILENTLY POISONED THE WHOLE LOOKUP
`team_build_players` holds **191 rows with `player_id` NULL** (portal-search adds). F42a built its lookup as:
```ts
const pids = [...new Set(bps.map((r) => r.player_id))];              // ← no null / UUID filter
const { data } = await sb.from("players")…in("id", pids.slice(…));   // ← `error` DISCARDED
```
**A single null in an `.in("id", …)` makes Postgres reject the ENTIRE batch as invalid-uuid.** With the error thrown
away, every real player in that batch vanished from `posName`, `playerPos` **and `playerTwp`**.
★ **THE TELL WAS COSMETIC:** every dry-run sample printed `undefined` for the player name. That "harmless logging
quirk" was the only visible symptom of a poisoned lookup.
🛑 **IT WOULD HAVE SILENTLY UNDONE REGISTRY #21 WITHIN MINUTES OF FIXING IT** — `playerTwp` comes from that same
lookup, so genuine TWPs would have read `is_twp = false` and been re-routed straight back into the shared
`market_value`. **The fix and the thing that breaks the fix were in the same function.**
✅ **FIXED:** UUID filter + `if (error) throw` on every batch — the same guard already present in
`recompute-snapshot-hitter-market.ts:47-50`, **which was never ported here.**
✅ **SWEEP OF THE REMAINING PUSH PATH:** `backfill-neutral-snapshot.ts:40` and `heal-stale-snapshots.ts:65` **already**
filter `/^[0-9a-f-]{36}$/i`, and `heal-stale-snapshots:67` already reads `is_twp` from `players`. **F42a was the only
push-path script missing it.** (Numerous one-off audit scripts still lack it — out of scope, none write prod.)

### ✅ 3. THE GATE — pitchers have NO position multiplier, so it is EXACTLY ONE RATE PER CONFERENCE
Stronger than the hitter identity (which allows three rates for the three PVM tiers):
| conference | `$/win` | = 25,000 × PTM | rows | distinct rates |
|---|---|---|---|---|
| SEC | **100,000** | × 4.0 | 154 | **1** ✅ |
| ACC | **37,500** | × 1.5 | 12 | **1** ✅ |
| Big 12 | **30,000** | × 1.2 | 154 | **1** ✅ |
| Big Ten | **25,000** | × 1.0 | 31 | **1** ✅ |
| AAC | **20,000** | × 0.8 | 11 | **1** ✅ |
| Big South · CUSA · ASUN | **12,500** | × 0.5 | 67 | **1** ✅ |
★ **`distinct_rates = 1` is the whole assertion.** A single pitcher priced off the wrong conference, a stale PTM, or a
defaulted role appears instantly as a second rate — regardless of dollar magnitude. **Use this, not a threshold.**
✅ **Colasante now AGREES across surfaces:** build and board both `$112,305` hitter / `$130,733` pitcher.

### ✅ 4. THE SEC JUMP IS EXPECTED — NOT A DEFECT (Trevor, 2026-08-31)
> *"That is going to be normal — we made the same jump on this push to prod for all players, so all SEC coaches are
> gonna see a large jump."*
**172 rows re-priced.** SEC pitchers moved **$37,500/win → $100,000/win (2.667× = 4.0 ÷ 1.5)**; ACC 1.25×. Those
snapshots were baked BEFORE SEC PTM went 1.5 → 4.0 and had never been re-derived. This is the **pitcher-side twin of
the documented F42b hitter re-price** ("SEC builds ~2.6× up"), and it is push-wide and intended.
🛑 **DO NOT "investigate" a large SEC increase as a regression.** Verify it against the identity
(`$/win == 25,000 × PTM`), not against its previous value.
**Backups:** `_tbp_pre_pitchermkt_backup` (1,470) · `_tbp_pre_twpflag_backup` · `_tbp_pre_f42b_backup` · `_tb_pre_f42_backup`.

### 🅱️ TRACK B — STAGE 19
1. **BOTH surfaces, ONE stage, SAME rules.** `target_board` and `team_build_players` must be priced together.
   **GATE: for any player on both, `board.*_market_value == build.*_market_value`.** A per-surface gate is blind to this.
2. **Pitcher gate = EXACTLY ONE `$/win` rate per conference. Hitter gate = at most THREE** (the PVM tiers).
3. **Never build an `.in()` list from raw foreign keys.** Filter to well-formed UUIDs and **throw on batch error** —
   one null poisons the whole batch and the failure is silent, cosmetic, and downstream-corrupting.
4. **A "cosmetic" logging anomaly (`undefined` names) is a DATA-INTEGRITY signal.** Chase it.

---
# 🔍 SNAPSHOT COMPLETENESS AUDIT (2026-08-31) — **THE FIRST PUSH THAT CHANGES WHAT COACHES SEE**
Trevor: *"Now that we are refilling snapshots we need to make sure the work is complete because this will be the first
one to update user experience."* — Full verbatim record so this is traceable and buildable. **Every number below is
measured on PROD, season 2027, `division='D1'` unless stated.**

## 1. ✅ D1 TWP MARKET ROUTING IS COMPLETE ON PROD — AND STAGING IS NOT A VALID REFERENCE
| | PROD | STAGING |
|---|---|---|
| D1 TWP rows (all model types) | **1,256** | 1,707 |
| `twp_hitter_market_value` set | **1,253** | **122** |
| `twp_pitcher_market_value` set | **1,256** | 1,707 |
| shared `market_value` LEAK on a TWP | **0** ✅ | 0 |
| **TWP hitter rows rendering BLANK** | **0** ✅ | **1,582** ❌ |
🛑 **STAGING HAS THE DEFECT PROD JUST FIXED.** It never received the stage-18 TWP routing change, so **1,582 of its D1
TWP hitter rows would render blank.** ⚠ **DO NOT use staging to validate TWP markets** — prod is the current side.
🅱️ **HARD REQUIREMENT ON THE STAGING CATCH-UP:** it MUST include the stage-18 TWP routing fix
(`precompute-transfer-projections.ts:465-466`), or staging comes back wrong. Add to the Track B catch-up run.

## 2. USER-VISIBLE COMPLETENESS — WOULD ANY D1 PLAYER RENDER A BLANK MARKET?
Computed exactly as the UI resolves it (`pickHitterMarketValue` / `pickPitcherMarketValue`: read `twp_*` when
`players.is_twp`, else `market_value`):
| model_type | is_twp | rows | has o_war | **hitter BLANK** | **pitcher BLANK** |
|---|---|---|---|---|---|
| returner | false | 10,463 | 5,035 | **0** ✅ | **106** ⚠ |
| returner | **true** | 90 | 87 | **0** ✅ | **0** ✅ |
| transfer | false | 131,854 | 65,414 | **0** ✅ | **0** ✅ |
| transfer | **true** | 1,166 | 1,166 | **0** ✅ | **0** ✅ |
★ **Every hitter surface is complete. Every TWP surface is complete.** The ONLY gap is 106 returner pitchers.

## 3. 🚨 THE 106 BLANK RETURNER PITCHERS — **NOT the Independent rule.** Two DIFFERENT problems.
First hypothesis was `canShowPitchingMarketValue`'s Independent/Oregon-State guard. **Measured: 0 are Independent.**
```
conference NULL ................ 64   ← alumni, see 3a
real conference ................ 42   ← see 3b   (of which p_war <= 0: 8 · p_war > 0: 34)
Independent (the hypothesis) .... 0   ❌ hypothesis WRONG
```
### 3a. 64 with a NULL conference — **0 of 64 have a 2026 `"Pitching Master"` row**
No 2026 season ⇒ E36 BLOCKS them (`no_pm_row`) ⇒ their row keeps a **stale `p_war` from an older run**, and
`canShowPitchingMarketValue` returns false on an empty conference so the market is null. These are **alumni/stubs**,
consistent with [[project_players_team_id_null]] (prod carries ~15,706 team-less stubs). ⚠ **The blank market is
arguably correct; the STALE `p_war` on a non-2026 player is the real smell.** ⬜ Not chased.
### 3b. 🚨🚨 **34 WITH POSITIVE WAR, A VALID CONFERENCE, AND A 2026 MASTER ROW — GENUINELY UNEXPLAINED**
**ALL 34 HAVE a 2026 `"Pitching Master"` row**, so E36 COMPUTED them — they are not blocked. They carry `p_war`,
`p_rv_plus`, `pitcher_depth_role` and `projected_ip`, and still have **no market value**:
```
Derek Arrocha   SWAC     Jackson State           p_war 2.531  PR+ 123  weekend_starter         85.0 proj IP
JB Manarchuck   MAAC     Mount St. Mary's        p_war 1.606  PR+ 127  workhorse_reliever      50.0
John Costa      ASUN     North Florida           p_war 1.577  PR+ 126  workhorse_reliever      50.0
Adam Brodnax    Sun Belt UL Monroe               p_war 1.518  PR+ 124  weekday_starter         50.0
Alex Jankowski  NEC      LIU Brooklyn            p_war 1.019  PR+ 118  high_leverage_reliever  33.0
Tyler Roark     Sun Belt UL Monroe               p_war 0.961  PR+ 105  workhorse_reliever      50.0
Sam Harris      ACC      North Carolina State    p_war 0.866  PR+ 117  high_leverage_reliever  33.0
Adam Lehmann    MAC      Western Michigan        p_war 0.770  PR+ 112  high_leverage_reliever  33.0
```
**HYPOTHESES TESTED AND REJECTED — do not re-test these:**
| hypothesis | result |
|---|---|
| Independent-conference guard | ❌ **0 of 106 are Independent** |
| no 2026 Master row (E36 blocked) | ❌ **34 of 34 HAVE one** |
| null `players.team` | ❌ **0 have a null team** |
| non-positive WAR floors to null | ❌ only **8** of the 42 are `p_war <= 0`; the **34 are all positive** |
| the sub-20 IP null-out | ❌ that gate is **JUCO-only** (`JUCO_IP_THRESHOLD`). The CONTROL group contains **1,799 priced pitchers under 20 IP**, and **17 of the 34 are OVER 20 IP** (max **79.7**) |
**CONTROL:** 4,403 of 4,476 priced D1 returner pitchers have a 2026 Master row — a Master row normally ⇒ a market.
🛑 **STATUS: OPEN, UNEXPLAINED, USER-VISIBLE.** A 2.5-WAR weekend starter showing no market value is exactly the kind
of thing a coach notices first. ⬜ **NEXT STEP: trace `precompute-returner-pitchers.ts:497`**
(`computePitcherMarketValue({ conference, team: teamName, is_twp, ip: actualIp })`) for these specific
`source_player_id`s — `:415` resolves `conference = teamRow?.conference ?? p.conference`, so the most likely cause is
that **`teamRow` fails to resolve and something ELSE in that path nulls the result** — but that is a HYPOTHESIS, not a
finding. **Do not report a cause until it is measured.**

## 4. 🅿️ JUCO — 2,119 BLANK TWP HITTER ROWS, PARKED BY DESIGN
Per the D1-consistency-boundary rule. ⚠ **If a JUCO player is on a coach's board today, a blank market is what they
see.** Expected, not a defect — but it IS user-visible, so it should be a known talking point rather than a surprise.

## 🅱️ TRACK B — WHAT THIS AUDIT ADDS TO STAGE 19
1. **THE COMPLETENESS GATE MUST BE WRITTEN AS THE UI RESOLVES IT**, not as a column check:
   `coalesce(twp_*_market_value WHEN players.is_twp, market_value) IS NULL AND <side>_war IS NOT NULL` ⇒ **0 rows**,
   scoped to `division='D1'`. A per-column check passes while the screen shows a blank.
2. **SEPARATE "BLANK BECAUSE BLOCKED" FROM "BLANK DESPITE BEING COMPUTED".** The 64 (no Master row, stale WAR) and
   the 34 (Master row, computed, still blank) look identical in any count and are completely different problems.
   **Join to the Master and split them.**
3. **A STALE `p_war` ON A PLAYER WITH NO CURRENT-SEASON MASTER ROW IS ITS OWN DEFECT CLASS.** Blocked players keep
   values from earlier runs indefinitely; nothing expires them.
4. **THE STAGING CATCH-UP MUST CARRY THE STAGE-18 TWP ROUTING FIX** — otherwise it reintroduces 1,582 blanks.









