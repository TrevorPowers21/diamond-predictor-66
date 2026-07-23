# Handoff — pERA → Pitcher WAR → Market → Phase B (snapshot source of truth)

> Multi-day effort. This doc is the running record + the verification checklist.
> Keep appending as we make more changes. Staging is done unless noted; **prod
> promotion is still pending for everything here.**

---

## The arc (why this happened)
It started with **pERA / pitcher WAR** looking wrong, and unwound into a full
consistency pass:
1. Pitcher WAR was computed differently on every surface → **unified** it.
2. pRV+ carried decimals while wRC+ was whole → **rounded pRV+** (then found wRC+
   had a JUCO gap too).
3. Depth-role IP wasn't the source of truth (workhorse relievers used 35 IP not 50).
4. Market was **scaled** off stored dollars and used the **player's own conference**
   → switched to **compute from WAR at the destination conference**.
5. The deepest issue: every surface did **"read the snapshot, then re-apply the
   toggles"**, which flickered on load and could double dev-agg. Fixed with the
   **snapshot-as-single-source-of-truth** model (Phase B).

## Architecture now (the model)
- **`player_predictions`** = the immutable NEUTRAL line (dev_agg = 0). Never mutated by TB.
- **build `player_snapshot`** = the DISPLAYED line `f(neutral, toggles)` — per build.
- **build `production_notes`** = the toggle state (dev-agg, depth, role, position).
- **Rule: every surface READS the snapshot. Nothing re-applies toggles on read.**
  - GM + profiles: snapshot-only, always.
  - TB: snapshot-only too, EXCEPT the split-second a toggle moves → live compute
    **from neutral** (instant UX) → Save persists → reload → back to read-only.
- **Guard for the double:** the toggle recompute always starts from
  `neutralPrediction`, never from the adjusted snapshot, so it can't compound.

## Commits (this effort)
| Commit | What |
|---|---|
| `e93eff2` | PitcherProfile pWAR from pRV+, PVF dropped from WAR (the pERA start) |
| `06ae521` | Phase A: whole pRV+, unified `projectEffectivePitcher`, depth-role IP |
| `0f8299d` | Round wRC+ in `projectJucoReturner` (JUCO returners were decimal) |
| `39dc91b` | Market: destination-conference, compute-not-scale; revert bad Slice 1 |
| `8d2b066` | Profile pitcher market → destination conference |
| `a9a8131` | Profile hitter market → destination conference |
| `4b631f5` | Phase B foundation: load `neutralPrediction` separately |
| `57c3e1d` | Phase B core: clean rows read snapshot; dirty recompute from neutral |
| `188e8c6` | Clean-read also covers rostered transfers (Hanley/Cespedes) |
| `6ee3542` | GM snapshot-only; TB reload-after-save = read-only |
| `d879d5b` | TWP pitcher side reads `twp_pitcher_market_value` |
| `003e1b6` | GM target board: side-aware TWP market |

## Data changes (STAGING — must also run on PROD with the code)
- pRV+ rounded to whole + `p_war` recomputed
- `projected_ip` = depth-role IP + `p_war` recomputed (**4,844 rows**)
- wRC+ rounded to whole + `o_war` recomputed (~**1,435** JUCO returners)
- `target_board` + `player_snapshot`, `production_notes` columns
- Re-baked **1,117** build snapshots to `f(neutral, toggles)` at destination conf
- Full DB audit passed: 0 non-integer pRV+/wRC+, 0 WAR mismatches, 0 IP mismatches
- RLS audited (program-scoped by `customer_team_id`) — saved to memory

---

# VERIFICATION CHECKLIST

## 1. Pitcher WAR / pERA (where it started)
- [ ] PitcherProfile pWAR = `computePitcherWar(pRV+, IP)`; role/dev toggles move pRV+ then WAR
- [ ] pERA stored-first on ReturningPlayers; pitcher dashboard loads (no classTransition crash)
- [ ] pRV+ whole everywhere (displayed pRV+ = the number inside pWAR)
- [ ] Same pitcher shows identical pWAR on TB / profile / GM
- [ ] Workhorse reliever WAR uses 50 IP; weekend starter label ~85 IP

## 2. Market values
- [ ] Transfer valued at DESTINATION (Cespedes ~113K at SEC, not old-school tier)
- [ ] Same role + same WAR + same conference → identical market on all 4 surfaces
- [ ] No PVF Friday-starter premium; IF = 1.1 tier
- [ ] TWP pitcher market ≠ $0 (reads twp_pitcher) — roster + GM target board

