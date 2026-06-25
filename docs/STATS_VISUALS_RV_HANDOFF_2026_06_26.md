# Stats Page Visuals + Run Value — Handoff

**Last session:** 2026-06-26
**Branch:** the active feature branch (pitch log work, location/outcomes display, RV math)
**Status:** **Staging is current.** **Prod has the older RV columns but NOT the new `walks_caused / strikeouts_caused / looking_strikeouts / swinging_strikeouts` columns populated** — needs a re-aggregation pass. Hitter-side RV is NOT built yet.

---

## What the Stats page looks like now (pitcher side)

### Top of page

- Dimension picker (existing) — `DimensionPicker` in `src/savant/components/PitchLogSection.tsx`
- Sample count line ("1,524 pitches · *includes postseason")
- Top stats row (PitcherStatsLine — ERA / FIP / K/9 / etc.)

### Stats / Visuals tab strip (NEW this session)

Added to `PageShell` in `PitchLogSection.tsx`:

- Two tabs: **Stats** (default) and **Visuals**
- Right side of the tab strip has `tabExtra` slot — when Visuals tab is active, the page-wide **Pitch Type picker** (`PitchTypePicker`, same styling as DimensionPicker) renders here
- Filter state lives at `PitcherPitchLog` level, plumbed down through `PitcherLocationSection` (the Visuals content)

### Stats tab content (existing — minor changes)

Two columns:

- Left:
  - `Panel: Quality of Stuff` — RateTable with disciplne metrics
  - `Panel: Batted Ball Metrics` — RateTable
  - `Panel: Per-Pitch Breakdown` — `PitcherPitchTypeTable` (existing)
    - **NEW**: applies the same `filterPitchType` + `minUsagePct = 0.03` filter as the Visuals tab table. Hides rows under 3% usage by default, shows only the filtered row when a pitch type is picked.
- Right:
  - `Panel: Quality of Stuff` — BarGroup (percentile bars)
  - `Panel: Batted Ball Metrics` — BarGroup

### Visuals tab content (NEW this session)

Lives in `PitcherLocationSection`. Four sections wrapped in `VisualsSection` headers (Oswald uppercase + gold accent bar):

#### 1. Pitch Location (3-across at xl, 2-across at md)
- **`StrikeZonePlot`** (existing custom KDE) — Strike Zone Density. Pitches filtered to `filteredPitches` (page-wide pitch type filter applied).
- **`PitchZoneUsage`** — same 13-zone shape as `PitchZoneXwoba`, colored by usage frequency using the **same red/blue percentile-based `strikeZoneCellColor` from xwOBA** (not generic density colors). Tooltip shows ZONE label + Usage% + Pitches + **full per-pitch-type breakdown** of that zone sorted by frequency. **Dark-navy backdrop tooltip with gold border** (matches Movement Profile cursor).
- **`PitchUsagePie`** (NEW) — solid pie chart, 1.5° padding between slices, slice colors from shared `PITCH_TYPE_COLOR`. Inline % label on slices ≥10%. Hover: slice scales 1.03 + color-tinted drop-shadow + 6% brightness; non-hovered slices dim to 55% opacity. Tooltip shows **Usage% + Stuff+** (Stuff+ goes gold when ≥105). Center is intentionally empty per coach feedback.

#### 2. Pitch Quality
Top row (2-across):
- **`PitchMovementPlot`** (existing) — Movement Profile, IVB×HB scatter. Filtered.
- **`PitchZoneXwoba`** (existing) — 13-zone xwOBA. Tooltip updated this session to **dark-navy backdrop with gold border** to match Movement Profile.

