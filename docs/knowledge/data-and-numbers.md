# Knowledge — Data & Numbers (the #1 rule)

> Bootstrap draft, 2026-07-20. The **architecture** records are FACT — verified from code by a read-through (file:line cited). The **rule** records are Trevor's JUDGMENT. Trevor: react/correct; facts, confirm the *interpretation*.

The one sentence: **the same stat must show the same value everywhere it appears — including under the same toggle state — or the app is invalidated.** Everything below is how that's achieved and where it's at risk.

---

## The rules (judgment — Trevor confirms)

### same-number-everywhere: A stat is identical across every surface, including toggles
- **Rule:** A given player's stat (WAR, market value, projection rates, wRC+…) must resolve to the **exact same value** on every surface it appears — Dashboard, Player Profile, Team Builder, Target Board — for the **same toggle state** (dev-aggressiveness, depth role, SP/RP). Two surfaces showing two values = a hard stop.
- **Why / protecting against:** Nothing invalidates the app faster than the same number reading differently in two places — it destroys trust in every number. This is *the* existential product rule.
- **Scope:** Every user-facing number.
- **Origin:** Trevor, standing + design conversation 2026-07-18.
- **Status:** confirmed

### stored-first: Read precomputed/stored values; don't calculate live
- **Rule:** User-facing numbers are **read from the stored precompute** (`player_predictions` + `*_storage` tables), not calculated live in a component. Live calc is the exception, not the default — and every live path must produce the identical value to the stored one.
- **Why / protecting against:** Two code paths computing "the same" number will eventually diverge (a weight changes in one, not the other). One stored source read everywhere can't diverge from itself.
- **Scope:** All displayed numbers.
- **Origin:** Trevor + the stored-first audit (CLAUDE.md).
- **Status:** confirmed

### one-canonical-formula: Each formula lives in exactly one place — never fork it
- **Rule:** Each metric's formula has **one canonical function/file** (see the reference below). Never copy a formula into a component or a second helper. If you need it elsewhere, import it.
- **Why / protecting against:** A forked formula is the #1 cause of divergent numbers. It's exactly why `transferProjection.ts` having its own inline oWAR copy is a standing risk (only caught because a parity test back-calculates it).
- **Scope:** All projection/rating/market formulas.
- **Origin:** Trevor + CLAUDE.md refactoring policy.
- **Status:** confirmed

### overlays-mirror-precompute: Toggle overlays use the SAME math as the precompute engine
- **Rule:** The dev-agg / depth-role / SP-RP toggles are applied as **overlays on read** (the stored value is the single source of truth; the overlay is session-only, never rewritten to storage). Those overlays MUST call the same formula functions the precompute engine used — so a toggled value equals what a precompute *with that toggle* would have produced.
- **Why / protecting against:** If the on-read overlay math drifts from the precompute math, the toggled number is wrong and inconsistent between surfaces that overlay vs surfaces that read raw.
- **Scope:** dev_aggressiveness, hitter/pitcher depth role, pitcher SP/RP role.
- **Origin:** Design conversation 2026-07-18 + verified architecture.
- **Status:** confirmed

### change-a-weight-reprecompute: Changing an equation weight means re-precompute + update every copy
- **Rule:** If you change any equation weight/constant (wRC+ weights, pRV+ composite, projection blend, $/WAR, tier/position multipliers), you must (1) update the canonical formula, (2) re-run the precompute so stored values refresh, and (3) confirm the parity test still passes. Stored values silently go **stale** the moment a weight changes without a re-precompute.
- **Why / protecting against:** Stored numbers computed under old weights, shown next to live numbers under new weights — the exact divergence the whole system exists to prevent.
- **Scope:** Any change to a formula constant.
- **Origin:** Verified architecture + Trevor's rule.
- **Status:** confirmed

---

## The architecture (fact — verified from code 2026-07-20)

