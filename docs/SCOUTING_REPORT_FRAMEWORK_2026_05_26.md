# Scouting Report Framework — Master Reference

**Captured 2026-05-26.** Source of truth for all scouting report generation (rule-based + future AI scrape). Reads alongside:
- `src/lib/scoutingPercentiles.ts` — empirical D1 distribution constants
- `src/lib/scoutingArchetypes.ts` — named archetype enums + detection
- `src/lib/scoutingReportGenerator.ts` — generator (to be refactored against this doc)
- Memory: `project_scouting_report_framework.md` + companion feedback memories

---

## I. Universal rules

### Tier ladder (every metric)
- **Elite:** P95+ (top 5%) — **use sparingly across the board**
- **Plus:** P75–P95
- **Above avg:** P60–P75
- **Average:** P40–P60
- **Below avg:** P25–P40
- **Poor:** P10–P25
- **Bottom:** <P10

Direction-aware via `tierFor()` — for lowerBetter metrics (chase, BB%, hard hit, etc.), tier maps in reverse so "elite" still = best for the player.

### Single variant
- **One report version, Savant-detailed (full numeric).** No separate RSTR IQ qualitative version going forward. Base tier coaches benefit from detail, not less.

### Defer JUCO
- **Don't auto-generate scouting reports for JUCO players** — data too limited (TruMedia coverage gaps, no reliable scouting feed). Mark as future work.
- For any pitcher with limited TrackMan: **"stuff data not consistent"** — do not extrapolate.

### Voice rules (verbatim from locked framework)
- **"Data"** = scouting/process metrics. **"On-field production"** = outcome stats (AVG/OBP/SLG/wRC+/ERA etc.)
- Never use "inputs"/"outputs"/"process"/"outcome" in prose
- Cite numbers freely (coaches love detail) but never explain what a metric means
- No "X combined with Y reads as Z" — just say Z
- No framework vocabulary in reports (no "process vs outcome," no "which is how you want to see it")
- Scout verbs: **turns on, hunts, drives, chases, stays in, pounds, spins, misses, barrels, runs into**
- Every sentence should read like a coach talking
- Don't over-cite confirmation stats — one confirmation is enough
- Don't narrate YoY development unless it's a flag
- Competition concerns: state and move on, no closing argument
- Avoid generalized "college vs pro" speculation paragraphs
- Use "and" not "on" when joining two stats
- Use "BB" not "walks"
- No team/school in opener — lives in report header metadata

### Opener format
- **Hitters:** `[Bat hand] hitting [position] with [archetype tag]`
- **Pitchers:** `[Power/finesse/crafty] [throw hand] arm with [primary descriptor]`

### Report structure (all players)
1. Archetype tag + primary strength (applaud first)
2. Data walkthrough — approach, power/stuff, batted ball/pitch profile
3. Flag / divergence (if any) — stated directly, not softened
4. Trajectory — only when it's a concern (plateau, regression, hot stretch). Positive default; don't narrate.
5. Competition note if relevant
6. Closer — role projection + ceiling/floor

---

## II. Hitter framework

### Stat classification
- **Data (process):** Contact%, Chase%, Avg EV, EV90, Barrel%, Hard Hit%, LD%, GB%, Pull%, Pop-Up%, BB%, LA Sweet Spot, **Pull Air%** (new 2026-05-25)
- **On-field production (outcome):** AVG, OBP, SLG, OPS, ISO, wRC+

### Empirical percentile tiers (D1 2026, PA ≥ 75, n ≈ 3,359)

| Metric | Direction | P10 | P25 | P50 | P75 | P90 | P95 | Elite (P95+) |
|---|---|---|---|---|---|---|---|---|
| Contact% | higher | 67.5 | 72.3 | 77.3 | 82.0 | 85.8 | 87.7 | **≥88%** |
| Chase% | lower | 16.5 | 19.3 | 23.0 | 27.0 | 31.0 | 33.5 | **≤17%** |
| Avg EV | higher | 80.0 | 83.1 | 86.0 | 88.8 | 90.9 | 92.3 | **≥92** |
| EV90 | higher | 96.6 | 99.0 | 101.6 | 104.0 | 106.1 | 107.5 | **≥108** |
| Barrel% | higher | 6.6 | 11.5 | 16.8 | 21.9 | 26.5 | 28.9 | **≥29%** |
| Pull Air% | higher | 0.0 | 2.9 | 7.4 | 11.7 | 15.7 | 19.0 | **≥19%** |
| Line Drive% | higher | 16.1 | 18.9 | 21.8 | 25.0 | 27.8 | 29.4 | ≥29% |
| GB% | lower | 31.4 | 36.2 | 41.9 | 47.8 | 53.4 | 57.0 | ≤31% |
| Pull% | higher | 27.3 | 31.9 | 37.1 | 42.3 | 47.3 | 50.5 | ≥51% |
| LA Sweet 10–30 | higher | 21.1 | 24.7 | 28.8 | 32.8 | 36.6 | 38.9 | ≥39% |
| Pop-Up% | lower | 3.5 | 5.4 | 7.8 | 10.4 | 13.0 | 14.5 | ≤4% |
| BB% | higher | 6.4 | 8.5 | 10.8 | 13.5 | 16.1 | 17.9 | **≥18%** |

