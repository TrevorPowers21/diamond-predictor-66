# Knowledge — the canonical formulas

> ⛔ **The CODE is authoritative, not this file.** `src/savant/lib/war.ts`, `src/lib/pitcherQuality.ts`,
> `src/lib/predictionEngine.ts`. This is a reading aid with derivations; a doc copy of a formula is
> exactly the "stored copy nobody recomputes" defect in prose form. **If they disagree, the code wins
> and this file is the bug.**
>
> Moved out of `CLAUDE.md` 2026-09-02.

---

## wRC+ — hitters

```
wRC+ = ((0.011 + 0.691·OBP + 0.235·SLG) / 0.3782) · 100     (C1, 2026-08-11; rounds to int)
```

**AVG and ISO carry weight 0 — deliberately.** They are redundant with OBP/SLG, and weighting them
double-counts contact.

⚠ **This is the equation that caused Gate B.** Prod's returner wRC+ ran a *different* formula because
a legacy `"Equation Weights"` @2025 table silently outranked the code default. Across 5,122 D1
returner hitters the legacy formula reproduced the stored value for **5,122 (100%)** and the canonical
one for **1,164 (23%)**. Staging looked fine only because its copy of the table was **empty** — same
code, two databases, two different equations.

⇒ **Verify config on BOTH databases.** The table is now `"Equation Weights_LEGACY_2025"`;
`model_config` (admin_ui, 2026) is the single source.

**Blast radius, so the numbers aren't a surprise:** market moves ~60% on a 12-point wRC+ change because
oWAR scales off `(wRC+ − 100)`. Contact-heavy hitters fall; high-OBP hitters rise. **Arithmetic, not a
bug.**

## oWAR

```
oWAR = ((((wRC+ − 100) / 100) · PA · 0.3994) + (PA / 600 · 21.22)) / 13.1
```

**PA comes from the depth role**, never from a stored `projected_ip`/PA field.

## pRV+ and pWAR — pitchers

```
projRA9 = (3.847 − 0.231·K/9 + 0.509·BB/9 + 1.486·HR/9) · 1.137      (D1-FIP index)
pRV+    = 100 + 100·(6.913 − projRA9) / 6.913
pWAR    = (((pRV+ − 100) / 100) · (IP/9) · 6.915 + (IP/9 · 1.92)) / 13.1
```

Canonical: `src/lib/pitcherQuality.ts`. **IP comes from the depth role** (`pitcherExpectedIp`) — the
fix that moved Neiswonger from 1.14 to 3.329 pWAR, and $99k to $332,852.

⚠ FIP moves as one: K/9, BB/9 and HR/9 heading the same direction compound rather than offset.

## Rating centres — the z-shift

```
z-shift = (rating − prCenter) / prSd × ncaaSd
```

⛔ **Ratings are NOT centred at 100.** True D1 / IP≥40 centres run **109.73–123.16** (era 109.73,
bb9 123.16). Hitter defaults: `ba 102.9887`, `obp 100.3109`, `iso 103.7939`.

Assuming 100 was **cause C1** — ERAs ran ~4% low. The other cause was **no division filter**: 477 JUCO
rows were 27% of the calibration sample. `division='D1'` is the consistency boundary.

Centres are stored per stat and wired into the `fields` mapping.
⚠ **A key not in that mapping is INERT** — stage 5.5 once wrote 41 keys that nothing read.

**Two-sided SD** (`sd_good` / `sd_bad`) splits at the **stored centre, not at 100.**

## 56-game proration

```
games_played_est  ≈ team total IP / 9
proration_factor  = 56 / games_played_est,  capped 0.7–1.5
```

Scales raw totals for cross-conference fairness.

## Composite / defensive

- **Composite WAR** ships divided by 10. dWAR + bsrWAR are live on prod (dRS engine v0.11.0).
- **HTP** = OPR + 1.25·(Stuff+ − 100) + 0.75·(100 − run_env), with a park swap.
- Conference stats: **rate stats intra-conference only**; Stuff+/OPR/park/HTP are totals.

## Where each one is duplicated (keep in sync)

A formula change touches **three** implementations, and they have drifted before:

1. `src/lib/*` — the live/UI path
2. `scripts/precompute-*.ts` — the batch path
3. `supabase/functions/process-precompute-jobs/index.ts` — the deployed edge function

⇒ Every new precomputed metric gets a parity test in `src/lib/storedVsLive.test.ts`.
⇒ **Diffing the edge function against the local precompute over the same team, row by row, is the only
check that has ever caught a drift bug here** — it found `IF`/`INF`/`INFIELD` missing from the 1.1
market tier, i.e. every infielder onboarding 10% low. Review, `tsc`, and eyeballing all passed on it.
⚠ **Prove both sides are FRESH first** (`updated_at`); stale-vs-fresh looks exactly like an
implementation disagreement.

## 66 hardcoded constants — open

49 of 115 `DEFAULT_PITCHING_WEIGHTS` are tunable; **66 are not**, including **9 market/$-per-WAR** and
**3 projected-IP-per-depth-role**. Loud fallbacks shipped as the interim mitigation.
⛔ Seeding needs a **naming decision first**: `loadPitchingPowerEq` takes only `p_`-prefixed keys, and
`market_*` is shared with the hitter path.
