# RSTR IQ Dev Agent — Phase One Scope

**Status:** Complete pending task zero (§2.0). Sections 6 and 7 filled in from Trevor's review 2026-08-06; trust counter confirmed per-category. No open items.
**Created:** 2026-08-05
**Applies to:** the planned RSTR IQ dev agent (see `docs/rstr-agent-plan.md`), and to any Claude Code session operating under agent rules.

---

## 1. Purpose and the one-sentence scope

Phase one is **pattern-following work only**: changes where a correct implementation already exists elsewhere in the repo and the task is to extend, split, or mirror it. The agent is not authorized to originate modeling decisions, touch the safety-critical surfaces in §4, or write to any database.

The test is not "is this task easy?" It is **"does a canonical example of this exact change already exist in the repo that a reviewer could diff against?"** If yes, in scope. If no, escalate.

---

## 2. The hard gate: anchor tests

**Every phase-one change must leave anchor outputs bit-identical unless the task explicitly authorizes a shift. Any unauthorized shift fails closed — the agent stops and reports, it does not adjust the expectation.**

### 2.0 Prerequisite — the anchor suite does not exist yet

This needs stating plainly, because the plan assumes it: **there is currently no anchor test suite in this repo.** The eight existing test files are formula-constant and parity tests:

| File | What it actually pins |
|---|---|
| `src/savant/lib/war.test.ts` | wRC+, oWAR, pWAR formula outputs for synthetic inputs |
| `src/lib/playerCalcs.test.ts` | `computeOWarFromWrcPlus` parity vs `computeOWar` |
| `src/lib/pitcherProjection.test.ts` | `projectPitchingRate`, blend weight, damping |
| `src/lib/storedVsLive.test.ts` | Formula-constant parity across duplicate call sites |
| `src/lib/transferWeightDefaults.test.ts` | Transfer weight defaults |
| `src/lib/nilProgramSpecific.test.ts` | Program-specific NIL math |
| `src/lib/classTransitionUtils.test.ts` | Class transition rules |
| `src/lib/conferenceMapping.test.ts` | Conference ID mapping |

These pin *formulas against hand-derived constants*. They do not pin *real players against known-good outputs*, which is what a gate for pattern-following work needs — a filter split or rollup change can leave every formula constant untouched and still silently move a player's numbers.

**Therefore: building the anchor suite is task zero. The agent does not get phase-one authority until it exists and passes.**

### 2.1 What the anchor suite must be

A fixture-backed suite, following the pattern already used by the dRS engine (`scripts/drs/fixtures/*.json` — `league_fixtures.json`, `constants_d1.json`, `re24_matrix.json`), extended to the TypeScript side:

- **A frozen fixture set of real players**, checked into the repo as JSON, not read live from Supabase. Live reads make the gate non-deterministic and couple it to staging data drift.
- **Coverage across the shapes that break differently**: a hitter, a starting pitcher, a reliever, a two-way player (see `reference_twp_positions_2026`), a JUCO transfer, a returner, and at least one player with missing/zero scouting inputs (the `0 → —` case).
- **Assertions on end outputs, not intermediates**: wRC+, oWAR, pWAR, projected line, risk tier, market value, precompute-stored values.
- **Exact equality or a stated tolerance per field**, committed alongside the fixture. A change that shifts an anchor by 0.001 must fail unless the tolerance says otherwise.

Suggested location: `src/test/anchors/` with `anchors.fixture.json` + `anchors.test.ts`, wired into the existing `npm test` (vitest `include: ["src/**/*.{test,spec}.{ts,tsx}"]` already picks this up).

### 2.2 Gate semantics

- Anchor test fails → **stop, report, do not proceed.** Never edit the fixture or loosen the tolerance to make a change pass. Changing an anchor expectation is a human decision, always.
- Anchor tests pass but the agent can't explain *why* the change was safe → treat as a failure and escalate.
- `tsc -p tsconfig.app.json` is the real type gate (`npm run build` does not surface the same errors). Measured **delta-vs-base**, not absolute count — the repo carries a pre-existing error baseline.

---

## 3. In scope — pattern-following work

Each item lists the canonical example the agent diffs against. **No canonical example named = not in scope.**

