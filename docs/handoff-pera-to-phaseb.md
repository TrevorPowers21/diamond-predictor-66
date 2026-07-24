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
- [ ] **Prod: `scripts/clean-twp-sides.ts --apply`** — one-time: make every TWP snapshot
      OWN-SIDE ONLY (hitter slot = hitter fields + null pitcher; pitcher slot the reverse),
      rebuild the merged transfer_snapshot from the correct slots, and bake `twp_hitter`/
      `twp_pitcher` markets from the WAR. Run LAST (after all snapshots exist). Supersedes
      `rebake-twp-markets.ts`. Staging done (Kenny: hitter 1.499/cornerstone/61,817, pitcher
      0.832/swing_starter/31,193, cleanly separated).

## 9. Pitcher-market PVF resync + depth-on-target-snapshot (Georgia audit, 2026-07-24)
**Why:** the pitcher-market MODEL dropped the weekend-starter PVF (×1.2) long ago
(`pitcherProjection.ts:503` = pWar × $/WAR × tier, no PVF), but the rows baked
before that change still carried it. The target board copies `player_predictions`,
so 13 Georgia pitcher targets read ~20% high; Overbeek read his old-conference
value; Sifford had a negative (pre-floor) market. Roster WAR was already clean.
**Fix = data only (no projection rerun); market is a pure function of stored WAR.**
Run IN THIS ORDER, dry-run each first, --apply after:
- [ ] **`scripts/fix-pitcher-market-pvf.ts --apply`** — canonical resync of stored
      pitcher `market_value` + `twp_pitcher_market_value` in `player_predictions` =
      `pWar × 25000 × tier` (no PVF, floor $0), ALL teams. Gated + self-validating
      (rows within 4% of recompute confirm tier resolution matches the precompute;
      unexplained rows are logged, never written). Staging: 59,334 rows changed
      (43,231 precision, 15,146 PVF, 957 stale-vs-WAR/anomaly), $0 residual on re-run.
      Row-by-row → slow (~10-15 min); idempotent, so safe to re-run if interrupted.
- [ ] **`scripts/resync-target-snapshots.ts --all --apply`** — recompute
      `target_board.transfer_snapshot` MARKET in place from its own stored WAR at the
      program tier (preserves toggled WAR, unlike a re-copy), and stamp
      `hitter_depth_role`/`pitcher_depth_role` (production_notes override → precompute's
      stored role IF it reproduces the stored WAR → WAR-derived fallback). Staging: 91 rows.
- [ ] **`scripts/resync-build-snapshot-markets.ts --all --apply`** — floor non-positive-WAR
      build `player_snapshot` markets to $0 (position-independent). Positive-WAR hitter
      markets are left to the app's live bake (position may be null → don't guess).
      Staging: 1 row (Sifford). 0 elsewhere.
- [ ] **Verify:** `scripts/audit-georgia.ts` → 0 inconsistencies (roster + target board,
      full WAR + market + depth checks). Adapt the build/customer_team ids for other programs.
- Add-path already stamps depth + corrected market from predictions (`useTargetBoard`
  lines 148-150) → new adds are correct. Latent follow-up: some `player_predictions`
  pitcher rows have a depth label stale vs their own (later-recomputed) WAR — the resync
  validates+falls-back, but the precompute finalization should re-derive depth from WAR.

### ✅ Removed the last stray live-compute for targets (`37ec75d`)
`PlayerTableRow` ran `simulateTransferProjection` (a live transfer-to-team compute) for EVERY
target and displayed its oWAR/market, overriding the snapshot read. It coincidentally matched
for real transfers but was wrong for a returner-on-the-board (Kenny: off a wrong-team transfer
wRC+ 113 → 1.42, while wRC+ correctly read 115 from the snapshot). Now targets read
`projection.owar` + `projectedNilForPlayer` (the snapshot: rostered→player_snapshot,
else→transfer_snapshot). No call sites of `simulateTransferProjection` remain.
**RULE (Trevor): the ONLY live compute allowed is the split-second a toggle moves (dirty row
recomputes from neutral, then auto-saves → snapshot read). Every other row — returner, rostered,
target — reads its stored snapshot. Nothing else should ever live-compute.**

### ✅ TWP strict own-side — FIXED (`3316078`)
Root cause: each TWP slot snapshot carried a polluted off-side (RF slot bad p_war 2.360, SP slot
bad o_war 1.315), and the merged transfer_snapshot pulled the wrong side, so market/WAR crossed.
Fixed: data cleaned (own-side per slot); `saveMutation` writes a TWP slot own-side only + routes
market to the `twp_` split; `saveTargetToggle` bp mirror is own-side + the lockstep writes only the
matching slot. A hitter row now only ever reads/writes hitter data, a pitcher row only pitcher.
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

