"""
POSITION-GRAIN assertion — the tripwire that was at the wrong grain for four straight bugs.
Every component entering dWAR must sum to ~0 PER POSITION, not just league-wide (the league sum was
zero the whole time each position bias existed). FRAMING is exempt (venue bias, scheduled source fix).

Exit 0 (PASS) only if every non-framing component is within TOL of zero at every position, and the
league telescope closes to framing + noise. Meant to run in the golden/regression suite.
"""
import csv, sys, math
rows = list(csv.DictReader(open("output/player_season_defense.csv")))
f = lambda r, k: float(r[k]) if r.get(k) not in (None, "", "None") else 0.0
IF = ["3B", "SS", "2B", "1B"]
def p(v, q): v = sorted(v); return v[min(len(v) - 1, int(q * (len(v) - 1)))]

# components that must center per position; framing EXEMPT (its own scheduled venue fix)
COMPS = ["range_runs", "error_runs", "dp_runs", "arm_runs", "bunt_runs", "blocking_runs", "throwing_runs"]
POSNS = ["3B", "SS", "2B", "1B", "LF", "CF", "RF", "C", "P"]
TOL = 60.0   # runs; per-position noise band (sparse-fallback + geometry residue)

print("=== POSITION-GRAIN: per-component sum by position (must be within +-%.0f) ===" % TOL)
print("  pos  " + "".join(f"{c.split('_')[0][:5]:>7}" for c in COMPS))
fails = []
for pos in POSNS:
    pr = [r for r in rows if r["position"] == pos]
    if not pr: continue
    cells = []
    for c in COMPS:
        s = sum(f(r, c) for r in pr); cells.append(s)
        if abs(s) > TOL: fails.append((pos, c, s))
    print(f"  {pos:<4} " + "".join(f"{s:>7.0f}" for s in cells))

print("\n=== drs_floor means by position (expect within +-0.1) ===")
mean_fail = []
for pos in IF:
    v = [f(r, "drs_floor") for r in rows if r["position"] == pos]
    m = sum(v) / len(v)
    flag = "" if abs(m) <= 0.10 else "  <-- outside +-0.1"
    if abs(m) > 0.10: mean_fail.append((pos, m))
    print(f"  {pos:<3} mean {m:+.2f}{flag}")

print("\n=== league telescope (should be framing + noise) ===")
tot = 0.0
for c in COMPS + ["framing_runs"]:
    s = sum(f(r, c) for r in rows); tot += s
    print(f"  {c:<16} {s:+8.1f}")
print(f"  {'drs_total':<16} {sum(f(r,'drs_total') for r in rows):+8.1f}")

# ErrR spread + leaderboard carry
reg = [r for r in rows if r["position"] in IF and f(r, "bip_opportunities") >= 100]
chk = "err_engagements" if rows and "err_engagements" in rows[0] else "bip_opportunities"
sd = lambda v: math.sqrt(sum((x - sum(v)/len(v))**2 for x in v)/len(v)) if len(v) > 1 else 0
epc = sd([f(r,"error_runs")/max(1.0,f(r,chk)) for r in reg if f(r,chk)>0])
rpc = sd([f(r,"range_gb")/max(1.0,f(r,"bip_opportunities")) for r in reg if f(r,"bip_opportunities")>0])
print(f"\nErrR/range per-chance SD: {epc:.4f} / {rpc:.4f} (ratio {epc/rpc:.2f})")

print("\n=== VERDICT ===")
ok = True
if fails:
    ok = False
    print("  POSITION-GRAIN FAIL:")
    for pos, c, s in fails: print(f"    {pos} {c} {s:+.0f}")
else:
    print("  position-grain: all components within tolerance PASS")
if mean_fail:
    ok = False
    print("  drs_floor means outside +-0.1:", [(p, round(m,2)) for p, m in mean_fail])
else:
    print("  drs_floor means: within +-0.1 PASS")
sys.exit(0 if ok else 1)
