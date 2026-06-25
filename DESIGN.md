# RSTR IQ — Design Source of Truth

Portable design tokens and rules. Source: Stitch "Roster Intelligence System" design system (2026-06-24). Survives any single tool going down.

## Layer Boundary (Critical)

**Layer 1 — Shell**: Stitch, Figma MCP, Magic UI, shadcn. Designs dashboard chrome — layout, cards, navigation, the overview screen. Will NOT draw a strike zone or heat map.

**Layer 2 — Drawing**: D3 + d3-contour for in-app visualizations; pybaseball + baseball-field-viz for Python export path. Every baseball object (zone, heat map, field, spray) lives here.

Do not prompt Layer 1 tools to draw baseball objects.

## Aesthetic Concept

**Dark Chrome + White Canvas.** App shell is deeply immersive navy. Analytical "Visualization Canvas" modules pop with pure white backgrounds. Heatmaps, spray charts, and velocity graphs are the focal point.

Density over whitespace — coaches process hundreds of data points per session.

## Tokens

### Colors

| Role | Hex | Usage |
|---|---|---|
| Primary chrome | `#0A1428` | Page background, nav, sidebars |
| Card navy | `#0D1B3E` | Stat cards, headers, surface containers |
| Surface (Level 1) | `#152036` | Secondary widgets, side panels |
| **Visualization canvas** | `#FFFFFF` | Chart card backgrounds — where heatmaps live |
| Border (dark) | `#1F2D52` | Module boundaries on dark chrome |
| Border (light) | `#E5E5E5` | Boundaries on white canvas |
| Gold accent | `#D4AF37` | Highlights, active states, premium tier, status badges (WATCHING) |
| Gold (darker) | `#A08820` | Hover states, avatar backgrounds |
| Status green | `#1A6B35` | IN PORTAL badge |
| Off-white text | `#F2F0EA` | Text on dark backgrounds. **Never use pure `#FFFFFF` for text.** |
| Mid-gray | `#9A9890` | Secondary/supporting text, meta labels |

### Heatmap Palette

Diverging Red-to-Blue scale.

- Red end: high values (good for pitchers in xwOBA-against; high density in usage heatmaps)
- Blue end: low values
- Use percentile-based normalization, not raw ranges

For chart density (Strike Zone heat map): vivid colormap stops white → sky blue → cobalt → emerald → yellow → orange → red → crimson.

### Typography

| Role | Family | Use |
|---|---|---|
| Display / Headlines | **Oswald** | Player names, section headers ("PITCH LOCATION"), banner wordmarks, branded labels. Condensed, bold. |
| Data / Numbers | **JetBrains Mono** | All stats, axis labels, table cells, tooltip values. Tabular-nums alignment guaranteed. |
| Labels / UI | **Archivo Narrow** | Field labels, secondary nav, metadata, small caps. |
| Body (deprecated for new builds) | Inter | Legacy only. New work uses Archivo Narrow for body. |

Sizes:
- `display-lg`: 48px / Oswald 700 / line 56 / +0.02em
- `headline-md`: 24px / Oswald 600 / line 32 / +0.01em
- `headline-sm`: 18px / Oswald 500 / line 24
- `data-lg`: 20px / JetBrains Mono 600 / line 24 / -0.02em
- `data-md`: 14px / JetBrains Mono 500 / line 20
- `body-md`: 14px / Archivo Narrow 400 / line 20
- `label-caps`: 12px / Archivo Narrow 600 uppercase / line 16 / +0.05em
- `headline-md-mobile`: 20px / Oswald 600 / line 28

## Layout

### Grid

12-column grid for desktop analytics canvas. Cards span 3, 4, or 6 columns.

### Density

4px base unit. Tight padding to maximize data above the fold.

- Container padding: 24px
- Gutter: 16px
- Module gap (between chart cards): 12px
- Table row height: 32px
- Component internal padding: 8-12px

### Breakpoints

- **Desktop 1440px+**: full multi-pane view, persistent sidebar
- **Tablet 768-1024px**: sidebar collapses to icons, cards reflow 2-column
- **Mobile 375px**: single column, data tables → key-metric cards with horizontal swipe

### Shape Language

