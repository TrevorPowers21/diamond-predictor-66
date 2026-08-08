"""
STEP 0 · inherited-runner EARNED-RUN attribution — pitch-log-native ER (replaces the mound simplification).

Uses the pitch log's RECORDED state (Trevor's pointer): `ManOnFirst/Second/Third` = the runner NAME on each base
at the START of every PA, and `Runs` = runs scored on the play. No base-state reconstruction (which drifts) —
we read recorded occupancy and only track runner_name -> RESPONSIBLE pitcher (the pitcher the PA before that
runner first appears on base). Each earned run (scoring movement to H WITHOUT the (UR) tag) is charged to the
responsible pitcher for the runner on that base; unknown runners fall back to the current pitcher (no orphans).
earned/unearned is pre-solved by TruMedia's (UR)/(TUR) tags. Coverage is validated against the `Runs` column.

Half-inning key = (gameId, inn, battingTeamId); order = abNumInGame.
  python3 scripts/drs/accrue_pitcher_er.py     # -> output/pitcher_er.csv + validate vs Full Pitching Master
"""
import sys, os, csv, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.parser import parse_atbat_desc, ParseError, outs_recorded

FILES = sorted(glob.glob("docs/drs-reference/*DRS Pitch Log.csv"))

def v(r, k): return (r.get(k) or "").strip()

def process_half_inning(pas, er):
    """pas = [(pitcherId, ev, occ_names{1,2,3}, runs_on_play)] in batting order. Returns (charged, unearned, runs_seen)."""
    responsible = {}   # runner name -> pitcher who allowed them to reach
    prev_pitcher = None
    charged = unearned = runs_seen = 0
    for cur, ev, occ, runs in pas:
        # register any runner on base we haven't seen — allowed by the PRIOR PA's pitcher
        for b in (1, 2, 3):
            name = occ.get(b)
            if name and name not in responsible:
                responsible[name] = prev_pitcher or cur
        for m in ev.movements:
            if m.to != 4:
                continue
            runs_seen += 1
            if m.unearned:
                unearned += 1
                continue
            if m.frm == 0:                       # batter scored (explicit B-H, e.g. inside-park)
                er[cur] = er.get(cur, 0) + 1
            else:
                name = occ.get(m.frm)
                pid = responsible.get(name, cur) if name else cur
                er[pid] = er.get(pid, 0) + 1
            charged += 1
        # implicit HR batter run (solo/partial HR has no B-H movement)
        if ev.event_type == "HR" and not any(m.frm == 0 for m in ev.movements):
            er[cur] = er.get(cur, 0) + 1
            charged += 1; runs_seen += 1
        prev_pitcher = cur
    return charged, unearned, runs_seen

def main():
    seen = set()
    innings = {}   # (gameId, inn, battingTeamId) -> list[(ab, pitcherId, ev, occ, runs)]
    outs = {}
    n_pa = n_bad = sum_runs_col = 0
    for f in FILES:
        with open(f, newline="") as fh:
            for r in csv.DictReader(fh):
                uid = r.get("uniqPitchId")
                if uid in seen: continue
                seen.add(uid)
                desc = v(r, "atbatDesc")
                if desc in ("", "-"): continue
                pid = v(r, "pitcherId")
                if not pid: continue
                try: ev = parse_atbat_desc(desc)
                except ParseError: n_bad += 1; continue
                try: ab = int(v(r, "abNumInGame") or 0)
                except: ab = 0
                try: runs = int(float(v(r, "Runs") or 0))
                except: runs = 0
                sum_runs_col += runs
                occ = {1: v(r, "ManOnFirst"), 2: v(r, "ManOnSecond"), 3: v(r, "ManOnThird")}
                innings.setdefault((r.get("gameId"), r.get("inn"), r.get("battingTeamId")), []).append(
                    (ab, pid, ev, occ, runs))
                if ev.is_pa:
                    n_pa += 1
                    outs[pid] = outs.get(pid, 0) + outs_recorded(ev) + (1 if ev.event_type == "K" else 0)
                else:
                    # CS / pickoff = a baserunning out recorded while pitching → counts toward IP (not BF)
                    outs[pid] = outs.get(pid, 0) + outs_recorded(ev)
    er = {}; tot_charged = tot_unearned = tot_runs_seen = 0
    for key, rows in innings.items():
        rows.sort(key=lambda x: x[0])
        c, u, s = process_half_inning([(pid, ev, occ, runs) for _, pid, ev, occ, runs in rows], er)
        tot_charged += c; tot_unearned += u; tot_runs_seen += s
    print(f"half-innings {len(innings):,} | PA {n_pa:,} | parse-fails {n_bad:,}")
    print(f"runs seen in movements {tot_runs_seen:,} | earned charged {tot_charged:,} | unearned {tot_unearned:,} "
          f"| `Runs` column total {sum_runs_col:,} (coverage {100*tot_runs_seen/max(1,sum_runs_col):.1f}%)")
    os.makedirs("scripts/drs/output", exist_ok=True)
    with open("scripts/drs/output/pitcher_er.csv", "w", newline="") as fh:
        w = csv.writer(fh); w.writerow(["source_player_id", "IP", "ER", "ERA"])
        for pid in outs:
            ip = outs[pid] / 3.0
            if ip <= 0: continue
            e = er.get(pid, 0)
            w.writerow([pid, round(ip, 1), e, round(e * 9.0 / ip, 2)])
    print("wrote scripts/drs/output/pitcher_er.csv")
    validate()

def validate():
    M = {}
    with open("docs/drs-reference/Full Season Pitching Master Stats.csv", newline="") as fh:
        for r in csv.DictReader(fh):
            pid = (r.get("playerId") or "").strip()
            try: ip = float(r["IP"])
            except: ip = 0
            if ip <= 0: continue
            def g(k):
                try: return float(r.get(k, "") or 0)
                except: return 0
            M[pid] = {"IP": ip, "ERA": g("ERA"), "ER": g("ER")}
    A = {}
    with open("scripts/drs/output/pitcher_er.csv", newline="") as fh:
        for r in csv.DictReader(fh):
            A[r["source_player_id"]] = {"ER": float(r["ER"]), "ERA": float(r["ERA"])}
    er_d, era_d = [], []
    for pid, m in M.items():
        a = A.get(pid)
        if not a or m["IP"] < 20: continue
        er_d.append(a["ER"] - m["ER"]); era_d.append(a["ERA"] - m["ERA"])
    def stats(vv, tol):
        mean = sum(vv) / len(vv); mabs = sum(abs(x) for x in vv) / len(vv)
        w = sum(1 for x in vv if abs(x) <= tol)
        return f"mean {mean:+.3f}  mean|Δ| {mabs:.3f}  within {tol}: {100*w/len(vv):.0f}%"
    print(f"\nvs Full Pitching Master (n={len(er_d)}, IP>=20):")
    print(f"  ER  {stats(er_d, 3)}")
    print(f"  ERA {stats(era_d, 0.5)}")

if __name__ == "__main__":
    main()
