# RSTR IQ — Rules

**This file is loaded every session, so it holds RULES ONLY — one line each, no narrative.**
Reasoning lives in `docs/PHILOSOPHY.md` (business) and `docs/knowledge/` (technical). Current state
lives in `.claude/state/current.md`. If you are about to add a paragraph here, it belongs in one of
those instead.

| layer | file | loaded |
|---|---|---|
| **Rules** (this file) | `CLAUDE.md` | every session |
| **Voice / business judgment** | `docs/PHILOSOPHY.md` | every session |
| **State — where things stand now** | `.claude/state/current.md` | every session + after compaction |
| **Technical judgment** | `docs/knowledge/*.md` | on demand |
| **History** | `docs/AGENT_LEARNINGS_INDEX.md` | on demand |
| **Roadmap** | `docs/HANDOFF_2026_09_02_STATE_AND_ROADMAP.md` | on demand |
| **Canonical build spec** | `docs/PIPELINE_pitch_log_to_projections.md` (Track B) | on demand |

---

## ⛔ Database Access Boundary (non-negotiable)

**Applies to every agent, session, and tool — including MCP servers, dev agents, and any subagent they
spawn. It survives session resets. Nothing below overrides it.**

- **No write happens without being talked through first.** Not "just this once because it's small."
- **The gate is that a write was talked through — not who runs it.** Execution is assigned per task;
  multi-statement work often goes to the agent, because hand-pasting a long migration is the *more*
  error-prone path.
- **Agent writes go through the repo's scripted migration path, never MCP** — that path has the ritual:
  dry-run → apply → **verify objects via the catalog** → brief the operator.
- **MCP is reads + schema introspection only.** ✅ `SELECT`, `EXPLAIN`, list tables/columns/policies,
  RLS advisories, row counts, verify a migration landed. ❌ any write, any DDL, any writing edge fn.
- **Anything `:prod` gets an explicit "prod, now?"** — never on an ambiguous go. `prod_wipe_and_reprecompute`
  does exactly what its name says.
- **Staging first, always.** Trevor merges `staging` → `main`, via `gh pr create`.
- **Append every applied migration to `PROD_MIGRATIONS_TODO.md`.**

**Both databases are connected, read-only, as separately named servers:**

| Server | Project ref | Purpose |
|---|---|---|
| `supabase-staging` | `slrxowawbijbjrkozqlj` | Testing DB. Button the process up here first, always. |
| `supabase-prod` | `trbvxuoliwrfowibatkm` | Live DB. Serves `main` **and the Vercel PR previews**. |

Both carry `read_only=true`, `features=database,docs`, pinned `project_ref`. Read-only is enforced by
a Postgres role, not convention. **The server name carries the target — state it out loud anyway.**

> Why prod is connected, and why this rule is written down rather than assumed:
> `docs/knowledge/database-access.md`.

---

## 🎨 Design

- **The UI/UX Pro Max plugin and Stitch MCP are the decision makers.** Where they conflict with the
  guardrails below, **the plugin wins** — these are guardrails, not overrides.
  `python3 skills/ui-ux-pro-max/scripts/search.py "<query>" --design-system -p "RSTR IQ"`
- Persisted design system: `design-system/rstr-iq/MASTER.md`
- **No loading spinners, sliding cursors, skeleton loaders, or animated placeholders** anywhere.
- Brand: gold `#D4AF37`, sidebar navy `#070e1f`, darker gold `#A08820`.
- Oswald for headings/labels in branded areas; body defers to the design system (currently Inter).
- No unnecessary buttons, subtitles, or decorative UI that isn't actively functional.
- Status badges: IN PORTAL = green, WATCHING = gold. Avatars: gold initials on dark gold.
- All interactive elements need `cursor-pointer` + a 150–300ms hover transition.
- Respect `prefers-reduced-motion`. Test at 375 / 768 / 1024 / 1440px.

---

## 🔢 Numbers on screen

