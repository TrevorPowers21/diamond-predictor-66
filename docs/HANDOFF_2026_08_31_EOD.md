# ▶️ HANDOFF — RSTR IQ, end of 2026-08-31. **START HERE.**
**Companion: `docs/HANDOFF_WHATS_AHEAD_2026_08_31.md` — what is AHEAD (Track B blockers + the earned rules). This file is CURRENT STATE.**
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
| **Equations / calibration** | ✅ **VERIFIED live and IN USE on prod** — all 6 `*_ncaa_sd_bad` keys present (`sd_good` = the existing `*_ncaa_sd`, by design); `dsd()` in `transferPitcherProjection:390-395` and `ncaaSdBad` in `pitcherProjection:455` consume them; `precompute-returner-pitchers:133` overlays the stage-5.5 two-sided SD — **so E36's 6,632 projections used it**. `model_config` 220/220 keys, zero missing either way. |
| **E36 returner pitchers** | ✅ RE-RUN after the depth-role fix — 6,632 with `p_war` (avg **0.584**, was 0.607) · `projected_ip` **30.0** · max `p_war` **3.93** = staging · propagate 105,093. |
| **E37 returner hitters** | ✅ RE-RUN — 6,806 with `o_war` (avg **0.795**) · max `o_war` **6.86** = staging · market max **$673,949** (was $104,110 pre-E37) · cornerstone **1,138**. |
| **Depth-role source** | ✅ **FIXED + VALIDATED ON BOTH ENVS.** Tiers read the Masters' `regular_season_pa` / `regular_season_ip`. Applying the same code to staging collapsed the gaps ~91% (cornerstone **256 → 23**, weekend_starter **81 → 10**), proving the divergence was the RULE, not a prod defect. Fixed in **4 scripts**: returner hitter+pitcher, transfer hitter (transfer pitcher was already correct). |
| **E38 transfers** | ✅ **DONE 2026-08-31** — 13 teams x ~14,270 rows, 0 errors, depth roles 99.9% REG-anchored. Audited first. `RSTR IQ All-Americans` (`school_team_id` NULL, prod-only) will yield **0** rows BY DESIGN; the other 13 ~14,240 each. Loop swallows exit codes — gate PER TEAM in the DB. |
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
✅ E36  precompute-returner-pitchers:prod       DONE (re-run w/ REG anchoring) · avg p_war 0.584 · projected_ip 30.0
✅ E37  precompute-returner-hitters:prod        DONE (re-run w/ REG anchoring) · avg o_war 0.795 · market max $673,949
       🛑 `npm run …:prod` ALIASES **WRITE** — no --dry-run inside. Use `-- --dry-run` (the `--` is REQUIRED).
       🛑 the propagate RPC needs `set statement_timeout = '15min'` as an EXPLICIT statement (client option ignored).
✅ E38  zsh scripts/_run_step2_all.sh --prod    DONE · 13 teams x ~14,270 · All-Americans 0 (school_team_id NULL, by design)
✅ F39  select refresh_composite_war();         DONE · 9.0s · d_war/bsr_war 200,754→201,221 · identity worst 0.000000
▶ F40  backfill-snapshot-total-hitter-war       NEXT (696 snapshots to fill)
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
8. **FOR ANY CONFIG/CALIBRATION CHANGE, VERIFY THREE THINGS SEPARATELY:** (a) the key EXISTS · (b) its value is
   FRESH (re-derived for THIS env) · (c) a code path actually READS it. "220 keys on both envs" answers only (a).
9. **COMPARE CONFIG NUMERICALLY, NOT AS STRINGS.** A string diff reported 77 differences; 156 were formatting
   (`0.3` vs `0.30`) and only 64 were real.
10. **`updated_at` IS NOT A FRESHNESS SIGNAL.** The propagate bumped it on 105,093 rows whose values never changed.

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

---
# ✅ E36 + E37 RE-RUN AFTER THE DEPTH-ROLE FIX (prod, 2026-08-31)
Re-ran both so tiers derive from the REGULAR-SEASON window. Both idempotent. Propagate needed the explicit
`set statement_timeout = '15min'` again (105,093 rows, 14.8s) — the bare run times out at prod's 2min default.

