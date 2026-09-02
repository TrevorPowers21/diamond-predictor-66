# Original scaffold — feature specs

> **Provenance.** These lived in `CLAUDE.md` from the first build and were loaded every session for
> months. Moved out 2026-09-02: they are **build instructions, not rules**, and several describe work
> that shipped long ago or never started. Kept rather than deleted because the unbuilt ones are still
> genuine intent.
>
> ⚠ **Status below is my read of the code as of 2026-09-02, not a claim Trevor confirmed.** Verify
> before treating any line as settled — that is the point of §4 in `docs/PHILOSOPHY.md`.

| spec | status |
|---|---|
| Overview page | shipped, and evolved well past this spec |
| Rankings page | shipped |
| Scouting grade sorting | shipped |
| Transfer portal tracker | shipped |
| Team Builder WAR benchmarks | shipped 2026-05-12 |
| **AI prompt query interface** | **not built** — and now overlaps workstream A (coach agent) |
| **Internal equation builder** | **partly superseded** — `model_config` + the admin UI cover the equation-editing need; the coach-facing custom-metric builder does not exist |

---

## Overview page (`OverviewContent.tsx`) — shipped

**Morning briefing strip.** Full width, `#0D1B3E` bg, 3px left border `#D4AF37`. Label
`TODAY'S BRIEFING` in small spaced gold caps. Inline dot-separated items: portal activity, NIL updates,
filter matches, leaderboard refreshes.

**Two-column grid (1.2fr / 0.8fr).** Left: Top Target hero card — name, school, position, year, bats,
stat boxes (pAVG / pOPS / pISO / oWAR), NIL value, national rank. Right: Target Board — 5 player rows
with avatar, name, school/position, NIL value, status badge.

**Full-width activity feed.** Gold dot + text + timestamp per item, thin dividers, no buttons.

## Rankings page (`RankingsPage.tsx`) — shipped

Route `/rankings`. National leaderboards by stat: pAVG, pOBP, pSLG, pOPS, pISO, pWRC+, oWAR, NIL value.
Tabs/dropdown to switch. Each row: national rank, name, school, position, class, value. Filters by
position, conference, class year. Rank prominent in gold. Sortable columns.

## Scouting grade sorting — shipped

20–80 scale. Sortable on Rankings, Transfer Portal, and Player Dashboard. Grade badge next to the name.
Filter by minimum threshold.

## Transfer portal tracker — shipped

Portal entry (date, source school, conference, position, class) and commitment (date, destination
school + conference). Status: NOT IN PORTAL / IN PORTAL / COMMITTED. Timeline view, filters by
conference/position/date/status, alerts into the briefing strip and activity feed. The simulator
auto-detects portal players and pre-fills "from" school data.

⚠ Related open item: **stale IN PORTAL rows after the window closes** — see
`project_portal_fall_cleanup` (Sept 2026).

## Team Builder — Program Analytics + WAR benchmarks — shipped 2026-05-12

**Year-over-Year card.** Current 2026 build vs the customer team's 2025 actual WAR. Four cells: Total
WAR, Lineup oWAR (top 9 hitters), Rotation pWAR, Bullpen pWAR. Delta per cell — green ahead, red
behind, gray within ±0.1. Auto-populates from `team_war_snapshots` keyed by `(source_team_id, season)`.

**Championship Benchmark card.** Dropdown of any 2025 champion (National + Conference, split champs
included), same four cells. Grouped National first, then conferences alphabetically.

**Data layer.** Table `team_war_snapshots`, one row per team per season. Seed:
`supabase/queries/seed_team_war_snapshots_2025.sql`, running the canonical aggregation in
`supabase/queries/team_war_2025_aggregation.sql`. Idempotent — re-run after each season.
Hooks: `useTeamWarSnapshot(sourceTeamId, season)`, `useWarBenchmarks(season)`.

**2025 champions captured 2026-05-12:** National — Louisiana State. 39 conference champion rows across
29 conferences (10 had split regular-season champs).

⇒ **Workstream B (team comparison + 2027 roster upload) should extend these cards, not invent a new
shape.** See the handoff.

---

## NOT BUILT — AI prompt query interface

A natural-language query bar (`PromptSearch.tsx`) on the Transfer Portal page. A coach types e.g.
*"We don't mind players who chase — prioritize high avg exit velocity and barrel%"* or *"left-handed
pitchers with K/9 above 9 and BB/9 below 3 from power conferences."*

On submit, parse into weighted filter/sort criteria. **Weight the results — soft rank, do not hard
filter.** Show a ranked list with a match/fit score per player and a brief plain-English reason each
top result matched. Keep recent prompts in local state.

⚠ **This now overlaps workstream A (the coach-facing agent).** Decide whether it *is* that surface
before building it separately — two natural-language entry points with different ranking logic is
exactly the drift the doctrine warns about. And it must **read stored snapshots**, never compute a
score at query time.

## PARTLY SUPERSEDED — internal equation builder

An `EquationBuilder.tsx` letting coaches define composite metrics from existing stat fields, e.g.
`Custom Power Score = (ISO × 0.4) + (Barrel% × 0.35) + (Exit Velo × 0.25)`. Drag-and-drop or dropdown
stat selector, weight sliders, formula preview. Save named equations, apply as a sort column on
Rankings and Transfer Portal, show the value per player when active.

⚠ **The internal need is met** by `model_config` + the admin UI (that is where the 2026 calibration
lives). What does **not** exist is the *coach-facing* version. Before building it, settle two things:

1. **Per-program overrides** already have a design — `project_per_program_equation_overrides`. A custom
   metric builder is the same problem; don't create a second mechanism.
2. **A coach-defined metric is a derived value.** Under the doctrine it must be computed on read from
   stored inputs, or it becomes another stored copy nobody recomputes.
