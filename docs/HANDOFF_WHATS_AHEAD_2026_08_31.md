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
▶ F41  rebuild-twp-target-rows · rebake-twp-markets · fix-returner-twp-hitter-market   NEXT (invoke DIRECTLY, not npm)
  F41  rebuild-twp-target-rows · rebake-twp-markets · fix-returner-twp-hitter-market   (invoke DIRECTLY, not npm)
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
