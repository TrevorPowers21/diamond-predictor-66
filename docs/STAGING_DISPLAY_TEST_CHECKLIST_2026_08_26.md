# STAGING DISPLAY-TEST CHECKLIST — feature/war-recalibration (2026-08-26)

Verify every user-facing change on **staging** before the prod push. Only changes that alter what a coach *sees* are
listed; each has a concrete PASS/FAIL. If a FAIL condition is met, do not push. Companion to
`docs/PROD_PUSH_STEPS_2026_08_26.md` (the data/prod side). This is display-only — no data runs.

## ★ TOP-PRIORITY REGRESSIONS (check these first)
1. **Headline hitter WAR = `total_hitter_war` (o+d+bsr) everywhere**, not oWAR — every "oWAR" label should now read "WAR".
2. **Transfer market value priced at the LOGGED-IN program's conference**, not the player's origin school.
3. **TWPs appear on BOTH hitter and pitcher sides** (two rows / both slots), with per-side WAR + combined NIL.
4. **Team Builder WAR-sort ordering is monotonic** (no lower-WAR player above a higher one).
5. **Only the standalone `/savant/*` sub-app (routes + 8 pages) was deleted** — the **"savant-style" season-stats
   DISPLAYS are KEPT** (`src/savant/components/*`) and now render inside the in-product Season Stats pages
   (`/dashboard/player/:id/stats`, `/dashboard/pitcher/:id/stats`). Confirm the loss of the standalone Leaderboards /
   Conference Stats page / Team Profiles is intended (the per-player season-stats display is not lost).

## ⚠ TWO THINGS TO CONFIRM WITH TREVOR BEFORE PUSH
1. `HistoricalPlayerTable` pitcher link → `/player/:id` (PlayerHub). **FIXED this branch** — PlayerHub's identity
   lookup now resolves a uuid OR a source_player_id (`PlayerHub.tsx:176`, mirrors `usePlayerSourceId`), so a historical
   player's identity, **pitcher/hitter classification**, headshot, TWP flag, and **season-stats preview** all resolve
   (previously a historical pitcher misclassified as a hitter + blank preview). VERIFY on staging: click a pitcher in a
   Historical table → PlayerHub opens the correct (pitcher) profile, header populated, and the **Season Stats tab shows
   the savant-style display** wherever the player has 2026 pitch_log (a pre-2026 alumni correctly shows "No pitch-log data linked").
2. `/savant/*` deletion removed Leaderboards, Conference Stats page, Team Profiles, and the hitter career/scouting/
   power-ratings/prediction/risk cards with **no replacement** — confirm intended for this branch.

---

## 1. Player Dashboard / Returning Players  (`/dashboard/returning`)
| What changed | PASS / FAIL |
|---|---|
| Hitter table header **"oWAR"→"WAR"**, value = `total_hitter_war` via `pickHitterWar`, sort on total | PASS: header **WAR**; a player w/ nonzero d/bsr shows value ≠ oWAR; sort orders by total. FAIL: still "oWAR" or offense-only |
| Scouting chips: stored `*_score` first, then live pitch_log 2026 percentile fallback | PASS: chips populate for tracked players who were blank; match the player's profile chips |
| wRC+ = canonical C1 (0.011+0.691·OBP+0.235·SLG ÷0.3782) | PASS: a known hitter's wRC+ shifts vs main |
| Admin class-transition/dev-agg/apply-template row controls deleted | PASS: no inert dropdown left in returner rows |
| Overview home: "Recent Portal Activity" → **"Top Available Players"** (best uncommitted by projection, cap 50) | PASS: panel titled Top Available Players, lists by projected value |
| Overview cards (Top 5 Hitters/Pitchers/Target Board) titles clickable | PASS: each title navigates |
| Target Board rows show real portal status (In Portal/Committed/Withdrawn/Not In Portal/Watching) w/ color+icon | PASS: a committed target reads "Committed" (blue), not blanket "Watching" |
| JUCO panel: wRC+→C1, pRV+→canonical D1-FIP index (not JUCO-centered) | PASS: JUCO pitcher pRV+ is D1-scaled (avg arm ≠ 100) |

