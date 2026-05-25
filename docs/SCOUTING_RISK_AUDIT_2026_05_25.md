# Scouting + Risk Audit — 2026-05-25

Pre-work for AI scouting report scrape + risk assessment recalibration.

---

## TL;DR
- **Risk:** all logic in `src/lib/playerRisk.ts` (981 lines). Composite of 5-7 weighted factors → 0-100 → 4-tier grade (Low/Moderate/Elevated/High). Hitter + pitcher + JUCO variants. Same code feeds main app + Savant + PDF — no drift on risk rendering.
- **Scouting report:** rule-based generator exists at `src/lib/scoutingReportGenerator.ts` (724 lines). Two variants × two lengths (`savant`/`rstriq` × `short`/`full`). Implements ~4 of 7 divergence patterns and ~half of locked archetypes. **PDF doesn't call it** — uses manual `scouting_notes` instead.
- **AI scaffolding:** literally nothing. No `anthropic` dependency, no API key, no edge function, no prompt skeletons, no `ai_scouting_report` column.
- **Recommended order:** lock named archetypes in code first → extract `buildPromptContext()` → ship AI edge function → audit risk thresholds against 2026 outcomes after season closes.

---

## 1. Risk Assessment

### Grade scale (`playerRisk.ts:39-44`)
- Low ≤25, Moderate ≤50, Elevated ≤75, High >75
- Numeric score hidden; UI shows label + colored bar

### Hitter (`assessHitterRisk`, line 908)
| Factor | Weight | Notes |
|---|---|---|
| Projection | 35% | `p_wrc_plus` buckets: ≥150 elite (5), <75 org depth (88) |
| Skillset | 25% | Chase/Contact-centric. Compounding bonus when both elite; compounding penalty when both bad. Power suppressed when chase + contact both bad. Slash-line fallback for no-TrackMan |
| Competition | 20% | Conference Stuff+ buckets (108 elite → <92 unreliable). `CONF_TIER` fallback map |
| Trajectory | 12% | YoY OPS delta |
| Sample Size | 8% | PA bucketed |

### Pitcher (`assessPitcherRisk`, line 939)
| Factor | Weight | Notes |
|---|---|---|
| Projection | 28-30% | `p_rv_plus` buckets |
| Skillset | 20-22% | Anchors: Stuff+ #1, BB% #2. **Pitch profile context gated by `hasWhiff`** — hard-hit/barrel penalties suppressed for high-whiff arms. Peripheral fallback for no-TrackMan |
| Competition | 16-18% | Hitter Talent+ buckets |
| Trajectory | 12% | YoY ERA delta |
| Sample Size | 6-8% | IP bucketed |
| Workload | 8-10% | IP vs class-year thresholds |
| Durability (optional) | 10% | Multi-season IP pattern, catches workload crashes |

### Rendering
- `RiskAssessmentCardRSTR` + `RiskAssessmentCardSavant` (same component, different chrome)
- `JucoHitterRiskCard` + `JucoPitcherRiskCard` (slimmer factor set, adds **Data Reliability** + standalone Stuff+ quality tier)
- Callsites: PlayerProfile, PitcherProfile, Savant Hitter/Pitcher, PDF

---

## 2. Scouting Report Generator

### `src/lib/scoutingReportGenerator.ts` (724 lines)
- Variants: `"savant" | "rstriq"` × `"short" | "full"`
- Archetypes implemented (anonymous booleans):
  - Hitter: `fearedProfile`, `completeProfile`, `powerFirst`, `contactFirst`
  - Pitcher: `sinkerProfile`, `chaseDependentProfile`, `stuffOverCommand`
- Divergence patterns: 4 of 7 implemented
- Premium-position discount (C/SS/CF) ✓
- VAA contextualized with IVB + release height + extension ✓
- Pitcher pitch-profile context (whiff gate) ✓

### Callsites (no drift — shared)
- `PlayerProfile.tsx:940, 1095, 1597`
- `PitcherProfile.tsx:1476, 1641, 2169`
- `savant/pages/HitterPage.tsx:209`
- `savant/pages/PitcherPage.tsx:228`

### PDF disconnect
`pdfGenerator.ts` consumes `scouting_notes` (manual text) + computed risk — does NOT call the generator. When AI reports ship, decide: replace manual block, or render both.

---

## 3. Savant Section

`src/savant/` has its own pages + lib for ratings (Stuff+, wRC+, pRV+, percentiles), but **uses the same risk + report functions as main app**. No duplicate logic to worry about.

Savant-specific:
- `pages/`: SavantHome, HitterPage, PitcherPage, LeaderboardsPage, TeamProfilePage, TeamsListPage, ConferenceStatsPage
- `lib/`: `war.ts`, `wrcPlus.ts`, `prvPlus.ts`, `stuffPlusEngine.ts`, `percentile.ts`, etc.

---

## 4. Framework Implementation Gaps

| Framework piece | Status |
|---|---|
| 9 named archetypes (Stevenson/Amaral/Gracia/Shelton/Flora etc.) | **Partial — boolean composition, not named** |
| Voice rules (no framework vocab, scout verbs) | **Convention only, no enforcement** |
| Opener format `[Hand] [position] with [archetype tag]` | ✓ Implemented |
| 7 divergence patterns | **4 of 7 implemented** |
| Positional discount C/SS/CF | ✓ Implemented |
| Full tier ladder (Top Draft → Org Depth) | **Partial** |
| Pitcher pitch-profile context | ✓ Both risk + generator |
| VAA contextualization | ✓ Implemented |

**Missing divergence patterns:** high Pull+low Barrel, high HardHit+low Barrel, high LA Sweet+low Barrel.

---

## 5. AI Scrape — Current State

