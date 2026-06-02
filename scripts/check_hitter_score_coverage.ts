import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

// Coverage on hitter prediction rows: variant=regular, status=active, position-flagged-hitter
const baseFilter = (q: any) => q
  .eq("season", 2027)
  .eq("variant", "regular")
  .in("status", ["active", "departed"])
  .in("model_type", ["returner", "transfer"])
  .not("p_wrc_plus", "is", null);

const cols = ["contact_score", "barrel_score", "ev_score", "chase_score"];

console.log("Hitter prediction score coverage:\n");
for (const col of cols) {
  const { count: nonNull } = await baseFilter(
    (sb as any).from("player_predictions").select("id", { count: "exact", head: true })
  ).not(col, "is", null);
  const { count: total } = await baseFilter(
    (sb as any).from("player_predictions").select("id", { count: "exact", head: true })
  );
  const pct = total ? ((nonNull / total) * 100).toFixed(1) : "0.0";
  console.log(`  ${col.padEnd(15)} ${nonNull?.toLocaleString().padStart(7)} / ${total?.toLocaleString().padStart(7)}   (${pct}%)`);
}
