"""
Post-error-centering checks:
  1. TELESCOPE — league-wide component sums; error_runs and drs_total should be within noise of
     zero for the first time (every component now centered vs average).
  2. ErrR SPREAD (pre-registered) — hands should separate players LESS than range does: the
     per-chance SD of error_runs must be well inside the per-chance SD of range_gb (IF regulars).
  3. Did centering lift the per-position drs_floor means toward zero (the residual was errors).
"""
import csv, math
rows = list(csv.DictReader(open("output/player_season_defense.csv")))
f = lambda r, k: float(r[k]) if r.get(k) not in (None, "", "None") else 0.0
IF = ["3B", "SS", "2B", "1B"]
def sd(v):
    if len(v) < 2: return 0.0
    m = sum(v) / len(v); return math.sqrt(sum((x - m) ** 2 for x in v) / len(v))
def p(v, q): v = sorted(v); return v[min(len(v) - 1, int(q * (len(v) - 1)))]

print("=== (1) TELESCOPE: league component sums ===")
comps = ["range_runs", "error_runs", "dp_runs", "arm_runs", "framing_runs",
         "blocking_runs", "throwing_runs", "bunt_runs"]
tot = 0.0
for c in comps:
    s = sum(f(r, c) for r in rows); tot += s
    print(f"  {c:<16} {s:+8.1f}")
print(f"  {'drs_total':<16} {sum(f(r,'drs_total') for r in rows):+8.1f}   (expect ~0 for the first time)")

# chance proxy: err_engagements if present else bip_opportunities
chk = "err_engagements" if "err_engagements" in (rows[0].keys() if rows else {}) else "bip_opportunities"
reg = [r for r in rows if r["position"] in IF and f(r, "bip_opportunities") >= 100]
err_pc = [f(r, "error_runs") / max(1.0, f(r, chk)) for r in reg if f(r, chk) > 0]
rng_pc = [f(r, "range_gb") / max(1.0, f(r, "bip_opportunities")) for r in reg if f(r, "bip_opportunities") > 0]
print(f"\n=== (2) ErrR spread vs RANGE spread (IF regulars >=100 opp, denom={chk}) ===")
print(f"  per-chance SD:  ErrR {sd(err_pc):.4f}   range {sd(rng_pc):.4f}   "
      f"ratio {sd(err_pc)/sd(rng_pc):.2f}  ({'PASS: hands<range' if sd(err_pc) < sd(rng_pc) else 'CHECK'})")

print("\n=== (3) per-position drs_floor means (errors now centered -> toward 0) ===")
for pos in IF:
    v = [f(r, "drs_floor") for r in rows if r["position"] == pos]
    ev = [f(r, "error_runs") for r in rows if r["position"] == pos]
    print(f"  {pos:<3} drs_floor mean {sum(v)/len(v):+.2f}  p90 {p(v,.9):+.2f}   error_runs sum {sum(ev):+.0f}")
ir = [f(r, "drs_floor") for r in rows if r["position"] in IF]
print(f"  IF aggregate drs_floor: mean {sum(ir)/len(ir):+.2f}  p90 {p(ir,.9):+.2f}")
regv = [f(r, "drs_floor") for r in rows if r["position"] in IF and f(r, "bip_opportunities") >= 100]
print(f"  IF regulars drs_floor:  mean {sum(regv)/len(regv):+.2f}  p90 {p(regv,.9):+.2f}  p75 {p(regv,.75):+.2f}")
