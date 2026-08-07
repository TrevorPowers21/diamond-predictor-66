"""
Step 3 — fit g(xAVG) on the corrected infield-only scored grounder population, verify per-lane.

Reads output/grounder_pop.csv (from collect_grounder_pop.py). No sklearn dependency — isotonic
regression via pool-adjacent-violators (PAV), monotone by construction, preserves xAVG ordering
(its skill content), fixes only the level.

g(xAVG) is fit ONCE, globally (NOT per position) — a per-position fit would launder real
between-lane grounder-difficulty differences into the correction. After the global fit we VERIFY
calibration per spray lane; a lane still off is information we keep visible, not absorbed.

Checks printed:
  1. Pre-fit:  actual out rate O vs xAVG-implied (1 - mean xAVG), league + per lane.
  2. Global isotonic g fit so predicted P(hit) == actual hit rate per xAVG bucket.
  3. Post-fit range-sum per lane with g(xAVG) in place of xAVG  (zero-sum check).
  4. MIDDLE LANE (SS/2B seam) explicit calibration — the pitcher-shadow region.
  5. 3B BOUNDARY test: re-bin by raw spray at cut -22 (current) vs -25 (empirical midpoint),
     report each lane's post-g range sum under both boundaries.
"""
import csv, sys, os
from collections import defaultdict

RPP = 1.045
LANE = {5: "3B", 6: "SS", 4: "2B", 3: "1B", -1: "no-spray"}

def load(path):
    rows = []
    with open(path) as fh:
        r = csv.DictReader(fh)
        for d in r:
            xa = d["xavg"]
            if xa in ("", "None"): continue
            rows.append((float(xa), int(d["is_out"]),
                         None if d["spray"] in ("", "None") else float(d["spray"]),
                         int(d["geo_lane"])))
    return rows

def isotonic_hit_rate(rows, nbins=50):
    """Bin by xAVG, compute per-bin hit rate, then PAV-isotonic (monotone non-decreasing in xAVG).
    Returns the lookup from _pav_with_centers: sorted (xcenter, fitted_hit_rate)."""
    b = defaultdict(lambda: [0, 0])  # bin -> [hits, n]
    for xa, io, _, _ in rows:
        i = min(nbins - 1, int(xa * nbins))
        b[i][0] += (1 - io); b[i][1] += 1     # is_out=1 -> hit=0
    xs = [[(i + 0.5) / nbins, hits / n, n] for i in sorted(b) for hits, n in [b[i]]]
    return _pav_with_centers(xs)

def _pav_with_centers(xs):
    """PAV returning a lookup: sorted list of (xcenter, fitted_hit_rate)."""
    centers = [r[0] for r in xs]; y = [r[1] for r in xs]; w = [r[2] for r in xs]
    blocks = [[y[k], w[k], k, k] for k in range(len(y))]  # val, weight, lo, hi
    j = 0
    while j < len(blocks) - 1:
        if blocks[j][0] > blocks[j + 1][0] + 1e-12:
            v = (blocks[j][0]*blocks[j][1] + blocks[j+1][0]*blocks[j+1][1])/(blocks[j][1]+blocks[j+1][1])
            blocks[j] = [v, blocks[j][1]+blocks[j+1][1], blocks[j][2], blocks[j+1][3]]
            del blocks[j+1]
            if j > 0: j -= 1
        else:
            j += 1
    lut = []
    for v, wt, lo, hi in blocks:
        for k in range(lo, hi + 1):
            lut.append((centers[k], v))
    return lut

def g_out(lut, xa):
    """calibrated P(out) = 1 - isotonic P(hit) at xa (nearest bin center)."""
    best = min(lut, key=lambda t: abs(t[0] - xa))
    return 1 - best[1]

def range_sum(rows, xkey):
    """sum of range runs: out -> +xkey*RPP ; hit -> -(1-xkey)*RPP, where xkey is the P(hit)
    used for pricing (raw xavg, or 1-g_out for the calibrated version)."""
    s = 0.0
    for xa, io, sp, lane in rows:
        ph = xkey(xa)
        s += (ph if io else -(1 - ph)) * RPP
    return s

def lane_report(rows, label, xkey):
    by = defaultdict(lambda: [0, 0, 0.0])  # lane -> [n_out, n, sum_ph]
    for xa, io, sp, lane in rows:
        by[lane][0] += io; by[lane][1] += 1; by[lane][2] += xkey(xa)
    print(f"  {label}: lane   n      O(actual)  1-meanPh(pred)   range_sum")
    for lane in (5, 6, 4, 3, -1):
        if lane not in by: continue
        no, n, sph = by[lane]
        O = no / n; pred = 1 - sph / n
        rs = range_sum([r for r in rows if r[3] == lane], xkey)
        print(f"       {LANE[lane]:<8} {n:6d}   {O:.4f}     {pred:.4f}        {rs:+8.0f}")

