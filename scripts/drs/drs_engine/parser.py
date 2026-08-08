"""
RSTR IQ dRS Engine :: atbatDesc grammar parser (Spec Section 3)

Parses TruMedia retrosheet-style event strings into structured events.
Anything that fails to parse raises ParseError and must be routed to the
exceptions log by the caller. Nothing is silently dropped.
"""
from __future__ import annotations   # 3.9-compatible: annotations stay unevaluated
import re
from dataclasses import dataclass, field

class ParseError(Exception):
    pass

BASE_MAP = {"B": 0, "1": 1, "2": 2, "3": 3, "H": 4}

@dataclass
class Movement:
    frm: int              # 0=batter/B, 1,2,3
    to: int               # 1,2,3, 4=H
    out: bool             # X = out on the bases
    chain: list = field(default_factory=list)   # putout chain in parens
    error_fielder: int | None = None            # E{n} inside parens
    unearned: bool = False                       # (UR)/(TUR) → this run is UNEARNED (for ERA)

@dataclass
class ParsedEvent:
    raw: str
    event_type: str                 # OUT | SINGLE | DOUBLE | TRIPLE | HR | ERROR | FC | K | OTHER
    tally_chains: list = field(default_factory=list)  # extra putout chains (dropped K3, CS on K)
    putout_chain: list = field(default_factory=list)
    bb_type: str | None = None      # G | F | L | P (from modifiers)
    is_bunt: bool = False
    is_dp: bool = False
    dp_kind: str | None = None      # GDP | LDP
    is_sf: bool = False
    is_sh: bool = False
    is_walk: bool = False           # W/IW (event_type stays OTHER; for BB/OBP accrual)
    is_ibb: bool = False            # IW (intentional walk)
    is_hbp: bool = False            # HP/HBP
    is_ci: bool = False             # CI catcher's interference (reaches base, NOT an AB)
    is_pa: bool = True              # False for baserunning-only rows (CS/PO/pickoff) — not a plate appearance
    concurrent: list = field(default_factory=list)  # +WP/+PB/+SB#/+CS# events sharing the pitch
    hit_zone: list = field(default_factory=list)   # fielder zone digits on hits
    error_fielder: int | None = None
    fc_fielder: int | None = None
    movements: list = field(default_factory=list)  # list[Movement]

HIT_TYPES = {"S": "SINGLE", "D": "DOUBLE", "T": "TRIPLE", "HR": "HR"}
BB_MODS = {"G": "G", "F": "F", "L": "L", "P": "P"}

_MOVE_RE = re.compile(r"^([B123])([\-X])([123H])(?:\((.*?)\))?$")

def _parse_movement(tok: str) -> Movement:
    m = _MOVE_RE.match(tok.strip())
    if not m:
        raise ParseError(f"bad movement token: {tok!r}")
    frm, sep, to, paren = m.groups()
    chain, err, unearned = [], None, False
    if paren:
        em = re.match(r"^E(\d)$", paren)
        if em:
            err = int(em.group(1))
        elif re.match(r"^\d+$", paren):
            chain = [int(c) for c in paren]
        elif re.match(r"^\d*(UR|TUR|NR|RBI)$", paren):
            # scoring annotations, no defensive content. UR/TUR = unearned run (for ERA).
            # allow a leading count: (2RBI), (3RBI) multi-run scoring on the same movement.
            unearned = ("UR" in paren)
        else:
            # mixed content like 64E3 (future vocab) -> pull digits+error
            em2 = re.search(r"E(\d)", paren)
            if em2:
                err = int(em2.group(1))
                chain = [int(c) for c in re.sub(r"E\d", "", paren) if c.isdigit()]
            else:
                raise ParseError(f"bad movement paren: {paren!r} in {tok!r}")
    return Movement(frm=BASE_MAP[frm], to=BASE_MAP[to], out=(sep == "X"),
                    chain=chain, error_fielder=err, unearned=unearned)

def _strip_parens(tok: str) -> str:
    """Remove (RBI), (2RBI) style annotations from an event token."""
    return re.sub(r"\(.*?\)", "", tok)

