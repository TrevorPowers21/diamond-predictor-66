-- team_season_stats RATE block (step 3) — weighted aggregate of the AUTHORITATIVE Masters (TruMedia=BBRef), NOT pitch_log.
-- Master rates are the official season export (import-csvs/registry.ts), not pitch-log totals → use them for authoritative team rates.
-- Method = "sum first then rate": PA/AB-weighted hitting, IP-weighted pitching (the weighting IS the summing). D1 only, total season.
-- Verified staging 2026-08-19: 308 teams, 0 null; team avg .277/.381/.434 wRC+~100 (= D1 NCAA baselines); Georgia .318/.612/120, Ark ERA 4.74.

-- hitting rates
UPDATE public.team_season_stats ts SET
  pa_total = a.pa, ab_total = a.ab,
  avg_total = a.tavg, obp_total = a.tobp, slg_total = a.tslg,
  iso_total = a.tslg - a.tavg, ops_total = a.tobp + a.tslg,
  wrc_plus_total = ((0.011 + 0.691*a.tobp + 0.235*a.tslg)/0.3782)*100
FROM (
  SELECT tt.source_id sid, sum(hm.pa) pa, sum(hm.ab) ab,
    sum(hm."AVG"*hm.ab)/nullif(sum(hm.ab),0) tavg,
    sum(hm."OBP"*hm.pa)/nullif(sum(hm.pa),0) tobp,
    sum(hm."SLG"*hm.ab)/nullif(sum(hm.ab),0) tslg
  FROM "Hitter Master" hm JOIN "Teams Table" tt ON tt.id = hm."TeamID"
  WHERE hm."Season"=2026 AND hm.division='D1' AND hm.ab > 0
  GROUP BY tt.source_id
) a WHERE ts.source_id = a.sid AND ts.season = 2026;

-- pitching rates
UPDATE public.team_season_stats ts SET
  ip_total = a.ip, bf_total = a.bf,
  era_total = a.tera, fip_total = a.tfip, whip_total = a.twhip,
  k9_total = a.tk9, bb9_total = a.tbb9, hr9_total = a.thr9
FROM (
  SELECT tt.source_id sid, sum(pm."IP") ip, sum(pm.bf) bf,
    sum(pm."ERA"*pm."IP")/nullif(sum(pm."IP"),0) tera,
    sum(pm."FIP"*pm."IP")/nullif(sum(pm."IP"),0) tfip,
    sum(pm."WHIP"*pm."IP")/nullif(sum(pm."IP"),0) twhip,
    sum(pm."K9"*pm."IP")/nullif(sum(pm."IP"),0) tk9,
    sum(pm."BB9"*pm."IP")/nullif(sum(pm."IP"),0) tbb9,
    sum(pm."HR9"*pm."IP")/nullif(sum(pm."IP"),0) thr9
  FROM "Pitching Master" pm JOIN "Teams Table" tt ON tt.id = pm."TeamID"
  WHERE pm."Season"=2026 AND pm.division='D1' AND pm."IP" > 0
  GROUP BY tt.source_id
) a WHERE ts.source_id = a.sid AND ts.season = 2026;
