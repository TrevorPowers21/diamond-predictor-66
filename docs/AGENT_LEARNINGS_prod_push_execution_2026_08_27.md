# AGENT LEARNINGS — executing the war-recalibration PROD push (2026-08-26/27)





## 🛑 TEAM BUILDER READ/WRITE PATH — 2026-09-01 (read before touching snapshots)

**One defect class behind every symptom: a stored copy nobody recomputes, behind a `??` chain that
silently changes which source wins when a field becomes populated.**

- **`p.prediction` IS NOT A SNAPSHOT.** `useLoadBuild:411` = `snapshot ?? predictionMap[...]`, so it
  degrades to the raw prediction row on a lookup miss. Display now reads
  **`p.player_snapshot ?? p.transfer_snapshot`** (useLoadBuild exposes `player_snapshot`).
- **Filling a previously-NULL field flipped the whole page.** `shown = neutralPrediction ?? prediction`
  worked only because neutral was mostly NULL; backfilling it made a dead branch live for 1,254 rows.
  **A `??` chain is not a precedence decision.**
- **THREE GUARDRAILS, all required:** (1) `_dirty` gate — a clean row is NEVER scaled; (2) base =
  neutral while dirty — scaling a BAKED snapshot is what compounded (.342 → .356); (3) `snapshotBacked`
  forces `devAggScale = 1` on a clean row (mirrors `PlayerProfile.tsx:986`).
  Sequence: toggle → dirty → scale neutral ONCE (the live bridge) → save bakes it → clean → verbatim.
- **The save bakes NEUTRAL × the toggle** (`playerProjection({...rp, _dirty:true})`), never a re-read
  projection — otherwise it writes the UNSCALED line while production_notes records the toggle.
- **Every local state update after a save must refresh EVERY snapshot copy** — `saveTargetToggle`
  updated only `transfer_snapshot`, so the row fell back to a stale `player_snapshot`: the flash
  up → down → correct-after-DB.
- **An effect with `exhaustive-deps` disabled closes over STALE state.** The auto-load effect re-runs
  on any refetch and wiped `_dirty` + the unsaved toggle; guard via a **ref**, not the array.
- **Roster vs board:** a player can hold two copies. Once rostered, **the board reads the roster's
  snapshot** (staging 32 / prod 47 synced, 0 differing). Board spells oWAR `owar`, market `nil_valuation`.
