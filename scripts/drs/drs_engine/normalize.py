"""
RSTR IQ dRS Engine :: ingest normalization (Spec Section 2.2), shared
double-play opportunity accounting, framing classification, and league
fixture derivation (Spec Sections 5.2, 6.3, 6.4, 6.7).

League fixtures are computed from whatever dataset is passed in. On a
full-season export this IS the production fixture derivation; on small
samples the engine flags fixture_quality="THIN".
"""
from __future__ import annotations
import csv, json, os, glob
from collections import defaultdict
from . import constants as C
from .parser import parse_atbat_desc, ParseError

DEAD_COLS = {"outProb", "statcastFieldersInitialFielderPosition", "pathEff",
             "hang", "dist", "react", "speed", "jump", "wall",
             "infieldDist", "infieldTime"}

# columns that must be present for a file to be a usable Standard export
REQUIRED_COLS = ("atbatDesc", "gameId", "pitchNumInGame", "uniqPitchId")

def _f(v):
    """sentinel-aware float cast"""
    if v is None:
        return None
    v = str(v).strip()
    if v in ("", "-"):
        return None
    v = v.rstrip("s").rstrip("%")
    if v.startswith("<"):
        v = v[1:]  # '<0.01' -> treat as the bound itself
    try:
        return float(v)
    except ValueError:
        return None

def is_standard_export(fieldnames):
    """A Standard export carries atbatDesc + fielder alignment. A Pitch Log
    export (tracking block, no atbatDesc) must be skipped, not parsed."""
    return fieldnames is not None and "atbatDesc" in fieldnames

def expand_paths(paths):
    """Accept files, directories, or globs. Directories expand to *.csv."""
    out = []
    for p in paths:
        if os.path.isdir(p):
            out.extend(sorted(glob.glob(os.path.join(p, "*.csv"))))
        elif any(ch in p for ch in "*?["):
            out.extend(sorted(glob.glob(p)))
        else:
            out.append(p)
    return out

def load_rows(paths, skipped=None):
    """Load + normalize Standard-export rows, deduped on uniqPitchId.

    skipped (optional list) collects (path_or_id, reason, detail) for any file
    or row that could not be ingested, so a mixed/date-organized upload folder
    degrades gracefully with a logged reason instead of crashing the batch.
    """
    if skipped is None:
        skipped = []
    rows = []
    seen = set()
    for p in expand_paths(paths):
        with open(p, newline="") as fh:
            reader = csv.DictReader(fh)
            # Fix #4a: only ingest Standard exports; a Pitch Log export (no
            # atbatDesc) in a mixed folder is skipped with a logged reason.
            if not is_standard_export(reader.fieldnames):
                skipped.append((p, "NOT_STANDARD_EXPORT",
                                "missing atbatDesc column"))
                continue
            missing = [c for c in REQUIRED_COLS if c not in reader.fieldnames]
            if missing:
                skipped.append((p, "MISSING_COLUMNS", ",".join(missing)))
                continue
            for r in reader:
                uid = r.get("uniqPitchId")
                if uid and uid in seen:
                    continue          # dedupe overlapping exports
                # Fix #4b: guard the sort/identity keys instead of crashing.
                pnum = str(r.get("pitchNumInGame") or "").strip()
                if not r.get("gameId") or not pnum.lstrip("-").isdigit():
                    skipped.append((uid or "?", "BAD_ROW",
                                    "missing gameId/pitchNumInGame"))
                    continue
                if uid:
                    seen.add(uid)
                for c in DEAD_COLS:
                    r.pop(c, None)
                # normalized numeric fields (Spec 2.2)
                r["_xAVG"] = _f(r.get("xAVG"))
                r["_probSL"] = _f(r.get("probSL"))
                # pPBWP% is ALWAYS a percent string ('0.05%'), so always /100
                r["_pPBWP"] = _f(r.get("pPBWP%"))
                if r["_pPBWP"] is not None:
                    r["_pPBWP"] /= 100.0
                r["_EV"] = _f(r.get("ExitVel"))
                r["_LA"] = _f(r.get("LaunchAng"))
                r["_spray"] = _f(r.get("SprayAng"))
                r["_FBDst"] = _f(r.get("FBDst"))
                r["_hang"] = _f(r.get("HangTime"))
                r["_outs"] = int(r.get("outs") or 0)
                r["_pnum"] = int(pnum)
                rows.append(r)
    rows.sort(key=lambda r: (r.get("gameId") or "", r["_pnum"]))
    return rows

