-- Add team_id UUID column to players table for direct team linking.
-- Keeps the existing team text column for backward compatibility.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES public.teams(id);

CREATE INDEX IF NOT EXISTS idx_players_team_id
  ON public.players (team_id)
  WHERE team_id IS NOT NULL;

-- Populate team_id for existing players by matching team name.
-- Uses case-insensitive exact match first.
UPDATE public.players p
SET team_id = t.id
FROM public.teams t
WHERE p.team_id IS NULL
  AND p.team IS NOT NULL
  AND lower(trim(p.team)) = lower(trim(t.name));

-- Also try matching with "University" stripped from both sides.
UPDATE public.players p
SET team_id = t.id
FROM public.teams t
WHERE p.team_id IS NULL
  AND p.team IS NOT NULL
  AND lower(regexp_replace(regexp_replace(trim(p.team), '\mUniversity\M', '', 'gi'), '\mof\M', '', 'gi'))
    = lower(regexp_replace(regexp_replace(trim(t.name), '\mUniversity\M', '', 'gi'), '\mof\M', '', 'gi'));
