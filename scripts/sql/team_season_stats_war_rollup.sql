-- team_season_stats WAR rollup (D1 only) — team = Σ player descriptive WAR, reg + total.
-- Source: Hitter Master (desc_owar/d_war/bsr_war/total_desc_war + _reg) + Pitching Master (desc_pwar/total_desc_war + _reg).
-- Join Masters.TeamID = "Teams Table".id → source_id (stable program key). JUCO (NJCAA_D1) EXCLUDED (descriptive is D1-only).
-- Verified staging 2026-08-19: 308 D1 rows; pWAR corr 1.0000 vs team_war_snapshots.raw_total_pwar (exact); oWAR = Σ desc_owar by construction.
WITH h AS (
  SELECT "TeamID" tid,
    max("Team") team_name, (max(conference_id::text))::uuid conference_id,
    sum(desc_owar) owar_total,       sum(desc_owar_reg) owar_reg,
    sum(d_war) dwar_total,           sum(d_war_reg) dwar_reg,
    sum(bsr_war) bsrwar_total,       sum(bsr_war_reg) bsrwar_reg,
    sum(total_desc_war) hit_tw,      sum(total_desc_war_reg) hit_tw_reg,
    count(*) n_hitters
  FROM "Hitter Master" WHERE "Season"=2026 AND division='D1' GROUP BY "TeamID"
),
p AS (
  SELECT "TeamID" tid, (max(conference_id::text))::uuid conference_id,
    sum(desc_pwar) pwar_total,       sum(desc_pwar_reg) pwar_reg,
    sum(total_desc_war) pit_tw,      sum(total_desc_war_reg) pit_tw_reg,
    count(*) n_pitchers
  FROM "Pitching Master" WHERE "Season"=2026 AND division='D1' GROUP BY "TeamID"
)
INSERT INTO public.team_season_stats
  (source_id, season, team_season_id, conference_id, team_name, abbreviation,
   owar_reg, owar_total, dwar_reg, dwar_total, bsrwar_reg, bsrwar_total,
   pwar_reg, pwar_total, total_war_reg, total_war_total, n_hitters, n_pitchers)
SELECT tt.source_id, 2026, tt.id,
   coalesce(h.conference_id, p.conference_id, tt.conference_id),
   tt.full_name, tt.abbreviation,
   coalesce(h.owar_reg,0),   coalesce(h.owar_total,0),
   coalesce(h.dwar_reg,0),   coalesce(h.dwar_total,0),
   coalesce(h.bsrwar_reg,0), coalesce(h.bsrwar_total,0),
   coalesce(p.pwar_reg,0),   coalesce(p.pwar_total,0),
   coalesce(h.hit_tw_reg,0)+coalesce(p.pit_tw_reg,0),
   coalesce(h.hit_tw,0)+coalesce(p.pit_tw,0),
   coalesce(h.n_hitters,0),  coalesce(p.n_pitchers,0)
FROM h FULL JOIN p ON h.tid = p.tid
JOIN "Teams Table" tt ON tt.id = coalesce(h.tid, p.tid);
