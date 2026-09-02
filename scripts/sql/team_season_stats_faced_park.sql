-- team_season_stats step 6 — faced competition + park snapshot. Run the 3 UPDATEs separately (CLI is one-statement-per-call).
-- SEMANTICS (validated): pitch_log team_id = pitching/defense side, opponent_id = batting side (batter belongs to opponent_id ~84%).
--   faced_stuff_plus(T) = pitch-weighted conf Stuff+ of the PITCHERS T's hitters faced = rows opponent_id=T, metric on team_id's conf.
--   faced_htp(T)        = pitch-weighted conf HTP of the HITTERS T's pitchers faced = rows team_id=T,   metric on opponent_id's conf.
-- Reproduces the proven Oregon State faced Stuff+ 100.2 (proof 100.3) / HTP 104.5 (proof 104.6). Verified staging 2026-08-19: 308/308.
-- Park = federated snapshot of the values USED (Park Factors stays the historical source): rolling (rg/avg/hr9_factor) + single-season (_seasonal).

WITH conf AS (SELECT tt.source_id sid, cs."Stuff_plus" stuff FROM "Teams Table" tt JOIN "Conference Stats" cs ON cs.conference_id=tt.conference_id AND cs.season=2026 WHERE tt."Season"=2026),
a AS (SELECT pl.opponent_id sid, sum(c.stuff)/nullif(count(*),0) fs FROM pitch_log pl JOIN conf c ON c.sid=pl.team_id WHERE pl.season=2026 GROUP BY pl.opponent_id)
UPDATE public.team_season_stats ts SET faced_stuff_plus=a.fs FROM a WHERE ts.source_id=a.sid AND ts.season=2026;

WITH conf AS (SELECT tt.source_id sid, cs.hitter_talent_plus htp FROM "Teams Table" tt JOIN "Conference Stats" cs ON cs.conference_id=tt.conference_id AND cs.season=2026 WHERE tt."Season"=2026),
a AS (SELECT pl.team_id sid, sum(c.htp)/nullif(count(*),0) fh FROM pitch_log pl JOIN conf c ON c.sid=pl.opponent_id WHERE pl.season=2026 GROUP BY pl.team_id)
UPDATE public.team_season_stats ts SET faced_htp=a.fh FROM a WHERE ts.source_id=a.sid AND ts.season=2026;

UPDATE public.team_season_stats ts SET
  park_rg_rolling=pf.rg_factor, park_rg_single=pf.rg_factor_seasonal,
  park_avg_rolling=pf.avg_factor, park_avg_single=pf.avg_factor_seasonal, park_hr9_rolling=pf.hr9_factor
FROM "Park Factors" pf WHERE pf.source_team_id=ts.source_id AND pf.season=ts.season;
