"""
RSTR IQ dRS Engine :: validation suite (Spec Section 11)
Tier 1: grammar unit tests including future error vocab.
Tier 2: frozen game fixtures with invariant + regression assertions.

Tier 2 needs the validation CSVs. Set DRS_FIXTURE_DIR to a folder containing the
Standard exports (e.g. docs/drs-reference). If unset, Tier 2 is SKIPPED (Tier 1
always runs) — so no large data files are committed to the repo.
"""
import sys, os, glob
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from drs_engine.parser import parse_atbat_desc, ParseError
from drs_engine.normalize import (load_rows, derive_league_fixtures, is_pa_end,
                                   framing_class, dp_opportunity_shares, load_re24)
from drs_engine.engine import DRSEngine
from drs_engine import constants as C

PASS = FAIL = 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  PASS  {name}")
    else:    FAIL += 1; print(f"  FAIL  {name}  {detail}")

# ---------------- Tier 1: parser ----------------
print("Tier 1: grammar")

e = parse_atbat_desc("8/F")
check("8/F fly out to CF", e.event_type == "OUT" and e.putout_chain == [8] and e.bb_type == "F")

e = parse_atbat_desc("63/G")
check("63/G groundout chain", e.putout_chain == [6, 3] and e.bb_type == "G")

e = parse_atbat_desc("463/GDP.3-H;1X2")
check("463 GDP parse", e.is_dp and e.dp_kind == "GDP" and e.putout_chain == [4, 6, 3]
      and len(e.movements) == 2 and e.movements[1].out)

e = parse_atbat_desc("E3.2-3;1-2")
check("E3 reached on error", e.event_type == "ERROR" and e.error_fielder == 3
      and all(not m.out for m in e.movements))

e = parse_atbat_desc("FC6.1X2(6)")
check("FC6 with putout chain", e.event_type == "FC" and e.fc_fielder == 6
      and e.movements[0].out and e.movements[0].chain == [6])

e = parse_atbat_desc("FC.1-2(E3)")
check("FC bare with embedded error", e.event_type == "FC" and e.fc_fielder is None
      and e.error_fielder == 3)

e = parse_atbat_desc("S/7(RBI).2-H;1X2(726)")
check("single with 7-2-6 kill", e.event_type == "SINGLE" and e.hit_zone == [7]
      and e.movements[1].out and e.movements[1].chain == [7, 2, 6])

e = parse_atbat_desc("46/LDP.2X2")
check("46 LDP lined DP", e.is_dp and e.dp_kind == "LDP" and e.putout_chain == [4, 6])

e = parse_atbat_desc("13/G/B/SH.2-3")
check("sac bunt 1-3", e.is_bunt and e.is_sh and e.putout_chain == [1, 3])

e = parse_atbat_desc("D/78.1-3")
check("double to gap", e.event_type == "DOUBLE" and e.hit_zone == [7, 8])

e = parse_atbat_desc("9/SF(RBI).3-H;2-3")
check("sac fly", e.is_sf and e.putout_chain == [9])

e = parse_atbat_desc("HR/7")
check("home run", e.event_type == "HR" and e.hit_zone == [7])

# future vocab (Section 11 synthetic strings)
e = parse_atbat_desc("54/G.1X2(54E3)")
check("future 54E3 mixed paren", e.movements[0].error_fielder == 3
      and e.movements[0].chain == [5, 4])

try:
    parse_atbat_desc("ZZTOP/Q")
    check("garbage raises ParseError", False)
except ParseError:
    check("garbage raises ParseError", True)

# ---------------- Tier 2: frozen game fixtures ----------------
fx_dir = os.environ.get("DRS_FIXTURE_DIR")
# Tier 2 uses ONLY the frozen Standard validation exports (3 CWS games) — NOT any
# full-season "DRS Pitch Log" files that may share the directory. The assertions
# below (8 FC events, the two E3 errors, 4 catchers) are specific to those games.
csvs = sorted(glob.glob(os.path.join(fx_dir, "Standard*.csv"))) if fx_dir else []
if not csvs:
    print("\nTier 2: SKIPPED (set DRS_FIXTURE_DIR to a folder with the Standard CSVs)")
    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)

print(f"\nTier 2: frozen fixtures ({len(csvs)} file(s) from {fx_dir})")
rows = load_rows(csvs)
fx = derive_league_fixtures(rows)
re24 = load_re24()
eng = DRSEngine(fx, re24)
eng.run(rows)
res = eng.player_season_rows(2026)

# 2.1 both E3 events (ROE dribbler + FC embedded error) charge full play debit
err_rows = [r for r in res if r["errors"] > 0 and r["position"] == "1B"]
check("two 1B error rows (ROE + FC-embedded)", len(err_rows) == 2, str(err_rows))
check("each E3 debit == -RUNS_PER_SINGLE exactly (error base is a single, no extra advancement)",
      all(abs(r["error_runs"] + C.RUNS_PER_SINGLE) < 1e-9 for r in err_rows),
      str([r["error_runs"] for r in err_rows]))

