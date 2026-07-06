import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key, {
  auth: { persistSession: false },
  db: { schema: "public" },
});

const SQL = `
UPDATE public.pitch_log
SET
  pitch_result_category = CASE
    WHEN pitch_result IS NULL OR pitch_result = '' THEN 'Other'
    WHEN pitch_result = 'Foul' THEN 'Foul'
    WHEN pitch_result IN ('Ball', 'Ball in the Dirt', 'Intentional Ball') THEN 'Ball'
    WHEN pitch_result IN ('Walk', 'Intentional Walk') THEN 'Walk'
    WHEN pitch_result = 'Hit By Pitch' THEN 'HBP'
    WHEN pitch_result IN ('Strike Looking', 'Strike Swinging') THEN 'Strike'
    WHEN pitch_result LIKE 'Strikeout%' THEN 'Strikeout'
    WHEN pitch_result LIKE 'Home Run%' THEN 'HR'
    WHEN pitch_result LIKE 'Single%' THEN 'Single'
    WHEN pitch_result = 'Double Play' THEN 'DoublePlay'
    WHEN pitch_result LIKE 'Triple%' THEN 'Triple'
    WHEN pitch_result LIKE 'Double%' THEN 'Double'
    WHEN pitch_result = 'Ground Out' THEN 'GroundOut'
    WHEN pitch_result = 'Fly Out' THEN 'FlyOut'
    WHEN pitch_result = 'Line Out' THEN 'LineOut'
    WHEN pitch_result = 'Pop Out' THEN 'PopOut'
    WHEN pitch_result IN ('Sac Bunt', 'Sac Fly') THEN 'Sac'
    WHEN pitch_result LIKE 'Reached on Error%' THEN 'Error'
    WHEN pitch_result = E'Fielder\\'s Choice' THEN 'FieldersChoice'
    ELSE 'Other'
  END,
  is_foul = COALESCE(pitch_result = 'Foul', false),
  is_in_zone = (cs_prob >= 0.50),
  is_strike = COALESCE((
    pitch_result IN ('Strike Looking', 'Strike Swinging', 'Foul')
    OR pitch_result LIKE 'Strikeout%' OR pitch_result LIKE 'Single%'
    OR pitch_result = 'Double Play' OR pitch_result LIKE 'Triple%'
    OR pitch_result LIKE 'Double%' OR pitch_result LIKE 'Home Run%'
    OR pitch_result IN ('Ground Out', 'Fly Out', 'Line Out', 'Pop Out')
    OR pitch_result IN ('Sac Bunt', 'Sac Fly')
    OR pitch_result LIKE 'Reached on Error%' OR pitch_result = E'Fielder\\'s Choice'
  ), false),
  is_swing = COALESCE((
    pitch_result IN ('Strike Swinging', 'Foul') OR pitch_result = 'Strikeout (Swinging)'
    OR pitch_result LIKE 'Single%' OR pitch_result = 'Double Play'
    OR pitch_result LIKE 'Triple%' OR pitch_result LIKE 'Double%'
    OR pitch_result LIKE 'Home Run%'
    OR pitch_result IN ('Ground Out', 'Fly Out', 'Line Out', 'Pop Out')
    OR pitch_result IN ('Sac Bunt', 'Sac Fly')
    OR pitch_result LIKE 'Reached on Error%' OR pitch_result = E'Fielder\\'s Choice'
  ), false),
  is_whiff = COALESCE(pitch_result IN ('Strike Swinging', 'Strikeout (Swinging)'), false),
  is_chase = (cs_prob IS NOT NULL AND cs_prob < 0.50 AND COALESCE((
    pitch_result IN ('Strike Swinging', 'Foul') OR pitch_result = 'Strikeout (Swinging)'
    OR pitch_result LIKE 'Single%' OR pitch_result = 'Double Play'
    OR pitch_result LIKE 'Triple%' OR pitch_result LIKE 'Double%'
    OR pitch_result LIKE 'Home Run%'
    OR pitch_result IN ('Ground Out', 'Fly Out', 'Line Out', 'Pop Out')
    OR pitch_result IN ('Sac Bunt', 'Sac Fly')
    OR pitch_result LIKE 'Reached on Error%' OR pitch_result = E'Fielder\\'s Choice'
  ), false)),
  is_in_play = COALESCE((
    pitch_result LIKE 'Single%' OR pitch_result = 'Double Play'
    OR pitch_result LIKE 'Triple%' OR pitch_result LIKE 'Double%'
    OR pitch_result LIKE 'Home Run%'
    OR pitch_result IN ('Ground Out', 'Fly Out', 'Line Out', 'Pop Out')
    OR pitch_result IN ('Sac Bunt', 'Sac Fly')
    OR pitch_result LIKE 'Reached on Error%' OR pitch_result = E'Fielder\\'s Choice'
  ), false),
  is_batted_ball_in_play = COALESCE((
    pitch_result LIKE 'Single%' OR pitch_result = 'Double Play'
    OR pitch_result LIKE 'Triple%' OR pitch_result LIKE 'Double%'
    OR pitch_result LIKE 'Home Run%'
    OR pitch_result IN ('Ground Out', 'Fly Out', 'Line Out', 'Pop Out')
    OR pitch_result IN ('Sac Bunt', 'Sac Fly')
    OR pitch_result LIKE 'Reached on Error%' OR pitch_result = E'Fielder\\'s Choice'
  ), false)
WHERE is_foul IS NULL;
`;

async function main() {
  const start = Date.now();
  console.log("Running flag derivation UPDATE via exec_sql RPC...");
  const { error } = await (supabase as any).rpc("exec_sql", { sql: SQL });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  if (error) {
    console.error(`exec_sql failed after ${elapsed}s: ${error.message}`);
    process.exit(1);
  }
  console.log(`✅ UPDATE completed in ${elapsed}s`);

  // Verify
  const { count: pending } = await (supabase as any)
    .from("pitch_log")
    .select("uniq_pitch_id", { count: "exact", head: true })
    .is("is_foul", null);
  console.log(`Pending after UPDATE: ${pending}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
