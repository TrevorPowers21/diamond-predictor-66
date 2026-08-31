# ▶️ HANDOFF — RSTR IQ, end of 2026-08-31. **START HERE.**
Supersedes `HANDOFF_2026_08_31_MASTERS_AND_TRACKB.md` as the entry point (that file is still valid for the Track B
architecture write-up). Step-by-step: `docs/PLAN_finish_prod_push_2026_08_31.md`.

## READ IN THIS ORDER
1. **§1 PROD STATE** — what is live right now.
2. **§2 WHAT'S LEFT** — the remaining push, in dependency order.
3. `docs/PIPELINE_pitch_log_to_projections.md` → **"TRACK B — THE COMPLETE ARCHITECTURE"** + **"TRACK B — RULES ADDED 2026-08-31"**.
4. `docs/AUDIT_dependency_order_vs_topic_order_2026_08_30.md` — why the runbook's phase order is wrong.
5. `PROD_MIGRATIONS_TODO.md` — the ledger. **Append every prod change.**
6. Memory: `project_stuff_plus_v2_locked` · `project_prod_push_in_progress` · `reference_db_direct_sessions`
   (both `PGURI`s are SAVED — **never ask for DB passwords**).

---
# §1 PROD STATE — all verified IN THE DATABASE, not from logs
| area | state |
|---|---|
| **Phase A/B** | ✅ `model_config` 220 keys; Phase-B tuned values survived C27. ⚠ real gate keys are `r_obp_std_pr` / `p_whip_pr_sd` / `owar_replacement_runs_per_600` — the short names in older docs return **zero rows**. |
| **Phase C** Stuff+ | ✅ 2,013,005 pitches. Gate **mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7** — identical to staging. |
| C24 · C27 · C26 · C29 · C28 · C28b | ✅ Conference `Stuff_plus` **101.17 → 99.15** (legacy-lane fix). |
| **Phase D** | ✅ complete. `team_drs` **derived on prod** (308, sum 0.00) · D31/D32 committed `0 FAILED` · **D34 all 9 gates**. |
| **E2** park factors + `derive_conf_opr_htp` | ✅ `rg_factor_seasonal` 0/309 → full · `run_env_factor` **101.879 → 99.719** · park factors **308/308 IDENTICAL to staging**. |
| **`pitch_log.game_string`** | ✅ **0 → 2,576,146** (backfilled from 34 source CSVs) · **8,519 distinct games = 55.3/team**. |
| **`pitch_log_pitcher_totals.ip` / `ip_reg`** | ✅ **0 → 5,415** each (outs÷3; Σ IP 147,630.3 = staging's exactly). |
| **Masters counting stats** | ✅ `pa` avg **121.8 → 127.7** (FULL season) · `regular_season_pa` **5,322** · `IP` **25.67 → 26.66** · `regular_season_ip` **5,372** · `bf` **5,372** · `k_pct` 4,374 → **5,334**. |
| **`K9/BB9/HR9/WHIP/FIP`** | ✅ **now pitch-log-DERIVED on prod (5,375)** — were stale TruMedia values until today. |
| **F44 `team_season_stats`** | ✅ **0 → 308.** `faced_*` 308/308 · `ra9_reg` 308 · W/L **27.6-27.4 over 55.0 games** · AVG .277 · wRC+ 98.8. |
| *(unplanned)* Kozeal / Wiggins | ✅ Kozeal's real row CREATED (D1 hitters 5,341); Wiggins' phantom row DELETED. |
| **E35 TWP detector** | ✅ `is_twp` **137 → 253** (= staging exactly) · legacy `position='TWP'` **428 → 34** (= staging exactly) · 606 rows · D1 TWPs **90**. |

**Backups on prod:** `_hm_prefill_backup` (8,245) · `_pm_prefill_backup` (8,071) · `_pm_wiggins_backup` (1) ·
`_confstats_backup` · `_parkfactors_backup` (615) · `_c28_before` · `_v2_prechain_backup`.
⛔ **NEVER DROP:** `_reclass_result` · `_reclass_map` · `_reclass_pf` · `team_war_snapshots`.

**Prod↔staging:** park factors identical · `run_env_factor` identical · Kozeal's WAR identical to 3dp.
`hitter_talent_plus` 99.23 vs 99.01 = **staging is BEHIND** (never got C24/C26/C27/C28/C28b/C29).
**Prod is the current side — a mismatch is NOT automatically a prod defect.**

---
# §2 WHAT'S LEFT — dependency order, NOT the runbook's topic order
```
✅ E35  run-twp-recompute --prod --apply       DONE 2026-08-31 · is_twp 137→253 (= staging) · legacy TWP 428→34 (= staging) · 606 rows
▶ E36  precompute-returner-pitchers:prod        NEXT (dry-run first)
  E37  precompute-returner-hitters:prod
  E38  zsh scripts/_run_step2_all.sh --prod     🛑 the loop pipes through `grep | head -3` and SWALLOWS EXIT CODES.
                                                "14 teams DONE" is NOT proof — re-run the dry-run, require 0 pending per team.
                                                customer_teams active = 14 (NOT 18 — that is a staging number)
  F39  select refresh_composite_war();          🛑 DIRECT pg session / SQL editor ONLY — PostgREST cuts at ~125s and ROLLS BACK
  F40  backfill-snapshot-total-hitter-war       guard added ✅ · dry-run showed 696 snapshots to fill
  F41  rebuild-twp-target-rows · rebake-twp-markets · fix-returner-twp-hitter-market   (invoke DIRECTLY, not npm)
  F42  resync-build-snapshot-markets --all · resync-target-snapshots --all   ★ --all REQUIRED (default scope is a staging build id)
  F42b recompute-snapshot-hitter-market --prod --apply
  F43  backfill-neutral-snapshot → heal-stale-snapshots
  G46  supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm
       ⛔ never --linked (config.toml names a THIRD ref kfkuhdmpchxyffmnowgj) · ⛔ do NOT deploy recalculate-prediction
  →    preview-verify → gh pr create staging→main → Trevor merges → Phase H drops
  →    THEN staging catch-up, run THROUGH Track B (never by hand)
```
⬜ **STILL OWED:** the **postseason-inclusive Master sheet import** — the CROSS-CHECK/OVERRIDE layer that corrects
where the pitch log is weak (**SB, ERA, G/GS**). Order is derive-then-override, so it comes after the above.

---
# §3 THE RULES THIS PUSH ESTABLISHED
1. **ORDER BY THE DATA, NOT THE TOPIC.** The runbook's phases are a table of contents; the real order is "who reads
   whose column". That audit moved F44 ahead of Phase E and invented `D33b`. Every defect found was a dependency edge,
   and **not one raised an error**.
2. **PRESENCE IN A SEASON'S MASTER IS DECIDED BY THE PITCH LOG — BOTH WAYS.** Kozeal (real data, no row) → CREATE.
   Wiggins (row, no data) → REMOVE. Never by returner/roster/portal status.
3. **GROUP TEAMS ON `source_id`, NEVER THE PER-SEASON `TeamID`.** The 254/55 mix of Teams-Table seasons is legitimate;
   the only invariant is one `TeamID` per `source_id` per season.
4. **GATE ON VALUES, MEMBERSHIP, CARDINALITY, LOG-CONTENT — NEVER COUNTS OR EXIT CODES.**
5. **A TRIPPED GUARD IS DATA.** The IP guard fired at 1.827 and the disagreement WAS the finding (prod's `Master.IP`
   held the regular-season window). **Fix the comparison, never the threshold.**
6. **VERIFY THE INSTRUMENT BEFORE REPORTING AN ALARM.** Five false alarms this session were all MY measurement:
   a wrong CSV column · exact-equality between two derivations · `Number(null)` passing `isFinite` · a raw mean over a
   tiny-denominator tail · guessed column names. **Report mean/median/p90/max — never a %-exact-match or a raw mean.**
7. **LEAN ON DATABASE CONSTRAINTS.** `team_season_stats_pkey` caught a duplicate no application gate would have.

# §4 🛑 MISTAKES — DO NOT REPEAT
- A subagent with prod credentials called `refresh_composite_war()` and wrote ~112k rows → **subagents get STAGING only**.
- **Pasted staging's `team_drs` into prod** instead of deriving it → **derive on prod, never copy**.
- **Changed Kozeal's `TeamID` to the "correct" season row** → split Arkansas 308→309. Staging was right.
- **Proposed re-pointing Wiggins' `TeamID`** → would have folded 14 phantom IP into Arkansas. Trevor caught it.
- **Rewrote documented steps instead of reordering them** → reorder; do not redefine.
- **Claimed docs were consistent having checked only my own edits** → a sweep found 12 more.
- **`CREATE TEMP TABLE … ON COMMIT DROP`** from node-postgres → autocommit drops it immediately.
- **One 2.5M-row UPDATE** → blew the 2-min `statement_timeout` and rolled back whole. Batch at 25k (~87k rows/min).

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
