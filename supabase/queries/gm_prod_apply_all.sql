-- ============================================================================
-- GM / FRONT OFFICE — FULL PROD-APPLY BUNDLE
-- Generated 2026-07-08 from supabase/migrations (timestamp order).
--
-- Every statement is idempotent (IF [NOT] EXISTS / DROP POLICY IF EXISTS),
-- so this is safe to run in full and safe to re-run. Apply on PROD with the
-- Supabase CLI (exec_sql RPC is staging-only):
--     supabase db query --linked --file supabase/queries/gm_prod_apply_all.sql
-- or:  npm run db-migrate supabase/queries/gm_prod_apply_all.sql   (prod-linked)
--
-- After it completes, reload the PostgREST schema cache:
--     NOTIFY pgrst, 'reload schema';
-- Note: team_builds.gm_notes (per-build) is superseded by
-- gm_player_finance.notes (per-player); the column is left in place, unused.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 20260705120000_gm_front_office_finance.sql
-- ----------------------------------------------------------------------------
-- Front Office (GM) money + eligibility, Path A. Keyed by (customer_team_id,
-- player_id, season) so it is year-specific and RLS-scoped like team_market_pay_log.
-- Actual Pay is the source of truth here; on Finalize it syncs to the coach's
-- team_build_players.nil_value. Buckets (rev/nil/other) are INDEPENDENT and do
-- NOT auto-sum into actual_pay (spec §4).

CREATE TABLE IF NOT EXISTS public.gm_player_finance (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id            uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  player_id                   uuid NOT NULL,
  season                      integer NOT NULL,
  rev_share                   numeric,
  nil_amount                  numeric,
  other_amount                numeric,
  actual_pay                  numeric,
  finalized                   boolean NOT NULL DEFAULT false,
  finalized_at                timestamptz,
  -- eligibility (GM/head-coach editable, stored) — year-in-school override on
  -- top of players.class_year (GR is a normal ongoing class, not exhausted).
  -- Draft year lives on the player profile, NOT here.
  eligibility_class           text,
  eligibility_note            text,
  updated_by_user_id          uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_team_id, player_id, season)
);
CREATE INDEX IF NOT EXISTS idx_gm_player_finance_team_season
  ON public.gm_player_finance (customer_team_id, season);

-- Per-team, per-season budget allotments per bucket (set via the header editor).
CREATE TABLE IF NOT EXISTS public.gm_budget (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  season             integer NOT NULL,
  rev_share_total    numeric,
  nil_total          numeric,
  other_total        numeric,
  finalized          boolean NOT NULL DEFAULT false,
  finalized_at       timestamptz,
  updated_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_team_id, season)
);

ALTER TABLE public.gm_player_finance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_budget ENABLE ROW LEVEL SECURITY;

-- superadmin OR member of the row's customer_team (same pattern as target_board).
DROP POLICY IF EXISTS gm_player_finance_all ON public.gm_player_finance;
CREATE POLICY gm_player_finance_all ON public.gm_player_finance
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

DROP POLICY IF EXISTS gm_budget_all ON public.gm_budget;
CREATE POLICY gm_budget_all ON public.gm_budget
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

-- ----------------------------------------------------------------------------
-- 20260706120000_gm_scholarship.sql
-- ----------------------------------------------------------------------------
-- Front Office (GM) v1: add a per-player, per-season scholarship figure to the
-- roster finance table. Sits alongside the funding buckets (rev_share / nil /
-- other) as an informational/compliance dollar amount; does NOT feed Actual Pay.
ALTER TABLE public.gm_player_finance
  ADD COLUMN IF NOT EXISTS scholarship_amount numeric;

-- ----------------------------------------------------------------------------
-- 20260707120000_gm_scholarship_total.sql
-- ----------------------------------------------------------------------------
-- Front Office (GM): scholarship gets a program allotment like the other funding
-- buckets (rev_share / nil / other), so the Scholarship box shows used / cap and
-- feeds the Total allotment. Pairs with gm_player_finance.scholarship_amount.
ALTER TABLE public.gm_budget
  ADD COLUMN IF NOT EXISTS scholarship_total numeric;

-- ----------------------------------------------------------------------------
-- 20260707130000_gm_other_breakdown.sql
-- ----------------------------------------------------------------------------
-- Front Office (GM): let the "Other" budget bucket be broken into named funding
-- lines (camps, vendors, donor, etc.). Stored as a JSON array of {name, amount};
-- gm_budget.other_total remains the summed total those lines add up to.
ALTER TABLE public.gm_budget
  ADD COLUMN IF NOT EXISTS other_breakdown jsonb;