### 3.1 Filter splits
Adding or splitting a filter dimension on an existing list/table surface where the filtering pattern is already established.

- **Surfaces:** `src/pages/*.tsx` (`ReturningPlayers.tsx`, `TransferPortal.tsx`, `Targets.tsx`, `Teams.tsx`, `HighFollowList.tsx`), `src/savant/pages/LeaderboardsPage.tsx`, `src/gm/pages/*.tsx`
- **Rules that must hold:** filters key off IDs (`team_id`, `source_team_id`, `conference_id`), never names — names are display only. Program scoping via `customer_team_id` is preserved on every new query path.
- **Out of scope within this category:** introducing a *new* scoping dimension, or any filter that changes which program's data is visible.

### 3.2 Stat rollups
Extending an existing aggregation to a new metric or a new grouping level.

- **Canonical examples:** `src/savant/lib/rollupStuffPlusToMaster.ts`, `src/savant/lib/conferenceStuffPlus.ts` / `conferenceStuffPlusV2.ts`, `src/savant/lib/pitchLogRates.ts`, `src/lib/combinedStats.ts`
- **Rules that must hold:** region/conference baselines are IP/PA-weighted, never simple means. TruMedia filters (`PA > 0` hitters, `IP > 0` pitchers, both for TWPs) are applied. Exact-zero scouting percentages render `—`, not `0`.

### 3.3 Precompute parity extension
Adding a metric to the precompute pipeline and its matching parity test.

- **Canonical examples:** `scripts/precompute-transfer-projections.ts`, `scripts/precompute-pitchers.ts`, `scripts/precompute-returner-pitchers.ts`
- **Mandatory paired change:** every new precomputed metric gets a parity test in `src/lib/storedVsLive.test.ts` in the existing style — the precompute formula and the live formula asserted equal for representative inputs. A precompute change without a parity test is incomplete, not "to be added later."
- **Why this category is in scope at all:** the math already lives in `src/lib/*` and is duplicated into precompute. The agent is mirroring an existing implementation, not authoring one.

### 3.4 Backfills following an existing pattern
Writing a backfill *script* that follows an existing one.

- **Canonical examples:** `scripts/backfill-juco-preds`, `scripts/backfill-2027-hitter-returners`, `scripts/backfill-build-snapshots` (see `package.json` scripts)
- **Hard limit:** the agent **writes and reviews** the script. It does not run it against any database. See §4.

### 3.5 Mechanical consolidation
Deprecated-token → canonical-token sweeps where the diff is one repeated substitution (e.g. the design Phases 4/5/6 hex and font consolidation against `design-system/rstr-iq/MASTER.md`).

- **Property that must hold:** the diff should be trivially reviewable — any real logic change stands out immediately. If a "mechanical" sweep starts requiring judgment calls per call site, it isn't mechanical; escalate.

---

## 4. Human-only — never the agent, no exceptions

### 4.1 All database writes
⚠ **RECONCILED 2026-09-02 — `CLAUDE.md` supersedes the original wording of this section.**

Supabase MCP stays **reads and schema introspection only** — that has not changed, and both servers
(`supabase-staging`, `supabase-prod`) are read-only at the Postgres role level.

What changed: **the gate on a write is that it was talked through first, not who runs it.** Execution
is assigned per task — Trevor pastes some, the agent runs others, and bigger multi-statement work
tends to go to the agent because hand-pasting a long migration is the *more* error-prone path.

**When the agent executes a write it goes through the repo's scripted migration path, never MCP** —
that is where the ritual lives: dry-run, apply, verify via the catalog, brief the operator. An MCP
write returns a bare success with no catalog verification, which is the `exec_sql OK` trap that lost
`gm_contract` on prod.

**What never changes:** no write happens without being talked through first. Not "just this once
because it's small." And §4.2 (`:prod`) still requires an explicit "prod, now?" confirmation.

### 4.2 Anything `:prod`
The 34 `:prod` npm scripts — `import:prod`, `precompute-transfers:prod`, `precompute-pitchers:prod`, `lock-season:prod`, `recompute-stuff:prod`, `import-juco:prod`, `prod_wipe_and_reprecompute`, and the rest — are human-run. The agent may draft the command and explain what it will do; it does not execute it. Prod actions additionally require an explicit "prod, now?" confirmation.