- **Slot is authoritative for side**, not snapshot content (Kenny Ishikawa's SP row held hitter fields).
- **Depth role drives IP/PA; market is STORED, not derived.** Neiswonger 30 IP → 85 ⇒ pWAR 1.14 → 3.329,
  $99k → $332,852.

⚠ **OPEN:** 10 staging / 18 prod pitchers with unverifiable pWAR (skipped, not guessed) · 1 wrong-side
neutral · JUCO PTM (Blair) · removal-from-roster semantics undefined · **the durable fix is ONE save
path owning every derived copy** — tonight's scripts are repairs.

Full detail: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


## ★ NEUTRAL SNAPSHOT SOURCING — VERIFIED 2026-09-01 (returner = global · transfer = precomputed)

**Rule:** predRank is *team-scoped FIRST, global SECOND, never another team's precompute.* A returner
has no precompute at his own school → global. A transfer's team-scoped row IS the projection INTO
that school; using global would project him at his CURRENT school.

**Measured on staging after the refill (side-aware):**
```
team_build_players  returner 1,213 → 0 team-scoped · 1,203 global · 0 WRONG
                    target      41 → 36 team-scoped ·     5 global* · 0 WRONG
target_board        transfer   154 → 150 team-scoped · 4 TWP-pitcher-side · 0 WRONG
                    returner    13 →  12 global                          · 0 WRONG
  * 5 targets have no precompute for that team yet — global is the documented fallback.
```
⚠ The 4 "wrong" rows were a BAD QUERY, not bad data — all Josiah Overbeek, a TWP whose PITCHER-slot
board rows correctly hold pWAR. `coalesce(o_war, p_war)` pulled his hitter oWAR off the same row.
**Every snapshot check must be side-aware; a TWP carries both sides on ONE prediction row.**

⛔ **The two neutral scripts are NOT interchangeable — the tables use different shapes.**
`team_build_players` pitcher neutral = VERBATIM prediction row (77 keys incl. `variant`,
`customer_team_id`) → `backfill-neutral-snapshots.ts` (**PLURAL**) `--refresh`.
`target_board` = NORMALIZED (13/15 keys) → `backfill-neutral-snapshot.ts` (**SINGULAR**)
`--target-board-only`. Running the singular one unscoped STRIPS the verbatim build keys.

✅ Toggle-safe, proven: 1,207/1,207 build + 167/167 board neutrals at `dev_aggressiveness = 0`, while
59 build + 17 board rows keep a non-zero toggle in `production_notes`, untouched.
⛔ NEVER add a refresh flag to anything writing `player_snapshot`/`transfer_snapshot` from predictions.

Full runbook + exact commands: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


## 🛑 SNAPSHOTS ARE COPIES — A PRECOMPUTE DOES NOT REFRESH THEM (2026-09-01)

**Symptom:** *"player profile is showing properly on staging but team builder is not."* That IS the
diagnosis. Player Profile / Dashboard / Top 5 read `player_predictions` **directly** (fresh instantly).
Team Builder / Target Board / GM hub read a **SNAPSHOT COPY** frozen at write time. Nothing cascades.

**Measured on staging right after the returner + transfer recomputes:**
```
team_build_players.player_snapshot   604 rows · 296 STALE · worst gap 3.907 WAR
team_build_players.neutral_snapshot  586 rows · 310 STALE
target_board.transfer_snapshot        74 rows ·  62 STALE · worst gap 50.0 wRC+
```

**RUN ORDER — predictions first, snapshots LAST:**
1. `precompute-returner-pitchers` → `precompute-returner-hitters` (pitchers FIRST; shared `market_value`, hitter must be last writer)
2. per team: `precompute-transfers -- --team <uuid>` + `precompute-pitchers -- --team <uuid>` (14 prod / 18 staging)
3. `backfill-build-snapshots -- --apply --force` ⚠ **`--force` REQUIRED** — without it the script only fills `player_snapshot IS NULL` rows and ours are populated-but-stale → **silent no-op**
4. `scripts/backfill-target-transfer-snapshots.ts --apply`
5. `scripts/backfill-snapshot-total-hitter-war.ts --apply` — MUST be last; steps 3/4 write `o_war` only. ⛔ It *skips snapshots that already have* `total_hitter_war`, so it only works because 3/4 overwrite the object first. **Never run it standalone after a recompute.**

⚠ **OPEN GAP: `neutral_snapshot` has NO refresh path.** `backfill-neutral-snapshots.ts` is `IS NULL` only, no `--force`. The 310 stale rows cannot be refreshed by any existing script, and it is the dev_agg=0 base every toggle reads. **NOT FIXED.**

**Named gate — Naulivou Lauaki Jr. (Oregon, R-FR):** wRC+ **113 → 101**, oWAR 0.966 → 0.436, market **$24,260 → $9,671**. ✅ verified on staging AND prod. Market moves ~60% on a 12-pt wRC+ change because oWAR scales off `(wRC+ − 100)` — arithmetic, not a bug.

Full runbook + SQL verify gates: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


## ★ 2026-09-01 (PM) — CENTRES · total_hitter_war · CROSS-IMPL DIFF (commit `ffc161d`)

🛑 **New required gate: diff the deployed edge function against the local precompute over the same
team.** Code review, typecheck and eyeballing the output ALL passed on a function giving every `IF`
player a 10% market shortfall. Only the row-by-row diff caught it.
**Georgia, staging:** hitters **7,814/7,814 identical** (incl. market, after the `IF` fix);
pitchers **1,754/1,755 at IP>=40** — ⚠ sub-40 IP diverges (33% under 10 IP). **OPEN.**

- **Centres**: `predictionEngine` returner hitters were hardcoded at 100 and read `model_config` zero
  times; `transferPitcherProjection`'s `prCenter` params existed but **no caller passed them** (bb9's
  true centre is 121.68); `dsd` split at 100 in both transfer copies vs `prCenter` in
  `projectPitchingRate` — now the stored average everywhere. OBP correctly did not move (centre ≈100).
