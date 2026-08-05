"""
RSTR IQ :: baserunning runs (wSB) — component ONE of offensive baserunning value.

Lives on the OFFENSIVE side of WAR (joins oWAR), NOT the dRS engine, but reuses the
dRS machinery: the RE24 matrix (state-specific event pricing) + the season fixtures
pattern. Attributed to the RUNNER by name.

Signal (per pitch, from the Standard export):
  - ManOnFirst/Second/Third  = runner NAMES (occupied when non-empty)
  - ManOn1st/2nd/3rd         = occupancy flags
  - SBA2/SB2, SBA3/SB3       = steal attempt / success of 2nd / 3rd
  - battingTeam(Id)          = the runner's org
An OPPORTUNITY is a real base-out state (runner on the base, next base open) — counted
from actual state, never approximated (no FanGraphs singles+walks proxy).

Pricing (state-specific from the matrix, flat constants as fallbacks — parallel to kills):
  - SB success = RE(after runner advances) - RE(before), same outs           (fallback +RUNS_SB_COST)
  - CS         = RE(runner erased, +1 out) - RE(before)                        (fallback -RUNS_CS)

wSB = (runner's priced outcomes) - (league attempt-rate x outcome-mix, priced per state,
over HIS opportunities). Nets to ~0 league-wide by construction; asserted by the runner.

Deferred (design note): pickoffs (PickAttBase/PO grammar) and full UBR from movement
blocks (1st->3rd, scoring from 2nd, outs on bases) — identical matrix pricing. Steals first.
"""
from __future__ import annotations
import re
from collections import defaultdict
from dataclasses import dataclass
from . import constants as C

# Pickoff tokens in atbatDesc: standalone "PO1(2)" or K-compound "K/S+PO1(23)".
# group(1) = the base the runner was picked off (1/2/3).
_PO_RE = re.compile(r"\bPO(\d)")

def _po_bases(atbat_desc):
    """Set of bases a runner was picked off on this pitch (usually one, rarely empty)."""
    return {int(m.group(1)) for m in _PO_RE.finditer(atbat_desc or "")
            if m.group(1) in ("1", "2", "3")}

@dataclass
class BRAcc:
    opportunities: float = 0.0
    sb: int = 0
    cs: int = 0
    po: int = 0
    wsb_runs: float = 0.0
    games: set = None
    def __post_init__(self):
        if self.games is None:
            self.games = set()

def _occ(v):
    return v not in (None, "", "-")

