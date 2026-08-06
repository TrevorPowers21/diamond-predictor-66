"""
Expectation 4 — the 9.8° vs 10.2° seam is still smooth after the grounder model changed.

A ball at LA<10 is priced by the grounder model (now g(xAVG,spray)); LA in [10,25) by the air
catch-surface (unchanged). If those two models disagree on P(out) right at the boundary, a ball's
value would jump discontinuously as LA crosses 10. We hook the actual credit/debit calls (so we
read exactly the xout the engine priced) and compare mean priced P(out) in LA bins across 10.
"""
import sys, os, glob
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.normalize import load_rows, derive_league_fixtures, load_re24
from drs_engine.engine import DRSEngine

class Seam(DRSEngine):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.seam = []  # (LA, cls, priced_pout)

    def _rec(self, row, cls, xout):
        la = row.get("_LA")
        if la is not None and 6.0 <= la <= 14.0:
            self.seam.append((la, cls, xout))

    def _range_credit(self, row, pos, xout, cls):
        self._rec(row, cls, xout)
        return super()._range_credit(row, pos, xout, cls)

    def _range_debit_one(self, row, pos, xout, cls, share):
        self._rec(row, cls, xout)
        return super()._range_debit_one(row, pos, xout, cls, share)

def main(paths):
    rows = load_rows(paths)
    fx = derive_league_fixtures(rows, out_path="fixtures/league_fixtures.json")
    eng = Seam(fx, load_re24())
    eng.run(rows)

    bins = defaultdict(lambda: [0.0, 0, defaultdict(int)])  # 0.5° bin -> [sum_pout, n, cls counts]
    for la, cls, pout in eng.seam:
        b = round(la * 2) / 2.0
        bins[b][0] += pout; bins[b][1] += 1; bins[b][2][cls] += 1
    print("LA bin   n     mean priced P(out)   dominant cls")
    prev = None
    for b in sorted(bins):
        s, n, cc = bins[b]
        dom = max(cc, key=cc.get)
        mark = ""
        if prev is not None and abs(s / n - prev) > 0.08:
            mark = "  <-- jump"
        print(f"  {b:5.1f}  {n:5d}     {s/n:.4f}            {dom}{mark}")
        prev = s / n
    # explicit across-seam compare
    lo = [(s, n) for b, (s, n, _) in bins.items() if 8.0 <= b < 10.0]
    hi = [(s, n) for b, (s, n, _) in bins.items() if 10.0 <= b < 12.0]
    if lo and hi:
        mlo = sum(s for s, _ in lo) / sum(n for _, n in lo)
        mhi = sum(s for s, _ in hi) / sum(n for _, n in hi)
        print(f"\n  GB side (8-10°) mean P(out) {mlo:.4f}   LD side (10-12°) {mhi:.4f}   "
              f"seam gap {mhi - mlo:+.4f}   ({'smooth' if abs(mhi-mlo)<0.08 else 'DISCONTINUITY'})")

if __name__ == "__main__":
    pats = sys.argv[1:] or ["../../docs/drs-reference/*DRS Pitch Log.csv"]
    files = []
    for p in pats: files.extend(glob.glob(p))
    main(sorted(set(files)))