## RESULT — PROD vs STAGING, and why they now DIFFER BY DESIGN
| | PROD | STAGING | reading |
|---|---|---|---|
| **HITTER** cornerstone | **1,138** (1,088 pre-fix) | 1,394 | prod anchors on REG; staging on FULL |
| everyday_starter | 2,513 | 2,365 | |
| avg `projected_pa` | 170.9 | 173.5 | |
| avg `o_war` | **0.795** | 0.717 | prod's C27 calibration is fresher |
| **max `o_war`** | **6.86** | **6.86** | ✅ **identical — the projection math reproduces** |
| market avg / max | $19,274 / **$673,949** | $16,564 / $613,259 | |
| **PITCHER** weekend_starter | **336** | 417 | prod a tier lower on REG innings |
| workhorse_reliever | 418 | 529 | |
| weekday_starter | 524 | 430 | |
| avg `projected_ip` | **30.0** | 31.2 | |
| avg `p_war` | **0.584** (0.607 pre-fix) | 0.598 | |
| **max `p_war`** | **3.93** | **3.93** | ✅ identical |
**THE DRIVER, EXPLICITLY:**
```
PROD     "Hitter Master".regular_season_pa >= 220  →    896  (D1)     ← REGULAR season
STAGING  players.pa >= 220                         →  1,394           ← FULL season (old rule)
```
🛑 **PROD AND STAGING SHOULD NO LONGER MATCH ON DEPTH ROLES.** Prod anchors tiers to regular-season volume (the fix);
staging still uses full-season PA/IP because it has not had the fix. **A depth-role mismatch is NOT a prod defect** —
staging picks this up when it is caught up THROUGH TRACK B. Everything else reconciles: **max `o_war` 6.86 and max
`p_war` 3.93 are IDENTICAL**, and the higher prod `o_war`/markets trace to C27's fresher calibration.

## 🛑 CORRECTION — I SAID THE DEPTH-ROLE CHANGE WOULD NOT TOUCH `p_war`. THAT WAS WRONG.
The tier sets `projected_ip` / `projected_pa`, and **`p_war` scales with innings**:
`projected_ip 31.2 → 30.0` ⇒ `avg p_war 0.607 → 0.584` (−0.023). Hitters likewise: `projected_pa 173.5 → 170.9`.
**Depth role is NOT a display attribute — it is a WAR INPUT.** Changing its source changes projections, and therefore
market values. `max` is unchanged in both, so the top of the distribution is stable — but the mean moved.
→ **Anything that alters depth-role derivation REQUIRES a full re-run of E36/E37 and everything downstream of them.**

## ⚙️ MECHANICS WORTH KEEPING
- `npm run …:prod -- --dry-run` — the `--` is REQUIRED; the alias itself contains no dry-run flag and **writes**.
- The propagate RPC needs `set statement_timeout = '15min'` as an **explicit statement** (the node-postgres client
  constructor option does NOT take). FINITE — never `0`.
- Write long-running output **straight to a file**, never through a `grep` pipe — grep buffers and the log stays
  0 bytes, hiding all progress (cost one blind 5-minute wait).

---
# ✅ STAGING VALIDATION OF THE DEPTH-ROLE FIX (2026-08-31) — the divergence WAS the rule, not a data defect
**METHOD:** apply the SAME fixed code to STAGING, so the only remaining difference between environments is DATA.
If the tiers converge, the earlier prod↔staging gap was the rule change; if they stay apart, it is a data problem.
**This is the cleanest way to separate "we changed the rule" from "prod is broken" — use it whenever a rule changes.**

## PITCHERS — CONVERGED ✅
| role | PROD | STAGING | Δ |
|---|---|---|---|
| high_leverage_reliever | 967 | 963 | +4 |
| low_impact_reliever | 776 | 757 | +19 |
| mid_leverage_reliever | 958 | 918 | +40 |
| specialist_reliever | 1,226 | 1,174 | +52 |
| swing_starter | 254 | 242 | +12 |
| weekday_starter | 524 | 488 | +36 |
| weekend_starter | 336 | 346 | **−10** |
| workhorse_reliever | 418 | 428 | **−10** |
Same ordering, proportional deltas. **Prod carries 70 more pitchers with `p_war` (6,632 vs 6,562)**, which accounts
for most of the spread.
**BEFORE staging got the fix:** `weekend_starter` 336 vs **417**, `workhorse_reliever` 418 vs **529** — gaps of 81 and
111. **AFTER:** −10 and −10. **The gap collapsed by ~90% once both ran the same rule.**
`avg p_war` **0.584 vs 0.598 → 0.584 vs 0.577** · `projected_ip` **30.0 vs 30.4** · `max p_war` **3.93 in BOTH** ✅

