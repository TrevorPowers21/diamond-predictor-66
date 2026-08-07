"""
Derive the fractional reach-share table for grounder HIT debits (the shared-seam fix).

For a hit at spray s, the fielders who owe the debit and in what proportion = the empirical share
of OUTS converted by each fielder at that spray. Self-consistent by construction: the same
population that earns the credits (putout chain) defines who owes the debits. CREDITS stay
individual and are NOT touched by this table.

Season fixture (2026 out conversions) -> fixtures/reach_shares.json, stamped like the calibration.
Light 3-bin smoothing; shares below FLOOR dropped as noise and renormalized so a distant fielder
is never debited for a ball he essentially never reaches.
"""
import csv, os, json
from collections import defaultdict
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine import constants as C

ORDER = [5, 6, 4, 3]  # 3B SS 2B 1B
BINW = 2.0
FLOOR = 0.03

# RUN-space weighting: a position's blame share at spray s is its share of difficulty-weighted
# conversions (summed post-calibration credit = P(hit) per out), NOT its raw out count. This makes
# debits distribute by the same measure as credits, so per-position zero is structural wherever the
# calibration zeroes a bin — fixing the count-based-blame-on-a-run-ledger corners-pay transfer.
_gc = json.load(open("fixtures/grounder_calibration.json"))
_breaks = sorted(_gc["global_g_hit"])
_grid = [1.0 - min(_breaks, key=lambda t: abs(t[0] - i / 1000.0))[1] for i in range(1001)]
def _ph(xa, spray):   # calibrated P(hit) = credit weight of converting this ball
    pout = _grid[max(0, min(1000, int(round(xa * 1000))))]
    b = int((spray + _gc["spray_bin_offset"]) // _gc["spray_bin_width"])
    pout += _gc["spray_offsets"].get(str(b), 0.0)
    return 1.0 - min(1.0, max(0.0, pout))

def main():
    counts = defaultdict(lambda: defaultdict(float))  # bincenter -> fielder -> summed credit weight
    with open("output/grounder_pop.csv") as fh:
        for d in csv.DictReader(fh):
            if d["is_out"] != "1" or d["spray"] in ("", "None") or d["xavg"] in ("", "None"): continue
            f = int(d["fielder"])
            if f in ORDER:
                counts[round(float(d["spray"]) / BINW) * BINW][f] += _ph(float(d["xavg"]), float(d["spray"]))

    centers = sorted(counts)
    # 3-bin moving average on raw counts to de-noise, then share + floor + renormalize
    table = {}
    for i, c in enumerate(centers):
        window = centers[max(0, i - 1): i + 2]
        agg = defaultdict(float)
        for w in window:
            for f, n in counts[w].items(): agg[f] += n
        tot = sum(agg.values())
        if tot < 30: continue
        sh = {f: agg.get(f, 0) / tot for f in ORDER}
        sh = {f: v for f, v in sh.items() if v >= FLOOR}   # drop noise
        s = sum(sh.values())
        table[c] = {str(f): round(v / s, 4) for f, v in sh.items()}   # renormalize

    out = {
        "season": C.SEASON,
        "constants_version": C.CONSTANTS_VERSION,
        "engine_version": C.ENGINE_VERSION,
        "reach_version": f"reach_{C.SEASON}_v2_runweighted",
        "weighting": "run",   # difficulty-weighted conversions (credit), not raw out counts
        "bin_width": BINW, "floor": FLOOR,
        "shares": {str(k): v for k, v in sorted(table.items())},
    }
    with open("fixtures/reach_shares.json", "w") as fh:
        json.dump(out, fh, indent=1)
    print(f"wrote fixtures/reach_shares.json  ({len(table)} spray bins, {BINW:.0f}°)")
    # quick echo of the three seams
    for c in [-24, -22, 0, 2, 28, 30]:
        b = round(c / BINW) * BINW
        print(f"  spray {c:+4.0f}: " + "  ".join(f"{k}:{v}" for k, v in table.get(b, {}).items()))

if __name__ == "__main__":
    main()
