# 🔬 AUDIT — THE RUNBOOK IS ORDERED BY TOPIC, NOT BY DATA DEPENDENCY (2026-08-30)

**Thesis under audit (Trevor):** *"The runbook was organized by topic, not by what-feeds-what. The timing matters way
more than topic order."*
**VERDICT: CONFIRMED, and it is worse than the phrase suggests.** The topic order is not merely sub-optimal — it
contains at least one step that **reads a table a later phase creates**, and one required step that **appears in no
runbook at all**.

**Method:** extracted every `.from(x).select` (READ) and `.from(x).{update,upsert,insert,delete}` (WRITE) from every
remaining step's script, resolved the helper-wrapped ones by hand (`all()`, `fetchAll()`, `upsertChunks()`,
`loadAllPaged()`), and read the SQL body of `refresh_team_season_stats` line by line. Table-level first, then
column-level for every edge that crossed a phase boundary.

---
## 1. WHY TOPIC ORDER PRODUCES WRONG NUMBERS SILENTLY
The phases are named for **what kind of thing** they do — A schema, B config, C producers, D defense, E precomputes,
F re-bakes, G deploy, H drops. That is a table of contents. The order the math actually requires is set by exactly one
relation: **step X reads a column step Y writes.**

These two orderings only coincide by luck. And when they diverge, **nothing fails**:
- the column is present, so a `count(*)` gate passes
- the script exits 0, so an exit-code gate passes
- the value is merely **old**, or a default, or zero

That is the entire failure mode of this push. Every defect found so far — C24's legacy lane, C27-before-C26,
C29-before-C28, Conference Stuff+, D31→D32, E2→`derive_conf_opr_htp` — is a dependency edge the topic order got wrong,
and **not one of them raised an error.**

---
## 2. 🔴 THE INVERSION — **PHASE E READS A TABLE PHASE F CREATES**
| | |
|---|---|
| **E38a** `precompute-transfer-projections.ts:225` | `.from("team_season_stats").select("source_id, faced_stuff_plus")` |
| **E38b** `precompute-pitchers.ts:279` | `.from("team_season_stats").select("source_id, faced_htp")` |
| **F44** `select refresh_team_season_stats(2026)` | **the ONLY producer of that table — and it is the LAST step of Phase F** |
| **PROD TODAY** | `team_season_stats` = **0 rows** |

Phase E runs ~6 steps **before** Phase F. So as written, the transfer precomputes read an **empty table**.

**AND IT FAILS SILENTLY — the error is never checked:**
```ts
const { data: facedRows } = await (supabase as any)
  .from("team_season_stats").select("source_id, faced_stuff_plus").eq("season", CURRENT_SEASON);
for (const fr of (facedRows || [])) …          // ← `error` destructured away; `|| []` swallows the empty case
```
Result: `facedStuffBySourceId` is an **empty Map**, every Independent-program lookup misses, and the
**faced-competition adjustment silently does not apply** to those players' projections. The only trace is a log line
reading `0 team_season_stats faced_stuff_plus rows` — a number that looks like data, not like an error.

★ **The docs already flagged this exact dependency — but only for the EDGE FUNCTION (G46), not for the batch scripts
that do the same read 20 steps earlier.** `PROD_PUSH_STEPS:426-432` correctly gates G46 on `team_season_stats` being
populated. Nobody carried that gate back to E38, which reads the same two columns for the same reason. **The
dependency was known and filed under the wrong topic.**

---
## 3. ✅ NO CYCLE — SO THE FIX IS A CLEAN REORDER
The obvious worry is circularity: if `refresh_team_season_stats` read `player_predictions`, then E needs F and F needs
E and there is no valid order. **It does not.** `grep -c player_predictions` on
`supabase/migrations/20260819010000_refresh_team_season_stats.sql` = **0**.

Its actual inputs, read from the function body:
| step | reads | satisfied by |
|---|---|---|
| 1–2 | `"Hitter Master"` / `"Pitching Master"` `desc_owar, d_war, bsr_war, total_desc_war, desc_pwar, desc_ra9, desc_fip_ra9` **+ every `_reg` variant** | **PHASE D (D31 + D32)** |
| 3–4 | `pitch_log_hitter_totals` / `pitch_log_pitcher_totals` / `pitch_log` | Phase C ✅ done |
| 7 | `team_war_snapshots` incl. **`team_drs`** | **D29b** |
| 8–9 | `pitch_log` ⋈ conference **Stuff+ / HTP** | C28 ✅ done |
| 10 | **`"Park Factors"`** (park snapshot) | **E2** |
So **F44 depends on D + E2, and E38 depends on F44.** A total order exists.

---
## 4. 🔴 THE MISSING STEP — `regular_season_ip` IS DIVIDED BY, IS ZERO ON PROD, AND IS IN NO RUNBOOK
`refresh_team_season_stats.sql:143`:
```sql
sum(pm.desc_ra9_reg * pm.regular_season_ip) / nullif(sum(pm.regular_season_ip), 0)  AS ra9_r
```
**PROD: `regular_season_ip` = 0/5,375 and `regular_season_pa` = 0/5,340** (staging: 5,374/5,377 and 5,339/5,343).
With the column empty, `nullif(sum(...), 0)` → **NULL**, so every regular-season rate F44 computes lands **NULL** —
no error, no warning, just a quietly half-empty `team_season_stats` feeding the faced-competition lever.

Its producer is `scripts/lock-season-cli.ts` / `src/lib/lockRegularSeason.ts` ("Lock Regular Season 2026").
**A repo-wide search finds it in NO numbered step of ANY runbook** — the only three hits are the advisory notes added
on 2026-08-30, all of which say "will bite a later phase." **It bites at F44.**
→ **ADD IT AS A NUMBERED STEP (proposed `D33b`), before F44.** Also note D32 writes the `desc_*_reg` values that get
weighted by this column, so lock-season must precede F44 but its relationship to D32 must be confirmed before running.

---
## 5. THE CORRECTED ORDER, DERIVED FROM THE GRAPH (not from topic)
```
D29b  DERIVE team_drs on prod (derive_team_drs.mjs)  team_war_snapshots.team_drs  → needed by D31 and F44 step 7
      ★ reads player_season_defense + Masters, so it must follow D30 and precede D31. NOT a paste of stored values.
D30   dRS/wSB load (no-op on prod) ......... player_season_{defense,baserunning}
D31   populate_descriptive_war ............. Masters desc_owar/d_war/bsr_war/total_desc_war/desc_ra9/drs_behind
D32   populate_descriptive_war_reg ......... Masters desc_*_reg          ★ must follow D31 (reads drs_behind, NULL→0)
D33b  ★ NEW — Lock Regular Season 2026 ..... regular_season_pa / regular_season_ip   ← §4, currently in no runbook
E2    park factors seasonal ................ "Park Factors" seasonal + MAIN cols     ← rewrites rg_factor
C28c′ ★ RE-RUN derive_conf_opr_htp ......... Conference Stats run_env_factor / HTP   ← E2 invalidated these
F44   ★ MOVED UP — refresh_team_season_stats  team_season_stats (needs D + D33b + E2 + C28)
E35   TWP detector ........................ players.is_twp / position   ← must precede all precomputes
E36   returner pitchers ................... player_predictions
E37   returner hitters .................... player_predictions
E38   transfers (_run_step2_all) .......... player_predictions          ← NOW reads a POPULATED team_season_stats
F39   refresh_composite_war ............... player_predictions d/bsr/total   ← after E, as documented
F40 → F41 → F42 → F42b → F43 ............... snapshots / markets / target_board
G46   edge-fn deploy ...................... reads team_season_stats     ← already satisfied by F44
```
**Two structural changes vs the written runbook:** `F44` moves from **last in Phase F** to **before Phase E**, and a
brand-new `D33b` appears. Neither is a preference — both fall out of the read/write graph.

---
## 6. EDGES VERIFIED CORRECT (the topic order got these right — do not churn them)
- **F39 after E** ✅ — `refresh_composite_war` writes `player_predictions`, which E36/E37/E38 also write. Running it
  first would be overwritten. Documented order is right.
- **F40 → F41 → F42** ✅ — F40 reads `player_predictions`; F41c writes it; F42b reads it. Sequence is consistent.
- **E35 before E36–E38** ✅ — `run-twp-recompute` writes `players.is_twp`, which every precompute reads to generate
  both-side rows. Already marked ★ORDER in the docs.
- **C27 → C26 → C28** ✅ — corrected earlier this push, still correct.
- **G46 last** ✅ — reads `team_season_stats`, satisfied once F44 has run.

---
## 7. 🧠 WHAT THIS MEANS FOR TRACK B — THE ACTUAL DELIVERABLE
Track B is **one edge function that runs once per day**. A daily automated run has **no human** to notice that a column
is populated but stale, or that a lookup Map came back empty. So this audit is not push paperwork — **it is the
Track B specification.** Three requirements fall directly out of it:

1. **ENCODE THE DEPENDENCY GRAPH, NOT THE PHASE NAMES.** Track B's stage order must be derived from
   reads/writes — the same graph in §5. Topic grouping is a documentation convenience and must not survive into code.
2. **EVERY STAGE NEEDS A VALUE GATE, NEVER A COUNT GATE.** Each of these passed a count check while being wrong:
   Conference `Stuff_plus` 30/30 (stale) · `trackman_pitches` fully populated (from the wrong lane) ·
   `run_env_factor` 30/30 (about to go stale under E2) · `team_season_stats` faced-lookups returning an empty Map.
   **A stage is done when a stage-specific value gate passes, not when it ran.**
