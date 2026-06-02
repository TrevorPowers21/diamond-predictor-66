import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const trentId = "f6216028-0e20-4c4c-aaf8-7f72e04389a1";

// Verify any prediction touches Trent's UUID
const { count: predCount } = await (sb as any)
  .from("player_predictions")
  .select("id", { count: "exact", head: true })
  .eq("player_id", trentId);
console.log(`predictions where player_id=${trentId}: ${predCount}`);

// Maybe predictions index by source_player_id instead?
const { data: viaSource } = await (sb as any)
  .from("player_predictions")
  .select("id, player_id, customer_team_id, variant, model_type, season")
  .or(`players.source_player_id.eq.1497381799`)
  .limit(5);
console.log("\nvia source_player_id (no inner join):", viaSource);

// Use players!inner join with source_player_id
const { data: viaInner, error } = await (sb as any)
  .from("player_predictions")
  .select("id, player_id, customer_team_id, variant, model_type, season, p_wrc_plus, o_war, players!inner(source_player_id, first_name, last_name)")
  .eq("players.source_player_id", "1497381799")
  .limit(10);
if (error) console.log("inner-join error:", error);
else {
  console.log("\nvia players!inner(source_player_id):");
  for (const r of viaInner || []) {
    console.log(`  ${r.players.first_name} ${r.players.last_name} | id=${r.id} | variant=${r.variant} | model=${r.model_type} | s=${r.season} | wrc+=${r.p_wrc_plus} | oWAR=${r.o_war}`);
  }
}

// Search customer teams / Teams Table for Vandy / Gardner-Webb
console.log("\n=== Searching customer_teams + Teams Table ===");
const { data: ct } = await (sb as any)
  .from("customer_teams")
  .select("*")
  .or("school_name.ilike.%Vanderbilt%,school_name.ilike.%Gardner%,team_name.ilike.%Vanderbilt%,team_name.ilike.%Gardner%")
  .limit(20);
console.log("customer_teams matches:", ct?.length ?? "(err)");
for (const t of ct || []) console.log(`  ${JSON.stringify(t).slice(0, 200)}`);

const { data: tt } = await (sb as any)
  .from("Teams Table")
  .select("id, name, fullName, abbreviation")
  .ilike("name", "Vanderbilt%")
  .limit(5);
console.log("\nTeams Table 'Vanderbilt%':", tt);

const { data: tt2 } = await (sb as any)
  .from("Teams Table")
  .select("id, name, fullName, abbreviation")
  .ilike("name", "Gardner%")
  .limit(5);
console.log("Teams Table 'Gardner%':", tt2);