## ⚙️ MECHANICAL DIFFERENCE WORTH KNOWING
**The propagate RPC SUCCEEDS INLINE on staging (110,383 rows) but TIMES OUT on prod** at the 2min default.
Prod's `player_predictions` is larger and the statement is un-scoped by season. **On prod, always follow the
precompute with the explicit-`SET` propagate; on staging the bare run is fine.** Do not read the staging success as
evidence the prod path works.

## 🧠 THE RULE THIS ESTABLISHES
When a DERIVATION RULE changes, prod↔staging comparison is **meaningless until BOTH run the new rule**. Before that,
a mismatch tells you nothing — I nearly logged the 306-cornerstone gap as a prod defect when it was the fix working.
✅ **Sequence: fix → apply to prod → apply the SAME code to staging → THEN compare.** Any residual difference after
that is genuine data (population size, calibration freshness), and can be attributed rather than guessed at.

---
# 🔍 E38 PRE-FLIGHT AUDIT (2026-08-31) — run BEFORE `zsh scripts/_run_step2_all.sh --prod`
Audited after the depth-role fix, because E38 runs a DIFFERENT pair of scripts from E36/E37.

## 🔴 FINDING 1 — THE TRANSFER **HITTER** HAD THE SAME `players.pa` DEFECT. **FIXED.**
E36/E37 (returners) were fixed earlier; the transfer pair had NOT been checked.
| script | depth-role input | state |
|---|---|---|
| `precompute-pitchers.ts` (transfer PITCHER) | `:362` `r.regular_season_ip ?? r.IP` · `:535` `pmRow?.regular_season_ip ?? pmRow?.IP ?? p.ip` | ✅ **ALREADY CORRECT** |
| `precompute-transfer-projections.ts` (transfer HITTER) | `:409` `const rawPa = (p as any).pa` ← **`players.pa`** | ❌ **BUGGED → FIXED** |
**FIX APPLIED** (same pattern, `masterPR` was already in scope for `d_war`):
```
:305  + regular_season_pa, pa      (added to the "Hitter Master" select)
:409  const rawPa = masterPR?.regular_season_pa ?? masterPR?.pa ?? (p as any).pa ?? null;
```
★ **Fixing the returner path did NOT fix the transfer path.** Four scripts derive depth roles; three needed
inspection and two needed changes. **When a shared helper's INPUT convention changes, audit EVERY caller** —
`grep -rn "defaultHitterDepthRoleFromActualPa\|defaultPitcherDepthRoleFromIp"`.

## ⚠ FINDING 2 — `RSTR IQ All-Americans` HAS **`school_team_id = NULL`** AND **0 TRANSFER PREDICTIONS**
| PROD active team | transfer preds |
|---|---|
| **RSTR IQ All-Americans** | **0** |
| the other 13 (Kansas, Georgia, Arkansas, TCU, Penn State, …) | **~14,240 each** |
Its `customer_teams` row: `school_team_id = NULL · active = true · savant_enabled = true · market_pay_enabled = false`.
**STAGING HAS NO SUCH TEAM** — it is prod-only. Transfer projections need a DESTINATION program (conference, park,
PTM), so with no `school_team_id` there is nothing to project INTO. **The 0 is almost certainly BY DESIGN.**
🛑 **BUT `list-customer-teams.ts` RETURNS IT**, so the loop WILL attempt it — and the loop **discards exit codes**
(below), so a failure or no-op there is indistinguishable from success. **Expect 13 teams to produce ~14,240 rows and
All-Americans to produce 0. Do NOT treat that 0 as a failed run — and do NOT "fix" it by assigning a school.**