## 3. Phase B — snapshot source of truth
- [ ] TB loads settled instantly, no flicker (returners + rostered transfers)
- [ ] Toggle = instant; reload = no compounding (no double dev-agg)
- [ ] Save → reload → back to read-only, zero live compute
- [ ] GM row = TB row = profile, exactly
- [ ] Re-bake spot-checks: Souza 118/1.594, Traeger 117/1.562, Cespedes 124/3.028

## 4. Pages to load (browser)
- [ ] TB roster · TB targets tab / target-board display
- [ ] GM roster · GM target board
- [ ] PlayerProfile + PitcherProfile (match TB, read-only)
- [ ] ReturningPlayers / pitcher dashboard · Rankings

## 5. 🔧 IN PROGRESS — Target board = Phase B for targets (SUPERSEDES old display-only)
- **DECISION (Trevor 2026-07-23): targets get the full Phase-B treatment, mirroring the
  roster.** A target's toggles DO persist — to `target_board.transfer_snapshot` +
  `target_board.production_notes` (the "transfer production notes"). The universal
  per-program board reads ONE source (transfer_snapshot) so every team user sees the
  same line, and it loads instantly (no per-target async wave).
- **The model (exact mirror of the roster):**
  - **Neutral** = `neutralPrediction` on the target row = an exact copy of the player's
    program-scoped `player_predictions` line (team precomputed → global/returner fallback,
    dev_agg=0). Immutable — never changes except when precomputes re-run.
  - **Displayed** = `target_board.transfer_snapshot` = f(neutral, production_notes).
  - **Toggle state** = `target_board.production_notes`.
  - Every surface READS transfer_snapshot; nothing re-applies toggles on read.
- **Toggle flow (AUTO-SAVE, no build/name needed):** toggle on the TB target row →
  instant live-compute FROM neutral → **auto-save transfer_snapshot + production_notes to
  target_board (debounced)** → row reverts to snapshot-only (clean read, zero live compute).
  Recompute ALWAYS from `neutralPrediction`, never the adjusted snapshot → no double dev-agg.
- **Add to roster:** copy transfer_snapshot → player_snapshot and production_notes verbatim
  (exact replica) so the roster row === the board row (WAR/market/projected value carry over).
- **Remove from board:** delete the target_board row (its transfer_snapshot + production_notes);
  player page reverts to player_predictions.
- **Surfaces to read transfer_snapshot (roster→player_snapshot, else→transfer_snapshot):**
  TB target board, Targets-tab board, target player profile, GM target board, situation board.
