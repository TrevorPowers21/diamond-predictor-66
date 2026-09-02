"""
WAR redesign, Step 2b — DESCRIPTIVE HITTER constants: D1 wOBA linear weights, from the
pitch-log RE24 run-expectancy matrix. The descriptive hitter number is true wRAA (not our
fabricated wRC+ index):

    wRAA = ((wOBA − lgwOBA) / wOBAscale) · PA
    descOWar = (wRAA + Replacement) / RPW           (NO positional ladder — struck)

Method (canonical Tango linear weights):
  1. RE24: walk every half-inning, record the base-out state entering each PA and the runs
     that scored from that PA to the end of the inning. RE[state] = mean of those.
  2. Linear weight of an event = mean over all instances of  RE[after] − RE[before] + runs_on_play
     (RE[after]=0 when the PA ends the inning). This is runs-above-average per event.
  3. wOBA weights = each event's run value shifted so a generic OUT = 0 (w_e = lw_e − lw_out),
     then scaled by wOBAscale = lgOBP / lg_rawwOBA so wOBA sits on the on-base scale.
  NOTE: wRAA itself is SCALE-INDEPENDENT (the out-shift and scale cancel when you subtract the
  league mean) — it depends only on the raw linear weights. The wOBA weights/scale are for a
  legible, spec-matching display and for storing wOBA alongside.

Runs come from the validated score-delta (pitch-after) method. Self-contained: lgOBP is computed
from the pitch log itself (reached / PA). Reuses the Step-0 parser for event classification.

  python3 scripts/drs/derive_woba_weights.py
"""
import sys, os, csv, glob, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.parser import parse_atbat_desc, ParseError

FILES = sorted(glob.glob("docs/drs-reference/*DRS Pitch Log.csv"))
RPW = 13.1

def v(r, k): return (r.get(k) or "").strip()

def woba_event(ev):
    """Classify a PA into a wOBA event bucket, or 'out' (K + fieldouts), or None (not counted)."""
    et = ev.event_type
    if et == "HR": return "HR"
    if et == "TRIPLE": return "3B"
    if et == "DOUBLE": return "2B"
    if et == "SINGLE": return "1B"
    if ev.is_walk: return "BB"
    if ev.is_hbp: return "HBP"
    if et in ("ERROR", "FC") or ev.is_ci: return None      # ROE/FC/CI — not credited, not a clean out
    return "out"                                            # K + fieldouts

