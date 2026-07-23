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

## 5. 🔧 OPEN — Target board (Team Builder)
- **DECISION (Trevor): board = DISPLAY-ONLY.** A board target just shows its stored
  line; toggles only happen once pulled onto the roster. So NO production_notes
  persistence on the board — the fix is purely "read the stored line instantly."
- [ ] Load-order issue — board display waits on the async `liveTargetPredictions`
  query (`useTeamBuilderSimulation` ~line 512) → targets pop in one-by-one. Make
  it read the immediate stored line (snapshot / `transfer_snapshot`) like the
  targets tab, so it loads instantly.
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
- [ ] Prod `target_board` column migration
- [ ] Prod re-bake build snapshots
- [ ] You drive the staging → main PR + click prod
