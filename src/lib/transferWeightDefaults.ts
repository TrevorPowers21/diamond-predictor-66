/**
 * Single source of truth for transfer equation weight defaults.
 *
 * EVERY file that references these weights must import from here.
 * Never hardcode fallback values for these keys anywhere else.
 *
 * If you need to change a default, change it HERE and nowhere else.
 */
export const TRANSFER_WEIGHT_DEFAULTS = {
  // Conference weights — lowered 2026-05-04 from 0.5/0.5/0.25 to reduce
  // the conference's compounding effect on harsh moves (Big 12 → SEC was
  // double-counting the pitching strength via low conference offense).
  t_ba_conference_weight: 0.30,
  t_obp_conference_weight: 0.30,
  t_iso_conference_weight: 0.15,

  // Pitching / competition weights — restored 2026-05-04 to ~3x Conference
  // ratio (the original "Stuff+ should be 3x conference" hypothesis) after
  // archetype validation showed elite mid-major hitters (Gomez NEC → Big 12,
  // 13-point Stuff+ delta) weren't dropping enough at the lighter values.
  // Stuff+ is the regression-for-weak-competition mechanism — it needs
  // enough impact for big deltas to actually swamp the move. Linear scaling
  // means small deltas (Hairston Big 12 → SEC, +3.8 Stuff+) barely move at
  // either weight; large deltas need the heavier multiplier to register.
  // History: original 2.0 → 1.5 (apr-27) → 1.0 (may-01) → 1.25 (may-01) →
  //   0.75/0.65/0.55 (may-04 morning) → these values (may-04 afternoon) once
  //   we saw Gomez at .332 vs gut's expected ~.300.
  t_ba_pitching_weight: 1.00,
  t_obp_pitching_weight: 0.85,
  t_iso_pitching_weight: 0.75,

  // Park factor weights — raised 2026-05-04 to ~1:1 with conference impact.
  // Rationale: half of games are at the home park, so park's per-SD effect
  // should be comparable to overall conference context. Previously at ~1/3
  // of conference, which underweighted park.
  t_ba_park_weight: 0.24,
  t_obp_park_weight: 0.26,
  t_iso_park_weight: 0.11,

  // Power-rating blend weights — 0.70 means projected slash = 70% PR-derived
  // scaled rate + 30% last-year actual rate, then env multiplier on top.
  // Included here (mirroring config keys used in TP) so transferWeightsForSource()
  // returns a complete set; JUCO override sets these to 0.
  t_ba_power_weight: 0.70,
  t_obp_power_weight: 0.70,
  t_iso_power_weight: 0.70,
} as const;

/** Convenience accessor — returns the default for a known transfer weight key. */
export function transferWeightDefault(key: keyof typeof TRANSFER_WEIGHT_DEFAULTS): number {
  return TRANSFER_WEIGHT_DEFAULTS[key];
}

/**
 * JUCO-specific transfer weight overrides.
 *
 * Rationale: JUCO has no park-factor data (no public source, TruMedia team
 * stats unreliable). Park weights set to 0; the lost environmental signal
 * (BA 0.24 / OBP 0.26 / ISO 0.11) is split evenly between conference and
 * pitching weights. Net total environmental influence stays ~equal to D1
 * but routes entirely through conf + Stuff+ deltas.
 *
 * Used when source player is JUCO (division='NJCAA_D1'). Destination D1
 * conference still uses its own conference / Stuff+ values normally.
 *
 * Calibrated 2026-05-16 via 4 hand-calc projections (Pantier/Eagar/Mouton/
 * Woodward to SEC). All four land at .888-.984 OPS — realistic top-of-SEC
 * outcomes for top JUCO bats per coach gut-check.
 */