class BaserunningEngine:
    def __init__(self, re24=None, fixtures=None):
        self.re24 = re24 or {}
        self.fx = fixtures or {}
        self.acc = defaultdict(BRAcc)   # key: (org_id, runner_name)

    # ---- RE24 lookups (mirror the dRS engine; None -> flat fallback) ----
    def _re(self, o1, o2, o3, outs):
        if outs >= 3:
            return 0.0
        if not self.re24:
            return None
        return self.re24.get(("1" if o1 else "_") + ("2" if o2 else "_")
                             + ("3" if o3 else "_") + str(outs))

    def _sb_value(self, o1, o2, o3, outs, target):
        """Runner value of a successful steal of `target` (2 or 3). Positive."""
        if target == 2:
            after = self._re(False, True, o3, outs)      # 1st->2nd
        else:
            after = self._re(o1, False, True, outs)      # 2nd->3rd
        before = self._re(o1, o2, o3, outs)
        if after is None or before is None:
            return C.RUNS_SB_COST                        # flat fallback (gain magnitude)
        return after - before

    def _cs_value(self, o1, o2, o3, outs, target):
        """Runner value of a caught stealing of `target`. Negative (runner erased + out)."""
        if target == 2:
            after = self._re(False, o2, o3, outs + 1)    # runner off 1st, +1 out
        else:
            after = self._re(o1, False, o3, outs + 1)    # runner off 2nd, +1 out
        before = self._re(o1, o2, o3, outs)
        if after is None or before is None:
            return -C.RUNS_CS                            # flat fallback (cost magnitude)
        return after - before

    def _po_value(self, o1, o2, o3, outs, base):
        """Runner value of being PICKED OFF `base` (1/2/3): runner erased + an out, priced
        off the base-out state — same shape as a caught stealing at that base. Negative."""
        if base == 1:   after = self._re(False, o2, o3, outs + 1)
        elif base == 2: after = self._re(o1, False, o3, outs + 1)
        else:           after = self._re(o1, o2, False, outs + 1)
        before = self._re(o1, o2, o3, outs)
        if after is None or before is None:
            return -C.RUNS_CS                            # flat fallback (CS-magnitude)
        return after - before

    def _outcome_value(self, r, o1, o2, o3, outs, target, att_col, succ_col):
        """Realized runner value on ONE opportunity: 0 if no attempt, +SB or CS value if
        attempted. Used for BOTH the league baseline and the runner's actual."""
        if str(r.get(att_col, "")).strip() != "1":
            return 0.0, None
        if str(r.get(succ_col, "")).strip() == "1":
            return self._sb_value(o1, o2, o3, outs, target), "SB"
        return self._cs_value(o1, o2, o3, outs, target), "CS"

    # ---- league fixtures: EMPIRICAL mean value per opportunity, keyed by base-out
    # state + target. Subtracting this per-opportunity forces EXACT zero-sum per state
    # (Sigma actual - n*mean = 0), so attempt-timing selection can't leave a residual. ----
    _COLS = {2: ("SBA2", "SB2"), 3: ("SBA3", "SB3")}

    def derive_fixtures(self, rows):
        vsum = defaultdict(float); vn = defaultdict(int); att = {2: 0, 3: 0}; succ = {2: 0, 3: 0}
        # pickoff EXPOSURE baseline: every pitch a runner is on a base is a PO exposure;
        # mean realized PO value per (base, state) nets the actual pickoffs to zero.
        po_vsum = defaultdict(float); po_vn = defaultdict(int); po_n = 0
        for r in rows:
            o1, o2, o3 = _occ(r.get("ManOnFirst")), _occ(r.get("ManOnSecond")), _occ(r.get("ManOnThird"))
            try: outs = int(r.get("outs") or 0)
            except ValueError: outs = 0
            # 2nd is "open" for a steal if empty OR its occupant is themselves stealing
            # 3rd (a double steal), so the front runner isn't wrongly dropped.
            s3a = str(r.get("SBA3", "")).strip() == "1"; s3 = str(r.get("SB3", "")).strip() == "1"
            open2 = (not o2) or s3a or s3
            for target, occ in ((2, o1 and open2), (3, o2 and not o3)):
                if not occ:
                    continue
                ac, sc = self._COLS[target]
                val, kind = self._outcome_value(r, o1, o2, o3, outs, target, ac, sc)
                key = (target, o1, o2, o3, outs)
                vsum[key] += val; vn[key] += 1
                if kind:
                    att[target] += 1
                    if kind == "SB": succ[target] += 1
            picked = _po_bases(r.get("atbatDesc"))
            for base, occ in ((1, o1), (2, o2), (3, o3)):
                if not occ:
                    continue
                pv = self._po_value(o1, o2, o3, outs, base) if base in picked else 0.0
                pk = (base, o1, o2, o3, outs)
                po_vsum[pk] += pv; po_vn[pk] += 1
                if base in picked: po_n += 1
        self.fx = {"mean_value": {k: vsum[k] / vn[k] for k in vn}, "n": dict(vn),
                   "po_mean": {k: po_vsum[k] / po_vn[k] for k in po_vn}, "po_n": po_n,
                   "att": att, "succ": succ}
        return self.fx

    def _expected(self, o1, o2, o3, outs, target):
        """League baseline = empirical mean realized value per opportunity in this exact
        base-out state (falls back to 0 for an unseen state)."""
        return self.fx["mean_value"].get((target, o1, o2, o3, outs), 0.0)

    def _po_expected(self, o1, o2, o3, outs, base):
        return self.fx.get("po_mean", {}).get((base, o1, o2, o3, outs), 0.0)

    def run(self, rows):
        if not self.fx:
            self.derive_fixtures(rows)
        for r in rows:
            o1, o2, o3 = _occ(r.get("ManOnFirst")), _occ(r.get("ManOnSecond")), _occ(r.get("ManOnThird"))
            try:
                outs = int(r.get("outs") or 0)
            except ValueError:
                outs = 0
            org = r.get("battingTeamId") or r.get("battingTeam") or "?"
            gid = r.get("gameId")
            s3a = str(r.get("SBA3", "")).strip() == "1"; s3 = str(r.get("SB3", "")).strip() == "1"
            open2 = (not o2) or s3a or s3        # double-steal: 2nd vacated by its stealer
            for target, occupied, name_col, att_col, succ_col in (
                (2, o1 and open2, "ManOnFirst", "SBA2", "SB2"),
                (3, o2 and not o3, "ManOnSecond", "SBA3", "SB3")):
                if not occupied:
                    continue
                runner = (r.get(name_col) or "").strip()
                if not runner:
                    continue
                a = self.acc[(org, runner)]
                a.games.add(gid)
                a.opportunities += 1.0
                val, kind = self._outcome_value(r, o1, o2, o3, outs, target, att_col, succ_col)
                # wSB = actual value - league expectation for this exact state
                a.wsb_runs += val - self._expected(o1, o2, o3, outs, target)
                if kind == "SB": a.sb += 1
                elif kind == "CS": a.cs += 1

            # pickoff exposures: every occupied base this pitch. Net the league PO cost;
            # add the actual runner-erased value if this runner was picked off here.
            picked = _po_bases(r.get("atbatDesc"))
            for base, occ, name_col in ((1, o1, "ManOnFirst"), (2, o2, "ManOnSecond"),
                                        (3, o3, "ManOnThird")):
                if not occ:
                    continue
                runner = (r.get(name_col) or "").strip()
                if not runner:
                    continue
                a = self.acc[(org, runner)]
                a.games.add(gid)
                a.wsb_runs -= self._po_expected(o1, o2, o3, outs, base)
                if base in picked:
                    a.po += 1
                    a.wsb_runs += self._po_value(o1, o2, o3, outs, base)

    @staticmethod
    def _regress(value, n, prior):
        return value * (n / (n + prior)) if (n + prior) > 0 else 0.0

    def player_season_rows(self, season):
        out = []
        for (org, runner), a in sorted(self.acc.items()):
            out.append({
                "player": runner, "season": season, "org_id": org,
                "games": len(a.games),
                "opportunities": round(a.opportunities, 1),
                "SB": a.sb, "CS": a.cs, "PO": a.po,
                "wsb_runs": round(a.wsb_runs, 3),
                # small-sample component: regress on the same phantom-opps pattern as ThrR
                "wsb_runs_reg": round(self._regress(a.wsb_runs, a.opportunities, C.PRIOR_THROW_ATT), 3),
                "constants_version": C.CONSTANTS_VERSION,
                "engine_version": C.ENGINE_VERSION,
            })
        return out