## 🛑 FINDING 3 — THE LOOP SWALLOWS EXIT CODES (already known, restated because it now matters more)
```zsh
npx tsx … precompute-transfer-projections.ts --team "$uuid" $PROD_FLAG 2>&1 | grep -iE "Result:|computed|error" | head -3
npx tsx … precompute-pitchers.ts            --team "$uuid" $PROD_FLAG 2>&1 | grep -iE "Result:|computed|overlaid|error" | head -3
```
The pipe means the loop's status is `grep`'s, not the script's. **`STEP 2 ALL DONE (14 teams)` PROVES NOTHING.**
✅ **GATE: after the run, verify PER TEAM in the DB** — 13 teams × ~14,240 rows + All-Americans at 0 — and re-run a
dry pass requiring 0 pending changes. **Never accept the banner.**

## ✅ FINDING 4 — DEPENDENCIES SATISFIED
| prerequisite | PROD | STAGING |
|---|---|---|
| `team_season_stats` rows | **308** | 308 |
| `faced_stuff_plus` / `faced_htp` (what E38 READS) | **308 / 308** | 308 / 308 |
| active customer teams | **14** | 18 |
F44 ran, so `precompute-transfer-projections.ts:225` and `precompute-pitchers.ts:279` will find the faced-competition
values instead of coercing an empty map. **This was the ORDER-AUDIT inversion — F44 had to precede Phase E, and does.**

## ⚠ FINDING 5 — THE TEAM LISTS DIFFER (14 prod vs 18 staging). NOT A DEFECT.
Prod's 14: RSTR IQ All-Americans · Kansas · Georgia · Arkansas · Florida Atlantic · TCU · Stetson · Penn State ·
Arizona State · Vanderbilt · Gardner-Webb · BYU · Virginia Tech · Dallas Baptist.
**"18 teams incl. North Carolina" is a STAGING number and is WRONG for prod.** Gate on what the live list returns,
never on a hardcoded count.

## ▶️ E38 EXECUTION ORDER
```
1. (done) fix the transfer-hitter depth-role source
2. DRY-RUN one team on prod first — confirm the depth roles look REG-anchored before committing 14 teams
3. zsh scripts/_run_step2_all.sh --prod        (~14 teams x 2 scripts; run detached under caffeinate)
4. GATE per team in the DB (13 x ~14,240 + All-Americans 0), NOT the banner
5. re-run dry → require 0 pending per team
```

---
# ✅ HITTER DEPTH-ROLE CONVERGENCE CONFIRMED (2026-08-31) — the fix behaves identically on both envs
Staging E37 re-run finished (`7,025 computed · 1,416 all-null · 2 rows missing master ratings`, EXIT=0).

## THE GAP COLLAPSED 91% ONCE BOTH ENVS RAN THE SAME RULE
| role | PROD | STAGING | Δ NOW | Δ BEFORE staging's fix |
|---|---|---|---|---|
| **cornerstone** | **1,138** | **1,161** | **−23** | **−256** |
| everyday_starter | 2,513 | 2,510 | **+3** | +148 |
| platoon_starter | 1,844 | 1,840 | **+4** | +70 |
| utility | 842 | 834 | +8 | +18 |
| bench | 683 | 694 | −11 | +1 |
`projected_pa` **173.5 → 171.3** (prod 170.9) · **`max o_war` 6.86 in BOTH** ✅
**Mirrors the pitcher result exactly** (`weekend_starter` 81→10, `workhorse_reliever` 111→10, also ~90%).
★ **TWO INDEPENDENT CONFIRMATIONS, hitters and pitchers, that the 2026-08-31 depth-role divergence was the RULE
CHANGE and not a prod defect.**

## THE RESIDUAL IS ATTRIBUTABLE — NOT DRIFT
| | PROD | STAGING | cause |
|---|---|---|---|
| avg `o_war` | **0.795** | 0.710 | prod's **C27 calibration is fresher** (staging never ran C27) |
| avg market | **$19,274** | $16,277 | same |
| max market | **$673,949** | $613,259 | same |
| hitters with `o_war` | 6,806 | 6,811 | population differs by 5 |
| `regular_season_pa` filled · avg | 5,322 · **121.4** | 5,339 · **121.7** | near-identical — the INPUT agrees |
★ **The INPUT (`regular_season_pa`, 121.4 vs 121.7) agrees to 0.3 PA while the OUTPUT (`o_war`) differs by 0.085.**
That is the signature of a CALIBRATION difference, not a data difference — exactly what C27 freshness predicts.