- **`total_hitter_war`**: six selects omitted it, so snapshots carried the oWAR COMPONENT (Helfrick
  2.5 → 5.02). `market_value` was in every select and always right — that asymmetry found it.
  **No backfill needed**; 0 hitter rows affected on either DB.
- **`IF`/`INF`/`INFIELD`** missing from the edge function's 1.1 tier — would have hit Georgia Tech's
  whole infield.
- **`from/to_*_plus` mean different things by `model_type`** — player rating on returner rows,
  CONFERENCE avg+ on transfer rows.
- **Last live compute removed** from the TeamBuilder add path (102 lines).
- **Loud fallbacks shipped** — unresolved `model_config` keys are now named, not silent.

✅ **RETRACTED 2026-09-01:** an earlier version of this block listed a `total_hitter_war` rounding
drift as OPEN. **It is not real.** Stored `total_hitter_war` = `o_war + d_war + bsr_war` EXACTLY on
**102,420/102,420** staging and **105,281/105,281** prod transfer rows (max drift 0.00000000).
The claim came from measuring the LOCAL components against the EDGE total — which proves the edge is
exact and says nothing about the local total. 🛑 Same error as the "sub-40 pitcher divergence": two
GENERATIONS of a row compared as if they were two IMPLEMENTATIONS. **Prove both sides are FRESH
before diffing.**

**Staging only — PROD UNTOUCHED.** Full detail: Track B (`docs/PIPELINE_pitch_log_to_projections.md`).


Reusable lessons from running the push live against prod (`trbvxuoliwrfowibatkm`). Pair with the runbook
(`docs/PROD_PUSH_STEPS_2026_08_26.md`), the resume handoff (`docs/PROD_PUSH_HANDOFF_RESUME_2026_08_26.md`), and the
live ledger (`PROD_MIGRATIONS_TODO.md`).

## ★ THE #1 PATTERN — the runbook has ad-hoc gaps; reconstruct from staging, COMMIT, then apply
Several runbook steps reference ALTERs / backfills / helper tables that were done **by hand on staging with NO
committed migration or script**. When you hit one, DO NOT improvise blind and DO NOT skip:
1. Diff **staging** (the verified reference) against **prod** — column lists via `select * limit 1` → `Object.keys`;
   types via a temp `information_schema.columns` fn on staging (staging writes are OK).
2. Generate the exact DDL/SQL/script matching staging.
3. **Commit it** (close the gap permanently) → apply to prod → verify.
Already reconstructed + committed this way: `20260826160000_war_recalibration_gap_alters.sql` (A8 ConfStats
run_env_factor/hitter_talent_plus, A9 Park 10×`*_seasonal`, A11 pitcher `ip`); `20260826160500_masters_source_season_unique.sql`
(A11 Masters UNIQUE); `scripts/sql/fix_pitcher_full_names.sql` (C19); `scripts/backfill_park_code_load.ts` rewritten
prod-capable (C20). **Expect MORE in C21–C29 + beyond** (staging-hardcoded scripts, missing UPDATE-SQL, missing helper tables).

## ★ MECHANISMS (verified live)
- **Raise statement_timeout through `exec_sql`:** prepend `set local statement_timeout='900s';` to the SQL. CONFIRMED
  it overrides PostgREST's ~8s default (`pg_sleep(12)` completed under a `SET LOCAL 30s`). Use for every big UPDATE.
- **Gateway HTTP timeout ≠ rollback.** A long `exec_sql` call returns `upstream request timeout` to the client at ~125s,
  but the **DB transaction keeps running and COMMITS server-side** (single-statement txn = all-or-nothing). Always
  **verify with a separate read** after — don't assume failure. (C19's UPDATE looked "failed" but committed table-wide.)
