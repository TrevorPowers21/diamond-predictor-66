-- Per-team branding columns on customer_teams. Replaces the hardcoded
-- SCHOOL_BRANDING lookup in src/hooks/useEffectiveSchool.ts so superadmins
-- can prep new demo schools without a code change + redeploy.
--
-- All columns are nullable: a customer team without branding falls back to
-- the global RSTR IQ banner.
--
-- logo_url        — public path or full URL (e.g. "/Kansas Logo.svg")
-- display_name    — top line of the styled banner ("KANSAS")
-- mascot          — bottom line of the styled banner ("JAYHAWKS")
-- primary_color   — hex string for the top line color ("#0051BA")
-- secondary_color — hex string for the bottom (mascot) line color ("#E8000D")

ALTER TABLE public.customer_teams
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS mascot text,
  ADD COLUMN IF NOT EXISTS primary_color text,
  ADD COLUMN IF NOT EXISTS secondary_color text;

-- Backfill the two demo schools so the banner doesn't regress when the code
-- swaps from the hardcoded constant to row-driven branding.
UPDATE public.customer_teams
   SET logo_url = '/Kansas Logo.svg',
       display_name = 'KANSAS',
       mascot = 'JAYHAWKS',
       primary_color = '#0051BA',
       secondary_color = '#E8000D'
 WHERE lower(name) = 'kansas jayhawks';

UPDATE public.customer_teams
   SET logo_url = '/Georgia_Athletics_logo.svg.webp',
       display_name = 'GEORGIA',
       mascot = 'BULLDOGS',
       primary_color = '#BA0C2F',
       secondary_color = '#000000'
 WHERE lower(name) = 'georgia bulldogs';
