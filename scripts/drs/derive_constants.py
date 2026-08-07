"""
RSTR IQ dRS Engine :: run-value constants derivation (Spec Section 7)

Derives the 7 run-value constants from the D1 RE24 matrix via empirical linear
weights on REGULAR-SEASON complete half-innings:
    RV(PA) = RE(state_after) - RE(state_before) + runs_scored_on_PA
    (state_after of the last PA in an inning = 0; inning over)

  RUNS_PER_PLAY  = mean RV(fieldable hit S/D/T) - mean RV(BIP out)
  RUNS_PER_DP    = mean RV(single-out grounder in DP-opp state) - mean RV(GDP)
  RUNS_PER_BASE  = mean marginal RE per base of single-runner advancement (RE24)
  RUNS_SB        = value of a successful steal 1B->2B (RE24, opp-weighted)
  RUNS_CS        = value to defense of a caught stealing (RE24, opp-weighted)
  RUNS_PER_PBWP  = value of advancing all runners one base, no out (RE24, occ-weighted)
  RUNS_PER_STRIKE= count-based: freq-weighted [value(after ball) - value(after strike)]
                   over called-pitch counts, value(count)=E[PA run value | reached count]

Presents all 7 vs MLB reference. Does NOT modify constants.py — review first.
Usage: python3 derive_constants.py <dir_or_files...>
"""
from __future__ import annotations
import sys, os, csv, glob, json
from collections import defaultdict
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from drs_engine.parser import parse_atbat_desc, ParseError, outs_recorded
from drs_engine.season_config import is_regular_season

MLB_REF = {"RUNS_PER_PLAY": 0.78, "RUNS_PER_DP": 0.40, "RUNS_PER_BASE": 0.25,
           "RUNS_SB_COST": 0.20, "RUNS_CS": 0.44, "RUNS_PER_PBWP": 0.28,
           "RUNS_PER_STRIKE": 0.12}

def base_state(m1, m2, m3):
    return ("1" if m1 else "_") + ("2" if m2 else "_") + ("3" if m3 else "_")

# advance every runner one base; returns (new_base_config, runs_scored)
def advance_all(bs):
    m1, m2, m3 = bs[0] == "1", bs[1] == "2", bs[2] == "3"
    runs = 1 if m3 else 0
    n1 = False           # 1st empties (batter not involved in a WP/PB)
    n2 = m1              # 1st -> 2nd
    n3 = m2              # 2nd -> 3rd
    return ("1" if n1 else "_") + ("2" if n2 else "_") + ("3" if n3 else "_"), runs

def expand(paths):
    out = []
    for p in paths:
        out += sorted(glob.glob(os.path.join(p, "*.csv"))) if os.path.isdir(p) else [p]
    return [p for p in out if "expected" not in p and "Standard (" not in p]

def load_re24():
    d = json.load(open("fixtures/re24_matrix.json"))
    return d["matrix"], d["counts"]

def rv_pass(paths, RE):
    """Pass 1: per-PA run values + event buckets + count->PA-RV linkage."""
    buckets = defaultdict(list)          # label -> [RV,...]
    pa_rv = {}                           # (game,inn,ab) -> RV
    for path in expand(paths):
        r = csv.reader(open(path, newline="")); hdr = [h.strip() for h in next(r)]
        i = {h: n for n, h in enumerate(hdr)}
        if "atbatDesc" not in i:
            continue
        def c(row, k):
            return row[i[k]].strip() if k in i and i[k] < len(row) else ""
        block = []; cur = None
        def flush(b):
            if not b:
                return
            b.sort(key=lambda x: x["pn"])
            pas = [x for x in b if x["pa"]]
            if sum(x["om"] for x in pas) < 3:      # incomplete half-inning
                return
            for idx, x in enumerate(pas):
                re_before = RE.get(x["state"], 0.0) or 0.0
                re_after = (RE.get(pas[idx + 1]["state"], 0.0) or 0.0) if idx + 1 < len(pas) else 0.0
                rv = re_after - re_before + x["runs"]
                pa_rv[x["key"]] = rv
                for lab in x["labels"]:
                    buckets[lab].append(rv)
        runs_accum = 0.0
        for row in r:
            if not is_regular_season(c(row, "gameString")):
                continue
            key = (c(row, "gameId"), c(row, "inn"))
            if key != cur:
                flush(block); block = []; cur = key; runs_accum = 0.0
            try:
                runs = float(c(row, "Runs") or 0)
            except ValueError:
                runs = 0.0
            runs_accum += runs
            ad = c(row, "atbatDesc")
            if ad in ("", "-"):
                block.append({"pn": _int(c(row, "pitchNumInGame")), "pa": False})
                continue
            om = 0; labels = []; state = None
            try:
                ev = parse_atbat_desc(ad)
                om = outs_recorded(ev) + (1 if ev.event_type == "K" else 0)
                o = min(2, _int(c(row, "outs")))
                on1 = bool(c(row, "ManOnFirst"))
                state = base_state(c(row, "ManOnFirst"), c(row, "ManOnSecond"), c(row, "ManOnThird")) + str(o)
                bunt = ev.is_bunt
                if ev.event_type == "OUT" and not bunt:
                    if ev.dp_kind == "GDP":
                        labels.append("gdp")
                    elif ev.bb_type:
                        labels.append("out_bip")
                        if ev.bb_type == "G" and on1 and o < 2:
                            labels.append("out_dpstate")
                elif ev.event_type in ("SINGLE", "DOUBLE", "TRIPLE") and not bunt:
                    labels.append("hit_bip")
                    if ev.event_type == "SINGLE":
                        labels.append("single")   # for the clean error-debit base (point 2)
                elif ev.event_type == "K":
                    labels.append("K")
                elif ev.event_type == "OTHER":      # walk / IBB / HBP land here
                    pr = c(row, "pitchResult")
                    if pr == "Hit By Pitch":
                        labels.append("HBP")
                    elif pr == "Intentional Walk":
                        labels.append("IBB")        # excluded from framing terminal
                    else:
                        labels.append("BB")         # unintentional walk only
            except ParseError:
                pass
            block.append({"pn": _int(c(row, "pitchNumInGame")), "pa": True, "om": om,
                          "state": state, "runs": runs_accum, "labels": labels,
                          "key": (c(row, "gameId"), c(row, "inn"), c(row, "abNumInGame"))})
            runs_accum = 0.0
        flush(block)
    return buckets, pa_rv

