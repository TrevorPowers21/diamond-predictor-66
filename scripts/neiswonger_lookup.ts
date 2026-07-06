import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const { data } = await (sb as any)
  .from("players")
  .select("id, first_name, last_name, team, position, source_player_id, is_twp, division")
  .ilike("last_name", "%Neiswonger%");
console.log(JSON.stringify(data, null, 2));
