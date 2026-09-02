# AGENT LEARNINGS — a "stale row" symptom hid a systemic data gap: is_twp was never populated (2026-08-26)

> ⚠ **Read `docs/AGENT_LEARNINGS_INDEX.md` first.** These files were written in sequence during the
> WAR recalibration and **later ones correct earlier ones** — the index says which are superseded.


Status: **DETECTOR APPLIED + PITCHER/HITTER RE-RUN on staging. Re-bake + edge-fn mirror pending.** Dedicated pass; rides the WAR-recalibration prod push as an ordered, logged step.

## ★★★ THE DOCTRINE LESSON (generalize this) ★★★
> A "stale/orphaned row" is a **symptom**, not the bug. The instinct was to null 488 orphaned pitching rows.
> Investigating *why* they were orphaned (Trevor: "investigate positions first") revealed they were **real
> two-way players** whose `is_twp` flag was never set — nulling would have **deleted 40 real pitchers'
> projections** (Evan Dempsey, 88.7 IP / 3.6 pWAR, would have vanished from the board). The fix was **upstream**
> (populate the flag), not the symptom (null the rows).

**Standing check to add:** before cleaning up "orphaned/stale" derived rows, prove *why* the source no longer
produces them. If the answer is "the source classification is wrong/missing," fix the source — deleting the
derived row hides a real record. Mean/coverage checks never catch this (the rows looked like junk).

## THE CHAIN (how one bug report unwound into a systemic gap)
1. **Report:** the projection re-run left "stale pitching rows" — pitchers not refreshed by the batch.
2. **First read (WRONG):** orphaned rows = players reclassified to hitter positions → null them.
3. **Investigate positions:** 193 D1 orphans, **0 with a real hitting sample by the column I queried** (`PA` — a
   bug: the Hitter Master PA column is lowercase `pa`; `PA` read as undefined). Looked like "mislabeled pure pitchers."
4. **Trevor's correction ("Dempsey is a TWP"):** re-checked with the right columns — the "mislabeled pitchers" have
   BOTH a Pitching Master pitcher-Role line (SP/RP, 20–88 IP) AND a Hitter Master line with a real average (.333/.325/.313).
   They are genuine **two-way players**, and `is_twp=false` on every one.
5. **Scope:** only **2** D1 players had `is_twp=true`, but 31–253 real two-way players exist depending on threshold.
   The flag is systemically unset.
6. **Root cause:** the canonical detector `recomputeTwpStatus` (`src/lib/recomputeTwpStatus.ts`) — the ONLY writer of
   `is_twp`/primary `position` — is reachable **only from a manual AdminDashboard button and was never run on
   current-season data.** That's also why TWP mode read "unfinished" in memory: the detection step never executed.

