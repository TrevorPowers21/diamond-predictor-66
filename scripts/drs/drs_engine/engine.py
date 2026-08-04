"""
RSTR IQ dRS Engine :: event routing, credit/debit accounting, rollup
(Spec Sections 4, 6, 8, 9, 10)

Locked decisions implemented here:
  - FC is credit-only for range, never a debit.
  - Errors are max punishment: full 1.0 x RUNS_PER_PLAY + advancement beyond
    a single, stored as their own component, never blended into range.
  - Range credit goes to chain[0] (the fielder who made the play on the ball).
  - Framing is continuous off probSL. Blocking off pPBWP expectation.
  - xOut = 1 - xAVG (v1), fallback ladder per Spec 5.2.

v0.2.0 corrections (reconciliation 2026-08-03):
  #1 DP is per-fielder net accounting (chain[0]/responsibility-share opportunities
     measured against the league rate) — no hardcoded 4/6 charge, credit and
     charge land on the same fielder, and the fixture uses the SAME opportunity
     definition so the two can't diverge.
  #2 detect_pbwp guard precedence parenthesized.
  #3 unrecognized taken pitch with a probSL logs NEW_VOCAB (no silent drop).
"""
from __future__ import annotations
from collections import defaultdict
from dataclasses import dataclass, field
from . import constants as C
from .parser import parse_atbat_desc, ParseError, outs_recorded
from .normalize import (bb_type_from_result, is_pa_end, framing_class,
                        dp_opportunity_shares, dp_conversion_shares)

@dataclass
class Exception_:
    uniq_pitch_id: str
    game: str
    reason: str
    detail: str
    raw: str

@dataclass
class Acc:
    """per player-position accumulator"""
    range_runs: float = 0.0
    error_runs: float = 0.0
    dp_runs: float = 0.0
    arm_runs: float = 0.0
    framing_runs: float = 0.0
    blocking_runs: float = 0.0
    throwing_runs: float = 0.0
    bunt_runs: float = 0.0
    bip_opps: float = 0.0
    bip_tracked: float = 0.0        # range opps on TRACKED balls (real xAVG) — coverage
    range_runs_tracked: float = 0.0 # range runs from tracked balls only — projection input
    range_sub: dict = field(default_factory=lambda: {"gb": 0.0, "ld": 0.0, "fb": 0.0, "pu": 0.0})
    dp_opps: float = 0.0        # DP opportunities this fielder fielded
    dp_conv_n: float = 0.0      # DP conversions this fielder turned
    plays_made: int = 0
    errors: int = 0
    assists: int = 0
    putouts: int = 0
    taken_pitches: int = 0
    pitches_caught: int = 0
    sb_att: int = 0
    cs: int = 0
    sb_allowed: int = 0
    pop_times: list = field(default_factory=list)
    games: set = field(default_factory=set)
    half_innings: set = field(default_factory=set)