## 10. Notes-recipe + active-build resolver + full DB verify (2026-07-24, cont.)
**Discovery (from the Georgia audit):** rostered targets had a `transfer_snapshot`
(values) but NULL `production_notes` — the rostered-consistency backfill copied the
snapshot without the RECIPE that creates it. Trevor: notes create the snapshot;
carry them BOTH ways; only the ACTIVE build touches the board.

### Staging done — run on prod in this order (dry-run each, then --apply)
- [ ] **`scripts/set-active-builds.ts --apply`** — set `team_builds.is_active` for
      programs with no flag, via the shared resolver (same-team → current
      academic_year → largest roster → most-recent). Staging: 14 programs
      (Arkansas→"Arkansas Baseball 2027 Roster", Kansas→"2027 Proj Jayhawks" via the
      season guard). **PROD: coordinate with Trevor — real users/activity differ from
      staging; confirm each program's live build before flipping.** Exactly one active per team.
- [ ] **`scripts/backfill-target-notes-from-roster.ts --apply`** — mirror each one-way
      rostered target's active-build roster `production_notes` → `target_board.production_notes`.
      Staging: 37 rows (Georgia 17, Arkansas 17, +3). TWP skipped (phase 2).
- [ ] **`scripts/backfill-rostered-target-consistency.ts --apply`** — RE-RUN (now that
      all programs have an active build) to reconcile board `transfer_snapshot` ← active
      roster `player_snapshot` (1:1). Fixed to select `position_slot` so the TWP merge
      is side-correct. Staging: 38 rows.
- [ ] **Verify:** `scripts/verify-all.ts` → 0 issues across all programs (active-build
      uniqueness + resolver agreement, target snapshot WAR-from-depth + market=f(WAR) at
      program tier, rostered board notes==roster notes + snapshot 1:1). Staging: **0**.

### Code shipped (staging branch)
- `src/lib/activeBuild.ts` — `resolveActiveBuildId` (one source of truth).
- `useGmTargetBoard` + `TargetBoardSubtab` — repointed off bare `.eq(is_active,true)` to the resolver.
- `TeamBuilder.saveMutation` — mirrors one-way rostered-target notes → target_board,
  **gated on the active build** (non-active scenario builds never write board notes).
- GM `createBuild` already marks the first non-default build active (no change needed).

### ✅ TWP two-row target board — DONE on staging (2026-07-24). Prod steps below.
A TWP is now TWO `target_board` rows (hitter slot + pitcher slot), each own-side with
its own snapshot + notes, mirroring the roster. All TWP-gated → non-TWP (single row,
null slot) unchanged. Kenny: RF 1.499/$61,817/cornerstone + SP 0.832/$31,193/swing_starter.
verify-all = 0 across 15 programs incl. the TWP two-row section.
- **Migration `20260724120000_target_board_twp_two_row.sql`:** adds `position_slot`,
  DROPS **every** unique constraint on the table (there were TWO — user_team_player AND
  team_player; a 2nd-row insert hit the second), then a slot-aware unique index
  `(user_id, customer_team_id, player_id, coalesce(position_slot,''))`. **PROD: apply this.**
