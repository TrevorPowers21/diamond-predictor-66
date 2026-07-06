import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

for (const name of ["Flora", "Klecker"]) {
  console.log(`\n=== Pitching Master rows where playerFullName ilike %${name}% ===`);
  const { data: pm, error: pmErr } = await (sb as any)
    .from("Pitching Master")
    .select("source_player_id, playerFullName, Team, Season, IP, Role")
    .ilike("playerFullName", `%${name}%`)
    .order("Season", { ascending: false });
  if (pmErr) console.log("err:", pmErr.message);
  console.log(JSON.stringify(pm, null, 2));

  console.log(`\n=== players table — last_name ilike %${name}% ===`);
  const { data: pl } = await (sb as any)
    .from("players")
    .select("id, first_name, last_name, team, position, source_player_id, is_twp, division")
    .ilike("last_name", `%${name}%`);
  console.log(JSON.stringify(pl, null, 2));
}
