# MARKET VALUE — reverse-engineering the Program Tier Multiplier (2026-08-21)

Trevor's directive: recalibrate market value by REVERSE-ENGINEERING the PTM from real roster-spend
knowledge, not the coach-claimed "$40k/win." Keep the base `$25,000/WAR`; PTM carries the conference
spend differences. Biggest change: **SEC PTM must go UP** (1.5 is far too low).

## Current equation (unchanged base)
- **Hitter:** `market = total_hitter_war × $25,000 × PTM × PVM` (floored $0)
- **Pitcher:** `market = p_war × $25,000 × PTM` (no PVM)
- **PTM today:** SEC 1.5 · ACC/Big12 1.2 · BigTen 1.0 · strongMid 0.8 · low-major 0.5 · JUCO 0.35
- **PVM (hitter):** C/SS/CF 1.3 · 2B/3B/corner-OF 1.1 · 1B/DH/UT 1.0 · bench 0.8

## The problem Trevor identified
- SEC coaches claim **$40k/win**. Current SEC effective $/WAR = `$25k × 1.5 = $37.5k` ≈ the claim. So the
  model matches the CLAIM.
- But $40k/win flat is not how it works: $40k on the AVERAGE SEC player is wrong; $40k×(max 6.68 WAR) is
  closer to fair for the top guy. And critically — **the top of the SEC spends ~$5M on top-end rosters**,
  which does NOT come out to $40k/win. → the effective top-end $/win is much higher than $40k.

## Reverse-engineering method
`market_roster_total = $25,000 × PTM × Σ(WAR_i × PVM_i)` over the roster. Approximating `Σ(WAR×PVM) ≈ roster_total_WAR`
(avg PVM ≈ 1.05; refine with Σ of POSITIVE projected WAR × PVM later):
> **PTM_conf = target_top_spend / ($25,000 × top_roster_WAR_conf)**

## WAR reference data (staging, TODAY'S run 2026-08-21 — 96.6% fresh, post faced-competition + stored HTP)
**Per-conference TOP roster total WAR** (`team_season_stats.total_war_total`, descriptive 2026, NET):
| Conf | TOP | 2nd | 3rd | median | top team |
|---|---|---|---|---|---|
| SEC | **44.2** | 37.5 | 36.4 | 27.6 | Georgia |
| ACC | **46.1** | 38.0 | 30.1 | 23.6 | Georgia Tech |
| Big 12 | **32.9** | 32.0 | 28.3 | 20.3 | West Virginia |
| Big Ten | **36.2** | 31.9 | 30.8 | 19.1 | UCLA |
| Sun Belt | 29.7 | 28.0 | 22.6 | 20.5 | Southern Miss |
| Big West | 25.5 | 25.4 | 17.6 | 15.3 | UCSB |
| Mountain West | 22.0 | 20.0 | 19.6 | 16.7 | San Diego St |

**Starter WAR percentiles** (per-team projection pool):
- Hitter starters (cornerstone+everyday, n≈51k): total_hitter_war p50 0.96, p90 1.74, p95 2.01, p99 2.75, max 6.86.
- Pitcher starters (weekend+weekday+swing, n≈21k): p_war p50 0.81, p90 2.43, p95 2.78, max 4.13.
- Weekend aces (n≈6.4k): p_war p50 2.03, p90 2.98, max 4.13.

## Trevor's target spends (top-end roster per tier)
- **SEC: $3M–$5M** (top-end). ACC/Big12: **~$1M**. Big Ten: **~$750k**. Work DOWN from there for the rest.

## First-pass reverse-engineered PTMs (PENDING Trevor's confirmation)
Using each conference's TOP roster WAR + target spend:
| Conf | top WAR | target | eff $/win | **PTM** | (current) |
|---|---|---|---|---|---|
| SEC | 44.2 | $4M (mid) | $90.5k | **~3.6** (2.7 @ $3M → 4.5 @ $5M) | 1.5 |
| ACC | 46.1 | $1M | $21.7k | **~0.87** | 1.2 |
| Big 12 | 32.9 | $1M | $30.4k | **~1.22** | 1.2 |
| Big Ten | 36.2 | $750k | $20.7k | **~0.83** | 1.0 |

