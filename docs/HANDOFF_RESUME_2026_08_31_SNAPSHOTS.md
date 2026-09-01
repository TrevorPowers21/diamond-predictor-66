# ▶️ HANDOFF — PICK UP HERE. Written 2026-08-31, after commit `ab893cf`.
## 🛑 MUST READ — PROJECTION CALIBRATION IS **WRONG ON PROD RIGHT NOW** (found 2026-09-01)

Two constants were **fit on one population and applied to another**. Both bias EVERY pitcher's
projection by a CONSTANT — equal discrepancies at every percentile and in every class bucket.

**(1) Stage 5.5 had NO division filter.** Baselines were computed across every division:
`D1 1,295 (mean ERA 5.264) · NJCAA_D1 477 (6.118) · ALL 1,773 (5.492)` at the producer's own
`IP >= 40` qualifier. **477 JUCO pitchers — 27% of the sample — inflated the D1 anchor by 0.229 ERA
(4.3%).** `git log` confirms the filter was NEVER present.

**(2) The z-shift subtracts a hardcoded `100`, but PR+ is not centered at 100 on that population.**
True D1/`IP>=40` centers: `era 109.7253 · fip 108.2875 · whip 108.4028 · k9 101.6919 · bb9 123.1615 ·
hr9 102.0359 · overall 109.0064`. On all-division/`IP>=20` they are 96.3–104.0 (≈100) — PR+ was FIT
there, APPLIED here. ERA carried **+0.44 of phantom improvement** per pitcher; **BB9 is worst at 123.16**.

**MEASURED EFFECT** (real ERA constants) — a constant offset; the spread is unchanged:
`AVERAGE pitcher 4.9280 → 5.2757 (actual 5.3040) · ELITE 3.8457 → 4.1934 · WEAK 6.2359 → 6.7028`

★ Hitting is **not** contaminated the same way (its anchors were already D1-scoped; centers
100.31–103.79). Centers are stored for both sides regardless — nothing may assume 100.

⛔ **CODE IS FIXED, DATA IS NOT.** As of this writing: `model_config` has **not** been written on either
database, the **edge function still has its own constant copies and its own hardcoded `100`** (so
onboarding still projects with the old bias), and **precomputes have not been re-run** — every stored
`p_era`/`p_war`/`market_value` on prod still carries the bias.

⚠ After applying, **re-verify the ACROSS-THE-RANGE table, not the mean.** And note the trap: this bug
is invisible to a range check, because a miscentered rating shifts the LEVEL while keeping the SHAPE.
The tell was *equal* discrepancies everywhere. **A constant offset with correct spread ⇒ a population
mismatch in the constants, not a broken model.**

Full detail: `docs/PIPELINE_pitch_log_to_projections.md` stage 5.5 MUST READ.

**SNAPSHOT IMPACT:** every `player_snapshot` / `neutral_snapshot` on prod was built from biased
projections. They are internally consistent (the snapshot read path was fixed 2026-09-01 and verified),
but the NUMBERS inside them carry the bias until the precomputes are re-run and the builds refreshed.

Supersedes nothing; it is the **RESUME POINT** for the snapshot/market leg of the war-recalibration push.
Companions: `docs/HANDOFF_2026_08_31_EOD.md` (state) · `docs/HANDOFF_WHATS_AHEAD_2026_08_31.md` (rules + Track B) ·
`docs/PIPELINE_pitch_log_to_projections.md` (**Track B spec — the important one**).

## 🚨 READ FIRST
This is **the first push that changes what coaches SEE.** Snapshots drive the UI. Two consequences:
1. **A blank market value is a user-visible bug**, not a data curiosity. Gate the way the UI resolves, not by column.
2. **Large market JUMPS are EXPECTED on this push** — SEC pitchers went $37,500/win → $100,000/win (PTM 1.5 → 4.0),
   push-wide, for hitters AND pitchers. Trevor: *"that is going to be normal … all SEC coaches are gonna see a large
   jump."* ⛔ **Do not investigate a large SEC increase as a regression** — verify against the IDENTITY below.

---
# §1 WHAT IS DONE (prod, verified in the DB — not from logs)
| step | state |
|---|---|
| E38 transfers re-run (all 14 teams) | ✅ 13 × 14,267–14,276 rows · All-Americans 0 by design · 0 error/fail in log |
| **Stage-18 TWP routing fix** | ✅ engine now routes TWP → `twp_*_market_value`, NULLs shared, prices at DESTINATION conference |
| hitter propagate | ✅ `propagate_hitter_scores_to_predictions(2026)` → **112,449 rows, 23.7s** |
| **F41a** `rebuild-twp-target-rows` | ✅ 3 TWP groups · `total_hitter_war` now carried through the delete+reinsert |
| **F41b** `rebake-twp-markets` | 🗑️ **DELETED** — superseded by F42, priced at the WRONG conference |
| **F41c** `fix-returner-twp-hitter-market` | ⏭️ **SKIPPED** — its remaining 110 rows are ALL JUCO (parked); D1 already correct |
| **F42a** `resync-build-snapshot-markets --all` | ✅ + UUID filter, `players.is_twp`, pitcher re-derivation. 172 rows re-priced |
| **F42b** `resync-target-snapshots --all` | ✅ 147 of 185 changed |
| **F42b′** `recompute-snapshot-hitter-market` | ✅ 415 snapshots re-priced |
**Backups on prod (⛔ never drop):** `_tb_pre_f41_backup` (184) · `_tb_pre_f42_backup` (185) ·
`_tbp_pre_f42_backup` · `_tbp_pre_f42b_backup` · `_tbp_pre_twpflag_backup` · `_tbp_pre_pitchermkt_backup` (1,470 each)
— **plus every backup listed in the EOD handoff.**

