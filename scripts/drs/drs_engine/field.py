"""
RSTR IQ dRS :: field geometry + air-ball catch-probability lookup.

ONE module imported by BOTH the surface fitter (derive_catch_surface.py) and the
engine, so distance-to-cover is computed identically at fit time and score time
(the "never mix references" requirement). Nothing here depends on run environment.

Model: an air ball's out probability is P(out | distance the responsible fielder had
to cover, hang time), fit empirically per position group. Distance-to-cover =
Euclidean distance from the fielder's handedness-split reference position to the ball's
landing point (spray, FBDst). A ball at the fielder's feet -> p~1 (credit ~0 if caught);
a ball 55 ft away in 3 s -> p~0 (debit ~0 if it drops, robbery credit ~1 if caught).
This is what replaces league-average xAVG for air balls and fixes the liner over-credit.
"""
from __future__ import annotations
import os, json, math

# shared bin edges (fit == score). distance in feet, hang in seconds.
DIST_EDGES = [0, 3, 6, 9, 12, 15, 18, 22, 26, 30, 35, 42, 50, 60, 1e9]
HANG_EDGES = [0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.5, 1e9]

# position -> catch-surface group. 8=CF its own; 7/9 corner OF share; infield air own.
GROUP = {8: "CF", 7: "corner_OF", 9: "corner_OF",
         3: "IF_air", 4: "IF_air", 5: "IF_air", 6: "IF_air"}
CANDIDATES = (3, 4, 5, 6, 7, 8, 9)   # fielders eligible to be "responsible" for an air ball

def _bin(edges, v):
    for k in range(len(edges) - 1):
        if v < edges[k + 1]:
            return k
    return len(edges) - 2

def ball_xy(spray_deg, dist_ft):
    """(spray, dist) polar -> (x, y): x = left(-)/right(+), y = depth from home."""
    a = math.radians(spray_deg)
    return dist_ft * math.sin(a), dist_ft * math.cos(a)

def load_field_positions(path=None):
    p = path or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "..", "fixtures", "field_positions.json")
    with open(p) as fh:
        raw = json.load(fh)["positions"]
    # resolve to (x,y) per (pos, hand, hold-key), precomputed
    refs = {}
    for pos_s, byhand in raw.items():
        pos = int(pos_s)
        for hand, byhold in byhand.items():
            for hk, (sp, ds) in byhold.items():
                refs[(pos, hand, hk)] = ball_xy(sp, ds)
    return refs

def _ref(refs, pos, hand, hold):
    """Reference (x,y) for a fielder given batter hand + (1B) hold state, with
    graceful fallback when a specific cell is absent."""
    hk = "hold" if (pos == 3 and hold) else "free"
    if hand not in ("L", "R"):
        a = refs.get((pos, "L", hk)); b = refs.get((pos, "R", hk))
        if a and b: return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        hand = "R"
    return (refs.get((pos, hand, hk))
            or refs.get((pos, hand, "free"))
            or refs.get((pos, "R", "free")))

def nearest_fielder(refs, bx, by, hand, hold):
    """(pos, distance-to-cover) for the fielder whose reference is closest to the ball."""
    best, bd = None, 1e18
    for pos in CANDIDATES:
        rx, ry = _ref(refs, pos, hand, hold)
        d = math.hypot(bx - rx, by - ry)
        if d < bd:
            best, bd = pos, d
    return best, bd

def cover_distance(refs, pos, spray_deg, dist_ft, hand, hold):
    """Distance a SPECIFIC fielder had to cover to the ball's landing point."""
    bx, by = ball_xy(spray_deg, dist_ft)
    rx, ry = _ref(refs, pos, hand, hold)
    return math.hypot(bx - rx, by - ry)

def load_catch_surface(path=None):
    p = path or os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "..", "fixtures", "catch_surface.json")
    if not os.path.exists(p):
        return None
    with open(p) as fh:
        return json.load(fh)

def catch_prob(surface, pos, dcover, hang):
    """P(out) for an air ball a fielder at `pos` had to cover `dcover` ft in `hang` s.
    Reads the pre-resolved (fallback-filled) grid for the position's group. Returns
    None if the surface is unavailable (engine then falls back to league xOut)."""
    if surface is None or hang is None:
        return None
    grp = GROUP.get(pos)
    if grp is None or grp not in surface["grid"]:
        return None
    db = _bin(DIST_EDGES, dcover)
    hb = _bin(HANG_EDGES, hang)
    return surface["grid"][grp][db][hb]
