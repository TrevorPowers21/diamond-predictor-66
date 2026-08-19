-- refresh_team_season_stats(p_season, p_reg_end) — the ONE idempotent routine that (re)builds team_season_stats for a season.
-- This is the descriptive STORE stage of the unified upload edge fn: call `select refresh_team_season_stats(2026);` after the
-- Masters + pitch_log_*_totals are refreshed, and before/around projections. Assembled from the validated per-step SQL:
--   scripts/sql/team_season_stats_{war_rollup,rates_pitchlog,rates(pitching),records,migrate_snapshot_conf,faced_park}.sql
-- D1 only. Rate/counting = pitch-log-primary (hitting fully; pitching counting), pitching RATES = Master IP-weighted interim,
-- Master = source-of-truth fill. Idempotent: DELETE season then rebuild. p_reg_end defaults to <season>-05-18 (reg-season boundary).

CREATE OR REPLACE FUNCTION public.refresh_team_season_stats(p_season int, p_reg_end date DEFAULT NULL)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  v_reg_end date := coalesce(p_reg_end, make_date(p_season, 5, 18));
  v_rows int;
BEGIN
  DELETE FROM public.team_season_stats WHERE season = p_season;

  -- 1) base rows + WAR matrix (Σ Masters desc_*), D1 only
  WITH h AS (
    SELECT "TeamID" tid, max("Team") team_name, (max(conference_id::text))::uuid conference_id,
      sum(desc_owar) owar_total, sum(desc_owar_reg) owar_reg, sum(d_war) dwar_total, sum(d_war_reg) dwar_reg,
      sum(bsr_war) bsrwar_total, sum(bsr_war_reg) bsrwar_reg, sum(total_desc_war) hit_tw, sum(total_desc_war_reg) hit_tw_reg,
      count(*) n_hitters
    FROM "Hitter Master" WHERE "Season"=p_season AND division='D1' GROUP BY "TeamID"
  ),
  p AS (
    SELECT "TeamID" tid, (max(conference_id::text))::uuid conference_id,
      sum(desc_pwar) pwar_total, sum(desc_pwar_reg) pwar_reg, sum(total_desc_war) pit_tw, sum(total_desc_war_reg) pit_tw_reg,
      count(*) n_pitchers
    FROM "Pitching Master" WHERE "Season"=p_season AND division='D1' GROUP BY "TeamID"
  )
  INSERT INTO public.team_season_stats
    (source_id, season, team_season_id, conference_id, team_name, abbreviation,
     owar_reg, owar_total, dwar_reg, dwar_total, bsrwar_reg, bsrwar_total, pwar_reg, pwar_total,
     total_war_reg, total_war_total, hitter_war_reg, hitter_war_total, n_hitters, n_pitchers)
  SELECT tt.source_id, p_season, tt.id, coalesce(h.conference_id, p.conference_id, tt.conference_id), tt.full_name, tt.abbreviation,
     coalesce(h.owar_reg,0), coalesce(h.owar_total,0), coalesce(h.dwar_reg,0), coalesce(h.dwar_total,0),
     coalesce(h.bsrwar_reg,0), coalesce(h.bsrwar_total,0), coalesce(p.pwar_reg,0), coalesce(p.pwar_total,0),
     coalesce(h.hit_tw_reg,0)+coalesce(p.pit_tw_reg,0), coalesce(h.hit_tw,0)+coalesce(p.pit_tw,0),
     coalesce(h.hit_tw_reg,0), coalesce(h.hit_tw,0),   -- hitter_war = Σ hitter total_desc_war = o+d+bsr
     coalesce(h.n_hitters,0), coalesce(p.n_pitchers,0)
  FROM h FULL JOIN p ON h.tid=p.tid JOIN "Teams Table" tt ON tt.id = coalesce(h.tid,p.tid);

  -- 1b) pitching rotation/bullpen split (rotation = top-3 pitchers by IP, bullpen = rank 4+; descriptive pWAR, reg + total)
  WITH ranked AS (
    SELECT tt.source_id sid, pm.desc_pwar pw, pm.desc_pwar_reg pwr,
      row_number() OVER (PARTITION BY tt.source_id ORDER BY pm."IP" DESC NULLS LAST) rk
    FROM "Pitching Master" pm JOIN "Teams Table" tt ON tt.id=pm."TeamID"
    WHERE pm."Season"=p_season AND pm.division='D1'
  ),
  agg AS (
    SELECT sid,
      sum(pw) FILTER (WHERE rk<=3) rot_t, sum(pwr) FILTER (WHERE rk<=3) rot_r,
      sum(pw) FILTER (WHERE rk>3)  bp_t,  sum(pwr) FILTER (WHERE rk>3)  bp_r
    FROM ranked GROUP BY sid
  )
  UPDATE public.team_season_stats ts SET
    rotation_pwar_total=coalesce(agg.rot_t,0), rotation_pwar_reg=coalesce(agg.rot_r,0),
    bullpen_pwar_total=coalesce(agg.bp_t,0),   bullpen_pwar_reg=coalesce(agg.bp_r,0)
  FROM agg WHERE ts.source_id=agg.sid AND ts.season=p_season;

  -- 2) hitting rates + counting (pitch-log-primary)
  WITH pl AS (
    SELECT tt.source_id sid, sum(h.pa) pa, sum(h.ab) ab,
      sum(h.hits_single+h.hits_double+h.hits_triple+h.hits_hr) hits,
      sum(h.hits_double) dbl, sum(h.hits_triple) tpl, sum(h.hits_hr) hr,
      sum(h.bb) bb, sum(h.hbp) hbp, sum(h.k) k, sum(h.sac) sf,
      sum(h.hits_single + 2*h.hits_double + 3*h.hits_triple + 4*h.hits_hr) tb
    FROM pitch_log_hitter_totals h
    JOIN "Hitter Master" hm ON hm.source_player_id=h.batter_id AND hm."Season"=p_season
    JOIN "Teams Table" tt ON tt.id=hm."TeamID"
    WHERE h.season=p_season AND h.dimension_key='all' AND hm.division='D1' GROUP BY tt.source_id
  )
  UPDATE public.team_season_stats ts SET
    pa_total=pl.pa, ab_total=pl.ab, h_total=pl.hits, dbl_total=pl.dbl, tpl_total=pl.tpl, hr_total=pl.hr,
    bb_total=pl.bb, hbp_total=pl.hbp, k_total=pl.k, sf_total=pl.sf,
    avg_total=pl.hits::float/nullif(pl.ab,0), obp_total=(pl.hits+pl.bb+pl.hbp)::float/nullif(pl.pa,0),
    slg_total=pl.tb::float/nullif(pl.ab,0), iso_total=pl.tb::float/nullif(pl.ab,0)-pl.hits::float/nullif(pl.ab,0),
    ops_total=(pl.hits+pl.bb+pl.hbp)::float/nullif(pl.pa,0)+pl.tb::float/nullif(pl.ab,0),
    wrc_plus_total=((0.011+0.691*((pl.hits+pl.bb+pl.hbp)::float/nullif(pl.pa,0))+0.235*(pl.tb::float/nullif(pl.ab,0)))/0.3782)*100
  FROM pl WHERE ts.source_id=pl.sid AND ts.season=p_season;

  -- 2b) MASTER-RECONCILE/FILL (Trevor's model: pitch-log primary, Master = source-of-truth fill for thin/absent teams).
  --     Fills hitting rates from the authoritative Master ONLY where pitch-log left them null (team absent from pitch_log —
  --     e.g. low-TrackMan programs). No-op for 2026 D1 (all 308 covered by pitch-log). Master rates = PA/AB-weighted.
  WITH m AS (
    SELECT tt.source_id sid, sum(hm.pa) pa, sum(hm.ab) ab,
      sum(hm."AVG"*hm.ab)/nullif(sum(hm.ab),0) tavg, sum(hm."OBP"*hm.pa)/nullif(sum(hm.pa),0) tobp,
      sum(hm."SLG"*hm.ab)/nullif(sum(hm.ab),0) tslg
    FROM "Hitter Master" hm JOIN "Teams Table" tt ON tt.id=hm."TeamID"
    WHERE hm."Season"=p_season AND hm.division='D1' AND hm.ab>0 GROUP BY tt.source_id
  )
  UPDATE public.team_season_stats ts SET
    pa_total=m.pa, ab_total=m.ab, avg_total=m.tavg, obp_total=m.tobp, slg_total=m.tslg,
    iso_total=m.tslg-m.tavg, ops_total=m.tobp+m.tslg,
    wrc_plus_total=((0.011+0.691*m.tobp+0.235*m.tslg)/0.3782)*100
  FROM m WHERE ts.source_id=m.sid AND ts.season=p_season AND ts.avg_total IS NULL;

  -- 3) pitching counting (pitch-log-native)
  WITH pl AS (
    SELECT tt.source_id sid, sum(p2.total_bf) bf, sum(p2.total_k) k, sum(p2.total_bb) bb, sum(p2.total_hbp) hbp,
      sum(p2.hits_hr_allowed) hr, sum(p2.hits_single_allowed+p2.hits_double_allowed+p2.hits_triple_allowed+p2.hits_hr_allowed) h
    FROM pitch_log_pitcher_totals p2
    JOIN "Pitching Master" pm ON pm.source_player_id=p2.pitcher_id AND pm."Season"=p_season
    JOIN "Teams Table" tt ON tt.id=pm."TeamID"
    WHERE p2.season=p_season AND p2.dimension_key='all' AND pm.division='D1' GROUP BY tt.source_id
  )
  UPDATE public.team_season_stats ts SET
    bf_total=pl.bf, pk_total=pl.k, pbb_total=pl.bb, phbp_total=pl.hbp, phr_total=pl.hr, ph_total=pl.h
  FROM pl WHERE ts.source_id=pl.sid AND ts.season=p_season;

  -- 4a) ERA = Master IP-weighted (SOURCE-OF-TRUTH). Pitch-log ERA is noisy (corr 0.825) because earned-run attribution
  --      (runs − (UR)) is imperfect — so ERA stays on the official Master. Everything else pitch-log-derived below (4b).
  WITH a AS (
    SELECT tt.source_id sid, sum(pm."ERA"*pm."IP")/nullif(sum(pm."IP"),0) tera
    FROM "Pitching Master" pm JOIN "Teams Table" tt ON tt.id=pm."TeamID"
    WHERE pm."Season"=p_season AND pm.division='D1' AND pm."IP">0 GROUP BY tt.source_id
  )
  UPDATE public.team_season_stats ts SET era_total=a.tera FROM a WHERE ts.source_id=a.sid AND ts.season=p_season;

  -- 4b) pitch-log IP + K9/BB9/HR9/WHIP/FIP (pitch-log-PRIMARY). IP via outs-tracking: Σ (max(outs)+1)/3 over pitching
  --      half-innings (corr 0.9932 vs Master IP). Rates from pitch-log counts (pk/pbb/phbp/phr/ph set in step 3) ÷ pitch-log IP.
  --      cFIP=3.157 (D1 2026 descriptive constant). K9/BB9/HR9/WHIP corr 0.996+ vs Master; FIP mean matches Master FIP.
  WITH ip AS (
    SELECT team_id sid, sum(mo+1)/3.0 ip FROM (
      SELECT team_id, date::date d, game_venue_id, total_runs, opponent_runs, inn, max(outs) mo
      FROM pitch_log WHERE season=p_season AND team_id IS NOT NULL AND inn IS NOT NULL
      GROUP BY team_id, date::date, game_venue_id, total_runs, opponent_runs, inn
    ) h GROUP BY team_id
  )
  UPDATE public.team_season_stats ts SET
    ip_total  = ip.ip,
    k9_total  = ts.pk_total*9.0/nullif(ip.ip,0),
    bb9_total = ts.pbb_total*9.0/nullif(ip.ip,0),
    hr9_total = ts.phr_total*9.0/nullif(ip.ip,0),
    whip_total= (ts.pbb_total+ts.ph_total)/nullif(ip.ip,0),
    fip_total = (13*ts.phr_total + 3*(ts.pbb_total+ts.phbp_total) - 2*ts.pk_total)/nullif(ip.ip,0) + 3.157
  FROM ip WHERE ts.source_id=ip.sid AND ts.season=p_season;

  -- 5) records (pitch_log game outcomes; game key = distinct score-pair; boundary v_reg_end)
  WITH games AS (
    SELECT DISTINCT team_id, date::date d, game_venue_id, total_runs, opponent_runs, is_conference_game
    FROM pitch_log WHERE season=p_season AND team_id IS NOT NULL AND total_runs IS NOT NULL AND opponent_runs IS NOT NULL
  ),
  rec AS (
    SELECT team_id sid,
      count(*) FILTER (WHERE total_runs>opponent_runs) w_total, count(*) FILTER (WHERE total_runs<opponent_runs) l_total,
      count(*) FILTER (WHERE total_runs>opponent_runs AND d<=v_reg_end) w_reg, count(*) FILTER (WHERE total_runs<opponent_runs AND d<=v_reg_end) l_reg,
      count(*) FILTER (WHERE total_runs>opponent_runs AND is_conference_game AND d<=v_reg_end) w_conf,
      count(*) FILTER (WHERE total_runs<opponent_runs AND is_conference_game AND d<=v_reg_end) l_conf
    FROM games GROUP BY team_id
  )
  UPDATE public.team_season_stats ts SET
    w_total=rec.w_total, l_total=rec.l_total, w_reg=rec.w_reg, l_reg=rec.l_reg, w_conf=rec.w_conf, l_conf=rec.l_conf
  FROM rec WHERE ts.source_id=rec.sid AND ts.season=p_season;

  -- 6) snapshot carry (champions/seed/proration — NOT the stale old oWAR)
  UPDATE public.team_season_stats ts SET
    proration_factor=tws.proration_factor, games_played_est=tws.games_played_est, team_drs=tws.team_drs,
    is_national_champ=coalesce(tws.is_national_champ,false), is_conference_champ=coalesce(tws.is_conference_champ,false),
    national_seed_rank=tws.national_seed_rank
  FROM public.team_war_snapshots tws WHERE tws.source_team_id=ts.source_id AND tws.season=ts.season AND ts.season=p_season;

  -- 7) conference-scoped context
  UPDATE public.team_season_stats ts SET
    conf_stuff_plus=cs."Stuff_plus", conf_htp=cs.hitter_talent_plus, run_env_factor=cs.run_env_factor,
    conf_opr=cs."Overall_Power_Rating", conf_wrc_plus=cs."WRC_plus"
  FROM "Conference Stats" cs WHERE cs.conference_id=ts.conference_id AND cs.season=ts.season AND ts.season=p_season;

  -- 8) faced_stuff_plus (T hitters vs pitchers faced: opponent_id=T, metric = team_id's conf Stuff+)
  UPDATE public.team_season_stats ts SET faced_stuff_plus=a.fs FROM (
    SELECT pl.opponent_id sid, sum(c.stuff)/nullif(count(*),0) fs
    FROM pitch_log pl JOIN (
      SELECT tt.source_id sid, cs."Stuff_plus" stuff FROM "Teams Table" tt
      JOIN "Conference Stats" cs ON cs.conference_id=tt.conference_id AND cs.season=p_season WHERE tt."Season"=p_season
    ) c ON c.sid=pl.team_id WHERE pl.season=p_season GROUP BY pl.opponent_id
  ) a WHERE ts.source_id=a.sid AND ts.season=p_season;

  -- 9) faced_htp (T pitchers vs hitters faced: team_id=T, metric = opponent_id's conf HTP)
  UPDATE public.team_season_stats ts SET faced_htp=a.fh FROM (
    SELECT pl.team_id sid, sum(c.htp)/nullif(count(*),0) fh
    FROM pitch_log pl JOIN (
      SELECT tt.source_id sid, cs.hitter_talent_plus htp FROM "Teams Table" tt
      JOIN "Conference Stats" cs ON cs.conference_id=tt.conference_id AND cs.season=p_season WHERE tt."Season"=p_season
    ) c ON c.sid=pl.opponent_id WHERE pl.season=p_season GROUP BY pl.team_id
  ) a WHERE ts.source_id=a.sid AND ts.season=p_season;

  -- 10) park snapshot (federated from "Park Factors")
  UPDATE public.team_season_stats ts SET
    park_rg_rolling=pf.rg_factor, park_rg_single=pf.rg_factor_seasonal,
    park_avg_rolling=pf.avg_factor, park_avg_single=pf.avg_factor_seasonal, park_hr9_rolling=pf.hr9_factor
  FROM "Park Factors" pf WHERE pf.source_team_id=ts.source_id AND pf.season=ts.season AND ts.season=p_season;

  SELECT count(*) INTO v_rows FROM public.team_season_stats WHERE season=p_season;
  RETURN v_rows;
END;
$$;
