# RSTR IQ Defensive Runs Engine (dRS) — Build Specification v1.0

**Status:** Ready for build (captured 2026-08-03). Owner: Trevor Powers.

---

## 0. Codebase reality + data validation (added 2026-08-03, verify before building)

**This does NOT yet plug into an existing pipeline.** The spec below references
"Steps 1–6" and a "responsibility assignment layer (complete)" — **none of that
exists in this repo.** Our current `scripts/ingest_pitch_log.ts` (+ the `pitch_log`
table) consumes the TruMedia **"Pitch Log"** export and imports ~48 of its 84
columns; it reads **none** of the columns this engine needs (`atbatDesc`, the fielder
alignment, catcher-throwing, blocking, baserunners). So Step 7 here is really a **new
ingest + new data model**, not a bolt-on.

**Two complementary TruMedia exports (confirmed against real files 2026-08-03):**
- **"Standard" export** (this engine's source; validated vs `Standard (1).csv`, 340
  rows, game `cs-nor02202606200` UNC@OKLA): carries `atbatDesc` (event grammar), full
  fielder alignment (`CenterFielder`…`FirstBaseman`), catcher-throwing
  (`PopTime`/`CThrowSpd`/`CExchTime`/`CTimeToBase`/`SBA2`/`SB2`/`SBA3`/`SB3`), blocking
  (`pPBWP%`), baserunners (`ManOnFirst/Second/Third`), and `xAVG`/`SprayAng`/`FBDst`/
  `HangTime` — all populated. The Statcast-tracking block (`hang`/`dist`/`react`/
  `speed`/`jump`/`wall`/`infieldDist`/`infieldTime`/`outProb`/`pathEff`) is **empty
  (`-`)** here — matches Section 2.2 rule 5.
- **"Pitch Log" export** (current pipeline): the tracking block IS populated (verified
  ~100% on BIP), but it has NO `atbatDesc`/alignment/catcher columns. → For the v2
  native-xOut (Section 5.3), join the two exports on `uniqPitchId`.

**ACTION — columns to ADD to the ingest (new Standard-export ingest / `pitch_events`):**
`atbatDesc`, `pitchOutcome`, `HangTime`, `pPBWP%`, `SBA2`, `SB2`, `SBA3`, `SB3`,
`PopTime`, `CThrowSpd`, `CExchTime`, `CTimeToBase`, `CThrowBase`, `PickAttBase`,
`ManOnFirst`, `ManOnSecond`, `ManOnThird`, and the 7 alignment fields `CenterFielder`,
`RightFielder`, `LeftFielder`, `ShortStop`, `ThirdBaseman`, `SecondBaseman`,
`FirstBaseman`, plus game keys `gameId`/`gameString`/`playGuid`. (`SprayAng`, `FBDst`,
`xAVG`, `probSL` already map in the Pitch Log ingest.) The Standard export has ~114
columns w/ duplicate `battingTeam`/`pitchingTeam` (keep first, assert equal) — use
position-indexed reading, never DictReader.

---

## 1. Purpose and Scope

Compute a component-based defensive runs metric (dRS) for every D1 position player
from TruMedia pitch log exports. Architecture follows DRS/UZR credit-and-debit
accounting with a spray-aware expected-out baseline, using explicit putout attribution
parsed from retrosheet-style event strings.

**In scope (v1):** Range Runs, Error Runs, Double Play Runs, Outfield Arm Runs,
Catcher Framing Runs, Catcher Blocking Runs, Catcher Throwing Runs, Bunt Runs.
Player-season rollup with components stored separately.

**Non-goals (v1):** positional adjustment + runs-per-win → dWAR (deferred, Section 12);
custom xOut model (v1 uses TruMedia xAVG); infielder arm / 1B scoop; positioning
adjustment (no data); pitcher dRS in UI (pitchers still get range credit in chains).

## 2. Input Columns and Normalization
Source: TruMedia standard pitch log export (validated vs Standard__1_.csv 340 rows,
Standard__2_.csv 970 rows, 3 games).

Columns consumed: `atbatDesc` (PA-ending, retrosheet event string — primary
attribution), `pitchResult`, `ExitVel`/`LaunchAng`, `SprayAng`, `FBDst`/`HangTime`
(HangTime has "s" suffix), `xAVG` (string ".689", spray-aware), `probSL` (decimal),
`pPBWP%` (strip %), `SBA2`/`SB2`/`SBA3`/`SB3`, `PopTime`/`CThrowSpd`/`CExchTime`/
`CTimeToBase` (attempt rows), `ManOnFirst/Second/Third` (runner names), `CenterFielder`
…`FirstBaseman`/`catcherId`/`pitcherId` (alignment every pitch), `outs`/`inn`/`count`/
`batterHand`, `gameId`/`gameVenueId`/`teamId`.

