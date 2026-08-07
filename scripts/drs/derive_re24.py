"""
RSTR IQ dRS Engine :: D1 RE24 run-expectancy matrix derivation (Spec Section 7)

Computes the 24 base-out-state run-expectancy matrix from full-season event data:
for each (base_state, outs), the average runs scored from that state to the end of
the half-inning, over COMPLETE half-innings only (reached 3 outs — incomplete
walk-off/called innings understate RE and are excluded, standard practice).

Runs per play come from the `Runs` column (validated: runs scored on that play,
handles HR/error/WP scoring). Base state from ManOnFirst/Second/Third; outs from
`outs` (state entering the PA). Half-inning = (gameId, inn) where inn is "Top N"/
"Bot N". Games never span window files, so each file is processed independently and
accumulated globally.

Usage: python3 derive_re24.py <dir_or_files...>
Writes: fixtures/re24_matrix.json
"""
from __future__ import annotations
import sys, os, csv, glob, json
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.parser import parse_atbat_desc, ParseError, outs_recorded
from drs_engine.season_config import is_regular_season

def base_state(m1, m2, m3):
    return ("1" if m1 else "_") + ("2" if m2 else "_") + ("3" if m3 else "_")

STATES = [b + o for o in "012" for b in
          ("___", "1__", "_2_", "__3", "12_", "1_3", "_23", "123")]

def expand(paths):
    out = []
    for p in paths:
        if os.path.isdir(p):
            out += sorted(glob.glob(os.path.join(p, "*.csv")))
        else:
            out.append(p)
    return [p for p in out if "expected" not in p and "Standard (" not in p]

def run(paths):
    re_sum = defaultdict(float)
    re_n = defaultdict(int)
    complete = incomplete = 0
    post_games = set()
    for path in expand(paths):
        r = csv.reader(open(path, newline=""))
        hdr = [h.strip() for h in next(r)]
        i = {h: n for n, h in enumerate(hdr)}
        if "atbatDesc" not in i:
            continue
        def col(row, c):
            return row[i[c]].strip() if c in i and i[c] < len(row) else ""
        # bucket rows by half-inning
        cur_key = None
        rows = []
        def flush(block):
            nonlocal complete, incomplete
            if not block:
                return
            # order by pitch number
            block.sort(key=lambda x: x["pn"])
            total_runs = sum(x["runs"] for x in block)
            pa = [x for x in block if x["pa"]]
            total_outs = sum(x["outs_made"] for x in pa)
            if total_outs < 3:               # incomplete half-inning -> skip
                incomplete += 1
                return
            complete += 1
            runs_before = 0.0
            j = 0
            for x in block:
                if x["pa"]:
                    # runs scored from the start of THIS PA to end of inning
                    rte = total_runs - runs_before
                    st = x["state"]
                    re_sum[st] += rte
                    re_n[st] += 1
                runs_before += x["runs"]     # accrue after using (this play's runs count toward remainder)
        for row in r:
            gid = col(row, "gameId"); inn = col(row, "inn")
            # REGULAR SEASON ONLY (Option A) — skip postseason games entirely
            if not is_regular_season(col(row, "gameString")):
                post_games.add(gid)
                continue
            key = (gid, inn)
            if key != cur_key:
                flush(rows); rows = []; cur_key = key
            try:
                runs = float(col(row, "Runs") or 0)
            except ValueError:
                runs = 0.0
            ad = col(row, "atbatDesc")
            is_pa = ad not in ("", "-")
            om = 0; state = None
            if is_pa:
                try:
                    ev = parse_atbat_desc(ad)
                    # outs_recorded handles OUT/DP/FC/baserunning; add the strikeout
                    # itself (a K records an out that has no movement token).
                    om = outs_recorded(ev) + (1 if ev.event_type == "K" else 0)
                except ParseError:
                    om = 0
                try:
                    o = int(col(row, "outs") or 0)
                except ValueError:
                    o = 0
                if o > 2:
                    o = 2
                state = base_state(col(row, "ManOnFirst"), col(row, "ManOnSecond"),
                                   col(row, "ManOnThird")) + str(o)
            try:
                pn = int(col(row, "pitchNumInGame") or 0)
            except ValueError:
                pn = 0
            rows.append({"pn": pn, "runs": runs, "pa": is_pa,
                         "outs_made": om, "state": state})
        flush(rows)

    matrix = {s: round(re_sum[s] / re_n[s], 4) if re_n[s] else None for s in STATES}
    counts = {s: re_n[s] for s in STATES}
    os.makedirs("fixtures", exist_ok=True)
    json.dump({"scope": "regular_season_only", "regular_season_end": "2026-05-18",
               "postseason_games_excluded": len(post_games),
               "matrix": matrix, "counts": counts,
               "complete_half_innings": complete, "incomplete_skipped": incomplete},
              open("fixtures/re24_matrix.json", "w"), indent=2)
    return matrix, counts, complete, incomplete, len(post_games)

if __name__ == "__main__":
    matrix, counts, complete, incomplete, post = run(sys.argv[1:])
    print(f"REGULAR SEASON ONLY (through 2026-05-18) — postseason games excluded: {post:,}")
    print(f"complete half-innings used: {complete:,}   incomplete skipped: {incomplete:,}\n")
    print(f"{'base':>5} | {'0 out':>16} | {'1 out':>16} | {'2 out':>16}")
    print("-" * 62)
    for b in ("___", "1__", "_2_", "__3", "12_", "1_3", "_23", "123"):
        cells = []
        for o in "012":
            s = b + o
            cells.append(f"{matrix[s]:.3f} (n={counts[s]//1000}k)" if matrix[s] is not None else "  -  ")
        label = b.replace("_", "-")
        print(f"{label:>5} | {cells[0]:>16} | {cells[1]:>16} | {cells[2]:>16}")
