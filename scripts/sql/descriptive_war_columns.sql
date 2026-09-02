-- WAR redesign Step 3 — descriptive-WAR columns on the Masters (STAGING).
-- Paste in the STAGING SQL editor (CLI is linked to prod). Idempotent.
-- Descriptive = last-season actuals from raw accrued on-field data. TOTAL WAR is the
-- displayed number; oWAR/pWAR are components. d_war/bsr_war are descriptive but carried
-- 1:1 into the projection composite (scaled only on role/position change).

-- ── Hitter Master ────────────────────────────────────────────────────────────
alter table public."Hitter Master"
  add column if not exists desc_owar      numeric,  -- offensive WAR from true wRAA
  add column if not exists wraa           numeric,  -- weighted runs above average (D1 linear weights)
  add column if not exists woba           numeric,  -- wOBA (display scale, lgwOBA 0.377)
  add column if not exists d_war          numeric,  -- defensive WAR (rollup of player_season_defense)
  add column if not exists bsr_war        numeric,  -- baserunning WAR (player_season_baserunning wSB)
  add column if not exists total_desc_war numeric;  -- desc_owar + d_war + bsr_war  ← DISPLAYED

-- ── Pitching Master ──────────────────────────────────────────────────────────
alter table public."Pitching Master"
  add column if not exists desc_pwar      numeric,  -- pitcher WAR: (replRA9 − desc_ra9)·IP/9/RPW
  add column if not exists desc_ra9       numeric,  -- 0.5·(RA9 + dRS-behind) + 0.5·(FIP·E2T)
  add column if not exists desc_fip_ra9   numeric,  -- FIP·E2T (earned→total), the FIP half of the blend
  add column if not exists drs_behind     numeric,  -- team dRS behind this pitcher, prorated by IP (runs)
  add column if not exists total_desc_war numeric;  -- = desc_pwar (+ TWP hitting / pitcher fielding later) ← DISPLAYED
