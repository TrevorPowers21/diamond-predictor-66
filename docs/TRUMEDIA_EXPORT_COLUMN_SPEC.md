# TruMedia Master export — column spec (independent validation rail)

**Purpose:** independent cross-check of the pitch-log accrual (today's Masters are pitch-log-derived → circular).
Pull **4 files: Hitter + Pitcher, each REGULAR-season-only (≤ 5/18) AND FULL-season (through 6/22).**
The reg-vs-full diff confirms the 5/18 boundary; the pitcher file is the independent IP/ER/ERA rail.
**Easiest path: TruMedia's standard full season stat report — I'll use every column.** If hand-picking, the list below.

**MUST include on every row: the player ID (`source_player_id` / TruMedia `playerId`) + Team + Season.**
Names are display-only — the join is on ID. **Do NOT need stuff+** (TrackMan-computed, not from this export).

**Sub-metric column names below = the actual Master columns (DB-verified 2026-08-08) — map TruMedia fields to these.**
**We use `la_10_30_pct` (share of BBE with launch angle 10–30°), NOT average launch angle** — for BOTH sides.
**`pull_air` is DERIVED IN THE PITCH LOG, not a TruMedia field — do NOT expect it from the export.**

## Hitter export
**Counting (the accrual atoms — critical):** PA, AB, H, 2B, 3B, HR, BB, HBP, SF, SH, SO(K), R, RBI, SB, CS
**Rates:** AVG, OBP, SLG, OPS, ISO, BABIP, K%, BB%
**Tracking sub-metrics = the 11 rating inputs (Hitter Master cols):** `contact`, `line_drive` (LD%), `avg_exit_velo`,
`pop_up` (%), `bb` (BB%), `chase`, `barrel`, `ev90`, `pull` (%), `la_10_30` (LA 10–30° %), `gb` (GB%), plus `k_pct`.
(pull_air = pitch-log-derived, not from export.)

## Pitcher export
**Counting (critical — this is the gap side):** IP, BF, H, 2B, 3B, HR, BB, HBP, SO(K), R, **ER**, GS, G, W, L, SV
**Rates:** ERA, FIP, WHIP, K/9, BB/9, HR/9, K%, BB%, BABIP, LOB%
**Tracking allowed = the rating inputs (Pitching Master cols, NO stuff+):** `miss_pct` (whiff%),
`in_zone_whiff_pct`, `chase_pct`, `barrel_pct` (allowed), `hard_hit_pct` (allowed), `exit_vel` (avg EV allowed),
`90th_vel` (EV90 allowed), `line_pct` (LD%), `ground_pct` (GB%), `in_zone_pct` (zone%), `h_pull_pct` (pull% allowed),
`la_10_30_pct`, `bb_pct`, `k_pct`. **stuff+ EXCLUDED** (TrackMan pitch-shape, pitch-log-native).

## Priority if the export is limited
1. Pitcher **IP, ER, ERA, BF, H, BB, K, HR** (independent ERA rail — the only stat with a real accrual gap).
2. Hitter + pitcher **counting stats** (validate accrual atoms).
3. Both files in **reg-only AND full** (nail the postseason boundary).
4. Sub-metric/tracking columns (validate power-rating inputs).

On arrival: drop in `docs/drs-reference/`, re-run the manifest builder, check the boxes in SOURCES_OF_TRUTH_MANIFEST.md, re-tar the archive.
