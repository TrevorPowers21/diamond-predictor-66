"""
STEP 0 · SCORE-DRIVEN earned-run attribution — pitch-log-native ER.

Trevor's architecture: the SCORE is the ground truth. Walk every pitch; the batting team's run total on the
NEXT pitch (score comes in lagged one pitch) minus this pitch = runs scored on THIS pitch (a delta, so it
naturally handles 2+ runs on one pitch). This catches EVERY run — hits, wild pitches, passed balls, steals of
home, balks — including the ~900 the per-play `Runs` column silently drops. Validated: pitch-after delta totals
111,704 vs the Master's R 111,659 (99.96%).

Then associate the WHY for each run: base-slot occupancy (ManOnBase) → which pitcher is responsible for the
scoring runner (inherited runners charged to whoever put them on, across pitching changes); movement `(UR)`
tags → earned/unearned for PA runs. Non-PA + hidden runs default to earned (wild-pitch/steal dominate; passed
balls are unearned but the pitch log doesn't label WP vs PB). Cross-check: independent Full Pitching Master.
  python3 scripts/drs/accrue_pitcher_er.py
"""
import sys, os, csv, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.parser import parse_atbat_desc, ParseError, outs_recorded

FILES = sorted(glob.glob("docs/drs-reference/*DRS Pitch Log.csv"))
IMPLICIT_DEST = {"SINGLE": 1, "DOUBLE": 2, "TRIPLE": 3}

def v(r, k): return (r.get(k) or "").strip()

def charge_lead(n, resp, pres, er, cur):
    """Charge n EARNED runs to the responsible pitcher of the lead OCCUPIED base (3rd first). Fallback = cur."""
    c = 0
    for b in (3, 2, 1):
        if n <= 0: break
        if resp[b] is not None or pres[b]:
            pid = resp[b] if resp[b] is not None else cur
            er[pid] = er.get(pid, 0) + 1; resp[b] = None; n -= 1; c += 1
    while n > 0:
        er[cur] = er.get(cur, 0) + 1; n -= 1; c += 1
    return c

def process_half_inning(pas, er, runs=None):
    """pas = [(pitcherId, ev_or_None, occ_names{1,2,3}, N)] in pitch order. N = score-delta runs on that pitch.
    Base-slot occupancy tracking (name-agnostic; courtesy runners keep the slot's pitcher). Returns
    (charged, unearned, runs_seen). If `runs` (a dict) is passed, ALSO tallies TOTAL runs (earned +
    unearned) per responsible pitcher — same inherited-runner attribution, no unearned strip (for reg_R)."""
    resp = {1: None, 2: None, 3: None}
    taint = {1: False, 2: False, 3: False}       # runner reached/advanced via an error (rule 2 → unearned)
    recon_outs = 0                               # reconstructed outs (actual + error phantom); ≥3 → rule 3
    charged = unearned = runs_seen = 0

    def score_run(b, rp, forced_unearned):
        """Charge one run from base slot b to responsible pitcher rp; earned unless tainted / inning dead / tag."""
        nonlocal charged, unearned, runs_seen
        runs_seen += 1
        pid = rp if rp is not None else cur
        if runs is not None: runs[pid] = runs.get(pid, 0) + 1   # total R (earned+unearned), same attribution
        if forced_unearned or taint.get(b, False) or recon_outs >= 3:
            unearned += 1
        else:
            er[pid] = er.get(pid, 0) + 1; charged += 1

    for cur, ev, occ, N in pas:
        pres = {b: bool(occ.get(b)) for b in (1, 2, 3)}
        # reconcile slots to RECORDED occupancy (carry resp + taint; recover silent advances)
        arrived = [b for b in (1, 2, 3) if pres[b] and resp[b] is None]
        departed = [b for b in (1, 2, 3) if not pres[b] and resp[b] is not None]
        for a in sorted(arrived):
            lower = [d for d in departed if d < a]
            if lower:
                src = max(lower)
                resp[a], taint[a] = resp[src], taint[src]
                resp[src], taint[src] = None, False; departed.remove(src)
        for d in departed:
            resp[d], taint[d] = None, False
        if ev is None:                                   # NON-PA scoring pitch (WP / PB / steal home / balk)
            n = N
            for b in (3, 2, 1):
                if n <= 0: break
                if resp[b] is not None or pres[b]:
                    score_run(b, resp[b], False); resp[b], taint[b] = None, False; n -= 1
            while n > 0:
                score_run(0, cur, False); n -= 1
            continue
        # PA pitch: a reached-on-error gives the pitcher a phantom (benefit-of-doubt) reconstructed out
        if ev.event_type == "ERROR":
            recon_outs += 1
        old, oldt = dict(resp), dict(taint); mv_runs = 0
        for m in ev.movements:
            if m.frm == 0:
                rp, rt = cur, (ev.event_type == "ERROR") or (m.error_fielder is not None)
            else:
                rp = old.get(m.frm); rt = oldt.get(m.frm, False) or (m.error_fielder is not None)
            if m.out:                                    # OUT (incl. thrown out at home `3XH`) — not a run
                if m.frm != 0: resp[m.frm], taint[m.frm] = None, False
            elif m.to == 4:                              # scored
                mv_runs += 1
                score_run(m.frm, rp, m.unearned)
                if m.frm != 0: resp[m.frm], taint[m.frm] = None, False
            else:                                        # advanced to a base
                if m.frm != 0: resp[m.frm], taint[m.frm] = None, False
                resp[m.to], taint[m.to] = rp, rt
        if not any(m.frm == 0 for m in ev.movements):
            if ev.event_type == "HR":
                score_run(0, cur, False); mv_runs += 1   # HR batter is always earned (taint/recon don't apply)
            else:
                dest = IMPLICIT_DEST.get(ev.event_type)
                bt = (ev.event_type == "ERROR")
                if dest is None and (ev.is_walk or ev.is_hbp or ev.is_ci or ev.event_type in ("ERROR", "FC")):
                    dest = 1
                if dest is not None:
                    resp[dest], taint[dest] = cur, bt
        # SCORE-DELTA reconciliation: charge runs the score saw that the movements missed
        n = N - mv_runs
        for b in (3, 2, 1):
            if n <= 0: break
            if resp[b] is not None:
                score_run(b, resp[b], False); resp[b], taint[b] = None, False; n -= 1
        while n > 0:
            score_run(0, cur, False); n -= 1
        recon_outs += outs_recorded(ev) + (1 if ev.event_type == "K" else 0)
    return charged, unearned, runs_seen

