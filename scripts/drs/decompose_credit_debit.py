"""
Decompose each infield position's grounder range into CREDIT (its outs) vs DEBIT (its fractional
hit-shares), by spray bin, to locate the corners-pay/middle-profits transfer — and validate the
run-space fix in the same pass, on the population, no engine re-run.

Mechanism under test (Trevor, pre-registered): reach-shares are derived from out COUNTS but the
ledger is in RUNS. In a bin, credit_f = run_share_f * T (distributes by difficulty of a position's
conversions); debit_f = count_share_f * T (distributes by raw count). net_f = (run_share - count_share)*T.
If at the seams corners convert more EASY balls (count share > run share) and the middle makes the
harder, higher-credit stabs (run share > count share), corners pay and middle profits.

FIX: derive reach in RUN space -> reach_run_share_f(s) = f's share of summed credit (post-cal ph)
over conversions at s. Then debit distributes by the same measure as credit -> net_f = 0 where bins zero.
"""
import csv, json, os
from collections import defaultdict

RPP = 1.045
IF = [5, 6, 4, 3]
NAME = {5: "3B", 6: "SS", 4: "2B", 3: "1B"}

# ---- load g(xAVG,spray) -> P(out) (replicates engine _g_out_grounder) ----
gc = json.load(open("fixtures/grounder_calibration.json"))
_breaks = sorted(gc["global_g_hit"])
_grid = [1.0 - min(_breaks, key=lambda t: abs(t[0] - i / 1000.0))[1] for i in range(1001)]
def g_out(xa, spray):
    pout = _grid[max(0, min(1000, int(round(xa * 1000))))]
    if spray is not None:
        b = int((spray + gc["spray_bin_offset"]) // gc["spray_bin_width"])
        pout += gc["spray_offsets"].get(str(b), 0.0)
    return min(1.0, max(0.0, pout))

# ---- load count-based reach table (current) ----
rs = json.load(open("fixtures/reach_shares.json"))
RBW = rs["bin_width"]
reach = {float(k): {int(f): s for f, s in v.items()} for k, v in rs["shares"].items()}
rlo, rhi = min(reach), max(reach)
def reach_count(spray):
    b = min(rhi, max(rlo, round(spray / RBW) * RBW))
    return reach.get(b) or reach[min(reach, key=lambda c: abs(c - b))]

# ---- accumulate from population ----
credit = defaultdict(float)               # f -> credit runs (its outs)
cnt = defaultdict(lambda: defaultdict(int))    # bin -> f -> out count
runw = defaultdict(lambda: defaultdict(float)) # bin -> f -> sum ph over its outs
hits = []                                 # (bin, spray, pout)
for d in csv.DictReader(open("output/grounder_pop.csv")):
    if d["spray"] in ("", "None") or d["xavg"] in ("", "None"): continue
    xa = float(d["xavg"]); sp = float(d["spray"]); b = round(sp / RBW) * RBW
    pout = g_out(xa, sp); ph = 1 - pout
    if d["is_out"] == "1":
        f = int(d["fielder"])
        if f in IF:
            credit[f] += ph * RPP
            cnt[b][f] += 1; runw[b][f] += ph
    else:
        hits.append((b, sp, pout))

# reach in RUN space: f's share of summed ph (credit) over conversions in the bin
reach_run = {}
for b, fw in runw.items():
    tot = sum(fw.values())
    reach_run[b] = {f: fw[f] / tot for f in fw} if tot else {}

def debit_with(reach_fn):
    deb = defaultdict(float)
    for b, sp, pout in hits:
        for f, s in reach_fn(sp).items():
            deb[f] += s * pout * RPP
    return deb

deb_count = debit_with(lambda sp: reach_count(sp))
def reach_run_fn(sp):
    b = min(rhi, max(rlo, round(sp / RBW) * RBW))
    return reach_run.get(b) or reach_run[min(reach_run, key=lambda c: abs(c - b))]
deb_run = debit_with(reach_run_fn)

print("position   credit    debit(count)  net(count)     debit(run)   net(run)")
for f in IF:
    nc = credit[f] - deb_count[f]; nr = credit[f] - deb_run[f]
    print(f"  {NAME[f]:<4}   {credit[f]:8.0f}    {deb_count[f]:8.0f}    {nc:+8.0f}     {deb_run[f]:8.0f}    {nr:+8.0f}")
print(f"  {'SUM':<4}   {sum(credit.values()):8.0f}    {sum(deb_count.values()):8.0f}    "
      f"{sum(credit[f]-deb_count[f] for f in IF):+8.0f}     {sum(deb_run.values()):8.0f}    "
      f"{sum(credit[f]-deb_run[f] for f in IF):+8.0f}")

# count-share vs run-share at the seam bins (the mechanism, made visible)
print("\nseam bins: count-share vs run-share per fielder (corner count>run = pays)")
for b in sorted(cnt):
    fw = cnt[b]
    if len(fw) < 2: continue      # only multi-fielder (seam) bins
    tc = sum(fw.values()); tr = sum(runw[b].values())
    parts = []
    for f in sorted(fw, key=lambda x: IF.index(x)):
        cs, rsh = fw[f] / tc, runw[b][f] / tr
        parts.append(f"{NAME[f]} cnt{cs*100:4.0f} run{rsh*100:4.0f} ({(cs-rsh)*100:+3.0f})")
    print(f"  {b:+5.0f}  " + "   ".join(parts))
