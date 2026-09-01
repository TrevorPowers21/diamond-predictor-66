# AGENT LEARNINGS — The snapshot read path: four surfaces, one question, four different answers (2026-09-01)

Status: **FIXED AND VERIFIED BY TREVOR ON STAGING.** Top 5, PitcherProfile, GM hub, and the hitter
toggle all confirmed working. Two items remain open (target_board `position_slot` NULL; stub ghosts).

---

## ★★★ DOCTRINE — write this into the audit doctrine section ★★★

> **1. A stored value and a re-derived value are not the same thing even when the formula matches.**
> Four surfaces each answered "what is this player's line?" with their own lookup. Every one was
> *defensible in isolation*; together they disagreed. The fix was never a better formula — it was
> deleting three of the four lookups. **When two surfaces must agree, they must READ THE SAME ROW, not
> compute the same answer.**
>
> **2. Verify a filter against BOTH databases, not the one the preview happens to point at.**
> A display filter that is a perfect no-op on prod emptied the entire list on staging. Every test I ran
> was against prod, so I twice told Trevor "it isn't my change." It was.
>
> **3. "The live compute is a bridge, not a mode."** (Trevor) Instant feedback on toggle → save →
> every subsequent read comes from the snapshot, forever, unless changed again. **The handoff only
> works if what you SAVE equals what you just SHOWED.** A save that omits one field silently reverts
> the user's work at the exact moment the bridge hands off.
>
> **4. Same field name, two different quantities, is a bug that hides behind "it healed on reload."**

---

## THE SHAPE OF THE PROBLEM

The snapshot machinery already existed and was correctly designed — Trevor built it:
- `team_build_players.neutral_snapshot` — the immutable dev-agg 0 base
- `team_build_players.player_snapshot` — the coach's toggles baked in at save time
- `target_board.transfer_snapshot` + `neutral_snapshot` — the same pair for board players
- `production_notes` — the toggle state (dev, depth role, class transition)

**Nothing enforced it.** Four surfaces each re-implemented the resolution and each drifted:

| surface | what it read | verdict |
|---|---|---|
| Team Builder | the snapshot; neutral base on a dirty row | ✅ was already correct |
| PlayerProfile (hitter) | `player_predictions` × `devAggScale` at render | ❌ fixed |
| PitcherProfile | `player_predictions` (stored-first, but the wrong stored thing) | ❌ fixed |
| PlayerHub / GM home | `player_predictions`, re-derived with its own scalar | ❌ fixed |

⇒ **`src/hooks/useActiveBuildSnapshot.ts`** now answers it once. It is TWP slot-aware, field-guarded,
and returns null when the player is not on the active build (the correct signal to fall back to the
neutral projection).

---

## THE FIVE BUGS, WITH THE EVIDENCE THAT IDENTIFIED EACH

### 1. 🛑 THE GHOST FILTER THAT EMPTIED STAGING — my regression, misdiagnosed twice
Added `.not("players.team_id","is",null)` to the Dashboard Top 5 to hide stub rows (Harrison Cook,
last real season 2024, `p_rv_plus` NULL in all three Master rows, ranking **150**).

```
STAGING  15,560 of 15,561 players have team_id NULL  (99.99%)
PROD     15,763 of 31,467                            (50%)
```
Local dev reads **staging**; the Vercel preview reads **PROD**. So the Top 5 rendered "No data."
locally while the preview looked perfect. Bisecting the filters on staging was decisive:
```
3,329  after pa >= 75
    0  + team_id not null   ← the filter
```
**How I got it wrong:** I tested the global pool, the team pool, hitters, pitchers, column grants and
RLS — all on **prod**, where the filter is a genuine no-op (3,273 → 3,273) — and concluded twice that
it wasn't mine. Trevor's "it worked literally yesterday" was the signal I under-weighted.
★ **The Player Dashboard never filtered on `team_id`, which is exactly why it kept working.** Trevor:
*"mimic the top 5 players from the player dashboard display."* When one surface works and another
doesn't, diff the two rather than theorising about the broken one.

### 2. Scouting column read a different derivation (not a stale copy)
`player_predictions.*_score` is a **baseline normalization** (`computeAndStoreScores` /
`pitcherBaselines`), NOT the pitch-log percentile that PitcherProfile and Season Stats "all pitches"
use. Agreement within 2 points: stuff 571/4585 · whiff 968/4613 · bb 1427/4613 · barrel 1219/4553.
Volantis read **69.58** here vs **76.9** on his profile.
🛑 Trevor: *"The scouting column needs to read the pitch log percentile only."* No fallback — a blank
cell is correct, a wrong-source number is not. 909 of 5,522 fall under the 100-pitch qualifier.
⚠ `pitch_log_pitcher_totals` at `dimension_key='all'` **IS** the stored full-season source. This was
never "live vs stored"; both are stored. It was the WRONG stored thing.

