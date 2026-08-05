"""
RSTR IQ dRS :: derive empirical average fielding positions (D1 2026).

Reference points for the air-ball catch-probability surface. Derived from the data,
MLB Statcast averages used only as a sanity rail (never as inputs):
  - INFIELD (3,4,5,6): median landing point of sub-1.8s-hang air-ball putouts. A ball
    caught with <1.8s hang gives the fielder almost no reaction distance, so its landing
    point ~= where he was standing.
  - OUTFIELD (7,8,9): the sub-1.8s trick is physically impossible (OF fly balls hang
    3-5s; the season has <5 OF putouts under 1.8s), so we use the all-air-ball-putout
    centroid (median). The catch surface is fit on distance-FROM-this-reference, so a
    constant offset in the reference washes out in the fit — only a CONSISTENT,
    handedness-correct reference is required, which the MLB-shape + pull-side-depth
    match validates.

Splits (used identically here and at scoring time — never mix):
  - batter handedness (fielders shade 10-20 ft by hand)
  - 1B hold state (ManOnFirst): holding at the bag is ~shallower than normal depth

Writes fixtures/field_positions.json:  positions[pos][hand][hold] = [spray_deg, dist_ft]
(non-1B carry only "free"; 1B carries "free" and "hold").
"""
import sys, os, glob, csv, json, statistics, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.season_config import is_regular_season
from drs_engine.parser import parse_atbat_desc, ParseError

HANG_MAX_IF = 1.8
NAMES = {3: "1B", 4: "2B", 5: "3B", 6: "SS", 7: "LF", 8: "CF", 9: "RF"}
INFIELD = (3, 4, 5, 6)
OUTFIELD = (7, 8, 9)
MLB = {5: (-27, 115), 6: (-13, 148), 4: (13, 148), 3: (26, 110),
       7: (-27, 295), 8: (0, 320), 9: (27, 294)}
MIN_N = 20

def med2(pairs):
    return (round(statistics.median([p[0] for p in pairs]), 1),
            round(statistics.median([p[1] for p in pairs]), 1))

def main(paths):
    # key (pos, hand, hold) -> list[(spray, dist)]; hold None for non-1B
    short_hang = collections.defaultdict(list)   # infield: sub-1.8s
    all_air = collections.defaultdict(list)      # outfield: all putouts
    for p in sorted(paths):
        with open(p, newline="") as fh:
            r = csv.reader(fh); hdr = [h.strip() for h in next(r)]
            i = {h: x for x, h in enumerate(hdr)}
            def g(row, x): return row[i[x]].strip() if x in i and i[x] < len(row) else ""
            for row in r:
                ad = g(row, "atbatDesc")
                if ad in ("", "-") or not is_regular_season(g(row, "gameString")):
                    continue
                try: ev = parse_atbat_desc(ad)
                except ParseError: continue
                if ev.event_type != "OUT" or ev.is_bunt or not ev.putout_chain:
                    continue
                pos = ev.putout_chain[0]
                if pos not in NAMES: continue
                try:
                    la = float(g(row, "LaunchAng")); hg = float(g(row, "HangTime").rstrip("s"))
                    sp = float(g(row, "SprayAng")); ds = float(g(row, "FBDst"))
                except ValueError: continue
                if la < 10: continue                       # air only
                hand = (g(row, "batterHand").upper()[:1] or "?")
                hold = (g(row, "ManOnFirst") not in ("", "-")) if pos == 3 else None
                all_air[(pos, hand, hold)].append((sp, ds))
                if hg < HANG_MAX_IF:
                    short_hang[(pos, hand, hold)].append((sp, ds))

    positions = {}
    report = []
    for pos in (5, 6, 4, 3, 7, 8, 9):
        src = short_hang if pos in INFIELD else all_air
        method = "short_hang<1.8s" if pos in INFIELD else "all_putout_centroid"
        holds = [False, True] if pos == 3 else [None]
        pd = {}
        for hand in ("L", "R"):
            hd = {}
            for hold in holds:
                pairs = src.get((pos, hand, hold), [])
                hk = ("hold" if hold else "free") if pos == 3 else "free"
                if len(pairs) < MIN_N:
                    # fall back to MLB shape (shouldn't happen for our sample)
                    hd[hk] = list(MLB[pos]); report.append((pos, hand, hk, len(pairs), "MLB_FALLBACK"))
                    continue
                hd[hk] = list(med2(pairs))
                report.append((pos, hand, hk, len(pairs), method))
            pd[hand] = hd
        positions[str(pos)] = pd

    out = {
        "constants_version": "D1_2026_v1",
        "method": {"infield": "median landing point of sub-1.8s-hang air-ball putouts",
                   "outfield": "all-air-ball-putout centroid (sub-1.8s impossible for OF)"},
        "mlb_sanity_prior": {str(k): list(v) for k, v in MLB.items()},
        "positions": positions,
    }
    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "field_positions.json")
    with open(dst, "w") as fh:
        json.dump(out, fh, indent=2)
    print(f"wrote {dst}")
    print(f"{'pos':4}{'hand':5}{'hold':6}{'n':>7}  method")
    for pos, hand, hk, n, m in report:
        print(f"{NAMES[pos]:4}{hand:5}{hk:6}{n:>7}  {m}")

if __name__ == "__main__":
    paths = sys.argv[1:] or glob.glob(
        "/Users/danielleogonowski/dev-main/diamond-predictor-66/docs/drs-reference/*DRS Pitch Log.csv")
    main(paths)