## 🧠 MY OWN PROBE ERROR (6th of the session — logged for the pattern, not the incident)
I labelled a column `ge220` but omitted the `>= 220` predicate, so it returned the TOTAL filled count (5,322 / 5,339)
rather than the above-threshold count. The values shown were still valid (`regular_season_pa` fill + average) but the
LABEL was wrong and would have misled a later reader.
→ **A mislabeled correct number is as dangerous as a wrong number.** Running tally of instrument errors this session:
wrong CSV column · exact-equality between derivations · `Number(null)` passing `isFinite` · raw-mean over a
tiny-denominator tail · guessed column names (×3) · this mislabeled aggregate. **Every one was MY measurement, never
the data.** Against ONE guard that fired correctly (the IP check at 1.827), where the disagreement WAS the finding.

---
# 📊 REFERENCE — WHY PROD AND STAGING PROJECTIONS DIFFER (measured 2026-08-31). Use this to attribute, not guess.
Measured across **n = 3,861** D1 pitchers with `IP > 10`, `|prod − staging|` on every `"Pitching Master"` input the
projection engine reads:
| input | mean \|Δ\| | **median** | p90 | reading |
|---|---|---|---|---|
| **`stuff_plus`** | 0.027 | **0.000** | 0.100 | ✅ **IDENTICAL — the v2 chain reproduces exactly** |
| `HR9` | 0.038 | 0.030 | 0.080 | negligible |
| `WHIP` | 0.057 | 0.050 | 0.120 | negligible |
| `FIP` | 0.076 | 0.050 | 0.180 | negligible |
| `BB9` | 0.177 | 0.120 | 0.390 | small |
| `K9` | 0.259 | 0.230 | 0.500 | small |
| **`ERA`** | **0.290** | **0.180** | **0.710** | ★ largest RAW-RATE difference |
| `IP` | 0.533 | 0.367 | 1.333 | ~0.4 IP |
| **`p_rv_plus` (PR+)** | **2.500** | **1.000** | **7.000** | ★★ **LARGEST — and larger than any of its own inputs** |

## THE CAUSAL RANKING (dominant → negligible)
1. **★★ C27 CALIBRATION FRESHNESS — the dominant driver, via PR+.** PR+ is a z-score composite against
   `ncaa_averages` means/SDs. **Prod ran C27 and re-derived them from prod's own population; staging never did.**
   Small input deltas measured against *different* means/SDs **AMPLIFY**: PR+ moves a median 1.0 (p90 **7.0**) on a
   ~100 scale — bigger than any input that feeds it. **PR+ is what the projection engine actually consumes**, so this
   is where prod↔staging projection differences come from.
   Evidence: `p_ncaa_avg_stuff_plus` prod **100.0141** vs staging **99.4358**; `p_sd_stuff_plus` **5.04577** vs **5.93754**.
2. **★ ERA SOURCE — not window.** BOTH envs hold FULL-season ERA. Prod's now comes from the **engine's accrual**
   (`pitcher_line.csv` `full_ERA` — inherited-runner attribution, earned+unearned); staging's is still **TruMedia's
   official** figure. Worked example — **Dylan Volantis: prod ERA 1.98 vs staging 2.08.**
   ⚠ **ERA is a field the monthly Master sheet is meant to OVERRIDE** if the pitch-log derivation is off — it is one of
   the named weak-derivation fields (with SB and G/GS).
3. K9 / BB9 / FIP / WHIP / HR9 — all median ≤ 0.23. Same pitch-log derivation both sides.
4. **`stuff_plus` — ZERO (median 0.000).** Whatever differs, it is never Stuff+.

## 🛑 THE MISATTRIBUTION THIS TABLE PREVENTS
Trevor: *"I even noticed that Dylan Volantis Stuff+ went down"* — reasonably attributed to C27.
**IT WAS NOT C27.** `stuff_plus` is **102.60 in BOTH envs**, from **1,525 scored pitches averaging 102.58 in BOTH**.
**C27 writes `ncaa_averages` / `model_config` — POPULATION CONSTANTS — never per-player `stuff_plus`.**
The drop Trevor remembers is **107.6 → 102.60**, which is the **Stuff+ v2 RECLASSIFICATION + RECENTER** — the change
he himself challenged at the time (*"I find it hard to believe Dylan Volantis would be a 107.6 stuff+"*). His instinct
was right and v2 corrected it. For context, 102.60 sits ~4 points above the Master population mean
(**98.59 prod / 98.82 staging**) — a far more defensible placement than 107.6.
★ **RULE: before attributing a per-player change to a producer, confirm that producer WRITES that column.**
Volantis' other prod↔staging deltas are separately explained: `trackman_pitches` 1,530 vs 1,406 (**prod ran C24**,
staging did not) · `IP` 95.30 vs 95.00 (engine vs TruMedia).

