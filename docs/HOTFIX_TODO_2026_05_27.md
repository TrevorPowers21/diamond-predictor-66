# Hotfix TODO — 2026-05-27

Branch: `hotfix/value-input-analytics-export`
Off: `staging`
Captured: 2026-05-26 evening, work tomorrow.

---

## 1. Actual Value input — allow 0 + override projected value for session

**Current behavior:** Coach types a number into the "Actual Value" fill-in-the-blank on (Team Builder? roster row?). 0 is not accepted; typed value doesn't override the projected market_value used downstream.

**Desired behavior:**
- Accept `0` as a valid input
- When a value is typed (including 0), use it as the player's market_value for the session — overrides the engine-projected number
- Downstream budget math (remaining NIL for top of roster) recalculates against the override

**Use case (Trevor's words):** "Think of it as a coaching staff wanting to pay $0 to a certain bench player, how much does that then leave available to give the top of the roster."

**Likely files:**
- Team Builder roster row component (PlayerTableRow or similar)
- Wherever NIL budget aggregation happens (probably `useTeamBuilderSimulation` or NIL summary card)

---

## 2. Program Analytics — add National Seeds display

**Ask:** Many coaches reach for national seed info when looking at Program Analytics. Add it to the page so it's visible at a glance.

**Open questions:**
- Where does seed data come from? Hard-coded list, scraped, or manual entry?
- What season(s) — current year only, or historical?
- Display location: top stat tile? In the championship benchmark card? New section?

**Likely files:**
- `src/pages/team-builder/tabs/AnalyticsTab.tsx` (Program Analytics tab)
- `team_war_snapshots` table may need a `national_seed` column

---

## 3. Reese Moore bug — fallback works in cross-view, broken on individual user view

**Symptom:** The fallback that combines data sources for projections works great on the cross-team view but breaks on the individual user (per-team) view. Reese Moore is the canonical case.

**Hypothesis:** The cross-team view (`variant=regular`, `customer_team_id=NULL`) and per-team view (`variant=precomputed`, `customer_team_id=<uuid>`) read from different code paths. The cross-team path handles missing-data fallback properly; the per-team path doesn't apply the same fallback logic.

**Investigation steps (when picking up):**
1. Find Reese Moore on prod: `SELECT id, first_name, last_name, position, team, division FROM players WHERE first_name='Reese' AND last_name='Moore';`
2. Pull his prediction rows: regular + precomputed for any customer team. Compare the projected stats.
3. Trace which code path each variant goes through. Likely culprit: missing fallback in `precompute-transfer-projections.ts` (hitter) or `precompute-pitchers.ts` (pitcher) when source-side scouting/PR data is null.

---

## 4. Player Profile PDF export — remove "assumes player is with ____ team" language

**Current:** PDF export includes language assuming the player is with a specific team.

**Desired:** Strip that assumption phrase. The engine actually runs to mimic the transfer portal simulator — projections aren't team-locked, they're scenario-based.

**Likely files:**
- `src/pages/PlayerProfile.tsx` or `src/pages/PitcherProfile.tsx` PDF export handler
- The PDF template / HTML the export script renders

Search hint: grep for `"assumes" OR "is with"` in PlayerProfile/PitcherProfile + any export utilities.

---

## Order of operations tomorrow

1. Start with **#1 (input zero + override)** — small, contained, big UX win
2. Then **#4 (PDF language)** — purely cosmetic, fast to ship
3. **#3 (Reese Moore fallback)** — needs investigation before code change
4. **#2 (National Seeds)** — most architectural, save for last

All four can ship as a single PR off this branch, or split into 2 PRs (1+4 cosmetic/quick, 2+3 deeper).