## OPEN MODELING CHOICES (need Trevor)
1. **SEC target** — $3M / $4M / $5M? (sets PTM 2.7 / 3.6 / 4.5.)
2. **Own-WAR vs common-reference anchor.** Anchoring each conf to ITS OWN top-roster WAR makes equal-$
   conferences get DIFFERENT PTMs (ACC 0.87 < Big12 1.22 because ACC's top team has more WAR). Alternative:
   anchor all to a common reference roster WAR (~40) so PTM is directly proportional to target $. Which?
   ⚠ Note the raw own-WAR result gives ACC (0.87) + BigTen (0.83) LOWER than today — because their top
   teams are talent-rich but (per Trevor) spend far less than SEC. That's internally consistent with the
   $ ratios ($1M/$5M = 0.2 → SEC 4.5 × 0.2 ≈ 0.9) but inverts the current tier order — confirm intended.
3. **Net vs positive-WAR roster sum.** total_war_total is NET (includes negative contributors); market floors
   negatives at $0, so Σ(positive WAR × PVM) for the paid roster is HIGHER → would LOWER the required PTM.
   Refine by summing the actual top roster's positive projected WAR before locking numbers.
4. **Base $/WAR** stays $25k (PTM carries the spread) — confirm.
5. **Curve shape** — still linear per-player. Decide separately whether elite players also need a convex
   premium ON TOP of the tier multiplier (the WAR tail is thin: starter p50 ~1.0, max ~6.9).

## ★ TREVOR'S DECISIONS (2026-08-21) — P4 PTMs LOCKED, anchored on $/win directly
Trevor set the P4 tier by judgment (data-informed for SEC, guess for others where feedback is thin),
anchoring on **$/win** rather than the per-conf roster-WAR solve (bypasses open-choice #2/#3):
- **SEC = 4.0** ("~$100k per win is more accurate"; $3M "safe" but the top feels closer to $4–5M; 4.0 = $100k/win = ~$4.4M top roster, avoids going too high on limited top-roster visibility).
- **ACC = 1.5** (up from 1.2; top ACC roster likely ~$2–3M but LOW feedback → conservative bump, not the raw-solve 0.87).
- **Big 12 = 1.2** (unchanged).
- **Big Ten = 1.0** (unchanged).
- strongMid / low-major / JUCO: "work down from there" — proposed UNCHANGED (0.8 / 0.5 / 0.35) since Big Ten stays 1.0; confirm.

Base `$25k/WAR` stays; PTM carries the spread. Effective $/win: SEC $100k · ACC $37.5k · Big12 $30k · BigTen $25k.

### Resulting PTM ladder (proposed final)
| SEC | ACC | Big12 | BigTen | strongMid | low-major | JUCO |
|---|---|---|---|---|---|---|
| **4.0** | **1.5** | 1.2 | 1.0 | 0.8 | 0.5 | 0.35 |

### OPEN (still Trevor's call): the flat-PTM median-inflation tension → convex curve?
Flat PTM 4.0 raises EVERY SEC player 4×, so the MEDIAN SEC starter also jumps — which is the exact thing
Trevor flagged ("$40k for the average isn't how it works"). Per-player at PTM 4.0 (SS, PVM 1.3):
median starter (0.96 WAR) **$125k**, p95 (2.01) **$261k**, p99 (2.75) **$358k**, max (6.86) **$892k**;
weekend ace median (2.03) **$203k**, max (4.13) **$413k**. If the MEDIAN feels too high, the fix is a
CONVEX per-player curve (compress the middle, stretch the elite) ON TOP of the tier PTM — decide next.

## ★ CONVEX REJECTED — model stays LINEAR (Trevor 2026-08-21)
"Curve becomes too complex and I don't love it even if that is how the market reacts sometimes." → NO
per-player convex curve. Keep `market = WAR × $25k × PTM × PVM`, flat. Accepted consequence: the median
SEC starter lands ~$125k — defensible because we anchor on STARTERS (SEC pays starters) and low-WAR
bench/utility already floor near $0 via `max(0, …)`, so the whole-roster "average" isn't over-paid.

## ✅ FINAL MODEL (LOCKED 2026-08-21) — linear, base $25k/WAR
| SEC | ACC | Big12 | BigTen | strongMid | low-major | JUCO |
|---|---|---|---|---|---|---|
| **4.0** | **1.5** | 1.2 (unch) | 1.0 (unch) | 0.8 (unch) | 0.5 (unch) | 0.35 (unch) |
- ONLY changes vs today: **SEC 1.5 → 4.0**, **ACC 1.2 → 1.5**. Everything else (Big12/BigTen/mid/low/JUCO, base $25k, PVM, linear) UNCHANGED.
- PVM unchanged: C/SS/CF 1.3 · 2B/3B/corner-OF 1.1 · 1B/DH/UT 1.0 · bench 0.8.

## ★★★ FULL MARKET-VALUE AUDIT (2026-08-21, 3 code agents + DB) — READ BEFORE CHANGING
### Two SEPARATE PTM systems (hitter ≠ pitcher storage)
- **HITTER PTM = code const** `DEFAULT_NIL_TIER_MULTIPLIERS` (nilProgramSpecific.ts) — NOT model_config. `computeHitterMarketValue` never receives an `opts.tiers` override → always the const.
- **PITCHER PTM = DB `model_config.market_tier_*`** (via `readPitchingWeights`; code `DEFAULT_PITCHING_WEIGHTS.market_tier_*` is only the fallback).
- ⇒ a coherent change edits BOTH: hitter code const (canonical + edge-fn copy) AND pitcher model_config row (+ 2 code fallbacks).

### ⚠️ CRITICAL INCONSISTENCY — hitter market rides DIFFERENT WAR by path
- **Edge fn** `process-precompute-jobs` (new-team WRITE): hitter market = **total_hitter_war** (o+d+bsr) (:1204). Matches the STEP-7 intent.
- **Everything else** — `predictionEngine.ts:79` (shared batch WRITE), JUCO returner, AND all LIVE display (`PlayerProfile:985`, `useTeamBuilderSimulation:695`): hitter market = **o_war (offense only)**.
- ⇒ stored market (batch = o_war) and the new-team path (total) DISAGREE, and live display recomputes on o_war. **DECISION NEEDED: reconcile to total_hitter_war (intent) or o_war — before/with the PTM re-price.** Pitcher market = **p_war** in ALL paths (consistent).

### Change surface (edit in lockstep or paths diverge)
1. `src/lib/nilProgramSpecific.ts` — `DEFAULT_NIL_TIER_MULTIPLIERS` sec 1.5→4.0; ADD `acc:1.5`; branch ACC before big12 in the resolver (:38-44). Big12 stays `p4:1.2`.
2. `src/lib/pitchingEquations.ts` — `market_tier_sec` 1.5→4.0; ADD `market_tier_acc` (type :62 + default :254 + localStorage merge :390).
3. **4 pitcher tier-assembly sites** add `acc`: `depthRoles.ts:253`, `pitcherProjection.ts:484`, `transferPitcherProjection.ts:423`, `useTeamBuilderSimulation.ts:1125`.
4. **`supabase/functions/process-precompute-jobs/index.ts` — 4 DUPLICATED blocks:** pitcher default (:536), pitcher resolver (:630, matches `"big 12"` w/ space), pitcher assembly (:675); hitter default `NIL_TIER_MULTIPLIERS` (:835, **missing juco key**), hitter resolver (:843). All need sec→4.0 + acc split.
5. **model_config** — pitcher tiers currently NOT seeded there (only `nil_base_per_owar`=25000). To drive pitchers via model_config on prod, INSERT `market_tier_sec/acc/…` rows (edge fn overlays them). Else the hardcoded :536 default serves. DECIDE: store in model_config (preferred, edge-fn reads it) or rely on code default.
6. `scripts/fix-pitcher-market-pvf.ts:26` (derived, only if re-run); `nilProgramSpecific.test.ts:70` ACC→p4 assertion MUST update; `NilValuations.tsx:281` label cosmetic.
7. **Dormant 4th copy (hygiene, not live):** `platformDefaults.ts:20` + `platform_config` rows — unwired (`usePlatformConfig` never called). Update to avoid a future landmine.

### Gotchas / dead controls
- **AdminDashboard "nil_tiers" editor** (`:875,:1887`) writes `model_config.nil_tier_*` but NO hitter path reads it → DEAD control for the market calc.
- **GM marketability** (`gm/lib/marketability.ts`) = a 0–100 score with its own 1–5 hand-set programTier → UNRELATED to NIL PTM. Unaffected.
- Pitcher `canShowPitchingMarketValue` nulls non-Independent... (Independent → null market except faced Oregon State).

### Stored columns + refresh cascade (DB audit)
- Computed-market columns: `player_predictions.{market_value, twp_hitter_market_value, twp_pitcher_market_value}` + 4 snapshot jsonb (`team_build_players.player_snapshot/neutral_snapshot`, `target_board.transfer_snapshot/neutral_snapshot`) — all BAKE market.
- `team_market_pay_log` / `nil_valuations` = coach-entered, NOT PTM-derived. `team_season_stats`/`team_war_snapshots`/GM finance = no computed market.
- **Snapshots BAKE market → refresh REQUIRED** after re-price: `resync-build-snapshot-markets.ts` + `resync-target-snapshots.ts` (or `heal-stale-snapshots.ts --market`) — re-bake market from each snapshot's OWN stored WAR (WAR untouched, fast).
- **NIL:** GM roster `allocateNil` uses RAW WAR + budget → does NOT move with PTM. `calcPlayerScore = WAR × PTM` DOES → NilValuations page + TeamBuilder score column shift.
- Reader bug (pre-existing, not blocking): `HighFollowList.tsx:343` raw `market_value`, no TWP fallback.

## ★★★ TREVOR'S DECISIONS ON THE AUDIT (2026-08-21) — this is now a CONSISTENCY REFACTOR
1. **ONE PTM source, hitter == pitcher.** "Can't have separate functions." Unify to a SINGLE source of truth
   read by BOTH sides + batch + edge fn, consistent with the existing model_config pattern (transfer weights,
   nil_base_per_owar already live there). Kill the hitter code-const-vs-pitcher-model_config split.
2. **Market STORED for every projection row — NO live compute, NO fallback anywhere.** "The run job's only job is
   calculate + store; once stored it's stable." ⇒ ALSO repoint every LIVE-display market compute (PlayerProfile:985,
   useTeamBuilderSimulation:695, PitcherProfile:1426) to READ stored `market_value` (like the HTP GAP-4 fix).
3. **Hitter market rides `total_hitter_war` EVERYWHERE** (not o_war). The o_war confusion = JUCO only has o_war;
   for JUCO total_hitter_war = o_war (d/bsr = 0), so keying off total naturally covers it.
4. **Refresh ALL snapshots as part of the data run** — necessary + accepted; wire it into the run, don't leave manual.
5. **Dead code:** verify truly-dead → clean; if it relates to the consistency point (the tier config), WIRE it to the
   single source instead of deleting. (AdminDashboard nil_tier_* editor + platformDefaults/platform_config.)
6. Values LOCKED: SEC 4.0 · ACC 1.5 · Big12 1.2 · BigTen 1.0 · strongMid 0.8 · low 0.5 · JUCO 0.35 · base $25k. PVM unchanged.

## ★★★ UNIFIED REFACTOR DESIGN (LOCKED 2026-08-21) — the plan to implement
### The mess (grounded): FOUR tier definitions, only 2 live
| Definition | Read by | Status |
|---|---|---|
| `DEFAULT_NIL_TIER_MULTIPLIERS` (nilProgramSpecific.ts const) | hitter calc | LIVE |
| `market_tier_*` (pitchingEquations.ts code defaults) | pitcher calc | LIVE |
| `model_config.nil_tier_*` (seeded step8; AdminDashboard writes) | **nobody** | DEAD |
| `platform_config` `nil.tier.*` + `usePlatformConfig` | **nobody** (hook never called; only ref is a comment in platformDefaults.ts) | DEAD |
model_config IS already the single-source pattern (batch + edge fn read it for transfer weights + `nil_base_per_owar`).

### Design (6 points)
1. **Single source = `model_config`** keys `nil_tier_{sec,acc,big12,big_ten,strong_mid,low_major,juco}` + `nil_base_per_owar`. BOTH hitter + pitcher WRITE paths read these via ONE resolver; code consts become fallback-only. Edge fn reads the SAME keys (already overlays model_config) → kills all 4 hardcoded copies + hitter/pitcher divergence.
2. **Market computed + STORED on every projection row** (WRITE paths only). REMOVE the 3 live-display computes (`PlayerProfile:985`, `useTeamBuilderSimulation:695`, `PitcherProfile:1426`) → read stored `market_value` via the TWP-aware helper. No live compute, no fallback.
3. **`total_hitter_war` for hitter market EVERYWHERE** (reconcile the o_war split). JUCO naturally = o_war (d/bsr=0).
4. **Snapshot re-bake WIRED INTO the run** — after the market write, auto-resync the 4 snapshot columns (not manual).
5. **Kill dead layers:** delete `platformDefaults.ts` + `usePlatformConfig` + `platform_config` tier usage; repoint OR remove the AdminDashboard tier editor so it writes the LIVE `nil_tier_*` keys, not dead ones.
6. **Seed model_config** (locked values): SEC 4.0 · ACC 1.5 · Big12 1.2 · BigTen 1.0 · strongMid 0.8 · low 0.5 · JUCO 0.35 · base $25k.

### Execution order
Edit unified resolver + write paths + remove live computes + ACC split (change surface #1–4) → update `nilProgramSpecific.test.ts` → seed model_config on STAGING (paste SQL) → re-price market (17 teams, hitter+pitcher+TWP, total_hitter_war; market-only re-bake from stored WAR preferred) → auto re-bake the 4 snapshot cols (`resync-build-snapshot-markets` + `resync-target-snapshots`, dry-run first) → VERIFY roster totals (SEC ~$4.4M / ACC ~$1.7M / Big12 ~$1M / BigTen ~$900k) + TWP + Independent nulls → log every SQL to PROD_MIGRATIONS_TODO → prod later.

### Files in scope (~8 + edge fn)
`nilProgramSpecific.ts`, `pitchingEquations.ts`, `depthRoles.ts`, `predictionEngine.ts`, `jucoReturnerProjection.ts`, `jucoReturnerPitcherProjection.ts`, `buildTransferPitcherInputs.ts`, `PlayerProfile.tsx`, `PitcherProfile.tsx`, `useTeamBuilderSimulation.ts`, `pitcherProjection.ts`, `transferPitcherProjection.ts`, `process-precompute-jobs/index.ts` (4 blocks), `AdminDashboard.tsx`, DELETE `platformDefaults.ts`/`usePlatformConfig.ts`, `nilProgramSpecific.test.ts`. Batch callers: `precompute-transfer-projections.ts`, `precompute-pitchers.ts`.

## ★ RESOLVER DESIGN DECIDED (2026-08-21) — per-conference EXACT CODE (option B) + Independent
- **Option B chosen:** the PTM resolver does an EXACT normalized-conference-code lookup (no fuzzy name
  matching), per IDs-over-names. `DEFAULT_NIL_TIER_MULTIPLIERS` is now a per-conference `Record<code,number>`;
  `resolveNilTiersFromConfig` overlays `model_config nil_tier_<code>`. Only non-low-major confs are listed.
- **Independent = 1.0** (Oregon State) — its OWN entry, NOT low-major. This was the bug that killed the bucket
  approach: "Independent" fell through to low-major 0.5, badly underpricing a former Pac-12 power. PTM = spending
  power (separate from the faced-competition fix, which handles the schedule OSU plays).
- **Locked map:** SEC 4.0 · ACC 1.5 · Big12 1.2 · BigTen 1.0 · Independent 1.0 · AAC/SunBelt/BigWest/MWC 0.8 ·
  NJCAA 0.35 · everything else 0.5. model_config keys: `nil_tier_<code>` + `nil_tier_default` + `nil_tier_juco` + `nil_base_per_owar`.
- **TB live-compute is INTENDED, keep it:** the toggle "what-if" recompute writes to the snapshot on persist, then
  reads stored — a preview-until-save, not a stored-first violation. Wiring check must confirm clean rows read snapshot.

## PROGRESS (implementation)
- ✅ Phase 1 + 1b DONE (08c40e2, 9f2dc34): unified source + per-conference exact-code resolver + Independent 1.0.
  Both computeHitter/PitcherMarketValue read the single source; pitcher dropped `eq.market_tier_*`; 3 inline assembly
  sites + 4 callers repointed. 265 tests pass, tsc 180 (no new). model_config seed = Option A (const holds correct
  values as fallback; model_config seeded to match, read by WRITE paths + edge fn).
- NEXT (Phases 2–4): edge fn (its inlined copies → same per-conf lookup + Independent) · `total_hitter_war` for hitter
  market at the WRITE callers · stored-only display (remove PlayerProfile/PitcherProfile live computes; KEEP TB toggle
  preview) · thread model_config into batch+edge-fn WRITE paths · kill dead layers (platformDefaults/usePlatformConfig)
  · seed model_config `nil_tier_<code>` · re-price 17 teams · auto re-bake snapshots · verify roster totals.

## ★★★ IMPLEMENTATION LOG (2026-08-21 → 08-23) — code DONE, staging re-price PENDING
### Phase 1 — unify the PTM source (client/shared-TS) [08c40e2, 9f2dc34]
- `nilProgramSpecific.ts`: `DEFAULT_NIL_TIER_MULTIPLIERS` is now a **per-conference Record** (exact normalized-code lookup, no fuzzy names) + `resolveNilTiersFromConfig(model_config)` + `resolveNilBasePerWar` + `NIL_LOW_MAJOR`/`NIL_JUCO`/`DEFAULT_NIL_BASE_PER_WAR`. SEC 4.0/ACC 1.5/Big12 1.2/BigTen 1.0/Independent 1.0/AAC+SunBelt+BigWest+MWC 0.8/else 0.5/NJCAA 0.35.
- `depthRoles.ts`: `computePitcherMarketValue` DROPS `eq.market_tier_*`, takes `opts?.{tiers,dollarsPerWar}` (same source as hitter). 4 pitcher callers + 3 inline assembly sites (pitcherProjection/transferPitcherProjection/useTeamBuilderSimulation) repointed. Test rewritten to real conference codes + Independent/JUCO. 265 tests pass.
### Phase 2 — edge fn + batch + total_hitter_war + stored display [ce1b289, 228c13a, 5fafad9]
- Edge fn `process-precompute-jobs`: replaced its 2 divergent bucket resolvers with ONE per-conference resolver + `buildNilTiers(model_config)`; both hitter (`nilTiers`) + pitcher (`nilTiersP` threaded through computeTransferPitcherProjection/applyPitcherPostprocess) read model_config `nil_tier_<code>`; dropped `eq.market_tier_*`.
- Batch: `precompute-transfer-projections` (hitter, already `total_hitter_war`) + `precompute-pitchers` (via `derivePitcherStored`'s new `nilTiers` param) read `resolveNilTiersFromConfig(model_config)`. model_config is now the LIVE source, const = fallback.
- `total_hitter_war`: all live writers use it; the o_war outlier `deriveHitterStored` is DEAD (0 callers).
- Profiles: no-toggle → STORED market; toggle → recompute OFF WAR (hitter via total_hitter_war using d+bsr derived from stored `total_hitter_war - o_war`; pitcher via pWAR). Roster/hub reads snapshot via marketOverride.
### Stored-first display audit + fixes [c855dc0 (audit doc), 95f22a6 (fixes)]
- **Projections stored-first everywhere on load** (WAR/market/rates/wRC+/pRV+); coverage 99.6-100%; projected-not-prevseason CLEAN. Full audit: `docs/STORED_FIRST_DISPLAY_AUDIT_2026_08_23.md`.
- **Scouting grades flipped to stored-first** (`stored *_score ?? live`): ReturningPlayers hitter+pitcher chips, PlayerProfile `activeSeasonScoutingGrades` (+ env+ `*_power_rating`), TargetBoardSubtab chips, usePlayerHubPreview (added stored Pitching Master read; was live-only). Season-stats FILTERED dimension bars left live (per-dimension, no stored equivalent — Trevor OK).
- **TWP:** `loadGmBuildRoster` market now side-aware (was hitter-first). WARs already side-aware.
### RLS [6162e7d]
- `20260823000000_player_predictions_rls_team_scope.sql` — replace `USING(true)` with `customer_team_id IS NULL OR superadmin OR is_team_member(customer_team_id)`. Committed; needs staging+prod apply.

## ★ PROD PUSH — market-value (run IN ORDER; staging first, then prod paste)
1. **Seed model_config** — `scripts/sql/seed_nil_tiers_model_config.sql` (⚠ MUST run before re-price — clears old `nil_tier_sec=1.5` that would override 4.0 + dead bucket keys).
2. **Apply RLS migration** — `20260823000000_player_predictions_rls_team_scope.sql`.
3. **Re-price the 17 teams** — re-run `precompute-transfer-projections` + `precompute-pitchers` per team (`_run_step2_all.sh`) → recomputes market_value/twp_* off the new PTM (WAR unchanged).
4. **Re-bake snapshots** — `resync-build-snapshot-markets.ts` + `resync-target-snapshots.ts` (or `heal-stale-snapshots.ts --market`) — snapshots bake market.
5. **Verify** — roster totals SEC ~$4.4M / ACC ~$1.7M / Big12 ~$1M / BigTen ~$900k; TWP + Independent=1.0; spot-check a few players.
6. **Deploy** the `process-precompute-jobs` edge fn (Trevor) — new-team path.
7. Log every SQL to PROD_MIGRATIONS_TODO.

## STATUS: all market-value + stored-first CODE done + green (tsc 180, 265 tests). PENDING: seed model_config → re-price → re-bake snapshots (staging, needs Trevor nod) → prod. Phase 3 dead-code cleanup optional.
