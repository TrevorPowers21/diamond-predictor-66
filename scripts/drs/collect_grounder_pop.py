"""
Post-exclusion collector: run the engine (P/C now excluded from the grounder pool) and dump the
scored INFIELD grounder population for the g(xAVG) refit + per-lane checks, plus print the
reconciliation so we can confirm the exclusion did exactly what it should (IF stable, P/C
relocated to pitcher_fielding).

Writes output/grounder_pop.csv: xavg, is_out, spray, geo_lane, fielder   (one row per scored
infield grounder; geo_lane = single spray lane or -1 if spray absent; fielder = actual out-maker
or -1 on a hit).
"""
import sys, os, glob, csv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.normalize import load_rows, derive_league_fixtures, load_re24
from drs_engine.engine import DRSEngine
from drs_engine import constants as C

class Collect(DRSEngine):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.pop = []

    def _record(self, row, is_out, fielder):
        lane = self._infield_lane(row)          # geometric spray lane the ball belongs to
        geo = lane[0] if len(lane) == 1 else -1  # -1 when spray absent (4-way split)
        self.pop.append((row.get("_xAVG"), is_out, row.get("_spray"), geo, fielder))

    def _bip_out(self, row, ev, fielder=None):
        f = fielder if fielder is not None else ev.putout_chain[0]
        if self._traj_class(row, ev) == "gb" and f in (3, 4, 5, 6) and row.get("_xAVG") is not None:
            self._record(row, 1, f)
        return super()._bip_out(row, ev, fielder)

    def _bip_hit(self, row, ev):
        if self._traj_class(row, ev) == "gb" and row.get("_xAVG") is not None:
            self._record(row, 0, -1)
        return super()._bip_hit(row, ev)

def main(paths):
    rows = load_rows(paths)
    if not rows:
        print("no rows"); return
    fx = derive_league_fixtures(rows, out_path="fixtures/league_fixtures.json")
    eng = Collect(fx, load_re24())
    eng.run(rows)
    res = eng.player_season_rows(season=2026)

    os.makedirs("output", exist_ok=True)
    with open("output/grounder_pop.csv", "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["xavg", "is_out", "spray", "geo_lane", "fielder"])
        for xa, io, sp, geo, f in eng.pop:
            w.writerow([xa, io, "" if sp is None else sp, geo, f])
    print(f"scored infield grounders dumped: {len(eng.pop):,}\n")

    # ---- reconciliation: range_gb by position after P/C exclusion ----
    by = {}
    pf = {}
    for r in res:
        by.setdefault(r["position"], [0.0, 0])
        by[r["position"]][0] += r["range_gb"]; by[r["position"]][1] += 1
        if r.get("pitcher_fielding"):
            pf.setdefault(r["position"], [0.0, 0])
            pf[r["position"]][0] += r["pitcher_fielding"]; pf[r["position"]][1] += 1
    tot = 0.0
    print("pos   sum(range_gb)   n")
    for p, (s, n) in sorted(by.items(), key=lambda kv: kv[1][0]):
        print(f"  {p:<4} {s:8.0f}   {n}"); tot += s
    g = lambda ps: sum(by.get(p, [0, 0])[0] for p in ps)
    print(f"\nIF(3B,SS,2B,1B) = {g(['3B','SS','2B','1B']):.0f}   P+C range_gb = {g(['P','C']):.0f}   "
          f"OF = {g(['LF','CF','RF']):.0f}   LEAGUE = {tot:.0f}")
    print("relocated pitcher_fielding (outside dWAR):")
    for p, (s, n) in sorted(pf.items(), key=lambda kv: -kv[1][0]):
        print(f"  {p:<4} {s:8.0f}   ({n} rows)")

if __name__ == "__main__":
    pats = sys.argv[1:] or ["../../docs/drs-reference/*DRS Pitch Log.csv"]
    files = []
    for p in pats: files.extend(glob.glob(p))
    main(sorted(set(files)))