Normalization: `-`/empty → NULL; strip "s" from HangTime; strip "%" ÷100 for
pPBWP%/pCallStrk%; cast xAVG float (.000 on K unused); dead columns dropped
(`outProb`, `statcastFieldersInitialFielderPosition`, `pathEff`, `hang`, `dist`,
`react`, `speed`, `jump`, `wall`, `infieldDist`, `infieldTime`); duplicate
`battingTeam`/`pitchingTeam` keep first + assert equal.

## 3. Event Grammar Parser
Parse `atbatDesc` on every PA-ending row. Structure: `[event][modifiers].[baserunner
block]`.
- Event: fielder chain for outs (`63`, `8`, `463`); `S|D|T|HR` hits; `E{pos}` reached
  on error; `FC{pos}` fielder's choice; `K`/`W`/`HBP` upstream.
- Modifiers (slash): `/G /F /L /P /B /SF /SH /GDP /LDP`; hit zone as trailing digits
  (`S/7`, `D/78`, `HR/9`); `(RBI)` ignored by defense.
- Baserunner block after first `.`, semicolon-separated: `2-3` advance; `1X2(64)`
  runner out w/ chain; `3-H` scored.

Parsed fields: event_type, putout_chain (`463/GDP`→[4,6,3]), putout_fielder,
assist_fielders, bb_type, is_bunt, is_dp, hit_type, hit_zone (`D/78`→[7,8]),
error_fielder, fc_fielder, runner_movements.

Known cases (validated): `E3.2-3;1-2`, `FC.1-2(E3)` (FC fielder unknown, error to 3),
`S/7(RBI).2-H;1X2(726)` (OF assist chain on a hit), `46/LDP.2X2`, `13/G/B/SH.2-3` (sac
bunt), `K/S(23)`. Any parse failure → exceptions log (Section 10), never dropped.

## 4. Event Routing (→ components)
Out non-bunt → Range credit (putout fielder; on grounders the first fielder in chain).
Hit non-bunt → Range debit (responsibility vector) + Arm opportunity. Reached on error
→ Error debit (full-punishment). FC → Range credit, never a debit (locked). FC w/
embedded error → error fielder debit only. GDP/LDP → Range + DP credit. Hit w/ runner
kill (`1X2(726)`) → Range debit + Arm credit. Bunt → Bunt component (out of main
range). Sac fly → Range + Arm opportunity. HR → no action (park factors). K/BB/HBP →
framing/blocking engines only.

## 5. Expected Out Baseline (xOut)
v1: `xOut = 1 − xAVG` per fair BIP. xAVG is spray-aware (validated: 87.2/24.0 EV/LA
priced .190 at spray 21.4 vs .633 at spray −43.7; down-the-line liners ~.94, central
~.60–.77; 52.2 EV bloop at spray 40.9 → .508). Trained on college data. Fallback
ladder: (1) full tracking → xAVG; (2) xAVG present EV/LA missing → xAVG; (3) xAVG
missing fair BIP → league-avg xOut by BB type; (4) none → league-avg BIP xOut + log.
League xOut-by-BB-type is a frozen per-season fixture. v2 (deferred): native P(out)
model on ~2.5M pitch_events (EV, LA, spray, hang, distance, hand, park).

## 6. Component Definitions (accumulate at play level → player-season; constants §7)
- **Range (RngR):** out → putout fielder earns `(1−xOut)×RUNS_PER_PLAY` (air: putout
  from chain full credit; ground: first fielder in chain gets range); hit → each
  responsible fielder debited `responsibility_p × xOut × RUNS_PER_PLAY` (vector from
  Step-1 layer, refined for air by FBDst/HangTime; parsed hit_zone cross-checks); FC →
  out credit, no debit.
- **Error (ErrR):** max punishment — base `1.0×RUNS_PER_PLAY` to error fielder + `RUNS_
  PER_BASE` per extra base advanced. Stored/displayed separately from RngR (hands vs
  range diagnostic).
- **DP (DPR):** opportunity = grounder w/ runner on first, <2 outs; GDP pivot+turn
  split `(converted − league_rate × opp) × RUNS_PER_DP`; LDP caught liner → RngR +
  doubling-off → DPR.
- **Outfield Arm (ArmR):** from runner movement on hits to zones 7/8/9 w/ runners; kill
  (`X` + chain starting w/ OF) → out value + erased advancement; hold vs league
  expectation fractional. `ArmR = kills + holds_vs_expectation`.
- **Framing (FrmR):** every taken pitch — called strike credit `(1−probSL)`, called
  ball debit `probSL`; `FrmR = Σ(credits−debits) × RUNS_PER_STRIKE`; attribution via
  `catcherId`.
- **Blocking (BlkR):** `(Σ pPBWP − actual PB/WP charged) × RUNS_PER_PBWP` (v1 charges
  the PB/WP gap jointly; discloses WP partly pitcher).
