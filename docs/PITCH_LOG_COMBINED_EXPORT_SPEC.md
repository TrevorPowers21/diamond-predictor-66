# Combined Pitch Log Export — the single-file column spec

**Purpose:** request ONE TruMedia export that carries every column all our derived data needs, so future
loads are a single upload (`ingest_pitch_log.ts`) with no second merge pass. Today the data is split
across two exports and the `pitch_log` table had to be *widened + backfilled* to unify them
(`supabase/migrations/20260806_pitch_log_widen_attribution.sql`). This spec is so we never do that again.

## The two exports we're unifying (why one file is needed)

| Export | Carries | Missing |
|---|---|---|
| **"SprayAng+Distance re-export"** (2026-06-24; loaded the `pitch_log` table) | pitch-shape: `Extension`, `RelHeight`, `RelSide`, `PZNorm`, `PXNorm`, `xSLG`, `xWOBA` + `SprayAng`/`FBDst`/`xAVG` | ALL attribution (`atbatDesc`, fielders, base state, steals, catcher-throw), `HangTime`, `pCallStrk%` |
| **"DRS Pitch Log"** (`docs/drs-reference/*.DRS Pitch Log.csv`; runs the dRS engine) | attribution + `HangTime` + catcher-throw + `pCallStrk%` + base tracking (`Vel`/`IVB`/`HB`/`Spin`/`ExitVel`/`LaunchAng`/`SprayAng`/`FBDst`/`xAVG`) | `Extension`, `RelHeight`, `RelSide`, `PZNorm`, `PXNorm`, `xSLG`, `xWOBA` |

**The combined export = DRS Pitch Log's full column set + the 7 re-export-only shape columns.**

## Canonical column set (TruMedia header → db column → consumer)

Consumer key: **SHAPE** = pitch-shape/stuff+, **TRK** = batted-ball tracking, **ATTR** = dRS/wSB attribution,
**ID** = identity/join, **FRAME** = framing/blocking, **THROW** = catcher throwing.

### Identity / join (ID)
| TruMedia header | db column | notes |
|---|---|---|
| `uniqPitchId` | `uniq_pitch_id` | PRIMARY join key; UNIQUE constraint added 2026-08-06 |
| `date` | `date` (+ `season` derived) | doubleheader ` (N)` suffix stripped |
| `gameVenueId` | `game_venue_id` | |
| `level` | `level` | |
| `inn` | `inn` | |
| `outs` | `outs` | base-out state (ATTR too) |
| `home` | `home` | |
| `teamId`/`opponentId` | `team_id`/`opponent_id` | |
| `pitchingTeamId`/`battingTeamId`/`catchingTeamId` | `pitching_team_id`/`batting_team_id`/`catching_team_id` | LAST occurrence (dup names) |
| `pitcherId`/`batterId`/`catcherId` | `pitcher_id`/`batter_id`/`catcher_id` | |
| `fullName`/`pitcherAbbrevName`/`batterAbbrevName`/`catcherAbbrevName` | `pitcher_full_name`/`pitcher_abbrev_name`/`batter_abbrev_name`/`catcher_abbrev_name` | |
| `pitcherHand`/`batterHand` | `pitcher_hand`/`batter_hand` | |
| `pitchResult` | `pitch_result` | |
| `count` | `count` | |
| `pitchType` | `pitch_type` | |
| `totalRuns`/`currentRuns`/`opponentRuns`/`opponentCurrentRuns` | `total_runs`/`current_runs`/`opponent_runs`/`opponent_current_runs` | |
| `x`/`y` | `x_loc`/`y_loc` | |

### Pitch shape (SHAPE) — re-export only; drives stuff+
| `Vel` | `release_velocity` |
| `IVB` | `ivb` |
| `HB` | `hb` |
| `Spin` | `spin` |
| `Extension` | `extension` | **re-export only** |
| `RelHeight` | `rel_height` | **re-export only** |
| `RelSide` | `rel_side` | **re-export only** |
| `PZNorm` | `pz_norm` | **re-export only** |
| `PXNorm` | `px_norm` | **re-export only** |
| (derived) | `stuff_plus` | computed by `compute_pitch_log_stuff_plus.ts` — NOT from CSV |

### Batted-ball tracking (TRK)
| `ExitVel` | `exit_velocity` |
| `LaunchAng` | `launch_angle` |
| `SprayAng` | `spray_ang` |
| `FBDst` | `distance` | **NB: db `distance` == `FBDst`, not the dead `dist` col** |
| `HangTime` | `hang_time` | strip trailing `s`; **added 2026-08-06** |
| `xAVG` | `x_avg` |
| `xSLG` | `x_slg` | **re-export only** |
| `xWOBA` | `x_woba` | **re-export only** |

