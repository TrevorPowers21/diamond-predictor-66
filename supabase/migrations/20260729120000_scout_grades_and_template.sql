-- Scouting Report v2 — part 1a: per-report grades + per-team scouting template.
-- (Design: docs/RECRUIT_IDENTITY_AND_MOBILE_ADD_SPEC.md → "Scouting Report v2".)
--
-- Grades ride on each dated report as a per-look snapshot (never overwritten) —
-- stored by STABLE field key + scale ordinal (1-5), NOT the visible label, so a
-- staff renaming a field or relabeling the scale never breaks prior reports.
--
-- The template is fully customizable per team, per player_type. A row exists only
-- once a staff customizes; otherwise the app uses the in-code defaults. RLS
-- team-scoped (superadmin OR team member). Additive + idempotent.

alter table public.gm_recruit_reports add column if not exists grades jsonb;

create table if not exists public.gm_scout_template (
  id                 uuid primary key default gen_random_uuid(),
  customer_team_id   uuid not null references public.customer_teams(id) on delete cascade,
  player_type        text not null check (player_type in ('hitter','pitcher','twp')),
  fields             jsonb not null,   -- ordered [{ key, label, type: 'grade'|'text', order }]
  scale              jsonb not null,   -- [{ ordinal, label }]  (default 5 words)
  updated_by_user_id uuid,
  updated_at         timestamptz not null default now(),
  unique (customer_team_id, player_type)
);

alter table public.gm_scout_template enable row level security;
drop policy if exists gm_scout_template_all on public.gm_scout_template;
create policy gm_scout_template_all on public.gm_scout_template
  for all to authenticated
  using  (public.has_role(auth.uid(), 'superadmin'::public.app_role) or public.is_team_member(customer_team_id))
  with check (public.has_role(auth.uid(), 'superadmin'::public.app_role) or public.is_team_member(customer_team_id));
