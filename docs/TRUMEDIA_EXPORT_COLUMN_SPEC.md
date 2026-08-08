# TruMedia Master export — column spec (independent validation rail)

**Purpose:** independent cross-check of the pitch-log accrual (today's Masters are pitch-log-derived → circular).
Pull **4 files: Hitter + Pitcher, each REGULAR-season-only (≤ 5/18) AND FULL-season (through 6/22).**
The reg-vs-full diff confirms the 5/18 boundary; the pitcher file is the independent IP/ER/ERA rail.
**Easiest path: TruMedia's standard full season stat report — I'll use every column.** If hand-picking, the list below.

**MUST include on every row: the player ID (`source_player_id` / TruMedia `playerId`) + Team + Season.**
Names are display-only — the join is on ID. **Do NOT need stuff+** (TrackMan-computed, not from this export).

## Hitter export
**Counting (the accrual atoms — critical):** PA, AB, H, 2B, 3B, HR, BB, HBP, SF, SH, SO(K), R, RBI, SB, CS
**Rates:** AVG, OBP, SLG, OPS, ISO, BABIP, K%, BB%
**Batted-ball / tracking sub-metrics (power-rating inputs — need these to validate ratings):**
contact%, chase%, whiff%, barrel%, hard-hit%, avg exit velo, EV90 (or max EV), LD%, GB%, FB%, pop-up%, pull%, avg LA, pull-air%

## Pitcher export
**Counting (critical — this is the gap side):** IP, BF, H, 2B, 3B, HR, BB, HBP, SO(K), R, **ER**, GS, G, W, L, SV
**Rates:** ERA, FIP, WHIP, K/9, BB/9, HR/9, K%, BB%, BABIP, LOB%
**Batted-ball / tracking allowed (rating inputs, NO stuff+):**
contact%, chase%, whiff%, barrel%-allowed, hard-hit%-allowed, avg EV allowed, GB%, FB%, LD%, avg FB velo

## Priority if the export is limited
1. Pitcher **IP, ER, ERA, BF, H, BB, K, HR** (independent ERA rail — the only stat with a real accrual gap).
2. Hitter + pitcher **counting stats** (validate accrual atoms).
3. Both files in **reg-only AND full** (nail the postseason boundary).
4. Sub-metric/tracking columns (validate power-rating inputs).

On arrival: drop in `docs/drs-reference/`, re-run the manifest builder, check the boxes in SOURCES_OF_TRUTH_MANIFEST.md, re-tar the archive.
