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
