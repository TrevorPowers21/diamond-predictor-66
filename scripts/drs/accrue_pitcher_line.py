"""
STEP 0 · chunk 6 — CONSOLIDATED pitcher line from the pitch log, FULL + REGULAR-season splits.

Merges the clean tallies (IP/K/BB/HBP/H/HR/BF) with the score-driven ER (accrue_pitcher_er.process_half_inning)
and derives ERA/FIP/WHIP/K9/BB9/HR9/K%/BB% for BOTH splits:
  - FULL season (all games, incl. postseason)  -> player stat store + power ratings (locked policy)
  - REGULAR season (<= 2026-05-18)              -> program analytics + projection target
Each half-inning is tagged regular/postseason via season_config.is_regular_season(gameString).
Output: scripts/drs/output/pitcher_line.csv (one row per pitcher, full_* and reg_* columns).
  python3 scripts/drs/accrue_pitcher_line.py
"""
import sys, os, csv, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.parser import parse_atbat_desc, ParseError, outs_recorded
from drs_engine.season_config import is_regular_season
from accrue_pitcher_er import process_half_inning

FILES = sorted(glob.glob("docs/drs-reference/*DRS Pitch Log.csv"))
FIP_C = 3.10  # league FIP constant placeholder (recalc = lgERA − (13HR+3(BB+HBP)−2K)/lgIP)

def v(r, k): return (r.get(k) or "").strip()

def blank():
    return {"outs": 0, "k": 0, "bb": 0, "hbp": 0, "h": 0, "hr": 0, "bf": 0, "er": 0, "r": 0}

def add(dst, pid, key, n=1):
    d = dst.setdefault(pid, blank()); d[key] += n

def main():
    seen = set()
    innings = {}     # (game,inn,bt) -> {"reg":bool, "rows":[(pn,pid,ev|None,occ,uid)]}
    teamgame = {}    # (game,bt) -> [(pn, uid, cur, runs_col)]
    full = {}; reg = {}
    n_bad = 0
    for f in FILES:
        with open(f, newline="") as fh:
            for r in csv.DictReader(fh):
                uid = r.get("uniqPitchId")
                if uid in seen: continue
                seen.add(uid)
                pid = v(r, "pitcherId")
                if not pid: continue
                gs = r.get("gameString") or r.get("gameDate") or ""
                rg = is_regular_season(gs)
                try: pn = int(v(r, "pitchNumInGame") or 0)
                except: pn = 0
                def num(k):
                    try: return int(float(v(r, k) or 0))
                    except: return None
                bt = v(r, "battingTeamId")
                cur = num("currentRuns") if v(r, "teamId") == bt else num("opponentCurrentRuns")
                teamgame.setdefault((r.get("gameId"), bt), []).append((pn, uid, cur, num("Runs") or 0))
                occ = {1: v(r, "ManOnFirst"), 2: v(r, "ManOnSecond"), 3: v(r, "ManOnThird")}
                key = (r.get("gameId"), r.get("inn"), bt)
                slot = innings.setdefault(key, {"reg": rg, "rows": []})
                desc = v(r, "atbat_desc") or v(r, "atbatDesc")
                if desc not in ("", "-"):
                    try: ev = parse_atbat_desc(desc)
                    except ParseError: n_bad += 1; continue
                    slot["rows"].append((pn, pid, ev, occ, uid))
                    # clean tallies -> both splits
                    for dst, ok in ((full, True), (reg, rg)):
                        if not ok: continue
                        if ev.is_pa:
                            add(dst, pid, "bf")
                            add(dst, pid, "outs", outs_recorded(ev) + (1 if ev.event_type == "K" else 0))
                            if ev.event_type == "K": add(dst, pid, "k")
                            if ev.is_walk: add(dst, pid, "bb")
                            if ev.is_hbp: add(dst, pid, "hbp")
                            if ev.event_type in ("SINGLE", "DOUBLE", "TRIPLE", "HR"): add(dst, pid, "h")
                            if ev.event_type == "HR": add(dst, pid, "hr")
                        else:
                            add(dst, pid, "outs", outs_recorded(ev))   # CS/pickoff -> IP
                else:
                    slot["rows"].append((pn, pid, None, occ, uid))
    # score-delta runs per pitch (pitch-after)
    runs_by_pitch = {}
    for k, rows in teamgame.items():
        rows.sort(key=lambda x: x[0])
        for i in range(len(rows)):
            pn, uid, cur, rc = rows[i]
            if i + 1 < len(rows):
                nxt = rows[i + 1][2]
                d = (nxt - cur) if (cur is not None and nxt is not None and nxt > cur) else 0
            else:
                d = rc
            if d > 0: runs_by_pitch[uid] = d
    # ER per half-inning -> route to full / regular
    for key, slot in innings.items():
        slot["rows"].sort(key=lambda x: x[0])
        pas = [(pid, ev, occ, runs_by_pitch.get(uid, 0)) for _, pid, ev, occ, uid in slot["rows"]]
        local = {}; localr = {}
        process_half_inning(pas, local, localr)
        for pid, n in local.items():
            add(full, pid, "er", n)
            if slot["reg"]: add(reg, pid, "er", n)
        for pid, n in localr.items():        # total R (earned+unearned) for desc RA9
            add(full, pid, "r", n)
            if slot["reg"]: add(reg, pid, "r", n)

    def line(d):
        ip = d["outs"] / 3.0
        if ip <= 0: return None
        return {"IP": round(ip, 1), "BF": d["bf"], "K": d["k"], "BB": d["bb"], "HBP": d["hbp"],
                "H": d["h"], "HR": d["hr"], "ER": d["er"], "ERA": round(d["er"] * 9 / ip, 2),
                "R": d["r"], "RA9": round(d["r"] * 9 / ip, 2),
                "FIP": round((13*d["hr"] + 3*(d["bb"]+d["hbp"]) - 2*d["k"]) / ip + FIP_C, 2),
                "WHIP": round((d["bb"] + d["h"]) / ip, 2), "K9": round(d["k"]*9/ip, 2),
                "BB9": round(d["bb"]*9/ip, 2), "HR9": round(d["hr"]*9/ip, 2),
                "K_pct": round(100*d["k"]/d["bf"], 1) if d["bf"] else 0,
                "BB_pct": round(100*d["bb"]/d["bf"], 1) if d["bf"] else 0}
    os.makedirs("scripts/drs/output", exist_ok=True)
    cols = ["IP","BF","K","BB","HBP","H","HR","ER","ERA","R","RA9","FIP","WHIP","K9","BB9","HR9","K_pct","BB_pct"]
    out = "scripts/drs/output/pitcher_line.csv"
    n = 0
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["source_player_id"] + [f"full_{c}" for c in cols] + [f"reg_{c}" for c in cols])
        for pid in full:
            lf = line(full[pid]); lr = line(reg.get(pid, blank()))
            if lf is None: continue
            n += 1
            w.writerow([pid] + [lf[c] for c in cols] + ([lr[c] for c in cols] if lr else [""]*len(cols)))
    print(f"parse-fails {n_bad:,} | wrote {out} ({n:,} pitchers with full IP>0)")

if __name__ == "__main__":
    main()