def main():
    seen = set()
    innings = {}     # (game,inn,battingTeam) -> [(pn, pid, ev_or_None, occ, uid)]
    teamgame = {}    # (game,battingTeam) -> [(pn, uid, cur, runs_col)]
    outs = {}
    n_pa = n_bad = 0
    for f in FILES:
        with open(f, newline="") as fh:
            for r in csv.DictReader(fh):
                uid = r.get("uniqPitchId")
                if uid in seen: continue
                seen.add(uid)
                pid = v(r, "pitcherId")
                if not pid: continue
                try: pn = int(v(r, "pitchNumInGame") or 0)
                except: pn = 0
                def num(k):
                    try: return int(float(v(r, k) or 0))
                    except: return None
                bt = v(r, "battingTeamId")
                cur = num("currentRuns") if v(r, "teamId") == bt else num("opponentCurrentRuns")
                rc = num("Runs") or 0
                teamgame.setdefault((r.get("gameId"), bt), []).append((pn, uid, cur, rc))
                occ = {1: v(r, "ManOnFirst"), 2: v(r, "ManOnSecond"), 3: v(r, "ManOnThird")}
                key = (r.get("gameId"), r.get("inn"), bt)
                desc = v(r, "atbatDesc")
                if desc not in ("", "-"):
                    try: ev = parse_atbat_desc(desc)
                    except ParseError: n_bad += 1; continue
                    innings.setdefault(key, []).append((pn, pid, ev, occ, uid))
                    if ev.is_pa:
                        n_pa += 1
                        outs[pid] = outs.get(pid, 0) + outs_recorded(ev) + (1 if ev.event_type == "K" else 0)
                    else:
                        outs[pid] = outs.get(pid, 0) + outs_recorded(ev)   # CS/pickoff outs -> IP
                else:
                    innings.setdefault(key, []).append((pn, pid, None, occ, uid))
    # ---- score-delta run count per pitch (pitch-after; last pitch of a team's game falls back to Runs col) ----
    runs_by_pitch = {}
    total_runs = 0
    for k, rows in teamgame.items():
        rows.sort(key=lambda x: x[0])
        for i in range(len(rows)):
            pn, uid, cur, rc = rows[i]
            if i + 1 < len(rows):
                nxt = rows[i + 1][2]
                d = (nxt - cur) if (cur is not None and nxt is not None and nxt > cur) else 0
            else:
                d = rc
            if d > 0:
                runs_by_pitch[uid] = d; total_runs += d
    er = {}; tot_charged = tot_unearned = tot_runs_seen = 0
    for key, rows in innings.items():
        rows.sort(key=lambda x: x[0])
        pas = [(pid, ev, occ, runs_by_pitch.get(uid, 0)) for _, pid, ev, occ, uid in rows]
        c, u, s = process_half_inning(pas, er)
        tot_charged += c; tot_unearned += u; tot_runs_seen += s
    print(f"half-innings {len(innings):,} | PA {n_pa:,} | parse-fails {n_bad:,}")
    print(f"score-delta total runs {total_runs:,} (Master R 111,659) | earned charged {tot_charged:,} | "
          f"unearned {tot_unearned:,}")
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
    tot_a = sum(a["ER"] for a in A.values()); tot_m = sum(m["ER"] for m in M.values())
    er_d, era_d = [], []
    for pid, m in M.items():
        a = A.get(pid)
        if not a or m["IP"] < 20: continue
        er_d.append(a["ER"] - m["ER"]); era_d.append(a["ERA"] - m["ERA"])
    def stats(vv, tol):
        mean = sum(vv) / len(vv); mabs = sum(abs(x) for x in vv) / len(vv)
        w = sum(1 for x in vv if abs(x) <= tol)
        return f"mean {mean:+.3f}  mean|Δ| {mabs:.3f}  within {tol}: {100*w/len(vv):.0f}%"
    print(f"\naggregate ER: mine {tot_a:.0f} vs Master(IP>0) {tot_m:.0f} ({100*(tot_a-tot_m)/tot_m:+.1f}%)")
    print(f"vs Full Pitching Master (n={len(er_d)}, IP>=20):")
    print(f"  ER  {stats(er_d, 3)}")
    print(f"  ERA {stats(era_d, 0.5)}")

if __name__ == "__main__":
    main()