### dRS / wSB attribution (ATTR) — DRS-export only; **added 2026-08-06**
| `atbatDesc` | `atbat_desc` | retrosheet event string — the parser basis (putout chain, error fielder, hit zone, movements, bb_type, bunt/DP) |
| `FirstBaseman`/`SecondBaseman`/`ThirdBaseman`/`ShortStop` | `first_baseman`/`second_baseman`/`third_baseman`/`short_stop` | fielder-alignment NAMES → resolve chain positions to player ids |
| `LeftFielder`/`CenterFielder`/`RightFielder` | `left_fielder`/`center_fielder`/`right_fielder` | (Catcher already `catcher_abbrev_name`) |
| `ManOnFirst`/`ManOnSecond`/`ManOnThird` | `man_on_first`/`man_on_second`/`man_on_third` | base-out state (RE24); engine reads `ManOnFirst`/`Second`/`Third` (not the `ManOn1st`/`2nd`/`3rd` variants) |
| `SBA2`/`SB2`/`SBA3`/`SB3` | `sba2`/`sb2`/`sba3`/`sb3` | steal attempt/success flags (0/1) — wSB throwing fixture |
| `Runs` | `runs` | runs-on-the-play (RE24 re-derivation) |

### Framing / blocking (FRAME)
| `probSL` | `cs_prob` | **already in table** — importer maps `probSL → cs_prob` (a mislabel; it IS the framing strike prob) |
| `pPBWP%` | `p_pbwp_pct` | passed-ball/wild-pitch prob (blocking); **added 2026-08-06** |
| `pCallStrk%` | `p_call_strk_pct` | **added 2026-08-06** |

### Catcher throwing (THROW) — **added 2026-08-06**
| `PopTime` | `pop_time` |
| `DelivTime` | `deliv_time` |
| `CTimeToBase` | `c_time_to_base` |
| `CThrowBase` | `c_throw_base` |
| `CExchTime` | `c_exch_time` |
| `PickAttBase` | `pick_att_base` |

### Dead / ignored (DO NOT map)
`hang`, `dist`, `react`, `speed`, `jump`, `wall`, `infieldDist`, `infieldTime`, `outProb`,
`pathEff`, `statcastFieldersInitialFielderPosition` — the Statcast positioning block is EMPTY (all `0`/`-`)
in these exports. The real tracking is `FBDst`/`HangTime`/`SprayAng`. (`normalize.py` DEAD_COLS.)

## COVERAGE GAP — INHERENT, NOT FIXABLE (2026-08-07, RESOLVED)
The DRS export is missing **79 pitchers (~1.5%), ~0.14% of pitches** — it has only ONE team-half of some
games (e.g. game 444179791: Wisc-side 189 pitches present; Iowa-side 265 absent). All 7,711 games are
*present*, some one-sided. **RESOLVED by test:** Trevor re-pulled the 4 affected dates (Feb 17/24, Mar 3/4)
in full DRS format — **0 of the 79 were captured.** The missing teams only exist in the basic Pitch Log
layout (no fielder alignment), so they are UNTRACKED and dRS cannot attribute their plays. This is the
inherent TrackMan coverage limit (agent notes: "tracked teams skew toward stronger programs"), NOT a pull
error or a deferrable fix. The certified aggregates are already as complete as trackable data allows;
nothing to merge or re-run. Do NOT chase this further — re-pulling won't recover it.

## When requesting the export in the future
1. Ask TruMedia for the **DRS Pitch Log** layout **plus** `Extension`, `RelHeight`, `RelSide`, `PZNorm`,
   `PXNorm`, `xSLG`, `xWOBA` — AND verify it includes BOTH halves of every game (the 2026 pull missed 79
   pitchers; diff distinct pitchers/games against the prior pull before trusting completeness).
2. Extend `ingest_pitch_log.ts` `FIELD_TO_HEADER` + `PitchLogRow` + `buildRecord` to map the ATTR/FRAME/
   THROW columns above (they're not mapped there yet — the current importer is the re-export layout).
3. Load once via `ingest_pitch_log.ts` (upserts on `uniq_pitch_id`; UNIQUE constraint enforces one row/pitch).
4. Non-overlapping date windows if split across files — overlapping windows are what created the 3,425
   dupes (`5.13-5.15` ∩ `5.15-5.21` share 5/15). The UNIQUE constraint now makes that a no-op instead of a dup.
