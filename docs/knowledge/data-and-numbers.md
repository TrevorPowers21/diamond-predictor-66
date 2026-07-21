# Knowledge — Data & Numbers (the #1 rule)

> Bootstrap draft, 2026-07-20. The **architecture** records are FACT — verified from code by a read-through (file:line cited). The **rule** records are Trevor's JUDGMENT. Trevor: react/correct; facts, confirm the *interpretation*.

The one sentence: **the same stat must show the same value everywhere it appears — including under the same toggle state — or the app is invalidated.** Everything below is how that's achieved and where it's at risk.

---

## The rules (judgment — Trevor confirms)

### same-value-everywhere: The same data point is identical across every surface, including toggles
- **Rule:** A given player's data point — a **computed stat** (WAR, market value, rates, wRC+) *or* an **attribute** (class/grad year, position, status) — must resolve to the **exact same value** on every surface (Dashboard, Player Profile, Team Builder, Target Board, recruiting), for the **same toggle state** (dev-aggressiveness, depth role, SP/RP). Two surfaces showing two values = a hard stop.
- **Why / protecting against:** Nothing invalidates the app faster than the same value reading differently in two places — it destroys trust in *every* value. Not just numbers: a grad/class year showing "2026" one place and "Senior" or "2027" another does the same damage as a divergent WAR. This is *the* existential product rule.
- **Scope:** Every user-facing value — computed stats AND attributes like grad/class year.
- **Origin:** Trevor, standing + design conversation 2026-07-18; broadened to attributes (grad year) 2026-07-20.
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

### one-authoritative-writer-per-row: Each stored row has ONE writer that fills every column it owns — no partial-update scripts
- **Rule:** Every `player_predictions` (or `*_storage`) row is owned by exactly **one** precompute writer, and that writer must populate **every** column the row needs — never leave a field for "some other writer" to fill in. A script that updates only a subset of a row's columns (a *partial-update writer*) is a bug: the columns it skips silently go stale or blank, because the "other writer" it assumes often never runs on that row.
- **Why / protecting against:** This is exactly the eligibility bug. `precompute-returner-pitchers` owned the `(returner, regular)` pitcher row but deliberately skipped `class_transition` ("coach-owned"), assuming another path set it. Nothing did — so the dev factor stayed the stale `"SJ"` default forever. The fix wasn't "one mega script"; it was making the row's one writer authoritative for the whole row (writing the override-safe derived `class_transition`). Note the corollary: a field that's *sometimes* coach-owned (`class_transition` override) is still written by the row's owner — override-safe (preserve the override, derive the rest), never skipped.
- **Scope:** Every precompute/backfill script that upserts into `player_predictions` or a `*_storage` table. Splitting writers by **model type / population** (returner vs transfer, hitter vs pitcher) is fine — splitting *columns of the same row* across writers is not.
- **Origin:** Trevor, 2026-07-21 (from the eligibility `class_transition` fix + the "shouldn't we build it in one run?" question).
- **Status:** confirmed

### no-live-projection-fallback: When a stored projection is missing, show blank — never live-compute a fallback
- **Rule:** Projected/derived values (pitcher rates `p_era…p_hr9`, `pRV+`, `pWAR`, market value; hitter equivalents) are read **only** from the stored precompute row. If no stored row exists for a player, the surface shows **blank (`—`)** — it must **not** fall back to a live client-side computation.
- **Why / protecting against:** We store **2026 actuals + the finished projections**, not the full set of projection inputs (the PR+ component scores in a faithful form, park/role context, dev/class machinery). So a client-side "live fallback" can't reproduce the canonical pipeline number — it produces a **different, wrong** value that then diverges from every stored surface. A blank is honest; a divergent guess silently corrupts trust (`same-value-everywhere`). This is distinct from `stored-first` (which allows a parity-guaranteed live path): for *projections specifically*, the inputs to even attempt parity aren't present, so there is no acceptable live path at all.
- **Scope:** All projected/derived player values whose inputs aren't fully stored client-side. NOT scouting PR+ recomputed from stored component scores (those inputs *are* present) — that narrow recompute-from-stored-scores fallback is allowed.
- **Origin:** Trevor, 2026-07-21 — deciding the ReturningPlayers live-pERA cleanup ("we don't even store the necessary information to compute it live; we only store 2026 actuals and then compute projections"). The dead live block was removed; display was already stored, so this was a rule-compliance cleanup surfaced by the audit, not a user-visible bug.
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