def main():
    seen = set()
    # half-inning -> ordered [(pn, abnum, base, outs, ev|None, uid)]
    hi = {}
    teamgame = {}   # (game,bt) -> [(pn, uid, cur, runscol)]
    n_bad = 0
    for f in FILES:
        with open(f, newline="") as fh:
            for r in csv.DictReader(fh):
                uid = r.get("uniqPitchId")
                if uid in seen: continue
                seen.add(uid)
                gid = r.get("gameId"); bt = v(r, "battingTeamId")
                try: pn = int(v(r, "pitchNumInGame") or 0)
                except: pn = 0
                def num(k):
                    try: return int(float(v(r, k) or 0))
                    except: return None
                cur = num("currentRuns") if v(r, "teamId") == bt else num("opponentCurrentRuns")
                teamgame.setdefault((gid, bt), []).append((pn, uid, cur, num("Runs") or 0))
                try: outs = int(v(r, "outs") or -1)
                except: outs = -1
                base = (bool(v(r, "ManOnFirst")), bool(v(r, "ManOnSecond")), bool(v(r, "ManOnThird")))
                try: ab = int(v(r, "abNumInGame") or 0)
                except: ab = 0
                desc = v(r, "atbatDesc")
                ev = None
                if desc not in ("", "-"):
                    try: ev = parse_atbat_desc(desc)
                    except ParseError: n_bad += 1; ev = None
                hi.setdefault((gid, r.get("inn"), bt), []).append((pn, ab, base, outs, ev, uid))

    # score-delta runs per pitch, then per AB window
    runs_by_pitch = {}
    for k, rows in teamgame.items():
        rows.sort(key=lambda x: x[0])
        for i in range(len(rows)):
            pn, uid, cur, rc = rows[i]
            d = (rows[i+1][2] - cur) if (i+1 < len(rows) and cur is not None and rows[i+1][2] is not None and rows[i+1][2] > cur) else (rc if i+1 == len(rows) else 0)
            if d > 0: runs_by_pitch[uid] = d

    # Build the PA sequence per half-inning: (before_state, event_bucket, runs_in_this_PA_window)
    # PASS 1 collects; we then compute runs-to-end and RE24, then linear weights.
    seqs = []   # list of half-inning PA-lists: [(before(base,outs), bucket, runs_window)]
    reached = hits = bb = hbp = pa_total = 0
    for key, rows in hi.items():
        rows.sort(key=lambda x: x[0])
        # group into ABs (ordered); a PA = the AB's resolving is_pa event
        ab_order = []       # ordered unique ab numbers as they appear
        ab_first = {}       # ab -> (base, outs) at its first pitch
        ab_event = {}       # ab -> ev (the is_pa event)
        ab_runs = {}        # ab -> runs scored on pitches in this ab
        for pn, ab, base, outs, ev, uid in rows:
            if ab not in ab_first:
                ab_first[ab] = (base, outs); ab_order.append(ab)
            ab_runs[ab] = ab_runs.get(ab, 0) + runs_by_pitch.get(uid, 0)
            if ev is not None and ev.is_pa:
                ab_event[ab] = ev
        pas = []
        for ab in ab_order:
            ev = ab_event.get(ab)
            if ev is None:      # AB with no clean PA resolution — still carries its runs
                continue
            base, outs = ab_first[ab]
            if outs not in (0, 1, 2): continue
            bucket = woba_event(ev)
            pas.append({"before": (base, outs), "bucket": bucket, "runs": ab_runs.get(ab, 0), "ab": ab})
            pa_total += 1
            if bucket in ("1B", "2B", "3B", "HR"): reached += 1; hits += 1
            elif bucket == "BB": reached += 1; bb += 1
            elif bucket == "HBP": reached += 1; hbp += 1
        # runs from each PA to end of inning = suffix sum over ALL ab runs (incl non-PA) after its point.
        # Use the full ab_order run stream so steals/WP between PAs are counted.
        run_stream = [(ab, ab_runs.get(ab, 0)) for ab in ab_order]
        suffix = {}; acc = 0
        for ab, rr in reversed(run_stream):
            acc += rr; suffix[ab] = acc
        for p in pas:
            p["r2e"] = suffix[p["ab"]]                    # runs from this PA's start to inning end
        seqs.append(pas)

    # RE24 matrix: mean runs-to-end from each (base,outs) state entering a PA
    re_sum = {}; re_n = {}
    for pas in seqs:
        for p in pas:
            s = p["before"]
            re_sum[s] = re_sum.get(s, 0) + p["r2e"]; re_n[s] = re_n.get(s, 0) + 1
    RE = {s: re_sum[s] / re_n[s] for s in re_sum}

    # Linear weights: mean of RE[after] − RE[before] + runs_on_play, by bucket
    lw_sum = {}; lw_n = {}
    for pas in seqs:
        for i, p in enumerate(pas):
            before = RE.get(p["before"], 0.0)
            after = RE.get(pas[i+1]["before"], 0.0) if i + 1 < len(pas) else 0.0
            val = after - before + p["runs"]
            b = p["bucket"]
            if b is None: continue
            lw_sum[b] = lw_sum.get(b, 0) + val; lw_n[b] = lw_n.get(b, 0) + val*0 + 1
    lw = {b: lw_sum[b] / lw_n[b] for b in lw_sum}         # runs above average, per event

    lw_out = lw.get("out", 0.0)
    events = ["BB", "HBP", "1B", "2B", "3B", "HR"]
    woba_runs = {e: lw[e] - lw_out for e in events if e in lw}   # runs above OUT (out = 0)

    # league raw wOBA (above-out, per PA) and scale to lgOBP
    # ⚠ SEAM (2026-08-10): numerator uses lw_n (RE24-bucket counts) but denominator is pa_total, so this
    # lg_raw (~0.3985) disagrees with the linear-weights out-weight centering (−lw_out ~0.4154) — two
    # baselines in one fixture, a systematic ~0.017 runs/PA level error. The AUTHORITATIVE all-D1 centering
    # (lg_raw = Σ raw-runs / Σ PA over ALL D1 = 0.3994) is applied downstream in output/woba_weights.json's
    # linear_weights_above_avg + output/ncaa_league_averages_2026.json. Physics (woba_runs) are unaffected.
    # If you re-run this on the pool, RE-CENTER via scripts/drs/_recenter_check.mjs before trusting the weights.
    lg_raw = sum(woba_runs[e] * lw_n[e] for e in woba_runs) / pa_total
    lgOBP = reached / pa_total                            # (H+BB+HBP)/PA from the log itself
    wOBAscale = lgOBP / lg_raw
    woba_wt = {e: woba_runs[e] * wOBAscale for e in woba_runs}   # display weights (~ .7/.9/1.3/1.6/2.1)
    lgwOBA = lgOBP                                        # by construction

    # replacement (offense) — FLAT, deferred per FINAL DECISIONS: 2.0 wins / 600 PA
    REPL_WINS_PER_600 = 2.0

    print(f"parse-fails {n_bad:,} | PAs {pa_total:,} | half-innings {len(seqs):,}")
    print(f"lgOBP (from log) = {lgOBP:.3f}   wOBAscale = {wOBAscale:.3f}   lgwOBA = {lgwOBA:.3f}")
    print("linear weights (runs above AVERAGE):")
    for e in events + ["out"]:
        if e in lw: print(f"   {e:>4}: {lw[e]:+.3f}   (n={lw_n[e]:,})")
    print("wOBA weights (runs above OUT, scaled — spec target ≈ BB .69 1B .89 2B 1.27 3B 1.61 HR 2.10):")
    for e in events:
        if e in woba_wt: print(f"   {e:>4}: {woba_wt[e]:.3f}")

    fixture = {
        "_meta": {"script": "scripts/drs/derive_woba_weights.py", "season": 2026,
                   "derived_at": os.environ.get("STAMP", "SET_STAMP"),
                   "method": "RE24 linear weights from the pitch log; wOBA scaled to lgOBP; wRAA is scale-independent",
                   "pool": "DRS-log teams (high-TrackMan D1)", "RPW": RPW},
        "pa": pa_total,
        "lgOBP": round(lgOBP, 4), "lgwOBA": round(lgwOBA, 4), "wOBAscale": round(wOBAscale, 3),
        "linear_weights_above_avg": {e: round(lw[e], 4) for e in lw},
        "woba_weights_above_out_scaled": {e: round(woba_wt[e], 4) for e in woba_wt},
        "offense_replacement_wins_per_600pa": REPL_WINS_PER_600,
        "RE24_sample": {f"{int(s[0][0])}{int(s[0][1])}{int(s[0][2])}_{s[1]}out": round(RE[s], 3)
                         for s in sorted(RE, key=lambda x: (x[1], x[0]))},
    }
    os.makedirs("output", exist_ok=True)
    json.dump(fixture, open("output/woba_weights.json", "w"), indent=2)
    print("\nwrote output/woba_weights.json")

if __name__ == "__main__":
    main()
