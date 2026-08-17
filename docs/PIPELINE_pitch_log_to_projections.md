# THE PIPELINE — pitch-log upload → Stuff+ → power ratings → projections → NIL/display (2026-08-17)

The "one process." Today it's **scattered manual scripts**; the goal (Track B) is ONE function that fires on ingest and
runs the whole chain, storing everything. This doc is the map: every stage, what it computes, where it STORES (DB), and
where it DISPLAYS. Companion build plan for the Stuff+ leg: `HANDOFF_STUFF_PLUS_2026_08_16.md`.

## Flow diagram

```mermaid
flowchart TD
    %% ---- INGEST (two lanes) ----
    CSV1["Pitch Log CSV<br/>(TruMedia, per-pitch)"] --> PL[("pitch_log<br/>velo, ivb, hb, spin, rel, ext,<br/>game_venue_id, outcomes")]
    CSV2["Master stat CSVs<br/>(TruMedia, season)"] --> HM[("Hitter Master<br/>AVG/OBP/SLG, PA, batted-ball")]
    CSV2 --> PMA[("Pitching Master<br/>ERA/FIP/WHIP, IP, K/BB/HR")]

    %% ---- DERIVE from pitch_log ----
    PL --> SPI[("pitcher_stuff_plus_inputs<br/>per pitcher x pitch_type x season")]
    PL --> DEF[("player_season_defense<br/>dRS")]
    PL --> BSR[("player_season_baserunning<br/>wSB")]
    PL --> HD["batted-ball derivations<br/>pull_air, in_zone_pct, spray, zone"]

    %% ---- STUFF+ process (THE BUILD) ----
    subgraph SP["STUFF+ process  (the build)"]
      SPI --> RC["1 Reclassify<br/>breaking-ball + NEW fastball classifier<br/>off MOVEMENT, not the TrackMan tag<br/>(venue-corrected)"]
      RC --> BASE[("2 pitcher_stuff_plus_ncaa<br/>baseline per pitch_type x hand<br/>RE-DERIVED post-reclass, stamped classification_version")]
      BASE --> SCORE["3 Score 9 equations<br/>Stuff+ = 100 + 20 * sum(w*z)"]
      SCORE --> RECEN["4 Recenter each (type x hand) bucket -> mean 100"]
    end
    RC --> PLR["pitch_log.pitch_type_reclassified"]
    RECEN --> PLSP["pitch_log.stuff_plus + pitcher_stuff_plus_inputs.stuff_plus"]
    RECEN --> CONFSP[("Conference Stuff+ V2<br/>pitch-weighted -> Conference Stats")]
    RECEN --> PMSP["Pitching Master.stuff_plus (per-player)"]

    %% ---- MARRY pitch-log derivations onto Masters ----
    HD --> HM
    DEF --> HM
    BSR --> HM
    PMSP --> PMA

    %% ---- POWER RATINGS (Masters) ----
    HM --> HRAT["Hitter power ratings<br/>ba/obp/iso_power_rating (+pull_air)<br/>-> desc_owar, d_war, bsr_war, total_desc_war"]
    PMA --> PRAT["Pitching power ratings<br/>pRV+ (D1-FIP), era+/fip+/whip+/k9+/bb9+/hr9+<br/>-> desc_pwar"]

    %% ---- CONFERENCE BASELINES ----
    CONFSP --> CB[("Conference Stats<br/>Stuff+ (depth), wRC+, park factors,<br/>HTP = OPR + 1.25*(Stuff+-100) + 0.75*park")]

    %% ---- PROJECTIONS (returner + transfer engine) ----
    HRAT --> ENG["PROJECTION ENGINE (returner + transfer)<br/>ratings -> 70/30 power blend ->
    competition/env translation<br/>(conference + opposing-quality: pitching Stuff+ / HTP + park)<br/>-> class/dev mult -> depth-role opps -> WAR -> market"]
    PRAT --> ENG
    CB --> ENG
    ENG --> PRED[("player_predictions<br/>o_war, p_war, total_hitter_war,<br/>market_value, projected rates")]

    %% ---- NIL + NEED ----
    PRED --> NSC["score = total_WAR x PTM"]
    NSC --> ALLOC["allocateNil curve (rank-decay + budget-flex)<br/>+ need premium vs championship-starter bars"]

    %% ---- DISPLAY ----
    PRED --> DR["Rankings · Player Profile · Pitcher Profile"]
    PLSP --> DS["Savant · Stuff+ leaderboards · pitch mix"]
    CB --> DT["Team Builder · GM · Transfer Portal"]
    ALLOC --> DT
    PRAT --> DR
    HRAT --> DR
```

## Stage table (compute → store → display)

| # | Stage | Computes | Stores (DB) | Displays |
|---|---|---|---|---|
| 1 | Ingest | — | `pitch_log` (per-pitch); `Hitter Master`/`Pitching Master` (season stats) | — |
| 2 | Derive from pitch_log | Stuff+ inputs, dRS defense, wSB baserunning, pull_air/in_zone/spray/zone | `pitcher_stuff_plus_inputs`, `player_season_defense`, `player_season_baserunning`, Master columns | Savant tables |
| 3 | **Stuff+** (the build) | reclassify → re-derive baseline → 9-eq score → recenter | `pitch_log.stuff_plus` + `.pitch_type_reclassified`, `pitcher_stuff_plus_inputs.stuff_plus`, `pitcher_stuff_plus_ncaa`, `Conference Stuff+ (V2)`, `Pitching Master.stuff_plus` | Savant Stuff+ leaderboards, pitch mix |
| 4 | Power ratings (Masters) | hitter ba/obp/iso ratings (+pull_air) → desc WAR; pitcher pRV+/era⁺/… → desc pWAR | `Hitter Master` + `Pitching Master` (ratings + `desc_*` / `total_desc_war` cols) | Player/Pitcher Profile, Rankings |
| 5 | Conference baselines | Conf Stuff+ (depth), wRC+, park factors, HTP | `Conference Stats` | Team Builder context |
| 6 | Projections | returner + transfer engine (blend → competition translation via Stuff+/HTP/park → class/dev → depth-role → WAR → market) | `player_predictions` (o_war, p_war, total_hitter_war, market_value, rates) | Rankings, Profiles, Team Builder, Transfer Portal |
| 7 | NIL + need | score = total_WAR × PTM → allocateNil curve + need premium | (computed live; GM `gm_budget.nil_allocation_mode`) | Team Builder, GM, Target Board |

## Current vs target
- **Current:** stages 2–5 are **scattered one-off scripts run by hand** (`recompute-stuff-plus`, `compute_pitch_log_stuff_plus`, `conferenceStuffPlusV2`, `populate-conference-stats-env-plus`, the Master rating stores, …) — easy to forget → stale baselines/conference values.
- **Target (Track B):** ONE function fires on pitch-log ingest and runs stages 2→6 in order, stamped `classification_version` + `constants_version`, re-deriving every downstream aggregate in the same pass (no old-taxonomy means survive). Stage 1 Master-CSV ingest stays a separate upload; the pipeline marries its pitch-log derivations onto the Masters.
- **Sequencing rule:** Stuff+ (stage 3) must be FINAL before the transfer recompute (stage 6, Step 6b) so projections land once. NIL's `total_hitter_war` + need-premium wiring rides the 6b/7c recompute.
