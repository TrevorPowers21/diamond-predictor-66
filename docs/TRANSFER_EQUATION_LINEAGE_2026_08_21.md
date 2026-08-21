# TRANSFER EQUATION — Full Data Lineage + Edge-Function Spec (2026-08-21)

Verified walkthrough of the transfer projection engine (hitter + pitcher): every input, source table, join key, handedness handling, and equation step. This is the blueprint for the ONE unified edge function. Traced + spot-verified in code. Entry points: hitter `scripts/precompute-transfer-projections.ts` → `buildTransferProjectionInputs.ts` → `transferProjection.ts`; pitcher `scripts/precompute-pitchers.ts` → `buildTransferPitcherInputs.ts` → `transferPitcherProjection.ts`.

## ⚠️ INCONSISTENCIES TO RESOLVE BEFORE RE-RUN (the point of this pass)

1. **⭐ HITTER env+ is still LIVE-COMPUTED from hardcoded divisors** — `avg_plus = round(AVG/0.280·100)`, `obp_plus = round(OBP/0.385·100)`, `iso_plus = round(ISO/0.162·100)` (`precompute-transfer-projections.ts:155-157`). It does **NOT** read the stored `ba_plus/obp_plus/iso_plus` Conference Stats columns (which exist). This is the hitter parallel of the pitcher 1a–1d work — **NOT done for hitters.** Violates the "no live compute / read stored" rule and risks divergence from stored `ba_plus`. **FIX: hitter env+ should read stored `ba_plus/obp_plus/iso_plus`** (same as pitcher reads `era_plus…hr9_plus`). Also decide the canonical divisors vs the stored-column derivation so they match.
2. **⭐ HITTER from-team resolves by NAME ONLY** (`precompute-transfer-projections.ts:329` `teamByName.get(normalizeKey(from_team||team))`) — no id path. A hitter whose `from_team`/`team` string doesn't normalize to a Teams Table name yields null from-conference → **blocks**, even when a `team_id`/`source_team_id` exists on the players row. Pitcher side is id-first (PM `TeamID` → `players.team_id` → name). **FIX: thread id-first resolution on the hitter from-team** (matches [[feedback_id_over_name]] / [[feedback_link_ids_not_names]]; also the CLAUDE.md "Remaining Bugs" conference_id note).
3. **Dual weight-storage paths:** hitter batch reads `model_config` (`t_*` keys, updated) + `customer_team_equation_overrides`; pitcher batch reads code `DEFAULT_PITCHING_WEIGHTS` (the "Equation Weights" table is EMPTY, no localStorage in Node) — NOT model_config. The model_config `transfer_*` mirror I stored is consumed only by the **edge fn** (Deno). For the unified edge fn, model_config is the single source both sides must read.
4. **Hitter park resolution omits `source_team_id`** (`buildTransferProjectionInputs.ts:187` passes `teamId` but leaves sourceTeamId undefined) → uses per-season team UUID → name, skipping the stable-program path the pitcher/park spec prefers.
5. **NCAA anchors come from model_config/weight keys** (`t_*_ncaa_avg`, `*_plus_ncaa_avg`), **not** the `ncaa_averages` table — a store-everything divergence to reconcile.

---

## SHARED CONVENTIONS
- Reads use `CURRENT_SEASON`; output rows written at `PROJECTION_SEASON`/`--season`. Output UPSERT key: `(player_id, customer_team_id, model_type='transfer', variant='precomputed', season)`. Post-step RPC fills scouting chips (`propagate_*_scores_to_predictions`).
- Destination team = `customer_teams.school_team_id` → **`Teams Table.id`**. Conference resolve order (both sides): `conference_id` → JUCO district-id map → **name alias** (last resort).
- Handedness (hitter only): `players.bats_hand` → `batsHandToHandedness` (L→lhb, R→rhb, S/B→switch) → picks `lhb_*/rhb_*` park split for avg/obp/iso; switch/null → combined; missing split col → combined fallback (`parkFactors.ts:137-154`). **Pitchers never pass handedness** → always combined `rg/whip/hr9` factors (per spec).

