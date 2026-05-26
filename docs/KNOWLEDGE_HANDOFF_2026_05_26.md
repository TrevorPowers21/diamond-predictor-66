# Knowledge Handoff — Session State 2026-05-26

For future agents picking up after context compact. Read this top-to-bottom before doing anything.

## Project context

**RSTR IQ** — college baseball player development platform. Product owner is Trevor (coach himself). Built on Supabase + Vite/React + TypeScript. Three customer-team tiers (going to market mid-2026). All projections, risk grades, NIL valuations, and scouting reports power roster decisions for actual college programs.

## Repository

- Path: `/Users/danielleogonowski/dev-main/diamond-predictor-66`
- Current branch: `feature/scouting-report-scrape` (off main)
- Other relevant branches:
  - `main` — production
  - `staging` — pre-prod test
  - `hotfix/juco-d1-leaderboard-blend` — merged 2026-05-25
  - `feature/juco-eager-precompute` — merged 2026-05-24
  - `feature/stored-vs-live-audit` — merged 2026-05-24

## Latest shipped work (chronological)

### 2026-05-24
- Eager precompute (D1) live for all 7 customer teams
- Stored-first display across PlayerProfile/PitcherProfile/Dashboard/TB target board (live-compute removed, session overlays only for depth/dev_agg/role transition)
- TWP position corrections (46 + 29 = 75 players)
- Position multiplier change (OF→1.1, UTL→1.0)
- Edge Function pitcher precompute port

### 2026-05-25
- JUCO eager precompute live (7 teams × hitter + pitcher = ~14K rows)
- Presto Sports JUCO stat import (2,061 hitters + 2,569 pitchers — TruMedia PA undercount fixed)
- JUCO display surfaces read from `player_predictions` (impersonation-aware)
- JUCO pitcher calibration (ERA + FIP comp 1.0, BB9 0.30)
- Arizona State customer team added — exposed bug where JUCO blended into D1 leaderboards; hotfixed

### 2026-05-26 (in progress)
- Scouting framework deep-dive Q&A with Trevor
- `src/lib/scoutingPercentiles.ts` — empirical D1 distribution tiers for 11 hitter + 12 pitcher metrics, direction-aware `tierFor()` helper
- `src/lib/scoutingArchetypes.ts` — named hitter (9) + pitcher (6) archetype enums with detection. NEEDS UPDATE — Bregman archetype not yet added; Stevenson detection bug (uses bad chase instead of plus chase per latest framework refinement)
- `src/lib/imports/pull-air` — Pull Air % column added to Hitter Master, 5,245 prod rows loaded
- `docs/SCOUTING_REPORT_FRAMEWORK_2026_05_26.md` — master reference for scouting framework (THIS is the source of truth for tier thresholds, archetype detection, voice rules, pitch-shape evaluation)

## Trevor's working preferences (learned)

### Workflow rules (LOCKED — never deviate)
- **Push to staging first, then main.** Never feature → main directly.
- **SQL writes:** send raw SQL for Trevor to paste in Supabase SQL editor. Don't run TS scripts that do writes.
- **CSV imports:** go DIRECTLY to prod via `npm run import:prod` (skip staging unless the import script itself changed).
- **PR for main promotion:** always `gh pr create`, never direct merge push.
- **Plaintext for creds/paths:** no clickable links for copy-paste targets.

### Working style
- **Holistic > single-metric thinking** — "elite barrel + average EV + good contact = good bet" rather than "elite barrel alone = good"
- **Data-driven thresholds** — when Trevor says "ok with that," prefer empirical distributions over hand-tuned numbers
- **"Elite" used sparingly** — P95+ only across the board, not P75+
- **Voice rules matter** — no framework jargon in reports, scout verbs only, never explain what a metric means in prose
- **Trust + verify** — Trevor catches inconsistencies fast (saw the "32.1% chase at P88" contradiction immediately), so always sanity-check direction-aware percentiles in writing
- **Status updates short** — Trevor wants bullets and outcomes, not narrative
- **Branches preferred** for non-trivial work; hotfixes get their own branch