### Hierarchy of importance
**Barrel% is the most predictive single stat** for hitter success (though that's evolving). It's not absolute — power eval is holistic:

1. **Barrel%** — power output, includes 95+ EV component
2. **Pull Air%** — modern power valuation, the missing translator from avg EV to game power
3. **Chase + Contact** — the discipline axis
4. **Avg EV + EV90** — the engine (bat speed via EV90, consistency via Avg EV)
5. **BB%** — process signal, chase predicts future BB% more than BB% itself

### Compound rules (interactions)

**Power axis interactions:**
- **Barrel includes 95+ mph EV** — rarely see high barrel + low EV
- **Pull Air% with average EV** = more translatable power than barrel alone (Bregman archetype). Pulled balls don't need 95+ mph to clear LF (330 ft) but do to clear CF (400 ft).
- **EV90 elite + Avg EV only above-avg** → small consistency flag. "Engine is there, accessing intermittently." Not raw power flag.
- **High Pull + Low Barrel + Plus Pull Air** → low-EV hitter who pulls in air — Bregman type. Needs avg EV at P40+ for it to actually translate; below P40 still flies out.
- **High Hard Hit + Low Barrel** → LA consistency unlocks more power
- **High LA Sweet + Low Barrel** → needs strength/bat speed
- **High EV90 + Low Avg EV** → "raw power" — output inconsistencies but power in tank

**Discipline axis interactions:**
- **Chase predicts future BB%** more than BB% itself does. Chase is the truer process signal.
- **Tricky combo (high chase + high BB%)** — rare, BB% likely to regress next year. Could be an approach that bears down with two strikes.

### Approach language ladder
| Phrase | Chase | BB% |
|---|---|---|
| **Elite approach** | plus+ | **elite** (BB% drives the "elite" descriptor — BB% is what makes approach truly elite) |
| **Plus approach** | above avg+ | plus |
| **Solid eye / high-level decisions** | above avg | average |
| **Elite swing decisions** | elite | (BB% lagging — expands zone aggressively) |
| **Plus swing decisions** | plus | above avg |

### Contact framing (competition-aware)
| Contact tier | Default | Power conf (SEC/ACC/Big 12) | Mid/low major |
|---|---|---|---|
| Elite (≥88%) | strength | strength | strength |
| Plus (82–88) | strength | strength | strength |
| Above avg (80–82) | solid | solid | solid |
| Average (75–80) | solid | solid | solid |
| Below avg (72–75) | **⚠️ flag** | acceptable* | flag |
| Poor (68–72) | flag | flag (less harsh) | major flag |
| Bottom (<68) | major flag | major flag | red flag |

*Power-conf hitter at 72–75 acceptable because the stuff they faced is real. Mid-major hitter at same number = bigger concern.

### Hitter evaluation philosophy
> **"You can swing and miss but you can't chase. You can chase but you can't swing and miss. Power hitters who swing and miss have a chance if they don't chase, but if they do, typically not good."**

- Chase + miss = compounding risk (feared profile)
- Power + miss + discipline = "has a chance" (Stevenson)
- Power + chase = variance bat (Shelton)
- Contact + chase plus + no power = limited ceiling (Amaral / contactFirst)

### Hitter archetypes (named + catch-all)

**Stevenson — premium-pos power, disciplined despite miss**
- Premium position (C/SS/CF)
- Plus/elite power (EV, EV90, or barrel)
- Bad contact (poor or worse — P25-)
- **Plus+ chase (P75+)** — the discipline rescues the contact miss
- Description: High ceiling / high variance. Power-first profile at a premium defensive position. Contact concerns paired with elite discipline — he picks his spots and the power plays. Top-draft type if contact ticks up; everyday catcher floor at the defensive position even if not.

**Amaral — premium-pos contact-first, capped ceiling**
- Premium pos
- Elite contact (P95+)
- Plus chase
- No power (all power tools below P50)
- Description: Low variance / capped ceiling. Premium-position contact-first hitter (typically SS) with elite contact and plus discipline but no power tools. High-floor regular at a premium position; ceiling is everyday role rather than impact bat.

**Gracia — complete profile with production gap**
- Premium pos
- Plus+ contact + plus+ chase + plus+ power
- Pop-up flag (P25- on pop_up) OR general "data >> production" gap
- Description: Premium-position bat with elite data across the board but production hasn't fully caught up. Often a pop-up flag muting outcomes. Data points to a star-level outcome once the LA stabilizes.

**Shelton — power + ultra-aggressive variance bat**
- Plus+ power
- **Ultra-aggressive chase (P10-, bottom tier)**
- Contact varies — when contact comes, big; when it goes, bottoms out
- Description: Plus power tools paired with ultra-aggressive approach. Big YoY swings because production fluctuates with contact rate. Premium bat when it clicks; exposed by upper-level pitching when it doesn't.

**Bregman — directional power, average-or-above EV**
- **Avg EV at P40+ (average or above — NOT low EV)**
- Plus Pull Air% (P75+)
- Above-avg+ barrel (P60+, not required to be plus)
- Approach/discipline NOT relevant — separate eval
- Description: Directional power hitter who plays above his raw EV. Pulls the ball in the air at a plus rate, which translates to game power even without elite raw exit velocity. Barrel often "good but not plus" — pull air is the differentiator.

**Catch-all archetypes:**
- **feared:** bad chase + bad contact (the compounding-risk profile; power doesn't fully rescue)
- **complete:** plus across the board (non-premium position)
- **powerFirst:** power + barrel but contact concerns (non-premium)
- **contactFirst:** contact + chase plus, no power (non-premium)
- **balanced:** doesn't fit any pattern

### Divergence patterns (write directly, don't soften)
- High Barrel% + Low LA Sweet Spot → miss-hit profile, variance flag
- High Contact% + Low Avg EV → requires elite LA Sweet Spot, plus runner/defender, limited ceiling
- Low Chase% + Low Contact% → super risky ("feared profile")
- High EV90 + Low Avg EV → "raw power" — power in tank, inconsistent access
- High Pull% + Low Barrel% → LA fix unlocks more power
- High Hard Hit% + Low Barrel% → LA consistency unlocks power
- High LA Sweet Spot + Low Barrel% → needs strength/bat speed
- Data >> Production (all process elite, production only plus) → "data points to even more upside" — frame positively, not criticism

### Trajectory
- Evaluate scouting **data**, not production. Production rises naturally in college.
- Flat data = plateau. Data down = regression (even if production holds).
- Any process metric going down outside same percentage point = red flag, especially as hitters age.
- Contact%, chase%, EV/EV90 expected to improve with maturity.
- Big YoY swings raise "progression vs hot stretch" question — but data rises alongside production during hot stretches, so can't fully attribute. Don't explain this mechanism in reports.

### Positional discount
- C / SS / CF get slack across EVERYTHING, not just average
- Every other position needs higher outputs across the board

### Physical development callout
- When plus process + plus (but not elite) tools: "If [specific tool] ticks up, he profiles as [ceiling]"

### Tier ladder (closer)
Top draft / All-American / All-Conference / Regular starter / Role player / Bench / Org depth

---

## III. Pitcher framework

### Empirical percentile tiers (D1 2026, IP ≥ 20, n ≈ 2,772)

| Metric | Direction | P10 | P25 | P50 | P75 | P90 | P95 | Elite (P95+) |
|---|---|---|---|---|---|---|---|---|
| Stuff+ | higher | 94.1 | 97.5 | 101.4 | 105.4 | 109.3 | 111.4 | **≥111** |
| BB% | lower | 6.0 | 8.0 | 10.2 | 12.8 | 15.5 | 17.2 | **≤6%** |
| Chase% | higher | 17.9 | 20.8 | 23.7 | 26.6 | 29.1 | 30.5 | **≥30.5** |
| IZ Whiff% | higher | 10.9 | 13.3 | 16.1 | 19.2 | 22.6 | 24.9 | **≥25%** |
| Total Whiff% | higher | 16.7 | 19.5 | 22.9 | 26.8 | 31.1 | 33.6 | **≥34%** |
| Hard Hit% | lower | 26 | 30 | 35 | 40 | 44 | 47 | ≤26% |
| Barrel% | lower | 10.9 | 14 | 17 | 20 | 23.2 | 25.6 | ≤11% |
| Exit Velo | lower | 82.7 | 84.6 | 86.3 | 87.9 | 89.2 | 90.1 | ≤83 |
| Ground% | higher | 32.7 | 37 | 41.9 | 47.2 | 52.1 | 55.3 | ≥55% |
| Line% | lower | 16.4 | 19 | 21.8 | 24.5 | 27.1 | 28.7 | ≤16% |
| H Pull% | lower | 29.3 | 32.6 | 36.7 | 40.9 | 44.7 | 47.0 | ≤29% |
| LA 10–30% | lower | 21.8 | 25.3 | 28.8 | 32.4 | 36.0 | 38.1 | ≤22% |

### Skillset hierarchy (locked)
1. **Stuff+** — anchor #1, not close
2. **BB%** — anchor #2, biggest variance driver. BB% is PROCESS (throwing strikes = learned skill, not competition-dependent)
3. **IZ Whiff%** — truest stuff validator (more important than overall whiff)
4. **Hard Hit% / Barrel%** — red flag when elevated WITHOUT whiff to justify it. Read in pitch profile context.
5. **Whiff% (total)** — polluted by chase; only meaningful with IZ whiff context
6. **Chase%** — descriptive, mostly a breaking ball quality metric. Don't over-weight.
7. **GB%** — translatable floor for sinker profiles, valuable commodity (rarely XBH)
8. **Exit Velo** — competition-dependent, low weight

### Compound rules

**Stuff validation:**
- **Stuff+ has heavy velocity weight** — IZ Whiff at ~P95 (25%+) can unlock "elite stuff" descriptor for non-velo arms (spin/movement) even at Stuff+ 108
- **Pitch movement (Stuff+) AND batter result (whiff) BOTH matter** — "how the pitch plays against the barrel is as important as how it moves in space"
- **High whiff + low IZ whiff** → whiff inflated by chase, exposed at higher levels (chase-dependent profile)
- **Both whiff and IZ whiff plus** → real bat-misser, real swing-and-miss stuff
- **Average whiff + plus IZ whiff** → rare, "stuff plays" — likely pitch usage issue

**Command:**
- **BB% drives more than chase** — Hagen Smith example (good breaking balls force chase → BB% drops naturally, masks underlying command)
- **Plus/elite stuff + bad BB%** = **"reliever risk"** (canonical term). Not a starter projection. Today's baseball, elite stuff that walks people doesn't see the field.
- **Avg stuff + bad BB%** = brutal. Major flag.

**Contact red flags:**
- **Barrel% = #1 contact red flag** (HRs + extra-base hits)
- **Hard hit higher impact in COLLEGE vs MLB** — defensive positioning gap. What's a GO-to-short in MLB is a base hit in college.
- **High hard hit no whiff = feared profile** (not just barrel — hard hit alone is feared too)
- **Pitch shape vs result divergence tells the quality story** — 4S with high GB = funky. Sinker with high FB rate = something missing.

**Transfer-up adjustments:**
- Moving up a level → expect whiff DOWN + hard hit UP
- Mid-major chase doesn't translate cleanly — SEC hitters don't expand zone against average stuff
- Flag (not red flag) when projecting up-level outcomes

**4-seam FB-specific:**
- **High IVB 4S FB → high whiff + high hard hit is EXPECTED, not red flag** ("high-vert fastball" pattern, Garrett Cole archetype but don't name it Cole — just describe the shape)
- Mention barrel as typical for the shape rather than flag it
- **The "illusion combo"**: low release + high IVB = creates flat-VAA effect even without elite VAA
- **Market inefficiency flag**: high IVB + low release + low whiff = pitch USAGE issue, not stuff. Coaching adjustment: "throw it at top of zone more — there's more here"

### Pitcher archetypes (named + catch-all)

**Flora — elite stuff + elite command**
- Stuff+ P95+ (≥111) OR Stuff+ ~108 with IZ whiff P95+ (≥25%) — the IZ whiff validates elite-tier
- BB% P95+ (≤6%) — elite command
- Description: Power arm with elite stuff and elite command. Typically anchored by a 4S FB attacking the top of the zone. Plus secondary that misses bats. Top-of-rotation profile.

**chaseDependent — high chase, low IZ whiff**
- Above-avg+ chase
- Below-avg IZ whiff
- Below-avg total whiff
- Description: Misses come from chase, not stuff. Vulnerable at higher levels where hitters lay off out-of-zone.

**sinker — plus GB profile**
- Plus+ GB (P75+) — no command requirement (GB result tells the story alone)
- If +command: "true sinker profile"
- If bad command: "ground-ball reliever risk"
- Description: Ground balls confuse hitters and rarely go for extra-base hits — valuable commodity. Plus command + plus GB = backend rotation profile.

**stuffOverCommand — plus stuff, bad command**
- Plus+ stuff
- Bad BB% (P25-)
- = "Reliever risk" canonical flag
- Description: Plus or elite Stuff+ but doesn't pound the zone. High-leverage reliever ceiling; rotation outcome depends on strike-throwing development.

**command — avg stuff, plus command**
- Plus command (P75+)
- Not plus stuff
- Description: Crafty arm. Backend rotation or middle reliever, surviving on location and sequencing rather than raw stuff.

**balanced** catch-all

### Pitcher evaluation philosophy
> **"Any time there's no command, you run the risk of being a reliever."**

- "Reliever risk" = canonical flag layer (not standalone archetype)
- Used when BB% bad regardless of stuff tier

### Fastball-specific evaluation order
1. **Whiff rate first** — primary gauge
2. **Stuff+ second** — quantifies the shape
3. Individual components (IVB / release / extension / VAA) only when whiff + Stuff+ diverge or need explanation

---

## IV. Pitch-shape evaluation (per-pitch type)

### 4-seam fastball (4,596 D1 pitches 2026, ≥30 thrown)

| Component | Elite | Plus | Above avg | Average | Below avg | Poor |
|---|---|---|---|---|---|---|
| Velo (mph) | ≥94 | 91–94 | 90–91 | 88–90 | 87–88 | <87 |
| IVB (in) | ≥21 | 18–21 | 17–18 | 14–17 | 13–14 | <13 |
| Extension (ft) | ≥6.7 | 6.3–6.7 | 6.0–6.3 | 5.7–6.0 | 5.6–5.7 | <5.6 |
| VAA (flatter = top-of-zone) | ≤−4.7 | −4.7 to −5.0 | −5.0 to −5.4 | −5.4 to −5.8 | <−5.8 (steep) | — |
| Stuff+ | ≥114.8 | 106.8–114.8 | 101.1–106.8 | 95–101 | 88–95 | <88 |
| Whiff% | ≥30 | 21–30 | 17–21 | 12–17 | 9–12 | <9 |

**4S FB framing:**
- **VAA = "attacking the top of the zone"** — canonical phrase. Flatter VAA + high IVB defies gravity.
- **The illusion combo**: low release + high IVB → creates top-of-zone effect even without elite VAA itself
- **Velocity is king in college** — true elite heaters have flat VAA + high IVB + plus+ velo. Extension is bonus.
- **Market inefficiency**: high IVB + low release + low whiff = pitch usage issue. Recommend: "throw it at top of zone more."

### Sinker (1,152 D1 pitches 2026, ≥30 thrown)

| Component | Elite | Plus | Above avg | Average | Below avg | Poor |
|---|---|---|---|---|---|---|
| Velo (mph) | ≥94 | 91–94 | 90–91 | 88–90 | 87–88 | <87 |
| IVB (in, lower=better) | ≤7 | 7–10 | 10–13 | 13–14 | >14 | — |
| ABS HB (in, more run) | ≥20 | 17–20 | 15–17 | 12–15 | <12 | — |
| Extension (ft) | ≥6.6 | 6.2–6.6 | 5.9–6.2 | 5.7–5.9 | <5.7 | — |
| Stuff+ | ≥116 | 108–116 | 103–108 | 98–103 | 93–98 | <93 |
| Whiff% | ≥29 | 20–29 | 14–20 | 10–14 | <10 | — |

**Sinker framing:**
- **HB sign convention**: P10 = −16.6, P50 = +15.7 → bimodal because LHP/RHP have opposite signs. **Always use ABS(HB)** for "arm-side run" framing.
- **Velocity is king on sinkers too** — eval order: velo → GB rate → IVB/HB (Stuff+ already quantifies shape)
- **"Bowling ball" descriptor** — low IVB + heavy arm-side run = falls off table late, heavy movement
- **Low whiff is expected** — sinker = contact pitch. Whiff <P50 doesn't earn a flag if GB result is plus.
- **Sinker whiff is bonus** — when present (P75+ rare), describe as "valuable extra — missing bats with what should be a contact pitch"
- **Don't worry about VAA on sinkers** — naturally steep, not informative
- **Don't worry about anti-pattern sinkers** (4S misflagged as sinker, etc.) — source data limitation, would require reclassification we don't have time for
- **High release + low IVB sinker = nasty** (rare)

### Remaining pitch types (TO DO — same query pattern)
- Slider
- Sweeper
- Curveball
- Gyro Slider
- Changeup
- Cutter
- Splitter

**Per-pitch eval principles already locked from framework:**
- Breaking balls: **whiff% first, Stuff+ second** — don't try to explain components
- Changeup: Stuff+ grades it, whiff confirms. Similar to breaking ball.
- Call out standout pitches specifically (e.g., "sweeper is a huge asset with 45.1% whiff")

---

## V. Risk assessment framework (separate from report)

Per `playerRisk.ts`:

**Grade scale:** Low ≤25, Moderate ≤50, Elevated ≤75, High >75. UI shows label + colored bar.

### Hitter (assessHitterRisk)
| Factor | Weight |
|---|---|
| Projection | 35% |
| Skillset (chase/contact-centric) | 25% |
| Competition | 20% |
| Trajectory | 12% |
| Sample Size | 8% |

### Pitcher (assessPitcherRisk)
| Factor | Weight |
|---|---|
| Projection | 28–30% |
| Skillset (Stuff+ #1, BB% #2) | 20–22% |
| Competition | 16–18% |
| Trajectory | 12% |
| Sample Size | 6–8% |
| Workload | 8–10% |
| Durability (optional) | 10% |

### Recalibration targets (post-2026 season)
1. Hitter Skillset thresholds vs 2026 actual wRC+ outcomes
2. Projection-tier risk bands
3. Competition factor (Stuff+ buckets) — verify monotonic with transfer outcomes
4. Pitcher Stuff+ ladder (SD=10 assumption — `stuff_plus_scale_study` punchlist)
5. Workload thresholds by class — validate against 2026 IP vs 2027 availability
6. Durability dropoff logic — validate against injury data

---

## VI. AI scrape architecture (planned)

### Prerequisites
1. Lock named archetypes (DONE — `src/lib/scoutingArchetypes.ts`)
2. Drop variant split (Savant version only — TBD)
3. Extract `buildPromptContext(player)` (TBD)
4. Add `ai_scouting_reports` table keyed `(player_id, season, customer_team_id NULL)`

### Build
5. Edge function `generate-scouting-report` mirroring `process-precompute-jobs` worker queue pattern
6. `ANTHROPIC_API_KEY` in Supabase secrets
7. System prompt = THIS DOC verbatim + framework memory references
8. User prompt = JSON dump of `buildPromptContext(player)` including named archetype label
9. Cache jsonb; fallback to rule-based generator if AI miss

### Cost (Haiku 4.5)
~10K players × ~3K input + 500 output tokens ≈ **~$15/yr per full regen**

### Read hook
`useAiScoutingReport(playerId, season, teamId)` → returns `{ data, isLoading, fallback }`. Falls back to rule-based.

---

## VII. Open work items

- Run pitch-shape queries for Slider, Sweeper, Curveball, Gyro Slider, Changeup, Cutter, Splitter
- Display Pull Air% on Savant hitter percentile bar + PlayerProfile data row
- Lock the "Bregman" archetype detection in `scoutingArchetypes.ts` (currently not in the enum)
- Refactor `scoutingReportGenerator.ts` to use named archetypes + tier-driven language
- Strip the `savant`/`rstriq` variant split — keep Savant-detailed only
- Extract `buildPromptContext(player)` helper
- Create `ai_scouting_reports` table migration
- Edge function for AI generation
- Switch PDF report from `scouting_notes` to AI report when AI rolls out

---

## VIII. Memory references

- `project_scouting_report_framework.md` — original locked framework
- `feedback_chase_contact_risk.md` — chase + contact nuance
- `feedback_pitcher_framework.md` — pitcher rules
- `feedback_vaa_analysis.md` — VAA + release height + extension context
- `project_partial_scouting_gap.md` — sparse scouting handling
- `project_risk_assessment_model.md` — risk model spec
- `project_stuff_plus_scale_study.md` — Stuff+ SD calibration
- `project_ai_scouting_reports.md` — AI plan + cost estimates
