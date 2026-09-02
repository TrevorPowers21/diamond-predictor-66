# D1 dRS Run-Value Constants — D1_2026_v1

Derived from the **2026 D1 regular season** (postseason excluded per Option A, cutoff
2026-05-18) via empirical linear weights off the D1 RE24 matrix.
Scripts: `scripts/drs/derive_re24.py` (RE24) + `derive_constants.py` (constants).
Replaces `PLACEHOLDER_MLB_v0`. Sample: 8,102 games, 605,727 PAs in complete half-innings.

## The constants

| Constant | Value | Meaning | Derivation |
|---|---|---|---|
| `RUNS_PER_PLAY` | 1.045 | hit vs out on a BIP (Range/Error scale) | mean RV(hit S/D/T) 0.673 − mean RV(BIP out) −0.372 |
| `RUNS_PER_SINGLE` | 0.964 | **error-debit base only** | RV(single) 0.592 − RV(out) −0.372 |
| `RUNS_PER_DP` | 0.771 | turning two vs one | RV(out in DP state) −0.379 − RV(GDP) −1.149 |
| `RUNS_PER_BASE` | 0.184 | a base of advancement (**fallback only**) | freq-weighted 1B→2B & 2B→3B RE24 deltas |
| `RUNS_PER_STRIKE` | 0.225 | called strike (framing) | count run-value swing, IBB-clean walk terminal |
| `RUNS_PER_PBWP` | 0.320 | passed ball / wild pitch (blocking) | advance-all-runners-one-base, occupied-weighted |
| `RUNS_CS` | 0.583 | caught stealing | erase runner on 1st + add an out |
| `RUNS_SB_COST` | 0.175 | stolen base allowed | runner 1B→2B RE24 delta |
| `RUNS_OF_KILL` | 0.86 | OF assist (out + erased advance) | **ESTIMATE — not yet derived; scaled from RUNS_CS. TODO.** |

## Run environment
D1 2026 = **6.54 R/team/game** (105,473 runs ÷ 16,121 team-games), ~**6.76 per 9 innings**.
MLB = 4.45 (2025) / 4.39 (2024). Factor ≈ **1.5×**. NOTE: the factor is a *sanity yardstick
only* — never an input. Constants are measured directly from the D1 RE24 matrix.

## Two design decisions baked in
- **Error base = `RUNS_PER_SINGLE` (0.964), not `RUNS_PER_PLAY` (1.045).** An error is charged
  as "a sure out that became a *single*" plus the actual extra-base advancement. Using the
  S/D/T blend would double-count extra-base damage (~+0.08 runs/error) against the explicit
  advancement penalty. This implements the spec's "became a single" wording faithfully; the
  blend was an implementation shortcut. Range still uses `RUNS_PER_PLAY`.
- **Advancement priced off the exact base-out RE24 delta** where state is known (arm holds,
  error advancement); flat `RUNS_PER_BASE` is the documented fallback. (Wired in the follow-up
  commit — DRS/UZR-consistent, leverage-neutral: base-out state sets average run value, but no
  inning/score/win-probability.)

## Validation (memory-independent internal certifications)
- **Telescoping zero-sum: Σ run-value over 605,727 PAs = −0.20% of run activity.** By
  construction, RE deltas + runs telescope to zero over complete half-innings; the tiny residual
  is the excluded parser-failure rows. This certifies the weights are self-consistent *by their
  own arithmetic*, independent of any literature values. (Tripwire for later: the residual should
  shrink proportionally as NEW_VOCAB parser coverage improves; if it doesn't, something else leaks.)
- **Half-inning identity:** RE(empty, 0 out) = 0.751 = runs-per-9 (6.76) ÷ 9. Holds exactly.
- **`(|K| + BB)/4` framing heuristic:** ours (0.413 + 0.453)/4 = 0.217 ≈ measured 0.225; MLB
  (0.27 + 0.31)/4 = 0.145 ≈ canonical 0.125. Both pass. STRIKE super-scales because D1's free-pass
  rate is 14.16% (BB 10.59% + IBB 0.19% + HBP 3.39%) vs MLB ~9.7% — more counts near the
  walk/strikeout thresholds where a stolen strike swings most. "Framing worth more in college."

## MLB reference table (corrected)
Same-method (RE24-derived) MLB values where applicable; canonical sabermetric values otherwise.
The earlier `BASE = 0.25` was a rule-of-thumb, NOT RE24-derived — same-method MLB is ~0.16, so
D1 `BASE` (0.184) is slightly *above* MLB, not below. (TODO footnote: reproduce ~0.16 by running
the frequency-weighted delta on Tango's public MLB RE24 matrix so the reference is fully ours.)

| Constant | D1 | MLB ref | note |
|---|---|---|---|
| PLAY | 1.045 | ~0.80 | ✓ |
| DP | 0.771 | ~0.44 | MLB ref is high end of 0.35–0.45 range |
| BASE | 0.184 | **~0.16** (was 0.25) | same-method; D1 slightly above |
| SB | 0.175 | ~0.20 | ✓ |
| CS | 0.583 | ~0.44 | ✓ |
| PBWP | 0.320 | ~0.27 | ✓ |
| STRIKE | 0.225 | ~0.125 (Mike Fast) | ✓ super-scales on free-pass rate |

## Denominator pinning (avoid a phantom bug)
Two different rates share the phrase "DP rate" — they are NOT the same:
- **Marginal-constant pairing (for `RUNS_PER_DP`):** GDPs (9,077) vs normal grounder-outs in a
  DP situation (9,616) → ~48.6%. Denominator = *ground-ball outs with a runner on first, <2 out*.
- **Engine `dp_rate` fixture:** GDPs ÷ **all** GB DP opportunities (includes hits, errors, FC,
  non-conversions). A different, larger denominator → a much lower rate. Do not compare the two.

## Status of "validated"
The RE24-to-linear-weights method is textbook (Tango's *The Book*). A second model corroborated
the MLB references from literature recall (corroboration, not independent validation). The
genuinely independent certifications are the three internal ones above (telescoping, half-inning
identity, framing heuristic). Constants are ready; empirical validation vs trusted anchor defenders
is the final step (spec §11 Tier 3), pending the full engine run.