def strike_pass(paths, pa_rv):
    """Pass 2: value(count) = E[PA run value | pitch reached this count]."""
    csum = defaultdict(float); cn = defaultdict(int); called = defaultdict(int)
    CALLED = {"Ball", "Walk", "Strike Looking", "Strikeout (Looking)"}
    for path in expand(paths):
        r = csv.reader(open(path, newline="")); hdr = [h.strip() for h in next(r)]
        i = {h: n for n, h in enumerate(hdr)}
        if "count" not in i:
            continue
        def c(row, k):
            return row[i[k]].strip() if k in i and i[k] < len(row) else ""
        seen = set()   # (count, PA key) — count each PA ONCE per count so foul-heavy
        for row in r:  # 2-strike ABs don't over-weight their count's value
            if not is_regular_season(c(row, "gameString")):
                continue
            key = (c(row, "gameId"), c(row, "inn"), c(row, "abNumInGame"))
            if key not in pa_rv:
                continue
            cnt = c(row, "count")
            if (cnt, key) not in seen:
                seen.add((cnt, key))
                csum[cnt] += pa_rv[key]; cn[cnt] += 1
            if c(row, "pitchResult") in CALLED:
                called[cnt] += 1
    value = {k: csum[k] / cn[k] for k in cn if cn[k]}
    return value, called

def _int(v):
    try:
        return int(v)
    except (ValueError, TypeError):
        return 0

def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0

def re24_constants(RE, N):
    def m(s):
        return RE.get(s, 0.0) or 0.0
    def n(s):
        return N.get(s, 0) or 0
    # RUNS_PER_BASE: single-runner PURE base-to-base advances only (1B->2B, 2B->3B),
    # source-state weighted. Runner-scoring-from-3rd is excluded — in RE24 accounting
    # it's near-zero (a runner on 3rd already carries ~1.8 expected runs, so scoring
    # "spends" that high-value state) and contaminates a "value of a base" constant.
    adv, w = 0.0, 0
    for o in "012":
        for src, dst in (("1__", "_2_"), ("_2_", "__3")):
            wt = n(src + o)
            adv += (m(dst + o) - m(src + o)) * wt; w += wt
    runs_per_base = adv / w if w else 0.0
    # RUNS_SB: steal 1B->2B, opp-weighted by "1__" states
    sb, wsb = 0.0, 0
    for o in "012":
        wt = n("1__" + o); sb += (m("_2_" + o) - m("1__" + o)) * wt; wsb += wt
    runs_sb = sb / wsb if wsb else 0.0
    # RUNS_CS: erase runner on 1st + add an out, opp-weighted
    cs, wcs = 0.0, 0
    for oi, o in enumerate("012"):
        after = 0.0 if oi == 2 else m("___" + str(oi + 1))
        wt = n("1__" + o); cs += (m("1__" + o) - after) * wt; wcs += wt
    runs_cs = cs / wcs if wcs else 0.0
    # RUNS_PER_PBWP: advance all runners one base (no out), occupied-state weighted
    pb, wpb = 0.0, 0
    for o in "012":
        for b in ("1__", "_2_", "__3", "12_", "1_3", "_23", "123"):
            nb, sc = advance_all(b)
            wt = n(b + o); pb += ((m(nb + o) + sc) - m(b + o)) * wt; wpb += wt
    runs_pbwp = pb / wpb if wpb else 0.0
    return runs_per_base, runs_sb, runs_cs, runs_pbwp

