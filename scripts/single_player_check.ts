import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
console.log(`Connecting to: ${url}\n`);
const sb = createClient(url, key, { auth: { persistSession: false } });

const pid = "475ff608-fc11-498f-b5a6-5922acdbd347";

// Direct query — NO pagination, NO inner join
const { data: pp } = await (sb as any)
  .from("player_predictions")
  .select("id, player_id, customer_team_id, variant, model_type, status, season")
  .eq("player_id", pid);
console.log(`Direct player_predictions for ${pid}: ${pp?.length ?? 0} rows`);
console.log(JSON.stringify(pp, null, 2));

// Same query WITH the inner join used by the dashboard
const { data: ppJoin } = await (sb as any)
  .from("player_predictions")
  .select("id, player_id, customer_team_id, variant, players!inner(id, transfer_portal, pa)")
  .eq("player_id", pid)
  .eq("season", 2027)
  .eq("variant", "regular");
console.log(`\nWith players!inner join: ${ppJoin?.length ?? 0} rows`);
console.log(JSON.stringify(ppJoin, null, 2));

// Look at players row count for this id (FK side)
const { data: players } = await (sb as any).from("players").select("id, first_name, last_name, team, source_player_id").eq("id", pid);
console.log(`\nplayers rows for id ${pid}: ${players?.length ?? 0}`);
console.log(JSON.stringify(players, null, 2));
