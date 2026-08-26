# HANDOFF — TWP flag pass + HR9-only floor (feature/war-recalibration) — 2026-08-26

Resumable handoff for the dedicated two-way-player (TWP) flag pass. Rides the WAR-recalibration prod push as an
ordered, logged step. Standing constraints: **D1 only, JUCO separate**; staging-first; prod writes = Trevor drives;
every DB change logged to `PROD_MIGRATIONS_TODO.md`. ⚠ `supabase --linked` = PROD; staging = `.env.local`.

## WHAT THIS PASS IS (one paragraph)
A bug report about "stale pitching rows" unwound into a systemic data gap: **`is_twp` was never populated** on
current-season data (only **2** of ~253 real two-way players flagged). The canonical detector `recomputeTwpStatus`
existed but is reachable only from a manual AdminDashboard button and had never been run. Consequence: two-way
players labeled with a hitter position had their **pitching side dropped** from the pipeline (stale rows + missing
from the pitcher board — e.g. Evan Dempsey, 88.7 IP / 3.6 pWAR, invisible). Fix = run the detector + re-run the
precomputes so both sides project. Folded in: narrowing the projection floor to **HR9-only**. Full narrative +
doctrine: `docs/AGENT_LEARNINGS_twp_flag_systemic_gap_2026_08_26.md`.

## ✅ DONE ON STAGING (2026-08-26)
1. **HR9-only code floor** — `pitcherProjection.projectPitchingRate` + `transferPitcherProjection.projectLower` gained
   a `floorAtZero` param (passed `true` only from the HR9 call site); `projectHigher`/K9 un-floored. Non-HR9 rates
   stay unfloored so a negative surfaces as a real bug. `npm test` 265 pass, 0 new tsc errors.
2. **TWP detector applied** — `scripts/run-twp-recompute.ts --apply` (added `dryRun` to the canonical lib fn; runner
   uses the Node-CLI service-role client). Threshold **PA≥30 & IP≥5** (Trevor-confirmed — safe because the flag is
   re-derived each season + has a demotion ladder, so it never permanently strips two-way eligibility).
   Result: `is_twp` **2 → 253** (D1=90 / JUCO=163); 207 net-new + 45 legacy-migrated + 1 unchanged; **0 P→hitter
   flips** (detector only sets hitter-primary with a valid Hitter Master Pos); cleanup 31 demote→pitcher, 65
   clear→null (alumni), 34 left `position='TWP'` (manual-fix residuals); 0 errors. Dry-run previewed first.
3. **Returner PITCHER re-run** — pool 7628→7829 (+201 TWPs), 7633 upserted, propagated 110,383 rows, **0 negative
   pitching rates / 104,401 rows**. Dempsey pitcher side `p_war=3.63`.
4. **Returner HITTER re-run** — 8235 updated, 0 errors; `twp_hitter_market_value` + null shared `market_value` for
   D1 TWPs.
5. **Dempsey verified end-to-end** — combined NIL $66,114 (pitcher $45,345 + hitter $20,768), shared market null,
   both WAR sides present.

## ✅ TRANSFER RE-RUN + RE-BAKE — DONE + VERIFIED on staging (2026-08-26)
- **Transfer re-run** (`_run_step2_all.sh` — `precompute-transfer-projections` + `precompute-pitchers` × 18 customer
  teams): the TWP transfer rows were stale/single-sided (2,186 of 2,221 pre-run). After: **1,529 D1-TWP transfer rows
  now carry the `twp_*` split** across all 18 teams. ⚠ 88 D1-TWP rows remain one-sided (see the 88-row note below).
- **Re-bake applied:** `rebuild-twp-target-rows` (TWP target rows, both sides) · `rebake-twp-markets` (snapshot twp_*
  from WAR) · `backfill-neutral-snapshot` (bp=1205 / tb=167) · `resync-target-snapshots --all` (applied 9) ·
  `resync-build-snapshot-markets --all` (applied 6 — legit market→0 for negative-WAR players, floor at $0).
  `heal-stale-snapshots` drift=0 (no-op, skipped).
- **VERIFIED end-to-end:** Dempsey (returner) combined NIL $66,114 both sides. Overbeek (target board) — **2 rows per
  team (hitter slot + pitcher slot)**, each side's market populated, neutral snapshots present, market scales by
  destination (Georgia/SEC hitter $267,826 + pitcher $16,148). **0 now-TWP players on build rosters** → no
  build-snapshot staleness.

## ✅ 88 D1-TWP "ONE-SIDED" ROWS — ROOT-CAUSED + FIXED (was NOT a code gap)
The 88 were all on ONE team — **North Carolina** (`e0defb42`), the 18th customer team, added 2026-08-25 and **missing
from the hardcoded 17-team `_run_step2_all.sh`**. So NC's entire transfer set (10,207 rows) was stale (old model +
pre-TWP-flag), and the 88 were just its TWP subset. **Fixed:** re-ran NC's transfers → **D1-TWP transfer rows 1,617
split / 0 shared-only.** (Every affected player was already correct on their other 17 teams.)

