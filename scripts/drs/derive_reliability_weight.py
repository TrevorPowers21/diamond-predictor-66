"""
WAR redesign, Step 2 (last constant) — the flat FIP↔RA9 blend weight `w`, PULLED FROM DATA.

descRA9 = w·(RA9 + dRS_behind) + (1−w)·(FIP·E2T)

We do NOT pick w from theory. We measure, WITHIN 2026, how repeatable each measure is:
split every pitcher's games into two alternating halves, compute his RA9 and his FIP in EACH
half (same innings split for both — apples to apples), and correlate half-A vs half-B across
pitchers. The more repeatable measure earns more weight. This is purely backward-looking
(reliability = how much of last season's signal is real over ~80 college innings), not a forecast.

Emphasis is set in proportion to each measure's full-season reliability:
    w_RA9 = rel(RA9) / (rel(RA9) + rel(FIP))
(rel = split-half r extrapolated to full season via Spearman-Brown).

Reuses the validated parser + score-delta run logic from the Step-0 engine. For TOTAL runs
(RA9) we mirror process_half_inning's base-slot responsibility rule, minus the earned/unearned
branch. Correlations are IP-weighted (min of the two halves) so thin arms don't dominate.

  python3 scripts/drs/derive_reliability_weight.py
"""
import sys, os, csv, glob, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.parser import parse_atbat_desc, ParseError, outs_recorded

FILES = sorted(glob.glob("docs/drs-reference/*DRS Pitch Log.csv"))
IMPLICIT_DEST = {"SINGLE": 1, "DOUBLE": 2, "TRIPLE": 3}
MIN_HALF_IP = 10.0   # each half must be a real workload for its rate to mean anything
MIN_FULL_IP = 25.0   # full-season floor to enter the pool

def v(r, k): return (r.get(k) or "").strip()

def total_runs_half(pas):
    """Per-pitcher TOTAL runs for one half-inning — same base-slot responsibility rule as
    process_half_inning (inherited runners charged to whoever put them on), no earned/unearned split."""
    resp = {1: None, 2: None, 3: None}
    ra = {}
    for cur, ev, occ, N in pas:
        def credit(rp):
            pid = rp if rp is not None else cur
            ra[pid] = ra.get(pid, 0) + 1
        pres = {b: bool(occ.get(b)) for b in (1, 2, 3)}
        arrived = [b for b in (1, 2, 3) if pres[b] and resp[b] is None]
        departed = [b for b in (1, 2, 3) if not pres[b] and resp[b] is not None]
        for a in sorted(arrived):
            lower = [d for d in departed if d < a]
            if lower:
                src = max(lower); resp[a] = resp[src]; resp[src] = None; departed.remove(src)
        for d in departed:
            resp[d] = None
        if ev is None:
            n = N
            for b in (3, 2, 1):
                if n <= 0: break
                if resp[b] is not None or pres[b]:
                    credit(resp[b]); resp[b] = None; n -= 1
            while n > 0:
                credit(cur); n -= 1
            continue
        old = dict(resp); mv = 0
        for m in ev.movements:
            rp = cur if m.frm == 0 else old.get(m.frm)
            if m.out:
                if m.frm != 0: resp[m.frm] = None
            elif m.to == 4:
                mv += 1; credit(rp)
                if m.frm != 0: resp[m.frm] = None
            else:
                if m.frm != 0: resp[m.frm] = None
                resp[m.to] = rp
        if not any(m.frm == 0 for m in ev.movements):
            if ev.event_type == "HR":
                credit(cur); mv += 1
            else:
                dest = IMPLICIT_DEST.get(ev.event_type)
                if dest is None and (ev.is_walk or ev.is_hbp or ev.is_ci or ev.event_type in ("ERROR", "FC")):
                    dest = 1
                if dest is not None:
                    resp[dest] = cur
        n = N - mv
        for b in (3, 2, 1):
            if n <= 0: break
            if resp[b] is not None:
                credit(resp[b]); resp[b] = None; n -= 1
        while n > 0:
            credit(cur); n -= 1
    return ra

