# AGENT LEARNINGS — snapshot layers, and why the automated checks all passed while the UI was wrong (2026-09-01)


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


Status: **FIXED AND AUDITED ON BOTH DATABASES.** Staging ✅ CLEAN; prod clean but for 2 inert keys.

## ★★★ DOCTRINE — THE CHECK THAT PASSED WAS CHECKING THE WRONG LAYER ★★★

> Trevor found this by clicking through Team Builder after I had reported the data verified:
> Hudson Brown **.396** in Team Builder vs **.385** on Player Profile. Overbeek **.306** vs **.304**.
> Primrose and Lawson matched — **which is exactly why spot-checking two players proves nothing.**

I had verified `neutral_snapshot` — 1,254/1,254 on the correct source row, toggles intact, and I said
so. All of that was TRUE and none of it covered the bug, because a **board-only target does not render
from neutral**. It renders from `target_board.transfer_snapshot`
(`useTeamBuilderSimulation.ts:1359`), which I had never touched: **60 of 74 rows stale.**

**⇒ Before declaring a surface verified, establish WHICH STORED FIELD THAT SURFACE ACTUALLY READS.**
Verifying an adjacent field with great rigour is not verification. Trace the read path first, then
verify that field, then say it is verified.

## THE THREE LAYERS
| layer | is | read by |
|---|---|---|
| `neutral_snapshot` | dev_agg=0 BASE, **no toggle state** | build rows (`neutralPrediction ?? prediction`) |
| `target_board.transfer_snapshot` | toggle-BAKED board copy | **board-only targets** |
| `team_build_players.player_snapshot` | toggle-BAKED build copy | saved value + fallback |

A precompute rewrites `player_predictions` and **nothing cascades**. All three go stale silently.

## ★ VERIFY TYPES, NOT JUST VALUES
`node-postgres` returns `numeric` (OID 1700) and `int8` (20) as **strings**. The build pitcher neutral
is a **verbatim** copy of the prediction row, so my first `--refresh` wrote every numeric as a JSON
string and **crashed Team Builder** — `shownMetric.toFixed is not a function`, 627 staging / 653 prod
rows, live on prod ~20 minutes. Every value was *correct*; the *type* was wrong.
```ts
pg.types.setTypeParser(1700, v => v === null ? null : Number(v));
pg.types.setTypeParser(20,   v => v === null ? null : Number(v));
```
🛑 **"Copy the row verbatim" is only safe when the driver's type mapping matches the consumer's.**
Gate: `jsonb_typeof(snap->'p_war') = 'number'`.

## ★ THREE FALSE ALARMS I RAISED — ALL THE SAME MISTAKE
Each was a conclusion the evidence did not contain. I stated them before measuring the thing itself.
1. **"Sub-40-IP pitchers diverge between implementations."** They didn't. I was comparing **stale local
   rows** against freshly-computed edge rows. Two GENERATIONS of a row, not two implementations.
2. **"The local script's `total_hitter_war` drifts from its components."** It doesn't — exact on
   221,318 rows across both DBs. I had measured the LOCAL components against the EDGE total, which
   proves the EDGE is exact and says nothing about local.
3. **"4 target-board rows are wrong."** All four were Josiah Overbeek, a **TWP** whose pitcher-slot
   rows correctly hold pWAR, while my `coalesce(o_war, p_war)` pulled his hitter oWAR off the same row.
**⇒ Before diffing two things, prove they are COMPARABLE: same generation (check `updated_at`), same
side (a TWP carries both on ONE row), same field name (`market_value` is stored as `nil_valuation`,
`o_war` as `owar`).**

## ★ WHAT ACTUALLY CAUGHT THE REAL BUGS
Not review, not typecheck, not eyeballing output:
- **Diffing two independent implementations over the same team** found the `IF` position multiplier
  missing from the edge function's 1.1 tier — every infielder onboarding priced **10% low**.
- **A human clicking through the UI** found the stale board snapshots.
Both were invisible to every check I ran. Keep both in the loop.

## RUNBOOK + FINAL AUDIT
Full ordered commands and the per-table audit numbers live in Track B
(`docs/PIPELINE_pitch_log_to_projections.md`). Gate: `scripts/audit-snapshot-consistency.ts` must
print **✅ CLEAN**.