**Nothing exists:**
- No `anthropic` / `@anthropic-ai/sdk` dependency
- No `ANTHROPIC_API_KEY` env var
- No edge function for AI generation
- No prompt skeletons
- No storage table/column

**Existing hooks to lean on:**
- `players.scouting_notes` (manual text)
- `coach_notes` table (per-player, per-user)
- Eager-precompute pattern (per-team rows on `player_predictions`) — natural model for per-team AI report variants

---

## 6. Inputs Available to AI Prompt (per player)

### Hitter
- Identity (hand, position, conference, class, height/weight, hometown)
- Production: AVG/OBP/SLG/OPS/ISO/wRC+/PA/BB%/HR/RBI
- TruMedia scouting: contact, chase, whiff, avg_exit_velo, ev90, barrel, la_10_30, line_drive, gb, pull, pop_up — with percentiles + YoY deltas
- Projection: p_avg/p_obp/p_slg/p_ops/p_iso/p_wrc_plus/owar
- Power Rating+: overall + per-component
- Risk assessment output (grade, trajectory, 5 factors with detail strings)
- Coach notes
- Conference / park context

### Pitcher
- Identity (hand, role, conference)
- Traditional: ERA/FIP/WHIP/K9/BB9/HR9/IP
- TruMedia: Stuff+, whiff, IZ whiff, chase, BB%, hard hit, barrel, exit velo, GB, 90th-pct velo
- **Pitch arsenal per pitch:** name, count, velocity, IVB, HB, whiff%, Stuff+, release height, extension, VAA
- Projection: p_era/p_fip/p_whip/p_k9/p_bb9/p_hr9/p_war/pRV+
- Risk output (7 factors incl. Durability + Workload)
- Multi-season IP patterns

---

## 7. Recommended Next Steps

### A. AI Scrape — Build Order

**Prerequisites:**
1. **Schema:** add `ai_scouting_reports` table keyed `(player_id, season, customer_team_id NULL)` with `{ short, full, generated_at, model, prompt_hash }`. Mirrors eager-precompute per-team pattern.
2. **Lock named archetypes** in code matching `project_scouting_report_framework`. Refactor `detectArchetype()` returning `"Stevenson" | "Amaral" | ...`. Rule-based generator uses same labels.
3. **Extract `buildPromptContext(player)`** — already exists implicitly in 4-6 callsites pulling the same shape. One source of truth for both AI + rule-based.

**Build:**
4. Edge function `generate-scouting-report` mirroring `process-precompute-jobs` worker queue pattern. `ANTHROPIC_API_KEY` in Supabase secrets.
5. System prompt = verbatim `project_scouting_report_framework.md` + relevant feedback memories. User prompt = JSON dump of `buildPromptContext(player)`.
6. Batch driver: one-shot at season lock + on-demand "regenerate" button. Cache hit = read jsonb; miss = enqueue.
7. Read hook: `useAiScoutingReport(playerId, season, teamId)` with fallback to `generateHitterReport(..., "rstriq", "short")` so UI never blanks.

**Cost:** ~10K players × ~3K input + 500 output × Haiku 4.5 ≈ **~$15/yr per full regen**. Memory's $25 estimate is conservative.

### B. Risk Audit — Recalibration Targets (post-2026 season)

Highest leverage:
1. **Hitter Skillset thresholds** (`playerRisk.ts:223-330`) — Contact% breakpoints (66.7/68/70/80/85) and chase 22/28/34 hand-set. Validate against actual 2026 wRC+ outcomes.
2. **Projection-tier risk bands** (`playerRisk.ts:97-104` hitter, 120-127 pitcher) — wRC+ → risk mappings. Plot projected vs actual band.
3. **Competition factor** (Stuff+ buckets, line 587) — verify 108/105/102/100/98/96/94/92 ladder monotonic with transfer outcomes.
4. **Pitcher Skillset Stuff+ ladder** (line 411) — `project_stuff_plus_scale_study` already flags this.
5. **Workload thresholds by class** (line 717) — validate against 2026 IP vs 2027 availability.
6. **Durability dropoff logic** (line 766) — rules of thumb; validate against injury data when available.

### Parallel vs Sequence
**Do A and B in parallel** — A's prerequisite (named archetypes) makes B easier (recalibrate "tune threshold that produces archetype X" vs tuning magic numbers blind). After that:
- AI scrape = build-and-ship (independent of audit data)
- Risk audit = data project gated by season-end 2026 outcomes

Zero merge collision risk — different surfaces.

---

## Drift Risks to Note

1. **PDF doesn't call generator** — fix when AI lands.
2. **Voice rules are convention only** — recommend mirroring `project_scouting_report_framework.md` into `src/lib/scoutingFramework.ts` as a string constant. Single source of truth for both system prompt and human reference.
3. **Risk weights duplicated in 3 places** — main `assessHitterRisk`/`assessPitcherRisk` + Juco card weights. Recalibration must touch all three.

---

## Key Files

| File | Purpose |
|---|---|
| `src/lib/playerRisk.ts` | All risk assessment logic (981 lines) |
| `src/lib/scoutingReportGenerator.ts` | Rule-based report (724 lines) |
| `src/components/RiskAssessmentCard.tsx` | Risk renderer (RSTR + Savant variants) |
| `src/components/JucoRiskCards.tsx` | JUCO-specific risk cards |
| `src/components/ScoutingReport.tsx` | Report renderer |
| `src/lib/pdfGenerator.ts` | PDF export (currently uses manual notes, not generator) |
| `src/lib/jucoDataReliability.ts` | JUCO data quality tiering |
| `src/savant/pages/HitterPage.tsx` `:209,255` | Savant hitter consumers |
| `src/savant/pages/PitcherPage.tsx` `:228,280` | Savant pitcher consumers |