### precompute-writer-topology: which script owns which `player_predictions` slice (verified 2026-07-21)
- **Fact:** The precompute scripts partition `player_predictions` by `(model_type, variant)` and population, keyed on the unique constraint `(player_id, customer_team_id, model_type, variant, season)`:
  - `scripts/precompute-returner-pitchers.ts` → `(returner, regular)`, `customer_team_id = NULL` (global), **pitchers**. Current-season returner projection off the player's own past stats.
  - `scripts/backfill-2027-hitter-returners.ts` (→ `createPredictionsFromMaster`) → `(returner, regular)`, **hitters**.
  - `scripts/precompute-pitchers.ts` → `(transfer, precomputed)`, `customer_team_id = teamId` (**team-scoped**), **pitchers** in portal.
  - `scripts/precompute-transfer-projections.ts` → `(transfer, precomputed)`, team-scoped, **hitters** in portal. Explicitly the hitter mirror of `precompute-pitchers` ("so the two never drift").
  - JUCO backfills (`backfill-juco-*`) write `class_transition: null` on purpose (JUCO zeroes the class dev adjustment).
- **So the two `(transfer, precomputed)` writers are NOT a dual-writer** for normal players — they're split by position (hitter vs pitcher), and a single-position player only ever matches one, so the shared key never collides.
- **Cite:** `precompute-pitchers.ts:1-18,510,569`; `precompute-transfer-projections.ts:1-17,387,450`; `precompute-returner-pitchers.ts:1-9,474,524`.
- **Status:** confirmed (fact)

### twp-sides-are-independent-by-design: TWP stats/values are tracked per side, never blended — the user adds them up
- **DESIGN INTENT (Trevor, 2026-07-21) — this is the record.** For a two-way player, **each statistical side is kept independent** — hitter side and pitcher side each carry their own values, and they are **not** combined into a single blended figure. Presenting per-side and letting the **user add the two sides up** was a deliberate simplification: a merged/blended two-way model was **too confusing**, so they separated each position independently. So "the same TWP shows two independent sides" is *correct behavior*, not a `same-value-everywhere` violation.
- **Why / protecting against:** don't "fix" TWP independence by merging sides — that reintroduces the confusion they deliberately removed. A future agent seeing two values for one TWP must not flag it as an inconsistency.
- **How the storage matches the intent (verified 2026-07-21, payloads read directly):** the transfer row `(player_id, customer_team_id, transfer, precomputed, season)` is co-populated by **two** writers — `precompute-pitchers` (pitcher columns) and `precompute-transfer-projections` (hitter columns) — writing **disjoint side-specific columns** (`precompute-pitchers.ts:508-532`, `precompute-transfer-projections.ts:385-413`). Supabase upsert only overwrites columns present in the payload, so both sides' stats coexist in the one row. This two-writers/one-row pattern is how the independence is realized; it is not a dual-writer bug.
- **How independence is actually stored (verified 2026-07-21):** there are **dedicated per-side columns** `twp_hitter_market_value` / `twp_pitcher_market_value` (migration `20260608120000_twp_market_value_columns.sql`, column-only — **no routing trigger**). The engine derive functions `deriveHitterStored`/`derivePitcherStored` (`predictionEngine.ts:74-97`) route a TWP's market value into the per-side column and **NULL the shared `market_value`** ("so the hitter loop's write doesn't get stomped, and any unconverted read fails loud"). Canonical read helper `src/lib/twpMarketValue.ts` (`pickHitterMarketValue`/`pickPitcherMarketValue`) returns `twp_*_market_value ?? null` for TWPs — **no fallback to `market_value`**. Every read surface (TeamBuilder `2726/2756`, TransferPortal, ReturningPlayers, PlayerProfile/PitcherProfile, PlayerComparison, TargetBoard, GM) uses this routing. So the returner/engine path implements the independence correctly.