### 4.3 RLS policies and migrations
`supabase/migrations/**`, `supabase/rollback/**`, anything touching `user_team_access`, `customer_team_id` scoping, or policy definitions. The agent may *read* policies and RLS advisories via MCP and *report* what it finds. It does not author, edit, or apply them. Every applied migration is appended to `PROD_MIGRATIONS_TODO.md` by hand.

### 4.4 dRS engine math
`scripts/drs/drs_engine/**` (`engine.py`, `field.py`, `normalize.py`, `constants.py`, `season_config.py`, `baserunning.py`) and the derivation scripts (`derive_catch_surface.py`, `derive_re24.py`, `derive_constants.py`, `derive_field_positions.py`).

This is mid-flight, math-heavy, and zero-sum-constrained — the kind of surface where a wrong-but-plausible change passes review because the number still looks reasonable. The v0.6.0 catch-probability surface took a zero-sum residual from +5148 to −425; that is not a property a pattern-matching agent can be trusted to preserve.

### 4.5 Collision and park geometry
`src/lib/parkFactors.ts`, the planned `parks` dimension table, `scripts/drs/fixtures/field_positions.json`, `catch_surface.json`. Geometry errors are invisible in aggregate and wrong per-player.

### 4.6 Modeling decisions of any kind
Equation weights, thresholds, tier boundaries, risk asymmetry ratios, Stuff+ baselines, small-sample pullback rules, competition translation. These get presented as options with a recommendation and **wait for Trevor's call.** The agent does not pick.

---

## 5. Gray zone — draft, then stop

Work the agent may fully prepare but must hand off rather than complete:

| Situation | Agent does | Human does |
|---|---|---|
| Backfill script needed | Writes + self-reviews the script, dry-run reasoning | Runs it |
| Schema change needed | Drafts the migration SQL | Reviews, pastes, appends to `PROD_MIGRATIONS_TODO.md` |
| Anchor test fails | Reports the diff and its hypothesis | Decides whether the anchor moves |
| Pattern exists but differs across three call sites | Reports the divergence | Picks the canonical one |
| Change touches a `:prod` path indirectly | Flags the reach | Approves or redirects |

---

## 6. Trust progression

Three tiers. Trust is earned by track record, but **scope is never earned by streak alone.**

### Tier 1 — proposes only (current)
The agent proposes; a human reviews every diff before merge. No exceptions, no "small enough to skip." This is where the agent starts and where it stays until Tier 2 is met.

### Tier 2 — merges pattern-following work, reviewed async
Entry condition: **10 clean tasks within a single §3 category** — anchor-green, review-clean, zero anchor failures, zero reverts.

**The counter is per-category, not global.** Tier 2 is earned and held separately for filter splits (§3.1), stat rollups (§3.2), precompute parity extension (§3.3), backfill scripts (§3.4), and mechanical consolidation (§3.5). Ten clean filter splits promote filter splits and nothing else.

The reason is blast radius, and it is not uniform across §3. A filter split that goes wrong shows a coach the wrong subset of a list — visible, local, recoverable. A precompute parity extension that goes wrong writes a bad stored value that every surface then reads as truth, and the surfaces agree with each other, which is exactly what makes it hard to spot. Those two failure modes do not deserve the same evidentiary bar, and a global counter would let the cheap category pay for the expensive one.

At Tier 2 the agent may merge §3 work **in a promoted category** gated by CI plus anchors; the human reviews asynchronously rather than pre-merge. Note what this does and does not change: it moves the *timing* of human review, not its existence. The gate is CI + anchors, and it is the same gate either way.

### Tier 3 — deliberately not defined
Expanding into a new work category requires **adding a canonical example plus anchor coverage for that category first.** A clean streak is not an argument for new scope — it is evidence the agent is good at the categories it already has examples for, which says nothing about a category with no example to diff against. Tier 3 stays undefined until there is a specific category to define it for.

### Reset rule
**A failed anchor at any tier resets that category's counter to zero and returns the category to Tier 1.** Not decays, not steps down partially — resets. The counter is a claim that the agent has not shipped a silent output change in that category, and one failure falsifies the claim outright.

