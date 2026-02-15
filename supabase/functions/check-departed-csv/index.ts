import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Parse the CSV from the request body
    const body = await req.text();
    const lines = body.split("\n").filter(l => l.trim());
    
    // Parse CSV player names (columns: playerFullName=3, player=4(last), playerFirstName=5)
    const csvPlayers = new Set<string>();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 6) continue;
      const lastName = cols[4]?.trim();
      const firstName = cols[5]?.trim();
      if (lastName && firstName) {
        csvPlayers.add(`${firstName.toLowerCase()}|${lastName.toLowerCase()}`);
      }
    }

    console.log(`Parsed ${csvPlayers.size} unique players from CSV`);

    // Get all departed returner predictions
    const { data: departed, error } = await supabase
      .from("player_predictions")
      .select("id, player_id, model_type, variant, players!inner(first_name, last_name, team)")
      .eq("status", "departed")
      .eq("model_type", "returner");

    if (error) throw error;

    // Find matches
    const matches: any[] = [];
    for (const pred of (departed || [])) {
      const p = (pred as any).players;
      const key = `${p.first_name.toLowerCase()}|${p.last_name.toLowerCase()}`;
      if (csvPlayers.has(key)) {
        matches.push({
          pred_id: pred.id,
          player_id: pred.player_id,
          variant: pred.variant,
          first_name: p.first_name,
          last_name: p.last_name,
          team: p.team,
        });
      }
    }

    console.log(`Found ${matches.length} departed players that appear in CSV`);

    // Check if we should fix them
    const url = new URL(req.url);
    const fix = url.searchParams.get("fix") === "true";

    if (fix && matches.length > 0) {
      const predIds = matches.map(m => m.pred_id);
      // Un-depart these predictions (set status back to active)
      const { error: updateError } = await supabase
        .from("player_predictions")
        .update({ status: "active" })
        .in("id", predIds);
      
      if (updateError) throw updateError;

      // Also un-depart xstats variants for the same players
      const playerIds = [...new Set(matches.map(m => m.player_id))];
      const { error: xError } = await supabase
        .from("player_predictions")
        .update({ status: "active" })
        .in("player_id", playerIds)
        .eq("status", "departed")
        .eq("model_type", "returner");
      
      if (xError) throw xError;

      return new Response(JSON.stringify({
        message: `Fixed ${matches.length} predictions (restored to active)`,
        players: matches.map(m => `${m.first_name} ${m.last_name} (${m.team})`),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      message: `Found ${matches.length} departed players that appear in the CSV`,
      csvPlayerCount: csvPlayers.size,
      departedTotal: (departed || []).length,
      matches: matches.map(m => `${m.first_name} ${m.last_name} (${m.team}) [${m.variant}]`),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
