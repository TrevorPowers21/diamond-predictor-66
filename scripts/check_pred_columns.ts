import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Pull one player_predictions row to see all columns
const { data } = await (sb as any)
  .from("player_predictions")
  .select("*")
  .eq("variant", "regular")
  .not("p_wrc_plus", "is", null)
  .limit(1)
  .single();

console.log("All columns on player_predictions:");
console.log(Object.keys(data).sort().join("\n"));
console.log("");
console.log("Scouting-grade-related columns (filter):");
const scoutKeys = Object.keys(data).filter((k) =>
  /score|grade|rating|contact|barrel|chase|ev|exit|whiff|hard|miss|stuff|gb_|line_drive|pop_up/.test(k.toLowerCase())
);
console.log(scoutKeys.sort().join("\n"));
