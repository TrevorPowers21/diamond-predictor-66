"""
RSTR IQ dRS Engine :: runner
Usage: python3 run_drs.py <export_or_dir_or_glob> [more ...]
  - Accepts individual Standard-export CSVs, a directory (globs *.csv), or a
    glob pattern. Non-Standard files (no atbatDesc) are skipped with a logged
    reason, so a mixed / date-organized upload folder degrades gracefully.
Writes: output/player_season_defense.csv, output/exceptions_log.csv,
        fixtures/league_fixtures.json
  --regular-season : accrue ONLY regular-season games (≤ SEASON_BOUNDS end, is_regular_season),
    but derive the run-environment fixtures on ALL games so the baseline is identical and the
    regular-season dRS is a true SUBSET of the full-season dRS (Step-2 desc_*_reg). Writes
    output/player_season_defense_regseason.csv and skips the audit-fixture writes.
"""
import sys, csv, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.normalize import load_rows, derive_league_fixtures, load_re24
from drs_engine.engine import DRSEngine
from drs_engine import constants as C
from drs_engine.season_config import is_regular_season

def main(paths):
    reg_only = "--regular-season" in paths
    paths = [p for p in paths if p != "--regular-season"]
    skipped = []
    rows = load_rows(paths, skipped=skipped)
    if not rows:
        print("no Standard-export rows loaded.", file=sys.stderr)
        for s in skipped:
            print(f"  skipped: {s}", file=sys.stderr)
        sys.exit(2)

    os.makedirs("output", exist_ok=True)
    # Baseline (park effects, xOut rates) derived on ALL games so reg = true subset of full.
    fx = derive_league_fixtures(rows, out_path=None if reg_only else "fixtures/league_fixtures.json")
    if reg_only:
        rows = [r for r in rows if is_regular_season(r.get("gameString") or r.get("gameDate") or "")]
        print(f"regular-season mode: accruing {len(rows)} regular-season pitches "
              f"(≤ {C.SEASON}-05-18 boundary; fixtures still on all games)")
    eng = DRSEngine(fx, load_re24())
    eng.run(rows)
    res = eng.player_season_rows(season=2026)

    if reg_only:
        with open("output/player_season_defense_regseason.csv", "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=list(res[0].keys()))
            w.writeheader(); w.writerows(res)
        print(f"wrote output/player_season_defense_regseason.csv ({len(res)} rows, source_player_id emitted)")
        return

    with open("output/player_season_defense.csv", "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(res[0].keys()))
        w.writeheader()
        w.writerows(res)

    with open("output/exceptions_log.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["uniqPitchId", "game", "reason", "detail", "atbatDesc"])
        for x in eng.exceptions:
            w.writerow([x.uniq_pitch_id, x.game, x.reason, x.detail, x.raw])

    # audit: the derived error-centering rates (expected error COST per ENGAGEMENT), stamped.
    # Derived fresh each run from this season's data (no stale risk); committed for auditability.
    # Engagement definition: fixtures/ERROR_CENTERING.md.
    with open("fixtures/error_rates.json", "w") as fh:
        json.dump({"season": C.SEASON, "constants_version": C.CONSTANTS_VERSION,
                   "engine_version": C.ENGINE_VERSION,
                   "unit": "expected error cost (runs) per fielding engagement",
                   "rates": eng.err_rates}, fh, indent=1)

    # framing park effects (venue de-confounding) + extreme-park flags, for audit
    pe = eng.park_effects
    if pe:
        vals = sorted(pe.values())
        lo, hi = vals[max(0, len(vals)//40)], vals[min(len(vals)-1, len(vals)-1-len(vals)//40)]
        with open("fixtures/park_effects.json", "w") as fh:
            json.dump({"season": C.SEASON, "constants_version": C.CONSTANTS_VERSION,
                       "engine_version": C.ENGINE_VERSION,
                       "unit": "framing park effect (runs) per called-pitch chance",
                       "extreme_flag_abs": round(max(abs(lo), abs(hi)), 5),
                       "park_effects": pe}, fh, indent=1)

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