**Sharp 90-degree corners everywhere.** No rounded corners on chart cards, buttons, inputs, badges, or modules. Maintains the grid-like precision and "engineered" feel.

### Elevation

Tonal layers, not shadows.

- Level 0 (base): `#0A1428`
- Level 1 (surface): `#152036`
- Level 2 (active canvas): `#FFFFFF`

Use 1px solid borders (`#1F2D52` on dark, `#E5E5E5` on white) for module boundaries. No `box-shadow`.

## Components

### Buttons

- Primary: solid Gold (`#D4AF37`) bg + black (`#0A1428`) text. Oswald label.
- Secondary: outlined Navy. Oswald label.

### Data Tables

- Alternating zebra stripes (Navy/Lighter Navy on chrome; White/Light Gray on canvas)
- Header cells: sticky
- Numbers right-aligned, JetBrains Mono, tabular-nums

### Stat Tiles

- Card navy background
- Gold 1px or 3px left accent for hierarchy
- Big Oswald number
- Small gray label below

### Status Badges (chips)

- Small rectangular tags
- 4px padding, 11px text, uppercase
- IN PORTAL = green (`#1A6B35`)
- WATCHING = gold (`#D4AF37`)
- Sharp corners (no rounding)

### Chart Cards (Visualization Canvas)

- White (`#FFFFFF`) background
- Sharp 90-degree corners
- 1px solid `#E5E5E5` border
- Tight internal padding (12-16px)
- Section title in Oswald 18px uppercase above the visualization
- All numerical labels in JetBrains Mono

### Roster Cards

- White canvas style
- Player headshot on left
- Grid of Oswald-styled "big metric" tiles on right

### Heatmaps

- Diverging Red-to-Blue scale
- Strictly contained within sharp-edged canvas card
- No drop shadow on the heatmap container
- Legend in Archivo Narrow caps

## Behaviors

- All interactive elements: `cursor-pointer` + 150-300ms color/opacity hover transitions
- Respect `prefers-reduced-motion` on all animations
- Numbers right-aligned, tabular-nums, monospace feel
- Text left-aligned

## Banned

- ❌ Loading spinners, skeleton loaders, sliding cursors, animated placeholders (one exception: Peyton's PlayerProfile progressive-load skeleton)
- ❌ Pure white `#FFFFFF` for text — always off-white `#F2F0EA`
- ❌ Emojis as icons — use SVG (Lucide / Heroicons)
- ❌ Decorative buttons or subtitles that aren't actively functional
- ❌ Heavy 1px solid borders separating major sections — prefer tonal shifts (navy → card-navy)
- ❌ Rounded corners on chart cards or analytical modules
- ❌ `box-shadow` for module elevation — use tonal layers + 1px borders

## Visualization-Specific Rules (Layer 2)

### Strike Zone

- Horizontal edges: ±0.83 ft (10 inches from center) accounting for 17" plate + ball
- Vertical: use TruMedia normalized `pz_norm` / `px_norm` (per-batter sz_top/sz_bot already baked in)
- **Never hardcode 1.5–3.5 ft for the zone vertical bounds.**

### Heat Map Over the Zone

- In-app (React): `d3-contour` filled density contours over a grid above the plate
- Export (Python): seaborn `kdeplot` layered on a drawn zone

### Field / Spray Chart

- Coordinate transform from Statcast `hc_x` / `hc_y` is non-trivial — use the math from `baseball-field-viz` (Python) or port it to TS
- Spray geometry assumes average ballpark — true per-park outfield walls are a separate layer

## Stack Versioning

- **In-app React drawing**: `d3` + `d3-contour` (installed). Existing `recharts` stays for simple trend charts.
- **In-app shell**: shadcn/ui + Tailwind. Existing Stitch tokens applied via Tailwind theme.
- **Python export path** (for BSGB content, not in-app): `pybaseball` + `baseball-field-viz` + `seaborn` + `matplotlib`. Lives in a separate project, not the diamond-predictor-66 repo.

## Sources

- Stitch design system: "Roster Intelligence System" (project 17717741894289957208, 2026-06-24)
- Earlier Stitch design: "RSTR IQ" (project 6098670780097763857, 2026-05-13) — superseded for visualization work
- Persisted design search: `design-system/rstr-iq/MASTER.md` (UI/UX Pro Max plugin output)