def main(paths):
    RE, N = load_re24()
    buckets, pa_rv = rv_pass(paths, RE)
    value, called = strike_pass(paths, pa_rv)

    w_out = mean(buckets["out_bip"]); w_hit = mean(buckets["hit_bip"])
    w_gdp = mean(buckets["gdp"]); w_out_dp = mean(buckets["out_dpstate"])
    w_K = mean(buckets["K"]); w_BB = mean(buckets["BB"]); w_HBP = mean(buckets["HBP"])
    total_pa = len(pa_rv)
    RUNS_PER_PLAY = w_hit - w_out
    RUNS_PER_DP = w_out_dp - w_gdp
    runs_per_base, runs_sb, runs_cs, runs_pbwp = re24_constants(RE, N)

    # RUNS_PER_STRIKE: count-transition value swing, called-pitch weighted
    def cval(b, s):
        if s >= 3:                       # strikeout terminal
            return w_K
        if b >= 4:                       # walk terminal
            return w_BB
        return value.get(f"{b}-{s}", 0.0)
    num = den = 0.0
    for cnt, w in called.items():
        try:
            b, s = map(int, cnt.split("-"))
        except ValueError:
            continue
        v_ball = cval(b + 1, s); v_strike = cval(b, s + 1)
        num += (v_ball - v_strike) * w; den += w
    RUNS_PER_STRIKE = num / den if den else 0.0

    derived = {
        "RUNS_PER_PLAY": RUNS_PER_PLAY, "RUNS_PER_DP": RUNS_PER_DP,
        "RUNS_PER_BASE": runs_per_base, "RUNS_SB_COST": runs_sb,
        "RUNS_CS": runs_cs, "RUNS_PER_PBWP": runs_pbwp,
        "RUNS_PER_STRIKE": RUNS_PER_STRIKE,
    }
    print("component sample sizes:")
    for k in ("out_bip", "hit_bip", "gdp", "out_dpstate", "K", "BB", "HBP"):
        print(f"   {k:12} n={len(buckets[k]):,}  meanRV={mean(buckets[k]):+.4f}")
    nbb, nhbp, nibb = len(buckets["BB"]), len(buckets["HBP"]), len(buckets["IBB"])
    w_single = mean(buckets["single"])
    print(f"\naccurate free-pass values ({total_pa:,} PA):")
    print(f"   unintentional walk (BB): rate {nbb/total_pa:.2%}  LW {w_BB:+.4f}  (feeds framing terminal)")
    print(f"   intentional walk (IBB):  rate {nibb/total_pa:.2%}  LW {mean(buckets['IBB']):+.4f}  (EXCLUDED from framing)")
    print(f"   hit-by-pitch (HBP):      rate {nhbp/total_pa:.2%}  LW {w_HBP:+.4f}")
    print(f"   combined free-pass rate: {(nbb+nibb+nhbp)/total_pa:.2%}  (MLB ~9.7%)")
    print(f"\npoint 2 — clean error-debit base (no XBH double-count):")
    print(f"   RV(single) {w_single:+.4f}  -  RV(out) {w_out:+.4f}  =  {w_single-w_out:.4f}")
    print(f"   vs current error base = RUNS_PER_PLAY {RUNS_PER_PLAY:.4f}  ->  over-punishment {RUNS_PER_PLAY-(w_single-w_out):+.4f}/error")
    print(f"\npoint 5 — telescoping zero-sum certification (must be ~0):")
    tele = sum(pa_rv.values())
    print(f"   Sigma RV over {len(pa_rv):,} PAs = {tele:+.1f} runs  =  {tele/len(pa_rv):+.5f}/PA  ({tele/(total_pa*0.751/2)*100 if total_pa else 0:+.2f}% of run activity)")
    print(f"\n{'constant':16} {'D1 derived':>12} {'MLB ref':>10} {'ratio':>7}")
    print("-" * 48)
    for k in ("RUNS_PER_PLAY", "RUNS_PER_DP", "RUNS_PER_BASE", "RUNS_SB_COST",
              "RUNS_CS", "RUNS_PER_PBWP", "RUNS_PER_STRIKE"):
        d = derived[k]; ref = MLB_REF[k]
        print(f"{k:16} {d:>12.4f} {ref:>10.2f} {d/ref if ref else 0:>6.2f}x")
    os.makedirs("fixtures", exist_ok=True)
    json.dump({"scope": "regular_season_only", "constants": derived,
               "sample_sizes": {k: len(buckets[k]) for k in buckets}},
              open("fixtures/constants_d1.json", "w"), indent=2)

if __name__ == "__main__":
    main(sys.argv[1:])