### Decision-making patterns
- **Compute first, ask second** — pull empirical distributions before proposing thresholds
- **One question at a time** — Trevor prefers stepping through framework Q&A sequentially rather than walls of questions
- **Defer JUCO when limited data** — don't extrapolate, just say "stuff data not consistent"
- **Reliever risk as canonical flag** — anytime BB% bad regardless of stuff tier, use this term

## Current scouting Q&A status (12 of N questions answered)

**LOCKED:**
1. Chase tier breakpoints + "elite sparingly" rule
2. Barrel as #1 predictive single stat
3. Contact tiers + competition-aware framing
4. Power axis (EV / EV90 / barrel / Pull Air interaction)
5. BB% tiers + "elite approach" definition + tricky combos
6. Stuff+ tiers + IZ whiff as elite-stuff validator + JUCO defer
7. BB% as variance driver + "reliever risk" canonical flag + chase competition-aware
8. Chase tiers — descriptive only, breaking ball quality metric
9. IZ Whiff tiers + true stuff validator
10. Hard Hit + Barrel — Cole (high-vert FB) archetype, transfer-up flag, college baseball nuance
11. Ground Pct tiers + sinker archetype refined
12. 4S FB pitch-shape tiers + VAA framing + the illusion combo + market inefficiency flag
13. Sinker pitch-shape tiers + ABS HB convention + bowling ball descriptor + sinker velocity king

**STILL OPEN:**
- Run pitch-shape queries for Slider, Sweeper, Curveball, Gyro Slider, Changeup, Cutter, Splitter
- Refactor `scoutingReportGenerator.ts` to use named archetypes + tier-driven language
- Strip the `savant`/`rstriq` variant split
- Extract `buildPromptContext(player)` helper
- Lock the Bregman archetype detection in code
- Fix Stevenson detection (currently expects bad chase, should be plus chase per latest rule)
- Create `ai_scouting_reports` table migration
- Build edge function for AI generation

## Punchlist (from `project_post_launch_punchlist_2026_05_24.md`)

21+ items captured. Key ones in priority order:
1. TWP position fixes (DONE 5/24)
2. JUCO precompute parity (DONE 5/25)
3. ~~Filter JUCO off Overview~~ (DONE — Q21 hotfix)
4. AI Scouting Report scrape (IN PROGRESS — this session)
5. Risk Assessment audit (planned, parallel to AI scrape)
6. Live-compute audit (mostly DONE 5/24)
7. Pitcher `baseProjectedPWar` fallback audit
8. Park Factors rekey on (source_team_id, season)
9. Profile page TODOs (team abbrev, pin projections, blended-everywhere)
10. Sprint 2026-06-01 items (GM interface, D2/D3 portal scraper, beta-client version tracking)
11. ~~Old prod URL guard cleanup~~ (DONE 5/25)
12. Post-demo remainders
13. Class adjustment for portal pitchers
14. Conference Stats fill gaps
15. ~~TWP profile UI~~ (deferred)
16. Equation Weights table audit vs code constants (after AI scrape)
17. Filter sub-threshold players out of search (deferred)
18. JUCO FIP recalibration post-Presto
19. Cross-team Player Dashboard UX cleanup ("2027 projection" labeling vs verbatim 2026)
20. JUCO pitching transfer portal simulator behavior investigation

## Key data state (PROD, as of 2026-05-26)

- Customer teams (8 with auto-fire trigger active): Arkansas, Arizona State (NEW), FAU, Georgia, Kansas, Penn State, Stetson, TCU
- D1 hitter regular variant rows: ~31K with o_war/market_value populated
- JUCO hitter regular variant rows: ~2,700 with o_war populated (1,363 still missing — sub-threshold or no p_wrc_plus)
- JUCO precomputed rows: ~14K (7 teams × ~1,440 hitters × ~1,000 pitchers)
- Pull Air% on 5,245 D1 hitter rows
- Edge Function deployed to prod with both `hitters_d1` + `pitchers_d1` scopes

## Common SQL patterns

### Get percentile distribution for a metric
```sql
SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY <metric>) AS p95
FROM "<Table>" WHERE <division_filter> AND <qualified_filter>;
```

### Check JUCO data state
```sql
SELECT COUNT(*) AS rows, COUNT(*) FILTER (WHERE o_war IS NOT NULL) AS with_owar
FROM player_predictions pp JOIN players p ON p.id = pp.player_id
WHERE p.division = 'NJCAA_D1' AND pp.variant = 'regular' AND pp.customer_team_id IS NULL;
```

