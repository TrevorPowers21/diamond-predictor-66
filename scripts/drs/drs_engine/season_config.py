"""
RSTR IQ :: season boundaries — single source of truth.

POLICY REVISED 2026-08-08 (Trevor) — the boundary now drives a SPLIT, not a blanket exclusion.
The pitch log (source of truth) spans 2026-02-13 → 06-22 and INCLUDES conference tournaments
(from 5/19) + the NCAA tournament. Accrue BOTH a full-season and a regular-season (≤5/18) line;
which one a consumer reads depends on the consumer:

  • PLAYER stat store + player TOTAL WAR + POWER RATINGS → FULL season (incl. postseason).
    College samples are small, so postseason at-bats vs high-quality opponents SOLIDIFY the
    power ratings and add signal. Past seasons: full. Total WAR shown on a player includes post.
  • PROGRAM ANALYTICS (team_war_snapshots, YoY / championship benchmarks) → REGULAR season only.
    So team numbers match the clean ~56-game season / official records. This is where the old
    "Option A" still holds.
  • PROJECTIONS → TARGET a regular-season line (depth roles = regular-season PA totals; we project
    regular-season WAR). INPUT may use the full-season power ratings (more data = better estimate).

IMPLICATION TO RESOLVE: dWAR/bsrWAR (dRS engine) currently filter to regular season via
is_regular_season(); if player TOTAL WAR is full-season, the defense/baserunning components should
be accrued full-season too for the player store (regular-season split retained for team analytics).
oWAR (Hitter Master) is ALREADY full-season. Flagged — see COMBINED_RECALIBRATION_PITCHLOG_PLAN.md.
(Mirror into a DB `season_config` row when the rebuild lands so TS + Python share one value.)
"""
from __future__ import annotations
import re

# per season: last regular-season game date (inclusive) + first postseason date
SEASON_BOUNDS = {
    2026: {"regular_season_end": "2026-05-18", "postseason_start": "2026-05-19"},
}

_DATE_RE = re.compile(r"(20\d\d)(0[1-9]|1[0-2])([0-3]\d)")

def game_date(gamestring):
    """YYYY-MM-DD parsed from a TruMedia gameString, or None if not found."""
    m = _DATE_RE.search(gamestring or "")
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None

def is_regular_season(gamestring, season=2026):
    """True if the game is on/before the season's regular_season_end. Unknown/
    unparseable dates are KEPT (conservative — better to include a mystery game than
    silently drop it); bump the season into SEASON_BOUNDS to gate a new year."""
    b = SEASON_BOUNDS.get(season)
    d = game_date(gamestring)
    if b is None or d is None:
        return True
    return d <= b["regular_season_end"]