## ✅ HOW TO USE THIS
- A prod↔staging **projection** difference is **EXPECTED** until staging is caught up through Track B. Attribute it to
  PR+/C27 first.
- **Input agrees but output differs ⇒ CALIBRATION.** Demonstrated twice: `regular_season_pa` agrees to 0.3 PA while
  `o_war` differs 0.085; `stuff_plus` agrees to 0.000 while PR+ differs 1.0.
- **Only investigate as a defect** when an input with a *median* difference of ~0 produces a large output change that
  calibration cannot explain.

---
# ✅ E38 TRANSFERS — APPLIED TO PROD 2026-08-31. All 14 teams, 0 errors.
`caffeinate -dimsu zsh scripts/_run_step2_all.sh --prod` · EXIT=0 · **0 error/fail mentions in the log**.
Per team ~4,990 hitter + ~5,110 pitcher computed (38–39% of ~13,000 candidates) — consistent across all 13 real teams.

## GATE — VERIFIED PER TEAM IN THE DATABASE, **NOT** FROM THE BANNER
| team | rows | `o_war` | `p_war` |
|---|---|---|---|
| Kansas · Penn State · TCU · Florida Atlantic · BYU | 14,274–14,276 | 8,099–8,103 | 6,294–6,296 |
| Virginia Tech · Arkansas · Dallas Baptist · Arizona State · Stetson | 14,269–14,271 | 8,096–8,099 | 6,293–6,294 |
| Gardner-Webb · Vanderbilt · Georgia | 14,267–14,268 | 8,096–8,098 | 6,290–6,292 |
| **RSTR IQ All-Americans** | **0** | 0 | 0 |
★ **The 9-ROW SPREAD (14,267–14,276) IS THE REAL SIGNAL.** A team cut short by a swallowed failure would sit visibly
below the others. None does. **Row-count TIGHTNESS across peers is a better completeness gate than any single count.**

## ✅ THE AUDIT'S TWO PREDICTIONS BOTH HELD
1. **`RSTR IQ All-Americans` produced 0 — SILENTLY.** The log shows both banners with **NO `Result:` line between
   them**, then the loop moved straight to Kansas:
   ```
   ===== [1/14] RSTRIQAll-Americans HITTER =====
   ===== [1/14] RSTRIQAll-Americans PITCHER =====
   ===== [2/14] KansasJayhawks HITTER =====
   ```
   Correct (`school_team_id` is NULL — no destination program to project INTO). **But a REAL failure would look
   IDENTICAL.** This is the exit-code-swallowing risk demonstrated live, on a real run. ⛔ Do NOT "fix" this by
   assigning it a school.
2. **The transfer-hitter depth-role fix was REQUIRED.** Had E38 run before the audit, ~185,000 transfer rows would
   carry FULL-season-anchored tiers while the returners carry REGULAR-season — the same players holding different
   tiers depending on which model row you read, and nearly impossible to spot afterwards.

## ✅ DEPTH ROLES CONFIRMED REGULAR-SEASON ANCHORED
**885 of 886 transfer cornerstones have `"Hitter Master".regular_season_pa >= 220` (99.9%).** The single exception is
a null-reg row using the documented full-season fallback.
| role | RETURNER | TRANSFER | reading |
|---|---|---|---|
| everyday_starter | 2,513 | **2,510** | ✅ top tiers agree ±10 |
| cornerstone | 1,138 | **1,128** | ✅ |
| platoon_starter | 1,844 | 2,132 | larger transfer CANDIDATE POOL (JUCO/D2/low-PA nationally) |
| utility | 842 | 1,322 | same |
| bench | 683 | 1,011 | same |