def load_re24():
    """Load the committed D1 RE24 matrix (base-out -> RE) from the package fixtures,
    resolved absolutely so cwd doesn't matter. Returns {} if absent (engine falls
    back to flat constants for state-specific advancement)."""
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "fixtures", "re24_matrix.json")
    if os.path.exists(p):
        return (json.load(open(p)) or {}).get("matrix", {})
    return {}

def bb_type_from_result(pitch_result: str):
    """TruMedia '[outcome] on a [type]' string -> G/F/L/P"""
    s = (pitch_result or "").lower()
    if "ground" in s: return "G"
    if "line" in s:   return "L"
    if "pop" in s:    return "P"
    if "fly" in s:    return "F"
    return None

def is_pa_end(row):
    return (row.get("atbatDesc") or "").strip() not in ("", "-")

# ---------------------------------------------------------------------------
# Framing classification (Fix #3): an exact-match allowlist silently dropped
# unrecognized taken pitches. Classify every result; anything UNKNOWN with a
# probSL is logged NEW_VOCAB by the engine so nothing disappears without a
# trace (matches the "nothing is silently dropped" design principle).
# ---------------------------------------------------------------------------
FRAMED_STRIKE = {"Strike Looking", "Strikeout (Looking)"}
FRAMED_BALL = {"Ball", "Walk"}
# recognized non-framing results we intentionally skip (swings, HBP, BIP outs)
_KNOWN_NONFRAMING = {
    "Foul", "Strike Swinging", "Strikeout (Swinging)", "Hit By Pitch",
    "Ground Out", "Fly Out", "Pop Out", "Line Out", "Fielder's Choice",
    "Sac Fly", "Sac Bunt", "Double Play",
}

def framing_class(pr):
    """'STRIKE' | 'BALL' (framed) | 'SKIP' (recognized non-framing) | 'UNKNOWN'."""
    if pr in FRAMED_STRIKE:
        return "STRIKE"
    if pr in FRAMED_BALL:
        return "BALL"
    if pr in _KNOWN_NONFRAMING:
        return "SKIP"
    if pr and " on a " in pr:   # all BIP contact outcomes ("Single on a Line Drive", HR strings)
        return "SKIP"
    return "UNKNOWN"

# ---------------------------------------------------------------------------
# Double-play opportunity accounting (Fix #1): ONE shared definition used by
# both the fixture derivation and the engine router, so their opportunity
# counts can never diverge. Opportunities land on the fielder who fielded the
# ball (chain[0] on outs, responsibility share on infield hits); conversions
# land on the same fielder. Nets to zero league-wide by construction and
# attributes credit and charge to the same person.
# ---------------------------------------------------------------------------
def _is_gb_dp_context(row, ev):
    bb = ev.bb_type or bb_type_from_result(row.get("pitchResult"))
    return (bb == "G" and (row.get("ManOnFirst") or "").strip()
            and row["_outs"] < 2 and not ev.is_bunt)

def dp_opportunity_shares(row, ev):
    """[(pos, share)] infield fielders charged with this GB DP opportunity, or
    [] if not an opportunity. Shares sum to 1.0 per opportunity PA."""
    if not _is_gb_dp_context(row, ev):
        return []
    if ev.event_type == "OUT" and ev.putout_chain and ev.putout_chain[0] in C.INFIELD:
        return [(ev.putout_chain[0], 1.0)]
    if ev.event_type == "ERROR" and ev.error_fielder in C.INFIELD:
        return [(ev.error_fielder, 1.0)]
    if ev.event_type == "FC":
        f = ev.fc_fielder if ev.fc_fielder is not None else (
            ev.putout_chain[0] if ev.putout_chain else None)
        return [(f, 1.0)] if f in C.INFIELD else []
    if ev.event_type in ("SINGLE", "DOUBLE", "TRIPLE"):
        zs = [z for z in ev.hit_zone if z in C.INFIELD]
        if zs:
            share = 1.0 / len(zs)
            return [(z, share) for z in zs]
    return []