## WHY IT MATTERED (two real bugs, not just hygiene)
The returner pitcher batch pools by `pitcherTest(position) || is_twp`. For a two-way player labeled `OF` with
`is_twp=false`:
- **Pitching side dropped:** never enters the pitcher pool → no pitching projection refresh → stale row + **missing
  from the pitcher leaderboard** (Dempsey's 3.6 pWAR arm invisible). This was the reported "stale rows."
- **Mirror bug:** players labeled `P` who also hit a lot (Drew Nelson 299 pa / .308) had their **hitting** side
  dropped by the hitter batch. Both sides of the two-way population were half-projected.

## THE FIX — run the detector that already exists
`recomputeTwpStatus(2026, paThreshold, ipThreshold)` scans Hitter+Pitching Master and writes `is_twp` + primary
`position`. Promotion: `PA≥paThreshold AND IP≥ipThreshold → is_twp=true`, `position` = hitter Pos if valid else `P`.
Full demotion ladder (rules 1–6) restores single-position players / clears alumni.

### Threshold = PA≥30 & IP≥5 (detector default; Trevor-confirmed)
**Rationale (Trevor):** "if a freshman only has limited of both they could over another year become better… I dont
want guys to lose their eligibility in another position the next year." The decisive fact: the flag is **re-derived
from each season's actuals every run + has a demotion ladder**, so an inclusive threshold **cannot permanently strip**
a developing two-way player's dual-position eligibility — next year's data re-flags or demotes. `50/10` is the cleaner
one-year sample statistically, but that only matters if the flag were permanent — it isn't.

### The 83-flip false alarm (prediction-on-record correction)
A raw pre-count said 83 currently-`P` players would flip to hitter-primary. The dry-run showed **0 flips**: the
detector only sets hitter-primary when a **valid** Hitter Master Pos exists (`validHitterPos` rejects null/`TWP`); the
96 pitcher-side TWPs stay `position='P'` and just gain the flag. Lesson: preview the ACTUAL detector output (dry-run),
don't trust a hand-rolled predicate that skips the detector's guards.

## THE TWP SUBSYSTEM IS FULLY BUILT (the trace, before flipping 253 flags)
Flipping `is_twp` drives real, designed machinery (traced across pipelines + edge fn + ~15 UI surfaces):
- **Market:** TWP row `market_value`→NULL; split into `twp_hitter_market_value` + `twp_pitcher_market_value`; combined
  NIL = sum. Batches already write the split for `is_twp` rows (hitter batch line 316-317; pitcher batch mirror).
- **WAR:** stored as separate hitter + pitcher rows/snapshots, each carrying its own `total_hitter_war` / `p_war`
  (no `twp_*` WAR columns; "never combine into one number"). Team rollups sum both sides.
- **Team Builder:** seeds the same `source_player_id` into both roster slots (one per side).
- **Display:** "primary · TWP" across ReturningPlayers, TeamBuilder, profiles, target board.
- **Maintenance suite:** `rebake-twp-markets`, `rebuild-twp-target-rows`, `fix-returner-twp-hitter-market`,
  `clean-twp-sides 🗑️DELETED-2026-08-31` — all pre-existing. The gap was purely the unrun detector, not missing code.

## HR9-ONLY FLOOR (folded in — narrowed from the earlier blanket floor)
The prior calibration pass floored ALL projected rates at 0 (`Math.max(0, projected)`). Narrowed to **HR9 ONLY**
(Trevor: "only on HR9 should there be a floor at 0, everything else should work as is"):
- `pitcherProjection.projectPitchingRate` — new `floorAtZero` param, passed `true` only from the HR9 call site.
- `transferPitcherProjection.projectLower` — new `floorAtZero` param, `true` only on the HR9 call; `projectHigher`
  (K9) un-floored.
- **Why HR9-only:** HR9 is the lone luck-dominated stat where a thin-sample blend can dip below 0 even after the
  two-sided SD → a physical clamp is realistic (like market value at $0). Every other rate is left UNfloored so a
  negative (which the two-sided SD should prevent) surfaces as a **real bug**, not silently masked — the
  audit doctrine (2026-08-24). Stored data was already HR9-only-floored (66 rows); this makes the code match.

## STAGING EXECUTION (2026-08-26)
1. Added `dryRun` param to `recomputeTwpStatus` (backward-compatible); runner `scripts/run-twp-recompute.ts`
   (Node-CLI service-role client; `--apply` writes, default dry-run).
2. **Dry-run previewed, then applied:** `is_twp` **2 → 253** (D1=90 / JUCO=163): 207 net-new + 45 legacy-`position='TWP'`
   migrated + 1 unchanged; **0 P→hitter flips**; cleanup 31 demote→pitcher, 65 clear→null (alumni), 34 left as
   `position='TWP'` (manual data-fix residuals); 0 errors.
3. **HR9-only floor** code change; `npm test` 265 pass; 0 new tsc errors.
4. **Pitcher re-run** (`precompute-returner-pitchers`): pool 7628 → **7829** (+201 TWPs join), 7633 upserted, propagated
   to 110,383 rows. **0 negative rates across 104,401 pitching rows.** Dempsey pitcher side now `p_war=3.63`.
   253 TWPs → 169 have a pitcher-side `p_war` (rest = JUCO sub-20-IP nulled / no-PM blocked); 141 have both sides.
5. **Hitter re-run** (`backfill-2027-hitter-returners`): 8235 updated, 0 errors; fills `twp_hitter_market_value` +
   NULLs shared `market_value` for D1 TWPs.
6. **Dempsey end-to-end verified:** PITCH `p_war=3.63` / `p_hr9=0.887` / `twp_pitcher_mv=$45,345`; HIT
   `total_hitter_war=1.51` / `twp_hitter_mv=$20,768`; shared `market_value=null`; **combined NIL $66,114**. Correct.
7. **Re-bake** (pending): `rebake-twp-markets` / `rebuild-twp-target-rows` / snapshot re-bake → verify a D1 TWP on a
   roster/target board end-to-end (both roster slots + sane team WAR).

## ★ JUCO TWP MARKET GAP — found + DEFERRED (Trevor 2026-08-26: keep JUCO flagged, fix market later)
Flagging JUCO (163 of the 253) exposed that the **JUCO precompute branches (pitcher line ~391 + hitter line ~260)
only write the shared `market_value` — never the `twp_hitter/pitcher_market_value` split** the D1 paths use. So the
163 JUCO TWPs now have: 0 with the `twp_*` split, 110 with a shared `market_value` (which TWP-aware UI IGNORES
because `is_twp=true`), 53 with none → **all 163 JUCO TWPs show no market on TWP surfaces.** Market split by division:
`twp_pitcher_mv` populated = **90 (exactly the D1 TWP count)**; JUCO = 0.
- **Decision (Trevor):** keep all 253 flagged; **the JUCO TWP market is a KNOWN GAP to fix in the JUCO workstream
  before JUCO ships** — out of scope for the D1 WAR-recalibration push ("D1 only, JUCO separate"). The D1 TWPs (90,
  incl. Dempsey) are fully correct.
- **The fix (when JUCO ships):** make both JUCO branches TWP-aware — for `is_twp` rows write the `twp_*_market_value`
  split + NULL the shared `market_value`, mirroring the D1 paths (hitter batch line 316-317).
- **Also noted (JUCO passthrough behavior, separate):** some JUCO TWPs carry negative passthrough pWAR (Kooper Johnson
  −1.13, Alexis Serna −1.11) — the JUCO passthrough path passing through weak actuals, not a floor/calibration issue.
- ⚠ **Re-bake caveat:** the D1 re-bake will bake NULL JUCO-TWP markets into any JUCO snapshots — consistent with the
  accepted live state, but re-run the JUCO snapshot markets once the JUCO branches are made TWP-aware.

## PROD (see PROD_MIGRATIONS_TODO "TWP FLAG RECOMPUTE")
Run `scripts/run-twp-recompute.ts --apply` against prod (regenerate from prod Masters — do NOT copy staging flags)
**BEFORE** the returner/transfer precomputes, then the same re-run + re-bake sequence, then deploy the edge fn.

## RELATED
`project_two_way_player_mode` (the flag is its prerequisite — now populated) ·
`feedback_pause_and_confirm_before_changes` (investigate-first + dry-run-first saved 40 real pitchers) ·
`feedback_stop_and_talk_on_real_problems` (the escalation from "null 488 rows" to "systemic flag gap") ·
`AGENT_LEARNINGS_projection_calibration_two_sided_sd_2026_08_24` (the HR9 floor + doctrine this builds on).
