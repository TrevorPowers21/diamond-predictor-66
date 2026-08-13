# Transfer Projection Engine — Audit + Directives (2026-08-13)

Deep trace of the hitter + pitcher TRANSFER projection engine, with Trevor's decisions. Companion to
`AGENT_LEARNINGS_step7b_war_display_audit_2026_08_13.md`. **Operating principle (Trevor): improvements got built
OVER old code without deleting it — "it works but there's discrepancy on what's actually used." For every item:
trace the ACTIVE path in current code, DELETE dead, and bring the edge fn UP TO the canonical. Do not relay old code.**

A transfer = a player projected AT A DESTINATION TEAM (different conference / park / competition level). The value of
the whole product is projecting across competition levels.

---

## THE EQUATION (shared 7-step skeleton, both sides)
1. **Source rates + power ratings** from the Master (`*_power_rating` hitter / `*_pr_plus` pitcher; collapse-repointed
   to Master by source_player_id, 2026-08-12).
2. **Power blend** — 70% scouting PR+ / 30% raw last-year rate (D1 default `t_*_power_weight=0.70`); **0% for JUCO/D2**
   (raw verbatim + `applyJucoOutlierRegression` pull-to-mean).
3. **Competition/environment translation** (THE core value) — 3 multiplicative deltas vs destination:
   - conference level (avg/obp/iso_plus), **opposing-side quality**, park (K9 + JUCO skip park).
   - **Hitter opposing = destination pitching Stuff+** (weight ~1.0 = ~3× conference weight; the "tested vs weak
     competition" lever). **Pitcher opposing = destination hitter talent** `HTP = OverallPowerRating +
     1.25×(Stuff+−100) + 0.75×(100−wRC+)` (`precompute-pitchers.ts:174`) — "how good are the hitters he'll face,"
     balanced so it isn't inflated by a high-run environment or weak pitching.
4. **Class-transition + dev-aggressiveness** — `× (1 + class% + devAgg×0.06)` (JUCO source → 0).
5. **Depth role** from last-season ACTUAL PA/IP → a discrete tier of opportunities (PA hitters / IP pitchers).
6. **WAR** = (rate index − 100)/100 × opportunities × runs/9 + replacement, ÷ **13.1 (RPW)**.
7. **Market** = WAR × $25k × destination conference tier.

**Rate indices (data-backed, locked):** hitter wRC+ C1 (OBP .691 + SLG .235, intercept .011); pitcher pRV+ = D1-FIP
`3.847 − 0.231·K9 + 0.509·BB9 + 1.486·HR9`, ×1.137 (E2T), indexed to lgRA9 6.913.
**WAR:** hitter oWAR = ((wRC+−100)/100·PA·0.3994 + 21.22·PA/600)/13.1, + d_war + bsr_war = total; pitcher pWAR =
((pRV+−100)/100·IP/9·6.915 + 1.92·IP/9)/13.1.
**Market:** hitter = **total_hitter_war** × $25k × tier × **position PVM**; pitcher = **p_war** × $25k × tier, **NO PVF**
(SP value already in IP — don't double-count).

## DIVERGENCES hitter vs pitcher (Trevor's recurring "one side neglected" risk)
- Different scripts: hitter `precompute-transfer-projections.ts`; pitcher `precompute-pitchers.ts`. **Both must run on
  the edge fn** and fold into the ONE unified upload→display process (automatic from pitch logs, Track B).
- Opposing-quality term: pitching Stuff+ (hitter) vs hitter HTP (pitcher).
- Pitcher has SP↔RP **role-transition** adjustment + starter-regression boost; hitter depth role only sets PA.
- Market: hitter total+PVM; pitcher p_war, no PVF.

---

## THE 3-COPIES DRIFT (the real problem — canonical / Deno edge fn / TB live hook)
Same math exists in THREE independently-maintained implementations; they've drifted. **Directive: collapse toward ONE
(the unified edge fn), and until then bring the edge fn to canonical.**

### EDGE-FN SYNC LIST (bring edge fn `process-precompute-jobs` up to canonical `src/lib/*`)
- ✅ CONFIRMED **pitcher PVF bug**: canonical `depthRoles.ts:267` `void ctx.role` (no PVF); edge fn `index.ts:672-673`
  still `× pvfForRole(role)` → SP transfer market ~20% high. **Fix: remove PVF from edge fn** (Trevor: SP value already
  in IP). "Should have fixed that, never updated the edge fn."
- **Hitter market → total_hitter_war × PVM** (7a) — confirm edge fn matches (d/bsr addition present but marked UNTESTED).
- **Pitcher market → p_war × $/WAR × tier (no PVF)** — per above.
- **Rate index (pRV+ D1-FIP, wRC+ C1)** — confirm edge fn uses the current formulas, not a stale composite.
- **lgRA9 cleanup**: `pitcherQuality.ts:30` 6.913 (pRV+) vs `pitchingEquations.ts:239` 6.915 (pWAR). Make identical
  (minor, but should be consistent).

### VERIFY ACTIVE vs DEAD (trace liveness, delete dead — do NOT trust grep alone)
- ✅ **Triple-oWAR CONFIRMED dead**: `computeTransferProjection`'s internal `owar` (`transferProjection.ts:124`,
  `actualPa??260`) read by NOTHING; stored oWAR = `computeHitterOWar(...depthRole)` (`precompute-transfer-projections.ts:384`).
  **DELETE the 260-PA owar** (+ the mirror in applyTransferPostprocess if likewise dead). Depth-role version is supreme.
- **TB live toggle behavior (INTENDED, per Trevor):** when a coach moves a toggle, ALL of it recomputes LIVE for
  display — rates AND pWAR/oWAR AND market — so the coach sees it immediately; once SAVED it defaults to
  no-live-compute and reads the player/transfer snapshot. This must be the SAME for hitters and pitchers. The agent
  flagged "TB pitcher preview shows adjusted pRV+ but un-adjusted pWAR/$" — **likely OLD code built over; verify the
  ACTIVE dirty-row path recomputes WAR+market live on BOTH sides, and delete whatever stale branch doesn't.**
- **TWP (Trevor — DO NOT overcomplicate):** the display already reads `is_twp` and redirects to
  `twp_hitter_market_value` / `twp_pitcher_market_value`; stats are self-explanatory, no bleed, oWAR/pWAR separately
  labeled. **The ONLY 7b change for TWP = add total_hitter_war like every other player + redirect the oWAR read to
  total_hitter_war. Nothing else.** (Re-examine whether the "batch script doesn't route TWP market" is even the active
  path or dead — the display handles the split regardless.)

### BUCKET 3 — Stuff+ / HTP competition-translation levers — INVESTIGATED 2026-08-13

**Derivation (verified in code + DB).** Conference Stuff+ chain: pitch-shape data (`pitcher_stuff_plus_inputs`:
velo/IVB/HB/release/extension/spin) → per-pitch Stuff+ z-scored vs a **D1 population baseline**
(`pitcher_stuff_plus_ncaa`, per pitch-type×hand), recentered to mean 100 → per-pitcher composite
(`Pitching Master.stuff_plus`, pitch-weighted) → conference roll-up. JUCO/D2 z-scored vs the D1 baseline (locked
`juco_uses_d1_baselines`). **HTP = OPR + 1.25·(Stuff+−100) + 0.75·(100−wRC+)**, all from the conf's `Conference Stats`
row: OPR = PA-weighted conf avg of each hitter's **process** power rating (batted-ball/EV/contact — not run outcomes);
Stuff+ = above; wRC+ = conf offense (SLG+OBP based).

**DB reality — corrected the audit agent's over-calls (research, not guess):**
- ❌ "duplicate rows / two pipelines wrote dupes" → **0 true duplicates** (162 rows = 30 conf × 5 seasons 2022-25 + 42
  for 2026; the "Big 12 twice" was cross-season).
- ❌ "wRC+ hand-entered/untraceable" → **computed** (precise decimals 89.9…105.9). The 30 real D1 conferences are
  complete; the only null-input rows are the 10 **JUCO districts** → they use hardcoded `JUCO_DISTRICT_HTP_OVERRIDE`
  by design.
- **HTP ranking 2026 D1 passes the sniff test:** SEC 132 › ACC 122 › Big 12 120 › American 115 › Big Ten 115 › CUSA 114
  › … › OVC 93 › MAAC 91 › SWAC 78 › NEC 78. (Calibrated historically by tinkering the weights until the ranking looked
  right — NOT a data-fit; keep that in mind for any re-weighting.)

**DECISIONS / DIRECTIONS (Trevor 2026-08-13):**
1. **⭐ wRC+ term (`100−wRC+`) → replace with CONFERENCE-AVERAGE PARK FACTOR.** It was built BEFORE park factors
   existed — a proxy for run ENVIRONMENT. But raw conf offense conflates environment WITH hitter quality (already in
   OPR) → the **Ivy double-count**: OPR 96.7 (weak talent) + wRC+ 89.9 → +7.6 boost → HTP 104.7, leapfrogging better
   leagues. The clean fix: the term should isolate ENVIRONMENT = a conference-average PARK FACTOR (derived via wRC+ =
   SLG+OBP), so OPR carries talent and park carries environment, no overlap. "Let's think about it" — a direction, not
   final. (Also open: `1.25`/`0.75` weights are tinker-tuned, not fit.)
2. **PARK FACTOR = its own future project (SAVE, not now):** we now have per-player park factor across the season
   (pitch-log venues) storable, plus conference-average park factor. Park factor is a separate review — [[project_park_factor_rework]].
3. **Independent outlier:** HTP 113.6 (7th) is driven by a single team (Oregon State) with an outlier Stuff+ 110.9. No
   clean conference-based fix; the real fix = sum the TALENT LEVEL of Oregon State's actual SCHEDULE (schedule-based
   opponent strength). Discuss/future — no resolution now.
4. **Two Stuff+ types are BOTH NEEDED (not a bug to collapse):** (a) individual-pitcher Stuff+, (b) per-conference
   Stuff+. Canonical conference Stuff+ = take **every** pitcher's impact **weighted by their pitch totals** from the
   pitch log (the V2 pitch-weighted method). **Retire V1** (per-pitcher-composite, name-keyed). "Don't care how we get
   there but necessary."
5. **OPR (batted-ball) susceptibility — complex, needs doing:** unlike Stuff+ (pure pitch shape, context-independent),
   batted-ball data CAN be manipulated by ball-flight ENVIRONMENT and QUALITY OF STUFF FACED. So OPR may itself need a
   park/competition context-adjustment. Complex conversation, flagged for a dedicated pass (ties to park factor + Stuff+).
6. HTP shape is directionally correct + sniff-test-validated → keep it; the refinements are the wRC+→park-factor swap
   (#1), the OPR-context question (#5), and the Independent/schedule case (#3).

### NEW REQUIREMENTS (Trevor, 2026-08-13)
- **Verify depth-role RANGES use REGULAR-SEASON totals:** the hitter PA tiers (`defaultHitterDepthRoleFromActualPa`:
  ≥220/130/50/15 → PA 245/215/145/85/25) and pitcher IP/GS tiers must project off the correct **regular-season** PA/IP
  (not full-season incl postseason). Check the thresholds + the source column.
- **⭐ DEFENSIVE DEPTH TIERS:** d_war/bsr_war are stored pass-throughs today, but they must **scale as position/depth
  toggles change** — so a player needs assigned DEFENSIVE depth tiers (parallel to the PA/IP opportunity tiers) so
  d/bsr scale with playing time + position. **Needed for ANY Team Builder function — returner AND transfer**, not just
  transfers. This is the mechanism behind the 7b/7c "depth-role scales d/bsr" decision.

---

## THE TARGET ARCHITECTURE (ties to Track B)
ONE process, automatic, from pitch-log upload → display: pitch log lands → derive metrics → marry into Masters →
recompute ncaa_averages → power ratings → **run BOTH hitter + pitcher projections (returner + transfer) on the edge
fn** → write player_predictions → display reads stored (live-recompute only for unsaved TB toggles). Collapses the 3
drifting copies into 1. Step 6b (deploy + fire transfers) is the near-term step; the unified fn is the durable build.