- **Never compute a user-facing number. Read the stored snapshot.**
  `player_snapshot ?? transfer_snapshot` — **never `p.prediction`** (that's a raw prediction row).
- **The same stat must show the identical value on every surface**, including under dev-aggressiveness,
  depth-role, and SP/RP toggles. Two values for one stat invalidates the app.
- **IP/PA come from the depth role**, not stored `projected_ip`.
- **Exact zero is missing** — render `—`, not `0` / `0%`.
- **IDs over names.** Filters and joins key off `team_id` / `source_team_id` / `conference_id`; names
  are display only. Name-matching needs a unique-match-or-skip guard (the Harrison Cook trap).
- Region/conference baselines are **IP/PA-weighted**, never simple means.
- TruMedia filters: `PA > 0` for hitters, `IP > 0` for pitchers, both for two-way players.
- **TWPs carry both sides on ONE row** — the shared `market_value` is NULL by design; values live in
  `twp_hitter_market_value` / `twp_pitcher_market_value`.

> The read/write doctrine and why every automated check passed while the UI was wrong:
> `docs/knowledge/snapshots-and-recompute.md`.

---

## ♻️ Refactoring

| If you find… | It belongs in… |
|---|---|
| Pure calculation or formatting | `src/lib/` (`playerCalcs.ts`, `nameUtils.ts`) |
| Name/team normalization | `src/lib/nameUtils.ts` |
| Data-fetching + derived state | `src/hooks/` |
| Page-specific hook, no UI | `src/pages/<page>/hooks/` |
| Reusable UI widget | `src/components/` |

- **Don't fork math that lives in `src/lib`.** When refactoring page A surfaces a function that also
  exists in page B, extract to shared **first**, then update both call sites **in the same PR**.
  Improving one and leaving the other creates drift.
- **`src/lib/*` and the precompute must stay in sync** — a formula change touches both, plus the edge
  function. Every new precomputed metric gets a parity test in `src/lib/storedVsLive.test.ts`.
- Canonical shared functions and the deferred `addPlayerFromTargetSearch` extraction:
  `docs/knowledge/code-structure.md`.

---

## ✅ Verification

```bash
npm test                                  # 265 tests / 12 files, ~4s
tsc -p tsconfig.app.json --noEmit         # THE type gate
```

- ⛔ **`tsc --noEmit` (no `-p`) is a NO-OP.** The root `tsconfig.json` has `files:[]` + project
  references, so it type-checks **zero files and always passes.** The real gate is
  `tsc -p tsconfig.app.json`.
- The app carries a **pre-existing error baseline**, so never gate on zero. CI measures
  **delta-vs-base as a set difference** — ⚠ **an error *count* hides a swap** (one fixed, one
  introduced). Compare the error *set*, not the number.
- `vite build` uses esbuild (transpile-only) and `npm test` runs unit tests — **neither catches a
  component reference error.** For any page/component change, **load the page** before calling it
  verified.
- **A DB check verifies the DATABASE. Read-path bugs only appear in the UI.**
  Triage: *is it wrong in the DB, or only on SCREEN?* DB → re-bake. Screen only → read path; first
  question is *which stored field does that surface actually read.*
- **Before diffing two implementations, prove they are COMPARABLE**: same generation (`updated_at`),
  same side (a TWP holds both on one row), same field name (`market_value` is stored as
  `nil_valuation` on board snapshots; `o_war` as `owar`).
- **Split FIXED / DETECTED / UNVERIFIED**, and name what you did *not* check, unprompted.

---

## 🗣️ Working with Trevor

- **Wait for an explicit go before any code or data change.** At a fork, stop and surface it rather
  than picking.
- A real problem = **pause and surface it**, not work around it silently.
- Run the test suite whenever you touch formula logic, projection math, or add a metric.
- **Modeling decisions are never the agent's** — equation weights, thresholds, tier boundaries, risk
  ratios, Stuff+ baselines, competition translation. Present options with a recommendation and wait.

---

## 🗒️ Technical notes

- Primary data source: Supabase (Hitter Master, Pitching Master, Conference Stats, Teams Table, Park Factors).
- Cross-season player linking: `source_player_id`. Players `team_id` FK → "Teams Table".
- Teams Table uses `abbreviation` as the primary display name (`full_name`, not "Team").
- Equations live in `readPitchingWeights()` / `computeHitterPowerRatings()` in `powerRatings.ts`.
- **Canonical WAR / wRC+ / pRV+ formulas: `src/savant/lib/war.ts` and `src/lib/pitcherQuality.ts`.**
  Written out with derivations in `docs/knowledge/formulas.md` — the code is authoritative, the doc
  is not.
- RLS: program-scoped by `customer_team_id`. Super-admin "all clients" is **backend-gated**.
- `SchoolBanner` takes `schoolLogoUrl` + `schoolName` for per-team branding.
