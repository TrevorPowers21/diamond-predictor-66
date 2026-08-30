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
D29b  team_drs_store.sql .................... team_war_snapshots.team_drs     → needed by D31 and F44 step 7
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