- **Big UPDATEs: filter `is distinct from` in a SINGLE pass, never a scan-to-find + LIMIT batch loop.** The batched
  `... where col is distinct from correct limit N` approach re-scans the whole table each batch and TIMES OUT when few/no
  rows remain (worst case = an already-fixed table). A single `UPDATE … WHERE is distinct from …` (one pass, join on the
  PK/indexed key) is correct + idempotent (re-run = 0 rows).
- **Dup checks: paginate with a STABLE UNIQUE order (`id`).** `.range()` ordered by a non-unique column (or no order)
  repeats/skips rows at page boundaries → FALSE dups (A11 first showed 5/7 phantom dups; id-ordered scan showed 0).
- **PostgREST count() times out on huge tables** (pitch_log 2.5M). Use `count:"estimated"` (reltuples, instant) or an
  early-stop `.limit()` presence check; for an exact count on a filtered subset, have the operator run it in the SQL
  editor or use a temp fn with a raised local timeout.
- **PostgREST schema-cache staleness:** after `create table`/`function` via exec_sql, `NOTIFY pgrst,'reload schema'` +
  wait ~2.5s before `.from()`/`.rpc()` the new object. A "could not find table in schema cache" error ≠ the object is missing.
- **Staging-hardcoded scripts:** several backfill scripts hardcode the staging URL + read `.env.local`. Rewrite them
  env-driven with a `--prod` guard (`if IS_PROD ⟺ prod URL`) before running on prod.

## ★ VERIFIED-CLEAN prod facts (so we don't re-check)
- pitch_log is CURRENT (date range 2026-02-13→06-22 = full season, same as staging) + raw columns (velocity/ivb/hb/
  exit_velo/launch_angle/pitch_type/cs_prob) identical to staging. **No ingest needed.**
- Defensive data present + current (`player_season_defense` 13,454 / `player_season_baserunning` 10,432, engine 0.11.0;
  DRS CSVs in `scripts/drs/output/`). **No defensive/positioning upload needed** — Phase C/D only regenerate.
- model_config = **220 keys** on prod = staging (201 step8 seed + 19 calibration; the runbook's "201" was the seed count).
- pitcher_id in pitch_log = players.source_player_id (join key for the name fix).

## ★ SAFETY POSTURE
Displays pure-read stored predictions → prod shows OLD consistent numbers until Phase E recomputes; nothing half-broken.
Every prod write: dry-run/understand → "prod, now?" → apply → log the row in `PROD_MIGRATIONS_TODO.md` before moving on.

## ★★ LARGE pitch_log UPDATES ON PROD — Disk IO throttling & the KEYSET method (learned the hard way, 2026-08-27)
The single hardest part of the push. A full-table UPDATE of ~2.5M pitch_log rows (park_code) took **hours of failed attempts**
before it worked. If we ever do a big pitch_log rewrite again (is_conf, sequence, Stuff+, or a future migration), THIS is how.

### The root constraint — Supabase disk IO, not SQL
- Supabase runs **AWS gp3 disks: 3,000 IOPS floor** (every small project has exactly this — NOT the differentiator).
  What actually throttles a big write is **disk IO BANDWIDTH (MB/s), and that is set by the COMPUTE add-on tier**, not the disk.
  Each tier has a **baseline** throughput + a **burst** it sustains for a while: Nano/Micro ~87 Mbps baseline / ~2,085 burst,
  Small ~174, Medium ~348, Large ~630. **Burst lasts ~5 min flat-out, then it drops to baseline (~11–22 MB/s) = a CRAWL.**
- That baseline/burst cliff is the whole story: a 2.5M-row rewrite (heap + **index maintenance** for every non-HOT update) is
  far bigger than the burst budget, so a naive flat-out UPDATE burns burst in minutes then crawls at baseline. Prod
  `trbvxuoliwrfowibatkm` = 12 GB disk / 3,000 IOPS, **Pro plan** (so compute CAN be scaled up for the window, then back down —
  a few $ prorated, ~6-hr gp3 cooldown on disk changes but compute scaling only costs a ~1–2 min restart).
- **Why staging felt effortless and prod didn't:** NOT data volume (staging pitch_log is *bigger*: 3,667 MB / 2.59M rows vs
  prod 2,628 MB). Staging either sat on a bigger compute tier and/or every op there ran on a **rested disk with full burst**.
  On prod we ran a pile of failed retries back-to-back, so it was pinned at baseline the whole time. A 1-row `count(*)` took
  **17 s on an idle prod disk** — the baseline is genuinely that low.

