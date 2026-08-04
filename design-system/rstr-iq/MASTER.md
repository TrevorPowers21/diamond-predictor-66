# RSTR IQ — Design System Master

**Status:** Authoritative. Overrides any auto-generated plugin output.
The brand is locked — do not regenerate this file via the `ui-ux-pro-max` plugin
(its output recommends generic blue/amber light-mode defaults that conflict with the
established navy/gold dark-mode palette).

**Hierarchy:** Global. Page-specific deviations live in
`design-system/rstr-iq/pages/<page>.md`. Page files override MASTER on conflict.

## Changelog
- **2026-08-04 — Codified from the shipped app.** Reconciled against the actual rendered
  application (Tailwind config, `index.css`, `src/savant/lib/theme.ts`, real component usage).
  The current rendered appearance is canonical; this doc now describes what ships, not an
  aspiration. Key corrections: **Oswald was never loaded and never rendered** (headings render
  in Inter today — that IS the intended look); **JetBrains Mono** is the numeric face; the
  **navy border is #162241** (majority usage) and **card is #0a1428** (variants #1f2d52 and
  #0D1A30 deprecated); the **gray text scale** (#8A94A6 / #5A6478) and the **chart palette** are
  now documented as official.

---

## Brand identity
- **Product:** College baseball roster intelligence (RSTR IQ)
- **Aesthetic:** Premium sports analytics. Confident, dense, data-rich. Closer to Baseball
  Savant / MLB.com than a generic SaaS dashboard. **Density > whitespace.**
- **Mode:** dark-only (forced `class="dark"` on `<html>`).

## Color tokens (LOCKED — ratify current rendering)

| Role | Hex | Notes |
|---|---|---|
| Gold accent | `#D4AF37` | Active states, emphasis, top-tier percentile bars, highlighted values, brand chrome. The only gold. |
| Gold darker | `#A08820` | Pressed/hover for gold buttons (rare) |
| Page navy bg | `#040810` | Main page background |
| Card navy | `#0a1428` | Section card / panel background |
| Card border | `#162241` | Borders, dividers, subtle structure |
| Text primary | `#FFFFFF` | Main values, headers |
| Text secondary | `#8A94A6` | Body, supporting text |
| Text tertiary | `#5A6478` | Hints, metadata, deemphasized |
| Portal: In Portal | `emerald-500/15 + emerald-300` | Portal entry badges |
| Portal: Committed | `bg-blue-500/10 + text-blue-600` | Commitment badges |
| Portal: Watching | `bg-[#D4AF37]/10 + text-[#D4AF37]` | Watchlist badges |

**Deprecated hexes (consolidate on sight — near-identical by eye):**
`#0D1A30 → #0a1428` (card), `#1f2d52 → #162241` (border), `#94A3B8 → #8A94A6` (secondary
text), `#E8C24E → #D4AF37` (gold). The `--primary` / `--accent` / `--ring` HSL tokens in
`index.css` should equal exactly `#D4AF37`.

**Canonical source in code:** `src/savant/lib/theme.ts` (`NAVY_BG`, `NAVY_CARD`,
`NAVY_BORDER`, `GOLD`) and the Tailwind named tokens (`navy-bg`, `navy-card`, `navy-border`,
`gold`, `text-secondary`, `text-tertiary`). Import these — do not redefine locally.

## Typography
- **All UI text (headings, labels, body):** **Inter** (loaded via `index.css`). Headings get
  their distinction from Inter **weight + letter-spacing** (uppercase, tracking-wider to
  `tracking-[0.22em]`), NOT a separate display face.
- **Numeric values:** **JetBrains Mono** (loaded via `index.css`) where a monospace numeric is
  used; otherwise Inter with `tabular-nums`.
- **Numeric cells:** always `tabular-nums` for grid alignment.
- **Oswald is NOT used.** It was referenced in code (`font-[Oswald]`) but never loaded, so it
  always rendered as Inter. Those references are dead and are being removed; do not add new
  `font-[Oswald]` and do not load Oswald — headings must keep rendering in Inter exactly as
  they do today. (Cormorant Garamond: only the logo "R" — leave untouched if it depends on it.)

## Chart palette (official — ratified as rendered)
Charts (recharts + d3) use a **slate-on-navy** ramp, and it is correct. Do not restyle.
- Slate ramp actually in use: `#0F172A`, `#475569`, `#94A3B8`, `#4b5563`, `#6b7280`, `#525252`.
- **Gold `#D4AF37` is reserved for the highlighted / primary data point** (matches current
  usage) — not for general series.
- `PercentileBar.tsx` uses `#0D1B3E` (a marketing-navy) — documented as a **known usage under
  review**; leave as-is for now.
- Future charts should import the ratified ramp from `CHART_THEME` in `src/savant/lib/theme.ts`.

## Established component patterns
- **Section panel:** bordered box, `backgroundColor: #0a1428`, `borderColor: #162241`, with an
  Inter uppercase label `text-[12px] font-bold tracking-[0.22em] text-[#D4AF37]`.
- **Inline filter dropdown:** bordered button + gold dot prefix + click-outside-to-close.
  Reference: `DimensionPicker` in `src/savant/components/PitchLogSection.tsx`.
- **Stat chip:** min-w 96px, bordered, padded. Label 12px Inter uppercase (`#8A94A6`); value
  2xl bold `tabular-nums`, gold if emphasized.
- **Percentile bar:** `src/savant/components/PercentileBar.tsx` — Red (≥75) → blue (≤25) scale.
- **Page tab strip:** border-bottom navy; active tab gold + underline
  (`src/components/PlayerPageTabs.tsx`).
- **Data tables:** headers 11px Inter uppercase tracking-wider (`#8A94A6`); cells 14px
  `tabular-nums`; row borders `rgba(255,255,255,0.05)`; numeric centered, label left.
- **Portal status badge:** always the canonical `<PortalStatusBadge>` from
  `src/components/PortalStatus.tsx`.

## Guardrails
- **No loading spinners, sliding cursors, skeleton loaders, animated placeholders.**
  (Exception: Peyton's `PlayerProfile` progressive-load skeleton.)
- **No emojis as icons.** SVG only (Lucide / Heroicons).
- **All interactive elements:** `cursor-pointer` + 150–300ms color transition.
- **Respect** `prefers-reduced-motion`.
- **Responsive:** test at 375px / 768px / 1024px / 1440px.

## Anti-patterns
- **Light mode** — RSTR is dark-only.
- **Generic dashboard blue** (`#1E40AF`, etc.) — navy + gold only. (Chart slate is the
  sanctioned exception, per the chart-palette section.)
- **Loading Oswald / adding `font-[Oswald]`** — it never rendered; headings are Inter.
- **New off-scale grays or navies** — use the deprecated→canonical map above.
- **Big whitespace gaps** — coaches scan dense data, pack the page.
- **Animated transitions longer than 300ms.**
- **Icon-only buttons without aria-label; hover effects that shift layout.**

## Canonical visual reference
When unsure, mirror the Savant page patterns: `src/savant/pages/PitcherPage.tsx`,
`src/savant/pages/HitterPage.tsx`, `src/savant/components/*`. The Stats pages
(`src/pages/PlayerStatsPage.tsx` / `PitcherStatsPage.tsx`) inherit the same tokens.

## Plugin usage note
`ui-ux-pro-max --design-system --persist` will OVERWRITE this file with generic
recommendations. Do NOT run with `--persist` without immediately re-overwriting this file.
Useful as a non-persist reference (`--design-system` only) for pre-delivery checklist items
(cursor, contrast, aria).
