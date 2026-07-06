import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const SQL = `
-- pitch_log_pitcher_totals — pitcher-allowed batted ball + xStats + FB velo
ALTER TABLE public.pitch_log_pitcher_totals
  ADD COLUMN IF NOT EXISTS batted_balls_allowed_in_play integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_barrels_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_hard_hit_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ev_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS batted_balls_allowed_with_ev integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_ground_balls_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_line_drives_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_fly_balls_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_pop_ups_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_single_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_double_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_triple_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_hr_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ab integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS x_hits_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS x_bases_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS x_woba_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS fb_velo_sum numeric,
  ADD COLUMN IF NOT EXISTS fb_velo_pitches integer NOT NULL DEFAULT 0;

-- pitch_log_pitcher_by_pitch_type — same set + ab
ALTER TABLE public.pitch_log_pitcher_by_pitch_type
  ADD COLUMN IF NOT EXISTS batted_balls_allowed_in_play integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_barrels_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_hard_hit_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ev_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS batted_balls_allowed_with_ev integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_ground_balls_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_line_drives_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_fly_balls_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_pop_ups_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_single_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_double_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_triple_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hits_hr_allowed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ab integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS x_hits_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS x_bases_sum_allowed numeric,
  ADD COLUMN IF NOT EXISTS x_woba_sum_allowed numeric;

-- pitch_log_hitter_totals — max_ev + xStats
ALTER TABLE public.pitch_log_hitter_totals
  ADD COLUMN IF NOT EXISTS max_ev numeric,
  ADD COLUMN IF NOT EXISTS x_hits_sum numeric,
  ADD COLUMN IF NOT EXISTS x_bases_sum numeric,
  ADD COLUMN IF NOT EXISTS x_woba_sum numeric;

-- pitch_log_hitter_by_pitch_type — max_ev + xStats
ALTER TABLE public.pitch_log_hitter_by_pitch_type
  ADD COLUMN IF NOT EXISTS max_ev numeric,
  ADD COLUMN IF NOT EXISTS x_hits_sum numeric,
  ADD COLUMN IF NOT EXISTS x_bases_sum numeric,
  ADD COLUMN IF NOT EXISTS x_woba_sum numeric;
`;

async function main() {
  const { error } = await (sb as any).rpc("exec_sql", { sql: SQL });
  if (error) { console.error("Error:", error.message); process.exit(1); }
  console.log("✅ All missing agg columns added.");
}
main();
