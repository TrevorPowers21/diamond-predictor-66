-- WAR reconcile Stage B — rescale the composite to the D1 run environment (RPW 13.1) and
-- point d_war/bsr_war at the DESCRIPTIVE values (same source + formula → projection == descriptive).
--   d_war   : sum(drs_floor, pos<>'P') / 10.0        -> / 13.1
--   bsr_war : wsb_runs_reg (REGULAR) / 10.0          -> wsb_runs (FULL season) / 13.1
-- total_hitter_war = o_war + d_war + bsr_war (o_war rescales in the Stage-C re-precompute).
--
-- ⚠ DEFINITION ONLY on paste. Do NOT run select refresh_composite_war() yet — o_war is still on
-- the old 10-scale until Stage C re-precomputes it; running now would mix a 10-scaled o_war with
-- 13.1-scaled d/bsr in total_hitter_war. The refresh fires in Stage C, after the precompute.

create or replace function refresh_composite_war() returns void
language sql
set statement_timeout = '180000'
as $$
  update player_predictions p
     set d_war   = dd.dw,
         bsr_war = dd.bw,
         total_hitter_war = case when p.o_war is not null then p.o_war + dd.dw + dd.bw else null end
  from (
    select pp.id, pp.o_war,
           coalesce(d.dw, 0) as dw,
           coalesce(b.bw, 0) as bw
    from player_predictions pp
    left join (
      select player_id, sum(drs_floor) / 13.1 as dw          -- Σ NON-P drs_floor / RPW(13.1)
      from player_season_defense
      where season = 2026 and position <> 'P'
      group by player_id
    ) d on d.player_id = pp.player_id
    left join (
      select player_id, wsb_runs / 13.1 as bw                -- FULL-season wSB / RPW(13.1)
      from player_season_baserunning
      where season = 2026
    ) b on b.player_id = pp.player_id
  ) dd
  where p.id = dd.id
    and (
         p.d_war            is distinct from dd.dw
      or p.bsr_war          is distinct from dd.bw
      or p.total_hitter_war is distinct from
           (case when dd.o_war is not null then dd.o_war + dd.dw + dd.bw else null end)
    );
$$;

-- Stage C only (after o_war re-precompute):  select refresh_composite_war();
