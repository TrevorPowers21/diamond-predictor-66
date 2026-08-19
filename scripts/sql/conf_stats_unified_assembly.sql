create table _conf_agg as
with base as (
  select tc.conference_id cid, pl.pitch_result_category prc, pl.pitch_result pr, pl.runs, pl.atbat_desc
  from pitch_log pl join _team_conf tc on tc.sid=pl.team_id
  where pl.season=2026 and pl.is_conference_game=true
),
term as (select cid, prc, pr from base where prc is not null and prc not in ('Ball','Strike','Foul')),
agg as (
  select cid,
    count(*) filter (where prc in ('Single','Double','Triple','HR')) h, count(*) filter (where prc='Double') d2, count(*) filter (where prc='Triple') d3, count(*) filter (where prc='HR') hr,
    count(*) filter (where prc in ('Single','Double','Triple','HR','GroundOut','FlyOut','PopOut','LineOut','Strikeout','FieldersChoice','DoublePlay','Error')) ab,
    count(*) filter (where prc='Walk') bb, count(*) filter (where prc='HBP') hbp, count(*) filter (where pr='Sac Fly') sf, count(*) filter (where prc='Strikeout') k,
    (count(*) filter (where prc in ('Strikeout','GroundOut','FlyOut','PopOut','LineOut','Sac','FieldersChoice')) + 2*count(*) filter (where prc='DoublePlay'))::numeric/3 ip
  from term group by cid
),
runs as (select cid, sum(coalesce(runs,0)) - sum(case when atbat_desc ilike '%(UR)%' then coalesce(runs,0) else 0 end) er from base group by cid)
select a.cid,
  a.h::numeric/nullif(a.ab,0) avg, (a.h+a.bb+a.hbp)::numeric/nullif(a.ab+a.bb+a.hbp+a.sf,0) obp,
  (a.d2+2*a.d3+3*a.hr)::numeric/nullif(a.ab,0) iso, (a.h+a.d2+2*a.d3+3*a.hr)::numeric/nullif(a.ab,0) slg,
  a.k*9/nullif(a.ip,0) k9, a.bb*9/nullif(a.ip,0) bb9, a.hr*9/nullif(a.ip,0) hr9, (a.bb+a.h)/nullif(a.ip,0) whip,
  (13.0*a.hr+3.0*(a.bb+a.hbp)-2.0*a.k)/nullif(a.ip,0) + 3.157 fip, r.er*9/nullif(a.ip,0) era
from agg a join runs r on r.cid=a.cid;

-- ── Then write Bucket-A fields to Conference Stats (run separately; direct connection) ──
-- update "Conference Stats" cs set
--   "AVG"=a.avg, "OBP"=a.obp, "ISO"=a.iso, "SLG"=a.slg, "OPS"=a.obp+a.slg,
--   ba_plus=a.avg/0.2777*100, obp_plus=a.obp/0.3823*100, slg_plus=a.slg/0.4365*100, iso_plus=a.iso/0.1588*100,
--   "WRC_plus"=(0.011+0.691*a.obp+0.235*a.slg)/0.3782*100,   -- current C1 (OBP/SLG); fixes stale pre-C1 value
--   "K9"=a.k9, "BB9"=a.bb9, "HR9"=a.hr9, "WHIP"=a.whip, "FIP"=a.fip, "ERA"=a.era, updated_at=now()
-- from _conf_agg a where cs.conference_id=a.cid and cs.season=2026;
-- NCAA constants (env+ denominators) from ncaa_averages season row; cFIP 3.157 (D1 2026). ERA = DRS earned ((UR) tags).
-- Bucket B (OPR/Stuff+/run_env/HTP/scouting = total-season) left intact — already stored + validated.