export const JUCO_TRANSFER_WEIGHTS = {
  t_ba_conference_weight: 0.42,   // +0.12 (half of lost BA park 0.24)
  t_obp_conference_weight: 0.43,  // +0.13 (half of lost OBP park 0.26)
  t_iso_conference_weight: 0.20,  // +0.05 (half of lost ISO park 0.11)
  // Pitching weights bumped 2026-05-18 (+15% vs prior 1.12/0.98/0.80)
  // after Pantier-class smoke tests showed projections "feel a little
  // high" — reflects JUCO→D1 pitching depth gap. JUCO weekends see 1-2
  // quality arms; D1 sees a full rotation + bullpen turn. Bigger Stuff+
  // delta pull-down for moves to elite destinations.
  t_ba_pitching_weight: 1.30,
  t_obp_pitching_weight: 1.13,
  t_iso_pitching_weight: 0.92,
  t_ba_park_weight: 0,            // no JUCO park data
  t_obp_park_weight: 0,
  t_iso_park_weight: 0,
  // Power weights zeroed for go-to-market — JUCO projections use raw 2026
  // stats only, no PR blending. JUCO Hitter Master has ba/obp/iso PRs
  // computed for ~50% of players, kept in DB as future add-on once
  // validated via examples vs actual transfer outcomes. Until then,
  // baBlended = lastAvg × 1 = pure raw stat → env multiplier.
  t_ba_power_weight: 0,
  t_obp_power_weight: 0,
  t_iso_power_weight: 0,
} as const;

/** Returns the appropriate weight set based on source player division. */
export function transferWeightsForSource(division: string | null | undefined) {
  return division === "NJCAA_D1" ? JUCO_TRANSFER_WEIGHTS : TRANSFER_WEIGHT_DEFAULTS;
}

/**
 * JUCO outlier regression — nonlinear pull toward NCAA mean for raw rate
 * stats above an "outlier threshold." Mirrors D1's natural regression
 * through the power-rating blend (which we explicitly disabled for JUCO),
 * but instead of a scouting-derived anchor, the population mean serves as
 * the regression target. Only outlier seasons get pulled — average JUCO
 * regulars (e.g., .300 AVG) regress naturally through the env multiplier.
 *
 * Locked 2026-05-18 thresholds:
 *   AVG: ramps above .350, slope 1.12, max r = 0.15
 *   OBP: ramps above .450, slope 0.85, max r = 0.15
 *   ISO: ramps above .280, slope 1.50, max r = 0.20
 *
 * Pantier (.484 raw AVG) hits r=0.15, gets pulled to .453 before env.
 * A .300 JUCO regular passes through unchanged.
 */
export function applyJucoOutlierRegression(
  rawStat: number,
  ncaaMean: number,
  threshold: number,
  slope: number,
  maxR: number,
): number {
  if (!Number.isFinite(rawStat) || rawStat <= threshold) return rawStat;
  const r = Math.min(maxR, (rawStat - threshold) * slope);
  return rawStat * (1 - r) + ncaaMean * r;
}

/**
 * Caps tightened 2026-05-18: 0.15/0.15/0.20 → 0.10/0.10/0.15 after
 * smoke test showed first version was pulling outliers down a touch too
 * hard. Lighter overall touch — extreme outliers still get regressed,
 * just not as aggressively. Pantier pAVG .328 → .336, pSLG .600 → ~.718.
 */
export const JUCO_REGRESSION_CONFIG = {
  avg: { mean: 0.280, threshold: 0.350, slope: 1.12, maxR: 0.10 },
  obp: { mean: 0.385, threshold: 0.450, slope: 0.85, maxR: 0.10 },
  iso: { mean: 0.162, threshold: 0.280, slope: 1.50, maxR: 0.15 },
} as const;

/**
 * JUCO-specific pitcher transfer overrides.
 *
 * Methodology mirrors the hitter approach (2026 stats verbatim, no PR blend,
 * no park, env-only translation) but the WEIGHTS differ because pitcher math
 * has a different shape:
 *
 *   - Pitcher's own Stuff+ is the dominant cross-context signal (when present).
 *     For the 38% of JUCO pitchers with individual Stuff+, use heavier
 *     Stuff+ delta weights. For the 62% without, skip Stuff+ entirely in the
 *     callsite (set delta to 0) — Data Reliability surfaces this.
 *   - The conference "hitter_talent_plus" input gets a per-district override:
 *     raw JUCO Conference Stats BA+ are inflated 107-123 because JUCO hitters
 *     mash each other in soft environments. For the pitcher math we want
 *     "what was the REAL quality of hitters faced" — locked at SWAC/NEC/
 *     Horizon equivalents per district (72-95). See JUCO_DISTRICT_HTP_OVERRIDE.
 *   - Park weights zeroed (no JUCO park data).
 */