#### twp-transfer-market-value-not-routed — CONFIRMED GAP (open bug)
- **The transfer precompute scripts bypass the routing.** `precompute-pitchers` and `precompute-transfer-projections` compute market value inline and write it to the **plain `market_value`** column (`precompute-pitchers.ts:525`, `precompute-transfer-projections.ts:405`) — they do **not** call `deriveHitterStored`/`derivePitcherStored` and never populate `twp_hitter_market_value`/`twp_pitcher_market_value` for TWPs.
- **Failure scenario (verified by tracing, not yet reproduced live):** a TWP flagged in portal gets a team-scoped `(transfer, precomputed)` row with `twp_* = NULL`. `pickPreferredPrediction` ranks that team-scoped row **above** the global returner row (which *does* have the per-side values). The per-side read helper returns `twp_*_market_value ?? null` → **NULL** → the TWP's per-side market value renders **blank** in transfer/portal/TeamBuilder-slot contexts. `sumTwpMarketValues` falls back to `market_value` when both sides are 0, so a "sum" surface shows one side; the per-side surfaces show blank.
- **Fix (own branch, separate from eligibility):** make the two transfer scripts TWP-aware exactly like the engine — when `is_twp`, route the computed value to `twp_pitcher_market_value` (pitcher script) / `twp_hitter_market_value` (hitter script) and set the shared `market_value` to null. This is the same `one-authoritative-writer-per-row` fix pattern (the row's writer must fill the TWP columns it owns). Ideally the scripts import the routing helper rather than re-inlining the null/route logic (`one-canonical-formula`).
- **Blast radius to quantify before fixing:** count `is_twp` AND in-portal players with a team-scoped transfer precompute row.
- **Origin:** Trevor asked to confirm the per-side market value read path (2026-07-21). Confirming it surfaced this gap — my earlier "expected-to-be-fine" was wrong; verify, don't assume.
- **Status:** open — confirmed gap, bounded population; queue behind the eligibility branch. Cross-refs [[real-two-way-player-mode]].

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

**Decision (2026-07-20): fix them — priority.** Trevor: these need closing, not carrying. Order to tackle:
1. **Pitcher rates stored-first** in Team Builder + ReturningPlayers (HIGH — the biggest divergence gap).
2. **transferProjection.ts imports the canonical oWAR** instead of its inline copy.
3. **Phase 4d** — finish stored-first on the TB + Transfer Portal simulator, then un-`.skip` the Rossow ERA test.

And the agent flags any *new* code that adds a fresh live-calc of a stored number.

### Known inconsistency to fix: grad / class year displays
- **Issue (Trevor 2026-07-20):** grad/class year is **displayed inconsistently** across the app — the same player's year doesn't read the same everywhere. This is a `same-value-everywhere` violation on an *attribute*, not a stat.
- **Resolved 2026-07-21** on branch `feature/eligibility-class-consistency` (see `eligibility-and-class.md` for the full model + audit). Root cause: `class_year` is the source of truth but `class_transition` (the projection dev factor, also used for display) was read stale — the pervasive `"SJ"` write-time default. Fix, two parts: (A) `projectedEligibilityClass` now treats `class_year` as authoritative for display; (B) every precompute *writer* derives `class_transition` from `class_year` via the canonical override-safe `resolveClassTransition()` in `src/lib/classTransitionUtils.ts`, so stored dev factors self-correct at the next finalization. Code-only — precomputes not re-run yet (values converge after portal close).
- **Status:** fixed on branch (awaiting finalization run to rewrite stored values); the `one-authoritative-writer-per-row` rule above was extracted from this fix.
