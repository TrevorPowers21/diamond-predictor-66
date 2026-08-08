"""
STEP 0 · hitter-stat accrual PROTOTYPE — tally the season hitter line from the DRS Pitch Log.
Reads docs/drs-reference/*DRS Pitch Log.csv (dedup on uniqPitchId), parses atbatDesc, tallies per batterId.
  AB = PA − BB − HBP − SF − SH ; H = 1B+2B+3B+HR ; TB = 1B+2·2B+3·3B+4·HR
  AVG = H/AB ; OBP = (H+BB+HBP)/(AB+BB+HBP+SF) ; SLG = TB/AB ; ISO = SLG−AVG
Validate vs `Hitter Master` (AVG/OBP/SLG/ISO). Output -> output/hitter_accrued.csv
  python3 scripts/drs/accrue_hitter_stats.py
"""
import sys, os, csv, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.parser import parse_atbat_desc, ParseError

FILES = sorted(glob.glob("docs/drs-reference/*DRS Pitch Log.csv"))

class B:
    __slots__ = ("name","team","pa","bb","hbp","sf","sh","h1","h2","h3","hr","outs")
    def __init__(s):
        s.name=""; s.team=""; s.pa=0; s.bb=0; s.hbp=0; s.sf=0; s.sh=0
        s.h1=0; s.h2=0; s.h3=0; s.hr=0; s.outs=0

bat = {}
seen = set()
n_pa = n_bad = 0
for f in FILES:
    with open(f, newline="") as fh:
        for r in csv.DictReader(fh):
            uid = r.get("uniqPitchId")
            if uid in seen: continue
            seen.add(uid)
            desc = (r.get("atbatDesc") or "").strip()
            if desc in ("", "-"): continue
            bid = (r.get("batterId") or "").strip()
            if not bid: continue
            try:
                ev = parse_atbat_desc(desc)
            except ParseError:
                n_bad += 1; continue
            if not ev.is_pa: continue   # CS/PO/pickoff = baserunning out, not a plate appearance
            n_pa += 1
            b = bat.get(bid)
            if b is None:
                b = bat[bid] = B()
                b.name = (r.get("batterAbbrevName") or "").strip()
                b.team = (r.get("battingTeam") or "").strip()
            b.pa += 1
            if ev.is_walk: b.bb += 1
            elif ev.is_hbp: b.hbp += 1
            elif ev.is_sf: b.sf += 1
            elif ev.is_sh: b.sh += 1
            elif ev.is_ci: pass   # catcher's interference: a PA but NOT an AB (excluded), not a hit
            elif ev.event_type == "SINGLE": b.h1 += 1
            elif ev.event_type == "DOUBLE": b.h2 += 1
            elif ev.event_type == "TRIPLE": b.h3 += 1
            elif ev.event_type == "HR": b.hr += 1
            else: b.outs += 1     # OUT / K / ERROR (ROE) / FC / OTHER-nonBB → an AB, no hit

print(f"files {len(FILES)} | PAs parsed {n_pa} | parse-fails {n_bad} | hitters {len(bat)}")

rows = []
for bid, b in bat.items():
    ab = b.h1 + b.h2 + b.h3 + b.hr + b.outs         # everything that isn't BB/HBP/SF/SH
    if ab <= 0: continue
    h = b.h1 + b.h2 + b.h3 + b.hr
    tb = b.h1 + 2*b.h2 + 3*b.h3 + 4*b.hr
    avg = h/ab
    obp_den = ab + b.bb + b.hbp + b.sf
    obp = (h + b.bb + b.hbp)/obp_den if obp_den else 0
    slg = tb/ab
    rows.append({"source_player_id": bid, "name": b.name, "team": b.team,
                 "PA": b.pa, "AB": ab, "H": h, "2B": b.h2, "3B": b.h3, "HR": b.hr,
                 "BB": b.bb, "HBP": b.hbp, "SF": b.sf, "SH": b.sh,
                 "AVG": round(avg,3), "OBP": round(obp,3), "SLG": round(slg,3), "ISO": round(slg-avg,3)})

rows.sort(key=lambda x: -x["PA"])
os.makedirs("scripts/drs/output", exist_ok=True)
out = "scripts/drs/output/hitter_accrued.csv"
with open(out, "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(f"wrote {out} ({len(rows)} hitters with AB>0)")
print("\ntop 6 by PA:")
for x in rows[:6]:
    print(f"  {x['name']:16} {x['team']:6} PA {x['PA']:4} AB {x['AB']:4} AVG {x['AVG']:.3f} OBP {x['OBP']:.3f} SLG {x['SLG']:.3f} (H{x['H']} 2B{x['2B']} HR{x['HR']} BB{x['BB']})")
