# RSTR IQ — Design System Master

**Status:** Authoritative. Overrides any auto-generated plugin output.
The brand is locked — do not regenerate this file via the
`ui-ux-pro-max` plugin (its output recommends generic blue/amber light-mode
defaults that conflict with the established navy/gold dark-mode palette).

**Hierarchy:** Global. Page-specific deviations live in
`design-system/rstr-iq/pages/<page>.md`. Page files override MASTER on conflict.

---

## Brand identity

- **Product:** College baseball roster intelligence (RSTR IQ)
- **Aesthetic:** Premium sports analytics. Confident, dense, data-rich.
  Closer to Baseball Savant / MLB.com in feel than a generic SaaS dashboard.
- **Audience:** College baseball coaches doing player evaluation under
  time pressure. **Density > whitespace.**

## Color tokens (LOCKED)

These are immutable. Do not propose alternates.

| Role | Token | Hex | Use |
|---|---|---|---|
| Gold accent | `GOLD` | `#D4AF37` | Active states, emphasis, top-tier percentile bars, highlighted values, brand chrome |
| Gold darker | — | `#A08820` | Pressed/hover for gold buttons (rare) |
| Sidebar navy | — | `#070e1f` | App shell / sidebar background |
| Page navy bg | `NAVY_BG` | `#040810` | Main page background |
| Card navy | `NAVY_CARD` | `#0a1428` | Section card / panel background |
| Card border | `NAVY_BORDER` | `#1f2d52` | Borders, dividers, subtle structure |
| Text primary | — | `#FFFFFF` | Main values, headers |
| Text secondary | — | `white/60` | Body, supporting text |
| Text tertiary | — | `white/40` | Hints, metadata, deemphasized |
| Portal: In Portal | — | `emerald-500/15 + emerald-300` | Portal entry badges |
| Portal: Committed | — | `bg-blue-500/10 + text-blue-600` | Commitment badges |
| Portal: Watching | — | `bg-[#D4AF37]/10 + text-[#D4AF37]` | Watchlist badges |

## Typography

- **Headings / branded labels:** **Oswald** (`font-[Oswald]`), uppercase,
  tracking-wider to `tracking-[0.22em]`.
- **Body / numeric values:** Default sans (Inter from project base).
- **Numeric cells:** Always `tabular-nums` for grid alignment.

## Established component patterns

### Section panel
```tsx
<section className="border px-4 py-4"
  style={{ backgroundColor: NAVY_CARD, borderColor: NAVY_BORDER }}>
  <div className="mb-3 font-[Oswald] text-[12px] font-bold uppercase tracking-[0.22em] text-[#D4AF37]">
    {title}
  </div>
  {children}
</section>
```

### Inline filter dropdown
Bordered button + gold dot prefix + click-outside-to-close.
Reference: `DimensionPicker` in `src/savant/components/PitchLogSection.tsx`.

### Stat chip (top-of-page key metrics)
min-w 96px, bordered, padded. Label: 12px Oswald uppercase white/55.
Value: 2xl Oswald bold tabular-nums; gold if emphasized.

### Percentile bar
Reference: `src/savant/components/PercentileBar.tsx`. Red (≥75) → blue (≤25) color scale.

### Page tab strip (Overview ↔ Season Stats)
Border-bottom navy; active tab gold + underline.
Reference: `src/components/PlayerPageTabs.tsx`.

### Data tables
Headers: 11px Oswald uppercase tracking-wider white/55.
Cell text: 14px (`text-sm`), tabular-nums.
Borders: `rgba(255,255,255,0.05)` between rows.
Centered numeric columns; left-aligned label column.

### Portal status badge
Always use the canonical `<PortalStatusBadge>` from `src/components/PortalStatus.tsx`.
For surfaces that must show "Not In Portal" explicitly (the Overview component
returns null for that state), render a muted fallback Badge labeled "Not In Portal".

## Guardrails (from CLAUDE.md, restated)

- **No loading spinners, sliding cursors, skeleton loaders, animated
  placeholders.** (Exception: Peyton's PlayerProfile progressive-load skeleton.)
- **No emojis as icons.** SVG only (Lucide / Heroicons).
- **All interactive elements:** `cursor-pointer` + 150-300ms color transition.
- **Respect** `prefers-reduced-motion`.
- **Responsive:** test at 375px / 768px / 1024px / 1440px.

## Anti-patterns (don't do these)

- **Light mode** — RSTR is dark-only.
- **Generic dashboard blue** (`#1E40AF`, etc.) — stick to navy + gold.
- **Fira Code / Source Code Pro** etc. — Oswald headers, Inter body only.
- **Big whitespace gaps** — coaches scan dense data, pack the page.
- **Animated transitions longer than 300ms.**
- **Icon-only buttons without proper aria-label.**
- **Hover effects that shift layout** (no scale transforms on cards).

## Canonical visual reference

When unsure, mirror the Savant page patterns at:
- `src/savant/pages/PitcherPage.tsx`
- `src/savant/pages/HitterPage.tsx`
- `src/savant/components/*`

The Stats pages (`src/pages/PlayerStatsPage.tsx` / `PitcherStatsPage.tsx`)
follow the same patterns and inherit the same tokens.

## Plugin usage note

`python3 ~/.claude/skills/ui-ux-pro-max/scripts/search.py ... --design-system --persist`
will OVERWRITE this file with generic recommendations. **Do not run with `--persist`
without immediately re-overwriting this file.** Useful as a non-persist reference
(`--design-system` only) for surfacing pre-delivery checklist items (cursor,
transitions, focus states, responsive breakpoints).
