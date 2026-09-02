# Power Ratings — How It All Works (synopsis, 2026-08-11)

How every power rating is calculated, what it does, how it feeds projections, who leads, and what the data shows.
Verified on staging after the pagination + `in_zone_pct` fixes and a clean store re-run (0 errors).

## The pipeline (one line)
**raw scouting metrics → percentile scores → weighted composites (the "+"-stats / power ratings) → these STEER
the projected rates (0.7 scouting / 0.3 last-year) → projected rates feed the quality metric (wRC+ hitters,
D1-FIP pitchers) → WAR.** Power ratings are the *skill engine*; they don't score anyone directly, they bend next
year's projected rate toward the player's underlying skill.

## The atom — percentile scoring
Every raw metric becomes a **0–100 percentile** via a normal curve against the D1 mean/SD (`ncaa_averages`
table, per season), inverted for "lower is better" (walks, chase, pop-ups, GB, hard-hit). 50 = D1 average.

---

## Hitter power ratings
Inputs: contact%, line-drive%, avg EV, pop-up%, BB%, chase%, barrel%, EV90, pull%, LA 10–30°, GB%.

| Rating | Composite (percentile inputs) | Projects |
|---|---|---|
| **baPlus** | 0.35 contact + 0.20 lineDrive + 0.30 avgEV + 0.15 popUp | AVG |
| **obpPlus** | 0.20 contact + 0.10 lineDrive + 0.15 avgEV + 0.10 popUp + 0.40 BB + 0.05 chase | OBP |
| **isoPlus** | 0.30 barrel + 0.35 EV90 + 0.10 pull_air + 0.25 GB | ISO |
| overallPlus | 0.25 baPlus + 0.40 obpPlus + 0.35 isoPlus | *(computed, UNUSED)* |

*(Composites refit on 2026 data 2026-08-11 — see WAR_CHANGELOG. obpPlus built to OBP's measured 57/43 hits/walks
split; isoPlus uses pitch-log **pull_air** [pulled-in-air %] + dropped redundant la.)*

Each composite `/50·100` → "+" scale (100 = average). **Skill grades, process over results.**

Leaders (everyday, PA≥150; n=2,340): baPlus — Nick Williams (MSU), Hudson Brown (UK), Caden Ferraro (TTU .372/.481/.601);
obpPlus — Ferraro, Hudson Brown, Miguel Morales (.494 OBP); isoPlus — Jett Music (Campbell .490 ISO), Amundson (.412),
Primrose (.466). Dist: median ~106–109 (everyday > 100, correct), ISO widest (p10 40 → p90 163).

---

## Pitcher power ratings
Inputs: whiff%(miss), BB%, hard-hit%, in-zone-whiff%, chase%, barrel%, LD%, EV, GB%, **in-zone%**, EV90, pull%, LA,
**Stuff+**. Stuff+ = per-pitch shape z-scored vs the D1 pitch-type×hand population, recentered to 100, rolled up
pitch-count-weighted; it is an INPUT to k9⁺/era⁺, not a standalone rating.

| Rating | Composite (percentile inputs) | Projects |
|---|---|---|
| **k9Plus** | 0.35 whiff + 0.30 Stuff+ + 0.25 izWhiff + 0.10 chase | K9 |
| **bb9Plus** | 0.55 BB + 0.30 inZone + 0.15 chase | BB9 |
| **hr9Plus** | 0.15 barrel + 0.30 hard_hit + 0.30 GB + 0.25 pull *(refit; ev90+la dropped, hard_hit added)* | HR9 |
| **eraPlus** | 0.30 BB + 0.25 whiff + 0.20 Stuff+ + 0.15 hardHit + 0.05 chase + 0.05 barrel *(refit; izWhiff dropped)* | ERA |
| **whipPlus** | 0.30 BB + 0.45 whiff + 0.25 Stuff+ *(refit; WHIP 71/29 hits/walks, miss-bats hit-suppression)* | WHIP |
| **fipPlus** | 0.45 hr9Plus + 0.30 bb9Plus + 0.25 k9Plus (derived from the three) | FIP |

Missing Stuff+ → its weight **redistributes** across the others (not defaulted to average).

Leaders (IP≥40; n=1,325): k9⁺ — Dax Whitney (Ore St 14.86 K9, Stuff 121), Wyatt Queen (14.94); bb9⁺ — Kevin
Robinson (0.47 BB9), Connor Lockwood (0.87); hr9⁺ — Austin Berggren (0.61 HR9), David Rossow; era/fip/whip⁺ —
Berggren (Miami OH, FIP 2.39 on 3.65 ERA) + Rossow (Campbell 2.53/2.61) are the model's complete-pitcher darlings.
Dist: k9⁺ widest tail (max 199, Stuff-driven); bb9⁺ median 135 (selection — 40+ IP arms walk fewer); era/fip/whip⁺
tighter (~106–111).

---

## How ratings impact projections
Per stat: `zShift = ((prPlus − 100)/pr_sd) · ncaa_sd` → `powerAdjusted = ncaa_avg + zShift` →
`projectedRate = 0.3·lastYearActual + 0.7·powerAdjusted` (thin-sample hitters bump to 0.1/0.9). Then:
- **Hitter:** projected AVG/OBP/SLG → **wRC+ (C1)** → oWAR.
- **Pitcher:** projected K9/BB9/HR9 → **D1-FIP** → pRV+ → pWAR. (era⁺/whip⁺ steer their own projected rates for
  display; the pWAR *currency* rides the FIP index on projected K9/BB9/HR9, NOT the old +stat blend.)
- **Opportunities** (PA/IP) come from **depth role**, not stored projected_ip.

## Fallbacks (all verified firing on staging)
1. Multi-season blend for small samples (`combined_used`: 1,611 P / 1,041 H) — now pulls ALL priors (pagination fixed).
2. Thin-sample power-weight bump 0.7→0.9 (hitters, `combined_used`).
3. Stuff+ missing → weight redistributes.
4. `in_zone_pct` was null for all 2026 D1 → backfilled from pitch log (98%); BB9⁺ un-flattened (elite control 168→198).
5. No batted-ball tracking (158 hitters, ~3%) → null rating → actuals-only projection.
6. Depth-role IP/PA opportunity defaults; transfer neutral-substitution; JUCO verbatim/override path.

## What the data shows
- **Grades match reality** on both sides — best everyday grades are the right players.
- **Process over results is the design** — a .294 contact hitter (Ineich) grades 174; Berggren (2.39 FIP / 3.65 ERA)
  tops fip/whip/hr9⁺. Skill can diverge from surface stats by intent.
- **Persistence data (2022–2026) supports the weighting** — sticky skills (contact 0.65, K9 0.53) weighted over
  noisy outcomes (AVG 0.26, HR9 0.13). See [[project_war_projection_persistence_deferred]].
- **0 null pitcher ratings; 158 null hitter ratings** = genuine untracked-data cases, correctly → actuals-only.
