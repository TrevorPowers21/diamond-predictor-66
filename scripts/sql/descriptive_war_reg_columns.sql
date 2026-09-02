-- Step 2 · regular-season descriptive WAR (≤ 2026-05-18) — companion to the full-season desc_* columns.
-- Full-season stays the historical headline; these _reg columns feed the projection GAP + team_war_snapshots.
-- Populated by scripts/drs/populate_descriptive_war_reg.mjs. Idempotent.
-- STAGING: run + populated + verified 2026-08-11.  PROD: pending (Step 8).

alter table "Hitter Master"
  add column if not exists woba_reg           numeric,  -- regular-season wOBA (D1 linear weights)
  add column if not exists wraa_reg           numeric,  -- reg wRAA (centered on lgwOBA 0.3782)
  add column if not exists desc_owar_reg      numeric,  -- reg offensive WAR from true reg wRAA
  add column if not exists d_war_reg          numeric,  -- reg defensive WAR (dRS engine, regular-season subset)
  add column if not exists bsr_war_reg        numeric,  -- reg baserunning WAR (wSB, regular-season)
  add column if not exists total_desc_war_reg numeric;  -- desc_owar_reg + d_war_reg + bsr_war_reg

alter table "Pitching Master"
  add column if not exists desc_ra9_reg       numeric,  -- reg 0.5·(reg_RA9 + reg dRS-behind) + 0.5·(reg_FIP·E2T)
  add column if not exists desc_fip_ra9_reg   numeric,  -- reg_FIP·E2T (the FIP half)
  add column if not exists drs_behind_reg     numeric,  -- stored drs_behind prorated by reg_IP/full_IP (runs)
  add column if not exists desc_pwar_reg      numeric,  -- (replRA9 − desc_ra9_reg)·reg_IP/9/RPW
  add column if not exists total_desc_war_reg numeric;  -- = desc_pwar_reg
