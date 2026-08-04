"""
RSTR IQ dRS Engine :: runner
Usage: python3 run_drs.py <export_or_dir_or_glob> [more ...]
  - Accepts individual Standard-export CSVs, a directory (globs *.csv), or a
    glob pattern. Non-Standard files (no atbatDesc) are skipped with a logged
    reason, so a mixed / date-organized upload folder degrades gracefully.
Writes: output/player_season_defense.csv, output/exceptions_log.csv,
        fixtures/league_fixtures.json
"""
import sys, csv, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.normalize import load_rows, derive_league_fixtures, load_re24
from drs_engine.engine import DRSEngine

def main(paths):
    skipped = []
    rows = load_rows(paths, skipped=skipped)
    if not rows:
        print("no Standard-export rows loaded.", file=sys.stderr)
        for s in skipped:
            print(f"  skipped: {s}", file=sys.stderr)
        sys.exit(2)

    os.makedirs("output", exist_ok=True)
    fx = derive_league_fixtures(rows, out_path="fixtures/league_fixtures.json")
    eng = DRSEngine(fx, load_re24())
    eng.run(rows)
    res = eng.player_season_rows(season=2026)

    with open("output/player_season_defense.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(res[0].keys()))
        w.writeheader()
        w.writerows(res)

    with open("output/exceptions_log.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["uniqPitchId", "game", "reason", "detail", "atbatDesc"])
        for x in eng.exceptions:
            w.writerow([x.uniq_pitch_id, x.game, x.reason, x.detail, x.raw])

    print(f"pitches: {len(rows)}  |  fixture quality: {fx['fixture_quality']}")
    print(f"player-position rows: {len(res)}  |  exceptions: {len(eng.exceptions)}"
          f"  |  files skipped: {len(skipped)}")
    print(f"league fixtures: DP {fx['dp_conv_n']}/{fx['dp_opp_n']} rate {fx['dp_rate']:.3f}, "
          f"SB success {fx['sb_success_rate']:.3f}, xOut(G/F/L/P): "
          + ", ".join(f"{k}={v:.3f}" for k, v in sorted(fx['league_xout_by_bb'].items())))
    for s in skipped:
        print(f"  skipped: {s[0]}  [{s[1]}] {s[2]}")

if __name__ == "__main__":
    main(sys.argv[1:])
