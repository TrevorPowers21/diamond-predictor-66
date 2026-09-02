-- ============================================================================
-- Conference Stats — BUCKET A producer (raw rates + env+ + WRC_plus + pitching rates)
-- RUNNABLE + IDEMPOTENT. Source: pitch_log, INTRA-CONFERENCE only (is_conference_game=true).
-- D1 2026. Validated 2026-08-18 (rates corr 0.98+, ERA 0.984 DRS, FIP cFIP 3.157).
--
-- WHY THIS EXISTS (GAP 3, 2026-08-21): the UPDATE below used to live only as a
-- COMMENTED-OUT block in conf_stats_unified_assembly.sql — a hand-run staging step with
-- no committed producer. On prod the conf rate/env+/WRC_plus columns would be EMPTY →
-- transfers + HTP + Program Analytics break silently. This file is the reproducible
-- producer. End state = ONE edge-fn conf-stats-derive stage (Track B) that runs this logic.
--
-- SCOPE: writes ONLY Bucket A (rates/env+/WRC_plus). Bucket B (OPR/Stuff_plus/run_env_factor/
-- hitter_talent_plus/scouting = TOTAL-season) is produced by scripts/derive_conf_opr_htp.ts +
-- the Stuff+/scouting rollups and is LEFT INTACT here. D1 only — pitch_log is D1-only data,
-- so _conf_agg naturally contains only D1 conferences.
--
-- RUN (staging): supabase db query --linked --file scripts/sql/conf_stats_bucketA_assembly.sql
-- RUN (prod):    paste into the prod SQL editor (per prod-write policy). ~20s CTAS over 2.58M rows.
-- NCAA env+ denominators are the ncaa_averages 2026 D1 row (avg .2777 / obp .3823 / slg .4365 /
-- iso .1588); for a NEW season re-read ncaa_averages and update these four constants + cFIP.
-- ============================================================================

begin;

drop table if exists _conf_agg;
create temp table _conf_agg as
with team_conf as (
  -- source_id → conference_id (team_id/opponent_id in pitch_log are the CLEAN ids;
  -- batting_team_id/pitching_team_id are corrupt — do NOT use them). Same lookup the
  -- is_conference_game backfill used (spec §0). distinct on = defend against any dup
  -- source_id row in a season (would fan-out pitch_log rows on the join).
  select distinct on (source_id::text) source_id::text sid, conference_id cid
  from "Teams Table"
  where "Season" = 2026 and source_id is not null and conference_id is not null
  order by source_id::text, conference_id
),
base as (
  select tc.cid, pl.pitch_result_category prc, pl.pitch_result pr, pl.runs, pl.atbat_desc
  from pitch_log pl
  join team_conf tc on tc.sid = pl.team_id::text
  where pl.season = 2026 and pl.is_conference_game = true
),
term as (
  select cid, prc, pr from base
  where prc is not null and prc not in ('Ball','Strike','Foul')
),
agg as (
  select cid,
    count(*) filter (where prc in ('Single','Double','Triple','HR')) h,
    count(*) filter (where prc='Double') d2,
    count(*) filter (where prc='Triple') d3,
    count(*) filter (where prc='HR') hr,
    count(*) filter (where prc in ('Single','Double','Triple','HR','GroundOut','FlyOut','PopOut','LineOut','Strikeout','FieldersChoice','DoublePlay','Error')) ab,
    count(*) filter (where prc='Walk') bb,
    count(*) filter (where prc='HBP') hbp,
    count(*) filter (where pr='Sac Fly') sf,
    count(*) filter (where prc='Strikeout') k,
    (count(*) filter (where prc in ('Strikeout','GroundOut','FlyOut','PopOut','LineOut','Sac','FieldersChoice')) + 2*count(*) filter (where prc='DoublePlay'))::numeric/3 ip
  from term group by cid
),
runs as (
  -- ERA = DRS earned: total runs minus runs on '(UR)'-tagged plays (the DRS engine's earned rule).
  select cid,
    sum(coalesce(runs,0)) - sum(case when atbat_desc ilike '%(UR)%' then coalesce(runs,0) else 0 end) er
  from base group by cid
)
select a.cid,
  a.h::numeric/nullif(a.ab,0) avg,
  (a.h+a.bb+a.hbp)::numeric/nullif(a.ab+a.bb+a.hbp+a.sf,0) obp,
  (a.d2+2*a.d3+3*a.hr)::numeric/nullif(a.ab,0) iso,
  (a.h+a.d2+2*a.d3+3*a.hr)::numeric/nullif(a.ab,0) slg,
  a.k*9/nullif(a.ip,0) k9,
  a.bb*9/nullif(a.ip,0) bb9,
  a.hr*9/nullif(a.ip,0) hr9,
  (a.bb+a.h)/nullif(a.ip,0) whip,
  (13.0*a.hr+3.0*(a.bb+a.hbp)-2.0*a.k)/nullif(a.ip,0) + 3.157 fip,  -- cFIP 3.157 (D1 2026)
  r.er*9/nullif(a.ip,0) era
from agg a join runs r on r.cid=a.cid;

-- Write Bucket A to Conference Stats (D1 2026). Joins on conference_id, so only confs with
-- intra-conf pitch-log rows are touched (Bucket B + non-D1 rows untouched).
update "Conference Stats" cs set
  "AVG"=a.avg, "OBP"=a.obp, "ISO"=a.iso, "SLG"=a.slg, "OPS"=a.obp+a.slg,
  ba_plus=a.avg/0.2777*100, obp_plus=a.obp/0.3823*100, slg_plus=a.slg/0.4365*100, iso_plus=a.iso/0.1588*100,
  "WRC_plus"=(0.011+0.691*a.obp+0.235*a.slg)/0.3782*100,   -- current C1 (OBP/SLG); corrects stale pre-C1 value
  "K9"=a.k9, "BB9"=a.bb9, "HR9"=a.hr9, "WHIP"=a.whip, "FIP"=a.fip, "ERA"=a.era, updated_at=now()
from _conf_agg a
where cs.conference_id=a.cid and cs.season=2026;

commit;

-- Verify (run after): should be ~30 D1 rows with non-null rates; env+ centered near 100.
-- select conference_id, "AVG","OBP","ISO","WRC_plus","ERA","FIP" from "Conference Stats"
--   where season=2026 and "AVG" is not null order by "WRC_plus" desc;