- **Build stages:**
  - [x] Stage 1 (neutral) — ALREADY handled by the sim: a dirty target recomputes from
    `liveTargetPredictionByPlayerId` (the full program-scoped neutral), no add-path threading needed.
  - [x] Stage 2 (instant read) — ALREADY handled: sim clean-read (useTeamBuilderSimulation ~1308)
    reads `transfer_snapshot` synchronously for clean targets → no wave-load.
  - [x] Stage 3 — **DONE (`8c46b7d`)**: debounced `saveTargetToggle` (TeamBuilder.tsx) writes
    transfer_snapshot + production_notes to target_board on any toggle; clears `_dirty`; adopts
    the saved snapshot locally → snapshot-only read. **Roster lockstep**: if the target is
    `included_in_roster`, also mirrors into `team_build_players.player_snapshot`+`production_notes`.
  - [x] Stage 4 — TWP side-aware in the save (twp_hitter/twp_pitcher via `projectedNilForPlayer`,
    merges onto existing snapshot so the untoggled side survives, nulls shared).
  - [x] **Stage 5 — FLICKER LOAD KILLED (`382782e` + `0ced0dc`).** Add now creates the neutral
    `transfer_snapshot` at insert-time (useTargetBoard). The TB sync builds EVERY target row in
    ONE synchronous batch from the board data → instant, no per-player async, no waves. TWPs spawn
    two rows with VALIDATED per-side depth roles (a hitter row can't hold a pitcher role).
  - [x] **TWP side-crossing FIXED at the source** — batch build validates the depth role per side
    (VALID_HIT / VALID_PIT), and the rostered-consistency backfill (`667ce8e`) merges hitter fields
    from the hitter slot + pitcher fields from the pitcher slot (Kenny → owar 1.499 / cornerstone).
  - [ ] **BROWSER-VERIFY** the full cycle: instant load, toggle→save→refresh persist, TWP sides.
  - [ ] **TWP roster-save pollution (latent, low-pri)** — the SP-slot `player_snapshot` carries a
    stale hitter side; not displayed if sides read right, but the roster save shouldn't write the
    other side's stats onto a slot row.
- **Prod rostered-consistency backfill is TWP-merge aware** (`667ce8e`) — hitter fields from the
  hitter slot, pitcher fields from the pitcher slot. Re-run on prod after the transfer_snapshot backfill.
  - [ ] Follow-up: load path could also hydrate the row's toggle CONTROLS from saved
    `production_notes` (today the displayed stats are correct via transfer_snapshot, but the
    depth/dev-agg dropdowns show defaults until re-derived). Low priority — display is right.
- **⭐ Finalization "communication" (Trevor — broader, deferred):** when precomputes finalize,
  `player_predictions` must propagate into (a) target `neutralPrediction`s and (b) default-build
  `player_snapshot`s, so neutrals + default snapshots refresh instead of going stale. Design a
  sync (precompute → neutral predictions + default build snapshots) as part of the finalization ritual.
### Target Phase B — CROSS-SURFACE CONSISTENCY (verify before main — Trevor)
Every surface a target appears on must show the SAME line = its `transfer_snapshot`
(or, if rostered, the build `player_snapshot`), so a saved toggle reads identically
everywhere. Current status:
- [x] **TB target board** — reads `transfer_snapshot` via the sim clean-read (`8c46b7d`).
- [x] **Target player profile** (PlayerHub) — reads `transfer_snapshot`; passes
  `warOverride`/`marketOverride` so `buildPinned` makes the depth/dev-agg controls
  **READ-ONLY** on a target's page. ✔ toggles show as read-only.
- [x] **Added to roster** — reads `player_snapshot`; the toggle lockstep write keeps it
  identical to the board line.
- [x] **Targets-tab board** (`TargetBoardSubtab`) — reads the resolved DISPLAY line
  (roster→`player_snapshot`, else→`transfer_snapshot`, scouting from live) (`8ed583f`).
- [x] **GM target board** (`useGmTargetBoard`) — same resolution (`8ed583f`).
- [ ] **Identical-value pass:** pick one toggled target + one toggled rostered target and
  confirm the WAR / market / projected value match across TB board, Targets tab, profile,
  GM board, and roster.
- [ ] **Read-only toggles on player pages:** confirm depth/dev-agg controls are read-only
  (not editable) on a target's PlayerProfile AND PitcherProfile (`buildPinned`).
- [ ] TWP on the targets page view — verify pitcher/hitter markets show right
- [ ] "NOT IN PORTAL" display bug

## 6. 🔧 OPEN — Player profiles
- **DECISION (Trevor): display-only for RETURNERS + TARGETS; interactive/local for
  everyone else** (pure scouting players not on a roster or board).
- [ ] Extend `buildPinned` (currently `warOverride !== undefined`) so the read-only
  labels also show when the player is a **target** (on the board). Keep the
  interactive Selects only for non-returner / non-target players. `buildPinned` is
  used ONLY for these controls (PitcherProfile 2182, PlayerProfile 1774), so it's
  contained. Make the "from team build" note conditional (build context only).

## 7. 🔧 OPEN — deferred refinements
- [ ] Load-time self-healing guard (verify snapshot == f(neutral, notes), heal drift)
- [ ] TWP re-bake by `position_slot` (fully toggle-adjusted TWP pitcher market)

## 8. Prod promotion (after staging verified, before main)
- [ ] Open staging PR (always-PR rule)
- [ ] Prod SQL batch: pRV+/wRC+ rounding + p_war/o_war + depth-IP + market
- [ ] Prod `target_board` column migration (`player_snapshot`, `production_notes`)
- [ ] Prod re-bake build snapshots (`scripts/rebake-build-snapshots.ts` — recreate; was a one-off)
- [ ] **Prod: `scripts/fix-returner-twp-hitter-market.ts --apply`** — **~137 prod rows**.
      Recomputes returner-TWP `twp_hitter_market_value` with the current canonical
      `computeHitterMarketValue` (new equation) AND nulls the shared `market_value`.
      Must run BEFORE the transfer_snapshot backfill so TWP snapshots pick up the
      canonical split, not the contaminant. (Supersedes the earlier paste-SQL, which
      only nulled — this also makes the stored value canonical.)
- [ ] **Prod backfill `target_board.transfer_snapshot`** — `scripts/backfill-target-transfer-snapshots.ts --apply`
      (TWP-aware now: nulls `nil_valuation` for TWPs, stamps `is_twp`, keeps side-aware splits.
      Expect noPrediction=0. If any noPrediction, STOP — that's the pagination-order bug, not a gap.)
- [ ] **Prod: `scripts/backfill-rostered-target-consistency.ts --apply`** — one-time: for a target
      also on its program's ACTIVE build roster, copy the build `player_snapshot` INTO
      `target_board.transfer_snapshot` (field-mapped) so the two lines are 1:1. Run AFTER the
      transfer_snapshot backfill. Staging: 19 rows reconciled. Lockstep save keeps them 1:1 after.
- [ ] **Prod: `scripts/rebake-twp-markets.ts --apply`** — one-time: recompute every TWP
      `twp_hitter`/`twp_pitcher` market from its stored WAR (`compute*MarketValue`), so market
      matches WAR. Run LAST (after all snapshots exist). Staging done (Kenny twp_hitter → 61,817).

### ⚠️ REMAINING (TWP WAR-read — do before/with the push): rostered TWP row must read its own-side snapshot
- Market now follows WAR everywhere (re-bake `5da59f0`), but the WARs still disagree by slot:
  the roster **live-computes** the TWP hitter (Kenny 1.42) instead of reading its player_snapshot
  (1.499), and the merged `transfer_snapshot` pulls `p_war` from the hitter slot (2.360) not the
  pitcher slot (0.832). Fix: a rostered TWP hitter row reads the HITTER-slot player_snapshot and a
  rostered TWP pitcher row reads the PITCHER-slot player_snapshot (strict own-side), and the
  transfer_snapshot merge takes each side from its own slot. Same "read the snapshot, don't
  live-compute" rule the rest of Phase B follows.
- [ ] You drive the staging → main PR + click prod

### TWP transfer-snapshot fix (Kenny) — staging done, mirror on prod
- **Bug:** the hitter **returner** precompute wrote `market_value` for TWPs (should be NULL —
  the value belongs in `twp_hitter_market_value`). Systemic: **137 prod / 2 staging** returner
  TWP rows. The target-board backfill copied that into `nil_valuation`, so a TWP hitter (Kenny)
  showed the wrong offensive market ($37,489) vs the correct split ($33,259). Transfer rows were
  always clean (market_value NULL); only returner/global rows had it.
- **Code:** `backfill-2027-hitter-returners.ts` now routes the market to `twp_hitter_market_value`
  + nulls `market_value` for `is_twp` (commit `4d9d224`). `backfill-target-transfer-snapshots.ts`
  nulls `nil_valuation` for TWPs + stamps `is_twp` (commit `f165c3c`). TB sim clean-read reads
  market via canonical `pickHitter/pickPitcherMarketValue` (`f165c3c`).
- **Data (staging done):** `scripts/fix-returner-twp-hitter-market.ts --apply` — recomputes
  returner-TWP `twp_hitter_market_value` canonically (new equation) + nulls `market_value`.
  Kenny end-to-end: player_predictions `twp_hitter=36,585, market_value=null`; transfer_snapshot
  `twpH=36,585, nil_valuation=null`. Both consistent + canonical. (Trevor: stored uses the new
  equation; the toggle flow recomputes from that neutral with the same canonical fns.)

### Staging data ops run so far (mirror on prod)
- pRV+/wRC+ rounding + p_war/o_war recompute
- projected_ip = depth-role IP + p_war (4,844 rows)
- re-bake build snapshots (1,117 rows)
- backfill target_board.transfer_snapshot — **162/162 rows, 0 no-prediction**

### ⚠️ Pagination-order bug (found + fixed) — applies to ANY multi-row `.in()` read
The first backfill reported "45 no-prediction" targets (Bell, Grindlinger, etc.) and I
wrongly called them un-projectable. They all HAVE predictions (16 rows each). Two bugs:
1. `.in(N players)` with no pagination hits Supabase's **1,000-row cap** (~16 preds/player).
2. `.range()` with **no `.order()`** returns rows in arbitrary order → page 2 overlaps
   page 1 → whole players silently dropped. **Both checks AND the backfill had this**,
   which is why "prod also has 23" was also false — same artifact.
Fix: paginate within batches of 100 AND `.order("id")`. Then 162/162, noPrediction=0.
- Same bug fixed in the **live GM target board** hook (`src/gm/hooks/useGmTargetBoard.ts`)
  — it did `.in(200)` unpaginated/unordered, so on a large board it dropped targets'
  war/market. Now paginates + orders + filters `season=2027`.
- Lower-risk sibling left as-is: TB `liveTargetPredictions` (`useTeamBuilderSimulation`
  ~line 512) — team-scope filter reduces it to ~2 rows/player, under the cap; and it's
  already slated to be replaced by the `transfer_snapshot` read (§5).