## ✅ EQUATION INPUTS VERIFIED **BEFORE** THE RUN (single-team prod dry-run, Kansas)
```
overlaid 34 pitching weights from model_config      ← config IS read (incl. every *_plus_ncaa_* key)
308 team_season_stats faced_stuff_plus rows         ← hitter side consumes F44
308 team_season_stats faced_htp rows                ← pitcher side consumes F44
```
★ **Those `308 faced_*` lines are the ORDER-AUDIT INVERSION paying off live** — this is the exact read that would have
returned an EMPTY MAP (and silently dropped the faced-competition adjustment for every Independent program) had Phase E
run before F44, as the original topic-ordered runbook specified.
Two-sided SD reaches the engine: all 6 `*_ncaa_sd_bad` exist in `DEFAULT_PITCHING_WEIGHTS`, so they pass the
`k in pitchingEq` overlay guard at `precompute-pitchers.ts:156` and are consumed by `dsd()` at
`transferPitcherProjection.ts:390-395`.

---
# 🚨🚨 SILENT-FAILURE REGISTRY — EVERY DEFECT THAT WOULD HAVE SHIPPED WITHOUT AN ERROR
## READ THIS BEFORE WRITING ANY TRACK B STAGE. Each entry says WHERE it belongs in Track B and WHEN it must run.
**The unifying property: NOT ONE of these raised an error.** Every one produced a populated table, a clean exit code,
and a plausible number. They were found by VALUE / MEMBERSHIP / CARDINALITY gates and by cross-environment comparison —
never by a failure. **A Track B stage that "ran fine" tells you nothing.**

| # | 🚨 defect | how it presented | what caught it | **TRACK B: where + when** |
|---|---|---|---|---|
| 1 | **Conference `Stuff_plus` computed from the LEGACY lane** | `30/30` populated, looked complete | VALUE compare → **101.17 vs the correct 99.15** | **Stage 14 (conference).** `conferenceStuffPlusV2` = `Σ(Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)`. ⛔ NEVER `pitcher_stuff_plus_inputs`. **Runs AFTER the Masters rollup, and is a 4th producer the runbook omitted.** |
| 2 | **`trackman_pitches` from the legacy table** | column fully populated | lane check → only **638/5,367 (11.9%)** agreed; legacy UNDERCOUNTS ~12.1/pitcher | **Stage 6.** D1 ← `pitch_log_pitcher_totals.total_pitches` @ `dimension_key='all'`; JUCO ← legacy. **Keep the lanes separate.** |
| 3 | **`run_env_factor` went stale under the park rewrite** | `30/30` before AND after | VALUE → **101.879 → 99.719** (= the park `RG mean|Δ| 2.16`) | **Stage 14.** `derive_conf_opr_htp` MUST be the **LAST** thing to touch park-derived conference columns. Park factors (stage 12) invalidate it. |
| 4 | **Camden Kozeal — a real 287-PA / 20-HR season with NO Master row** | `5,340 = 5,340`, every count passed | **MEMBERSHIP** diff (pitch-log PA ≥ qualifier vs Master) | **Stage 5.** Create rows for anyone the pitch log shows PLAYED. Gate = the membership query returning EMPTY. |
| 5 | **`--create-new` structurally incapable of creating a hitter** | `exit 0`, printed `0 new rows` | reading the code after a replica said it SHOULD create 1 | **Stage 5.** `repRows` `:465` passed `"batting_team_id"` as `idCol` ⇒ query TIMED OUT over 2.5M rows ⇒ `:451` DISCARDED the error. **2027 opens with mostly new players — this MUST work.** |
| 6 | **Arkansas split across two `TeamID`s** | both buckets internally consistent; **Σ-centering held at 309 teams** | **CARDINALITY** (D1 must = 308) — later a **PRIMARY KEY** | **Stage 15.** Group on **`source_id`**, never the per-season `TeamID`. Assert `count(distinct TeamID) per source_id = 1` BEFORE any team rollup. |
| 7 | **`pitch_log.game_string` 100% NULL on prod** | every Phase-C gate passed — nothing needed it as a KEY | per-pitcher IP derived **0 pitchers** | **Stage 1 (ingest).** It is an INGEST-time identifier, not derived. Without it: per-pitcher IP is impossible AND `refresh_team_season_stats` step 5 (W/L records) has no key. |
| 8 | **`pitch_log_pitcher_totals.ip` 0/5,509 on prod** | column EXISTED, so `ipColExists` returned true | `K9/BB9/HR9/WHIP/FIP` silently left at stale CSV values | **Stage 2 (accumulator).** `pitcherIpDependent()` returns `{}` on a null `ip` — **no error**. Compute `ip` in the totals build. |
| 9 | **Depth role read `players.pa`** (identity table, never synced) | tiers looked fine on staging (columns happen to be equal there) | prod↔staging → **306 fewer cornerstones** | **Stages 5 + 18.** Read the Masters' `regular_season_pa`/`regular_season_ip`. **4 scripts derive depth roles — fixing one does NOT fix the others.** |
| 10 | **Transfer HITTER kept the `players.pa` bug after the returner was fixed** | would have written ~185k rows with the WRONG tier window | the **E38 PRE-FLIGHT AUDIT** | **Stage 18.** When a shared helper's INPUT convention changes, `grep` EVERY caller. |
| 11 | **Phase E reads `team_season_stats.faced_*`, which Phase F creates** | `const { data } =` discarded `error`; `(rows \|\| [])` → empty Map ⇒ Independents silently lose faced-competition | the ORDER AUDIT (read/write graph) | **Stage 15 BEFORE stage 18.** The docs gated G46 on this table but never carried the gate back to the precomputes. |
| 12 | **`regular_season_ip` empty ⇒ `nullif(sum(...),0)` → NULL** | `team_season_stats` populated, rates just… NULL | reading the SQL body | **Stage 15.** Needs stage 11 (the reg/post lock) first. |
| 13 | **WAR reads CSVs on disk, not the DB** | correct numbers, wrong wiring | asking "what does this READ?" | 🔴 **TRACK B BLOCKER.** A daily run has NO TruMedia CSV. Re-point at the accumulator → Masters. |
| 14 | **6 scripts writing PROD with no env guard** | ran fine — against whichever env you loaded | `grep -c 'trbvxuoliwrfowibatkm'` = 0 | **Every stage.** Double-keyed guard: URL and `--prod` must AGREE. |
| 15 | **`npm run …:prod` aliases WRITE** | I announced "dry-run" and it upserted 7,596 rows | reading `package.json` afterwards | **Every stage.** `-- --dry-run` (the `--` is REQUIRED). **Assume `:prod` aliases write.** |
| 16 | **`updated_at` bumped on 105,093 rows whose values never changed** | fresh timestamp, stale values | comparing VALUES | **Every stage.** ⛔ **`updated_at` is NOT a freshness signal.** |