## 2. Player Profile — hitter  (`/dashboard/player/:id`)
| What changed | PASS / FAIL |
|---|---|
| Headline WAR box **"oWAR"→"WAR"** = `total_hitter_war`; recomputes total when depth/dev toggled | PASS: box reads WAR, = total_hitter_war (≠ oWAR when d/bsr nonzero) |
| Market Value off **total** WAR at **destination (logged-in program) conference + current position** | PASS: a transfer viewed by an SEC program shows SEC-tier dollars, not origin school; position toggle flows |
| New Overview/Season Stats tab strip (Oswald, active tab gold `#D4AF37`) | PASS: strip renders, active gold, click navigates, Back preserved |
| Scout-grade tiles: raw stat + ordinal percentile + tier; stored-first then live pitch_log | PASS: raw + "87th percentile" + tier; no-data metric shows `—`/`N/A`, never "0 / Poor" |
| Bio labels "{2026} Team/Conference", **"{2027} Class"** (advanced one year) | PASS: bio shows 2027 Class |
| Career 2026 row prefers pitch_log PA + slash (incl postseason) | PASS: 2026 slash matches pitch_log (PA can jump vs HM) |
| TWP gold **TWP** badge + tooltip; Target/Follow buttons flip label when already listed | PASS: two-way player shows gold TWP badge |
| Program-hub embedded: depth-role/dev-agg become read-only "assigned from build" labels | PASS: read-only labels in hub |

## 3. Pitcher Profile  (`/dashboard/pitcher/:id`)
| What changed | PASS / FAIL |
|---|---|
| "Stuff+ Overview" card **removed** from left column | PASS: card gone |
| pWAR + Market via canonical `projectEffectivePitcher`; market at destination/logged-in conference | PASS: reflect logged-in conference for a transfer; role/dev toggle recomputes |
| Scout tiles: raw + ordinal percentile; Stuff+/Whiff/BB%/Barrel live pitch_log first | PASS: tiles show raw + percentile |
| Arsenal names source-case ("4-Seam Fastball"), 2026 usage% from pitch_log incl previously-dropped pitches | PASS: mixed-case, includes missing pitches, usage% recomputed |
| Input Metrics header "{season} Input Metrics · pitch log" | PASS: shows "· pitch log" for a 2026 pitcher |
| Bio "{2027} Class"; 2025 pRV+/risk via canonical FIP index | PASS: 2027 Class; values differ from main |

## 4. Team Builder  (`/team-builder`)
| What changed | PASS / FAIL |
|---|---|
| Budget Used = `totalActualNil` (only coach-typed Actual Values), not sum of projected | PASS: typing one Actual Value raises Budget Used by exactly that; untouched rows $0. FAIL: old sum-of-projected |
| **Compare tab deleted entirely** | PASS: no Compare UI reachable |
| Hitter WAR sort = oWAR from dev-adjusted wRC+ over depth PA | PASS: sort monotonic w/ displayed WAR |
| Pitcher WAR sort = pWAR at depth-role innings, **PVF removed** | PASS: RP→SP conversion doesn't outrank an equivalent true starter |
| pRV+ rounded to integer | PASS: displayed pRV+ agrees w/ its WAR |
| Market = WAR × $/WAR × **this build's team** conference tier | PASS: reflects logged-in team conf; repeated dev-agg toggles return same value (no drift) |
| Projected NIL = `allocateNil` rank-decay honoring Balanced/Top-Heavy | PASS: switching GM Balanced/Top-Heavy changes TB NIL distribution |
| Target rows read stored snapshot (live re-sim off) | PASS: a target's oWAR + NIL match Targets tab / Transfer Portal exactly |
| TWP two-slot load: each side own snapshot, pitcher returners hydrate pWAR, coach depth-role override wins on reload | PASS: reloaded build shows both a hitter + pitcher row w/ correct per-side WAR; returner pWAR/market not blank; depth role survives |
| Build mgmt: "Default Roster" first, current-season-only, New/clone/rename/save modals, season banner, default auto-seeds returners | PASS: dropdown Default Roster first, current-season only; a no-build team shows returners not blank |
| `projectedEligibilityClass` advances one year; pitcher depth "~80 IP"→"~85 IP" | PASS: TB eligibility class matches elsewhere; dropdown reads ~85 IP |
| Shared dated Notes dialog; `CurrencyInput` on Total Budget/Initial Value | PASS: notes dialog dated; $ inputs format w/ commas |