-- ----------------------------------------------------------------------------
-- 20260707140000_gm_finance_per_build.sql
-- ----------------------------------------------------------------------------
-- Front Office: re-key per-player finance to the BUILD row (build_player_id)
-- instead of (team, player, season). Makes GM money + roster metadata per-build
-- so scenario builds ("Carson stays" vs "Carson drafted") each carry their own
-- line, copy-on-write clones roster rows + finance together, and locally-added
-- players (freshmen/JUCO — no player_id, but they DO have a build_player_id) can
-- finally hold money. team_build_players is untouched; included_in_roster stays
-- the per-build membership.
ALTER TABLE public.gm_player_finance
  ADD COLUMN IF NOT EXISTS build_player_id  uuid REFERENCES public.team_build_players(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS roster_status    text,   -- 'leaving' etc. (mirrors production_notes.rosterStatus)
  ADD COLUMN IF NOT EXISTS departure_reason text;   -- 'draft' | 'graduation' | 'transfer' | 'other'

-- build_player_id is the identity now; player_id/season become optional metadata.
ALTER TABLE public.gm_player_finance ALTER COLUMN player_id DROP NOT NULL;
ALTER TABLE public.gm_player_finance ALTER COLUMN season   DROP NOT NULL;

-- Backfill existing season-level rows onto the team's DEFAULT build row for that
-- player (staging test data; per-build going forward).
UPDATE public.gm_player_finance f
SET build_player_id = tbp.id
FROM public.team_build_players tbp
JOIN public.team_builds tb ON tb.id = tbp.build_id
WHERE tbp.player_id = f.player_id
  AND tb.customer_team_id = f.customer_team_id
  AND tb.is_default = true
  AND f.build_player_id IS NULL;

-- Swap uniqueness: drop the season-level key (would reject the same player
-- appearing in two builds), add one finance row per roster row.
ALTER TABLE public.gm_player_finance DROP CONSTRAINT IF EXISTS gm_player_finance_customer_team_id_player_id_season_key;
CREATE UNIQUE INDEX IF NOT EXISTS gm_player_finance_build_player_id_key
  ON public.gm_player_finance (build_player_id);

-- Finalize Roster archives non-final builds instead of deleting them.
ALTER TABLE public.team_builds
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 20260707150000_gm_recruits.sql
-- ----------------------------------------------------------------------------
-- Front Office: recruiting board. Future recruiting classes (by year), split
-- position player / pitcher / two-way, hand-ordered like the target board.
-- These carry no projection (HS/JUCO prospects) — just scouting info.
CREATE TABLE IF NOT EXISTS public.gm_recruits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  class_year         integer NOT NULL,                 -- recruiting class (e.g. 2028)
  player_type        text NOT NULL DEFAULT 'hitter',   -- 'hitter' | 'pitcher' | 'twp'
  first_name         text,
  last_name          text,
  high_school        text,
  state              text,
  travel_org         text,
  position           text,
  notes              text,
  link               text,                             -- PBR / PG profile URL
  sort_order         integer NOT NULL DEFAULT 0,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_recruits_team_year ON public.gm_recruits (customer_team_id, class_year);

ALTER TABLE public.gm_recruits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_recruits_all ON public.gm_recruits;
CREATE POLICY gm_recruits_all ON public.gm_recruits
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

-- ----------------------------------------------------------------------------
-- 20260707160000_gm_recruits_stage.sql
-- ----------------------------------------------------------------------------
-- Recruiting funnel stage per recruit: evaluating → contacted → offered →
-- unofficial → official → committed → signed (+ passed). Coaches advance it
-- along the recruiting journey.
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'evaluating';

-- ----------------------------------------------------------------------------
-- 20260707170000_gm_recruit_events.sql
-- ----------------------------------------------------------------------------
-- Recruiting timeline: dated events per recruit (a coach logs the journey —
-- calls, visits, camps, etc.). The recruit's own `notes` field is the static
-- scouting report; these events are the running log, each with its own note.
CREATE TABLE IF NOT EXISTS public.gm_recruit_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruit_id         uuid NOT NULL REFERENCES public.gm_recruits(id) ON DELETE CASCADE,
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  event_date         date NOT NULL DEFAULT current_date,
  note               text,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_recruit_events_recruit ON public.gm_recruit_events (recruit_id);

ALTER TABLE public.gm_recruit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_recruit_events_all ON public.gm_recruit_events;
CREATE POLICY gm_recruit_events_all ON public.gm_recruit_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

-- ----------------------------------------------------------------------------
-- 20260707180000_gm_recruits_report_date.sql
-- ----------------------------------------------------------------------------
-- Date the recruit's scouting report was written (shown + editable in the
-- scouting-report popup).
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS scouting_report_date date;

