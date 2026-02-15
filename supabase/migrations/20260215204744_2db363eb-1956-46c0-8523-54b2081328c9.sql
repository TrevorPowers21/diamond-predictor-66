-- Temporary table for CSV player names
CREATE TABLE IF NOT EXISTS public.temp_csv_players (
  first_name text NOT NULL,
  last_name text NOT NULL
);

-- No RLS needed, this is temporary admin-only usage
ALTER TABLE public.temp_csv_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can manage temp_csv_players"
ON public.temp_csv_players
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role));