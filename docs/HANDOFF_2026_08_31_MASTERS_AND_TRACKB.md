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