def main():
    path = "output/grounder_pop.csv"
    if not os.path.exists(path):
        print("run collect_grounder_pop.py first"); return
    rows = load(path)
    N = len(rows)
    O = sum(io for _, io, _, _ in rows) / N
    X = sum(xa for xa, _, _, _ in rows) / N
    print(f"infield scored grounders: {N:,}   O(actual out rate) {O:.4f}   mean xAVG {X:.4f}")
    print(f"  pre-fit  O + X - 1 = {O + X - 1:+.4f}   league range_sum = {range_sum(rows, lambda x: x):+.0f}\n")

    print("PRE-FIT per lane (raw xAVG pricing):")
    lane_report(rows, "raw", lambda x: x)

    lut = isotonic_hit_rate(rows, nbins=50)
    g_hit_global = lambda x: 1 - g_out(lut, x)   # calibrated P(hit) from xAVG alone
    print(f"\nPOST-FIT global isotonic g(xAVG) only:")
    print(f"  league range_sum = {range_sum(rows, g_hit_global):+.0f}")
    lane_report(rows, "g", g_hit_global)

    # ---- spray-region offsets: correct xAVG's out-prob for the BALL's direction ----
    # offset(spray_bin) = mean(actual_out - global_g_predicted_out) over balls in the bin.
    # This zeroes each spray region's total (=> lanes zero by construction) while leaving xAVG's
    # within-ball ordering intact. Fit on spray REGIONS OF THE BALL, never on fielder position.
    BINW = 5.0
    def sbin(sp): return int((sp + 60) // BINW)  # spray in ~[-50,50] -> non-negative bin index
    off_acc = defaultdict(lambda: [0.0, 0])       # bin -> [sum(actual_out - g_out_pred), n]
    for xa, io, sp, lane in rows:
        if sp is None: continue
        pred_out = g_out(lut, xa)
        off_acc[sbin(sp)][0] += (io - pred_out); off_acc[sbin(sp)][1] += 1
    offsets = {b: (s / n if n >= 100 else 0.0) for b, (s, n) in off_acc.items()}

    def g_hit_2d(xa, sp):
        pout = g_out(lut, xa) + (offsets.get(sbin(sp), 0.0) if sp is not None else 0.0)
        return 1 - min(1.0, max(0.0, pout))

    def range_sum_2d(rws):
        s = 0.0
        for xa, io, sp, lane in rws:
            ph = g_hit_2d(xa, sp)
            s += (ph if io else -(1 - ph)) * RPP
        return s

    print(f"\nPOST-FIT g(xAVG, spray)  [global g + {BINW:.0f}° spray-region offsets]:")
    print(f"  league range_sum = {range_sum_2d(rows):+.0f}   (target ~0)")
    # per-lane under the -25 boundary (relane spray-present rows)
    def relane(sp, cut3b=-25.0):
        if sp is None: return -1
        if sp < cut3b: return 5
        if sp < 2: return 6
        if sp < 30: return 4
        return 3
    by = defaultdict(lambda: [0, 0, 0.0])
    for xa, io, sp, _ in rows:
        ln = relane(sp)
        by[ln][0] += io; by[ln][1] += 1
        ph = g_hit_2d(xa, sp)
        by[ln][2] += (ph if io else -(1 - ph)) * RPP
    print("  lane (cut -25)   n       O        range_sum")
    for ln in (5, 6, 4, 3, -1):
        if ln not in by: continue
        no, n, rs = by[ln]
        print(f"       {LANE[ln]:<8} {n:7d}   {no/n:.4f}    {rs:+8.0f}")

    # emit calibration for baking into the engine — a SEASON FIXTURE, stamped with the season +
    # constants it was derived against so the engine can refuse a stale one (see engine load guard).
    from drs_engine import constants as C
    cal = {
        "season": C.SEASON,
        "constants_version": C.CONSTANTS_VERSION,
        "engine_version": C.ENGINE_VERSION,
        "calibration_version": f"gcal_{C.SEASON}_v1",
        "rpp": RPP, "spray_bin_width": BINW, "spray_bin_offset": 60,
        "boundary_3b_ss": -25.0,
        "global_g_hit": [[round(c, 4), round(v, 5)] for c, v in lut],
        "spray_offsets": {str(b): round(o, 5) for b, o in sorted(offsets.items())},
    }
    import json
    out = "fixtures/grounder_calibration.json"
    with open(out, "w") as fh:
        json.dump(cal, fh, indent=1)
    print(f"\nwrote {out}  ({len(lut)} g-breakpoints, {len(offsets)} spray bins)")

if __name__ == "__main__":
    main()