Full-width row below:
- **`PerPitchSuccessTable`** (NEW) — dark navy card matching the `PitcherPitchTypeTable` aesthetic in the Stats tab.
  - **Columns**: Pitch / RV/100 / RV / # / Usage% / Velo / Stuff+ / Whiff% / Chase% / EV / Hard Hit / Barrel / xwOBA
  - **RV column** is the only one with percentile coloring (per-pitch-type vs NCAA peers with ≥100 of that pitch type)
  - **RV uses `percentileColor` (alpha-fill on dark navy)** — same as `PercentileBar`. Lighter near 50, more saturated at extremes. We tried a circle marker badge (like the bar's end-cap) but reverted at coach feedback.
  - **Min-usage filter** same as the Stats tab: hides <3% usage by default, shows only the filtered row when a pitch type is picked.
  - **Stuff+** highlighted gold when ≥105 (same convention as `PitcherPitchTypeTable`)
  - **xwOBA** highlighted gold when ≤.300

#### 3. Batted Ball (DEFERRED — currently placeholders)
- 2 placeholders: "Spray Field — Zones" and "Spray Field — Dots" with the hint "Field rendering deferred — Python pipeline + component scaffolded, geometry needs work"
- See **Spray Field status** section below.

#### 4. Trends (DEFERRED — placeholder)
- One placeholder: "Rolling xwOBA — 15-game / 50-PA rolling window · coming next"

---

## Run Value (RV) implementation — the canonical reference

We went around several times on this. Locking it down:

### Convention

- **Pitcher side**: `positive RV = pitcher saved runs` (good). Matches MLB Savant pitch arsenal display.
- **Hitter side** (not yet built): `positive RV = hitter created runs` (good). Same magnitude as pitcher RV but **opposite sign** for the same event.

### Linear weights used

| Event | Pitcher RV per event | Hitter RV per event (when built) |
|---|---:|---:|
| Strikeout (terminal) | **+0.243** | −0.243 |
| BIP out | **+0.243** | −0.243 |
| Called Strike (non-K3) | +0.066 | −0.066 |
| Whiff (non-K3) | +0.118 | −0.118 |
| Foul | +0.038 | −0.038 |
| Non-walk ball | −0.062 | +0.062 |
| Walk (terminal) | **−0.319** | **+0.319** |
| HBP (terminal) | **−0.732** | **+0.732** |
| Single | −0.475 | +0.475 |
| Double | −0.766 | +0.766 |
| Triple | −1.034 | +1.034 |
| Home Run | **−1.405** | **+1.405** |

### Where the numbers come from

- **Terminal-event weights** (walk/HBP/K/1B/2B/3B/HR) — FanGraphs annual wOBA constants (averaged across the 2019–2023 era). Same scale as standard wRAA.
- **Non-terminal pitch weights** (ball/CS/foul/whiff) — Tom Tango's count-averaged delta run expectancy from "The Book" + subsequent updates at tangotiger.com.
- These are **MLB-derived**. For NCAA they're approximate but the relative ordering across pitchers is correct.

### How the math is implemented

`rvOffenseSum(r)` in `src/savant/lib/pitchLogRates.ts` computes the **OFFENSE-perspective sum** then `computeRv100` and `computeRvTotal` negate it for the pitcher.

For non-terminal events (CS/whiff/ball), we **subtract the terminal subset** (walks_caused / looking_strikeouts / swinging_strikeouts) so we don't double-count:
- `nonTerminalBalls = balls - walks_caused`
- `nonTerminalCS = called_strikes - looking_strikeouts`
- `nonTerminalWhiffs = whiffs - swinging_strikeouts`
- Then apply per-pitch weights to non-terminal counts AND terminal weights to terminal counts.

Walks pull pitcher RV DOWN (−0.319 per walk). Ks pull pitcher RV UP (+0.243 per K). Higher pitcher RV = better.

### Display in `PerPitchSuccessTable`

- **RV/100 column** — pitcher perspective, positive=good, plain white text, no background color
- **RV column** — pitcher perspective whole number with explicit sign, percentile-colored background via `percentileColor` (alpha-scaled red/blue), gold text when no population data and rvTotal ≥ +5
- Title tooltip on RV shows the percentile rank vs NCAA peers of the same pitch type

### Percentile coloring

- Population: `usePitchLogByPitchTypePopulation` hook (added this session, paginated like the pitcher totals hook)
- Filter: `populationMinPitches = 100` of that pitch type
- Rank uses internal `rv100` (pitcher perspective) with no `invert` flag — higher = better = high percentile = red

---

## Schema changes (already applied to staging AND prod)

### Migration files (in `supabase/migrations/`)

1. **`20260624120000_pitch_log_location_spray.sql`** — added `spray_ang`, `distance`, `pz_norm`, `px_norm`, `x_avg`, `x_slg`, `x_woba` columns to `pitch_log` table. Applied earlier in the session for the Location + Outcomes display work.

2. **`20260625000000_pitch_log_pitcher_by_pitch_type_rv.sql`** — added `balls`, `fouls`, `hbps_caused`, `walks_caused`, `strikeouts_caused` columns to `pitch_log_pitcher_by_pitch_type`. Applied to staging + prod.

3. **`20260626000000_pitch_log_pitcher_by_pitch_type_k_split.sql`** — added `looking_strikeouts`, `swinging_strikeouts` columns to `pitch_log_pitcher_by_pitch_type`. Applied to staging + prod.

### SQL aggregator (`scripts/aggregate_pitch_log_dimensions.ts`)

Updated `pitcherByPitchTypeSQL` to populate the new columns:
```sql
COUNT(*) FILTER (WHERE pitch_result = 'Ball') AS balls,
COUNT(*) FILTER (WHERE pitch_result = 'Foul') AS fouls,
COUNT(*) FILTER (WHERE pitch_result_category = 'HBP') AS hbps_caused,
COUNT(*) FILTER (WHERE pitch_result_category = 'Walk') AS walks_caused,
COUNT(*) FILTER (WHERE pitch_result_category = 'Strikeout') AS strikeouts_caused,
COUNT(*) FILTER (WHERE pitch_result = 'Strikeout (Looking)') AS looking_strikeouts,
COUNT(*) FILTER (WHERE pitch_result = 'Strikeout (Swinging)') AS swinging_strikeouts,
```

All 7 fields included in `ON CONFLICT … DO UPDATE SET` clause too.

---

## Where each DB stands (CRITICAL — read before doing anything else)

### Staging
- ✅ Migrations applied (all 3)
- ✅ Re-aggregated with the full SQL after the K-split migration. All 32 dimensions (with `vs_top_hitters` SKIPPED per the gateway-timeout pattern; emit SQL via `--emit-sql=/tmp/agg_sql/` and paste into Supabase SQL editor with `SET statement_timeout = '600s';`)
- Verified Volantis + Turnquist have populated `walks_caused / strikeouts_caused / looking_strikeouts / swinging_strikeouts`

### Prod
- ✅ Migrations applied (all 3 — additive columns, default 0)
- ❌ **NOT YET re-aggregated with the new SQL.** Current prod has the columns added but they're all 0. Until prod re-aggregates, the RV math on prod is wrong.
- Same workflow as staging:
  1. `npm run aggregate-pitch-log-dimensions:prod -- --apply --skip=vs_top_hitters`
  2. Emit `vs_top_hitters` SQLs via `--env-file-if-exists=.env.production.local … --emit-sql=/tmp/agg_sql_prod/`
  3. Paste into Supabase SQL editor on the prod project (`trbvxuoliwrfowibatkm`) with `SET statement_timeout = '600s';` prefix
  4. ~11 min for the script + a few min per SQL paste

---

## NOT YET BUILT — hitter-side RV

The pitcher path is fully wired. Hitter side mirrors it but needs:

### 1. Schema migration for `pitch_log_hitter_by_pitch_type`
Same 7 columns as the pitcher side. Migration name suggestion: `20260627000000_pitch_log_hitter_by_pitch_type_rv.sql`

### 2. SQL aggregator update
The hitter `hitterByPitchTypeSQL` builder in `scripts/aggregate_pitch_log_dimensions.ts` needs the same `COUNT(*) FILTER (...)` columns added. Note the hitter dimension filter uses `pitcher_filter` vs `hitter_filter` — make sure the right one's used.

### 3. Hook type update
`src/savant/hooks/usePitchLogHitterByPitchType.ts` (or wherever the hitter row interface lives) needs the same fields added to the type.

### 4. Derive function
`deriveHitterPitchTypeBreakdowns` in `src/savant/lib/pitchLogRates.ts` — currently returns AVG/OBP/SLG/OPS/ISO + discipline + contact. Add:
- `rv100` (hitter perspective — DON'T negate the offense sum)
- `rvTotal`
- Same `rvOffenseSum` helper can be reused for the math; just **don't apply the negation** for hitters

### 5. Hitter table component
Create `HitterPerPitchSuccessTable.tsx` mirroring `PerPitchSuccessTable.tsx`. Different columns:
- Pitch / RV/100 / RV / # / Usage% / AVG / OBP / SLG / OPS / ISO / Whiff% / Chase% / EV / Hard Hit / Barrel / xwOBA

Sign convention: hitter RV positive=good means **strikeouts are negative** (−0.243 per K) and **walks are positive** (+0.319 per walk). Opposite of the pitcher side.

### 6. Population hook for hitter
`usePitchLogHitterByPitchTypePopulation` — same pattern as the pitcher one. Used for percentile coloring of hitter RV.

### 7. Where it goes in the UI
Hitter Stats page currently has `HitterPitchTypeTable` (existing component in `PitchLogSection.tsx`). Either:
- Augment the existing table with RV columns + percentile, OR
- Build a separate hitter Visuals tab mirror

This is a design decision worth confirming before building.

---

## Spray Field — current status (DEFERRED)

We tried hand-rolled SVG (looked bad), then set up the Python pipeline as Trevor's plan called for:

- `scripts/python/generate_field_svg.py` — uses `baseball-field-viz` to generate a field SVG
- Static assets: `/public/baseball-field.svg` + `/public/baseball-field-meta.json` (coordinate metadata)
- React component: `src/savant/components/SprayField.tsx` (scaffolded; currently imported as PLACEHOLDER only — not rendered)

Trevor's feedback: the generated field still didn't look right. Component code is in the repo but the Batted Ball section renders placeholders pointing back to "Python pipeline + component scaffolded, geometry needs work".

Path forward when revisiting:
1. Tune the `baseball-field-viz` invocation in `generate_field_svg.py` (different `foul_distance`/`outfield_distance`, maybe a different rendering style)
2. OR get a quality public-domain SVG and drop it into `/public/`
3. The React overlay code in `SprayField.tsx` works — it loads the SVG as a background `<img>` and overlays data points using the metadata's coordinate transform

Don't hand-roll the SVG geometry again. Use a real source.

---

## Design system reference

- `DESIGN.md` at repo root — written this session, has the locked tokens from the Stitch "Roster Intelligence System" design:
  - Layer 1 (shell) vs Layer 2 (drawing) boundary
  - Dark Chrome + White Canvas pattern (dark navy app, white visualization cards)
  - Tokens: navy `#0A1428`, card navy `#0D1B3E`, gold `#D4AF37`, off-white `#F2F0EA`, etc.
  - Typography: Oswald headers, JetBrains Mono numbers, Archivo Narrow labels
  - Sharp 90-degree corners (no rounded)
  - Tonal layers + 1px borders (no shadows)

`design-system/rstr-iq/MASTER.md` exists from UI/UX Pro Max plugin output.

The Stitch design system "Roster Intelligence System" (project `17717741894289957208`) is the canonical visual reference for Visualization Canvas modules.

---

## Tooltip pattern (dark navy + gold)

Consistent across Movement Profile, 13-Zone xwOBA, 13-Zone Usage, Pitch Usage Pie:
- Background: `#040810` solid (not alpha — coach feedback was "increase opacity")
- Border: 1px gold `#D4AF37`
- Header: Oswald 10px uppercase, gold color, border-b separator with `rgba(255,255,255,0.08)`
- Stat blocks: `StatBlock` component — Archivo Narrow 8px uppercase label / JetBrains Mono 12px value
- Use `flex-col` grid for label/value pairs, 2-column grid for primary stats

---

## Quirks / known issues

- **Browser cache after RV changes**: React Query holds the previous breakdowns and the imported `derivePitchTypeBreakdowns` is closed over at hook resolution. After SQL aggregation re-runs, users need a hard refresh (⌘⇧R). Vite HMR also sometimes holds stale modules — restart the dev server if values don't update.
- **vs_top_hitters dimension**: the `IN (...)` subquery against Hitter Master exceeds the 125s gateway timeout. Workaround: `--emit-sql=<dir>` flag on the aggregator + paste files in Supabase SQL editor with `SET statement_timeout = '600s';` prefix.
- **Tracking errors still present**: pitchers like Caden Wade (Alcorn State) have 64 mph fastball values which clearly aren't real. Not fixed yet — should be filtered via `is_data = false` in the derive flags step.
- **Splitter / Sweeper RV percentiles unreliable**: very few qualified pitchers (N=24 for Splitter), so percentiles at p95/p99 are unstable. Sample size guardrails not yet enforced visually.

---

## Next actions

In priority order:
1. **Re-aggregate prod** with the new SQL (so RV math is correct on prod too)
2. **Hitter RV implementation** (full plan above)
3. **Spray Field — try again** with a different field source
4. **Trends section** — Rolling xwOBA line chart (simplest of the remaining placeholders)
5. **Tracking error filter** — add `is_data = false` rule for impossible values (vel < 65, rel_height < 3, extension < 3, spin < 500, etc.)

Anything else gets added as comments here.
