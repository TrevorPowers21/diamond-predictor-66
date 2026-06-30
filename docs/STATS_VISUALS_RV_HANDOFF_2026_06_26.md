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

## Spray Field — current status

We tried hand-rolled SVG (looked bad), then set up the Python pipeline as Trevor's plan called for:

- `scripts/python/generate_field_svg.py` — uses `baseball-field-viz` to generate a field SVG
- Static assets: `/public/baseball-field.svg` + `/public/baseball-field-meta.json` (coordinate metadata)
- React component: `src/savant/components/SprayField.tsx` (scaffolded; currently imported as PLACEHOLDER only — not rendered)

Trevor's feedback: the generated field still didn't look right. The legacy
`SprayField.tsx` is still in the repo but the Batted Ball section renders
placeholders.

### NEW: `src/savant/components/BaseballField.tsx` (the working component)

Self-contained SVG field component Trevor wrote and dropped in 2026-06-26
night. **This is the one to use going forward.** Replaces all the
hand-rolled / Python-generated work. Pure SVG, no dependencies, ~440 lines.

**Public API**:
- `default export BaseballField` — the component
- `bucketBattedBalls(rows, opts?)` — transforms raw rows with either
  `{ sprayAngle, distance }` (our pitch_log data, preferred) or
  `{ hc_x, hc_y }` (Statcast-style) into `{ infield: number[5], outfield: number[5] }` counts
- `toPercent(counts, digits?)` — converts the counts to whole-number percents
- `arcDistance(angleDeg)` — exposed for callers that want their own bucketing

**Props** (all optional, all have defaults):
```ts
interface BaseballFieldProps {
  dimensions?: FieldDimensions;  // park-specific fence distances
  infield?: number[];             // 5 values (LF / LC / CF / RC / RF)
  outfield?: number[];            // 5 values
  colorInfield?: number[];        // optional: drive color off a metric different from the label
  colorOutfield?: number[];
  normalize?: "band" | "global";  // band = each row on its own scale (default)
  formatValue?: (v: number) => string | number;
  showFenceLabels?: boolean;      // default true
  showTotals?: boolean;           // default true
  theme?: Partial<FieldTheme>;    // override any of bg/grass/dirt/ink/wall/etc.
  stops?: Array<[number, [r, g, b]]>;  // heat ramp control
  onZoneSelect?: (z) => void;     // click handler — drill-downs
}
```

**Geometry**: 5 infield + 5 outfield zones (LF / LC / CF / RC / RF columns,
two rows — infield ≤95ft from home, outfield 95ft to fence). The fence is a
Catmull-Rom spline through 5 fence-distance values. Looks like a proper
asymmetric MLB-style park outline, NOT a wedge.