3. **NEVER SWALLOW `error` OR COERCE A MISSING INPUT.** The three shapes seen here — `const { data } = await …` with
   `error` discarded, `(rows || [])`, and `num(NULL) → 0` — each converted a missing upstream into a plausible wrong
   number. Track B must treat a missing upstream as a **hard stop**, exactly as
   `derive_stuff_plus_pop_baseline.ts` (sign check) and `conferenceScoutingAverages` ("run Compute NCAA Averages
   first") already do. Those two are the model to copy.

**The one-line lesson:** *the runbook answered "what kind of work is this?" when the only question that matters is
"what does this read, and who wrote it last?"*

---
# 🔬 ORDER AUDIT PART 2 — PHASES A, B, C (THE WORK ALREADY DONE). Was any of it run out of order, or since invalidated?
Trevor: *"you audited everything we already did as well included in that correct?"* — **Initially NO. Now yes.**
Part 1 audited only the REMAINING steps. This part runs the same read/write graph over the COMPLETED work and asks the
question that actually matters: **is anything we already ran now STALE because of something else we ran after it, or
something we are about to run?** Verified against prod, not reasoned.

## ✅ RESULT: EVERY COMPLETED STEP IS STILL VALID. Nothing already run needs redoing. Two near-misses, both clean.
| edge | verified | verdict |
|---|---|---|
| chain 1→2 | `derive_stuff_plus_pop_baseline` reads `_reclass_pf` + `pitch_log_corrected` (reclassifier outputs) | ✅ correct order |
| chain 2→3 | `compute_pitch_log_stuff_plus` reads `pitcher_stuff_plus_ncaa` (chain 2) | ✅ |
| chain 3→4 | aggregation reads scored `pitch_log` | ✅ |
| chain 4→**C27** | `computeNcaaAverages:347` reads **`pitch_log_pitcher_totals`** and weights Stuff+ by `stuff_plus_data_pitches` (`:24-26` — the LIVE pitch_log lane, explicitly NOT the legacy PSP-I) | ✅ correct lane AND correct order |
| C24→C28-4 | Conference Stuff+ = `Σ(Pitching Master.stuff_plus × trackman_pitches)/Σ(trackman_pitches)` — needs C24's `trackman_pitches` AND the chain-5 `stuff_plus` | ✅ both were run first |
| C27→C26 | `computeAndStoreScores` reads `ncaa_averages`, silently defaults if absent | ✅ C27 ran first (this was CORRECTED earlier this push) |
| C29→C28 | both C28 producers filter on `division` | ✅ C29 ran first |
| C26→C28-2 | `compute_conf_pitcher_env_plus` reads `"Pitching Master"` + `ncaa_averages` | ✅ |
| C27→C28b | `conferenceScoutingAverages` reads `ncaa_averages`, errors loudly if missing | ✅ |

## ✅ NEAR-MISS 1 — **PHASE D DOES NOT INVALIDATE PHASE C.** (Checked because it easily could have.)
If `computeNcaaAverages` (C27) or `computeAndStoreScores` (C26) read any `desc_*` / WAR column, then Phase D writing
those columns would make C26/C27 stale and force a re-run of the whole back half of Phase C.
**Grepped both for `desc_owar|desc_pwar|d_war|bsr_war|total_desc_war|drs_behind|regular_season_*`: ZERO hits.**
→ **Phase D and Phase C touch DISJOINT Master columns. No re-run needed.** ✅

## ✅ NEAR-MISS 2 — **D31 DOES NOT CLOBBER C26's POWER RATINGS.** (The dangerous shape would be a full-row upsert.)
`populate_descriptive_war.mjs:156` is **`.update(cols).eq("source_player_id",…).eq("Season",…)`** — a **PARTIAL column
UPDATE**, not `.upsert()` of a whole row. It writes only its own `desc_*` columns and leaves C26's
`ba/obp/iso_power_rating`, `pRV+`, `era⁺…` untouched. ✅
⚠ **BUT NOTE ITS ERROR HANDLING:** `:157` is `if (error) { console.error(…) }` — errors are **printed, not counted,
and not fatal**, inside a 10,715-update loop that then **exits 0**. Another "validate by CONTENT, not exit code" case.
**Gate D31 on the non-null counts, never on the exit code.**

## ✅ NEAR-MISS 3 — **C27 DID NOT OVERWRITE PHASE B's TUNED CONFIG.** (C27 upserts `model_config`, so this was real.)
`computeNcaaAverages:428` upserts `model_config` `onConflict: model_type,season,config_key` — it would silently
overwrite any Phase-B key it shares. **Verified on prod AFTER C27 ran:** `nil_tier_sec = 4.0` ✅ ·
`r_obp_std_pr = 31.89504` ✅ · **220 keys** (unchanged) ✅ · **6** `_sd_good`/`_sd_bad` keys with **0** still reset to 0 ✅.
C27's keys (`p_ncaa_avg_*` / `p_sd_*`, e.g. `p_ncaa_avg_stuff_plus = 100.0141`) are **DISJOINT** from Phase B's tuned
weights. **Phase B survived C27 intact.** ✅

## 🛑 DEFECT FOUND IN THE ALREADY-DONE WORK — THE VERIFICATION GATE ITSELF USES KEY NAMES THAT DO NOT EXIST
The documented Phase-B gate reads `obp_std_pr=31.89504, whip_pr_sd=37.19844, owar_repl_600`. **None of those key names
exist on prod.** The gate query returns **ZERO ROWS** — and a zero-row result reads as *"the config is missing"*, which
would send the next person chasing a non-existent Phase-B failure.
**REAL KEY NAMES (verified on prod, values all CORRECT):**
`r_obp_std_pr` = **31.89504** · `t_obp_std_pr` = **31.89504** · `p_whip_pr_sd` = **37.19844** ·
`owar_replacement_runs_per_600` = **21.22** · `pwar_replacement_runs_per_9` = **1.92** · `nil_tier_sec` = **4.0**.
✅ **Corrected INLINE** at the gate in `PROD_PUSH_STEPS` and at RUNBOOK rows 1–2 (which additionally carried the
superseded VALUES 37.13 / 32.41).

## 🧠 THE PATTERN ACROSS BOTH AUDIT PARTS
Part 1 (remaining steps) found **2 structural defects**. Part 2 (completed steps) found **0 invalidations but 1 broken
gate** — the verification query itself was wrong, which is the most expensive kind of error because it makes correct
work *look* broken and broken work *look* fine.
→ **Audit the GATES with the same rigour as the steps.** A gate that cannot fail, or cannot pass, is not a gate.

---
# 🚨 THE EXACT MATH + THE THINGS THAT MUST BE CAUGHT (2026-08-30). Every number here is VERIFIED ON PROD.
Consolidated so a reader never has to reconstruct a formula or a constant from prose. **If a number below does not
reproduce, STOP — do not proceed to the next stage.**

## 1. THE CONSTANTS (from `populate_descriptive_war.mjs`'s own banner, prod run 2026-08-30)
```
RPW 13.1   E2T 1.1373   replRA9 8.83   wOBA lg 0.3782   wOBA scale 0.947   offense replacement 1.62/600
```
`RPW = 13.1` is the divisor for **every** WAR quantity. ⚠ Older docs say ÷10 (Push-1 v1) — **SUPERSEDED**.

## 2. DESCRIPTIVE WAR — THE ACTUAL FORMULAS
```
HITTER   wraa            = ((woba − lgwOBA 0.3782) / wOBAscale 0.947) × PA
         desc_owar       = wraa/13.1 + (PA/600) × 1.62
         d_war           = Σ drs_floor (positions ≠ P) / 13.1
         bsr_war         = wsb_runs / 13.1
         total_desc_war  = desc_owar + d_war + bsr_war          ← IDENTITY, must hold to ≤0.002
PITCHER  drs_behind      = team_drs × (pitcher_IP / team_IP)     ← Σ over a team's pitchers = 0 EXACTLY
         desc_ra9        = 0.5 × (RA9 + drs_behind_per9) + 0.5 × (FIP × 1.137)
         desc_pwar       = (replRA9 8.83 − desc_ra9) × (IP/9) / 13.1
TEAM     team_drs        = Σ drs_floor(team) − (division Σdrs_floor / division ΣIP) × team_IP
                           ← innings-weighted centering PER DIVISION; Σ centered = 0 EXACTLY
```

## 3. THE VERIFIED PROD NUMBERS (Season 2026, division='D1') — compare against these
```
hitters 5,341 rows · desc_owar/d_war/bsr_war/total_desc_war = 5,340 each · _reg set = 5,322 each
pitchers 5,375 rows · desc_pwar/desc_ra9/drs_behind = 5,374 each · _reg = 5,372
avg desc_owar 0.3458   avg d_war 0.0103   avg bsr_war 0.0000   avg total_desc_war 0.3562  (_reg 0.3354)
avg desc_pwar 0.5108  (_reg 0.5385)       drs_behind −5.26 … 6.84       sum identity worst 0.001000
team_drs: 308 D1 teams · sum 0.00 · Arkansas 41.272 (raw_floor 43.757, team_IP 475.0)
Conference Stuff+ D1 99.15 · NJCAA_D1 96.00 · D2 93.00     p_ncaa_avg_stuff_plus 100.0141 · p_sd_stuff_plus 5.04577
Stuff+ per-pitcher gate: mean 99.3 · p50 99.3 · p10 93.1 · p90 105.7  (IDENTICAL prod ↔ staging)
```

## 4. 🛑 THE SIX THINGS THAT MUST BE CAUGHT — each PASSED a naive check while being WRONG
| # | what | the naive check that PASSES | what actually catches it |
|---|---|---|---|
| 1 | **Conference `Stuff_plus` stale (pre-v2)** — 101.17, should be 99.15 | `count(*) = 30/30` ✅ | compare the VALUE before/after; it is written by a **4th producer** (`conferenceStuffPlusV2`) the runbook omitted |
| 2 | **`trackman_pitches` from the LEGACY lane** — undercounts ~12.1 pitches/pitcher, only **638/5,367 (11.9%)** matched | column fully populated ✅ | check the LANE, not the fill: D1 must come from `pitch_log_pitcher_totals.total_pitches` @ `dimension_key='all'` |
| 3 | **`run_env_factor` goes stale under E2** — E2 rewrites `rg_factor`, which `derive_conf_opr_htp:10` reads | `30/30` before AND after ✅ | value must CHANGE from **101.879**; re-run `derive_conf_opr_htp` AFTER E2 |
| 4 | **Missing Master row (Kozeal, 287 PA, 20 HR)** | `5,340 = 5,340` ✅ | **MEMBERSHIP diff**, not a count — pitch-log PA ≥ qualifier with no Master row must be EMPTY |
| 5 | **`--create-new` structurally broken** — `:465` passes `"batting_team_id"` as `idCol`; query times out over 2,576,146 rows; `:451` discards `error` | exit 0, prints `0 new rows` ✅ | "0 created" ≠ "nothing to create" — gate on the MEMBERSHIP query, and NEVER swallow `error` |
| 6 | **Team split by `TeamID`** — one player on the 2026 uuid vs 16 on the 2025 uuid ⇒ Kozeal became his own 14-IP "team" | per-team values internally consistent ✅ · Σ centered = 0 **held at 309 teams** ✅ | **CARDINALITY gate**: assert D1 team count **= 308**, fail otherwise |

## 5. 🛑 SILENT-FALLBACK INVENTORY — a missing input yields a plausible WRONG number, with NO error
| producer | the coercion | consequence |
|---|---|---|
| `computeAndStoreScores.ts:206-211,:249` | missing `ncaa_averages` field → **hardcoded default** (`:212-215`) | wrong power ratings; **run C27 BEFORE C26** |
| `populate_descriptive_war_reg.mjs:79` | `num(NULL) → 0` on `drs_behind` | wrong `desc_ra9_reg`/`desc_pwar_reg`; **D31 must commit first** (gate: `drs_behind` 5,374/5,375) |
| `precompute-transfer-projections.ts:225` / `precompute-pitchers.ts:279` | `const { data } =` discards `error`; `(rows \|\| [])` | empty faced-competition Map ⇒ Independents lose the adjustment; **F44 must precede Phase E** |
| `refresh_team_season_stats.sql:143` | `nullif(sum(regular_season_ip),0)` → NULL | every regular-season rate NULL; **needs lock-season (`regular_season_ip` is 0/5,375 on prod)** |
| `compute_pitch_log_stuff_plus.ts` | `classification_version` filter mismatch | scores **0 rows, exits 0**; pass the stamp just written, never a literal |
| `derive_masters_from_pitchlog.ts:451` | discards `error` on a timing-out query | **no hitter row can ever be created** |

## 6. ✅ THE GATES THAT ACTUALLY WORK (use these, not counts)
1. **VALUE gate** — compare the number before/after, and to a reference env for the SAME season (2026 = descriptive, 2027 = projections).
2. **MEMBERSHIP gate** — diff the ID SET, not the count. Caught Kozeal.
3. **CARDINALITY gate** — assert the expected number of GROUPS (D1 = 308 teams). Caught the `TeamID` split.
4. **IDENTITY gate** — `total_desc_war = desc_owar + d_war + bsr_war` ≤ 0.002; `Σ team_drs = 0`; `Σ drs_behind = 0`.
5. **LOG-CONTENT gate** — read the log body, never the exit code. `0 FAILED` must be printed, not inferred.
6. **SIGN gate** — arm-side pitches positive armHB for BOTH hands (18/18 buckets), else ABORT before writing.

---
# ✅ E2 PARK FACTORS + MANDATORY C28-STEP-3 RE-RUN — APPLIED TO PROD 2026-08-30
## E2a — code fixes first (the docs already called for the guard; the banner was found during the dry run)
- double-keyed `--prod` guard + env-driven URL/key (was a **literal staging URL** + literal `.env.local` read).
- 🛑 **LYING BANNER FIXED** — `:215` printed `MODE: … target=STAGING` **while running against PROD**. Identical defect
  to `_run_store_no_propagate.ts` (C26). Now prints the RESOLVED env. **Third instance of this class.**

## E2b — DRY RUN + the TEAM-BY-TEAM GATE (a row count would have hidden this)
`_parkfactors_backup` verified **615 rows = 306 (2025) + 309 (2026)** before touching anything.
CSV 2026 = **308** teams vs PROD 2026 = **309** rows ⇒ delete+reinsert would drop one.
**Diffed BY NAME: the single dropped team is `Fort Wayne`.** ✅ **CORRECT — Trevor: they had no 2026 team.**
⚠ My first diff was WRONG and briefly reported "309 would be dropped" — my probe matched the CSV's **`teamId`**
column instead of **`team`** (`/team/i` hits `teamId` first). Corrected immediately. **The real name column is `team`
(index 3): `Rank,teamId,teamName,team,teamFullName,…`.** Do not re-derive this by regex; use the literal column name.

## E2c — APPLIED. `✓ Wrote 922 rows across 2024/2025/2026 (seasonal + main).`
| season | rows before → after | `rg_factor` | **`rg_factor_seasonal`** |
|---|---|---|---|
| 2024 | *(absent)* → **307** | 307 | **307** |
| 2025 | 306 → **307** | 307 | **307** |
| 2026 | 309 → **308** | 308 | **308** |
**`rg_factor_seasonal` 0/309 → fully populated — the objective of E2.** Georgia 2026 `rg_factor` = **109.35**,
exactly the dry-run's predicted rolling value; `rg_factor_seasonal` = 107.76 (single-season). Fort Wayne now present in
2024/2025 only. ⚠ `source_team_id` is 306/307 for 2024 and 2025 (2 unmapped historical teams) — 308/308 for 2026.

## ★ E2d — THE MANDATORY RE-RUN, AND THE NUMBER THAT PROVES IT
E2 rewrites the **MAIN** factor columns (current season → 3-yr rolling), and `derive_conf_opr_htp.ts:10` reads
`"Park Factors".rg_factor`. Measured rewrite magnitude from the dry run:
```
RG  mean|Δ| 2.16  max|Δ| 7.24 (n=308)   ISO mean|Δ| 2.11  max 7.07   AVG 0.65   OBP 0.38
worst: Monmouth/rg 100.3→93.06 · Mississippi Valley State/rg 134.44→127.52 · Northern Colorado/rg 121.5→115.08
```
`npx tsx --env-file=.env.production.local scripts/derive_conf_opr_htp.ts --apply --prod` → **APPLIED 30 rows.**
| | BEFORE | AFTER |
|---|---|---|
| `run_env_factor` **count** | **30/30** | **30/30** ← ⚠ **IDENTICAL — a count gate PASSES either way** |
| `run_env_factor` **avg** | **101.879** | **99.719** (**−2.16**) |
| `hitter_talent_plus` avg | 100.13 | **99.23** (−0.90) |
★★ **The `run_env_factor` shift of −2.16 EQUALS the park `RG mean|Δ|` of 2.16.** The competition-translation lever
moved by exactly the amount park factors moved. Had E2 been run in its documented Phase-E slot *after* C28, this value
would have been silently stale at a passing 30/30 — biasing every projection of a player INTO a conference.
Division split intact: **D1 30 · NJCAA_D1 10 · D2 2.** Sample HTP moves: Big 12 117.2→**119.1** · SBC 103.8→**107.7** ·
Independent 109.1→**122** · MWC 95.7→**96** · The Summit 93.8→**93.4**.

## 🧠 RULE CONFIRMED BY MEASUREMENT
**`derive_conf_opr_htp` must be the LAST thing to touch park-derived conference columns.** Any stage that rewrites
`"Park Factors".rg_factor` invalidates `run_env_factor` / `hitter_talent_plus` / `offensive_power_rating` **without
changing their fill count**. Gate on the VALUE CHANGING, never on the count.

---
# 🔬 E2 PROD↔STAGING COMPARISON — HOW IT WAS VERIFIED, AND WHAT A DIFFERENCE MEANS (2026-08-30)
Run AFTER E2 + the `derive_conf_opr_htp` re-run. **Method matters as much as the result** — this is the template for
comparing the two environments now that they have diverged.

## METHOD (do it this way; a row count proves nothing)
1. **Structural:** row counts + non-null counts per season, both envs.
2. **VALUE-level:** pull all 2026 rows from each, **join on `team_name`**, compare each numeric field, report
   `matched / IDENTICAL / worst |Δ|` — never just "counts agree".
3. **Downstream:** compare the consumers (`Conference Stats`) separately, and **attribute every difference** to a
   named cause before calling it a defect.

## ✅ RESULT 1 — PARK FACTORS ARE *IDENTICAL*. This is INDEPENDENT REPLICATION, not a copy.
| | PROD | STAGING |
|---|---|---|
| rows 2024 / 2025 / 2026 | **307 / 307 / 308** | **307 / 307 / 308** |
| `rg_factor` populated | 307 / 307 / 308 | 307 / 307 / 308 |
| `rg_factor_seasonal` populated | 307 / 307 / 308 | 307 / 307 / 308 |
| **2026 `rg_factor` joined on `team_name`** | **308 matched · 308 IDENTICAL · worst \|Δ\| 0.0000** | |
| **2026 `rg_factor_seasonal`** | **308 IDENTICAL** | |
Same source CSVs, same formula, executed separately against two different databases → **byte-identical output**.
Prod's park factors are now in exactly the state staging is in. ★ This is the same class of evidence as the Stuff+
per-pitcher gate (mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 identical across two different pitch populations) and
the Kozeal descriptive-WAR match (2.404 / 0.649 / −0.051 / 3.002 to three decimals).

## ✅ RESULT 2 — `run_env_factor` IDENTICAL; the other two differ FOR A KNOWN REASON
| Conference Stats 2026 D1 | PROD | STAGING | verdict |
|---|---|---|---|
| `run_env_factor` | **99.719** | **99.719** | ✅ **identical** — the purely park-derived value. Identical parks ⇒ identical result. **The E2 → `derive_conf_opr_htp` chain is verified end-to-end.** |
| `Stuff_plus` | 99.15 | 99.16 | Δ −0.01 — immaterial |
| `hitter_talent_plus` | 99.23 | 99.01 | Δ +0.22 — **EXPECTED, see below** |
**Why HTP differs:** `HTP = OPR + 1.25·(Stuff+ − 100) + 0.75·(100 − run_env)`. `run_env` is now identical and Stuff+ is
within 0.01, so the difference comes from **`offensive_power_rating`**, which is built off the **Masters** — and
**STAGING NEVER RECEIVED C24 / C26 / C27 / C28 / C28b / C29.** Its Master-derived inputs are OLDER.
🛑 **THEREFORE: PROD IS THE MORE CURRENT SIDE FOR THESE COLUMNS. A prod↔staging mismatch here is NOT a prod defect.**
Prod is also ahead on `pitcher_ev90`, `pitcher_exit_velo`, `pitcher_in_zone_pct`, `pitcher_iz_whiff_pct`
(**30/30 prod vs 0/30 staging**) and `pitcher_ev_score`/`pitcher_iz_score` (**30/30 vs 0/30**).

## 🧭 THE RULE THIS ESTABLISHES — HOW TO READ ANY PROD↔STAGING DIFFERENCE FROM NOW ON
Before calling a difference a defect, answer **in this order**:
1. **Is the input identical?** (park CSVs, engine CSVs, pitch log) — if yes, an output difference is a real signal.
2. **Which env is BEHIND on the producing step?** Staging is missing C24/C26/C27/C28/C28b/C29. Prod is missing nothing
   in Phase C. **Whoever is behind explains the gap; do not "fix" the current side toward the stale one.**
3. **Is the differing column derived from the Masters?** If so, staging's drift explains it.
4. Only if 1–3 do not explain it is it a defect.
⛔ **NEVER reconcile prod TO staging by copying values.** That is what produced the `team_drs` paste that had to be
undone, and it would have carried staging's Arkansas 41.060 (a value prod could not reproduce) into prod permanently.

---
# 🅱️🔴🔴 TRACK B BLOCKER — **WAR MUST READ THE DB MASTERS, NOT TruMedia CSVs.** ARCHITECTURE DIRECTIVE (Trevor, 2026-08-30)
**THIS IS THE MOST IMPORTANT ITEM IN THIS DOCUMENT. Track B CANNOT WORK UNTIL IT IS FIXED.**

## THE DIRECTIVE, IN TREVOR'S TERMS
> *"derive_masters_from_pitchlog.ts needs to be the one that writes all the stats and even if a little off then it
> needs to be checked and overridden if off by the master sheets. The reason why is because on track b it is going to
> be absorbing pitch logs **every day through the spring**, but only ingesting master sheets **once a month or so** —
> and the only differences should be a check on some of the information as a 2nd source… things like **stolen base and
> ERA** that aren't always perfect from deriving the pitch log. That is why it has to run in the order I am mentioning
> and I am adamant about making sure it does in fact do that."*

## THE MANDATORY ORDER
```
pitch log (DAILY)  →  derive_masters_from_pitchlog.ts writes ALL stats to the Masters
                   →  WAR / power ratings / projections READ THE MASTERS (from the DATABASE)
                   →  TruMedia Master CSV (MONTHLY) = a CHECK / OVERRIDE layer only, applied ON TOP
```
The Master **sheet** is a *second source for verification*, not the primary. Override scope is narrow and specific:
**stolen bases and ERA**, plus anything else demonstrably not derivable cleanly from the pitch log.

## 🔴 THE BLOCKER AS IT STANDS TODAY — WAR IS WIRED THE WRONG WAY ROUND
`scripts/drs/populate_descriptive_war.mjs` reads its hitting and pitching lines **from CSV FILES ON DISK**:
```js
:75  const hitSheet = sheet("docs/drs-reference/Full Season Hitting Master Stats.csv");
:76  const pitSheet = sheet("docs/drs-reference/Full Season Pitching Master Stats.csv");
:102 const PA = g("PA");         // ← from the CSV, NOT from "Hitter Master".pa
```
`"Hitter Master"` is queried at `:77` **only** to build the D1 id list (`source_player_id, division, pa`) — the `pa`
column is never used in the math. `populate_descriptive_war_reg.mjs` is the same shape, reading
`scripts/drs/output/hitter_accrued.csv` and `pitcher_line.csv`.
**⇒ In Track B there are no daily TruMedia season CSVs. A daily run would have NOTHING to read.** The WAR stage as
written is structurally incapable of running inside Track B.
★ It also means today's prod WAR was computed from **TruMedia season CSVs**, not from the pitch log — the exact
inversion of the pitch-log-primary architecture. It is CORRECT (it matched staging to four decimals) but it is
**SOURCED WRONG**, and that must not be carried into Track B.

## ✅ WHY THIS IS FIXABLE — EVERY INPUT ALREADY EXISTS, PITCH-LOG-DERIVED
Two pipelines already produce everything, and BOTH are pitch-log-sourced:
| source | window(s) | supplies |
|---|---|---|
| `pitch_log_{hitter,pitcher}_totals` (**DB**) | full | rates + batted-ball/discipline: `AVG OBP SLG ISO contact barrel chase bb line_drive gb pop_up la_10_30 k_pct avg_exit_velo ev90 pull pull_air`, pitcher `K9 BB9 HR9 WHIP FIP stuff_plus hard_hit_pct barrel_pct …`, and **`ip`** |
| `scripts/drs/output/hitter_accrued.csv` (27 cols) | **FULL + REG** | `PA AB H 2B 3B HR BB HBP SF SH AVG OBP SLG ISO` and `reg_PA reg_AB reg_H reg_2B reg_3B reg_HR reg_BB reg_HBP reg_SF reg_SH` |
| `scripts/drs/output/pitcher_line.csv` (37 cols) | **FULL + REG** | `full_IP full_BF full_K full_BB full_HBP full_H full_HR full_ER **full_ERA** full_R full_RA9 full_FIP full_WHIP full_K9 full_BB9 full_HR9 full_K_pct full_BB_pct` + the complete matching `reg_*` set incl. **`reg_ERA`** |
⚠ **Barrel%/EV are NOT in the engine CSVs** — they come from `pitch_log_hitter_totals`. Two pipelines, one lane.
★ **`full_ERA` and `full_IP` ALREADY EXIST** — yet `PITCHER_UNMAPPED = ["ERA","IP","G","GS","Role"]` still declares
them *"left to TruMedia Master (never written)"*. **That comment is now WRONG for ERA and IP.** Only `G`/`GS` (and
`Role`, which is not a stat) genuinely lack a pitch-log source today.

## 🔴 WHAT `derive_masters_from_pitchlog.ts` DOES **NOT** WRITE TODAY (the whole gap)
It ran on prod (`4,772 pitchers + 4,373 hitters · 0 new rows`) and today re-dry-runs at **0 changes** — so everything
in its write set already matches. **The gap is what is NOT in that set:**
| Master column | prod today | available from | status |
|---|---|---|---|
| `pa` / `ab` | **regular-season line** (avg pa 121.8 vs staging 128.0) | `hitter_accrued.csv` `PA`/`AB` | ❌ patched only on NEW rows |
| `regular_season_pa` | **0 / 5,341** | `hitter_accrued.csv` `reg_PA` | ❌ never written |
| `IP` | regular-season line | `pitcher_line.csv` `full_IP` · `pitch_log_pitcher_totals.ip` | ❌ in `PITCHER_UNMAPPED` |
| `regular_season_ip` | **0 / 5,375** | `pitcher_line.csv` `reg_IP` | ❌ never written |
| `ERA` | stale CSV import | `pitcher_line.csv` `full_ERA` | ❌ in `PITCHER_UNMAPPED` |
| `G` / `GS` | stale CSV import | *(no pitch-log source found)* | ⬜ Master-override only |
| SB / caught stealing | Master sheet | *(partially)* | ⬜ **Master-override by design** |
**⇒ THIS is why prod has no postseason PA.** The step ran, but the counting stats were never in its write set, so the
Masters still hold whatever an older CSV import left. **VERIFIED:** prod `pa` == staging `regular_season_pa` for
**5,339/5,339 hitters (100.0%)** and prod `IP` == staging `regular_season_ip` for **5,374/5,374 (100.0%)**; **0.0%**
match the full-season values.

## ▶️ THE REQUIRED WORK, IN ORDER
1. **Extend `derive_masters_from_pitchlog.ts` to write the counting stats to EXISTING rows** — `pa`, `ab`, `IP`, `ERA`
   — plus the **reg/post split** into `regular_season_pa` / `regular_season_ip` from `reg_PA` / `reg_IP`.
   Boundary is `scripts/drs/drs_engine/season_config.py` → **`2026: regular_season_end 2026-05-18 / postseason_start
   2026-05-19`**. Per that file's own policy: **player stats + power ratings = FULL season; program analytics =
   REGULAR season; projections target a regular-season line.**
2. **Re-point `populate_descriptive_war.mjs` / `_reg.mjs` at the DB Masters** instead of the CSV sheets. Until this is
   done Track B has no WAR stage.
3. **Add the Master-sheet CHECK/OVERRIDE layer** — monthly CSV compared against the derived values, overriding only
   where the pitch log is known-weak (**SB, ERA**), and **logging every override with both values**.
4. ⛔ **`D33b` / `lock_regular_season` IS OBSOLETE — NOT DEFERRED (Trevor, 2026-08-30).** `derive_masters_from_pitchlog` writes `pa` and `regular_season_pa` in the SAME run from the SAME source row, so the atomicity rule is met structurally and the lock has no remaining purpose. **Retire it.** Original note: That RPC is `regular_season_pa = pa` where
   NULL — a snapshot that only works if `pa` is *already* the regular-season line. It predates the engine's split, has
   **NO unlock**, and running it now would permanently freeze the pre-postseason number into `regular_season_pa` while
   `pa` is about to be rewritten to full-season. **Write both columns from the engine output instead.**

---
# 📐 SCOPE — MAKE `derive_masters_from_pitchlog.ts` FILL THE MASTERS COMPLETELY (2026-08-30). NOT YET BUILT.
**Trevor's priority, in his words:** *"what we definitely need to do though is write the derive masters from pitch log
into the master so it captures everything, recognizes the split between regular season and postseason and how that
stores into things like the team stats that are important, and just make sure every column in the master is being
filled properly — then once that is done bring in the master sheet that includes the postseason (so not the full
regular season named one)."*
★ **WAR RE-POINTING IS EXPLICITLY *NOT* REQUIRED FIRST.** Trevor: *"I don't necessarily think the WAR needs to be
reproduced and it will be mapped in Track B as long as we continue to emphasize what the goal is."* The CSV-reading
WAR stage stays flagged (see the TRACK B BLOCKER block) and is mapped into Track B later. **Do not rebuild it now.**

## THE ORDER (non-negotiable)
```
1. derive_masters_from_pitchlog.ts fills the Masters COMPLETELY from the pitch log,
   with the regular/postseason split, and feeds the team-stat rollups correctly
2. THEN import the POSTSEASON-INCLUSIVE Master sheet  ⚠ NOT "Full Season Hitting Master Stats.csv"
   — that file is the regular-season-named export. Use the one that INCLUDES postseason.
```

## ✅ COLUMN AUDIT — PROD, Season 2026, division='D1' (VERIFIED 2026-08-30)
### `"Hitter Master"` — 83 columns / 5,341 rows
| bucket | columns | verdict |
|---|---|---|
| **EMPTY (4)** | `regular_season_pa` · `trackman_pitches` · `dob` · `class_year` | `regular_season_pa` = **THE GAP** (build it). `trackman_pitches` on the HITTER table is a **pitcher concept — vestigial, confirm then ignore/drop**. `dob`/`class_year` are **roster/bio data** (roster scraper), NOT stats — out of scope here. |
| **WRONG WINDOW** | `pa` `ab` (+ the slash line that derives from them) | populated, but holding the **REGULAR-SEASON** line. Must become **FULL season**. Verified: prod `pa` == staging `regular_season_pa` for **5,339/5,339 (100.0%)**. |
| **PARTIAL — BY DESIGN, NOT DEFECTS** | `line_drive`(5163) `avg_exit_velo`(5082) `barrel`(5078) `ev90`(5151) `pull`(5216) `la_10_30`(5078) `gb`(5163) `pop_up`(5163) + their `*_score` + the 4 power ratings (5122–5130) | gated by **`MIN_TRACKED_BIP`** — legitimately null for low-sample hitters. **Do NOT "fill" these.** |
| **PARTIAL — BY DESIGN** | all 15 `blended_*` + `combined_pa`/`combined_seasons` (~1,061) | only players with multi-season history. Correct. |
| **PARTIAL — GATE ARTIFACT** | `k_pct`(4,374) `pull_air`(4,367) `pull_air_score`(4,366) | **5,341 − 4,374 = 967 ≈ the `thin(<25 PA)=963`** skipped by `MIN_PA`. These are written ONLY by this producer, so sub-gate players never get them, while `AVG/OBP/SLG` (written elsewhere) are full. ⬜ **DECIDE: is a 25-PA floor correct for `k_pct`/`pull_air`, or should they follow the same rule as the slash line?** |
| **FULL (38)** | identity, slash line, conference, division, the `desc_*` set | ✅ |
### `"Pitching Master"` — 97 columns / 5,375 rows
| bucket | columns | verdict |
|---|---|---|
| **EMPTY (4)** | `regular_season_ip` · **`bf`** · `dob` · `class_year` | `regular_season_ip` = **THE GAP**. ★ **`bf` (batters faced) is 0/5,375 yet `pitcher_line.csv` carries `full_BF` and the producer ALREADY selects `bf`** — a free fill that is simply unwired. |
| **WRONG WINDOW** | `IP` · `ERA` | `IP` holds the **REGULAR-SEASON** line (prod `IP` == staging `regular_season_ip` for **5,374/5,374 = 100.0%**). `ERA` is from the stale import. Both are in `PITCHER_UNMAPPED` yet BOTH exist as `full_IP` / `full_ERA`. |
| **PARTIAL — BY DESIGN** | `hard_hit_pct` `barrel_pct` `line_pct` `exit_vel` `ground_pct` `90th_vel` `la_10_30_pct` `stuff_plus`(5251) + scores | sample-gated. Correct. |
| **PARTIAL — BY DESIGN** | 20 `blended_*` + `combined_ip`/`combined_seasons` (~1,658) | multi-season only. Correct. |
| **PARTIAL — GATE ARTIFACT** | `k_pct`(4,772) | = the above-gate pitcher count (`MIN_BF=20`). Same open question as the hitter side. |
| **FULL (56)** | identity, rate stats, `desc_*`, `trackman_pitches` (C24), conference | ✅ |

## 🔧 THE BUILD — WHAT TO WRITE, AND FROM WHERE (every input already exists, all pitch-log-derived)
| Master column | source | file/table | window |
|---|---|---|---|
| `pa` `ab` | `PA` `AB` | `scripts/drs/output/hitter_accrued.csv` | **FULL** |
| `regular_season_pa` | `reg_PA` | same file | **REG (≤2026-05-18)** |
| `IP` | `full_IP` | `scripts/drs/output/pitcher_line.csv` *(or `pitch_log_pitcher_totals.ip`)* | **FULL** |
| `regular_season_ip` | `reg_IP` | `pitcher_line.csv` | **REG** |
| `ERA` | `full_ERA` | `pitcher_line.csv` (`reg_ERA` also present) | **FULL** |
| `bf` | `full_BF` | `pitcher_line.csv` | **FULL** |
| rates + batted-ball | already written | `pitch_log_{hitter,pitcher}_totals` | FULL |
| `G` `GS` | ⬜ **no pitch-log source found** | — | Master-override only |
| SB / CS | ⬜ partial | — | **Master-override BY DESIGN** |
**BOUNDARY (single source of truth):** `scripts/drs/drs_engine/season_config.py` →
`2026: regular_season_end "2026-05-18", postseason_start "2026-05-19"`. Its own policy, verbatim: *player stat store +
player TOTAL WAR + POWER RATINGS = **FULL** season · PROGRAM ANALYTICS (team_war_snapshots, YoY/championship) =
**REGULAR** season · PROJECTIONS target a **regular-season** line.* ⬜ **Mirror this into a DB `season_config` row so
TS and Python share ONE value** — the file itself flags this as unresolved.

## ⬇️ DOWNSTREAM — "how that stores into things like the team stats"
`refresh_team_season_stats(p_season, p_reg_end DEFAULT <season>-05-18)` already takes the boundary and already builds
`_reg` **and** `_total` variants. It reads Master `desc_*`/`_reg` (done ✅) **and divides by `regular_season_ip`**
(`:143` `nullif(sum(pm.regular_season_ip),0)`) — **currently 0/5,375, so every regular-season rate it computes lands
NULL, silently.** ⇒ **Filling `regular_season_ip` is a HARD PREREQUISITE for F44.** Per policy, team analytics use the
REGULAR-season window, which is exactly why this column matters.

## 🛑 GUARDRAILS FOR THE BUILD
1. **`--create-new` is BROKEN** — `:465` passes `"batting_team_id"` where `repRows`' `idCol` belongs, the query times
   out over 2,576,146 rows, and `:451` discards the `error`. **Fix before relying on any new-row path.**
2. **Never create Master rows implicitly** — keep creation behind `--create-new`, log every row by name + PA/IP.
3. **Adopt the `TeamID` a player's teammates already use** — resolving it independently by season splits the team
   (proved live: Arkansas 308→309 teams). Prefer the season-stable `source_team_id` for any rollup.
4. **Do NOT run `lock_regular_season` / D33b.** It is `regular_season_pa = pa` where NULL, has **no unlock**, and would
   freeze the pre-postseason number. **Write both columns from the engine output instead.**
5. **Gate on VALUE + MEMBERSHIP + CARDINALITY, never counts.** After the build: `pa` avg must move ~121.8 → ~128.0;
   `regular_season_pa` must equal the OLD `pa` per player; `regular_season_ip` 0 → 5,374.

---
# ✅ DECISION — DO **NOT** ADD REGULAR-SEASON STAT COLUMNS. Only `regular_season_pa` / `regular_season_ip`. (Trevor, 2026-08-30)
> *"We don't really need regular season stats — we kinda just need WARs from them, and I don't think it displays
> anything except including the postseason data… my main concern was more about what we actually need for the regular
> season, which was the metrics that go into WAR — which we have."*

## WHAT EXISTS, AND WHY THAT IS ENOUGH
| table | `_reg` columns | nature |
|---|---|---|
| `"Hitter Master"` (7 of 83) | **`regular_season_pa`** · `woba_reg` `wraa_reg` `desc_owar_reg` `d_war_reg` `bsr_war_reg` `total_desc_war_reg` | **1 stat anchor + 6 WAR OUTPUTS** |
| `"Pitching Master"` (6 of 97) | **`regular_season_ip`** · `desc_ra9_reg` `desc_fip_ra9_reg` `drs_behind_reg` `desc_pwar_reg` `total_desc_war_reg` | **1 stat anchor + 5 WAR OUTPUTS** |
There is **NO** regular-season `AVG/OBP/SLG/ISO`, no reg `H/2B/3B/HR/BB`, no reg `ERA/FIP/WHIP/K9/BB9/HR9`. **That is
CORRECT and intentional.** The regular-season WAR is already computed and stored; the reg *inputs* are consumed at
compute time from the engine output and do not need persisting.
⚠ The engine produces **28** `reg_*` values that have no Master column and are discarded each run —
`hitter_accrued.csv` (10): `reg_PA reg_AB reg_H reg_2B reg_3B reg_HR reg_BB reg_HBP reg_SF reg_SH`;
`pitcher_line.csv` (18): `reg_IP reg_BF reg_K reg_BB reg_HBP reg_H reg_HR reg_ER reg_ERA reg_R reg_RA9 reg_FIP
reg_WHIP reg_K9 reg_BB9 reg_HR9 reg_K_pct reg_BB_pct`. **Leave it that way unless a display need appears.**
Downstream already copes: `refresh_team_season_stats(p_season, p_reg_end)` **re-derives** regular-season team rates
straight from `pitch_log` by date; it only reads `desc_*_reg` + `regular_season_ip` from the Masters.

## 🛑 BUILD HAZARD — WRITE `regular_season_pa`/`_ip` IN THE **SAME OPERATION** THAT MAKES `pa`/`IP` FULL-SEASON
The three live consumers all use the same fallback:
```
useTeamBuilderData.ts:239   Number(r.regular_season_pa ?? r.pa ?? r.ab)     ← hitter depth-role tier volume
useTeamBuilderData.ts:254   Number(r.regular_season_ip ?? r.IP)             ← pitcher depth-role tier volume
usePitchingSeedData.ts:124  r.regular_season_ip ?? r.IP
refresh_team_season_stats.sql:143,145   ÷ sum(regular_season_ip)
```
Purpose, per `AdminDashboard.tsx:4072`: *"tier classification … stays anchored to regular-season volume. Postseason
games keep updating live pa/IP but tiers stay frozen — **playoff teams don't get inflated tier counts.**"*
**TODAY:** `regular_season_pa` is NULL ⇒ everything falls through to `?? pa` ⇒ and prod's `pa` *happens* to be the
regular-season line ⇒ **tiers are accidentally correct.**
**THE TRAP:** the instant `pa`/`IP` become FULL-season while `regular_season_*` is still NULL, that same fallback
starts using **postseason-inflated volume** ⇒ **deep-run playoff teams get their hitters/pitchers pushed up a depth
tier**, with **no error anywhere**. It is the exact failure the lock mechanism was built to prevent, re-introduced by
filling the wrong column first.
✅ **RULE: one operation, both columns, or neither.** Order within the build: write `regular_season_pa = reg_PA` and
`regular_season_ip = reg_IP` **BEFORE or ATOMICALLY WITH** `pa = PA` / `IP = full_IP`.
✅ **GATE:** after the build, `regular_season_pa` must equal the OLD `pa` per player (prod's current values), and `pa`
must have risen (avg **121.8 → ~128.0**). Spot-check a deep playoff team (LSU / Arkansas) and confirm its depth-role
tier counts did **not** change.
⛔ Still **DO NOT** run `lock_regular_season` / D33b — it snapshots `pa → regular_season_pa`, which is only valid while
`pa` is the regular-season line, and it has **no unlock**.

---
# ✅ THREE BUILD DECISIONS LOCKED (Trevor, 2026-08-30) — these define how `derive_masters_from_pitchlog.ts` is extended
## 1. THE ATOMICITY REQUIREMENT IS SATISFIED BY CONSTRUCTION — `lock_regular_season` BECOMES OBSOLETE
> *"which would just simply be the derive masters from pitch log correct?"* — **YES.**
Because this ONE producer writes `pa`/`ab`/`IP`/`ERA` **and** `regular_season_pa`/`regular_season_ip` in the **same
run, from the same source row** (`hitter_accrued.csv` gives `PA` + `reg_PA`; `pitcher_line.csv` gives `full_IP` +
`reg_IP`), the "one operation, both columns, or neither" rule is met **structurally** — there is no window in which
`pa` is full-season while `regular_season_pa` is still NULL, which is the state that would silently inflate
depth-role tiers for playoff teams.
⛔ **THEREFORE `lock_regular_season` / D33b IS NOT DEFERRED — IT IS OBSOLETE.** It is a pre-engine snapshot mechanism
(`regular_season_pa = pa` where NULL, **no unlock**) that only works while `pa` is the regular-season line. Once this
build lands it must never be run. **Retire it alongside `team_drs_store.sql`.**

## 2. `k_pct` / `pull_air` — FILL FOR EVERYONE, FOLLOWING THE SLASH LINE
> *"follow the slashline and fill it for everyone."*
**Today:** `k_pct` **4,374** / `pull_air` **4,367** of **5,341** hitters (pitcher `k_pct` 4,772 of 5,375) — the
shortfall is exactly the `thin(<25 PA)=963` skipped by `MIN_PA`, while `AVG/OBP/SLG/ISO` show **full** coverage only
because they were last written by the older CSV import.
🛑 **THE GATE MUST BE SPLIT IN TWO — it currently gates the WHOLE patch at `:274`:**
```ts
:274  if ((t.pa ?? 0) < MIN_PA) { hitterThin++; continue; }   // ← PATCH gate: REMOVE / set to 0
:469  if ((t.pa ?? 0) < MIN_PA) { skipped++; continue; }      // ← NEW-ROW gate: KEEP at 25 PA / 20 BF
```
**PATCHING an existing row: no floor** — every player with pitch-log data gets every derived field.
**CREATING a new row: keep the floor** — otherwise `--create-new` manufactures a Master row for every 1-PA appearance
(on prod that would be **763 candidates instead of 1**; the background orphans top out at 18 PA).
⚠ **Once this producer is the SOLE writer, leaving the patch gate at 25 would strand ~963 hitters + ~603 pitchers on
permanently stale CSV values.** Sample-gated batted-ball fields (`barrel`, `ev90`, `avg_exit_velo`, `la_10_30`, …)
keep their own `MIN_TRACKED_BIP` floor — that is a DATA-QUALITY floor, not a volume floor, and is correct.

## 3. `--create-new` STAYS IN THE PIPELINE — AND ITS BUG IS NOW REQUIRED WORK
> *"keep create new in pitch log track b… we are gonna NEED it in Track B because 2027 will have a bunch of new
> players when Track B runs for the first time in a regular season and will have to do it. It actually makes more
> sense to have it built in that process to ensure it's done properly."*
New-row creation is a **first-class Track B stage**, not a manual patch: at the start of each season virtually every
freshman/transfer appears in the pitch log before any Master sheet arrives, and Track B ingests pitch logs **daily**
vs master sheets **monthly** — so the pipeline MUST be able to create the row itself.
🔴 **THEREFORE THE `repRows` BUG IS BLOCKING, NOT OPTIONAL:** `:465` passes `"batting_team_id"` where `idCol` belongs
(`:486` correctly passes `"pitcher_id"`), so it queries `pitch_log WHERE batting_team_id = <a player id>` — matches
nothing, **exceeds the statement timeout** over 2,576,146 rows, and `:451` **discards the `error`** ⇒ every hitter
silently skipped ⇒ **no hitter Master row can EVER be created.** Left unfixed, Track B's first 2027 run creates **zero
hitters** and reports `0 new rows` with **exit 0**.
**FIX:** `:465` → `"batter_id"`, **and** `:451` → `const { data, error } = …` with failures counted + fatal.
**GATE:** after the fix, a prod dry-run must report **exactly 1** new hitter (Kozeal was already inserted manually, so
re-verify against the current membership query) and the MEMBERSHIP query must come back EMPTY.

---
# 🅱️🏛️ TRACK B — THE COMPLETE ARCHITECTURE (CANONICAL, 2026-08-30). Build from THIS. Zero ambiguity intended.
Settled with Trevor across this session. **Every statement below is a DECISION, not a proposal.** Where something is
genuinely undecided it is marked ⬜ OPEN. Where something is verified on prod it says VERIFIED.

## 1. THE TWO CADENCES — everything else follows from this
| source | cadence | role |
|---|---|---|
| **Pitch log** | **DAILY, all spring** | **PRIMARY SOURCE OF TRUTH.** The majority of every statistic is DERIVED from it. |
| **TruMedia Master sheet** | **~MONTHLY** | **SECOND SOURCE / CHECK.** Overrides the derived value ONLY where the pitch log is known-weak — **stolen bases, ERA, G/GS**. Never a daily dependency. |
⇒ **NO STAGE MAY DEPEND ON A FILE THAT ONLY ARRIVES MONTHLY.** Any stage reading `docs/drs-reference/*.csv` or
`scripts/drs/output/*.csv` is structurally unrunnable inside Track B.

## 2. THE THREE LAYERS — each value lives in EXACTLY ONE place
```
   ┌── LAYER 1 ── pitch_log ─────────────────────────────────────────────────────┐
   │  raw per-pitch. Never aggregated in place. Immutable history.               │
   └────────────────────────────────┬────────────────────────────────────────────┘
                                    │  REBUILT ON **EVERY** PITCH-LOG IMPORT
   ┌── LAYER 2 ── pitch_log_*_totals ── THE ACCUMULATOR ─────────────────────────┐
   │  ALL RAW COUNTS live here and ONLY here, per (player, season, dimension_key)│
   │  hitter: pa ab hits_single/double/triple/hr k bb hbp sac batted_* ev_* …    │
   │  pitcher: total_bf total_pa total_k total_bb total_hbp hits_*_allowed ip …  │
   │  + defensive/baserunning run values (batting_rv, defensive_rv, baserunning_rv)│
   └────────────────────────────────┬────────────────────────────────────────────┘
                                    │  DERIVE (rates, ratings, WAR)
   ┌── LAYER 3 ── "Hitter Master" / "Pitching Master" ── DERIVED + DISPLAY ──────┐
   │  rates (AVG/OBP/SLG/ISO, K9/BB9/HR9/WHIP/FIP), power ratings, stuff_plus,   │
   │  desc_* and desc_*_reg WAR, plus pa/ab/IP + regular_season_pa/_ip as the    │
   │  DISPLAY + DEPTH-ROLE-TIER anchors.                                         │
   │  ⛔ NO raw component counts here (no H/2B/3B/HR/BB/HBP columns) — they live  │
   │     in Layer 2. Storing them twice is exactly what we are eliminating.      │
   └─────────────────────────────────────────────────────────────────────────────┘
```
**★ WAR READS LAYER 2 AND WRITES LAYER 3.** That is the resolution of "WAR must read the Masters": the *counts* come
from the accumulator, the *results* land on the Master, and every consumer downstream reads the Master.
**★ `pitch_log_*_totals` IS NOT AN END-OF-SEASON ARTIFACT.** It was built that way only because the season was already
over. **It must rebuild on every import** — it is the mechanism by which pitch-log data reaches the Masters.

## 3. THE REGULAR/POSTSEASON SPLIT — LOCK ONCE AT THE TRANSITION, THEN KEEP ACCUMULATING
> Trevor: *"we also probably just need to recognize the one time in the year when it transitions to the postseason and
> lock in the regular season values, then just keep adding what becomes postseason values."*
```
during the regular season   →  totals accumulate normally
AT THE TRANSITION (one time)→  SNAPSHOT the regular-season line   (dimension_key='reg', or the *_reg columns)
after the transition        →  'all' KEEPS GROWING (full season);  'reg' NEVER CHANGES AGAIN
```
This is the *correct* form of what `lock_regular_season` was groping at — but driven by the accumulator, not by copying
`pa` into `regular_season_pa`. **⛔ `lock_regular_season` / D33b IS OBSOLETE. Retire it.**
**Boundary:** `2026-05-18` (regular_season_end) / `2026-05-19` (postseason_start).
🛑 **IT IS CURRENTLY TYPED IN TWO PLACES** — `scripts/drs/drs_engine/season_config.py` and
`refresh_team_season_stats`'s `p_reg_end` default. **THERE MUST BE ONE SOURCE.** Two copies can drift and nothing
errors. ⬜ **FUTURE (Trevor's plan):** load **per-team SCHEDULES** for upcoming seasons so the system knows when each
team's regular season ends — which removes the constant entirely and handles teams whose seasons end on different
dates. Not urgent; wire the single source first.
**Policy (from `season_config.py`, unchanged):** player stats + power ratings = **FULL** season · program analytics
(`team_war_snapshots`, YoY/championship) = **REGULAR** season · projections TARGET a regular-season line.

## 4. 🔴 WHAT MUST BE BUILT — THE GAP INVENTORY (exact columns, VERIFIED on prod 2026-08-30)
### 4a. `pitch_log_pitcher_totals` (51 cols) IS MISSING THE RUN-PREVENTION INPUTS
HAS: `total_bf total_pa total_k total_bb total_hbp hits_{single,double,triple,hr}_allowed total_ab ip batted_* ev_* stuff_plus_sum`
**MISSING — and `desc_ra9` / `desc_pwar` cannot be computed without them:**
| missing | why it matters | note |
|---|---|---|
| **`R`** (total runs allowed) | `desc_ra9 = 0.5·(RA9 + drs_behind_per9) + 0.5·(FIP·E2T)` | ⚠ **NOT a naive count** — the engine accrues it with **inherited-runner attribution, earned + unearned** (`pitcher_line.csv` `full_R`). **That accrual logic must move INTO the totals build.** |
| **`ER`** (earned runs) | `ERA` | same accrual |
| **`G` / `GS`** | roster/role context | ⬜ Trevor: *"almost positive the pitch log import has a starting pitcher id"* — derivable, **not worth chasing now. Track B flag.** |
### 4b. DEFENSE + BASERUNNING SHOULD FOLD INTO THE SAME ACCUMULATOR
> Trevor: *"same could be said for storing baserunning and defensive values in that same run that might be a separate
> table now — those should all go into the pitch_log_*_totals then that should be derived into the masters from every
> pitch log imported."*
Today they are **separate tables** rebuilt by an offline Python engine:
`player_season_defense` (32 cols — `drs_floor/total/ceiling`, `range_*`, `arm_runs`, `framing_runs`, …) and
`player_season_baserunning` (15 cols — `sb cs sbh wsb_runs` **+ `wsb_runs_reg`** ← *a reg variant already exists here*).
★ **PRECEDENT ALREADY IN PLACE:** `pitch_log_hitter_totals` already carries **`batting_rv`, `defensive_rv`,
`baserunning_rv`** (+ `_z`), written by `populate_hitter_run_values(season)`. So the bridge exists — it just runs as a
separate step instead of as part of the accumulator.
⬜ **OPEN — Trevor's direction is clear (fold them in); the sequencing is not decided.** dRS is a heavy engine with its
own constants; whether it becomes a stage of the daily run or stays a periodic rebuild feeding the accumulator needs a
call. **Do not assume either.**
### 4c. `derive_masters_from_pitchlog.ts` — the extension already scoped
Write to EXISTING rows: `pa`/`ab` (FULL), `IP` (FULL), `ERA`, `bf`, **and** `regular_season_pa`/`regular_season_ip`
**in the same operation** (see the depth-role tier hazard). Split the gate: **no floor for PATCHING** (`:274`),
**keep 25 PA / 20 BF for CREATING** (`:469`). Fix `repRows` `:465` → `"batter_id"` and stop discarding `error` at `:451`.

## 5. ✅ WHAT IS ALREADY CORRECT — DO NOT RE-TEST, DO NOT "FIX"
- **Rates + batted-ball/discipline on both Masters** — already pitch-log-derived and written; the prod dry-run reports
  **0 changes** on 4,373 hitters / 4,772 pitchers. Correct.
- **`desc_*` and `desc_*_reg` WAR on prod** — D31/D32 committed, D34 passed all 9 gates. Values verified against
  staging (`desc_owar` 0.3458 vs 0.3456, sum identity 0.001). **Correct, even though SOURCED from CSVs** — that is a
  Track B wiring problem, not a data problem. **Do not recompute.**
- **`team_drs`** — derived on prod, 308 teams, sum 0.00. **Correct.**
- **Park factors + `run_env_factor`** — prod↔staging **308/308 IDENTICAL**, `run_env_factor` identical at 99.719.
- **Sample-gated columns** (`barrel`, `ev90`, `avg_exit_velo`, `la_10_30`, the `*_score` set, power ratings) — null
  below `MIN_TRACKED_BIP` **by design**. ⛔ **NOT a gap. Do not fill.**
- **`blended_*` + `combined_*`** (~1,061 hitters / 1,658 pitchers) — multi-season players only, **by design**.

## 6. ⚖️ ROADBLOCKS vs NOT-WORTH-FIXING
| item | verdict |
|---|---|
| WAR reads CSVs, not the DB | 🔴 **ROADBLOCK for Track B** — but NOT for the current prod push. Re-point during the Track B build, not now. |
| `pitch_log_pitcher_totals` missing `R`/`ER` (+ the inherited-runner accrual) | 🔴 **ROADBLOCK** — no pitcher WAR without it. |
| `repRows` `:465` bug (no hitter row can ever be created) | 🔴 **ROADBLOCK** — 2027's first run is mostly new players. |
| `regular_season_pa`/`_ip` unfilled | 🔴 **ROADBLOCK for F44** (`nullif(sum(regular_season_ip),0)` → NULL rates) **and a live hazard** the moment `pa` goes full-season. |
| `pa`/`IP` holding the regular-season line | 🟡 **Fix in the build.** Harmless today *because* `regular_season_*` is NULL and the fallback lands on the right value. |
| Boundary date typed in 2 places | 🟡 **Wire to one source — not urgent.** Superseded later by per-team schedules. |
| `G`/`GS` with no pitch-log source | 🟢 **NOT worth chasing now.** Master-override; Track B flag. |
| SB / CS | 🟢 **Master-override BY DESIGN.** Not a gap. |
| `dob` / `class_year` empty | 🟢 **Not stats.** Roster-scraper concern, out of scope. |
| `trackman_pitches` on `"Hitter Master"` | 🟢 **Vestigial** (a pitcher concept). Confirm, then ignore or drop. |
| `k_pct` / `pull_air` short by ~963 | 🟡 **Fix via the patch-gate removal** — fill for everyone, following the slash line. |
| Reg-season STAT columns beyond `pa`/`IP` | 🟢 **DECIDED: do not add.** Counts live in Layer 2; the Master stores derived results only. |
| Recomputing prod WAR | 🟢 **NOT needed.** Values verified correct. |

## 7. 🧭 THE FOUR GATE TYPES THAT ACTUALLY CATCH THINGS (a count gate catches none of them)
1. **VALUE** — did the number CHANGE? (Conference `Stuff_plus` 101.17→99.15 · `run_env_factor` 101.879→99.719, both **30/30 before AND after**)
2. **MEMBERSHIP** — diff the ID SET. (caught Kozeal: 5,340 = 5,340 passed every count)
3. **CARDINALITY** — assert the GROUP count (D1 = 308 teams). (caught the `TeamID` split; the Σ-centering assertion held at 309)
4. **LOG-CONTENT** — read the body, never the exit code. (`0 FAILED` must be printed, not inferred; `--create-new` exits 0 while creating nothing)

---
# 📍 WHERE WE ARE — END OF 2026-08-30. Current state, and what is left.
## ✅ DONE ON PROD (verified in the DB, not from logs)
| phase | state |
|---|---|
| **A / B** schema + config | ✅ `model_config` 220 keys · Phase-B tuned values SURVIVED C27's upsert (`nil_tier_sec` 4.0, `r_obp_std_pr` 31.89504) |
| **C** Stuff+ chain 1–5 | ✅ 2,013,005 pitches · per-pitcher gate **mean 99.3 / p50 99.3 / p10 93.1 / p90 105.7 — IDENTICAL to staging** |
| **C24 / C27 / C26 / C29 / C28 (4 steps) / C28b** | ✅ all applied; Conference `Stuff_plus` **101.17 → 99.15** (the lane fix) |
| **D29b** `team_drs` | ✅ **DERIVED on prod** (not pasted) — 308 teams, sum 0.00, Arkansas 41.272 |
| **D30** dRS/wSB load | ✅ confirmed NO-OP (13,454 / 10,432 already present) |
| **D31 / D32** descriptive WAR + `_reg` | ✅ committed, `0 FAILED`; **D34 passed all 9 gates** |
| **E2** park factors + ★`derive_conf_opr_htp` re-run | ✅ `rg_factor_seasonal` 0/309 → full; `run_env_factor` **101.879 → 99.719** |
| *(unplanned)* Camden Kozeal | ✅ Master row created — D1 hitters 5,340 → **5,341** |
**Prod↔staging where compared:** park factors **308/308 identical** · `run_env_factor` identical · Kozeal's WAR
identical to 3dp. Remaining diffs (`hitter_talent_plus` 99.23 vs 99.01) are **staging being BEHIND** — prod is current.

## ⛔ NOT DONE, AND DELIBERATELY SO
- **`D33b` / `lock_regular_season`** — **OBSOLETE, do not run.** Superseded by the accumulator lock (§3 of the
  architecture). It has **no unlock** and would freeze the pre-postseason number.
- **`pa`/`IP` still hold the REGULAR-SEASON line** — harmless *today* precisely because `regular_season_*` is NULL and
  the depth-role fallback lands on the right value. **Fixed in the derive_masters build, both columns together.**
- **WAR still sourced from CSVs** — correct numbers, wrong wiring. **Re-point during the Track B build, not now.**

## ▶️ REMAINING PROD PUSH (dependency order, NOT topic order)
`F44 refresh_team_season_stats` ← **BLOCKED on `regular_season_ip`** (it divides by it → NULL rates) →
`E35` TWP detector (guard added ✅) → `E36/E37/E38` precomputes → `F39` `refresh_composite_war` → `F40–F43` →
`G46` edge-fn deploy → PR staging→main → `H` drops → **THEN staging catch-up, run THROUGH Track B.**
★ **F44 MOVED UP, before Phase E** — `precompute-transfer-projections.ts:225` / `precompute-pitchers.ts:279` READ
`team_season_stats.faced_*` and coerce a miss to `[]`. See the ORDER AUDIT.

## 🔨 THE BUILD QUEUE (in order, all scoped, none started)
1. **`derive_masters_from_pitchlog.ts` extension** — counting stats + reg/post split + gate split + `repRows` fix.
2. **`pitch_log_pitcher_totals` gains `R`/`ER`** — including the inherited-runner accrual currently only in the engine.
3. **`dimension_key='reg'`** on the totals build → kills the last hitter-side CSV dependency.
4. **Fold defense/baserunning into the accumulator** ⬜ sequencing OPEN.
5. **Re-point WAR at the DB** (Layer 2 → Layer 3).
6. **One boundary-date source** → later, per-team schedules.

## 🧠 THE SIX DEFECTS THIS PUSH FOUND — every one PASSED a naive check
1. Conference `Stuff_plus` **stale at 30/30** (a 4th producer the runbook omitted)
2. `trackman_pitches` **fully populated from the WRONG LANE** (638/5,367 = 11.9% agreement)
3. `run_env_factor` **stale under E2 at 30/30** (park rewrite invalidates it)
4. **Kozeal missing** — invisible to `5,340 = 5,340`
5. **`--create-new` structurally broken** — exits 0, prints `0 new rows`, can never create a hitter
6. **`TeamID` team split** — both buckets internally consistent, Σ-centering held **at 309 teams**

---
# 🎯 DIRECTIVE — PROD MUST HOLD **FULL-SEASON** `pa`/`IP` (INCLUDING POSTSEASON), WITH THE REG SPLIT ALONGSIDE
> Trevor, 2026-08-30: *"what we need to do is update prod to reflect full season stats including postseason, which
> means that the engine needs to recognize regular season PA the correct way and fill them with that information."*

## THE TARGET STATE (both columns, ONE operation, from the engine)
| column | value | engine source |
|---|---|---|
| `"Hitter Master".pa` / `ab` | **FULL season, incl. postseason** | `hitter_accrued.csv` → `PA` / `AB` |
| `"Hitter Master".regular_season_pa` | **REG only (≤ 2026-05-18)** | `hitter_accrued.csv` → `reg_PA` |
| `"Pitching Master".IP` | **FULL season, incl. postseason** | `pitcher_line.csv` → `full_IP` |
| `"Pitching Master".regular_season_ip` | **REG only** | `pitcher_line.csv` → `reg_IP` |
| `"Pitching Master".ERA` / `bf` | **FULL season** | `pitcher_line.csv` → `full_ERA` / `full_BF` |
🛑 **WRITE BOTH WINDOWS IN THE SAME OPERATION.** Depth-role tiering reads `regular_season_pa ?? pa` — if `pa` goes
full-season while `regular_season_*` is still NULL, tiering silently uses **postseason-inflated volume** and deep-run
playoff teams get pushed up a tier, with no error. **This is why the engine must supply both, not a snapshot.**

## 📊 THE MEASUREMENT THAT ESTABLISHES THE CURRENT STATE (prod + staging, VERIFIED 2026-08-30)
| comparison | mean \|Δ\| | median | p90 | max |
|---|---|---|---|---|
| **STAGING** `regular_season_pa` vs engine `reg_PA` | 0.858 | **0.00** | 3 | 23 |
| **STAGING** `pa` vs engine `PA` (full) | 0.852 | **0.00** | 2 | 23 |
| **PROD** `pa` vs engine **`reg_PA`** | **0.865** | **0.00** | 3 | 37 |
| **PROD** `pa` vs engine `PA` (full) | **6.567** | 1.00 | 20 | 79 |
| **PROD** `IP` vs engine **`reg_IP`** | **0.402** | 0.30 | 1.03 | 8.03 |
| **PROD** `IP` vs engine `full_IP` | **1.428** | 0.37 | 4.33 | 27.67 |
**CONCLUSIONS:**
1. ✅ **STAGING IS FILLED CORRECTLY** — both windows match their own engine source at **median 0**, correctly paired.
   **Do NOT "fix" staging.** (Trevor was right; my earlier doubt was wrong.)
2. ✅ **PROD's `pa`/`IP` ARE THE REGULAR-SEASON WINDOW** — 0.865 vs 6.567 for PA, 0.402 vs 1.428 for IP. Unambiguous.
3. ✅ The residual **~0.86 PA / ~0.40 IP** is TruMedia counting vs the engine's pitch-log derivation — the same
   effect recorded as **IP corr 0.9932 vs Master IP** in the `team_season_stats` migration. **Expected, not a defect.**
4. ✅ **FILLING `regular_season_pa`/`_ip` FROM THE ENGINE IS LOW-RISK** — the value differs from today's `pa` by a
   **median of 0.00**, so depth-role tiers barely move. **My earlier "this changes 1,306 hitters" warning was WRONG.**

## 🧠 METHODOLOGICAL LESSON — DO NOT COMPARE TWO DERIVATIONS BY EXACT EQUALITY
I first tested prod `pa` == engine `reg_PA` with **exact integer equality** and got **75.5%**, then reported that as
"1,306 hitters would change." **That was a false alarm.** The true distribution is **median 0, mean 0.865**. Exact
equality between two INDEPENDENT derivations of the same quantity will always show a large "mismatch %" that is really
just rounding/derivation noise.
✅ **RULE: when comparing two derivations, report mean/median/p90/max of |Δ| — never a % exact match.**
⚠ **Second occurrence today.** The first was the E2 park-factor diff, where my probe matched the CSV's `teamId`
column instead of `team` and briefly reported "all 309 teams would be dropped" (the truth was **1**: Fort Wayne).
**Both were MY instrument, not the data.** Verify the instrument before reporting an alarm.

## ▶️ EXECUTION (part of the `derive_masters_from_pitchlog` extension — NOT a separate lock step)
1. Write all four columns from the engine in ONE upsert per player.
2. **GATE (values, not counts):** `pa` avg **121.8 → ~128.0** · `regular_season_pa` ≈ today's `pa` (median Δ 0) ·
   `regular_season_ip` **0 → 5,374** · `IP` avg rises · spot-check a deep playoff team (LSU / Arkansas) and confirm
   its **depth-role tier counts do not move**.
3. Then **re-run F44** (`refresh_team_season_stats`) so `ra9_r` / `fra9_r` stop landing NULL. Idempotent.
⛔ **`lock_regular_season` / D33b remains OBSOLETE** — it snapshots `pa`, which is exactly the wrong mechanism.

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
| 18 | 🚨 **F41a `rebuild-twp-target-rows` DELETEs board rows and REINSERTS from a HAND-LISTED field set that omits `total_hitter_war`** — silently stripping the value F40 wrote hours earlier | row count unchanged, board renders, `o_war` + market still present, exit 0 — **only a field INSIDE the JSON vanishes** | reading the builders (`:28`,`:30`) and the `F` select list (`:44`) against F40's gate | **Stage 19.** ⛔ **NEVER rebuild a snapshot from a hand-listed field set** — round-trip the object and overwrite only what the stage owns (`rebake-twp-markets.ts:44,55` `{...s}` does this correctly). Also: **a backup taken before the PREVIOUS step is not a backup for this one.** |
| 19 | 🚨 **TWP hitter market priced off `o_war` while every other hitter is priced off `total_hitter_war`** | both are valid WAR columns and both produce plausible dollars | code read after F39/F40 unified the basis everywhere else | **Stage 19.** ONE pricing basis system-wide. Assert `market_value` and `twp_hitter_market_value` derive from the SAME WAR column. Measured split: Colasante −9.5%, Overbeek −2.0%. |
| 20 | 🚨🚨 **The transfer HITTER engine never routed TWP markets to `twp_hitter_market_value`** — it wrote every TWP's dollars into the shared `market_value`, which the display layer IGNORES for TWPs | the column was populated with a correct, sensibly-priced number; nothing was null, nothing errored — the value was simply in the column nobody reads, so **2,119 transfer + 110 returner TWP hitter rows rendered BLANK to coaches** | tracing why F41b existed at all, then diffing the four projection paths against each other | **Stage 18.** ALL FOUR paths (returner hitter/pitcher, transfer hitter/pitcher) must route TWP → `twp_*` + NULL the shared column. Three did; the transfer hitter did not — and its own sibling file's comment *claimed* it did. ⛔ **The repair CANNOT be done downstream:** only stage 18 knows the DESTINATION program's conference, and re-pricing later from the player's own conference under-prices by the full PTM ratio (SEC 4.0 vs Patriot 1.36 = **2.9×**). **A repair step that re-derives a value the engine already computed correctly is itself the bug** — that was F41b. |
| 21 | 🚨 **Producers branch on the snapshot's OWN embedded `is_twp`, not `players.is_twp`** — E35 flipped the players flag 137→253 and the snapshots were never updated | the dollars are CORRECT and correctly priced; they are simply written to the column the display layer will not read for that player. Nothing errors, nothing is null, the row looks complete | a TWP build snapshot holding BOTH a shared `market_value` ($112,305, correct) and a stale `twp_hitter_market_value` ($38,106, wrong conference) — **disagreeing by the exact 2.9× PTM ratio** | **Stage 19.** ⛔ **NEVER branch on a flag embedded in a snapshot** — join to the owning table at read time. A snapshot records VALUES, it is not a source of truth for IDENTITY. Gate: `players.is_twp AND snapshot->>'market_value' IS NOT NULL` = **0 rows**. ⛔ Do NOT back-fill `is_twp` into snapshots — that just creates another copy to go stale. **6th instance of "the value moved, a supporting flag stayed behind".** |
| 22 | 🚨🚨 **An `.in("id", …)` list built from raw FKs containing a NULL — Postgres rejects the WHOLE batch as invalid-uuid, and the `error` was discarded** | the ONLY symptom was cosmetic: dry-run samples printing `undefined` for the player name. Every real player in the poisoned batch silently vanished from the position AND `is_twp` lookups | noticing that every sample line said `undefined`, then checking `team_build_players` for NULL `player_id` (**191 of 1,470**) | **Every stage.** Filter to well-formed UUIDs and **`throw` on batch error**. ⚠ **This defect would have silently UNDONE REGISTRY #21 minutes after it was fixed** — the `is_twp` map came from the same poisoned lookup, so TWPs would read `false` and re-route to the shared column. **The fix and the thing that breaks it were in the same function.** ★ **A cosmetic logging anomaly is a data-integrity signal.** |
| 23 | 🚨 **`resync-build-snapshot-markets` never re-derived POSITIVE pitcher markets** — it only floored non-positive WAR to $0, deferring the rest to "the app's live bake" | the stored value was a plausible number (often a stale one, sometimes `$0`) and no gate compared surfaces | Colasante's SP slot: **$0 on the build snapshot vs $130,733 on the target board** — same player, same side, two surfaces | **Stage 19.** A stored-first architecture cannot defer a stored value to a live bake. **Price BOTH surfaces in ONE stage with the SAME rules**, and gate `board == build` per player. Pitcher gate = **exactly ONE `$/win` rate per conference** (no position multiplier); hitter gate = at most three. |
| 24 | 🚨🚨 **TWO precompute stages both write `market_value` on the SAME `returner/regular` row — E37 (hitters) runs after E36 (pitchers) and NULLED the pitcher market** | both stages ran clean and reported success. The defect existed ONLY in their INTERACTION, and only on the ~113-player overlap (pitchers who also carry a Hitter Master row). The row kept E36's `p_war`/`projected_ip`/`depth_role` — only the dollars vanished | UX completeness check → **34 D1 pitchers with positive WAR and no market** (e.g. Derek Arrocha, SWAC, 2.531 pWAR, correct market $31,635) | **Stage 18/19.** 🔴 **ONE COLUMN, ONE OWNER** — no two stages may write the same column on the same row. 🔴 **A stage must NEVER null a field it has no value for** — omit the key; nulling asserts "I know this is empty", which the stage computing the OTHER side is not entitled to say. 🔴 **Gate ACROSS stages, not within them.** ★ `predictionEngine.ts:57-59` already NAMED this collision — the TWP column split exists to prevent it — but the protection only fires for `is_twp` players. |

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