def wpearson(pairs):
    """IP-weighted Pearson r over [(x, y, wt)]."""
    W = sum(w for _, _, w in pairs)
    mx = sum(x * w for x, _, w in pairs) / W
    my = sum(y * w for _, y, w in pairs) / W
    sxy = sum(w * (x - mx) * (y - my) for x, y, w in pairs)
    sxx = sum(w * (x - mx) ** 2 for x, _, w in pairs)
    syy = sum(w * (y - my) ** 2 for _, y, w in pairs)
    return sxy / math.sqrt(sxx * syy)

def main():
    seen = set()
    innings = {}                 # (game,inn,bt) -> [(pn, pid, ev|None, occ, uid)]
    teamgame = {}                # (game,bt) -> [(pn, uid, cur, runs_col)]
    tallies = {}                 # (pid, gid) -> {outs,k,bb,hbp,hr}
    pit_games = {}               # pid -> set(gid)
    n_bad = 0

    def tal(pid, gid):
        return tallies.setdefault((pid, gid), {"outs": 0, "k": 0, "bb": 0, "hbp": 0, "hr": 0})

    for f in FILES:
        with open(f, newline="") as fh:
            for r in csv.DictReader(fh):
                uid = r.get("uniqPitchId")
                if uid in seen: continue
                seen.add(uid)
                pid = v(r, "pitcherId")
                if not pid: continue
                gid = r.get("gameId")
                try: pn = int(v(r, "pitchNumInGame") or 0)
                except: pn = 0
                def num(k):
                    try: return int(float(v(r, k) or 0))
                    except: return None
                bt = v(r, "battingTeamId")
                cur = num("currentRuns") if v(r, "teamId") == bt else num("opponentCurrentRuns")
                teamgame.setdefault((gid, bt), []).append((pn, uid, cur, num("Runs") or 0))
                occ = {1: v(r, "ManOnFirst"), 2: v(r, "ManOnSecond"), 3: v(r, "ManOnThird")}
                key = (gid, r.get("inn"), bt)
                desc = v(r, "atbatDesc")
                if desc not in ("", "-"):
                    try: ev = parse_atbat_desc(desc)
                    except ParseError: n_bad += 1; continue
                    innings.setdefault(key, []).append((pn, pid, ev, occ, uid))
                    pit_games.setdefault(pid, set()).add(gid)
                    t = tal(pid, gid)
                    if ev.is_pa:
                        t["outs"] += outs_recorded(ev) + (1 if ev.event_type == "K" else 0)
                        if ev.event_type == "K": t["k"] += 1
                        if ev.is_walk: t["bb"] += 1
                        if ev.is_hbp: t["hbp"] += 1
                        if ev.event_type == "HR": t["hr"] += 1
                    else:
                        t["outs"] += outs_recorded(ev)
                else:
                    innings.setdefault(key, []).append((pn, pid, None, occ, uid))

    # score-delta runs per pitch (pitch-after)
    runs_by_pitch = {}
    for k, rows in teamgame.items():
        rows.sort(key=lambda x: x[0])
        for i in range(len(rows)):
            pn, uid, cur, rc = rows[i]
            d = (rows[i + 1][2] - cur) if (i + 1 < len(rows) and cur is not None and rows[i + 1][2] is not None and rows[i + 1][2] > cur) else (rc if i + 1 == len(rows) else 0)
            if d > 0: runs_by_pitch[uid] = d

    runs = {}                    # (pid, gid) -> total runs
    for (gid, inn, bt), rows in innings.items():
        rows.sort(key=lambda x: x[0])
        pas = [(pid, ev, occ, runs_by_pitch.get(uid, 0)) for _, pid, ev, occ, uid in rows]
        for pid, n in total_runs_half(pas).items():
            runs[(pid, gid)] = runs.get((pid, gid), 0) + n

    # split each pitcher's games into two alternating halves (balanced within pitcher)
    ra_pairs, fip_pairs = [], []
    pool = 0
    for pid, gids in pit_games.items():
        halves = [{"outs": 0, "r": 0, "k": 0, "bb": 0, "hbp": 0, "hr": 0}, None]
        halves[1] = dict(halves[0])
        for i, gid in enumerate(sorted(gids)):
            h = halves[i % 2]
            t = tallies.get((pid, gid), {"outs": 0, "k": 0, "bb": 0, "hbp": 0, "hr": 0})
            h["outs"] += t["outs"]; h["k"] += t["k"]; h["bb"] += t["bb"]; h["hbp"] += t["hbp"]; h["hr"] += t["hr"]
            h["r"] += runs.get((pid, gid), 0)
        ip0, ip1 = halves[0]["outs"] / 3.0, halves[1]["outs"] / 3.0
        if ip0 < MIN_HALF_IP or ip1 < MIN_HALF_IP or (ip0 + ip1) < MIN_FULL_IP:
            continue
        def ra9(h, ip): return h["r"] * 9.0 / ip
        def fipcore(h, ip): return (13 * h["hr"] + 3 * (h["bb"] + h["hbp"]) - 2 * h["k"]) / ip  # constant-free
        wt = min(ip0, ip1)
        ra_pairs.append((ra9(halves[0], ip0), ra9(halves[1], ip1), wt))
        fip_pairs.append((fipcore(halves[0], ip0), fipcore(halves[1], ip1), wt))
        pool += 1

    def sb(r): return 2 * r / (1 + r)   # Spearman-Brown: half-season r -> full-season reliability
    r_ra, r_fip = wpearson(ra_pairs), wpearson(fip_pairs)
    rel_ra, rel_fip = sb(r_ra), sb(r_fip)
    w_ra = rel_ra / (rel_ra + rel_fip)

    print(f"parse-fails {n_bad:,} | qualified pitchers (each half ≥{MIN_HALF_IP} IP, full ≥{MIN_FULL_IP}) = {pool}")
    print(f"  SPLIT-HALF r (IP-weighted, half vs half):   RA9 {r_ra:.3f}   FIP {r_fip:.3f}")
    print(f"  full-season reliability (Spearman-Brown):   RA9 {rel_ra:.3f}   FIP {rel_fip:.3f}")
    print(f"\n  -> emphasis (weight ∝ reliability):  RA9 {w_ra:.2f}  /  FIP {1 - w_ra:.2f}")
    print(f"     flat blend weight  w = {w_ra:.2f}")
    print(f"\n  NOTE: pool = DRS-log teams (high-TrackMan D1 programs) — the RA9-vs-FIP *ratio*")
    print(f"        is the signal; absolute levels may be range-restricted vs all of D1.")

    import json
    os.makedirs("output", exist_ok=True)
    with open("output/reliability_weight.json", "w") as fh:
        json.dump({
            "_meta": {"script": "scripts/drs/derive_reliability_weight.py", "season": 2026,
                       "derived_at": os.environ.get("STAMP", "SET_STAMP"),
                       "method": "within-season split-half reliability, RA9 vs FIP on the SAME per-pitcher game split; weight ∝ reliability",
                       "pool": "DRS-log teams (high-TrackMan D1); ratio robust, absolute levels range-restricted"},
            "qualified_pitchers": pool,
            "splithalf_r": {"RA9": round(r_ra, 3), "FIP": round(r_fip, 3)},
            "full_reliability_spearman_brown": {"RA9": round(rel_ra, 3), "FIP": round(rel_fip, 3)},
            "w_RA9_flat": round(w_ra, 2),
        }, fh, indent=2)
    print("  wrote output/reliability_weight.json")

if __name__ == "__main__":
    main()
