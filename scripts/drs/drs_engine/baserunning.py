"""
RSTR IQ :: baserunning runs (wSB) — TWO-FILE architecture (the way the stats
providers actually do it: track what the pitches show, then override the count
from the box score).

Inputs:
  1. "Full Season Stolen Bases" — the AUTHORITATIVE per-player counts + opportunities
     (SB2/SB3/SBH, CS2/CS3/CSH, SB2Opp/SB3Opp/SBOpp). This is the box-score truth; the
     pitch-tracking layer systematically misses ~10% of successful steals (untracked /
     defensive-indifference), so counts MUST come from here, not the pitch log.
  2. "SBA Attempt Pitch Log" — every tracked steal attempt with full base-out STATE
     (ManOn* + outs). Used ONLY to derive the state-weighted run VALUE of each base
     transition off the RE24 matrix (it can't be trusted for counts).

wSB per player = Sigma_base (SB_base * SB_value + CS_base * CS_value)
                 - Sigma_base (Opp_base * league_expected_per_opp).
Nets to ~0 league-wide by construction. Steals of home (SBH/CSH) come entirely from the
Full Season file (the pitch log has no home flag) and are priced from RE24 directly.

Attribution is by playerId (clean identity, no name matching). See
docs/AGENT_LEARNINGS_defensive_runs_engine_2026_08_03.md for the process story.
"""
from __future__ import annotations
import csv
from collections import defaultdict
from . import constants as C

# ---------------- RE24 value of base-running transitions ----------------
def _re(re24, o1, o2, o3, outs):
    if outs >= 3:
        return 0.0
    if not re24:
        return None
    return re24.get(("1" if o1 else "_") + ("2" if o2 else "_")
                    + ("3" if o3 else "_") + str(outs))

def sb_value(re24, o1, o2, o3, outs, base):
    """Runner value of a SUCCESSFUL steal of `base` (2, 3, or 4=home) from this state."""
    before = _re(re24, o1, o2, o3, outs)
    if base == 2:
        after = _re(re24, False, True, o3, outs)          # 1st -> 2nd
    elif base == 3:
        after = _re(re24, o1, False, True, outs)          # 2nd -> 3rd
    else:                                                 # 3rd -> home (scores a run)
        a = _re(re24, o1, o2, False, outs)
        after = (a + 1.0) if a is not None else None
    if after is None or before is None:
        return None
    return after - before

def cs_value(re24, o1, o2, o3, outs, base):
    """Runner value of a CAUGHT STEALING of `base` (runner erased + an out). Negative."""
    before = _re(re24, o1, o2, o3, outs)
    if base == 2:
        after = _re(re24, False, o2, o3, outs + 1)
    elif base == 3:
        after = _re(re24, o1, False, o3, outs + 1)
    else:
        after = _re(re24, o1, o2, False, outs + 1)
    if after is None or before is None:
        return None
    return after - before

# ---------------- derive league per-base VALUES from the attempt log ----------------
def _occ(v):
    return v not in (None, "", "-")

def derive_base_values(attempt_path, re24):
    """State-weighted mean value of each base transition, from the tracked attempts.
    Returns {(base, 'SB'|'CS'): mean_value}. Home is priced from RE24 (runner on 3rd,
    averaged over outs) since the attempt log has no home flag."""
    acc = defaultdict(lambda: [0.0, 0])   # (base, kind) -> [sum, n]
    with open(attempt_path, newline="") as fh:
        r = csv.reader(fh); h = [x.strip() for x in next(r)]; i = {x: n for n, x in enumerate(h)}
        def g(row, x): return row[i[x]].strip() if x in i and i[x] < len(row) else ""
        for row in r:
            try: outs = int(g(row, "outs") or 0)
            except ValueError: outs = 0
            o1, o2, o3 = _occ(g(row, "ManOnFirst")), _occ(g(row, "ManOnSecond")), _occ(g(row, "ManOnThird"))
            pr, ad = g(row, "pitchResult"), g(row, "atbatDesc")
            # VALUE only from clean transitions (target base empty). A double steal has the
            # target base occupied by the runner vacating it, which breaks the RE24 delta
            # math (a "move to an occupied base"); exclude those from the value MEAN. The
            # COUNTS come from the Full Season file, so no steal is lost by this filter.
            if g(row, "SB2") == "1" and not o2:
                v = sb_value(re24, o1, o2, o3, outs, 2)
                if v is not None: acc[(2, "SB")][0] += v; acc[(2, "SB")][1] += 1
            if g(row, "SB3") == "1" and not o3:
                v = sb_value(re24, o1, o2, o3, outs, 3)
                if v is not None: acc[(3, "SB")][0] += v; acc[(3, "SB")][1] += 1
            # failures (CS): any steal-of-2nd attempt that didn't succeed, or a CS/pickoff token
            if (g(row, "SB2") != "1" and g(row, "SB3") != "1"):
                base = None
                if "Pickoff CS 3B" in pr or "CS3" in ad or g(row, "SBA3") == "1": base = 3
                elif ("Pickoff CS" in pr) or ("CS2" in ad) or g(row, "SBA2") == "1": base = 2
                if base:
                    v = cs_value(re24, o1, o2, o3, outs, base)
                    if v is not None: acc[(base, "CS")][0] += v; acc[(base, "CS")][1] += 1
    vals = {k: (s / n if n else None) for k, (s, n) in acc.items()}
    # home from RE24 (runner on 3rd only, mean over outs)
    vals[(4, "SB")] = sum(sb_value(re24, False, False, True, o, 4) for o in (0, 1, 2)) / 3
    vals[(4, "CS")] = sum(cs_value(re24, False, False, True, o, 4) for o in (0, 1, 2)) / 3
    return vals

