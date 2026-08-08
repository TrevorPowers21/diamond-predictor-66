"""
STEP 0 · pitcher-stat accrual PROTOTYPE — tally the season pitcher line from the DRS Pitch Log.
Reads docs/drs-reference/*DRS Pitch Log.csv (dedup on uniqPitchId), parses atbatDesc, tallies per
pitcherId. Clean per-PA stats (IP/K/BB/HBP/H/HR → FIP/WHIP/K9/BB9/HR9) have no run-attribution issue.
ER/ERA uses a MOUND simplification for now (charged to the pitcher on the scoring PA) — inherited-runner
attribution is the known refinement; the diff vs Pitching Master quantifies it.
  python3 scripts/drs/accrue_pitcher_stats.py            # full season -> output/pitcher_accrued.csv
  python3 scripts/drs/accrue_pitcher_stats.py --team WISC  # filter to one team's pitchers (by abbrev)
"""
import sys, os, csv, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.parser import parse_atbat_desc, ParseError, outs_recorded

TEAM = None
for i, a in enumerate(sys.argv):
    if a == "--team" and i + 1 < len(sys.argv):
        TEAM = sys.argv[i + 1]

FILES = sorted(glob.glob("docs/drs-reference/*DRS Pitch Log.csv"))
FIP_C = 3.10  # league FIP constant placeholder; recalc = lgERA − (13*lgHR+3*(lgBB+lgHBP)−2*lgK)/lgIP

class P:
    __slots__ = ("name", "team", "outs", "k", "bb", "hbp", "h", "hr", "er", "bf")
    def __init__(s): s.name=""; s.team=""; s.outs=0; s.k=0; s.bb=0; s.hbp=0; s.h=0; s.hr=0; s.er=0; s.bf=0

pit = {}
seen = set()
n_pa = n_bad = 0
for f in FILES:
    with open(f, newline="") as fh:
        for r in csv.DictReader(fh):
            uid = r.get("uniqPitchId")
            if uid in seen: continue
            seen.add(uid)
            desc = (r.get("atbatDesc") or "").strip()
            if desc in ("", "-"): continue           # only PA-ending pitches carry the event
            pid = (r.get("pitcherId") or "").strip()
            if not pid: continue
            try:
                ev = parse_atbat_desc(desc)
            except ParseError:
                n_bad += 1; continue
            n_pa += 1
            p = pit.get(pid)
            if p is None:
                p = pit[pid] = P()
                p.name = (r.get("pitcherAbbrevName") or "").strip()
                p.team = (r.get("pitchingTeam") or r.get("team") or "").strip()
            p.bf += 1
            # IP outs = fielding outs (outs_recorded, built for DEFENSE so it EXCLUDES strikeouts)
            # PLUS the strikeout itself, which is an out for the pitcher's IP.
            p.outs += outs_recorded(ev) + (1 if ev.event_type == "K" else 0)
            if ev.event_type == "K": p.k += 1
            if ev.is_walk: p.bb += 1
            if ev.is_hbp: p.hbp += 1
            if ev.event_type in ("SINGLE", "DOUBLE", "TRIPLE", "HR"): p.h += 1
            if ev.event_type == "HR": p.hr += 1
            # earned runs (MOUND simplification): runner movements to H that are NOT unearned,
            # PLUS the batter's run on a HR (implicit — the batter is not a movement unless a
            # B-H token is present; a solo HR like `HR/8(RBI)` has zero movements).
            for m in ev.movements:
                if m.to == 4 and not m.out and not m.unearned:
                    p.er += 1
            if ev.event_type == "HR" and not any(m.frm == 0 for m in ev.movements):
                p.er += 1  # batter scores on the HR (always earned)

print(f"files {len(FILES)} | PAs parsed {n_pa} | parse-fails {n_bad} | pitchers {len(pit)}")

rows = []
for pid, p in pit.items():
    if TEAM and TEAM.upper() not in (p.team.upper(), p.name.upper()):
        # team filter is best-effort on abbrev; keep if team matches
        pass
    ip = p.outs / 3.0
    if ip <= 0: continue
    era = p.er * 9.0 / ip
    fip = (13*p.hr + 3*(p.bb + p.hbp) - 2*p.k) / ip + FIP_C
    whip = (p.bb + p.h) / ip
    rows.append({"source_player_id": pid, "name": p.name, "team": p.team,
                 "IP": round(ip,1), "BF": p.bf, "K": p.k, "BB": p.bb, "HBP": p.hbp, "H": p.h, "HR": p.hr,
                 "ER": p.er, "ERA": round(era,2), "FIP": round(fip,2), "WHIP": round(whip,2),
                 "K9": round(p.k*9/ip,2), "BB9": round(p.bb*9/ip,2), "HR9": round(p.hr*9/ip,2)})

rows.sort(key=lambda x: -x["IP"])
os.makedirs("scripts/drs/output", exist_ok=True)
out = "scripts/drs/output/pitcher_accrued.csv"
with open(out, "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
print(f"wrote {out} ({len(rows)} pitchers with IP>0)")
print("\ntop 8 by IP:")
for x in rows[:8]:
    print(f"  {x['name']:16} {x['team']:6} IP {x['IP']:5} ERA {x['ERA']:5} FIP {x['FIP']:5} WHIP {x['WHIP']:5} K9 {x['K9']:5} (K{x['K']} BB{x['BB']} HR{x['HR']} H{x['H']})")