## 5. Transfer Portal  (`/transfer-portal`)
| What changed | PASS / FAIL |
|---|---|
| WAR tile **"oWAR"→"WAR"** = `total_hitter_war`; color thresholds (>1.5 emerald, ≥0.5 blue) on total | PASS: reads WAR, = total_hitter_war |
| Conference env+/HTP read stored Conference Stats (no live compute) | PASS: projections populate; spot-check a JUCO/edge conf |

## 6. Target Board  (`/dashboard/targets`, `/gm/targets`)
| What changed | PASS / FAIL |
|---|---|
| WAR column **"oWAR"→"WAR"** = `total_hitter_war`; sort composite | PASS: header reads WAR |
| **TWP on both hitter and pitcher tables** (two rows), each own line/market | PASS: a known TWP in both sub-tabs; adding a TWP creates two rows. FAIL: appears once |
| Portal status badge matches profile exactly | PASS: Committed/Withdrawn shows that badge, not "Watching" |
| 6-tier percentile scouting chips (live pitch-log first); sticky columns + horizontal scroll | PASS: chip colors match profile; sticky columns pin, no layout break |
| Superadmin add toast names team; no-team superadmin blocked + empty board | PASS: add toast names team; no-team superadmin sees clear block |

## 7. Rankings / Comparison / High Follow
| What changed | PASS / FAIL |
|---|---|
| Player Comparison hero "oWAR"→**"WAR"** = composite | PASS: reads WAR, = composite |
| High Follow (`/dashboard/high-follow`) chips live pitch-log percentile | PASS: chips populate, match profile |
| NIL Valuations (`/dashboard/nil`) route commented out / unreachable | Not testable unless re-enabled — confirm intentionally hidden |

## 8. GM / Front Office  (base `/gm`, superadmin/team_admin)
**Cross-page invariant:** Home, Roster, Funding Sources, Analytics must compute budget "used" identically
(Rev + NIL[unassigned+vendor] + Other[unassigned+vendor]). Any disagreement on the same build → **FAIL**.
| Route | Check |
|---|---|
| `/gm` GMHome | Tiles real dollars; Committed = Σ roster Actual Pay; Remaining red if negative; totals match Roster |
| `/gm/roster` GMRoster | Type $8000 NIL → shows $8,000, Actual Pay recomputes, Total updates; Finalize✓→writes coach Team Builder. FAIL: Projected Value blank w/ budget set, or vendor money missing from NIL/Other |
| `/gm/recruiting` GMRecruits | Add recruit + scouting report/grades → saves, tier badge + grade chips render; move to Committed → Committed $ rises. FAIL: grades don't save, or evaluating recruits inflate budget |
| `/gm/contracts` GMContracts | Upload PDF → value/dates auto-fill; "reviewed" gate blocks save; saved row shows $ + clickable PDF; obligation toggle persists. FAIL: PDF extract discards or gate bypassable |
| `/gm/allocations` Funding Sources | Vendor $50k pool, allocate $10k → Remaining $40k AND player's Roster NIL +$10k. FAIL: double-count or totals disagree |
| `/gm/scenarios` Situation Room | Drop a player → WAR/Pay/Headroom deltas green/red, "nothing saved"; reload discards. FAIL: edits persist |
| `/gm/analytics` GMAnalytics | Pay/WAR tiles + WAR Comparison (Total/Lineup/Rotation/Bullpen vs prior-season benchmark, champion, seed range from `team_war_snapshots`); $/win = pay÷WAR; splits match Roster. FAIL: "No benchmarks" for a team that has snapshots |
| `/gm/targets` GMTargets | Willing-to-Pay $200k persists; Add to Roster → confirm dialog, appears on Roster/Home + "On Roster". FAIL: mutates default build directly |
| `/gm/settings` | Change budget cap/grade field → reflected in Roster/Recruits inline popups + mobile grade rendering |
| `/m/recruiting` MobileRecruiting | Phone viewport: recruits list per class/group; add w/ dup detection → appears on desktop board grouped |
| `/dashboard/settings` ScoutingCsvUpload | Toggle Hitters/Pitchers/Stuff+, template opens; valid CSV → "Upload complete", bad file → specific error |