# ---------------- Full Season authoritative counts ----------------
def load_season_totals(path):
    """playerId -> per-player counts + opportunities + identity."""
    out = {}
    with open(path, newline="") as fh:
        r = csv.reader(fh); h = [x.strip() for x in next(r)]; i = {x: n for n, x in enumerate(h)}
        def gi(row, x):
            try: return int(row[i[x]] or 0)
            except (ValueError, KeyError): return 0
        def gs(row, x): return row[i[x]] if x in i and i[x] < len(row) else ""
        for row in r:
            pid = gs(row, "playerId")
            if not pid: continue
            out[pid] = {
                "player": gs(row, "player"), "pos": gs(row, "pos"),
                "org_id": gs(row, "newestTeamId"), "org": gs(row, "newestTeamAbbrevName"),
                "games": gi(row, "G"),
                "SB2": gi(row, "SB2"), "CS2": gi(row, "CS2"), "SB2Opp": gi(row, "SB2Opp"),
                "SB3": gi(row, "SB3"), "CS3": gi(row, "CS3"), "SB3Opp": gi(row, "SB3Opp"),
                "SBH": gi(row, "SBH"), "CSH": gi(row, "CSH"),
                "SB": gi(row, "SB"), "CS": gi(row, "CS"), "SBOpp": gi(row, "SBOpp"),
            }
    return out

# ---------------- compute wSB ----------------
def compute_wsb(season, vals, season_year=2026):
    def v(base, kind): return vals.get((base, kind)) or 0.0
    L = defaultdict(int)
    for p in season.values():
        for k in ("SB2", "CS2", "SB3", "CS3", "SBH", "CSH", "SB2Opp", "SB3Opp", "SBOpp"):
            L[k] += p[k]
    # league expected value per opportunity, per base (home netted over total SBOpp)
    exp = {
        2: (L["SB2"] * v(2, "SB") + L["CS2"] * v(2, "CS")) / L["SB2Opp"] if L["SB2Opp"] else 0.0,
        3: (L["SB3"] * v(3, "SB") + L["CS3"] * v(3, "CS")) / L["SB3Opp"] if L["SB3Opp"] else 0.0,
        "H": (L["SBH"] * v(4, "SB") + L["CSH"] * v(4, "CS")) / L["SBOpp"] if L["SBOpp"] else 0.0,
    }
    rows = []
    for pid, p in sorted(season.items()):
        actual = (p["SB2"] * v(2, "SB") + p["CS2"] * v(2, "CS")
                  + p["SB3"] * v(3, "SB") + p["CS3"] * v(3, "CS")
                  + p["SBH"] * v(4, "SB") + p["CSH"] * v(4, "CS"))
        expected = p["SB2Opp"] * exp[2] + p["SB3Opp"] * exp[3] + p["SBOpp"] * exp["H"]
        wsb = actual - expected
        opps = p["SBOpp"]
        reg = wsb * (opps / (opps + C.PRIOR_THROW_ATT)) if (opps + C.PRIOR_THROW_ATT) else 0.0
        rows.append({
            "player": p["player"], "playerId": pid, "org_id": p["org_id"], "position": p["pos"],
            "season": season_year, "games": p["games"], "opportunities": opps,
            "SB": p["SB"], "CS": p["CS"], "SBH": p["SBH"],
            "wsb_runs": round(wsb, 3), "wsb_runs_reg": round(reg, 3),
            "constants_version": C.CONSTANTS_VERSION, "engine_version": C.ENGINE_VERSION,
        })
    return rows