def parse_atbat_desc(desc: str) -> ParsedEvent:
    if not desc or desc.strip() in ("", "-"):
        raise ParseError("empty atbatDesc")
    desc = desc.strip()
    # split event section from baserunner block on FIRST period
    if "." in desc:
        event_sec, runner_sec = desc.split(".", 1)
    else:
        event_sec, runner_sec = desc, ""

    ev = ParsedEvent(raw=desc, event_type="OTHER")

    # movements
    if runner_sec:
        for tok in runner_sec.split(";"):
            if tok.strip():
                ev.movements.append(_parse_movement(tok))

    toks = event_sec.split("/")
    main = _strip_parens(toks[0]).strip()
    mods = [t.strip() for t in toks[1:]]

    # ---- compound events joined by '+': base event + concurrent baserunner events ----
    # e.g. W+WP (walk + wild pitch), W+SB2, K+WP, K+PB. The BASE carries the batter result;
    # the tail (WP/PB/SB#/CS#/DI/OA) is a same-pitch baserunner event with no batter effect.
    # (Errors like E4/TH keep their '+'-free main; the '+' split only applies to letter events.)
    if "+" in main and not re.match(r"^E\d", main):
        parts = main.split("+")
        main = parts[0]
        ev.concurrent = parts[1:]

    # ---- main event ----
    if re.match(r"^\d+$", main):                       # out chain: 8, 63, 463
        ev.event_type = "OUT"
        ev.putout_chain = [int(c) for c in main]
    elif main in HIT_TYPES:
        ev.event_type = HIT_TYPES[main]
    elif main == "HR":
        ev.event_type = "HR"
    elif re.match(r"^E\d$", main):                     # E3 reached on error
        ev.event_type = "ERROR"
        ev.error_fielder = int(main[1])
    elif re.match(r"^FC\d?$", main):                   # FC6 or bare FC
        ev.event_type = "FC"
        if len(main) > 2:
            ev.fc_fielder = int(main[2])
    elif main == "K":
        ev.event_type = "K"                            # strikeout; mods may carry chains
    elif main in ("W", "IW", "HP", "HBP"):
        ev.event_type = "OTHER"                        # handled upstream of BIP engine
        if main in ("W", "IW"):
            ev.is_walk = True
            ev.is_ibb = (main == "IW")
        else:
            ev.is_hbp = True
    elif main in ("CI", "CINT"):                        # catcher's interference: reaches 1B, NOT an AB
        ev.event_type = "OTHER"
        ev.is_ci = True
    elif re.match(r"^(CS|PO|POCS)[H123]?$", main):      # caught stealing / pickoff = baserunning out,
        ev.event_type = "OUT"                           # NOT a batter plate appearance
        ev.is_pa = False
    else:
        raise ParseError(f"unknown main event token: {main!r}")

    # ---- modifiers ----
    for mod_raw in mods:
        # K-event modifiers: S (swinging), C (called), S(23) dropped 3rd strike,
        # compound S+SB2, S+CS2(26). Chains in parens are extra putout tallies.
        if ev.event_type == "K":
            for part in mod_raw.split("+"):
                pm = re.match(r"^(S|C|SB\d|CS\d|WP|PB|DI|OA|TH)(?:\((\d+)\))?$", part.strip())
                if not pm:
                    raise ParseError(f"unknown K modifier: {mod_raw!r}")
                if pm.group(2):
                    ev.tally_chains.append([int(c) for c in pm.group(2)])
            continue
        mod = _strip_parens(mod_raw).strip()
        if not mod:
            continue
        if mod == "PF":                                # foul pop out
            ev.bb_type = "P"
            continue
        if mod == "TH":                                # throwing-error indicator (E5/TH) — no BIP content
            continue
        if mod in ("BATINT", "CINT", "RINT"):          # interference outs — batter is already out
            continue
        if mod == "FDP":                               # foul(-ball) double play
            ev.is_dp = True
            ev.dp_kind = ev.dp_kind or "GDP"
            continue
        bm = re.match(r"^B(\d+)$", mod)               # bunt + zone: S/B1
        if bm:
            ev.is_bunt = True
            ev.hit_zone = [int(c) for c in bm.group(1)]
            continue
        if mod in BB_MODS:
            ev.bb_type = BB_MODS[mod]
        elif mod == "B":
            ev.is_bunt = True
        elif mod in ("GDP", "LDP"):
            ev.is_dp = True
            ev.dp_kind = mod
            ev.bb_type = ev.bb_type or ("G" if mod == "GDP" else "L")
        elif mod == "SF":
            ev.is_sf = True
            ev.bb_type = ev.bb_type or "F"
        elif mod == "SH":
            ev.is_sh = True
        elif re.match(r"^\d+$", mod):                  # hit zone digits: S/7, D/78
            ev.hit_zone = [int(c) for c in mod]
        else:
            raise ParseError(f"unknown modifier: {mod_raw!r}")

    # pull embedded movement errors up if main event has none (FC.1-2(E3) case)
    if ev.error_fielder is None:
        for mv in ev.movements:
            if mv.error_fielder is not None:
                ev.error_fielder = mv.error_fielder
                break

    return ev

def outs_recorded(ev: ParsedEvent) -> int:
    """Total outs the defense recorded on this play (batter + bases)."""
    n = 0
    if ev.event_type == "OUT":
        n += 2 if ev.is_dp else 1
        # DP strings encode the second out either in the chain or a movement X;
        # avoid double counting: count movement outs not already implied
        mv_outs = sum(1 for m in ev.movements if m.out)
        if ev.is_dp:
            n = 1 + max(1, mv_outs)  # batter (or lined batter) + base outs
        else:
            n += mv_outs
    elif ev.event_type == "FC":
        n += sum(1 for m in ev.movements if m.out)
    else:
        n += sum(1 for m in ev.movements if m.out)
    return n
