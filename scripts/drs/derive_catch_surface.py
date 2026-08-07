"""
RSTR IQ dRS :: fit the air-ball catch-probability surface (D1 2026).

P(out | distance-to-cover, hang) per position group, fit empirically on regular-season
air balls (LA >= 10). Distance-to-cover uses the handedness-split reference positions
from field_positions.json, via drs_engine/field.py (SAME code the engine scores with).

Attribution: OUTS -> the actual putout fielder (credit the real catcher for the real
distance he covered); HITS -> the nearest fielder by reference (who should have had it).
Zero-sum is preserved regardless, because each grid cell stores its own empirical
out-rate (Sigma credit - Sigma debit within a cell = outs*(1-p) - hits*p = 0 when
p = outs/n).

Guard #1 (FBDst trap): a caught ball's FBDst is the CATCH point, not the landing point,
so outs read slightly shorter than hits at equal hang -> the surface is mildly
conservative (under-credits great running catches). We MEASURE and print that bias.
Guard #4 (walls): FBDst truncates at the fence, so very deep flies at small parks look
artificially catchable. We flag the deep-ball share (park dims unavailable in this repo).

Writes fixtures/catch_surface.json: grid[group][dist_bin][hang_bin] = P(out).
"""
import sys, os, glob, csv, json, collections, statistics
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.season_config import is_regular_season
from drs_engine.parser import parse_atbat_desc, ParseError
from drs_engine.field import (load_field_positions, ball_xy, nearest_fielder,
                              cover_distance, GROUP, DIST_EDGES, HANG_EDGES, _bin)

MIN_CELL = 40        # cell needs this many balls to use its own rate
MIN_MARG = 150       # else fall back to the (group, dist) marginal if it has this many
DEEP_FT = 340        # flag potential wall-truncated flies

def main(paths):
    refs = load_field_positions()
    # counts[group][db][hb] = [n, outs]; marg[group][db] = [n, outs]; glob[group] = [n, outs]
    counts = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0])))
    marg = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    glob_ = collections.defaultdict(lambda: [0, 0])
    # bias measurement: dcover of outs vs hits by hang bin
    dbias = collections.defaultdict(lambda: {"out": [], "hit": []})
    deep = {"out": 0, "hit": 0, "tot": 0}
    n_air = 0

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
                if ev.is_bunt: continue
                is_out = ev.event_type == "OUT" and bool(ev.putout_chain)
                is_hit = ev.event_type in ("SINGLE", "DOUBLE", "TRIPLE")
                if not (is_out or is_hit): continue
                try:
                    la = float(g(row, "LaunchAng")); hang = float(g(row, "HangTime").rstrip("s"))
                    sp = float(g(row, "SprayAng")); ds = float(g(row, "FBDst"))
                except ValueError: continue
                if la < 10: continue                        # air only (grounders use xAVG)
                hand = (g(row, "batterHand").upper()[:1] or "?")
                hold = g(row, "ManOnFirst") not in ("", "-")
                if is_out:
                    pos = ev.putout_chain[0]
                    if pos not in GROUP: continue           # e.g. catcher pop; skip from surface
                    dcov = cover_distance(refs, pos, sp, ds, hand, hold)
                else:
                    bx, by = ball_xy(sp, ds)
                    pos, dcov = nearest_fielder(refs, bx, by, hand, hold)
                grp = GROUP[pos]
                db, hb = _bin(DIST_EDGES, dcov), _bin(HANG_EDGES, hang)
                n_air += 1
                o = 1 if is_out else 0
                for acc in (counts[grp][db][hb], marg[grp][db], glob_[grp]):
                    acc[0] += 1; acc[1] += o
                dbias[hb]["out" if is_out else "hit"].append(dcov)
                deep["tot"] += 1
                if ds >= DEEP_FT: deep["out" if is_out else "hit"] += 1

    # resolve grid with hierarchical fallback
    grid = {}
    fb_cells = collections.Counter()
    for grp in ("CF", "corner_OF", "IF_air"):
        nd, nh = len(DIST_EDGES) - 1, len(HANG_EDGES) - 1
        grid[grp] = [[None] * nh for _ in range(nd)]
        gN, gO = glob_[grp]
        grate = gO / gN if gN else 0.5
        for db in range(nd):
            for hb in range(nh):
                n, o = counts[grp][db][hb]
                if n >= MIN_CELL:
                    grid[grp][db][hb] = round(o / n, 4); fb_cells["cell"] += 1
                else:
                    mn, mo = marg[grp][db]
                    if mn >= MIN_MARG:
                        grid[grp][db][hb] = round(mo / mn, 4); fb_cells["marg"] += 1
                    else:
                        grid[grp][db][hb] = round(grate, 4); fb_cells["glob"] += 1

    out = {
        "constants_version": "D1_2026_v1",
        "dist_edges": DIST_EDGES, "hang_edges": HANG_EDGES,
        "attribution": "outs=actual putout fielder; hits=nearest by reference",
        "grid": grid,
        "group_n": {k: glob_[k][0] for k in ("CF", "corner_OF", "IF_air")},
    }
    dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "catch_surface.json")
    with open(dst, "w") as fh:
        json.dump(out, fh, indent=2)

    print(f"air balls fit: {n_air:,}   cells filled: {dict(fb_cells)}")
    print("group n:", {k: glob_[k][0] for k in ('CF', 'corner_OF', 'IF_air')})
    print("\n-- monotonicity spot check: P(out) vs distance-to-cover (CF, hang 3.5-4.0s) --")
    hb = _bin(HANG_EDGES, 3.7)
    for db in range(len(DIST_EDGES) - 1):
        lo, hi = DIST_EDGES[db], DIST_EDGES[db + 1]
        print(f"   {lo:>3.0f}-{hi:>3.0f} ft: P(out)={grid['CF'][db][hb]:.3f}  (n={counts['CF'][db][hb][0]})")
    print("\n-- GUARD #1 (FBDst catch-vs-landing bias): mean dcover, outs vs hits by hang --")
    for hb in range(len(HANG_EDGES) - 1):
        o, h = dbias[hb]["out"], dbias[hb]["hit"]
        if len(o) < 30 or len(h) < 30: continue
        mo, mh = statistics.mean(o), statistics.mean(h)
        print(f"   hang {HANG_EDGES[hb]:.1f}-{HANG_EDGES[hb+1]:.1f}s: out {mo:5.1f}ft  hit {mh:5.1f}ft  "
              f"(outs read {mh-mo:+.1f}ft {'shorter' if mo<mh else 'longer'})")
    print(f"\n-- GUARD #4 (deep/wall): FBDst>={DEEP_FT}ft share: "
          f"{100*(deep['out']+deep['hit'])/max(1,deep['tot']):.1f}% of air balls "
          f"(outs {deep['out']}, hits {deep['hit']}) — park dims unavailable, flagged not capped")

if __name__ == "__main__":
    paths = sys.argv[1:] or glob.glob(
        "/Users/danielleogonowski/dev-main/diamond-predictor-66/docs/drs-reference/*DRS Pitch Log.csv")
    main(paths)