/**
 * JUCO pitcher transfer weights — SD-normalized per stat so each env+
 * delta contributes uniform impact "per standard deviation" rather than
 * "per raw point." This prevents stats with naturally wide cross-league
 * spread (FIP, HR/9) from disproportionately dominating the projection.
 *
 * Methodology (locked 2026-05-18):
 *   conference_weight = 0.025 × D1_SD_for_stat   (≈2.5% impact per 1 SD)
 *   competition_weight = 0.05 × D1_SD_for_HTP    (≈5% per 1 SD = HTP dominant)
 *
 * D1 cross-conference SDs measured from staging 2026:
 *   era+ 9.4 · fip+ 6.2 · whip+ 5.3 · k9+ 7.9 · bb9+ 8.6 · hr9+ 17.3 · HTP 14.1
 *
 * EXCEPTION — K/9 and HR/9 use lower competition_weight (0.40) because
 * they're peripheral stats more driven by pitcher arsenal than hitter
 * quality. A pitcher's K rate doesn't drop 30% just because hitters got
 * better; it drops more like 10-15%. Same for HR rate (park/arsenal heavy).
 *
 * Result for typical JUCO Appalachian → SEC pitcher:
 *   FIP env+ contribution: 5.3% (was 13.6% — was the dominant env+ term)
 *   ERA env+ contribution: 8.5% (was 12.8%)
 *   K/9 HTP contribution: 23% (was 29% — gentler peripheral)
 *   HTP impact on non-peripheral stats: 40.6% (truly dominant)
 *
 * D1 simulator math untouched.
 */
export const JUCO_PITCHING_TRANSFER_WEIGHTS = {
  // Power weights = 0 (use raw 2026 rates verbatim — same as hitter approach)
  transfer_era_power_weight: 0,
  transfer_fip_power_weight: 0,
  transfer_whip_power_weight: 0,
  transfer_k9_power_weight: 0,
  transfer_bb9_power_weight: 0,
  transfer_hr9_power_weight: 0,
  // Conference weights — SD-normalized (0.025 × D1_SD for that stat).
  // Caps FIP from being the dominant env+ contributor despite huge gap.
  transfer_era_conference_weight: 0.235,
  transfer_fip_conference_weight: 0.155,
  transfer_whip_conference_weight: 0.133,
  transfer_k9_conference_weight: 0.198,
  transfer_bb9_conference_weight: 0.215,
  transfer_hr9_conference_weight: 0.433,
  // Competition (hitter-talent delta) — HTP is the dominant factor.
  // 2026-05-24 recalibration: ERA + FIP bumped from 0.706 → 1.0 after
  // Redmond (South Central, 2.29 ERA / 1.93 FIP) projected to 3.21 in
  // SEC — coach gut said ~3.82 better reflects "elite JUCO ace still
  // gets exposed by SEC bat depth." Better to under-project and have
  // them outperform than over-project and disappoint.
  transfer_era_competition_weight: 1.0,
  transfer_fip_competition_weight: 1.0,
  transfer_whip_competition_weight: 0.706,
  transfer_k9_competition_weight: 0.40,
  // BB/9 lowered 2026-05-24: 0.45 → 0.30. Walks are primarily pitcher
  // command — hitter quality has only a modest pull. Coach feedback:
  // "BB/9 was moving a little too much for my liking, walks are pretty
  // consistent." Earlier history: 0.706 → 0.45 (2026-05-18) → 0.30.
  transfer_bb9_competition_weight: 0.30,
  transfer_hr9_competition_weight: 0.40,
  // Park weights = 0 (JUCO has no park data)
  transfer_era_park_weight: 0,
  transfer_fip_park_weight: 0,
  transfer_whip_park_weight: 0,
  transfer_hr9_park_weight: 0,
} as const;

/**
 * Per-district JUCO hitter_talent_plus override.
 *
 * Replaces the inflated Conference Stats BA+ values (107-123) with values
 * reflecting the TRUE talent of hitters a JUCO pitcher faced — anchored at
 * NEC/Horizon/SWAC tier per user framework (2026-05-17). Keyed by the
 * district name as it appears on Teams Table / wired conference_id.
 *
 * Calibration: South Atlantic (FL) at ~95 (ASUN/Big East tier) — Florida
 * is the JUCO outlier with 49 draftees 2021-2025. East district at 72
 * (below NEC) — weakest, mostly NY/NJ programs. Everything between scales
 * by district Stuff+ baseline + 5-yr poll strength.
 *
 * NOT calibrated against actual draft per-region data (not in DB).
 * Recalibrate as we see real projections vs gut.
 */
