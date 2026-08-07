"""
RSTR IQ :: season boundaries — single source of truth.

WAR and defensive projections are REGULAR SEASON ONLY (Option A, Trevor 2026-08-04):
conference tournaments (from 5/19) AND the NCAA tournament are postseason and excluded,
so WAR reflects a clean ~56-game regular season and isn't inflated by elevated-stakes
postseason games. The DRS engine (RE24 fixtures + dRS accumulation) and the WAR pipeline
must both read THIS boundary so they can never disagree. (Mirror into a DB `season_config`
row when the WAR/pitch_log rebuild lands, so TS + Python share one value.)
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