## HITTER — source tables + keys
- `customer_teams` (id/name/school_team_id) → `Teams Table` destination by **id**.
- `Conference Stats` (`*`) indexed by **conference_id** + normalized name. **Uses: AVG/OBP/ISO (→live env+, see inconsistency #1) + Stuff_plus.** Does NOT use hitter_talent_plus/OPR/WRC_plus/run_env_factor/ba_plus/obp_plus/iso_plus.
- `Park Factors` (`*`) keyed by name/team_id/source_team_id; uses avg/obp/iso + lhb/rhb splits.
- `Teams Table` (all, from-team) indexed by **name/abbrev/source_id ONLY** (no id index) → inconsistency #2.
- `players` (id, source_player_id, team, from_team, conference, division, bats_hand, source_team_id, pa, class_year, is_twp, portal_status).
- `player_predictions` keyed by **players.id** (from_avg/obp/slg, class_transition, dev_aggressiveness).
- `Hitter Master` keyed by **source_player_id** (ba/obp/iso_power_rating, d_war, bsr_war).
- Weights: `model_config` (`t_*`) + `customer_team_equation_overrides` → `TRANSFER_WEIGHT_DEFAULTS` fallback.

## PITCHER — source tables + keys
- `customer_teams` → `Teams Table` destination by **id**.
- `Conference Stats` (`*`) indexed by **conference_id** + alias name. **Uses STORED env+ `era_plus…hr9_plus` (ratio, read directly — no live compute) + hitter_talent_plus computed = `OPR + 1.25·(Stuff+−100) + 0.75·(100−WRC+)` from Overall_Power_Rating/Stuff_plus/WRC_plus.** Rows with ANY null env+ skipped at load → JUCO districts excluded from the D1 id map.
- `Park Factors` (era→rg_factor, whip→whip_factor, hr9→hr9_factor; combined only).
- `Teams Table` (all, from-team) indexed by **id + source_id + name** (id-first).
- `players` (…, team_id, source_player_id, ip, …).
- `Pitching Master` keyed by **source_player_id** (canonical) → name|team → name-only fallback. Rates (`blended_*` when combined_used), `*_pr_plus`, Role/G/GS/IP/regular_season_ip, d/bsr not applicable.
- `player_predictions` keyed by players.id (class_transition, dev_aggressiveness — NO from_* rates; pitcher rates come from PM).
- Weights: `readPitchingWeights()` → code `DEFAULT_PITCHING_WEIGHTS` (Equation Weights table empty; no model_config read in the batch).

## THE EQUATION (both sides, in order)
1. **Power scale**: `scaled = ncaaAvg ± ((PR+ − 100)/std_pr)·std_ncaa`. Hitter PR+ = Master `*_power_rating`; pitcher PR+ = Master `*_pr_plus`. SDs: hitter `t_*_std_pr`/`t_iso_std_power` + `t_*_std_ncaa`; pitcher `*_pr_sd` + `*_plus_ncaa_sd`. NCAA avgs from weight/model_config keys (not ncaa_averages table).
2. **Power blend**: `blended = last·(1−powerWeight) + scaled·powerWeight` (D1 powerWeight 0.70; JUCO 0). Hitter last = from_avg/obp/slg (ISO = slg−avg); pitcher last = PM blended rates.
3. **Env translation multiplier** (the levers — re-tuned 2026-08-21):
   - Hitter: `1 + confW·(Δconf+/100) − pitchingW·(Δstuff+/100) + parkW·(Δpark/100)`; Δ = to−from. Weights `t_*_conference/pitching/park_weight`.
   - Pitcher lower-better: `1 − confW·(Δenv+/100) + compW·(ΔHTP/100) + parkW·(Δpark/100)`; K9 higher-better flips signs, no park; WHIP park damped 0.75; BB9 no park. Weights `transfer_*_conference/competition/park_weight`.
4. **Rate outputs** → hitter SLG=AVG+ISO, OPS; wRC+ = `(0.011 + 0.691·OBP + 0.235·SLG)/ncaaWrc·100`. Pitcher pRV+ = D1-FIP index from K9/BB9/HR9 (`100 + 100·(6.913−projRA9)/6.913`).
5. **Class-transition + dev-aggressiveness**: `×(1 + classAdj + devAgg·0.06)` (pitcher low-better subtracts). class_transition from `resolveClassTransition(class_year, pred)`; JUCO forced SJ + devAgg 0. Re-derives wRC+/pRV+.
6. **Depth role → opportunities**: hitter PA tier from `defaultHitterDepthRoleFromActualPa(players.pa)` (stored `projected_pa` = TIER value); pitcher IP from `regular_season_ip ?? IP ?? players.ip` → `derivePitcherDepthRole` → `pitcherExpectedIp` (canonical rewrite overwrites the coarse first pWAR pass; `input.ip` is never set upstream — latent, harmless).
7. **WAR**: hitter oWAR = `computeHitterOWar(wRC+, depthRole)`; total = oWAR + d_war + bsr_war (d/bsr from Master, destination-invariant). Pitcher pWAR = `((pRV+−100)/100·IP/9·6.915 + IP/9·1.92)/13.1`.
8. **Market**: hitter = `oWAR × $25k × programTierMult(toConference) × positionValueMult(pos)`; pitcher = `pWar × $/war × programTierMult`, no PVF, eligibility gate (Independent excluded except Oregon State); TWPs route to `twp_*_market_value`. Floored at 0.

## NULL / MISSING HANDLING
- Hitter blocks on: missing last slash; D1 missing any `*_power_rating`; missing any from/to `*_plus`/`stuff+`; D1 missing any from/to park. JUCO/D2: PR not required (weight 0), park skipped, outlier regression applied.
- Pitcher blocks on: no PM stats (`no_stats`); no PR+ & not JUCO (`no_power`); unresolved from/to conf; any missing rate/PR+/env+/HTP via `requireNum`. Park null → term zeroed.
- Script pre-filters: opposite-side excluded unless `is_twp`; own-roster (source_team_id==toSourceId) excluded; division filter; JUCO PA<75 / IP<20 floor.
- Park map: missing current season → prior-season by source_team_id/name; `normalizeParkToIndex` null→100.

## FOR THE EDGE FN (Track B, unified)
One process reads: pitch-log-derived Masters + stored Conference Stats env+ (era_plus…hr9_plus + ba_plus/obp_plus/iso_plus once hitter is converted) + Stuff+/HTP/park + model_config weights (both sides), resolves teams id-first (fix hitter name-key), applies handedness for hitter park, runs the 8 steps, writes player_predictions. Kills the 3-copy drift + the hitter/pitcher provenance mismatch.

---
## RESOLVED (2026-08-21, dry-run verified)
- **#1 hitter env+ → STORED.** `precompute-transfer-projections.ts` now reads `ba_plus/obp_plus/iso_plus` (removed the `AVG/0.280` live compute). Verified stored ≈ old live (Δ ≤1 ba/obp, ≤3 iso) — same model, now single-source. Matches pitcher.
- **#2 hitter from-team → ID-first.** Added `teamById`/`teamBySourceId`; resolve `players.team_id → source_team_id → name`. Added `team_id` to the players select. Dry-run: 96% computed.
- **#3 pitcher weights → model_config.** `precompute-pitchers.ts` overlays model_config `transfer_*` onto code defaults ("overlaid 16 …"); the empty legacy "Equation Weights" table is retired (not filled — everything in model_config). Hitter already read model_config.
- **Still open (future):** NCAA anchors (`*_plus_ncaa_avg/_sd`, `t_*_ncaa_avg`) live in code/model_config, not `ncaa_averages` table; hitter park still omits source_team_id; browser weight loader (`readPitchingWeights` async cache) still points at the empty Equation Weights table — repoint to model_config when unifying the edge fn.

---
## VERIFICATION + BACKFILL NOTES (2026-08-21)
- **⚠️ `players.team_id` is NULL for ~ALL players** (15,560/15,561). The id-first from-team resolution therefore resolves via **`source_team_id`** (filled: 12 null of 15,561). Teams Table `source_id` = 466/466 filled, distinct, no dupes. **BACKFILL CANDIDATE:** populate `players.team_id` (via `source_team_id → Teams Table.id`) for a stable internal-id primary path.
- **⚠️ SOURCE-ID RISK (Trevor):** resolution currently leans on `source_id`/`source_team_id`, which *could change / be re-id'd* by the data provider in the future → a potential resolution roadblock. Filled + consistent today, so acceptable for now; logged as a known risk. Prefer internal `team_id` once backfilled.
- **Env+ divisor correction:** the stored `ba/obp/iso_plus` use the ACTUAL ncaa means (implied divisors 0.2777/0.3823/0.1588), NOT the old hardcoded live divisors (0.280/0.385/0.162). Switching to stored is a small (~1%) but REAL change — stored is MORE correct. (Earlier "essentially identical" was imprecise.)
- **Behavioral verification (controlled lever tests, both sides):** power rating ↑ → output ↑ (hitter) / rates better (pitcher); competition ↑ → output ↓ (hitter wRC+ 106→93 at Stuff+ +12) / rates worse (pitcher pRV+ 113→109 at HTP +15); conference small (~1%); park directional. All correct, magnitudes match the tuned weights.