### What does NOT work (all tried, all failed)
- **Single atomic UPDATE through the HTTP path** (`exec_sql`/PostgREST OR the Supabase SQL editor). The gateway cuts the client
  connection at ~2 min ("failed to fetch"); the query keeps running server-side but **rolls back on commit** because the client
  is gone. Confirmed 3×. (C19's smaller UPDATE only survived because it finished *before* the cut.)
- **Single UPDATE with a `statement_timeout` cap** (30-min, then 60-min) over a direct session — the write genuinely needs
  MORE than the cap on a throttled disk, so it hits the cap and rolls back. All-or-nothing = every failure loses everything.
- **Batching by `ctid` block ranges** — ctid is a physical row address; a concurrent/prior **VACUUM FULL rewrites every ctid**,
  so ranges silently point at wrong rows. Also slow (rebuilds the join hash per batch if planned wrong). DO NOT batch by ctid.
- **`VACUUM FULL pitch_log` mid-migration** — ACCESS EXCLUSIVE lock, rewrites whole table+indexes, IO-brutal; reclaimed 40%
  (3,049→1,822 MB) but ironically packed pages to fillfactor 100 → **no room for HOT updates → full index maintenance** on the
  next UPDATE. Use plain `VACUUM ANALYZE` if anything; save FULL for confirmed severe bloat, run alone, off-hours.
- **Tight 3-second pauses between chunks** — nowhere near enough for the burst budget to recover; pace degraded 5.6→12.5→37 min/slice.
- **"Just wait for it to rest"** — doesn't fix it: idle only refills BURST (~5 min of fast work), never the baseline. And a
  killed/failed UPDATE leaves ~1 GB dead tuples → autovacuum then hammers the same disk, so "the idle hour" was never idle.

### What WORKS — keyset pagination over a DIRECT session (`scripts/_pc_keyset.ts`)
- **Connect DIRECTLY, not via the gateway.** Use the `pg` driver (`npm i pg --no-save`) with the **session-mode pooler URL**
  (`supabase/.temp/pooler-url`, port 5432, Supavisor) + the **DB password** (dashboard → Settings → Database → Database password;
  inject it into the pooler URL at runtime via env, NEVER write it to a file). Direct TCP session = no HTTP gateway timeout,
  holds to completion.
- **Batch by a STABLE key (keyset on the PK `uniq_pitch_id`), never ctid.** Per batch: pick the upper bound =
  `max(uniq_pitch_id)` of the next PAGE ids `> last` from the source table, then `UPDATE ... WHERE key > :last AND key <= :hi`.
  Join keyed on the PK **both sides** (`_park_code_fix` PK + pitch_log PK) → index range scan, no hash rebuild.
- **`is distinct from` guard** → idempotent + **RESUMABLE** (skips already-done rows; a re-run after any interruption is free).
- **Per-batch commit** (autocommit) → progress persists; **throttle ~300 ms** between batches so burst budget breathes.
- **PAGE=20,000** landed each batch in **~7–13 s WHILE BURST LASTED** (~first 20 batches / ~10 min) — vs 5–37 MIN for ctid slices.
  BUT once burst depletes it drops to **~50–146 s/batch at baseline**, so a full 2.5M-row rewrite on the **free tier still COMPLETES
  and stays safe/resumable but takes ~1.5–2.5 HOURS**, not the 25–35 min the burst pace suggests. **To keep it in the fast range the
  whole way, SCALE COMPUTE UP for the window** (then the ~130 batches finish in ~20–30 min) — this is the real payoff of the bump.
  Live progress appended to a log file (stdout is block-buffered when piped through grep, so the task .output looks empty — read the log).
- **One heavy job per table at a time** — never run two big pitch_log writes (or a vacuum) concurrently; IO compounds multiplicatively.
  Chain sequential jobs at the SHELL level: `while pgrep -f "<prev_script>"; do sleep 30; done; npx tsx <next_script>`.
- **Combine env-independent columns into ONE pass** — is_conference_game + sequence (pitch_num_in_game/ab_num_in_game/pitch_num_in_ab)
  are all env-independent → source their correct values from STAGING (keyed by uniq_pitch_id) into a prod `_derived_fix` table, then one
  keyset UPDATE sets all four (`scripts/_next_derived.ts`). Writes each row once instead of N times.
  ⚠ **PostgREST caps `.select().limit(N)` at 1000 rows/request** (server max-rows) — when paging STAGING via supabase-js to build the fix
  table, use PAGE=1000 and break ONLY on an empty page; **never** `if (data.length < PAGE) break` (it stops after the first page and
  silently loads only 1000 rows). For a big cross-env copy use a DIRECT pg connection if you have the password, else 1000-row keyset pages.

### Monitoring & control mechanics (also gateway-independent)
- When the disk is saturated the **gateway (`exec_sql`) returns null/timeout even for tiny metadata queries** — the direct
  `pg` connection still gets through. Use it to read `pg_stat_activity`, sizes, counts.
- **Killing a runaway query:** `pkill` the local script only kills the CLIENT — the **server-side query keeps running** (Supavisor
  holds it) and the gateway cancel fails when saturated. Must `pg_terminate_backend(pid)` over the **direct** connection.
- **Progress proxy without a full scan:** `pg_total_relation_size('pitch_log')` (cheap catalog read) grows as an UPDATE writes
  new tuple versions — track growth vs the post-write estimate for a rough %. (Full `count(*) filter(...)` competes for IO — avoid mid-run.)

### PRE-FLIGHT CHECKLIST for any big pitch_log (or large-table) write on prod
1. Batch by a **stable key / keyset (PK)**, not ctid. 2. **One heavy job per table** — check `pg_stat_activity` (direct conn) first.
3. **Throttle** between batches (≥300 ms). 4. Every join key **indexed on BOTH sides** (source/fix table included). 5. **No VACUUM
   FULL** alongside (plain `VACUUM ANALYZE` after if needed). 6. Run over the **direct pooler session**, not the HTTP gateway.
7. Make it **idempotent/resumable** (`is distinct from`). 8. If it's a genuine one-time heavy lift, **scale compute up for the
   window, then back down** (Pro plan) — cheaper than a prod slowdown; or just run the keyset version at baseline (slower, still finishes).

## ★ RECOVERING A LOST IN-DB DERIVATION FROM `pg_stat_statements` (2026-08-28)
A load-bearing derivation (the Stuff+ "classifier v2" that produced staging's `pitch_type_reclassified`) was run as ad-hoc
in-DB SQL and NEVER committed — only its output survived. It was **recovered from staging `pg_stat_statements`** (extension
enabled). Reusable technique:
- Query `pg_stat_statements` for `query ilike '%<table/keyword>%'`, `order by length(query) desc`. Scripts that INSERT computed
  results show as giant `insert … values ($1,$2),…` (thousands of rows); the actual LOGIC is the CTE `with … select … case … end`
  at the TAIL of the longest queries — grep out the `($N,$N)` VALUES lines to isolate it.
- ⚠ **Constants are NORMALIZED to `$N`** — you recover the exact STRUCTURE (CTEs, joins, CASE order, features) but NOT literal
  thresholds/labels. Fill those from the design doc + FIT against the stored OUTPUT (here `_reclass_result`).
- Confirmed recoverable here: the classifier CASE, the seed aggregation (`select … avg(ivb),avg(armhb),avg(gap) … group by pid,seed`),
  the primaryFB compute, the propagation `update pitch_log … from _reclass_result … ctid`-batched. **Lesson: never run a
  load-bearing derivation as ad-hoc in-DB SQL (commit it) — but if it happened, `pg_stat_statements` may still hold the structure.**

## ★★ SESSION 2026-08-28 — bulletproof audit + config resolution + landmine cleanup + classifier Tier-1 exhaustion

### Classifier recovery: Tier-1 EXHAUSTED — v2 reclassifier is UNRECOVERABLE
Searched EVERY reachable source for the committed v2 classifier that wrote staging `_reclass_result`/`_reclass_map`/`_reclass_pf`:
git pickaxe ALL branches (`4S FB`/`pf_velo`/`_reclass_result`), dangling/lost objects, stashes, `staging-preview` checkout, VSCode
local history, shell+psql history (empty), and ALL Claude Code session transcripts (code tokens appear ONLY in this session; the
Aug-19 build transcript 6de1d4f8 matched the *prose* label `4S FB` not code; `pg_stat_statements` strips literals to `$N` by design).
**Verdict: ran as ad-hoc SQL in the Supabase SQL Editor, unsaved → gone. Survives ONLY as `_reclass_result` output (2M labels = answer key).**
→ Tier 2: reconstruct boundaries FROM `_reclass_result`, ≥95% per-pitch, then regenerate on prod. Lesson: any prod-bound derivation
MUST be committed code, never SQL-editor scratchpad — the exact thing that lost this.

### Bulletproof prod-push audit (reusable pattern)
8-dimension read-only Workflow (migration-ledger, schema-diff, stuffplus-chain, war-defense-composite, team-conf-park-env,
precomputes-snapshots, edgefn-code-deploy, runbook-order-safety) → synthesis → `docs/PROD_PUSH_BULLETPROOF_CHECKLIST.md`.
Verdict NO-GO: 5 blockers, 11 high. ROOT dimensions in the ACTUAL branch↔prod diff (git diff main...branch = 809 files/82 migrations;
ledger [x]/[ ]) not generic categories. **Workflow-hang recovery:** one agent hung ~37min (journal showed 8 started/7 result, stale
mtime); `TaskStop` the run then `Workflow({scriptPath, resumeFromRunId})` — the 7 done agents return CACHED, only the hung one re-runs.

### Equation constants live in FOUR copies that drift (the real "run the function isn't enough")
(1) committed TS (war.ts/pitcherQuality.ts/powerRatings.ts), (2) `model_config` DB rows (runtime), (3) in-DB SQL functions
(`refresh_composite_war` ÷13.1, `batting_rv`), (4) edge-fn hardcoded fallbacks. Fix = one canonical source → seed model_config →
strip edge-fn literals → align DB fns → parity test → recompute once. [[feedback_precompute_math_duplication]]

### Config divergence RESOLVED — CRITICAL distinction: DERIVED-per-env vs hand-set WEIGHT
Direct prod↔staging `model_config` diff (tool: `scripts/_cfg_dump.ts`). Two buckets, do NOT conflate:
- **DERIVED** (`*_ncaa_avg`/`*_ncaa_sd`/`*_std_pr`/`shrink_k`): computed from each env's DATA → SUPPOSED to differ; prod holds the
  fresh `step8_model_config_2026.sql` recalibration + REGENERATES in C27. NOT a bug. Never "sync" these — regenerate-on-prod owns them.
- **WEIGHT** (`*_pct_weight`): hand-set model design → MUST match code across envs. 2026 weights CLEAN (62 keys, 0 diffs). Only
  2025 weights drifted (prod stale; committed code=staging) → HISTORICAL, deferred (2026 push doesn't recompute 2025). G15 downgraded.

### Landmine cleanup
`20260710120000_gm_allocations_per_build.sql` had a live `TRUNCATE gm_allocation, gm_allocation_source` inside a stale `[ ]` ledger
block → NEUTRALIZED (commented out + banner in file; ledger flipped `[x]` + DO-NOT-RE-RUN). Pattern: already-applied destructive ops
get DISABLED-with-banner (idempotent `IF NOT EXISTS`/`SET NOT NULL` below still work on fresh replay). `player_slot_values` DELETEs
= safe keep-lowest-id dedup. `DROP POLICY IF EXISTS…CREATE POLICY` pairs idempotent; bare `CREATE POLICY` (pitch_log_rls) just errors on re-run.

### First ~19 prod steps are NON-destructive (verified)
NO branch migration creates a trigger → nothing auto-recomputes. First 19 are additive (new cols/tables/backfills) or one-time fixes;
only Phase B overwrote model_config but displays pure-read STORED predictions (no recompute until Phase E). Divergences (config,
÷10 vs ÷13.1) are LATENT — only bite on a MANUAL recompute, all gated. Prod sits on old consistent ÷10, display-safe, reversible.

---

## ★★★ LESSON — A CONSTANT WITH NO KEY IS A DEPLOY. AND ITS FALLBACK IS SILENT. (2026-09-01) ★★★

> Trevor's standing rule: *"we don't want anything hardcoded and unchangeable, that's my main thing."*

**The generalisable failure is not the VALUE — it is the SILENCE.** Every config bug found on
2026-09-01 has the identical shape: a lookup misses, a plausible default takes over, and **nothing
anywhere says so**. The number that comes out is well-formed, in range, and wrong.
- Stage 5.5 wrote 41 keys that were never read — because they weren't in the `fields` mapping.
- The z-shift assumed PR+ centres at 100 — a default nobody chose, that nobody could see.
- The legacy `"Equation Weights"` table quietly outranked the code for 5,122/5,122 returners.

**⇒ The mitigation is not "pick better defaults." It is to make every fallback LOUD.**
`readEquationValue` and both edge-function overlays must log every key they could not resolve. A
missing key should be a line in the log, not an invisible substitution. Do this BEFORE seeding new
keys — otherwise the seeding itself can't be verified.

**MEASURED SCOPE (`src/lib/pitchingEquations.ts`, `DEFAULT_PITCHING_WEIGHTS`, 115 constants):**
**49 tunable via `model_config` · 66 NOT** — 24 class transitions · 12 composite weights · 12 SP↔RP
role transition · **9 market/dollars-per-WAR** · 6 plus scales · **3 projected IP per depth role**.
⚠ `market_dollars_per_war` / `market_tier_sec` mean **a program's pay-per-WAR cannot be retuned without
shipping code** — a business lever living in a source file. `pwar_ip_sp/rp/sm` drives every pWAR.
✅ Nothing is broken today: all 127 edge-fn constants resolve correctly (46 overlaid from `model_config`
· 72 identical to `src/lib` · 9 differ but are read via `readEquationValue`, which checks `model_config`
FIRST). Onboarding uses the same numbers as the batch — Georgia Tech is **not blocked** by this.

**⛔ SEEDING IS NOT MECHANICAL — SETTLE NAMING FIRST.** `loadPitchingPowerEq` filters to `p_`-prefixed
keys only, and `market_*` is shared with the hitter market path, so it is not a pitching-domain key.
Writing a key under the wrong prefix recreates the written-but-never-read problem exactly. Decide the
prefix, THEN write, THEN confirm the key is in the `fields` mapping — a key not listed there is INERT.

**SEQUENCING (method, not preference):** do the seeding as its OWN pass, AFTER the recompute is
verified. Landing a market/pWAR change inside the same verification window as the calibration fix
means two uncontrolled changes and no way to attribute a delta to either.
Full plan + ordering: `docs/HANDOFF_2026_09_01_CONFIG_SOURCES_AND_CALIBRATION.md` and Track B
(`docs/PIPELINE_pitch_log_to_projections.md`).
