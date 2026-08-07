-- Composite WAR: side-specific hitter total + centralized refresh.
-- Push 1 (÷10 additive). o_war / p_war UNCHANGED. total_hitter_war = o + d + bsr.
--
-- The earlier draft of refresh_composite_war() rewrote all ~184k player_predictions
-- rows every call. That succeeds in the SQL editor (long timeout) but TIMES OUT via
-- the PostgREST/edge-function path (57014). Two fixes below:
--   (1) SET statement_timeout on the function  -> a bulk maintenance UPDATE gets room.
--   (2) WHERE ... IS DISTINCT FROM             -> only rewrite rows that actually change,
--       so a post-precompute run touches one team's moved rows, not the whole table.
-- Idempotent; safe to run repeatedly.

-- one-time (staging already has these; guarded for prod):
alter table player_predictions rename column total_war to total_hitter_war;   -- run once
-- (d_war / bsr_war columns assumed present from 20260805_player_season_defense_baserunning.sql)

create or replace function refresh_composite_war() returns void
language sql
set statement_timeout = '180000'   -- ms; override the API default for the bulk case
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
      select player_id, sum(drs_floor) / 10.0 as dw          -- Σ NON-P drs_floor / rpw(=10)
      from player_season_defense
      where season = 2026 and position <> 'P'
      group by player_id
    ) d on d.player_id = pp.player_id
    left join (
      select player_id, wsb_runs_reg / 10.0 as bw            -- wSB / rpw(=10)
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

select refresh_composite_war();   -- reconcile any stale rows now
