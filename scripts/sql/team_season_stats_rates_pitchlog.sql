-- team_season_stats RATE/COUNTING re-source (pitch-log-primary) — Trevor 2026-08-19: pitch_log is the LIVE/frequent feed (daily
-- through spring), TruMedia Master is the OCCASIONAL source-of-truth fill (gaps + low-TrackMan programs not in pitch log). So stored
-- rates are pitch-log-derived; Master reconciles/fills where pitch log is thin/absent (no fill needed for 2026 D1 — all 308 covered).
-- Cross-check vs Master: hitting corr 0.996, pitch-log K9 vs Master K9 corr 0.998.

-- HITTING (pitch-log-primary): rates + counting splits from pitch_log_hitter_totals (dim 'all'). Verified: Georgia .324/.623 175HR wRC+121.
WITH pl AS (
  SELECT tt.source_id sid, sum(h.pa) pa, sum(h.ab) ab,
    sum(h.hits_single+h.hits_double+h.hits_triple+h.hits_hr) hits,
    sum(h.hits_double) dbl, sum(h.hits_triple) tpl, sum(h.hits_hr) hr,
    sum(h.bb) bb, sum(h.hbp) hbp, sum(h.k) k, sum(h.sac) sf,
    sum(h.hits_single + 2*h.hits_double + 3*h.hits_triple + 4*h.hits_hr) tb
  FROM pitch_log_hitter_totals h
  JOIN "Hitter Master" hm ON hm.source_player_id=h.batter_id AND hm."Season"=2026
  JOIN "Teams Table" tt ON tt.id=hm."TeamID"
  WHERE h.season=2026 AND h.dimension_key='all' AND hm.division='D1' GROUP BY tt.source_id
)
UPDATE public.team_season_stats ts SET
  pa_total=pl.pa, ab_total=pl.ab, h_total=pl.hits, dbl_total=pl.dbl, tpl_total=pl.tpl, hr_total=pl.hr,
  bb_total=pl.bb, hbp_total=pl.hbp, k_total=pl.k, sf_total=pl.sf,
  avg_total=pl.hits::float/nullif(pl.ab,0), obp_total=(pl.hits+pl.bb+pl.hbp)::float/nullif(pl.pa,0),
  slg_total=pl.tb::float/nullif(pl.ab,0), iso_total=pl.tb::float/nullif(pl.ab,0)-pl.hits::float/nullif(pl.ab,0),
  ops_total=(pl.hits+pl.bb+pl.hbp)::float/nullif(pl.pa,0)+pl.tb::float/nullif(pl.ab,0),
  wrc_plus_total=((0.011+0.691*((pl.hits+pl.bb+pl.hbp)::float/nullif(pl.pa,0))+0.235*(pl.tb::float/nullif(pl.ab,0)))/0.3782)*100
FROM pl WHERE ts.source_id=pl.sid AND ts.season=2026;

-- PITCHING COUNTING (pitch-log-native) from pitch_log_pitcher_totals. RATES (era/fip/whip/k9/bb9/hr9) stay Master IP-weighted
-- (authoritative interim; pitch_log_pitcher_totals lacks IP/ER). FOLLOW-ON: full pitch-log pitching rates via IP=outs/3 + ER (conf-stats machinery).
WITH pl AS (
  SELECT tt.source_id sid, sum(p.total_bf) bf, sum(p.total_k) k, sum(p.total_bb) bb, sum(p.total_hbp) hbp,
    sum(p.hits_hr_allowed) hr, sum(p.hits_single_allowed+p.hits_double_allowed+p.hits_triple_allowed+p.hits_hr_allowed) h
  FROM pitch_log_pitcher_totals p
  JOIN "Pitching Master" pm ON pm.source_player_id=p.pitcher_id AND pm."Season"=2026
  JOIN "Teams Table" tt ON tt.id=pm."TeamID"
  WHERE p.season=2026 AND p.dimension_key='all' AND pm.division='D1' GROUP BY tt.source_id
)
UPDATE public.team_season_stats ts SET
  bf_total=pl.bf, pk_total=pl.k, pbb_total=pl.bb, phbp_total=pl.hbp, phr_total=pl.hr, ph_total=pl.h
FROM pl WHERE ts.source_id=pl.sid AND ts.season=2026;