/**
 * Calibrated 2026-05-17 against ACTUAL computed D1 HTP values
 * (formula: OvrPR + 1.25*(Stuff+ - 100) + 0.75*(100 - WRC+)). User
 * framework: FL JUCO ≈ MWC tier (HTP 94), weakest JUCO ≈ NEC tier (HTP 66).
 *
 * D1 anchors for context:
 *   NEC=65.9 · SWAC=70.3 · MAAC=85.2 · Horizon=89.8 · MWC=94.0 ·
 *   Big East=96.3 · MAC=99.1 · SBC=103.3 · Big 12=118.6 · SEC=135.8
 */
/**
 * Stable Conference Stats UUIDs per JUCO D1 district. Player records store
 * the conference as "NJCAA D1 <District>" but Conference Stats keys by
 * "NJCAA D1 <District> District" — direct name lookup misses. The simulator
 * walks `players → team_id → Teams Table → conference_id`, but JUCO teams
 * aren't all in Teams Table, so it relies on name fuzzy matching downstream.
 * For TB target board projections we go straight from player.conference
 * (district name) to this UUID, then UUID → Conference Stats row.
 *
 * Verified against `Conference Stats` 2026-05-18. Updating these rows in DB
 * shouldn't change the UUIDs.
 */
export const JUCO_DISTRICT_CONFERENCE_ID: Record<string, string> = {
  "Appalachian": "c4e84625-014b-4043-ad18-ef6d633cb7ba",
  "East": "2981eac4-b979-42a5-abba-9520bd5b34ff",
  "Mid-South": "9b3228bc-1ebf-4b83-a626-d11b192912b3",
  "Midwest": "95f8d637-dfc3-4dca-a6c4-dd23ec925fca",
  "Plains": "53edabac-5a3f-44ef-a877-04d2eb99ef19",
  "South": "0afebb9f-39a5-48ae-ae04-85a8e5212e7e",
  "South Atlantic": "0ff9293a-1df2-41b3-ad9c-736b49cdd289",
  "South Central": "e0e70823-79c5-4362-a33d-a80bfa82b97e",
  "Southwest": "05f74671-1341-4ec6-aa2a-e7ae0f9c5e3f",
  "West": "1516195f-ca3d-4e61-af05-354a1fd256a6",
};

/** Strip "NJCAA D1 " prefix and " District" suffix to get the bare district name. */
export const jucoDistrictNameFromConference = (conference: string | null | undefined): string | null => {
  if (!conference) return null;
  const stripped = conference.replace(/^NJCAA D1 /i, "").replace(/ District$/i, "").trim();
  return stripped || null;
};

export const JUCO_DISTRICT_HTP_OVERRIDE: Record<string, number> = {
  "South Atlantic": 94,   // FL — Stuff+ 100.7, ≈ MWC tier
  "Mid-South": 88,        // TN — Stuff+ 97.9, ≈ between Horizon and MWC
  "Southwest": 85,        // TX/NM — Stuff+ 98.1, ≈ MAAC tier
  "Plains": 82,           // KS/NE — Stuff+ 96.8, between MAAC and SWAC
  "Appalachian": 78,      // TN mtns / GA / SC — Stuff+ 95.9, above SWAC
  "Midwest": 75,          // MI/WI/IL — Stuff+ 95.3, above SWAC
  "South": 73,            // LA / AL / MS — Stuff+ 94.8, above SWAC
  "West": 71,             // AZ / UT / Pacific NW — Stuff+ 94.7, SWAC tier
  "South Central": 68,    // OK / MO / AR — Stuff+ 93.8, NEC-SWAC range
  "East": 65,             // NY / NJ / MD — Stuff+ 92.0, NEC tier
  // D2 conferences — routed through the JUCO pitching engine via the D2
  // branch in detectJucoPitcherSource. HTP locked by coach calibration per
  // conference (not formula-derived). Add new D2 conferences here as Kansas /
  // other customers onboard non-DB commits.
  "Gulf South Conference": 66, // D2 — coach-locked 2026-06-16, NEC tier floor
};