### 3. My own follow-on regression — the whole column went blank
Removing the fallback exposed a pre-existing broken lookup: the PITCHING row type has `id` +
`player_id` and **no `source_player_id`** — pitcher rows carry **`id` = source_player_id** (a numeric
TruMedia id, not a UUID). `(r as any).source_player_id` was always `undefined`.
★ **It was invisible while the stored score was preferred, because `live` was never reached.**
Removing a fallback is a way to *discover* that the primary path never worked.

### 4. 🔴 THE TOGGLE BUG — same field, two quantities, TWO un-fixed write paths
**Display half.** The CLEAN path returned `pickHitterWar(snap)` = `total_hitter_war` (o+d+bsr); the
DIRTY path returned bare `owar`. A toggle silently dropped dWAR + bsrWAR, then "healed" on reload.
Traeger, on prod: `o_war 2.0807 / total 2.153` (adjusted), `o_war 1.367 / total 1.4398` (neutral).
Trevor watched it flash **2.08** (dirty → oWAR only) and settle at **1.44** (clean → neutral total).
**Both numbers were real** — the field just meant different things depending on state.

**Persistence half — and this is the one that bit twice.** `pickHitterWar` reads
`total_hitter_war ?? o_war ?? owar`, and BOTH save paths wrote `o_war` while never writing
`total_hitter_war`:
```
:2326  target/roster save (auto, on toggle)   ← fixed first  → the toggle then HELD
:1949  "Save build" (delete-all + re-insert)  ← still broken → pressing Save REVERTED it
```
The save-build path was worse: `base` is spread from `rp.prediction`, so the stale total was carried
forward *explicitly* and won on the next read.
★ **Fixing one write path made the bug look solved.** Trevor found the second by pressing Save.
**Always enumerate every writer of a field before declaring a persistence bug fixed.**

**THE RULE (Trevor, locked):** dev-aggressiveness and role changes scale **oWAR ONLY**;
`total_hitter_war` = scaled oWAR + dWAR + bsrWAR, with d/bsr **destination-invariant and unscaled**.
`playerProjection` now returns the headline in `owar` **plus** the components (`oWarOnly`, `dWar`,
`bsrWar`) so a caller cannot write the total into `o_war` — a corruption my own first fix introduced.

**LATENT, fixed while in there:** the TWP null-outs cleared `o_war` on a pitcher slot but left
`total_hitter_war` / `d_war` / `bsr_war`. Since `pickHitterWar` prefers the total, a two-way player's
deliberately-cleared hitter side could resurface a WAR.

### 5. GM hub re-derived instead of reading — 4.84 vs 4.86
`PlayerHub` used `low(v) = v * (1 - delta)`, an **additive approximation** of the dev scale, where
PitcherProfile uses the proper multiplicative ratio via `projectEffectivePitcher`. Same intent,
different arithmetic ⇒ a toggled pitcher read **4.84** on the GM home page and **4.86** everywhere
else (Luke Howe).
★ The fix is not a better approximation. **Reading the saved value makes surfaces agree BY
CONSTRUCTION rather than by two formulas happening to match.**

---

## THE DEPTH ROLE IS THE DOMINANT DRIVER — NOT DEV AGGRESSIVENESS
I over-attributed the pitcher gaps to dev. Trevor: *"there are also roles that could be changed …
don't just focus on dev aggressiveness for pitchers."* Correct. Active Arkansas build, snapshot vs
neutral:
```
Neiswonger  weekend_starter vs swing_starter          pWAR 1.157 → 3.677
Krenzel     workhorse_reliever vs mid_leverage_rel.   pWAR 0.537 → 1.547
Henson      swing_starter vs weekday_starter          pWAR 0.004 → 0.788   (pRV+ 79 → 117)
Hering      specialist_reliever vs weekday_starter    pWAR −1.181 → 0.003  (pRV+ 49 → 73)
```
pRV+ moves by dev where the depth role matches (118→125, 92→97, 138→146 are all ×1.0588), but
Henson/Hering move far more than dev can explain — that is the **SP↔RP regression** firing on a depth
change. Depth role sets projected IP, and pWAR scales with IP directly.
⇒ Dropdowns must seed from the SNAPSHOT, or the controls show one role while the numbers show another.

---

