"""
Reach-share curve — out-conversion share by fielder per spray degree.

This is both the diagnosis exhibit and the fix's input table. For a HIT at spray s, the fielders
who owe the debit (and in what proportion) is the empirical share of OUTS actually converted by
each fielder at that same spray s. Derived from grounder_pop.csv (spray, actual-fielder for outs),
which is boundary/pricing-independent: who fields a ball is a fact.

Checks each seam for smooth, monotone transition:
  3B/SS  seam (~-25),  SS/2B seam (~+2, the middle seam - same disease, not yet lit up),
  2B/1B  seam (~+30).
A hard-lane model is the step function 0/1 at each cut; the empirical curve should instead ramp.
"""
import csv, sys
from collections import defaultdict

FCODE = {5: "3B", 6: "SS", 4: "2B", 3: "1B"}
ORDER = [5, 6, 4, 3]  # left(pull) -> right, 3B SS 2B 1B

def load(path="output/grounder_pop.csv"):
    outs = []  # (spray, fielder) for grounder OUTS by an infielder
    with open(path) as fh:
        for d in csv.DictReader(fh):
            if d["is_out"] != "1": continue
            if d["spray"] in ("", "None"): continue
            f = int(d["fielder"])
            if f in FCODE:
                outs.append((float(d["spray"]), f))
    return outs

def main():
    outs = load()
    BINW = 2.0
    bins = defaultdict(lambda: defaultdict(int))  # bincenter -> fielder -> n
    for sp, f in outs:
        b = round(sp / BINW) * BINW
        bins[b][f] += 1
    print(f"reach-share curve  (n_outs={len(outs):,}, {BINW:.0f}° bins)")
    print(f"  spray    n     3B%   SS%   2B%   1B%")
    prev = {}
    seam_notes = []
    for b in sorted(bins):
        row = bins[b]; n = sum(row.values())
        if n < 30: continue
        sh = {f: row.get(f, 0) / n for f in ORDER}
        print(f"  {b:+5.0f}  {n:5d}   " + "  ".join(f"{sh[f]*100:4.0f}" for f in ORDER))
        prev[b] = sh

    # seam smoothness / monotonicity check: does the dominant fielder hand off gradually?
    print("\nseam transitions (share of the two seam fielders across the crossover):")
    def seam(lo, hi, fa, fb, name):
        print(f"  {name} seam  [{fa} -> {fb}]:")
        xs = sorted(b for b in prev if lo <= b <= hi)
        last = None
        mono = True
        for b in xs:
            a, bb = prev[b].get(fa, 0), prev[b].get(fb, 0)
            print(f"     {b:+5.0f}   {FCODE[fa]} {a*100:4.0f}%   {FCODE[fb]} {bb*100:4.0f}%")
            if last is not None and prev[b].get(fa, 0) > last + 0.02: mono = False
            last = prev[b].get(fa, 0)
        print(f"     -> {FCODE[fa]} share monotone non-increasing across seam: {mono}")
    seam(-34, -14, 5, 6, "3B/SS")
    seam(-8, 12, 6, 4, "SS/2B (middle)")
    seam(20, 40, 4, 3, "2B/1B")

if __name__ == "__main__":
    main()