def dp_conversion_shares(row, ev):
    """[(pos, share)] for a turned GDP (sums to 1.0), else []. Credit lands on
    the fielder who started it (chain[0]) — the same fielder charged the
    opportunity — so credit and charge are on the same person."""
    if (ev.event_type == "OUT" and ev.dp_kind == "GDP"
            and ev.putout_chain and ev.putout_chain[0] in C.INFIELD
            and _is_gb_dp_context(row, ev)):
        return [(ev.putout_chain[0], 1.0)]
    return []

def derive_league_fixtures(rows, out_path=None):
    """
    Computes from the dataset:
      - league xOut by batted-ball type (fallback ladder level 3)
      - DP conversion rate on opportunities (shared dp_* helpers)
      - SB success rate and CS rate on attempts
      - extra-advancement rate on singles/doubles by OF zone (arm expectation)
      - bunt out-conversion rate
    """
    fx = {"fixture_quality": "FULL", "n_pa_events": 0}
    xout_sum = defaultdict(float); xout_n = defaultdict(int)
    dp_opp = dp_conv = 0
    sba = sb = 0
    adv_opp = defaultdict(int); adv_extra = defaultdict(int)
    bunt_n = bunt_out = 0

    for row in rows:
        # throwing fixture accumulates per pitch
        if str(row.get("SBA2", "")).strip() == "1": sba += 1
        if str(row.get("SB2", "")).strip() == "1":  sb += 1
        if str(row.get("SBA3", "")).strip() == "1": sba += 1
        if str(row.get("SB3", "")).strip() == "1":  sb += 1

        if not is_pa_end(row):
            continue
        try:
            ev = parse_atbat_desc(row["atbatDesc"])
        except ParseError:
            continue
        fx["n_pa_events"] += 1

        bb = ev.bb_type or bb_type_from_result(row.get("pitchResult"))
        xa = row["_xAVG"]
        if bb and xa is not None and not ev.is_bunt and ev.event_type in \
                ("OUT", "SINGLE", "DOUBLE", "TRIPLE", "HR", "ERROR", "FC"):
            xout_sum[bb] += (1.0 - xa); xout_n[bb] += 1

        if ev.is_bunt:
            bunt_n += 1
            if ev.event_type == "OUT":
                bunt_out += 1
            continue

        # DP fixture — SAME opportunity/conversion definition the engine routes on
        if dp_opportunity_shares(row, ev):
            dp_opp += 1
        if dp_conversion_shares(row, ev):
            dp_conv += 1

        # arm expectation fixture: extra advancement on hits to OF zones
        if ev.event_type in ("SINGLE", "DOUBLE") and ev.hit_zone:
            zone = ev.hit_zone[0]
            if zone in (7, 8, 9):
                base_adv = 1 if ev.event_type == "SINGLE" else 2
                for mv in ev.movements:
                    if mv.out or mv.frm == 0:
                        continue
                    adv_opp[(ev.event_type, zone)] += 1
                    extra = (mv.to - mv.frm) - base_adv
                    if extra > 0:
                        adv_extra[(ev.event_type, zone)] += 1

    fx["league_xout_by_bb"] = {k: xout_sum[k] / xout_n[k] for k in xout_n}
    fx["league_xout_all"] = (sum(xout_sum.values()) / sum(xout_n.values())) if xout_n else 0.70
    fx["dp_opp_n"] = dp_opp
    fx["dp_conv_n"] = dp_conv
    fx["dp_rate"] = dp_conv / dp_opp if dp_opp else 0.10
    fx["sb_success_rate"] = sb / sba if sba else 0.72
    fx["cs_rate"] = 1.0 - fx["sb_success_rate"]
    fx["extra_adv_rate"] = {f"{ht}_{z}": (adv_extra[(ht, z)] / adv_opp[(ht, z)])
                            for (ht, z) in adv_opp}
    fx["extra_adv_default"] = 0.28
    fx["bunt_out_rate"] = bunt_out / bunt_n if bunt_n else 0.75
    if fx["n_pa_events"] < 2000:
        fx["fixture_quality"] = "THIN"
    if out_path:
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "w") as fh:
            json.dump(fx, fh, indent=2)
    return fx
