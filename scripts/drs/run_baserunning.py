"""
RSTR IQ :: baserunning (wSB) runner — two-file architecture.
Usage: python3 run_baserunning.py "<Full Season Stolen Bases.csv>" "<SBA Attempt Pitch Log.csv>"
Writes output/player_season_baserunning.csv and prints the reconciliation.
"""
import sys, os, csv
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.normalize import load_re24
from drs_engine.baserunning import derive_base_values, load_season_totals, compute_wsb

def main(season_path, attempt_path):
    re24 = load_re24()
    vals = derive_base_values(attempt_path, re24)
    season = load_season_totals(season_path)
    rows = compute_wsb(season, vals)

    os.makedirs("output", exist_ok=True)
    with open("output/player_season_baserunning.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)

    # ---- reconciliation ----
    print("per-base run VALUES (RE24, state-weighted from attempt log):")
    for base, lab in ((2, "steal 2nd"), (3, "steal 3rd"), (4, "steal home")):
        print(f"  {lab:11}: SB {vals.get((base,'SB')):+.3f}   CS {vals.get((base,'CS')):+.3f}")
    tot = sum(r["wsb_runs"] for r in rows)
    print(f"\nZERO-SUM league wSB: {tot:+.3f}  (should be ~0)")
    print(f"players: {len(rows):,}  total SB {sum(r['SB'] for r in rows):,}  CS {sum(r['CS'] for r in rows):,}")
    q = [r for r in rows if r["opportunities"] >= 30]
    q.sort(key=lambda r: -r["wsb_runs"])
    print("\nTOP 10 baserunners (>=30 opp):")
    for r in q[:10]:
        print(f"  {r['player']:15} {str(r['org_id']):9} {r['position']:3} SB {r['SB']:3} CS {r['CS']:2} SBH {r['SBH']}  "
              f"wsb {r['wsb_runs']:+5.2f}  reg {r['wsb_runs_reg']:+5.2f}")
    print("BOTTOM 5:")
    for r in q[-5:]:
        print(f"  {r['player']:15} {str(r['org_id']):9} {r['position']:3} SB {r['SB']:3} CS {r['CS']:2}  wsb {r['wsb_runs']:+5.2f}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
