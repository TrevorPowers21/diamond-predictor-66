"""
RSTR IQ dRS Engine :: run value constants (Spec Section 7)

STATUS: PLACEHOLDER_MLB_v0
Every value below is an MLB-derived placeholder. Production values MUST be
re-derived from the D1 run expectancy matrix (the RE24-based constants
derivation runs on a full-season export). The engine stamps constants_version
into every output row so any result computed on placeholders is identifiable
and reproducible.
"""

CONSTANTS_VERSION = "PLACEHOLDER_MLB_v0"

RUNS_PER_PLAY = 0.78     # hit vs out run gap on a BIP. D1 expected higher (hotter env)
RUNS_PER_BASE = 0.25     # marginal base of advancement
RUNS_PER_DP = 0.40       # marginal DP over single out
RUNS_PER_STRIKE = 0.12   # marginal called strike vs called ball
RUNS_PER_PBWP = 0.28     # PB/WP event cost
RUNS_CS = 0.44           # caught stealing value to defense
RUNS_SB_COST = 0.20      # cost of a steal allowed
RUNS_OF_KILL = 0.65      # runner thrown out on the bases: out value + erased advance

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

ENGINE_VERSION = "drs-engine-0.2.0"

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