## ✅ SYSTEMIC FIX — dynamic customer-team list (no more missed teams)
Root cause of the NC miss = a hardcoded team array. Fixed:
- **`scripts/list-customer-teams.ts`** (NEW) — prints active teams from the LIVE `customer_teams` table (`uuid:Name`).
- **`scripts/_run_step2_all.sh`** rewritten to load teams from it (`--prod` switches env + adds `--prod`). Verified: loads
  all 18 incl. NC. Any team added later is picked up automatically.

## EDGE-FN NEW-TEAM AUTOMATION — works; needs the model kept current
The `customer_teams` AFTER-INSERT trigger → `precompute_jobs` → `process-precompute-jobs` edge fn **exists and fired
for NC** (2 completed jobs at NC's creation). So a new team IS auto-precomputed at creation. The NC staleness came from
(a) the edge fn running the **old model** (pre two-sided-SD / pre-TWP), and (b) the offline model-update re-run using a
hardcoded list. Complementary fixes: **dynamic offline runner** (done — for model-update re-runs across all live teams)
+ **edge-fn model mirror** (queued below — so new teams are correct at birth). ⚠ PROCESS: any projection-model change
must update BOTH the offline batches AND the edge fn (parallel implementations — drift risk).

## ✅ EDGE-FN MIRROR — DONE + DEPLOYED TO STAGING (2026-08-26)
`process-precompute-jobs` was the OLD symmetric model. Mirrored to match src/lib exactly:
- 6 `<stat>_plus_ncaa_sd_bad` keys added to `PITCHING_EQ_DEFAULTS` (so the model_config overlay `k.includes("_plus_ncaa_") && k in eqD1` loads the live values); avg/sd defaults refreshed to the 2026 calibration.
- `dsd` directional-SD helper + wired into all 6 projectLowerP/projectHigherP call sites.
- HR9-only floor (`Math.max(0, projectLowerP(...))`); every other rate unfloored.
- The D1 path was already TWP-aware (splits `twp_*_market_value`, both-side snapshots) — no change needed.
- Deno check: **0 new type errors** (2 pre-existing literal-type quirks confirmed identical on base).
- **DEPLOYED STAGING** (`slrxowawbijbjrkozqlj`, a persistent branch of prod `main`): version 26→27. **Prod `main` version 12 UNCHANGED.**
  Auth note: no separate token needed — the prod-account CLI login owns the parent project, so it reaches both branches;
  the explicit `--project-ref slrxowawbijbjrkozqlj` targets staging (NEVER `--linked`, which = prod main).
- **PROD:** `supabase functions deploy process-precompute-jobs --project-ref trbvxuoliwrfowibatkm` (Trevor drives) — part of the ordered prod push.

## ⏳ REMAINING (this pass)
- [ ] Nothing on staging — the TWP pass + edge-fn mirror are complete + verified. Prod push (detector → precomputes →
  re-bake → edge-fn deploy) is the ordered go-forward, Trevor-driven.

## ⚠ KNOWN GAP — JUCO TWP MARKET (DEFERRED, Trevor 2026-08-26)
The JUCO precompute branches (pitcher ~L391, hitter ~L260) write only the shared `market_value`, never the
`twp_*_market_value` split → all **163 JUCO TWPs show no market** on TWP surfaces (90 D1 TWPs correct). **Decision:
keep all 253 flagged; fix the JUCO branches (write the split + null shared for `is_twp`) in the JUCO workstream
BEFORE JUCO ships.** Not a D1-push blocker. Also noted: JUCO passthrough can yield negative pWAR (e.g. −1.13) — its
own behavior, separate concern.

## PROD PUSH ORDER (this pass, folded into the WAR-recalibration manifest)
1. `scripts/run-twp-recompute.ts --apply` against PROD (regenerate from prod Masters — do NOT copy staging flags).
2. `precompute-returner-pitchers` + `backfill-2027-hitter-returners` on prod (detector FIRST so both-side rows gen).
3. Transfer per-team precomputes.
4. Re-bake TWP markets + snapshots.
5. Deploy edge fn (Trevor).
See `PROD_MIGRATIONS_TODO.md` → "TWP FLAG RECOMPUTE" + "HR9-ONLY FLOOR + TWP PRECOMPUTE RE-RUN".

## FILES TOUCHED
- `src/lib/recomputeTwpStatus.ts` — `dryRun` param (backward-compatible).
- `src/lib/pitcherProjection.ts` — `floorAtZero` param, HR9-only floor.
- `src/lib/transferPitcherProjection.ts` — `floorAtZero` on `projectLower` (HR9 only); K9 un-floored.
- `scripts/run-twp-recompute.ts` — NEW runner (dry-run default, `--apply`).
- `PROD_MIGRATIONS_TODO.md`, `docs/AGENT_LEARNINGS_twp_flag_systemic_gap_2026_08_26.md`, this handoff.

## RELATED DOCS / MEMORY
`AGENT_LEARNINGS_twp_flag_systemic_gap_2026_08_26` · `AGENT_LEARNINGS_projection_calibration_two_sided_sd_2026_08_24`
· `HANDOFF_MASTER_war_recalibration_2026_08_23` · memory `project_two_way_player_mode` (flag is its prerequisite —
now populated) · `feedback_pause_and_confirm_before_changes` · `feedback_stop_and_talk_on_real_problems`.