**Color**: heat ramp blue → teal → amber → red on `band`-normalized values
by default. Bands are independently normalized so infield and outfield each
get their own contrast range (Trevor's "decoupled" point).

**Color vs value**: separate `colorInfield` / `colorOutfield` arrays let you
drive color by xwOBA / hard-hit rate while labels show share percentages.
The "22% of balls and they're crushed here" view.

### Integration plan (for tomorrow)

1. **Theme override** to match RSTR IQ navy + gold (Trevor offered to send
   this; ask if not received). At minimum:
   ```ts
   theme={{ bg: "#0A1428", grass: "#152036", dirt: "#0D1B3E", wall: "#D4AF37" }}
   ```
2. **Hook for batted-ball data**: pull the active pitcher's BIP rows from
   `pitch_log` for the current `dimension`. They already have `spray_ang`
   and `distance` columns (added in the 2026-06-24 migration). Note: our
   field uses `sprayAngle` (camelCase) — map column → prop:
   `rows.map(r => ({ sprayAngle: r.spray_ang, distance: r.distance }))`
3. **Bucket**: `const counts = bucketBattedBalls(mapped); const { infield, outfield } = toPercent(counts);`
4. **Render** in the Batted Ball section, replacing the two placeholders:
   - **Spray Field — Zones**: standard BaseballField with usage %
   - **Spray Field — Dots OR EV-colored zones**: pass `colorInfield`/`colorOutfield`
     driven by per-zone average exit velo or xwOBA. Same field shape, different
     coloring narrative
5. **Calibration check**: `bucketBattedBalls` distance scaling assumes
   feet directly. Our `distance` column IS in feet so the transform is
   identity — but spot-check 3-5 balls against known outcomes (a 380ft
   double should land in the outfield row, a 180ft pop-up in the infield row).
6. **Wire to filters**: respect the page-wide pitch-type + zone-height + zone-side
   filters from `PitcherLocationSection`. So you can ask "fastball at the
   top of the zone → spray field" and see where high heat gets put in play.

The legacy `SprayField.tsx` can be deleted once `BaseballField` is wired.
Don't bother fixing it — it's superseded.

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

---

## Hitter Visuals tab — full plan (locked 2026-06-26)

Mirror the pitcher Visuals tab structure, but tilt content toward batted-ball
quality (where hitters create their value). What gets reused vs. replaced:

### Reuse vs new

| Component | Reuse / new | Notes |
|---|---|---|
| 13-Zone xwOBA | Reuse | Hitter perspective — same red=good direction |
| 13-Zone Whiff% | Reuse with sign inversion | Lower whiff = good for hitter; invert color |
| 13-Zone Usage | Reuse | "Where am I being attacked" |
| Pitch Usage Pie | Reuse | Pitch mix the hitter SEES (not throws) |
| `PerPitchSuccessTable` | NEW: `HitterPerPitchSuccessTable` | Different columns (see below) |
| Movement Profile | SKIP | Hitters don't throw |
| Strike Zone Density | REPLACE with **EV × LA Scatter** | Better for hitter quality view |

### Hitter-specific batted-ball visuals (2 of them)

**Visual A — 13-Zone EV Heatmap** (replaces the pitcher's Strike Zone Density
slot in the Pitch Location section)

Same 13-zone shape as xwOBA/Whiff%/Usage. Each cell colored by **average
exit velocity of batted balls put in play from pitches landing in that zone**.
Red = high avg EV, blue = low. Tells the coach "this hitter is most
dangerous (in terms of contact quality) on pitches that arrive here."
Pairs cleanly with the 13-Zone xwOBA (outcome) and 13-Zone Whiff% (process).

Same shape + tooltip pattern as the other zone charts. Min N filter (≥ 3
BIP from that zone) to drop noise.

**Visual B — EV × LA Heatmap** (replaces the pitcher's Movement Profile slot
in the Pitch Quality section)

This is what Trevor sketched out from the TruMedia polar reference chart but
done as a proper 2D density heatmap on cartesian axes (the polar version is
visually misleading — see note below).

Layout:
- **X axis**: Launch angle, −30° to +60°, with reference lines at:
  - −10° = grounder threshold
  - 10° = LA lower edge of "barrel band"
  - 25° = LA upper edge of typical "barrel band" peak
  - 50° = pop-up threshold
- **Y axis**: Exit velocity, 40 to 120 mph, with the **95 mph hard-hit line**
  highlighted
- **Cell color**: 2D density (count of batted balls in each LA × EV bin),
  red = hot, blue = cool. Like our Strike Zone Density on pitcher side but
  for the LA/EV plane.
- **Optional overlay**: dashed outline of the "barrel zone" (EV ≥ 95 AND
  10° ≤ LA < 35°) so the coach sees where the hitter's mass lands relative
  to barrel territory.
- **Tooltip**: average EV / avg LA in the bin + outcomes (HR / 2B / 1B / Out
  share)

Reveals archetypes immediately:
- Power on plane → density concentrated in 95+ EV / 15-25° LA (the barrel
  pocket)
- Contact-only → density spread across all LAs but cluster below the 95 mph
  line
- Grounder-heavy → strong density below 0° LA regardless of EV
- Pop-up prone → meaningful density above 40° LA

#### Why this is better than the polar scatter Trevor sent

The TruMedia "Exit Launch Scatter Chart" uses launch angle on the angular
axis (0-90°) and exit velocity on the radial axis. That has a real physical
analogy (the dot points in the direction the ball came off the bat) but
breaks down for analysis: a 40 mph pop-up sits at the same angular position
as an 80 mph line drive of the same launch angle, distinguished only by
radius — but the radius is EV (a speed), not anything you can physically
relate to. It's pretty but coaches end up squinting at it. The cartesian
heatmap removes the ambiguity and adds density, which is what you actually
want for "where does this hitter live."

### HitterPerPitchSuccessTable columns

Hitter analogue of the pitcher table. All percentile-colored where applicable;
RV is the colored marquee column.

| Column | Source | Sign convention | Direction |
|---|---|---|---|
| Pitch | breakdown.pitchType | label | — |
| **RV** | hitter perspective (don't negate the offense sum) | positive = good for hitter | percentile colored |
| **RV/100** | per-pitch efficiency | positive = good | (sibling) |
| # | breakdown.pitches | meta | — |
| Usage% | seen distribution | meta | — |
| Whiff% | whiff / swing | lower = good (invert) | percentile colored |
| Chase% | chase / out-of-zone | lower = good (invert) | percentile colored |
| **AVG / OBP / SLG / OPS / ISO** | actual slash from raw counts | higher = good | percentile colored |
| **xBA / xSLG / xwOBA** | expected stats from x_woba_sum, x_bases_sum, x_hits_sum | higher = good | percentile colored |
| Avg EV / Hard Hit / Barrel% | contact quality | higher = good | percentile colored |

### Data layer changes for hitters

Migration `2026XXXX_pitch_log_hitter_by_pitch_type_rv.sql` adding the same 7
event-count columns to `pitch_log_hitter_by_pitch_type`:

- balls, fouls, hbps_caused, walks_caused, strikeouts_caused
- looking_strikeouts, swinging_strikeouts

Update the `hitterByPitchTypeSQL` builder in the aggregator with the same
`COUNT(*) FILTER (WHERE pitch_result = …)` clauses + ON CONFLICT slots.

### Section layout

1. **Pitch Location** (seeing): Strike Zone Density + 13-Zone Usage + Pitch Usage Pie
2. **Pitch Quality** (response): 13-Zone Whiff% + 13-Zone xwOBA + **EV × LA Scatter** + HitterPerPitchSuccessTable
3. **Batted Ball** (where it goes): Spray Field zones + Spray Field dots
   (still blocked on Field render — Python pipeline produces a workable SVG
   eventually OR we adopt a quality public-domain field SVG)
4. **Trends**: Rolling xwOBA over time — same component as the pitcher side

### Open questions / leave for tomorrow

- Does an EV histogram or LA histogram add value alongside the scatter, or does the scatter cover it?
- For HitterPerPitchSuccessTable, do we want percentile coloring on the *raw* slash columns (AVG/OBP/SLG) too, or only on the x-stat columns and RV?
- Hitter-perspective sign convention: confirm with coach feedback that positive RV reads correctly for hitter side.

---

# RSTR IQ — Inferred Bat Speed & Squared-Up: Project Working Document

What this is: a single self-contained context document for the inferred-bat-speed and squared-up work, written so it can be dropped into a fresh Claude session to resume. It consolidates the method, the calibration, the validation, the current data, and the open roadmap. Two companion files hold the formal versions: the Metric Spec (full PostgreSQL implementation) and the Calibration Memo (defensibility record).

Do-not-use rule for any content generated from this doc: no em dashes; rates as whole numbers without percent signs.


## 1. Current state (TL;DR)


We infer a college hitter's bat speed from TruMedia exit-velocity + pitch-velocity tracking, with no bat tracking required. It runs off one season of the pitch log.
The number is calibrated and defensible: q_metal = 0.242, validated against five 2024 draftees' measured pro bat speed to 1.2 mph RMSE.
Each hitter gets four numbers: floor (repeatable bat speed, the headline), ceiling (raw/peak), runway (ceiling - floor, consistency/development room), and squared-up rate (how often he reaches near his own ceiling).
Validated three ways: against measured pro bat speed (the five anchors), against a college program's eye (Georgia confirmed floor-as-stable and ceiling-as-peak on two 2026 hitters), and internally (the squared-up reference frame independently reproduced the contact-vs-power archetype split, with the #1 overall pick at one pole and a big-power top-ten pick at the other, despite nothing being tuned to draft outcomes).
Open: a population pull to establish a real "average college" baseline, and a Savant cross-check to see if college squared-up ordering survives into the pros.



## 2. The problem

TruMedia gives exit velocity for college hitters but not bat speed (bat tracking is MLB-only, public since 2024). Exit velocity is mostly bat speed but on any one ball it also reflects pitch speed and how flush the contact was, so EV alone confounds swing speed with contact quality. Goal: recover bat speed from the EV profile, correct for the metal bat, and from there derive a squared-up-style contact metric.


## 3. Core method and equations

Collision identity (Nathan)

EV = (1 + q) * B + q * P

EV = exit velocity, B = bat speed, P = pitch speed, q = collision efficiency. MLB's squared-up rate is built on the same relationship (actual EV vs the max possible given bat and pitch speed). We invert it.

Per-ball bat speed

implied_bat_speed_i = (EV_i - 0.242 * P_i) / 1.242

q_metal = 0.242 for college BBCOR metal (calibration in section 4). Converting per ball (then taking a percentile) is what makes it competition-robust: a flush ball off 86 and a flush ball off 96 back out to the same bat speed.

The four outputs per hitter-season

Computed over qualified, outlier-cleaned batted balls:

| Output | Definition | Meaning |
|---|---|---|
| Floor (bat speed) | p95 of implied_bat_speed | repeatable swing speed; the headline metric; what q is calibrated to |
| Ceiling | p99 of implied_bat_speed | raw, best-flush capability |
| Runway | ceiling - floor | squared-up consistency / development room |
| Squared-up rate | see below | how often contact reaches near his own ceiling |

Floor is the number to publish and rank on (stable, calibrated, the truer "what he reliably does"). Ceiling is scouting context, unstable on thin samples, never trusted on Tier C. Runway is where the signal lives: same floor + different runway = opposite development stories.

Squared-up rate (ceiling-denominated, RSTR IQ analog)

```
potential_EV_i  = 1.242 * bat_speed_ceiling + 0.242 * P_i
squared_up_pct_i = EV_i / potential_EV_i
squared_up       = squared_up_pct_i >= T          (T = 0.90 provisional)
squared_up_rate  = share of competitive batted balls that clear T
```

Honest label: this is a ceiling-denominated season analog, NOT MLB's per-swing metric. MLB's denominator is bat speed measured on each swing; ours is the season ceiling. Ours answers "how often does he get to his own best," MLB's answers "did he get everything out of this swing." We cannot replicate the per-swing version without bat tracking. It is the full-distribution version of runway and runs inverse to it (small runway high rate). Like MLB's, it is self-relative, so a modest-power flush hitter can post a high rate (the Arraez archetype) and a big-power bat a low one (the Stanton/Caglianone archetype). A high rate is good for a contact profile; a low rate is fine for a power profile. It is a style axis, not a quality grade.

Pipeline order (matters)


Plausibility filters: EV 30-125, pitch 55-105.
Chop rule: drop EV >= 118 at launch angle < -10 (impossible "crushed into the ground" reads).
Tail outlier fence: per hitter, drop EV > p95(EV) + 8 (isolated misreads; validated to flag only the one bad ball and spare legitimate ceilings).
Convert each ball to implied bat speed (pitch-corrected).
Take p95 (floor), p99 (ceiling), runway, and squared-up rate.
Confidence tag by qualified BIP: A >=120, B 60-119, C 30-59, insufficient <30.


Coefficient and estimator are a matched pair. q_metal = 0.242 is tied to the p95 estimator. Change the estimator and q must be re-fit.


## 4. Calibration record

Anchors: five 2024 first-round college hitters with college metal data and a measured first-season pro (wood) Statcast bat speed.

q_wood from pro (max EV, bat speed) pairs ~ 0.231. q_metal, fit so the p95 estimator reproduces first-season pro bat speed across the four healthy-season anchors, = 0.242, RMSE 1.2 mph. Metal premium over wood ~ 0.011, under 2 mph at flush contact (modern BBCOR is only marginally hotter than wood, far below the pre-BBCOR 9-16 mph literature).

| Anchor | College p95 EV | Floor (q=0.242) | First pro wood BS | Residual |
|---|---|---|---|---|
| Caglianone | 117.2 | 76.7 | 77.4 | -0.7 |
| Smith | 113.3 | 73.7 | 74.5 | -0.8 |
| Benge | 107.4 | 70.8 | 71.3 | -0.5 |
| Bazzana | 110.2 | 71.6 | 69.5 | +2.1 |
| Kurtz | (2024 injured, suppressed) | ~73 (2024) / ~76 (2023) | ~76.5 | validation case |

Residuals straddle zero (not biased one direction), which is evidence q is reading physics, not absorbing a hidden development or bat-speed change.

Key identifying assumption: bat speed is constant across wood and metal for the same hitter at the same time (both drop-3, narrow weight band). This is what lets q_metal be solved rather than guessed. Confirmed to hold in the data.


## 5. Validation and lessons learned

External


Georgia coaching staff independently confirmed floor-as-stable and ceiling-as-peak as realistic for two 2026 hitters (Jackson, Phelps). First outside-the-pipeline, outside-the-pro-anchors label, and it landed on the down-ballot, non-elite tier that was least tested. (Record this with a date.)


Internal (the archetype finding)

The squared-up reference frame, with nothing tuned to draft outcomes, reproduced the contact-vs-power split: Bazzana (#1 overall, contact profile) topped the squared-up list at 51, Caglianone (#6, monster raw) anchored the bottom at 20. A metric built for bat speed independently recovering a scouting archetype it was never fit to is strong evidence it reads a real trait.

Lessons that became rules


Robust peak, never the single max. One season showed the single max swinging 2+ mph of implied bat speed on health and luck. Use p95.
Pool thin/compromised seasons. Kurtz's injured 2024 (122 BIP) under-read his ceiling ~2 mph; 2023 recovered it. His apparent "+4 mph development" was a sampling artifact.
Baseline rule. Compare college to a hitter's FIRST wood season, never a later one. Smith's apparent "+4" was vs his developed 2026 (77.1); vs his first pro season (74.5) the residual is +1.4, essentially flat. Development that happened in pro ball must not be misattributed to the bat or the model.
Suppressed ceiling inflates squared-up rate. A lower ceiling is an easier bar to clear, so an injured/thin season produces a flatteringly high squared-up rate. Kurtz 2024 demonstrates it live. Squared-up inherits the same BIP-confidence and pooling discipline.
Discipline is the reason the result is trustworthy. Every apparent signal that looked like development dissolved under a correct baseline or fuller sample. Keep throwing out artifacts.


Whiff vs squared-up

Squared-up rate is contact-quality conditional on contact; whiffs (null EV) are filtered out at step 1 and never enter it, same as MLB. A hitter can have a high squared-up rate and a contact concern simultaneously: he flushes what he hits, the question is reaching the pitches that beat him. The giveback against velocity goes into whiffs, not weak contact. Whiff and the fastball-vs-offspeed gap are separate columns answering separate questions.


## 6. Current data

2026 board (eight prospects), all four columns + velocity gap

| Player | Team | BIP | Floor | Ceiling | Runway | SU rate | Velo gap (OFF-FB) |
|---|---|---|---|---|---|---|---|
| Bogenpohl | MOSU | 157 | 75.2 | 77.5 | 2.4 | 27 | -0.8 |
| Burress | GT | 203 | 72.6 | 77.2 | 4.6 | 21 | +1.2 |
| Strosnider | TCU | 138 | 71.9 | 75.1 | 3.1 | 33 | -0.5 |
| Cholowsky | UCLA | 197 | 71.4 | 73.0 | 1.5 | 33 | 0.0 |
| Lackey | GT | 180 | 71.3 | 72.6 | 1.2 | 37 | +0.8 |
| Sorrell | TXAM | 163 | 71.3 | 74.6 | 3.2 | 29 | -0.8 |
| Jackson | UGA | 199 | 71.2 | 72.4 | 1.3 | 41 | +2.4 |
| Phelps | UGA | 198 | 68.2 | 70.8 | 2.6 | 35 | +3.0 |

Negative/zero velo gap = squares up velocity as well as or better than soft stuff (velo-proof); positive gap = velocity-vulnerable. Bogenpohl, Strosnider, Sorrell are velo-proof; Phelps and Jackson are velo-vulnerable.

13-hitter squared-up reference frame (sorted by SU rate), 2024 anchors tagged by outcome

| Player | Floor | Ceiling | Runway | SU rate | avg SU% |
|---|---|---|---|---|---|
| Bazzana (2024, #1 overall) | 71.6 | 73.1 | 1.5 | 51 | 86.0 |
| Jackson (2026) | 71.2 | 72.4 | 1.3 | 41 | 83.6 |
| Benge (2024, 1st rd) | 70.8 | 72.0 | 1.2 | 39 | 84.6 |
| Kurtz (2024, injured*) | 73.7 | 75.2 | 1.4 | 39* | 83.5 |
| Lackey (2026) | 71.3 | 72.6 | 1.2 | 37 | 83.8 |
| Phelps (2026) | 68.2 | 70.8 | 2.6 | 35 | 83.7 |
| Cholowsky (2026) | 71.4 | 73.0 | 1.5 | 33 | 82.9 |
| Strosnider (2026) | 71.9 | 75.1 | 3.1 | 33 | 80.6 |
| Smith (2024, MLB) | 73.7 | 75.9 | 2.2 | 32 | 81.4 |
| Sorrell (2026) | 71.3 | 74.6 | 3.2 | 29 | 82.1 |
| Bogenpohl (2026) | 75.2 | 77.5 | 2.4 | 27 | 79.5 |
| Burress (2026) | 72.6 | 77.2 | 4.6 | 21 | 80.3 |
| Caglianone (2024, #6, big power) | 76.7 | 80.2 | 3.5 | 20 | 78.2 |

(*Kurtz 2024 squared-up inflated by injury-suppressed ceiling; pool 2023 to correct.)

Read on Jackson: tight runway (1.3), top-of-prospects squared-up (41), profiles with the contact-oriented 2024 first-rounders (Bazzana, Benge). High squared-up is his carrying tool. His risk is whiff/velocity (the +2.4 velo gap), not contact quality. Matches the program's eye.


## 7. Open roadmap


Population pull (highest value). Run the metric across the full 2026 D1 hitter set so "good" has a real baseline instead of a 13-bat eyeball, and so we can test whether 2026's top end is genuinely down vs 2024 (current read: top end down ~2 mph, but the 2024 comparison set is power-selected, so this needs population-level confirmation). The population also finalizes the squared-up threshold T so the league average lands near MLB's ~33.
Savant cross-check. Pull the actual MLB squared-up rates for Caglianone, Smith, Bazzana and test whether the college ceiling-denominated ordering (Bazzana-high to Caglianone-low) survives into the pros. If it holds, the college metric predicts the real thing.
Down-ballot offset check. Calibration set was top-1% draftees. Use the no-label checks (pitch-type/speed invariance, year-over-year stickiness, population face validity) to confirm q = 0.242 travels to mid- and low-tier bats, or fit a small offset.
Identifiability close-out. q_metal is confounded with any bat-speed change common to all anchors. One contemporaneous metal-and-wood reading (a Blast/sensor number on any of these hitters in college, or any 2026 hitter) removes it. Highest-leverage single data point.
Threshold + version freeze. Once the population sets T, freeze it and stamp q_metal_version and a su_threshold_version on stored rows.
Companion metrics. Formalize the velocity gap (fastball vs offspeed) and whiff-vs-velocity as their own columns; they answer the "how does he handle velocity" question that squared-up deliberately does not.



## 8. Key cautions (carry these forward)


Floor is calibrated; ceiling is not (it's an extrapolation past the tuned region and unstable on thin samples). Lead with floor.
Squared-up rate is a style axis (contact vs power), not a quality grade. Both poles produce premium prospects.
13 good bats is a reference frame, not a baseline. The strongest external validation is still one program's verbal nod on two players. Strong on shape, unproven in the absolute middle of the distribution.
The result is trustworthy because of the skepticism that caught Kurtz's injury and Smith's baseline. Keep discarding artifacts.



## 9. Companion files


RSTR IQ Bat Speed Metric Spec - full PostgreSQL (per-ball, season, pooled, squared-up views), qualification, outlier fence, confidence tiers, output schema, 2026 validation protocol. The implementable piece.
RSTR IQ Bat Speed Calibration Memo - physics basis, anchor set, q derivation, validation, baseline rule, open items. The defensibility record.