- **Code (staging branch):** `useTargetBoard` (row carries position_slot + is_twp;
  addPlayer inserts 2 own-side rows for a TWP); `TargetBoardSubtab` + `useGmTargetBoard`
  + `GMTargets` (classify by row slot, per-side roster snap, render/drag keyed by row id);
  `saveTargetToggle` (writes the matching side by slot, t own-side, settles the toggled
  side only); `PlayerHub` (fetch both, pick the profile's side). `runDataCascade` nulls
  all snapshots — no change needed.
- [ ] **PROD one-time: `scripts/rebuild-twp-target-rows.ts --apply`** — idempotent; for
      each TWP on a board, delete its rows for the team and reinsert exactly two own-side
      rows (roster if rostered, else gatekept prediction). Run AFTER the migration.
- [ ] **Verify:** `scripts/verify-all.ts` → 0 (incl. TWP two-row section).

## 11. Persisted neutral_snapshot (kills the dev-agg compounding class, 2026-07-24)
**Why:** the build load only fetched player_predictions for rows WITHOUT a snapshot,
so a SAVED player (Flukey) had a null `neutralPrediction` at runtime and the toggle
recompute stacked dev-agg off his own already-adjusted snapshot (3.87→3.67→3.47…).
Audit proved 0 players actually lack a neutral ROW (the "130"/"27" were my own
batched-fetch bugs — use the per-player fetch). Two fixes shipped:
1. **`useLoadBuild` immediate fix** — fetch predictions for EVERY build player (not
   just snapshot-less ones), so the live neutral loads for saved players.
2. **Persist it** so it can never go null again (Trevor's call): store the dev_agg=0
   line ON the row.
- [ ] **Prod migration `20260724130000_neutral_snapshot.sql`** — add `neutral_snapshot jsonb`
      to `team_build_players` + `target_board`.
- [ ] **Prod: `scripts/backfill-neutral-snapshot.ts --prod --apply`** — populate every
      build/target row from the gatekept neutral (own-side for TWP; side = position_slot
      ?? player.position). Staging: 1116 build + 165 target (all dev_agg=0). no-AB/local skipped.
- **Code:** load prefers `neutral_snapshot ?? live predictionMap`; `saveMutation`
  re-stamps it on the roster insert (else a re-save wipes it); `addPlayer` stamps
  own-side on new target rows.
- [x] **Follow-up (damage cleanup) — DONE on staging (self-heal Step 2).**
      `scripts/heal-stale-snapshots.ts --all --apply` re-derived `snapshot = f(neutral, notes)`
      for the provably-safe set: **73 rows healed** (devAgg=0, no SP/RP role transition → f is
      EXACT). Full-line rebuild: copies the neutral's rates+index, re-WARs at the saved
      (sanitized) depth, re-markets at program tier. Flukey 4.17→3.16 (de-compounded),
      Kenny SP 2.36→0.83, Grube wRC+121→126 (up to the verified-live projection).
      - **Pitcher-depth sanitize:** a pitcher slot whose notes.depthRole is a HITTER role
        (pollution, e.g. Kenny build 837125ae `everyday_starter`) falls back to the neutral's
        `pitcher_depth_role` — only ever corrects, never overrides a real choice.
      - **28 QUARANTINED, NOT healed:** 14 devAgg≠0 toggled pitchers + 14 devAgg=0 pitchers that
        cross the SP/RP boundary (Cespedes, Paz, Flores, Ritter…). `projectEffective` doesn't
        model the role-transition rate regression, so its WAR is NOT valid for them — their
        snapshots are correct via the sim's regression. **DO NOT heal until projectEffective
        models SP↔RP.** They self-heal on the next toggle anyway.
      - **Neutral verified live first (Trevor's ask):** all 73 stored neutrals == the live
        `player_predictions` correct row (strict team-precomputed → global regular, no cross-team
        fallback), 0 mismatch — so healing toward the neutral is toward the current truth.
      - Verify: re-run heal dry-run → 0 healable; `verify-all` → 0 across 15 programs.
      - **v2 (SP↔RP role model): +4 more healed on staging.** `projectEffective` now models
        the sim's role-transition regression (commit `b274d33`) — session role resolved
        SLOT-first (`effectivePitcherRoleForBuild`), and a TARGET row looks THROUGH to the
        player's active-build roster slot so a null-slot target keeps the roster's transition.
        Also `projected_ip` fallback: a null-depth pitcher uses the neutral's stored IP, not the
        RP default (fixed a false Collin-Smith "drift"). v2 heal: Farley/Palmer (⇄ transitions)
        + Nottingham/Peavy (stale rv+). Re-run dry-run 0; verify-all 0. Faithful: 1262/1280
        match (13/16 transition rows reproduce their snapshot exactly). The old depth-based
        quarantine is GONE (the model handles transitions); only `devAgg≠0` is now set aside.
      - [ ] **Still open — the `devAgg≠0` class (~6 rows).** Toggled pitcher rows whose snapshot
            drifts from `f`. Needs its own targeted pass (confirm whether stale or a devScale
            edge on toggled rows) before healing. Not urgent — they self-heal on next toggle.
      - [ ] **PROD: `scripts/heal-stale-snapshots.ts --prod --apply`** — run AFTER the
            neutral_snapshot backfill (needs the stored neutrals) + all market/depth resyncs.
            Dry-run first; confirm counts + spot-check Flukey/Kenny/Farley before --apply.
- Stale class = snapshots baked before a later neutral change (rounding / market fix); spread
  EVENLY across active (6.9%) + inactive (6.8%) builds — NOT a non-active-build gap. The re-bake
  DID hit every build; the neutrals just moved afterward. Heal closes that gap for good.
