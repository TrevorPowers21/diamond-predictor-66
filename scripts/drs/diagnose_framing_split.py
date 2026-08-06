"""
Diagnostic 1 — is catcher framing SKILL or SENSOR (park calibration)?

Per Trevor: split every catcher's framing into home vs road.
  - SKILL  -> a catcher's home framing rate correlates with his road rate (he frames
    the same wherever he plays). The home/road gap is small and unsystematic.
  - SENSOR -> home framing diverges from road systematically BY VENUE (a miscalibrated
    park farms fake framing for whoever catches there). Then the fix is per-park
    calibration at the source, not a scale on dWAR.

Framing value per taken pitch uses the engine's own logic:
    STRIKE (called): +(1 - probSL) * RUNS_PER_STRIKE
    BALL   (called): -(probSL)     * RUNS_PER_STRIKE
Rate = framing runs / taken pitches (runs per framing chance) — volume-free, so home
and road are comparable even with different pitch counts.

Usage: python3 diagnose_framing_split.py "docs/drs-reference/*DRS Pitch Log.csv"
(no arg -> defaults to that glob relative to repo root)
"""
import csv, glob, sys, math
from collections import defaultdict
from drs_engine.normalize import framing_class
from drs_engine.constants import RUNS_PER_STRIKE

def main(patterns):
    files = []
    for p in patterns:
        files.extend(glob.glob(p))
    files = sorted(set(files))
    if not files:
        print("no files matched", patterns); return
    print(f"{len(files)} pitch-log files")

    # per catcher: [home_runs, home_n, road_runs, road_n]
    cat = defaultdict(lambda: [0.0, 0, 0.0, 0])
    catname = {}
    # per catcher overall rate (for venue residual)
    cat_all = defaultdict(lambda: [0.0, 0])
    # per venue: residual sum vs each catcher's own overall rate, count
    ven = defaultdict(lambda: [0.0, 0])
    venname = {}
    rows = 0

    # first pass: overall per-catcher rate + tallies we can do in one pass by buffering venue rows.
    # To avoid a second file pass, we accumulate raw (cid, venue, val) then resolve residuals after
    # we know each catcher's overall rate. Memory: ~one float+two ids per framing pitch (~1.5M) — fine.
    buf = []  # (cid, venue, val)

    for f in files:
        with open(f, newline="") as fh:
            r = csv.DictReader(fh)
            for row in r:
                rows += 1
                cls = framing_class(row.get("pitchResult"))
                if cls == "STRIKE":
                    try: p = float(row.get("probSL") or "")
                    except ValueError: continue
                    val = (1.0 - p) * RUNS_PER_STRIKE
                elif cls == "BALL":
                    try: p = float(row.get("probSL") or "")
                    except ValueError: continue
                    val = -p * RUNS_PER_STRIKE
                else:
                    continue
                cid = row.get("catcherId") or ""
                if not cid: continue
                catname[cid] = row.get("catcherAbbrevName") or cid
                venue = row.get("gameVenueId") or ""
                venname[venue] = venue
                home_team = row.get("team") if (row.get("home") == "true") else row.get("opponent")
                is_home = (row.get("catchingTeam") == home_team)
                a = cat[cid]
                if is_home: a[0] += val; a[1] += 1
                else:       a[2] += val; a[3] += 1
                ca = cat_all[cid]; ca[0] += val; ca[1] += 1
                buf.append((cid, venue, val))

    print(f"scanned {rows:,} pitches; {len(buf):,} framing chances; {len(cat)} catchers; {len(venname)} venues\n")

    # ---- League-wide home vs road framing rate (systematic home-field/ump effect) ----
    H = sum(a[0] for a in cat.values()); Hn = sum(a[1] for a in cat.values())
    R = sum(a[2] for a in cat.values()); Rn = sum(a[3] for a in cat.values())
    print("LEAGUE framing rate (runs / chance):")
    print(f"  home {H/Hn:+.5f}  ({Hn:,} chances)   road {R/Rn:+.5f}  ({Rn:,} chances)   gap {H/Hn - R/Rn:+.5f}\n")

    # ---- Per-catcher home rate vs road rate correlation (the skill test) ----
    MIN = 300
    xs, ys, gaps = [], [], []
    for cid, a in cat.items():
        if a[1] >= MIN and a[3] >= MIN:
            hr, rr = a[0]/a[1], a[2]/a[3]
            xs.append(hr); ys.append(rr); gaps.append(hr - rr)
    def pearson(x, y):
        n = len(x); mx = sum(x)/n; my = sum(y)/n
        sx = math.sqrt(sum((v-mx)**2 for v in x)); sy = math.sqrt(sum((v-my)**2 for v in y))
        if sx == 0 or sy == 0: return float("nan")
        return sum((x[i]-mx)*(y[i]-my) for i in range(n))/(sx*sy)
    print(f"HOME-vs-ROAD per-catcher rate (catchers with >={MIN} chances each side): n={len(xs)}")
    if xs:
        r = pearson(xs, ys)
        mg = sum(gaps)/len(gaps); sg = math.sqrt(sum((g-mg)**2 for g in gaps)/len(gaps))
        print(f"  Pearson r(home_rate, road_rate) = {r:+.3f}   <- high & positive = SKILL")
        print(f"  mean(home-road gap) = {mg:+.5f}  sd = {sg:.5f}   <- large systematic gap = suspicious\n")

    # ---- Venue calibration residuals (the sensor test) ----
    # residual of each framing chance vs the CATCHER's own overall rate; averaged per venue.
    for cid, venue, val in buf:
        base = cat_all[cid][0]/cat_all[cid][1]
        v = ven[venue]; v[0] += (val - base); v[1] += 1
    vlist = [(vn, s/n, n) for vn, (s, n) in ven.items() if n >= 2000]
    vlist.sort(key=lambda t: t[1])
    print(f"VENUE residual (framing vs catcher's own baseline; venues >=2000 chances): n={len(vlist)}")
    print("  most NEGATIVE (park suppresses framing for everyone):")
    for vn, mr, n in vlist[:6]:  print(f"    venue {vn:>12}  {mr:+.5f}  ({n:,})")
    print("  most POSITIVE (park inflates framing for everyone):")
    for vn, mr, n in vlist[-6:]: print(f"    venue {vn:>12}  {mr:+.5f}  ({n:,})")
    if vlist:
        resids = [mr for _, mr, _ in vlist]
        m = sum(resids)/len(resids); sd = math.sqrt(sum((x-m)**2 for x in resids)/len(resids))
        print(f"  venue-residual sd = {sd:.5f} runs/chance   (big vs league rate ~{H/Hn:.4f} = calibration matters)")

if __name__ == "__main__":
    pats = sys.argv[1:] or ["docs/drs-reference/*DRS Pitch Log.csv"]
    main(pats)