---
# §2 ✅ SOLVED — the 34 blank-market pitchers (**was** the one open defect)
**ROOT CAUSE: REGISTRY #24 — E37 (returner hitters) stomped E36's (returner pitchers) `market_value` on the SHARED
`returner/regular` row.** Both stages own that column; E37 runs last and wrote `null` when it had no oWAR.
**FIXED** at `backfill-2027-hitter-returners.ts:308` (never null a shared column you have no value for), E36 re-run
(7,596 rows) + pitcher propagate (105,112 rows). **Unexplained bucket is now ZERO.** Historical detail below.
```
Derek Arrocha   SWAC     Jackson State         p_war 2.531  PR+ 123  weekend_starter        85.0 proj IP
JB Manarchuck   MAAC     Mount St. Mary's      p_war 1.606  PR+ 127  workhorse_reliever     50.0
John Costa      ASUN     North Florida         p_war 1.577  PR+ 126  workhorse_reliever     50.0
Adam Brodnax    Sun Belt UL Monroe             p_war 1.518  PR+ 124  weekday_starter        50.0
```
**FIVE HYPOTHESES TESTED AND REJECTED — do not re-test:**
| hypothesis | result |
|---|---|
| Independent-conference guard (`canShowPitchingMarketValue`) | ❌ **0 of 106 are Independent** |
| no 2026 `"Pitching Master"` row ⇒ E36 blocked them | ❌ **34 of 34 HAVE one** |
| null `players.team` | ❌ **0** |
| non-positive WAR floors to null | ❌ all 34 are **positive** |
| sub-20 IP null-out | ❌ **JUCO-only**; the control group holds **1,799 priced pitchers under 20 IP**, and 17 of the 34 are over 20 IP (max **79.7**) |
**CONTROL:** 4,403 / 4,476 priced D1 returner pitchers have a 2026 Master row ⇒ a Master row normally means a market.
## ✅ THE ANSWER (Trevor's steer was right — the equations were fine)
> *"Check if they are transfer or returner equations… it skipped without an explanation."*
**It never skipped. It was COMPUTED CORRECTLY and then OVERWRITTEN.** The `teamRow` hypothesis was tested and
REJECTED — all 34 resolve to a 2026 Teams row, and 71 priced pitchers have a NULL `team_id` yet still got markets.
**Actual cause:** ONE `returner/regular` row per player, written by BOTH returner precomputes. E37 (hitters) runs
AFTER E36 (pitchers) and wrote `market_value: null` because it had no oWAR — stomping E36's value.
The 34 were exactly the pitchers who ALSO carry a 2026 Hitter Master row (34/34), which is what put them in E37's
scope; they carry E37's fingerprint (`hitter_depth_role` + `projected_pa` set, `o_war` null).
★ **Trevor's instinct about the silence was still the right instinct — it just pointed at a different mechanism.**
Full detail: **REGISTRY #24**.

---
# §3 WHAT IS LEFT IN THE PUSH (dependency order)
```
✅ 0.  THE 34            ← §2. SOLVED 2026-08-31 (REGISTRY #24). Unexplained bucket = 0.
   1.  F43   backfill-neutral-snapshot --prod --apply  →  heal-stale-snapshots --prod --apply --yes
             ⚠ HELD deliberately: F43 writes NEUTRAL snapshots (another user-visible surface) and should not
               land on top of an unexplained blank. Both verified: UUID-filtered, `is_twp` read from `players`,
               safe-by-construction on env (`--prod` SELECTS the env file; `--env-file` cannot redirect).
             ⚠ `heal-stale-snapshots --all` is SHOW_ALL — a DISPLAY flag, NOT scope. Different meaning from F42's --all.
   🛑 2.  G46  REMOVED FROM THIS PUSH (2026-08-31) — moved to the Track B feature branch.
             Delivers nothing prod lacks; still carries REGISTRY #9. ⚠ onboarding trigger ARMED.
   3.  preview-verify (Vercel preview points at PROD) → gh pr create staging→main → **Trevor merges** → Phase H drops
   4.  postseason-inclusive Master sheet import — the CROSS-CHECK/OVERRIDE layer (SB, ERA, G/GS). Derive-then-override.
   5.  STAGING CATCH-UP, run THROUGH TRACK B — see §5, it now has HARD REQUIREMENTS.
```

