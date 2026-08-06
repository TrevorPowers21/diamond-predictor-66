"""
RSTR IQ dRS Engine :: run value constants (Spec Section 7)

STATUS: D1_2026_v1 — derived from the 2026 D1 regular-season RE24 matrix via
empirical linear weights (scripts/drs/derive_re24.py + derive_constants.py).
Run environment: 6.54 R/team/game (~6.76 per-9-innings) vs MLB 4.45 (2025) ≈ 1.5×.
Internally certified: telescoping run-value sum over 605,727 PAs closes to −0.20%.
See docs/drs-reference/CONSTANTS_D1_2026.md for the full derivation + validation.
The engine stamps constants_version into every output row.
"""

CONSTANTS_VERSION = "D1_2026_v1"
SEASON = 2026   # the season these constants + fixtures + grounder calibration are derived for

# ---- run-value constants (D1 2026 regular season) ----
RUNS_PER_PLAY = 1.045    # RV(hit S/D/T blend) − RV(BIP out) = 0.673 − (−0.372). Range/Error scale.
RUNS_PER_SINGLE = 0.964  # RV(single) − RV(out) = 0.592 − (−0.372). Error-DEBIT base only, so an
                         # error is charged as "a sure out that became a SINGLE" (+ actual extra
                         # bases on top) rather than the S/D/T blend, which would double-count the
                         # extra-base damage by ~0.08 runs/error. Range still uses RUNS_PER_PLAY.
RUNS_PER_DP = 0.771      # RV(normal out in DP state) − RV(GDP) = −0.379 − (−1.149). Marginal DP.
RUNS_PER_BASE = 0.184    # frequency-weighted 1B→2B & 2B→3B advance. FALLBACK ONLY: the engine
                         # prices advancement off the exact base-out RE24 delta where the state is
                         # known; this flat value is used only when state resolution fails.
RUNS_PER_STRIKE = 0.225  # called ball-vs-strike run swing (count-based; IBB-clean walk terminal). Framing.
RUNS_PER_PBWP = 0.320    # advance all runners one base, occupied-state weighted. Blocking.
RUNS_CS = 0.583          # erase runner on 1st + add an out. Catcher throwing (caught stealing).
RUNS_SB_COST = 0.175     # runner 1st→2nd (steal allowed). Catcher throwing.
RUNS_OF_KILL = 0.86      # FALLBACK ONLY. OF kills are now priced per-event off the RE24 matrix
                         # (advancement erased + the out, state-sensitive); this flat value is
                         # used only when the matrix is unavailable.

# ---- regression priors (phantom league-average opportunities) ----
# floor = raw * n / (n + prior). Priors approximate 120 games of average
# workload per component; BntR and ThrR carry heavier priors (tiny samples).
PRIOR_RANGE_OPPS = 350.0
PRIOR_ERROR_OPPS = 350.0
PRIOR_DP_OPPS = 120.0
PRIOR_ARM_OPPS = 90.0
PRIOR_FRAME_TAKEN = 4000.0
PRIOR_BLOCK_PITCHES = 4000.0
PRIOR_THROW_ATT = 60.0
PRIOR_BUNT_OPPS = 60.0

# 0.6.0: per-model range pricing. Air balls priced by a positioning-aware catch-
# probability surface (P(out | distance-to-cover, hang), fit per position group off
# empirically-derived D1 reference positions), replacing league xAVG for air balls;
# grounders keep xAVG. Range scores only priced balls (untracked stay neutral); coverage
# = scored/faced. See fixtures/field_positions.json + catch_surface.json.
#
# v0.7.0: grounder range pool restricted to the four infield lanes (P/C comebacker/dribbler
# fielding relocated to pitcher_fielding, outside dWAR), and grounders priced by a season-fit
# g(xAVG, spray) recalibration (ROE-level fix + spray-region offsets) with the 3B/SS seam at the
# derived-position midpoint. The calibration is a SEASON FIXTURE (fixtures/grounder_calibration.json,
# stamped season + constants_version) and MUST be refit whenever CONSTANTS_VERSION or the upstream
# xAVG changes — a stale calibration silently applied recreates the ROE bug in reverse.
#
# v0.8.0: grounder HIT debits are FRACTIONAL (shared-seam reach-share model,
# fixtures/reach_shares.json) — a hit debits infielders by their empirical out-conversion share at
# that spray, so credit (individual, putout chain) and debit (fractional blame) are drawn from the
# same population. Fixes the credit-to-fielder vs debit-to-lane attribution asymmetry that a hard
# lane boundary can only relocate, never remove. Also a season fixture; same stale-guard.
ENGINE_VERSION = "drs-engine-0.8.0"

POSITION_COLS = {
    2: "catcherAbbrevName",
    3: "FirstBaseman",
    4: "SecondBaseman",
    5: "ThirdBaseman",
    6: "ShortStop",
    7: "LeftFielder",
    8: "CenterFielder",
    9: "RightFielder",
}
POSITION_NAMES = {1: "P", 2: "C", 3: "1B", 4: "2B", 5: "3B",
                  6: "SS", 7: "LF", 8: "CF", 9: "RF"}

# infield positions eligible for double-play accounting
INFIELD = {1, 2, 3, 4, 5, 6}
