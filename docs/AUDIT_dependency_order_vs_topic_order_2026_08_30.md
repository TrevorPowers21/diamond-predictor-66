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
4. ⛔ **`D33b` / `lock_regular_season` IS THE WRONG TOOL AND MUST NOT RUN.** That RPC is `regular_season_pa = pa` where
   NULL — a snapshot that only works if `pa` is *already* the regular-season line. It predates the engine's split, has
   **NO unlock**, and running it now would permanently freeze the pre-postseason number into `regular_season_pa` while
   `pa` is about to be rewritten to full-season. **Write both columns from the engine output instead.**