## THE `userToggled` FLAG — REQUIRED, NOT A NICETY
`pitcherToggled` decided stored-vs-recomputed by comparing `line.pWar` against `stored.p_war`. Once
`stored` becomes the snapshot, that test **breaks**: the session dev seeds from the dev-NEUTRAL
prediction row (0) while the snapshot carries the build's dev (0.5/1.0), so `line` differs from the
snapshot **on first paint with no user interaction at all**. Without an explicit "the coach actually
moved a control" flag, the page looks toggled immediately and renders a recomputed line — silently
undoing the pure-read fix.
★ **A value-difference test is not a user-intent test.**

---

## OVERLAY, DON'T SWAP
`PitcherProfile`'s `stored` also carries `pitcher_whiff_score` / `pitcher_bb_score` /
`pitcher_barrel_score`, which exist ONLY on the prediction row and feed the PDF + scouting-report
export. A wholesale swap to the snapshot would have silently blanked all three in the exported report.
⚠ Trevor's framing is the right one: *"the scouting grades and data are simply separate displays …
the projections display which should read the snapshot … are different functions."* Keep the sources
separate rather than merging objects; the overlay here is a transition, not the end state.

---

## CONFIG DRIFT IS DETECTED, NOT FIXED
The G46 drift gate compares every local const against `model_config` at job start. Measured on prod:
**43 consts differ**, **75 have NO counterpart** and silently win — including `pwar_ip_sp/rp/sm` and
`market_dollars_per_war`, which means **projected IP per depth role and dollars-per-WAR cannot be
tuned per program** without a code change and redeploy.
🛑 Making the ABSENT keys fatal would have thrown on **every onboarding**. Only `pwar_runs_per_win` is
fatal (verified present at 13.1). ⇒ **Never gate on a key you have not verified exists.**
★ A detector is not a fix. Report FIXED vs DETECTED vs UNVERIFIED separately — see
`feedback_detected_is_not_fixed`.

---

## DATA FINDINGS WORTH KEEPING

**`team_build_players` with NULL `player_id` — prod: 207 rows missing `neutral_snapshot`, of which
191 have no `player_id` and ZERO are real linked players.**
```
 54  no custom_name at all           → unrecoverable
 64  name matches NO players row     → genuinely local/custom
 72  UNIQUE name match               → safely relinkable
  1  ambiguous (Grant Edwards)       → skip, needs a human
```
⛔ **No IDs are recoverable**: `source_player_id` appears in `production_notes` 0 times, `player_id` 0
times. 176 carry `transferSnapshot`, 137 carry `localPlayer` (name/position/team/from_team/conference).
So relinking is a NAME match — the Harrison Cook trap. The algorithm self-checks: Cook has two
`players` rows, so a row naming him lands in the ambiguous bucket and is skipped.
★ **Duplication inflates the count** — 137 named rows are only 85 distinct people (Blake Primrose
appears 6×). "191 orphans" sounds much worse than it is.

**The neutral-snapshot backfill is a NO-OP.** `scripts/backfill-neutral-snapshots.ts` exists,
dry-run-by-default and idempotent, and correctly reports **0 safe writes on prod, 1 on staging**.
Every candidate either has no `player_id` or a prediction row with `o_war` NULL.
🛑 **I initially claimed "13 of 41 Arkansas rows have no neutral snapshot, so toggles compound."
That was WRONG** — those 13 are null-`player_id` local/custom rows. Traeger *had* his neutral snapshot
the whole time. The dry run is what caught it, before writing 7 rows of nulls.

**Environment split, for every future filter:**
```
players.team_id NULL   STAGING 15,560/15,561 (99.99%)   PROD 15,763/31,467 (50%)
```

---

## ⬜ STILL OPEN

1. **`target_board.position_slot` is NULL** — confirmed for Jake Hanley in BOTH environments. The
   board reader picks hitter-vs-pitcher off `position_slot`, and NULL reads as "hitter" (right for a
   1B by luck, wrong for any pitcher). Needs a different key — likely `players.position`, with
   `position_slot` only as the TWP tiebreaker. **The board WAR path and consistency now check out per
   Trevor**, so this is the remaining board defect.
2. **Stub ghosts (Harrison Cook)** — must be fixed at the DATA layer. A display filter on `team_id` is
   environment-fragile and was reverted. Gone from Trevor's Top 5 on staging (he does not exist there
   with a rank); he WILL reappear on prod.
3. **Market values look correct** despite going through a different path — Trevor suspects old logic
   we overrode. Unverified either way; worth a deliberate check rather than an assumption.
4. **72 relinkable rows** — script not written; staging first, unique-match-only, never overwrite an
   existing `player_id`.

## Cross-references
`project_stored_derived_values_architecture` (pure-read) ·
`project_teambuilder_owar_snapshot_regression` (TB live-rebuild vs snapshot — same family) ·
`project_players_team_id_null` (the stub population) ·
`feedback_detected_is_not_fixed` · `project_composite_war` (total = o+d+bsr).

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