## 🚨 MECHANICAL TRAPS THAT COST A RUN EACH (all reproduce in Track B — it writes in bulk by definition)
| trap | symptom | fix |
|---|---|---|
| `CREATE TEMP TABLE … ON COMMIT DROP` | `relation "_gs_map" does not exist` | node-postgres autocommits EVERY statement — the CREATE commits and drops it. Use a session temp table or an explicit `BEGIN`. |
| One bulk `UPDATE` over 2.5M rows | `canceling statement due to statement timeout`, **whole thing rolls back** | prod `statement_timeout` = **2min**. Batch 25k via `unnest()` (~**87,000 rows/min**). |
| `new pg.Client({ statement_timeout })` | silently ignored — `show statement_timeout` still `2min` | `await c.query("set statement_timeout = '15min'")` as an EXPLICIT statement. **FINITE — never `0`** (a prior session hung prod 39 min). |
| Long job piped through `grep` | log stays **0 bytes**, no progress visible | write straight to a file. |
| `_run_step2_all.sh` pipes each team through `grep \| head -3` | **discards the exit code** — `STEP 2 ALL DONE (14 teams)` proves NOTHING | gate PER TEAM in the DB; peer row-count TIGHTNESS is the real signal. |
| `refresh_composite_war()` over PostgREST | gateway cuts at ~125s, **UPDATE rolls back**, no recognisable error | direct pg session / SQL editor ONLY. |

## 🚨 THE FOUR GATES THAT ACTUALLY CATCH THINGS (a count gate caught NONE of the above)
1. **VALUE** — did the number CHANGE? (#1, #3)
2. **MEMBERSHIP** — diff the ID SET, not the count. (#4)
3. **CARDINALITY** — assert the GROUP count; lean on PRIMARY KEYS. (#6)
4. **LOG-CONTENT** — read the body, never the exit code. (#5, #15)
Plus: **cross-environment comparison AFTER both run the same rule** — which is how #9 was proven to be a rule change
rather than a defect (gaps collapsed ~91%).

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