---
# §4 THE GATES THAT MATTER NOW (use these; a count gate catches none of them)
```sql
-- 1. COMPLETENESS, written the way the UI RESOLVES it (not a column check). Must be 0.
--    Scope to division='D1' — JUCO is parked (see §5).
select count(*) from player_predictions pp join players p on p.id=pp.player_id
where pp.season=2027 and p.division='D1' and pp.p_war is not null
  and coalesce(case when p.is_twp then pp.twp_pitcher_market_value else pp.market_value end) is null;
--    …and the hitter equivalent with o_war / twp_hitter_market_value.

-- 2. TWP ROUTING. Must be 0 on BOTH surfaces.
select count(*) from team_build_players tbp join players p on p.id=tbp.player_id
where p.is_twp and tbp.player_snapshot->>'market_value' is not null;   -- and target_board/transfer_snapshot

-- 3. MARKET IDENTITY — NOT a "$130k/win" threshold (that number is just 25,000 × 4.0 × 1.3, the formula's own max).
--    HITTER: at most THREE distinct $/win per conference (the PVM tiers 1.0 / 1.1 / 1.3)
--    PITCHER: EXACTLY ONE distinct $/win per conference (pitchers have NO position multiplier)
--    Verified 2026-08-31: SEC 100,000 · ACC 37,500 · Big 12 30,000 · Big Ten 25,000 · AAC 20,000 · Big South/CUSA/ASUN 12,500

-- 4. CROSS-SURFACE. A player on both surfaces must price identically.
--    board.twp_*_market_value == build.twp_*_market_value
```
🛑 **ALWAYS LABEL `total` vs `$/win`.** Overbeek is **$232,576 total** at **$100,000 per win**. Comparing a total
against a per-win number reads as a 79% breach when nothing is wrong. This mistake was made and walked back today.

---
# §5 🅱️ STAGING CATCH-UP — HARD REQUIREMENTS DISCOVERED TODAY
Staging is **NOT** a valid reference for TWP markets. Measured 2026-08-31:
| | PROD | STAGING |
|---|---|---|
| D1 TWP rows | 1,256 | 1,707 |
| `twp_hitter_market_value` set | **1,253** | **122** |
| **TWP hitter rows rendering BLANK** | **0** ✅ | **1,582** ❌ |
**The catch-up MUST carry, or staging comes back wrong:**
1. 🔴 **The stage-18 TWP routing fix** (`precompute-transfer-projections.ts:465-466`) — else 1,582 blanks return.
2. 🔴 **`players.is_twp` as the branch** in both snapshot producers — never the snapshot's embedded copy (REGISTRY #21).
3. 🔴 **UUID filter + throw-on-batch-error** on `.in()` lists (REGISTRY #22) — staging's `team_build_players` should be
   checked for NULL `player_id` the way prod's was (**191 of 1,470**).
4. 🔴 **Pitcher market re-derivation** on build snapshots (REGISTRY #23).
5. ⚠ Staging still lacks **C24 / C26 / C27 / C28 / C28b / C29** — the pre-existing gap. Prod is ahead on the
   conference `*_plus` set, `pitcher_ev*`/`iz*` (30/30 vs 0/30), NCAA averages/SDs, ERA source and depth-role anchoring.
★ **The catch-up is the FIRST REAL EXERCISE OF TRACK B — not a hand-run of six scripts.**

---
# §6 🅿️ JUCO — PARKED. DO NOT "FIX".
A full JUCO restructure is coming (**databases move, JUCO merges with D2/D3**). Trevor: *"anything JUCO related is
gonna be tricky or wrong. The consistency is all in D1 NCAA."*
- **2,119 JUCO TWP hitter rows render BLANK** — deliberate. ⚠ Visible to a coach if a JUCO player is on their board.
- Root cause is SCOPE, not a defect: `precompute-transfer-projections.ts:243` defaults to D1-only and
  `_run_step2_all.sh` has never passed `--division`. Running `--division JUCO` would close all 2,119 — **do not.**
- **Scope every gate to `division='D1'`.** A gate spanning all divisions fails on JUCO forever and trains the reader
  to ignore it — which is how a real D1 failure gets waved through.

---
# §7 THE RULES THIS LEG ADDED (full detail in the registry, #18–#23)
1. **A repair step that RE-DERIVES a value the engine already computed is itself the bug.** Only stage 18 knows the
   destination conference; re-pricing downstream from the player's own conference under-prices by the full PTM ratio.
2. **NEVER rebuild a snapshot from a hand-listed field set.** Round-trip the object; overwrite only what you own.
3. **NEVER branch on a flag embedded in a snapshot.** Join to the owning table. A snapshot records VALUES; it is not
   a source of truth for IDENTITY.
4. **NEVER build an `.in()` list from raw FKs.** Filter to well-formed UUIDs and THROW on batch error.
5. **A cosmetic logging anomaly is a data-integrity signal.** `undefined` in a sample line exposed REGISTRY #22.
6. **Never gate on a magnitude derived from the model's own constants** — it moves with the thing it is meant to check.
7. **A backup taken before the PREVIOUS step is not a backup for this one.**
8. **When N sibling paths implement a convention, diff ALL N.** Three of four routed TWP markets correctly; the
   outlier was invisible because its output looked perfectly normal — and a sibling's comment CLAIMED it complied.
