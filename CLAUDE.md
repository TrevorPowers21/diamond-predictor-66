# RSTR IQ — Development Source of Truth

## Design Rules (Global)

- No loading spinners, sliding cursors, skeleton loaders, or animated placeholder effects anywhere
- Dark background: `#080F1F`, sidebar/card background: `#0D1B3E`
- Gold accent: `#D4AF37`, darker gold: `#A08820`
- Font: Oswald for headings/labels, system sans-serif for body
- All cards: 0.5px gold border, border-radius 8px
- No unnecessary buttons, subtitles, or decorative UI that isn't actively functional
- Status badges: IN PORTAL = green, WATCHING = gold
- Avatar circles: gold initials on dark gold background

---

## Overview Page (OverviewContent.tsx)

Build the following sections in order:

### Morning Briefing Strip
- Full width, `#0D1B3E` bg, 3px left border `#D4AF37`
- Label: `TODAY'S BRIEFING` in tiny spaced gold caps
- Inline dot-separated items: portal activity, NIL updates, filter matches, leaderboard refreshes

### Two Column Grid (1.2fr / 0.8fr)
- **Left:** Top Target hero card — player name, school, position, year, bats, stat boxes (pAVG/pOPS/pISO/oWAR), NIL value, national rank
- **Right:** Target Board — 5 player rows with avatar, name, school/position, NIL value, status badge

### Full Width Activity Feed Card
- Gold dot + feed text + timestamp per item
- Thin dividers, no buttons

---

## Rankings Page (RankingsPage.tsx)

Build a dedicated rankings page at route `/rankings`:

- Full national leaderboards by stat category: pAVG, pOBP, pSLG, pOPS, pISO, pWRC+, oWAR, NIL value
- Tab or dropdown to switch between stat categories
- Each row shows: national rank number, player name, school, position, class, stat value
- Filter controls: position, conference, class year
- National rank number displayed prominently next to each player row in gold
- Sortable columns
- No skeleton loaders or animated placeholders

---

## Scouting Grade Sorting

Add scouting grade as a sortable/filterable field across all player-facing pages:

- Grades on a 20-80 scale (standard baseball scouting scale)
- Sortable on Rankings page, Transfer Portal page, and Player Dashboard
- Display grade badge next to player name where relevant
- Allow filtering by minimum scouting grade threshold

---

## AI Prompt Query Interface (Natural Language Roster Search)

Build a natural language query bar component (`PromptSearch.tsx`) for the Transfer Portal page:

- Text input where coaches type a natural language request, for example:
  - "We don't mind players who chase -- prioritize high avg exit velocity and barrel%"
  - "Show me left-handed pitchers with K/9 above 9 and BB/9 below 3 from power conferences"
- On submit, parse the prompt and translate it into weighted filter/sort criteria against the player database
- Weight the results by matching the described profile — do not hard filter, soft rank instead
- Display results as a ranked list with a match score or fit rating shown per player
- Include a brief plain-English explanation of why each top result matches the prompt
- Store recent prompts in local state for quick re-use

---

## Internal Equation Builder

Build an Equation Builder tool (`EquationBuilder.tsx`) accessible from the sidebar or settings:

- Coaches can define custom composite metrics using existing stat fields
- Example: `Custom Power Score = (ISO x 0.4) + (Barrel% x 0.35) + (Exit Velo x 0.25)`
- UI: drag-and-drop or dropdown stat selector, weight sliders per stat, formula preview
- Save named equations to local state (persist to Supabase user profile later)
- Apply saved equations as a sort column on Rankings and Transfer Portal pages
- Show the custom metric value per player when equation is active

---

## Transfer Portal Tracker

Track when players enter the transfer portal and commit to new schools:

- **Portal entry tracking:** date entered portal, source school, conference, position, class year
- **Commitment tracking:** date committed, destination school, destination conference
- **Status field on players:** NOT IN PORTAL / IN PORTAL / COMMITTED
- **Timeline view:** show portal activity feed — who entered, who committed, when
- **Filters:** by conference, position, date range, status
- **Alerts/notifications:** surface new portal entries and commitments in the Morning Briefing strip and Activity Feed
- **Integration:** Transfer Portal simulator should auto-detect portal players and pre-fill "from" school data
- **Data source:** manual entry via admin or future API integration with portal tracking services

---

## Technical Notes

- Primary data source: Supabase (Hitter Master, Pitching Master, Conference Stats, Teams Table, Park Factors)
- Player linking across seasons: `source_player_id`
- Teams Table uses `abbreviation` as primary display name
- Players table `team_id` FK points to "Teams Table"
- All equations live in `readPitchingWeights()` and `computeHitterPowerRatings()` in powerRatings.ts
- SchoolBanner component accepts `schoolLogoUrl` and `schoolName` props for per-team branding
- Design system reference: `design-system/rstr-iq/MASTER.md`