### Verify customer team precompute
```sql
SELECT ct.name, COUNT(*)
FROM player_predictions pp JOIN customer_teams ct ON ct.id = pp.customer_team_id
WHERE pp.variant = 'precomputed' AND pp.model_type = 'transfer'
GROUP BY ct.name ORDER BY ct.name;
```

## Critical files

| File | Purpose |
|---|---|
| `src/lib/scoutingPercentiles.ts` | Empirical tier definitions (LOCKED) |
| `src/lib/scoutingArchetypes.ts` | Named archetype detection (NEEDS UPDATE — Stevenson + Bregman) |
| `src/lib/scoutingReportGenerator.ts` | Rule-based generator (NEEDS REFACTOR — drop variant split, use percentile-driven language) |
| `src/lib/playerRisk.ts` | All risk assessment (981 lines, recalibration target post-2026 season) |
| `src/components/RiskAssessmentCard.tsx` | Risk card (RSTR + Savant variants) |
| `src/components/JucoRiskCards.tsx` | JUCO-specific risk cards |
| `src/pages/PlayerProfile.tsx` | Hitter profile — risk card + scouting report rendered here |
| `src/pages/PitcherProfile.tsx` | Pitcher profile |
| `src/components/JucoPlayerDashboardPanel.tsx` | JUCO subtab leaderboard |
| `src/savant/pages/HitterPage.tsx` | Savant hitter — same report generator, different chrome |
| `src/savant/pages/PitcherPage.tsx` | Savant pitcher |
| `src/lib/pdfGenerator.ts` | PDF export (uses scouting_notes today, will switch to AI report when ready) |
| `supabase/functions/process-precompute-jobs/index.ts` | Eager precompute worker (D1 + pitcher live; JUCO scope future) |
| `docs/SCOUTING_REPORT_FRAMEWORK_2026_05_26.md` | THE master framework reference (sourced from this session's Q&A) |
| `docs/SCOUTING_RISK_AUDIT_2026_05_25.md` | Code state audit |
| `docs/JUCO_AUDIT_2026_05_24.md` | JUCO pipeline audit |
| `docs/HANDOFF_2026_05_24.md` | Prior session handoff |

## Memory files (read at session start)

Always pull these:
- `MEMORY.md` (top of `~/.claude/projects/-Users-danielleogonowski/memory/`)
- `project_post_launch_punchlist_2026_05_24.md`
- `project_scouting_report_framework.md`
- `feedback_chase_contact_risk.md`
- `feedback_pitcher_framework.md`
- `feedback_vaa_analysis.md`

## What NOT to do

- Don't auto-merge PRs (Trevor handles GH UI merges himself for staging→main)
- Don't push to main without staging first
- Don't run TS scripts for prod SQL writes (Trevor pastes raw SQL)
- Don't use clickable markdown links for credentials/paths
- Don't extrapolate when "stuff data not consistent" — say so explicitly
- Don't soften flags ("might be a concern") — state directly per framework voice rules
- Don't include framework jargon in reports
- Don't generate scouting reports for JUCO players (data too limited)
- Don't deploy Edge Function silently — always confirm with Trevor before `npx supabase functions deploy`
- Don't change Supabase Equation Weights table without surface-level Q-and-A first (those values may be intentionally diverged from code defaults)

## Pending PRs

- None open on `feature/scouting-report-scrape` — committing as we go but no PR yet (Trevor wants to merge to staging/main after a coherent chunk is done)

## What to do at the start of next session

1. Read this file
2. Read `docs/SCOUTING_REPORT_FRAMEWORK_2026_05_26.md`
3. Read `project_scouting_report_framework.md` + companion memories
4. `git checkout feature/scouting-report-scrape && git pull`
5. Confirm with Trevor: continue pitch-shape Q&A (Slider next), or jump to generator refactor / archetype fixes / AI scaffolding

## How Trevor and I communicate

- He sends short messages, expects short responses
- One question at a time is the cadence
- Empirical distributions before proposing thresholds
- "go" / "yes" / "looks good" = green light to proceed
- "pause" / "save" = stop, capture state
- Compact-ready: he wants to be able to compact context and have the next session pick up via this doc