-- ----------------------------------------------------------------------------
-- 20260707190000_gm_recruit_reports.sql
-- ----------------------------------------------------------------------------
-- Multiple scouting reports per recruit — each authored by a coach on a date,
-- independent (adding/removing one never touches another). Replaces the single
-- notes/scouting_report_date field going forward.
CREATE TABLE IF NOT EXISTS public.gm_recruit_reports (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recruit_id         uuid NOT NULL REFERENCES public.gm_recruits(id) ON DELETE CASCADE,
  customer_team_id   uuid NOT NULL REFERENCES public.customer_teams(id) ON DELETE CASCADE,
  author             text,                            -- who wrote it (email/name snapshot)
  report_date        date NOT NULL DEFAULT current_date,
  body               text,
  created_by_user_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gm_recruit_reports_recruit ON public.gm_recruit_reports (recruit_id);

ALTER TABLE public.gm_recruit_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gm_recruit_reports_all ON public.gm_recruit_reports;
CREATE POLICY gm_recruit_reports_all ON public.gm_recruit_reports
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id))
  WITH CHECK (public.has_role(auth.uid(), 'superadmin'::public.app_role) OR public.is_team_member(customer_team_id));

-- ----------------------------------------------------------------------------
-- 20260707200000_gm_recruits_tier.sql
-- ----------------------------------------------------------------------------
-- Projection tier for a recruit (Draft Prospect / Immediate Impact / …),
-- editable over time, shown on the card + reports.
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS projection_tier text;

-- ----------------------------------------------------------------------------
-- 20260707210000_gm_recruit_contact.sql
-- ----------------------------------------------------------------------------
-- Recruit contact information — team-wide, so any coach on staff can pull up a
-- prospect's phone/email and the people around him. Lives on gm_recruits, which
-- is already scoped to customer_team_id with is_team_member() RLS, so this is
-- shared across the coaching staff (not per-user).
ALTER TABLE public.gm_recruits
  ADD COLUMN IF NOT EXISTS phone          text,  -- player cell
  ADD COLUMN IF NOT EXISTS email          text,  -- player email
  ADD COLUMN IF NOT EXISTS guardian_name  text,  -- parent / guardian
  ADD COLUMN IF NOT EXISTS guardian_phone text,
  ADD COLUMN IF NOT EXISTS coach_name     text,  -- HS / travel coach
  ADD COLUMN IF NOT EXISTS coach_phone    text;

-- ----------------------------------------------------------------------------
-- 20260707220000_gm_recruit_report_tier.sql
-- ----------------------------------------------------------------------------
-- The projection tier is authored with each scouting report — an assistant sets
-- it on June 7, the head coach can revise it on June 14 with a fresh report.
-- Store the tier that accompanied each report (history), and mirror the latest
-- onto gm_recruits.projection_tier for the stable card badge.
ALTER TABLE public.gm_recruit_reports
  ADD COLUMN IF NOT EXISTS projection_tier text;

-- ----------------------------------------------------------------------------
-- 20260707230000_team_builds_gm_notes.sql
-- ----------------------------------------------------------------------------
-- Internal GM notes on a roster build — the front-office "profile" for this
-- scenario (context, philosophy, reminders). Lives on team_builds so it's
-- team-scoped and shared across the coaching staff; the coach-facing Team
-- Builder simply ignores it.
ALTER TABLE public.team_builds
  ADD COLUMN IF NOT EXISTS gm_notes text;

-- ----------------------------------------------------------------------------
-- 20260708120000_gm_player_finance_notes.sql
-- ----------------------------------------------------------------------------
-- Per-player GM notes — scouting/negotiation context on an individual roster
-- row, keyed per build (build_player_id). Supersedes the per-build
-- team_builds.gm_notes; notes belong on the player, not the whole build.
ALTER TABLE public.gm_player_finance
  ADD COLUMN IF NOT EXISTS notes text;

NOTIFY pgrst, 'reload schema';
