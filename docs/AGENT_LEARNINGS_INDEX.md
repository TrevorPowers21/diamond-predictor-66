# AGENT LEARNINGS — INDEX. Read this before any of the individual files.

**The WAR recalibration is the spine of this repo's recent history — the largest audit and the widest
set of changes in the application's history.** Almost every learnings file below is a chapter of it.
They were written in sequence, so **later files correct earlier ones.** This index says which.

---

## ★★★ THE ONE THING TO CARRY

**A stored copy nobody recomputes, behind a `??` chain that silently changes which source wins once a
field becomes populated.** That single defect class produced nearly every symptom of 2026-09-01:
snapshots stale after a precompute, market stale after a WAR change, `transfer_snapshot` stale after
a save, `player_snapshot` stale after a local state update, and `p.prediction` degrading to a raw
prediction row. Each fix exposed the next because **the chain was the defect, not any single link.**

⭐ **The durable fix — and the highest-value refactor available: ONE save path owning every derived
copy together.** Every repair script in `scripts/` is a *repair*, not architecture.

**Canonical statements of this:**
- `docs/PIPELINE_pitch_log_to_projections.md` — **Track B**, the read/write path section
- `docs/AGENT_LEARNINGS_snapshot_layers_2026_09_01.md` — why every automated check passed while the UI was wrong
- `docs/knowledge/snapshots-and-recompute.md` — the named principles, agent-facing
- `docs/HANDOFF_2026_09_02_STATE_AND_ROADMAP.md` — current state, 9 open items, five workstreams

---

## THE TWO METHODS THAT ACTUALLY CAUGHT BUGS

Neither is a code review. Both should stay in the loop permanently.

1. **Diff two independent implementations over the same team, row by row.** The deployed edge function
   vs the local precompute. This is the ONLY check that has ever caught a drift bug here — it found
   `IF`/`INF`/`INFIELD` missing from the 1.1 market tier, i.e. **every infielder onboarding 10% low**.
   Code review, `tsc`, and eyeballing the output all passed on it.
   ⚠ **Prove both sides are FRESH first** (`updated_at`). Stale-vs-fresh looks exactly like an
   implementation disagreement and cost hours.
2. **A human clicking through the UI.** Trevor found the stale board snapshots, Helfrick's
   component-vs-total, Neiswonger's depth-role IP, and the roster-vs-board split. None appeared in any
   automated check — every check verified the DATABASE while the bugs lived in the READ PATH.

**Fastest triage: is the value wrong in the DATABASE, or only on SCREEN?**
Database → re-bake. Screen only → read path; first question is *which stored field does that surface
actually read.*

---

## CHRONOLOGY — later corrects earlier

| date | file | status |
|---|---|---|
| 07-30 | `recruit_scouting_identity` | current |
| 08-03 | `defensive_runs_engine` | current (dWAR/bsrWAR shipped) |
| 08-12 | `internals_collapse` | current — power ratings → ONE source |
| 08-13 | `step7b_war_display_audit` | ⚠ display conclusions **superseded** by the 09-01 read/write path |
| 08-16 | `stuff_plus` | current |
| 08-16 | `nil_allocation` | current |
| 08-21 | `market_value_reverse_engineer` | ⚠ **partly superseded** — market is a STORED snapshot field; nothing derives it at read time, and TWPs null the shared `market_value` |
| 08-23 | `total_war_display` | ⚠ superseded — `total_hitter_war` is the headline; six selects omitted it |
| 08-24 | `projection_calibration_two_sided_sd` | ⚠ **method correct, populations corrected**: D1-only, per-row, and the SD splits at the **stored centre, not 100** |
| 08-26 | `hitter_run_values`, `twp_flag_systemic_gap`, `ui_and_whats_new` | current |
| 08-27 | `prod_push_execution` | ⚠ the "paused at Phase C" state **no longer exists** — the push completed 09-01 |
| 09-01 | `snapshot_read_path` | current |
| 09-01 | **`snapshot_layers`** | ★ **most important** — the read/write doctrine and the three false alarms |

---

## WHAT THE CALIBRATION ACTUALLY CHANGED (so nobody re-derives it)

**Gate B — the legacy table silently overrode the code.** Prod's returner wRC+ ran a *different
equation* because `"Equation Weights"` @2025 outranked the code default. Across 5,122 D1 returner
hitters the legacy formula reproduced the stored value for **5,122 (100%)**, canonical for **1,164
(23%)**. Staging looked fine only because its copy of the table was **empty** — same code, two
databases, different equations. ⇒ **verify config on BOTH databases.** Table is now
`"Equation Weights_LEGACY_2025"`; `model_config` (admin_ui, 2026) is the single source.

**C1 — ERAs ran ~4% low**, from two causes: the calibration had **no division filter** (477 JUCO =
27% of the sample) and the z-shift assumed PR+ centres at **100** when the true D1/IP≥40 centres are
**109.73–123.16**. Centres are now stored per stat and wired into the `fields` mapping.
⚠ **A key not in that mapping is INERT** — stage 5.5 once wrote 41 keys nothing read.

**Blast radius, so the numbers aren't a surprise:** Lauaki Jr. `wRC+ 113 → 101`, market
`$24,260 → $9,671`. Market moves ~60% on a 12-point wRC+ change because oWAR scales off
`(wRC+ − 100)`. **Arithmetic, not a bug.** Contact-heavy hitters fall (the legacy formula
double-counted AVG); high-OBP hitters rise.

---

## THE THREE FALSE ALARMS — same root cause, worth internalising

All three were conclusions the evidence did not contain:
1. *"Sub-40-IP pitchers diverge between implementations."* They didn't — stale local rows vs freshly
   computed edge rows. **Two generations, not two implementations.**
2. *"The local `total_hitter_war` drifts from its components."* It doesn't — exact on 221,318 rows.
   The measurement compared LOCAL components against the EDGE total, which proves nothing about local.
3. *"4 target-board rows are wrong."* All one TWP whose pitcher-slot rows correctly hold pWAR, while
   `coalesce(o_war, p_war)` pulled his hitter oWAR off the same row.

⇒ **Before diffing two things, prove they are COMPARABLE:** same generation (`updated_at`), same side
(a TWP carries both sides on ONE row), same field name (`market_value` is stored as `nil_valuation`
on board snapshots, `o_war` as `owar`).

---

## STILL OPEN (do not assume these are done)
10 staging / 18 prod pitchers with unverifiable pWAR (**skipped, not guessed**) · 1 wrong-side neutral
· JUCO transfers ~62% stale on prod · JUCO PTM · **removal-from-roster semantics UNDEFINED** ·
`propagate_pitcher_scores_to_predictions` times out (scores 99.97% in sync — cost, not correctness) ·
66 hardcoded constants (naming decision first) · Gate A / Georgia Tech never fired on prod.
