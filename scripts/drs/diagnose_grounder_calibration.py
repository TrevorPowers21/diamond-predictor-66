"""
Diagnostic 2 — pin O and X on the grounder range ledger, and test the ROE hypothesis.

The range ledger scores grounders that are OUT (credit) or HIT (debit); reached-on-error
grounders (event_type ERROR, outs_made=0) are routed to ErrR and EXCLUDED. But xAVG (a
batting-average model) is trained treating ROE as an OUT. So the ledger's scored population
has a genuinely higher hit rate than xAVG expects -> xAVG over-predicts outs -> net-negative
range. Test:
    predicted out rate = 1 - mean(xAVG)
    O_ledger  = outs / (outs + hits)                      # errors excluded (our ledger)
    O_withROE = (outs + roe) / (outs + hits + roe)        # errors counted as outs (BA convention)
If ROE-exclusion is the cause, O_ledger < predicted (the -2363), and O_withROE closes the gap.

Usage: python3 diagnose_grounder_calibration.py "../../docs/drs-reference/*DRS Pitch Log.csv"
"""
import sys, os, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.normalize import load_rows, derive_league_fixtures, load_re24
from drs_engine.engine import DRSEngine
from drs_engine import constants as C

class Instrumented(DRSEngine):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        # [n, sum_xAVG] for grounders with xAVG present
        self.gb_out = [0, 0.0]   # ledger credit (OUT + FC conversion)
        self.gb_hit = [0, 0.0]   # ledger debit (SINGLE/DOUBLE/TRIPLE)
        self.gb_roe = [0, 0.0]   # excluded (reached-on-error)

    def _bip_out(self, row, ev, fielder=None):
        if self._traj_class(row, ev) == "gb" and row.get("_xAVG") is not None:
            self.gb_out[0] += 1; self.gb_out[1] += row["_xAVG"]
        return super()._bip_out(row, ev, fielder)

    def _bip_hit(self, row, ev):
        if self._traj_class(row, ev) == "gb" and row.get("_xAVG") is not None:
            self.gb_hit[0] += 1; self.gb_hit[1] += row["_xAVG"]
        return super()._bip_hit(row, ev)

    def _error_debit(self, row, fielder, ev, outs_made):
        # only reached-on-error (no out recorded) is excluded from the range ledger
        if outs_made == 0 and self._traj_class(row, ev) == "gb" and row.get("_xAVG") is not None:
            self.gb_roe[0] += 1; self.gb_roe[1] += row["_xAVG"]
        return super()._error_debit(row, fielder, ev, outs_made)

def main(paths):
    rows = load_rows(paths)
    if not rows:
        print("no rows"); return
    fx = derive_league_fixtures(rows, out_path="fixtures/league_fixtures.json")
    eng = Instrumented(fx, load_re24())
    eng.run(rows)

    on, osx = eng.gb_out
    hn, hsx = eng.gb_hit
    rn, rsx = eng.gb_roe
    N = on + hn
    RPP = C.RUNS_PER_PLAY
    X = (osx + hsx) / N                       # mean xAVG over ledger
    O = on / N                                # actual out rate on ledger
    pred = 1 - X                              # xAVG-implied out rate
    # reproduce the range-sum identity: sum(credit) - sum(debit)
    range_sum = RPP * (osx - (hn - hsx))      # Σ_out xAVG − Σ_hit (1−xAVG), all ×RPP
    print(f"scored grounders: OUT {on:,}  HIT {hn:,}  (ledger N={N:,})   ROE(excluded) {rn:,}")
    print(f"error rate on grounders  = {rn/(N+rn):.4f}  ({rn}/{N+rn})")
    print()
    print(f"mean xAVG (ledger)  X   = {X:.4f}   -> xAVG-implied out rate 1-X = {pred:.4f}")
    print(f"actual out rate (ledger) O = {O:.4f}")
    print(f"  O + X - 1 = {O + X - 1:+.4f}   ->  N·RPP·(O+X-1) = {N*RPP*(O+X-1):+.0f} runs")
    print(f"  reproduced range ledger sum = {range_sum:+.0f} runs   (engine reported IF gb ≈ -2363)")
    print()
    X_all = (osx + hsx + rsx) / (N + rn)
    O_roe = (on + rn) / (N + rn)
    print(f"--- ROE test: count reached-on-error as OUTS (the BA/xAVG convention) ---")
    print(f"mean xAVG (ledger+roe) = {X_all:.4f}  -> implied out rate {1-X_all:.4f}")
    print(f"actual out rate w/ ROE-as-out = {O_roe:.4f}")
    print(f"  gap  O_ledger - (1-X)     = {O - pred:+.4f}   (the bug)")
    print(f"  gap  O_withROE - (1-X_all)= {O_roe - (1 - X_all):+.4f}   (≈0 confirms ROE is the cause)")

if __name__ == "__main__":
    pats = sys.argv[1:] or ["../../docs/drs-reference/*DRS Pitch Log.csv"]
    files = []
    for p in pats: files.extend(glob.glob(p))
    main(sorted(set(files)))
