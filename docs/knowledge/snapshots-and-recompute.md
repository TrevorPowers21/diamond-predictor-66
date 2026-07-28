# Knowledge — Snapshots & the Full Recompute

> Bootstrap draft, 2026-07-28. Extracted from the `feature/eligibility-class-consistency` branch (pERA → pitcher WAR → market → Phase B → notes-recipe → active-build → TWP two-row → whole-pRV+/depth-role consistency pass) and the prod-promotion data-ops that followed. **Facts** are verified from code/DB (cite given); the **process** records are Trevor's judgment on how the full recompute (#5) must run. Trevor: react/correct.
>
> This is the domain the agent must load before touching `player_predictions`, the snapshot columns, or running any recompute — it's where this session's hardest-won bugs live. Cross-refs [[data-and-numbers]] (the #1 rule) and [[eligibility-and-class]] (class_transition).

---

## The snapshot data model (fact — verified from code this session)

A player's stored projection exists at **three layers**. Getting the relationship wrong is what caused most of this session's "drift" scares.

### neutral-is-the-anti-drift-anchor: `neutral_snapshot` is the immutable dev-agg=0 baseline; the displayed snapshots are derived from it
- **Fact:** For a Team Builder / Target Board player there are three stored payloads:
  - **`neutral_snapshot`** — the projection with **dev_aggressiveness = 0** and no session toggles. It is the **immutable anchor**: it does not change when a coach moves toggles. Its job is to be the thing everything else is measured against, so we can always tell "did this value move because of a legitimate toggle, or because the data silently drifted?"
  - **`player_snapshot`** (returner / `team_build_players`) and **`transfer_snapshot`** (portal target) — the **displayed** payloads. Each is `projectEffective(neutral_snapshot, production_notes)` — the neutral run forward through the saved toggle recipe.
- **Rule that falls out of it:** a displayed snapshot is **never** authored directly. It is always `f(neutral, notes)`. If `production_notes` is null/empty, `player_snapshot` **must equal** `neutral_snapshot` exactly. Any script that writes a displayed snapshot without going through `projectEffective` is a bug.
- **Why / protecting against:** without an immutable anchor, you cannot distinguish a real toggle effect from data corruption — every recompute becomes a guess about whether a changed number is "supposed" to change. The neutral makes drift *provable*.
- **Cite:** `projectEffective` (the snapshot projector); `heal-stale-snapshots.ts` re-derives displayed = f(neutral, notes).
- **Status:** draft (fact + interpretation).

### production-notes-are-sacred: the toggle recipe is NEVER rewritten by a data op
- **Rule:** `production_notes` (the saved toggle recipe: `depthRole`, `devAggressiveness`, `classTransition`, SP/RP role) is **coach-owned state**. Data operations — recompute, cascade, heal, backfill — may READ it to re-derive a snapshot, but must **never write, reset, or normalize it**. A recompute changes the *inputs and derived values*; it must leave every toggle exactly as the coach set it.
- **Why / protecting against:** the toggles ARE the coach's work product. A recompute that "cleaned up" notes would silently throw away a coach's depth-role/dev-agg decisions and change what they see, with no way to recover it. This is the single most important invariant of any recompute: **the numbers may move, the toggles may not.** (Trevor's standing instruction, repeated: "for any players with any toggle changes those need to stay the same through this process.")
- **Scope:** every script that touches `player_predictions`, `neutral_snapshot`, `player_snapshot`, `transfer_snapshot`, or `team_build_players`. Reading notes = fine; writing notes = forbidden unless the coach did it in the UI.
- **Origin:** Trevor, standing through the eligibility promotion; reaffirmed for the #5 full recompute ("carries those values into both the transfer and player snapshot when needed while not changing any of the toggles").
- **Status:** draft (Trevor's rule — confirm wording).

### role-transition-is-not-drift: a snapshot legitimately differing from its neutral is CORRECT when the notes encode a role change
- **Rule:** When `production_notes` encodes an **SP↔RP role transition** (or a depth-role/dev-agg move), `projectEffective` legitimately produces a value **different from `neutral_snapshot`** — rate regression toward the new role + a rebuilt pRV+. That difference is **the toggle working**, not drift. A naive "snapshot ≠ neutral → reset it" check is WRONG and will destroy real coach state.
- **Why / protecting against:** this session a re-anchor script (`reanchor-drifted-targets.ts`) treated 15 targets as "drifted" and reset them to neutral — **7 were legitimate role transitions** (weekend_starter, `⇄` marker) and got clobbered. Restored via `heal --apply`. The lesson: the diff between snapshot and neutral is **expected and meaningful** whenever notes are non-empty; only a snapshot that diverges from `f(neutral, notes)` is actual drift.
- **Scope:** any drift/consistency check on snapshots.
- **Origin:** the re-anchor regression, 2026-07-27; Trevor: "neutral is the anti-drift anchor," heal is the authority.
- **Status:** draft.

### heal-is-the-snapshot-authority: re-sync snapshots with `heal-stale-snapshots.ts`, not a hand diff
- **Rule:** The **only** sanctioned way to re-sync displayed snapshots after a prediction-layer change is `heal-stale-snapshots.ts` (`--all --market`), which recomputes each displayed snapshot as `projectEffective(neutral, production_notes)` and rewrites the neutral where a prediction rate changed. `reanchor-drifted-targets.ts` was **DELETED** — its `differs()` naive diff false-flagged role transitions as drift. Do not resurrect a "reset to neutral" approach.
- **Why / protecting against:** heal respects `role-transition-is-not-drift` and `production-notes-are-sacred` by construction (it re-derives *through* the notes); a hand diff does not. After heal, the correct drift metric is **snapshot vs `f(neutral, notes)` = 0**, not snapshot vs neutral.
- **Cite:** `scripts/heal-stale-snapshots.ts`; deleted `scripts/reanchor-drifted-targets.ts`.
- **Origin:** the re-anchor regression fix, 2026-07-27.
- **Status:** draft.

---

## Derived-number conventions the recompute MUST honor (fact — verified from code)

These are the rules that keep stored == live. Each was a real inconsistency fixed this session; the agent should flag any code or op that violates them.

### whole-prv-wrc-rounded-at-source: pRV+ / wRC+ are rounded to whole at the SOURCE, and WAR runs off the integer
- **Fact / rule:** `pRvPlus` and `pWrcPlus` are `Math.round`ed **where they are produced** — `pitcherProjection.ts:473`, `transferPitcherProjection.ts:413`, `predictionEngine.ts:558` (`Math.round((pWrc/ncaaWrc)*100)`). Everything downstream (displayed rating, pWAR, oWAR, market) then runs off that **same integer**. `computePitcherWar`/`computeHitterOWar` do **NOT** round internally — they take the already-whole rating. So: round once, at the source; never store an unrounded rv+/wrc+ and never re-round downstream.
- **Why / protecting against:** if WAR is computed off an *unrounded* rv+ but the UI displays the *rounded* rv+, the displayed rating and the WAR/market disagree — the exact `same-value-everywhere` violation. This session prod had `p_war` baked off **unrounded** rv+ → **35,870 p_war↔market inconsistencies**. Root cause was a recompute that rounded for display but fed WAR the raw value. The convention (round at source, WAR off the integer) is what the code does; a recompute must replicate it exactly.
- **Cite:** `pitcherProjection.ts:473`, `transferPitcherProjection.ts:413`, `predictionEngine.ts:558`; `computePitcherWar` in `depthRoles.ts` (no internal round).
- **Origin:** Trevor: "I literally made it the same way" — code IS aligned; the drift was a prod recompute that broke the convention. Fixed by `recompute-derived-cascade.ts` (rounds rv+/wrc+ first, WAR off the integer).
- **Status:** draft (fact).

### projected-ip-from-depth-role: projected IP / pWAR / market derive from the pitcher DEPTH ROLE, not the coarse SP/RP/SM role
- **Fact / rule:** A pitcher's `projected_ip` = `pitcherExpectedIp(derivePitcherDepthRole(realIP, role))` — the **depth** role (weekend_starter 85, weekday 50, swing 30, workhorse 50, high-lev 33, mid 20, low 12, specialist 6), NOT the coarse `pwar_ip_sp` 85 / `pwar_ip_rp` 35. Coarse == depth ONLY for the prototypical weekend starter. Critically, **`derivePitcherDepthRole` sends an SP with real IP < 10 to `specialist_reliever` (6 IP)**, not swing_starter. The canonical writer is `derivePitcherStored()` (`predictionEngine.ts:46`).
- **Why / protecting against:** coarse-role IP inflates pWAR/IP/market for everyone who isn't a full weekend starter. This session, **1,293 IP<10 pitchers** were stored as `swing_starter` (30 IP) while the code derives `specialist_reliever` (6 IP) — a stored-vs-live drift that overstated their value. Fixed at source (`fix-stale-pitcher-depth.ts`) + cascaded. See `docs/PITCHER_IP_DEPTH_ROLE_AUDIT.md` for the full blast radius (also a returner-global batch of ~4,697 stale-IP rows).
- **Cite:** `predictionEngine.ts:46` (`derivePitcherStored`); `depthRoles.ts` (`derivePitcherDepthRole`, `pitcherExpectedIp`); memory `project_pitcher_role_systemic_fix`.
- **Status:** draft (fact).

### market-owned-by-primary-position-side: the shared `market_value` belongs to the player's PRIMARY side by position
- **Fact / rule:** `player_predictions.market_value` is a **single shared column**. For a non-TWP player it must receive the market of the player's **primary side by position** only — pitcher if `position ∈ {SP,RP,CL,P,LHP,RHP}`, else hitter. A data op that writes the pitcher market into a position player's `market_value` (or vice-versa) **clobbers** their real market. TWP rows route to `twp_pitcher_market_value` / `twp_hitter_market_value` instead and NULL the shared column.
- **Why / protecting against:** ~79 position players (PA≥30) carry sub-threshold pitching (IP<5) on one row. Below the TWP threshold (PA≥30 AND IP≥5) they are **hitters** — their `market_value` is the hitter market. This session `fix-stale-pitcher-depth.ts` originally wrote the pitcher market to `market_value` unconditionally and **clobbered 3 position players' hitter market**. Fixed with the position-ownership guard: `else if (posIsPitcher(id) || !r.hitter_depth_role) patch.market_value = …`. Both the app's hitter/pitcher split and `recompute-derived-cascade.ts` are now position-gated. **Durable root fix (separate rate re-run):** gate the pitcher-side write in `createPredictionsFromMaster` on IP≥5 so sub-threshold pitching never merges into a hitter row.
- **Cite:** `recompute-derived-cascade.ts:70-92`, `fix-stale-pitcher-depth.ts:50-54`; `recomputeTwpStatus.ts` (PA≥30 AND IP≥5). See `docs/PITCHER_IP_DEPTH_ROLE_AUDIT.md` "Two-way bleed — SEALED."
- **Status:** draft (fact). Cross-ref [[data-and-numbers]] `twp-transfer-market-value-not-routed`.

---

## How to verify a recompute (fact — the method that actually catches bugs)

### authoritative-check-runs-the-real-code, not stored-against-itself
- **Rule:** The trustworthy stored-vs-live check feeds the **stored inputs through the real engine functions** (`derivePitcherStored`, `derivePitcherDepthRole(PM IP)`, the hitter equivalent) and diffs the result against the stored derived values. An **internal-consistency** check (stored depth vs stored IP vs stored WAR, all against each other) is weaker — it passes even when the whole row was written by stale code, because the stale values are self-consistent.
- **Why / protecting against:** the 1,293 stale-depth pitchers were **internally consistent** (their swing_starter depth, 30 IP, and pWAR all agreed with each other) — an internal check reported 0. Only re-deriving from the real IP via `derivePitcherStored` exposed that the *depth role itself* was wrong. Verify against the code, not against the row's own other columns.
- **Cite:** `fix-stale-pitcher-depth.ts` (re-derives via `derivePitcherStored(PM IP)`).
- **Origin:** this session's audit method.
- **Status:** draft.

### recompute-derived-cascade-is-the-prediction-layer-op: one canonical script, validate on staging first
- **Fact:** `scripts/recompute-derived-cascade.ts` is THE reusable prediction-layer prod op. It recomputes the derived cascade **from existing rates** (rates/rv+/wrc+ untouched) in the sanctioned order: **round pRV+/wRC+ → projected_ip(depth) → pWAR/oWAR → market (LAST)**. It does **not** touch any rate, depth role, `class_transition`, `production_notes`, or scouting score. Conference resolution mirrors staging (transfer → customer destination conf; global → `players.team_id → Teams Table.conference`). Idempotent, 25-wide concurrent, position-ownership guarded.
- **Rule (validation method — no more guessing):** **dry-run on staging first** — it must report ~0 changes (staging is the canonical reference). Only then prod dry-run → apply → re-dry-run until it converges to ~0. Market is always derived from the **final** stored WAR, so WAR and market stay consistent.
- **Cite:** `scripts/recompute-derived-cascade.ts`; `docs/PITCHER_IP_DEPTH_ROLE_AUDIT.md` "THE reusable prediction-layer prod op."
- **Status:** draft (fact).

---

## The full recompute (#5) — the process (Trevor's judgment; DRAFT for correction)

> This is the sequence for the pending "run a full recompute on the most up-to-date data" work. Recorded now so the eligibility learnings aren't lost; **not yet executed** and **pending Trevor's confirmation of the order + the small-sample rule.** #5 comes AFTER #4 (the full-season pitch-log export with defensive positioning + baserunning, which finalizes hitter market values).

### full-recompute-order: rates first, then the derived cascade, then snapshots — toggles untouched throughout
- **Draft process:**
  1. **Refresh the source data** — current-season actuals (Hitter/Pitching Master) up to date first. A recompute is only as good as its inputs.
  2. **Small-sample fallback to last season** — for the **program-specific precompute**, players below the sample floor blend/fall back to their prior season rather than trusting a tiny current-season line. Thresholds (memory `project_small_sample_pullback`): **< 75 AB / < 25 IP → blend prior year; < 15 AB / < 5 IP → skip current, use prior.** This is a *rate*-layer decision (it changes the projection inputs), so it happens in the precompute, before the cascade.
  3. **Re-run the precompute writers** (per `precompute-writer-topology` in [[data-and-numbers]]) so stored rates + depth + `class_transition` refresh — **override-safe** (preserve coach overrides, derive the rest).
  4. **Run the derived cascade** (`recompute-derived-cascade.ts`) to bring rv+/wrc+ rounding, projected_ip(depth), WAR, and market into exact agreement with the refreshed rates.
  5. **Carry into the snapshots** — re-derive `neutral_snapshot` from the refreshed prediction, then `heal-stale-snapshots.ts --all --market` re-derives `player_snapshot`/`transfer_snapshot` = `f(neutral, production_notes)`. The toggles are read, never written (`production-notes-are-sacred`).
  6. **Verify** — `verify-all --prod` + the depth-IP prediction check + the drift metric (snapshot vs `f(neutral, notes)` = 0), and staging-first dry-run on every write.
- **The invariant across all of it:** *the numbers may move (new data), the toggles may not.* Values flow into transfer AND player snapshots "when needed" without changing any dev-agg / depth-role / SP-RP / class-transition toggle.
- **Why / protecting against:** doing the cascade before the rates, or letting a writer skip a column, or resetting notes — each reintroduces one of this session's bugs (stale depth, unrounded-rv+ WAR, clobbered coach state). The order encodes the dependency chain: data → rates → derived → snapshots.
- **Origin:** Trevor's #5 spec (2026-07-21) + the eligibility promotion learnings.
- **Status:** draft — **confirm order + small-sample thresholds before running.** Sequenced after #4.