### precompute-is-source-of-truth: One engine writes stored values once; reads overlay session state
- **Fact:** The precompute engine (`scripts/precompute-*.ts` + `predictionEngine.ts` `deriveHitterStored`/`derivePitcherStored`) writes every stored number **once per recalc** into `player_predictions` (rates, `o_war`, `p_war`, `market_value`, TWP splits) and the `*_storage` tables. Read paths read those columns and apply session overlays live. One write path, many read paths.
- **Cite:** `src/lib/predictionEngine.ts:60-100`; `player_predictions` columns per the map.
- **Status:** confirmed (fact)

### team-scoped-precedence: Team-precomputed beats global; same user+team → same numbers
- **Fact:** `pickPreferredPrediction` / `dedupePreferredPerPlayer` (`src/lib/teamScopedPredictions.ts:34-77`) pick the row: **team-scoped precomputed** (`customer_team_id = active team`, `variant='precomputed'`) first, else **global regular** (`customer_team_id IS NULL`, `variant='regular'`). So a coach sees *their* team's precompute (park factors etc.); cross-team staff see the global consensus. Same user in the same team context always resolves the same row.
- **Cite:** `src/lib/teamScopedPredictions.ts:20-77`; used in `useGmTargetBoard.ts:64`, `useTeamBuilderData.ts:153`.
- **Status:** confirmed (fact)

### parity-tests-guard-constants: `storedVsLive.test.ts` pins the formula constants across copies
- **Fact:** `src/lib/storedVsLive.test.ts` asserts the formula constants match across every location: oWAR (war.ts vs playerCalcs.ts vs the transferProjection.ts inline copy), wRC+ weights (savant vs predictionEngine), pWAR constants, pitching blend weight. It has **`.skip`ped regression placeholders** (Rossow ERA / TB Compare) awaiting the stored-first read path (CLAUDE.md phase 4d). Run `npm test` after any formula touch.
- **Cite:** `src/lib/storedVsLive.test.ts:38-197`.
- **Status:** confirmed (fact)

### formula-locations: canonical source per stat (reference)
- **Fact (reference map):**
  - **wRC+** → `computeWrcPlus()` `src/savant/lib/wrcPlus.ts:36`
  - **oWAR (hitter)** → `computeOWar()` `src/savant/lib/war.ts:7`; frontend alias `computeOWarFromWrcPlus()` `src/lib/playerCalcs.ts:15`
  - **pWAR (pitcher)** → `computePitcherWar()` `src/lib/depthRoles.ts:151`
  - **pRV+** → `computePitchingPowerRatings()` `src/lib/powerRatings.ts:270`
  - **pitcher rates (era/fip/whip/k9/bb9/hr9)** → `projectPitchingRate()` `src/lib/pitcherProjection.ts:125`
  - **market value (hitter)** → `computeHitterMarketValue()` `src/lib/depthRoles.ts:270`
  - **market value (pitcher)** → `computePitcherMarketValue()` `src/lib/depthRoles.ts:200`
  - **Stuff+** = scouting input (baseline mean 100, sd 3.968), not a formula.
- **Status:** confirmed (fact) — keep current if files move.

---

## Where live calc still happens (the honest risk map — fact, and a decision for Trevor)

The stored-first pattern is ~90% enforced. Remaining live-calc spots (divergence risk):

- **HIGH — pitcher rates in Team Builder + ReturningPlayers.** `useTeamBuilderSimulation.ts:1250-1282` and `ReturningPlayers.tsx:2577-2582` **live-compute** `p_era…p_hr9` via `computePitcherProjection()` on every change instead of reading storage + overlay. It's *currently* consistent only because it's the same function — but a weight change without immediate re-precompute makes stored ≠ live. This is the biggest open gap.
- **MEDIUM — transfer oWAR inline copy.** `transferProjection.ts:120-126` re-implements the oWAR formula instead of importing it. Only safe because the parity test back-calculates it. Violates `one-canonical-formula`.
- **MEDIUM — Phase 4d incomplete.** Team Builder + Transfer Portal simulator aren't fully stored-first (the `.skip`ped Rossow ERA test). CLAUDE.md tracks this.

**Decision for Trevor:** is closing these (esp. the HIGH pitcher-rate one) a **priority the agent should push on**, or a known-acceptable state we consciously carry for now? Either way the agent should *flag* any new code that adds a fresh live-calc of a stored number.