- **Throwing (ThrR):** from `SBA2/SB2/SBA3/SB3` — `CS×RUNS_CS + (SB_allowed −
  league_SB_rate×attempts)×RUNS_SB`; PopTime/CThrowSpd/CExchTime displayed only;
  pitcher-hold confound disclosed.
- **Bunt (BntR):** all `/B` events; conversion above/below league bunt rate; small,
  regressed hard.

## 7. Run Value Constants (D1 run environment, per-season frozen fixtures)
`RUNS_PER_PLAY` (~0.78 MLB; D1 = runvalue(hit)−runvalue(out) from D1 RE24, expect
higher), `RUNS_PER_BASE` (~0.25), `RUNS_PER_DP` (~0.40), `RUNS_PER_STRIKE` (~0.12),
`RUNS_PER_PBWP` (~0.28), `RUNS_CS`/`RUNS_SB` (~0.44/0.20). **The D1 RE24 matrix (24
base-out states) is the FIRST build task — every constant depends on it.**

## 8. Regression + Presentation
~56-game seasons → regress every component toward zero via league-avg phantom
opportunities (default prior ≈ 120 games; BntR/ThrR heavier). UI = floor/ceiling
(floor = regressed, ceiling = raw), house style. Lead the card with components
(Range/Errors/DP/Arm; Framing/Blocking/Throwing for catchers), headline = sum.

## 9. Output Schema — `player_season_defense`
grain: player × season × position (multi-pos → one row per position + rollup row).
Cols: player_id, season, org_id (RLS), position (1–9, 0=rollup), games, innings_est,
bip_opportunities, range_runs, error_runs, dp_runs, arm_runs, framing_runs (catchers),
blocking_runs, throwing_runs, bunt_runs, drs_total, drs_floor (regressed), drs_ceiling
(raw), plays_made, plays_above_avg, errors, assists, putouts, pop_time_avg,
constants_version, engine_version, computed_at. (dWAR/positional-adjustment cols
intentionally absent — deferred layer writes its own table.)

## 10. Exceptions Log — `defense_engine_exceptions`
Every unprocessable row lands here w/ raw `atbatDesc`, `uniqPitchId`, reason code
(`PARSE_FAIL`, `ZONE_MISMATCH`, `TYPE_MISMATCH`, `PARTIAL_TRACKING`, `ALIGNMENT_GAP`,
`NEW_VOCAB`). Weekly review; recurring `NEW_VOCAB` → promoted into grammar.

## 11. Validation Plan
Tier 1 unit (frozen fixtures): parser tests for every §3.3 case + 20 synthetic strings
(`6E3`, `E6/G`, `FLE8`); constant derivation reproduces frozen values. Tier 2 component
(frozen games cs-nor02202606200, cs-wes04202606170, cs-geo04202606170): E3 dribbler
(26.4 EV) → `−(1.0×RUNS_PER_PLAY)−advancement` to 1B; 7-2-6 kill credits LF arm; 8 FC
events non-negative range; 463 GDP splits DP 4 & 6. Tier 3 season sanity: league sums
≈0 per component; SS/CF lead plays-above-avg, 1B trails; anchor eyeball vs staff
consensus. Folded Tier-1 item: confirm SprayAng sign vs parsed hit zones.

## 12. Deferred: dWAR Conversion + Defensive Projection Layer
**Now spec'd in `docs/DWAR_CONVERSION_AND_PROJECTION_SPEC.md` (Addendum v1.0, design
locked 2026-08-03).** That addendum SUPERSEDES this paragraph's "MLB-scaled positional
adjustment" idea: positional adjustment is replaced by **empirical per-position scales**
derived from our own full-season data (the MLB ladder is explicitly NOT imported), average
is learned (not assumed to self-center), and replacement is learned per position from the
depth tier. D1 runs-per-win (~2× league R/G) stands. Reads `player_season_defense` + a new
`position_defense_scales`, writes `player_season_dwar`. No changes to this spec. **Build
blocked on the full-season import** (dependency chain starts with Open Item #5 below).

## 13. Open Items
1. Confirm remaining error grammar (`6E3`, dropped-fly) from messier exports — Trevor.
   Not blocking (NEW_VOCAB path).
2. Confirm pPBWP% joint PB/WP calibration w/ TruMedia — Trevor. Not blocking.
3. SprayAng sign assertion — Tier 1 test. Not blocking.
4. WP/PB identification via `pitchOutcome` codes — **blocking for BlkR only**.
5. League fixture derivation (RE24 matrix, constants, league xOut-by-BB-type,
   advancement rates) — **blocking, FIRST build task**.
6. Multi-position innings attribution (mid-game swaps) — alignment is per-pitch,
   handles natively. Not blocking.