## 9. Savant / Pitch-Log Displays — ARCHITECTURE CHANGE (routes moved, displays KEPT)
**Precise scope (git-verified):** DELETED = only the standalone `/savant` sub-app — 2 wrappers (`SavantLayout`,
`SavantRoute`) + 8 pages (`SavantHome`, `SavantIndex`, `LeaderboardsPage`, `ConferenceStatsPage`, `TeamsListPage`,
`TeamProfilePage`, `HitterPage`, `PitcherPage`). **KEPT = all of `src/savant/components/*` + `src/savant/lib/*`** — the
actual "savant-style" display components (CareerStatsTable, CareerScoutingTable, CareerPowerRatingsTable,
PerPitchSuccessTable, PowerRatingsCard, PredictionCard, PercentileBar, BaseballField, Stuff+ runners…). They now render
**inside** the in-product Season Stats pages below. **The savant-style season-stats display is NOT lost — only the old
route shell.**
| Route | Check |
|---|---|
| `/savant`, `/savant/leaderboards`, `/savant/conferences`, `/savant/teams`, `/savant/team|hitter|pitcher/:id` | **Routes + pages deleted** — every `/savant/*` URL 404s/redirects. ⚠ Confirm the STANDALONE Leaderboards / Conference Stats page / Team Profiles going away is intended (the per-player displays live on at `/dashboard/.../stats`) |
| `/dashboard/player/:id/stats` HitterPitchLog | Stats/Visuals toggle; panels Batted Ball / Plate Discipline / Per-Pitch Success / Ball Flight / **Inferred Bat Speed + Squared-Up%** (new); Visuals spray + 13-zone heat maps. Tracked → "2026 vs NCAA Avg"; untracked → "No pitch-log data linked" |
| `/dashboard/pitcher/:id/stats` PitcherPitchLog | Quality of Stuff / Batted Ball / Per-Pitch; Visuals strike-zone density, 13-zone usage, usage pie (~100%), movement plot (clusters by type), whiff/xwOBA zones; tracking badge FULL/PARTIAL/LOW. Untracked → empty-state. "Rolling xwOBA — coming next" is an intentional placeholder |

## 10. Conference Stats tables (still-live embedded)
| Component | Check |
|---|---|
| ConferenceStatsTable (hitting) | wRC via `computeWrcRaw` (0.011+0.691·OBP+0.235·SLG; AVG/ISO now 0) — no longer old 0.45/0.30/0.15/0.10 blend |
| PitchingConferenceStatsTable | HTP shows stored canonical park-swap value = `hitter_talent_plus`, not live recompute |

## 11. Admin Dashboard  (`/admin`, superadmin only — low display risk)
- wRC section adds **Intercept** field + C1 helper text.
- oWAR constants relabeled "Derived (read-only) — league physics" (Runs/PA 0.3994, Repl 21.22, Runs/Win 13.1).
- **NIL PTM 5-bucket editor removed** (now per-conference via model_config).
- Power Ratings: ISO Pull%/LA10-30 → single **"Pull Air %"**; WHIP now includes **Stuff+**; HR/9 now includes **HardHit%**.

## 12. What's-New Modal / Release Notes  (`WhatsNewModal.tsx`)
Open the modal, confirm each of the six new entries renders (headline + bullets, no em-dash issues), and the top
release's landing route works. Newest first: 2026-07-17 "Introducing the Front Office" (landing `/gm`, auto-navigates
on dismiss — verify it lands GM home only for GM-access users) · 2026-07-09 inferred bat speed/squared-up · 2026-07-04
improved roster building · 2026-06-29 Visuals tab + per-pitch run value · 2026-06-27 scouting grades w/ percentile ·
2026-06-23 comprehensive 2026 analysis.