class DRSEngine:
    def __init__(self, fixtures, re24=None):
        self.fx = fixtures
        self.re24 = re24 or {}            # base-out RE matrix (state-specific advancement)
        self.acc = defaultdict(Acc)      # key: (team, player_name, position)
        self.exceptions = []
        self.expected_pbwp = defaultdict(float)   # catcher key -> sum
        self.actual_pbwp = defaultdict(int)

    # ---------- RE24 base-out lookups (state-specific advancement) ----------
    def _re(self, o1, o2, o3, outs):
        """RE of a base-out state, or None if outs>=3 (0) or no matrix (fallback)."""
        if outs >= 3:
            return 0.0
        if not self.re24:
            return None
        return self.re24.get(("1" if o1 else "_") + ("2" if o2 else "_")
                             + ("3" if o3 else "_") + str(outs))

    def _re_single(self, base, outs):
        """RE of a lone runner at `base` (1/2/3; 4=home scored=1.0); None if no matrix."""
        if base >= 4:
            return 1.0
        return self._re(base == 1, base == 2, base == 3, outs)

    def _base_value(self, std_dest, outs):
        """Base-out value of ONE extra base beyond std_dest (single-runner). Falls
        back to flat RUNS_PER_BASE if the matrix is unavailable."""
        hi = self._re_single(min(std_dest + 1, 4), outs)
        lo = self._re_single(std_dest, outs)
        return (hi - lo) if (hi is not None and lo is not None) else C.RUNS_PER_BASE

    def _kill_value(self, dest, outs):
        """Value of throwing out a runner heading to `dest`: advancement erased +
        the out recorded, base-out priced. Falls back to RUNS_OF_KILL."""
        adv = self._re_single(dest, outs)
        e0 = self._re(False, False, False, outs)
        e1 = self._re(False, False, False, outs + 1)
        if adv is None or e0 is None or e1 is None:
            return C.RUNS_OF_KILL
        return adv + (e0 - e1)

    # ---------- identity ----------
    def _fielder(self, row, pos):
        if pos == 1:
            return (row["pitchingTeam"], row.get("pitcherAbbrevName") or row.get("pitcher"))
        if pos == 2:
            return (row["catchingTeam"], row.get("catcherAbbrevName"))
        col = C.POSITION_COLS.get(pos)
        name = (row.get(col) or "").strip() if col else ""
        if not name:
            return None
        return (row["pitchingTeam"], name)

    def _key(self, row, pos):
        f = self._fielder(row, pos)
        if f is None:
            return None
        return (f[0], f[1], pos)

    def _touch(self, row, pos):
        k = self._key(row, pos)
        if k is None:
            self.exceptions.append(Exception_(row.get("uniqPitchId", "?"),
                row.get("gameString", "?"), "ALIGNMENT_GAP",
                f"no fielder at position {pos}", row.get("atbatDesc", "")))
            return None
        a = self.acc[k]
        a.games.add(row["gameId"])
        a.half_innings.add((row["gameId"], row["inn"]))
        return a

    # ---------- xOut (Spec 5) ----------
    def _xout(self, row, ev):
        if row["_xAVG"] is not None:
            return 1.0 - row["_xAVG"], "XAVG"
        bb = ev.bb_type or bb_type_from_result(row.get("pitchResult"))
        if bb and bb in self.fx["league_xout_by_bb"]:
            return self.fx["league_xout_by_bb"][bb], "LEAGUE_BB"
        return self.fx["league_xout_all"], "LEAGUE_ALL"

    # ---------- per-pitch engines (framing, blocking, throwing) ----------
    def _per_pitch(self, row):
        ck = self._key(row, 2)
        if ck is None:
            return
        a = self.acc[ck]
        a.games.add(row["gameId"]); a.half_innings.add((row["gameId"], row["inn"]))
        a.pitches_caught += 1
        pr = row.get("pitchResult")
        p = row["_probSL"]
        cls = framing_class(pr)
        if p is not None:
            if cls == "STRIKE":
                a.framing_runs += (1.0 - p) * C.RUNS_PER_STRIKE
                a.taken_pitches += 1
            elif cls == "BALL":
                a.framing_runs -= p * C.RUNS_PER_STRIKE
                a.taken_pitches += 1
            elif cls == "UNKNOWN":
                # Fix #3: never silently drop a pitch the framing model doesn't
                # recognize — surface it for the weekly vocab review.
                self.exceptions.append(Exception_(row.get("uniqPitchId", "?"),
                    row.get("gameString", "?"), "NEW_VOCAB",
                    f"unrecognized pitchResult {pr!r} with probSL", pr or ""))
        if row["_pPBWP"] is not None:
            self.expected_pbwp[ck] += row["_pPBWP"]
        # throwing ledger
        att = sum(str(row.get(f, "")).strip() == "1" for f in ("SBA2", "SBA3"))
        stl = sum(str(row.get(f, "")).strip() == "1" for f in ("SB2", "SB3"))
        if att:
            a.sb_att += att
            a.sb_allowed += stl
            a.cs += att - stl
            pt = row.get("PopTime")
            if pt not in (None, "", "-"):
                try: a.pop_times.append(float(pt))
                except ValueError: pass

    def detect_pbwp(self, rows):
        """
        Heuristic WP/PB detection (open item 4 workaround): runner advancement
        between consecutive pitches of the SAME at-bat with no steal flag and
        no PA-ending event on the earlier pitch. Balks confound; flagged THIN.
        """
        prev = None
        for row in rows:
            if prev is not None and \
               prev["gameId"] == row["gameId"] and prev["inn"] == row["inn"] and \
               prev.get("abNumInGame") == row.get("abNumInGame") and not is_pa_end(prev):
                stolen = any(str(prev.get(f, "")).strip() == "1"
                             for f in ("SBA2", "SBA3", "SB2", "SB3"))
                if not stolen:
                    def bases(r):
                        return tuple(bool((r.get(c) or "").strip())
                                     for c in ("ManOnFirst", "ManOnSecond", "ManOnThird"))
                    b0, b1 = bases(prev), bases(row)
                    # Fix #2: the OR must be grouped so the base-state guards
                    # apply to BOTH advancement branches:
                    #   A and B and (C or D)   not   (A and B and C) or D
                    if b0 != b1 and sum(b1) <= sum(b0) and \
                       ((b1[1] and not b0[1] and b0[0]) or (b1[2] and not b0[2] and b0[1])):
                        ck = self._key(prev, 2)
                        if ck:
                            self.actual_pbwp[ck] += 1
            prev = row

    # ---------- BIP engine ----------
    @staticmethod
    def _la_class(la):
        """Statcast batted-ball class: GB<10, LD 10-25, FB 25-50, PU>50 (None if no LA)."""
        if la is None: return None
        if la < 10: return "gb"
        if la < 25: return "ld"
        if la < 50: return "fb"
        return "pu"

    @staticmethod
    def _responsible_fielder(la, spray):
        """The fielder who actually had the play, by trajectory + spray (calibrated from
        outs). Ground balls -> the INFIELD spray lane (never an OF); air balls -> the OF
        lane. Retrieval zone is ignored. None if trajectory unknown."""
        if la is None or spray is None:
            return None
        if la < 10:                       # ground ball -> infield lane
            if spray < -22: return 5      # 3B
            if spray < 2:   return 6      # SS
            if spray < 30:  return 4      # 2B
            return 3                      # 1B
        if spray < -14: return 7          # LF
        if spray < 14:  return 8          # CF
        return 9                          # RF

    def _range_credit(self, row, pos, xout, tracked):
        a = self._touch(row, pos)
        if a is None: return
        v = (1.0 - xout) * C.RUNS_PER_PLAY
        a.range_runs += v
        cls = self._la_class(row["_LA"])
        if cls: a.range_sub[cls] += v
        a.plays_made += 1
        a.bip_opps += 1.0
        if tracked:                       # real xAVG — counts toward the unbiased read
            a.range_runs_tracked += v
            a.bip_tracked += 1.0

    def _range_debit(self, row, ev, xout, tracked):
        """Debit the fielder who had the play (trajectory+spray), NOT the retriever zone.
        Ground-ball hits charge the infield lane; air-ball hits charge the OF lane. No
        catchability floor — every attributed ball debits at xOut scale (preserves the
        credit/debit zero-sum). Untracked balls (no LA/spray) fall back to the hit_zone."""
        fielder = self._responsible_fielder(row["_LA"], row["_spray"])
        if fielder is None:
            zones = ev.hit_zone           # no trajectory -> retriever fallback (coverage-flagged)
            if not zones: return
            share = 1.0 / len(zones)
            for z in zones:
                a = self._touch(row, z)
                if a is None: continue
                v = share * xout * C.RUNS_PER_PLAY
                a.range_runs -= v; a.bip_opps += share
                if tracked: a.range_runs_tracked -= v; a.bip_tracked += share
            return
        a = self._touch(row, fielder)
        if a is None: return
        v = xout * C.RUNS_PER_PLAY
        a.range_runs -= v
        cls = self._la_class(row["_LA"])
        if cls: a.range_sub[cls] -= v
        a.bip_opps += 1.0
        if tracked:
            a.range_runs_tracked -= v
            a.bip_tracked += 1.0

    def _credit_chain_tallies(self, row, chain):
        if not chain: return
        for pos in chain[:-1]:
            a = self._touch(row, pos)
            if a: a.assists += 1
        a = self._touch(row, chain[-1])
        if a: a.putouts += 1

    def _error_debit(self, row, fielder, ev, outs_made):
        a = self._touch(row, fielder)
        if a is None: return
        a.errors += 1
        # Base: "a sure out that became a SINGLE" (only when no out was recorded).
        # RUNS_PER_SINGLE, not the S/D/T blend, so the extra-base damage isn't
        # double-counted against the explicit advancement charge below.
        a.error_runs -= C.RUNS_PER_SINGLE if outs_made == 0 else 0.0
        a.error_runs -= self._error_extra(row, ev, outs_made)
        a.bip_opps += 1.0

    def _error_extra(self, row, ev, outs_made):
        """F1 advancement charge: runner movement BEYOND a standard single, priced by
        the full base-out RE delta (actual state vs a standard-single counterfactual).
        Only the clean ROE case (no out recorded, matrix present, unambiguous
        reconstruction) is state-priced; everything else falls back to flat
        RUNS_PER_BASE per extra base. Never credits an error (clamped >= 0)."""
        def flat():
            extra = 0
            for mv in ev.movements:
                if mv.out or mv.frm == 0:
                    continue
                extra += max(0, (mv.to - mv.frm) - 1)
            return extra * C.RUNS_PER_BASE
        if outs_made != 0 or not self.re24:
            return flat()
        o = min(2, row["_outs"])
        b1 = bool((row.get("ManOnFirst") or "").strip())
        b2 = bool((row.get("ManOnSecond") or "").strip())
        b3 = bool((row.get("ManOnThird") or "").strip())
        # counterfactual standard single: batter->1st, each runner +1 base (3rd scores)
        cf = self._re(True, b1, b2, o)
        cf_runs = 1 if b3 else 0
        # actual state after the error, reconstructed from the movement block
        occ = {1: b1, 2: b2, 3: b3}
        runs_actual = 0
        batter_placed = False
        for mv in ev.movements:
            if mv.frm == 0:
                batter_placed = True
                if mv.out: pass
                elif mv.to == 4: runs_actual += 1
                else: occ[mv.to] = True
            else:
                occ[mv.frm] = False
                if mv.out: pass
                elif mv.to == 4: runs_actual += 1
                else: occ[mv.to] = True
        if not batter_placed:
            if occ[1]:                        # 1st still occupied but batter must reach it
                return flat()                 # ambiguous forced-runner reconstruction
            occ[1] = True
        act = self._re(occ[1], occ[2], occ[3], o)
        if act is None or cf is None:
            return flat()
        return max(0.0, (act + runs_actual) - (cf + cf_runs))

    def _dp_accumulate(self, row, ev):
        """Fix #1: per-fielder DP opportunity + conversion accounting. Uses the
        shared shares helpers (identical to the fixture derivation) so the
        opportunity denominators can never diverge. dp_runs is finalized against
        the league rate in run()."""
        for pos, share in dp_opportunity_shares(row, ev):
            a = self._touch(row, pos)
            if a: a.dp_opps += share
        for pos, share in dp_conversion_shares(row, ev):
            a = self._touch(row, pos)
            if a: a.dp_conv_n += share

    def _arm(self, row, ev):
        if not ev.hit_zone or ev.hit_zone[0] not in (7, 8, 9):
            return
        zone = ev.hit_zone[0]
        base_adv = {"SINGLE": 1, "DOUBLE": 2}.get(ev.event_type)
        if base_adv is None:
            return
        exp_rate = self.fx["extra_adv_rate"].get(f"{ev.event_type}_{zone}",
                                                 self.fx["extra_adv_default"])
        o = min(2, row["_outs"])
        a = self._touch(row, zone)
        if a is None: return
        for mv in ev.movements:
            if mv.frm == 0:
                continue
            if mv.out and mv.chain and mv.chain[0] in (7, 8, 9):
                # kill: matrix-priced (advancement erased + the out), state-sensitive
                killer = self._touch(row, mv.chain[0])
                if killer:
                    killer.arm_runs += self._kill_value(mv.to, o)
                self._credit_chain_tallies(row, mv.chain)
                continue
            if mv.out:
                continue
            # hold vs advance: value the ONE extra base at its base-out RE delta (A)
            std_dest = mv.frm + base_adv
            actual = 1.0 if (mv.to - mv.frm) - base_adv > 0 else 0.0
            a.arm_runs += (exp_rate - actual) * self._base_value(std_dest, o)

    def _bunt(self, row, ev):
        rate = self.fx["bunt_out_rate"]
        if ev.event_type == "OUT" and ev.putout_chain:
            a = self._touch(row, ev.putout_chain[0])
            if a:
                a.bunt_runs += (1.0 - rate) * C.RUNS_PER_PLAY * 0.5
        elif ev.event_type in ("SINGLE", "DOUBLE"):
            zones = ev.hit_zone or [1]
            share = rate * C.RUNS_PER_PLAY * 0.5 / len(zones)
            for z in zones:
                a = self._touch(row, z)
                if a:
                    a.bunt_runs -= share

    # ---------- event routing (Spec Section 4) ----------
    def _route(self, row, ev):
        zones_for_debit = ev.hit_zone
        xout, xout_src = self._xout(row, ev)
        tracked = (xout_src == "XAVG")   # real xAVG vs league fallback (coverage)
        if xout_src != "XAVG" and ev.event_type in ("OUT", "SINGLE", "DOUBLE",
                                                    "TRIPLE", "ERROR", "FC"):
            self.exceptions.append(Exception_(row.get("uniqPitchId", "?"),
                row.get("gameString", "?"), "PARTIAL_TRACKING",
                f"xOut fallback {xout_src}", ev.raw))

        # type mismatch check (TruMedia label vs modifier)
        bb_tm = bb_type_from_result(row.get("pitchResult"))
        if bb_tm and ev.bb_type and bb_tm != ev.bb_type and not ev.is_dp:
            self.exceptions.append(Exception_(row.get("uniqPitchId", "?"),
                row.get("gameString", "?"), "TYPE_MISMATCH",
                f"pitchResult={bb_tm} atbatDesc={ev.bb_type}", ev.raw))

        if ev.is_bunt:
            self._bunt(row, ev)
            return

        # Fix #1: DP accounting is per-fielder now, driven by the shared
        # opportunity/conversion helpers — no hardcoded 4/6 charge.
        self._dp_accumulate(row, ev)

        if ev.event_type == "OUT":
            if ev.putout_chain:
                self._range_credit(row, ev.putout_chain[0], xout, tracked)
                self._credit_chain_tallies(row, ev.putout_chain)
            for mv in ev.movements:
                if mv.out and mv.chain:
                    self._credit_chain_tallies(row, mv.chain)
            if ev.error_fielder is not None:
                self._error_debit(row, ev.error_fielder, ev,
                                  outs_made=1)  # out stood, advancement-only debit

        elif ev.event_type in ("SINGLE", "DOUBLE", "TRIPLE"):
            self._range_debit(row, ev, xout, tracked)
            self._arm(row, ev)

        elif ev.event_type == "HR":
            pass  # out of play, no defensive accountability in v1

        elif ev.event_type == "ERROR":
            self._error_debit(row, ev.error_fielder, ev, outs_made=0)

        elif ev.event_type == "FC":
            # LOCKED: credit-only. Fielder converted an out somewhere.
            n_outs = outs_recorded(ev)
            if ev.fc_fielder is not None and n_outs > 0:
                self._range_credit(row, ev.fc_fielder, xout, tracked)
                for mv in ev.movements:
                    if mv.out and mv.chain:
                        self._credit_chain_tallies(row, mv.chain)
            if ev.error_fielder is not None and n_outs == 0:
                self._error_debit(row, ev.error_fielder, ev, outs_made=0)

    # ---------- main loop ----------
    def run(self, rows):
        self.detect_pbwp(rows)
        for row in rows:
            self._per_pitch(row)
            if not is_pa_end(row):
                continue
            desc = row["atbatDesc"].strip()
            try:
                ev = parse_atbat_desc(desc)
            except ParseError as e:
                reason = "NEW_VOCAB" if "unknown" in str(e) else "PARSE_FAIL"
                self.exceptions.append(Exception_(row.get("uniqPitchId", "?"),
                    row.get("gameString", "?"), reason, str(e), desc))
                continue
            if ev.event_type == "K":
                for chain in ev.tally_chains:
                    self._credit_chain_tallies(row, chain)
                continue
            if ev.event_type == "OTHER":
                for mv in ev.movements:            # e.g. runner thrown out on a walk
                    if mv.out and mv.chain:
                        self._credit_chain_tallies(row, mv.chain)
                continue
            self._route(row, ev)

        # finalize blocking (league-centered so weak WP/PB detection cannot
        # inflate every catcher: the league gap per pitch is subtracted out)
        tot_exp = sum(self.expected_pbwp.values())
        tot_act = sum(self.actual_pbwp.values())
        tot_pitches = sum(self.acc[ck].pitches_caught for ck in self.expected_pbwp) or 1
        league_gap = (tot_exp - tot_act) / tot_pitches
        for ck, exp in self.expected_pbwp.items():
            a = self.acc[ck]
            raw_gap = exp - self.actual_pbwp.get(ck, 0)
            a.blocking_runs = (raw_gap - league_gap * a.pitches_caught) * C.RUNS_PER_PBWP

        # finalize throwing
        cs_rate = self.fx["cs_rate"]
        sb_rate = self.fx["sb_success_rate"]
        for k, a in self.acc.items():
            if k[2] == 2 and a.sb_att:
                a.throwing_runs = ((a.cs - cs_rate * a.sb_att) * C.RUNS_CS
                                   - (a.sb_allowed - sb_rate * a.sb_att) * C.RUNS_SB_COST)

        # finalize DP (Fix #1): per-fielder net vs league rate. Nets to zero
        # league-wide by construction; credit and charge land on the same person.
        dp_rate = self.fx["dp_rate"]
        for k, a in self.acc.items():
            a.dp_runs = (a.dp_conv_n - dp_rate * a.dp_opps) * C.RUNS_PER_DP

    # ---------- rollup (Spec Sections 8, 9) ----------
    @staticmethod
    def _regress(value, n, prior):
        return value * (n / (n + prior)) if (n + prior) > 0 else 0.0

    def player_season_rows(self, season):
        out = []
        for (team, name, pos), a in sorted(self.acc.items()):
            total = (a.range_runs + a.error_runs + a.dp_runs + a.arm_runs +
                     a.framing_runs + a.blocking_runs + a.throwing_runs + a.bunt_runs)
            floor = (self._regress(a.range_runs, a.bip_opps, C.PRIOR_RANGE_OPPS)
                     + self._regress(a.error_runs, a.bip_opps, C.PRIOR_ERROR_OPPS)
                     + self._regress(a.dp_runs, a.dp_opps, C.PRIOR_DP_OPPS)
                     + self._regress(a.arm_runs, a.bip_opps, C.PRIOR_ARM_OPPS)
                     + self._regress(a.framing_runs, a.taken_pitches, C.PRIOR_FRAME_TAKEN)
                     + self._regress(a.blocking_runs, a.pitches_caught, C.PRIOR_BLOCK_PITCHES)
                     + self._regress(a.throwing_runs, a.sb_att, C.PRIOR_THROW_ATT)
                     + self._regress(a.bunt_runs, a.bip_opps, C.PRIOR_BUNT_OPPS))
            out.append({
                "team": team, "player": name, "season": season,
                "position": C.POSITION_NAMES.get(pos, pos),
                "games": len(a.games),
                "half_innings": len(a.half_innings),
                "bip_opportunities": round(a.bip_opps, 2),
                "range_runs": round(a.range_runs, 3),
                "range_gb": round(a.range_sub["gb"], 3),
                "range_ld": round(a.range_sub["ld"], 3),   # noisy bucket — regress hardest
                "range_fb": round(a.range_sub["fb"], 3),
                "error_runs": round(a.error_runs, 3),
                "dp_runs": round(a.dp_runs, 3),
                "arm_runs": round(a.arm_runs, 3),
                "framing_runs": round(a.framing_runs, 3),
                "blocking_runs": round(a.blocking_runs, 3),
                "throwing_runs": round(a.throwing_runs, 3),
                "bunt_runs": round(a.bunt_runs, 3),
                "drs_total": round(total, 3),
                "drs_floor": round(floor, 3),
                "drs_ceiling": round(total, 3),
                # coverage disclosure (venue xAVG gaps): the diluted total above is the
                # honest record; range_runs_tracked / bip_tracked is the unbiased skill
                # read for projection. range_flag warns when the total is COMPRESSED
                # toward average (not merely uncertain) by untracked-park balls.
                "bip_tracked": round(a.bip_tracked, 1),
                "range_runs_tracked": round(a.range_runs_tracked, 3),
                "tracking_coverage": round(a.bip_tracked / a.bip_opps, 3) if a.bip_opps else None,
                "range_flag": ("compressed_to_avg" if a.bip_opps and a.bip_tracked / a.bip_opps < 0.60
                               else "ok" if a.bip_opps else None),
                "plays_made": a.plays_made,
                "errors": a.errors,
                "assists": a.assists,
                "putouts": a.putouts,
                "pop_time_avg": round(sum(a.pop_times) / len(a.pop_times), 2)
                                 if a.pop_times else None,
                "constants_version": C.CONSTANTS_VERSION,
                "engine_version": C.ENGINE_VERSION,
            })
        return out