Other categories keep their counters. A failed anchor is evidence about the category it happened in; extending it further would be the same over-generalization the per-category rule exists to prevent.

### Ceiling
Nothing in §4 is reachable from any tier. DB writes, `:prod`, RLS/migrations, dRS engine math, collision/park geometry, and modeling decisions are structurally human-only, not provisionally so.

## 7. Escalation rules

### Stop and hand to a human when

- **Any anchor fixture fails.** Report the frozen-vs-actual delta explicitly — which player, which field, expected vs got. Never edit the fixture or the tolerance to make it pass.
- **Any change touches a §4 human-only path, even incidentally.** "Incidentally" is the operative word: a one-line import change inside `scripts/drs/drs_engine/` is still the dRS engine.
- **A task has no canonical example to diff against.** This is the §1 test failing. Absence of an example is the signal, not an obstacle to route around.
- **Grep or test counts differ from expectations.** Expected 14 call sites, found 11 — stop. The gap is information, and proceeding discards it.
- **The agent is uncertain which of two patterns applies.** Two plausible canonical examples is the same condition as none.

### The rule of thumb, verbatim

> **When in doubt, the cost of asking is seconds and the cost of guessing is a paying program seeing wrong numbers.**

### What an escalation must contain

What it tried, what it saw (actual output, not a summary of it), what it believes is happening, and what specifically it needs decided. An escalation that only says "this seems wrong" hands the whole problem back and wastes the context the agent already has.

### While an escalation is pending

The agent may continue on **unrelated** in-scope work. It may not continue on anything downstream of the escalated question, and it may not pick a provisional answer to keep moving.

### Residual risk this does not cover

Anchor tests catch output changes on the fixture set. They do not catch a wrong-but-plausible change affecting players *outside* the fixtures — which is exactly why §2.1 requires coverage across shapes that break differently (hitter, SP, RP, TWP, JUCO, returner, zero-input), and why fixture coverage gets revisited whenever a new category enters scope. Anchor-green means "no known output moved," never "correct."

### Silent-failure rule

The agent volunteers, unprompted, even when nothing failed: anything it skipped, any scope it narrowed, any assumption it made to keep moving, and any place it was surprised but proceeded. Work reported as done means done and verified. A green run with an unreported shortcut inside it is the failure mode this whole document exists to prevent.

---

## 8. Relationship to the plugin stack

| Tool | Role for the agent | Boundary |
|---|---|---|
| Supabase MCP | Schema introspection, RLS advisories, verification `SELECT`s | Staging ref only, read-only, database + docs groups. No writes, ever. |
| Playwright MCP | Own before/after screenshots on UI changes — removes Trevor as the manual verification step | Screenshot verification is *additional to*, never a substitute for, the anchor gate |
| Context7 | Live docs for fast-moving deps (Supabase JS, TanStack Query v5, Tailwind 3→4, Vite) | Advisory only |
| CI (`.github/workflows/ci.yml`) | Vitest + `tsc -p tsconfig.app.json` **delta-vs-base** on every PR | The gate the agent cannot talk its way past. ✅ **EXISTS as of 2026-09-02** — it caught a type error on PR #171 that an error *count* comparison had hidden. The anchor suite still needs adding to it (§2.0). |
| frontend-design | Design work, pinned to `design-system/rstr-iq/MASTER.md` | Installed last, after Phases 4/5 land so the code matches the doc |

---

## 9. Sequencing

1. ✅ **DONE** — Context7 + Playwright MCP install
2. ✅ **DONE** — Supabase MCP. ⚠ Broader than planned: **both** databases connected as `supabase-staging` + `supabase-prod`, read-only at the role level, `database + docs` groups. Prod being connected is what makes staging↔prod drift checks possible.
3. ✅ **DONE** — CI workflow (`.github/workflows/ci.yml`): vitest + `tsc` delta-vs-base
4. Design Phases 4/5/6 on their own branch off staging, **after the dRS thread wraps** — kept pure hex/font consolidation so the diff stays trivially reviewable, and serving as the first PR through the new CI
5. frontend-design install
6. **Anchor suite built (§2.0)** — the actual gate for everything below
7. Agent phase one begins, under §§3–5 with §§6–7 filled in