# 2.2 the 7-2-6 kill credits an LF with positive arm runs
lf_arm = [r for r in res if r["position"] == "LF" and r["arm_runs"] > 0.3]
check("LF arm credit from 7-2-6 kill exists", len(lf_arm) >= 1,
      str([(r['player'], r['arm_runs']) for r in res if r['position'] == 'LF']))

# 2.3 every FC event produced non-negative range accounting
fc_events = [r for r in rows if (r.get("atbatDesc") or "").startswith("FC")]
check("eight FC events found", len(fc_events) == 8, f"got {len(fc_events)}")
fc_ok = True
for row in fc_events:
    ev = parse_atbat_desc(row["atbatDesc"])
    solo = DRSEngine(fx, re24)
    solo._route(row, ev)
    for a in solo.acc.values():
        if a.range_runs < -1e-9:
            fc_ok = False
check("no FC event ever debits range", fc_ok)

# 2.4 (redesigned) 463 GDP: opportunity AND conversion land on chain[0]=4 only,
#     NOT hardcoded 4 & 6. This is the DP attribution fix.
gdp_row = next(r for r in rows if (r.get("atbatDesc") or "").startswith("463/GDP"))
solo = DRSEngine(fx, re24)
solo._dp_accumulate(gdp_row, parse_atbat_desc(gdp_row["atbatDesc"]))
opp = {k[2]: round(a.dp_opps, 6) for k, a in solo.acc.items() if a.dp_opps > 0}
conv = {k[2]: round(a.dp_conv_n, 6) for k, a in solo.acc.items() if a.dp_conv_n > 0}
check("GDP opportunity+conversion land on chain[0]=4 only (no 4&6 hardcode)",
      set(opp) == {4} and set(conv) == {4}, f"opp={opp} conv={conv}")

# 2.4b DP nets to zero league-wide (per-fielder net accounting invariant).
# Assert on the raw accumulator, not the 3-decimal output rows (summing rounded
# per-fielder values leaves a display-rounding residual, not a real imbalance).
net_dp_raw = sum(a.dp_runs for a in eng.acc.values())
check("DP nets to zero league-wide (raw)", abs(net_dp_raw) < 1e-9, f"net_dp_raw={net_dp_raw}")

# 2.5 league net range (informational)
net_range = sum(r["range_runs"] for r in res)
print(f"\n  info: league net range runs = {net_range:+.2f} "
      f"(nonzero expected on {len(csvs)} game file(s); converges over a season)")

# 2.6 framing populated for all catchers, no framing for non-catchers
c_rows = [r for r in res if r["position"] == "C"]
nc = [r for r in res if r["position"] != "C" and abs(r["framing_runs"]) > 0]
check("all catchers have framing accumulation",
      all(abs(r["framing_runs"]) > 0 for r in c_rows) and len(c_rows) >= 4)
check("no framing leakage to non-catchers", len(nc) == 0)

# ---------------- Regression tests (reconciliation 2026-08-03) ----------------
print("\nRegression: fix guards")

# R1: fixture and router MUST agree on DP opportunity counts over ANY dataset.
# Guards against the ev.bb_type=="G" vs pitchResult-fallback divergence.
fixture_opp = 0
for r in rows:
    if not is_pa_end(r):
        continue
    try:
        ev = parse_atbat_desc(r["atbatDesc"])
    except ParseError:
        continue
    if dp_opportunity_shares(r, ev):
        fixture_opp += 1
router_opp = sum(a.dp_opps for a in eng.acc.values())   # shares sum to 1.0 per opp PA
check("R1: DP opportunity count fixture == router",
      abs(fixture_opp - router_opp) < 1e-9, f"fixture={fixture_opp} router={router_opp}")

# R2: no taken pitch with a probSL ever exits the framing engine unaccounted —
# every UNKNOWN-with-probSL result is logged NEW_VOCAB (nothing silently drops).
new_vocab_ids = {x.uniq_pitch_id for x in eng.exceptions if x.reason == "NEW_VOCAB"}
unlogged = []
for r in rows:
    if r["_probSL"] is None:
        continue
    if framing_class(r.get("pitchResult")) == "UNKNOWN" and r.get("uniqPitchId") not in new_vocab_ids:
        unlogged.append((r.get("uniqPitchId"), r.get("pitchResult")))
check("R2: no probSL pitch with UNKNOWN result goes unlogged (real data)",
      len(unlogged) == 0, str(unlogged[:5]))

# R2b: mechanism check — an unknown taken label WITH probSL logs NEW_VOCAB.
solo = DRSEngine(fx, re24)
fake = {"catchingTeam": "T", "catcherAbbrevName": "TEST_C", "gameId": "g",
        "gameString": "g", "inn": "1", "uniqPitchId": "fake-1",
        "pitchResult": "Automatic Ball", "_probSL": 0.5, "_pPBWP": None}
solo._per_pitch(fake)
check("R2b: unknown pitchResult w/ probSL logs NEW_VOCAB",
      any(x.reason == "NEW_VOCAB" for x in solo.exceptions),
      str([(x.reason, x.detail) for x in solo.exceptions]))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
