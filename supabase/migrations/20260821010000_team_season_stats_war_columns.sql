-- ============================================================================
-- team_season_stats — add the 10 WAR/RA9 columns that refresh_team_season_stats()
-- writes but the CREATE TABLE migration (20260819000000) never defined.
--
-- WHY (2026-08-21, branch audit): these columns were hand-run `ALTER ADD`s on
-- staging and folded into refresh_team_season_stats()'s body, but never captured
-- as a committed migration. On a FRESH PROD push the CREATE applies (plpgsql body
-- isn't validated at CREATE time), then the first `select refresh_team_season_stats(2026);`
-- does `DELETE FROM team_season_stats WHERE season=p_season` (step 0) and then ABORTS
-- on `column "hitter_war_total" does not exist` — leaving the table EMPTY for the
-- season → Program Analytics, faced-competition (faced_stuff_plus/faced_htp), conf
-- context, and W/L records all silently break.
--
-- IF NOT EXISTS → idempotent + staging-safe (columns already exist there from the
-- hand-run ALTERs). Types match the CREATE migration's WAR matrix (double precision).
-- Written by refresh_team_season_stats() at: step 1 (:33), step 1b (:56-57), step 4c (:150).
-- ============================================================================

alter table team_season_stats
  add column if not exists hitter_war_reg      double precision,
  add column if not exists hitter_war_total    double precision,
  add column if not exists rotation_pwar_reg   double precision,
  add column if not exists rotation_pwar_total double precision,
  add column if not exists bullpen_pwar_reg    double precision,
  add column if not exists bullpen_pwar_total  double precision,
  add column if not exists ra9_reg             double precision,
  add column if not exists ra9_total           double precision,
  add column if not exists fip_ra9_reg         double precision,
  add column if not exists fip_ra9_total       double precision;
