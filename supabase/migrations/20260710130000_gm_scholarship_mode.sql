-- Scholarship can be tracked as a % of one scholarship (equivalencies) OR as a
-- flat dollar figure per player — the GM picks per team/season. scholarship_amount
-- holds the raw number in whichever unit the mode selects; scholarship_total is
-- the pool in that unit (a count like 11.7 in %, dollars in $).
ALTER TABLE public.gm_budget
  ADD COLUMN IF NOT EXISTS scholarship_mode text NOT NULL DEFAULT 'pct'
  CHECK (scholarship_mode IN ('pct', 'dollar'));

NOTIFY pgrst, 'reload schema';
