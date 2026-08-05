"""
RSTR IQ :: baserunning (wSB) runner.
Usage: python3 run_baserunning.py <export_or_dir_or_glob> [more ...]
Writes output/player_season_baserunning.csv (+ asserts league wSB nets ~0).
"""
import sys, csv, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.normalize import load_rows, load_re24
from drs_engine.baserunning import BaserunningEngine

def main(paths):
    skipped = []
    rows = load_rows(paths, skipped=skipped)
    if not rows:
        print("no Standard-export rows loaded.", file=sys.stderr)
        sys.exit(2)
    eng = BaserunningEngine(load_re24())
    eng.derive_fixtures(rows)
    eng.run(rows)
    res = eng.player_season_rows(season=2026)

    os.makedirs("output", exist_ok=True)
    with open("output/player_season_baserunning.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(res[0].keys()))
        w.writeheader(); w.writerows(res)

    net = sum(r["wsb_runs"] for r in res)
    print(f"pitches: {len(rows)}  runners: {len(res)}  files skipped: {len(skipped)}")
    print(f"league SB {sum(r['SB'] for r in res)}  CS {sum(r['CS'] for r in res)}  "
          f"zero-sum wSB {net:+.4f} (should be ~0)")
    for s in skipped:
        print(f"  skipped: {s[0]}  [{s[1]}] {s[2]}")

if __name__ == "__main__":
    main(sys.argv[1:])
